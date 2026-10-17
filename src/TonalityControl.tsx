import { useEffect, useState } from 'react';
import type { Project } from './domain';
import { modes, pitchClasses, tonalityName, type Tonality } from './tonality';

export default function TonalityControl({ project, disabled, onChange }: { project: Project; disabled: boolean; onChange: (key: Tonality, transpose: boolean) => void }) {
  const [key, setKey] = useState(project.tonality);
  const [transpose, setTranspose] = useState(true);
  useEffect(() => setKey(project.tonality), [project.tonality]);
  const changed = key.tonic !== project.tonality.tonic || key.mode !== project.tonality.mode;
  const locked = transpose && project.locks.harmony && project.chords.length > 0;
  return <div className="tonality-control">
    <strong>调性</strong>
    <label>主音<select aria-label="调性主音" value={key.tonic} disabled={disabled} onChange={e => setKey({ ...key, tonic: Number(e.target.value) })}>{pitchClasses.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
    <label>调式<select aria-label="调式" value={key.mode} disabled={disabled} onChange={e => setKey({ ...key, mode: e.target.value as Tonality['mode'] })}>{Object.entries(modes).map(([id, mode]) => <option key={id} value={id}>{mode.name}</option>)}</select></label>
    <label className="tonality-toggle"><input type="checkbox" aria-label="同步转换已有音符" checked={transpose} onChange={e => setTranspose(e.target.checked)}/>同步转换旋律与和弦</label>
    <button className="editor-button" disabled={disabled || !changed || locked} onClick={() => onChange(key, transpose)}>应用调性</button>
    <small>{locked ? '和弦已锁定，请先解锁再转换。' : transpose ? '按音阶级数转换，保留节奏；调外音保留相对下方音级的升高量。可撤销。' : '仅更新调性参考，已有音符保持原样。'} 当前：{tonalityName(project.tonality)}</small>
  </div>;
}
