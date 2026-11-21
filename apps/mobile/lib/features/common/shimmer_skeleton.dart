import 'package:flutter/material.dart';
import '../../core/theme/eucalyptus_theme.dart';

class _ShimmerInherited extends InheritedNotifier<Animation<double>> {
  const _ShimmerInherited({
    required Animation<double> animation,
    required super.child,
  }) : super(notifier: animation);

  static Animation<double>? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<_ShimmerInherited>()?.notifier;
  }
}

class ShimmerScope extends StatefulWidget {
  final Widget child;
  final Duration period;

  const ShimmerScope({
    super.key,
    required this.child,
    this.period = const Duration(milliseconds: 1400),
  });

  @override
  State<ShimmerScope> createState() => _ShimmerScopeState();
}

class _ShimmerScopeState extends State<ShimmerScope> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.period);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    if (disableAnimations) {
      _controller.stop();
      _controller.value = 0.0;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _ShimmerInherited(
      animation: _controller,
      child: widget.child,
    );
  }
}

class _SlidingGradientTransform extends GradientTransform {
  final double slidePercent;

  const _SlidingGradientTransform(this.slidePercent);

  @override
  Matrix4? transform(Rect bounds, {TextDirection? textDirection}) {
    return Matrix4.translationValues(bounds.width * slidePercent, 0.0, 0.0);
  }
}

class SkeletonBox extends StatelessWidget {
  final double? width;
  final double height;
  final double? radius;

  const SkeletonBox({
    super.key,
    this.width,
    required this.height,
    this.radius,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    final baseColor = isDark ? const Color(0xFF1B211E) : const Color(0xFFE5EAE3);
    final highlightColor = isDark ? const Color(0xFF28332E) : const Color(0xFFF5F7F4);
    final resolvedRadius = radius ?? t.radiusSm;
    final animation = _ShimmerInherited.maybeOf(context);

    if (disableAnimations || animation == null) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: baseColor,
          borderRadius: BorderRadius.circular(resolvedRadius),
        ),
      );
    }

    final slide = (animation.value * 2.4) - 1.2;

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(resolvedRadius),
        gradient: LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [baseColor, highlightColor, baseColor],
          stops: const [0.15, 0.5, 0.85],
          transform: _SlidingGradientTransform(slide),
        ),
      ),
    );
  }
}

class SkeletonCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const SkeletonCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: child,
      ),
    );
  }
}

class LazyListShimmerFooter extends StatelessWidget {
  final String label;

  const LazyListShimmerFooter({
    super.key,
    this.label = 'Memuat data berikutnya...',
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      liveRegion: true,
      child: const ShimmerScope(
        child: Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: SkeletonCard(
            padding: EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonBox(width: 150, height: 14),
                      SizedBox(height: 8),
                      SkeletonBox(width: 210, height: 11),
                    ],
                  ),
                ),
                SizedBox(width: 12),
                SkeletonBox(width: 72, height: 22, radius: 9999),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class DashboardSkeleton extends StatelessWidget {
  final String label;

  const DashboardSkeleton({
    super.key,
    this.label = 'Memuat ringkasan operasional MyEkalliptus...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            SkeletonCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 132, height: 12),
                      SkeletonBox(width: 84, height: 24, radius: 9999),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const SkeletonBox(width: 210, height: 28),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      SkeletonBox(width: 116, height: 40, radius: t.radiusMd),
                      const SizedBox(width: 10),
                      SkeletonBox(width: 112, height: 40, radius: t.radiusMd),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            const Row(
              children: [
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 80, height: 12),
                        SizedBox(height: 10),
                        SkeletonBox(width: 96, height: 22),
                        SizedBox(height: 10),
                        SkeletonBox(width: 84, height: 22, radius: 9999),
                      ],
                    ),
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 88, height: 12),
                        SizedBox(height: 10),
                        SkeletonBox(width: 104, height: 22),
                        SizedBox(height: 10),
                        SkeletonBox(width: 78, height: 22, radius: 9999),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const SkeletonCard(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 140, height: 15),
                        SizedBox(height: 8),
                        SkeletonBox(width: 210, height: 12),
                      ],
                    ),
                  ),
                  SizedBox(width: 12),
                  SkeletonBox(width: 20, height: 20),
                ],
              ),
            ),
            const SizedBox(height: 10),
            const SkeletonCard(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 190, height: 15),
                        SizedBox(height: 8),
                        SkeletonBox(width: 230, height: 12),
                      ],
                    ),
                  ),
                  SizedBox(width: 12),
                  SkeletonBox(width: 20, height: 20),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FinanceSkeleton extends StatelessWidget {
  final String label;

  const FinanceSkeleton({
    super.key,
    this.label = 'Memuat saldo rekening dan transaksi keuangan...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            SkeletonCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SkeletonBox(width: 140, height: 12),
                  const SizedBox(height: 10),
                  const SkeletonBox(width: 200, height: 26),
                  const SizedBox(height: 12),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 120, height: 12),
                      SkeletonBox(width: 120, height: 12),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SkeletonBox(width: 190, height: 40, radius: t.radiusMd),
                ],
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              height: 92,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: 3,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (_, __) => const SizedBox(
                  width: 195,
                  child: SkeletonCard(
                    padding: EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SkeletonBox(width: 112, height: 14),
                        SizedBox(height: 10),
                        SkeletonBox(width: 132, height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 18),
            const SkeletonBox(width: 220, height: 16),
            const SizedBox(height: 10),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: SkeletonCard(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 165, height: 14),
                            SizedBox(height: 8),
                            SkeletonBox(width: 190, height: 11),
                          ],
                        ),
                      ),
                      SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          SkeletonBox(width: 82, height: 14),
                          SizedBox(height: 6),
                          SkeletonBox(width: 64, height: 20, radius: 9999),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class InventorySkeleton extends StatelessWidget {
  final String label;

  const InventorySkeleton({
    super.key,
    this.label = 'Memuat stok gudang dan katalog produk...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            Row(
              children: [
                Expanded(child: SkeletonBox(height: 48, radius: t.radiusMd)),
                const SizedBox(width: 8),
                SkeletonBox(width: 48, height: 48, radius: t.radiusMd),
              ],
            ),
            const SizedBox(height: 12),
            SkeletonBox(width: double.infinity, height: 44, radius: t.radiusMd),
            const SizedBox(height: 14),
            for (var i = 0; i < 5; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: SkeletonCard(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 175, height: 14),
                            SizedBox(height: 8),
                            SkeletonBox(width: 155, height: 11),
                          ],
                        ),
                      ),
                      SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          SkeletonBox(width: 56, height: 14),
                          SizedBox(height: 6),
                          SkeletonBox(width: 68, height: 20, radius: 9999),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class AttendanceSkeleton extends StatelessWidget {
  final String label;

  const AttendanceSkeleton({
    super.key,
    this.label = 'Memuat lokasi geofence dan riwayat absensi...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            SkeletonCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 150, height: 16),
                      SkeletonBox(width: 90, height: 22, radius: 9999),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      SkeletonBox(width: 96, height: 34, radius: t.radiusMd),
                      const SizedBox(width: 8),
                      SkeletonBox(width: 96, height: 34, radius: t.radiusMd),
                      const SizedBox(width: 8),
                      SkeletonBox(width: 84, height: 34, radius: t.radiusMd),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(child: SkeletonBox(height: 44, radius: t.radiusMd)),
                      const SizedBox(width: 10),
                      Expanded(child: SkeletonBox(height: 44, radius: t.radiusMd)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SkeletonBox(width: 160, height: 16),
            const SizedBox(height: 10),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: SkeletonCard(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 180, height: 14),
                            SizedBox(height: 8),
                            SkeletonBox(width: 215, height: 11),
                          ],
                        ),
                      ),
                      SizedBox(width: 12),
                      SkeletonBox(width: 86, height: 22, radius: 9999),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class PayrollSkeleton extends StatelessWidget {
  final String label;

  const PayrollSkeleton({
    super.key,
    this.label = 'Memuat periode penggajian dan rincian slip...',
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            const SkeletonCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 170, height: 16),
                      SkeletonBox(width: 72, height: 22, radius: 9999),
                    ],
                  ),
                  SizedBox(height: 12),
                  SkeletonBox(width: 195, height: 24),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SkeletonBox(width: 175, height: 16),
            const SizedBox(height: 10),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: SkeletonCard(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 165, height: 14),
                            SizedBox(height: 8),
                            SkeletonBox(width: 210, height: 11),
                          ],
                        ),
                      ),
                      SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          SkeletonBox(width: 84, height: 14),
                          SizedBox(height: 6),
                          SkeletonBox(width: 70, height: 11),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class RbacAuditSkeleton extends StatelessWidget {
  final String label;

  const RbacAuditSkeleton({
    super.key,
    this.label = 'Memuat matriks role RBAC dan audit trail...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            SkeletonBox(width: double.infinity, height: 44, radius: t.radiusPill),
            const SizedBox(height: 16),
            const SkeletonBox(width: 140, height: 16),
            const SizedBox(height: 10),
            for (var i = 0; i < 5; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: SkeletonCard(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 150, height: 14),
                            SizedBox(height: 8),
                            SkeletonBox(width: 220, height: 11),
                          ],
                        ),
                      ),
                      SizedBox(width: 12),
                      SkeletonBox(width: 68, height: 22, radius: 9999),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
