'use client';

import { useState } from 'react';
import type { PlanChannel, ServerPlan } from '@botcooks/shared';
import { Alert, Badge } from '../ui';

const typeIcon: Record<string, string> = { text: '#', voice: '🔊', announcement: '📢', forum: '💬', stage: '🎙️' };
const visTone = { public: 'neutral', readonly: 'info', private: 'warn' } as const;

function roleName(plan: ServerPlan, ref: string) {
  if (ref.startsWith('role:')) return plan.roles.find((r) => r.key === ref.slice(5))?.name ?? ref;
  if (ref.startsWith('existing:')) return 'existing role';
  return ref;
}

function ChannelRow({ plan, c }: { plan: ServerPlan; c: PlanChannel }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1 text-sm">
      <span aria-hidden className="w-5 text-center text-coal-400">{typeIcon[c.type]}</span>
      <span className="font-medium">{c.name}</span>
      {c.visibility !== 'public' ? <Badge tone={visTone[c.visibility]}>{c.visibility}{c.accessRoles.length ? `: ${c.accessRoles.map((r) => roleName(plan, r)).join(', ')}` : ''}</Badge> : null}
      {c.slowmodeSeconds ? <Badge>slowmode {c.slowmodeSeconds}s</Badge> : null}
      {c.topic ? <span className="w-full pl-7 text-xs text-coal-500">{c.topic}</span> : null}
    </li>
  );
}

/** Human-readable view of the validated plan (not the diff; that is in the preview). */
export function PlanView({ plan, validation }: { plan: ServerPlan; validation: { issues: Array<{ level: string; message: string; code: string }>; downgrades: Array<{ path: string; from: string; to: string; reason: string }>; blocking: boolean } }) {
  const [showJson, setShowJson] = useState(false);
  const warnings = validation.issues.filter((i) => i.level === 'warning');
  const errors = validation.issues.filter((i) => i.level === 'error');
  return (
    <div className="flex flex-col gap-5">
      {plan.summary ? <p className="text-sm text-coal-300">{plan.summary}</p> : null}
      {errors.length ? <Alert tone="danger" title="This plan cannot be applied as-is">{errors.map((e) => <p key={e.message}>{e.message}</p>)}</Alert> : null}
      {warnings.length ? (
        <Alert tone="warn" title={`${warnings.length} safety adjustment(s) and warning(s)`}>
          <ul className="list-disc pl-5">{warnings.slice(0, 10).map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      ) : null}
      {validation.downgrades.length ? (
        <Alert tone="info" title="Adjusted to fit this server">
          <ul className="list-disc pl-5">{validation.downgrades.map((d, i) => <li key={i}>{d.path}: {d.from} → {d.to} ({d.reason})</li>)}</ul>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="plan-roles">
          <h3 id="plan-roles" className="mb-2 text-sm font-semibold uppercase tracking-wide text-coal-400">Roles ({plan.roles.length})</h3>
          <ul className="flex flex-col gap-2">
            {plan.roles.map((r) => (
              <li key={r.key} className="rounded-lg border border-coal-800 p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: r.color ?? '#99aab5' }} />
                  <span className="font-semibold">{r.name}</span>
                  {r.staff ? <Badge tone="ember">staff</Badge> : null}
                  {r.selfAssignable ? <Badge tone="info">self-assignable</Badge> : null}
                  {r.hoist ? <Badge>shown separately</Badge> : null}
                </div>
                {r.permissions.length ? <p className="mt-1 text-xs text-coal-400">{r.permissions.join(', ')}</p> : null}
                {r.purpose ? <p className="mt-1 text-xs text-coal-500">{r.purpose}</p> : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="plan-channels">
          <h3 id="plan-channels" className="mb-2 text-sm font-semibold uppercase tracking-wide text-coal-400">Channels</h3>
          {plan.channels.length ? <ul className="mb-3">{plan.channels.map((c) => <ChannelRow key={c.key} plan={plan} c={c} />)}</ul> : null}
          {plan.categories.map((cat) => (
            <div key={cat.key} className="mb-3">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-coal-300">
                📁 {cat.name}
                {cat.visibility !== 'public' ? <Badge tone={visTone[cat.visibility]}>{cat.visibility}{cat.accessRoles.length ? `: ${cat.accessRoles.map((r) => roleName(plan, r)).join(', ')}` : ''}</Badge> : null}
              </p>
              <ul className="ml-1 border-l border-coal-800 pl-2">{cat.channels.map((c) => <ChannelRow key={c.key} plan={plan} c={c} />)}</ul>
            </div>
          ))}
        </section>
      </div>

      <section aria-labelledby="plan-features" className="grid gap-2 text-sm sm:grid-cols-2">
        <h3 id="plan-features" className="text-sm font-semibold uppercase tracking-wide text-coal-400 sm:col-span-2">Features & messages</h3>
        <p>🛡️ Auto-mod: {[plan.moderation.spamFilter && 'spam', plan.moderation.blockInvites && 'invites', plan.moderation.blockLinks && 'links', plan.moderation.blockedTerms.length && `${plan.moderation.blockedTerms.length} terms`].filter(Boolean).join(', ') || 'off'}</p>
        <p>🚨 Anti-raid: {plan.moderation.antiRaid ? 'on' : 'off'}</p>
        <p>⭐ Levels: {plan.features.levels.enabled ? `on${plan.features.levels.rewards.length ? `, ${plan.features.levels.rewards.length} rewards` : ''}` : 'off'}</p>
        <p>🎫 Tickets: {plan.features.tickets.enabled ? 'on' : 'off'}</p>
        <p>🎧 Temp voice: {plan.features.tempVoice.enabled ? 'on' : 'off'}</p>
        <p>👋 Welcome: {plan.features.welcome.enabled ? 'on' : 'off'}</p>
        {plan.features.streamAlerts.length ? <p>📺 Stream alerts: {plan.features.streamAlerts.map((s) => `${s.platform} → #${s.channel}`).join(', ')}</p> : null}
        {plan.selfRolePanels.length ? <p>🎭 {plan.selfRolePanels.length} self-role panel(s)</p> : null}
        {plan.rules ? <p>📜 Rules message in #{plan.rules.channel}</p> : null}
        {plan.suggestedCommands.length ? <p>🧩 {plan.suggestedCommands.length} suggested commands (created disabled)</p> : null}
      </section>

      <div>
        <button type="button" className="text-xs text-coal-400 underline" onClick={() => setShowJson((v) => !v)} aria-expanded={showJson}>
          {showJson ? 'Hide' : 'Show'} plan JSON
        </button>
        {showJson ? <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-coal-950 p-3 text-xs">{JSON.stringify(plan, null, 2)}</pre> : null}
      </div>
    </div>
  );
}
