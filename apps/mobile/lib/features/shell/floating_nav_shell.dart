import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:go_router/go_router.dart';
import '../../core/notifications/fcm_adapter.dart';
import '../../core/notifications/notification_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';
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
                    profile.username != null && profile.username!.isNotEmpty
                        ? '${profile.roleName} (${profile.employeeCode}) · @${profile.username}'
                        : '${profile.roleName} (${profile.employeeCode})',
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
          const _NotificationsBellButton(),
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
          const Positioned.fill(child: _FcmForegroundListener()),
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

class _NotificationsBellButton extends ConsumerWidget {
  const _NotificationsBellButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadAsync = ref.watch(unreadNotificationsProvider);
    final unread = unreadAsync.valueOrNull ?? 0;
    return IconButton(
      tooltip: 'Notifikasi',
      onPressed: () => _openNotificationsSheet(context, ref),
      icon: unread > 0
          ? Badge(
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications_outlined),
            )
          : const Icon(Icons.notifications_outlined),
    );
  }
}

Future<void> _openNotificationsSheet(BuildContext context, WidgetRef ref) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return Consumer(
        builder: (ctx, sheetRef, _) {
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.6,
            minChildSize: 0.4,
            maxChildSize: 0.9,
            builder: (bCtx, scrollController) {
              return Container(
                decoration: BoxDecoration(
                  color: Theme.of(bCtx).colorScheme.surface,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                ),
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: _NotificationsSheet(
                  controller: scrollController,
                  ref: sheetRef,
                ),
              );
            },
          );
        },
      );
    },
  );
  if (context.mounted) {
    ref.invalidate(unreadNotificationsProvider);
  }
}

class _NotificationsSheet extends ConsumerStatefulWidget {
  const _NotificationsSheet({required this.controller, required this.ref});
  final ScrollController controller;
  final WidgetRef ref;

  @override
  ConsumerState<_NotificationsSheet> createState() => _NotificationsSheetState();
}

class _NotificationsSheetState extends ConsumerState<_NotificationsSheet> {
  List<NotificationEntry>? entries;
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final rows = await widget.ref.read(unreadNotificationsProvider.notifier).fetchEntries();
      if (mounted) setState(() { entries = rows; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = e.toString(); loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: Text('Notifikasi', style: Theme.of(context).textTheme.titleMedium)),
            TextButton(
              onPressed: () async {
                await widget.ref.read(unreadNotificationsProvider.notifier).markAllRead();
                await _load();
              },
              child: const Text('Tandai dibaca'),
            ),
          ],
        ),
        Expanded(
          child: loading
              ? ListView(
                  controller: widget.controller,
                  children: List.generate(3, (_) => const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: SkeletonBox(height: 64),
                  )),
                )
              : error != null
                  ? ErpErrorCard(message: 'Gagal memuat notifikasi.', onRetry: _load)
                  : (entries == null || entries!.isEmpty)
                      ? const ErpEmptyCard(
                          title: 'Belum ada notifikasi',
                          description: 'Aktivitas modul yang relevan akan muncul di sini.',
                        )
                      : ListView.builder(
                          controller: widget.controller,
                          itemCount: entries!.length,
                          itemBuilder: (ctx, i) {
                            final e = entries![i];
                            return _NotificationCard(entry: e, tone: t);
                          },
                        ),
        ),
      ],
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.entry, required this.tone});

  final NotificationEntry entry;
  final EucalyptusTokens tone;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(tone.radiusMd),
        side: BorderSide(color: entry.isUnread ? tone.accent : tone.border),
      ),
      child: ListTile(
        dense: true,
        title: Row(
          children: [
            if (entry.isUnread)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Icon(Icons.circle, size: 8, color: tone.accent),
              ),
            Expanded(child: Text(entry.title, style: Theme.of(context).textTheme.titleSmall)),
            ErpBadge(
              label: entry.module,
              tone: ErpBadgeTone.neutral,
            ),
          ],
        ),
        subtitle: Text(
          entry.body,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Text(
          entry.createdAt.toLocal().toString().substring(0, 16),
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ),
    );
  }
}

class _FcmForegroundListener extends ConsumerStatefulWidget {
  const _FcmForegroundListener();

  @override
  ConsumerState<_FcmForegroundListener> createState() => _FcmForegroundListenerState();
}

class _FcmForegroundListenerState extends ConsumerState<_FcmForegroundListener> {
  StreamSubscription<RemoteMessage>? _sub;

  @override
  void initState() {
    super.initState();
    if (!FcmAdapter.isSupportedOnThisDevice) return;
    _sub = FcmAdapter.foregroundMessages.listen((message) {
      if (!mounted) return;
      ref.invalidate(unreadNotificationsProvider);
      final notification = message.notification;
      if (notification == null) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${notification.title ?? "MyEkalliptus"}: ${notification.body}'),
        behavior: SnackBarBehavior.floating,
      ));
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return const SizedBox.shrink();
  }
}
