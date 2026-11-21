import type { RoleCode } from '@ekalliptus/contracts';
import type { SealedLiveQuery } from '@neon/realtime/client';
import { clearAccessTokenCache, getAccessToken } from './auth.ts';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function formatApiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      const flat = obj.error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      const msgs = [
        ...(flat.formErrors ?? []),
        ...Object.entries(flat.fieldErrors ?? {}).flatMap(([field, errs]) =>
          errs.map((e) => `${field}: ${e}`),
        ),
      ];
      if (msgs.length > 0) return msgs.join('; ');
    }
    if (typeof obj.message === 'string') return obj.message;
  }
  return `Permintaan API gagal dengan status ${status}.`;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError(500, 'VITE_API_BASE_URL belum dikonfigurasi.');
  }

  const perform = async (forceRefresh: boolean) => {
    const token = await getAccessToken(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('X-Platform', 'web');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  };

  let res = await perform(false);
  if (res.status === 401) {
    clearAccessTokenCache();
    res = await perform(true);
  }

  const rawText = await res.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, formatApiErrorMessage(parsed, res.status), parsed);
  }

  return parsed as T;
}

export interface EmployeeProfile {
  id: string;
  auth_user_id: string | null;
  role_id: string;
  employee_code: string;
  full_name: string;
  email: string;
  username: string | null;
  phone: string | null;
  base_salary: string;
  is_active: boolean;
  avatar_object_key: string | null;
}

export interface MeResponse {
  employee: EmployeeProfile;
  role: RoleCode;
  role_name: string;
  permissions: string[];
  platform: 'web' | 'flutter' | 'system';
  kpis: {
    total_cash_balance: string;
    low_stock_alerts: number;
    pending_attendance_approvals: number;
    draft_payroll_runs: number;
  };
}

export interface FinanceAccount {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'ewallet' | 'qris';
  account_number: string | null;
  balance: string;
  is_active: boolean;
  created_at: string;
}

export interface FinanceCategory {
  id: string;
  name: string;
  kind: 'income' | 'expense';
}

export interface FinanceTransaction {
  id: string;
  account_id: string;
  target_account_id: string | null;
  category_id: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: string;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  receipt_object_key: string | null;
  status: 'pending' | 'posted' | 'void';
  created_by: string;
  approved_by: string | null;
  transacted_at: string;
  account_name: string;
  category_name: string | null;
}

export interface FinanceSummary {
  total_balance: string;
  total_income: string;
  total_expense: string;
  net_profit: string;
  open_receivable: string;
  open_payable: string;
  daily_cashflow: Array<{
    day: string;
    income: string;
    expense: string;
  }>;
}

export interface FinanceObligation {
  id: string;
  kind: 'receivable' | 'payable';
  counterparty_name: string;
  amount: string;
  paid_amount: string;
  due_date: string | null;
  status: 'open' | 'partial' | 'paid' | 'void';
  note: string | null;
  created_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  is_default: boolean;
}

export interface InventoryItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  cost_price: string;
  sell_price: string;
  min_stock: number;
  image_object_key: string | null;
  is_active: boolean;
  created_at: string;
}

export interface InventoryStockRow {
  item_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  cost_price: string;
  sell_price: string;
  min_stock: number;
  image_object_key: string | null;
  is_active: boolean;
  warehouse_id: string;
  warehouse_name: string;
  qty: number;
  is_low_stock: boolean;
}

export interface StockMovementRow {
  id: string;
  item_id: string;
  item_name: string;
  sku: string;
  warehouse_id: string;
  warehouse_name: string;
  movement_type: 'in' | 'out' | 'adjustment' | 'transfer';
  qty_delta: number;
  unit_cost: string;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  warehouse_name: string;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  total_amount: string;
  note: string | null;
  created_at: string;
}

export interface OfficeLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  work_start_time: string;
  work_end_time: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  office_id: string | null;
  office_name: string | null;
  attendance_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_selfie_key: string | null;
  clock_out_selfie_key: string | null;
  status: 'present' | 'late' | 'leave' | 'sick' | 'absent';
  late_minutes: number;
  overtime_minutes: number;
  note: string | null;
  approval_status: 'approved' | 'pending' | 'rejected';
  approved_by: string | null;
}

export interface PayrollRunRow {
  id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'approved' | 'paid';
  total_disbursed: string;
  finance_account_id: string | null;
  approved_by: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface PayrollItemRow {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  email: string;
  base_salary: string;
  allowances: string;
  overtime_pay: string;
  deductions: string;
  net_salary: string;
  slip_pdf_object_key: string | null;
  finance_transaction_id: string | null;
}

export interface RolePermission {
  id: string;
  module: string;
  action: string;
}

export interface RoleWithPermissions {
  id: string;
  code: RoleCode;
  name: string;
  description: string | null;
  permissions: RolePermission[];
}

export interface EmployeeRow extends EmployeeProfile {
  role_code: RoleCode;
  role_name: string;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  platform: 'web' | 'flutter' | 'system';
  module: string;
  action: string;
  entity_id: string;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
}

export type RealtimeFeed =
  | 'erp:finance'
  | 'erp:inventory'
  | 'erp:attendance'
  | 'finance_accounts'
  | 'finance_transactions'
  | 'inventory_stocks'
  | 'attendances';

export interface NotificationItem {
  id: string;
  recipient_auth_user_id: string;
  module: string;
  event_type: string;
  title: string;
  body: string;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unread: number;
}

export const erpApi = {
  fetchMe: () => apiFetch<MeResponse>('/api/me'),

  finance: {
    accounts: () => apiFetch<{ accounts: FinanceAccount[] }>('/api/finance/accounts'),
    createAccount: (body: {
      name: string;
      type: FinanceAccount['type'];
      account_number?: string | null;
      initial_balance: number;
    }) =>
      apiFetch<{ account: FinanceAccount }>('/api/finance/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    categories: () => apiFetch<{ categories: FinanceCategory[] }>('/api/finance/categories'),
    createCategory: (body: { name: string; kind: 'income' | 'expense' }) =>
      apiFetch<{ category: FinanceCategory }>('/api/finance/categories', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    transactions: () => apiFetch<{ transactions: FinanceTransaction[] }>('/api/finance/transactions'),
    createTransaction: (body: {
      account_id: string;
      target_account_id?: string | null;
      category_id?: string | null;
      type: 'income' | 'expense' | 'transfer';
      amount: number;
      description: string;
      receipt_object_key?: string | null;
      status?: 'pending' | 'posted';
    }) =>
      apiFetch<{ transaction: FinanceTransaction; txid: string }>('/api/finance/transactions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approveTransaction: (id: string) =>
      apiFetch<{ transaction: { id: string; status: string } }>(
        `/api/finance/transactions/${id}/approve`,
        { method: 'POST' },
      ),
    voidTransaction: (id: string) =>
      apiFetch<{ transaction: { id: string; status: string } }>(
        `/api/finance/transactions/${id}/void`,
        { method: 'POST' },
      ),
    invoicePdf: (id: string) =>
      apiFetch<{ object_key: string; download_url: string }>(
        `/api/finance/transactions/${id}/invoice-pdf`,
      ),
    summary: () => apiFetch<FinanceSummary>('/api/finance/summary'),
    obligations: () => apiFetch<{ obligations: FinanceObligation[] }>('/api/finance/obligations'),
    createObligation: (body: {
      kind: 'receivable' | 'payable';
      counterparty_name: string;
      amount: number;
      due_date?: string | null;
      note?: string | null;
    }) =>
      apiFetch<{ obligation: FinanceObligation }>('/api/finance/obligations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    payObligation: (
      id: string,
      body: {
        account_id: string;
        amount: number;
        receipt_object_key?: string | null;
        note?: string | null;
      },
    ) =>
      apiFetch<{ obligation: FinanceObligation; transaction: FinanceTransaction }>(
        `/api/finance/obligations/${id}/pay`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },

  inventory: {
    warehouses: () => apiFetch<{ warehouses: Warehouse[] }>('/api/inventory/warehouses'),
    createWarehouse: (body: { name: string; address?: string | null; is_default?: boolean }) =>
      apiFetch<{ warehouse: Warehouse }>('/api/inventory/warehouses', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    items: () => apiFetch<{ items: InventoryItem[] }>('/api/inventory/items'),
    createItem: (body: {
      sku: string;
      barcode?: string | null;
      name: string;
      unit: string;
      cost_price: number;
      sell_price: number;
      min_stock: number;
      image_object_key?: string | null;
    }) =>
      apiFetch<{ item: InventoryItem }>('/api/inventory/items', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    stocks: () => apiFetch<{ stocks: InventoryStockRow[] }>('/api/inventory/stocks'),
    movements: () => apiFetch<{ movements: StockMovementRow[] }>('/api/inventory/movements'),
    createMovement: (body: {
      item_id: string;
      warehouse_id: string;
      target_warehouse_id?: string | null;
      movement_type: 'in' | 'out' | 'adjustment' | 'transfer';
      qty: number;
      unit_cost?: number;
      note?: string | null;
    }) =>
      apiFetch<{ qty: number; low_stock_alert: boolean }>('/api/inventory/movements', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    suppliers: () => apiFetch<{ suppliers: SupplierRow[] }>('/api/inventory/suppliers'),
    createSupplier: (body: {
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    }) =>
      apiFetch<{ supplier: SupplierRow }>('/api/inventory/suppliers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    purchaseOrders: () =>
      apiFetch<{ purchase_orders: PurchaseOrderRow[] }>('/api/inventory/purchase-orders'),
    createPurchaseOrder: (body: {
      supplier_id: string;
      warehouse_id: string;
      total_amount: number;
      note?: string | null;
    }) =>
      apiFetch<{ purchase_order: PurchaseOrderRow }>('/api/inventory/purchase-orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    receivePurchaseOrder: (
      id: string,
      items: Array<{ item_id: string; qty: number; unit_cost?: number }>,
    ) =>
      apiFetch<{ purchase_order: PurchaseOrderRow }>(
        `/api/inventory/purchase-orders/${id}/receive`,
        {
          method: 'POST',
          body: JSON.stringify({ items }),
        },
      ),
  },

  attendance: {
    offices: () => apiFetch<{ offices: OfficeLocation[] }>('/api/attendance/offices'),
    createOffice: (body: {
      name: string;
      latitude: number;
      longitude: number;
      radius_meters: number;
      work_start_time: string;
      work_end_time: string;
    }) =>
      apiFetch<{ office: OfficeLocation }>('/api/attendance/offices', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    records: () => apiFetch<{ records: AttendanceRecord[] }>('/api/attendance/records'),
    clockIn: (body: {
      office_id: string;
      latitude: number;
      longitude: number;
      selfie_object_key?: string | null;
      qr_token?: string | null;
      note?: string | null;
    }) =>
      apiFetch<{ record: AttendanceRecord; distance_meters: number }>(
        '/api/attendance/clock-in',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    clockOut: (body: {
      latitude?: number;
      longitude?: number;
      selfie_object_key?: string | null;
      note?: string | null;
    }) =>
      apiFetch<{ record: AttendanceRecord }>('/api/attendance/clock-out', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    requestLeave: (body: { attendance_date: string; status: 'leave' | 'sick'; note: string }) =>
      apiFetch<{ record: AttendanceRecord }>('/api/attendance/leave', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approveAttendance: (id: string, decision: 'approved' | 'rejected', note?: string) =>
      apiFetch<{ record: AttendanceRecord }>(`/api/attendance/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      }),
  },

  payroll: {
    runs: () => apiFetch<{ runs: PayrollRunRow[] }>('/api/payroll/runs'),
    runDetail: (id: string) =>
      apiFetch<{ run: PayrollRunRow; items: PayrollItemRow[] }>(`/api/payroll/runs/${id}`),
    createRun: (body: { period_start: string; period_end: string }) =>
      apiFetch<{ run: PayrollRunRow; items: PayrollItemRow[] }>('/api/payroll/runs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateItem: (
      runId: string,
      itemId: string,
      body: { allowances?: number; overtime_pay?: number; deductions?: number },
    ) =>
      apiFetch<{ item: PayrollItemRow }>(`/api/payroll/runs/${runId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    approveRun: (id: string) =>
      apiFetch<{ run: PayrollRunRow }>(`/api/payroll/runs/${id}/approve`, { method: 'POST' }),
    payRun: (id: string, finance_account_id: string) =>
      apiFetch<{ run: PayrollRunRow; finance_transaction_id: string | null }>(
        `/api/payroll/runs/${id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ finance_account_id }),
        },
      ),
    slipUrl: (itemId: string) =>
      apiFetch<{ object_key: string; download_url: string }>(
        `/api/payroll/items/${itemId}/slip-url`,
      ),
  },

  rbac: {
    roles: () => apiFetch<{ roles: RoleWithPermissions[] }>('/api/rbac/roles'),
    permissions: () => apiFetch<{ permissions: RolePermission[] }>('/api/rbac/permissions'),
    updateRolePermissions: (roleId: string, permission_ids: string[]) =>
      apiFetch<{ ok: boolean; count: number }>(`/api/rbac/roles/${roleId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permission_ids }),
      }),
    employees: () => apiFetch<{ employees: EmployeeRow[] }>('/api/rbac/employees'),
    createEmployee: (body: {
      employee_code: string;
      full_name: string;
      email: string;
      phone?: string | null;
      role_id: string;
      base_salary: number;
    }) =>
      apiFetch<{ employee: EmployeeRow }>('/api/rbac/employees', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateEmployee: (
      id: string,
      body: {
        full_name?: string;
        phone?: string | null;
        role_id?: string;
        base_salary?: number;
        is_active?: boolean;
      },
    ) =>
      apiFetch<{ employee: EmployeeRow }>(`/api/rbac/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    auditLogs: (moduleFilter?: string) => {
      const qs = moduleFilter ? `?module=${encodeURIComponent(moduleFilter)}` : '';
      return apiFetch<{ audit_logs: AuditLogRow[] }>(`/api/rbac/audit-logs${qs}`);
    },
  },

  storage: {
    presignUpload: (body: {
      category: 'receipt' | 'selfie' | 'product' | 'avatar';
      filename: string;
      content_type: string;
    }) =>
      apiFetch<{ object_key: string; upload_url: string; expires_in: number }>(
        '/api/storage/presign-upload',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    presignDownload: (object_key: string) =>
      apiFetch<{ object_key: string; download_url: string; expires_in: number }>(
        '/api/storage/presign-download',
        { method: 'POST', body: JSON.stringify({ object_key }) },
      ),
  },

  realtime: {
    seal: (feed: RealtimeFeed) =>
      apiFetch<SealedLiveQuery<Record<string, unknown>>>('/api/realtime/seal', {
        method: 'POST',
        body: JSON.stringify({ feed }),
      }),
  },

  notifications: {
    list: (limit = 30) =>
      apiFetch<NotificationsResponse>(`/api/notifications?limit=${limit}`),
    unreadCount: () => apiFetch<{ unread: number }>('/api/notifications/unread-count'),
    registerToken: (body: { token: string; platform: 'web' | 'flutter' }) =>
      apiFetch<{ registered: boolean }>('/api/notifications/tokens', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    unregisterToken: (token: string) =>
      apiFetch<{ unregistered: number }>('/api/notifications/tokens/unregister', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    markRead: (id: string) =>
      apiFetch<{ marked: number }>(`/api/notifications/${id}/read`, {
        method: 'POST',
      }),
    markAllRead: () =>
      apiFetch<{ marked: number }>('/api/notifications/read-all', {
        method: 'POST',
      }),
  },

  profile: {
    claimAccount: (code: string) =>
      apiFetch<{ claimed: boolean; employee_code: string }>('/api/auth/claim', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    lookupUsername: (username: string) =>
      apiFetch<{ email: string | null }>('/api/auth/username-lookup', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
    setUsername: (username: string) =>
      apiFetch<{ username: string | null }>('/api/me/username', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
  },
};

export async function uploadFileViaPresign(
  category: 'receipt' | 'selfie' | 'product' | 'avatar',
  file: File,
): Promise<string> {
  const contentType = file.type || 'application/octet-stream';
  const presign = await erpApi.storage.presignUpload({
    category,
    filename: file.name,
    content_type: contentType,
  });

  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload ke Neon Object Storage gagal (HTTP ${putRes.status}).`);
  }
  return presign.object_key;
}
