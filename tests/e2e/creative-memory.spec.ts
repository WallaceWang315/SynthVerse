import { test, expect } from '@playwright/test';
async function saved(page: import('@playwright/test').Page) {
  return page.evaluate(async () => { const path = '/src/storage.ts'; return (await import(path)).loadWorkspace(); });
}
test('explicit feedback and preferences persist independently and new ideas clear only session memory', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/'); await expect(page.locator('.save-status')).toHaveText('已在本机保存');
  await page.getByText('本次目标与参考', { exact: false }).click();
  await page.getByRole('checkbox', { name: '双方案比较与改进' }).check();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色柔和一点'); await page.getByRole('button', { name: '发送想法' }).click();
  const candidate = page.locator('.candidate').first(); await expect(candidate).toBeVisible();
  await candidate.getByText('比较依据与反馈', { exact: false }).click();
  await candidate.getByRole('textbox', { name: '反馈 柔和的轮廓' }).fill('喜欢较短的尾音');
  await candidate.getByRole('button', { name: '喜欢这个方向' }).click();
  await expect.poll(async () => (await saved(page)).feedback[0]?.note).toBe('喜欢较短的尾音');
  expect((await saved(page)).preferences).toEqual([]);
  await candidate.getByRole('button', { name: '记住这条偏好' }).click();
  await expect.poll(async () => (await saved(page)).preferences).toEqual(['喜欢较短的尾音']);
  await page.reload(); await page.getByText('本次目标与参考', { exact: false }).click();
  await expect(page.getByRole('checkbox', { name: '双方案比较与改进' })).toBeChecked();
  await expect(page.getByText('喜欢 · 柔和的轮廓：喜欢较短的尾音')).toBeVisible();
  await page.getByRole('button', { name: '删除反馈 柔和的轮廓' }).click();
  await expect.poll(async () => (await saved(page)).feedback.length).toBe(0);
  await page.getByRole('button', { name: '新建空白想法', exact: true }).click();
  await expect.poll(async () => (await saved(page)).project.notes.length).toBe(0);
  expect((await saved(page)).preferences).toEqual(['喜欢较短的尾音']); expect((await saved(page)).archive).toEqual([]);
  await page.getByRole('textbox', { name: '创作偏好' }).fill(''); await page.getByRole('textbox', { name: '创作偏好' }).press('Tab');
  await expect.poll(async () => (await saved(page)).preferences.length).toBe(0);
});

test('recent candidates and explicit feedback are sent on continuation and automatic references can be disabled', async ({ page }) => {
  let online = false; const requests: any[] = [];
  await page.route('**/api/status', route => route.fulfill({ status: online ? 200 : 503, contentType: 'application/json', body: JSON.stringify({ mode: 'model', model: 'intercepted-test' }) }));
  await page.route('**/api/runs', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 503, body: '{}' }); });
  await page.goto('/'); await expect(page.locator('.save-status')).toHaveText('已在本机保存');
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('音色柔和一点'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect.poll(async () => (await saved(page)).archive.length).toBe(2);
  online = true; await page.reload(); await expect(page.getByText('intercepted-test', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('继续第二版，缩短尾音'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect.poll(() => requests.length).toBe(1); expect(requests[0].parents).toHaveLength(2);
  expect(requests[0].parents[1].title).toBe('另一种质感');
  await page.getByText('本次目标与参考', { exact: false }).click(); await page.getByRole('checkbox', { name: '自动引用最近候选' }).uncheck();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('不带参考解释'); await page.getByRole('button', { name: '发送想法' }).click();
  await expect.poll(() => requests.length).toBe(2); expect(requests[1].parents).toEqual([]);
});
