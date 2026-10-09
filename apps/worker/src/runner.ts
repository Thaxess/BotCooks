import { claimJob, completeJob, extendJobLease, failJob, releaseJob, type Database, type JobRow } from '@botcooks/database';
import type { Logger } from '@botcooks/shared';

export type JobResult = { kind: 'done' } | { kind: 'retry'; delayMs: number; consumeAttempt?: boolean; error?: string } | { kind: 'fail'; error: string };

export type JobHandler = (job: JobRow, ctx: { heartbeat: () => Promise<void> }) => Promise<JobResult | void>;

const LEASE_MS = 90_000;

/**
 * Polls the jobs table and runs handlers with bounded concurrency. Each running job renews its
 * lease every 30 s; if this process dies, `recoverExpiredJobs` requeues the job elsewhere.
 */
export class JobRunner {
  private running = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly workerId: string,
    private readonly handlers: Record<string, JobHandler>,
    private readonly log: Logger,
    private readonly concurrency = 3,
  ) {}

  start() {
    const tick = async () => {
      if (this.stopped) return;
      try {
        while (!this.stopped && this.running < this.concurrency) {
          const job = await claimJob(this.db, this.workerId, Object.keys(this.handlers), LEASE_MS);
          if (!job) break;
          this.running++;
          const p = this.run(job).finally(() => {
            this.running--;
            this.active.delete(p);
          });
          this.active.add(p);
        }
      } catch (e) {
        this.log.error('job poll failed', { error: e });
      }
      if (!this.stopped) this.timer = setTimeout(tick, 1000);
    };
    void tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.active]);
  }

  private async run(job: JobRow) {
    const log = this.log.child({ jobId: job.id, type: job.type, guildId: job.guildId });
    const handler = this.handlers[job.type]!;
    const heartbeat = async () => {
      await extendJobLease(this.db, job.id, this.workerId, LEASE_MS);
    };
    const interval = setInterval(() => void heartbeat().catch(() => undefined), 30_000);
    const started = Date.now();
    try {
      const result = (await handler(job, { heartbeat })) ?? { kind: 'done' as const };
      if (result.kind === 'done') {
        await completeJob(this.db, job.id, this.workerId);
        log.info('job done', { ms: Date.now() - started });
      } else if (result.kind === 'retry') {
        if (result.consumeAttempt === false) await releaseJob(this.db, job, this.workerId, result.delayMs);
        else await failJob(this.db, job, this.workerId, result.error ?? 'retry requested', { delayMs: result.delayMs });
        log.info('job deferred', { delayMs: result.delayMs });
      } else {
        await failJob(this.db, job, this.workerId, result.error, { retry: false });
        log.warn('job failed permanently', { error: result.error });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await failJob(this.db, job, this.workerId, message).catch(() => undefined);
      log.error('job threw', { error: e, attempt: job.attempts });
    } finally {
      clearInterval(interval);
    }
  }
}
