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

export const updateOfficeSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius_meters: z.number().int().min(20).max(5000).optional(),
  work_start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  work_end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const attendanceVerificationMethodSchema = z.enum(['biometric', 'face_scan', 'qr', 'selfie']);

export const faceModelSchema = z.enum(['web_faceapi_128d', 'mobile_facenet_192d']);

export const faceDescriptorSchema = z.array(z.number().finite()).min(128).max(192);

export const faceEnrollSchema = z.object({
  face_model: faceModelSchema,
  face_descriptor: faceDescriptorSchema,
  face_samples: z.array(faceDescriptorSchema).min(1).max(6).optional(),
  enrollment_poses: z.array(z.string().trim().min(1).max(32)).min(1).max(6).optional(),
  selfie_object_key: z.string().trim().min(3).max(255),
  derived_from_reference: z.boolean().optional(),
  replace: z.boolean().optional(),
});

export const faceVerifySchema = z.object({
  face_model: faceModelSchema,
  face_descriptor: faceDescriptorSchema,
});

export const attendanceDeviceInfoSchema = z
  .object({
    brand: z.string().trim().max(80).optional().nullable(),
    model: z.string().trim().max(100).optional().nullable(),
    manufacturer: z.string().trim().max(80).optional().nullable(),
    os_version: z.string().trim().max(80).optional().nullable(),
    platform: z.string().trim().max(32).optional().nullable(),
    device_id: z.string().trim().max(128).optional().nullable(),
    is_physical_device: z.boolean().optional().nullable(),
    local_ip: z.string().trim().max(64).optional().nullable(),
    gps_accuracy_meters: z.number().nonnegative().max(100000).optional().nullable(),
    is_mocked_gps: z.boolean().optional().nullable(),
    biometric_type: z.string().trim().max(64).optional().nullable(),
    face_similarity_percent: z.number().min(0).max(100).optional().nullable(),
  })
  .optional()
  .nullable();

export const clockInSchema = z.object({
  office_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  selfie_object_key: z.string().trim().min(3).max(255).optional().nullable(),
  qr_token: z.string().trim().min(3).max(120).optional().nullable(),
  verification_method: attendanceVerificationMethodSchema.optional(),
  biometric_verified: z.boolean().optional(),
  face_model: faceModelSchema.optional().nullable(),
  face_descriptor: faceDescriptorSchema.optional().nullable(),
  device_info: attendanceDeviceInfoSchema,
  note: z.string().trim().max(300).optional().nullable(),
});

export const clockOutSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  selfie_object_key: z.string().trim().max(255).optional().nullable(),
  qr_token: z.string().trim().min(3).max(120).optional().nullable(),
  verification_method: attendanceVerificationMethodSchema.optional(),
  biometric_verified: z.boolean().optional(),
  face_model: faceModelSchema.optional().nullable(),
  face_descriptor: faceDescriptorSchema.optional().nullable(),
  device_info: attendanceDeviceInfoSchema,
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

export const updateMyProfileSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120).optional(),
    username: usernameBase.optional().nullable(),
    phone: z.string().trim().max(32).optional().nullable(),
    avatar_object_key: z.string().trim().max(255).optional().nullable(),
  })
  .refine(
    (data) =>
      data.full_name !== undefined ||
      data.username !== undefined ||
      data.phone !== undefined ||
      data.avatar_object_key !== undefined,
    { message: 'Minimal satu field profil harus diubah.' },
  );

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
  issue_claim_code: z.boolean().optional(),
});

export const updateEmployeeSchema = z.object({
  employee_code: z.string().trim().min(2).max(32).optional(),
  email: z.string().email().transform((v) => v.toLowerCase()).optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
  username: usernameBase.optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  role_id: z.string().uuid().optional(),
  base_salary: bigintNonNegativeSchema.optional(),
  is_active: z.boolean().optional(),
  avatar_object_key: z.string().trim().max(255).optional().nullable(),
});

export const presignUploadSchema = z.object({
  category: z.enum(['receipt', 'selfie', 'product', 'avatar', 'release', 'portfolio']),
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

export const appPlatformSchema = z.enum(['android', 'web']);

export const semverSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/, 'Versi harus memakai format semver seperti 1.2.0');

export const createAppReleaseSchema = z.object({
  platform: appPlatformSchema,
  version: semverSchema,
  build_number: z.number().int().min(1).max(999999),
  title: z.string().trim().min(3).max(120),
  changelog: z.array(z.string().trim().min(2).max(240)).min(1).max(20),
  download_url: z
    .string()
    .trim()
    .url()
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://'),
      'URL unduhan harus diawali http:// atau https://',
    )
    .optional()
    .nullable(),
  file_object_key: z.string().trim().min(3).max(255).optional().nullable(),
  file_size_bytes: bigintNonNegativeSchema.optional().nullable(),
  is_mandatory: z.boolean().optional(),
});

export function compareSemver(a: string, b: string): number {
  const parse = (raw: string): [number, number, number] => {
    const clean = raw.trim().replace(/^v/i, '').split('+')[0]?.split('-')[0] ?? '0.0.0';
    const parts = clean.split('.').map((p) => {
      const n = Number.parseInt(p, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a0, a1, a2] = parse(a);
  const [b0, b1, b2] = parse(b);
  if (a0 !== b0) return a0 > b0 ? 1 : -1;
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  return 0;
}

export function isNewerRelease(
  currentVersion: string,
  currentBuild: number,
  latestVersion: string,
  latestBuild: number,
): boolean {
  if (currentBuild <= 0) {
    return compareSemver(latestVersion, currentVersion) > 0;
  }
  if (latestBuild > currentBuild) return true;
  if (latestBuild < currentBuild) return false;
  return compareSemver(latestVersion, currentVersion) > 0;
}

export const posPaymentMethodSchema = z.enum(['cash', 'qris', 'transfer', 'ewallet']);
export const posDiscountTypeSchema = z.enum(['none', 'amount', 'percent']);

export const posSaleItemInputSchema = z.object({
  inventory_item_id: z.string().uuid().optional().nullable(),
  sku: z.string().trim().max(64).optional().nullable(),
  item_name: z.string().trim().min(1).max(140),
  unit: z.string().trim().min(1).max(32).default('pcs'),
  qty: z.number().int().positive().max(10000),
  unit_price: bigintPositiveSchema,
});

export const createPosSaleSchema = z.object({
  warehouse_id: z.string().uuid().optional().nullable(),
  account_id: z.string().uuid(),
  customer_name: z.string().trim().max(120).optional().nullable(),
  payment_method: posPaymentMethodSchema,
  discount_type: posDiscountTypeSchema.optional().default('none'),
  discount_value: bigintNonNegativeSchema.optional().default(0),
  tax_percent: z.number().int().min(0).max(100).optional().default(0),
  paid_amount: bigintPositiveSchema.optional().nullable(),
  note: z.string().trim().max(400).optional().nullable(),
  items: z.array(posSaleItemInputSchema).min(1).max(100),
});

export const voidPosSaleSchema = z.object({
  reason: z.string().trim().max(300).optional().nullable(),
});

export const PORTFOLIO_CATEGORIES = [
  'website',
  'mobile_app',
  'erp_system',
  'ui_ux',
  'automation',
  'other',
] as const;

export const PORTFOLIO_OFFER_TYPES = [
  'ready_to_buy',
  'custom_similar',
  'hybrid',
] as const;

export const PORTFOLIO_AVAILABILITY_STATUSES = [
  'available',
  'custom_only',
  'sold',
] as const;

export const PORTFOLIO_PRICE_TYPES = [
  'fixed',
  'starting_from',
  'negotiable',
] as const;

export const portfolioCategorySchema = z.enum(PORTFOLIO_CATEGORIES);
export const portfolioOfferTypeSchema = z.enum(PORTFOLIO_OFFER_TYPES);
export const portfolioAvailabilitySchema = z.enum(PORTFOLIO_AVAILABILITY_STATUSES);
export const portfolioPriceTypeSchema = z.enum(PORTFOLIO_PRICE_TYPES);

export const portfolioSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug hanya boleh huruf kecil, angka, dan tanda hubung.');

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((raw) => {
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' && parsed.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'URL harus memakai https:// yang valid.');

const portfolioFieldsShape = {
  title: z.string().trim().min(3).max(140),
  slug: portfolioSlugSchema.optional(),
  tagline: z.string().trim().max(220).default(''),
  summary: z.string().trim().max(5000).default(''),
  category: portfolioCategorySchema.default('website'),
  offer_type: portfolioOfferTypeSchema.default('hybrid'),
  availability_status: portfolioAvailabilitySchema.default('available'),
  price_type: portfolioPriceTypeSchema.default('fixed'),
  price_amount: bigintNonNegativeSchema.nullable().optional(),
  original_price_amount: bigintNonNegativeSchema.nullable().optional(),
  client_name: z.string().trim().max(120).nullable().optional(),
  delivery_estimate: z.string().trim().max(80).nullable().optional(),
  demo_url: httpsUrlSchema.nullable().optional(),
  cover_image_key: z.string().trim().min(3).max(255).nullable().optional(),
  cover_image_url: httpsUrlSchema.nullable().optional(),
  gallery_image_keys: z.array(z.string().trim().min(3).max(255)).max(8).default([]),
  gallery_image_urls: z.array(httpsUrlSchema).max(8).default([]),
  tech_stack: z.array(z.string().trim().min(1).max(40)).max(16).default([]),
  highlights: z.array(z.string().trim().min(1).max(200)).max(16).default([]),
  whatsapp_prefill: z.string().trim().max(300).nullable().optional(),
  is_featured: z.boolean().default(false),
  is_published: z.boolean().default(false),
  sort_order: z.number().int().min(-999).max(9999).default(0),
};

export const createPortfolioProjectSchema = z
  .object(portfolioFieldsShape)
  .refine(
    (data) => {
      if (data.price_type !== 'negotiable') {
        return (
          data.price_amount !== null &&
          data.price_amount !== undefined &&
          data.price_amount > 0n
        );
      }
      return true;
    },
    { message: 'Harga project wajib diisi lebih dari 0 untuk tipe harga ini.' },
  );

export const updatePortfolioProjectSchema = z
  .object(portfolioFieldsShape)
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Minimal satu field portofolio harus diperbarui.',
  })
  .refine(
    (data) => {
      if (
        data.price_type &&
        data.price_type !== 'negotiable' &&
        data.price_amount !== undefined
      ) {
        return data.price_amount !== null && data.price_amount > 0n;
      }
      return true;
    },
    { message: 'Harga project wajib lebih dari 0 untuk tipe harga ini.' },
  );

export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];
export type PortfolioOfferType = (typeof PORTFOLIO_OFFER_TYPES)[number];
export type PortfolioAvailabilityStatus = (typeof PORTFOLIO_AVAILABILITY_STATUSES)[number];
export type PortfolioPriceType = (typeof PORTFOLIO_PRICE_TYPES)[number];
