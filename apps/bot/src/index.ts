import { Client, Events, GatewayIntentBits, Partials, type ClientOptions } from 'discord.js';
import { z } from 'zod';
import { createProviderFromEnv } from '@botcooks/ai';
import { createDb, upsertGuild, waitForSchema } from '@botcooks/database';
import { createRest, fetchGuildSnapshot } from '@botcooks/discord';
import { baseEnvSchema, createLogger, discordEnvSchema, parseEnv, publicUrlSchema } from '@botcooks/shared';
import { SettingsCache, type BotContext } from './context';
import { registerEvents } from './features/events';
import { routeInteraction } from './interactions/router';

const log = createLogger('bot');

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const env = parseEnv(
  baseEnvSchema
    .merge(discordEnvSchema)
    .merge(publicUrlSchema)
    .extend({
      /**
       * Privileged intents. They must ALSO be enabled in the Discord developer portal
       * (Bot -> Privileged Gateway Intents), otherwise login fails with "disallowed intents".
       */
      BOT_INTENT_MEMBERS: bool,
      BOT_INTENT_MESSAGE_CONTENT: bool,
    }),
);

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates];
if (env.BOT_INTENT_MEMBERS) intents.push(GatewayIntentBits.GuildMembers);
if (env.BOT_INTENT_MESSAGE_CONTENT) intents.push(GatewayIntentBits.MessageContent);

const options: ClientOptions = {
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  allowedMentions: { parse: [] },
};
const client = new Client(options);
const { db, close } = createDb(env.DATABASE_URL);
const rest = createRest(env.DISCORD_BOT_TOKEN);

try {
  await waitForSchema(db);
} catch (e) {
  log.error((e as Error).message);
  process.exit(1);
}

client.once(Events.ClientReady, async (ready) => {
  const fetchSnapshot = (guildId: string) => fetchGuildSnapshot(rest, guildId, ready.user.id);
  const ctx: BotContext = {
    client: ready,
    db,
    rest,
    log,
    secret: env.ENCRYPTION_KEY,
    publicUrl: env.PUBLIC_URL,
    builder: { db, secret: env.ENCRYPTION_KEY, fetchSnapshot, provider: createProviderFromEnv() },
    intents: { members: env.BOT_INTENT_MEMBERS, messageContent: env.BOT_INTENT_MESSAGE_CONTENT },
    settings: new SettingsCache(db),
  };
  registerEvents(ctx, ready);
  ready.on(Events.InteractionCreate, (i) => void routeInteraction(ctx, i));
  for (const g of ready.guilds.cache.values()) {
    await upsertGuild(db, { id: g.id, name: g.name, icon: g.icon, ownerId: g.ownerId }).catch((e) => log.warn('guild sync failed', { error: e }));
  }
  log.info('bot ready', {
    user: ready.user.tag,
    guilds: ready.guilds.cache.size,
    privilegedIntents: { members: env.BOT_INTENT_MEMBERS, messageContent: env.BOT_INTENT_MESSAGE_CONTENT },
  });
  if (!env.BOT_INTENT_MEMBERS) log.warn('Server Members intent disabled: welcome, autoroles, anti-raid and member logs will not run.');
  if (!env.BOT_INTENT_MESSAGE_CONTENT) log.warn('Message Content intent disabled: content-based auto-mod, message logs and message workflows are limited.');
});

client.on(Events.Error, (e) => log.error('client error', { error: e }));
client.on(Events.ShardDisconnect, (_e, id) => log.warn('shard disconnected', { shard: id }));

async function shutdown(signal: string) {
  log.info('shutting down', { signal });
  await client.destroy();
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await client.login(env.DISCORD_BOT_TOKEN);
