import { z } from 'zod';

export const explorationSchema = z.enum(['standard', 'listening', 'collaborative']);
export type Exploration = z.infer<typeof explorationSchema>;
export const probeSchema = z.enum(['sustain', 'staccato', 'chord', 'context']);
export type Probe = z.infer<typeof probeSchema>;
export const probeLabels: Record<Probe, string> = { sustain: '长音', staccato: '快速短音', chord: '和弦', context: '当前片段' };
export const pcmSchema = z.object({ encoding: z.literal('pcm-s16le'), sampleRate: z.literal(16000), channels: z.literal(1), data: z.string().min(4).max(1400000).regex(/^[A-Za-z0-9+/]+={0,2}$/), samples: z.number().int().positive().max(512000) }).strict();
export type PCM = z.infer<typeof pcmSchema>;
export const referenceAudioSchema = z.object({ name: z.string().max(120), audio: pcmSchema.refine(a => a.samples <= 192000, '参考音频最多12秒') }).strict();
export type ReferenceAudio = z.infer<typeof referenceAudioSchema>;
export const probeMetricsSchema = z.object({ rms: z.number().finite().min(0).max(2), peak: z.number().finite().min(0).max(2), clippingRatio: z.number().finite().min(0).max(1), spectralCentroidHz: z.number().finite().nonnegative().nullable(), highFrequencyEnergyRatio: z.number().finite().min(0).max(1), onsetToPeakMs: z.number().finite().nonnegative(), tailRms: z.number().finite().nonnegative().max(2) }).strict();
export const probePacketSchema = z.object({ probe: probeSchema, configId: z.string().min(1).max(100), engine: z.literal('web-audio-v3-probes-1'), truncated: z.boolean(), durationSeconds: z.number().positive().max(32), audio: pcmSchema, metrics: probeMetricsSchema }).strict();
export type ProbePacket = z.infer<typeof probePacketSchema>;
export const audioFindingSchema = z.object({ code: z.string().min(1).max(60), observation: z.string().min(1).max(400), goalRelation: z.string().max(300), suggestion: z.string().max(300), probe: probeSchema, startSeconds: z.number().min(0).max(32).optional(), endSeconds: z.number().min(0).max(32).optional() }).strict().refine(f => f.endSeconds === undefined || f.startSeconds === undefined || f.endSeconds >= f.startSeconds, '时间范围无效');
export const perceptionResponseSchema = z.object({ findings: z.array(audioFindingSchema).max(6), limitations: z.array(z.string().max(300)).min(1).max(6), needsRevision: z.boolean() }).strict();
export type PerceptionResponse = z.infer<typeof perceptionResponseSchema>;
export const listeningEvidenceSchema = z.object({
  candidateId: z.string().max(100), baseRevision: z.number().int().nonnegative(), projectHash: z.string().max(64), goal: z.string().max(2000),
  status: z.enum(['signal-only', 'model-reviewed', 'model-failed', 'render-failed']),
  provider: z.string().max(200), basis: z.enum(['signal', 'audio-model', 'embedding-model']), createdAt: z.string().datetime(),
  clips: z.array(z.object({ probe: probeSchema, artifactId: z.string().max(64), configId: z.string().max(100), truncated: z.boolean(), durationSeconds: z.number().positive().max(32), metrics: probeMetricsSchema })).max(4),
  findings: z.array(audioFindingSchema).max(6),
  limitations: z.array(z.string().max(300)).max(8), needsRevision: z.boolean(), referenceHash: z.string().max(64).optional(),
});
export type ListeningEvidence = z.infer<typeof listeningEvidenceSchema>;
export const collaborationSchema = z.object({ branch: z.string().max(80), complete: z.boolean(),
  contributions: z.array(z.object({ role: z.enum(['sound', 'composition']), candidateId: z.string().max(100), baseRevision: z.number().int().nonnegative(), changedFields: z.array(z.string().max(40)).max(5), handoff: z.string().max(600) })).max(3),
  limitations: z.array(z.string().max(300)).max(6),
});
export function explorationTimeout(mode?: Exploration) { return mode === 'collaborative' ? 240000 : mode === 'listening' ? 180000 : undefined; }
