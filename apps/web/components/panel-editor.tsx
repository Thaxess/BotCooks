'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { channelLabel, MultiPicker, type ChannelOption, type RoleOption } from './settings';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from './ui';

export function PanelEditor({ guildId, channels, roles }: { guildId: string; channels: ChannelOption[]; roles: RoleOption[] }) {
  const router = useRouter();
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('Pick your roles');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState<'buttons' | 'select'>('buttons');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/guilds/${guildId}/selfroles`, { body: { channelId, title, description: description || undefined, style, roles: roleIds.map((roleId) => ({ roleId })) } });
      setMsg({ ok: true, text: 'Panel posted.' });
      setRoleIds([]);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle description="Members click buttons (or use a menu) to give themselves roles. Only safe roles below BotCooks are allowed.">Post a self-role panel</CardTitle>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Channel" htmlFor="panel-channel">
          <Select id="panel-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
            <option value="">Choose a channel</option>
            {channels.filter((c) => c.type === 0 || c.type === 5).map((c) => <option key={c.id} value={c.id}>{channelLabel(c, channels)}</option>)}
          </Select>
        </Field>
        <Field label="Style" htmlFor="panel-style">
          <Select id="panel-style" value={style} onChange={(e) => setStyle(e.target.value as 'buttons' | 'select')}>
            <option value="buttons">Buttons (toggle)</option>
            <option value="select">Dropdown menu</option>
          </Select>
        </Field>
        <Field label="Title" htmlFor="panel-title"><Input id="panel-title" value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Description" htmlFor="panel-desc"><Textarea id="panel-desc" rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="md:col-span-2">
          <Field label="Roles (max 25)" htmlFor="panel-roles">
            <MultiPicker id="panel-roles" options={roles.filter((r) => !r.managed).map((r) => ({ id: r.id, label: `@${r.name}` }))} value={roleIds} onChange={(v) => setRoleIds(v.slice(0, 25))} />
          </Field>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={busy || !channelId || roleIds.length === 0}>{busy ? 'Posting…' : 'Post panel'}</Button>
          {msg ? <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert> : null}
        </div>
      </form>
    </Card>
  );
}

export function DeletePanelButton({ guildId, panelId }: { guildId: string; panelId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      className="px-2 py-1 text-xs"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Remove this panel? Its buttons will stop working.')) return;
        setBusy(true);
        await api(`/api/guilds/${guildId}/selfroles/${panelId}`, { method: 'DELETE' }).catch((e) => window.alert((e as Error).message));
        router.refresh();
      }}
    >
      Remove
    </Button>
  );
}
