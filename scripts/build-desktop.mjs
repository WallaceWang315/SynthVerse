import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
await build({ entryPoints: ['desktop/main.ts'], outfile: 'desktop-dist/main.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], define: { 'import.meta.url': '"synthverse-bundled-main"' } });
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['SynthVerse third-party software notices. Electron/Chromium notices are shipped alongside the executable.'];
for (const [directory, info] of Object.entries(lock.packages)) {
  if (!directory || info.dev) continue;
  const files = (await readdir(directory)).filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file));
  if (!files.length) throw new Error(`Missing license for ${directory}`);
  for (const file of files) notices.push(`${directory.replace(/^node_modules\//, '')} ${info.version}\n\n${await readFile(path.join(directory, file), 'utf8')}`);
}
await writeFile('desktop-dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n========================================\n\n'));
