import { test, expect } from '@playwright/test';
test('actual render feedback, explicit references, goals and preferences survive reload', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByText('本次目标与参考', { exact: false }).click();
  await page.getByRole('textbox', { name: '本次创作目标' }).fill('保留起音，探索玻璃质感');
  await page.getByRole('textbox', { name: '创作偏好' }).fill('柔和，保留节奏');
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色柔和一点'); await page.getByRole('button', { name: '发送想法' }).click();
  const candidate = page.locator('.candidate').first(); await expect(candidate.locator('.audio-metrics')).toContainText('实测前 2 小节');
  await candidate.getByRole('button', { name: '继续 柔和的轮廓', exact: true }).click(); await expect(page.getByRole('checkbox', { name: '参考 柔和的轮廓', exact: true })).toBeChecked();
  await expect(page.getByText('已在本机保存')).toBeVisible(); await page.reload(); await page.getByText('本次目标与参考', { exact: false }).click();
  await expect(page.getByRole('textbox', { name: '本次创作目标' })).toHaveValue('保留起音，探索玻璃质感'); await expect(page.getByRole('textbox', { name: '创作偏好' })).toHaveValue('柔和，保留节奏'); await expect(page.getByRole('checkbox', { name: '参考 柔和的轮廓', exact: true })).toBeVisible();
});
test('manual edit cancels a pending Agent job and preserves the new edit', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.route('**/api/runs/*', async route => { if (route.request().method() === 'GET') { await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue().catch(() => {}); } else await route.continue(); });
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色柔和一点'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect(page.getByRole('button', { name: '取消生成' })).toBeVisible(); await page.getByRole('slider', { name: '明亮度' }).fill('30');
  await expect(page.getByRole('button', { name: '取消生成' })).toHaveCount(0); await expect(page.getByRole('slider', { name: '明亮度' })).toHaveValue('30'); await expect(page.locator('.candidate')).toHaveCount(0);
});
