import {
  ChannelTypeNum,
  DANGEROUS_PERMISSIONS,
  bitfieldToPermissions,
  hasPermission,
  permissionsToBitfield,
  type GuildSnapshot,
  type PermissionName,
  type PlanCategory,
  type PlanChannel,
  type PlanChannelType,
  type PlanOverwrite,
  type ServerPlan,
  type SnapshotChannel,
  type SnapshotRole,
  type Visibility,
} from '@botcooks/shared';
import type {
  ChangeSet,
  ChannelData,
  DiffLine,
  DiffOptions,
  Op,
  OverwriteSpec,
  PlanConfigPayload,
  RoleData,
} from './changeset';

export const PLAN_CHANNEL_TYPE_NUM: Record<PlanChannelType, number> = {
  text: ChannelTypeNum.GuildText,
  voice: ChannelTypeNum.GuildVoice,
  announcement: ChannelTypeNum.GuildAnnouncement,
  stage: ChannelTypeNum.GuildStageVoice,
  forum: ChannelTypeNum.GuildForum,
};

const VOICE_TYPES = new Set<number>([ChannelTypeNum.GuildVoice, ChannelTypeNum.GuildStageVoice]);

export function channelTypeLabel(type: number): string {
  switch (type) {
    case ChannelTypeNum.GuildText:
      return 'text';
    case ChannelTypeNum.GuildVoice:
      return 'voice';
    case ChannelTypeNum.GuildCategory:
      return 'category';
    case ChannelTypeNum.GuildAnnouncement:
      return 'announcement';
    case ChannelTypeNum.GuildStageVoice:
      return 'stage';
    case ChannelTypeNum.GuildForum:
      return 'forum';
    default:
      return `type ${type}`;
  }
}

export function hexToInt(color: string | undefined): number {
  return color ? parseInt(color.replace('#', ''), 16) : 0;
}

type PermSets = { allow: Set<PermissionName>; deny: Set<PermissionName> };

/**
 * Compiles high-level visibility + explicit overwrites into concrete overwrites.
 * `base` carries the parent category's compiled overwrites so channels stay consistent with it.
 */
export function compileOverwrites(
  input: { visibility: Visibility; accessRoles: string[]; overwrites: PlanOverwrite[]; type: number },
  bot: { userId: string; isAdmin: boolean; has: (p: PermissionName) => boolean },
  base?: Map<string, PermSets>,
): Map<string, PermSets> {
  const map = new Map<string, PermSets>();
  if (base) for (const [k, v] of base) map.set(k, { allow: new Set(v.allow), deny: new Set(v.deny) });
  const entry = (target: string) => {
    let e = map.get(target);
    if (!e) map.set(target, (e = { allow: new Set(), deny: new Set() }));
    return e;
  };
  const allow = (target: string, perms: PermissionName[]) => {
    const e = entry(target);
    for (const p of perms) {
      e.allow.add(p);
      e.deny.delete(p);
    }
  };
  const deny = (target: string, perms: PermissionName[]) => {
    const e = entry(target);
    for (const p of perms) {
      e.deny.add(p);
      e.allow.delete(p);
    }
  };

  const isVoice = VOICE_TYPES.has(input.type);
  const isCategory = input.type === ChannelTypeNum.GuildCategory;
  const talkPerms: PermissionName[] = isVoice
    ? ['Connect', 'Speak']
    : isCategory
      ? ['SendMessages', 'Connect', 'Speak']
      : ['SendMessages'];

  if (input.visibility === 'private') {
    deny('everyone', ['ViewChannel']);
    for (const role of input.accessRoles) allow(role, ['ViewChannel', ...talkPerms, ...(isVoice ? [] : (['ReadMessageHistory'] as PermissionName[]))]);
  } else if (input.visibility === 'readonly') {
    deny('everyone', isVoice ? ['Speak'] : isCategory ? ['SendMessages', 'Speak'] : ['SendMessages']);
    for (const role of input.accessRoles) allow(role, talkPerms);
  }

  for (const ow of input.overwrites) {
    allow(ow.target, ow.allow);
    deny(ow.target, ow.deny);
  }

  // If @everyone is locked out, make sure BotCooks itself can still see and post in the channel.
  const everyone = map.get('everyone');
  if (!bot.isAdmin && everyone && (everyone.deny.has('ViewChannel') || everyone.deny.has('SendMessages') || everyone.deny.has('Connect'))) {
    const botPerms: PermissionName[] = (
      isVoice
        ? (['ViewChannel', 'Connect', 'ManageChannels'] as PermissionName[])
        : (['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageChannels'] as PermissionName[])
    ).filter((p) => bot.has(p));
    allow(`member:${bot.userId}`, botPerms);
  }

  for (const [k, v] of map) if (v.allow.size === 0 && v.deny.size === 0) map.delete(k);
  return map;
}

export function permSetsToSpecs(map: Map<string, PermSets>): OverwriteSpec[] {
  return [...map.entries()]
    .map(([target, v]) => ({
      target,
      allow: permissionsToBitfield(v.allow).toString(),
      deny: permissionsToBitfield(v.deny).toString(),
    }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

function textName(name: string) {
  return name.trim().toLowerCase();
}

function snapshotRoleData(role: SnapshotRole): RoleData {
  return { name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions };
}

export function snapshotChannelData(channel: SnapshotChannel, guildId: string): ChannelData {
  return {
    name: channel.name,
    type: channel.type,
    parent: channel.parentId ? `existing:${channel.parentId}` : null,
    topic: channel.topic ?? null,
    nsfw: channel.nsfw ?? false,
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    userLimit: channel.userLimit ?? 0,
    overwrites: channel.overwrites
      .map((ow) => ({
        target: ow.id === guildId ? 'everyone' : ow.type === 1 ? `member:${ow.id}` : `existing:${ow.id}`,
        allow: ow.allow,
        deny: ow.deny,
      }))
      .sort((a, b) => a.target.localeCompare(b.target)),
  };
}

function permDelta(before: string, after: string): { added: PermissionName[]; removed: PermissionName[] } {
  const b = new Set(bitfieldToPermissions(before));
  const a = new Set(bitfieldToPermissions(after));
  return { added: [...a].filter((p) => !b.has(p)), removed: [...b].filter((p) => !a.has(p)) };
}

/**
 * Computes the change set needed to move `snapshot` towards `plan`.
 * The plan MUST already have passed `validatePlan` from @botcooks/security.
 */
export function diffPlan(plan: ServerPlan, snapshot: GuildSnapshot, options: DiffOptions): ChangeSet & {
  /** Plan refs that matched existing resources: ref -> Discord id. */
  mappings: Record<string, string>;
} {
  const ops: Op[] = [];
  const diff: DiffLine[] = [];
  const warnings: string[] = [];
  const mappings: Record<string, string> = {};
  const botPerms = BigInt(snapshot.bot.permissions);
  const bot = {
    userId: snapshot.bot.userId,
    isAdmin: hasPermission(botPerms, 'Administrator'),
    has: (p: PermissionName) => hasPermission(botPerms, p),
  };
  const updating = options.mode !== 'additive';
  const roleLabel = new Map<string, string>([['everyone', '@everyone']]);
  for (const r of snapshot.roles) roleLabel.set(`existing:${r.id}`, r.name);
  for (const r of plan.roles) roleLabel.set(`role:${r.key}`, r.name);
  const describeTarget = (t: string) =>
    t.startsWith('member:') ? (t === `member:${bot.userId}` ? 'BotCooks' : 'a member') : (roleLabel.get(t) ?? t);

  // ---------------------------------------------------------------- roles
  const existingRoles = snapshot.roles.filter((r) => r.id !== snapshot.guildId && !r.managed);
  const existingRoleByName = new Map(existingRoles.map((r) => [textName(r.name), r]));
  const matchedRoleIds = new Set<string>();
  const createdRoleRefs: string[] = [];

  for (const role of plan.roles) {
    const ref = `role:${role.key}`;
    const desired: RoleData = {
      name: role.name,
      color: hexToInt(role.color),
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: permissionsToBitfield(role.permissions).toString(),
    };
    const existing = existingRoleByName.get(textName(role.name));
    if (!existing) {
      const id = `role.create:${role.key}`;
      ops.push({ kind: 'role.create', id, ref, data: desired });
      createdRoleRefs.push(ref);
      diff.push({
        action: 'create',
        kind: 'role',
        label: role.name,
        opId: id,
        details: [
          role.color ? `color ${role.color}` : 'default color',
          role.permissions.length ? `permissions: ${role.permissions.join(', ')}` : 'no extra permissions',
          ...(role.hoist ? ['shown separately in member list'] : []),
          ...(role.purpose ? [`purpose: ${role.purpose}`] : []),
        ],
      });
      continue;
    }
    matchedRoleIds.add(existing.id);
    mappings[ref] = existing.id;
    const before = snapshotRoleData(existing);
    const after: RoleData = { ...desired, name: existing.name };
    const changes: string[] = [];
    if (before.color !== after.color) changes.push(`color #${before.color.toString(16).padStart(6, '0')} → #${after.color.toString(16).padStart(6, '0')}`);
    if (before.hoist !== after.hoist) changes.push(`hoist ${before.hoist} → ${after.hoist}`);
    if (before.mentionable !== after.mentionable) changes.push(`mentionable ${before.mentionable} → ${after.mentionable}`);
    const delta = permDelta(before.permissions, after.permissions);
    if (delta.added.length) changes.push(`adds permissions: ${delta.added.join(', ')}`);
    if (delta.removed.length) changes.push(`removes permissions: ${delta.removed.join(', ')}`);
    if (changes.length === 0) {
      diff.push({ action: 'unchanged', kind: 'role', label: existing.name, details: ['already exists'] });
    } else if (!updating) {
      diff.push({ action: 'skip', kind: 'role', label: existing.name, details: ['exists and differs; left unchanged (additive mode)', ...changes] });
    } else if (existing.position >= snapshot.bot.highestRolePosition) {
      diff.push({ action: 'skip', kind: 'role', label: existing.name, details: ["is above BotCooks' highest role, so it cannot be edited", ...changes] });
      warnings.push(`Role "${existing.name}" is above BotCooks' role and was not updated.`);
    } else {
      const id = `role.update:${role.key}`;
      ops.push({ kind: 'role.update', id, ref, roleId: existing.id, before, after });
      diff.push({ action: 'update', kind: 'role', label: existing.name, opId: id, details: changes });
    }
  }
  if (createdRoleRefs.length > 1) {
    ops.push({ kind: 'role.reorder', id: 'role.reorder', refs: createdRoleRefs });
  }

  // ---------------------------------------------------------------- channels
  const existingCategories = snapshot.channels.filter((c) => c.type === ChannelTypeNum.GuildCategory);
  const existingNonCategories = snapshot.channels.filter((c) => c.type !== ChannelTypeNum.GuildCategory);
  const matchedChannelIds = new Set<string>();

  const compare = (before: ChannelData, after: ChannelData): string[] => {
    const changes: string[] = [];
    const resolveRef = (t: string | null) =>
      t && (t.startsWith('role:') || t.startsWith('channel:')) && mappings[t] ? `existing:${mappings[t]}` : t;
    if (before.name !== after.name) changes.push(`rename "${before.name}" → "${after.name}"`);
    if (before.parent !== resolveRef(after.parent)) changes.push('moves to a different category');
    if ((before.topic ?? '') !== (after.topic ?? '') && after.topic !== undefined) changes.push('topic changes');
    if ((before.nsfw ?? false) !== (after.nsfw ?? false)) changes.push(`age-restricted ${before.nsfw} → ${after.nsfw}`);
    if ((before.rateLimitPerUser ?? 0) !== (after.rateLimitPerUser ?? 0)) changes.push(`slowmode ${before.rateLimitPerUser ?? 0}s → ${after.rateLimitPerUser ?? 0}s`);
    if (VOICE_TYPES.has(after.type) && (before.userLimit ?? 0) !== (after.userLimit ?? 0)) changes.push(`user limit ${before.userLimit ?? 0} → ${after.userLimit ?? 0}`);
    const key = (o: OverwriteSpec) => `${o.target}|${o.allow}|${o.deny}`;
    const b = new Set(before.overwrites.map(key));
    const a = new Set(after.overwrites.map((o) => key({ ...o, target: resolveRef(o.target) ?? o.target })));
    if (b.size !== a.size || [...a].some((k) => !b.has(k))) changes.push('permission overwrites change');
    return changes;
  };

  const describeOverwrites = (specs: OverwriteSpec[]) =>
    specs.map((o) => {
      const allow = bitfieldToPermissions(o.allow);
      const deny = bitfieldToPermissions(o.deny);
      return `${describeTarget(o.target)}: ${[allow.length ? `allow ${allow.join(', ')}` : '', deny.length ? `deny ${deny.join(', ')}` : ''].filter(Boolean).join('; ')}`;
    });

  const categoryOverwrites = new Map<string, Map<string, PermSets>>();

  const handleChannel = (
    item: { key: string; name: string; type: number; topic?: string; nsfw?: boolean; slowmodeSeconds?: number; userLimit?: number },
    overwriteMap: Map<string, PermSets>,
    parentRef: string | null,
    candidates: SnapshotChannel[],
    lineKind: 'category' | 'channel',
    visibility: Visibility,
  ) => {
    const ref = `channel:${item.key}`;
    const data: ChannelData = {
      name: item.name,
      type: item.type,
      parent: parentRef,
      ...(item.type === ChannelTypeNum.GuildCategory
        ? {}
        : {
            topic: item.topic ?? null,
            nsfw: item.nsfw ?? false,
            rateLimitPerUser: item.slowmodeSeconds ?? 0,
            userLimit: item.userLimit ?? 0,
          }),
      overwrites: permSetsToSpecs(overwriteMap),
    };
    const parentId = parentRef ? (parentRef.startsWith('existing:') ? parentRef.slice(9) : mappings[parentRef]) : null;
    const sameName = candidates.filter((c) => !matchedChannelIds.has(c.id) && textName(c.name) === textName(item.name) && c.type === item.type);
    const existing = sameName.find((c) => (c.parentId ?? null) === (parentId ?? null)) ?? sameName[0];
    const visibilityNote = visibility === 'public' ? 'public' : visibility === 'private' ? 'private (restricted roles only)' : 'read-only for most members';

    if (!existing) {
      const id = `channel.create:${item.key}`;
      ops.push({ kind: 'channel.create', id, ref, data });
      diff.push({
        action: 'create',
        kind: lineKind,
        label: lineKind === 'category' ? item.name : `#${item.name}`,
        opId: id,
        details: [
          ...(lineKind === 'channel' ? [`${channelTypeLabel(item.type)} channel`] : []),
          visibilityNote,
          ...(item.topic ? [`topic: ${item.topic}`] : []),
          ...(item.slowmodeSeconds ? [`slowmode ${item.slowmodeSeconds}s`] : []),
          ...(item.nsfw ? ['age-restricted'] : []),
          ...describeOverwrites(data.overwrites),
        ],
      });
      return;
    }
    matchedChannelIds.add(existing.id);
    mappings[ref] = existing.id;
    const before = snapshotChannelData(existing, snapshot.guildId);
    const after: ChannelData = { ...data, name: existing.name };
    const changes = compare(before, after);
    const label = lineKind === 'category' ? existing.name : `#${existing.name}`;
    if (changes.length === 0) {
      diff.push({ action: 'unchanged', kind: lineKind, label, details: ['already exists'] });
    } else if (!updating) {
      diff.push({ action: 'skip', kind: lineKind, label, details: ['exists and differs; left unchanged (additive mode)', ...changes] });
      if (changes.includes('permission overwrites change') && visibility !== 'public') {
        warnings.push(`"${existing.name}" already exists with different permissions. In additive mode it stays as it is, so it may be more public than the plan intends.`);
      }
    } else {
      const id = `channel.update:${item.key}`;
      ops.push({ kind: 'channel.update', id, ref, channelId: existing.id, before, after });
      diff.push({ action: 'update', kind: lineKind, label, opId: id, details: [...changes, ...describeOverwrites(after.overwrites)] });
    }
  };

  for (const category of plan.categories) {
    const map = compileOverwrites({ ...category, type: ChannelTypeNum.GuildCategory }, bot);
    categoryOverwrites.set(category.key, map);
    handleChannel(
      { key: category.key, name: category.name, type: ChannelTypeNum.GuildCategory },
      map,
      null,
      existingCategories,
      'category',
      category.visibility,
    );
  }

  const handlePlanChannel = (channel: PlanChannel, category?: PlanCategory) => {
    const type = PLAN_CHANNEL_TYPE_NUM[channel.type];
    const base = category ? categoryOverwrites.get(category.key) : undefined;
    const map = compileOverwrites({ ...channel, type }, bot, base);
    handleChannel(
      {
        key: channel.key,
        name: channel.name,
        type,
        ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
        nsfw: channel.nsfw,
        slowmodeSeconds: channel.slowmodeSeconds,
        userLimit: channel.userLimit,
      },
      map,
      category ? `channel:${category.key}` : null,
      existingNonCategories,
      'channel',
      channel.visibility !== 'public' ? channel.visibility : (category?.visibility ?? 'public'),
    );
  };
  for (const channel of plan.channels) handlePlanChannel(channel);
  for (const category of plan.categories) for (const channel of category.channels) handlePlanChannel(channel, category);

  // ---------------------------------------------------------------- deletions (sync mode only)
  if (options.mode === 'sync') {
    const protectedIds = new Set(snapshot.protectedChannelIds);
    for (const channel of snapshot.channels) {
      if (matchedChannelIds.has(channel.id)) continue;
      const label = channel.type === ChannelTypeNum.GuildCategory ? channel.name : `#${channel.name}`;
      if (protectedIds.has(channel.id)) {
        diff.push({ action: 'skip', kind: 'channel', label, details: ['server rules/updates/system channel; never deleted'] });
        continue;
      }
      const id = `channel.delete:${channel.id}`;
      ops.push({ kind: 'channel.delete', id, channelId: channel.id, before: snapshotChannelData(channel, snapshot.guildId) });
      diff.push({
        action: 'delete',
        kind: channel.type === ChannelTypeNum.GuildCategory ? 'category' : 'channel',
        label,
        opId: id,
        details: ['not in the plan', 'message history cannot be restored after deletion'],
      });
    }
    for (const role of existingRoles) {
      if (matchedRoleIds.has(role.id)) continue;
      if (role.position >= snapshot.bot.highestRolePosition) {
        diff.push({ action: 'skip', kind: 'role', label: role.name, details: ["above BotCooks' role; cannot be deleted"] });
        continue;
      }
      const id = `role.delete:${role.id}`;
      ops.push({ kind: 'role.delete', id, roleId: role.id, before: snapshotRoleData(role) });
      diff.push({ action: 'delete', kind: 'role', label: role.name, opId: id, details: ['not in the plan', 'members lose this role; a recreated role gets a new ID'] });
    }
  }

  // ---------------------------------------------------------------- messages, panels, config
  for (const [purpose, message] of [
    ['rules', plan.rules],
    ['welcome', plan.welcomeMessage],
  ] as const) {
    if (!message) continue;
    const id = `message.send:${purpose}`;
    ops.push({
      kind: 'message.send',
      id,
      channel: `channel:${message.channel}`,
      purpose,
      embed: { ...(message.title ? { title: message.title } : {}), description: message.content, color: 0xf97316 },
    });
    diff.push({ action: 'create', kind: 'message', label: `${purpose === 'rules' ? 'Rules' : 'Welcome'} message in #${message.channel}`, opId: id, details: [truncate(message.content, 160)] });
  }

  plan.selfRolePanels.forEach((panel, i) => {
    const id = `selfroles.panel:${i}`;
    ops.push({
      kind: 'selfroles.panel',
      id,
      channel: `channel:${panel.channel}`,
      panel: {
        title: panel.title,
        ...(panel.description ? { description: panel.description } : {}),
        style: panel.style,
        roles: panel.roles.map((r) => ({
          role: `role:${r.role}`,
          label: r.label ?? roleLabel.get(`role:${r.role}`) ?? r.role,
          ...(r.emoji ? { emoji: r.emoji } : {}),
          ...(r.description ? { description: r.description } : {}),
        })),
      },
    });
    diff.push({
      action: 'create',
      kind: 'panel',
      label: `Self-role panel "${panel.title}" in #${panel.channel}`,
      opId: id,
      details: panel.roles.map((r) => roleLabel.get(`role:${r.role}`) ?? r.role),
    });
  });

  const config = buildConfigPayload(plan);
  ops.push({ kind: 'config.apply', id: 'config.apply', config });
  diff.push({ action: 'update', kind: 'config', label: 'BotCooks feature settings', opId: 'config.apply', details: describeConfig(config) });

  // ---------------------------------------------------------------- risk & permissions
  const risk = assessRisk(ops, describeTarget);
  const required = new Set<string>();
  for (const op of ops) {
    if (op.kind.startsWith('role.')) required.add('ManageRoles');
    if (op.kind.startsWith('channel.')) required.add('ManageChannels');
    if ((op.kind === 'channel.create' || op.kind === 'channel.update') && (op.kind === 'channel.create' ? op.data : op.after).overwrites.length) required.add('ManageRoles');
    if (op.kind === 'message.send' || op.kind === 'selfroles.panel') {
      required.add('SendMessages');
      required.add('EmbedLinks');
    }
  }

  const counts = { create: 0, update: 0, delete: 0, unchanged: 0, skipped: 0 };
  for (const line of diff) {
    if (line.kind === 'config') continue;
    if (line.action === 'skip') counts.skipped++;
    else counts[line.action]++;
  }

  return { ops, diff, counts, requiredBotPermissions: [...required].sort(), risk, warnings, mappings };
}

export function assessRisk(ops: Op[], describeTarget: (t: string) => string = (t) => t) {
  const reasons: string[] = [];
  let destructive = false;
  let elevation = false;
  const dangerous = (bits: string) => bitfieldToPermissions(bits).filter((p) => DANGEROUS_PERMISSIONS.has(p));
  for (const op of ops) {
    if (op.kind === 'channel.delete' || op.kind === 'role.delete') {
      destructive = true;
      reasons.push(`Deletes ${op.kind === 'role.delete' ? 'role' : 'channel'} "${op.before.name}".`);
    }
    if (op.kind === 'role.create') {
      const d = dangerous(op.data.permissions);
      if (d.length) {
        elevation = true;
        reasons.push(`New role "${op.data.name}" gets ${d.join(', ')}.`);
      }
    }
    if (op.kind === 'role.update') {
      const added = permDelta(op.before.permissions, op.after.permissions).added.filter((p) => DANGEROUS_PERMISSIONS.has(p));
      if (added.length) {
        elevation = true;
        reasons.push(`Role "${op.before.name}" gains ${added.join(', ')}.`);
      }
    }
    if (op.kind === 'channel.create' || op.kind === 'channel.update') {
      const data = op.kind === 'channel.create' ? op.data : op.after;
      for (const ow of data.overwrites) {
        if (ow.target.startsWith('member:')) continue;
        const d = dangerous(ow.allow);
        if (d.length) {
          elevation = true;
          reasons.push(`"${data.name}" lets ${describeTarget(ow.target)} use ${d.join(', ')}.`);
        }
      }
    }
  }
  return { destructive, elevation, reasons };
}

function buildConfigPayload(plan: ServerPlan): PlanConfigPayload {
  const ch = (k?: string) => (k ? `channel:${k}` : undefined);
  const strip = <T extends Record<string, unknown>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const m = plan.moderation;
  const f = plan.features;
  return {
    moderation: strip({
      spamFilter: m.spamFilter,
      maxMentionsPerMessage: m.maxMentionsPerMessage,
      blockInvites: m.blockInvites,
      blockLinks: m.blockLinks,
      blockedTerms: m.blockedTerms,
      antiRaid: m.antiRaid,
      modLogChannel: ch(m.modLogChannel),
      memberLogChannel: ch(m.memberLogChannel),
      serverLogChannel: ch(m.serverLogChannel),
    }),
    levels: strip({
      enabled: f.levels.enabled,
      announceChannel: ch(f.levels.announceChannel),
      rewards: f.levels.rewards.map((r) => ({ level: r.level, role: `role:${r.role}` })),
    }),
    tickets: strip({
      enabled: f.tickets.enabled,
      panelChannel: ch(f.tickets.panelChannel),
      staffRole: f.tickets.staffRole ? `role:${f.tickets.staffRole}` : undefined,
    }),
    tempVoice: strip({ enabled: f.tempVoice.enabled, hubChannel: ch(f.tempVoice.hubChannel) }),
    welcome: strip({
      enabled: f.welcome.enabled,
      channel: ch(f.welcome.channel),
      message: f.welcome.message,
      autoroles: f.welcome.autoroles.map((k) => `role:${k}`),
    }),
    streamAlerts: f.streamAlerts.map((a) => strip({ platform: a.platform, channel: `channel:${a.channel}`, note: a.note })),
    suggestedCommands: plan.suggestedCommands,
  };
}

function describeConfig(c: PlanConfigPayload): string[] {
  const out: string[] = [];
  const m = c.moderation;
  out.push(
    `auto-moderation: ${[m.spamFilter && 'spam filter', m.blockInvites && 'block invites', m.blockLinks && 'block links', m.maxMentionsPerMessage > 0 && `max ${m.maxMentionsPerMessage} mentions`, m.blockedTerms.length && `${m.blockedTerms.length} blocked terms`].filter(Boolean).join(', ') || 'off'}`,
  );
  out.push(`anti-raid: ${m.antiRaid ? 'on' : 'off'}`);
  if (m.modLogChannel) out.push(`moderation log → ${m.modLogChannel.replace('channel:', '#')}`);
  if (c.levels.enabled) out.push(`levels on${c.levels.rewards.length ? ` with ${c.levels.rewards.length} role rewards` : ''}`);
  if (c.tickets.enabled) out.push('tickets on');
  if (c.tempVoice.enabled) out.push('temporary voice rooms on');
  if (c.welcome.enabled) out.push(`welcome messages on${c.welcome.autoroles.length ? `, ${c.welcome.autoroles.length} autoroles` : ''}`);
  if (c.streamAlerts.length) out.push(`${c.streamAlerts.length} stream alert channel(s) (accounts connected separately)`);
  if (c.suggestedCommands.length) out.push(`${c.suggestedCommands.length} suggested custom commands (created disabled for review)`);
  out.push('features are only enabled; your existing settings for other features are kept');
  return out;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
