import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/app_providers.dart';
import 'printer_models.dart';
import 'printer_repository.dart';

final printerRepositoryProvider = Provider<PrinterRepository>((ref) {
  return PrinterRepository(ref.watch(apiClientProvider));
});

final printerStatusFilterProvider = StateProvider<String>((ref) => 'all');
final printerSearchQueryProvider = StateProvider<String>((ref) => '');

final printerDashboardProvider =
    FutureProvider.autoDispose.family<PrintJobsBundle, bool>((ref, canViewFinance) async {
  final status = ref.watch(printerStatusFilterProvider);
  final query = ref.watch(printerSearchQueryProvider);
  final repo = ref.watch(printerRepositoryProvider);
  return repo.fetchDashboard(
    status: status,
    query: query,
    includeFinanceAccounts: canViewFinance,
  );
});

final pendingPrintApprovalCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final repo = ref.watch(printerRepositoryProvider);
  return repo.fetchPendingApprovalCount();
});
