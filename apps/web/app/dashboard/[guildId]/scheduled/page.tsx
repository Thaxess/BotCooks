import { listScheduledMessages } from '@botcooks/database';
import { Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { ScheduledEditor, ScheduledRowActions } from '@/components/scheduled-editor';
import { FeatureSwitch, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Scheduled messages' };

export default async function ScheduledPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'scheduled' });
  const messages = await listScheduledMessages(server().db, guildId);
  const channelName = (id: string) => data.channels.find((c) => c.id === id)?.name ?? 'deleted channel';
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="⏰" title="Scheduled messages" description="Sent by the worker. Missed runs during downtime are skipped rather than sent in a burst." actions={<FeatureSwitch feature="scheduled" label="Scheduled messages" />} />
      <div className="flex flex-col gap-6">
        <ScheduledEditor guildId={guildId} channels={data.channels} />
        <Card>
          <CardTitle>Upcoming</CardTitle>
          {messages.length === 0 ? (
            <EmptyState title="Nothing scheduled" />
          ) : (
            <Table head={['Channel', 'Message', 'Next run (UTC)', 'Repeat', 'Status', '']} caption="Scheduled messages">
              {messages.map((m) => (
                <tr key={m.id}>
                  <Td>#{channelName(m.channelId)}</Td>
                  <Td className="max-w-sm"><p className="line-clamp-2">{m.content}</p>{m.lastError ? <p className="text-xs text-chili-400">Last error: {m.lastError}</p> : null}</Td>
                  <Td className="whitespace-nowrap text-xs">{m.nextRunAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td className="text-xs">{m.intervalMinutes ? `${m.intervalMinutes} min` : 'once'}</Td>
                  <Td><Badge tone={m.enabled ? 'ok' : 'neutral'}>{m.enabled ? 'active' : 'paused/done'}</Badge></Td>
                  <Td><ScheduledRowActions guildId={guildId} id={m.id} enabled={m.enabled} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </SettingsProvider>
  );
}
