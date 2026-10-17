import { MusicToolRuntime, musicToolDefinitions, type Renderer } from './music-tools';
import { validateSelection } from '../../src/commands';
import type { RegisteredCandidate } from '../../src/agent-protocol';
import { agentLimits, type CreativeFeedback } from '../../src/creative-session';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyPatch, localReply, patchSchema, replySchema, theory, type Patch, type Project } from '../../src/domain';

export type AgentInput = { prompt: string; project: Project; scope: string; history: { role: string; content: string }[]; selection: (string | number)[]; taskGoal?: string; preferences?: string[]; parents?: RegisteredCandidate[]; workflowMode?: 'quick' | 'compare'; feedback?: CreativeFeedback[] };
export type Trace = { requestId: string; durationMs: number; events: { name: string; status: 'success' | 'error'; durationMs: number; detail?: string }[]; usage?: { inputTokens: number; outputTokens: number } };
export class ProviderError extends Error { constructor(public status: number) { super(`模型服务返回 ${status}，请检查服务配置。`); } }
export class AgentOutputError extends Error {}
export class AgentRunFailure extends Error { constructor(public cause: unknown, public trace: Trace) { super('Agent 请求未完成。'); } }
export const agentTools = musicToolDefinitions;
export function validateScopedPatch(project: Project, patch: Patch, selection: (string | number)[]) {
  const next = applyPatch(project, patch, project.revision);
  validateSelection(project, next, selection.map(id => typeof id === 'number' ? project.notes[id]?.id : id)); return next;
}
export function analyzeMusic(project: Project) {
  const pitches = project.notes.map(n => n.pitch); const overlapping = project.notes.some((n, i) => project.notes.some((m, j) => j > i && n.start < m.start + m.duration && m.start < n.start + n.duration));
  const covered = project.notes.filter(n => project.chords.some(c => n.start >= c.start && n.start < c.start + c.duration));
  const chordTones = covered.filter(n => project.chords.find(c => n.start >= c.start && n.start < c.start + c.duration)?.pitches.some(p => p % 12 === n.pitch % 12));
  return { basis: 'symbolic-notes-and-parameters', noteCount: pitches.length, pitchRange: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : null, notesPerBeat: pitches.length / (project.bars * 4), overlapping, chordCount: project.chords.length, chordToneRatio: covered.length ? chordTones.length / covered.length : null, theory: theory(project) };
}
export function executeMusicTool(name: string, args: unknown, input: AgentInput) { return new MusicToolRuntime(input).execute(name, args); }
const system = '你是 SynthVerse 创作伙伴，帮助发现灵感和理解乐理。工程的 tonality 指定当前主音（0=C，1=C♯，依此类推）与调式；旋律、和弦及乐理建议遵循它，不默认C大调。可以按用户要求使用调外音并解释。读取工程、目标、偏好、稳定 ID 与参考，再调用音乐工具。按用户范围修改，遵守锁定与选区；候选不自动应用。用 propose_edit 注册操作，然后 render_preview 获取真实浏览器指标，可 compare_candidates 比较；没有音频指标时必须说明未渲染。指标不是审美评价，不能声称听过声音。参考仅限用户提供或本轮注册的候选，可 compose_candidates 组合。最终只输出 JSON {"message":"中文说明与依据","candidateIds":["工具返回的ID"]}，最多3个候选；讲解时为空数组。不能自行编造候选或ID。工具错误可修正，不重复相同调用。嵌套音色数组完整替换，使用返回的完整操作。';
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
const callSchema = z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().max(100), arguments: z.string().max(30000) }) });
type ChatMessage = { role: string; content?: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
function modelToolResult(name: string, result: unknown) {
  if (!result || typeof result !== 'object') return result;
  if (['propose_edit', 'revise_candidate', 'compose_candidates'].includes(name)) {
    const registered = result as { accepted?: boolean; candidateId?: string; candidate?: RegisteredCandidate; baseRevision?: number };
    if (registered.candidate) {
      const { project: _project, ...candidate } = registered.candidate;
      return { ...registered, candidate, projectBasis: 'Apply the returned patch to the original request project; no project mutation occurred.' };
    }
  }
  return result;
}
const finalReplySchema = z.object({ message: z.string().min(1).max(2000), candidateIds: z.array(z.string().min(1)).max(3) }).strict();
function parseFinalJSON(content: string) {
  try { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
  catch { throw new AgentOutputError('最终回复不是有效 JSON，无法读取候选引用。'); }
}
function validateFinalReply(content: string, candidates: Map<string, RegisteredCandidate>) {
  const checked = finalReplySchema.safeParse(parseFinalJSON(content));
  if (!checked.success) {
    const fields = [...new Set(checked.error.issues.map(issue => issue.path.length ? issue.path.join('.') : '顶层字段'))].join('、');
    throw new AgentOutputError(`最终回复格式校验失败：${fields}。需要 message 文本和 candidateIds 数组，最多3个ID，不能包含其他字段。`);
  }
  if (new Set(checked.data.candidateIds).size !== checked.data.candidateIds.length) throw new AgentOutputError('最终回复包含重复的候选 ID。');
  return { message: checked.data.message, candidates: checked.data.candidateIds.map(id => {
    const candidate = candidates.get(id); if (!candidate) throw new AgentOutputError('最终回复引用了未在本轮注册的候选 ID。'); return candidate;
  }) };
}
export async function runMusicAgent(input: AgentInput, config: { endpoint?: string; model?: string; apiKey?: string; executionMode?: 'agent' | 'direct'; renderer?: Renderer; onEvent?: (event: Trace['events'][number]) => void; knowledgeEnabled?: boolean; memoryEnabled?: boolean }, signal: AbortSignal): Promise<{ message: string; candidates: RegisteredCandidate[] } & { mode: 'model' | 'demo'; trace: Trace }> {
  const began = performance.now(); const trace: Trace = { requestId: randomUUID(), durationMs: 0, events: [] };
  const event = (name: string, status: 'success' | 'error', start: number, detail?: string) => { const entry = { name, status, durationMs: Math.round(performance.now() - start), ...(detail ? { detail } : {}) }; trace.events.push(entry); config.onEvent?.(entry); };
  if (config.memoryEnabled === false) input = { ...input, preferences: [], feedback: [] };
  const runtime = new MusicToolRuntime(config.executionMode === 'direct' ? { ...input, workflowMode: 'quick' } : input, config.renderer, signal);
  const limits = agentLimits(input.workflowMode);
  const availableTools = agentTools.filter(t => config.knowledgeEnabled !== false || t.function.name !== 'search_music_knowledge');
  if (!config.endpoint || !config.model) {
    if (input.workflowMode === 'compare') runtime.execute('plan_creation', { goal: input.prompt.slice(0, 300), preserve: ['工程锁定与音符选区'], alternatives: ['规则方案一', '规则方案二'], checks: ['user-listening'] });
    const start = performance.now(); const reply = localReply(input.prompt, input.project, runtime.selection.map(id => input.project.notes.findIndex(n => n.id === id)));
    const candidates: RegisteredCandidate[] = []; for (const c of reply.candidates) { try { const result = runtime.register(c); if (config.renderer) await runtime.preview(result.candidateId); candidates.push(result.candidate); } catch (error) { if (signal.aborted) throw error; event('validate_demo_candidate', 'error', start, '候选违反工程约束，已丢弃。'); } }
    if (input.workflowMode === 'compare' && candidates.length >= 2) { runtime.execute('compare_candidates', { candidateIds: candidates.slice(0, 2).map(c => c.id) }); event('compare_candidates', 'success', start, '规则方案比较；未进行模型规划与反馈修正。'); }
    event('local_rule_demo', 'success', start, '本地规则演示，没有调用模型。'); trace.durationMs = Math.round(performance.now() - began); return { message: candidates.length || !reply.candidates.length ? reply.message : '当前锁定或选区限制阻止了候选修改。请调整范围，或让我解释已有音乐。', candidates, mode: 'demo', trace };
  }
  const url = new URL(config.endpoint);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new AgentOutputError('模型地址必须是 HTTPS 或本机 HTTP。');
  // DeepSeek defaults to thinking; short interactive edits need a bounded, non-thinking response.
  const deepseek = url.hostname === 'api.deepseek.com' || /^deepseek-(flash|pro|chat|reasoner)$/i.test(config.model);
  const workflow = '用户要求创作或修改时，应注册可应用候选；scope只是界面上下文，明确的用户请求优先。为现有音色配和弦时保留音色与旋律，用稳定ID更新或删除原和弦，避免重叠；按拍填写start/duration，覆盖不超过bars*4。可直接propose_edit注册和弦操作，并用set_layers打开harmony。edit_chords只校验操作，不会注册候选，必须继续propose_edit。';
  const guidance = '用户偏好仅以preferences为长期明确偏好；feedback是带版本ID的本次选择与原因，不得自动升格为长期偏好。检索search_music_knowledge可获得启发式与来源，不得称其为权威结论；引用检索结果时用knowledgeIds。引用父版本时保持其稳定ID，并在propose_edit的parentIds中明确列出实际使用的参考，不能把所有上下文参考都当成父版本。';
  const loop = input.workflowMode === 'compare' ? '当前为双方案比较模式。若用户要求创作：先plan_creation记录目标、保留项、两个不同的方案及检查项；可并行批次检索知识和规划。下一轮批次propose_edit注册两个不同候选，再批次render_preview渲染二者，再compare_candidates。根据实测/符号发现及用户目标决定是否调用revise_candidate修正一次，修正版再render_preview并compare_candidates与原版对比。没有相关问题就不强行修正，解释原因。最终应提供2至3个候选与差异及推荐依据，不把指标当审美得分。纯讲解请求无需强制生成候选。最多10轮工具探索、18次工具、3次渲染，另有2轮只用于最终总结。' : '';
  const history = input.history.slice(-6).map(m => ({ role: m.role, content: m.content.slice(-1200) }));
  const context = { prompt: input.prompt, scope: input.scope, project: input.project, selection: runtime.selection, taskGoal: input.taskGoal, preferences: config.memoryEnabled === false ? [] : input.preferences, feedback: config.memoryEnabled === false ? [] : input.feedback, parents: input.parents?.map(c => ({ id: c.id, title: c.title, project: c.project, parentIds: c.parentIds })), workflowMode: input.workflowMode ?? 'quick' };
  const messages: ChatMessage[] = [{ role: 'system', content: config.executionMode === 'direct' ? system + workflow + guidance + '直接模式没有工具。改为输出 JSON {message,candidates:[{title,explanation,patch}]}。允许 patch Schema：' + JSON.stringify(z.toJSONSchema(patchSchema, { target: 'draft-7' })) : system + workflow + guidance + loop + '快速模式的完整工程已在上下文，无需重复读取。简单修改直接propose_edit；edit_sound/edit_chords/transform_motif仅校验而不注册候选。独立调用尽量放在同一批。已有可用候选后尽快输出最终JSON；最终渲染由系统补齐，无需反复读取、分析或渲染同一候选。' }, ...history, { role: 'user', content: JSON.stringify(context) }];
  const totalRounds = limits.rounds + 2; // Reserve finalization without allowing more tool exploration.
  const successfulCalls = new Map<string, unknown>();
  const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const executed = new Map<string, { signature: string; result: unknown }>();
  let toolCount = 0; let inputTokens = 0; let outputTokens = 0; let hasUsage = false; let finalRepairCount = 0; let workflowRepair = false;
  try {
  for (let step = 0; step < totalRounds; step++) {
    const start = performance.now(); signal.throwIfAborted();
    const finalizing = step >= limits.rounds || toolCount >= limits.tools;
    if (finalizing && !finalRepairCount) {
      messages.push({ role: 'user', content: JSON.stringify({ instruction: '工具探索预算已用完。现在只输出最终JSON {message,candidateIds}，引用已注册候选，不再调用工具。若没有候选，如实说明具体阻碍；不要声称已完成修改。', registeredCandidates: [...runtime.candidates.values()].map(c => ({ id: c.id, title: c.title, rendered: Boolean(c.metrics) })) }) });
      event('finalize_request', 'success', start, '预留收尾轮次，不再执行新工具。');
    }
    const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.model, messages, ...(config.executionMode !== 'direct' ? { tools: availableTools, tool_choice: finalRepairCount || finalizing ? 'none' : 'auto' } : {}), ...(deepseek ? { thinking: { type: 'disabled' } } : {}), temperature: 0.5, max_tokens: deepseek ? 8192 : 3200 }), signal, redirect: 'error' });
    if (!response.ok) throw new ProviderError(response.status);
    const raw = await response.text(); if (raw.length > 150000) throw new AgentOutputError('模型响应过大。');
    const envelope = JSON.parse(raw) as { choices?: { finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: unknown[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    event(`model_step_${step + 1}`, 'success', start, '已收到模型响应；工具与最终回复仍需校验。');
    const usage = envelope.usage;
    if (Number.isInteger(usage?.prompt_tokens) && Number.isInteger(usage?.completion_tokens) && usage!.prompt_tokens! >= 0 && usage!.completion_tokens! >= 0) { hasUsage = true; inputTokens += usage!.prompt_tokens!; outputTokens += usage!.completion_tokens!; }
    const choice = envelope.choices?.[0];
    if (choice?.finish_reason === 'length') throw new AgentOutputError('模型输出达到 token 上限，回复已截断，未执行本轮工具。请减少候选数量或关闭模型思考模式后重试。');
    const message = choice?.message; if (!message) throw new AgentOutputError('模型响应缺少消息。');
    if (message.tool_calls?.length) {
      if (config.executionMode === 'direct') throw new AgentOutputError('直接生成模式不能执行工具。');
      if (finalRepairCount) throw new AgentOutputError('最终回复格式修正阶段不允许新增工具调用。');
      if (finalizing) { event('finalize_request', 'error', start, '模型在收尾阶段仍请求工具，停止探索并检查已注册结果。'); break; }
      const calls = z.array(callSchema).max(8).parse(message.tool_calls); if (toolCount + calls.length > limits.tools) { toolCount = limits.tools; messages.push({ role: 'user', content: '这批工具超过剩余预算，未执行。请立即返回已有候选的最终JSON。' }); continue; }
      if (new Set(calls.map(c => c.id)).size !== calls.length) throw new AgentOutputError('工具调用标识重复。');
      messages.push({ role: 'assistant', content: message.content ?? null, ...(message.reasoning_content != null ? { reasoning_content: message.reasoning_content } : {}), tool_calls: calls });
      for (const call of calls) {
        signal.throwIfAborted(); toolCount++; const called = performance.now(); let result: unknown;
        try {
          if (!availableTools.some(t => t.function.name === call.function.name)) throw new Error('本次运行未启用该工具。');
          const signature = call.function.name + ':' + call.function.arguments; const cached = executed.get(call.id);
          if (cached && cached.signature !== signature) throw new Error('同一工具调用 ID 的参数不能改变。');
          const args = JSON.parse(call.function.arguments);
          const fingerprint = call.function.name + ':' + canonical(args);
          const cacheable = ['get_project_context', 'analyze_music', 'edit_sound', 'edit_chords', 'transform_motif', 'propose_edit', 'render_preview', 'search_music_knowledge'].includes(call.function.name);
          const reused = cached || (cacheable && successfulCalls.has(fingerprint));
          result = cached ? cached.result : cacheable && successfulCalls.has(fingerprint) ? successfulCalls.get(fingerprint) : await runtime.execute(call.function.name, args);
          if (cacheable) successfulCalls.set(fingerprint, result);
          if (reused) event('reuse_tool_result', 'success', called, `复用 ${call.function.name} 的相同请求结果，未重复创建候选或渲染。`);
          executed.set(call.id, { signature, result });
          const detail = call.function.name === 'plan_creation' && runtime.creationPlan
            ? `目标：${runtime.creationPlan.goal}；方案：${runtime.creationPlan.alternatives.join(' / ')}`
            : '已执行确定性工具；工程未改变。';
          event(call.function.name, 'success', called, detail);
        }
        catch (error) { const detail = error instanceof z.ZodError ? '工具参数或音乐范围校验失败。' : error instanceof Error ? error.message : '工具失败。'; result = { accepted: false, error: detail }; event(call.function.name, 'error', called, detail); }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(modelToolResult(call.function.name, result)) });
      }
      if (runtime.candidates.size) messages.push({ role: 'user', content: JSON.stringify({ instruction: input.workflowMode === 'compare' ? '已有候选，请只补齐缺失的渲染/比较步骤后返回最终JSON，不重复创建相同方案。' : '已有候选，请返回最终JSON。系统会补齐最终试听渲染；只有确有必要时才继续工具调用。', candidateIds: [...runtime.candidates.keys()] }) });
      continue;
    }
    let reply: { message: string; candidates: RegisteredCandidate[] };
    const validating = performance.now();
    if (config.executionMode === 'direct') {
      if (!message.content || message.content.length > 60000) throw new AgentOutputError('最终回复为空或过大。');
      const direct = replySchema.parse(parseFinalJSON(message.content)); reply = { message: direct.message, candidates: direct.candidates.map(c => runtime.register(c).candidate) };
    } else {
      try {
        if (!message.content || message.content.length > 60000) throw new AgentOutputError('最终回复为空或过大。');
        reply = validateFinalReply(message.content, runtime.candidates);
        event('validate_final_reply', 'success', validating, `最终回复校验通过，引用${reply.candidates.length}个本轮候选。`);
      } catch (error) {
        if (!(error instanceof AgentOutputError)) throw error;
        event('validate_final_reply', 'error', validating, `${error.message} 已注册${runtime.candidates.size}个候选，工程未改变。`);
        if (finalRepairCount >= 1 || step >= totalRounds - 1 || !message.content || message.content.length > 60000) throw error;
        finalRepairCount++;
        messages.push({ role: 'assistant', content: message.content, ...(message.reasoning_content != null ? { reasoning_content: message.reasoning_content } : {}) });
        messages.push({ role: 'user', content: JSON.stringify({ instruction: '上一条最终回复校验失败。只修正最终 JSON，不要再次创建或渲染候选。输出且仅输出 {"message":"中文说明","candidateIds":["本轮已注册ID"]}；不能输出patch、candidates或额外字段，不能编造或重复ID。', error: error.message, registeredCandidates: [...runtime.candidates.values()].map(c => ({ id: c.id, title: c.title, rendered: Boolean(c.metrics) })) }) });
        event('repair_final_reply', 'success', validating, `请求一次最终回复格式修正，保留已注册候选；仍受${totalRounds}轮总限额约束。`);
        continue;
      }
    }
    if (finalizing && !reply.candidates.length && runtime.candidates.size) break;
    const workflowError = config.executionMode === 'direct' ? null : runtime.workflowError(reply.candidates);
    if (workflowError) {
      event('validate_workflow', 'error', validating, workflowError);
      if (workflowRepair || finalRepairCount || step >= totalRounds - 1) throw new AgentOutputError(workflowError);
      workflowRepair = true;
      messages.push({ role: 'assistant', content: message.content, ...(message.reasoning_content != null ? { reasoning_content: message.reasoning_content } : {}) });
      messages.push({ role: 'user', content: `工作流尚未完成：${workflowError} 请补齐缺失步骤，保留已有候选。` });
      continue;
    }
    if (config.renderer) for (const candidate of reply.candidates) { const rendered = performance.now(); await runtime.preview(candidate.id); event('render_preview_final', 'success', rendered, '浏览器离线渲染与指标分析完成。'); }
    trace.durationMs = Math.round(performance.now() - began); if (hasUsage) trace.usage = { inputTokens, outputTokens };
    return { ...reply, mode: 'model', trace };
  }
  const recovered = [...runtime.candidates.values()].slice(-3);
  const incomplete = runtime.workflowError(recovered);
  if (recovered.length && !incomplete) {
    signal.throwIfAborted();
    if (config.renderer) for (const candidate of recovered) await runtime.preview(candidate.id);
    event('recover_registered_candidates', 'success', began, `模型未完成收尾；返回${recovered.length}个经过约束校验的已有候选，未自动应用，未判断其已满足全部目标。`);
    trace.durationMs = Math.round(performance.now() - began); if (hasUsage) trace.usage = { inputTokens, outputTokens };
    return { message: '模型未能在预算内完成总结。以下是已生成并通过工程约束校验的候选，可能只完成了部分要求，请试听确认后再应用。', candidates: recovered, mode: 'model', trace };
  }
  throw new AgentOutputError(incomplete ?? `模型在${limits.rounds}轮工具探索及收尾后仍未生成有效候选。请查看执行记录中的工具错误，或检查模型是否支持工具调用；工程未改变。`);
  } catch (error) {
    trace.durationMs = Math.round(performance.now() - began); if (hasUsage) trace.usage = { inputTokens, outputTokens };
    event('request_failed', 'error', began, error instanceof AgentOutputError || error instanceof ProviderError ? error.message : '请求没有生成可应用的候选；工程未改变。');
    throw new AgentRunFailure(error, trace);
  }
}
