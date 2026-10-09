import { z } from 'zod';

/**
 * Visual command/event builder graphs. Stored in the same shape React Flow uses
 * ({ nodes, edges }) so the dashboard can load and save them directly.
 *
 * Graphs are data, not code: the interpreter only knows the node types below, enforces a step
 * budget, forbids cycles, and routes every side effect through an `Effects` interface that the
 * bot implements with permission checks.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const text2000 = z.string().max(2000);

export const TRIGGER_EVENTS = ['memberJoin', 'memberLeave', 'messageCreate'] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

const commandOption = z.object({
  name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  description: z.string().min(1).max(100),
  type: z.enum(['string', 'user', 'integer']),
  required: z.boolean().default(false),
});

export const nodeDataSchemas = {
  'trigger.command': z.object({
    name: z.string().regex(/^[a-z0-9_-]{1,32}$/, 'Lowercase letters, numbers, - and _ only'),
    description: z.string().min(1).max(100),
    options: z.array(commandOption).max(5).default([]),
  }),
  'trigger.event': z.object({ event: z.enum(TRIGGER_EVENTS) }),
  'condition.hasRole': z.object({ roleId: snowflake }),
  'condition.random': z.object({ chance: z.number().int().min(0).max(100) }),
  'condition.messageContains': z.object({ text: z.string().min(1).max(200), caseSensitive: z.boolean().default(false) }),
  'condition.channelIs': z.object({ channelId: snowflake }),
  'action.reply': z.object({ content: text2000.min(1), ephemeral: z.boolean().default(false) }),
  'action.sendMessage': z.object({ channelId: snowflake, content: text2000.min(1) }),
  'action.dm': z.object({ content: text2000.min(1) }),
  'action.addRole': z.object({ roleId: snowflake }),
  'action.removeRole': z.object({ roleId: snowflake }),
  'action.wait': z.object({ seconds: z.number().int().min(1).max(60) }),
} as const;

export type NodeType = keyof typeof nodeDataSchemas;
export const NODE_TYPES = Object.keys(nodeDataSchemas) as NodeType[];

const nodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
    position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .transform((n, ctx) => {
    const parsed = nodeDataSchemas[n.type].safeParse(n.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', message: `Node "${n.id}" (${n.type}): ${issue.path.join('.') || 'data'} ${issue.message}` });
      }
      return z.NEVER;
    }
    return { ...n, data: parsed.data as Record<string, unknown> };
  });

const edgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string(),
  target: z.string(),
  /** Conditions use "true" / "false" handles. */
  sourceHandle: z.enum(['true', 'false']).nullable().optional(),
});

export const graphSchema = z.object({
  nodes: z.array(nodeSchema).min(1).max(50),
  edges: z.array(edgeSchema).max(100).default([]),
});

export type Graph = z.infer<typeof graphSchema>;
export type GraphNode = Graph['nodes'][number];

export type GraphValidation = { ok: true; graph: Graph; trigger: GraphNode } | { ok: false; errors: string[] };

export function validateGraph(raw: unknown, expect?: 'command' | 'event'): GraphValidation {
  const parsed = graphSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => i.message) };
  const graph = parsed.data;
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  const triggers = graph.nodes.filter((n) => n.type.startsWith('trigger.'));
  if (triggers.length !== 1) errors.push('A workflow needs exactly one trigger block.');
  const trigger = triggers[0];
  if (trigger && expect === 'command' && trigger.type !== 'trigger.command') errors.push('Commands must start with a command trigger.');
  if (trigger && expect === 'event' && trigger.type !== 'trigger.event') errors.push('Event workflows must start with an event trigger.');
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`Connection "${e.id}" points to a missing block.`);
    const source = graph.nodes.find((n) => n.id === e.source);
    if (source?.type.startsWith('condition.') && !e.sourceHandle) errors.push(`Connection from condition "${source.id}" must use its yes/no output.`);
    if (graph.nodes.find((n) => n.id === e.target)?.type.startsWith('trigger.')) errors.push('Nothing can connect into a trigger.');
  }
  if (hasCycle(graph)) errors.push('Workflows cannot loop back on themselves.');
  if (trigger?.type === 'trigger.event') {
    const ev = (trigger.data as { event: TriggerEvent }).event;
    if (ev !== 'messageCreate' && graph.nodes.some((n) => n.type === 'condition.messageContains')) {
      errors.push('"Message contains" only works with the message trigger.');
    }
    if (graph.nodes.some((n) => n.type === 'action.reply') && ev !== 'messageCreate') {
      errors.push('"Reply" only works for commands and messages; use "Send message" instead.');
    }
  }
  if (errors.length || !trigger) return { ok: false, errors };
  return { ok: true, graph, trigger };
}

function hasCycle(graph: Graph): boolean {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of out.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  return graph.nodes.some((n) => visit(n.id));
}

/** Context the bot provides for one run. All strings coming from users are treated as plain text. */
export interface RunContext {
  userId: string;
  userName: string;
  guildName: string;
  memberRoleIds: string[];
  channelId: string;
  messageContent?: string;
  options?: Record<string, string | number>;
}

/** Side effects, implemented by the bot with its own permission and hierarchy checks. */
export interface Effects {
  reply(content: string, ephemeral: boolean): Promise<void>;
  sendMessage(channelId: string, content: string): Promise<void>;
  dm(content: string): Promise<void>;
  addRole(roleId: string): Promise<void>;
  removeRole(roleId: string): Promise<void>;
  wait(ms: number): Promise<void>;
  random(): number;
}

export interface RunResult {
  steps: number;
  actions: string[];
  errors: string[];
  truncated: boolean;
}

export const RUN_LIMITS = { maxSteps: 30, maxMessages: 5, maxWaitMs: 60_000 } as const;

export function renderGraphText(template: string, ctx: RunContext): string {
  return template.replace(/\{(user|username|server|option:([a-z0-9_-]{1,32}))\}/g, (_m, key: string, opt?: string) => {
    if (key === 'user') return `<@${ctx.userId}>`;
    if (key === 'username') return ctx.userName;
    if (key === 'server') return ctx.guildName;
    if (opt) {
      const v = ctx.options?.[opt];
      return v === undefined ? '' : String(v);
    }
    return '';
  });
}

export async function runGraph(graph: Graph, ctx: RunContext, fx: Effects): Promise<RunResult> {
  const result: RunResult = { steps: 0, actions: [], errors: [], truncated: false };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgesFrom = (id: string, handle?: 'true' | 'false') =>
    graph.edges.filter((e) => e.source === id && (handle === undefined || e.sourceHandle === handle));
  const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'));
  if (!trigger) return result;

  let messages = 0;
  let waited = 0;
  const queue: string[] = edgesFrom(trigger.id).map((e) => e.target);
  while (queue.length) {
    if (result.steps >= RUN_LIMITS.maxSteps) {
      result.truncated = true;
      break;
    }
    const node = byId.get(queue.shift()!);
    if (!node) continue;
    result.steps++;
    const d = node.data as Record<string, unknown>;
    try {
      if (node.type.startsWith('condition.')) {
        let pass = false;
        switch (node.type) {
          case 'condition.hasRole':
            pass = ctx.memberRoleIds.includes(d.roleId as string);
            break;
          case 'condition.random':
            pass = fx.random() * 100 < (d.chance as number);
            break;
          case 'condition.messageContains': {
            const hay = ctx.messageContent ?? '';
            pass = d.caseSensitive ? hay.includes(d.text as string) : hay.toLowerCase().includes((d.text as string).toLowerCase());
            break;
          }
          case 'condition.channelIs':
            pass = ctx.channelId === d.channelId;
            break;
        }
        queue.push(...edgesFrom(node.id, pass ? 'true' : 'false').map((e) => e.target));
        continue;
      }
      switch (node.type) {
        case 'action.reply':
        case 'action.sendMessage':
        case 'action.dm': {
          if (messages >= RUN_LIMITS.maxMessages) {
            result.errors.push('Message limit reached');
            break;
          }
          messages++;
          const content = renderGraphText(d.content as string, ctx).slice(0, 2000);
          if (node.type === 'action.reply') await fx.reply(content, Boolean(d.ephemeral));
          else if (node.type === 'action.sendMessage') await fx.sendMessage(d.channelId as string, content);
          else await fx.dm(content);
          result.actions.push(node.type);
          break;
        }
        case 'action.addRole':
          await fx.addRole(d.roleId as string);
          result.actions.push(node.type);
          break;
        case 'action.removeRole':
          await fx.removeRole(d.roleId as string);
          result.actions.push(node.type);
          break;
        case 'action.wait': {
          const ms = Math.min((d.seconds as number) * 1000, RUN_LIMITS.maxWaitMs - waited);
          if (ms > 0) {
            waited += ms;
            await fx.wait(ms);
          }
          break;
        }
      }
    } catch (e) {
      result.errors.push(`${node.type}: ${(e as Error).message}`.slice(0, 200));
    }
    queue.push(...edgesFrom(node.id).map((e) => e.target));
  }
  return result;
}

/** Simple "reply with text" command graph, used for AI-suggested commands and quick creation. */
export function simpleReplyGraph(name: string, description: string, response: string): Graph {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger.command', position: { x: 0, y: 0 }, data: { name, description, options: [] } },
      { id: 'reply', type: 'action.reply', position: { x: 0, y: 160 }, data: { content: response, ephemeral: false } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'reply' }],
  };
}
