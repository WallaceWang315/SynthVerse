// Project-authored heuristics, versioned and inspectable; no external authority is implied.
export const musicKnowledge = [
  { id: 'voicing-space', title: '低音区与开放排列', source: 'docs/music-knowledge.md#voicing-space', tags: ['和弦', '浑浊', '清晰', '开放', '排列', 'voicing', 'muddy'], advice: '低音区堆叠较多构成音时，尝试将中间声部升高八度，保留低音与共同音。不要把密集排列一律判成错误。', operations: ['update_chord'], checks: ['保持和弦音级，检查音域33–96、选区和锁定', '比较声部间距，并用当前音色试听'] },
  { id: 'soft-pad', title: '柔和铺底与起音', source: 'docs/music-knowledge.md#soft-pad', tags: ['柔和', '温暖', '铺底', '梦幻', 'pad', 'soft'], advice: '可降低亮度、减少高次谐波或减弱快速起音。先改变一个维度；用户要求保留音色时只改变音符排列。频谱重心不是柔和程度评分。', operations: ['set_sound_parameters', 'update_chord'], checks: ['保留用户指定的起音、旋律和节奏', '比较RMS，避免把更响误认成更好'] },
  { id: 'reverb-space', title: '空间感与混响留白', source: 'docs/music-knowledge.md#reverb-space', tags: ['混响', '空间', '梦幻', '尾音', 'reverb'], advice: '混响混合量与时长应分别小步调整。也可以缩短音符或增加留白；更长的尾音可能掩盖下一次起音。', operations: ['set_sound_parameters', 'update_note'], checks: ['effects是完整对象，保留其他效果参数', '节奏锁定时不能缩短音符'] },
  { id: 'motif-ending', title: '动机结尾与和弦音', source: 'docs/music-knowledge.md#motif-ending', tags: ['旋律', '结尾', '悬念', '解决', '动机', 'motif'], advice: '对照结尾落在当前和弦构成音和非构成音的版本，观察稳定与继续发展的倾向；非和弦音不等于错误。', operations: ['update_note'], checks: ['先读取音符稳定ID与对应时间的和弦', '只修改指定选区，保持节奏锁定'] },
];
export function searchMusicKnowledge(query: string) {
  const text = query.toLowerCase();
  return musicKnowledge.map(entry => ({ ...entry, score: entry.tags.reduce((sum, tag) => sum + (text.includes(tag) ? 1 : 0), 0) }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}
