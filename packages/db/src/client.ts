import { attachDatabasePool } from '@neon/functions';
import { neonConfig, Pool as ServerlessPool } from '@neondatabase/serverless';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeonServerless } from 'drizzle-orm/neon-serverless';
import { Pool as PgPool } from 'pg';
import ws from 'ws';
import * as schema from './schema.js';

export function createFunctionDb(connectionString: string) {
  const pool = new PgPool({
    connectionString: connectionString.replace('sslmode=require', 'sslmode=verify-full'),
    max: 5,
  });
  attachDatabasePool(pool);
  return {
    pool,
    db: drizzleNodePg(pool, { schema }),
  };
}

export function createServerlessDb(connectionString: string) {
  neonConfig.webSocketConstructor = ws;
  const pool = new ServerlessPool({ connectionString });
  return {
    pool,
    db: drizzleNeonServerless(pool, { schema }),
  };
}

export function createDirectDb(connectionString: string) {
  const pool = new PgPool({
    connectionString: connectionString.replace('sslmode=require', 'sslmode=verify-full'),
    max: 2,
  });
  return {
    pool,
    db: drizzleNodePg(pool, { schema }),
  };
}

export type FunctionDb = ReturnType<typeof createFunctionDb>['db'];
export type ServerlessDb = ReturnType<typeof createServerlessDb>['db'];
