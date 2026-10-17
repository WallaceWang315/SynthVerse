import { describe, expect, it } from 'vitest';
import { changeTonality, initialProject, localReply, projectSchema, restoreSnapshot, theory } from '../src/domain';
import { defaultTonality, inScale, mapPitch, modes, type Tonality } from '../src/tonality';

describe('project tonality', () => {
  it('migrates old projects to C major and round-trips the selected key', () => {
    const old = { ...initialProject, tonality: undefined };
    expect(projectSchema.parse(old).tonality).toEqual(defaultTonality);
    const next = changeTonality(initialProject, { tonic: 2, mode: 'minor' });
    expect(projectSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('converts scale degrees and chord names while preserving timing, IDs and sound', () => {
    const next = changeTonality(initialProject, { tonic: 2, mode: 'minor' });
    expect(next.notes.map(n => n.pitch)).toEqual([62, 65, 69, 72, 70, 69, 65, 64]);
    expect(next.chords[0].pitches).toEqual([62, 65, 69, 72]);
    expect(next.chords[0].name).toBe('Dm7');
    expect(next.notes.map(({ pitch, ...rest }) => rest)).toEqual(initialProject.notes.map(({ pitch, ...rest }) => rest));
    expect(next.sound).toEqual(initialProject.sound);
    expect(next.revision).toBe(initialProject.revision + 1);
    expect(restoreSnapshot(initialProject, next.revision).tonality).toEqual(defaultTonality);
  });
  it('supports every key and mode, reversible for diatonic notes', () => {
    for (let tonic = 0; tonic < 12; tonic++) for (const mode of Object.keys(modes) as Tonality['mode'][]) {
      const key = { tonic, mode };
      for (const pitch of [48, 50, 52, 53, 55, 57, 59, 60, 71, 72]) {
        const mapped = mapPitch(pitch, defaultTonality, key);
        expect(inScale(mapped, key)).toBe(true);
        expect(mapPitch(mapped, key, defaultTonality)).toBe(pitch);
      }
    }
    expect(mapPitch(61, defaultTonality, { tonic: 2, mode: 'minor' })).toBe(63);
  });
  it('respects harmony locks, permits rhythm-preserving changes and metadata-only selection', () => {
    const locked = structuredClone(initialProject); locked.locks.harmony = true;
    expect(() => changeTonality(locked, { tonic: 9, mode: 'minor' })).toThrow('和弦已锁定');
    const reference = changeTonality(locked, { tonic: 9, mode: 'minor' }, false);
    expect(reference.notes).toEqual(locked.notes); expect(reference.chords).toEqual(locked.chords);
    locked.locks.harmony = false; locked.locks.rhythm = true;
    expect(changeTonality(locked, { tonic: 9, mode: 'minor' }).tonality.tonic).toBe(9);
  });
  it('rejects out-of-range transposition atomically', () => {
    const source = structuredClone(initialProject); source.notes[0].pitch = 108;
    expect(() => changeTonality(source, { tonic: 2, mode: 'major' })).toThrow('音域');
    expect(source.notes[0].pitch).toBe(108); expect(source.revision).toBe(0);
  });
  it('uses the selected key in local melodies, chords and theory without retuning unselected notes', () => {
    const project = changeTonality(initialProject, { tonic: 9, mode: 'minor' });
    for (const prompt of ['旋律', '和弦']) for (const candidate of localReply(prompt, project).candidates) {
      const pitches = candidate.patch.notes?.map(n => n.pitch) ?? candidate.patch.chords!.flatMap(c => c.pitches);
      expect(pitches.every(p => inScale(p, project.tonality))).toBe(true);
    }
    const ending = localReply('解释结尾', project).candidates[0].patch.notes!;
    expect(ending.slice(0, -1)).toEqual(project.notes.slice(0, -1));
    expect(ending.at(-1)!.pitch % 12).toBe(9);
    expect(theory(project)).toContain('A 自然小调');
    expect(localReply('旋律', project, [0]).candidates[0].patch.notes!.slice(1)).toEqual(project.notes.slice(1));
  });
});
