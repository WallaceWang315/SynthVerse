import type http from 'node:http';
import { z } from 'zod';
import { normalizeAudioEndpoint, type PerceptionConfig } from './audio-perception';
import type { ModelConfig, SettingsStore } from './model-settings';
const schema = z.object({ endpoint: z.string().max(2000), model: z.string().min(1).max(200), apiKey: z.string().max(4096).optional(), clearKey: z.boolean().optional(), basis: z.enum(['audio-model', 'embedding-model']).default('audio-model') }).strict();
export function createAudioSettingsHandler(config: ModelConfig, store: SettingsStore) {
  let saving = false;
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url !== '/api/audio-settings') return false;
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const snapshot = () => ({ endpoint: config.perception?.endpoint ?? '', model: config.perception?.model ?? '', hasKey: Boolean(config.perception?.apiKey), basis: config.perception?.basis ?? 'audio-model', storage: store.storage, protocol: 'synthverse-audio-v1' });
    if (req.method === 'GET') { send(200, snapshot()); return true; }
    if (!['PUT', 'DELETE'].includes(req.method ?? '')) { send(405, { error: '不支持此操作。' }); return true; }
    if (saving) { send(409, { error: '正在保存，请稍后重试。' }); return true; } saving = true;
    try {
      let perception: PerceptionConfig | undefined;
      if (req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('content type');
        let body = '', size = 0; for await (const chunk of req) { size += chunk.length; if (size > 12000) throw new Error('size'); body += chunk; }
        const data = schema.parse(JSON.parse(body)); const endpoint = normalizeAudioEndpoint(data.endpoint);
        perception = { endpoint, model: data.model.trim(), basis: data.basis, apiKey: data.clearKey ? undefined : data.apiKey?.trim() || (endpoint === config.perception?.endpoint ? config.perception.apiKey : undefined) };
        if (!perception.model) throw new Error('model');
      }
      await store.save({ ...config, perception }); config.perception = perception; send(200, snapshot());
    } catch { send(400, { error: '保存失败。仅支持本机 127.0.0.1 / [::1] 音频适配器；请检查配置及存储权限。' }); }
    finally { saving = false; }
    return true;
  };
}
