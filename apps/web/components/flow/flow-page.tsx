import Link from 'next/link';
import type { Graph } from '@botcooks/workflows/graph';
import { Badge, Card, CardTitle, cx } from '../ui';
import type { ChannelOption, RoleOption } from '../settings';
import { FlowEditor } from './flow-editor';
import { starterGraph } from './node-meta';

/** Shared layout for the command and event builders: list on the left, editor on the right. */
export function FlowPage({
  kind,
  guildId,
  items,
  selectedId,
  roles,
  channels,
}: {
  kind: 'command' | 'event';
  guildId: string;
  items: Array<{ id: string; name: string; enabled: boolean; graph: unknown; subtitle: string }>;
  selectedId: string | null;
  roles: RoleOption[];
  channels: ChannelOption[];
}) {
  const base = `/dashboard/${guildId}/${kind === 'command' ? 'commands' : 'events'}`;
  const selected = selectedId ? items.find((i) => i.id === selectedId) : undefined;
  const item = selected
    ? { id: selected.id, name: selected.name, enabled: selected.enabled, graph: selected.graph as Graph }
    : { id: null, name: kind === 'command' ? '' : 'New workflow', enabled: false, graph: starterGraph(kind) };
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <Card className="h-fit">
        <CardTitle actions={<Link href={base} className="text-sm text-ember-300 hover:underline">+ New</Link>}>{kind === 'command' ? 'Commands' : 'Workflows'}</CardTitle>
        {items.length === 0 ? (
          <p className="text-sm text-coal-400">None yet. The editor starts with an example.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`${base}?id=${i.id}`} aria-current={i.id === selectedId ? 'page' : undefined} className={cx('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm', i.id === selectedId ? 'bg-ember-500/15 text-ember-200' : 'hover:bg-coal-800')}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{kind === 'command' ? `/${i.name}` : i.name}</span>
                    <span className="block truncate text-xs text-coal-500">{i.subtitle}</span>
                  </span>
                  <Badge tone={i.enabled ? 'ok' : 'neutral'}>{i.enabled ? 'on' : 'off'}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FlowEditor kind={kind} guildId={guildId} item={item} roles={roles} channels={channels} />
    </div>
  );
}
