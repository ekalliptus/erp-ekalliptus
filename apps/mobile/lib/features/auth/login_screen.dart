import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/config/app_config.dart';
import '../../core/notifications/fcm_adapter.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../common/erp_widgets.dart';
import '../common/theme_transition.dart';

class LoginScreen extends ConsumerStatefulWidget {
  final VoidCallback? onAuthenticated;

  const LoginScreen({super.key, this.onAuthenticated});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _nameCtrl = TextEditingController();
  final _usernameCtrl = TextEditingController();
  final _claimCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();

  bool _isSignUp = false;
  bool _pending = false;
  String? _errorMsg;

  bool _isValidUsername(String value) =>
      RegExp(r'^[a-z0-9_.]{3,24}$').hasMatch(value);

  /// Registrasi token FCM best-effort: kegagalan tidak pernah menggagalkan login.
  Future<void> _registerNotifications() async {
    try {
      if (!FcmAdapter.isSupportedOnThisDevice) return;
      await FcmAdapter.ensureInitialized();
      final token = await FcmAdapter.requestToken();
      if (token == null) return;
      final registration = ref.read(notificationRegistrationProvider);
      registration.updateToken(token);
      await registration.registerCurrentToken();
      ref.invalidate(unreadNotificationsProvider);
    } catch (_) {
      // Senyap: push notifikasi bersifat opsional.
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _usernameCtrl.dispose();
    _claimCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailCtrl.text.trim().toLowerCase();
    final pass = _passCtrl.text;
    final name = _nameCtrl.text.trim();
    final username = _usernameCtrl.text.trim().toLowerCase();

    if (email.isEmpty) {
      setState(() => _errorMsg = 'Masukkan email kerja atau username.');
      return;
    }
    if (pass.length < 8) {
      setState(() => _errorMsg = 'Kata sandi minimal 8 karakter.');
      return;
    }
    if (_isSignUp && name.length < 2) {
      setState(() => _errorMsg = 'Nama lengkap wajib diisi minimal 2 karakter.');
      return;
    }
    if (_isSignUp && !_isValidUsername(username)) {
      setState(() => _errorMsg = 'Username 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.');
      return;
    }
    final claimCode = _claimCtrl.text.trim().toUpperCase();
    if (_isSignUp && claimCode.length < 6) {
      setState(() => _errorMsg = 'Kode aktivasi wajib diisi (diberikan HR/owner).');
      return;
    }

    setState(() {
      _pending = true;
      _errorMsg = null;
    });

    try {
      final auth = ref.read(authServiceProvider);
      if (_isSignUp) {
        await auth.signUpEmail(name: name, email: email, password: pass);
        try {
          await ref.read(apiClientProvider).claimAccount(claimCode);
        } catch (claimErr) {
          if (mounted) {
            setState(() => _errorMsg = 'Klaim gagal: ${claimErr.toString()}');
          }
          return;
        }
        try {
          await ref.read(apiClientProvider).setUsername(username);
        } catch (_) {
          if (mounted) {
            setState(() => _errorMsg =
                'Akun aktif, tapi username gagal disimpan (mungkin sudah dipakai). Coba lagi nanti.');
          }
        }
      } else {
        var signInEmail = email;
        if (!email.contains('@')) {
          final resolved = await ref.read(apiClientProvider).lookupUsernameEmail(email);
          if (resolved == null || resolved.isEmpty) {
            setState(() => _errorMsg = 'Username tidak ditemukan. Gunakan email kerja untuk masuk.');
            return;
          }
          signInEmail = resolved;
        }
        await auth.signInEmail(email: signInEmail, password: pass);
      }
      ref.invalidate(sessionProfileProvider);
      await _registerNotifications();
      widget.onAuthenticated?.call();
    } catch (err) {
      if (mounted) {
        setState(() => _errorMsg = err.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _pending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            MyEkalliptusLogo(size: 30),
            SizedBox(width: 10),
            Text('MyEkalliptus'),
          ],
        ),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 12),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const MyEkalliptusLogo(size: 44),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isSignUp ? 'Aktivasi Akun Karyawan' : 'Masuk ke MyEkalliptus',
                                  style: Theme.of(context).textTheme.headlineMedium,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'ERP Command Center',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Autentikasi terpusat Neon Auth dengan pemetaan RBAC otomatis.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 16),
                      SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment<bool>(value: false, label: Text('Masuk')),
                          ButtonSegment<bool>(value: true, label: Text('Aktivasi')),
                        ],
                        selected: {_isSignUp},
                        onSelectionChanged: (sel) {
                          setState(() {
                            _isSignUp = sel.first;
                            _errorMsg = null;
                          });
                        },
                      ),
                      const SizedBox(height: 16),
                      if (_errorMsg != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: t.dangerSoft,
                            borderRadius: BorderRadius.circular(t.radiusMd),
                            border: Border.all(color: t.danger.withValues(alpha: 0.45)),
                          ),
                          child: Text(
                            _errorMsg!,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: isDark ? const Color(0xFFFCA5A5) : const Color(0xFF991B1B),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (_isSignUp) ...[
                        TextField(
                          controller: _nameCtrl,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(labelText: 'Nama Lengkap'),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (_isSignUp) ...[
                        TextField(
                          controller: _usernameCtrl,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Username',
                            hintText: 'contoh: alul.studio',
                            helperText: '3-24 karakter: huruf kecil, angka, titik, garis bawah',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _claimCtrl,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Kode Aktivasi',
                            hintText: 'EK-XXXXXXXXXX (dari HR/owner)',
                            helperText: 'Kode sekali pakai yang menautkan akun ke karyawan',
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextField(
                        controller: _emailCtrl,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        decoration: InputDecoration(
                          labelText: _isSignUp ? 'Email Kerja' : 'Email atau Username',
                          hintText: _isSignUp ? AppConfig.supportEmail : 'nama@ekalliptus.com atau username',
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _passCtrl,
                        obscureText: true,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _pending ? null : _submit(),
                        decoration: const InputDecoration(labelText: 'Kata Sandi'),
                      ),
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: _pending ? null : _submit,
                        child: Text(_pending
                            ? 'Memproses sesi...'
                            : (_isSignUp ? 'Aktifkan & Masuk' : 'Masuk Sekarang')),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Kontak administrator: ${AppConfig.supportEmail}',
                        style: Theme.of(context).textTheme.bodySmall,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
