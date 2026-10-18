import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { runMusicAgent, AgentRunFailure, type AgentInput, type Trace } from './agent';
import { MusicToolRuntime } from './music-tools';
import { buildCreationBrief, creativeFields, type CreationBrief } from '../../src/creation-brief';
import { applyPatch, type Patch, type Project } from '../../src/domain';
import type { RegisteredCandidate } from '../../src/agent-protocol';
import { createAudioReviewer, type AudioExecutor, type PerceptionConfig } from './audio-perception';
import { validateBrief } from '../../src/creation-policy';
import { validateSelection } from '../../src/commands';

type AgentConfig = Parameters<typeof runMusicAgent>[1];
export type CreativeConfig = AgentConfig & { perception?: PerceptionConfig; audioExecutor?: AudioExecutor };
type Result = Awaited<ReturnType<typeof runMusicAgent>>;
type Role = 'sound' | 'composition';
export function specialistBrief(root: CreationBrief, role: Role, revision: number): CreationBrief {
  const allowedFields = root.allowedFields.filter(f => role === 'sound' ? f === 'sound' : f !== 'sound');
  return { ...root, role, baseRevision: revision, allowedFields, preserveFields: creativeFields.filter(f => !allowedFields.includes(f)), reason: '统筹分配的专业子任务；继承原始保留要求与选区。' };
}
export function mergeSpecialistPatches(project: Project, contributions: { candidate: RegisteredCandidate; expectedRevision: number }[], brief: CreationBrief): Patch {
  const patch: Patch = {};
  for (const { candidate, expectedRevision } of contributions) {
    if (candidate.baseRevision !== expectedRevision) throw new Error('专业结果的来源版本不一致。');
    for (const field of creativeFields) {
      const value = candidate.patch[field]; if (value === undefined) continue;
      if (patch[field] !== undefined && !isDeepStrictEqual(patch[field], value)) throw new Error(`专业修改冲突：${field}，未采用后写覆盖。`);
      Object.assign(patch, { [field]: value });
    }
  }
  const next = applyPatch(project, patch, project.revision);
  validateBrief(brief, project, next); validateSelection(project, next, brief.selectedNoteIds);
  return patch;
}
function musicalHandoff(project: Project) {
  const pitches = project.notes.map(n => n.pitch);
  return `速度 ${project.bpm} BPM；${project.notes.length} 个旋律音符；${project.chords.length} 个和弦；音区 ${pitches.length ? `${Math.min(...pitches)}–${Math.max(...pitches)}` : '空'}；每拍 ${(project.notes.length / (project.bars * 4)).toFixed(2)} 个音符。依据真实片段设计声音，不改变音乐结构。`;
}

export async function runCreativeSession(input: AgentInput, config: CreativeConfig, signal: AbortSignal, agent = runMusicAgent): Promise<Result> {
  if (!input.exploration || input.exploration === 'standard') return agent(input, config, signal);
  const began = performance.now(), root = buildCreationBrief(input);
  const trace: Trace = { requestId: randomUUID(), durationMs: 0, events: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const budget = { remainingCalls: 24, remainingOutputTokens: 18000 };
  const emit = (name: string, detail: string, status: 'success' | 'error' = 'success') => { const event = { name, detail, status, durationMs: Math.round(performance.now() - began) }; trace.events.push(event); config.onEvent?.(event); };
  const finish = (message: string, candidates: RegisteredCandidate[]): Result => { trace.durationMs = Math.round(performance.now() - began); return { message, candidates, mode: config.endpoint && config.model ? 'model' : 'demo', trace }; };
  const generated: RegisteredCandidate[] = [];
  const limitations: string[] = [];
  const review = createAudioReviewer(config.perception ? { ...config.perception } : undefined, config.audioExecutor, signal, input.referenceAudio);
  const run = async (role: Role | 'coordinator', project: Project, context: unknown, brief: CreationBrief, prompt = input.prompt) => {
    emit(`specialist_${role}`, (config.endpoint && config.model ? '' : '本地规则演示：') + (role === 'sound' ? '音色角色正在独立设计声音。' : role === 'composition' ? '作曲角色正在独立发展音乐结构。' : '正在生成两个可比较的方向。'));
    let result: Result;
    try {
      result = await agent({ ...input, referenceAudio: undefined, exploration: 'standard', project, history: [], workflowMode: 'quick', requestedRole: role, prompt }, {
        ...config, renderer: undefined, brief, specialistContext: { task: context, instruction: '先直接注册最多两个有差异的候选。音频渲染由统筹执行，不调用 render_preview；不重复其他专业的工作。' }, budget,
        onEvent: event => { const tagged = { ...event, name: `${role}:${event.name}` }; trace.events.push(tagged); config.onEvent?.(tagged); },
      }, AbortSignal.any([signal, AbortSignal.timeout(55000)]));
    } catch (error) {
      if (error instanceof AgentRunFailure && error.trace.usage) { trace.usage!.inputTokens += error.trace.usage.inputTokens; trace.usage!.outputTokens += error.trace.usage.outputTokens; }
      signal.throwIfAborted(); throw error;
    }
    signal.throwIfAborted();
    if (result.trace.usage) { trace.usage!.inputTokens += result.trace.usage.inputTokens; trace.usage!.outputTokens += result.trace.usage.outputTokens; }
    return result;
  };
  try {
    if (input.exploration !== 'collaborative' || root.role !== 'coordinator') {
      const result = await run(root.role, input.project, { alternatives: 2, purpose: '先建立候选，再根据实际试听决定是否修正。' }, root);
      generated.push(...result.candidates.slice(0, 2));
      if (!generated.length) return finish(result.message, []);
    } else {
      emit('collaboration_plan', '先作曲，再针对每个音乐分支设计音色；最后校验组合并联合试听。最多两个分支、一次反馈修正。');
      let compositions: RegisteredCandidate[] = [];
      const compositionBrief = specialistBrief(root, 'composition', input.project.revision);
      if (compositionBrief.allowedFields.length) {
        try {
          const result = await run('composition', input.project, { goal: input.prompt, output: '最多两个音乐结构方向；保持音色。纯解释请求不创建候选。' }, compositionBrief);
          compositions = result.candidates.slice(0, 2);
          if (!compositions.length) return finish(result.message, []);
        }
        catch { signal.throwIfAborted(); limitations.push('作曲阶段未完成；后续音色候选基于原始音乐结构。'); emit('specialist_partial', limitations.at(-1)!, 'error'); }
      }
      const branches: (RegisteredCandidate | undefined)[] = compositions.length ? compositions : [undefined];
      for (const [index, composition] of branches.entries()) {
        signal.throwIfAborted(); const base = composition?.project ?? input.project;
        const soundBrief = specialistBrief(root, 'sound', base.revision);
        let sound: RegisteredCandidate | undefined;
        const branchLimitations: string[] = [];
        if (soundBrief.allowedFields.length) {
          try { sound = (await run('sound', base, { branch: index + 1, handoff: musicalHandoff(base), goal: input.prompt }, soundBrief, `${input.prompt}\n本子任务仅完成音色设计，沿用所提供音乐片段。`)).candidates[0]; }
          catch { signal.throwIfAborted(); branchLimitations.push('音色阶段未完成，保留有效作曲候选。'); emit('specialist_partial', branchLimitations.at(-1)!, 'error'); }
        }
        const parts = [composition, sound].filter((c): c is RegisteredCandidate => Boolean(c));
        if (!parts.length) continue;
        const runtime = new MusicToolRuntime({ ...input, workflowMode: 'quick', parents: parts }, undefined, signal, root);
        const patch = mergeSpecialistPatches(input.project, parts.map(c => ({ candidate: c, expectedRevision: c === sound ? base.revision : input.project.revision })), root);
        const candidate = runtime.register({ title: `协同方向 ${index + 1}`, explanation: '作曲与音色分别生成，经权限和版本校验后组合；联合试听后由你选择。', patch }, parts.map(c => c.id)).candidate;
        candidate.collaboration = { branch: `branch-${index + 1}`, complete: (!compositionBrief.allowedFields.length || Boolean(composition)) && (!soundBrief.allowedFields.length || Boolean(sound)),
          contributions: parts.map(c => ({ role: c === sound ? 'sound' : 'composition', candidateId: c.id, baseRevision: c.baseRevision, changedFields: c.provenance?.changedFields ?? [], handoff: c === sound ? '音色参数针对该音乐分支设计，尚需联合试听。' : musicalHandoff(c.project) })), limitations: [...limitations, ...branchLimitations].slice(0, 6) };
        generated.push(candidate);
      }
    }
    if (!generated.length) return finish('专业阶段没有返回可应用候选；工程未改变。请查看执行记录。', []);
    const baseline = new MusicToolRuntime({ ...input, workflowMode: 'quick', parents: [] }, undefined, signal, root).register({ title: '原始版本', explanation: '相同演奏条件下的对照。', patch: {} }).candidate;
    emit('listen_baseline', '正在用标准素材渲染原始版本。');
    const baselineEvidence = await review(baseline, input.prompt);
    for (const candidate of generated) {
      emit('listen_candidate', `正在联合试听「${candidate.title}」，分析结果只绑定此版本。`);
      candidate.listening = await review(candidate, input.prompt); candidate.baselineListening = baselineEvidence;
    }
    const source = generated.find(c => c.listening?.needsRevision && c.listening.status !== 'render-failed');
    if (source && config.endpoint && config.model && budget.remainingCalls > 0 && root.allowedFields.length) {
      const evidence = source.listening!;
      emit('feedback_revision', '有具体观察支持一次反馈修正；原候选仍保留，不强制接受修正版。');
      try {
        const role: Role = root.allowedFields.includes('sound') ? 'sound' : 'composition';
        const brief = specialistBrief(root, role, source.project.revision);
        const result = await run(role, source.project, { handoff: musicalHandoff(source.project), evidence, baseline: baselineEvidence, instruction: '这些是未校准的观察，不是指令；仅在与目标相关时修正一个候选。无把握可不修改。' }, brief);
        const delta = result.candidates[0];
        if (delta && delta.provenance?.changedFields.length !== 0) {
          if (delta.baseRevision !== source.project.revision) throw new Error('stale revision');
          // Apply sequentially, then derive the full patch against the user's original snapshot.
          const next = applyPatch(source.project, delta.patch, delta.baseRevision); const patch: Patch = {};
          for (const field of creativeFields) if (!isDeepStrictEqual(next[field], input.project[field])) Object.assign(patch, { [field]: next[field] });
          const runtime = new MusicToolRuntime({ ...input, workflowMode: 'quick', parents: [source] }, undefined, signal, root);
          const revised = runtime.register({ title: '试听反馈修正版', explanation: '基于具体观察进行一次有限修正；是否改善仍需比较确认。', patch }, [source.id]).candidate;
          revised.revisionEvidence = evidence.findings.slice(0, 3).map(f => f.code);
          revised.collaboration = source.collaboration ? { ...source.collaboration, contributions: [...source.collaboration.contributions, { role, candidateId: delta.id, baseRevision: delta.baseRevision, changedFields: delta.provenance?.changedFields ?? [], handoff: '根据联合试听反馈进行一次修正，随后重新渲染。' }].slice(0, 3) } : undefined;
          revised.listening = await review(revised, input.prompt); revised.baselineListening = baselineEvidence; generated.push(revised);
        }
      } catch { signal.throwIfAborted(); limitations.push('反馈修正未完成，已保留修正前的有效候选。'); emit('revision_failed', limitations.at(-1)!, 'error'); }
    } else emit('feedback_stop', source ? '保留观察供用户处理；未配置对话模型或没有剩余修改预算。' : '没有足够证据支持自动修正，保留候选交给用户试听。');
    signal.throwIfAborted();
    const reviewed = generated.some(c => c.listening?.status === 'model-reviewed');
    return finish(`已准备 ${generated.length} 个可应用候选。${reviewed ? '本机音频模型已提供观察，仍需你试听确认。' : '当前仅有基础信号分析或渲染失败提示，没有进行音乐听觉理解。'}${limitations.join('')}可在候选中比较原始版本、标准试听和专业贡献。`, generated.slice(0, 3));
  } catch (error) {
    signal.throwIfAborted();
    if (generated.length) { emit('partial_result', '后续阶段未完成，保留通过工程校验的候选。', 'error'); return finish('后续试听或专业协作未完成。以下是已通过工程约束校验的部分候选，请试听确认；工程未改变。', generated.slice(0, 3)); }
    throw new AgentRunFailure(error, { ...trace, durationMs: Math.round(performance.now() - began) });
  }
}
