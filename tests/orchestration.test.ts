import { describe, expect, it, vi, afterEach } from 'vitest';
import { runCreativeSession, mergeSpecialistPatches } from '../services/api/creative-orchestrator';
import { runMusicAgent, type AgentInput } from '../services/api/agent';
import { MusicToolRuntime } from '../services/api/music-tools';
import { initialProject, applyPatch } from '../src/domain';
import { buildCreationBrief } from '../src/creation-brief';
import type { AudioExecutor } from '../services/api/audio-perception';
import { packet } from './helpers/listening';
afterEach(() => vi.restoreAllMocks());
const input = (): AgentInput => ({ prompt: '调整音色和旋律，保留节奏', project: structuredClone(initialProject), scope: 'sound', selection: [], history: [{ role: 'user', content: '旧上下文不能混入专业执行' }], exploration: 'collaborative' });
const render: AudioExecutor = async (_candidate, probes) => probes.map(p => packet(p));
const fakeAgent: typeof runMusicAgent = async (i, config) => {
  const runtime = new MusicToolRuntime(i, undefined, undefined, config.brief);
  const patch = config.brief?.role === 'composition' ? { notes: i.project.notes.map((n, index) => index ? n : { ...n, pitch: n.pitch + 1 }) } : { sound: { brightness: i.project.sound.brightness === 20 ? 25 : 20 } };
  const c = runtime.register({ title: '专业候选', explanation: '测试分工', patch }).candidate;
  return { candidates: [c], message: 'ready', mode: 'model', trace: { requestId: 'test', durationMs: 1, events: [], usage: { inputTokens: 10, outputTokens: 5 } } };
};
describe('specialist orchestration', () => {
  it('uses separate contexts, hands composition to sound, merges and jointly renders', async () => {
    const calls: AgentInput[] = [];
    const agent: typeof runMusicAgent = async (i, c, s) => { calls.push(i); return fakeAgent(i, c, s); };
    const i = input(), original = structuredClone(i.project);
    const result = await runCreativeSession(i, { audioExecutor: render }, new AbortController().signal, agent);
    expect(calls.map(c => c.requestedRole)).toEqual(['composition', 'sound']);
    expect(calls.every(c => c.history.length === 0 && c.referenceAudio === undefined)).toBe(true);
    expect(calls[1].project.notes[0].pitch).toBe(original.notes[0].pitch + 1);
    expect(result.candidates[0].project.sound.brightness).toBe(20);
    expect(result.candidates[0].collaboration?.complete).toBe(true);
    expect(result.candidates[0].listening?.clips).toHaveLength(4);
    expect(result.trace.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(i.project).toEqual(original); expect(applyPatch(i.project, result.candidates[0].patch, 0)).toEqual(result.candidates[0].project);
  });
  it('preserves valid composition when the sound specialist fails', async () => {
    const agent: typeof runMusicAgent = async (i, c, s) => { if (c.brief?.role === 'sound') throw new Error('test'); return fakeAgent(i, c, s); };
    const result = await runCreativeSession(input(), { audioExecutor: render }, new AbortController().signal, agent);
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0].collaboration?.complete).toBe(false);
    expect(result.candidates[0].project.sound).toEqual(initialProject.sound);
  });
  it('runs only the relevant specialist for a single-domain request', async () => {
    const agent = vi.fn(fakeAgent);
    await runCreativeSession({ ...input(), prompt: '音色柔和' }, { audioExecutor: render }, new AbortController().signal, agent);
    expect(agent).toHaveBeenCalledTimes(1); expect(agent.mock.calls[0][1].brief?.role).toBe('sound');
  });
  it('rejects stale and conflicting contributions instead of last-write-wins', async () => {
    const i = input(), brief = buildCreationBrief(i); const runtime = new MusicToolRuntime(i);
    const a = runtime.register({ title: 'A', explanation: 'A', patch: { sound: { brightness: 20 } } }).candidate;
    const b = runtime.register({ title: 'B', explanation: 'B', patch: { sound: { brightness: 30 } } }).candidate;
    expect(() => mergeSpecialistPatches(i.project, [{ candidate: a, expectedRevision: 1 }], brief)).toThrow('版本');
    expect(() => mergeSpecialistPatches(i.project, [{ candidate: a, expectedRevision: 0 }, { candidate: b, expectedRevision: 0 }], brief)).toThrow('冲突');
  });
  it('revises at most once from actual evidence, then renders the revision again', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ findings: [{ code: 'tail', observation: '尾音过长', goalRelation: '目标要求清晰', suggestion: '测试短尾音', probe: 'staccato' }], limitations: ['测试模型'], needsRevision: true })));
    let calls = 0, renders = 0;
    const agent: typeof runMusicAgent = async (i, c, s) => { calls++; return fakeAgent(i, c, s); };
    const result = await runCreativeSession({ ...input(), prompt: '调整音色', exploration: 'listening' }, { endpoint: 'http://127.0.0.1:1234', model: 'test', perception: { endpoint: 'http://127.0.0.1:9001/analyze', model: 'test-audio' }, audioExecutor: async (...args) => { renders++; return render(...args); } }, new AbortController().signal, agent);
    expect(calls).toBe(2); expect(result.candidates).toHaveLength(2); expect(renders).toBe(3);
    expect(result.candidates[1].parentIds).toEqual([result.candidates[0].id]);
    expect(result.candidates[1].revisionEvidence).toEqual(['model-1']);
    expect(result.candidates[1].listening?.candidateId).toBe(result.candidates[1].id);
  });
  it('does not return late candidates after cancellation', async () => {
    const controller = new AbortController();
    await expect(runCreativeSession(input(), { audioExecutor: async () => { controller.abort(); return []; } }, controller.signal, fakeAgent)).rejects.toThrow();
  });
});
