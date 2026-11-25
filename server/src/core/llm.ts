import { logger } from './logger.js';

type GeminiTurn = { role: 'user' | 'model'; parts: { text: string }[] };

function getModelCandidates(): string[] {
  const primary = process.env.LLM_MODEL?.trim().replace(/^models\//, '') || 'gemini-3.5-flash-lite';
  const fallbacks = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash'];
  return [...new Set([primary, ...fallbacks])];
}

async function generate(system: string, contents: GeminiTurn[], json: boolean) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing required environment variable: GEMINI_API_KEY');

  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || (json ? 45_000 : 25_000));
  const deadline = AbortSignal.timeout(timeoutMs);
  let retriedConnection = false;
  let lastStatus = 0;

  const models = getModelCandidates();
  nextModel: for (const [index, model] of models.entries()) {
    // Reserve part of the chat deadline for a second model if the first stalls.
    const signal = index === 0 && !json
      ? AbortSignal.any([deadline, AbortSignal.timeout(Math.min(12_000, Math.floor(timeoutMs / 2)))])
      : deadline;
    const started = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        ...(json ? { responseMimeType: 'application/json' } : {}),
        ...(!json && model === 'gemini-3.1-flash-lite' ? { thinkingConfig: { thinkingLevel: 'MINIMAL' } } : {}),
      },
    });

    while (true) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal,
        });
        lastStatus = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          break;
        }
        const payload = await response.json();
        const text = payload.candidates?.[0]?.content?.parts
          ?.filter((part: { thought?: boolean }) => !part.thought)
          .map((part: { text?: string }) => part.text || '').join('').trim();
        if (text) return text;
        break;
      } catch (err: any) {
        if (signal.aborted && !deadline.aborted && signal !== deadline) {
          logger.warn('gemini_model_timeout', {
            model, next_model: models[index + 1], duration_ms: Date.now() - started,
          });
          continue nextModel;
        }
        if (err instanceof SyntaxError) break;
        const code = err?.cause?.code || err?.name || 'NETWORK_ERROR';
        if (!signal.aborted && !retriedConnection &&
          ['ECONNRESET', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'].includes(code)) {
          retriedConnection = true;
          continue;
        }
        const timedOut = signal.aborted || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT';
        throw Object.assign(new Error(`Gemini request failed for ${model} (${code}).`), {
          statusCode: timedOut ? 504 : 502,
          publicCode: timedOut ? 'AI_TIMEOUT' : 'AI_CONNECTION_FAILED',
          publicMessage: timedOut ? 'Gemini took too long to respond.' : 'The server could not reach Gemini.',
        });
      }
    }
    if (![404, 429, 500, 503].includes(lastStatus)) break;
  }

  const messages: Record<number, string> = {
    200: 'Gemini returned no usable answer. Try rephrasing your question.',
    401: 'Gemini rejected the configured API key.',
    403: 'Gemini denied access. Check the server API key permissions.',
    404: 'Gemini could not find an available generation model.',
    429: 'Gemini reached its usage limit. Try again later.',
  };
  throw Object.assign(new Error(`Gemini generation failed (HTTP ${lastStatus}).`), {
    statusCode: 502,
    publicCode: 'AI_UNAVAILABLE',
    publicMessage: messages[lastStatus] || `Gemini returned HTTP ${lastStatus}.`,
  });
}

export async function generateText(system: string, prompt: string, history: GeminiTurn[] = []) {
  // Gemini expects a conversation that starts with a user turn and alternates
  // roles. A short UI history window can start on an assistant turn, so clean
  // and coalesce it before sending the retrieved-file prompt.
  const turns: GeminiTurn[] = [];
  for (const turn of history) {
    const content = turn.parts.map(part => part.text).join('\n').trim();
    if (!content || (!turns.length && turn.role !== 'user')) continue;
    const previous = turns.at(-1);
    if (previous?.role === turn.role) previous.parts[0].text += `\n${content}`;
    else turns.push({ role: turn.role, parts: [{ text: content }] });
  }
  const text = await generate(system, [...turns, { role: 'user', parts: [{ text: prompt }] }], false);
  return text;
}

export async function generateJson<T>(system: string, prompt: string): Promise<T> {
  const text = await generate(system, [{ role: 'user', parts: [{ text: prompt }] }], true);
  try { return JSON.parse(text) as T; }
  catch { throw Object.assign(new Error('Gemini returned invalid JSON.'), { statusCode: 502, publicCode: 'AI_INVALID_RESPONSE', publicMessage: 'The AI provider returned a response in an unexpected format. Try again.' }); }
}
