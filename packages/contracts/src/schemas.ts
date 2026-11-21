import { z } from 'zod';

const bigintPositiveSchema = z
  .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)])
  .transform((val) => BigInt(val));

const bigintNonNegativeSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((val) => BigInt(val));

export const createAccountSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['cash', 'bank', 'ewallet', 'qris']),
  account_number: z.string().trim().max(64).optional().nullable(),
  initial_balance: bigintNonNegativeSchema.optional().default(0),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['income', 'expense']),
});

export const createTransactionSchema = z
  .object({
    account_id: z.string().uuid(),
    target_account_id: z.string().uuid().optional().nullable(),
    category_id: z.string().uuid().optional().nullable(),
    type: z.enum(['income', 'expense', 'transfer']),
    amount: bigintPositiveSchema,
    description: z.string().trim().min(1).max(500),
    reference_type: z.string().trim().max(64).optional().nullable(),
    reference_id: z.string().uuid().optional().nullable(),
    receipt_object_key: z.string().trim().max(255).optional().nullable(),
    status: z.enum(['pending', 'posted']).optional().default('posted'),
  })
  .refine(
    (data) => {
      if (data.type === 'transfer') {
        return Boolean(data.target_account_id) && data.target_account_id !== data.account_id;
      }
      return true;
    },
    { message: 'Transfer requires a different target_account_id.' },
  );

export const createObligationSchema = z.object({
  kind: z.enum(['receivable', 'payable']),
  counterparty_name: z.string().trim().min(2).max(120),
  amount: bigintPositiveSchema,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const payObligationSchema = z.object({
  account_id: z.string().uuid(),
  amount: bigintPositiveSchema,
  receipt_object_key: z.string().trim().max(255).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

export const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(250).optional().nullable(),
  is_default: z.boolean().optional().default(false),
});

export const createItemSchema = z.object({
  sku: z.string().trim().min(2).max(64),
  barcode: z.string().trim().max(64).optional().nullable(),
  name: z.string().trim().min(2).max(140),
  unit: z.string().trim().min(1).max(32).default('pcs'),
  cost_price: bigintNonNegativeSchema,
  sell_price: bigintNonNegativeSchema,
  min_stock: z.number().int().nonnegative().default(0),
  image_object_key: z.string().trim().max(255).optional().nullable(),
});

export const updateItemSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  barcode: z.string().trim().max(64).optional().nullable(),
  unit: z.string().trim().min(1).max(32).optional(),
  cost_price: bigintNonNegativeSchema.optional(),
  sell_price: bigintNonNegativeSchema.optional(),
  min_stock: z.number().int().nonnegative().optional(),
  image_object_key: z.string().trim().max(255).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const createMovementSchema = z
  .object({
    item_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    target_warehouse_id: z.string().uuid().optional().nullable(),
    movement_type: z.enum(['in', 'out', 'adjustment', 'transfer']),
    qty: z.number().int(),
    unit_cost: bigintNonNegativeSchema.optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.movement_type === 'adjustment') return data.qty !== 0;
      if (data.movement_type === 'transfer') {
        return (
          data.qty > 0 &&
          Boolean(data.target_warehouse_id) &&
          data.target_warehouse_id !== data.warehouse_id
        );
      }
      return data.qty > 0;
    },
    { message: 'Invalid movement quantity or target warehouse.' },
  );

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  address: z.string().trim().max(250).optional().nullable(),
});

export const createPurchaseOrderSchema = z.object({
  po_number: z.string().trim().min(3).max(64).optional(),
  supplier_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  total_amount: bigintPositiveSchema,
  note: z.string().trim().max(400).optional().nullable(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        qty: z.number().int().positive(),
        unit_cost: bigintNonNegativeSchema,
      }),
    )
    .optional()
    .default([]),
});

export const createOfficeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().int().min(20).max(5000).default(150),
  work_start_time: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  work_end_time: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
});

export const clockInSchema = z.object({
  office_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  selfie_object_key: z.string().trim().min(3).max(255).optional().nullable(),
  qr_token: z.string().trim().min(3).max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

export const clockOutSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  selfie_object_key: z.string().trim().max(255).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

export const leaveRequestSchema = z.object({
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['leave', 'sick']),
  note: z.string().trim().min(3).max(400),
});

export const approveAttendanceSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional().nullable(),
});

export const createPayrollRunSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const updatePayrollItemSchema = z.object({
  allowances: bigintNonNegativeSchema.optional(),
  overtime_pay: bigintNonNegativeSchema.optional(),
  deductions: bigintNonNegativeSchema.optional(),
});

export const payPayrollRunSchema = z.object({
  finance_account_id: z.string().uuid(),
});

export const updateRolePermissionsSchema = z.object({
  permission_ids: z.array(z.string().uuid()),
});

const usernameBase = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_.]+$/, 'username hanya boleh huruf kecil, angka, titik, dan garis bawah');

export const usernameLookupSchema = z.object({
  username: usernameBase,
});

export const setUsernameSchema = z.object({
  username: usernameBase,
});

export const claimAccountSchema = z.object({
  code: z.string().trim().min(6).max(32),
});

export const createEmployeeSchema = z.object({
  employee_code: z.string().trim().min(2).max(32),
  full_name: z.string().trim().min(2).max(120),
  email: z.string().email().transform((v) => v.toLowerCase()),
  username: usernameBase.optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  role_id: z.string().uuid(),
  base_salary: bigintNonNegativeSchema,
});

export const updateEmployeeSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  username: usernameBase.optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  role_id: z.string().uuid().optional(),
  base_salary: bigintNonNegativeSchema.optional(),
  is_active: z.boolean().optional(),
  avatar_object_key: z.string().trim().max(255).optional().nullable(),
});

export const presignUploadSchema = z.object({
  category: z.enum(['receipt', 'selfie', 'product', 'avatar']),
  filename: z.string().trim().min(1).max(160),
  content_type: z.string().trim().min(3).max(120),
});

export const presignDownloadSchema = z.object({
  object_key: z.string().trim().min(3).max(255),
});

export const sealRealtimeSchema = z.object({
  feed: z.enum([
    'erp:finance',
    'erp:inventory',
    'erp:attendance',
    'finance_accounts',
    'finance_transactions',
    'inventory_stocks',
    'attendances',
  ]),
});

export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(32).max(4096),
  platform: z.enum(['web', 'flutter']),
});
