# 🍳 BotCooks

A self-hosted Discord bot and dashboard. Describe your ideal server in plain language; BotCooks
drafts a **declarative plan**, validates it against Discord's rules and safety checks, shows you a
**diff**, and only applies it after you confirm. It also has all-in-one community features
(moderation, auto-mod, anti-raid, logging, welcome, levels, tickets, giveaways, polls,
scheduled messages, self-roles, temp voice, stream alerts) and visual command/event builders.

> Status: early but working. See **Feature status** below and `docs/PROGRESS.md` for exactly what
> is tested, what is only implemented, and what is blocked. It has **not** been run against a
> live Discord server or the live Perplexity API from this repository yet.

## How the AI builder stays safe

1. The AI (Perplexity Sonar by default) returns **JSON matching a schema**, never code. It cannot call Discord.
2. The JSON is parsed with Zod (one automatic repair round), then `validatePlan` applies deterministic rules:
   Discord limits, Community-only channel types (downgraded), role references, bot role hierarchy,
   permissions the bot does not hold, **Administrator never granted**, no dangerous permissions on
   self-assignable/auto roles or on `@everyone`, staff channels that look public, etc.
3. The preview re-fetches the server, re-validates, and diffs: creates / updates / deletions / unchanged,
   required bot permissions, warnings, downgrades and a risk assessment.
4. A signed confirmation is bound to **guild + plan version + plan hash (incl. mode) + server snapshot hash + user**
   and expires in 10 minutes. Elevation and deletions need separate explicit acknowledgement.
   Replace mode (deletions) is off by default, owner-only and needs the server name typed.
5. Confirming saves a pre-change snapshot and queues a durable job. The worker takes a per-server
   lock, aborts if the server changed since you confirmed, and executes idempotent operations
   (crash recovery adopts half-created resources instead of duplicating them). Partial failures
   are reported per operation; dependants of failed steps are skipped, not half-created.
6. Rollback is best effort and says what it cannot undo (message history, original IDs, role assignments).

## Quick start (Docker)

```bash
cp .env.example .env    # fill in Discord app, ENCRYPTION_KEY, PUBLIC_URL, POSTGRES_PASSWORD, AI_API_KEY
docker compose up -d --build
docker compose run --rm bot node_modules/.bin/tsx apps/bot/src/register.ts   # register slash commands
```

> The Dockerfile and compose file are written but were **not built** on the development machine
> (Docker was not available). Please report problems.

Discord developer portal checklist:
- OAuth2 → Redirects: add `<PUBLIC_URL>/api/auth/callback`.
- Bot → Privileged Gateway Intents: enable **Server Members** and/or **Message Content** if you set
  `BOT_INTENT_MEMBERS` / `BOT_INTENT_MESSAGE_CONTENT=true` (login fails otherwise).
- Invite the bot from the dashboard's server picker (it requests specific permissions, never Administrator),
  and drag the BotCooks role above the roles it should manage.

## Local development (no Docker needed)

```bash
npm install
npm run dev:db          # PGlite (Postgres over the wire protocol) on 127.0.0.1:54329
# .env: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres  (+ Discord/AI vars)
npm run db:migrate
npm run dev:worker      # also runs migrations on start
npm run dev:bot
npm run dev:web         # http://localhost:3000
```

Set `AI_PROVIDER=mock` to try the builder without an API key (it picks a template by keywords).

## Tests

```bash
npm test              # unit + integration (Vitest; database tests use in-process PGlite)
npm run typecheck     # all packages + Next.js app
npm run test:e2e      # Playwright: real dashboard + worker against PGlite and a fake Discord API
```

E2E uses Microsoft Edge on Windows by default (`PLAYWRIGHT_CHANNEL` to change, or
`npx playwright install chromium`).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 dashboard + API routes (Discord OAuth, CSRF checks, authorization on every request) |
| `apps/bot` | discord.js 14 gateway bot: slash commands, auto-mod, events |
| `apps/worker` | Durable job runner: AI generation, plan execution, scheduled messages, giveaways, stream polling, custom command sync |
| `packages/shared` | Plan / snapshot / settings schemas, permissions, feature registry, env |
| `packages/security` | Plan validator, confirmation tokens, AES-GCM secret encryption, authorization & delegation |
| `packages/workflows` | Diff engine, executor + rollback, visual-builder graph + interpreter |
| `packages/ai` | Provider abstraction, Perplexity Sonar provider, offline mock, planner, 7 templates |
| `packages/database` | Drizzle schema + migrations, repositories, PGlite test harness |
| `packages/discord` | REST client (rate limits via @discordjs/rest), snapshots, message builders |
| `packages/services` | Shared application services (builder flow, access resolution, restore) |
| `packages/integrations` | Twitch Helix, YouTube RSS, Kick public API clients |

## Feature status

Legend: **Tested** = automated tests cover it · **Implemented** = code complete, type-checked, not yet exercised against live Discord · **Partial** / **Blocked** as described.

| Area | Status | Notes |
|---|---|---|
| AI plan generation (Perplexity) | Implemented | Request/response handling tested with a fake HTTP client; not called live. |
| Plan validation, diff, risk, confirmation binding | Tested | Unit + integration + E2E. |
| Durable execution, locking, idempotency, crash recovery, cancel | Tested | Against a fake Discord; PGlite serialises concurrency tests. |
| Rollback / restore from snapshot | Tested | Best effort; irreversible parts listed. |
| Templates (gaming, creator, cooking, study, friends, support, esports) | Tested | All validate and diff cleanly. |
| `/build-server` + review/confirm buttons in Discord | Implemented | Needs a live bot to verify. |
| Dashboard (22 pages), OAuth, delegation | Tested (E2E) for login, builder, delegation, denial, settings validation | Other pages type-check and build; manually smoke-tested. |
| Moderation commands, cases, notes, appeals, escalation | Implemented | Hierarchy checks; appeal DB rules tested. |
| Auto-mod (spam, duplicates, mentions, invites, links, terms) | Tested (rules) | Discord wiring implemented. |
| Anti-raid, lockdown, verification | Partial | Join-rate detection tested; lockdown/verification implemented. |
| Logging (members, roles, channels, messages opt-in) | Implemented | Message logs need Message Content intent; redaction on by default. |
| Welcome/goodbye, autoroles, self-role panels | Implemented | Role safety checks tested. |
| Levels & rewards | Tested (XP/cooldown) | |
| Tickets (private threads), giveaways, native polls | Implemented | Giveaway finish-once tested. |
| Scheduled messages | Tested (claiming) | |
| Visual command & event builders | Tested | Graph validation + interpreter; command sync verified in E2E stack. |
| Stream alerts | Partial | YouTube uploads via RSS (no live detection), Twitch & Kick polling with app credentials. No webhooks yet. |
| Temporary voice rooms | Implemented | |
| Analytics | Partial | Daily counters only. |
| Music | **Blocked** | Streaming YouTube/Spotify audio violates their terms; not implemented. |
| Optional AI moderation | Not started | Deterministic rules only, by design for now. |
| Redis | Not used | Postgres provides the durable queue and locks (see docs/PROGRESS.md). |
