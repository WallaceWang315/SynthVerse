import { describe, expect, it, vi } from 'vitest';
import { buildCreationBrief } from '../src/creation-brief';
import { initialProject, applyPatch } from '../src/domain';
import { registeredCandidateSchema } from '../src/agent-protocol';
import { savedSchema } from '../src/storage';
import { MusicToolRuntime } from '../services/api/music-tools';
import { roleAllowsTool } from '../services/api/creative-roles';
import { runMusicAgent } from '../services/api/agent';

const input = (prompt: string, scope = 'sound') => ({ prompt, scope, project: structuredClone(initialProject), selection: [] as string[], history: [] });
const candidate = { title: '测试', explanation: '验证边界' };

describe('specialized creation workflows', () => {
  it('treats an explicit analysis-only request as read-only even when the UI allows editing', () => {
    const i = input('只分析当前音色，不修改工程');
    const runtime = new MusicToolRuntime(i);
    expect(runtime.brief.allowedFields).toEqual([]);
    expect(() => runtime.register({ ...candidate, patch: { sound: { brightness: 15 } } })).toThrow('不允许');
  });
  it('routes the no-key demo without treating a preservation clause as an edit', async () => {
    const i = input('保留旋律，让音色柔和一点');
    const result = await runMusicAgent(i, {}, new AbortController().signal);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every(c => c.provenance?.brief.role === 'sound' && JSON.stringify(c.project.notes) === JSON.stringify(i.project.notes))).toBe(true);
  });

  it('rejects cross-domain edits in direct model mode as well', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '修改', candidates: [{ ...candidate, patch: { notes: [] } }] }) } }] })));
    try {
      await expect(runMusicAgent(input('调整音色'), { endpoint: 'http://127.0.0.1:12345', model: 'test', executionMode: 'direct' }, new AbortController().signal)).rejects.toMatchObject({ cause: { message: expect.stringContaining('不允许') } });
      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(JSON.parse(body.messages.at(-1).content).creationBrief.role).toBe('sound');
      expect(body.messages[0].content).toContain('音色设计角色');
    } finally { fetcher.mockRestore(); }
  });
  it.each([
    ['音色柔和一点', 'harmony', 'sound'],
    ['写一段旋律', 'sound', 'composition'],
    ['用这段音色铺一段具有梦幻感的和弦进行', 'sound', 'composition'],
    ['保留旋律，让音色更空灵', 'motif', 'sound'],
    ['保持音色不变，调整和弦', 'sound', 'composition'],
    ['调整音色，同时修改旋律和和弦', 'sound', 'coordinator'],
    ['再来一个', 'harmony', 'composition'],
  ])('routes %s using explicit intent before the panel', (prompt, scope, role) => {
    expect(buildCreationBrief(input(prompt, scope)).role).toBe(role);
  });

  it('manual direction is bounded by locks and explicit preservation', () => {
    const i = input('保留旋律，让它更有空间感'); i.project.locks.sound = true;
    const brief = buildCreationBrief({ ...i, requestedRole: 'coordinator' });
    expect(brief.role).toBe('coordinator');
    expect(brief.allowedFields).not.toContain('sound'); expect(brief.allowedFields).not.toContain('notes');
    expect(roleAllowsTool(brief, 'edit_sound')).toBe(false);
  });

  it('sound roles cannot bypass permissions through generic proposals or composition', () => {
    const i = input('调整音色'); const runtime = new MusicToolRuntime(i);
    expect(() => runtime.execute('transform_motif', { noteIds: [i.project.notes[0].id], action: 'transpose', amount: 1 })).toThrow('未获准');
    expect(() => runtime.register({ ...candidate, patch: { notes: [] } })).toThrow('不允许');
    expect(() => runtime.execute('propose_edit', { ...candidate, baseRevision: 0, operations: [{ type: 'set_layers', values: { melody: false } }] })).toThrow('不允许');
    const parent = new MusicToolRuntime(input('修改旋律')).register({ ...candidate, patch: { notes: [] } }).candidate;
    const withReference = new MusicToolRuntime({ ...i, parents: [parent] });
    expect(() => withReference.execute('compose_candidates', { ...candidate, melodyCandidateId: parent.id })).toThrow('不允许');
    expect(runtime.candidates.size).toBe(0); expect(i.project).toEqual(initialProject);
  });

  it('composition preserves sound and chord-only requests preserve melody', () => {
    const runtime = new MusicToolRuntime(input('调整和弦'));
    expect(() => runtime.register({ ...candidate, patch: { sound: { brightness: 10 } } })).toThrow('不允许');
    expect(() => runtime.register({ ...candidate, patch: { notes: [] } })).toThrow('不允许');
    const c = runtime.register({ ...candidate, patch: { layers: { harmony: true } } }).candidate;
    expect(c.project.sound).toEqual(initialProject.sound);
  });

  it('preserves explicitly requested rhythm without requiring the UI lock', () => {
    const i = input('保留节奏，换一种旋律走向'); const runtime = new MusicToolRuntime(i);
    const notes = structuredClone(i.project.notes); notes[0].pitch += 1;
    expect(runtime.register({ ...candidate, patch: { notes } }).candidate.project.notes[0].pitch).toBe(notes[0].pitch);
    notes[0].duration += 0.1;
    expect(() => runtime.register({ ...candidate, patch: { notes } })).toThrow('保留节奏');
  });

  it('records actual changed IDs and parameters, without inventing parents', () => {
    const i = input('修改音色和旋律'); const runtime = new MusicToolRuntime(i);
    const c = runtime.execute('propose_edit', { ...candidate, baseRevision: 0, operations: [
      { type: 'set_sound_parameters', values: { brightness: 20 } },
      { type: 'update_note', noteId: i.project.notes[0].id, changes: { pitch: 72 } },
    ] }) as ReturnType<typeof runtime.register>;
    expect(c.candidate.provenance).toMatchObject({ changedFields: ['sound', 'notes'], soundParameters: ['brightness'], changedNoteIds: [i.project.notes[0].id], changedChordIds: [], brief: { role: 'coordinator', baseRevision: 0 } });
    const withReference = new MusicToolRuntime({ ...i, parents: [c.candidate] });
    expect(withReference.register({ ...candidate, patch: { sound: { brightness: 30 } } }).candidate.parentIds).toEqual([]);
    expect(() => withReference.register({ ...candidate, patch: {} }, ['unknown'])).toThrow('尚未注册');
    expect(applyPatch(i.project, c.candidate.patch, c.candidate.baseRevision)).toEqual(c.candidate.project);
    expect(() => applyPatch({ ...i.project, revision: 1 }, c.candidate.patch, c.candidate.baseRevision)).toThrow('已改变');
  });

  it('persists provenance while accepting legacy candidates', () => {
    const runtime = new MusicToolRuntime(input('调整音色'));
    const c = runtime.register({ ...candidate, patch: { sound: { brightness: 20 } } }).candidate;
    const saved = savedSchema.parse({ project: initialProject, shelf: [], archive: [c] });
    expect(saved.archive[0].provenance).toEqual(c.provenance);
    const { provenance: _record, ...legacy } = c;
    expect(registeredCandidateSchema.parse(legacy).provenance).toBeUndefined();
  });
});
