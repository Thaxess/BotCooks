import { recordAudit, requestExecutionCancel } from '@botcooks/database';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

/** Cancellation stops before the next operation; work already done stays (roll it back if needed). */
export const POST = guildRoute({ type: 'builder.generate' }, async ({ guildId, user }, params) => {
  const ok = await requestExecutionCancel(server().db, guildId, params.executionId ?? '');
  if (ok) await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'builder.cancel', target: params.executionId ?? null });
  return json({ ok }, ok ? 200 : 409);
});
