import { z } from 'zod';
import { TEMPLATES, type TemplateId } from '@botcooks/ai';
import { listBuildSessions } from '@botcooks/database';
import { startBuild } from '@botcooks/services';
import { guildRoute, json, rateLimit, readJson } from '@/lib/server/api';
import { builderDeps, server } from '@/lib/server/context';
import { env } from '@/lib/server/env';

const bodySchema = z.object({
  prompt: z.string().trim().max(4000).optional(),
  templateId: z.enum(Object.keys(TEMPLATES) as [TemplateId, ...TemplateId[]]).optional(),
});

export const GET = guildRoute({ type: 'builder.generate' }, async ({ guildId }) => json({ sessions: await listBuildSessions(server().db, guildId, 30) }));

export const POST = guildRoute({ type: 'builder.generate' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  // AI calls cost money; templates are free.
  if (!body.templateId) rateLimit(`ai:${user.id}`, env().AI_GENERATIONS_PER_HOUR, 3_600_000);
  const session = await startBuild(await builderDeps(), {
    guildId,
    userId: user.id,
    source: 'dashboard',
    ...(body.prompt ? { prompt: body.prompt } : {}),
    ...(body.templateId ? { templateId: body.templateId } : {}),
  });
  return json({ session: { id: session.id, status: session.status } }, 201);
});
