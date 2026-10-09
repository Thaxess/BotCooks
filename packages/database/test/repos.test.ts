import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError } from '@botcooks/shared';
import { createTestDb } from '../src/testing';
import type { Database, DbHandle } from '../src/client';
import {
  acquireGuildLock,
  addPlanVersion,
  awardXp,
  claimDueScheduledMessages,
  claimJob,
  completeJob,
  countActiveWarnings,
  createBuildSession,
  createCase,
  createExecution,
  createGiveaway,
  createScheduledMessage,
  enqueueJob,
  failJob,
  finishGiveaway,
  getBuildSession,
  getCase,
  getJob,
  getSettings,
  listAudit,
  listCases,
  openAppeal,
  recordAudit,
  recoverExpiredJobs,
  releaseGuildLock,
  resolveAppeal,
  saveSettings,
  updateSettingsSection,
  mutateSettings,
} from '../src/index';

let handle: DbHandle;
let db: Database;
const G1 = '111111111111111111';
const G2 = '222222222222222222';

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
});
afterAll(async () => handle.close());

describe('settings', () => {
  it('returns defaults for unknown guilds and enforces optimistic concurrency', async () => {
    const first = await getSettings(db, G1);
    expect(first.version).toBe(0);
    expect(first.settings.features.builder).toBe(true);
    const v1 = await saveSettings(db, G1, first.settings, 0, 'u');
    expect(v1).toBe(1);
    await expect(saveSettings(db, G1, first.settings, 0, 'u')).rejects.toBeInstanceOf(ConflictError);
    const updated = await updateSettingsSection(db, G1, 'levels', { xpMin: 5, xpMax: 10 }, 1, 'u');
    expect(updated.version).toBe(2);
    expect(updated.settings.levels.cooldownSeconds).toBe(60);
    await expect(updateSettingsSection(db, G1, 'levels', {}, 1, 'u')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects invalid section values', async () => {
    const { version } = await getSettings(db, G1);
    await expect(updateSettingsSection(db, G1, 'levels', { xpMin: -4 }, version, 'u')).rejects.toThrow();
  });

  it('mutateSettings retries through concurrent writers', async () => {
    await Promise.all([
      mutateSettings(db, G2, null, (s) => void (s.features.levels = true)),
      mutateSettings(db, G2, null, (s) => void (s.features.tickets = true)),
    ]);
    const { settings } = await getSettings(db, G2);
    expect(settings.features.levels && settings.features.tickets).toBe(true);
  });
});

describe('tenant isolation', () => {
  it('never returns another guild’s build session, case or audit entry', async () => {
    const session = await createBuildSession(db, { guildId: G1, createdBy: 'u', source: 'dashboard', prompt: 'p' });
    expect(await getBuildSession(db, G2, session.id)).toBeUndefined();
    expect((await getBuildSession(db, G1, session.id))?.id).toBe(session.id);

    await createCase(db, { guildId: G1, type: 'warn', userId: 'x', moderatorId: 'm' });
    expect((await listCases(db, G2)).items).toEqual([]);
    expect(await getCase(db, G2, 1)).toBeUndefined();

    await recordAudit(db, { guildId: G1, actorId: 'u', actorType: 'user', action: 'settings.update' });
    expect((await listAudit(db, G2)).items).toEqual([]);
    expect((await listAudit(db, G1, { search: 'settings' })).items).toHaveLength(1);
  });
});

describe('moderation cases', () => {
  it('numbers cases per guild and handles appeals once', async () => {
    const a = await createCase(db, { guildId: G2, type: 'warn', userId: 'bad', moderatorId: 'm', reason: 'spam' });
    const b = await createCase(db, { guildId: G2, type: 'warn', userId: 'bad', moderatorId: 'm' });
    expect([a.caseNumber, b.caseNumber]).toEqual([1, 2]);
    expect(await countActiveWarnings(db, G2, 'bad')).toBe(2);
    expect(await openAppeal(db, G2, 1, 'someone-else', 'pls')).toBeUndefined();
    expect((await openAppeal(db, G2, 1, 'bad', 'sorry'))?.appealStatus).toBe('open');
    expect(await openAppeal(db, G2, 1, 'bad', 'again')).toBeUndefined();
    await resolveAppeal(db, G2, 1, true, 'mod');
    expect(await countActiveWarnings(db, G2, 'bad')).toBe(1);
  });
});

describe('job queue', () => {
  it('claims each job once, dedupes, retries with backoff and recovers expired leases', async () => {
    const id = await enqueueJob(db, 'test.job', { n: 1 }, { dedupeKey: 'k1', maxAttempts: 2 });
    expect(id).not.toBeNull();
    expect(await enqueueJob(db, 'test.job', { n: 2 }, { dedupeKey: 'k1' })).toBeNull();

    const [a, b] = await Promise.all([claimJob(db, 'w1', ['test.job'], 60_000), claimJob(db, 'w2', ['test.job'], 60_000)]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    const job = claimed[0]!;

    await failJob(db, job, job.lockedBy!, 'boom', { delayMs: 0 });
    expect((await getJob(db, job.id))?.status).toBe('queued');

    const again = await claimJob(db, 'w3', ['test.job'], -1000); // already-expired lease
    expect(again?.attempts).toBe(2);
    expect(await recoverExpiredJobs(db)).toBe(1);
    const third = await claimJob(db, 'w4', ['test.job'], 60_000);
    await failJob(db, third!, 'w4', 'boom again');
    expect((await getJob(db, job.id))?.status).toBe('dead');

    const done = await enqueueJob(db, 'test.job', {}, { dedupeKey: 'k1' });
    expect(done).not.toBeNull(); // dedupe only applies while pending
    const c = await claimJob(db, 'w5', ['test.job'], 60_000);
    await completeJob(db, c!.id, 'w5');
    expect((await getJob(db, c!.id))?.status).toBe('done');
  });

  it('guild locks are exclusive until released or expired', async () => {
    expect(await acquireGuildLock(db, G1, 'h1', 'apply', 60_000)).toBe(true);
    expect(await acquireGuildLock(db, G1, 'h2', 'apply', 60_000)).toBe(false);
    expect(await acquireGuildLock(db, G1, 'h1', 'apply', 60_000)).toBe(true);
    await releaseGuildLock(db, G1, 'h1');
    expect(await acquireGuildLock(db, G1, 'h2', 'apply', -1)).toBe(true);
    expect(await acquireGuildLock(db, G1, 'h3', 'apply', 60_000)).toBe(true); // h2's lock had expired
  });
});

describe('builder persistence', () => {
  it('versions plans and refuses a replayed confirmation nonce', async () => {
    const session = await createBuildSession(db, { guildId: G1, createdBy: 'u', source: 'discord', prompt: 'x' });
    const base = { sessionId: session.id, guildId: G1, plan: {}, validation: {}, planHash: 'h', createdBy: 'u' };
    const v1 = await addPlanVersion(db, base);
    const v2 = await addPlanVersion(db, { ...base, instruction: 'more voice' });
    expect([v1.version, v2.version]).toEqual([1, 2]);

    const exec = { guildId: G1, kind: 'apply' as const, planVersionId: v2.id, ops: [], confirmedBy: 'u', confirmationNonce: 'nonce-1' };
    expect(await createExecution(db, exec)).not.toBeNull();
    expect(await createExecution(db, exec)).toBeNull();
  });
});

describe('community', () => {
  it('awards XP respecting cooldown and reports level-ups', async () => {
    const first = await awardXp(db, G1, 'chatty', 150, 60);
    expect(first).toMatchObject({ awarded: true, xp: 150, level: 1, previousLevel: 0 });
    const blocked = await awardXp(db, G1, 'chatty', 150, 60);
    expect(blocked.awarded).toBe(false);
    const noCooldown = await awardXp(db, G1, 'chatty', 200, 0);
    expect(noCooldown).toMatchObject({ awarded: true, xp: 350, level: 2, previousLevel: 1 });
  });

  it('claims due scheduled messages exactly once and advances recurring ones', async () => {
    const past = new Date(Date.now() - 1000);
    await createScheduledMessage(db, { guildId: G1, channelId: 'c', content: 'once', nextRunAt: past, createdBy: 'u' });
    await createScheduledMessage(db, { guildId: G1, channelId: 'c', content: 'hourly', nextRunAt: past, intervalMinutes: 60, createdBy: 'u' });
    const [a, b] = await Promise.all([claimDueScheduledMessages(db), claimDueScheduledMessages(db)]);
    expect(a.length + b.length).toBe(2);
    expect(await claimDueScheduledMessages(db)).toEqual([]);
  });

  it('ends a giveaway only once', async () => {
    const g = await createGiveaway(db, { guildId: G1, channelId: 'c', prize: 'cake', hostId: 'h', endsAt: new Date() });
    expect(await finishGiveaway(db, G1, g.id, ['w'])).toBe(true);
    expect(await finishGiveaway(db, G1, g.id, ['w2'])).toBe(false);
    expect(await finishGiveaway(db, G2, g.id, ['w3'])).toBe(false);
  });
});
