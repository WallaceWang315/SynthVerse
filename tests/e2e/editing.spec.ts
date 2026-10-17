import { test, expect } from '@playwright/test';
test('expanded synth controls persist and modulation/effects are editable', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible(); await page.getByText('深入设计声音', { exact: false }).click();
  await page.getByRole('checkbox', { name: '启用振荡器 2' }).check(); await page.getByRole('button', { name: '振荡器 2 波表', exact: true }).click(); await page.getByRole('slider', { name: '振荡器 2 波表位置' }).fill('0.7');
  await page.getByRole('tab', { name: '调制', exact: true }).click(); await page.getByRole('button', { name: '添加调制' }).click(); await page.getByRole('combobox', { name: '调制 1 目标' }).selectOption('pitch'); await page.getByRole('slider', { name: '调制 1 深度' }).fill('0.1');
  await page.getByRole('tab', { name: '效果', exact: true }).click(); await page.getByRole('slider', { name: '混响混合' }).fill('0.3'); await expect(page.getByText('已在本机保存')).toBeVisible(); await page.reload();
  await page.getByText('深入设计声音', { exact: false }).click(); await expect(page.getByRole('checkbox', { name: '启用振荡器 2' })).toBeChecked(); await expect(page.getByRole('slider', { name: '振荡器 2 波表位置' })).toHaveValue('0.7');
  await page.getByRole('tab', { name: '效果', exact: true }).click(); await expect(page.getByRole('slider', { name: '混响混合' })).toHaveValue('0.3');
});
test('piano roll moves/resizes notes, supports precise editing, multi-selection and undo', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible(); const note = page.getByTestId('note-1'); await note.scrollIntoViewIfNeeded(); const rect = (await note.boundingBox())!;
  await page.mouse.move(rect.x + 10, rect.y + 8); await page.mouse.down(); await page.mouse.move(rect.x + 42, rect.y - 12, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: '所选音符起点' })).toHaveValue('1.5'); await expect(page.getByRole('spinbutton', { name: '所选音符音高' })).toHaveValue('65');
  const edge = (await page.getByRole('button', { name: '调整音符 2 时长', exact: true }).boundingBox())!; await page.mouse.move(edge.x + 3, edge.y + 7); await page.mouse.down(); await page.mouse.move(edge.x + 35, edge.y + 7, { steps: 4 }); await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: '所选音符时长' })).toHaveValue('1.15'); await page.getByRole('spinbutton', { name: '所选音符力度' }).fill('0.9');
  await page.getByTestId('note-2').click({ modifiers: ['Shift'] }); await expect(page.getByText('已选 2 个音符')).toBeVisible(); await page.getByRole('button', { name: '删除所选', exact: true }).click(); await expect(page.locator('.roll-note')).toHaveCount(6);
  await page.getByRole('button', { name: '撤销上一次修改' }).click(); await expect(page.locator('.roll-note')).toHaveCount(8); await page.getByRole('button', { name: '节奏可修改' }).click(); await page.getByTestId('note-1').click();
  await expect(page.getByRole('spinbutton', { name: '所选音符时长' })).toBeDisabled(); await expect(page.getByRole('spinbutton', { name: '所选音符音高' })).toBeEnabled();
});
test('chord progression is fully manual and exceeds the former two-chord limit', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible(); await expect(page.getByRole('combobox', { name: '和弦根音' })).toHaveValue('60'); await page.getByRole('combobox', { name: '片段小节数' }).selectOption('4');
  await page.getByRole('button', { name: '试试 C → Am → F → G' }).click(); await expect(page.locator('.timeline-chord')).toHaveCount(4);
  await page.getByRole('combobox', { name: '和弦根音' }).selectOption('62'); await page.getByRole('combobox', { name: '和弦性质' }).selectOption('minor'); await page.getByRole('combobox', { name: '和弦转位' }).selectOption('1'); await page.getByRole('spinbutton', { name: '和弦时长' }).fill('2'); await page.getByRole('button', { name: '应用和弦编辑' }).click(); await expect(page.locator('.timeline-chord').first()).toContainText('Dm');
  await page.getByRole('button', { name: '添加和弦' }).click(); await expect(page.locator('.timeline-chord')).toHaveCount(5); await page.getByRole('button', { name: '试听所选和弦' }).click(); await expect(page.getByRole('button', { name: '停止试听' })).toBeVisible(); await page.getByRole('button', { name: '停止试听' }).click();
  await page.getByRole('button', { name: '锁定和弦' }).click(); await expect(page.getByRole('button', { name: '应用和弦编辑' })).toBeDisabled();
});
test('selected demo candidates preserve other notes and show honest execution trace', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible(); await page.getByTestId('note-1').click();
  await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('写一个忧郁旋律动机'); await page.getByRole('button', { name: '发送想法' }).click(); await expect(page.getByRole('heading', { name: '缓缓下落' })).toBeVisible();
  const before = await page.locator('.roll-note').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label'))); await page.locator('.candidate').first().getByRole('button', { name: '应用', exact: true }).click(); const after = await page.locator('.roll-note').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')));
  expect(after[0]).toBe(before[0]); expect(after[2]).toBe(before[2]); expect(after[1]).not.toBe(before[1]); await page.locator('.agent-trace summary').last().click(); await expect(page.getByText('local_rule_demo')).toBeVisible();
});
test('all new synthesis modules render finite differentiated audio in the browser', async ({ page }) => {
  await page.goto('/'); const results = await page.evaluate(async () => {
    const audioPath = '/src/audio.ts'; const domainPath = '/src/domain.ts'; const synthPath = '/src/synth.ts'; const audio = await import(audioPath); const domain = await import(domainPath); const synth = await import(synthPath);
    const variants: any[] = synth.synthPresets.map((p: any) => ({ ...structuredClone(domain.initialProject), sound: { ...structuredClone(domain.initialProject.sound), ...p.patch } }));
    const extra = structuredClone(domain.initialProject); extra.sound.noise = 0.1; extra.sound.sub = 0.2; extra.sound.filters[1].enabled = true; extra.sound.filters[1].type = 'highpass'; extra.sound.filters[1].cutoff = 200; extra.sound.filters[0].envelope = 1; extra.sound.effects = { ...extra.sound.effects, distortion: 0.2, chorus: 0.2, delay: 0.2, reverb: 0.2, phaser: 0.2, flanger: 0.2, eqLow: 2, eqMid: -2, eqHigh: 1 }; extra.sound.modulations = [{ source: 'env2', target: 'cutoff', amount: 0.2 }, { source: 'lfo2', target: 'pan', amount: 0.1 }, { source: 'velocity', target: 'amplitude', amount: 0.1 }]; variants.push(extra);
    const results = []; for (const p of variants) { p.bars = 1; p.notes = p.notes.slice(0, 4).map((n: any) => ({ ...n, duration: 0.4 })); p.chords = []; const buffer = await audio.renderProject(p); const data = buffer.getChannelData(0); let sum = 0; let peak = 0; let finite = true; for (const x of data) { sum += x * x; peak = Math.max(peak, Math.abs(x)); finite &&= Number.isFinite(x); } results.push({ rms: Math.sqrt(sum / data.length), peak, finite }); } return results;
  });
  for (const result of results) { expect(result.finite).toBe(true); expect(result.rms).toBeGreaterThan(0.0001); expect(result.peak).toBeLessThan(1); } expect(new Set(results.map(r => r.rms.toFixed(5))).size).toBe(5);
});
