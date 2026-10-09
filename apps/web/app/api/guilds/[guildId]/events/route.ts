import { z } from 'zod';
import { listEventWorkflows, recordAudit, upsertEventWorkflow } from '@botcooks/database';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { checkGraph } from '@/lib/server/workflows';

const bodySchema = z.object({ name: z.string().trim().min(1).max(80), graph: z.unknown(), enabled: z.boolean().default(false) });

export const GET = guildRoute({ type: 'configure', feature: 'events' }, async ({ guildId }) => json({ workflows: await listEventWorkflows(server().db, guildId) }));

export const POST = guildRoute({ type: 'configure', feature: 'events' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const graph = await checkGraph(guildId, body.graph, 'event');
  const trigger = (graph.nodes.find((n) => n.type === 'trigger.event')!.data as { event: string }).event;
  const row = await upsertEventWorkflow(server().db, { guildId, name: body.name, trigger, graph, enabled: body.enabled, createdBy: user.id });
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'events.created', target: body.name });
  return json({ workflow: row }, 201);
});
