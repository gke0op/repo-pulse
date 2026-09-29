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
const humans = path.resolve(here, '../../models/avatar');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.vrm': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // The app serves the downloaded humans from its storage; here they come from models/avatar.
  const f = u.startsWith('/avatar/models/') ? path.join(humans, u.slice('/avatar/models/'.length)) : path.join(assets, u);
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!(f.startsWith(assets) || f.startsWith(humans)) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const page_url = `http://127.0.0.1:${server.address().port}/avatar/index.html`;
const out = process.argv[2] || '/tmp';

const browser = await chromium.launch({
  // CHROME_PATH if set (e.g. the cloud VM's /opt/pw-browsers/...), else Playwright's own Chromium.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 460 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall due to ReadPixels')) errors.push(m.text()); }); // that one is the screenshot's own readback (macOS)
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
    // The plasma orb look is a keeper: keep it rendering.
    [c, 'listening', null, null, null, 'orb'], [c, 'speaking', 'speak', 'tender', null, 'orb'],
  ]),
  // The orb itself, the onboarding's first character: its states and all its feelings.
  ...['idle', 'listening', 'thinking'].map(st => ['orb', st, null]), ['orb', 'speaking', 'speak'],
  ...['happy', 'sad', 'angry', 'surprised', 'curious', 'tender'].map(e => ['orb', 'idle', null, e]),
];
for (const [char, state, action, emo, profile, look] of shots) {
  await page.goto(`${page_url}?char=${char}&state=${state}&t=7${emo ? `&emo=${emo}` : ''}${profile ? `&profile=${profile}` : ''}${look === 'orb' ? '&orb=1' : ''}`);
  await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(2500); // let the state blend settle
  if (action === 'speak') {
    await page.evaluate(() => avatar.speak(Array.from({ length: 200 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.4)), 20, 0));
    await page.waitForTimeout(430);
  }
  const file = path.join(out, `avatar-${char}-${state}${emo ? '-' + emo : ''}${profile ? '-' + profile : ''}${look ? '-' + look : ''}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
// Waking up (the app's launch): asleep, half awake. The veil and slow breath must render.
for (const [char, awake] of [['machine', 0], ['machine', 0.5], ['girl', 0], ['orb', 0]]) {
  await page.goto(`${page_url}?char=${char}&t=7&awake=${awake}`);
  await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const file = path.join(out, `avatar-${char}-awake-${awake}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
// Live look switching, as the app's Models menu does it: human -> orb -> human.
await page.goto(`${page_url}?char=girl&t=7`);
await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
for (const look of ['orb', 'human']) {
  await page.evaluate(l => avatar.setLook(l), look);
  await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const file = path.join(out, `avatar-girl-live-switch-${look}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
// A finger held down low on the left: the orb comes to hover just above it, looking at it.
await page.goto(`${page_url}?char=orb&t=7`);
await page.waitForFunction(() => window.avatar?.isLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(1000);
await page.mouse.move(90, 380);
await page.mouse.down();
for (let i = 0; i < 8; i++) { await page.mouse.move(90 + i, 380); await page.waitForTimeout(120); }
{
  const file = path.join(out, 'avatar-orb-touch.png');
  await page.screenshot({ path: file });
  console.log('shot', file);
}
await page.mouse.up();
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  (function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); })();
}));
console.log('fps (swiftshader, CPU-rendered):', fps.toFixed(1));
await browser.close();
server.close();
if (errors.length) { console.error('CONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
