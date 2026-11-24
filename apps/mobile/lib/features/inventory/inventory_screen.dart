import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

enum _InventoryFilter { all, lowStock, movements }

class InventoryScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const InventoryScreen({super.key, required this.profile});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  static const int _batchSize = 15;

  final _searchCtrl = TextEditingController();
  bool _loading = true;
  bool _loadingMore = false;
  int _visibleCount = _batchSize;
  int _observedVersion = 0;
  Timer? _moreTimer;
  String? _error;
  String _search = '';
  _InventoryFilter _filter = _InventoryFilter.all;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    _load();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _emitMutationSuccess() {
    final next = ref.read(erpDataVersionProvider) + 1;
    _observedVersion = next;
    ref.read(erpDataVersionProvider.notifier).state = next;
    ref.invalidate(sessionProfileProvider);
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

  Future<void> _openMovementSheet({
    String? preselectedItemId,
    String? preselectedWarehouseId,
  }) async {
    final items = (_data?['items'] as List<dynamic>?) ?? const [];
    final warehouses = (_data?['warehouses'] as List<dynamic>?) ?? const [];
    if (items.isEmpty || warehouses.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Item atau gudang belum tersedia untuk mutasi stok.'),
        ),
      );
      return;
    }

    final result = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _StockMovementSheet(
        items: items,
        warehouses: warehouses,
        preselectedItemId: preselectedItemId,
        preselectedWarehouseId: preselectedWarehouseId,
      ),
    );

    if (result == true && mounted) {
      _emitMutationSuccess();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Mutasi stok berhasil dicatat.')),
        );
      }
    }
  }

  Future<void> _openCreateItemSheet() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const _CreateItemSheet(),
    );

    if (result == true && mounted) {
      _emitMutationSuccess();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Produk baru berhasil ditambahkan ke katalog.')),
        );
      }
    }
  }

  IconData _movementIcon(String type) {
    switch (type) {
      case 'in':
        return Icons.south_west_rounded;
      case 'out':
        return Icons.north_east_rounded;
      case 'transfer':
        return Icons.swap_horiz_rounded;
      default:
        return Icons.tune_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(erpDataVersionProvider, (prev, next) {
      if (next != _observedVersion && mounted) {
        _observedVersion = next;
        _load();
      }
    });

    final t = EucalyptusTokens.of(context);
    if (!widget.profile.hasPermission('inventory', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Inventaris Ditolak',
          description: 'Role Anda belum memiliki izin inventory:view.',
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
    final movements = (_data?['movements'] as List<dynamic>?) ?? const [];
    final canCreate = widget.profile.hasPermission('inventory', 'create');

    final lowStockCount = stocks
        .where((raw) => (raw as Map<String, dynamic>)['is_low_stock'] == true)
        .length;

    final q = _search.trim().toLowerCase();
    final filteredStocks = stocks.where((raw) {
      final m = raw as Map<String, dynamic>;
      if (_filter == _InventoryFilter.lowStock && m['is_low_stock'] != true) {
        return false;
      }
      if (q.isEmpty) return true;
      return (m['sku'] ?? '').toString().toLowerCase().contains(q) ||
          (m['barcode'] ?? '').toString().toLowerCase().contains(q) ||
          (m['name'] ?? '').toString().toLowerCase().contains(q) ||
          (m['warehouse_name'] ?? '').toString().toLowerCase().contains(q);
    }).toList(growable: false);

    final filteredMovements = movements.where((raw) {
      if (q.isEmpty) return true;
      final m = raw as Map<String, dynamic>;
      return (m['item_name'] ?? '').toString().toLowerCase().contains(q) ||
          (m['sku'] ?? '').toString().toLowerCase().contains(q) ||
          (m['warehouse_name'] ?? '').toString().toLowerCase().contains(q) ||
          (m['note'] ?? '').toString().toLowerCase().contains(q) ||
          (m['movement_type'] ?? '').toString().toLowerCase().contains(q);
    }).toList(growable: false);

    final activeList = _filter == _InventoryFilter.movements ? filteredMovements : filteredStocks;
    final shownCount = activeList.length < _visibleCount ? activeList.length : _visibleCount;
    final hasMore = shownCount < activeList.length;

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMore && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(activeList.length);
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
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _searchCtrl,
                            decoration: InputDecoration(
                              hintText: 'Cari SKU, Barcode, atau Nama Produk',
                              prefixIcon: const Icon(Icons.search),
                              suffixIcon: _search.isNotEmpty
                                  ? IconButton(
                                      tooltip: 'Hapus pencarian',
                                      onPressed: () {
                                        _searchCtrl.clear();
                                        setState(() {
                                          _search = '';
                                          _visibleCount = _batchSize;
                                        });
                                      },
                                      icon: const Icon(Icons.close, size: 18),
                                    )
                                  : null,
                            ),
                            onChanged: (v) => setState(() {
                              _search = v;
                              _visibleCount = _batchSize;
                            }),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 48,
                          height: 48,
                          child: IconButton.filledTonal(
                            tooltip: 'Scan Barcode',
                            onPressed: () async {
                              final scanned = await showBarcodeScannerSheet(context);
                              if (scanned != null && mounted) {
                                _searchCtrl.text = scanned;
                                setState(() {
                                  _search = scanned;
                                  _visibleCount = _batchSize;
                                });
                              }
                            },
                            icon: const Icon(Icons.qr_code_scanner),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // 2-col KPI summary strip
                    Row(
                      children: [
                        Expanded(
                          child: Card(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(t.radiusLg),
                              onTap: () => setState(() {
                                _filter = _InventoryFilter.all;
                                _visibleCount = _batchSize;
                              }),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Total SKU',
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      '${items.length}',
                                      style: AppTheme.monoNumeric(
                                        color: t.textPrimary,
                                        fontSize: 22,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${stocks.length} posisi gudang',
                                      style: Theme.of(context).textTheme.bodySmall,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Card(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(t.radiusLg),
                              onTap: () => setState(() {
                                _filter = _InventoryFilter.lowStock;
                                _visibleCount = _batchSize;
                              }),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Stok Kritis',
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      '$lowStockCount',
                                      style: AppTheme.monoNumeric(
                                        color: lowStockCount > 0 ? t.danger : t.success,
                                        fontSize: 22,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      lowStockCount > 0 ? 'Ketuk untuk filter' : 'Semua aman',
                                      style: Theme.of(context).textTheme.bodySmall,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    if (canCreate) ...[
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: items.isEmpty ? null : () => _openMovementSheet(),
                              icon: const Icon(Icons.swap_horiz, size: 18),
                              label: const Text('Mutasi Stok'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _openCreateItemSheet,
                              icon: const Icon(Icons.add_box_outlined, size: 18),
                              label: const Text('Tambah Produk'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],

                    ErpFilterPillBar<_InventoryFilter>(
                      selected: _filter,
                      onSelected: (val) => setState(() {
                        _filter = val;
                        _visibleCount = _batchSize;
                      }),
                      options: [
                        ErpFilterPillOption(
                          value: _InventoryFilter.all,
                          label: 'Semua (${stocks.length})',
                        ),
                        ErpFilterPillOption(
                          value: _InventoryFilter.lowStock,
                          label: 'Stok Kritis ($lowStockCount)',
                        ),
                        ErpFilterPillOption(
                          value: _InventoryFilter.movements,
                          label: 'Riwayat Mutasi (${movements.length})',
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _filter == _InventoryFilter.movements
                          ? 'Riwayat Pergerakan Stok (${filteredMovements.length})'
                          : 'Posisi Stok Gudang (${filteredStocks.length})',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ),
            if (activeList.isEmpty)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: _filter == _InventoryFilter.movements
                        ? 'Belum ada riwayat mutasi'
                        : _filter == _InventoryFilter.lowStock
                            ? 'Tidak ada stok kritis'
                            : 'Tidak ada stok gudang ditemukan',
                    description: _filter == _InventoryFilter.lowStock
                        ? 'Seluruh SKU berada di atas batas stok minimum.'
                        : 'Tambahkan item katalog atau lakukan mutasi stok masuk.',
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
                      return LazyListShimmerFooter(
                        label: _filter == _InventoryFilter.movements
                            ? 'Memuat mutasi stok berikutnya...'
                            : 'Memuat stok item berikutnya...',
                      );
                    }
                    if (_filter == _InventoryFilter.movements) {
                      final m = filteredMovements[index] as Map<String, dynamic>;
                      final type = (m['movement_type'] ?? 'in').toString();
                      final rawDelta = int.tryParse((m['qty_delta'] ?? 0).toString()) ?? 0;
                      final isPositive = rawDelta > 0;
                      final dt = DateTime.tryParse((m['created_at'] ?? '').toString());
                      final timeLabel = dt != null
                          ? formatRelativeTimeId(dt)
                          : formatShortDateTime(m['created_at']?.toString());
                      final note = (m['note'] ?? '').toString().trim();
                      final subtitleParts = [
                        (m['warehouse_name'] ?? '-').toString(),
                        if (note.isNotEmpty) note,
                        timeLabel,
                      ];

                      final color = type == 'transfer'
                          ? t.info
                          : isPositive
                              ? t.success
                              : t.danger;
                      final bg = type == 'transfer'
                          ? t.infoSoft
                          : isPositive
                              ? t.successSoft
                              : t.dangerSoft;

                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: ErpListRowCard(
                          leadingIcon: _movementIcon(type),
                          leadingColor: color,
                          leadingBackground: bg,
                          title: '${m['item_name'] ?? '-'} (${m['sku'] ?? ''})',
                          subtitle: subtitleParts.join(' · '),
                          trailing: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                '${rawDelta >= 0 ? '+$rawDelta' : rawDelta} unit',
                                style: AppTheme.monoNumeric(color: color, fontSize: 13.5),
                              ),
                              const SizedBox(height: 4),
                              ErpBadge(
                                label: type.toUpperCase(),
                                tone: type == 'transfer'
                                    ? ErpBadgeTone.info
                                    : isPositive
                                        ? ErpBadgeTone.success
                                        : ErpBadgeTone.warning,
                              ),
                            ],
                          ),
                        ),
                      );
                    }

                    final s = filteredStocks[index] as Map<String, dynamic>;
                    final isLow = s['is_low_stock'] == true;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: isLow
                            ? Icons.warning_amber_rounded
                            : Icons.inventory_2_outlined,
                        leadingColor: isLow ? t.danger : t.accent,
                        leadingBackground: isLow ? t.dangerSoft : t.accentSoft,
                        title: '${s['name']} (${s['sku']})',
                        subtitle:
                            '${s['warehouse_name']} · Jual ${formatRupiah(s['sell_price'])}',
                        trailing: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '${s['qty']} ${s['unit']}',
                              style: AppTheme.monoNumeric(
                                color: t.textPrimary,
                                fontSize: 14,
                              ),
                            ),
                            const SizedBox(height: 4),
                            ErpBadge(
                              label: isLow ? 'Kritis (min ${s['min_stock']})' : 'Aman',
                              tone: isLow ? ErpBadgeTone.danger : ErpBadgeTone.success,
                            ),
                          ],
                        ),
                        onTap: canCreate
                            ? () {
                                HapticFeedback.selectionClick();
                                _openMovementSheet(
                                  preselectedItemId: s['item_id'].toString(),
                                  preselectedWarehouseId: s['warehouse_id']?.toString(),
                                );
                              }
                            : null,
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

class _StockMovementSheet extends ConsumerStatefulWidget {
  final List<dynamic> items;
  final List<dynamic> warehouses;
  final String? preselectedItemId;
  final String? preselectedWarehouseId;

  const _StockMovementSheet({
    required this.items,
    required this.warehouses,
    this.preselectedItemId,
    this.preselectedWarehouseId,
  });

  @override
  ConsumerState<_StockMovementSheet> createState() => _StockMovementSheetState();
}

class _StockMovementSheetState extends ConsumerState<_StockMovementSheet> {
  final _qtyCtrl = TextEditingController(text: '1');
  final _noteCtrl = TextEditingController();

  late String _itemId;
  late String _whId;
  String? _targetWhId;
  String _mvType = 'in';
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _itemId = widget.preselectedItemId ??
        (widget.items.first as Map<String, dynamic>)['id'].toString();
    _whId = widget.preselectedWarehouseId ??
        (widget.warehouses.first as Map<String, dynamic>)['id'].toString();
    _syncTargetWarehouse();
  }

  @override
  void dispose() {
    _qtyCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  void _syncTargetWarehouse() {
    final others = widget.warehouses
        .map((e) => (e as Map<String, dynamic>)['id'].toString())
        .where((id) => id != _whId)
        .toList(growable: false);
    if (others.isEmpty) {
      _targetWhId = null;
    } else if (_targetWhId == null || _targetWhId == _whId) {
      _targetWhId = others.first;
    }
  }

  Future<void> _submit() async {
    final qty = int.tryParse(_qtyCtrl.text.trim());
    if (qty == null || (_mvType == 'adjustment' ? qty == 0 : qty <= 0)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _mvType == 'adjustment'
                ? 'Jumlah koreksi tidak boleh 0 (isi positif atau negatif).'
                : 'Jumlah unit harus bilangan bulat positif.',
          ),
        ),
      );
      return;
    }

    if (_mvType == 'transfer') {
      if (widget.warehouses.length < 2 || _targetWhId == null || _targetWhId == _whId) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pilih gudang tujuan yang berbeda untuk transfer stok.'),
          ),
        );
        return;
      }
    }

    setState(() => _submitting = true);
    final payload = <String, dynamic>{
      'item_id': _itemId,
      'warehouse_id': _whId,
      if (_mvType == 'transfer' && _targetWhId != null) 'target_warehouse_id': _targetWhId,
      'movement_type': _mvType,
      'qty': qty,
      if (_noteCtrl.text.trim().isNotEmpty) 'note': _noteCtrl.text.trim(),
    };

    try {
      await ref.read(apiClientProvider).createStockMovement(payload);
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (!isOfflineRecoverableError(err)) {
        if (mounted) {
          setState(() => _submitting = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(err.toString())),
          );
        }
        return;
      }

      await ref.read(offlineSyncServiceProvider).enqueueMutation(
            endpoint: '/api/inventory/movements',
            method: 'POST',
            payload: payload,
          );
      ref.invalidate(pendingOfflineCountProvider);
      if (mounted) {
        Navigator.of(context).pop(false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Offline: mutasi stok disimpan ke antrean lokal.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canTransfer = widget.warehouses.length >= 2;
    final targetWarehouses = widget.warehouses
        .where((w) => (w as Map<String, dynamic>)['id'].toString() != _whId)
        .toList(growable: false);

    return ErpBottomSheetFrame(
      title: 'Catat Mutasi Stok',
      subtitle: 'Stok masuk, keluar, transfer gudang, atau koreksi opname',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<String>(
            segments: [
              const ButtonSegment(value: 'in', label: Text('Masuk')),
              const ButtonSegment(value: 'out', label: Text('Keluar')),
              if (canTransfer) const ButtonSegment(value: 'transfer', label: Text('Transfer')),
              const ButtonSegment(value: 'adjustment', label: Text('Koreksi')),
            ],
            selected: {_mvType},
            onSelectionChanged: (s) => setState(() {
              _mvType = s.first;
              _syncTargetWarehouse();
            }),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _itemId,
            decoration: const InputDecoration(labelText: 'Item Produk'),
            isExpanded: true,
            items: [
              for (final it in widget.items)
                DropdownMenuItem(
                  value: (it as Map<String, dynamic>)['id'].toString(),
                  child: Text(
                    '${it['name']} (${it['sku']})',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _itemId = v);
            },
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _whId,
            decoration: InputDecoration(
              labelText: _mvType == 'transfer' ? 'Gudang Asal' : 'Gudang',
            ),
            items: [
              for (final w in widget.warehouses)
                DropdownMenuItem(
                  value: (w as Map<String, dynamic>)['id'].toString(),
                  child: Text((w['name'] ?? '-').toString()),
                ),
            ],
            onChanged: (v) {
              if (v != null) {
                setState(() {
                  _whId = v;
                  _syncTargetWarehouse();
                });
              }
            },
          ),
          if (_mvType == 'transfer' && targetWarehouses.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _targetWhId,
              decoration: const InputDecoration(labelText: 'Gudang Tujuan'),
              items: [
                for (final w in targetWarehouses)
                  DropdownMenuItem(
                    value: (w as Map<String, dynamic>)['id'].toString(),
                    child: Text((w['name'] ?? '-').toString()),
                  ),
              ],
              onChanged: (v) => setState(() => _targetWhId = v),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _qtyCtrl,
            keyboardType: TextInputType.numberWithOptions(signed: _mvType == 'adjustment'),
            decoration: InputDecoration(
              labelText: _mvType == 'adjustment'
                  ? 'Selisih Koreksi Unit (+ / -)'
                  : 'Jumlah Unit',
              hintText: _mvType == 'adjustment' ? 'Contoh: -2 atau 5' : 'Contoh: 10',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _noteCtrl,
            decoration: const InputDecoration(
              labelText: 'Catatan (opsional)',
              hintText: 'Nomor DO, opname rak, atau keperluan',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'Menyimpan...' : 'Simpan Mutasi'),
          ),
        ],
      ),
    );
  }
}

class _CreateItemSheet extends ConsumerStatefulWidget {
  const _CreateItemSheet();

  @override
  ConsumerState<_CreateItemSheet> createState() => _CreateItemSheetState();
}

class _CreateItemSheetState extends ConsumerState<_CreateItemSheet> {
  final _skuCtrl = TextEditingController();
  final _barcodeCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _unitCtrl = TextEditingController(text: 'pcs');
  final _costCtrl = TextEditingController();
  final _sellCtrl = TextEditingController();
  final _minStockCtrl = TextEditingController(text: '5');

  bool _submitting = false;

  @override
  void dispose() {
    _skuCtrl.dispose();
    _barcodeCtrl.dispose();
    _nameCtrl.dispose();
    _unitCtrl.dispose();
    _costCtrl.dispose();
    _sellCtrl.dispose();
    _minStockCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final sku = _skuCtrl.text.trim();
    final name = _nameCtrl.text.trim();
    final unit = _unitCtrl.text.trim().isEmpty ? 'pcs' : _unitCtrl.text.trim();
    final cost = parseRupiahInput(_costCtrl.text);
    final sell = parseRupiahInput(_sellCtrl.text);
    final minStock = int.tryParse(_minStockCtrl.text.trim()) ?? -1;

    if (sku.length < 2 || name.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('SKU dan nama produk minimal 2 karakter.')),
      );
      return;
    }
    if (cost == null || sell == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Harga modal dan jual harus bilangan bulat Rupiah positif.'),
        ),
      );
      return;
    }
    if (minStock < 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Minimum stok harus >= 0.')),
      );
      return;
    }

    setState(() => _submitting = true);
    final payload = <String, dynamic>{
      'sku': sku,
      if (_barcodeCtrl.text.trim().isNotEmpty) 'barcode': _barcodeCtrl.text.trim(),
      'name': name,
      'unit': unit,
      'cost_price': cost,
      'sell_price': sell,
      'min_stock': minStock,
    };

    try {
      await ref.read(apiClientProvider).createInventoryItem(payload);
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
      title: 'Tambah Produk Baru',
      subtitle: 'Tambahkan SKU baru ke katalog inventaris MyEkalliptus',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _skuCtrl,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Kode SKU',
                    hintText: 'EKA-001',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _unitCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Satuan Unit',
                    hintText: 'pcs / box',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Nama Produk',
              hintText: 'Contoh: Kopi Arabika 1kg',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _barcodeCtrl,
            decoration: InputDecoration(
              labelText: 'Barcode (opsional)',
              suffixIcon: IconButton(
                tooltip: 'Scan Barcode',
                onPressed: () async {
                  final scanned = await showBarcodeScannerSheet(context);
                  if (scanned != null && mounted) {
                    _barcodeCtrl.text = scanned;
                  }
                },
                icon: const Icon(Icons.qr_code_scanner),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _costCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Harga Modal (Rp)',
                    hintText: '50000',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _sellCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Harga Jual (Rp)',
                    hintText: '75000',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _minStockCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Batas Stok Minimum',
              hintText: '5',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'Menyimpan...' : 'Simpan Produk'),
          ),
        ],
      ),
    );
  }
}
