import { test, expect } from '@playwright/test';

async function load(page: import('@playwright/test').Page) {
  await page.goto('/'); await expect(page.locator('.save-status')).toHaveText('已在本机保存');
}
async function saved(page: import('@playwright/test').Page) {
  return page.evaluate(async () => { const path = '/src/storage.ts'; return (await import(path)).loadWorkspace(); });
}

test('three visible oscillator cards track waveform and wavetable position and persist', async ({ page }) => {
  await load(page);
  await expect(page.getByRole('group', { name: '振荡器 3 波形', exact: true })).toBeVisible();
  const wave = page.getByTestId('oscillator-wave-1'); const original = await wave.getAttribute('points');
  await page.getByRole('button', { name: '振荡器 1 正弦', exact: true }).click();
  await expect(page.getByRole('button', { name: '振荡器 1 正弦', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await wave.getAttribute('points')).not.toBe(original);
  await page.getByRole('checkbox', { name: '启用振荡器 2' }).check();
  await page.getByRole('button', { name: '振荡器 2 波表', exact: true }).click();
  const table = page.getByTestId('oscillator-wave-2'); const before = await table.getAttribute('points');
  await page.getByRole('combobox', { name: '振荡器 2 波表', exact: true }).selectOption('vowel');
  await page.getByRole('slider', { name: '振荡器 2 波表位置' }).fill('0.8');
  expect(await table.getAttribute('points')).not.toBe(before);
  await expect.poll(async () => (await saved(page)).project.sound.oscillators[1].position).toBe(0.8);
  await page.screenshot({ path: '.artifacts/oscillator-cards.png', fullPage: true });
  await page.reload(); await expect(page.getByRole('button', { name: '振荡器 1 正弦', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '音色可修改' }).click();
  await expect(page.getByRole('button', { name: '振荡器 1 方波', exact: true })).toBeDisabled();
});

test('double-click chord opens piano, presets update notes, drag/delete and apply preserve melody', async ({ page }) => {
  await load(page); const before = (await saved(page)).project;
  await page.locator('.timeline-chord').first().dblclick();
  const dialog = page.getByRole('dialog', { name: '和弦构成音编辑器' }); await expect(dialog).toBeVisible();
  await expect(dialog.locator('.voicing-note')).toHaveCount(4);
  await dialog.getByRole('combobox', { name: '构成音和弦性质' }).selectOption('minor');
  await expect(dialog.getByTestId('chord-note-63')).toBeVisible(); await expect(dialog.locator('.voicing-note')).toHaveCount(3);
  await dialog.getByRole('button', { name: '添加构成音 B4', exact: true }).click();
  await expect(dialog.locator('.voicing-note')).toHaveCount(4);
  const note = dialog.getByTestId('chord-note-67'); await note.scrollIntoViewIfNeeded(); const rect = (await note.boundingBox())!;
  await page.mouse.move(rect.x + 25, rect.y + 8); await page.mouse.down(); await page.mouse.move(rect.x + 25, rect.y - 16, { steps: 4 }); await page.mouse.up();
  await expect(dialog.getByTestId('chord-note-68')).toBeVisible();
  await dialog.getByTestId('chord-note-71').focus(); await page.keyboard.press('Delete');
  await expect(dialog.locator('.voicing-note')).toHaveCount(3);
  await page.screenshot({ path: '.artifacts/chord-piano.png' });
  await dialog.getByRole('button', { name: '应用构成音', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await saved(page)).project.chords[0].pitches).toEqual([60, 63, 68]);
  const after = (await saved(page)).project; expect(after.notes).toEqual(before.notes); expect(after.chords[1]).toEqual(before.chords[1]); expect(after.layers.harmony).toBe(true);
  await page.getByRole('button', { name: '撤销上一次修改' }).click();
  await expect.poll(async () => (await saved(page)).project.chords[0].pitches).toEqual(before.chords[0].pitches);
  await page.locator('.timeline-chord').nth(1).focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox', { name: '构成音根音' })).toHaveValue('57');
  await expect(dialog.getByRole('combobox', { name: '构成音和弦性质' })).toHaveValue('min7');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
});

test('mobile chord editor can cancel, keeps minimum notes, respects harmony lock and fits screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const original = (await saved(page)).project.chords;
  await page.getByRole('button', { name: '在钢琴窗口编辑构成音' }).click();
  const dialog = page.getByRole('dialog', { name: '和弦构成音编辑器' });
  await dialog.getByRole('combobox', { name: '构成音和弦性质' }).selectOption('major');
  await dialog.getByTestId('chord-note-60').focus(); await page.keyboard.press('Delete');
  await expect(dialog.getByRole('status')).toContainText('3–6'); await expect(dialog.locator('.voicing-note')).toHaveCount(3);
  const key = dialog.getByRole('button', { name: '试听和弦音高 C4', exact: true }); await key.scrollIntoViewIfNeeded();
  const rect = (await key.boundingBox())!; await page.mouse.move(rect.x + 5, rect.y + 5); await page.mouse.down(); await expect(key).toHaveAttribute('aria-pressed', 'true'); await page.mouse.up(); await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: '.artifacts/chord-piano-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect((await saved(page)).project.chords).toEqual(original);
  await page.getByRole('button', { name: '锁定和弦' }).click();
  await page.getByRole('button', { name: '在钢琴窗口编辑构成音' }).click();
  await expect(dialog.getByRole('button', { name: '应用构成音', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: '构成音和弦性质' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});
