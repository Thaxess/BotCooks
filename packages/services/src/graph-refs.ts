import { runGraph, type Graph, type RunContext } from '@botcooks/workflows';
import { validateSettingsRefs, type GuildRefContext } from './settings-refs';

/**
 * Every role/channel a workflow references must belong to this guild; roles a workflow ADDS or
 * REMOVES must also be safe to hand out (same rules as autoroles).
 */
export function validateGraphRefs(graph: Graph, guild: GuildRefContext): string[] {
  const errors: string[] = [];
  const channelIds = new Set(guild.channels.filter((c) => c.type === 0 || c.type === 5).map((c) => c.id));
  const roleIds = new Set(guild.roles.map((r) => r.id));
  for (const node of graph.nodes) {
    const d = node.data as Record<string, unknown>;
    if (typeof d.channelId === 'string' && !channelIds.has(d.channelId)) errors.push(`Block "${node.id}": channel is not a text channel in this server.`);
    if (typeof d.roleId === 'string') {
      if (!roleIds.has(d.roleId)) errors.push(`Block "${node.id}": role is not in this server.`);
      else if (node.type === 'action.addRole' || node.type === 'action.removeRole') {
        const e = validateSettingsRefs('autoroles', { roleIds: [d.roleId] }, guild);
        if (e.length) errors.push(`Block "${node.id}": ${e[0]!.replace(/^autoroles\.roleIds\.\d+: /, '')}`);
      }
    }
  }
  return errors;
}

export interface DryRunStep {
  action: string;
  detail: string;
}

/** Runs a graph with recording effects only. Nothing is sent to Discord. */
export async function dryRunGraph(graph: Graph, ctx: RunContext, roleName: (id: string) => string, channelName: (id: string) => string) {
  const steps: DryRunStep[] = [];
  const result = await runGraph(graph, ctx, {
    reply: async (content, ephemeral) => void steps.push({ action: 'reply', detail: `${ephemeral ? '(only visible to the user) ' : ''}${content}` }),
    sendMessage: async (channelId, content) => void steps.push({ action: 'send message', detail: `#${channelName(channelId)}: ${content}` }),
    dm: async (content) => void steps.push({ action: 'DM', detail: content }),
    addRole: async (roleId) => void steps.push({ action: 'add role', detail: `@${roleName(roleId)}` }),
    removeRole: async (roleId) => void steps.push({ action: 'remove role', detail: `@${roleName(roleId)}` }),
    wait: async (ms) => void steps.push({ action: 'wait', detail: `${ms / 1000}s` }),
    random: Math.random,
  });
  return { steps, errors: result.errors, truncated: result.truncated };
}
