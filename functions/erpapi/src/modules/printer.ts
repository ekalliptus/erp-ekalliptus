import crypto from 'node:crypto';
import {
  approvePrintJobSchema,
  createManualPrintJobSchema,
  createPrintDeviceSchema,
  hasPermission,
  postPrintJobFinanceSchema,
  printAgentHeartbeatSchema,
  printAgentIngestJobSchema,
  printAgentJobResultSchema,
  printAgentOutboxAckSchema,
  printAgentPresignUploadSchema,
  rejectPrintJobSchema,
  updatePrintJobOptionsSchema,
  upsertPrintPricingRuleSchema,
  type PlatformKind,
  type PrintColorMode,
  type PrintPaperSize,
  type PrintWaOutboxKind,
} from '@ekalliptus/contracts';
import {
  employees,
  finance_accounts,
  finance_categories,
  finance_transactions,
  print_devices,
  print_jobs,
  print_pricing_rules,
  print_wa_outbox,
  type FunctionDb,
} from '@ekalliptus/db';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Hono, type Context, type Next } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { emitErpEvent, writeAuditLog } from '../middleware/audit.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  formatRupiah,
  notifyUsersInTx,
  resolveModuleApprovers,
} from '../services/notify.js';
import { isSafePrintObjectKey } from '../services/security-policy.js';
import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  deleteObject,
} from '../services/storage.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_ONLINE_WINDOW_MS = 45_000;
const QR_FRESHNESS_WINDOW_MS = 90_000;
const MAX_PRINT_FILE_BYTES = 26_214_400n; // 25 MiB

const FALLBACK_PRICES: Record<string, bigint> = {
  'a4:mono': 500n,
  'a4:color': 1500n,
  'f4:mono': 600n,
  'f4:color': 1800n,
  'legal:mono': 600n,
  'legal:color': 1800n,
  'letter:mono': 500n,
  'letter:color': 1500n,
  'a5:mono': 400n,
  'a5:color': 1000n,
  '4x6:mono': 2000n,
  '4x6:color': 3500n,
  '5x7:mono': 3000n,
  '5x7:color': 5000n,
};

const ALLOWED_PRINT_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.pptx',
  '.ppt',
  '.odt',
  '.ods',
  '.odp',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
  '.svg',
]);

class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409;
  constructor(status: 400 | 401 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export function hashAgentToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function verifyAgentTokenHash(rawToken: string, storedHex: string): boolean {
  if (!rawToken || !storedHex) return false;
  const computedHex = hashAgentToken(rawToken);
  if (computedHex.length !== storedHex.length) return false;
  try {
    const a = Buffer.from(computedHex, 'hex');
    const b = Buffer.from(storedHex, 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function generatePrintJobCode(): string {
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWib.getUTCFullYear();
  const m = String(nowWib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(nowWib.getUTCDate()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PRT-${y}${m}${d}-${suffix}`;
}

export function parsePageRangeCount(
  pageRange: string | null | undefined,
  detectedPageCount: number,
): number {
  const totalPages = Math.max(1, Math.trunc(detectedPageCount));
  if (!pageRange || !pageRange.trim()) {
    return totalPages;
  }

  const uniquePages = new Set<number>();
  const parts = pageRange.split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start < 1 || end < start) {
        throw new Error(`Rentang halaman tidak valid: "${part}".`);
      }
      if (end > totalPages) {
        throw new Error(`Halaman ${end} melebihi total halaman dokumen (${totalPages}).`);
      }
      for (let i = start; i <= end; i += 1) {
        uniquePages.add(i);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      const page = Number.parseInt(part, 10);
      if (page < 1) {
        throw new Error(`Nomor halaman tidak valid: "${part}".`);
      }
      if (page > totalPages) {
        throw new Error(`Halaman ${page} melebihi total halaman dokumen (${totalPages}).`);
      }
      uniquePages.add(page);
      continue;
    }

    throw new Error(`Format rentang halaman tidak valid: "${part}".`);
  }

  if (uniquePages.size === 0) {
    throw new Error('Rentang halaman tidak memilih halaman mana pun.');
  }
  return uniquePages.size;
}

export function calculatePrintJobPricing(input: {
  pagesToPrint: number;
  copies: number;
  pricePerPage: bigint;
  duplex: boolean;
  duplexDiscountPerPage: bigint;
  discountAmount: bigint;
}): { unitPricePerPage: bigint; totalPrice: bigint } {
  const pages = BigInt(Math.max(1, Math.trunc(input.pagesToPrint)));
  const copies = BigInt(Math.max(1, Math.trunc(input.copies)));
  const effectiveUnit = input.duplex
    ? input.pricePerPage > input.duplexDiscountPerPage
      ? input.pricePerPage - input.duplexDiscountPerPage
      : 0n
    : input.pricePerPage;
  const gross = effectiveUnit * pages * copies;
  const discount = input.discountAmount >= 0n ? input.discountAmount : 0n;
  const totalPrice = gross > discount ? gross - discount : 0n;
  return {
    unitPricePerPage: effectiveUnit,
    totalPrice,
  };
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 96);
  return cleaned || 'document.pdf';
}

function hasAllowedPrintExtension(filename: string): boolean {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return ALLOWED_PRINT_EXTENSIONS.has(filename.slice(dotIdx).toLowerCase());
}

export function sanitizeDeviceForClient(
  row: typeof print_devices.$inferSelect,
  options?: { includePairing?: boolean },
) {
  const {
    agent_token_hash: _hash,
    openwa_qr_code,
    openwa_link_code,
    openwa_qr_updated_at,
    ...rest
  } = row;
  const lastHb = row.last_heartbeat_at ? row.last_heartbeat_at.getTime() : 0;
  const isOnline = Boolean(lastHb && Date.now() - lastHb <= HEARTBEAT_ONLINE_WINDOW_MS);
  const qrTs = openwa_qr_updated_at ? openwa_qr_updated_at.getTime() : 0;
  const exposePairing =
    Boolean(options?.includePairing) &&
    isOnline &&
    row.openwa_status === 'qr_required' &&
    Boolean(qrTs && Date.now() - qrTs <= QR_FRESHNESS_WINDOW_MS);

  return {
    ...(jsonSafe(rest) as Record<string, unknown>),
    is_online: isOnline,
    openwa_qr_code: exposePairing ? (openwa_qr_code ?? null) : null,
    openwa_link_code: exposePairing ? (openwa_link_code ?? null) : null,
    openwa_qr_updated_at:
      exposePairing && openwa_qr_updated_at ? openwa_qr_updated_at.toISOString() : null,
  };
}

function buildWaMessageText(
  kind: PrintWaOutboxKind,
  job: {
    job_code: string;
    file_name: string;
    pages_to_print: number;
    copies: number;
    paper_size: string;
    color_mode: string;
    total_price: bigint;
    reject_reason?: string | null;
    error_message?: string | null;
  },
): string {
  const sizeUpper = job.paper_size.toUpperCase();
  const colorLabel = job.color_mode === 'mono' ? 'Hitam Putih' : 'Warna';
  const totalText = formatRupiah(job.total_price);

  switch (kind) {
    case 'received':
      return (
        `Dokumen "${job.file_name}" diterima (Kode: ${job.job_code}). ` +
        `Menunggu persetujuan operator. Estimasi awal ${job.pages_to_print} hal ${sizeUpper} ${colorLabel}: ${totalText}.`
      );
    case 'approved':
      return (
        `Pesanan cetak ${job.job_code} disetujui. Sedang masuk antrean printer ` +
        `(${job.pages_to_print} hal x ${job.copies} salinan, ${sizeUpper}, ${colorLabel}). Total: ${totalText}.`
      );
    case 'printed':
      return `Cetak ${job.job_code} (${job.file_name}) selesai. Total tagihan: ${totalText}.`;
    case 'rejected':
      return `Permintaan cetak ${job.job_code} ditolak oleh operator. Alasan: ${job.reject_reason || 'Tidak memenuhi syarat cetak'}.`;
    case 'failed':
      return `Cetak ${job.job_code} gagal diproses printer (${job.error_message || 'Gangguan perangkat'}). Operator akan segera meninjau.`;
  }
}

type DbExecutor = Pick<FunctionDb, 'select' | 'insert' | 'update'>;

async function resolvePricingForSpec(
  executor: Pick<FunctionDb, 'select'>,
  paperSize: PrintPaperSize,
  colorMode: PrintColorMode,
): Promise<{ pricePerPage: bigint; duplexDiscountPerPage: bigint }> {
  const [rule] = await executor
    .select()
    .from(print_pricing_rules)
    .where(
      and(
        eq(print_pricing_rules.paper_size, paperSize),
        eq(print_pricing_rules.color_mode, colorMode),
        eq(print_pricing_rules.is_active, true),
      ),
    )
    .limit(1);

  if (rule) {
    return {
      pricePerPage: rule.price_per_page,
      duplexDiscountPerPage: rule.duplex_discount_per_page,
    };
  }

  return {
    pricePerPage: FALLBACK_PRICES[`${paperSize}:${colorMode}`] ?? 1500n,
    duplexDiscountPerPage: 0n,
  };
}

async function enqueueWaOutboxInTx(
  executor: Pick<FunctionDb, 'insert'>,
  params: {
    job: {
      id: string;
      job_code: string;
      device_id: string | null;
      wa_chat_id: string | null;
      file_name: string;
      pages_to_print: number;
      copies: number;
      paper_size: string;
      color_mode: string;
      total_price: bigint;
      reject_reason?: string | null;
      error_message?: string | null;
    };
    kind: PrintWaOutboxKind;
  },
): Promise<void> {
  if (!params.job.wa_chat_id) return;
  const messageText = buildWaMessageText(params.kind, params.job);
  await executor
    .insert(print_wa_outbox)
    .values({
      job_id: params.job.id,
      device_id: params.job.device_id,
      wa_chat_id: params.job.wa_chat_id,
      kind: params.kind,
      message_text: messageText,
      status: 'pending',
    })
    .onConflictDoNothing();
}

async function postPrintJobFinanceInTx(
  tx: DbExecutor,
  params: {
    jobId: string;
    accountId: string;
    actorId: string | null;
    platform: PlatformKind;
  },
) {
  const [job] = await tx
    .select()
    .from(print_jobs)
    .where(eq(print_jobs.id, params.jobId))
    .for('update');

  if (!job) {
    throw new HttpError(404, 'Print job tidak ditemukan.');
  }
  if (job.status !== 'printed') {
    throw new HttpError(
      400,
      `Hanya job berstatus selesai cetak (printed) yang bisa dicatat ke keuangan (status saat ini: ${job.status}).`,
    );
  }
  if (job.finance_transaction_id) {
    throw new HttpError(409, 'Print job ini sudah tercatat di transaksi keuangan.');
  }
  if (job.total_price <= 0n) {
    throw new HttpError(400, 'Total biaya cetak harus lebih besar dari Rp0 untuk dicatat ke kas.');
  }

  const [account] = await tx
    .select()
    .from(finance_accounts)
    .where(eq(finance_accounts.id, params.accountId))
    .for('update');

  if (!account) {
    throw new HttpError(404, 'Akun kas tujuan tidak ditemukan.');
  }
  if (!account.is_active) {
    throw new HttpError(400, `Akun kas "${account.name}" sedang nonaktif.`);
  }

  const [category] = await tx
    .select()
    .from(finance_categories)
    .where(
      and(
        eq(finance_categories.name, 'Jasa Cetak & Print'),
        eq(finance_categories.kind, 'income'),
      ),
    )
    .limit(1);

  const nextBalance = account.balance + job.total_price;
  await tx
    .update(finance_accounts)
    .set({ balance: nextBalance })
    .where(eq(finance_accounts.id, account.id));

  const createdByActor = params.actorId ?? job.approved_by ?? job.created_by;
  if (!createdByActor) {
    throw new HttpError(400, 'Actor pencatat transaksi keuangan tidak tersedia.');
  }

  const description = `Cetak ${job.job_code} - ${job.file_name} (${job.pages_to_print} hal x ${job.copies})`;
  const [finTx] = await tx
    .insert(finance_transactions)
    .values({
      account_id: account.id,
      category_id: category?.id ?? null,
      type: 'income',
      amount: job.total_price,
      description: description.slice(0, 480),
      reference_type: 'print_job',
      reference_id: job.id,
      status: 'posted',
      created_by: createdByActor,
      approved_by: job.approved_by ?? createdByActor,
    })
    .returning();

  const [updatedJob] = await tx
    .update(print_jobs)
    .set({
      finance_account_id: account.id,
      finance_transaction_id: finTx.id,
      finance_posted_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(print_jobs.id, job.id))
    .returning();

  await writeAuditLog(tx, {
    actorId: params.actorId,
    platform: params.platform,
    module: 'finance',
    action: 'post_print_income',
    entityId: finTx.id,
    beforeData: { account_id: account.id, balance: account.balance.toString() },
    afterData: {
      account_id: account.id,
      balance: nextBalance.toString(),
      amount: job.total_price.toString(),
      print_job_id: job.id,
      job_code: job.job_code,
    },
  });

  await writeAuditLog(tx, {
    actorId: params.actorId,
    platform: params.platform,
    module: 'printer',
    action: 'post_finance',
    entityId: job.id,
    beforeData: {
      finance_transaction_id: null,
      finance_account_id: job.finance_account_id,
    },
    afterData: {
      finance_transaction_id: finTx.id,
      finance_account_id: account.id,
      total_price: job.total_price.toString(),
    },
  });

  await emitErpEvent(tx, 'erp:finance', 'print_income_posted', {
    transaction_id: finTx.id,
    account_id: account.id,
    amount: job.total_price.toString(),
    print_job_id: job.id,
    job_code: job.job_code,
  });

  await emitErpEvent(tx, 'erp:printer', 'job_finance_posted', {
    job_id: job.id,
    job_code: job.job_code,
    finance_transaction_id: finTx.id,
    finance_account_id: account.id,
    total_price: job.total_price.toString(),
  });

  return { job: updatedJob, transaction: finTx, account_balance: nextBalance };
}

async function printAgentAuth(c: Context<AppEnv>, next: Next) {
  const token = (c.req.header('x-print-agent-token') ?? '').trim();
  if (token.length < 16) {
    return c.json({ error: 'Unauthorized: X-Print-Agent-Token tidak valid.' }, 401);
  }

  const tokenHash = hashAgentToken(token);
  const [device] = await getDb()
    .select()
    .from(print_devices)
    .where(and(eq(print_devices.agent_token_hash, tokenHash), eq(print_devices.is_active, true)))
    .limit(1);

  if (!device || !verifyAgentTokenHash(token, device.agent_token_hash)) {
    return c.json({ error: 'Unauthorized: token print bridge ditolak atau nonaktif.' }, 401);
  }

  c.set('printDevice', device);
  await next();
}

// ---------------------------------------------------------------------------
// Authenticated ERP Router: /api/print/*
// ---------------------------------------------------------------------------
const printerRouter = new Hono<AppEnv>();

printerRouter.get('/devices', requirePermission('printer', 'view'), async (c) => {
  const auth = c.get('auth');
  const includePairing =
    auth.platform === 'web' &&
    (hasPermission(auth.permissions, 'printer', 'create') ||
      hasPermission(auth.permissions, 'printer', 'update'));
  const rows = await getDb()
    .select()
    .from(print_devices)
    .orderBy(desc(print_devices.created_at));
  return c.json({
    devices: rows.map((row) => sanitizeDeviceForClient(row, { includePairing })),
  });
});

printerRouter.post('/devices', requirePermission('printer', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPrintDeviceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const rawToken = `ekp_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashAgentToken(rawToken);

  const created = await getDb().transaction(async (tx) => {
    const [device] = await tx
      .insert(print_devices)
      .values({
        device_name: parsed.data.device_name,
        host: parsed.data.host ?? null,
        mdns_host: parsed.data.mdns_host ?? null,
        model: parsed.data.model ?? 'HP Smart Tank 580-590 series',
        agent_token_hash: tokenHash,
        created_by: auth.employee.id,
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'printer',
      action: 'register_device',
      entityId: device.id,
      afterData: {
        device_name: device.device_name,
        host: device.host,
        mdns_host: device.mdns_host,
        model: device.model,
      },
    });

    await emitErpEvent(tx, 'erp:printer', 'device_registered', {
      device_id: device.id,
      device_name: device.device_name,
    });

    return device;
  });

  return c.json(
    {
      device: sanitizeDeviceForClient(created),
      agent_token: rawToken,
    },
    201,
  );
});

printerRouter.post('/devices/:id/rotate-token', requirePermission('printer', 'update'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID perangkat printer tidak valid.' }, 400);

  const auth = c.get('auth');
  const rawToken = `ekp_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashAgentToken(rawToken);

  const updated = await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(print_devices)
      .where(eq(print_devices.id, id))
      .limit(1);
    if (!existing) return null;

    const [device] = await tx
      .update(print_devices)
      .set({
        agent_token_hash: tokenHash,
        is_active: true,
        updated_at: new Date(),
      })
      .where(eq(print_devices.id, id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'printer',
      action: 'rotate_device_token',
      entityId: id,
      afterData: { device_name: device.device_name, rotated: true },
    });

    await emitErpEvent(tx, 'erp:printer', 'device_token_rotated', {
      device_id: id,
    });

    return device;
  });

  if (!updated) return c.json({ error: 'Perangkat printer tidak ditemukan.' }, 404);
  return c.json({
    device: sanitizeDeviceForClient(updated),
    agent_token: rawToken,
  });
});

printerRouter.get('/pricing', requirePermission('printer', 'view'), async (c) => {
  const rules = await getDb()
    .select()
    .from(print_pricing_rules)
    .orderBy(asc(print_pricing_rules.paper_size), asc(print_pricing_rules.color_mode));
  return c.json({ pricing_rules: jsonSafe(rules) });
});

printerRouter.put('/pricing', requirePermission('printer', 'update'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPrintPricingRuleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const rule = await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(print_pricing_rules)
      .where(
        and(
          eq(print_pricing_rules.paper_size, parsed.data.paper_size),
          eq(print_pricing_rules.color_mode, parsed.data.color_mode),
        ),
      )
      .limit(1);

    const [saved] = await tx
      .insert(print_pricing_rules)
      .values({
        paper_size: parsed.data.paper_size,
        color_mode: parsed.data.color_mode,
        price_per_page: parsed.data.price_per_page,
        duplex_discount_per_page: parsed.data.duplex_discount_per_page,
        is_active: parsed.data.is_active,
        currency: 'IDR',
        updated_by: auth.employee.id,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [print_pricing_rules.paper_size, print_pricing_rules.color_mode],
        set: {
          price_per_page: parsed.data.price_per_page,
          duplex_discount_per_page: parsed.data.duplex_discount_per_page,
          is_active: parsed.data.is_active,
          updated_by: auth.employee.id,
          updated_at: new Date(),
        },
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'printer',
      action: 'update_pricing_rule',
      entityId: saved.id,
      beforeData: before ?? null,
      afterData: saved,
    });

    await emitErpEvent(tx, 'erp:printer', 'pricing_updated', {
      paper_size: saved.paper_size,
      color_mode: saved.color_mode,
      price_per_page: saved.price_per_page.toString(),
    });

    return saved;
  });

  return c.json({ pricing_rule: jsonSafe(rule) });
});

printerRouter.get('/jobs', requirePermission('printer', 'view'), async (c) => {
  const statusParam = (c.req.query('status') ?? '').trim().toLowerCase();
  const sourceParam = (c.req.query('source') ?? '').trim().toLowerCase();
  const qParam = (c.req.query('q') ?? '').trim();
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const conditions = [];
  if (statusParam && statusParam !== 'all') {
    if (statusParam === 'active') {
      conditions.push(inArray(print_jobs.status, ['pending_approval', 'queued', 'printing']));
    } else if (statusParam === 'in_progress') {
      conditions.push(inArray(print_jobs.status, ['queued', 'printing']));
    } else {
      conditions.push(eq(print_jobs.status, statusParam));
    }
  }
  if (sourceParam && sourceParam !== 'all') {
    conditions.push(eq(print_jobs.source, sourceParam));
  }
  if (qParam) {
    const pattern = `%${qParam}%`;
    conditions.push(
      or(
        ilike(print_jobs.job_code, pattern),
        ilike(print_jobs.file_name, pattern),
        ilike(print_jobs.customer_name, pattern),
        ilike(print_jobs.customer_phone, pattern),
      )!,
    );
  }

  const db = getDb();
  const [rows, summaryRows] = await Promise.all([
    db
      .select()
      .from(print_jobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(print_jobs.created_at))
      .limit(limit),
    db
      .select({
        pending_approval: sql<number>`count(*) filter (where ${print_jobs.status} = 'pending_approval')::int`,
        queued: sql<number>`count(*) filter (where ${print_jobs.status} = 'queued')::int`,
        printing: sql<number>`count(*) filter (where ${print_jobs.status} = 'printing')::int`,
        printed_today: sql<number>`count(*) filter (
          where ${print_jobs.status} = 'printed'
            and (${print_jobs.printed_at} AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date
        )::int`,
        revenue_today: sql<string>`coalesce(sum(${print_jobs.total_price}) filter (
          where ${print_jobs.status} = 'printed'
            and (${print_jobs.printed_at} AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date
        ), 0)::text`,
      })
      .from(print_jobs),
  ]);

  const summary = summaryRows[0] ?? {
    pending_approval: 0,
    queued: 0,
    printing: 0,
    printed_today: 0,
    revenue_today: '0',
  };

  return c.json({
    jobs: jsonSafe(rows),
    summary,
  });
});

printerRouter.get('/jobs/:id', requirePermission('printer', 'view'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const [job] = await getDb()
    .select()
    .from(print_jobs)
    .where(eq(print_jobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: 'Print job tidak ditemukan.' }, 404);

  let downloadUrl: string | null = null;
  if (!job.file_deleted_at && isSafePrintObjectKey(job.file_object_key)) {
    try {
      downloadUrl = await createPresignedDownloadUrl({
        key: job.file_object_key,
        expiresIn: 600,
        contentType: job.file_mime || undefined,
      });
    } catch {
      downloadUrl = null;
    }
  }

  return c.json({
    job: jsonSafe(job),
    download_url: downloadUrl,
  });
});

printerRouter.post('/jobs/manual', requirePermission('printer', 'create'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createManualPrintJobSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const data = parsed.data;
  if (!isSafePrintObjectKey(data.file_object_key)) {
    return c.json({ error: 'file_object_key harus berada di prefix print-jobs/.' }, 400);
  }
  if (data.file_size_bytes > MAX_PRINT_FILE_BYTES) {
    return c.json({ error: 'Ukuran file maksimal 25 MB.' }, 400);
  }

  const auth = c.get('auth');
  const canApprove = hasPermission(auth.permissions, 'printer', 'approve');
  const autoApproved = Boolean(data.auto_approve && canApprove);

  let pagesToPrint: number;
  try {
    pagesToPrint = parsePageRangeCount(data.page_range, data.detected_page_count);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Rentang halaman tidak valid.' }, 400);
  }

  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const pricingRule = await resolvePricingForSpec(tx, data.paper_size, data.color_mode);
    const pricing = calculatePrintJobPricing({
      pagesToPrint,
      copies: data.copies,
      pricePerPage: pricingRule.pricePerPage,
      duplex: data.duplex,
      duplexDiscountPerPage: pricingRule.duplexDiscountPerPage,
      discountAmount: data.discount_amount,
    });

    const jobCode = generatePrintJobCode();
    const [job] = await tx
      .insert(print_jobs)
      .values({
        job_code: jobCode,
        source: data.source,
        device_id: data.device_id ?? null,
        customer_name: data.customer_name ?? auth.employee.full_name,
        customer_phone: data.customer_phone ?? null,
        customer_note: data.customer_note ?? null,
        file_name: data.file_name,
        file_mime: data.file_mime,
        file_size_bytes: data.file_size_bytes,
        file_object_key: data.file_object_key,
        detected_page_count: data.detected_page_count,
        paper_size: data.paper_size,
        color_mode: data.color_mode,
        quality: data.quality,
        copies: data.copies,
        orientation: data.orientation,
        fit: data.fit,
        borderless: data.borderless,
        duplex: data.duplex,
        page_range: data.page_range ?? null,
        pages_to_print: pagesToPrint,
        unit_price_per_page: pricing.unitPricePerPage,
        discount_amount: data.discount_amount,
        total_price: pricing.totalPrice,
        status: autoApproved ? 'queued' : 'pending_approval',
        finance_account_id:
          autoApproved && data.auto_post_finance ? (data.finance_account_id ?? null) : null,
        approved_by: autoApproved ? auth.employee.id : null,
        approved_at: autoApproved ? new Date() : null,
        created_by: auth.employee.id,
      })
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'printer',
      action: 'create_manual_print_job',
      entityId: job.id,
      afterData: job,
    });

    await emitErpEvent(tx, 'erp:printer', 'job_created', {
      job_id: job.id,
      job_code: job.job_code,
      status: job.status,
      source: job.source,
    });

    if (!autoApproved) {
      const approvers = await resolveModuleApprovers(tx, 'printer');
      await notifyUsersInTx(tx, {
        module: 'printer',
        eventType: 'print_job_pending',
        title: `Permintaan Print Baru: ${job.job_code}`,
        body: `${job.file_name} (${job.pages_to_print} hal, ${formatRupiah(job.total_price)}) menunggu persetujuan.`,
        recipients: approvers,
        excludeAuthUserId: auth.authUserId,
        actorEmployeeId: auth.employee.id,
        entityId: job.id,
        payload: { job_id: job.id, job_code: job.job_code },
      });
    }

    return job;
  });

  return c.json({ job: jsonSafe(created) }, 201);
});

printerRouter.patch('/jobs/:id/options', requirePermission('printer', 'update'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = updatePrintJobOptionsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;

  try {
    const updated = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(print_jobs)
        .where(eq(print_jobs.id, id))
        .for('update');
      if (!existing) throw new HttpError(404, 'Print job tidak ditemukan.');
      if (existing.status !== 'pending_approval') {
        throw new HttpError(
          400,
          'Opsi cetak hanya bisa diubah saat status menunggu persetujuan (pending_approval).',
        );
      }

      const paperSize = (data.paper_size ?? existing.paper_size) as PrintPaperSize;
      const colorMode = (data.color_mode ?? existing.color_mode) as PrintColorMode;
      const quality = data.quality ?? existing.quality;
      const copies = data.copies ?? existing.copies;
      const orientation = data.orientation ?? existing.orientation;
      const fit = data.fit ?? existing.fit;
      const borderless = data.borderless ?? existing.borderless;
      const duplex = data.duplex ?? existing.duplex;
      const pageRange = data.page_range !== undefined ? data.page_range : existing.page_range;
      const discountAmount = data.discount_amount ?? existing.discount_amount;
      const detectedPages = data.detected_page_count ?? existing.detected_page_count;

      let pagesToPrint: number;
      try {
        pagesToPrint = parsePageRangeCount(pageRange, detectedPages);
      } catch (err) {
        throw new HttpError(
          400,
          err instanceof Error ? err.message : 'Rentang halaman tidak valid.',
        );
      }

      const rule = await resolvePricingForSpec(tx, paperSize, colorMode);
      const pricing = calculatePrintJobPricing({
        pagesToPrint,
        copies,
        pricePerPage: rule.pricePerPage,
        duplex,
        duplexDiscountPerPage: rule.duplexDiscountPerPage,
        discountAmount,
      });

      const [row] = await tx
        .update(print_jobs)
        .set({
          detected_page_count: detectedPages,
          paper_size: paperSize,
          color_mode: colorMode,
          quality,
          copies,
          orientation,
          fit,
          borderless,
          duplex,
          page_range: pageRange ?? null,
          pages_to_print: pagesToPrint,
          unit_price_per_page: pricing.unitPricePerPage,
          discount_amount: discountAmount,
          total_price: pricing.totalPrice,
          updated_at: new Date(),
        })
        .where(eq(print_jobs.id, id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'printer',
        action: 'update_job_options',
        entityId: id,
        beforeData: existing,
        afterData: row,
      });

      await emitErpEvent(tx, 'erp:printer', 'job_options_updated', {
        job_id: row.id,
        job_code: row.job_code,
        total_price: row.total_price.toString(),
      });

      return row;
    });

    return c.json({ job: jsonSafe(updated) });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

printerRouter.post('/jobs/:id/approve', requirePermission('printer', 'approve'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = approvePrintJobSchema.safeParse(rawBody ?? {});
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const data = parsed.data;

  try {
    const approved = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(print_jobs)
        .where(eq(print_jobs.id, id))
        .for('update');
      if (!existing) throw new HttpError(404, 'Print job tidak ditemukan.');
      if (existing.status !== 'pending_approval') {
        throw new HttpError(
          400,
          `Job ${existing.job_code} tidak dalam status pending_approval (saat ini: ${existing.status}).`,
        );
      }

      if (data.finance_account_id) {
        const [acc] = await tx
          .select({ id: finance_accounts.id, is_active: finance_accounts.is_active })
          .from(finance_accounts)
          .where(eq(finance_accounts.id, data.finance_account_id))
          .limit(1);
        if (!acc || !acc.is_active) {
          throw new HttpError(400, 'Akun kas tujuan tidak ditemukan atau nonaktif.');
        }
      }

      const paperSize = (data.paper_size ?? existing.paper_size) as PrintPaperSize;
      const colorMode = (data.color_mode ?? existing.color_mode) as PrintColorMode;
      const quality = data.quality ?? existing.quality;
      const copies = data.copies ?? existing.copies;
      const orientation = data.orientation ?? existing.orientation;
      const fit = data.fit ?? existing.fit;
      const borderless = data.borderless ?? existing.borderless;
      const duplex = data.duplex ?? existing.duplex;
      const pageRange = data.page_range !== undefined ? data.page_range : existing.page_range;
      const discountAmount = data.discount_amount ?? existing.discount_amount;

      let pagesToPrint: number;
      try {
        pagesToPrint = parsePageRangeCount(pageRange, existing.detected_page_count);
      } catch (err) {
        throw new HttpError(
          400,
          err instanceof Error ? err.message : 'Rentang halaman tidak valid.',
        );
      }

      const rule = await resolvePricingForSpec(tx, paperSize, colorMode);
      const pricing = calculatePrintJobPricing({
        pagesToPrint,
        copies,
        pricePerPage: rule.pricePerPage,
        duplex,
        duplexDiscountPerPage: rule.duplexDiscountPerPage,
        discountAmount,
      });

      const [row] = await tx
        .update(print_jobs)
        .set({
          device_id: data.device_id !== undefined ? data.device_id : existing.device_id,
          paper_size: paperSize,
          color_mode: colorMode,
          quality,
          copies,
          orientation,
          fit,
          borderless,
          duplex,
          page_range: pageRange ?? null,
          pages_to_print: pagesToPrint,
          unit_price_per_page: pricing.unitPricePerPage,
          discount_amount: discountAmount,
          total_price: pricing.totalPrice,
          status: 'queued',
          approved_by: auth.employee.id,
          approved_at: new Date(),
          finance_account_id:
            data.auto_post_finance && data.finance_account_id
              ? data.finance_account_id
              : existing.finance_account_id,
          error_message: null,
          reject_reason: null,
          updated_at: new Date(),
        })
        .where(eq(print_jobs.id, id))
        .returning();

      await enqueueWaOutboxInTx(tx, { job: row, kind: 'approved' });

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'printer',
        action: 'approve_job',
        entityId: id,
        beforeData: { status: existing.status },
        afterData: {
          status: row.status,
          total_price: row.total_price.toString(),
          auto_post_finance: Boolean(data.auto_post_finance && data.finance_account_id),
        },
      });

      await emitErpEvent(tx, 'erp:printer', 'job_approved', {
        job_id: row.id,
        job_code: row.job_code,
        status: row.status,
      });

      return row;
    });

    return c.json({ job: jsonSafe(approved) });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

printerRouter.post('/jobs/:id/reject', requirePermission('printer', 'approve'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = rejectPrintJobSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  let objectKeyToDelete: string | null = null;

  try {
    const rejected = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(print_jobs)
        .where(eq(print_jobs.id, id))
        .for('update');
      if (!existing) throw new HttpError(404, 'Print job tidak ditemukan.');
      if (existing.status !== 'pending_approval' && existing.status !== 'queued') {
        throw new HttpError(
          400,
          `Job ${existing.job_code} tidak dapat ditolak dari status ${existing.status}.`,
        );
      }

      if (!existing.file_deleted_at && isSafePrintObjectKey(existing.file_object_key)) {
        objectKeyToDelete = existing.file_object_key;
      }

      const [row] = await tx
        .update(print_jobs)
        .set({
          status: 'rejected',
          reject_reason: parsed.data.reason,
          file_deleted_at: objectKeyToDelete ? new Date() : existing.file_deleted_at,
          updated_at: new Date(),
        })
        .where(eq(print_jobs.id, id))
        .returning();

      await enqueueWaOutboxInTx(tx, { job: row, kind: 'rejected' });

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'printer',
        action: 'reject_job',
        entityId: id,
        beforeData: { status: existing.status },
        afterData: { status: row.status, reject_reason: row.reject_reason },
      });

      await emitErpEvent(tx, 'erp:printer', 'job_rejected', {
        job_id: row.id,
        job_code: row.job_code,
      });

      return row;
    });

    if (objectKeyToDelete) {
      await deleteObject(objectKeyToDelete).catch(() => {});
    }

    return c.json({ job: jsonSafe(rejected) });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

printerRouter.post('/jobs/:id/reprint', requirePermission('printer', 'approve'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const auth = c.get('auth');

  try {
    const reprinted = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(print_jobs)
        .where(eq(print_jobs.id, id))
        .for('update');
      if (!existing) throw new HttpError(404, 'Print job tidak ditemukan.');
      if (existing.status !== 'printed' && existing.status !== 'failed') {
        throw new HttpError(
          400,
          'Hanya job yang sudah printed atau failed yang dapat dicetak ulang.',
        );
      }
      if (existing.file_deleted_at) {
        throw new HttpError(400, 'File dokumen sudah dihapus sehingga tidak bisa dicetak ulang.');
      }

      const [row] = await tx
        .update(print_jobs)
        .set({
          status: 'queued',
          error_message: null,
          updated_at: new Date(),
        })
        .where(eq(print_jobs.id, id))
        .returning();

      await writeAuditLog(tx, {
        actorId: auth.employee.id,
        platform: auth.platform,
        module: 'printer',
        action: 'reprint_job',
        entityId: id,
        beforeData: { status: existing.status },
        afterData: { status: row.status },
      });

      await emitErpEvent(tx, 'erp:printer', 'job_requeued', {
        job_id: row.id,
        job_code: row.job_code,
      });

      return row;
    });

    return c.json({ job: jsonSafe(reprinted) });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

printerRouter.post('/jobs/:id/post-finance', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const auth = c.get('auth');
  const canPost =
    hasPermission(auth.permissions, 'finance', 'create') ||
    hasPermission(auth.permissions, 'printer', 'approve');
  if (!canPost) {
    return c.json(
      { error: 'Forbidden: memerlukan izin finance:create atau printer:approve.' },
      403,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = postPrintJobFinanceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    const result = await getDb().transaction((tx) =>
      postPrintJobFinanceInTx(tx, {
        jobId: id,
        accountId: parsed.data.finance_account_id,
        actorId: auth.employee.id,
        platform: auth.platform,
      }),
    );

    return c.json({
      job: jsonSafe(result.job),
      finance_transaction: jsonSafe(result.transaction),
      account_balance: result.account_balance.toString(),
    });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

printerRouter.delete('/jobs/:id/file', requirePermission('printer', 'delete'), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const auth = c.get('auth');
  const [existing] = await getDb()
    .select()
    .from(print_jobs)
    .where(eq(print_jobs.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'Print job tidak ditemukan.' }, 404);

  if (!existing.file_deleted_at && isSafePrintObjectKey(existing.file_object_key)) {
    await deleteObject(existing.file_object_key).catch(() => {});
  }

  const [updated] = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(print_jobs)
      .set({
        file_deleted_at: existing.file_deleted_at ?? new Date(),
        updated_at: new Date(),
      })
      .where(eq(print_jobs.id, id))
      .returning();

    await writeAuditLog(tx, {
      actorId: auth.employee.id,
      platform: auth.platform,
      module: 'printer',
      action: 'delete_job_file',
      entityId: id,
      afterData: { file_object_key: existing.file_object_key, deleted: true },
    });

    await emitErpEvent(tx, 'erp:printer', 'job_file_deleted', {
      job_id: id,
      job_code: existing.job_code,
    });

    return [row];
  });

  return c.json({ job: jsonSafe(updated) });
});

// ---------------------------------------------------------------------------
// Authenticated Bridge Agent Router: /api/print-agent/*
// ---------------------------------------------------------------------------
const agentRouter = new Hono<AppEnv>();
agentRouter.use('*', printAgentAuth);

agentRouter.post('/heartbeat', async (c) => {
  const device = c.get('printDevice')!;
  const body = await c.req.json().catch(() => null);
  const parsed = printAgentHeartbeatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const d = parsed.data;
  const now = new Date();
  const isQrRequired = d.openwa_status === 'qr_required';
  const nextQrCode = isQrRequired
    ? d.openwa_qr_code !== undefined
      ? d.openwa_qr_code || null
      : device.openwa_qr_code
    : null;
  const nextLinkCode = isQrRequired
    ? d.openwa_link_code !== undefined
      ? d.openwa_link_code || null
      : device.openwa_link_code
    : null;
  const nextQrUpdatedAt = isQrRequired && (nextQrCode || nextLinkCode) ? now : null;

  const [updated] = await getDb()
    .update(print_devices)
    .set({
      host: d.printer_host !== undefined ? d.printer_host : device.host,
      model: d.printer_model || device.model,
      printer_state: d.printer_state || 'unknown',
      printer_state_reasons: d.printer_state_reasons ?? [],
      ink_levels: d.ink_levels ?? [],
      openwa_status: d.openwa_status,
      openwa_qr_code: nextQrCode,
      openwa_link_code: nextLinkCode,
      openwa_qr_updated_at: nextQrUpdatedAt,
      capabilities: d.capabilities ?? device.capabilities,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .where(eq(print_devices.id, device.id))
    .returning();

  await emitErpEvent(getDb(), 'erp:printer', 'device_heartbeat', {
    device_id: updated.id,
    printer_state: updated.printer_state,
    openwa_status: updated.openwa_status,
    has_qr: Boolean(updated.openwa_qr_code),
  });

  return c.json({
    ok: true,
    device: sanitizeDeviceForClient(updated),
    server_time: now.toISOString(),
  });
});

agentRouter.post('/jobs/presign-upload', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = printAgentPresignUploadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { filename, content_type } = parsed.data;
  if (!hasAllowedPrintExtension(filename) && !content_type.startsWith('image/') && content_type !== 'application/pdf') {
    return c.json({ error: `Ekstensi atau tipe file "${filename}" tidak didukung untuk cetak.` }, 400);
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeName = sanitizeFilename(filename);
  const objectKey = `print-jobs/${yyyy}/${mm}/${crypto.randomUUID()}-${safeName}`;

  const uploadUrl = await createPresignedUploadUrl({
    key: objectKey,
    contentType: content_type,
    expiresIn: 900,
  });

  return c.json({
    object_key: objectKey,
    upload_url: uploadUrl,
    expires_in: 900,
  });
});

agentRouter.post('/jobs/ingest', async (c) => {
  const device = c.get('printDevice')!;
  const body = await c.req.json().catch(() => null);
  const parsed = printAgentIngestJobSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const data = parsed.data;
  if (!isSafePrintObjectKey(data.file_object_key)) {
    return c.json({ error: 'file_object_key tidak valid.' }, 400);
  }
  if (data.file_size_bytes > MAX_PRINT_FILE_BYTES) {
    return c.json({ error: 'Ukuran file melebihi batas 25 MB.' }, 400);
  }

  const db = getDb();
  const [existingDup] = await db
    .select()
    .from(print_jobs)
    .where(eq(print_jobs.wa_message_id, data.wa_message_id))
    .limit(1);
  if (existingDup) {
    return c.json({ job: jsonSafe(existingDup), deduplicated: true });
  }

  const result = await db.transaction(async (tx) => {
    const [dupInTx] = await tx
      .select()
      .from(print_jobs)
      .where(eq(print_jobs.wa_message_id, data.wa_message_id))
      .limit(1);
    if (dupInTx) {
      return { job: dupInTx, deduplicated: true };
    }

    const paperSize: PrintPaperSize = 'a4';
    const colorMode: PrintColorMode = 'color';
    const pagesToPrint = Math.max(1, data.detected_page_count);
    const rule = await resolvePricingForSpec(tx, paperSize, colorMode);
    const pricing = calculatePrintJobPricing({
      pagesToPrint,
      copies: 1,
      pricePerPage: rule.pricePerPage,
      duplex: false,
      duplexDiscountPerPage: rule.duplexDiscountPerPage,
      discountAmount: 0n,
    });

    const jobCode = generatePrintJobCode();
    const [inserted] = await tx
      .insert(print_jobs)
      .values({
        job_code: jobCode,
        source: 'whatsapp',
        device_id: device.id,
        wa_message_id: data.wa_message_id,
        wa_chat_id: data.wa_chat_id,
        customer_name: data.customer_name ?? null,
        customer_phone: data.customer_phone ?? null,
        customer_note: data.customer_note ?? null,
        file_name: data.file_name,
        file_mime: data.file_mime,
        file_size_bytes: data.file_size_bytes,
        file_object_key: data.file_object_key,
        detected_page_count: pagesToPrint,
        paper_size: paperSize,
        color_mode: colorMode,
        quality: 'normal',
        copies: 1,
        orientation: 'auto',
        fit: 'contain',
        borderless: false,
        duplex: false,
        pages_to_print: pagesToPrint,
        unit_price_per_page: pricing.unitPricePerPage,
        discount_amount: 0n,
        total_price: pricing.totalPrice,
        status: 'pending_approval',
      })
      .returning();

    await enqueueWaOutboxInTx(tx, { job: inserted, kind: 'received' });

    await writeAuditLog(tx, {
      actorId: null,
      platform: 'system',
      module: 'printer',
      action: 'ingest_whatsapp_job',
      entityId: inserted.id,
      afterData: {
        job_code: inserted.job_code,
        device_id: device.id,
        file_name: inserted.file_name,
        pages: inserted.pages_to_print,
        total_price: inserted.total_price.toString(),
      },
    });

    await emitErpEvent(tx, 'erp:printer', 'job_ingested', {
      job_id: inserted.id,
      job_code: inserted.job_code,
      source: 'whatsapp',
      customer_name: inserted.customer_name,
    });

    const approvers = await resolveModuleApprovers(tx, 'printer');
    await notifyUsersInTx(tx, {
      module: 'printer',
      eventType: 'print_job_received',
      title: `Dokumen Print Baru via WA: ${inserted.job_code}`,
      body: `${inserted.customer_name || inserted.customer_phone || 'Pelanggan'} mengirim "${inserted.file_name}" (${inserted.pages_to_print} hal, ${formatRupiah(inserted.total_price)}).`,
      recipients: approvers,
      actorEmployeeId: null,
      entityId: inserted.id,
      payload: {
        job_id: inserted.id,
        job_code: inserted.job_code,
      },
    });

    return { job: inserted, deduplicated: false };
  });

  return c.json(
    { job: jsonSafe(result.job), deduplicated: result.deduplicated },
    result.deduplicated ? 200 : 201,
  );
});

agentRouter.post('/jobs/claim-next', async (c) => {
  const device = c.get('printDevice')!;
  const db = getDb();

  const claimed = await db.transaction(async (tx) => {
    const [nextJob] = await tx
      .select()
      .from(print_jobs)
      .where(
        and(
          eq(print_jobs.status, 'queued'),
          or(eq(print_jobs.device_id, device.id), isNull(print_jobs.device_id)),
        ),
      )
      .orderBy(asc(print_jobs.created_at))
      .limit(1)
      .for('update', { skipLocked: true });

    if (!nextJob) return null;

    const [updated] = await tx
      .update(print_jobs)
      .set({
        status: 'printing',
        device_id: device.id,
        updated_at: new Date(),
      })
      .where(eq(print_jobs.id, nextJob.id))
      .returning();

    await writeAuditLog(tx, {
      actorId: null,
      platform: 'system',
      module: 'printer',
      action: 'claim_job',
      entityId: updated.id,
      beforeData: { status: 'queued' },
      afterData: { status: 'printing', device_id: device.id },
    });

    await emitErpEvent(tx, 'erp:printer', 'job_claimed', {
      job_id: updated.id,
      job_code: updated.job_code,
      device_id: device.id,
    });

    return updated;
  });

  if (!claimed) {
    return c.json({ job: null, download_url: null });
  }

  const downloadUrl = await createPresignedDownloadUrl({
    key: claimed.file_object_key,
    expiresIn: 600,
    contentType: claimed.file_mime || undefined,
  });

  return c.json({
    job: jsonSafe(claimed),
    download_url: downloadUrl,
  });
});

agentRouter.post('/jobs/:id/result', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID print job tidak valid.' }, 400);

  const device = c.get('printDevice')!;
  const body = await c.req.json().catch(() => null);
  const parsed = printAgentJobResultSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const data = parsed.data;
  try {
    const outcome = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(print_jobs)
        .where(eq(print_jobs.id, id))
        .for('update');
      if (!existing) throw new HttpError(404, 'Print job tidak ditemukan.');
      if (existing.device_id && existing.device_id !== device.id) {
        throw new HttpError(403, 'Print job sedang dipegang oleh perangkat bridge lain.');
      }

      const isPrinted = data.status === 'printed';
      const [updated] = await tx
        .update(print_jobs)
        .set({
          status: data.status,
          device_id: existing.device_id ?? device.id,
          ipp_job_id: data.ipp_job_id !== undefined ? data.ipp_job_id : existing.ipp_job_id,
          error_message: isPrinted
            ? null
            : data.error_message || 'Printer menolak atau gagal memproses job.',
          printed_at: isPrinted ? new Date() : existing.printed_at,
          updated_at: new Date(),
        })
        .where(eq(print_jobs.id, id))
        .returning();

      let finalJob = updated;
      let postedTx: typeof finance_transactions.$inferSelect | null = null;
      if (
        isPrinted &&
        updated.finance_account_id &&
        !updated.finance_transaction_id &&
        updated.total_price > 0n
      ) {
        const finRes = await postPrintJobFinanceInTx(tx, {
          jobId: updated.id,
          accountId: updated.finance_account_id,
          actorId: updated.approved_by ?? updated.created_by ?? null,
          platform: 'system',
        });
        finalJob = finRes.job;
        postedTx = finRes.transaction;
      }

      await enqueueWaOutboxInTx(tx, {
        job: finalJob,
        kind: isPrinted ? 'printed' : 'failed',
      });

      await writeAuditLog(tx, {
        actorId: null,
        platform: 'system',
        module: 'printer',
        action: isPrinted ? 'complete_job_printed' : 'complete_job_failed',
        entityId: finalJob.id,
        beforeData: { status: existing.status },
        afterData: {
          status: finalJob.status,
          ipp_job_id: finalJob.ipp_job_id,
          dry_run: data.dry_run,
          error_message: finalJob.error_message,
          finance_transaction_id: finalJob.finance_transaction_id,
        },
      });

      await emitErpEvent(tx, 'erp:printer', isPrinted ? 'job_printed' : 'job_failed', {
        job_id: finalJob.id,
        job_code: finalJob.job_code,
        status: finalJob.status,
        total_price: finalJob.total_price.toString(),
      });

      if (finalJob.approved_by) {
        const [approverEmp] = await tx
          .select({ auth_user_id: employees.auth_user_id })
          .from(employees)
          .where(eq(employees.id, finalJob.approved_by))
          .limit(1);
        if (approverEmp?.auth_user_id) {
          await notifyUsersInTx(tx, {
            module: 'printer',
            eventType: isPrinted ? 'print_job_printed' : 'print_job_failed',
            title: isPrinted
              ? `Cetak Selesai: ${finalJob.job_code}`
              : `Cetak Gagal: ${finalJob.job_code}`,
            body: isPrinted
              ? `${finalJob.file_name} selesai dicetak (${finalJob.pages_to_print} hal x ${finalJob.copies}).`
              : `${finalJob.file_name} gagal: ${finalJob.error_message || 'Cek printer Wi-Fi'}.`,
            recipients: [approverEmp.auth_user_id],
            actorEmployeeId: null,
            entityId: finalJob.id,
            payload: { job_id: finalJob.id, job_code: finalJob.job_code },
          });
        }
      }

      return { job: finalJob, finance_transaction: postedTx };
    });

    return c.json({
      job: jsonSafe(outcome.job),
      finance_transaction: outcome.finance_transaction ? jsonSafe(outcome.finance_transaction) : null,
    });
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

agentRouter.get('/wa-outbox/pending', async (c) => {
  const device = c.get('printDevice')!;
  const items = await getDb()
    .select()
    .from(print_wa_outbox)
    .where(
      and(
        eq(print_wa_outbox.status, 'pending'),
        lt(print_wa_outbox.attempt_count, 5),
        or(eq(print_wa_outbox.device_id, device.id), isNull(print_wa_outbox.device_id)),
      ),
    )
    .orderBy(asc(print_wa_outbox.created_at))
    .limit(20);

  return c.json({ messages: jsonSafe(items) });
});

agentRouter.post('/wa-outbox/:id/ack', async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) return c.json({ error: 'ID pesan outbox tidak valid.' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = printAgentOutboxAckSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [existing] = await getDb()
    .select()
    .from(print_wa_outbox)
    .where(eq(print_wa_outbox.id, id))
    .limit(1);
  if (!existing) return c.json({ error: 'Pesan outbox tidak ditemukan.' }, 404);

  const isSent = parsed.data.status === 'sent';
  const nextAttempts = existing.attempt_count + 1;
  const nextStatus = isSent ? 'sent' : nextAttempts >= 5 ? 'failed' : 'pending';

  const [updated] = await getDb()
    .update(print_wa_outbox)
    .set({
      status: nextStatus,
      attempt_count: nextAttempts,
      sent_at: isSent ? new Date() : existing.sent_at,
      last_error: isSent ? null : parsed.data.error_message ?? 'Gagal mengirim pesan WhatsApp',
    })
    .where(eq(print_wa_outbox.id, id))
    .returning();

  return c.json({ message: jsonSafe(updated) });
});

export const printerPlugin: ErpModulePlugin = {
  id: 'printer',
  basePath: '/print',
  router: printerRouter,
};

export const printAgentPlugin: ErpModulePlugin = {
  id: 'print-agent',
  basePath: '/print-agent',
  router: agentRouter,
};
