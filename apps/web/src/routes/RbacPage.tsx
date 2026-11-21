import { ERP_ACTIONS, ERP_MODULES, hasPermission } from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Shield, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { erpApi, type EmployeeRow, type MeResponse } from '../lib/api.ts';
import { formatRupiah } from '../lib/format.ts';

type RbacTab = 'employees' | 'matrix';

export function RbacPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const canView = hasPermission(me.permissions, 'rbac', 'view');
  const canCreate = hasPermission(me.permissions, 'rbac', 'create');
  const canUpdate = hasPermission(me.permissions, 'rbac', 'update');
  const isOwner = me.role === 'owner';

  const [tab, setTab] = useState<RbacTab>('employees');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Employee SlideOvers
  const [empDrawerOpen, setEmpDrawerOpen] = useState(false);
  const [editEmp, setEditEmp] = useState<EmployeeRow | null>(null);

  const [empCode, setEmpCode] = useState('');
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empRoleId, setEmpRoleId] = useState('');
  const [empSalary, setEmpSalary] = useState('5000000');

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

  const activeRole = roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null;

  useEffect(() => {
    if (activeRole) {
      setDraftPermIds(new Set(activeRole.permissions.map((p) => p.id)));
    }
  }, [activeRole]);

  const invalidateRbac = async () => {
    await queryClient.invalidateQueries({ queryKey: ['rbac'] });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const createEmpMut = useMutation({
    mutationFn: erpApi.rbac.createEmployee,
    onSuccess: async () => {
      await invalidateRbac();
      setEmpDrawerOpen(false);
      setEmpCode('');
      setEmpName('');
      setEmpEmail('');
      setEmpPhone('');
      setFeedback({ kind: 'success', text: 'Karyawan baru berhasil ditambahkan ke sistem.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
  });

  const updateEmpMut = useMutation({
    mutationFn: (vars: {
      id: string;
      full_name: string;
      phone: string | null;
      role_id: string;
      base_salary: number;
      is_active: boolean;
    }) =>
      erpApi.rbac.updateEmployee(vars.id, {
        full_name: vars.full_name,
        phone: vars.phone,
        role_id: vars.role_id,
        base_salary: vars.base_salary,
        is_active: vars.is_active,
      }),
    onSuccess: async () => {
      await invalidateRbac();
      setEditEmp(null);
      setFeedback({ kind: 'success', text: 'Profil & role karyawan berhasil diperbarui.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: (err as Error).message }),
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
        header: 'Nama & Email',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-text-primary">{row.original.full_name}</p>
            <p className="text-xs text-text-secondary">{row.original.email}</p>
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
        header: 'Neon Auth',
        cell: ({ row }) =>
          row.original.auth_user_id ? (
            <StatusBadge tone="success" label="Tertaut" />
          ) : (
            <StatusBadge tone="warning" label="Menunggu Aktivasi" />
          ),
      },
      {
        accessorKey: 'is_active',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? (
            <StatusBadge tone="success" label="Aktif" />
          ) : (
            <StatusBadge tone="neutral" label="Nonaktif" />
          ),
      },
      {
        id: 'actions',
        header: 'Aksi',
        enableSorting: false,
        cell: ({ row }) =>
          canUpdate ? (
            <button
              type="button"
              onClick={() => {
                setEditEmp(row.original);
                setEmpName(row.original.full_name);
                setEmpPhone(row.original.phone ?? '');
                setEmpRoleId(row.original.role_id);
                setEmpSalary(row.original.base_salary);
              }}
              className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs font-semibold"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Edit
            </button>
          ) : null,
      },
    ],
    [canUpdate],
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
            Manajemen Tim & Hak Akses RBAC
          </h2>
          <p className="text-xs text-text-secondary">
            Direktori karyawan, penautan Neon Auth otomatis via email, dan matriks permission 6x6
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              setEmpRoleId(roles.find((r) => r.code === 'staff')?.id ?? roles[0]?.id ?? '');
              setEmpName('');
              setEmpPhone('');
              setEmpSalary('5000000');
              setEmpDrawerOpen(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent"
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
          <button type="button" onClick={() => setFeedback(null)} className="ml-4 underline">
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
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'employees' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Direktori Karyawan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'matrix'}
          onClick={() => setTab('matrix')}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            tab === 'matrix' ? 'bg-accent text-on-accent' : 'bg-surface-subtle text-text-primary'
          }`}
        >
          Matriks Permission Role
        </button>
      </div>

      {tab === 'employees' ? (
        employeesQuery.isLoading ? (
          <TableSkeleton columns={5} rows={6} label="Memuat data karyawan & role..." />
        ) : employeesQuery.isError ? (
          <ErrorState
            message={(employeesQuery.error as Error).message}
            onRetry={() => void employeesQuery.refetch()}
          />
        ) : (
          <DataTable
            data={employees}
            columns={columns}
            searchPlaceholder="Cari nama, kode, atau email karyawan..."
          />
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
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
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
            <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
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
                    onClick={() =>
                      savePermsMut.mutate({
                        roleId: activeRole.id,
                        permissionIds: Array.from(draftPermIds),
                      })
                    }
                    className="h-9 rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
                  >
                    {savePermsMut.isPending ? 'Menyimpan...' : 'Simpan Matriks Izin'}
                  </button>
                ) : (
                  <StatusBadge tone="neutral" label="Hanya Owner yang dapat mengubah matriks" />
                )}
              </div>

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
                          const checked = draftPermIds.has(perm.id);
                          return (
                            <td key={act} className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                disabled={!isOwner}
                                aria-label={`Izin ${mod} ${act} untuk ${activeRole.name}`}
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(draftPermIds);
                                  if (e.target.checked) next.add(perm.id);
                                  else next.delete(perm.id);
                                  setDraftPermIds(next);
                                }}
                                className="h-4 w-4 accent-accent"
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
        subtitle="Penautan RBAC terjadi otomatis ketika email yang sama mendaftar di Neon Auth"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createEmpMut.mutate({
              employee_code: empCode.trim(),
              full_name: empName.trim(),
              email: empEmail.trim().toLowerCase(),
              phone: empPhone.trim() || null,
              role_id: empRoleId,
              base_salary: Math.max(0, Math.trunc(Number(empSalary) || 0)),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="emp-code" className="block text-xs font-semibold">
              Kode Karyawan
            </label>
            <input
              id="emp-code"
              required
              value={empCode}
              onChange={(e) => setEmpCode(e.target.value)}
              placeholder="Contoh: EMP-002"
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
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
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
              {roles.map((r) => (
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
          <button
            type="submit"
            disabled={createEmpMut.isPending}
            className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
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
      >
        {editEmp ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateEmpMut.mutate({
                id: editEmp.id,
                full_name: empName.trim(),
                phone: empPhone.trim() || null,
                role_id: empRoleId,
                base_salary: Math.max(0, Math.trunc(Number(empSalary) || 0)),
                is_active: editEmp.is_active,
              });
            }}
            className="space-y-4"
          >
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
              <label htmlFor="ed-emp-role" className="block text-xs font-semibold">
                Role Akses
              </label>
              <select
                id="ed-emp-role"
                value={empRoleId}
                onChange={(e) => setEmpRoleId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm"
              >
                {roles.map((r) => (
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
            <button
              type="submit"
              disabled={updateEmpMut.isPending}
              className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-on-accent"
            >
              {updateEmpMut.isPending ? 'Menyimpan...' : 'Perbarui Data Karyawan'}
            </button>
          </form>
        ) : null}
      </SlideOver>
    </div>
  );
}
