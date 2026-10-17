import { describe, expect, it } from 'vitest';
import { applyPatch, initialProject, localReply, projectSchema, restoreSnapshot, theory } from '../src/domain';
import { matchPreviewLevel, midiBytes, wavBytes } from '../src/audio';
import { Midi } from '@tonejs/midi';

const base = () => structuredClone(initialProject);
describe('music commands', () => {
  it('merges sound edits without changing musical content or source', () => {
    const p = base(); const next = applyPatch(p, { sound: { brightness: 15 } }, p.revision);
    expect(next.sound.brightness).toBe(15); expect(next.sound.attack).toBe(p.sound.attack);
    expect(next.notes).toEqual(p.notes); expect(p.sound.brightness).toBe(42); expect(next.revision).toBe(1);
  });
  it('rejects candidates from an earlier project revision', () => {
    expect(() => applyPatch({ ...base(), revision: 2 }, { layers: { bass: true } }, 0)).toThrow('当前创意已改变');
  });
  it('enforces sound and harmony locks', () => {
    const p = base(); p.locks.sound = true; p.locks.harmony = true;
    expect(() => applyPatch(p, { sound: { attack: 1 } }, 0)).toThrow('音色已锁定');
    expect(() => applyPatch(p, { chords: p.chords }, 0)).toThrow('和弦已锁定');
    expect(applyPatch(p, { layers: { bass: true } }, 0).layers.bass).toBe(true);
  });
  it('rhythm lock allows pitches but rejects changes to time, duration, velocity and count', () => {
    const p = base(); p.locks.rhythm = true;
    expect(applyPatch(p, { notes: p.notes.map(n => ({ ...n, pitch: 72 })) }, 0).notes[0].pitch).toBe(72);
    for (const key of ['start', 'duration', 'velocity'] as const) {
      const notes = structuredClone(p.notes); notes[0][key] += 0.1;
      expect(() => applyPatch(p, { notes }, 0)).toThrow('节奏已锁定');
    }
    expect(() => applyPatch(p, { notes: p.notes.slice(1) }, 0)).toThrow('节奏已锁定');
  });
  it('undo restores content while keeping the revision monotonic', () => {
    const p = base(); const next = applyPatch(p, { sound: { brightness: 20 } }, 0);
    const restored = restoreSnapshot(p, next.revision);
    expect(restored.sound).toEqual(p.sound); expect(restored.revision).toBe(2);
    expect(() => applyPatch(restored, {}, 0)).toThrow();
  });
  it('rejects invalid imports and out-of-bounds notes', () => {
    expect(projectSchema.safeParse({ ...base(), version: 99 }).success).toBe(false);
    expect(() => applyPatch(base(), { notes: [{ pitch: 72, start: 7.75, duration: 4, velocity: 0.8 }] }, 0)).toThrow();
  });
});
describe('inspiration and theory', () => {
  it('motif suggestions keep locked rhythm intact', () => {
    const p = base(); p.locks.rhythm = true;
    for (const c of localReply('写一个忧郁动机', p).candidates) expect(() => applyPatch(p, c.patch, 0)).not.toThrow();
  });
  it('explains the chord at the actual final note, including octave equivalence', () => {
    const p = base(); p.notes[p.notes.length - 1].pitch = 72;
    expect(theory(p)).toContain('Am7'); expect(theory(p)).toContain('属于');
    p.notes[p.notes.length - 1].pitch = 62; expect(theory(p)).toContain('不在');
  });
  it('local unknown requests never fabricate a model response or audio analysis', () => {
    expect(localReply('请分析我的完整交响曲', base()).candidates).toHaveLength(0);
    expect(localReply('音色更柔和', base()).message).toContain('尚未进行音频模型');
  });
});
describe('exports', () => {
  it('preview level matching keeps silence finite and caps loud peaks', () => {
    const silentData = new Float32Array(2);
    const silence = { length: 2, numberOfChannels: 1, getChannelData: () => silentData };
    matchPreviewLevel(silence); expect([...silentData]).toEqual([0, 0]);
    const data = new Float32Array([0.6, -0.6]);
    const loud = { length: 2, numberOfChannels: 1, getChannelData: () => data };
    matchPreviewLevel(loud); expect(data[0]).toBeCloseTo(0.3); expect(data[1]).toBeCloseTo(-0.3);
  });
  it('MIDI round-trips notes, tempo and independently enabled layers', () => {
    const p = base(); p.layers.harmony = true; p.layers.bass = true;
    const midi = new Midi(midiBytes(p));
    expect(midi.tracks).toHaveLength(3); expect(midi.tracks[0].notes.map(n => n.midi)).toEqual(p.notes.map(n => n.pitch));
    expect(midi.header.tempos[0].bpm).toBeCloseTo(p.bpm, 2); expect(midi.tracks[2].notes[0].midi).toBe(48);
    expect(midi.tracks[0].notes[1].time).toBeCloseTo(60 / p.bpm, 2);
  });
  it('WAV has correct stereo header, interleaving and clipping', () => {
    const buffer = { length: 2, numberOfChannels: 2, sampleRate: 44100, getChannelData: (channel: number) => new Float32Array(channel ? [0.5, -2] : [2, 0]) } as AudioBuffer;
    const result = wavBytes(buffer); const view = new DataView(result);
    expect(new TextDecoder().decode(result.slice(0, 4))).toBe('RIFF'); expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(32767); expect(view.getInt16(46, true)).toBe(16384); expect(view.getInt16(50, true)).toBe(-32768);
  });
});
