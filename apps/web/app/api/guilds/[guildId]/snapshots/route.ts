import { z } from 'zod';
import { getSettings, getSnapshot, listSnapshots, recordAudit, saveSnapshot } from '@botcooks/database';
import { startRestoreBuild } from '@botcooks/services';
import { NotFoundError, guildSnapshotSchema, snapshotHash } from '@botcooks/shared';
import { guildRoute, json, readJson } from '@/lib/server/api';
import { builderDeps, server } from '@/lib/server/context';

export const GET = guildRoute({ type: 'backups.restore' }, async ({ guildId, req }) => {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return json({ snapshots: await listSnapshots(server().db, guildId, 50) });
  // Download one snapshot as JSON (structure + BotCooks settings; never message content).
  const snap = await getSnapshot(server().db, guildId, id);
  if (!snap) throw new NotFoundError('Snapshot not found.');
  return new Response(JSON.stringify({ snapshot: snap.snapshot, settings: snap.settings, createdAt: snap.createdAt }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="botcooks-${guildId}-${snap.createdAt.toISOString().slice(0, 10)}.json"` },
  });
});

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), label: z.string().trim().max(100).optional() }),
  z.object({ action: z.literal('restore'), snapshotId: z.string().uuid() }),
]);

export const POST = guildRoute(
  { type: 'backups.restore' },
  async ({ guildId, user, req }) => {
    const body = await readJson(req, bodySchema);
    const deps = await builderDeps();
    if (body.action === 'create') {
      const snapshot = await deps.fetchSnapshot(guildId);
      const { settings } = await getSettings(server().db, guildId);
      const row = await saveSnapshot(server().db, { guildId, reason: 'manual', snapshot, hash: snapshotHash(snapshot), settings, label: body.label || 'Manual backup', createdBy: user.id });
      await recordAudit(server().db, { guildId, actorId: user.id, actorType: 'user', action: 'backups.created', target: row.id });
      return json({ snapshot: { id: row.id } }, 201);
    }
    const snap = await getSnapshot(server().db, guildId, body.snapshotId);
    if (!snap) throw new NotFoundError('Snapshot not found.');
    const session = await startRestoreBuild(deps, { guildId, userId: user.id, snapshot: guildSnapshotSchema.parse(snap.snapshot), label: snap.label ?? snap.createdAt.toISOString() });
    return json({ sessionId: session.id }, 201);
  },
  { fresh: true },
);
