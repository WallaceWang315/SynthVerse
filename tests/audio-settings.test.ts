import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createApiServer } from '../services/api/server';
import type { ModelConfig } from '../services/api/model-settings';
const servers: http.Server[] = [];
async function start(config: ModelConfig = {}, save = async (_c: ModelConfig) => {}) {
  const server = createApiServer({ ...config, settingsStore: { save, storage: 'test' } }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); }))); });
const put = (url: string, data: unknown) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
it('saves local audio settings independently and never exposes either key', async () => {
  let saved: ModelConfig = {};
  const url = await start({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'chat', apiKey: 'chat-secret' }, async c => { saved = c; });
  const response = await put(url + '/api/audio-settings', { endpoint: 'http://127.0.0.1:9001/analyze', model: 'local-audio', apiKey: 'audio-secret' });
  expect(response.status).toBe(200); const text = await response.text(); expect(text).not.toContain('audio-secret'); expect(text).not.toContain('chat-secret');
  expect(saved.apiKey).toBe('chat-secret'); expect(saved.perception?.apiKey).toBe('audio-secret');
  await put(url + '/api/model-settings', { endpoint: 'http://127.0.0.1:9999/v1', model: 'chat-next' });
  expect(saved.perception?.apiKey).toBe('audio-secret');
  await fetch(url + '/api/model-settings', { method: 'DELETE' }); expect(saved.perception?.model).toBe('local-audio');
  await fetch(url + '/api/audio-settings', { method: 'DELETE' }); expect(saved.perception).toBeUndefined();
});
it('rejects cloud audio settings before saving', async () => {
  let saved = false; const url = await start({}, async () => { saved = true; });
  expect((await put(url + '/api/audio-settings', { endpoint: 'https://example.com/analyze', model: 'audio' })).status).toBe(400);
  expect(saved).toBe(false);
});
