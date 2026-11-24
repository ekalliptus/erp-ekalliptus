import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/network/api_client.dart';
import '../core/providers/app_providers.dart';
import '../core/rbac/rbac_state.dart';
import '../features/attendance/attendance_screen.dart';
import '../features/attendance/office_map_settings_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/common/erp_widgets.dart';
import '../features/common/shimmer_skeleton.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/finance/finance_screen.dart';
import '../features/inventory/inventory_screen.dart';
import '../features/payroll/payroll_screen.dart';
import '../features/permissions/permission_setup_screen.dart';
import '../features/profile/profile_screen.dart';
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

Future<void> _openClaimCodeDialog(BuildContext context, WidgetRef ref) async {
  final claimed = await showDialog<bool>(
    context: context,
    builder: (_) => const _ClaimCodeRecoveryDialog(),
  );
  if (claimed == true && context.mounted) {
    ref.invalidate(sessionProfileProvider);
  }
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
      GoRoute(
        path: '/permissions',
        pageBuilder: (context, state) => _fadePage(
          state,
          PermissionSetupScreen(
            nextRoute: state.uri.queryParameters['next'],
          ),
        ),
      ),
      GoRoute(
        path: '/office-map-settings',
        pageBuilder: (context, state) => _fadePage(
          state,
          _ProfileBoundScreen(
            builder: (profile) => OfficeMapSettingsScreen(profile: profile),
          ),
        ),
      ),
      GoRoute(
        path: '/profile',
        pageBuilder: (context, state) => _fadePage(
          state,
          _ProfileBoundScreen(
            builder: (profile) => ProfileScreen(profile: profile),
          ),
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => _AuthenticatedShellHost(
          currentLocation: state.uri.path,
          navigationShell: navigationShell,
        ),
        branches: [
          StatefulShellBranch(
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
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/finance',
                pageBuilder: (ctx, state) => _fadePage(
                  state,
                  _ProfileBoundScreen(
                    builder: (profile) => FinanceScreen(profile: profile),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/inventory',
                pageBuilder: (ctx, state) => _fadePage(
                  state,
                  _ProfileBoundScreen(
                    builder: (profile) => InventoryScreen(profile: profile),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/attendance',
                pageBuilder: (ctx, state) => _fadePage(
                  state,
                  _ProfileBoundScreen(
                    builder: (profile) => AttendanceScreen(profile: profile),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/payroll',
                pageBuilder: (ctx, state) => _fadePage(
                  state,
                  _ProfileBoundScreen(
                    builder: (profile) => PayrollScreen(profile: profile),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/rbac-audit',
                pageBuilder: (ctx, state) => _fadePage(
                  state,
                  _ProfileBoundScreen(
                    builder: (profile) => RbacAuditScreen(profile: profile),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

class _AuthenticatedShellHost extends ConsumerWidget {
  final String currentLocation;
  final StatefulNavigationShell navigationShell;

  const _AuthenticatedShellHost({
    required this.currentLocation,
    required this.navigationShell,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(sessionProfileProvider);
    return profileAsync.when(
      skipLoadingOnReload: true,
      loading: () => const Scaffold(
        body: SafeArea(child: DashboardSkeleton()),
      ),
      error: (err, _) {
        final isUnclaimed = err is ApiException && err.statusCode == 403;
        return Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ErpErrorCard(
                      message: isUnclaimed
                          ? 'Akun Anda belum tertaut ke profil karyawan. Masukkan kode aktivasi dari Owner atau HR.'
                          : err.toString(),
                      onRetry: () => ref.invalidate(sessionProfileProvider),
                    ),
                    if (isUnclaimed) ...[
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: () => _openClaimCodeDialog(context, ref),
                        icon: const Icon(Icons.key_outlined),
                        label: const Text('Masukkan Kode Aktivasi'),
                      ),
                    ],
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () async {
                        await performCleanSignOut(ref);
                        if (context.mounted) context.go('/login');
                      },
                      child: const Text('Kembali ke Login'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
      data: (profile) {
        if (profile == null) {
          return LoginScreen(
            onAuthenticated: () => context.go('/dashboard'),
          );
        }
        return FloatingNavShell(
          profile: profile,
          currentLocation: currentLocation,
          navigationShell: navigationShell,
          child: navigationShell,
        );
      },
    );
  }
}

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

class _ClaimCodeRecoveryDialog extends ConsumerStatefulWidget {
  const _ClaimCodeRecoveryDialog();

  @override
  ConsumerState<_ClaimCodeRecoveryDialog> createState() =>
      _ClaimCodeRecoveryDialogState();
}

class _ClaimCodeRecoveryDialogState
    extends ConsumerState<_ClaimCodeRecoveryDialog> {
  final _codeCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeCtrl.text.trim();
    if (code.length < 4) {
      setState(() => _error = 'Masukkan kode aktivasi yang valid.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).claimAccount(code);
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = err.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Tautkan Akun Karyawan'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Masukkan kode aktivasi satu kali (mis. EK-XXXX) yang diberikan Owner atau HR.',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _codeCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Kode Aktivasi',
              hintText: 'EK-XXXXXXXXXX',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontSize: 12,
              ),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: Text(_submitting ? 'Memproses...' : 'Aktifkan'),
        ),
      ],
    );
  }
}
