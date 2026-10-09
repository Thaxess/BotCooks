import { and, eq, inArray } from 'drizzle-orm';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UserFacingError,
  hashValue,
  serverPlanSchema,
  snapshotHash,
  type GuildSnapshot,
  type ServerPlan,
} from '@botcooks/shared';
import { TEMPLATES, generatePlan, PlanGenerationError, AIProviderError, type AIProvider, type TemplateId } from '@botcooks/ai';
import {
  addPlanVersion,
  createBuildSession,
  createExecution,
  enqueueJob,
  getBuildSession,
  getExecution,
  getLatestPlanVersion,
  getOpStates,
  getPlanVersion,
  getSettings,
  recordAudit,
  saveSnapshot,
  schema,
  setBuildSessionStatus,
  type Database,
} from '@botcooks/database';
import { can, randomToken, signConfirmation, validatePlan, verifyConfirmation, type Access, type PlanValidationResult } from '@botcooks/security';
import { buildRollbackOps, diffPlan, type ChangeSet, type DiffOptions, type Op } from '@botcooks/workflows';

export interface BuilderDeps {
  db: Database;
  /** ENCRYPTION_KEY; used to sign confirmations. */
  secret: string;
  /** Fresh snapshot from Discord (bot token). */
  fetchSnapshot: (guildId: string) => Promise<GuildSnapshot>;
  provider: AIProvider | null;
}

export const JOB_PLAN_GENERATE = 'plan.generate';
export const JOB_PLAN_EXECUTE = 'plan.execute';

export interface GeneratePayload {
  guildId: string;
  sessionId: string;
  userId: string;
  instruction?: string;
  baseVersionId?: string;
}

// ------------------------------------------------------------------ starting & revising
export async function startBuild(
  deps: BuilderDeps,
  input: {
    guildId: string;
    userId: string;
    source: 'dashboard' | 'discord';
    prompt?: string;
    templateId?: TemplateId;
    interactionEnc?: string | null;
  },
) {
  const prompt = (input.prompt ?? '').trim();
  if (!input.templateId && prompt.length < 10) throw new UserFacingError('Describe your server in at least a sentence.');
  if (prompt.length > 4000) throw new UserFacingError('Keep the description under 4000 characters.');
  if (!input.templateId && !deps.provider) {
    throw new UserFacingError('AI is not configured. Set AI_API_KEY (or use a template).', 'ai_not_configured', 503);
  }
  const template = input.templateId ? TEMPLATES[input.templateId] : undefined;
  if (input.templateId && !template) throw new UserFacingError('Unknown template.');

  const session = await createBuildSession(deps.db, {
    guildId: input.guildId,
    createdBy: input.userId,
    source: input.source,
    prompt: prompt || `Template: ${template!.info.name}`,
    templateId: input.templateId ?? null,
    interactionEnc: input.interactionEnc ?? null,
  });
  await recordAudit(deps.db, {
    guildId: input.guildId,
    actorId: input.userId,
    actorType: 'user',
    action: 'builder.start',
    target: session.id,
    details: { source: input.source, templateId: input.templateId ?? null },
  });

  if (template) {
    const snapshot = await deps.fetchSnapshot(input.guildId);
    const plan = serverPlanSchema.parse(template.plan);
    await storeVersion(deps.db, { guildId: input.guildId, sessionId: session.id, userId: input.userId, plan, raw: template.plan, snapshot, provider: 'template', model: input.templateId! });
    await setBuildSessionStatus(deps.db, input.guildId, session.id, 'ready');
    return { ...session, status: 'ready' as const };
  }

  const payload: GeneratePayload = { guildId: input.guildId, sessionId: session.id, userId: input.userId };
  await enqueueJob(deps.db, JOB_PLAN_GENERATE, payload, { guildId: input.guildId, dedupeKey: `gen:${session.id}`, maxAttempts: 2 });
  return session;
}

export async function reviseBuild(
  deps: BuilderDeps,
  input: { guildId: string; sessionId: string; userId: string; instruction: string },
) {
  const instruction = input.instruction.trim();
  if (instruction.length < 3) throw new UserFacingError('Tell BotCooks what to change.');
  if (instruction.length > 2000) throw new UserFacingError('Keep revision requests under 2000 characters.');
  if (!deps.provider) throw new UserFacingError('AI is not configured. Set AI_API_KEY.', 'ai_not_configured', 503);
  const session = await getBuildSession(deps.db, input.guildId, input.sessionId);
  if (!session) throw new NotFoundError('Build not found.');
  if (session.status === 'generating') throw new ConflictError('A plan is already being generated for this build.');
  const base = await getLatestPlanVersion(deps.db, input.guildId, input.sessionId);
  if (!base) throw new ConflictError('There is no plan to revise yet.');
  await setBuildSessionStatus(deps.db, input.guildId, input.sessionId, 'generating');
  const payload: GeneratePayload = { ...input, instruction, baseVersionId: base.id };
  await enqueueJob(deps.db, JOB_PLAN_GENERATE, payload, { guildId: input.guildId, dedupeKey: `gen:${input.sessionId}`, maxAttempts: 2 });
}

async function storeVersion(
  db: Database,
  v: {
    guildId: string;
    sessionId: string;
    userId: string;
    plan: ServerPlan;
    raw: unknown;
    snapshot: GuildSnapshot;
    provider: string;
    model: string;
    instruction?: string;
  },
) {
  const validated = validatePlan(v.plan, v.snapshot);
  return addPlanVersion(db, {
    sessionId: v.sessionId,
    guildId: v.guildId,
    plan: validated.plan,
    rawPlan: v.raw as object,
    validation: { issues: validated.issues, downgrades: validated.downgrades, blocking: validated.blocking },
    planHash: hashValue(validated.plan),
    instruction: v.instruction ?? null,
    aiProvider: v.provider,
    aiModel: v.model,
    createdBy: v.userId,
  });
}

/** Worker handler for plan.generate. Returns the stored version, or throws a user-facing error. */
export async function runGeneration(deps: BuilderDeps, payload: GeneratePayload) {
  const session = await getBuildSession(deps.db, payload.guildId, payload.sessionId);
  if (!session) return null;
  if (!deps.provider) {
    await setBuildSessionStatus(deps.db, payload.guildId, payload.sessionId, 'failed', 'AI is not configured.');
    return null;
  }
  try {
    const snapshot = await deps.fetchSnapshot(payload.guildId);
    const base = payload.baseVersionId ? await getPlanVersion(deps.db, payload.guildId, payload.baseVersionId) : undefined;
    const result = await generatePlan(deps.provider, {
      description: session.prompt,
      snapshot,
      ...(base && payload.instruction
        ? { revision: { currentPlan: serverPlanSchema.parse(base.plan), instruction: payload.instruction } }
        : {}),
    });
    const version = await storeVersion(deps.db, {
      guildId: payload.guildId,
      sessionId: payload.sessionId,
      userId: payload.userId,
      plan: result.plan,
      raw: result.plan,
      snapshot,
      provider: result.provider,
      model: result.model,
      ...(payload.instruction ? { instruction: payload.instruction } : {}),
    });
    await setBuildSessionStatus(deps.db, payload.guildId, payload.sessionId, 'ready');
    await recordAudit(deps.db, {
      guildId: payload.guildId,
      actorId: payload.userId,
      actorType: 'system',
      action: payload.instruction ? 'builder.revised' : 'builder.generated',
      target: version.id,
      details: { model: result.model, attempts: result.attempts, usage: result.usage },
    });
    return version;
  } catch (e) {
    const message =
      e instanceof PlanGenerationError || e instanceof AIProviderError || e instanceof UserFacingError
        ? e.message
        : 'Plan generation failed unexpectedly.';
    // A revision failure keeps the previous plan usable.
    await setBuildSessionStatus(deps.db, payload.guildId, payload.sessionId, payload.baseVersionId ? 'ready' : 'failed', message);
    throw e;
  }
}

// ------------------------------------------------------------------ preview & confirm
export interface Preview {
  planVersionId: string;
  sessionId: string;
  version: number;
  mode: DiffOptions['mode'];
  guildName: string;
  plan: ServerPlan;
  validation: Pick<PlanValidationResult, 'issues' | 'downgrades' | 'blocking'>;
  change: Omit<ChangeSet, 'ops'> & { opCount: number };
  planHash: string;
  snapshotHash: string;
  /** Present only when the plan can be confirmed by this user. */
  confirmation: { token: string; expiresAt: number } | null;
  needsElevationAck: boolean;
  needsDestructiveAck: boolean;
  needsTypedConfirmation: boolean;
  blockers: string[];
}

interface Computed {
  version: NonNullable<Awaited<ReturnType<typeof getPlanVersion>>>;
  snapshot: GuildSnapshot;
  validated: PlanValidationResult;
  change: ReturnType<typeof diffPlan>;
  planHash: string;
  sHash: string;
}

async function compute(deps: BuilderDeps, guildId: string, planVersionId: string, mode: DiffOptions['mode']): Promise<Computed> {
  const version = await getPlanVersion(deps.db, guildId, planVersionId);
  if (!version) throw new NotFoundError('Plan not found.');
  const snapshot = await deps.fetchSnapshot(guildId);
  // Re-validate against the CURRENT server: permissions or community status may have changed.
  const validated = validatePlan(serverPlanSchema.parse(version.plan), snapshot);
  const change = diffPlan(validated.plan, snapshot, { mode });
  return { version, snapshot, validated, change, planHash: hashValue({ plan: validated.plan, mode }), sHash: snapshotHash(snapshot) };
}

async function blockersFor(deps: BuilderDeps, guildId: string, c: Computed, mode: DiffOptions['mode'], access: Access, ownerId: string, userId: string) {
  const blockers: string[] = [];
  if (c.validated.blocking) blockers.push(...c.validated.issues.filter((i) => i.level === 'error').map((i) => i.message));
  if (mode === 'sync') {
    const { settings } = await getSettings(deps.db, guildId);
    if (!settings.builder.allowWipe) blockers.push('Replace mode (which deletes channels and roles) is disabled. The server owner can enable it in Administrator settings.');
    if (userId !== ownerId) blockers.push('Only the server owner can apply a plan in replace mode.');
  }
  if (!can(access, { type: 'builder.apply', destructive: c.change.risk.destructive, elevation: c.change.risk.elevation })) {
    blockers.push(
      c.change.risk.elevation || c.change.risk.destructive
        ? 'This plan grants powerful permissions or deletes things, which needs Manage Server, Manage Roles and Manage Channels.'
        : 'You do not have permission to apply plans on this server.',
    );
  }
  const pending = await deps.db
    .select({ id: schema.executions.id })
    .from(schema.executions)
    .where(and(eq(schema.executions.guildId, guildId), inArray(schema.executions.status, ['queued', 'running'])))
    .limit(1);
  if (pending.length) blockers.push('Another change is still being applied to this server. Wait for it to finish.');
  return blockers;
}

export async function buildPreview(
  deps: BuilderDeps,
  input: { guildId: string; planVersionId: string; mode: DiffOptions['mode']; userId: string; access: Access; ownerId: string },
): Promise<Preview> {
  const c = await compute(deps, input.guildId, input.planVersionId, input.mode);
  const blockers = await blockersFor(deps, input.guildId, c, input.mode, input.access, input.ownerId, input.userId);
  let confirmation: Preview['confirmation'] = null;
  if (blockers.length === 0) {
    const signed = signConfirmation(
      {
        guildId: input.guildId,
        planId: c.version.id,
        planHash: c.planHash,
        snapshotHash: c.sHash,
        userId: input.userId,
        allowDestructive: c.change.risk.destructive,
        allowElevation: c.change.risk.elevation,
      },
      deps.secret,
    );
    confirmation = { token: signed.token, expiresAt: signed.claims.exp };
  }
  const { ops, mappings: _mappings, ...rest } = c.change;
  return {
    planVersionId: c.version.id,
    sessionId: c.version.sessionId,
    version: c.version.version,
    mode: input.mode,
    guildName: c.snapshot.name,
    plan: c.validated.plan,
    validation: { issues: c.validated.issues, downgrades: c.validated.downgrades, blocking: c.validated.blocking },
    change: { ...rest, opCount: ops.length },
    planHash: c.planHash,
    snapshotHash: c.sHash,
    confirmation,
    needsElevationAck: c.change.risk.elevation,
    needsDestructiveAck: c.change.risk.destructive,
    needsTypedConfirmation: input.mode === 'sync',
    blockers,
  };
}

export async function confirmPlan(
  deps: BuilderDeps,
  input: {
    guildId: string;
    planVersionId: string;
    mode: DiffOptions['mode'];
    userId: string;
    /** Must come from a FRESH access check. */
    access: Access;
    ownerId: string;
    token: string;
    acknowledgeElevation: boolean;
    acknowledgeDestructive: boolean;
    typedConfirmation?: string;
  },
) {
  const c = await compute(deps, input.guildId, input.planVersionId, input.mode);
  const check = verifyConfirmation(
    input.token,
    {
      guildId: input.guildId,
      planId: c.version.id,
      planHash: c.planHash,
      snapshotHash: c.sHash,
      userId: input.userId,
      needsDestructive: c.change.risk.destructive,
      needsElevation: c.change.risk.elevation,
    },
    deps.secret,
  );
  if (!check.ok) {
    throw new ConflictError(
      check.reason === 'expired'
        ? 'This confirmation expired. Review the preview again.'
        : (check.detail ?? 'This confirmation is no longer valid. Review the preview again.'),
      'confirmation_invalid',
    );
  }
  if (c.change.risk.elevation && !input.acknowledgeElevation) throw new UserFacingError('Confirm the permission changes explicitly.', 'ack_required');
  if (c.change.risk.destructive && !input.acknowledgeDestructive) throw new UserFacingError('Confirm the deletions explicitly.', 'ack_required');
  if (input.mode === 'sync' && input.typedConfirmation?.trim() !== c.snapshot.name) {
    throw new UserFacingError('Type the exact server name to confirm replace mode.', 'typed_confirmation');
  }
  const blockers = await blockersFor(deps, input.guildId, c, input.mode, input.access, input.ownerId, input.userId);
  if (blockers.length) throw new ForbiddenError(blockers[0]);

  const { settings } = await getSettings(deps.db, input.guildId);
  const snap = await saveSnapshot(deps.db, {
    guildId: input.guildId,
    reason: 'pre-execution',
    snapshot: c.snapshot,
    hash: c.sHash,
    settings,
    label: `Before applying plan v${c.version.version}`,
    createdBy: input.userId,
  });
  const execution = await createExecution(deps.db, {
    guildId: input.guildId,
    kind: 'apply',
    planVersionId: c.version.id,
    mode: input.mode,
    ops: c.change.ops,
    initialMappings: c.change.mappings,
    snapshotId: snap.id,
    expectedSnapshotHash: c.sHash,
    risk: c.change.risk,
    confirmedBy: input.userId,
    confirmationNonce: check.claims.nonce,
    progressTotal: c.change.ops.length,
  });
  if (!execution) throw new ConflictError('This confirmation was already used.', 'confirmation_replayed');
  await enqueueJob(deps.db, JOB_PLAN_EXECUTE, { guildId: input.guildId, executionId: execution.id }, {
    guildId: input.guildId,
    dedupeKey: `exec:${execution.id}`,
    maxAttempts: 10,
  });
  await recordAudit(deps.db, {
    guildId: input.guildId,
    actorId: input.userId,
    actorType: 'user',
    action: 'builder.confirm',
    target: execution.id,
    details: { planVersionId: c.version.id, mode: input.mode, counts: c.change.counts, risk: c.change.risk },
  });
  return execution;
}

// ------------------------------------------------------------------ rollback
export async function previewRollback(deps: BuilderDeps, guildId: string, executionId: string) {
  const exec = await getExecution(deps.db, guildId, executionId);
  if (!exec) throw new NotFoundError('Change not found.');
  if (exec.kind !== 'apply') throw new UserFacingError('Only applied plans can be rolled back.');
  if (exec.status === 'queued' || exec.status === 'running') throw new ConflictError('Wait for this change to finish (or cancel it) first.');
  const states = new Map((await getOpStates(deps.db, executionId)).map((s) => [s.opId, s]));
  const executed = (exec.ops as Op[]).map((op) => {
    const s = states.get(op.id);
    return { op, state: { status: (s?.status ?? 'pending') as 'done', ...(s?.result ? { result: s.result as Record<string, unknown> } : {}) } };
  });
  return { exec, ...buildRollbackOps(executed) };
}

export async function requestRollback(
  deps: BuilderDeps,
  input: { guildId: string; executionId: string; userId: string; access: Access },
) {
  // Rollback deletes the resources a plan created, so it needs destructive-level rights.
  if (!can(input.access, { type: 'builder.apply', destructive: true, elevation: false })) throw new ForbiddenError();
  const { exec, ops, irreversible } = await previewRollback(deps, input.guildId, input.executionId);
  if (ops.length === 0) throw new UserFacingError('There is nothing to roll back.');
  const snapshot = await deps.fetchSnapshot(input.guildId);
  const { settings } = await getSettings(deps.db, input.guildId);
  const snap = await saveSnapshot(deps.db, {
    guildId: input.guildId,
    reason: 'pre-execution',
    snapshot,
    hash: snapshotHash(snapshot),
    settings,
    label: 'Before rollback',
    createdBy: input.userId,
  });
  const rollback = await createExecution(deps.db, {
    guildId: input.guildId,
    kind: 'rollback',
    parentExecutionId: exec.id,
    mode: 'rollback',
    ops,
    initialMappings: {},
    snapshotId: snap.id,
    expectedSnapshotHash: snapshotHash(snapshot),
    irreversible,
    confirmedBy: input.userId,
    confirmationNonce: `rollback:${exec.id}:${randomToken(8)}`,
    progressTotal: ops.length,
  });
  if (!rollback) throw new ConflictError('Could not start the rollback.');
  await enqueueJob(deps.db, JOB_PLAN_EXECUTE, { guildId: input.guildId, executionId: rollback.id }, {
    guildId: input.guildId,
    dedupeKey: `exec:${rollback.id}`,
    maxAttempts: 10,
  });
  await recordAudit(deps.db, {
    guildId: input.guildId,
    actorId: input.userId,
    actorType: 'user',
    action: 'builder.rollback',
    target: rollback.id,
    details: { of: exec.id, ops: ops.length, irreversible },
  });
  return rollback;
}
