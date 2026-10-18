import { expect } from '@playwright/test';
import { test } from './demo-fixture';

test('shows role boundaries and candidate provenance for a local demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('已在本机保存')).toBeVisible();
  const input = page.getByRole('textbox', { name: '与灵感伙伴对话' });
  await input.fill('保留旋律，让音色柔和一点');
  await expect(page.locator('.creative-role-control')).toContainText('音色设计 · 可修改：音色');
  await page.getByRole('button', { name: '发送想法' }).click();
  const card = page.locator('.candidate').first();
  await expect(card).toBeVisible();
  await card.locator('.candidate-provenance summary').click();
  await expect(card.locator('.candidate-provenance')).toContainText('来源工程版本');
  await expect(card.locator('.candidate-provenance')).toContainText('0 个旋律音符');
  await expect(card.locator('.candidate-provenance')).toContainText('保留旋律，让音色柔和一点');
});

test('explicit chord intent overrides sound panel and manual direction stays bounded', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('用这段音色铺一段梦幻的和弦进行');
  await expect(page.locator('.creative-role-control')).toContainText('旋律与和声');
  await expect(page.locator('.creative-role-control small')).not.toContainText('可修改：音色');
  await page.getByRole('combobox', { name: '本次工作方向' }).selectOption('coordinator');
  await expect(page.locator('.creative-role-control')).toContainText('创作统筹');
  await expect(page.locator('.creative-role-control small')).not.toContainText('可修改：音色');
});
