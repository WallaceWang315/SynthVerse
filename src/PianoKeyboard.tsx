import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { holdNote } from './audio';
import { noteName, type Sound } from './domain';
const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
export default function PianoKeyboard({ sound, disabled, onError }: { sound: Sound; disabled: boolean; onError: (error: Error) => void }) {
  const latest = useRef({ sound, disabled, onError }); latest.current = { sound, disabled, onError };
  const held = useRef(new Map<string, { pitch: number; release: () => void }>());
  const [pressed, setPressed] = useState<number[]>([]);
  const sync = () => setPressed([...held.current.values()].map(v => v.pitch));
  function down(token: string, pitch: number) { if (latest.current.disabled || held.current.has(token)) return; held.current.set(token, { pitch, release: holdNote(pitch, latest.current.sound, error => { up(token); latest.current.onError(error); }) }); sync(); }
  function up(token: string) { const note = held.current.get(token); if (!note) return; held.current.delete(token); note.release(); sync(); }
  function releaseAll() { held.current.forEach(n => n.release()); held.current.clear(); sync(); }
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement; const index = codes.indexOf(event.code);
      if (index < 0 || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]')) return;
      event.preventDefault(); down(`key:${event.code}`, pitches[index]);
    };
    const keyup = (event: globalThis.KeyboardEvent) => { up(`key:${event.code}`); up(`button:${event.code}`); };
    const visibility = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', releaseAll); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', releaseAll); document.removeEventListener('visibilitychange', visibility); held.current.forEach(n => n.release()); held.current.clear(); };
  }, []);
  useEffect(() => { if (disabled) releaseAll(); }, [disabled]);
  function pointerDown(event: PointerEvent<HTMLButtonElement>, pitch: number) { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); down(`pointer:${event.pointerId}`, pitch); }
  function buttonDown(event: KeyboardEvent<HTMLButtonElement>, pitch: number) { if (!['Space', 'Enter'].includes(event.code)) return; event.preventDefault(); if (!event.repeat) down(`button:${event.code}`, pitch); }
  const key = (pitch: number, black: boolean, shortcut?: string) => <button className={`${black ? 'black-key' : 'white-key'}${pressed.includes(pitch) ? ' held-key' : ''}`} aria-label={`弹奏 ${noteName(pitch)}`} aria-pressed={pressed.includes(pitch)} disabled={disabled} onPointerDown={event => pointerDown(event, pitch)} onPointerUp={event => up(`pointer:${event.pointerId}`)} onPointerCancel={event => up(`pointer:${event.pointerId}`)} onLostPointerCapture={event => up(`pointer:${event.pointerId}`)} onKeyDown={event => buttonDown(event, pitch)} onKeyUp={event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); up(`button:${event.code}`); } }} onBlur={() => { up('button:Space'); up('button:Enter'); }} onClick={event => { event.preventDefault(); if (event.detail === 0 && !held.current.size) { down(`accessible:${pitch}`, pitch); setTimeout(() => up(`accessible:${pitch}`), 250); } }}>{!black && <><span>{noteName(pitch)}</span><small>{shortcut}</small></>}</button>;
  return <div className="keyboard-row"><span>试着弹一下<small>按住持续发声 · A — K 键也可以演奏</small></span><div className="piano">{pitches.map((pitch, i) => <div className="piano-key-wrap" key={pitch}>{key(pitch, false, 'ASDFGHJK'[i])}{[0, 1, 3, 4, 5].includes(i) && key(pitch + 1, true)}</div>)}</div></div>;
}
