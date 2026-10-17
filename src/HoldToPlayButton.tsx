import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function HoldToPlayButton({ label, disabled, startNote, onTap, children }: { label: string; disabled: boolean; startNote: () => () => void; onTap: () => void; children: ReactNode }) {
  const releases = useRef(new Map<string, () => void>());
  const latest = useRef(startNote); latest.current = startNote;
  const [pressed, setPressed] = useState(false);
  function down(id: string) { if (disabled || releases.current.has(id)) return; releases.current.set(id, latest.current()); setPressed(true); }
  function up(id: string) { if (!releases.current.has(id)) return; releases.current.get(id)?.(); releases.current.delete(id); setPressed(releases.current.size > 0); }
  function releaseAll() { releases.current.forEach(release => release()); releases.current.clear(); setPressed(false); }
  useEffect(() => {
    const keyup = (event: KeyboardEvent) => up(`key:${event.code}`);
    const hidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('keyup', keyup); window.addEventListener('blur', releaseAll); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keyup', keyup); window.removeEventListener('blur', releaseAll); document.removeEventListener('visibilitychange', hidden); releases.current.forEach(release => release()); releases.current.clear(); };
  }, []);
  useEffect(() => { if (disabled) releaseAll(); }, [disabled]);
  return <button aria-label={label} aria-pressed={pressed} disabled={disabled} className={pressed ? 'held-key' : undefined}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); down(`pointer:${event.pointerId}`); }}
    onPointerUp={event => { event.stopPropagation(); up(`pointer:${event.pointerId}`); }}
    onPointerCancel={event => up(`pointer:${event.pointerId}`)} onLostPointerCapture={event => up(`pointer:${event.pointerId}`)}
    onKeyDown={event => { if (!['Space', 'Enter'].includes(event.code)) return; event.preventDefault(); event.stopPropagation(); if (!event.repeat) down(`key:${event.code}`); }}
    onKeyUp={event => { if (!['Space', 'Enter'].includes(event.code)) return; event.preventDefault(); event.stopPropagation(); up(`key:${event.code}`); }}
    onBlur={() => { up('key:Space'); up('key:Enter'); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (event.detail === 0 && !releases.current.size) onTap(); }}>{children}</button>;
}
