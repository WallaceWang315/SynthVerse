import { runCreativeSession, type CreativeConfig } from './creative-orchestrator';
import { explorationTimeout, probePacketSchema, type Probe } from '../../src/listening-protocol';
import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { agentLimits } from '../../src/creative-session';
import { z } from 'zod';
import { agentRequestSchema, audioMetricsSchema, type RegisteredCandidate } from '../../src/agent-protocol';
import { AgentOutputError, AgentRunFailure, ProviderError, runMusicAgent, type Trace } from './agent';
type Config = CreativeConfig;
type Run = { token: string; createdAt: number; controller: AbortController; state: 'running' | 'complete' | 'error' | 'cancelled'; events: Trace['events']; trace?: Trace; result?: Awaited<ReturnType<typeof runMusicAgent>>; error?: string; pending?: { id: string; candidate: RegisteredCandidate; probes?: Probe[]; resolve: (data: unknown) => void; reject: (error: Error) => void } };
const send = (res: http.ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req: http.IncomingMessage) { if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 JSON。'); let text = '', size = 0; for await (const chunk of req) { size += chunk.length; if (size > 8000000) throw new Error('请求过大。'); text += chunk; } return JSON.parse(text); }
export function createRunBridge(config: Config) {
  const runs = new Map<string, Run>();
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    if (!req.url?.startsWith('/api/runs')) return false;
    try {
      if (req.method === 'POST' && req.url === '/api/runs') {
        const input = agentRequestSchema.parse(await body(req));
        const ids = input.selection.map(id => typeof id === 'number' ? input.project.notes[id]?.id : id);
        if (new Set(ids).size !== ids.length || ids.some(id => !input.project.notes.some(n => n.id === id))) throw new Error('音符选区无效。');
        for (const [id, run] of runs) if (Date.now() - run.createdAt > 600000) { run.controller.abort(); runs.delete(id); }
        if ([...runs.values()].filter(r => r.state === 'running').length >= 8 || runs.size >= 200) { send(res, 429, { error: '探索任务过多，请稍后重试。' }); return true; }
        const id = randomUUID(), token = randomUUID(); const controller = new AbortController();
        const run: Run = { token, controller, createdAt: Date.now(), state: 'running', events: [] }; runs.set(id, run);
        const timer = setTimeout(() => controller.abort(), (explorationTimeout(input.exploration) ?? agentLimits(input.workflowMode).timeoutMs)); timer.unref();
        controller.signal.addEventListener('abort', () => { run.pending?.reject(new Error('任务已取消。')); run.pending = undefined; }, { once: true });
        const renderer: Config['renderer'] = (candidate, signal) => new Promise((resolve, reject) => {
          signal.throwIfAborted(); if (run.pending) return reject(new Error('渲染任务正在执行。'));
          run.pending = { id: randomUUID(), candidate, resolve: data => { try { resolve(audioMetricsSchema.parse(data)); } catch { reject(new Error('音频指标无效。')); } }, reject };
        });
        const audioExecutor: Config['audioExecutor'] = (candidate, probes, signal) => new Promise((resolve, reject) => {
          signal.throwIfAborted(); if (run.pending) return reject(new Error('渲染任务正在执行。'));
          run.pending = { id: randomUUID(), candidate, probes, resolve: data => { try { resolve(z.array(probePacketSchema).min(1).max(4).parse(data)); } catch { reject(new Error('试听音频无效。')); } }, reject };
        });
        void runCreativeSession(input, { ...config, perception: config.perception ? { ...config.perception } : undefined, renderer, audioExecutor, onEvent: event => { run.events.push(event); } }, controller.signal).then(result => { if (controller.signal.aborted) return; run.result = result; run.state = 'complete'; }).catch(error => {
          const cause = error instanceof AgentRunFailure ? error.cause : error;
          run.state = controller.signal.aborted ? 'cancelled' : 'error'; run.error = controller.signal.aborted ? '任务超时或已取消。' : cause instanceof ProviderError || cause instanceof AgentOutputError ? cause.message : 'Agent 未完成，请检查模型配置、工具参数和工程限制。'; if (error instanceof AgentRunFailure) { run.events = error.trace.events; run.trace = error.trace; }
        }).finally(() => { clearTimeout(timer); run.pending = undefined; });
        send(res, 202, { runId: id, token }); return true;
      }
      const match = /^\/api\/runs\/([a-f0-9-]+)(?:\/(tool-results))?$/.exec(req.url); const run = match && runs.get(match[1]);
      if (!run || req.headers.authorization !== `Bearer ${run.token}`) { send(res, 404, { error: '任务不存在或访问凭证无效。' }); return true; }
      if (req.method === 'DELETE' && !match![2]) { run.state = 'cancelled'; run.controller.abort(); send(res, 200, { state: run.state }); return true; }
      if (req.method === 'GET' && !match![2]) { send(res, 200, { state: run.state, events: run.events, trace: run.trace, result: run.result, error: run.error, renderJob: run.pending && !run.pending.probes ? { id: run.pending.id, candidate: run.pending.candidate } : undefined, audioJob: run.pending?.probes ? { id: run.pending.id, candidate: run.pending.candidate, probes: run.pending.probes } : undefined }); return true; }
      if (req.method === 'POST' && match![2]) {
        const data = z.object({ jobId: z.string().uuid(), metrics: audioMetricsSchema.optional(), packets: z.array(probePacketSchema).min(1).max(4).optional(), error: z.string().max(100).optional() }).strict().refine(d => [d.metrics, d.packets, d.error].filter(Boolean).length === 1).parse(await body(req));
        const pending = run.pending; if (!pending || pending.id !== data.jobId || run.state !== 'running' || run.controller.signal.aborted) { send(res, 409, { error: '渲染任务已过期或已经提交。' }); return true; }
        if (!data.error && (Boolean(pending.probes) !== Boolean(data.packets))) { send(res, 400, { error: '反馈类型与任务不符。' }); return true; }
        run.pending = undefined; if (data.packets) pending.resolve(data.packets); else if (data.metrics) pending.resolve(data.metrics); else pending.reject(new Error('浏览器音频渲染失败。')); send(res, 200, { accepted: true }); return true;
      }
      send(res, 405, { error: '不支持此操作。' }); return true;
    } catch { send(res, 400, { error: '任务数据或音符选区无效。' }); return true; }
  };
}
