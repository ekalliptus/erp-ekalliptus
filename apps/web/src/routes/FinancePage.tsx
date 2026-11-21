import { hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Check,
  FileText,
  Paperclip,
  Plus,
  Receipt,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { AccountCardsSkeleton, TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type FinanceAccount,
  type FinanceObligation,
  type FinanceTransaction,
  type MeResponse,
} from '../lib/api.ts';
import { formatDateId, formatDateTimeId, formatRupiah } from '../lib/format.ts';

type FinanceTab = 'transactions' | 'accounts' | 'obligations';

export function FinancePage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'finance', 'view');
  const canCreate = hasPermission(me.permissions, 'finance', 'create');
  const canApprove = hasPermission(me.permissions, 'finance', 'approve');
  const canExport = hasPermission(me.permissions, 'finance', 'export');

  const [tab, setTab] = useState<FinanceTab>('transactions');
  const [typeFilter, setTypeFilter] = useState('all');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // SlideOver states
  const [txDrawerOpen, setTxDrawerOpen] = useState(false);
  const [accDrawerOpen, setAccDrawerOpen] = useState(false);
  const [catDrawerOpen, setCatDrawerOpen] = useState(false);
  const [obDrawerOpen, setObDrawerOpen] = useState(false);
  const [payObTarget, setPayObTarget] = useState<FinanceObligation | null>(null);

  // Create transaction state
  const [txType, setTxType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [txAccountId, setTxAccountId] = useState('');
  const [txTargetAccountId, setTxTargetAccountId] = useState('');
  const [txCategoryId, setTxCategoryId] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txStatus, setTxStatus] = useState<'posted' | 'pending'>('posted');
  const [txReceiptKey, setTxReceiptKey] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  // Create account state
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<FinanceAccount['type']>('cash');
  const [accNumber, setAccNumber] = useState('');
  const [accInitial, setAccInitial] = useState('0');

  // Create category state
  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState<'income' | 'expense'>('expense');

  // Create obligation state
  const [obKind, setObKind] = useState<'receivable' | 'payable'>('receivable');
  const [obCounterparty, setObCounterparty] = useState('');
  const [obAmount, setObAmount] = useState('');
  const [obDueDate, setObDueDate] = useState('');
  const [obNote, setObNote] = useState('');

  // Pay obligation state
  const [payAccId, setPayAccId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const accountsQuery = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: erpApi.finance.accounts,
    enabled: canView,
  });

  const categoriesQuery = useQuery({
    queryKey: ['finance', 'categories'],
    queryFn: erpApi.finance.categories,
    enabled: canView,
  });

  const transactionsQuery = useQuery({
    queryKey: ['finance', 'transactions'],
    queryFn: erpApi.finance.transactions,
    enabled: canView,
  });

  const obligationsQuery = useQuery({
    queryKey: ['finance', 'obligations'],
    queryFn: erpApi.finance.obligations,
    enabled: canView,
  });

  const summaryQuery = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: erpApi.finance.summary,
    enabled: canView,
  });

  const invalidateAllFinance = async () => {
    await queryClient.invalidateQueries({ queryKey: ['finance'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const createTxMutation = useMutation({
    mutationFn: erpApi.finance.createTransaction,
    onSuccess: async (res) => {
      await invalidateAllFinance();
      setTxDrawerOpen(false);
      setTxAmount('');
      setTxDesc('');
      setTxReceiptKey(null);
      setFeedback({
        kind: 'success',
        text: `Transaksi berhasil disimpan (TXID ${res.txid || 'posted'}).`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const approveTxMutation = useMutation({
    mutationFn: erpApi.finance.approveTransaction,
    onSuccess: async () => {
      await invalidateAllFinance();
      setFeedback({ kind: 'success', text: 'Transaksi pending berhasil disetujui & diposting.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const voidTxMutation = useMutation({
    mutationFn: erpApi.finance.voidTransaction,
    onSuccess: async () => {
      await invalidateAllFinance();
      setFeedback({ kind: 'success', text: 'Transaksi dibatalkan (void) dan saldo dikembalikan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createAccMutation = useMutation({
    mutationFn: erpApi.finance.createAccount,
    onSuccess: async () => {
      await invalidateAllFinance();
      setAccDrawerOpen(false);
      setAccName('');
      setAccNumber('');
      setAccInitial('0');
      setFeedback({ kind: 'success', text: 'Rekening kas baru berhasil ditambahkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createCatMutation = useMutation({
    mutationFn: erpApi.finance.createCategory,
    onSuccess: async () => {
      await invalidateAllFinance();
      setCatDrawerOpen(false);
      setCatName('');
      setFeedback({ kind: 'success', text: 'Kategori transaksi berhasil ditambahkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const createObMutation = useMutation({
    mutationFn: erpApi.finance.createObligation,
    onSuccess: async () => {
      await invalidateAllFinance();
      setObDrawerOpen(false);
      setObCounterparty('');
      setObAmount('');
      setObDueDate('');
      setObNote('');
      setFeedback({ kind: 'success', text: 'Catatan hutang/piutang berhasil ditambahkan.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const payObMutation = useMutation({
    mutationFn: (vars: { id: string; account_id: string; amount: number; note?: string | null }) =>
      erpApi.finance.payObligation(vars.id, {
        account_id: vars.account_id,
        amount: vars.amount,
        note: vars.note,
      }),
    onSuccess: async () => {
      await invalidateAllFinance();
      setPayObTarget(null);
      setPayAmount('');
      setPayNote('');
      setFeedback({ kind: 'success', text: 'Pembayaran kewajiban berhasil diposting ke kas.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const categories = categoriesQuery.data?.categories ?? [];
  const obligations = obligationsQuery.data?.obligations ?? [];

  const filteredTransactions = useMemo(() => {
    const rows = transactionsQuery.data?.transactions ?? [];
    if (typeFilter === 'all') return rows;
    return rows.filter((r) => r.type === typeFilter);
  }, [transactionsQuery.data, typeFilter]);

  async function handleReceiptUpload(file: File | undefined) {
    if (!file) return;
    setUploadingReceipt(true);
    setFeedback(null);
    try {
      const key = await uploadFileViaPresign('receipt', file);
      setTxReceiptKey(key);
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function openReceipt(objectKey: string) {
    try {
      const res = await erpApi.storage.presignDownload(objectKey);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
  }

  async function openInvoicePdf(id: string) {
    try {
      const res = await erpApi.finance.invoicePdf(id);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message });
    }
  }

  const txColumns = useMemo<Array<ColumnDef<FinanceTransaction, any>>>(
    () => [
      {
        accessorKey: 'transacted_at',
        header: 'Waktu',
        cell: ({ row }) => (
          <span className="text-xs text-text-secondary">
            {formatDateTimeId(row.original.transacted_at)}
          </span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Jenis',
        cell: ({ row }) => {
          const t = row.original.type;
          return (
            <StatusBadge
              tone={t === 'income' ? 'success' : t === 'expense' ? 'danger' : 'info'}
              label={t === 'income' ? 'Masuk' : t === 'expense' ? 'Keluar' : 'Transfer'}
            />
          );
        },
      },
      {
        accessorKey: 'description',
        header: 'Deskripsi',
        cell: ({ row }) => (
          <div className="max-w-xs truncate">
            <p className="truncate font-medium text-text-primary">{row.original.description}</p>
            <p className="truncate text-xs text-text-secondary">
              {row.original.account_name}
              {row.original.category_name ? ` / ${row.original.category_name}` : ''}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Nominal',
        cell: ({ row }) => (
          <span className="font-semibold text-text-primary tabular-nums">
            {formatRupiah(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const st = row.original.status;
          return (
            <StatusBadge
              tone={st === 'posted' ? 'accent' : st === 'pending' ? 'warning' : 'neutral'}
              label={st === 'posted' ? 'Posted' : st === 'pending' ? 'Pending' : 'Void'}
            />
          );
        },
      },
      {
        id: 'actions',
        header: 'Aksi',
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {canApprove && r.status === 'pending' ? (
                <button
                  type="button"
                  onClick={() => approveTxMutation.mutate(r.id)}
                  disabled={approveTxMutation.isPending}
                  className="inline-flex items-center gap-1 rounded border border-border-strong bg-accent-soft px-2 py-1 text-xs font-semibold text-[#115E59] dark:text-[#34D399]"
                >
                  <Check className="h-3 w-3" aria-hidden="true" />
                  Setujui
                </button>
              ) : null}
              {canApprove && r.status !== 'void' ? (
                <button
                  type="button"
                  onClick={() => voidTxMutation.mutate(r.id)}
                  disabled={voidTxMutation.isPending}
                  className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-subtle"
                >
                  <Undo2 className="h-3 w-3" aria-hidden="true" />
                  Void
                </button>
              ) : null}
              {r.receipt_object_key ? (
                <button
                  type="button"
                  onClick={() => void openReceipt(r.receipt_object_key!)}
                  className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-subtle"
                >
                  <Paperclip className="h-3 w-3" aria-hidden="true" />
                  Struk
                </button>
              ) : null}
              {canExport ? (
                <button
                  type="button"
                  onClick={() => void openInvoicePdf(r.id)}
                  className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-subtle"
                >
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  PDF
                </button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canApprove, canExport, approveTxMutation, voidTxMutation],
  );

  if (!canView) {
    return (
      <EmptyState
        title="Akses Modul Keuangan Ditolak"
        description="Role Anda tidak memiliki izin finance:view. Hubungi administrator untuk membuka akses."
      />
    );
  }

  function handleOpenTxDrawer() {
    setTxAccountId(accounts[0]?.id ?? '');
    setTxTargetAccountId(accounts[1]?.id ?? '');
    setTxDrawerOpen(true);
  }

  function submitTransaction(e: FormEvent) {
    e.preventDefault();
    const amountNum = Number(txAmount);
    if (!txAccountId || !Number.isInteger(amountNum) || amountNum <= 0 || !txDesc.trim()) {
      setFeedback({
        kind: 'error',
        text: 'Rekening, nominal bulat positif (IDR), dan deskripsi wajib diisi.',
      });
      return;
    }
    createTxMutation.mutate({
      account_id: txAccountId,
      target_account_id: txType === 'transfer' ? txTargetAccountId || null : null,
      category_id: txType === 'transfer' ? null : txCategoryId || null,
      type: txType,
      amount: amountNum,
      description: txDesc.trim(),
      receipt_object_key: txReceiptKey,
      status: txStatus,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Keuangan & Arus Kas
          </h2>
          <p className="text-xs text-text-secondary">
            Mutasi ACID multi-rekening, hutang/piutang, bukti struk Object Storage, dan kwitansi PDF
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <button
              type="button"
              onClick={handleOpenTxDrawer}
              disabled={accounts.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Catat Transaksi
            </button>
          ) : null}
        </div>
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
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-4 underline"
          >
            Tutup
          </button>
        </div>
      ) : null}

      {/* Account balance cards */}
      {accountsQuery.isLoading ? (
        <AccountCardsSkeleton count={4} label="Memuat daftar rekening kas..." />
      ) : accountsQuery.isError ? (
        <ErrorState
          message={(accountsQuery.error as Error).message}
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span className="uppercase font-semibold">{acc.type}</span>
                <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-text-primary">{acc.name}</p>
              <p className="mt-2 text-lg font-bold text-text-primary tabular-nums">
                {formatRupiah(acc.balance)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tabs */}
      <div
        role="tablist"
        aria-label="Submodul keuangan"
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {(
          [
            ['transactions', 'Riwayat Transaksi'],
            ['accounts', 'Rekening & Kategori'],
            ['obligations', 'Hutang & Piutang'],
          ] as Array<[FinanceTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              tab === key
                ? 'bg-accent text-on-accent'
                : 'bg-surface-subtle text-text-primary hover:bg-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'transactions' ? (
        transactionsQuery.isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Memuat riwayat transaksi keuangan..." />
        ) : transactionsQuery.isError ? (
          <ErrorState
            message={(transactionsQuery.error as Error).message}
            onRetry={() => void transactionsQuery.refetch()}
          />
        ) : (
          <DataTable
            data={filteredTransactions}
            columns={txColumns}
            searchPlaceholder="Cari deskripsi, rekening, kategori..."
            filterLabel="Jenis"
            filterValue={typeFilter}
            onFilterChange={setTypeFilter}
            filterOptions={[
              { value: 'all', label: 'Semua Jenis' },
              { value: 'income', label: 'Pemasukan' },
              { value: 'expense', label: 'Pengeluaran' },
              { value: 'transfer', label: 'Transfer Kas' },
            ]}
            enableSelection={canApprove}
            bulkActions={(selected, clear) => (
              <button
                type="button"
                onClick={async () => {
                  const pendings = selected.filter((s) => s.status === 'pending');
                  for (const item of pendings) {
                    await approveTxMutation.mutateAsync(item.id);
                  }
                  clear();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Setujui Terpilih ({selected.filter((s) => s.status === 'pending').length})
              </button>
            )}
            exportConfig={{
              filename: 'transaksi-keuangan-myekalliptus.csv',
              headers: ['ID', 'Waktu', 'Jenis', 'Rekening', 'Kategori', 'Nominal', 'Status', 'Deskripsi'],
              mapRow: (r) => [
                r.id,
                r.transacted_at,
                r.type,
                r.account_name,
                r.category_name || '-',
                r.amount,
                r.status,
                r.description,
              ],
            }}
            emptySlot={
              <EmptyState
                title="Belum ada transaksi tercatat"
                description="Mulai catat pemasukan, pengeluaran, atau transfer antar kas untuk melacak laba/rugi."
                actionLabel={canCreate ? 'Catat Transaksi Pertama' : undefined}
                onAction={canCreate ? handleOpenTxDrawer : undefined}
              />
            }
          />
        )
      ) : null}

      {tab === 'accounts' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-text-primary">
                Daftar Rekening Kas
              </h3>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => setAccDrawerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Tambah Rekening
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border text-sm">
              {accounts.map((acc) => (
                <li key={acc.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-semibold text-text-primary">{acc.name}</p>
                    <p className="text-xs text-text-secondary">
                      {acc.type.toUpperCase()} {acc.account_number ? `(${acc.account_number})` : ''}
                    </p>
                  </div>
                  <span className="font-bold tabular-nums text-text-primary">
                    {formatRupiah(acc.balance)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-text-primary">
                Kategori Keuangan
              </h3>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => setCatDrawerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:border-accent"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Tambah Kategori
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border text-sm">
              {categories.map((cat) => (
                <li key={cat.id} className="flex items-center justify-between py-2">
                  <span className="font-medium text-text-primary">{cat.name}</span>
                  <StatusBadge
                    tone={cat.kind === 'income' ? 'success' : 'warning'}
                    label={cat.kind === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === 'obligations' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
              <span>
                Piutang Terbuka:{' '}
                <strong className="text-text-primary tabular-nums">
                  {formatRupiah(summaryQuery.data?.open_receivable ?? '0')}
                </strong>
              </span>
              <span>
                Hutang Terbuka:{' '}
                <strong className="text-text-primary tabular-nums">
                  {formatRupiah(summaryQuery.data?.open_payable ?? '0')}
                </strong>
              </span>
            </div>
            {canCreate ? (
              <button
                type="button"
                onClick={() => setObDrawerOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent"
              >
                <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                Catat Hutang / Piutang
              </button>
            ) : null}
          </div>

          {obligationsQuery.isLoading ? (
            <TableSkeleton columns={5} rows={4} label="Memuat daftar hutang & piutang..." />
          ) : obligations.length === 0 ? (
            <EmptyState
              title="Belum ada catatan hutang atau piutang"
              description="Catat tagihan pelanggan (piutang) atau kewajiban vendor (hutang) untuk dipantau jatuh temponya."
              actionLabel={canCreate ? 'Buat Catatan Pertama' : undefined}
              onAction={canCreate ? () => setObDrawerOpen(true) : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {obligations.map((ob) => {
                const remaining = BigInt(ob.amount) - BigInt(ob.paid_amount);
                return (
                  <div key={ob.id} className="rounded-lg border border-border bg-surface p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <StatusBadge
                          tone={ob.kind === 'receivable' ? 'info' : 'warning'}
                          label={ob.kind === 'receivable' ? 'Piutang' : 'Hutang'}
                        />
                        <h4 className="mt-1.5 font-semibold text-text-primary">
                          {ob.counterparty_name}
                        </h4>
                      </div>
                      <StatusBadge
                        tone={ob.status === 'paid' ? 'success' : 'neutral'}
                        label={ob.status.toUpperCase()}
                      />
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-text-secondary">
                      <span>
                        Total: <strong className="tabular-nums text-text-primary">{formatRupiah(ob.amount)}</strong>
                      </span>
                      <span>
                        Sisa: <strong className="tabular-nums text-text-primary">{formatRupiah(remaining)}</strong>
                      </span>
                      <span>Jatuh tempo: {formatDateId(ob.due_date)}</span>
                    </div>
                    {canApprove && ob.status !== 'paid' && ob.status !== 'void' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPayObTarget(ob);
                          setPayAccId(accounts[0]?.id ?? '');
                          setPayAmount(remaining.toString());
                        }}
                        className="mt-1 inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-primary hover:border-accent"
                      >
                        Bayar / Catat Pelunasan
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* SlideOver: Catat Transaksi */}
      <SlideOver
        open={txDrawerOpen}
        onClose={() => setTxDrawerOpen(false)}
        title="Catat Transaksi Keuangan"
        subtitle="Eksekusi atomik ACID di PostgreSQL dengan dukungan lampiran struk S3"
      >
        <form onSubmit={submitTransaction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="tx-type" className="block text-xs font-semibold text-text-primary">
              Jenis Transaksi
            </label>
            <select
              id="tx-type"
              value={txType}
              onChange={(e) => setTxType(e.target.value as 'income' | 'expense' | 'transfer')}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="expense">Pengeluaran Kas</option>
              <option value="income">Pemasukan Kas</option>
              <option value="transfer">Transfer Antar Rekening</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tx-account" className="block text-xs font-semibold text-text-primary">
              Rekening Sumber
            </label>
            <select
              id="tx-account"
              value={txAccountId}
              onChange={(e) => setTxAccountId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatRupiah(a.balance)})
                </option>
              ))}
            </select>
          </div>

          {txType === 'transfer' ? (
            <div className="space-y-1.5">
              <label htmlFor="tx-target" className="block text-xs font-semibold text-text-primary">
                Rekening Tujuan
              </label>
              <select
                id="tx-target"
                value={txTargetAccountId}
                onChange={(e) => setTxTargetAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
                required
              >
                {accounts
                  .filter((a) => a.id !== txAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatRupiah(a.balance)})
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="tx-cat" className="block text-xs font-semibold text-text-primary">
                Kategori
              </label>
              <select
                id="tx-cat"
                value={txCategoryId}
                onChange={(e) => setTxCategoryId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                <option value="">Tanpa kategori</option>
                {categories
                  .filter((c) => c.kind === txType)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="tx-amount" className="block text-xs font-semibold text-text-primary">
              Nominal (IDR bulat)
            </label>
            <input
              id="tx-amount"
              type="number"
              min={1}
              step={1}
              required
              value={txAmount}
              onChange={(e) => setTxAmount(e.target.value)}
              placeholder="Contoh: 250000"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tx-desc" className="block text-xs font-semibold text-text-primary">
              Deskripsi Transaksi
            </label>
            <textarea
              id="tx-desc"
              rows={2}
              required
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder="Keperluan pembayaran, nomor invoice, atau referensi"
              className="w-full rounded-md border border-border-strong bg-surface p-2.5 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tx-status" className="block text-xs font-semibold text-text-primary">
              Status Posting
            </label>
            <select
              id="tx-status"
              value={txStatus}
              onChange={(e) => setTxStatus(e.target.value as 'posted' | 'pending')}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="posted">Posted langsung (ubah saldo sekarang)</option>
              <option value="pending">Pending approval</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tx-receipt" className="block text-xs font-semibold text-text-primary">
              Lampiran Struk / Nota (Opsional)
            </label>
            <input
              id="tx-receipt"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => void handleReceiptUpload(e.target.files?.[0])}
              className="block w-full text-xs text-text-secondary"
            />
            {uploadingReceipt ? (
              <p className="text-xs text-text-secondary">Mengunggah ke Neon Object Storage...</p>
            ) : txReceiptKey ? (
              <p className="text-xs font-medium text-success">Terunggah: {txReceiptKey}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={createTxMutation.isPending || uploadingReceipt}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {createTxMutation.isPending ? 'Menyimpan...' : 'Simpan Transaksi'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Tambah Rekening */}
      <SlideOver
        open={accDrawerOpen}
        onClose={() => setAccDrawerOpen(false)}
        title="Tambah Rekening Kas"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createAccMutation.mutate({
              name: accName.trim(),
              type: accType,
              account_number: accNumber.trim() || null,
              initial_balance: Math.max(0, Math.trunc(Number(accInitial) || 0)),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="acc-name" className="block text-xs font-semibold">
              Nama Rekening
            </label>
            <input
              id="acc-name"
              required
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="acc-type" className="block text-xs font-semibold">
              Tipe Rekening
            </label>
            <select
              id="acc-type"
              value={accType}
              onChange={(e) => setAccType(e.target.value as FinanceAccount['type'])}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="cash">Cash / Tunai</option>
              <option value="bank">Rekening Bank</option>
              <option value="ewallet">E-Wallet</option>
              <option value="qris">Merchant QRIS</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="acc-num" className="block text-xs font-semibold">
              Nomor Rekening (Opsional)
            </label>
            <input
              id="acc-num"
              value={accNumber}
              onChange={(e) => setAccNumber(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="acc-init" className="block text-xs font-semibold">
              Saldo Awal (IDR)
            </label>
            <input
              id="acc-init"
              type="number"
              min={0}
              value={accInitial}
              onChange={(e) => setAccInitial(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <button
            type="submit"
            disabled={createAccMutation.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createAccMutation.isPending ? 'Menyimpan...' : 'Simpan Rekening'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Tambah Kategori */}
      <SlideOver
        open={catDrawerOpen}
        onClose={() => setCatDrawerOpen(false)}
        title="Tambah Kategori Keuangan"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createCatMutation.mutate({ name: catName.trim(), kind: catKind });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="cat-name" className="block text-xs font-semibold">
              Nama Kategori
            </label>
            <input
              id="cat-name"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cat-kind" className="block text-xs font-semibold">
              Kelompok
            </label>
            <select
              id="cat-kind"
              value={catKind}
              onChange={(e) => setCatKind(e.target.value as 'income' | 'expense')}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={createCatMutation.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createCatMutation.isPending ? 'Menyimpan...' : 'Simpan Kategori'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Catat Hutang/Piutang */}
      <SlideOver
        open={obDrawerOpen}
        onClose={() => setObDrawerOpen(false)}
        title="Catat Hutang atau Piutang"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createObMutation.mutate({
              kind: obKind,
              counterparty_name: obCounterparty.trim(),
              amount: Math.max(1, Math.trunc(Number(obAmount) || 0)),
              due_date: obDueDate || null,
              note: obNote.trim() || null,
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="ob-kind" className="block text-xs font-semibold">
              Jenis Kewajiban
            </label>
            <select
              id="ob-kind"
              value={obKind}
              onChange={(e) => setObKind(e.target.value as 'receivable' | 'payable')}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              <option value="receivable">Piutang (Tagihan Masuk)</option>
              <option value="payable">Hutang (Kewajiban Keluar)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ob-counterparty" className="block text-xs font-semibold">
              Nama Pihak / Klien / Vendor
            </label>
            <input
              id="ob-counterparty"
              required
              value={obCounterparty}
              onChange={(e) => setObCounterparty(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ob-amount" className="block text-xs font-semibold">
              Nominal (IDR)
            </label>
            <input
              id="ob-amount"
              type="number"
              min={1}
              required
              value={obAmount}
              onChange={(e) => setObAmount(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ob-due" className="block text-xs font-semibold">
              Jatuh Tempo (Opsional)
            </label>
            <input
              id="ob-due"
              type="date"
              value={obDueDate}
              onChange={(e) => setObDueDate(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ob-note" className="block text-xs font-semibold">
              Catatan
            </label>
            <textarea
              id="ob-note"
              rows={2}
              value={obNote}
              onChange={(e) => setObNote(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface p-2.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createObMutation.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
          >
            {createObMutation.isPending ? 'Menyimpan...' : 'Simpan Catatan'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Bayar Hutang/Piutang */}
      <SlideOver
        open={Boolean(payObTarget)}
        onClose={() => setPayObTarget(null)}
        title={payObTarget ? `Pembayaran ${payObTarget.counterparty_name}` : 'Pembayaran'}
      >
        {payObTarget ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              payObMutation.mutate({
                id: payObTarget.id,
                account_id: payAccId,
                amount: Math.max(1, Math.trunc(Number(payAmount) || 0)),
                note: payNote.trim() || null,
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="pay-acc" className="block text-xs font-semibold">
                Rekening Pembayaran
              </label>
              <select
                id="pay-acc"
                value={payAccId}
                onChange={(e) => setPayAccId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatRupiah(a.balance)})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pay-amt" className="block text-xs font-semibold">
                Nominal Dibayar (IDR)
              </label>
              <input
                id="pay-amt"
                type="number"
                min={1}
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pay-note" className="block text-xs font-semibold">
                Catatan (Opsional)
              </label>
              <input
                id="pay-note"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={payObMutation.isPending}
              className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
            >
              {payObMutation.isPending ? 'Memposting...' : 'Konfirmasi Pembayaran'}
            </button>
          </form>
        ) : null}
      </SlideOver>
    </div>
  );
}
