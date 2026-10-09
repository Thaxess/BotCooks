import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Routes, type APIUser } from 'discord-api-types/v10';
import { createProviderFromEnv } from '@botcooks/ai';
import { createDb, recoverExpiredJobs, runMigrations } from '@botcooks/database';
import { RestDiscordWriter, createRest, fetchGuildSnapshot } from '@botcooks/discord';
import { KickClient, TwitchClient } from '@botcooks/integrations';
import {
  baseEnvSchema,
  createLogger,
  discordEnvSchema,
  integrationsEnvSchema,
  parseEnv,
  publicUrlSchema,
} from '@botcooks/shared';
import { z } from 'zod';
import { createHandlers } from './handlers';
import { endDueGiveaways, every, maintenance, pollStreams, sendScheduledMessages } from './periodic';
import { JobRunner } from './runner';

const log = createLogger('worker');

const env = parseEnv(
  baseEnvSchema
    .merge(discordEnvSchema)
    .merge(integrationsEnvSchema)
    .merge(publicUrlSchema)
    .extend({
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
      RUN_MIGRATIONS: z.enum(['true', 'false']).default('true'),
      STREAM_POLL_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    }),
);

if (env.RUN_MIGRATIONS === 'true') {
  await runMigrations(env.DATABASE_URL);
  log.info('migrations applied');
}

const { db, close } = createDb(env.DATABASE_URL);
const rest = createRest(env.DISCORD_BOT_TOKEN);
const me = (await rest.get(Routes.user('@me'))) as APIUser;
const workerId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
const provider = createProviderFromEnv();
if (!provider) log.warn('AI is not configured (AI_API_KEY missing); only templates will work.');

const fetchSnapshot = (guildId: string) => fetchGuildSnapshot(rest, guildId, me.id);
const writerFor = (guildId: string) => new RestDiscordWriter(rest, guildId, me.id);

const runner = new JobRunner(
  db,
  workerId,
  createHandlers({
    db,
    rest,
    log,
    workerId,
    secret: env.ENCRYPTION_KEY,
    applicationId: env.DISCORD_CLIENT_ID,
    publicUrl: env.PUBLIC_URL,
    builder: { db, secret: env.ENCRYPTION_KEY, fetchSnapshot, provider },
    writerFor,
    fetchSnapshot,
  }),
  log,
  env.WORKER_CONCURRENCY,
);
runner.start();

const periodic = {
  db,
  rest,
  log,
  twitch: env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET ? new TwitchClient(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET) : null,
  kick: env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET ? new KickClient(env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET) : null,
};
const stops = [
  every(15_000, 'scheduled-messages', log, () => sendScheduledMessages(periodic)),
  every(15_000, 'giveaways', log, () => endDueGiveaways(periodic)),
  every(env.STREAM_POLL_SECONDS * 1000, 'streams', log, () => pollStreams(periodic)),
  every(60_000, 'lease-recovery', log, async () => {
    const n = await recoverExpiredJobs(db);
    if (n) log.warn('recovered jobs with expired leases', { recovered: n });
  }),
  every(10 * 60_000, 'maintenance', log, () => maintenance(periodic)),
];

log.info('worker started', { workerId, bot: me.username, ai: provider?.name ?? 'none', concurrency: env.WORKER_CONCURRENCY });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  for (const stop of stops) stop();
  await runner.stop();
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
