import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, stat, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const folder = path.resolve('.artifacts', `portable-launch-${Date.now()}`);
await mkdir(folder, { recursive: true });
const executable = path.join(folder, 'SynthVerse.exe');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await copyFile(`release/SynthVerse-${version}-Windows-x64-portable.exe`, executable);
const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SYNTHVERSE_TEST_DATA_DIR;
const child = spawn(executable, [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) }); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Portable launcher did not expose the application debug endpoint');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0]; let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page');
  await expect(page.getByText('已在本机保存')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByLabel('模型 API 地址')).toBeEnabled();
  await expect(page.getByLabel('模型 API Key')).toHaveValue('');
  await page.screenshot({ path: path.join(folder, 'portable-settings.png') });
  if (!(await stat(path.join(folder, 'SynthVerse-data'))).isDirectory()) throw new Error('Portable data folder missing');
  console.log(JSON.stringify({ passed: true, portableLauncher: true, defaultDataLocation: true, cleanSettings: true, folder }));
} finally {
  if (browser) {
    const session = await browser.newBrowserCDPSession();
    // Closing Electron can disconnect CDP before the command's response arrives.
    await Promise.race([session.send('Browser.close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (browser.isConnected()) await browser.close();
  }
  child.kill();
}
