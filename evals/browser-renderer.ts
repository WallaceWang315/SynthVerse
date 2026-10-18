import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { audioMetricsSchema, type RegisteredCandidate } from '../src/agent-protocol';
import { probePacketSchema, type Probe } from '../src/listening-protocol';
export async function createBrowserRenderer() {
  const vite = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' }); await vite.listen();
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.route('**/api/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(vite.resolvedUrls!.local[0]);
  return { render: async (candidate: RegisteredCandidate, signal: AbortSignal) => {
    signal.throwIfAborted(); const result = await page.evaluate(async project => { const audioPath = '/src/audio.ts', analysisPath = '/src/audio-analysis.ts', clientPath = '/src/agent-client.ts'; const audio = await import(audioPath), analysis = await import(analysisPath), client = await import(clientPath); return analysis.analyzeAudio(await audio.renderProject(client.previewExcerpt(project))); }, candidate.project);
    signal.throwIfAborted(); return audioMetricsSchema.parse(result);
  }, probes: async (candidate: RegisteredCandidate, probes: Probe[], signal: AbortSignal) => {
    signal.throwIfAborted(); const result = await page.evaluate(async ({ project, probes }) => { const path = '/src/listening-audio.ts'; const { renderProbes } = await import(path); return renderProbes(project, probes, new AbortController().signal); }, { project: candidate.project, probes });
    signal.throwIfAborted(); return result.map((packet: unknown) => probePacketSchema.parse(packet));
  }, close: async () => { await browser.close(); await vite.close(); } };
}
