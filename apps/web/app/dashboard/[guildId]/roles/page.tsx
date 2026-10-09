import { listSelfRolePanels } from '@botcooks/database';
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { DeletePanelButton, PanelEditor } from '@/components/panel-editor';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Roles & onboarding' };

export default async function RolesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'selfroles' });
  const panels = await listSelfRolePanels(server().db, guildId);
  const roleName = (id: string) => data.roles.find((r) => r.id === id)?.name ?? `deleted role (${id})`;
  const channelName = (id: string) => data.channels.find((c) => c.id === id)?.name ?? 'deleted channel';
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🎭" title="Roles & onboarding" description="Autoroles for new members and self-assignable role panels. Discord’s own Onboarding screen is configured in Server Settings (Community servers)." />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('autoroles', data.resources.botPermissions)} />
        <SettingsForm
          section="autoroles"
          feature="autoroles"
          title="Autoroles"
          description="Given on join (or after verification when the verification gate is on)."
          fields={[
            { key: 'roleIds', type: 'roles', label: 'Roles for new members' },
            { key: 'botRoleIds', type: 'roles', label: 'Roles for new bots' },
          ]}
        />
        <PanelEditor guildId={guildId} channels={data.channels} roles={data.roles} />
        <Card>
          <CardTitle>Active panels</CardTitle>
          {panels.length === 0 ? (
            <EmptyState title="No panels yet">Post one above, or let the AI builder create them.</EmptyState>
          ) : (
            <Table head={['Title', 'Channel', 'Roles', '']} caption="Self-role panels">
              {panels.map((p) => (
                <tr key={p.id}>
                  <Td>{p.title}</Td>
                  <Td>#{channelName(p.channelId)}</Td>
                  <Td className="text-xs">{p.roleIds.map(roleName).join(', ')}</Td>
                  <Td><DeletePanelButton guildId={guildId} panelId={p.id} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </SettingsProvider>
  );
}
