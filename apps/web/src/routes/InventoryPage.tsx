import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeftRight, Boxes, PackagePlus, Plus, Truck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type InventoryItem,
  type InventoryStockRow,
  type MeResponse,
  type PurchaseOrderRow,
  type StockMovementRow,
} from '../lib/api.ts';
import { formatDateTimeId, formatRupiah } from '../lib/format.ts';

type InventoryTab = 'stocks' | 'catalog' | 'movements' | 'purchasing';

export function InventoryPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'inventory', 'view');
  const canCreate = hasPermission(me.permissions, 'inventory', 'create');
  const canApprove = hasPermission(me.permissions, 'inventory', 'approve');

  const [tab, setTab] = useState<InventoryTab>('stocks');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // SlideOvers
  const [itemDrawerOpen, setItemDrawerOpen] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [whDrawerOpen, setWhDrawerOpen] = useState(false);
  const [supDrawerOpen, setSupDrawerOpen] = useState(false);
  const [poDrawerOpen, setPoDrawerOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrderRow | null>(null);

  // Item form
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [itemName, setItemName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [minStock, setMinStock] = useState('5');
  const [itemImageKey, setItemImageKey] = useState<string | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);

  // Movement form
  const [moveItemId, setMoveItemId] = useState('');
  const [moveWhId, setMoveWhId] = useState('');
  const [moveTargetWhId, setMoveTargetWhId] = useState('');
  const [moveType, setMoveType] = useState<'in' | 'out' | 'adjustment' | 'transfer'>('in');
  const [moveQty, setMoveQty] = useState('');
  const [moveNote, setMoveNote] = useState('');

  // Warehouse form
  const [whName, setWhName] = useState('');
  const [whAddr, setWhAddr] = useState('');

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddr, setSupAddr] = useState('');

  // PO form
  const [poSupId, setPoSupId] = useState('');
  const [poWhId, setPoWhId] = useState('');
  const [poAmount, setPoAmount] = useState('');
  const [poNote, setPoNote] = useState('');

  // Receive PO form
  const [rcvItemId, setRcvItemId] = useState('');
  const [rcvQty, setRcvQty] = useState('');

  const warehousesQuery = useQuery({
    queryKey: ['inventory', 'warehouses'],
    queryFn: erpApi.inventory.warehouses,
    enabled: canView,
  });
  const itemsQuery = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: erpApi.inventory.items,
    enabled: canView,
  });
  const stocksQuery = useQuery({
    queryKey: ['inventory', 'stocks'],
    queryFn: erpApi.inventory.stocks,
    enabled: canView,
  });
  const movementsQuery = useQuery({
    queryKey: ['inventory', 'movements'],
    queryFn: erpApi.inventory.movements,
    enabled: canView,
  });
  const suppliersQuery = useQuery({
    queryKey: ['inventory', 'suppliers'],
    queryFn: erpApi.inventory.suppliers,
    enabled: canView,
  });
  const posQuery = useQuery({
    queryKey: ['inventory', 'purchase-orders'],
    queryFn: erpApi.inventory.purchaseOrders,
    enabled: canView,
  });

  const invalidateInv = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const createItemMut = useMutation({
    mutationFn: erpApi.inventory.createItem,
    onSuccess: async () => {
      await invalidateInv();
      setItemDrawerOpen(false);
      setSku('');
      setBarcode('');
      setItemName('');
      setCostPrice('');
      setSellPrice('');
      setItemImageKey(null);
      setFeedback({ kind: 'success', text: 'Item inventaris berhasil ditambahkan ke katalog.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createMoveMut = useMutation({
    mutationFn: erpApi.inventory.createMovement,
    onSuccess: async (res) => {
      await invalidateInv();
      setMoveDrawerOpen(false);
      setMoveQty('');
      setMoveNote('');
      setFeedback({
        kind: res.low_stock_alert ? 'error' : 'success',
        text: res.low_stock_alert
          ? `Mutasi tersimpan. Peringatan: stok gudang tersisa ${res.qty} (di bawah minimum).`
          : `Mutasi stok berhasil diproses. Stok terbaru: ${res.qty}.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createWhMut = useMutation({
    mutationFn: erpApi.inventory.createWarehouse,
    onSuccess: async () => {
      await invalidateInv();
      setWhDrawerOpen(false);
      setWhName('');
      setWhAddr('');
      setFeedback({ kind: 'success', text: 'Gudang baru berhasil dibuat.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createSupMut = useMutation({
    mutationFn: erpApi.inventory.createSupplier,
    onSuccess: async () => {
      await invalidateInv();
      setSupDrawerOpen(false);
      setSupName('');
      setSupEmail('');
      setSupPhone('');
      setSupAddr('');
      setFeedback({ kind: 'success', text: 'Supplier baru berhasil didaftarkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createPoMut = useMutation({
    mutationFn: erpApi.inventory.createPurchaseOrder,
    onSuccess: async (res) => {
      await invalidateInv();
      setPoDrawerOpen(false);
      setPoAmount('');
      setPoNote('');
      setFeedback({
        kind: 'success',
        text: `Purchase Order ${res.purchase_order.po_number} berhasil dibuat.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const receivePoMut = useMutation({
    mutationFn: (vars: { id: string; itemId: string; qty: number }) =>
      erpApi.inventory.receivePurchaseOrder(vars.id, [{ item_id: vars.itemId, qty: vars.qty }]),
    onSuccess: async (res) => {
      await invalidateInv();
      setReceiveTarget(null);
      setRcvQty('');
      setFeedback({
        kind: 'success',
        text: `PO ${res.purchase_order.po_number} diterima dan stok gudang diperbarui atomik.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const warehouses = warehousesQuery.data?.warehouses ?? [];
  const items = itemsQuery.data?.items ?? [];
  const stocks = stocksQuery.data?.stocks ?? [];
  const movements = movementsQuery.data?.movements ?? [];
  const suppliers = suppliersQuery.data?.suppliers ?? [];
  const pos = posQuery.data?.purchase_orders ?? [];

  const filteredStocks = useMemo(() => {
    if (warehouseFilter === 'all') return stocks;
    return stocks.filter((s) => s.warehouse_id === warehouseFilter);
  }, [stocks, warehouseFilter]);

  const lowStockCount = stocks.filter((s) => s.is_low_stock).length;

  const stockColumns = useMemo<Array<ColumnDef<InventoryStockRow, any>>>(
    () => [
      { accessorKey: 'sku', header: 'SKU' },
      {
        accessorKey: 'name',
        header: 'Nama Barang',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-text-primary">{row.original.name}</p>
            <p className="text-xs text-text-secondary">{row.original.warehouse_name}</p>
          </div>
        ),
      },
      {
        accessorKey: 'qty',
        header: 'Stok',
        cell: ({ row }) => (
          <span className="font-bold tabular-nums text-text-primary">
            {row.original.qty} {row.original.unit}
          </span>
        ),
      },
      {
        accessorKey: 'min_stock',
        header: 'Min',
        cell: ({ row }) => <span className="tabular-nums">{row.original.min_stock}</span>,
      },
      {
        accessorKey: 'sell_price',
        header: 'Harga Jual',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatRupiah(row.original.sell_price)}</span>
        ),
      },
      {
        accessorKey: 'is_low_stock',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_low_stock ? (
            <StatusBadge tone="danger" label="Stok Kritis" />
          ) : (
            <StatusBadge tone="success" label="Aman" />
          ),
      },
    ],
    [],
  );

  const catalogColumns = useMemo<Array<ColumnDef<InventoryItem, any>>>(
    () => [
      { accessorKey: 'sku', header: 'SKU' },
      { accessorKey: 'name', header: 'Produk' },
      { accessorKey: 'unit', header: 'Satuan' },
      {
        accessorKey: 'cost_price',
        header: 'HPP',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatRupiah(row.original.cost_price)}</span>
        ),
      },
      {
        accessorKey: 'sell_price',
        header: 'Harga Jual',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatRupiah(row.original.sell_price)}</span>
        ),
      },
      {
        accessorKey: 'min_stock',
        header: 'Min Stok',
        cell: ({ row }) => <span className="tabular-nums">{row.original.min_stock}</span>,
      },
    ],
    [],
  );

  const movementColumns = useMemo<Array<ColumnDef<StockMovementRow, any>>>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Waktu',
        cell: ({ row }) => (
          <span className="text-xs text-text-secondary">
            {formatDateTimeId(row.original.created_at)}
          </span>
        ),
      },
      { accessorKey: 'sku', header: 'SKU' },
      { accessorKey: 'item_name', header: 'Barang' },
      { accessorKey: 'warehouse_name', header: 'Gudang' },
      {
        accessorKey: 'movement_type',
        header: 'Tipe',
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.qty_delta >= 0 ? 'success' : 'warning'}
            label={row.original.movement_type.toUpperCase()}
          />
        ),
      },
      {
        accessorKey: 'qty_delta',
        header: 'Delta',
        cell: ({ row }) => (
          <span className="font-bold tabular-nums">
            {row.original.qty_delta > 0 ? `+${row.original.qty_delta}` : row.original.qty_delta}
          </span>
        ),
      },
      { accessorKey: 'note', header: 'Catatan' },
    ],
    [],
  );

  if (!canView) {
    return (
      <EmptyState
        title="Akses Inventaris Ditolak"
        description="Role Anda tidak memiliki izin inventory:view."
      />
    );
  }

  function openMoveDrawer() {
    setMoveItemId(items[0]?.id ?? '');
    setMoveWhId(warehouses[0]?.id ?? '');
    setMoveTargetWhId(warehouses[1]?.id ?? '');
    setMoveDrawerOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Inventaris & Supply Chain
          </h2>
          <p className="text-xs text-text-secondary">
            Katalog SKU/Barcode, mutasi stok multi-gudang ACID, HPP, supplier, dan Purchase Order
          </p>
        </div>

        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openMoveDrawer}
              disabled={items.length === 0 || warehouses.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle disabled:opacity-50"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              Mutasi Stok
            </button>
            <button
              type="button"
              onClick={() => setItemDrawerOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
            >
              <PackagePlus className="h-4 w-4" aria-hidden="true" />
              Tambah Barang
            </button>
          </div>
        ) : null}
      </div>

      {lowStockCount > 0 ? (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-[#FDE68A] bg-warning-soft px-4 py-3 text-xs font-medium text-[#78350F] dark:border-[#78350F] dark:text-[#FCD34D]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Perhatian: terdapat <strong>{lowStockCount}</strong> baris stok gudang pada atau di bawah
            batas minimum.
          </span>
        </div>
      ) : null}

      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between rounded-md border px-3.5 py-2.5 text-xs font-medium ${
            feedback.kind === 'error'
              ? 'border-[#FECACA] bg-danger-soft text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]'
              : 'border-[#BBF7D0] bg-success-soft text-[#14532D] dark:border-[#14532D] dark:text-[#86EFAC]'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="ml-4 underline">
            Tutup
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Submodul inventaris"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {(
          [
            ['stocks', 'Stok Gudang'],
            ['catalog', 'Katalog Barang'],
            ['movements', 'Riwayat Mutasi'],
            ['purchasing', 'Gudang, Supplier & PO'],
          ] as Array<[InventoryTab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              tab === k
                ? 'bg-accent text-on-accent'
                : 'bg-surface-subtle text-text-primary hover:bg-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stocks' ? (
        stocksQuery.isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Memuat stok gudang..." />
        ) : stocksQuery.isError ? (
          <ErrorState
            message={(stocksQuery.error as Error).message}
            onRetry={() => void stocksQuery.refetch()}
          />
        ) : (
          <DataTable
            data={filteredStocks}
            columns={stockColumns}
            searchPlaceholder="Cari SKU atau nama barang..."
            filterLabel="Gudang"
            filterValue={warehouseFilter}
            onFilterChange={setWarehouseFilter}
            filterOptions={[
              { value: 'all', label: 'Semua Gudang' },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
            exportConfig={{
              filename: 'stok-gudang-myekalliptus.csv',
              headers: ['SKU', 'Nama', 'Gudang', 'Qty', 'Satuan', 'MinStok', 'HargaJual'],
              mapRow: (s) => [s.sku, s.name, s.warehouse_name, s.qty, s.unit, s.min_stock, s.sell_price],
            }}
            emptySlot={
              <EmptyState
                title="Belum ada stok tercatat di gudang"
                description="Tambahkan barang ke katalog lalu catat mutasi stok masuk agar inventaris mulai terpantau."
                actionLabel={
                  canCreate && items.length > 0
                    ? 'Catat Stok Masuk'
                    : canCreate
                      ? 'Tambah Barang Pertama'
                      : undefined
                }
                onAction={
                  canCreate && items.length > 0
                    ? openMoveDrawer
                    : canCreate
                      ? () => setItemDrawerOpen(true)
                      : undefined
                }
              />
            }
          />
        )
      ) : null}

      {tab === 'catalog' ? (
        itemsQuery.isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Memuat katalog produk..." />
        ) : (
          <DataTable
            data={items}
            columns={catalogColumns}
            searchPlaceholder="Cari SKU, barcode, atau produk..."
            emptySlot={
              <EmptyState
                title="Katalog barang masih kosong"
                description="Tambahkan master produk atau bahan baku dengan harga HPP dan minimum stok."
                actionLabel={canCreate ? 'Tambah Barang' : undefined}
                onAction={canCreate ? () => setItemDrawerOpen(true) : undefined}
              />
            }
          />
        )
      ) : null}

      {tab === 'movements' ? (
        movementsQuery.isLoading ? (
          <TableSkeleton columns={5} rows={5} label="Memuat histori mutasi stok..." />
        ) : (
          <DataTable
            data={movements}
            columns={movementColumns}
            searchPlaceholder="Cari barang, gudang, catatan..."
            emptySlot={
              <EmptyState
                title="Belum ada mutasi stok"
                description="Catat pergerakan barang masuk, keluar, penyesuaian, atau transfer antar gudang."
              />
            }
          />
        )
      ) : null}

      {tab === 'purchasing' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-text-primary">
                  Daftar Gudang
                </h3>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setWhDrawerOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
                    Tambah Gudang
                  </button>
                ) : null}
              </div>
              <ul className="divide-y divide-border text-sm">
                {warehouses.map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-semibold text-text-primary">{w.name}</p>
                      <p className="text-xs text-text-secondary">{w.address || 'Alamat belum diisi'}</p>
                    </div>
                    {w.is_default ? <StatusBadge tone="accent" label="Default" /> : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-text-primary">
                  Direktori Supplier
                </h3>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setSupDrawerOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Tambah Supplier
                  </button>
                ) : null}
              </div>
              {suppliers.length === 0 ? (
                <p className="text-xs text-text-secondary">Belum ada data supplier terdaftar.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {suppliers.map((s) => (
                    <li key={s.id} className="py-2">
                      <p className="font-semibold text-text-primary">{s.name}</p>
                      <p className="text-xs text-text-secondary">
                        {[s.phone, s.email, s.address].filter(Boolean).join(' | ') || '-'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-text-primary">Purchase Orders</h3>
              {canCreate ? (
                <button
                  type="button"
                  disabled={suppliers.length === 0 || warehouses.length === 0}
                  onClick={() => {
                    setPoSupId(suppliers[0]?.id ?? '');
                    setPoWhId(warehouses[0]?.id ?? '');
                    setPoDrawerOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
                >
                  <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                  Buat PO Baru
                </button>
              ) : null}
            </div>

            {pos.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Belum ada Purchase Order. Tambahkan minimal 1 supplier lalu buat PO pembelian barang.
              </p>
            ) : (
              <div className="space-y-2">
                {pos.map((po) => (
                  <div
                    key={po.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3.5 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-semibold text-text-primary">
                        {po.po_number} - {po.supplier_name}
                      </p>
                      <p className="text-xs text-text-secondary">
                        Tujuan: {po.warehouse_name} | Total: {formatRupiah(po.total_amount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        tone={po.status === 'received' ? 'success' : 'warning'}
                        label={po.status.toUpperCase()}
                      />
                      {canApprove && po.status === 'ordered' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setReceiveTarget(po);
                            setRcvItemId(items[0]?.id ?? '');
                            setRcvQty('10');
                          }}
                          className="rounded border border-border-strong bg-surface-subtle px-2.5 py-1 text-xs font-semibold"
                        >
                          Terima Barang
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* SlideOver: Tambah Barang */}
      <SlideOver
        open={itemDrawerOpen}
        onClose={() => setItemDrawerOpen(false)}
        title="Tambah Barang Baru"
      >
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createItemMut.mutate({
              sku: sku.trim(),
              barcode: barcode.trim() || null,
              name: itemName.trim(),
              unit: unit.trim() || 'pcs',
              cost_price: Math.max(0, Math.trunc(Number(costPrice) || 0)),
              sell_price: Math.max(0, Math.trunc(Number(sellPrice) || 0)),
              min_stock: Math.max(0, Math.trunc(Number(minStock) || 0)),
              image_object_key: itemImageKey,
            });
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="item-sku" className="block text-xs font-semibold">
                Kode SKU
              </label>
              <input
                id="item-sku"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="item-bc" className="block text-xs font-semibold">
                Barcode (Opsional)
              </label>
              <input
                id="item-bc"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="item-name" className="block text-xs font-semibold">
              Nama Barang
            </label>
            <input
              id="item-name"
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="item-unit" className="block text-xs font-semibold">
                Satuan
              </label>
              <input
                id="item-unit"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="item-min" className="block text-xs font-semibold">
                Minimum Stok
              </label>
              <input
                id="item-min"
                type="number"
                min={0}
                required
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="item-cost" className="block text-xs font-semibold">
                Harga HPP (IDR)
              </label>
              <input
                id="item-cost"
                type="number"
                min={0}
                required
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="item-sell" className="block text-xs font-semibold">
                Harga Jual (IDR)
              </label>
              <input
                id="item-sell"
                type="number"
                min={0}
                required
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="item-img" className="block text-xs font-semibold">
              Foto Produk (Opsional)
            </label>
            <input
              id="item-img"
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploadingImg(true);
                try {
                  const key = await uploadFileViaPresign('product', file);
                  setItemImageKey(key);
                } catch (err) {
                  setFeedback({ kind: 'error', text: (err as Error).message });
                } finally {
                  setUploadingImg(false);
                }
              }}
              className="block w-full text-xs text-text-secondary"
            />
            {itemImageKey ? (
              <p className="text-xs text-success">Foto tersimpan: {itemImageKey}</p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={createItemMut.isPending || uploadingImg}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            {createItemMut.isPending ? 'Menyimpan...' : 'Simpan Barang'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Mutasi Stok */}
      <SlideOver
        open={moveDrawerOpen}
        onClose={() => setMoveDrawerOpen(false)}
        title="Catat Mutasi Stok Gudang"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMoveMut.mutate({
              item_id: moveItemId,
              warehouse_id: moveWhId,
              target_warehouse_id: moveType === 'transfer' ? moveTargetWhId || null : null,
              movement_type: moveType,
              qty: Math.trunc(Number(moveQty) || 0),
              note: moveNote.trim() || null,
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="mv-type" className="block text-xs font-semibold">
              Tipe Mutasi
            </label>
            <select
              id="mv-type"
              value={moveType}
              onChange={(e) =>
                setMoveType(e.target.value as 'in' | 'out' | 'adjustment' | 'transfer')
              }
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="in">Stok Masuk (IN)</option>
              <option value="out">Stok Keluar (OUT)</option>
              <option value="adjustment">Penyesuaian (+/-)</option>
              <option value="transfer">Transfer Antar Gudang</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="mv-item" className="block text-xs font-semibold">
              Barang
            </label>
            <select
              id="mv-item"
              value={moveItemId}
              onChange={(e) => setMoveItemId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.sku} - {it.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="mv-wh" className="block text-xs font-semibold">
              Gudang
            </label>
            <select
              id="mv-wh"
              value={moveWhId}
              onChange={(e) => setMoveWhId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {moveType === 'transfer' ? (
            <div className="space-y-1">
              <label htmlFor="mv-target-wh" className="block text-xs font-semibold">
                Gudang Tujuan
              </label>
              <select
                id="mv-target-wh"
                value={moveTargetWhId}
                onChange={(e) => setMoveTargetWhId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                {warehouses
                  .filter((w) => w.id !== moveWhId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="mv-qty" className="block text-xs font-semibold">
              Jumlah Unit
            </label>
            <input
              id="mv-qty"
              type="number"
              required
              value={moveQty}
              onChange={(e) => setMoveQty(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mv-note" className="block text-xs font-semibold">
              Catatan
            </label>
            <input
              id="mv-note"
              value={moveNote}
              onChange={(e) => setMoveNote(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createMoveMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createMoveMut.isPending ? 'Memproses...' : 'Eksekusi Mutasi'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Tambah Gudang */}
      <SlideOver
        open={whDrawerOpen}
        onClose={() => setWhDrawerOpen(false)}
        title="Tambah Gudang Baru"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createWhMut.mutate({ name: whName.trim(), address: whAddr.trim() || null });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="wh-name" className="block text-xs font-semibold">
              Nama Gudang
            </label>
            <input
              id="wh-name"
              required
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="wh-addr" className="block text-xs font-semibold">
              Alamat
            </label>
            <input
              id="wh-addr"
              value={whAddr}
              onChange={(e) => setWhAddr(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createWhMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createWhMut.isPending ? 'Menyimpan...' : 'Simpan Gudang'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Tambah Supplier */}
      <SlideOver
        open={supDrawerOpen}
        onClose={() => setSupDrawerOpen(false)}
        title="Tambah Supplier Baru"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createSupMut.mutate({
              name: supName.trim(),
              email: supEmail.trim() || null,
              phone: supPhone.trim() || null,
              address: supAddr.trim() || null,
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="sup-name" className="block text-xs font-semibold">
              Nama Supplier
            </label>
            <input
              id="sup-name"
              required
              value={supName}
              onChange={(e) => setSupName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-email" className="block text-xs font-semibold">
              Email
            </label>
            <input
              id="sup-email"
              type="email"
              value={supEmail}
              onChange={(e) => setSupEmail(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-phone" className="block text-xs font-semibold">
              Telepon
            </label>
            <input
              id="sup-phone"
              value={supPhone}
              onChange={(e) => setSupPhone(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-addr" className="block text-xs font-semibold">
              Alamat
            </label>
            <input
              id="sup-addr"
              value={supAddr}
              onChange={(e) => setSupAddr(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createSupMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createSupMut.isPending ? 'Menyimpan...' : 'Simpan Supplier'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Buat Purchase Order */}
      <SlideOver
        open={poDrawerOpen}
        onClose={() => setPoDrawerOpen(false)}
        title="Buat Purchase Order"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPoMut.mutate({
              supplier_id: poSupId,
              warehouse_id: poWhId,
              total_amount: Math.max(1, Math.trunc(Number(poAmount) || 0)),
              note: poNote.trim() || null,
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="po-sup" className="block text-xs font-semibold">
              Supplier
            </label>
            <select
              id="po-sup"
              value={poSupId}
              onChange={(e) => setPoSupId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="po-wh" className="block text-xs font-semibold">
              Gudang Tujuan
            </label>
            <select
              id="po-wh"
              value={poWhId}
              onChange={(e) => setPoWhId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="po-amt" className="block text-xs font-semibold">
              Nilai PO (IDR)
            </label>
            <input
              id="po-amt"
              type="number"
              min={1}
              required
              value={poAmount}
              onChange={(e) => setPoAmount(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="po-note" className="block text-xs font-semibold">
              Catatan PO
            </label>
            <input
              id="po-note"
              value={poNote}
              onChange={(e) => setPoNote(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createPoMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createPoMut.isPending ? 'Menyimpan...' : 'Terbitkan PO'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Terima PO */}
      <SlideOver
        open={Boolean(receiveTarget)}
        onClose={() => setReceiveTarget(null)}
        title={receiveTarget ? `Terima PO ${receiveTarget.po_number}` : 'Terima PO'}
      >
        {receiveTarget ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              receivePoMut.mutate({
                id: receiveTarget.id,
                itemId: rcvItemId,
                qty: Math.max(1, Math.trunc(Number(rcvQty) || 1)),
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label htmlFor="rcv-item" className="block text-xs font-semibold">
                Item yang Diterima ke {receiveTarget.warehouse_name}
              </label>
              <select
                id="rcv-item"
                value={rcvItemId}
                onChange={(e) => setRcvItemId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.sku} - {it.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="rcv-qty" className="block text-xs font-semibold">
                Jumlah Diterima
              </label>
              <input
                id="rcv-qty"
                type="number"
                min={1}
                required
                value={rcvQty}
                onChange={(e) => setRcvQty(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <button
              type="submit"
              disabled={receivePoMut.isPending || !rcvItemId}
              className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              {receivePoMut.isPending ? 'Memproses...' : 'Konfirmasi Penerimaan PO'}
            </button>
          </form>
        ) : null}
      </SlideOver>
    </div>
  );
}
