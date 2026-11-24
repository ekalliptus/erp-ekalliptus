// Generated from packages/tokens/design-tokens.json by sync-tokens.mjs.
import 'dart:ui' show FontFeature, lerpDouble;
import 'package:flutter/material.dart';

@immutable
class EucalyptusTokens extends ThemeExtension<EucalyptusTokens> {
  final Color canvas;
  final Color surface;
  final Color surfaceSubtle;
  final Color border;
  final Color borderStrong;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color accentHover;
  final Color accentSoft;
  final Color onAccent;
  final Color success;
  final Color successSoft;
  final Color warning;
  final Color warningSoft;
  final Color danger;
  final Color dangerSoft;
  final Color info;
  final Color infoSoft;
  final double radiusSm;
  final double radiusMd;
  final double radiusLg;
  final double radiusXl;
  final double radiusPill;

  const EucalyptusTokens({
    required this.canvas,
    required this.surface,
    required this.surfaceSubtle,
    required this.border,
    required this.borderStrong,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.accentHover,
    required this.accentSoft,
    required this.onAccent,
    required this.success,
    required this.successSoft,
    required this.warning,
    required this.warningSoft,
    required this.danger,
    required this.dangerSoft,
    required this.info,
    required this.infoSoft,
    required this.radiusSm,
    required this.radiusMd,
    required this.radiusLg,
    required this.radiusXl,
    required this.radiusPill,
  });

  static const light = EucalyptusTokens(
    canvas: Color(0xFFF7F7F5),
    surface: Color(0xFFFFFFFF),
    surfaceSubtle: Color(0xFFECF0EB),
    border: Color(0xFFD4DBD3),
    borderStrong: Color(0xFFB5C1B5),
    textPrimary: Color(0xFF111815),
    textSecondary: Color(0xFF3F4B45),
    textMuted: Color(0xFF5A6760),
    accent: Color(0xFF0F766E),
    accentHover: Color(0xFF115E59),
    accentSoft: Color(0xFFCCFBF1),
    onAccent: Color(0xFFFFFFFF),
    success: Color(0xFF15803D),
    successSoft: Color(0xFFDCFCE7),
    warning: Color(0xFFB45309),
    warningSoft: Color(0xFFFEF3C7),
    danger: Color(0xFFDC2626),
    dangerSoft: Color(0xFFFEE2E2),
    info: Color(0xFF0369A1),
    infoSoft: Color(0xFFE0F2FE),
    radiusSm: 6.0,
    radiusMd: 10.0,
    radiusLg: 14.0,
    radiusXl: 20.0,
    radiusPill: 9999.0,
  );

  static const dark = EucalyptusTokens(
    canvas: Color(0xFF0C0E0D),
    surface: Color(0xFF141816),
    surfaceSubtle: Color(0xFF1B211E),
    border: Color(0xFF242C28),
    borderStrong: Color(0xFF34403A),
    textPrimary: Color(0xFFF1F5F3),
    textSecondary: Color(0xFFB4C0B9),
    textMuted: Color(0xFF8E9E96),
    accent: Color(0xFF10B981),
    accentHover: Color(0xFF34D399),
    accentSoft: Color(0xFF064E3B),
    onAccent: Color(0xFF042F2E),
    success: Color(0xFF22C55E),
    successSoft: Color(0xFF052E16),
    warning: Color(0xFFF59E0B),
    warningSoft: Color(0xFF451A03),
    danger: Color(0xFFF87171),
    dangerSoft: Color(0xFF450A0A),
    info: Color(0xFF38BDF8),
    infoSoft: Color(0xFF082F49),
    radiusSm: 6.0,
    radiusMd: 10.0,
    radiusLg: 14.0,
    radiusXl: 20.0,
    radiusPill: 9999.0,
  );

  static EucalyptusTokens of(BuildContext context) {
    return Theme.of(context).extension<EucalyptusTokens>() ?? light;
  }

  @override
  EucalyptusTokens copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceSubtle,
    Color? border,
    Color? borderStrong,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? accent,
    Color? accentHover,
    Color? accentSoft,
    Color? onAccent,
    Color? success,
    Color? successSoft,
    Color? warning,
    Color? warningSoft,
    Color? danger,
    Color? dangerSoft,
    Color? info,
    Color? infoSoft,
    double? radiusSm,
    double? radiusMd,
    double? radiusLg,
    double? radiusXl,
    double? radiusPill,
  }) {
    return EucalyptusTokens(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceSubtle: surfaceSubtle ?? this.surfaceSubtle,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted: textMuted ?? this.textMuted,
      accent: accent ?? this.accent,
      accentHover: accentHover ?? this.accentHover,
      accentSoft: accentSoft ?? this.accentSoft,
      onAccent: onAccent ?? this.onAccent,
      success: success ?? this.success,
      successSoft: successSoft ?? this.successSoft,
      warning: warning ?? this.warning,
      warningSoft: warningSoft ?? this.warningSoft,
      danger: danger ?? this.danger,
      dangerSoft: dangerSoft ?? this.dangerSoft,
      info: info ?? this.info,
      infoSoft: infoSoft ?? this.infoSoft,
      radiusSm: radiusSm ?? this.radiusSm,
      radiusMd: radiusMd ?? this.radiusMd,
      radiusLg: radiusLg ?? this.radiusLg,
      radiusXl: radiusXl ?? this.radiusXl,
      radiusPill: radiusPill ?? this.radiusPill,
    );
  }

  @override
  EucalyptusTokens lerp(ThemeExtension<EucalyptusTokens>? other, double t) {
    if (other is! EucalyptusTokens) return this;
    return EucalyptusTokens(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceSubtle: Color.lerp(surfaceSubtle, other.surfaceSubtle, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentHover: Color.lerp(accentHover, other.accentHover, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      onAccent: Color.lerp(onAccent, other.onAccent, t)!,
      success: Color.lerp(success, other.success, t)!,
      successSoft: Color.lerp(successSoft, other.successSoft, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningSoft: Color.lerp(warningSoft, other.warningSoft, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerSoft: Color.lerp(dangerSoft, other.dangerSoft, t)!,
      info: Color.lerp(info, other.info, t)!,
      infoSoft: Color.lerp(infoSoft, other.infoSoft, t)!,
      radiusSm: lerpDouble(radiusSm, other.radiusSm, t)!,
      radiusMd: lerpDouble(radiusMd, other.radiusMd, t)!,
      radiusLg: lerpDouble(radiusLg, other.radiusLg, t)!,
      radiusXl: lerpDouble(radiusXl, other.radiusXl, t)!,
      radiusPill: lerpDouble(radiusPill, other.radiusPill, t)!,
    );
  }
}

class AppTheme {
  static const String fontDisplay = 'Plus Jakarta Sans';
  static const String fontBody = 'Inter';
  static const String fontMono = 'JetBrains Mono';

  static TextStyle monoNumeric({
    required Color color,
    double fontSize = 14,
    FontWeight fontWeight = FontWeight.w600,
  }) {
    return TextStyle(
      fontFamily: fontMono,
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
  }

  static ThemeData build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final tokens = isDark ? EucalyptusTokens.dark : EucalyptusTokens.light;
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: tokens.accent,
      onPrimary: tokens.onAccent,
      primaryContainer: tokens.accentSoft,
      onPrimaryContainer: tokens.accent,
      secondary: tokens.surfaceSubtle,
      onSecondary: tokens.textPrimary,
      secondaryContainer: tokens.surfaceSubtle,
      onSecondaryContainer: tokens.textSecondary,
      error: tokens.danger,
      onError: tokens.surface,
      surface: tokens.surface,
      onSurface: tokens.textPrimary,
      outline: tokens.border,
      outlineVariant: tokens.borderStrong,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: tokens.canvas,
      fontFamily: fontBody,
      dividerColor: tokens.border,
      extensions: [tokens],
      appBarTheme: AppBarTheme(
        backgroundColor: tokens.surface,
        foregroundColor: tokens.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        shape: Border(bottom: BorderSide(color: tokens.border, width: 1)),
        titleTextStyle: TextStyle(
          fontFamily: fontDisplay,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: tokens.textPrimary,
        ),
      ),
      cardTheme: CardThemeData(
        color: tokens.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(tokens.radiusLg),
          side: BorderSide(color: tokens.border, width: 1),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: tokens.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radiusMd),
          borderSide: BorderSide(color: tokens.border, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radiusMd),
          borderSide: BorderSide(color: tokens.border, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radiusMd),
          borderSide: BorderSide(color: tokens.accent, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radiusMd),
          borderSide: BorderSide(color: tokens.danger, width: 1),
        ),
        labelStyle: TextStyle(color: tokens.textSecondary, fontSize: 13),
        hintStyle: TextStyle(color: tokens.textMuted, fontSize: 13),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: tokens.accent,
          foregroundColor: tokens.onAccent,
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(tokens.radiusMd),
          ),
          textStyle: const TextStyle(
            fontFamily: fontBody,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: tokens.textPrimary,
          minimumSize: const Size(48, 48),
          side: BorderSide(color: tokens.borderStrong, width: 1),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(tokens.radiusMd),
          ),
          textStyle: const TextStyle(
            fontFamily: fontBody,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textTheme: TextTheme(
        headlineMedium: TextStyle(
          fontFamily: fontDisplay,
          fontSize: 24,
          fontWeight: FontWeight.w700,
          color: tokens.textPrimary,
        ),
        titleLarge: TextStyle(
          fontFamily: fontDisplay,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: tokens.textPrimary,
        ),
        titleMedium: TextStyle(
          fontFamily: fontDisplay,
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: tokens.textPrimary,
        ),
        bodyMedium: TextStyle(
          fontFamily: fontBody,
          fontSize: 14,
          color: tokens.textPrimary,
        ),
        bodySmall: TextStyle(
          fontFamily: fontBody,
          fontSize: 12,
          color: tokens.textSecondary,
        ),
      ),
    );
  }
}
