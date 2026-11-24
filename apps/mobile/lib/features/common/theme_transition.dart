import 'dart:async' show unawaited;
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/app_providers.dart';
import '../../core/theme/eucalyptus_theme.dart';

class ThemeRevealController {
  final void Function({
    required Offset origin,
    required VoidCallback onCommitTheme,
  }) toggleTheme;

  const ThemeRevealController({required this.toggleTheme});
}

class _ThemeRevealScope extends InheritedWidget {
  final ThemeRevealController controller;

  const _ThemeRevealScope({
    required this.controller,
    required super.child,
  });

  @override
  bool updateShouldNotify(_ThemeRevealScope oldWidget) => controller != oldWidget.controller;
}

class ThemeRevealHost extends StatefulWidget {
  final Widget child;
  final Duration duration;

  const ThemeRevealHost({
    super.key,
    required this.child,
    this.duration = const Duration(milliseconds: 480),
  });

  static ThemeRevealController? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<_ThemeRevealScope>()?.controller;
  }

  @override
  State<ThemeRevealHost> createState() => _ThemeRevealHostState();
}

class _ThemeRevealHostState extends State<ThemeRevealHost> with SingleTickerProviderStateMixin {
  final GlobalKey _boundaryKey = GlobalKey();
  late final AnimationController _controller;
  late final Animation<double> _curved;
  late final ThemeRevealController _scopeController;

  ui.Image? _snapshot;
  Offset _origin = Offset.zero;
  Color _ringColor = EucalyptusTokens.light.accent;
  int _toggleSeq = 0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: widget.duration);
    _curved = CurvedAnimation(
      parent: _controller,
      curve: const Cubic(0.23, 1, 0.32, 1),
    );
    _controller.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _clearSnapshot();
      }
    });
    _scopeController = ThemeRevealController(toggleTheme: _performRevealToggle);
  }

  void _disposeImage(ui.Image? img) {
    if (img == null) return;
    try {
      img.dispose();
    } catch (_) {
      // Ignore duplicate disposal when framework releases textures on teardown.
    }
  }

  void _clearSnapshot() {
    final old = _snapshot;
    if (old == null) return;
    if (mounted) {
      setState(() => _snapshot = null);
    } else {
      _snapshot = null;
    }
    _disposeImage(old);
  }

  void _performRevealToggle({
    required Offset origin,
    required VoidCallback onCommitTheme,
  }) {
    if (!mounted) return;
    final seq = ++_toggleSeq;

    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.stop();
      _clearSnapshot();
      onCommitTheme();
      return;
    }

    final isAnimatingOrHasSnapshot = _controller.isAnimating || _snapshot != null;
    final renderObj = _boundaryKey.currentContext?.findRenderObject();
    final canSyncCaptureNow = !isAnimatingOrHasSnapshot &&
        renderObj is RenderRepaintBoundary &&
        renderObj.hasSize &&
        !renderObj.debugNeedsPaint;

    if (canSyncCaptureNow) {
      ui.Image? captured;
      try {
        final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 2.5);
        captured = renderObj.toImageSync(pixelRatio: dpr);
      } catch (_) {
        captured = null;
      }
      _finishCaptureAndAnimate(
        seq: seq,
        captured: captured,
        origin: origin,
        onCommitTheme: onCommitTheme,
      );
      return;
    }

    unawaited(
      _performRevealToggleAsync(
        seq: seq,
        origin: origin,
        onCommitTheme: onCommitTheme,
      ),
    );
  }

  Future<void> _performRevealToggleAsync({
    required int seq,
    required Offset origin,
    required VoidCallback onCommitTheme,
  }) async {
    if (_controller.isAnimating) {
      _controller.stop();
    }
    if (_snapshot != null) {
      final old = _snapshot;
      if (mounted) {
        setState(() => _snapshot = null);
      } else {
        _snapshot = null;
      }
      _disposeImage(old);
      WidgetsBinding.instance.scheduleFrame();
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || seq != _toggleSeq) return;
    }

    ui.Image? captured;
    for (var attempt = 0; attempt < 2; attempt++) {
      final renderObj = _boundaryKey.currentContext?.findRenderObject();
      if (renderObj is! RenderRepaintBoundary || !renderObj.hasSize) break;
      if (!renderObj.debugNeedsPaint) {
        try {
          final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 2.5);
          captured = renderObj.toImageSync(pixelRatio: dpr);
        } catch (_) {
          captured = null;
        }
        break;
      }
      WidgetsBinding.instance.scheduleFrame();
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || seq != _toggleSeq) return;
    }

    if (captured == null) {
      final renderObj = _boundaryKey.currentContext?.findRenderObject();
      if (renderObj is RenderRepaintBoundary && renderObj.hasSize) {
        try {
          final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 2.5);
          if (!renderObj.debugNeedsPaint) {
            captured = renderObj.toImageSync(pixelRatio: dpr);
          } else {
            captured = await renderObj.toImage(pixelRatio: dpr);
          }
        } catch (_) {
          captured = null;
        }
      }
    }

    if (!mounted || seq != _toggleSeq) {
      _disposeImage(captured);
      return;
    }

    _finishCaptureAndAnimate(
      seq: seq,
      captured: captured,
      origin: origin,
      onCommitTheme: onCommitTheme,
    );
  }

  void _finishCaptureAndAnimate({
    required int seq,
    required ui.Image? captured,
    required Offset origin,
    required VoidCallback onCommitTheme,
  }) {
    if (!mounted || seq != _toggleSeq) {
      _disposeImage(captured);
      return;
    }
    if (captured == null) {
      onCommitTheme();
      return;
    }

    final hostBox = context.findRenderObject() as RenderBox?;
    final localOrigin =
        (hostBox != null && hostBox.hasSize) ? hostBox.globalToLocal(origin) : origin;

    final isCurrentlyDark = Theme.of(context).brightness == Brightness.dark;
    final nextTokens = isCurrentlyDark ? EucalyptusTokens.light : EucalyptusTokens.dark;

    _controller.reset();
    setState(() {
      _snapshot = captured;
      _origin = localOrigin;
      _ringColor = nextTokens.accent;
    });

    onCommitTheme();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || seq != _toggleSeq || _snapshot == null) return;
      _controller.forward(from: 0.0);
    });
  }

  @override
  void dispose() {
    _toggleSeq++;
    _controller.dispose();
    final old = _snapshot;
    _snapshot = null;
    _disposeImage(old);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _ThemeRevealScope(
      controller: _scopeController,
      child: Stack(
        children: [
          RepaintBoundary(
            key: _boundaryKey,
            child: widget.child,
          ),
          if (_snapshot != null)
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: _curved,
                  builder: (context, _) {
                    final img = _snapshot;
                    if (img == null) return const SizedBox.shrink();
                    final progress = _curved.value.clamp(0.0, 1.0);
                    return CustomPaint(
                      key: const ValueKey<String>('theme-reveal-overlay'),
                      painter: _ThemeRevealOverlayPainter(
                        snapshot: img,
                        center: _origin,
                        progress: progress,
                        ringColor: _ringColor,
                      ),
                    );
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

double _maxRevealRadius(Size size, Offset center) {
  final dx = math.max(center.dx, size.width - center.dx);
  final dy = math.max(center.dy, size.height - center.dy);
  return math.sqrt(dx * dx + dy * dy);
}

class _ThemeRevealOverlayPainter extends CustomPainter {
  final ui.Image snapshot;
  final Offset center;
  final double progress;
  final Color ringColor;

  const _ThemeRevealOverlayPainter({
    required this.snapshot,
    required this.center,
    required this.progress,
    required this.ringColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final dstRect = Offset.zero & size;
    final srcRect = Rect.fromLTWH(
      0,
      0,
      snapshot.width.toDouble(),
      snapshot.height.toDouble(),
    );
    final imagePaint = Paint()..filterQuality = FilterQuality.medium;
    final radius = _maxRevealRadius(size, center) * progress;

    if (radius <= 0.5) {
      canvas.drawImageRect(snapshot, srcRect, dstRect, imagePaint);
      return;
    }

    canvas.save();
    final path = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(dstRect)
      ..addOval(Rect.fromCircle(center: center, radius: radius));
    canvas.clipPath(path);
    canvas.drawImageRect(snapshot, srcRect, dstRect, imagePaint);
    canvas.restore();

    if (progress > 0.01 && progress < 0.99) {
      final opacity = (1.0 - progress).clamp(0.0, 1.0) * 0.42;
      final ringPaint = Paint()
        ..color = ringColor.withValues(alpha: opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5;
      canvas.drawCircle(center, radius, ringPaint);
    }
  }

  @override
  bool shouldRepaint(_ThemeRevealOverlayPainter oldDelegate) {
    return oldDelegate.snapshot != snapshot ||
        oldDelegate.progress != progress ||
        oldDelegate.center != center ||
        oldDelegate.ringColor != ringColor;
  }
}

class AnimatedThemeToggleButton extends ConsumerWidget {
  const AnimatedThemeToggleButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EucalyptusTokens.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    final tooltip = isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';

    void handleTap() {
      HapticFeedback.lightImpact();
      final box = context.findRenderObject() as RenderBox?;
      final origin = box != null && box.hasSize
          ? box.localToGlobal(box.size.center(Offset.zero))
          : MediaQuery.sizeOf(context).topRight(const Offset(-36, 48));

      final nextMode = isDark ? ThemeMode.light : ThemeMode.dark;
      void commit() {
        ref.read(themeModeProvider.notifier).state = nextMode;
      }

      final host = ThemeRevealHost.maybeOf(context);
      if (host != null) {
        host.toggleTheme(origin: origin, onCommitTheme: commit);
      } else {
        commit();
      }
    }

    return Tooltip(
      message: tooltip,
      child: Material(
        color: t.surfaceSubtle,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(t.radiusMd),
          side: BorderSide(color: t.border, width: 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(t.radiusMd),
          onTap: handleTap,
          child: Semantics(
            button: true,
            label: tooltip,
            child: SizedBox(
              width: 40,
              height: 40,
              child: Center(
                child: AnimatedSwitcher(
                  duration: disableAnimations
                      ? Duration.zero
                      : const Duration(milliseconds: 260),
                  switchInCurve: const Cubic(0.23, 1, 0.32, 1),
                  switchOutCurve: const Cubic(0.23, 1, 0.32, 1),
                  transitionBuilder: (child, anim) {
                    if (disableAnimations) {
                      return FadeTransition(opacity: anim, child: child);
                    }
                    final scale = Tween<double>(begin: 0.82, end: 1.0).animate(anim);
                    final turns = Tween<double>(begin: -0.18, end: 0.0).animate(anim);
                    return FadeTransition(
                      opacity: anim,
                      child: ScaleTransition(
                        scale: scale,
                        child: RotationTransition(turns: turns, child: child),
                      ),
                    );
                  },
                  child: Icon(
                    isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
                    key: ValueKey<bool>(isDark),
                    size: 20,
                    color: t.textPrimary,
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
