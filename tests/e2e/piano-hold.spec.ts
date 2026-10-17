import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counts = { starts: 0, stops: 0 }; (window as any).pianoAudio = counts;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { const node = create.call(this); const start = node.start.bind(node), stop = node.stop.bind(node); node.start = (...args) => { counts.starts++; start(...args); }; node.stop = (...args) => { counts.stops++; stop(...args); }; return node; };
  });
  await page.goto('/'); await expect(page.getByText('已在本机保存')).toBeVisible();
});
test('pointer down starts immediately, holding sustains, release outside ends only that note', async ({ page }) => {
  const key = page.getByRole('button', { name: '弹奏 C4', exact: true }); await key.scrollIntoViewIfNeeded(); const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width/2, box.y + box.height*0.8); await page.mouse.down();
  await expect(key).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  await page.waitForTimeout(1000); expect(await page.evaluate(() => (window as any).pianoAudio.stops)).toBe(0);
  await page.mouse.move(20, 20); await page.mouse.up(); await expect(key).toHaveAttribute('aria-pressed', 'false'); expect(await page.evaluate(() => (window as any).pianoAudio.stops)).toBeGreaterThan(0);
});
test('computer keyboard supports chords, repeat suppression and blur release', async ({ page }) => {
  await page.keyboard.down('a'); await page.keyboard.down('s');
  const c = page.getByRole('button', { name: '弹奏 C4', exact: true }), d = page.getByRole('button', { name: '弹奏 D4', exact: true });
  await expect(c).toHaveAttribute('aria-pressed', 'true'); await expect(d).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  const before = await page.evaluate(() => (window as any).pianoAudio.starts); await page.keyboard.down('a'); expect(await page.evaluate(() => (window as any).pianoAudio.starts)).toBe(before);
  await page.keyboard.up('a'); await expect(c).toHaveAttribute('aria-pressed', 'false'); await expect(d).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(d).toHaveAttribute('aria-pressed', 'false'); await page.keyboard.up('s');
});
test('touch cancellation releases captured pointer and text entry does not play', async ({ page }) => {
  const key = page.getByRole('button', { name: '弹奏 C♯4', exact: true });
  await key.scrollIntoViewIfNeeded(); const box = (await key.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width/2, y: box.y + box.height/2, id: 7 }] });
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(key).toHaveAttribute('aria-pressed', 'false'); await session.detach();
  const starts = await page.evaluate(() => (window as any).pianoAudio.starts); await page.getByRole('textbox', { name: '与灵感伙伴对话' }).fill('asdf'); expect(await page.evaluate(() => (window as any).pianoAudio.starts)).toBe(starts);
});
test('actual held audio lasts beyond half a second and follows release, including short attack taps', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const audioPath = '/src/audio.ts', domainPath = '/src/domain.ts'; const { voice } = await import(audioPath), { initialProject } = await import(domainPath);
    async function render(attack: number, heldFor: number) { const ctx = new OfflineAudioContext(1, 44100*3, 44100); const release = voice(ctx, ctx.destination, 60, 0, null, { ...initialProject.sound, attack, release: 0.2 }); release(heldFor); const buffer = await ctx.startRendering(); const values = buffer.getChannelData(0); const rms = (start: number, end: number) => { let sum=0; for(let i=Math.floor(start*44100);i<Math.floor(end*44100);i++) sum+=values[i]**2; return Math.sqrt(sum/((end-start)*44100)); }; return { held: rms(0.8,1.2), after: rms(2,2.5), tap: rms(0.005,0.02) }; }
    return { long: await render(0.015, 1.5), quick: await render(1, 0.025) };
  });
  expect(result.long.held).toBeGreaterThan(0.001); expect(result.long.after).toBeLessThan(0.00001); expect(result.quick.tap).toBeGreaterThan(0.000001);
});
test('focused piano button holds with Space and does not retrigger on keyup', async ({ page }) => {
  const key = page.getByRole('button', { name: '弹奏 C4', exact: true }); await key.focus(); await page.keyboard.down('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  const starts = await page.evaluate(() => (window as any).pianoAudio.starts); await page.keyboard.up('Space'); await expect(key).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(100); expect(await page.evaluate(() => (window as any).pianoAudio.starts)).toBe(starts);
});
test('melody piano keys start on press, sustain and release outside without changing notes', async ({ page }) => {
  const notes = await page.locator('.roll-note').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')));
  const key = page.getByRole('button', { name: '试听音高 C4', exact: true }); await key.scrollIntoViewIfNeeded(); const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2); await page.mouse.down();
  await expect(key).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  await page.waitForTimeout(1000); expect(await page.evaluate(() => (window as any).pianoAudio.stops)).toBe(0);
  await page.mouse.move(box.x+150,box.y); await page.mouse.up(); await expect(key).toHaveAttribute('aria-pressed', 'false'); expect(await page.evaluate(() => (window as any).pianoAudio.stops)).toBeGreaterThan(0);
  expect(await page.locator('.roll-note').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual(notes);
});
test('melody piano keys support Space, touch cancellation and blur cleanup', async ({ page }) => {
  const key = page.getByRole('button', { name: '试听音高 D4', exact: true }); await key.focus(); await page.keyboard.down('Space');
  await expect(key).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => page.evaluate(() => (window as any).pianoAudio.starts)).toBeGreaterThan(0);
  const starts = await page.evaluate(() => (window as any).pianoAudio.starts); await page.keyboard.up('Space'); await expect(key).toHaveAttribute('aria-pressed', 'false'); await page.waitForTimeout(100); expect(await page.evaluate(() => (window as any).pianoAudio.starts)).toBe(starts);
  const box = (await key.boundingBox())!, session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x+box.width/2, y: box.y+box.height/2, id: 9 }] }); await expect(key).toHaveAttribute('aria-pressed', 'true');
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await expect(key).toHaveAttribute('aria-pressed', 'false'); await session.detach();
  await key.focus(); await page.keyboard.down('Enter'); await expect(key).toHaveAttribute('aria-pressed', 'true'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(key).toHaveAttribute('aria-pressed', 'false'); await page.keyboard.up('Enter');
});
