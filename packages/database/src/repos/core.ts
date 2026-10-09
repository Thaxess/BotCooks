import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import {
  ConflictError,
  SETTINGS_SECTIONS,
  parseGuildSettings,
  type FeatureKey,
  type GuildSettings,
  type SettingsSection,
} from '@botcooks/shared';
import type { Database } from '../client';
import { auditLogs, counters, delegations, guildSettings, guilds, sessions, users } from '../schema';

// ------------------------------------------------------------------ users & sessions
export async function upsertUser(db: Database, u: { id: string; username: string; globalName: string | null; avatar: string | null }) {
  await db
    .insert(users)
    .values(u)
    .onConflictDoUpdate({ target: users.id, set: { username: u.username, globalName: u.globalName, avatar: u.avatar, updatedAt: new Date() } });
}

export async function createSession(
  db: Database,
  s: { id: string; userId: string; accessTokenEnc: string; refreshTokenEnc: string | null; tokenExpiresAt: Date; expiresAt: Date },
) {
  await db.insert(sessions).values(s);
}

export async function getSession(db: Database, id: string) {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), sql`${sessions.expiresAt} > now()`))
    .limit(1);
  return row;
}

export async function getSessionRow(db: Database, id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

export async function touchSession(db: Database, id: string) {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
}

export async function updateSessionTokens(db: Database, id: string, t: { accessTokenEnc: string; refreshTokenEnc: string | null; tokenExpiresAt: Date }) {
  await db.update(sessions).set(t).where(eq(sessions.id, id));
}

export async function deleteSession(db: Database, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function purgeExpiredSessions(db: Database) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// ------------------------------------------------------------------ guilds
export async function upsertGuild(db: Database, g: { id: string; name: string; icon: string | null; ownerId: string }) {
  await db
    .insert(guilds)
    .values({ ...g, botPresent: true })
    .onConflictDoUpdate({
      target: guilds.id,
      set: { name: g.name, icon: g.icon, ownerId: g.ownerId, botPresent: true, leftAt: null, updatedAt: new Date() },
    });
}

export async function markGuildLeft(db: Database, guildId: string) {
  await db.update(guilds).set({ botPresent: false, leftAt: new Date(), updatedAt: new Date() }).where(eq(guilds.id, guildId));
}

export async function getGuild(db: Database, guildId: string) {
  const [row] = await db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
  return row;
}

export async function getGuildsByIds(db: Database, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(guilds).where(inArray(guilds.id, ids));
}

// ------------------------------------------------------------------ settings
export async function getSettings(db: Database, guildId: string): Promise<{ settings: GuildSettings; version: number }> {
  const [row] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  return { settings: parseGuildSettings(row?.settings), version: row?.version ?? 0 };
}

/**
 * Replace the settings document with optimistic concurrency. `expectedVersion` is the version the
 * caller read; if someone saved in between, a ConflictError tells the UI to reload.
 */
export async function saveSettings(
  db: Database,
  guildId: string,
  settings: GuildSettings,
  expectedVersion: number,
  actorId: string | null,
): Promise<number> {
  if (expectedVersion === 0) {
    const inserted = await db
      .insert(guildSettings)
      .values({ guildId, settings, version: 1, updatedBy: actorId })
      .onConflictDoNothing()
      .returning({ version: guildSettings.version });
    if (inserted.length === 1) return 1;
    throw new ConflictError('Settings were changed by someone else. Reload and try again.', 'stale_settings');
  }
  const updated = await db
    .update(guildSettings)
    .set({ settings, version: expectedVersion + 1, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(guildSettings.guildId, guildId), eq(guildSettings.version, expectedVersion)))
    .returning({ version: guildSettings.version });
  if (updated.length !== 1) throw new ConflictError('Settings were changed by someone else. Reload and try again.', 'stale_settings');
  return updated[0]!.version;
}

/** Read-modify-write with automatic retry on concurrent modification (for bot/worker internal updates). */
export async function mutateSettings(
  db: Database,
  guildId: string,
  actorId: string | null,
  mutate: (s: GuildSettings) => GuildSettings | void,
  attempts = 5,
): Promise<{ before: GuildSettings; after: GuildSettings }> {
  for (let i = 0; i < attempts; i++) {
    const { settings, version } = await getSettings(db, guildId);
    const before = structuredClone(settings);
    const next = mutate(settings) ?? settings;
    const after = parseGuildSettings(next);
    try {
      await saveSettings(db, guildId, after, version, actorId);
      return { before, after };
    } catch (e) {
      if (!(e instanceof ConflictError) || i === attempts - 1) throw e;
    }
  }
  throw new ConflictError('Could not save settings.');
}

export async function updateSettingsSection<S extends SettingsSection>(
  db: Database,
  guildId: string,
  section: S,
  value: unknown,
  expectedVersion: number,
  actorId: string,
): Promise<{ settings: GuildSettings; version: number; before: GuildSettings[S] }> {
  const parsed = SETTINGS_SECTIONS[section].parse(value) as GuildSettings[S];
  const { settings, version } = await getSettings(db, guildId);
  if (version !== expectedVersion) throw new ConflictError('Settings were changed by someone else. Reload and try again.', 'stale_settings');
  const before = settings[section];
  const next = { ...settings, [section]: parsed };
  const newVersion = await saveSettings(db, guildId, next, expectedVersion, actorId);
  return { settings: next, version: newVersion, before };
}

export async function setFeatureEnabled(db: Database, guildId: string, feature: FeatureKey, enabled: boolean, actorId: string) {
  return mutateSettings(db, guildId, actorId, (s) => {
    s.features[feature] = enabled;
  });
}

// ------------------------------------------------------------------ delegations
export async function listDelegations(db: Database, guildId: string) {
  return db.select().from(delegations).where(eq(delegations.guildId, guildId));
}

export async function replaceDelegations(db: Database, guildId: string, list: Array<{ roleId: string; scopes: string[] }>, actorId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(delegations).where(eq(delegations.guildId, guildId));
    if (list.length) {
      await tx.insert(delegations).values(list.map((d) => ({ guildId, roleId: d.roleId, scopes: d.scopes, createdBy: actorId })));
    }
  });
}

// ------------------------------------------------------------------ counters
/** Atomically increments and returns a per-guild counter (case numbers, ticket numbers). */
export async function nextCounter(db: Database, guildId: string, name: string): Promise<number> {
  const [row] = await db
    .insert(counters)
    .values({ guildId, name, value: 1 })
    .onConflictDoUpdate({ target: [counters.guildId, counters.name], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row!.value;
}

// ------------------------------------------------------------------ audit log
export interface AuditEntry {
  guildId: string;
  actorId: string | null;
  actorType: 'user' | 'bot' | 'system';
  action: string;
  target?: string | null;
  details?: Record<string, unknown> | null;
}

export async function recordAudit(db: Database, entry: AuditEntry) {
  await db.insert(auditLogs).values({
    guildId: entry.guildId,
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    target: entry.target ?? null,
    details: entry.details ?? null,
  });
}

export async function listAudit(
  db: Database,
  guildId: string,
  opts: { limit?: number; before?: number; action?: string; search?: string } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const conds = [eq(auditLogs.guildId, guildId)];
  if (opts.before) conds.push(lt(auditLogs.id, opts.before));
  if (opts.action) conds.push(ilike(auditLogs.action, `${escapeLike(opts.action)}%`));
  if (opts.search) {
    const q = `%${escapeLike(opts.search)}%`;
    conds.push(or(ilike(auditLogs.action, q), ilike(auditLogs.target, q), ilike(auditLogs.actorId, q))!);
  }
  const rows = await db.select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.id)).limit(limit + 1);
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function purgeAuditOlderThan(db: Database, guildId: string, days: number) {
  await db.delete(auditLogs).where(and(eq(auditLogs.guildId, guildId), lt(auditLogs.createdAt, new Date(Date.now() - days * 86_400_000))));
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
