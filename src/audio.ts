import { Midi } from '@tonejs/midi';
import { noteName, type Project, type Sound } from './domain';
import { harmonicTable } from './synth';

let context: AudioContext | undefined;
let bus: GainNode | undefined;
let playback: AudioBufferSourceNode | undefined;
let generation = 0;
export async function unlockAudio() {
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') throw new Error('音频尚未启动，请点击按钮或检查浏览器音频权限。');
  if (!bus) { bus = context.createGain(); bus.gain.value = 0.72; bus.connect(context.destination); }
  return context;
}
function seededNoise(length: number, seed = 7) {
  const data = new Float32Array(length); let state = seed;
  for (let i = 0; i < length; i++) { state = (Math.imul(state, 1664525) + 1013904223) | 0; data[i] = state / 2147483648; }
  return data;
}
function adsr(param: AudioParam, start: number, duration: number, attack: number, decay: number, sustain: number, release: number, peak: number) {
  const attackValue = peak * Math.min(1, duration / attack); const releaseValue = duration <= attack ? attackValue : peak * (1 - (1 - sustain) * Math.min(1, (duration - attack) / decay));
  param.setValueAtTime(0, start); param.linearRampToValueAtTime(attackValue, start + Math.min(attack, duration));
  if (duration > attack) param.linearRampToValueAtTime(releaseValue, start + Math.min(attack + decay, duration));
  param.setValueAtTime(releaseValue, start + duration); param.linearRampToValueAtTime(0, start + duration + release);
}
export function voice(ctx: BaseAudioContext, output: AudioNode, pitch: number, start: number, duration: number | null, sound: Sound, velocity = 0.7, gain = 0.12, bpm = 104) {
  const nodes: AudioNode[] = []; const sources: (OscillatorNode | AudioBufferSourceNode | ConstantSourceNode)[] = [];
  const own = <T extends AudioNode>(node: T) => { nodes.push(node); return node; };
  const envelopes: { param: AudioParam; attack: number; decay: number; sustain: number; release: number; peak: number }[] = [];
  const envelopeShape = (param: AudioParam, attack: number, decay: number, sustain: number, release: number, peak: number) => {
    if (duration !== null) { adsr(param, start, duration, attack, decay, sustain, release, peak); return; }
    param.setValueAtTime(0, start); param.linearRampToValueAtTime(peak, start + attack); param.linearRampToValueAtTime(peak * sustain, start + attack + decay);
    envelopes.push({ param, attack, decay, sustain, release, peak });
  };
  const mix = own(ctx.createGain()); const envelope = own(ctx.createGain()); const amplitude = own(ctx.createGain()); const pan = own(ctx.createStereoPanner());
  let route: AudioNode = mix; const filterParams: AudioParam[] = [];
  const brightness = own(ctx.createBiquadFilter()); brightness.frequency.value = 300 * Math.pow(45, sound.brightness / 100); brightness.Q.value = 0.6; route.connect(brightness); route = brightness;
  sound.filters.filter(f => f.enabled).forEach(f => {
    const filter = own(ctx.createBiquadFilter()); filter.type = f.type; filter.frequency.value = Math.min(ctx.sampleRate * 0.45, f.cutoff); filter.Q.value = f.resonance; route.connect(filter); route = filter; filterParams.push(filter.detune);
    if (f.envelope) { const env = own(ctx.createConstantSource()); env.offset.value = 0; const e = sound.env2; envelopeShape(env.offset, e.attack, e.decay, e.sustain, e.release, f.envelope * 1200); env.connect(filter.detune); sources.push(env); }
  });
  route.connect(envelope); envelope.connect(amplitude); amplitude.connect(pan); pan.connect(output);
  envelopeShape(envelope.gain, sound.attack, sound.decay, sound.sustain, sound.release, gain * velocity);
  const end = duration === null ? null : start + duration + Math.max(sound.release, sound.env2.release) + 0.03;
  const hz = 440 * Math.pow(2, (pitch - 69) / 12); const pitchParams: AudioParam[] = [];
  const active = sound.oscillators.filter(o => o.enabled); const totalLevel = Math.max(1, active.reduce((sum, o) => sum + o.level, 0) + sound.sub + sound.noise);
  sound.oscillators.forEach((setting, index) => {
    if (!setting.enabled) return;
    const count = Math.max(setting.unison, sound.width > 0 ? 2 : 1);
    for (let u = 0; u < count; u++) {
      const spread = count === 1 ? 0 : u / (count - 1) * 2 - 1;
      const osc = own(ctx.createOscillator()); const wave = index === 0 ? sound.wave : setting.wave;
      osc.frequency.value = hz * Math.pow(2, setting.transpose / 12); osc.detune.value = setting.fine + spread * (setting.detune + sound.width);
      if (wave === 'wavetable') { const table = harmonicTable(setting.table, setting.position, osc.frequency.value, ctx.sampleRate); osc.setPeriodicWave(ctx.createPeriodicWave(table.real, table.imag)); } else osc.type = wave;
      const level = own(ctx.createGain()); level.gain.value = setting.level / count / totalLevel;
      const stereo = own(ctx.createStereoPanner()); stereo.pan.value = Math.max(-1, Math.min(1, setting.pan + spread * sound.width / 35));
      osc.connect(level); level.connect(stereo); stereo.connect(mix); sources.push(osc); pitchParams.push(osc.detune);
    }
  });
  const tone = (frequency: number, levelValue: number) => { if (!levelValue) return; const osc = own(ctx.createOscillator()); osc.frequency.value = frequency; const level = own(ctx.createGain()); level.gain.value = levelValue / totalLevel; osc.connect(level); level.connect(mix); sources.push(osc); pitchParams.push(osc.detune); };
  const primary = sound.oscillators[0];
  tone(hz * Math.pow(2, primary.transpose / 12 + primary.fine / 1200) * 3, primary.enabled ? sound.glass / 100 * 0.3 * primary.level : 0); tone(hz / 2, sound.sub);
  if (sound.noise) { const source = own(ctx.createBufferSource()); source.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); source.buffer.copyToChannel(seededNoise(ctx.sampleRate), 0); source.loop = true; const level = own(ctx.createGain()); level.gain.value = sound.noise * 0.35 / totalLevel; source.connect(level); level.connect(mix); sources.push(source); }
  sound.modulations.forEach(mod => {
    let source: OscillatorNode | ConstantSourceNode;
    if (mod.source === 'lfo1' || mod.source === 'lfo2') { const lfo = sound.lfos[mod.source === 'lfo1' ? 0 : 1]; const osc = own(ctx.createOscillator()); osc.type = lfo.wave; osc.frequency.value = lfo.sync ? lfo.rate * bpm / 60 : lfo.rate; source = osc; }
    else { const constant = own(ctx.createConstantSource()); constant.offset.value = mod.source === 'velocity' ? velocity : 0; if (mod.source === 'env2') { const e = sound.env2; envelopeShape(constant.offset, e.attack, e.decay, e.sustain, e.release, 1); } source = constant; }
    const depth = own(ctx.createGain()); depth.gain.value = mod.amount * ({ pitch: 1200, cutoff: 2400, amplitude: 0.45, pan: 0.8 }[mod.target]); source.connect(depth);
    const targets = mod.target === 'pitch' ? pitchParams : mod.target === 'cutoff' ? [brightness.detune, ...filterParams] : mod.target === 'amplitude' ? [amplitude.gain] : [pan.pan]; targets.forEach(param => depth.connect(param)); sources.push(source);
  });
  sources.forEach(source => { source.start(start); if (end !== null) source.stop(end); });
  const sentinel = sources.at(-1); if (sentinel) sentinel.onended = () => nodes.forEach(node => node.disconnect()); else nodes.forEach(node => node.disconnect());
  let released = false;
  return (at = ctx.currentTime) => {
    if (duration !== null || released) return; released = true;
    const time = Math.max(start, at), elapsed = time - start;
    for (const e of envelopes) {
      const level = elapsed < e.attack ? e.peak * elapsed / e.attack : e.peak * (1 - (1 - e.sustain) * Math.min(1, (elapsed - e.attack) / e.decay));
      e.param.cancelScheduledValues(time); e.param.linearRampToValueAtTime(level, time); e.param.linearRampToValueAtTime(0, time + e.release);
    }
    sources.forEach(source => source.stop(time + Math.max(sound.release, sound.env2.release) + 0.03));
  };
}

export function createEffectChain(ctx: BaseAudioContext, output: AudioNode, sound: Sound) {
  const nodes: AudioNode[] = []; const sources: OscillatorNode[] = []; const own = <T extends AudioNode>(n: T) => { nodes.push(n); return n; };
  const input = own(ctx.createGain()); let route: AudioNode = input; const fx = sound.effects;
  if (fx.distortion) { const shaper = own(ctx.createWaveShaper()); const curve = new Float32Array(2048); const drive = 1 + fx.distortion * 16; for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1) * 2 - 1) * drive) / Math.tanh(drive); shaper.curve = curve; shaper.oversample = '2x'; route.connect(shaper); route = shaper; }
  const wetStage = (mix: number, effect: AudioNode, returnNode: AudioNode = effect) => { const sum = own(ctx.createGain()); const wet = own(ctx.createGain()); const dry = own(ctx.createGain()); dry.gain.value = 1 - mix * 0.5; wet.gain.value = mix; route.connect(dry); dry.connect(sum); route.connect(effect); returnNode.connect(wet); wet.connect(sum); route = sum; };
  if (fx.chorus) { const delay = own(ctx.createDelay(0.1)); delay.delayTime.value = 0.018; const osc = own(ctx.createOscillator()); osc.frequency.value = 0.7; const depth = own(ctx.createGain()); depth.gain.value = 0.005; osc.connect(depth); depth.connect(delay.delayTime); osc.start(); sources.push(osc); wetStage(fx.chorus, delay); }
  if (fx.flanger) { const delay = own(ctx.createDelay(0.05)); delay.delayTime.value = 0.003; const feedback = own(ctx.createGain()); feedback.gain.value = 0.55; delay.connect(feedback); feedback.connect(delay); const osc = own(ctx.createOscillator()); osc.frequency.value = 0.25; const depth = own(ctx.createGain()); depth.gain.value = 0.002; osc.connect(depth); depth.connect(delay.delayTime); osc.start(); sources.push(osc); wetStage(fx.flanger, delay); }
  if (fx.phaser) { const filters = [400, 800, 1600, 3200].map(hz => { const filter = own(ctx.createBiquadFilter()); filter.type = 'allpass'; filter.frequency.value = hz; filter.Q.value = 0.7; return filter; }); filters.slice(0, -1).forEach((filter, i) => filter.connect(filters[i + 1])); const osc = own(ctx.createOscillator()); osc.frequency.value = 0.3; const depth = own(ctx.createGain()); depth.gain.value = 900; osc.connect(depth); filters.forEach(f => depth.connect(f.detune)); osc.start(); sources.push(osc); wetStage(fx.phaser, filters[0], filters.at(-1)!); }
  if (fx.delay) { const delay = own(ctx.createDelay(1)); delay.delayTime.value = fx.delayTime; const feedback = own(ctx.createGain()); feedback.gain.value = fx.feedback; const lowpass = own(ctx.createBiquadFilter()); lowpass.frequency.value = 4000; delay.connect(lowpass); lowpass.connect(feedback); feedback.connect(delay); wetStage(fx.delay, delay); }
  if (fx.reverb) { const convolver = own(ctx.createConvolver()); const length = Math.ceil(fx.reverbTime * ctx.sampleRate); const impulse = ctx.createBuffer(2, length, ctx.sampleRate); for (let c = 0; c < 2; c++) { const data = seededNoise(length, 17 + c); for (let i = 0; i < length; i++) data[i] *= Math.pow(1 - i / length, 2.5); impulse.copyToChannel(data, c); } convolver.buffer = impulse; wetStage(fx.reverb, convolver); }
  (['eqLow', 'eqMid', 'eqHigh'] as const).forEach((key, i) => { if (!fx[key]) return; const filter = own(ctx.createBiquadFilter()); filter.type = (['lowshelf', 'peaking', 'highshelf'] as const)[i]; filter.frequency.value = [200, 1000, 4000][i]; filter.Q.value = 0.8; filter.gain.value = fx[key]; route.connect(filter); route = filter; });
  const limiter = own(ctx.createDynamicsCompressor()); limiter.threshold.value = fx.threshold; limiter.ratio.value = fx.ratio;
  const safety = own(ctx.createWaveShaper()); const safetyCurve = new Float32Array(4096);
  for (let i = 0; i < safetyCurve.length; i++) { const x = i / (safetyCurve.length - 1) * 2 - 1; const abs = Math.abs(x); safetyCurve[i] = Math.sign(x) * (abs <= 0.9 ? abs : 0.9 + 0.1 * Math.tanh((abs - 0.9) / 0.1)); }
  safety.curve = safetyCurve; route.connect(limiter); limiter.connect(safety); safety.connect(output);
  return { input, dispose: () => { sources.forEach(s => s.stop()); nodes.forEach(n => n.disconnect()); } };
}
export async function playNote(pitch: number, sound: Sound) { const ctx = await unlockAudio(); const fx = createEffectChain(ctx, bus!, sound); voice(ctx, fx.input, pitch, ctx.currentTime + 0.01, 0.5, sound); setTimeout(fx.dispose, (0.6 + Math.max(sound.release, sound.env2.release) + effectTail(sound)) * 1000); }
export function holdNote(pitch: number, sound: Sound, onError: (error: Error) => void): () => void {
  let released = false; let releaseVoice: (() => void) | undefined;
  void unlockAudio().then(ctx => {
    if (released) return;
    const fx = createEffectChain(ctx, bus!, sound);
    const release = voice(ctx, fx.input, pitch, ctx.currentTime, null, sound);
    releaseVoice = () => { release(); setTimeout(fx.dispose, (Math.max(sound.release, sound.env2.release) + effectTail(sound) + 0.1) * 1000); };
  }).catch(error => { if (!released) onError(error instanceof Error ? error : new Error('无法启动音频。')); });
  return () => { if (released) return; released = true; releaseVoice?.(); };
}
function effectTail(sound: Sound) { return Math.max(sound.effects.reverb ? sound.effects.reverbTime : 0, sound.effects.delay ? sound.effects.delayTime * (sound.effects.feedback ? Math.ceil(Math.log(0.001) / Math.log(sound.effects.feedback)) : 1) : 0); }
export async function renderProject(project: Project) {
  const beat = 60 / project.bpm;
  const length = project.bars * 4 * beat + Math.max(project.sound.release, project.sound.env2.release, 0.8) + effectTail(project.sound) + 0.2;
  const ctx = new OfflineAudioContext(2, Math.ceil(length * 44100), 44100);
  const mix = ctx.createGain(); mix.gain.value = 0.72;
  const effects = createEffectChain(ctx, ctx.destination, project.sound); mix.connect(effects.input);
  if (project.layers.melody) project.notes.forEach(n => voice(ctx, mix, n.pitch, n.start * beat + 0.01, n.duration * beat, project.sound, n.velocity, 0.12, project.bpm));
  const accompaniment = { ...project.sound, wave: 'sine' as const, glass: 0, noise: 0, sub: 0, oscillators: project.sound.oscillators.map((o, i) => ({ ...o, enabled: i === 0, transpose: 0, unison: 1, level: 0.8 })), modulations: [] };
  project.chords.forEach(chord => {
    if (project.layers.harmony) chord.pitches.forEach(p => voice(ctx, mix, p, chord.start * beat + 0.01, chord.duration * beat, { ...accompaniment, attack: 0.08, release: 0.8, width: 4 }, 0.55, 0.035, project.bpm));
    if (project.layers.bass) voice(ctx, mix, Math.min(...chord.pitches) - 12, chord.start * beat + 0.01, chord.duration * beat * 0.9, { ...accompaniment, attack: 0.015, release: 0.25, width: 0 }, 0.75, 0.12, project.bpm);
  });
  return ctx.startRendering();
}
export function stopPlayback() { generation++; if (playback) { playback.onended = null; playback.stop(); playback.disconnect(); playback = undefined; } }
export function matchPreviewLevel<T extends Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>>(buffer: T): T {
  let squares = 0; let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const value of buffer.getChannelData(c)) { squares += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(squares / (buffer.length * buffer.numberOfChannels));
  if (rms < 0.00001 || peak === 0) return buffer;
  const gain = Math.min(0.9 / peak, Math.max(0.5, Math.min(2, 0.045 / rms)));
  for (let c = 0; c < buffer.numberOfChannels; c++) { const channel = buffer.getChannelData(c); for (let i = 0; i < channel.length; i++) channel[i] *= gain; }
  return buffer;
}
export async function playProject(project: Project, onEnd: () => void, beforeStart?: () => void) {
  stopPlayback(); const token = generation;
  const ctx = await unlockAudio(); const buffer = matchPreviewLevel(await renderProject(project));
  if (token !== generation) return;
  const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(bus!); playback = source;
  source.onended = () => { source.disconnect(); if (playback === source) playback = undefined; onEnd(); };
  beforeStart?.(); source.start();
}
export function wavBytes(buffer: AudioBuffer): ArrayBuffer {
  const length = buffer.length; const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + length * channels * 2); const view = new DataView(bytes);
  const text = (at: number, str: string) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) { const x = Math.max(-1, Math.min(1, data[c][i])); view.setInt16(44 + (i * channels + c) * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true); }
  return bytes;
}
export function midiBytes(project: Project): Uint8Array {
  const midi = new Midi(); midi.header.setTempo(project.bpm); const beat = 60 / project.bpm;
  if (project.layers.melody) { const track = midi.addTrack(); track.name = 'Motif'; project.notes.forEach(n => track.addNote({ midi: n.pitch, time: n.start * beat, duration: n.duration * beat, velocity: n.velocity })); }
  if (project.layers.harmony) { const track = midi.addTrack(); track.name = 'Harmony'; project.chords.forEach(chord => chord.pitches.forEach(p => track.addNote({ midi: p, time: chord.start * beat, duration: chord.duration * beat, velocity: 0.55 }))); }
  if (project.layers.bass) { const track = midi.addTrack(); track.name = 'Bass'; project.chords.forEach(chord => track.addNote({ midi: Math.min(...chord.pitches) - 12, time: chord.start * beat, duration: chord.duration * beat * 0.9, velocity: 0.75 })); }
  return midi.toArray();
}
export function download(data: BlobPart, type: string, name: string) { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export { noteName };
