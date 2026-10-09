import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/** Keys every process needs. App-specific schemas extend this. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Secret (>= 32 chars) used to derive keys for encrypting stored credentials and signing tokens. */
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const discordEnvSchema = z.object({
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID must be your application ID'),
  DISCORD_BOT_TOKEN: z.string().min(50, 'DISCORD_BOT_TOKEN looks too short'),
});

export const aiEnvSchema = z.object({
  AI_PROVIDER: z.enum(['perplexity', 'mock']).default('perplexity'),
  AI_API_KEY: optionalString,
  AI_MODEL: optionalString,
  AI_BASE_URL: optionalString,
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(120_000),
});

export const integrationsEnvSchema = z.object({
  TWITCH_CLIENT_ID: optionalString,
  TWITCH_CLIENT_SECRET: optionalString,
  KICK_CLIENT_ID: optionalString,
  KICK_CLIENT_SECRET: optionalString,
});

/** Public dashboard URL, used for links in Discord messages and OAuth redirects. */
export const publicUrlSchema = z.object({
  PUBLIC_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, '')),
});

export function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * TEST ONLY: point all Discord HTTP calls at a local fake Discord server (see apps/web/e2e).
 * Only loopback URLs are accepted so a misconfiguration can never send the bot token elsewhere.
 */
export function discordApiBaseOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.DISCORD_API_BASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('DISCORD_API_BASE_URL may only point at localhost (it exists for automated tests).');
  }
  return raw.replace(/\/+$/, '');
}
