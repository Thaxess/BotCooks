'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NODE_TYPES, validateGraph, type Graph, type NodeType } from '@botcooks/workflows/graph';
import { api } from '@/lib/client/api';
import { channelLabel, MultiPicker, type ChannelOption, type RoleOption } from '../settings';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, Textarea, Toggle, cx } from '../ui';
import { GROUP_COLOR, NODE_META } from './node-meta';

type BCData = { kind: NodeType; fields: Record<string, unknown> };
type BCNode = Node<BCData, 'bc'>;

interface Names {
  role: (id: string) => string;
  channel: (id: string) => string;
}
const NamesContext = createContext<Names>({ role: (id) => id, channel: (id) => id });

function BCNodeView({ data, selected }: NodeProps<BCNode>) {
  const names = useContext(NamesContext);
  const meta = NODE_META[data.kind];
  const color = GROUP_COLOR[meta.group];
  return (
    <div className={cx('min-w-44 max-w-60 rounded-lg border bg-coal-800 px-3 py-2 text-left shadow', selected ? 'border-ember-400 ring-2 ring-ember-500/40' : 'border-coal-600')}>
      {meta.group !== 'trigger' ? <Handle type="target" position={Position.Top} /> : null}
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
        {meta.group}
      </p>
      <p className="text-sm font-semibold text-coal-100">
        <span aria-hidden>{meta.emoji}</span> {meta.label}
      </p>
      <p className="truncate text-xs text-coal-400">{meta.summary(data.fields, names)}</p>
      {meta.group === 'condition' ? (
        <>
          <Handle type="source" id="true" position={Position.Bottom} style={{ left: '28%', background: '#4ade80' }} />
          <Handle type="source" id="false" position={Position.Bottom} style={{ left: '72%', background: '#f87171' }} />
          <div className="mt-1 flex justify-between px-2 text-[10px] text-coal-400">
            <span>yes</span>
            <span>no</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}

const nodeTypes = { bc: BCNodeView };

function toFlow(graph: Graph): { nodes: BCNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: 'bc', position: n.position, data: { kind: n.type, fields: n.data as Record<string, unknown> } })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle, label: e.sourceHandle === 'true' ? 'yes' : 'no' } : {}),
    })),
  };
}

function toGraph(nodes: BCNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.kind, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data.fields })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle === 'true' || e.sourceHandle === 'false' ? { sourceHandle: e.sourceHandle } : {}) })),
  };
}

export interface FlowItem {
  id: string | null;
  name: string;
  enabled: boolean;
  graph: Graph;
}

export function FlowEditor(props: { kind: 'command' | 'event'; guildId: string; item: FlowItem; roles: RoleOption[]; channels: ChannelOption[] }) {
  return (
    <ReactFlowProvider>
      <EditorInner key={props.item.id ?? 'new'} {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ kind, guildId, item, roles, channels }: { kind: 'command' | 'event'; guildId: string; item: FlowItem; roles: RoleOption[]; channels: ChannelOption[] }) {
  const router = useRouter();
  const initial = useMemo(() => toFlow(item.graph), [item.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<BCNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(item.name);
  const [enabled, setEnabled] = useState(item.enabled);
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const names = useMemo<Names>(
    () => ({ role: (id) => roles.find((r) => r.id === id)?.name ?? 'unknown role', channel: (id) => channels.find((c) => c.id === id)?.name ?? 'unknown channel' }),
    [roles, channels],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      // A condition output may lead to several actions, but each yes/no pair stays labelled.
      setEdges((eds) => addEdge({ ...c, id: `e-${crypto.randomUUID().slice(0, 8)}`, ...(c.sourceHandle ? { label: c.sourceHandle === 'true' ? 'yes' : 'no' } : {}) }, eds));
    },
    [setEdges],
  );

  const addNode = (kindToAdd: NodeType) => {
    const id = `${kindToAdd.split('.')[1]}-${crypto.randomUUID().slice(0, 6)}`;
    const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
    setNodes((ns) => [...ns, { id, type: 'bc', position: { x: 120 + (ns.length % 3) * 40, y: maxY + 140 }, data: { kind: kindToAdd, fields: structuredClone(NODE_META[kindToAdd].defaults) } }]);
    setSelectedId(id);
  };

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const updateField = (key: string, value: unknown) => {
    if (!selected) return;
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, fields: { ...n.data.fields, [key]: value } } } : n)));
  };
  const removeSelected = () => {
    if (!selected || NODE_META[selected.data.kind].group === 'trigger') return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelectedId(null);
  };

  const graph = toGraph(nodes, edges);
  const validation = validateGraph(graph, kind);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const base = kind === 'command' ? `/api/guilds/${guildId}/commands` : `/api/guilds/${guildId}/events`;
      const body = kind === 'command' ? { graph, enabled } : { name, graph, enabled };
      const res = await api<{ command?: { id: string }; workflow?: { id: string } }>(item.id ? `${base}/${item.id}` : base, { method: item.id ? 'PUT' : 'POST', body });
      setStatus({ tone: 'ok', text: kind === 'command' ? 'Saved. Discord registration happens in the background (usually a few seconds).' : 'Saved.' });
      const newId = res.command?.id ?? res.workflow?.id;
      router.replace(`/dashboard/${guildId}/${kind === 'command' ? 'commands' : 'events'}?id=${newId}`);
      router.refresh();
    } catch (e) {
      setStatus({ tone: 'danger', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!item.id || !window.confirm('Delete this permanently?')) return;
    const base = kind === 'command' ? `/api/guilds/${guildId}/commands` : `/api/guilds/${guildId}/events`;
    await api(`${base}/${item.id}`, { method: 'DELETE' }).catch((e) => setStatus({ tone: 'danger', text: (e as Error).message }));
    router.replace(`/dashboard/${guildId}/${kind === 'command' ? 'commands' : 'events'}`);
    router.refresh();
  };

  const palette = NODE_TYPES.filter((t) => !t.startsWith('trigger.') && !(kind === 'event' && t === 'action.reply' && (graph.nodes.find((n) => n.type === 'trigger.event')?.data as { event?: string } | undefined)?.event !== 'messageCreate'));

  return (
    <NamesContext.Provider value={names}>
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3">
          <Card className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              {kind === 'event' ? (
                <div className="min-w-48 flex-1">
                  <Field label="Workflow name" htmlFor="wf-name"><Input id="wf-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />
                <span className="text-sm">{enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <Button onClick={() => void save()} disabled={saving || !validation.ok || (kind === 'event' && !name.trim())}>{saving ? 'Saving…' : 'Save'}</Button>
              {item.id ? <Button variant="ghost" onClick={() => void remove()}>Delete</Button> : null}
            </div>
            {status ? <div className="mt-3"><Alert tone={status.tone}>{status.text}</Alert></div> : null}
            {!validation.ok ? (
              <div className="mt-3">
                <Alert tone="warn" title="Fix before saving">
                  <ul className="list-disc pl-5">{validation.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </Alert>
              </div>
            ) : null}
          </Card>

          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Add blocks">
            {palette.map((t) => (
              <button key={t} type="button" onClick={() => addNode(t)} className="rounded-full border border-coal-600 bg-coal-850 px-3 py-1 text-xs hover:border-ember-500">
                <span aria-hidden>{NODE_META[t].emoji}</span> {NODE_META[t].label}
              </button>
            ))}
          </div>

          <div className="h-[34rem] overflow-hidden rounded-xl border border-coal-700" aria-label="Workflow canvas. Select a block to edit it in the panel.">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              isValidConnection={(c) => c.source !== c.target && !nodes.find((n) => n.id === c.target)?.data.kind.startsWith('trigger.')}
              colorMode="dark"
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
          <p className="text-xs text-coal-500">Drag from a block’s bottom dot to another block to connect them. Conditions have a green “yes” and red “no” output. Select a connection and press Delete to remove it.</p>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Block settings</CardTitle>
            {!selected ? (
              <p className="text-sm text-coal-400">Select a block on the canvas, or pick one from this list:</p>
            ) : (
              <Inspector node={selected} roles={roles} channels={channels} onChange={updateField} onRemove={removeSelected} />
            )}
            {!selected ? (
              <ul className="mt-2 flex flex-col gap-1">
                {nodes.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="w-full rounded px-2 py-1 text-left text-sm hover:bg-coal-800" onClick={() => setSelectedId(n.id)}>
                      {NODE_META[n.data.kind].emoji} {NODE_META[n.data.kind].label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <TestPanel guildId={guildId} graph={graph} roles={roles} valid={validation.ok} kind={kind} />
        </div>
      </div>
    </NamesContext.Provider>
  );
}

function Inspector({ node, roles, channels, onChange, onRemove }: { node: BCNode; roles: RoleOption[]; channels: ChannelOption[]; onChange: (k: string, v: unknown) => void; onRemove: () => void }) {
  const meta = NODE_META[node.data.kind];
  const f = node.data.fields;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold"><span aria-hidden>{meta.emoji}</span> {meta.label} <Badge>{meta.group}</Badge></p>
      {meta.fields.map((field) => {
        const id = `insp-${node.id}-${field.key}`;
        switch (field.kind) {
          case 'text':
            return <Field key={id} label={field.label} htmlFor={id}><Input id={id} maxLength={field.maxLength} placeholder={field.placeholder} value={(f[field.key] as string) ?? ''} onChange={(e) => onChange(field.key, e.target.value)} /></Field>;
          case 'textarea':
            return <Field key={id} label={field.label} htmlFor={id} help="Placeholders: {user} {username} {server} {option:name}"><Textarea id={id} maxLength={field.maxLength} value={(f[field.key] as string) ?? ''} onChange={(e) => onChange(field.key, e.target.value)} /></Field>;
          case 'number':
            return <Field key={id} label={field.label} htmlFor={id}><Input id={id} type="number" min={field.min} max={field.max} value={(f[field.key] as number) ?? ''} onChange={(e) => onChange(field.key, Number(e.target.value))} /></Field>;
          case 'bool':
            return (
              <div key={id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-coal-300">{field.label}</span>
                <Toggle label={field.label} checked={Boolean(f[field.key])} onChange={(v) => onChange(field.key, v)} />
              </div>
            );
          case 'role':
            return (
              <Field key={id} label={field.label} htmlFor={id}>
                <Select id={id} value={(f[field.key] as string) ?? ''} onChange={(e) => onChange(field.key, e.target.value || undefined)}>
                  <option value="">Choose a role</option>
                  {roles.filter((r) => !r.managed).map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                </Select>
              </Field>
            );
          case 'channel':
            return (
              <Field key={id} label={field.label} htmlFor={id}>
                <Select id={id} value={(f[field.key] as string) ?? ''} onChange={(e) => onChange(field.key, e.target.value || undefined)}>
                  <option value="">Choose a channel</option>
                  {channels.filter((c) => c.type === 0 || c.type === 5).map((c) => <option key={c.id} value={c.id}>{channelLabel(c, channels)}</option>)}
                </Select>
              </Field>
            );
          case 'event':
            return (
              <Field key={id} label={field.label} htmlFor={id}>
                <Select id={id} value={(f[field.key] as string) ?? 'memberJoin'} onChange={(e) => onChange(field.key, e.target.value)}>
                  <option value="memberJoin">A member joins</option>
                  <option value="memberLeave">A member leaves</option>
                  <option value="messageCreate">A message is sent (needs Message Content intent)</option>
                </Select>
              </Field>
            );
          case 'options': {
            const options = (f.options as Array<{ name: string; description: string; type: string; required: boolean }>) ?? [];
            const set = (next: typeof options) => onChange('options', next);
            return (
              <div key={id} className="flex flex-col gap-2">
                <p className="text-sm text-coal-300">{field.label}</p>
                {options.map((o, i) => (
                  <div key={i} className="flex flex-col gap-1 rounded border border-coal-700 p-2">
                    <Input aria-label="Option name" value={o.name} maxLength={32} onChange={(e) => set(options.map((x, j) => (j === i ? { ...x, name: e.target.value.toLowerCase() } : x)))} />
                    <Input aria-label="Option description" value={o.description} maxLength={100} onChange={(e) => set(options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <div className="flex gap-2">
                      <Select aria-label="Option type" value={o.type} onChange={(e) => set(options.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                        <option value="string">Text</option>
                        <option value="integer">Number</option>
                        <option value="user">User</option>
                      </Select>
                      <Button variant="ghost" className="px-2 text-xs" onClick={() => set(options.filter((_, j) => j !== i))}>Remove</Button>
                    </div>
                  </div>
                ))}
                {options.length < 5 ? <Button variant="secondary" className="text-xs" onClick={() => set([...options, { name: `option${options.length + 1}`, description: 'Describe it', type: 'string', required: false }])}>Add option</Button> : null}
              </div>
            );
          }
        }
      })}
      {meta.group !== 'trigger' ? <Button variant="ghost" onClick={onRemove}>Remove block</Button> : null}
    </div>
  );
}

function TestPanel({ guildId, graph, roles, valid, kind }: { guildId: string; graph: Graph; roles: RoleOption[]; valid: boolean; kind: 'command' | 'event' }) {
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ steps: Array<{ action: string; detail: string }>; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'));
  const options = (trigger?.type === 'trigger.command' ? ((trigger.data as { options?: Array<{ name: string }> }).options ?? []) : []).map((o) => o.name);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  return (
    <Card>
      <CardTitle description="Runs the workflow as you, without sending anything to Discord.">Test (safe mode)</CardTitle>
      <div className="flex flex-col gap-3">
        <Field label="Pretend I have these roles" htmlFor="test-roles">
          <MultiPicker id="test-roles" options={roles.map((r) => ({ id: r.id, label: `@${r.name}` }))} value={roleIds} onChange={setRoleIds} />
        </Field>
        {kind === 'event' ? <Field label="Message text (for message triggers)" htmlFor="test-msg"><Input id="test-msg" value={message} onChange={(e) => setMessage(e.target.value)} /></Field> : null}
        {options.map((o) => (
          <Field key={o} label={`Option: ${o}`} htmlFor={`opt-${o}`}><Input id={`opt-${o}`} value={optionValues[o] ?? ''} onChange={(e) => setOptionValues({ ...optionValues, [o]: e.target.value })} /></Field>
        ))}
        <Button
          variant="secondary"
          disabled={!valid}
          onClick={async () => {
            setError(null);
            try {
              setResult(await api(`/api/guilds/${guildId}/workflows/test`, { body: { graph, memberRoleIds: roleIds, messageContent: message, options: optionValues } }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Run test
        </Button>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          result.steps.length === 0 ? (
            <Alert tone="info">Nothing would happen with these inputs.</Alert>
          ) : (
            <ol className="list-decimal pl-5 text-sm">
              {result.steps.map((s, i) => <li key={i}><span className="font-semibold">{s.action}</span>: {s.detail}</li>)}
            </ol>
          )
        ) : null}
        {result?.errors.length ? <Alert tone="warn">{result.errors.join('; ')}</Alert> : null}
      </div>
    </Card>
  );
}
