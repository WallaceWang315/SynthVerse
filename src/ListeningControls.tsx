import { useState } from 'react';
import { readReference } from './listening-audio';
import type { Exploration, ReferenceAudio } from './listening-protocol';
export default function ListeningControls({ mode, onMode, reference, onReference, disabled }: { mode: Exploration; onMode: (mode: Exploration) => void; reference?: ReferenceAudio; onReference: (value: ReferenceAudio | undefined) => void; disabled: boolean }) {
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  return <details className="listening-controls"><summary>探索方式 · {mode === 'standard' ? '快速编辑' : mode === 'listening' ? '试听反馈' : '专业协作'}</summary>
    <label>执行方式<select aria-label="探索执行方式" value={mode} disabled={disabled} onChange={e => onMode(e.target.value as Exploration)}><option value="standard">快速编辑</option><option value="listening">试听反馈（最多一次修正）</option><option value="collaborative">专业协作与联合试听</option></select></label>
    <small>{mode === 'standard' ? '沿用现有工具流程。' : mode === 'listening' ? '对照原始版本和候选，渲染四类素材；最长 3 分钟。' : '跨领域任务分别调用作曲、音色 Agent；最多两个分支、一次反馈修正，最长 4 分钟。'} 未配置音频模型时仅提供信号分析。</small>
    {mode !== 'standard' && <><label>可选参考音频<input aria-label="参考音频" type="file" accept="audio/*" disabled={disabled || loading} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setLoading(true); setError(''); void readReference(file).then(onReference).catch(err => setError(err.message)).finally(() => setLoading(false)); }}/></label>
      <small>提取前 12 秒，最大 10 MB；建议使用单音色片段。参考只用于本次会话，不写入工程。音频仅送至应用后端及配置的本机分析适配器。</small>
      {reference && <p>{reference.name}<button disabled={disabled} onClick={() => onReference(undefined)}>移除参考</button></p>}{loading && <p>正在读取参考…</p>}{error && <p role="alert">{error}</p>}</>}
  </details>;
}
