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
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  Timer? _moreTimer;
  String? _error;
  List<dynamic> _runs = const [];
  Map<String, dynamic>? _selectedDetail;
  List<dynamic> _accounts = const [];

  @override
  void initState() {
    super.initState();
    _unlockAndLoad();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    super.dispose();
  }

  void _scheduleLoadMore(int total) {
    if (_loadingMore || _visibleCount >= total) return;
    setState(() => _loadingMore = true);
    _moreTimer?.cancel();
    _moreTimer = Timer(const Duration(milliseconds: 220), () {
      if (!mounted) return;
      setState(() {
        _visibleCount += _batchSize;
        _loadingMore = false;
      });
    });
  }

  Future<void> _unlockAndLoad() async {
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
      Map<String, dynamic>? detail;
      if (runs.isNotEmpty) {
        final firstId = (runs.first as Map<String, dynamic>)['id'].toString();
        detail = await api.fetchPayrollRunDetail(firstId);
      }
      var accs = const <dynamic>[];
      if (widget.profile.hasPermission('finance', 'view')) {
        final fin = await api.fetchFinanceDashboard();
        accs = (fin['accounts'] as List<dynamic>?) ?? const [];
      }
      if (mounted) {
        setState(() {
          _runs = runs;
          _selectedDetail = detail;
          _accounts = accs;
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

  void _openPaySheet(String runId, String totalDisbursed) {
    if (_accounts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rekening kas tidak tersedia.')),
      );
      return;
    }
    var accId = (_accounts.first as Map<String, dynamic>)['id'].toString();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Bayar Payroll', style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text('Total dicairkan: ${formatRupiah(totalDisbursed)}'),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: accId,
                    decoration: const InputDecoration(labelText: 'Rekening Sumber Kas'),
                    items: [
                      for (final a in _accounts)
                        DropdownMenuItem(
                          value: (a as Map<String, dynamic>)['id'].toString(),
                          child: Text('${a['name']} (${formatRupiah(a['balance'])})'),
                        ),
                    ],
                    onChanged: (v) => setModalState(() => accId = v ?? accId),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      try {
                        await ref.read(apiClientProvider).payPayrollRun(runId, accId);
                        if (ctx.mounted) Navigator.of(ctx).pop();
                        await _load();
                      } catch (err) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text(err.toString())),
                          );
                        }
                      }
                    },
                    child: const Text('Cairkan & Posting Keuangan'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showSlipUrlDialog(String itemId) async {
    try {
      final url = await ref.read(apiClientProvider).fetchPayrollSlipUrl(itemId);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Tautan Slip Gaji PDF'),
          content: SelectableText(url),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: url));
                Navigator.of(ctx).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('URL Slip Gaji PDF disalin ke clipboard.')),
                );
              },
              child: const Text('Salin URL'),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Tutup'),
            ),
          ],
        ),
      );
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
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
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    '${formatShortDate(run['period_start']?.toString())} - ${formatShortDate(run['period_end']?.toString())}',
                                    style: Theme.of(context).textTheme.titleMedium,
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
                              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 22),
                            ),
                            if (widget.profile.hasPermission('payroll', 'approve')) ...[
                              const SizedBox(height: 12),
                              if (runStatus == 'draft')
                                FilledButton(
                                  onPressed: () async {
                                    await ref.read(apiClientProvider).approvePayrollRun(runId);
                                    await _load();
                                  },
                                  child: const Text('Setujui Payroll Draft'),
                                ),
                              if (runStatus == 'approved')
                                FilledButton(
                                  onPressed: () =>
                                      _openPaySheet(runId, (run['total_disbursed'] ?? '0').toString()),
                                  child: const Text('Bayar & Terbitkan Slip PDF'),
                                ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text('Rincian Slip Karyawan', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
              sliver: SliverList.builder(
                itemCount: shownCount + (hasMore ? 1 : 0),
                itemBuilder: (ctx, index) {
                  if (index >= shownCount) {
                    return const LazyListShimmerFooter(
                      label: 'Memuat slip karyawan berikutnya...',
                    );
                  }
                  final it = items[index] as Map<String, dynamic>;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Card(
                      child: ListTile(
                        title: Text('${it['full_name']} (${it['employee_code']})'),
                        subtitle: Text(
                          'Pokok ${formatRupiah(it['base_salary'])} | Lembur ${formatRupiah(it['overtime_pay'])}',
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              formatRupiah(it['net_salary']),
                              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 13),
                            ),
                            const SizedBox(height: 2),
                            Text('Ketuk lihat Slip', style: Theme.of(ctx).textTheme.bodySmall),
                          ],
                        ),
                        onTap: () => _showSlipUrlDialog(it['id'].toString()),
                      ),
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
