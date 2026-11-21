import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../common/erp_widgets.dart';
import '../common/theme_transition.dart';

class FloatingNavShell extends ConsumerWidget {
  final ErpProfile profile;
  final String currentLocation;
  final Widget child;

  const FloatingNavShell({
    super.key,
    required this.profile,
    required this.currentLocation,
    required this.child,
  });

  IconData _iconFor(ErpDestination dest) {
    switch (dest) {
      case ErpDestination.dashboard:
        return Icons.grid_view_rounded;
      case ErpDestination.finance:
        return Icons.account_balance_wallet_outlined;
      case ErpDestination.inventory:
        return Icons.inventory_2_outlined;
      case ErpDestination.attendance:
        return Icons.fingerprint;
      case ErpDestination.payroll:
        return Icons.receipt_long_outlined;
      case ErpDestination.rbacAudit:
        return Icons.admin_panel_settings_outlined;
    }
  }

  void _openQuickActionCenter(BuildContext context, WidgetRef ref) {
    HapticFeedback.selectionClick();
    final t = EucalyptusTokens.of(context);
    final overflow = profile.overflowDestinations();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: t.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(t.radiusXl)),
        side: BorderSide(color: t.border, width: 1),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.48,
          minChildSize: 0.35,
          maxChildSize: 0.85,
          builder: (_, scrollCtrl) {
            return ListView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 14),
                    decoration: BoxDecoration(
                      color: t.borderStrong,
                      borderRadius: BorderRadius.circular(t.radiusPill),
                    ),
                  ),
                ),
                Text('Quick Action Center', style: Theme.of(ctx).textTheme.titleLarge),
                const SizedBox(height: 4),
                Text(
                  '${profile.fullName} (${profile.roleName})',
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
                if (profile.hasPermission('attendance', 'create'))
                  ListTile(
                    leading: Icon(Icons.my_location, color: t.accent),
                    title: const Text('Clock-In / Clock-Out Cepat'),
                    subtitle: const Text('Ambil GPS & selfie presensi hari ini'),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      context.go(ErpDestination.attendance.route);
                    },
                  ),
                if (profile.hasPermission('finance', 'create'))
                  ListTile(
                    leading: Icon(Icons.add_card, color: t.accent),
                    title: const Text('Catat Transaksi Keuangan'),
                    subtitle: const Text('Pemasukan, pengeluaran + struk kamera'),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      context.go(ErpDestination.finance.route);
                    },
                  ),
                if (profile.hasPermission('inventory', 'view'))
                  ListTile(
                    leading: Icon(Icons.qr_code_scanner, color: t.accent),
                    title: const Text('Stok & Scan Barcode'),
                    subtitle: const Text('Periksa saldo gudang dan mutasi SKU'),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      context.go(ErpDestination.inventory.route);
                    },
                  ),
                ListTile(
                  leading: Icon(Icons.sync, color: t.accent),
                  title: const Text('Sinkronisasi Antrean Offline'),
                  subtitle: const Text('Kirim mutasi offline Drift SQLite ke server'),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    final result = await ref.read(offlineSyncServiceProvider).flush();
                    ref.invalidate(pendingOfflineCountProvider);
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Sinkronisasi selesai: ${result.syncedCount} terkirim, ${result.remainingCount} tersisa.',
                          ),
                        ),
                      );
                    }
                  },
                ),
                if (overflow.isNotEmpty) ...[
                  Divider(color: t.border),
                  const SizedBox(height: 6),
                  Text('Modul Tambahan', style: Theme.of(ctx).textTheme.titleMedium),
                  const SizedBox(height: 6),
                  for (final dest in overflow)
                    ListTile(
                      leading: Icon(_iconFor(dest), color: t.textPrimary),
                      title: Text(dest.label),
                      onTap: () {
                        Navigator.of(ctx).pop();
                        context.go(dest.route);
                      },
                    ),
                ],
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EucalyptusTokens.of(context);
    final tabs = profile.primaryBottomTabs();
    final pendingCountAsync = ref.watch(pendingOfflineCountProvider);
    final pendingCount = pendingCountAsync.valueOrNull ?? 0;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            const MyEkalliptusLogo(size: 32),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('MyEkalliptus'),
                  Text(
                    '${profile.roleName} (${profile.employeeCode})',
                    style: Theme.of(context).textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          if (pendingCount > 0)
            IconButton(
              tooltip: 'Antrean offline ($pendingCount)',
              onPressed: () async {
                final res = await ref.read(offlineSyncServiceProvider).flush();
                ref.invalidate(pendingOfflineCountProvider);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Terkirim ${res.syncedCount}, sisa ${res.remainingCount}.')),
                  );
                }
              },
              icon: Badge(
                label: Text('$pendingCount'),
                child: const Icon(Icons.cloud_upload_outlined),
              ),
            ),
          IconButton(
            tooltip: 'Quick Action Center',
            onPressed: () => _openQuickActionCenter(context, ref),
            icon: const Icon(Icons.bolt_outlined),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
          IconButton(
            tooltip: 'Keluar',
            onPressed: () async {
              await ref.read(authServiceProvider).signOut();
              ref.invalidate(sessionProfileProvider);
              if (context.mounted) context.go('/login');
            },
            icon: const Icon(Icons.logout_outlined),
          ),
        ],
      ),
      body: Stack(
        children: [
          Positioned.fill(child: child),
          Positioned(
            left: 14,
            right: 14,
            bottom: 14,
            child: SafeArea(
              top: false,
              child: Container(
                height: 64,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                decoration: BoxDecoration(
                  color: t.surface,
                  borderRadius: BorderRadius.circular(t.radiusXl),
                  border: Border.all(color: t.borderStrong, width: 1),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    for (final dest in tabs)
                      Expanded(
                        child: _FloatingNavButton(
                          icon: _iconFor(dest),
                          label: dest.label,
                          active: currentLocation.startsWith(dest.route),
                          onTap: () {
                            HapticFeedback.selectionClick();
                            context.go(dest.route);
                          },
                        ),
                      ),
                    SizedBox(
                      width: 52,
                      child: IconButton(
                        tooltip: 'Menu cepat & modul lainnya',
                        onPressed: () => _openQuickActionCenter(context, ref),
                        icon: Icon(Icons.apps_rounded, color: t.accent),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FloatingNavButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _FloatingNavButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fg = active
        ? (isDark ? t.accentHover : t.accentHover)
        : t.textSecondary;

    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(t.radiusLg),
        onTap: onTap,
        child: Container(
          height: 48,
          margin: const EdgeInsets.symmetric(horizontal: 2),
          decoration: BoxDecoration(
            color: active ? t.accentSoft : Colors.transparent,
            borderRadius: BorderRadius.circular(t.radiusLg),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 20, color: fg),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
