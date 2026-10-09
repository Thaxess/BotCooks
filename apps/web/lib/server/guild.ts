import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { fetchGuild, fetchGuildChannels, fetchMember } from '@botcooks/discord';
import { getGuildAccess, type AccessResult } from '@botcooks/services';
import { can, type Action } from '@botcooks/security';
import { NotFoundError, isSnowflake, type FeatureKey } from '@botcooks/shared';
import { server } from './context';
import { currentUser, type SessionUser } from './session';

export interface PageAccess extends AccessResult {
  user: SessionUser;
  guildId: string;
}

/** For server-rendered guild pages. Redirects to login, or renders 403, as appropriate. */
export async function requirePageAccess(guildId: string, action: Action = { type: 'view' }): Promise<PageAccess> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=/dashboard/${guildId}`);
  if (!isSnowflake(guildId)) notFound();
  let access: AccessResult;
  try {
    access = await getGuildAccess(server().db, server().rest, guildId, user.id);
  } catch (e) {
    if (e instanceof NotFoundError) redirect(`/dashboard?missing=${guildId}`);
    redirect(`/dashboard?denied=${guildId}`);
  }
  // No access at all -> back to the picker; otherwise to the overview (which they can view).
  if (access.access.tier === 'none') redirect(`/dashboard?denied=${guildId}`);
  if (!can(access.access, action)) redirect(`/dashboard/${guildId}?denied=1`);
  return { ...access, user, guildId };
}

export function canConfigure(access: AccessResult, feature: FeatureKey) {
  return can(access.access, { type: 'configure', feature });
}

export interface GuildResources {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  features: string[];
  roles: Array<{ id: string; name: string; color: number; position: number; managed: boolean; permissions: string }>;
  channels: Array<{ id: string; name: string; type: number; parentId: string | null; position: number }>;
  botTopPosition: number;
  botPermissions: string;
}

const cache = new Map<string, { value: GuildResources; expires: number }>();

/** Roles/channels for pickers and diagnostics, fetched with the bot token (cached 20 s). */
export async function guildResources(guildId: string): Promise<GuildResources> {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { rest } = server();
  const botUserId = await server().botUserId;
  const [guild, channels, me] = await Promise.all([fetchGuild(rest, guildId), fetchGuildChannels(rest, guildId), fetchMember(rest, guildId, botUserId)]);
  const botRoles = guild.roles.filter((r) => me?.roles.includes(r.id) || r.id === guildId);
  let perms = 0n;
  for (const r of botRoles) perms |= BigInt(r.permissions);
  const value: GuildResources = {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    ownerId: guild.owner_id,
    features: guild.features,
    roles: guild.roles
      .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed, permissions: r.permissions }))
      .sort((a, b) => b.position - a.position),
    channels: channels
      .map((c) => {
        const ch = c as unknown as { id: string; name?: string; type: number; parent_id?: string | null; position?: number };
        return { id: ch.id, name: ch.name ?? '', type: ch.type, parentId: ch.parent_id ?? null, position: ch.position ?? 0 };
      })
      .sort((a, b) => a.position - b.position),
    botTopPosition: botRoles.reduce((m, r) => Math.max(m, r.position), 0),
    botPermissions: perms.toString(),
  };
  cache.set(guildId, { value, expires: Date.now() + 20_000 });
  return value;
}

export function invalidateGuildResources(guildId: string) {
  cache.delete(guildId);
}
