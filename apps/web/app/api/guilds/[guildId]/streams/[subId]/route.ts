import { deleteStreamSubscription, recordAudit } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

export const DELETE = guildRoute({ type: 'configure', feature: 'streamAlerts' }, async ({ guildId, user }, params) => {
  const row = await deleteStreamSubscription(server().db, guildId, params.subId ?? '');
  if (!row) throw new NotFoundError('Alert not found.');
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'streams.deleted', target: `${row.platform}:${row.account}` });
  return json({ ok: true });
});
