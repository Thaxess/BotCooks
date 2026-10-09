import {
  acquireGuildLock,
  getCustomCommandByName,
  getExecutionById,
  getMappings,
  getOpStates,
  getSnapshot,
  isExecutionCancelRequested,
  mutateSettings,
  recordAudit,
  registerSelfRolePanel,
  releaseGuildLock,
  renewGuildLock,
  saveSettings,
  getSettings,
  setBuildSessionStatus,
  setMapping,
  setOpState,
  updateExecution,
  upsertCustomCommand,
  getPlanVersion,
  type Database,
  type ExecutionRow,
} from '@botcooks/database';
import { parseGuildSettings, snapshotHash, type GuildSnapshot } from '@botcooks/shared';
import {
  executeOps,
  simpleReplyGraph,
  type DiscordWriter,
  type ExecutionReport,
  type ExecutionStore,
  type Op,
  type OpState,
  type ResolvedConfig,
} from '@botcooks/workflows';
import { mergePlanConfig } from './plan-config';

const LOCK_TTL_MS = 5 * 60_000;

export class DbExecutionStore implements ExecutionStore {
  private states = new Map<string, OpState>();
  private mappings = new Map<string, string>();
  private lastCancelCheck = 0;
  private cancelled = false;
  private lastProgressWrite = 0;

  constructor(
    private readonly db: Database,
    private readonly exec: ExecutionRow,
    private readonly onHeartbeat: () => Promise<void>,
  ) {}

  async load() {
    for (const [ref, id] of Object.entries((this.exec.initialMappings ?? {}) as Record<string, string>)) this.mappings.set(ref, id);
    for (const m of await getMappings(this.db, this.exec.id)) this.mappings.set(m.ref, m.discordId);
    for (const s of await getOpStates(this.db, this.exec.id)) {
      this.states.set(s.opId, {
        status: s.status as OpState['status'],
        ...(s.result ? { result: s.result as Record<string, unknown> } : {}),
        ...(s.error ? { error: s.error } : {}),
      });
    }
  }

  async getOpState(opId: string) {
    return this.states.get(opId);
  }
  async setOpState(opId: string, state: OpState) {
    this.states.set(opId, state);
    await setOpState(this.db, this.exec.id, opId, { status: state.status, result: state.result ?? null, error: state.error ?? null });
  }
  getMapping(ref: string) {
    return this.mappings.get(ref);
  }
  async setMapping(ref: string, discordId: string) {
    this.mappings.set(ref, discordId);
    await setMapping(this.db, this.exec.id, this.exec.guildId, ref, discordId);
  }
  isDiscordIdMapped(discordId: string) {
    for (const v of this.mappings.values()) if (v === discordId) return true;
    return false;
  }
  async isCancelled() {
    if (this.cancelled) return true;
    if (Date.now() - this.lastCancelCheck > 1500) {
      this.lastCancelCheck = Date.now();
      this.cancelled = await isExecutionCancelRequested(this.db, this.exec.id);
    }
    return this.cancelled;
  }
  async applyConfig(resolved: ResolvedConfig) {
    const { before } = await mutateSettings(this.db, this.exec.guildId, this.exec.confirmedBy, (s) =>
      mergePlanConfig(s, resolved.config, resolved.resolve),
    );
    // Suggested commands are created DISABLED so a human reviews them before they go live.
    for (const cmd of resolved.config.suggestedCommands) {
      if (await getCustomCommandByName(this.db, this.exec.guildId, cmd.name)) continue;
      await upsertCustomCommand(this.db, {
        guildId: this.exec.guildId,
        name: cmd.name,
        description: cmd.description,
        graph: simpleReplyGraph(cmd.name, cmd.description, cmd.response),
        enabled: false,
        createdBy: this.exec.confirmedBy,
      });
    }
    return { previous: before };
  }
  async restoreConfig(previous: unknown) {
    if (!previous) return;
    const parsed = parseGuildSettings(previous);
    const { version } = await getSettings(this.db, this.exec.guildId);
    await saveSettings(this.db, this.exec.guildId, parsed, version, this.exec.confirmedBy);
  }
  async registerSelfRolePanel(input: { channelId: string; messageId: string; roleIds: string[]; title: string }) {
    await registerSelfRolePanel(this.db, { guildId: this.exec.guildId, ...input });
    await mutateSettings(this.db, this.exec.guildId, null, (s) => void (s.features.selfroles = true));
  }
  async progress(done: number, total: number, label: string) {
    await this.onHeartbeat();
    if (Date.now() - this.lastProgressWrite < 750 && done !== total) return;
    this.lastProgressWrite = Date.now();
    await updateExecution(this.db, this.exec.id, { progressDone: done, progressTotal: total, progressLabel: label });
  }
}

export interface RunExecutionDeps {
  db: Database;
  workerId: string;
  writerFor: (guildId: string) => DiscordWriter;
  fetchSnapshot: (guildId: string) => Promise<GuildSnapshot>;
  /** Called periodically so the job lease stays alive during long executions. */
  heartbeat?: () => Promise<void>;
}

export type RunExecutionOutcome = { kind: 'finished'; report: ExecutionReport } | { kind: 'busy' } | { kind: 'skipped'; reason: string };

/**
 * Runs (or resumes) an execution. Returns `busy` if another execution holds the guild lock,
 * so the job can be retried later rather than racing it.
 */
export async function runExecution(deps: RunExecutionDeps, payload: { guildId: string; executionId: string }): Promise<RunExecutionOutcome> {
  const exec = await getExecutionById(deps.db, payload.executionId);
  if (!exec || exec.guildId !== payload.guildId) return { kind: 'skipped', reason: 'execution not found for guild' };
  if (!['queued', 'running'].includes(exec.status)) return { kind: 'skipped', reason: `already ${exec.status}` };

  const holder = `${deps.workerId}:${exec.id}`;
  if (!(await acquireGuildLock(deps.db, exec.guildId, holder, `execution ${exec.id}`, LOCK_TTL_MS))) return { kind: 'busy' };

  try {
    if (exec.cancelRequested && exec.status === 'queued') {
      await updateExecution(deps.db, exec.id, { status: 'cancelled', finishedAt: new Date(), report: { status: 'cancelled', done: 0, failed: 0, skipped: 0, cancelled: 0, errors: [] } });
      return { kind: 'skipped', reason: 'cancelled before start' };
    }
    if (exec.status === 'queued' && exec.expectedSnapshotHash) {
      // The confirmation was for a specific server state. If anything changed since, stop.
      const current = await deps.fetchSnapshot(exec.guildId);
      if (snapshotHash(current) !== exec.expectedSnapshotHash) {
        const report: ExecutionReport = {
          status: 'failed',
          done: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
          errors: [{ opId: '-', message: 'The server changed after this plan was confirmed. Nothing was applied; review the preview again.' }],
        };
        await updateExecution(deps.db, exec.id, { status: 'failed', report, finishedAt: new Date() });
        await recordAudit(deps.db, { guildId: exec.guildId, actorId: null, actorType: 'system', action: 'builder.execution_aborted', target: exec.id, details: { reason: 'server_changed' } });
        return { kind: 'finished', report };
      }
    }
    if (exec.status === 'queued') await updateExecution(deps.db, exec.id, { status: 'running', startedAt: new Date() });

    const snap = exec.snapshotId ? await getSnapshot(deps.db, exec.guildId, exec.snapshotId) : undefined;
    const pre = (snap?.snapshot ?? null) as GuildSnapshot | null;
    const preExistingIds = new Set<string>(pre ? [...pre.roles.map((r) => r.id), ...pre.channels.map((c) => c.id)] : []);

    let lastRenew = Date.now();
    const store = new DbExecutionStore(deps.db, exec, async () => {
      if (Date.now() - lastRenew < 30_000) return;
      lastRenew = Date.now();
      await renewGuildLock(deps.db, exec.guildId, holder, LOCK_TTL_MS);
      await deps.heartbeat?.();
    });
    await store.load();

    const report = await executeOps(exec.ops as Op[], {
      guildId: exec.guildId,
      preExistingIds,
      writer: deps.writerFor(exec.guildId),
      store,
      reason: exec.kind === 'rollback' ? `BotCooks rollback ${exec.id.slice(0, 8)}` : `BotCooks plan ${exec.id.slice(0, 8)}`,
      executionId: exec.id.replace(/-/g, ''),
    });

    await updateExecution(deps.db, exec.id, { status: report.status, report, finishedAt: new Date(), progressDone: report.done, progressLabel: 'Finished' });
    if (exec.kind === 'apply' && exec.planVersionId && (report.status === 'completed' || report.status === 'completed_with_errors')) {
      const version = await getPlanVersion(deps.db, exec.guildId, exec.planVersionId);
      if (version) await setBuildSessionStatus(deps.db, exec.guildId, version.sessionId, 'applied');
    }
    await recordAudit(deps.db, {
      guildId: exec.guildId,
      actorId: exec.confirmedBy,
      actorType: 'system',
      action: exec.kind === 'rollback' ? 'builder.rollback_finished' : 'builder.execution_finished',
      target: exec.id,
      details: { status: report.status, done: report.done, failed: report.failed, skipped: report.skipped, errors: report.errors.slice(0, 20) },
    });
    return { kind: 'finished', report };
  } finally {
    await releaseGuildLock(deps.db, exec.guildId, holder);
  }
}
