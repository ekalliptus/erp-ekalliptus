import 'package:ekalliptus_erp_mobile/core/auth/auth_service.dart';
import 'package:ekalliptus_erp_mobile/core/network/api_client.dart';
import 'package:ekalliptus_erp_mobile/core/providers/app_providers.dart';
import 'package:ekalliptus_erp_mobile/core/rbac/rbac_state.dart';
import 'package:ekalliptus_erp_mobile/core/theme/eucalyptus_theme.dart';
import 'package:ekalliptus_erp_mobile/features/printer/printer_models.dart';
import 'package:ekalliptus_erp_mobile/features/printer/printer_repository.dart';
import 'package:ekalliptus_erp_mobile/features/printer/printer_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

class _FakePrinterApiClient extends ApiClient {
  _FakePrinterApiClient() : super(auth: AuthService());

  @override
  Future<Map<String, dynamic>> fetchPrintDevices() async {
    return {
      'devices': [
        {
          'id': 'dev-1',
          'device_name': 'HP Smart Tank 583 Toko',
          'host': '192.168.0.5',
          'model': 'HP Smart Tank 580-590 series',
          'is_active': true,
          'is_online': true,
          'printer_state': 'idle',
          'openwa_status': 'connected',
          'ink_levels': [
            {'name': 'Cyan', 'level': 88, 'color': '#00FFFF'},
            {'name': 'Black', 'level': 92, 'color': '#000000'},
          ],
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> fetchPrintPricing() async {
    return {
      'pricing_rules': [
        {
          'id': 'rule-1',
          'paper_size': 'a4',
          'color_mode': 'color',
          'price_per_page': '1500',
          'duplex_discount_per_page': '0',
          'is_active': true,
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> fetchPrintJobs({
    String? status,
    String? query,
    int limit = 60,
  }) async {
    return {
      'jobs': [
        {
          'id': 'job-1',
          'job_code': 'PRT-20261125-ABC123',
          'source': 'whatsapp',
          'customer_name': 'Budi Santoso',
          'customer_phone': '6281999900306',
          'file_name': 'skripsi-bab1.pdf',
          'file_mime': 'application/pdf',
          'file_size_bytes': '102400',
          'file_object_key': 'print-jobs/2026/11/skripsi-bab1.pdf',
          'detected_page_count': 4,
          'paper_size': 'a4',
          'color_mode': 'color',
          'quality': 'normal',
          'copies': 1,
          'orientation': 'auto',
          'fit': 'contain',
          'borderless': false,
          'duplex': false,
          'pages_to_print': 4,
          'unit_price_per_page': '1500',
          'discount_amount': '0',
          'total_price': '6000',
          'status': 'pending_approval',
          'created_at': '2026-11-25T10:00:00.000Z',
        },
      ],
      'summary': {
        'pending_approval': 1,
        'queued': 0,
        'printing': 0,
        'printed_today': 2,
        'revenue_today': '18000',
      },
    };
  }

  @override
  Future<List<dynamic>> fetchFinanceAccounts() async {
    return [
      {'id': 'acc-1', 'name': 'Kas Operasional', 'type': 'cash', 'is_active': true},
    ];
  }
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID', null);
  });

  test('Smart Printer BIGINT parsing & page range calculation', () {
    expect(parseBigIntStrict('9007199254740993'), BigInt.parse('9007199254740993'));
    expect(parsePageRangeCount(null, 5), 5);
    expect(parsePageRangeCount('1-3,5', 10), 4);
    expect(() => parsePageRangeCount('6-7', 5), throwsFormatException);

    final calc = calculatePrintPriceBigInt(
      pages: 4,
      copies: 2,
      pricePerPage: BigInt.from(1500),
      duplex: true,
      duplexDiscountPerPage: BigInt.from(250),
      discountAmount: BigInt.from(500),
    );
    expect(calc.unitPricePerPage, BigInt.from(1250));
    expect(calc.totalPrice, BigInt.from(9500));
  });

  testWidgets('PrinterScreen renders bridge status, ink levels, and job queue', (tester) async {
    const profile = ErpProfile(
      employeeId: 'emp-1',
      employeeCode: 'EK-001',
      fullName: 'Alul Owner',
      email: 'alul@ekalliptus.com',
      username: 'alul',
      roleCode: 'owner',
      roleName: 'Owner',
      permissions: {'printer:view', 'printer:create', 'printer:approve', 'finance:view'},
      kpis: ErpKpis(
        totalCashBalance: '0',
        lowStockAlerts: 0,
        pendingAttendanceApprovals: 0,
        draftPayrollRuns: 0,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_FakePrinterApiClient()),
        ],
        child: MaterialApp(
          theme: AppTheme.build(Brightness.light),
          home: const PrinterScreen(profile: profile),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('HP Smart Tank 583 Toko'), findsOneWidget);
    expect(find.text('Online'), findsOneWidget);
    expect(find.text('PRT-20261125-ABC123 - skripsi-bab1.pdf'), findsOneWidget);
    expect(find.textContaining('Cyan: 88%'), findsOneWidget);
  });
}
