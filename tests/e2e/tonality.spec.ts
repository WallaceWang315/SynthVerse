import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByText('已在本机保存')).toBeVisible();
});

test('changes melody and harmony together, persists and supports undo', async ({ page }) => {
  await page.getByLabel('调性主音', { exact: true }).selectOption('2');
  await page.getByLabel('调式', { exact: true }).selectOption('minor');
  await page.getByRole('button', { name: '应用调性' }).click();
  await expect(page.getByTestId('note-0')).toHaveAttribute('aria-label', /D4/);
  await expect(page.getByRole('button', { name: '编辑和弦 1 Dm7', exact: true })).toBeVisible();
  await expect(page.locator('.context-strip')).toContainText('D 自然小调');
  await page.getByRole('button', { name: '撤销上一次修改' }).click();
  await expect(page.getByTestId('note-0')).toHaveAttribute('aria-label', /C4/);
  await expect(page.getByLabel('调式', { exact: true })).toHaveValue('major');
  await page.getByRole('button', { name: '重做上一次修改' }).click();
  await expect(page.getByText('已在本机保存')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('调式', { exact: true })).toHaveValue('minor');
  await expect(page.getByTestId('note-0')).toHaveAttribute('aria-label', /D4/);
});

test('locked harmony blocks conversion but allows reference-only changes', async ({ page }) => {
  await page.getByRole('button', { name: '锁定和弦' }).click();
  await page.getByLabel('调性主音', { exact: true }).selectOption('9');
  await page.getByLabel('调式', { exact: true }).selectOption('dorian');
  await expect(page.getByRole('button', { name: '应用调性' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '同步转换已有音符' }).uncheck();
  await page.getByRole('button', { name: '应用调性' }).click();
  await expect(page.getByTestId('note-0')).toHaveAttribute('aria-label', /C4/);
  await expect(page.getByRole('button', { name: '编辑和弦 1 Cmaj7', exact: true })).toBeVisible();
  await expect(page.locator('.context-strip')).toContainText('A 多利亚');
});
