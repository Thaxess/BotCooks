import { z } from 'zod';
import { createStreamSubscription, listStreamSubscriptions, recordAudit } from '@botcooks/database';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { guildResources } from '@/lib/server/guild';

const snowflake = z.string().regex(/^\d{17,20}$/);
// Account formats per platform; kept in sync with @botcooks/integrations validators.
const account = {
  youtube: z.string().regex(/^UC[\w-]{22}$/, 'YouTube needs the channel ID starting with UC (24 characters).'),
  twitch: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,25}$/, 'Twitch usernames are 3-25 letters, numbers or underscores.'),
  kick: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,25}$/, 'Kick channel slugs are up to 25 letters, numbers, - or _.'),
};

const bodySchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('youtube'), account: account.youtube, channelId: snowflake, message: z.string().max(1000).optional(), pingRoleId: snowflake.optional() }),
  z.object({ platform: z.literal('twitch'), account: account.twitch, channelId: snowflake, message: z.string().max(1000).optional(), pingRoleId: snowflake.optional() }),
  z.object({ platform: z.literal('kick'), account: account.kick, channelId: snowflake, message: z.string().max(1000).optional(), pingRoleId: snowflake.optional() }),
]);

export const GET = guildRoute({ type: 'configure', feature: 'streamAlerts' }, async ({ guildId }) => json({ subscriptions: await listStreamSubscriptions(server().db, guildId) }));

export const POST = guildRoute({ type: 'configure', feature: 'streamAlerts' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const r = await guildResources(guildId);
  if (!r.channels.some((c) => c.id === body.channelId && (c.type === 0 || c.type === 5))) return json({ error: 'Pick a text channel in this server.' }, 400);
  if (body.pingRoleId) {
    const role = r.roles.find((x) => x.id === body.pingRoleId);
    if (!role || role.id === guildId) return json({ error: 'Pick a role from this server (not @everyone).' }, 400);
  }
  const row = await createStreamSubscription(server().db, {
    guildId,
    platform: body.platform,
    account: body.account,
    channelId: body.channelId,
    message: body.message || (body.platform === 'youtube' ? 'New video from {account}: **{title}** {url}' : '{account} is live: **{title}** {url}'),
    pingRoleId: body.pingRoleId ?? null,
  });
  if (!row) return json({ error: 'That alert already exists.' }, 409);
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'streams.created', target: `${body.platform}:${body.account}` });
  return json({ subscription: row }, 201);
});
