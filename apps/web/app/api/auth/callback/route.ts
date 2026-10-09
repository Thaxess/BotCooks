import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { upsertUser } from '@botcooks/database';
import { safeEqual } from '@botcooks/security';
import { exchangeCode, fetchDiscordUser } from '@/lib/server/discord-oauth';
import { server } from '@/lib/server/context';
import { env } from '@/lib/server/env';
import { startSession } from '@/lib/server/session';

const STATE_COOKIE = 'bc_oauth_state';

function fail(reason: string) {
  return NextResponse.redirect(`${env().PUBLIC_URL}/login?error=${encodeURIComponent(reason)}`);
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: '/api/auth' });
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (req.nextUrl.searchParams.get('error')) return fail('cancelled');
  if (!raw || !code || !state) return fail('invalid_state');
  let stored: { state: string; next: string };
  try {
    stored = JSON.parse(raw);
  } catch {
    return fail('invalid_state');
  }
  if (!safeEqual(stored.state, state)) return fail('invalid_state');

  const tokens = await exchangeCode(code);
  if (!tokens) return fail('token_exchange');
  const user = await fetchDiscordUser(tokens.accessToken);
  if (!user) return fail('profile');

  await upsertUser(server().db, { id: user.id, username: user.username, globalName: user.global_name ?? null, avatar: user.avatar ?? null });
  await startSession(user, tokens);
  const next = stored.next.startsWith('/') && !stored.next.startsWith('//') ? stored.next : '/dashboard';
  return NextResponse.redirect(`${env().PUBLIC_URL}${next}`);
}
