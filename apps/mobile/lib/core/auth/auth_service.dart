import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/app_config.dart';

class AuthException implements Exception {
  final String message;
  const AuthException(this.message);

  @override
  String toString() => message;
}

class AuthSessionSnapshot {
  final String jwt;
  final String email;
  const AuthSessionSnapshot({required this.jwt, required this.email});
}

class AuthService {
  static const _keyJwt = 'ekalliptus_jwt';
  static const _keyCookie = 'ekalliptus_auth_cookie';
  static const _keyEmail = 'ekalliptus_auth_email';

  final FlutterSecureStorage _storage;
  final Dio _dio;

  AuthService({FlutterSecureStorage? storage, Dio? dio})
      : _storage = storage ?? const FlutterSecureStorage(),
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: AppConfig.neonAuthUrl,
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 20),
                headers: {
                  'Origin': AppConfig.authOrigin,
                  'Content-Type': 'application/json',
                },
                validateStatus: (s) => s != null && s < 500,
              ),
            );

  Future<AuthSessionSnapshot?> restoreSession() async {
    final jwt = await _storage.read(key: _keyJwt);
    final email = await _storage.read(key: _keyEmail);
    if (jwt != null && jwt.isNotEmpty && email != null && email.isNotEmpty) {
      return AuthSessionSnapshot(jwt: jwt, email: email);
    }
    return null;
  }

  Future<String?> readStoredJwt() => _storage.read(key: _keyJwt);

  Future<String?> refreshJwt() async {
    final cookieHeader = await _storage.read(key: _keyCookie);
    if (cookieHeader == null || cookieHeader.isEmpty) return null;

    final res = await _dio.get<Map<String, dynamic>>(
      '/token',
      options: Options(headers: {'Cookie': cookieHeader}),
    );
    if (res.statusCode == 200 && res.data?['token'] is String) {
      final jwt = res.data!['token'] as String;
      await _storage.write(key: _keyJwt, value: jwt);
      return jwt;
    }
    return null;
  }

  Future<AuthSessionSnapshot> signInEmail({
    required String email,
    required String password,
  }) async {
    return _authenticate('/sign-in/email', {
      'email': email.trim().toLowerCase(),
      'password': password,
    });
  }

  Future<AuthSessionSnapshot> signUpEmail({
    required String name,
    required String email,
    required String password,
  }) async {
    return _authenticate('/sign-up/email', {
      'name': name.trim(),
      'email': email.trim().toLowerCase(),
      'password': password,
    });
  }

  Future<AuthSessionSnapshot> _authenticate(
    String path,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post<Map<String, dynamic>>(path, data: body);
    if ((res.statusCode ?? 500) >= 400) {
      final errMsg = res.data?['message']?.toString() ??
          res.data?['error']?.toString() ??
          'Autentikasi gagal (HTTP ${res.statusCode}).';
      throw AuthException(errMsg);
    }

    final setCookies = res.headers.map['set-cookie'] ?? const <String>[];
    final cookieHeader = setCookies
        .map((c) => c.split(';').first.trim())
        .where((c) => c.isNotEmpty)
        .join('; ');

    final directJwt = res.headers.value('set-auth-jwt');
    String? jwt = directJwt;

    if ((jwt == null || jwt.isEmpty) && cookieHeader.isNotEmpty) {
      final tokRes = await _dio.get<Map<String, dynamic>>(
        '/token',
        options: Options(headers: {'Cookie': cookieHeader}),
      );
      if (tokRes.statusCode == 200 && tokRes.data?['token'] is String) {
        jwt = tokRes.data!['token'] as String;
      }
    }

    if (jwt == null || jwt.isEmpty) {
      throw const AuthException('Sesi terbentuk tetapi token JWT tidak diterima dari Neon Auth.');
    }

    final email = body['email'].toString();
    await _storage.write(key: _keyJwt, value: jwt);
    await _storage.write(key: _keyEmail, value: email);
    if (cookieHeader.isNotEmpty) {
      await _storage.write(key: _keyCookie, value: cookieHeader);
    }

    return AuthSessionSnapshot(jwt: jwt, email: email);
  }

  Future<void> signOut() async {
    try {
      final cookie = await _storage.read(key: _keyCookie);
      if (cookie != null && cookie.isNotEmpty) {
        await _dio.post<dynamic>(
          '/sign-out',
          data: const {},
          options: Options(headers: {'Cookie': cookie}),
        );
      }
    } catch (_) {
      // Best-effort remote signout; always clear local credentials.
    } finally {
      await _storage.delete(key: _keyJwt);
      await _storage.delete(key: _keyCookie);
      await _storage.delete(key: _keyEmail);
    }
  }
}

Future<void> uploadBytesToPresignedUrl({
  required String uploadUrl,
  required Uint8List bytes,
  required String contentType,
}) async {
  final dio = Dio();
  await dio.put<void>(
    uploadUrl,
    data: Stream.fromIterable([bytes]),
    options: Options(
      headers: {
        'Content-Type': contentType,
        Headers.contentLengthHeader: bytes.length,
      },
    ),
  );
}
