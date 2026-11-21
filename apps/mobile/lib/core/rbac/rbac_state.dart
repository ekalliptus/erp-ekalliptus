enum ErpDestination {
  dashboard('/dashboard', 'Beranda'),
  finance('/finance', 'Keuangan'),
  inventory('/inventory', 'Stok'),
  attendance('/attendance', 'Absensi'),
  payroll('/payroll', 'Payroll'),
  rbacAudit('/rbac-audit', 'Akses & Audit');

  final String route;
  final String label;
  const ErpDestination(this.route, this.label);
}

class ErpKpis {
  final String totalCashBalance;
  final int lowStockAlerts;
  final int pendingAttendanceApprovals;
  final int draftPayrollRuns;

  const ErpKpis({
    required this.totalCashBalance,
    required this.lowStockAlerts,
    required this.pendingAttendanceApprovals,
    required this.draftPayrollRuns,
  });

  factory ErpKpis.fromJson(Map<String, dynamic> json) {
    return ErpKpis(
      totalCashBalance: (json['total_cash_balance'] ?? '0').toString(),
      lowStockAlerts: (json['low_stock_alerts'] as num?)?.toInt() ?? 0,
      pendingAttendanceApprovals: (json['pending_attendance_approvals'] as num?)?.toInt() ?? 0,
      draftPayrollRuns: (json['draft_payroll_runs'] as num?)?.toInt() ?? 0,
    );
  }
}

class ErpProfile {
  final String employeeId;
  final String employeeCode;
  final String fullName;
  final String email;
  final String roleCode;
  final String roleName;
  final Set<String> permissions;
  final ErpKpis kpis;

  const ErpProfile({
    required this.employeeId,
    required this.employeeCode,
    required this.fullName,
    required this.email,
    required this.roleCode,
    required this.roleName,
    required this.permissions,
    required this.kpis,
  });

  factory ErpProfile.fromJson(Map<String, dynamic> json) {
    final emp = (json['employee'] as Map<String, dynamic>?) ?? const {};
    final permList = (json['permissions'] as List<dynamic>?) ?? const [];
    return ErpProfile(
      employeeId: (emp['id'] ?? '').toString(),
      employeeCode: (emp['employee_code'] ?? '').toString(),
      fullName: (emp['full_name'] ?? '').toString(),
      email: (emp['email'] ?? '').toString(),
      roleCode: (json['role'] ?? 'staff').toString(),
      roleName: (json['role_name'] ?? 'Karyawan').toString(),
      permissions: permList.map((e) => e.toString()).toSet(),
      kpis: ErpKpis.fromJson((json['kpis'] as Map<String, dynamic>?) ?? const {}),
    );
  }

  bool hasPermission(String module, String action) {
    return permissions.contains('$module:$action');
  }

  /// Caps primary floating navigation bar at 4 tabs prioritized by role.
  List<ErpDestination> primaryBottomTabs() {
    final ordered = <ErpDestination>[ErpDestination.dashboard];

    if (roleCode == 'warehouse') {
      if (hasPermission('inventory', 'view')) ordered.add(ErpDestination.inventory);
      if (hasPermission('attendance', 'view')) ordered.add(ErpDestination.attendance);
      if (hasPermission('finance', 'view')) ordered.add(ErpDestination.finance);
    } else if (roleCode == 'hr') {
      if (hasPermission('attendance', 'view')) ordered.add(ErpDestination.attendance);
      if (hasPermission('payroll', 'view')) ordered.add(ErpDestination.payroll);
      if (hasPermission('rbac', 'view')) ordered.add(ErpDestination.rbacAudit);
    } else {
      if (hasPermission('finance', 'view')) ordered.add(ErpDestination.finance);
      if (hasPermission('inventory', 'view')) ordered.add(ErpDestination.inventory);
      if (hasPermission('attendance', 'view')) ordered.add(ErpDestination.attendance);
      if (ordered.length < 4 && hasPermission('payroll', 'view')) {
        ordered.add(ErpDestination.payroll);
      }
    }

    return ordered.take(4).toList(growable: false);
  }

  List<ErpDestination> overflowDestinations() {
    final primary = primaryBottomTabs().toSet();
    final extras = <ErpDestination>[];

    if (!primary.contains(ErpDestination.finance) && hasPermission('finance', 'view')) {
      extras.add(ErpDestination.finance);
    }
    if (!primary.contains(ErpDestination.inventory) && hasPermission('inventory', 'view')) {
      extras.add(ErpDestination.inventory);
    }
    if (!primary.contains(ErpDestination.attendance) && hasPermission('attendance', 'view')) {
      extras.add(ErpDestination.attendance);
    }
    if (!primary.contains(ErpDestination.payroll) && hasPermission('payroll', 'view')) {
      extras.add(ErpDestination.payroll);
    }
    if (!primary.contains(ErpDestination.rbacAudit) &&
        (hasPermission('rbac', 'view') || hasPermission('audit', 'view'))) {
      extras.add(ErpDestination.rbacAudit);
    }
    return extras;
  }
}
