// Renders the avatar page in headless Chromium and saves screenshots of each state.
// Usage: node shoot.mjs <outDir>   (fails loudly on any console error, e.g. a shader compile error)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + path.resolve(here, '../../app/src/main/assets/avatar/index.html');
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
  ['girl', 'listening', null],
  ['boy', 'speaking', 'speak'],
  ...['happy', 'sad', 'angry', 'surprised', 'curious', 'tender'].map(e => ['machine', 'speaking', 'speak', e]),
];
for (const [char, state, action, emo] of shots) {
  await page.goto(`${page_url}?char=${char}&state=${state}&t=7${emo ? `&emo=${emo}` : ''}`);
  await page.waitForTimeout(2500); // let the state blend settle
  if (action === 'speak') {
    await page.evaluate(() => avatar.speak(Array.from({ length: 200 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.4)), 20, 0));
    await page.waitForTimeout(430);
  }
  const file = path.join(out, `avatar-${char}-${state}${emo ? '-' + emo : ''}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  (function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); })();
}));
console.log('fps (swiftshader, CPU-rendered):', fps.toFixed(1));
await browser.close();
if (errors.length) { console.error('CONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
