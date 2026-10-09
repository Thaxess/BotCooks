import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { guildLocks, jobs } from '../schema';

/**
 * Durable job queue on PostgreSQL. Jobs are claimed with FOR UPDATE SKIP LOCKED and a lease;
 * a worker that dies leaves an expired lease, and `recoverExpiredJobs` puts the job back.
 */
export type JobRow = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  guildId?: string | null;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

/** Returns the job id, or null when an identical pending job (same dedupeKey) already exists. */
export async function enqueueJob(db: Database, type: string, payload: unknown, opts: EnqueueOptions = {}): Promise<number | null> {
  const rows = await db
    .insert(jobs)
    .values({
      type,
      payload: payload as object,
      guildId: opts.guildId ?? null,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

export async function claimJob(db: Database, workerId: string, types: string[], leaseMs: number): Promise<JobRow | null> {
  if (types.length === 0) return null;
  const leaseUntil = new Date(Date.now() + leaseMs);
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), sql`${jobs.runAt} <= now()`, inArray(jobs.type, types)))
      .orderBy(jobs.runAt, jobs.id)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;
    const [row] = await tx
      .update(jobs)
      .set({ status: 'running', lockedBy: workerId, lockedUntil: leaseUntil, attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
      .where(eq(jobs.id, candidate.id))
      .returning();
    return row ?? null;
  });
}

export async function extendJobLease(db: Database, jobId: number, workerId: string, leaseMs: number): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ lockedUntil: new Date(Date.now() + leaseMs), updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId), eq(jobs.status, 'running')))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

export async function completeJob(db: Database, jobId: number, workerId: string) {
  await db
    .update(jobs)
    .set({ status: 'done', lockedBy: null, lockedUntil: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId)));
}

/** Exponential backoff: 5s, 20s, 80s, ... capped at 30 min. After maxAttempts the job is dead. */
export async function failJob(db: Database, job: JobRow, workerId: string, error: string, opts: { retry?: boolean; delayMs?: number } = {}) {
  const retry = (opts.retry ?? true) && job.attempts < job.maxAttempts;
  const delay = opts.delayMs ?? Math.min(5_000 * 4 ** Math.max(job.attempts - 1, 0), 30 * 60_000);
  await db
    .update(jobs)
    .set({
      status: retry ? 'queued' : 'dead',
      runAt: retry ? new Date(Date.now() + delay) : job.runAt,
      lastError: error.slice(0, 2000),
      lockedBy: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));
}

/** Put a job back without consuming an attempt (e.g. the guild is locked by another execution). */
export async function releaseJob(db: Database, job: JobRow, workerId: string, delayMs: number) {
  await db
    .update(jobs)
    .set({
      status: 'queued',
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      runAt: new Date(Date.now() + delayMs),
      lockedBy: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));
}

/** Requeue jobs whose worker stopped renewing its lease (crash, deploy, network split). */
export async function recoverExpiredJobs(db: Database): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: 'queued', lockedBy: null, lockedUntil: null, updatedAt: new Date(), lastError: 'Recovered after worker lease expired' })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, new Date())))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function getJob(db: Database, id: number) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row;
}

export async function purgeFinishedJobs(db: Database, olderThanDays = 7) {
  await db
    .delete(jobs)
    .where(and(or(eq(jobs.status, 'done'), eq(jobs.status, 'dead')), lt(jobs.updatedAt, new Date(Date.now() - olderThanDays * 86_400_000))));
}

// ------------------------------------------------------------------ per-guild locks
/**
 * Acquire (or re-acquire) the per-guild structural lock. Only one plan execution may modify a
 * guild at a time. The lock expires so a crashed holder cannot block the guild forever.
 */
export async function acquireGuildLock(db: Database, guildId: string, holder: string, purpose: string, ttlMs: number): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await db
    .insert(guildLocks)
    .values({ guildId, holder, purpose, expiresAt })
    .onConflictDoUpdate({
      target: guildLocks.guildId,
      set: { holder, purpose, expiresAt },
      setWhere: or(lt(guildLocks.expiresAt, new Date()), eq(guildLocks.holder, holder)),
    })
    .returning({ holder: guildLocks.holder });
  return rows[0]?.holder === holder;
}

export async function renewGuildLock(db: Database, guildId: string, holder: string, ttlMs: number): Promise<boolean> {
  const rows = await db
    .update(guildLocks)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(and(eq(guildLocks.guildId, guildId), eq(guildLocks.holder, holder)))
    .returning({ guildId: guildLocks.guildId });
  return rows.length === 1;
}

export async function releaseGuildLock(db: Database, guildId: string, holder: string) {
  await db.delete(guildLocks).where(and(eq(guildLocks.guildId, guildId), eq(guildLocks.holder, holder)));
}

export async function getGuildLock(db: Database, guildId: string) {
  const [row] = await db.select().from(guildLocks).where(eq(guildLocks.guildId, guildId)).limit(1);
  return row && row.expiresAt > new Date() ? row : undefined;
}
