import crypto from 'node:crypto';
import { claimAccountSchema, setUsernameSchema, usernameLookupSchema } from '@ekalliptus/contracts';
import {
  attendances,
  employees,
  finance_accounts,
  inventory_items,
  inventory_stocks,
  payroll_runs,
} from '@ekalliptus/db';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, jsonSafe } from './db.js';
import { checkRateLimit, clientIp } from './services/rate-limit.js';
import { createAuthMiddleware, extractBearerToken, verifyAuthToken } from './middleware/auth.js';
import { attendancePlugin } from './modules/attendance.js';
import { financePlugin } from './modules/finance.js';
import { inventoryPlugin } from './modules/inventory.js';
import { payrollPlugin } from './modules/payroll.js';
import { registerErpPlugins } from './modules/plugin.js';
import { rbacPlugin } from './modules/rbac.js';
import { realtimePlugin } from './modules/realtime.js';
import { notificationsPlugin } from './modules/notifications.js';
import { storagePlugin } from './modules/storage.js';
import type { AppEnv } from './types.js';

const app = new Hono<AppEnv>();

const ALLOWED_ORIGINS = (
  process.env.WEB_ALLOWED_ORIGINS ??
  'https://my.ekalliptus.com,https://myekalliptus.pages.dev,http://localhost:5173'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  '/api/*',
  cors({
    origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : undefined),
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Platform'],
    maxAge: 86400,
  }),
);

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'ekalliptus-erpapi',
    branch: process.env.NEON_BRANCH || 'production',
    realtime_configured: Boolean(process.env.NEON_REALTIME_SECRET || process.env.ERP_REALTIME_SECRET),
    notifications_configured: Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON),
    timestamp: new Date().toISOString(),
  });
});

// Lookup username ke email untuk login. Endpoint publik (di luar guard auth)
// karena dipakai sebelum sesi ada; catatan: tanpa rate limit khusus, bergantung
// pada proteksi level Neon Functions.
app.post('/api/auth/username-lookup', async (c) => {
  if (!checkRateLimit('lookup:' + clientIp(c), 10, 60_000)) {
    return c.json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' }, 429);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = usernameLookupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [row] = await getDb()
    .select({ email: employees.email })
    .from(employees)
    .where(and(eq(employees.username, parsed.data.username), eq(employees.is_active, true)))
    .limit(1);
  return c.json({ email: row?.email ?? null });
});


// Klaim karyawan dengan kode aktivasi dari HR/owner. JWT tetap wajib supaya
// penautan terjadi pada akun Neon Auth yang benar; kode membuktikan
// legitimasi di luar sistem (tidak ada auto-link email).
app.post('/api/auth/claim', async (c) => {
  if (!checkRateLimit('claim:' + clientIp(c), 5, 60_000)) {
    return c.json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' }, 429);
  }
  const token = extractBearerToken(c);
  if (!token) return c.json({ error: 'Unauthorized: missing Bearer token.' }, 401);
  const verified = await verifyAuthToken(token);
  if (!verified?.sub || !verified.email) {
    return c.json({ error: 'Unauthorized: token tanpa identitas email.' }, 401);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = claimAccountSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const codeHash = crypto.createHash('sha256').update(parsed.data.code.trim().toUpperCase()).digest('hex');
  const [claimed] = await getDb()
    .update(employees)
    .set({ auth_user_id: verified.sub, claim_code_hash: null })
    .where(
      and(
        sql`lower(${employees.email}) = ${verified.email}`,
        isNull(employees.auth_user_id),
        eq(employees.claim_code_hash, codeHash),
      ),
    )
    .returning({ id: employees.id, employee_code: employees.employee_code });
  if (!claimed) {
    const [existing] = await getDb()
      .select({ claimed: employees.auth_user_id })
      .from(employees)
      .where(sql`lower(${employees.email}) = ${verified.email}`)
      .limit(1);
    if (existing?.claimed) {
      return c.json({ error: 'Karyawan ini sudah diklaim akun lain.' }, 409);
    }
    return c.json({ error: 'Kode aktivasi tidak cocok dengan email ini.' }, 403);
  }
  return c.json({ claimed: true, employee_id: claimed.id, employee_code: claimed.employee_code });
});

const sseAuth = createAuthMiddleware(true);
const apiAuth = createAuthMiddleware(false);

app.use('/api/realtime/events', sseAuth);
app.use('/api/auth/username-lookup', (c, next) => next());
app.use('/api/*', async (c, next) => {
  if (
    c.req.path === '/api/health' ||
    c.req.path === '/api/realtime/events' ||
    c.req.path === '/api/auth/username-lookup' ||
    c.req.path === '/api/auth/claim'
  ) {
    await next();
    return;
  }
  return apiAuth(c, next);
});

// Simpan username milik karyawan yang sedang login (dipakai form aktivasi).
app.post('/api/me/username', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = setUsernameSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  try {
    const [updated] = await getDb()
      .update(employees)
      .set({ username: parsed.data.username })
      .where(eq(employees.id, auth.employee.id))
      .returning({ id: employees.id, username: employees.username });
    return c.json({ username: updated?.username ?? null });
  } catch (err) {
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if (pgErr?.code === '23505' || pgErr?.cause?.code === '23505') {
      return c.json({ error: 'Username sudah dipakai karyawan lain.' }, 409);
    }
    throw err;
  }
});

app.get('/api/me', async (c) => {
  const auth = c.get('auth');
  const db = getDb();

  const [cashSum] = await db
    .select({
      total_balance: sql<string>`coalesce(sum(${finance_accounts.balance}), 0)::text`,
    })
    .from(finance_accounts)
    .where(eq(finance_accounts.is_active, true));

  const [lowStockCount] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(inventory_stocks)
    .innerJoin(inventory_items, eq(inventory_items.id, inventory_stocks.item_id))
    .where(lte(inventory_stocks.qty, inventory_items.min_stock));

  const [pendingLeaves] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(attendances)
    .where(eq(attendances.approval_status, 'pending'));

  const [draftPayrolls] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(payroll_runs)
    .where(eq(payroll_runs.status, 'draft'));

  return c.json({
    employee: jsonSafe(auth.employee),
    role: auth.roleCode,
    role_name: auth.roleName,
    permissions: Array.from(auth.permissions).sort(),
    platform: auth.platform,
    kpis: {
      total_cash_balance: cashSum?.total_balance ?? '0',
      low_stock_alerts: lowStockCount?.count ?? 0,
      pending_attendance_approvals: pendingLeaves?.count ?? 0,
      draft_payroll_runs: draftPayrolls?.count ?? 0,
    },
  });
});

const apiRouter = new Hono<AppEnv>();
registerErpPlugins(apiRouter, [
  financePlugin,
  inventoryPlugin,
  attendancePlugin,
  payrollPlugin,
  rbacPlugin,
  storagePlugin,
  realtimePlugin,
  notificationsPlugin,
]);

app.route('/api', apiRouter);

app.onError((err, c) => {
  console.error('[erpapi error]', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

export default app;
