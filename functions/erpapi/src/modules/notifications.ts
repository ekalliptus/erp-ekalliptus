import { registerDeviceTokenSchema } from '@ekalliptus/contracts';
import { device_tokens, notifications } from '@ekalliptus/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, jsonSafe } from '../db.js';
import type { AppEnv } from '../types.js';
import type { ErpModulePlugin } from './plugin.js';

const unregisterSchema = z.object({
  token: z.string().trim().min(32).max(4096),
});

const router = new Hono<AppEnv>();

router.post('/tokens', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerDeviceTokenSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const db = getDb();

  await db
    .insert(device_tokens)
    .values({
      auth_user_id: auth.authUserId,
      token: parsed.data.token,
      platform: parsed.data.platform,
    })
    .onConflictDoUpdate({
      target: device_tokens.token,
      set: {
        auth_user_id: auth.authUserId,
        platform: parsed.data.platform,
        updated_at: new Date(),
      },
    });
  return c.json({ registered: true });
});

router.post('/tokens/unregister', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = unregisterSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const auth = c.get('auth');
  const db = getDb();
  const deleted = await db
    .delete(device_tokens)
    .where(
      and(
        eq(device_tokens.token, parsed.data.token),
        eq(device_tokens.auth_user_id, auth.authUserId),
      ),
    )
    .returning({ id: device_tokens.id });
  return c.json({ unregistered: deleted.length });
});

router.get('/', async (c) => {
  const auth = c.get('auth');
  const db = getDb();
  const limitParam = Number(c.req.query('limit') ?? '30');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 50) : 30;
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.recipient_auth_user_id, auth.authUserId))
    .orderBy(desc(notifications.created_at))
    .limit(limit);
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipient_auth_user_id, auth.authUserId),
        isNull(notifications.read_at),
      ),
    );
  return c.json({ notifications: jsonSafe(rows), unread: unread?.count ?? 0 });
});

router.get('/unread-count', async (c) => {
  const auth = c.get('auth');
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipient_auth_user_id, auth.authUserId),
        isNull(notifications.read_at),
      ),
    );
  return c.json({ unread: row?.count ?? 0 });
});

router.post('/read-all', async (c) => {
  const auth = c.get('auth');
  const db = getDb();
  const updated = await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notifications.recipient_auth_user_id, auth.authUserId),
        isNull(notifications.read_at),
      ),
    )
    .returning({ id: notifications.id });
  return c.json({ marked: updated.length });
});

router.post('/:id/read', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing notification id.' }, 400);
  const auth = c.get('auth');
  const db = getDb();
  const updated = await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipient_auth_user_id, auth.authUserId),
      ),
    )
    .returning({ id: notifications.id });
  if (updated.length === 0) return c.json({ error: 'Notification not found.' }, 404);
  return c.json({ marked: updated.length });
});

export const notificationsPlugin: ErpModulePlugin = {
  id: 'notifications',
  basePath: '/notifications',
  router,
};
