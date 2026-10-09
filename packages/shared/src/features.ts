/**
 * Registry of BotCooks feature modules. Each guild can toggle these independently.
 * `requires` documents what must exist before a module can actually work, so the dashboard
 * can show honest prerequisite indicators instead of pretending everything is available.
 * `status` reflects the real implementation state of this codebase - keep it truthful.
 */
export type FeatureKey =
  | 'builder'
  | 'moderation'
  | 'automod'
  | 'antiraid'
  | 'logging'
  | 'welcome'
  | 'autoroles'
  | 'selfroles'
  | 'levels'
  | 'tickets'
  | 'giveaways'
  | 'polls'
  | 'scheduled'
  | 'customCommands'
  | 'events'
  | 'streamAlerts'
  | 'tempVoice'
  | 'music'
  | 'analytics';

export type FeatureStatus = 'implemented' | 'partial' | 'planned' | 'blocked';

export interface FeatureRequirement {
  kind: 'intent' | 'credential' | 'guild' | 'botPermission';
  key: string;
  label: string;
  /** Privileged intents must also be switched on in the Discord developer portal. */
  privileged?: boolean;
}

export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  description: string;
  status: FeatureStatus;
  statusNote?: string;
  defaultEnabled: boolean;
  requires: FeatureRequirement[];
}

const intent = (key: string, label: string, privileged = false): FeatureRequirement => ({
  kind: 'intent',
  key,
  label,
  privileged,
});
const botPerm = (key: string): FeatureRequirement => ({ kind: 'botPermission', key, label: key });
const credential = (key: string, label: string): FeatureRequirement => ({ kind: 'credential', key, label });

export const FEATURES: readonly FeatureDefinition[] = [
  {
    key: 'builder',
    label: 'AI Server Builder',
    description: 'Describe a server in plain language, review the generated plan, and apply it safely.',
    status: 'implemented',
    defaultEnabled: true,
    requires: [credential('AI_API_KEY', 'AI provider API key'), botPerm('ManageChannels'), botPerm('ManageRoles')],
  },
  {
    key: 'moderation',
    label: 'Moderation',
    description: 'Warnings, timeouts, kicks, bans, purges, notes and numbered cases.',
    status: 'implemented',
    defaultEnabled: true,
    requires: [botPerm('ModerateMembers'), botPerm('KickMembers'), botPerm('BanMembers'), botPerm('ManageMessages')],
  },
  {
    key: 'automod',
    label: 'Auto-moderation',
    description: 'Deterministic spam, mention, link, invite and blocked-term rules.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [intent('MessageContent', 'Message Content intent', true), botPerm('ManageMessages'), botPerm('ModerateMembers')],
  },
  {
    key: 'antiraid',
    label: 'Anti-raid',
    description: 'Join-rate detection, suspicious-account signals and lockdown.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [intent('GuildMembers', 'Server Members intent', true), botPerm('ManageChannels'), botPerm('ManageRoles')],
  },
  {
    key: 'logging',
    label: 'Logging',
    description: 'Moderation, configuration, member, role and channel logs.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [botPerm('ViewAuditLog')],
  },
  {
    key: 'welcome',
    label: 'Welcome & goodbye',
    description: 'Embeds when members join or leave.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [intent('GuildMembers', 'Server Members intent', true)],
  },
  {
    key: 'autoroles',
    label: 'Autoroles',
    description: 'Give roles automatically when members join.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [intent('GuildMembers', 'Server Members intent', true), botPerm('ManageRoles')],
  },
  {
    key: 'selfroles',
    label: 'Self-assignable roles',
    description: 'Button and select-menu role panels.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [botPerm('ManageRoles')],
  },
  {
    key: 'levels',
    label: 'Levels & rewards',
    description: 'XP for chatting with role rewards.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [botPerm('ManageRoles')],
  },
  {
    key: 'tickets',
    label: 'Tickets',
    description: 'Private support threads opened from a panel.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [botPerm('CreatePrivateThreads'), botPerm('ManageThreads')],
  },
  {
    key: 'giveaways',
    label: 'Giveaways',
    description: 'Timed giveaways with button entry.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [],
  },
  {
    key: 'polls',
    label: 'Polls',
    description: 'Native Discord polls created from commands or the dashboard.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [botPerm('SendPolls')],
  },
  {
    key: 'scheduled',
    label: 'Scheduled messages',
    description: 'One-off and recurring messages.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [],
  },
  {
    key: 'customCommands',
    label: 'Visual command builder',
    description: 'Build slash commands from blocks.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [],
  },
  {
    key: 'events',
    label: 'Visual event builder',
    description: 'React to server events with block workflows.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [],
  },
  {
    key: 'streamAlerts',
    label: 'Stream & video alerts',
    description: 'Twitch, YouTube and Kick notifications.',
    status: 'partial',
    statusNote: 'YouTube uses public RSS feeds. Twitch and Kick need app credentials and use polling.',
    defaultEnabled: false,
    requires: [credential('TWITCH_CLIENT_ID', 'Twitch app credentials (Twitch only)')],
  },
  {
    key: 'tempVoice',
    label: 'Temporary voice rooms',
    description: 'Join-to-create voice channels that clean themselves up.',
    status: 'implemented',
    defaultEnabled: false,
    requires: [intent('GuildVoiceStates', 'Voice states intent'), botPerm('ManageChannels'), botPerm('MoveMembers')],
  },
  {
    key: 'music',
    label: 'Music',
    description: 'Voice playback from sources you are licensed to stream.',
    status: 'blocked',
    statusNote:
      'Not implemented. Streaming from YouTube/Spotify violates their terms; a licensed-source player is a future milestone.',
    defaultEnabled: false,
    requires: [intent('GuildVoiceStates', 'Voice states intent'), botPerm('Connect'), botPerm('Speak')],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description: 'Member and activity trends from data BotCooks already records.',
    status: 'partial',
    defaultEnabled: true,
    requires: [],
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key) as readonly FeatureKey[];

export function getFeature(key: FeatureKey): FeatureDefinition {
  const feature = FEATURES.find((f) => f.key === key);
  if (!feature) throw new Error(`Unknown feature ${key}`);
  return feature;
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
