import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
/** Driver-agnostic database handle (node-postgres in production, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface DbHandle {
  db: Database;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  const db = drizzle(pool, { schema }) as unknown as Database;
  return { db, close: () => pool.end() };
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

/**
 * Waits for migrations to have been applied (the worker applies them on start). Lets the bot and
 * dashboard start in any order instead of failing on missing tables.
 */
export async function waitForSchema(db: Database, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = (await db.execute(sql`select to_regclass('public.guild_settings') as t`)) as unknown as { rows: Array<{ t: string | null }> };
      if (res.rows[0]?.t) return;
    } catch {
      /* database not reachable yet */
    }
    if (Date.now() > deadline) {
      throw new Error('The database has no BotCooks tables. Start the worker (it applies migrations) or run `npm run db:migrate`, then restart.');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
