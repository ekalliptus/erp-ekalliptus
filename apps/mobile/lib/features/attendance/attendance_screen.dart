import 'dart:async';
import 'dart:ui' show FontFeature;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/attendance/attendance_telemetry.dart';
import '../../core/attendance/face_recognition_service.dart';
import '../../core/network/api_client.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/security/biometric_guard.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

enum _AttendanceFilter { all, selectedDay, pending }

enum _VerificationMode { biometric, faceScan }

class _LiveFaceVerificationResult {
  final String selfieKey;
  final List<double> descriptor;
  final int similarityPercent;

  const _LiveFaceVerificationResult({
    required this.selfieKey,
    required this.descriptor,
    required this.similarityPercent,
  });
}

class AttendanceScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const AttendanceScreen({super.key, required this.profile});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  static const int _batchSize = 15;

  bool _loading = true;
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  int _observedVersion = 0;
  Timer? _moreTimer;
  String? _error;
  Map<String, dynamic>? _data;

  AttendanceTelemetrySnapshot? _telemetry;
  BiometricCapability _capability = BiometricCapability.strongBiometric;
  _VerificationMode _verificationMode = _VerificationMode.biometric;
  bool _busyAction = false;
  String _busyLabel = 'Memproses...';
  bool? _faceEnrolled;
  List<String> _faceModels = const [];
  bool _faceHasReferencePhoto = false;
  DateTime _selectedDate = DateTime.now();
  _AttendanceFilter _filter = _AttendanceFilter.all;

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    _load();
    _initCapabilityAndTelemetry();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    super.dispose();
  }

  Future<void> _initCapabilityAndTelemetry() async {
    try {
      final cap = await ref.read(biometricGuardProvider).inspectCapability();
      if (mounted) {
        setState(() {
          _capability = cap;
          if (cap == BiometricCapability.unavailable ||
              cap == BiometricCapability.deviceCredentialOnly) {
            _verificationMode = _VerificationMode.faceScan;
          }
        });
      }
    } catch (_) {
      // Abaikan jika platform channel belum tersedia pada lingkungan uji.
    }

    try {
      final snap = await ref
          .read(attendanceTelemetryServiceProvider)
          .collectAll(requestPermission: false);
      if (mounted) {
        setState(() => _telemetry = snap);
      }
    } catch (_) {
      // Telemetri pasif opsional hingga pengguna menekan tombol absensi.
    }
  }

  void _scheduleLoadMore(int total) {
    if (_loadingMore || _visibleCount >= total) return;
    setState(() => _loadingMore = true);
    _moreTimer?.cancel();
    _moreTimer = Timer(const Duration(milliseconds: 220), () {
      if (!mounted) return;
      setState(() {
        _visibleCount += _batchSize;
        _loadingMore = false;
      });
    });
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).fetchAttendanceData();
      bool? faceEnrolled;
      var faceModels = const <String>[];
      var hasRefPhoto = false;
      try {
        final fs = await ref.read(apiClientProvider).fetchFaceStatus();
        faceEnrolled = fs['enrolled'] == true;
        faceModels = ((fs['models'] as List<dynamic>?) ?? const [])
            .map((e) => e.toString())
            .toList(growable: false);
        hasRefPhoto = fs['has_reference_photo'] == true;
      } catch (_) {
        // Opsional saat offline atau mock uji belum mengisi endpoint face-status.
      }
      if (mounted) {
        setState(() {
          _data = res;
          _faceEnrolled = faceEnrolled;
          _faceModels = faceModels;
          _faceHasReferencePhoto = hasRefPhoto;
          _visibleCount = _batchSize;
          _loading = false;
        });
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  void _markDataMutated() {
    final next = ref.read(erpDataVersionProvider) + 1;
    _observedVersion = next;
    ref.read(erpDataVersionProvider.notifier).state = next;
    ref.invalidate(sessionProfileProvider);
  }

  Future<void> _refreshTelemetry() async {
    if (_busyAction) return;
    setState(() {
      _busyAction = true;
      _busyLabel = 'Memperbarui GPS...';
    });
    try {
      final snap = await ref
          .read(attendanceTelemetryServiceProvider)
          .collectAll(requestPermission: true);
      if (mounted) {
        setState(() => _telemetry = snap);
      }
    } finally {
      if (mounted) {
        setState(() => _busyAction = false);
      }
    }
  }

  Map<String, dynamic>? _selectNearestOffice(
    List<dynamic> offices,
    AttendanceTelemetrySnapshot? snap,
  ) {
    if (offices.isEmpty) return null;
    if (offices.length == 1 || snap == null || !snap.hasGps) {
      return offices.first as Map<String, dynamic>;
    }
    Map<String, dynamic> nearest = offices.first as Map<String, dynamic>;
    var minDist = double.infinity;
    for (final raw in offices) {
      final m = raw as Map<String, dynamic>;
      final d = calculateDistanceMeters(
        lat1: snap.latitude!,
        lng1: snap.longitude!,
        lat2: (m['latitude'] as num).toDouble(),
        lng2: (m['longitude'] as num).toDouble(),
      );
      if (d < minDist) {
        minDist = d;
        nearest = m;
      }
    }
    return nearest;
  }

  String _verificationMethodLabel(String? method) {
    switch (method) {
      case 'biometric':
        return 'Biometrik HP';
      case 'face_scan':
        return 'Scan Wajah';
      case 'qr':
        return 'QR Kantor';
      case 'selfie':
        return 'Selfie';
      default:
        return '-';
    }
  }

  String _biometricButtonLabel() {
    switch (_capability) {
      case BiometricCapability.fingerprint:
        return 'Sidik Jari';
      case BiometricCapability.face:
        return 'Face Unlock';
      default:
        return 'Biometrik HP';
    }
  }

  Future<_LiveFaceVerificationResult?> _runLiveFaceVerification({
    required bool isClockOut,
    bool enrollOnly = false,
  }) async {
    final api = ref.read(apiClientProvider);
    if (mounted) {
      setState(() => _busyLabel = 'Memeriksa profil wajah...');
    }
    final status = await api.fetchFaceStatus(includeMobileDescriptor: true);
    if (!mounted) return null;

    final enrolled = status['enrolled'] == true;
    final models = ((status['models'] as List<dynamic>?) ?? const [])
        .map((e) => e.toString())
        .toList(growable: false);
    final hasRefPhoto = status['has_reference_photo'] == true;

    List<List<double>>? refDescriptors;
    final rawMulti = status['mobile_descriptors'];
    if (rawMulti is List && rawMulti.isNotEmpty) {
      final parsedMulti = rawMulti
          .whereType<List<dynamic>>()
          .map((vec) => vec.map((n) => (n as num).toDouble()).toList(growable: false))
          .where((vec) => vec.isNotEmpty)
          .toList(growable: false);
      if (parsedMulti.isNotEmpty) {
        refDescriptors = parsedMulti;
      }
    } else if (status['mobile_descriptor'] is List) {
      final single = (status['mobile_descriptor'] as List<dynamic>)
          .map((n) => (n as num).toDouble())
          .toList(growable: false);
      if (single.isNotEmpty) {
        refDescriptors = [single];
      }
    }

    setState(() {
      _faceEnrolled = enrolled;
      _faceModels = models;
      _faceHasReferencePhoto = hasRefPhoto;
    });

    late final FaceScanMode scanMode;
    Uint8List? refImageBytes;
    if (!enrolled || enrollOnly) {
      scanMode = FaceScanMode.enroll;
    } else if (!models.contains('mobile_facenet_192d') && hasRefPhoto) {
      scanMode = FaceScanMode.bridgeVerify;
      if (mounted) {
        setState(() => _busyLabel = 'Mengunduh acuan wajah akun...');
      }
      refImageBytes = await api.fetchFaceReferenceImageBytes();
      if (!mounted) return null;
    } else {
      scanMode = FaceScanMode.verify;
    }

    if (mounted) {
      setState(() => _busyLabel = 'Memindai wajah langsung...');
    }
    final outcome = await ref.read(faceRecognitionServiceProvider).scanFace(
          mode: scanMode,
          title: enrollOnly || !enrolled
              ? 'Daftarkan Wajah Karyawan'
              : isClockOut
                  ? 'Scan Wajah Absen Pulang'
                  : 'Scan Wajah Absen Masuk',
          referenceDescriptors: refDescriptors,
          referenceImageBytes: refImageBytes,
        );
    if (!mounted) return null;

    if (outcome.cancelled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Scan wajah dibatalkan.')),
      );
      return null;
    }
    if (outcome.descriptor.length != 192 || outcome.imageBytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Data wajah dari kamera belum lengkap. Coba lagi.')),
      );
      return null;
    }

    if (mounted) {
      setState(() => _busyLabel = 'Mengunggah foto verifikasi...');
    }
    final selfieKey = await api.uploadObject(
      category: 'selfie',
      filename: 'face-android-${DateTime.now().millisecondsSinceEpoch}.jpg',
      contentType: 'image/jpeg',
      bytes: outcome.imageBytes!,
    );
    if (!mounted) return null;

    if (!enrolled || enrollOnly) {
      if (mounted) {
        setState(() => _busyLabel = 'Menyimpan wajah acuan akun...');
      }
      await api.enrollFace(
        faceModel: 'mobile_facenet_192d',
        faceDescriptor: outcome.descriptor,
        faceSamples: outcome.samples.isNotEmpty ? outcome.samples : null,
        enrollmentPoses: outcome.poses.isNotEmpty ? outcome.poses : null,
        selfieObjectKey: selfieKey,
      );
      if (!mounted) return null;
      setState(() {
        _faceEnrolled = true;
        _faceModels = const ['mobile_facenet_192d'];
        _faceHasReferencePhoto = true;
      });
      if (enrollOnly) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Wajah acuan berhasil didaftarkan untuk akun Anda.')),
        );
        return null;
      }
      return _LiveFaceVerificationResult(
        selfieKey: selfieKey,
        descriptor: outcome.descriptor,
        similarityPercent: 100,
      );
    }

    if (scanMode == FaceScanMode.bridgeVerify) {
      if (mounted) {
        setState(() => _busyLabel = 'Menyelaraskan profil wajah...');
      }
      await api.enrollFace(
        faceModel: 'mobile_facenet_192d',
        faceDescriptor: outcome.referenceDescriptor ?? outcome.descriptor,
        selfieObjectKey: selfieKey,
        derivedFromReference: true,
      );
      if (!mounted) return null;
      setState(() {
        _faceModels = {..._faceModels, 'mobile_facenet_192d'}.toList(growable: false);
      });
      return _LiveFaceVerificationResult(
        selfieKey: selfieKey,
        descriptor: outcome.descriptor,
        similarityPercent: outcome.similarityPercent,
      );
    }

    if (mounted) {
      setState(() => _busyLabel = 'Mencocokkan identitas wajah...');
    }
    final verifyRes = await api.verifyFace(
      faceModel: 'mobile_facenet_192d',
      faceDescriptor: outcome.descriptor,
    );
    if (!mounted) return null;

    final sim = (verifyRes['similarity_percent'] as num?)?.toInt() ?? outcome.similarityPercent;
    if (verifyRes['matched'] != true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Wajah tidak cocok dengan karyawan terdaftar (kemiripan $sim%). Absensi ditolak.',
          ),
        ),
      );
      return null;
    }

    return _LiveFaceVerificationResult(
      selfieKey: selfieKey,
      descriptor: outcome.descriptor,
      similarityPercent: sim,
    );
  }

  Future<void> _enrollFaceFromHero() async {
    if (_busyAction) return;
    HapticFeedback.selectionClick();
    setState(() {
      _busyAction = true;
      _busyLabel = 'Menyiapkan pendaftaran wajah...';
    });
    try {
      await _runLiveFaceVerification(isClockOut: false, enrollOnly: true);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Pendaftaran wajah gagal: $err')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyAction = false);
      }
    }
  }

  Future<void> _performUnifiedAttendance({
    required bool isClockOut,
    Map<String, dynamic>? office,
  }) async {
    if (_busyAction) return;
    HapticFeedback.mediumImpact();
    setState(() {
      _busyAction = true;
      _busyLabel = 'Memverifikasi identitas...';
    });

    final telemetryService = ref.read(attendanceTelemetryServiceProvider);
    final telemetryFuture = telemetryService.collectAll(requestPermission: true);

    try {
      var verificationMethod = 'biometric';
      var biometricVerified = false;
      String? biometricType;
      _LiveFaceVerificationResult? faceRes;

      if (_verificationMode == _VerificationMode.biometric) {
        final authRes = await ref.read(biometricGuardProvider).authenticateForAttendance(
              reason: isClockOut
                  ? 'Verifikasi sidik jari atau wajah untuk Absen Pulang MyEkalliptus'
                  : 'Verifikasi sidik jari atau wajah untuk Absen Masuk MyEkalliptus',
            );
        if (!mounted) return;

        if (authRes.verified) {
          biometricVerified = true;
          verificationMethod = 'biometric';
          biometricType = authRes.methodLabel;
        } else if (authRes.needsCameraFaceFallback) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Biometrik HP tidak tersedia, beralih ke scan wajah otomatis.'),
            ),
          );
          faceRes = await _runLiveFaceVerification(isClockOut: isClockOut);
          if (!mounted || faceRes == null) return;
          verificationMethod = 'face_scan';
          biometricType = 'android_face_scan';
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(authRes.message ?? 'Verifikasi biometrik dibatalkan.'),
            ),
          );
          return;
        }
      } else {
        faceRes = await _runLiveFaceVerification(isClockOut: isClockOut);
        if (!mounted || faceRes == null) return;
        verificationMethod = 'face_scan';
        biometricType = 'android_face_scan';
      }

      if (mounted) {
        setState(() => _busyLabel = 'Membaca GPS & info perangkat...');
      }
      final snap = await telemetryFuture;
      if (!mounted) return;
      setState(() => _telemetry = snap);

      if (snap.isMockedGps == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Lokasi palsu (Mock GPS) terdeteksi. Matikan Fake GPS untuk absensi.'),
          ),
        );
        return;
      }

      if (!isClockOut && !snap.hasGps) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('GPS tidak terbaca. Aktifkan lokasi perangkat lalu coba lagi.'),
          ),
        );
        return;
      }

      if (mounted) {
        setState(() => _busyLabel = isClockOut ? 'Mencatat absen pulang...' : 'Mencatat absen masuk...');
      }

      final payload = <String, dynamic>{
        if (!isClockOut && office != null) 'office_id': office['id'].toString(),
        if (snap.latitude != null) 'latitude': snap.latitude,
        if (snap.longitude != null) 'longitude': snap.longitude,
        if (faceRes != null) 'selfie_object_key': faceRes.selfieKey,
        'verification_method': verificationMethod,
        if (biometricVerified) 'biometric_verified': true,
        if (faceRes != null) 'face_model': 'mobile_facenet_192d',
        if (faceRes != null) 'face_descriptor': faceRes.descriptor,
        'device_info': snap.toDeviceInfoJson(
          biometricType: biometricType,
          faceSimilarityPercent: faceRes?.similarityPercent,
        ),
      };

      final endpoint = isClockOut ? '/api/attendance/clock-out' : '/api/attendance/clock-in';
      try {
        final api = ref.read(apiClientProvider);
        if (isClockOut) {
          await api.clockOut(payload);
        } else {
          await api.clockIn(payload);
        }
        _markDataMutated();
        await _load();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                isClockOut
                    ? 'Absen pulang tercatat (${_verificationMethodLabel(verificationMethod)}).'
                    : 'Absen masuk tercatat (${_verificationMethodLabel(verificationMethod)}).',
              ),
            ),
          );
        }
      } catch (err) {
        if (!isOfflineRecoverableError(err)) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
          }
          return;
        }
        await ref.read(offlineSyncServiceProvider).enqueueMutation(
              endpoint: endpoint,
              method: 'POST',
              payload: payload,
            );
        ref.invalidate(pendingOfflineCountProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                isClockOut
                    ? 'Offline: absen pulang masuk antrean sinkronisasi.'
                    : 'Offline: absen masuk ke antrean sinkronisasi.',
              ),
            ),
          );
        }
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Proses absensi gagal: $err')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyAction = false);
      }
    }
  }

  Future<void> _openLeaveSheet() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _LeaveRequestSheet(initialDate: _selectedDate),
    );
    if (saved == true && mounted) {
      _markDataMutated();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pengajuan izin/sakit terkirim ke HR.')),
        );
      }
    }
  }

  Future<void> _decideRecord(String id, String decision) async {
    try {
      await ref.read(apiClientProvider).approveAttendance(id, decision);
      _markDataMutated();
      await _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    }
  }

  void _openRecordDetail(Map<String, dynamic> rec, bool canReview) {
    final t = EucalyptusTokens.of(context);
    final status = (rec['status'] ?? '').toString();
    final approval = (rec['approval_status'] ?? '').toString();
    final dev = rec['clock_in_device'] is Map
        ? Map<String, dynamic>.from(rec['clock_in_device'] as Map)
        : null;
    final method = _verificationMethodLabel(rec['clock_in_method']?.toString());
    final ip = (rec['clock_in_ip'] ?? dev?['local_ip'])?.toString();
    final deviceName = [
      dev?['brand']?.toString(),
      dev?['model']?.toString(),
    ].where((e) => e != null && e.trim().isNotEmpty).join(' ');
    final lat = rec['clock_in_lat'];
    final lng = rec['clock_in_lng'];

    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (mCtx) => ErpBottomSheetFrame(
        title: (rec['employee_name'] ?? 'Detail Absensi').toString(),
        subtitle: '${rec['attendance_date']} · ${status.toUpperCase()} ($approval)',
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: t.surfaceSubtle,
                borderRadius: BorderRadius.circular(t.radiusMd),
                border: Border.all(color: t.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _DetailLine(
                    label: 'Masuk / Pulang',
                    value:
                        '${formatShortDateTime(rec['clock_in_at']?.toString())} / ${formatShortDateTime(rec['clock_out_at']?.toString())}',
                  ),
                  const SizedBox(height: 8),
                  _DetailLine(label: 'Metode Verifikasi', value: method),
                  const SizedBox(height: 8),
                  _DetailLine(
                    label: 'Perangkat',
                    value: deviceName.isNotEmpty ? deviceName : (dev?['platform']?.toString() ?? '-'),
                  ),
                  const SizedBox(height: 8),
                  _DetailLine(label: 'Alamat IP', value: (ip != null && ip.isNotEmpty) ? ip : '-'),
                  if (lat != null && lng != null) ...[
                    const SizedBox(height: 8),
                    _DetailLine(label: 'Koordinat GPS', value: '$lat, $lng'),
                  ],
                  if ((rec['note'] ?? '').toString().trim().isNotEmpty) ...[
                    const SizedBox(height: 8),
                    _DetailLine(label: 'Catatan', value: rec['note'].toString()),
                  ],
                ],
              ),
            ),
            if (canReview) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: () {
                        Navigator.of(mCtx).pop();
                        _decideRecord(rec['id'].toString(), 'approved');
                      },
                      child: const Text('Setujui'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: t.danger,
                        side: BorderSide(color: t.danger.withValues(alpha: 0.45)),
                      ),
                      onPressed: () {
                        Navigator.of(mCtx).pop();
                        _decideRecord(rec['id'].toString(), 'rejected');
                      },
                      child: const Text('Tolak'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    ref.listen<int>(erpDataVersionProvider, (prev, next) {
      if (next != _observedVersion && mounted) {
        _observedVersion = next;
        _load();
      }
    });

    if (!widget.profile.hasPermission('attendance', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Absensi Ditolak',
          description: 'Role Anda tidak memiliki izin attendance:view.',
        ),
      );
    }
    if (_loading) return const AttendanceSkeleton();
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    final offices = (_data?['offices'] as List<dynamic>?) ?? const [];
    final records = (_data?['records'] as List<dynamic>?) ?? const [];
    final office = _selectNearestOffice(offices, _telemetry);

    final now = DateTime.now();
    final todayIso = DateFormat('yyyy-MM-dd').format(now);
    final selectedIso = DateFormat('yyyy-MM-dd').format(_selectedDate);
    final monday = now.subtract(Duration(days: now.weekday - 1));
    final weekDays = List.generate(7, (i) => monday.add(Duration(days: i)));

    Map<String, dynamic>? myTodayRecord;
    for (final raw in records) {
      final m = raw as Map<String, dynamic>;
      if (m['employee_id']?.toString() == widget.profile.employeeId &&
          m['attendance_date']?.toString() == todayIso) {
        myTodayRecord = m;
        break;
      }
    }

    final hasClockInToday = myTodayRecord?['clock_in_at'] != null;
    final hasClockOutToday = myTodayRecord?['clock_out_at'] != null;

    double? distanceMeters;
    if (office != null && _telemetry?.latitude != null && _telemetry?.longitude != null) {
      distanceMeters = calculateDistanceMeters(
        lat1: _telemetry!.latitude!,
        lng1: _telemetry!.longitude!,
        lat2: (office['latitude'] as num).toDouble(),
        lng2: (office['longitude'] as num).toDouble(),
      );
    }
    final withinRadius = office != null &&
        distanceMeters != null &&
        distanceMeters <= (office['radius_meters'] as num).toDouble();

    final filteredRecords = records.where((raw) {
      final rec = raw as Map<String, dynamic>;
      switch (_filter) {
        case _AttendanceFilter.selectedDay:
          return rec['attendance_date']?.toString() == selectedIso;
        case _AttendanceFilter.pending:
          return rec['approval_status']?.toString() == 'pending';
        case _AttendanceFilter.all:
          return true;
      }
    }).toList(growable: false);

    final shownCount = filteredRecords.length < _visibleCount ? filteredRecords.length : _visibleCount;
    final hasMore = shownCount < filteredRecords.length;

    final acc = _telemetry?.gpsAccuracyMeters;
    final gpsCoarse = acc != null && acc > 250;
    final gpsStatusText = _telemetry?.isMockedGps == true
        ? 'Mock GPS Terdeteksi'
        : _telemetry?.hasGps == true
            ? acc == null
                ? 'GPS Aktif'
                : acc <= 65
                    ? 'GPS Akurat (±${acc.round()} m)'
                    : acc <= 250
                        ? 'GPS Cukup (±${acc.round()} m)'
                        : 'GPS Perkiraan (±${formatDistanceId(acc)})'
            : 'GPS Otomatis';
    final deviceIpText = [
      _telemetry?.deviceLabel ?? 'Perangkat Aktif',
      if (_telemetry?.localIp != null) _telemetry!.localIp!,
    ].join(' · ');

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(filteredRecords.length);
        }
        return false;
      },
      child: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: 68,
                      child: Row(
                        children: [
                          for (final day in weekDays) ...[
                            Expanded(
                              child: _WeekDayPill(
                                day: day,
                                selected: DateFormat('yyyy-MM-dd').format(day) == selectedIso,
                                isToday: DateFormat('yyyy-MM-dd').format(day) == todayIso,
                                onTap: () => setState(() {
                                  _selectedDate = day;
                                  if (_filter == _AttendanceFilter.all) {
                                    _filter = _AttendanceFilter.selectedDay;
                                  }
                                  _visibleCount = _batchSize;
                                }),
                              ),
                            ),
                            if (day != weekDays.last) const SizedBox(width: 6),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    if (office != null && widget.profile.hasPermission('attendance', 'create')) ...[
                      ErpHeroCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        (office['name'] ?? 'Kantor').toString(),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                          color: Color(0xFFCCFBF1),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        hasClockOutToday
                                            ? 'Shift Hari Ini Selesai'
                                            : hasClockInToday
                                                ? 'Bertugas sejak ${formatShortDateTime(myTodayRecord?['clock_in_at']?.toString())}'
                                                : 'Belum Clock-In Hari Ini',
                                        style: const TextStyle(
                                          fontSize: 18,
                                          fontWeight: FontWeight.w700,
                                          color: Colors.white,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: 0.14),
                                    borderRadius: BorderRadius.circular(9999),
                                  ),
                                  child: Text(
                                    distanceMeters != null
                                        ? '${formatDistanceId(distanceMeters)} / ${office['radius_meters']} m'
                                        : 'Radius ${office['radius_meters']} m',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: withinRadius ? const Color(0xFF86EFAC) : Colors.white,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const _LiveAttendanceClock(),
                            const SizedBox(height: 12),

                            // Read-only background telemetry pills (GPS tappable to refresh, Device Info, IP Address)
                            Wrap(
                              spacing: 8,
                              runSpacing: 6,
                              children: [
                                _TelemetryPill(
                                  icon: _telemetry?.hasGps == true
                                      ? Icons.my_location
                                      : Icons.gps_fixed,
                                  label: gpsStatusText,
                                  warning: _telemetry?.isMockedGps == true || gpsCoarse,
                                  onTap: _busyAction ? null : _refreshTelemetry,
                                ),
                                _TelemetryPill(
                                  icon: Icons.smartphone_outlined,
                                  label: deviceIpText,
                                ),
                                if (_faceEnrolled != null)
                                  _TelemetryPill(
                                    icon: _faceEnrolled == true
                                        ? Icons.verified_user_outlined
                                        : Icons.face_retouching_natural,
                                    label: _faceEnrolled == true
                                        ? 'Wajah Terdaftar'
                                        : 'Daftar Wajah',
                                    warning: _faceEnrolled != true,
                                    onTap: _faceEnrolled == true || _busyAction
                                        ? null
                                        : _enrollFaceFromHero,
                                  ),
                              ],
                            ),
                            const SizedBox(height: 14),

                            // Verification method switch (Fingerprint / OS Biometric vs Front-Camera Face Scan)
                            Row(
                              children: [
                                Expanded(
                                  child: _ModeChoicePill(
                                    icon: Icons.fingerprint,
                                    label: _biometricButtonLabel(),
                                    selected: _verificationMode == _VerificationMode.biometric,
                                    onTap: _busyAction
                                        ? null
                                        : () => setState(
                                              () => _verificationMode = _VerificationMode.biometric,
                                            ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _ModeChoicePill(
                                    icon: Icons.face_retouching_natural,
                                    label: 'Scan Wajah',
                                    selected: _verificationMode == _VerificationMode.faceScan,
                                    onTap: _busyAction
                                        ? null
                                        : () => setState(
                                              () => _verificationMode = _VerificationMode.faceScan,
                                            ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),

                            // Unified single primary action button
                            FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: Colors.white,
                                foregroundColor: const Color(0xFF0B4F4A),
                                disabledBackgroundColor: Colors.white.withValues(alpha: 0.72),
                                disabledForegroundColor: const Color(0xFF0B4F4A),
                                minimumSize: const Size(double.infinity, 52),
                              ),
                              onPressed: _busyAction || hasClockOutToday
                                  ? null
                                  : () => _performUnifiedAttendance(
                                        isClockOut: hasClockInToday,
                                        office: office,
                                      ),
                              icon: _busyAction
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Color(0xFF0B4F4A),
                                      ),
                                    )
                                  : Icon(
                                      _verificationMode == _VerificationMode.biometric
                                          ? Icons.fingerprint
                                          : Icons.face_retouching_natural,
                                      size: 20,
                                    ),
                              label: Text(
                                _busyAction
                                    ? _busyLabel
                                    : hasClockOutToday
                                        ? 'Absensi Hari Ini Selesai'
                                        : hasClockInToday
                                            ? 'Absen Pulang Sekarang'
                                            : 'Absen Masuk Sekarang',
                                style: const TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ),
                            const SizedBox(height: 8),
                            OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.white,
                                side: BorderSide(color: Colors.white.withValues(alpha: 0.4)),
                                minimumSize: const Size(double.infinity, 44),
                              ),
                              onPressed: _busyAction ? null : _openLeaveSheet,
                              icon: const Icon(Icons.event_busy_outlined, size: 17),
                              label: const Text('Ajukan Izin / Sakit'),
                            ),
                            if (widget.profile.roleCode == 'owner') ...[
                              const SizedBox(height: 8),
                              OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.white,
                                  side: BorderSide(color: Colors.white.withValues(alpha: 0.32)),
                                  minimumSize: const Size(double.infinity, 44),
                                ),
                                onPressed: _busyAction
                                    ? null
                                    : () => context.push('/office-map-settings'),
                                icon: const Icon(Icons.edit_location_alt_outlined, size: 17),
                                label: const Text('Ubah Posisi Kantor (Maps)'),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    ErpFilterPillBar<_AttendanceFilter>(
                      selected: _filter,
                      onSelected: (val) => setState(() {
                        _filter = val;
                        _visibleCount = _batchSize;
                      }),
                      options: [
                        const ErpFilterPillOption(value: _AttendanceFilter.all, label: 'Semua'),
                        ErpFilterPillOption(
                          value: _AttendanceFilter.selectedDay,
                          label: DateFormat('dd MMM', 'id_ID').format(_selectedDate),
                        ),
                        if (widget.profile.hasPermission('attendance', 'approve'))
                          const ErpFilterPillOption(
                            value: _AttendanceFilter.pending,
                            label: 'Menunggu Approval',
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Riwayat Kehadiran (${filteredRecords.length})',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            if (filteredRecords.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Belum ada catatan absensi',
                    description: 'Ketuk Absen Masuk Sekarang atau ajukan izin/sakit.',
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverList.builder(
                  itemCount: shownCount + (hasMore ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownCount) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat riwayat absensi berikutnya...',
                      );
                    }
                    final rec = filteredRecords[index] as Map<String, dynamic>;
                    final status = (rec['status'] ?? '').toString();
                    final approval = (rec['approval_status'] ?? '').toString();
                    final canReview = widget.profile.hasPermission('attendance', 'approve') &&
                        approval == 'pending';
                    final method = _verificationMethodLabel(rec['clock_in_method']?.toString());
                    final dev = rec['clock_in_device'] is Map
                        ? Map<String, dynamic>.from(rec['clock_in_device'] as Map)
                        : null;
                    final model = dev?['model']?.toString();

                    final subtitleText = status == 'leave' || status == 'sick'
                        ? (rec['note'] ?? 'Pengajuan izin').toString()
                        : [
                            'In ${formatShortDateTime(rec['clock_in_at']?.toString())}',
                            if (method != '-') method,
                            if (model != null && model.trim().isNotEmpty) model,
                          ].join(' · ');

                    final card = ErpListRowCard(
                      leadingIcon: status == 'leave' || status == 'sick'
                          ? Icons.medical_services_outlined
                          : rec['clock_in_method'] == 'face_scan'
                              ? Icons.face_retouching_natural
                              : Icons.fingerprint,
                      leadingColor: approval == 'approved'
                          ? t.success
                          : approval == 'pending'
                              ? t.warning
                              : t.danger,
                      leadingBackground: approval == 'approved'
                          ? t.successSoft
                          : approval == 'pending'
                              ? t.warningSoft
                              : t.dangerSoft,
                      title: '${rec['employee_name']} (${rec['attendance_date']})',
                      subtitle: subtitleText,
                      trailing: ErpBadge(
                        label: '${status.toUpperCase()} ($approval)',
                        tone: approval == 'approved'
                            ? ErpBadgeTone.success
                            : approval == 'pending'
                                ? ErpBadgeTone.warning
                                : ErpBadgeTone.danger,
                      ),
                      onTap: () => _openRecordDetail(rec, canReview),
                    );

                    if (!canReview) {
                      return Padding(padding: const EdgeInsets.only(bottom: 8), child: card);
                    }

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Dismissible(
                        key: ValueKey(rec['id'].toString()),
                        background: Container(
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.only(left: 20),
                          decoration: BoxDecoration(
                            color: t.successSoft,
                            borderRadius: BorderRadius.circular(t.radiusLg),
                          ),
                          child: Text(
                            'APPROVE',
                            style: TextStyle(color: t.success, fontWeight: FontWeight.bold),
                          ),
                        ),
                        secondaryBackground: Container(
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.only(right: 20),
                          decoration: BoxDecoration(
                            color: t.dangerSoft,
                            borderRadius: BorderRadius.circular(t.radiusLg),
                          ),
                          child: Text(
                            'TOLAK',
                            style: TextStyle(color: t.danger, fontWeight: FontWeight.bold),
                          ),
                        ),
                        confirmDismiss: (dir) async {
                          HapticFeedback.mediumImpact();
                          final decision = dir == DismissDirection.startToEnd ? 'approved' : 'rejected';
                          await _decideRecord(rec['id'].toString(), decision);
                          return false;
                        },
                        child: card,
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TelemetryPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool warning;
  final VoidCallback? onTap;

  const _TelemetryPill({
    required this.icon,
    required this.label,
    this.warning = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(9999),
      side: BorderSide(
        color: warning ? const Color(0xFFFCA5A5) : Colors.white.withValues(alpha: 0.22),
      ),
    );
    return Material(
      color: warning
          ? const Color(0xFFDC2626).withValues(alpha: 0.35)
          : Colors.white.withValues(alpha: 0.12),
      shape: shape,
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: const Color(0xFFCCFBF1)),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModeChoicePill extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  const _ModeChoicePill({
    required this.icon,
    required this.label,
    required this.selected,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? Colors.white.withValues(alpha: 0.22) : Colors.white.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: selected ? Colors.white : Colors.white.withValues(alpha: 0.25),
          width: selected ? 1.4 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 17, color: Colors.white),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  final String label;
  final String value;

  const _DetailLine({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 124,
          child: Text(label, style: Theme.of(context).textTheme.bodySmall),
        ),
        Expanded(
          child: Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

class _WeekDayPill extends StatelessWidget {
  final DateTime day;
  final bool selected;
  final bool isToday;
  final VoidCallback onTap;

  const _WeekDayPill({
    required this.day,
    required this.selected,
    required this.isToday,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final dayName = DateFormat('E', 'id_ID').format(day);
    return Semantics(
      button: true,
      selected: selected,
      label: DateFormat('EEEE dd MMM', 'id_ID').format(day),
      child: Material(
        color: selected ? t.accent : t.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(t.radiusLg),
          side: BorderSide(
            color: selected ? t.accent : (isToday ? t.borderStrong : t.border),
            width: 1,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(t.radiusLg),
          onTap: onTap,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                dayName.substring(0, dayName.length >= 3 ? 3 : dayName.length),
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: selected ? t.onAccent : t.textSecondary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${day.day}',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: selected ? t.onAccent : t.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LeaveRequestSheet extends ConsumerStatefulWidget {
  final DateTime initialDate;

  const _LeaveRequestSheet({required this.initialDate});

  @override
  ConsumerState<_LeaveRequestSheet> createState() => _LeaveRequestSheetState();
}

class _LeaveRequestSheetState extends ConsumerState<_LeaveRequestSheet> {
  final _noteCtrl = TextEditingController();
  late DateTime _date;
  String _status = 'leave';
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _date = widget.initialDate;
  }

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_noteCtrl.text.trim().length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Isi alasan izin/sakit minimal 3 karakter.')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      await ref.read(apiClientProvider).submitLeaveRequest({
        'attendance_date': DateFormat('yyyy-MM-dd').format(_date),
        'status': _status,
        'note': _noteCtrl.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return ErpBottomSheetFrame(
      title: 'Ajukan Izin / Sakit',
      subtitle: 'Pengajuan diteruskan ke HR untuk persetujuan',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'leave', label: Text('Izin / Cuti')),
              ButtonSegment(value: 'sick', label: Text('Sakit')),
            ],
            selected: {_status},
            onSelectionChanged: (sel) => setState(() => _status = sel.first),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime.now().subtract(const Duration(days: 7)),
                lastDate: DateTime.now().add(const Duration(days: 90)),
              );
              if (picked != null && mounted) setState(() => _date = picked);
            },
            icon: Icon(Icons.calendar_today_outlined, size: 18, color: t.accent),
            label: Text('Tanggal: ${DateFormat('dd MMM yyyy', 'id_ID').format(_date)}'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _noteCtrl,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Keterangan / Alasan'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'Mengirim...' : 'Kirim Pengajuan'),
          ),
        ],
      ),
    );
  }
}

class _LiveAttendanceClock extends StatefulWidget {
  const _LiveAttendanceClock();

  @override
  State<_LiveAttendanceClock> createState() => _LiveAttendanceClockState();
}

class _LiveAttendanceClockState extends State<_LiveAttendanceClock> {
  late DateTime _now;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _now = DateTime.now();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() => _now = DateTime.now());
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final clockText = DateFormat('HH.mm.ss').format(_now);
    final dateText = DateFormat('EEEE, dd MMM yyyy', 'id_ID').format(_now);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule_rounded, color: Color(0xFFCCFBF1), size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 2,
              children: [
                Text(
                  clockText,
                  style: const TextStyle(
                    fontFamily: AppTheme.fontMono,
                    fontFeatures: [FontFeature.tabularFigures()],
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: Colors.white,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'WIB',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFFCCFBF1),
                    ),
                  ),
                ),
                Text(
                  dateText,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w500,
                    color: Color(0xFFCCFBF1),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
