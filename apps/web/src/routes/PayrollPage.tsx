import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, FileDown, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { CardListSkeleton, TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { erpApi, type MeResponse, type PayrollItemRow } from '../lib/api.ts';
import { formatDateId, formatRupiah } from '../lib/format.ts';

export function PayrollPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'payroll', 'view');
  const canCreate = hasPermission(me.permissions, 'payroll', 'create');
  const canUpdate = hasPermission(me.permissions, 'payroll', 'update');
  const canApprove = hasPermission(me.permissions, 'payroll', 'approve');
  const canFinanceView = hasPermission(me.permissions, 'finance', 'view');

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // SlideOvers
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [payDrawerOpen, setPayDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<PayrollItemRow | null>(null);

  // Form states
  const [periodStart, setPeriodStart] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAccountId, setPayAccountId] = useState('');
  const [editAllowances, setEditAllowances] = useState('0');
  const [editOvertime, setEditOvertime] = useState('0');
  const [editDeductions, setEditDeductions] = useState('0');

  const runsQuery = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: erpApi.payroll.runs,
    enabled: canView,
  });

  const runs = runsQuery.data?.runs ?? [];
  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['payroll', 'run', activeRunId],
    queryFn: () => erpApi.payroll.runDetail(activeRunId!),
    enabled: canView && Boolean(activeRunId),
  });

  const accountsQuery = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: erpApi.finance.accounts,
    enabled: canApprove && canFinanceView,
  });

  const invalidatePayroll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['payroll'] });
    await queryClient.invalidateQueries({ queryKey: ['finance'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const createRunMut = useMutation({
    mutationFn: erpApi.payroll.createRun,
    onSuccess: async (res) => {
      await invalidatePayroll();
      setSelectedRunId(res.run.id);
      setRunDrawerOpen(false);
      setFeedback({
        kind: 'success',
        text: `Periode payroll ${res.run.period_start} s/d ${res.run.period_end} berhasil dibuat (${res.items.length} karyawan).`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const updateItemMut = useMutation({
    mutationFn: (vars: {
      runId: string;
      itemId: string;
      allowances: number;
      overtime_pay: number;
      deductions: number;
    }) =>
      erpApi.payroll.updateItem(vars.runId, vars.itemId, {
        allowances: vars.allowances,
        overtime_pay: vars.overtime_pay,
        deductions: vars.deductions,
      }),
    onSuccess: async () => {
      await invalidatePayroll();
      setEditItem(null);
      setFeedback({ kind: 'success', text: 'Komponen gaji berhasil diperbarui.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const approveRunMut = useMutation({
    mutationFn: erpApi.payroll.approveRun,
    onSuccess: async () => {
      await invalidatePayroll();
      setFeedback({ kind: 'success', text: 'Payroll disetujui dan siap dibayarkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const payRunMut = useMutation({
    mutationFn: (vars: { runId: string; accountId: string }) =>
      erpApi.payroll.payRun(vars.runId, vars.accountId),
    onSuccess: async () => {
      await invalidatePayroll();
      setPayDrawerOpen(false);
      setFeedback({
        kind: 'success',
        text: 'Payroll dibayarkan, slip PDF dibuat, dan pengeluaran tercatat di Keuangan secara atomik.',
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  async function downloadSlip(itemId: string) {
    try {
      const res = await erpApi.payroll.slipUrl(itemId);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
  }

  if (!canView) {
    return (
      <EmptyState
        title="Akses Payroll Ditolak"
        description="Role Anda tidak memiliki izin payroll:view."
      />
    );
  }

  const runDetail = detailQuery.data?.run;
  const items = detailQuery.data?.items ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Payroll & Penggajian
          </h2>
          <p className="text-xs text-text-secondary">
            Kalkulasi otomatis terintegrasi absensi, approval bertahap, posting kas ACID, dan Slip
            Gaji PDF
          </p>
        </div>

        {canCreate ? (
          <button
            type="button"
            onClick={() => setRunDrawerOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Buat Periode Payroll
          </button>
        ) : null}
      </div>

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

      {runsQuery.isLoading ? (
        <CardListSkeleton count={4} label="Memuat periode penggajian..." />
      ) : runsQuery.isError ? (
        <ErrorState message={(runsQuery.error as Error).message} onRetry={() => void runsQuery.refetch()} />
      ) : runs.length === 0 ? (
        <EmptyState
          title="Belum ada periode payroll"
          description="Buat periode payroll pertama untuk menghitung gaji pokok, lembur, dan potongan absensi secara otomatis."
          actionLabel={canCreate ? 'Buat Periode Payroll' : undefined}
          onAction={canCreate ? () => setRunDrawerOpen(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Periode Payroll
            </h3>
            {runs.map((run) => {
              const selected = run.id === activeRunId;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border p-3.5 text-left ${
                    selected
                      ? 'border-accent bg-accent-soft/50'
                      : 'border-border bg-surface hover:bg-surface-subtle'
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {formatDateId(run.period_start)} - {formatDateId(run.period_end)}
                    </p>
                    <p className="mt-1 text-xs font-bold tabular-nums text-text-secondary">
                      {formatRupiah(run.total_disbursed)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      run.status === 'paid'
                        ? 'success'
                        : run.status === 'approved'
                          ? 'info'
                          : 'warning'
                    }
                    label={run.status.toUpperCase()}
                  />
                </button>
              );
            })}
          </div>

          <div className="space-y-4 lg:col-span-8">
            {detailQuery.isLoading ? (
              <TableSkeleton columns={6} rows={5} label="Memuat rincian slip gaji..." />
            ) : runDetail ? (
              <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <p className="text-xs text-text-secondary">Total Pencairan Bersih</p>
                    <p className="text-xl font-bold tabular-nums text-text-primary">
                      {formatRupiah(runDetail.total_disbursed)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canApprove && runDetail.status === 'draft' ? (
                      <button
                        type="button"
                        disabled={approveRunMut.isPending}
                        onClick={() => approveRunMut.mutate(runDetail.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Setujui Draft
                      </button>
                    ) : null}

                    {canApprove && runDetail.status === 'approved' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPayAccountId(accounts[0]?.id ?? '');
                          setPayDrawerOpen(true);
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                      >
                        <Banknote className="h-4 w-4" aria-hidden="true" />
                        Bayar & Posting Keuangan
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-b border-border bg-surface-subtle text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Karyawan</th>
                        <th className="px-3 py-2 font-semibold">Gaji Pokok</th>
                        <th className="px-3 py-2 font-semibold">Tunjangan</th>
                        <th className="px-3 py-2 font-semibold">Lembur</th>
                        <th className="px-3 py-2 font-semibold">Potongan</th>
                        <th className="px-3 py-2 font-semibold">Take-Home</th>
                        <th className="px-3 py-2 font-semibold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((it) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-text-primary">{it.full_name}</p>
                            <p className="text-[11px] text-text-secondary">{it.employee_code}</p>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">{formatRupiah(it.base_salary)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{formatRupiah(it.allowances)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{formatRupiah(it.overtime_pay)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{formatRupiah(it.deductions)}</td>
                          <td className="px-3 py-2.5 font-bold tabular-nums text-text-primary">
                            {formatRupiah(it.net_salary)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {canUpdate && runDetail.status === 'draft' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditItem(it);
                                    setEditAllowances(it.allowances);
                                    setEditOvertime(it.overtime_pay);
                                    setEditDeductions(it.deductions);
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-[11px] font-semibold"
                                >
                                  <Pencil className="h-3 w-3" aria-hidden="true" />
                                  Edit
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void downloadSlip(it.id)}
                                className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-[11px] font-semibold"
                              >
                                <FileDown className="h-3 w-3" aria-hidden="true" />
                                Slip PDF
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* SlideOver: Buat Periode Payroll */}
      <SlideOver
        open={runDrawerOpen}
        onClose={() => setRunDrawerOpen(false)}
        title="Buat Periode Payroll"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createRunMut.mutate({ period_start: periodStart, period_end: periodEnd });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="pr-start" className="block text-xs font-semibold">
              Tanggal Mulai
            </label>
            <input
              id="pr-start"
              type="date"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="pr-end" className="block text-xs font-semibold">
              Tanggal Selesai
            </label>
            <input
              id="pr-end"
              type="date"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createRunMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createRunMut.isPending ? 'Menghitung...' : 'Generate Draft Payroll'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Edit Item Payroll */}
      <SlideOver
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        title={editItem ? `Sesuaikan Gaji ${editItem.full_name}` : 'Edit Payroll Item'}
      >
        {editItem && activeRunId ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateItemMut.mutate({
                runId: activeRunId,
                itemId: editItem.id,
                allowances: Math.max(0, Math.trunc(Number(editAllowances) || 0)),
                overtime_pay: Math.max(0, Math.trunc(Number(editOvertime) || 0)),
                deductions: Math.max(0, Math.trunc(Number(editDeductions) || 0)),
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label htmlFor="ed-alw" className="block text-xs font-semibold">
                Tunjangan (IDR)
              </label>
              <input
                id="ed-alw"
                type="number"
                min={0}
                value={editAllowances}
                onChange={(e) => setEditAllowances(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-ovt" className="block text-xs font-semibold">
                Upah Lembur (IDR)
              </label>
              <input
                id="ed-ovt"
                type="number"
                min={0}
                value={editOvertime}
                onChange={(e) => setEditOvertime(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-ded" className="block text-xs font-semibold">
                Potongan (IDR)
              </label>
              <input
                id="ed-ded"
                type="number"
                min={0}
                value={editDeductions}
                onChange={(e) => setEditDeductions(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <button
              type="submit"
              disabled={updateItemMut.isPending}
              className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
            >
              {updateItemMut.isPending ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </form>
        ) : null}
      </SlideOver>

      {/* SlideOver: Bayar Payroll */}
      <SlideOver
        open={payDrawerOpen}
        onClose={() => setPayDrawerOpen(false)}
        title="Bayar & Posting Penggajian"
        subtitle="Mengurangi saldo kas sumber dan mencatat transaksi pengeluaran payroll secara atomik"
      >
        {runDetail ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              payRunMut.mutate({ runId: runDetail.id, accountId: payAccountId });
            }}
            className="space-y-4"
          >
            <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs">
              <p className="text-text-secondary">Nominal dibayarkan</p>
              <p className="mt-1 text-base font-bold tabular-nums text-text-primary">
                {formatRupiah(runDetail.total_disbursed)}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="pay-fin-acc" className="block text-xs font-semibold">
                Sumber Rekening Kas
              </label>
              <select
                id="pay-fin-acc"
                required
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatRupiah(a.balance)})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={payRunMut.isPending || !payAccountId}
              className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              {payRunMut.isPending ? 'Memproses pencairan...' : 'Cairkan & Terbitkan Slip'}
            </button>
          </form>
        ) : null}
      </SlideOver>
    </div>
  );
}
