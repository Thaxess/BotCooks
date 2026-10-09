# BotCooks — progress log

This file is the hand-off document. Keep it current: completed work, remaining work, decisions,
and exact instructions for continuing.

## Status legend

- **Tested** — implemented and covered by automated tests that pass.
- **Implemented** — code exists and type-checks but has no automated test (or needs a live Discord/Perplexity to verify).
- **Partial** — usable subset exists; gaps listed.
- **Blocked** — cannot be done honestly/legally/technically right now; reason given.
- **Not started**

## Decisions (with reasons)

| Topic | Decision | Why |
|---|---|---|
| Package manager | npm workspaces (npm 11) | pnpm is not installed on the dev machine; npm workspaces need nothing extra. |
| Node | 24 LTS (engines `>=22.12`) | Current LTS; discord.js 14.27 needs >=18, Next 16 needs >=20.9. |
| TypeScript | 6.0.3 (not 7.x) | TS 7 is the new native compiler; Next.js and tooling expect the JS compiler API. |
| ORM / migrations | Drizzle ORM 0.45.3 + drizzle-kit 0.31.11 | Prisma's npm `latest` tag currently points at an 8.0 **RC**; Drizzle is stable, pure TS (no engine binaries) and runs on PGlite, so integration tests use real PostgreSQL without Docker. |
| Test database | PGlite 0.5.8 (Postgres compiled to WASM) | Docker isn't available on the dev machine. Caveat: single connection, so concurrency tests are serialised; run them against real Postgres before relying on SKIP LOCKED behaviour under load. |
| Job queue | PostgreSQL table + `FOR UPDATE SKIP LOCKED` + leases | Durable, transactional with plan/execution rows (enqueue + execution insert are consistent), one fewer moving part. **Redis is not used yet** — see "Deviations". |
| Per-server locking | `guild_locks` row with expiring lease | Survives crashes (lease expiry), works across processes. |
| Discord REST | `@discordjs/rest` 2.6.3 | Implements Discord's per-route buckets, global limit and 429 retries. |
| AI provider | Perplexity Sonar `POST https://api.perplexity.ai/v1/sonar`, model `sonar-pro`, `response_format: json_schema` | Verified against docs.perplexity.ai (Oct 2026). Provider interface lets you swap vendors (`AI_PROVIDER`). |
| Forum channels | Treated as Community-only and downgraded to text otherwise | Could not confirm from official docs that non-Community guilds can create forums; conservative choice. |
| Administrator | Never granted by generated plans | Hard safety rule; owners can assign it manually. |
| Replace ("sync") mode | The only path that deletes things; off by default, owner-only, typed server-name confirmation | Implements "wiping disabled by default + owner + typed confirmation". |
| Music | Not implemented (Blocked) | Streaming YouTube/Spotify audio violates their terms; a licensed-source player is future work. |

### Deviations from the original brief

- **Redis**: not used. The durable queue, locks and rate-limit-sensitive execution all run on Postgres.
  If you scale the bot to multiple shards/processes and want shared automod rate windows, add Redis then.
- **Prisma → Drizzle**: see table above.

## Architecture

```
apps/web       Next.js dashboard + API routes (Discord OAuth, authz on every request)
apps/bot       discord.js gateway bot (slash commands, automod, events)
apps/worker    job runner (AI generation, plan execution, scheduled/giveaway/stream jobs)
packages/shared       schemas: plan, snapshot, settings, permissions, features, env, logger
packages/security     plan validator, confirmation tokens, AES-GCM secrets, authorization
packages/workflows    diff engine, executor + rollback, visual-builder graph + interpreter
packages/ai           provider abstraction, Perplexity, offline mock, planner, templates
packages/database     Drizzle schema, migrations, repositories, PGlite test harness
packages/discord      REST helpers, guild snapshots, DiscordWriter implementation
packages/services     application services shared by web/bot/worker (builder flow, access)
packages/integrations Twitch / YouTube / Kick polling clients
```

Plan pipeline: prompt → (job) AI JSON → Zod parse (+1 repair round) → `validatePlan` (Discord
constraints, permission safety, reference resolution, downgrades) → stored version →
preview = fresh snapshot + re-validation + `diffPlan` + risk → signed confirmation bound to
(guild, plan version, plan hash incl. mode, snapshot hash, user, 10 min expiry) → confirm re-checks
everything, saves a pre-change snapshot, creates an execution with a unique nonce → worker takes
the guild lock, aborts if the server changed, executes ops idempotently with recovery → report →
optional rollback (best effort, irreversible parts listed).

## Feature status

See the table in `README.md` (kept in sync with `packages/shared/src/features.ts`).

## Completed milestones

1. Monorepo scaffolding, exact-pinned versions, shared schemas. **Tested**
2. Plan validator, confirmation tokens, AES-GCM secrets, authorization + delegation. **Tested** (`packages/security/test`)
3. Diff engine, executor (idempotent, crash recovery, partial failure, cancel), rollback. **Tested** (`packages/workflows/test`)
4. AI: Perplexity Sonar provider, offline mock, planner with one repair round, 7 templates. **Tested** with a fake fetch; **no live API call has been made.**
5. Database schema + repositories (settings w/ optimistic concurrency, jobs, locks, cases, XP, scheduling, giveaways). **Tested** on PGlite.
6. Services: start/revise/generate/preview/confirm/execute/rollback, snapshot restore, settings/graph reference validation. **Tested** with PGlite + fake guild.
7. Worker: job runner with leases, plan generation/execution handlers, custom command sync, scheduled messages, giveaways, stream polling, maintenance + audit retention. **Partly tested** (runner, winners; the rest via E2E).
8. Bot: slash commands (builder, moderation, cases, lockdown, levels, tickets, giveaways, polls, appeals, diagnostics), auto-mod, anti-raid, logging, welcome, autoroles, self-roles, levels, temp voice, workflows. **Implemented** — automod rules and command definitions tested; gateway behaviour **not run against Discord**.
9. Dashboard: OAuth, server picker, 22 guild pages, 29 API routes, React Flow builders, CSRF/origin checks. **E2E tested** (5 Playwright tests) against a fake Discord API; `next build` passes.
10. Docker Compose + Dockerfile. **Not built** (no Docker on the dev machine).

## Evidence (last run 2026-10-08)

- `npm test`: Vitest, all green (see command output in the session; 92 tests across 12 files).
- `npm run typecheck`: clean.
- `npm run test:e2e`: 5/5 passed (owner build via worker, AI path via mock, no-access denial,
  delegation limits, cross-server ID rejection).
- Manual: landing, builder plan/preview, command builder save + Discord command registration on the fake API.

## Known gaps / remaining work (priority order)

1. **Live verification**: run the bot + worker against a real test server and the real Perplexity API;
   fix any discrepancies with Discord's actual behaviour (role position updates, forum creation on
   Community servers, private thread role mentions adding staff).
2. Build and smoke-test the Docker images; add a CI workflow (lint, typecheck, unit, e2e).
3. Concurrency tests on real PostgreSQL (job claiming, guild locks) — PGlite serialises connections.
4. Settings cache invalidation from dashboard to bot (currently a 30 s TTL). Option: Postgres LISTEN/NOTIFY.
5. Optional AI moderation (advisory only), with privacy/cost documentation.
6. Stream alerts via webhooks (Twitch EventSub, YouTube WebSub) instead of polling; YouTube live detection needs the Data API.
7. Discord Onboarding API support for Community servers (plan currently uses self-role panels).
8. Reaction roles (buttons/selects exist; reactions were not implemented).
9. Ticket transcripts; giveaway reroll/end-early commands; poll creation from the dashboard.
10. Richer analytics (per-channel activity, retention); per-feature permission diagnostics inside each page.
11. ESLint config (Next 16 removed `next lint`); accessibility audit with axe in Playwright.
12. The brief was truncated in the request after "Community: … Autoroles"; any requirements after
    that point have not been seen and are not implemented.

## How to continue

1. `npm install`
2. `npm test && npm run typecheck` — must stay green.
3. `npm run test:e2e` before touching the builder flow, auth or API routes.
4. Pick the next item above; keep each change a runnable vertical slice; update this file and the
   README status table (and `packages/shared/src/features.ts` statuses) when a feature's status changes.
