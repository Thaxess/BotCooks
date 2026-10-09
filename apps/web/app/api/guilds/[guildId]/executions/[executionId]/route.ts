import { getExecution, getOpStates } from '@botcooks/database';
import { NotFoundError } from '@botcooks/shared';
import { opLabel, type Op } from '@botcooks/workflows';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

export const GET = guildRoute({ type: 'builder.generate' }, async ({ guildId }, params) => {
  const exec = await getExecution(server().db, guildId, params.executionId ?? '');
  if (!exec) throw new NotFoundError('Change not found.');
  const states = new Map((await getOpStates(server().db, exec.id)).map((s) => [s.opId, s]));
  const ops = (exec.ops as Op[]).map((op) => ({
    id: op.id,
    label: opLabel(op),
    status: states.get(op.id)?.status ?? 'pending',
    error: states.get(op.id)?.error ?? null,
  }));
  return json({
    execution: {
      id: exec.id,
      kind: exec.kind,
      status: exec.status,
      mode: exec.mode,
      cancelRequested: exec.cancelRequested,
      progressDone: exec.progressDone,
      progressTotal: exec.progressTotal,
      progressLabel: exec.progressLabel,
      report: exec.report,
      irreversible: exec.irreversible,
      createdAt: exec.createdAt,
      finishedAt: exec.finishedAt,
    },
    ops,
  });
});
