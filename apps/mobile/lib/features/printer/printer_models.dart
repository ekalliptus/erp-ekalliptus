BigInt parseBigIntStrict(Object? raw, {BigInt? fallback}) {
  if (raw == null) return fallback ?? BigInt.zero;
  if (raw is BigInt) return raw;
  if (raw is int) return BigInt.from(raw);
  final text = raw.toString().trim();
  if (text.isEmpty) return fallback ?? BigInt.zero;
  return BigInt.tryParse(text) ?? (fallback ?? BigInt.zero);
}

class PrintInkMarker {
  final String name;
  final int? level;
  final String? color;

  const PrintInkMarker({
    required this.name,
    required this.level,
    this.color,
  });

  factory PrintInkMarker.fromJson(Map<String, dynamic> json) {
    final rawLevel = json['level'];
    return PrintInkMarker(
      name: (json['name'] ?? '').toString(),
      level: rawLevel is num ? rawLevel.toInt() : int.tryParse(rawLevel?.toString() ?? ''),
      color: json['color']?.toString(),
    );
  }
}

class PrintDevice {
  final String id;
  final String deviceName;
  final String? host;
  final String? mdnsHost;
  final String model;
  final bool isActive;
  final bool isOnline;
  final String? lastHeartbeatAt;
  final String printerState;
  final List<PrintInkMarker> inkLevels;
  final String openwaStatus;

  const PrintDevice({
    required this.id,
    required this.deviceName,
    this.host,
    this.mdnsHost,
    required this.model,
    required this.isActive,
    required this.isOnline,
    this.lastHeartbeatAt,
    required this.printerState,
    required this.inkLevels,
    required this.openwaStatus,
  });

  factory PrintDevice.fromJson(Map<String, dynamic> json) {
    final inksRaw = json['ink_levels'];
    final inks = <PrintInkMarker>[];
    if (inksRaw is List) {
      for (final item in inksRaw) {
        if (item is Map<String, dynamic>) {
          inks.add(PrintInkMarker.fromJson(item));
        } else if (item is Map) {
          inks.add(PrintInkMarker.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    return PrintDevice(
      id: (json['id'] ?? '').toString(),
      deviceName: (json['device_name'] ?? 'Print Bridge').toString(),
      host: json['host']?.toString(),
      mdnsHost: json['mdns_host']?.toString(),
      model: (json['model'] ?? 'HP Smart Tank 580-590 series').toString(),
      isActive: json['is_active'] == true,
      isOnline: json['is_online'] == true,
      lastHeartbeatAt: json['last_heartbeat_at']?.toString(),
      printerState: (json['printer_state'] ?? 'unknown').toString(),
      inkLevels: inks,
      openwaStatus: (json['openwa_status'] ?? 'disconnected').toString(),
    );
  }
}

class PrintPricingRule {
  final String id;
  final String paperSize;
  final String colorMode;
  final BigInt pricePerPage;
  final BigInt duplexDiscountPerPage;
  final bool isActive;

  const PrintPricingRule({
    required this.id,
    required this.paperSize,
    required this.colorMode,
    required this.pricePerPage,
    required this.duplexDiscountPerPage,
    required this.isActive,
  });

  factory PrintPricingRule.fromJson(Map<String, dynamic> json) {
    return PrintPricingRule(
      id: (json['id'] ?? '').toString(),
      paperSize: (json['paper_size'] ?? 'a4').toString(),
      colorMode: (json['color_mode'] ?? 'color').toString(),
      pricePerPage: parseBigIntStrict(json['price_per_page']),
      duplexDiscountPerPage: parseBigIntStrict(json['duplex_discount_per_page']),
      isActive: json['is_active'] != false,
    );
  }
}

class PrintJob {
  final String id;
  final String jobCode;
  final String source;
  final String? deviceId;
  final String? customerName;
  final String? customerPhone;
  final String? customerNote;
  final String fileName;
  final String fileMime;
  final BigInt fileSizeBytes;
  final String fileObjectKey;
  final int detectedPageCount;
  final String paperSize;
  final String colorMode;
  final String quality;
  final int copies;
  final String orientation;
  final String fit;
  final bool borderless;
  final bool duplex;
  final String? pageRange;
  final int pagesToPrint;
  final BigInt unitPricePerPage;
  final BigInt discountAmount;
  final BigInt totalPrice;
  final String status;
  final String? rejectReason;
  final String? errorMessage;
  final String? financeAccountId;
  final String? financeTransactionId;
  final String? printedAt;
  final String? fileDeletedAt;
  final String createdAt;

  const PrintJob({
    required this.id,
    required this.jobCode,
    required this.source,
    this.deviceId,
    this.customerName,
    this.customerPhone,
    this.customerNote,
    required this.fileName,
    required this.fileMime,
    required this.fileSizeBytes,
    required this.fileObjectKey,
    required this.detectedPageCount,
    required this.paperSize,
    required this.colorMode,
    required this.quality,
    required this.copies,
    required this.orientation,
    required this.fit,
    required this.borderless,
    required this.duplex,
    this.pageRange,
    required this.pagesToPrint,
    required this.unitPricePerPage,
    required this.discountAmount,
    required this.totalPrice,
    required this.status,
    this.rejectReason,
    this.errorMessage,
    this.financeAccountId,
    this.financeTransactionId,
    this.printedAt,
    this.fileDeletedAt,
    required this.createdAt,
  });

  factory PrintJob.fromJson(Map<String, dynamic> json) {
    return PrintJob(
      id: (json['id'] ?? '').toString(),
      jobCode: (json['job_code'] ?? '').toString(),
      source: (json['source'] ?? 'whatsapp').toString(),
      deviceId: json['device_id']?.toString(),
      customerName: json['customer_name']?.toString(),
      customerPhone: json['customer_phone']?.toString(),
      customerNote: json['customer_note']?.toString(),
      fileName: (json['file_name'] ?? 'document').toString(),
      fileMime: (json['file_mime'] ?? 'application/pdf').toString(),
      fileSizeBytes: parseBigIntStrict(json['file_size_bytes']),
      fileObjectKey: (json['file_object_key'] ?? '').toString(),
      detectedPageCount: (json['detected_page_count'] as num?)?.toInt() ?? 1,
      paperSize: (json['paper_size'] ?? 'a4').toString(),
      colorMode: (json['color_mode'] ?? 'color').toString(),
      quality: (json['quality'] ?? 'normal').toString(),
      copies: (json['copies'] as num?)?.toInt() ?? 1,
      orientation: (json['orientation'] ?? 'auto').toString(),
      fit: (json['fit'] ?? 'contain').toString(),
      borderless: json['borderless'] == true,
      duplex: json['duplex'] == true,
      pageRange: json['page_range']?.toString(),
      pagesToPrint: (json['pages_to_print'] as num?)?.toInt() ?? 1,
      unitPricePerPage: parseBigIntStrict(json['unit_price_per_page']),
      discountAmount: parseBigIntStrict(json['discount_amount']),
      totalPrice: parseBigIntStrict(json['total_price']),
      status: (json['status'] ?? 'pending_approval').toString(),
      rejectReason: json['reject_reason']?.toString(),
      errorMessage: json['error_message']?.toString(),
      financeAccountId: json['finance_account_id']?.toString(),
      financeTransactionId: json['finance_transaction_id']?.toString(),
      printedAt: json['printed_at']?.toString(),
      fileDeletedAt: json['file_deleted_at']?.toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}

class PrintJobsSummary {
  final int pendingApproval;
  final int queued;
  final int printing;
  final int printedToday;
  final BigInt revenueToday;

  const PrintJobsSummary({
    required this.pendingApproval,
    required this.queued,
    required this.printing,
    required this.printedToday,
    required this.revenueToday,
  });

  factory PrintJobsSummary.fromJson(Map<String, dynamic> json) {
    return PrintJobsSummary(
      pendingApproval: (json['pending_approval'] as num?)?.toInt() ?? 0,
      queued: (json['queued'] as num?)?.toInt() ?? 0,
      printing: (json['printing'] as num?)?.toInt() ?? 0,
      printedToday: (json['printed_today'] as num?)?.toInt() ?? 0,
      revenueToday: parseBigIntStrict(json['revenue_today']),
    );
  }
}

class PrintJobsBundle {
  final List<PrintDevice> devices;
  final List<PrintPricingRule> pricingRules;
  final List<PrintJob> jobs;
  final PrintJobsSummary summary;
  final List<Map<String, dynamic>> financeAccounts;

  const PrintJobsBundle({
    required this.devices,
    required this.pricingRules,
    required this.jobs,
    required this.summary,
    required this.financeAccounts,
  });
}
