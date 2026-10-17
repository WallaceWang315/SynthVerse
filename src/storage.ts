import { registeredCandidateSchema } from './agent-protocol';
import { z } from 'zod';
import { feedbackSchema, workflowModeSchema } from './creative-session';
import { projectSchema, type Project } from './domain';
export const savedSchema = z.object({ project: projectSchema, feedback: z.array(feedbackSchema).max(12).default([]), workflowMode: workflowModeSchema.default('quick'), autoReference: z.boolean().default(true), taskGoal: z.string().max(300).default(''), preferences: z.array(z.string().max(100)).max(10).default([]), archive: z.array(registeredCandidateSchema).max(12).default([]), shelf: z.array(z.object({ id: z.string(), savedAt: z.string(), project: projectSchema })).max(12) });
export type Saved = z.infer<typeof savedSchema>;
let connection: Promise<IDBDatabase> | undefined;
function database() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('synthverse', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('workspace');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('另一个页面阻止了本地数据库打开。'));
  });
  return connection;
}
export async function loadWorkspace(): Promise<Saved | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
    req.onsuccess = () => { try { resolve(req.result ? savedSchema.parse(req.result) : undefined); } catch (error) { reject(error); } }; req.onerror = () => reject(req.error);
  });
}
export async function saveWorkspace(data: z.input<typeof savedSchema>) {
  const validated = savedSchema.parse(data); const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(validated, 'current');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function importProject(file: File): Promise<Project> {
  if (file.size > 250000) throw new Error('工程文件超过 250 KB，请选择 SynthVerse 工程 JSON。');
  try { return projectSchema.parse(JSON.parse(await file.text())); } catch { throw new Error('工程格式或版本无效，当前创意未改变。'); }
}
