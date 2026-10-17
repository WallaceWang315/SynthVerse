import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { applyPatch, candidateSchema, type Patch, type Project } from '../../src/domain';
import { compileOperations, operationSchema, validateSelection, type Operation } from '../../src/commands';
import { soundPatchSchema } from '../../src/synth';
import { audioMetricsSchema, type AudioMetrics, type RegisteredCandidate } from '../../src/agent-protocol';
import type { AgentInput } from './agent';
import { assessCandidate } from './creative-feedback';
import { searchMusicKnowledge } from './music-knowledge';
const propose = z.object({ title: z.string().min(1).max(60), explanation: z.string().min(1).max(600), operations: z.array(operationSchema).min(1).max(256), baseRevision: z.number().int().nonnegative(), knowledgeIds: z.array(z.string()).max(3).optional(), parentIds: z.array(z.string()).max(3).optional() }).strict();
const plan = z.object({ goal: z.string().min(1).max(300), preserve: z.array(z.string().max(100)).max(6), preserveFields: z.array(z.enum(['sound', 'notes', 'chords', 'layers', 'bars'])).max(5).default([]), alternatives: z.array(z.string().min(1).max(150)).length(2), checks: z.array(z.enum(['silence', 'clipping', 'low-register-density', 'user-listening'])).min(1).max(4) }).strict();
const revise = z.object({ candidateId: z.string(), title: z.string().min(1).max(60), explanation: z.string().min(1).max(600), operations: z.array(operationSchema).min(1).max(256), evidenceCodes: z.array(z.string()).min(1).max(3) }).strict();
const search = z.object({ query: z.string().min(1).max(300) }).strict();
const sound = z.object({ values: soundPatchSchema }).strict();
const motif = z.object({ noteIds: z.array(z.string()).min(1).max(256), action: z.enum(['transpose', 'set_pitch', 'stretch']), amount: z.number().finite() }).strict();
const chords = z.object({ operations: z.array(operationSchema).min(1).max(64) }).strict();
const render = z.object({ candidateId: z.string() }).strict();
const compare = z.object({ candidateIds: z.array(z.string()).min(2).max(3) }).strict();
const compose = z.object({ title: z.string().min(1).max(60), explanation: z.string().min(1).max(600), soundCandidateId: z.string().optional(), melodyCandidateId: z.string().optional(), harmonyCandidateId: z.string().optional() }).strict();
const empty = z.object({}).strict();
export const toolSchemas = { get_project_context: empty, analyze_music: empty, edit_sound: sound, transform_motif: motif, edit_chords: chords, propose_edit: propose, render_preview: render, compare_candidates: compare, compose_candidates: compose, plan_creation: plan, revise_candidate: revise, search_music_knowledge: search };
const descriptions: Record<keyof typeof toolSchemas, string> = {
  get_project_context: '读取工程、稳定 ID、锁定、选区、用户目标和明确偏好。', analyze_music: '分析音符音程、和弦覆盖、旋律走向；这是符号分析。',
  edit_sound: '生成局部音色操作，下一步用 propose_edit 注册。', transform_motif: '按稳定音符 ID 生成移调、改音高或拉伸操作，下一步注册。', edit_chords: '校验和弦局部操作，下一步注册。不限制为两个和弦。',
  propose_edit: '执行原子校验并注册候选，返回 candidateId。工程不改变。必须使用当前 baseRevision。', render_preview: '请浏览器实际渲染注册候选（最多4小节）并返回音频指标，不能据此声称音频模型听过声音。',
  compare_candidates: '比较已注册候选的参数、符号音乐和真实音频指标，不给审美排名。', compose_candidates: '组合用户指定参考或本轮已注册候选的音色、旋律、和声，校验后注册新候选。',
  plan_creation: '创作前记录目标、保留内容、两个有差异的方案及检查标准。比较模式必须先规划。',
  revise_candidate: '比较后基于真实检查结果修正一个本轮候选，整个任务最多一次。operations针对源候选的工程与稳定ID，evidenceCodes只能引用源候选检查发现的code。返回新的候选ID，保留父版本。',
  search_music_knowledge: '检索项目内置音乐启发式，返回建议、可执行操作、验证方法和来源ID。没有匹配时返回空数组，不编造来源。注册候选时可用knowledgeIds引用。',
};
export const musicToolDefinitions = Object.entries(toolSchemas).map(([name, schema]) => ({ type: 'function', function: { name, description: descriptions[name as keyof typeof toolSchemas], parameters: z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) } }));
export type Renderer = (candidate: RegisteredCandidate, signal: AbortSignal) => Promise<AudioMetrics>;
export class MusicToolRuntime {
  readonly candidates = new Map<string, RegisteredCandidate>();
  readonly references = new Map<string, RegisteredCandidate>();
  readonly previewPromises = new Map<string, Promise<unknown>>();
  readonly selection: string[];
  creationPlan?: z.infer<typeof plan>;
  readonly compared = new Set<string>();
  readonly retrieved = new Map<string, ReturnType<typeof searchMusicKnowledge>[number]>();
  private revisions = 0;
  constructor(readonly input: AgentInput, readonly renderer?: Renderer, readonly signal: AbortSignal = new AbortController().signal) {
    this.selection = input.selection.map(id => typeof id === 'number' ? input.project.notes[id]?.id : id);
    if (new Set(this.selection).size !== this.selection.length || this.selection.some(id => !input.project.notes.some(n => n.id === id))) throw new Error('音符选区无效。');
    for (const parent of input.parents ?? []) { if (this.references.has(parent.id)) throw new Error('参考候选 ID 重复。'); this.references.set(parent.id, parent); }
  }
  register(value: { title: string; explanation: string; patch: Patch }, parentIds = [...this.references.keys()], revision = false) {
    if (this.input.workflowMode === 'compare' && !this.creationPlan) throw new Error('比较模式必须先调用plan_creation记录两个方案。');
    if (this.input.workflowMode === 'compare' && this.candidates.size >= 2 && !revision) throw new Error('已生成两个方案；进一步修改请使用revise_candidate，最多一次。');
    this.signal.throwIfAborted(); if (this.candidates.size >= 8) throw new Error('本轮最多注册8个候选。');
    const candidate = candidateSchema.parse(value); const project = applyPatch(this.input.project, candidate.patch, this.input.project.revision); validateSelection(this.input.project, project, this.selection);
    for (const field of this.creationPlan?.preserveFields ?? []) if (!isDeepStrictEqual(project[field], this.input.project[field])) throw new Error(`创作计划要求保留${field}，该候选修改了它。`);
    const result: RegisteredCandidate = { ...candidate, id: `candidate-${randomUUID()}`, baseRevision: this.input.project.revision, project, parentIds };
    result.assessment = assessCandidate(result);
    this.candidates.set(result.id, result); return { accepted: true, candidateId: result.id, candidate: result, baseRevision: result.baseRevision };
  }
  get(id: string) { const result = this.candidates.get(id) ?? this.references.get(id); if (!result) throw new Error('候选尚未注册或用户没有提供该参考。'); return result; }
  async preview(id: string) {
    const candidate = this.get(id); if (candidate.metrics) return { candidateId: id, metrics: candidate.metrics, excerptBeats: Math.min(16, candidate.project.bars * 4) };
    if (!this.renderer) return { candidateId: id, status: 'not-rendered', reason: '此调用没有浏览器音频执行器；不得声称已听过或测量音频。' };
    let promise = this.previewPromises.get(id);
    if (!promise) { if (this.previewPromises.size >= 3) throw new Error('每轮最多渲染3个候选。'); promise = this.renderer(candidate, this.signal).then(metrics => { candidate.metrics = audioMetricsSchema.parse(metrics); candidate.assessment = assessCandidate(candidate); return { candidateId: id, metrics: candidate.metrics, assessment: candidate.assessment, excerptBeats: Math.min(16, candidate.project.bars * 4) }; }); this.previewPromises.set(id, promise); }
    return promise;
  }
  execute(name: string, args: unknown): unknown {
    const p = this.input.project;
    if (name === 'plan_creation') { if (this.candidates.size) throw new Error('候选创建后不能改写本轮计划。'); this.creationPlan = plan.parse(args); return { plan: this.creationPlan, budget: { candidatesToCompare: 2, revisions: 1, renders: 3 }, warning: '目标和审美需要用户判断，指标只检查具体问题。' }; }
    if (name === 'search_music_knowledge') { const entries = searchMusicKnowledge(search.parse(args).query); entries.forEach(entry => this.retrieved.set(entry.id, entry)); return { basis: 'project-authored-heuristics', entries }; }
    if (name === 'revise_candidate') {
      const a = revise.parse(args); const source = this.candidates.get(a.candidateId);
      if (!source || !this.compared.has(source.id)) throw new Error('先比较本轮候选，再修正其中一个。');
      if (this.revisions >= 1) throw new Error('每个任务最多进行一次反馈修正。');
      const assessment = assessCandidate(source);
      if (a.evidenceCodes.some(code => !assessment.findings.some(f => f.code === code))) throw new Error('修正依据必须来自源候选实际检查结果。');
      const delta = compileOperations(source.project, { baseRevision: source.project.revision, operations: a.operations });
      const patch: Patch = { ...source.patch, ...delta, ...(source.patch.sound || delta.sound ? { sound: { ...source.patch.sound, ...delta.sound } } : {}), ...(source.patch.layers || delta.layers ? { layers: { ...source.patch.layers, ...delta.layers } } : {}) };
      const result = this.register({ title: a.title, explanation: a.explanation, patch }, [source.id], true);
      result.candidate.citations = source.citations; result.candidate.revisionEvidence = a.evidenceCodes; this.revisions++;
      return result;
    }
    if (name === 'get_project_context') { empty.parse(args); return { project: p, selection: this.selection, scope: this.input.scope, taskGoal: this.input.taskGoal ?? '', preferences: this.input.preferences ?? [], feedback: this.input.feedback ?? [], references: [...this.references.values()].map(c => ({ id: c.id, title: c.title, project: c.project, parentIds: c.parentIds })), engine: 'web-audio-v3', audioReceived: false }; }
    if (name === 'analyze_music') { empty.parse(args); const notes = [...p.notes].sort((a, b) => a.start - b.start); return { basis: 'symbolic-notes-and-parameters', noteCount: notes.length, intervals: notes.slice(1).map((n, i) => n.pitch - notes[i].pitch), notesPerBeat: notes.length / (p.bars * 4), selectedNoteIds: this.selection, chordCount: p.chords.length, endingChord: p.chords.find(c => notes.at(-1) && notes.at(-1)!.start >= c.start && notes.at(-1)!.start < c.start + c.duration)?.name ?? null }; }
    if (name === 'edit_sound') { const a = sound.parse(args); const operations: Operation[] = [{ type: 'set_sound_parameters', values: a.values }]; const patch = compileOperations(p, { baseRevision: p.revision, operations }); validateSelection(p, applyPatch(p, patch, p.revision), this.selection); return { operations }; }
    if (name === 'transform_motif') { const a = motif.parse(args); if (new Set(a.noteIds).size !== a.noteIds.length) throw new Error('音符 ID 重复。'); const operations: Operation[] = a.noteIds.map(id => { const n = p.notes.find(n => n.id === id); if (!n) throw new Error('音符 ID 不存在。'); return { type: 'update_note', noteId: id, changes: a.action === 'transpose' ? { pitch: n.pitch + a.amount } : a.action === 'set_pitch' ? { pitch: a.amount } : { start: n.start * a.amount, duration: n.duration * a.amount } }; }); const patch = compileOperations(p, { baseRevision: p.revision, operations }); validateSelection(p, applyPatch(p, patch, p.revision), this.selection); return { operations }; }
    if (name === 'edit_chords') { const a = chords.parse(args); if (a.operations.some(o => !['add_chord', 'update_chord', 'delete_chord'].includes(o.type))) throw new Error('此工具只允许编辑和弦。'); compileOperations(p, { baseRevision: p.revision, operations: a.operations }); return { operations: a.operations }; }
    if (name === 'propose_edit') { if (args && typeof args === 'object' && 'patch' in args) return this.register(candidateSchema.parse(args)); const a = propose.parse(args); const parentIds = [...new Set(a.parentIds ?? [])]; parentIds.forEach(id => this.get(id)); const citations = (a.knowledgeIds ?? []).map(id => { const entry = this.retrieved.get(id); if (!entry) throw new Error('只能引用本轮实际检索到的知识来源。'); return { id: entry.id, title: entry.title, source: entry.source }; }); const result = this.register({ title: a.title, explanation: a.explanation, patch: compileOperations(p, { baseRevision: a.baseRevision, operations: a.operations }) }, parentIds); result.candidate.citations = citations; return result; }
    if (name === 'render_preview') return this.preview(render.parse(args).candidateId);
    if (name === 'compare_candidates') { const a = compare.parse(args); if (new Set(a.candidateIds).size !== a.candidateIds.length) throw new Error('请选择不同候选。'); const candidates = a.candidateIds.map(id => this.get(id)); if (this.input.workflowMode === 'compare' && this.renderer && candidates.some(c => !c.metrics)) throw new Error('请先渲染两个候选再比较。'); candidates.forEach(c => this.compared.add(c.id)); return { basis: 'parameters-symbolic-and-available-audio-metrics', candidates: candidates.map(c => { c.assessment = assessCandidate(c); return { id: c.id, title: c.title, sound: c.project.sound, notes: c.project.notes, chords: c.project.chords, metrics: c.metrics ?? null, assessment: c.assessment }; }), warning: '没有渲染时只有符号分析；没有发现问题不等于音乐好听。依据用户目标决定是否修正，最多一次。' }; }
    if (name === 'compose_candidates') { const a = compose.parse(args); const patch: Patch = {}; const ids: string[] = []; for (const [id, field] of [[a.soundCandidateId, 'sound'], [a.melodyCandidateId, 'notes'], [a.harmonyCandidateId, 'chords']] as const) { if (!id) continue; const c = this.get(id); ids.push(id); if (field === 'sound') patch.sound = c.project.sound; else if (field === 'notes') patch.notes = c.project.notes; else { patch.chords = c.project.chords; patch.layers = { harmony: c.project.layers.harmony, bass: c.project.layers.bass }; } } if (!ids.length) throw new Error('至少选择一个参考。'); return this.register({ title: a.title, explanation: a.explanation, patch }, [...new Set(ids)]); }
    throw new Error('不存在的工具。');
  }
  workflowError(final: RegisteredCandidate[]) {
    if (this.input.workflowMode !== 'compare' || (!final.length && !this.candidates.size)) return null;
    if (final.length < 2) return '比较模式需要返回至少两个候选，供用户试听比较。';
    const compared = [...this.candidates.values()].filter(c => this.compared.has(c.id));
    const signature = (c: RegisteredCandidate) => JSON.stringify({ sound: c.project.sound, notes: c.project.notes.map(n => [n.pitch, n.start, n.duration, n.velocity]).sort(), chords: c.project.chords.map(chord => [chord.start, chord.duration, [...chord.pitches].sort((a, b) => a - b)]).sort(), layers: c.project.layers, bars: c.project.bars });
    if (!this.creationPlan || new Set(compared.map(signature)).size < 2) return '比较模式需要先规划、生成两个音乐内容不同的候选，并调用compare_candidates。';
    if (this.renderer && compared.some(c => !c.metrics)) return '比较前必须完成候选音频渲染。';
    if (final.some(c => !this.compared.has(c.id))) return '最终候选（含修正版）都需要调用compare_candidates比较后才能返回。';
    return null;
  }
}
