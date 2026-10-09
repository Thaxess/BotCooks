import type { SnapshotChannel, SnapshotRole } from '@botcooks/shared';
import type { ChannelData, EmbedPayload, Op, PlanConfigPayload, RoleData, SelfRolePanelPayload } from './changeset';

/** Overwrite with Discord IDs, ready for the REST API. type 0 = role, 1 = member. */
export interface ResolvedOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface ResolvedChannelData extends Omit<ChannelData, 'parent' | 'overwrites'> {
  parentId: string | null;
  overwrites: ResolvedOverwrite[];
}

export interface MessageBody {
  embeds?: Array<EmbedPayload>;
  components?: unknown[];
  /** Discord de-duplicates messages with the same nonce when enforce_nonce is set. */
  nonce?: string;
}

/** The only surface through which plans touch Discord. Implemented with @discordjs/rest in the worker. */
export interface DiscordWriter {
  createRole(data: RoleData, reason: string): Promise<{ id: string }>;
  editRole(roleId: string, data: RoleData, reason: string): Promise<void>;
  deleteRole(roleId: string, reason: string): Promise<void>;
  setRolePositions(positions: Array<{ id: string; position: number }>, reason: string): Promise<void>;
  createChannel(data: ResolvedChannelData, reason: string): Promise<{ id: string }>;
  editChannel(channelId: string, data: ResolvedChannelData, reason: string): Promise<void>;
  deleteChannel(channelId: string, reason: string): Promise<void>;
  sendMessage(channelId: string, body: MessageBody): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string, reason: string): Promise<void>;
  listRoles(): Promise<SnapshotRole[]>;
  listChannels(): Promise<SnapshotChannel[]>;
  /** Returns the bot's highest role position, fetched fresh. */
  botHighestRolePosition(): Promise<number>;
}

export type OpStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface OpState {
  status: OpStatus;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ResolvedConfig {
  config: PlanConfigPayload;
  /** refs that could not be resolved (dependency failed) and were dropped */
  dropped: string[];
  resolve: (ref: string | undefined) => string | undefined;
}

/** Persistence used by the executor. The worker backs this with PostgreSQL. */
export interface ExecutionStore {
  getOpState(opId: string): Promise<OpState | undefined>;
  setOpState(opId: string, state: OpState): Promise<void>;
  getMapping(ref: string): string | undefined;
  setMapping(ref: string, discordId: string): Promise<void>;
  /** True if some ref in this execution already maps to `discordId` (prevents double adoption). */
  isDiscordIdMapped(discordId: string): boolean;
  isCancelled(): Promise<boolean>;
  /** Writes feature settings; returns the previous settings so they can be restored. */
  applyConfig(resolved: ResolvedConfig): Promise<{ previous: unknown }>;
  restoreConfig(previous: unknown): Promise<void>;
  registerSelfRolePanel(input: { channelId: string; messageId: string; roleIds: string[]; title: string }): Promise<void>;
  progress(done: number, total: number, currentLabel: string): Promise<void>;
}

export interface ExecuteContext {
  guildId: string;
  /** IDs of resources that existed before execution started (from the pre-change snapshot). */
  preExistingIds: ReadonlySet<string>;
  writer: DiscordWriter;
  store: ExecutionStore;
  reason: string;
  /** Stable per-execution identifier used for message nonces. */
  executionId: string;
}

export interface ExecutionReport {
  status: 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  done: number;
  failed: number;
  skipped: number;
  cancelled: number;
  errors: Array<{ opId: string; message: string }>;
}

export class DependencyError extends Error {
  constructor(ref: string) {
    super(`Depends on ${ref}, which was not created`);
    this.name = 'DependencyError';
  }
}

export class FatalExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalExecutionError';
  }
}

interface DiscordLikeError {
  status?: number;
  code?: number | string;
  message?: string;
}

const isNotFound = (e: unknown) => {
  const err = e as DiscordLikeError;
  return err?.status === 404 || err?.code === 10003 || err?.code === 10011 || err?.code === 10008;
};

/** Errors after which continuing is pointless or unsafe. */
const isFatal = (e: unknown) => {
  const err = e as DiscordLikeError;
  return err?.status === 401 || err?.code === 10004 /* unknown guild */ || err instanceof FatalExecutionError;
};

export function describeError(e: unknown): string {
  const err = e as DiscordLikeError;
  if (err?.code === 50013) return 'Missing permissions (check BotCooks role position and permissions)';
  if (err?.code === 50001) return 'Missing access to that channel';
  if (err?.code === 30005) return 'Maximum number of roles reached';
  if (err?.code === 30013) return 'Maximum number of channels reached';
  if (err?.status === 429) return 'Rate limited by Discord';
  return err?.message ? String(err.message).slice(0, 300) : 'Unknown error';
}

/**
 * Executes ops in order. Safe to call repeatedly for the same execution: finished ops are
 * skipped, ops interrupted mid-flight are recovered by looking for the resource they created.
 */
export async function executeOps(ops: Op[], ctx: ExecuteContext): Promise<ExecutionReport> {
  const report: ExecutionReport = { status: 'completed', done: 0, failed: 0, skipped: 0, cancelled: 0, errors: [] };
  let index = 0;
  for (const op of ops) {
    index++;
    const state = await ctx.store.getOpState(op.id);
    if (state?.status === 'done') {
      report.done++;
      continue;
    }
    if (state?.status === 'skipped' || state?.status === 'failed') {
      // Terminal states from an earlier attempt are kept, not retried, to keep reports honest.
      report[state.status === 'failed' ? 'failed' : 'skipped']++;
      if (state.error) report.errors.push({ opId: op.id, message: state.error });
      continue;
    }
    if (await ctx.store.isCancelled()) {
      await ctx.store.setOpState(op.id, { status: 'cancelled' });
      report.cancelled++;
      continue;
    }
    await ctx.store.progress(index - 1, ops.length, opLabel(op));
    const interrupted = state?.status === 'running';
    await ctx.store.setOpState(op.id, { status: 'running' });
    try {
      const result = await runOp(op, ctx, interrupted);
      await ctx.store.setOpState(op.id, { status: 'done', result });
      report.done++;
    } catch (e) {
      if (e instanceof DependencyError) {
        await ctx.store.setOpState(op.id, { status: 'skipped', error: e.message });
        report.skipped++;
        report.errors.push({ opId: op.id, message: e.message });
        continue;
      }
      const message = describeError(e);
      await ctx.store.setOpState(op.id, { status: 'failed', error: message });
      report.failed++;
      report.errors.push({ opId: op.id, message });
      if (isFatal(e)) {
        for (const rest of ops.slice(index)) {
          const s = await ctx.store.getOpState(rest.id);
          if (!s || s.status === 'pending') {
            await ctx.store.setOpState(rest.id, { status: 'cancelled', error: 'Stopped after a fatal error' });
            report.cancelled++;
          }
        }
        report.status = 'failed';
        await ctx.store.progress(ops.length, ops.length, 'Stopped');
        return report;
      }
    }
  }
  await ctx.store.progress(ops.length, ops.length, 'Finished');
  if (report.cancelled > 0) report.status = 'cancelled';
  else if (report.failed > 0 || report.skipped > 0) report.status = report.done > 0 ? 'completed_with_errors' : 'failed';
  return report;
}

export function opLabel(op: Op): string {
  switch (op.kind) {
    case 'role.create':
      return `Creating role ${op.data.name}`;
    case 'role.update':
      return `Updating role ${op.before.name}`;
    case 'role.delete':
      return `Deleting role ${op.before.name}`;
    case 'role.reorder':
      return 'Ordering roles';
    case 'channel.create':
      return `Creating ${op.data.type === 4 ? 'category' : 'channel'} ${op.data.name}`;
    case 'channel.update':
      return `Updating ${op.before.name}`;
    case 'channel.delete':
      return `Deleting ${op.before.name}`;
    case 'message.send':
      return `Posting ${op.purpose} message`;
    case 'selfroles.panel':
      return `Posting role panel ${op.panel.title}`;
    case 'config.apply':
      return 'Saving feature settings';
    case 'message.delete':
      return 'Removing a posted message';
    case 'config.restore':
      return 'Restoring previous feature settings';
  }
}

function resolver(ctx: ExecuteContext) {
  return (ref: string): string | undefined => {
    if (ref === 'everyone') return ctx.guildId;
    if (ref.startsWith('existing:')) return ref.slice(9);
    if (ref.startsWith('member:')) return ref.slice(7);
    return ctx.store.getMapping(ref);
  };
}

function resolveRequired(ctx: ExecuteContext, ref: string): string {
  const id = resolver(ctx)(ref);
  if (!id) throw new DependencyError(ref);
  return id;
}

function resolveChannelData(data: ChannelData, ctx: ExecuteContext): ResolvedChannelData {
  const { parent, overwrites, ...rest } = data;
  return {
    ...rest,
    parentId: parent ? resolveRequired(ctx, parent) : null,
    overwrites: overwrites.map((ow) => ({
      id: resolveRequired(ctx, ow.target),
      type: ow.target.startsWith('member:') ? 1 : 0,
      allow: ow.allow,
      deny: ow.deny,
    })),
  };
}

async function runOp(op: Op, ctx: ExecuteContext, interrupted: boolean): Promise<Record<string, unknown>> {
  const { writer, store, reason } = ctx;
  switch (op.kind) {
    case 'role.create': {
      if (interrupted) {
        const adopted = (await writer.listRoles()).find(
          (r) => r.name === op.data.name && !ctx.preExistingIds.has(r.id) && !store.isDiscordIdMapped(r.id),
        );
        if (adopted) {
          await store.setMapping(op.ref, adopted.id);
          return { id: adopted.id, recovered: true };
        }
      }
      const { id } = await writer.createRole(op.data, reason);
      await store.setMapping(op.ref, id);
      return { id };
    }
    case 'role.update':
      await writer.editRole(op.roleId, op.after, reason);
      return { id: op.roleId };
    case 'role.delete':
      try {
        await writer.deleteRole(op.roleId, reason);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      return { id: op.roleId };
    case 'role.reorder': {
      const top = await writer.botHighestRolePosition();
      const ids = op.refs.map((r) => resolver(ctx)(r)).filter((x): x is string => Boolean(x));
      if (ids.length === 0 || top <= 1) return { reordered: 0 };
      // Highest plan role sits directly beneath BotCooks; Discord shifts the others down.
      const positions = ids.map((id, i) => ({ id, position: Math.max(1, top - 1 - i) }));
      await writer.setRolePositions(positions, reason);
      return { reordered: ids.length };
    }
    case 'channel.create': {
      const data = resolveChannelData(op.data, ctx);
      if (interrupted) {
        const adopted = (await writer.listChannels()).find(
          (c) =>
            c.name === op.data.name &&
            c.type === op.data.type &&
            (c.parentId ?? null) === data.parentId &&
            !ctx.preExistingIds.has(c.id) &&
            !store.isDiscordIdMapped(c.id),
        );
        if (adopted) {
          await store.setMapping(op.ref, adopted.id);
          return { id: adopted.id, recovered: true };
        }
      }
      const { id } = await writer.createChannel(data, reason);
      await store.setMapping(op.ref, id);
      return { id };
    }
    case 'channel.update':
      await writer.editChannel(op.channelId, resolveChannelData(op.after, ctx), reason);
      return { id: op.channelId };
    case 'channel.delete':
      try {
        await writer.deleteChannel(op.channelId, reason);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      return { id: op.channelId };
    case 'message.send': {
      const channelId = resolveRequired(ctx, op.channel);
      const { id } = await writer.sendMessage(channelId, { embeds: [op.embed], nonce: nonceFor(ctx, op.id) });
      return { channelId, messageId: id };
    }
    case 'selfroles.panel': {
      const channelId = resolveRequired(ctx, op.channel);
      const roles = op.panel.roles
        .map((r) => ({ ...r, roleId: resolver(ctx)(r.role) }))
        .filter((r): r is typeof r & { roleId: string } => Boolean(r.roleId));
      if (roles.length === 0) throw new DependencyError(op.panel.roles[0]?.role ?? 'roles');
      const { id } = await writer.sendMessage(channelId, {
        embeds: [{ title: op.panel.title, description: op.panel.description ?? 'Pick the roles you want.', color: 0xf97316 }],
        components: selfRoleComponents(op.panel, roles),
        nonce: nonceFor(ctx, op.id),
      });
      await store.registerSelfRolePanel({ channelId, messageId: id, roleIds: roles.map((r) => r.roleId), title: op.panel.title });
      return { channelId, messageId: id };
    }
    case 'config.apply': {
      const resolve = resolver(ctx);
      const dropped: string[] = [];
      const r = (ref: string | undefined) => {
        if (!ref) return undefined;
        const id = resolve(ref);
        if (!id) dropped.push(ref);
        return id;
      };
      const { previous } = await store.applyConfig({ config: op.config, dropped, resolve: r });
      return { previous: previous as Record<string, unknown>, dropped };
    }
    case 'message.delete':
      try {
        await writer.deleteMessage(op.channelId, op.messageId, reason);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      return {};
    case 'config.restore':
      await store.restoreConfig(op.previous);
      return {};
  }
}

/** Discord nonces are limited to 25 characters. */
function nonceFor(ctx: ExecuteContext, opId: string): string {
  let h = 0;
  for (const ch of `${ctx.executionId}:${opId}`) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return `bc${ctx.executionId.slice(0, 12)}${(h >>> 0).toString(36)}`.slice(0, 25);
}

export const SELF_ROLE_CUSTOM_ID = 'bc:sr';

export function selfRoleComponents(panel: SelfRolePanelPayload, roles: Array<{ roleId: string; label: string; emoji?: string; description?: string }>) {
  if (panel.style === 'select') {
    return [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${SELF_ROLE_CUSTOM_ID}:select`,
            placeholder: 'Choose your roles',
            min_values: 0,
            max_values: roles.length,
            options: roles.map((r) => ({
              label: r.label.slice(0, 100),
              value: r.roleId,
              ...(r.description ? { description: r.description.slice(0, 100) } : {}),
              ...(r.emoji && !/^[\w-]+$/.test(r.emoji) ? { emoji: { name: r.emoji } } : {}),
            })),
          },
        ],
      },
    ];
  }
  const rows: unknown[] = [];
  for (let i = 0; i < roles.length; i += 5) {
    rows.push({
      type: 1,
      components: roles.slice(i, i + 5).map((r) => ({
        type: 2,
        style: 2,
        custom_id: `${SELF_ROLE_CUSTOM_ID}:${r.roleId}`,
        label: r.label.slice(0, 80),
        ...(r.emoji && !/^[\w-]+$/.test(r.emoji) ? { emoji: { name: r.emoji } } : {}),
      })),
    });
  }
  return rows;
}

/**
 * Builds best-effort inverse ops for a finished (or partially finished) execution.
 * What cannot be undone is returned in `irreversible` so the UI can say so plainly.
 */
export function buildRollbackOps(
  executed: Array<{ op: Op; state: OpState }>,
): { ops: Op[]; irreversible: string[] } {
  const ops: Op[] = [];
  const irreversible: string[] = [];
  for (const { op, state } of [...executed].reverse()) {
    if (state.status !== 'done') continue;
    const result = state.result ?? {};
    switch (op.kind) {
      case 'role.create':
        if (typeof result.id === 'string') {
          ops.push({ kind: 'role.delete', id: `rb:${op.id}`, roleId: result.id, before: op.data });
        }
        break;
      case 'role.update':
        ops.push({ kind: 'role.update', id: `rb:${op.id}`, ref: op.ref, roleId: op.roleId, before: op.after, after: op.before });
        break;
      case 'role.delete':
        ops.push({ kind: 'role.create', id: `rb:${op.id}`, ref: `restored:${op.roleId}`, data: op.before });
        irreversible.push(`Role "${op.before.name}" is recreated with a new ID; members must be given it again.`);
        break;
      case 'role.reorder':
        irreversible.push('Role order changes are not reverted.');
        break;
      case 'channel.create':
        if (typeof result.id === 'string') {
          ops.push({ kind: 'channel.delete', id: `rb:${op.id}`, channelId: result.id, before: op.data });
          irreversible.push(`Messages posted in "${op.data.name}" since it was created will be lost when it is removed.`);
        }
        break;
      case 'channel.update':
        ops.push({ kind: 'channel.update', id: `rb:${op.id}`, ref: op.ref, channelId: op.channelId, before: op.after, after: op.before });
        break;
      case 'channel.delete':
        ops.push({ kind: 'channel.create', id: `rb:${op.id}`, ref: `restored:${op.channelId}`, data: op.before });
        irreversible.push(`"${op.before.name}" is recreated empty: its message history and original ID cannot be restored.`);
        break;
      case 'message.send':
      case 'selfroles.panel':
        if (typeof result.channelId === 'string' && typeof result.messageId === 'string') {
          ops.push({ kind: 'message.delete', id: `rb:${op.id}`, channelId: result.channelId, messageId: result.messageId });
        }
        break;
      case 'config.apply':
        ops.push({ kind: 'config.restore', id: `rb:${op.id}`, previous: result.previous ?? null });
        break;
      case 'message.delete':
      case 'config.restore':
        break;
    }
  }
  return { ops, irreversible: [...new Set(irreversible)] };
}
