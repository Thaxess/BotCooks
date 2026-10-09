/**
 * Starts a complete local BotCooks stack for end-to-end tests:
 *   PGlite (Postgres wire protocol) -> migrations -> fake Discord -> Next.js dashboard -> worker
 * Everything runs on loopback. Used by playwright.config.ts as its webServer.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createDb, runMigrations, upsertGuild } from '@botcooks/database';
import { IDS, startFakeDiscord } from './fake-discord';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
export const E2E = { webPort: 3100, discordPort: 4010, dbPort: 54400 };

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${E2E.dbPort}/postgres`,
  ENCRYPTION_KEY: 'e2e-only-encryption-key-not-secret-0123456789abcdef',
  DISCORD_CLIENT_ID: IDS.app,
  DISCORD_CLIENT_SECRET: 'e2e-fake-client-secret-0123456789',
  DISCORD_BOT_TOKEN: 'e2e.fake.bot.token.that.is.definitely.long.enough.000000',
  DISCORD_API_BASE_URL: `http://127.0.0.1:${E2E.discordPort}/api`,
  PUBLIC_URL: `http://localhost:${E2E.webPort}`,
  AI_PROVIDER: 'mock',
  RUN_MIGRATIONS: 'false',
  STREAM_POLL_SECONDS: '3600',
  LOG_LEVEL: 'warn',
};

const db = new PGlite();
const pgServer = new PGLiteSocketServer({ db, port: E2E.dbPort, host: '127.0.0.1', maxConnections: 40 });
await pgServer.start();
await runMigrations(env.DATABASE_URL);
// The bot normally registers guilds on join; no gateway bot runs in e2e, so seed it here.
const seed = createDb(env.DATABASE_URL, { max: 1 });
await upsertGuild(seed.db, { id: IDS.guild, name: 'Fake Kitchen', icon: null, ownerId: IDS.owner });
await seed.close();
const discord = startFakeDiscord(E2E.discordPort);

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[], cwd: string) {
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  child.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => console.log(`[${name}] exited with ${code}`));
  children.push(child);
}

run('web', 'npx', ['next', 'dev', '--port', String(E2E.webPort)], path.join(root, 'apps/web'));
run('worker', 'npx', ['tsx', 'src/index.ts'], path.join(root, 'apps/worker'));

async function shutdown() {
  for (const c of children) c.kill();
  discord.close();
  await pgServer.stop();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
