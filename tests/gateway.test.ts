import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../services/api/server';
import { initialProject } from '../src/domain';
const servers: http.Server[] = [];
async function listen(server: http.Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => { s.closeAllConnections(); s.close(e => e ? reject(e) : resolve()); }))); });
const post = (url: string) => fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '音色更柔和', scope: 'sound', project: initialProject }) });
describe('model gateway', () => {
  it('runs a labelled local demo when no model is configured', async () => {
    const url = await listen(createApiServer()); const res = await post(url); const reply = await res.json();
    expect(res.status).toBe(200); expect(reply.mode).toBe('demo'); expect(reply.candidates).toHaveLength(2);
  });
  it('passes scope, actual project and server-only credentials to a configured provider', async () => {
    let received: any; let auth: string | undefined;
    const upstream = await listen(http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      received = JSON.parse(body); auth = req.headers.authorization;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '依据参数做柔和候选', candidates: [{ title: '柔和', explanation: '降低明亮度', patch: { sound: { brightness: 20 } } }] }) } }] }));
    }));
    const url = await listen(createApiServer({ endpoint: `${upstream}/v1/chat/completions`, model: 'test-model', apiKey: 'test-only-secret', executionMode: 'direct' }));
    const response = await post(url); const reply = await response.json();
    expect(reply.mode).toBe('model'); expect(reply.candidates[0].patch.sound.brightness).toBe(20);
    const user = JSON.parse(received.messages.at(-1).content);
    expect(user.scope).toBe('sound'); expect(user.project.sound).toEqual(initialProject.sound);
    expect(auth).toBe('Bearer test-only-secret'); expect(JSON.stringify(reply)).not.toContain('test-only-secret');
    const status = await (await fetch(`${url}/api/status`)).json(); expect(status).toEqual({ mode: 'model', model: 'test-model' });
  });
  it('rejects malformed or out-of-range model commands rather than applying them', async () => {
    const upstream = await listen(http.createServer((_, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '错误输出', candidates: [{ title: '无效', explanation: '测试', patch: { sound: { brightness: 999 } } }] }) } }] })); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' }));
    const response = await post(url); expect(response.status).toBe(400); expect((await response.json()).error).toContain('校验失败');
  });
  it('reports provider failures without silently switching to demo or exposing upstream text', async () => {
    const upstream = await listen(http.createServer((_, res) => { res.statusCode = 401; res.end('private provider detail'); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' }));
    const response = await post(url); expect(response.status).toBe(502); const text = await response.text(); expect(text).toContain('401'); expect(text).not.toContain('private provider detail');
  });
});
