import { expect } from '@playwright/test';
import { test } from './demo-fixture';

test('renders comparable audio evidence and keeps the original music unchanged', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.locator('.listening-controls summary').click();
  await page.getByRole('combobox', { name: '探索执行方式' }).selectOption('listening');
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('保留旋律，让音色柔和一点');
  await page.getByRole('button', { name: '发送想法' }).click();
  const card = page.locator('.candidate').first(); await expect(card).toBeVisible({ timeout: 90000 });
  await card.locator('.listening-evidence summary').click();
  await expect(card.locator('.listening-evidence')).toContainText('没有完成音频模型理解');
  await expect(card.getByRole('combobox', { name: /试听素材/ })).toBeVisible();
  await card.getByRole('combobox', { name: /试听素材/ }).selectOption('staccato');
  await expect(card.locator('.listening-evidence')).toContainText('使用相同演奏配置');
  await expect(card.locator('audio')).toHaveCount(2);
  await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('42');
  const archive = await page.evaluate(async () => { const path = '/src/storage.ts'; const { loadWorkspace } = await import(path); return (await loadWorkspace()).archive; });
  expect(archive[0].listening.clips).toHaveLength(4); expect(archive[0].listening.status).toBe('signal-only');
  expect(JSON.stringify(archive)).not.toContain('pcm-s16le');
});

test('collaborative mode runs both specialists and records their contributions', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.locator('.listening-controls summary').click();
  await page.getByRole('combobox', { name: '探索执行方式' }).selectOption('collaborative');
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('调整音色和旋律，保留节奏');
  await page.getByRole('button', { name: '发送想法' }).click();
  const card = page.locator('.candidate').first(); await expect(card).toBeVisible({ timeout: 90000 });
  await card.locator('.listening-evidence summary').click();
  await expect(card.locator('.listening-evidence')).toContainText('专业阶段已完成');
  await expect(card.locator('.listening-evidence')).toContainText('音色设计');
  await expect(card.locator('.listening-evidence')).toContainText('旋律与和声');
  await card.getByRole('button', { name: '继续调整音色' }).click();
  await expect(page.getByRole('combobox', { name: '本次工作方向' })).toHaveValue('sound');
  await expect(page.getByRole('textbox', { name: '与灵感伙伴对话' })).toContainText('保留旋律与和弦');
});

test('standard probes are reproducible within the same browser runtime', async ({ page }) => {
  test.setTimeout(120000); await page.goto('/');
  const result = await page.evaluate(async () => {
    const audioPath = '/src/listening-audio.ts', domainPath = '/src/domain.ts';
    const { renderProbes } = await import(audioPath), { initialProject } = await import(domainPath);
    const a = await renderProbes(initialProject, ['staccato'], new AbortController().signal);
    const b = await renderProbes(initialProject, ['staccato'], new AbortController().signal);
    const left = new DataView(Uint8Array.from(atob(a[0].audio.data), c => c.charCodeAt(0)).buffer), right = new DataView(Uint8Array.from(atob(b[0].audio.data), c => c.charCodeAt(0)).buffer);
    let maxDelta = 0, squares = 0; for (let i = 0; i < left.byteLength; i += 2) { const delta = (left.getInt16(i, true) - right.getInt16(i, true)) / 32768; maxDelta = Math.max(maxDelta, Math.abs(delta)); squares += delta * delta; }
    return { sameConfig: a[0].configId === b[0].configId, maxDelta, rmsDelta: Math.sqrt(squares / (left.byteLength / 2)), rms: a[0].metrics.rms };
  });
  await test.info().attach('repeat-render-difference', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.sameConfig).toBe(true); expect(result.rmsDelta).toBeLessThan(0.0001); expect(result.maxDelta).toBeLessThan(0.001); expect(result.rms).toBeGreaterThan(0);
});

test('local audio settings are independent, reject cloud endpoints and can be cleared', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.locator('.audio-model-settings summary').click();
  await page.getByRole('textbox', { name: '音频分析地址' }).fill('https://example.com/analyze');
  await page.getByRole('textbox', { name: '音频模型名称' }).fill('test-local');
  await page.getByRole('button', { name: '保存音频设置' }).click();
  await expect(page.locator('.audio-model-settings [role=status]')).toContainText('仅支持本机');
  await page.getByRole('textbox', { name: '音频分析地址' }).fill('http://127.0.0.1:9998/analyze');
  await page.getByRole('button', { name: '保存音频设置' }).click();
  await expect(page.locator('.audio-model-settings [role=status]')).toContainText('尚未验证模型听觉能力');
  await page.getByRole('button', { name: '关闭并清除音频配置' }).click();
  await expect(page.locator('.audio-model-settings [role=status]')).toContainText('已关闭音频模型');
});
