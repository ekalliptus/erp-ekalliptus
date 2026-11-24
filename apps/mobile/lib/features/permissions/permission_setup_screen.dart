import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/permissions/permission_setup_service.dart';
import '../../core/providers/app_providers.dart';
import '../../core/security/biometric_guard.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../common/erp_widgets.dart';
import '../common/theme_transition.dart';

class PermissionSetupScreen extends ConsumerStatefulWidget {
  final String? nextRoute;
  final VoidCallback? onCompleted;

  const PermissionSetupScreen({
    super.key,
    this.nextRoute,
    this.onCompleted,
  });

  @override
  ConsumerState<PermissionSetupScreen> createState() => _PermissionSetupScreenState();
}

class _PermissionSetupScreenState extends ConsumerState<PermissionSetupScreen>
    with WidgetsBindingObserver {
  PermissionSummary? _summary;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refresh();
    }
  }

  Future<void> _refresh() async {
    try {
      final summary = await ref.read(permissionSetupServiceProvider).inspectAll();
      if (mounted) {
        setState(() {
          _summary = summary;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _runAction(Future<PermissionSummary> Function() runner) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final updated = await runner();
      if (!mounted) return;
      setState(() => _summary = updated);
      if (updated.notifications == AppPermissionStatus.granted) {
        syncFcmDeviceToken(ref);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _finish() async {
    await ref.read(permissionSetupServiceProvider).markOnboardingCompleted();
    if (!mounted) return;
    if (widget.onCompleted != null) {
      widget.onCompleted!();
      return;
    }
    if (widget.nextRoute != null) {
      context.go(widget.nextRoute!);
      return;
    }
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    } else {
      context.go('/dashboard');
    }
  }

  Future<void> _grantAllAndContinue() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final service = ref.read(permissionSetupServiceProvider);
      final updated = await service.requestAllEssential();
      if (!mounted) return;
      setState(() => _summary = updated);
      if (updated.notifications == AppPermissionStatus.granted) {
        syncFcmDeviceToken(ref);
      }
      if (updated.allEssentialGranted) {
        await _finish();
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Sebagian izin masih nonaktif. Ketuk kartu izin terkait atau buka Pengaturan Android.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Widget _buildPermissionCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required String badgeLabel,
    required ErpBadgeTone badgeTone,
    required bool ready,
    VoidCallback? onTap,
  }) {
    final t = EucalyptusTokens.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ErpListRowCard(
        leadingIcon: icon,
        leadingColor: ready ? t.success : (badgeTone == ErpBadgeTone.danger ? t.danger : t.accent),
        leadingBackground:
            ready ? t.successSoft : (badgeTone == ErpBadgeTone.danger ? t.dangerSoft : t.accentSoft),
        title: title,
        subtitle: subtitle,
        trailing: ErpBadge(label: badgeLabel, tone: badgeTone),
        onTap: onTap,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final summary = _summary;
    final service = ref.read(permissionSetupServiceProvider);

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: widget.nextRoute == null,
        title: const Text('Izin Perangkat'),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 12),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
        ],
      ),
      body: _loading || summary == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _refresh,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
                      children: [
                        ErpHeroCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  const Expanded(
                                    child: Text(
                                      'Kesiapan Perangkat MyEkalliptus',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                        color: Color(0xFFCCFBF1),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Container(
                                    padding:
                                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.16),
                                      borderRadius: BorderRadius.circular(9999),
                                    ),
                                    child: Text(
                                      '${summary.readyCount} / 4 Siap',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              const Text(
                                'Aktifkan Izin Perangkat',
                                style: TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                ),
                              ),
                              const SizedBox(height: 6),
                              const Text(
                                'Agar absensi 1-ketuk (sidik jari/scan wajah + GPS otomatis), foto struk kas, dan notifikasi real-time berjalan lancar.',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  color: Color(0xFFCCFBF1),
                                ),
                              ),
                              const SizedBox(height: 14),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(9999),
                                child: LinearProgressIndicator(
                                  value: summary.readyCount / 4,
                                  minHeight: 8,
                                  backgroundColor: Colors.white.withValues(alpha: 0.18),
                                  valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 18),
                        const ErpSectionHeader(title: 'Daftar Izin & Sensor'),
                        const SizedBox(height: 8),

                        // 1. Lokasi & GPS
                        _buildPermissionCard(
                          context,
                          icon: Icons.my_location,
                          title: 'Lokasi & GPS',
                          subtitle: summary.location == AppPermissionStatus.granted &&
                                  !summary.locationServiceEnabled
                              ? 'Izin diberikan, tetapi GPS perangkat sedang mati. Ketuk untuk menyalakan.'
                              : summary.location == AppPermissionStatus.granted &&
                                      !summary.preciseLocation
                                  ? 'Hanya izin Perkiraan yang aktif (bisa meleset ribuan meter). Ketuk untuk mengaktifkan Lokasi Akurat (Precise).'
                                  : summary.location == AppPermissionStatus.permanentlyDenied
                                      ? 'Izin lokasi ditolak permanen. Ketuk untuk membuka Pengaturan Android.'
                                      : summary.location == AppPermissionStatus.granted
                                          ? 'Lokasi akurat siap membaca koordinat geofence kantor saat absen.'
                                          : 'Ketuk untuk mengizinkan akses lokasi presensi geofence.',
                          badgeLabel: summary.location == AppPermissionStatus.granted
                              ? (!summary.locationServiceEnabled
                                  ? 'GPS Mati'
                                  : !summary.preciseLocation
                                      ? 'Perkiraan'
                                      : 'Siap')
                              : summary.location == AppPermissionStatus.permanentlyDenied
                                  ? 'Pengaturan'
                                  : 'Izinkan',
                          badgeTone: summary.location == AppPermissionStatus.granted
                              ? (summary.locationServiceEnabled && summary.preciseLocation
                                  ? ErpBadgeTone.success
                                  : ErpBadgeTone.warning)
                              : summary.location == AppPermissionStatus.permanentlyDenied
                                  ? ErpBadgeTone.danger
                                  : ErpBadgeTone.warning,
                          ready: summary.location == AppPermissionStatus.granted &&
                              summary.preciseLocation &&
                              summary.locationServiceEnabled,
                          onTap: _busy
                              ? null
                              : () {
                                  if (summary.location == AppPermissionStatus.granted &&
                                      !summary.locationServiceEnabled) {
                                    service.openLocationSettings();
                                  } else if (summary.location ==
                                          AppPermissionStatus.permanentlyDenied ||
                                      (summary.location == AppPermissionStatus.granted &&
                                          !summary.preciseLocation)) {
                                    service.openAppSettings();
                                  } else {
                                    _runAction(service.requestLocation);
                                  }
                                },
                        ),

                        // 2. Kamera
                        _buildPermissionCard(
                          context,
                          icon: Icons.camera_alt_outlined,
                          title: 'Kamera',
                          subtitle: summary.camera == AppPermissionStatus.permanentlyDenied
                              ? 'Izin kamera ditolak permanen. Ketuk untuk membuka Pengaturan Android.'
                              : summary.camera == AppPermissionStatus.granted
                                  ? 'Siap untuk scan wajah absensi, barcode SKU, dan foto struk.'
                                  : 'Ketuk untuk mengizinkan kamera depan & belakang.',
                          badgeLabel: summary.camera == AppPermissionStatus.granted
                              ? 'Siap'
                              : summary.camera == AppPermissionStatus.permanentlyDenied
                                  ? 'Pengaturan'
                                  : 'Izinkan',
                          badgeTone: summary.camera == AppPermissionStatus.granted
                              ? ErpBadgeTone.success
                              : summary.camera == AppPermissionStatus.permanentlyDenied
                                  ? ErpBadgeTone.danger
                                  : ErpBadgeTone.warning,
                          ready: summary.camera == AppPermissionStatus.granted,
                          onTap: _busy
                              ? null
                              : () {
                                  if (summary.camera == AppPermissionStatus.permanentlyDenied) {
                                    service.openAppSettings();
                                  } else {
                                    _runAction(service.requestCamera);
                                  }
                                },
                        ),

                        // 3. Notifikasi Push
                        _buildPermissionCard(
                          context,
                          icon: Icons.notifications_active_outlined,
                          title: 'Notifikasi Push',
                          subtitle: summary.notifications == AppPermissionStatus.permanentlyDenied
                              ? 'Izin notifikasi nonaktif permanen. Ketuk untuk membuka Pengaturan.'
                              : summary.notifications == AppPermissionStatus.granted
                                  ? 'Siap menerima info approval izin, mutasi kas, dan stok kritis.'
                                  : 'Ketuk untuk mengaktifkan peringatan penting operasional.',
                          badgeLabel: summary.notifications == AppPermissionStatus.granted
                              ? 'Siap'
                              : summary.notifications == AppPermissionStatus.permanentlyDenied
                                  ? 'Pengaturan'
                                  : 'Izinkan',
                          badgeTone: summary.notifications == AppPermissionStatus.granted
                              ? ErpBadgeTone.success
                              : summary.notifications == AppPermissionStatus.permanentlyDenied
                                  ? ErpBadgeTone.danger
                                  : ErpBadgeTone.warning,
                          ready: summary.notifications == AppPermissionStatus.granted,
                          onTap: _busy
                              ? null
                              : () {
                                  if (summary.notifications ==
                                      AppPermissionStatus.permanentlyDenied) {
                                    service.openAppSettings();
                                  } else {
                                    _runAction(service.requestNotifications);
                                  }
                                },
                        ),

                        // 4. Biometrik HP
                        _buildPermissionCard(
                          context,
                          icon: Icons.fingerprint,
                          title: 'Biometrik HP',
                          subtitle: summary.biometricReady
                              ? 'Sensor terdeteksi siap untuk buka modul keuangan, payroll & absen 1-ketuk.'
                              : 'Belum terdaftar di perangkat. Ketuk untuk atur sidik jari/wajah (opsional).',
                          badgeLabel: switch (summary.biometric) {
                            BiometricCapability.fingerprint => 'Sidik Jari Siap',
                            BiometricCapability.face => 'Face Unlock Siap',
                            BiometricCapability.strongBiometric => 'Biometrik Siap',
                            BiometricCapability.deviceCredentialOnly ||
                            BiometricCapability.unavailable =>
                              'Opsional',
                          },
                          badgeTone: summary.biometricReady
                              ? ErpBadgeTone.success
                              : ErpBadgeTone.neutral,
                          ready: summary.biometricReady,
                          onTap: _busy || summary.biometricReady
                              ? null
                              : () => service.openBiometricSettings(),
                        ),
                      ],
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  decoration: BoxDecoration(
                    color: t.surface,
                    border: Border(top: BorderSide(color: t.border, width: 1)),
                  ),
                  child: SafeArea(
                    top: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        FilledButton.icon(
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(double.infinity, 52),
                          ),
                          onPressed: _busy
                              ? null
                              : summary.allEssentialGranted
                                  ? _finish
                                  : _grantAllAndContinue,
                          icon: Icon(
                            summary.allEssentialGranted
                                ? Icons.check_circle_outline
                                : Icons.verified_user_outlined,
                            size: 20,
                          ),
                          label: Text(
                            _busy
                                ? 'Memproses Izin...'
                                : summary.allEssentialGranted
                                    ? (widget.nextRoute != null
                                        ? 'Lanjut ke MyEkalliptus'
                                        : 'Selesai')
                                    : 'Izinkan Semua & Lanjut',
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: _busy ? null : () => service.openAppSettings(),
                                icon: const Icon(Icons.settings_outlined, size: 18),
                                label: const Text('Pengaturan Android'),
                              ),
                            ),
                            if (widget.nextRoute != null) ...[
                              const SizedBox(width: 8),
                              TextButton(
                                style: TextButton.styleFrom(
                                  minimumSize: const Size(44, 48),
                                  padding: const EdgeInsets.symmetric(horizontal: 14),
                                ),
                                onPressed: _busy ? null : _finish,
                                child: const Text('Lewati Nanti'),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
