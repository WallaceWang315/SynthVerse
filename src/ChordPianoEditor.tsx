import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { holdNote, playNote } from './audio';
import HoldToPlayButton from './HoldToPlayButton';
import { noteName, type Project } from './domain';
import { chordQualities, chordShape, makeChord, qualityNames } from './music-edit';

export default function ChordPianoEditor({ chord, project, locked, onApply, onClose, onListen }: {
  chord: Project['chords'][number]; project: Project; locked: boolean;
  onApply: (chord: Project['chords'][number]) => void; onClose: () => void; onListen: (chord: Project['chords'][number]) => void;
}) {
  const { root: initialRoot, quality: initialQuality, inversion: initialInversion } = chordShape(chord);
  const [pitches, setPitches] = useState([...new Set(chord.pitches)].sort((a, b) => a - b));
  const [name, setName] = useState(chord.name); const [root, setRoot] = useState(initialRoot);
  const [quality, setQuality] = useState(initialQuality); const [inversion, setInversion] = useState(initialInversion);
  const [selected, setSelected] = useState<number | null>(null); const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null); const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pitch: number; y: number; pointer: number } | null>(null);
  const latestClose = useRef(onClose); latestClose.current = onClose;
  const rowHeight = 24;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
    controls()[0]?.focus();
    if (scroller.current) {
      const center = (Math.max(...chord.pitches) + Math.min(...chord.pitches)) / 2;
      scroller.current.scrollTop = Math.max(0, (96 - center) * rowHeight - scroller.current.clientHeight / 2 + rowHeight / 2);
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); latestClose.current(); }
      if (event.key === 'Tab') {
        const items = controls(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  function update(next: number[], nextName = '自定义和弦') {
    if (locked) return;
    if (next.length < 3 || next.length > 6 || new Set(next).size !== next.length || next.some(p => p < 33 || p > 96)) { setError('请保留 3–6 个不同的构成音，音高范围为 A1–C7。'); return; }
    setPitches([...next].sort((a, b) => a - b)); setName(nextName); setError('');
  }
  function toggle(pitch: number) { update(pitches.includes(pitch) ? pitches.filter(p => p !== pitch) : [...pitches, pitch]); setSelected(pitch); }
  function preset(nextRoot: number, nextQuality: typeof quality, nextInversion: number) {
    const next = makeChord(nextRoot, nextQuality, nextInversion, chord.start, chord.duration);
    update(next.pitches, next.name); setRoot(nextRoot); setQuality(nextQuality); setInversion(nextInversion); setSelected(null);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const gesture = drag.current; if (!gesture || gesture.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || locked) return;
    const pitch = Math.max(33, Math.min(96, gesture.pitch - Math.round((event.clientY - gesture.y) / rowHeight)));
    if (pitch !== gesture.pitch && !pitches.includes(pitch)) { update(pitches.map(p => p === gesture.pitch ? pitch : p)); setSelected(pitch); void playNote(pitch, project.sound).catch(() => setError('无法试听，请重新点击琴键。')); }
  }
  return <div className="modal-backdrop chord-modal-backdrop" onClick={onClose}><div ref={dialog} className="modal chord-piano-modal" role="dialog" aria-modal="true" aria-label="和弦构成音编辑器" onClick={event => event.stopPropagation()}>
    <button className="modal-close icon-button" aria-label="关闭构成音编辑器" onClick={onClose}>×</button>
    <span className="eyebrow">CHORD / VOICING</span><h2>{name}</h2>
    <p>点击空白行添加构成音，拖动音符上下移动。选中后用方向键微调，Delete 删除。左侧琴键按住即可试听；选择下方形态会替换草稿构成音。</p>
    <div className="voicing-presets"><label>根音<select aria-label="构成音根音" value={root} disabled={locked} onChange={event => preset(Number(event.target.value), quality, inversion)}>{Array.from({ length: 52 }, (_, i) => <option key={i} value={i + 33}>{noteName(i + 33)}</option>)}</select></label>
      <label>和弦形态<select aria-label="构成音和弦性质" value={quality} disabled={locked} onChange={event => preset(root, event.target.value as typeof quality, 0)}>{Object.entries(qualityNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>转位<select aria-label="构成音转位" value={inversion} disabled={locked} onChange={event => preset(root, quality, Number(event.target.value))}>{chordQualities[quality].map((_, i) => <option key={i} value={i}>{i ? `第 ${i} 转位` : '原位'}</option>)}</select></label>
      <button className="editor-button" onClick={() => onListen({ ...chord, name, pitches })}>▶ 试听和弦</button>
    </div>
    <div className="voicing-summary" aria-live="polite">{pitches.map(noteName).join(' · ')}<span>{pitches.length} 个构成音 · {chord.duration} 拍</span></div>
    <div className="voicing-scroller" ref={scroller}><div className="voicing-piano" role="group" aria-label="和弦钢琴窗口">{Array.from({ length: 64 }, (_, i) => 96 - i).map(pitch => <div className={`voicing-row ${[1, 3, 6, 8, 10].includes(pitch % 12) ? 'sharp' : ''}`} key={pitch}>
      <div className="voicing-key"><HoldToPlayButton label={`试听和弦音高 ${noteName(pitch)}`} disabled={false} startNote={() => holdNote(pitch, project.sound, () => setError('无法试听，请重新点击琴键。'))} onTap={() => void playNote(pitch, project.sound).catch(() => setError('无法试听，请重新点击琴键。'))}>{noteName(pitch)}</HoldToPlayButton></div>
      <button className="voicing-lane" aria-label={`${pitches.includes(pitch) ? '移除' : '添加'}构成音 ${noteName(pitch)}`} disabled={locked} onClick={() => toggle(pitch)} tabIndex={-1}/>
      {pitches.includes(pitch) && <button className={`voicing-note ${selected === pitch ? 'selected' : ''}`} aria-label={`构成音 ${noteName(pitch)}`} aria-pressed={selected === pitch} disabled={locked} data-testid={`chord-note-${pitch}`} onFocus={() => setSelected(pitch)}
        onPointerDown={event => { if (event.button !== 0 || locked) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pitch, y: event.clientY, pointer: event.pointerId }; }}
        onPointerMove={event => { if (!drag.current) return; const delta = -Math.round((event.clientY - drag.current.y) / rowHeight); event.currentTarget.style.transform = `translateY(${-delta * rowHeight}px)`; }}
        onPointerUp={event => { event.currentTarget.style.transform = ''; finish(event); }} onPointerCancel={event => { event.currentTarget.style.transform = ''; finish(event, true); }} onLostPointerCapture={event => { event.currentTarget.style.transform = ''; finish(event, true); }}
        onKeyDown={event => {
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); update(pitches.filter(p => p !== pitch)); }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const next = pitch + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1); if (next >= 33 && next <= 96 && !pitches.includes(next)) { update(pitches.map(p => p === pitch ? next : p)); setSelected(next); requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`[data-testid="chord-note-${next}"]`)?.focus()); } }
        }} onDoubleClick={() => update(pitches.filter(p => p !== pitch))}>{noteName(pitch)}<small>拖动调整音高</small></button>}
    </div>)}</div></div>
    {error && <p className="voicing-error" role="status">{error}</p>}
    <div className="voicing-footer"><small>{locked ? '和弦已锁定，解锁后可修改。' : '修改仅在点击应用后保存，可撤销。'}</small><button className="editor-button" onClick={() => { setPitches([...new Set(chord.pitches)].sort((a, b) => a - b)); setName(chord.name); setRoot(initialRoot); setQuality(initialQuality); setInversion(initialInversion); setError(''); }} disabled={locked}>重置</button><button className="editor-button" onClick={onClose}>取消</button><button className="light-button" disabled={locked} onClick={() => onApply({ ...chord, name, pitches })}>应用构成音</button></div>
  </div></div>;
}
