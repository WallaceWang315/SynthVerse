import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { initialProject, type Patch } from '../src/domain';
import { runMusicAgent, AgentRunFailure, validateScopedPatch, type AgentInput } from '../services/api/agent';
import { createBrowserRenderer } from './browser-renderer';
import { agentLimits } from '../src/creative-session';
import { musicToolDefinitions } from '../services/api/music-tools';

const live = process.argv.includes('--live');
const variants = (process.argv.find(a => a.startsWith('--variants='))?.split('=')[1] ?? 'direct,quick,compare,no-memory,no-knowledge').split(',');
if (variants.some(v => !['direct', 'quick', 'compare', 'no-memory', 'no-knowledge'].includes(v))) throw new Error('Unknown study variant');
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 4);
if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw new Error('limit must be 1..4');
if (live && (!process.env.MODEL_CHAT_URL || !process.env.MODEL_NAME)) throw new Error('Live study requires configured model; no demo fallback.');
const silent = structuredClone(initialProject); silent.sound.oscillators.forEach(o => { o.enabled = false; }); silent.sound.glass = 0; silent.sound.noise = 0; silent.sound.sub = 0;
const low = structuredClone(initialProject); low.notes = []; low.layers = { melody: false, harmony: true, bass: false }; low.chords = [{ id: 'low-chord', name: 'Cmaj7', pitches: [48, 52, 55, 59], start: 0, duration: 8 }];
const scenarios = [
  { id: 'silent-source', prompt: '当前音色可能无声。保留旋律和和弦，给出两个可试听的柔和音色方案，检查静音并在必要时修正一次。', project: silent, scope: 'sound', preferences: [], feedback: [] },
  { id: 'open-voicing', prompt: '保留音色与和弦音级，比较密集与开放排列。避免三个以上C4以下构成音；根据检查结果修正一次。', project: low, scope: 'harmony', preferences: [], feedback: [] },
  { id: 'remember-release', prompt: '继续探索柔和音色，沿用我明确记录的尾音偏好，保留旋律与和弦。', project: structuredClone(initialProject), scope: 'sound', preferences: ['尾音固定为0.2秒'], feedback: [{ candidateId: 'previous-candidate', title: '上一版', choice: 'dislike' as const, note: '0.65秒尾音太长', createdAt: '2026-10-09T00:00:00.000Z' }] },
  { id: 'grounded-pad', prompt: '柔和的梦幻铺底应怎样设计？检索内置指南，给出有来源的两个音色候选，保留旋律与和弦。', project: structuredClone(initialProject), scope: 'sound', preferences: [], feedback: [] },
].slice(0, limit);
let active = scenarios[0], variant = '', round = 0;
const mock = http.createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk; const request = JSON.parse(body); round++;
    const context = JSON.parse(request.messages.findLast((m: any) => m.role === 'user' && m.content.includes('"project"')).content);
    const toolResults = request.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    const registered = toolResults.filter((t: any) => t.accepted && t.candidateId);
    const retrieved = toolResults.find((t: any) => t.entries)?.entries ?? [];
    const compared = toolResults.filter((t: any) => t.basis === 'parameters-symbolic-and-available-audio-metrics');
    let callId = 0; const call = (name: string, args: unknown) => ({ id: `${round}-${callId++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const comparison = !['direct', 'quick'].includes(variant);
    const patches: Patch[] = active.id === 'open-voicing'
      ? [{ chords: active.project.chords }, { chords: [{ ...active.project.chords[0], pitches: [48, 64, 67, 71] }] }]
      : [{ sound: { brightness: 24, ...(active.id === 'remember-release' ? { release: context.preferences?.length ? 0.2 : 1 } : {}) } }, { sound: { brightness: 36, ...(active.id === 'silent-source' ? { oscillators: initialProject.sound.oscillators } : {}), ...(active.id === 'remember-release' ? { release: context.preferences?.length ? 0.2 : 1 } : {}) } }];
    let message: unknown;
    if (variant === 'direct') message = { content: JSON.stringify({ message: '脚本直接生成对照', candidates: [{ title: 'A', explanation: '脚本基线', patch: patches[0] }] }) };
    else if (round === 1) {
      const calls = [];
      if (comparison) calls.push(call('plan_creation', { goal: active.prompt, preserve: ['未请求修改的内容'], preserveFields: active.scope === 'sound' ? ['notes', 'chords'] : ['sound'], alternatives: ['A', 'B'], checks: ['silence', 'low-register-density', 'user-listening'] }));
      if (variant !== 'no-knowledge') calls.push(call('search_music_knowledge', { query: active.prompt }));
      if (!calls.length) calls.push(call('get_project_context', {}));
      message = { tool_calls: calls };
    } else if (!registered.length) message = { tool_calls: patches.slice(0, comparison ? 2 : 1).map((patch, i) => call('propose_edit', { title: i ? 'B' : 'A', explanation: '脚本方案用于验证机制，非真实模型判断', baseRevision: active.project.revision, operations: patch.chords ? [{ type: 'update_chord', chordId: 'low-chord', changes: { pitches: patch.chords[0].pitches } }] : [{ type: 'set_sound_parameters', values: patch.sound }], knowledgeIds: retrieved.slice(0, 1).map((e: any) => e.id) })) };
    else if (registered.some((c: any) => !toolResults.some((t: any) => t.candidateId === c.candidateId && t.metrics))) message = { tool_calls: registered.filter((c: any) => !toolResults.some((t: any) => t.candidateId === c.candidateId && t.metrics)).map((c: any) => call('render_preview', { candidateId: c.candidateId })) };
    else if (comparison && (!compared.length || (registered.length === 3 && compared.length < 2))) message = { tool_calls: [call('compare_candidates', { candidateIds: registered.map((c: any) => c.candidateId) })] };
    else if (comparison && registered.length === 2 && ['silent-source', 'open-voicing'].includes(active.id)) {
      const source = compared[0].candidates[0]; const evidence = source.assessment.findings[0]?.code;
      message = evidence ? { tool_calls: [call('revise_candidate', { candidateId: source.id, title: 'A 修正版', explanation: '依据检查结果修正', evidenceCodes: [evidence], operations: active.id === 'silent-source' ? [{ type: 'set_sound_parameters', values: { oscillators: initialProject.sound.oscillators } }] : [{ type: 'update_chord', chordId: 'low-chord', changes: { pitches: [48, 67, 71, 76] } }] })] } : { content: JSON.stringify({ message: '未触发检查项，无需修正。', candidateIds: registered.map((c: any) => c.candidateId) }) };
    } else message = { content: JSON.stringify({ message: '脚本工作流完成；音频指标来自浏览器实测，听感需人工评价。', candidateIds: registered.map((c: any) => c.candidateId) }) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }));
  } catch { res.writeHead(500); res.end(); }
});
if (!live) await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
const browser = await createBrowserRenderer(); const rows: Record<string, unknown>[] = [];
try {
  for (const scenario of scenarios) for (const name of variants) {
    active = scenario; variant = name; round = 0;
    const input: AgentInput = { ...structuredClone(scenario), history: [], selection: [], workflowMode: ['direct', 'quick'].includes(name) ? 'quick' : 'compare' };
    const original = JSON.stringify(input.project);
    try {
      const reply = await runMusicAgent(input, { endpoint: live ? process.env.MODEL_CHAT_URL : `http://127.0.0.1:${(mock.address() as { port: number }).port}`, model: live ? process.env.MODEL_NAME : 'scripted-control-not-llm', apiKey: live ? process.env.MODEL_API_KEY : undefined, executionMode: name === 'direct' ? 'direct' : 'agent', renderer: browser.render, knowledgeEnabled: name !== 'no-knowledge', memoryEnabled: name !== 'no-memory' }, AbortSignal.timeout(agentLimits(input.workflowMode).timeoutMs));
      reply.candidates.forEach(c => validateScopedPatch(input.project, c.patch, input.selection));
      const taskSuccess = reply.candidates.some(c => {
        const originalMusic = isDeepStrictEqual(c.project.notes, scenario.project.notes) && isDeepStrictEqual(c.project.chords, scenario.project.chords);
        if (scenario.id === 'silent-source') return originalMusic && (c.metrics?.rms ?? 0) > 0.00001;
        if (scenario.id === 'open-voicing') return isDeepStrictEqual(c.project.sound, scenario.project.sound) && c.project.chords.length === 1 && c.project.chords.every(ch => ch.pitches.filter(p => p < 60).length < 3 && ch.start === 0 && ch.duration === 8 && isDeepStrictEqual([...new Set(ch.pitches.map(p => p % 12))].sort(), [0, 4, 7, 11].sort()));
        if (scenario.id === 'remember-release') return originalMusic && c.project.sound.release === 0.2;
        return originalMusic && Boolean(c.citations?.length);
      });
      rows.push({ scenario: scenario.id, variant: name, completed: true, taskSuccess, originalUnchanged: JSON.stringify(input.project) === original, constraintValid: true, revised: reply.candidates.some(c => c.revisionEvidence?.length), actualAudioRendered: reply.candidates.length > 0 && reply.candidates.every(c => Boolean(c.metrics)), durationMs: reply.trace.durationMs, usage: reply.trace.usage ?? null, toolCalls: reply.trace.events.filter(e => musicToolDefinitions.some(t => t.function.name === e.name)).length, reply, blindListeningScores: null });
    } catch (error) { rows.push({ scenario: scenario.id, variant: name, completed: false, taskSuccess: false, error: error instanceof AgentRunFailure && error.cause instanceof Error ? error.cause.message : 'Study failed', trace: error instanceof AgentRunFailure ? error.trace : undefined }); }
  }
  await mkdir('evals/reports', { recursive: true });
  const path = `evals/reports/agent-study-${live ? 'live' : 'scripted'}-latest.json`;
  await writeFile(path, JSON.stringify({ kind: live ? 'live-model-real-browser' : 'scripted-controls-real-browser', model: live ? process.env.MODEL_NAME : null, generatedAt: new Date().toISOString(), limitations: '脚本对照刻意设置不同策略，仅验证机制与测量管道，不代表模型质量提升。真实评测也需多次重复与人工盲听。不同变体调用预算不同，应同时比较成本与耗时。', rows }, null, 2));
  console.log(JSON.stringify({ report: path, runs: rows.length, completed: rows.filter(r => r.completed).length, rows: rows.map(({ scenario, variant, completed, taskSuccess, revised }) => ({ scenario, variant, completed, taskSuccess, revised })) }, null, 2));
  if (rows.some(r => !r.completed)) process.exitCode = 1;
} finally { await browser.close(); mock.closeAllConnections(); if (mock.listening) await new Promise<void>(resolve => mock.close(() => resolve())); }
