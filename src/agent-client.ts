import { renderProbes } from './listening-audio';
import { probeSchema } from './listening-protocol';
import { agentResultSchema, registeredCandidateSchema } from './agent-protocol';
import { analyzeAudio } from './audio-analysis';
import { renderProject } from './audio';
import type { Project } from './domain';
export class BrowserAgentError extends Error { constructor(message: string, readonly trace?: unknown) { super(message); } }
export function previewExcerpt(project: Project): Project {
  const beats = Math.min(16, project.bars * 4);
  return { ...project, bars: Math.min(4, project.bars), notes: project.notes.filter(n => n.start < beats).map(n => ({ ...n, duration: Math.min(n.duration, beats - n.start) })), chords: project.chords.filter(c => c.start < beats).map(c => ({ ...c, duration: Math.min(c.duration, beats - c.start) })) };
}
export async function runBrowserAgent(input: unknown, signal: AbortSignal, progress: (text: string) => void) {
  const response = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (!response.ok) throw new Error('无法开始创作任务。');
  const { runId, token } = await response.json(); const url = `/api/runs/${runId}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const cancel = () => { void fetch(url, { method: 'DELETE', headers }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const processed = new Set<string>(); let complete = false;
  try {
    for (;;) {
      signal.throwIfAborted(); const status = await fetch(url, { headers, signal }); if (!status.ok) throw new Error('任务连接中断。'); const run = await status.json();
      if (run.state === 'complete') { complete = true; return { ...agentResultSchema.parse(run.result), trace: run.result.trace }; }
      if (run.state !== 'running') throw new BrowserAgentError(run.error ?? '任务已取消。', run.trace);
      if (run.audioJob && !processed.has(run.audioJob.id)) {
        const job = run.audioJob; processed.add(job.id); const candidate = registeredCandidateSchema.parse(job.candidate);
        progress('正在渲染标准试听素材并检查声音…');
        let result: unknown;
        try { result = { jobId: job.id, packets: await renderProbes(candidate.project, job.probes.map((p: unknown) => probeSchema.parse(p)), signal) }; signal.throwIfAborted(); }
        catch { signal.throwIfAborted(); result = { jobId: job.id, error: '标准试听渲染失败。' }; }
        const submitted = await fetch(url + '/tool-results', { method: 'POST', headers, body: JSON.stringify(result), signal }); if (!submitted.ok) throw new Error('试听反馈已过期。');
      } else if (run.renderJob && !processed.has(run.renderJob.id)) {
        const job = run.renderJob; processed.add(job.id); const candidate = registeredCandidateSchema.parse(job.candidate); progress(`正在渲染「${candidate.title}」并分析音频…`);
        let result: unknown;
        try { const audio = await renderProject(previewExcerpt(candidate.project)); signal.throwIfAborted(); result = { jobId: job.id, metrics: analyzeAudio(audio) }; }
        catch (error) { signal.throwIfAborted(); result = { jobId: job.id, error: '浏览器无法渲染音频。' }; }
        const submitted = await fetch(`${url}/tool-results`, { method: 'POST', headers, body: JSON.stringify(result), signal }); if (!submitted.ok) throw new Error('音频反馈已过期。');
      } else {
        const stage = run.events.at(-1)?.name ?? '';
        const labels: Record<string, string> = { plan_creation: '已规划两个方向，正在生成候选…', search_music_knowledge: '已检索创作指南，正在结合当前工程…', compare_candidates: '已完成比较，正在决定是否修正…', revise_candidate: '已生成修正版，正在验证…', repair_final_reply: '正在修正最终回复格式…', finalize_request: '正在整理已有候选，结束工具探索…', recover_registered_candidates: '正在保留已完成的候选…' };
        progress(labels[stage] ?? ({ specialist_sound: '音色 Agent 正在设计声音…', specialist_composition: '作曲 Agent 正在发展片段…', collaboration_plan: '正在安排专业分工…', listen_baseline: '正在分析原始版本…', listen_candidate: '正在联合试听候选…', feedback_revision: '正在根据试听观察进行一次修正…' } as Record<string, string>)[stage] ?? (stage.startsWith('model_step') ? '模型正在规划下一步…' : '正在执行音乐工具…'));
      }
      await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 400); signal.addEventListener('abort', abort, { once: true }); });
    }
  } finally { signal.removeEventListener('abort', cancel); if (!complete) cancel(); }
}
