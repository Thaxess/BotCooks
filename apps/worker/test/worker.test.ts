import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@botcooks/database/testing';
import { enqueueJob, getJob, type DbHandle } from '@botcooks/database';
import { createLogger } from '@botcooks/shared';
import { JobRunner } from '../src/runner';
import { pickWinners } from '../src/periodic';

let handle: DbHandle;
beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(async () => handle.close());

const waitFor = async (check: () => Promise<boolean>, ms = 5000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
};

describe('JobRunner', () => {
  it('runs handlers, defers busy jobs without consuming attempts, and records failures', async () => {
    const { db } = handle;
    let busyCalls = 0;
    const runner = new JobRunner(
      db,
      'test-worker',
      {
        ok: async () => ({ kind: 'done' }),
        busy: async () => (++busyCalls < 2 ? { kind: 'retry', delayMs: 0, consumeAttempt: false } : { kind: 'done' }),
        boom: async () => {
          throw new Error('kaboom');
        },
      },
      createLogger('test'),
    );
    const ok = (await enqueueJob(db, 'ok', {}))!;
    const busy = (await enqueueJob(db, 'busy', {}))!;
    const boom = (await enqueueJob(db, 'boom', {}, { maxAttempts: 1 }))!;
    runner.start();
    await waitFor(async () => (await getJob(db, ok))?.status === 'done' && (await getJob(db, busy))?.status === 'done' && (await getJob(db, boom))?.status === 'dead');
    await runner.stop();
    expect((await getJob(db, busy))?.attempts).toBe(1);
    expect((await getJob(db, boom))?.lastError).toBe('kaboom');
  });
});

describe('pickWinners', () => {
  it('picks distinct winners and handles too few entrants', () => {
    const winners = pickWinners(['a', 'b', 'c', 'd'], 3);
    expect(new Set(winners).size).toBe(3);
    expect(pickWinners(['a'], 3)).toEqual(['a']);
    expect(pickWinners([], 1)).toEqual([]);
  });
});
