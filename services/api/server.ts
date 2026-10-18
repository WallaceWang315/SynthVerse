import { createAudioSettingsHandler } from './audio-settings';
import { runCreativeSession } from './creative-orchestrator';
import { explorationTimeout } from '../../src/listening-protocol';
import type { ModelConfig } from './model-settings';
import { createSettingsHandler, type SettingsStore } from './model-settings';
import { createRunBridge } from './run-bridge';
import { agentRequestSchema } from '../../src/agent-protocol';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { agentLimits } from '../../src/creative-session';
import { projectSchema } from '../../src/domain';
import { AgentOutputError, AgentRunFailure, ProviderError, runMusicAgent } from './agent';
const requestSchema = agentRequestSchema;
function send(res: http.ServerResponse, status: number, data: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
export function createApiServer(options: { perception?: ModelConfig['perception']; endpoint?: string; model?: string; apiKey?: string; executionMode?: 'agent' | 'direct'; settingsStore?: SettingsStore; desktopToken?: string; allowedOrigins?: string[] } = {}) {
  const config: ModelConfig = { perception: options.perception, endpoint: options.endpoint, model: options.model, apiKey: options.apiKey, executionMode: options.executionMode };
  const bridge = createRunBridge(config);
  const store = options.settingsStore ?? { save: async () => {}, storage: '仅本次运行；退出服务后清除，在桌面版可加密保存。' };
  const settings = createSettingsHandler(config, store);
  const audioSettings = createAudioSettingsHandler(config, store);
  let settingsMutation = false;
  return http.createServer(async (req, res) => {
    if (options.desktopToken && req.headers['x-synthverse-desktop'] !== options.desktopToken) return send(res, 403, { error: '无效的应用会话。' });
    const origin = req.headers.origin;
    if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:8787', ...(options.allowedOrigins ?? [])].includes(origin)) return send(res, 403, { error: '不允许的来源。' });
    const mutatesSettings = ['/api/audio-settings', '/api/model-settings'].includes(req.url ?? '') && ['PUT', 'DELETE'].includes(req.method ?? '');
    if (mutatesSettings && settingsMutation) return send(res, 409, { error: '另一项模型设置正在保存，请稍后重试。' });
    if (mutatesSettings) settingsMutation = true;
    try { if (await audioSettings(req, res)) return; if (await settings(req, res)) return; }
    finally { if (mutatesSettings) settingsMutation = false; }
    if (await bridge(req, res)) return;
    if (req.url === '/api/status' && req.method === 'GET') return send(res, 200, { mode: config.endpoint && config.model ? 'model' : 'demo', model: config.endpoint && config.model ? config.model : null });
    if (req.url !== '/api/chat' || req.method !== 'POST') return send(res, 404, { error: '接口不存在。' });
    const controller = new AbortController(); let timer = setTimeout(() => controller.abort(), 45000);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: '需要 JSON 请求。' });
      let body = ''; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 128000) return send(res, 413, { error: '请求过大。' }); body += chunk.toString(); }
      const input = requestSchema.parse(JSON.parse(body)); if (input.selection.some(i => typeof i === 'number' ? i >= input.project.notes.length : !input.project.notes.some(n => n.id === i)) || new Set(input.selection).size !== input.selection.length) return send(res, 400, { error: '音符选区无效。' });
      clearTimeout(timer); timer = setTimeout(() => controller.abort(), (explorationTimeout(input.exploration) ?? agentLimits(input.workflowMode).timeoutMs));
      send(res, 200, await runCreativeSession(input, { ...config }, controller.signal));
    } catch (error) {
      if (res.destroyed) return;
      const cause = error instanceof AgentRunFailure ? error.cause : error;
      const status = controller.signal.aborted ? 504 : cause instanceof ProviderError ? 502 : 400;
      send(res, status, { error: controller.signal.aborted ? '模型请求超时或已取消。' : cause instanceof ProviderError || cause instanceof AgentOutputError ? cause.message : cause instanceof z.ZodError ? '数据校验失败，请调整输入或模型输出。' : '请求未完成，请检查输入、锁定条件和模型服务配置。', ...(error instanceof AgentRunFailure ? { trace: error.trace } : {}) });
    } finally { clearTimeout(timer); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.env.MODEL_CHAT_URL?.trim(); const model = process.env.MODEL_NAME?.trim();
  createApiServer({ endpoint, model, apiKey: process.env.MODEL_API_KEY, executionMode: process.env.MODEL_EXECUTION_MODE === 'direct' ? 'direct' : 'agent' }).listen(8787, '127.0.0.1', () => console.log(`SynthVerse gateway: http://127.0.0.1:8787 (${endpoint && model ? 'configured model' : 'local rule demo'})`));
}
