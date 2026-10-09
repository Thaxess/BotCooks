import { listDelegations } from '@botcooks/database';
import { DELEGABLE_SCOPES } from '@botcooks/security';
import { FEATURES } from '@botcooks/shared';
import { Alert, PageHeader } from '@/components/ui';
import { DelegationEditor } from '@/components/delegation-editor';
import { SettingsForm, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Administrator settings' };

const EXTRA_SCOPE_LABEL: Record<string, string> = { audit: 'View audit log', backups: 'Backups & restore', 'builder.apply': 'Apply builder plans (additive, no elevation)' };

export default async function AdminPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'admin.settings' });
  const delegations = await listDelegations(server().db, guildId);
  const isOwner = data.user.id === data.ownerId;
  const scopes = DELEGABLE_SCOPES.map((s) => ({ key: s, label: FEATURES.find((f) => f.key === s)?.label ?? EXTRA_SCOPE_LABEL[s] ?? s }));
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🔑" title="Administrator settings" description="Only the server owner and members with Manage Server can see this page." />
      <div className="flex flex-col gap-6">
        <DelegationEditor guildId={guildId} roles={data.roles} scopes={scopes} initial={delegations.map((d) => ({ roleId: d.roleId, scopes: d.scopes }))} />

        {isOwner ? (
          <SettingsForm
            section="builder"
            title="Builder safety (owner only)"
            description="Replace mode deletes channels and roles that are not in a plan. Even when allowed, it needs the owner, explicit acknowledgement and typing the server name."
            fields={[
              { key: 'allowWipe', type: 'toggle', label: 'Allow replace mode (destructive)' },
              { key: 'defaultMode', type: 'select', label: 'Default preview mode', options: [{ value: 'additive', label: 'Add only' }, { value: 'update', label: 'Add and update existing' }] },
            ]}
          />
        ) : (
          <Alert tone="info">Builder safety settings (including replace mode) can only be changed by the server owner.</Alert>
        )}

        <SettingsForm
          section="logging"
          feature="logging"
          title="Logging & retention"
          description="Message logs need the privileged Message Content intent. With redaction on, message text never appears in logs."
          fields={[
            { key: 'modLogChannelId', type: 'channel', label: 'Moderation log' },
            { key: 'memberLogChannelId', type: 'channel', label: 'Member joins/leaves' },
            { key: 'serverLogChannelId', type: 'channel', label: 'Role & channel changes' },
            { key: 'messageLogChannelId', type: 'channel', label: 'Message log' },
            { key: 'logMessageDeletes', type: 'toggle', label: 'Log deleted messages' },
            { key: 'logMessageEdits', type: 'toggle', label: 'Log edited messages' },
            { key: 'redactMessageContent', type: 'toggle', label: 'Redact message content', help: 'Recommended. Logs show who and where, not what.' },
            { key: 'retentionDays', type: 'number', label: 'Keep BotCooks audit entries (days)', min: 1, max: 365 },
          ]}
        />
      </div>
    </SettingsProvider>
  );
}
