import { z } from 'zod';
import { AIProviderError, type AIProvider, type JsonGenerationRequest, type JsonGenerationResult } from './provider';

/**
 * Perplexity Sonar API (OpenAI-compatible chat format).
 * Docs (checked 2026-10): POST https://api.perplexity.ai/v1/sonar, Bearer auth,
 * `response_format: { type: "json_schema", json_schema: { name, schema } }`.
 * The first request with a new schema can take 10-30 s while Perplexity prepares it.
 */
export const PERPLEXITY_DEFAULT_MODEL = 'sonar-pro';
export const PERPLEXITY_DEFAULT_BASE_URL = 'https://api.perplexity.ai';

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .partial()
    .optional(),
});

export interface PerplexityOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class PerplexityProvider implements AIProvider {
  readonly name = 'perplexity';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PerplexityOptions) {
    if (!options.apiKey) throw new AIProviderError('Perplexity API key is not configured (AI_API_KEY).', false);
    this.model = options.model ?? PERPLEXITY_DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? PERPLEXITY_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson(request: JsonGenerationRequest): Promise<JsonGenerationResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/sonar`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: request.maxTokens ?? 8000,
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.schemaName, schema: request.jsonSchema },
          },
        }),
      });
    } catch (e) {
      const aborted = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
      throw new AIProviderError(aborted ? 'The AI provider timed out.' : 'Could not reach the AI provider.', true);
    }

    if (!res.ok) {
      // Never echo the response body verbatim: it can contain request details.
      const retryable = res.status === 429 || res.status >= 500;
      const hint =
        res.status === 401 || res.status === 403
          ? 'The AI API key was rejected. Check AI_API_KEY.'
          : res.status === 429
            ? 'The AI provider is rate limiting requests. Try again shortly.'
            : res.status === 400
              ? 'The AI provider rejected the request (400). The model name may be wrong; check AI_MODEL.'
              : `The AI provider returned HTTP ${res.status}.`;
      throw new AIProviderError(hint, retryable, res.status);
    }

    const parsed = responseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AIProviderError('Unexpected response format from the AI provider.', true);
    const choice = parsed.data.choices[0]!;
    const text = choice.message.content ?? '';
    if (!text.trim()) throw new AIProviderError('The AI provider returned an empty response.', true);
    if (choice.finish_reason === 'length') {
      throw new AIProviderError('The AI response was cut off. Try a shorter or simpler description.', true);
    }
    return {
      text,
      model: parsed.data.model ?? this.model,
      usage: {
        ...(parsed.data.usage?.prompt_tokens !== undefined ? { inputTokens: parsed.data.usage.prompt_tokens } : {}),
        ...(parsed.data.usage?.completion_tokens !== undefined ? { outputTokens: parsed.data.usage.completion_tokens } : {}),
      },
    };
  }
}
