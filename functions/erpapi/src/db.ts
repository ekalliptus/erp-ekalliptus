import { createFunctionDb, type FunctionDb } from '@ekalliptus/db';
import { sql } from 'drizzle-orm';

let cached: ReturnType<typeof createFunctionDb> | null = null;

export function getDb(): FunctionDb {
  if (!cached) {
    const conn = process.env.DATABASE_URL;
    if (!conn) {
      throw new Error('DATABASE_URL is required in environment.');
    }
    cached = createFunctionDb(conn);
  }
  return cached.db;
}

export function getPool() {
  if (!cached) {
    getDb();
  }
  return cached!.pool;
}

export const txidExpr = sql<string>`pg_current_xact_id()::text`;

export function jsonSafe<T>(value: T): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}
