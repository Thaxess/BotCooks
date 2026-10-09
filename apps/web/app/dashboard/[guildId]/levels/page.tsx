import Link from 'next/link';
import { leaderboard } from '@botcooks/database';
import { levelFromXp } from '@botcooks/shared';
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { Requirements, SettingsForm, SettingsProvider } from '@/components/settings';
import { server } from '@/lib/server/context';
import { featureRequirements, loadSettingsPage } from '@/lib/server/page-data';

export const metadata = { title: 'Levels & rewards' };

export default async function LevelsPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { guildId } = await params;
  const page = Math.max(0, Number((await searchParams).page) || 0);
  const data = await loadSettingsPage(guildId, { type: 'configure', feature: 'levels' });
  const rows = await leaderboard(server().db, guildId, 26, page * 25);
  const base = `/dashboard/${guildId}/levels`;
  return (
    <SettingsProvider guildId={guildId} settings={data.settings} version={data.version} channels={data.channels} roles={data.roles}>
      <PageHeader emoji="⭐" title="Levels & rewards" description="Members earn random XP per message (with a cooldown). Commands: /rank, /leaderboard." />
      <div className="flex flex-col gap-6">
        <Requirements items={featureRequirements('levels', data.resources.botPermissions)} />
        <SettingsForm
          section="levels"
          feature="levels"
          title="Settings"
          fields={[
            { key: 'xpMin', type: 'number', label: 'Min XP per message', min: 1, max: 500 },
            { key: 'xpMax', type: 'number', label: 'Max XP per message', min: 1, max: 1000 },
            { key: 'cooldownSeconds', type: 'number', label: 'Cooldown (seconds)', min: 0, max: 3600 },
            {
              key: 'announce',
              type: 'select',
              label: 'Level-up announcements',
              options: [
                { value: 'current', label: 'In the same channel' },
                { value: 'channel', label: 'In a specific channel' },
                { value: 'dm', label: 'By DM' },
                { value: 'off', label: 'Off' },
              ],
            },
            { key: 'announceChannelId', type: 'channel', label: 'Announcement channel' },
            { key: 'message', type: 'textarea', label: 'Level-up message', help: '{user} {username} {level} {server}' },
            { key: 'stackRewards', type: 'toggle', label: 'Keep earlier reward roles', help: 'Off: members only keep their highest reward role.' },
            {
              key: 'rewards',
              type: 'objectList',
              label: 'Role rewards',
              help: 'Reward roles must be below BotCooks and must not carry moderation/management permissions.',
              newItem: { level: 5 },
              columns: [
                { key: 'level', label: 'At level', type: 'number', min: 1, max: 1000 },
                { key: 'roleId', label: 'Role', type: 'role' },
              ],
            },
            { key: 'noXpRoleIds', type: 'roles', label: 'Roles that earn no XP' },
            { key: 'noXpChannelIds', type: 'channels', label: 'Channels that earn no XP' },
          ]}
        />
        <Card>
          <CardTitle>Leaderboard</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title="Nobody has XP yet">XP appears once members start chatting with levels enabled.</EmptyState>
          ) : (
            <Table head={['Rank', 'Member', 'Level', 'XP', 'Messages']} caption="Leaderboard">
              {rows.slice(0, 25).map((r, i) => (
                <tr key={r.userId}>
                  <Td>{page * 25 + i + 1}</Td>
                  <Td className="font-mono text-xs">{r.userId}</Td>
                  <Td>{levelFromXp(r.xp).level}</Td>
                  <Td>{r.xp.toLocaleString()}</Td>
                  <Td>{r.messages.toLocaleString()}</Td>
                </tr>
              ))}
            </Table>
          )}
          <nav aria-label="Pagination" className="mt-3 flex gap-3 text-sm">
            {page > 0 ? <Link className="text-ember-300 hover:underline" href={`${base}?page=${page - 1}`}>← Previous</Link> : null}
            {rows.length > 25 ? <Link className="text-ember-300 hover:underline" href={`${base}?page=${page + 1}`}>Next →</Link> : null}
          </nav>
        </Card>
      </div>
    </SettingsProvider>
  );
}
