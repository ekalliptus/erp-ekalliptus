import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

class PayrollScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const PayrollScreen({super.key, required this.profile});

  @override
  ConsumerState<PayrollScreen> createState() => _PayrollScreenState();
}

class _PayrollScreenState extends ConsumerState<PayrollScreen> {
  static const int _batchSize = 15;

  bool _unlocked = false;
  bool _loading = true;
  bool _switchingRun = false;
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  int _observedVersion = 0;
  Timer? _moreTimer;
  String? _error;
  String? _selectedRunId;
  List<dynamic> _runs = const [];
  Map<String, dynamic>? _selectedDetail;
  List<dynamic> _accounts = const [];

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    _unlockAndLoad();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    super.dispose();
  }

  void _emitMutationSuccess() {
    final next = ref.read(erpDataVersionProvider) + 1;
    _observedVersion = next;
    ref.read(erpDataVersionProvider.notifier).state = next;
    ref.invalidate(sessionProfileProvider);
  }

  Future<void> _unlockAndLoad() async {
    if (isSensitiveSessionUnlocked(ref)) {
      setState(() => _unlocked = true);
      await _load();
      return;
    }

    final ok = await ref
        .read(biometricGuardProvider)
        .verifySensitiveAccess(reason: 'Buka modul Payroll MyEkalliptus');
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _unlocked = false;
        _loading = false;
        _error = 'Verifikasi biometrik diperlukan untuk melihat rincian gaji.';
      });
      return;
    }
    markSensitiveSessionUnlocked(ref);
    setState(() => _unlocked = true);
    await _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final runs = await api.fetchPayrollRuns();

      String? targetId = _selectedRunId;
      final exists = targetId != null &&
          runs.any((r) => (r as Map<String, dynamic>)['id'].toString() == targetId);
      if (!exists) {
        targetId = runs.isNotEmpty ? (runs.first as Map<String, dynamic>)['id'].toString() : null;
      }

      Map<String, dynamic>? detail;
      if (targetId != null) {
        detail = await api.fetchPayrollRunDetail(targetId);
      }

      List<dynamic> accounts = const [];
      if (widget.profile.hasPermission('payroll', 'approve') &&
          widget.profile.hasPermission('finance', 'view')) {
        try {
          accounts = await api.fetchFinanceAccounts();
        } catch (_) {
          accounts = const [];
        }
      }

      if (mounted) {
        setState(() {
          _runs = runs;
          _selectedRunId = targetId;
          _selectedDetail = detail;
          _accounts = accounts;
          _visibleCount = _batchSize;
          _loading = false;
        });
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _selectRun(String runId) async {
    if (runId == _selectedRunId || _switchingRun) return;
    setState(() {
      _selectedRunId = runId;
      _switchingRun = true;
    });
    try {
      final detail = await ref.read(apiClientProvider).fetchPayrollRunDetail(runId);
      if (mounted) {
        setState(() {
          _selectedDetail = detail;
          _visibleCount = _batchSize;
          _switchingRun = false;
        });
      }
    } catch (err) {
      if (mounted) {
        setState(() => _switchingRun = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  void _scheduleLoadMore(int totalLength) {
    if (_loadingMore || _visibleCount >= totalLength) return;
    _loadingMore = true;
    _moreTimer?.cancel();
    _moreTimer = Timer(const Duration(milliseconds: 220), () {
      if (!mounted) return;
      setState(() {
        _visibleCount = (_visibleCount + _batchSize).clamp(0, totalLength);
        _loadingMore = false;
      });
    });
  }

  Future<void> _approveDraft(Map<String, dynamic> run) async {
    final runId = run['id'].toString();
    final period =
        '${formatShortDate(run['period_start']?.toString())} - ${formatShortDate(run['period_end']?.toString())}';
    final ok = await showErpConfirmDialog(
      context,
      title: 'Setujui Payroll Draft?',
      message:
          'Periode $period senilai ${formatRupiah(run['total_disbursed'])} akan disetujui agar siap dibayarkan.',
      confirmLabel: 'Setujui Draft',
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiClientProvider).approvePayrollRun(runId);
      _emitMutationSuccess();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payroll draft berhasil disetujui.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _openPaySheet(Map<String, dynamic> run) async {
    if (_accounts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rekening kas belum tersedia atau izin finance:view diperlukan.')),
      );
      return;
    }

    final paid = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _PayPayrollSheet(
        run: run,
        accounts: _accounts,
      ),
    );

    if (paid == true && mounted) {
      _emitMutationSuccess();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payroll dibayarkan & slip PDF diterbitkan.')),
        );
      }
    }
  }

  Future<void> _showSlipUrlDialog(Map<String, dynamic> item) async {
    try {
      final url = await ref.read(apiClientProvider).fetchPayrollSlipUrl(item['id'].toString());
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        useRootNavigator: true,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (ctx) {
          final t = EucalyptusTokens.of(ctx);
          return ErpBottomSheetFrame(
            title: '${item['full_name']} (${item['employee_code']})',
            subtitle: 'Tautan unduh resmi slip gaji PDF MyEkalliptus',
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: t.surfaceSubtle,
                    borderRadius: BorderRadius.circular(t.radiusMd),
                    border: Border.all(color: t.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Gaji Bersih', style: Theme.of(ctx).textTheme.bodySmall),
                      const SizedBox(height: 4),
                      Text(
                        formatRupiah(item['net_salary']),
                        style: AppTheme.monoNumeric(
                          color: t.textPrimary,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      SelectableText(
                        url,
                        style: Theme.of(ctx).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(ctx).pop(),
                        child: const Text('Tutup'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: url));
                          Navigator.of(ctx).pop();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Tautan slip PDF disalin ke clipboard.')),
                          );
                        },
                        icon: const Icon(Icons.copy, size: 18),
                        label: const Text('Salin Tautan'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      );
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(erpDataVersionProvider, (prev, next) {
      if (next != _observedVersion && mounted && _unlocked) {
        _observedVersion = next;
        _load();
      }
    });

    final t = EucalyptusTokens.of(context);
    if (!widget.profile.hasPermission('payroll', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Payroll Ditolak',
          description: 'Role Anda tidak memiliki izin payroll:view.',
        ),
      );
    }
    if (!_unlocked && _error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _unlockAndLoad),
      );
    }
    if (_loading) return const PayrollSkeleton();
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    if (_runs.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Belum ada periode payroll',
          description: 'Buat periode penggajian di Web Command Center lalu tinjau slip di sini.',
          actionLabel: 'Muat Ulang',
          onAction: _load,
        ),
      );
    }

    final run = (_selectedDetail?['run'] as Map<String, dynamic>?) ??
        (_runs.first as Map<String, dynamic>);
    final items = (_selectedDetail?['items'] as List<dynamic>?) ?? const [];
    final runStatus = (run['status'] ?? 'draft').toString();
    final runId = run['id'].toString();
    final shownCount = items.length < _visibleCount ? items.length : _visibleCount;
    final hasMore = shownCount < items.length;
    final canApprove = widget.profile.hasPermission('payroll', 'approve');

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(items.length);
        }
        return false;
      },
      child: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ErpFilterPillBar<String>(
                      selected: runId,
                      onSelected: _selectRun,
                      options: [
                        for (final rawRun in _runs)
                          ErpFilterPillOption(
                            value: (rawRun as Map<String, dynamic>)['id'].toString(),
                            label:
                                '${formatShortDate(rawRun['period_start']?.toString())} - ${formatShortDate(rawRun['period_end']?.toString())}',
                          ),
                      ],
                    ),
                    if (_switchingRun) ...[
                      const SizedBox(height: 8),
                      const LinearProgressIndicator(minHeight: 2),
                    ],
                    const SizedBox(height: 12),

                    ErpHeroCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  '${formatShortDate(run['period_start']?.toString())} - ${formatShortDate(run['period_end']?.toString())}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFFCCFBF1),
                                  ),
                                ),
                              ),
                              ErpBadge(
                                label: runStatus.toUpperCase(),
                                tone: runStatus == 'paid'
                                    ? ErpBadgeTone.success
                                    : runStatus == 'approved'
                                        ? ErpBadgeTone.info
                                        : ErpBadgeTone.warning,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            formatRupiah(run['total_disbursed']),
                            style: AppTheme.monoNumeric(
                              color: Colors.white,
                              fontSize: 28,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${items.length} slip karyawan pada periode terpilih',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFFCCFBF1),
                            ),
                          ),
                          if (canApprove && (runStatus == 'draft' || runStatus == 'approved')) ...[
                            const SizedBox(height: 14),
                            if (runStatus == 'draft')
                              FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: const Color(0xFF064E3B),
                                ),
                                onPressed: () => _approveDraft(run),
                                icon: const Icon(Icons.verified_outlined, size: 18),
                                label: const Text('Setujui Payroll Draft'),
                              ),
                            if (runStatus == 'approved')
                              FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: const Color(0xFF064E3B),
                                ),
                                onPressed: () => _openPaySheet(run),
                                icon: const Icon(Icons.payments_outlined, size: 18),
                                label: const Text('Bayar & Terbitkan Slip PDF'),
                              ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Rincian Slip Karyawan (${items.length})',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            if (items.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Belum ada rincian slip',
                    description: 'Periode ini belum memiliki item gaji yang dapat Anda lihat.',
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverList.builder(
                  itemCount: shownCount + (hasMore ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownCount) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat slip karyawan berikutnya...',
                      );
                    }
                    final it = items[index] as Map<String, dynamic>;
                    final hasPdf = it['slip_pdf_object_key'] != null;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: Icons.receipt_long_outlined,
                        leadingColor: hasPdf ? t.success : t.accent,
                        leadingBackground: hasPdf ? t.successSoft : t.accentSoft,
                        title: '${it['full_name']} (${it['employee_code']})',
                        subtitle:
                            'Pokok ${formatRupiah(it['base_salary'])} · Lembur ${formatRupiah(it['overtime_pay'])}',
                        trailing: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              formatRupiah(it['net_salary']),
                              style: AppTheme.monoNumeric(
                                color: t.textPrimary,
                                fontSize: 13.5,
                              ),
                            ),
                            const SizedBox(height: 4),
                            ErpBadge(
                              label: hasPdf ? 'Slip PDF' : 'Tautan Slip',
                              tone: hasPdf ? ErpBadgeTone.success : ErpBadgeTone.accent,
                            ),
                          ],
                        ),
                        onTap: () => _showSlipUrlDialog(it),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PayPayrollSheet extends ConsumerStatefulWidget {
  final Map<String, dynamic> run;
  final List<dynamic> accounts;

  const _PayPayrollSheet({
    required this.run,
    required this.accounts,
  });

  @override
  ConsumerState<_PayPayrollSheet> createState() => _PayPayrollSheetState();
}

class _PayPayrollSheetState extends ConsumerState<_PayPayrollSheet> {
  late String _accId;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _accId = (widget.accounts.first as Map<String, dynamic>)['id'].toString();
  }

  Future<void> _submit() async {
    final total = formatRupiah(widget.run['total_disbursed']);
    final ok = await showErpConfirmDialog(
      context,
      title: 'Konfirmasi Pencairan Payroll?',
      message:
          'Total $total akan didebit dari rekening terpilih dan seluruh slip gaji PDF diterbitkan.',
      confirmLabel: 'Bayar Sekarang',
    );
    if (!ok || !mounted) return;

    setState(() => _submitting = true);
    try {
      await ref
          .read(apiClientProvider)
          .payPayrollRun(widget.run['id'].toString(), _accId);
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ErpBottomSheetFrame(
      title: 'Bayar & Terbitkan Slip Payroll',
      subtitle:
          'Periode ${formatShortDate(widget.run['period_start']?.toString())} - ${formatShortDate(widget.run['period_end']?.toString())}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Total Disbursed: ${formatRupiah(widget.run['total_disbursed'])}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _accId,
            decoration: const InputDecoration(labelText: 'Rekening Pembayaran'),
            items: [
              for (final a in widget.accounts)
                DropdownMenuItem(
                  value: (a as Map<String, dynamic>)['id'].toString(),
                  child: Text(
                    '${a['name']} (${formatRupiah(a['balance'])})',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _accId = v);
            },
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'Memproses Pembayaran...' : 'Konfirmasi Bayar Payroll'),
          ),
        ],
      ),
    );
  }
}
