import { z } from 'zod';
import { deleteScheduledMessage, recordAudit, updateScheduledMessage } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';

const patchSchema = z.object({ enabled: z.boolean() });

export const PATCH = guildRoute({ type: 'configure', feature: 'scheduled' }, async ({ guildId, user, req }, params) => {
  const body = await readJson(req, patchSchema);
  const row = await updateScheduledMessage(server().db, guildId, params.messageId ?? '', { enabled: body.enabled });
  if (!row) throw new NotFoundError('Scheduled message not found.');
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: body.enabled ? 'scheduled.enabled' : 'scheduled.disabled', target: row.id });
  return json({ message: row });
});

export const DELETE = guildRoute({ type: 'configure', feature: 'scheduled' }, async ({ guildId, user }, params) => {
  const row = await deleteScheduledMessage(server().db, guildId, params.messageId ?? '');
  if (!row) throw new NotFoundError('Scheduled message not found.');
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'scheduled.deleted', target: row.id });
  return json({ ok: true });
});
