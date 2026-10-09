import 'server-only';
import { enqueueJob } from '@botcooks/database';
import { validateGraphRefs } from '@botcooks/services';
import { BUILTIN_COMMAND_NAMES } from '@botcooks/shared';
import { validateGraph, type Graph } from '@botcooks/workflows';
import { HttpError } from './api';
import { server } from './context';
import { guildResources } from './guild';

/** Validates a graph from the browser: schema, structure, and that every ID belongs to this guild. */
export async function checkGraph(guildId: string, raw: unknown, kind: 'command' | 'event'): Promise<Graph> {
  const v = validateGraph(raw, kind);
  if (!v.ok) throw new HttpError(v.errors.slice(0, 5).join(' '), 'invalid_graph');
  if (kind === 'command') {
    const name = (v.trigger.data as { name: string }).name;
    if (BUILTIN_COMMAND_NAMES.has(name)) throw new HttpError(`/${name} is a built-in BotCooks command. Choose another name.`, 'name_taken');
  }
  const r = await guildResources(guildId);
  const errors = validateGraphRefs(v.graph, { guildId, botTopPosition: r.botTopPosition, channels: r.channels, roles: r.roles });
  if (errors.length) throw new HttpError(errors.slice(0, 5).join(' '), 'invalid_reference');
  return v.graph;
}

/** Custom commands are registered with Discord by the worker. */
export async function queueCommandSync(guildId: string) {
  await enqueueJob(server().db, 'commands.sync', { guildId }, { guildId, dedupeKey: `cmdsync:${guildId}`, maxAttempts: 5 });
}
