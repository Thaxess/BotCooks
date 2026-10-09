import { z } from 'zod';
import { opLabel } from '@botcooks/workflows';
import { previewRollback, requestRollback } from '@botcooks/services';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { builderDeps } from '@/lib/server/context';

export const GET = guildRoute({ type: 'backups.restore' }, async ({ guildId }, params) => {
  const { ops, irreversible } = await previewRollback(await builderDeps(), guildId, params.executionId ?? '');
  return json({ steps: ops.map((op) => opLabel(op)), irreversible });
});

const bodySchema = z.object({ confirm: z.literal(true) });

export const POST = guildRoute(
  { type: 'backups.restore' },
  async ({ guildId, user, req, access }, params) => {
    await readJson(req, bodySchema);
    const rollback = await requestRollback(await builderDeps(), { guildId, executionId: params.executionId ?? '', userId: user.id, access });
    return json({ executionId: rollback.id }, 202);
  },
  { fresh: true },
);
