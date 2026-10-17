import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../services/api/server';
import { normalizeEndpoint, parseSettings, type ModelConfig } from '../services/api/model-settings';
const servers: http.Server[] = [];
async function listen(server: http.Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
const request = (url: string, method: string, data?: unknown, headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
describe('user model configuration', () => {
  it('normalizes compatible URLs and rejects embedded credentials or remote plaintext', () => {
    expect(normalizeEndpoint('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
    expect(normalizeEndpoint('http://localhost:11434')).toBe('http://localhost:11434/v1/chat/completions');
    for (const url of ['http://example.com', 'https://key@example.com', 'https://example.com?key=secret', 'file:///secret']) expect(() => normalizeEndpoint(url)).toThrow();
  });
  it('never reuses a saved key for a different endpoint, supports explicit deletion', () => {
    const current = { endpoint: 'https://example.com/v1/chat/completions', apiKey: 'secret', model: 'model' };
    expect(parseSettings({ endpoint: 'https://example.com/v1', model: 'new' }, current).apiKey).toBe('secret');
    expect(parseSettings({ endpoint: 'https://other.example/v1', model: 'new' }, current).apiKey).toBeUndefined();
    expect(parseSettings({ endpoint: current.endpoint, model: 'new', clearKey: true }, current).apiKey).toBeUndefined();
  });
  it('saves without restarting, exposes only redacted state, clears and protects desktop sessions', async () => {
    let stored: ModelConfig = {};
    const base = await listen(createApiServer({ desktopToken: 'test-session', settingsStore: { storage: 'test', save: async config => { stored = config; } } }));
    const url = `${base}/api/model-settings`, headers = { 'x-synthverse-desktop': 'test-session' };
    expect((await fetch(url)).status).toBe(403);
    const result = await request(url, 'PUT', { endpoint: 'https://example.com/v1', model: 'user-model', apiKey: 'not-for-browser' }, headers);
    const body = await result.text(); expect(body).not.toContain('not-for-browser'); expect(JSON.parse(body).hasKey).toBe(true);
    expect(stored.apiKey).toBe('not-for-browser');
    expect(await (await fetch(`${base}/api/status`, { headers })).json()).toEqual({ mode: 'model', model: 'user-model' });
    await request(url, 'DELETE', undefined, headers);
    expect(stored).toEqual({}); expect((await (await fetch(`${base}/api/status`, { headers })).json()).mode).toBe('demo');
  });
  it('tests actual tool support without saving draft settings or exposing upstream errors', async () => {
    let received: any, authorization: string | undefined, failed = false;
    const provider = await listen(http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk; received = JSON.parse(body); authorization = req.headers.authorization;
      if (failed) { res.writeHead(401); res.end('secret provider body'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'connection_check', arguments: '{}' } }] } }] }));
    }));
    const base = await listen(createApiServer());
    const data = { endpoint: provider, model: 'test', apiKey: 'secret' };
    const probe = await (await request(`${base}/api/model-settings/test`, 'POST', data)).json();
    expect(probe.toolCalling).toBe(true); expect(authorization).toBe('Bearer secret'); expect(received.messages).toHaveLength(1);
    expect((await (await fetch(`${base}/api/status`)).json()).mode).toBe('demo');
    failed = true; const result = await request(`${base}/api/model-settings/test`, 'POST', data); expect(result.status).toBe(502); expect(await result.text()).not.toContain('secret provider body');
  });
  it('rejects foreign origins and leaves active settings unchanged when persistence fails', async () => {
    const base = await listen(createApiServer({ model: 'old', endpoint: 'https://old.example/v1/chat/completions', settingsStore: { storage: 'test', save: async () => { throw new Error('disk path secret'); } } }));
    const data = { endpoint: 'https://new.example/v1', model: 'new' };
    expect((await request(`${base}/api/model-settings`, 'PUT', data, { origin: 'https://foreign.example' })).status).toBe(403);
    const failure = await request(`${base}/api/model-settings`, 'PUT', data); expect(failure.status).toBe(500); expect(await failure.text()).not.toContain('disk path');
    expect((await (await fetch(`${base}/api/status`)).json()).model).toBe('old');
  });
});
