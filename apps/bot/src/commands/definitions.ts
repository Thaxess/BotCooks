import { PermissionFlagsBits, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { TEMPLATE_LIST } from '@botcooks/ai';

/**
 * Global slash commands. `default_member_permissions` is the first gate (server admins can tune
 * it under Integrations); every handler re-checks permissions and role hierarchy itself.
 */
const guildOnly = [InteractionContextType.Guild];

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('build-server')
    .setDescription('Describe your ideal server and let BotCooks draft a plan you can review.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('prompt').setDescription('What should the server look like?').setMaxLength(2000))
    .addStringOption((o) =>
      o
        .setName('template')
        .setDescription('Start from a ready-made template instead')
        .addChoices(...TEMPLATE_LIST.map((t) => ({ name: `${t.emoji} ${t.name}`, value: t.id }))),
    ),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and record a case.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true).setMaxLength(10))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a timeout.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addIntegerOption((o) =>
      o
        .setName('delete_messages')
        .setDescription('Delete their recent messages')
        .addChoices({ name: 'None', value: 0 }, { name: 'Last hour', value: 3600 }, { name: 'Last day', value: 86400 }, { name: 'Last 7 days', value: 604800 }),
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in this channel (up to 14 days old).')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('How many to check (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user')),

  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add a private moderator note about a member.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('Note').setRequired(true).setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('Moderation cases.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('view').setDescription('Show a case').addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('list').setDescription("List a member's cases").addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('reason')
        .setDescription('Update the reason of a case')
        .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName('pardon').setDescription('Mark a warning inactive').addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))),

  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Stop @everyone from sending messages in all text channels (or lift it).')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your level and XP.')
    .setContexts(guildOnly)
    .addUserOption((o) => o.setName('user').setDescription('Someone else')),

  new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by XP.').setContexts(guildOnly),

  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Post the "open a ticket" panel in a channel.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('channel').setDescription('Defaults to the configured panel channel')),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 1d, 7d').setRequired(true).setMaxLength(10))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(20))
    .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can enter')),

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a native Discord poll.')
    .setContexts(guildOnly)
    .addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('answers').setDescription('Answers separated by ; (2-10)').setRequired(true).setMaxLength(1000))
    .addIntegerOption((o) => o.setName('hours').setDescription('Duration in hours (1-768)').setMinValue(1).setMaxValue(768))
    .addBooleanOption((o) => o.setName('multiple').setDescription('Allow multiple answers')),

  new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Appeal a moderation case against you.')
    .setContexts(guildOnly)
    .addIntegerOption((o) => o.setName('case').setDescription('Case number').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why should it be reconsidered?').setRequired(true).setMaxLength(1500)),

  new SlashCommandBuilder()
    .setName('botcooks')
    .setDescription('BotCooks status and diagnostics for this server.')
    .setContexts(guildOnly)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];


/** Parses 10s / 15m / 2h / 3d / 1w into seconds. Returns null on invalid input. */
export function parseDuration(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d{1,5})\s*(s|sec|m|min|h|hr|d|day|days|w|wk)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!;
  const mult = unit.startsWith('s') ? 1 : unit.startsWith('m') ? 60 : unit.startsWith('h') ? 3600 : unit.startsWith('d') ? 86400 : 604800;
  const seconds = n * mult;
  return seconds > 0 ? seconds : null;
}

export function formatDuration(seconds: number): string {
  if (seconds % 604800 === 0) return `${seconds / 604800}w`;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
