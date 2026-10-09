import { MessageFlags, type Interaction } from 'discord.js';
import { CID } from '@botcooks/discord';
import { UserFacingError } from '@botcooks/shared';
import type { BotContext } from '../context';
import {
  handleBuildServer,
  handlePlanCancel,
  handlePlanConfirm,
  handlePlanReview,
  handlePlanStatus,
  handleReviseButton,
  handleReviseSubmit,
} from '../commands/builder';
import {
  handleAppealButton,
  handleAppealSubmit,
  handleGiveaway,
  handleGiveawayEnter,
  handleLeaderboard,
  handlePoll,
  handleRank,
  handleSelfRoleButton,
  handleSelfRoleSelect,
  handleStatus,
  handleTicketClaim,
  handleTicketClose,
  handleTicketOpen,
  handleTicketPanel,
  handleVerify,
} from '../commands/community';
import { handleModerationCommand } from '../commands/moderation';
import { runCustomCommand } from '../features/workflows';

/** Splits "bc:plan:review:<arg>" into [prefix, arg] by matching known prefixes. */
function match(customId: string, prefix: string): string | null {
  return customId.startsWith(`${prefix}:`) ? customId.slice(prefix.length + 1) : customId === prefix ? '' : null;
}

export async function routeInteraction(ctx: BotContext, i: Interaction) {
  try {
    // DM interactions: only appeals are supported.
    if (!i.inCachedGuild()) {
      if (i.isButton()) {
        const arg = match(i.customId, CID.appeal);
        if (arg !== null) {
          const [guildId, caseNumber] = arg.split(':');
          if (guildId && caseNumber) await handleAppealButton(i, guildId, caseNumber);
        }
      } else if (i.isModalSubmit()) {
        const arg = match(i.customId, CID.appeal);
        if (arg !== null) {
          const [guildId, caseNumber] = arg.split(':');
          if (guildId && caseNumber) await handleAppealSubmit(ctx, i, guildId, caseNumber);
        }
      }
      return;
    }

    if (i.isChatInputCommand()) {
      switch (i.commandName) {
        case 'build-server':
          return await handleBuildServer(ctx, i);
        case 'rank':
          return await handleRank(ctx, i);
        case 'leaderboard':
          return await handleLeaderboard(ctx, i);
        case 'ticket-panel':
          return await handleTicketPanel(ctx, i);
        case 'giveaway':
          return await handleGiveaway(ctx, i);
        case 'poll':
          return await handlePoll(ctx, i);
        case 'botcooks':
          return await handleStatus(ctx, i);
      }
      if (await handleModerationCommand(ctx, i)) return;
      if (await runCustomCommand(ctx, i)) return;
      await i.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (i.isButton()) {
      const id = i.customId;
      let arg: string | null;
      if ((arg = match(id, CID.planReview)) !== null) return await handlePlanReview(ctx, i, arg);
      if ((arg = match(id, CID.planConfirm)) !== null) return await handlePlanConfirm(ctx, i, arg, false);
      if ((arg = match(id, CID.planElevate)) !== null) return await handlePlanConfirm(ctx, i, arg, true);
      if ((arg = match(id, CID.planCancel)) !== null) return await handlePlanCancel(i, arg);
      if ((arg = match(id, CID.planStatus)) !== null) return await handlePlanStatus(ctx, i, arg);
      if ((arg = match(id, CID.planRevise)) !== null) return await handleReviseButton(ctx, i, arg);
      if (id === CID.ticketOpen) return await handleTicketOpen(ctx, i);
      if (id === CID.ticketClose) return await handleTicketClose(ctx, i);
      if (id === CID.ticketClaim) return await handleTicketClaim(ctx, i);
      if (id === CID.verify) return await handleVerify(ctx, i);
      if ((arg = match(id, CID.giveawayEnter)) !== null) return await handleGiveawayEnter(ctx, i, arg);
      if ((arg = match(id, CID.selfRole)) !== null && /^\d{17,20}$/.test(arg)) return await handleSelfRoleButton(ctx, i, arg);
      return;
    }

    if (i.isStringSelectMenu()) {
      if (i.customId === `${CID.selfRole}:select`) return await handleSelfRoleSelect(ctx, i);
      return;
    }

    if (i.isModalSubmit()) {
      const arg = match(i.customId, CID.planRevise);
      if (arg !== null) return await handleReviseSubmit(ctx, i, arg);
    }
  } catch (e) {
    ctx.log.error('interaction failed', { error: e, type: i.type, guildId: i.guildId });
    if (!i.isRepliable()) return;
    const content = e instanceof UserFacingError ? e.message : 'Something went wrong while handling that.';
    if (i.deferred || i.replied) await i.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
