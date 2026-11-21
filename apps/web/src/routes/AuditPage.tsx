import { hasPermission } from '@ekalliptus/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable.tsx';
import { TableSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { erpApi, type AuditLogRow, type MeResponse } from '../lib/api.ts';
import { formatDateTimeId } from '../lib/format.ts';

export function AuditPage({ me }: { me: MeResponse }) {
  const canView = hasPermission(me.permissions, 'audit', 'view');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);

  const auditQuery = useQuery({
    queryKey: ['audit', 'logs', moduleFilter],
    queryFn: () => erpApi.rbac.auditLogs(moduleFilter === 'all' ? undefined : moduleFilter),
    enabled: canView,
  });

  const columns = useMemo<Array<ColumnDef<AuditLogRow, any>>>(
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
      {
        accessorKey: 'actor_name',
        header: 'Aktor',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-text-primary">{row.original.actor_name || 'Sistem'}</p>
            <p className="text-xs text-text-secondary">{row.original.actor_email || '-'}</p>
          </div>
        ),
      },
      {
        accessorKey: 'platform',
        header: 'Platform',
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.platform === 'flutter' ? 'info' : 'accent'}
            label={row.original.platform.toUpperCase()}
          />
        ),
      },
      {
        accessorKey: 'module',
        header: 'Modul / Aksi',
        cell: ({ row }) => (
          <div>
            <p className="font-semibold uppercase text-text-primary">{row.original.module}</p>
            <p className="text-xs text-text-secondary">{row.original.action}</p>
          </div>
        ),
      },
      {
        accessorKey: 'entity_id',
        header: 'ID Entitas',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-text-secondary">
            {row.original.entity_id.slice(0, 18)}
          </span>
        ),
      },
      {
        id: 'inspect',
        header: 'Diff',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setSelectedLog(row.original)}
            className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs font-semibold hover:bg-surface-subtle"
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            Lihat Data
          </button>
        ),
      },
    ],
    [],
  );

  if (!canView) {
    return (
      <EmptyState
        title="Akses Log Audit Ditolak"
        description="Role Anda tidak memiliki izin audit:view."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-bold text-text-primary">
          Immutable Audit Trail
        </h2>
        <p className="text-xs text-text-secondary">
          Rekam jejak seluruh perubahan data sensitif dari Web Command Center maupun Flutter Native
          App
        </p>
      </div>

      {auditQuery.isLoading ? (
        <TableSkeleton columns={6} rows={8} label="Memuat catatan audit trail..." />
      ) : auditQuery.isError ? (
        <ErrorState
          message={(auditQuery.error as Error).message}
          onRetry={() => void auditQuery.refetch()}
        />
      ) : (
        <DataTable
          data={auditQuery.data?.audit_logs ?? []}
          columns={columns}
          searchPlaceholder="Cari aktor, aksi, atau ID entitas..."
          filterLabel="Modul"
          filterValue={moduleFilter}
          onFilterChange={setModuleFilter}
          filterOptions={[
            { value: 'all', label: 'Semua Modul' },
            { value: 'finance', label: 'Finance' },
            { value: 'inventory', label: 'Inventory' },
            { value: 'attendance', label: 'Attendance' },
            { value: 'payroll', label: 'Payroll' },
            { value: 'rbac', label: 'RBAC' },
            { value: 'storage', label: 'Storage' },
          ]}
          exportConfig={{
            filename: 'audit-trail-myekalliptus.csv',
            headers: ['Waktu', 'Aktor', 'Platform', 'Modul', 'Aksi', 'Entitas'],
            mapRow: (l) => [
              l.created_at,
              l.actor_email || 'system',
              l.platform,
              l.module,
              l.action,
              l.entity_id,
            ],
          }}
        />
      )}

      <SlideOver
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `Detail Audit: ${selectedLog.action}` : 'Detail Audit'}
        subtitle={selectedLog ? `${selectedLog.module.toUpperCase()} (${selectedLog.platform})` : undefined}
      >
        {selectedLog ? (
          <div className="space-y-4 text-xs">
            <div className="space-y-1">
              <p className="font-semibold text-text-primary">Before Data</p>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-subtle p-3 font-mono text-[11px] text-text-primary">
                {JSON.stringify(selectedLog.before_data, null, 2)}
              </pre>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-text-primary">After Data</p>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-subtle p-3 font-mono text-[11px] text-text-primary">
                {JSON.stringify(selectedLog.after_data, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </SlideOver>
    </div>
  );
}
