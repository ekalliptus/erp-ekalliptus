import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import {
  device_tokens,
  employees,
  notifications,
  permissions,
  role_permissions,
  type FunctionDb,
} from '@ekalliptus/db';
import { getDb } from '../db.js';
import { isFcmConfigured, sendFcmToTokens } from './fcm.js';

type DbExecutor = Pick<FunctionDb, 'insert' | 'select'>;

export interface NotifyInput {
  module: string;
  eventType: string;
  title: string;
  body: string;
  recipients: string[];
  excludeAuthUserId?: string | null;
  actorEmployeeId?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

export async function notifyUsersInTx(
  executor: DbExecutor,
  input: NotifyInput,
): Promise<number> {
  const uniqueRecipients = [
    ...new Set(
      input.recipients.filter(
        (r) => typeof r === 'string' && r.length > 0 && r !== input.excludeAuthUserId,
      ),
    ),
  ];
  if (uniqueRecipients.length === 0) return 0;

  const values = uniqueRecipients.map((authUserId) => ({
    recipient_auth_user_id: authUserId,
    actor_employee_id: input.actorEmployeeId ?? null,
    module: input.module,
    event_type: input.eventType,
    title: input.title,
    body: input.body,
    entity_id: input.entityId ?? null,
    payload: input.payload ?? null,
  }));

  const inserted = await executor
    .insert(notifications)
    .values(values)
    .returning({ id: notifications.id });
  return inserted.length;
}

export async function resolveModuleViewers(
  executor: Pick<FunctionDb, 'select'>,
  module: string,
): Promise<string[]> {
  const rows = await executor
    .select({ auth_user_id: employees.auth_user_id })
    .from(employees)
    .innerJoin(role_permissions, eq(role_permissions.role_id, employees.role_id))
    .innerJoin(permissions, eq(permissions.id, role_permissions.permission_id))
    .where(
      and(
        eq(permissions.module, module),
        eq(permissions.action, 'view'),
        eq(employees.is_active, true),
      ),
    );
  return [
    ...new Set(
      rows
        .map((r) => r.auth_user_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
}

const SWEEP_WINDOW_MINUTES = 10;

export async function dispatchPendingNotifications(): Promise<void> {
  if (!isFcmConfigured()) return;
  const db = getDb();
  try {
    const claimed = await db
      .update(notifications)
      .set({ pushed_at: new Date() })
      .where(
        and(
          isNull(notifications.pushed_at),
          gte(notifications.created_at, new Date(Date.now() - SWEEP_WINDOW_MINUTES * 60_000)),
        ),
      )
      .returning();
    if (claimed.length === 0) return;

    const groups = new Map<
      string,
      {
        recipients: Set<string>;
        ids: string[];
        title: string;
        body: string;
        module: string;
        eventType: string;
        entityId: string | null;
      }
    >();

    for (const row of claimed) {
      const key = `${row.title}||${row.body}`;
      const existing = groups.get(key);
      if (existing) {
        existing.recipients.add(row.recipient_auth_user_id);
        existing.ids.push(row.id);
        continue;
      }
      groups.set(key, {
        recipients: new Set([row.recipient_auth_user_id]),
        ids: [row.id],
        title: row.title,
        body: row.body,
        module: row.module,
        eventType: row.event_type,
        entityId: row.entity_id,
      });
    }

    for (const group of groups.values()) {
      const recipientIds = [...group.recipients];
      const tokenRows = await db
        .select({ token: device_tokens.token })
        .from(device_tokens)
        .where(inArray(device_tokens.auth_user_id, recipientIds));
      if (tokenRows.length === 0) continue;
      const sendResult = await sendFcmToTokens(
        tokenRows.map((t) => t.token),
        {
          title: group.title,
          body: group.body,
          data: {
            module: group.module,
            event_type: group.eventType,
            entity_id: group.entityId ?? '',
            notification_ids: group.ids.slice(0, 10).join(','),
          },
        },
      );
      if (sendResult.deadTokens.length > 0) {
        await db.delete(device_tokens).where(inArray(device_tokens.token, sendResult.deadTokens));
      }
    }
  } catch (err) {
    console.warn('[notify] dispatch gagal:', err instanceof Error ? err.message : err);
  }
}

export function formatRupiah(amount: bigint): string {
  const digits = amount.toString();
  const sign = digits.startsWith('-') ? '-' : '';
  const body = digits.replace('-', '');
  return `${sign}Rp${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
