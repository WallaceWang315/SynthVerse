import { initialProject, type Project } from '../src/domain';
import type { Operation } from '../src/commands';
export type Scenario = { id: string; title: string; prompt: string; followUp?: string; scope: 'sound' | 'motif' | 'harmony'; selection: string[]; taskGoal: string; preferences: string[]; project: Project; operations: Operation[]; helper?: { name: string; args: unknown }; invalidFirst?: boolean; explanationOnly?: boolean; combine?: boolean; checks: string[]; manualRubric: string[] };
export function creativeScenarios(): Scenario[] {
  const p = () => structuredClone(initialProject); const noteId = initialProject.notes[7].id;
  const base = { selection: [] as string[], taskGoal: '探索一个可以继续发展的短音乐想法', preferences: ['保留未要求修改的内容'], project: p(), checks: [] as string[], manualRubric: ['0–2分：请求满足度', '0–2分：听感或乐理解释质量', '0–2分：是否提供有用的创作启发'] };
  const soundOps = (values: Record<string, number>): Operation[] => [{ type: 'set_sound_parameters', values }];
  const cases: Omit<Scenario, keyof typeof base>[] = [
    { id: 'soft-glass', title: '柔和玻璃音色与续改', scope: 'sound', prompt: '玻璃音色柔和一点，保留起音和旋律。', followUp: '继续刚才的候选，尾音再缩短一点。', operations: soundOps({ brightness: 24 }), helper: { name: 'edit_sound', args: { values: { brightness: 24 } } } },
    { id: 'short-release', title: '精确修改尾音', scope: 'sound', prompt: '只把尾音缩短到0.2秒，其他参数保持。', operations: soundOps({ release: 0.2 }) },
    { id: 'selected-ending', title: '只改选中的末音', scope: 'motif', prompt: '只将选中末音改成C5，其余音符和节奏保持。', operations: [{ type: 'update_note', noteId, changes: { pitch: 72 } }], helper: { name: 'transform_motif', args: { noteIds: [noteId], action: 'set_pitch', amount: 72 } } },
    { id: 'locked-transpose', title: '节奏锁定时移调', scope: 'motif', prompt: '把所有音符升高一个半音，保留已锁定的节奏和力度。', operations: initialProject.notes.map(n => ({ type: 'update_note', noteId: n.id, changes: { pitch: n.pitch + 1 } })), helper: { name: 'transform_motif', args: { noteIds: initialProject.notes.map(n => n.id), action: 'transpose', amount: 1 } } },
    { id: 'four-chords', title: '四和弦进行', scope: 'harmony', prompt: '用C、Am、F、G四个和弦覆盖这两小节，每个持续2拍，打开和弦声部。', operations: [...initialProject.chords.map(c => ({ type: 'delete_chord' as const, chordId: c.id })), ...[[60,64,67],[57,60,64],[53,57,60],[55,59,62]].map((pitches,i) => ({ type: 'add_chord' as const, chord: { name: ['C','Am','F','G'][i], pitches, start: i*2, duration: 2 } })), { type: 'set_layers', values: { harmony: true } }] },
    { id: 'harmony-gap', title: '给和声留白', scope: 'harmony', prompt: '将第一个和弦缩短为2拍，空出第3和第4拍，保留后面的和弦。', operations: [{ type: 'update_chord', chordId: initialProject.chords[0].id, changes: { duration: 2 } }], helper: { name: 'edit_chords', args: { operations: [{ type: 'update_chord', chordId: initialProject.chords[0].id, changes: { duration: 2 } }] } } },
    { id: 'advanced-effects', title: '完整效果参数保持', scope: 'sound', prompt: '加一点合唱和混响，保持振荡器、旋律和其他效果设置。', operations: [{ type: 'set_sound_parameters', values: { effects: { ...initialProject.sound.effects, chorus: 0.2, reverb: 0.2 } } }] },
    { id: 'explanation-only', title: '讲解而不修改', scope: 'motif', prompt: '解释最后一个音和当前和弦的关系，给我一条建议，不要生成或应用候选。', operations: [], explanationOnly: true },
    { id: 'invalid-correction', title: '工具错误后的修正', scope: 'sound', prompt: '音色柔和一点，亮度设置到24。无效工具参数必须修正后再返回。', operations: soundOps({ brightness: 24 }), invalidFirst: true },
    { id: 'branch-combination', title: '不同候选的分支组合', scope: 'sound', prompt: '组合我指定的第一个参考的音色和第二个参考的旋律，保留当前和弦。', operations: [], combine: true },
    { id: 'delete-selected', title: '删除局部音符', scope: 'motif', prompt: '只删除选中的最后一个音，其他音符不能改变。', operations: [{ type: 'delete_note', noteId }] },
    { id: 'boundary-add', title: '片段末端添加短音', scope: 'motif', prompt: '在第7.5拍添加一个C5，持续0.5拍，力度0.6，不超出两小节。', operations: [{ type: 'add_note', note: { pitch: 72, start: 7.5, duration: 0.5, velocity: 0.6 } }] },
  ];
  return cases.map(c => { const result = { ...structuredClone(base), ...c }; if (['selected-ending', 'delete-selected'].includes(c.id)) result.selection = [noteId]; if (c.id === 'locked-transpose') result.project.locks.rhythm = true;
    result.checks = ['原工程未被工具修改', '候选只引用已注册 ID', '工程边界、锁定和选区校验通过', c.explanationOnly ? '没有候选' : '请求得到候选且完成真实浏览器渲染', '检查请求指定的音高、和弦或参数变化']; return result;
  });
}
export function satisfiesScenario(s: Scenario, next: Project): boolean {
  const p = s.project;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (s.scope === 'sound' && !s.combine && (!equal(next.notes, p.notes) || !equal(next.chords, p.chords) || !equal(next.layers, p.layers))) return false;
  if (s.scope === 'motif' && (!equal(next.sound, p.sound) || !equal(next.chords, p.chords) || !equal(next.layers, p.layers))) return false;
  if (s.scope === 'harmony' && (!equal(next.notes, p.notes) || !equal(next.sound, p.sound))) return false;
  if (s.id === 'soft-glass') return next.sound.brightness < p.sound.brightness && next.sound.attack === p.sound.attack;
  if (s.id === 'invalid-correction') return next.sound.brightness === 24;
  if (s.id === 'short-release') return next.sound.release === 0.2 && equal({ ...next.sound, release: p.sound.release }, p.sound);
  if (s.id === 'selected-ending') return next.notes.find(n => n.id === p.notes[7].id)?.pitch === 72;
  if (s.id === 'locked-transpose') return p.notes.every(n => next.notes.find(x => x.id === n.id)?.pitch === n.pitch + 1);
  if (s.id === 'four-chords') return next.layers.harmony && next.chords.length === 4 && next.chords.every((c, i) => c.name === ['C','Am','F','G'][i] && c.start === i*2 && c.duration === 2);
  if (s.id === 'harmony-gap') return next.chords[0].duration === 2 && JSON.stringify(next.chords[1]) === JSON.stringify(p.chords[1]);
  if (s.id === 'advanced-effects') return next.sound.effects.chorus > 0 && next.sound.effects.chorus <= 0.4 && next.sound.effects.reverb > 0 && next.sound.effects.reverb <= 0.4 && equal({ ...next.sound, effects: { ...next.sound.effects, chorus: p.sound.effects.chorus, reverb: p.sound.effects.reverb } }, p.sound);
  if (s.id === 'branch-combination') return next.sound.brightness === 24 && next.notes.at(-1)?.pitch === 72 && equal(next.chords, p.chords);
  if (s.id === 'delete-selected') return next.notes.length === p.notes.length - 1 && !next.notes.some(n => n.id === p.notes[7].id);
  if (s.id === 'boundary-add') return next.notes.some(n => !p.notes.some(x => x.id === n.id) && n.pitch === 72 && n.start === 7.5 && n.duration === 0.5 && n.velocity === 0.6);
  return true;
}
