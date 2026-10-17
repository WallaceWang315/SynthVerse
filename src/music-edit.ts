import { newId, noteSchema, type Note, type Project } from './domain';
export const chordQualities = { major: [0, 4, 7], minor: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6] };
export const qualityNames = { major: '大三和弦', minor: '小三和弦', maj7: '大七', min7: '小七', dom7: '属七', sus2: '挂二', sus4: '挂四', dim: '减三' };
export function chordShape(chord: Project['chords'][number]) {
  const match = /^(C♯|D♯|F♯|G♯|A♯|C|D|E|F|G|A|B)(maj7|m7|m|7|sus2|sus4|dim)?/.exec(chord.name);
  const lowest = Math.min(...chord.pitches);
  const pitchClass = match ? ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'].indexOf(match[1]) : lowest % 12;
  const possibleRoot = Math.floor(lowest / 12) * 12 + pitchClass;
  return { root: Math.max(33, possibleRoot > lowest ? possibleRoot - 12 : possibleRoot), quality: ({ maj7: 'maj7', m7: 'min7', m: 'minor', '7': 'dom7', sus2: 'sus2', sus4: 'sus4', dim: 'dim' } as Record<string, keyof typeof chordQualities>)[match?.[2] ?? ''] ?? 'major', inversion: Number(/转位(\d)/.exec(chord.name)?.[1] ?? 0) };
}
export function makeChord(root: number, quality: keyof typeof chordQualities, inversion: number, start: number, duration: number) {
  const pitches = chordQualities[quality].map(n => root + n);
  for (let i = 0; i < inversion; i++) pitches.push(pitches.shift()! + 12);
  const suffix = { major: '', minor: 'm', maj7: 'maj7', min7: 'm7', dom7: '7', sus2: 'sus2', sus4: 'sus4', dim: 'dim' }[quality];
  return { id: newId('chord'), name: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][root % 12] + suffix + (inversion ? ` / 转位${inversion}` : ''), pitches, start, duration };
}
export const snapBeat = (beat: number, grid: number) => Math.round(beat / grid) * grid;
export function moveNotes(project: Project, selected: number[], deltaBeat: number, deltaPitch: number): Note[] {
  const items = selected.map(i => project.notes[i]).filter(Boolean); if (!items.length) return project.notes;
  const delta = project.locks.rhythm ? 0 : Math.max(-Math.min(...items.map(n => n.start)), Math.min(deltaBeat, project.bars * 4 - Math.max(...items.map(n => n.start + n.duration))));
  const semitones = Math.max(21 - Math.min(...items.map(n => n.pitch)), Math.min(deltaPitch, 108 - Math.max(...items.map(n => n.pitch))));
  return project.notes.map((n, i) => selected.includes(i) ? noteSchema.parse({ ...n, start: n.start + delta, pitch: n.pitch + semitones }) : n);
}
export function resizeNotes(project: Project, selected: number[], delta: number) {
  if (project.locks.rhythm) return project.notes;
  const items = selected.map(i => project.notes[i]).filter(Boolean); if (!items.length) return project.notes;
  const safe = Math.max(0.125 - Math.min(...items.map(n => n.duration)), Math.min(delta, project.bars * 4 - Math.max(...items.map(n => n.start + n.duration))));
  return project.notes.map((n, i) => selected.includes(i) ? { ...n, duration: n.duration + safe } : n);
}
