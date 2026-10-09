import Link from 'next/link';
import { listAudit } from '@botcooks/database';
import { Badge, Card, EmptyState, PageHeader, Table, Td } from '@/components/ui';
import { server } from '@/lib/server/context';
import { requirePageAccess } from '@/lib/server/guild';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({ params, searchParams }: { params: Promise<{ guildId: string }>; searchParams: Promise<{ q?: string; before?: string }> }) {
  const { guildId } = await params;
  const { q, before } = await searchParams;
  await requirePageAccess(guildId, { type: 'audit.view' });
  const search = q?.slice(0, 100);
  const cursor = before ? Number(before) || undefined : undefined;
  const { items, nextCursor } = await listAudit(server().db, guildId, { limit: 50, ...(search ? { search } : {}), ...(cursor ? { before: cursor } : {}) });
  const base = `/dashboard/${guildId}/audit`;
  return (
    <>
      <PageHeader emoji="📜" title="Audit log" description="Everything BotCooks and dashboard users changed on this server. Discord’s own audit log covers changes made outside BotCooks." />
      <Card>
        <form method="get" action={base} className="mb-4 flex gap-2">
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" name="q" defaultValue={search ?? ''} placeholder="Search actions, targets or user IDs" className="w-full max-w-md rounded-lg border border-coal-600 bg-coal-850 px-3 py-1.5 text-sm" />
          <button type="submit" className="rounded-lg bg-coal-800 px-3 py-1.5 text-sm hover:bg-coal-700">Search</button>
        </form>
        {items.length === 0 ? (
          <EmptyState title="No entries">{search ? 'Nothing matches that search.' : 'Activity will appear here.'}</EmptyState>
        ) : (
          <Table head={['When (UTC)', 'Action', 'Actor', 'Target', 'Details']} caption="Audit log">
            {items.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">{a.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td><span className="font-mono text-xs">{a.action}</span></Td>
                <Td>{a.actorType === 'user' ? <span className="font-mono text-xs">{a.actorId}</span> : <Badge>{a.actorType}</Badge>}</Td>
                <Td className="max-w-40 truncate font-mono text-xs">{a.target ?? '—'}</Td>
                <Td>
                  {a.details ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-coal-400">view</summary>
                      <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-coal-950 p-2 text-[11px]">{JSON.stringify(a.details, null, 2)}</pre>
                    </details>
                  ) : '—'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <nav aria-label="Pagination" className="mt-3 flex gap-3 text-sm">
          {cursor ? <Link className="text-ember-300 hover:underline" href={`${base}${search ? `?q=${encodeURIComponent(search)}` : ''}`}>← Newest</Link> : null}
          {nextCursor ? <Link className="text-ember-300 hover:underline" href={`${base}?${new URLSearchParams({ ...(search ? { q: search } : {}), before: String(nextCursor) })}`}>Older →</Link> : null}
        </nav>
      </Card>
    </>
  );
}
