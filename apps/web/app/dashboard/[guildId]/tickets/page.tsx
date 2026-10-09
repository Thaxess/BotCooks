import Link from 'next/link';
import { listTickets } from '@botcooks/database';
import { Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Tickets' };

export default async function TicketsPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { guildId } = await params;
  const { status } = await searchParams;
  const filter = status === 'open' || status === 'closed' ? status : undefined;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'tickets' });
  const tickets = await listTickets(server().db, guildId, filter, 50);
  const base = `/dashboard/${guildId}/tickets`;
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🎫" title="Tickets" description="Tickets are private threads. Post the panel with /ticket-panel in Discord." />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('tickets', data.resources.botPermissions)} />
        <SettingsForm
          section="tickets"
          feature="tickets"
          title="Settings"
          fields={[
            { key: 'panelChannelId', type: 'channel', label: 'Panel channel' },
            { key: 'staffRoleIds', type: 'roles', label: 'Staff roles', help: 'Added to every ticket and allowed to claim/close.' },
            { key: 'maxOpenPerUser', type: 'number', label: 'Open tickets per member', min: 1, max: 10 },
            { key: 'logChannelId', type: 'channel', label: 'Ticket log channel' },
            { key: 'openMessage', type: 'textarea', label: 'First message in a new ticket', maxLength: 2000 },
          ]}
        />
        <Card>
          <CardTitle
            actions={
              <nav aria-label="Filter" className="flex gap-2 text-sm">
                {[undefined, 'open', 'closed'].map((s) => (
                  <Link key={s ?? 'all'} href={s ? `${base}?status=${s}` : base} aria-current={filter === s ? 'page' : undefined} className={filter === s ? 'font-semibold text-ember-300' : 'text-coal-400 hover:text-coal-100'}>
                    {s ?? 'all'}
                  </Link>
                ))}
              </nav>
            }
          >
            Recent tickets
          </CardTitle>
          {tickets.length === 0 ? (
            <EmptyState title="No tickets">Tickets opened from the panel show up here.</EmptyState>
          ) : (
            <Table head={['#', 'Status', 'Opened by', 'Claimed by', 'Opened', 'Closed']} caption="Tickets">
              {tickets.map((t) => (
                <tr key={t.id}>
                  <Td className="font-mono">{t.number}</Td>
                  <Td><Badge tone={t.status === 'open' ? 'ember' : 'neutral'}>{t.status}</Badge></Td>
                  <Td className="font-mono text-xs">{t.openerId}</Td>
                  <Td className="font-mono text-xs">{t.claimedBy ?? '—'}</Td>
                  <Td className="text-xs">{t.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td className="text-xs">{t.closedAt ? t.closedAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </SettingsProvider>
  );
}
