import http from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { runMusicAgent } from '../services/api/agent';
import { initialProject } from '../src/domain';
const servers: http.Server[] = [];
afterEach(async () => { await Promise.all(servers.map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); servers.length = 0; });
async function provider(respond: (request: any, step: number) => unknown) {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; const request = JSON.parse(body); requests.push(request); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: respond(request, requests.length) }] })); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
const proposal = { title: '柔和', explanation: '降低明亮度', baseRevision: 0, operations: [{ type: 'set_sound_parameters', values: { brightness: 20 } }] };
const call = (step: number, name: string, args: unknown) => ({ tool_calls: [{ id: `call-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const input = () => ({ prompt: '音色柔和一点', project: structuredClone(initialProject), scope: 'sound', selection: [], history: [] });
it('reserves a final response after six tool rounds and reuses proposals with new IDs', async () => {
  const upstream = await provider((request, step) => step <= 6 ? call(step, 'propose_edit', step % 2 ? proposal : { operations: proposal.operations, baseRevision: 0, explanation: proposal.explanation, title: proposal.title }) : { content: JSON.stringify({ message: '请试听候选', candidateIds: [JSON.parse(request.messages.find((m: any) => m.role === 'tool').content).candidateId] }) });
  const reply = await runMusicAgent(input(), { endpoint: upstream.endpoint, model: 'test' }, new AbortController().signal);
  expect(upstream.requests).toHaveLength(7); expect(upstream.requests[6].tool_choice).toBe('none');
  expect(reply.candidates).toHaveLength(1); expect(reply.candidates[0].project.sound.brightness).toBe(20);
  expect(reply.trace.events.filter(e => e.name === 'reuse_tool_result')).toHaveLength(5);
});
it('recovers validated results with an explicit partial-result notice if the model ignores finalization', async () => {
  let renders = 0; const upstream = await provider((_request, step) => call(step, 'propose_edit', proposal));
  const source = input(); const original = JSON.stringify(source.project);
  const reply = await runMusicAgent(source, { endpoint: upstream.endpoint, model: 'test', renderer: async () => { renders++; return { basis: 'browser-offline-audio', durationSeconds: 1, sampleRate: 44100, rms: 0.1, peak: 0.3, clippingRatio: 0, spectralCentroidHz: 500, highFrequencyEnergyRatio: 0 }; } }, new AbortController().signal);
  expect(reply.message).toContain('部分要求'); expect(reply.candidates).toHaveLength(1); expect(renders).toBe(1);
  expect(reply.trace.events.at(-1)?.name).toBe('recover_registered_candidates'); expect(JSON.stringify(source.project)).toBe(original);
});
it('does not recover an incomplete comparison as a completed workflow', async () => {
  const upstream = await provider((_request, step) => step === 1 ? call(step, 'plan_creation', { goal: '比较音色', preserve: [], alternatives: ['一', '二'], checks: ['user-listening'] }) : call(step, 'propose_edit', proposal));
  await expect(runMusicAgent({ ...input(), workflowMode: 'compare' }, { endpoint: upstream.endpoint, model: 'test' }, new AbortController().signal)).rejects.toMatchObject({ cause: { message: expect.stringContaining('至少两个候选') } });
  expect(upstream.requests).toHaveLength(11);
});
it('can register on the sixth round and repair the final JSON on the eighth', async () => {
  const upstream = await provider((request, step) => {
    if (step < 6) return call(step, 'get_project_context', {});
    if (step === 6) return call(step, 'propose_edit', proposal);
    if (step === 7) return { content: '候选已经准备好了' };
    const registered = request.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)).find((m: any) => m.candidateId);
    return { content: JSON.stringify({ message: '请试听', candidateIds: [registered.candidateId] }) };
  });
  const reply = await runMusicAgent(input(), { endpoint: upstream.endpoint, model: 'test' }, new AbortController().signal);
  expect(upstream.requests).toHaveLength(8); expect(reply.candidates).toHaveLength(1);
  expect(upstream.requests.slice(6).every(request => request.tool_choice === 'none')).toBe(true);
});
