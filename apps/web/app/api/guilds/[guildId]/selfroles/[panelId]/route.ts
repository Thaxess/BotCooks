import { Routes } from 'discord-api-types/v10';
import { deleteSelfRolePanel, recordAudit } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

/** Deactivates the panel (buttons stop working immediately) and removes the message if possible. */
export const DELETE = guildRoute({ type: 'configure', feature: 'selfroles' }, async ({ guildId, user }, params) => {
  const panel = await deleteSelfRolePanel(server().db, guildId, params.panelId ?? '');
  if (!panel) throw new NotFoundError('Panel not found.');
  await server().rest.delete(Routes.channelMessage(panel.channelId, panel.messageId)).catch(() => undefined);
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'selfroles.panel_deleted', target: panel.messageId });
  return json({ ok: true });
});
