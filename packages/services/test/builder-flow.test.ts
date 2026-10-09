import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import type { GuildSnapshot } from '@botcooks/shared';
import { TEST_GUILD_ID, TEST_OWNER_ID, makeSnapshot } from '@botcooks/shared/testing';
import { createTestDb } from '@botcooks/database/testing';
import { claimJob, getExecution, getSettings, listCustomCommands, listSelfRolePanels, type Database, type DbHandle } from '@botcooks/database';
import { MockProvider } from '@botcooks/ai';
import { resolveAccess, type Access } from '@botcooks/security';
import { FakeGuild } from '../../workflows/test/fakes';
import {
  JOB_PLAN_EXECUTE,
  JOB_PLAN_GENERATE,
  buildPreview,
  confirmPlan,
  previewRollback,
  requestRollback,
  runExecution,
  runGeneration,
  startBuild,
  type BuilderDeps,
} from '../src/index';
import { getLatestPlanVersion } from '@botcooks/database';

const SECRET = 'k'.repeat(48);

function ownerAccess(): Access {
  return resolveAccess({ userId: TEST_OWNER_ID, guildOwnerId: TEST_OWNER_ID, guildId: TEST_GUILD_ID, memberRoleIds: [], guildRoles: [], delegations: [] });
}

function limitedAdmin(): Access {
  return resolveAccess({
    userId: 'admin',
    guildOwnerId: TEST_OWNER_ID,
    guildId: TEST_GUILD_ID,
    memberRoleIds: ['r'],
    guildRoles: [{ id: 'r', permissions: PermissionFlagsBits.ManageGuild.toString() }],
    delegations: [],
  });
}

let handle: DbHandle;
let db: Database;
let guild: FakeGuild;
let deps: BuilderDeps;

/** Snapshot derived from the fake guild's current state, like a fresh REST fetch would be. */
function liveSnapshot(base: GuildSnapshot): (id: string) => Promise<GuildSnapshot> {
  return async () => ({ ...base, roles: structuredClone(guild.roles), channels: structuredClone(guild.channels), capturedAt: new Date().toISOString() });
}

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;
  const base = makeSnapshot();
  guild = new FakeGuild(base);
  deps = { db, secret: SECRET, fetchSnapshot: liveSnapshot(base), provider: new MockProvider() };
});
afterEach(async () => handle.close());

async function runNextExecution() {
  const job = await claimJob(db, 'w1', [JOB_PLAN_EXECUTE], 60_000);
  expect(job).not.toBeNull();
  return runExecution({ db, workerId: 'w1', writerFor: () => guild, fetchSnapshot: deps.fetchSnapshot }, job!.payload as { guildId: string; executionId: string });
}

describe('builder flow', () => {
  it('template -> preview -> confirm -> execute applies the plan and merges settings', async () => {
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', templateId: 'cooking' });
    expect(session.status).toBe('ready');
    const version = (await getLatestPlanVersion(db, TEST_GUILD_ID, session.id))!;

    const preview = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    expect(preview.blockers).toEqual([]);
    expect(preview.needsElevationAck).toBe(true); // Moderator gets KickMembers etc.
    expect(preview.change.counts.create).toBeGreaterThan(10);

    await expect(
      confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: preview.confirmation!.token, acknowledgeElevation: false, acknowledgeDestructive: false }),
    ).rejects.toThrow(/permission changes/);

    const exec = await confirmPlan(deps, {
      guildId: TEST_GUILD_ID,
      planVersionId: version.id,
      mode: 'additive',
      userId: TEST_OWNER_ID,
      access: ownerAccess(),
      ownerId: TEST_OWNER_ID,
      token: preview.confirmation!.token,
      acknowledgeElevation: true,
      acknowledgeDestructive: false,
    });

    // Replaying the same confirmation is rejected (another change is pending / nonce reused).
    await expect(
      confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: preview.confirmation!.token, acknowledgeElevation: true, acknowledgeDestructive: false }),
    ).rejects.toThrow();

    const outcome = await runNextExecution();
    expect(outcome.kind).toBe('finished');
    if (outcome.kind === 'finished') expect(outcome.report.status).toBe('completed');

    expect(guild.channels.some((c) => c.name === 'recipes')).toBe(true);
    expect(guild.roles.some((r) => r.name === 'Head Chef')).toBe(true);
    const { settings } = await getSettings(db, TEST_GUILD_ID);
    const modLog = guild.channels.find((c) => c.name === 'mod-log')!;
    expect(settings.features.levels).toBe(true);
    expect(settings.moderation.modLogChannelId).toBe(modLog.id);
    expect(settings.levels.rewards[0]!.roleId).toBe(guild.roles.find((r) => r.name === 'Head Chef')!.id);
    expect(settings.tempVoice.hubChannelId).toBe(guild.channels.find((c) => c.name === '➕ Create a room')!.id);
    expect((await listSelfRolePanels(db, TEST_GUILD_ID))).toHaveLength(1);
    expect((await getExecution(db, TEST_GUILD_ID, exec.id))?.status).toBe('completed');

    // Rollback removes what was created and restores settings.
    const rb = await previewRollback(deps, TEST_GUILD_ID, exec.id);
    expect(rb.ops.length).toBeGreaterThan(5);
    await requestRollback(deps, { guildId: TEST_GUILD_ID, executionId: exec.id, userId: TEST_OWNER_ID, access: ownerAccess() });
    const rolled = await runNextExecution();
    expect(rolled.kind === 'finished' && rolled.report.status).toBe('completed');
    expect(guild.channels.some((c) => c.name === 'recipes')).toBe(false);
    expect((await getSettings(db, TEST_GUILD_ID)).settings.features.levels).toBe(false);
  });

  it('aborts without changes if the server changed after confirmation', async () => {
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', templateId: 'friends' });
    const version = (await getLatestPlanVersion(db, TEST_GUILD_ID, session.id))!;
    const preview = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    await confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: preview.confirmation!.token, acknowledgeElevation: true, acknowledgeDestructive: false });
    guild.channels.push({ id: '999999999999999999', name: 'surprise', type: 0, parentId: null, position: 9, overwrites: [] });
    const outcome = await runNextExecution();
    expect(outcome.kind === 'finished' && outcome.report.status).toBe('failed');
    expect(guild.calls).toEqual([]);
  });

  it('rejects a confirmation when the server changed between preview and confirm', async () => {
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', templateId: 'study' });
    const version = (await getLatestPlanVersion(db, TEST_GUILD_ID, session.id))!;
    const preview = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    guild.roles.push({ id: '888888888888888888', name: 'New', color: 0, hoist: false, mentionable: false, position: 1, permissions: '0', managed: false });
    await expect(
      confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: preview.confirmation!.token, acknowledgeElevation: true, acknowledgeDestructive: false }),
    ).rejects.toThrow(/server changed/);
  });

  it('blocks replace mode unless enabled, and elevation for Manage-Server-only admins', async () => {
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', templateId: 'cooking' });
    const version = (await getLatestPlanVersion(db, TEST_GUILD_ID, session.id))!;
    const preview = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'sync', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    expect(preview.confirmation).toBeNull();
    expect(preview.blockers.join(' ')).toMatch(/disabled/);
    const admin = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: 'admin', access: limitedAdmin(), ownerId: TEST_OWNER_ID });
    // Manage Server alone cannot grant elevated permissions.
    expect(admin.confirmation).toBeNull();
  });

  it('AI path: generation runs as a queued job and produces a validated version', async () => {
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'discord', prompt: 'A server for my gaming clan with clips and LFG' });
    expect(session.status).toBe('generating');
    const job = await claimJob(db, 'w1', [JOB_PLAN_GENERATE], 60_000);
    const version = await runGeneration(deps, job!.payload as never);
    expect(version?.version).toBe(1);
    expect((version?.validation as { blocking: boolean }).blocking).toBe(false);
    expect(await listCustomCommands(db, TEST_GUILD_ID)).toEqual([]);
  });

  it('refuses AI builds when no provider is configured', async () => {
    await expect(
      startBuild({ ...deps, provider: null }, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', prompt: 'A big cooking community please' }),
    ).rejects.toThrow(/AI is not configured/);
  });
});

describe('snapshot restore', () => {
  it('recreates deleted channels and roles from a snapshot, leaving existing ones alone', async () => {
    const { snapshotToPlan, startRestoreBuild } = await import('../src/snapshot-plan');
    // Build something, snapshot it, delete a channel, then restore.
    const session = await startBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, source: 'dashboard', templateId: 'friends' });
    const version = (await getLatestPlanVersion(db, TEST_GUILD_ID, session.id))!;
    const preview = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    await confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: version.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: preview.confirmation!.token, acknowledgeElevation: true, acknowledgeDestructive: false });
    await runNextExecution();

    const snap = await deps.fetchSnapshot(TEST_GUILD_ID);
    const { plan } = snapshotToPlan(snap);
    expect(plan.roles.map((r) => r.name)).toEqual(expect.arrayContaining(['Friends', 'Guest']));

    guild.channels = guild.channels.filter((c) => c.name !== 'memes');
    const featuresBefore = (await getSettings(db, TEST_GUILD_ID)).settings.features;
    const restore = await startRestoreBuild(deps, { guildId: TEST_GUILD_ID, userId: TEST_OWNER_ID, snapshot: snap, label: 'test' });
    const rv = (await getLatestPlanVersion(db, TEST_GUILD_ID, restore.id))!;
    const rp = await buildPreview(deps, { guildId: TEST_GUILD_ID, planVersionId: rv.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID });
    expect(rp.change.counts.create).toBe(1);
    expect(rp.change.diff.find((d) => d.action === 'create')?.label).toBe('#memes');
    await confirmPlan(deps, { guildId: TEST_GUILD_ID, planVersionId: rv.id, mode: 'additive', userId: TEST_OWNER_ID, access: ownerAccess(), ownerId: TEST_OWNER_ID, token: rp.confirmation!.token, acknowledgeElevation: true, acknowledgeDestructive: false });
    await runNextExecution();
    const memes = guild.channels.find((c) => c.name === 'memes');
    expect(memes?.parentId).toBe(guild.channels.find((c) => c.name === 'Hangout')!.id);
    // Restores never toggle features.
    expect((await getSettings(db, TEST_GUILD_ID)).settings.features).toEqual(featuresBefore);
  });
});
