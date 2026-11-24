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
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
            ),
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
    useRootNavigator: true,
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

/// Kartu ringkasan utama dengan gradien Eucalyptus kontras tinggi (Light & Dark).
class ErpHeroCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const ErpHeroCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: padding,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(t.radiusXl),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isDark
              ? const [Color(0xFF0F2F2B), Color(0xFF064E3B)]
              : const [Color(0xFF0F766E), Color(0xFF0B4F4A)],
        ),
        border: Border.all(
          color: (isDark ? const Color(0xFF34D399) : const Color(0xFF14B8A6))
              .withValues(alpha: 0.35),
          width: 1,
        ),
        boxShadow: isDark
            ? null
            : [
                BoxShadow(
                  color: const Color(0xFF0F766E).withValues(alpha: 0.16),
                  blurRadius: 18,
                  offset: const Offset(0, 8),
                ),
              ],
      ),
      child: child,
    );
  }
}

/// Tombol akses cepat kompak berbentuk ubin dengan ikon dan label 1 baris.
class ErpQuickActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? iconColor;
  final Color? badgeBackground;

  const ErpQuickActionTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.iconColor,
    this.badgeBackground,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(t.radiusLg),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 74),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: badgeBackground ?? t.accentSoft,
                    borderRadius: BorderRadius.circular(t.radiusMd),
                  ),
                  child: Icon(icon, size: 20, color: iconColor ?? t.accent),
                ),
                const SizedBox(height: 6),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: t.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Judul bagian konsisten dengan tombol aksi opsional di sisi kanan.
class ErpSectionHeader extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  const ErpSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (actionLabel != null && onAction != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: t.accent,
              minimumSize: const Size(44, 44),
              padding: const EdgeInsets.symmetric(horizontal: 10),
            ),
            child: Text(
              actionLabel!,
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
            ),
          ),
      ],
    );
  }
}

/// Opsi filter berbentuk pill untuk [ErpFilterPillBar].
class ErpFilterPillOption<T> {
  final T value;
  final String label;

  const ErpFilterPillOption({
    required this.value,
    required this.label,
  });
}

/// Bar filter horizontal bergaya pill dengan target sentuh >= 44px.
class ErpFilterPillBar<T> extends StatelessWidget {
  final List<ErpFilterPillOption<T>> options;
  final T selected;
  final ValueChanged<T> onSelected;

  const ErpFilterPillBar({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) {
          final opt = options[i];
          final active = opt.value == selected;
          return Material(
            color: active ? t.accent : t.surface,
            shape: StadiumBorder(
              side: BorderSide(
                color: active ? t.accent : t.border,
                width: 1,
              ),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () => onSelected(opt.value),
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                child: Text(
                  opt.label,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: active ? t.onAccent : t.textSecondary,
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Kartu baris list 3-zona: ikon kiri, judul + subjudul tengah, widget kanan.
class ErpListRowCard extends StatelessWidget {
  final IconData leadingIcon;
  final String title;
  final String subtitle;
  final Color? leadingColor;
  final Color? leadingBackground;
  final Widget? trailing;
  final VoidCallback? onTap;

  const ErpListRowCard({
    super.key,
    required this.leadingIcon,
    required this.title,
    required this.subtitle,
    this.leadingColor,
    this.leadingBackground,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(t.radiusLg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: leadingBackground ?? t.accentSoft,
                  borderRadius: BorderRadius.circular(t.radiusMd),
                ),
                child: Icon(leadingIcon, size: 20, color: leadingColor ?? t.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: t.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 10),
                trailing!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Bingkai standar modal bottom sheet yang aman terhadap keyboard & SafeArea.
class ErpBottomSheetFrame extends StatelessWidget {
  final String title;
  final Widget child;
  final String? subtitle;

  const ErpBottomSheetFrame({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final bottomSafe = MediaQuery.viewPaddingOf(context).bottom;
    return Material(
      color: t.surface,
      borderRadius: BorderRadius.vertical(top: Radius.circular(t.radiusXl)),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(20, 12, 20, 24 + bottomInset + bottomSafe),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: t.borderStrong,
                  borderRadius: BorderRadius.circular(t.radiusPill),
                ),
              ),
            ),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            if (subtitle != null && subtitle!.trim().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
            ],
            const SizedBox(height: 16),
            child,
          ],
        ),
      ),
    );
  }
}

/// Dialog konfirmasi terstandar untuk aksi destruktif maupun persetujuan sensitif.
Future<bool> showErpConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          style: destructive
              ? FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFB91C1C),
                  foregroundColor: Colors.white,
                )
              : null,
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}
