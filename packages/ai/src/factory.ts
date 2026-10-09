import { aiEnvSchema, parseEnv } from '@botcooks/shared';
import { MockProvider } from './mock';
import { PerplexityProvider } from './perplexity';
import type { AIProvider } from './provider';

/** Builds the configured provider. Returns null when AI is not configured, so callers can say so. */
export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AIProvider | null {
  const cfg = parseEnv(aiEnvSchema, env);
  if (cfg.AI_PROVIDER === 'mock') return new MockProvider();
  if (!cfg.AI_API_KEY) return null;
  return new PerplexityProvider({
    apiKey: cfg.AI_API_KEY,
    timeoutMs: cfg.AI_TIMEOUT_MS,
    ...(cfg.AI_MODEL ? { model: cfg.AI_MODEL } : {}),
    ...(cfg.AI_BASE_URL ? { baseUrl: cfg.AI_BASE_URL } : {}),
  });
}
