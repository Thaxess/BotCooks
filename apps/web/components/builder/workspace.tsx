'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ServerPlan } from '@botcooks/shared';
import { api } from '@/lib/client/api';
import { Alert, Badge, Button, Card, CardTitle, EmptyState, Field, Spinner, Textarea, cx } from '../ui';
import { PlanView } from './plan-view';
import { PreviewPanel } from './preview-panel';

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

interface SessionSummary {
  id: string;
  prompt: string;
  status: 'generating' | 'ready' | 'failed' | 'applied';
  source: string;
  createdAt: string;
  error: string | null;
}

interface Issue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface SessionDetail {
  session: SessionSummary & { templateId: string | null };
  latest: {
    id: string;
    version: number;
    plan: ServerPlan;
    validation: { issues: Issue[]; downgrades: Array<{ path: string; from: string; to: string; reason: string }>; blocking: boolean };
    aiModel: string | null;
    instruction: string | null;
  } | null;
  versions: Array<{ id: string; version: number; instruction: string | null; createdAt: string; aiModel: string | null }>;
}

const EXAMPLES = [
  'A gaming and cooking community with announcements, recipes, clips, Twitch alerts, staff-only moderation channels, leveling, tickets and temporary voice rooms.',
  'A cozy study group for university students with subject channels, homework help, focus voice rooms and a resources channel only tutors can post in.',
  'A support server for my indie game: announcements, FAQ, bug reports, private tickets and a staff area.',
];

export function BuilderWorkspace(props: {
  guildId: string;
  aiConfigured: boolean;
  aiProvider: string | null;
  templates: TemplateInfo[];
  initialSessions: SessionSummary[];
  initialSessionId: string | null;
  canApplyBasic: boolean;
}) {
  const { guildId } = props;
  const [sessions, setSessions] = useState(props.initialSessions);
  const [selected, setSelected] = useState<string | null>(props.initialSessionId ?? props.initialSessions[0]?.id ?? null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState('');

  const refreshList = useCallback(async () => {
    const res = await api<{ sessions: Array<SessionSummary & { createdAt: string }> }>(`/api/guilds/${guildId}/builder/sessions`);
    setSessions(res.sessions);
  }, [guildId]);

  const load = useCallback(async (id: string) => {
    try {
      setDetail(await api<SessionDetail>(`/api/guilds/${guildId}/builder/sessions/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [guildId]);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    void load(selected);
    const url = new URL(window.location.href);
    url.searchParams.set('session', selected);
    window.history.replaceState(null, '', url);
  }, [selected, load]);

  // Poll while the AI is cooking.
  useEffect(() => {
    if (!selected || detail?.session.status !== 'generating') return;
    const t = setInterval(() => {
      void load(selected);
      void refreshList();
    }, 3000);
    return () => clearInterval(t);
  }, [selected, detail?.session.status, load, refreshList]);

  const start = async (body: { prompt?: string; templateId?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ session: { id: string } }>(`/api/guilds/${guildId}/builder/sessions`, { body });
      await refreshList();
      setSelected(res.session.id);
      setPrompt('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revise = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/guilds/${guildId}/builder/sessions/${selected}/revise`, { body: { instruction: revision } });
      setRevision('');
      await load(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardTitle description={props.aiProvider ? `Using ${props.aiProvider}` : undefined}>Describe your server</CardTitle>
          {!props.aiConfigured ? (
            <div className="mb-3">
              <Alert tone="warn" title="AI is not configured">Set <code>AI_API_KEY</code> (Perplexity) to generate plans from descriptions. Templates work without it.</Alert>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start({ prompt });
            }}
            className="flex flex-col gap-3"
          >
            <Field label="What should your server look like?" htmlFor="prompt" help="Mention topics, channels, roles, who can see what, and features like leveling, tickets or stream alerts.">
              <Textarea id="prompt" rows={6} maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={EXAMPLES[0]} disabled={!props.aiConfigured} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex, i) => (
                <button key={i} type="button" className="rounded-full border border-coal-600 px-2.5 py-1 text-xs text-coal-300 hover:border-ember-500" onClick={() => setPrompt(ex)}>
                  Example {i + 1}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={busy || !props.aiConfigured || prompt.trim().length < 10}>{busy ? 'Starting…' : 'Cook up a plan'}</Button>
          </form>
        </Card>

        <Card>
          <CardTitle description="Ready-made plans. They go through the same preview and safety checks.">Templates</CardTitle>
          <ul className="grid grid-cols-1 gap-2">
            {props.templates.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={busy} onClick={() => void start({ templateId: t.id })} className="flex w-full items-start gap-3 rounded-lg border border-coal-700 p-3 text-left hover:border-ember-500 disabled:opacity-50">
                  <span aria-hidden className="text-xl">{t.emoji}</span>
                  <span>
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs text-coal-400">{t.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Previous builds</CardTitle>
          {sessions.length === 0 ? (
            <p className="text-sm text-coal-400">No builds yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    aria-current={selected === s.id ? 'true' : undefined}
                    className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm', selected === s.id ? 'bg-ember-500/15 text-ember-200' : 'hover:bg-coal-800')}
                  >
                    <span className="truncate">{s.prompt}</span>
                    <StatusBadge status={s.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {error ? <Alert tone="danger" title="Something went wrong">{error}</Alert> : null}
        {!selected ? (
          <EmptyState title="Nothing on the stove yet">Describe a server or pick a template to get a plan you can review.</EmptyState>
        ) : !detail ? (
          <Card><Spinner label="Loading build" /></Card>
        ) : (
          <>
            <Card>
              <CardTitle description={detail.session.prompt} actions={<StatusBadge status={detail.session.status} />}>
                {detail.latest ? `Plan v${detail.latest.version}` : 'Plan'}
              </CardTitle>
              {detail.session.status === 'generating' ? (
                <div className="flex flex-col gap-2">
                  <Spinner label={detail.latest ? 'Revising the plan…' : 'Cooking up your plan… this usually takes 15-60 seconds.'} />
                  <p className="text-xs text-coal-500">You can leave this page; the plan keeps generating in the background.</p>
                </div>
              ) : null}
              {detail.session.error ? <Alert tone="danger" title="Generation failed">{detail.session.error}</Alert> : null}
              {detail.latest ? <PlanView plan={detail.latest.plan} validation={detail.latest.validation} /> : null}
            </Card>

            {detail.latest && detail.session.status !== 'generating' ? (
              <>
                <Card>
                  <CardTitle description="Ask for changes in plain language. Each revision becomes a new version you can preview.">Revise with AI</CardTitle>
                  {detail.versions.length > 1 ? (
                    <ol className="mb-4 flex flex-col gap-2 border-l border-coal-700 pl-4 text-sm">
                      {[...detail.versions].reverse().map((v) => (
                        <li key={v.id}>
                          <span className="font-semibold">v{v.version}</span> <span className="text-coal-400">{v.instruction ? `“${v.instruction}”` : 'initial plan'}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void revise();
                    }}
                  >
                    <label htmlFor="revision" className="sr-only">Revision request</label>
                    <input id="revision" value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={2000} placeholder="e.g. Add a #memes channel and make #clips read-only for members" className="flex-1 rounded-lg border border-coal-600 bg-coal-850 px-3 py-2 text-sm" disabled={!props.aiConfigured || busy} />
                    <Button type="submit" variant="secondary" disabled={!props.aiConfigured || busy || revision.trim().length < 3}>Revise</Button>
                  </form>
                </Card>
                <PreviewPanel key={detail.latest.id} guildId={guildId} planVersionId={detail.latest.id} canApplyBasic={props.canApplyBasic} onFinished={() => void refreshList()} />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'applied' || status === 'completed' ? 'ok' : status === 'failed' ? 'danger' : status === 'generating' || status === 'running' || status === 'queued' ? 'ember' : status === 'completed_with_errors' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}
