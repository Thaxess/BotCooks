import { and, desc, eq, max, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { buildSessions, executionOps, executions, planVersions, resourceMappings, snapshots } from '../schema';

export type BuildSessionRow = typeof buildSessions.$inferSelect;
export type PlanVersionRow = typeof planVersions.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;

// ------------------------------------------------------------------ sessions & plan versions
export async function createBuildSession(
  db: Database,
  s: { guildId: string; createdBy: string; source: 'dashboard' | 'discord'; prompt: string; templateId?: string | null; interactionEnc?: string | null },
) {
  const [row] = await db
    .insert(buildSessions)
    .values({ ...s, templateId: s.templateId ?? null, interactionEnc: s.interactionEnc ?? null })
    .returning();
  return row!;
}

export async function getBuildSession(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(buildSessions)
    .where(and(eq(buildSessions.id, id), eq(buildSessions.guildId, guildId)))
    .limit(1);
  return row;
}

export async function listBuildSessions(db: Database, guildId: string, limit = 20) {
  return db
    .select({
      id: buildSessions.id,
      prompt: buildSessions.prompt,
      status: buildSessions.status,
      source: buildSessions.source,
      templateId: buildSessions.templateId,
      createdBy: buildSessions.createdBy,
      createdAt: buildSessions.createdAt,
      error: buildSessions.error,
    })
    .from(buildSessions)
    .where(eq(buildSessions.guildId, guildId))
    .orderBy(desc(buildSessions.createdAt))
    .limit(Math.min(limit, 100));
}

export async function setBuildSessionStatus(
  db: Database,
  guildId: string,
  id: string,
  status: BuildSessionRow['status'],
  error: string | null = null,
) {
  await db
    .update(buildSessions)
    .set({ status, error, updatedAt: new Date() })
    .where(and(eq(buildSessions.id, id), eq(buildSessions.guildId, guildId)));
}

export async function clearInteraction(db: Database, guildId: string, id: string) {
  await db
    .update(buildSessions)
    .set({ interactionEnc: null })
    .where(and(eq(buildSessions.id, id), eq(buildSessions.guildId, guildId)));
}

export async function addPlanVersion(
  db: Database,
  v: Omit<typeof planVersions.$inferInsert, 'id' | 'version' | 'createdAt'>,
): Promise<PlanVersionRow> {
  // Retry on the (session, version) unique index if two revisions race.
  for (let i = 0; i < 3; i++) {
    const [{ current } = { current: 0 }] = await db
      .select({ current: max(planVersions.version) })
      .from(planVersions)
      .where(eq(planVersions.sessionId, v.sessionId));
    const inserted = await db
      .insert(planVersions)
      .values({ ...v, version: (current ?? 0) + 1 })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
  }
  throw new Error('Could not allocate a plan version');
}

export async function getPlanVersion(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.id, id), eq(planVersions.guildId, guildId)))
    .limit(1);
  return row;
}

export async function getLatestPlanVersion(db: Database, guildId: string, sessionId: string) {
  const [row] = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.sessionId, sessionId), eq(planVersions.guildId, guildId)))
    .orderBy(desc(planVersions.version))
    .limit(1);
  return row;
}

export async function listPlanVersions(db: Database, guildId: string, sessionId: string) {
  return db
    .select({
      id: planVersions.id,
      version: planVersions.version,
      instruction: planVersions.instruction,
      planHash: planVersions.planHash,
      createdAt: planVersions.createdAt,
      createdBy: planVersions.createdBy,
      aiModel: planVersions.aiModel,
    })
    .from(planVersions)
    .where(and(eq(planVersions.sessionId, sessionId), eq(planVersions.guildId, guildId)))
    .orderBy(desc(planVersions.version));
}

// ------------------------------------------------------------------ snapshots
export async function saveSnapshot(db: Database, s: Omit<typeof snapshots.$inferInsert, 'id' | 'createdAt'>) {
  const [row] = await db.insert(snapshots).values(s).returning();
  return row!;
}

export async function getSnapshot(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, id), eq(snapshots.guildId, guildId)))
    .limit(1);
  return row;
}

export async function listSnapshots(db: Database, guildId: string, limit = 25) {
  return db
    .select({
      id: snapshots.id,
      reason: snapshots.reason,
      label: snapshots.label,
      hash: snapshots.hash,
      createdAt: snapshots.createdAt,
      createdBy: snapshots.createdBy,
      roleCount: sql<number>`jsonb_array_length(${snapshots.snapshot}->'roles')`,
      channelCount: sql<number>`jsonb_array_length(${snapshots.snapshot}->'channels')`,
    })
    .from(snapshots)
    .where(eq(snapshots.guildId, guildId))
    .orderBy(desc(snapshots.createdAt))
    .limit(Math.min(limit, 100));
}

// ------------------------------------------------------------------ executions
export async function createExecution(db: Database, e: Omit<typeof executions.$inferInsert, 'id' | 'createdAt'>) {
  const [row] = await db.insert(executions).values(e).onConflictDoNothing().returning();
  // null => the confirmation nonce was already used (replay); callers must treat this as an error.
  return row ?? null;
}

export async function getExecution(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(executions)
    .where(and(eq(executions.id, id), eq(executions.guildId, guildId)))
    .limit(1);
  return row;
}

/** Worker-only lookup by id; the job payload carries the guild id which is then checked against the row. */
export async function getExecutionById(db: Database, id: string) {
  const [row] = await db.select().from(executions).where(eq(executions.id, id)).limit(1);
  return row;
}

export async function listExecutions(db: Database, guildId: string, limit = 20) {
  return db
    .select({
      id: executions.id,
      kind: executions.kind,
      status: executions.status,
      mode: executions.mode,
      planVersionId: executions.planVersionId,
      parentExecutionId: executions.parentExecutionId,
      progressDone: executions.progressDone,
      progressTotal: executions.progressTotal,
      progressLabel: executions.progressLabel,
      confirmedBy: executions.confirmedBy,
      createdAt: executions.createdAt,
      finishedAt: executions.finishedAt,
      report: executions.report,
    })
    .from(executions)
    .where(eq(executions.guildId, guildId))
    .orderBy(desc(executions.createdAt))
    .limit(Math.min(limit, 100));
}

export async function updateExecution(db: Database, id: string, patch: Partial<typeof executions.$inferInsert>) {
  await db.update(executions).set(patch).where(eq(executions.id, id));
}

export async function requestExecutionCancel(db: Database, guildId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(executions)
    .set({ cancelRequested: true })
    .where(and(eq(executions.id, id), eq(executions.guildId, guildId), sql`${executions.status} in ('queued','running')`))
    .returning({ id: executions.id });
  return rows.length === 1;
}

export async function isExecutionCancelRequested(db: Database, id: string): Promise<boolean> {
  const [row] = await db.select({ c: executions.cancelRequested }).from(executions).where(eq(executions.id, id)).limit(1);
  return row?.c ?? false;
}

export async function getOpStates(db: Database, executionId: string) {
  return db.select().from(executionOps).where(eq(executionOps.executionId, executionId));
}

export async function setOpState(db: Database, executionId: string, opId: string, s: { status: string; result?: unknown; error?: string | null }) {
  await db
    .insert(executionOps)
    .values({ executionId, opId, status: s.status, result: (s.result ?? null) as object | null, error: s.error ?? null })
    .onConflictDoUpdate({
      target: [executionOps.executionId, executionOps.opId],
      set: { status: s.status, result: (s.result ?? null) as object | null, error: s.error ?? null, updatedAt: new Date() },
    });
}

export async function getMappings(db: Database, executionId: string) {
  return db.select().from(resourceMappings).where(eq(resourceMappings.executionId, executionId));
}

export async function setMapping(db: Database, executionId: string, guildId: string, ref: string, discordId: string) {
  await db
    .insert(resourceMappings)
    .values({ executionId, guildId, ref, discordId })
    .onConflictDoUpdate({ target: [resourceMappings.executionId, resourceMappings.ref], set: { discordId } });
}
