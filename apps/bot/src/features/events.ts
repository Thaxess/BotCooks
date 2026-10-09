import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type VoiceState,
} from 'discord.js';
import {
  addTempVoiceChannel,
  awardXp,
  getTempVoiceChannel,
  incrementDailyStat,
  markGuildLeft,
  recordAudit,
  removeTempVoiceChannel,
  upsertGuild,
} from '@botcooks/database';
import { BRAND_COLOR, CID, truncate } from '@botcooks/discord';
import { renderTemplate } from '@botcooks/shared';
import { getMe, isAssignableRole, type BotContext } from '../context';
import { setLockdown } from '../commands/moderation';
import { renderWelcome } from '../commands/community';
import { JoinTracker, SpamTracker, accountAgeDays, evaluateMessage } from './automod-rules';
import { logMemberJoin, logMemberLeave, logMessageDelete, logMessageEdit, logServerEvent, sendLog } from './logging';
import { recordModAction } from './moderation';
import { runEventWorkflows } from './workflows';

const spam = new SpamTracker();
const joins = new JoinTracker();

export function registerEvents(ctx: BotContext, client: Client<true>) {
  const safe =
    <A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) =>
    (...args: A) =>
      void fn(...args).catch((e) => ctx.log.error(`event ${name} failed`, { error: e }));

  client.on('guildCreate', safe('guildCreate', async (g) => {
    await upsertGuild(ctx.db, { id: g.id, name: g.name, icon: g.icon, ownerId: g.ownerId });
    await recordAudit(ctx.db, { guildId: g.id, actorId: null, actorType: 'bot', action: 'bot.joined' });
  }));
  client.on('guildUpdate', safe('guildUpdate', async (_old, g) => upsertGuild(ctx.db, { id: g.id, name: g.name, icon: g.icon, ownerId: g.ownerId })));
  client.on('guildDelete', safe('guildDelete', async (g) => markGuildLeft(ctx.db, g.id)));

  client.on('guildMemberAdd', safe('guildMemberAdd', async (member) => onJoin(ctx, member)));
  client.on('guildMemberRemove', safe('guildMemberRemove', async (member) => onLeave(ctx, member)));
  client.on('messageCreate', safe('messageCreate', async (message) => onMessage(ctx, message)));
  client.on('messageDelete', safe('messageDelete', async (m) => logMessageDelete(ctx, m)));
  client.on('messageUpdate', safe('messageUpdate', async (a, b) => logMessageEdit(ctx, a, b)));
  client.on('voiceStateUpdate', safe('voiceStateUpdate', async (a, b) => onVoice(ctx, a, b)));

  client.on('channelCreate', safe('channelCreate', async (c) => logServerEvent(ctx, c.guild, 'Channel created', `${c} (\`${c.name}\`)`, AuditLogEvent.ChannelCreate, c.id)));
  client.on('channelDelete', safe('channelDelete', async (c) => {
    if (c.isDMBased()) return;
    await removeTempVoiceChannel(ctx.db, c.guild.id, c.id);
    await logServerEvent(ctx, c.guild, 'Channel deleted', `\`${c.name}\``, AuditLogEvent.ChannelDelete, c.id);
  }));
  client.on('roleCreate', safe('roleCreate', async (r) => logServerEvent(ctx, r.guild, 'Role created', `${r} (\`${r.name}\`)`, AuditLogEvent.RoleCreate, r.id)));
  client.on('roleDelete', safe('roleDelete', async (r) => logServerEvent(ctx, r.guild, 'Role deleted', `\`${r.name}\``, AuditLogEvent.RoleDelete, r.id)));
  client.on('roleUpdate', safe('roleUpdate', async (before, after) => {
    if (before.permissions.bitfield === after.permissions.bitfield && before.name === after.name) return;
    const added = after.permissions.toArray().filter((p) => !before.permissions.has(p, false));
    const removed = before.permissions.toArray().filter((p) => !after.permissions.has(p, false));
    const parts = [before.name !== after.name ? `renamed \`${before.name}\` → \`${after.name}\`` : '', added.length ? `+ ${added.join(', ')}` : '', removed.length ? `− ${removed.join(', ')}` : ''].filter(Boolean);
    await logServerEvent(ctx, after.guild, 'Role updated', `${after}\n${parts.join('\n')}`, AuditLogEvent.RoleUpdate, after.id);
  }));
}

// ------------------------------------------------------------------ joins
async function onJoin(ctx: BotContext, member: GuildMember) {
  const s = await ctx.settings.get(member.guild.id);
  const flags: string[] = [];
  const age = accountAgeDays(member.user.createdTimestamp);
  if (age < s.antiraid.minAccountAgeDays) flags.push(`New account (${age} day${age === 1 ? '' : 's'} old)`);
  if (!member.user.avatar) flags.push('No avatar');

  if (s.features.antiraid) {
    const r = joins.record(member.guild.id, Date.now(), s.antiraid.joinThreshold, s.antiraid.perSeconds);
    if (r.raid) flags.push(`Join spike: ${r.count} joins in ${s.antiraid.perSeconds}s`);
    if (r.shouldAlert) {
      const alertChannel = s.antiraid.alertChannelId ?? s.moderation.modLogChannelId;
      await sendLog(ctx, member.guild, alertChannel, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('🚨 Possible raid')
            .setDescription(`${r.count} members joined in the last ${s.antiraid.perSeconds} seconds.${s.antiraid.action === 'lockdown' ? '\nAutomatic lockdown is being applied. Use `/lockdown off` to lift it.' : '\nUse `/lockdown on` if needed.'}`),
        ],
      });
      await recordAudit(ctx.db, { guildId: member.guild.id, actorId: null, actorType: 'bot', action: 'antiraid.detected', details: { joins: r.count } });
      if (s.antiraid.action === 'lockdown' && !s.antiraid.lockdownActive) await setLockdown(ctx, member.guild, true, 'Automatic anti-raid lockdown', null);
    }
  }

  await logMemberJoin(ctx, member, flags);

  if (s.features.welcome) {
    if (s.welcome.channelId) {
      const channel = member.guild.channels.cache.get(s.welcome.channelId);
      if (channel?.type === ChannelType.GuildText) {
        const text = renderWelcome(s.welcome.message, member);
        await channel
          .send(
            s.welcome.useEmbed
              ? { embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setDescription(truncate(text, 4000)).setThumbnail(member.user.displayAvatarURL())], allowedMentions: { users: [member.id] } }
              : { content: truncate(text, 2000), allowedMentions: { users: [member.id] } },
          )
          .catch((e) => ctx.log.warn('welcome failed', { error: e }));
      }
    }
    if (s.welcome.dmEnabled) await member.send({ content: truncate(renderWelcome(s.welcome.dmMessage, member), 2000) }).catch(() => undefined);
  }

  // Autoroles wait for verification when verification is on.
  if (s.features.autoroles && !(s.antiraid.verification.enabled && s.features.antiraid)) {
    const me = await getMe(member.guild);
    const ids = member.user.bot ? s.autoroles.botRoleIds : s.autoroles.roleIds;
    const roles = ids.map((id) => member.guild.roles.cache.get(id)).filter((r) => r && isAssignableRole(r, me).ok);
    if (roles.length) await member.roles.add(roles.map((r) => r!.id), 'Autoroles').catch((e) => ctx.log.warn('autoroles failed', { error: e }));
  }

  await runEventWorkflows(ctx, 'memberJoin', member);
}

async function onLeave(ctx: BotContext, member: GuildMember | PartialGuildMember) {
  const s = await ctx.settings.get(member.guild.id);
  await logMemberLeave(ctx, member);
  if (s.features.welcome && s.welcome.goodbyeEnabled) {
    const channel = member.guild.channels.cache.get(s.welcome.goodbyeChannelId ?? s.welcome.channelId ?? '');
    if (channel?.type === ChannelType.GuildText) {
      const text = renderTemplate(s.welcome.goodbyeMessage, { user: `<@${member.id}>`, username: member.user?.username ?? 'Someone', server: member.guild.name, count: member.guild.memberCount });
      await channel.send({ content: truncate(text, 2000), allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }
  if (!member.partial) await runEventWorkflows(ctx, 'memberLeave', member);
}

// ------------------------------------------------------------------ messages
function mentionCount(message: Message): number {
  return message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
}

async function onMessage(ctx: BotContext, message: Message) {
  if (!message.inGuild() || message.author.bot || message.webhookId) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  const s = await ctx.settings.get(message.guildId);
  await incrementDailyStat(ctx.db, message.guildId, 'messages').catch(() => undefined);

  if (s.features.automod) {
    const violation = evaluateMessage(
      s.automod,
      {
        guildId: message.guildId,
        authorId: message.author.id,
        channelId: message.channelId,
        content: ctx.intents.messageContent ? message.content : '',
        mentionCount: mentionCount(message),
        memberRoleIds: [...member.roles.cache.keys()],
        isStaff: member.permissions.has(PermissionFlagsBits.ManageMessages),
        timestamp: message.createdTimestamp,
      },
      spam,
    );
    if (violation) {
      await message.delete().catch(() => undefined);
      if (violation.rule === 'spam' || violation.rule === 'duplicate') spam.reset(message.guildId, message.author.id);
      const timeout = s.automod.action === 'delete_timeout' && member.moderatable;
      if (timeout) await member.timeout(s.automod.timeoutMinutes * 60_000, `Auto-mod: ${violation.reason}`).catch(() => undefined);
      if (s.automod.action !== 'delete' || violation.rule === 'spam') {
        await recordModAction(ctx, message.guild, s, {
          type: 'automod',
          target: message.author,
          moderatorId: 'automod',
          reason: violation.reason,
          ...(timeout ? { durationSeconds: s.automod.timeoutMinutes * 60 } : {}),
          metadata: { rule: violation.rule, channelId: message.channelId },
        }, { dm: s.automod.action !== 'delete' });
      } else {
        await sendLog(ctx, message.guild, s.automod.alertChannelId, {
          content: `🧹 Removed a message from <@${message.author.id}> in <#${message.channelId}>: ${violation.reason}`,
        });
      }
      return;
    }
  }

  if (s.features.levels && !s.levels.noXpChannelIds.includes(message.channelId) && !member.roles.cache.some((r) => s.levels.noXpRoleIds.includes(r.id))) {
    const amount = s.levels.xpMin + Math.floor(Math.random() * (Math.max(s.levels.xpMax, s.levels.xpMin) - s.levels.xpMin + 1));
    const r = await awardXp(ctx.db, message.guildId, message.author.id, amount, s.levels.cooldownSeconds);
    if (r.awarded && r.level > r.previousLevel) await onLevelUp(ctx, message, member, r.level);
  }

  if (ctx.intents.messageContent) await runEventWorkflows(ctx, 'messageCreate', member, { channelId: message.channelId, message });
}

async function onLevelUp(ctx: BotContext, message: Message<true>, member: GuildMember, level: number) {
  const s = await ctx.settings.get(message.guildId);
  const me = await getMe(message.guild);
  const earned = s.levels.rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  if (earned.length) {
    const keep = s.levels.stackRewards ? earned : earned.slice(-1);
    const add = keep.map((r) => message.guild.roles.cache.get(r.roleId)).filter((r) => r && isAssignableRole(r, me).ok && !member.roles.cache.has(r.id));
    const remove = s.levels.stackRewards ? [] : earned.slice(0, -1).map((r) => r.roleId).filter((id) => member.roles.cache.has(id));
    if (add.length) await member.roles.add(add.map((r) => r!.id), `Level ${level} reward`).catch(() => undefined);
    if (remove.length) await member.roles.remove(remove, 'Level reward replaced').catch(() => undefined);
  }
  if (s.levels.announce === 'off') return;
  const text = renderTemplate(s.levels.message, { user: `<@${member.id}>`, username: member.user.username, level, server: message.guild.name });
  if (s.levels.announce === 'dm') return void (await member.send(truncate(text, 2000)).catch(() => undefined));
  const channel = s.levels.announce === 'channel' && s.levels.announceChannelId ? message.guild.channels.cache.get(s.levels.announceChannelId) : message.channel;
  if (channel?.isTextBased() && 'send' in channel) await channel.send({ content: truncate(text, 2000), allowedMentions: { users: [member.id] } }).catch(() => undefined);
}

// ------------------------------------------------------------------ temporary voice
async function onVoice(ctx: BotContext, before: VoiceState, after: VoiceState) {
  const guild = after.guild;
  const s = await ctx.settings.get(guild.id);
  // Clean up the room the member left, if it is now empty.
  if (before.channelId && before.channelId !== after.channelId) {
    const temp = await getTempVoiceChannel(ctx.db, guild.id, before.channelId);
    if (temp && before.channel && before.channel.members.size === 0) {
      await before.channel.delete('Temporary voice room empty').catch(() => undefined);
      await removeTempVoiceChannel(ctx.db, guild.id, before.channelId);
    }
  }
  if (!s.features.tempVoice || !s.tempVoice.hubChannelId || after.channelId !== s.tempVoice.hubChannelId || !after.member) return;
  const hub = after.channel!;
  const me = await getMe(guild);
  if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) return;
  const parentId = s.tempVoice.categoryId ?? hub.parentId ?? undefined;
  const name = renderTemplate(s.tempVoice.nameTemplate, { user: after.member.displayName, username: after.member.user.username }).slice(0, 100);
  const room = await guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    ...(parentId ? { parent: parentId } : {}),
    userLimit: s.tempVoice.userLimit,
    // The owner can rename / set a limit on their own room, nothing more.
    permissionOverwrites: [
      ...(hub.parent?.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })) ?? []),
      { id: after.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect] },
    ],
    reason: `Temporary voice room for ${after.member.user.tag}`,
  });
  await addTempVoiceChannel(ctx.db, { channelId: room.id, guildId: guild.id, ownerId: after.member.id });
  await after.member.voice.setChannel(room, 'Temporary voice room').catch(async () => {
    await room.delete('Owner left before move').catch(() => undefined);
    await removeTempVoiceChannel(ctx.db, guild.id, room.id);
  });
}

/** Posts a verification panel. Exported for the dashboard-triggered "post panel" job later. */
export function verificationPanel() {
  return {
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Verify to join the conversation').setDescription('Press the button below to get access to the rest of the server.')],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(CID.verify).setLabel('Verify').setStyle(ButtonStyle.Success))],
  };
}
