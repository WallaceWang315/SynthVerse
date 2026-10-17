import { initialProject, type Project } from '../src/domain';
import { makeChord } from '../src/music-edit';
import type { AgentInput } from '../services/api/agent';
export type EvaluationCase = { id: string; category: string; input: AgentInput; candidate: { title: string; explanation: string; patch: unknown }; expectedAccepted: boolean; requiresCandidate: boolean };
export function evaluationCases(): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  for (let variant = 0; variant < 5; variant++) {
    const base: Project = structuredClone(initialProject); base.bpm = 80 + variant * 20; base.bars = variant % 2 ? 4 : 2;
    base.notes = base.notes.map(n => ({ ...n, pitch: n.pitch + variant }));
    const add = (category: string, prompt: string, patch: unknown, accepted: boolean, project = structuredClone(base), selection: number[] = [], requiresCandidate = accepted) => cases.push({ id: `${category}-${variant + 1}`, category, input: { prompt, project, selection, scope: category.includes('sound') ? 'sound' : category.includes('chord') ? 'harmony' : 'motif', history: [] }, candidate: { title: '评测候选', explanation: '自动约束校验用候选；不评价音乐审美。', patch }, expectedAccepted: accepted, requiresCandidate });
    add('sound-edit', '音色柔和一点，保留起音。', { sound: { brightness: 20 } }, true);
    const soundLocked = structuredClone(base); soundLocked.locks.sound = true; add('sound-lock', '音色锁定了，请解释能探索什么，不要修改音色。', { sound: { brightness: 20 } }, false, soundLocked);
    const rhythmLocked = structuredClone(base); rhythmLocked.locks.rhythm = true;
    add('rhythm-pitch', '保留节奏和力度，把旋律提高一个半音。', { notes: base.notes.map(n => ({ ...n, pitch: n.pitch + 1 })) }, true, rhythmLocked);
    add('rhythm-lock', '节奏已锁定，请解释节奏变化的可能性，不要修改音符。', { notes: base.notes.map(n => ({ ...n, duration: n.duration + 0.1 })) }, false, rhythmLocked);
    add('selection-edit', '只把选中音符提高一个半音，其余保持。', { notes: base.notes.map((n, i) => i === 1 ? { ...n, pitch: n.pitch + 1 } : n) }, true, structuredClone(base), [1]);
    add('selection-boundary', '只改选中的两个音符，提出一个旋律变体。', { notes: base.notes.map(n => ({ ...n, pitch: n.pitch + 1 })) }, false, structuredClone(base), [1, 2], true);
    add('chord-overlap', '给旋律配一组无重叠、可留白的和弦。', { chords: [makeChord(60, 'major', 0, 0, 4), makeChord(57, 'minor', 0, 3, 4)] }, false, structuredClone(base), [], true);
    add('clip-boundary', '在片段最后半拍放一个短音符，不要超出片段。', { notes: [...base.notes, { pitch: 60, start: base.bars * 4 - 0.5, duration: 1, velocity: 0.7 }] }, false, structuredClone(base), [], true);
    add('chord-progression', '用四个和弦覆盖当前片段：C、Am、F、G。', { chords: [60, 57, 53, 55].map((root, i) => makeChord(root, i === 1 ? 'minor' : 'major', 0, i * base.bars, base.bars)), layers: { harmony: true } }, true);
    add('advanced-sound', '加一点合唱与混响，只修改效果，保持音符。', { sound: { effects: { ...base.sound.effects, chorus: 0.2, reverb: 0.2 } } }, true);
  }
  return cases;
}
