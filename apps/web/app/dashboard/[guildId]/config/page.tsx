import { can } from '@botcooks/security';
import { FEATURES } from '@botcooks/shared';
import { Badge, Card, PageHeader } from '@/components/ui';
import { FeatureSwitch, Requirements, SettingsProvider } from '@/components/settings';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Features' };

const statusTone = { implemented: 'ok', partial: 'warn', planned: 'neutral', blocked: 'danger' } as const;

export default async function ConfigPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const data = await loadSettingsPage(guildId, { type: 'view' });
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🧂" title="Features" description="Turn modules on or off for this server. Each one lists what it needs to work." />
      <ul className="grid gap-4 md:grid-cols-2">
        {FEATURES.map((f) => {
          const allowed = can(data.access, { type: 'configure', feature: f.key });
          return (
            <li key={f.key}>
              <Card className="h-full">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 font-semibold">
                      {f.label} <Badge tone={statusTone[f.status]}>{f.status}</Badge>
                    </h2>
                    <p className="mt-1 text-sm text-coal-400">{f.description}</p>
                    {f.statusNote ? <p className="mt-1 text-xs text-coal-500">{f.statusNote}</p> : null}
                  </div>
                  <FeatureSwitch feature={f.key} label={f.label} disabled={!allowed || (f.status === 'blocked' && !data.settings.features[f.key])} />
                </div>
                <Requirements items={featureRequirements(f.key, data.resources.botPermissions)} />
                {!allowed ? <p className="mt-2 text-xs text-coal-500">You do not have access to change this feature.</p> : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </SettingsProvider>
  );
}
