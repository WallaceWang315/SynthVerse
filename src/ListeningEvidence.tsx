import { useEffect, useState } from 'react';
import type { RegisteredCandidate } from './agent-protocol';
import { loadAudioArtifact } from './listening-audio';
import { probeLabels, type Probe } from './listening-protocol';
import { download } from './audio';

function StoredAudio({ id, matched, label }: { id?: string; matched: boolean; label: string }) {
  const [url, setUrl] = useState(''), [missing, setMissing] = useState(false);
  useEffect(() => { let active = true, objectURL = ''; setUrl(''); setMissing(false); if (!id) { setMissing(true); return; }
    void loadAudioArtifact(id, matched).then(bytes => { if (!active) return; if (!bytes) { setMissing(true); return; } objectURL = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); setUrl(objectURL); }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [id, matched]);
  return <div><small>{label}</small>{url ? <audio controls preload="none" src={url} aria-label={label}/> : <small>{missing ? '本机试听缓存不可用，可用候选的试听按钮重新播放当前片段。' : '读取试听…'}</small>}</div>;
}
export default function ListeningEvidence({ candidate, onFocus }: { candidate: RegisteredCandidate; onFocus: (role: 'sound' | 'composition') => void }) {
  const [open, setOpen] = useState(false), [probe, setProbe] = useState<Probe>('context'), [matched, setMatched] = useState(true);
  const evidence = candidate.listening;
  if (!evidence && !candidate.collaboration) return null;
  const clip = evidence?.clips.find(c => c.probe === probe), baseline = candidate.baselineListening?.clips.find(c => c.probe === probe);
  const comparable = clip && baseline && clip.configId === baseline.configId;
  return <details className="listening-evidence" onToggle={e => setOpen(e.currentTarget.open)}><summary>试听依据与专业贡献 · {evidence?.status === 'model-reviewed' ? '模型观察' : evidence?.status === 'render-failed' ? '未完成分析' : '信号分析'}</summary>
    {candidate.collaboration && <><p>{candidate.collaboration.complete ? '专业阶段已完成，效果仍需试听确认。' : '部分专业阶段未完成，当前为部分成果。'}</p>{candidate.collaboration.contributions.map((c, i) => <p key={i}><strong>{c.role === 'sound' ? '音色设计' : '旋律与和声'}</strong>：{c.handoff}<small>来源版本 {c.baseRevision} · {c.candidateId}</small></p>)}{candidate.collaboration.limitations.map((text, i) => <small key={i}>{text}</small>)}<div><button onClick={() => onFocus('sound')}>继续调整音色</button><button onClick={() => onFocus('composition')}>继续调整音乐结构</button></div></>}
    {evidence && <><p>{evidence.status === 'model-reviewed' ? `${evidence.provider} · ${evidence.basis === 'embedding-model' ? '特征比较' : '音频模型观察'}，不是已验证的审美结论。` : '没有完成音频模型理解；以下仅为测量或失败说明。'}</p>
      <label>试听素材<select aria-label={`试听素材 ${candidate.title}`} value={probe} onChange={e => setProbe(e.target.value as Probe)}>{Object.entries(probeLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label><input type="checkbox" checked={matched} onChange={e => setMatched(e.target.checked)}/>音量匹配试听（有增益上限，非严格等响）</label>
      {open && <><StoredAudio id={baseline?.artifactId} matched={matched} label="原始版本"/><StoredAudio id={clip?.artifactId} matched={matched} label="当前候选"/></>}
      {clip && baseline && <small>{comparable ? '使用相同演奏配置。' : '音乐结构或演奏配置不同，不能将全部差异归因于音色。'} 原始 RMS {baseline.metrics.rms.toFixed(4)} → 候选 RMS {clip.metrics.rms.toFixed(4)}；尾段 RMS {baseline.metrics.tailRms.toFixed(4)} → {clip.metrics.tailRms.toFixed(4)}。</small>}
      {evidence.findings.map(f => <p key={f.code}><strong>{f.code.startsWith('signal-') ? '测量' : '模型观察'} · {probeLabels[f.probe]}：</strong>{f.observation}<small>{f.goalRelation} {f.suggestion}</small></p>)}
      {!evidence.findings.length && <small>没有记录具体问题，不代表已经满足全部创作目标。</small>}{evidence.limitations.map((text, i) => <small key={i}>{text}</small>)}
      <button onClick={() => download(JSON.stringify({ candidateId: candidate.id, baseRevision: candidate.baseRevision, patch: candidate.patch, provenance: candidate.provenance, collaboration: candidate.collaboration, listening: evidence, baseline: candidate.baselineListening }, null, 2), 'application/json', `${candidate.title}.evidence.json`)}>导出修改与分析记录</button>
    </>}
  </details>;
}
