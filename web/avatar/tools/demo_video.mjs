// Records Unit Seven through a full turn (idle, touch, listening, thinking, speaking) with
// lip-sync driven by a real voice line, for previewing without a phone.
// Usage: node tools/demo_video.mjs <line.json> <outDir>   -> <outDir>/unit7.webm + timing.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = 'file://' + path.resolve(here, '../../../app/src/main/assets/avatar/index.html');
const line = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const W = 480, H = 600;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const t0 = Date.now();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${pageUrl}?char=machine`);
const wait = ms => page.waitForTimeout(ms);
const at = () => (Date.now() - t0) / 1000;

await wait(2500);                                            // idle
await page.mouse.move(W * 0.15, H * 0.3);                    // touch: every eye follows the finger
await page.mouse.down();
for (let i = 0; i <= 30; i++) { await page.mouse.move(W * (0.15 + 0.7 * i / 30), H * (0.3 + 0.35 * Math.sin(i / 5))); await wait(60); }
await page.mouse.up();
await wait(800);
await page.evaluate(() => avatar.setState('listening'));
await wait(2200);
await page.evaluate(() => avatar.setState('thinking'));
await wait(2200);
const audioStart = at();
for (let i = 0; i < line.chunks.length; i++) {
  const c = line.chunks[i];
  const due = audioStart + c.start;
  await wait(Math.max(0, (due - at()) * 1000));
  await page.evaluate(([env]) => avatar.speak(env, 20, 0), [c.env]);
}
await wait(Math.max(0, (audioStart + line.duration - at()) * 1000) + 200);
await page.evaluate(() => avatar.setState('idle'));
await wait(1800);
const video = page.video();
await ctx.close();
fs.renameSync(await video.path(), path.join(out, 'unit7.webm'));
fs.writeFileSync(path.join(out, 'timing.json'), JSON.stringify({ audioStart }));
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('audio starts at', audioStart.toFixed(2), 's');
