String sanitizeInitials(String name) {
  final cleaned = name.replaceAll(RegExp(r'[^a-zA-Z0-9\s]'), ' ').trim();
  final parts = cleaned.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return 'EK';
  if (parts.length == 1) {
    return parts.first.substring(0, parts.first.length >= 2 ? 2 : 1).toUpperCase();
  }
  return '${parts.first[0]}${parts[1][0]}'.toUpperCase();
}

int _asInt(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((k, v) => MapEntry(k.toString(), v));
  }
  return const {};
}

List<Map<String, dynamic>> _asMapList(Object? value) {
  if (value is! List) return const [];
  return value.map(_asMap).toList(growable: false);
}

class ProfileEmployeeDetail {
  final String id;
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

  const ProfileEmployeeDetail({
    required this.id,
    required this.employeeCode,
    required this.fullName,
    required this.email,
    required this.username,
    required this.phone,
    required this.baseSalary,
    required this.isActive,
    required this.avatarObjectKey,
    required this.avatarUrl,
    required this.createdAt,
  });

  factory ProfileEmployeeDetail.fromJson(Map<String, dynamic> json) {
    final rawUsername = json['username']?.toString().trim();
    final rawPhone = json['phone']?.toString().trim();
    final rawAvatarUrl = json['avatar_url']?.toString().trim();
    final rawAvatarKey = json['avatar_object_key']?.toString().trim();
    return ProfileEmployeeDetail(
      id: (json['id'] ?? '').toString(),
      employeeCode: (json['employee_code'] ?? '').toString(),
      fullName: (json['full_name'] ?? '').toString(),
      email: (json['email'] ?? '').toString(),
      username: (rawUsername != null && rawUsername.isNotEmpty) ? rawUsername : null,
      phone: (rawPhone != null && rawPhone.isNotEmpty) ? rawPhone : null,
      baseSalary: (json['base_salary'] ?? '0').toString(),
      isActive: json['is_active'] != false,
      avatarObjectKey: (rawAvatarKey != null && rawAvatarKey.isNotEmpty) ? rawAvatarKey : null,
      avatarUrl: (rawAvatarUrl != null && rawAvatarUrl.isNotEmpty) ? rawAvatarUrl : null,
      createdAt: json['created_at']?.toString(),
    );
  }
}

class ProfileAuditEntry {
  final String id;
  final String module;
  final String action;
  final String platform;
  final String? entityId;
  final String? createdAt;

  const ProfileAuditEntry({
    required this.id,
    required this.module,
    required this.action,
    required this.platform,
    required this.entityId,
    required this.createdAt,
  });

  factory ProfileAuditEntry.fromJson(Map<String, dynamic> json) {
    return ProfileAuditEntry(
      id: (json['id'] ?? '').toString(),
      module: (json['module'] ?? '').toString(),
      action: (json['action'] ?? '').toString(),
      platform: (json['platform'] ?? 'web').toString(),
      entityId: json['entity_id']?.toString(),
      createdAt: json['created_at']?.toString(),
    );
  }
}

class ProfileSecuritySummary {
  final int registeredDevicesCount;
  final int webDevices;
  final int flutterDevices;
  final int unreadNotifications;
  final List<ProfileAuditEntry> recentAuditActions;

  const ProfileSecuritySummary({
    required this.registeredDevicesCount,
    required this.webDevices,
    required this.flutterDevices,
    required this.unreadNotifications,
    required this.recentAuditActions,
  });

  factory ProfileSecuritySummary.fromJson(Map<String, dynamic> json) {
    final platforms = _asMap(json['device_platforms']);
    final audits = _asMapList(json['recent_audit_actions'])
        .map(ProfileAuditEntry.fromJson)
        .toList(growable: false);
    return ProfileSecuritySummary(
      registeredDevicesCount: _asInt(json['registered_devices_count']),
      webDevices: _asInt(platforms['web']),
      flutterDevices: _asInt(platforms['flutter']),
      unreadNotifications: _asInt(json['unread_notifications']),
      recentAuditActions: audits,
    );
  }
}

class PersonalAttendanceItem {
  final String id;
  final String attendanceDate;
  final String? clockInAt;
  final String? clockOutAt;
  final String status;
  final String approvalStatus;
  final int lateMinutes;
  final int overtimeMinutes;
  final String? clockInMethod;
  final String? officeName;

  const PersonalAttendanceItem({
    required this.id,
    required this.attendanceDate,
    required this.clockInAt,
    required this.clockOutAt,
    required this.status,
    required this.approvalStatus,
    required this.lateMinutes,
    required this.overtimeMinutes,
    required this.clockInMethod,
    required this.officeName,
  });

  factory PersonalAttendanceItem.fromJson(Map<String, dynamic> json) {
    return PersonalAttendanceItem(
      id: (json['id'] ?? '').toString(),
      attendanceDate: (json['attendance_date'] ?? '').toString(),
      clockInAt: json['clock_in_at']?.toString(),
      clockOutAt: json['clock_out_at']?.toString(),
      status: (json['status'] ?? 'present').toString(),
      approvalStatus: (json['approval_status'] ?? 'approved').toString(),
      lateMinutes: _asInt(json['late_minutes']),
      overtimeMinutes: _asInt(json['overtime_minutes']),
      clockInMethod: json['clock_in_method']?.toString(),
      officeName: json['office_name']?.toString(),
    );
  }
}

class PersonalAttendanceSummary {
  final int daysWindow;
  final int presentDays;
  final int lateDays;
  final int leaveDays;
  final int sickDays;
  final int totalLateMinutes;
  final int totalOvertimeMinutes;
  final PersonalAttendanceItem? today;
  final List<PersonalAttendanceItem> recentRecords;

  const PersonalAttendanceSummary({
    required this.daysWindow,
    required this.presentDays,
    required this.lateDays,
    required this.leaveDays,
    required this.sickDays,
    required this.totalLateMinutes,
    required this.totalOvertimeMinutes,
    required this.today,
    required this.recentRecords,
  });

  factory PersonalAttendanceSummary.fromJson(Map<String, dynamic> json) {
    final todayMap = json['today'] != null ? _asMap(json['today']) : null;
    final recent = _asMapList(json['recent_records'])
        .map(PersonalAttendanceItem.fromJson)
        .toList(growable: false);
    return PersonalAttendanceSummary(
      daysWindow: _asInt(json['days_window'], 30),
      presentDays: _asInt(json['present_days']),
      lateDays: _asInt(json['late_days']),
      leaveDays: _asInt(json['leave_days']),
      sickDays: _asInt(json['sick_days']),
      totalLateMinutes: _asInt(json['total_late_minutes']),
      totalOvertimeMinutes: _asInt(json['total_overtime_minutes']),
      today: (todayMap != null && todayMap.isNotEmpty)
          ? PersonalAttendanceItem.fromJson(todayMap)
          : null,
      recentRecords: recent,
    );
  }
}

class PersonalPayrollSlip {
  final String itemId;
  final String payrollRunId;
  final String periodStart;
  final String periodEnd;
  final String runStatus;
  final String baseSalary;
  final String allowances;
  final String overtimePay;
  final String deductions;
  final String netSalary;
  final bool hasPdf;
  final String? paidAt;

  const PersonalPayrollSlip({
    required this.itemId,
    required this.payrollRunId,
    required this.periodStart,
    required this.periodEnd,
    required this.runStatus,
    required this.baseSalary,
    required this.allowances,
    required this.overtimePay,
    required this.deductions,
    required this.netSalary,
    required this.hasPdf,
    required this.paidAt,
  });

  factory PersonalPayrollSlip.fromJson(Map<String, dynamic> json) {
    return PersonalPayrollSlip(
      itemId: (json['item_id'] ?? '').toString(),
      payrollRunId: (json['payroll_run_id'] ?? '').toString(),
      periodStart: (json['period_start'] ?? '').toString(),
      periodEnd: (json['period_end'] ?? '').toString(),
      runStatus: (json['run_status'] ?? 'draft').toString(),
      baseSalary: (json['base_salary'] ?? '0').toString(),
      allowances: (json['allowances'] ?? '0').toString(),
      overtimePay: (json['overtime_pay'] ?? '0').toString(),
      deductions: (json['deductions'] ?? '0').toString(),
      netSalary: (json['net_salary'] ?? '0').toString(),
      hasPdf: json['has_pdf'] == true,
      paidAt: json['paid_at']?.toString(),
    );
  }
}

class RoleDistributionEntry {
  final String roleCode;
  final String roleName;
  final int employeeCount;

  const RoleDistributionEntry({
    required this.roleCode,
    required this.roleName,
    required this.employeeCount,
  });

  factory RoleDistributionEntry.fromJson(Map<String, dynamic> json) {
    return RoleDistributionEntry(
      roleCode: (json['role_code'] ?? '').toString(),
      roleName: (json['role_name'] ?? '').toString(),
      employeeCount: _asInt(json['employee_count']),
    );
  }
}

class RoleWorkspaceData {
  final String kind;
  final Map<String, dynamic> raw;

  const RoleWorkspaceData({
    required this.kind,
    required this.raw,
  });

  factory RoleWorkspaceData.fromJson(Map<String, dynamic> json) {
    return RoleWorkspaceData(
      kind: (json['kind'] ?? 'staff').toString(),
      raw: json,
    );
  }

  Map<String, dynamic> get executiveMetrics => _asMap(raw['executive_metrics']);
  List<Map<String, dynamic>> get ownerOffices => _asMapList(raw['offices']);
  List<RoleDistributionEntry> get roleDistribution => _asMapList(raw['role_distribution'])
      .map(RoleDistributionEntry.fromJson)
      .toList(growable: false);

  Map<String, dynamic> get financeMetrics => _asMap(raw['finance_metrics']);
  List<Map<String, dynamic>> get accountsPreview => _asMapList(raw['accounts_preview']);

  Map<String, dynamic> get warehouseMetrics => _asMap(raw['warehouse_metrics']);
  List<Map<String, dynamic>> get lowStockPreview => _asMapList(raw['low_stock_preview']);
  List<Map<String, dynamic>> get warehousesList => _asMapList(raw['warehouses_list']);

  Map<String, dynamic> get hrMetrics => _asMap(raw['hr_metrics']);
  List<Map<String, dynamic>> get pendingLeavesPreview => _asMapList(raw['pending_leaves_preview']);
  List<Map<String, dynamic>> get unclaimedEmployeesPreview =>
      _asMapList(raw['unclaimed_employees_preview']);

  Map<String, dynamic> get staffMetrics => _asMap(raw['staff_metrics']);
  List<Map<String, dynamic>> get staffOffices => _asMapList(raw['offices']);

  int intMetric(Map<String, dynamic> metrics, String key) => _asInt(metrics[key]);
  String strMetric(Map<String, dynamic> metrics, String key, [String fallback = '0']) =>
      (metrics[key] ?? fallback).toString();
}

class ProfileFaceEnrollment {
  final bool enrolled;
  final String? enrolledAt;
  final List<String> models;
  final bool hasReferencePhoto;
  final String? referencePhotoUrl;
  final int sampleCount;
  final List<String> poses;
  final bool isMultiPose;

  const ProfileFaceEnrollment({
    this.enrolled = false,
    this.enrolledAt,
    this.models = const [],
    this.hasReferencePhoto = false,
    this.referencePhotoUrl,
    this.sampleCount = 0,
    this.poses = const [],
    this.isMultiPose = false,
  });

  factory ProfileFaceEnrollment.fromJson(Map<String, dynamic> json) {
    final rawModels = (json['models'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList(growable: false);
    final rawPoses = (json['poses'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList(growable: false);
    final rawRefUrl = json['reference_photo_url']?.toString().trim();
    final sampleCount = _asInt(json['sample_count']);
    final enrolled = json['enrolled'] == true;
    return ProfileFaceEnrollment(
      enrolled: enrolled,
      enrolledAt: json['enrolled_at']?.toString(),
      models: rawModels,
      hasReferencePhoto: json['has_reference_photo'] == true,
      referencePhotoUrl: (rawRefUrl != null && rawRefUrl.isNotEmpty) ? rawRefUrl : null,
      sampleCount: sampleCount > 0 ? sampleCount : (enrolled ? 1 : 0),
      poses: rawPoses,
      isMultiPose: json['is_multi_pose'] == true || sampleCount >= 3,
    );
  }
}

class ProfileSummaryData {
  final ProfileEmployeeDetail employee;
  final ProfileFaceEnrollment faceEnrollment;
  final String roleCode;
  final String roleName;
  final String roleDescription;
  final Set<String> permissions;
  final String platform;
  final ProfileSecuritySummary security;
  final PersonalAttendanceSummary personalAttendance;
  final List<PersonalPayrollSlip> latestSlips;
  final RoleWorkspaceData roleWorkspace;

  const ProfileSummaryData({
    required this.employee,
    this.faceEnrollment = const ProfileFaceEnrollment(),
    required this.roleCode,
    required this.roleName,
    required this.roleDescription,
    required this.permissions,
    required this.platform,
    required this.security,
    required this.personalAttendance,
    required this.latestSlips,
    required this.roleWorkspace,
  });

  bool hasPermission(String module, String action) =>
      permissions.contains('$module:$action');

  factory ProfileSummaryData.fromJson(Map<String, dynamic> json) {
    final roleMap = _asMap(json['role']);
    final permRaw = json['permissions'];
    final permSet = permRaw is List
        ? permRaw.map((e) => e.toString()).toSet()
        : <String>{};
    final slips = _asMapList(json['personal_payroll'])
        .map(PersonalPayrollSlip.fromJson)
        .toList(growable: false);

    return ProfileSummaryData(
      employee: ProfileEmployeeDetail.fromJson(_asMap(json['employee'])),
      faceEnrollment: ProfileFaceEnrollment.fromJson(_asMap(json['face_enrollment'])),
      roleCode: (roleMap['code'] ?? 'staff').toString(),
      roleName: (roleMap['name'] ?? 'Staff').toString(),
      roleDescription: (roleMap['description'] ?? '').toString(),
      permissions: permSet,
      platform: (json['platform'] ?? 'flutter').toString(),
      security: ProfileSecuritySummary.fromJson(_asMap(json['security'])),
      personalAttendance: PersonalAttendanceSummary.fromJson(_asMap(json['personal_attendance'])),
      latestSlips: slips,
      roleWorkspace: RoleWorkspaceData.fromJson(_asMap(json['role_workspace'])),
    );
  }
}
