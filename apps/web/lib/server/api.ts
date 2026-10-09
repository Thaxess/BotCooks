import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ForbiddenError, UserFacingError, isSnowflake } from '@botcooks/shared';
import { requireAccess, type AccessResult } from '@botcooks/services';
import type { Action } from '@botcooks/security';
import { env } from './env';
import { server } from './context';
import { currentUser, type SessionUser } from './session';

export class HttpError extends UserFacingError {}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === 'number' ? { status: init } : init);
}

/**
 * CSRF defence for state-changing requests: the session cookie is SameSite=Lax, and in
 * addition we require the Origin header to match the dashboard origin and a JSON body.
 */
function checkCsrf(req: NextRequest) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(env().PUBLIC_URL).origin) throw new ForbiddenError('Cross-site request blocked.');
  const type = req.headers.get('content-type') ?? '';
  if (req.method !== 'DELETE' && !type.startsWith('application/json')) throw new HttpError('Expected JSON.', 'bad_content_type', 415);
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > 256_000) throw new HttpError('Request too large.', 'too_large', 413);
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError('Invalid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'validation');
  }
  return parsed.data;
}

export interface GuildRouteContext extends AccessResult {
  user: SessionUser;
  guildId: string;
  req: NextRequest;
}

type Params = { params: Promise<Record<string, string>> };

/**
 * Wraps a guild-scoped API route: session required, CSRF checks, guild id validated, and the
 * action authorised against FRESH-enough Discord data (sensitive actions always fresh).
 */
export function guildRoute(
  action: Action | ((req: NextRequest, params: Record<string, string>) => Action),
  handler: (ctx: GuildRouteContext, params: Record<string, string>) => Promise<Response>,
  opts: { fresh?: boolean } = {},
) {
  return async (req: NextRequest, { params }: Params) => {
    try {
      checkCsrf(req);
      const user = await currentUser();
      if (!user) return json({ error: 'Not signed in.', code: 'unauthenticated' }, 401);
      const p = await params;
      const guildId = p.guildId ?? '';
      if (!isSnowflake(guildId)) return json({ error: 'Invalid server id.' }, 400);
      const resolved = typeof action === 'function' ? action(req, p) : action;
      const fresh = opts.fresh ?? req.method !== 'GET';
      const access = await requireAccess(server().db, server().rest, guildId, user.id, resolved, { fresh });
      return await handler({ ...access, user, guildId, req }, p);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof UserFacingError) return json({ error: e.message, code: e.code }, e.status);
  server().log.error('api error', { error: e });
  return json({ error: 'Something went wrong.', code: 'internal' }, 500);
}

/** Simple per-key sliding-window limiter (in-process; fine for a single dashboard instance). */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError('Too many requests. Try again later.', 'rate_limited', 429);
  list.push(now);
  buckets.set(key, list);
}
