import { test, expect } from '@playwright/test';

async function workspace(page: import('@playwright/test').Page) {
  return page.evaluate(async () => { const path = '/src/storage.ts'; return (await import(path)).loadWorkspace(); });
}

test('title can delete its final character, rename, cancel and save a blank title safely', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
  const title = page.getByRole('textbox', { name: '创意名称' });
  await title.fill('字'); await title.press('End'); await title.press('Backspace');
  await expect(title).toHaveValue('');
  await title.fill('新的音乐想法'); await title.press('Enter');
  await expect.poll(async () => (await workspace(page)).project.title).toBe('新的音乐想法');
  await title.fill('取消这次改名'); await title.press('Escape'); await expect(title).toHaveValue('新的音乐想法');
  await title.fill(''); await title.press('Tab'); await expect(title).toHaveValue('未命名想法');
  await expect.poll(async () => (await workspace(page)).project.title).toBe('未命名想法');
  await page.reload(); await expect(title).toHaveValue('未命名想法');
});

test('new blank idea resets music, preserves the previous idea and supports undo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.locator('.save-status')).toHaveText('已在本机保存');
  const title = page.getByRole('textbox', { name: '创意名称' });
  await title.fill('值得保留的想法'); await title.press('Enter');
  await expect.poll(async () => (await workspace(page)).project.title).toBe('值得保留的想法');
  const before = (await workspace(page)).project;
  await page.getByRole('button', { name: '新建空白想法', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(title).toHaveValue('未命名想法');
  await expect.poll(async () => {
    const saved = await workspace(page);
    return { notes: saved.project.notes.length, chords: saved.project.chords.length, backup: saved.shelf[0]?.project.title };
  }).toEqual({ notes: 0, chords: 0, backup: '值得保留的想法' });
  const blank = (await workspace(page)).project;
  expect(blank.locks).toEqual({ sound: false, rhythm: false, harmony: false });
  expect(blank.layers).toEqual({ melody: true, harmony: false, bass: false });
  await expect(page.getByText('新的空白想法已准备好。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '撤销上一次修改' }).click();
  await expect(title).toHaveValue('值得保留的想法');
  await expect.poll(async () => (await workspace(page)).project.notes).toEqual(before.notes);
  await page.getByRole('button', { name: '重做上一次修改' }).click();
  await expect.poll(async () => (await workspace(page)).project.notes.length).toBe(0);
  await page.reload(); await expect(title).toHaveValue('未命名想法');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '创意收藏', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await expect(title).toHaveValue('值得保留的想法');
});
