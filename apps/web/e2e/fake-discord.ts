/**
 * A tiny in-memory imitation of the parts of Discord's HTTP API that BotCooks uses.
 * It exists only so end-to-end tests can drive the real web app + worker without a live
 * Discord account. It is deliberately simple and is NOT a faithful Discord implementation.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';

let seq = 900000000000000000n;
const id = () => (seq++).toString();

export const IDS = {
  guild: '111100000000000001',
  bot: '222200000000000002',
  app: '222200000000000002',
  owner: '333300000000000003',
  admin: '333300000000000004',
  member: '333300000000000005',
  helper: '333300000000000006',
};

interface Role { id: string; name: string; color: number; hoist: boolean; mentionable: boolean; position: number; permissions: string; managed: boolean }
interface Channel { id: string; guild_id: string; name: string; type: number; parent_id: string | null; position: number; topic?: string | null; nsfw?: boolean; rate_limit_per_user?: number; user_limit?: number; permission_overwrites: Array<{ id: string; type: number; allow: string; deny: string }> }

function initialState() {
  const botPerms = P.ManageRoles | P.ManageChannels | P.KickMembers | P.BanMembers | P.ModerateMembers | P.ViewAuditLog | P.ViewChannel | P.SendMessages | P.SendMessagesInThreads | P.ManageMessages | P.EmbedLinks | P.ReadMessageHistory | P.CreatePublicThreads | P.CreatePrivateThreads | P.ManageThreads | P.Connect | P.Speak | P.MoveMembers | P.SendPolls | P.MuteMembers;
  const roles: Role[] = [
    { id: IDS.guild, name: '@everyone', color: 0, hoist: false, mentionable: false, position: 0, permissions: (P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.Connect | P.Speak).toString(), managed: false },
    { id: '444400000000000001', name: 'BotCooks', color: 0, hoist: false, mentionable: false, position: 10, permissions: botPerms.toString(), managed: true },
    { id: '444400000000000002', name: 'Admins', color: 0xe74c3c, hoist: true, mentionable: false, position: 5, permissions: (P.ManageGuild | P.ManageRoles | P.ManageChannels).toString(), managed: false },
    { id: '444400000000000003', name: 'Helpers', color: 0x3498db, hoist: false, mentionable: false, position: 2, permissions: '0', managed: false },
  ];
  const channels: Channel[] = [
    { id: '555500000000000001', guild_id: IDS.guild, name: 'Text Channels', type: 4, parent_id: null, position: 0, permission_overwrites: [] },
    { id: '555500000000000002', guild_id: IDS.guild, name: 'general', type: 0, parent_id: '555500000000000001', position: 0, topic: null, permission_overwrites: [] },
  ];
  const members: Record<string, string[]> = {
    [IDS.bot]: ['444400000000000001'],
    [IDS.owner]: [],
    [IDS.admin]: ['444400000000000002'],
    [IDS.member]: [],
    [IDS.helper]: ['444400000000000003'],
  };
  return {
    roles,
    channels,
    members,
    messages: [] as Array<{ id: string; channel_id: string; body: Record<string, unknown> }>,
    commands: [] as Array<{ id: string; application_id: string; guild_id: string; name: string; description: string; options?: unknown[] }>,
    codes: new Map<string, string>(),
    tokens: new Map<string, string>(),
    loginAs: IDS.owner,
    requests: [] as string[],
  };
}

let state = initialState();

const users: Record<string, { id: string; username: string; global_name: string; avatar: null; bot?: boolean }> = {
  [IDS.bot]: { id: IDS.bot, username: 'BotCooks', global_name: 'BotCooks', avatar: null, bot: true },
  [IDS.owner]: { id: IDS.owner, username: 'owner', global_name: 'Owner', avatar: null },
  [IDS.admin]: { id: IDS.admin, username: 'admin', global_name: 'Admin', avatar: null },
  [IDS.member]: { id: IDS.member, username: 'member', global_name: 'Member', avatar: null },
  [IDS.helper]: { id: IDS.helper, username: 'helper', global_name: 'Helper', avatar: null },
};

function guildObject() {
  return { id: IDS.guild, name: 'Fake Kitchen', icon: null, owner_id: IDS.owner, features: [], roles: state.roles, rules_channel_id: null, public_updates_channel_id: null, system_channel_id: null };
}

function memberPerms(userId: string): bigint {
  if (userId === IDS.owner) return BigInt(Number.MAX_SAFE_INTEGER);
  const held = new Set([IDS.guild, ...(state.members[userId] ?? [])]);
  return state.roles.filter((r) => held.has(r.id)).reduce((b, r) => b | BigInt(r.permissions), 0n);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const notFound = (res: ServerResponse, code = 10003) => send(res, 404, { message: 'Unknown', code });

export function startFakeDiscord(port: number) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const path = decodeURIComponent(url.pathname).replace(/^\/api\/v10/, '');
      const method = req.method ?? 'GET';
      const raw = method === 'GET' ? '' : await readBody(req);
      const body = raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : {};
      state.requests.push(`${method} ${path}`);
      const auth = req.headers.authorization ?? '';
      const isBot = auth.startsWith('Bot ');
      const bearerUser = auth.startsWith('Bearer ') ? state.tokens.get(auth.slice(7)) : undefined;

      // ---- test control
      if (path === '/_test/state') return send(res, 200, { roles: state.roles, channels: state.channels, messages: state.messages, commands: state.commands, requests: state.requests.slice(-200) });
      if (path === '/_test/login-as' && method === 'POST') {
        state.loginAs = body.userId;
        return send(res, 200, { ok: true });
      }
      if (path === '/_test/reset' && method === 'POST') {
        state = initialState();
        return send(res, 200, { ok: true });
      }
      if (path === '/_test/add-channel' && method === 'POST') {
        const ch: Channel = { id: id(), guild_id: IDS.guild, name: body.name, type: 0, parent_id: null, position: 99, permission_overwrites: [] };
        state.channels.push(ch);
        return send(res, 200, ch);
      }

      // ---- OAuth
      if (path === '/oauth2/authorize') {
        const code = randomBytes(8).toString('hex');
        state.codes.set(code, state.loginAs);
        const redirect = new URL(url.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { Location: redirect.toString() });
        return res.end();
      }
      if (path === '/oauth2/token' && method === 'POST') {
        const form = new URLSearchParams(raw);
        const userId = form.get('grant_type') === 'authorization_code' ? state.codes.get(form.get('code') ?? '') : state.loginAs;
        if (!userId) return send(res, 400, { error: 'invalid_grant' });
        const token = randomBytes(12).toString('hex');
        state.tokens.set(token, userId);
        return send(res, 200, { access_token: token, refresh_token: randomBytes(12).toString('hex'), expires_in: 604800, scope: 'identify guilds', token_type: 'Bearer' });
      }

      // ---- users
      if (path === '/users/@me') {
        if (isBot) return send(res, 200, users[IDS.bot]);
        if (bearerUser) return send(res, 200, users[bearerUser]);
        return send(res, 401, { message: '401: Unauthorized', code: 0 });
      }
      if (path === '/users/@me/guilds' && bearerUser) {
        return send(res, 200, [{ id: IDS.guild, name: 'Fake Kitchen', icon: null, owner: bearerUser === IDS.owner, permissions: memberPerms(bearerUser).toString() }]);
      }
      if (!isBot) return send(res, 401, { message: '401: Unauthorized', code: 0 });

      // ---- guild
      let m: RegExpMatchArray | null;
      if (path === `/guilds/${IDS.guild}`) return send(res, 200, guildObject());
      if ((m = path.match(/^\/guilds\/(\d+)$/))) return notFound(res, 10004);
      if (path === `/guilds/${IDS.guild}/channels`) {
        if (method === 'GET') return send(res, 200, state.channels);
        if (method === 'POST') {
          if (state.channels.length >= 500) return send(res, 400, { message: 'Maximum number of guild channels reached (500)', code: 30013 });
          const ch: Channel = {
            id: id(),
            guild_id: IDS.guild,
            name: body.type === 0 || body.type === 5 ? String(body.name).toLowerCase().replace(/\s+/g, '-') : body.name,
            type: body.type ?? 0,
            parent_id: body.parent_id ?? null,
            position: state.channels.length,
            topic: body.topic ?? null,
            nsfw: body.nsfw ?? false,
            rate_limit_per_user: body.rate_limit_per_user ?? 0,
            user_limit: body.user_limit ?? 0,
            permission_overwrites: body.permission_overwrites ?? [],
          };
          state.channels.push(ch);
          return send(res, 201, ch);
        }
      }
      if ((m = path.match(/^\/channels\/(\d+)$/))) {
        const ch = state.channels.find((c) => c.id === m![1]);
        if (!ch) return notFound(res);
        if (method === 'PATCH') {
          Object.assign(ch, body);
          return send(res, 200, ch);
        }
        if (method === 'DELETE') {
          state.channels = state.channels.filter((c) => c.id !== ch.id);
          return send(res, 200, ch);
        }
      }
      if (path === `/guilds/${IDS.guild}/roles`) {
        if (method === 'GET') return send(res, 200, state.roles);
        if (method === 'POST') {
          const role: Role = { id: id(), name: body.name, color: body.color ?? 0, hoist: body.hoist ?? false, mentionable: body.mentionable ?? false, position: 1, permissions: body.permissions ?? '0', managed: false };
          state.roles.push(role);
          return send(res, 200, role);
        }
        if (method === 'PATCH') {
          for (const p of body as Array<{ id: string; position: number }>) {
            const r = state.roles.find((x) => x.id === p.id);
            if (r) r.position = p.position;
          }
          return send(res, 200, state.roles);
        }
      }
      if ((m = path.match(/^\/guilds\/\d+\/roles\/(\d+)$/))) {
        const role = state.roles.find((r) => r.id === m![1]);
        if (!role) return notFound(res, 10011);
        if (method === 'PATCH') {
          Object.assign(role, body);
          return send(res, 200, role);
        }
        if (method === 'DELETE') {
          state.roles = state.roles.filter((r) => r.id !== role.id);
          return send(res, 204);
        }
      }
      if ((m = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) {
        const roles = state.members[m[1]!];
        if (!roles) return notFound(res, 10007);
        return send(res, 200, { user: users[m[1]!], roles, joined_at: new Date().toISOString() });
      }
      if ((m = path.match(/^\/channels\/(\d+)\/messages$/)) && method === 'POST') {
        const dup = body.nonce && body.enforce_nonce ? state.messages.find((x) => x.body.nonce === body.nonce) : undefined;
        if (dup) return send(res, 200, { id: dup.id, channel_id: dup.channel_id });
        const msg = { id: id(), channel_id: m[1]!, body };
        state.messages.push(msg);
        return send(res, 200, { id: msg.id, channel_id: msg.channel_id });
      }
      if ((m = path.match(/^\/channels\/\d+\/messages\/(\d+)$/)) && method === 'DELETE') {
        state.messages = state.messages.filter((x) => x.id !== m![1]);
        return send(res, 204);
      }
      if ((m = path.match(/^\/applications\/\d+\/guilds\/\d+\/commands$/))) {
        if (method === 'GET') return send(res, 200, state.commands);
        const cmd = { id: id(), application_id: IDS.app, guild_id: IDS.guild, name: body.name, description: body.description, options: body.options };
        state.commands.push(cmd);
        return send(res, 201, cmd);
      }
      if ((m = path.match(/^\/applications\/\d+\/guilds\/\d+\/commands\/(\d+)$/))) {
        const cmd = state.commands.find((c) => c.id === m![1]);
        if (!cmd) return notFound(res, 10063);
        if (method === 'PATCH') {
          Object.assign(cmd, body);
          return send(res, 200, cmd);
        }
        state.commands = state.commands.filter((c) => c.id !== cmd.id);
        return send(res, 204);
      }
      return send(res, 404, { message: `fake-discord: no route for ${method} ${path}`, code: 0 });
    } catch (e) {
      return send(res, 500, { message: (e as Error).message });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
