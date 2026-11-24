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

enum _PosTab { pos, reports }

class _CartLine {
  final String key;
  final String? inventoryItemId;
  final String? sku;
  final String itemName;
  final String unit;
  final int unitPrice;
  final int qty;
  final int? maxStock;

  const _CartLine({
    required this.key,
    required this.inventoryItemId,
    required this.sku,
    required this.itemName,
    required this.unit,
    required this.unitPrice,
    required this.qty,
    required this.maxStock,
  });

  _CartLine copyWith({int? qty, int? maxStock}) {
    return _CartLine(
      key: key,
      inventoryItemId: inventoryItemId,
      sku: sku,
      itemName: itemName,
      unit: unit,
      unitPrice: unitPrice,
      qty: qty ?? this.qty,
      maxStock: maxStock ?? this.maxStock,
    );
  }
}

class FinanceScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const FinanceScreen({super.key, required this.profile});

  @override
  ConsumerState<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends ConsumerState<FinanceScreen> {
  _PosTab _tab = _PosTab.pos;
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _catalog;
  Map<String, dynamic>? _salesData;
  int _observedVersion = 0;

  String _search = '';
  String? _selectedWarehouseId;
  String _statusFilter = '';
  String _methodFilter = '';
  final List<_CartLine> _cart = [];
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final results = await Future.wait([
        api.fetchPosCatalog(),
        api.fetchPosSales(
          status: _statusFilter.isEmpty ? null : _statusFilter,
          paymentMethod: _methodFilter.isEmpty ? null : _methodFilter,
        ),
      ]);
      if (!mounted) return;
      final catalog = results[0];
      final whList = (catalog['warehouses'] as List<dynamic>?) ?? const [];
      final defaultWh = catalog['default_warehouse_id']?.toString() ??
          (whList.isNotEmpty ? (whList.first as Map<String, dynamic>)['id']?.toString() : null);

      setState(() {
        _catalog = catalog;
        _salesData = results[1];
        _selectedWarehouseId ??= defaultWh;
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

  void _markDataMutated() {
    final next = ref.read(erpDataVersionProvider) + 1;
    _observedVersion = next;
    ref.read(erpDataVersionProvider.notifier).state = next;
    ref.invalidate(sessionProfileProvider);
  }

  int _stockForProduct(Map<String, dynamic> p) {
    final byWh = (p['stocks_by_warehouse'] as Map<String, dynamic>?) ?? const {};
    if (_selectedWarehouseId != null && _selectedWarehouseId!.isNotEmpty) {
      return (byWh[_selectedWarehouseId] as num?)?.toInt() ?? 0;
    }
    return (p['total_stock'] as num?)?.toInt() ?? 0;
  }

  void _addProductToCart(Map<String, dynamic> p) {
    final avail = _stockForProduct(p);
    if (avail <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Stok ${p['name']} di gudang terpilih habis.')),
      );
      return;
    }
    final price = int.tryParse((p['sell_price'] ?? '0').toString()) ?? 0;
    if (price <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Harga jual ${p['name']} belum diatur (> Rp 0) di Inventaris.')),
      );
      return;
    }

    final itemId = p['id'].toString();
    final idx = _cart.indexWhere((c) => c.inventoryItemId == itemId);
    if (idx >= 0) {
      final current = _cart[idx];
      if (current.qty + 1 > avail) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Stok ${p['name']} tersisa $avail ${p['unit']}.')),
        );
        return;
      }
      setState(() {
        _cart[idx] = current.copyWith(qty: current.qty + 1, maxStock: avail);
      });
    } else {
      setState(() {
        _cart.add(
          _CartLine(
            key: 'inv-$itemId',
            inventoryItemId: itemId,
            sku: p['sku']?.toString(),
            itemName: (p['name'] ?? 'Produk').toString(),
            unit: (p['unit'] ?? 'pcs').toString(),
            unitPrice: price,
            qty: 1,
            maxStock: avail,
          ),
        );
      });
    }
    HapticFeedback.selectionClick();
  }

  Future<void> _scanProductBarcode() async {
    final code = await showBarcodeScannerSheet(
      context,
      title: 'Scan Barcode / SKU Kasir',
    );
    if (!mounted || code == null || code.trim().isEmpty) return;
    final clean = code.trim().toLowerCase();
    final products = (_catalog?['products'] as List<dynamic>?) ?? const [];
    Map<String, dynamic>? match;
    for (final raw in products) {
      final p = raw as Map<String, dynamic>;
      final barcode = (p['barcode'] ?? '').toString().toLowerCase();
      final sku = (p['sku'] ?? '').toString().toLowerCase();
      if (barcode == clean || sku == clean) {
        match = p;
        break;
      }
    }
    if (match != null) {
      _addProductToCart(match);
    } else {
      setState(() {
        _search = code.trim();
        _searchCtrl.text = code.trim();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Kode "$code" tidak cocok persis dengan katalog.')),
      );
    }
  }

  Future<void> _openManualItemSheet() async {
    final created = await showModalBottomSheet<_CartLine>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _ManualItemSheet(),
    );
    if (created != null && mounted) {
      setState(() => _cart.add(created));
    }
  }

  void _updateCartQty(String key, int nextQty) {
    setState(() {
      final idx = _cart.indexWhere((c) => c.key == key);
      if (idx < 0) return;
      if (nextQty <= 0) {
        _cart.removeAt(idx);
        return;
      }
      final current = _cart[idx];
      if (current.maxStock != null && nextQty > current.maxStock!) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Stok ${current.itemName} tersisa ${current.maxStock} ${current.unit}.'),
          ),
        );
        return;
      }
      _cart[idx] = current.copyWith(qty: nextQty);
    });
  }

  Future<void> _openCheckoutSheet() async {
    if (_cart.isEmpty) return;
    final accounts = (_catalog?['accounts'] as List<dynamic>?) ?? const [];
    if (accounts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Belum ada akun kas/rekening aktif.')),
      );
      return;
    }

    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PosCheckoutSheet(
        cart: _cart,
        accounts: accounts,
        warehouseId: _selectedWarehouseId,
        onQtyChanged: _updateCartQty,
      ),
    );

    if (result != null && mounted) {
      setState(() => _cart.clear());
      _markDataMutated();
      await _load();
      if (mounted && result['sale'] is Map<String, dynamic>) {
        final sale = result['sale'] as Map<String, dynamic>;
        await _openReceiptSheet(sale);
      }
    }
  }

  Future<void> _openReceiptSheet(Map<String, dynamic> sale) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PosReceiptSheet(
        sale: sale,
        canVoid: widget.profile.hasPermission('finance', 'approve'),
      ),
    );
    if (changed == true && mounted) {
      _markDataMutated();
      await _load();
    }
  }

  String _methodLabel(String method) {
    switch (method) {
      case 'cash':
        return 'Tunai';
      case 'qris':
        return 'QRIS';
      case 'transfer':
        return 'Transfer';
      case 'ewallet':
        return 'E-Wallet';
      default:
        return method.toUpperCase();
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
    if (!widget.profile.hasPermission('finance', 'view')) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Kasir / POS Ditolak',
          description: 'Role Anda belum memiliki izin finance:view.',
        ),
      );
    }

    if (_loading) return const FinanceSkeleton();
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    final warehouses = (_catalog?['warehouses'] as List<dynamic>?) ?? const [];
    final products = (_catalog?['products'] as List<dynamic>?) ?? const [];
    final canCreate = widget.profile.hasPermission('finance', 'create');

    final q = _search.trim().toLowerCase();
    final filteredProducts = products.where((raw) {
      if (q.isEmpty) return true;
      final p = raw as Map<String, dynamic>;
      return (p['name'] ?? '').toString().toLowerCase().contains(q) ||
          (p['sku'] ?? '').toString().toLowerCase().contains(q) ||
          (p['barcode'] ?? '').toString().toLowerCase().contains(q);
    }).toList(growable: false);

    final cartItemCount = _cart.fold<int>(0, (sum, c) => sum + c.qty);
    final cartSubtotal = _cart.fold<int>(0, (sum, c) => sum + (c.unitPrice * c.qty));

    final sales = (_salesData?['sales'] as List<dynamic>?) ?? const [];
    final report = (_salesData?['report'] as Map<String, dynamic>?) ?? const {};
    final topProducts = (report['top_products'] as List<dynamic>?) ?? const [];
    final accounts = (report['accounts'] as List<dynamic>?) ?? const [];
    final byMethod = (report['by_payment_method'] as Map<String, dynamic>?) ?? const {};

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _load,
          child: CustomScrollView(
            slivers: [
              SliverPadding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  (_tab == _PosTab.pos && _cart.isNotEmpty ? 184.0 : 124.0) +
                      MediaQuery.paddingOf(context).bottom,
                ),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    // Segmented tab Kasir vs Laporan
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: t.surface,
                        borderRadius: BorderRadius.circular(t.radiusMd),
                        border: Border.all(color: t.border),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: _PosTabButton(
                              icon: Icons.point_of_sale_rounded,
                              label: 'Kasir / POS',
                              selected: _tab == _PosTab.pos,
                              onTap: () => setState(() => _tab = _PosTab.pos),
                            ),
                          ),
                          Expanded(
                            child: _PosTabButton(
                              icon: Icons.assessment_outlined,
                              label: 'Laporan & Riwayat',
                              selected: _tab == _PosTab.reports,
                              onTap: () => setState(() => _tab = _PosTab.reports),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    if (_tab == _PosTab.pos) ...[
                      // Pencarian + Scan Barcode + Item Manual
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _searchCtrl,
                              onChanged: (v) => setState(() => _search = v),
                              decoration: const InputDecoration(
                                hintText: 'Cari produk, SKU, barcode...',
                                prefixIcon: Icon(Icons.search, size: 20),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          SizedBox(
                            height: 46,
                            width: 46,
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                padding: EdgeInsets.zero,
                              ),
                              onPressed: _scanProductBarcode,
                              child: const Icon(Icons.qr_code_scanner, size: 20),
                            ),
                          ),
                          if (canCreate) ...[
                            const SizedBox(width: 8),
                            SizedBox(
                              height: 46,
                              child: FilledButton.tonalIcon(
                                onPressed: _openManualItemSheet,
                                icon: const Icon(Icons.add, size: 18),
                                label: const Text('Manual'),
                              ),
                            ),
                          ],
                        ],
                      ),

                      if (warehouses.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        SizedBox(
                          height: 36,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: warehouses.length,
                            separatorBuilder: (_, __) => const SizedBox(width: 8),
                            itemBuilder: (_, idx) {
                              final w = warehouses[idx] as Map<String, dynamic>;
                              final id = w['id'].toString();
                              final selected = _selectedWarehouseId == id;
                              return FilterChip(
                                selected: selected,
                                label: Text((w['name'] ?? 'Gudang').toString()),
                                onSelected: (_) => setState(() {
                                  _selectedWarehouseId = id;
                                  _cart.removeWhere((c) => c.inventoryItemId != null);
                                }),
                              );
                            },
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),

                      if (_cart.any((c) => c.inventoryItemId == null)) ...[
                        Text(
                          'Item Manual di Keranjang (${_cart.where((c) => c.inventoryItemId == null).length})',
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: 6),
                        for (final c in _cart.where((x) => x.inventoryItemId == null))
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: ErpListRowCard(
                              leadingIcon: Icons.edit_note_rounded,
                              leadingColor: t.accent,
                              leadingBackground: t.accentSoft,
                              title: c.itemName,
                              subtitle: '${c.qty} ${c.unit} x ${formatRupiah(c.unitPrice)} (Manual)',
                              trailing: Text(
                                formatRupiah(c.qty * c.unitPrice),
                                style: Theme.of(context).textTheme.labelLarge,
                              ),
                              onTap: _openCheckoutSheet,
                            ),
                          ),
                        const SizedBox(height: 8),
                      ],

                      if (filteredProducts.isEmpty)
                        ErpEmptyCard(
                          title: 'Produk tidak ditemukan',
                          description:
                              'Tambah produk di Inventaris atau tekan tombol Manual untuk menjual item jasa/non-stok.',
                          actionLabel: canCreate ? 'Tambah Item Manual' : null,
                          onAction: canCreate ? _openManualItemSheet : null,
                        )
                      else
                        for (final raw in filteredProducts) ...[
                          Builder(
                            builder: (ctx) {
                              final p = raw as Map<String, dynamic>;
                              final stock = _stockForProduct(p);
                              final minStock = (p['min_stock'] as num?)?.toInt() ?? 0;
                              final outOfStock = stock <= 0;
                              final itemId = p['id'].toString();
                              final cartIdx =
                                  _cart.indexWhere((c) => c.inventoryItemId == itemId);
                              final inCartQty = cartIdx >= 0 ? _cart[cartIdx].qty : 0;

                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Opacity(
                                  opacity: outOfStock ? 0.58 : 1,
                                  child: ErpListRowCard(
                                    leadingIcon: Icons.inventory_2_outlined,
                                    leadingColor: outOfStock ? t.danger : t.accent,
                                    leadingBackground:
                                        outOfStock ? t.dangerSoft : t.accentSoft,
                                    title: (p['name'] ?? 'Produk').toString(),
                                    subtitle:
                                        'SKU: ${p['sku']} · Stok $stock ${p['unit']}${stock <= minStock && !outOfStock ? ' (Menipis)' : ''}',
                                    trailing: Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      crossAxisAlignment: CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          formatRupiah(p['sell_price']),
                                          style: TextStyle(
                                            fontWeight: FontWeight.w700,
                                            color: t.accentHover,
                                          ),
                                        ),
                                        const SizedBox(height: 3),
                                        if (inCartQty > 0)
                                          ErpBadge(
                                            label: '${inCartQty}x di keranjang',
                                            tone: ErpBadgeTone.info,
                                          )
                                        else
                                          Text(
                                            outOfStock ? 'Stok habis' : 'Tap +1',
                                            style: Theme.of(ctx).textTheme.bodySmall,
                                          ),
                                      ],
                                    ),
                                    onTap: canCreate && !outOfStock
                                        ? () => _addProductToCart(p)
                                        : null,
                                  ),
                                ),
                              );
                            },
                          ),
                        ],
                    ] else ...[
                      // TAB LAPORAN & RIWAYAT PENJUALAN
                      ErpHeroCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Omzet Penjualan Hari Ini',
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.white.withValues(alpha: 0.85),
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              formatRupiah(report['today_revenue'] ?? '0'),
                              style: const TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 6,
                              children: [
                                _HeroChip(
                                  label: '${report['today_count'] ?? 0} Struk Hari Ini',
                                ),
                                _HeroChip(
                                  label:
                                      'Rata-rata ${formatRupiah(report['today_avg_ticket'] ?? '0')}',
                                ),
                                _HeroChip(
                                  label: 'Void: ${report['void_count'] ?? 0}',
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),

                      Text(
                        'Per Metode Bayar & Saldo Akun Kas',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 108,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            for (final m in ['cash', 'qris', 'transfer', 'ewallet']) ...[
                              Container(
                                width: 152,
                                margin: const EdgeInsets.only(right: 10),
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: t.surface,
                                  borderRadius: BorderRadius.circular(t.radiusMd),
                                  border: Border.all(color: t.border),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      _methodLabel(m),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      formatRupiah((byMethod[m] as Map?)?['total'] ?? '0'),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.titleSmall,
                                    ),
                                    Text(
                                      '${(byMethod[m] as Map?)?['count'] ?? 0} transaksi',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (accounts.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: [
                            for (final rawAcc in accounts)
                              Builder(
                                builder: (_) {
                                  final acc = rawAcc as Map<String, dynamic>;
                                  return ErpBadge(
                                    label:
                                        '${acc['name']}: ${formatRupiah(acc['balance'])}',
                                    tone: ErpBadgeTone.success,
                                  );
                                },
                              ),
                          ],
                        ),
                      ],

                      if (topProducts.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text(
                          'Produk Terlaris',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        for (final rawTp in topProducts)
                          Builder(
                            builder: (_) {
                              final tp = rawTp as Map<String, dynamic>;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: ErpListRowCard(
                                  leadingIcon: Icons.star_outline_rounded,
                                  leadingColor: t.accent,
                                  leadingBackground: t.accentSoft,
                                  title: (tp['item_name'] ?? '').toString(),
                                  subtitle: '${tp['qty_sold']} ${tp['unit']} terjual',
                                  trailing: Text(
                                    formatRupiah(tp['revenue']),
                                    style: Theme.of(context).textTheme.labelLarge,
                                  ),
                                ),
                              );
                            },
                          ),
                      ],

                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Riwayat Penjualan',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          DropdownButton<String>(
                            value: _statusFilter,
                            underline: const SizedBox.shrink(),
                            items: const [
                              DropdownMenuItem(value: '', child: Text('Semua Status')),
                              DropdownMenuItem(value: 'completed', child: Text('Selesai')),
                              DropdownMenuItem(value: 'void', child: Text('Void')),
                            ],
                            onChanged: (v) {
                              setState(() => _statusFilter = v ?? '');
                              _load();
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      if (sales.isEmpty)
                        ErpEmptyCard(
                          title: 'Belum ada transaksi POS',
                          description: 'Catat penjualan pertama melalui tab Kasir / POS.',
                          actionLabel: 'Buka Kasir',
                          onAction: () => setState(() => _tab = _PosTab.pos),
                        )
                      else
                        for (final rawSale in sales)
                          Builder(
                            builder: (_) {
                              final s = rawSale as Map<String, dynamic>;
                              final isVoid = s['status'] == 'void';
                              final items = (s['items'] as List<dynamic>?) ?? const [];
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: ErpListRowCard(
                                  leadingIcon: Icons.receipt_long_outlined,
                                  leadingColor: isVoid ? t.danger : t.accent,
                                  leadingBackground: isVoid ? t.dangerSoft : t.accentSoft,
                                  title: '${s['sale_number']} · ${_methodLabel((s['payment_method'] ?? 'cash').toString())}',
                                  subtitle:
                                      '${formatShortDateTime(s['created_at']?.toString())} · ${items.length} item · ${s['cashier_name']}',
                                  trailing: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        formatRupiah(s['total_amount']),
                                        style: Theme.of(context).textTheme.labelLarge,
                                      ),
                                      const SizedBox(height: 2),
                                      ErpBadge(
                                        label: isVoid ? 'Void' : 'Selesai',
                                        tone: isVoid
                                            ? ErpBadgeTone.danger
                                            : ErpBadgeTone.success,
                                      ),
                                    ],
                                  ),
                                  onTap: () => _openReceiptSheet(s),
                                ),
                              );
                            },
                          ),
                    ],
                  ]),
                ),
              ),
            ],
          ),
        ),

        // Floating sticky checkout bar above FloatingNavShell
        if (_tab == _PosTab.pos && _cart.isNotEmpty)
          Positioned(
            left: 14,
            right: 14,
            bottom: 92,
            child: Material(
              elevation: 4,
              borderRadius: BorderRadius.circular(t.radiusLg),
              color: t.accent,
              child: InkWell(
                borderRadius: BorderRadius.circular(t.radiusLg),
                onTap: _openCheckoutSheet,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      const Icon(Icons.shopping_cart_checkout, color: Colors.white),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '$cartItemCount item · Tap untuk Checkout',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            Text(
                              formatRupiah(cartSubtotal),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(t.radiusPill),
                        ),
                        child: const Text(
                          'Bayar',
                          style: TextStyle(
                            color: Color(0xFF0B4F4A),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _PosTabButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _PosTabButton({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return InkWell(
      borderRadius: BorderRadius.circular(t.radiusSm),
      onTap: onTap,
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: selected ? t.accent : Colors.transparent,
          borderRadius: BorderRadius.circular(t.radiusSm),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 15, color: selected ? t.onAccent : t.textSecondary),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? t.onAccent : t.textPrimary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeroChip extends StatelessWidget {
  final String label;
  const _HeroChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(9999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Colors.white,
        ),
      ),
    );
  }
}

class _ManualItemSheet extends StatefulWidget {
  const _ManualItemSheet();

  @override
  State<_ManualItemSheet> createState() => _ManualItemSheetState();
}

class _ManualItemSheetState extends State<_ManualItemSheet> {
  final _nameCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _qtyCtrl = TextEditingController(text: '1');
  final _unitCtrl = TextEditingController(text: 'pcs');

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    _qtyCtrl.dispose();
    _unitCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameCtrl.text.trim();
    final price = parseRupiahInput(_priceCtrl.text);
    final qty = int.tryParse(_qtyCtrl.text.trim()) ?? 0;
    if (name.isEmpty || price == null || price <= 0 || qty <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Isi nama item, harga satuan (> 0), dan qty (> 0).')),
      );
      return;
    }
    Navigator.of(context).pop(
      _CartLine(
        key: 'manual-${DateTime.now().microsecondsSinceEpoch}',
        inventoryItemId: null,
        sku: null,
        itemName: name,
        unit: _unitCtrl.text.trim().isEmpty ? 'pcs' : _unitCtrl.text.trim(),
        unitPrice: price,
        qty: qty,
        maxStock: null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ErpBottomSheetFrame(
      title: 'Tambah Item Manual',
      subtitle: 'Untuk jasa atau produk non-stok gudang',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(labelText: 'Nama Produk / Jasa'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _priceCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Harga Satuan (Rp)'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _qtyCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Qty'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _unitCtrl,
            decoration: const InputDecoration(labelText: 'Satuan (mis. pcs / jasa)'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submit,
            child: const Text('Tambahkan ke Keranjang'),
          ),
        ],
      ),
    );
  }
}

class _PosCheckoutSheet extends ConsumerStatefulWidget {
  final List<_CartLine> cart;
  final List<dynamic> accounts;
  final String? warehouseId;
  final void Function(String key, int nextQty) onQtyChanged;

  const _PosCheckoutSheet({
    required this.cart,
    required this.accounts,
    required this.warehouseId,
    required this.onQtyChanged,
  });

  @override
  ConsumerState<_PosCheckoutSheet> createState() => _PosCheckoutSheetState();
}

class _PosCheckoutSheetState extends ConsumerState<_PosCheckoutSheet> {
  String _paymentMethod = 'cash';
  late String _accountId;
  String _discountType = 'none';
  final _discountCtrl = TextEditingController();
  int _taxPercent = 0;
  final _customerCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  final _cashPaidCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _accountId = _pickAccountForMethod('cash');
  }

  @override
  void dispose() {
    _discountCtrl.dispose();
    _customerCtrl.dispose();
    _noteCtrl.dispose();
    _cashPaidCtrl.dispose();
    super.dispose();
  }

  String _pickAccountForMethod(String method) {
    final pref = switch (method) {
      'cash' => ['cash'],
      'qris' => ['qris', 'ewallet', 'bank'],
      'transfer' => ['bank'],
      'ewallet' => ['ewallet', 'qris'],
      _ => ['cash'],
    };
    for (final t in pref) {
      for (final raw in widget.accounts) {
        final a = raw as Map<String, dynamic>;
        if (a['type'] == t) return a['id'].toString();
      }
    }
    return (widget.accounts.first as Map<String, dynamic>)['id'].toString();
  }

  int get _subtotal => widget.cart.fold<int>(0, (s, c) => s + (c.unitPrice * c.qty));

  int get _discountAmount {
    final raw = int.tryParse(_discountCtrl.text.trim()) ?? 0;
    if (raw <= 0 || _discountType == 'none') return 0;
    if (_discountType == 'percent') {
      final pct = raw.clamp(0, 100);
      return (_subtotal * pct) ~/ 100;
    }
    return raw.clamp(0, _subtotal);
  }

  int get _taxAmount {
    final taxable = (_subtotal - _discountAmount).clamp(0, _subtotal);
    return (taxable * _taxPercent) ~/ 100;
  }

  int get _totalAmount => (_subtotal - _discountAmount + _taxAmount).clamp(0, 1 << 60);

  int get _paidAmount {
    if (_paymentMethod != 'cash') return _totalAmount;
    final typed = parseRupiahInput(_cashPaidCtrl.text);
    if (typed == null || _cashPaidCtrl.text.trim().isEmpty) return _totalAmount;
    return typed;
  }

  int get _changeAmount => (_paidAmount - _totalAmount).clamp(0, 1 << 60);

  Future<void> _submit() async {
    if (_submitting || widget.cart.isEmpty) return;
    if (_totalAmount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Total pembayaran harus lebih besar dari Rp 0.')),
      );
      return;
    }
    if (_paymentMethod == 'cash' && _paidAmount < _totalAmount) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nominal tunai kurang dari total belanja.')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final rawDisc = int.tryParse(_discountCtrl.text.trim()) ?? 0;
      final res = await ref.read(apiClientProvider).createPosSale({
        if (widget.warehouseId != null && widget.warehouseId!.isNotEmpty)
          'warehouse_id': widget.warehouseId,
        'account_id': _accountId,
        if (_customerCtrl.text.trim().isNotEmpty) 'customer_name': _customerCtrl.text.trim(),
        'payment_method': _paymentMethod,
        'discount_type': _discountType,
        'discount_value': _discountType == 'none' ? 0 : rawDisc,
        'tax_percent': _taxPercent,
        'paid_amount': _paidAmount,
        if (_noteCtrl.text.trim().isNotEmpty) 'note': _noteCtrl.text.trim(),
        'items': widget.cart
            .map(
              (c) => {
                if (c.inventoryItemId != null) 'inventory_item_id': c.inventoryItemId,
                if (c.sku != null) 'sku': c.sku,
                'item_name': c.itemName,
                'unit': c.unit,
                'qty': c.qty,
                'unit_price': c.unitPrice,
              },
            )
            .toList(growable: false),
      });
      if (mounted) Navigator.of(context).pop(res);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return ErpBottomSheetFrame(
      title: 'Checkout Kasir',
      subtitle: '${widget.cart.fold<int>(0, (s, c) => s + c.qty)} item · ${formatRupiah(_totalAmount)}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in widget.cart)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.itemName, style: Theme.of(context).textTheme.labelLarge),
                        Text(
                          '${formatRupiah(item.unitPrice)} / ${item.unit}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline, size: 20),
                    onPressed: _submitting
                        ? null
                        : () {
                            widget.onQtyChanged(item.key, item.qty - 1);
                            setState(() {});
                          },
                  ),
                  Text('${item.qty}', style: Theme.of(context).textTheme.titleSmall),
                  IconButton(
                    icon: const Icon(Icons.add_circle_outline, size: 20),
                    onPressed: _submitting
                        ? null
                        : () {
                            widget.onQtyChanged(item.key, item.qty + 1);
                            setState(() {});
                          },
                  ),
                ],
              ),
            ),
          Divider(color: t.border),
          const SizedBox(height: 8),
          TextField(
            controller: _customerCtrl,
            decoration: const InputDecoration(labelText: 'Nama Pelanggan (Opsional)'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  isExpanded: true,
                  value: _discountType,
                  decoration: const InputDecoration(labelText: 'Diskon'),
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('Tanpa', maxLines: 1, overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 'amount', child: Text('Rp', maxLines: 1, overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 'percent', child: Text('%', maxLines: 1, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => setState(() {
                    _discountType = v ?? 'none';
                    _discountCtrl.clear();
                  }),
                ),
              ),
              if (_discountType != 'none') ...[
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _discountCtrl,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: _discountType == 'percent' ? 'Diskon (%)' : 'Diskon (Rp)',
                    ),
                  ),
                ),
              ],
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<int>(
                  isExpanded: true,
                  value: _taxPercent,
                  decoration: const InputDecoration(labelText: 'PPN'),
                  items: const [
                    DropdownMenuItem(value: 0, child: Text('0%', maxLines: 1, overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 11, child: Text('11%', maxLines: 1, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => setState(() => _taxPercent = v ?? 0),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text('Metode Pembayaran', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final opt in [
                ('cash', 'Tunai'),
                ('qris', 'QRIS'),
                ('transfer', 'Transfer'),
                ('ewallet', 'E-Wallet'),
              ])
                ChoiceChip(
                  label: Text(opt.$2),
                  selected: _paymentMethod == opt.$1,
                  onSelected: (_) => setState(() {
                    _paymentMethod = opt.$1;
                    _accountId = _pickAccountForMethod(opt.$1);
                  }),
                ),
            ],
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            isExpanded: true,
            value: _accountId,
            decoration: const InputDecoration(labelText: 'Akun Kas Penerima'),
            items: [
              for (final raw in widget.accounts)
                DropdownMenuItem(
                  value: (raw as Map<String, dynamic>)['id'].toString(),
                  child: Text(
                    '${raw['name']} (${formatRupiah(raw['balance'])})',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _accountId = v);
            },
          ),
          if (_paymentMethod == 'cash') ...[
            const SizedBox(height: 10),
            TextField(
              controller: _cashPaidCtrl,
              keyboardType: TextInputType.number,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Uang Tunai Diterima (Default: Pas ${formatRupiah(_totalAmount)})',
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                ActionChip(
                  label: const Text('Uang Pas'),
                  onPressed: () => setState(() => _cashPaidCtrl.text = '$_totalAmount'),
                ),
                for (final amt in [50000, 100000])
                  ActionChip(
                    label: Text('${amt ~/ 1000}rb'),
                    onPressed: () => setState(() => _cashPaidCtrl.text = '$amt'),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Kembalian',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  formatRupiah(_changeAmount),
                  style: TextStyle(fontWeight: FontWeight.w700, color: t.accentHover),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          TextField(
            controller: _noteCtrl,
            decoration: const InputDecoration(labelText: 'Catatan (Opsional)'),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Total Tagihan',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatRupiah(_totalAmount),
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: t.accentHover,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.check_circle_outline),
            label: Text(_submitting ? 'Memproses...' : 'Bayar & Terbitkan Struk'),
          ),
        ],
      ),
    );
  }
}

class _PosReceiptSheet extends ConsumerStatefulWidget {
  final Map<String, dynamic> sale;
  final bool canVoid;

  const _PosReceiptSheet({required this.sale, required this.canVoid});

  @override
  ConsumerState<_PosReceiptSheet> createState() => _PosReceiptSheetState();
}

class _PosReceiptSheetState extends ConsumerState<_PosReceiptSheet> {
  bool _pdfBusy = false;
  bool _voidBusy = false;

  Future<void> _openPdf() async {
    setState(() => _pdfBusy = true);
    try {
      final res = await ref
          .read(apiClientProvider)
          .fetchPosReceiptPdf(widget.sale['id'].toString());
      final url = res['download_url']?.toString() ?? '';
      if (url.isNotEmpty) {
        final opened = await ref.read(appUpdateServiceProvider).openUpdateUrl(url);
        if (!opened && mounted) {
          await Clipboard.setData(ClipboardData(text: url));
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Tautan struk PDF disalin ke clipboard.')),
            );
          }
        }
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  Future<void> _copyReceiptText() async {
    final s = widget.sale;
    final items = (s['items'] as List<dynamic>?) ?? const [];
    final buf = StringBuffer()
      ..writeln('EKALLIPTUS DIGITAL - STRUK POS')
      ..writeln('No: ${s['sale_number']}')
      ..writeln('Waktu: ${formatShortDateTime(s['created_at']?.toString())}')
      ..writeln('Kasir: ${s['cashier_name']}');
    for (final raw in items) {
      final it = raw as Map<String, dynamic>;
      buf.writeln('${it['item_name']} (${it['qty']} ${it['unit']}) - ${formatRupiah(it['line_total'])}');
    }
    buf.writeln('TOTAL: ${formatRupiah(s['total_amount'])}');
    await Clipboard.setData(ClipboardData(text: buf.toString()));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Teks struk disalin ke clipboard.')),
      );
    }
  }

  Future<void> _confirmVoid() async {
    final confirm = await showErpConfirmDialog(
      context,
      title: 'Void / Retur ${widget.sale['sale_number']}?',
      message:
          'Saldo kas ${formatRupiah(widget.sale['total_amount'])} akan ditarik kembali dan stok gudang akan dipulihkan.',
      confirmLabel: 'Ya, Void',
      destructive: true,
    );
    if (!confirm || !mounted) return;
    setState(() => _voidBusy = true);
    try {
      await ref
          .read(apiClientProvider)
          .voidPosSale(widget.sale['id'].toString(), reason: 'Void / Retur Kasir Mobile');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Transaksi ${widget.sale['sale_number']} dibatalkan (void).')),
        );
        Navigator.of(context).pop(true);
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _voidBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final s = widget.sale;
    final items = (s['items'] as List<dynamic>?) ?? const [];
    final isVoid = s['status'] == 'void';

    return ErpBottomSheetFrame(
      title: 'Struk ${s['sale_number']}',
      subtitle: '${formatShortDateTime(s['created_at']?.toString())} · ${s['cashier_name']}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (isVoid) ...[
            const ErpBadge(label: 'TRANSAKSI VOID / DIBATALKAN', tone: ErpBadgeTone.danger),
            const SizedBox(height: 10),
          ],
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: t.surfaceSubtle,
              borderRadius: BorderRadius.circular(t.radiusMd),
              border: Border.all(color: t.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final raw in items)
                  Builder(
                    builder: (_) {
                      final it = raw as Map<String, dynamic>;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                '${it['item_name']} (${it['qty']} ${it['unit']})',
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                            ),
                            Text(
                              formatRupiah(it['line_total']),
                              style: Theme.of(context).textTheme.labelLarge,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                Divider(color: t.border),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Subtotal'),
                    Text(formatRupiah(s['subtotal'])),
                  ],
                ),
                if ((int.tryParse((s['discount_amount'] ?? '0').toString()) ?? 0) > 0)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Diskon'),
                      Text('-${formatRupiah(s['discount_amount'])}'),
                    ],
                  ),
                if ((int.tryParse((s['tax_amount'] ?? '0').toString()) ?? 0) > 0)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('PPN (${s['tax_percent']}%)'),
                      Text(formatRupiah(s['tax_amount'])),
                    ],
                  ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('TOTAL', style: Theme.of(context).textTheme.titleMedium),
                    Text(
                      formatRupiah(s['total_amount']),
                      style: TextStyle(fontWeight: FontWeight.w700, color: t.accentHover),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Dibayar'),
                    Text(formatRupiah(s['paid_amount'])),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Kembalian'),
                    Text(formatRupiah(s['change_amount'])),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pdfBusy ? null : _openPdf,
                  icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                  label: Text(_pdfBusy ? 'Membuat...' : 'Struk PDF'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _copyReceiptText,
                  icon: const Icon(Icons.copy_outlined, size: 18),
                  label: const Text('Salin Struk'),
                ),
              ),
            ],
          ),
          if (widget.canVoid && !isVoid) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: t.danger,
                side: BorderSide(color: t.danger.withValues(alpha: 0.45)),
              ),
              onPressed: _voidBusy ? null : _confirmVoid,
              icon: const Icon(Icons.undo_rounded, size: 18),
              label: Text(_voidBusy ? 'Memproses...' : 'Void / Retur Transaksi'),
            ),
          ],
        ],
      ),
    );
  }
}
