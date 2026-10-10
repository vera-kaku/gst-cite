/**
 * Minimal LLM client. Uses plain fetch so the provider can be swapped without
 * pulling in SDKs. Set ANTHROPIC_API_KEY (default) or OPENAI_API_KEY + OPENAI_MODEL.
 */
export interface LLM {
  name: string;
  complete(system: string, user: string): Promise<string>;
}

export function llmFromEnv(env = process.env): LLM | null {
  const provider = (env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : 'none')).toLowerCase();
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
    return {
      name: `anthropic:${model}`,
      async complete(system, user) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
        });
        if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as { content: { type: string; text?: string }[] };
        return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
      },
    };
  }
  if (provider === 'openai' && env.OPENAI_API_KEY) {
    const model = env.OPENAI_MODEL;
    if (!model) throw new Error('Set OPENAI_MODEL when using the OpenAI provider.');
    return {
      name: `openai:${model}`,
      async complete(system, user) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
        if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return data.choices[0]?.message.content ?? '';
      },
    };
  }
  return null;
}

/** Pulls the first JSON object out of a model reply, tolerating code fences or stray text. */
export function parseJsonObject<T>(raw: string): T {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model reply contained no JSON object');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
