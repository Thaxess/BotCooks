'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { channelLabel, type ChannelOption } from './settings';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Textarea } from './ui';

const INTERVALS = [
  { value: '', label: 'Once' },
  { value: '60', label: 'Every hour' },
  { value: '1440', label: 'Every day' },
  { value: '10080', label: 'Every week' },
];

export function ScheduledEditor({ guildId, channels }: { guildId: string; channels: ChannelOption[] }) {
  const router = useRouter();
  const [channelId, setChannelId] = useState('');
  const [content, setContent] = useState('');
  const [runAt, setRunAt] = useState('');
  const [interval, setInterval] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card>
      <CardTitle description="Times are in your browser’s time zone. Mentions in scheduled messages do not ping anyone.">Schedule a message</CardTitle>
      <form
        className="grid gap-4 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/guilds/${guildId}/scheduled`, {
              body: { channelId, content, runAt: new Date(runAt).toISOString(), intervalMinutes: interval ? Number(interval) : null },
            });
            setContent('');
            setMsg({ ok: true, text: 'Scheduled.' });
            router.refresh();
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Channel" htmlFor="sm-channel">
          <Select id="sm-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
            <option value="">Choose a channel</option>
            {channels.filter((c) => c.type === 0 || c.type === 5).map((c) => <option key={c.id} value={c.id}>{channelLabel(c, channels)}</option>)}
          </Select>
        </Field>
        <Field label="First run" htmlFor="sm-run"><Input id="sm-run" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required /></Field>
        <Field label="Repeat" htmlFor="sm-int">
          <Select id="sm-int" value={interval} onChange={(e) => setInterval(e.target.value)}>
            {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-3">
          <Field label="Message" htmlFor="sm-content"><Textarea id="sm-content" value={content} maxLength={2000} onChange={(e) => setContent(e.target.value)} required /></Field>
        </div>
        <div className="flex items-center gap-3 md:col-span-3">
          <Button type="submit" disabled={busy || !channelId || !content || !runAt}>Schedule</Button>
          {msg ? <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert> : null}
        </div>
      </form>
    </Card>
  );
}

export function ScheduledRowActions({ guildId, id, enabled }: { guildId: string; id: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn().catch((e) => window.alert((e as Error).message));
    router.refresh();
    setBusy(false);
  };
  return (
    <div className="flex gap-1">
      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => act(() => api(`/api/guilds/${guildId}/scheduled/${id}`, { method: 'PATCH', body: { enabled: !enabled } }))}>
        {enabled ? 'Pause' : 'Resume'}
      </Button>
      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => window.confirm('Delete this scheduled message?') && act(() => api(`/api/guilds/${guildId}/scheduled/${id}`, { method: 'DELETE' }))}>
        Delete
      </Button>
    </div>
  );
}
