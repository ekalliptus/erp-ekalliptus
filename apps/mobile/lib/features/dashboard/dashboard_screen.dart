import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(sessionProfileProvider);
        ref.invalidate(pendingOfflineCountProvider);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [
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
            const SizedBox(height: 12),
          ],

          // Primary cash hierarchy card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Total Posisi Kas Aktif', style: Theme.of(context).textTheme.bodySmall),
                      ErpBadge(
                        label: '${profile.permissions.length} izin aktif',
                        tone: ErpBadgeTone.accent,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    profile.hasPermission('finance', 'view')
                        ? formatRupiah(profile.kpis.totalCashBalance)
                        : 'Terbatas RBAC',
                    style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 26),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (profile.hasPermission('attendance', 'create'))
                        FilledButton.icon(
                          onPressed: () => context.go(ErpDestination.attendance.route),
                          icon: const Icon(Icons.fingerprint, size: 18),
                          label: const Text('Absen GPS'),
                        ),
                      if (profile.hasPermission('finance', 'view'))
                        OutlinedButton.icon(
                          onPressed: () => context.go(ErpDestination.finance.route),
                          icon: const Icon(Icons.account_balance_wallet_outlined, size: 18),
                          label: const Text('Keuangan'),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 14),

          // Alert & approval vertical stack matching asymmetric hierarchy
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
                          Text('Stok Kritis', style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(height: 6),
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
                          Text('Izin Pending', style: Theme.of(context).textTheme.bodySmall),
                          const SizedBox(height: 6),
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

          const SizedBox(height: 14),

          Card(
            child: ListTile(
              title: const Text('Payroll Run Draft'),
              subtitle: Text('${profile.kpis.draftPayrollRuns} periode menunggu persetujuan'),
              trailing: const Icon(Icons.chevron_right),
              onTap: profile.hasPermission('payroll', 'view')
                  ? () => context.go(ErpDestination.payroll.route)
                  : null,
            ),
          ),

          if (profile.hasPermission('rbac', 'view') || profile.hasPermission('audit', 'view')) ...[
            const SizedBox(height: 10),
            Card(
              child: ListTile(
                title: const Text('Manajemen Akses & Audit Trail'),
                subtitle: const Text('Tinjau log web/flutter dan matriks role'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.go(ErpDestination.rbacAudit.route),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
