import { z } from 'zod';
import { deleteCustomCommand, getCustomCommand, getCustomCommandByName, recordAudit, upsertCustomCommand } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { checkGraph, queueCommandSync } from '@/lib/server/workflows';

const bodySchema = z.object({ graph: z.unknown(), enabled: z.boolean() });

export const PUT = guildRoute({ type: 'configure', feature: 'customCommands' }, async ({ guildId, user, req }, params) => {
  const existing = await getCustomCommand(server().db, guildId, params.commandId ?? '');
  if (!existing) throw new NotFoundError('Command not found.');
  const body = await readJson(req, bodySchema);
  const graph = await checkGraph(guildId, body.graph, 'command');
  const trigger = graph.nodes.find((n) => n.type === 'trigger.command')!.data as { name: string; description: string };
  const clash = await getCustomCommandByName(server().db, guildId, trigger.name);
  if (clash && clash.id !== existing.id) return json({ error: `/${trigger.name} already exists.` }, 409);
  const row = await upsertCustomCommand(server().db, { guildId, id: existing.id, name: trigger.name, description: trigger.description, graph, enabled: body.enabled, createdBy: user.id });
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'commands.updated', target: trigger.name, details: { enabled: body.enabled } });
  await queueCommandSync(guildId);
  return json({ command: row });
});

export const DELETE = guildRoute({ type: 'configure', feature: 'customCommands' }, async ({ guildId, user }, params) => {
  const row = await deleteCustomCommand(server().db, guildId, params.commandId ?? '');
  if (!row) throw new NotFoundError('Command not found.');
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'commands.deleted', target: row.name });
  await queueCommandSync(guildId);
  return json({ ok: true });
});
