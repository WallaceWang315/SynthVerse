import { z } from 'zod';
import { tonalitySchema, defaultTonality, tonalityName, mapPitch, chordName, type Tonality } from './tonality';
import { soundSchema, soundPatchSchema } from './synth';
export { soundSchema } from './synth';

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const objectIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const noteFields = { pitch: z.number().int().min(21).max(108), start: z.number().min(0).max(63.875), duration: z.number().min(0.125).max(64), velocity: z.number().min(0.1).max(1) };
export const noteSchema = z.object({ id: objectIdSchema.default(() => newId('note')), ...noteFields });
export const chordFields = { name: z.string().min(1).max(30), pitches: z.array(z.number().int().min(33).max(96)).min(3).max(6), start: z.number().min(0).max(63.875), duration: z.number().min(0.125).max(64) };
export const chordSchema = z.object({ id: objectIdSchema.default(() => newId('chord')), ...chordFields });
const projectV3 = z.object({
  format: z.literal('synthverse-project'), version: z.literal(3), title: z.string().min(1).max(80), bars: z.number().int().min(1).max(16).default(2),
  tonality: tonalitySchema.default(defaultTonality),
  revision: z.number().int().nonnegative(), bpm: z.number().int().min(60).max(180),
  sound: soundSchema, notes: z.array(noteSchema).max(256), chords: z.array(chordSchema).max(64),
  layers: z.object({ melody: z.boolean(), harmony: z.boolean(), bass: z.boolean() }),
  locks: z.object({ sound: z.boolean(), rhythm: z.boolean(), harmony: z.boolean() }),
}).superRefine((p, ctx) => {
  const ids = [...p.notes, ...p.chords].map(item => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '音符和和弦 ID 不能重复' });
  if (p.notes.some(n => n.start + n.duration > p.bars * 4 + 0.00001)) ctx.addIssue({ code: 'custom', message: '音符超出了片段长度', path: ['notes'] });
  const chords = [...p.chords].sort((a, b) => a.start - b.start);
  if (chords.some((c, i) => c.start + c.duration > p.bars * 4 + 0.00001 || (i > 0 && chords[i - 1].start + chords[i - 1].duration > c.start + 0.00001))) ctx.addIssue({ code: 'custom', message: '和弦不能重叠或超出片段长度', path: ['chords'] });
});
export const projectSchema = z.preprocess((input, ctx) => {
  if (!input || typeof input !== 'object') return input;
  const old = input as Record<string, unknown>;
  if (old.version === 3 && [old.notes, old.chords].some(items => Array.isArray(items) && items.some(item => !item || typeof item.id !== 'string'))) ctx.addIssue({ code: 'custom', message: 'v3工程中的音符和和弦必须有稳定ID' });
  if (old.version !== 1 && old.version !== 2) return input;
  return { ...old, version: 3, bars: old.version === 1 ? 2 : old.bars, notes: Array.isArray(old.notes) ? old.notes.map((n, i) => ({ ...n, id: n.id ?? `note-migrated-${i + 1}` })) : old.notes, chords: Array.isArray(old.chords) ? old.chords.map((c, i) => ({ ...c, id: c.id ?? `chord-migrated-${i + 1}`, ...(old.version === 1 ? { start: i * 4, duration: 4 } : {}) })) : old.chords };
}, projectV3);
export type Sound = z.infer<typeof soundSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Project = z.infer<typeof projectSchema>;
export const patchSchema = z.object({ sound: soundPatchSchema.optional(), bars: z.number().int().min(1).max(16).optional(), notes: z.array(noteSchema).max(256).optional(), chords: z.array(chordSchema).max(64).optional(), layers: z.object({ melody: z.boolean().optional(), harmony: z.boolean().optional(), bass: z.boolean().optional() }).optional() }).strict();
export type Patch = z.input<typeof patchSchema>;
export const candidateSchema = z.object({ title: z.string().min(1).max(60), explanation: z.string().min(1).max(600), patch: patchSchema });
export const replySchema = z.object({ message: z.string().min(1).max(2000), candidates: z.array(candidateSchema).max(3) });
export type Candidate = z.infer<typeof candidateSchema> & { id: string; baseRevision: number };
export type Reply = z.infer<typeof replySchema>;

export const initialProject: Project = {
  format: 'synthverse-project', version: 3, tonality: { ...defaultTonality }, bars: 2, title: '玻璃上的微光', revision: 0, bpm: 104,
  sound: soundSchema.parse({ wave: 'triangle', brightness: 42, attack: 0.015, release: 0.65, width: 7, glass: 32 }),
  notes: [60, 64, 67, 71, 69, 67, 64, 62].map((pitch, i) => ({ id: `note-initial-${i + 1}`, pitch, start: i, duration: i === 7 ? 1 : 0.65, velocity: i % 4 === 0 ? 0.8 : 0.6 })),
  chords: [{ id: 'chord-initial-1', name: 'Cmaj7', pitches: [60, 64, 67, 71], start: 0, duration: 4 }, { id: 'chord-initial-2', name: 'Am7', pitches: [57, 60, 64, 67], start: 4, duration: 4 }],
  layers: { melody: true, harmony: false, bass: false }, locks: { sound: false, rhythm: false, harmony: false },
};

export function createBlankProject(revision = 0): Project {
  return projectSchema.parse({
    format: 'synthverse-project', version: 3, title: '未命名想法', revision, bars: 2, bpm: 120,
    sound: soundSchema.parse({ wave: 'triangle', brightness: 70, attack: 0.01, release: 0.3, width: 0, glass: 0 }), notes: [], chords: [],
    layers: { melody: true, harmony: false, bass: false },
    locks: { sound: false, rhythm: false, harmony: false },
  });
}

export function applyPatch(project: Project, input: Patch, baseRevision: number): Project {
  if (project.revision !== baseRevision) throw new Error('当前创意已改变，请重新生成候选，避免覆盖新编辑。');
  const patch = patchSchema.parse(input);
  if (project.locks.sound && patch.sound && Object.keys(patch.sound).length) throw new Error('音色已锁定，请先解锁。');
  if (project.locks.harmony && patch.chords) throw new Error('和弦已锁定，请先解锁。');
  if ((project.locks.rhythm || project.locks.harmony) && patch.bars !== undefined && patch.bars !== project.bars) throw new Error('节奏或和弦已锁定，不能改变片段长度。');
  if (project.locks.rhythm && patch.notes && (project.notes.length !== patch.notes.length || project.notes.some(n => { const updated = patch.notes!.find(item => item.id === n.id); return !updated || n.start !== updated.start || n.duration !== updated.duration || n.velocity !== updated.velocity; }))) throw new Error('节奏已锁定，此候选改变了时序或力度。');
  const sound = { ...project.sound, ...patch.sound };
  if (patch.sound?.oscillators && patch.sound.wave === undefined) sound.wave = patch.sound.oscillators[0].wave;
  return projectSchema.parse({ ...project, bars: patch.bars ?? project.bars, revision: project.revision + 1, sound, notes: patch.notes ?? project.notes, chords: patch.chords ?? project.chords, layers: { ...project.layers, ...patch.layers } });
}
export function restoreSnapshot(snapshot: Project, currentRevision: number): Project {
  return projectSchema.parse({ ...snapshot, revision: currentRevision + 1 });
}
export function noteName(pitch: number): string { return ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12] + (Math.floor(pitch / 12) - 1); }
export function editingError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.find(i => i.code === 'custom')?.message ?? '编辑值不在支持范围内，请检查音高、时长或参数。';
  return error instanceof Error ? error.message : '编辑未完成，请检查输入。';
}
export function theory(project: Project): string {
  const last = [...project.notes].sort((a, b) => a.start - b.start).at(-1);
  if (!last) return '先放入几个音符，再比较不同结尾。';
  const chord = project.chords.find(c => last.start >= c.start && last.start < c.start + c.duration);
  if (!chord) return `最后一个音是 ${noteName(last.pitch)}，这个位置没有和弦。可以手动添加和弦，比较它带来的稳定或悬念；空白也可以保留。`;
  const isChordTone = chord.pitches.some(p => p % 12 === last.pitch % 12);
  return `最后一个音是 ${noteName(last.pitch)}。${last.pitch % 12 === project.tonality.tonic ? `它落在 ${tonalityName(project.tonality)} 的主音上，通常会加强结束感。` : `相对于 ${tonalityName(project.tonality)}，它仍有继续发展的可能。`}${isChordTone ? `它属于所在小节 ${chord.name} 的构成音。` : `它不在所在小节 ${chord.name} 的构成音中，但可以是经过音或延伸色彩。`}结束感还取决于节奏与和声；可以试听不同落点再决定。`;
}

function localRuleReply(prompt: string, project: Project, role?: 'sound' | 'composition' | 'coordinator'): Reply {
  const pitches = (list: number[]) => project.notes.map((n, i) => ({ ...n, pitch: list[i % list.length] }));
  if (role !== 'sound' && /为什么|乐理|结束|结尾|落下来/.test(prompt)) return { message: theory(project), candidates: [
    { title: '落在主音', explanation: '保留前面的旋律和节奏，仅把最后一个音落到当前调性的主音。', patch: { notes: project.notes.map((n, i) => i === project.notes.length - 1 ? { ...n, pitch: 72 } : n) } },
    { title: '保留一点悬念', explanation: '把末音改成当前调式的第七级，比较它与主音的张力。', patch: { notes: project.notes.map((n, i) => i === project.notes.length - 1 ? { ...n, pitch: 71 } : n) } },
  ] };
  if (role !== 'sound' && /和弦|和声|温暖|低音|编排|声部/.test(prompt)) return { message: '用同一段旋律比较两种和声色彩。候选还会打开和弦声部；提到低音时再加入根音低音。', candidates: [
    { title: '温暖的延伸', explanation: '按当前调式比较第一级与第六级七和弦。', patch: { chords: initialProject.chords.map((c, i) => ({ ...c, start: i * project.bars * 2, duration: project.bars * 2 })), layers: { harmony: true, ...(/低音/.test(prompt) ? { bass: true } : {}) } } },
    { title: '柔和的留白', explanation: '按当前调式从第四级回到主和弦，比较旋律和和弦的关系。', patch: { chords: [{ id: 'chord-demo-f', name: 'Fmaj7', pitches: [53, 57, 60, 64], start: 0, duration: project.bars * 2 }, { ...initialProject.chords[0], start: project.bars * 2, duration: project.bars * 2 }], layers: { harmony: true, ...(/低音/.test(prompt) ? { bass: true } : {}) } } },
  ] };
  if (role !== 'sound' && /旋律|动机|忧郁|乐句|节奏/.test(prompt)) return { message: '先从两小节的小想法开始。这两个变体保留原有时序，适合直接比较旋律走向。', candidates: [
    { title: '缓缓下落', explanation: '用逐步下行的轮廓形成收拢感；不改变已有节奏。', patch: { notes: pitches([72, 71, 67, 64, 69, 67, 64, 60]) } },
    { title: '轻盈的回应', explanation: '前半句上行，后半句回应，末音落在当前主音，提供稳定落点。', patch: { notes: pitches([64, 67, 72, 71, 67, 69, 64, 72]) } },
  ] };
  if (/声音|音色|玻璃|柔和|明亮|尾音|起音|短|宽|合成/.test(prompt)) {
    const patch: Partial<Sound> = /尾音|短/.test(prompt) ? { release: 0.2 } : /柔和/.test(prompt) ? { brightness: 24, wave: 'triangle' } : /宽/.test(prompt) ? { width: 20 } : { glass: 55, brightness: 45, wave: 'sine' };
    return { message: '从当前音色做小幅改变。这里依据参数生成候选，尚未进行音频模型听感分析。', candidates: [
      { title: /尾音|短/.test(prompt) ? '短一些的余韵' : /柔和/.test(prompt) ? '柔和的轮廓' : '玻璃般的微光', explanation: '只修改所述音色参数，保留旋律和和弦。', patch: { sound: patch } },
      { title: '另一种质感', explanation: '在同一个改动基础上调整泛音比例，比较声音的边缘。', patch: { sound: { ...patch, glass: patch.glass === undefined ? 18 : 35 } } },
    ] };
  }
  return { message: '本地规则演示支持音色、旋律、和弦与结尾探索。试试“音色再柔和一点”“写一个忧郁动机”“配和弦并加低音”，或在模型设置中连接真实对话模型。', candidates: [] };
}
export function localReply(prompt: string, project: Project, selection: number[] = [], role?: 'sound' | 'composition' | 'coordinator'): Reply {
  const reply = localRuleReply(prompt, project, role);
  reply.candidates = reply.candidates.map(c => ({ ...c, patch: { ...c.patch,
    ...(c.patch.notes ? { notes: c.patch.notes.map((n, i) => ({ ...n, pitch: /为什么|乐理|结束|结尾|落下来/.test(prompt) && i !== project.notes.length - 1 ? n.pitch : mapPitch(n.pitch, defaultTonality, project.tonality) })) } : {}),
    ...(c.patch.chords ? { chords: c.patch.chords.map(ch => { const pitches = ch.pitches.map(p => mapPitch(p, defaultTonality, project.tonality)); return { ...ch, pitches, name: chordName(pitches) }; }) } : {}),
  } }));
  if (selection.length) reply.candidates = reply.candidates.map(c => ({ ...c, patch: { ...c.patch, ...(c.patch.notes ? { notes: project.notes.map((n, i) => selection.includes(i) ? c.patch.notes![i] ?? n : n) } : {}) } }));
  return reply;
}

export function changeTonality(project: Project, target: Tonality, transpose = true): Project {
  const tonality = tonalitySchema.parse(target);
  if (project.tonality.tonic === tonality.tonic && project.tonality.mode === tonality.mode) return project;
  if (!transpose) return projectSchema.parse({ ...project, tonality, revision: project.revision + 1 });
  const notes = project.notes.map(n => ({ ...n, pitch: mapPitch(n.pitch, project.tonality, tonality) }));
  const chords = project.chords.map(c => { const pitches = c.pitches.map(p => mapPitch(p, project.tonality, tonality)); return { ...c, pitches, name: chordName(pitches) }; });
  if (notes.some(n => n.pitch < 21 || n.pitch > 108) || chords.some(c => c.pitches.some(p => p < 33 || p > 96))) throw new Error('转调后部分音符超出支持音域，请先调整八度，或选择仅更新调性参考。');
  if (chords.some(c => new Set(c.pitches).size !== c.pitches.length)) throw new Error('转换使部分和弦音重合，请手动调整构成音，或选择仅更新调性参考。');
  return projectSchema.parse({ ...applyPatch(project, { notes, ...(project.chords.length ? { chords } : {}) }, project.revision), tonality });
}
