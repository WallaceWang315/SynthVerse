import { useState } from 'react';

export default function IdeaTitle({ title, disabled, onCommit }: { title: string; disabled: boolean; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState<string>();
  return <input className="project-title" aria-label="创意名称" placeholder="为这个想法起个名字" value={draft ?? title} maxLength={80} disabled={disabled}
    onFocus={() => setDraft(title)} onChange={event => setDraft(event.target.value)}
    onBlur={event => { const next = event.target.value.trim() || '未命名想法'; if (next !== title) onCommit(next); setDraft(undefined); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.value = title; event.currentTarget.blur(); }
    }}/>
}
