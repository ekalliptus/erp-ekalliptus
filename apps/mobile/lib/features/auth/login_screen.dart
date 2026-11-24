import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_service.dart';
import '../../core/config/app_config.dart';
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
  final _usernameCtrl = TextEditingController();
  final _claimCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();

  bool _isSignUp = false;
  bool _obscurePass = true;
  bool _pending = false;
  String? _pendingClaimEmail;
  String? _pendingClaimName;
  Map<String, dynamic>? _claimPreview;
  String? _verifiedClaimCode;
  bool _lookupLoading = false;
  String? _lookupError;
  Timer? _lookupDebounce;
  int _lookupSeq = 0;
  String? _errorMsg;

  bool _isValidUsername(String value) =>
      RegExp(r'^[a-z0-9_.]{3,24}$').hasMatch(value);

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _usernameCtrl.dispose();
    _claimCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  void _onClaimCodeChanged(String raw) {
    final normalized = raw.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (raw != normalized) {
      final oldOffset = _claimCtrl.selection.baseOffset;
      final clamped =
          (oldOffset < 0 ? normalized.length : oldOffset).clamp(0, normalized.length);
      _claimCtrl.value = TextEditingValue(
        text: normalized,
        selection: TextSelection.collapsed(offset: clamped),
      );
    }

    _lookupDebounce?.cancel();
    if (normalized != _verifiedClaimCode) {
      ++_lookupSeq;
      setState(() {
        _claimPreview = null;
        _verifiedClaimCode = null;
        _lookupError = null;
        _lookupLoading = false;
        _errorMsg = null;
      });
    } else {
      setState(() {});
    }

    if (normalized.startsWith('EK-') &&
        normalized.length >= 12 &&
        normalized != _verifiedClaimCode) {
      final isExactStandard = RegExp(r'^EK-[A-Z0-9]{10}$').hasMatch(normalized);
      final delay = Duration(milliseconds: isExactStandard ? 150 : 350);
      _lookupDebounce = Timer(delay, () => _lookupClaimCode(normalized));
    }
  }

  Future<void> _lookupClaimCode(String rawCode) async {
    final code = rawCode.trim().toUpperCase();
    if (code.length < 6) {
      setState(() => _lookupError = 'Masukkan minimal 6 karakter kode aktivasi.');
      return;
    }

    final seq = ++_lookupSeq;
    setState(() {
      _lookupLoading = true;
      _lookupError = null;
      _errorMsg = null;
    });

    try {
      final res = await ref.read(apiClientProvider).previewClaimCode(code);
      if (!mounted || seq != _lookupSeq) return;
      final rawEmp = res['employee'];
      if (rawEmp is! Map) {
        setState(() {
          _claimPreview = null;
          _verifiedClaimCode = null;
          _lookupError = 'Respons verifikasi kode aktivasi tidak valid.';
          _lookupLoading = false;
        });
        return;
      }
      setState(() {
        _claimPreview = Map<String, dynamic>.from(rawEmp);
        _verifiedClaimCode = code;
        _usernameCtrl.clear();
        _lookupError = null;
        _lookupLoading = false;
      });
    } catch (err) {
      if (!mounted || seq != _lookupSeq) return;
      setState(() {
        _claimPreview = null;
        _verifiedClaimCode = null;
        _lookupError = err.toString();
        _lookupLoading = false;
      });
    }
  }

  Future<void> _resetPendingActivation() async {
    await performCleanSignOut(ref);
    if (!mounted) return;
    setState(() {
      _pendingClaimEmail = null;
      _pendingClaimName = null;
      _errorMsg = null;
    });
  }

  Future<void> _submit() async {
    final pass = _passCtrl.text;

    if (_isSignUp) {
      final claimCode = _claimCtrl.text.trim().toUpperCase();
      final preview = _claimPreview;
      if ((preview == null || _verifiedClaimCode != claimCode) &&
          _pendingClaimEmail == null) {
        setState(
          () => _errorMsg =
              'Verifikasi kode aktivasi terlebih dahulu sampai data karyawan muncul.',
        );
        return;
      }

      final email =
          (_pendingClaimEmail ?? preview?['email']?.toString() ?? '').trim().toLowerCase();
      final fullName =
          (_pendingClaimName ?? preview?['full_name']?.toString() ?? '').trim();
      final existingUsername = (preview?['username']?.toString() ?? '').trim();
      final optionalUsername = _usernameCtrl.text.trim().toLowerCase();

      if (email.isEmpty || fullName.isEmpty) {
        setState(() => _errorMsg = 'Data karyawan belum termuat. Periksa ulang kode aktivasi.');
        return;
      }
      if (existingUsername.isEmpty &&
          optionalUsername.isNotEmpty &&
          !_isValidUsername(optionalUsername)) {
        setState(
          () => _errorMsg =
              'Username 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.',
        );
        return;
      }
      if (pass.length < 8 && _pendingClaimEmail != email) {
        setState(() => _errorMsg = 'Kata sandi minimal 8 karakter.');
        return;
      }

      setState(() {
        _pending = true;
        _errorMsg = null;
      });

      try {
        final auth = ref.read(authServiceProvider);
        final api = ref.read(apiClientProvider);

        if (_pendingClaimEmail != email) {
          try {
            await auth.signUpEmail(name: fullName, email: email, password: pass);
          } on AuthException catch (authErr) {
            if (RegExp(r'terdaftar|already|exists|duplicate', caseSensitive: false)
                .hasMatch(authErr.message)) {
              await auth.signInEmail(email: email, password: pass);
            } else {
              rethrow;
            }
          }
          if (!mounted) return;
          _pendingClaimEmail = email;
          _pendingClaimName = fullName;
        }

        try {
          await api.claimAccount(claimCode);
          _pendingClaimEmail = null;
          _pendingClaimName = null;
        } catch (claimErr) {
          if (mounted) {
            setState(() => _errorMsg = 'Klaim gagal: $claimErr. Perbaiki kode lalu coba lagi.');
          }
          return;
        }

        if (existingUsername.isEmpty && optionalUsername.isNotEmpty) {
          try {
            await api.setUsername(optionalUsername);
          } catch (_) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text(
                    'Akun aktif, namun username gagal disimpan. Anda bisa mengaturnya di menu Profil.',
                  ),
                ),
              );
            }
          }
        }

        if (!mounted) return;
        ref.invalidate(sessionProfileProvider);
        unawaited(syncFcmDeviceToken(ref));
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
      return;
    }

    final email = _emailCtrl.text.trim().toLowerCase();
    if (email.isEmpty) {
      setState(() => _errorMsg = 'Masukkan email kerja atau username.');
      return;
    }
    if (pass.length < 8) {
      setState(() => _errorMsg = 'Kata sandi minimal 8 karakter.');
      return;
    }

    setState(() {
      _pending = true;
      _errorMsg = null;
    });

    try {
      final auth = ref.read(authServiceProvider);
      final api = ref.read(apiClientProvider);

      var signInEmail = email;
      if (!email.contains('@')) {
        final resolved = await api.lookupUsernameEmail(email);
        if (resolved == null || resolved.isEmpty) {
          if (mounted) {
            setState(() => _errorMsg = 'Username tidak ditemukan. Gunakan email kerja untuk masuk.');
          }
          return;
        }
        signInEmail = resolved;
      }
      await auth.signInEmail(email: signInEmail, password: pass);

      if (!mounted) return;
      ref.invalidate(sessionProfileProvider);
      unawaited(syncFcmDeviceToken(ref));
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
    final preview = _claimPreview;
    final existingUsername = (preview?['username']?.toString() ?? '').trim();
    final hasOwnerUsername = existingUsername.isNotEmpty;
    final showPasswordField = !_isSignUp || preview != null || _pendingClaimEmail != null;
    final submitDisabled =
        _pending || _lookupLoading || (_isSignUp && preview == null && _pendingClaimEmail == null);

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
                          const MyEkalliptusLogo(size: 46),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isSignUp ? 'Aktivasi Akun Karyawan' : 'Masuk ke MyEkalliptus',
                                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontSize: 21),
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
                      const SizedBox(height: 12),
                      Text(
                        _isSignUp
                            ? 'Masukkan kode aktivasi dari Owner/HR untuk memuat data karyawan otomatis, lalu buat kata sandi login Anda.'
                            : 'Gunakan email kerja atau username Anda untuk membuka ruang kerja sesuai role.',
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
                          _lookupDebounce?.cancel();
                          ++_lookupSeq;
                          setState(() {
                            _isSignUp = sel.first;
                            _errorMsg = null;
                            _lookupError = null;
                            _lookupLoading = false;
                          });
                        },
                      ),
                      const SizedBox(height: 16),
                      if (_isSignUp && _pendingClaimEmail != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: t.infoSoft,
                            borderRadius: BorderRadius.circular(t.radiusMd),
                            border: Border.all(color: t.info.withValues(alpha: 0.4)),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Akun $_pendingClaimEmail siap ditautkan. Periksa kode aktivasi lalu ketuk Selesaikan Aktivasi.',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: isDark ? const Color(0xFF7DD3FC) : const Color(0xFF075985),
                                  ),
                                ),
                              ),
                              TextButton(
                                onPressed: _pending ? null : _resetPendingActivation,
                                child: const Text('Reset'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
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
                          key: const ValueKey('activation-code-field'),
                          controller: _claimCtrl,
                          enabled: _pendingClaimEmail == null,
                          onChanged: _onClaimCodeChanged,
                          textCapitalization: TextCapitalization.characters,
                          textInputAction: TextInputAction.done,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            letterSpacing: 1.0,
                          ),
                          decoration: InputDecoration(
                            labelText: 'Kode Aktivasi',
                            hintText: 'EK-XXXXXXXXXX',
                            helperText:
                                'Data karyawan dimuat otomatis setelah kode lengkap',
                            suffixIcon: _lookupLoading
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  )
                                : (preview != null && _verifiedClaimCode != null
                                    ? Icon(
                                        Icons.check_circle_rounded,
                                        color: t.accent,
                                      )
                                    : (_claimCtrl.text.trim().length >= 6
                                        ? TextButton(
                                            onPressed: () =>
                                                _lookupClaimCode(_claimCtrl.text),
                                            child: const Text('Cek'),
                                          )
                                        : null)),
                          ),
                        ),
                        if (_lookupError != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: t.dangerSoft,
                              borderRadius: BorderRadius.circular(t.radiusMd),
                              border: Border.all(color: t.danger.withValues(alpha: 0.45)),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    _lookupError!,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                      color: isDark
                                          ? const Color(0xFFFCA5A5)
                                          : const Color(0xFF991B1B),
                                    ),
                                  ),
                                ),
                                if (_claimCtrl.text.trim().length >= 6)
                                  TextButton(
                                    onPressed: _lookupLoading
                                        ? null
                                        : () => _lookupClaimCode(_claimCtrl.text),
                                    child: const Text('Coba Lagi'),
                                  ),
                              ],
                            ),
                          ),
                        ],
                        if (preview != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: t.successSoft,
                              borderRadius: BorderRadius.circular(t.radiusMd),
                              border: Border.all(
                                color: isDark
                                    ? const Color(0xFF065F46)
                                    : const Color(0xFF86EFAC),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 6,
                                  alignment: WrapAlignment.spaceBetween,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          Icons.verified_user_outlined,
                                          size: 16,
                                          color: isDark
                                              ? const Color(0xFF34D399)
                                              : const Color(0xFF115E59),
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          'Data Karyawan Terverifikasi',
                                          style: TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w700,
                                            color: isDark
                                                ? const Color(0xFF34D399)
                                                : const Color(0xFF115E59),
                                          ),
                                        ),
                                      ],
                                    ),
                                    Wrap(
                                      spacing: 6,
                                      children: [
                                        _PreviewChip(
                                          label: (preview['employee_code'] ?? '').toString(),
                                          monospace: true,
                                          isAccent: false,
                                        ),
                                        _PreviewChip(
                                          label: (preview['role_name'] ?? 'Karyawan').toString(),
                                          monospace: false,
                                          isAccent: true,
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                const Divider(height: 1),
                                const SizedBox(height: 10),
                                _PreviewInfoRow(
                                  label: 'Nama Lengkap',
                                  value: (preview['full_name'] ?? '-').toString(),
                                ),
                                const SizedBox(height: 6),
                                _PreviewInfoRow(
                                  label: 'Email Kerja',
                                  value: (preview['email'] ?? '-').toString(),
                                  monospace: true,
                                ),
                                const SizedBox(height: 6),
                                _PreviewInfoRow(
                                  label: 'Username',
                                  value: hasOwnerUsername
                                      ? '@$existingUsername'
                                      : 'Belum diatur (opsional)',
                                  monospace: hasOwnerUsername,
                                ),
                              ],
                            ),
                          ),
                          if (!hasOwnerUsername) ...[
                            const SizedBox(height: 12),
                            TextField(
                              key: const ValueKey('activation-optional-username'),
                              controller: _usernameCtrl,
                              textInputAction: TextInputAction.next,
                              decoration: const InputDecoration(
                                labelText: 'Username Login (Opsional)',
                                hintText: 'contoh: budi.santoso',
                                helperText:
                                    'Opsional. 3-24 karakter: huruf kecil, angka, titik, garis bawah',
                              ),
                            ),
                          ],
                        ],
                        const SizedBox(height: 12),
                      ] else ...[
                        TextField(
                          controller: _emailCtrl,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Email atau Username',
                            hintText: 'nama@ekalliptus.com atau username',
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (showPasswordField) ...[
                        TextField(
                          key: const ValueKey('auth-password-field'),
                          controller: _passCtrl,
                          enabled: !(_isSignUp && _pendingClaimEmail != null),
                          obscureText: _obscurePass,
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => submitDisabled ? null : _submit(),
                          decoration: InputDecoration(
                            labelText:
                                _isSignUp ? 'Buat Kata Sandi Baru' : 'Kata Sandi',
                            helperText: _isSignUp
                                ? 'Minimal 8 karakter untuk Web dan aplikasi mobile'
                                : null,
                            suffixIcon: IconButton(
                              tooltip: _obscurePass
                                  ? 'Tampilkan kata sandi'
                                  : 'Sembunyikan kata sandi',
                              onPressed: () =>
                                  setState(() => _obscurePass = !_obscurePass),
                              icon: Icon(
                                _obscurePass
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                      ] else
                        const SizedBox(height: 6),
                      FilledButton(
                        onPressed: submitDisabled ? null : _submit,
                        child: Text(
                          _pending
                              ? 'Memproses sesi...'
                              : (_isSignUp
                                  ? (_pendingClaimEmail != null
                                      ? 'Selesaikan Aktivasi'
                                      : 'Aktifkan & Masuk')
                                  : 'Masuk Sekarang'),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Kontak administrator: ${AppConfig.supportEmail}',
                        style: Theme.of(context).textTheme.bodySmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'MyEkalliptus v${AppConfig.appVersion} (Build ${AppConfig.appBuildNumber})',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11),
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

class _PreviewChip extends StatelessWidget {
  final String label;
  final bool monospace;
  final bool isAccent;

  const _PreviewChip({
    required this.label,
    required this.monospace,
    required this.isAccent,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: t.surface,
        borderRadius: BorderRadius.circular(t.radiusSm),
        border: Border.all(
          color: isAccent
              ? (isDark ? const Color(0xFF065F46) : const Color(0xFF86EFAC))
              : t.border,
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          fontFamily: monospace ? 'monospace' : null,
          color: isAccent
              ? (isDark ? const Color(0xFF34D399) : const Color(0xFF115E59))
              : t.textPrimary,
        ),
      ),
    );
  }
}

class _PreviewInfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool monospace;

  const _PreviewInfoRow({
    required this.label,
    required this.value,
    this.monospace = false,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        SizedBox(
          width: 105,
          child: Text(
            label,
            style: TextStyle(fontSize: 12, color: t.textSecondary),
          ),
        ),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              fontFamily: monospace ? 'monospace' : null,
              color: t.textPrimary,
            ),
          ),
        ),
      ],
    );
  }
}
