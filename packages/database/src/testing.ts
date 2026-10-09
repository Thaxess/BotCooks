import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, type Database, type DbHandle } from './client';
import * as schema from './schema';

/**
 * In-process PostgreSQL (PGlite, real Postgres compiled to WASM) with all migrations applied.
 * Lets integration tests exercise real SQL - locking, constraints, ON CONFLICT - without Docker.
 */
export async function createTestDb(): Promise<DbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Database, close: () => client.close() };
}
