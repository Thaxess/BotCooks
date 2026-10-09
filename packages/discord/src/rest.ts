import { REST, DiscordAPIError } from '@discordjs/rest';
import {
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type RESTPatchAPIGuildRolePositionsJSONBody,
  type RESTPostAPIGuildChannelJSONBody,
} from 'discord-api-types/v10';
import { discordApiBaseOverride, guildSnapshotSchema, type GuildSnapshot, type SnapshotChannel, type SnapshotRole } from '@botcooks/shared';
import type { DiscordWriter, MessageBody, ResolvedChannelData } from '@botcooks/workflows';
import type { RoleData } from '@botcooks/workflows';

/**
 * All server-side Discord access goes through @discordjs/rest, which implements Discord's
 * per-route buckets, global rate limit and 429 retry handling.
 */
export function createRest(token: string): REST {
  // `api` is only overridden in automated tests (local fake Discord); see discordApiBaseOverride.
  const api = discordApiBaseOverride();
  return new REST({ version: '10', timeout: 30_000, retries: 3, ...(api ? { api } : {}) }).setToken(token);
}

export { DiscordAPIError };

export function isDiscordNotFound(e: unknown): boolean {
  return e instanceof DiscordAPIError && e.status === 404;
}

/** The subset of guild channel fields BotCooks reads, across all guild channel types. */
interface RawGuildChannel {
  id: string;
  name?: string;
  type: number;
  parent_id?: string | null;
  position?: number;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  user_limit?: number;
  bitrate?: number;
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
}

function toSnapshotRole(r: APIRole): SnapshotRole {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    hoist: r.hoist,
    mentionable: r.mentionable,
    position: r.position,
    permissions: r.permissions,
    managed: r.managed,
  };
}

export function toSnapshotChannel(c: APIChannel): SnapshotChannel {
  const g = c as unknown as RawGuildChannel;
  return {
    id: g.id,
    name: g.name ?? '',
    type: g.type,
    parentId: g.parent_id ?? null,
    position: g.position ?? 0,
    topic: g.topic ?? null,
    nsfw: g.nsfw ?? false,
    rateLimitPerUser: g.rate_limit_per_user ?? 0,
    userLimit: g.user_limit ?? 0,
    ...(g.bitrate !== undefined ? { bitrate: g.bitrate } : {}),
    overwrites: (g.permission_overwrites ?? []).map((o) => ({
      id: o.id,
      type: o.type === 1 ? 1 : 0,
      allow: o.allow,
      deny: o.deny,
    })),
  };
}

export interface GuildBasics {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  features: string[];
}

export async function fetchGuild(rest: REST, guildId: string): Promise<APIGuild> {
  return (await rest.get(Routes.guild(guildId))) as APIGuild;
}

export async function fetchGuildRoles(rest: REST, guildId: string): Promise<APIRole[]> {
  return (await rest.get(Routes.guildRoles(guildId))) as APIRole[];
}

export async function fetchGuildChannels(rest: REST, guildId: string): Promise<APIChannel[]> {
  return (await rest.get(Routes.guildChannels(guildId))) as APIChannel[];
}

/** Returns null when the user is not a member (404). */
export async function fetchMember(rest: REST, guildId: string, userId: string): Promise<APIGuildMember | null> {
  try {
    return (await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember;
  } catch (e) {
    if (isDiscordNotFound(e)) return null;
    throw e;
  }
}

export function computeMemberPermissions(guild: { id: string; owner_id: string }, roles: APIRole[], member: { user?: { id: string }; roles: string[] }): bigint {
  const held = new Set([guild.id, ...member.roles]);
  let bits = 0n;
  for (const role of roles) if (held.has(role.id)) bits |= BigInt(role.permissions);
  return bits;
}

/** Fresh structural snapshot, fetched with the bot token. Never served from a client-provided copy. */
export async function fetchGuildSnapshot(rest: REST, guildId: string, botUserId: string): Promise<GuildSnapshot> {
  const [guild, channels, botMember] = await Promise.all([
    fetchGuild(rest, guildId),
    fetchGuildChannels(rest, guildId),
    fetchMember(rest, guildId, botUserId),
  ]);
  if (!botMember) throw new Error('BotCooks is not a member of this server.');
  const roles = guild.roles;
  const botRoles = roles.filter((r) => botMember.roles.includes(r.id));
  const highest = botRoles.reduce((m, r) => Math.max(m, r.position), 0);
  const permissions = computeMemberPermissions(guild, roles, botMember);
  const g = guild as APIGuild & { safety_alerts_channel_id?: string | null };
  const protectedIds = [g.rules_channel_id, g.public_updates_channel_id, g.system_channel_id, g.safety_alerts_channel_id].filter(
    (x): x is string => typeof x === 'string',
  );
  return guildSnapshotSchema.parse({
    guildId,
    name: guild.name,
    ownerId: guild.owner_id,
    features: guild.features,
    roles: roles.map(toSnapshotRole),
    channels: channels.map(toSnapshotChannel),
    protectedChannelIds: protectedIds,
    bot: { userId: botUserId, highestRolePosition: highest, permissions: permissions.toString() },
    capturedAt: new Date().toISOString(),
  });
}

/** DiscordWriter bound to one guild. Every mutating request carries an audit-log reason. */
export class RestDiscordWriter implements DiscordWriter {
  constructor(
    private readonly rest: REST,
    private readonly guildId: string,
    private readonly botUserId: string,
  ) {}

  async createRole(data: RoleData, reason: string) {
    const role = (await this.rest.post(Routes.guildRoles(this.guildId), {
      body: { name: data.name, color: data.color, hoist: data.hoist, mentionable: data.mentionable, permissions: data.permissions },
      reason,
    })) as APIRole;
    return { id: role.id };
  }

  async editRole(roleId: string, data: RoleData, reason: string) {
    await this.rest.patch(Routes.guildRole(this.guildId, roleId), {
      body: { name: data.name, color: data.color, hoist: data.hoist, mentionable: data.mentionable, permissions: data.permissions },
      reason,
    });
  }

  async deleteRole(roleId: string, reason: string) {
    await this.rest.delete(Routes.guildRole(this.guildId, roleId), { reason });
  }

  async setRolePositions(positions: Array<{ id: string; position: number }>, reason: string) {
    const body: RESTPatchAPIGuildRolePositionsJSONBody = positions;
    await this.rest.patch(Routes.guildRoles(this.guildId), { body, reason });
  }

  private channelBody(data: ResolvedChannelData): RESTPostAPIGuildChannelJSONBody {
    const isCategory = data.type === 4;
    const isVoice = data.type === 2 || data.type === 13;
    return {
      name: data.name,
      type: data.type as RESTPostAPIGuildChannelJSONBody['type'],
      ...(isCategory ? {} : { parent_id: data.parentId }),
      ...(!isCategory && !isVoice && data.topic ? { topic: data.topic } : {}),
      ...(!isCategory && data.nsfw ? { nsfw: true } : {}),
      ...(!isCategory && data.type !== 5 && data.rateLimitPerUser ? { rate_limit_per_user: data.rateLimitPerUser } : {}),
      ...(isVoice && data.userLimit ? { user_limit: data.userLimit } : {}),
      permission_overwrites: data.overwrites.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
    };
  }

  async createChannel(data: ResolvedChannelData, reason: string) {
    const channel = (await this.rest.post(Routes.guildChannels(this.guildId), { body: this.channelBody(data), reason })) as APIChannel;
    return { id: channel.id };
  }

  async editChannel(channelId: string, data: ResolvedChannelData, reason: string) {
    const { type: _type, ...body } = this.channelBody(data);
    await this.rest.patch(Routes.channel(channelId), { body, reason });
  }

  async deleteChannel(channelId: string, reason: string) {
    await this.rest.delete(Routes.channel(channelId), { reason });
  }

  async sendMessage(channelId: string, body: MessageBody) {
    const msg = (await this.rest.post(Routes.channelMessages(channelId), {
      body: {
        ...(body.embeds ? { embeds: body.embeds } : {}),
        ...(body.components ? { components: body.components } : {}),
        // enforce_nonce makes Discord return the earlier message instead of posting a duplicate.
        ...(body.nonce ? { nonce: body.nonce, enforce_nonce: true } : {}),
        allowed_mentions: { parse: [] },
      },
    })) as APIMessage;
    return { id: msg.id };
  }

  async deleteMessage(channelId: string, messageId: string, reason: string) {
    await this.rest.delete(Routes.channelMessage(channelId, messageId), { reason });
  }

  async listRoles() {
    return (await fetchGuildRoles(this.rest, this.guildId)).map(toSnapshotRole);
  }

  async listChannels() {
    return (await fetchGuildChannels(this.rest, this.guildId)).map(toSnapshotChannel);
  }

  async botHighestRolePosition() {
    const [roles, member] = await Promise.all([fetchGuildRoles(this.rest, this.guildId), fetchMember(this.rest, this.guildId, this.botUserId)]);
    if (!member) throw new Error('BotCooks is no longer in this server.');
    return roles.filter((r) => member.roles.includes(r.id)).reduce((m, r) => Math.max(m, r.position), 0);
  }
}

/** Edits the original response of an interaction (valid for 15 minutes after the interaction). */
export async function editInteractionReply(rest: REST, applicationId: string, interactionToken: string, body: unknown) {
  await rest.patch(Routes.webhookMessage(applicationId, interactionToken, '@original'), { body, auth: false });
}

export async function sendChannelMessage(rest: REST, channelId: string, body: Record<string, unknown>) {
  return (await rest.post(Routes.channelMessages(channelId), { body: { allowed_mentions: { parse: [] }, ...body } })) as APIMessage;
}
