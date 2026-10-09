import { listGiveaways } from '@botcooks/database';
import { Alert, Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { FeatureSwitch, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Giveaways & polls' };

export default async function GiveawaysPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'giveaways' });
  const giveaways = await listGiveaways(server().db, guildId, 50);
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🎉" title="Giveaways & polls" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle description="Start one with /giveaway prize duration [winners] [required_role]. Winners are drawn by the worker with a cryptographic RNG." actions={<FeatureSwitch feature="giveaways" label="Giveaways" />}>
            Giveaways
          </CardTitle>
        </Card>
        <Card>
          <CardTitle description="/poll creates a native Discord poll (2-10 answers, up to 32 days). Results live in Discord." actions={<FeatureSwitch feature="polls" label="Polls" />}>
            Polls
          </CardTitle>
          <Alert tone="info">Native polls need the Send Polls permission in the channel.</Alert>
        </Card>
      </div>
      <Card className="mt-6">
        <CardTitle>Recent giveaways</CardTitle>
        {giveaways.length === 0 ? (
          <EmptyState title="No giveaways yet" />
        ) : (
          <Table head={['Prize', 'Winners', 'Ends (UTC)', 'Status', 'Result']} caption="Giveaways">
            {giveaways.map((g) => (
              <tr key={g.id}>
                <Td>{g.prize}</Td>
                <Td>{g.winnerCount}</Td>
                <Td className="whitespace-nowrap text-xs">{g.endsAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                <Td><Badge tone={g.ended ? 'neutral' : 'ember'}>{g.ended ? 'ended' : 'running'}</Badge></Td>
                <Td className="font-mono text-xs">{g.winners?.join(', ') || (g.ended ? 'no entries' : '—')}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </SettingsProvider>
  );
}
