import Link from 'next/link';
import type { ReactNode } from 'react';
import { can } from '@botcooks/security';
import { Badge } from '@/components/ui';
import { NavLink } from '@/components/nav-link';
import { UserMenu } from '@/components/user-menu';
import { guildResources, requirePageAccess } from '@/lib/server/guild';
import { NAV_GROUPS } from '@/lib/nav';

export default async function GuildLayout({ children, params }: { children: ReactNode; params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const { access, user } = await requirePageAccess(guildId);
  const guild = await guildResources(guildId);
  const base = `/dashboard/${guildId}`;
  const tierLabel = { owner: 'Owner', admin: 'Admin', delegate: 'Delegated', none: '' }[access.tier];

  const nav = (
    <nav aria-label="Server sections" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => can(access, i.action));
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-coal-500">{group.title}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.href}>
                  <NavLink href={`${base}${i.href}`} emoji={i.emoji} label={i.label} exact={i.href === ''} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-coal-800 bg-coal-900 lg:sticky lg:top-0 lg:h-dvh lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 p-4">
          <Link href="/dashboard" className="min-w-0" title="Switch server">
            <span className="block text-xs text-coal-500">🍳 BotCooks</span>
            <span className="block truncate font-semibold">{guild.name}</span>
          </Link>
          <Badge tone={access.tier === 'delegate' ? 'info' : 'ember'}>{tierLabel}</Badge>
        </div>
        {/* Mobile: collapsible menu without JavaScript. */}
        <details className="px-3 pb-3 lg:hidden">
          <summary className="cursor-pointer rounded-lg bg-coal-800 px-3 py-2 text-sm font-medium">Menu</summary>
          <div className="mt-3">{nav}</div>
        </details>
        <div className="hidden px-3 pb-6 lg:block">{nav}</div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex justify-end border-b border-coal-800 px-5 py-3">
          <UserMenu name={user.globalName ?? user.username} />
        </div>
        <main id="main" className="mx-auto max-w-6xl px-5 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
