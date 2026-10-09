import type { Graph, NodeType } from '@botcooks/workflows/graph';

export type InspectorField =
  | { key: string; label: string; kind: 'text' | 'textarea'; maxLength: number; placeholder?: string }
  | { key: string; label: string; kind: 'number'; min: number; max: number }
  | { key: string; label: string; kind: 'bool' }
  | { key: string; label: string; kind: 'role' | 'channel' }
  | { key: string; label: string; kind: 'event' }
  | { key: string; label: string; kind: 'options' };

export interface NodeMeta {
  label: string;
  group: 'trigger' | 'condition' | 'action';
  emoji: string;
  defaults: Record<string, unknown>;
  fields: InspectorField[];
  summary: (d: Record<string, unknown>, names: { role: (id: string) => string; channel: (id: string) => string }) => string;
}

export const NODE_META: Record<NodeType, NodeMeta> = {
  'trigger.command': {
    label: 'Slash command',
    group: 'trigger',
    emoji: '⌨️',
    defaults: { name: 'my-command', description: 'Describe what it does', options: [] },
    fields: [
      { key: 'name', label: 'Command name', kind: 'text', maxLength: 32, placeholder: 'lowercase-name' },
      { key: 'description', label: 'Description', kind: 'text', maxLength: 100 },
      { key: 'options', label: 'Options', kind: 'options' },
    ],
    summary: (d) => `/${d.name as string}`,
  },
  'trigger.event': {
    label: 'Server event',
    group: 'trigger',
    emoji: '⚡',
    defaults: { event: 'memberJoin' },
    fields: [{ key: 'event', label: 'When', kind: 'event' }],
    summary: (d) => ({ memberJoin: 'A member joins', memberLeave: 'A member leaves', messageCreate: 'A message is sent' })[d.event as string] ?? String(d.event),
  },
  'condition.hasRole': {
    label: 'Has role?',
    group: 'condition',
    emoji: '🎭',
    defaults: {},
    fields: [{ key: 'roleId', label: 'Role', kind: 'role' }],
    summary: (d, n) => (d.roleId ? `has @${n.role(d.roleId as string)}` : 'choose a role'),
  },
  'condition.random': {
    label: 'Random chance',
    group: 'condition',
    emoji: '🎲',
    defaults: { chance: 50 },
    fields: [{ key: 'chance', label: 'Chance (%)', kind: 'number', min: 0, max: 100 }],
    summary: (d) => `${d.chance as number}% chance`,
  },
  'condition.messageContains': {
    label: 'Message contains',
    group: 'condition',
    emoji: '🔎',
    defaults: { text: 'hello', caseSensitive: false },
    fields: [
      { key: 'text', label: 'Text', kind: 'text', maxLength: 200 },
      { key: 'caseSensitive', label: 'Case sensitive', kind: 'bool' },
    ],
    summary: (d) => `contains “${d.text as string}”`,
  },
  'condition.channelIs': {
    label: 'In channel?',
    group: 'condition',
    emoji: '#️⃣',
    defaults: {},
    fields: [{ key: 'channelId', label: 'Channel', kind: 'channel' }],
    summary: (d, n) => (d.channelId ? `in #${n.channel(d.channelId as string)}` : 'choose a channel'),
  },
  'action.reply': {
    label: 'Reply',
    group: 'action',
    emoji: '💬',
    defaults: { content: 'Hello {user}!', ephemeral: false },
    fields: [
      { key: 'content', label: 'Message', kind: 'textarea', maxLength: 2000 },
      { key: 'ephemeral', label: 'Only visible to the user', kind: 'bool' },
    ],
    summary: (d) => String(d.content).slice(0, 60),
  },
  'action.sendMessage': {
    label: 'Send message',
    group: 'action',
    emoji: '📨',
    defaults: { content: 'Hello!' },
    fields: [
      { key: 'channelId', label: 'Channel', kind: 'channel' },
      { key: 'content', label: 'Message', kind: 'textarea', maxLength: 2000 },
    ],
    summary: (d, n) => `${d.channelId ? `#${n.channel(d.channelId as string)}` : 'choose a channel'}: ${String(d.content).slice(0, 40)}`,
  },
  'action.dm': {
    label: 'DM the member',
    group: 'action',
    emoji: '✉️',
    defaults: { content: 'Thanks for joining!' },
    fields: [{ key: 'content', label: 'Message', kind: 'textarea', maxLength: 2000 }],
    summary: (d) => String(d.content).slice(0, 60),
  },
  'action.addRole': {
    label: 'Add role',
    group: 'action',
    emoji: '➕',
    defaults: {},
    fields: [{ key: 'roleId', label: 'Role', kind: 'role' }],
    summary: (d, n) => (d.roleId ? `give @${n.role(d.roleId as string)}` : 'choose a role'),
  },
  'action.removeRole': {
    label: 'Remove role',
    group: 'action',
    emoji: '➖',
    defaults: {},
    fields: [{ key: 'roleId', label: 'Role', kind: 'role' }],
    summary: (d, n) => (d.roleId ? `remove @${n.role(d.roleId as string)}` : 'choose a role'),
  },
  'action.wait': {
    label: 'Wait',
    group: 'action',
    emoji: '⏳',
    defaults: { seconds: 5 },
    fields: [{ key: 'seconds', label: 'Seconds (max 60)', kind: 'number', min: 1, max: 60 }],
    summary: (d) => `wait ${d.seconds as number}s`,
  },
};

export const GROUP_COLOR = { trigger: '#f97316', condition: '#38bdf8', action: '#4ade80' } as const;

/** Example graph the editor starts with for new items. */
export function starterGraph(kind: 'command' | 'event'): Graph {
  return kind === 'command'
    ? {
        nodes: [
          { id: 'trigger', type: 'trigger.command', position: { x: 120, y: 20 }, data: { name: 'hello', description: 'Say hello', options: [] } },
          { id: 'reply', type: 'action.reply', position: { x: 120, y: 170 }, data: { content: 'Hello {user}! 🍳', ephemeral: false } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'reply' }],
      }
    : {
        nodes: [
          { id: 'trigger', type: 'trigger.event', position: { x: 120, y: 20 }, data: { event: 'memberJoin' } },
          { id: 'dm', type: 'action.dm', position: { x: 120, y: 170 }, data: { content: 'Welcome to {server}, {username}!' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'dm' }],
      };
}
