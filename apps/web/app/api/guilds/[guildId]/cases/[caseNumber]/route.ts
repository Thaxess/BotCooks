import { z } from 'zod';
import { recordAudit, resolveAppeal, setCaseActive } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('appeal'), accepted: z.boolean() }),
  z.object({ action: z.literal('active'), active: z.boolean() }),
]);

export const POST = guildRoute({ type: 'configure', feature: 'moderation' }, async ({ guildId, user, req }, params) => {
  const caseNumber = Number(params.caseNumber);
  if (!Number.isInteger(caseNumber) || caseNumber < 1) throw new NotFoundError('Case not found.');
  const body = await readJson(req, bodySchema);
  const db = server().db;
  const row =
    body.action === 'appeal'
      ? await resolveAppeal(db, guildId, caseNumber, body.accepted, user.id)
      : await setCaseActive(db, guildId, caseNumber, body.active);
  if (!row) throw new NotFoundError(body.action === 'appeal' ? 'No open appeal for that case.' : 'Case not found.');
  await recordAudit(db, {
    guildId,
    actorId: user.id,
    actorType: 'user',
    action: body.action === 'appeal' ? `moderation.appeal_${body.accepted ? 'accepted' : 'rejected'}` : body.active ? 'moderation.reactivate' : 'moderation.pardon',
    target: String(caseNumber),
  });
  return json({ case: row });
});
