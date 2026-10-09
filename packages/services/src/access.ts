import type { REST } from '@discordjs/rest';
import { fetchGuild, fetchMember } from '@botcooks/discord';
import { listDelegations, type Database } from '@botcooks/database';
import { ForbiddenError, NotFoundError } from '@botcooks/shared';
import { can, resolveAccess, type Access, type Action, type DelegableScope } from '@botcooks/security';

interface CacheEntry {
  access: Access;
  ownerId: string;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

export interface AccessResult {
  access: Access;
  ownerId: string;
}

/**
 * Resolves a user's access to a guild from Discord (bot token) plus stored delegations.
 * `fresh: true` bypasses the short cache and must be used before any sensitive action.
 */
export async function getGuildAccess(
  db: Database,
  rest: REST,
  guildId: string,
  userId: string,
  opts: { fresh?: boolean } = {},
): Promise<AccessResult> {
  const key = `${guildId}:${userId}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && hit.expires > Date.now()) return { access: hit.access, ownerId: hit.ownerId };

  let guild;
  try {
    guild = await fetchGuild(rest, guildId);
  } catch {
    throw new NotFoundError('BotCooks is not in that server, or it does not exist.');
  }
  const member = await fetchMember(rest, guildId, userId);
  if (!member) throw new ForbiddenError('You are not a member of that server.');
  const delegations = await listDelegations(db, guildId);
  const access = resolveAccess({
    userId,
    guildId,
    guildOwnerId: guild.owner_id,
    memberRoleIds: member.roles,
    guildRoles: guild.roles.map((r) => ({ id: r.id, permissions: r.permissions })),
    delegations: delegations.map((d) => ({ roleId: d.roleId, scopes: d.scopes as DelegableScope[] })),
  });
  cache.set(key, { access, ownerId: guild.owner_id, expires: Date.now() + CACHE_MS });
  if (cache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  }
  return { access, ownerId: guild.owner_id };
}

export function invalidateAccess(guildId: string, userId?: string) {
  for (const key of cache.keys()) {
    if (userId ? key === `${guildId}:${userId}` : key.startsWith(`${guildId}:`)) cache.delete(key);
  }
}

/** Throws ForbiddenError unless `action` is allowed. */
export async function requireAccess(
  db: Database,
  rest: REST,
  guildId: string,
  userId: string,
  action: Action,
  opts: { fresh?: boolean } = {},
): Promise<AccessResult> {
  const result = await getGuildAccess(db, rest, guildId, userId, opts);
  if (!can(result.access, action)) throw new ForbiddenError();
  return result;
}
