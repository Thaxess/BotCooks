import { z } from 'zod';
import { buildPreview } from '@botcooks/services';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { builderDeps } from '@/lib/server/context';

const bodySchema = z.object({ planVersionId: z.string().uuid(), mode: z.enum(['additive', 'update', 'sync']).default('additive') });

/** Fresh snapshot + re-validation + diff. Returns a signed confirmation only if this user may apply it. */
export const POST = guildRoute(
  { type: 'builder.generate' },
  async ({ guildId, user, req, access, ownerId }) => {
    const body = await readJson(req, bodySchema);
    const preview = await buildPreview(await builderDeps(), { guildId, planVersionId: body.planVersionId, mode: body.mode, userId: user.id, access, ownerId });
    return json({ preview });
  },
  { fresh: true },
);
