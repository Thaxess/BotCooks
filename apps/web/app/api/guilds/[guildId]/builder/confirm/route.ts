import { z } from 'zod';
import { confirmPlan } from '@botcooks/services';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { builderDeps } from '@/lib/server/context';

const bodySchema = z.object({
  planVersionId: z.string().uuid(),
  mode: z.enum(['additive', 'update', 'sync']),
  token: z.string().min(20).max(4000),
  acknowledgeElevation: z.boolean().default(false),
  acknowledgeDestructive: z.boolean().default(false),
  typedConfirmation: z.string().max(200).optional(),
});

/**
 * Applies a previewed plan. The service re-fetches the server, re-validates, verifies the signed
 * confirmation (plan + server state + user + expiry) and re-checks permissions from fresh data.
 */
export const POST = guildRoute(
  { type: 'builder.generate' },
  async ({ guildId, user, req, access, ownerId }) => {
    const body = await readJson(req, bodySchema);
    const execution = await confirmPlan(await builderDeps(), {
      guildId,
      userId: user.id,
      access,
      ownerId,
      planVersionId: body.planVersionId,
      mode: body.mode,
      token: body.token,
      acknowledgeElevation: body.acknowledgeElevation,
      acknowledgeDestructive: body.acknowledgeDestructive,
      ...(body.typedConfirmation !== undefined ? { typedConfirmation: body.typedConfirmation } : {}),
    });
    return json({ executionId: execution.id }, 202);
  },
  { fresh: true },
);
