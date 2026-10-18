import http from 'node:http';
import { expect, it } from 'vitest';
import { runCreativeSession } from '../services/api/creative-orchestrator';
import { initialProject } from '../src/domain';
import { packet } from './helpers/listening';

it('executes independent real tool-call loops and hands the edited score to the sound loop', async () => {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const context = JSON.parse(body.messages.find((m: any) => m.role === 'user' && m.content.includes('"creationBrief"')).content);
    const registered = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)).find((m: any) => m.candidateId);
    const operation = context.creationBrief.role === 'composition'
      ? { type: 'update_note', noteId: context.project.notes[0].id, changes: { pitch: 72 } }
      : { type: 'set_sound_parameters', values: { brightness: 25 } };
    const message = registered ? { content: JSON.stringify({ message: '独立专业完成', candidateIds: [registered.candidateId] }) }
      : { tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name: 'propose_edit', arguments: JSON.stringify({ title: '专业版本', explanation: '验证执行', baseRevision: context.project.revision, operations: [operation] }) } }] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 30 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const reply = await runCreativeSession({ prompt: '修改音色与旋律，保留节奏', project: structuredClone(initialProject), scope: 'sound', history: [], selection: [], exploration: 'collaborative' }, { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, model: 'test', audioExecutor: async (_c, probes) => probes.map(p => packet(p)) }, new AbortController().signal);
    expect(requests).toHaveLength(4);
    const composition = JSON.parse(requests[0].messages.at(-1).content), sound = JSON.parse(requests[2].messages.at(-1).content);
    expect(composition.creationBrief.role).toBe('composition'); expect(sound.creationBrief.role).toBe('sound');
    expect(sound.project.notes[0].pitch).toBe(72); expect(sound.project.revision).toBe(1);
    expect(requests[2].messages.some((m: any) => m.role === 'tool')).toBe(false);
    expect(requests[0].tools.some((t: any) => t.function.name === 'edit_sound')).toBe(false);
    expect(requests[2].tools.some((t: any) => t.function.name === 'transform_motif')).toBe(false);
    expect(JSON.stringify(requests)).not.toContain('pcm-s16le');
    expect(reply.candidates[0].project.notes[0].pitch).toBe(72);
    expect(reply.candidates[0].project.sound.brightness).toBe(25);
    expect(reply.trace.usage).toEqual({ inputTokens: 400, outputTokens: 120 });
  } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
});
