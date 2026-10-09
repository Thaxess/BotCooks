import { z } from 'zod';
import { hashValue } from './stable-json';

/**
 * Point-in-time view of a guild's structure, fetched server-side with the bot token.
 * Used for diffing, confirmation binding, pre-change backups and rollback.
 * Permission bitfields are decimal strings (as Discord sends them) to avoid bigint JSON issues.
 */
export const snapshotOverwriteSchema = z.object({
  id: z.string(),
  /** 0 = role, 1 = member */
  type: z.union([z.literal(0), z.literal(1)]),
  allow: z.string(),
  deny: z.string(),
});
export type SnapshotOverwrite = z.infer<typeof snapshotOverwriteSchema>;

export const snapshotRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().int(),
  hoist: z.boolean(),
  mentionable: z.boolean(),
  position: z.number().int(),
  permissions: z.string(),
  /** Managed roles belong to integrations/bots and cannot be edited or assigned. */
  managed: z.boolean(),
});
export type SnapshotRole = z.infer<typeof snapshotRoleSchema>;

export const snapshotChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Raw Discord channel type number. */
  type: z.number().int(),
  parentId: z.string().nullable(),
  position: z.number().int(),
  topic: z.string().nullable().optional(),
  nsfw: z.boolean().optional(),
  rateLimitPerUser: z.number().int().optional(),
  userLimit: z.number().int().optional(),
  bitrate: z.number().int().optional(),
  overwrites: z.array(snapshotOverwriteSchema),
});
export type SnapshotChannel = z.infer<typeof snapshotChannelSchema>;

export const guildSnapshotSchema = z.object({
  guildId: z.string(),
  name: z.string(),
  ownerId: z.string(),
  /** Discord guild feature flags, e.g. COMMUNITY. */
  features: z.array(z.string()),
  roles: z.array(snapshotRoleSchema),
  channels: z.array(snapshotChannelSchema),
  /** Rules / public-updates / system / safety-alert channels: never deleted by plans. */
  protectedChannelIds: z.array(z.string()).default([]),
  bot: z.object({
    userId: z.string(),
    /** Highest position among the bot's roles; it can only manage roles strictly below this. */
    highestRolePosition: z.number().int(),
    /** Effective guild-level permissions of the bot. */
    permissions: z.string(),
  }),
  capturedAt: z.string(),
});
export type GuildSnapshot = z.infer<typeof guildSnapshotSchema>;

/**
 * Hash of the structural parts of a snapshot. Excludes capture time so two fetches of an
 * unchanged server hash identically, which is what confirmation binding relies on.
 */
export function snapshotHash(snapshot: GuildSnapshot): string {
  return hashValue({
    guildId: snapshot.guildId,
    ownerId: snapshot.ownerId,
    features: [...snapshot.features].sort(),
    roles: [...snapshot.roles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name, color, hoist, mentionable, position, permissions, managed }) => ({
        id,
        name,
        color,
        hoist,
        mentionable,
        position,
        permissions,
        managed,
      })),
    channels: [...snapshot.channels]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
        topic: c.topic ?? null,
        nsfw: c.nsfw ?? false,
        rateLimitPerUser: c.rateLimitPerUser ?? 0,
        userLimit: c.userLimit ?? 0,
        overwrites: [...c.overwrites].sort((a, b) => a.id.localeCompare(b.id)),
      })),
    bot: { highestRolePosition: snapshot.bot.highestRolePosition, permissions: snapshot.bot.permissions },
  });
}

/** Discord channel type numbers used by BotCooks. */
export const ChannelTypeNum = {
  GuildText: 0,
  GuildVoice: 2,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  GuildStageVoice: 13,
  GuildForum: 15,
} as const;

export function guildHasCommunity(snapshot: Pick<GuildSnapshot, 'features'>): boolean {
  return snapshot.features.includes('COMMUNITY');
}
