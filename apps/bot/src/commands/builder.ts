import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { TemplateId } from '@botcooks/ai';
import { getExecution, getLatestPlanVersion, getPlanVersion, schema } from '@botcooks/database';
import { BRAND_COLOR, CID, DANGER_COLOR, dashboardUrl, planReadyMessage, truncate } from '@botcooks/discord';
import { encryptSecret } from '@botcooks/security';
import { UserFacingError, serverPlanSchema } from '@botcooks/shared';
import { buildPreview, confirmPlan, getGuildAccess, reviseBuild, startBuild } from '@botcooks/services';
import { validatePlan } from '@botcooks/security';
import { diffPlan } from '@botcooks/workflows';
import type { BotContext } from '../context';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Pending Discord confirmations: a short id in the button maps to the signed confirmation token.
 * Kept in memory on purpose; a restart simply means "review again". The token itself is still
 * verified server-side against the plan, the live server state, the user and the expiry.
 */
interface PendingConfirmation {
  token: string;
  planVersionId: string;
  userId: string;
  guildId: string;
  elevation: boolean;
  reasons: string[];
  expires: number;
}
const pending = new Map<string, PendingConfirmation>();

function remember(entry: PendingConfirmation) {
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const id = randomBytes(6).toString('base64url');
  pending.set(id, entry);
  return id;
}

function interactionBlob(ctx: BotContext, token: string) {
  // Interaction tokens are valid for 15 minutes; store encrypted so the worker can edit the reply.
  return encryptSecret(JSON.stringify({ token, expiresAt: Date.now() + 14 * 60_000 }), ctx.secret);
}

function errorText(e: unknown): string {
  return e instanceof UserFacingError ? e.message : 'Something went wrong. Please try again.';
}

export async function handleBuildServer(ctx: BotContext, i: ChatInputCommandInteraction<'cached'>) {
  const settings = await ctx.settings.get(i.guildId);
  if (!settings.features.builder) {
    await i.reply({ content: 'The AI builder is turned off for this server.', flags: EPHEMERAL });
    return;
  }
  const { access } = await getGuildAccess(ctx.db, ctx.rest, i.guildId, i.user.id, { fresh: true });
  if (access.tier === 'none' || (access.tier === 'delegate' && !access.scopes.has('builder'))) {
    await i.reply({ content: 'You need Manage Server (or delegated builder access) to use this.', flags: EPHEMERAL });
    return;
  }
  const prompt = i.options.getString('prompt') ?? undefined;
  const templateId = (i.options.getString('template') as TemplateId | null) ?? undefined;
  if (!prompt && !templateId) {
    await i.reply({ content: 'Give me a `prompt` describing your server, or pick a `template`.', flags: EPHEMERAL });
    return;
  }
  await i.deferReply({ flags: EPHEMERAL });
  try {
    const session = await startBuild(ctx.builder, {
      guildId: i.guildId,
      userId: i.user.id,
      source: 'discord',
      ...(prompt ? { prompt } : {}),
      ...(templateId ? { templateId } : {}),
      interactionEnc: templateId ? null : interactionBlob(ctx, i.token),
    });
    if (session.status === 'ready') {
      const version = await getLatestPlanVersion(ctx.db, i.guildId, session.id);
      if (version) await i.editReply(await readyMessage(ctx, i.guildId, version.id, session.id));
      return;
    }
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('🍳 Cooking up your server plan…')
          .setDescription('This usually takes 15-60 seconds. I will update this message when it is ready. Nothing on your server changes until you confirm.'),
      ],
    });
  } catch (e) {
    await i.editReply({ content: errorText(e) });
  }
}

async function readyMessage(ctx: BotContext, guildId: string, versionId: string, sessionId: string) {
  const version = (await getPlanVersion(ctx.db, guildId, versionId))!;
  const snapshot = await ctx.builder.fetchSnapshot(guildId);
  const validated = validatePlan(serverPlanSchema.parse(version.plan), snapshot);
  const change = diffPlan(validated.plan, snapshot, { mode: 'additive' });
  return planReadyMessage({
    summary: validated.plan.summary,
    version: version.version,
    planVersionId: version.id,
    sessionId,
    counts: change.counts,
    warnings: [...validated.issues.filter((x) => x.level === 'warning').map((x) => x.message), ...change.warnings],
    downgrades: validated.downgrades.length,
    elevation: change.risk.elevation,
    url: dashboardUrl(ctx.publicUrl, `/dashboard/${guildId}/builder?session=${sessionId}`),
  }) as never;
}

/** Review button: fresh permission check, fresh server snapshot, full validation and diff. */
export async function handlePlanReview(ctx: BotContext, i: ButtonInteraction<'cached'>, planVersionId: string) {
  await i.deferReply({ flags: EPHEMERAL });
  try {
    const { access, ownerId } = await getGuildAccess(ctx.db, ctx.rest, i.guildId, i.user.id, { fresh: true });
    const preview = await buildPreview(ctx.builder, { guildId: i.guildId, planVersionId, mode: 'additive', userId: i.user.id, access, ownerId });
    const lines = preview.change.diff
      .filter((d) => d.action === 'create' || d.action === 'update')
      .slice(0, 25)
      .map((d) => `${d.action === 'create' ? '➕' : '✏️'} ${d.kind === 'role' ? 'Role' : d.kind === 'category' ? 'Category' : ''} ${truncate(d.label, 60)}`.replace(/\s+/g, ' '));
    const more = preview.change.diff.filter((d) => d.action === 'create' || d.action === 'update').length - lines.length;
    const embed = new EmbedBuilder()
      .setColor(preview.blockers.length ? DANGER_COLOR : BRAND_COLOR)
      .setTitle(`Review plan v${preview.version} for ${truncate(preview.guildName, 60)}`)
      .setDescription(truncate(`${lines.join('\n')}${more > 0 ? `\n…and ${more} more (see dashboard)` : ''}`, 4000))
      .addFields({
        name: 'Summary',
        value: `${preview.change.counts.create} create · ${preview.change.counts.update} update · ${preview.change.counts.delete} delete · ${preview.change.counts.skipped} left as-is`,
      });
    if (preview.change.requiredBotPermissions.length) embed.addFields({ name: 'BotCooks will use', value: preview.change.requiredBotPermissions.join(', ') });
    const warnings = [...preview.validation.issues.filter((x) => x.level !== 'info').map((x) => x.message), ...preview.change.warnings];
    if (warnings.length) embed.addFields({ name: 'Warnings', value: truncate(warnings.slice(0, 6).map((w) => `• ${w}`).join('\n'), 1024) });
    if (preview.validation.downgrades.length) {
      embed.addFields({ name: 'Adjusted', value: truncate(preview.validation.downgrades.slice(0, 5).map((d) => `• ${d.path}: ${d.from} → ${d.to} (${d.reason})`).join('\n'), 1024) });
    }
    if (preview.blockers.length || !preview.confirmation) {
      embed.addFields({ name: 'Cannot apply', value: truncate(preview.blockers.join('\n') || 'Not allowed.', 1024) });
      await i.editReply({ embeds: [embed] });
      return;
    }
    const id = remember({
      token: preview.confirmation.token,
      planVersionId,
      userId: i.user.id,
      guildId: i.guildId,
      elevation: preview.needsElevationAck,
      reasons: preview.change.risk.reasons,
      expires: preview.confirmation.expiresAt,
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CID.planConfirm}:${id}`).setLabel('Apply these changes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CID.planCancel}:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    embed.setFooter({ text: 'Additive mode: existing channels and roles are not changed or deleted. This confirmation expires in 10 minutes.' });
    await i.editReply({ embeds: [embed], components: [row] });
  } catch (e) {
    await i.editReply({ content: errorText(e) });
  }
}

export async function handlePlanConfirm(ctx: BotContext, i: ButtonInteraction<'cached'>, id: string, elevationAcknowledged: boolean) {
  const entry = pending.get(id);
  if (!entry || entry.expires < Date.now()) {
    await i.reply({ content: 'This confirmation expired. Press "Review & apply" again.', flags: EPHEMERAL });
    return;
  }
  if (entry.userId !== i.user.id || entry.guildId !== i.guildId) {
    await i.reply({ content: 'Only the person who reviewed this plan can confirm it.', flags: EPHEMERAL });
    return;
  }
  if (entry.elevation && !elevationAcknowledged) {
    // Separate, explicit step for permission elevation.
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${CID.planElevate}:${id}`).setLabel('I understand: grant these permissions and apply').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${CID.planCancel}:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await i.update({
      embeds: [
        new EmbedBuilder()
          .setColor(DANGER_COLOR)
          .setTitle('This plan grants powerful permissions')
          .setDescription(truncate(entry.reasons.map((r) => `• ${r}`).join('\n'), 4000))
          .setFooter({ text: 'Anyone with these roles will be able to use these permissions.' }),
      ],
      components: [row],
    });
    return;
  }
  await i.deferUpdate();
  pending.delete(id);
  try {
    const { access, ownerId } = await getGuildAccess(ctx.db, ctx.rest, i.guildId, i.user.id, { fresh: true });
    const exec = await confirmPlan(ctx.builder, {
      guildId: i.guildId,
      planVersionId: entry.planVersionId,
      mode: 'additive',
      userId: i.user.id,
      access,
      ownerId,
      token: entry.token,
      acknowledgeElevation: elevationAcknowledged,
      acknowledgeDestructive: false,
    });
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Applying your plan…').setDescription('BotCooks is creating your channels and roles. A backup snapshot was saved first.')],
      components: [statusRow(exec.id)],
    });
  } catch (e) {
    await i.editReply({ content: errorText(e), embeds: [], components: [] });
  }
}

export async function handlePlanCancel(i: ButtonInteraction<'cached'>, id: string) {
  pending.delete(id);
  await i.update({ content: 'Cancelled. Nothing was changed.', embeds: [], components: [] });
}

function statusRow(executionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CID.planStatus}:${executionId}`).setLabel('Refresh status').setStyle(ButtonStyle.Secondary),
  );
}

export async function handlePlanStatus(ctx: BotContext, i: ButtonInteraction<'cached'>, executionId: string) {
  const exec = await getExecution(ctx.db, i.guildId, executionId);
  if (!exec) {
    await i.reply({ content: 'Not found.', flags: EPHEMERAL });
    return;
  }
  const report = exec.report as { done: number; failed: number; skipped: number; errors: Array<{ message: string }> } | null;
  const done = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(exec.status);
  const embed = new EmbedBuilder()
    .setColor(exec.status === 'completed' ? 0x22c55e : exec.status === 'failed' ? DANGER_COLOR : BRAND_COLOR)
    .setTitle(`Status: ${exec.status.replace(/_/g, ' ')}`)
    .setDescription(
      done && report
        ? `${report.done} done · ${report.failed} failed · ${report.skipped} skipped${report.errors.length ? `\n\n${truncate(report.errors.slice(0, 5).map((e) => `• ${e.message}`).join('\n'), 1500)}` : ''}`
        : `${exec.progressDone}/${exec.progressTotal} · ${exec.progressLabel ?? 'Waiting for worker'}`,
    );
  const url = dashboardUrl(ctx.publicUrl, `/dashboard/${i.guildId}/backups`);
  if (done && url) embed.setFooter({ text: 'You can review or roll back this change in the dashboard (Backups).' });
  await i.update({ embeds: [embed], components: done ? [] : [statusRow(executionId)] });
}

export async function handleReviseButton(ctx: BotContext, i: ButtonInteraction<'cached'>, sessionId: string) {
  const [session] = await ctx.db.select({ id: schema.buildSessions.id, guildId: schema.buildSessions.guildId }).from(schema.buildSessions).where(eq(schema.buildSessions.id, sessionId)).limit(1);
  if (!session || session.guildId !== i.guildId) {
    await i.reply({ content: 'Build not found.', flags: EPHEMERAL });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`${CID.planRevise}:${sessionId}`)
    .setTitle('Revise the plan')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('instruction').setLabel('What should change?').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(1500).setRequired(true),
      ),
    );
  await i.showModal(modal);
}

export async function handleReviseSubmit(ctx: BotContext, i: ModalSubmitInteraction<'cached'>, sessionId: string) {
  const { access } = await getGuildAccess(ctx.db, ctx.rest, i.guildId, i.user.id, { fresh: true });
  if (access.tier === 'none' || (access.tier === 'delegate' && !access.scopes.has('builder'))) {
    await i.reply({ content: 'You do not have builder access.', flags: EPHEMERAL });
    return;
  }
  await i.deferReply({ flags: EPHEMERAL });
  try {
    await reviseBuild(ctx.builder, { guildId: i.guildId, sessionId, userId: i.user.id, instruction: i.fields.getTextInputValue('instruction') });
    await ctx.db
      .update(schema.buildSessions)
      .set({ interactionEnc: interactionBlob(ctx, i.token) })
      .where(and(eq(schema.buildSessions.id, sessionId), eq(schema.buildSessions.guildId, i.guildId)));
    await i.editReply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🍳 Revising your plan…').setDescription('I will update this message when the new version is ready.')] });
  } catch (e) {
    await i.editReply({ content: errorText(e) });
  }
}
