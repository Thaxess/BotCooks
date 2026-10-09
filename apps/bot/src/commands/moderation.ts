import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type PermissionResolvable,
} from 'discord.js';
import { getCase, listCases, mutateSettings, openAppeal, recordAudit, setCaseActive, updateCaseReason } from '@botcooks/database';
import { BRAND_COLOR, truncate } from '@botcooks/discord';
import { canModerate, getMe, type BotContext } from '../context';
import { applyEscalation, caseEmbed, recordModAction } from '../features/moderation';
import { sendLog } from '../features/logging';
import { formatDuration, parseDuration } from './definitions';

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_TIMEOUT_SECONDS = 28 * 86400;

async function prepare(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>, perm: PermissionResolvable) {
  const settings = await ctx.settings.get(i.guildId);
  if (!settings.features.moderation) {
    await i.reply({ content: 'Moderation is turned off for this server (enable it in the dashboard).', flags: EPHEMERAL });
    return null;
  }
  // default_member_permissions can be overridden by server admins, so check again here.
  if (!i.memberPermissions.has(perm)) {
    await i.reply({ content: 'You do not have permission to use this command.', flags: EPHEMERAL });
    return null;
  }
  const reason = i.options.getString('reason')?.trim() || null;
  if (settings.moderation.requireReason && !reason && ['warn', 'timeout', 'kick', 'ban'].includes(i.commandName)) {
    await i.reply({ content: 'A reason is required on this server.', flags: EPHEMERAL });
    return null;
  }
  return { settings, reason, me: await getMe(i.guild) };
}

async function deny(i: ChatInputCommandInteraction<'cached'>, content: string): Promise<true> {
  await i.reply({ content, flags: EPHEMERAL });
  return true;
}

async function targetMember(i: ChatInputCommandInteraction<'cached'>): Promise<GuildMember | null> {
  const user = i.options.getUser('user', true);
  return i.guild.members.fetch(user.id).catch(() => null);
}

export async function handleModerationCommand(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>): Promise<boolean> {
  switch (i.commandName) {
    case 'warn': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ModerateMembers);
      if (!p) return true;
      const target = await targetMember(i);
      if (!target) return deny(i, 'That user is not in this server.');
      const check = canModerate(i.member, target, p.me);
      if (!check.ok) return deny(i, check.reason);
      await i.deferReply({ flags: EPHEMERAL });
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'warn', target: target.user, moderatorId: i.user.id, reason: p.reason });
      const escalated = await applyEscalation(ctx, i.guild, p.settings, target);
      await i.editReply(`Warned ${target} (case #${c.caseNumber}).${escalated ? ` Escalation applied: ${escalated}.` : ''}`);
      return true;
    }
    case 'timeout': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ModerateMembers);
      if (!p) return true;
      const seconds = parseDuration(i.options.getString('duration', true));
      if (!seconds || seconds > MAX_TIMEOUT_SECONDS) return deny(i, 'Use a duration like 10m, 2h or 3d (max 28d).');
      const target = await targetMember(i);
      if (!target) return deny(i, 'That user is not in this server.');
      const check = canModerate(i.member, target, p.me);
      if (!check.ok) return deny(i, check.reason);
      if (target.permissions.has(PermissionFlagsBits.Administrator)) return deny(i, 'Administrators cannot be timed out.');
      await i.deferReply({ flags: EPHEMERAL });
      await target.timeout(seconds * 1000, truncate(`${p.reason ?? 'No reason'} (by ${i.user.tag})`, 500));
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'timeout', target: target.user, moderatorId: i.user.id, reason: p.reason, durationSeconds: seconds });
      await i.editReply(`Timed out ${target} for ${formatDuration(seconds)} (case #${c.caseNumber}).`);
      return true;
    }
    case 'untimeout': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ModerateMembers);
      if (!p) return true;
      const target = await targetMember(i);
      if (!target) return deny(i, 'That user is not in this server.');
      const check = canModerate(i.member, target, p.me);
      if (!check.ok) return deny(i, check.reason);
      await i.deferReply({ flags: EPHEMERAL });
      await target.timeout(null, p.reason ?? undefined);
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'untimeout', target: target.user, moderatorId: i.user.id, reason: p.reason }, { dm: false });
      await i.editReply(`Removed timeout for ${target} (case #${c.caseNumber}).`);
      return true;
    }
    case 'kick': {
      const p = await prepare(ctx, i, PermissionFlagsBits.KickMembers);
      if (!p) return true;
      const target = await targetMember(i);
      if (!target) return deny(i, 'That user is not in this server.');
      const check = canModerate(i.member, target, p.me);
      if (!check.ok) return deny(i, check.reason);
      await i.deferReply({ flags: EPHEMERAL });
      // Record (and DM) first: after the kick we can no longer reach them through the server.
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'kick', target: target.user, moderatorId: i.user.id, reason: p.reason });
      await target.kick(truncate(`${p.reason ?? 'No reason'} (by ${i.user.tag})`, 500));
      await i.editReply(`Kicked ${target.user.tag} (case #${c.caseNumber}).`);
      return true;
    }
    case 'ban': {
      const p = await prepare(ctx, i, PermissionFlagsBits.BanMembers);
      if (!p) return true;
      const user = i.options.getUser('user', true);
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        const check = canModerate(i.member, member, p.me);
        if (!check.ok) return deny(i, check.reason);
      } else if (user.id === i.guild.ownerId || user.id === i.user.id) {
        return deny(i, 'You cannot ban that user.');
      }
      await i.deferReply({ flags: EPHEMERAL });
      const deleteSeconds = i.options.getInteger('delete_messages') ?? 0;
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'ban', target: user, moderatorId: i.user.id, reason: p.reason, metadata: { deleteMessageSeconds: deleteSeconds } });
      await i.guild.members.ban(user.id, { reason: truncate(`${p.reason ?? 'No reason'} (by ${i.user.tag})`, 500), deleteMessageSeconds: deleteSeconds });
      await i.editReply(`Banned ${user.tag} (case #${c.caseNumber}).`);
      return true;
    }
    case 'unban': {
      const p = await prepare(ctx, i, PermissionFlagsBits.BanMembers);
      if (!p) return true;
      const userId = i.options.getString('user_id', true).trim();
      if (!/^\d{17,20}$/.test(userId)) return deny(i, 'That is not a valid user ID.');
      await i.deferReply({ flags: EPHEMERAL });
      const user = await i.client.users.fetch(userId).catch(() => null);
      try {
        await i.guild.members.unban(userId, p.reason ?? undefined);
      } catch {
        await i.editReply('That user is not banned (or I lack permission).');
        return true;
      }
      if (user) await recordModAction(ctx, i.guild, p.settings, { type: 'unban', target: user, moderatorId: i.user.id, reason: p.reason }, { dm: false });
      await i.editReply(`Unbanned ${user?.tag ?? userId}.`);
      return true;
    }
    case 'purge': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ManageMessages);
      if (!p) return true;
      const channel = i.channel;
      if (!channel || channel.type !== ChannelType.GuildText) return deny(i, 'Purge only works in text channels.');
      const count = Math.min(i.options.getInteger('count', true), p.settings.moderation.maxPurge, 100);
      const user = i.options.getUser('user');
      await i.deferReply({ flags: EPHEMERAL });
      const fetched = await channel.messages.fetch({ limit: count });
      const cutoff = Date.now() - 14 * 86400_000 + 60_000; // bulk delete only works for < 14 days
      const toDelete = fetched.filter((m) => m.createdTimestamp > cutoff && !m.pinned && (!user || m.author.id === user.id));
      const deleted = await channel.bulkDelete(toDelete, true);
      await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'moderation.purge', target: channel.id, details: { deleted: deleted.size, user: user?.id ?? null } });
      await sendLog(ctx, i.guild, p.settings.moderation.modLogChannelId, {
        embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Messages purged').setDescription(`${deleted.size} messages in <#${channel.id}> by <@${i.user.id}>${user ? ` (from <@${user.id}>)` : ''}`)],
      });
      await i.editReply(`Deleted ${deleted.size} message(s). Pinned messages and messages older than 14 days are skipped.`);
      return true;
    }
    case 'note': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ModerateMembers);
      if (!p) return true;
      const user = i.options.getUser('user', true);
      const c = await recordModAction(ctx, i.guild, p.settings, { type: 'note', target: user, moderatorId: i.user.id, reason: i.options.getString('text', true) }, { dm: false });
      await i.reply({ content: `Note saved as case #${c.caseNumber}.`, flags: EPHEMERAL });
      return true;
    }
    case 'case': {
      const p = await prepare(ctx, i, PermissionFlagsBits.ModerateMembers);
      if (!p) return true;
      const sub = i.options.getSubcommand();
      if (sub === 'view') {
        const c = await getCase(ctx.db, i.guildId, i.options.getInteger('number', true));
        await i.reply(c ? { embeds: [caseEmbed(c)], flags: EPHEMERAL } : { content: 'No such case.', flags: EPHEMERAL });
      } else if (sub === 'list') {
        const user = i.options.getUser('user', true);
        const { items } = await listCases(ctx.db, i.guildId, { userId: user.id, limit: 15 });
        const lines = items.map((c) => `\`#${c.caseNumber}\` ${c.type}${c.active ? '' : ' (inactive)'} · <t:${Math.floor(c.createdAt.getTime() / 1000)}:d> · ${truncate(c.reason ?? '—', 60)}`);
        await i.reply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Cases for ${user.tag}`).setDescription(lines.join('\n') || 'No cases.')], flags: EPHEMERAL });
      } else if (sub === 'reason') {
        const c = await updateCaseReason(ctx.db, i.guildId, i.options.getInteger('number', true), i.options.getString('reason', true));
        if (c) await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'moderation.case_reason', target: String(c.caseNumber) });
        await i.reply({ content: c ? `Updated case #${c.caseNumber}.` : 'No such case.', flags: EPHEMERAL });
      } else if (sub === 'pardon') {
        const c = await setCaseActive(ctx.db, i.guildId, i.options.getInteger('number', true), false);
        if (c) await recordAudit(ctx.db, { guildId: i.guildId, actorId: i.user.id, actorType: 'user', action: 'moderation.pardon', target: String(c.caseNumber) });
        await i.reply({ content: c ? `Case #${c.caseNumber} is now inactive.` : 'No such case.', flags: EPHEMERAL });
      }
      return true;
    }
    case 'lockdown': {
      if (!i.memberPermissions.has(PermissionFlagsBits.ManageChannels)) return deny(i, 'You need Manage Channels.');
      await i.deferReply({ flags: EPHEMERAL });
      const on = i.options.getString('state', true) === 'on';
      const result = await setLockdown(ctx, i.guild, on, `${i.options.getString('reason') ?? 'Manual lockdown'} (by ${i.user.tag})`, i.user.id);
      await i.editReply(result);
      return true;
    }
    case 'appeal': {
      const s = await ctx.settings.get(i.guildId);
      if (!s.moderation.appealsEnabled) return deny(i, 'Appeals are not enabled on this server.');
      const c = await openAppeal(ctx.db, i.guildId, i.options.getInteger('case', true), i.user.id, i.options.getString('reason', true));
      if (!c) return deny(i, 'You cannot appeal that case (it is not yours, already appealed, or not appealable).');
      await sendLog(ctx, i.guild, s.moderation.appealsChannelId ?? s.moderation.modLogChannelId, { embeds: [caseEmbed(c).setTitle(`Appeal for case #${c.caseNumber}`).addFields({ name: 'Appeal', value: truncate(c.appealText ?? '', 1000) })] });
      await i.reply({ content: 'Your appeal was submitted to the moderators.', flags: EPHEMERAL });
      return true;
    }
  }
  return false;
}

/**
 * Lockdown: denies SendMessages for @everyone on every text channel where it is currently
 * allowed, remembering the previous overwrite so `off` restores exactly what was there.
 */
export async function setLockdown(ctx: BotContext, guild: GuildMember['guild'], on: boolean, reason: string, actorId: string | null): Promise<string> {
  const settings = await ctx.settings.get(guild.id);
  const me = await getMe(guild);
  if (on) {
    if (settings.antiraid.lockdownActive) return 'Lockdown is already active.';
    const locked: Array<{ channelId: string; previousAllow: string; previousDeny: string }> = [];
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum) continue;
      if (!channel.permissionsFor(me).has(PermissionFlagsBits.ManageRoles)) continue;
      if (!channel.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.SendMessages)) continue;
      const ow = channel.permissionOverwrites.cache.get(guild.id);
      locked.push({ channelId: channel.id, previousAllow: (ow?.allow.bitfield ?? 0n).toString(), previousDeny: (ow?.deny.bitfield ?? 0n).toString() });
      await channel.permissionOverwrites.edit(guild.id, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason }).catch(() => locked.pop());
    }
    await mutateSettings(ctx.db, guild.id, actorId, (s) => {
      s.antiraid.lockdownActive = true;
      s.antiraid.lockedChannels = locked.slice(0, 500);
    });
    ctx.settings.invalidate(guild.id);
    await recordAudit(ctx.db, { guildId: guild.id, actorId, actorType: actorId ? 'user' : 'bot', action: 'antiraid.lockdown_on', details: { channels: locked.length, reason } });
    await sendLog(ctx, guild, settings.antiraid.alertChannelId ?? settings.moderation.modLogChannelId, { content: `🔒 Lockdown enabled on ${locked.length} channel(s). ${reason}` });
    return `Locked ${locked.length} channel(s). Run /lockdown off to restore them.`;
  }
  if (!settings.antiraid.lockdownActive) return 'No lockdown is active.';
  let restored = 0;
  for (const entry of settings.antiraid.lockedChannels) {
    const channel = guild.channels.cache.get(entry.channelId);
    if (!channel || !('permissionOverwrites' in channel)) continue;
    try {
      if (entry.previousAllow === '0' && entry.previousDeny === '0') await channel.permissionOverwrites.delete(guild.id, reason);
      else await channel.permissionOverwrites.set([...channel.permissionOverwrites.cache.filter((o) => o.id !== guild.id).values(), { id: guild.id, allow: BigInt(entry.previousAllow), deny: BigInt(entry.previousDeny) }], reason);
      restored++;
    } catch (e) {
      ctx.log.warn('lockdown restore failed', { channelId: entry.channelId, error: e });
    }
  }
  await mutateSettings(ctx.db, guild.id, actorId, (s) => {
    s.antiraid.lockdownActive = false;
    s.antiraid.lockedChannels = [];
  });
  ctx.settings.invalidate(guild.id);
  await recordAudit(ctx.db, { guildId: guild.id, actorId, actorType: actorId ? 'user' : 'bot', action: 'antiraid.lockdown_off', details: { restored } });
  await sendLog(ctx, guild, settings.antiraid.alertChannelId ?? settings.moderation.modLogChannelId, { content: `🔓 Lockdown lifted; restored ${restored} channel(s).` });
  return `Restored ${restored} channel(s).`;
}
