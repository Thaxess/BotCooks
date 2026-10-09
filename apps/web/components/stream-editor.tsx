'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { channelLabel, type ChannelOption, type RoleOption } from './settings';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from './ui';

const HELP = {
  twitch: 'Twitch username, e.g. botcooks_live',
  youtube: 'Channel ID starting with UC (find it under the channel’s About → Share → Copy channel ID)',
  kick: 'Kick channel slug, e.g. botcooks',
} as const;

export function StreamEditor({ guildId, channels, roles }: { guildId: string; channels: ChannelOption[]; roles: RoleOption[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<'twitch' | 'youtube' | 'kick'>('twitch');
  const [account, setAccount] = useState('');
  const [channelId, setChannelId] = useState('');
  const [pingRoleId, setPingRoleId] = useState('');
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card>
      <CardTitle description="Placeholders: {account} {title} {url} {game}. Role pings only ping the role you choose.">Add an alert</CardTitle>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          try {
            await api(`/api/guilds/${guildId}/streams`, { body: { platform, account, channelId, ...(pingRoleId ? { pingRoleId } : {}), ...(message ? { message } : {}) } });
            setAccount('');
            setMsg({ ok: true, text: 'Alert added. The worker checks every couple of minutes.' });
            router.refresh();
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          }
        }}
      >
        <Field label="Platform" htmlFor="st-platform">
          <Select id="st-platform" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            <option value="twitch">Twitch (live)</option>
            <option value="youtube">YouTube (new uploads)</option>
            <option value="kick">Kick (live)</option>
          </Select>
        </Field>
        <Field label="Account" htmlFor="st-account" help={HELP[platform]}><Input id="st-account" value={account} onChange={(e) => setAccount(e.target.value)} required /></Field>
        <Field label="Post in" htmlFor="st-channel">
          <Select id="st-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
            <option value="">Choose a channel</option>
            {channels.filter((c) => c.type === 0 || c.type === 5).map((c) => <option key={c.id} value={c.id}>{channelLabel(c, channels)}</option>)}
          </Select>
        </Field>
        <Field label="Ping role (optional)" htmlFor="st-role">
          <Select id="st-role" value={pingRoleId} onChange={(e) => setPingRoleId(e.target.value)}>
            <option value="">No ping</option>
            {roles.filter((r) => !r.managed).map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-2"><Field label="Custom message (optional)" htmlFor="st-msg"><Input id="st-msg" value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} /></Field></div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={!account || !channelId}>Add alert</Button>
          {msg ? <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert> : null}
        </div>
      </form>
    </Card>
  );
}

export function DeleteStreamButton({ guildId, id }: { guildId: string; id: string }) {
  const router = useRouter();
  return (
    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={async () => {
      if (!window.confirm('Remove this alert?')) return;
      await api(`/api/guilds/${guildId}/streams/${id}`, { method: 'DELETE' }).catch((e) => window.alert((e as Error).message));
      router.refresh();
    }}>
      Remove
    </Button>
  );
}
