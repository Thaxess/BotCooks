import { z } from 'zod';
import { getCustomCommandByName, listCustomCommands, recordAudit, upsertCustomCommand } from '@botcooks/database';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { checkGraph, queueCommandSync } from '@/lib/server/workflows';

const bodySchema = z.object({ graph: z.unknown(), enabled: z.boolean().default(false) });

export const GET = guildRoute({ type: 'configure', feature: 'customCommands' }, async ({ guildId }) => json({ commands: await listCustomCommands(server().db, guildId) }));

export const POST = guildRoute({ type: 'configure', feature: 'customCommands' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const graph = await checkGraph(guildId, body.graph, 'command');
  const trigger = graph.nodes.find((n) => n.type === 'trigger.command')!.data as { name: string; description: string };
  if (await getCustomCommandByName(server().db, guildId, trigger.name)) return json({ error: `/${trigger.name} already exists.` }, 409);
  const row = await upsertCustomCommand(server().db, { guildId, name: trigger.name, description: trigger.description, graph, enabled: body.enabled, createdBy: user.id });
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'commands.created', target: trigger.name });
  await queueCommandSync(guildId);
  return json({ command: row }, 201);
});
