import { z } from 'zod';
import { reviseBuild } from '@botcooks/services';
import { guildRoute, json, rateLimit, readJson } from '@/lib/server/api';
import { builderDeps } from '@/lib/server/context';
import { env } from '@/lib/server/env';

const bodySchema = z.object({ instruction: z.string().trim().min(3).max(2000) });

export const POST = guildRoute({ type: 'builder.generate' }, async ({ guildId, user, req }, params) => {
  const body = await readJson(req, bodySchema);
  rateLimit(`ai:${user.id}`, env().AI_GENERATIONS_PER_HOUR, 3_600_000);
  await reviseBuild(await builderDeps(), { guildId, sessionId: params.sessionId ?? '', userId: user.id, instruction: body.instruction });
  return json({ ok: true }, 202);
});
