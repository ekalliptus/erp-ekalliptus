import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ekalliptus_erp_mobile/core/notifications/notification_models.dart';
import 'package:ekalliptus_erp_mobile/core/notifications/notification_registration.dart';
import 'package:ekalliptus_erp_mobile/core/offline/offline_queue_store.dart';
import 'package:ekalliptus_erp_mobile/core/providers/app_providers.dart';
import 'package:ekalliptus_erp_mobile/core/rbac/rbac_state.dart';
import 'package:ekalliptus_erp_mobile/core/theme/eucalyptus_theme.dart';
import 'package:ekalliptus_erp_mobile/core/utils/formatters.dart';
import 'package:ekalliptus_erp_mobile/features/auth/login_screen.dart';
import 'package:ekalliptus_erp_mobile/features/common/shimmer_skeleton.dart';
import 'package:ekalliptus_erp_mobile/features/common/theme_transition.dart';
import 'package:ekalliptus_erp_mobile/features/splash/splash_screen.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID', null);
  });

  group('Eucalyptus Precision design tokens & theme parity', () {
    test('light and dark token values match design-tokens.json', () {
      expect(EucalyptusTokens.light.canvas, const Color(0xFFF7F7F5));
      expect(EucalyptusTokens.light.accent, const Color(0xFF0F766E));
      expect(EucalyptusTokens.dark.canvas, const Color(0xFF0C0E0D));
      expect(EucalyptusTokens.dark.accent, const Color(0xFF10B981));

      final mono = AppTheme.monoNumeric(color: EucalyptusTokens.light.textPrimary);
      expect(mono.fontFeatures, contains(const FontFeature.tabularFigures()));
    });
  });

  group('RBAC permissions & role-aware Floating Navigation cap', () {
    ErpProfile makeProfile(String role, List<String> perms) {
      return ErpProfile(
        employeeId: 'emp-1',
        employeeCode: 'EMP-001',
        fullName: 'Owner Ekalliptus',
        email: 'alul@ekalliptus.com',
        roleCode: role,
        roleName: role.toUpperCase(),
        permissions: perms.toSet(),
        kpis: const ErpKpis(
          totalCashBalance: '15000000',
          lowStockAlerts: 2,
          pendingAttendanceApprovals: 1,
          draftPayrollRuns: 0,
        ),
      );
    }

    test('caps bottom navigation tabs at <= 4 across all roles', () {
      final allPerms = [
        'finance:view',
        'inventory:view',
        'attendance:view',
        'payroll:view',
        'rbac:view',
        'audit:view',
      ];
      for (final role in ['owner', 'finance', 'warehouse', 'hr', 'staff']) {
        final p = makeProfile(role, allPerms);
        final tabs = p.primaryBottomTabs();
        expect(tabs.length <= 4, isTrue);
        expect(tabs.first, ErpDestination.dashboard);
      }

      final staff = makeProfile('staff', ['attendance:view', 'attendance:create']);
      expect(staff.hasPermission('finance', 'view'), isFalse);
      expect(staff.hasPermission('attendance', 'create'), isTrue);
    });
  });

  group('Geofence math, IDR formatting & Drift offline queue service', () {
    test('calculates distance within and outside 250m geofence accurately', () {
      final inside = calculateDistanceMeters(
        lat1: -6.8694,
        lng1: 109.1402,
        lat2: -6.8698,
        lng2: 109.1405,
      );
      expect(inside < 250, isTrue);

      final outside = calculateDistanceMeters(
        lat1: -6.8694,
        lng1: 109.1402,
        lat2: -6.2088,
        lng2: 106.8456,
      );
      expect(outside > 100000, isTrue);
      expect(formatRupiah('1250000'), contains('1.250.000'));
    });

    test('OfflineSyncService flushes queued mutations when online', () async {
      final store = InMemoryOfflineQueueStore();
      var online = false;
      final sent = <String>[];

      final service = OfflineSyncService(
        store: store,
        sender: (method, endpoint, payload) async {
          if (!online) throw Exception('No network');
          sent.add('$method $endpoint');
        },
      );

      await service.enqueueMutation(
        endpoint: '/api/attendance/clock-in',
        method: 'POST',
        payload: {'office_id': 'off-1'},
      );

      final failRun = await service.flush();
      expect(failRun.syncedCount, 0);
      expect(failRun.remainingCount, 1);

      online = true;
      final okRun = await service.flush();
      expect(okRun.syncedCount, 1);
      expect(okRun.remainingCount, 0);
      expect(sent, ['POST /api/attendance/clock-in']);
    });
  });

  group('Widget tests in Light & Dark modes', () {
    testWidgets('LoginScreen renders cleanly in Light and Dark themes', (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: const LoginScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Masuk ke MyEkalliptus'), findsOneWidget);
        expect(find.textContaining('alul@ekalliptus.com'), findsWidgets);
        expect(find.byType(Image), findsWidgets);
      }
    });

    testWidgets('SplashScreen renders logo & branding cleanly in Light and Dark themes', (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        var resolved = false;
        await tester.pumpWidget(
          ProviderScope(
            key: ValueKey(brightness),
            overrides: [
              sessionProfileProvider.overrideWith((ref) async => null),
            ],
            child: MaterialApp(
              theme: AppTheme.build(brightness),
              home: SplashScreen(
                minDisplayDuration: const Duration(milliseconds: 50),
                onResolved: (_) => resolved = true,
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pump(const Duration(milliseconds: 50));
        expect(find.text('MyEkalliptus'), findsOneWidget);
        expect(find.text('ERP Command Center'), findsOneWidget);
        expect(find.byType(Image), findsOneWidget);
        expect(resolved, isTrue);
      }
    });

    testWidgets('DashboardSkeleton & FinanceSkeleton render shimmer cleanly in Light and Dark themes',
        (tester) async {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.build(brightness),
            home: const Scaffold(body: DashboardSkeleton()),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));
        expect(find.byType(DashboardSkeleton), findsOneWidget);

        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.build(brightness),
            home: const Scaffold(body: FinanceSkeleton()),
          ),
        );
        await tester.pump(const Duration(milliseconds: 250));
        expect(find.byType(FinanceSkeleton), findsOneWidget);
      }
    });

    testWidgets('ThemeRevealHost and AnimatedThemeToggleButton switch Light <-> Dark cleanly',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          child: Consumer(
            builder: (context, ref, _) {
              final mode = ref.watch(themeModeProvider);
              return MaterialApp(
                themeMode: mode == ThemeMode.system ? ThemeMode.light : mode,
                theme: AppTheme.build(Brightness.light),
                darkTheme: AppTheme.build(Brightness.dark),
                builder: (context, child) => ThemeRevealHost(child: child!),
                home: const Scaffold(
                  body: Center(child: AnimatedThemeToggleButton()),
                ),
              );
            },
          ),
        ),
      );
      await tester.pump();
      expect(find.byIcon(Icons.dark_mode_rounded), findsOneWidget);

      await tester.tap(find.byType(AnimatedThemeToggleButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byIcon(Icons.light_mode_rounded), findsOneWidget);

      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: ProviderScope(
            child: Consumer(
              builder: (context, ref, _) {
                final mode = ref.watch(themeModeProvider);
                return MaterialApp(
                  themeMode: mode == ThemeMode.system ? ThemeMode.light : mode,
                  theme: AppTheme.build(Brightness.light),
                  darkTheme: AppTheme.build(Brightness.dark),
                  builder: (context, child) => ThemeRevealHost(child: child!),
                  home: const Scaffold(
                    body: Center(child: AnimatedThemeToggleButton()),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.byType(AnimatedThemeToggleButton));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.light_mode_rounded), findsOneWidget);
    });
  });

  group('Notification registration & model', () {
    test('registerCurrentToken idempotent per token', () async {
      final calls = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => calls.add(t),
        onUnregister: (t) async {},
      );
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      await service.registerCurrentToken();
      expect(calls, hasLength(1));
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      expect(calls, hasLength(1));
    });

    test('token baru memicu registrasi ulang', () async {
      final calls = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => calls.add(t),
        onUnregister: (t) async {},
      );
      service.updateToken('a' * 40);
      await service.registerCurrentToken();
      service.updateToken('b' * 40);
      await service.registerCurrentToken();
      expect(calls, hasLength(2));
    });

    test('unregister mengirim token dan mengizinkan registrasi ulang', () async {
      final registered = <String>[];
      final unregistered = <String>[];
      final service = NotificationRegistrationService(
        onRegister: (t) async => registered.add(t),
        onUnregister: (t) async => unregistered.add(t),
      );
      service.updateToken('c' * 40);
      await service.registerCurrentToken();
      await service.unregister();
      expect(unregistered, ['c' * 40]);
      service.updateToken('c' * 40);
      await service.registerCurrentToken();
      expect(registered, hasLength(2));
    });

    test('NotificationEntry.fromJson memetakan field inti', () {
      final entry = NotificationEntry.fromJson({
        'id': 'n-1',
        'module': 'finance',
        'event_type': 'transaction_recorded',
        'title': 'Kas masuk dicatat',
        'body': 'Kas Kantor: Rp50.000',
        'created_at': '2026-11-21T03:00:00.000Z',
        'read_at': null,
        'entity_id': 'tx-1',
      });
      expect(entry.isUnread, isTrue);
      expect(entry.module, 'finance');
      expect(entry.entityId, 'tx-1');
      expect(entry.createdAt.year, 2026);
    });
  });
}
