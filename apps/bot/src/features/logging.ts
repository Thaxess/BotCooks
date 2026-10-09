import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Message,
  type MessageCreateOptions,
  type PartialGuildMember,
  type PartialMessage,
} from 'discord.js';
import { incrementDailyStat } from '@botcooks/database';
import { BRAND_COLOR, DANGER_COLOR, OK_COLOR, truncate } from '@botcooks/discord';
import type { BotContext } from '../context';

/** Posts to a configured log channel if BotCooks can; failures are logged, never thrown. */
export async function sendLog(ctx: BotContext, guild: Guild, channelId: string | undefined, payload: MessageCreateOptions) {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const me = guild.members.me;
  if (me && !channel.permissionsFor(me).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;
  await channel.send({ allowedMentions: { parse: [] }, ...payload }).catch((e) => ctx.log.warn('log send failed', { guildId: guild.id, error: e }));
}

export async function logMemberJoin(ctx: BotContext, member: GuildMember, flags: string[]) {
  const s = await ctx.settings.get(member.guild.id);
  await incrementDailyStat(ctx.db, member.guild.id, 'joins').catch(() => undefined);
  if (!s.features.logging) return;
  const embed = new EmbedBuilder()
    .setColor(OK_COLOR)
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
    .setDescription(`<@${member.id}> joined`)
    .addFields({ name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true })
    .setFooter({ text: `ID ${member.id}` })
    .setTimestamp();
  if (flags.length) embed.addFields({ name: '⚠️ Signals', value: flags.join('\n') });
  await sendLog(ctx, member.guild, s.logging.memberLogChannelId, { embeds: [embed] });
}

export async function logMemberLeave(ctx: BotContext, member: GuildMember | PartialGuildMember) {
  const s = await ctx.settings.get(member.guild.id);
  await incrementDailyStat(ctx.db, member.guild.id, 'leaves').catch(() => undefined);
  if (!s.features.logging) return;
  const embed = new EmbedBuilder()
    .setColor(DANGER_COLOR)
    .setDescription(`<@${member.id}> left${member.user ? ` (${member.user.tag})` : ''}`)
    .setFooter({ text: `ID ${member.id}` })
    .setTimestamp();
  await sendLog(ctx, member.guild, s.logging.memberLogChannelId, { embeds: [embed] });
}

export async function logServerEvent(ctx: BotContext, guild: Guild, title: string, description: string, auditType?: AuditLogEvent, targetId?: string) {
  const s = await ctx.settings.get(guild.id);
  if (!s.features.logging || !s.logging.serverLogChannelId) return;
  let actor = '';
  if (auditType !== undefined && guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    // Best effort: audit logs can lag and may not contain the entry yet.
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 3 }).catch(() => null);
    const entry = logs?.entries.find((e) => (!targetId || (e.target as { id?: string } | null)?.id === targetId) && Date.now() - e.createdTimestamp < 15_000);
    if (entry?.executorId) actor = ` by <@${entry.executorId}>`;
  }
  await sendLog(ctx, guild, s.logging.serverLogChannelId, {
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(title).setDescription(`${description}${actor}`).setTimestamp()],
  });
}

/** Message logs only run when explicitly enabled AND the Message Content intent is available. */
export async function logMessageDelete(ctx: BotContext, message: Message | PartialMessage) {
  if (!message.guild || message.author?.bot) return;
  const s = await ctx.settings.get(message.guild.id);
  if (!s.features.logging || !s.logging.logMessageDeletes || !s.logging.messageLogChannelId) return;
  if (message.channelId === s.logging.messageLogChannelId) return;
  const content = !ctx.intents.messageContent
    ? '(content unavailable: Message Content intent disabled)'
    : s.logging.redactMessageContent
      ? '(content hidden: redaction is on)'
      : message.content
        ? truncate(message.content, 1000)
        : '(not cached or no text)';
  await sendLog(ctx, message.guild, s.logging.messageLogChannelId, {
    embeds: [
      new EmbedBuilder()
        .setColor(DANGER_COLOR)
        .setTitle('Message deleted')
        .setDescription(`${message.author ? `<@${message.author.id}>` : 'Unknown author'} in <#${message.channelId}>\n${content}`)
        .setTimestamp(),
    ],
  });
}

export async function logMessageEdit(ctx: BotContext, before: Message | PartialMessage, after: Message | PartialMessage) {
  if (!after.guild || after.author?.bot) return;
  const s = await ctx.settings.get(after.guild.id);
  if (!s.features.logging || !s.logging.logMessageEdits || !s.logging.messageLogChannelId) return;
  if (before.content === after.content) return; // embed-only updates
  const body =
    !ctx.intents.messageContent || s.logging.redactMessageContent
      ? '(content hidden)'
      : `**Before:** ${truncate(before.content ?? '(not cached)', 500)}\n**After:** ${truncate(after.content ?? '', 500)}`;
  await sendLog(ctx, after.guild, s.logging.messageLogChannelId, {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('Message edited')
        .setDescription(`<@${after.author?.id}> in <#${after.channelId}> · [jump](${after.url})\n${body}`)
        .setTimestamp(),
    ],
  });
}
