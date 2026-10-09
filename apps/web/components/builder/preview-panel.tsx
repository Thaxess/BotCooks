'use client';

import { useEffect, useState } from 'react';
import type { Preview } from '@botcooks/services';
import { api } from '@/lib/client/api';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, Spinner, cx } from '../ui';
import { StatusBadge } from './workspace';

type Mode = 'additive' | 'update' | 'sync';

const MODES: Record<Mode, { label: string; help: string }> = {
  additive: { label: 'Add only (recommended)', help: 'Creates what is missing. Existing channels and roles are never changed or deleted.' },
  update: { label: 'Add and update existing', help: 'Also changes existing channels/roles with the same names to match the plan (permissions, topics, colors).' },
  sync: { label: 'Replace (deletes extras)', help: 'Deletes channels and roles that are not in the plan. Owner only, must be enabled in Administrator settings.' },
};

const actionStyle = {
  create: { sign: '+', tone: 'text-basil-400' },
  update: { sign: '~', tone: 'text-saffron-400' },
  delete: { sign: '−', tone: 'text-chili-400' },
  unchanged: { sign: '=', tone: 'text-coal-500' },
  skip: { sign: '·', tone: 'text-coal-400' },
} as const;

interface ExecutionView {
  execution: {
    id: string;
    status: string;
    progressDone: number;
    progressTotal: number;
    progressLabel: string | null;
    cancelRequested: boolean;
    report: { done: number; failed: number; skipped: number; cancelled: number; errors: Array<{ opId: string; message: string }> } | null;
  };
  ops: Array<{ id: string; label: string; status: string; error: string | null }>;
}

export function PreviewPanel({ guildId, planVersionId, canApplyBasic, onFinished }: { guildId: string; planVersionId: string; canApplyBasic: boolean; onFinished: () => void }) {
  const [mode, setMode] = useState<Mode>('additive');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ackElevation, setAckElevation] = useState(false);
  const [ackDestructive, setAckDestructive] = useState(false);
  const [typed, setTyped] = useState('');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [exec, setExec] = useState<ExecutionView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    setLoading(true);
    setError(null);
    setAckElevation(false);
    setAckDestructive(false);
    setTyped('');
    try {
      const res = await api<{ preview: Preview }>(`/api/guilds/${guildId}/builder/preview`, { body: { planVersionId, mode } });
      setPreview(res.preview);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, planVersionId]);

  // Countdown so users see when the confirmation expires.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll execution progress.
  useEffect(() => {
    if (!executionId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await api<ExecutionView>(`/api/guilds/${guildId}/executions/${executionId}`);
        if (stop) return;
        setExec(res);
        if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(res.execution.status)) {
          onFinished();
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [executionId, guildId, onFinished]);

  const apply = async () => {
    if (!preview?.confirmation) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ executionId: string }>(`/api/guilds/${guildId}/builder/confirm`, {
        body: {
          planVersionId,
          mode,
          token: preview.confirmation.token,
          acknowledgeElevation: ackElevation,
          acknowledgeDestructive: ackDestructive,
          ...(mode === 'sync' ? { typedConfirmation: typed } : {}),
        },
      });
      setExecutionId(res.executionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (!executionId) return;
    await api(`/api/guilds/${guildId}/executions/${executionId}/cancel`, { body: {} }).catch((e) => setError((e as Error).message));
  };

  if (executionId) {
    const e = exec?.execution;
    const finished = e && ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(e.status);
    const pct = e && e.progressTotal ? Math.round((e.progressDone / e.progressTotal) * 100) : 0;
    return (
      <Card>
        <CardTitle actions={e ? <StatusBadge status={e.status} /> : undefined} description="A backup snapshot was saved before any change.">
          Applying plan
        </CardTitle>
        {!e ? (
          <Spinner label="Waiting for the worker" />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-coal-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
                <div className="h-full bg-ember-500 transition-all" style={{ width: `${finished ? 100 : pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-coal-400" aria-live="polite">
                {finished ? 'Finished.' : `${e.progressDone}/${e.progressTotal} · ${e.progressLabel ?? (e.status === 'queued' ? 'Queued: waiting for the worker' : 'Working')}`}
              </p>
            </div>
            {e.report ? (
              <Alert tone={e.status === 'completed' ? 'ok' : e.status === 'failed' ? 'danger' : 'warn'} title={`${e.report.done} done · ${e.report.failed} failed · ${e.report.skipped} skipped · ${e.report.cancelled} cancelled`}>
                {e.report.errors.length ? <ul className="list-disc pl-5">{e.report.errors.slice(0, 10).map((x, i) => <li key={i}>{x.message}</li>)}</ul> : 'Everything was applied.'}
                {e.status !== 'completed' ? <p className="mt-2">You can roll back what was applied from <a className="underline" href={`/dashboard/${guildId}/backups`}>Backups</a>.</p> : null}
              </Alert>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm text-coal-400">Operations ({exec.ops.length})</summary>
              <ul className="mt-2 max-h-72 overflow-y-auto text-sm">
                {exec.ops.map((op) => (
                  <li key={op.id} className="flex justify-between gap-3 border-b border-coal-800 py-1">
                    <span>{op.label}</span>
                    <span className={cx('shrink-0 text-xs', op.status === 'done' ? 'text-basil-400' : op.status === 'failed' ? 'text-chili-400' : 'text-coal-400')} title={op.error ?? undefined}>{op.status}</span>
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex gap-2">
              {!finished ? (
                <Button variant="secondary" onClick={() => void cancel()} disabled={e.cancelRequested}>
                  {e.cancelRequested ? 'Cancelling after the current step…' : 'Cancel'}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => { setExecutionId(null); setExec(null); void load(); }}>Back to preview</Button>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  }

  const counts = preview?.change.counts;
  const visibleDiff = preview?.change.diff.filter((d) => showUnchanged || d.action !== 'unchanged') ?? [];
  const secondsLeft = preview?.confirmation ? Math.max(0, Math.floor((preview.confirmation.expiresAt - now) / 1000)) : 0;
  const ready =
    preview?.confirmation &&
    secondsLeft > 0 &&
    (!preview.needsElevationAck || ackElevation) &&
    (!preview.needsDestructiveAck || ackDestructive) &&
    (!preview.needsTypedConfirmation || typed === preview.guildName);

  return (
    <Card>
      <CardTitle description="A fresh look at the server right now, compared with the plan.">Preview changes</CardTitle>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Mode" htmlFor="mode" help={MODES[mode].help}>
          <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {(Object.keys(MODES) as Mode[]).map((m) => <option key={m} value={m}>{MODES[m].label}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh preview</Button>
      </div>

      {loading && !preview ? <Spinner label="Comparing with your server" /> : null}
      {error ? <Alert tone="danger" title="Preview problem">{error}</Alert> : null}

      {preview && counts ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" aria-label="Change counts">
            <Badge tone="ok">+{counts.create} create</Badge>
            <Badge tone="warn">~{counts.update} update</Badge>
            <Badge tone="danger">−{counts.delete} delete</Badge>
            <Badge>{counts.unchanged} unchanged</Badge>
            <Badge>{counts.skipped} left as-is</Badge>
          </div>

          {preview.change.requiredBotPermissions.length ? (
            <p className="text-sm text-coal-300"><span className="font-semibold">BotCooks will use:</span> {preview.change.requiredBotPermissions.join(', ')}</p>
          ) : null}

          {preview.change.risk.reasons.length ? (
            <Alert tone={preview.change.risk.destructive ? 'danger' : 'warn'} title="Powerful or destructive changes">
              <ul className="list-disc pl-5">{preview.change.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Alert>
          ) : null}
          {preview.change.warnings.length ? (
            <Alert tone="warn" title="Warnings"><ul className="list-disc pl-5">{preview.change.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Alert>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-coal-400">Diff</h3>
              <label className="flex items-center gap-2 text-xs text-coal-400">
                <input type="checkbox" className="accent-ember-500" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} /> show unchanged
              </label>
            </div>
            <ul className="max-h-[28rem] overflow-y-auto rounded-lg border border-coal-800 bg-coal-950 p-3 font-mono text-sm">
              {visibleDiff.map((d, i) => (
                <li key={i} className="py-0.5">
                  <span className={actionStyle[d.action].tone}>
                    {actionStyle[d.action].sign} {d.kind === 'role' ? 'role ' : d.kind === 'category' ? 'category ' : ''}{d.label}
                  </span>
                  {d.details.length ? <span className="block pl-4 text-xs text-coal-500">{d.details.join(' · ')}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          {preview.blockers.length ? (
            <Alert tone="danger" title="Cannot apply">
              <ul className="list-disc pl-5">{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </Alert>
          ) : !canApplyBasic ? (
            <Alert tone="info">You can preview plans but not apply them. Ask an administrator.</Alert>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-coal-700 p-4">
              <p className="text-sm font-semibold">Confirm</p>
              {preview.needsElevationAck ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-ember-500" checked={ackElevation} onChange={(e) => setAckElevation(e.target.checked)} />
                  <span>I understand this grants the powerful permissions listed above to the roles shown. Anyone with those roles can use them.</span>
                </label>
              ) : null}
              {preview.needsDestructiveAck ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-chili-500" checked={ackDestructive} onChange={(e) => setAckDestructive(e.target.checked)} />
                  <span>I understand that deleted channels lose their message history permanently and deleted roles cannot be restored with their original IDs. Rollback cannot bring these back.</span>
                </label>
              ) : null}
              {preview.needsTypedConfirmation ? (
                <Field label={`Type the server name (${preview.guildName}) to confirm replace mode`} htmlFor="typed">
                  <Input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={preview.needsDestructiveAck ? 'danger' : 'primary'} disabled={!ready || loading} onClick={() => void apply()}>
                  {preview.needsDestructiveAck ? 'Apply, including deletions' : `Apply ${counts.create + counts.update} change(s)`}
                </Button>
                <span className="text-xs text-coal-500" aria-live="polite">
                  {secondsLeft > 0 ? `Confirmation valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : 'Expired: refresh the preview.'}
                </span>
              </div>
              <p className="text-xs text-coal-500">If anything on the server changes before the worker starts, nothing is applied and you will be asked to review again.</p>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
