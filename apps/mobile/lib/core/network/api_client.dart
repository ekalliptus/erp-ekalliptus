import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../auth/auth_service.dart';
import '../config/app_config.dart';
import '../notifications/notification_models.dart';
import '../rbac/rbac_state.dart';

class ApiException implements Exception {
  final int? statusCode;
  final String message;
  final Map<String, dynamic>? details;

  const ApiException(this.message, {this.statusCode, this.details});

  bool get isNetworkOrServerError => statusCode == null || statusCode! >= 500;

  @override
  String toString() => message;
}

String _extractErrorMessage(dynamic body, String fallback) {
  if (body is Map<String, dynamic>) {
    final err = body['error'];
    if (err is String && err.trim().isNotEmpty) {
      return err;
    }
    if (err is Map) {
      final msgs = <String>[];
      final formErrors = err['formErrors'];
      if (formErrors is List) {
        for (final item in formErrors) {
          final s = item?.toString().trim() ?? '';
          if (s.isNotEmpty) msgs.add(s);
        }
      }
      final fieldErrors = err['fieldErrors'];
      if (fieldErrors is Map) {
        for (final entry in fieldErrors.entries) {
          final val = entry.value;
          if (val is List) {
            for (final item in val) {
              final s = item?.toString().trim() ?? '';
              if (s.isNotEmpty) msgs.add('${entry.key}: $s');
            }
          }
        }
      }
      if (msgs.isNotEmpty) return msgs.join('; ');
    }
    final msg = body['message'];
    if (msg is String && msg.trim().isNotEmpty) {
      return msg;
    }
  }
  return fallback;
}

/// Returns true only for transient connectivity/timeout/5xx failures eligible for Drift offline queue.
bool isOfflineRecoverableError(Object err) {
  if (err is ApiException) {
    return err.isNetworkOrServerError;
  }
  if (err is DioException) {
    final code = err.response?.statusCode;
    return code == null || code >= 500;
  }
  return false;
}

class ApiClient {
  final Dio _dio;
  final AuthService _auth;

  ApiClient({required AuthService auth, Dio? dio})
      : _auth = auth,
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: AppConfig.apiBaseUrl,
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 25),
                headers: const {'X-Platform': 'flutter'},
              ),
            );

  Future<Map<String, String>> _authHeaders() async {
    final jwt = await _auth.readStoredJwt();
    if (jwt == null || jwt.isEmpty) {
      throw const ApiException('Sesi login belum aktif.', statusCode: 401);
    }
    return {
      'Authorization': 'Bearer $jwt',
      'X-Platform': 'flutter',
    };
  }

  Future<T> _request<T>(
    String method,
    String path, {
    dynamic data,
  }) async {
    try {
      final headers = await _authHeaders();
      final res = await _dio.request<T>(
        path,
        data: data,
        options: Options(method: method, headers: headers),
      );
      return res.data as T;
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        final nextJwt = await _auth.refreshJwt();
        if (nextJwt != null) {
          final headers = {
            'Authorization': 'Bearer $nextJwt',
            'X-Platform': 'flutter',
          };
          final retryRes = await _dio.request<T>(
            path,
            data: data,
            options: Options(method: method, headers: headers),
          );
          return retryRes.data as T;
        }
      }
      final body = e.response?.data;
      final msg = _extractErrorMessage(
        body,
        e.message ?? 'Koneksi ke server MyEkalliptus gagal.',
      );
      throw ApiException(
        msg,
        statusCode: e.response?.statusCode,
        details: body is Map<String, dynamic> ? body : null,
      );
    }
  }

  Future<void> rawSend(String method, String path, Map<String, dynamic> payload) async {
    await _request<dynamic>(method, path, data: payload);
  }

  /// Permintaan tanpa JWT, untuk endpoint publik pra-login.
  Future<T> _publicRequest<T>(
    String method,
    String path, {
    dynamic data,
  }) async {
    try {
      final res = await _dio.request<T>(
        path,
        data: data,
        options: Options(
          method: method,
          headers: {'X-Platform': 'flutter'},
        ),
      );
      return res.data as T;
    } on DioException catch (e) {
      final body = e.response?.data;
      final msg = _extractErrorMessage(
        body,
        e.message ?? 'Koneksi ke server MyEkalliptus gagal.',
      );
      throw ApiException(
        msg,
        statusCode: e.response?.statusCode,
        details: body is Map<String, dynamic> ? body : null,
      );
    }
  }

  /// Resolusi username ke email kerja untuk login tanpa email.
  Future<String?> lookupUsernameEmail(String username) async {
    final res = await _publicRequest<Map<String, dynamic>>(
      'POST',
      '/api/auth/username-lookup',
      data: {'username': username},
    );
    return res['email'] as String?;
  }

  /// Pratinjau data karyawan dari kode aktivasi sebelum mendaftar (publik).
  Future<Map<String, dynamic>> previewClaimCode(String code) async {
    return _publicRequest<Map<String, dynamic>>(
      'POST',
      '/api/auth/claim-preview',
      data: {'code': code.trim().toUpperCase()},
    );
  }

  /// Klaim karyawan dengan kode aktivasi (endpoint publik + Bearer JWT).
  Future<void> claimAccount(String code) async {
    await _request<dynamic>('POST', '/api/auth/claim', data: {'code': code});
  }

  /// Simpan username milik karyawan yang sedang login.
  Future<String?> setUsername(String username) async {
    final res = await _request<Map<String, dynamic>>(
      'POST',
      '/api/me/username',
      data: {'username': username},
    );
    return res['username'] as String?;
  }

  Future<ErpProfile> fetchMe() async {
    final res = await _request<Map<String, dynamic>>('GET', '/api/me');
    return ErpProfile.fromJson(res);
  }

  Future<Map<String, dynamic>> fetchProfileSummary() async {
    return _request<Map<String, dynamic>>('GET', '/api/me/profile-summary');
  }

  Future<Map<String, dynamic>> updateMyProfile(Map<String, dynamic> body) async {
    return _request<Map<String, dynamic>>('PATCH', '/api/me/profile', data: body);
  }

  Future<Map<String, dynamic>> fetchFinanceDashboard() async {
    final results = await Future.wait([
      _request<Map<String, dynamic>>('GET', '/api/finance/summary'),
      _request<Map<String, dynamic>>('GET', '/api/finance/accounts'),
      _request<Map<String, dynamic>>('GET', '/api/finance/transactions'),
      _request<Map<String, dynamic>>('GET', '/api/finance/categories'),
      _request<Map<String, dynamic>>('GET', '/api/finance/obligations'),
    ]);
    return {
      'summary': results[0],
      'accounts': results[1]['accounts'] ?? const [],
      'transactions': results[2]['transactions'] ?? const [],
      'categories': results[3]['categories'] ?? const [],
      'obligations': results[4]['obligations'] ?? const [],
    };
  }

  Future<void> createTransaction(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/finance/transactions', data: body);
  }

  Future<List<dynamic>> fetchFinanceAccounts() async {
    final res = await _request<Map<String, dynamic>>('GET', '/api/finance/accounts');
    return (res['accounts'] as List<dynamic>?) ?? const [];
  }

  Future<void> createObligation(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/finance/obligations', data: body);
  }

  Future<void> payObligation(String id, Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/finance/obligations/$id/pay', data: body);
  }

  Future<void> registerDeviceToken(String token, {String platform = 'flutter'}) async {
    await _request<dynamic>(
      'POST',
      '/api/notifications/tokens',
      data: {'token': token, 'platform': platform},
    );
  }

  Future<void> unregisterDeviceToken(String token) async {
    await _request<dynamic>(
      'POST',
      '/api/notifications/tokens/unregister',
      data: {'token': token},
    );
  }

  Future<int> fetchUnreadNotificationCount() async {
    final res = await _request<Map<String, dynamic>>('GET', '/api/notifications/unread-count');
    return (res['unread'] as num?)?.toInt() ?? 0;
  }

  Future<List<NotificationEntry>> fetchNotifications({int limit = 30}) async {
    final res = await _request<Map<String, dynamic>>(
      'GET',
      '/api/notifications?limit=$limit',
    );
    final rows = (res['notifications'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    return rows.map(NotificationEntry.fromJson).toList();
  }

  Future<void> markAllNotificationsRead() async {
    await _request<dynamic>('POST', '/api/notifications/read-all');
  }

  Future<void> markNotificationRead(String id) async {
    await _request<dynamic>('POST', '/api/notifications/$id/read');
  }

  Future<void> approveTransaction(String id) async {
    await _request<dynamic>('POST', '/api/finance/transactions/$id/approve');
  }

  Future<void> voidTransaction(String id) async {
    await _request<dynamic>('POST', '/api/finance/transactions/$id/void');
  }

  Future<Map<String, dynamic>> fetchInventoryData() async {
    final results = await Future.wait([
      _request<Map<String, dynamic>>('GET', '/api/inventory/warehouses'),
      _request<Map<String, dynamic>>('GET', '/api/inventory/items'),
      _request<Map<String, dynamic>>('GET', '/api/inventory/stocks'),
      _request<Map<String, dynamic>>('GET', '/api/inventory/movements'),
    ]);
    return {
      'warehouses': results[0]['warehouses'] ?? const [],
      'items': results[1]['items'] ?? const [],
      'stocks': results[2]['stocks'] ?? const [],
      'movements': results[3]['movements'] ?? const [],
    };
  }

  Future<void> createInventoryItem(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/inventory/items', data: body);
  }

  Future<void> createStockMovement(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/inventory/movements', data: body);
  }

  Future<Map<String, dynamic>> fetchAttendanceData() async {
    final results = await Future.wait([
      _request<Map<String, dynamic>>('GET', '/api/attendance/offices'),
      _request<Map<String, dynamic>>('GET', '/api/attendance/records'),
    ]);
    return {
      'offices': results[0]['offices'] ?? const [],
      'records': results[1]['records'] ?? const [],
    };
  }

  Future<void> clockIn(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/attendance/clock-in', data: body);
  }

  Future<void> clockOut(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/attendance/clock-out', data: body);
  }

  Future<void> approveAttendance(String id, String decision) async {
    await _request<dynamic>('POST', '/api/attendance/$id/approve', data: {'decision': decision});
  }

  Future<void> submitLeaveRequest(Map<String, dynamic> body) async {
    await _request<dynamic>('POST', '/api/attendance/leave', data: body);
  }

  Future<Map<String, dynamic>> updateOfficeLocation(
    String officeId,
    Map<String, dynamic> body,
  ) async {
    return _request<Map<String, dynamic>>(
      'PATCH',
      '/api/attendance/offices/$officeId',
      data: body,
    );
  }

  Future<List<dynamic>> fetchPayrollRuns() async {
    final res = await _request<Map<String, dynamic>>('GET', '/api/payroll/runs');
    return (res['runs'] as List<dynamic>?) ?? const [];
  }

  Future<Map<String, dynamic>> fetchPayrollRunDetail(String id) async {
    return _request<Map<String, dynamic>>('GET', '/api/payroll/runs/$id');
  }

  Future<void> approvePayrollRun(String id) async {
    await _request<dynamic>('POST', '/api/payroll/runs/$id/approve');
  }

  Future<void> payPayrollRun(String id, String accountId) async {
    await _request<dynamic>(
      'POST',
      '/api/payroll/runs/$id/pay',
      data: {'finance_account_id': accountId},
    );
  }

  Future<String> fetchPayrollSlipUrl(String itemId) async {
    final res = await _request<Map<String, dynamic>>('GET', '/api/payroll/items/$itemId/slip-url');
    return (res['download_url'] ?? '').toString();
  }

  Future<Map<String, dynamic>> generateEmployeeClaimCode(String employeeId) async {
    return _request<Map<String, dynamic>>('POST', '/api/rbac/employees/$employeeId/claim-code');
  }

  Future<Map<String, dynamic>> createEmployee(Map<String, dynamic> body) async {
    return _request<Map<String, dynamic>>('POST', '/api/rbac/employees', data: body);
  }

  Future<Map<String, dynamic>> updateEmployee(
    String employeeId,
    Map<String, dynamic> body,
  ) async {
    return _request<Map<String, dynamic>>('PATCH', '/api/rbac/employees/$employeeId', data: body);
  }

  Future<Map<String, dynamic>> deleteEmployee(String employeeId) async {
    return _request<Map<String, dynamic>>('DELETE', '/api/rbac/employees/$employeeId');
  }

  Future<Map<String, dynamic>> unlinkEmployeeAuth(
    String employeeId, {
    bool issueClaimCode = true,
  }) async {
    return _request<Map<String, dynamic>>(
      'POST',
      '/api/rbac/employees/$employeeId/unlink-auth',
      data: {'issue_claim_code': issueClaimCode},
    );
  }

  Future<Map<String, dynamic>> updateRolePermissions(
    String roleId,
    List<String> permissionIds,
  ) async {
    return _request<Map<String, dynamic>>(
      'PUT',
      '/api/rbac/roles/$roleId/permissions',
      data: {'permission_ids': permissionIds},
    );
  }

  Future<Map<String, dynamic>> fetchRbacAuditData({
    required bool includeRbac,
    required bool includeAudit,
  }) async {
    List<dynamic> roles = const [];
    List<dynamic> permissions = const [];
    List<dynamic> employees = const [];
    if (includeRbac) {
      final rbacResults = await Future.wait([
        _request<Map<String, dynamic>>('GET', '/api/rbac/roles'),
        _request<Map<String, dynamic>>('GET', '/api/rbac/permissions'),
        _request<Map<String, dynamic>>('GET', '/api/rbac/employees'),
      ]);
      roles = (rbacResults[0]['roles'] as List<dynamic>? ?? const []);
      permissions = (rbacResults[1]['permissions'] as List<dynamic>? ?? const []);
      employees = (rbacResults[2]['employees'] as List<dynamic>? ?? const []);
    }
    final auditLogs = includeAudit
        ? ((await _request<Map<String, dynamic>>('GET', '/api/rbac/audit-logs'))['audit_logs']
                as List<dynamic>? ??
            const [])
        : const [];
    return {
      'roles': roles,
      'permissions': permissions,
      'employees': employees,
      'audit_logs': auditLogs,
    };
  }

  Future<Map<String, dynamic>> fetchAppVersion({
    required String platform,
    required String currentVersion,
    required int currentBuild,
  }) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/app/version',
        queryParameters: {
          'platform': platform,
          'current_version': currentVersion,
          'current_build': currentBuild,
        },
      );
      return res.data ?? <String, dynamic>{};
    } on DioException catch (err) {
      throw ApiException(
        _extractErrorMessage(
          err.response?.data,
          err.message ?? 'Gagal memeriksa pembaruan aplikasi.',
        ),
        statusCode: err.response?.statusCode,
        details: err.response?.data is Map<String, dynamic>
            ? err.response!.data as Map<String, dynamic>
            : null,
      );
    }
  }

  Future<Map<String, dynamic>> publishAppRelease(Map<String, dynamic> body) async {
    return _request<Map<String, dynamic>>('POST', '/api/app/releases', data: body);
  }

  Future<Map<String, dynamic>> deleteAppRelease(String id) async {
    return _request<Map<String, dynamic>>('DELETE', '/api/app/releases/$id');
  }

  Future<String> uploadObject({
    required String category,
    required String filename,
    required String contentType,
    required Uint8List bytes,
  }) async {
    final presign = await _request<Map<String, dynamic>>(
      'POST',
      '/api/storage/presign-upload',
      data: {
        'category': category,
        'filename': filename,
        'content_type': contentType,
      },
    );
    final uploadUrl = (presign['upload_url'] ?? '').toString();
    final objectKey = (presign['object_key'] ?? '').toString();
    if (uploadUrl.isEmpty || objectKey.isEmpty) {
      throw const ApiException('URL upload Neon Object Storage tidak valid.');
    }
    await uploadBytesToPresignedUrl(
      uploadUrl: uploadUrl,
      bytes: bytes,
      contentType: contentType,
    );
    return objectKey;
  }

  Future<Map<String, dynamic>> fetchFaceStatus({
    bool includeMobileDescriptor = false,
  }) async {
    final suffix = includeMobileDescriptor ? '?include_mobile_descriptor=1' : '';
    return _request<Map<String, dynamic>>('GET', '/api/attendance/face-status$suffix');
  }

  Future<Uint8List> fetchFaceReferenceImageBytes() async {
    try {
      final headers = await _authHeaders();
      final res = await _dio.get<List<int>>(
        '/api/attendance/face-reference-image',
        options: Options(headers: headers, responseType: ResponseType.bytes),
      );
      return Uint8List.fromList(res.data ?? const []);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        final nextJwt = await _auth.refreshJwt();
        if (nextJwt != null) {
          final retryRes = await _dio.get<List<int>>(
            '/api/attendance/face-reference-image',
            options: Options(
              headers: {
                'Authorization': 'Bearer $nextJwt',
                'X-Platform': 'flutter',
              },
              responseType: ResponseType.bytes,
            ),
          );
          return Uint8List.fromList(retryRes.data ?? const []);
        }
      }
      throw ApiException(
        e.message ?? 'Gagal mengunduh foto acuan wajah.',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> enrollFace({
    required String faceModel,
    required List<double> faceDescriptor,
    required String selfieObjectKey,
    List<List<double>>? faceSamples,
    List<String>? enrollmentPoses,
    bool derivedFromReference = false,
    bool replace = false,
  }) async {
    return _request<Map<String, dynamic>>(
      'POST',
      '/api/attendance/face-enroll',
      data: {
        'face_model': faceModel,
        'face_descriptor': faceDescriptor,
        if (faceSamples != null && faceSamples.isNotEmpty) 'face_samples': faceSamples,
        if (enrollmentPoses != null && enrollmentPoses.isNotEmpty)
          'enrollment_poses': enrollmentPoses,
        'selfie_object_key': selfieObjectKey,
        'derived_from_reference': derivedFromReference,
        if (replace) 'replace': true,
      },
    );
  }

  Future<Map<String, dynamic>> deleteMyFace() async {
    return _request<Map<String, dynamic>>('DELETE', '/api/attendance/face-enroll');
  }

  Future<Map<String, dynamic>> verifyFace({
    required String faceModel,
    required List<double> faceDescriptor,
  }) async {
    return _request<Map<String, dynamic>>(
      'POST',
      '/api/attendance/face-verify',
      data: {
        'face_model': faceModel,
        'face_descriptor': faceDescriptor,
      },
    );
  }

  Future<Map<String, dynamic>> resetEmployeeFace(String employeeId) async {
    return _request<Map<String, dynamic>>(
      'DELETE',
      '/api/rbac/employees/$employeeId/face',
    );
  }

  Future<Map<String, dynamic>> fetchPosCatalog() async {
    return _request<Map<String, dynamic>>('GET', '/api/finance/pos/catalog');
  }

  Future<Map<String, dynamic>> fetchPosSales({
    String? status,
    String? paymentMethod,
  }) async {
    try {
      final headers = await _authHeaders();
      final res = await _dio.get<Map<String, dynamic>>(
        '/api/finance/pos/sales',
        queryParameters: {
          if (status != null && status.isNotEmpty) 'status': status,
          if (paymentMethod != null && paymentMethod.isNotEmpty)
            'payment_method': paymentMethod,
        },
        options: Options(headers: headers),
      );
      return res.data ?? <String, dynamic>{};
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        final nextJwt = await _auth.refreshJwt();
        if (nextJwt != null) {
          final retryRes = await _dio.get<Map<String, dynamic>>(
            '/api/finance/pos/sales',
            queryParameters: {
              if (status != null && status.isNotEmpty) 'status': status,
              if (paymentMethod != null && paymentMethod.isNotEmpty)
                'payment_method': paymentMethod,
            },
            options: Options(
              headers: {
                'Authorization': 'Bearer $nextJwt',
                'X-Platform': 'flutter',
              },
            ),
          );
          return retryRes.data ?? <String, dynamic>{};
        }
      }
      final body = e.response?.data;
      throw ApiException(
        _extractErrorMessage(body, e.message ?? 'Gagal memuat laporan penjualan.'),
        statusCode: e.response?.statusCode,
        details: body is Map<String, dynamic> ? body : null,
      );
    }
  }

  Future<Map<String, dynamic>> createPosSale(Map<String, dynamic> body) async {
    return _request<Map<String, dynamic>>('POST', '/api/finance/pos/sales', data: body);
  }

  Future<Map<String, dynamic>> fetchPosReceiptPdf(String saleId) async {
    return _request<Map<String, dynamic>>('GET', '/api/finance/pos/sales/$saleId/receipt-pdf');
  }

  Future<Map<String, dynamic>> voidPosSale(String saleId, {String? reason}) async {
    return _request<Map<String, dynamic>>(
      'POST',
      '/api/finance/pos/sales/$saleId/void',
      data: {'reason': reason},
    );
  }
}
