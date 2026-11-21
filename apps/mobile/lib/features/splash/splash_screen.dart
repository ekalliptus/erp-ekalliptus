import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/config/app_config.dart';
import '../../core/notifications/fcm_adapter.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eucalyptus_theme.dart';

class SplashScreen extends ConsumerStatefulWidget {
  final Duration minDisplayDuration;
  final void Function(bool authenticated)? onResolved;

  const SplashScreen({
    super.key,
    this.minDisplayDuration = const Duration(milliseconds: 900),
    this.onResolved,
  });

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _entranceCtrl;
  late final Animation<double> _fadeAnim;
  late final Animation<double> _scaleAnim;
  late final Animation<Offset> _slideAnim;
  Timer? _minTimer;

  @override
  void initState() {
    super.initState();
    _entranceCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _fadeAnim = CurvedAnimation(
      parent: _entranceCtrl,
      curve: Curves.easeOutCubic,
    );
    _scaleAnim = Tween<double>(begin: 0.92, end: 1.0).animate(
      CurvedAnimation(parent: _entranceCtrl, curve: Curves.easeOutCubic),
    );
    _slideAnim = Tween<Offset>(
      begin: const Offset(0, 0.08),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _entranceCtrl, curve: Curves.easeOutCubic));

    _bootstrap();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _entranceCtrl.value = 1.0;
    } else if (!_entranceCtrl.isCompleted && !_entranceCtrl.isAnimating) {
      _entranceCtrl.forward();
    }
  }

  Future<void> _bootstrap() async {
    final delayCompleter = Completer<void>();
    _minTimer = Timer(widget.minDisplayDuration, () {
      if (!delayCompleter.isCompleted) {
        delayCompleter.complete();
      }
    });

    bool authenticated = false;
    try {
      final results = await Future.wait<Object?>([
        delayCompleter.future,
        ref.read(sessionProfileProvider.future).catchError((_) => null),
      ]);
      authenticated = results[1] != null;
    } catch (_) {
      authenticated = false;
    }

    if (authenticated) {
      await _registerNotifications();
    }

    if (!mounted) return;
    if (widget.onResolved != null) {
      widget.onResolved!(authenticated);
    } else {
      context.go(authenticated ? '/dashboard' : '/login');
    }
  }

  /// Registrasi token FCM best-effort saat sesi tersimpan dipulihkan.
  Future<void> _registerNotifications() async {
    try {
      if (!FcmAdapter.isSupportedOnThisDevice) return;
      await FcmAdapter.ensureInitialized();
      final token = await FcmAdapter.requestToken();
      if (token == null) return;
      final registration = ref.read(notificationRegistrationProvider);
      registration.updateToken(token);
      await registration.registerCurrentToken();
    } catch (_) {
      // Senyap: push notifikasi bersifat opsional.
    }
  }

  @override
  void dispose() {
    _minTimer?.cancel();
    _entranceCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: t.canvas,
      body: Column(
        children: [
          Container(
            height: 2.5,
            width: double.infinity,
            color: t.accent,
          ),
          Expanded(
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                child: Column(
                  children: [
                    const Spacer(),
                    FadeTransition(
                      opacity: _fadeAnim,
                      child: ScaleTransition(
                        scale: _scaleAnim,
                        child: SlideTransition(
                          position: _slideAnim,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 92,
                                height: 92,
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(t.radiusXl),
                                  border: Border.all(color: t.borderStrong, width: 1),
                                  boxShadow: [
                                    BoxShadow(
                                      color: isDark
                                          ? Colors.black.withValues(alpha: 0.45)
                                          : const Color(0xFF0F172A).withValues(alpha: 0.08),
                                      blurRadius: 20,
                                      offset: const Offset(0, 8),
                                    ),
                                  ],
                                ),
                                child: Image.asset(
                                  'assets/images/logo.png',
                                  fit: BoxFit.contain,
                                  filterQuality: FilterQuality.high,
                                ),
                              ),
                              const SizedBox(height: 20),
                              Text(
                                'MyEkalliptus',
                                style: TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: -0.6,
                                  color: t.textPrimary,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'ERP Command Center',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                  color: t.textSecondary,
                                ),
                              ),
                              const SizedBox(height: 24),
                              SizedBox(
                                width: 148,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(t.radiusPill),
                                  child: LinearProgressIndicator(
                                    minHeight: 3,
                                    backgroundColor: t.border,
                                    valueColor: AlwaysStoppedAnimation<Color>(t.accent),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'Menyiapkan sesi & modul ERP...',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: t.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      'MyEkalliptus v1.0  |  ${AppConfig.supportEmail}',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: t.textMuted,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
