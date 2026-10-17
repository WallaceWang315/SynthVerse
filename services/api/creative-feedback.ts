import type { RegisteredCandidate } from '../../src/agent-protocol';
import type { z } from 'zod';
import { assessmentSchema } from '../../src/creative-session';
export function assessCandidate(candidate: RegisteredCandidate): z.infer<typeof assessmentSchema> {
  const findings: z.infer<typeof assessmentSchema>['findings'] = [];
  if (candidate.metrics?.rms !== undefined && candidate.metrics.rms < 0.00001) findings.push({ code: 'silence', basis: 'measured', detail: '渲染片段接近静音。检查声部开关、音符及振荡器音量；留白可能是有意设计。' });
  if (candidate.metrics && candidate.metrics.clippingRatio > 0.001) findings.push({ code: 'clipping', basis: 'measured', detail: '渲染片段的削波样本比例超过0.1%，建议检查叠加音量。' });
  if (candidate.project.layers.harmony && candidate.project.chords.some(c => c.pitches.filter(p => p < 60).length >= 3)) findings.push({ code: 'low-register-density', basis: 'symbolic', detail: '有和弦包含至少三个C4以下构成音。若用户要求清晰，可试听开放排列；这不是浑浊的声学判定。' });
  return { measured: Boolean(candidate.metrics), findings };
}
