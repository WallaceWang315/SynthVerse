export { validateBrief, candidateProvenance } from '../../src/creation-policy';
import { type CreationBrief } from '../../src/creation-brief';


export function roleAllowsTool(brief: CreationBrief, name: string) {
  if (name === 'edit_sound') return brief.allowedFields.includes('sound');
  if (name === 'transform_motif') return brief.allowedFields.includes('notes');
  if (name === 'edit_chords') return brief.allowedFields.includes('chords');
  return true;
}

export function roleInstructions(brief: CreationBrief) {
  const instructions = {
    sound: '你现在承担音色设计角色：只调整合成器声音参数，不通过改写音符解决听感问题。结合当前音区与节奏提出参数候选；没有音频感知模型时不得声称已经听懂音色。',
    composition: '你现在承担旋律与和声角色：结合调式、动机、节奏和声部连接设计可编辑音乐结构，保留合成器音色。解释建议与当前音乐的关系。',
    coordinator: '你现在承担创作统筹角色：本次涉及音色和音乐结构。先区分两种修改的目的，再在同一候选中协调，避免无依据地改变无关字段。第一阶段是单次模型执行中的专业工作流协调，不声称已调用独立子Agent或听觉模型。',
  };
  return instructions[brief.role] + '服务端已建立不可被工具改写的creationBrief；allowedFields是本次硬性修改边界，preserveRhythm为节奏约束。计划只能进一步收紧边界，不能扩大权限。上下文中的长期目标和偏好不能覆盖本次锁定。';
}
