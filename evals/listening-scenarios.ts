import { applyPatch, initialProject, type Patch } from '../src/domain';
import { synthPresets } from '../src/synth';

const tasks = [
  { key: 'attack', prompt: '保留旋律与和弦，让音色的起音更清楚，适合快速短音。', patch: { sound: { attack: 0.01 } }, check: '盲听短音是否更清楚，且音符与和弦不变。' },
  { key: 'release', prompt: '保留旋律与和弦，把音色尾音缩短一点。', patch: { sound: { release: 0.15 } }, check: '比较尾段能量与用户偏好，不能仅以更短判定更好。' },
  { key: 'brightness', prompt: '保留旋律与和弦，让音色柔和一点但仍清晰。', patch: { sound: { brightness: 25 } }, check: '检查保留项，盲听柔和与清晰是否同时满足。' },
  { key: 'joint', prompt: '调整音色和旋律，保留节奏，让快速片段更清楚。', patch: { sound: { attack: 0.01, release: 0.2 } }, check: '检查独立专业贡献、节奏约束及联合试听。' },
  { key: 'reference', prompt: '保留旋律与和弦，让音色接近参考的声音质感。', patch: { sound: { brightness: 35 } }, check: '参考相似性需要模型和人工验证，不能视为预设恢复。' },
  { key: 'no-change', prompt: '只分析当前音色，不修改工程；没有明确问题就保持原样。', patch: {}, check: '解释或无修改，不应强制创建修正版。' },
] satisfies { key: string; prompt: string; patch: Patch; check: string }[];

export function listeningScenarios() {
  const presets = [...synthPresets, { name: '留出高音正弦', patch: { wave: 'sine' as const, brightness: 70, glass: 0, attack: 0.02, release: 0.5 } }];
  return presets.flatMap((preset, index) => tasks.map(task => {
    const project = applyPatch(structuredClone(initialProject), { sound: preset.patch }, 0);
    project.revision = 0;
    if (index >= 3) project.notes = project.notes.map(n => ({ ...n, pitch: n.pitch + 12 }));
    return { id: `listening-${index + 1}-${task.key}`, split: index >= 3 ? 'held-out' : 'development', preset: preset.name, task: task.key, prompt: task.prompt, project, scope: 'sound', selection: [], expectedPatch: task.patch, manualCheck: task.check, noChange: task.key === 'no-change' };
  }));
}
