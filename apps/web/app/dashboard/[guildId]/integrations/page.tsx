import { listStreamSubscriptions } from '@botcooks/database';
import { Alert, Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { DeleteStreamButton, StreamEditor } from '@/components/stream-editor';
import { FeatureSwitch, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Twitch, YouTube & Kick' };

export default async function IntegrationsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'streamAlerts' });
  const subs = await listStreamSubscriptions(server().db, guildId);
  const channelName = (id: string) => data.channels.find((c) => c.id === id)?.name ?? 'deleted channel';
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="📺" title="Twitch, YouTube & Kick" description="Polling-based alerts run by the worker." actions={<FeatureSwitch feature="streamAlerts" label="Stream alerts" />} />
      <div className="flex flex-col gap-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Alert tone="info" title="Twitch">Needs <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> on the worker (a free Twitch developer app). Uses the Helix streams API.</Alert>
          <Alert tone="info" title="YouTube">No key needed: uses the public channel RSS feed. It announces new uploads, can lag several minutes, and does not detect live streams.</Alert>
          <Alert tone="info" title="Kick">Needs <code>KICK_CLIENT_ID</code> and <code>KICK_CLIENT_SECRET</code> on the worker. Uses Kick’s official public API.</Alert>
        </div>
        <StreamEditor guildId={guildId} channels={data.channels} roles={data.roles} />
        <Card>
          <CardTitle>Alerts</CardTitle>
          {subs.length === 0 ? (
            <EmptyState title="No alerts yet" />
          ) : (
            <Table head={['Platform', 'Account', 'Channel', 'Last check', 'Status', '']} caption="Stream alerts">
              {subs.map((s) => (
                <tr key={s.id}>
                  <Td><Badge tone="ember">{s.platform}</Badge></Td>
                  <Td className="font-mono text-xs">{s.account}</Td>
                  <Td>#{channelName(s.channelId)}</Td>
                  <Td className="text-xs">{s.lastCheckedAt ? s.lastCheckedAt.toISOString().slice(0, 16).replace('T', ' ') : 'not yet'}</Td>
                  <Td>{s.lastError ? <Badge tone="warn">{s.lastError}</Badge> : s.enabled ? <Badge tone="ok">ok</Badge> : <Badge>disabled</Badge>}</Td>
                  <Td><DeleteStreamButton guildId={guildId} id={s.id} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </SettingsProvider>
  );
}
