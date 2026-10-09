import { TEMPLATES, type TemplateId } from './templates';
import type { AIProvider, JsonGenerationRequest, JsonGenerationResult } from './provider';

const KEYWORDS: Array<[TemplateId, RegExp]> = [
  ['cooking', /cook|recipe|food|kitchen|bak(e|ing)|chef/i],
  ['esports', /esport|roster|scrim|tournament/i],
  ['gaming', /gam(e|ing)|lfg|clips|fps|mmo|minecraft|valorant/i],
  ['creator', /creator|youtube|stream(er)?|twitch|content|fans?\b/i],
  ['study', /study|school|homework|class|exam|learn/i],
  ['support', /support|customers?|product|help ?desk|tickets?/i],
  ['friends', /friends?|hangout|chill/i],
];

/**
 * Deterministic offline provider. It does not understand language; it picks the template that
 * matches keywords in the request. Useful for development, demos and tests without an API key.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly model = 'mock-keyword-templates';

  constructor(private readonly override?: (req: JsonGenerationRequest) => string) {}

  async generateJson(request: JsonGenerationRequest): Promise<JsonGenerationResult> {
    if (this.override) return { text: this.override(request), model: this.model };
    const userText = request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const description = userText.split('<server_description>')[1]?.split('</server_description>')[0] ?? userText;
    const match = KEYWORDS.find(([, re]) => re.test(description));
    const template = TEMPLATES[match?.[0] ?? 'friends'];
    return { text: JSON.stringify({ ...template.plan, summary: `${template.plan.summary} (offline mock provider)` }), model: this.model };
  }
}
