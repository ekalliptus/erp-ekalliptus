import 'dart:async';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/notifications/fcm_adapter.dart';
import '../../core/notifications/notification_models.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/app_update_dialog.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';
import '../common/theme_transition.dart';
import '../printer/printer_providers.dart';
import '../profile/profile_models.dart';
import '../profile/profile_screen.dart';

class FloatingNavShell extends ConsumerStatefulWidget {
  final ErpProfile profile;
  final String currentLocation;
  final StatefulNavigationShell? navigationShell;
  final Widget child;
  final VoidCallback? onOpenProfile;

  const FloatingNavShell({
    super.key,
    required this.profile,
    required this.currentLocation,
    this.navigationShell,
    required this.child,
    this.onOpenProfile,
  });

  @override
  ConsumerState<FloatingNavShell> createState() => _FloatingNavShellState();
}

class _FloatingNavShellState extends ConsumerState<FloatingNavShell> {
  bool _checkedUpdate = false;
  bool _checkingUpdateNow = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        syncFcmDeviceToken(ref);
        unawaited(_checkAppUpdate());
      }
    });
  }

  Future<void> _checkAppUpdate({bool force = false}) async {
    if (!force && _checkedUpdate) return;
    if (_checkingUpdateNow) return;
    _checkedUpdate = true;
    _checkingUpdateNow = true;
    try {
      final updateService = ref.read(appUpdateServiceProvider);
      final result = await updateService.checkForUpdate();
      if (!mounted) return;
      ref.read(latestUpdateCheckProvider.notifier).state = result;
      final latest = result.latest;
      if (!result.hasUpdate || latest == null) {
        if (force) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Aplikasi sudah versi terbaru (v${result.currentVersion}).'),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
        return;
      }
      if (!force && ref.read(dismissedUpdateBuildProvider) == latest.buildNumber) return;

      await showAppUpdateDialog(
        context,
        result: result,
        updateService: updateService,
        onLater: () {
          if (mounted) {
            ref.read(dismissedUpdateBuildProvider.notifier).state = latest.buildNumber;
          }
        },
        onUpdate: (url) => launchOrCopyUpdateUrl(context, updateService, url),
      );
    } catch (_) {
      if (force && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Gagal memeriksa pembaruan aplikasi.'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      _checkingUpdateNow = false;
    }
  }

  void _navigateToDestination(BuildContext context, ErpDestination dest) {
    final shell = widget.navigationShell;
    if (shell != null) {
      shell.goBranch(
        dest.index,
        initialLocation: widget.currentLocation.startsWith(dest.route),
      );
      return;
    }
    context.go(dest.route);
  }

  void _navigateToModuleName(BuildContext context, String module) {
    switch (module) {
      case 'finance':
        _navigateToDestination(context, ErpDestination.finance);
      case 'inventory':
        _navigateToDestination(context, ErpDestination.inventory);
      case 'attendance':
        _navigateToDestination(context, ErpDestination.attendance);
      case 'payroll':
        _navigateToDestination(context, ErpDestination.payroll);
      case 'rbac':
      case 'audit':
        _navigateToDestination(context, ErpDestination.rbacAudit);
      case 'printer':
        if (widget.profile.hasPermission('printer', 'view')) {
          final router = GoRouter.maybeOf(context);
          if (router != null) {
            router.push('/printer');
          }
        }
      case 'app_update':
        unawaited(_checkAppUpdate(force: true));
      default:
        _navigateToDestination(context, ErpDestination.dashboard);
    }
  }

  ErpDestination _activeDestination() {
    for (final dest in ErpDestination.values) {
      if (widget.currentLocation.startsWith(dest.route)) {
        return dest;
      }
    }
    return ErpDestination.dashboard;
  }

  IconData _iconFor(ErpDestination dest, {bool active = false}) {
    switch (dest) {
      case ErpDestination.dashboard:
        return active ? Icons.grid_view_rounded : Icons.grid_view_outlined;
      case ErpDestination.finance:
        return active ? Icons.point_of_sale : Icons.point_of_sale_outlined;
      case ErpDestination.inventory:
        return active ? Icons.inventory_2 : Icons.inventory_2_outlined;
      case ErpDestination.attendance:
        return Icons.fingerprint;
      case ErpDestination.payroll:
        return active ? Icons.receipt_long : Icons.receipt_long_outlined;
      case ErpDestination.rbacAudit:
        return active ? Icons.admin_panel_settings : Icons.admin_panel_settings_outlined;
    }
  }

  void _openQuickActionCenter(BuildContext context) {
    HapticFeedback.selectionClick();
    final t = EucalyptusTokens.of(context);
    final profile = widget.profile;
    final overflow = profile.overflowDestinations();
    final pendingPrintCount = profile.hasPermission('printer', 'view')
        ? (ref.read(pendingPrintApprovalCountProvider).valueOrNull ?? 0)
        : 0;

    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return ErpBottomSheetFrame(
          title: 'Aksi Cepat & Modul',
          subtitle: '${profile.fullName} · ${profile.roleName}',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (profile.hasPermission('attendance', 'create'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ErpListRowCard(
                    leadingIcon: Icons.my_location,
                    title: 'Clock-In / Clock-Out Cepat',
                    subtitle: 'Presensi geofence & pengajuan izin',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _navigateToDestination(context, ErpDestination.attendance);
                    },
                  ),
                ),
              if (profile.hasPermission('finance', 'create'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ErpListRowCard(
                    leadingIcon: Icons.point_of_sale_outlined,
                    title: 'Buka Kasir / POS',
                    subtitle: 'Penjualan kasir, scan barcode & struk digital',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _navigateToDestination(context, ErpDestination.finance);
                    },
                  ),
                ),
              if (profile.hasPermission('inventory', 'view'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ErpListRowCard(
                    leadingIcon: Icons.qr_code_scanner,
                    title: 'Stok & Scan Barcode',
                    subtitle: 'Cek gudang, cari SKU & mutasi unit',
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _navigateToDestination(context, ErpDestination.inventory);
                    },
                  ),
                ),
              if (profile.hasPermission('printer', 'view'))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ErpListRowCard(
                    leadingIcon: Icons.print_outlined,
                    title: 'Smart Printer',
                    subtitle: pendingPrintCount > 0
                        ? '$pendingPrintCount dokumen menunggu approval'
                        : 'Antrean cetak WA & HP Smart Tank 583',
                    trailing: pendingPrintCount > 0
                        ? ErpBadge(
                            label: '$pendingPrintCount',
                            tone: ErpBadgeTone.warning,
                          )
                        : const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      final router = GoRouter.maybeOf(context);
                      if (router != null) {
                        router.push('/printer');
                      }
                    },
                  ),
                ),
              ErpListRowCard(
                leadingIcon: Icons.sync,
                title: 'Sinkronisasi Antrean Offline',
                subtitle: 'Kirim mutasi offline Drift SQLite ke server',
                trailing: const Icon(Icons.chevron_right),
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
                const SizedBox(height: 16),
                Text('Modul Lainnya', style: Theme.of(ctx).textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final dest in overflow)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: ErpListRowCard(
                      leadingIcon: _iconFor(dest),
                      leadingColor: t.textPrimary,
                      title: dest.label,
                      subtitle: 'Buka modul ${dest.label}',
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () {
                        Navigator.of(ctx).pop();
                        _navigateToDestination(context, dest);
                      },
                    ),
                  ),
              ],
            ],
          ),
        );
      },
    );
  }

  void _openProfilePage(BuildContext context) {
    HapticFeedback.selectionClick();
    if (widget.onOpenProfile != null) {
      widget.onOpenProfile!();
      return;
    }
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      router.push('/profile');
    } else {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ProfileScreen(profile: widget.profile),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final profile = widget.profile;
    final activeDest = _activeDestination();
    final tabs = profile.primaryBottomTabs();
    final pendingCountAsync = ref.watch(pendingOfflineCountProvider);
    final pendingCount = pendingCountAsync.valueOrNull ?? 0;
    final pendingPrintCount = profile.hasPermission('printer', 'view')
        ? (ref.watch(pendingPrintApprovalCountProvider).valueOrNull ?? 0)
        : 0;
    final canAttendance = profile.hasPermission('attendance', 'view');

    final leftTabs = tabs.length >= 2
        ? tabs.sublist(0, (tabs.length / 2).ceil())
        : tabs;
    final rightTabs = tabs.length >= 2
        ? tabs.sublist((tabs.length / 2).ceil())
        : const <ErpDestination>[];
    final needsRightPadSlot = leftTabs.length > rightTabs.length;
    final isAttendanceActive = canAttendance && activeDest == ErpDestination.attendance;

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
                  Text(activeDest == ErpDestination.dashboard ? 'MyEkalliptus' : activeDest.label),
                  Text(
                    profile.username != null && profile.username!.isNotEmpty
                        ? '${profile.roleName} · @${profile.username}'
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
          IconButton(
            tooltip: 'Aksi Cepat & Modul Lainnya',
            onPressed: () => _openQuickActionCenter(context),
            icon: pendingPrintCount > 0
                ? Badge(
                    label: Text('$pendingPrintCount'),
                    child: const Icon(Icons.apps_rounded),
                  )
                : const Icon(Icons.apps_rounded),
          ),
          _NotificationsBellButton(
            onOpenModule: (module) => _navigateToModuleName(context, module),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Semantics(
                button: true,
                label: 'Buka profil & akun ${profile.fullName}',
                child: InkWell(
                  borderRadius: BorderRadius.circular(t.radiusPill),
                  onTap: () => _openProfilePage(context),
                  child: Container(
                    width: 44,
                    height: 44,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: t.accentSoft,
                      shape: BoxShape.circle,
                      border: Border.all(color: t.accent.withValues(alpha: 0.35)),
                    ),
                    alignment: Alignment.center,
                    child: (profile.avatarUrl != null && profile.avatarUrl!.isNotEmpty)
                        ? ClipOval(
                            child: Image.network(
                              profile.avatarUrl!,
                              key: ValueKey(profile.avatarObjectKey ?? profile.avatarUrl),
                              width: 44,
                              height: 44,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Text(
                                sanitizeInitials(profile.fullName),
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: t.accentHover,
                                ),
                              ),
                            ),
                          )
                        : Text(
                            sanitizeInitials(profile.fullName),
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: t.accentHover,
                            ),
                          ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          Positioned.fill(child: widget.child),
          Positioned.fill(
            child: _FcmForegroundListener(
              onOpenModule: (module) => _navigateToModuleName(context, module),
            ),
          ),
          Positioned(
            left: 14,
            right: 14,
            bottom: 12,
            child: SafeArea(
              top: false,
              child: Container(
                height: 68,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: t.surface,
                  borderRadius: BorderRadius.circular(t.radiusXl),
                  border: Border.all(color: t.borderStrong, width: 1),
                  boxShadow: Theme.of(context).brightness == Brightness.light
                      ? [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.06),
                            blurRadius: 14,
                            offset: const Offset(0, 4),
                          ),
                        ]
                      : null,
                ),
                child: Row(
                  children: [
                    for (final dest in leftTabs)
                      Expanded(
                        child: _FloatingNavButton(
                          icon: _iconFor(dest, active: activeDest == dest),
                          label: dest.label,
                          active: activeDest == dest,
                          onTap: () {
                            HapticFeedback.selectionClick();
                            _navigateToDestination(context, dest);
                          },
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Semantics(
                        button: true,
                        selected: isAttendanceActive,
                        label: canAttendance ? 'Absensi' : 'Aksi Cepat & Modul Lainnya',
                        child: Tooltip(
                          message: canAttendance ? 'Absensi' : 'Aksi Cepat & Modul Lainnya',
                          child: Material(
                            color: isAttendanceActive ? t.accentHover : t.accent,
                            shape: CircleBorder(
                              side: isAttendanceActive
                                  ? BorderSide(
                                      color: Colors.white.withValues(alpha: 0.72),
                                      width: 2,
                                    )
                                  : BorderSide.none,
                            ),
                            child: InkWell(
                              customBorder: const CircleBorder(),
                              onTap: () {
                                HapticFeedback.selectionClick();
                                if (canAttendance) {
                                  _navigateToDestination(context, ErpDestination.attendance);
                                } else {
                                  _openQuickActionCenter(context);
                                }
                              },
                              child: SizedBox(
                                width: 50,
                                height: 50,
                                child: Icon(
                                  canAttendance ? Icons.fingerprint : Icons.apps_rounded,
                                  color: t.onAccent,
                                  size: 28,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    for (final dest in rightTabs)
                      Expanded(
                        child: _FloatingNavButton(
                          icon: _iconFor(dest, active: activeDest == dest),
                          label: dest.label,
                          active: activeDest == dest,
                          onTap: () {
                            HapticFeedback.selectionClick();
                            _navigateToDestination(context, dest);
                          },
                        ),
                      ),
                    if (needsRightPadSlot)
                      Expanded(
                        child: _FloatingNavButton(
                          icon: Icons.apps_rounded,
                          label: 'Modul',
                          active: false,
                          onTap: () => _openQuickActionCenter(context),
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
    final fg = active ? t.accentHover : t.textSecondary;

    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(t.radiusLg),
        onTap: onTap,
        child: Container(
          height: 50,
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
  const _NotificationsBellButton({required this.onOpenModule});

  final void Function(String module) onOpenModule;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadAsync = ref.watch(unreadNotificationsProvider);
    final unread = unreadAsync.valueOrNull ?? 0;
    return IconButton(
      tooltip: 'Notifikasi',
      onPressed: () => _openNotificationsSheet(context, ref, onOpenModule),
      icon: unread > 0
          ? Badge(
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications_outlined),
            )
          : const Icon(Icons.notifications_outlined),
    );
  }
}

Future<void> _openNotificationsSheet(
  BuildContext context,
  WidgetRef ref,
  void Function(String module) onOpenModule,
) async {
  await showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return Consumer(
        builder: (ctx, sheetRef, _) {
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.62,
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
                  onNavigateModule: (module) {
                    Navigator.of(sheetContext).pop();
                    onOpenModule(module);
                  },
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
  const _NotificationsSheet({
    required this.controller,
    required this.ref,
    required this.onNavigateModule,
  });

  final ScrollController controller;
  final WidgetRef ref;
  final void Function(String module) onNavigateModule;

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
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final rows = await widget.ref.read(unreadNotificationsProvider.notifier).fetchEntries();
      if (mounted) {
        setState(() {
          entries = rows;
          loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = e.toString();
          loading = false;
        });
      }
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
              ? ShimmerScope(
                  child: ListView(
                    controller: widget.controller,
                    children: List.generate(
                      4,
                      (_) => const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: SkeletonBox(height: 68),
                      ),
                    ),
                  ),
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
                            return _NotificationCard(
                              entry: e,
                              tone: t,
                              onTap: () async {
                                if (e.isUnread) {
                                  try {
                                    await widget.ref
                                        .read(apiClientProvider)
                                        .markNotificationRead(e.id);
                                    widget.ref.invalidate(unreadNotificationsProvider);
                                  } catch (_) {
                                    // Best-effort mark read; still open module cleanly.
                                  }
                                }
                                if (mounted) {
                                  widget.onNavigateModule(e.module);
                                }
                              },
                            );
                          },
                        ),
        ),
      ],
    );
  }
}

String _notificationModuleLabel(String module) {
  switch (module) {
    case 'finance':
      return 'Kas';
    case 'inventory':
      return 'Stok';
    case 'attendance':
      return 'Absensi';
    case 'payroll':
      return 'Gaji';
    case 'printer':
      return 'Printer';
    case 'app_update':
      return 'Pembaruan';
    default:
      return module;
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({
    required this.entry,
    required this.tone,
    required this.onTap,
  });

  final NotificationEntry entry;
  final EucalyptusTokens tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(tone.radiusMd),
        side: BorderSide(color: entry.isUnread ? tone.accent : tone.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(tone.radiusMd),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (entry.isUnread)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: Icon(Icons.circle, size: 8, color: tone.accent),
                          ),
                        Expanded(
                          child: Text(
                            entry.title,
                            style: Theme.of(context).textTheme.titleSmall,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        ErpBadge(
                          label: _notificationModuleLabel(entry.module),
                          tone: entry.module == 'app_update'
                              ? ErpBadgeTone.accent
                              : ErpBadgeTone.neutral,
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      entry.body,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatRelativeTimeId(entry.createdAt),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(color: tone.textMuted),
                  ),
                  const SizedBox(height: 4),
                  Icon(Icons.chevron_right, size: 16, color: tone.textMuted),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FcmForegroundListener extends ConsumerStatefulWidget {
  const _FcmForegroundListener({required this.onOpenModule});

  final void Function(String module) onOpenModule;

  @override
  ConsumerState<_FcmForegroundListener> createState() => _FcmForegroundListenerState();
}

class _FcmForegroundListenerState extends ConsumerState<_FcmForegroundListener> {
  StreamSubscription<RemoteMessage>? _fgSub;
  StreamSubscription<RemoteMessage>? _openedSub;
  StreamSubscription<String>? _tokenSub;

  @override
  void initState() {
    super.initState();
    if (!FcmAdapter.isSupportedOnThisDevice) return;
    try {
      _fgSub = FcmAdapter.foregroundMessages.listen(_handleForegroundMessage);
      _openedSub = FcmAdapter.openedAppMessages.listen(_handleOpenedMessage);
      _tokenSub = FcmAdapter.tokenStream.listen((token) {
        final reg = ref.read(notificationRegistrationProvider);
        reg.updateToken(token);
        unawaited(reg.registerCurrentToken().catchError((_) {}));
      });
      unawaited(_checkInitialMessage());
    } catch (_) {
      // Abaikan listener FCM saat Firebase belum terinisialisasi (mis. widget test).
    }
  }

  Future<void> _checkInitialMessage() async {
    try {
      final initial = await FcmAdapter.getInitialMessage();
      if (!mounted || initial == null) return;
      _handleOpenedMessage(initial);
    } catch (_) {
      // Abaikan saat Firebase belum siap.
    }
  }

  Future<void> _refreshUpdateCheckState() async {
    try {
      final result = await ref.read(appUpdateServiceProvider).checkForUpdate();
      if (mounted) {
        ref.read(latestUpdateCheckProvider.notifier).state = result;
      }
    } catch (_) {
      // Opsional jika koneksi terputus.
    }
  }

  void _handleForegroundMessage(RemoteMessage message) {
    if (!mounted) return;
    ref.invalidate(unreadNotificationsProvider);
    final module = (message.data['module'] ?? '').toString().trim();
    if (module == 'app_update') {
      unawaited(_refreshUpdateCheckState());
    } else if (module == 'printer') {
      ref.invalidate(pendingPrintApprovalCountProvider);
      ref.invalidate(printerDashboardProvider);
    }
    final notification = message.notification;
    final title = notification?.title ?? (message.data['title']?.toString() ?? 'MyEkalliptus');
    final body = notification?.body ?? (message.data['body']?.toString() ?? '');
    if (notification == null && body.isEmpty) return;
    final text = body.isNotEmpty ? '$title: $body' : title;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis),
        behavior: SnackBarBehavior.floating,
        action: module.isNotEmpty
            ? SnackBarAction(
                label: module == 'app_update' ? 'Update' : 'Buka',
                onPressed: () => widget.onOpenModule(module),
              )
            : null,
      ),
    );
  }

  void _handleOpenedMessage(RemoteMessage message) {
    if (!mounted) return;
    ref.invalidate(unreadNotificationsProvider);
    final module = (message.data['module'] ?? '').toString().trim();
    if (module.isNotEmpty) {
      widget.onOpenModule(module);
    }
  }

  @override
  void dispose() {
    _fgSub?.cancel();
    _openedSub?.cancel();
    _tokenSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return const SizedBox.shrink();
  }
}
