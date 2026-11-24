import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  Barcode,
  Camera,
  CheckCircle2,
  Download,
  Minus,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  ShoppingCart,
  Smartphone,
  Store,
  Trash2,
  TrendingUp,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  type FinanceAccount,
  type MeResponse,
  type PosCatalogProduct,
  type PosDiscountType,
  type PosPaymentMethod,
  type PosSaleRow,
} from '../lib/api.ts';
import { formatDateTimeId, formatRupiah } from '../lib/format.ts';

type PosTab = 'pos' | 'reports';

interface CartItem {
  key: string;
  inventory_item_id: string | null;
  sku: string | null;
  item_name: string;
  unit: string;
  unit_price: number;
  qty: number;
  max_stock: number | null;
}

const PAYMENT_OPTIONS: Array<{
  id: PosPaymentMethod;
  label: string;
  preferredTypes: FinanceAccount['type'][];
  icon: typeof Banknote;
}> = [
  { id: 'cash', label: 'Tunai', preferredTypes: ['cash'], icon: Banknote },
  { id: 'qris', label: 'QRIS', preferredTypes: ['qris', 'ewallet', 'bank'], icon: QrCode },
  { id: 'transfer', label: 'Transfer', preferredTypes: ['bank'], icon: Wallet },
  { id: 'ewallet', label: 'E-Wallet', preferredTypes: ['ewallet', 'qris'], icon: Smartphone },
];

function paymentMethodLabel(method: PosPaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'Tunai';
    case 'qris':
      return 'QRIS';
    case 'transfer':
      return 'Transfer Bank';
    case 'ewallet':
      return 'E-Wallet';
  }
}

function defaultAccountForMethod(
  accounts: FinanceAccount[],
  method: PosPaymentMethod,
): string {
  if (accounts.length === 0) return '';
  const spec = PAYMENT_OPTIONS.find((o) => o.id === method);
  if (spec) {
    for (const accType of spec.preferredTypes) {
      const hit = accounts.find((a) => a.is_active && a.type === accType);
      if (hit) return hit.id;
    }
  }
  return accounts.find((a) => a.is_active)?.id ?? accounts[0]!.id;
}

function PosBarcodeScannerModal({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const titleId = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [nativeSupport, setNativeSupport] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timerId: number | null = null;
    setErrorMsg(null);
    setManualCode('');

    const stopStream = () => {
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const BarcodeDetectorCtor = (
      window as unknown as {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    async function start() {
      if (!BarcodeDetectorCtor) {
        setNativeSupport(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg('Kamera browser tidak tersedia. Masukkan kode barcode secara manual.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => null);
        }
        const detector = new BarcodeDetectorCtor({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        });

        const loop = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            if (videoRef.current.readyState >= 2) {
              const hits = await detector.detect(videoRef.current);
              const val = hits[0]?.rawValue?.trim();
              if (val) {
                onDetected(val);
                onClose();
                return;
              }
            }
          } catch {
            // Abaikan frame yang gagal didekode
          }
          timerId = window.setTimeout(() => void loop(), 260);
        };
        timerId = window.setTimeout(() => void loop(), 300);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? `Kamera tidak dapat dibuka (${err.message}).`
              : 'Kamera gagal diakses.',
          );
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      stopStream();
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
              Scan Barcode / SKU Produk
            </h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              Arahkan kamera ke barcode atau masukkan kode SKU secara manual.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup scanner barcode"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {errorMsg ? (
          <div className="rounded-lg border border-[#FECACA] bg-danger-soft px-3 py-2 text-xs text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]">
            {errorMsg}
          </div>
        ) : nativeSupport ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
            Browser desktop ini belum mendukung API BarcodeDetector kamera. Gunakan scanner USB/Bluetooth langsung di kolom pencarian atau ketik kodenya di bawah.
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualCode.trim()) return;
            onDetected(manualCode.trim());
            onClose();
          }}
          className="flex items-center gap-2"
        >
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Ketik / scan barcode atau SKU..."
            className="h-9 flex-1 rounded-md border border-border-strong bg-surface px-3 text-sm"
            autoFocus
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            Tambah
          </button>
        </form>
      </div>
    </div>
  );
}

function PosReceiptModal({
  sale,
  onClose,
  onDownloadPdf,
  pdfBusy,
}: {
  sale: PosSaleRow | null;
  onClose: () => void;
  onDownloadPdf: (saleId: string) => Promise<void>;
  pdfBusy: boolean;
}) {
  const titleId = useId();
  if (!sale) return null;

  function handlePrint() {
    document.body.classList.add('ep-printing-receipt');
    const cleanup = () => {
      document.body.classList.remove('ep-printing-receipt');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-accent" aria-hidden="true" />
            <div>
              <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
                Struk Penjualan Digital
              </h3>
              <p className="font-mono text-xs text-text-secondary">{sale.sale_number}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup struk"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="pos-receipt-print space-y-3 rounded-lg border border-dashed border-border-strong bg-surface-subtle p-4 font-mono text-xs">
          <div className="text-center">
            <p className="font-display text-sm font-bold text-text-primary">EKALLIPTUS DIGITAL</p>
            <p className="text-[11px] text-text-secondary">STRUK KASIR RESMI (POS)</p>
            {sale.status === 'void' ? (
              <p className="mt-1 inline-block rounded bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-[#991B1B] dark:text-[#FCA5A5]">
                TRANSAKSI VOID / DIBATALKAN
              </p>
            ) : null}
          </div>

          <div className="space-y-1 border-t border-dashed border-border pt-2 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-text-secondary">No. Struk</span>
              <span className="font-semibold text-text-primary">{sale.sale_number}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-text-secondary">Waktu</span>
              <span className="text-text-primary">{formatDateTimeId(sale.created_at)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-text-secondary">Kasir</span>
              <span className="text-text-primary">{sale.cashier_name}</span>
            </div>
            {sale.customer_name ? (
              <div className="flex justify-between gap-2">
                <span className="text-text-secondary">Pelanggan</span>
                <span className="text-text-primary">{sale.customer_name}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <span className="text-text-secondary">Metode</span>
              <span className="text-text-primary">
                {paymentMethodLabel(sale.payment_method)} ({sale.account_name})
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t border-dashed border-border pt-2">
            {sale.items.map((item) => (
              <div key={item.id} className="space-y-0.5">
                <p className="font-semibold text-text-primary">{item.item_name}</p>
                <div className="flex justify-between text-[11px] text-text-secondary">
                  <span>
                    {item.qty} {item.unit} x {formatRupiah(item.unit_price)}
                  </span>
                  <span className="font-semibold text-text-primary">
                    {formatRupiah(item.line_total)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-dashed border-border pt-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-text-secondary">Subtotal</span>
              <span>{formatRupiah(sale.subtotal)}</span>
            </div>
            {BigInt(sale.discount_amount) > 0n ? (
              <div className="flex justify-between text-accent">
                <span>
                  Diskon
                  {sale.discount_type === 'percent' ? ` (${sale.discount_value}%)` : ''}
                </span>
                <span>-{formatRupiah(sale.discount_amount)}</span>
              </div>
            ) : null}
            {BigInt(sale.tax_amount) > 0n ? (
              <div className="flex justify-between">
                <span className="text-text-secondary">PPN ({sale.tax_percent}%)</span>
                <span>{formatRupiah(sale.tax_amount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-text-primary">
              <span>TOTAL</span>
              <span>{formatRupiah(sale.total_amount)}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-text-secondary">Dibayar</span>
              <span>{formatRupiah(sale.paid_amount)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-text-secondary">Kembalian</span>
              <span>{formatRupiah(sale.change_amount)}</span>
            </div>
          </div>

          {sale.note ? (
            <p className="border-t border-dashed border-border pt-2 text-[11px] text-text-secondary">
              Catatan: {sale.note}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Cetak Struk
          </button>
          <button
            type="button"
            disabled={pdfBusy}
            onClick={() => void onDownloadPdf(sale.id)}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {pdfBusy ? 'Membuat PDF...' : 'Unduh PDF'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}

export function FinancePage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'finance', 'view');
  const canCreate = hasPermission(me.permissions, 'finance', 'create');
  const canApprove = hasPermission(me.permissions, 'finance', 'approve');

  const [tab, setTab] = useState<PosTab>('pos');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Catalog & POS checkout state
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualDrawerOpen, setManualDrawerOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualUnit, setManualUnit] = useState('pcs');
  const [manualQty, setManualQty] = useState('1');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [discountType, setDiscountType] = useState<PosDiscountType>('none');
  const [discountInput, setDiscountInput] = useState('');
  const [taxPercent, setTaxPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [cashPaidInput, setCashPaidInput] = useState('');

  // Receipt & Void modals
  const [activeReceipt, setActiveReceipt] = useState<PosSaleRow | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [voidTarget, setVoidTarget] = useState<PosSaleRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const catalogQuery = useQuery({
    queryKey: ['finance', 'pos', 'catalog'],
    queryFn: erpApi.finance.posCatalog,
    enabled: canView,
  });

  const salesQuery = useQuery({
    queryKey: ['finance', 'pos', 'sales', statusFilter, methodFilter],
    queryFn: () =>
      erpApi.finance.posSales({
        status: statusFilter || undefined,
        payment_method: methodFilter || undefined,
      }),
    enabled: canView,
  });

  const warehouses = catalogQuery.data?.warehouses ?? [];
  const activeWarehouseId =
    selectedWarehouseId ||
    catalogQuery.data?.default_warehouse_id ||
    warehouses[0]?.id ||
    '';
  const accounts = catalogQuery.data?.accounts ?? [];
  const products = catalogQuery.data?.products ?? [];

  useEffect(() => {
    if (accounts.length > 0 && !accountId) {
      setAccountId(defaultAccountForMethod(accounts, paymentMethod));
    }
  }, [accounts, accountId, paymentMethod]);

  const invalidatePos = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);
  };

  const createSaleMut = useMutation({
    mutationFn: erpApi.finance.createPosSale,
    onSuccess: async (res) => {
      await invalidatePos();
      setCart([]);
      setCustomerName('');
      setSaleNote('');
      setDiscountType('none');
      setDiscountInput('');
      setTaxPercent(0);
      setCashPaidInput('');
      setActiveReceipt(res.sale);
      const alertInfo =
        res.low_stock_alerts.length > 0
          ? ` Peringatan stok menipis: ${res.low_stock_alerts.map((a) => `${a.name} (${a.qty})`).join(', ')}.`
          : '';
      setFeedback({
        kind: 'success',
        text: `Transaksi ${res.sale.sale_number} berhasil dicatat.${alertInfo}`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const voidSaleMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      erpApi.finance.voidPosSale(id, reason),
    onSuccess: async (res) => {
      await invalidatePos();
      setVoidTarget(null);
      setVoidReason('');
      setFeedback({
        kind: 'success',
        text: `Transaksi ${res.sale.sale_number} berhasil dibatalkan (void) dan stok/kas telah dikembalikan.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  function productStock(product: PosCatalogProduct): number {
    if (!activeWarehouseId) return product.total_stock;
    return product.stocks_by_warehouse[activeWarehouseId] ?? 0;
  }

  function addCatalogProduct(product: PosCatalogProduct) {
    const avail = productStock(product);
    if (avail <= 0) {
      setFeedback({ kind: 'error', text: `Stok ${product.name} di gudang terpilih habis.` });
      return;
    }
    const unitPrice = Number(product.sell_price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setFeedback({
        kind: 'error',
        text: `Harga jual ${product.name} belum diatur (> Rp 0) di Inventaris.`,
      });
      return;
    }

    setCart((prev) => {
      const idx = prev.findIndex((c) => c.inventory_item_id === product.id);
      if (idx >= 0) {
        const current = prev[idx]!;
        if (current.qty + 1 > avail) {
          setFeedback({
            kind: 'error',
            text: `Stok ${product.name} di gudang tersisa ${avail} ${product.unit}.`,
          });
          return prev;
        }
        return prev.map((c, i) => (i === idx ? { ...c, qty: c.qty + 1, max_stock: avail } : c));
      }
      return [
        ...prev,
        {
          key: `inv-${product.id}`,
          inventory_item_id: product.id,
          sku: product.sku,
          item_name: product.name,
          unit: product.unit,
          unit_price: unitPrice,
          qty: 1,
          max_stock: avail,
        },
      ];
    });
  }

  function handleBarcodeOrSearchSubmit(rawCode: string) {
    const q = rawCode.trim().toLowerCase();
    if (!q) return;
    const exactMatch = products.find(
      (p) => (p.barcode && p.barcode.toLowerCase() === q) || p.sku.toLowerCase() === q,
    );
    if (exactMatch) {
      addCatalogProduct(exactMatch);
      setSearchQuery('');
      return;
    }
    const partialMatches = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
    if (partialMatches.length === 1) {
      addCatalogProduct(partialMatches[0]!);
      setSearchQuery('');
    } else if (partialMatches.length === 0) {
      setFeedback({ kind: 'error', text: `Produk dengan kode/nama "${rawCode}" tidak ditemukan.` });
    }
  }

  function handleAddManualItem(e: FormEvent) {
    e.preventDefault();
    const price = Math.round(Number(manualPrice));
    const qty = Math.max(1, Math.round(Number(manualQty) || 1));
    if (!manualName.trim() || !Number.isFinite(price) || price <= 0) {
      setFeedback({ kind: 'error', text: 'Nama item dan harga jual (> 0) wajib diisi.' });
      return;
    }
    setCart((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        inventory_item_id: null,
        sku: null,
        item_name: manualName.trim(),
        unit: manualUnit.trim() || 'pcs',
        unit_price: price,
        qty,
        max_stock: null,
      },
    ]);
    setManualName('');
    setManualPrice('');
    setManualUnit('pcs');
    setManualQty('1');
    setManualDrawerOpen(false);
  }

  function updateCartQty(key: string, nextQty: number) {
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.key !== key) return [c];
        if (nextQty <= 0) return [];
        if (c.max_stock !== null && nextQty > c.max_stock) {
          setFeedback({
            kind: 'error',
            text: `Qty ${c.item_name} melebihi stok gudang (${c.max_stock} ${c.unit}).`,
          });
          return [c];
        }
        return [{ ...c, qty: nextQty }];
      }),
    );
  }

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }, [products, searchQuery]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((acc, c) => acc + c.unit_price * c.qty, 0);
    const rawDisc = Math.max(0, Math.round(Number(discountInput) || 0));
    let discountAmount = 0;
    if (discountType === 'percent') {
      const pct = Math.min(100, rawDisc);
      discountAmount = Math.floor((subtotal * pct) / 100);
    } else if (discountType === 'amount') {
      discountAmount = Math.min(subtotal, rawDisc);
    }
    const taxable = Math.max(0, subtotal - discountAmount);
    const taxAmount = Math.floor((taxable * Math.max(0, taxPercent)) / 100);
    const totalAmount = taxable + taxAmount;
    const cashPaid = Math.max(0, Math.round(Number(cashPaidInput) || 0));
    const paidAmount = paymentMethod === 'cash' ? (cashPaidInput ? cashPaid : totalAmount) : totalAmount;
    const changeAmount = Math.max(0, paidAmount - totalAmount);
    return {
      subtotal,
      rawDisc: discountType === 'percent' ? Math.min(100, rawDisc) : discountAmount,
      discountAmount,
      taxAmount,
      totalAmount,
      paidAmount,
      changeAmount,
      cashInsufficient: paymentMethod === 'cash' && cashPaidInput.trim() !== '' && cashPaid < totalAmount,
    };
  }, [cart, discountType, discountInput, taxPercent, paymentMethod, cashPaidInput]);

  async function handleCheckout() {
    if (!canCreate || cart.length === 0 || createSaleMut.isPending) return;
    if (!accountId) {
      setFeedback({ kind: 'error', text: 'Pilih akun kas/rekening penerima terlebih dahulu.' });
      return;
    }
    if (totals.totalAmount <= 0) {
      setFeedback({ kind: 'error', text: 'Total transaksi harus lebih dari Rp 0.' });
      return;
    }
    if (totals.cashInsufficient) {
      setFeedback({ kind: 'error', text: 'Uang tunai diterima kurang dari total tagihan.' });
      return;
    }
    setFeedback(null);
    await createSaleMut.mutateAsync({
      warehouse_id: activeWarehouseId || null,
      account_id: accountId,
      customer_name: customerName.trim() || null,
      payment_method: paymentMethod,
      discount_type: discountType,
      discount_value: discountType === 'none' ? 0 : totals.rawDisc,
      tax_percent: taxPercent,
      paid_amount: totals.paidAmount,
      note: saleNote.trim() || null,
      items: cart.map((c) => ({
        inventory_item_id: c.inventory_item_id,
        sku: c.sku,
        item_name: c.item_name,
        unit: c.unit,
        qty: c.qty,
        unit_price: c.unit_price,
      })),
    });
  }

  async function handleDownloadReceiptPdf(saleId: string) {
    setPdfLoading(true);
    try {
      const res = await erpApi.finance.posReceiptPdf(saleId);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    } finally {
      setPdfLoading(false);
    }
  }

  const report = salesQuery.data?.report;
  const salesList = useMemo(() => {
    const rows = salesQuery.data?.sales ?? [];
    const q = historySearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.sale_number.toLowerCase().includes(q) ||
        (s.customer_name && s.customer_name.toLowerCase().includes(q)) ||
        s.cashier_name.toLowerCase().includes(q),
    );
  }, [salesQuery.data?.sales, historySearch]);

  if (!canView) {
    return (
      <EmptyState
        title="Akses Kasir / POS Ditolak"
        description="Role akun Anda tidak memiliki izin finance:view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Kasir / Point of Sale (POS)
          </h2>
          <p className="text-xs text-text-secondary">
            Penjualan terhubung ke stok Inventaris dan masuk otomatis ke akun kas.
          </p>
        </div>

        <div role="tablist" aria-label="Mode kasir dan laporan" className="inline-flex rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pos'}
            onClick={() => setTab('pos')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${
              tab === 'pos'
                ? 'bg-accent text-on-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Store className="h-3.5 w-3.5" aria-hidden="true" />
            Mesin Kasir
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reports'}
            onClick={() => setTab('reports')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${
              tab === 'reports'
                ? 'bg-accent text-on-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            Laporan & Riwayat
          </button>
        </div>
      </div>

      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            feedback.kind === 'success'
              ? 'border-[#BBF7D0] bg-success-soft text-[#166534] dark:border-[#14532D] dark:text-[#4ADE80]'
              : 'border-[#FECACA] bg-danger-soft text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Tutup pesan"
            className="shrink-0 opacity-80 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {tab === 'pos' ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Katalog Produk & Scan Barcode */}
          <div className="space-y-4 xl:col-span-7">
            <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleBarcodeOrSearchSubmit(searchQuery);
                  }}
                  className="relative flex-1 min-w-[200px]"
                >
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                    aria-hidden="true"
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama produk, SKU, atau scan barcode lalu Enter..."
                    className="h-10 w-full rounded-lg border border-border-strong bg-surface-subtle pl-9 pr-3 text-sm text-text-primary"
                  />
                </form>

                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  <Camera className="h-4 w-4 text-accent" aria-hidden="true" />
                  <span>Scan Barcode</span>
                </button>

                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setManualDrawerOpen(true)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent"
                  >
                    <Plus className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span>Item Manual</span>
                  </button>
                ) : null}
              </div>

              {warehouses.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label htmlFor="pos-warehouse" className="font-semibold text-text-secondary">
                    Gudang / Outlet Stok:
                  </label>
                  <select
                    id="pos-warehouse"
                    value={activeWarehouseId}
                    onChange={(e) => {
                      setSelectedWarehouseId(e.target.value);
                      setCart((prev) => prev.filter((c) => c.inventory_item_id === null));
                    }}
                    className="h-8 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium text-text-primary"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.is_default ? ' (Utama)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </section>

            {catalogQuery.isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="ep-shimmer h-32 rounded-xl border border-border" />
                ))}
              </div>
            ) : catalogQuery.isError ? (
              <ErrorState
                message={(catalogQuery.error as Error).message}
                onRetry={() => void catalogQuery.refetch()}
              />
            ) : filteredProducts.length === 0 ? (
              <EmptyState
                title="Tidak ada produk ditemukan"
                description="Tambahkan item di modul Inventaris atau gunakan tombol Item Manual untuk menjual jasa/produk non-stok."
                actionLabel={canCreate ? 'Tambah Item Manual' : undefined}
                onAction={canCreate ? () => setManualDrawerOpen(true) : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((p) => {
                  const stock = productStock(p);
                  const outOfStock = stock <= 0;
                  const inCartQty =
                    cart.find((c) => c.inventory_item_id === p.id)?.qty ?? 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!canCreate || outOfStock}
                      onClick={() => addCatalogProduct(p)}
                      className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition-colors ${
                        outOfStock
                          ? 'border-border bg-surface-subtle opacity-60'
                          : inCartQty > 0
                            ? 'border-accent bg-accent-soft/40 hover:border-accent-hover'
                            : 'border-border bg-surface hover:border-accent'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-[11px] font-medium text-text-secondary">
                            {p.sku}
                          </span>
                          <StatusBadge
                            tone={
                              outOfStock
                                ? 'danger'
                                : stock <= p.min_stock
                                  ? 'warning'
                                  : 'success'
                            }
                            label={outOfStock ? 'Habis' : `${stock} ${p.unit}`}
                          />
                        </div>
                        <p className="line-clamp-2 text-sm font-semibold text-text-primary">
                          {p.name}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
                        <span className="font-mono text-sm font-bold text-[#115E59] dark:text-[#34D399]">
                          {formatRupiah(p.sell_price)}
                        </span>
                        {inCartQty > 0 ? (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold text-on-accent">
                            {inCartQty}x
                          </span>
                        ) : (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-subtle text-text-primary group-hover:bg-accent group-hover:text-on-accent">
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Keranjang & Checkout Panel */}
          <div className="xl:col-span-5">
            <section className="sticky top-20 space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-accent" aria-hidden="true" />
                  <h3 className="font-display text-sm font-bold text-text-primary">
                    Keranjang Belanja
                  </h3>
                  <StatusBadge
                    tone="accent"
                    label={`${cart.reduce((a, b) => a + b.qty, 0)} item`}
                  />
                </div>
                {cart.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-xs font-semibold text-[#991B1B] hover:underline dark:text-[#FCA5A5]"
                  >
                    Kosongkan
                  </button>
                ) : null}
              </div>

              {cart.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center">
                  <Barcode className="mx-auto h-7 w-7 text-text-secondary" aria-hidden="true" />
                  <p className="mt-2 text-xs font-semibold text-text-primary">
                    Keranjang masih kosong
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Pilih produk di sebelah kiri, scan barcode, atau tambah item manual.
                  </p>
                </div>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-text-primary">
                          {item.item_name}
                        </p>
                        <p className="font-mono text-[11px] text-text-secondary">
                          {formatRupiah(item.unit_price)} / {item.unit}
                          {item.inventory_item_id === null ? ' · Manual' : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Kurangi ${item.item_name}`}
                          onClick={() => updateCartQty(item.key, item.qty - 1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border-strong bg-surface text-text-primary"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <span className="w-7 text-center font-mono text-xs font-bold tabular-nums">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Tambah ${item.item_name}`}
                          onClick={() => updateCartQty(item.key, item.qty + 1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border-strong bg-surface text-text-primary"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Hapus ${item.item_name}`}
                          onClick={() => updateCartQty(item.key, 0)}
                          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded text-[#991B1B] hover:bg-danger-soft dark:text-[#FCA5A5]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="pos-customer" className="block text-[11px] font-semibold text-text-secondary">
                    Nama Pelanggan (Opsional)
                  </label>
                  <input
                    id="pos-customer"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Umum"
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="pos-note" className="block text-[11px] font-semibold text-text-secondary">
                    Catatan Struk (Opsional)
                  </label>
                  <input
                    id="pos-note"
                    value={saleNote}
                    onChange={(e) => setSaleNote(e.target.value)}
                    placeholder="Catatan kasir..."
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                  />
                </div>
              </div>

              {/* Diskon & PPN */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold text-text-secondary">
                    Diskon
                  </span>
                  <div className="flex items-center gap-1">
                    <select
                      aria-label="Tipe diskon"
                      value={discountType}
                      onChange={(e) => {
                        setDiscountType(e.target.value as PosDiscountType);
                        setDiscountInput('');
                      }}
                      className="h-9 rounded-md border border-border-strong bg-surface px-2 text-xs"
                    >
                      <option value="none">Tanpa</option>
                      <option value="amount">Rp</option>
                      <option value="percent">%</option>
                    </select>
                    {discountType !== 'none' ? (
                      <input
                        type="number"
                        min={0}
                        max={discountType === 'percent' ? 100 : undefined}
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value)}
                        placeholder={discountType === 'percent' ? '0-100' : 'Nominal'}
                        className="h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2.5 font-mono text-xs"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="pos-tax" className="block text-[11px] font-semibold text-text-secondary">
                    PPN / Pajak (%)
                  </label>
                  <select
                    id="pos-tax"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value))}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                  >
                    <option value={0}>0% (Tanpa PPN)</option>
                    <option value={11}>11% (PPN)</option>
                  </select>
                </div>
              </div>

              {/* Metode Pembayaran & Akun Kas */}
              <div className="space-y-2 border-t border-border pt-3">
                <span className="block text-[11px] font-semibold text-text-secondary">
                  Metode Pembayaran
                </span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {PAYMENT_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = paymentMethod === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(opt.id);
                          setAccountId(defaultAccountForMethod(accounts, opt.id));
                        }}
                        className={`flex h-9 items-center justify-center gap-1 rounded-md border text-xs font-semibold ${
                          active
                            ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                            : 'border-border-strong bg-surface-subtle text-text-primary'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1">
                  <label htmlFor="pos-account" className="block text-[11px] font-semibold text-text-secondary">
                    Masuk ke Akun Kas / Rekening
                  </label>
                  <select
                    id="pos-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.type.toUpperCase()}) · {formatRupiah(acc.balance)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Nominal Bayar Tunai & Kembalian */}
              {paymentMethod === 'cash' ? (
                <div className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="pos-cash-paid" className="text-[11px] font-semibold text-text-secondary">
                      Uang Tunai Diterima
                    </label>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setCashPaidInput(String(totals.totalAmount || ''))}
                        className="rounded border border-border-strong bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-primary hover:border-accent"
                      >
                        Pas
                      </button>
                      {[50000, 100000, 200000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setCashPaidInput(String(amt))}
                          className="rounded border border-border-strong bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-text-primary hover:border-accent"
                        >
                          {amt / 1000}rb
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    id="pos-cash-paid"
                    type="number"
                    min={0}
                    value={cashPaidInput}
                    onChange={(e) => setCashPaidInput(e.target.value)}
                    placeholder={totals.totalAmount > 0 ? String(totals.totalAmount) : 'Nominal tunai'}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 font-mono text-sm font-semibold"
                  />
                  {totals.cashInsufficient ? (
                    <p className="text-[11px] font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
                      Nominal kurang dari total tagihan.
                    </p>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary">Kembalian</span>
                      <span className="font-mono font-bold text-[#115E59] dark:text-[#34D399]">
                        {formatRupiah(totals.changeAmount)}
                      </span>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Ringkasan Total */}
              <div className="space-y-1.5 border-t border-border pt-3 text-xs">
                <div className="flex justify-between text-text-secondary">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatRupiah(totals.subtotal)}</span>
                </div>
                {totals.discountAmount > 0 ? (
                  <div className="flex justify-between text-[#115E59] dark:text-[#34D399]">
                    <span>Diskon</span>
                    <span className="font-mono">-{formatRupiah(totals.discountAmount)}</span>
                  </div>
                ) : null}
                {totals.taxAmount > 0 ? (
                  <div className="flex justify-between text-text-secondary">
                    <span>PPN ({taxPercent}%)</span>
                    <span className="font-mono">{formatRupiah(totals.taxAmount)}</span>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <span className="font-display text-sm font-bold text-text-primary">Total Bayar</span>
                  <span className="font-mono text-xl font-bold text-[#115E59] dark:text-[#34D399]">
                    {formatRupiah(totals.totalAmount)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={
                  !canCreate ||
                  cart.length === 0 ||
                  totals.totalAmount <= 0 ||
                  totals.cashInsufficient ||
                  createSaleMut.isPending
                }
                onClick={() => void handleCheckout()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {createSaleMut.isPending ? 'Memproses Penjualan...' : 'Bayar & Terbitkan Struk'}
              </button>
            </section>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI Cards Laporan Penjualan */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium text-text-secondary">Omzet Hari Ini</p>
              <p className="mt-1.5 font-mono text-xl font-bold text-text-primary tabular-nums">
                {formatRupiah(report?.today_revenue ?? '0')}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {report?.today_count ?? 0} transaksi selesai hari ini
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium text-text-secondary">Rata-Rata Belanja</p>
              <p className="mt-1.5 font-mono text-xl font-bold text-text-primary tabular-nums">
                {formatRupiah(report?.today_avg_ticket ?? '0')}
              </p>
              <p className="mt-1 text-xs text-text-secondary">Rata-rata nilai struk hari ini</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium text-text-secondary">Total Penjualan POS</p>
              <p className="mt-1.5 font-mono text-xl font-bold text-[#115E59] dark:text-[#34D399] tabular-nums">
                {formatRupiah(report?.period_revenue ?? '0')}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {report?.period_count ?? 0} transaksi selesai · Diskon {formatRupiah(report?.period_discount_total ?? '0')}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium text-text-secondary">Retur / Void</p>
              <p className="mt-1.5 font-mono text-xl font-bold text-text-primary tabular-nums">
                {report?.void_count ?? 0} transaksi
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                PPN terhimpun {formatRupiah(report?.period_tax_total ?? '0')}
              </p>
            </div>
          </section>

          {/* Breakdown Metode Pembayaran, Rekening & Produk Terlaris */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section className="rounded-xl border border-border bg-surface p-4 space-y-3 lg:col-span-7">
              <h3 className="font-display text-sm font-bold text-text-primary">
                Ringkasan Metode Bayar & Saldo Kas
              </h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {(['cash', 'qris', 'transfer', 'ewallet'] as PosPaymentMethod[]).map((m) => {
                  const row = report?.by_payment_method[m];
                  return (
                    <div
                      key={m}
                      className="rounded-lg border border-border bg-surface-subtle p-2.5"
                    >
                      <p className="text-[11px] font-semibold text-text-secondary">
                        {paymentMethodLabel(m)}
                      </p>
                      <p className="mt-1 font-mono text-xs font-bold text-text-primary">
                        {formatRupiah(row?.total ?? '0')}
                      </p>
                      <p className="text-[11px] text-text-secondary">{row?.count ?? 0}x</p>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {(report?.accounts ?? accounts).map((acc) => (
                  <span
                    key={acc.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs"
                  >
                    <span className="font-semibold text-text-primary">{acc.name}:</span>
                    <span className="font-mono font-bold text-[#115E59] dark:text-[#34D399]">
                      {formatRupiah(acc.balance)}
                    </span>
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-4 space-y-3 lg:col-span-5">
              <h3 className="font-display text-sm font-bold text-text-primary">
                Top Produk Terlaris
              </h3>
              {!report || report.top_products.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  Belum ada data penjualan produk POS.
                </p>
              ) : (
                <div className="space-y-2">
                  {report.top_products.map((tp, idx) => (
                    <div
                      key={`${tp.sku}-${tp.item_name}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text-primary">{tp.item_name}</p>
                        <p className="text-[11px] text-text-secondary">
                          {tp.qty_sold} {tp.unit} terjual
                        </p>
                      </div>
                      <span className="font-mono font-bold text-text-primary shrink-0">
                        {formatRupiah(tp.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Riwayat Penjualan Kasir */}
          <section className="rounded-xl border border-border bg-surface p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-sm font-bold text-text-primary">
                Riwayat Transaksi Kasir
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Cari no. struk / kasir / pelanggan..."
                  className="h-9 rounded-md border border-border-strong bg-surface px-3 text-xs"
                />
                <select
                  aria-label="Filter status POS"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                >
                  <option value="">Semua Status</option>
                  <option value="completed">Selesai</option>
                  <option value="void">Void / Retur</option>
                </select>
                <select
                  aria-label="Filter metode bayar POS"
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value)}
                  className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-xs"
                >
                  <option value="">Semua Metode</option>
                  <option value="cash">Tunai</option>
                  <option value="qris">QRIS</option>
                  <option value="transfer">Transfer</option>
                  <option value="ewallet">E-Wallet</option>
                </select>
              </div>
            </div>

            {salesQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="ep-shimmer h-14 rounded-lg border border-border" />
                ))}
              </div>
            ) : salesList.length === 0 ? (
              <EmptyState
                title="Belum ada transaksi kasir"
                description="Mulai penjualan pertama melalui tab Mesin Kasir."
                actionLabel="Buka Mesin Kasir"
                onAction={() => setTab('pos')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase text-text-secondary">
                      <th className="py-2 pr-3">No. Struk</th>
                      <th className="py-2 pr-3">Waktu</th>
                      <th className="py-2 pr-3">Kasir & Pelanggan</th>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Metode</th>
                      <th className="py-2 pr-3">Total</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {salesList.map((s) => (
                      <tr key={s.id} className="hover:bg-surface-subtle/60">
                        <td className="py-2.5 pr-3 font-mono font-semibold text-text-primary">
                          {s.sale_number}
                        </td>
                        <td className="py-2.5 pr-3 text-text-secondary tabular-nums">
                          {formatDateTimeId(s.created_at)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-text-primary">{s.cashier_name}</p>
                          <p className="text-[11px] text-text-secondary">
                            {s.customer_name || 'Pelanggan Umum'}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3 text-text-secondary">
                          {s.items.length} item ({s.items.reduce((a, b) => a + b.qty, 0)} qty)
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusBadge tone="neutral" label={paymentMethodLabel(s.payment_method)} />
                        </td>
                        <td className="py-2.5 pr-3 font-mono font-bold text-text-primary">
                          {formatRupiah(s.total_amount)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusBadge
                            tone={s.status === 'completed' ? 'success' : 'danger'}
                            label={s.status === 'completed' ? 'Selesai' : 'Void'}
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setActiveReceipt(s)}
                              className="inline-flex h-8 items-center gap-1 rounded border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text-primary hover:border-accent"
                            >
                              <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                              Struk
                            </button>
                            {canApprove && s.status === 'completed' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidTarget(s);
                                  setVoidReason('');
                                }}
                                className="inline-flex h-8 items-center gap-1 rounded border border-border-strong bg-surface px-2.5 text-xs font-semibold text-[#991B1B] hover:bg-danger-soft dark:text-[#FCA5A5]"
                              >
                                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Void
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* SlideOver: Tambah Item Manual Non-Stok */}
      <SlideOver
        open={manualDrawerOpen}
        onClose={() => setManualDrawerOpen(false)}
        title="Tambah Item / Jasa Manual"
        subtitle="Item manual masuk ke struk tanpa mengurangi stok gudang"
      >
        <form onSubmit={handleAddManualItem} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="pos-manual-name" className="block text-xs font-semibold">
              Nama Produk / Jasa
            </label>
            <input
              id="pos-manual-name"
              required
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Contoh: Ongkir Kurir / Jasa Pasang"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="pos-manual-price" className="block text-xs font-semibold">
                Harga Satuan (Rp)
              </label>
              <input
                id="pos-manual-price"
                type="number"
                min={1}
                required
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pos-manual-qty" className="block text-xs font-semibold">
                Qty
              </label>
              <input
                id="pos-manual-qty"
                type="number"
                min={1}
                required
                value={manualQty}
                onChange={(e) => setManualQty(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="pos-manual-unit" className="block text-xs font-semibold">
              Satuan
            </label>
            <input
              id="pos-manual-unit"
              value={manualUnit}
              onChange={(e) => setManualUnit(e.target.value)}
              placeholder="pcs / paket / jam"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-10 w-full rounded-lg bg-accent text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            Tambahkan ke Keranjang
          </button>
        </form>
      </SlideOver>

      <PosBarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleBarcodeOrSearchSubmit}
      />

      <PosReceiptModal
        sale={activeReceipt}
        onClose={() => setActiveReceipt(null)}
        onDownloadPdf={handleDownloadReceiptPdf}
        pdfBusy={pdfLoading}
      />

      {/* Modal Konfirmasi Void / Retur POS */}
      {voidTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            aria-hidden="true"
            onClick={() => setVoidTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-void-title"
            className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-[#991B1B] dark:text-[#FCA5A5]">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 id="pos-void-title" className="font-display text-base font-bold text-text-primary">
                  Void / Retur Transaksi {voidTarget.sale_number}?
                </h3>
                <p className="mt-1 text-xs text-text-secondary">
                  Saldo kas ({formatRupiah(voidTarget.total_amount)}) akan ditarik kembali dan stok produk gudang akan dipulihkan otomatis.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="pos-void-reason" className="block text-xs font-semibold">
                Alasan Retur / Void (Opsional)
              </label>
              <input
                id="pos-void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Contoh: Salah input metode bayar / barang dikembalikan"
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="h-9 rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={voidSaleMut.isPending}
                onClick={() =>
                  voidSaleMut.mutate({ id: voidTarget.id, reason: voidReason })
                }
                className="h-9 rounded-md bg-[#B91C1C] px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {voidSaleMut.isPending ? 'Memproses...' : 'Ya, Void & Kembalikan Stok'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
