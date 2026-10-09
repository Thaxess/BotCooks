import { ChannelType, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember, type Message } from 'discord.js';
import { getCustomCommandByName, listEventWorkflows } from '@botcooks/database';
import { runGraph, validateGraph, type Effects, type Graph, type RunContext, type TriggerEvent } from '@botcooks/workflows';
import { getMe, isAssignableRole, type BotContext } from '../context';

/**
 * Side effects for visual-builder workflows. Every effect is limited to the invoking member and
 * this guild, roles must pass the same assignability checks as self-roles, and mentions are
 * restricted to the invoking user.
 */
function memberEffects(ctx: BotContext, member: GuildMember, reply: Effects['reply']): Effects {
  const guild = member.guild;
  return {
    reply,
    async sendMessage(channelId, content) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Channel not found in this server');
      const me = await getMe(guild);
      if (!channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) throw new Error('Missing Send Messages');
      await channel.send({ content, allowedMentions: { users: [member.id] } });
    },
    async dm(content) {
      await member.send({ content: `${content}\n\n— sent by ${guild.name}`, allowedMentions: { parse: [] } });
    },
    async addRole(roleId) {
      const role = guild.roles.cache.get(roleId);
      if (!role) throw new Error('Role not found');
      const check = isAssignableRole(role, await getMe(guild));
      if (!check.ok) throw new Error(check.reason);
      await member.roles.add(role, 'BotCooks workflow');
    },
    async removeRole(roleId) {
      const role = guild.roles.cache.get(roleId);
      if (!role) throw new Error('Role not found');
      const check = isAssignableRole(role, await getMe(guild));
      if (!check.ok) throw new Error(check.reason);
      await member.roles.remove(role, 'BotCooks workflow');
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
  };
}

function runContext(member: GuildMember, channelId: string, extra: Partial<RunContext> = {}): RunContext {
  return {
    userId: member.id,
    userName: member.user.username,
    guildName: member.guild.name,
    memberRoleIds: [...member.roles.cache.keys()],
    channelId,
    ...extra,
  };
}

/** Runs a custom command if one exists for this name. Returns false when no command matched. */
export async function runCustomCommand(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>): Promise<boolean> {
  const s = await ctx.settings.get(i.guildId);
  const cmd = await getCustomCommandByName(ctx.db, i.guildId, i.commandName);
  if (!cmd) return false;
  if (!s.features.customCommands || !cmd.enabled) {
    await i.reply({ content: 'This command is currently disabled.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const v = validateGraph(cmd.graph, 'command');
  if (!v.ok) {
    await i.reply({ content: 'This command is misconfigured. Ask an admin to fix it in the dashboard.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const replies = v.graph.nodes.filter((n) => n.type === 'action.reply');
  const ephemeral = replies.length > 0 && replies.every((n) => (n.data as { ephemeral?: boolean }).ephemeral);
  await i.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  let replied = false;
  const options: Record<string, string | number> = {};
  for (const o of i.options.data) if (o.value !== undefined && typeof o.value !== 'boolean') options[o.name] = o.value;
  const result = await runGraph(
    v.graph,
    runContext(i.member, i.channelId, { options }),
    memberEffects(ctx, i.member, async (content) => {
      if (!replied) {
        replied = true;
        await i.editReply({ content, allowedMentions: { users: [i.user.id] } });
      } else {
        await i.followUp({ content, allowedMentions: { users: [i.user.id] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
      }
    }),
  );
  if (!replied) await i.editReply({ content: result.errors.length ? `Some steps failed: ${result.errors.slice(0, 3).join('; ')}` : '✅ Done.' });
  return true;
}

const graphCache = new Map<string, { graphs: Graph[]; expires: number }>();

async function workflowsFor(ctx: BotContext, guildId: string, trigger: TriggerEvent): Promise<Graph[]> {
  const key = `${guildId}:${trigger}`;
  const hit = graphCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.graphs;
  const rows = await listEventWorkflows(ctx.db, guildId, trigger, true);
  const graphs = rows
    .map((r) => validateGraph(r.graph, 'event'))
    .filter((v): v is Extract<typeof v, { ok: true }> => v.ok)
    .map((v) => v.graph);
  graphCache.set(key, { graphs, expires: Date.now() + 30_000 });
  return graphs;
}

export async function runEventWorkflows(ctx: BotContext, trigger: TriggerEvent, member: GuildMember, opts: { channelId?: string; message?: Message } = {}) {
  const s = await ctx.settings.get(member.guild.id);
  if (!s.features.events) return;
  const graphs = await workflowsFor(ctx, member.guild.id, trigger);
  for (const graph of graphs) {
    const channelId = opts.channelId ?? member.guild.systemChannelId ?? '';
    const reply: Effects['reply'] = async (content) => {
      if (!opts.message) throw new Error('Reply is only available for message triggers');
      await opts.message.reply({ content, allowedMentions: { users: [member.id], repliedUser: false } });
    };
    const result = await runGraph(graph, runContext(member, channelId, opts.message ? { messageContent: opts.message.content } : {}), memberEffects(ctx, member, reply));
    if (result.errors.length) ctx.log.debug('workflow errors', { guildId: member.guild.id, trigger, errors: result.errors });
  }
}
