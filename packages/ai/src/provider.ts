/**
 * Provider abstraction. Providers only turn prompts into text; parsing, validation and every
 * safety decision happen outside the provider so swapping vendors cannot weaken them.
 */
export interface JsonGenerationRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface JsonGenerationResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateJson(request: JsonGenerationRequest): Promise<JsonGenerationResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Removes reasoning blocks and code fences, then returns the outermost JSON object text. */
export function extractJsonText(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AIProviderError('The AI response did not contain a JSON object.', true);
  return t.slice(start, end + 1);
}
