import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

class DashboardScreen extends ConsumerWidget {
  final ErpProfile profile;

  const DashboardScreen({super.key, required this.profile});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EucalyptusTokens.of(context);
    final profileAsync = ref.watch(sessionProfileProvider);
    final pendingOffline = ref.watch(pendingOfflineCountProvider).valueOrNull ?? 0;

    if (profileAsync.isRefreshing) {
      return const DashboardSkeleton(label: 'Menyegarkan ringkasan MyEkalliptus...');
    }

    final firstName = profile.fullName.trim().isEmpty
        ? 'Rekan'
        : profile.fullName.trim().split(RegExp(r'\s+')).first;
    final todayLabel = DateFormat('EEEE, dd MMM yyyy', 'id_ID').format(DateTime.now());

    final quickActions = <Widget>[];
    if (profile.hasPermission('attendance', 'view')) {
      quickActions.add(
        Expanded(
          child: ErpQuickActionTile(
            icon: Icons.fingerprint,
            label: 'Absensi',
            onTap: () => context.go(ErpDestination.attendance.route),
          ),
        ),
      );
    }
    if (profile.hasPermission('finance', 'view')) {
      quickActions.add(
        Expanded(
          child: ErpQuickActionTile(
            icon: Icons.point_of_sale_outlined,
            label: 'Kasir',
            onTap: () => context.go(ErpDestination.finance.route),
          ),
        ),
      );
    }
    if (profile.hasPermission('inventory', 'view')) {
      quickActions.add(
        Expanded(
          child: ErpQuickActionTile(
            icon: Icons.inventory_2_outlined,
            label: 'Stok',
            onTap: () => context.go(ErpDestination.inventory.route),
          ),
        ),
      );
    }
    if (profile.hasPermission('payroll', 'view')) {
      quickActions.add(
        Expanded(
          child: ErpQuickActionTile(
            icon: Icons.receipt_long_outlined,
            label: 'Payroll',
            onTap: () => context.go(ErpDestination.payroll.route),
          ),
        ),
      );
    } else if (profile.hasPermission('rbac', 'view') || profile.hasPermission('audit', 'view')) {
      quickActions.add(
        Expanded(
          child: ErpQuickActionTile(
            icon: Icons.admin_panel_settings_outlined,
            label: 'Tim & Audit',
            onTap: () => context.go(ErpDestination.rbacAudit.route),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(sessionProfileProvider);
        ref.invalidate(pendingOfflineCountProvider);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 108),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Halo, $firstName',
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontSize: 22),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      todayLabel,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              ErpBadge(
                label: '${profile.permissions.length} izin aktif',
                tone: ErpBadgeTone.accent,
              ),
            ],
          ),

          const SizedBox(height: 14),

          if (pendingOffline > 0) ...[
            Card(
              color: t.warningSoft,
              child: ListTile(
                leading: Icon(Icons.cloud_off, color: t.warning),
                title: Text('$pendingOffline mutasi tersimpan offline'),
                subtitle: const Text('Ketuk untuk kirim ke server MyEkalliptus sekarang'),
                onTap: () async {
                  final res = await ref.read(offlineSyncServiceProvider).flush();
                  ref.invalidate(pendingOfflineCountProvider);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Terkirim ${res.syncedCount}, sisa ${res.remainingCount}.')),
                    );
                  }
                },
              ),
            ),
            const SizedBox(height: 14),
          ],

          // Primary hero card inspired by Finance / Sales mobile dashboards
          ErpHeroCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Expanded(
                      child: Text(
                        'Total Posisi Kas Aktif',
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
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF064E3B).withValues(alpha: 0.65),
                        borderRadius: BorderRadius.circular(9999),
                        border: Border.all(color: const Color(0xFF34D399).withValues(alpha: 0.35)),
                      ),
                      child: Text(
                        profile.roleName,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  profile.hasPermission('finance', 'view')
                      ? formatRupiah(profile.kpis.totalCashBalance)
                      : 'Terbatas RBAC (${profile.roleName})',
                  style: AppTheme.monoNumeric(
                    color: Colors.white,
                    fontSize: profile.hasPermission('finance', 'view') ? 28 : 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (profile.hasPermission('attendance', 'create'))
                      Expanded(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor: const Color(0xFF0B4F4A),
                            minimumSize: const Size(44, 44),
                          ),
                          onPressed: () => context.go(ErpDestination.attendance.route),
                          icon: const Icon(Icons.fingerprint, size: 18),
                          label: const Text('Absen GPS'),
                        ),
                      ),
                    if (profile.hasPermission('attendance', 'create') &&
                        profile.hasPermission('finance', 'view'))
                      const SizedBox(width: 10),
                    if (profile.hasPermission('finance', 'view'))
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: BorderSide(color: Colors.white.withValues(alpha: 0.4)),
                            minimumSize: const Size(44, 44),
                          ),
                          onPressed: () => context.go(ErpDestination.finance.route),
                          icon: const Icon(Icons.account_balance_wallet_outlined, size: 18),
                          label: const Text('Buka Kas'),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),

          if (quickActions.isNotEmpty) ...[
            const SizedBox(height: 16),
            const ErpSectionHeader(title: 'Akses Cepat'),
            const SizedBox(height: 8),
            Row(
              children: [
                for (var i = 0; i < quickActions.length; i++) ...[
                  if (i > 0) const SizedBox(width: 10),
                  quickActions[i],
                ],
              ],
            ),
          ],

          const SizedBox(height: 18),
          const ErpSectionHeader(title: 'Kondisi Operasional'),
          const SizedBox(height: 8),

          Row(
            children: [
              Expanded(
                child: Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(t.radiusLg),
                    onTap: profile.hasPermission('inventory', 'view')
                        ? () => context.go(ErpDestination.inventory.route)
                        : null,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 32,
                                height: 32,
                                decoration: BoxDecoration(
                                  color: t.warningSoft,
                                  borderRadius: BorderRadius.circular(t.radiusSm),
                                ),
                                alignment: Alignment.center,
                                child: Icon(Icons.inventory_2_outlined, size: 17, color: t.warning),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text('Stok Kritis', style: Theme.of(context).textTheme.bodySmall),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            '${profile.kpis.lowStockAlerts} item',
                            style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 20),
                          ),
                          const SizedBox(height: 8),
                          ErpBadge(
                            label: profile.kpis.lowStockAlerts > 0 ? 'Perlu Restock' : 'Aman',
                            tone: profile.kpis.lowStockAlerts > 0
                                ? ErpBadgeTone.warning
                                : ErpBadgeTone.success,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(t.radiusLg),
                    onTap: profile.hasPermission('attendance', 'view')
                        ? () => context.go(ErpDestination.attendance.route)
                        : null,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 32,
                                height: 32,
                                decoration: BoxDecoration(
                                  color: t.infoSoft,
                                  borderRadius: BorderRadius.circular(t.radiusSm),
                                ),
                                alignment: Alignment.center,
                                child: Icon(Icons.event_note_outlined, size: 17, color: t.info),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text('Izin Pending', style: Theme.of(context).textTheme.bodySmall),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            '${profile.kpis.pendingAttendanceApprovals} pengajuan',
                            style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 20),
                          ),
                          const SizedBox(height: 8),
                          ErpBadge(
                            label: profile.kpis.pendingAttendanceApprovals > 0
                                ? 'Tinjau HR'
                                : 'Bersih',
                            tone: profile.kpis.pendingAttendanceApprovals > 0
                                ? ErpBadgeTone.info
                                : ErpBadgeTone.success,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 18),
          const ErpSectionHeader(title: 'Modul Manajemen'),
          const SizedBox(height: 8),

          ErpListRowCard(
            leadingIcon: Icons.receipt_long_outlined,
            title: 'Payroll Run Draft',
            subtitle: '${profile.kpis.draftPayrollRuns} periode menunggu persetujuan',
            trailing: const Icon(Icons.chevron_right),
            onTap: profile.hasPermission('payroll', 'view')
                ? () => context.go(ErpDestination.payroll.route)
                : null,
          ),

          if (profile.hasPermission('rbac', 'view') || profile.hasPermission('audit', 'view')) ...[
            const SizedBox(height: 10),
            ErpListRowCard(
              leadingIcon: Icons.admin_panel_settings_outlined,
              title: 'Manajemen Akses & Audit Trail',
              subtitle: 'Kelola karyawan, kode aktivasi & log aktivitas',
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go(ErpDestination.rbacAudit.route),
            ),
          ],
        ],
      ),
    );
  }
}
