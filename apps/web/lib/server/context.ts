import 'server-only';
import type { REST } from '@discordjs/rest';
import { Routes, type APIUser } from 'discord-api-types/v10';
import { createProviderFromEnv, type AIProvider } from '@botcooks/ai';
import { createDb, type Database } from '@botcooks/database';
import { createRest, fetchGuildSnapshot } from '@botcooks/discord';
import type { BuilderDeps } from '@botcooks/services';
import { createLogger, type Logger } from '@botcooks/shared';
import { env } from './env';

interface ServerContext {
  db: Database;
  rest: REST;
  log: Logger;
  provider: AIProvider | null;
  botUserId: Promise<string>;
}

// Kept on globalThis so dev hot-reloads do not open new database pools each time.
const g = globalThis as unknown as { __botcooks?: ServerContext };

export function server(): ServerContext {
  if (!g.__botcooks) {
    const e = env();
    const rest = createRest(e.DISCORD_BOT_TOKEN);
    g.__botcooks = {
      db: createDb(e.DATABASE_URL, { max: 5 }).db,
      rest,
      log: createLogger('web'),
      provider: createProviderFromEnv(),
      botUserId: (rest.get(Routes.user('@me')) as Promise<APIUser>).then((u) => u.id),
    };
  }
  return g.__botcooks;
}

export async function builderDeps(): Promise<BuilderDeps> {
  const s = server();
  const botUserId = await s.botUserId;
  return {
    db: s.db,
    secret: env().ENCRYPTION_KEY,
    provider: s.provider,
    fetchSnapshot: (guildId: string) => fetchGuildSnapshot(s.rest, guildId, botUserId),
  };
}
