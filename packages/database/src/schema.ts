import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tenant isolation: every guild-owned table has a NOT NULL guild_id, and every repository
 * function that reads or writes guild data takes the guild id as a required argument.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();

// ------------------------------------------------------------------ identity & sessions
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  globalName: text('global_name'),
  avatar: text('avatar'),
  createdAt: created(),
  updatedAt: updated(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the opaque cookie token; the raw token never touches the database. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Discord OAuth tokens, AES-GCM encrypted. Used only to list the user's guilds. */
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    tokenExpiresAt: ts('token_expires_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: created(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ------------------------------------------------------------------ guilds & settings
export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  ownerId: text('owner_id').notNull(),
  botPresent: boolean('bot_present').notNull().default(true),
  joinedAt: created(),
  leftAt: ts('left_at'),
  updatedAt: updated(),
});

export const guildSettings = pgTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  settings: jsonb('settings').notNull().default({}),
  /** Optimistic concurrency: writers must send the version they read. */
  version: integer('version').notNull().default(1),
  updatedAt: updated(),
  updatedBy: text('updated_by'),
});

export const delegations = pgTable(
  'dashboard_delegations',
  {
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.roleId] })],
);

export const counters = pgTable(
  'guild_counters',
  {
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.name] })],
);

// ------------------------------------------------------------------ AI builder
export const buildSessions = pgTable(
  'build_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    createdBy: text('created_by').notNull(),
    source: text('source', { enum: ['dashboard', 'discord'] }).notNull(),
    prompt: text('prompt').notNull(),
    templateId: text('template_id'),
    status: text('status', { enum: ['generating', 'ready', 'failed', 'applied'] }).notNull().default('generating'),
    error: text('error'),
    /** For /build-server: encrypted interaction token so the worker can edit the reply (valid 15 min). */
    interactionEnc: text('interaction_enc'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('build_sessions_guild_idx').on(t.guildId, t.createdAt)],
);

export const planVersions = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => buildSessions.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    version: integer('version').notNull(),
    /** Validated plan (post-security normalisation). */
    plan: jsonb('plan').notNull(),
    /** Raw provider output before validation, kept for auditing. */
    rawPlan: jsonb('raw_plan'),
    validation: jsonb('validation').notNull(),
    planHash: text('plan_hash').notNull(),
    instruction: text('instruction'),
    aiProvider: text('ai_provider'),
    aiModel: text('ai_model'),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('plan_versions_session_version_uq').on(t.sessionId, t.version), index('plan_versions_guild_idx').on(t.guildId)],
);

export const snapshots = pgTable(
  'guild_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    reason: text('reason', { enum: ['pre-execution', 'manual', 'scheduled'] }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    hash: text('hash').notNull(),
    /** BotCooks settings at the same moment, so configuration can be restored too. */
    settings: jsonb('settings'),
    label: text('label'),
    createdBy: text('created_by'),
    createdAt: created(),
  },
  (t) => [index('guild_snapshots_guild_idx').on(t.guildId, t.createdAt)],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    kind: text('kind', { enum: ['apply', 'rollback'] }).notNull(),
    planVersionId: uuid('plan_version_id').references(() => planVersions.id),
    parentExecutionId: uuid('parent_execution_id'),
    mode: text('mode').notNull().default('additive'),
    status: text('status', {
      enum: ['queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled'],
    })
      .notNull()
      .default('queued'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    ops: jsonb('ops').notNull(),
    /** Pre-change snapshot for backup/rollback; also the expected server state. */
    snapshotId: uuid('snapshot_id').references(() => snapshots.id),
    expectedSnapshotHash: text('expected_snapshot_hash'),
    initialMappings: jsonb('initial_mappings').notNull().default({}),
    risk: jsonb('risk'),
    irreversible: jsonb('irreversible'),
    confirmedBy: text('confirmed_by').notNull(),
    /** Confirmation nonce, unique so a token cannot be replayed into a second execution. */
    confirmationNonce: text('confirmation_nonce').notNull(),
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    progressLabel: text('progress_label'),
    report: jsonb('report'),
    createdAt: created(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [uniqueIndex('executions_nonce_uq').on(t.confirmationNonce), index('executions_guild_idx').on(t.guildId, t.createdAt)],
);

export const executionOps = pgTable(
  'execution_ops',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    opId: text('op_id').notNull(),
    status: text('status').notNull(),
    result: jsonb('result'),
    error: text('error'),
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.executionId, t.opId] })],
);

export const resourceMappings = pgTable(
  'resource_mappings',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    ref: text('ref').notNull(),
    discordId: text('discord_id').notNull(),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.ref] }),
    uniqueIndex('resource_mappings_discord_uq').on(t.executionId, t.discordId),
  ],
);

// ------------------------------------------------------------------ jobs & locks
export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    guildId: text('guild_id'),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'dead'] }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedBy: text('locked_by'),
    lockedUntil: ts('locked_until'),
    lastError: text('last_error'),
    /** Prevents enqueueing the same logical job twice while one is pending. */
    dedupeKey: text('dedupe_key'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('jobs_ready_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued','running')`),
  ],
);

export const guildLocks = pgTable('guild_locks', {
  guildId: text('guild_id').primaryKey(),
  holder: text('holder').notNull(),
  purpose: text('purpose').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

// ------------------------------------------------------------------ audit & moderation
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: text('guild_id').notNull(),
    actorId: text('actor_id'),
    actorType: text('actor_type', { enum: ['user', 'bot', 'system'] }).notNull(),
    action: text('action').notNull(),
    target: text('target'),
    details: jsonb('details'),
    createdAt: created(),
  },
  (t) => [index('audit_logs_guild_idx').on(t.guildId, t.createdAt)],
);

export const modCases = pgTable(
  'mod_cases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: text('guild_id').notNull(),
    caseNumber: integer('case_number').notNull(),
    type: text('type', { enum: ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'note', 'purge', 'automod'] }).notNull(),
    userId: text('user_id').notNull(),
    moderatorId: text('moderator_id').notNull(),
    reason: text('reason'),
    durationSeconds: integer('duration_seconds'),
    metadata: jsonb('metadata'),
    /** Warnings can be pardoned (e.g. after a successful appeal) without deleting history. */
    active: boolean('active').notNull().default(true),
    appealStatus: text('appeal_status', { enum: ['none', 'open', 'accepted', 'rejected'] }).notNull().default('none'),
    appealText: text('appeal_text'),
    appealedAt: ts('appealed_at'),
    appealResolvedBy: text('appeal_resolved_by'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('mod_cases_number_uq').on(t.guildId, t.caseNumber), index('mod_cases_user_idx').on(t.guildId, t.userId)],
);

// ------------------------------------------------------------------ community features
export const levelMembers = pgTable(
  'level_members',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    xp: bigint('xp', { mode: 'number' }).notNull().default(0),
    level: integer('level').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    lastXpAt: ts('last_xp_at'),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] }), index('level_members_rank_idx').on(t.guildId, t.xp)],
);

export const selfRolePanels = pgTable(
  'self_role_panels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    title: text('title').notNull(),
    roleIds: jsonb('role_ids').$type<string[]>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('self_role_panels_message_uq').on(t.messageId), index('self_role_panels_guild_idx').on(t.guildId)],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    number: integer('number').notNull(),
    threadId: text('thread_id'),
    openerId: text('opener_id').notNull(),
    subject: text('subject'),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    claimedBy: text('claimed_by'),
    closedBy: text('closed_by'),
    createdAt: created(),
    closedAt: ts('closed_at'),
  },
  (t) => [uniqueIndex('tickets_number_uq').on(t.guildId, t.number), index('tickets_opener_idx').on(t.guildId, t.openerId, t.status)],
);

export const giveaways = pgTable(
  'giveaways',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    prize: text('prize').notNull(),
    winnerCount: integer('winner_count').notNull().default(1),
    hostId: text('host_id').notNull(),
    requiredRoleId: text('required_role_id'),
    endsAt: ts('ends_at').notNull(),
    ended: boolean('ended').notNull().default(false),
    winners: jsonb('winners').$type<string[]>(),
    createdAt: created(),
  },
  (t) => [index('giveaways_due_idx').on(t.ended, t.endsAt), index('giveaways_guild_idx').on(t.guildId)],
);

export const giveawayEntries = pgTable(
  'giveaway_entries',
  {
    giveawayId: uuid('giveaway_id')
      .notNull()
      .references(() => giveaways.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.giveawayId, t.userId] })],
);

export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    content: text('content'),
    embed: jsonb('embed'),
    /** Repeat interval in minutes; null = one-off. */
    intervalMinutes: integer('interval_minutes'),
    nextRunAt: ts('next_run_at').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: ts('last_run_at'),
    lastError: text('last_error'),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (t) => [index('scheduled_due_idx').on(t.enabled, t.nextRunAt), index('scheduled_guild_idx').on(t.guildId)],
);

export const customCommands = pgTable(
  'custom_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    /** Visual-builder graph (validated by @botcooks/workflows before saving). */
    graph: jsonb('graph').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    discordCommandId: text('discord_command_id'),
    createdBy: text('created_by').notNull(),
    updatedAt: updated(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('custom_commands_name_uq').on(t.guildId, t.name)],
);

export const eventWorkflows = pgTable(
  'event_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    trigger: text('trigger').notNull(),
    graph: jsonb('graph').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdBy: text('created_by').notNull(),
    updatedAt: updated(),
    createdAt: created(),
  },
  (t) => [index('event_workflows_trigger_idx').on(t.guildId, t.trigger, t.enabled)],
);

export const streamSubscriptions = pgTable(
  'stream_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    platform: text('platform', { enum: ['twitch', 'youtube', 'kick'] }).notNull(),
    /** Twitch login, YouTube channel ID (UC...), or Kick slug. */
    account: text('account').notNull(),
    channelId: text('channel_id').notNull(),
    message: text('message').notNull().default('{account} is live! {url}'),
    pingRoleId: text('ping_role_id'),
    enabled: boolean('enabled').notNull().default(true),
    /** Last observed state (live stream id / last video id) to avoid duplicate alerts. */
    lastState: jsonb('last_state'),
    lastCheckedAt: ts('last_checked_at'),
    lastError: text('last_error'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('stream_subs_uq').on(t.guildId, t.platform, t.account, t.channelId)],
);

export const tempVoiceChannels = pgTable('temp_voice_channels', {
  channelId: text('channel_id').primaryKey(),
  guildId: text('guild_id').notNull(),
  ownerId: text('owner_id').notNull(),
  createdAt: created(),
});

export const dailyStats = pgTable(
  'daily_stats',
  {
    guildId: text('guild_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    joins: integer('joins').notNull().default(0),
    leaves: integer('leaves').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    modActions: integer('mod_actions').notNull().default(0),
    automodActions: integer('automod_actions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.day] })],
);
