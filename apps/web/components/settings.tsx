'use client';

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import type { FeatureKey, GuildSettings, SettingsSection } from '@botcooks/shared';
import { api } from '@/lib/client/api';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, Textarea, Toggle, cx } from './ui';

export interface ChannelOption {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}
export interface RoleOption {
  id: string;
  name: string;
  color: number;
  managed: boolean;
}

interface Ctx {
  guildId: string;
  settings: GuildSettings;
  version: number;
  channels: ChannelOption[];
  roles: RoleOption[];
  update: (settings: GuildSettings, version: number) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider(props: Omit<Ctx, 'update'> & { children: ReactNode }) {
  const [state, setState] = useState({ settings: props.settings, version: props.version });
  const value = useMemo<Ctx>(
    () => ({ ...props, ...state, update: (settings, version) => setState({ settings, version }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, props.guildId, props.channels, props.roles],
  );
  return <SettingsContext.Provider value={value}>{props.children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

// ------------------------------------------------------------------ feature toggle
export function FeatureSwitch({ feature, label, disabled }: { feature: FeatureKey; label: string; disabled?: boolean }) {
  const { guildId, settings, version, update } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = settings.features[feature];
  return (
    <div className="flex items-center gap-3">
      <Toggle
        label={`${enabled ? 'Disable' : 'Enable'} ${label}`}
        checked={enabled}
        disabled={busy || disabled}
        onChange={async (v) => {
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ settings: GuildSettings; version: number }>(`/api/guilds/${guildId}/features`, { method: 'PUT', body: { feature, enabled: v, version } });
            update(res.settings, res.version);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <span className="text-sm text-coal-300">{enabled ? 'Enabled' : 'Disabled'}</span>
      {error ? <span className="text-xs text-chili-400" role="alert">{error}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------ declarative settings form
export type FieldDef =
  | { key: string; label: string; help?: ReactNode; type: 'toggle' }
  | { key: string; label: string; help?: ReactNode; type: 'number'; min?: number; max?: number }
  | { key: string; label: string; help?: ReactNode; type: 'text' | 'textarea'; maxLength?: number; placeholder?: string }
  | { key: string; label: string; help?: ReactNode; type: 'select'; options: Array<{ value: string; label: string }> }
  | { key: string; label: string; help?: ReactNode; type: 'channel' | 'channels'; channelTypes?: number[] }
  | { key: string; label: string; help?: ReactNode; type: 'role' | 'roles'; includeManaged?: boolean }
  | { key: string; label: string; help?: ReactNode; type: 'lines'; placeholder?: string }
  | { key: string; label: string; help?: ReactNode; type: 'objectList'; columns: ListColumn[]; newItem: Record<string, unknown>; max?: number };

export type ListColumn =
  | { key: string; label: string; type: 'number'; min?: number; max?: number }
  | { key: string; label: string; type: 'select'; options: Array<{ value: string; label: string }> }
  | { key: string; label: string; type: 'role' };

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath<T>(obj: T, path: string, value: unknown): T {
  const clone = structuredClone(obj) as Record<string, unknown>;
  const keys = path.split('.');
  let cur = clone;
  for (const k of keys.slice(0, -1)) {
    cur[k] = { ...((cur[k] as Record<string, unknown>) ?? {}) };
    cur = cur[k] as Record<string, unknown>;
  }
  if (value === '' || value === undefined) delete cur[keys.at(-1)!];
  else cur[keys.at(-1)!] = value;
  return clone as T;
}

const TEXT_TYPES = [0, 5];

export function channelLabel(c: ChannelOption, all: ChannelOption[]) {
  const parent = c.parentId ? all.find((p) => p.id === c.parentId) : undefined;
  const prefix = c.type === 2 || c.type === 13 ? '🔊 ' : c.type === 4 ? '📁 ' : '# ';
  return `${prefix}${c.name}${parent ? `  (${parent.name})` : ''}`;
}

export function SettingsForm({ section, title, description, fields, feature, children }: { section: SettingsSection; title: string; description?: ReactNode; fields: FieldDef[]; feature?: FeatureKey; children?: ReactNode }) {
  const { guildId, settings, version, update, channels, roles } = useSettings();
  const [draft, setDraft] = useState(settings[section]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const baseId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings[section]);

  const set = (key: string, value: unknown) => {
    setDraft((d) => setPath(d, key, value));
    setStatus(null);
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await api<{ settings: GuildSettings; version: number }>(`/api/guilds/${guildId}/settings/${section}`, { method: 'PUT', body: { value: draft, version } });
      update(res.settings, res.version);
      setDraft(res.settings[section]);
      setStatus({ tone: 'ok', text: 'Saved.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle description={description} actions={feature ? <FeatureSwitch feature={feature} label={title} /> : undefined}>
        {title}
      </CardTitle>
      <form
        className="grid gap-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {fields.map((f) => {
          const id = `${baseId}-${f.key}`;
          const value = getPath(draft, f.key);
          const wide = f.type === 'textarea' || f.type === 'lines' || f.type === 'channels' || f.type === 'roles' || f.type === 'objectList';
          let control: ReactNode;
          switch (f.type) {
            case 'toggle':
              return (
                <div key={f.key} className="flex items-start justify-between gap-4 rounded-lg border border-coal-800 p-3">
                  <div>
                    <p id={`${id}-label`} className="text-sm font-medium text-coal-300">{f.label}</p>
                    {f.help ? <p className="text-xs text-coal-500">{f.help}</p> : null}
                  </div>
                  <Toggle id={id} label={f.label} checked={Boolean(value)} onChange={(v) => set(f.key, v)} />
                </div>
              );
            case 'number':
              control = <Input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={(value as number | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />;
              break;
            case 'text':
              control = <Input id={id} maxLength={f.maxLength} placeholder={f.placeholder} value={(value as string | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
              break;
            case 'textarea':
              control = <Textarea id={id} maxLength={f.maxLength} placeholder={f.placeholder} value={(value as string | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
              break;
            case 'lines':
              control = (
                <Textarea
                  id={id}
                  placeholder={f.placeholder}
                  value={((value as string[] | undefined) ?? []).join('\n')}
                  onChange={(e) => set(f.key, e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
                />
              );
              break;
            case 'select':
              control = (
                <Select id={id} value={(value as string | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              );
              break;
            case 'channel':
              control = (
                <Select id={id} value={(value as string | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value || undefined)}>
                  <option value="">Not set</option>
                  {channels.filter((c) => (f.channelTypes ?? TEXT_TYPES).includes(c.type)).map((c) => (
                    <option key={c.id} value={c.id}>{channelLabel(c, channels)}</option>
                  ))}
                </Select>
              );
              break;
            case 'channels':
              control = <MultiPicker id={id} options={channels.filter((c) => (f.channelTypes ?? TEXT_TYPES).includes(c.type)).map((c) => ({ id: c.id, label: channelLabel(c, channels) }))} value={(value as string[] | undefined) ?? []} onChange={(v) => set(f.key, v)} />;
              break;
            case 'role':
              control = (
                <Select id={id} value={(value as string | undefined) ?? ''} onChange={(e) => set(f.key, e.target.value || undefined)}>
                  <option value="">Not set</option>
                  {roles.filter((r) => f.includeManaged || !r.managed).map((r) => (
                    <option key={r.id} value={r.id}>@{r.name}</option>
                  ))}
                </Select>
              );
              break;
            case 'objectList':
              control = <ObjectList id={id} columns={f.columns} newItem={f.newItem} max={f.max ?? 50} roles={roles} value={(value as Array<Record<string, unknown>> | undefined) ?? []} onChange={(v) => set(f.key, v)} />;
              break;
            case 'roles':
              control = <MultiPicker id={id} options={roles.filter((r) => f.includeManaged || !r.managed).map((r) => ({ id: r.id, label: `@${r.name}` }))} value={(value as string[] | undefined) ?? []} onChange={(v) => set(f.key, v)} />;
              break;
          }
          return (
            <div key={f.key} className={cx(wide && 'md:col-span-2')}>
              <Field label={f.label} htmlFor={id} help={f.help}>
                {control}
              </Field>
            </div>
          );
        })}
        {children ? <div className="md:col-span-2">{children}</div> : null}
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(settings[section])}>
              Discard
            </Button>
          ) : null}
          {status ? <span role="status" className={cx('text-sm', status.tone === 'ok' ? 'text-basil-400' : 'text-chili-400')}>{status.text}</span> : null}
        </div>
      </form>
    </Card>
  );
}

/** Keyboard-accessible multi-select built from checkboxes, with a filter box. */
export function MultiPicker({ id, options, value, onChange }: { id: string; options: Array<{ id: string; label: string }>; value: string[]; onChange: (v: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  return (
    <div className="rounded-lg border border-coal-600 bg-coal-850">
      <div className="flex flex-wrap gap-1.5 border-b border-coal-700 p-2">
        {value.length === 0 ? <span className="text-xs text-coal-500">None selected</span> : null}
        {value.map((v) => (
          <button key={v} type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full bg-ember-500/15 px-2 py-0.5 text-xs text-ember-300 hover:bg-ember-500/25" aria-label={`Remove ${options.find((o) => o.id === v)?.label ?? v}`}>
            {options.find((o) => o.id === v)?.label ?? `Unknown (${v})`} ✕
          </button>
        ))}
      </div>
      <input id={id} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="w-full border-b border-coal-700 bg-transparent px-3 py-1.5 text-sm outline-none" />
      <ul className="max-h-48 overflow-y-auto p-1" aria-label="Options">
        {shown.map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-coal-800">
              <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} className="accent-ember-500" />
              {o.label}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ObjectList({ id, columns, newItem, max, roles, value, onChange }: { id: string; columns: ListColumn[]; newItem: Record<string, unknown>; max: number; roles: RoleOption[]; value: Array<Record<string, unknown>>; onChange: (v: Array<Record<string, unknown>>) => void }) {
  const update = (i: number, key: string, v: unknown) => onChange(value.map((row, j) => (j === i ? { ...row, [key]: v } : row)));
  return (
    <div id={id} className="flex flex-col gap-2">
      {value.length === 0 ? <p className="text-xs text-coal-500">No entries.</p> : null}
      {value.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-coal-800 p-2">
          {columns.map((c) => {
            const cid = `${id}-${i}-${c.key}`;
            const v = row[c.key];
            return (
              <div key={c.key} className="min-w-28 flex-1">
                <label htmlFor={cid} className="mb-1 block text-xs text-coal-400">{c.label}</label>
                {c.type === 'number' ? (
                  <Input id={cid} type="number" min={c.min} max={c.max} value={(v as number | undefined) ?? ''} onChange={(e) => update(i, c.key, e.target.value === '' ? undefined : Number(e.target.value))} />
                ) : c.type === 'select' ? (
                  <Select id={cid} value={(v as string | undefined) ?? ''} onChange={(e) => update(i, c.key, e.target.value)}>
                    {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                ) : (
                  <Select id={cid} value={(v as string | undefined) ?? ''} onChange={(e) => update(i, c.key, e.target.value || undefined)}>
                    <option value="">Choose a role</option>
                    {roles.filter((r) => !r.managed).map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
                  </Select>
                )}
              </div>
            );
          })}
          <Button variant="ghost" aria-label={`Remove entry ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" disabled={value.length >= max} onClick={() => onChange([...value, { ...newItem }])}>
          Add entry
        </Button>
      </div>
    </div>
  );
}

export function Requirements({ items }: { items: Array<{ ok: boolean | null; label: string }> }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Requirements">
      {items.map((r) => (
        <li key={r.label}>
          <Badge tone={r.ok === null ? 'info' : r.ok ? 'ok' : 'warn'}>
            {r.ok === null ? 'ℹ' : r.ok ? '✓' : '!'} {r.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function SaveNotice({ text }: { text: string }) {
  return <Alert tone="info">{text}</Alert>;
}
