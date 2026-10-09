/**
 * Concrete, JSON-serialisable operations derived from a validated plan. The worker executes
 * these one at a time; each op id is deterministic so re-running a job never duplicates work.
 *
 * Reference strings:
 *   role:<key> / channel:<key>   - created (or matched) by this plan, resolved via the mapping table
 *   existing:<id>                - an existing Discord resource
 *   everyone                     - the @everyone role
 *   member:<id>                  - a member-specific overwrite (used only for the bot itself)
 */

export interface OverwriteSpec {
  target: string;
  allow: string;
  deny: string;
}

export interface RoleData {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
}

export interface ChannelData {
  name: string;
  type: number;
  parent: string | null;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  userLimit?: number;
  overwrites: OverwriteSpec[];
}

export interface EmbedPayload {
  title?: string;
  description: string;
  color?: number;
}

export interface SelfRolePanelPayload {
  title: string;
  description?: string;
  style: 'buttons' | 'select';
  roles: Array<{ role: string; label: string; emoji?: string; description?: string }>;
}

/** Feature configuration produced by a plan; refs are resolved to IDs by the executor. */
export interface PlanConfigPayload {
  moderation: {
    spamFilter: boolean;
    maxMentionsPerMessage: number;
    blockInvites: boolean;
    blockLinks: boolean;
    blockedTerms: string[];
    antiRaid: boolean;
    modLogChannel?: string;
    memberLogChannel?: string;
    serverLogChannel?: string;
  };
  levels: { enabled: boolean; announceChannel?: string; rewards: Array<{ level: number; role: string }> };
  tickets: { enabled: boolean; panelChannel?: string; staffRole?: string };
  tempVoice: { enabled: boolean; hubChannel?: string };
  welcome: { enabled: boolean; channel?: string; message?: string; autoroles: string[] };
  streamAlerts: Array<{ platform: 'twitch' | 'youtube' | 'kick'; channel: string; note?: string }>;
  suggestedCommands: Array<{ name: string; description: string; response: string }>;
}

export type Op =
  | { kind: 'role.create'; id: string; ref: string; data: RoleData }
  | { kind: 'role.update'; id: string; ref: string; roleId: string; before: RoleData; after: RoleData }
  | { kind: 'role.delete'; id: string; roleId: string; before: RoleData }
  /** Orders roles created/matched by the plan, highest first, directly beneath the bot's role. */
  | { kind: 'role.reorder'; id: string; refs: string[] }
  | { kind: 'channel.create'; id: string; ref: string; data: ChannelData }
  | {
      kind: 'channel.update';
      id: string;
      ref: string;
      channelId: string;
      before: ChannelData;
      after: ChannelData;
    }
  | { kind: 'channel.delete'; id: string; channelId: string; before: ChannelData }
  | { kind: 'message.send'; id: string; channel: string; purpose: 'rules' | 'welcome'; embed: EmbedPayload }
  | { kind: 'selfroles.panel'; id: string; channel: string; panel: SelfRolePanelPayload }
  | { kind: 'config.apply'; id: string; config: PlanConfigPayload }
  /** Rollback-only ops. */
  | { kind: 'message.delete'; id: string; channelId: string; messageId: string }
  | { kind: 'config.restore'; id: string; previous: unknown };

export type OpKind = Op['kind'];

export interface DiffLine {
  action: 'create' | 'update' | 'delete' | 'unchanged' | 'skip';
  kind: 'role' | 'category' | 'channel' | 'message' | 'panel' | 'config';
  label: string;
  details: string[];
  /** Op id this line corresponds to, if any. */
  opId?: string;
}

export interface RiskAssessment {
  destructive: boolean;
  elevation: boolean;
  reasons: string[];
}

export interface ChangeSet {
  ops: Op[];
  diff: DiffLine[];
  counts: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
    skipped: number;
  };
  requiredBotPermissions: string[];
  risk: RiskAssessment;
  warnings: string[];
}

export interface DiffOptions {
  /**
   * additive: create what is missing, never touch existing resources (default)
   * update:   also update matched existing roles/channels to match the plan
   * sync:     additionally delete channels/roles not in the plan (destructive)
   */
  mode: 'additive' | 'update' | 'sync';
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = { mode: 'additive' };
