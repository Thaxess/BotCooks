import { getBuildSession, getLatestPlanVersion, listPlanVersions } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

export const GET = guildRoute({ type: 'builder.generate' }, async ({ guildId }, params) => {
  const db = server().db;
  const session = await getBuildSession(db, guildId, params.sessionId ?? '');
  if (!session) throw new NotFoundError('Build not found.');
  const [latest, versions] = await Promise.all([getLatestPlanVersion(db, guildId, session.id), listPlanVersions(db, guildId, session.id)]);
  return json({
    session: {
      id: session.id,
      prompt: session.prompt,
      status: session.status,
      error: session.error,
      source: session.source,
      templateId: session.templateId,
      createdAt: session.createdAt,
    },
    latest: latest ? { id: latest.id, version: latest.version, plan: latest.plan, validation: latest.validation, aiModel: latest.aiModel, instruction: latest.instruction } : null,
    versions,
  });
});
