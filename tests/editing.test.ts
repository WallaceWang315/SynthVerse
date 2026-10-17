import { describe, expect, it } from 'vitest';
import { applyPatch, initialProject, projectSchema, theory } from '../src/domain';
import { harmonicTable, soundSchema, synthPresets } from '../src/synth';
import { makeChord, moveNotes, resizeNotes } from '../src/music-edit';
import { analyzeMusic, executeMusicTool, validateScopedPatch } from '../services/api/agent';
import { Midi } from '@tonejs/midi';
import { midiBytes } from '../src/audio';
const base = () => structuredClone(initialProject);
describe('expanded workbench', () => {
  it('migrates v1 projects without losing content', () => {
    const old = { ...base(), version: 1, sound: { wave: 'square', brightness: 50, attack: 0.1, release: 0.4, width: 0, glass: 0 }, chords: base().chords.map(({ start, duration, ...c }) => c) };
    const restored = projectSchema.parse(old); expect(restored.version).toBe(3); expect(restored.bars).toBe(2); expect(restored.chords.map(c => [c.start, c.duration])).toEqual([[0, 4], [4, 4]]); expect(restored.sound.oscillators).toHaveLength(3); expect(restored.notes).toEqual(old.notes);
  });
  it('permits 16 bars, low/high pitches and more than 2 chords', () => {
    const p = base(); p.bars = 16; p.notes = [{ id: 'note-low', pitch: 21, start: 0, duration: 0.125, velocity: 0.1 }, { id: 'note-high', pitch: 108, start: 63, duration: 1, velocity: 1 }]; p.chords = Array.from({ length: 16 }, (_, i) => makeChord(48, 'maj7', 0, i * 4, 4)); expect(projectSchema.parse(p).chords).toHaveLength(16);
  });
  it('rejects overlapping chords and destructive shrinking while allowing gaps', () => {
    const p = base(); expect(() => applyPatch(p, { bars: 1 }, 0)).toThrow(); expect(() => applyPatch(p, { chords: [makeChord(60, 'major', 0, 0, 4), makeChord(57, 'minor', 0, 3, 4)] }, 0)).toThrow(); expect(applyPatch(p, { chords: [makeChord(60, 'major', 0, 2, 2)] }, 0).chords[0].start).toBe(2);
  });
  it('preserves relative timing when moving selection at clip boundaries', () => {
    const p = base(); const next = moveNotes(p, [6, 7], 10, 50); expect(next[7].start + next[7].duration).toBe(8); expect(next[6].pitch).toBe(108); expect(next[7].pitch - next[6].pitch).toBe(-2); expect(next[6].start - next[7].start).toBe(-1); expect(next[0]).toEqual(p.notes[0]);
  });
  it('resizes at minimum duration and clip end and respects rhythm locks', () => {
    const p = base(); expect(resizeNotes(p, [0], -10)[0].duration).toBeCloseTo(0.125); expect(resizeNotes(p, [7], 10)[7].duration).toBe(1); p.locks.rhythm = true; expect(moveNotes(p, [0], 2, 1)[0]).toEqual({ ...p.notes[0], pitch: 61 }); expect(resizeNotes(p, [0], 2)).toEqual(p.notes);
  });
  it('inversion changes voicing and actual MIDI bass, with chord time intact', () => {
    const p = base(); p.chords = [makeChord(60, 'major', 1, 2, 1.5)]; p.layers.harmony = true; p.layers.bass = true; expect(p.chords[0].pitches).toEqual([64, 67, 72]); const midi = new Midi(midiBytes(p)); expect(midi.tracks[1].notes[0].time).toBeCloseTo(120 / p.bpm, 3); expect(midi.tracks[2].notes[0].midi).toBe(52); expect(midi.tracks[1].notes[0].duration).toBeCloseTo(90 / p.bpm, 3);
  });
  it('does not reset advanced sound fields on a macro edit', () => {
    const p = base(); p.sound.noise = 0.3; p.sound.effects.reverb = 0.4; const next = applyPatch(p, { sound: { brightness: 20 } }, 0); expect(next.sound.noise).toBe(0.3); expect(next.sound.effects.reverb).toBe(0.4);
  });
  it('all curated sounds have valid three-oscillator patches', () => { for (const preset of synthPresets) expect(soundSchema.parse({ ...base().sound, ...preset.patch }).oscillators).toHaveLength(3); });
  it('Fourier wavetable harmonics above Nyquist are suppressed', () => { const table = harmonicTable('metal', 0.7, 4000, 44100); expect(table.imag.slice(6).every(n => n === 0)).toBe(true); expect(table.imag[1]).toBe(1); });
  it('selected edits cannot change unselected notes or counts', () => {
    const p = base(); expect(() => validateScopedPatch(p, { notes: p.notes.map((n, i) => ({ ...n, pitch: i === 0 ? 72 : n.pitch })) }, [0])).not.toThrow(); expect(() => validateScopedPatch(p, { notes: p.notes.map(n => ({ ...n, pitch: 72 })) }, [0])).toThrow('选中的音符'); expect(validateScopedPatch(p, { notes: p.notes.slice(1) }, [0]).notes).toHaveLength(p.notes.length - 1);
  });
  it('tools report symbolic analysis and never apply to the input', () => {
    const p = base(); const original = structuredClone(p); const input = { project: p, scope: 'sound', selection: [], history: [], prompt: '柔和' }; const result = executeMusicTool('propose_edit', { title: '柔和', explanation: '降低亮度', patch: { sound: { brightness: 20 } } }, input); expect(result).toHaveProperty('accepted', true); expect(p).toEqual(original); expect(analyzeMusic(p).basis).toBe('symbolic-notes-and-parameters'); expect(() => executeMusicTool('delete_files', {}, input)).toThrow('不存在');
  });
  it('theory follows chord placement and handles empty harmony', () => { const p = base(); p.chords = []; expect(theory(p)).toContain('没有和弦'); });
});
