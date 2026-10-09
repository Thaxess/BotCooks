import { getDailyStats } from '@botcooks/database';
import { Alert, Card, CardTitle, EmptyState, PageHeader, Stat } from '@/components/ui';
import { server } from '@/lib/server/context';
import { requirePageAccess } from '@/lib/server/guild';

export const metadata = { title: 'Analytics' };

type Row = Awaited<ReturnType<typeof getDailyStats>>[number];

/** Minimal accessible bar chart (SVG + data table fallback). */
function Bars({ rows, field, label, color }: { rows: Row[]; field: 'joins' | 'leaves' | 'messages' | 'modActions'; label: string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r[field]));
  const w = 100 / Math.max(rows.length, 1);
  return (
    <figure>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={`${label} per day`}>
        {rows.map((r, i) => {
          const h = (r[field] / max) * 38;
          return <rect key={r.day} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} fill={color} rx="0.5"><title>{`${r.day}: ${r[field]}`}</title></rect>;
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-coal-500">
        <span>{rows[0]?.day}</span>
        <span>{rows.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

export default async function AnalyticsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requirePageAccess(guildId, { type: 'configure', feature: 'analytics' });
  const rows = await getDailyStats(server().db, guildId, 30);
  const sum = (f: 'joins' | 'leaves' | 'messages' | 'modActions' | 'automodActions') => rows.reduce((t, r) => t + r[f], 0);
  return (
    <>
      <PageHeader emoji="📈" title="Analytics" description="Last 30 days, from events BotCooks has seen. Counts start when BotCooks joined and only include what its intents can observe." />
      <div className="mb-6"><Alert tone="info">This is a partial feature: daily counts only. Per-channel and retention analytics are not implemented yet.</Alert></div>
      {rows.length === 0 ? (
        <EmptyState title="No data yet">Numbers appear as members join, leave and chat.</EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Joins" value={sum('joins')} />
            <Stat label="Leaves" value={sum('leaves')} />
            <Stat label="Messages" value={sum('messages')} />
            <Stat label="Moderation" value={sum('modActions') + sum('automodActions')} hint={`${sum('automodActions')} by auto-mod`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><CardTitle>Joins per day</CardTitle><Bars rows={rows} field="joins" label="Joins" color="#4ade80" /></Card>
            <Card><CardTitle>Leaves per day</CardTitle><Bars rows={rows} field="leaves" label="Leaves" color="#f87171" /></Card>
            <Card><CardTitle>Messages per day</CardTitle><Bars rows={rows} field="messages" label="Messages" color="#f97316" /></Card>
            <Card><CardTitle>Moderator actions per day</CardTitle><Bars rows={rows} field="modActions" label="Moderator actions" color="#38bdf8" /></Card>
          </div>
        </>
      )}
    </>
  );
}
