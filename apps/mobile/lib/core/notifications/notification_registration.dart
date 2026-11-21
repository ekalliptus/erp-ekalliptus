/// Service pendaftaran token notifikasi. Murni Dart, tanpa channel platform,
/// sehingga bisa diunit-test tanpa Firebase.
class NotificationRegistrationService {
  NotificationRegistrationService({
    required Future<void> Function(String token) onRegister,
    Future<void> Function(String token)? onUnregister,
  })  : _onRegister = onRegister,
        _onUnregister = onUnregister ?? ((_) async {});

  final Future<void> Function(String token) _onRegister;
  final Future<void> Function(String token) _onUnregister;

  String? _token;
  bool _registered = false;

  /// Token terakhir yang diketahui service. Dipakai saat unregister.
  String? get currentToken => _token;

  void updateToken(String token) {
    if (_token == token && _registered) return;
    _token = token;
    _registered = false;
  }

  /// Mendaftarkan token saat ini ke backend. Idempotent per token.
  Future<void> registerCurrentToken() async {
    final token = _token;
    if (token == null || _registered) return;
    await _onRegister(token);
    _registered = true;
  }

  /// Mencabut registrasi token dari backend dan mengosongkan state lokal.
  Future<void> unregister() async {
    final token = _token;
    if (token == null) return;
    await _onUnregister(token);
    _registered = false;
  }
}
