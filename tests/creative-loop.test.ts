import { describe, expect, it } from 'vitest';
import { MusicToolRuntime } from '../services/api/music-tools';
import { initialProject } from '../src/domain';
import { assessCandidate } from '../services/api/creative-feedback';
import { savedSchema } from '../src/storage';
import { searchMusicKnowledge } from '../services/api/music-knowledge';
const input = () => ({ prompt: '比较两个音色并检查静音', project: structuredClone(initialProject), scope: 'sound', history: [], selection: [] as string[], workflowMode: 'compare' as const });
const plan = { goal: '比较', preserve: ['旋律和和弦'], preserveFields: ['notes', 'chords'], alternatives: ['柔和', '明亮'], checks: ['silence'] };
const metrics = { basis: 'browser-offline-audio' as const, durationSeconds: 1, sampleRate: 44100, rms: 0.1, peak: 0.3, clippingRatio: 0, spectralCentroidHz: 500, highFrequencyEnergyRatio: 0 };
describe('evidence-based creation loop', () => {
  it('requires a plan, two distinct options, actual previews and comparison', async () => {
    const runtime = new MusicToolRuntime(input(), async () => metrics);
    const proposal = { title: 'A', explanation: '柔和', patch: { sound: { brightness: 20 } } };
    expect(() => runtime.register(proposal)).toThrow('先调用plan_creation'); runtime.execute('plan_creation', plan);
    const a = runtime.register(proposal).candidate, b = runtime.register({ ...proposal, title: 'B' }).candidate;
    expect(() => runtime.execute('compare_candidates', { candidateIds: [a.id, b.id] })).toThrow('先渲染');
    await runtime.preview(a.id); await runtime.preview(b.id); runtime.execute('compare_candidates', { candidateIds: [a.id, b.id] });
    expect(runtime.workflowError([a, b])).toContain('内容不同');
    expect(() => runtime.register({ ...proposal, title: 'C' })).toThrow('两个方案');
  });
  it('revises once from measured evidence, preserves the parent patch and verifies the new candidate', async () => {
    const runtime = new MusicToolRuntime(input(), async c => ({ ...metrics, rms: c.project.sound.brightness === 20 ? 0 : 0.1 }));
    runtime.execute('plan_creation', plan);
    const a = runtime.register({ title: 'A', explanation: '柔和', patch: { sound: { brightness: 20, release: 0.2 } } }).candidate;
    const b = runtime.register({ title: 'B', explanation: '明亮', patch: { sound: { brightness: 60 } } }).candidate;
    await runtime.preview(a.id); await runtime.preview(b.id); runtime.execute('compare_candidates', { candidateIds: [a.id, b.id] });
    const request = { candidateId: a.id, title: '修正版', explanation: '验证反馈修正', evidenceCodes: ['silence'], operations: [{ type: 'set_sound_parameters', values: { brightness: 30 } }] };
    expect(() => runtime.execute('revise_candidate', { ...request, evidenceCodes: ['invented'] })).toThrow('实际检查');
    const revised = (runtime.execute('revise_candidate', request) as ReturnType<typeof runtime.register>).candidate;
    expect(revised.project.sound.release).toBe(0.2); expect(revised.parentIds).toEqual([a.id]); expect(revised.revisionEvidence).toEqual(['silence']);
    expect(() => runtime.execute('revise_candidate', request)).toThrow('最多');
    expect(runtime.workflowError([a, b, revised])).toContain('都需要');
    await runtime.preview(revised.id); runtime.execute('compare_candidates', { candidateIds: [a.id, revised.id] });
    expect(revised.assessment?.findings).toEqual([]); expect(runtime.workflowError([a, b, revised])).toBeNull();
    expect(runtime.input.project).toEqual(initialProject);
  });
  it('preserves declared fields and honors selection and locks during revision', async () => {
    const i = input(); i.project.locks.sound = true;
    const runtime = new MusicToolRuntime(i); runtime.execute('plan_creation', plan);
    expect(() => runtime.register({ title: 'A', explanation: '锁定', patch: { sound: { brightness: 10 } } })).toThrow('锁定');
    expect(() => runtime.register({ title: 'A', explanation: '越过保留项', patch: { notes: [] } })).toThrow('计划');
  });
  it('rejects revisions outside the note selection or sound lock without consuming the revision', () => {
    const i = input(); i.selection = [i.project.notes[0].id]; i.project.locks.sound = true;
    const runtime = new MusicToolRuntime(i); runtime.execute('plan_creation', { ...plan, preserveFields: [] });
    const a = runtime.register({ title: '密集', explanation: '对照', patch: { chords: [{ id: 'low', name: 'Cmaj7', pitches: [48, 52, 55, 59], start: 0, duration: 8 }], layers: { harmony: true } } }).candidate;
    const b = runtime.register({ title: '开放', explanation: '对照', patch: { chords: [{ id: 'open', name: 'Cmaj7', pitches: [48, 64, 67, 71], start: 0, duration: 8 }], layers: { harmony: true } } }).candidate;
    runtime.execute('compare_candidates', { candidateIds: [a.id, b.id] });
    const args = { candidateId: a.id, title: '修正', explanation: '验证约束', evidenceCodes: ['low-register-density'] };
    expect(() => runtime.execute('revise_candidate', { ...args, operations: [{ type: 'update_note', noteId: i.project.notes[1].id, changes: { pitch: 72 } }] })).toThrow('选中');
    expect(() => runtime.execute('revise_candidate', { ...args, operations: [{ type: 'set_sound_parameters', values: { brightness: 10 } }] })).toThrow('锁定');
    const revised = runtime.execute('revise_candidate', { ...args, operations: [{ type: 'update_chord', chordId: 'low', changes: { pitches: [48, 64, 67, 71] } }] }) as ReturnType<typeof runtime.register>;
    expect(revised.candidate.project.notes).toEqual(i.project.notes); expect(revised.candidate.project.sound).toEqual(i.project.sound);
  });
  it('distinguishes measurements from symbolic hints and never calls missing audio silent', () => {
    const runtime = new MusicToolRuntime({ ...input(), workflowMode: 'quick' });
    const candidate = runtime.register({ title: '低音和弦', explanation: '密集排列', patch: { chords: [{ id: 'low', name: 'Cmaj7', pitches: [48, 52, 55, 59], start: 0, duration: 8 }], layers: { harmony: true } } }).candidate;
    expect(assessCandidate(candidate)).toEqual({ measured: false, findings: [{ code: 'low-register-density', basis: 'symbolic', detail: expect.any(String) }] });
    candidate.metrics = { ...metrics, clippingRatio: 0.01 }; expect(assessCandidate(candidate).findings.map(f => f.code)).toContain('clipping');
  });
  it('only attaches sources actually retrieved and reports irrelevant queries honestly', () => {
    const runtime = new MusicToolRuntime({ ...input(), workflowMode: 'quick' });
    const proposal = { title: 'A', explanation: '柔和', baseRevision: 0, operations: [{ type: 'set_sound_parameters', values: { brightness: 25 } }], knowledgeIds: ['soft-pad'] };
    expect(() => runtime.execute('propose_edit', proposal)).toThrow('实际检索');
    runtime.execute('search_music_knowledge', { query: '柔和梦幻铺底' });
    const result = runtime.execute('propose_edit', proposal) as ReturnType<typeof runtime.register>;
    expect(result.candidate.citations?.[0].source).toBe('docs/music-knowledge.md#soft-pad');
    expect(searchMusicKnowledge('zzzz1234')).toEqual([]);
  });
  it('migrates old workspaces without converting feedback into permanent preferences', () => {
    const old = savedSchema.parse({ project: initialProject, shelf: [] }); expect(old.workflowMode).toBe('quick'); expect(old.feedback).toEqual([]);
    const next = savedSchema.parse({ ...old, feedback: [{ candidateId: 'c-1', title: 'A', choice: 'dislike', note: '尾音太长', createdAt: new Date().toISOString() }] });
    expect(next.preferences).toEqual([]); expect(next.feedback).toHaveLength(1);
  });
});
