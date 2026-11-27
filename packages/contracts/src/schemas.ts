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
  category: z.enum(['receipt', 'selfie', 'product', 'avatar', 'release', 'portfolio', 'print-jobs']),
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
    'erp:printer',
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
  'web_mobile',
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
  price_type: portfolioPriceTypeSchema.default('negotiable'),
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

export const createPortfolioProjectSchema = z.object(portfolioFieldsShape);

export const updatePortfolioProjectSchema = z
  .object(portfolioFieldsShape)
  .partial()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Minimal satu field portofolio harus diperbarui.',
  });

const NON_DOMAIN_FILE_EXTS = new Set([
  'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'html', 'htm', 'json',
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'gif', 'ico', 'pdf', 'apk', 'zip',
  'gz', 'tar', 'md', 'txt', 'sql', 'env', 'xml', 'yml', 'yaml', 'csv', 'doc',
  'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'mp4', 'mov', 'wav', 'exe', 'vbs',
  'ps1', 'sh', 'php', 'py', 'go', 'rs', 'dart', 'kt', 'java', 'c', 'cpp', 'h',
  'lock', 'map',
]);

function trimUrlTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;:!?)\]]+$/, '');
}

function isAllowedPublicHostForExtract(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.+$/, '');
  if (!lower || !lower.includes('.')) return false;
  if (/^\d+(?:\.\d+){3}$/.test(lower) || lower.includes(':')) return false;
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.arpa|metadata\.google\.internal)$/i.test(lower)) {
    return false;
  }
  return true;
}

export function extractPublicUrlFromText(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;

  const explicitMatches = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  for (const rawMatch of explicitMatches) {
    const cleaned = trimUrlTrailingPunctuation(rawMatch);
    const normalized = cleaned.replace(/^http:\/\//i, 'https://');
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
      if (parsed.port && parsed.port !== '443') continue;
      if (!isAllowedPublicHostForExtract(parsed.hostname)) continue;
      return parsed.toString();
    } catch {
      continue;
    }
  }

  const domainRe = /(?:^|[^a-zA-Z0-9_@.-])((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,24}(?:\/[^\s<>"')]*)?)/g;
  let m: RegExpExecArray | null;
  while ((m = domainRe.exec(text)) !== null) {
    const candidate = trimUrlTrailingPunctuation(m[1] ?? '');
    if (!candidate) continue;
    const hostPart = candidate.split('/')[0]?.toLowerCase() ?? '';
    if (!isAllowedPublicHostForExtract(hostPart)) continue;
    const tld = hostPart.split('.').pop() ?? '';
    if (NON_DOMAIN_FILE_EXTS.has(tld)) continue;
    try {
      const parsed = new URL(`https://${candidate}`);
      if (!isAllowedPublicHostForExtract(parsed.hostname)) continue;
      return parsed.toString();
    } catch {
      continue;
    }
  }

  return null;
}

export const capturePortfolioDemoSchema = z.object({
  demo_url: httpsUrlSchema,
  variants: z
    .array(z.enum(['desktop', 'mobile']))
    .min(1)
    .max(2)
    .optional()
    .default(['desktop', 'mobile']),
  include_subpage: z.boolean().optional().default(true),
  include_og_image: z.boolean().optional().default(true),
});

export type CapturePortfolioDemoVariant = 'desktop' | 'mobile';
export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];
export type PortfolioOfferType = (typeof PORTFOLIO_OFFER_TYPES)[number];
export type PortfolioAvailabilityStatus = (typeof PORTFOLIO_AVAILABILITY_STATUSES)[number];
export type PortfolioPriceType = (typeof PORTFOLIO_PRICE_TYPES)[number];

export const AI_FEATURE_KEYS = ['consult', 'portfolio_autofill'] as const;
export const AI_PROVIDERS = [
  'zai',
  'gemini',
  'openai',
  'openrouter',
  'groq',
  'custom',
] as const;

export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_PRESETS: Record<
  AiProvider,
  {
    label: string;
    endpoint: string;
    defaultModel: string;
    suggestedModels: readonly string[];
  }
> = {
  zai: {
    label: 'Z.ai (GLM)',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    defaultModel: 'glm-4.5-air',
    suggestedModels: ['glm-4.5-air', 'glm-4.5', 'glm-4-plus'],
  },
  gemini: {
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    suggestedModels: [
      'openai/gpt-4o-mini',
      'google/gemini-2.5-flash',
      'anthropic/claude-3.5-haiku',
    ],
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  custom: {
    label: 'Custom (OpenAI-Compatible)',
    endpoint: '',
    defaultModel: '',
    suggestedModels: [],
  },
};

export const aiFeatureKeySchema = z.enum(AI_FEATURE_KEYS);
export const aiProviderSchema = z.enum(AI_PROVIDERS);

export const updateAiFeatureConfigSchema = z
  .object({
    feature_key: aiFeatureKeySchema,
    is_enabled: z.boolean(),
    provider: aiProviderSchema,
    custom_endpoint: z.string().trim().max(500).nullable().optional(),
    model: z.string().trim().max(140),
    api_key: z.string().trim().max(400).nullable().optional(),
    clear_api_key: z.boolean().optional().default(false),
    use_shared_key: z.boolean().optional().default(false),
    system_prompt: z.string().trim().max(8000).default(''),
    temperature: z.number().min(0).max(2).default(0.7),
    max_tokens: z.number().int().min(64).max(4096).default(512),
    assistant_name: z.string().trim().min(1).max(60).optional(),
    greeting_message: z.string().trim().max(1000).optional(),
    handoff_phrases: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    fallback_messages: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    extra_instructions: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const endpoint = data.custom_endpoint?.trim() ?? '';
    const usesShared = data.feature_key === 'portfolio_autofill' && data.use_shared_key;
    if (!usesShared && data.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'Model ID wajib diisi.',
      });
    }
    if (data.provider === 'custom' && !usesShared && !endpoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['custom_endpoint'],
        message: 'Custom endpoint HTTPS wajib diisi untuk provider custom.',
      });
      return;
    }
    if (endpoint.length > 0) {
      try {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['custom_endpoint'],
            message: 'Endpoint AI harus memakai URL https:// yang valid.',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['custom_endpoint'],
          message: 'Endpoint AI tidak valid.',
        });
      }
    }
  });

export const testAiConfigSchema = z.object({
  feature_key: aiFeatureKeySchema,
  prompt: z.string().trim().min(2).max(1000),
});

export const portfolioAutofillRequestSchema = z
  .object({
    brief: z.string().trim().max(2000).optional().default(''),
    title: z.string().trim().max(140).optional().default(''),
    category: portfolioCategorySchema.optional(),
    demo_url: z.string().trim().max(500).optional().default(''),
    tech_stack_hint: z.string().trim().max(400).optional().default(''),
    language: z.enum(['id', 'en']).optional().default('id'),
  })
  .refine((data) => data.brief.length >= 4 || data.title.length >= 3, {
    message: 'Isi catatan singkat minimal 4 karakter atau judul project minimal 3 karakter.',
  });

export const publicAiConsultRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1000),
      }),
    )
    .min(1)
    .max(10),
  locale: z.string().trim().max(10).optional().default('id'),
});

// Smart Printer Otomatis schemas (BIGINT Rupiah, no float money)
const printBigIntNonNegative = z
  .union([z.number().int().nonnegative(), z.string().trim().regex(/^\d+$/), z.bigint().nonnegative()])
  .transform((val) => BigInt(val));

export const PRINT_PAPER_SIZES = ['a4', 'f4', 'legal', 'letter', 'a5', '4x6', '5x7'] as const;
export const PRINT_COLOR_MODES = ['color', 'mono'] as const;
export const PRINT_QUALITIES = ['draft', 'normal', 'high'] as const;
export const PRINT_ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;
export const PRINT_FITS = ['contain', 'cover', 'stretch'] as const;
export const PRINT_JOB_STATUSES = [
  'pending_approval',
  'approved',
  'queued',
  'printing',
  'printed',
  'rejected',
  'failed',
  'cancelled',
] as const;
export const PRINT_JOB_SOURCES = ['whatsapp', 'manual_web', 'manual_mobile'] as const;
export const PRINT_WA_OUTBOX_KINDS = [
  'received',
  'approved',
  'printed',
  'rejected',
  'failed',
] as const;

export type PrintPaperSize = (typeof PRINT_PAPER_SIZES)[number];
export type PrintColorMode = (typeof PRINT_COLOR_MODES)[number];
export type PrintQuality = (typeof PRINT_QUALITIES)[number];
export type PrintOrientation = (typeof PRINT_ORIENTATIONS)[number];
export type PrintFit = (typeof PRINT_FITS)[number];
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];
export type PrintJobSource = (typeof PRINT_JOB_SOURCES)[number];
export type PrintWaOutboxKind = (typeof PRINT_WA_OUTBOX_KINDS)[number];

const PAGE_RANGE_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

export const pageRangeSchema = z
  .string()
  .trim()
  .max(100)
  .refine(
    (val) => val.length === 0 || PAGE_RANGE_RE.test(val),
    'Format rentang halaman tidak valid (contoh: 1-3,5).',
  )
  .transform((val) => (val.length === 0 ? null : val))
  .optional()
  .nullable();

export const createPrintDeviceSchema = z.object({
  device_name: z.string().trim().min(2).max(120),
  host: z.string().trim().max(120).optional().nullable(),
  mdns_host: z.string().trim().max(160).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
});

export const updatePrintDeviceSchema = z.object({
  device_name: z.string().trim().min(2).max(120).optional(),
  host: z.string().trim().max(120).optional().nullable(),
  mdns_host: z.string().trim().max(160).optional().nullable(),
  model: z.string().trim().max(120).optional(),
  is_active: z.boolean().optional(),
  dry_run_mode: z.boolean().optional(),
});

export const PRINT_DEVICE_WA_ACTIONS = [
  'connect_qr',
  'reset_qr',
  'pair_link_code',
  'logout_wa',
] as const;

export type PrintDeviceWaAction = (typeof PRINT_DEVICE_WA_ACTIONS)[number];

export const deviceWhatsappActionSchema = z
  .object({
    action: z.enum(PRINT_DEVICE_WA_ACTIONS),
    phone: z
      .string()
      .trim()
      .max(24)
      .transform((v) => v.replace(/[^\d]/g, ''))
      .optional()
      .nullable(),
  })
  .refine(
    (d) =>
      d.action !== 'pair_link_code' ||
      (Boolean(d.phone) && d.phone!.length >= 10 && d.phone!.length <= 16),
    { message: 'Nomor WhatsApp wajib diisi (10-16 digit, format 628xxx).' },
  );

export const printAgentCommandAckSchema = z.object({
  command: z.string().trim().min(1).max(64),
  ok: z.boolean(),
  message: z.string().trim().max(300).optional().nullable(),
});

export const printAgentHeartbeatSchema = z.object({
  printer_host: z.string().trim().max(120).optional().nullable(),
  printer_model: z.string().trim().max(120).optional().nullable(),
  printer_state: z.string().trim().max(64).optional().nullable(),
  printer_state_reasons: z.array(z.string().trim().max(120)).max(20).optional().default([]),
  ink_levels: z
    .array(
      z.object({
        name: z.string().trim().max(80),
        level: z.number().int().min(-1).max(100).nullable(),
        color: z.string().trim().max(32).optional().nullable(),
      }),
    )
    .max(12)
    .optional()
    .default([]),
  openwa_status: z
    .enum(['connected', 'qr_required', 'disconnected'])
    .optional()
    .default('disconnected'),
  openwa_qr_code: z.string().trim().max(2048).optional().nullable(),
  openwa_link_code: z.string().trim().max(32).optional().nullable(),
  capabilities: z.record(z.unknown()).optional(),
});

export const printAgentSyncSchema = printAgentHeartbeatSchema.extend({
  include_job: z.boolean().optional().default(true),
  include_outbox: z.boolean().optional().default(true),
  wa_connected: z.boolean().optional().default(false),
});

export const printAgentPresignUploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  content_type: z.string().trim().min(3).max(120),
  file_size_bytes: z.coerce.number().int().positive().max(26_214_400).optional(),
});

export const printAgentIngestJobSchema = z.object({
  wa_message_id: z.string().trim().min(1).max(180),
  wa_chat_id: z.string().trim().min(3).max(120),
  customer_name: z.string().trim().max(120).optional().nullable(),
  customer_phone: z.string().trim().max(64).optional().nullable(),
  customer_note: z.string().trim().max(500).optional().nullable(),
  file_name: z.string().trim().min(1).max(200),
  file_mime: z.string().trim().min(3).max(120),
  file_size_bytes: printBigIntNonNegative,
  file_object_key: z.string().trim().min(5).max(255),
  detected_page_count: z.number().int().positive().max(2000).optional().default(1),
});

export const createManualPrintJobSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  file_mime: z.string().trim().min(3).max(120),
  file_size_bytes: printBigIntNonNegative,
  file_object_key: z.string().trim().min(5).max(255),
  detected_page_count: z.number().int().positive().max(2000).optional().default(1),
  customer_name: z.string().trim().max(120).optional().nullable(),
  customer_phone: z.string().trim().max(64).optional().nullable(),
  customer_note: z.string().trim().max(500).optional().nullable(),
  paper_size: z.enum(PRINT_PAPER_SIZES).optional().default('a4'),
  color_mode: z.enum(PRINT_COLOR_MODES).optional().default('color'),
  quality: z.enum(PRINT_QUALITIES).optional().default('normal'),
  copies: z.number().int().min(1).max(99).optional().default(1),
  orientation: z.enum(PRINT_ORIENTATIONS).optional().default('auto'),
  fit: z.enum(PRINT_FITS).optional().default('contain'),
  borderless: z.boolean().optional().default(false),
  duplex: z.boolean().optional().default(false),
  page_range: pageRangeSchema,
  discount_amount: printBigIntNonNegative.optional().default(0n),
  auto_approve: z.boolean().optional().default(false),
  auto_post_finance: z.boolean().optional().default(false),
  finance_account_id: z.string().uuid().optional().nullable(),
  device_id: z.string().uuid().optional().nullable(),
  source: z.enum(['manual_web', 'manual_mobile']).optional().default('manual_web'),
});

export const updatePrintJobOptionsSchema = z.object({
  paper_size: z.enum(PRINT_PAPER_SIZES).optional(),
  color_mode: z.enum(PRINT_COLOR_MODES).optional(),
  quality: z.enum(PRINT_QUALITIES).optional(),
  copies: z.number().int().min(1).max(99).optional(),
  orientation: z.enum(PRINT_ORIENTATIONS).optional(),
  fit: z.enum(PRINT_FITS).optional(),
  borderless: z.boolean().optional(),
  duplex: z.boolean().optional(),
  page_range: pageRangeSchema,
  discount_amount: printBigIntNonNegative.optional(),
  detected_page_count: z.number().int().positive().max(2000).optional(),
});

export const approvePrintJobSchema = z.object({
  paper_size: z.enum(PRINT_PAPER_SIZES).optional(),
  color_mode: z.enum(PRINT_COLOR_MODES).optional(),
  quality: z.enum(PRINT_QUALITIES).optional(),
  copies: z.number().int().min(1).max(99).optional(),
  orientation: z.enum(PRINT_ORIENTATIONS).optional(),
  fit: z.enum(PRINT_FITS).optional(),
  borderless: z.boolean().optional(),
  duplex: z.boolean().optional(),
  page_range: pageRangeSchema,
  discount_amount: printBigIntNonNegative.optional(),
  device_id: z.string().uuid().optional().nullable(),
  auto_post_finance: z.boolean().optional().default(false),
  finance_account_id: z.string().uuid().optional().nullable(),
});

export const rejectPrintJobSchema = z.object({
  reason: z.string().trim().min(2).max(400),
});

export const postPrintJobFinanceSchema = z.object({
  finance_account_id: z.string().uuid(),
});

export const printAgentJobResultSchema = z.object({
  status: z.enum(['printed', 'failed']),
  ipp_job_id: z.number().int().nonnegative().optional().nullable(),
  error_message: z.string().trim().max(500).optional().nullable(),
  rendered_pages: z.number().int().positive().optional().nullable(),
  dry_run: z.boolean().optional().default(false),
});

export const upsertPrintPricingRuleSchema = z.object({
  paper_size: z.enum(PRINT_PAPER_SIZES),
  color_mode: z.enum(PRINT_COLOR_MODES),
  price_per_page: printBigIntNonNegative,
  duplex_discount_per_page: printBigIntNonNegative.optional().default(0n),
  is_active: z.boolean().optional().default(true),
});

export const printAgentOutboxAckSchema = z.object({
  status: z.enum(['sent', 'failed']),
  error_message: z.string().trim().max(500).optional().nullable(),
});
