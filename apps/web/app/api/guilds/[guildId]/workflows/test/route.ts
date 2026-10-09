import { z } from 'zod';
import { dryRunGraph } from '@botcooks/services';
import { validateGraph } from '@botcooks/workflows';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { guildResources } from '@/lib/server/guild';

const bodySchema = z.object({
  graph: z.unknown(),
  memberRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(50).default([]),
  messageContent: z.string().max(2000).optional(),
  options: z.record(z.string(), z.union([z.string().max(200), z.number()])).default({}),
});

/** Safe test mode: runs the workflow against a pretend member with recording effects only. */
export const POST = guildRoute({ type: 'view' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, bodySchema);
  const v = validateGraph(body.graph);
  if (!v.ok) return json({ errors: v.errors }, 400);
  const r = await guildResources(guildId);
  const result = await dryRunGraph(
    v.graph,
    {
      userId: user.id,
      userName: user.username,
      guildName: r.name,
      memberRoleIds: body.memberRoleIds,
      channelId: r.channels.find((c) => c.type === 0)?.id ?? '',
      ...(body.messageContent !== undefined ? { messageContent: body.messageContent } : {}),
      options: body.options,
    },
    (id) => r.roles.find((x) => x.id === id)?.name ?? id,
    (id) => r.channels.find((x) => x.id === id)?.name ?? id,
  );
  return json(result);
});
