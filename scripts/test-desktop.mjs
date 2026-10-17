import { _electron as electron, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const dataDir = path.resolve('.artifacts', `desktop-smoke-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const provider = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
  assert.equal(req.headers.authorization, 'Bearer desktop-test-secret');
  let message;
  if (body.tools?.[0]?.function?.name === 'connection_check') message = { tool_calls: [{ id: 'probe', type: 'function', function: { name: 'connection_check', arguments: '{}' } }] };
  else {
    const result = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).find(m => m.accepted);
    const context = JSON.parse(body.messages.findLast(m => m.role === 'user' && m.content.includes('"project"')).content);
    message = result ? { content: JSON.stringify({ message: '桌面模型工具调用成功。', candidateIds: [result.candidateId] }) } : { tool_calls: [{ id: 'edit', type: 'function', function: { name: 'propose_edit', arguments: JSON.stringify({ title: '桌面测试候选', explanation: '降低明亮度', baseRevision: context.project.revision, operations: [{ type: 'set_sound_parameters', values: { brightness: 25 } }] }) } }] };
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
const executablePath = path.resolve(process.env.SYNTHVERSE_TEST_EXECUTABLE || 'release/win-unpacked/SynthVerse.exe');
const launch = () => electron.launch({ executablePath, env: { ...process.env, SYNTHVERSE_TEST_DATA_DIR: dataDir }, timeout: 30000 });
let app;
try {
  app = await launch(); let page = await app.firstWindow();
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByLabel('调性主音', { exact: true }).selectOption('2'); await page.getByLabel('调式', { exact: true }).selectOption('minor'); await page.getByRole('button', { name: '应用调性' }).click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByLabel('模型 API 地址')).toBeEnabled();
  await page.getByLabel('模型 API 地址').fill(endpoint); await page.getByLabel('模型名称', { exact: true }).fill('desktop-test'); await page.getByLabel('模型 API Key').fill('desktop-test-secret');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(page.getByRole('status')).toContainText('模型已返回工具调用');
  await page.getByRole('button', { name: '保存并使用' }).click(); await expect(page.getByRole('status')).toContainText('配置已保存');
  assert.equal((await readFile(path.join(dataDir, 'model-settings.json'), 'utf8')).includes('desktop-test-secret'), false);
  const publicConfig = await page.evaluate(async () => (await fetch('/api/model-settings')).text()); assert.equal(publicConfig.includes('desktop-test-secret'), false);
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色柔和一点'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.getByRole('heading', { name: '桌面测试候选' })).toBeVisible({ timeout: 15000 });
  await page.locator('.candidate').first().getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.screenshot({ path: path.join(dataDir, 'desktop.png') });
  await app.close(); app = await launch(); page = await app.firstWindow();
  await expect(page.getByLabel('调式', { exact: true })).toHaveValue('minor');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('desktop-test');
  await expect(page.getByLabel('模型 API Key')).toHaveValue('');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(page.getByRole('status')).toContainText('模型已返回工具调用');
  await page.getByRole('button', { name: '清除配置' }).click(); await expect(page.getByRole('status')).toContainText('已清除连接');
  const cleared = JSON.parse(await readFile(path.join(dataDir, 'model-settings.json'), 'utf8')); assert.equal(cleared.encryptedKey, undefined);
  console.log(JSON.stringify({ passed: true, packagedApp: true, checks: ['startup', 'tool-connection', 'encrypted-secret', 'agent-candidate', 'persistent-music', 'restart-decryption', 'clear-key'], dataDir }));
} finally { if (app) await app.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
