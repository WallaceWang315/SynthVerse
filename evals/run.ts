import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { evaluationCases } from './cases';
import { executeMusicTool, runMusicAgent, validateScopedPatch } from '../services/api/agent';
const live = process.argv.includes('--live');
const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'agent';
if (!['agent', 'direct', 'compare'].includes(mode)) throw new Error('mode must be agent, direct or compare');
const requestedLimit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 50);
if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) throw new Error('limit must be 1..50');
const cases = evaluationCases().slice(0, requestedLimit);
if (live && (!process.env.MODEL_CHAT_URL || !process.env.MODEL_NAME)) throw new Error('真实评测必须配置 MODEL_CHAT_URL 与 MODEL_NAME；不会降级为演示。');
const rows: Record<string, unknown>[] = [];
for (const c of cases) {
  if (!live) {
    let accepted = false; let error: string | undefined;
    try { executeMusicTool('propose_edit', c.candidate, c.input); accepted = true; } catch (e) { error = e instanceof z.ZodError ? 'schema-or-range-rejection' : e instanceof Error ? e.message : 'rejected'; }
    rows.push({ id: c.id, category: c.category, expectedAccepted: c.expectedAccepted, accepted, passed: accepted === c.expectedAccepted, ...(error ? { error } : {}) });
  } else {
    for (const executionMode of mode === 'compare' ? ['agent', 'direct'] as const : [mode as 'agent' | 'direct']) {
      try {
        const reply = await runMusicAgent(c.input, { endpoint: process.env.MODEL_CHAT_URL, model: process.env.MODEL_NAME, apiKey: process.env.MODEL_API_KEY, executionMode }, AbortSignal.timeout(45000));
        reply.candidates.forEach(candidate => validateScopedPatch(c.input.project, candidate.patch, c.input.selection));
        rows.push({ id: c.id, category: c.category, executionMode, completed: true, candidateCount: reply.candidates.length, producedRequestedCandidate: !c.requiresCandidate || reply.candidates.length > 0, durationMs: reply.trace.durationMs, trace: reply.trace, reply, manualReview: 'pending' });
      } catch (e) { rows.push({ id: c.id, category: c.category, executionMode, completed: false, error: e instanceof z.ZodError ? 'schema-or-range-rejection' : e instanceof Error ? e.message : 'failed' }); }
    }
  }
}
const report = { generatedAt: new Date().toISOString(), kind: live ? 'live-model-constraint-evaluation' : 'deterministic-candidate-tool-regression', model: live ? process.env.MODEL_NAME : null, caseCount: cases.length, runCount: rows.length, passed: live ? undefined : rows.filter(r => r.passed).length, completed: live ? rows.filter(r => r.completed).length : undefined, limitation: live ? '自动校验仅检查格式与工程约束；语义满足度、乐理解释和听感需要人工复核。' : '50个案例为10类约束的5组变体；没有调用模型，不代表模型质量或用户满意度。', rows };
await mkdir('evals/reports', { recursive: true }); const path = `evals/reports/${live ? mode + '-live' : 'safety'}-latest.json`; await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ kind: report.kind, cases: cases.length, runs: rows.length, passed: report.passed, completed: report.completed, report: path }, null, 2));
if (!live && report.passed !== rows.length) process.exitCode = 1;
