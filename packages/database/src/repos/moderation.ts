import { and, count, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { modCases } from '../schema';
import { nextCounter } from './core';

export type ModCaseRow = typeof modCases.$inferSelect;
export type CaseType = ModCaseRow['type'];

export async function createCase(
  db: Database,
  c: {
    guildId: string;
    type: CaseType;
    userId: string;
    moderatorId: string;
    reason?: string | null;
    durationSeconds?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<ModCaseRow> {
  const caseNumber = await nextCounter(db, c.guildId, 'case');
  const [row] = await db
    .insert(modCases)
    .values({
      guildId: c.guildId,
      caseNumber,
      type: c.type,
      userId: c.userId,
      moderatorId: c.moderatorId,
      reason: c.reason ?? null,
      durationSeconds: c.durationSeconds ?? null,
      metadata: c.metadata ?? null,
    })
    .returning();
  return row!;
}

export async function getCase(db: Database, guildId: string, caseNumber: number) {
  const [row] = await db
    .select()
    .from(modCases)
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber)))
    .limit(1);
  return row;
}

export async function listCases(
  db: Database,
  guildId: string,
  opts: { userId?: string; type?: CaseType; before?: number; limit?: number; appealsOnly?: boolean } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const conds = [eq(modCases.guildId, guildId)];
  if (opts.userId) conds.push(eq(modCases.userId, opts.userId));
  if (opts.type) conds.push(eq(modCases.type, opts.type));
  if (opts.before) conds.push(lt(modCases.caseNumber, opts.before));
  if (opts.appealsOnly) conds.push(eq(modCases.appealStatus, 'open'));
  const rows = await db.select().from(modCases).where(and(...conds)).orderBy(desc(modCases.caseNumber)).limit(limit + 1);
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.caseNumber : null };
}

/** Active warnings, optionally only those newer than `expiryDays`. */
export async function countActiveWarnings(db: Database, guildId: string, userId: string, expiryDays = 0): Promise<number> {
  const conds = [eq(modCases.guildId, guildId), eq(modCases.userId, userId), eq(modCases.type, 'warn'), eq(modCases.active, true)];
  if (expiryDays > 0) conds.push(gt(modCases.createdAt, new Date(Date.now() - expiryDays * 86_400_000)));
  const [row] = await db.select({ n: count() }).from(modCases).where(and(...conds));
  return Number(row?.n ?? 0);
}

export async function setCaseActive(db: Database, guildId: string, caseNumber: number, active: boolean) {
  const rows = await db
    .update(modCases)
    .set({ active })
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber)))
    .returning();
  return rows[0];
}

export async function updateCaseReason(db: Database, guildId: string, caseNumber: number, reason: string) {
  const rows = await db
    .update(modCases)
    .set({ reason })
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber)))
    .returning();
  return rows[0];
}

/** Only the punished user may appeal, only once, and only for punishments (not notes). */
export async function openAppeal(db: Database, guildId: string, caseNumber: number, userId: string, text: string) {
  const rows = await db
    .update(modCases)
    .set({ appealStatus: 'open', appealText: text.slice(0, 2000), appealedAt: new Date() })
    .where(
      and(
        eq(modCases.guildId, guildId),
        eq(modCases.caseNumber, caseNumber),
        eq(modCases.userId, userId),
        eq(modCases.appealStatus, 'none'),
        sql`${modCases.type} in ('warn','timeout','kick','ban','automod')`,
      ),
    )
    .returning();
  return rows[0];
}

export async function resolveAppeal(db: Database, guildId: string, caseNumber: number, accepted: boolean, moderatorId: string) {
  const rows = await db
    .update(modCases)
    .set({
      appealStatus: accepted ? 'accepted' : 'rejected',
      appealResolvedBy: moderatorId,
      ...(accepted ? { active: false } : {}),
    })
    .where(and(eq(modCases.guildId, guildId), eq(modCases.caseNumber, caseNumber), eq(modCases.appealStatus, 'open')))
    .returning();
  return rows[0];
}
