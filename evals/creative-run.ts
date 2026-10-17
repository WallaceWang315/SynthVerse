import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { creativeScenarios, satisfiesScenario, type Scenario } from './scenarios';
import { createBrowserRenderer } from './browser-renderer';
import { AgentRunFailure, runMusicAgent, validateScopedPatch, type AgentInput } from '../services/api/agent';
import { MusicToolRuntime } from '../services/api/music-tools';
import type { RegisteredCandidate } from '../src/agent-protocol';
const live = process.argv.includes('--live');
const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'agent';
if (!['agent', 'direct', 'compare'].includes(mode)) throw new Error('mode must be agent, direct or compare');
if (live && (!process.env.MODEL_CHAT_URL || !process.env.MODEL_NAME)) throw new Error('真实模型评测需要 MODEL_CHAT_URL 与 MODEL_NAME；不会降级为演示。');
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 12);
if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('limit must be 1..12');
const scenarios = creativeScenarios().slice(0, limit); let active: Scenario, input: AgentInput, round = 0;
const mock = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk; const request = JSON.parse(raw); round++;
    const tools = request.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: string }) => JSON.parse(m.content));
    const registered = tools.filter((t: { accepted?: boolean; candidateId?: string }) => t.accepted && t.candidateId);
    let callIndex = 0; const call = (name: string, args: unknown) => ({ id: `round-${round}-${name}-${callIndex++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    let message: unknown;
    if (round === 1) message = { tool_calls: [call('get_project_context', {}), call('analyze_music', {})] };
    else if (active.explanationOnly) message = { content: JSON.stringify({ message: '末音D在Am7上不是和弦构成音，可作为延伸色彩。可以试听落到C带来的变化。这里只解释，不修改工程。', candidateIds: [] }) };
    else if (active.followUp && registered.length === 2 && tools.filter((t: { metrics?: unknown }) => t.metrics).length === 2 && !tools.some((t: { basis?: string }) => t.basis === 'parameters-symbolic-and-available-audio-metrics')) message = { tool_calls: [call('compare_candidates', { candidateIds: registered.map((t: { candidateId: string }) => t.candidateId) })] };
    else if (registered.length && tools.some((t: { metrics?: unknown }) => t.metrics)) message = { content: JSON.stringify({ message: '模拟模型已调用工具并收到真实浏览器指标。请试听比较后决定。', candidateIds: registered.map((t: { candidateId: string }) => t.candidateId) }) };
    else if (registered.length) message = { tool_calls: registered.map((t: { candidateId: string }) => call('render_preview', { candidateId: t.candidateId })) };
    else if (active.combine) message = { tool_calls: [call('compose_candidates', { title: active.title, explanation: active.prompt, soundCandidateId: input.parents![0].id, melodyCandidateId: input.parents![1].id })] };
    else if (active.invalidFirst && round === 2) message = { tool_calls: [call('propose_edit', { title: '无效参数', explanation: '验证错误修正', baseRevision: input.project.revision, operations: [{ type: 'set_sound_parameters', values: { brightness: 999 } }] })] };
    else if (active.helper && round === 2) message = { tool_calls: [call(active.helper.name, active.helper.args)] };
    else message = { tool_calls: [call('propose_edit', { title: active.title, explanation: active.prompt, baseRevision: input.project.revision, parentIds: input.parents?.map(c => c.id), operations: active.operations }), ...(active.followUp ? [call('propose_edit', { title: '稍亮的对照', explanation: '亮度28，供比较', baseRevision: input.project.revision, operations: [{ type: 'set_sound_parameters', values: { brightness: 28 } }] })] : [])] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 30 } }));
  } catch { res.writeHead(500); res.end(); }
});
if (!live) await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
const browser = await createBrowserRenderer(); const rows: Record<string, unknown>[] = [];
try {
  await mkdir('evals/fixtures', { recursive: true });
  for (const scenario of scenarios) {
    await writeFile(`evals/fixtures/${scenario.id}.project.json`, JSON.stringify(scenario.project, null, 2));
    for (const executionMode of live && mode === 'compare' ? ['agent', 'direct'] as const : [live ? mode as 'agent' | 'direct' : 'agent']) {
      active = scenario; round = 0; input = { ...scenario, history: [], parents: [] };
      if (scenario.combine) { const runtime = new MusicToolRuntime(input); input.parents = [runtime.register({ title: '音色参考', explanation: '亮度24', patch: { sound: { brightness: 24 } } }).candidate, runtime.register({ title: '旋律参考', explanation: '末音C5', patch: { notes: input.project.notes.map((n,i) => i === 7 ? { ...n, pitch: 72 } : n) } }).candidate]; }
      const original = JSON.stringify(input.project);
      try {
        const config = { endpoint: live ? process.env.MODEL_CHAT_URL : `http://127.0.0.1:${(mock.address() as { port: number }).port}`, model: live ? process.env.MODEL_NAME : 'scripted-mock-not-an-llm', apiKey: live ? process.env.MODEL_API_KEY : undefined, executionMode, renderer: browser.render };
        const reply = await runMusicAgent(input, config, AbortSignal.timeout(45000));
        reply.candidates.forEach(c => validateScopedPatch(input.project, c.patch, input.selection));
        let followUp: unknown, followUpPassed = !scenario.followUp;
        if (scenario.followUp && reply.candidates[0]) { const parent: RegisteredCandidate = reply.candidates[0]; active = { ...scenario, helper: undefined, followUp: undefined, operations: [{ type: 'set_sound_parameters', values: { brightness: parent.project.sound.brightness, release: 0.2 } }] }; input = { ...input, prompt: scenario.followUp, parents: [parent], history: [{ role: 'user', content: scenario.prompt }, { role: 'assistant', content: reply.message }] }; round = 0; const next = await runMusicAgent(input, config, AbortSignal.timeout(45000)); followUp = next; followUpPassed = next.candidates.some(c => c.project.sound.brightness === parent.project.sound.brightness && c.project.sound.release < parent.project.sound.release && c.parentIds.includes(parent.id)); }
        const intent = scenario.explanationOnly ? reply.candidates.length === 0 : reply.candidates.some(c => satisfiesScenario(scenario, c.project));
        const rendered = scenario.explanationOnly || reply.candidates.every(c => c.metrics?.basis === 'browser-offline-audio');
        const recovery = !scenario.invalidFirst || live || reply.trace.events.some(e => e.name === 'propose_edit' && e.status === 'error');
        rows.push({ id: scenario.id, executionMode, passed: intent && rendered && followUpPassed && recovery && JSON.stringify(input.project) === original, intentMatched: intent, audioRenderNeeded: !scenario.explanationOnly, actualAudioRendered: !scenario.explanationOnly && rendered, followUpPassed, errorRecoveryExercised: scenario.invalidFirst ? reply.trace.events.some(e => e.name === 'propose_edit' && e.status === 'error') : null, reply, followUp, manualScores: { requestFit: null, musicalQuality: null, inspiration: null }, manualReview: 'pending' });
      } catch (error) { rows.push({ id: scenario.id, executionMode, passed: false, error: error instanceof Error ? error.message : 'failed', trace: error instanceof AgentRunFailure ? error.trace : undefined, manualReview: 'pending' }); }
    }
  }
  await writeFile('evals/scenarios.json', JSON.stringify(creativeScenarios(), null, 2));
  await mkdir('evals/reports', { recursive: true });
  const path = `evals/reports/creative-${live ? mode + '-live' : 'mock-browser'}-latest.json`;
  const report = { kind: live ? 'live-model-real-browser-render' : 'scripted-mock-real-browser-render', model: live ? process.env.MODEL_NAME : null, generatedAt: new Date().toISOString(), cases: scenarios.length, runs: rows.length, passed: rows.filter(r => r.passed).length, limitation: '自动检查请求中的可测量变化与工程约束；听感、乐理解释、灵感价值需要人工评分。模拟模型通过率不代表真实模型质量。', rows };
  await writeFile(path, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ kind: report.kind, runs: report.runs, passed: report.passed, report: path }, null, 2)); if (report.passed !== rows.length) process.exitCode = 1;
} finally { await browser.close(); mock.closeAllConnections(); if (mock.listening) await new Promise<void>(resolve => mock.close(() => resolve())); }
