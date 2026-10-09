import { PageHeader } from '@/components/ui';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Welcome & goodbye' };

export default async function WelcomePage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'welcome' });
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="👋" title="Welcome & goodbye" description="Placeholders: {user} mentions the member, {username}, {server}, {count} (member count)." />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('welcome', data.resources.botPermissions)} />
        <SettingsForm
          section="welcome"
          feature="welcome"
          title="Messages"
          fields={[
            { key: 'channelId', type: 'channel', label: 'Welcome channel' },
            { key: 'useEmbed', type: 'toggle', label: 'Send as an embed' },
            { key: 'message', type: 'textarea', label: 'Welcome message', maxLength: 2000 },
            { key: 'dmEnabled', type: 'toggle', label: 'Also DM new members' },
            { key: 'dmMessage', type: 'textarea', label: 'DM message', maxLength: 2000 },
            { key: 'goodbyeEnabled', type: 'toggle', label: 'Goodbye messages' },
            { key: 'goodbyeChannelId', type: 'channel', label: 'Goodbye channel', help: 'Defaults to the welcome channel.' },
            { key: 'goodbyeMessage', type: 'textarea', label: 'Goodbye message', maxLength: 2000 },
          ]}
        />
      </div>
    </SettingsProvider>
  );
}
