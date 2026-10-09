import { deriveKey, hmac, randomToken, safeEqual } from './crypto';

/**
 * A confirmation authorises applying ONE validated plan to ONE server state, by ONE user,
 * for a short time. Any change to the plan (hash) or server (snapshot hash) invalidates it.
 * Destructive and elevation scopes must be acknowledged explicitly and are carried in the token,
 * so a token minted for an additive preview can never authorise deletions.
 */
export interface ConfirmationClaims {
  guildId: string;
  planId: string;
  planHash: string;
  snapshotHash: string;
  userId: string;
  /** Acknowledged risk scopes. */
  allowDestructive: boolean;
  allowElevation: boolean;
  /** Unix ms expiry. */
  exp: number;
  nonce: string;
}

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export function signConfirmation(
  claims: Omit<ConfirmationClaims, 'exp' | 'nonce'> & { exp?: number; nonce?: string },
  secret: string,
  now = Date.now(),
): { token: string; claims: ConfirmationClaims } {
  const full: ConfirmationClaims = {
    ...claims,
    exp: claims.exp ?? now + CONFIRMATION_TTL_MS,
    nonce: claims.nonce ?? randomToken(12),
  };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = hmac(deriveKey(secret, 'confirmations'), body);
  return { token: `${body}.${sig}`, claims: full };
}

export type ConfirmationCheck =
  | { ok: true; claims: ConfirmationClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'mismatch'; detail?: string };

export interface ConfirmationExpectation {
  guildId: string;
  planId: string;
  planHash: string;
  snapshotHash: string;
  userId: string;
  needsDestructive: boolean;
  needsElevation: boolean;
}

export function verifyConfirmation(
  token: string,
  expected: ConfirmationExpectation,
  secret: string,
  now = Date.now(),
): ConfirmationCheck {
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  const expectedSig = hmac(deriveKey(secret, 'confirmations'), body);
  if (!safeEqual(sig, expectedSig)) return { ok: false, reason: 'bad_signature' };
  let claims: ConfirmationClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConfirmationClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, reason: 'expired' };
  const fields: Array<keyof ConfirmationExpectation & keyof ConfirmationClaims> = [
    'guildId',
    'planId',
    'planHash',
    'snapshotHash',
    'userId',
  ];
  for (const field of fields) {
    if (claims[field] !== expected[field]) {
      return {
        ok: false,
        reason: 'mismatch',
        detail:
          field === 'snapshotHash'
            ? 'The server changed since this preview was generated. Review the updated preview.'
            : field === 'planHash'
              ? 'The plan changed since it was confirmed. Review it again.'
              : `Confirmation does not match this ${field}.`,
      };
    }
  }
  if (expected.needsDestructive && !claims.allowDestructive) {
    return { ok: false, reason: 'mismatch', detail: 'Deletions were not explicitly confirmed.' };
  }
  if (expected.needsElevation && !claims.allowElevation) {
    return { ok: false, reason: 'mismatch', detail: 'Permission elevation was not explicitly confirmed.' };
  }
  return { ok: true, claims };
}
