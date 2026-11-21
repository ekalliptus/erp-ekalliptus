import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/providers/app_providers.dart';
import 'core/theme/eucalyptus_theme.dart';
import 'features/common/theme_transition.dart';
import 'router/app_router.dart';

class EkalliptusErpApp extends ConsumerWidget {
  const EkalliptusErpApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final router = ref.watch(routerProvider);
    final disableAnimations = MediaQuery.maybeDisableAnimationsOf(context) ?? false;

    return MaterialApp.router(
      title: 'MyEkalliptus',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: AppTheme.build(Brightness.light),
      darkTheme: AppTheme.build(Brightness.dark),
      themeAnimationCurve: const Cubic(0.23, 1, 0.32, 1),
      themeAnimationDuration:
          disableAnimations ? const Duration(milliseconds: 220) : Duration.zero,
      builder: (context, child) {
        final activeDark = Theme.of(context).brightness == Brightness.dark;
        final tokens = activeDark ? EucalyptusTokens.dark : EucalyptusTokens.light;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: activeDark ? Brightness.light : Brightness.dark,
            statusBarBrightness: activeDark ? Brightness.dark : Brightness.light,
            systemNavigationBarColor: tokens.canvas,
            systemNavigationBarIconBrightness:
                activeDark ? Brightness.light : Brightness.dark,
          ),
          child: ThemeRevealHost(
            child: child ?? const SizedBox.shrink(),
          ),
        );
      },
      routerConfig: router,
    );
  }
}
