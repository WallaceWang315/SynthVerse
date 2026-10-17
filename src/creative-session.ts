import { z } from 'zod';
export const workflowModeSchema = z.enum(['quick', 'compare']);
export const feedbackSchema = z.object({
  candidateId: z.string().min(1).max(100), title: z.string().max(60),
  choice: z.enum(['like', 'dislike', 'applied']), note: z.string().max(200),
  createdAt: z.string().datetime(),
});
export type CreativeFeedback = z.infer<typeof feedbackSchema>;
export const findingSchema = z.object({ code: z.enum(['silence', 'clipping', 'low-register-density']), basis: z.enum(['measured', 'symbolic']), detail: z.string().max(300) });
export const assessmentSchema = z.object({ measured: z.boolean(), findings: z.array(findingSchema).max(3) });
export const knowledgeCitationSchema = z.object({ id: z.string().max(80), title: z.string().max(100), source: z.string().max(200) });
export function agentLimits(mode?: 'quick' | 'compare') { return mode === 'compare' ? { rounds: 10, tools: 18, timeoutMs: 90000 } : { rounds: 6, tools: 12, timeoutMs: 45000 }; }
