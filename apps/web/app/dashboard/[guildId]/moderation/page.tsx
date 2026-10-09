import Link from 'next/link';
import { listCases, type CaseType } from '@botcooks/database';
import { isSnowflake } from '@botcooks/shared';
import { Badge, Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { CaseActions } from '@/components/case-actions';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Moderation' };

const TYPES: CaseType[] = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'note', 'purge', 'automod'];

export default async function ModerationPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ user?: string; type?: string; before?: string; appeals?: string }> }) {
  const { guildId } = await params;
  const q = await searchParams;
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'moderation' });
  const type = TYPES.includes(q.type as CaseType) ? (q.type as CaseType) : undefined;
  const userId = q.user && isSnowflake(q.user) ? q.user : undefined;
  const before = q.before ? Number(q.before) || undefined : undefined;
  const { items, nextCursor } = await listCases(server().db, guildId, {
    ...(userId ? { userId } : {}),
    ...(type ? { type } : {}),
    ...(before ? { before } : {}),
    appealsOnly: q.appeals === '1',
    limit: 25,
  });
  const base = `/dashboard/${guildId}/moderation`;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ user: userId, type, appeals: q.appeals, ...extra })) if (v) p.set(k, v);
    return `${base}?${p}`;
  };

  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="🛡️" title="Moderation & cases" description="Commands: /warn /timeout /kick /ban /unban /purge /note /case /lockdown. Every action is a numbered case." />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('moderation', data.resources.botPermissions)} />
        <SettingsForm
          section="moderation"
          feature="moderation"
          title="Settings"
          fields={[
            { key: 'modLogChannelId', type: 'channel', label: 'Moderation log channel' },
            { key: 'dmOnAction', type: 'toggle', label: 'DM members when actioned' },
            { key: 'requireReason', type: 'toggle', label: 'Require a reason' },
            { key: 'appealsEnabled', type: 'toggle', label: 'Allow appeals', help: 'Members get an Appeal button in the DM and can use /appeal.' },
            { key: 'appealsChannelId', type: 'channel', label: 'Appeals channel', help: 'Defaults to the moderation log.' },
            { key: 'warningExpiryDays', type: 'number', label: 'Warnings expire after (days)', min: 0, max: 3650, help: '0 = never. Expired warnings do not count towards escalation.' },
            { key: 'maxPurge', type: 'number', label: 'Max messages per /purge', min: 1, max: 1000 },
            {
              key: 'escalation',
              type: 'objectList',
              label: 'Escalation rules',
              help: 'Applied automatically when a member reaches the number of active warnings.',
              newItem: { warnings: 3, action: 'timeout', durationMinutes: 60 },
              max: 10,
              columns: [
                { key: 'warnings', label: 'At warnings', type: 'number', min: 1, max: 50 },
                { key: 'action', label: 'Action', type: 'select', options: [{ value: 'timeout', label: 'Timeout' }, { value: 'kick', label: 'Kick' }, { value: 'ban', label: 'Ban' }] },
                { key: 'durationMinutes', label: 'Timeout minutes', type: 'number', min: 1, max: 40320 },
              ],
            },
          ]}
        />

        <Card>
          <CardTitle description="Search by member ID, filter by type, or show open appeals.">Cases</CardTitle>
          <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="user" className="mb-1 block text-xs text-coal-400">Member ID</label>
              <input id="user" name="user" defaultValue={userId ?? ''} inputMode="numeric" className="rounded-lg border border-coal-600 bg-coal-850 px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label htmlFor="type" className="mb-1 block text-xs text-coal-400">Type</label>
              <select id="type" name="type" defaultValue={type ?? ''} className="rounded-lg border border-coal-600 bg-coal-850 px-3 py-1.5 text-sm">
                <option value="">All</option>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="appeals" value="1" defaultChecked={q.appeals === '1'} className="accent-ember-500" /> Open appeals only
            </label>
            <button type="submit" className="rounded-lg bg-coal-800 px-3 py-1.5 text-sm hover:bg-coal-700">Filter</button>
          </form>
          {items.length === 0 ? (
            <EmptyState title="No cases">Nothing matches these filters.</EmptyState>
          ) : (
            <Table head={['#', 'Type', 'Member', 'Moderator', 'Reason', 'When', '']} caption="Moderation cases">
              {items.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono">{c.caseNumber}</Td>
                  <Td>
                    <Badge tone={c.type === 'ban' || c.type === 'kick' ? 'danger' : c.type === 'note' ? 'neutral' : 'warn'}>{c.type}</Badge>
                    {!c.active ? <span className="ml-1 text-xs text-coal-500">(inactive)</span> : null}
                    {c.appealStatus !== 'none' ? <span className="ml-1"><Badge tone="info">appeal: {c.appealStatus}</Badge></span> : null}
                  </Td>
                  <Td className="font-mono text-xs">{c.userId}</Td>
                  <Td className="font-mono text-xs">{c.moderatorId}</Td>
                  <Td className="max-w-xs">
                    <p className="line-clamp-3">{c.reason ?? '—'}</p>
                    {c.appealText ? <p className="mt-1 text-xs text-sky-300">Appeal: {c.appealText}</p> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-coal-400">{c.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
                  <Td><CaseActions guildId={guildId} caseNumber={c.caseNumber} active={c.active} appealOpen={c.appealStatus === 'open'} /></Td>
                </tr>
              ))}
            </Table>
          )}
          <nav aria-label="Pagination" className="mt-3 flex gap-3 text-sm">
            {before ? <Link href={qs({ before: undefined })} className="text-ember-300 hover:underline">← Newest</Link> : null}
            {nextCursor ? <Link href={qs({ before: String(nextCursor) })} className="text-ember-300 hover:underline">Older →</Link> : null}
          </nav>
        </Card>
      </div>
    </SettingsProvider>
  );
}
