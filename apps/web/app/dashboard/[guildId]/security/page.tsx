import { Alert, PageHeader } from '@/components/ui';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Auto-mod & anti-raid' };

export default async function SecurityPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'automod' });
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader
        emoji="🚨"
        title="Auto-moderation & anti-raid"
        description="Deterministic rules: no AI reads your members' messages. Staff with Manage Messages are always exempt."
      />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('automod', data.resources.botPermissions)} />
        <SettingsForm
          section="automod"
          feature="automod"
          title="Auto-moderation"
          description="Messages that break a rule are removed. Choose what else happens below."
          fields={[
            { key: 'spam.enabled', type: 'toggle', label: 'Spam filter', help: 'Fast posting and repeated messages.' },
            { key: 'spam.maxMessages', type: 'number', label: 'Max messages per window', min: 2, max: 50 },
            { key: 'spam.perSeconds', type: 'number', label: 'Window (seconds)', min: 2, max: 120 },
            { key: 'spam.duplicateThreshold', type: 'number', label: 'Identical messages allowed', min: 2, max: 20 },
            { key: 'maxMentionsPerMessage', type: 'number', label: 'Max mentions per message', min: 0, max: 50, help: '0 disables the mention limit.' },
            { key: 'blockInvites', type: 'toggle', label: 'Block Discord invites' },
            { key: 'blockLinks', type: 'toggle', label: 'Block links', help: 'Except the allowed domains below.' },
            { key: 'allowedDomains', type: 'lines', label: 'Allowed domains', placeholder: 'youtube.com\ntwitch.tv' },
            { key: 'blockedTerms', type: 'lines', label: 'Blocked terms', help: 'One per line. Whole-word, case-insensitive, tolerant of repeated letters.' },
            {
              key: 'action',
              type: 'select',
              label: 'Action',
              options: [
                { value: 'delete', label: 'Delete message only' },
                { value: 'delete_warn', label: 'Delete and record a case' },
                { value: 'delete_timeout', label: 'Delete, record a case and time out' },
              ],
            },
            { key: 'timeoutMinutes', type: 'number', label: 'Timeout length (minutes)', min: 1, max: 40320 },
            { key: 'alertChannelId', type: 'channel', label: 'Alert channel', help: 'Where removals are reported when no case is recorded.' },
            { key: 'exemptRoleIds', type: 'roles', label: 'Exempt roles' },
            { key: 'exemptChannelIds', type: 'channels', label: 'Exempt channels' },
          ]}
        />
        <Alert tone="info" title="False positives">
          Exempt roles/channels and the allowed-domain list are the safety valves. If a member was punished by mistake, pardon the case on the Moderation page; pardoned
          cases do not count towards escalation.
        </Alert>
        <Requirements items={featureRequirements('antiraid', data.resources.botPermissions)} />
        <SettingsForm
          section="antiraid"
          feature="antiraid"
          title="Anti-raid & verification"
          description="Watches the join rate and flags suspicious new accounts. Lockdown denies Send Messages for @everyone and remembers what to restore."
          fields={[
            { key: 'joinThreshold', type: 'number', label: 'Joins that count as a raid', min: 3, max: 500 },
            { key: 'perSeconds', type: 'number', label: 'Within (seconds)', min: 5, max: 600 },
            { key: 'minAccountAgeDays', type: 'number', label: 'Flag accounts younger than (days)', min: 0, max: 365 },
            {
              key: 'action',
              type: 'select',
              label: 'When a raid is detected',
              options: [
                { value: 'alert', label: 'Alert staff only' },
                { value: 'lockdown', label: 'Alert and lock text channels' },
              ],
            },
            { key: 'alertChannelId', type: 'channel', label: 'Alert channel' },
            { key: 'verification.enabled', type: 'toggle', label: 'Verification gate', help: 'New members press a Verify button to get the verified role. Autoroles wait until then.' },
            { key: 'verification.verifiedRoleId', type: 'role', label: 'Verified role' },
            { key: 'verification.channelId', type: 'channel', label: 'Verification channel' },
          ]}
        />
      </div>
    </SettingsProvider>
  );
}
