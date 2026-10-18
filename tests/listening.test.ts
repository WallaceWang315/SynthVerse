import { packet } from './helpers/listening';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialProject, applyPatch } from '../src/domain';
import { probeProject, encodePCM, envelopeMetrics } from '../src/listening-audio';
import { createAudioReviewer, normalizeAudioEndpoint, pcmBytes, type AudioExecutor } from '../services/api/audio-perception';
import { MusicToolRuntime } from '../services/api/music-tools';
import type { Probe, ProbePacket } from '../src/listening-protocol';
import { savedSchema } from '../src/storage';

afterEach(() => vi.restoreAllMocks());
const candidate = () => new MusicToolRuntime({ prompt: '音色柔和', scope: 'sound', project: structuredClone(initialProject), history: [], selection: [] }).register({ title: '柔和', explanation: '降低亮度', patch: { sound: { brightness: 20 } } }).candidate;
const execute: AudioExecutor = async (_c, probes) => probes.map(p => packet(p));

describe('controlled audio observations', () => {
  it('uses identical musical probes for different sounds and the real synth for chords', () => {
    const changed = applyPatch(initialProject, { sound: { brightness: 20 } }, 0);
    for (const probe of ['sustain', 'staccato', 'chord'] as const) {
      const a = probeProject(initialProject, probe), b = probeProject(changed, probe);
      expect(a.notes).toEqual(b.notes); expect(a.bpm).toBe(b.bpm); expect(a.layers).toEqual({ melody: true, harmony: false, bass: false });
      expect(b.sound.brightness).toBe(20);
    }
    expect(probeProject(initialProject, 'chord').notes).toHaveLength(4);
    expect(probeProject({ ...initialProject, bars: 8 }, 'context').bars).toBe(4);
  });
  it('encodes bounded mono audio and detects inconsistent payload lengths', () => {
    const buffer = { sampleRate: 16000, length: 1600, numberOfChannels: 2, getChannelData: () => new Float32Array(1600).fill(0.5) };
    const audio = encodePCM(buffer);
    expect(pcmBytes(audio).readInt16LE(0)).toBe(16384);
    expect(() => pcmBytes({ ...audio, samples: 10 })).toThrow('不一致');
    expect(envelopeMetrics(buffer, 0.05).tailRms).toBeCloseTo(0.5);
  });
  it.each(['https://example.com/analyze', 'http://localhost:9000', 'http://127.0.0.1.evil.test/a', 'http://127.0.0.1/a?key=secret', 'http://user:pass@127.0.0.1/a'])('rejects non-literal-local or credential-bearing audio endpoints: %s', url => {
    expect(() => normalizeAudioEndpoint(url)).toThrow();
  });
  it('deduplicates actual rendering and keeps raw audio out of saved evidence', async () => {
    const render = vi.fn(execute); const review = createAudioReviewer(undefined, render, new AbortController().signal); const c = candidate();
    const [a, b] = await Promise.all([review(c, '柔和'), review(c, '柔和')]);
    expect(render).toHaveBeenCalledTimes(1); expect(a).toEqual(b); expect(a.status).toBe('signal-only'); expect(a.needsRevision).toBe(false);
    c.listening = a;
    const saved = savedSchema.parse({ project: initialProject, shelf: [], archive: [c] });
    expect(saved.archive[0].listening).toEqual(a); expect(JSON.stringify(saved)).not.toContain('pcm-s16le');
  });
  it('accepts local model observations, bounds them to the rendered segment and hides keys', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ findings: [{ code: 'tail', observation: '尾音重叠', goalRelation: '影响清晰', suggestion: '测试较短释放', probe: 'staccato', startSeconds: 0, endSeconds: 0.08 }], limitations: ['未校准的模型观察'], needsRevision: true })));
    const review = createAudioReviewer({ endpoint: 'http://127.0.0.1:9001/analyze', model: 'local-test', apiKey: 'secret' }, execute, new AbortController().signal);
    const evidence = await review(candidate(), '更清楚');
    expect(evidence.status).toBe('model-reviewed'); expect(evidence.findings[0].code).toBe('model-1'); expect(evidence.needsRevision).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('secret');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).clips[0].audio.encoding).toBe('pcm-s16le');
  });
  it('invalid observations and provider errors degrade without losing the candidate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ findings: [{ code: 'bad', observation: 'outside', goalRelation: '', suggestion: '', probe: 'context', endSeconds: 12 }], limitations: ['test'], needsRevision: true })));
    const c = candidate(); const result = await createAudioReviewer({ endpoint: 'http://127.0.0.1:9001/analyze', model: 'test' }, execute, new AbortController().signal)(c, 'goal');
    expect(result.status).toBe('model-failed'); expect(result.needsRevision).toBe(false); expect(c.project.sound.brightness).toBe(20);
  });
  it('reports render failure and never calls the model when probes are missing', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const result = await createAudioReviewer({ endpoint: 'http://127.0.0.1:9001/analyze', model: 'test' }, async () => [packet('context')], new AbortController().signal)(candidate(), 'goal');
    expect(result.status).toBe('render-failed'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not swallow cancellation as a perception failure', async () => {
    const controller = new AbortController();
    const review = createAudioReviewer(undefined, async () => { controller.abort(); return []; }, controller.signal);
    await expect(review(candidate(), 'goal')).rejects.toThrow();
  });
});
