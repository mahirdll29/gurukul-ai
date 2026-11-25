import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import assistant from '../../server/src/routes/assistant.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../server/src/db/pool.js', () => ({ pool: { query }, transaction: vi.fn() }));
vi.mock('../../server/src/core/permissions.js', () => ({
  auth(req: express.Request, _res: express.Response, next: express.NextFunction) {
    Object.assign(req, { user: { id: 'student' } });
    next();
  },
  canRead: vi.fn(),
}));
vi.mock('../../server/src/core/analytics.js', () => ({ logClassroomUsageSafely: vi.fn() }));

describe('assistant replies', () => {
  const localFetch = globalThis.fetch;
  const upstream = vi.fn<typeof fetch>();
  const fileId = '00000000-0000-4000-8000-000000000001';
  const unit = { file_id: fileId, file_name: 'Notes.pdf', unit_id: 'unit', locator: 'Page 2', text: 'A queue is FIFO.', score: 0 };
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json(), assistant);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test');
    vi.stubEnv('EMBEDDING_MODEL', 'test-embed');
    vi.stubEnv('LLM_MODEL', 'gemini-3.1-flash-lite');
    vi.stubGlobal('fetch', upstream);
    query.mockResolvedValue({ rows: [unit] });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

  async function ask(question: string) {
    const response = await localFetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, fileIds: [fileId] }),
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it('uses the exact page without embedding and shows its excerpt when Gemini is unreachable', async () => {
    upstream.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    const reply = await ask('Explain page 2');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toContain(':generateContent');
    expect(reply.answer).toContain('could not reach Gemini');
    expect(reply.sources).toMatchObject([{ fileId, locator: 'Page 2', snippet: unit.text }]);
    expect(reply.degraded).toBe(true);
  });

  it('uses keyword hits after a single rate-limited embedding call and recovers a dropped generation connection', async () => {
    query.mockResolvedValue({ rows: [{ ...unit, keyword_score: 1 }] });
    upstream
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'First in, first out.' }] } }] }));
    const reply = await ask('What does FIFO mean?');
    expect(upstream.mock.calls.map(([url]) => String(url).split(':').at(-1))).toEqual([
      'batchEmbedContents', 'generateContent', 'generateContent',
    ]);
    expect(upstream.mock.calls[1][1]?.signal).toBe(upstream.mock.calls[2][1]?.signal);
    expect(reply.answer).toBe('First in, first out.');
    expect(reply.sources[0].fileId).toBe(fileId);
  });

  function waitForAbort(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }

  it('answers using the backup model when the primary stalls', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '400');
    upstream.mockImplementationOnce(waitForAbort)
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'Queues serve items in arrival order.' }] } }] }));
    const reply = await ask('Explain page 2');
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls[0][0]).toContain('gemini-3.1-flash-lite:generateContent');
    expect(upstream.mock.calls[1][0]).toContain('gemini-3.5-flash-lite:generateContent');
    expect(reply.answer).toContain('arrival order');
    expect(reply.degraded).toBe(false);
  });

  it('returns the page excerpts when both models exhaust the generation deadline', async () => {
    vi.stubEnv('LLM_TIMEOUT_MS', '400');
    upstream.mockImplementation(waitForAbort);
    const reply = await ask('Explain page 2');
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(reply.answer).toContain('too long to respond');
    expect(reply.sources[0].snippet).toBe(unit.text);
  });
});
