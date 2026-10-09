import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getGuildsByIds, listDelegations } from '@botcooks/database';
import { hasPermission } from '@botcooks/shared';
import { Alert, Badge, EmptyState, PageHeader } from '@/components/ui';
import { server } from '@/lib/server/context';
import { fetchUserGuilds, inviteUrl } from '@/lib/server/discord-oauth';
import { currentUser, userAccessToken } from '@/lib/server/session';
import { UserMenu } from '@/components/user-menu';

export const metadata = { title: 'Choose a server' };

function iconUrl(id: string, icon: string | null) {
  return icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=96` : null;
}

export default async function ServerPicker({ searchParams }: { searchParams: Promise<{ missing?: string; denied?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login?next=/dashboard');
  const { missing, denied } = await searchParams;
  const token = await userAccessToken(user.sessionId);
  const guilds = token ? await fetchUserGuilds(user.sessionId, token) : null;
  if (!guilds) redirect('/login?error=token_exchange');

  const known = new Map((await getGuildsByIds(server().db, guilds.map((g) => g.id))).map((g) => [g.id, g]));
  const managed = guilds.filter((g) => g.owner || hasPermission(g.permissions, 'ManageGuild'));
  // Servers where the user has no Manage Server but BotCooks delegations exist: shown, access re-checked on open.
  const delegatedCandidates: typeof guilds = [];
  for (const g of guilds) {
    if (managed.includes(g) || !known.get(g.id)?.botPresent) continue;
    if ((await listDelegations(server().db, g.id)).length) delegatedCandidates.push(g);
  }
  const withBot = [...managed, ...delegatedCandidates].filter((g) => known.get(g.id)?.botPresent);
  const withoutBot = managed.filter((g) => !known.get(g.id)?.botPresent);

  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span aria-hidden>🍳</span> BotCooks
        </Link>
        <UserMenu name={user.globalName ?? user.username} />
      </div>
      <PageHeader title="Choose a server" description="Servers you manage, plus servers where you have been given delegated BotCooks access." />
      {missing ? <div className="mb-4"><Alert tone="warn" title="BotCooks is not in that server">Invite it first using the list below.</Alert></div> : null}
      {denied ? <div className="mb-4"><Alert tone="danger" title="No access">You do not have permission to manage that server with BotCooks.</Alert></div> : null}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-coal-400">Ready to cook</h2>
      {withBot.length === 0 ? (
        <EmptyState title="No servers with BotCooks yet">Invite BotCooks to one of your servers to get started.</EmptyState>
      ) : (
        <ul className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withBot.map((g) => (
            <li key={g.id}>
              <Link href={`/dashboard/${g.id}`} className="flex items-center gap-3 rounded-xl border border-coal-700 bg-coal-900 p-4 hover:border-ember-500">
                <GuildIcon id={g.id} name={g.name} icon={g.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="text-xs text-coal-400">{g.owner ? 'Owner' : managed.includes(g) ? 'Manager' : 'Delegated access'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {withoutBot.length > 0 ? (
        <>
          <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-coal-400">Invite BotCooks</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {withoutBot.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-xl border border-coal-800 bg-coal-900/60 p-4">
                <GuildIcon id={g.id} name={g.name} icon={g.icon} />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <a href={inviteUrl(g.id)} className="rounded-lg border border-coal-600 px-3 py-1.5 text-sm hover:bg-coal-800">
                  Invite
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-coal-500">
            <Badge>Note</Badge> The invite asks for specific permissions (never Administrator). You can untick any you do not want; features that need them will tell you.
          </p>
        </>
      ) : null}
    </main>
  );
}

function GuildIcon({ id, name, icon }: { id: string; name: string; icon: string | null }) {
  const url = iconUrl(id, icon);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
  ) : (
    <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-coal-700 font-bold">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
