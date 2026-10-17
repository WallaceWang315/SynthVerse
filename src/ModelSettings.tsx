import { useEffect, useState } from 'react';

type Settings = { endpoint: string; model: string; hasKey: boolean; storage: string; warning?: string };
export default function ModelSettings({ onUpdated }: { onUpdated: (model: string) => void }) {
  const [config, setConfig] = useState<Settings>({ endpoint: '', model: '', hasKey: false, storage: '' });
  const [endpoint, setEndpoint] = useState(''), [model, setModel] = useState(''), [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useState('正在读取设置…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/model-settings', { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then((data: Settings) => {
      setConfig(data); setEndpoint(data.endpoint); setModel(data.model); setReady(true); setMessage(data.warning || '');
    }).catch(() => { if (!controller.signal.aborted) setMessage('无法读取模型设置，请确认本地服务已运行；更新代码后请重启服务。'); });
    return () => controller.abort();
  }, []);
  async function act(action: 'save' | 'test' | 'clear') {
    setBusy(true); setMessage(action === 'test' ? '正在测试连接与工具调用，最多20秒…' : '正在保存…');
    try {
      const response = await fetch(`/api/model-settings${action === 'test' ? '/test' : ''}`, { method: action === 'clear' ? 'DELETE' : action === 'test' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, ...(action === 'clear' ? {} : { body: JSON.stringify({ endpoint, model, apiKey, clearKey }) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作未完成。');
      if (action === 'test') setMessage(data.message);
      else { setConfig(data); setEndpoint(data.endpoint); setModel(data.model); setApiKey(''); setClearKey(false); onUpdated(data.model); setMessage(action === 'clear' ? '已清除连接与密钥，切回本地演示。' : '配置已保存，新对话立即生效。'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作未完成。'); }
    finally { setBusy(false); }
  }
  return <div className="model-settings"><span className="eyebrow">MODEL CONNECTION</span><h2>让真实模型加入创作</h2>
    <p>接入支持 Chat Completions 与工具调用的模型。Key 只发送至你填写的服务，不会写入音乐工程。</p>
    <fieldset disabled={!ready || busy}>
      <label>快速填写<select aria-label="模型服务示例" defaultValue="" onChange={e => { const preset = ({ deepseek: ['https://api.deepseek.com/v1', 'deepseek-chat'], ollama: ['http://127.0.0.1:11434/v1', ''], custom: ['', ''] } as Record<string, string[]>)[e.target.value]; if (preset) { setEndpoint(preset[0]); setModel(preset[1]); setApiKey(''); setClearKey(true); } }}><option value="" disabled>选择服务示例（可自行修改）</option><option value="deepseek">DeepSeek</option><option value="ollama">Ollama 本机服务</option><option value="custom">自定义兼容服务</option></select></label>
      <label>API 地址<input aria-label="模型 API 地址" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://your-provider.example/v1" autoComplete="off" maxLength={2000}/></label>
      <small>可填写基础地址或完整的 /chat/completions 地址。本机 HTTP、云端 HTTPS。</small>
      <label>模型名称<input aria-label="模型名称" value={model} onChange={e => setModel(e.target.value)} placeholder="填写服务商提供的模型 ID" autoComplete="off" maxLength={200}/></label>
      <label>API Key<input aria-label="模型 API Key" type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); setClearKey(false); }} placeholder={config.hasKey ? '已保存；留空保留（地址不变时）' : '本机免鉴权服务可留空'} autoComplete="new-password" maxLength={4096}/></label>
      {config.hasKey && <label className="model-key-clear"><input type="checkbox" checked={clearKey} onChange={e => setClearKey(e.target.checked)}/>清除已保存的 Key</label>}
      <div className="model-settings-actions"><button className="editor-button" disabled={!endpoint.trim() || !model.trim()} onClick={() => void act('test')}>测试连接</button><button className="light-button" disabled={!endpoint.trim() || !model.trim()} onClick={() => void act('save')}>保存并使用</button><button className="editor-button" onClick={() => void act('clear')}>清除配置</button></div>
    </fieldset>
    <p role="status" aria-live="polite">{message}</p><small>{config.storage}</small><small>连接测试会发送一次小型模型请求，用于检查工具调用，可能产生少量费用。它不保存配置，也不发送当前音乐。</small>
  </div>;
}
