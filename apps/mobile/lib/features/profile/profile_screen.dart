import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/attendance/face_recognition_service.dart';
import '../../core/config/app_config.dart';
import '../../core/permissions/permission_setup_service.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/updates/app_update_service.dart';
import '../../core/utils/formatters.dart';
import '../common/app_update_dialog.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';
import '../common/theme_transition.dart';
import 'profile_models.dart';
import 'profile_role_workspaces.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;
  final NavigateTabCallback? onNavigateTab;
  final PushRouteCallback? onPushRoute;

  const ProfileScreen({
    super.key,
    required this.profile,
    this.onNavigateTab,
    this.onPushRoute,
  });

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  static const Map<String, String> _moduleLabels = {
    'finance': 'Keuangan',
    'inventory': 'Inventaris',
    'attendance': 'Absensi',
    'payroll': 'Payroll',
    'rbac': 'RBAC & Tim',
    'audit': 'Audit Trail',
  };

  static const Map<String, String> _actionLabels = {
    'view': 'Lihat',
    'create': 'Tambah',
    'update': 'Ubah',
    'delete': 'Hapus',
    'approve': 'Setujui',
    'export': 'Ekspor',
  };

  bool _loading = true;
  bool _uploadingAvatar = false;
  bool _faceBusy = false;
  bool _showSalary = false;
  bool _checkingUpdate = false;
  int _observedVersion = 0;
  String? _error;
  ProfileSummaryData? _summary;
  PermissionSummary? _permSummary;
  InstalledAppVersion? _installedVersion;
  AppVersionCheckResult? _versionCheck;

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final permService = ref.read(permissionSetupServiceProvider);
      final updateService = ref.read(appUpdateServiceProvider);
      final results = await Future.wait<Object?>([
        api.fetchProfileSummary(),
        permService.inspectAll().then<PermissionSummary?>((v) => v).catchError((_) => null),
        updateService.getInstalledVersion().then<InstalledAppVersion?>((v) => v).catchError((_) => null),
        updateService.checkForUpdate().then<AppVersionCheckResult?>((v) => v).catchError((_) => null),
      ]);
      if (!mounted) return;
      final summaryJson = results[0] as Map<String, dynamic>;
      final perm = results[1] as PermissionSummary?;
      final installed = results[2] as InstalledAppVersion?;
      final versionCheck = results[3] as AppVersionCheckResult?;
      if (versionCheck != null) {
        ref.read(latestUpdateCheckProvider.notifier).state = versionCheck;
      }
      setState(() {
        _summary = ProfileSummaryData.fromJson(summaryJson);
        _permSummary = perm;
        _installedVersion = installed;
        _versionCheck = versionCheck;
        _loading = false;
      });
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _handleManualCheckUpdate() async {
    if (_checkingUpdate) return;
    setState(() => _checkingUpdate = true);
    try {
      final updateService = ref.read(appUpdateServiceProvider);
      final result = await updateService.checkForUpdate();
      if (!mounted) return;
      ref.read(latestUpdateCheckProvider.notifier).state = result;
      setState(() {
        _versionCheck = result;
        _checkingUpdate = false;
      });
      if (result.hasUpdate && result.latest != null) {
        await showAppUpdateDialog(
          context,
          result: result,
          updateService: updateService,
          onLater: () {
            if (mounted) {
              ref.read(dismissedUpdateBuildProvider.notifier).state = result.latest!.buildNumber;
            }
          },
          onUpdate: (url) => launchOrCopyUpdateUrl(context, updateService, url),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Aplikasi sudah menggunakan versi terbaru (v${result.currentVersion}).'),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        setState(() => _checkingUpdate = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal memeriksa pembaruan: $err')),
        );
      }
    }
  }

  Future<void> _openChangelogSheet(ProfileSummaryData summary) async {
    final updateService = ref.read(appUpdateServiceProvider);
    var check = _versionCheck;
    if (check == null) {
      setState(() => _checkingUpdate = true);
      try {
        check = await updateService.checkForUpdate();
        if (mounted) {
          ref.read(latestUpdateCheckProvider.notifier).state = check;
          setState(() {
            _versionCheck = check;
            _checkingUpdate = false;
          });
        }
      } catch (err) {
        if (mounted) {
          setState(() => _checkingUpdate = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Gagal memuat changelog: $err')),
          );
        }
        return;
      }
    }
    if (!mounted) return;
    await showAppChangelogSheet(
      context,
      currentVersion: check.currentVersion,
      currentBuild: check.currentBuild,
      releases: check.releases,
      canPublishRelease: summary.roleCode == 'owner',
      onPublishRelease: (payload) async {
        await updateService.publishRelease(payload);
        final refreshed = await updateService.checkForUpdate();
        if (mounted) {
          ref.read(latestUpdateCheckProvider.notifier).state = refreshed;
          setState(() => _versionCheck = refreshed);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Rilis baru berhasil dipublikasikan.')),
          );
        }
      },
    );
  }

  void _navigateToTab(String route) {
    if (widget.onNavigateTab != null) {
      widget.onNavigateTab!(route);
      return;
    }
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      router.go(route);
      return;
    }
    Navigator.of(context).maybePop();
  }

  void _pushSubRoute(String route) {
    if (widget.onPushRoute != null) {
      widget.onPushRoute!(route);
      return;
    }
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      router.push(route);
    }
  }

  Future<void> _openAvatarSheet(ProfileEmployeeDetail emp) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => ErpBottomSheetFrame(
        title: 'Foto Profil',
        subtitle: 'Foto disimpan aman di penyimpanan objek pribadi akun Anda.',
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ErpListRowCard(
              leadingIcon: Icons.photo_camera_outlined,
              title: 'Ambil dari Kamera',
              subtitle: 'Ambil foto profil baru langsung dari kamera perangkat',
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(ctx).pop('camera'),
            ),
            const SizedBox(height: 8),
            ErpListRowCard(
              leadingIcon: Icons.photo_library_outlined,
              title: 'Pilih dari Galeri',
              subtitle: 'Unggah gambar dari galeri ponsel Anda',
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(ctx).pop('gallery'),
            ),
            if (emp.avatarObjectKey != null) ...[
              const SizedBox(height: 8),
              ErpListRowCard(
                leadingIcon: Icons.delete_outline,
                leadingColor: EucalyptusTokens.of(ctx).danger,
                leadingBackground: EucalyptusTokens.of(ctx).dangerSoft,
                title: 'Hapus Foto Profil',
                subtitle: 'Kembali tampilkan inisial nama pada kartu profil',
                onTap: () => Navigator.of(ctx).pop('remove'),
              ),
            ],
          ],
        ),
      ),
    );

    if (choice == null || !mounted) return;
    if (choice == 'remove') {
      await _updateAvatarKey(null);
      return;
    }

    final picker = ImagePicker();
    final source = choice == 'camera' ? ImageSource.camera : ImageSource.gallery;
    final picked = await picker.pickImage(
      source: source,
      imageQuality: 85,
      maxWidth: 1024,
    );
    if (picked == null || !mounted) return;

    setState(() => _uploadingAvatar = true);
    try {
      final bytes = await picked.readAsBytes();
      final key = await ref.read(apiClientProvider).uploadObject(
            category: 'avatar',
            filename: picked.name.isNotEmpty ? picked.name : 'avatar.jpg',
            contentType: 'image/jpeg',
            bytes: bytes,
          );
      await _updateAvatarKey(key);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal mengunggah foto profil: $err')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _uploadingAvatar = false);
      }
    }
  }

  Future<void> _updateAvatarKey(String? objectKey) async {
    setState(() => _uploadingAvatar = true);
    try {
      await ref.read(apiClientProvider).updateMyProfile({
        'avatar_object_key': objectKey,
      });
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              objectKey == null ? 'Foto profil dihapus.' : 'Foto profil berhasil diperbarui.',
            ),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _uploadingAvatar = false);
      }
    }
  }

  Future<void> _openEditProfileSheet(ProfileEmployeeDetail emp) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _EditProfileSheet(employee: emp),
    );
    if (saved == true && mounted) {
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profil akun berhasil diperbarui.')),
        );
      }
    }
  }

  Future<void> _openSlipUrlSheet(PersonalPayrollSlip slip) async {
    try {
      final url = await ref.read(apiClientProvider).fetchPayrollSlipUrl(slip.itemId);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        useRootNavigator: true,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (ctx) {
          final t = EucalyptusTokens.of(ctx);
          return ErpBottomSheetFrame(
            title: 'Slip Gaji ${formatShortDate(slip.periodStart)} - ${formatShortDate(slip.periodEnd)}',
            subtitle: 'Tautan unduh resmi slip gaji PDF MyEkalliptus',
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
                      Text('Gaji Bersih', style: Theme.of(ctx).textTheme.bodySmall),
                      const SizedBox(height: 4),
                      Text(
                        formatRupiah(slip.netSalary),
                        style: AppTheme.monoNumeric(
                          color: t.textPrimary,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      SelectableText(
                        url,
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(ctx).pop(),
                        child: const Text('Tutup'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: url));
                          Navigator.of(ctx).pop();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Tautan slip PDF disalin ke clipboard.')),
                          );
                        },
                        icon: const Icon(Icons.copy, size: 18),
                        label: const Text('Salin Tautan'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      );
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    }
  }

  Future<void> _handleEnrollOrUpdateFace({required bool replace}) async {
    if (_faceBusy) return;
    HapticFeedback.selectionClick();
    setState(() => _faceBusy = true);
    try {
      final outcome = await ref.read(faceRecognitionServiceProvider).scanFace(
            mode: FaceScanMode.enroll,
            title: replace ? 'Perbarui Data Wajah' : 'Daftarkan Wajah (4 Tahap)',
          );
      if (!mounted) return;
      if (outcome.cancelled) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pemindaian wajah dibatalkan.')),
        );
        return;
      }
      if (outcome.descriptor.length != 192 || outcome.imageBytes == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Data wajah dari kamera belum lengkap. Coba lagi.')),
        );
        return;
      }
      final api = ref.read(apiClientProvider);
      final selfieKey = await api.uploadObject(
        category: 'selfie',
        filename: 'face-android-${DateTime.now().millisecondsSinceEpoch}.jpg',
        contentType: 'image/jpeg',
        bytes: outcome.imageBytes!,
      );
      await api.enrollFace(
        faceModel: 'mobile_facenet_192d',
        faceDescriptor: outcome.descriptor,
        faceSamples: outcome.samples.isNotEmpty ? outcome.samples : null,
        enrollmentPoses: outcome.poses.isNotEmpty ? outcome.poses : null,
        selfieObjectKey: selfieKey,
        replace: replace,
      );
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              replace
                  ? 'Data wajah berhasil diperbarui.'
                  : 'Wajah acuan berhasil didaftarkan.',
            ),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal memperbarui data wajah: $err')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _faceBusy = false);
      }
    }
  }

  Future<void> _handleDeleteFace() async {
    if (_faceBusy) return;
    final ok = await showErpConfirmDialog(
      context,
      title: 'Hapus Data Wajah?',
      message:
          'Data wajah yang terdaftar akan dihapus. Anda perlu mendaftar ulang sebelum absensi menggunakan scan wajah.',
      confirmLabel: 'Hapus Data Wajah',
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _faceBusy = true);
    try {
      await ref.read(apiClientProvider).deleteMyFace();
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Data wajah terdaftar telah dihapus.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal menghapus data wajah: $err')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _faceBusy = false);
      }
    }
  }

  Widget _buildFaceDataSection(BuildContext context, ProfileSummaryData summary) {
    final t = EucalyptusTokens.of(context);
    final face = summary.faceEnrollment;
    final platformNames = face.models
        .map((m) => m == 'mobile_facenet_192d' ? 'Android' : 'Web')
        .toList(growable: false);

    final badgeLabel = !face.enrolled
        ? 'Belum Terdaftar'
        : face.isMultiPose
            ? 'Terdaftar · ${face.sampleCount} Sudut'
            : 'Perlu Pembaruan';
    final badgeTone = !face.enrolled
        ? ErpBadgeTone.neutral
        : face.isMultiPose
            ? ErpBadgeTone.success
            : ErpBadgeTone.warning;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Data Wajah (Absensi)'),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: t.accentSoft,
                        borderRadius: BorderRadius.circular(t.radiusMd),
                        border: Border.all(color: t.border),
                      ),
                      clipBehavior: Clip.antiAlias,
                      alignment: Alignment.center,
                      child: (face.hasReferencePhoto && face.referencePhotoUrl != null)
                          ? LazyNetworkImage(
                              url: face.referencePhotoUrl!,
                              width: 56,
                              height: 56,
                              borderRadius: t.radiusMd,
                              fit: BoxFit.cover,
                            )
                          : Icon(
                              Icons.face_retouching_natural_outlined,
                              size: 26,
                              color: t.accent,
                            ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                face.enrolled ? 'Wajah Terdaftar' : 'Belum Ada Data Wajah',
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                              ErpBadge(label: badgeLabel, tone: badgeTone),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            face.enrolled
                                ? 'Terdaftar ${face.enrolledAt != null ? formatShortDateTime(face.enrolledAt) : ''}'
                                    '${platformNames.isNotEmpty ? ' · ${platformNames.join(', ')}' : ''}'
                                : 'Lakukan pemindaian 4 langkah untuk mengaktifkan absensi scan wajah.',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (face.enrolled && !face.isMultiPose) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: t.warningSoft,
                      borderRadius: BorderRadius.circular(t.radiusSm),
                      border: Border.all(color: t.warning.withValues(alpha: 0.4)),
                    ),
                    child: Text(
                      'Data wajah lama masih 1 sampel. Perbarui dengan scan 4 sudut agar absensi lebih akurat.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                if (face.enrolled)
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed:
                              _faceBusy ? null : () => _handleEnrollOrUpdateFace(replace: true),
                          icon: const Icon(Icons.refresh, size: 18),
                          label: Text(_faceBusy ? 'Memproses...' : 'Perbarui Wajah'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: t.danger,
                          side: BorderSide(color: t.danger.withValues(alpha: 0.45)),
                        ),
                        onPressed: _faceBusy ? null : _handleDeleteFace,
                        icon: const Icon(Icons.delete_outline, size: 18),
                        label: const Text('Hapus'),
                      ),
                    ],
                  )
                else
                  FilledButton.icon(
                    onPressed: _faceBusy ? null : () => _handleEnrollOrUpdateFace(replace: false),
                    icon: const Icon(Icons.face_retouching_natural, size: 18),
                    label: Text(_faceBusy ? 'Memproses...' : 'Daftarkan Wajah (4 Tahap)'),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHeroCard(BuildContext context, ProfileSummaryData summary) {
    final emp = summary.employee;
    final meta = ProfileRoleThemeMeta.forRole(summary.roleCode);
    final kpis = ProfileRoleThemeMeta.heroKpisFor(summary);
    final initials = sanitizeInitials(emp.fullName);

    return ErpHeroCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 68,
                height: 68,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFF042F2E),
                        border: Border.all(
                          color: const Color(0xFF34D399).withValues(alpha: 0.6),
                          width: 2,
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      alignment: Alignment.center,
                      child: _uploadingAvatar
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.2,
                                color: Colors.white,
                              ),
                            )
                          : (emp.avatarUrl != null
                              ? LazyNetworkImage(
                                  url: emp.avatarUrl!,
                                  width: 64,
                                  height: 64,
                                  borderRadius: 9999,
                                  fit: BoxFit.cover,
                                )
                              : Text(
                                  initials,
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.white,
                                  ),
                                )),
                    ),
                    Positioned(
                      right: -4,
                      bottom: -4,
                      child: Semantics(
                        button: true,
                        label: 'Ubah foto profil',
                        child: Material(
                          color: Colors.white,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: _uploadingAvatar ? null : () => _openAvatarSheet(emp),
                            child: const SizedBox(
                              width: 30,
                              height: 30,
                              child: Icon(
                                Icons.camera_alt_outlined,
                                size: 16,
                                color: Color(0xFF0B4F4A),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      emp.fullName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: AppTheme.fontDisplay,
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Icon(meta.icon, size: 15, color: const Color(0xFFCCFBF1)),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            meta.subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: Color(0xFFCCFBF1),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF042F2E).withValues(alpha: 0.65),
                            borderRadius: BorderRadius.circular(9999),
                            border: Border.all(
                              color: const Color(0xFF34D399).withValues(alpha: 0.45),
                            ),
                          ),
                          child: Text(
                            summary.roleName,
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF042F2E).withValues(alpha: 0.45),
                            borderRadius: BorderRadius.circular(9999),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.25)),
                          ),
                          child: Text(
                            emp.username != null
                                ? '${emp.employeeCode} · @${emp.username}'
                                : '${emp.employeeCode} · Tanpa username',
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF042F2E).withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
            ),
            child: Row(
              children: [
                for (var i = 0; i < kpis.length; i++) ...[
                  if (i > 0)
                    Container(
                      width: 1,
                      height: 30,
                      margin: const EdgeInsets.symmetric(horizontal: 6),
                      color: Colors.white.withValues(alpha: 0.18),
                    ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          kpis[i].label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: Color(0xFFCCFBF1),
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          kpis[i].value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTheme.monoNumeric(
                            color: Colors.white,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleWorkspaceSection(ProfileSummaryData summary) {
    switch (summary.roleWorkspace.kind) {
      case 'owner':
        return OwnerProfileWorkspace(
          summary: summary,
          onNavigateTab: _navigateToTab,
          onPushRoute: _pushSubRoute,
        );
      case 'finance':
        return FinanceProfileWorkspace(
          summary: summary,
          onNavigateTab: _navigateToTab,
        );
      case 'warehouse':
        return WarehouseProfileWorkspace(
          summary: summary,
          onNavigateTab: _navigateToTab,
        );
      case 'hr':
        return HrProfileWorkspace(
          summary: summary,
          onNavigateTab: _navigateToTab,
        );
      default:
        return StaffProfileWorkspace(
          summary: summary,
          onNavigateTab: _navigateToTab,
        );
    }
  }

  Widget _buildIdentityAndCompensationSection(BuildContext context, ProfileSummaryData summary) {
    final t = EucalyptusTokens.of(context);
    final emp = summary.employee;
    final att = summary.personalAttendance;
    final slips = summary.latestSlips;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ErpSectionHeader(
          title: 'Identitas & Kontak',
          actionLabel: 'Edit Profil',
          onAction: () => _openEditProfileSheet(emp),
        ),
        const SizedBox(height: 8),
        Card(
          child: Column(
            children: [
              _InfoRowTile(
                icon: Icons.mail_outline,
                label: 'Email Kerja',
                value: emp.email,
              ),
              Divider(height: 1, color: t.border),
              _InfoRowTile(
                icon: Icons.alternate_email,
                label: 'Username Login',
                value: emp.username != null ? '@${emp.username}' : 'Belum diatur',
              ),
              Divider(height: 1, color: t.border),
              _InfoRowTile(
                icon: Icons.phone_outlined,
                label: 'Nomor Telepon',
                value: emp.phone ?? 'Belum diisi',
              ),
              Divider(height: 1, color: t.border),
              _InfoRowTile(
                icon: Icons.calendar_today_outlined,
                label: 'Bergabung Sejak',
                value: formatShortDate(emp.createdAt),
              ),
              Divider(height: 1, color: t.border),
              _InfoRowTile(
                icon: Icons.verified_outlined,
                label: 'Status Akun',
                value: emp.isActive ? 'Aktif (${emp.employeeCode})' : 'Nonaktif',
              ),
            ],
          ),
        ),

        const SizedBox(height: 18),
        _buildFaceDataSection(context, summary),

        const SizedBox(height: 18),
        const ErpSectionHeader(title: 'Kompensasi & Slip Gaji Pribadi'),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: t.accentSoft,
                        borderRadius: BorderRadius.circular(t.radiusMd),
                      ),
                      child: Icon(Icons.payments_outlined, size: 20, color: t.accent),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Gaji Pokok Terdaftar', style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(height: 2),
                          Text(
                            _showSalary ? formatRupiah(emp.baseSalary) : 'Rp •••••••',
                            style: AppTheme.monoNumeric(
                              color: t.textPrimary,
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: _showSalary ? 'Sembunyikan nominal gaji' : 'Tampilkan nominal gaji',
                      onPressed: () => setState(() => _showSalary = !_showSalary),
                      icon: Icon(
                        _showSalary ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Divider(height: 1, color: t.border),
                const SizedBox(height: 10),
                if (slips.isEmpty)
                  Text(
                    'Belum ada slip gaji yang diterbitkan untuk akun Anda.',
                    style: Theme.of(context).textTheme.bodySmall,
                  )
                else
                  for (final slip in slips)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: Icons.description_outlined,
                        leadingColor: slip.hasPdf ? t.success : t.accent,
                        leadingBackground: slip.hasPdf ? t.successSoft : t.accentSoft,
                        title: '${formatShortDate(slip.periodStart)} - ${formatShortDate(slip.periodEnd)}',
                        subtitle:
                            'Status: ${slip.runStatus.toUpperCase()} · Bersih ${_showSalary ? formatRupiah(slip.netSalary) : 'Rp •••••••'}',
                        trailing: ErpBadge(
                          label: slip.hasPdf ? 'Slip PDF' : 'Lihat',
                          tone: slip.hasPdf ? ErpBadgeTone.success : ErpBadgeTone.accent,
                        ),
                        onTap: () => _openSlipUrlSheet(slip),
                      ),
                    ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 18),
        ErpSectionHeader(
          title: 'Rekap Kehadiran Pribadi (${att.daysWindow} Hari)',
          actionLabel: summary.hasPermission('attendance', 'view') ? 'Riwayat Lengkap' : null,
          onAction: summary.hasPermission('attendance', 'view')
              ? () => _navigateToTab('/attendance')
              : null,
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _MiniStatChip(label: 'Hadir', value: '${att.presentDays} hr'),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MiniStatChip(label: 'Telat', value: '${att.lateDays} hr'),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MiniStatChip(
                label: 'Izin/Sakit',
                value: '${att.leaveDays + att.sickDays} hr',
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MiniStatChip(label: 'Lembur', value: '${att.totalOvertimeMinutes}m'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (att.recentRecords.isEmpty)
          ErpEmptyCard(
            title: 'Belum ada catatan absensi ${att.daysWindow} hari terakhir',
            description: 'Lakukan Clock-In di menu Absensi saat mulai shift.',
            actionLabel: summary.hasPermission('attendance', 'view') ? 'Buka Absensi' : null,
            onAction: summary.hasPermission('attendance', 'view')
                ? () => _navigateToTab('/attendance')
                : null,
          )
        else
          for (final rec in att.recentRecords.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.access_time_rounded,
                leadingColor: rec.status == 'late'
                    ? t.warning
                    : rec.status == 'present'
                        ? t.success
                        : t.info,
                leadingBackground: rec.status == 'late'
                    ? t.warningSoft
                    : rec.status == 'present'
                        ? t.successSoft
                        : t.infoSoft,
                title: '${formatShortDate(rec.attendanceDate)} · ${rec.officeName ?? 'Lokasi Kantor'}',
                subtitle:
                    'Masuk ${formatShortDateTime(rec.clockInAt)} · Pulang ${formatShortDateTime(rec.clockOutAt)}',
                trailing: ErpBadge(
                  label: rec.status.toUpperCase(),
                  tone: rec.status == 'late'
                      ? ErpBadgeTone.warning
                      : rec.status == 'present'
                          ? ErpBadgeTone.success
                          : ErpBadgeTone.info,
                ),
              ),
            ),
      ],
    );
  }

  Widget _buildRbacMatrixSection(BuildContext context, ProfileSummaryData summary) {
    final t = EucalyptusTokens.of(context);
    final modules = _moduleLabels.keys.toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ErpSectionHeader(
          title: 'Matriks Hak Akses Role (${summary.permissions.length} / 36 Izin)',
          actionLabel: summary.roleCode == 'owner' ? 'Kelola RBAC' : null,
          onAction: summary.roleCode == 'owner' ? () => _navigateToTab('/rbac-audit') : null,
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (summary.roleDescription.isNotEmpty) ...[
                  Text(summary.roleDescription, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 12),
                ],
                for (var i = 0; i < modules.length; i++) ...[
                  if (i > 0) ...[
                    const SizedBox(height: 10),
                    Divider(height: 1, color: t.border),
                    const SizedBox(height: 10),
                  ],
                  _buildModulePermissionRow(context, summary, modules[i]),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildModulePermissionRow(
    BuildContext context,
    ProfileSummaryData summary,
    String module,
  ) {
    final t = EucalyptusTokens.of(context);
    final grantedActions = _actionLabels.entries
        .where((e) => summary.hasPermission(module, e.key))
        .map((e) => e.value)
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                _moduleLabels[module] ?? module,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                  color: t.textPrimary,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              grantedActions.isEmpty ? 'Tidak ada akses' : '${grantedActions.length} izin',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        if (grantedActions.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final actionLabel in grantedActions)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: t.accentSoft,
                    borderRadius: BorderRadius.circular(t.radiusPill),
                  ),
                  child: Text(
                    actionLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: t.accentHover,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildDeviceSecuritySection(BuildContext context, ProfileSummaryData summary) {
    final t = EucalyptusTokens.of(context);
    final pendingCount = ref.watch(pendingOfflineCountProvider).valueOrNull ?? 0;
    final currentThemeMode = ref.watch(themeModeProvider);
    final perm = _permSummary;
    final sec = summary.security;

    String permSubtitle = 'Lokasi GPS, kamera, notifikasi & kesiapan biometrik';
    String permBadgeLabel = 'Cek Sensor';
    ErpBadgeTone permBadgeTone = ErpBadgeTone.neutral;
    if (perm != null) {
      if (!perm.preciseLocation && perm.location == AppPermissionStatus.granted) {
        permSubtitle = 'Lokasi hanya perkiraan; ubah ke Tepat (Precise) di setelan HP';
        permBadgeLabel = 'Lokasi Perkiraan';
        permBadgeTone = ErpBadgeTone.warning;
      } else {
        permBadgeLabel = '${perm.readyCount} / 4 Siap';
        permBadgeTone = perm.allEssentialGranted ? ErpBadgeTone.success : ErpBadgeTone.warning;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Perangkat, Sensor, Tema & Keamanan'),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.verified_user_outlined,
          title: 'Izin Perangkat & Sensor',
          subtitle: permSubtitle,
          trailing: ErpBadge(label: permBadgeLabel, tone: permBadgeTone),
          onTap: () => _pushSubRoute('/permissions'),
        ),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.sync,
          leadingColor: pendingCount > 0 ? t.warning : t.success,
          leadingBackground: pendingCount > 0 ? t.warningSoft : t.successSoft,
          title: 'Antrean Sinkronisasi Offline',
          subtitle: pendingCount > 0
              ? '$pendingCount transaksi menunggu dikirim ke server'
              : 'Semua data lokal tersinkronisasi penuh',
          trailing: ErpBadge(
            label: pendingCount > 0 ? '$pendingCount tertunda' : 'Bersih',
            tone: pendingCount > 0 ? ErpBadgeTone.warning : ErpBadgeTone.success,
          ),
          onTap: () async {
            final res = await ref.read(offlineSyncServiceProvider).flush();
            ref.invalidate(pendingOfflineCountProvider);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Sinkronisasi selesai: ${res.syncedCount} terkirim, ${res.remainingCount} tersisa.',
                  ),
                ),
              );
            }
          },
        ),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.notifications_active_outlined,
          title: 'Perangkat Push & Notifikasi',
          subtitle:
              '${sec.flutterDevices} Android · ${sec.webDevices} Web · ${sec.unreadNotifications} notifikasi belum dibaca',
          trailing: ErpBadge(
            label: '${sec.registeredDevicesCount} perangkat',
            tone: ErpBadgeTone.info,
          ),
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Tampilan Aplikasi', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'Pilih tema warna yang paling nyaman untuk mata Anda.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _ThemeChoiceChip(
                      label: 'Sistem',
                      selected: currentThemeMode == ThemeMode.system,
                      onTap: (ctx) => _applyThemeChoice(ctx, ThemeMode.system),
                    ),
                    const SizedBox(width: 8),
                    _ThemeChoiceChip(
                      label: 'Terang',
                      selected: currentThemeMode == ThemeMode.light,
                      onTap: (ctx) => _applyThemeChoice(ctx, ThemeMode.light),
                    ),
                    const SizedBox(width: 8),
                    _ThemeChoiceChip(
                      label: 'Gelap',
                      selected: currentThemeMode == ThemeMode.dark,
                      onTap: (ctx) => _applyThemeChoice(ctx, ThemeMode.dark),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Builder(
          builder: (context) {
            final check = _versionCheck ?? ref.watch(latestUpdateCheckProvider);
            final currentVer = check?.currentVersion ?? _installedVersion?.version ?? AppConfig.appVersion;
            final currentBld = check?.currentBuild ?? _installedVersion?.buildNumber ?? AppConfig.appBuildNumber;
            final hasUpd = check?.hasUpdate == true && check?.latest != null;
            final latestVer = check?.latest?.version;
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Versi Aplikasi & Pembaruan',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        const SizedBox(width: 8),
                        ErpBadge(
                          label: hasUpd && latestVer != null
                              ? 'Update v$latestVer'
                              : 'Versi Terbaru',
                          tone: hasUpd ? ErpBadgeTone.warning : ErpBadgeTone.success,
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'MyEkalliptus Android · v$currentVer (Build $currentBld)',
                      style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 13),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      hasUpd && check?.latest != null
                          ? 'Pembaruan v${check!.latest!.version} tersedia: ${check.latest!.title}'
                          : 'Lihat catatan rilis atau periksa pembaruan aplikasi terbaru.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _checkingUpdate ? null : () => _openChangelogSheet(summary),
                            icon: const Icon(Icons.history_edu_outlined, size: 18),
                            label: const Text('Changelog'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: _checkingUpdate ? null : _handleManualCheckUpdate,
                            icon: Icon(
                              hasUpd ? Icons.download_rounded : Icons.system_update_alt_rounded,
                              size: 18,
                            ),
                            label: Text(_checkingUpdate ? 'Memeriksa...' : 'Cek Update'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 16),
        const ErpSectionHeader(title: 'Aktivitas Terbaru Saya'),
        const SizedBox(height: 8),
        if (sec.recentAuditActions.isEmpty)
          const ErpEmptyCard(
            title: 'Belum ada aktivitas audit pribadi',
            description: 'Tindakan perubahan data atau persetujuan Anda akan tercatat di sini.',
          )
        else
          for (final act in sec.recentAuditActions.take(5))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.history_rounded,
                leadingColor: act.platform == 'flutter' ? t.info : t.accent,
                leadingBackground: act.platform == 'flutter' ? t.infoSoft : t.accentSoft,
                title: '${act.module.toUpperCase()} · ${act.action}',
                subtitle: () {
                  final dt = DateTime.tryParse(act.createdAt ?? '');
                  return dt != null
                      ? formatRelativeTimeId(dt)
                      : formatShortDateTime(act.createdAt);
                }(),
                trailing: ErpBadge(
                  label: formatPlatformLabel(act.platform),
                  tone: act.platform == 'flutter' ? ErpBadgeTone.info : ErpBadgeTone.accent,
                ),
              ),
            ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: t.danger,
            minimumSize: const Size(double.infinity, 48),
            side: BorderSide(color: t.danger.withValues(alpha: 0.5)),
          ),
          onPressed: () async {
            final ok = await showErpConfirmDialog(
              context,
              title: 'Keluar dari MyEkalliptus?',
              message: 'Sesi lokal dan registrasi push perangkat ini akan diakhiri.',
              confirmLabel: 'Keluar Sekarang',
              destructive: true,
            );
            if (!ok || !context.mounted) return;
            await performCleanSignOut(ref);
            if (context.mounted) {
              _navigateToTab('/login');
            }
          },
          icon: const Icon(Icons.logout_outlined),
          label: const Text('Keluar dari Akun'),
        ),
      ],
    );
  }

  void _applyThemeChoice(BuildContext chipContext, ThemeMode nextMode) {
    final currentBrightness = Theme.of(context).brightness;
    final platformIsDark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    final targetIsDark = nextMode == ThemeMode.system ? platformIsDark : nextMode == ThemeMode.dark;
    final box = chipContext.findRenderObject() as RenderBox?;
    final origin = box != null && box.hasSize
        ? box.localToGlobal(box.size.center(Offset.zero))
        : MediaQuery.sizeOf(context).center(Offset.zero);
    final host = ThemeRevealHost.maybeOf(context);
    void commit() {
      ref.read(themeModeProvider.notifier).state = nextMode;
    }

    if (host != null && (currentBrightness == Brightness.dark) != targetIsDark) {
      host.toggleTheme(origin: origin, onCommitTheme: commit);
    } else {
      commit();
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(erpDataVersionProvider, (prev, next) {
      if (next != _observedVersion && mounted) {
        _observedVersion = next;
        _load();
      }
    });

    final summary = _summary;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profil & Ruang Kerja'),
        actions: [
          IconButton(
            tooltip: 'Muat ulang profil',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
          const Padding(
            padding: EdgeInsets.only(right: 12),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: _loading
            ? const ProfileSkeleton()
            : _error != null || summary == null
                ? Padding(
                    padding: const EdgeInsets.all(20),
                    child: ErpErrorCard(
                      message: _error ?? 'Profil gagal dimuat.',
                      onRetry: _load,
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 36),
                      children: [
                        _buildHeroCard(context, summary),
                        const SizedBox(height: 18),
                        _buildRoleWorkspaceSection(summary),
                        const SizedBox(height: 20),
                        _buildIdentityAndCompensationSection(context, summary),
                        const SizedBox(height: 20),
                        _buildRbacMatrixSection(context, summary),
                        const SizedBox(height: 20),
                        _buildDeviceSecuritySection(context, summary),
                      ],
                    ),
                  ),
      ),
    );
  }
}

class _InfoRowTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRowTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Icon(icon, size: 18, color: t.textSecondary),
          const SizedBox(width: 12),
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          const SizedBox(width: 10),
          Flexible(
            flex: 2,
            child: Text(
              value,
              textAlign: TextAlign.end,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: t.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStatChip extends StatelessWidget {
  final String label;
  final String value;

  const _MiniStatChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        child: Column(
          children: [
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 13.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThemeChoiceChip extends StatelessWidget {
  final String label;
  final bool selected;
  final dynamic onTap;

  const _ThemeChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Expanded(
      child: Material(
        color: selected ? t.accent : t.surfaceSubtle,
        borderRadius: BorderRadius.circular(t.radiusMd),
        child: InkWell(
          borderRadius: BorderRadius.circular(t.radiusMd),
          onTap: () {
            if (onTap is void Function(BuildContext)) {
              (onTap as void Function(BuildContext))(context);
            } else if (onTap is VoidCallback) {
              (onTap as VoidCallback)();
            }
          },
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(t.radiusMd),
              border: Border.all(
                color: selected ? t.accent : t.border,
                width: 1,
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: selected ? t.onAccent : t.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EditProfileSheet extends ConsumerStatefulWidget {
  final ProfileEmployeeDetail employee;

  const _EditProfileSheet({required this.employee});

  @override
  ConsumerState<_EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends ConsumerState<_EditProfileSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _usernameCtrl;
  late final TextEditingController _phoneCtrl;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.employee.fullName);
    _usernameCtrl = TextEditingController(text: widget.employee.username ?? '');
    _phoneCtrl = TextEditingController(text: widget.employee.phone ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _usernameCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameCtrl.text.trim();
    final rawUsername = _usernameCtrl.text.trim().toLowerCase();
    final phone = _phoneCtrl.text.trim();

    if (name.length < 2) {
      setState(() => _error = 'Nama lengkap minimal 2 karakter.');
      return;
    }
    if (rawUsername.isNotEmpty && !RegExp(r'^[a-z0-9_.]{3,24}$').hasMatch(rawUsername)) {
      setState(() => _error = 'Format username: 3-24 huruf kecil, angka, titik, atau garis bawah.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(apiClientProvider).updateMyProfile({
        'full_name': name,
        'username': rawUsername.isEmpty ? null : rawUsername,
        'phone': phone.isEmpty ? null : phone,
      });
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = err.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return ErpBottomSheetFrame(
      title: 'Edit Profil Akun',
      subtitle: widget.employee.email,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(labelText: 'Nama Lengkap'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _usernameCtrl,
            decoration: const InputDecoration(
              labelText: 'Username Login',
              hintText: 'contoh: alul.studio',
              helperText: '3-24 karakter: huruf kecil, angka, titik, garis bawah',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phoneCtrl,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Nomor Telepon',
              hintText: '08xxxxxxxxxx',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: TextStyle(fontSize: 12.5, color: t.danger, fontWeight: FontWeight.w500),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: Text(_saving ? 'Menyimpan...' : 'Simpan Perubahan'),
          ),
        ],
      ),
    );
  }
}
