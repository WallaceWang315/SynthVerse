import { mkdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { listeningScenarios } from './listening-scenarios';
import { createBrowserRenderer } from './browser-renderer';
import { runCreativeSession } from '../services/api/creative-orchestrator';
import { runMusicAgent, type AgentInput } from '../services/api/agent';
import { MusicToolRuntime } from '../services/api/music-tools';
import { applyPatch, type Patch } from '../src/domain';
import { buildCreationBrief } from '../src/creation-brief';
import { validateBrief } from '../src/creation-policy';
import { validateSelection } from '../src/commands';
import { normalizeAudioEndpoint } from '../services/api/audio-perception';
import type { RegisteredCandidate } from '../src/agent-protocol';

const live = process.argv.includes('--live');
const limit = Number(process.argv.find(x => x.startsWith('--limit='))?.split('=')[1] ?? 6);
const variants = (process.argv.find(x => x.startsWith('--variants='))?.split('=')[1] ?? 'signals,collaborative').split(',');
if (!Number.isInteger(limit) || limit < 1 || limit > 30 || variants.some(v => !['role-only', 'signals', 'audio-model', 'collaborative'].includes(v))) throw new Error('limit must be 1..30; variants: role-only,signals,audio-model,collaborative');
if (live && (!process.env.MODEL_CHAT_URL || !process.env.MODEL_NAME)) throw new Error('Live mode requires MODEL_CHAT_URL and MODEL_NAME; no silent demo fallback.');
if (variants.includes('audio-model') && (!live || !process.env.AUDIO_ANALYZE_URL || !process.env.AUDIO_MODEL_NAME)) throw new Error('audio-model arm requires --live and a configured local audio adapter.');
const perception = live && process.env.AUDIO_ANALYZE_URL && process.env.AUDIO_MODEL_NAME ? { endpoint: normalizeAudioEndpoint(process.env.AUDIO_ANALYZE_URL), model: process.env.AUDIO_MODEL_NAME, apiKey: process.env.AUDIO_API_KEY } : undefined;
const all = listeningScenarios();
await mkdir('evals/reports', { recursive: true });
await writeFile('evals/reports/listening-scenarios.json', JSON.stringify(all, null, 2));
const browser = await createBrowserRenderer();
const rows: Record<string, unknown>[] = [];
try {
  for (const scenario of all.slice(0, limit)) for (const variant of variants) {
    const input: AgentInput = { ...scenario, history: [], exploration: variant === 'role-only' ? 'standard' : variant === 'collaborative' ? 'collaborative' : 'listening' };
    const before = structuredClone(input.project);
    const driver: typeof runMusicAgent = live ? runMusicAgent : async (i, config, signal) => {
      signal.throwIfAborted(); const runtime = new MusicToolRuntime(i, undefined, signal, config.brief);
      let patch: Patch = scenario.expectedPatch;
      if (runtime.brief.role === 'composition') patch = { notes: i.project.notes.map((n, index) => index ? n : { ...n, pitch: n.pitch + 1 }) };
      if (runtime.brief.role === 'coordinator') patch = { ...patch, notes: i.project.notes.map((n, index) => index ? n : { ...n, pitch: n.pitch + 1 }) };
      const candidates = scenario.noChange ? [] : [runtime.register({ title: '脚本控制候选', explanation: '仅验证机制，不能代表模型创作能力。', patch }).candidate];
      return { candidates, message: scenario.noChange ? '仅解释，不修改。' : '脚本控制候选', mode: 'demo', trace: { requestId: 'scripted', events: [], durationMs: 0 } };
    };
    try {
      if (scenario.task === 'reference') {
        const target = { id: 'reference', baseRevision: 0, title: '参考', explanation: '合成参考', patch: {}, project: applyPatch(before, { sound: { brightness: 35 } }, 0), parentIds: [] } satisfies RegisteredCandidate;
        const [clip] = await browser.probes(target, ['sustain'], AbortSignal.timeout(60000));
        input.referenceAudio = { name: 'synthetic-reference', audio: clip.audio };
      }
      const began = performance.now();
      const reply = await runCreativeSession(input, { endpoint: live ? process.env.MODEL_CHAT_URL : undefined, model: live ? process.env.MODEL_NAME : undefined, apiKey: live ? process.env.MODEL_API_KEY : undefined, renderer: browser.render, audioExecutor: browser.probes, perception: variant === 'signals' || variant === 'role-only' ? undefined : perception }, AbortSignal.timeout(240000), driver);
      for (const c of reply.candidates) { const next = applyPatch(before, c.patch, c.baseRevision); validateBrief(buildCreationBrief(input), before, next); validateSelection(before, next, input.selection as string[]); }
      rows.push({ scenario: scenario.id, split: scenario.split, variant, completed: true, originalUnchanged: isDeepStrictEqual(input.project, before), constraintsValid: true, candidateCount: reply.candidates.length, noChangeRespected: scenario.noChange ? reply.candidates.length === 0 : null, actualAudio: reply.candidates.some(c => c.listening?.clips.length), audioModelUsed: reply.candidates.some(c => c.listening?.status === 'model-reviewed'), elapsedMs: Math.round(performance.now() - began), usage: reply.trace.usage ?? null, revisions: reply.candidates.filter(c => c.revisionEvidence?.length).length, blindPreference: null, adopted: null, aestheticSuccess: null, reply });
    } catch { rows.push({ scenario: scenario.id, split: scenario.split, variant, completed: false, error: 'Execution or constraint validation failed; do not omit this case.' }); }
  }
  const report = `evals/reports/listening-${live ? 'live' : 'scripted'}-latest.json`;
  await writeFile(report, JSON.stringify({ generatedAt: new Date().toISOString(), kind: live ? 'live-model-real-audio' : 'scripted-control-real-browser-audio', limitations: '脚本只验证工程机制，不验证模型审美或语义能力。保留所有失败；人工偏好与实际采用率待填写，不以信号指标代替。各模式调用预算不同，需同时比较耗时与token。', rows }, null, 2));
  await writeFile('evals/reports/listening-ratings.csv', 'scenario,variant,listener,blind_pair,preference_A_B_tie,goal_met_1_5,adopted,notes\n' + rows.map(r => `${r.scenario},${r.variant},,,,,,`).join('\n'));
  console.log(JSON.stringify({ report, scenariosAvailable: all.length, runs: rows.length, completed: rows.filter(r => r.completed).length, audioModelRuns: rows.filter(r => r.audioModelUsed).length, humanQualityEvaluation: 'pending' }, null, 2));
  if (rows.some(r => !r.completed)) process.exitCode = 1;
} finally { await browser.close(); }
