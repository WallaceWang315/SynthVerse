import { creativeFields, type CreationBrief } from './creation-brief';
import type { Project } from './domain';
const isDeepStrictEqual = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function validateBrief(brief: CreationBrief, before: Project, after: Project) {
  if (brief.baseRevision !== before.revision) throw new Error('创作要求的工程版本已过期。');
  for (const field of creativeFields) {
    if (!brief.allowedFields.includes(field) && !isDeepStrictEqual(before[field], after[field])) throw new Error(`本次专业角色或保留要求不允许修改 ${field}。请明确新的修改范围后重试。`);
  }
  if (brief.preserveRhythm && (before.notes.length !== after.notes.length || before.notes.some(n => {
    const next = after.notes.find(item => item.id === n.id);
    return !next || n.start !== next.start || n.duration !== next.duration || n.velocity !== next.velocity;
  }))) throw new Error('本次创作要求保留节奏、音符时序与力度。');
}

export function candidateProvenance(brief: CreationBrief, before: Project, after: Project) {
  const changedIds = (a: { id: string }[], b: { id: string }[]) => [...new Set([...a, ...b].map(x => x.id))].filter(id => !isDeepStrictEqual(a.find(x => x.id === id), b.find(x => x.id === id)));
  return { brief: structuredClone(brief), createdAt: new Date().toISOString(),
    changedFields: creativeFields.filter(field => !isDeepStrictEqual(before[field], after[field])),
    soundParameters: Object.keys(after.sound).filter(key => !isDeepStrictEqual(before.sound[key as keyof typeof before.sound], after.sound[key as keyof typeof after.sound])),
    changedNoteIds: changedIds(before.notes, after.notes), changedChordIds: changedIds(before.chords, after.chords),
  };
}

