import 'package:flutter/material.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import 'profile_models.dart';

typedef NavigateTabCallback = void Function(String route);
typedef PushRouteCallback = void Function(String route);

class HeroKpiItem {
  final String label;
  final String value;

  const HeroKpiItem({required this.label, required this.value});
}

class ProfileRoleThemeMeta {
  final IconData icon;
  final String subtitle;
  final ErpBadgeTone badgeTone;

  const ProfileRoleThemeMeta({
    required this.icon,
    required this.subtitle,
    required this.badgeTone,
  });

  static ProfileRoleThemeMeta forRole(String roleCode) {
    switch (roleCode) {
      case 'owner':
        return const ProfileRoleThemeMeta(
          icon: Icons.workspace_premium_outlined,
          subtitle: 'Kendali Eksekutif & Tata Kelola',
          badgeTone: ErpBadgeTone.accent,
        );
      case 'finance':
        return const ProfileRoleThemeMeta(
          icon: Icons.account_balance_outlined,
          subtitle: 'Otorisasi Kas & Pelaporan',
          badgeTone: ErpBadgeTone.info,
        );
      case 'warehouse':
        return const ProfileRoleThemeMeta(
          icon: Icons.warehouse_outlined,
          subtitle: 'Operasional Gudang & Logistik',
          badgeTone: ErpBadgeTone.warning,
        );
      case 'hr':
        return const ProfileRoleThemeMeta(
          icon: Icons.groups_outlined,
          subtitle: 'SDM, Kehadiran & Payroll',
          badgeTone: ErpBadgeTone.success,
        );
      default:
        return const ProfileRoleThemeMeta(
          icon: Icons.badge_outlined,
          subtitle: 'Kartu Kerja & Kehadiran Pribadi',
          badgeTone: ErpBadgeTone.accent,
        );
    }
  }

  static List<HeroKpiItem> heroKpisFor(ProfileSummaryData summary) {
    final ws = summary.roleWorkspace;
    switch (ws.kind) {
      case 'owner':
        final m = ws.executiveMetrics;
        final approvals = ws.intMetric(m, 'pending_finance_tx') +
            ws.intMetric(m, 'pending_attendance_approvals') +
            ws.intMetric(m, 'draft_payroll_runs');
        return [
          HeroKpiItem(label: 'Total Kas', value: formatRupiah(ws.strMetric(m, 'total_cash_balance'))),
          HeroKpiItem(label: 'Tim Aktif', value: '${ws.intMetric(m, 'active_employees_count')} org'),
          HeroKpiItem(label: 'Approval', value: '$approvals item'),
        ];
      case 'finance':
        final m = ws.financeMetrics;
        return [
          HeroKpiItem(label: 'Total Kas', value: formatRupiah(ws.strMetric(m, 'total_cash_balance'))),
          HeroKpiItem(label: 'Tx Pending', value: '${ws.intMetric(m, 'pending_transactions_count')}'),
          HeroKpiItem(label: 'Payroll Siap', value: '${ws.intMetric(m, 'approved_payroll_to_pay')} run'),
        ];
      case 'warehouse':
        final m = ws.warehouseMetrics;
        return [
          HeroKpiItem(label: 'SKU Aktif', value: '${ws.intMetric(m, 'active_items_count')} item'),
          HeroKpiItem(label: 'Stok Kritis', value: '${ws.intMetric(m, 'low_stock_alerts')} item'),
          HeroKpiItem(label: 'PO Aktif', value: '${ws.intMetric(m, 'open_purchase_orders')}'),
        ];
      case 'hr':
        final m = ws.hrMetrics;
        return [
          HeroKpiItem(label: 'Tim Aktif', value: '${ws.intMetric(m, 'active_employees_count')} org'),
          HeroKpiItem(label: 'Hadir Kini', value: '${ws.intMetric(m, 'present_today_count')} org'),
          HeroKpiItem(label: 'Izin Pending', value: '${ws.intMetric(m, 'pending_attendance_approvals')}'),
        ];
      default:
        final att = summary.personalAttendance;
        return [
          HeroKpiItem(label: 'Hadir ${att.daysWindow}h', value: '${att.presentDays} hr'),
          HeroKpiItem(label: 'Terlambat', value: '${att.lateDays} hr'),
          HeroKpiItem(label: 'Lembur', value: '${att.totalOvertimeMinutes} mnt'),
        ];
    }
  }
}

class ProfileMetricTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? iconColor;
  final Color? iconBackground;
  final String? badgeLabel;
  final ErpBadgeTone badgeTone;

  const ProfileMetricTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.iconColor,
    this.iconBackground,
    this.badgeLabel,
    this.badgeTone = ErpBadgeTone.neutral,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: iconBackground ?? t.accentSoft,
                    borderRadius: BorderRadius.circular(t.radiusSm),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, size: 17, color: iconColor ?? t.accent),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 16),
            ),
            if (badgeLabel != null) ...[
              const SizedBox(height: 8),
              ErpBadge(label: badgeLabel!, tone: badgeTone),
            ],
          ],
        ),
      ),
    );
  }
}

class OwnerProfileWorkspace extends StatelessWidget {
  final ProfileSummaryData summary;
  final NavigateTabCallback onNavigateTab;
  final PushRouteCallback onPushRoute;

  const OwnerProfileWorkspace({
    super.key,
    required this.summary,
    required this.onNavigateTab,
    required this.onPushRoute,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final ws = summary.roleWorkspace;
    final m = ws.executiveMetrics;
    final totalApprovals = ws.intMetric(m, 'pending_finance_tx') +
        ws.intMetric(m, 'pending_attendance_approvals') +
        ws.intMetric(m, 'draft_payroll_runs');
    final unclaimed = ws.intMetric(m, 'unclaimed_employees_count');
    final officeCount = ws.intMetric(m, 'office_locations_count');
    final audit24 = ws.intMetric(m, 'audit_events_24h');
    final dist = ws.roleDistribution;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Pusat Kontrol Owner'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Antrean Approval',
                value: '$totalApprovals item',
                icon: Icons.fact_check_outlined,
                iconColor: totalApprovals > 0 ? t.warning : t.success,
                iconBackground: totalApprovals > 0 ? t.warningSoft : t.successSoft,
                badgeLabel: totalApprovals > 0 ? 'Perlu Tindakan' : 'Terkendali',
                badgeTone: totalApprovals > 0 ? ErpBadgeTone.warning : ErpBadgeTone.success,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Akun Belum Klaim',
                value: '$unclaimed akun',
                icon: Icons.key_outlined,
                iconColor: unclaimed > 0 ? t.info : t.success,
                iconBackground: unclaimed > 0 ? t.infoSoft : t.successSoft,
                badgeLabel: unclaimed > 0 ? 'Terbitkan Kode' : 'Semua Tertaut',
                badgeTone: unclaimed > 0 ? ErpBadgeTone.info : ErpBadgeTone.success,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Kantor Geofence',
                value: '$officeCount lokasi',
                icon: Icons.location_on_outlined,
                iconColor: t.accent,
                iconBackground: t.accentSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Audit 24 Jam',
                value: '$audit24 log',
                icon: Icons.shield_outlined,
                iconColor: t.accent,
                iconBackground: t.accentSoft,
              ),
            ),
          ],
        ),
        if (dist.isNotEmpty) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Distribusi Tim per Role', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final item in dist)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: t.surfaceSubtle,
                            borderRadius: BorderRadius.circular(t.radiusPill),
                            border: Border.all(color: t.border),
                          ),
                          child: Text(
                            '${item.roleName}: ${item.employeeCount}',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: t.textPrimary,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        ErpListRowCard(
          leadingIcon: Icons.edit_location_alt_outlined,
          title: 'Lokasi & Geofence Kantor (Maps)',
          subtitle: ws.ownerOffices.isNotEmpty
              ? '${ws.ownerOffices.first['name']} · Radius ${ws.ownerOffices.first['radius_meters']} m'
              : 'Atur titik koordinat, radius & jam kerja kantor',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onPushRoute('/office-map-settings'),
        ),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.admin_panel_settings_outlined,
          title: 'Kelola Karyawan, Role & Audit',
          subtitle: 'Tambah, edit, nonaktifkan, hapus user & atur hak akses',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/rbac-audit'),
        ),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.account_balance_wallet_outlined,
          title: 'Buku Kas & Approval Keuangan',
          subtitle: 'Setujui transaksi pending dan cek saldo rekening',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/finance'),
        ),
        const SizedBox(height: 8),
        ErpListRowCard(
          leadingIcon: Icons.receipt_long_outlined,
          title: 'Approval & Pencairan Payroll',
          subtitle: '${ws.intMetric(m, 'draft_payroll_runs')} draft · ${ws.intMetric(m, 'approved_unpaid_payroll_runs')} siap bayar',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/payroll'),
        ),
      ],
    );
  }
}

class FinanceProfileWorkspace extends StatelessWidget {
  final ProfileSummaryData summary;
  final NavigateTabCallback onNavigateTab;

  const FinanceProfileWorkspace({
    super.key,
    required this.summary,
    required this.onNavigateTab,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final ws = summary.roleWorkspace;
    final m = ws.financeMetrics;
    final accounts = ws.accountsPreview;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Likuiditas & Rekening Aktif'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Kas Masuk 30h',
                value: formatRupiah(ws.strMetric(m, 'month_income')),
                icon: Icons.south_west_rounded,
                iconColor: t.success,
                iconBackground: t.successSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Kas Keluar 30h',
                value: formatRupiah(ws.strMetric(m, 'month_expense')),
                icon: Icons.north_east_rounded,
                iconColor: t.danger,
                iconBackground: t.dangerSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Piutang Terbuka',
                value: formatRupiah(ws.strMetric(m, 'open_receivable_total')),
                icon: Icons.call_received_rounded,
                iconColor: t.info,
                iconBackground: t.infoSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Hutang Terbuka',
                value: formatRupiah(ws.strMetric(m, 'open_payable_total')),
                icon: Icons.call_made_rounded,
                iconColor: t.warning,
                iconBackground: t.warningSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (accounts.isEmpty)
          const ErpEmptyCard(
            title: 'Belum ada rekening kas aktif',
            description: 'Tambahkan rekening kas atau bank melalui modul Keuangan.',
          )
        else ...[
          for (final acc in accounts.take(4))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.account_balance_outlined,
                leadingColor: t.info,
                leadingBackground: t.infoSoft,
                title: (acc['name'] ?? 'Rekening').toString(),
                subtitle: 'Tipe: ${(acc['type'] ?? 'cash').toString().toUpperCase()}',
                trailing: Text(
                  formatRupiah(acc['balance']),
                  style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 13),
                ),
                onTap: () => onNavigateTab('/finance'),
              ),
            ),
        ],
        ErpListRowCard(
          leadingIcon: Icons.receipt_long_outlined,
          title: 'Buka Buku Kas & Approval',
          subtitle: '${ws.intMetric(m, 'pending_transactions_count')} transaksi menunggu persetujuan',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/finance'),
        ),
        const SizedBox(height: 8),
        if (summary.hasPermission('payroll', 'view'))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ErpListRowCard(
              leadingIcon: Icons.payments_outlined,
              leadingColor: t.success,
              leadingBackground: t.successSoft,
              title: 'Cairkan Payroll Disetujui',
              subtitle: '${ws.intMetric(m, 'approved_payroll_to_pay')} periode siap dibayarkan',
              trailing: const Icon(Icons.chevron_right),
              onTap: () => onNavigateTab('/payroll'),
            ),
          ),
        if (summary.hasPermission('audit', 'view'))
          ErpListRowCard(
            leadingIcon: Icons.history_rounded,
            title: 'Tinjau Audit Keuangan',
            subtitle: 'Log perubahan saldo, approval, dan void transaksi',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onNavigateTab('/rbac-audit'),
          ),
      ],
    );
  }
}

class WarehouseProfileWorkspace extends StatelessWidget {
  final ProfileSummaryData summary;
  final NavigateTabCallback onNavigateTab;

  const WarehouseProfileWorkspace({
    super.key,
    required this.summary,
    required this.onNavigateTab,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final ws = summary.roleWorkspace;
    final m = ws.warehouseMetrics;
    final lowStock = ws.lowStockPreview;
    final warehouses = ws.warehousesList;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Gudang & Prioritas Restock'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Gudang Aktif',
                value: '${ws.intMetric(m, 'warehouses_count')} gudang',
                icon: Icons.warehouse_outlined,
                iconColor: t.accent,
                iconBackground: t.accentSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'SKU Aktif',
                value: '${ws.intMetric(m, 'active_items_count')} item',
                icon: Icons.qr_code_2_outlined,
                iconColor: t.info,
                iconBackground: t.infoSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'PO Berjalan',
                value: '${ws.intMetric(m, 'open_purchase_orders')} PO',
                icon: Icons.local_shipping_outlined,
                iconColor: t.warning,
                iconBackground: t.warningSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Mutasi Saya 30h',
                value: '${ws.intMetric(m, 'my_movements_30d')} kali',
                icon: Icons.swap_horiz_rounded,
                iconColor: t.success,
                iconBackground: t.successSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (lowStock.isEmpty)
          const ErpEmptyCard(
            title: 'Stok Kritis Bersih',
            description: 'Semua stok berada di atas batas minimum saat ini.',
          )
        else ...[
          for (final item in lowStock)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.warning_amber_rounded,
                leadingColor: t.warning,
                leadingBackground: t.warningSoft,
                title: '${item['name']} (${item['sku']})',
                subtitle: '${item['warehouse_name']} · Minimum ${item['min_stock']} ${item['unit']}',
                trailing: ErpBadge(
                  label: 'Sisa ${item['qty']}',
                  tone: ErpBadgeTone.warning,
                ),
                onTap: () => onNavigateTab('/inventory'),
              ),
            ),
        ],
        if (warehouses.isNotEmpty) ...[
          const SizedBox(height: 4),
          for (final wh in warehouses.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.store_mall_directory_outlined,
                title: (wh['name'] ?? 'Gudang').toString(),
                subtitle: (wh['address'] ?? 'Lokasi gudang operasional').toString(),
                trailing: wh['is_default'] == true
                    ? const ErpBadge(label: 'Utama', tone: ErpBadgeTone.accent)
                    : null,
              ),
            ),
        ],
        ErpListRowCard(
          leadingIcon: Icons.inventory_2_outlined,
          title: 'Kelola Stok & Mutasi',
          subtitle: 'Catat barang masuk, keluar, opname, atau terima PO',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/inventory'),
        ),
        const SizedBox(height: 8),
        if (summary.hasPermission('attendance', 'view'))
          ErpListRowCard(
            leadingIcon: Icons.fingerprint,
            title: 'Absensi Harian',
            subtitle: 'Check-in / check-out shift gudang Anda hari ini',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onNavigateTab('/attendance'),
          ),
      ],
    );
  }
}

class HrProfileWorkspace extends StatelessWidget {
  final ProfileSummaryData summary;
  final NavigateTabCallback onNavigateTab;

  const HrProfileWorkspace({
    super.key,
    required this.summary,
    required this.onNavigateTab,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final ws = summary.roleWorkspace;
    final m = ws.hrMetrics;
    final leaves = ws.pendingLeavesPreview;
    final unclaimed = ws.unclaimedEmployeesPreview;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'SDM & Antrean Persetujuan'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Hadir Hari Ini',
                value: '${ws.intMetric(m, 'present_today_count')} org',
                icon: Icons.how_to_reg_outlined,
                iconColor: t.success,
                iconBackground: t.successSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Izin Pending',
                value: '${ws.intMetric(m, 'pending_attendance_approvals')} berkas',
                icon: Icons.pending_actions_outlined,
                iconColor: t.warning,
                iconBackground: t.warningSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ProfileMetricTile(
                label: 'Draft Payroll',
                value: '${ws.intMetric(m, 'draft_payroll_runs')} periode',
                icon: Icons.receipt_long_outlined,
                iconColor: t.info,
                iconBackground: t.infoSoft,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ProfileMetricTile(
                label: 'Belum Aktivasi',
                value: '${ws.intMetric(m, 'unclaimed_employees_count')} akun',
                icon: Icons.person_add_alt_1_outlined,
                iconColor: t.accent,
                iconBackground: t.accentSoft,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (leaves.isEmpty)
          const ErpEmptyCard(
            title: 'Tidak ada pengajuan izin menunggu',
            description: 'Semua permohonan cuti atau sakit sudah diproses.',
          )
        else ...[
          for (final row in leaves)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.event_note_outlined,
                leadingColor: t.warning,
                leadingBackground: t.warningSoft,
                title: '${row['employee_name']} (${row['employee_code']})',
                subtitle:
                    '${formatShortDate(row['attendance_date']?.toString())} · ${(row['note'] ?? 'Pengajuan izin').toString()}',
                trailing: const ErpBadge(label: 'Tinjau', tone: ErpBadgeTone.warning),
                onTap: () => onNavigateTab('/attendance'),
              ),
            ),
        ],
        if (unclaimed.isNotEmpty) ...[
          const SizedBox(height: 4),
          for (final emp in unclaimed.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ErpListRowCard(
                leadingIcon: Icons.key_outlined,
                leadingColor: t.info,
                leadingBackground: t.infoSoft,
                title: '${emp['full_name']} (${emp['employee_code']})',
                subtitle: '${emp['email']} · ${emp['role_name']}',
                trailing: const ErpBadge(label: 'Kode', tone: ErpBadgeTone.info),
                onTap: () => onNavigateTab('/rbac-audit'),
              ),
            ),
        ],
        const SizedBox(height: 4),
        ErpListRowCard(
          leadingIcon: Icons.fact_check_outlined,
          title: 'Verifikasi Absensi & Izin',
          subtitle: 'Proses persetujuan izin sakit dan rekap kehadiran',
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onNavigateTab('/attendance'),
        ),
        const SizedBox(height: 8),
        if (summary.hasPermission('payroll', 'view'))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ErpListRowCard(
              leadingIcon: Icons.payments_outlined,
              title: 'Kelola Payroll Run',
              subtitle: 'Tinjau tunjangan, lembur, potongan & slip gaji',
              trailing: const Icon(Icons.chevron_right),
              onTap: () => onNavigateTab('/payroll'),
            ),
          ),
        if (summary.hasPermission('rbac', 'view'))
          ErpListRowCard(
            leadingIcon: Icons.groups_outlined,
            title: 'Direktori & Kode Aktivasi',
            subtitle: 'Buat kode klaim karyawan baru untuk login aplikasi',
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onNavigateTab('/rbac-audit'),
          ),
      ],
    );
  }
}

class StaffProfileWorkspace extends StatelessWidget {
  final ProfileSummaryData summary;
  final NavigateTabCallback onNavigateTab;

  const StaffProfileWorkspace({
    super.key,
    required this.summary,
    required this.onNavigateTab,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final ws = summary.roleWorkspace;
    final today = summary.personalAttendance.today;
    final offices = ws.staffOffices;

    String todayStatusLabel = 'Belum Absen Hari Ini';
    ErpBadgeTone todayTone = ErpBadgeTone.warning;
    if (today != null) {
      if (today.status == 'leave' || today.status == 'sick') {
        todayStatusLabel = today.status == 'sick' ? 'Izin Sakit' : 'Cuti / Izin';
        todayTone = ErpBadgeTone.info;
      } else if (today.clockOutAt != null) {
        todayStatusLabel = 'Selesai Shift';
        todayTone = ErpBadgeTone.success;
      } else if (today.clockInAt != null) {
        todayStatusLabel = 'Sudah Clock-In';
        todayTone = ErpBadgeTone.accent;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ErpSectionHeader(title: 'Jadwal & Lokasi Kerja'),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.today_outlined, size: 20, color: t.accent),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Status Kehadiran Hari Ini',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    ErpBadge(label: todayStatusLabel, tone: todayTone),
                  ],
                ),
                if (today != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Masuk: ${formatShortDateTime(today.clockInAt)} · Pulang: ${formatShortDateTime(today.clockOutAt)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                if (offices.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Divider(height: 1, color: t.border),
                  const SizedBox(height: 12),
                  for (final off in offices)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Icon(Icons.location_on_outlined, size: 16, color: t.textSecondary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '${off['name']} (${off['work_start_time']} - ${off['work_end_time']})',
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ),
                          Text(
                            'Radius ${off['radius_meters']} m',
                            style: AppTheme.monoNumeric(color: t.textSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: () => onNavigateTab('/attendance'),
                icon: const Icon(Icons.fingerprint, size: 18),
                label: const Text('Buka Absensi Hari Ini'),
              ),
            ),
            if (summary.hasPermission('inventory', 'view')) ...[
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => onNavigateTab('/inventory'),
                  icon: const Icon(Icons.inventory_2_outlined, size: 18),
                  label: const Text('Katalog Stok'),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}
