import type { REST } from '@discordjs/rest';
import {
  clearInteraction,
  getBuildSession,
  listCustomCommands,
  recordAudit,
  setCustomCommandDiscordId,
  type Database,
  type JobRow,
} from '@botcooks/database';
import { Routes, type APIApplicationCommand } from 'discord-api-types/v10';
import { dashboardUrl, editInteractionReply, planFailedMessage, planReadyMessage } from '@botcooks/discord';
import { decryptSecret, validatePlan } from '@botcooks/security';
import { BUILTIN_COMMAND_NAMES, serverPlanSchema, type GuildSnapshot, type Logger } from '@botcooks/shared';
import {
  JOB_PLAN_EXECUTE,
  JOB_PLAN_GENERATE,
  runExecution,
  runGeneration,
  type BuilderDeps,
  type GeneratePayload,
} from '@botcooks/services';
import { diffPlan, validateGraph, type DiscordWriter } from '@botcooks/workflows';
import type { JobHandler } from './runner';

export interface WorkerContext {
  db: Database;
  rest: REST;
  log: Logger;
  workerId: string;
  secret: string;
  applicationId: string;
  publicUrl: string | undefined;
  builder: BuilderDeps;
  writerFor: (guildId: string) => DiscordWriter;
  fetchSnapshot: (guildId: string) => Promise<GuildSnapshot>;
}

interface StoredInteraction {
  token: string;
  expiresAt: number;
}

/** Edits the /build-server reply, if its interaction token is still valid (15 minutes). */
async function notifyInteraction(ctx: WorkerContext, guildId: string, sessionId: string, body: unknown) {
  const session = await getBuildSession(ctx.db, guildId, sessionId);
  if (!session?.interactionEnc) return;
  try {
    const stored = JSON.parse(decryptSecret(session.interactionEnc, ctx.secret)) as StoredInteraction;
    if (stored.expiresAt > Date.now()) await editInteractionReply(ctx.rest, ctx.applicationId, stored.token, body);
  } catch (e) {
    ctx.log.warn('could not update interaction reply', { error: e, sessionId });
  } finally {
    await clearInteraction(ctx.db, guildId, sessionId);
  }
}

export const JOB_COMMANDS_SYNC = 'commands.sync';

const OPTION_TYPE = { string: 3, integer: 4, user: 6 } as const;

/**
 * Syncs enabled visual-builder commands to Discord as guild commands. Uses individual
 * create/edit/delete calls (never a bulk overwrite) so built-in commands registered to a dev
 * guild are left untouched. Names that clash with built-ins are rejected at save time.
 */
async function syncCustomCommands(ctx: WorkerContext, guildId: string) {
  const commands = await listCustomCommands(ctx.db, guildId);
  const existing = (await ctx.rest.get(Routes.applicationGuildCommands(ctx.applicationId, guildId))) as APIApplicationCommand[];
  const byId = new Map(existing.map((c) => [c.id, c]));
  const errors: string[] = [];
  for (const cmd of commands) {
    const v = validateGraph(cmd.graph, 'command');
    const wanted = cmd.enabled && v.ok;
    const remote = cmd.discordCommandId ? byId.get(cmd.discordCommandId) : undefined;
    if (!wanted) {
      if (remote) await ctx.rest.delete(Routes.applicationGuildCommand(ctx.applicationId, guildId, remote.id)).catch(() => undefined);
      if (cmd.discordCommandId) await setCustomCommandDiscordId(ctx.db, guildId, cmd.id, null);
      continue;
    }
    const trigger = v.trigger.data as { name: string; description: string; options: Array<{ name: string; description: string; type: keyof typeof OPTION_TYPE; required: boolean }> };
    const body = {
      name: cmd.name,
      description: trigger.description,
      type: 1,
      options: trigger.options.map((o) => ({ name: o.name, description: o.description, type: OPTION_TYPE[o.type], required: o.required })),
    };
    try {
      if (remote) {
        await ctx.rest.patch(Routes.applicationGuildCommand(ctx.applicationId, guildId, remote.id), { body });
      } else {
        const created = (await ctx.rest.post(Routes.applicationGuildCommands(ctx.applicationId, guildId), { body })) as APIApplicationCommand;
        await setCustomCommandDiscordId(ctx.db, guildId, cmd.id, created.id);
      }
    } catch (e) {
      errors.push(`${cmd.name}: ${(e as Error).message}`);
    }
  }
  // Remove remote custom commands whose database row was deleted (built-ins are never touched).
  const known = new Set(commands.map((c) => c.discordCommandId).filter(Boolean));
  const knownNames = new Set(commands.map((c) => c.name));
  for (const remote of existing) {
    if (!known.has(remote.id) && !knownNames.has(remote.name) && !BUILTIN_COMMAND_NAMES.has(remote.name)) {
      await ctx.rest.delete(Routes.applicationGuildCommand(ctx.applicationId, guildId, remote.id)).catch(() => undefined);
    }
  }
  await recordAudit(ctx.db, { guildId, actorId: null, actorType: 'system', action: 'commands.synced', details: { count: commands.filter((c) => c.enabled).length, errors } });
}

export function createHandlers(ctx: WorkerContext): Record<string, JobHandler> {
  return {
    [JOB_PLAN_GENERATE]: async (job: JobRow) => {
      const payload = job.payload as GeneratePayload;
      try {
        const version = await runGeneration(ctx.builder, payload);
        if (!version) return { kind: 'done' };
        const snapshot = await ctx.fetchSnapshot(payload.guildId);
        const validated = validatePlan(serverPlanSchema.parse(version.plan), snapshot);
        const change = diffPlan(validated.plan, snapshot, { mode: 'additive' });
        await notifyInteraction(
          ctx,
          payload.guildId,
          payload.sessionId,
          planReadyMessage({
            summary: validated.plan.summary,
            version: version.version,
            planVersionId: version.id,
            sessionId: payload.sessionId,
            counts: change.counts,
            warnings: [...validated.issues.filter((i) => i.level === 'warning').map((i) => i.message), ...change.warnings],
            downgrades: validated.downgrades.length,
            elevation: change.risk.elevation,
            url: dashboardUrl(ctx.publicUrl, `/dashboard/${payload.guildId}/builder?session=${payload.sessionId}`),
          }),
        );
        return { kind: 'done' };
      } catch (e) {
        await notifyInteraction(ctx, payload.guildId, payload.sessionId, planFailedMessage((e as Error).message ?? 'Generation failed.'));
        // Generation failures are reported to the user; retrying silently would double AI cost.
        return { kind: 'fail', error: (e as Error).message ?? 'generation failed' };
      }
    },

    [JOB_COMMANDS_SYNC]: async (job) => {
      await syncCustomCommands(ctx, (job.payload as { guildId: string }).guildId);
      return { kind: 'done' };
    },

    [JOB_PLAN_EXECUTE]: async (job, { heartbeat }) => {
      const payload = job.payload as { guildId: string; executionId: string };
      const outcome = await runExecution(
        { db: ctx.db, workerId: ctx.workerId, writerFor: ctx.writerFor, fetchSnapshot: ctx.fetchSnapshot, heartbeat },
        payload,
      );
      if (outcome.kind === 'busy') return { kind: 'retry', delayMs: 10_000, consumeAttempt: false };
      if (outcome.kind === 'skipped') ctx.log.info('execution skipped', { reason: outcome.reason, executionId: payload.executionId });
      return { kind: 'done' };
    },
  };
}
