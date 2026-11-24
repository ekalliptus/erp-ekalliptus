enum ErpDestination {
  dashboard('/dashboard', 'Beranda'),
  finance('/finance', 'Kasir'),
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
  final String? username;
  final String? phone;
  final String baseSalary;
  final bool isActive;
  final String? avatarObjectKey;
  final String? avatarUrl;
  final String? createdAt;
  final String roleCode;
  final String roleName;
  final String roleDescription;
  final Set<String> permissions;
  final ErpKpis kpis;

  const ErpProfile({
    required this.employeeId,
    required this.employeeCode,
    required this.fullName,
    required this.email,
    required this.username,
    this.phone,
    this.baseSalary = '0',
    this.isActive = true,
    this.avatarObjectKey,
    this.avatarUrl,
    this.createdAt,
    required this.roleCode,
    required this.roleName,
    this.roleDescription = '',
    required this.permissions,
    required this.kpis,
  });

  factory ErpProfile.fromJson(Map<String, dynamic> json) {
    final emp = (json['employee'] as Map<String, dynamic>?) ?? const {};
    final permList = (json['permissions'] as List<dynamic>?) ?? const [];
    final rawAvatarUrl = emp['avatar_url']?.toString().trim();
    return ErpProfile(
      employeeId: (emp['id'] ?? '').toString(),
      employeeCode: (emp['employee_code'] ?? '').toString(),
      fullName: (emp['full_name'] ?? '').toString(),
      email: (emp['email'] ?? '').toString(),
      username: emp['username']?.toString(),
      phone: emp['phone']?.toString(),
      baseSalary: (emp['base_salary'] ?? '0').toString(),
      isActive: emp['is_active'] != false,
      avatarObjectKey: emp['avatar_object_key']?.toString(),
      avatarUrl: (rawAvatarUrl != null && rawAvatarUrl.isNotEmpty) ? rawAvatarUrl : null,
      createdAt: emp['created_at']?.toString(),
      roleCode: (json['role'] ?? 'staff').toString(),
      roleName: (json['role_name'] ?? 'Karyawan').toString(),
      roleDescription: (json['role_description'] ?? '').toString(),
      permissions: permList.map((e) => e.toString()).toSet(),
      kpis: ErpKpis.fromJson((json['kpis'] as Map<String, dynamic>?) ?? const {}),
    );
  }

  bool hasPermission(String module, String action) {
    return permissions.contains('$module:$action');
  }

  /// Caps primary floating navigation bar at 4 side tabs (Attendance sits in the centered Fingerprint button).
  List<ErpDestination> primaryBottomTabs() {
    final ordered = <ErpDestination>[ErpDestination.dashboard];

    if (roleCode == 'warehouse') {
      if (hasPermission('inventory', 'view')) ordered.add(ErpDestination.inventory);
      if (hasPermission('finance', 'view')) ordered.add(ErpDestination.finance);
      if (hasPermission('payroll', 'view')) ordered.add(ErpDestination.payroll);
    } else if (roleCode == 'hr') {
      if (hasPermission('payroll', 'view')) ordered.add(ErpDestination.payroll);
      if (hasPermission('rbac', 'view') || hasPermission('audit', 'view')) {
        ordered.add(ErpDestination.rbacAudit);
      }
      if (hasPermission('finance', 'view')) ordered.add(ErpDestination.finance);
      if (hasPermission('inventory', 'view')) ordered.add(ErpDestination.inventory);
    } else {
      if (hasPermission('finance', 'view')) ordered.add(ErpDestination.finance);
      if (hasPermission('inventory', 'view')) ordered.add(ErpDestination.inventory);
      if (hasPermission('payroll', 'view')) ordered.add(ErpDestination.payroll);
      if (ordered.length < 4 && (hasPermission('rbac', 'view') || hasPermission('audit', 'view'))) {
        ordered.add(ErpDestination.rbacAudit);
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
