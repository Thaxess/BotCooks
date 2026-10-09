import Link from 'next/link';
import { getDailyStats, getSettings, listAudit, listBuildSessions, listExecutions } from '@botcooks/database';
import { can } from '@botcooks/security';
import { FEATURES, hasPermission, permissionLabel } from '@botcooks/shared';
import { Alert, Badge, Card, CardTitle, PageHeader, Stat } from '@/components/ui';
import { server } from '@/lib/server/context';
import { BOT_INVITE_PERMISSIONS, inviteUrl } from '@/lib/server/discord-oauth';
import { guildResources, requirePageAccess } from '@/lib/server/guild';

export const metadata = { title: 'Overview' };

export default async function Overview({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ denied?: string }> }) {
  const { guildId } = await params;
  const { denied } = await searchParams;
  const { access } = await requirePageAccess(guildId);
  const db = server().db;
  const [resources, { settings }, stats, builds, executions] = await Promise.all([
    guildResources(guildId),
    getSettings(db, guildId),
    getDailyStats(db, guildId, 7),
    listBuildSessions(db, guildId, 5),
    listExecutions(db, guildId, 5),
  ]);
  const audit = can(access, { type: 'audit.view' }) ? (await listAudit(db, guildId, { limit: 8 })).items : null;

  const missingPerms = BOT_INVITE_PERMISSIONS.filter((p) => !hasPermission(resources.botPermissions, p));
  const rolesAboveBot = resources.roles.filter((r) => r.position > resources.botTopPosition && !r.managed).length;
  const totals = stats.reduce((t, d) => ({ joins: t.joins + d.joins, leaves: t.leaves + d.leaves, messages: t.messages + d.messages, mod: t.mod + d.modActions + d.automodActions }), { joins: 0, leaves: 0, messages: 0, mod: 0 });
  const base = `/dashboard/${guildId}`;

  const checklist = [
    { done: Boolean(server().provider), label: 'AI provider configured (AI_API_KEY)', href: null },
    { done: missingPerms.length === 0, label: 'BotCooks has every permission it asks for', href: null },
    { done: builds.some((b) => b.status === 'applied'), label: 'Build or import a server layout', href: `${base}/builder` },
    { done: Boolean(settings.moderation.modLogChannelId), label: 'Choose a moderation log channel', href: `${base}/moderation` },
    { done: settings.features.automod || settings.features.antiraid, label: 'Turn on auto-mod or anti-raid', href: `${base}/security` },
    { done: settings.features.welcome && Boolean(settings.welcome.channelId), label: 'Set up welcome messages', href: `${base}/welcome` },
  ];
  const done = checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader emoji="🏠" title={resources.name} description="Health, setup progress and recent activity for this server." />
      {denied ? (
        <div className="mb-4">
          <Alert tone="danger" title="You do not have access to that page">Ask the server owner to delegate it to one of your roles.</Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Joins (7 days)" value={totals.joins} hint={`${totals.leaves} left`} />
        <Stat label="Messages (7 days)" value={totals.messages} />
        <Stat label="Moderation actions" value={totals.mod} hint="manual + auto-mod, 7 days" />
        <Stat label="Features on" value={`${FEATURES.filter((f) => settings.features[f.key]).length}/${FEATURES.length}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle description={`${done} of ${checklist.length} done`}>Setup checklist</CardTitle>
          <ul className="flex flex-col gap-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-3 text-sm">
                <span aria-hidden className={c.done ? 'text-basil-400' : 'text-coal-500'}>{c.done ? '●' : '○'}</span>
                <span className="sr-only">{c.done ? 'Done:' : 'To do:'}</span>
                {c.href && !c.done ? <Link className="underline decoration-coal-600 hover:text-ember-300" href={c.href}>{c.label}</Link> : <span className={c.done ? 'text-coal-400' : ''}>{c.label}</span>}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle description="What BotCooks can and cannot do right now.">Permission diagnostics</CardTitle>
          {missingPerms.length === 0 ? (
            <Alert tone="ok">All requested permissions are granted.</Alert>
          ) : (
            <Alert tone="warn" title={`Missing ${missingPerms.length} permission(s)`}>
              {missingPerms.map((p) => permissionLabel(p)).join(', ')}.{' '}
              <a className="underline" href={inviteUrl(guildId)}>Re-authorise BotCooks</a> or grant them to its role.
            </Alert>
          )}
          <div className="mt-3">
            {rolesAboveBot > 0 ? (
              <Alert tone="warn" title={`${rolesAboveBot} role(s) are above BotCooks`}>
                BotCooks cannot assign, edit or moderate members with roles above its own. Drag the BotCooks role higher in Server Settings → Roles if needed.
              </Alert>
            ) : (
              <Alert tone="ok">BotCooks’ role is above all regular roles.</Alert>
            )}
          </div>
          <p className="mt-3 text-xs text-coal-500">
            {resources.features.includes('COMMUNITY') ? 'Community is enabled: announcement, forum and stage channels are available.' : 'Community is not enabled: announcement, forum and stage channels will be created as text/voice.'}
          </p>
        </Card>

        <Card>
          <CardTitle actions={<Link href={`${base}/builder`} className="text-sm text-ember-300 hover:underline">Open builder</Link>}>Recent builds</CardTitle>
          {builds.length === 0 ? (
            <p className="text-sm text-coal-400">No builds yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {builds.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3">
                  <Link href={`${base}/builder?session=${b.id}`} className="truncate hover:text-ember-300">{b.prompt}</Link>
                  <Badge tone={b.status === 'applied' ? 'ok' : b.status === 'failed' ? 'danger' : 'neutral'}>{b.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          {executions.length ? (
            <p className="mt-3 text-xs text-coal-500">
              Last change: {executions[0]!.kind} · {executions[0]!.status.replace(/_/g, ' ')} · <Link className="underline" href={`${base}/backups`}>details</Link>
            </p>
          ) : null}
        </Card>

        {audit ? (
          <Card>
            <CardTitle actions={<Link href={`${base}/audit`} className="text-sm text-ember-300 hover:underline">Full log</Link>}>Recent activity</CardTitle>
            {audit.length === 0 ? (
              <p className="text-sm text-coal-400">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs text-coal-300">{a.action}</span>
                    <time className="shrink-0 text-xs text-coal-500" dateTime={a.createdAt.toISOString()}>{a.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
