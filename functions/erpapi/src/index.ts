import {
  attendances,
  finance_accounts,
  inventory_items,
  inventory_stocks,
  payroll_runs,
} from '@ekalliptus/db';
import { eq, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, jsonSafe } from './db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { attendancePlugin } from './modules/attendance.js';
import { financePlugin } from './modules/finance.js';
import { inventoryPlugin } from './modules/inventory.js';
import { payrollPlugin } from './modules/payroll.js';
import { registerErpPlugins } from './modules/plugin.js';
import { rbacPlugin } from './modules/rbac.js';
import { realtimePlugin } from './modules/realtime.js';
import { storagePlugin } from './modules/storage.js';
import type { AppEnv } from './types.js';

const app = new Hono<AppEnv>();

app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '*',
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
    timestamp: new Date().toISOString(),
  });
});

const sseAuth = createAuthMiddleware(true);
const apiAuth = createAuthMiddleware(false);

app.use('/api/realtime/events', sseAuth);
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health' || c.req.path === '/api/realtime/events') {
    await next();
    return;
  }
  return apiAuth(c, next);
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
]);

app.route('/api', apiRouter);

app.onError((err, c) => {
  console.error('[erpapi error]', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

export default app;
