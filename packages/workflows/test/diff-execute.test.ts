import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { bitfieldToPermissions, serverPlanSchema, type GuildSnapshot, type ServerPlanInput } from '@botcooks/shared';
import { TEST_BOT_ID, TEST_GUILD_ID, makeSnapshot } from '@botcooks/shared/testing';
import { validatePlan } from '@botcooks/security';
import { TEMPLATES } from '@botcooks/ai';
import { diffPlan } from '../src/diff';
import { buildRollbackOps, executeOps, type ExecuteContext } from '../src/executor';
import type { Op } from '../src/changeset';
import { FakeGuild, MemoryStore } from './fakes';

function prepare(input: ServerPlanInput, snapshot: GuildSnapshot = makeSnapshot(), mode: 'additive' | 'update' | 'sync' = 'additive') {
  const validated = validatePlan(serverPlanSchema.parse(input), snapshot);
  return { validated, change: diffPlan(validated.plan, snapshot, { mode }), snapshot };
}

function ctxFor(guild: FakeGuild, store: MemoryStore, snapshot: GuildSnapshot): ExecuteContext {
  return {
    guildId: TEST_GUILD_ID,
    preExistingIds: new Set([...snapshot.roles.map((r) => r.id), ...snapshot.channels.map((c) => c.id)]),
    writer: guild,
    store,
    reason: 'BotCooks test',
    executionId: 'exec-test-1',
  };
}

describe('templates', () => {
  for (const [id, template] of Object.entries(TEMPLATES)) {
    it(`"${id}" validates without blocking issues and produces creations`, () => {
      const { validated, change } = prepare(template.plan);
      expect(validated.blocking).toBe(false);
      expect(validated.issues.filter((i) => i.code === 'unknown_role_ref' || i.code === 'unknown_channel_ref')).toEqual([]);
      expect(change.counts.create).toBeGreaterThan(3);
      expect(change.risk.destructive).toBe(false);
    });
  }
});

describe('diffPlan', () => {
  it('compiles private visibility into deny @everyone + allow roles + bot access', () => {
    const { change } = prepare({
      roles: [{ key: 'mod', name: 'Moderator', permissions: ['KickMembers'] }],
      channels: [{ key: 'staff', name: 'staff', visibility: 'private', accessRoles: ['mod'] }],
    });
    const op = change.ops.find((o) => o.kind === 'channel.create')!;
    expect(op.kind).toBe('channel.create');
    if (op.kind !== 'channel.create') return;
    const byTarget = Object.fromEntries(op.data.overwrites.map((o) => [o.target, o]));
    expect(bitfieldToPermissions(byTarget.everyone!.deny)).toEqual(['ViewChannel']);
    expect(bitfieldToPermissions(byTarget['role:mod']!.allow)).toEqual(expect.arrayContaining(['ViewChannel', 'SendMessages']));
    expect(bitfieldToPermissions(byTarget[`member:${TEST_BOT_ID}`]!.allow)).toContain('ViewChannel');
  });

  it('channels inside a private category inherit its restrictions', () => {
    const { change } = prepare({
      roles: [{ key: 'mod', name: 'Moderator' }],
      categories: [{ key: 'staff', name: 'Staff', visibility: 'private', accessRoles: ['mod'], channels: [{ key: 'log', name: 'log' }] }],
    });
    const op = change.ops.find((o) => o.kind === 'channel.create' && o.ref === 'channel:log');
    if (op?.kind !== 'channel.create') throw new Error('missing');
    expect(op.data.parent).toBe('channel:staff');
    expect(op.data.overwrites.find((o) => o.target === 'everyone')?.deny).toBe(PermissionFlagsBits.ViewChannel.toString());
  });

  it('additive mode leaves existing resources alone', () => {
    const { change } = prepare({ categories: [{ key: 'tc', name: 'Text Channels', channels: [{ key: 'general', name: 'general', topic: 'new topic' }] }] });
    expect(change.ops.filter((o) => o.kind === 'channel.create' || o.kind === 'channel.update')).toEqual([]);
    expect(change.mappings['channel:general']).toBe('500000000000000021');
    expect(change.diff.find((d) => d.label === '#general')?.action).toBe('skip');
  });

  it('update mode produces updates for differing existing channels', () => {
    const { change } = prepare(
      { categories: [{ key: 'tc', name: 'Text Channels', channels: [{ key: 'general', name: 'general', topic: 'new topic' }] }] },
      makeSnapshot(),
      'update',
    );
    const update = change.ops.find((o) => o.kind === 'channel.update');
    expect(update).toBeDefined();
    expect(change.risk.destructive).toBe(false);
  });

  it('sync mode proposes deletions and flags them destructive, never touching protected channels', () => {
    const snapshot = makeSnapshot({ protectedChannelIds: ['500000000000000021'] });
    const { change } = prepare({ channels: [{ key: 'new', name: 'new' }] }, snapshot, 'sync');
    const deletes = change.ops.filter((o) => o.kind === 'channel.delete');
    expect(deletes.map((d) => (d.kind === 'channel.delete' ? d.channelId : ''))).toEqual(['500000000000000020']);
    expect(change.risk.destructive).toBe(true);
    expect(change.counts.delete).toBe(1);
  });

  it('flags elevation when a new role gets dangerous permissions', () => {
    const { change } = prepare({ roles: [{ key: 'mod', name: 'Moderator', permissions: ['BanMembers'] }] });
    expect(change.risk.elevation).toBe(true);
    expect(change.risk.reasons.join(' ')).toContain('BanMembers');
  });
});

describe('executeOps', () => {
  const plan: ServerPlanInput = {
    roles: [
      { key: 'mod', name: 'Moderator', permissions: ['KickMembers'] },
      { key: 'fan', name: 'Fan', selfAssignable: true },
    ],
    categories: [
      {
        key: 'staff',
        name: 'Staff',
        visibility: 'private',
        accessRoles: ['mod'],
        channels: [{ key: 'mod-log', name: 'mod-log' }],
      },
      { key: 'chat', name: 'Chat', channels: [{ key: 'welcome', name: 'welcome' }] },
    ],
    rules: { channel: 'welcome', content: 'Be nice' },
    selfRolePanels: [{ channel: 'welcome', title: 'Roles', roles: [{ role: 'fan' }] }],
    moderation: { modLogChannel: 'mod-log' },
  };

  it('creates everything, resolves references and registers panels', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    const store = new MemoryStore(change.mappings);
    const report = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(report.status).toBe('completed');
    const modRole = guild.roles.find((r) => r.name === 'Moderator')!;
    const modLog = guild.channels.find((c) => c.name === 'mod-log')!;
    const staff = guild.channels.find((c) => c.name === 'Staff')!;
    expect(modLog.parentId).toBe(staff.id);
    expect(modLog.overwrites.find((o) => o.id === modRole.id)).toBeDefined();
    expect(modLog.overwrites.find((o) => o.id === TEST_GUILD_ID)?.deny).toBe(PermissionFlagsBits.ViewChannel.toString());
    expect(store.panels[0]!.roleIds).toEqual([guild.roles.find((r) => r.name === 'Fan')!.id]);
    expect((store.config as { modLog: string }).modLog).toBe(modLog.id);
  });

  it('is idempotent: re-running a finished execution changes nothing', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    const store = new MemoryStore(change.mappings);
    await executeOps(change.ops, ctxFor(guild, store, snapshot));
    const before = guild.calls.length;
    const again = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(again.status).toBe('completed');
    expect(guild.calls.length).toBe(before);
  });

  it('recovers after a crash mid-operation without duplicating resources', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    const store = new MemoryStore(change.mappings);
    guild.crashAfter = 'createChannel';
    const first = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(first.failed).toBe(1);
    // Simulate the worker dying while the op was "running": reset its terminal state.
    const crashedId = [...store.states.entries()].find(([, s]) => s.status === 'failed')![0];
    store.states.set(crashedId, { status: 'running' });
    for (const [id, s] of store.states) if (s.status === 'skipped') store.states.delete(id);
    const second = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(second.status).toBe('completed');
    const names = guild.channels.map((c) => c.name);
    expect(names.filter((n) => n === 'Staff')).toHaveLength(1);
    expect(names.filter((n) => n === 'mod-log')).toHaveLength(1);
    expect(store.states.get(crashedId)?.result?.recovered).toBe(true);
  });

  it('skips dependants of a failed op and reports partial failure', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    guild.failures.set('createRole', { at: 1, error: Object.assign(new Error('Missing Permissions'), { status: 403, code: 50013 }) });
    const store = new MemoryStore(change.mappings);
    const report = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(report.status).toBe('completed_with_errors');
    expect(report.errors[0]!.message).toMatch(/Missing permissions/);
    // channels that need role:mod in their overwrites are skipped, not created half-configured
    expect(guild.channels.find((c) => c.name === 'mod-log')).toBeUndefined();
    expect(guild.channels.find((c) => c.name === 'welcome')).toBeDefined();
  });

  it('stops on fatal errors and honours cancellation', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    guild.failures.set('createRole', { at: 1, error: Object.assign(new Error('401: Unauthorized'), { status: 401 }) });
    const store = new MemoryStore(change.mappings);
    const report = await executeOps(change.ops, ctxFor(guild, store, snapshot));
    expect(report.status).toBe('failed');
    expect(guild.calls).toEqual(['createRole']);

    const store2 = new MemoryStore(change.mappings);
    store2.cancelled = true;
    const cancelled = await executeOps(change.ops, ctxFor(new FakeGuild(snapshot), store2, snapshot));
    expect(cancelled.status).toBe('cancelled');
  });

  it('rolls back what it created and restores settings', async () => {
    const { change, snapshot } = prepare(plan);
    const guild = new FakeGuild(snapshot);
    const store = new MemoryStore(change.mappings);
    await executeOps(change.ops, ctxFor(guild, store, snapshot));
    const executed = change.ops.map((op: Op) => ({ op, state: store.states.get(op.id)! }));
    const rollback = buildRollbackOps(executed);
    expect(rollback.irreversible.join(' ')).toContain('Role order');
    const rbStore = new MemoryStore();
    rbStore.config = store.config;
    const report = await executeOps(rollback.ops, { ...ctxFor(guild, rbStore, snapshot), executionId: 'rollback-1' });
    expect(report.status).toBe('completed');
    expect(guild.roles.map((r) => r.id).sort()).toEqual(snapshot.roles.map((r) => r.id).sort());
    expect(guild.channels.map((c) => c.id).sort()).toEqual(snapshot.channels.map((c) => c.id).sort());
    expect(guild.messages).toEqual([]);
    expect(rbStore.config).toEqual({ previous: true });
  });
});
