import { z } from 'zod';
import { createScheduledMessage, listScheduledMessages, recordAudit } from '@botcooks/database';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { server } from '@/lib/server/context';
import { guildResources } from '@/lib/server/guild';

const scheduledSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/),
  content: z.string().trim().min(1).max(2000),
  runAt: z.coerce.date(),
  /** null/undefined = one-off. Minimum 10 minutes to avoid spam. */
  intervalMinutes: z.number().int().min(10).max(43_200).nullable().optional(),
  enabled: z.boolean().default(true),
});

export const GET = guildRoute({ type: 'configure', feature: 'scheduled' }, async ({ guildId }) => json({ messages: await listScheduledMessages(server().db, guildId) }));

export const POST = guildRoute({ type: 'configure', feature: 'scheduled' }, async ({ guildId, user, req }) => {
  const body = await readJson(req, scheduledSchema);
  const resources = await guildResources(guildId);
  if (!resources.channels.some((c) => c.id === body.channelId && (c.type === 0 || c.type === 5))) return json({ error: 'Pick a text channel in this server.' }, 400);
  if (body.runAt.getTime() < Date.now() - 60_000) return json({ error: 'The first run must be in the future.' }, 400);
  const row = await createScheduledMessage(server().db, {
    guildId,
    channelId: body.channelId,
    content: body.content,
    nextRunAt: body.runAt,
    intervalMinutes: body.intervalMinutes ?? null,
    enabled: body.enabled,
    createdBy: user.id,
  });
  await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'scheduled.created', target: row.id });
  return json({ message: row }, 201);
});
