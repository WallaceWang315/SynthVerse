import { test, expect } from '@playwright/test';
test('drawing, duplication, lasso and keyboard delete operate on real notes', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.locator('.roll-scroller').scrollIntoViewIfNeeded(); await page.locator('.roll-scroller').evaluate(el => { el.scrollTop = 240; });
  const grid = (await page.getByTestId('roll-grid').boundingBox())!;
  await page.mouse.move(grid.x + 80, grid.y + 19 * 20 + 10); await page.mouse.down(); await page.mouse.move(grid.x + 128, grid.y + 19 * 20 + 10, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.roll-note')).toHaveCount(9); await expect(page.getByRole('spinbutton', { name: '所选音符音高' })).toHaveValue('65');
  await page.getByRole('button', { name: '复制到后面' }).click(); await expect(page.locator('.roll-note')).toHaveCount(10);
  await page.getByRole('button', { name: '框选', exact: true }).click();
  await page.locator('.roll-scroller').scrollIntoViewIfNeeded(); await page.locator('.roll-scroller').evaluate(el => { el.scrollTop = 240; });
  const bounds = (await page.getByTestId('roll-grid').boundingBox())!;
  await page.mouse.move(bounds.x + 110, bounds.y + 17 * 20 - 2); await page.mouse.down(); await page.mouse.move(bounds.x + 390, bounds.y + 18 * 20, { steps: 5 }); await page.mouse.up();
  await expect(page.getByText('已选 2 个音符')).toBeVisible();
  await page.getByRole('application', { name: '钢琴卷帘编辑器' }).press('Delete'); await expect(page.locator('.roll-note')).toHaveCount(8);
  await page.getByRole('button', { name: '撤销上一次修改' }).click(); await expect(page.locator('.roll-note')).toHaveCount(10);
});
test('disabling all sources silences the synth even with the glass macro raised', async ({ page }) => {
  await page.goto('/'); const rms = await page.evaluate(async () => {
    const audioPath = '/src/audio.ts'; const domainPath = '/src/domain.ts'; const audio = await import(audioPath); const domain = await import(domainPath);
    const project = structuredClone(domain.initialProject); project.sound.oscillators.forEach((o: { enabled: boolean }) => { o.enabled = false; }); project.sound.glass = 100; project.sound.sub = 0; project.sound.noise = 0;
    const buffer = await audio.renderProject(project); return Math.max(...buffer.getChannelData(0).subarray(0, 10000).map(Math.abs));
  }); expect(rms).toBeLessThan(0.000001);
});
