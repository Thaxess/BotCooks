import { PermissionFlagsBits } from 'discord-api-types/v10';

/**
 * Permission names BotCooks accepts in plans and settings. These are the official
 * discord-api-types flag names, so the bit values come from Discord's published types
 * rather than being hand-maintained here.
 */
export const PLAN_PERMISSION_NAMES = [
  'CreateInstantInvite',
  'KickMembers',
  'BanMembers',
  'Administrator',
  'ManageChannels',
  'ManageGuild',
  'AddReactions',
  'ViewAuditLog',
  'PrioritySpeaker',
  'Stream',
  'ViewChannel',
  'SendMessages',
  'SendTTSMessages',
  'ManageMessages',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'MentionEveryone',
  'UseExternalEmojis',
  'Connect',
  'Speak',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'UseVAD',
  'ChangeNickname',
  'ManageNicknames',
  'ManageRoles',
  'ManageWebhooks',
  'ManageGuildExpressions',
  'UseApplicationCommands',
  'RequestToSpeak',
  'ManageEvents',
  'ManageThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'UseExternalStickers',
  'SendMessagesInThreads',
  'UseEmbeddedActivities',
  'ModerateMembers',
  'UseSoundboard',
  'SendVoiceMessages',
  'SendPolls',
] as const satisfies ReadonlyArray<keyof typeof PermissionFlagsBits>;

export type PermissionName = (typeof PLAN_PERMISSION_NAMES)[number];

/**
 * Permissions that let a holder take over, damage, or mass-affect a server. Granting any of
 * these through an AI plan is a permission elevation and needs separate confirmation.
 */
export const DANGEROUS_PERMISSIONS: ReadonlySet<PermissionName> = new Set<PermissionName>([
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
  'ManageNicknames',
  'ManageGuildExpressions',
  'ManageEvents',
  'ManageThreads',
  'ViewAuditLog',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
]);

/** The subset that effectively hands over control of the server. */
export const CRITICAL_PERMISSIONS: ReadonlySet<PermissionName> = new Set<PermissionName>([
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageWebhooks',
  'BanMembers',
  'MentionEveryone',
]);

export function permissionBit(name: PermissionName): bigint {
  return PermissionFlagsBits[name];
}

export function permissionsToBitfield(names: Iterable<PermissionName>): bigint {
  let bits = 0n;
  for (const name of names) bits |= PermissionFlagsBits[name];
  return bits;
}

export function bitfieldToPermissions(bits: bigint | string): PermissionName[] {
  const value = typeof bits === 'string' ? BigInt(bits) : bits;
  return PLAN_PERMISSION_NAMES.filter((name) => (value & PermissionFlagsBits[name]) === PermissionFlagsBits[name]);
}

/** True when the bitfield grants `name`, treating Administrator as granting everything. */
export function hasPermission(bits: bigint | string, name: PermissionName): boolean {
  const value = typeof bits === 'string' ? BigInt(bits) : bits;
  if ((value & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
  return (value & PermissionFlagsBits[name]) === PermissionFlagsBits[name];
}

export function isPermissionName(value: string): value is PermissionName {
  return (PLAN_PERMISSION_NAMES as readonly string[]).includes(value);
}

/** Human-readable label, e.g. ManageGuild -> "Manage Server". */
export function permissionLabel(name: PermissionName): string {
  const overrides: Partial<Record<PermissionName, string>> = {
    ManageGuild: 'Manage Server',
    UseVAD: 'Use Voice Activity',
    SendTTSMessages: 'Send TTS Messages',
    ManageGuildExpressions: 'Manage Expressions',
    ModerateMembers: 'Timeout Members',
  };
  return overrides[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2');
}
