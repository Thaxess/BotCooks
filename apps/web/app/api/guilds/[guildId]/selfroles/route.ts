import { z } from 'zod';
import { listSelfRolePanels, mutateSettings, recordAudit, registerSelfRolePanel } from '@botcooks/database';
import { BRAND_COLOR, sendChannelMessage } from '@botcooks/discord';
import { validateSettingsRefs } from '@botcooks/services';
import { selfRoleComponents } from '@botcooks/workflows';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { guildResources } from '@/lib/server/guild';

const snowflake = z.string().regex(/^\d{17,20}$/);
const bodySchema = z.object({
  channelId: snowflake,
  title: z.string().trim().min(1).max(256),
  description: z.string().trim().max(1000).optional(),
  style: z.enum(['buttons', 'select']).default('buttons'),
  roles: z.array(z.object({ roleId: snowflake, label: z.string().trim().max(80).optional(), emoji: z.string().trim().max(32).optional() })).min(1).max(25),
});

export const GET = guildRoute({ type: 'configure', feature: 'selfroles' }, async ({ guildId }) => json({ panels: await listSelfRolePanels(server().db, guildId) }));

/** Posts a role panel. Every role must be safe to self-assign (same rules as autoroles). */
export const POST = guildRoute({ type: 'configure', feature: 'selfroles' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const resources = await guildResources(guildId);
  const channel = resources.channels.find((c) => c.id === body.channelId);
  if (!channel || ![0, 5].includes(channel.type)) return json({ error: 'Pick a text channel in this server.' }, 400);
  // Reuse autorole safety validation: roles in this guild, below the bot, no dangerous permissions.
  const errors = validateSettingsRefs('autoroles', { roleIds: body.roles.map((r) => r.roleId) }, { guildId, botTopPosition: resources.botTopPosition, channels: resources.channels, roles: resources.roles });
  if (errors.length) return json({ error: errors.join(' ').replace(/autoroles\.roleIds\.\d+: /g, '') }, 400);

  const roles = body.roles.map((r) => ({
    roleId: r.roleId,
    label: r.label || resources.roles.find((x) => x.id === r.roleId)!.name,
    ...(r.emoji ? { emoji: r.emoji } : {}),
  }));
  const message = await sendChannelMessage(server().rest, body.channelId, {
    embeds: [{ title: body.title, description: body.description || 'Pick the roles you want.', color: BRAND_COLOR }],
    components: selfRoleComponents({ title: body.title, style: body.style, roles: roles.map((r) => ({ ...r, role: r.roleId })) }, roles),
  });
  await registerSelfRolePanel(server().db, { guildId, channelId: body.channelId, messageId: message.id, title: body.title, roleIds: roles.map((r) => r.roleId) });
  await mutateSettings(server().db, guildId, user.id, (s) => void (s.features.selfroles = true));
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'selfroles.panel_created', target: message.id, details: { channelId: body.channelId, roles: roles.map((r) => r.roleId) } });
  return json({ messageId: message.id }, 201);
});
