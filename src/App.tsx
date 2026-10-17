import ModelSettings from './ModelSettings';
import TonalityControl from './TonalityControl';
import { tonalityName } from './tonality';
import PianoKeyboard from './PianoKeyboard';
import IdeaTitle from './IdeaTitle';
import AgentContext from './AgentContext';
import CandidateFeedback from './CandidateFeedback';
import type { CreativeFeedback } from './creative-session';
import { BrowserAgentError, runBrowserAgent } from './agent-client';
import type { RegisteredCandidate } from './agent-protocol';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, AudioLines, BookOpen, ChevronDown, CircleHelp, FolderOpen, Headphones, Layers3, LockKeyhole, Music2, Play, Plus, Redo2, Send, Settings2, SlidersHorizontal, Sparkles, Square, Undo2, UnlockKeyhole, WandSparkles, X } from 'lucide-react';
import { applyPatch, changeTonality, createBlankProject, editingError, initialProject, localReply, noteName, restoreSnapshot, theory, type Candidate, type Patch, type Project } from './domain';
import { download, holdNote, midiBytes, playNote, playProject, renderProject, stopPlayback, wavBytes } from './audio';
import SynthEditor from './SynthEditor';
import PianoRoll from './PianoRoll';
import HarmonyEditor from './HarmonyEditor';
import { importProject, loadWorkspace, saveWorkspace, type Saved } from './storage';

type Message = { id: string; role: 'user' | 'assistant'; text: string; candidates?: RegisteredCandidate[]; source?: string; trace?: { requestId: string; durationMs: number; events: { name: string; status: string; durationMs: number; detail?: string }[]; usage?: { inputTokens: number; outputTokens: number } } };
const prompts = {
  sound: ['做一个有玻璃感但不刺耳的音色', '再柔和一点，保留起音', '把尾音缩短一点'],
  motif: ['写一个有点忧郁的旋律动机', '为什么结尾没有落下来？', '保留节奏，换一种旋律走向'],
  harmony: ['配一组温暖的和弦', '配和弦并加一点低音', '给我两种结尾解决办法'],
};
export default function App() {
  const [project, setProject] = useState<Project>(structuredClone(initialProject));
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [shelf, setShelf] = useState<Saved['shelf']>([]);
  const [taskGoal, setTaskGoal] = useState('');
  const [feedback, setFeedback] = useState<CreativeFeedback[]>([]);
  const [workflowMode, setWorkflowMode] = useState<'quick' | 'compare'>('quick');
  const [autoReference, setAutoReference] = useState(true);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [archive, setArchive] = useState<RegisteredCandidate[]>([]);
  const [parents, setParents] = useState<RegisteredCandidate[]>([]);
  const [progress, setProgress] = useState('正在探索这个想法…');
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState('正在恢复');
  const [tab, setTab] = useState<'sound' | 'motif' | 'harmony'>('sound');
  const [selection, setSelection] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playLabel, setPlayLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'demo' | 'model' | 'offline'>('demo');
  const [modelName, setModelName] = useState('');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState(false);
  const [library, setLibrary] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', role: 'assistant', text: '今天想探索什么声音？从一小段想法开始。你可以描述音色，也可以直接弹下面的琴键，再一起发展动机与和声。', source: '引导' }]);
  const current = useRef(project); current.current = project;
  const request = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const inputFile = useRef<HTMLInputElement>(null);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const audioId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadWorkspace().then(data => { if (!cancelled && data) { setProject(data.project); setShelf(data.shelf); setTaskGoal(data.taskGoal); setPreferences(data.preferences); setArchive(data.archive); setFeedback(data.feedback); setWorkflowMode(data.workflowMode); setAutoReference(data.autoReference); } }).catch(() => { if (!cancelled) setNotice('未能恢复本地工程。请保留工程备份；当前使用初始创意。'); }).finally(() => { if (!cancelled) setHydrated(true); });
    const controller = new AbortController();
    fetch('/api/status', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (!cancelled) { setMode(data.mode === 'model' ? 'model' : 'demo'); setModelName(data.model ?? ''); } }).catch(() => { if (!cancelled) setMode('offline'); });
    return () => { cancelled = true; controller.abort(); request.current?.abort(); stopPlayback(); };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let live = true; setSaved('保存中');
    const timer = setTimeout(() => { saveWorkspace({ project, shelf, taskGoal, preferences, archive, feedback, workflowMode, autoReference }).then(() => { if (live) setSaved('已在本机保存'); }).catch(() => { if (live) { setSaved('保存失败'); setNotice('本地保存失败，请下载工程备份。'); } }); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [project, shelf, taskGoal, preferences, archive, feedback, workflowMode, autoReference, hydrated]);
  useEffect(() => { scrollEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    if (!settings && !library) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSettings(false); setLibrary(false); }
      if (event.key === 'Tab') {
        const nodes = controls(); const first = nodes[0]; const last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [settings, library]);


  function stop() { audioId.current++; stopPlayback(); setPlaying(false); setPlayLabel(''); }
  function commit(next: Project) { if (request.current) cancel(); stop(); const previous = structuredClone(current.current); current.current = next; setSelection(prev => prev.filter(id => next.notes.some(n => n.id === id))); setHistory(prev => [...prev.slice(-39), previous]); setFuture([]); setProject(next); }
  function patch(input: Patch) { try { commit(applyPatch(current.current, input, current.current.revision)); } catch (error) { setNotice(editingError(error)); } }
  async function listen(target: Project, label: string) {
    const id = ++audioId.current; setPlaying(true); setPlayLabel(label);
    try { await playProject(target, () => { if (id === audioId.current) { setPlaying(false); setPlayLabel(''); } }); }
    catch (error) { if (id === audioId.current) { setPlaying(false); setNotice((error as Error).message); } }
  }
  function undo() { if (request.current) cancel(); setSelection([]); const previous = history.at(-1); if (previous) { stop(); setFuture(prev => [...prev, structuredClone(current.current)]); setProject(restoreSnapshot(previous, current.current.revision)); setHistory(prev => prev.slice(0, -1)); setNotice('已撤销上一次修改'); } }
  function redo() { if (request.current) cancel(); setSelection([]); const next = future.at(-1); if (next) { stop(); setHistory(prev => [...prev, structuredClone(current.current)]); setProject(restoreSnapshot(next, current.current.revision)); setFuture(prev => prev.slice(0, -1)); setNotice('已重做上一次修改'); } }
  function toggleLock(key: keyof Project['locks']) { commit({ ...current.current, revision: current.current.revision + 1, locks: { ...current.current.locks, [key]: !current.current.locks[key] } }); }
  function blocked(candidate: Candidate) { try { applyPatch(project, candidate.patch, candidate.baseRevision); return ''; } catch (error) { return (error as Error).message; } }
  function recordFeedback(candidate: Candidate, choice: CreativeFeedback['choice'], note: string) { setFeedback(prev => choice === 'applied' && prev.some(f => f.candidateId === candidate.id && f.note.trim()) ? prev : [{ candidateId: candidate.id, title: candidate.title, choice, note: note.slice(0, 200), createdAt: new Date().toISOString() }, ...prev.filter(f => f.candidateId !== candidate.id)].slice(0, 12)); }
  function accept(candidate: Candidate) { try { commit(applyPatch(current.current, candidate.patch, candidate.baseRevision)); recordFeedback(candidate, 'applied', '已应用此版本；不表示永久偏好。'); setNotice(`已应用「${candidate.title}」，可撤销。`); } catch (error) { setNotice((error as Error).message); } }
  async function ask(text = prompt) {
    const trimmed = text.trim(); if (!trimmed || busy || !hydrated) return;
    setPrompt(''); setBusy(true); const id = ++requestId.current;
    const snapshot = structuredClone(current.current);
    const conversation = messages.slice(-10).map(m => ({ role: m.role, content: m.text }));
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }]);
    const controller = new AbortController(); request.current = controller;
    try {
      let trace: Message['trace']; let reply: { message: string; candidates: RegisteredCandidate[] }; let source = mode === 'model' ? `模型 · ${modelName}` : '本地规则演示';
      if (mode === 'offline') {
        const local = localReply(trimmed, snapshot, selection.map(id => snapshot.notes.findIndex(n => n.id === id)).filter(i => i >= 0));
        reply = { message: local.message, candidates: local.candidates.flatMap(c => { try { return [{ ...c, id: 'candidate-' + crypto.randomUUID(), baseRevision: snapshot.revision, project: applyPatch(snapshot, c.patch, snapshot.revision), parentIds: [] }]; } catch { return []; } }) };
        source = '离线规则演示 · 无音频反馈';
      } else {
        const data = await runBrowserAgent({ prompt: trimmed, project: snapshot, scope: tab, history: conversation, selection, taskGoal, preferences, parents: parents.length ? parents : autoReference ? archive.slice(0, 3) : [], feedback, workflowMode }, controller.signal, setProgress);
        reply = data; trace = data.trace; source = data.mode === 'model' ? `模型 · ${modelName}` : '本地规则演示';
      }
      if (id !== requestId.current || controller.signal.aborted || current.current.revision !== snapshot.revision) return;
      setArchive(prev => [...reply.candidates, ...prev].slice(0, 12));
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: reply.message, source, trace, candidates: reply.candidates }]);
    } catch (error) { if (!controller.signal.aborted && id === requestId.current) { setNotice((error as Error).message); if (error instanceof BrowserAgentError && error.trace) setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: error.message, source: mode === 'model' ? '模型请求失败' : '演示任务失败', trace: error.trace as Message['trace'] }]); } }
    finally { if (id === requestId.current) { setBusy(false); request.current = null; } }
  }
  function cancel() { request.current?.abort(); requestId.current++; setBusy(false); setNotice('已取消生成，当前创意未改变。'); }
  function collect() { setShelf(prev => [{ id: crypto.randomUUID(), savedAt: new Date().toISOString(), project: structuredClone(current.current) }, ...prev].slice(0, 12)); setNotice('已收藏当前版本'); }
  function newIdea() {
    const previous = structuredClone(current.current);
    setShelf(prev => [{ id: crypto.randomUUID(), savedAt: new Date().toISOString(), project: previous }, ...prev].slice(0, 12));
    commit(createBlankProject(previous.revision + 1));
    setSelection([]); setParents([]); setArchive([]); setFeedback([]); setTaskGoal(''); setPrompt(''); setTab('sound'); setExporting(false);
    setMessages([{ id: crypto.randomUUID(), role: 'assistant', text: '新的空白想法已准备好。先弹一个声音、画几颗音符，或告诉我你想探索的情绪。', source: '引导' }]);
    setNotice('已新建空白想法，上一想法已收藏；也可以撤销恢复。');
  }
  async function exportFile(kind: 'project' | 'sound' | 'midi' | 'wav') {
    setExporting(false);
    try {
      if (kind === 'project') download(JSON.stringify(project, null, 2), 'application/json', `${project.title}.synthverse.json`);
      if (kind === 'sound') download(JSON.stringify({ format: 'synthverse-sound', version: 2, engine: 'web-audio-v2', sound: project.sound }, null, 2), 'application/json', `${project.title}.sound.json`);
      if (kind === 'midi') download(new Uint8Array(midiBytes(project)).buffer as ArrayBuffer, 'audio/midi', `${project.title}.mid`);
      if (kind === 'wav') { setRendering(true); const buffer = await renderProject(project); download(wavBytes(buffer), 'audio/wav', `${project.title}.wav`); }
    } catch (error) { setNotice((error as Error).message); } finally { setRendering(false); }
  }
  const macro = (key: 'brightness' | 'attack' | 'release' | 'width' | 'glass', label: string, min: number, max: number, step: number, unit = '') => <label className="macro" key={key}><span>{label}<b>{key === 'attack' || key === 'release' ? project.sound[key].toFixed(2) : project.sound[key]}{unit}</b></span><input aria-label={label} type="range" min={min} max={max} step={step} value={project.sound[key]} disabled={project.locks.sound || !hydrated} onChange={e => patch({ sound: { [key]: Number(e.target.value) } })}/></label>;

  return <div className="app-shell">
    <aside className="rail"><a className="brand-mark" href="#" aria-label="SynthVerse 工作台"><Activity size={25}/></a><span className="rail-divider"/><button className="rail-button active" title="当前工作台" aria-label="当前工作台" onClick={() => { setLibrary(false); setSettings(false); }}><SlidersHorizontal size={20}/></button><button className="rail-button" title="创意收藏" aria-label="创意收藏" onClick={() => setLibrary(true)}><Layers3 size={20}/></button><button className="rail-button" title="模型设置" aria-label="模型设置" onClick={() => setSettings(true)}><Settings2 size={20}/></button><span className="rail-bottom">SV</span></aside>
    <div className="workspace">
      <header className="topbar"><div className="wordmark">synthverse<span>音乐灵感工作台</span></div><div className="top-actions"><span className="save-status"><i className={saved === '保存失败' ? 'error-dot' : ''}/>{saved}</span><button className="quiet-button" onClick={newIdea} disabled={!hydrated || rendering}><Plus size={15}/>新建空白想法</button><button className="quiet-button" onClick={() => inputFile.current?.click()} disabled={!hydrated}><FolderOpen size={15}/>导入</button><div className="export-wrap"><button className="light-button" onClick={() => setExporting(!exporting)} disabled={!hydrated || rendering}><ArrowDownToLine size={15}/>{rendering ? '渲染中…' : '导出'}<ChevronDown size={13}/></button>{exporting && <div className="export-menu">{[['project', '工程备份 · JSON'], ['sound', '内置音色 · JSON'], ['midi', '音乐片段 · MIDI'], ['wav', '试听音频 · WAV']].map(([key, label]) => <button key={key} onClick={() => void exportFile(key as 'project')}>{label}</button>)}</div>}</div></div></header>
      <div className="workspace-body"><main className="creation">
        <div className="project-heading"><div><div className="eyebrow">IDEA 001 <span> / </span> {tonalityName(project.tonality)} · 4/4</div><IdeaTitle title={project.title} disabled={!hydrated} onCommit={title => commit({ ...current.current, title, revision: current.current.revision + 1 })}/><p>一个声音，一段动机。让想法慢慢生长。</p></div><button className="collect-button" onClick={collect} disabled={!hydrated}><Plus size={17}/>收藏版本</button></div>
        <TonalityControl project={project} disabled={!hydrated} onChange={(key, transpose) => { try { const next = changeTonality(current.current, key, transpose); if (next !== current.current) commit(next); } catch (error) { setNotice(editingError(error)); } }}/>
        <div className="section-tabs" role="tablist" aria-label="探索对象">{[['sound', '音色探索', AudioLines], ['motif', '旋律动机', Music2], ['harmony', '和声色彩', Layers3]].map(([id, label, Icon]) => { const Glyph = Icon as typeof AudioLines; return <button key={id as string} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id as typeof tab)}><Glyph size={16}/>{label as string}</button>; })}<span className="tab-detail">{project.bars} 小节的可能性</span></div>
        {tab === 'sound' && <section className="sound-panel"><div className="panel-top"><div><span className="eyebrow">SOUND / 01</span><h2>微光合成器 <span>POLY</span></h2></div><button className={`lock-button ${project.locks.sound ? 'locked' : ''}`} aria-pressed={project.locks.sound} onClick={() => toggleLock('sound')} disabled={!hydrated}>{project.locks.sound ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}音色{project.locks.sound ? '已锁定' : '可修改'}</button></div><div className="macro-grid">{macro('brightness', '明亮度', 0, 100, 1)}{macro('glass', '玻璃质感', 0, 100, 1)}{macro('width', '立体宽度', 0, 30, 1)}{macro('attack', '起音', 0.005, 2, 0.005, ' s')}{macro('release', '尾音', 0.05, 3, 0.05, ' s')}</div><SynthEditor sound={project.sound} disabled={project.locks.sound || !hydrated} onPatch={patch}/><PianoKeyboard sound={project.sound} disabled={!hydrated || settings || library} onError={error => setNotice(error.message)}/></section>}
        {tab !== 'sound' && <section className="focus-panel"><div className="eyebrow">{tab === 'motif' ? 'MOTIF / EXPLORATION' : 'HARMONY / EXPLORATION'}</div><h2>{tab === 'motif' ? '让一句旋律，成为起点。' : '同一句旋律，不同的情绪。'}</h2><p>{tab === 'motif' ? '画出音符，拖动调整音高与起点，再从右边缘拉长。选中一部分音符后，伙伴只修改选区。' : '先自己选择根音、和弦性质与时长，试听和弦与低音怎样托住旋律，再比较伙伴的建议。'}</p><div className="focus-prompts">{prompts[tab].map(p => <button disabled={busy || !hydrated} key={p} onClick={() => void ask(p)}><Sparkles size={14}/>{p}<ArrowRight size={14}/></button>)}</div></section>}
        <section className="motif-panel"><div className="panel-top"><div><span className="eyebrow">MOTIF / {project.bars} BARS</span><h2>旋律草稿 <span>{project.notes.length} NOTES</span></h2></div><div className="motif-actions"><button className={`lock-button ${project.locks.rhythm ? 'locked' : ''}`} aria-pressed={project.locks.rhythm} onClick={() => toggleLock('rhythm')} disabled={!hydrated}>{project.locks.rhythm ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}节奏{project.locks.rhythm ? '已锁定' : '可修改'}</button><button className="icon-button" aria-label="撤销上一次修改" disabled={!history.length} onClick={undo}><Undo2 size={16}/></button><button className="icon-button" aria-label="重做上一次修改" disabled={!future.length} onClick={redo}><Redo2 size={16}/></button></div></div><PianoRoll project={project} disabled={!hydrated} selected={selection.map(id => project.notes.findIndex(n => n.id === id)).filter(i => i >= 0)} onSelection={indices => setSelection(indices.map(i => current.current.notes[i]?.id).filter(Boolean))} onPatch={patch} onAudition={pitch => void playNote(pitch, project.sound).catch(e => setNotice(e.message))} onHoldAudition={pitch => holdNote(pitch, current.current.sound, error => setNotice(error.message))} auditionDisabled={settings || library}/></section>
        <HarmonyEditor project={project} disabled={!hydrated} onPatch={patch} onListen={(p, label) => void listen(p, label)} onLock={() => toggleLock('harmony')} onStop={stop}/>
        <div className="theory-note"><BookOpen size={17}/><p>{theory(project)}</p><button aria-label="询问结尾乐理" disabled={busy || !hydrated} onClick={() => void ask('为什么结尾没有落下来？给我听两种解决办法')}><ArrowRight size={16}/></button></div>
      </main>
      <aside className="conversation"><div className="conversation-head"><div className="assistant-symbol"><Sparkles size={18}/></div><div><h2>灵感伙伴</h2><span>{mode === 'model' ? modelName : '本地规则演示 · 未连接模型'}</span></div><button className="icon-button" aria-label="查看模型接入设置" onClick={() => setSettings(true)}><Settings2 size={16}/></button></div><div className="context-strip"><span><i/>当前上下文</span><b>{selection.length ? `选中 ${selection.length} 音符 · ` : ''}{tab === 'sound' ? '音色' : tab === 'motif' ? '动机' : '和声'} · {project.bpm} BPM · {tonalityName(project.tonality)}</b></div><AgentContext goal={taskGoal} preferences={preferences} archive={archive} parents={parents} onGoal={setTaskGoal} onPreferences={setPreferences} onParents={setParents} feedback={feedback} onFeedback={setFeedback} workflowMode={workflowMode} onWorkflowMode={setWorkflowMode} autoReference={autoReference} onAutoReference={setAutoReference}/><div className="messages">{messages.map(message => <div key={message.id} className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? '你' : <><Sparkles size={12}/>灵感伙伴 <small>{message.source}</small></>}</div><p>{message.text}</p>{message.trace && <details className="agent-trace"><summary>查看执行记录 · {message.trace.durationMs} ms</summary><small>请求 {message.trace.requestId}</small>{message.trace.events.map((event, i) => <div key={i}><b>{event.name}</b><span>{event.status} · {event.durationMs} ms</span>{event.detail && <p>{event.detail}</p>}</div>)}{message.trace.usage && <small>输入 {message.trace.usage.inputTokens} / 输出 {message.trace.usage.outputTokens} tokens</small>}</details>}{message.candidates?.map(candidate => { const reason = blocked(candidate); return <article className="candidate" key={candidate.id}><div className="candidate-head"><WandSparkles size={14}/><h3>{candidate.title}</h3><span>候选</span></div><p>{candidate.explanation}</p>{candidate.metrics && <small className="audio-metrics">实测前 {Math.min(4, candidate.project.bars)} 小节 · RMS {candidate.metrics.rms.toFixed(3)} · 频谱重心 {candidate.metrics.spectralCentroidHz?.toFixed(0) ?? "静音"} Hz</small>}<div className="candidate-actions"><button onClick={() => { try { void listen(candidate.project, candidate.title); } catch (e) { setNotice((e as Error).message); } }}><Play size={12}/>试听</button><button disabled={Boolean(reason)} title={reason} onClick={() => accept(candidate)}>应用<ArrowRight size={12}/></button><button aria-label={`继续 ${candidate.title}`} onClick={() => { setParents([candidate]); setPrompt(`继续「${candidate.title}」，`); }}>继续</button></div><CandidateFeedback candidate={candidate} feedback={feedback.find(f => f.candidateId === candidate.id)} archive={archive} onFeedback={(choice, note) => recordFeedback(candidate, choice, note)} onRemember={note => { setPreferences(prev => [...new Set([...prev, note.trim().slice(0, 100)])].slice(-10)); setNotice('已记住偏好，可在本次目标与参考中修改。'); }}/>{reason && <small className="candidate-reason">{reason}</small>}</article>; })}</div>)}{busy && <div className="thinking"><span/><span/><span/>{progress}</div>}<div ref={scrollEnd}/></div><div className="composer"><div className="suggested"><button onClick={() => setPrompt(prompts[tab][0])}><Plus size={12}/>{tab === 'sound' ? '玻璃质感' : tab === 'motif' ? '忧郁动机' : '温暖和弦'}</button><button onClick={() => setPrompt(prompts[tab][1])}><Plus size={12}/>{tab === 'sound' ? '更柔和' : tab === 'motif' ? '解释结尾' : '加入低音'}</button></div><form onSubmit={e => { e.preventDefault(); void ask(); }}><textarea aria-label="与灵感伙伴对话" placeholder="描述一个声音，或继续这个想法…" value={prompt} maxLength={2000} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(); } }}/><div className="composer-bottom"><span>{busy ? '生成中，当前创意保持不变' : 'Enter 发送 · Shift + Enter 换行'}</span>{busy ? <button type="button" className="send-button" aria-label="取消生成" onClick={cancel}><Square size={14}/></button> : <button className="send-button" aria-label="发送想法" disabled={!prompt.trim() || !hydrated}><Send size={16}/></button>}</div></form><p className="composer-note">建议先试听，再决定。每个应用都可以撤销。</p></div></aside></div>
      <footer className="transport"><div className="play-group"><button className={`play-button ${playing ? 'is-playing' : ''}`} aria-label={playing ? '停止试听' : '试听当前片段'} onClick={() => playing ? stop() : void listen(project, '当前片段')} disabled={!hydrated}>{playing ? <Square size={17} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><div><strong>{playing ? playLabel : '试听当前创意'}</strong><span>{playing ? '播放结束后自动停止' : `${project.bars} BARS · 轻松探索`}</span></div></div><div className="tempo"><input type="number" aria-label="速度 BPM" min={60} max={180} value={project.bpm} disabled={!hydrated} onChange={e => { const bpm = Number(e.target.value); if (Number.isInteger(bpm) && bpm >= 60 && bpm <= 180) commit({ ...project, bpm, revision: project.revision + 1 }); }}/><span>BPM</span></div><div className="layer-controls">{[['melody', '旋律'], ['harmony', '和弦'], ['bass', '低音']].map(([key, label]) => <button key={key} aria-pressed={project.layers[key as keyof Project['layers']]} className={project.layers[key as keyof Project['layers']] ? 'on' : ''} disabled={!hydrated} onClick={() => patch({ layers: { [key]: !project.layers[key as keyof Project['layers']] } })}><i/>{label}</button>)}</div><div className="transport-end"><Headphones size={16}/><span>浏览器合成引擎</span></div></footer>
    </div>
    <input ref={inputFile} type="file" accept=".json,application/json" className="hidden-input" aria-label="导入工程文件" onChange={async e => { const file = e.target.files?.[0]; if (file) { try { const loaded = await importProject(file); setSelection([]); commit(restoreSnapshot(loaded, current.current.revision)); setNotice('工程已恢复，可撤销。'); } catch (error) { setNotice((error as Error).message); } } e.target.value = ''; }}/>
    {notice && <div className="toast" role="status"><CircleHelp size={16}/>{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
    {(settings || library) && <div className="modal-backdrop" onClick={() => { setSettings(false); setLibrary(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label={settings ? '模型接入设置' : '创意收藏'} onClick={e => e.stopPropagation()}><button className="modal-close icon-button" aria-label="关闭窗口" onClick={() => { setSettings(false); setLibrary(false); }}><X size={18}/></button>{settings ? <ModelSettings onUpdated={model => { if (request.current) cancel(); setMode(model ? 'model' : 'demo'); setModelName(model); }}/> : <><span className="eyebrow">IDEA COLLECTION</span><h2>值得留下的声音</h2><p>这里保留最近 12 个创意版本，恢复后仍可撤销。</p>{!shelf.length && <div className="empty-shelf"><Layers3 size={30}/><p>听到喜欢的想法，就收藏一个版本。</p></div>}{shelf.map(item => <div className="shelf-item" key={item.id}><div><strong>{item.project.title}</strong><small>{item.project.bpm} BPM · {item.project.notes.length} 音符 · {new Date(item.savedAt).toLocaleDateString('zh-CN')}</small></div><button onClick={() => void listen(item.project, item.project.title)} aria-label={`试听收藏 ${item.project.title}`}><Play size={15}/></button><button onClick={() => { setSelection([]); commit(restoreSnapshot(item.project, current.current.revision)); setLibrary(false); setNotice('已恢复收藏版本'); }}>恢复</button><button aria-label={`删除收藏 ${item.project.title}`} onClick={() => setShelf(prev => prev.filter(s => s.id !== item.id))}><X size={14}/></button></div>)}</>}</section></div>}
  </div>;
}
