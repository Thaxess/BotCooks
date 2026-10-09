import { REST, Routes } from 'discord.js';
import { discordEnvSchema, parseEnv } from '@botcooks/shared';
import { z } from 'zod';
import { commandDefinitions } from './commands/definitions';

/**
 * Registers BotCooks' built-in slash commands.
 *   DEV_GUILD_ID set   -> registers to that guild only (updates instantly; for development)
 *   otherwise          -> registers globally
 * Per-guild custom commands from the visual builder are synced separately by the worker.
 */
const env = parseEnv(discordEnvSchema.extend({ DEV_GUILD_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{17,20}$/, 'DEV_GUILD_ID must be a server ID').optional()) }));
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
const body = commandDefinitions.map((c) => c.toJSON());

const route = env.DEV_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
let result: unknown[];
try {
  result = (await rest.put(route, { body })) as unknown[];
} catch (e) {
  if ((e as { code?: number }).code === 50001 && env.DEV_GUILD_ID) {
    console.error(
      `Discord says "Missing Access": BotCooks is not in server ${env.DEV_GUILD_ID} yet (or was invited without the applications.commands scope).\n` +
        `Invite it first, then run this again:\n` +
        `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=564444890492054&guild_id=${env.DEV_GUILD_ID}&disable_guild_select=true`,
    );
  } else {
    console.error('Registering commands failed:', (e as Error).message);
  }
  process.exitCode = 1;
  result = [];
}
if (result.length) console.log(`Registered ${result.length} commands ${env.DEV_GUILD_ID ? `to guild ${env.DEV_GUILD_ID}` : 'globally'}.`);
