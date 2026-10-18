import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../services/api/server';
import { initialProject } from '../src/domain';
import { runMusicAgent } from '../services/api/agent';
const servers: http.Server[] = [];
async function listen(server: http.Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => { s.closeAllConnections(); s.close(e => e ? reject(e) : resolve()); }))); });
const post = (url: string, extra = {}) => fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '音色更柔和', scope: 'sound', project: initialProject, ...extra }) });
describe('bounded Agent execution', () => {
  for (const [label, content, detail] of [
    ['plain prose', '我已经生成了一个柔和候选，请试听。', '不是有效 JSON'],
    ['missing candidateIds', JSON.stringify({ message: '候选已生成' }), 'candidateIds'],
    ['unexpected fields', JSON.stringify({ message: '候选已生成', candidateIds: [], patch: { sound: { brightness: 20 } } }), '顶层字段'],
  ]) it(`repairs ${label} after candidate registration and preview without regenerating music`, async () => {
    const records: any[] = []; let renders = 0;
    const tool = (name: string, args: unknown) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const upstream = await listen(http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk; const request = JSON.parse(body); records.push(request);
      const id = records.length > 1 ? JSON.parse(request.messages.find((m: any) => m.role === 'tool').content).candidateId : '';
      const message = records.length === 1 ? { tool_calls: [tool('propose_edit', { title: '柔和候选', explanation: '降低亮度', baseRevision: 0, operations: [{ type: 'set_sound_parameters', values: { brightness: 20 } }] })] }
        : records.length === 2 ? { tool_calls: [tool('render_preview', { candidateId: id })] }
        : records.length === 3 ? { content, reasoning_content: 'private final reasoning' }
        : { content: JSON.stringify({ message: '候选已注册并渲染，建议试听后应用。', candidateIds: [id] }) };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    }));
    const reply = await runMusicAgent({ prompt: '音色更柔和', project: structuredClone(initialProject), scope: 'sound', history: [], selection: [] }, { endpoint: upstream, model: 'deepseek-flash', renderer: async () => { renders++; return { basis: 'browser-offline-audio', durationSeconds: 1, sampleRate: 44100, rms: 0.1, peak: 0.3, clippingRatio: 0, spectralCentroidHz: 500, highFrequencyEnergyRatio: 0 }; } }, new AbortController().signal);
    expect(records).toHaveLength(4); expect(renders).toBe(1); expect(reply.candidates).toHaveLength(1);
    expect(reply.candidates[0].project.sound.brightness).toBe(20); expect(reply.candidates[0].metrics?.rms).toBe(0.1);
    expect(records[3].tool_choice).toBe('none'); expect(records[3].messages.at(-2).reasoning_content).toBe('private final reasoning');
    expect(JSON.parse(records[3].messages.at(-1).content).registeredCandidates[0].id).toBe(reply.candidates[0].id);
    expect(reply.trace.events.find(e => e.name === 'validate_final_reply' && e.status === 'error')?.detail).toContain(detail);
    expect(reply.trace.events.filter(e => e.name === 'propose_edit')).toHaveLength(1);
    expect(reply.trace.events.at(-2)?.name).toBe('validate_final_reply'); expect(reply.trace.usage).toEqual({ inputTokens: 400, outputTokens: 200 });
    expect(JSON.stringify(reply)).not.toContain('private final reasoning');
  });
  it('bounds repair attempts and does not accept invented candidate IDs', async () => {
    let calls = 0;
    const upstream = await listen(http.createServer((_, res) => { calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '应用虚构候选', candidateIds: ['candidate-forged'] }) } }] })); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' }));
    const response = await post(url); const reply = await response.json();
    expect(calls).toBe(2); expect(response.status).toBe(400); expect(reply.error).toContain('未在本轮注册');
    expect(reply.trace.events.filter((e: any) => e.name === 'repair_final_reply')).toHaveLength(1);
    expect(reply.trace.events.at(-1).detail).toContain('未在本轮注册');
  });
  it('does not execute new tools in the final reply repair phase', async () => {
    let calls = 0;
    const upstream = await listen(http.createServer((_, res) => {
      calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: calls === 1 ? { content: '普通文本' } : { tool_calls: [{ id: 'forbidden', type: 'function', function: { name: 'propose_edit', arguments: '{}' } }] } }] }));
    }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' }));
    const response = await post(url); const reply = await response.json(); expect(response.status).toBe(400);
    expect(reply.error).toContain('不允许新增工具调用'); expect(reply.trace.events.some((e: any) => e.name === 'propose_edit')).toBe(false);
  });
  it('reports token truncation without executing incomplete tool calls', async () => {
    const upstream = await listen(http.createServer((_, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'private reasoning', tool_calls: [{ id: 'partial', type: 'function', function: { name: 'propose_edit', arguments: '{' } }] } }], usage: { prompt_tokens: 9577, completion_tokens: 3200 } }));
    }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'deepseek-flash' }));
    const response = await post(url); const reply = await response.json();
    expect(response.status).toBe(400); expect(reply.error).toContain('截断');
    expect(reply.trace.events.at(-1).detail).toContain('token 上限');
    expect(reply.trace.events.some((e: any) => e.name === 'propose_edit')).toBe(false);
    expect(reply.trace.usage.outputTokens).toBe(3200); expect(JSON.stringify(reply)).not.toContain('private reasoning');
  });
  it('creates an applicable dreamy chord candidate and preserves DeepSeek reasoning on tool follow-ups', async () => {
    const records: any[] = [];
    const upstream = await listen(http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk; const request = JSON.parse(body); records.push(request);
      const message = records.length === 1 ? { content: null, reasoning_content: 'private tool reasoning', tool_calls: [{ id: 'chords', type: 'function', function: { name: 'propose_edit', arguments: JSON.stringify({ title: '梦幻和弦', explanation: '保留音色，使用大七与九和弦。', baseRevision: 0, operations: [
        { type: 'update_chord', chordId: initialProject.chords[0].id, changes: { name: 'Fmaj7', pitches: [53, 57, 60, 64] } },
        { type: 'update_chord', chordId: initialProject.chords[1].id, changes: { name: 'Cmaj9', pitches: [60, 64, 67, 71, 74] } },
        { type: 'set_layers', values: { harmony: true } },
      ] }) } }] } : { content: JSON.stringify({ message: '候选保留原音色与旋律，尚未渲染。', candidateIds: [JSON.parse(request.messages.find((m: any) => m.role === 'tool').content).candidateId] }) };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: records.length === 1 ? 'tool_calls' : 'stop', message }] }));
    }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'deepseek-flash' }));
    const response = await post(url, { prompt: '用这段音色铺一段具有梦幻感的和弦进行' }); const reply = await response.json();
    expect(response.status).toBe(200); expect(records).toHaveLength(2);
    expect(records[0].thinking).toEqual({ type: 'disabled' }); expect(records[0].max_tokens).toBe(8192);
    expect(records[1].messages.find((m: any) => m.tool_calls)?.reasoning_content).toBe('private tool reasoning');
    expect(reply.candidates).toHaveLength(1); expect(reply.candidates[0].project.sound).toEqual(initialProject.sound);
    expect(reply.candidates[0].project.notes).toEqual(initialProject.notes);
    expect(reply.candidates[0].project.layers.harmony).toBe(true);
    expect(reply.candidates[0].project.chords.map((c: any) => c.name)).toEqual(['Fmaj7', 'Cmaj9']);
    expect(JSON.stringify(reply)).not.toContain('private tool reasoning');
  });
  it('executes tools, corrects a rejected proposal, and returns a scrubbed trace', async () => {
    let step = 0; const records: any[] = []; const candidate = { title: '柔和', explanation: '降低亮度', baseRevision: 0, operations: [{ type: 'set_sound_parameters', values: { brightness: 20 } }] };
    const tool = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const upstream = await listen(http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk; records.push(JSON.parse(body)); step++;
      const message = step === 1 ? { tool_calls: [tool('context', 'get_project_context', {}), tool('analysis', 'analyze_music', {}), tool('bad', 'propose_edit', { ...candidate, operations: [{ type: 'set_sound_parameters', values: { brightness: 999 } }] })] } : step === 2 ? { tool_calls: [tool('good', 'propose_edit', candidate)] } : { content: JSON.stringify({ message: '依据参数做柔和候选', candidateIds: [JSON.parse(records.at(-1).messages.filter((m: any) => m.role === 'tool').at(-1).content).candidateId] }) };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model', apiKey: 'test-only-secret' }));
    const response = await post(url); const reply = await response.json(); expect(response.status).toBe(200); expect(step).toBe(3); expect(records[0].tools.map((t: any) => t.function.name)).toEqual(['get_project_context', 'analyze_music', 'edit_sound', 'propose_edit', 'render_preview', 'compare_candidates', 'compose_candidates', 'plan_creation', 'revise_candidate', 'search_music_knowledge']);
    expect(records[0].thinking).toBeUndefined(); expect(records[0].max_tokens).toBe(3200);
    expect(records[1].messages.filter((m: any) => m.role === 'tool')).toHaveLength(3); expect(reply.trace.events.filter((e: any) => e.name === 'propose_edit').map((e: any) => e.status)).toEqual(['error', 'success']); expect(reply.trace.usage).toEqual({ inputTokens: 300, outputTokens: 150 }); expect(JSON.stringify(reply.trace)).not.toContain('test-only-secret');
  });
  it('bounds repeated tool calls', async () => {
    let count = 0; const upstream = await listen(http.createServer((_, res) => { count++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: `call-${count}`, type: 'function', function: { name: 'analyze_music', arguments: '{}' } }] } }] })); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' })); const response = await post(url); expect(response.status).toBe(400); expect(count).toBe(7); expect((await response.json()).error).toContain('6轮');
  });
  it('checks selection and supports a direct-generation comparison mode', async () => {
    let tools: unknown; const upstream = await listen(http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; tools = JSON.parse(body).tools; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '修改', candidates: [{ title: '越界', explanation: '改全部', patch: { notes: initialProject.notes.map(n => ({ ...n, pitch: 72 })) } }] }) } }] })); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model', executionMode: 'direct' }));
    expect((await post(url, { selection: [0] })).status).toBe(400); expect(tools).toBeUndefined();
    const invalid = await post(url, { selection: [90] }); expect(invalid.status).toBe(400); expect((await invalid.json()).error).toContain('选区无效');
  });
  it('rejects a final locked edit even if the model skips the validation tool', async () => {
    const upstream = await listen(http.createServer((_, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: '修改', candidates: [{ title: '柔和', explanation: '降低亮度', patch: { sound: { brightness: 20 } } }] }) } }] })); }));
    const url = await listen(createApiServer({ endpoint: upstream, model: 'test-model' })); const p = structuredClone(initialProject); p.locks.sound = true; expect((await post(url, { project: p })).status).toBe(400);
  });
});
