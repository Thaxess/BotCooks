import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild, type GuildMember, type User } from 'discord.js';
import { countActiveWarnings, createCase, incrementDailyStat, recordAudit, type ModCaseRow } from '@botcooks/database';
import { BRAND_COLOR, CID, DANGER_COLOR, truncate } from '@botcooks/discord';
import type { GuildSettings } from '@botcooks/shared';
import type { BotContext } from '../context';
import { formatDuration } from '../commands/definitions';
import { sendLog } from './logging';

const TYPE_LABEL: Record<ModCaseRow['type'], string> = {
  warn: 'Warning',
  timeout: 'Timeout',
  untimeout: 'Timeout removed',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  note: 'Note',
  purge: 'Purge',
  automod: 'Auto-moderation',
};

export function caseEmbed(c: ModCaseRow, extra?: { userTag?: string }) {
  const e = new EmbedBuilder()
    .setTitle(`Case #${c.caseNumber} · ${TYPE_LABEL[c.type]}`)
    .setColor(c.type === 'note' || c.type === 'unban' || c.type === 'untimeout' ? BRAND_COLOR : DANGER_COLOR)
    .addFields(
      { name: 'Member', value: `<@${c.userId}>${extra?.userTag ? ` (${extra.userTag})` : ''}`, inline: true },
      { name: 'Moderator', value: c.moderatorId === 'automod' ? 'Auto-mod' : `<@${c.moderatorId}>`, inline: true },
    )
    .setTimestamp(c.createdAt);
  if (c.durationSeconds) e.addFields({ name: 'Duration', value: formatDuration(c.durationSeconds), inline: true });
  e.addFields({ name: 'Reason', value: truncate(c.reason ?? 'No reason given', 1000) });
  if (!c.active) e.setFooter({ text: 'Pardoned / inactive' });
  if (c.appealStatus !== 'none') e.addFields({ name: 'Appeal', value: c.appealStatus });
  return e;
}

/** Records a case, posts it to the mod log and (optionally) DMs the member with an appeal button. */
export async function recordModAction(
  ctx: BotContext,
  guild: Guild,
  settings: GuildSettings,
  input: { type: ModCaseRow['type']; target: User; moderatorId: string; reason: string | null; durationSeconds?: number | null; metadata?: Record<string, unknown> },
  opts: { dm: boolean } = { dm: true },
) {
  const c = await createCase(ctx.db, {
    guildId: guild.id,
    type: input.type,
    userId: input.target.id,
    moderatorId: input.moderatorId,
    reason: input.reason,
    durationSeconds: input.durationSeconds ?? null,
    metadata: input.metadata ?? null,
  });
  await recordAudit(ctx.db, {
    guildId: guild.id,
    actorId: input.moderatorId === 'automod' ? null : input.moderatorId,
    actorType: input.moderatorId === 'automod' ? 'bot' : 'user',
    action: `moderation.${input.type}`,
    target: input.target.id,
    details: { case: c.caseNumber, reason: input.reason, duration: input.durationSeconds ?? null },
  });
  await incrementDailyStat(ctx.db, guild.id, input.type === 'automod' ? 'automodActions' : 'modActions').catch(() => undefined);
  await sendLog(ctx, guild, settings.moderation.modLogChannelId ?? settings.logging.modLogChannelId, { embeds: [caseEmbed(c, { userTag: input.target.tag })] });

  if (opts.dm && settings.moderation.dmOnAction && input.type !== 'note' && input.type !== 'purge') {
    const embed = new EmbedBuilder()
      .setTitle(`${TYPE_LABEL[input.type]} in ${guild.name}`)
      .setColor(DANGER_COLOR)
      .setDescription(truncate(input.reason ?? 'No reason given', 1500))
      .setFooter({ text: `Case #${c.caseNumber}` });
    if (input.durationSeconds) embed.addFields({ name: 'Duration', value: formatDuration(input.durationSeconds) });
    const components =
      settings.moderation.appealsEnabled && ['warn', 'timeout', 'kick', 'ban', 'automod'].includes(input.type)
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${CID.appeal}:${guild.id}:${c.caseNumber}`).setLabel('Appeal').setStyle(ButtonStyle.Secondary))]
        : [];
    // DMs fail when the user blocks DMs from server members; that is fine.
    await input.target.send({ embeds: [embed], components }).catch(() => undefined);
  }
  return c;
}

/** After a warning, applies the strictest matching escalation rule. */
export async function applyEscalation(ctx: BotContext, guild: Guild, settings: GuildSettings, member: GuildMember): Promise<string | null> {
  if (!settings.moderation.escalation.length) return null;
  const count = await countActiveWarnings(ctx.db, guild.id, member.id, settings.moderation.warningExpiryDays);
  const rule = [...settings.moderation.escalation].filter((r) => r.warnings <= count).sort((a, b) => b.warnings - a.warnings)[0];
  if (!rule || rule.warnings !== count) return null; // only fire when the threshold is crossed
  const reason = `Automatic escalation: ${count} active warnings`;
  const me = guild.members.me;
  if (!me || me.roles.highest.position <= member.roles.highest.position || member.id === guild.ownerId) return null;
  try {
    if (rule.action === 'timeout') {
      const seconds = (rule.durationMinutes ?? 60) * 60;
      await member.timeout(seconds * 1000, reason);
      await recordModAction(ctx, guild, settings, { type: 'timeout', target: member.user, moderatorId: 'automod', reason, durationSeconds: seconds });
    } else if (rule.action === 'kick') {
      await recordModAction(ctx, guild, settings, { type: 'kick', target: member.user, moderatorId: 'automod', reason });
      await member.kick(reason);
    } else {
      await recordModAction(ctx, guild, settings, { type: 'ban', target: member.user, moderatorId: 'automod', reason });
      await guild.members.ban(member.id, { reason });
    }
    return `${rule.action} (escalation after ${count} warnings)`;
  } catch (e) {
    ctx.log.warn('escalation failed', { guildId: guild.id, error: e });
    return null;
  }
}
