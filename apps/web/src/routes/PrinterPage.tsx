import {
  hasPermission,
  PRINT_COLOR_MODES,
  PRINT_FITS,
  PRINT_ORIENTATIONS,
  PRINT_PAPER_SIZES,
  PRINT_QUALITIES,
  type PrintColorMode,
  type PrintFit,
  type PrintOrientation,
  type PrintPaperSize,
  type PrintQuality,
} from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  MessageSquare,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ModulePageSkeleton } from '../components/Skeleton.tsx';
import { QrCodeCanvas } from '../components/QrCodeCanvas.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type MeResponse,
  type PrintDeviceRow,
  type PrintJobRow,
  type PrintJobStatus,
  type PrintPricingRuleRow,
} from '../lib/api.ts';
import { formatDateTimeId, formatRupiah } from '../lib/format.ts';

type ActiveTab = 'queue' | 'pricing' | 'devices';
type StatusFilter = 'all' | 'pending_approval' | 'in_progress' | 'printed' | 'failed' | 'rejected';

const STATUS_META: Record<PrintJobStatus, { label: string; tone: BadgeTone }> = {
  pending_approval: { label: 'Menunggu Approval', tone: 'warning' },
  approved: { label: 'Disetujui', tone: 'info' },
  queued: { label: 'Dalam Antrean', tone: 'info' },
  printing: { label: 'Sedang Mencetak', tone: 'accent' },
  printed: { label: 'Selesai Cetak', tone: 'success' },
  rejected: { label: 'Ditolak', tone: 'danger' },
  failed: { label: 'Gagal', tone: 'danger' },
  cancelled: { label: 'Dibatalkan', tone: 'neutral' },
};

const SOURCE_LABELS: Record<PrintJobRow['source'], string> = {
  whatsapp: 'WhatsApp',
  manual_web: 'Manual Web',
  manual_mobile: 'Manual Mobile',
};

function parsePageRangeCountClient(
  pageRange: string,
  detectedPageCount: number,
): { pages: number; error: string | null } {
  const maxPages = Math.max(1, detectedPageCount);
  const trimmed = pageRange.trim();
  if (!trimmed) return { pages: maxPages, error: null };

  const unique = new Set<number>();
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (m) {
      const start = Number.parseInt(m[1], 10);
      const end = Number.parseInt(m[2], 10);
      if (start < 1 || end < start) {
        return { pages: maxPages, error: `Rentang "${part}" tidak valid.` };
      }
      if (end > maxPages) {
        return { pages: maxPages, error: `Halaman ${end} melebihi ${maxPages} hal.` };
      }
      for (let i = start; i <= end; i += 1) unique.add(i);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const n = Number.parseInt(part, 10);
      if (n < 1 || n > maxPages) {
        return { pages: maxPages, error: `Halaman ${n} di luar rentang 1-${maxPages}.` };
      }
      unique.add(n);
      continue;
    }
    return { pages: maxPages, error: `Format "${part}" tidak valid (contoh: 1-3,5).` };
  }
  return { pages: Math.max(1, unique.size), error: null };
}

function calcTotalBigInt(params: {
  pages: number;
  copies: number;
  pricePerPage: bigint;
  duplex: boolean;
  duplexDiscount: bigint;
  discount: bigint;
}): { unit: bigint; total: bigint } {
  const unit = params.duplex
    ? params.pricePerPage > params.duplexDiscount
      ? params.pricePerPage - params.duplexDiscount
      : 0n
    : params.pricePerPage;
  const gross = unit * BigInt(Math.max(1, params.pages)) * BigInt(Math.max(1, params.copies));
  const total = gross > params.discount ? gross - params.discount : 0n;
  return { unit, total };
}

function formatBytes(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function PrinterPage({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const baseId = useId();

  const canView = hasPermission(me.permissions, 'printer', 'view');
  const canCreate = hasPermission(me.permissions, 'printer', 'create');
  const canUpdate = hasPermission(me.permissions, 'printer', 'update');
  const canDelete = hasPermission(me.permissions, 'printer', 'delete');
  const canApprove = hasPermission(me.permissions, 'printer', 'approve');
  const canPairWhatsapp = canCreate || canUpdate;
  const canFinanceView = hasPermission(me.permissions, 'finance', 'view');
  const canFinancePost = hasPermission(me.permissions, 'finance', 'create') || canApprove;

  const [tab, setTab] = useState<ActiveTab>('queue');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<PrintDeviceRow | null>(null);
  const [waDeviceId, setWaDeviceId] = useState<string | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<PrintDeviceRow | null>(null);
  const [qrPanelExpanded, setQrPanelExpanded] = useState(true);
  const [linkCodeCopied, setLinkCodeCopied] = useState(false);
  const [revealedToken, setRevealedToken] = useState<{
    deviceName: string;
    token: string;
  } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  const devicesQuery = useQuery({
    queryKey: ['printer', 'devices'],
    queryFn: erpApi.printer.devices,
    enabled: canView,
    refetchInterval: (query) => {
      const list = query.state.data?.devices ?? [];
      const activePairingOrCmd = list.some(
        (d) => Boolean(d.pending_command) || (d.is_online && d.openwa_status === 'qr_required'),
      );
      return activePairingOrCmd ? 5_000 : 60_000;
    },
    refetchIntervalInBackground: false,
  });

  const pricingQuery = useQuery({
    queryKey: ['printer', 'pricing'],
    queryFn: erpApi.printer.pricing,
    enabled: canView,
  });

  const jobsQuery = useQuery({
    queryKey: ['printer', 'jobs', statusFilter, searchQuery],
    queryFn: () =>
      erpApi.printer.jobs({
        status: statusFilter,
        q: searchQuery,
        limit: 80,
      }),
    enabled: canView,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasInFlightJob = jobs.some(
        (j) => j.status === 'pending_approval' || j.status === 'queued' || j.status === 'printing',
      );
      return hasInFlightJob ? 15_000 : 60_000;
    },
    refetchIntervalInBackground: false,
  });

  const accountsQuery = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: erpApi.finance.accounts,
    enabled: canView && canFinanceView,
  });

  const jobDetailQuery = useQuery({
    queryKey: ['printer', 'job', selectedJobId],
    queryFn: () => erpApi.printer.jobDetail(selectedJobId!),
    enabled: canView && Boolean(selectedJobId),
  });

  const pricingMap = useMemo(() => {
    const map = new Map<string, PrintPricingRuleRow>();
    for (const rule of pricingQuery.data?.pricing_rules ?? []) {
      map.set(`${rule.paper_size}:${rule.color_mode}`, rule);
    }
    return map;
  }, [pricingQuery.data]);

  const primaryDevice = useMemo(() => {
    const list = devicesQuery.data?.devices ?? [];
    return list.find((d) => d.is_online) ?? list[0] ?? null;
  }, [devicesQuery.data]);

  const pairingDevice = useMemo(() => {
    const list = devicesQuery.data?.devices ?? [];
    return list.find((d) => d.is_online && d.openwa_status === 'qr_required') ?? null;
  }, [devicesQuery.data]);

  const invalidatePrinter = () => {
    void qc.invalidateQueries({ queryKey: ['printer'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const deleteDeviceMut = useMutation({
    mutationFn: (id: string) => erpApi.printer.deleteDevice(id),
    onSuccess: (_res, id) => {
      const targetName = deletingDevice?.device_name || 'Perangkat';
      setDeletingDevice(null);
      if (waDeviceId === id) setWaDeviceId(null);
      if (editingDevice?.id === id) setEditingDevice(null);
      setBannerNotice({ kind: 'success', text: `Perangkat "${targetName}" dihapus permanen.` });
      invalidatePrinter();
    },
    onError: (err) => {
      setBannerNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Gagal menghapus perangkat bridge.',
      });
    },
  });

  if (!canView) {
    return (
      <ErrorState message="Akun Anda belum memiliki izin printer:view untuk membuka Smart Printer." />
    );
  }

  if (jobsQuery.isLoading && !jobsQuery.data) {
    return <ModulePageSkeleton variant="printer" label="Memuat Smart Printer Command Center..." />;
  }

  if (jobsQuery.isError) {
    return (
      <ErrorState
        message={
          jobsQuery.error instanceof Error
            ? jobsQuery.error.message
            : 'Gagal memuat antrean Smart Printer.'
        }
        onRetry={() => void jobsQuery.refetch()}
      />
    );
  }

  const summary = jobsQuery.data?.summary ?? {
    pending_approval: 0,
    queued: 0,
    printing: 0,
    printed_today: 0,
    revenue_today: '0',
  };
  const jobs = jobsQuery.data?.jobs ?? [];
  const devices = devicesQuery.data?.devices ?? [];
  const pricingRules = pricingQuery.data?.pricing_rules ?? [];
  const accounts = (accountsQuery.data?.accounts ?? []).filter((a) => a.is_active);

  return (
    <div className="space-y-6">
      {/* Header & Device Status Strip */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-text-primary">
            Smart Printer Otomatis
          </h2>
          <p className="text-xs text-text-secondary">
            Antrean cetak WhatsApp &amp; manual untuk HP Smart Tank 583 dengan persetujuan
            operator dan pencatatan kas otomatis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Upload &amp; Cetak Manual</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={invalidatePrinter}
            className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* Live Printer + OpenWA Status Card */}
      <section className="rounded-xl border border-border bg-surface p-4">
        {primaryDevice ? (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-subtle text-text-primary">
                <Printer className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-bold text-text-primary">
                    {primaryDevice.device_name}
                  </span>
                  <StatusBadge
                    tone={primaryDevice.is_online ? 'success' : 'danger'}
                    label={
                      primaryDevice.is_online
                        ? `Bridge Online (${primaryDevice.printer_state})`
                        : 'Bridge Offline'
                    }
                  />
                  <StatusBadge
                    tone={
                      primaryDevice.openwa_status === 'connected'
                        ? 'success'
                        : primaryDevice.openwa_status === 'qr_required'
                          ? 'warning'
                          : 'neutral'
                    }
                    label={
                      primaryDevice.openwa_status === 'connected'
                        ? 'OpenWA Terhubung'
                        : primaryDevice.openwa_status === 'qr_required'
                          ? 'OpenWA Perlu Scan QR'
                          : 'OpenWA Terputus'
                    }
                  />
                  {primaryDevice.dry_run_mode ? (
                    <StatusBadge tone="info" label="Mode Uji (Dry-Run)" />
                  ) : null}
                  {canPairWhatsapp ? (
                    <button
                      type="button"
                      onClick={() => setWaDeviceId(primaryDevice.id)}
                      className="inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded-md border border-border-strong bg-canvas px-2.5 text-[11px] font-semibold text-text-primary hover:border-accent"
                    >
                      <MessageSquare className="h-3 w-3 text-accent" aria-hidden="true" />
                      <span>
                        {primaryDevice.openwa_status === 'connected'
                          ? 'Kelola WhatsApp'
                          : 'Sambungkan WhatsApp'}
                      </span>
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-text-secondary">
                  {primaryDevice.model} | Host:{' '}
                  <span className="font-mono">{primaryDevice.host || '-'}</span> | Heartbeat:{' '}
                  {primaryDevice.last_heartbeat_at
                    ? formatDateTimeId(primaryDevice.last_heartbeat_at)
                    : 'Belum pernah'}
                </p>
              </div>
            </div>

            {/* CMYK Ink Levels */}
            {primaryDevice.ink_levels && primaryDevice.ink_levels.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {primaryDevice.ink_levels.map((ink) => {
                  const pct = ink.level !== null ? Math.max(0, Math.min(100, ink.level)) : null;
                  return (
                    <div
                      key={ink.name}
                      className="min-w-[110px] rounded-lg border border-border bg-canvas px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold text-text-primary">
                        <span className="truncate">{ink.name}</span>
                        <span className="font-mono">{pct !== null ? `${pct}%` : 'n/a'}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct ?? 0}%`,
                            backgroundColor: ink.color || '#115E59',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-text-secondary">
                Level tinta CMYK akan tampil setelah bridge mengirim heartbeat.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-text-primary">
                Belum Ada Perangkat Bridge Terdaftar
              </p>
              <p className="text-xs text-text-secondary">
                Daftarkan laptop/PC toko yang terhubung Wi-Fi HP Smart Tank 583 untuk mendapatkan
                Agent Token.
              </p>
            </div>
            {canCreate ? (
              <button
                type="button"
                onClick={() => {
                  setTab('devices');
                  setDeviceModalOpen(true);
                }}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Daftar Perangkat Bridge</span>
              </button>
            ) : null}
          </div>
        )}

        {/* Web-only OpenWA Pairing QR Panel */}
        {canPairWhatsapp && pairingDevice ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-accent" aria-hidden="true" />
                <p className="text-xs font-semibold text-text-primary">
                  Tautkan WhatsApp Bridge ({pairingDevice.device_name})
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void devicesQuery.refetch()}
                  className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-canvas px-2.5 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Muat Ulang</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrPanelExpanded((prev) => !prev)}
                  className="min-h-[34px] cursor-pointer rounded-md border border-border-strong bg-canvas px-2.5 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  {qrPanelExpanded ? 'Sembunyikan QR' : 'Tampilkan QR WhatsApp'}
                </button>
              </div>
            </div>

            {qrPanelExpanded ? (
              <div className="mt-3 rounded-lg border border-border bg-canvas p-4">
                {pairingDevice.openwa_qr_code ? (
                  <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                    <QrCodeCanvas
                      value={pairingDevice.openwa_qr_code}
                      size={220}
                      label={`QR Code WhatsApp untuk ${pairingDevice.device_name}`}
                    />
                    <div className="space-y-2 text-xs text-text-secondary">
                      <p className="font-semibold text-text-primary">
                        Pindai QR ini langsung dari WhatsApp di ponsel toko
                      </p>
                      <ol className="list-decimal space-y-1 pl-4">
                        <li>Buka WhatsApp di HP toko, lalu pilih menu Perangkat Tertaut.</li>
                        <li>Ketuk Tautkan Perangkat dan arahkan kamera ke QR Code di samping.</li>
                        <li>
                          QR diperbarui otomatis tiap 3 detik dan panel ini tertutup otomatis
                          setelah status OpenWA Terhubung.
                        </li>
                      </ol>
                      {pairingDevice.openwa_qr_updated_at ? (
                        <p className="text-[11px] text-text-secondary">
                          Diperbarui: {formatDateTimeId(pairingDevice.openwa_qr_updated_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : pairingDevice.openwa_link_code ? (
                  <div className="space-y-2.5 text-xs text-text-secondary">
                    <p className="font-semibold text-text-primary">
                      Kode Pairing 8 Digit (Tautkan dengan Nomor Telepon)
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-lg border border-border bg-surface px-4 py-2 font-mono text-2xl font-bold tracking-widest text-text-primary">
                        {pairingDevice.openwa_link_code}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(pairingDevice.openwa_link_code ?? '');
                          setLinkCodeCopied(true);
                          setTimeout(() => setLinkCodeCopied(false), 2000);
                        }}
                        className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                      >
                        {linkCodeCopied ? (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        )}
                        <span>{linkCodeCopied ? 'Tersalin' : 'Salin Kode'}</span>
                      </button>
                    </div>
                    <p>
                      Buka WhatsApp di HP toko, pilih Perangkat Tertaut -&gt; Tautkan dengan nomor
                      telepon, lalu masukkan 8 digit kode di atas.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary">
                    Menunggu QR Code terbaru dari print-bridge lokal...
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-text-secondary">Menunggu Approval</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">
            {summary.pending_approval}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-text-secondary">Antre / Sedang Cetak</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">
            {summary.queued + summary.printing}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-text-secondary">Selesai Hari Ini</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">
            {summary.printed_today}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-text-secondary">Pendapatan Hari Ini</p>
          <p className="mt-1 font-mono text-xl font-bold text-text-primary">
            {formatRupiah(summary.revenue_today)}
          </p>
        </div>
      </div>

      {bannerNotice ? (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            bannerNotice.kind === 'success'
              ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534] dark:border-[#166534] dark:bg-[#052E16] dark:text-[#86EFAC]'
              : 'border-[#FCA5A5] bg-danger-soft text-[#991B1B] dark:border-[#991B1B] dark:text-[#FCA5A5]'
          }`}
        >
          <span>{bannerNotice.text}</span>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            className="cursor-pointer font-semibold underline"
          >
            Tutup
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3" role="tablist">
        {(
          [
            { id: 'queue', label: `Antrean Cetak (${jobs.length})` },
            { id: 'pricing', label: `Tarif Cetak (${pricingRules.length})` },
            { id: 'devices', label: `Perangkat & Bridge (${devices.length})` },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-[40px] cursor-pointer rounded-md border px-3.5 text-xs font-semibold transition-colors ${
              tab === item.id
                ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                : 'border-border bg-surface text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'pending_approval', label: 'Menunggu' },
                  { id: 'in_progress', label: 'Antre / Cetak' },
                  { id: 'printed', label: 'Selesai' },
                  { id: 'failed', label: 'Gagal' },
                  { id: 'rejected', label: 'Ditolak' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`min-h-[36px] cursor-pointer rounded-full border px-3 text-xs font-semibold ${
                    statusFilter === f.id
                      ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                      : 'border-border bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-secondary"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari kode, nama file, pelanggan..."
                aria-label="Cari pekerjaan cetak"
                className="h-10 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {jobs.length === 0 ? (
            <EmptyState
              title="Belum ada pekerjaan cetak"
              description="Dokumen dari WhatsApp pribadi atau upload manual akan muncul di sini untuk disetujui."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="border-b border-border bg-surface-subtle text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-3">Kode / Sumber</th>
                    <th className="px-4 py-3">Pelanggan</th>
                    <th className="px-4 py-3">Dokumen &amp; Opsi</th>
                    <th className="px-4 py-3 text-right">Biaya</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {jobs.map((job) => {
                    const meta = STATUS_META[job.status] ?? {
                      label: job.status,
                      tone: 'neutral' as BadgeTone,
                    };
                    return (
                      <tr key={job.id} className="hover:bg-surface-subtle/60">
                        <td className="px-4 py-3 align-top">
                          <p className="font-mono font-semibold text-text-primary">{job.job_code}</p>
                          <p className="mt-0.5 text-[11px] text-text-secondary">
                            {SOURCE_LABELS[job.source]} | {formatDateTimeId(job.created_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-text-primary">
                            {job.customer_name || 'Tanpa Nama'}
                          </p>
                          <p className="font-mono text-[11px] text-text-secondary">
                            {job.customer_phone || '-'}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="max-w-[260px] truncate font-medium text-text-primary">
                            {job.file_name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-text-secondary">
                            {job.pages_to_print} hal x {job.copies} | {job.paper_size.toUpperCase()}{' '}
                            | {job.color_mode === 'mono' ? 'Mono' : 'Warna'} |{' '}
                            {formatBytes(job.file_size_bytes)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <p className="font-mono font-semibold text-text-primary">
                            {formatRupiah(job.total_price)}
                          </p>
                          {job.finance_transaction_id ? (
                            <span className="mt-1 inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-[#14532D] dark:text-[#86EFAC]">
                              <Wallet className="h-3 w-3" aria-hidden="true" />
                              Masuk Kas
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <StatusBadge tone={meta.tone} label={meta.label} />
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <button
                            type="button"
                            onClick={() => setSelectedJobId(job.id)}
                            className="min-h-[34px] cursor-pointer rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent"
                          >
                            {job.status === 'pending_approval' ? 'Review & Cetak' : 'Detail'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'pricing' ? (
        <PricingMatrixSection
          rules={pricingRules}
          canUpdate={canUpdate}
          onSaved={(msg) => {
            setBannerNotice({ kind: 'success', text: msg });
            invalidatePrinter();
          }}
          onError={(err) => setBannerNotice({ kind: 'error', text: err })}
        />
      ) : null}

      {tab === 'devices' ? (
        <DevicesSection
          devices={devices}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onOpenRegister={() => setDeviceModalOpen(true)}
          onOpenWhatsapp={(dev) => setWaDeviceId(dev.id)}
          onEditDevice={(dev) => setEditingDevice(dev)}
          onDeleteDevice={(dev) => setDeletingDevice(dev)}
          onTokenRotated={(name, token) => {
            setTokenCopied(false);
            setRevealedToken({ deviceName: name, token });
            invalidatePrinter();
          }}
          onError={(err) => setBannerNotice({ kind: 'error', text: err })}
        />
      ) : null}

      {/* Detail & Approval SlideOver */}
      <SlideOver
        open={Boolean(selectedJobId)}
        onClose={() => setSelectedJobId(null)}
        title={
          jobDetailQuery.data?.job.job_code
            ? `Detail Cetak ${jobDetailQuery.data.job.job_code}`
            : 'Detail Pekerjaan Cetak'
        }
        subtitle={jobDetailQuery.data?.job.file_name}
      >
        {jobDetailQuery.isLoading ? (
          <ModulePageSkeleton variant="printer" label="Memuat detail dokumen..." />
        ) : jobDetailQuery.isError || !jobDetailQuery.data ? (
          <ErrorState
            message="Gagal memuat detail print job."
            onRetry={() => void jobDetailQuery.refetch()}
          />
        ) : (
          <JobDetailPanel
            key={jobDetailQuery.data.job.id + jobDetailQuery.data.job.updated_at}
            job={jobDetailQuery.data.job}
            downloadUrl={jobDetailQuery.data.download_url}
            pricingMap={pricingMap}
            accounts={accounts}
            devices={devices}
            canUpdate={canUpdate}
            canApprove={canApprove}
            canDelete={canDelete}
            canFinancePost={canFinancePost}
            onCompleted={(msg) => {
              setBannerNotice({ kind: 'success', text: msg });
              invalidatePrinter();
              void jobDetailQuery.refetch();
            }}
            onError={(err) => setBannerNotice({ kind: 'error', text: err })}
          />
        )}
      </SlideOver>

      {/* Manual Upload SlideOver */}
      <SlideOver
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Upload & Cetak Manual"
        subtitle="Unggah PDF atau gambar (maksimal 25 MB) langsung dari browser."
      >
        <ManualUploadForm
          baseId={baseId}
          pricingMap={pricingMap}
          accounts={accounts}
          canApprove={canApprove}
          onCreated={(job) => {
            setManualModalOpen(false);
            setBannerNotice({
              kind: 'success',
              text: `Job ${job.job_code} dibuat (${STATUS_META[job.status]?.label ?? job.status}).`,
            });
            invalidatePrinter();
            setSelectedJobId(job.id);
          }}
          onError={(err) => setBannerNotice({ kind: 'error', text: err })}
        />
      </SlideOver>

      {/* Register Bridge Device SlideOver */}
      <SlideOver
        open={deviceModalOpen}
        onClose={() => setDeviceModalOpen(false)}
        title="Daftar Perangkat Bridge Baru"
        subtitle="Hubungkan laptop/PC yang terpasang HP Smart Tank 583."
      >
        <RegisterDeviceForm
          onRegistered={(dev, token) => {
            setDeviceModalOpen(false);
            setTokenCopied(false);
            setRevealedToken({ deviceName: dev.device_name, token });
            invalidatePrinter();
          }}
          onError={(err) => setBannerNotice({ kind: 'error', text: err })}
        />
      </SlideOver>

      {/* Edit Bridge Device SlideOver */}
      <SlideOver
        open={Boolean(editingDevice)}
        onClose={() => setEditingDevice(null)}
        title={editingDevice ? `Edit ${editingDevice.device_name}` : 'Edit Perangkat Bridge'}
        subtitle="Ubah nama, IP printer Wi-Fi, mDNS, status aktif, atau mode uji tanpa kertas."
      >
        {editingDevice ? (
          <EditDeviceForm
            key={editingDevice.id}
            device={editingDevice}
            onSaved={(dev) => {
              setEditingDevice(null);
              setBannerNotice({
                kind: 'success',
                text: `Pengaturan perangkat "${dev.device_name}" diperbarui.`,
              });
              invalidatePrinter();
            }}
            onError={(err) => setBannerNotice({ kind: 'error', text: err })}
          />
        ) : null}
      </SlideOver>

      {/* Web-Only WhatsApp Control & QR SlideOver */}
      <SlideOver
        open={Boolean(waDeviceId)}
        onClose={() => setWaDeviceId(null)}
        title="Kelola Koneksi WhatsApp Bridge"
        subtitle="Pindai QR, pakai kode 8 digit, reset sesi, atau logout WhatsApp langsung dari web."
      >
        {waDeviceId ? (
          <WhatsappControlPanel
            device={devices.find((d) => d.id === waDeviceId) ?? null}
            onRefresh={() => void devicesQuery.refetch()}
            onQueued={(msg) => {
              setBannerNotice({ kind: 'success', text: msg });
              invalidatePrinter();
            }}
            onError={(err) => setBannerNotice({ kind: 'error', text: err })}
          />
        ) : null}
      </SlideOver>

      {/* Delete Device Confirmation Modal */}
      {deletingDevice ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => !deleteDeviceMut.isPending && setDeletingDevice(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Konfirmasi hapus perangkat bridge"
            className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border-strong bg-surface p-5 text-text-primary shadow-xl"
          >
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold">
                Hapus Perangkat "{deletingDevice.device_name}"?
              </h3>
              <p className="text-xs text-text-secondary">
                Token bridge perangkat ini akan dicabut permanen sehingga laptop/PC terkait tidak bisa
                lagi terhubung. Riwayat print job dan transaksi keuangan tetap aman tersimpan.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={deleteDeviceMut.isPending}
                onClick={() => setDeletingDevice(null)}
                className="min-h-[38px] cursor-pointer rounded-md border border-border-strong bg-surface px-3.5 text-xs font-semibold text-text-primary disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleteDeviceMut.isPending}
                onClick={() => deleteDeviceMut.mutate(deletingDevice.id)}
                className="min-h-[38px] cursor-pointer rounded-md bg-[#991B1B] px-3.5 text-xs font-semibold text-white hover:bg-[#7F1D1D] disabled:opacity-50"
              >
                {deleteDeviceMut.isPending ? 'Menghapus...' : 'Ya, Hapus Perangkat'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* One-time Token Modal */}
      {revealedToken ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setRevealedToken(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Agent Token Print Bridge"
            className="relative z-10 w-full max-w-lg space-y-4 rounded-xl border border-border-strong bg-surface p-5 text-text-primary shadow-xl"
          >
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold">
                Token Bridge: {revealedToken.deviceName}
              </h3>
              <p className="text-xs text-text-secondary">
                Simpan token ini ke <span className="font-mono">services/print-bridge/.env</span>{' '}
                pada variabel <span className="font-mono">PRINT_AGENT_TOKEN</span>. Token hanya
                ditampilkan satu kali.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-canvas p-3 font-mono text-xs break-all text-text-primary">
              {revealedToken.token}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(revealedToken.token);
                  setTokenCopied(true);
                }}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
              >
                {tokenCopied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{tokenCopied ? 'Tersalin' : 'Salin Token'}</span>
              </button>
              <button
                type="button"
                onClick={() => setRevealedToken(null)}
                className="min-h-[40px] cursor-pointer rounded-md border border-border-strong bg-surface px-3.5 text-xs font-semibold text-text-primary"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PricingMatrixSection({
  rules,
  canUpdate,
  onSaved,
  onError,
}: {
  rules: PrintPricingRuleRow[];
  canUpdate: boolean;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [drafts, setDrafts] = useState<
    Record<string, { price: string; duplex: string; active: boolean }>
  >({});

  useEffect(() => {
    const next: Record<string, { price: string; duplex: string; active: boolean }> = {};
    for (const r of rules) {
      next[`${r.paper_size}:${r.color_mode}`] = {
        price: r.price_per_page,
        duplex: r.duplex_discount_per_page,
        active: r.is_active,
      };
    }
    setDrafts(next);
  }, [rules]);

  const saveMut = useMutation({
    mutationFn: erpApi.printer.upsertPricing,
    onSuccess: (res) => {
      onSaved(
        `Tarif ${res.pricing_rule.paper_size.toUpperCase()} (${res.pricing_rule.color_mode}) diperbarui menjadi ${formatRupiah(res.pricing_rule.price_per_page)}.`,
      );
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : 'Gagal menyimpan tarif.');
    },
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[660px] text-left text-xs">
        <thead className="border-b border-border bg-surface-subtle text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-3">Kertas</th>
            <th className="px-4 py-3">Mode Warna</th>
            <th className="px-4 py-3">Harga / Halaman (Rp)</th>
            <th className="px-4 py-3">Diskon Bolak-Balik / Hal</th>
            <th className="px-4 py-3">Aktif</th>
            <th className="px-4 py-3 text-right">Simpan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rules.map((r) => {
            const key = `${r.paper_size}:${r.color_mode}`;
            const d = drafts[key] ?? {
              price: r.price_per_page,
              duplex: r.duplex_discount_per_page,
              active: r.is_active,
            };
            return (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-mono font-semibold text-text-primary">
                  {r.paper_size.toUpperCase()}
                </td>
                <td className="px-4 py-2.5 text-text-primary">
                  {r.color_mode === 'mono' ? 'Hitam Putih' : 'Warna'}
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={!canUpdate}
                    value={d.price}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [key]: { ...d, price: e.target.value.replace(/\D/g, '') },
                      }))
                    }
                    className="h-9 w-32 rounded-md border border-border bg-canvas px-2.5 font-mono text-xs text-text-primary"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={!canUpdate}
                    value={d.duplex}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [key]: { ...d, duplex: e.target.value.replace(/\D/g, '') },
                      }))
                    }
                    className="h-9 w-32 rounded-md border border-border bg-canvas px-2.5 font-mono text-xs text-text-primary"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    disabled={!canUpdate}
                    checked={d.active}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [key]: { ...d, active: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 accent-accent"
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canUpdate ? (
                    <button
                      type="button"
                      disabled={saveMut.isPending}
                      onClick={() =>
                        saveMut.mutate({
                          paper_size: r.paper_size,
                          color_mode: r.color_mode,
                          price_per_page: d.price || '0',
                          duplex_discount_per_page: d.duplex || '0',
                          is_active: d.active,
                        })
                      }
                      className="min-h-[34px] cursor-pointer rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent disabled:opacity-50"
                    >
                      Simpan
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DevicesSection({
  devices,
  canCreate,
  canUpdate,
  canDelete,
  onOpenRegister,
  onOpenWhatsapp,
  onEditDevice,
  onDeleteDevice,
  onTokenRotated,
  onError,
}: {
  devices: PrintDeviceRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onOpenRegister: () => void;
  onOpenWhatsapp: (dev: PrintDeviceRow) => void;
  onEditDevice: (dev: PrintDeviceRow) => void;
  onDeleteDevice: (dev: PrintDeviceRow) => void;
  onTokenRotated: (deviceName: string, token: string) => void;
  onError: (msg: string) => void;
}) {
  const rotateMut = useMutation({
    mutationFn: (id: string) => erpApi.printer.rotateDeviceToken(id),
    onSuccess: (res) => onTokenRotated(res.device.device_name, res.agent_token),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal memutar token.'),
  });

  const canPairWhatsapp = canCreate || canUpdate;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate ? (
          <button
            type="button"
            onClick={onOpenRegister}
            className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Tambah Perangkat Bridge</span>
          </button>
        ) : null}
      </div>

      {devices.length === 0 ? (
        <EmptyState
          title="Belum ada perangkat bridge"
          description="Tambahkan perangkat untuk menghubungkan HP Smart Tank 583 dan OpenWA."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {devices.map((dev) => (
            <div key={dev.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-sm font-bold text-text-primary">
                    {dev.device_name}
                  </p>
                  <p className="text-xs text-text-secondary">{dev.model}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {dev.dry_run_mode ? <StatusBadge tone="info" label="Dry-Run" /> : null}
                  {!dev.is_active ? <StatusBadge tone="neutral" label="Nonaktif" /> : null}
                  <StatusBadge
                    tone={dev.is_online ? 'success' : 'danger'}
                    label={dev.is_online ? 'Online' : 'Offline'}
                  />
                </div>
              </div>
              <div className="space-y-1 text-xs text-text-secondary">
                <p>
                  Host IP: <span className="font-mono text-text-primary">{dev.host || '-'}</span> | mDNS:{' '}
                  <span className="font-mono text-text-primary">{dev.mdns_host || '-'}</span>
                </p>
                <p>
                  Status Printer:{' '}
                  <span className="font-mono text-text-primary">{dev.printer_state}</span> | Mode:{' '}
                  <span className="font-semibold text-text-primary">
                    {dev.dry_run_mode ? 'Uji Tanpa Kertas' : 'Cetak Fisik'}
                  </span>
                </p>
                <p>
                  OpenWA:{' '}
                  <span className="font-mono text-text-primary">{dev.openwa_status}</span>
                  {dev.pending_command ? (
                    <span className="ml-2 text-accent">
                      (Perintah aktif: {dev.pending_command})
                    </span>
                  ) : null}
                </p>
                <p>
                  Heartbeat Terakhir:{' '}
                  {dev.last_heartbeat_at ? formatDateTimeId(dev.last_heartbeat_at) : 'Belum ada'}
                </p>
                {dev.last_command_result ? (
                  <p className="text-[11px] text-text-primary">
                    Info Bridge: {dev.last_command_result}
                  </p>
                ) : null}
              </div>
              {canPairWhatsapp || canUpdate || canDelete ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {canPairWhatsapp ? (
                    <button
                      type="button"
                      onClick={() => onOpenWhatsapp(dev)}
                      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                    >
                      {dev.openwa_status === 'qr_required' ? (
                        <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {dev.openwa_status === 'qr_required'
                          ? 'Scan QR WhatsApp'
                          : dev.openwa_status === 'connected'
                            ? 'Kelola WhatsApp'
                            : 'Sambungkan WhatsApp'}
                      </span>
                    </button>
                  ) : null}
                  {canUpdate ? (
                    <button
                      type="button"
                      onClick={() => onEditDevice(dev)}
                      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  ) : null}
                  {canUpdate ? (
                    <button
                      type="button"
                      disabled={rotateMut.isPending}
                      onClick={() => rotateMut.mutate(dev.id)}
                      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Putar Token</span>
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => onDeleteDevice(dev)}
                      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md border border-[#991B1B]/30 bg-surface px-3 text-xs font-semibold text-[#991B1B] hover:border-[#991B1B] dark:text-[#FCA5A5]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hapus</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobDetailPanel({
  job,
  downloadUrl,
  pricingMap,
  accounts,
  devices,
  canUpdate,
  canApprove,
  canDelete,
  canFinancePost,
  onCompleted,
  onError,
}: {
  job: PrintJobRow;
  downloadUrl: string | null;
  pricingMap: Map<string, PrintPricingRuleRow>;
  accounts: Array<{ id: string; name: string; type: string }>;
  devices: PrintDeviceRow[];
  canUpdate: boolean;
  canApprove: boolean;
  canDelete: boolean;
  canFinancePost: boolean;
  onCompleted: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [paperSize, setPaperSize] = useState<PrintPaperSize>(job.paper_size);
  const [colorMode, setColorMode] = useState<PrintColorMode>(job.color_mode);
  const [quality, setQuality] = useState<PrintQuality>(job.quality);
  const [copies, setCopies] = useState(String(job.copies));
  const [orientation, setOrientation] = useState<PrintOrientation>(job.orientation);
  const [fit, setFit] = useState<PrintFit>(job.fit);
  const [borderless, setBorderless] = useState(job.borderless);
  const [duplex, setDuplex] = useState(job.duplex);
  const [pageRange, setPageRange] = useState(job.page_range ?? '');
  const [discountDigits, setDiscountDigits] = useState(job.discount_amount || '0');
  const [deviceId, setDeviceId] = useState(job.device_id ?? devices[0]?.id ?? '');
  const [autoPostFinance, setAutoPostFinance] = useState(true);
  const [financeAccountId, setFinanceAccountId] = useState(
    job.finance_account_id ?? accounts[0]?.id ?? '',
  );
  const [rejectReason, setRejectReason] = useState('');

  const isPending = job.status === 'pending_approval';
  const copiesInt = Math.min(99, Math.max(1, Number.parseInt(copies || '1', 10) || 1));
  const { pages, error: pageRangeError } = parsePageRangeCountClient(
    pageRange,
    job.detected_page_count,
  );
  const activeRule = pricingMap.get(`${paperSize}:${colorMode}`);
  const pricePerPage = BigInt(activeRule?.price_per_page ?? job.unit_price_per_page ?? '1500');
  const duplexDiscount = BigInt(activeRule?.duplex_discount_per_page ?? '0');
  const discountBig = BigInt(discountDigits.replace(/\D/g, '') || '0');
  const calc = calcTotalBigInt({
    pages,
    copies: copiesInt,
    pricePerPage,
    duplex,
    duplexDiscount,
    discount: discountBig,
  });

  const saveOptionsMut = useMutation({
    mutationFn: () =>
      erpApi.printer.updateJobOptions(job.id, {
        paper_size: paperSize,
        color_mode: colorMode,
        quality,
        copies: copiesInt,
        orientation,
        fit,
        borderless,
        duplex,
        page_range: pageRange.trim() || null,
        discount_amount: discountBig.toString(),
      }),
    onSuccess: (res) => onCompleted(`Opsi cetak ${res.job.job_code} disimpan.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal menyimpan opsi cetak.'),
  });

  const approveMut = useMutation({
    mutationFn: () =>
      erpApi.printer.approveJob(job.id, {
        paper_size: paperSize,
        color_mode: colorMode,
        quality,
        copies: copiesInt,
        orientation,
        fit,
        borderless,
        duplex,
        page_range: pageRange.trim() || null,
        discount_amount: discountBig.toString(),
        device_id: deviceId || null,
        auto_post_finance: Boolean(autoPostFinance && financeAccountId),
        finance_account_id: autoPostFinance && financeAccountId ? financeAccountId : null,
      }),
    onSuccess: (res) =>
      onCompleted(`Job ${res.job.job_code} disetujui dan masuk antrean print bridge.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal menyetujui job.'),
  });

  const rejectMut = useMutation({
    mutationFn: () => erpApi.printer.rejectJob(job.id, rejectReason.trim()),
    onSuccess: (res) => onCompleted(`Job ${res.job.job_code} ditolak.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal menolak job.'),
  });

  const reprintMut = useMutation({
    mutationFn: () => erpApi.printer.reprintJob(job.id),
    onSuccess: (res) => onCompleted(`Job ${res.job.job_code} dimasukkan ke antrean cetak ulang.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal cetak ulang.'),
  });

  const postFinMut = useMutation({
    mutationFn: () => erpApi.printer.postFinance(job.id, financeAccountId),
    onSuccess: () => onCompleted(`Pendapatan ${job.job_code} tercatat ke rekening kas.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal mencatat ke keuangan.'),
  });

  const delFileMut = useMutation({
    mutationFn: () => erpApi.printer.deleteJobFile(job.id),
    onSuccess: (res) => onCompleted(`File dokumen ${res.job.job_code} telah dihapus permanen.`),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal menghapus file.'),
  });

  const isImage = job.file_mime.startsWith('image/');
  const isPdf =
    job.file_mime === 'application/pdf' || job.file_name.toLowerCase().endsWith('.pdf');
  const statusMeta = STATUS_META[job.status] ?? {
    label: job.status,
    tone: 'neutral' as BadgeTone,
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-canvas p-3">
        <div>
          <p className="font-semibold text-text-primary">
            {job.customer_name || 'Pelanggan'} ({job.customer_phone || '-'})
          </p>
          <p className="text-[11px] text-text-secondary">
            {SOURCE_LABELS[job.source]} | {job.detected_page_count} halaman terdeteksi |{' '}
            {formatBytes(job.file_size_bytes)}
          </p>
        </div>
        <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
      </div>

      {job.customer_note ? (
        <div className="rounded-lg border border-border bg-surface-subtle p-3">
          <p className="font-semibold text-text-primary">Catatan Pengirim:</p>
          <p className="mt-0.5 text-text-secondary">{job.customer_note}</p>
        </div>
      ) : null}

      {job.error_message ? (
        <div className="rounded-lg border border-[#FCA5A5] bg-danger-soft p-3 text-[#991B1B] dark:text-[#FCA5A5]">
          <p className="font-semibold">Error Printer:</p>
          <p className="mt-0.5">{job.error_message}</p>
        </div>
      ) : null}

      {/* File Preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-text-primary">Preview Dokumen</span>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              <span>Buka di Tab Baru</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {job.file_deleted_at ? (
          <div className="rounded-lg border border-border bg-canvas p-4 text-center text-text-secondary">
            File dokumen sudah dihapus permanen pada {formatDateTimeId(job.file_deleted_at)}.
          </div>
        ) : !downloadUrl ? (
          <div className="rounded-lg border border-border bg-canvas p-4 text-center text-text-secondary">
            URL preview tidak tersedia.
          </div>
        ) : isImage ? (
          <img
            src={downloadUrl}
            alt={job.file_name}
            className="max-h-72 w-full rounded-lg border border-border bg-canvas object-contain"
          />
        ) : isPdf ? (
          <iframe
            title={`Preview ${job.file_name}`}
            src={downloadUrl}
            className="h-72 w-full rounded-lg border border-border bg-white"
          />
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-canvas p-3">
            <FileText className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-text-primary">{job.file_name}</p>
              <p className="text-[11px] text-text-secondary">{job.file_mime}</p>
            </div>
          </div>
        )}
      </div>

      {/* Print Options */}
      <div className="space-y-3 rounded-lg border border-border bg-canvas p-3.5">
        <p className="font-semibold text-text-primary">Opsi Cetak &amp; Kalkulasi Tarif</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Ukuran Kertas</span>
            <select
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary disabled:opacity-60"
            >
              {PRINT_PAPER_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Warna</span>
            <select
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as PrintColorMode)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary disabled:opacity-60"
            >
              {PRINT_COLOR_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === 'mono' ? 'Hitam Putih' : 'Warna'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Kualitas</span>
            <select
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={quality}
              onChange={(e) => setQuality(e.target.value as PrintQuality)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary disabled:opacity-60"
            >
              {PRINT_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Salinan (Copies)</span>
            <input
              type="number"
              min={1}
              max={99}
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 font-mono text-text-primary disabled:opacity-60"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Orientasi</span>
            <select
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as PrintOrientation)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary disabled:opacity-60"
            >
              {PRINT_ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Skala (Fit)</span>
            <select
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={fit}
              onChange={(e) => setFit(e.target.value as PrintFit)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary disabled:opacity-60"
            >
              {PRINT_FITS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Rentang Halaman</span>
            <input
              type="text"
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={pageRange}
              onChange={(e) => setPageRange(e.target.value)}
              placeholder={`Semua (1-${job.detected_page_count})`}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 font-mono text-text-primary disabled:opacity-60"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-text-secondary">Diskon Job (Rp)</span>
            <input
              type="text"
              inputMode="numeric"
              disabled={!isPending || (!canUpdate && !canApprove)}
              value={discountDigits}
              onChange={(e) => setDiscountDigits(e.target.value.replace(/\D/g, ''))}
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 font-mono text-text-primary disabled:opacity-60"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-text-primary">
            <input
              type="checkbox"
              disabled={!isPending || (!canUpdate && !canApprove)}
              checked={borderless}
              onChange={(e) => setBorderless(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span>Borderless</span>
          </label>
          <label className="inline-flex items-center gap-2 text-text-primary">
            <input
              type="checkbox"
              disabled={!isPending || (!canUpdate && !canApprove)}
              checked={duplex}
              onChange={(e) => setDuplex(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span>Bolak-Balik (Duplex)</span>
          </label>
        </div>

        {pageRangeError ? (
          <p className="text-[11px] font-semibold text-[#991B1B] dark:text-[#FCA5A5]">
            {pageRangeError}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="text-text-secondary">
            {pages} hal x {copiesInt} x {formatRupiah(calc.unit.toString())}
            {discountBig > 0n ? ` - Diskon ${formatRupiah(discountBig.toString())}` : ''}
          </span>
          <span className="font-mono text-base font-bold text-text-primary">
            {formatRupiah((isPending ? calc.total : BigInt(job.total_price)).toString())}
          </span>
        </div>

        {isPending && canUpdate ? (
          <button
            type="button"
            disabled={saveOptionsMut.isPending || Boolean(pageRangeError)}
            onClick={() => saveOptionsMut.mutate()}
            className="w-full min-h-[38px] cursor-pointer rounded-md border border-border-strong bg-surface px-3 font-semibold text-text-primary hover:border-accent disabled:opacity-50"
          >
            {saveOptionsMut.isPending ? 'Menyimpan...' : 'Simpan Opsi & Hitung Ulang'}
          </button>
        ) : null}
      </div>

      {/* Finance & Approval Action Box */}
      {isPending && canApprove ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface-subtle/60 p-3.5">
          {devices.length > 0 ? (
            <label className="block space-y-1">
              <span className="block font-medium text-text-secondary">Target Print Bridge</span>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.device_name} ({d.is_online ? 'Online' : 'Offline'})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {accounts.length > 0 ? (
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={autoPostFinance}
                  onChange={(e) => setAutoPostFinance(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                <span>Catat otomatis ke Keuangan saat selesai cetak</span>
              </label>
              {autoPostFinance ? (
                <select
                  value={financeAccountId}
                  onChange={(e) => setFinanceAccountId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            disabled={approveMut.isPending || Boolean(pageRangeError)}
            onClick={() => approveMut.mutate()}
            className="inline-flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>{approveMut.isPending ? 'Memproses...' : 'Setujui & Masuk Antrean Cetak'}</span>
          </button>

          <div className="space-y-2 border-t border-border pt-3">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Alasan penolakan (min 2 karakter)..."
              className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary placeholder:text-text-secondary"
            />
            <button
              type="button"
              disabled={rejectMut.isPending || rejectReason.trim().length < 2}
              onClick={() => rejectMut.mutate()}
              className="inline-flex min-h-[38px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#FCA5A5] bg-danger-soft px-3 font-semibold text-[#991B1B] disabled:opacity-50 dark:text-[#FCA5A5]"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              <span>{rejectMut.isPending ? 'Menolak...' : 'Tolak & Hapus File'}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Manual Finance Posting after Printed */}
      {job.status === 'printed' && !job.finance_transaction_id && canFinancePost && accounts.length > 0 ? (
        <div className="space-y-2.5 rounded-lg border border-border bg-surface-subtle p-3.5">
          <p className="font-semibold text-text-primary">Catat Pendapatan ke Kas</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={financeAccountId}
              onChange={(e) => setFinanceAccountId(e.target.value)}
              className="h-10 flex-1 rounded-md border border-border bg-surface px-2.5 text-text-primary"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.type})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={postFinMut.isPending || !financeAccountId}
              onClick={() => postFinMut.mutate()}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              <Wallet className="h-4 w-4" aria-hidden="true" />
              <span>{postFinMut.isPending ? 'Mencatat...' : 'Posting Kas'}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Secondary Actions */}
      <div className="flex flex-wrap gap-2">
        {canApprove && (job.status === 'printed' || job.status === 'failed') && !job.file_deleted_at ? (
          <button
            type="button"
            disabled={reprintMut.isPending}
            onClick={() => reprintMut.mutate()}
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 font-semibold text-text-primary hover:border-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Cetak Ulang</span>
          </button>
        ) : null}

        {canDelete && !job.file_deleted_at ? (
          <button
            type="button"
            disabled={delFileMut.isPending}
            onClick={() => delFileMut.mutate()}
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 font-semibold text-[#991B1B] hover:border-[#FCA5A5] dark:text-[#FCA5A5]"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Hapus File Storage</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ManualUploadForm({
  baseId,
  pricingMap,
  accounts,
  canApprove,
  onCreated,
  onError,
}: {
  baseId: string;
  pricingMap: Map<string, PrintPricingRuleRow>;
  accounts: Array<{ id: string; name: string; type: string }>;
  canApprove: boolean;
  onCreated: (job: PrintJobRow) => void;
  onError: (msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [paperSize, setPaperSize] = useState<PrintPaperSize>('a4');
  const [colorMode, setColorMode] = useState<PrintColorMode>('color');
  const [copies, setCopies] = useState('1');
  const [pageCount, setPageCount] = useState('1');
  const [autoApprove, setAutoApprove] = useState(canApprove);
  const [autoPostFinance, setAutoPostFinance] = useState(false);
  const [financeAccountId, setFinanceAccountId] = useState(accounts[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const rule = pricingMap.get(`${paperSize}:${colorMode}`);
  const unitPrice = BigInt(rule?.price_per_page ?? '1500');
  const copiesInt = Math.min(99, Math.max(1, Number.parseInt(copies || '1', 10) || 1));
  const pagesInt = Math.min(2000, Math.max(1, Number.parseInt(pageCount || '1', 10) || 1));
  const previewTotal = unitPrice * BigInt(copiesInt) * BigInt(pagesInt);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (picked.size > 26_214_400) {
      onError('Ukuran file maksimal 25 MB.');
      return;
    }
    setFile(picked);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      onError('Pilih file PDF atau gambar terlebih dahulu.');
      return;
    }
    setSubmitting(true);
    try {
      const contentType = file.type || 'application/octet-stream';
      const objectKey = await uploadFileViaPresign('print-jobs', file);
      const res = await erpApi.printer.createManualJob({
        file_name: file.name,
        file_mime: contentType,
        file_size_bytes: file.size,
        file_object_key: objectKey,
        detected_page_count: pagesInt,
        customer_name: customerName.trim() || null,
        customer_note: customerNote.trim() || null,
        paper_size: paperSize,
        color_mode: colorMode,
        copies: copiesInt,
        auto_approve: autoApprove,
        auto_post_finance: autoApprove && autoPostFinance && Boolean(financeAccountId),
        finance_account_id: autoApprove && autoPostFinance ? financeAccountId || null : null,
        source: 'manual_web',
      });
      onCreated(res.job);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal membuat print job manual.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <label htmlFor={`${baseId}-manual-file`} className="block font-semibold text-text-primary">
          Pilih File Dokumen / Gambar (Max 25 MB) *
        </label>
        <input
          id={`${baseId}-manual-file`}
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.html,.docx,.xlsx,.pptx"
          onChange={handleFileChange}
          className="block w-full rounded-md border border-border bg-canvas p-2 text-text-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block font-semibold text-text-primary">Nama Pelanggan</span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Opsional (walk-in)"
            className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 text-text-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-text-primary">Estimasi Halaman</span>
          <input
            type="number"
            min={1}
            max={2000}
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 font-mono text-text-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-text-primary">Ukuran Kertas</span>
          <select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
            className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 text-text-primary"
          >
            {PRINT_PAPER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-text-primary">Mode Warna</span>
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as PrintColorMode)}
            className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 text-text-primary"
          >
            {PRINT_COLOR_MODES.map((m) => (
              <option key={m} value={m}>
                {m === 'mono' ? 'Hitam Putih' : 'Warna'}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-text-primary">Jumlah Salinan</span>
          <input
            type="number"
            min={1}
            max={99}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 font-mono text-text-primary"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Catatan</span>
        <input
          type="text"
          value={customerNote}
          onChange={(e) => setCustomerNote(e.target.value)}
          placeholder="Contoh: Jilid spiral, cetak kertas foto"
          className="h-10 w-full rounded-md border border-border bg-canvas px-2.5 text-text-primary"
        />
      </label>

      {canApprove ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-subtle/60 p-3">
          <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-text-primary">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span>Langsung setujui &amp; masukkan ke antrean printer</span>
          </label>
          {autoApprove && accounts.length > 0 ? (
            <>
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={autoPostFinance}
                  onChange={(e) => setAutoPostFinance(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                <span>Catat otomatis ke Keuangan saat selesai cetak</span>
              </label>
              {autoPostFinance ? (
                <select
                  value={financeAccountId}
                  onChange={(e) => setFinanceAccountId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-2.5 text-text-primary"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.type})
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-lg border border-border bg-canvas p-3">
        <span className="text-text-secondary">Estimasi Total:</span>
        <span className="font-mono text-base font-bold text-text-primary">
          {formatRupiah(previewTotal.toString())}
        </span>
      </div>

      <button
        type="submit"
        disabled={submitting || !file}
        className="min-h-[42px] w-full cursor-pointer rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? 'Mengunggah & Menyimpan...' : 'Kirim ke Antrean Cetak'}
      </button>
    </form>
  );
}

function RegisterDeviceForm({
  onRegistered,
  onError,
}: {
  onRegistered: (dev: PrintDeviceRow, token: string) => void;
  onError: (msg: string) => void;
}) {
  const [deviceName, setDeviceName] = useState('HP Smart Tank 583 Kasir');
  const [host, setHost] = useState('192.168.0.5');
  const [mdnsHost, setMdnsHost] = useState('HP48EA6283D5C2.local');

  const regMut = useMutation({
    mutationFn: () =>
      erpApi.printer.registerDevice({
        device_name: deviceName.trim(),
        host: host.trim() || null,
        mdns_host: mdnsHost.trim() || null,
        model: 'HP Smart Tank 580-590 series',
      }),
    onSuccess: (res) => onRegistered(res.device, res.agent_token),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal mendaftarkan perangkat.'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        regMut.mutate();
      }}
      className="space-y-4 text-xs"
    >
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Nama Perangkat Bridge *</span>
        <input
          type="text"
          required
          minLength={2}
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 text-text-primary"
        />
      </label>
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">IP Printer Wi-Fi (Opsional)</span>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.0.5"
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 font-mono text-text-primary"
        />
      </label>
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Hostname mDNS (Opsional)</span>
        <input
          type="text"
          value={mdnsHost}
          onChange={(e) => setMdnsHost(e.target.value)}
          placeholder="HP48EA6283D5C2.local"
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 font-mono text-text-primary"
        />
      </label>
      <button
        type="submit"
        disabled={regMut.isPending}
        className="min-h-[42px] w-full cursor-pointer rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {regMut.isPending ? 'Mendaftarkan...' : 'Buat Perangkat & Generate Token'}
      </button>
    </form>
  );
}

function EditDeviceForm({
  device,
  onSaved,
  onError,
}: {
  device: PrintDeviceRow;
  onSaved: (dev: PrintDeviceRow) => void;
  onError: (msg: string) => void;
}) {
  const [deviceName, setDeviceName] = useState(device.device_name);
  const [host, setHost] = useState(device.host ?? '');
  const [mdnsHost, setMdnsHost] = useState(device.mdns_host ?? '');
  const [model, setModel] = useState(device.model || 'HP Smart Tank 580-590 series');
  const [dryRunMode, setDryRunMode] = useState(Boolean(device.dry_run_mode));
  const [isActive, setIsActive] = useState(Boolean(device.is_active));

  const saveMut = useMutation({
    mutationFn: () =>
      erpApi.printer.updateDevice(device.id, {
        device_name: deviceName.trim(),
        host: host.trim() || null,
        mdns_host: mdnsHost.trim() || null,
        model: model.trim() || 'HP Smart Tank 580-590 series',
        dry_run_mode: dryRunMode,
        is_active: isActive,
      }),
    onSuccess: (res) => onSaved(res.device),
    onError: (err) => onError(err instanceof Error ? err.message : 'Gagal memperbarui perangkat.'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        saveMut.mutate();
      }}
      className="space-y-4 text-xs"
    >
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Nama Perangkat Bridge *</span>
        <input
          type="text"
          required
          minLength={2}
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 text-text-primary"
        />
      </label>
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Model Printer</span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 text-text-primary"
        />
      </label>
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">IP Printer Wi-Fi</span>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="192.168.0.5"
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 font-mono text-text-primary"
        />
      </label>
      <label className="block space-y-1">
        <span className="block font-semibold text-text-primary">Hostname mDNS</span>
        <input
          type="text"
          value={mdnsHost}
          onChange={(e) => setMdnsHost(e.target.value)}
          placeholder="HP48EA6283D5C2.local"
          className="h-10 w-full rounded-md border border-border bg-canvas px-3 font-mono text-text-primary"
        />
      </label>
      <div className="space-y-2.5 rounded-lg border border-border bg-canvas p-3">
        <label className="flex cursor-pointer items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            checked={dryRunMode}
            onChange={(e) => setDryRunMode(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span>Mode Uji Tanpa Kertas (Dry-Run via IPP Validate-Job saja)</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span>Perangkat Aktif (izinkan bridge mengirim heartbeat &amp; menerima job)</span>
        </label>
      </div>
      <button
        type="submit"
        disabled={saveMut.isPending}
        className="min-h-[42px] w-full cursor-pointer rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {saveMut.isPending ? 'Menyimpan...' : 'Simpan Pengaturan Perangkat'}
      </button>
    </form>
  );
}

function WhatsappControlPanel({
  device,
  onRefresh,
  onQueued,
  onError,
}: {
  device: PrintDeviceRow | null;
  onRefresh: () => void;
  onQueued: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [phoneInput, setPhoneInput] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  const actionMut = useMutation({
    mutationFn: (payload: {
      action: 'connect_qr' | 'reset_qr' | 'pair_link_code' | 'logout_wa';
      phone?: string | null;
    }) => {
      if (!device) throw new Error('Perangkat bridge tidak ditemukan.');
      return erpApi.printer.whatsappAction(device.id, payload);
    },
    onSuccess: (res) => {
      onQueued(`Perintah "${res.queued_command}" dikirim ke bridge. Tunggu beberapa detik.`);
      onRefresh();
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : 'Gagal mengirim perintah WhatsApp.');
    },
  });

  if (!device) {
    return <ErrorState message="Perangkat bridge tidak ditemukan." />;
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Device Live State */}
      <div className="space-y-2 rounded-lg border border-border bg-canvas p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-display text-sm font-bold text-text-primary">{device.device_name}</p>
            <p className="text-[11px] text-text-secondary">Host: {device.host || '-'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              tone={device.is_online ? 'success' : 'danger'}
              label={device.is_online ? 'Bridge Online' : 'Bridge Offline'}
            />
            <StatusBadge
              tone={
                device.openwa_status === 'connected'
                  ? 'success'
                  : device.openwa_status === 'qr_required'
                    ? 'warning'
                    : 'neutral'
              }
              label={
                device.openwa_status === 'connected'
                  ? 'OpenWA Terhubung'
                  : device.openwa_status === 'qr_required'
                    ? 'Perlu Scan QR'
                    : 'Terputus'
              }
            />
          </div>
        </div>
        {device.pending_command ? (
          <p className="font-medium text-accent">
            Sedang memproses perintah "{device.pending_command}" di PC toko...
          </p>
        ) : null}
        {device.last_command_result ? (
          <p className="text-text-secondary">Info terakhir: {device.last_command_result}</p>
        ) : null}
      </div>

      {!device.is_online ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-subtle/60 p-3.5">
          <p className="font-semibold text-text-primary">
            Layanan latar belakang di PC toko sedang tidak aktif
          </p>
          <p className="text-text-secondary">
            Perintah dari web akan otomatis dijalankan begitu layanan bridge di PC toko menyala.
            Untuk PC baru, jalankan sekali installer layanan senyap tanpa terminal:
          </p>
          <code className="block rounded border border-border bg-canvas px-2.5 py-2 font-mono text-[11px] text-text-primary">
            cd services\print-bridge &amp;&amp; npm run service:install
          </code>
        </div>
      ) : null}

      {/* QR Pairing Section */}
      <div className="space-y-3 rounded-lg border border-border bg-canvas p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-text-primary">Tautkan dengan QR Code</p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2.5 text-[11px] font-semibold text-text-primary hover:border-accent"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Segarkan</span>
          </button>
        </div>

        {device.is_online && device.openwa_qr_code ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <QrCodeCanvas
              value={device.openwa_qr_code}
              size={220}
              label={`QR Code WhatsApp ${device.device_name}`}
            />
            <p className="text-center text-[11px] text-text-secondary">
              Buka WhatsApp di HP toko -&gt; Perangkat Tertaut -&gt; Tautkan Perangkat, lalu pindai QR di atas.
            </p>
          </div>
        ) : device.openwa_status === 'connected' ? (
          <p className="text-text-secondary">
            WhatsApp sudah terhubung dan siap menerima dokumen cetak dari chat pribadi.
          </p>
        ) : (
          <p className="text-text-secondary">
            Klik tombol di bawah untuk memulai sesi OpenWA dan memunculkan QR Code langsung di layar ini.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={actionMut.isPending}
            onClick={() => actionMut.mutate({ action: 'connect_qr' })}
            className="inline-flex min-h-[38px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sambungkan / Tampilkan QR</span>
          </button>
          <button
            type="button"
            disabled={actionMut.isPending}
            onClick={() => actionMut.mutate({ action: 'reset_qr' })}
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Sesi &amp; QR Baru</span>
          </button>
        </div>
      </div>

      {/* 8-Digit Phone Linking Code Section */}
      <div className="space-y-3 rounded-lg border border-border bg-canvas p-3.5">
        <p className="font-semibold text-text-primary">Atau Tautkan via Kode 8 Digit (Tanpa Kamera)</p>
        {device.is_online && device.openwa_link_code ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-lg border border-border bg-surface px-3.5 py-2 font-mono text-xl font-bold tracking-widest text-text-primary">
              {device.openwa_link_code}
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(device.openwa_link_code ?? '');
                setCodeCopied(true);
                setTimeout(() => setCodeCopied(false), 2000);
              }}
              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:border-accent"
            >
              {codeCopied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{codeCopied ? 'Tersalin' : 'Salin'}</span>
            </button>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            actionMut.mutate({ action: 'pair_link_code', phone: phoneInput });
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            type="tel"
            required
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="Nomor WA format 628xxxxxxxxxx"
            className="h-10 min-w-[190px] flex-1 rounded-md border border-border bg-surface px-3 font-mono text-text-primary"
          />
          <button
            type="submit"
            disabled={actionMut.isPending}
            className="min-h-[40px] cursor-pointer rounded-md border border-border-strong bg-surface px-3.5 text-xs font-semibold text-text-primary hover:border-accent disabled:opacity-50"
          >
            Buat Kode 8 Digit
          </button>
        </form>
      </div>

      {/* Disconnect / Logout Session */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-canvas p-3.5">
        <div>
          <p className="font-semibold text-text-primary">Putuskan / Ganti Akun WhatsApp</p>
          <p className="text-[11px] text-text-secondary">
            Menghapus sesi lokal OpenWA di PC toko dan menghentikan koneksi WhatsApp aktif.
          </p>
        </div>
        <button
          type="button"
          disabled={actionMut.isPending}
          onClick={() => actionMut.mutate({ action: 'logout_wa' })}
          className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#991B1B]/30 bg-surface px-3 text-xs font-semibold text-[#991B1B] hover:border-[#991B1B] disabled:opacity-50 dark:text-[#FCA5A5]"
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Logout WA</span>
        </button>
      </div>
    </div>
  );
}
