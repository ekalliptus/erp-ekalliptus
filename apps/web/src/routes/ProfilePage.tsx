import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  History,
  KeyRound,
  MapPin,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AppChangelogModal,
  AppUpdateModal,
  DownloadAppButton,
} from '../components/AppVersionWidgets.tsx';
import { FaceVerificationModal } from '../components/FaceVerificationModal.tsx';
import { ModulePageSkeleton } from '../components/Skeleton.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type AppVersionCheckResponse,
  type MeResponse,
  type ProfileSummaryResponse,
} from '../lib/api.ts';
import {
  applyWebUpdate,
  WEB_APP_BUILD_NUMBER,
  WEB_APP_VERSION,
} from '../lib/appVersion.ts';
import {
  formatDateId,
  formatDateTimeId,
  formatPlatformLabel,
  formatRupiah,
} from '../lib/format.ts';

const MODULE_LABELS: Array<{ key: 'finance' | 'inventory' | 'attendance' | 'payroll' | 'rbac' | 'audit'; label: string }> = [
  { key: 'finance', label: 'Keuangan' },
  { key: 'inventory', label: 'Inventaris' },
  { key: 'attendance', label: 'Absensi' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'rbac', label: 'RBAC & Tim' },
  { key: 'audit', label: 'Audit Trail' },
];

const ACTION_LABELS: Array<{ key: 'view' | 'create' | 'update' | 'delete' | 'approve' | 'export'; label: string }> = [
  { key: 'view', label: 'Lihat' },
  { key: 'create', label: 'Tambah' },
  { key: 'update', label: 'Ubah' },
  { key: 'delete', label: 'Hapus' },
  { key: 'approve', label: 'Setujui' },
  { key: 'export', label: 'Ekspor' },
];

const ROLE_SUBTITLES: Record<string, string> = {
  owner: 'Kendali Eksekutif & Tata Kelola',
  finance: 'Otorisasi Kas & Pelaporan',
  warehouse: 'Operasional Gudang & Logistik',
  hr: 'SDM, Kehadiran & Payroll',
  staff: 'Kartu Kerja & Kehadiran Pribadi',
};

function initialsForName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getHeroMetrics(data: ProfileSummaryResponse): Array<{ label: string; value: string }> {
  const ws = data.role_workspace;
  if (ws.kind === 'owner') {
    const m = ws.executive_metrics;
    const approvals = m.pending_finance_tx + m.pending_attendance_approvals + m.draft_payroll_runs;
    return [
      { label: 'Total Kas', value: formatRupiah(m.total_cash_balance) },
      { label: 'Tim Aktif', value: `${m.active_employees_count} org` },
      { label: 'Approval', value: `${approvals} item` },
    ];
  }
  if (ws.kind === 'finance') {
    const m = ws.finance_metrics;
    return [
      { label: 'Total Kas', value: formatRupiah(m.total_cash_balance) },
      { label: 'Tx Pending', value: `${m.pending_transactions_count}` },
      { label: 'Payroll Siap', value: `${m.approved_payroll_to_pay} run` },
    ];
  }
  if (ws.kind === 'warehouse') {
    const m = ws.warehouse_metrics;
    return [
      { label: 'SKU Aktif', value: `${m.active_items_count} item` },
      { label: 'Stok Kritis', value: `${m.low_stock_alerts} item` },
      { label: 'PO Aktif', value: `${m.open_purchase_orders}` },
    ];
  }
  if (ws.kind === 'hr') {
    const m = ws.hr_metrics;
    return [
      { label: 'Tim Aktif', value: `${m.active_employees_count} org` },
      { label: 'Hadir Hari Ini', value: `${m.present_today_count} org` },
      { label: 'Izin Pending', value: `${m.pending_attendance_approvals}` },
    ];
  }
  return [
    { label: `Hadir ${data.personal_attendance.days_window}h`, value: `${data.personal_attendance.present_days} hr` },
    { label: 'Terlambat', value: `${data.personal_attendance.late_days} hr` },
    { label: 'Lembur', value: `${data.personal_attendance.total_overtime_minutes} mnt` },
  ];
}

export function ProfilePage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameId = useId();
  const usernameId = useId();
  const phoneId = useId();

  const summaryQuery = useQuery({
    queryKey: ['profile-summary'],
    queryFn: erpApi.profile.summary,
  });

  const versionQuery = useQuery({
    queryKey: ['app', 'version', 'web'],
    queryFn: () => erpApi.app.checkVersion('web', WEB_APP_VERSION, WEB_APP_BUILD_NUMBER),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [fullName, setFullName] = useState(me.employee.full_name);
  const [username, setUsername] = useState(me.employee.username ?? '');
  const [phone, setPhone] = useState(me.employee.phone ?? '');
  const [showSalary, setShowSalary] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [manualUpdateResult, setManualUpdateResult] = useState<AppVersionCheckResponse | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [versionFeedback, setVersionFeedback] = useState<string | null>(null);
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [confirmDeleteFace, setConfirmDeleteFace] = useState(false);
  const [faceMsg, setFaceMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleManualCheckUpdate() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setVersionFeedback(null);
    try {
      const fresh = await erpApi.app.checkVersion('web', WEB_APP_VERSION, WEB_APP_BUILD_NUMBER);
      queryClient.setQueryData(['app', 'version', 'web'], fresh);
      if (fresh.has_update && fresh.latest) {
        setChangelogOpen(false);
        setManualUpdateResult(fresh);
      } else {
        setVersionFeedback(`Aplikasi sudah menggunakan versi terbaru (v${fresh.current_version}).`);
      }
    } catch (err) {
      setVersionFeedback(err instanceof Error ? err.message : 'Gagal memeriksa pembaruan.');
    } finally {
      setCheckingUpdate(false);
    }
  }

  useEffect(() => {
    const emp = summaryQuery.data?.employee;
    if (!emp) return;
    setFullName(emp.full_name);
    setUsername(emp.username ?? '');
    setPhone(emp.phone ?? '');
  }, [summaryQuery.data]);

  const updateMut = useMutation({
    mutationFn: erpApi.profile.updateProfile,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setFormMsg({ kind: 'ok', text: 'Profil akun berhasil disimpan.' });
    },
    onError: (err) => {
      setFormMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan profil.',
      });
    },
  });

  const avatarMut = useMutation({
    mutationFn: async (file: File) => {
      const objectKey = await uploadFileViaPresign('avatar', file);
      return erpApi.profile.updateProfile({ avatar_object_key: objectKey });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setFormMsg({ kind: 'ok', text: 'Foto profil diperbarui.' });
    },
    onError: (err) => {
      setFormMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunggah foto profil.',
      });
    },
  });

  const removeAvatarMut = useMutation({
    mutationFn: () => erpApi.profile.updateProfile({ avatar_object_key: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setFormMsg({ kind: 'ok', text: 'Foto profil dihapus.' });
    },
  });

  const deleteFaceMut = useMutation({
    mutationFn: () => erpApi.attendance.deleteMyFace(),
    onSuccess: async () => {
      setConfirmDeleteFace(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] }),
      ]);
      setFaceMsg({ kind: 'ok', text: 'Data wajah terdaftar telah dihapus.' });
    },
    onError: (err) => {
      setConfirmDeleteFace(false);
      setFaceMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Gagal menghapus data wajah.',
      });
    },
  });

  if (summaryQuery.isLoading) {
    return <ModulePageSkeleton variant="profile" label="Memuat profil & ruang kerja role..." />;
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <ErrorState
        message={
          summaryQuery.error instanceof Error
            ? summaryQuery.error.message
            : 'Gagal memuat ringkasan profil.'
        }
        onRetry={() => void summaryQuery.refetch()}
      />
    );
  }

  const data = summaryQuery.data;
  const emp = data.employee;
  const ws = data.role_workspace;
  const heroMetrics = getHeroMetrics(data);
  const roleSubtitle = ROLE_SUBTITLES[data.role.code] ?? 'Anggota Tim Ekalliptus';

  function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setFormMsg(null);
    const trimmedName = fullName.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    if (trimmedName.length < 2) {
      setFormMsg({ kind: 'err', text: 'Nama lengkap minimal 2 karakter.' });
      return;
    }
    if (trimmedUsername && !/^[a-z0-9_.]{3,24}$/.test(trimmedUsername)) {
      setFormMsg({
        kind: 'err',
        text: 'Username harus 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.',
      });
      return;
    }

    updateMut.mutate({
      full_name: trimmedName,
      username: trimmedUsername || null,
      phone: trimmedPhone || null,
    });
  }

  function handleAvatarFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormMsg({ kind: 'err', text: 'Pilih file gambar PNG, JPG, atau WEBP.' });
      return;
    }
    avatarMut.mutate(file);
  }

  return (
    <div className="space-y-6">
      {/* Role-Differentiated Identity Hero */}
      <section className="rounded-xl border border-accent/30 bg-gradient-to-br from-[#0F766E] to-[#0B4F4A] p-5 text-white dark:from-[#0F2F2B] dark:to-[#064E3B] sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative">
              {emp.avatar_url ? (
                <img
                  src={emp.avatar_url}
                  alt={`Foto profil ${emp.full_name}`}
                  width={72}
                  height={72}
                  className="h-[72px] w-[72px] rounded-full border-2 border-[#34D399]/60 object-cover"
                />
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-[#34D399]/60 bg-[#042F2E] font-display text-xl font-bold text-white">
                  {initialsForName(emp.full_name)}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarFile}
                className="sr-only"
              />
              <button
                type="button"
                aria-label="Unggah foto profil baru"
                disabled={avatarMut.isPending}
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-[#0B4F4A] shadow-sm hover:bg-[#EFF2EE] disabled:opacity-60"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                  {emp.full_name}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#34D399]/50 bg-[#042F2E]/70 px-2.5 py-0.5 text-xs font-semibold text-white">
                  <BadgeCheck className="h-3.5 w-3.5 text-[#34D399]" aria-hidden="true" />
                  {data.role.name}
                </span>
              </div>
              <p className="text-sm font-medium text-[#CCFBF1]">{roleSubtitle}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#CCFBF1]">
                <span className="font-mono font-semibold text-white">{emp.employee_code}</span>
                <span>·</span>
                <span>{emp.username ? `@${emp.username}` : 'Username belum diatur'}</span>
                <span>·</span>
                <span>{emp.email}</span>
                {emp.avatar_object_key ? (
                  <button
                    type="button"
                    disabled={removeAvatarMut.isPending}
                    onClick={() => removeAvatarMut.mutate()}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-[#FECACA] hover:bg-black/20"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Hapus Foto
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-lg border border-white/15 bg-[#042F2E]/45 p-3 lg:min-w-[340px]">
            {heroMetrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <p className="truncate text-[11px] font-medium text-[#CCFBF1]">{metric.label}</p>
                <p className="mt-1 truncate font-mono text-sm font-bold text-white sm:text-base">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Role-Specific Workspace */}
      <section className="space-y-4" aria-label={`Ruang kerja role ${data.role.name}`}>
        {ws.kind === 'owner' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text-primary">
                Pusat Kontrol Owner & Tata Kelola Organisasi
              </h3>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/attendance"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                >
                  <MapPin className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  Ubah Lokasi Kantor (Maps)
                </Link>
                <Link
                  to="/rbac"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Kelola Tim & RBAC
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Transaksi Kas Pending</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.executive_metrics.pending_finance_tx}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Akun Belum Klaim</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.executive_metrics.unclaimed_employees_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Kantor & Gudang</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.executive_metrics.office_locations_count} / {ws.executive_metrics.warehouses_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Aktivitas Audit 24 Jam</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.executive_metrics.audit_events_24h}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <h4 className="font-display text-sm font-bold text-text-primary">
                  Distribusi Karyawan per Role
                </h4>
                <div className="flex flex-wrap gap-2">
                  {ws.role_distribution.map((r) => (
                    <span
                      key={r.role_code}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-text-primary"
                    >
                      <span>{r.role_name}</span>
                      <span className="font-mono text-accent">{r.employee_count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-bold text-text-primary">
                    Titik Geofence Kantor
                  </h4>
                  <Link
                    to="/attendance"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                  >
                    Buka Peta <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
                {ws.offices.length === 0 ? (
                  <p className="text-xs text-text-secondary">Belum ada lokasi kantor.</p>
                ) : (
                  <ul className="space-y-2">
                    {ws.offices.map((off) => (
                      <li
                        key={off.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-text-primary">{off.name}</span>
                        <span className="font-mono text-text-secondary">
                          {off.work_start_time}-{off.work_end_time} · {off.radius_meters} m
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {ws.kind === 'finance' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text-primary">
                Likuiditas, Kewajiban & Rekening Aktif
              </h3>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/finance"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                >
                  <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                  Buka Modul Keuangan
                </Link>
                <Link
                  to="/payroll"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                >
                  <Banknote className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  Cairkan Payroll
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Kas Masuk (30 Hari)</p>
                <p className="mt-1 font-mono text-lg font-bold text-success">
                  {formatRupiah(ws.finance_metrics.month_income)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Kas Keluar (30 Hari)</p>
                <p className="mt-1 font-mono text-lg font-bold text-danger">
                  {formatRupiah(ws.finance_metrics.month_expense)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Piutang Terbuka</p>
                <p className="mt-1 font-mono text-lg font-bold text-text-primary">
                  {formatRupiah(ws.finance_metrics.open_receivable_total)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Hutang Terbuka</p>
                <p className="mt-1 font-mono text-lg font-bold text-text-primary">
                  {formatRupiah(ws.finance_metrics.open_payable_total)}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <h4 className="font-display text-sm font-bold text-text-primary">
                Saldo Rekening Kas & Bank ({ws.finance_metrics.active_accounts_count})
              </h4>
              {ws.accounts_preview.length === 0 ? (
                <EmptyState
                  title="Belum ada rekening kas"
                  description="Buat rekening kas atau bank dari halaman Keuangan."
                />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {ws.accounts_preview.map((acc) => (
                    <div
                      key={acc.id}
                      className="rounded-md border border-border bg-surface-subtle p-3"
                    >
                      <p className="text-xs font-semibold text-text-primary">{acc.name}</p>
                      <p className="text-[11px] uppercase text-text-secondary">{acc.type}</p>
                      <p className="mt-2 font-mono text-sm font-bold text-text-primary">
                        {formatRupiah(acc.balance)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {ws.kind === 'warehouse' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text-primary">
                Operasional Gudang & Prioritas Restock
              </h3>
              <Link
                to="/inventory"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
              >
                <Warehouse className="h-3.5 w-3.5" aria-hidden="true" />
                Kelola Stok & PO
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Gudang Terdaftar</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.warehouse_metrics.warehouses_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">SKU Katalog Aktif</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.warehouse_metrics.active_items_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">PO Berjalan</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.warehouse_metrics.open_purchase_orders}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Mutasi Saya (30h)</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.warehouse_metrics.my_movements_30d}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <h4 className="font-display text-sm font-bold text-text-primary">
                Item Menyentuh Batas Minimum
              </h4>
              {ws.low_stock_preview.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  Semua stok gudang aman di atas batas minimum.
                </p>
              ) : (
                <div className="space-y-2">
                  {ws.low_stock_preview.map((item) => (
                    <div
                      key={`${item.item_id}-${item.warehouse_name}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                        <span className="font-semibold text-text-primary">
                          {item.name} ({item.sku})
                        </span>
                        <span className="text-text-secondary">{item.warehouse_name}</span>
                      </div>
                      <StatusBadge
                        tone="warning"
                        label={`Sisa ${item.qty} / Min ${item.min_stock} ${item.unit}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {ws.kind === 'hr' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text-primary">
                SDM, Verifikasi Kehadiran & Aktivasi Karyawan
              </h3>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/attendance"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                >
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Tinjau Izin & Absensi
                </Link>
                <Link
                  to="/rbac"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                >
                  <Users className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  Direktori Karyawan
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Hadir Hari Ini</p>
                <p className="mt-1 font-mono text-xl font-bold text-success">
                  {ws.hr_metrics.present_today_count} org
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Izin Menunggu Approval</p>
                <p className="mt-1 font-mono text-xl font-bold text-warning">
                  {ws.hr_metrics.pending_attendance_approvals}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Draft Payroll Run</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">
                  {ws.hr_metrics.draft_payroll_runs}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-text-secondary">Belum Aktivasi Akun</p>
                <p className="mt-1 font-mono text-xl font-bold text-info">
                  {ws.hr_metrics.unclaimed_employees_count}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-4 space-y-2.5">
                <h4 className="font-display text-sm font-bold text-text-primary">
                  Antrean Pengajuan Izin / Sakit
                </h4>
                {ws.pending_leaves_preview.length === 0 ? (
                  <p className="text-xs text-text-secondary">Tidak ada pengajuan pending.</p>
                ) : (
                  ws.pending_leaves_preview.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text-primary">
                          {row.employee_name} ({row.employee_code})
                        </p>
                        <p className="truncate text-text-secondary">
                          {formatDateId(row.attendance_date)} · {row.note ?? 'Pengajuan izin'}
                        </p>
                      </div>
                      <StatusBadge tone="warning" label={row.status.toUpperCase()} />
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-lg border border-border bg-surface p-4 space-y-2.5">
                <h4 className="font-display text-sm font-bold text-text-primary">
                  Karyawan Belum Aktivasi Akun
                </h4>
                {ws.unclaimed_employees_preview.length === 0 ? (
                  <p className="text-xs text-text-secondary">Semua karyawan aktif telah menautkan akun.</p>
                ) : (
                  ws.unclaimed_employees_preview.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text-primary">
                          {e.full_name} ({e.employee_code})
                        </p>
                        <p className="truncate text-text-secondary">{e.email}</p>
                      </div>
                      <StatusBadge tone="info" label={e.role_name} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {ws.kind === 'staff' ? (
          <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-accent" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-text-primary">
                  Jadwal Shift & Lokasi Kerja Terdaftar
                </h3>
              </div>
              <Link
                to="/attendance"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Buka Halaman Absensi
              </Link>
            </div>
            {ws.offices.length === 0 ? (
              <p className="text-xs text-text-secondary">Belum ada jadwal lokasi kantor.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ws.offices.map((off) => (
                  <div
                    key={off.id}
                    className="flex items-center justify-between rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-text-primary">{off.name}</p>
                      <p className="text-text-secondary">
                        Jam kerja {off.work_start_time} - {off.work_end_time}
                      </p>
                    </div>
                    <StatusBadge tone="accent" label={`Radius ${off.radius_meters} m`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Main 2-column Personal Identity, Payroll Slips & RBAC Capability Matrix */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-5">
          {/* Edit Identity Form */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-text-primary">
              Identitas & Kontak Akun
            </h3>
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div>
                <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-text-secondary">
                  Nama Lengkap
                </label>
                <input
                  id={nameId}
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-text-primary"
                />
              </div>
              <div>
                <label htmlFor={usernameId} className="mb-1 block text-xs font-medium text-text-secondary">
                  Username Login (opsional)
                </label>
                <input
                  id={usernameId}
                  type="text"
                  value={username}
                  placeholder="contoh: alul.studio"
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-text-primary"
                />
              </div>
              <div>
                <label htmlFor={phoneId} className="mb-1 block text-xs font-medium text-text-secondary">
                  Nomor Telepon
                </label>
                <input
                  id={phoneId}
                  type="tel"
                  value={phone}
                  placeholder="08xxxxxxxxxx"
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-text-primary"
                />
              </div>

              {formMsg ? (
                <p
                  role="status"
                  className={`flex items-center gap-1.5 text-xs font-medium ${
                    formMsg.kind === 'ok' ? 'text-success' : 'text-danger'
                  }`}
                >
                  {formMsg.kind === 'ok' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : null}
                  {formMsg.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={updateMut.isPending}
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                {updateMut.isPending ? 'Menyimpan...' : 'Simpan Perubahan Profil'}
              </button>
            </form>

            <div className="border-t border-border pt-3 text-xs text-text-secondary space-y-1">
              <p>Bergabung sejak: {formatDateId(emp.created_at)}</p>
              <p>
                Perangkat push aktif: {data.security.device_platforms.flutter} Android ·{' '}
                {data.security.device_platforms.web} Web
              </p>
            </div>
          </section>

          {/* Data Wajah (Absensi) */}
          {(() => {
            const face = data.face_enrollment ?? {
              enrolled: false,
              enrolled_at: null,
              models: [],
              has_reference_photo: false,
              reference_photo_url: null,
              sample_count: 0,
              poses: [],
              is_multi_pose: false,
            };
            const platformLabels = face.models.map((m) =>
              m === 'mobile_facenet_192d' ? 'Android' : 'Web',
            );
            return (
              <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ScanFace className="h-4 w-4 text-accent" aria-hidden="true" />
                    <h3 className="font-display text-base font-bold text-text-primary">
                      Data Wajah (Absensi)
                    </h3>
                  </div>
                  <StatusBadge
                    tone={
                      !face.enrolled
                        ? 'neutral'
                        : face.is_multi_pose
                          ? 'success'
                          : 'warning'
                    }
                    label={
                      !face.enrolled
                        ? 'Belum Terdaftar'
                        : face.is_multi_pose
                          ? `Terdaftar · ${face.sample_count ?? 4} Sudut`
                          : 'Perlu Pembaruan'
                    }
                  />
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border bg-surface-subtle p-3">
                  {face.reference_photo_url ? (
                    <img
                      src={face.reference_photo_url}
                      alt={`Foto acuan wajah ${emp.full_name}`}
                      width={52}
                      height={52}
                      className="h-[52px] w-[52px] shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md border border-border bg-surface text-accent">
                      <ScanFace className="h-6 w-6" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold text-text-primary">
                      {face.enrolled ? 'Wajah Acuan Aktif' : 'Belum Ada Data Wajah'}
                    </p>
                    <p className="mt-0.5 text-text-secondary">
                      {face.enrolled
                        ? `Terdaftar ${face.enrolled_at ? formatDateTimeId(face.enrolled_at) : ''}${
                            platformLabels.length > 0 ? ` · ${platformLabels.join(', ')}` : ''
                          }`
                        : 'Daftarkan wajah 4 tahap untuk mengaktifkan absensi scan wajah.'}
                    </p>
                  </div>
                </div>

                {face.enrolled && !face.is_multi_pose ? (
                  <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-text-primary">
                    Data wajah lama masih menggunakan 1 sampel. Disarankan perbarui dengan scan 4 sudut agar absensi lebih stabil.
                  </p>
                ) : null}

                {faceMsg ? (
                  <p
                    role="status"
                    className={`flex items-center gap-1.5 text-xs font-medium ${
                      faceMsg.kind === 'ok' ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {faceMsg.kind === 'ok' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : null}
                    {faceMsg.text}
                  </p>
                ) : null}

                {confirmDeleteFace ? (
                  <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-xs space-y-2">
                    <p className="font-semibold text-text-primary">
                      Hapus data wajah terdaftar sekarang?
                    </p>
                    <p className="text-text-secondary">
                      Anda harus mendaftar ulang sebelum dapat absensi dengan scan wajah.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={deleteFaceMut.isPending}
                        onClick={() => deleteFaceMut.mutate()}
                        className="inline-flex h-8 items-center justify-center rounded-md bg-danger px-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {deleteFaceMut.isPending ? 'Menghapus...' : 'Ya, Hapus'}
                      </button>
                      <button
                        type="button"
                        disabled={deleteFaceMut.isPending}
                        onClick={() => setConfirmDeleteFace(false)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-border-strong bg-surface px-3 font-semibold text-text-primary hover:bg-surface-subtle"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFaceMsg(null);
                        setFaceModalOpen(true);
                      }}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {face.enrolled ? 'Perbarui Data Wajah' : 'Daftarkan Wajah (4 Tahap)'}
                    </button>
                    {face.enrolled ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFaceMsg(null);
                          setConfirmDeleteFace(true);
                        }}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#FCA5A5] bg-surface px-3 text-xs font-semibold text-[#991B1B] hover:bg-danger-soft dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Hapus
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Versi Aplikasi & Pembaruan */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-accent" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-text-primary">
                  Versi Aplikasi &amp; Pembaruan
                </h3>
              </div>
              {versionQuery.data?.has_update && versionQuery.data.latest ? (
                <StatusBadge
                  tone="warning"
                  label={`Update v${versionQuery.data.latest.version}`}
                />
              ) : (
                <StatusBadge tone="success" label="Versi Terbaru" />
              )}
            </div>

            <div className="rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-xs space-y-1">
              <p className="font-mono font-bold text-text-primary">
                MyEkalliptus Web · v{WEB_APP_VERSION} (Build {WEB_APP_BUILD_NUMBER})
              </p>
              <p className="text-text-secondary">
                {versionQuery.data?.has_update && versionQuery.data.latest
                  ? `Pembaruan v${versionQuery.data.latest.version} tersedia: ${versionQuery.data.latest.title}`
                  : 'Lihat riwayat pembaruan atau periksa rilis terbaru secara manual.'}
              </p>
            </div>

            {versionFeedback ? (
              <p role="status" className="text-xs font-medium text-accent">
                {versionFeedback}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Lihat Changelog
              </button>
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={() => void handleManualCheckUpdate()}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {checkingUpdate ? 'Memeriksa...' : 'Cek Update'}
              </button>
            </div>

            <DownloadAppButton variant="card" className="w-full justify-center" />
          </section>

          {/* Compensation & Slips */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-accent" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-text-primary">
                  Kompensasi & Slip Gaji Pribadi
                </h3>
              </div>
              <button
                type="button"
                aria-label={showSalary ? 'Sembunyikan nominal gaji' : 'Tampilkan nominal gaji'}
                onClick={() => setShowSalary((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-text-primary hover:border-accent"
              >
                {showSalary ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Sembunyikan
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Tampilkan
                  </>
                )}
              </button>
            </div>

            <div className="rounded-md border border-border bg-surface-subtle p-3">
              <p className="text-xs text-text-secondary">Gaji Pokok Terdaftar</p>
              <p className="mt-1 font-mono text-lg font-bold text-text-primary">
                {showSalary ? formatRupiah(emp.base_salary) : 'Rp •••••••'}
              </p>
            </div>

            {data.personal_payroll.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Belum ada slip gaji yang diterbitkan untuk akun Anda.
              </p>
            ) : (
              <div className="space-y-2">
                {data.personal_payroll.map((slip) => (
                  <div
                    key={slip.item_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-text-primary">
                        {formatDateId(slip.period_start)} - {formatDateId(slip.period_end)}
                      </p>
                      <p className="text-text-secondary">
                        Bersih: {showSalary ? formatRupiah(slip.net_salary) : 'Rp •••••••'} ·{' '}
                        {slip.run_status.toUpperCase()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await erpApi.payroll.slipUrl(slip.item_id);
                        if (res.download_url) {
                          window.open(res.download_url, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface px-2.5 py-1 font-semibold text-text-primary hover:border-accent"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Slip PDF
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6 xl:col-span-7">
          {/* Personal 30-day Attendance */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold text-text-primary">
                Rekap Kehadiran Pribadi ({data.personal_attendance.days_window} Hari Terakhir)
              </h3>
              <Link to="/attendance" className="text-xs font-semibold text-accent hover:underline">
                Buka Riwayat Absensi
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-text-secondary">Hadir</p>
                <p className="mt-1 font-mono text-base font-bold text-text-primary">
                  {data.personal_attendance.present_days} hr
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-text-secondary">Terlambat</p>
                <p className="mt-1 font-mono text-base font-bold text-warning">
                  {data.personal_attendance.late_days} hr
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-text-secondary">Izin / Sakit</p>
                <p className="mt-1 font-mono text-base font-bold text-info">
                  {data.personal_attendance.leave_days + data.personal_attendance.sick_days} hr
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface-subtle p-3">
                <p className="text-xs text-text-secondary">Lembur</p>
                <p className="mt-1 font-mono text-base font-bold text-success">
                  {data.personal_attendance.total_overtime_minutes} mnt
                </p>
              </div>
            </div>

            {data.personal_attendance.recent_records.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Belum ada catatan absensi pribadi dalam 30 hari terakhir.
              </p>
            ) : (
              <div className="space-y-2">
                {data.personal_attendance.recent_records.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-text-primary">
                        {formatDateId(rec.attendance_date)} · {rec.office_name ?? 'Lokasi Kantor'}
                      </p>
                      <p className="text-text-secondary">
                        Masuk {formatDateTimeId(rec.clock_in_at)} · Pulang{' '}
                        {formatDateTimeId(rec.clock_out_at)}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        rec.status === 'present'
                          ? 'success'
                          : rec.status === 'late'
                            ? 'warning'
                            : 'info'
                      }
                      label={rec.status.toUpperCase()}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6-Module RBAC Capability Matrix */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-text-primary">
                  Matriks Hak Akses Role ({data.permissions.length} / 36 Izin)
                </h3>
              </div>
              {data.role.code === 'owner' ? (
                <Link to="/rbac" className="text-xs font-semibold text-accent hover:underline">
                  Ubah Izin Role
                </Link>
              ) : null}
            </div>
            {data.role.description ? (
              <p className="text-xs text-text-secondary">{data.role.description}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {MODULE_LABELS.map((mod) => {
                const granted = ACTION_LABELS.filter((act) =>
                  data.permissions.includes(`${mod.key}:${act.key}`),
                );
                return (
                  <div
                    key={mod.key}
                    className="rounded-md border border-border bg-surface-subtle p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-primary">{mod.label}</span>
                      <span className="text-[11px] text-text-secondary">
                        {granted.length === 0 ? 'Tidak ada akses' : `${granted.length} izin`}
                      </span>
                    </div>
                    {granted.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {granted.map((g) => (
                          <span
                            key={g.key}
                            className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-[#115E59] dark:text-[#34D399]"
                          >
                            {g.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Personal Recent Audit Actions */}
          <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <h3 className="font-display text-base font-bold text-text-primary">
              Riwayat Aktivitas Pribadi
            </h3>
            {data.security.recent_audit_actions.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Belum ada aktivitas audit pribadi yang tercatat.
              </p>
            ) : (
              <div className="space-y-2">
                {data.security.recent_audit_actions.map((act) => (
                  <div
                    key={act.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-text-primary">
                        {act.module.toUpperCase()} · {act.action}
                      </p>
                      <p className="text-text-secondary">{formatDateTimeId(act.created_at)}</p>
                    </div>
                    <StatusBadge
                      tone={act.platform === 'flutter' ? 'info' : 'accent'}
                      label={formatPlatformLabel(act.platform)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <AppChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        result={versionQuery.data ?? null}
        isOwner={data.role.code === 'owner'}
        checking={checkingUpdate}
        onCheckUpdate={() => void handleManualCheckUpdate()}
        onPublished={() => queryClient.invalidateQueries({ queryKey: ['app', 'version'] })}
      />

      <AppUpdateModal
        open={Boolean(manualUpdateResult)}
        result={manualUpdateResult}
        onLater={() => setManualUpdateResult(null)}
        onUpdate={(url) => void applyWebUpdate(url)}
      />

      <FaceVerificationModal
        open={faceModalOpen}
        mode="enroll"
        replace={Boolean(data.face_enrollment?.enrolled)}
        employeeName={emp.full_name}
        faceStatus={data.face_enrollment ?? null}
        allowQrFallback={false}
        onClose={() => setFaceModalOpen(false)}
        onVerifiedFace={() => {}}
        onEnrolled={() => {
          setFaceMsg({
            kind: 'ok',
            text: data.face_enrollment?.enrolled
              ? 'Data wajah berhasil diperbarui.'
              : 'Data wajah berhasil didaftarkan.',
          });
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
            queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] }),
          ]);
        }}
      />
    </div>
  );
}
