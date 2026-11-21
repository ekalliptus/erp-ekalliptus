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

  const ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
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
      var msg = e.message ?? 'Koneksi ke server MyEkalliptus gagal.';
      if (body is Map<String, dynamic> && body['error'] != null) {
        msg = body['error'].toString();
      }
      throw ApiException(msg, statusCode: e.response?.statusCode);
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
      var msg = e.message ?? 'Koneksi ke server MyEkalliptus gagal.';
      if (body is Map<String, dynamic> && body['error'] != null) {
        msg = body['error'].toString();
      }
      throw ApiException(msg, statusCode: e.response?.statusCode);
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

  Future<Map<String, dynamic>> fetchRbacAuditData({
    required bool includeRbac,
    required bool includeAudit,
  }) async {
    final roles = includeRbac
        ? ((await _request<Map<String, dynamic>>('GET', '/api/rbac/roles'))['roles'] as List<dynamic>? ??
            const [])
        : const [];
    final employees = includeRbac
        ? ((await _request<Map<String, dynamic>>('GET', '/api/rbac/employees'))['employees']
                as List<dynamic>? ??
            const [])
        : const [];
    final auditLogs = includeAudit
        ? ((await _request<Map<String, dynamic>>('GET', '/api/rbac/audit-logs'))['audit_logs']
                as List<dynamic>? ??
            const [])
        : const [];
    return {
      'roles': roles,
      'employees': employees,
      'audit_logs': auditLogs,
    };
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
}
