import { inScale } from './tonality';
import HoldToPlayButton from './HoldToPlayButton';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { newId, noteName, type Note, type Patch, type Project } from './domain';
import { moveNotes, resizeNotes, snapBeat } from './music-edit';

type Gesture = { type: 'move' | 'resize' | 'draw' | 'select'; x: number; y: number; selected: number[]; source: Project; start: number; pitch: number; pointer: number; noteId: string };
export default function PianoRoll({ project, disabled, selected, onSelection, onPatch, onAudition, onHoldAudition, auditionDisabled = false }: { project: Project; disabled: boolean; selected: number[]; onSelection: (selection: number[]) => void; onPatch: (patch: Patch) => void; onAudition: (pitch: number) => void; onHoldAudition: (pitch: number) => () => void; auditionDisabled?: boolean }) {
  const [grid, setGrid] = useState(0.25); const [zoom, setZoom] = useState(64); const [range, setRange] = useState({ low: 48, high: 84 }); const [tool, setTool] = useState<'draw' | 'select'>('draw'); const [draft, setDraft] = useState<Note[] | null>(null); const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLDivElement>(null); const gesture = useRef<Gesture | null>(null); const draftRef = useRef<Note[] | null>(null);
  const rowHeight = 20; const beats = project.bars * 4; const notes = draft ?? project.notes; const visiblePitches = Array.from({ length: range.high - range.low + 1 }, (_, i) => range.high - i);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = Math.max(0, (range.high - 72) * rowHeight); }, [range]);
  useEffect(() => { onSelection(selected.filter(i => i < project.notes.length)); }, [project.notes.length]);
  useEffect(() => { gesture.current = null; draftRef.current = null; setDraft(null); setBox(null); }, [project.revision]);
  const position = (event: PointerEvent) => { const rect = canvas.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(beats * zoom, event.clientX - rect.left - 54)), y: Math.max(0, Math.min(visiblePitches.length * rowHeight - 1, event.clientY - rect.top - 26)) }; };
  const showDraft = (next: Note[]) => { draftRef.current = next; setDraft(next); };
  function begin(event: PointerEvent, index?: number, resizing = false) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); canvas.current?.focus(); const pos = position(event);
    let selection = selected;
    if (index !== undefined) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) { selection = selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]; onSelection(selection); if (!selection.includes(index)) return; }
      else if (!selected.includes(index)) { selection = [index]; onSelection(selection); }
      onAudition(project.notes[index].pitch);
    } else if (tool === 'draw' && project.locks.rhythm) return;
    canvas.current!.setPointerCapture(event.pointerId);
    const start = Math.min(beats - grid, Math.max(0, snapBeat(pos.x / zoom, grid))); const pitch = range.high - Math.floor(pos.y / rowHeight);
    gesture.current = { type: index === undefined ? tool : resizing ? 'resize' : 'move', x: pos.x, y: pos.y, selected: selection, source: structuredClone(project), start, pitch, pointer: event.pointerId, noteId: newId('note') };
    if (index === undefined && tool === 'draw') { showDraft([...project.notes, { id: gesture.current.noteId, pitch, start, duration: grid, velocity: 0.7 }]); onAudition(pitch); }
    if (index === undefined && tool === 'select') { if (!event.shiftKey) onSelection([]); setBox({ x: pos.x, y: pos.y, width: 0, height: 0 }); }
  }
  function move(event: PointerEvent) {
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return; const pos = position(event); const delta = snapBeat((pos.x - g.x) / zoom, grid);
    if (g.type === 'move') showDraft(moveNotes(g.source, g.selected, delta, -Math.round((pos.y - g.y) / rowHeight)));
    else if (g.type === 'resize') showDraft(resizeNotes(g.source, g.selected, delta));
    else if (g.type === 'draw') showDraft([...g.source.notes, { id: g.noteId, pitch: g.pitch, start: g.start, duration: Math.max(grid, Math.min(beats - g.start, snapBeat(pos.x / zoom - g.start, grid) + grid)), velocity: 0.7 }]);
    else { const rect = { x: Math.min(g.x, pos.x), y: Math.min(g.y, pos.y), width: Math.abs(pos.x - g.x), height: Math.abs(pos.y - g.y) }; setBox(rect); onSelection(g.source.notes.flatMap((n, i) => n.start * zoom < rect.x + rect.width && (n.start + n.duration) * zoom > rect.x && (range.high - n.pitch) * rowHeight < rect.y + rect.height && (range.high - n.pitch + 1) * rowHeight > rect.y ? [i] : [])); }
  }
  function finish(event: PointerEvent, cancel = false) {
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return; const next = draftRef.current;
    gesture.current = null; draftRef.current = null; setDraft(null); setBox(null);
    if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    if (!cancel && next && JSON.stringify(next) !== JSON.stringify(project.notes)) { onPatch({ notes: next }); if (g.type === 'draw') onSelection([next.length - 1]); }
  }
  function remove() { if (!project.locks.rhythm && selected.length) { onPatch({ notes: project.notes.filter((_, i) => !selected.includes(i)) }); onSelection([]); } }
  function duplicate() {
    if (project.locks.rhythm || !selected.length) return;
    const chosen = selected.map(i => project.notes[i]).filter(Boolean); const offset = Math.max(...chosen.map(n => n.start + n.duration)) - Math.min(...chosen.map(n => n.start));
    const clones = chosen.map(n => ({ ...n, id: newId('note'), start: n.start + offset })); if (clones.some(n => n.start + n.duration > beats)) return;
    onPatch({ notes: [...project.notes, ...clones] }); onSelection(clones.map((_, i) => project.notes.length + i));
  }
  function setNote(key: 'start' | 'duration' | 'velocity' | 'pitch', value: number) { if (!Number.isFinite(value)) return; onPatch({ notes: project.notes.map((n, i) => selected.includes(i) ? { ...n, [key]: value } : n) }); }
  const first = project.notes[selected[0]];
  return <div className="roll-editor">
    <div className="roll-toolbar"><div className="segmented"><button aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}>画音符</button><button aria-pressed={tool === 'select'} onClick={() => setTool('select')}>框选</button></div><label>吸附<select aria-label="音符吸附" value={grid} onChange={e => setGrid(Number(e.target.value))}>{[[1, '四分音符'], [0.5, '八分音符'], [0.25, '十六分音符'], [0.125, '三十二分音符']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>长度<select aria-label="片段小节数" value={project.bars} disabled={disabled || project.locks.rhythm || project.locks.harmony} onChange={e => onPatch({ bars: Number(e.target.value) })}>{Array.from({ length: 16 }, (_, i) => <option value={i + 1} key={i}>{i + 1} 小节</option>)}</select></label><label>缩放<input aria-label="钢琴卷帘缩放" type="range" min={32} max={120} step={8} value={zoom} onChange={e => setZoom(Number(e.target.value))}/></label><button aria-label="显示更低的音域" disabled={range.low <= 21} onClick={() => setRange(r => ({ low: Math.max(21, r.low - 12), high: Math.max(57, r.high - 12) }))}>↓ 八度</button><button aria-label="显示更高的音域" disabled={range.high >= 108} onClick={() => setRange(r => ({ low: Math.min(72, r.low + 12), high: Math.min(108, r.high + 12) }))}>↑ 八度</button><button onClick={() => setRange({ low: Math.min(48, ...project.notes.map(n => n.pitch)), high: Math.max(84, ...project.notes.map(n => n.pitch)) })}>适应音域</button></div>
    <div className="roll-scroller" ref={scroll}><div ref={canvas} tabIndex={0} role="application" aria-label="钢琴卷帘编辑器" className="roll-canvas" style={{ width: 54 + beats * zoom, height: 26 + visiblePitches.length * rowHeight }} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)} onKeyDown={e => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); onSelection(project.notes.map((_, i) => i)); }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selected.length) { e.preventDefault(); onPatch({ notes: moveNotes(project, selected, e.key === 'ArrowLeft' ? -grid : e.key === 'ArrowRight' ? grid : 0, e.key === 'ArrowUp' ? e.shiftKey ? 12 : 1 : e.key === 'ArrowDown' ? e.shiftKey ? -12 : -1 : 0) }); }
    }}>
      <div className="roll-ruler" style={{ width: beats * zoom, left: 54 }}>{Array.from({ length: beats }, (_, i) => <span key={i} style={{ left: i * zoom, width: zoom }}>{i % 4 === 0 ? `${i / 4 + 1} 小节` : i % 4 + 1}</span>)}</div>
      {visiblePitches.map(pitch => <div className={`roll-pitch-label ${inScale(pitch, project.tonality) ? 'in-scale' : ''} ${pitch % 12 === project.tonality.tonic ? 'tonic' : ''} ${[1, 3, 6, 8, 10].includes(pitch % 12) ? 'sharp' : ''}`} style={{ top: 26 + (range.high - pitch) * rowHeight }} key={pitch}><HoldToPlayButton label={`试听音高 ${noteName(pitch)}`} disabled={disabled || auditionDisabled} startNote={() => onHoldAudition(pitch)} onTap={() => onAudition(pitch)}>{noteName(pitch)}</HoldToPlayButton></div>)}
      <div className="roll-grid" data-testid="roll-grid" style={{ left: 54, top: 26, width: beats * zoom, height: visiblePitches.length * rowHeight, backgroundSize: `${zoom * grid}px ${rowHeight}px, ${zoom * 4}px 100%` }} onPointerDown={e => begin(e)}>{visiblePitches.map(pitch => [1, 3, 6, 8, 10].includes(pitch % 12) ? <div className="roll-sharp-band" key={pitch} style={{ top: (range.high - pitch) * rowHeight, height: rowHeight }}/> : null)}</div>
      {notes.map((n, i) => n.pitch < range.low || n.pitch > range.high ? null : <div className={`roll-note ${selected.includes(i) ? 'selected' : ''}`} key={n.id} data-note-id={n.id} data-testid={`note-${i}`} style={{ left: 54 + n.start * zoom, top: 27 + (range.high - n.pitch) * rowHeight, width: Math.max(8, n.duration * zoom), height: rowHeight - 2, opacity: 0.5 + n.velocity * 0.5 }} role="button" tabIndex={0} aria-label={`音符 ${i + 1} ${noteName(n.pitch)} 起点 ${n.start} 时长 ${n.duration}`} onPointerDown={e => begin(e, i)} onFocus={() => { if (!selected.includes(i)) onSelection([i]); }} onContextMenu={e => { e.preventDefault(); if (!project.locks.rhythm && !disabled) { onPatch({ notes: project.notes.filter((_, index) => index !== i) }); onSelection([]); } }}><span>{noteName(n.pitch)}</span><span className="note-resize" role="button" aria-label={`调整音符 ${i + 1} 时长`} onPointerDown={e => begin(e, i, true)}/></div>)}
      {box && <div className="selection-box" style={{ left: 54 + box.x, top: 26 + box.y, width: box.width, height: box.height }}/>}
    </div></div>
    <div className="note-inspector"><span>{selected.length ? `已选 ${selected.length} 个音符` : '点击或框选音符'}</span>{first && <>{(['pitch', 'start', 'duration', 'velocity'] as const).map((key, i) => <label key={key}>{['MIDI 音高', '起点（拍）', '时长（拍）', '力度'][i]}<input aria-label={`所选音符${['音高', '起点', '时长', '力度'][i]}`} type="number" value={first[key]} step={key === 'pitch' ? 1 : key === 'velocity' ? 0.05 : 0.125} min={key === 'pitch' ? 21 : key === 'velocity' ? 0.1 : key === 'duration' ? 0.125 : 0} max={key === 'pitch' ? 108 : key === 'velocity' ? 1 : beats} disabled={disabled || (project.locks.rhythm && key !== 'pitch')} onChange={e => setNote(key, Number(e.target.value))}/></label>)}<button disabled={disabled || project.locks.rhythm} onClick={duplicate}>复制到后面</button><button disabled={disabled || project.locks.rhythm} onClick={remove}>删除所选</button><button onClick={() => onSelection([])}>取消选择</button></>}</div>
    <p className="editor-help">绿色琴键标签为调内音，强调色为主音；仍可自由使用调外音。拖动移动 · 右边缘调整时长 · Shift 多选 · 框选拖动 · 方向键微调 · Delete 删除。节奏锁定后仍可改音高。缩短片段前，请先移走越界音符与和弦。</p>
  </div>;
}
