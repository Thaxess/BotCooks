import { listEventWorkflows } from '@botcooks/database';
import { Alert, PageHeader } from '@/components/ui';
import { FlowPage } from '@/components/flow/flow-page';
import { FeatureSwitch, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Event builder' };

const TRIGGER_LABEL: Record<string, string> = { memberJoin: 'when a member joins', memberLeave: 'when a member leaves', messageCreate: 'when a message is sent' };

export default async function EventsPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ id?: string }> }) {
  const { guildId } = await params;
  const { id } = await searchParams;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'events' });
  const workflows = await listEventWorkflows(server().db, guildId);
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="⚡" title="Visual event builder" description="React to server events with blocks. Workflows run with step, message and wait limits." actions={<FeatureSwitch feature="events" label="Event workflows" />} />
      <div className="mb-4">
        <Alert tone="info">Member join/leave triggers need the Server Members intent; message triggers need the Message Content intent (both privileged, enabled on the bot).</Alert>
      </div>
      <FlowPage
        kind="event"
        guildId={guildId}
        items={workflows.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled, graph: w.graph, subtitle: TRIGGER_LABEL[w.trigger] ?? w.trigger }))}
        selectedId={id ?? null}
        roles={data.roles}
        channels={data.channels}
      />
    </SettingsProvider>
  );
}
