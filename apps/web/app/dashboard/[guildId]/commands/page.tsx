import { listCustomCommands } from '@botcooks/database';
import { PageHeader } from '@/components/ui';
import { FlowPage } from '@/components/flow/flow-page';
import { FeatureSwitch, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Command builder' };

export default async function CommandsPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ id?: string }> }) {
  const { guildId } = await params;
  const { id } = await searchParams;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'customCommands' });
  const commands = await listCustomCommands(server().db, guildId);
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader
        emoji="🧩"
        title="Visual command builder"
        description="Build server-only slash commands from blocks. Enabled commands are registered with Discord automatically. Commands suggested by the AI builder start disabled."
        actions={<FeatureSwitch feature="customCommands" label="Custom commands" />}
      />
      <FlowPage
        kind="command"
        guildId={guildId}
        items={commands.map((c) => ({ id: c.id, name: c.name, enabled: c.enabled, graph: c.graph, subtitle: c.description }))}
        selectedId={id ?? null}
        roles={data.roles}
        channels={data.channels}
      />
    </SettingsProvider>
  );
}
