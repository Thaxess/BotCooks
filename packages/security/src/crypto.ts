import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Derives independent 32-byte keys from the single ENCRYPTION_KEY secret, so the key used to
 * sign confirmations can never be used to decrypt stored credentials (and vice versa).
 */
export function deriveKey(secret: string, purpose: 'secrets' | 'confirmations' | 'sessions' | 'oauth-state'): Buffer {
  if (secret.length < 32) throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('botcooks'), Buffer.from(purpose), 32));
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret, 'secrets');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload: string, masterSecret: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported secret format');
  const key = deriveKey(masterSecret, 'secrets');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function hmac(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Show only the last four characters of a credential, e.g. for "configured" indicators. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}
