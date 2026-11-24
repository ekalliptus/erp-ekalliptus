import { hasPermission } from '@ekalliptus/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CheckSquare,
  Wallet,
} from 'lucide-react';
import {
  AccountCardsSkeleton,
  CardListSkeleton,
  LazySection,
  SkeletonBlock,
} from '../components/Skeleton.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { erpApi, type MeResponse } from '../lib/api.ts';
import { formatDateId, formatRupiah, parseBigIntSafe } from '../lib/format.ts';

function CashflowChart({
  series,
}: {
  series: Array<{ day: string; income: string; expense: string }>;
}) {
  if (series.length === 0) {
    return null;
  }

  const recent = series.slice(-14);
  const parsed = recent.map((row) => ({
    day: row.day,
    income: Number(parseBigIntSafe(row.income)),
    expense: Number(parseBigIntSafe(row.expense)),
  }));
  const maxVal = Math.max(1, ...parsed.flatMap((d) => [d.income, d.expense]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
        <span>14 hari terakhir aktivitas kas posted (IDR)</span>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden="true" />
            Pemasukan
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
            <span className="h-2.5 w-2.5 rounded-sm bg-danger" aria-hidden="true" />
            Pengeluaran
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${Math.max(420, parsed.length * 44)} 180`}
          role="img"
          aria-label="Grafik batang arus kas harian pemasukan dan pengeluaran"
          className="h-44 w-full min-w-[420px]"
        >
          {parsed.map((item, idx) => {
            const groupX = idx * 44 + 12;
            const incH = Math.round((item.income / maxVal) * 124);
            const expH = Math.round((item.expense / maxVal) * 124);
            return (
              <g key={item.day}>
                <rect
                  x={groupX}
                  y={142 - incH}
                  width={12}
                  height={Math.max(2, incH)}
                  rx={2}
                  fill="var(--ep-accent)"
                >
                  <title>{`${formatDateId(item.day)} Pemasukan: ${formatRupiah(item.income)}`}</title>
                </rect>
                <rect
                  x={groupX + 15}
                  y={142 - expH}
                  width={12}
                  height={Math.max(2, expH)}
                  rx={2}
                  fill="var(--ep-danger)"
                >
                  <title>{`${formatDateId(item.day)} Pengeluaran: ${formatRupiah(item.expense)}`}</title>
                </rect>
                <text
                  x={groupX + 13}
                  y={162}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--ep-text-secondary)"
                >
                  {item.day.slice(5)}
                </text>
              </g>
            );
          })}
          <line
            x1="0"
            y1="144"
            x2={Math.max(420, parsed.length * 44)}
            y2="144"
            stroke="var(--ep-border)"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
}

export function DashboardPage({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const canFinance = hasPermission(me.permissions, 'finance', 'view');
  const canInventory = hasPermission(me.permissions, 'inventory', 'view');
  const canAttendance = hasPermission(me.permissions, 'attendance', 'view');

  const summaryQuery = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: erpApi.finance.summary,
    enabled: canFinance,
  });

  const accountsQuery = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: erpApi.finance.accounts,
    enabled: canFinance,
  });

  const pendingTxQuery = useQuery({
    queryKey: ['finance', 'transactions', 'dashboard'],
    queryFn: erpApi.finance.transactions,
    enabled: canFinance,
  });

  const stocksQuery = useQuery({
    queryKey: ['inventory', 'stocks'],
    queryFn: erpApi.inventory.stocks,
    enabled: canInventory,
  });

  const attendanceQuery = useQuery({
    queryKey: ['attendance', 'records'],
    queryFn: erpApi.attendance.records,
    enabled: canAttendance,
  });

  const lowStocks = (stocksQuery.data?.stocks ?? []).filter((s) => s.is_low_stock);
  const pendingTransactions = (pendingTxQuery.data?.transactions ?? []).filter(
    (t) => t.status === 'pending',
  );
  const pendingAttendances = (attendanceQuery.data?.records ?? []).filter(
    (r) => r.approval_status === 'pending',
  );
  const totalApprovals =
    pendingTransactions.length +
    me.kpis.pending_attendance_approvals +
    me.kpis.draft_payroll_runs;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Command Center
          </p>
          <h2 className="mt-0.5 font-display text-xl font-bold text-text-primary">
            Halo, {me.employee.full_name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="accent" label={`${me.role_name} (${me.permissions.length} izin)`} />
          <StatusBadge tone="neutral" label={`Kode ${me.employee.employee_code}`} />
        </div>
      </div>

      {/* Compact live KPI strip backed by Postgres aggregates */}
      <section aria-label="Indikator utama" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>Total Saldo Kas</span>
            <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xl font-bold text-text-primary tabular-nums">
            {canFinance ? formatRupiah(summaryQuery.data?.total_balance ?? me.kpis.total_cash_balance) : 'Terbatas RBAC'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">Akumulasi rekening aktif</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>Laba / Rugi Posted</span>
            <Banknote className="h-4 w-4 text-accent" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xl font-bold text-text-primary tabular-nums">
            {canFinance ? formatRupiah(summaryQuery.data?.net_profit ?? '0') : 'Terbatas RBAC'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">Selisih pemasukan dan pengeluaran</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>Stok Kritis</span>
            <Boxes className="h-4 w-4 text-warning" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xl font-bold text-text-primary tabular-nums">
            {canInventory ? `${me.kpis.low_stock_alerts} item` : 'Terbatas RBAC'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">Jumlah stok di bawah batas minimum</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>Antrean Persetujuan</span>
            <CheckSquare className="h-4 w-4 text-info" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xl font-bold text-text-primary tabular-nums">
            {totalApprovals} item
          </p>
          <p className="mt-1 text-xs text-text-secondary">Transaksi, izin absensi, dan payroll draft</p>
        </div>
      </section>

      {/* Asymmetric functional hierarchy: wide financial panel left + alert & approval rail right */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-text-primary">
                  Posisi Kas & Arus Kas Real-Time
                </h3>
                <p className="text-xs text-text-secondary">
                  Data live langsung dari tabel transaksi keuangan PostgreSQL
                </p>
              </div>
              {canFinance ? (
                <Link
                  to="/finance"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#115E59] hover:underline dark:text-[#34D399]"
                >
                  <span>Buka Kasir / POS</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>

            {!canFinance ? (
              <EmptyState
                title="Modul Kasir / Keuangan Dibatasi"
                description="Role akun Anda tidak memiliki izin finance:view. Hubungi pemilik sistem untuk melihat rincian arus kas."
              />
            ) : summaryQuery.isLoading || accountsQuery.isLoading ? (
              <div
                role="status"
                aria-live="polite"
                aria-label="Menghitung arus kas dari Neon Postgres..."
                className="space-y-6"
              >
                <SkeletonBlock className="h-44 w-full" />
                <AccountCardsSkeleton count={2} label="Menghitung arus kas dari Neon Postgres..." />
              </div>
            ) : summaryQuery.isError ? (
              <ErrorState
                message={(summaryQuery.error as Error).message}
                onRetry={() => void summaryQuery.refetch()}
              />
            ) : (
              <div className="space-y-6">
                {summaryQuery.data && summaryQuery.data.daily_cashflow.length > 0 ? (
                  <CashflowChart series={summaryQuery.data.daily_cashflow} />
                ) : (
                  <EmptyState
                    title="Belum ada transaksi posted 30 hari terakhir"
                    description="Catat penjualan kasir pertama di modul Kasir / POS untuk memantau arus kas harian."
                    actionLabel="Buka Kasir / POS"
                    onAction={() => void navigate({ to: '/finance' })}
                  />
                )}

                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                    <span className="font-semibold uppercase tracking-wide">
                      Saldo per Rekening Aktif
                    </span>
                    <span className="tabular-nums">
                      Piutang: {formatRupiah(summaryQuery.data?.open_receivable ?? '0')} | Hutang:{' '}
                      {formatRupiah(summaryQuery.data?.open_payable ?? '0')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {(accountsQuery.data?.accounts ?? []).map((acc) => (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between rounded-md border border-border bg-surface-subtle/70 px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-primary">
                            {acc.name}
                          </p>
                          <p className="text-xs uppercase text-text-secondary">
                            {acc.type}
                            {acc.account_number ? ` / ${acc.account_number}` : ''}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-text-primary tabular-nums">
                          {formatRupiah(acc.balance)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6 xl:col-span-4" aria-label="Peringatan dan antrean">
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-text-primary">
                  Peringatan Stok Kritis
                </h3>
              </div>
              {canInventory ? (
                <Link
                  to="/inventory"
                  className="text-xs font-semibold text-[#115E59] hover:underline dark:text-[#34D399]"
                >
                  Kelola
                </Link>
              ) : null}
            </div>

            {!canInventory ? (
              <p className="text-xs text-text-secondary">Akses inventaris tidak aktif pada role ini.</p>
            ) : stocksQuery.isLoading ? (
              <CardListSkeleton count={4} label="Memeriksa level stok gudang..." />
            ) : lowStocks.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Semua item gudang berada di atas batas minimum stok.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {lowStocks.slice(0, 6).map((item) => (
                  <li
                    key={`${item.item_id}-${item.warehouse_id}`}
                    className="flex items-center justify-between gap-2 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-text-primary">{item.name}</p>
                      <p className="truncate text-text-secondary">
                        {item.sku} di {item.warehouse_name}
                      </p>
                    </div>
                    <StatusBadge
                      tone={item.qty === 0 ? 'danger' : 'warning'}
                      label={`${item.qty} / min ${item.min_stock}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <LazySection
            fallback={
              <section className="rounded-lg border border-border bg-surface p-5">
                <CardListSkeleton count={3} label="Memuat antrean persetujuan..." />
              </section>
            }
          >
            <section className="rounded-lg border border-border bg-surface p-5">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
                <h3 className="font-display text-sm font-bold text-text-primary">
                  Antrean Persetujuan
                </h3>
                <StatusBadge tone={totalApprovals > 0 ? 'warning' : 'success'} label={`${totalApprovals} item`} />
              </div>

              <div className="space-y-3 text-xs">
                {canFinance ? (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold text-text-primary">Transaksi Pending</p>
                      <p className="text-text-secondary">{pendingTransactions.length} menunggu approval</p>
                    </div>
                    <Link
                      to="/finance"
                      className="font-semibold text-[#115E59] hover:underline dark:text-[#34D399]"
                    >
                      Tinjau
                    </Link>
                  </div>
                ) : null}

                {canAttendance ? (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold text-text-primary">Pengajuan Cuti/Sakit</p>
                      <p className="text-text-secondary">{pendingAttendances.length} menunggu HR/Owner</p>
                    </div>
                    <Link
                      to="/attendance"
                      className="font-semibold text-[#115E59] hover:underline dark:text-[#34D399]"
                    >
                      Tinjau
                    </Link>
                  </div>
                ) : null}

                {me.role === 'owner' || me.role === 'hr' || me.role === 'finance' ? (
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="font-semibold text-text-primary">Payroll Run Draft</p>
                      <p className="text-text-secondary">{me.kpis.draft_payroll_runs} siap diverifikasi</p>
                    </div>
                    <Link
                      to="/payroll"
                      className="font-semibold text-[#115E59] hover:underline dark:text-[#34D399]"
                    >
                      Tinjau
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>
          </LazySection>
        </aside>
      </div>
    </div>
  );
}
