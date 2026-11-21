import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const tokensPath = path.resolve(__dirname, '../design-tokens.json');
const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

function toKebab(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function toDartColor(hex) {
  const clean = hex.replace('#', '').toUpperCase();
  return `Color(0xFF${clean})`;
}

function buildCss(t) {
  const lightVars = Object.entries(t.colors.light)
    .map(([k, v]) => `  --ep-${toKebab(k)}: ${v};`)
    .join('\n');

  const darkVars = Object.entries(t.colors.dark)
    .map(([k, v]) => `  --ep-${toKebab(k)}: ${v};`)
    .join('\n');

  const themeColors = Object.keys(t.colors.light)
    .map((k) => {
      const kebab = toKebab(k);
      return `  --color-${kebab}: var(--ep-${kebab});`;
    })
    .join('\n');

  const radiiVars = Object.entries(t.radius)
    .map(([k, v]) => `  --ep-radius-${k}: ${v}px;`)
    .join('\n');

  const themeRadii = Object.keys(t.radius)
    .map((k) => `  --radius-${k}: var(--ep-radius-${k});`)
    .join('\n');

  const spacingVars = Object.entries(t.spacing)
    .map(([k, v]) => `  --ep-space-${k}: ${v}px;`)
    .join('\n');

  return `/* Generated from packages/tokens/design-tokens.json by sync-tokens.mjs. */
:root {
  color-scheme: light;
${lightVars}
${radiiVars}
${spacingVars}
  --ep-font-display: '${t.typography.display}', system-ui, -apple-system, sans-serif;
  --ep-font-sans: '${t.typography.body}', system-ui, -apple-system, sans-serif;
  --ep-font-mono: '${t.typography.mono}', ui-monospace, SFMono-Regular, monospace;
}

.dark {
  color-scheme: dark;
${darkVars}
}

@theme inline {
${themeColors}
${themeRadii}
  --font-display: var(--ep-font-display);
  --font-sans: var(--ep-font-sans);
  --font-mono: var(--ep-font-mono);
}
`;
}

function buildDart(t) {
  const keys = Object.keys(t.colors.light);
  const fields = keys.map((k) => `  final Color ${k};`).join('\n');
  const ctorParams = keys.map((k) => `    required this.${k},`).join('\n');
  const lightAssign = keys
    .map((k) => `    ${k}: ${toDartColor(t.colors.light[k])},`)
    .join('\n');
  const darkAssign = keys
    .map((k) => `    ${k}: ${toDartColor(t.colors.dark[k])},`)
    .join('\n');
  const copyParams = keys.map((k) => `    Color? ${k},`).join('\n');
  const copyReturn = keys.map((k) => `      ${k}: ${k} ?? this.${k},`).join('\n');
  const lerpReturn = keys
    .map((k) => `      ${k}: Color.lerp(${k}, other.${k}, t)!,`)
    .join('\n');

  return `// Generated from packages/tokens/design-tokens.json by sync-tokens.mjs.
import 'dart:ui' show FontFeature, lerpDouble;
import 'package:flutter/material.dart';

@immutable
class EucalyptusTokens extends ThemeExtension<EucalyptusTokens> {
${fields}
  final double radiusSm;
  final double radiusMd;
  final double radiusLg;
  final double radiusXl;
  final double radiusPill;

  const EucalyptusTokens({
${ctorParams}
    required this.radiusSm,
    required this.radiusMd,
    required this.radiusLg,
    required this.radiusXl,
    required this.radiusPill,
  });

  static const light = EucalyptusTokens(
${lightAssign}
    radiusSm: ${t.radius.sm.toFixed(1)},
    radiusMd: ${t.radius.md.toFixed(1)},
    radiusLg: ${t.radius.lg.toFixed(1)},
    radiusXl: ${t.radius.xl.toFixed(1)},
    radiusPill: ${t.radius.pill.toFixed(1)},
  );

  static const dark = EucalyptusTokens(
${darkAssign}
    radiusSm: ${t.radius.sm.toFixed(1)},
    radiusMd: ${t.radius.md.toFixed(1)},
    radiusLg: ${t.radius.lg.toFixed(1)},
    radiusXl: ${t.radius.xl.toFixed(1)},
    radiusPill: ${t.radius.pill.toFixed(1)},
  );

  static EucalyptusTokens of(BuildContext context) {
    return Theme.of(context).extension<EucalyptusTokens>() ?? light;
  }

  @override
  EucalyptusTokens copyWith({
${copyParams}
    double? radiusSm,
    double? radiusMd,
    double? radiusLg,
    double? radiusXl,
    double? radiusPill,
  }) {
    return EucalyptusTokens(
${copyReturn}
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
${lerpReturn}
      radiusSm: lerpDouble(radiusSm, other.radiusSm, t)!,
      radiusMd: lerpDouble(radiusMd, other.radiusMd, t)!,
      radiusLg: lerpDouble(radiusLg, other.radiusLg, t)!,
      radiusXl: lerpDouble(radiusXl, other.radiusXl, t)!,
      radiusPill: lerpDouble(radiusPill, other.radiusPill, t)!,
    );
  }
}

class AppTheme {
  static const String fontDisplay = '${t.typography.display}';
  static const String fontBody = '${t.typography.body}';
  static const String fontMono = '${t.typography.mono}';

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
`;
}

const cssOut = path.join(repoRoot, 'apps/web/src/styles/tokens.css');
const dartOut = path.join(repoRoot, 'apps/mobile/lib/core/theme/eucalyptus_theme.dart');

fs.mkdirSync(path.dirname(cssOut), { recursive: true });
fs.mkdirSync(path.dirname(dartOut), { recursive: true });

fs.writeFileSync(cssOut, buildCss(tokens), 'utf8');
fs.writeFileSync(dartOut, buildDart(tokens), 'utf8');

console.log(`Synced tokens -> ${path.relative(repoRoot, cssOut)} & ${path.relative(repoRoot, dartOut)}`);
