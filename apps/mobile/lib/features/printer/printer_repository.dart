import 'dart:typed_data';
import '../../core/network/api_client.dart';
import 'printer_models.dart';

int parsePageRangeCount(String? pageRange, int detectedPageCount) {
  final maxPages = detectedPageCount < 1 ? 1 : detectedPageCount;
  final trimmed = (pageRange ?? '').trim();
  if (trimmed.isEmpty) return maxPages;

  final unique = <int>{};
  for (final rawPart in trimmed.split(',')) {
    final part = rawPart.trim();
    if (part.isEmpty) continue;
    final rangeMatch = RegExp(r'^(\d+)\s*-\s*(\d+)$').firstMatch(part);
    if (rangeMatch != null) {
      final start = int.parse(rangeMatch.group(1)!);
      final end = int.parse(rangeMatch.group(2)!);
      if (start < 1 || end < start) {
        throw FormatException('Rentang halaman "$part" tidak valid.');
      }
      if (end > maxPages) {
        throw FormatException('Halaman $end melebihi $maxPages halaman.');
      }
      for (var p = start; p <= end; p++) {
        unique.add(p);
      }
      continue;
    }

    if (RegExp(r'^\d+$').hasMatch(part)) {
      final page = int.parse(part);
      if (page < 1 || page > maxPages) {
        throw FormatException('Halaman $page di luar rentang 1-$maxPages.');
      }
      unique.add(page);
      continue;
    }

    throw FormatException('Format halaman "$part" tidak valid (contoh: 1-3,5).');
  }

  if (unique.isEmpty) {
    throw const FormatException('Pilih minimal 1 halaman.');
  }
  return unique.length;
}

({BigInt unitPricePerPage, BigInt totalPrice}) calculatePrintPriceBigInt({
  required int pages,
  required int copies,
  required BigInt pricePerPage,
  required bool duplex,
  required BigInt duplexDiscountPerPage,
  required BigInt discountAmount,
}) {
  final effectiveUnit = duplex
      ? (pricePerPage > duplexDiscountPerPage
          ? pricePerPage - duplexDiscountPerPage
          : BigInt.zero)
      : pricePerPage;
  final safePages = BigInt.from(pages < 1 ? 1 : pages);
  final safeCopies = BigInt.from(copies < 1 ? 1 : copies);
  final gross = effectiveUnit * safePages * safeCopies;
  final safeDiscount = discountAmount < BigInt.zero ? BigInt.zero : discountAmount;
  final total = gross > safeDiscount ? gross - safeDiscount : BigInt.zero;
  return (unitPricePerPage: effectiveUnit, totalPrice: total);
}

class PrinterRepository {
  final ApiClient _api;

  PrinterRepository(this._api);

  Future<PrintJobsBundle> fetchDashboard({
    String? status,
    String? query,
    bool includeFinanceAccounts = false,
  }) async {
    final devicesFuture = _api.fetchPrintDevices();
    final pricingFuture = _api.fetchPrintPricing();
    final jobsFuture = _api.fetchPrintJobs(status: status, query: query, limit: 60);
    final accountsFuture = includeFinanceAccounts
        ? _api.fetchFinanceAccounts().catchError((_) => <dynamic>[])
        : Future.value(<dynamic>[]);

    final devicesRes = await devicesFuture;
    final pricingRes = await pricingFuture;
    final jobsRes = await jobsFuture;
    final accountsRaw = await accountsFuture;

    final devices = (devicesRes['devices'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((m) => PrintDevice.fromJson(Map<String, dynamic>.from(m)))
        .toList();

    final rules = (pricingRes['pricing_rules'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((m) => PrintPricingRule.fromJson(Map<String, dynamic>.from(m)))
        .toList();

    final jobs = (jobsRes['jobs'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((m) => PrintJob.fromJson(Map<String, dynamic>.from(m)))
        .toList();

    final summaryRaw = jobsRes['summary'] is Map
        ? Map<String, dynamic>.from(jobsRes['summary'] as Map)
        : <String, dynamic>{};

    final accounts = accountsRaw
        .whereType<Map>()
        .map((m) => Map<String, dynamic>.from(m))
        .where((m) => m['is_active'] != false)
        .toList();

    return PrintJobsBundle(
      devices: devices,
      pricingRules: rules,
      jobs: jobs,
      summary: PrintJobsSummary.fromJson(summaryRaw),
      financeAccounts: accounts,
    );
  }

  Future<int> fetchPendingApprovalCount() async {
    try {
      final res = await _api.fetchPrintJobs(status: 'pending_approval', limit: 1);
      final summary = res['summary'];
      if (summary is Map && summary['pending_approval'] is num) {
        return (summary['pending_approval'] as num).toInt();
      }
      return 0;
    } catch (_) {
      return 0;
    }
  }

  Future<({PrintJob job, String? downloadUrl})> fetchJobDetail(String id) async {
    final res = await _api.fetchPrintJobDetail(id);
    final rawJob = Map<String, dynamic>.from(res['job'] as Map);
    return (
      job: PrintJob.fromJson(rawJob),
      downloadUrl: res['download_url']?.toString(),
    );
  }

  Future<PrintJob> createManualImageJob({
    required String filename,
    required String contentType,
    required Uint8List bytes,
    String? customerName,
    String paperSize = 'a4',
    String colorMode = 'color',
    int copies = 1,
    bool autoApprove = true,
  }) async {
    final objectKey = await _api.uploadObject(
      category: 'print-jobs',
      filename: filename,
      contentType: contentType,
      bytes: bytes,
    );
    final res = await _api.createManualPrintJob({
      'file_name': filename,
      'file_mime': contentType,
      'file_size_bytes': bytes.length,
      'file_object_key': objectKey,
      'detected_page_count': 1,
      if (customerName != null && customerName.trim().isNotEmpty)
        'customer_name': customerName.trim(),
      'paper_size': paperSize,
      'color_mode': colorMode,
      'copies': copies,
      'auto_approve': autoApprove,
      'source': 'manual_mobile',
    });
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }

  Future<PrintJob> updateOptions(String id, Map<String, dynamic> body) async {
    final res = await _api.updatePrintJobOptions(id, body);
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }

  Future<PrintJob> approveJob(String id, Map<String, dynamic> body) async {
    final res = await _api.approvePrintJob(id, body);
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }

  Future<PrintJob> rejectJob(String id, String reason) async {
    final res = await _api.rejectPrintJob(id, reason);
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }

  Future<PrintJob> reprintJob(String id) async {
    final res = await _api.reprintPrintJob(id);
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }

  Future<PrintJob> postFinance(String id, String financeAccountId) async {
    final res = await _api.postPrintJobFinance(id, financeAccountId);
    return PrintJob.fromJson(Map<String, dynamic>.from(res['job'] as Map));
  }
}
