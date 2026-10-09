import { randomInt } from 'node:crypto';
import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import {
  claimDueScheduledMessages,
  dueGiveaways,
  finishGiveaway,
  getSettings,
  listAllEnabledStreamSubscriptions,
  listGiveawayEntrants,
  purgeAuditOlderThan,
  purgeExpiredSessions,
  schema,
  purgeFinishedJobs,
  recordAudit,
  recoverExpiredJobs,
  updateScheduledMessage,
  updateStreamSubscription,
  type Database,
} from '@botcooks/database';
import { BRAND_COLOR, isDiscordNotFound, sendChannelMessage, truncate } from '@botcooks/discord';
import { IntegrationError, KickClient, TwitchClient, fetchYouTubeLatest, shouldAlert, type LiveStatus } from '@botcooks/integrations';
import { renderTemplate, type GuildSettings, type Logger } from '@botcooks/shared';

export interface PeriodicContext {
  db: Database;
  rest: REST;
  log: Logger;
  twitch: TwitchClient | null;
  kick: KickClient | null;
}

/** Runs `fn` every `ms`, never overlapping with itself. */
export function every(ms: number, name: string, log: Logger, fn: () => Promise<void>): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout;
  const loop = async () => {
    try {
      await fn();
    } catch (e) {
      log.error(`periodic task ${name} failed`, { error: e });
    }
    if (!stopped) timer = setTimeout(loop, ms);
  };
  timer = setTimeout(loop, Math.min(ms, 5_000));
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function settingsCache(db: Database) {
  const cache = new Map<string, GuildSettings>();
  return async (guildId: string) => {
    let s = cache.get(guildId);
    if (!s) {
      s = (await getSettings(db, guildId)).settings;
      cache.set(guildId, s);
    }
    return s;
  };
}

// ------------------------------------------------------------------ scheduled messages
export async function sendScheduledMessages(ctx: PeriodicContext) {
  const due = await claimDueScheduledMessages(ctx.db);
  const settingsFor = settingsCache(ctx.db);
  for (const m of due) {
    if (!(await settingsFor(m.guildId)).features.scheduled) continue;
    try {
      await sendChannelMessage(ctx.rest, m.channelId, {
        ...(m.content ? { content: m.content } : {}),
        ...(m.embed ? { embeds: [m.embed] } : {}),
      });
      await updateScheduledMessage(ctx.db, m.guildId, m.id, { lastError: null });
    } catch (e) {
      const message = isDiscordNotFound(e) ? 'Channel no longer exists; message disabled.' : truncate((e as Error).message, 300);
      await updateScheduledMessage(ctx.db, m.guildId, m.id, { lastError: message, ...(isDiscordNotFound(e) ? { enabled: false } : {}) });
      ctx.log.warn('scheduled message failed', { id: m.id, error: e });
    }
  }
}

// ------------------------------------------------------------------ giveaways
export function pickWinners(entrants: string[], count: number, rand: (max: number) => number = randomInt): string[] {
  const pool = [...entrants];
  const winners: string[] = [];
  while (pool.length && winners.length < count) winners.push(pool.splice(rand(pool.length), 1)[0]!);
  return winners;
}

export async function endDueGiveaways(ctx: PeriodicContext) {
  for (const g of await dueGiveaways(ctx.db)) {
    const entrants = await listGiveawayEntrants(ctx.db, g.id);
    const winners = pickWinners(entrants, g.winnerCount);
    if (!(await finishGiveaway(ctx.db, g.guildId, g.id, winners))) continue; // another worker ended it
    const description = winners.length
      ? `**${g.prize}**\nWinner${winners.length > 1 ? 's' : ''}: ${winners.map((w) => `<@${w}>`).join(', ')}`
      : `**${g.prize}**\nNo valid entries, so there is no winner.`;
    try {
      if (g.messageId) {
        await ctx.rest.patch(Routes.channelMessage(g.channelId, g.messageId), {
          body: {
            embeds: [{ title: '🎉 Giveaway ended', description, color: BRAND_COLOR, footer: { text: `${entrants.length} entries` } }],
            components: [],
            allowed_mentions: { parse: [] },
          },
        });
      }
      if (winners.length) {
        await ctx.rest.post(Routes.channelMessages(g.channelId), {
          body: {
            content: `Congratulations ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${truncate(g.prize, 200)}**.`,
            allowed_mentions: { users: winners },
            ...(g.messageId ? { message_reference: { message_id: g.messageId, fail_if_not_exists: false } } : {}),
          },
        });
      }
      await recordAudit(ctx.db, { guildId: g.guildId, actorId: null, actorType: 'system', action: 'giveaway.ended', target: g.id, details: { winners, entries: entrants.length } });
    } catch (e) {
      ctx.log.warn('could not announce giveaway result', { giveawayId: g.id, error: e });
    }
  }
}

// ------------------------------------------------------------------ stream alerts
async function postAlert(ctx: PeriodicContext, sub: { guildId: string; channelId: string; message: string; pingRoleId: string | null; account: string; platform: string }, status: { title: string | null; url: string; game?: string | null }) {
  const text = renderTemplate(sub.message, { account: sub.account, url: status.url, title: status.title ?? '', game: status.game ?? '', platform: sub.platform });
  await sendChannelMessage(ctx.rest, sub.channelId, {
    content: truncate(`${sub.pingRoleId ? `<@&${sub.pingRoleId}> ` : ''}${text}`, 2000),
    allowed_mentions: sub.pingRoleId ? { roles: [sub.pingRoleId] } : { parse: [] },
  });
}

export async function pollStreams(ctx: PeriodicContext) {
  const settingsFor = settingsCache(ctx.db);
  const enabledFor = async (guildId: string) => (await settingsFor(guildId)).features.streamAlerts;

  // YouTube: per channel feed.
  const yt = await listAllEnabledStreamSubscriptions(ctx.db, 'youtube', 200);
  const feeds = new Map<string, Awaited<ReturnType<typeof fetchYouTubeLatest>> | Error>();
  for (const sub of yt) {
    if (!(await enabledFor(sub.guildId))) continue;
    if (!feeds.has(sub.account)) feeds.set(sub.account, await fetchYouTubeLatest(sub.account).catch((e: Error) => e));
    const latest = feeds.get(sub.account);
    if (latest instanceof Error) {
      await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: latest.message, ...(latest instanceof IntegrationError && !latest.retryable ? { enabled: false } : {}) });
      continue;
    }
    const prev = sub.lastState as { id?: string } | null;
    const current = { live: Boolean(latest), id: latest?.videoId ?? null };
    // The first check only records the latest video so old uploads are not announced.
    if (prev && latest && shouldAlert(prev, current)) {
      try {
        await postAlert(ctx, sub, { title: latest.title, url: latest.url });
      } catch (e) {
        await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: (e as Error).message });
        continue;
      }
    }
    await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: null, lastState: { id: current.id } });
  }

  // Twitch & Kick: batched live status.
  for (const [platform, client] of [
    ['twitch', ctx.twitch],
    ['kick', ctx.kick],
  ] as const) {
    const subs = await listAllEnabledStreamSubscriptions(ctx.db, platform, 500);
    if (!subs.length) continue;
    if (!client) {
      for (const sub of subs) {
        if (sub.lastError !== 'credentials missing') {
          await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: 'credentials missing' });
        }
      }
      continue;
    }
    let statuses: LiveStatus[];
    try {
      statuses = await client.getLiveStatus([...new Set(subs.map((s) => s.account))]);
    } catch (e) {
      ctx.log.warn(`${platform} poll failed`, { error: e });
      continue;
    }
    const byAccount = new Map(statuses.map((s) => [s.account, s]));
    for (const sub of subs) {
      if (!(await enabledFor(sub.guildId))) continue;
      const status = byAccount.get(sub.account.toLowerCase());
      if (!status) continue;
      const prev = sub.lastState as { id?: string | null } | null;
      if (shouldAlert(prev, status)) {
        try {
          await postAlert(ctx, sub, status);
        } catch (e) {
          await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: (e as Error).message });
          continue;
        }
      }
      await updateStreamSubscription(ctx.db, sub.guildId, sub.id, { lastCheckedAt: new Date(), lastError: null, lastState: { id: status.live ? status.id : (prev?.id ?? null), live: status.live } });
    }
  }
}

// ------------------------------------------------------------------ maintenance
export async function maintenance(ctx: PeriodicContext) {
  const recovered = await recoverExpiredJobs(ctx.db);
  if (recovered) ctx.log.warn('recovered jobs with expired leases', { recovered });
  await purgeFinishedJobs(ctx.db, 7);
  await purgeExpiredSessions(ctx.db);
  // Per-guild audit retention (Administrator settings -> Logging & retention).
  for (const g of await ctx.db.select({ id: schema.guilds.id }).from(schema.guilds)) {
    const { settings } = await getSettings(ctx.db, g.id);
    await purgeAuditOlderThan(ctx.db, g.id, settings.logging.retentionDays);
  }
}
