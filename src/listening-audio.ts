import { renderProject, matchPreviewLevel, wavBytes } from './audio';
import { analyzeAudio } from './audio-analysis';
import { projectSchema, type Project } from './domain';
import { type PCM, type Probe, type ProbePacket, type ReferenceAudio } from './listening-protocol';

export function probeProject(source: Project, probe: Probe): Project {
  const p = structuredClone(source);
  if (probe === 'context') {
    p.bars = Math.min(4, p.bars);
    p.notes = p.notes.filter(n => n.start < p.bars * 4).map(n => ({ ...n, duration: Math.min(n.duration, p.bars * 4 - n.start) }));
    p.chords = p.chords.filter(c => c.start < p.bars * 4).map(c => ({ ...c, duration: Math.min(c.duration, p.bars * 4 - c.start) }));
  } else {
    p.bpm = 120; p.bars = 2; p.chords = []; p.layers = { melody: true, harmony: false, bass: false };
    const pitches = probe === 'chord' ? [60, 64, 67, 71] : probe === 'staccato' ? Array(12).fill(60) as number[] : [60];
    p.notes = pitches.map((pitch, i) => ({ id: `probe-${probe}-${i}`, pitch, start: probe === 'staccato' ? i * 0.5 : 0, duration: probe === 'staccato' ? 0.2 : 4, velocity: 0.7 }));
  }
  return projectSchema.parse(p);
}

export async function sha256(data: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function encodePCM(buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>, maxSeconds = 32): PCM {
  const samples = Math.min(Math.floor(buffer.length * 16000 / buffer.sampleRate), 16000 * maxSeconds);
  const data = new Uint8Array(samples * 2), view = new DataView(data.buffer);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  // Box-average resampling: deterministic transport for analysis, not export mastering.
  for (let i = 0; i < samples; i++) {
    const start = Math.floor(i * buffer.sampleRate / 16000), end = Math.max(start + 1, Math.floor((i + 1) * buffer.sampleRate / 16000));
    let sum = 0, count = 0;
    for (const channel of channels) for (let j = start; j < Math.min(end, buffer.length); j++) { sum += channel[j]; count++; }
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, count)));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return { encoding: 'pcm-s16le', sampleRate: 16000, channels: 1, samples, data: btoa(binary) };
}
export function envelopeMetrics(buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>, lastNoteOff: number) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const frame = Math.max(1, Math.floor(buffer.sampleRate * 0.01));
  let max = 0, peakAt = 0, onset = -1, tailSquares = 0, tailCount = 0;
  for (let start = 0; start < buffer.length; start += frame) {
    let squares = 0, count = 0;
    for (const channel of channels) for (let i = start; i < Math.min(start + frame, buffer.length); i++) { squares += channel[i] ** 2; count++; if (i / buffer.sampleRate >= lastNoteOff) { tailSquares += channel[i] ** 2; tailCount++; } }
    const rms = Math.sqrt(squares / Math.max(count, 1));
    if (rms > 0.00001 && onset < 0) onset = start;
    if (rms > max) { max = rms; peakAt = start; }
  }
  return { onsetToPeakMs: onset < 0 ? 0 : Math.max(0, (peakAt - onset) / buffer.sampleRate * 1000), tailRms: Math.sqrt(tailSquares / Math.max(1, tailCount)) };
}
type Artifact = { id: string; raw: ArrayBuffer; matched: ArrayBuffer; savedAt: number };
async function artifactDB() {
  return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('synthverse-listening', 1); request.onupgradeneeded = () => request.result.createObjectStore('audio', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function saveArtifact(artifact: Artifact) {
  const db = await artifactDB();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); const store = tx.objectStore('audio'); store.put(artifact); const all = store.getAll(); all.onsuccess = () => { let total = 0; for (const entry of (all.result as Artifact[]).sort((a, b) => b.savedAt - a.savedAt)) { total += entry.raw.byteLength + entry.matched.byteLength; if (total > 64 * 1024 * 1024) store.delete(entry.id); } }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
export async function loadAudioArtifact(id: string, matched = true): Promise<ArrayBuffer | undefined> {
  const db = await artifactDB();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('audio').objectStore('audio').get(id); request.onsuccess = () => resolve(request.result?.[matched ? 'matched' : 'raw']); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function renderProbes(project: Project, probes: Probe[], signal: AbortSignal): Promise<ProbePacket[]> {
  const results: ProbePacket[] = [];
  for (const probe of probes) {
    signal.throwIfAborted(); const score = probeProject(project, probe); const full = await renderProject(score); signal.throwIfAborted();
    const frames = Math.min(full.length, full.sampleRate * 32);
    const buffer = new AudioBuffer({ length: frames, sampleRate: full.sampleRate, numberOfChannels: full.numberOfChannels });
    for (let c = 0; c < full.numberOfChannels; c++) buffer.copyToChannel(full.getChannelData(c).subarray(0, frames), c);
    const metrics = analyzeAudio(buffer);
    const lastOff = Math.max(0, ...score.notes.filter(() => score.layers.melody).map(n => (n.start + n.duration) * 60 / score.bpm + 0.01), ...score.chords.filter(() => score.layers.harmony || score.layers.bass).map(c => (c.start + c.duration) * 60 / score.bpm + 0.01));
    const envelope = envelopeMetrics(buffer, lastOff), audio = encodePCM(buffer);
    const id = await sha256(Uint8Array.from(atob(audio.data), c => c.charCodeAt(0)));
    const raw = wavBytes(buffer); const matched = wavBytes(matchPreviewLevel(buffer));
    await saveArtifact({ id, raw, matched, savedAt: Date.now() }).catch(() => {});
    const configId = await sha256(new TextEncoder().encode(JSON.stringify({ ...score, title: '', revision: 0, sound: undefined, locks: undefined })));
    results.push({ probe, configId, engine: 'web-audio-v3-probes-1', truncated: frames < full.length || (probe === 'context' && project.bars > 4), durationSeconds: frames / full.sampleRate, audio, metrics: { rms: metrics.rms, peak: metrics.peak, clippingRatio: metrics.clippingRatio, spectralCentroidHz: metrics.spectralCentroidHz, highFrequencyEnergyRatio: metrics.highFrequencyEnergyRatio, ...envelope } });
  }
  return results;
}
export async function readReference(file: File): Promise<ReferenceAudio> {
  if (file.size > 10 * 1024 * 1024) throw new Error('参考音频请小于 10 MB。');
  const context = new AudioContext();
  try { const buffer = await context.decodeAudioData(await file.arrayBuffer()); return { name: file.name.slice(0, 120), audio: encodePCM(buffer, 12) }; }
  finally { await context.close(); }
}
