import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:ekalliptus_erp_mobile/core/attendance/attendance_telemetry.dart';
import 'package:ekalliptus_erp_mobile/core/attendance/face_recognition_service.dart';
import 'package:ekalliptus_erp_mobile/core/auth/auth_service.dart';
import 'package:ekalliptus_erp_mobile/core/network/api_client.dart';
import 'package:ekalliptus_erp_mobile/core/notifications/notification_models.dart';
import 'package:ekalliptus_erp_mobile/core/notifications/notification_registration.dart';
import 'package:ekalliptus_erp_mobile/core/offline/offline_queue_store.dart';
import 'package:ekalliptus_erp_mobile/core/permissions/permission_setup_service.dart';
import 'package:ekalliptus_erp_mobile/core/providers/app_providers.dart';
import 'package:ekalliptus_erp_mobile/core/rbac/rbac_state.dart';
import 'package:ekalliptus_erp_mobile/core/security/biometric_guard.dart';
import 'package:ekalliptus_erp_mobile/core/theme/eucalyptus_theme.dart';
import 'package:ekalliptus_erp_mobile/core/updates/app_update_service.dart';
import 'package:ekalliptus_erp_mobile/core/utils/formatters.dart';
import 'package:ekalliptus_erp_mobile/features/attendance/attendance_screen.dart';
import 'package:ekalliptus_erp_mobile/features/attendance/office_map_settings_screen.dart';
import 'package:ekalliptus_erp_mobile/features/auth/login_screen.dart';
import 'package:ekalliptus_erp_mobile/features/common/app_update_dialog.dart';
import 'package:ekalliptus_erp_mobile/features/common/shimmer_skeleton.dart';
import 'package:ekalliptus_erp_mobile/features/common/theme_transition.dart';
import 'package:ekalliptus_erp_mobile/features/dashboard/dashboard_screen.dart';
import 'package:ekalliptus_erp_mobile/features/finance/finance_screen.dart';
import 'package:ekalliptus_erp_mobile/features/permissions/permission_setup_screen.dart';
import 'package:ekalliptus_erp_mobile/features/profile/profile_screen.dart';
import 'package:ekalliptus_erp_mobile/features/rbac/rbac_audit_screen.dart';
import 'package:ekalliptus_erp_mobile/features/shell/floating_nav_shell.dart';
import 'package:ekalliptus_erp_mobile/features/splash/splash_screen.dart';

class _StubUnreadNotificationsController extends UnreadNotificationsController {
  @override
  Future<int> build() async => 2;
}

class _FakeAttendanceApiClient extends ApiClient {
  Map<String, dynamic>? lastClockInPayload;
  Map<String, dynamic>? lastClockOutPayload;
  Map<String, dynamic>? lastEnrollPayload;
  Map<String, dynamic>? lastVerifyPayload;
  String? lastUpdatedOfficeId;
  Map<String, dynamic>? lastUpdatedOfficePayload;
  bool faceEnrolled;
  bool verifyMatched;
  bool hasClockedInToday;
  int similarityPercent;
  List<String> faceModels;

  _FakeAttendanceApiClient({
    this.faceEnrolled = false,
    this.verifyMatched = true,
    this.hasClockedInToday = false,
    this.similarityPercent = 91,
    this.faceModels = const [],
  }) : super(auth: AuthService());

  @override
  Future<Map<String, dynamic>> fetchAttendanceData() async {
    final todayIso = DateFormat('yyyy-MM-dd').format(DateTime.now());
    return {
      'offices': [
        {
          'id': 'office-1',
          'name': 'Kantor Ekalliptus Tegal',
          'latitude': -6.8694,
          'longitude': 109.1402,
          'radius_meters': 250,
          'work_start_time': '09:00',
          'work_end_time': '17:00',
        },
      ],
      'records': [
        if (hasClockedInToday)
          {
            'id': 'att-today',
            'employee_id': 'emp-owner',
            'employee_name': 'Alul (Owner)',
            'attendance_date': todayIso,
            'clock_in_at': DateTime.now().toIso8601String(),
            'clock_out_at': null,
            'clock_in_method': 'face_scan',
            'status': 'present',
            'approval_status': 'approved',
          },
        {
          'id': 'att-1',
          'employee_id': 'emp-2',
          'employee_name': 'Sari Staff',
          'attendance_date': '2026-11-21',
          'clock_in_at': '2026-11-21T01:55:00.000Z',
          'clock_out_at': '2026-11-21T10:05:00.000Z',
          'clock_in_method': 'biometric',
          'clock_in_ip': '192.168.1.44',
          'clock_in_device': {'brand': 'samsung', 'model': 'SM-S928B'},
          'status': 'present',
          'approval_status': 'approved',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> fetchFaceStatus({
    bool includeMobileDescriptor = false,
  }) async {
    return {
      'enrolled': faceEnrolled,
      'models': faceModels,
      'has_reference_photo': faceEnrolled,
      if (includeMobileDescriptor && faceEnrolled)
        'mobile_descriptors': [List<double>.filled(192, 0.07216878)],
    };
  }

  @override
  Future<String> uploadObject({
    required String category,
    required String filename,
    required String contentType,
    required Uint8List bytes,
  }) async {
    return 'selfies/mock-$filename';
  }

  @override
  Future<Map<String, dynamic>> enrollFace({
    required String faceModel,
    required List<double> faceDescriptor,
    required String selfieObjectKey,
    List<List<double>>? faceSamples,
    List<String>? enrollmentPoses,
    bool derivedFromReference = false,
    bool replace = false,
  }) async {
    lastEnrollPayload = {
      'face_model': faceModel,
      'face_descriptor': faceDescriptor,
      if (faceSamples != null) 'face_samples': faceSamples,
      if (enrollmentPoses != null) 'enrollment_poses': enrollmentPoses,
      'selfie_object_key': selfieObjectKey,
      'derived_from_reference': derivedFromReference,
      'replace': replace,
    };
    faceEnrolled = true;
    if (replace) {
      faceModels = [faceModel];
    } else if (!faceModels.contains(faceModel)) {
      faceModels = [...faceModels, faceModel];
    }
    return {
      'enrolled': true,
      'models': faceModels,
      'sample_count': faceSamples?.length ?? 1,
      'poses': enrollmentPoses ?? const [],
      'is_multi_pose': (faceSamples?.length ?? 1) >= 3,
    };
  }

  @override
  Future<Map<String, dynamic>> deleteMyFace() async {
    faceEnrolled = false;
    faceModels = const [];
    return {'ok': true, 'enrolled': false};
  }

  @override
  Future<Map<String, dynamic>> verifyFace({
    required String faceModel,
    required List<double> faceDescriptor,
  }) async {
    lastVerifyPayload = {
      'face_model': faceModel,
      'face_descriptor': faceDescriptor,
    };
    return {
      'matched': verifyMatched,
      'similarity_percent': verifyMatched ? similarityPercent : 34,
    };
  }

  @override
  Future<void> clockIn(Map<String, dynamic> body) async {
    lastClockInPayload = body;
  }

  @override
  Future<void> clockOut(Map<String, dynamic> body) async {
    lastClockOutPayload = body;
  }

  @override
  Future<Map<String, dynamic>> updateOfficeLocation(
    String officeId,
    Map<String, dynamic> body,
  ) async {
    lastUpdatedOfficeId = officeId;
    lastUpdatedOfficePayload = body;
    return {
      'office': {
        'id': officeId,
        ...body,
      },
    };
  }
}

class _StubFaceRecognitionService extends FaceRecognitionService {
  final bool cancelled;
  final List<double> descriptor;
  final List<List<double>> samples;
  final List<String> poses;

  _StubFaceRecognitionService({
    this.cancelled = false,
    List<double>? descriptor,
    List<List<double>>? samples,
    List<String>? poses,
  })  : descriptor = descriptor ?? List<double>.filled(192, 0.07216878),
        samples = samples ??
            List<List<double>>.generate(
              4,
              (_) => List<double>.filled(192, 0.07216878),
            ),
        poses = poses ?? const ['front', 'side_1', 'side_2', 'front_confirm'];

  @override
  Future<FaceScanOutcome> scanFace({
    required FaceScanMode mode,
    required String title,
    List<double>? referenceDescriptor,
    List<List<double>>? referenceDescriptors,
    Uint8List? referenceImageBytes,
  }) async {
    if (cancelled) return FaceScanOutcome.cancelled();
    return FaceScanOutcome(
      cancelled: false,
      descriptor: descriptor,
      samples: mode == FaceScanMode.enroll ? samples : const [],
      poses: mode == FaceScanMode.enroll ? poses : const [],
      imageBytes: Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xD9]),
      similarityPercent: 95,
      matched: true,
    );
  }
}

class _StubTelemetryService extends AttendanceTelemetryService {
  @override
  Future<AttendanceTelemetrySnapshot> collectAll({required bool requestPermission}) async {
    return const AttendanceTelemetrySnapshot(
      latitude: -6.8694,
      longitude: 109.1402,
      gpsAccuracyMeters: 12.0,
      isMockedGps: false,
      manufacturer: 'Google',
      brand: 'Google',
      model: 'Pixel 11',
      osVersion: 'Android 14 (SDK 34)',
      platform: 'android',
      deviceId: 'dev-test-001',
      isPhysicalDevice: false,
      localIp: '10.0.2.15',
    );
  }
}

class _StubBiometricGuard extends BiometricGuard {
  @override
  Future<BiometricCapability> inspectCapability() async => BiometricCapability.fingerprint;

  @override
  Future<AttendanceAuthResult> authenticateForAttendance({required String reason}) async {
    return const AttendanceAuthResult(
      verified: true,
      needsCameraFaceFallback: false,
      methodLabel: 'fingerprint',
    );
  }
}

class _StubPermissionSetupService extends PermissionSetupService {
  PermissionSummary _current;
  bool markedDone = false;

  _StubPermissionSetupService({PermissionSummary? initial})
      : _current = initial ??
            const PermissionSummary(
              location: AppPermissionStatus.denied,
              locationServiceEnabled: true,
              camera: AppPermissionStatus.granted,
              notifications: AppPermissionStatus.denied,
              biometric: BiometricCapability.fingerprint,
            );

  @override
  Future<PermissionSummary> inspectAll() async => _current;

  @override
  Future<PermissionSummary> requestAllEssential() async {
    _current = PermissionSummary(
      location: AppPermissionStatus.granted,
      locationServiceEnabled: _current.locationServiceEnabled,
      camera: AppPermissionStatus.granted,
      notifications: AppPermissionStatus.granted,
      biometric: _current.biometric,
    );
    return _current;
  }

  @override
  Future<void> markOnboardingCompleted() async {
    markedDone = true;
  }
}

class _FakeProfileApiClient extends ApiClient {
  ErpProfile profile;
  final bool simulateUpdate;
  bool faceEnrolled;
  int faceSampleCount;
  List<String> faceModels;
  bool didDeleteFace = false;
  Map<String, dynamic>? lastEnrollFacePayload;
  Map<String, dynamic>? lastUpdatedProfilePayload;
  String? lastSlipItemId;

  _FakeProfileApiClient({
    required this.profile,
    this.simulateUpdate = false,
    this.faceEnrolled = false,
    this.faceSampleCount = 0,
    this.faceModels = const [],
  }) : super(auth: AuthService());

  @override
  Future<String> uploadObject({
    required String category,
    required String filename,
    required String contentType,
    required Uint8List bytes,
  }) async {
    return 'selfies/mock-profile-$filename';
  }

  @override
  Future<Map<String, dynamic>> enrollFace({
    required String faceModel,
    required List<double> faceDescriptor,
    required String selfieObjectKey,
    List<List<double>>? faceSamples,
    List<String>? enrollmentPoses,
    bool derivedFromReference = false,
    bool replace = false,
  }) async {
    lastEnrollFacePayload = {
      'face_model': faceModel,
      'face_descriptor': faceDescriptor,
      if (faceSamples != null) 'face_samples': faceSamples,
      if (enrollmentPoses != null) 'enrollment_poses': enrollmentPoses,
      'selfie_object_key': selfieObjectKey,
      'derived_from_reference': derivedFromReference,
      'replace': replace,
    };
    faceEnrolled = true;
    faceSampleCount = faceSamples?.length ?? 1;
    faceModels = [faceModel];
    return {
      'enrolled': true,
      'models': faceModels,
      'sample_count': faceSampleCount,
      'poses': enrollmentPoses ?? const [],
      'is_multi_pose': faceSampleCount >= 3,
    };
  }

  @override
  Future<Map<String, dynamic>> deleteMyFace() async {
    didDeleteFace = true;
    faceEnrolled = false;
    faceSampleCount = 0;
    faceModels = const [];
    return {'ok': true, 'enrolled': false};
  }

  @override
  Future<Map<String, dynamic>> fetchAppVersion({
    required String platform,
    required String currentVersion,
    required int currentBuild,
  }) async {
    final baseReleases = [
      {
        'id': 'rel-3',
        'platform': platform,
        'version': '1.2.0',
        'build_number': 3,
        'title': 'Owner User Manager & Info Pembaruan',
        'changelog': [
          'Owner CRUD karyawan & matriks izin role',
          'Info versi aplikasi & cek update manual/otomatis',
        ],
        'download_url': 'https://my.ekalliptus.com',
        'is_mandatory': false,
        'is_published': true,
        'published_at': '2026-11-22T18:45:00+07:00',
      },
      {
        'id': 'rel-2',
        'platform': platform,
        'version': '1.1.0',
        'build_number': 2,
        'title': 'Absensi 1-Tap & Profil Role',
        'changelog': [
          'Absensi 1-Tap biometrik dengan telemetri GPS & perangkat',
          'Pengaturan lokasi kantor di Maps & Profil Role',
        ],
        'download_url': 'https://my.ekalliptus.com',
        'is_mandatory': false,
        'is_published': true,
        'published_at': '2026-11-22T10:00:00+07:00',
      },
    ];
    final latestRel = simulateUpdate
        ? {
            'id': 'rel-4',
            'platform': platform,
            'version': '1.3.0',
            'build_number': 4,
            'title': 'Perbaikan Sinkronisasi & Notifikasi',
            'changelog': [
              'Percepatan sinkronisasi offline queue',
              'Optimalisasi pembaruan lokasi GPS lapangan',
            ],
            'download_url': 'https://my.ekalliptus.com/update-apk',
            'is_mandatory': false,
            'is_published': true,
            'published_at': '2026-11-23T09:00:00+07:00',
          }
        : baseReleases.first;
    final allReleases = simulateUpdate ? [latestRel, ...baseReleases] : baseReleases;
    return {
      'platform': platform,
      'current_version': currentVersion,
      'current_build': currentBuild,
      'has_update': simulateUpdate,
      'latest': latestRel,
      'pending_releases': simulateUpdate ? [latestRel] : const [],
      'releases': allReleases,
    };
  }

  Map<String, dynamic> _workspaceForRole() {
    switch (profile.roleCode) {
      case 'owner':
        return {
          'kind': 'owner',
          'executive_metrics': {
            'total_cash_balance': '42500000',
            'active_employees_count': 12,
            'unclaimed_employees_count': 2,
            'office_locations_count': 1,
            'warehouses_count': 2,
            'pending_finance_tx': 1,
            'pending_attendance_approvals': 2,
            'draft_payroll_runs': 1,
            'approved_unpaid_payroll_runs': 1,
            'low_stock_alerts': 3,
            'audit_events_24h': 19,
          },
          'offices': [
            {
              'id': 'office-1',
              'name': 'Kantor Ekalliptus Tegal',
              'latitude': -6.8694,
              'longitude': 109.1402,
              'radius_meters': 250,
              'work_start_time': '09:00',
              'work_end_time': '17:00',
            },
          ],
          'role_distribution': [
            {'role_code': 'owner', 'role_name': 'Owner', 'employee_count': 1},
            {'role_code': 'finance', 'role_name': 'Finance', 'employee_count': 2},
            {'role_code': 'warehouse', 'role_name': 'Warehouse', 'employee_count': 4},
            {'role_code': 'hr', 'role_name': 'Human Resources', 'employee_count': 1},
            {'role_code': 'staff', 'role_name': 'Staff', 'employee_count': 4},
          ],
        };
      case 'finance':
        return {
          'kind': 'finance',
          'finance_metrics': {
            'total_cash_balance': '38000000',
            'active_accounts_count': 2,
            'pending_transactions_count': 3,
            'open_receivable_total': '6500000',
            'open_payable_total': '2100000',
            'month_income': '19000000',
            'month_expense': '7500000',
            'approved_payroll_to_pay': 1,
          },
          'accounts_preview': [
            {'id': 'acc-1', 'name': 'BCA Bisnis', 'type': 'bank', 'balance': '30000000'},
            {'id': 'acc-2', 'name': 'Kas Operasional', 'type': 'cash', 'balance': '8000000'},
          ],
        };
      case 'warehouse':
        return {
          'kind': 'warehouse',
          'warehouse_metrics': {
            'warehouses_count': 2,
            'active_items_count': 48,
            'low_stock_alerts': 1,
            'open_purchase_orders': 2,
            'my_movements_30d': 14,
          },
          'low_stock_preview': [
            {
              'item_id': 'item-1',
              'sku': 'PRT-80',
              'name': 'Thermal Printer 80mm',
              'unit': 'pcs',
              'warehouse_name': 'Gudang Utama Ekalliptus',
              'qty': 2,
              'min_stock': 5,
            },
          ],
          'warehouses_list': [
            {
              'id': 'wh-1',
              'name': 'Gudang Utama Ekalliptus',
              'address': 'Tegal, Jawa Tengah',
              'is_default': true,
            },
          ],
        };
      case 'hr':
        return {
          'kind': 'hr',
          'hr_metrics': {
            'active_employees_count': 12,
            'unclaimed_employees_count': 1,
            'present_today_count': 10,
            'pending_attendance_approvals': 1,
            'draft_payroll_runs': 1,
            'offices_count': 1,
          },
          'pending_leaves_preview': [
            {
              'id': 'att-pending-1',
              'employee_id': 'emp-staff',
              'employee_name': 'Sari Staff',
              'employee_code': 'EK-002',
              'attendance_date': '2026-11-22',
              'status': 'leave',
              'note': 'Urus dokumen keluarga',
            },
          ],
          'unclaimed_employees_preview': [
            {
              'id': 'emp-new',
              'employee_code': 'EK-009',
              'full_name': 'Budi Baru',
              'email': 'budi@ekalliptus.com',
              'role_name': 'Staff',
            },
          ],
        };
      default:
        return {
          'kind': 'staff',
          'staff_metrics': {
            'offices_count': 1,
            'active_catalog_items': 48,
          },
          'offices': [
            {
              'id': 'office-1',
              'name': 'Kantor Ekalliptus Tegal',
              'radius_meters': 250,
              'work_start_time': '09:00',
              'work_end_time': '17:00',
            },
          ],
        };
    }
  }

  @override
  Future<Map<String, dynamic>> fetchProfileSummary() async {
    return {
      'employee': {
        'id': profile.employeeId,
        'employee_code': profile.employeeCode,
        'full_name': profile.fullName,
        'email': profile.email,
        'username': profile.username,
        'phone': profile.phone ?? '081999900306',
        'base_salary': profile.baseSalary == '0' ? '15000000' : profile.baseSalary,
        'is_active': profile.isActive,
        'avatar_object_key': profile.avatarObjectKey,
        'avatar_url': profile.avatarUrl,
        'created_at': '2026-01-15T08:00:00.000Z',
      },
      'face_enrollment': {
        'enrolled': faceEnrolled,
        'enrolled_at': faceEnrolled ? '2026-11-23T01:00:00.000Z' : null,
        'models': faceModels,
        'has_reference_photo': faceEnrolled,
        'reference_photo_url': null,
        'sample_count': faceSampleCount,
        'poses': faceSampleCount >= 3
            ? const ['front', 'side_1', 'side_2', 'front_confirm']
            : const [],
        'is_multi_pose': faceSampleCount >= 3,
      },
      'role': {
        'code': profile.roleCode,
        'name': profile.roleName,
        'description': profile.roleDescription.isEmpty
            ? 'Hak akses role ${profile.roleName} di MyEkalliptus.'
            : profile.roleDescription,
      },
      'permissions': profile.permissions.toList()..sort(),
      'platform': 'flutter',
      'security': {
        'registered_devices_count': 2,
        'device_platforms': {'web': 1, 'flutter': 1},
        'unread_notifications': 3,
        'recent_audit_actions': [
          {
            'id': 'aud-1',
            'module': 'attendance',
            'action': 'clock_in',
            'platform': 'flutter',
            'entity_id': 'att-1',
            'created_at': '2026-11-22T02:00:00.000Z',
          },
        ],
      },
      'personal_attendance': {
        'days_window': 30,
        'present_days': 21,
        'late_days': 1,
        'leave_days': 0,
        'sick_days': 0,
        'total_late_minutes': 5,
        'total_overtime_minutes': 120,
        'today': {
          'id': 'att-today',
          'attendance_date': '2026-11-22',
          'clock_in_at': '2026-11-22T01:55:00.000Z',
          'clock_out_at': null,
          'status': 'present',
          'approval_status': 'approved',
          'late_minutes': 0,
          'overtime_minutes': 0,
          'clock_in_method': 'biometric',
          'office_name': 'Kantor Ekalliptus Tegal',
        },
        'recent_records': [
          {
            'id': 'att-today',
            'attendance_date': '2026-11-22',
            'clock_in_at': '2026-11-22T01:55:00.000Z',
            'clock_out_at': null,
            'status': 'present',
            'approval_status': 'approved',
            'late_minutes': 0,
            'overtime_minutes': 0,
            'clock_in_method': 'biometric',
            'office_name': 'Kantor Ekalliptus Tegal',
          },
        ],
      },
      'personal_payroll': [
        {
          'item_id': 'slip-1',
          'payroll_run_id': 'run-1',
          'period_start': '2026-10-01',
          'period_end': '2026-10-31',
          'run_status': 'paid',
          'base_salary': '15000000',
          'allowances': '500000',
          'overtime_pay': '150000',
          'deductions': '0',
          'net_salary': '15650000',
          'has_pdf': true,
          'paid_at': '2026-11-01T08:00:00.000Z',
        },
      ],
      'role_workspace': _workspaceForRole(),
    };
  }

  @override
  Future<Map<String, dynamic>> updateMyProfile(Map<String, dynamic> body) async {
    lastUpdatedProfilePayload = body;
    profile = ErpProfile(
      employeeId: profile.employeeId,
      employeeCode: profile.employeeCode,
      fullName: (body['full_name'] ?? profile.fullName).toString(),
      email: profile.email,
      username: body.containsKey('username') ? body['username']?.toString() : profile.username,
      phone: body.containsKey('phone') ? body['phone']?.toString() : profile.phone,
      baseSalary: profile.baseSalary,
      isActive: profile.isActive,
      avatarObjectKey: body.containsKey('avatar_object_key')
          ? body['avatar_object_key']?.toString()
          : profile.avatarObjectKey,
      createdAt: profile.createdAt,
      roleCode: profile.roleCode,
      roleName: profile.roleName,
      roleDescription: profile.roleDescription,
      permissions: profile.permissions,
      kpis: profile.kpis,
    );
    return {
      'employee': {
        'id': profile.employeeId,
        'employee_code': profile.employeeCode,
        'full_name': profile.fullName,
        'email': profile.email,
        'username': profile.username,
        'phone': profile.phone,
      },
      'avatar_url': null,
    };
  }

  @override
  Future<String> fetchPayrollSlipUrl(String itemId) async {
    lastSlipItemId = itemId;
    return 'https://example.invalid/slips/$itemId.pdf';
  }
}

class _FakeRbacApiClient extends ApiClient {
  final Set<String> conflictOnDeleteIds;
  final List<Map<String, dynamic>> permissionsList;
  final List<Map<String, dynamic>> rolesList;
  final List<Map<String, dynamic>> employeesList;

  Map<String, dynamic>? lastCreatedPayload;
  String? lastUpdatedId;
  Map<String, dynamic>? lastUpdatedPayload;
  String? lastUnlinkedId;
  String? lastDeletedId;
  String? lastUpdatedRoleId;
  List<String>? lastUpdatedRolePermIds;

  _FakeRbacApiClient({
    Set<String>? conflictOnDeleteIds,
  })  : conflictOnDeleteIds = conflictOnDeleteIds ?? {'emp-staff'},
        permissionsList = [
          {'id': 'perm-fin-view', 'module': 'finance', 'action': 'view'},
          {'id': 'perm-inv-view', 'module': 'inventory', 'action': 'view'},
          {'id': 'perm-att-view', 'module': 'attendance', 'action': 'view'},
          {'id': 'perm-pay-view', 'module': 'payroll', 'action': 'view'},
          {'id': 'perm-rbac-view', 'module': 'rbac', 'action': 'view'},
          {'id': 'perm-rbac-create', 'module': 'rbac', 'action': 'create'},
          {'id': 'perm-rbac-update', 'module': 'rbac', 'action': 'update'},
          {'id': 'perm-rbac-delete', 'module': 'rbac', 'action': 'delete'},
          {'id': 'perm-audit-view', 'module': 'audit', 'action': 'view'},
        ],
        rolesList = [
          {
            'id': 'role-owner',
            'code': 'owner',
            'name': 'Owner',
            'description': 'Full owner control',
            'permissions': [
              {'id': 'perm-rbac-view', 'module': 'rbac', 'action': 'view'},
              {'id': 'perm-rbac-update', 'module': 'rbac', 'action': 'update'},
            ],
          },
          {
            'id': 'role-hr',
            'code': 'hr',
            'name': 'Human Resources',
            'description': 'HR management',
            'permissions': [
              {'id': 'perm-att-view', 'module': 'attendance', 'action': 'view'},
              {'id': 'perm-rbac-view', 'module': 'rbac', 'action': 'view'},
            ],
          },
          {
            'id': 'role-staff',
            'code': 'staff',
            'name': 'Staff',
            'description': 'Daily staff operations',
            'permissions': [
              {'id': 'perm-att-view', 'module': 'attendance', 'action': 'view'},
            ],
          },
        ],
        employeesList = [
          {
            'id': 'emp-owner',
            'auth_user_id': 'auth-owner',
            'role_id': 'role-owner',
            'role_code': 'owner',
            'role_name': 'Owner',
            'employee_code': 'EK-001',
            'full_name': 'Alul (Owner)',
            'email': 'alul@ekalliptus.com',
            'username': 'owneralul',
            'phone': '081999900306',
            'base_salary': '15000000',
            'is_active': true,
            'has_claim_code': false,
          },
          {
            'id': 'emp-staff',
            'auth_user_id': 'auth-staff',
            'role_id': 'role-staff',
            'role_code': 'staff',
            'role_name': 'Staff',
            'employee_code': 'EK-002',
            'full_name': 'Sari Staff',
            'email': 'sari@ekalliptus.com',
            'username': 'saristaff',
            'phone': '08123456789',
            'base_salary': '5000000',
            'is_active': true,
            'has_claim_code': false,
          },
          {
            'id': 'emp-clean',
            'auth_user_id': null,
            'role_id': 'role-staff',
            'role_code': 'staff',
            'role_name': 'Staff',
            'employee_code': 'EK-003',
            'full_name': 'Budi Baru',
            'email': 'budi@ekalliptus.com',
            'username': null,
            'phone': null,
            'base_salary': '4500000',
            'is_active': true,
            'has_claim_code': true,
          },
        ],
        super(auth: AuthService());

  @override
  Future<Map<String, dynamic>> fetchRbacAuditData({
    required bool includeRbac,
    required bool includeAudit,
  }) async {
    return {
      'roles': includeRbac ? List<Map<String, dynamic>>.from(rolesList) : const [],
      'permissions': includeRbac ? List<Map<String, dynamic>>.from(permissionsList) : const [],
      'employees': includeRbac ? List<Map<String, dynamic>>.from(employeesList) : const [],
      'audit_logs': includeAudit
          ? [
              {
                'id': 'aud-1',
                'module': 'rbac',
                'action': 'create_employee',
                'actor_email': 'alul@ekalliptus.com',
                'platform': 'flutter',
                'created_at': '2026-11-22T08:00:00.000Z',
                'before_data': null,
                'after_data': {'employee_code': 'EK-003'},
              },
            ]
          : const [],
    };
  }

  @override
  Future<Map<String, dynamic>> createEmployee(Map<String, dynamic> body) async {
    lastCreatedPayload = body;
    final role = rolesList.firstWhere((r) => r['id'] == body['role_id']);
    final created = {
      'id': 'emp-new-${employeesList.length + 1}',
      'auth_user_id': null,
      'role_id': role['id'],
      'role_code': role['code'],
      'role_name': role['name'],
      'employee_code': body['employee_code'],
      'full_name': body['full_name'],
      'email': body['email'],
      'username': body['username'],
      'phone': body['phone'],
      'base_salary': (body['base_salary'] ?? 0).toString(),
      'is_active': true,
      'has_claim_code': body['issue_claim_code'] == true,
    };
    employeesList.add(created);
    return {
      'employee': created,
      if (body['issue_claim_code'] == true) 'claim_code': 'EK-TESTCODE01',
    };
  }

  @override
  Future<Map<String, dynamic>> updateEmployee(
    String employeeId,
    Map<String, dynamic> body,
  ) async {
    lastUpdatedId = employeeId;
    lastUpdatedPayload = body;
    final idx = employeesList.indexWhere((e) => e['id'] == employeeId);
    final current = Map<String, dynamic>.from(employeesList[idx]);
    body.forEach((k, v) => current[k] = v);
    if (body['role_id'] != null) {
      final role = rolesList.firstWhere((r) => r['id'] == body['role_id']);
      current['role_code'] = role['code'];
      current['role_name'] = role['name'];
    }
    if (body.containsKey('base_salary')) {
      current['base_salary'] = body['base_salary'].toString();
    }
    employeesList[idx] = current;
    return {'employee': current};
  }

  @override
  Future<Map<String, dynamic>> unlinkEmployeeAuth(
    String employeeId, {
    bool issueClaimCode = true,
  }) async {
    lastUnlinkedId = employeeId;
    final idx = employeesList.indexWhere((e) => e['id'] == employeeId);
    final current = Map<String, dynamic>.from(employeesList[idx]);
    current['auth_user_id'] = null;
    current['has_claim_code'] = issueClaimCode;
    employeesList[idx] = current;
    return {
      'ok': true,
      'employee': current,
      if (issueClaimCode) 'claim_code': 'EK-UNLINK99',
    };
  }

  @override
  Future<Map<String, dynamic>> deleteEmployee(String employeeId) async {
    lastDeletedId = employeeId;
    if (conflictOnDeleteIds.contains(employeeId)) {
      throw const ApiException(
        'Karyawan memiliki riwayat operasional sehingga tidak dapat dihapus permanen. Nonaktifkan akun sebagai gantinya.',
        statusCode: 409,
        details: {
          'can_deactivate': true,
          'references': {'attendances': 2},
        },
      );
    }
    employeesList.removeWhere((e) => e['id'] == employeeId);
    return {'ok': true, 'mode': 'deleted', 'employee_id': employeeId};
  }

  @override
  Future<Map<String, dynamic>> updateRolePermissions(
    String roleId,
    List<String> permissionIds,
  ) async {
    lastUpdatedRoleId = roleId;
    lastUpdatedRolePermIds = permissionIds;
    final idx = rolesList.indexWhere((r) => r['id'] == roleId);
    final current = Map<String, dynamic>.from(rolesList[idx]);
    current['permissions'] =
        permissionsList.where((p) => permissionIds.contains(p['id'])).toList();
    rolesList[idx] = current;
    return {'ok': true, 'role_id': roleId, 'count': permissionIds.length};
  }
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID', null);
  });

  group('Eucalyptus Precision design tokens & theme parity', () {
    test('light and dark token values match design-tokens.json', () {
      expect(EucalyptusTokens.light.canvas, const Color(0xFFF7F7F5));
      expect(EucalyptusTokens.light.accent, const Color(0xFF0F766E));
      expect(EucalyptusTokens.dark.canvas, const Color(0xFF0C0E0D));
      expect(EucalyptusTokens.dark.accent, const Color(0xFF10B981));

      final mono = AppTheme.monoNumeric(color: EucalyptusTokens.light.textPrimary);
      expect(mono.fontFeatures, contains(const FontFeature.tabularFigures()));
    });
  });

  group('RBAC permissions & role-aware Floating Navigation cap', () {
    ErpProfile makeProfile(String role, List<String> perms) {
      return ErpProfile(
        employeeId: 'emp-1',
        employeeCode: 'EMP-001',
        fullName: 'Owner Ekalliptus',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: role,
        roleName: role.toUpperCase(),
        permissions: perms.toSet(),
        kpis: const ErpKpis(
          totalCashBalance: '15000000',
          lowStockAlerts: 2,
          pendingAttendanceApprovals: 1,
          draftPayrollRuns: 0,
        ),
      );
    }

    test('caps bottom navigation tabs at <= 4 across all roles', () {
      final allPerms = [
        'finance:view',
        'inventory:view',
        'attendance:view',
        'payroll:view',
        'rbac:view',
        'audit:view',
      ];
      for (final role in ['owner', 'finance', 'warehouse', 'hr', 'staff']) {
        final p = makeProfile(role, allPerms);
        final tabs = p.primaryBottomTabs();
        expect(tabs.length <= 4, isTrue);
        expect(tabs.first, ErpDestination.dashboard);
        expect(tabs.contains(ErpDestination.attendance), isFalse);
      }

      final staff = makeProfile('staff', ['attendance:view', 'attendance:create']);
      expect(staff.hasPermission('finance', 'view'), isFalse);
      expect(staff.hasPermission('attendance', 'create'), isTrue);
    });
  });

  group('Geofence math, IDR formatting & Drift offline queue service', () {
    test('calculates distance within and outside 250m geofence accurately', () {
      final inside = calculateDistanceMeters(
        lat1: -6.8694,
        lng1: 109.1402,
        lat2: -6.8698,
        lng2: 109.1405,
      );
      expect(inside < 250, isTrue);

      final outside = calculateDistanceMeters(
        lat1: -6.8694,
        lng1: 109.1402,
        lat2: -6.2088,
        lng2: 106.8456,
      );
      expect(outside > 100000, isTrue);
      expect(formatRupiah('1250000'), contains('1.250.000'));
    });

    test('OfflineSyncService flushes queued mutations when online', () async {
      final store = InMemoryOfflineQueueStore();
      var online = false;
      final sent = <String>[];

      final service = OfflineSyncService(
        store: store,
        sender: (method, endpoint, payload) async {
          if (!online) throw Exception('No network');
          sent.add('$method $endpoint');
        },
      );

      await service.enqueueMutation(
        endpoint: '/api/attendance/clock-in',
        method: 'POST',
        payload: {'office_id': 'off-1'},
      );

      final failRun = await service.flush();
      expect(failRun.syncedCount, 0);
      expect(failRun.remainingCount, 1);

      online = true;
      final okRun = await service.flush();
      expect(okRun.syncedCount, 1);
      expect(okRun.remainingCount, 0);
      expect(sent, ['POST /api/attendance/clock-in']);
    });
  });

  group('Widget tests in Light & Dark modes', () {
    testWidgets('LoginScreen renders cleanly in Light and Dark themes', (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: const LoginScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Masuk ke MyEkalliptus'), findsOneWidget);
        expect(find.textContaining('alul@ekalliptus.com'), findsWidgets);
        expect(find.byType(Image), findsWidgets);
      }
    });

    testWidgets('SplashScreen renders logo & branding cleanly in Light and Dark themes', (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        var resolved = false;
        await tester.pumpWidget(
          ProviderScope(
            key: ValueKey(brightness),
            overrides: [
              sessionProfileProvider.overrideWith((ref) async => null),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: SplashScreen(
                minDisplayDuration: const Duration(milliseconds: 50),
                onResolved: (_) => resolved = true,
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pump(const Duration(milliseconds: 50));
        expect(find.text('MyEkalliptus'), findsOneWidget);
        expect(find.text('ERP Command Center'), findsOneWidget);
        expect(find.byType(Image), findsOneWidget);
        expect(resolved, isTrue);
      }
    });

    testWidgets('DashboardSkeleton & FinanceSkeleton render shimmer cleanly in Light and Dark themes',
        (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.build(brightness),
            home: const Scaffold(body: DashboardSkeleton()),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));
        expect(find.byType(DashboardSkeleton), findsOneWidget);

        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.build(brightness),
            home: const Scaffold(body: FinanceSkeleton()),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));
        expect(find.byType(FinanceSkeleton), findsOneWidget);
      }
    });

    testWidgets('ThemeRevealHost and AnimatedThemeToggleButton switch Light <-> Dark cleanly',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: Consumer(
            builder: (context, ref, _) {
              final mode = ref.watch(themeModeProvider);
              return MaterialApp(
                themeMode: mode == ThemeMode.system ? ThemeMode.light : mode,
                theme: AppTheme.build(Brightness.light),
                darkTheme: AppTheme.build(Brightness.dark),
                builder: (context, child) => ThemeRevealHost(child: child!),
                home: const Scaffold(
                  body: Center(child: AnimatedThemeToggleButton()),
                ),
              );
            },
          ),
        ),
      );
      await tester.pump();
      expect(find.byIcon(Icons.dark_mode_rounded), findsOneWidget);

      await tester.tap(find.byType(AnimatedThemeToggleButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.byKey(const ValueKey<String>('theme-reveal-overlay')), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('theme-reveal-overlay')), findsNothing);
      expect(find.byIcon(Icons.light_mode_rounded), findsOneWidget);

      await tester.tap(find.byType(AnimatedThemeToggleButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 120));
      expect(find.byKey(const ValueKey<String>('theme-reveal-overlay')), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('theme-reveal-overlay')), findsNothing);
      expect(find.byIcon(Icons.dark_mode_rounded), findsOneWidget);

      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: ProviderScope(
            child: Consumer(
              builder: (context, ref, _) {
                final mode = ref.watch(themeModeProvider);
                return MaterialApp(
                  themeMode: mode == ThemeMode.system ? ThemeMode.light : mode,
                  theme: AppTheme.build(Brightness.light),
                  darkTheme: AppTheme.build(Brightness.dark),
                  builder: (context, child) => ThemeRevealHost(child: child!),
                  home: const Scaffold(
                    body: Center(child: AnimatedThemeToggleButton()),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byType(AnimatedThemeToggleButton));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.light_mode_rounded), findsOneWidget);
    });
  });

  group('Notification registration & model', () {
    test('registerCurrentToken idempotent per token', () async {
      final calls = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => calls.add(t),
        onUnregister: (t) async {},
      );
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      await service.registerCurrentToken();
      expect(calls, hasLength(1));
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      expect(calls, hasLength(1));
    });

    test('token baru memicu registrasi ulang', () async {
      final calls = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => calls.add(t),
        onUnregister: (t) async {},
      );
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      service.updateToken('b' * 40);
      await service.registerCurrentToken();
      expect(calls, hasLength(2));
    });

    test('unregister mengirim token dan mengizinkan registrasi ulang', () async {
      final registered = <String>[];
      final unregistered = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => registered.add(t),
        onUnregister: (t) async => unregistered.add(t),
      );
      service.updateToken('c' * 40);
      await service.registerCurrentToken();
      await service.unregister();
      expect(unregistered, ['c' * 40]);
      service.updateToken('c' * 40);
      await service.registerCurrentToken();
      expect(registered, hasLength(2));
    });

    test('NotificationEntry.fromJson memetakan field inti', () {
      final entry = NotificationEntry.fromJson({
        'id': 'n-1',
        'module': 'finance',
        'event_type': 'transaction_recorded',
        'title': 'Kas masuk dicatat',
        'body': 'Kas Kantor: Rp50.000',
        'created_at': '2026-11-21T03:00:00.000Z',
        'read_at': null,
        'entity_id': 'tx-1',
      });
      expect(entry.isUnread, isTrue);
      expect(entry.module, 'finance');
      expect(entry.entityId, 'tx-1');
      expect(entry.createdAt.year, 2026);
    });

    test('NotificationEntry.fromJson memetakan notifikasi pembaruan app_update', () {
      final entry = NotificationEntry.fromJson({
        'id': 'n-upd-1',
        'module': 'app_update',
        'event_type': 'app_release_published',
        'title': 'Update MyEkalliptus v1.3.1 Tersedia',
        'body': 'Perbaikan push notification pembaruan aplikasi.',
        'created_at': '2026-11-24T00:00:00.000Z',
        'read_at': null,
        'entity_id': 'rel-131',
      });
      expect(entry.isUnread, isTrue);
      expect(entry.module, 'app_update');
      expect(entry.eventType, 'app_release_published');
      expect(entry.entityId, 'rel-131');
    });
  });

  group('Core logic guards: parseRupiahInput & isOfflineRecoverableError', () {
    test('parseRupiahInput accepts positive integer Rupiah and rejects invalid strings', () {
      expect(parseRupiahInput('150000'), 150000);
      expect(parseRupiahInput('Rp 1.250.000'), 1250000);
      expect(parseRupiahInput('Rp25,000'), 25000);
      expect(parseRupiahInput('0'), isNull);
      expect(parseRupiahInput('-500'), isNull);
      expect(parseRupiahInput('10.5'), isNull);
      expect(parseRupiahInput('abc'), isNull);
    });

    test('isOfflineRecoverableError rejects 4xx client errors and keeps 5xx/network errors', () {
      expect(isOfflineRecoverableError(const ApiException('Bad Request', statusCode: 400)), isFalse);
      expect(isOfflineRecoverableError(const ApiException('Forbidden', statusCode: 403)), isFalse);
      expect(
        isOfflineRecoverableError(const ApiException('Service Unavailable', statusCode: 503)),
        isTrue,
      );
      expect(isOfflineRecoverableError(const ApiException('Connection failed')), isTrue);
    });
  });

  group('Redesigned DashboardScreen & FloatingNavShell (Light & Dark)', () {
    ErpProfile ownerFixture() {
      return const ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EMP-001',
        fullName: 'Alul Saputra',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {
          'dashboard:view',
          'finance:view',
          'finance:create',
          'inventory:view',
          'inventory:create',
          'attendance:view',
          'attendance:create',
          'payroll:view',
          'rbac:view',
          'audit:view',
        },
        kpis: ErpKpis(
          totalCashBalance: '25000000',
          lowStockAlerts: 3,
          pendingAttendanceApprovals: 2,
          draftPayrollRuns: 1,
        ),
      );
    }

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('DashboardScreen renders greeting, hero card & quick actions in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final profile = ownerFixture();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              pendingOfflineCountProvider.overrideWith((ref) async => 0),
              unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: Scaffold(body: DashboardScreen(profile: profile)),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));

        expect(find.text('Halo, Alul'), findsOneWidget);
        expect(find.text('Total Posisi Kas Aktif'), findsOneWidget);
        expect(find.text('Absensi'), findsOneWidget);
        expect(find.text('Kasir'), findsOneWidget);
        expect(find.text('Stok'), findsOneWidget);
        expect(find.text('Payroll'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });

      testWidgets('FloatingNavShell renders centered Fingerprint button & navigates to dedicated ProfileScreen in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final profile = ownerFixture();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(_FakeProfileApiClient(profile: profile)),
              permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
              pendingOfflineCountProvider.overrideWith((ref) async => 0),
              unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: FloatingNavShell(
                profile: profile,
                currentLocation: '/dashboard',
                child: DashboardScreen(profile: profile),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));

        expect(find.byIcon(Icons.fingerprint), findsAtLeastNWidgets(1));
        expect(find.byIcon(Icons.apps_rounded), findsOneWidget);
        expect(find.text('AS'), findsOneWidget);

        await tester.tap(find.byIcon(Icons.apps_rounded));
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.text('Aksi Cepat & Modul'), findsOneWidget);
        Navigator.of(tester.element(find.text('Aksi Cepat & Modul'))).pop();
        await tester.pump(const Duration(milliseconds: 400));

        await tester.tap(find.text('AS'));
        await tester.pumpAndSettle();
        expect(find.text('Profil & Ruang Kerja'), findsOneWidget);
        expect(find.text('Akun & Profil'), findsNothing);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('FloatingNavShell sanitizes punctuation in avatar initials (Alul (Owner) -> AO)', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      const bracketProfile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'dashboard:view', 'attendance:view', 'attendance:create'},
        kpis: ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
            unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.dark),
            home: const FloatingNavShell(
              profile: bracketProfile,
              currentLocation: '/dashboard',
              child: SizedBox.shrink(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 250));

      expect(find.text('AO'), findsOneWidget);
      expect(find.text('A('), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('ErpProfile parses avatar_url & FloatingNavShell renders header avatar image', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      const avatarUrl = 'https://cdn.example.com/avatar/emp-1.jpg';
      final parsed = ErpProfile.fromJson({
        'employee': {
          'id': 'emp-1',
          'employee_code': 'EK-001',
          'full_name': 'Alul Studio',
          'email': 'alul@ekalliptus.com',
          'avatar_object_key': 'avatar/emp-1/photo.jpg',
          'avatar_url': avatarUrl,
        },
        'role': 'owner',
        'role_name': 'Owner',
        'permissions': ['dashboard:view'],
        'kpis': {'total_cash_balance': '0'},
      });
      expect(parsed.avatarUrl, avatarUrl);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
            unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: FloatingNavShell(
              profile: parsed,
              currentLocation: '/dashboard',
              child: const SizedBox.shrink(),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));

      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Image &&
              w.image is NetworkImage &&
              (w.image as NetworkImage).url == avatarUrl,
        ),
        findsOneWidget,
      );
    });
  });

  group('Unified AttendanceScreen & AttendanceTelemetrySnapshot', () {
    test('AttendanceTelemetrySnapshot builds deviceLabel & JSON payload cleanly', () {
      const dedupSnap = AttendanceTelemetrySnapshot(
        latitude: -6.8694,
        longitude: 109.1402,
        gpsAccuracyMeters: 8.5,
        isMockedGps: false,
        brand: 'Google',
        model: 'Google Pixel 9',
        osVersion: 'Android 14',
        platform: 'android',
        deviceId: 'abc-123',
        isPhysicalDevice: true,
        localIp: '192.168.1.10',
      );
      expect(dedupSnap.deviceLabel, 'Google Pixel 9');
      expect(dedupSnap.hasGps, isTrue);

      const combineSnap = AttendanceTelemetrySnapshot(
        brand: 'samsung',
        model: 'SM-S928B',
        localIp: '10.0.2.15',
      );
      expect(combineSnap.deviceLabel, 'samsung SM-S928B');

      final json = dedupSnap.toDeviceInfoJson(biometricType: 'fingerprint');
      expect(json['local_ip'], '192.168.1.10');
      expect(json['biometric_type'], 'fingerprint');
      expect(json['is_mocked_gps'], isFalse);
      expect(json['gps_accuracy_meters'], 8.5);
    });

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('Unified AttendanceScreen renders 1-tap flow without manual buttons in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final fakeApi = _FakeAttendanceApiClient();
        const profile = ErpProfile(
          employeeId: 'emp-owner',
          employeeCode: 'EK-001',
          fullName: 'Alul (Owner)',
          email: 'alul@ekalliptus.com',
          username: 'alul',
          roleCode: 'owner',
          roleName: 'Owner',
          permissions: {'attendance:view', 'attendance:create', 'attendance:approve'},
          kpis: ErpKpis(
            totalCashBalance: '0',
            lowStockAlerts: 0,
            pendingAttendanceApprovals: 0,
            draftPayrollRuns: 0,
          ),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(fakeApi),
              attendanceTelemetryServiceProvider.overrideWithValue(_StubTelemetryService()),
              biometricGuardProvider.overrideWithValue(_StubBiometricGuard()),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: const Scaffold(body: AttendanceScreen(profile: profile)),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Ambil GPS'), findsNothing);
        expect(find.text('Foto Selfie'), findsNothing);
        expect(find.text('Scan QR'), findsNothing);
        expect(find.text('Sidik Jari'), findsOneWidget);
        expect(find.text('Scan Wajah'), findsOneWidget);
        expect(find.text('Absen Masuk Sekarang'), findsOneWidget);
        expect(find.text('Google Pixel 11 · 10.0.2.15'), findsOneWidget);
        expect(find.textContaining(RegExp(r'^\d{2}\.\d{2}\.\d{2}$')), findsOneWidget);
        expect(tester.takeException(), isNull);

        await tester.tap(find.text('Absen Masuk Sekarang'));
        await tester.pumpAndSettle();

        expect(fakeApi.lastClockInPayload, isNotNull);
        expect(fakeApi.lastClockInPayload?['biometric_verified'], isTrue);
        expect(fakeApi.lastClockInPayload?['verification_method'], 'biometric');
        expect(fakeApi.lastClockInPayload?['latitude'], -6.8694);
        final sentDev = fakeApi.lastClockInPayload?['device_info'] as Map<String, dynamic>?;
        expect(sentDev?['local_ip'], '10.0.2.15');
        expect(sentDev?['model'], 'Pixel 11');
        expect(sentDev?['biometric_type'], 'fingerprint');
      });
    }

    testWidgets('First-time Scan Wajah auto-enrolls 192-d face descriptor and clocks in', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeAttendanceApiClient(faceEnrolled: false);
      const profile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'attendance:view', 'attendance:create', 'attendance:approve'},
        kpis: ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            attendanceTelemetryServiceProvider.overrideWithValue(_StubTelemetryService()),
            biometricGuardProvider.overrideWithValue(_StubBiometricGuard()),
            faceRecognitionServiceProvider.overrideWithValue(_StubFaceRecognitionService()),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: AttendanceScreen(profile: profile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Scan Wajah'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Absen Masuk Sekarang'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastEnrollPayload, isNotNull);
      expect(fakeApi.lastEnrollPayload?['face_model'], 'mobile_facenet_192d');
      expect((fakeApi.lastEnrollPayload?['face_descriptor'] as List).length, 192);
      expect(fakeApi.lastClockInPayload?['verification_method'], 'face_scan');
      expect(fakeApi.lastClockInPayload?['face_model'], 'mobile_facenet_192d');
      expect((fakeApi.lastClockInPayload?['face_descriptor'] as List).length, 192);
    });

    testWidgets('Scan Wajah verifies enrolled face before allowing clock-out', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeAttendanceApiClient(
        faceEnrolled: true,
        faceModels: const ['mobile_facenet_192d'],
        hasClockedInToday: true,
        verifyMatched: true,
      );
      const profile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'attendance:view', 'attendance:create', 'attendance:approve'},
        kpis: ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            attendanceTelemetryServiceProvider.overrideWithValue(_StubTelemetryService()),
            biometricGuardProvider.overrideWithValue(_StubBiometricGuard()),
            faceRecognitionServiceProvider.overrideWithValue(_StubFaceRecognitionService()),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: AttendanceScreen(profile: profile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Scan Wajah'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Absen Pulang Sekarang'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastVerifyPayload?['face_model'], 'mobile_facenet_192d');
      expect(fakeApi.lastClockOutPayload?['verification_method'], 'face_scan');
      expect(fakeApi.lastClockOutPayload?['face_model'], 'mobile_facenet_192d');
      expect((fakeApi.lastClockOutPayload?['face_descriptor'] as List).length, 192);
    });

    testWidgets('Mismatched face blocks attendance and shows rejection snackbar', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeAttendanceApiClient(
        faceEnrolled: true,
        faceModels: const ['mobile_facenet_192d'],
        verifyMatched: false,
      );
      const profile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'attendance:view', 'attendance:create', 'attendance:approve'},
        kpis: ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            attendanceTelemetryServiceProvider.overrideWithValue(_StubTelemetryService()),
            biometricGuardProvider.overrideWithValue(_StubBiometricGuard()),
            faceRecognitionServiceProvider.overrideWithValue(_StubFaceRecognitionService()),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: AttendanceScreen(profile: profile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Scan Wajah'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Absen Masuk Sekarang'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastClockInPayload, isNull);
      expect(find.textContaining('Wajah tidak cocok'), findsOneWidget);
    });
  });

  group('PermissionSummary & PermissionSetupScreen (Light & Dark)', () {
    test('PermissionSummary computes readyCount & allEssentialGranted accurately', () {
      const partial = PermissionSummary(
        location: AppPermissionStatus.granted,
        locationServiceEnabled: false,
        camera: AppPermissionStatus.granted,
        notifications: AppPermissionStatus.denied,
        biometric: BiometricCapability.fingerprint,
      );
      expect(partial.readyCount, 2);
      expect(partial.allEssentialGranted, isFalse);

      const complete = PermissionSummary(
        location: AppPermissionStatus.granted,
        locationServiceEnabled: true,
        camera: AppPermissionStatus.granted,
        notifications: AppPermissionStatus.granted,
        biometric: BiometricCapability.face,
      );
      expect(complete.readyCount, 4);
      expect(complete.allEssentialGranted, isTrue);
    });

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('PermissionSetupScreen renders 4 sensor cards & requests all in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final stubService = _StubPermissionSetupService();
        var completed = false;

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              permissionSetupServiceProvider.overrideWithValue(stubService),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: PermissionSetupScreen(
                nextRoute: '/login',
                onCompleted: () => completed = true,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Aktifkan Izin Perangkat'), findsOneWidget);
        expect(find.text('2 / 4 Siap'), findsOneWidget);
        expect(find.text('Lokasi & GPS'), findsOneWidget);
        expect(find.text('Kamera'), findsOneWidget);
        expect(find.text('Notifikasi Push'), findsOneWidget);
        expect(find.text('Biometrik HP'), findsOneWidget);
        expect(find.text('Izinkan Semua & Lanjut'), findsOneWidget);
        expect(tester.takeException(), isNull);

        await tester.tap(find.text('Izinkan Semua & Lanjut'));
        await tester.pumpAndSettle();

        expect(stubService.markedDone, isTrue);
        expect(completed, isTrue);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('formatDistanceId & OfficeMapSettingsScreen (Owner)', () {
    test('formatDistanceId formats meters and kilometers cleanly', () {
      expect(formatDistanceId(120), '120 m');
      expect(formatDistanceId(2450), '2.45 km');
    });

    testWidgets('OfficeMapSettingsScreen blocks non-owner roles', (tester) async {
      const staffProfile = ErpProfile(
        employeeId: 'emp-staff',
        employeeCode: 'EK-002',
        fullName: 'Sari Staff',
        email: 'sari@ekalliptus.com',
        username: 'sari',
        roleCode: 'staff',
        roleName: 'Staff',
        permissions: {'attendance:view', 'attendance:create'},
        kpis: ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const OfficeMapSettingsScreen(
              profile: staffProfile,
              enableTileLayer: false,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Khusus Role Owner'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('OfficeMapSettingsScreen loads office & saves update for Owner in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final fakeApi = _FakeAttendanceApiClient();
        const ownerProfile = ErpProfile(
          employeeId: 'emp-owner',
          employeeCode: 'EK-001',
          fullName: 'Alul (Owner)',
          email: 'alul@ekalliptus.com',
          username: 'alul',
          roleCode: 'owner',
          roleName: 'Owner',
          permissions: {'attendance:view', 'attendance:create', 'attendance:update'},
          kpis: ErpKpis(
            totalCashBalance: '0',
            lowStockAlerts: 0,
            pendingAttendanceApprovals: 0,
            draftPayrollRuns: 0,
          ),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(fakeApi),
              attendanceTelemetryServiceProvider.overrideWithValue(_StubTelemetryService()),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: const OfficeMapSettingsScreen(
                profile: ownerProfile,
                enableTileLayer: false,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Kantor Ekalliptus Tegal'), findsOneWidget);
        expect(find.text('Gunakan GPS Saya'), findsOneWidget);
        expect(find.text('Simpan Posisi Kantor'), findsOneWidget);

        await tester.ensureVisible(find.text('Simpan Posisi Kantor'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Simpan Posisi Kantor'));
        await tester.pumpAndSettle();

        expect(fakeApi.lastUpdatedOfficeId, 'office-1');
        expect(fakeApi.lastUpdatedOfficePayload?['name'], 'Kantor Ekalliptus Tegal');
        expect(fakeApi.lastUpdatedOfficePayload?['radius_meters'], 250);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Dedicated Role-Differentiated ProfileScreen', () {
    ErpProfile roleFixture(String roleCode, String roleName, Set<String> perms) {
      return ErpProfile(
        employeeId: 'emp-$roleCode',
        employeeCode: 'EK-100',
        fullName: 'Alul $roleName',
        email: '$roleCode@ekalliptus.com',
        username: roleCode,
        baseSalary: '15000000',
        roleCode: roleCode,
        roleName: roleName,
        permissions: perms,
        kpis: const ErpKpis(
          totalCashBalance: '0',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );
    }

    final roleCases = <({
      String roleCode,
      String roleName,
      Set<String> perms,
      String expectedHeading,
      String expectedDetail,
      String forbiddenHeading,
    })>[
      (
        roleCode: 'owner',
        roleName: 'Owner',
        perms: {
          'finance:view',
          'finance:approve',
          'inventory:view',
          'attendance:view',
          'attendance:update',
          'payroll:view',
          'rbac:view',
          'audit:view',
        },
        expectedHeading: 'Pusat Kontrol Owner',
        expectedDetail: 'Lokasi & Geofence Kantor (Maps)',
        forbiddenHeading: 'Gudang & Prioritas Restock',
      ),
      (
        roleCode: 'finance',
        roleName: 'Finance',
        perms: {'finance:view', 'finance:create', 'finance:approve', 'payroll:view', 'audit:view'},
        expectedHeading: 'Likuiditas & Rekening Aktif',
        expectedDetail: 'BCA Bisnis',
        forbiddenHeading: 'Lokasi & Geofence Kantor (Maps)',
      ),
      (
        roleCode: 'warehouse',
        roleName: 'Warehouse',
        perms: {'inventory:view', 'inventory:create', 'attendance:view', 'attendance:create'},
        expectedHeading: 'Gudang & Prioritas Restock',
        expectedDetail: 'Thermal Printer 80mm (PRT-80)',
        forbiddenHeading: 'Pusat Kontrol Owner',
      ),
      (
        roleCode: 'hr',
        roleName: 'Human Resources',
        perms: {'attendance:view', 'attendance:approve', 'payroll:view', 'rbac:view', 'audit:view'},
        expectedHeading: 'SDM & Antrean Persetujuan',
        expectedDetail: 'Sari Staff (EK-002)',
        forbiddenHeading: 'Likuiditas & Rekening Aktif',
      ),
      (
        roleCode: 'staff',
        roleName: 'Staff',
        perms: {'attendance:view', 'attendance:create', 'inventory:view', 'payroll:view'},
        expectedHeading: 'Jadwal & Lokasi Kerja',
        expectedDetail: 'Kantor Ekalliptus Tegal (09:00 - 17:00)',
        forbiddenHeading: 'Pusat Kontrol Owner',
      ),
    ];

    for (final rc in roleCases) {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

        testWidgets('renders ${rc.roleCode} workspace uniquely in $modeLabel without overflow', (
          tester,
        ) async {
          tester.view.physicalSize = const Size(390, 844);
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);

          final profile = roleFixture(rc.roleCode, rc.roleName, rc.perms);
          final fakeApi = _FakeProfileApiClient(profile: profile);

          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                apiClientProvider.overrideWithValue(fakeApi),
                permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
                pendingOfflineCountProvider.overrideWith((ref) async => 0),
              ],
              child: MaterialApp(
                theme: AppTheme.build(brightness),
                home: ProfileScreen(profile: profile),
              ),
            ),
          );
          await tester.pumpAndSettle();

          expect(find.text('Profil & Ruang Kerja'), findsOneWidget);
          expect(find.text(rc.expectedHeading), findsOneWidget);
          expect(find.text(rc.expectedDetail), findsOneWidget);
          expect(find.text(rc.forbiddenHeading), findsNothing);
          expect(tester.takeException(), isNull);
        });
      }
    }

    testWidgets('supports salary visibility toggle and Edit Profil mutation via API', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final profile = roleFixture(
        'staff',
        'Staff',
        {'attendance:view', 'attendance:create', 'inventory:view', 'payroll:view'},
      );
      final fakeApi = _FakeProfileApiClient(profile: profile);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: ProfileScreen(profile: profile),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('Edit Profil'),
        180,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('Edit Profil'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit Profil'));
      await tester.pumpAndSettle();

      expect(find.text('Edit Profil Akun'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextField, 'Nama Lengkap'),
        'Alul Staff Baru',
      );
      await tester.tap(find.text('Simpan Perubahan'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastUpdatedProfilePayload?['full_name'], 'Alul Staff Baru');
      await tester.scrollUntilVisible(
        find.text('Alul Staff Baru'),
        -220,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Alul Staff Baru'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('Kompensasi & Slip Gaji Pribadi'),
        220,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('Kompensasi & Slip Gaji Pribadi'));
      await tester.pumpAndSettle();

      expect(find.text('Rp •••••••'), findsOneWidget);
      expect(find.text('Rp 15.000.000'), findsNothing);

      await tester.tap(find.byTooltip('Tampilkan nominal gaji'));
      await tester.pumpAndSettle();
      expect(find.text('Rp 15.000.000'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('Perangkat, Sensor, Tema & Keamanan'),
        220,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('Owner User & Employee Manager in RbacAuditScreen (Light & Dark)', () {
    const ownerProfile = ErpProfile(
      employeeId: 'emp-owner',
      employeeCode: 'EK-001',
      fullName: 'Alul (Owner)',
      email: 'alul@ekalliptus.com',
      username: 'owneralul',
      roleCode: 'owner',
      roleName: 'Owner',
      permissions: {
        'rbac:view',
        'rbac:create',
        'rbac:update',
        'rbac:delete',
        'audit:view',
      },
      kpis: ErpKpis(
        totalCashBalance: '0',
        lowStockAlerts: 0,
        pendingAttendanceApprovals: 0,
        draftPayrollRuns: 0,
      ),
    );

    const hrProfile = ErpProfile(
      employeeId: 'emp-hr',
      employeeCode: 'EK-099',
      fullName: 'Hana HR',
      email: 'hr@ekalliptus.com',
      username: 'hanahr',
      roleCode: 'hr',
      roleName: 'Human Resources',
      permissions: {
        'rbac:view',
        'rbac:create',
        'rbac:update',
        'audit:view',
      },
      kpis: ErpKpis(
        totalCashBalance: '0',
        lowStockAlerts: 0,
        pendingAttendanceApprovals: 0,
        draftPayrollRuns: 0,
      ),
    );

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('RbacAuditScreen renders Owner directory, stats & create form cleanly in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final fakeApi = _FakeRbacApiClient();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(fakeApi),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: const Scaffold(body: RbacAuditScreen(profile: ownerProfile)),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Tambah Karyawan Baru'), findsOneWidget);
        expect(find.text('Alul (Owner) (EK-001)'), findsOneWidget);
        expect(find.textContaining('@owneralul'), findsOneWidget);
        expect(find.text('Sari Staff (EK-002)'), findsOneWidget);
        expect(find.text('Budi Baru (EK-003)'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('Owner creates employee with auto-claim code & deletes clean employee', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeRbacApiClient();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: RbacAuditScreen(profile: ownerProfile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Tambah Karyawan Baru'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'after open form');

      expect(find.text('Tambah Karyawan Baru'), findsAtLeastNWidgets(1));
      await tester.enterText(find.widgetWithText(TextField, 'Nama Lengkap'), 'Dewi Gudang');
      await tester.enterText(find.widgetWithText(TextField, 'Email Kerja'), 'dewi@ekalliptus.com');
      await tester.enterText(
        find.widgetWithText(TextField, 'Username Login (Opsional)'),
        'dewi.gudang',
      );

      final saveBtn = find.widgetWithText(FilledButton, 'Simpan Karyawan');
      await tester.ensureVisible(saveBtn);
      await tester.pumpAndSettle();
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'after save employee & claim dialog');

      expect(fakeApi.lastCreatedPayload?['employee_code'], 'EK-004');
      expect(fakeApi.lastCreatedPayload?['full_name'], 'Dewi Gudang');
      expect(fakeApi.lastCreatedPayload?['username'], 'dewi.gudang');
      expect(fakeApi.lastCreatedPayload?['issue_claim_code'], isTrue);
      expect(find.text('EK-TESTCODE01'), findsOneWidget);

      await tester.tap(find.text('Tutup'));
      await tester.pumpAndSettle();
      expect(find.text('Dewi Gudang (EK-004)'), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'after closing claim dialog');

      // Delete Budi Baru (clean employee without history)
      await tester.tap(find.text('Budi Baru (EK-003)'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'after open detail sheet');
      await tester.ensureVisible(find.text('Hapus Karyawan Permanen'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hapus Karyawan Permanen'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'after confirm dialog');

      await tester.tap(find.text('Hapus Permanen'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastDeletedId, 'emp-clean');
      expect(find.text('Budi Baru (EK-003)'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Owner edits, unlinks auth, and falls back to deactivate when delete returns 409', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeRbacApiClient();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.dark),
            home: const Scaffold(body: RbacAuditScreen(profile: ownerProfile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // 1. Delete Sari Staff (409 history conflict) -> fallback to Nonaktifkan Saja
      await tester.tap(find.text('Sari Staff (EK-002)'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Hapus Karyawan Permanen'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hapus Karyawan Permanen'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hapus Permanen'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastDeletedId, 'emp-staff');
      expect(find.text('Tidak Dapat Dihapus Permanen'), findsOneWidget);
      await tester.tap(find.text('Nonaktifkan Saja'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastUpdatedId, 'emp-staff');
      expect(fakeApi.lastUpdatedPayload?['is_active'], isFalse);

      // 2. Unlink Sari Staff's login auth -> emits new claim code EK-UNLINK99
      await tester.tap(find.text('Sari Staff (EK-002)'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Putus Tautan Akun & Buat Kode Baru'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Putus Tautan Akun & Buat Kode Baru'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Putus Tautan'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastUnlinkedId, 'emp-staff');
      expect(find.text('EK-UNLINK99'), findsOneWidget);
      await tester.tap(find.text('Tutup'));
      await tester.pumpAndSettle();

      // 3. Edit Role Permissions via Segment 1: Role
      await tester.tap(find.text('Role (3)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Staff (staff)'));
      await tester.pumpAndSettle();

      expect(find.text('Izin Role Staff'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilterChip, 'Tambah').first);
      await tester.pumpAndSettle();
      final saveRoleBtn = find.widgetWithText(FilledButton, 'Simpan Matriks Izin');
      await tester.ensureVisible(saveRoleBtn);
      await tester.tap(saveRoleBtn);
      await tester.pumpAndSettle();

      expect(fakeApi.lastUpdatedRoleId, 'role-staff');
      expect(fakeApi.lastUpdatedRolePermIds, contains('perm-rbac-create'));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Non-owner (HR) does not see Owner-only delete, unlink, or Owner edit actions', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeRbacApiClient();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: RbacAuditScreen(profile: hrProfile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Sari Staff (EK-002)'));
      await tester.pumpAndSettle();

      expect(find.text('Edit Data & Role Karyawan'), findsOneWidget);
      expect(find.text('Hapus Karyawan Permanen'), findsNothing);
      expect(find.text('Putus Tautan Akun & Buat Kode Baru'), findsNothing);

      Navigator.of(tester.element(find.text('Edit Data & Role Karyawan'))).pop();
      await tester.pumpAndSettle();

      // Tapping Owner row as HR should not show Edit or Delete
      await tester.tap(find.text('Alul (Owner) (EK-001)'));
      await tester.pumpAndSettle();
      expect(find.text('Edit Data & Role Karyawan'), findsNothing);
      expect(find.text('Hapus Karyawan Permanen'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('App Version, Changelog & Update Popup (Light & Dark)', () {
    const ownerProfile = ErpProfile(
      employeeId: 'emp-owner',
      employeeCode: 'EK-001',
      fullName: 'Alul (Owner)',
      email: 'alul@ekalliptus.com',
      username: 'owneralul',
      roleCode: 'owner',
      roleName: 'Owner',
      permissions: {
        'attendance:view',
        'finance:view',
        'inventory:view',
        'payroll:view',
        'rbac:view',
        'rbac:update',
        'audit:view',
      },
      kpis: ErpKpis(
        totalCashBalance: '42500000',
        lowStockAlerts: 3,
        pendingAttendanceApprovals: 2,
        draftPayrollRuns: 1,
      ),
    );

    test('AppVersionCheckResult.fromJson parses latest, hasUpdate, pendingReleases & releases', () {
      final parsed = AppVersionCheckResult.fromJson(
        {
          'platform': 'android',
          'current_version': '1.2.0',
          'current_build': 3,
          'has_update': true,
          'latest': {
            'id': 'rel-4',
            'platform': 'android',
            'version': '1.3.0',
            'build_number': 4,
            'title': 'Rilis Baru',
            'changelog': ['Poin A', 'Poin B'],
            'download_url': 'https://my.ekalliptus.com/apk',
            'is_mandatory': false,
            'published_at': '2026-11-23T09:00:00Z',
          },
          'pending_releases': [
            {
              'id': 'rel-4',
              'platform': 'android',
              'version': '1.3.0',
              'build_number': 4,
              'title': 'Rilis Baru',
              'changelog': ['Poin A', 'Poin B'],
              'download_url': 'https://my.ekalliptus.com/apk',
              'is_mandatory': false,
              'published_at': '2026-11-23T09:00:00Z',
            },
          ],
          'releases': [
            {
              'id': 'rel-4',
              'platform': 'android',
              'version': '1.3.0',
              'build_number': 4,
              'title': 'Rilis Baru',
              'changelog': ['Poin A', 'Poin B'],
              'download_url': 'https://my.ekalliptus.com/apk',
              'is_mandatory': false,
              'published_at': '2026-11-23T09:00:00Z',
            },
            {
              'id': 'rel-3',
              'platform': 'android',
              'version': '1.2.0',
              'build_number': 3,
              'title': 'Rilis Sekarang',
              'changelog': ['Changelog v1.2.0'],
              'download_url': 'https://my.ekalliptus.com',
              'is_mandatory': false,
              'published_at': '2026-11-22T18:45:00Z',
            },
          ],
        },
        fallbackVersion: '1.2.0',
        fallbackBuild: 3,
      );

      expect(parsed.hasUpdate, isTrue);
      expect(parsed.currentVersion, '1.2.0');
      expect(parsed.currentBuild, 3);
      expect(parsed.latest?.version, '1.3.0');
      expect(parsed.latest?.buildNumber, 4);
      expect(parsed.pendingReleases.length, 1);
      expect(parsed.releases.length, 2);
      expect(parsed.latest?.changelog, ['Poin A', 'Poin B']);
    });

    for (final brightness in [Brightness.light, Brightness.dark]) {
      final modeLabel = brightness == Brightness.light ? 'Light' : 'Dark';

      testWidgets('showAppUpdateDialog renders changelog, Update and Nanti in $modeLabel', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        const result = AppVersionCheckResult(
          platform: 'android',
          currentVersion: '1.2.0',
          currentBuild: 3,
          hasUpdate: true,
          latest: AppReleaseInfo(
            id: 'rel-4',
            platform: 'android',
            version: '1.3.0',
            buildNumber: 4,
            title: 'Perbaikan Sinkronisasi Offline',
            changelog: ['Percepatan antrean offline', 'Perbaikan akurasi geofence'],
            downloadUrl: 'https://my.ekalliptus.com/apk',
            isMandatory: false,
            publishedAt: '2026-11-23T09:00:00Z',
          ),
          pendingReleases: [
            AppReleaseInfo(
              id: 'rel-4',
              platform: 'android',
              version: '1.3.0',
              buildNumber: 4,
              title: 'Perbaikan Sinkronisasi Offline',
              changelog: ['Percepatan antrean offline', 'Perbaikan akurasi geofence'],
              downloadUrl: 'https://my.ekalliptus.com/apk',
              isMandatory: false,
              publishedAt: '2026-11-23T09:00:00Z',
            ),
          ],
          releases: [],
        );

        var laterTapped = 0;
        String? updatedUrl;

        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.build(brightness),
            home: Scaffold(
              body: Builder(
                builder: (ctx) => Center(
                  child: FilledButton(
                    onPressed: () {
                      showAppUpdateDialog(
                        ctx,
                        result: result,
                        onLater: () => laterTapped++,
                        onUpdate: (url) async {
                          updatedUrl = url;
                        },
                      );
                    },
                    child: const Text('Buka Dialog'),
                  ),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.text('Buka Dialog'));
        await tester.pumpAndSettle();

        expect(find.text('Pembaruan Aplikasi'), findsOneWidget);
        expect(find.text('Perbaikan Sinkronisasi Offline'), findsOneWidget);
        expect(find.text('Percepatan antrean offline'), findsOneWidget);
        expect(find.text('Nanti'), findsOneWidget);
        expect(find.text('Update'), findsOneWidget);

        await tester.tap(find.text('Nanti'));
        await tester.pumpAndSettle();
        expect(laterTapped, 1);
        expect(find.text('Pembaruan Aplikasi'), findsNothing);

        await tester.tap(find.text('Buka Dialog'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Update'));
        await tester.pumpAndSettle();
        expect(updatedUrl, 'https://my.ekalliptus.com/apk');
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('showAppUpdateDialog downloads APK in-app with live progress and triggers installApk', (
      tester,
    ) async {
      const result = AppVersionCheckResult(
        platform: 'android',
        currentVersion: '1.3.1',
        currentBuild: 5,
        hasUpdate: true,
        latest: AppReleaseInfo(
          id: 'rel-6',
          platform: 'android',
          version: '1.3.2',
          buildNumber: 6,
          title: 'Pembaruan Langsung di Dalam Aplikasi',
          changelog: ['Unduh APK langsung tanpa keluar ke browser'],
          downloadUrl: '/api/app/download/android?build=6',
          fileSizeBytes: 37448860,
          hasApk: true,
          isMandatory: false,
          publishedAt: '2026-11-24T09:00:00Z',
        ),
        pendingReleases: [],
        releases: [],
      );

      final downloadCompleter = Completer<String>();
      final fakeService = _InAppAppUpdateService(
        _FakeProfileApiClient(profile: ownerProfile, simulateUpdate: true),
        onDownload: (onProgress, _) async {
          onProgress?.call(
            const ApkDownloadProgress(
              receivedBytes: 15728640,
              totalBytes: 37448860,
            ),
          );
          return downloadCompleter.future;
        },
      );
      var browserCalls = 0;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.build(Brightness.light),
          home: Scaffold(
            body: Builder(
              builder: (ctx) => Center(
                child: FilledButton(
                  onPressed: () {
                    showAppUpdateDialog(
                      ctx,
                      result: result,
                      updateService: fakeService,
                      onLater: () {},
                      onUpdate: (_) async => browserCalls++,
                    );
                  },
                  child: const Text('Buka Dialog'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Buka Dialog'));
      await tester.pumpAndSettle();
      expect(find.text('Ukuran unduhan: 35.7 MB'), findsOneWidget);

      await tester.tap(find.text('Update'));
      await tester.pump();
      expect(find.text('Mengunduh pembaruan v1.3.2...'), findsOneWidget);
      expect(find.text('42%'), findsOneWidget);
      expect(find.text('15.0 MB / 35.7 MB'), findsOneWidget);
      expect(find.text('Batal'), findsOneWidget);
      expect(browserCalls, 0);
      expect(fakeService.openedUrls, isEmpty);

      downloadCompleter.complete('/data/user/0/app/cache/apk_updates/MyEkalliptus-v1.3.2-b6.apk');
      await tester.pumpAndSettle();

      expect(fakeService.installedPaths, ['/data/user/0/app/cache/apk_updates/MyEkalliptus-v1.3.2-b6.apk']);
      expect(find.text('Pasang Ulang'), findsOneWidget);
      expect(find.text('Unduhan selesai. Ikuti konfirmasi pemasangan dari sistem Android.'), findsOneWidget);
      expect(browserCalls, 0);
      expect(tester.takeException(), isNull);
    });

    testWidgets('showAppUpdateDialog requests install permission and resumes install cleanly', (
      tester,
    ) async {
      const result = AppVersionCheckResult(
        platform: 'android',
        currentVersion: '1.3.1',
        currentBuild: 5,
        hasUpdate: true,
        latest: AppReleaseInfo(
          id: 'rel-6',
          platform: 'android',
          version: '1.3.2',
          buildNumber: 6,
          title: 'Pembaruan Langsung di Dalam Aplikasi',
          changelog: ['Unduh APK langsung'],
          downloadUrl: '/api/app/download/android?build=6',
          hasApk: true,
          isMandatory: false,
          publishedAt: '2026-11-24T09:00:00Z',
        ),
        pendingReleases: [],
        releases: [],
      );

      var permissionGranted = false;
      final fakeService = _InAppAppUpdateService(
        _FakeProfileApiClient(profile: ownerProfile, simulateUpdate: true),
        onInstall: (_) async => permissionGranted
            ? const ApkInstallResult(outcome: ApkInstallOutcome.launched)
            : const ApkInstallResult(outcome: ApkInstallOutcome.permissionRequired),
        onCanInstall: () async => permissionGranted,
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.build(Brightness.dark),
          home: Scaffold(
            body: Builder(
              builder: (ctx) => Center(
                child: FilledButton(
                  onPressed: () {
                    showAppUpdateDialog(
                      ctx,
                      result: result,
                      updateService: fakeService,
                      onLater: () {},
                    );
                  },
                  child: const Text('Buka Dialog'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Buka Dialog'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Update'));
      await tester.pumpAndSettle();

      expect(find.text('Izinkan & Pasang'), findsOneWidget);
      await tester.tap(find.text('Izinkan & Pasang'));
      await tester.pump();
      expect(fakeService.permissionSettingsOpened, 1);

      permissionGranted = true;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(fakeService.installedPaths, hasLength(2));
      expect(find.text('Pasang Ulang'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('showAppUpdateDialog shows download error and retries via Coba Lagi', (
      tester,
    ) async {
      const result = AppVersionCheckResult(
        platform: 'android',
        currentVersion: '1.3.1',
        currentBuild: 5,
        hasUpdate: true,
        latest: AppReleaseInfo(
          id: 'rel-6',
          platform: 'android',
          version: '1.3.2',
          buildNumber: 6,
          title: 'Pembaruan Langsung',
          changelog: ['Unduh APK langsung'],
          downloadUrl: '/api/app/download/android?build=6',
          hasApk: true,
          isMandatory: false,
          publishedAt: '2026-11-24T09:00:00Z',
        ),
        pendingReleases: [],
        releases: [],
      );

      var attempts = 0;
      final fakeService = _InAppAppUpdateService(
        _FakeProfileApiClient(profile: ownerProfile, simulateUpdate: true),
        onDownload: (_, __) async {
          attempts++;
          if (attempts == 1) {
            throw Exception('Koneksi terputus saat mengunduh.');
          }
          return '/cache/apk_updates/MyEkalliptus-v1.3.2-b6.apk';
        },
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.build(Brightness.light),
          home: Scaffold(
            body: Builder(
              builder: (ctx) => Center(
                child: FilledButton(
                  onPressed: () {
                    showAppUpdateDialog(
                      ctx,
                      result: result,
                      updateService: fakeService,
                      onLater: () {},
                    );
                  },
                  child: const Text('Buka Dialog'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Buka Dialog'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Update'));
      await tester.pumpAndSettle();

      expect(find.text('Koneksi terputus saat mengunduh.'), findsOneWidget);
      expect(find.text('Coba Lagi'), findsOneWidget);

      await tester.tap(find.text('Coba Lagi'));
      await tester.pumpAndSettle();

      expect(attempts, 2);
      expect(find.text('Pasang Ulang'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('ProfileScreen displays version card, Changelog sheet & update popup on Cek Update', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeProfileApiClient(profile: ownerProfile, simulateUpdate: true);
      final fakeUpdateService = _TrackingAppUpdateService(fakeApi);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            appUpdateServiceProvider.overrideWithValue(fakeUpdateService),
            permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const ProfileScreen(profile: ownerProfile),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('Versi Aplikasi & Pembaruan'),
        240,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('Changelog'));
      await tester.pumpAndSettle();

      expect(find.text('Versi Aplikasi & Pembaruan'), findsOneWidget);
      expect(find.text('MyEkalliptus Android · v1.2.0 (Build 3)'), findsOneWidget);
      expect(find.text('Update v1.3.0'), findsOneWidget);

      await tester.tap(find.text('Changelog'));
      await tester.pumpAndSettle();
      expect(find.text('Riwayat Pembaruan & Changelog'), findsOneWidget);
      expect(find.text('Publikasikan Rilis Baru'), findsOneWidget);

      Navigator.of(tester.element(find.text('Riwayat Pembaruan & Changelog'))).pop();
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Cek Update'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cek Update'));
      await tester.pumpAndSettle();

      expect(find.text('Pembaruan Aplikasi'), findsOneWidget);
      expect(find.text('Percepatan sinkronisasi offline queue'), findsOneWidget);
      await tester.tap(find.text('Update'));
      await tester.pumpAndSettle();
      expect(fakeUpdateService.lastOpenedUrl, 'https://my.ekalliptus.com/update-apk');
      expect(tester.takeException(), isNull);
    });

    testWidgets('FloatingNavShell checks update automatically and records snooze when Nanti tapped', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeProfileApiClient(profile: ownerProfile, simulateUpdate: true);
      final fakeUpdateService = _TrackingAppUpdateService(fakeApi);
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(fakeApi),
          appUpdateServiceProvider.overrideWithValue(fakeUpdateService),
          permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
          pendingOfflineCountProvider.overrideWith((ref) async => 0),
          unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const FloatingNavShell(
              profile: ownerProfile,
              currentLocation: '/dashboard',
              child: DashboardScreen(profile: ownerProfile),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Pembaruan Aplikasi'), findsOneWidget);
      expect(find.text('Percepatan sinkronisasi offline queue'), findsOneWidget);
      expect(find.text('Nanti'), findsOneWidget);
      expect(find.text('Update'), findsOneWidget);

      await tester.tap(find.text('Nanti'));
      await tester.pumpAndSettle();
      expect(find.text('Pembaruan Aplikasi'), findsNothing);
      expect(container.read(dismissedUpdateBuildProvider), 4);
      expect(tester.takeException(), isNull);
    });

    testWidgets('ProfileScreen displays Data Wajah section, updates via 4-step scan & deletes face data', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakeProfileApiClient(
        profile: ownerProfile,
        faceEnrolled: true,
        faceSampleCount: 4,
        faceModels: const ['mobile_facenet_192d'],
      );
      final fakeUpdateService = _TrackingAppUpdateService(fakeApi);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            appUpdateServiceProvider.overrideWithValue(fakeUpdateService),
            faceRecognitionServiceProvider.overrideWithValue(_StubFaceRecognitionService()),
            permissionSetupServiceProvider.overrideWithValue(_StubPermissionSetupService()),
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const ProfileScreen(profile: ownerProfile),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('Data Wajah (Absensi)'),
        220,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('Perbarui Wajah'));
      await tester.pumpAndSettle();

      expect(find.text('Terdaftar · 4 Sudut'), findsOneWidget);

      await tester.tap(find.text('Perbarui Wajah'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastEnrollFacePayload, isNotNull);
      expect(fakeApi.lastEnrollFacePayload?['replace'], isTrue);
      expect((fakeApi.lastEnrollFacePayload?['face_samples'] as List).length, 4);

      await tester.ensureVisible(find.text('Hapus'));
      await tester.tap(find.text('Hapus'));
      await tester.pumpAndSettle();

      expect(find.text('Hapus Data Wajah?'), findsOneWidget);
      await tester.tap(find.text('Hapus Data Wajah'));
      await tester.pumpAndSettle();

      expect(fakeApi.didDeleteFace, isTrue);
      expect(find.text('Belum Terdaftar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  registerActivationFlowTests();
}

class _FakeActivationAuthService extends AuthService {
  String? signedUpName;
  String? signedUpEmail;
  String? signedUpPassword;

  @override
  Future<AuthSessionSnapshot?> restoreSession() async => null;

  @override
  Future<AuthSessionSnapshot> signUpEmail({
    required String name,
    required String email,
    required String password,
  }) async {
    signedUpName = name;
    signedUpEmail = email;
    signedUpPassword = password;
    return AuthSessionSnapshot(jwt: 'fake-jwt', email: email);
  }
}

class _FakeActivationApiClient extends ApiClient {
  String? lastPreviewCode;
  String? claimedCode;
  String? updatedUsername;

  _FakeActivationApiClient({required AuthService auth}) : super(auth: auth);

  @override
  Future<Map<String, dynamic>> previewClaimCode(String code) async {
    lastPreviewCode = code;
    if (code == 'EK-AB12CD34EF') {
      return {
        'valid': true,
        'employee': {
          'employee_code': 'EK-002',
          'full_name': 'Sofi',
          'email': 'sofi@ekalliptus.com',
          'username': 'sofi',
          'role_code': 'staff',
          'role_name': 'Staff',
        },
      };
    }
    if (code == 'EK-NOUSER1234') {
      return {
        'valid': true,
        'employee': {
          'employee_code': 'EK-003',
          'full_name': 'Budi Santoso',
          'email': 'budi@ekalliptus.com',
          'username': null,
          'role_code': 'finance',
          'role_name': 'Finance',
        },
      };
    }
    throw const ApiException(
      'Kode aktivasi tidak ditemukan atau sudah digunakan.',
      statusCode: 404,
    );
  }

  @override
  Future<void> claimAccount(String code) async {
    claimedCode = code;
  }

  @override
  Future<String?> setUsername(String username) async {
    updatedUsername = username;
    return username;
  }
}

class _TrackingAppUpdateService extends AppUpdateService {
  String? lastOpenedUrl;

  _TrackingAppUpdateService(super.api);

  @override
  Future<InstalledAppVersion> getInstalledVersion() async {
    return const InstalledAppVersion(version: '1.2.0', buildNumber: 3);
  }

  @override
  Future<bool> openUpdateUrl(String url) async {
    lastOpenedUrl = url;
    return true;
  }
}

class _InAppAppUpdateService extends AppUpdateService {
  final Future<String> Function(
    void Function(ApkDownloadProgress progress)? onProgress,
    CancelToken? cancelToken,
  )? _onDownload;
  final Future<ApkInstallResult> Function(String filePath)? _onInstall;
  final Future<bool> Function()? _onCanInstall;

  final List<String> openedUrls = [];
  final List<String> installedPaths = [];
  int permissionSettingsOpened = 0;

  _InAppAppUpdateService(
    super.api, {
    Future<String> Function(
      void Function(ApkDownloadProgress progress)? onProgress,
      CancelToken? cancelToken,
    )? onDownload,
    Future<ApkInstallResult> Function(String filePath)? onInstall,
    Future<bool> Function()? onCanInstall,
  }) : _onDownload = onDownload,
       _onInstall = onInstall,
       _onCanInstall = onCanInstall;

  @override
  bool get supportsInAppInstall => true;

  @override
  Future<bool> openUpdateUrl(String url) async {
    openedUrls.add(url);
    return true;
  }

  @override
  Future<String> downloadApk(
    AppReleaseInfo release, {
    void Function(ApkDownloadProgress progress)? onProgress,
    CancelToken? cancelToken,
  }) async {
    if (_onDownload != null) {
      return _onDownload(onProgress, cancelToken);
    }
    return '/cache/apk_updates/MyEkalliptus-v${release.version}-b${release.buildNumber}.apk';
  }

  @override
  Future<ApkInstallResult> installApk(String filePath) async {
    installedPaths.add(filePath);
    if (_onInstall != null) {
      return _onInstall(filePath);
    }
    return const ApkInstallResult(outcome: ApkInstallOutcome.launched);
  }

  @override
  Future<bool> canInstallPackages() async {
    if (_onCanInstall != null) {
      return _onCanInstall();
    }
    return true;
  }

  @override
  Future<bool> openInstallPermissionSettings() async {
    permissionSettingsOpened++;
    return true;
  }
}

void registerActivationFlowTests() {
  group('Aktivasi Pertama auto-fetch via Kode Aktivasi (Light & Dark)', () {
    testWidgets('Kode valid memuat data otomatis & aktivasi cukup isi kata sandi', (
      tester,
    ) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final fakeAuth = _FakeActivationAuthService();
        final fakeApi = _FakeActivationApiClient(auth: fakeAuth);
        var authenticated = false;

        await tester.pumpWidget(
          ProviderScope(
            key: ValueKey('activation-${brightness.name}'),
            overrides: [
              authServiceProvider.overrideWithValue(fakeAuth),
              apiClientProvider.overrideWithValue(fakeApi),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: LoginScreen(onAuthenticated: () => authenticated = true),
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Aktivasi'));
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('activation-code-field')), findsOneWidget);
        expect(find.byKey(const ValueKey('auth-password-field')), findsNothing);
        expect(find.text('Data Karyawan Terverifikasi'), findsNothing);

        await tester.enterText(
          find.byKey(const ValueKey('activation-code-field')),
          'ek-ab12cd34ef',
        );
        await tester.pump(const Duration(milliseconds: 220));
        await tester.pumpAndSettle();

        expect(fakeApi.lastPreviewCode, 'EK-AB12CD34EF');
        expect(find.text('Data Karyawan Terverifikasi'), findsOneWidget);
        expect(find.text('Sofi'), findsOneWidget);
        expect(find.text('sofi@ekalliptus.com'), findsOneWidget);
        expect(find.text('@sofi'), findsOneWidget);
        expect(find.text('EK-002'), findsOneWidget);
        expect(find.byKey(const ValueKey('activation-optional-username')), findsNothing);
        expect(find.byKey(const ValueKey('auth-password-field')), findsOneWidget);

        await tester.enterText(
          find.byKey(const ValueKey('auth-password-field')),
          'Sandikuat99!',
        );
        await tester.ensureVisible(find.text('Aktifkan & Masuk'));
        await tester.tap(find.text('Aktifkan & Masuk'));
        await tester.pumpAndSettle();

        expect(fakeAuth.signedUpEmail, 'sofi@ekalliptus.com');
        expect(fakeAuth.signedUpName, 'Sofi');
        expect(fakeApi.claimedCode, 'EK-AB12CD34EF');
        expect(fakeApi.updatedUsername, isNull);
        expect(find.text('Memproses sesi...'), findsNothing);
        expect(find.textContaining('gagal'), findsNothing);
        expect(authenticated, isTrue);
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('Kode valid tanpa username dari owner tampilkan opsional & tetap bisa aktivasi', (
      tester,
    ) async {
      final fakeAuth = _FakeActivationAuthService();
      final fakeApi = _FakeActivationApiClient(auth: fakeAuth);
      var authenticated = false;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authServiceProvider.overrideWithValue(fakeAuth),
            apiClientProvider.overrideWithValue(fakeApi),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: LoginScreen(onAuthenticated: () => authenticated = true),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Aktivasi'));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('activation-code-field')),
        'EK-NOUSER1234',
      );
      await tester.pump(const Duration(milliseconds: 220));
      await tester.pumpAndSettle();

      expect(find.text('Budi Santoso'), findsOneWidget);
      expect(find.text('Belum diatur (opsional)'), findsOneWidget);
      expect(find.byKey(const ValueKey('activation-optional-username')), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('auth-password-field')),
        'Sandikuat99!',
      );
      await tester.ensureVisible(find.text('Aktifkan & Masuk'));
      await tester.tap(find.text('Aktifkan & Masuk'));
      await tester.pumpAndSettle();

      expect(fakeAuth.signedUpEmail, 'budi@ekalliptus.com');
      expect(fakeApi.claimedCode, 'EK-NOUSER1234');
      expect(fakeApi.updatedUsername, isNull);
      expect(authenticated, isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Kode salah menampilkan pesan error & tombol aktivasi tetap nonaktif', (
      tester,
    ) async {
      final fakeAuth = _FakeActivationAuthService();
      final fakeApi = _FakeActivationApiClient(auth: fakeAuth);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authServiceProvider.overrideWithValue(fakeAuth),
            apiClientProvider.overrideWithValue(fakeApi),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.dark),
            home: const LoginScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Aktivasi'));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('activation-code-field')),
        'EK-WRONGCODE1',
      );
      await tester.pump(const Duration(milliseconds: 220));
      await tester.pumpAndSettle();

      expect(find.text('Kode aktivasi tidak ditemukan atau sudah digunakan.'), findsOneWidget);
      expect(find.byKey(const ValueKey('auth-password-field')), findsNothing);
      final submitBtn = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(submitBtn.onPressed, isNull);
      expect(tester.takeException(), isNull);
    });
  });

  group('Kasir / POS & Laporan Penjualan (Light & Dark)', () {
    testWidgets('Kasir adds catalog + manual item, checks out cash & shows digital receipt in Light', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakePosApiClient();
      const ownerProfile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'finance:view', 'finance:create', 'finance:approve'},
        kpis: ErpKpis(
          totalCashBalance: '2500000',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            appUpdateServiceProvider.overrideWithValue(AppUpdateService(fakeApi)),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: const Scaffold(body: FinanceScreen(profile: ownerProfile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Kertas A4 Rim'));
      await tester.pumpAndSettle();
      expect(find.text('1x di keranjang'), findsOneWidget);

      await tester.tap(find.text('Manual'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Nama Produk / Jasa'),
        'Jasa Packing',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Harga Satuan (Rp)'),
        '30000',
      );
      await tester.tap(find.text('Tambahkan ke Keranjang'));
      await tester.pumpAndSettle();

      expect(find.text('Bayar'), findsOneWidget);
      await tester.tap(find.text('Bayar'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('100rb'));
      await tester.tap(find.text('100rb'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Bayar & Terbitkan Struk'));
      await tester.tap(find.text('Bayar & Terbitkan Struk'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastCreateSalePayload, isNotNull);
      expect((fakeApi.lastCreateSalePayload?['items'] as List).length, 2);
      expect(fakeApi.lastCreateSalePayload?['payment_method'], 'cash');
      expect(fakeApi.lastCreateSalePayload?['paid_amount'], 100000);
      expect(find.text('Struk POS-TEST-001'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Laporan & Riwayat tab displays sales report & executes Void in Dark', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakePosApiClient();
      const ownerProfile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'finance:view', 'finance:create', 'finance:approve'},
        kpis: ErpKpis(
          totalCashBalance: '2500000',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            appUpdateServiceProvider.overrideWithValue(AppUpdateService(fakeApi)),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.dark),
            home: const Scaffold(body: FinanceScreen(profile: ownerProfile)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Laporan & Riwayat'));
      await tester.pumpAndSettle();

      expect(find.text('Omzet Penjualan Hari Ini'), findsOneWidget);
      expect(find.textContaining('POS-261123-AA01'), findsOneWidget);

      await tester.ensureVisible(find.textContaining('POS-261123-AA01'));
      await tester.tap(find.textContaining('POS-261123-AA01'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('Void / Retur Transaksi'));
      await tester.tap(find.text('Void / Retur Transaksi'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Ya, Void'));
      await tester.pumpAndSettle();

      expect(fakeApi.lastVoidedSaleId, 'sale-1');
      expect(tester.takeException(), isNull);
    });

    testWidgets('FinanceScreen inside nested Navigator opens Tambah Item Manual above FloatingNavShell dock', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final fakeApi = _FakePosApiClient();
      const ownerProfile = ErpProfile(
        employeeId: 'emp-owner',
        employeeCode: 'EK-001',
        fullName: 'Alul (Owner)',
        email: 'alul@ekalliptus.com',
        username: 'alul',
        roleCode: 'owner',
        roleName: 'Owner',
        permissions: {'dashboard:view', 'finance:view', 'finance:create', 'attendance:view'},
        kpis: ErpKpis(
          totalCashBalance: '2500000',
          lowStockAlerts: 0,
          pendingAttendanceApprovals: 0,
          draftPayrollRuns: 0,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(fakeApi),
            appUpdateServiceProvider.overrideWithValue(
              _TrackingAppUpdateService(_FakeProfileApiClient(profile: ownerProfile)),
            ),
            pendingOfflineCountProvider.overrideWith((ref) async => 0),
            unreadNotificationsProvider.overrideWith(_StubUnreadNotificationsController.new),
          ],
          child: MaterialApp(
            theme: AppTheme.build(Brightness.light),
            home: FloatingNavShell(
              profile: ownerProfile,
              currentLocation: '/finance',
              child: Navigator(
                onGenerateRoute: (_) => MaterialPageRoute<void>(
                  builder: (_) => const Scaffold(
                    body: FinanceScreen(profile: ownerProfile),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Manual'));
      await tester.pumpAndSettle();

      expect(find.text('Tambah Item Manual'), findsOneWidget);
      expect(find.text('Tambahkan ke Keranjang'), findsOneWidget);

      await tester.enterText(
        find.widgetWithText(TextField, 'Nama Produk / Jasa'),
        'Ongkir Kurir',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Harga Satuan (Rp)'),
        '25000',
      );
      await tester.tap(find.text('Tambahkan ke Keranjang'));
      await tester.pumpAndSettle();

      expect(find.text('Ongkir Kurir'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

class _FakePosApiClient extends ApiClient {
  Map<String, dynamic>? lastCreateSalePayload;
  String? lastVoidedSaleId;

  _FakePosApiClient() : super(auth: AuthService());

  @override
  Future<Map<String, dynamic>> fetchPosCatalog() async {
    return {
      'warehouses': [
        {'id': 'wh-1', 'name': 'Gudang Utama', 'is_default': true},
      ],
      'default_warehouse_id': 'wh-1',
      'accounts': [
        {'id': 'acc-cash', 'name': 'Kas Tunai', 'type': 'cash', 'balance': '2000000'},
        {'id': 'acc-qris', 'name': 'QRIS Toko', 'type': 'qris', 'balance': '500000'},
      ],
      'products': [
        {
          'id': 'item-1',
          'sku': 'SKU-01',
          'barcode': '899100',
          'name': 'Kertas A4 Rim',
          'unit': 'rim',
          'cost_price': '35000',
          'sell_price': '50000',
          'min_stock': 5,
          'stocks_by_warehouse': {'wh-1': 10},
          'total_stock': 10,
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> fetchPosSales({
    String? status,
    String? paymentMethod,
  }) async {
    return {
      'sales': [
        {
          'id': 'sale-1',
          'sale_number': 'POS-261123-AA01',
          'payment_method': 'cash',
          'subtotal': '100000',
          'discount_amount': '0',
          'tax_percent': 0,
          'tax_amount': '0',
          'total_amount': '100000',
          'paid_amount': '100000',
          'change_amount': '0',
          'status': 'completed',
          'cashier_name': 'Alul (Owner)',
          'created_at': '2026-11-23T01:00:00Z',
          'items': [
            {
              'id': 'si-1',
              'item_name': 'Kertas A4 Rim',
              'qty': 2,
              'unit': 'rim',
              'line_total': '100000',
            },
          ],
        },
      ],
      'report': {
        'today_revenue': '100000',
        'today_count': 1,
        'today_avg_ticket': '100000',
        'void_count': 0,
        'by_payment_method': {
          'cash': {'count': 1, 'total': '100000'},
          'qris': {'count': 0, 'total': '0'},
          'transfer': {'count': 0, 'total': '0'},
          'ewallet': {'count': 0, 'total': '0'},
        },
        'top_products': [
          {
            'sku': 'SKU-01',
            'item_name': 'Kertas A4 Rim',
            'unit': 'rim',
            'qty_sold': 2,
            'revenue': '100000',
          },
        ],
        'accounts': [
          {'id': 'acc-cash', 'name': 'Kas Tunai', 'balance': '2000000'},
        ],
      },
    };
  }

  @override
  Future<Map<String, dynamic>> createPosSale(Map<String, dynamic> body) async {
    lastCreateSalePayload = body;
    return {
      'sale': {
        'id': 'sale-new',
        'sale_number': 'POS-TEST-001',
        'cashier_name': 'Alul (Owner)',
        'payment_method': body['payment_method'],
        'subtotal': '80000',
        'discount_amount': '0',
        'tax_percent': body['tax_percent'] ?? 0,
        'tax_amount': '0',
        'total_amount': '80000',
        'paid_amount': body['paid_amount'].toString(),
        'change_amount': '20000',
        'status': 'completed',
        'created_at': '2026-11-23T01:20:00Z',
        'items': [
          {
            'item_name': 'Kertas A4 Rim',
            'qty': 1,
            'unit': 'rim',
            'line_total': '50000',
          },
          {
            'item_name': 'Jasa Packing',
            'qty': 1,
            'unit': 'paket',
            'line_total': '30000',
          },
        ],
      },
    };
  }

  @override
  Future<Map<String, dynamic>> voidPosSale(String saleId, {String? reason}) async {
    lastVoidedSaleId = saleId;
    return {
      'sale': {'id': saleId, 'status': 'void'},
    };
  }
}
