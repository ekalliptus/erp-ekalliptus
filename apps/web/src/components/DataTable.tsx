import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { downloadCsv } from '../lib/format.ts';

export interface DataTableFilterOption {
  label: string;
  value: string;
}

export function DataTable<TData>({
  data,
  columns,
  searchPlaceholder = 'Cari data...',
  globalFilterFn,
  filterLabel,
  filterOptions,
  filterValue,
  onFilterChange,
  exportConfig,
  enableSelection = false,
  bulkActions,
  emptySlot,
  pageSize = 12,
}: {
  data: TData[];
  columns: Array<ColumnDef<TData, any>>;
  searchPlaceholder?: string;
  globalFilterFn?: (row: TData, query: string) => boolean;
  filterLabel?: string;
  filterOptions?: DataTableFilterOption[];
  filterValue?: string;
  onFilterChange?: (val: string) => void;
  exportConfig?: {
    filename: string;
    headers: string[];
    mapRow: (row: TData) => Array<unknown>;
  };
  enableSelection?: boolean;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => ReactNode;
  emptySlot?: ReactNode;
  pageSize?: number;
}) {
  const searchId = useId();
  const filterId = useId();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [query, setQuery] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const filteredByQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) => {
      if (globalFilterFn) return globalFilterFn(row, q);
      return JSON.stringify(row).toLowerCase().includes(q);
    });
  }, [data, query, globalFilterFn]);

  const effectiveColumns = useMemo<Array<ColumnDef<TData, any>>>(() => {
    if (!enableSelection) return columns;
    const selectCol: ColumnDef<TData, any> = {
      id: '__select',
      header: ({ table }) => (
        <input
          type="checkbox"
          aria-label="Pilih semua baris pada halaman ini"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          className="h-4 w-4 rounded border-border-strong accent-accent"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label="Pilih baris"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
          className="h-4 w-4 rounded border-border-strong accent-accent"
        />
      ),
      enableSorting: false,
    };
    return [selectCol, ...columns];
  }, [columns, enableSelection]);

  const table = useReactTable({
    data: filteredByQuery,
    columns: effectiveColumns,
    state: {
      sorting,
      rowSelection,
    },
    initialState: {
      pagination: { pageSize },
    },
    enableRowSelection: enableSelection,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[210px] flex-1 sm:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              {searchPlaceholder}
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent"
            />
          </div>

          {filterOptions && onFilterChange ? (
            <div className="flex items-center gap-2">
              <label htmlFor={filterId} className="text-xs font-medium text-text-secondary">
                {filterLabel || 'Filter'}
              </label>
              <select
                id={filterId}
                value={filterValue ?? ''}
                onChange={(e) => onFilterChange(e.target.value)}
                className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary focus:border-accent"
              >
                {filterOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedRows.length > 0 && bulkActions
            ? bulkActions(selectedRows, () => setRowSelection({}))
            : null}
          {exportConfig && filteredByQuery.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  exportConfig.filename,
                  exportConfig.headers,
                  filteredByQuery.map(exportConfig.mapRow),
                )
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </button>
          ) : null}
        </div>
      </div>

      {filteredByQuery.length === 0 && emptySlot ? (
        emptySlot
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            sorted === 'asc'
                              ? 'ascending'
                              : sorted === 'desc'
                                ? 'descending'
                                : 'none'
                          }
                          className="whitespace-nowrap px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary"
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 text-left font-semibold text-text-secondary hover:text-text-primary"
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              {sorted === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-border">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-surface-subtle/60"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="whitespace-nowrap px-3.5 py-2.5 text-sm text-text-primary"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-subtle/50 px-3.5 py-2.5 text-xs text-text-secondary">
              <span>
                Halaman <strong className="text-text-primary">{currentPage}</strong> dari{' '}
                <strong className="text-text-primary">{pageCount}</strong> ({filteredByQuery.length}{' '}
                baris)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="rounded border border-border-strong bg-surface px-2.5 py-1 font-medium text-text-primary disabled:opacity-50"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="rounded border border-border-strong bg-surface px-2.5 py-1 font-medium text-text-primary disabled:opacity-50"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
