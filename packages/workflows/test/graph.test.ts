import { describe, expect, it } from 'vitest';
import { runGraph, simpleReplyGraph, validateGraph, type Effects, type Graph } from '../src/graph';

const ROLE = '300000000000000001';
const fx = (log: string[], random = 0.5): Effects => ({
  reply: async (c) => void log.push(`reply:${c}`),
  sendMessage: async (ch, c) => void log.push(`send:${ch}:${c}`),
  dm: async (c) => void log.push(`dm:${c}`),
  addRole: async (r) => void log.push(`add:${r}`),
  removeRole: async (r) => void log.push(`remove:${r}`),
  wait: async () => undefined,
  random: () => random,
});
const ctx = { userId: '1'.repeat(18), userName: 'cook', guildName: 'Kitchen', memberRoleIds: [ROLE], channelId: '2'.repeat(18), options: { dish: 'pasta' } };

describe('graph validation', () => {
  it('accepts a simple command and rejects bad shapes', () => {
    expect(validateGraph(simpleReplyGraph('hello', 'Say hi', 'Hi {user}!'), 'command').ok).toBe(true);
    expect(validateGraph(simpleReplyGraph('hello', 'Say hi', 'x'), 'event').ok).toBe(false);
    const cyclic: Graph = {
      nodes: [
        { id: 't', type: 'trigger.command', position: { x: 0, y: 0 }, data: { name: 'x', description: 'x', options: [] } },
        { id: 'a', type: 'action.reply', position: { x: 0, y: 0 }, data: { content: 'a', ephemeral: false } },
        { id: 'b', type: 'action.reply', position: { x: 0, y: 0 }, data: { content: 'b', ephemeral: false } },
      ],
      edges: [
        { id: '1', source: 't', target: 'a' },
        { id: '2', source: 'a', target: 'b' },
        { id: '3', source: 'b', target: 'a' },
      ],
    };
    const r = validateGraph(cyclic);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/loop/);
  });

  it('rejects unknown node types and invalid node data', () => {
    expect(validateGraph({ nodes: [{ id: 't', type: 'trigger.shell', data: {} }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ nodes: [{ id: 't', type: 'trigger.command', data: { name: 'BAD NAME', description: 'x' } }], edges: [] }).ok).toBe(false);
  });
});

describe('runGraph', () => {
  it('follows condition branches and renders placeholders', async () => {
    const graph: Graph = {
      nodes: [
        { id: 't', type: 'trigger.command', position: { x: 0, y: 0 }, data: { name: 'cook', description: 'x', options: [] } },
        { id: 'c', type: 'condition.hasRole', position: { x: 0, y: 0 }, data: { roleId: ROLE } },
        { id: 'yes', type: 'action.reply', position: { x: 0, y: 0 }, data: { content: '{user} makes {option:dish}', ephemeral: false } },
        { id: 'no', type: 'action.addRole', position: { x: 0, y: 0 }, data: { roleId: ROLE } },
      ],
      edges: [
        { id: '1', source: 't', target: 'c' },
        { id: '2', source: 'c', target: 'yes', sourceHandle: 'true' },
        { id: '3', source: 'c', target: 'no', sourceHandle: 'false' },
      ],
    };
    const log: string[] = [];
    await runGraph(validateGraph(graph).ok ? graph : graph, ctx, fx(log));
    expect(log).toEqual([`reply:<@${ctx.userId}> makes pasta`]);
    const log2: string[] = [];
    await runGraph(graph, { ...ctx, memberRoleIds: [] }, fx(log2));
    expect(log2).toEqual([`add:${ROLE}`]);
  });

  it('enforces the message budget', async () => {
    const nodes: Graph['nodes'] = [{ id: 't', type: 'trigger.command', position: { x: 0, y: 0 }, data: { name: 'spam', description: 'x', options: [] } }];
    const edges: Graph['edges'] = [];
    for (let i = 0; i < 8; i++) {
      nodes.push({ id: `r${i}`, type: 'action.dm', position: { x: 0, y: 0 }, data: { content: `m${i}` } });
      edges.push({ id: `e${i}`, source: i === 0 ? 't' : `r${i - 1}`, target: `r${i}` });
    }
    const log: string[] = [];
    const res = await runGraph({ nodes, edges }, ctx, fx(log));
    expect(log).toHaveLength(5);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
