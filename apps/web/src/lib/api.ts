import type { RoleCode } from '@ekalliptus/contracts';
import type { SealedLiveQuery } from '@neon/realtime/client';
import { WEB_APP_BUILD_NUMBER, WEB_APP_VERSION } from './appVersion.ts';
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

export async function publicApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiError(500, 'VITE_API_BASE_URL belum dikonfigurasi.');
  }
  const headers = new Headers(init.headers);
  headers.set('X-Platform', 'web');
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
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

export interface ClaimPreviewEmployee {
  employee_code: string;
  full_name: string;
  email: string;
  username: string | null;
  role_code: RoleCode;
  role_name: string;
}

export interface ClaimPreviewResponse {
  valid: boolean;
  employee: ClaimPreviewEmployee;
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
  avatar_url?: string | null;
  created_at?: string;
}

export interface ProfileAuditEntry {
  id: string;
  module: string;
  action: string;
  platform: 'web' | 'flutter' | 'system';
  entity_id: string | null;
  created_at: string;
}

export interface PersonalAttendanceRecord {
  id: string;
  attendance_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: 'present' | 'late' | 'leave' | 'sick' | 'absent';
  approval_status: 'approved' | 'pending' | 'rejected';
  late_minutes: number;
  overtime_minutes: number;
  clock_in_method: string | null;
  office_name: string | null;
}

export interface PersonalPayrollSlip {
  item_id: string;
  payroll_run_id: string;
  period_start: string;
  period_end: string;
  run_status: 'draft' | 'approved' | 'paid';
  base_salary: string;
  allowances: string;
  overtime_pay: string;
  deductions: string;
  net_salary: string;
  has_pdf: boolean;
  paid_at: string | null;
}

export type RoleWorkspacePayload =
  | {
      kind: 'owner';
      executive_metrics: {
        total_cash_balance: string;
        active_employees_count: number;
        unclaimed_employees_count: number;
        office_locations_count: number;
        warehouses_count: number;
        pending_finance_tx: number;
        pending_attendance_approvals: number;
        draft_payroll_runs: number;
        approved_unpaid_payroll_runs: number;
        low_stock_alerts: number;
        audit_events_24h: number;
      };
      offices: OfficeLocation[];
      role_distribution: Array<{
        role_code: RoleCode;
        role_name: string;
        employee_count: number;
      }>;
    }
  | {
      kind: 'finance';
      finance_metrics: {
        total_cash_balance: string;
        active_accounts_count: number;
        pending_transactions_count: number;
        open_receivable_total: string;
        open_payable_total: string;
        month_income: string;
        month_expense: string;
        approved_payroll_to_pay: number;
      };
      accounts_preview: Array<{
        id: string;
        name: string;
        type: 'cash' | 'bank' | 'ewallet' | 'qris';
        balance: string;
      }>;
    }
  | {
      kind: 'warehouse';
      warehouse_metrics: {
        warehouses_count: number;
        active_items_count: number;
        low_stock_alerts: number;
        open_purchase_orders: number;
        my_movements_30d: number;
      };
      low_stock_preview: Array<{
        item_id: string;
        sku: string;
        name: string;
        unit: string;
        warehouse_name: string;
        qty: number;
        min_stock: number;
      }>;
      warehouses_list: Warehouse[];
    }
  | {
      kind: 'hr';
      hr_metrics: {
        active_employees_count: number;
        unclaimed_employees_count: number;
        present_today_count: number;
        pending_attendance_approvals: number;
        draft_payroll_runs: number;
        offices_count: number;
      };
      pending_leaves_preview: Array<{
        id: string;
        employee_id: string;
        employee_name: string;
        employee_code: string;
        attendance_date: string;
        status: string;
        note: string | null;
      }>;
      unclaimed_employees_preview: Array<{
        id: string;
        employee_code: string;
        full_name: string;
        email: string;
        role_name: string;
      }>;
    }
  | {
      kind: 'staff';
      staff_metrics: {
        offices_count: number;
        active_catalog_items: number;
      };
      offices: Array<{
        id: string;
        name: string;
        radius_meters: number;
        work_start_time: string;
        work_end_time: string;
      }>;
    };

export interface ProfileSummaryResponse {
  employee: EmployeeProfile & { avatar_url: string | null };
  face_enrollment?: FaceEnrollmentSummary;
  role: {
    code: RoleCode;
    name: string;
    description: string;
  };
  permissions: string[];
  platform: 'web' | 'flutter' | 'system';
  security: {
    registered_devices_count: number;
    device_platforms: {
      web: number;
      flutter: number;
    };
    unread_notifications: number;
    recent_audit_actions: ProfileAuditEntry[];
  };
  personal_attendance: {
    days_window: number;
    present_days: number;
    late_days: number;
    leave_days: number;
    sick_days: number;
    total_late_minutes: number;
    total_overtime_minutes: number;
    today: PersonalAttendanceRecord | null;
    recent_records: PersonalAttendanceRecord[];
  };
  personal_payroll: PersonalPayrollSlip[];
  role_workspace: RoleWorkspacePayload;
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

export type PosPaymentMethod = 'cash' | 'qris' | 'transfer' | 'ewallet';
export type PosDiscountType = 'none' | 'amount' | 'percent';

export interface PosCatalogProduct {
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
  stocks_by_warehouse: Record<string, number>;
  total_stock: number;
}

export interface PosCatalogResponse {
  warehouses: Warehouse[];
  default_warehouse_id: string | null;
  accounts: FinanceAccount[];
  products: PosCatalogProduct[];
}

export interface PosSaleItemRow {
  id: string;
  sale_id: string;
  inventory_item_id: string | null;
  sku: string | null;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: string;
  unit_cost: string;
  line_total: string;
}

export interface PosSaleRow {
  id: string;
  sale_number: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  account_id: string;
  account_name: string;
  finance_transaction_id: string | null;
  cashier_id: string;
  cashier_name: string;
  customer_name: string | null;
  payment_method: PosPaymentMethod;
  subtotal: string;
  discount_type: PosDiscountType;
  discount_value: string;
  discount_amount: string;
  tax_percent: number;
  tax_amount: string;
  total_amount: string;
  paid_amount: string;
  change_amount: string;
  status: 'completed' | 'void';
  note: string | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  items: PosSaleItemRow[];
}

export interface PosSalesReport {
  today_revenue: string;
  today_count: number;
  today_avg_ticket: string;
  period_revenue: string;
  period_count: number;
  period_discount_total: string;
  period_tax_total: string;
  void_count: number;
  by_payment_method: Record<PosPaymentMethod, { count: number; total: string }>;
  top_products: Array<{
    sku: string;
    item_name: string;
    unit: string;
    qty_sold: number;
    revenue: string;
  }>;
  accounts: FinanceAccount[];
}

export interface PosSalesResponse {
  sales: PosSaleRow[];
  report: PosSalesReport;
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

export interface AttendanceDeviceInfo {
  brand?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  os_version?: string | null;
  platform?: string | null;
  device_id?: string | null;
  is_physical_device?: boolean | null;
  local_ip?: string | null;
  gps_accuracy_meters?: number | null;
  is_mocked_gps?: boolean | null;
  biometric_type?: string | null;
  face_similarity_percent?: number | null;
}

export type FaceModel = 'web_faceapi_128d' | 'mobile_facenet_192d';

export interface FaceEnrollmentSummary {
  enrolled: boolean;
  enrolled_at: string | null;
  models: FaceModel[];
  has_reference_photo: boolean;
  reference_photo_url?: string | null;
  sample_count?: number;
  poses?: string[];
  is_multi_pose?: boolean;
}

export type FaceStatusResponse = FaceEnrollmentSummary;

export interface FaceVerifyResponse {
  enrolled: boolean;
  model_enrolled: boolean;
  matched: boolean;
  similarity_percent: number;
  distance: number;
  threshold: number;
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
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_in_selfie_key: string | null;
  clock_out_selfie_key: string | null;
  clock_in_method: string | null;
  clock_out_method: string | null;
  clock_in_ip: string | null;
  clock_out_ip: string | null;
  clock_in_device: AttendanceDeviceInfo | null;
  clock_out_device: AttendanceDeviceInfo | null;
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
  has_claim_code?: boolean;
  face_enrolled?: boolean;
  face_enrolled_at?: string | null;
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
  entity_id: string | null;
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

export interface AppReleaseRow {
  id: string;
  platform: 'android' | 'web';
  version: string;
  build_number: number;
  title: string;
  changelog: string[];
  download_url: string | null;
  file_object_key?: string | null;
  file_size_bytes?: string | null;
  has_apk?: boolean;
  is_mandatory: boolean;
  is_published: boolean;
  published_at: string;
  created_at?: string;
}

export interface AppVersionCheckResponse {
  platform: 'android' | 'web';
  current_version: string;
  current_build: number;
  has_update: boolean;
  latest: AppReleaseRow | null;
  pending_releases: AppReleaseRow[];
  releases: AppReleaseRow[];
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
    posCatalog: () => apiFetch<PosCatalogResponse>('/api/finance/pos/catalog'),
    posSales: (params?: { status?: string; payment_method?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.payment_method) qs.set('payment_method', params.payment_method);
      if (params?.limit) qs.set('limit', String(params.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch<PosSalesResponse>(`/api/finance/pos/sales${suffix}`);
    },
    createPosSale: (body: {
      warehouse_id?: string | null;
      account_id: string;
      customer_name?: string | null;
      payment_method: PosPaymentMethod;
      discount_type?: PosDiscountType;
      discount_value?: number;
      tax_percent?: number;
      paid_amount?: number | null;
      note?: string | null;
      items: Array<{
        inventory_item_id?: string | null;
        sku?: string | null;
        item_name: string;
        unit: string;
        qty: number;
        unit_price: number;
      }>;
    }) =>
      apiFetch<{
        sale: PosSaleRow;
        txid: string;
        low_stock_alerts: Array<{ name: string; sku: string; qty: number }>;
      }>('/api/finance/pos/sales', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    posReceiptPdf: (id: string) =>
      apiFetch<{ object_key: string; download_url: string }>(
        `/api/finance/pos/sales/${id}/receipt-pdf`,
      ),
    voidPosSale: (id: string, reason?: string | null) =>
      apiFetch<{ sale: PosSaleRow }>(`/api/finance/pos/sales/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? null }),
      }),
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
    updateOffice: (
      id: string,
      body: Partial<{
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        work_start_time: string;
        work_end_time: string;
      }>,
    ) =>
      apiFetch<{ office: OfficeLocation }>(`/api/attendance/offices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    records: () => apiFetch<{ records: AttendanceRecord[] }>('/api/attendance/records'),
    faceStatus: () => apiFetch<FaceStatusResponse>('/api/attendance/face-status'),
    fetchFaceReferenceBlob: async () => {
      if (!API_BASE_URL) {
        throw new ApiError(500, 'VITE_API_BASE_URL belum dikonfigurasi.');
      }
      const perform = async (forceRefresh: boolean) => {
        const token = await getAccessToken(forceRefresh);
        return fetch(`${API_BASE_URL}/api/attendance/face-reference-image`, {
          headers: {
            'X-Platform': 'web',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
      };
      let res = await perform(false);
      if (res.status === 401) {
        clearAccessTokenCache();
        res = await perform(true);
      }
      if (!res.ok) {
        throw new ApiError(res.status, 'Gagal mengunduh foto referensi wajah.');
      }
      return res.blob();
    },
    enrollFace: (body: {
      face_model: FaceModel;
      face_descriptor: number[];
      face_samples?: number[][];
      enrollment_poses?: string[];
      selfie_object_key: string;
      derived_from_reference?: boolean;
      replace?: boolean;
    }) =>
      apiFetch<{
        enrolled: boolean;
        enrolled_at: string;
        models: FaceModel[];
        sample_count?: number;
        poses?: string[];
        is_multi_pose?: boolean;
      }>(
        '/api/attendance/face-enroll',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    deleteMyFace: () =>
      apiFetch<{ ok: boolean; enrolled: boolean }>('/api/attendance/face-enroll', {
        method: 'DELETE',
      }),
    verifyFace: (face_model: FaceModel, face_descriptor: number[]) =>
      apiFetch<FaceVerifyResponse>('/api/attendance/face-verify', {
        method: 'POST',
        body: JSON.stringify({ face_model, face_descriptor }),
      }),
    clockIn: (body: {
      office_id: string;
      latitude: number;
      longitude: number;
      selfie_object_key?: string | null;
      qr_token?: string | null;
      verification_method?: 'biometric' | 'face_scan' | 'qr' | 'selfie';
      biometric_verified?: boolean;
      face_model?: FaceModel | null;
      face_descriptor?: number[] | null;
      device_info?: AttendanceDeviceInfo;
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
      qr_token?: string | null;
      verification_method?: 'biometric' | 'face_scan' | 'qr' | 'selfie';
      biometric_verified?: boolean;
      face_model?: FaceModel | null;
      face_descriptor?: number[] | null;
      device_info?: AttendanceDeviceInfo;
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
      username?: string | null;
      phone?: string | null;
      role_id: string;
      base_salary: number;
      issue_claim_code?: boolean;
    }) =>
      apiFetch<{ employee: EmployeeRow; claim_code?: string }>('/api/rbac/employees', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateEmployee: (
      id: string,
      body: {
        employee_code?: string;
        email?: string;
        full_name?: string;
        username?: string | null;
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
    generateClaimCode: (id: string) =>
      apiFetch<{ code: string; email: string; full_name: string }>(
        `/api/rbac/employees/${id}/claim-code`,
        { method: 'POST' },
      ),
    unlinkAuth: (id: string, issue_claim_code = true) =>
      apiFetch<{ ok: boolean; employee: EmployeeRow; claim_code?: string }>(
        `/api/rbac/employees/${id}/unlink-auth`,
        {
          method: 'POST',
          body: JSON.stringify({ issue_claim_code }),
        },
      ),
    deleteEmployee: (id: string) =>
      apiFetch<{ ok: boolean; mode: 'deleted'; employee_id: string }>(
        `/api/rbac/employees/${id}`,
        { method: 'DELETE' },
      ),
    resetEmployeeFace: (id: string) =>
      apiFetch<{ ok: boolean; id: string }>(`/api/rbac/employees/${id}/face`, {
        method: 'DELETE',
      }),
    auditLogs: (moduleFilter?: string) => {
      const qs = moduleFilter ? `?module=${encodeURIComponent(moduleFilter)}` : '';
      return apiFetch<{ audit_logs: AuditLogRow[] }>(`/api/rbac/audit-logs${qs}`);
    },
  },

  storage: {
    presignUpload: (body: {
      category: 'receipt' | 'selfie' | 'product' | 'avatar' | 'release';
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
    previewClaimCode: (code: string) =>
      publicApiFetch<ClaimPreviewResponse>('/api/auth/claim-preview', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      }),
    claimAccount: (code: string) =>
      apiFetch<{ claimed: boolean; employee_code: string }>('/api/auth/claim', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    lookupUsername: (username: string) =>
      publicApiFetch<{ email: string | null }>('/api/auth/username-lookup', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
    setUsername: (username: string) =>
      apiFetch<{ username: string | null }>('/api/me/username', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
    summary: () => apiFetch<ProfileSummaryResponse>('/api/me/profile-summary'),
    updateProfile: (body: {
      full_name?: string;
      username?: string | null;
      phone?: string | null;
      avatar_object_key?: string | null;
    }) =>
      apiFetch<{ employee: EmployeeProfile; avatar_url: string | null }>('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  app: {
    checkVersion: (
      platform: 'web' | 'android' = 'web',
      currentVersion = WEB_APP_VERSION,
      currentBuild = WEB_APP_BUILD_NUMBER,
    ) => {
      const qs = new URLSearchParams({
        platform,
        current_version: currentVersion,
        current_build: String(currentBuild),
      });
      return publicApiFetch<AppVersionCheckResponse>(`/api/app/version?${qs.toString()}`);
    },
    changelog: (platform: 'web' | 'android' = 'web') =>
      publicApiFetch<{ platform: 'web' | 'android'; releases: AppReleaseRow[] }>(
        `/api/app/changelog?platform=${encodeURIComponent(platform)}`,
      ),
    androidDownloadHref: (build?: number) =>
      `${API_BASE_URL}/api/app/download/android${build ? `?build=${build}` : ''}`,
    publishRelease: (body: {
      platform: 'web' | 'android';
      version: string;
      build_number: number;
      title: string;
      changelog: string[];
      download_url?: string | null;
      file_object_key?: string | null;
      file_size_bytes?: number | string | null;
      is_mandatory?: boolean;
    }) =>
      apiFetch<{
        release: AppReleaseRow;
        notification?: {
          recipients: number;
          push: { claimed: number; sent: number; failed: number; deadTokensRemoved: number };
        };
      }>('/api/app/releases', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    notifyRelease: (id: string) =>
      apiFetch<{
        ok: boolean;
        release_id: string;
        recipients: number;
        push: { claimed: number; sent: number; failed: number; deadTokensRemoved: number };
      }>(`/api/app/releases/${id}/notify`, {
        method: 'POST',
      }),
    deleteRelease: (id: string) =>
      apiFetch<{ ok: boolean; id: string }>(`/api/app/releases/${id}`, {
        method: 'DELETE',
      }),
  },
};

export async function uploadFileViaPresign(
  category: 'receipt' | 'selfie' | 'product' | 'avatar' | 'release',
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
