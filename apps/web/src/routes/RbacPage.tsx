import { ERP_ACTIONS, ERP_MODULES, hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Check,
  Copy,
  KeyRound,
  Link2Off,
  Pencil,
  ScanFace,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { ApiError, erpApi, type EmployeeRow, type MeResponse } from '../lib/api.ts';
import { formatRupiah } from '../lib/format.ts';

type RbacTab = 'employees' | 'matrix';
type StatusFilter = 'all' | 'active' | 'pending' | 'inactive';

const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = setTimeout(() => {
      const firstControl = bodyRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      );
      (firstControl ?? dialogRef.current)?.focus();
    }, 10);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
              {title}
            </h3>
            {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div ref={bodyRef} className="mt-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function suggestNextEmployeeCode(rows: EmployeeRow[]): string {
  let maxNum = 0;
  for (const row of rows) {
    const m = /^EK-(\d+)$/i.exec(row.employee_code.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `EK-${String(maxNum + 1).padStart(3, '0')}`;
}

export function RbacPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'rbac', 'view');
  const canCreate = hasPermission(me.permissions, 'rbac', 'create');
  const canUpdate = hasPermission(me.permissions, 'rbac', 'update');
  const canDelete = hasPermission(me.permissions, 'rbac', 'delete');
  const isOwner = me.role === 'owner';

  const [tab, setTab] = useState<RbacTab>('employees');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);

  // Employee SlideOvers
  const [empDrawerOpen, setEmpDrawerOpen] = useState(false);
  const [editEmp, setEditEmp] = useState<EmployeeRow | null>(null);

  const [empCode, setEmpCode] = useState('');
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empUsername, setEmpUsername] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empRoleId, setEmpRoleId] = useState('');
  const [empSalary, setEmpSalary] = useState('5000000');
  const [empActive, setEmpActive] = useState(true);
  const [issueClaimOnCreate, setIssueClaimOnCreate] = useState(true);

  // Action modals
  const [claimDialog, setClaimDialog] = useState<{
    name: string;
    email: string;
    code: string;
    note?: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [unlinkTarget, setUnlinkTarget] = useState<EmployeeRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<EmployeeRow | null>(null);
  const [resetFaceTarget, setResetFaceTarget] = useState<EmployeeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState<{
    message: string;
    references: Record<string, number>;
  } | null>(null);

  // Permission matrix state
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [draftPermIds, setDraftPermIds] = useState<Set<string>>(new Set());

  const rolesQuery = useQuery({
    queryKey: ['rbac', 'roles'],
    queryFn: erpApi.rbac.roles,
    enabled: canView,
  });

  const permissionsQuery = useQuery({
    queryKey: ['rbac', 'permissions'],
    queryFn: erpApi.rbac.permissions,
    enabled: canView,
  });

  const employeesQuery = useQuery({
    queryKey: ['rbac', 'employees'],
    queryFn: erpApi.rbac.employees,
    enabled: canView,
  });

  const roles = rolesQuery.data?.roles ?? [];
  const permissions = permissionsQuery.data?.permissions ?? [];
  const employees = employeesQuery.data?.employees ?? [];

  const assignableRoles = useMemo(
    () => roles.filter((r) => isOwner || r.code !== 'owner'),
    [roles, isOwner],
  );

  const activeRole = roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null;

  useEffect(() => {
    if (activeRole) {
      setDraftPermIds(new Set(activeRole.permissions.map((p) => p.id)));
    }
  }, [activeRole]);

  const ownerRequiredPermIds = useMemo(() => {
    return new Set(
      permissions
        .filter((p) => p.module === 'rbac' && (p.action === 'view' || p.action === 'update'))
        .map((p) => p.id),
    );
  }, [permissions]);

  const filteredEmployees = useMemo(() => {
    if (statusFilter === 'all') return employees;
    if (statusFilter === 'active') return employees.filter((e) => e.is_active);
    if (statusFilter === 'pending') return employees.filter((e) => e.is_active && !e.auth_user_id);
    return employees.filter((e) => !e.is_active);
  }, [employees, statusFilter]);

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.is_active).length;
    const pending = employees.filter((e) => e.is_active && !e.auth_user_id).length;
    const inactive = employees.filter((e) => !e.is_active).length;
    return { total: employees.length, active, pending, inactive };
  }, [employees]);

  const invalidateRbac = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rbac'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      queryClient.invalidateQueries({ queryKey: ['profile-summary'] }),
    ]);
  };

  const createEmpMut = useMutation({
    mutationFn: erpApi.rbac.createEmployee,
    onSuccess: async (res) => {
      await invalidateRbac();
      setEmpDrawerOpen(false);
      setFormError(null);
      setEmpCode('');
      setEmpName('');
      setEmpEmail('');
      setEmpUsername('');
      setEmpPhone('');
      if (res.claim_code) {
        setCopiedCode(false);
        setClaimDialog({
          name: res.employee.full_name,
          email: res.employee.email,
          code: res.claim_code,
          note: `Karyawan baru berhasil ditambahkan. Berikan kode satu kali ini kepada ${res.employee.email} untuk mengaktifkan akunnya.`,
        });
      }
      setFeedback({ kind: 'success', text: 'Karyawan baru berhasil ditambahkan ke sistem.' });
    },
    onError: (err) => {
      const msg = (err as Error).message;
      setFormError(msg);
      setFeedback({ kind: 'error', text: msg });
    },
  });

  const updateEmpMut = useMutation({
    mutationFn: (vars: {
      id: string;
      body: {
        employee_code?: string;
        email?: string;
        full_name?: string;
        username?: string | null;
        phone?: string | null;
        role_id?: string;
        base_salary?: number;
        is_active?: boolean;
      };
    }) => erpApi.rbac.updateEmployee(vars.id, vars.body),
    onSuccess: async () => {
      await invalidateRbac();
      setEditEmp(null);
      setStatusTarget(null);
      setFormError(null);
      setFeedback({ kind: 'success', text: 'Data & status karyawan berhasil diperbarui.' });
    },
    onError: (err) => {
      const msg = (err as Error).message;
      setFormError(msg);
      setFeedback({ kind: 'error', text: msg });
    },
  });

  const claimCodeMut = useMutation({
    mutationFn: erpApi.rbac.generateClaimCode,
    onSuccess: async (res) => {
      await invalidateRbac();
      setCopiedCode(false);
      setClaimDialog({
        name: res.full_name,
        email: res.email,
        code: res.code,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const unlinkAuthMut = useMutation({
    mutationFn: (empId: string) => erpApi.rbac.unlinkAuth(empId, true),
    onSuccess: async (res) => {
      const targetName = unlinkTarget?.full_name ?? res.employee.full_name;
      const targetEmail = unlinkTarget?.email ?? res.employee.email;
      await invalidateRbac();
      setUnlinkTarget(null);
      if (res.claim_code) {
        setCopiedCode(false);
        setClaimDialog({
          name: targetName,
          email: targetEmail,
          code: res.claim_code,
          note: `Tautan akun login lama untuk ${targetName} telah diputus. Gunakan kode aktivasi baru ini untuk menautkan akun baru.`,
        });
      }
      setFeedback({ kind: 'success', text: `Tautan login ${targetName} berhasil diputus.` });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const resetFaceMut = useMutation({
    mutationFn: erpApi.rbac.resetEmployeeFace,
    onSuccess: async () => {
      const targetName = resetFaceTarget?.full_name ?? 'Karyawan';
      await invalidateRbac();
      await queryClient.invalidateQueries({ queryKey: ['attendance', 'face-status'] });
      setResetFaceTarget(null);
      setFeedback({
        kind: 'success',
        text: `Data wajah ${targetName} berhasil direset. Karyawan dapat mendaftarkan ulang wajah pada absensi berikutnya.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const deleteEmpMut = useMutation({
    mutationFn: erpApi.rbac.deleteEmployee,
    onSuccess: async () => {
      const deletedName = deleteTarget?.full_name ?? 'Karyawan';
      await invalidateRbac();
      setDeleteTarget(null);
      setDeleteBlockedInfo(null);
      setFeedback({ kind: 'success', text: `${deletedName} berhasil dihapus permanen.` });
    },
    onError: (err) => {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.details === 'object' &&
        err.details !== null &&
        (err.details as { can_deactivate?: boolean }).can_deactivate === true
      ) {
        const refs = (err.details as { references?: Record<string, number> }).references ?? {};
        setDeleteBlockedInfo({
          message: err.message,
          references: refs,
        });
        return;
      }
      setDeleteTarget(null);
      setFeedback({ kind: 'error', text: (err as Error).message });
    },
  });

  const savePermsMut = useMutation({
    mutationFn: (vars: { roleId: string; permissionIds: string[] }) =>
      erpApi.rbac.updateRolePermissions(vars.roleId, vars.permissionIds),
    onSuccess: async (res) => {
      await invalidateRbac();
      setFeedback({
        kind: 'success',
        text: `Matriks izin role disimpan (${res.count} permission aktif).`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const columns = useMemo<Array<ColumnDef<EmployeeRow, any>>>(
    () => [
      { accessorKey: 'employee_code', header: 'Kode' },
      {
        accessorKey: 'full_name',
        header: 'Nama, Username & Email',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-text-primary">{row.original.full_name}</p>
            <p className="text-xs text-text-secondary">
              {row.original.username ? `@${row.original.username} · ` : ''}
              {row.original.email}
            </p>
            {row.original.phone ? (
              <p className="text-[11px] text-text-secondary">{row.original.phone}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'role_name',
        header: 'Role',
        cell: ({ row }) => <StatusBadge tone="accent" label={row.original.role_name} />,
      },
      {
        accessorKey: 'base_salary',
        header: 'Gaji Pokok',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatRupiah(row.original.base_salary)}</span>
        ),
      },
      {
        accessorKey: 'auth_user_id',
        header: 'Login Auth',
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.original.auth_user_id ? (
              <StatusBadge tone="success" label="Tertaut" />
            ) : (
              <StatusBadge tone="warning" label="Menunggu Aktivasi" />
            )}
            {row.original.face_enrolled ? (
              <StatusBadge tone="accent" label="Wajah Terdaftar" />
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'is_active',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? (
            <StatusBadge tone="success" label="Aktif" />
          ) : (
            <StatusBadge tone="danger" label="Nonaktif" />
          ),
      },
      {
        id: 'actions',
        header: 'Aksi',
        enableSorting: false,
        cell: ({ row }) => {
          const emp = row.original;
          const isSelf = emp.id === me.employee.id;
          const canManageTarget = canUpdate && (isOwner || emp.role_code !== 'owner');
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {canManageTarget ? (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setEditEmp(emp);
                    setEmpCode(emp.employee_code);
                    setEmpName(emp.full_name);
                    setEmpEmail(emp.email);
                    setEmpUsername(emp.username ?? '');
                    setEmpPhone(emp.phone ?? '');
                    setEmpRoleId(emp.role_id);
                    setEmpSalary(emp.base_salary);
                    setEmpActive(emp.is_active);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                >
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  Edit
                </button>
              ) : null}

              {canManageTarget && !emp.auth_user_id ? (
                <button
                  type="button"
                  disabled={claimCodeMut.isPending}
                  onClick={() => claimCodeMut.mutate(emp.id)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-accent hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <KeyRound className="h-3 w-3" aria-hidden="true" />
                  Kode
                </button>
              ) : null}
              {(isOwner || me.role === 'hr') &&
              (isOwner || emp.role_code !== 'owner') &&
              emp.face_enrolled ? (
                <button
                  type="button"
                  disabled={resetFaceMut.isPending}
                  onClick={() => setResetFaceTarget(emp)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-warning hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ScanFace className="h-3 w-3" aria-hidden="true" />
                  Reset Wajah
                </button>
              ) : null}

              {isOwner && emp.auth_user_id && !isSelf ? (
                <button
                  type="button"
                  onClick={() => setUnlinkTarget(emp)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-warning hover:bg-surface-subtle"
                >
                  <Link2Off className="h-3 w-3" aria-hidden="true" />
                  Putus
                </button>
              ) : null}

              {canManageTarget && !isSelf ? (
                <button
                  type="button"
                  onClick={() => setStatusTarget(emp)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                >
                  {emp.is_active ? (
                    <>
                      <UserX className="h-3 w-3 text-warning" aria-hidden="true" />
                      Nonaktifkan
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-3 w-3 text-success" aria-hidden="true" />
                      Aktifkan
                    </>
                  )}
                </button>
              ) : null}

              {isOwner && canDelete && !isSelf ? (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteBlockedInfo(null);
                    setDeleteTarget(emp);
                  }}
                  aria-label={`Hapus karyawan ${emp.full_name}`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#FECACA] bg-danger-soft px-2 py-1 text-xs font-semibold text-[#991B1B] hover:opacity-90 dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Hapus
                </button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canUpdate, canDelete, isOwner, me.role, me.employee.id, claimCodeMut.isPending, resetFaceMut.isPending],
  );

  if (!canView) {
    return (
      <EmptyState
        title="Akses RBAC Ditolak"
        description="Role Anda tidak memiliki izin rbac:view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-primary">
            Manajemen User, Karyawan & RBAC
          </h2>
          <p className="text-xs text-text-secondary">
            Tambah, ubah, aktifkan/nonaktifkan, hapus user, terbitkan kode aktivasi, dan atur matriks 6x6 role
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setEmpCode(suggestNextEmployeeCode(employees));
              setEmpName('');
              setEmpEmail('');
              setEmpUsername('');
              setEmpPhone('');
              setEmpRoleId(
                assignableRoles.find((r) => r.code === 'staff')?.id ?? assignableRoles[0]?.id ?? '',
              );
              setEmpSalary('5000000');
              setIssueClaimOnCreate(true);
              setEmpDrawerOpen(true);
            }}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Tambah Karyawan
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
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-4 cursor-pointer underline"
          >
            Tutup
          </button>
        </div>
      ) : null}

      <div role="tablist" aria-label="Submodul RBAC" className="flex gap-1 border-b border-border pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'employees'}
          onClick={() => setTab('employees')}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'employees' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Direktori Karyawan ({employees.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'matrix'}
          onClick={() => setTab('matrix')}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'matrix' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Matriks Permission Role ({roles.length})
        </button>
      </div>

      {tab === 'employees' ? (
        employeesQuery.isLoading ? (
          <TableSkeleton columns={6} rows={6} label="Memuat data karyawan & role..." />
        ) : employeesQuery.isError ? (
          <ErrorState
            message={(employeesQuery.error as Error).message}
            onRetry={() => void employeesQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-3.5">
                <p className="text-xs text-text-secondary">Total Karyawan</p>
                <p className="mt-1 font-mono text-xl font-bold text-text-primary">{stats.total}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3.5">
                <p className="text-xs text-text-secondary">Akun Aktif</p>
                <p className="mt-1 font-mono text-xl font-bold text-success">{stats.active}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3.5">
                <p className="text-xs text-text-secondary">Menunggu Aktivasi</p>
                <p className="mt-1 font-mono text-xl font-bold text-warning">{stats.pending}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3.5">
                <p className="text-xs text-text-secondary">Nonaktif</p>
                <p className="mt-1 font-mono text-xl font-bold text-danger">{stats.inactive}</p>
              </div>
            </div>

            <DataTable
              data={filteredEmployees}
              columns={columns}
              searchPlaceholder="Cari nama, kode, username, atau email..."
              filterLabel="Status"
              filterValue={statusFilter}
              onFilterChange={(v) => setStatusFilter(v as StatusFilter)}
              filterOptions={[
                { label: `Semua (${stats.total})`, value: 'all' },
                { label: `Aktif (${stats.active})`, value: 'active' },
                { label: `Menunggu Aktivasi (${stats.pending})`, value: 'pending' },
                { label: `Nonaktif (${stats.inactive})`, value: 'inactive' },
              ]}
              emptySlot={
                <EmptyState
                  title={
                    statusFilter === 'all'
                      ? 'Belum ada data karyawan'
                      : 'Tidak ada karyawan pada status ini'
                  }
                  description={
                    statusFilter === 'all'
                      ? 'Tambahkan karyawan baru untuk mulai mengatur role dan kode aktivasi.'
                      : 'Ubah filter status untuk melihat data karyawan lainnya.'
                  }
                  actionLabel={statusFilter === 'all' ? undefined : 'Tampilkan Semua'}
                  onAction={statusFilter === 'all' ? undefined : () => setStatusFilter('all')}
                />
              }
            />
          </div>
        )
      ) : null}

      {tab === 'matrix' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoleId(r.id)}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-semibold ${
                  activeRole?.id === r.id
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border-strong bg-surface text-text-primary hover:bg-surface-subtle'
                }`}
              >
                {r.name} ({r.code})
              </button>
            ))}
          </div>

          {activeRole ? (
            <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-display text-sm font-bold text-text-primary">
                      {activeRole.name}
                    </h3>
                    <p className="text-xs text-text-secondary">
                      {activeRole.description || 'Konfigurasi izin granular per modul'}
                    </p>
                  </div>
                </div>
                {isOwner ? (
                  <button
                    type="button"
                    disabled={savePermsMut.isPending}
                    onClick={() => {
                      const nextIds = new Set(draftPermIds);
                      if (activeRole.code === 'owner') {
                        for (const reqId of ownerRequiredPermIds) {
                          nextIds.add(reqId);
                        }
                      }
                      savePermsMut.mutate({
                        roleId: activeRole.id,
                        permissionIds: Array.from(nextIds),
                      });
                    }}
                    className="h-9 cursor-pointer rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savePermsMut.isPending ? 'Menyimpan...' : 'Simpan Matriks Izin'}
                  </button>
                ) : (
                  <StatusBadge tone="neutral" label="Hanya Owner yang dapat mengubah matriks" />
                )}
              </div>

              {activeRole.code === 'owner' ? (
                <p className="text-xs text-text-secondary">
                  Izin <span className="font-mono font-semibold text-text-primary">rbac:view</span> dan{' '}
                  <span className="font-mono font-semibold text-text-primary">rbac:update</span> terkunci aktif untuk Role Owner agar akses administrasi tidak hilang.
                </p>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-border bg-surface-subtle text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 font-semibold uppercase">Modul</th>
                      {ERP_ACTIONS.map((act) => (
                        <th key={act} className="px-3 py-2 text-center font-semibold uppercase">
                          {act}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ERP_MODULES.map((mod) => (
                      <tr key={mod}>
                        <td className="px-3 py-2.5 font-semibold uppercase text-text-primary">
                          {mod}
                        </td>
                        {ERP_ACTIONS.map((act) => {
                          const perm = permissions.find((p) => p.module === mod && p.action === act);
                          if (!perm) {
                            return (
                              <td key={act} className="px-3 py-2.5 text-center text-text-secondary">
                                -
                              </td>
                            );
                          }
                          const isOwnerLocked =
                            activeRole.code === 'owner' && ownerRequiredPermIds.has(perm.id);
                          const checked = isOwnerLocked || draftPermIds.has(perm.id);
                          return (
                            <td key={act} className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                disabled={!isOwner || isOwnerLocked}
                                aria-label={`Izin ${mod} ${act} untuk ${activeRole.name}`}
                                checked={checked}
                                onChange={(e) => {
                                  if (isOwnerLocked) return;
                                  const next = new Set(draftPermIds);
                                  if (e.target.checked) next.add(perm.id);
                                  else next.delete(perm.id);
                                  setDraftPermIds(next);
                                }}
                                className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* SlideOver: Tambah Karyawan */}
      <SlideOver
        open={empDrawerOpen}
        onClose={() => setEmpDrawerOpen(false)}
        title="Tambah Karyawan Baru"
        subtitle="Buat profil karyawan & role; kode aktivasi bisa langsung diterbitkan untuk pendaftaran login"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            const cleanUsername = empUsername.trim().toLowerCase();
            if (cleanUsername && !USERNAME_PATTERN.test(cleanUsername)) {
              setFormError(
                'Format username harus 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.',
              );
              return;
            }
            createEmpMut.mutate({
              employee_code: empCode.trim().toUpperCase(),
              full_name: empName.trim(),
              email: empEmail.trim().toLowerCase(),
              username: cleanUsername || null,
              phone: empPhone.trim() || null,
              role_id: empRoleId,
              base_salary: Math.max(0, Math.trunc(Number(empSalary) || 0)),
              issue_claim_code: issueClaimOnCreate,
            });
          }}
          className="space-y-4"
        >
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-[#FECACA] bg-danger-soft px-3 py-2 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
            >
              {formError}
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="emp-code" className="block text-xs font-semibold">
              Kode Karyawan
            </label>
            <input
              id="emp-code"
              required
              value={empCode}
              onChange={(e) => setEmpCode(e.target.value)}
              placeholder="Contoh: EK-002"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-name" className="block text-xs font-semibold">
              Nama Lengkap
            </label>
            <input
              id="emp-name"
              required
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-email" className="block text-xs font-semibold">
              Email Kerja
            </label>
            <input
              id="emp-email"
              type="email"
              required
              value={empEmail}
              onChange={(e) => setEmpEmail(e.target.value)}
              placeholder="nama@ekalliptus.com"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-username" className="block text-xs font-semibold">
              Username Login (Opsional)
            </label>
            <input
              id="emp-username"
              value={empUsername}
              onChange={(e) => setEmpUsername(e.target.value)}
              placeholder="contoh: budi.santoso"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
            <p className="text-[11px] text-text-secondary">
              3-24 karakter: huruf kecil, angka, titik, atau garis bawah.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-phone" className="block text-xs font-semibold">
              Nomor Telepon (Opsional)
            </label>
            <input
              id="emp-phone"
              value={empPhone}
              onChange={(e) => setEmpPhone(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-role" className="block text-xs font-semibold">
              Role Akses
            </label>
            <select
              id="emp-role"
              value={empRoleId}
              onChange={(e) => setEmpRoleId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
            >
              {assignableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="emp-sal" className="block text-xs font-semibold">
              Gaji Pokok (IDR)
            </label>
            <input
              id="emp-sal"
              type="number"
              min={0}
              required
              value={empSalary}
              onChange={(e) => setEmpSalary(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-subtle p-3 text-xs">
            <input
              type="checkbox"
              checked={issueClaimOnCreate}
              onChange={(e) => setIssueClaimOnCreate(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
            />
            <span>
              <strong className="block text-text-primary">Langsung buat kode aktivasi</strong>
              <span className="text-text-secondary">
                Menampilkan kode aktivasi satu kali segera setelah karyawan disimpan.
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={createEmpMut.isPending}
            className="h-10 w-full cursor-pointer rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createEmpMut.isPending ? 'Menyimpan...' : 'Simpan Karyawan'}
          </button>
        </form>
      </SlideOver>

      {/* SlideOver: Edit Karyawan */}
      <SlideOver
        open={Boolean(editEmp)}
        onClose={() => setEditEmp(null)}
        title={editEmp ? `Edit ${editEmp.full_name}` : 'Edit Karyawan'}
        subtitle={editEmp ? `${editEmp.employee_code} · ${editEmp.email}` : undefined}
      >
        {editEmp ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              const cleanUsername = empUsername.trim().toLowerCase();
              if (cleanUsername && !USERNAME_PATTERN.test(cleanUsername)) {
                setFormError(
                  'Format username harus 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.',
                );
                return;
              }
              const isSelf = editEmp.id === me.employee.id;
              const lockSelfOwner = isSelf && editEmp.role_code === 'owner';
              updateEmpMut.mutate({
                id: editEmp.id,
                body: {
                  employee_code: empCode.trim().toUpperCase(),
                  email: empEmail.trim().toLowerCase(),
                  full_name: empName.trim(),
                  username: cleanUsername || null,
                  phone: empPhone.trim() || null,
                  ...(lockSelfOwner ? {} : { role_id: empRoleId }),
                  base_salary: Math.max(0, Math.trunc(Number(empSalary) || 0)),
                  ...(isSelf ? {} : { is_active: empActive }),
                },
              });
            }}
            className="space-y-4"
          >
            {formError ? (
              <div
                role="alert"
                className="rounded-md border border-[#FECACA] bg-danger-soft px-3 py-2 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
              >
                {formError}
              </div>
            ) : null}
            <div className="space-y-1">
              <label htmlFor="ed-emp-code" className="block text-xs font-semibold">
                Kode Karyawan
              </label>
              <input
                id="ed-emp-code"
                required
                value={empCode}
                onChange={(e) => setEmpCode(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-name" className="block text-xs font-semibold">
                Nama Lengkap
              </label>
              <input
                id="ed-emp-name"
                required
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-email" className="block text-xs font-semibold">
                Email Kerja
              </label>
              <input
                id="ed-emp-email"
                type="email"
                required
                value={empEmail}
                onChange={(e) => setEmpEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-username" className="block text-xs font-semibold">
                Username Login (Opsional)
              </label>
              <input
                id="ed-emp-username"
                value={empUsername}
                onChange={(e) => setEmpUsername(e.target.value)}
                placeholder="kosongkan untuk hapus username"
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-phone" className="block text-xs font-semibold">
                Nomor Telepon (Opsional)
              </label>
              <input
                id="ed-emp-phone"
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-role" className="block text-xs font-semibold">
                Role Akses
              </label>
              <select
                id="ed-emp-role"
                disabled={editEmp.id === me.employee.id && editEmp.role_code === 'owner'}
                value={empRoleId}
                onChange={(e) => setEmpRoleId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {assignableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="ed-emp-sal" className="block text-xs font-semibold">
                Gaji Pokok (IDR)
              </label>
              <input
                id="ed-emp-sal"
                type="number"
                min={0}
                value={empSalary}
                onChange={(e) => setEmpSalary(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm tabular-nums"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-subtle p-3 text-xs">
              <input
                type="checkbox"
                disabled={editEmp.id === me.employee.id}
                checked={empActive}
                onChange={(e) => setEmpActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
              />
              <span>
                <strong className="block text-text-primary">Status Akun Aktif</strong>
                <span className="text-text-secondary">
                  {editEmp.id === me.employee.id
                    ? 'Akun Anda sendiri tidak bisa dinonaktifkan.'
                    : 'Nonaktifkan sementara jika karyawan cuti panjang atau keluar.'}
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={updateEmpMut.isPending}
              className="h-10 w-full cursor-pointer rounded-md bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateEmpMut.isPending ? 'Menyimpan...' : 'Perbarui Data Karyawan'}
            </button>
          </form>
        ) : null}
      </SlideOver>

      {/* Modal: Kode Aktivasi Satu Kali */}
      <ModalDialog
        open={Boolean(claimDialog)}
        onClose={() => setClaimDialog(null)}
        title={claimDialog ? `Kode Aktivasi ${claimDialog.name}` : 'Kode Aktivasi'}
        subtitle={claimDialog?.email}
      >
        {claimDialog ? (
          <div className="space-y-4">
            <p className="text-xs text-text-secondary">
              {claimDialog.note ??
                `Berikan kode satu kali ini kepada ${claimDialog.email} untuk mengaktifkan akun di halaman Aktivasi.`}
            </p>
            <div className="rounded-lg border border-accent/35 bg-accent-soft px-4 py-3 text-center">
              <p className="select-all font-mono text-lg font-bold tracking-wider text-[#115E59] dark:text-[#34D399]">
                {claimDialog.code}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClaimDialog(null)}
                className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(claimDialog.code);
                  setCopiedCode(true);
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Salin Kode
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      {/* Modal: Konfirmasi Putus Tautan Login */}
      <ModalDialog
        open={Boolean(unlinkTarget)}
        onClose={() => setUnlinkTarget(null)}
        title="Putus Tautan Akun Login?"
        subtitle={unlinkTarget ? `${unlinkTarget.full_name} (${unlinkTarget.email})` : undefined}
      >
        {unlinkTarget ? (
          <div className="space-y-4">
            <p className="text-xs text-text-secondary">
              Akses login Neon Auth dan token push perangkat yang tertaut pada{' '}
              <strong className="text-text-primary">{unlinkTarget.full_name}</strong> akan dicabut.
              Kode aktivasi baru akan langsung dibuat agar karyawan bisa menautkan ulang akunnya.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnlinkTarget(null)}
                className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={unlinkAuthMut.isPending}
                onClick={() => unlinkAuthMut.mutate(unlinkTarget.id)}
                className="h-9 cursor-pointer rounded-md bg-[#B45309] px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlinkAuthMut.isPending ? 'Memproses...' : 'Putus Tautan'}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      {/* Modal: Konfirmasi Aktifkan / Nonaktifkan Akun */}
      <ModalDialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        title={
          statusTarget?.is_active ? 'Nonaktifkan Akun Karyawan?' : 'Aktifkan Kembali Akun Karyawan?'
        }
        subtitle={statusTarget ? `${statusTarget.full_name} (${statusTarget.employee_code})` : undefined}
      >
        {statusTarget ? (
          <div className="space-y-4">
            <p className="text-xs text-text-secondary">
              {statusTarget.is_active
                ? `${statusTarget.full_name} tidak akan bisa mengakses modul ERP selama dinonaktifkan, tetapi seluruh riwayat absensi, kas, dan payroll tetap aman.`
                : `${statusTarget.full_name} akan kembali dapat masuk dan memakai modul ERP sesuai rolenya.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={updateEmpMut.isPending}
                onClick={() =>
                  updateEmpMut.mutate({
                    id: statusTarget.id,
                    body: { is_active: !statusTarget.is_active },
                  })
                }
                className={`h-9 cursor-pointer rounded-md px-3.5 text-xs font-semibold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                  statusTarget.is_active ? 'bg-[#B91C1C] text-white' : 'bg-accent text-on-accent'
                }`}
              >
                {updateEmpMut.isPending
                  ? 'Memproses...'
                  : statusTarget.is_active
                    ? 'Ya, Nonaktifkan'
                    : 'Ya, Aktifkan'}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      {/* Modal: Hapus Karyawan + Fallback Nonaktifkan Saat 409 */}
      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteBlockedInfo(null);
        }}
        title={deleteBlockedInfo ? 'Tidak Dapat Dihapus Permanen' : 'Hapus Karyawan Permanen?'}
        subtitle={deleteTarget ? `${deleteTarget.full_name} (${deleteTarget.employee_code})` : undefined}
      >
        {deleteTarget ? (
          <div className="space-y-4">
            {deleteBlockedInfo ? (
              <>
                <p className="text-xs text-text-secondary">{deleteBlockedInfo.message}</p>
                {Object.keys(deleteBlockedInfo.references).length > 0 ? (
                  <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
                    <p className="font-semibold text-text-primary">Riwayat terkait:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {Object.entries(deleteBlockedInfo.references).map(([tbl, cnt]) => (
                        <li key={tbl}>
                          {tbl}: {cnt} catatan
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(null);
                      setDeleteBlockedInfo(null);
                    }}
                    className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                  >
                    Tutup
                  </button>
                  {deleteTarget.is_active ? (
                    <button
                      type="button"
                      disabled={updateEmpMut.isPending}
                      onClick={() => {
                        const id = deleteTarget.id;
                        setDeleteTarget(null);
                        setDeleteBlockedInfo(null);
                        updateEmpMut.mutate({ id, body: { is_active: false } });
                      }}
                      className="h-9 cursor-pointer rounded-md bg-[#B91C1C] px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Nonaktifkan Saja
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-text-secondary">
                  Data <strong className="text-text-primary">{deleteTarget.full_name}</strong> akan
                  dihapus permanen jika belum pernah dipakai mencatat transaksi, absensi, payroll,
                  atau audit trail.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={deleteEmpMut.isPending}
                    onClick={() => deleteEmpMut.mutate(deleteTarget.id)}
                    className="h-9 cursor-pointer rounded-md bg-[#B91C1C] px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleteEmpMut.isPending ? 'Menghapus...' : 'Hapus Permanen'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </ModalDialog>

      {/* Modal: Reset Data Wajah Karyawan */}
      <ModalDialog
        open={Boolean(resetFaceTarget)}
        onClose={() => setResetFaceTarget(null)}
        title="Reset Data Wajah Karyawan?"
        subtitle={
          resetFaceTarget
            ? `${resetFaceTarget.full_name} (${resetFaceTarget.employee_code})`
            : undefined
        }
      >
        {resetFaceTarget ? (
          <div className="space-y-4">
            <p className="text-xs text-text-secondary">
              Data biometrik wajah {resetFaceTarget.full_name} akan dihapus dari akun ini. Pada
              absensi berikutnya (web atau Android), karyawan akan otomatis mendaftarkan wajah
              baru.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetFaceTarget(null)}
                className="h-9 cursor-pointer rounded-md border border-border-strong px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={resetFaceMut.isPending}
                onClick={() => resetFaceMut.mutate(resetFaceTarget.id)}
                className="h-9 cursor-pointer rounded-md bg-[#B91C1C] px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resetFaceMut.isPending ? 'Mereset...' : 'Ya, Reset Wajah'}
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
