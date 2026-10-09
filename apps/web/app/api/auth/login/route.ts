import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { randomToken } from '@botcooks/security';
import { authorizeUrl } from '@/lib/server/discord-oauth';
import { env } from '@/lib/server/env';

const STATE_COOKIE = 'bc_oauth_state';

/** Only allow same-site relative paths as post-login destinations (prevents open redirects). */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/dashboard';
  return value.slice(0, 200);
}

export async function GET(req: NextRequest) {
  const state = randomToken(24);
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  (await cookies()).set(STATE_COOKIE, JSON.stringify({ state, next }), {
    httpOnly: true,
    secure: env().PUBLIC_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state));
}
