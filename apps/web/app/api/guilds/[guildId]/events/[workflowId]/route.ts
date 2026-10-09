import { z } from 'zod';
import { deleteEventWorkflow, getEventWorkflow, recordAudit, upsertEventWorkflow } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { checkGraph } from '@/lib/server/workflows';

const bodySchema = z.object({ name: z.string().trim().min(1).max(80), graph: z.unknown(), enabled: z.boolean() });

export const PUT = guildRoute({ type: 'configure', feature: 'events' }, async ({ guildId, user, req }, params) => {
  const existing = await getEventWorkflow(server().db, guildId, params.workflowId ?? '');
  if (!existing) throw new NotFoundError('Workflow not found.');
  const body = await readJson(req, bodySchema);
  const graph = await checkGraph(guildId, body.graph, 'event');
  const trigger = (graph.nodes.find((n) => n.type === 'trigger.event')!.data as { event: string }).event;
  const row = await upsertEventWorkflow(server().db, { guildId, id: existing.id, name: body.name, trigger, graph, enabled: body.enabled, createdBy: user.id });
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'events.updated', target: body.name, details: { enabled: body.enabled } });
  return json({ workflow: row });
});

export const DELETE = guildRoute({ type: 'configure', feature: 'events' }, async ({ guildId, user }, params) => {
  const row = await deleteEventWorkflow(server().db, guildId, params.workflowId ?? '');
  if (!row) throw new NotFoundError('Workflow not found.');
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'events.deleted', target: row.name });
  return json({ ok: true });
});
