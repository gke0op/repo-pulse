// The prototype's end-to-end test: a headless walk through every act of the onboarding, playing
// along the way a person would (it touches the orb, types a name, taps, drags up and down to find its
// voice, holds it, "speaks" through Chromium's fake microphone, shows the feelings, triple-taps,
// tells it something, chooses Seven). Fails on any page error or a step that never comes.
//   npm run walk-proto [-- <screenshot dir>] [offline]
// It starts its own prototype server on WALK_PORT (default 8866; the voice on the port after) and
// stops it at the end, so a copy you're running on 8766 is never touched.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes('offline') ? 'offline' : 'online';
const out = args.find(a => a !== 'offline') || path.join(os.tmpdir(), 'orb-walk');
const port = Number(process.env.WALK_PORT || 8866), base = `http://localhost:${port}`;
fs.mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, [path.join(here, 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
let browser, failed = false;
try {
  for (let i = 0; ; i++) {   // the page, then the voice (if its model is on this Mac)
    if (server.exitCode != null || /already running/.test(serverLog)) throw new Error(`the test server could not start on ${port}: ${serverLog.trim()}`);
    if (i > 120) throw new Error('the test server did not come up in 30 s');
    const up = await fetch(`${base}/avatar/onboarding.html`).then(r => r.ok, () => false);
    const voice = await fetch(`${base}/avatar/tts-health`).then(r => r.status, () => 0);
    if (up && (voice === 200 || voice === 404)) { log(`server up on ${port}${voice === 200 ? ', with the voice' : ', no voice model (the Mac speaks)'}`); break; }
    await new Promise(r => setTimeout(r, 250));
  }

  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const p = await browser.newPage({ viewport: { width: 760, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push(`page: ${e}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  let n = 0;
  const shot = name => p.screenshot({ path: path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`) });
  const text = sel => p.evaluate(s => document.querySelector(s)?.textContent ?? '', sel);
  const sub = () => text('#sub');
  async function until(fn, what, ms = 60000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (errs.length) throw new Error(`${errs.join(' | ')} (while waiting for ${what})`);
      if (await fn()) return;
      await p.waitForTimeout(150);
    }
    throw new Error(`timed out waiting for ${what}; act: ${await text('#d-act')}; line: ${await sub()}`);
  }
  const says = (part, what, ms) => until(async () => (await sub()).includes(part), what, ms);
  const asked = kind => until(async () => (await p.evaluate(() => window.__asking)) === kind, `it to ask for a ${kind}`);
  const orb = () => p.evaluate(() => avatar.where());
  const button = label => p.locator('button.choice', { hasText: label }).first();
  async function click(label) {
    await until(async () => (await p.locator('button.choice', { hasText: label }).count()) > 0 && button(label).evaluate(e => e.classList.contains('on')), `the "${label}" button`);
    log(`click "${label}"`);
    await button(label).click();
  }
  const panel = sel => p.click(`#dev button[${sel}]`);

  await p.goto(`${base}/`);
  await p.waitForFunction(() => window.avatar);
  await p.waitForTimeout(2500); await shot('asleep');
  if (mode === 'offline') await panel('data-net="offline"');
  await panel('data-speed="10"');
  let o = await orb();
  await p.mouse.click(o.x, o.y); log('touched it awake');
  await until(async () => (await text('#hint')) === 'type your name', 'the name prompt');
  await p.keyboard.type('Sam', { delay: 150 }); await shot('letters');
  await p.keyboard.press('Backspace'); await p.keyboard.type('m', { delay: 100 }); await p.keyboard.press('Enter');
  await says('nice one', 'your name back'); log(await sub());

  await asked('tap'); o = await orb(); await p.mouse.click(o.x, o.y); log('tapped: its voice wakes');
  await says('is that me', 'the unsettled voice');
  await asked('drag');
  o = await orb(); await p.mouse.move(o.x, o.y); await p.mouse.down();
  for (let y = o.y; y > 110; y -= 20) { await p.mouse.move(o.x, y); await p.waitForTimeout(50); }
  await shot('voice-high');
  for (let y = 110; y < 720; y += 25) { await p.mouse.move(o.x, y); await p.waitForTimeout(50); }
  await shot('voice-deep');
  await p.mouse.move(o.x, 430); await p.waitForTimeout(1200); await p.mouse.up();
  await says("that's me", 'its found voice'); log(`found its voice: ${await text('#d-orbvoice')}`);

  await asked('hold'); o = await orb(); await p.mouse.move(o.x, o.y); await p.mouse.down(); await p.waitForTimeout(1600); await p.mouse.up();
  log('held: its ears wake');
  await says('say something', 'the ask to speak');
  await until(async () => (await text('#d-mic')).includes('needs'), 'it to listen', 30000); log(`listening; mic: ${await text('#d-mic')}`);
  await until(async () => /heard you|catch you later/.test(await sub()), 'it to hear', 60000); log(await sub());
  await says('2.3 gigabytes', 'the brain');
  if (mode === 'online') await click('Get my brain');

  await panel('data-speed="1"');   // the feelings at their own pace
  await click('Show me');
  await says('come back', 'happy, named');
  await until(async () => !(await p.evaluate(() => document.querySelector('#sub').classList.contains('on'))), 'happy, shown');
  await p.waitForTimeout(2000); await shot('feel-happy');
  await says('all of them', 'the last feeling', 120000); log('the feelings, shown');
  await panel('data-speed="10"');
  await says('still asleep', 'the three, asleep', 120000);
  await asked('taps3');
  for (let i = 0; i < 3; i++) { o = await orb(); await p.mouse.click(o.x, o.y); await p.waitForTimeout(150); }
  log('three taps: the bodies wake');
  await says('small things', 'Mira'); await p.waitForTimeout(600); await shot('as-mira');
  await says('I am a machine', 'Seven'); await p.waitForTimeout(600); await shot('as-seven');
  await until(async () => (await text('#hint')).startsWith('tell it'), 'the memory prompt');
  await p.keyboard.type('i love the sea at night', { delay: 60 }); await p.keyboard.press('Enter');
  await says('who should I become', 'the choice'); await p.waitForTimeout(900); await shot('choice');
  await click('Unit Seven');
  await click('Yes, him');
  if (mode === 'offline') {
    await says('back online', 'the wait for a connection'); await shot('offline-wait');
    await panel('data-net="wifi"');
    await click('Get my brain');
  }
  await until(async () => (await text('#d-act')).startsWith('the end'), 'the end', 180000);
  await p.waitForTimeout(300); await shot('became');
  log(`last line: ${await sub()}`);
  const kept = await text('#d-mem');
  log(`it knows: ${kept.replace(/\n/g, ' ')}`);
  if (!kept.includes('goes by Sam') || !kept.includes('i love the sea at night')) throw new Error('the name or the memory was not kept');
  log(`passed (${mode}); screenshots in ${out}`);
} catch (e) {
  failed = true;
  console.error(`FAILED: ${e.message}`);
} finally {
  await browser?.close();
  server.kill();   // serve.mjs stops its voice server with it
}
process.exit(failed ? 1 : 0);
