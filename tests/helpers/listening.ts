import type { Probe, ProbePacket } from '../../src/listening-protocol';
export function packet(probe: Probe, overrides: Partial<ProbePacket['metrics']> = {}): ProbePacket {
  const data = new Uint8Array(3200); new DataView(data.buffer).setInt16(0, 1000, true);
  return { probe, engine: 'web-audio-v3-probes-1', configId: `fixture-${probe}`, durationSeconds: 0.1, truncated: false,
    audio: { encoding: 'pcm-s16le', sampleRate: 16000, channels: 1, samples: 1600, data: Buffer.from(data).toString('base64') },
    metrics: { rms: 0.1, peak: 0.3, clippingRatio: 0, spectralCentroidHz: 500, highFrequencyEnergyRatio: 0.01, onsetToPeakMs: 20, tailRms: 0.01, ...overrides } };
}
