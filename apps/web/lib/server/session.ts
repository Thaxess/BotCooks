import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { createSession, deleteSession, getSession, getSessionRow, touchSession, updateSessionTokens } from '@botcooks/database';
import { decryptSecret, encryptSecret, randomToken } from '@botcooks/security';
import { env } from './env';
import { server } from './context';
import { refreshAccessToken } from './discord-oauth';

export const SESSION_COOKIE = 'bc_session';
const SESSION_DAYS = 14;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  sessionId: string;
}

export async function startSession(user: { id: string }, tokens: { accessToken: string; refreshToken: string | null; expiresIn: number }) {
  const token = randomToken(32);
  const e = env();
  await createSession(server().db, {
    id: hashToken(token),
    userId: user.id,
    accessTokenEnc: encryptSecret(tokens.accessToken, e.ENCRYPTION_KEY),
    refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken, e.ENCRYPTION_KEY) : null,
    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: e.PUBLIC_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const row = await getSession(server().db, hashToken(token));
  if (!row) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60_000) await touchSession(server().db, row.session.id);
  return { id: row.user.id, username: row.user.username, globalName: row.user.globalName, avatar: row.user.avatar, sessionId: row.session.id };
}

/** The user's Discord OAuth access token, refreshed when close to expiry. Only used to list their guilds. */
export async function userAccessToken(sessionId: string): Promise<string | null> {
  const { db } = server();
  const e = env();
  const row = await getSessionRow(db, sessionId);
  if (!row) return null;
  if (row.tokenExpiresAt.getTime() - Date.now() > 60_000) return decryptSecret(row.accessTokenEnc, e.ENCRYPTION_KEY);
  if (!row.refreshTokenEnc) return null;
  const refreshed = await refreshAccessToken(decryptSecret(row.refreshTokenEnc, e.ENCRYPTION_KEY));
  if (!refreshed) return null;
  await updateSessionTokens(db, sessionId, {
    accessTokenEnc: encryptSecret(refreshed.accessToken, e.ENCRYPTION_KEY),
    refreshTokenEnc: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken, e.ENCRYPTION_KEY) : row.refreshTokenEnc,
    tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
  });
  return refreshed.accessToken;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(server().db, hashToken(token));
  jar.delete(SESSION_COOKIE);
}
