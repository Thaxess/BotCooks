import { getFeature } from '@botcooks/shared';
import { Alert, Card, CardTitle, PageHeader } from '@/components/ui';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Music & voice' };

export default async function VoicePage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'tempVoice' });
  const music = getFeature('music');
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🎧" title="Music & voice" />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('tempVoice', data.resources.botPermissions)} />
        <SettingsForm
          section="tempVoice"
          feature="tempVoice"
          title="Temporary voice rooms"
          description="Members join the hub channel and get their own room, which is deleted when it empties. The owner may rename and set a limit on their room."
          fields={[
            { key: 'hubChannelId', type: 'channel', label: '“Join to create” hub', channelTypes: [2] },
            { key: 'categoryId', type: 'channel', label: 'Category for rooms', channelTypes: [4], help: 'Defaults to the hub’s category.' },
            { key: 'nameTemplate', type: 'text', label: 'Room name', maxLength: 90, help: '{user} = display name' },
            { key: 'userLimit', type: 'number', label: 'Default user limit', min: 0, max: 99, help: '0 = unlimited' },
          ]}
        />
        <Card>
          <CardTitle>Music playback</CardTitle>
          <Alert tone="danger" title="Not available">
            {music.statusNote}
          </Alert>
        </Card>
      </div>
    </SettingsProvider>
  );
}
