import 'server-only';
import { z } from 'zod';
import { discordApiBaseOverride, permissionsToBitfield, type PermissionName } from '@botcooks/shared';
import { env } from './env';

/** What BotCooks asks for when invited. Deliberately NOT Administrator. */
export const BOT_INVITE_PERMISSIONS: PermissionName[] = [
  'ManageRoles',
  'ManageChannels',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ViewAuditLog',
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'ManageMessages',
  'EmbedLinks',
  'ReadMessageHistory',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'ManageThreads',
  'Connect',
  'Speak',
  'MoveMembers',
  'SendPolls',
];

/**
 * Discord OAuth2 (authorization code grant). Scopes: `identify` (who you are) and `guilds`
 * (which servers you are in, with your permission bits there). BotCooks never asks for more.
 */
export const OAUTH_SCOPES = ['identify', 'guilds'] as const;
// Overridable only for automated tests against a local fake Discord (loopback URLs only).
const API_ROOT = discordApiBaseOverride() ?? 'https://discord.com/api';
const API = `${API_ROOT}/v10`;
const AUTHORIZE = discordApiBaseOverride() ? `${new URL(API_ROOT).origin}/oauth2/authorize` : 'https://discord.com/oauth2/authorize';

export function redirectUri() {
  return `${env().PUBLIC_URL}/api/auth/callback`;
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env().DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES.join(' '),
    state,
    prompt: 'none',
  });
  return `${AUTHORIZE}?${params}`;
}

/** Bot invite link with the permissions BotCooks features use (admins can untick any of them). */
export function inviteUrl(guildId?: string) {
  const permissions = permissionsToBitfield(BOT_INVITE_PERMISSIONS).toString();
  const params = new URLSearchParams({
    client_id: env().DISCORD_CLIENT_ID,
    scope: 'bot applications.commands',
    permissions,
    ...(guildId ? { guild_id: guildId, disable_guild_select: 'true' } : {}),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
});

async function tokenRequest(body: Record<string, string>) {
  const e = env();
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${e.DISCORD_CLIENT_ID}:${e.DISCORD_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const parsed = tokenSchema.safeParse(await res.json());
  if (!parsed.success) return null;
  const granted = new Set(parsed.data.scope.split(' '));
  if (!OAUTH_SCOPES.every((s) => granted.has(s))) return null;
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token ?? null, expiresIn: parsed.data.expires_in };
}

export function exchangeCode(code: string) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

const userSchema = z.object({ id: z.string(), username: z.string(), global_name: z.string().nullable().optional(), avatar: z.string().nullable().optional() });

export async function fetchDiscordUser(accessToken: string) {
  const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const parsed = userSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

const userGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  permissions: z.string(),
});
export type UserGuild = z.infer<typeof userGuildSchema>;

const guildCache = new Map<string, { guilds: UserGuild[]; expires: number }>();

/**
 * The guilds the user is in (from Discord, via their OAuth token). Used only to build the server
 * picker; every guild page re-checks access with the bot token before showing anything.
 */
export async function fetchUserGuilds(sessionId: string, accessToken: string): Promise<UserGuild[] | null> {
  const hit = guildCache.get(sessionId);
  if (hit && hit.expires > Date.now()) return hit.guilds;
  const res = await fetch(`${API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const parsed = z.array(userGuildSchema).safeParse(await res.json());
  if (!parsed.success) return null;
  guildCache.set(sessionId, { guilds: parsed.data, expires: Date.now() + 60_000 });
  return parsed.data;
}
