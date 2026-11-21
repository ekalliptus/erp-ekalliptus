import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/providers/app_providers.dart';
import '../core/rbac/rbac_state.dart';
import '../features/attendance/attendance_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/common/erp_widgets.dart';
import '../features/common/shimmer_skeleton.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/finance/finance_screen.dart';
import '../features/inventory/inventory_screen.dart';
import '../features/payroll/payroll_screen.dart';
import '../features/rbac/rbac_audit_screen.dart';
import '../features/shell/floating_nav_shell.dart';
import '../features/splash/splash_screen.dart';

CustomTransitionPage<void> _fadePage(GoRouterState state, Widget child) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    transitionDuration: const Duration(milliseconds: 240),
    reverseTransitionDuration: const Duration(milliseconds: 180),
    child: child,
    transitionsBuilder: (context, animation, _, pageChild) {
      if (MediaQuery.disableAnimationsOf(context)) return pageChild;
      return FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
        child: pageChild,
      );
    },
  );
}

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/splash',
    routes: [
      GoRoute(
        path: '/splash',
        pageBuilder: (context, state) => _fadePage(state, const SplashScreen()),
      ),
      GoRoute(
        path: '/login',
        pageBuilder: (context, state) => _fadePage(
          state,
          LoginScreen(
            onAuthenticated: () => context.go('/dashboard'),
          ),
        ),
      ),
      ShellRoute(
        builder: (context, state, child) {
          final profileAsync = ref.watch(sessionProfileProvider);
          return profileAsync.when(
            loading: () => const Scaffold(
              body: SafeArea(child: DashboardSkeleton()),
            ),
            error: (err, _) => Scaffold(
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ErpErrorCard(
                        message: err.toString(),
                        onRetry: () => ref.invalidate(sessionProfileProvider),
                      ),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: () async {
                          await ref.read(authServiceProvider).signOut();
                          if (context.mounted) context.go('/login');
                        },
                        child: const Text('Kembali ke Login'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            data: (profile) {
              if (profile == null) {
                return LoginScreen(
                  onAuthenticated: () => context.go('/dashboard'),
                );
              }
              return FloatingNavShell(
                profile: profile,
                currentLocation: state.uri.path,
                child: child,
              );
            },
          );
        },
        routes: [
          GoRoute(
            path: '/dashboard',
            pageBuilder: (ctx, state) => _fadePage(
              state,
              _ProfileBoundScreen(
                builder: (profile) => DashboardScreen(profile: profile),
              ),
            ),
          ),
          GoRoute(
            path: '/finance',
            builder: (ctx, _) => _ProfileBoundScreen(
              builder: (profile) => FinanceScreen(profile: profile),
            ),
          ),
          GoRoute(
            path: '/inventory',
            builder: (ctx, _) => _ProfileBoundScreen(
              builder: (profile) => InventoryScreen(profile: profile),
            ),
          ),
          GoRoute(
            path: '/attendance',
            builder: (ctx, _) => _ProfileBoundScreen(
              builder: (profile) => AttendanceScreen(profile: profile),
            ),
          ),
          GoRoute(
            path: '/payroll',
            builder: (ctx, _) => _ProfileBoundScreen(
              builder: (profile) => PayrollScreen(profile: profile),
            ),
          ),
          GoRoute(
            path: '/rbac-audit',
            builder: (ctx, _) => _ProfileBoundScreen(
              builder: (profile) => RbacAuditScreen(profile: profile),
            ),
          ),
        ],
      ),
    ],
  );
});

class _ProfileBoundScreen extends ConsumerWidget {
  final Widget Function(ErpProfile profile) builder;

  const _ProfileBoundScreen({required this.builder});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(sessionProfileProvider).valueOrNull;
    if (profile == null) {
      return const DashboardSkeleton();
    }
    return builder(profile);
  }
}
