import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

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
  Timer? _moreTimer;
  String? _error;
  Map<String, dynamic>? _data;
  double? _lat;
  double? _lng;
  String? _selfieKey;
  String? _qrToken;
  bool _busyAction = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    super.dispose();
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
      if (mounted) {
        setState(() {
          _data = res;
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

  Future<void> _captureGps() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Izin lokasi ditolak di perangkat ini.')),
          );
        }
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      if (mounted) {
        setState(() {
          _lat = pos.latitude;
          _lng = pos.longitude;
        });
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal membaca GPS: $err')),
        );
      }
    }
  }

  Future<void> _captureSelfie() async {
    final picker = ImagePicker();
    final photo = await picker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.front,
    );
    if (photo == null) return;
    setState(() => _busyAction = true);
    try {
      final bytes = await photo.readAsBytes();
      final key = await ref.read(apiClientProvider).uploadObject(
            category: 'selfie',
            filename: photo.name,
            contentType: 'image/jpeg',
            bytes: bytes,
          );
      if (mounted) setState(() => _selfieKey = key);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload selfie gagal: $err')),
        );
      }
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<void> _performClockIn(Map<String, dynamic> office) async {
    if (_lat == null || _lng == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ambil GPS perangkat terlebih dahulu.')),
      );
      return;
    }
    if (_selfieKey == null && (_qrToken == null || _qrToken!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ambil selfie atau scan QR kantor terlebih dahulu.')),
      );
      return;
    }

    HapticFeedback.mediumImpact();
    setState(() => _busyAction = true);
    final payload = {
      'office_id': office['id'].toString(),
      'latitude': _lat,
      'longitude': _lng,
      'selfie_object_key': _selfieKey,
      'qr_token': _qrToken,
    };

    try {
      await ref.read(apiClientProvider).clockIn(payload);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Clock-in berhasil tercatat.')),
        );
      }
    } catch (err) {
      await ref.read(offlineSyncServiceProvider).enqueueMutation(
            endpoint: '/api/attendance/clock-in',
            method: 'POST',
            payload: payload,
          );
      ref.invalidate(pendingOfflineCountProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Disimpan ke antrean offline ($err).')),
        );
      }
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
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
    final office = offices.isNotEmpty ? offices.first as Map<String, dynamic> : null;
    final shownCount = records.length < _visibleCount ? records.length : _visibleCount;
    final hasMore = shownCount < records.length;

    double? distanceMeters;
    if (office != null && _lat != null && _lng != null) {
      distanceMeters = calculateDistanceMeters(
        lat1: _lat!,
        lng1: _lng!,
        lat2: (office['latitude'] as num).toDouble(),
        lng2: (office['longitude'] as num).toDouble(),
      );
    }

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(records.length);
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
                    if (office != null && widget.profile.hasPermission('attendance', 'create')) ...[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      (office['name'] ?? 'Kantor').toString(),
                                      style: Theme.of(context).textTheme.titleMedium,
                                    ),
                                  ),
                                  ErpBadge(
                                    label: distanceMeters != null
                                        ? '${distanceMeters.round()}m / ${office['radius_meters']}m'
                                        : 'Radius ${office['radius_meters']}m',
                                    tone: distanceMeters != null &&
                                            distanceMeters <= (office['radius_meters'] as num).toDouble()
                                        ? ErpBadgeTone.success
                                        : ErpBadgeTone.info,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: _busyAction ? null : _captureGps,
                                    icon: const Icon(Icons.my_location, size: 18),
                                    label: Text(_lat == null ? 'Ambil GPS' : 'GPS Aktif'),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: _busyAction ? null : _captureSelfie,
                                    icon: const Icon(Icons.camera_front_outlined, size: 18),
                                    label: Text(_selfieKey == null ? 'Foto Selfie' : 'Selfie Siap'),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: _busyAction
                                        ? null
                                        : () async {
                                            final qr = await showBarcodeScannerSheet(
                                              context,
                                              title: 'Scan QR Kantor',
                                            );
                                            if (qr != null && mounted) {
                                              setState(() => _qrToken = qr);
                                            }
                                          },
                                    icon: const Icon(Icons.qr_code, size: 18),
                                    label: Text(_qrToken == null ? 'Scan QR' : 'QR Siap'),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 14),
                              Row(
                                children: [
                                  Expanded(
                                    child: FilledButton(
                                      onPressed: _busyAction ? null : () => _performClockIn(office),
                                      child: const Text('Clock-In'),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: _busyAction
                                          ? null
                                          : () async {
                                              final messenger = ScaffoldMessenger.of(context);
                                              setState(() => _busyAction = true);
                                              try {
                                                await ref.read(apiClientProvider).clockOut({
                                                  'latitude': _lat,
                                                  'longitude': _lng,
                                                });
                                                await _load();
                                              } catch (err) {
                                                if (mounted) {
                                                  messenger.showSnackBar(
                                                    SnackBar(content: Text(err.toString())),
                                                  );
                                                }
                                              } finally {
                                                if (mounted) setState(() => _busyAction = false);
                                              }
                                            },
                                      child: const Text('Clock-Out'),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    Text('Riwayat Kehadiran', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            if (records.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Belum ada catatan absensi',
                    description: 'Lakukan clock-in pertama Anda dengan GPS dan selfie/QR kantor.',
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverList.builder(
                  itemCount: shownCount + (hasMore ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownCount) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat riwayat absensi berikutnya...',
                      );
                    }
                    final rec = records[index] as Map<String, dynamic>;
                    final status = (rec['status'] ?? '').toString();
                    final approval = (rec['approval_status'] ?? '').toString();
                    final card = Card(
                      child: ListTile(
                        title: Text('${rec['employee_name']} (${rec['attendance_date']})'),
                        subtitle: Text(
                          'In: ${formatShortDateTime(rec['clock_in_at']?.toString())} | Out: ${formatShortDateTime(rec['clock_out_at']?.toString())}',
                        ),
                        trailing: ErpBadge(
                          label: '${status.toUpperCase()} ($approval)',
                          tone: approval == 'approved'
                              ? ErpBadgeTone.success
                              : approval == 'pending'
                                  ? ErpBadgeTone.warning
                                  : ErpBadgeTone.danger,
                        ),
                      ),
                    );

                    if (!widget.profile.hasPermission('attendance', 'approve') ||
                        approval != 'pending') {
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
                          await ref.read(apiClientProvider).approveAttendance(rec['id'].toString(), decision);
                          await _load();
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
