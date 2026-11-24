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

class _SkeletonHeroCard extends StatelessWidget {
  final double height;
  final Widget child;

  const _SkeletonHeroCard({
    required this.height,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(t.radiusXl),
        side: BorderSide(color: t.border, width: 1),
      ),
      child: SizedBox(
        height: height,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: child,
        ),
      ),
    );
  }
}

class _SkeletonFilterPillRow extends StatelessWidget {
  final int count;

  const _SkeletonFilterPillRow({this.count = 4});

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: count,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) => SkeletonBox(
          width: i == 0 ? 74 : 96,
          height: 44,
          radius: t.radiusPill,
        ),
      ),
    );
  }
}

class _SkeletonListRowCard extends StatelessWidget {
  const _SkeletonListRowCard();

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return SkeletonCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          SkeletonBox(width: 42, height: 42, radius: t.radiusMd),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FractionallySizedBox(
                  widthFactor: 0.72,
                  child: SkeletonBox(width: double.infinity, height: 14),
                ),
                SizedBox(height: 7),
                FractionallySizedBox(
                  widthFactor: 0.92,
                  child: SkeletonBox(width: double.infinity, height: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              SkeletonBox(width: 68, height: 13),
              SizedBox(height: 6),
              SkeletonBox(width: 60, height: 20, radius: 9999),
            ],
          ),
        ],
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
          child: _SkeletonListRowCard(),
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
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 108),
          children: [
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonBox(width: 120, height: 20),
                    SizedBox(height: 6),
                    SkeletonBox(width: 150, height: 12),
                  ],
                ),
                SkeletonBox(width: 84, height: 24, radius: 9999),
              ],
            ),
            const SizedBox(height: 14),
            _SkeletonHeroCard(
              height: 168,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 132, height: 12),
                      SkeletonBox(width: 78, height: 22, radius: 9999),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const SkeletonBox(width: 200, height: 28),
                  const Spacer(),
                  SkeletonBox(width: 140, height: 34, radius: t.radiusPill),
                ],
              ),
            ),
            const SizedBox(height: 18),
            const SkeletonBox(width: 110, height: 15),
            const SizedBox(height: 10),
            Row(
              children: [
                for (var i = 0; i < 4; i++) ...[
                  if (i > 0) const SizedBox(width: 10),
                  Expanded(
                    child: SkeletonCard(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                      child: SizedBox(
                        height: 54,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SkeletonBox(width: 34, height: 34, radius: t.radiusMd),
                            const SizedBox(height: 6),
                            const SkeletonBox(width: 48, height: 10),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 18),
            const Row(
              children: [
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 80, height: 12),
                        SizedBox(height: 10),
                        SkeletonBox(width: 72, height: 22),
                        SizedBox(height: 8),
                        SkeletonBox(width: 90, height: 11),
                      ],
                    ),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 88, height: 12),
                        SizedBox(height: 10),
                        SkeletonBox(width: 72, height: 22),
                        SizedBox(height: 8),
                        SkeletonBox(width: 90, height: 11),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            const SkeletonBox(width: 140, height: 15),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: _SkeletonListRowCard(),
            ),
            const _SkeletonListRowCard(),
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
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 108),
          children: [
            _SkeletonHeroCard(
              height: 176,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SkeletonBox(width: 140, height: 12),
                  const SizedBox(height: 10),
                  const SkeletonBox(width: 196, height: 28),
                  const Spacer(),
                  Row(
                    children: [
                      Expanded(child: SkeletonBox(height: 46, radius: t.radiusMd)),
                      const SizedBox(width: 10),
                      Expanded(child: SkeletonBox(height: 46, radius: t.radiusMd)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SkeletonBox(width: 130, height: 15),
            const SizedBox(height: 8),
            SizedBox(
              height: 98,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: 3,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (_, __) => const SizedBox(
                  width: 172,
                  child: SkeletonCard(
                    padding: EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SkeletonBox(width: 108, height: 13),
                        SizedBox(height: 10),
                        SkeletonBox(width: 124, height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const _SkeletonFilterPillRow(count: 5),
            const SizedBox(height: 14),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
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
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 108),
          children: [
            Row(
              children: [
                Expanded(child: SkeletonBox(height: 48, radius: t.radiusMd)),
                const SizedBox(width: 8),
                SkeletonBox(width: 48, height: 48, radius: t.radiusMd),
              ],
            ),
            const SizedBox(height: 12),
            const Row(
              children: [
                Expanded(
                  child: SkeletonCard(
                    padding: EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 72, height: 11),
                        SizedBox(height: 8),
                        SkeletonBox(width: 48, height: 22),
                        SizedBox(height: 6),
                        SkeletonBox(width: 96, height: 11),
                      ],
                    ),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: SkeletonCard(
                    padding: EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 72, height: 11),
                        SizedBox(height: 8),
                        SkeletonBox(width: 48, height: 22),
                        SizedBox(height: 6),
                        SkeletonBox(width: 96, height: 11),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: SkeletonBox(height: 48, radius: t.radiusMd)),
                const SizedBox(width: 10),
                Expanded(child: SkeletonBox(height: 48, radius: t.radiusMd)),
              ],
            ),
            const SizedBox(height: 12),
            const _SkeletonFilterPillRow(count: 3),
            const SizedBox(height: 12),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
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
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 108),
          children: [
            Row(
              children: [
                for (var i = 0; i < 7; i++) ...[
                  if (i > 0) const SizedBox(width: 6),
                  Expanded(child: SkeletonBox(height: 62, radius: t.radiusMd)),
                ],
              ],
            ),
            const SizedBox(height: 12),
            _SkeletonHeroCard(
              height: 176,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 150, height: 16),
                      SkeletonBox(width: 90, height: 22, radius: 9999),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const SkeletonBox(width: 190, height: 20),
                  const Spacer(),
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
            const SizedBox(height: 14),
            const _SkeletonFilterPillRow(count: 3),
            const SizedBox(height: 12),
            for (var i = 0; i < 3; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
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
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 108),
          children: [
            const _SkeletonFilterPillRow(count: 3),
            const SizedBox(height: 12),
            _SkeletonHeroCard(
              height: 170,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      SkeletonBox(width: 170, height: 14),
                      SkeletonBox(width: 72, height: 22, radius: 9999),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const SkeletonBox(width: 190, height: 28),
                  const Spacer(),
                  SkeletonBox(width: double.infinity, height: 44, radius: t.radiusMd),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SkeletonBox(width: 168, height: 16),
            const SizedBox(height: 8),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
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
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 108),
          children: [
            const _SkeletonFilterPillRow(count: 3),
            const SizedBox(height: 12),
            SkeletonBox(width: double.infinity, height: 48, radius: t.radiusMd),
            const SizedBox(height: 12),
            for (var i = 0; i < 5; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
              ),
          ],
        ),
      ),
    );
  }
}

class ProfileSkeleton extends StatelessWidget {
  final String label;

  const ProfileSkeleton({
    super.key,
    this.label = 'Memuat halaman profil dan ruang kerja...',
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Semantics(
      label: label,
      liveRegion: true,
      child: ShimmerScope(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 36),
          children: [
            _SkeletonHeroCard(
              height: 204,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SkeletonBox(width: 64, height: 64, radius: t.radiusPill),
                      const SizedBox(width: 14),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SkeletonBox(width: 168, height: 18),
                            SizedBox(height: 8),
                            SkeletonBox(width: 120, height: 12),
                            SizedBox(height: 8),
                            SkeletonBox(width: 96, height: 20, radius: 9999),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  const Row(
                    children: [
                      Expanded(child: SkeletonBox(height: 46)),
                      SizedBox(width: 8),
                      Expanded(child: SkeletonBox(height: 46)),
                      SizedBox(width: 8),
                      Expanded(child: SkeletonBox(height: 46)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Row(
              children: [
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 84, height: 11),
                        SizedBox(height: 8),
                        SkeletonBox(width: 72, height: 22),
                      ],
                    ),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: SkeletonCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(width: 84, height: 11),
                        SizedBox(height: 8),
                        SkeletonBox(width: 72, height: 22),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            for (var i = 0; i < 4; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: _SkeletonListRowCard(),
              ),
          ],
        ),
      ),
    );
  }
}
