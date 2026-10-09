import 'server-only';
import { z } from 'zod';
import { aiEnvSchema, baseEnvSchema, discordEnvSchema, parseEnv } from '@botcooks/shared';

const webEnvSchema = baseEnvSchema
  .merge(discordEnvSchema)
  .merge(aiEnvSchema)
  .extend({
    DISCORD_CLIENT_SECRET: z.string().min(16, 'DISCORD_CLIENT_SECRET is required for dashboard login'),
    /** Public origin of the dashboard, e.g. https://botcooks.example.com (used for OAuth + CSRF checks). */
    PUBLIC_URL: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, '')),
    /** Max AI generations per user per hour (cost control). */
    AI_GENERATIONS_PER_HOUR: z.coerce.number().int().min(1).max(500).default(20),
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

let cached: WebEnv | undefined;

/** Parsed lazily so `next build` does not require runtime secrets. */
export function env(): WebEnv {
  cached ??= parseEnv(webEnvSchema);
  return cached;
}
