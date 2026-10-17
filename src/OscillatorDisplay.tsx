import { harmonicTable, type SynthSound } from './synth';

export const waveOptions = [['sine', '正弦'], ['triangle', '三角'], ['sawtooth', '锯齿'], ['square', '方波'], ['wavetable', '波表']] as const;
function points(wave: SynthSound['wave'], table: SynthSound['oscillators'][number]['table'], position: number) {
  const harmonics = wave === 'wavetable' ? harmonicTable(table, position) : undefined;
  const values = Array.from({ length: 241 }, (_, i) => {
    const phase = i / 240 * Math.PI * 4;
    if (harmonics) return harmonics.imag.reduce((sum, amplitude, n) => sum + amplitude * Math.sin(n * phase), 0);
    return wave === 'sine' ? Math.sin(phase) : wave === 'triangle' ? Math.asin(Math.sin(phase)) * 2 / Math.PI : wave === 'square' ? (Math.sin(phase) >= 0 ? 1 : -1) : (phase / Math.PI % 2) - 1;
  });
  const peak = Math.max(1, ...values.map(Math.abs));
  return values.map((value, i) => `${i},${48 - value / peak * 34}`).join(' ');
}
export default function OscillatorDisplay({ oscillator, index, disabled, onWave }: { oscillator: SynthSound['oscillators'][number]; index: number; disabled: boolean; onWave: (wave: SynthSound['wave']) => void }) {
  return <div className={`oscillator-display ${oscillator.enabled ? '' : 'source-off'}`}>
    <div className="oscillator-screen"><span>{waveOptions.find(([id]) => id === oscillator.wave)?.[1]}<small>{oscillator.wave === 'wavetable' ? { basic: '基础谐波', vowel: '元音峰', metal: '金属谐波' }[oscillator.table] : '单周期声源'}</small></span>
      <svg viewBox="0 0 240 96" role="img" aria-label={`振荡器 ${index + 1} 当前波形：${oscillator.wave}，声源示意`} preserveAspectRatio="none">
        {[24, 48, 72].map(y => <line key={y} x1="0" x2="240" y1={y} y2={y} stroke="currentColor" opacity=".1"/>)}
        {[60, 120, 180].map(x => <line key={x} x1={x} x2={x} y1="0" y2="96" stroke="currentColor" opacity=".1"/>)}
        <polyline data-testid={`oscillator-wave-${index + 1}`} points={points(oscillator.wave, oscillator.table, oscillator.position)} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
      </svg>
    </div>
    <div className="wave-picker" role="group" aria-label={`振荡器 ${index + 1} 波形`}>{waveOptions.map(([wave, label]) => <button key={wave} aria-label={`振荡器 ${index + 1} ${label}`} aria-pressed={oscillator.wave === wave} disabled={disabled} onClick={() => onWave(wave)}><svg viewBox="0 0 240 96" aria-hidden="true"><polyline points={points(wave, oscillator.table, oscillator.position)} fill="none" stroke="currentColor" strokeWidth="7"/></svg><span>{label}</span></button>)}</div>
  </div>;
}
