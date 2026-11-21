import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

class FinanceScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const FinanceScreen({super.key, required this.profile});

  @override
  ConsumerState<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends ConsumerState<FinanceScreen> {
  static const int _batchSize = 15;

  bool _unlocked = false;
  bool _loading = true;
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  Timer? _moreTimer;
  String? _error;
  Map<String, dynamic>? _data;

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
        .verifySensitiveAccess(reason: 'Buka modul Keuangan MyEkalliptus');
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _unlocked = false;
        _loading = false;
        _error = 'Verifikasi biometrik diperlukan untuk membuka data keuangan.';
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
      final res = await ref.read(apiClientProvider).fetchFinanceDashboard();
      if (mounted) {
        setState(() {
          _data = res;
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

  void _openCreateTxSheet() {
    final accounts = (_data?['accounts'] as List<dynamic>?) ?? const [];
    if (accounts.isEmpty) return;
    final t = EucalyptusTokens.of(context);
    final amountCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    var txType = 'expense';
    var accId = (accounts.first as Map<String, dynamic>)['id'].toString();
    String? receiptKey;
    var uploading = false;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(
                20,
                20,
                20,
                20 + MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Catat Transaksi', style: Theme.of(ctx).textTheme.titleLarge),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: txType,
                      decoration: const InputDecoration(labelText: 'Jenis'),
                      items: const [
                        DropdownMenuItem(value: 'expense', child: Text('Pengeluaran Kas')),
                        DropdownMenuItem(value: 'income', child: Text('Pemasukan Kas')),
                      ],
                      onChanged: (v) => setModalState(() => txType = v ?? 'expense'),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: accId,
                      decoration: const InputDecoration(labelText: 'Rekening'),
                      items: [
                        for (final a in accounts)
                          DropdownMenuItem(
                            value: (a as Map<String, dynamic>)['id'].toString(),
                            child: Text('${a['name']} (${formatRupiah(a['balance'])})'),
                          ),
                      ],
                      onChanged: (v) => setModalState(() => accId = v ?? accId),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: amountCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Nominal (IDR)'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descCtrl,
                      decoration: const InputDecoration(labelText: 'Deskripsi'),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: uploading
                          ? null
                          : () async {
                              final picker = ImagePicker();
                              final photo = await picker.pickImage(source: ImageSource.camera);
                              if (photo == null) return;
                              setModalState(() => uploading = true);
                              try {
                                final bytes = await photo.readAsBytes();
                                final key = await ref.read(apiClientProvider).uploadObject(
                                      category: 'receipt',
                                      filename: photo.name,
                                      contentType: 'image/jpeg',
                                      bytes: bytes,
                                    );
                                setModalState(() => receiptKey = key);
                              } catch (err) {
                                if (ctx.mounted) {
                                  ScaffoldMessenger.of(ctx).showSnackBar(
                                    SnackBar(content: Text('Upload gagal: $err')),
                                  );
                                }
                              } finally {
                                setModalState(() => uploading = false);
                              }
                            },
                      icon: const Icon(Icons.camera_alt_outlined),
                      label: Text(
                        uploading
                            ? 'Mengunggah struk...'
                            : receiptKey != null
                                ? 'Struk terunggah ($receiptKey)'
                                : 'Foto Struk Transaksi',
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: t.accent),
                      onPressed: () async {
                        final messenger = ScaffoldMessenger.of(context);
                        final amount = int.tryParse(amountCtrl.text.trim()) ?? 0;
                        if (amount <= 0 || descCtrl.text.trim().isEmpty) return;
                        final payload = {
                          'account_id': accId,
                          'type': txType,
                          'amount': amount,
                          'description': descCtrl.text.trim(),
                          'receipt_object_key': receiptKey,
                          'status': 'posted',
                        };
                        try {
                          await ref.read(apiClientProvider).createTransaction(payload);
                          if (ctx.mounted) Navigator.of(ctx).pop();
                          await _load();
                        } catch (_) {
                          await ref.read(offlineSyncServiceProvider).enqueueMutation(
                                endpoint: '/api/finance/transactions',
                                method: 'POST',
                                payload: payload,
                              );
                          ref.invalidate(pendingOfflineCountProvider);
                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                            messenger.showSnackBar(
                              const SnackBar(
                                content: Text('Offline: transaksi masuk ke antrean sinkronisasi Drift.'),
                              ),
                            );
                          }
                        }
                      },
                      child: const Text('Simpan Transaksi'),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    if (!widget.profile.hasPermission('finance', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Keuangan Ditolak',
          description: 'Role Anda tidak memiliki izin finance:view.',
        ),
      );
    }

    if (!_unlocked && _error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _unlockAndLoad),
      );
    }

    if (_loading) {
      return const FinanceSkeleton();
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    final summary = (_data?['summary'] as Map<String, dynamic>?) ?? const {};
    final accounts = (_data?['accounts'] as List<dynamic>?) ?? const [];
    final transactions = (_data?['transactions'] as List<dynamic>?) ?? const [];
    final shownCount = transactions.length < _visibleCount ? transactions.length : _visibleCount;
    final hasMore = shownCount < transactions.length;

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(transactions.length);
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
                            Text('Saldo Kas Konsolidasi', style: Theme.of(context).textTheme.bodySmall),
                            const SizedBox(height: 4),
                            Text(
                              formatRupiah(summary['total_balance']),
                              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 24),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Masuk: ${formatRupiah(summary['total_income'])}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                                Text(
                                  'Keluar: ${formatRupiah(summary['total_expense'])}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                            if (widget.profile.hasPermission('finance', 'create')) ...[
                              const SizedBox(height: 14),
                              FilledButton.icon(
                                onPressed: accounts.isEmpty ? null : _openCreateTxSheet,
                                icon: const Icon(Icons.add),
                                label: const Text('Catat Transaksi + Struk'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 92,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: accounts.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (ctx, i) {
                          final acc = accounts[i] as Map<String, dynamic>;
                          return SizedBox(
                            width: 195,
                            child: Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      (acc['name'] ?? '').toString(),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.titleMedium,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      formatRupiah(acc['balance']),
                                      style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 15),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Riwayat Transaksi (Geser kanan approve / kiri void)',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            if (transactions.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Belum ada transaksi tercatat',
                    description: 'Gunakan tombol Catat Transaksi untuk mencatat pemasukan atau biaya.',
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverList.builder(
                  itemCount: shownCount + (hasMore ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownCount) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat transaksi berikutnya...',
                      );
                    }
                    final tx = transactions[index] as Map<String, dynamic>;
                    final status = (tx['status'] ?? '').toString();
                    final canSwipe = widget.profile.hasPermission('finance', 'approve') &&
                        status != 'void';
                    final card = Card(
                      child: ListTile(
                        title: Text((tx['description'] ?? '').toString(), maxLines: 1),
                        subtitle: Text(
                          '${tx['account_name'] ?? '-'} • ${formatShortDateTime(tx['transacted_at']?.toString())}',
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              formatRupiah(tx['amount']),
                              style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 13),
                            ),
                            const SizedBox(height: 4),
                            ErpBadge(
                              label: status.toUpperCase(),
                              tone: status == 'posted'
                                  ? ErpBadgeTone.accent
                                  : status == 'pending'
                                      ? ErpBadgeTone.warning
                                      : ErpBadgeTone.neutral,
                            ),
                          ],
                        ),
                      ),
                    );

                    if (!canSwipe) {
                      return Padding(padding: const EdgeInsets.only(bottom: 8), child: card);
                    }

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Dismissible(
                        key: ValueKey(tx['id'].toString()),
                        background: Container(
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.only(left: 20),
                          decoration: BoxDecoration(
                            color: t.successSoft,
                            borderRadius: BorderRadius.circular(t.radiusLg),
                          ),
                          child: Text(
                            'SETUJUI',
                            style: TextStyle(color: t.success, fontWeight: FontWeight.bold),
                          ),
                        ),
                        secondaryBackground: Container(
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.only(right: 20),
                          decoration: BoxDecoration(
                            color: t.dangerSoft,
                            borderRadius: BorderRadius.circular(t.radiusLg),
                          ),
                          child: Text(
                            'VOID',
                            style: TextStyle(color: t.danger, fontWeight: FontWeight.bold),
                          ),
                        ),
                        confirmDismiss: (direction) async {
                          HapticFeedback.mediumImpact();
                          final messenger = ScaffoldMessenger.of(context);
                          final id = tx['id'].toString();
                          try {
                            if (direction == DismissDirection.startToEnd && status == 'pending') {
                              await ref.read(apiClientProvider).approveTransaction(id);
                              await _load();
                            } else if (direction == DismissDirection.endToStart && status != 'void') {
                              await ref.read(apiClientProvider).voidTransaction(id);
                              await _load();
                            }
                          } catch (err) {
                            if (mounted) {
                              messenger.showSnackBar(
                                SnackBar(content: Text(err.toString())),
                              );
                            }
                          }
                          return false;
                        },
                        child: card,
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
