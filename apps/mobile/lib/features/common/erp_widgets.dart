import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/theme/eucalyptus_theme.dart';
import 'shimmer_skeleton.dart';

class MyEkalliptusLogo extends StatelessWidget {
  final double size;
  final double? borderRadius;
  final EdgeInsetsGeometry? padding;

  const MyEkalliptusLogo({
    super.key,
    this.size = 32,
    this.borderRadius,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final resolvedRadius = borderRadius ?? (size >= 56 ? t.radiusXl : t.radiusMd);
    final resolvedPadding = padding ?? EdgeInsets.all(size >= 56 ? 10 : 3);

    return Semantics(
      image: true,
      label: 'Logo MyEkalliptus',
      child: Container(
        width: size,
        height: size,
        padding: resolvedPadding,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(resolvedRadius),
          border: Border.all(color: t.border, width: 1),
        ),
        child: Image.asset(
          'assets/images/logo.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }
}

class LazyNetworkImage extends StatelessWidget {
  final String url;
  final double? width;
  final double? height;
  final double? borderRadius;
  final BoxFit fit;

  const LazyNetworkImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.borderRadius,
    this.fit = BoxFit.cover,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final radius = borderRadius ?? t.radiusMd;
    final disableAnimations = MediaQuery.disableAnimationsOf(context);

    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Image.network(
        url,
        width: width,
        height: height,
        fit: fit,
        frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
          if (wasSynchronouslyLoaded || disableAnimations) return child;
          return AnimatedOpacity(
            opacity: frame == null ? 0.0 : 1.0,
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOut,
            child: child,
          );
        },
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return ShimmerScope(
            child: SkeletonBox(
              width: width ?? double.infinity,
              height: height ?? 120,
              radius: radius,
            ),
          );
        },
        errorBuilder: (context, _, __) => Container(
          width: width,
          height: height ?? 120,
          color: t.surfaceSubtle,
          alignment: Alignment.center,
          child: Icon(Icons.broken_image_outlined, color: t.textMuted),
        ),
      ),
    );
  }
}

enum ErpBadgeTone { success, warning, danger, info, accent, neutral }

class ErpBadge extends StatelessWidget {
  final String label;
  final ErpBadgeTone tone;

  const ErpBadge({super.key, required this.label, required this.tone});

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color fg;
    IconData icon;

    switch (tone) {
      case ErpBadgeTone.success:
        bg = t.successSoft;
        fg = isDark ? const Color(0xFF86EFAC) : const Color(0xFF14532D);
        icon = Icons.check_circle_outline;
      case ErpBadgeTone.warning:
        bg = t.warningSoft;
        fg = isDark ? const Color(0xFFFCD34D) : const Color(0xFF78350F);
        icon = Icons.schedule;
      case ErpBadgeTone.danger:
        bg = t.dangerSoft;
        fg = isDark ? const Color(0xFFFCA5A5) : const Color(0xFF991B1B);
        icon = Icons.error_outline;
      case ErpBadgeTone.info:
        bg = t.infoSoft;
        fg = isDark ? const Color(0xFF7DD3FC) : const Color(0xFF075985);
        icon = Icons.info_outline;
      case ErpBadgeTone.accent:
        bg = t.accentSoft;
        fg = isDark ? const Color(0xFF34D399) : const Color(0xFF115E59);
        icon = Icons.verified_outlined;
      case ErpBadgeTone.neutral:
        bg = t.surfaceSubtle;
        fg = t.textPrimary;
        icon = Icons.circle_outlined;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(t.radiusPill),
        border: Border.all(color: fg.withValues(alpha: 0.35), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: fg),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
          ),
        ],
      ),
    );
  }
}

class ErpEmptyCard extends StatelessWidget {
  final String title;
  final String description;
  final String? actionLabel;
  final VoidCallback? onAction;

  const ErpEmptyCard({
    super.key,
    required this.title,
    required this.description,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inbox_outlined, size: 32, color: t.textSecondary),
            const SizedBox(height: 10),
            Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text(
              description,
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class ErpErrorCard extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const ErpErrorCard({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(t.radiusLg),
        side: BorderSide(color: t.danger.withValues(alpha: 0.45), width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.warning_amber_rounded, size: 32, color: t.danger),
            const SizedBox(height: 10),
            Text('Gagal memuat data', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(message, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Coba Lagi'),
            ),
          ],
        ),
      ),
    );
  }
}

Future<String?> showBarcodeScannerSheet(BuildContext context, {String title = 'Scan Barcode / QR'}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) {
      var captured = false;
      final t = EucalyptusTokens.of(ctx);
      return SizedBox(
        height: MediaQuery.of(ctx).size.height * 0.65,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(title, style: Theme.of(ctx).textTheme.titleMedium),
                  IconButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    icon: const Icon(Icons.close),
                    tooltip: 'Tutup scanner',
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: t.border),
            Expanded(
              child: MobileScanner(
                onDetect: (capture) {
                  if (captured) return;
                  for (final barcode in capture.barcodes) {
                    final raw = barcode.rawValue;
                    if (raw != null && raw.trim().isNotEmpty) {
                      captured = true;
                      Navigator.of(ctx).pop(raw.trim());
                      break;
                    }
                  }
                },
              ),
            ),
          ],
        ),
      );
    },
  );
}
