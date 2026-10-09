import { z } from 'zod';
import { FEATURES, type FeatureKey } from './features';

/**
 * Per-guild settings. Stored as one JSON document per guild and always parsed through this
 * schema, so new fields pick up defaults without data migrations. Every ID is a Discord ID string.
 */
const id = z.string().regex(/^\d{17,20}$/);
const optId = id.optional();
const idList = z.array(id).max(50).default([]);

const featureDefaults = Object.fromEntries(FEATURES.map((f) => [f.key, f.defaultEnabled])) as Record<FeatureKey, boolean>;

export const featureFlagsSchema = z
  .object(Object.fromEntries(FEATURES.map((f) => [f.key, z.boolean().default(f.defaultEnabled)])) as Record<FeatureKey, z.ZodDefault<z.ZodBoolean>>)
  .default(featureDefaults as never);

export const escalationRuleSchema = z.object({
  warnings: z.number().int().min(1).max(50),
  action: z.enum(['timeout', 'kick', 'ban']),
  durationMinutes: z.number().int().min(1).max(40320).optional(),
});

export const moderationSettingsSchema = z.object({
  modLogChannelId: optId,
  dmOnAction: z.boolean().default(true),
  requireReason: z.boolean().default(false),
  /** Applied automatically when a member's active warning count reaches `warnings`. */
  escalation: z.array(escalationRuleSchema).max(10).default([]),
  warningExpiryDays: z.number().int().min(0).max(3650).default(0),
  appealsEnabled: z.boolean().default(false),
  appealsChannelId: optId,
  maxPurge: z.number().int().min(1).max(1000).default(100),
});

export const automodSettingsSchema = z.object({
  spam: z
    .object({
      enabled: z.boolean().default(true),
      maxMessages: z.number().int().min(2).max(50).default(6),
      perSeconds: z.number().int().min(2).max(120).default(5),
      duplicateThreshold: z.number().int().min(2).max(20).default(3),
    })
    .default({ enabled: true, maxMessages: 6, perSeconds: 5, duplicateThreshold: 3 }),
  maxMentionsPerMessage: z.number().int().min(0).max(50).default(5),
  blockInvites: z.boolean().default(true),
  blockLinks: z.boolean().default(false),
  allowedDomains: z.array(z.string().trim().toLowerCase().max(253)).max(100).default([]),
  blockedTerms: z.array(z.string().trim().toLowerCase().min(1).max(100)).max(500).default([]),
  exemptRoleIds: idList,
  exemptChannelIds: idList,
  action: z.enum(['delete', 'delete_warn', 'delete_timeout']).default('delete'),
  timeoutMinutes: z.number().int().min(1).max(40320).default(10),
  alertChannelId: optId,
});

export const antiraidSettingsSchema = z.object({
  joinThreshold: z.number().int().min(3).max(500).default(10),
  perSeconds: z.number().int().min(5).max(600).default(30),
  minAccountAgeDays: z.number().int().min(0).max(365).default(3),
  action: z.enum(['alert', 'lockdown']).default('alert'),
  alertChannelId: optId,
  lockdownActive: z.boolean().default(false),
  /** Channels locked by the last lockdown, with their previous @everyone SendMessages state, for restoring. */
  lockedChannels: z.array(z.object({ channelId: id, previousDeny: z.string(), previousAllow: z.string() })).max(500).default([]),
  verification: z
    .object({ enabled: z.boolean().default(false), verifiedRoleId: optId, channelId: optId })
    .default({ enabled: false }),
});

export const loggingSettingsSchema = z.object({
  memberLogChannelId: optId,
  serverLogChannelId: optId,
  modLogChannelId: optId,
  messageLogChannelId: optId,
  /** Message logging needs the privileged Message Content intent and is opt-in. */
  logMessageEdits: z.boolean().default(false),
  logMessageDeletes: z.boolean().default(false),
  /** Message content in logs is truncated/redacted unless explicitly turned off. */
  redactMessageContent: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(365).default(30),
});

export const welcomeSettingsSchema = z.object({
  channelId: optId,
  message: z.string().max(2000).default('Welcome to **{server}**, {user}! You are member #{count}.'),
  useEmbed: z.boolean().default(true),
  goodbyeEnabled: z.boolean().default(false),
  goodbyeChannelId: optId,
  goodbyeMessage: z.string().max(2000).default('{username} left the server.'),
  dmEnabled: z.boolean().default(false),
  dmMessage: z.string().max(2000).default('Welcome to {server}!'),
});

export const autorolesSettingsSchema = z.object({
  roleIds: idList,
  botRoleIds: idList,
});

export const levelsSettingsSchema = z.object({
  xpMin: z.number().int().min(1).max(500).default(15),
  xpMax: z.number().int().min(1).max(1000).default(25),
  cooldownSeconds: z.number().int().min(0).max(3600).default(60),
  announce: z.enum(['off', 'current', 'channel', 'dm']).default('current'),
  announceChannelId: optId,
  message: z.string().max(1000).default('🎉 {user} reached level **{level}**!'),
  rewards: z.array(z.object({ level: z.number().int().min(1).max(1000), roleId: id })).max(50).default([]),
  stackRewards: z.boolean().default(true),
  noXpRoleIds: idList,
  noXpChannelIds: idList,
});

export const ticketsSettingsSchema = z.object({
  panelChannelId: optId,
  staffRoleIds: idList,
  maxOpenPerUser: z.number().int().min(1).max(10).default(1),
  logChannelId: optId,
  openMessage: z.string().max(2000).default('Thanks for reaching out! Describe your issue and a staff member will help soon.'),
});

export const tempVoiceSettingsSchema = z.object({
  hubChannelId: optId,
  categoryId: optId,
  nameTemplate: z.string().min(1).max(90).default("{user}'s room"),
  userLimit: z.number().int().min(0).max(99).default(0),
});

export const builderSettingsSchema = z.object({
  /** Wiping is off unless the owner explicitly enables it. */
  allowWipe: z.boolean().default(false),
  defaultMode: z.enum(['additive', 'update']).default('additive'),
});

export const guildSettingsSchema = z.object({
  features: featureFlagsSchema,
  moderation: moderationSettingsSchema.default(moderationSettingsSchema.parse({})),
  automod: automodSettingsSchema.default(automodSettingsSchema.parse({})),
  antiraid: antiraidSettingsSchema.default(antiraidSettingsSchema.parse({})),
  logging: loggingSettingsSchema.default(loggingSettingsSchema.parse({})),
  welcome: welcomeSettingsSchema.default(welcomeSettingsSchema.parse({})),
  autoroles: autorolesSettingsSchema.default(autorolesSettingsSchema.parse({})),
  levels: levelsSettingsSchema.default(levelsSettingsSchema.parse({})),
  tickets: ticketsSettingsSchema.default(ticketsSettingsSchema.parse({})),
  tempVoice: tempVoiceSettingsSchema.default(tempVoiceSettingsSchema.parse({})),
  builder: builderSettingsSchema.default(builderSettingsSchema.parse({})),
});

export type GuildSettings = z.infer<typeof guildSettingsSchema>;
export type SettingsSection = Exclude<keyof GuildSettings, 'features'>;

export const SETTINGS_SECTIONS = {
  moderation: moderationSettingsSchema,
  automod: automodSettingsSchema,
  antiraid: antiraidSettingsSchema,
  logging: loggingSettingsSchema,
  welcome: welcomeSettingsSchema,
  autoroles: autorolesSettingsSchema,
  levels: levelsSettingsSchema,
  tickets: ticketsSettingsSchema,
  tempVoice: tempVoiceSettingsSchema,
  builder: builderSettingsSchema,
} as const satisfies Record<SettingsSection, z.ZodType>;

/** Which feature flag governs each settings section (used for delegated access checks). */
export const SECTION_FEATURE: Record<SettingsSection, FeatureKey> = {
  moderation: 'moderation',
  automod: 'automod',
  antiraid: 'antiraid',
  logging: 'logging',
  welcome: 'welcome',
  autoroles: 'autoroles',
  levels: 'levels',
  tickets: 'tickets',
  tempVoice: 'tempVoice',
  builder: 'builder',
};

export function parseGuildSettings(raw: unknown): GuildSettings {
  const result = guildSettingsSchema.safeParse(raw ?? {});
  // Corrupt or outdated documents fall back to defaults section by section rather than failing.
  if (result.success) return result.data;
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(guildSettingsSchema.shape) as Array<keyof GuildSettings>) {
    const section = guildSettingsSchema.shape[key].safeParse(obj[key]);
    out[key] = section.success ? section.data : guildSettingsSchema.shape[key].parse(undefined);
  }
  return out as GuildSettings;
}

export const DEFAULT_GUILD_SETTINGS: GuildSettings = guildSettingsSchema.parse({});

/** Level curve: XP required to go from level n to n+1 (same shape most community bots use). */
export function xpForNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function levelFromXp(totalXp: number): { level: number; intoLevel: number; needed: number } {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
    if (level > 10_000) break;
  }
  return { level, intoLevel: remaining, needed: xpForNextLevel(level) };
}

/** Renders {user} {username} {server} {count} {level} placeholders. Unknown placeholders stay as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}
