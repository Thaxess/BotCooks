import { and, asc, count, desc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { levelFromXp } from '@botcooks/shared';
import type { Database } from '../client';
import {
  customCommands,
  dailyStats,
  eventWorkflows,
  giveawayEntries,
  giveaways,
  levelMembers,
  scheduledMessages,
  selfRolePanels,
  streamSubscriptions,
  tempVoiceChannels,
  tickets,
} from '../schema';
import { nextCounter } from './core';

// ------------------------------------------------------------------ levels
/**
 * Awards XP if the member is outside the cooldown. The cooldown check and the update happen in a
 * single statement, so concurrent messages cannot double-award.
 */
export async function awardXp(
  db: Database,
  guildId: string,
  userId: string,
  amount: number,
  cooldownSeconds: number,
): Promise<{ awarded: boolean; xp: number; level: number; previousLevel: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - cooldownSeconds * 1000);
  const rows = await db
    .insert(levelMembers)
    .values({ guildId, userId, xp: amount, level: levelFromXp(amount).level, messages: 1, lastXpAt: now })
    .onConflictDoUpdate({
      target: [levelMembers.guildId, levelMembers.userId],
      set: { xp: sql`${levelMembers.xp} + ${amount}`, messages: sql`${levelMembers.messages} + 1`, lastXpAt: now },
      setWhere: sql`${levelMembers.lastXpAt} is null or ${levelMembers.lastXpAt} <= ${cutoff.toISOString()}`,
    })
    .returning();
  const row = rows[0];
  if (!row) {
    const [current] = await db
      .select()
      .from(levelMembers)
      .where(and(eq(levelMembers.guildId, guildId), eq(levelMembers.userId, userId)))
      .limit(1);
    return { awarded: false, xp: current?.xp ?? 0, level: current?.level ?? 0, previousLevel: current?.level ?? 0 };
  }
  const level = levelFromXp(row.xp).level;
  // `level` is not touched by the upsert, so it still holds the pre-award value (0 for a new member).
  const previousLevel = row.messages === 1 ? 0 : row.level;
  if (level !== row.level) {
    await db.update(levelMembers).set({ level }).where(and(eq(levelMembers.guildId, guildId), eq(levelMembers.userId, userId)));
  }
  return { awarded: true, xp: row.xp, level, previousLevel };
}

export async function getRank(db: Database, guildId: string, userId: string) {
  const [row] = await db
    .select()
    .from(levelMembers)
    .where(and(eq(levelMembers.guildId, guildId), eq(levelMembers.userId, userId)))
    .limit(1);
  if (!row) return null;
  const [above] = await db
    .select({ n: count() })
    .from(levelMembers)
    .where(and(eq(levelMembers.guildId, guildId), gt(levelMembers.xp, row.xp)));
  return { ...row, rank: Number(above?.n ?? 0) + 1 };
}

export async function leaderboard(db: Database, guildId: string, limit = 25, offset = 0) {
  return db
    .select()
    .from(levelMembers)
    .where(eq(levelMembers.guildId, guildId))
    .orderBy(desc(levelMembers.xp), asc(levelMembers.userId))
    .limit(Math.min(limit, 100))
    .offset(Math.max(offset, 0));
}

export async function setMemberXp(db: Database, guildId: string, userId: string, xp: number) {
  const level = levelFromXp(xp).level;
  await db
    .insert(levelMembers)
    .values({ guildId, userId, xp, level })
    .onConflictDoUpdate({ target: [levelMembers.guildId, levelMembers.userId], set: { xp, level } });
}

// ------------------------------------------------------------------ self-role panels
export async function registerSelfRolePanel(
  db: Database,
  p: { guildId: string; channelId: string; messageId: string; title: string; roleIds: string[] },
) {
  await db
    .insert(selfRolePanels)
    .values(p)
    .onConflictDoUpdate({ target: selfRolePanels.messageId, set: { roleIds: p.roleIds, title: p.title } });
}

export async function getSelfRolePanelByMessage(db: Database, guildId: string, messageId: string) {
  const [row] = await db
    .select()
    .from(selfRolePanels)
    .where(and(eq(selfRolePanels.guildId, guildId), eq(selfRolePanels.messageId, messageId)))
    .limit(1);
  return row;
}

export async function listSelfRolePanels(db: Database, guildId: string) {
  return db.select().from(selfRolePanels).where(eq(selfRolePanels.guildId, guildId)).orderBy(desc(selfRolePanels.createdAt));
}

export async function deleteSelfRolePanel(db: Database, guildId: string, id: string) {
  const rows = await db
    .delete(selfRolePanels)
    .where(and(eq(selfRolePanels.guildId, guildId), eq(selfRolePanels.id, id)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------ tickets
export async function openTicket(db: Database, t: { guildId: string; openerId: string; subject: string | null }) {
  const number = await nextCounter(db, t.guildId, 'ticket');
  const [row] = await db.insert(tickets).values({ ...t, number }).returning();
  return row!;
}

export async function setTicketThread(db: Database, guildId: string, id: string, threadId: string) {
  await db.update(tickets).set({ threadId }).where(and(eq(tickets.guildId, guildId), eq(tickets.id, id)));
}

export async function countOpenTickets(db: Database, guildId: string, openerId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.openerId, openerId), eq(tickets.status, 'open')));
  return Number(row?.n ?? 0);
}

export async function getTicketByThread(db: Database, guildId: string, threadId: string) {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.threadId, threadId)))
    .limit(1);
  return row;
}

export async function closeTicket(db: Database, guildId: string, id: string, closedBy: string) {
  const rows = await db
    .update(tickets)
    .set({ status: 'closed', closedBy, closedAt: new Date() })
    .where(and(eq(tickets.guildId, guildId), eq(tickets.id, id), eq(tickets.status, 'open')))
    .returning();
  return rows[0];
}

export async function claimTicket(db: Database, guildId: string, id: string, staffId: string) {
  await db.update(tickets).set({ claimedBy: staffId }).where(and(eq(tickets.guildId, guildId), eq(tickets.id, id)));
}

export async function listTickets(db: Database, guildId: string, status?: 'open' | 'closed', limit = 50) {
  const conds = [eq(tickets.guildId, guildId)];
  if (status) conds.push(eq(tickets.status, status));
  return db.select().from(tickets).where(and(...conds)).orderBy(desc(tickets.number)).limit(Math.min(limit, 100));
}

// ------------------------------------------------------------------ giveaways
export async function createGiveaway(db: Database, g: typeof giveaways.$inferInsert) {
  const [row] = await db.insert(giveaways).values(g).returning();
  return row!;
}

export async function setGiveawayMessage(db: Database, guildId: string, id: string, messageId: string) {
  await db.update(giveaways).set({ messageId }).where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id)));
}

export async function getGiveaway(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(giveaways)
    .where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id)))
    .limit(1);
  return row;
}

export async function enterGiveaway(db: Database, giveawayId: string, userId: string): Promise<'entered' | 'already'> {
  const rows = await db.insert(giveawayEntries).values({ giveawayId, userId }).onConflictDoNothing().returning();
  return rows.length ? 'entered' : 'already';
}

export async function leaveGiveaway(db: Database, giveawayId: string, userId: string) {
  await db.delete(giveawayEntries).where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.userId, userId)));
}

export async function countGiveawayEntries(db: Database, giveawayId: string) {
  const [row] = await db.select({ n: count() }).from(giveawayEntries).where(eq(giveawayEntries.giveawayId, giveawayId));
  return Number(row?.n ?? 0);
}

export async function listGiveawayEntrants(db: Database, giveawayId: string) {
  return (await db.select({ userId: giveawayEntries.userId }).from(giveawayEntries).where(eq(giveawayEntries.giveawayId, giveawayId))).map(
    (r) => r.userId,
  );
}

export async function dueGiveaways(db: Database, limit = 20) {
  return db
    .select()
    .from(giveaways)
    .where(and(eq(giveaways.ended, false), lte(giveaways.endsAt, new Date())))
    .orderBy(asc(giveaways.endsAt))
    .limit(limit);
}

/** Marks ended exactly once; returns false if another worker already ended it. */
export async function finishGiveaway(db: Database, guildId: string, id: string, winners: string[]) {
  const rows = await db
    .update(giveaways)
    .set({ ended: true, winners })
    .where(and(eq(giveaways.guildId, guildId), eq(giveaways.id, id), eq(giveaways.ended, false)))
    .returning({ id: giveaways.id });
  return rows.length === 1;
}

export async function listGiveaways(db: Database, guildId: string, limit = 50) {
  return db.select().from(giveaways).where(eq(giveaways.guildId, guildId)).orderBy(desc(giveaways.createdAt)).limit(Math.min(limit, 100));
}

// ------------------------------------------------------------------ scheduled messages
export async function createScheduledMessage(db: Database, m: typeof scheduledMessages.$inferInsert) {
  const [row] = await db.insert(scheduledMessages).values(m).returning();
  return row!;
}

export async function listScheduledMessages(db: Database, guildId: string) {
  return db.select().from(scheduledMessages).where(eq(scheduledMessages.guildId, guildId)).orderBy(asc(scheduledMessages.nextRunAt));
}

export async function updateScheduledMessage(db: Database, guildId: string, id: string, patch: Partial<typeof scheduledMessages.$inferInsert>) {
  const rows = await db
    .update(scheduledMessages)
    .set(patch)
    .where(and(eq(scheduledMessages.guildId, guildId), eq(scheduledMessages.id, id)))
    .returning();
  return rows[0];
}

export async function deleteScheduledMessage(db: Database, guildId: string, id: string) {
  const rows = await db
    .delete(scheduledMessages)
    .where(and(eq(scheduledMessages.guildId, guildId), eq(scheduledMessages.id, id)))
    .returning();
  return rows[0];
}

/**
 * Atomically claims due messages by advancing next_run_at (or disabling one-offs) BEFORE sending,
 * so two workers never send the same scheduled message twice.
 */
export async function claimDueScheduledMessages(db: Database, limit = 20) {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(scheduledMessages)
      .where(and(eq(scheduledMessages.enabled, true), lte(scheduledMessages.nextRunAt, new Date())))
      .orderBy(asc(scheduledMessages.nextRunAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    for (const m of due) {
      const next = m.intervalMinutes ? nextRun(m.nextRunAt, m.intervalMinutes) : m.nextRunAt;
      await tx
        .update(scheduledMessages)
        .set({ lastRunAt: new Date(), nextRunAt: next, enabled: Boolean(m.intervalMinutes) })
        .where(eq(scheduledMessages.id, m.id));
    }
    return due;
  });
}

function nextRun(from: Date, intervalMinutes: number): Date {
  const step = intervalMinutes * 60_000;
  let next = from.getTime() + step;
  const now = Date.now();
  // Skip missed runs (e.g. after downtime) instead of flooding the channel.
  if (next <= now) next += Math.ceil((now - next) / step) * step;
  if (next <= now) next += step;
  return new Date(next);
}

// ------------------------------------------------------------------ custom commands & event workflows
export async function listCustomCommands(db: Database, guildId: string) {
  return db.select().from(customCommands).where(eq(customCommands.guildId, guildId)).orderBy(asc(customCommands.name));
}

export async function getCustomCommand(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(customCommands)
    .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)))
    .limit(1);
  return row;
}

export async function getCustomCommandByName(db: Database, guildId: string, name: string) {
  const [row] = await db
    .select()
    .from(customCommands)
    .where(and(eq(customCommands.guildId, guildId), eq(customCommands.name, name)))
    .limit(1);
  return row;
}

export async function upsertCustomCommand(
  db: Database,
  c: { guildId: string; id?: string; name: string; description: string; graph: unknown; enabled: boolean; createdBy: string },
) {
  if (c.id) {
    const rows = await db
      .update(customCommands)
      .set({ name: c.name, description: c.description, graph: c.graph as object, enabled: c.enabled, updatedAt: new Date() })
      .where(and(eq(customCommands.guildId, c.guildId), eq(customCommands.id, c.id)))
      .returning();
    return rows[0];
  }
  const [row] = await db
    .insert(customCommands)
    .values({ guildId: c.guildId, name: c.name, description: c.description, graph: c.graph as object, enabled: c.enabled, createdBy: c.createdBy })
    .returning();
  return row;
}

export async function setCustomCommandDiscordId(db: Database, guildId: string, id: string, discordCommandId: string | null) {
  await db.update(customCommands).set({ discordCommandId }).where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)));
}

export async function deleteCustomCommand(db: Database, guildId: string, id: string) {
  const rows = await db
    .delete(customCommands)
    .where(and(eq(customCommands.guildId, guildId), eq(customCommands.id, id)))
    .returning();
  return rows[0];
}

export async function listEventWorkflows(db: Database, guildId: string, trigger?: string, enabledOnly = false) {
  const conds = [eq(eventWorkflows.guildId, guildId)];
  if (trigger) conds.push(eq(eventWorkflows.trigger, trigger));
  if (enabledOnly) conds.push(eq(eventWorkflows.enabled, true));
  return db.select().from(eventWorkflows).where(and(...conds)).orderBy(asc(eventWorkflows.name));
}

export async function getEventWorkflow(db: Database, guildId: string, id: string) {
  const [row] = await db
    .select()
    .from(eventWorkflows)
    .where(and(eq(eventWorkflows.guildId, guildId), eq(eventWorkflows.id, id)))
    .limit(1);
  return row;
}

export async function upsertEventWorkflow(
  db: Database,
  w: { guildId: string; id?: string; name: string; trigger: string; graph: unknown; enabled: boolean; createdBy: string },
) {
  if (w.id) {
    const rows = await db
      .update(eventWorkflows)
      .set({ name: w.name, trigger: w.trigger, graph: w.graph as object, enabled: w.enabled, updatedAt: new Date() })
      .where(and(eq(eventWorkflows.guildId, w.guildId), eq(eventWorkflows.id, w.id)))
      .returning();
    return rows[0];
  }
  const [row] = await db
    .insert(eventWorkflows)
    .values({ guildId: w.guildId, name: w.name, trigger: w.trigger, graph: w.graph as object, enabled: w.enabled, createdBy: w.createdBy })
    .returning();
  return row;
}

export async function deleteEventWorkflow(db: Database, guildId: string, id: string) {
  const rows = await db
    .delete(eventWorkflows)
    .where(and(eq(eventWorkflows.guildId, guildId), eq(eventWorkflows.id, id)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------ stream subscriptions
export async function listStreamSubscriptions(db: Database, guildId: string) {
  return db.select().from(streamSubscriptions).where(eq(streamSubscriptions.guildId, guildId)).orderBy(asc(streamSubscriptions.createdAt));
}

export async function listAllEnabledStreamSubscriptions(db: Database, platform: 'twitch' | 'youtube' | 'kick', limit = 500) {
  return db
    .select()
    .from(streamSubscriptions)
    .where(and(eq(streamSubscriptions.platform, platform), eq(streamSubscriptions.enabled, true)))
    .orderBy(sql`${streamSubscriptions.lastCheckedAt} asc nulls first`)
    .limit(limit);
}

export async function createStreamSubscription(db: Database, s: typeof streamSubscriptions.$inferInsert) {
  const [row] = await db.insert(streamSubscriptions).values(s).onConflictDoNothing().returning();
  return row;
}

export async function updateStreamSubscription(db: Database, guildId: string, id: string, patch: Partial<typeof streamSubscriptions.$inferInsert>) {
  const rows = await db
    .update(streamSubscriptions)
    .set(patch)
    .where(and(eq(streamSubscriptions.guildId, guildId), eq(streamSubscriptions.id, id)))
    .returning();
  return rows[0];
}

export async function deleteStreamSubscription(db: Database, guildId: string, id: string) {
  const rows = await db
    .delete(streamSubscriptions)
    .where(and(eq(streamSubscriptions.guildId, guildId), eq(streamSubscriptions.id, id)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------ temp voice
export async function addTempVoiceChannel(db: Database, t: { channelId: string; guildId: string; ownerId: string }) {
  await db.insert(tempVoiceChannels).values(t).onConflictDoNothing();
}

export async function getTempVoiceChannel(db: Database, guildId: string, channelId: string) {
  const [row] = await db
    .select()
    .from(tempVoiceChannels)
    .where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.channelId, channelId)))
    .limit(1);
  return row;
}

export async function removeTempVoiceChannel(db: Database, guildId: string, channelId: string) {
  await db.delete(tempVoiceChannels).where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.channelId, channelId)));
}

export async function listTempVoiceChannels(db: Database, guildId: string) {
  return db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.guildId, guildId));
}

// ------------------------------------------------------------------ analytics
export type StatField = 'joins' | 'leaves' | 'messages' | 'modActions' | 'automodActions';

export async function incrementDailyStat(db: Database, guildId: string, field: StatField, by = 1, day = new Date().toISOString().slice(0, 10)) {
  const column = dailyStats[field];
  await db
    .insert(dailyStats)
    .values({ guildId, day, [field]: by })
    .onConflictDoUpdate({ target: [dailyStats.guildId, dailyStats.day], set: { [field]: sql`${column} + ${by}` } });
}

export async function getDailyStats(db: Database, guildId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.guildId, guildId), gte(dailyStats.day, since)))
    .orderBy(asc(dailyStats.day));
}
