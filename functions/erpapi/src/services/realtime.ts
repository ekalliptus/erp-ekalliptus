import {
  attendances,
  erp_events,
  finance_accounts,
  finance_transactions,
  inventory_items,
  inventory_stocks,
} from '@ekalliptus/db';
import { createRealtime } from '@neon/realtime/server';
import { drizzleAdapter } from '@neon/realtime-drizzle';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from '../db.js';

let realtimeInstance: ReturnType<typeof createRealtime> | null = null;

function resolveDbName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return 'neondb';
  try {
    return new URL(url).pathname.replace(/^\//, '') || 'neondb';
  } catch {
    return 'neondb';
  }
}

export function getRealtime() {
  if (!realtimeInstance) {
    const secret = process.env.NEON_REALTIME_SECRET || process.env.ERP_REALTIME_SECRET;
    if (!secret) {
      throw new Error('NEON_REALTIME_SECRET or ERP_REALTIME_SECRET is required for Neon Realtime.');
    }
    realtimeInstance = createRealtime({
      secret,
      db: resolveDbName(),
      adapter: drizzleAdapter(),
      debugMode: process.env.NODE_ENV === 'development',
    });
  }
  return realtimeInstance;
}

export function financeAccountsLiveQuery() {
  return getDb()
    .select({
      id: finance_accounts.id,
      name: finance_accounts.name,
      type: finance_accounts.type,
      account_number: finance_accounts.account_number,
      balance: finance_accounts.balance,
      is_active: finance_accounts.is_active,
      created_at: finance_accounts.created_at,
    })
    .from(finance_accounts)
    .orderBy(finance_accounts.name);
}

export function financeTransactionsLiveQuery() {
  return getDb()
    .select({
      id: finance_transactions.id,
      account_id: finance_transactions.account_id,
      target_account_id: finance_transactions.target_account_id,
      category_id: finance_transactions.category_id,
      type: finance_transactions.type,
      amount: finance_transactions.amount,
      description: finance_transactions.description,
      status: finance_transactions.status,
      transacted_at: finance_transactions.transacted_at,
    })
    .from(finance_transactions)
    .orderBy(desc(finance_transactions.transacted_at))
    .limit(50);
}

export function inventoryLowStockLiveQuery() {
  return getDb()
    .select({
      item_id: inventory_stocks.item_id,
      warehouse_id: inventory_stocks.warehouse_id,
      qty: inventory_stocks.qty,
      sku: inventory_items.sku,
      name: inventory_items.name,
      min_stock: inventory_items.min_stock,
    })
    .from(inventory_stocks)
    .innerJoin(inventory_items, eq(inventory_items.id, inventory_stocks.item_id))
    .where(lte(inventory_stocks.qty, inventory_items.min_stock));
}

export function inventoryStocksLiveQuery() {
  return getDb()
    .select({
      item_id: inventory_stocks.item_id,
      warehouse_id: inventory_stocks.warehouse_id,
      qty: inventory_stocks.qty,
    })
    .from(inventory_stocks);
}

export function attendancesLiveQuery(employeeId?: string) {
  const base = getDb()
    .select({
      id: attendances.id,
      employee_id: attendances.employee_id,
      office_id: attendances.office_id,
      attendance_date: attendances.attendance_date,
      clock_in_at: attendances.clock_in_at,
      clock_out_at: attendances.clock_out_at,
      status: attendances.status,
      late_minutes: attendances.late_minutes,
      overtime_minutes: attendances.overtime_minutes,
      approval_status: attendances.approval_status,
    })
    .from(attendances);
  const filtered = employeeId ? base.where(eq(attendances.employee_id, employeeId)) : base;
  return filtered.orderBy(desc(attendances.attendance_date)).limit(100);
}

export function erpEventsLiveQuery(
  channel: 'erp:finance' | 'erp:inventory' | 'erp:attendance',
  employeeId?: string,
) {
  const condition =
    channel === 'erp:attendance' && employeeId
      ? and(
          eq(erp_events.channel, channel),
          sql`${erp_events.payload}->>'employee_id' = ${employeeId}`,
        )
      : eq(erp_events.channel, channel);
  return getDb()
    .select({
      id: erp_events.id,
      channel: erp_events.channel,
      event_type: erp_events.event_type,
      payload: erp_events.payload,
      created_at: erp_events.created_at,
    })
    .from(erp_events)
    .where(condition)
    .orderBy(desc(erp_events.id))
    .limit(30);
}
