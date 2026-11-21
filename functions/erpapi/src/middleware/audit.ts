import type { PlatformKind } from '@ekalliptus/contracts';
import { audit_logs, erp_events, type FunctionDb } from '@ekalliptus/db';
import { jsonSafe } from '../db.js';

type DbExecutor = Pick<FunctionDb, 'insert'>;

export interface AuditInput {
  actorId: string | null;
  platform: PlatformKind;
  module: string;
  action: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}

export async function writeAuditLog(executor: DbExecutor, input: AuditInput): Promise<void> {
  await executor.insert(audit_logs).values({
    actor_id: input.actorId,
    platform: input.platform,
    module: input.module,
    action: input.action,
    entity_id: input.entityId ?? null,
    before_data: input.beforeData !== undefined ? jsonSafe(input.beforeData) : null,
    after_data: input.afterData !== undefined ? jsonSafe(input.afterData) : null,
  });
}

export type ErpChannel = 'erp:finance' | 'erp:inventory' | 'erp:attendance';

export async function emitErpEvent(
  executor: DbExecutor,
  channel: ErpChannel,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await executor.insert(erp_events).values({
    channel,
    event_type: eventType,
    payload: jsonSafe(payload) as Record<string, unknown>,
  });
}
