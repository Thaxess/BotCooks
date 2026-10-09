import type { REST } from '@discordjs/rest';
import type { Client, Guild, GuildMember, Role } from 'discord.js';
import { getSettings, type Database } from '@botcooks/database';
import { DANGEROUS_PERMISSIONS, type GuildSettings, type Logger, type PermissionName } from '@botcooks/shared';
import type { BuilderDeps } from '@botcooks/services';
import { PermissionsBitField } from 'discord.js';

export interface BotContext {
  client: Client<true>;
  db: Database;
  rest: REST;
  log: Logger;
  secret: string;
  publicUrl: string | undefined;
  builder: BuilderDeps;
  intents: { members: boolean; messageContent: boolean };
  settings: SettingsCache;
}

/**
 * Settings are read on hot paths (every message). Cache briefly; dashboard edits show up within
 * the TTL. Writes from the bot itself call `invalidate`.
 */
export class SettingsCache {
  private cache = new Map<string, { value: GuildSettings; expires: number }>();
  constructor(
    private readonly db: Database,
    private readonly ttlMs = 30_000,
  ) {}

  async get(guildId: string): Promise<GuildSettings> {
    const hit = this.cache.get(guildId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const { settings } = await getSettings(this.db, guildId);
    this.cache.set(guildId, { value: settings, expires: Date.now() + this.ttlMs });
    return settings;
  }

  invalidate(guildId: string) {
    this.cache.delete(guildId);
  }
}

/** Highest role position of a member (owner treated as infinitely high). */
export function memberTop(member: GuildMember): number {
  if (member.id === member.guild.ownerId) return Number.MAX_SAFE_INTEGER;
  return member.roles.highest.position;
}

export type HierarchyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Discord-side guard for moderation: the actor must outrank the target, the bot must outrank the
 * target, and nobody can act on the owner, themselves, or the bot.
 */
export function canModerate(actor: GuildMember, target: GuildMember, me: GuildMember): HierarchyCheck {
  if (target.id === actor.id) return { ok: false, reason: 'You cannot do that to yourself.' };
  if (target.id === me.id) return { ok: false, reason: 'I cannot do that to myself.' };
  if (target.id === target.guild.ownerId) return { ok: false, reason: 'The server owner cannot be moderated.' };
  if (memberTop(actor) <= memberTop(target)) return { ok: false, reason: 'Your highest role must be above theirs.' };
  if (me.roles.highest.position <= target.roles.highest.position) return { ok: false, reason: 'My highest role must be above theirs.' };
  return { ok: true };
}

/** Roles that may be handed out by panels, autoroles, level rewards and workflows. */
export function isAssignableRole(role: Role, me: GuildMember): HierarchyCheck {
  if (role.managed) return { ok: false, reason: `${role.name} is managed by an integration.` };
  if (role.id === role.guild.id) return { ok: false, reason: '@everyone cannot be assigned.' };
  if (role.position >= me.roles.highest.position) return { ok: false, reason: `${role.name} is above my highest role.` };
  const perms = new PermissionsBitField(role.permissions.bitfield);
  for (const p of DANGEROUS_PERMISSIONS) {
    if (perms.has(PermissionsBitField.Flags[p as PermissionName & keyof typeof PermissionsBitField.Flags], false)) {
      return { ok: false, reason: `${role.name} has powerful permissions (${p}) and cannot be self-assigned or auto-assigned.` };
    }
  }
  return { ok: true };
}

export async function getMe(guild: Guild): Promise<GuildMember> {
  return guild.members.me ?? (await guild.members.fetchMe());
}
