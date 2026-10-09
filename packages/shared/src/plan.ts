import { z } from 'zod';
import { PLAN_PERMISSION_NAMES } from './permissions';

/**
 * The declarative server plan. AI providers produce JSON in this shape; it is never executed
 * directly. It is parsed here, validated against Discord constraints in @botcooks/security,
 * and turned into concrete operations by the diff engine in @botcooks/workflows.
 *
 * Cross references use plan-local `key`s (slugs), never Discord IDs, so a plan cannot point
 * at resources the user did not see in the preview.
 */

export const DISCORD_LIMITS = {
  guildChannels: 500,
  channelsPerCategory: 50,
  guildRoles: 250,
  channelName: 100,
  roleName: 100,
  topic: 1024,
  messageContent: 2000,
  embedDescription: 4096,
  slowmodeMax: 21600,
  voiceUserLimitMax: 99,
  stageUserLimitMax: 10000,
} as const;

export const PLAN_LIMITS = {
  roles: 40,
  categories: 20,
  channels: 120,
  overwritesPerTarget: 12,
  selfRolePanels: 6,
  rolesPerPanel: 25,
  blockedTerms: 200,
  suggestedCommands: 20,
  levelRewards: 25,
  streamAlerts: 10,
  summary: 600,
  purpose: 300,
} as const;

export const planKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Keys must be 1-40 lowercase letters, digits, - or _');

const permissionNameSchema = z.enum(PLAN_PERMISSION_NAMES);

/** `everyone` targets the @everyone role; anything else must be a role key in this plan or an existing role name. */
export const overwriteSchema = z.object({
  target: z.string().trim().min(1).max(100),
  allow: z.array(permissionNameSchema).max(40).default([]),
  deny: z.array(permissionNameSchema).max(40).default([]),
});
export type PlanOverwrite = z.infer<typeof overwriteSchema>;

/**
 * Visibility is the preferred, high-level way to express access. It is compiled
 * deterministically into permission overwrites, which keeps AI output simple and auditable.
 *  - public:   inherits server defaults
 *  - readonly: everyone can see, only `accessRoles` can post/speak
 *  - private:  only `accessRoles` can see
 */
export const visibilitySchema = z.enum(['public', 'readonly', 'private']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const channelTypeSchema = z.enum(['text', 'voice', 'announcement', 'forum', 'stage']);
export type PlanChannelType = z.infer<typeof channelTypeSchema>;

export const planChannelSchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(1).max(DISCORD_LIMITS.channelName),
  type: channelTypeSchema.default('text'),
  topic: z.string().trim().max(DISCORD_LIMITS.topic).optional(),
  nsfw: z.boolean().default(false),
  slowmodeSeconds: z.number().int().min(0).max(DISCORD_LIMITS.slowmodeMax).default(0),
  userLimit: z.number().int().min(0).max(DISCORD_LIMITS.stageUserLimitMax).default(0),
  visibility: visibilitySchema.default('public'),
  accessRoles: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  overwrites: z.array(overwriteSchema).max(PLAN_LIMITS.overwritesPerTarget).default([]),
  purpose: z.string().trim().max(PLAN_LIMITS.purpose).optional(),
});
export type PlanChannel = z.infer<typeof planChannelSchema>;

export const planCategorySchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(1).max(DISCORD_LIMITS.channelName),
  visibility: visibilitySchema.default('public'),
  accessRoles: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  overwrites: z.array(overwriteSchema).max(PLAN_LIMITS.overwritesPerTarget).default([]),
  channels: z.array(planChannelSchema).max(DISCORD_LIMITS.channelsPerCategory).default([]),
});
export type PlanCategory = z.infer<typeof planCategorySchema>;

const hexColor = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Colors must be #RRGGBB')
  .transform((v) => (v.startsWith('#') ? v.toUpperCase() : `#${v.toUpperCase()}`));

export const planRoleSchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(1).max(DISCORD_LIMITS.roleName),
  color: hexColor.optional(),
  hoist: z.boolean().default(false),
  mentionable: z.boolean().default(false),
  permissions: z.array(permissionNameSchema).max(40).default([]),
  /** staff roles are used as the default `accessRoles` for staff-only spaces and ticket handling. */
  staff: z.boolean().default(false),
  selfAssignable: z.boolean().default(false),
  purpose: z.string().trim().max(PLAN_LIMITS.purpose).optional(),
});
export type PlanRole = z.infer<typeof planRoleSchema>;

export const planMessageSchema = z.object({
  channel: planKeySchema,
  title: z.string().trim().max(256).optional(),
  content: z.string().trim().min(1).max(DISCORD_LIMITS.embedDescription),
});
export type PlanMessage = z.infer<typeof planMessageSchema>;

export const selfRolePanelSchema = z.object({
  channel: planKeySchema,
  title: z.string().trim().min(1).max(256),
  description: z.string().trim().max(1000).optional(),
  style: z.enum(['buttons', 'select']).default('buttons'),
  roles: z
    .array(
      z.object({
        role: planKeySchema,
        label: z.string().trim().min(1).max(80).optional(),
        emoji: z.string().trim().max(32).optional(),
        description: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(PLAN_LIMITS.rolesPerPanel),
});
export type SelfRolePanel = z.infer<typeof selfRolePanelSchema>;

export const planModerationSchema = z.object({
  spamFilter: z.boolean().default(true),
  maxMentionsPerMessage: z.number().int().min(0).max(50).default(5),
  blockInvites: z.boolean().default(true),
  blockLinks: z.boolean().default(false),
  blockedTerms: z.array(z.string().trim().min(1).max(100)).max(PLAN_LIMITS.blockedTerms).default([]),
  antiRaid: z.boolean().default(true),
  /** Channel where BotCooks posts staff alerts and moderation actions. */
  modLogChannel: planKeySchema.optional(),
  memberLogChannel: planKeySchema.optional(),
  serverLogChannel: planKeySchema.optional(),
});
export type PlanModeration = z.infer<typeof planModerationSchema>;

export const planFeaturesSchema = z.object({
  levels: z
    .object({
      enabled: z.boolean().default(false),
      announceChannel: planKeySchema.optional(),
      rewards: z
        .array(z.object({ level: z.number().int().min(1).max(500), role: planKeySchema }))
        .max(PLAN_LIMITS.levelRewards)
        .default([]),
    })
    .default({ enabled: false, rewards: [] }),
  tickets: z
    .object({
      enabled: z.boolean().default(false),
      panelChannel: planKeySchema.optional(),
      staffRole: planKeySchema.optional(),
    })
    .default({ enabled: false }),
  tempVoice: z
    .object({
      enabled: z.boolean().default(false),
      hubChannel: planKeySchema.optional(),
    })
    .default({ enabled: false }),
  welcome: z
    .object({
      enabled: z.boolean().default(false),
      channel: planKeySchema.optional(),
      message: z.string().trim().max(2000).optional(),
      autoroles: z.array(planKeySchema).max(10).default([]),
    })
    .default({ enabled: false, autoroles: [] }),
  streamAlerts: z
    .array(
      z.object({
        platform: z.enum(['twitch', 'youtube', 'kick']),
        channel: planKeySchema,
        note: z.string().trim().max(200).optional(),
      }),
    )
    .max(PLAN_LIMITS.streamAlerts)
    .default([]),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

export const suggestedCommandSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,32}$/, 'Command names must be 1-32 lowercase characters'),
  description: z.string().trim().min(1).max(100),
  response: z.string().trim().min(1).max(2000),
});

export const serverPlanSchema = z.object({
  version: z.literal(1).default(1),
  summary: z.string().trim().max(PLAN_LIMITS.summary).default(''),
  roles: z.array(planRoleSchema).max(PLAN_LIMITS.roles).default([]),
  categories: z.array(planCategorySchema).max(PLAN_LIMITS.categories).default([]),
  /** Channels that sit outside any category. */
  channels: z.array(planChannelSchema).max(50).default([]),
  rules: planMessageSchema.optional(),
  welcomeMessage: planMessageSchema.optional(),
  selfRolePanels: z.array(selfRolePanelSchema).max(PLAN_LIMITS.selfRolePanels).default([]),
  moderation: planModerationSchema.default({
    spamFilter: true,
    maxMentionsPerMessage: 5,
    blockInvites: true,
    blockLinks: false,
    blockedTerms: [],
    antiRaid: true,
  }),
  features: planFeaturesSchema.default({
    levels: { enabled: false, rewards: [] },
    tickets: { enabled: false },
    tempVoice: { enabled: false },
    welcome: { enabled: false, autoroles: [] },
    streamAlerts: [],
  }),
  suggestedCommands: z.array(suggestedCommandSchema).max(PLAN_LIMITS.suggestedCommands).default([]),
});

export type ServerPlan = z.infer<typeof serverPlanSchema>;
export type ServerPlanInput = z.input<typeof serverPlanSchema>;

/**
 * Structured-output providers may emit `null` for optional properties. Strip nulls so the
 * schema's own defaults apply, rather than treating `null` as an invalid value.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(stripNulls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

export type PlanParseResult = { ok: true; plan: ServerPlan } | { ok: false; errors: string[] };

export function parseServerPlan(raw: unknown): PlanParseResult {
  const result = serverPlanSchema.safeParse(stripNulls(raw));
  if (result.success) return { ok: true, plan: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 25).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Iterate every channel in the plan with its parent category (if any). */
export function* planChannels(plan: ServerPlan): Generator<{ channel: PlanChannel; category?: PlanCategory }> {
  for (const channel of plan.channels) yield { channel };
  for (const category of plan.categories) {
    for (const channel of category.channels) yield { channel, category };
  }
}
