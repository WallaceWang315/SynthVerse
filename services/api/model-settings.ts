import type http from 'node:http';
import { z } from 'zod';

export type ModelConfig = { endpoint?: string; model?: string; apiKey?: string; executionMode?: 'agent' | 'direct' };
export type SettingsStore = { save: (config: ModelConfig) => Promise<void>; storage: string; warning?: string };
export function normalizeEndpoint(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含密码、查询参数或片段。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('云端接口请使用 HTTPS；本机服务可使用 HTTP。');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path;
  return url.href;
}
const inputSchema = z.object({ endpoint: z.string().trim().min(1).max(2000), model: z.string().trim().min(1).max(200), apiKey: z.string().trim().max(4096).optional(), clearKey: z.boolean().optional() }).strict();
export function parseSettings(input: unknown, current: ModelConfig): ModelConfig {
  const data = inputSchema.parse(input), endpoint = normalizeEndpoint(data.endpoint);
  const sameEndpoint = current.endpoint && normalizeEndpoint(current.endpoint) === endpoint;
  return { endpoint, model: data.model, apiKey: data.clearKey ? undefined : data.apiKey || (sameEndpoint ? current.apiKey : undefined), executionMode: 'agent' };
}
export function createSettingsHandler(config: ModelConfig, store: SettingsStore) {
  const snapshot = () => ({ endpoint: config.endpoint ?? '', model: config.model ?? '', hasKey: Boolean(config.apiKey), storage: store.storage, warning: store.warning ?? '' });
  let updating = false, testing = false;
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!['/api/model-settings', '/api/model-settings/test'].includes(req.url ?? '')) return false;
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/api/model-settings') { send(200, snapshot()); return true; }
    if (!['PUT', 'POST', 'DELETE'].includes(req.method ?? '')) { send(405, { error: '不支持此操作。' }); return true; }
    const test = req.url?.endsWith('/test') === true;
    if ((test && req.method !== 'POST') || (!test && req.method === 'POST')) { send(405, { error: '不支持此操作。' }); return true; }
    if (test ? testing : updating) { send(409, { error: '操作正在进行，请稍后重试。' }); return true; }
    if (test) testing = true; else updating = true;
    try {
      if (req.method === 'DELETE') {
        await store.save({}); config.endpoint = undefined; config.model = undefined; config.apiKey = undefined; config.executionMode = 'agent'; store.warning = undefined;
        send(200, snapshot()); return true;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: '需要 JSON 请求。' }); return true; }
      let body = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 12000) { send(413, { error: '设置过大。' }); return true; } body += chunk; }
      let next: ModelConfig;
      try { next = parseSettings(JSON.parse(body), config); } catch { send(400, { error: '请填写有效的 HTTPS 接口地址（本机可用 HTTP）和模型名，地址中不要包含 Key 或查询参数。' }); return true; }
      if (!test) {
        await store.save(next); Object.assign(config, next); store.warning = undefined;
        send(200, snapshot()); return true;
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      try {
        const response = await fetch(next.endpoint!, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(next.apiKey ? { Authorization: `Bearer ${next.apiKey}` } : {}) }, body: JSON.stringify({ model: next.model, messages: [{ role: 'user', content: 'Call the connection_check tool with no arguments.' }], tools: [{ type: 'function', function: { name: 'connection_check', description: 'Checks music tool calling support.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }], tool_choice: { type: 'function', function: { name: 'connection_check' } }, max_tokens: 128, stream: false }) });
        if (!response.ok) { await response.body?.cancel(); send(502, { error: `模型服务返回 ${response.status}。请检查地址、模型名、Key，以及模型是否支持工具调用。` }); return true; }
        const reader = response.body?.getReader(); let text = ''; let count = 0;
        if (reader) { const decoder = new TextDecoder(); while (true) { const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.length; if (count > 64000) { await reader.cancel(); throw new Error('oversized'); } text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
        const data = JSON.parse(text);
        const toolCalling = data.choices?.[0]?.message?.tool_calls?.some((call: any) => call.type === 'function' && call.function?.name === 'connection_check' && call.function?.arguments?.trim() === '{}') === true;
        send(200, { ok: true, toolCalling, message: toolCalling ? '连接成功，模型已返回工具调用。保存后即可使用。' : '接口可连接，但未返回预期的工具调用；请确认模型支持 Function Calling。' });
      } catch { send(502, { error: controller.signal.aborted ? '连接测试超时或已取消。' : '连接测试失败，请检查接口地址、网络与服务响应格式。' }); }
      finally { clearTimeout(timer); }
    } catch { send(500, { error: '设置保存失败，请检查数据目录权限或系统密钥服务。' }); }
    finally { if (test) testing = false; else updating = false; }
    return true;
  };
}
