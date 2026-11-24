type GeminiTurn = { role: 'user' | 'model'; parts: { text: string }[] };

function getModelCandidates(): string[] {
  const primary = process.env.LLM_MODEL?.trim().replace(/^models\//, '') || 'gemini-3.1-flash-lite';
  const fallbacks = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash'];
  return [...new Set([primary, ...fallbacks])];
}

async function generate(system: string, contents: GeminiTurn[], json: boolean) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing required environment variable: GEMINI_API_KEY');

  const models = getModelCandidates();
  let lastStatus = 0;
  let lastErrorMsg = '';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let response: Response | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
          }),
          signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 45_000)),
        });
      } catch (err: any) {
        lastStatus = 0;
        lastErrorMsg = err?.message || 'Network error';
        break;
      }

      if (response && response.ok) {
        let payload: any;
        try { payload = await response.json(); }
        catch { lastStatus = response.status; lastErrorMsg = 'Gemini returned invalid JSON'; break; }
        const text = payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('').trim();
        if (text) return text;
        lastStatus = response.status;
        lastErrorMsg = payload.promptFeedback?.blockReason || 'Gemini returned no text candidate';
        break;
      }

      lastStatus = response?.status || 0;
      try {
        const payload: any = await response?.clone().json();
        lastErrorMsg = payload.error?.message || lastErrorMsg;
      } catch { /* Keep the transport error when the provider returned no JSON body. */ }
      if (![404, 429, 500, 503].includes(lastStatus)) {
        // Unrecoverable status for this model
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    }
    if (!lastStatus && lastErrorMsg) break;
    if ([400, 401, 403].includes(lastStatus)) break;
  }

  const publicMessage = !lastStatus
    ? 'Could not connect to Gemini. Check outbound network access and the Gemini API key.'
    : lastStatus === 200
      ? 'Gemini returned no answer. Check whether the prompt was blocked, then try again.'
      : `Gemini returned HTTP ${lastStatus}. Check the API key, model access, and usage quota.`;
  throw Object.assign(new Error(`Gemini generation failed (${lastStatus || lastErrorMsg}).`), {
    statusCode: 502,
    publicCode: 'AI_UNAVAILABLE',
    publicMessage,
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
