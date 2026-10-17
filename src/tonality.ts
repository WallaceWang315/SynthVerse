import { z } from 'zod';

export const pitchClasses = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const modes = {
  major: { name: '大调', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: '自然小调', intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { name: '多利亚', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: '弗里几亚', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: '利底亚', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: '混合利底亚', intervals: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: '洛克里亚', intervals: [0, 1, 3, 5, 6, 8, 10] },
};
export const tonalitySchema = z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian']) });
export type Tonality = z.infer<typeof tonalitySchema>;
export const defaultTonality: Tonality = { tonic: 0, mode: 'major' };
export const tonalityName = (key: Tonality) => `${pitchClasses[key.tonic]} ${modes[key.mode].name}`;
export const inScale = (pitch: number, key: Tonality) => modes[key.mode].intervals.includes(((pitch - key.tonic) % 12 + 12) % 12);

// Map scale degrees, retaining chromatic offsets from the nearest lower degree.
// Choose the shortest tonic displacement; do not silently fold out-of-range notes.
export function mapPitch(pitch: number, from: Tonality, to: Tonality): number {
  const relative = pitch - from.tonic;
  const octave = Math.floor(relative / 12), pc = ((relative % 12) + 12) % 12;
  const source = modes[from.mode].intervals, target = modes[to.mode].intervals;
  const degree = source.reduce((last, n, i) => n <= pc ? i : last, 0);
  let shift = to.tonic - from.tonic;
  if (shift > 6) shift -= 12;
  if (shift < -6) shift += 12;
  return from.tonic + shift + octave * 12 + target[degree] + pc - source[degree];
}

export function chordName(pitches: number[]): string {
  const pcs = [...new Set(pitches.map(p => p % 12))];
  const shapes: [string, number[]][] = [['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]], ['m7♭5', [0, 3, 6, 10]], ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]]];
  for (const root of pcs) for (const [suffix, intervals] of shapes) {
    if (pcs.length === intervals.length && intervals.every(n => pcs.includes((root + n) % 12))) {
      const bass = Math.min(...pitches) % 12;
      return pitchClasses[root] + suffix + (bass !== root ? `/${pitchClasses[bass]}` : '');
    }
  }
  return pcs.map(pc => pitchClasses[pc]).join('·');
}
