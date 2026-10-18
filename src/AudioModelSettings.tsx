import { useEffect, useState } from 'react';
export default function AudioModelSettings() {
  const [endpoint, setEndpoint] = useState(''), [model, setModel] = useState(''), [key, setKey] = useState('');
  const [basis, setBasis] = useState('audio-model'), [hasKey, setHasKey] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [storage, setStorage] = useState('');
  const update = (data: { endpoint: string; model: string; basis: string; hasKey: boolean; storage: string }) => { setEndpoint(data.endpoint); setModel(data.model); setBasis(data.basis); setHasKey(data.hasKey); setStorage(data.storage); setKey(''); };
  useEffect(() => { const controller = new AbortController(); void fetch('/api/audio-settings', { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); update(await r.json()); setReady(true); }).catch(() => { if (!controller.signal.aborted) setMessage('无法读取本机音频模型设置，请重启服务。'); }); return () => controller.abort(); }, []);
  async function save(clear = false) {
    setBusy(true); try {
      const r = await fetch('/api/audio-settings', { method: clear ? 'DELETE' : 'PUT', headers: { 'Content-Type': 'application/json' }, ...(!clear ? { body: JSON.stringify({ endpoint, model, apiKey: key, basis }) } : {}) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error); update(data); setMessage(clear ? '已关闭音频模型，使用基础信号分析。' : '已保存；尚未验证模型听觉能力。下一次试听反馈任务会实际调用。');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <details className="audio-model-settings"><summary>音频理解模型（独立设置）</summary><p>需要实现 SynthVerse 音频适配器协议的本机服务。普通文本 Chat Completions 地址不能直接用于音频分析；此处不安装模型。</p>
    <fieldset disabled={!ready || busy}><label>本机分析地址<input aria-label="音频分析地址" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://127.0.0.1:9001/analyze" maxLength={2000}/></label>
    <label>音频模型名称<input aria-label="音频模型名称" value={model} onChange={e => setModel(e.target.value)} maxLength={200}/></label>
    <label>分析类型<select aria-label="音频分析类型" value={basis} onChange={e => setBasis(e.target.value)}><option value="audio-model">音频理解模型</option><option value="embedding-model">特征模型与参考比较</option></select></label>
    <label>独立 API Key<input aria-label="本机音频服务密钥" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={hasKey ? '已保存；地址不变时留空保留' : '本机免鉴权可留空'} autoComplete="new-password" maxLength={4096}/></label>
    <button className="editor-button" disabled={!endpoint || !model} onClick={() => void save()}>保存音频设置</button><button className="editor-button" onClick={() => void save(true)}>关闭并清除音频配置</button></fieldset>
    <p role="status">{message}</p><small>{storage}</small><small>仅允许 127.0.0.1 / [::1]，不支持外部云端音频上传。分析失败会保留候选并退回基础测量。</small></details>;
}
