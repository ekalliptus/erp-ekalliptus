import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
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

let pendingNotificationHint = false;

export function consumePendingNotificationHint(): boolean {
  const hadPending = pendingNotificationHint;
  pendingNotificationHint = false;
  return hadPending;
}

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
  if (inserted.length > 0) {
    pendingNotificationHint = true;
  }
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

export async function resolveModuleApprovers(
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
        eq(permissions.action, 'approve'),
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

export async function resolveAllActiveRecipients(
  executor: Pick<FunctionDb, 'select'>,
): Promise<string[]> {
  const rows = await executor
    .select({ auth_user_id: employees.auth_user_id })
    .from(employees)
    .where(and(eq(employees.is_active, true), isNotNull(employees.auth_user_id)));
  return [
    ...new Set(
      rows
        .map((r) => r.auth_user_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
}

export interface AppReleaseNotifyTarget {
  id: string;
  platform: string;
  version: string;
  build_number: number;
  title: string;
  is_mandatory?: boolean;
}

export async function notifyAppReleaseInTx(
  executor: DbExecutor,
  release: AppReleaseNotifyTarget,
  actorEmployeeId?: string | null,
): Promise<number> {
  const recipients = await resolveAllActiveRecipients(executor);
  if (recipients.length === 0) return 0;

  const targetPlatform: 'flutter' | 'web' =
    release.platform === 'android' ? 'flutter' : 'web';
  const title =
    release.platform === 'android'
      ? `Update MyEkalliptus v${release.version} Tersedia`
      : `Pembaruan Web MyEkalliptus v${release.version}`;
  const body =
    release.platform === 'android'
      ? `${release.title}. Ketuk untuk melihat changelog dan mengunduh pembaruan.`
      : `${release.title}. Muat ulang halaman untuk memakai versi terbaru.`;

  return notifyUsersInTx(executor, {
    module: 'app_update',
    eventType: 'app_release_published',
    title,
    body,
    recipients,
    excludeAuthUserId: null,
    actorEmployeeId: actorEmployeeId ?? null,
    entityId: release.id,
    payload: {
      target_platform: targetPlatform,
      release_platform: release.platform,
      version: release.version,
      build_number: release.build_number,
      is_mandatory: Boolean(release.is_mandatory),
    },
  });
}

const SWEEP_WINDOW_MINUTES = 10;

export interface DispatchNotificationsResult {
  claimed: number;
  sent: number;
  failed: number;
  deadTokensRemoved: number;
}

export async function dispatchPendingNotifications(): Promise<DispatchNotificationsResult> {
  pendingNotificationHint = false;
  const summary: DispatchNotificationsResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    deadTokensRemoved: 0,
  };
  if (!isFcmConfigured()) return summary;
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
    summary.claimed = claimed.length;
    if (claimed.length === 0) return summary;

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
        targetPlatform: 'flutter' | 'web' | null;
        extraData: Record<string, string>;
      }
    >();

    for (const row of claimed) {
      const payloadObj =
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null;
      const rawTarget = payloadObj?.target_platform;
      const targetPlatform: 'flutter' | 'web' | null =
        rawTarget === 'flutter' || rawTarget === 'web' ? rawTarget : null;

      const key = `${row.module}||${row.title}||${row.body}||${targetPlatform ?? 'all'}`;
      const existing = groups.get(key);
      if (existing) {
        existing.recipients.add(row.recipient_auth_user_id);
        existing.ids.push(row.id);
        continue;
      }

      const extraData: Record<string, string> = {};
      if (payloadObj?.version !== undefined && payloadObj?.version !== null) {
        extraData.version = String(payloadObj.version);
      }
      if (payloadObj?.build_number !== undefined && payloadObj?.build_number !== null) {
        extraData.build_number = String(payloadObj.build_number);
      }
      if (payloadObj?.release_platform !== undefined && payloadObj?.release_platform !== null) {
        extraData.release_platform = String(payloadObj.release_platform);
      }

      groups.set(key, {
        recipients: new Set([row.recipient_auth_user_id]),
        ids: [row.id],
        title: row.title,
        body: row.body,
        module: row.module,
        eventType: row.event_type,
        entityId: row.entity_id,
        targetPlatform,
        extraData,
      });
    }

    for (const group of groups.values()) {
      const recipientIds = [...group.recipients];
      const tokenCondition = group.targetPlatform
        ? and(
            inArray(device_tokens.auth_user_id, recipientIds),
            eq(device_tokens.platform, group.targetPlatform),
          )
        : inArray(device_tokens.auth_user_id, recipientIds);
      const tokenRows = await db
        .select({ token: device_tokens.token })
        .from(device_tokens)
        .where(tokenCondition);
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
            ...group.extraData,
          },
          link: 'https://my.ekalliptus.com',
        },
      );
      summary.sent += sendResult.sent;
      summary.failed += sendResult.failed;
      if (sendResult.deadTokens.length > 0) {
        const deleted = await db
          .delete(device_tokens)
          .where(inArray(device_tokens.token, sendResult.deadTokens))
          .returning({ id: device_tokens.id });
        summary.deadTokensRemoved += deleted.length;
      }
    }
  } catch (err) {
    console.warn('[notify] dispatch gagal:', err instanceof Error ? err.message : err);
  }
  return summary;
}

export function formatRupiah(amount: bigint): string {
  const digits = amount.toString();
  const sign = digits.startsWith('-') ? '-' : '';
  const body = digits.replace('-', '');
  return `${sign}Rp${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
