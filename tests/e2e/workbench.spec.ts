import { test, expect } from '@playwright/test';

test('dialogue candidate, preview, apply, undo, save and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色再柔和一点，保留起音');
  await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.getByRole('heading', { name: '柔和的轮廓' })).toBeVisible();
  const card = page.locator('.candidate').filter({ has: page.getByRole('heading', { name: '柔和的轮廓' }) });
  await card.getByRole('button', { name: '试听', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止试听' })).toBeVisible();
  await page.getByRole('button', { name: '停止试听' }).click();
  await card.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('24');
  await page.getByRole('button', { name: '撤销上一次修改' }).click();
  await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('42');
  await page.getByRole('button', { name: '重做上一次修改' }).click();
  await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('24');
  await page.getByRole('button', { name: '撤销上一次修改' }).click();
  await page.getByRole('slider', { name: '明亮度' }).fill('30');
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.reload(); await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('30');
  expect(errors).toEqual([]);
});

test('locked sound, project import validation and downloadable MIDI/WAV', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByRole('button', { name: '音色可修改' }).click();
  await expect(page.getByRole('slider', { name: '明亮度' })).toBeDisabled();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色更柔和'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.getByText('当前锁定或选区限制阻止了候选修改。', { exact: false })).toBeVisible(); await expect(page.locator('.candidate')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole('status')).toContainText('工程格式或版本无效');
  for (const [label, suffix] of [['音乐片段 · MIDI', '.mid'], ['试听音频 · WAV', '.wav']]) {
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const wait = page.waitForEvent('download'); await page.getByRole('button', { name: label }).click(); const file = await wait;
    expect(file.suggestedFilename()).toContain(suffix); expect(await file.failure()).toBeNull();
  }
});

test('actual browser render produces finite non-silent stereo audio', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const audioPath = '/src/audio.ts'; const domainPath = '/src/domain.ts'; const audio = await import(audioPath); const domain = await import(domainPath);
    const project = structuredClone(domain.initialProject); project.layers.harmony = true; project.layers.bass = true;
    const buffer = await audio.renderProject(project); const data = buffer.getChannelData(0);
    let peak = 0; let sum = 0; let finite = true;
    for (const value of data) { finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value)); sum += value * value; }
    return { channels: buffer.numberOfChannels, duration: buffer.duration, peak, rms: Math.sqrt(sum / data.length), finite };
  });
  expect(result.channels).toBe(2); expect(result.finite).toBe(true); expect(result.duration).toBeGreaterThan(4);
  expect(result.peak).toBeGreaterThan(0.01); expect(result.peak).toBeLessThan(1); expect(result.rms).toBeGreaterThan(0.001);
});

test('mobile layout and gateway validation', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('textbox', { name: '与灵感伙伴对话' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const response = await request.post('/api/chat', { data: { prompt: 'hello', project: { version: 99 } } });
  expect(response.status()).toBe(400);
  const blocked = await request.get('/api/status', { headers: { Origin: 'https://untrusted.example' } }); expect(blocked.status()).toBe(403);
});
