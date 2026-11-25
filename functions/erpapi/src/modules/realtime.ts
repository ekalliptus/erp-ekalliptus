import { hasPermission, sealRealtimeSchema } from '@ekalliptus/contracts';
import { erp_events } from '@ekalliptus/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, jsonSafe } from '../db.js';
import { canViewAllEmployeesData } from '../services/security-policy.js';
import {
  attendancesLiveQuery,
  erpEventsLiveQuery,
  financeAccountsLiveQuery,
  financeTransactionsLiveQuery,
  getRealtime,
  inventoryStocksLiveQuery,
} from '../services/realtime.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const router = new Hono<AppEnv>();

router.post('/seal', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sealRealtimeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const auth = c.get('auth');
  const feed = parsed.data.feed;
  const rt = getRealtime();

  if (feed === 'erp:finance' || feed === 'finance_accounts' || feed === 'finance_transactions') {
    if (!hasPermission(auth.permissions, 'finance', 'view')) {
      return c.json({ error: 'Forbidden: finance:view required.' }, 403);
    }
    const query =
      feed === 'erp:finance'
        ? erpEventsLiveQuery('erp:finance')
        : feed === 'finance_accounts'
          ? financeAccountsLiveQuery()
          : financeTransactionsLiveQuery();
    const sealed = await rt.seal({ query });
    return c.json(sealed);
  }

  if (feed === 'erp:inventory' || feed === 'inventory_stocks') {
    if (!hasPermission(auth.permissions, 'inventory', 'view')) {
      return c.json({ error: 'Forbidden: inventory:view required.' }, 403);
    }
    const query =
      feed === 'erp:inventory' ? erpEventsLiveQuery('erp:inventory') : inventoryStocksLiveQuery();
    const sealed = await rt.seal({ query });
    return c.json(sealed);
  }

  if (feed === 'erp:printer') {
    if (!hasPermission(auth.permissions, 'printer', 'view')) {
      return c.json({ error: 'Forbidden: printer:view required.' }, 403);
    }
    const query = erpEventsLiveQuery('erp:printer');
    const sealed = await rt.seal({ query });
    return c.json(sealed);
  }

  if (!hasPermission(auth.permissions, 'attendance', 'view')) {
    return c.json({ error: 'Forbidden: attendance:view required.' }, 403);
  }
  const scopedEmployeeId = canViewAllEmployeesData(auth.roleCode) ? undefined : auth.employee.id;
  const query =
    feed === 'erp:attendance'
      ? erpEventsLiveQuery('erp:attendance', scopedEmployeeId)
      : attendancesLiveQuery(scopedEmployeeId);
  const sealed = await rt.seal({ query });
  return c.json(sealed);
});

router.get('/events', async (c) => {
  const auth = c.get('auth');
  const channel = c.req.query('channel') || 'erp:finance';
  if (
    channel !== 'erp:finance' &&
    channel !== 'erp:inventory' &&
    channel !== 'erp:attendance' &&
    channel !== 'erp:printer'
  ) {
    return c.json({ error: 'Invalid channel.' }, 400);
  }

  const requiredModule =
    channel === 'erp:finance'
      ? 'finance'
      : channel === 'erp:inventory'
        ? 'inventory'
        : channel === 'erp:printer'
          ? 'printer'
          : 'attendance';
  if (!hasPermission(auth.permissions, requiredModule, 'view')) {
    return c.json({ error: `Forbidden: ${requiredModule}:view required.` }, 403);
  }

  const scopedEmployeeId =
    channel === 'erp:attendance' && !canViewAllEmployeesData(auth.roleCode)
      ? auth.employee.id
      : undefined;

  const db = getDb();
  let lastId = BigInt(c.req.query('after_id') || '0');
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(chunk));
        }
      };

      send(`event: connected\ndata: ${JSON.stringify({ channel, after_id: lastId.toString() })}\n\n`);

      const poll = async () => {
        if (closed) return;
        try {
          const conditions = [eq(erp_events.channel, channel), gt(erp_events.id, lastId)];
          if (scopedEmployeeId) {
            conditions.push(sql`${erp_events.payload}->>'employee_id' = ${scopedEmployeeId}`);
          }
          const rows = await db
            .select()
            .from(erp_events)
            .where(and(...conditions))
            .orderBy(erp_events.id)
            .limit(50);

          for (const row of rows) {
            lastId = row.id;
            send(`id: ${row.id.toString()}\nevent: ${row.event_type}\ndata: ${JSON.stringify(jsonSafe(row))}\n\n`);
          }
        } catch (err) {
          console.error('[sse poll]', err);
        }
      };

      await poll();
      timer = setInterval(poll, 1500);
      heartbeat = setInterval(() => send(': ping\n\n'), 25000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export const realtimePlugin: ErpModulePlugin = {
  id: 'realtime',
  basePath: '/realtime',
  router,
};
