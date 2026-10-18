import { z } from 'zod';
import type { Project } from './domain';

export const creativeFields = ['sound', 'notes', 'chords', 'layers', 'bars'] as const;
export type CreativeField = typeof creativeFields[number];
export const requestedRoleSchema = z.enum(['auto', 'sound', 'composition', 'coordinator']);
export type RequestedRole = z.infer<typeof requestedRoleSchema>;
export const roleLabels = { sound: '音色设计', composition: '旋律与和声', coordinator: '创作统筹' } as const;
export const fieldLabels: Record<CreativeField, string> = { sound: '音色', notes: '旋律', chords: '和弦', layers: '声部开关', bars: '片段长度' };
export const creationBriefSchema = z.object({
  role: z.enum(['sound', 'composition', 'coordinator']),
  goal: z.string().max(2000), context: z.string().max(300),
  baseRevision: z.number().int().nonnegative(),
  allowedFields: z.array(z.enum(creativeFields)).max(5),
  preserveFields: z.array(z.enum(creativeFields)).max(5),
  preserveRhythm: z.boolean(),
  selectedNoteIds: z.array(z.string()).max(256),
  reason: z.string().max(300), checks: z.array(z.string().max(150)).max(6),
});
export type CreationBrief = z.infer<typeof creationBriefSchema>;
export const provenanceSchema = z.object({
  brief: creationBriefSchema,
  changedFields: z.array(z.enum(creativeFields)).max(5),
  soundParameters: z.array(z.string().max(100)).max(100),
  changedNoteIds: z.array(z.string()).max(512),
  changedChordIds: z.array(z.string()).max(128),
  createdAt: z.string().datetime(),
});

// Explicit preservation clauses are removed before intent routing, so mentioning
// “keep the melody” does not accidentally authorize a melody edit.
export function buildCreationBrief(input: { prompt: string; scope: string; project: Project; selection: (string | number)[]; taskGoal?: string; requestedRole?: RequestedRole }): CreationBrief {
  const p = input.project;
  const preserve = new Set<CreativeField>();
  let rhythm = p.locks.rhythm;
  const text = input.prompt.replace(/(?:保留|保持|不改变|不修改|不要改动|不要改变|不要修改|不要改|别改|不动|锁定)[^，。；！\n,.!?;]{0,60}/g, clause => {
    // End a preservation clause before an explicit new action.
    const boundary = clause.search(/(?:但|同时|并且|然后|，|,)/);
    const kept = boundary < 0 ? clause : clause.slice(0, boundary);
    if (/音色|声音|合成器/.test(kept)) preserve.add('sound');
    if (/旋律|动机|音符/.test(kept)) preserve.add('notes');
    if (/和弦|和声/.test(kept)) preserve.add('chords');
    if (/节奏|时序|力度/.test(kept)) rhythm = true;
    if (/长度|小节数/.test(kept)) preserve.add('bars');
    return boundary < 0 ? '' : clause.slice(boundary);
  }).replace(/(?:用|基于|沿用|使用)(?:当前|现在|原来|这个|这段|现有|的|这|一段)*音色/g, () => { preserve.add('sound'); return ''; });
  const sound = /音色|声音|合成器|振荡器|滤波|包络|混响|失谐|起音|尾音|泛音|波形|timbre|synth|reverb|filter|envelope/i.test(text);
  const composition = /旋律|动机|音符|和弦|和声|节奏|声部|编配|编排|结尾|乐理|melody|chord|harmony|rhythm|motif/i.test(text);
  const role = input.requestedRole && input.requestedRole !== 'auto' ? input.requestedRole : sound && composition ? 'coordinator' : sound ? 'sound' : composition ? 'composition' : input.scope === 'sound' ? 'sound' : 'composition';
  const allowed: CreativeField[] = role === 'sound' ? ['sound'] : role === 'composition' ? ['notes', 'chords', 'layers', 'bars'] : [...creativeFields];
  if (/只(?:分析|解释|讲解)|不修改工程|不要修改工程|analysis only|explain only/i.test(input.prompt)) allowed.splice(0);
  // A named single composition domain does not authorize changes to the other.
  if (/和弦|和声|chord|harmony/i.test(text) && !/旋律|动机|音符|melody|motif/i.test(text)) preserve.add('notes');
  if (/旋律|动机|音符|melody|motif/i.test(text) && !/和弦|和声|chord|harmony/i.test(text)) preserve.add('chords');
  if (p.locks.sound) preserve.add('sound');
  if (p.locks.harmony) preserve.add('chords');
  if (rhythm || p.locks.harmony) preserve.add('bars');
  for (const field of creativeFields) if (!allowed.includes(field)) preserve.add(field);
  return creationBriefSchema.parse({ role, goal: input.prompt, context: input.taskGoal ?? '', baseRevision: p.revision,
    allowedFields: allowed.filter(f => !preserve.has(f)), preserveFields: [...preserve], preserveRhythm: rhythm,
    selectedNoteIds: input.selection.map(id => typeof id === 'number' ? p.notes[id]?.id : id),
    reason: input.requestedRole && input.requestedRole !== 'auto' ? '使用用户指定的工作方向；保留要求和工程锁定继续生效。' : sound && composition ? '请求涉及声音和音乐结构，由统筹角色协调。' : sound || composition ? '根据本次明确请求选择专业角色。' : '请求未明确专业方向，沿用当前编辑面板；可在下一条消息明确修改对象。',
    checks: ['工程版本、锁定与选区检查', '仅修改获准字段', '用户试听后确认；参数指标不代表审美评价'],
  });
}
