import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';
import 'printer_models.dart';
import 'printer_providers.dart';
import 'printer_repository.dart';

class PrinterJobDetailSheet extends ConsumerStatefulWidget {
  final String jobId;
  final ErpProfile profile;
  final List<PrintPricingRule> pricingRules;
  final List<PrintDevice> devices;
  final List<Map<String, dynamic>> financeAccounts;
  final VoidCallback onChanged;

  const PrinterJobDetailSheet({
    super.key,
    required this.jobId,
    required this.profile,
    required this.pricingRules,
    required this.devices,
    required this.financeAccounts,
    required this.onChanged,
  });

  @override
  ConsumerState<PrinterJobDetailSheet> createState() => _PrinterJobDetailSheetState();
}

class _PrinterJobDetailSheetState extends ConsumerState<PrinterJobDetailSheet> {
  bool _loading = true;
  bool _busy = false;
  String? _error;
  PrintJob? _job;
  String? _downloadUrl;

  String _paperSize = 'a4';
  String _colorMode = 'color';
  String _quality = 'normal';
  int _copies = 1;
  String _orientation = 'auto';
  String _fit = 'contain';
  bool _borderless = false;
  bool _duplex = false;
  final _pageRangeCtrl = TextEditingController();
  final _discountCtrl = TextEditingController(text: '0');
  final _rejectReasonCtrl = TextEditingController();

  bool _autoPostFinance = true;
  String? _selectedAccountId;
  String? _selectedDeviceId;

  @override
  void initState() {
    super.initState();
    if (widget.financeAccounts.isNotEmpty) {
      _selectedAccountId = widget.financeAccounts.first['id']?.toString();
    }
    if (widget.devices.isNotEmpty) {
      final online = widget.devices.where((d) => d.isOnline).toList();
      _selectedDeviceId = (online.isNotEmpty ? online.first : widget.devices.first).id;
    }
    _load();
  }

  @override
  void dispose() {
    _pageRangeCtrl.dispose();
    _discountCtrl.dispose();
    _rejectReasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await ref.read(printerRepositoryProvider).fetchJobDetail(widget.jobId);
      if (!mounted) return;
      final job = detail.job;
      setState(() {
        _job = job;
        _downloadUrl = detail.downloadUrl;
        _paperSize = job.paperSize;
        _colorMode = job.colorMode;
        _quality = job.quality;
        _copies = job.copies;
        _orientation = job.orientation;
        _fit = job.fit;
        _borderless = job.borderless;
        _duplex = job.duplex;
        _pageRangeCtrl.text = job.pageRange ?? '';
        _discountCtrl.text = job.discountAmount.toString();
        if (job.financeAccountId != null) {
          _selectedAccountId = job.financeAccountId;
        }
        if (job.deviceId != null) {
          _selectedDeviceId = job.deviceId;
        }
        _loading = false;
      });
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  PrintPricingRule? _findRule() {
    for (final rule in widget.pricingRules) {
      if (rule.paperSize == _paperSize && rule.colorMode == _colorMode) {
        return rule;
      }
    }
    return null;
  }

  ({int pages, String? error, BigInt unit, BigInt total}) _computePreview(PrintJob job) {
    var pages = job.detectedPageCount;
    String? pageError;
    try {
      pages = parsePageRangeCount(_pageRangeCtrl.text, job.detectedPageCount);
    } on FormatException catch (e) {
      pageError = e.message;
    }

    final rule = _findRule();
    final baseUnit = rule?.pricePerPage ?? job.unitPricePerPage;
    final duplexDisc = rule?.duplexDiscountPerPage ?? BigInt.zero;
    final discountDigits = _discountCtrl.text.replaceAll(RegExp(r'\D'), '');
    final discount = BigInt.tryParse(discountDigits) ?? BigInt.zero;

    final priced = calculatePrintPriceBigInt(
      pages: pages,
      copies: _copies,
      pricePerPage: baseUnit,
      duplex: _duplex,
      duplexDiscountPerPage: duplexDisc,
      discountAmount: discount,
    );
    return (
      pages: pages,
      error: pageError,
      unit: priced.unitPricePerPage,
      total: priced.totalPrice,
    );
  }

  Future<void> _saveOptions() async {
    final job = _job;
    if (job == null) return;
    setState(() => _busy = true);
    try {
      final discountDigits = _discountCtrl.text.replaceAll(RegExp(r'\D'), '');
      await ref.read(printerRepositoryProvider).updateOptions(job.id, {
        'paper_size': _paperSize,
        'color_mode': _colorMode,
        'quality': _quality,
        'copies': _copies,
        'orientation': _orientation,
        'fit': _fit,
        'borderless': _borderless,
        'duplex': _duplex,
        'page_range': _pageRangeCtrl.text.trim().isEmpty ? null : _pageRangeCtrl.text.trim(),
        'discount_amount': discountDigits.isEmpty ? '0' : discountDigits,
      });
      widget.onChanged();
      await _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approve() async {
    final job = _job;
    if (job == null) return;
    setState(() => _busy = true);
    try {
      final discountDigits = _discountCtrl.text.replaceAll(RegExp(r'\D'), '');
      await ref.read(printerRepositoryProvider).approveJob(job.id, {
        'paper_size': _paperSize,
        'color_mode': _colorMode,
        'quality': _quality,
        'copies': _copies,
        'orientation': _orientation,
        'fit': _fit,
        'borderless': _borderless,
        'duplex': _duplex,
        'page_range': _pageRangeCtrl.text.trim().isEmpty ? null : _pageRangeCtrl.text.trim(),
        'discount_amount': discountDigits.isEmpty ? '0' : discountDigits,
        if (_selectedDeviceId != null) 'device_id': _selectedDeviceId,
        'auto_post_finance': _autoPostFinance && _selectedAccountId != null,
        if (_autoPostFinance && _selectedAccountId != null)
          'finance_account_id': _selectedAccountId,
      });
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    final job = _job;
    final reason = _rejectReasonCtrl.text.trim();
    if (job == null || reason.length < 2) return;
    setState(() => _busy = true);
    try {
      await ref.read(printerRepositoryProvider).rejectJob(job.id, reason);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reprint() async {
    final job = _job;
    if (job == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(printerRepositoryProvider).reprintJob(job.id);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _postFinance() async {
    final job = _job;
    final accountId = _selectedAccountId;
    if (job == null || accountId == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(printerRepositoryProvider).postFinance(job.id, accountId);
      widget.onChanged();
      await _load();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    if (_loading) {
      return const ErpBottomSheetFrame(
        title: 'Detail Cetak',
        child: ShimmerScope(
          child: Column(
            children: [
              SkeletonBox(height: 120),
              SizedBox(height: 12),
              SkeletonBox(height: 64),
            ],
          ),
        ),
      );
    }

    if (_error != null || _job == null) {
      return ErpBottomSheetFrame(
        title: 'Detail Cetak',
        child: ErpErrorCard(
          message: _error ?? 'Data print job tidak tersedia.',
          onRetry: _load,
        ),
      );
    }

    final job = _job!;
    final isPending = job.status == 'pending_approval';
    final canApprove = widget.profile.hasPermission('printer', 'approve');
    final canUpdate = widget.profile.hasPermission('printer', 'update');
    final canFinancePost =
        widget.profile.hasPermission('finance', 'create') || canApprove;
    final calc = _computePreview(job);
    final isImage = job.fileMime.startsWith('image/');

    return ErpBottomSheetFrame(
      title: job.jobCode,
      subtitle: '${job.fileName} (${job.detectedPageCount} hal)',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (job.fileDeletedAt == null && _downloadUrl != null) ...[
            if (isImage)
              ClipRRect(
                borderRadius: BorderRadius.circular(t.radiusMd),
                child: LazyNetworkImage(
                  url: _downloadUrl!,
                  height: 200,
                  fit: BoxFit.contain,
                ),
              )
            else
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: t.canvas,
                  borderRadius: BorderRadius.circular(t.radiusMd),
                  border: Border.all(color: t.border),
                ),
                child: Row(
                  children: [
                    Icon(Icons.picture_as_pdf_outlined, color: t.accent),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            job.fileName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          Text(
                            '${job.detectedPageCount} halaman (${job.fileMime})',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: _downloadUrl!));
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Tautan dokumen disalin.')),
                          );
                        }
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Salin URL'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 14),
          ],
          if (job.customerNote != null && job.customerNote!.isNotEmpty) ...[
            Text('Catatan: ${job.customerNote!}', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 10),
          ],
          if (job.errorMessage != null && job.errorMessage!.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: t.dangerSoft,
                borderRadius: BorderRadius.circular(t.radiusMd),
              ),
              child: Text(
                job.errorMessage!,
                style: TextStyle(color: t.danger, fontSize: 12),
              ),
            ),
            const SizedBox(height: 10),
          ],
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _paperSize,
                  decoration: const InputDecoration(labelText: 'Kertas'),
                  items: const ['a4', 'f4', 'legal', 'letter', 'a5', '4x6', '5x7']
                      .map((s) => DropdownMenuItem(value: s, child: Text(s.toUpperCase())))
                      .toList(),
                  onChanged: isPending ? (v) => setState(() => _paperSize = v ?? 'a4') : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _colorMode,
                  decoration: const InputDecoration(labelText: 'Warna'),
                  items: const [
                    DropdownMenuItem(value: 'color', child: Text('Warna')),
                    DropdownMenuItem(value: 'mono', child: Text('Hitam Putih')),
                  ],
                  onChanged: isPending ? (v) => setState(() => _colorMode = v ?? 'color') : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _quality,
                  decoration: const InputDecoration(labelText: 'Kualitas'),
                  items: const ['draft', 'normal', 'high']
                      .map((q) => DropdownMenuItem(value: q, child: Text(q)))
                      .toList(),
                  onChanged: isPending ? (v) => setState(() => _quality = v ?? 'normal') : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Salinan'),
                    Row(
                      children: [
                        IconButton(
                          onPressed: isPending && _copies > 1
                              ? () => setState(() => _copies--)
                              : null,
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        Text('$_copies', style: const TextStyle(fontWeight: FontWeight.w700)),
                        IconButton(
                          onPressed: isPending && _copies < 99
                              ? () => setState(() => _copies++)
                              : null,
                          icon: const Icon(Icons.add_circle_outline),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: _pageRangeCtrl,
                  enabled: isPending,
                  decoration: InputDecoration(
                    labelText: 'Halaman (1-${job.detectedPageCount})',
                    hintText: 'Contoh: 1-3,5',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextFormField(
                  controller: _discountCtrl,
                  enabled: isPending,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Diskon (Rp)'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ],
          ),
          if (calc.error != null) ...[
            const SizedBox(height: 6),
            Text(calc.error!, style: TextStyle(color: t.danger, fontSize: 12)),
          ],
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Borderless (Tanpa Tepi)'),
            value: _borderless,
            onChanged: isPending ? (v) => setState(() => _borderless = v) : null,
          ),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Bolak-Balik (Duplex)'),
            value: _duplex,
            onChanged: isPending ? (v) => setState(() => _duplex = v) : null,
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: t.canvas,
              borderRadius: BorderRadius.circular(t.radiusMd),
              border: Border.all(color: t.border),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${calc.pages} hal x $_copies salinan'),
                Text(
                  formatRupiah((isPending ? calc.total : job.totalPrice).toString()),
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: t.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (isPending && canUpdate) ...[
            OutlinedButton(
              onPressed: _busy || calc.error != null ? null : _saveOptions,
              child: const Text('Simpan Opsi Cetak'),
            ),
            const SizedBox(height: 8),
          ],
          if (isPending && canApprove) ...[
            if (widget.financeAccounts.isNotEmpty) ...[
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Catat otomatis ke Keuangan saat selesai'),
                value: _autoPostFinance,
                onChanged: (v) => setState(() => _autoPostFinance = v),
              ),
              if (_autoPostFinance)
                DropdownButtonFormField<String>(
                  initialValue: _selectedAccountId,
                  decoration: const InputDecoration(labelText: 'Akun Kas Tujuan'),
                  items: widget.financeAccounts
                      .map(
                        (a) => DropdownMenuItem<String>(
                          value: a['id'].toString(),
                          child: Text('${a['name']} (${a['type']})'),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => setState(() => _selectedAccountId = v),
                ),
              const SizedBox(height: 10),
            ],
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                onPressed: _busy || calc.error != null ? null : _approve,
                icon: const Icon(Icons.print),
                label: Text(_busy ? 'Memproses...' : 'Setujui & Cetak Sekarang'),
              ),
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _rejectReasonCtrl,
              decoration: const InputDecoration(
                labelText: 'Alasan Penolakan (opsional untuk tolak)',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 46,
              child: OutlinedButton.icon(
                onPressed: _busy || _rejectReasonCtrl.text.trim().length < 2 ? null : _reject,
                icon: Icon(Icons.cancel_outlined, color: t.danger),
                label: Text('Tolak Pesanan', style: TextStyle(color: t.danger)),
              ),
            ),
          ],
          if ((job.status == 'printed' || job.status == 'failed') &&
              job.fileDeletedAt == null &&
              canApprove) ...[
            const SizedBox(height: 10),
            SizedBox(
              height: 46,
              child: OutlinedButton.icon(
                onPressed: _busy ? null : _reprint,
                icon: const Icon(Icons.refresh),
                label: const Text('Cetak Ulang'),
              ),
            ),
          ],
          if (job.status == 'printed' &&
              job.financeTransactionId == null &&
              canFinancePost &&
              widget.financeAccounts.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _selectedAccountId,
              decoration: const InputDecoration(labelText: 'Akun Kas'),
              items: widget.financeAccounts
                  .map(
                    (a) => DropdownMenuItem<String>(
                      value: a['id'].toString(),
                      child: Text('${a['name']} (${a['type']})'),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _selectedAccountId = v),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 46,
              child: FilledButton.icon(
                onPressed: _busy || _selectedAccountId == null ? null : _postFinance,
                icon: const Icon(Icons.account_balance_wallet_outlined),
                label: const Text('Catat Pendapatan ke Kas'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
