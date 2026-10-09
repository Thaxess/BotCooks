'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Alert, Button, Card, CardTitle, Input } from './ui';

export function CreateSnapshot({ guildId }: { guildId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await api(`/api/guilds/${guildId}/snapshots`, { body: { action: 'create', label: label || undefined } });
          setLabel('');
          setMsg({ ok: true, text: 'Backup saved.' });
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="snap-label" className="sr-only">Backup label</label>
      <Input id="snap-label" placeholder="Label (optional)" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} className="w-56" />
      <Button type="submit" disabled={busy}>Back up now</Button>
      {msg ? <span role="status" className={msg.ok ? 'text-sm text-basil-400' : 'text-sm text-chili-400'}>{msg.text}</span> : null}
    </form>
  );
}

export function RestoreButton({ guildId, snapshotId }: { guildId: string; snapshotId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      className="px-2 py-1 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await api<{ sessionId: string }>(`/api/guilds/${guildId}/snapshots`, { body: { action: 'restore', snapshotId } });
          router.push(`/dashboard/${guildId}/builder?session=${res.sessionId}`);
        } catch (e) {
          window.alert((e as Error).message);
          setBusy(false);
        }
      }}
    >
      Restore missing…
    </Button>
  );
}

export function RollbackButton({ guildId, executionId }: { guildId: string; executionId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ steps: string[]; irreversible: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (preview) {
    return (
      <Card className="mt-2 border-chili-500/40">
        <CardTitle description="Undo is best effort. Read what cannot be undone before continuing.">Roll back this change?</CardTitle>
        <ol className="mb-3 max-h-48 list-decimal overflow-y-auto pl-5 text-sm">{preview.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {preview.irreversible.length ? (
          <Alert tone="warn" title="Cannot be undone">
            <ul className="list-disc pl-5">{preview.irreversible.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Alert>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/guilds/${guildId}/executions/${executionId}/rollback`, { body: { confirm: true } });
                setPreview(null);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Roll back {preview.steps.length} step(s)
          </Button>
          <Button variant="ghost" onClick={() => setPreview(null)}>Keep the change</Button>
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-chili-400">{error}</p> : null}
      </Card>
    );
  }
  return (
    <>
      <Button
        variant="ghost"
        className="px-2 py-1 text-xs"
        onClick={async () => {
          setError(null);
          try {
            setPreview(await api(`/api/guilds/${guildId}/executions/${executionId}/rollback`));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Roll back…
      </Button>
      {error ? <span role="alert" className="text-xs text-chili-400">{error}</span> : null}
    </>
  );
}
