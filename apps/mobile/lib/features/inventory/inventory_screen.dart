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

class InventoryScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const InventoryScreen({super.key, required this.profile});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  static const int _batchSize = 15;

  bool _loading = true;
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  Timer? _moreTimer;
  String? _error;
  Map<String, dynamic>? _data;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).fetchInventoryData();
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

  void _openMovementSheet({String? preselectedItemId}) {
    final items = (_data?['items'] as List<dynamic>?) ?? const [];
    final warehouses = (_data?['warehouses'] as List<dynamic>?) ?? const [];
    if (items.isEmpty || warehouses.isEmpty) return;

    var itemId = preselectedItemId ?? (items.first as Map<String, dynamic>)['id'].toString();
    var whId = (warehouses.first as Map<String, dynamic>)['id'].toString();
    var mvType = 'in';
    final qtyCtrl = TextEditingController(text: '1');
    final noteCtrl = TextEditingController();

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
                    Text('Mutasi Stok Gudang', style: Theme.of(ctx).textTheme.titleLarge),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: mvType,
                      decoration: const InputDecoration(labelText: 'Tipe Mutasi'),
                      items: const [
                        DropdownMenuItem(value: 'in', child: Text('Stok Masuk (IN)')),
                        DropdownMenuItem(value: 'out', child: Text('Stok Keluar (OUT)')),
                        DropdownMenuItem(value: 'adjustment', child: Text('Adjustment (+/-)')),
                      ],
                      onChanged: (v) => setModalState(() => mvType = v ?? 'in'),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: itemId,
                      decoration: const InputDecoration(labelText: 'Produk / SKU'),
                      items: [
                        for (final it in items)
                          DropdownMenuItem(
                            value: (it as Map<String, dynamic>)['id'].toString(),
                            child: Text('${it['sku']} - ${it['name']}'),
                          ),
                      ],
                      onChanged: (v) => setModalState(() => itemId = v ?? itemId),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: whId,
                      decoration: const InputDecoration(labelText: 'Gudang'),
                      items: [
                        for (final w in warehouses)
                          DropdownMenuItem(
                            value: (w as Map<String, dynamic>)['id'].toString(),
                            child: Text((w['name'] ?? '').toString()),
                          ),
                      ],
                      onChanged: (v) => setModalState(() => whId = v ?? whId),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: qtyCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Jumlah Unit'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: noteCtrl,
                      decoration: const InputDecoration(labelText: 'Catatan (Opsional)'),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () async {
                        final qty = int.tryParse(qtyCtrl.text.trim()) ?? 0;
                        if (qty == 0) return;
                        try {
                          await ref.read(apiClientProvider).createStockMovement({
                            'item_id': itemId,
                            'warehouse_id': whId,
                            'movement_type': mvType,
                            'qty': qty,
                            'note': noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
                          });
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
                      child: const Text('Eksekusi Mutasi'),
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
    if (!widget.profile.hasPermission('inventory', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Inventaris Ditolak',
          description: 'Role Anda tidak memiliki izin inventory:view.',
        ),
      );
    }
    if (_loading) return const InventorySkeleton();
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    final stocks = (_data?['stocks'] as List<dynamic>?) ?? const [];
    final items = (_data?['items'] as List<dynamic>?) ?? const [];
    final q = _search.trim().toLowerCase();
    final filtered = stocks.where((raw) {
      if (q.isEmpty) return true;
      final m = raw as Map<String, dynamic>;
      return (m['sku'] ?? '').toString().toLowerCase().contains(q) ||
          (m['barcode'] ?? '').toString().toLowerCase().contains(q) ||
          (m['name'] ?? '').toString().toLowerCase().contains(q);
    }).toList(growable: false);

    final shownCount = filtered.length < _visibleCount ? filtered.length : _visibleCount;
    final hasMore = shownCount < filtered.length;

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(filtered.length);
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
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            decoration: const InputDecoration(
                              labelText: 'Cari SKU / Barcode / Nama',
                              prefixIcon: Icon(Icons.search),
                            ),
                            onChanged: (v) => setState(() {
                              _search = v;
                              _visibleCount = _batchSize;
                            }),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filledTonal(
                          tooltip: 'Scan Barcode',
                          onPressed: () async {
                            final scanned = await showBarcodeScannerSheet(context);
                            if (scanned != null && mounted) {
                              setState(() {
                                _search = scanned;
                                _visibleCount = _batchSize;
                              });
                            }
                          },
                          icon: const Icon(Icons.qr_code_scanner),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (widget.profile.hasPermission('inventory', 'create')) ...[
                      FilledButton.icon(
                        onPressed: items.isEmpty ? null : () => _openMovementSheet(),
                        icon: const Icon(Icons.swap_horiz),
                        label: const Text('Mutasi Stok (IN / OUT)'),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
              ),
            ),
            if (filtered.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Tidak ada stok gudang ditemukan',
                    description: 'Tambahkan item katalog atau lakukan mutasi stok masuk.',
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
                        label: 'Memuat stok item berikutnya...',
                      );
                    }
                    final s = filtered[index] as Map<String, dynamic>;
                    final isLow = s['is_low_stock'] == true;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          title: Text('${s['name']} (${s['sku']})'),
                          subtitle: Text(
                            '${s['warehouse_name']} • Jual ${formatRupiah(s['sell_price'])}',
                          ),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                '${s['qty']} ${s['unit']}',
                                style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 15),
                              ),
                              const SizedBox(height: 4),
                              ErpBadge(
                                label: isLow ? 'Kritis (min ${s['min_stock']})' : 'Aman',
                                tone: isLow ? ErpBadgeTone.danger : ErpBadgeTone.success,
                              ),
                            ],
                          ),
                          onTap: widget.profile.hasPermission('inventory', 'create')
                              ? () {
                                  HapticFeedback.selectionClick();
                                  _openMovementSheet(preselectedItemId: s['item_id'].toString());
                                }
                              : null,
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
