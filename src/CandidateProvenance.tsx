import type { RegisteredCandidate } from './agent-protocol';
import { fieldLabels, roleLabels } from './creation-brief';

export default function CandidateProvenance({ candidate }: { candidate: RegisteredCandidate }) {
  const record = candidate.provenance;
  if (!record) return null;
  const brief = record.brief;
  return <details className="agent-context candidate-provenance">
    <summary>{roleLabels[brief.role]} · 修改了{record.changedFields.map(f => fieldLabels[f]).join('、') || '零个字段'}</summary>
    <p><strong>本次要求：</strong>{brief.goal}</p>
    {brief.context && <p><strong>创作背景：</strong>{brief.context}</p>}
    <p><strong>保留：</strong>{brief.preserveFields.map(f => fieldLabels[f]).join('、') || '遵守工程锁定'}{brief.preserveRhythm ? '；节奏与力度' : ''}</p>
    <p><strong>实际改动：</strong>{record.soundParameters.length} 项音色参数，{record.changedNoteIds.length} 个旋律音符，{record.changedChordIds.length} 个和弦。</p>
    {record.soundParameters.length > 0 && <small>参数：{record.soundParameters.join('、')}</small>}
    <small>来源工程版本 {candidate.baseRevision} · {candidate.parentIds.length ? `${candidate.parentIds.length} 个明确引用的父候选` : '基于本次工程'} · {brief.selectedNoteIds.length ? `仅限 ${brief.selectedNoteIds.length} 个选中音符` : '无音符选区限制'}</small>
    <p>已检查修改权限、锁定与工程范围；听感仍需试听确认。</p>
  </details>;
}
