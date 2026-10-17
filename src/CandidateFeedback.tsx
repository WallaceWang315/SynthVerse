import { useState } from 'react';
import type { RegisteredCandidate } from './agent-protocol';
import type { CreativeFeedback } from './creative-session';
export default function CandidateFeedback({ candidate, feedback, archive, onFeedback, onRemember }: {
  candidate: RegisteredCandidate; feedback?: CreativeFeedback; archive: RegisteredCandidate[];
  onFeedback: (choice: 'like' | 'dislike', note: string) => void; onRemember: (note: string) => void;
}) {
  const [note, setNote] = useState(feedback?.note ?? '');
  return <details className="candidate-feedback"><summary>比较依据与反馈{feedback ? ' · 已记录' : ''}</summary>
    <p>修改内容：{Object.keys(candidate.patch).map(key => ({ sound: '音色', notes: '旋律', chords: '和弦', layers: '声部', bars: '片段长度' }[key] ?? key)).join('、') || '无参数变化'}</p>
    {candidate.parentIds.length > 0 && <p>来自：{candidate.parentIds.map(id => archive.find(c => c.id === id)?.title ?? '此前参考版本').join('、')}</p>}
    {candidate.assessment && <p>{candidate.assessment.measured ? '结合片段实测与音符检查' : '仅根据音符与参数检查'}{candidate.assessment.findings.length ? '：' : '：未触发内置检查项，请试听判断。'}</p>}
    {candidate.assessment?.findings.map(f => <p key={f.code}>{f.basis === 'measured' ? '实测' : '提示'} · {f.detail}</p>)}
    {candidate.revisionEvidence?.length ? <p>这是依据检查结果生成的修正版，可与父版本比较。</p> : null}
    {candidate.citations?.length ? <p>参考指南：{candidate.citations.map(c => c.title).join('、')}（项目内置启发式）</p> : null}
    <label>具体喜欢或想调整的地方<input aria-label={`反馈 ${candidate.title}`} value={note} maxLength={200} placeholder="例如：喜欢开放排列，但尾音太长" onChange={e => setNote(e.target.value)}/></label>
    <div><button aria-pressed={feedback?.choice === 'like'} onClick={() => onFeedback('like', note)}>喜欢这个方向</button><button aria-pressed={feedback?.choice === 'dislike'} onClick={() => onFeedback('dislike', note)}>不太合适</button><button disabled={!note.trim()} onClick={() => onRemember(note)}>记住这条偏好</button></div>
    <small>反馈随下一条消息发送；只有点击“记住”才成为长期偏好，可在目标与参考中编辑或删除。</small>
  </details>;
}
