import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  claimTicket,
  closeTicket,
  countGiveawayEntries,
  countOpenTickets,
  createGiveaway,
  enterGiveaway,
  getGiveaway,
  getRank,
  getSelfRolePanelByMessage,
  getTicketByThread,
  leaderboard,
  leaveGiveaway,
  openAppeal,
  openTicket,
  recordAudit,
  setGiveawayMessage,
  setTicketThread,
} from '@botcooks/database';
import { BRAND_COLOR, CID, truncate } from '@botcooks/discord';
import { FEATURES, getFeature, levelFromXp, renderTemplate } from '@botcooks/shared';
import { getMe, isAssignableRole, type BotContext } from '../context';
import { sendLog } from '../features/logging';
import { caseEmbed } from '../features/moderation';
import { parseDuration } from './definitions';

const EPHEMERAL = MessageFlags.Ephemeral;

async function featureOff(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>, label: string) {
  await i.reply({ content: `${label} is turned off for this server.`, flags: EPHEMERAL });
}

// ------------------------------------------------------------------ levels
export async function handleRank(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.levels) return featureOff(i, 'Levels');
  const user = i.options.getUser('user') ?? i.user;
  const rank = await getRank(ctx.db, i.guildId, user.id);
  if (!rank) return void (await i.reply({ content: `${user.id === i.user.id ? 'You have' : `${user.username} has`} no XP yet.`, flags: EPHEMERAL }));
  const { level, intoLevel, needed } = levelFromXp(rank.xp);
  const bar = '█'.repeat(Math.round((intoLevel / needed) * 12)).padEnd(12, '░');
  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setDescription(`**Level ${level}** · Rank #${rank.rank}\n\`${bar}\` ${intoLevel}/${needed} XP\nTotal ${rank.xp} XP · ${rank.messages} messages`),
    ],
  });
}

export async function handleLeaderboard(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.levels) return featureOff(i, 'Levels');
  const rows = await leaderboard(ctx.db, i.guildId, 10);
  const lines = rows.map((r, n) => `**${n + 1}.** <@${r.userId}> · level ${levelFromXp(r.xp).level} · ${r.xp} XP`);
  await i.reply({
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🏆 Leaderboard').setDescription(lines.join('\n') || 'Nobody has XP yet.')],
    allowedMentions: { parse: [] },
  });
}

// ------------------------------------------------------------------ tickets
export async function handleTicketPanel(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.tickets) return featureOff(i, 'Tickets');
  if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return void (await i.reply({ content: 'You need Manage Server.', flags: EPHEMERAL }));
  const channel = i.options.getChannel('channel') ?? (s.tickets.panelChannelId ? i.guild.channels.cache.get(s.tickets.panelChannelId) : null) ?? i.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return void (await i.reply({ content: 'Pick a text channel.', flags: EPHEMERAL }));
  const me = await getMe(i.guild);
  if (!channel.permissionsFor(me).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePrivateThreads])) {
    return void (await i.reply({ content: `I need Send Messages and Create Private Threads in ${channel}.`, flags: EPHEMERAL }));
  }
  await channel.send({
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Need help?').setDescription('Press the button to open a private ticket with the staff team.')],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(CID.ticketOpen).setLabel('Open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary))],
  });
  await i.reply({ content: `Ticket panel posted in ${channel}.`, flags: EPHEMERAL });
}

export async function handleTicketOpen(ctx: BotContext, i: ButtonInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.tickets) return featureOff(i, 'Tickets');
  const channel = i.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return void (await i.reply({ content: 'Tickets must be opened from a text channel.', flags: EPHEMERAL }));
  if ((await countOpenTickets(ctx.db, i.guildId, i.user.id)) >= s.tickets.maxOpenPerUser) {
    return void (await i.reply({ content: 'You already have an open ticket.', flags: EPHEMERAL }));
  }
  await i.deferReply({ flags: EPHEMERAL });
  const ticket = await openTicket(ctx.db, { guildId: i.guildId, openerId: i.user.id, subject: null });
  try {
    const thread = await channel.threads.create({
      name: `ticket-${String(ticket.number).padStart(4, '0')}-${i.user.username}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Ticket #${ticket.number} for ${i.user.tag}`,
    });
    await setTicketThread(ctx.db, i.guildId, ticket.id, thread.id);
    await thread.members.add(i.user.id);
    const staffMentions = s.tickets.staffRoleIds.map((r) => `<@&${r}>`).join(' ');
    await thread.send({
      content: `${i.user} ${staffMentions}`.trim(),
      embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Ticket #${ticket.number}`).setDescription(s.tickets.openMessage)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(CID.ticketClaim).setLabel('Claim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CID.ticketClose).setLabel('Close').setStyle(ButtonStyle.Danger),
        ),
      ],
      // Mentioning staff roles adds them to the private thread.
      allowedMentions: { users: [i.user.id], roles: s.tickets.staffRoleIds },
    });
    await i.editReply(`Your ticket is open: ${thread}`);
    await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'ticket.open', target: String(ticket.number) });
  } catch (e) {
    await closeTicket(ctx.db, i.guildId, ticket.id, 'system');
    ctx.log.warn('ticket thread failed', { error: e });
    await i.editReply('I could not create a private thread here. Ask an admin to check my permissions.');
  }
}

function isTicketStaff(member: GuildMember, staffRoleIds: string[]) {
  return member.permissions.has(PermissionFlagsBits.ManageThreads) || member.roles.cache.some((r) => staffRoleIds.includes(r.id));
}

export async function handleTicketClose(ctx: BotContext, i: ButtonInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  const thread = i.channel;
  if (!thread?.isThread()) return void (await i.reply({ content: 'Use this inside a ticket.', flags: EPHEMERAL }));
  const ticket = await getTicketByThread(ctx.db, i.guildId, thread.id);
  if (!ticket || ticket.status !== 'open') return void (await i.reply({ content: 'This ticket is already closed.', flags: EPHEMERAL }));
  if (ticket.openerId !== i.user.id && !isTicketStaff(i.member, s.tickets.staffRoleIds)) {
    return void (await i.reply({ content: 'Only the ticket owner or staff can close it.', flags: EPHEMERAL }));
  }
  await closeTicket(ctx.db, i.guildId, ticket.id, i.user.id);
  await i.reply({ content: `Ticket closed by ${i.user}.`, allowedMentions: { parse: [] } });
  await thread.setLocked(true).catch(() => undefined);
  await thread.setArchived(true).catch(() => undefined);
  await sendLog(ctx, i.guild, s.tickets.logChannelId, { content: `🎫 Ticket #${ticket.number} (<@${ticket.openerId}>) closed by <@${i.user.id}>.` });
  await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'ticket.close', target: String(ticket.number) });
}

export async function handleTicketClaim(ctx: BotContext, i: ButtonInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  const thread = i.channel;
  if (!thread?.isThread()) return;
  const ticket = await getTicketByThread(ctx.db, i.guildId, thread.id);
  if (!ticket) return void (await i.reply({ content: 'Not a ticket.', flags: EPHEMERAL }));
  if (!isTicketStaff(i.member, s.tickets.staffRoleIds)) return void (await i.reply({ content: 'Only staff can claim tickets.', flags: EPHEMERAL }));
  await claimTicket(ctx.db, i.guildId, ticket.id, i.user.id);
  await i.reply({ content: `${i.user} is handling this ticket.`, allowedMentions: { parse: [] } });
}

// ------------------------------------------------------------------ giveaways
export async function handleGiveaway(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.giveaways) return featureOff(i, 'Giveaways');
  if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return void (await i.reply({ content: 'You need Manage Server.', flags: EPHEMERAL }));
  const seconds = parseDuration(i.options.getString('duration', true));
  if (!seconds || seconds < 60 || seconds > 30 * 86400) return void (await i.reply({ content: 'Duration must be between 1 minute and 30 days (e.g. 1h, 3d).', flags: EPHEMERAL }));
  const channel = i.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return void (await i.reply({ content: 'Use this in a text channel.', flags: EPHEMERAL }));
  const prize = i.options.getString('prize', true);
  const winners = i.options.getInteger('winners') ?? 1;
  const role = i.options.getRole('required_role');
  const endsAt = new Date(Date.now() + seconds * 1000);
  const g = await createGiveaway(ctx.db, { guildId: i.guildId, channelId: channel.id, prize, winnerCount: winners, hostId: i.user.id, requiredRoleId: role?.id ?? null, endsAt });
  const msg = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🎉 Giveaway')
        .setDescription(`**${truncate(prize, 200)}**\nEnds <t:${Math.floor(endsAt.getTime() / 1000)}:R> · ${winners} winner(s)${role ? `\nRequires ${role}` : ''}\nHosted by ${i.user}`),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${CID.giveawayEnter}:${g.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Primary))],
    allowedMentions: { parse: [] },
  });
  await setGiveawayMessage(ctx.db, i.guildId, g.id, msg.id);
  await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'giveaway.start', target: g.id, details: { prize, winners, endsAt } });
  await i.reply({ content: 'Giveaway started!', flags: EPHEMERAL });
}

export async function handleGiveawayEnter(ctx: BotContext, i: ButtonInteraction<'cached'>, giveawayId: string) {
  const g = await getGiveaway(ctx.db, i.guildId, giveawayId);
  if (!g || g.ended || g.endsAt < new Date()) return void (await i.reply({ content: 'This giveaway has ended.', flags: EPHEMERAL }));
  if (g.requiredRoleId && !i.member.roles.cache.has(g.requiredRoleId)) return void (await i.reply({ content: `You need <@&${g.requiredRoleId}> to enter.`, flags: EPHEMERAL, allowedMentions: { parse: [] } }));
  const result = await enterGiveaway(ctx.db, g.id, i.user.id);
  if (result === 'already') {
    await leaveGiveaway(ctx.db, g.id, i.user.id);
    return void (await i.reply({ content: 'You left the giveaway.', flags: EPHEMERAL }));
  }
  const count = await countGiveawayEntries(ctx.db, g.id);
  await i.reply({ content: `You're in! (${count} entries)`, flags: EPHEMERAL });
}

// ------------------------------------------------------------------ polls (native Discord polls)
export async function handlePoll(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.polls) return featureOff(i, 'Polls');
  const answers = i.options
    .getString('answers', true)
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean);
  if (answers.length < 2 || answers.length > 10) return void (await i.reply({ content: 'Give 2 to 10 answers separated by `;`.', flags: EPHEMERAL }));
  if (answers.some((a) => a.length > 55)) return void (await i.reply({ content: 'Each answer can be at most 55 characters.', flags: EPHEMERAL }));
  await i.reply({
    poll: {
      question: { text: i.options.getString('question', true) },
      answers: answers.map((text) => ({ text })),
      duration: i.options.getInteger('hours') ?? 24,
      allowMultiselect: i.options.getBoolean('multiple') ?? false,
    },
  });
}

// ------------------------------------------------------------------ self roles
export async function handleSelfRoleButton(ctx: BotContext, i: ButtonInteraction<'cached'>, roleId: string) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.selfroles) return featureOff(i, 'Self-roles');
  // Only roles registered for THIS panel message can be toggled.
  const panel = await getSelfRolePanelByMessage(ctx.db, i.guildId, i.message.id);
  if (!panel || !panel.roleIds.includes(roleId)) return void (await i.reply({ content: 'This role panel is no longer active.', flags: EPHEMERAL }));
  const role = i.guild.roles.cache.get(roleId);
  if (!role) return void (await i.reply({ content: 'That role no longer exists.', flags: EPHEMERAL }));
  const check = isAssignableRole(role, await getMe(i.guild));
  if (!check.ok) return void (await i.reply({ content: check.reason, flags: EPHEMERAL }));
  if (i.member.roles.cache.has(roleId)) {
    await i.member.roles.remove(roleId, 'Self-role panel');
    await i.reply({ content: `Removed ${role}.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  } else {
    await i.member.roles.add(roleId, 'Self-role panel');
    await i.reply({ content: `Added ${role}.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }
}

export async function handleSelfRoleSelect(ctx: BotContext, i: StringSelectMenuInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  if (!s.features.selfroles) return void (await i.reply({ content: 'Self-roles are turned off.', flags: EPHEMERAL }));
  const panel = await getSelfRolePanelByMessage(ctx.db, i.guildId, i.message.id);
  if (!panel) return void (await i.reply({ content: 'This role panel is no longer active.', flags: EPHEMERAL }));
  const me = await getMe(i.guild);
  const selected = new Set(i.values.filter((v) => panel.roleIds.includes(v)));
  const add: string[] = [];
  const remove: string[] = [];
  for (const roleId of panel.roleIds) {
    const role = i.guild.roles.cache.get(roleId);
    if (!role || !isAssignableRole(role, me).ok) continue;
    const has = i.member.roles.cache.has(roleId);
    if (selected.has(roleId) && !has) add.push(roleId);
    if (!selected.has(roleId) && has) remove.push(roleId);
  }
  if (add.length) await i.member.roles.add(add, 'Self-role panel');
  if (remove.length) await i.member.roles.remove(remove, 'Self-role panel');
  await i.reply({ content: `Updated your roles (${add.length} added, ${remove.length} removed).`, flags: EPHEMERAL });
}

// ------------------------------------------------------------------ verification
export async function handleVerify(ctx: BotContext, i: ButtonInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  const v = s.antiraid.verification;
  if (!v.enabled || !v.verifiedRoleId) return void (await i.reply({ content: 'Verification is not set up.', flags: EPHEMERAL }));
  const ageDays = Math.floor((Date.now() - i.user.createdTimestamp) / 86_400_000);
  if (ageDays < s.antiraid.minAccountAgeDays) {
    return void (await i.reply({ content: `Your account is too new to verify automatically. A moderator will review it.`, flags: EPHEMERAL }));
  }
  const role = i.guild.roles.cache.get(v.verifiedRoleId);
  if (!role || role.position >= (await getMe(i.guild)).roles.highest.position) return void (await i.reply({ content: 'Verification role is misconfigured.', flags: EPHEMERAL }));
  await i.member.roles.add(role, 'Verification');
  await i.reply({ content: 'You are verified. Welcome!', flags: EPHEMERAL });
}

// ------------------------------------------------------------------ appeals from DMs
export async function handleAppealButton(i: ButtonInteraction, guildId: string, caseNumber: string) {
  await i.showModal(
    new ModalBuilder()
      .setCustomId(`${CID.appeal}:${guildId}:${caseNumber}`)
      .setTitle(`Appeal case #${caseNumber}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('text').setLabel('Why should this be reconsidered?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1500),
        ),
      ),
  );
}

export async function handleAppealSubmit(ctx: BotContext, i: ModalSubmitInteraction, guildId: string, caseNumber: string) {
  const guild = ctx.client.guilds.cache.get(guildId);
  const s = guild ? await ctx.settings.get(guildId) : null;
  if (!guild || !s?.moderation.appealsEnabled) return void (await i.reply({ content: 'Appeals are not available for that server.' }));
  // openAppeal enforces that the case belongs to THIS user and has not been appealed before.
  const c = await openAppeal(ctx.db, guildId, Number(caseNumber), i.user.id, i.fields.getTextInputValue('text'));
  if (!c) return void (await i.reply({ content: 'This case cannot be appealed (already appealed or not yours).' }));
  await sendLog(ctx, guild, s.moderation.appealsChannelId ?? s.moderation.modLogChannelId, {
    embeds: [caseEmbed(c).setTitle(`Appeal for case #${c.caseNumber}`).addFields({ name: 'Appeal', value: truncate(c.appealText ?? '', 1000) })],
  });
  await i.reply({ content: 'Your appeal was sent to the moderators.' });
}

// ------------------------------------------------------------------ diagnostics
export async function handleStatus(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const s = await ctx.settings.get(i.guildId);
  const me = await getMe(i.guild);
  const lines: string[] = [];
  for (const f of FEATURES) {
    if (!s.features[f.key]) continue;
    const missing: string[] = [];
    for (const r of f.requires) {
      if (r.kind === 'botPermission' && !me.permissions.has(r.key as keyof typeof PermissionFlagsBits)) missing.push(`permission ${r.key}`);
      if (r.kind === 'intent') {
        const ok = r.key === 'GuildMembers' ? ctx.intents.members : r.key === 'MessageContent' ? ctx.intents.messageContent : ctx.client.options.intents.has(GatewayIntentBits[r.key as keyof typeof GatewayIntentBits]);
        if (!ok) missing.push(`${r.label}${r.privileged ? ' (privileged)' : ''}`);
      }
    }
    const status = getFeature(f.key).status;
    lines.push(`${missing.length ? '⚠️' : '✅'} **${f.label}**${status !== 'implemented' ? ` (${status})` : ''}${missing.length ? ` — missing ${missing.join(', ')}` : ''}`);
  }
  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('BotCooks status')
        .setDescription(lines.join('\n') || 'No features enabled.')
        .addFields({ name: 'My highest role', value: `${me.roles.highest} (position ${me.roles.highest.position})` }),
    ],
    flags: EPHEMERAL,
    allowedMentions: { parse: [] },
  });
}

export function renderWelcome(template: string, member: GuildMember) {
  return renderTemplate(template, { user: `<@${member.id}>`, username: member.user.username, server: member.guild.name, count: member.guild.memberCount });
}
