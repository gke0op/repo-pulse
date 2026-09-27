// Renders the avatar page in headless Chromium and saves screenshots of each state.
// Usage: node shoot.mjs <outDir>   (fails loudly on any console error, e.g. a shader compile error)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Served over http like the app does (fetch() can't read file:// URLs, and VRM models are fetched).
const assets = path.resolve(here, '../../app/src/main/assets');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.vrm': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const f = path.join(assets, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!f.startsWith(assets) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const page_url = `http://127.0.0.1:${server.address().port}/avatar/index.html`;
const out = process.argv[2] || '/tmp';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 460 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

const shots = [
  ['machine', 'idle', null],
  ['machine', 'listening', null],
  ['machine', 'thinking', null],
  ['machine', 'speaking', 'speak'],
  ...['happy', 'sad', 'angry', 'surprised', 'curious', 'tender'].map(e => ['machine', 'speaking', 'speak', e]),
  ...['girl', 'boy'].flatMap(c => [
    [c, 'idle', null], [c, 'listening', null], [c, 'thinking', null], [c, 'speaking', 'speak'],
    ...['happy', 'sad', 'angry', 'surprised', 'curious', 'tender'].map(e => [c, 'idle', null, e]),
    ...['happy', 'sad', 'angry', 'surprised', 'curious', 'tender'].map(e => [c, 'idle', null, e, 'B']),
  ]),
];
for (const [char, state, action, emo, profile] of shots) {
  await page.goto(`${page_url}?char=${char}&state=${state}&t=7${emo ? `&emo=${emo}` : ''}${profile ? `&profile=${profile}` : ''}`);
  await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(2500); // let the state blend settle
  if (action === 'speak') {
    await page.evaluate(() => avatar.speak(Array.from({ length: 200 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.4)), 20, 0));
    await page.waitForTimeout(430);
  }
  const file = path.join(out, `avatar-${char}-${state}${emo ? '-' + emo : ''}${profile ? '-' + profile : ''}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  (function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); })();
}));
console.log('fps (swiftshader, CPU-rendered):', fps.toFixed(1));
await browser.close();
server.close();
if (errors.length) { console.error('CONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
