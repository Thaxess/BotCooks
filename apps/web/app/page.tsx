import Link from 'next/link';
import { FEATURES } from '@botcooks/shared';
import { Badge } from '@/components/ui';

const statusTone = { implemented: 'ok', partial: 'warn', planned: 'neutral', blocked: 'danger' } as const;

export default function Landing() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <nav className="mb-16 flex items-center justify-between">
        <span className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden>🍳</span> BotCooks
        </span>
        <Link href="/dashboard" className="rounded-lg bg-ember-500 px-4 py-2 text-sm font-semibold text-coal-950 hover:bg-ember-400">
          Open dashboard
        </Link>
      </nav>

      <section className="mb-20 grid items-center gap-10 md:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-ember-400">Your server, cooked to order</p>
          <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">Describe the Discord server you want. Review the recipe. Then let BotCooks build it.</h1>
          <p className="mt-5 text-lg text-coal-300">
            BotCooks turns plain language into a structured server plan: channels, roles, permissions, rules, moderation and more. Every change is previewed as a diff, checked
            against safety rules, and only applied after you confirm.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-lg bg-ember-500 px-5 py-3 font-semibold text-coal-950 hover:bg-ember-400">
              Sign in with Discord
            </Link>
            <a href="#features" className="rounded-lg border border-coal-600 px-5 py-3 font-semibold hover:bg-coal-800">
              See what it does
            </a>
          </div>
        </div>
        <div className="rounded-2xl border border-coal-700 bg-coal-900 p-5 font-mono text-sm shadow-2xl shadow-ember-500/5" aria-label="Example build preview">
          <p className="text-coal-400">/build-server prompt:</p>
          <p className="mt-1 text-coal-100">“A gaming and cooking community with recipes, clips, Twitch alerts, staff-only moderation channels, leveling, tickets and temp voice rooms.”</p>
          <div className="mt-4 space-y-1">
            <p className="text-basil-400">+ Category  The Kitchen</p>
            <p className="text-basil-400">+ #recipes · slowmode 30s</p>
            <p className="text-basil-400">+ #clips</p>
            <p className="text-basil-400">+ Role  Moderator · Kick, Timeout, Manage Messages</p>
            <p className="text-saffron-400">⚠ Staff category is private to Moderator</p>
            <p className="text-coal-400">= #general already exists, left unchanged</p>
          </div>
          <p className="mt-4 text-coal-400">Nothing changes until you confirm.</p>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className="mb-20">
        <h2 id="features-title" className="mb-2 text-2xl font-bold">Everything on the menu</h2>
        <p className="mb-8 text-coal-400">Status labels are honest: “partial” and “blocked” features say exactly what is missing.</p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.key} className="rounded-xl border border-coal-700 bg-coal-900 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="font-semibold">{f.label}</h3>
                <Badge tone={statusTone[f.status]}>{f.status}</Badge>
              </div>
              <p className="text-sm text-coal-400">{f.description}</p>
              {f.statusNote ? <p className="mt-2 text-xs text-coal-500">{f.statusNote}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-20 grid gap-6 md:grid-cols-3" aria-label="Safety principles">
        {[
          ['Plans, not code', 'The AI writes a declarative plan. It never calls Discord, and its output is validated like any untrusted input.'],
          ['Preview & confirm', 'You see a diff, required permissions and warnings. Confirmations expire and are bound to the exact plan and server state.'],
          ['Additive by default', 'Existing channels and roles are left alone. Deletions need owner approval, a setting and typed confirmation.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-coal-700 bg-coal-900 p-5">
            <h3 className="mb-2 font-semibold text-ember-300">{t}</h3>
            <p className="text-sm text-coal-300">{d}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-coal-800 pt-6 text-sm text-coal-500">BotCooks is self-hosted. Not affiliated with Discord.</footer>
    </main>
  );
}
