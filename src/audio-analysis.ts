import type { AudioMetrics } from './agent-protocol';
// Radix-2 FFT, bounded deterministic sampling. Metrics are descriptive, not an aesthetic score.
export function analyzeAudio(buffer: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(channel: number): Float32Array }): AudioMetrics {
  if (!buffer.length || !buffer.numberOfChannels) throw new Error('音频为空。');
  let squares = 0, peak = 0, clipped = 0;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (const channel of channels) for (const x of channel) { if (!Number.isFinite(x)) throw new Error('音频包含无效采样。'); squares += x * x; peak = Math.max(peak, Math.abs(x)); if (Math.abs(x) >= 0.999) clipped++; }
  const size = 2048; let weighted = 0, total = 0, high = 0;
  const windows = Math.min(24, Math.max(1, Math.ceil(buffer.length / size)));
  for (const channel of channels) for (let window = 0; window < windows; window++) {
    const start = Math.floor(window * Math.max(0, buffer.length - size) / Math.max(1, windows - 1)); const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (channel[start + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    for (let i = 1, j = 0; i < size; i++) { let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) [re[i], re[j]] = [re[j], re[i]]; }
    for (let length = 2; length <= size; length *= 2) for (let start = 0; start < size; start += length) for (let j = 0; j < length / 2; j++) {
      const angle = -2 * Math.PI * j / length, a = start + j, b = a + length / 2; const real = re[b] * Math.cos(angle) - im[b] * Math.sin(angle), imaginary = re[b] * Math.sin(angle) + im[b] * Math.cos(angle); re[b] = re[a] - real; im[b] = im[a] - imaginary; re[a] += real; im[a] += imaginary;
    }
    for (let i = 1; i <= size / 2; i++) { const energy = re[i] ** 2 + im[i] ** 2, frequency = i * buffer.sampleRate / size; total += energy; weighted += energy * frequency; if (frequency >= 4000) high += energy; }
  }
  return { basis: 'browser-offline-audio', durationSeconds: buffer.length / buffer.sampleRate, sampleRate: buffer.sampleRate, rms: Math.sqrt(squares / (buffer.length * channels.length)), peak, clippingRatio: clipped / (buffer.length * channels.length), spectralCentroidHz: total > 1e-20 ? weighted / total : null, highFrequencyEnergyRatio: total > 1e-20 ? high / total : 0 };
}
