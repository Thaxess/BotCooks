import {
  ChannelTypeNum,
  DISCORD_LIMITS,
  PLAN_LIMITS,
  bitfieldToPermissions,
  hashValue,
  serverPlanSchema,
  type GuildSnapshot,
  type PlanChannelType,
  type ServerPlan,
  type ServerPlanInput,
  type SnapshotOverwrite,
} from '@botcooks/shared';
import { addPlanVersion, createBuildSession, recordAudit, setBuildSessionStatus } from '@botcooks/database';
import { validatePlan } from '@botcooks/security';
import type { BuilderDeps } from './builder';

const TYPE_FROM_NUM: Record<number, PlanChannelType> = {
  [ChannelTypeNum.GuildText]: 'text',
  [ChannelTypeNum.GuildVoice]: 'voice',
  [ChannelTypeNum.GuildAnnouncement]: 'announcement',
  [ChannelTypeNum.GuildStageVoice]: 'stage',
  [ChannelTypeNum.GuildForum]: 'forum',
};

/**
 * Turns a saved snapshot back into a plan. Applied in additive mode it recreates roles and
 * channels that no longer exist (with new IDs and no message history) and leaves the rest alone.
 */
export function snapshotToPlan(snapshot: GuildSnapshot): { plan: ServerPlan; skipped: string[] } {
  const skipped: string[] = [];
  const roleKey = (id: string) => `r${id}`;
  const roles = snapshot.roles
    .filter((r) => r.id !== snapshot.guildId && !r.managed)
    .sort((a, b) => b.position - a.position);
  if (roles.length > PLAN_LIMITS.roles) skipped.push(`${roles.length - PLAN_LIMITS.roles} lowest roles (plans hold at most ${PLAN_LIMITS.roles})`);
  const keptRoles = roles.slice(0, PLAN_LIMITS.roles);
  const keptRoleIds = new Set(keptRoles.map((r) => r.id));

  const overwrites = (list: SnapshotOverwrite[]) =>
    list
      .filter((o) => {
        if (o.type === 1) return false; // member-specific overwrites cannot be expressed in plans
        return o.id === snapshot.guildId || keptRoleIds.has(o.id);
      })
      .map((o) => ({
        target: o.id === snapshot.guildId ? 'everyone' : roleKey(o.id),
        allow: bitfieldToPermissions(o.allow),
        deny: bitfieldToPermissions(o.deny),
      }))
      .slice(0, PLAN_LIMITS.overwritesPerTarget);
  if (snapshot.channels.some((c) => c.overwrites.some((o) => o.type === 1))) skipped.push('member-specific permission overwrites');

  const toChannel = (c: GuildSnapshot['channels'][number]) => ({
    key: `c${c.id}`,
    name: c.name,
    type: TYPE_FROM_NUM[c.type]!,
    ...(c.topic ? { topic: c.topic.slice(0, DISCORD_LIMITS.topic) } : {}),
    nsfw: c.nsfw ?? false,
    slowmodeSeconds: c.rateLimitPerUser ?? 0,
    userLimit: c.userLimit ?? 0,
    overwrites: overwrites(c.overwrites),
  });

  const categories = snapshot.channels.filter((c) => c.type === ChannelTypeNum.GuildCategory).sort((a, b) => a.position - b.position);
  const supported = snapshot.channels.filter((c) => TYPE_FROM_NUM[c.type] !== undefined).sort((a, b) => a.position - b.position);
  const unsupported = snapshot.channels.filter((c) => c.type !== ChannelTypeNum.GuildCategory && TYPE_FROM_NUM[c.type] === undefined);
  if (unsupported.length) skipped.push(`${unsupported.length} channel(s) of unsupported types`);

  let channelBudget = PLAN_LIMITS.channels;
  const plan: ServerPlanInput = {
    summary: `Restore of ${snapshot.name} as captured ${snapshot.capturedAt.slice(0, 16).replace('T', ' ')} UTC`,
    roles: keptRoles.map((r) => ({
      key: roleKey(r.id),
      name: r.name,
      ...(r.color ? { color: `#${r.color.toString(16).padStart(6, '0')}` } : {}),
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: bitfieldToPermissions(r.permissions),
    })),
    categories: categories.slice(0, PLAN_LIMITS.categories).map((cat) => {
      const children = supported.filter((c) => c.parentId === cat.id).slice(0, DISCORD_LIMITS.channelsPerCategory);
      const take = children.slice(0, Math.max(channelBudget, 0));
      channelBudget -= take.length;
      return { key: `c${cat.id}`, name: cat.name, overwrites: overwrites(cat.overwrites), channels: take.map(toChannel) };
    }),
    channels: supported
      .filter((c) => !c.parentId || !categories.slice(0, PLAN_LIMITS.categories).some((cat) => cat.id === c.parentId))
      .slice(0, Math.min(50, Math.max(channelBudget, 0)))
      .map(toChannel),
    // Restores never switch features on or off.
    moderation: { spamFilter: false, maxMentionsPerMessage: 0, blockInvites: false, blockLinks: false, blockedTerms: [], antiRaid: false },
  };
  if (categories.length > PLAN_LIMITS.categories) skipped.push(`${categories.length - PLAN_LIMITS.categories} categories over the plan limit`);
  if (channelBudget < 0 || supported.length > PLAN_LIMITS.channels) skipped.push('channels over the plan limit');
  return { plan: serverPlanSchema.parse(plan), skipped };
}

/** Creates a ready-to-preview build from a snapshot. */
export async function startRestoreBuild(deps: BuilderDeps, input: { guildId: string; userId: string; snapshot: GuildSnapshot; label: string }) {
  const { plan, skipped } = snapshotToPlan(input.snapshot);
  const session = await createBuildSession(deps.db, { guildId: input.guildId, createdBy: input.userId, source: 'dashboard', prompt: `Restore: ${input.label}` });
  const current = await deps.fetchSnapshot(input.guildId);
  const validated = validatePlan(plan, current);
  await addPlanVersion(deps.db, {
    sessionId: session.id,
    guildId: input.guildId,
    plan: validated.plan,
    rawPlan: plan,
    validation: {
      issues: [...validated.issues, ...skipped.map((s) => ({ level: 'info' as const, code: 'restore_skipped', message: `Not included in the restore: ${s}.` }))],
      downgrades: validated.downgrades,
      blocking: validated.blocking,
    },
    planHash: hashValue(validated.plan),
    aiProvider: 'snapshot',
    aiModel: 'restore',
    createdBy: input.userId,
  });
  await setBuildSessionStatus(deps.db, input.guildId, session.id, 'ready');
  await recordAudit(deps.db, { guildId: input.guildId, actorId: input.userId, actorType: 'user', action: 'backups.restore_started', target: session.id, details: { skipped } });
  return session;
}
