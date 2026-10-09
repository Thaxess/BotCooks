import {
  CRITICAL_PERMISSIONS,
  DANGEROUS_PERMISSIONS,
  DISCORD_LIMITS,
  ChannelTypeNum,
  guildHasCommunity,
  hasPermission,
  planChannels,
  type GuildSnapshot,
  type PermissionName,
  type PlanChannel,
  type PlanChannelType,
  type PlanOverwrite,
  type ServerPlan,
} from '@botcooks/shared';
import { formatRoleRef, type RoleRef } from './refs';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface PlanIssue {
  level: IssueLevel;
  code: string;
  message: string;
  path?: string;
}

export interface PlanDowngrade {
  path: string;
  from: string;
  to: string;
  reason: string;
}

export interface PlanValidationResult {
  /** Normalised plan: references canonicalised, unsupported values downgraded or removed. */
  plan: ServerPlan;
  issues: PlanIssue[];
  downgrades: PlanDowngrade[];
  /** True when at least one `error` issue exists; such plans must not be executed. */
  blocking: boolean;
}

const TEXT_LIKE: ReadonlySet<PlanChannelType> = new Set(['text', 'announcement', 'forum']);
const VOICE_LIKE: ReadonlySet<PlanChannelType> = new Set(['voice', 'stage']);
const MESSAGEABLE: ReadonlySet<PlanChannelType> = new Set(['text', 'announcement']);

/**
 * Discord lowercases text channel names and replaces spaces; doing it up front means the
 * preview shows exactly what will be created and name matching against existing channels works.
 */
export function normalizeTextChannelName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DISCORD_LIMITS.channelName);
  return normalized.length > 0 ? normalized : 'channel';
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Deterministic post-generation validation. Runs on every plan regardless of where it came from
 * (AI, template, or manual edit) and never trusts the input to be well-intentioned.
 */
export function validatePlan(input: ServerPlan, snapshot: GuildSnapshot): PlanValidationResult {
  const plan: ServerPlan = structuredClone(input);
  const issues: PlanIssue[] = [];
  const downgrades: PlanDowngrade[] = [];
  const issue = (level: IssueLevel, code: string, message: string, path?: string) =>
    issues.push({ level, code, message, ...(path ? { path } : {}) });

  const botPerms = BigInt(snapshot.bot.permissions);
  const botIsAdmin = hasPermission(botPerms, 'Administrator');
  const botHas = (p: PermissionName) => hasPermission(botPerms, p);
  const community = guildHasCommunity(snapshot);

  // --- bot capability checks -------------------------------------------------------------
  const channelCount = [...planChannels(plan)].length + plan.categories.length;
  if (channelCount > 0 && !botHas('ManageChannels')) {
    issue('error', 'bot_missing_manage_channels', 'BotCooks needs the Manage Channels permission to create channels.');
  }
  if (plan.roles.length > 0 && !botHas('ManageRoles')) {
    issue('error', 'bot_missing_manage_roles', 'BotCooks needs the Manage Roles permission to create roles.');
  }

  // --- roles -----------------------------------------------------------------------------
  const roleKeys = new Set<string>();
  const roleNames = new Set<string>();
  plan.roles = plan.roles.filter((role, i) => {
    const path = `roles[${i}]`;
    if (nameKey(role.name) === '@everyone' || nameKey(role.name) === 'everyone') {
      issue('warning', 'role_everyone_reserved', '"@everyone" already exists and cannot be created; it was removed.', path);
      return false;
    }
    role.key = uniqueKey(role.key, roleKeys, (from, to) =>
      issue('warning', 'duplicate_role_key', `Duplicate role key "${from}" renamed to "${to}".`, path),
    );
    if (roleNames.has(nameKey(role.name))) {
      issue('warning', 'duplicate_role_name', `Two roles are named "${role.name}"; the duplicate was removed.`, path);
      roleKeys.delete(role.key);
      return false;
    }
    roleNames.add(nameKey(role.name));
    return true;
  });

  const existingRoleByName = new Map(
    snapshot.roles.filter((r) => r.id !== snapshot.guildId).map((r) => [nameKey(r.name), r]),
  );
  const planRoleByName = new Map(plan.roles.map((r) => [nameKey(r.name), r.key]));

  const selfAssignKeys = new Set<string>(plan.roles.filter((r) => r.selfAssignable).map((r) => r.key));
  for (const panel of plan.selfRolePanels) for (const entry of panel.roles) selfAssignKeys.add(entry.role);
  for (const key of plan.features.welcome.autoroles) selfAssignKeys.add(key);

  plan.roles.forEach((role, i) => {
    const path = `roles[${i}].permissions`;
    const stripped: string[] = [];
    role.permissions = role.permissions.filter((perm) => {
      if (perm === 'Administrator') {
        stripped.push(perm);
        issue(
          'warning',
          'administrator_stripped',
          `"${role.name}" asked for Administrator. Generated plans never grant Administrator; assign it manually if you really need it.`,
          path,
        );
        return false;
      }
      if (selfAssignKeys.has(role.key) && DANGEROUS_PERMISSIONS.has(perm)) {
        stripped.push(perm);
        issue(
          'warning',
          'self_assign_dangerous_stripped',
          `"${role.name}" can be self-assigned or auto-assigned, so the powerful permission ${perm} was removed.`,
          path,
        );
        return false;
      }
      if (!botIsAdmin && !botHas(perm)) {
        stripped.push(perm);
        issue(
          'warning',
          'bot_lacks_permission',
          `BotCooks cannot grant ${perm} to "${role.name}" because it does not have that permission itself.`,
          path,
        );
        return false;
      }
      return true;
    });
    role.permissions = [...new Set(role.permissions)];
    if (stripped.length > 0) {
      downgrades.push({ path, from: stripped.join(', '), to: '(removed)', reason: 'Permission safety rules' });
    }
  });

  const newRoleCount = plan.roles.filter((r) => !existingRoleByName.has(nameKey(r.name))).length;
  if (snapshot.roles.length + newRoleCount > DISCORD_LIMITS.guildRoles) {
    issue(
      'error',
      'too_many_roles',
      `This plan would bring the server to ${snapshot.roles.length + newRoleCount} roles; Discord allows ${DISCORD_LIMITS.guildRoles}.`,
    );
  }

  /** Resolve an AI-supplied role reference into canonical form. */
  const resolveRole = (raw: string): RoleRef | null => {
    const value = raw.trim();
    const lower = value.toLowerCase();
    if (lower === 'everyone' || lower === '@everyone') return { kind: 'everyone' };
    if (lower.startsWith('role:') && roleKeys.has(lower.slice(5))) return { kind: 'plan', key: lower.slice(5) };
    if (lower.startsWith('existing:')) {
      const id = value.slice(9);
      return snapshot.roles.some((r) => r.id === id) ? { kind: 'existing', id } : null;
    }
    if (roleKeys.has(lower)) return { kind: 'plan', key: lower };
    const byPlanName = planRoleByName.get(lower.replace(/^@/, ''));
    if (byPlanName) return { kind: 'plan', key: byPlanName };
    const existing = existingRoleByName.get(lower.replace(/^@/, ''));
    if (existing && !existing.managed) return { kind: 'existing', id: existing.id };
    return null;
  };

  const resolveAccessRoles = (list: string[], path: string): string[] => {
    const out: string[] = [];
    for (const raw of list) {
      const ref = resolveRole(raw);
      if (!ref || ref.kind === 'everyone') {
        if (!ref) issue('warning', 'unknown_role_ref', `Unknown role "${raw}" was ignored.`, path);
        continue;
      }
      out.push(formatRoleRef(ref));
    }
    return [...new Set(out)];
  };

  const cleanOverwrites = (list: PlanOverwrite[], path: string): PlanOverwrite[] => {
    const byTarget = new Map<string, PlanOverwrite>();
    list.forEach((ow, i) => {
      const ref = resolveRole(ow.target);
      if (!ref) {
        issue('warning', 'unknown_role_ref', `Permission overwrite for unknown role "${ow.target}" was ignored.`, `${path}[${i}]`);
        return;
      }
      const allow = ow.allow.filter((perm) => {
        if (perm === 'Administrator') {
          issue('warning', 'administrator_stripped', 'Administrator cannot be set as a channel overwrite; removed.', `${path}[${i}]`);
          return false;
        }
        if (ref.kind === 'everyone' && DANGEROUS_PERMISSIONS.has(perm)) {
          issue(
            'warning',
            'everyone_dangerous_stripped',
            `Granting ${perm} to @everyone was removed for safety.`,
            `${path}[${i}]`,
          );
          return false;
        }
        if (!botIsAdmin && !botHas(perm)) {
          issue('warning', 'bot_lacks_permission', `BotCooks cannot allow ${perm} because it does not have it.`, `${path}[${i}]`);
          return false;
        }
        return true;
      });
      const deny = ow.deny.filter((perm) => perm !== 'Administrator' && (botIsAdmin || botHas(perm)));
      const target = formatRoleRef(ref);
      const merged = byTarget.get(target);
      if (merged) {
        merged.allow = [...new Set([...merged.allow, ...allow])];
        merged.deny = [...new Set([...merged.deny, ...deny])];
      } else {
        byTarget.set(target, { target, allow: [...new Set(allow)], deny: [...new Set(deny)] });
      }
    });
    // A permission both allowed and denied for one target is ambiguous; deny wins (safer).
    for (const ow of byTarget.values()) ow.allow = ow.allow.filter((p) => !ow.deny.includes(p));
    return [...byTarget.values()].filter((ow) => ow.allow.length + ow.deny.length > 0);
  };

  // --- categories & channels -------------------------------------------------------------
  const channelKeys = new Set<string>();
  const channelTypeByKey = new Map<string, PlanChannelType>();

  plan.categories.forEach((category, ci) => {
    const path = `categories[${ci}]`;
    category.key = uniqueKey(category.key, channelKeys, (from, to) =>
      issue('warning', 'duplicate_channel_key', `Duplicate key "${from}" renamed to "${to}".`, path),
    );
    category.accessRoles = resolveAccessRoles(category.accessRoles, `${path}.accessRoles`);
    category.overwrites = cleanOverwrites(category.overwrites, `${path}.overwrites`);
    if (category.visibility !== 'public' && category.accessRoles.length === 0) {
      issue(
        'warning',
        'private_without_roles',
        `Category "${category.name}" is ${category.visibility} but no roles are given access, so only administrators will be able to ${category.visibility === 'private' ? 'see' : 'post in'} it.`,
        path,
      );
    }
  });

  const fixChannel = (channel: PlanChannel, path: string) => {
    channel.key = uniqueKey(channel.key, channelKeys, (from, to) =>
      issue('warning', 'duplicate_channel_key', `Duplicate key "${from}" renamed to "${to}".`, path),
    );
    if (!community && (channel.type === 'announcement' || channel.type === 'stage' || channel.type === 'forum')) {
      const to: PlanChannelType = channel.type === 'stage' ? 'voice' : 'text';
      downgrades.push({
        path: `${path}.type`,
        from: channel.type,
        to,
        reason:
          channel.type === 'forum'
            ? 'Forum channels are only created on Community servers (BotCooks is conservative here).'
            : `${channel.type === 'stage' ? 'Stage' : 'Announcement'} channels require the server to have Community enabled.`,
      });
      issue(
        'info',
        'channel_type_downgraded',
        `"${channel.name}" will be a ${to} channel because this server does not have Community enabled.`,
        path,
      );
      channel.type = to;
    }
    if (TEXT_LIKE.has(channel.type)) {
      const normalized = normalizeTextChannelName(channel.name);
      if (normalized !== channel.name) channel.name = normalized;
    }
    if (channel.type === 'voice' && channel.userLimit > DISCORD_LIMITS.voiceUserLimitMax) {
      downgrades.push({
        path: `${path}.userLimit`,
        from: String(channel.userLimit),
        to: String(DISCORD_LIMITS.voiceUserLimitMax),
        reason: 'Voice channels allow at most 99 users.',
      });
      channel.userLimit = DISCORD_LIMITS.voiceUserLimitMax;
    }
    if (!VOICE_LIKE.has(channel.type)) channel.userLimit = 0;
    if (channel.type === 'announcement') channel.slowmodeSeconds = 0;
    if (VOICE_LIKE.has(channel.type)) delete channel.topic;
    channel.accessRoles = resolveAccessRoles(channel.accessRoles, `${path}.accessRoles`);
    channel.overwrites = cleanOverwrites(channel.overwrites, `${path}.overwrites`);
    if (channel.visibility !== 'public' && channel.accessRoles.length === 0) {
      issue(
        'warning',
        'private_without_roles',
        `"${channel.name}" is ${channel.visibility} but no roles are given access, so only administrators will be able to ${channel.visibility === 'private' ? 'see' : 'post in'} it.`,
        path,
      );
    }
    channelTypeByKey.set(channel.key, channel.type);
  };

  plan.channels.forEach((c, i) => fixChannel(c, `channels[${i}]`));
  plan.categories.forEach((cat, ci) => cat.channels.forEach((c, i) => fixChannel(c, `categories[${ci}].channels[${i}]`)));

  // Count only channels that will actually be new (names not already present).
  const existingChannelNames = new Set(snapshot.channels.map((c) => `${c.type === ChannelTypeNum.GuildCategory ? 'cat' : 'ch'}:${nameKey(c.name)}`));
  let newChannels = 0;
  for (const cat of plan.categories) if (!existingChannelNames.has(`cat:${nameKey(cat.name)}`)) newChannels++;
  for (const { channel } of planChannels(plan)) if (!existingChannelNames.has(`ch:${nameKey(channel.name)}`)) newChannels++;
  if (snapshot.channels.length + newChannels > DISCORD_LIMITS.guildChannels) {
    issue(
      'error',
      'too_many_channels',
      `This plan would bring the server to ${snapshot.channels.length + newChannels} channels; Discord allows ${DISCORD_LIMITS.guildChannels}.`,
    );
  }

  // --- references from messages & features -------------------------------------------------
  const requireChannel = (key: string | undefined, path: string, kinds: ReadonlySet<PlanChannelType>, what: string) => {
    if (key === undefined) return undefined;
    const type = channelTypeByKey.get(key);
    if (!type) {
      issue('warning', 'unknown_channel_ref', `${what} points to unknown channel "${key}"; it was removed.`, path);
      return undefined;
    }
    if (!kinds.has(type)) {
      issue('warning', 'wrong_channel_type', `${what} needs a ${[...kinds].join('/')} channel, but "${key}" is ${type}; it was removed.`, path);
      return undefined;
    }
    return key;
  };
  const requireRole = (key: string, path: string, what: string) => {
    if (roleKeys.has(key)) return true;
    issue('warning', 'unknown_role_ref', `${what} references unknown role "${key}"; it was removed.`, path);
    return false;
  };

  if (plan.rules && !requireChannel(plan.rules.channel, 'rules.channel', MESSAGEABLE, 'The rules message')) delete plan.rules;
  if (plan.welcomeMessage && !requireChannel(plan.welcomeMessage.channel, 'welcomeMessage.channel', MESSAGEABLE, 'The welcome message')) {
    delete plan.welcomeMessage;
  }

  plan.selfRolePanels = plan.selfRolePanels.filter((panel, i) => {
    const path = `selfRolePanels[${i}]`;
    if (!requireChannel(panel.channel, `${path}.channel`, MESSAGEABLE, 'A self-role panel')) return false;
    panel.roles = panel.roles.filter((entry, j) => requireRole(entry.role, `${path}.roles[${j}]`, 'A self-role panel'));
    return panel.roles.length > 0;
  });

  const mod = plan.moderation;
  mod.modLogChannel = requireChannel(mod.modLogChannel, 'moderation.modLogChannel', MESSAGEABLE, 'The moderation log');
  mod.memberLogChannel = requireChannel(mod.memberLogChannel, 'moderation.memberLogChannel', MESSAGEABLE, 'The member log');
  mod.serverLogChannel = requireChannel(mod.serverLogChannel, 'moderation.serverLogChannel', MESSAGEABLE, 'The server log');
  mod.blockedTerms = [...new Set(mod.blockedTerms.map((t) => t.toLowerCase()))];
  if (mod.maxMentionsPerMessage === 0) {
    issue('info', 'mention_limit_disabled', 'Mention-spam limit is disabled (0).', 'moderation.maxMentionsPerMessage');
  }

  const f = plan.features;
  f.levels.announceChannel = requireChannel(f.levels.announceChannel, 'features.levels.announceChannel', MESSAGEABLE, 'Level-up announcements');
  f.levels.rewards = f.levels.rewards.filter((r, i) => requireRole(r.role, `features.levels.rewards[${i}]`, 'A level reward'));
  f.tickets.panelChannel = requireChannel(f.tickets.panelChannel, 'features.tickets.panelChannel', MESSAGEABLE, 'The ticket panel');
  if (f.tickets.staffRole && !requireRole(f.tickets.staffRole, 'features.tickets.staffRole', 'Tickets')) delete f.tickets.staffRole;
  f.tempVoice.hubChannel = requireChannel(f.tempVoice.hubChannel, 'features.tempVoice.hubChannel', new Set(['voice']), 'Temporary voice');
  f.welcome.channel = requireChannel(f.welcome.channel, 'features.welcome.channel', MESSAGEABLE, 'Welcome messages');
  f.welcome.autoroles = f.welcome.autoroles.filter((k, i) => requireRole(k, `features.welcome.autoroles[${i}]`, 'Autoroles'));
  f.streamAlerts = f.streamAlerts.filter(
    (a, i) => requireChannel(a.channel, `features.streamAlerts[${i}].channel`, MESSAGEABLE, 'A stream alert') !== undefined,
  );
  if (f.streamAlerts.length > 0) {
    issue(
      'info',
      'stream_alerts_need_setup',
      'Stream alert channels will be created, but each Twitch/YouTube/Kick account must be connected on the Integrations page.',
    );
  }

  // --- informational warnings about access ---------------------------------------------------
  for (const role of plan.roles) {
    const critical = role.permissions.filter((p) => CRITICAL_PERMISSIONS.has(p));
    if (critical.length > 0) {
      issue('warning', 'powerful_role', `"${role.name}" gets powerful permissions: ${critical.join(', ')}.`, `roles`);
    }
  }
  const staffish = /\b(mod|mods|moderat|staff|admin|log|logs|audit)/i;
  for (const { channel, category } of planChannels(plan)) {
    const vis = channel.visibility !== 'public' ? channel.visibility : (category?.visibility ?? 'public');
    if (vis === 'public' && staffish.test(channel.name) && channel.overwrites.length === 0 && (category?.overwrites.length ?? 0) === 0) {
      issue(
        'warning',
        'staff_channel_public',
        `"${channel.name}" looks like a staff or log channel but is visible to everyone.`,
        channel.key,
      );
    }
    if (channel.nsfw) issue('info', 'nsfw_channel', `"${channel.name}" is marked age-restricted (NSFW).`, channel.key);
  }

  return { plan, issues, downgrades, blocking: issues.some((i) => i.level === 'error') };
}

function uniqueKey(key: string, seen: Set<string>, onRename: (from: string, to: string) => void): string {
  if (!seen.has(key)) {
    seen.add(key);
    return key;
  }
  let n = 2;
  let candidate = `${key.slice(0, 36)}-${n}`;
  while (seen.has(candidate)) candidate = `${key.slice(0, 36)}-${++n}`;
  seen.add(candidate);
  onRename(key, candidate);
  return candidate;
}
