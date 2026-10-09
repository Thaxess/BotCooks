import type { ServerPlanInput } from '@botcooks/shared';

/**
 * Reusable starting points. Templates go through exactly the same validation and preview
 * pipeline as AI output, so they are just pre-written plans.
 */
export type TemplateId = 'gaming' | 'creator' | 'cooking' | 'study' | 'friends' | 'support' | 'esports';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  emoji: string;
}

type Roles = NonNullable<ServerPlanInput['roles']>;
type Categories = NonNullable<ServerPlanInput['categories']>;

const staffRoles: Roles = [
  {
    key: 'moderator',
    name: 'Moderator',
    color: '#E67E22',
    hoist: true,
    staff: true,
    permissions: ['ModerateMembers', 'ManageMessages', 'KickMembers', 'ManageThreads', 'ViewAuditLog', 'MuteMembers', 'MoveMembers'],
    purpose: 'Keeps conversations friendly and handles reports.',
  },
];

const memberRole: Roles = [
  { key: 'member', name: 'Member', color: '#95A5A6', purpose: 'Verified regular members.' },
];

const infoCategory: Categories[number] = {
  key: 'info',
  name: 'Information',
  visibility: 'readonly',
  accessRoles: ['moderator'],
  channels: [
    { key: 'rules', name: 'rules', topic: 'Read these before posting.' },
    { key: 'announcements', name: 'announcements', topic: 'News and updates from the team.' },
    { key: 'roles', name: 'get-roles', topic: 'Pick the roles that fit you.' },
  ],
};

const staffCategory: Categories[number] = {
  key: 'staff',
  name: 'Staff',
  visibility: 'private',
  accessRoles: ['moderator'],
  channels: [
    { key: 'staff-chat', name: 'staff-chat', topic: 'Private staff discussion.' },
    { key: 'mod-log', name: 'mod-log', topic: 'Automatic moderation log.' },
    { key: 'server-log', name: 'server-log', topic: 'Member and server change log.' },
  ],
};

const voiceCategory = (extra: Categories[number]['channels'] = []): Categories[number] => ({
  key: 'voice',
  name: 'Voice',
  channels: [
    { key: 'create-voice', name: '➕ Create a room', type: 'voice', purpose: 'Join to get your own temporary room.' },
    { key: 'lounge', name: 'Lounge', type: 'voice' },
    ...(extra ?? []),
  ],
});

const baseModeration = {
  spamFilter: true,
  maxMentionsPerMessage: 5,
  blockInvites: true,
  blockLinks: false,
  blockedTerms: [],
  antiRaid: true,
  modLogChannel: 'mod-log',
  memberLogChannel: 'server-log',
  serverLogChannel: 'server-log',
};

const rules = (extra: string[] = []) => ({
  channel: 'rules',
  title: 'Server rules',
  content: [
    '1. Be kind. No harassment, hate speech or personal attacks.',
    '2. Keep content in the right channels.',
    '3. No spam, self-promotion or unsolicited DMs.',
    '4. No NSFW content.',
    ...extra.map((r, i) => `${i + 5}. ${r}`),
    '',
    'Moderators may remove content or members that break these rules.',
  ].join('\n'),
});

export const TEMPLATES: Record<TemplateId, { info: TemplateInfo; plan: ServerPlanInput }> = {
  gaming: {
    info: { id: 'gaming', name: 'Gaming community', description: 'LFG, clips, game channels and temp voice rooms.', emoji: '🎮' },
    plan: {
      summary: 'A gaming community with looking-for-group, clips, temporary voice rooms and leveling.',
      roles: [
        ...staffRoles,
        { key: 'streamer', name: 'Streamer', color: '#9146FF', hoist: true, purpose: 'Community members who stream.' },
        ...memberRole,
        { key: 'pc', name: 'PC', color: '#3498DB', selfAssignable: true },
        { key: 'console', name: 'Console', color: '#2ECC71', selfAssignable: true },
        { key: 'lfg-ping', name: 'LFG Ping', color: '#F1C40F', mentionable: true, selfAssignable: true, purpose: 'Pinged for group requests.' },
      ],
      categories: [
        infoCategory,
        {
          key: 'community',
          name: 'Community',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'lfg', name: 'looking-for-group', topic: 'Find people to play with.', slowmodeSeconds: 30 },
            { key: 'clips', name: 'clips', topic: 'Share your best moments.' },
            { key: 'stream-alerts', name: 'stream-alerts', visibility: 'readonly', topic: 'Live notifications.' },
            { key: 'level-ups', name: 'level-ups', visibility: 'readonly' },
          ],
        },
        voiceCategory([{ key: 'squad-1', name: 'Squad 1', type: 'voice', userLimit: 5 }]),
        staffCategory,
      ],
      rules: rules(['No cheating, exploits or account selling.']),
      selfRolePanels: [
        {
          channel: 'roles',
          title: 'Pick your platform',
          roles: [
            { role: 'pc', emoji: '🖥️' },
            { role: 'console', emoji: '🎮' },
            { role: 'lfg-ping', emoji: '📣', description: 'Get pinged for group requests' },
          ],
        },
      ],
      moderation: baseModeration,
      features: {
        levels: { enabled: true, announceChannel: 'level-ups', rewards: [] },
        tickets: { enabled: false },
        tempVoice: { enabled: true, hubChannel: 'create-voice' },
        welcome: { enabled: true, channel: 'general', message: 'Welcome {user} to {server}! Grab roles in #get-roles.', autoroles: ['member'] },
        streamAlerts: [{ platform: 'twitch', channel: 'stream-alerts' }],
      },
    },
  },
  creator: {
    info: { id: 'creator', name: 'Creator community', description: 'Uploads, stream alerts, supporters and fan chat.', emoji: '🎥' },
    plan: {
      summary: 'A creator hub with upload and live alerts, fan chat and a supporters area.',
      roles: [
        ...staffRoles,
        { key: 'supporter', name: 'Supporter', color: '#E91E63', hoist: true, purpose: 'Members who support the creator.' },
        ...memberRole,
        { key: 'notify', name: 'Notifications', color: '#1ABC9C', mentionable: true, selfAssignable: true, purpose: 'Pinged for new uploads.' },
      ],
      categories: [
        infoCategory,
        {
          key: 'content',
          name: 'Content',
          visibility: 'readonly',
          accessRoles: ['moderator'],
          channels: [
            { key: 'uploads', name: 'new-uploads' },
            { key: 'live', name: 'live-now' },
          ],
        },
        {
          key: 'community',
          name: 'Community',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'fan-art', name: 'fan-art' },
            { key: 'suggestions', name: 'video-ideas', slowmodeSeconds: 60 },
          ],
        },
        {
          key: 'supporters',
          name: 'Supporters',
          visibility: 'private',
          accessRoles: ['supporter', 'moderator'],
          channels: [{ key: 'supporter-chat', name: 'supporter-chat' }],
        },
        voiceCategory(),
        staffCategory,
      ],
      rules: rules(['Respect the creator and other fans; no spoilers in general.']),
      selfRolePanels: [{ channel: 'roles', title: 'Notifications', roles: [{ role: 'notify', emoji: '🔔' }] }],
      moderation: baseModeration,
      features: {
        levels: { enabled: true, rewards: [] },
        tempVoice: { enabled: true, hubChannel: 'create-voice' },
        welcome: { enabled: true, channel: 'general', autoroles: ['member'] },
        streamAlerts: [
          { platform: 'youtube', channel: 'uploads' },
          { platform: 'twitch', channel: 'live' },
        ],
      },
    },
  },
  cooking: {
    info: { id: 'cooking', name: 'Cooking community', description: 'Recipes, food photos, cook-alongs and kitchen help.', emoji: '🍳' },
    plan: {
      summary: 'A cooking community with recipe sharing, photos, kitchen help and cook-along voice rooms.',
      roles: [
        ...staffRoles,
        { key: 'chef', name: 'Head Chef', color: '#C0392B', hoist: true, purpose: 'Recognised community cooks.' },
        ...memberRole,
        { key: 'baker', name: 'Baker', color: '#F5CBA7', selfAssignable: true },
        { key: 'vegetarian', name: 'Vegetarian', color: '#27AE60', selfAssignable: true },
        { key: 'grill', name: 'Grill Master', color: '#A04000', selfAssignable: true },
      ],
      categories: [
        infoCategory,
        {
          key: 'kitchen',
          name: 'The Kitchen',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'recipes', name: 'recipes', topic: 'Share full recipes: ingredients, steps and photos.', slowmodeSeconds: 30 },
            { key: 'food-photos', name: 'food-photos' },
            { key: 'kitchen-help', name: 'kitchen-help', topic: 'Ask for cooking advice.' },
          ],
        },
        voiceCategory([{ key: 'cook-along', name: 'Cook-along', type: 'voice' }]),
        staffCategory,
      ],
      rules: rules(['Credit recipes that are not your own.', 'Label allergens when you can.']),
      selfRolePanels: [
        {
          channel: 'roles',
          title: 'What do you cook?',
          roles: [
            { role: 'baker', emoji: '🥐' },
            { role: 'vegetarian', emoji: '🥗' },
            { role: 'grill', emoji: '🔥' },
          ],
        },
      ],
      moderation: baseModeration,
      features: {
        levels: { enabled: true, rewards: [{ level: 20, role: 'chef' }] },
        tempVoice: { enabled: true, hubChannel: 'create-voice' },
        welcome: { enabled: true, channel: 'general', message: 'Welcome to the kitchen, {user}! 🍽️', autoroles: ['member'] },
      },
    },
  },
  study: {
    info: { id: 'study', name: 'Study group', description: 'Subjects, homework help, focus rooms and resources.', emoji: '📚' },
    plan: {
      summary: 'A study group with subject channels, resources, homework help and focus voice rooms.',
      roles: [
        ...staffRoles,
        { key: 'tutor', name: 'Tutor', color: '#2980B9', hoist: true, purpose: 'Helps others with questions.' },
        ...memberRole,
        { key: 'math', name: 'Math', color: '#8E44AD', selfAssignable: true },
        { key: 'science', name: 'Science', color: '#16A085', selfAssignable: true },
        { key: 'languages', name: 'Languages', color: '#D35400', selfAssignable: true },
      ],
      categories: [
        infoCategory,
        {
          key: 'study',
          name: 'Study',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'homework-help', name: 'homework-help', slowmodeSeconds: 10 },
            { key: 'resources', name: 'resources', visibility: 'readonly', accessRoles: ['tutor', 'moderator'] },
            { key: 'accountability', name: 'accountability' },
          ],
        },
        {
          key: 'focus',
          name: 'Focus Rooms',
          channels: [
            { key: 'create-voice', name: '➕ Create a room', type: 'voice' },
            { key: 'silent-study', name: 'Silent study', type: 'voice', visibility: 'readonly' },
            { key: 'group-study', name: 'Group study', type: 'voice', userLimit: 8 },
          ],
        },
        staffCategory,
      ],
      rules: rules(['No sharing answers to live exams or graded work.']),
      selfRolePanels: [
        {
          channel: 'roles',
          title: 'Your subjects',
          style: 'select',
          roles: [{ role: 'math' }, { role: 'science' }, { role: 'languages' }],
        },
      ],
      moderation: { ...baseModeration, blockLinks: false },
      features: {
        levels: { enabled: true, rewards: [] },
        tempVoice: { enabled: true, hubChannel: 'create-voice' },
        welcome: { enabled: true, channel: 'general', autoroles: ['member'] },
      },
    },
  },
  friends: {
    info: { id: 'friends', name: 'Friends hangout', description: 'A small, relaxed server for a friend group.', emoji: '🛋️' },
    plan: {
      summary: 'A small hangout for friends with chat, media, gaming and voice.',
      roles: [
        { key: 'friends', name: 'Friends', color: '#5DADE2', hoist: true },
        { key: 'guest', name: 'Guest', color: '#AAB7B8' },
      ],
      categories: [
        {
          key: 'hangout',
          name: 'Hangout',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'memes', name: 'memes' },
            { key: 'photos', name: 'photos' },
            { key: 'plans', name: 'plans', topic: 'Organise meetups and game nights.' },
          ],
        },
        {
          key: 'friends-only',
          name: 'Friends only',
          visibility: 'private',
          accessRoles: ['friends'],
          channels: [{ key: 'inner-circle', name: 'inner-circle' }],
        },
        {
          key: 'voice',
          name: 'Voice',
          channels: [
            { key: 'couch', name: 'The Couch', type: 'voice' },
            { key: 'gaming-vc', name: 'Gaming', type: 'voice' },
          ],
        },
      ],
      moderation: { ...baseModeration, antiRaid: false, blockInvites: false, modLogChannel: undefined, memberLogChannel: undefined, serverLogChannel: undefined },
      features: { welcome: { enabled: true, channel: 'general', autoroles: [] } },
    },
  },
  support: {
    info: { id: 'support', name: 'Product support', description: 'Announcements, FAQ, tickets and a staff area.', emoji: '🛟' },
    plan: {
      summary: 'A product support server with FAQ, community help, private tickets and staff channels.',
      roles: [
        ...staffRoles,
        { key: 'support-team', name: 'Support Team', color: '#3498DB', hoist: true, staff: true, permissions: ['ManageThreads', 'ManageMessages'] },
        { key: 'customer', name: 'Customer', color: '#95A5A6' },
        { key: 'updates', name: 'Update Pings', mentionable: true, selfAssignable: true },
      ],
      categories: [
        {
          ...infoCategory,
          accessRoles: ['moderator', 'support-team'],
          channels: [
            { key: 'rules', name: 'rules' },
            { key: 'announcements', name: 'announcements' },
            { key: 'faq', name: 'faq' },
            { key: 'status', name: 'status' },
            { key: 'roles', name: 'get-roles' },
          ],
        },
        {
          key: 'help',
          name: 'Help',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'community-help', name: 'community-help', slowmodeSeconds: 15 },
            { key: 'open-ticket', name: 'open-a-ticket', visibility: 'readonly', accessRoles: ['support-team'] },
            { key: 'feedback', name: 'feedback' },
          ],
        },
        { ...staffCategory, accessRoles: ['moderator', 'support-team'] },
      ],
      rules: rules(['Never share passwords or payment details here. Staff will never ask for them.']),
      selfRolePanels: [{ channel: 'roles', title: 'Updates', roles: [{ role: 'updates', emoji: '📢' }] }],
      moderation: { ...baseModeration, blockLinks: true },
      features: {
        tickets: { enabled: true, panelChannel: 'open-ticket', staffRole: 'support-team' },
        welcome: { enabled: true, channel: 'general', autoroles: ['customer'] },
      },
    },
  },
  esports: {
    info: { id: 'esports', name: 'Esports team', description: 'Rosters, scrims, match results and private team rooms.', emoji: '🏆' },
    plan: {
      summary: 'An esports organisation with public fan areas and private roster, coaching and scrim spaces.',
      roles: [
        ...staffRoles,
        { key: 'coach', name: 'Coach', color: '#E74C3C', hoist: true },
        { key: 'player', name: 'Player', color: '#F39C12', hoist: true },
        { key: 'substitute', name: 'Substitute', color: '#F8C471' },
        { key: 'fan', name: 'Fan', color: '#95A5A6' },
        { key: 'match-ping', name: 'Match Ping', mentionable: true, selfAssignable: true },
      ],
      categories: [
        {
          ...infoCategory,
          channels: [
            { key: 'rules', name: 'rules' },
            { key: 'announcements', name: 'announcements' },
            { key: 'match-results', name: 'match-results' },
            { key: 'roles', name: 'get-roles' },
          ],
        },
        {
          key: 'fans',
          name: 'Fan Zone',
          channels: [
            { key: 'general', name: 'general' },
            { key: 'match-chat', name: 'match-chat', slowmodeSeconds: 5 },
            { key: 'watch-party', name: 'Watch party', type: 'voice' },
          ],
        },
        {
          key: 'team',
          name: 'Team',
          visibility: 'private',
          accessRoles: ['player', 'substitute', 'coach'],
          channels: [
            { key: 'team-chat', name: 'team-chat' },
            { key: 'strategy', name: 'strategy' },
            { key: 'scrim-schedule', name: 'scrim-schedule' },
            { key: 'team-voice', name: 'Team comms', type: 'voice' },
          ],
        },
        staffCategory,
      ],
      rules: rules(['No leaking team strategy or scrim results.']),
      selfRolePanels: [{ channel: 'roles', title: 'Match notifications', roles: [{ role: 'match-ping', emoji: '⚔️' }] }],
      moderation: baseModeration,
      features: {
        welcome: { enabled: true, channel: 'general', autoroles: ['fan'] },
        streamAlerts: [{ platform: 'twitch', channel: 'announcements' }],
      },
    },
  },
};

export const TEMPLATE_LIST: TemplateInfo[] = Object.values(TEMPLATES).map((t) => t.info);
