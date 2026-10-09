import Link from 'next/link';
import { TEMPLATE_LIST } from '@botcooks/ai';
import { listExecutions, listSnapshots } from '@botcooks/database';
import { Alert, Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { CreateSnapshot, RestoreButton, RollbackButton } from '@/components/backup-actions';
import { server } from '@/lib/server/context';
import { requirePageAccess } from '@/lib/server/guild';

export const metadata = { title: 'Backups & templates' };

export default async function BackupsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requirePageAccess(guildId, { type: 'backups.restore' });
  const [snapshots, executions] = await Promise.all([listSnapshots(server().db, guildId, 30), listExecutions(server().db, guildId, 30)]);
  return (
    <>
      <PageHeader emoji="🧊" title="Backups & templates" description="Snapshots capture roles, channels, permission overwrites and BotCooks settings. They never contain messages." />
      <div className="mb-6">
        <Alert tone="warn" title="What a backup cannot do">
          Discord does not let bots restore deleted messages, channel history, original channel/role IDs, members’ role assignments or invites. Restoring recreates missing
          structure with new IDs; it is not a complete undo.
        </Alert>
      </div>
      <div className="flex flex-col gap-6">
        <Card>
          <CardTitle actions={<CreateSnapshot guildId={guildId} />}>Snapshots</CardTitle>
          {snapshots.length === 0 ? (
            <EmptyState title="No snapshots yet">A snapshot is taken automatically before every change the builder applies.</EmptyState>
          ) : (
            <Table head={['When (UTC)', 'Label', 'Type', 'Roles', 'Channels', '']} caption="Snapshots">
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap text-xs">{s.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td>{s.label ?? '—'}</Td>
                  <Td><Badge>{s.reason}</Badge></Td>
                  <Td>{s.roleCount}</Td>
                  <Td>{s.channelCount}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <RestoreButton guildId={guildId} snapshotId={s.id} />
                      <a className="px-2 py-1 text-xs text-coal-300 underline" href={`/api/guilds/${guildId}/snapshots?id=${s.id}`}>Download</a>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-coal-500">“Restore missing” turns the snapshot into a plan and opens it in the builder, where you preview exactly what would be recreated.</p>
        </Card>

        <Card>
          <CardTitle>Applied changes</CardTitle>
          {executions.length === 0 ? (
            <EmptyState title="No changes applied yet" />
          ) : (
            <Table head={['When (UTC)', 'Kind', 'Mode', 'Status', 'Result', '']} caption="Applied changes">
              {executions.map((e) => {
                const report = e.report as { done: number; failed: number; skipped: number } | null;
                const finished = !['queued', 'running'].includes(e.status);
                return (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs">{e.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                    <Td>{e.kind}</Td>
                    <Td>{e.mode}</Td>
                    <Td><Badge tone={e.status === 'completed' ? 'ok' : e.status === 'failed' ? 'danger' : e.status === 'completed_with_errors' ? 'warn' : 'ember'}>{e.status.replace(/_/g, ' ')}</Badge></Td>
                    <Td className="text-xs">{report ? `${report.done} done, ${report.failed} failed, ${report.skipped} skipped` : `${e.progressDone}/${e.progressTotal}`}</Td>
                    <Td>{e.kind === 'apply' && finished && report && report.done > 0 ? <RollbackButton guildId={guildId} executionId={e.id} /> : null}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card>
          <CardTitle description="Templates are applied through the builder, with the same preview and confirmation.">Templates</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TEMPLATE_LIST.map((t) => (
              <li key={t.id} className="rounded-lg border border-coal-700 p-3 text-sm">
                <span aria-hidden>{t.emoji}</span> <span className="font-semibold">{t.name}</span>
                <p className="text-xs text-coal-400">{t.description}</p>
              </li>
            ))}
          </ul>
          <Link href={`/dashboard/${guildId}/builder`} className="mt-3 inline-block text-sm text-ember-300 hover:underline">Use a template in the builder →</Link>
        </Card>
      </div>
    </>
  );
}
