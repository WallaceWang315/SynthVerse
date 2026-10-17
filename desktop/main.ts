import { app, BrowserWindow, dialog, Menu, net, protocol, safeStorage, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApiServer } from '../services/api/server';
import { parseSettings, type ModelConfig, type SettingsStore } from '../services/api/model-settings';

protocol.registerSchemesAsPrivileged([{ scheme: 'synthverse', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const dataDir = process.env.SYNTHVERSE_TEST_DATA_DIR || path.join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()), 'SynthVerse-data');
app.setPath('userData', dataDir);
let window: BrowserWindow | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  void start().catch(() => { dialog.showErrorBox('SynthVerse 启动失败', '无法启动应用。请将应用放入可写目录，并检查 SynthVerse-data 数据目录的权限。'); app.exit(1); });
}

async function start() {
  await mkdir(dataDir, { recursive: true });
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const configPath = path.join(dataDir, 'model-settings.json');
  let config: ModelConfig = {}, warning = '';
  try {
    const stored = JSON.parse(await readFile(configPath, 'utf8'));
    if (stored.endpoint && stored.model) config = parseSettings({ endpoint: stored.endpoint, model: stored.model }, {});
    if (stored.encryptedKey) {
      try { config.apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64')); }
      catch { warning = '无法解密旧 Key（例如更换了电脑或账户），请重新填写并保存。'; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warning = '原模型设置无法读取，请重新填写；音乐工程未受影响。'; }
  const store: SettingsStore = {
    storage: 'API Key 由 Windows 当前账户加密保存。应用和 SynthVerse-data 可一起移动；换电脑后请重新填写 Key。', warning,
    save: async next => {
      if (next.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable');
      const persisted = { endpoint: next.endpoint ?? '', model: next.model ?? '', encryptedKey: next.apiKey ? safeStorage.encryptString(next.apiKey).toString('base64') : undefined };
      await writeFile(`${configPath}.tmp`, JSON.stringify(persisted), { mode: 0o600 });
      await rename(`${configPath}.tmp`, configPath);
    },
  };
  const token = randomUUID();
  const server = createApiServer({ ...config, settingsStore: store, desktopToken: token, allowedOrigins: ['synthverse://app'] });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  app.on('before-quit', () => { server.closeAllConnections(); server.close(); });
  const root = path.join(app.getAppPath(), 'dist');
  protocol.handle('synthverse', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Forbidden', { status: 403 });
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers); headers.set('x-synthverse-desktop', token); headers.delete('host');
      try { return await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { method: request.method, headers, signal: request.signal, redirect: 'error', ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: await request.arrayBuffer() }) }); }
      catch { return Response.json({ error: '本地服务无法连接。' }, { status: 503 }); }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let file: string;
    try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650, backgroundColor: '#181c1b', title: 'SynthVerse', show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('synthverse://app/')) event.preventDefault(); });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL('synthverse://app/');
}
