import { z } from 'zod';

export const waveSchema = z.enum(['sine', 'triangle', 'sawtooth', 'square', 'wavetable']);
export const oscillatorSchema = z.object({ enabled: z.boolean(), wave: waveSchema, level: z.number().min(0).max(1), transpose: z.number().int().min(-24).max(24), fine: z.number().min(-100).max(100), unison: z.number().int().min(1).max(8), detune: z.number().min(0).max(50), pan: z.number().min(-1).max(1), position: z.number().min(0).max(1), table: z.enum(['basic', 'vowel', 'metal']) });
export const filterSchema = z.object({ enabled: z.boolean(), type: z.enum(['lowpass', 'highpass', 'bandpass', 'notch']), cutoff: z.number().min(30).max(18000), resonance: z.number().min(0.1).max(16), envelope: z.number().min(-4).max(4) });
export const envelopeSchema = z.object({ attack: z.number().min(0.005).max(4), decay: z.number().min(0.01).max(4), sustain: z.number().min(0).max(1), release: z.number().min(0.05).max(6) });
export const lfoSchema = z.object({ wave: z.enum(['sine', 'triangle', 'sawtooth', 'square']), rate: z.number().min(0.05).max(20), sync: z.boolean() });
export const modulationSchema = z.object({ source: z.enum(['lfo1', 'lfo2', 'env2', 'velocity']), target: z.enum(['pitch', 'cutoff', 'amplitude', 'pan']), amount: z.number().min(-1).max(1) });
export const effectsSchema = z.object({ distortion: z.number().min(0).max(1), chorus: z.number().min(0).max(1), delay: z.number().min(0).max(1), delayTime: z.number().min(0.05).max(1), feedback: z.number().min(0).max(0.7), reverb: z.number().min(0).max(1), reverbTime: z.number().min(0.2).max(3), phaser: z.number().min(0).max(1).default(0), flanger: z.number().min(0).max(1).default(0), eqLow: z.number().min(-12).max(12).default(0), eqMid: z.number().min(-12).max(12).default(0), eqHigh: z.number().min(-12).max(12).default(0), threshold: z.number().min(-40).max(0).default(-8), ratio: z.number().min(1).max(20).default(12) });
export const basicSoundFields = {
  wave: waveSchema, brightness: z.number().min(0).max(100), attack: z.number().min(0.005).max(2), release: z.number().min(0.05).max(3), width: z.number().min(0).max(30), glass: z.number().min(0).max(100),
};
export const advancedSoundFields = {
  oscillators: z.array(oscillatorSchema).length(3), filters: z.array(filterSchema).length(2), decay: z.number().min(0.01).max(4), sustain: z.number().min(0).max(1), noise: z.number().min(0).max(1), sub: z.number().min(0).max(1),
  env2: envelopeSchema, lfos: z.array(lfoSchema).length(2), modulations: z.array(modulationSchema).max(8), effects: effectsSchema,
};
export const oscillatorDefaults = [0, 1, 2].map(i => ({ enabled: i === 0, wave: 'triangle' as const, level: i === 0 ? 0.8 : 0.35, transpose: 0, fine: 0, unison: 1, detune: 7, pan: 0, position: 0, table: 'basic' as const }));
export const filterDefaults = [0, 1].map(i => ({ enabled: i === 0, type: 'lowpass' as const, cutoff: 15000, resonance: 0.6, envelope: 0 }));
export const effectDefaults = { distortion: 0, chorus: 0, delay: 0, delayTime: 0.25, feedback: 0.3, reverb: 0, reverbTime: 1.2, phaser: 0, flanger: 0, eqLow: 0, eqMid: 0, eqHigh: 0, threshold: -8, ratio: 12 };
export const soundSchema = z.object({ ...basicSoundFields,
  oscillators: advancedSoundFields.oscillators.default(oscillatorDefaults), filters: advancedSoundFields.filters.default(filterDefaults), decay: advancedSoundFields.decay.default(0.25), sustain: advancedSoundFields.sustain.default(0.6), noise: advancedSoundFields.noise.default(0), sub: advancedSoundFields.sub.default(0), env2: envelopeSchema.default({ attack: 0.01, decay: 0.5, sustain: 0, release: 0.3 }), lfos: advancedSoundFields.lfos.default([{ wave: 'sine', rate: 2, sync: false }, { wave: 'triangle', rate: 0.5, sync: false }]), modulations: advancedSoundFields.modulations.default([]), effects: effectsSchema.default(effectDefaults),
}).transform(sound => ({ ...sound, oscillators: sound.oscillators.map((osc, i) => i === 0 ? { ...osc, wave: sound.wave } : osc) }));
export const soundPatchSchema = z.object({ ...basicSoundFields, ...advancedSoundFields }).partial().strict();
export type SynthSound = z.infer<typeof soundSchema>;

// Independent Fourier tables; no Vital DSP, assets or factory presets are copied.
export function harmonicTable(table: 'basic' | 'vowel' | 'metal', position: number, pitchHz = 440, sampleRate = 44100) {
  const real = new Float32Array(65); const imag = new Float32Array(65);
  const harmonics = Math.min(64, Math.floor(sampleRate / 2 / pitchHz));
  for (let n = 1; n <= harmonics; n++) {
    const saw = (n % 2 ? 1 : -1) / n;
    const shaped = table === 'vowel' ? Math.exp(-Math.pow((n - (3 + position * 10)) / 2.5, 2)) / Math.sqrt(n) : table === 'metal' ? Math.sin(n * 2.4 + position * 4) / Math.sqrt(n) : saw;
    imag[n] = n === 1 ? 1 : position * shaped;
  }
  return { real, imag };
}

export const synthPresets = [
  { name: '微光', patch: { wave: 'triangle', brightness: 42, glass: 32, attack: 0.015, release: 0.65 } },
  { name: '宽阔铺底', patch: { wave: 'sawtooth', brightness: 28, glass: 0, attack: 0.6, release: 1.8, sustain: 0.75, oscillators: oscillatorDefaults.map((o, i) => ({ ...o, enabled: i < 2, unison: i === 0 ? 5 : 3, detune: 14, transpose: i === 1 ? 12 : 0, level: i === 0 ? 0.65 : 0.2 })), effects: { ...effectDefaults, chorus: 0.25, reverb: 0.3 } } },
  { name: '短促低音', patch: { wave: 'sawtooth', brightness: 18, glass: 0, attack: 0.005, decay: 0.18, sustain: 0.3, release: 0.15, sub: 0.35, filters: [{ ...filterDefaults[0], cutoff: 900, resonance: 1.8, envelope: 2 }, filterDefaults[1]] } },
  { name: '元音波表', patch: { wave: 'wavetable', brightness: 65, glass: 0, oscillators: oscillatorDefaults.map((o, i) => ({ ...o, wave: 'wavetable', table: 'vowel', position: 0.6, enabled: i === 0 })), modulations: [{ source: 'lfo1', target: 'cutoff', amount: 0.3 }], effects: { ...effectDefaults, delay: 0.15 } } },
] satisfies { name: string; patch: z.infer<typeof soundPatchSchema> }[];
