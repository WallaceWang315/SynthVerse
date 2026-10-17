import { z } from 'zod';
import { applyPatch, chordFields, newId, noteFields, objectIdSchema, type Patch, type Project } from './domain';
import { soundPatchSchema } from './synth';
const nonempty = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().strict().refine(v => Object.keys(v).length > 0, '修改不能为空');
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update_note'), noteId: objectIdSchema, changes: nonempty(noteFields) }).strict(),
  z.object({ type: z.literal('add_note'), note: z.object(noteFields).strict() }).strict(),
  z.object({ type: z.literal('delete_note'), noteId: objectIdSchema }).strict(),
  z.object({ type: z.literal('update_chord'), chordId: objectIdSchema, changes: nonempty(chordFields) }).strict(),
  z.object({ type: z.literal('add_chord'), chord: z.object(chordFields).strict() }).strict(),
  z.object({ type: z.literal('delete_chord'), chordId: objectIdSchema }).strict(),
  z.object({ type: z.literal('set_sound_parameters'), values: soundPatchSchema.refine(v => Object.keys(v).length > 0, '修改不能为空') }).strict(),
  z.object({ type: z.literal('set_layers'), values: nonempty({ melody: z.boolean(), harmony: z.boolean(), bass: z.boolean() }) }).strict(),
  z.object({ type: z.literal('set_bars'), bars: z.number().int().min(1).max(16) }).strict(),
]);
export const transactionSchema = z.object({ baseRevision: z.number().int().nonnegative(), operations: z.array(operationSchema).min(1).max(256) }).strict();
export type Operation = z.infer<typeof operationSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export function compileOperations(project: Project, input: Transaction): Patch {
  const transaction = transactionSchema.parse(input); if (transaction.baseRevision !== project.revision) throw new Error('工程版本已改变，不能执行旧操作。');
  const draft = structuredClone(project); const patch: Patch = {};
  for (const operation of transaction.operations) {
    if (operation.type === 'update_note' || operation.type === 'delete_note') {
      const index = draft.notes.findIndex(n => n.id === operation.noteId); if (index < 0) throw new Error('音符 ID 不存在。');
      if (operation.type === 'update_note') draft.notes[index] = { ...draft.notes[index], ...operation.changes }; else draft.notes.splice(index, 1); patch.notes = draft.notes;
    } else if (operation.type === 'add_note') { draft.notes.push({ ...operation.note, id: newId('note') }); patch.notes = draft.notes; }
    else if (operation.type === 'update_chord' || operation.type === 'delete_chord') {
      const index = draft.chords.findIndex(c => c.id === operation.chordId); if (index < 0) throw new Error('和弦 ID 不存在。');
      if (operation.type === 'update_chord') draft.chords[index] = { ...draft.chords[index], ...operation.changes }; else draft.chords.splice(index, 1); patch.chords = draft.chords;
    } else if (operation.type === 'add_chord') { draft.chords.push({ ...operation.chord, id: newId('chord') }); patch.chords = draft.chords; }
    else if (operation.type === 'set_sound_parameters') { patch.sound = { ...patch.sound, ...operation.values }; }
    else if (operation.type === 'set_layers') { patch.layers = { ...patch.layers, ...operation.values }; }
    else if (operation.type === 'set_bars') patch.bars = operation.bars;
  }
  applyPatch(project, patch, transaction.baseRevision); return patch;
}
export function applyTransaction(project: Project, input: Transaction, selection: string[] = []): Project {
  const patch = compileOperations(project, input); const next = applyPatch(project, patch, input.baseRevision); validateSelection(project, next, selection); return next;
}
export function validateSelection(project: Project, next: Project, selection: string[]) {
  if (!selection.length) return;
  if (selection.some(id => !project.notes.some(n => n.id === id)) || new Set(selection).size !== selection.length) throw new Error('音符选区无效。');
  const outside = project.notes.filter(n => !selection.includes(n.id));
  if (next.notes.some(n => !project.notes.some(old => old.id === n.id)) || outside.some(n => JSON.stringify(next.notes.find(item => item.id === n.id)) !== JSON.stringify(n))) throw new Error('只允许修改选中的音符；未选中的音符必须保持不变。');
}
