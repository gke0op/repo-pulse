// The onboarding prototype (Mac only, never in the app): the real orb renderer (avatar.js) acting out
// the script (script.js), with its sound (sound.js) and your letters (letters.js). Simulated, and said
// so in the side panel: the downloads (timed) and the network (the switch). The voices are the app's
// own (Supertonic 3, run on the Mac), except the orb's, which doesn't exist yet: it borrows a speaker.
import { ACTS, ORDER, NAMES, FEELINGS, FOUND, needBrain } from './script.js';
import { Sound, STYLES, CAST, STOPS, MIDDLE, voiceName } from './sound.js';
import { askLetters } from './letters.js';

const A = window.avatar;
const $ = id => document.getElementById(id);
const phone = $('phone'), sub = $('sub'), choices = $('choices'), progressEl = $('progress');
const hintEl = $('hint'), layer = $('letters'), dev = $('dev');
const canvas = document.querySelector('canvas');
const sound = new Sound();
const ABORT = 'abort';

// The overlay sits exactly on the canvas (the 9:16 phone frame).
function fit() {
  const r = canvas.getBoundingClientRect();
  Object.assign(phone.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}
addEventListener('resize', () => requestAnimationFrame(fit));
fit();

// ---- state ---------------------------------------------------------------------------------
const fresh = () => ({
  name: '', memory: '', notes: [], voice: false, ears: false, chosen: null,
  brain: 0, brainOn: false, brainDone: false,
});
let st = fresh(), net = navigator.onLine ? 'wifi' : 'offline', speed = 1;
let runId = 0, aborters = [], speaking = false, unpacking = false, act = '';

// ---- input ---------------------------------------------------------------------------------
const keys = { handler: null };
addEventListener('keydown', ev => keys.handler?.(ev));
addEventListener('pointerdown', () => sound.unlock(), true);   // audio may start only after a touch
let touchWaiters = [];
canvas.addEventListener('pointerdown', () => { touchWaiters.forEach(f => f()); touchWaiters = []; });

// Your touches on the orb: taps (each one boops, climbing when they come quickly) and holds.
let taps = [], holdStart = 0, downAt = 0;
canvas.addEventListener('pointerdown', () => { downAt = holdStart = performance.now(); });
addEventListener('pointerup', () => {
  const now = performance.now();
  if (holdStart && now - downAt < 300) {
    taps = taps.filter(t => now - t < 1500).concat(now);
    sound.boop(taps.length - 1);
  }
  holdStart = 0;
});

// The ears: while it can hear and isn't talking itself, the orb pulses with your voice. The room's
// own level (a low percentile of the last four seconds of listening) sets how loud "you" must be,
// so a first answer given straight away is never taken for the room's noise.
const heardLevels = [];   // [time, level], only while it isn't talking
let micLevel = 0, micNeeds = 0;
(function loop() {
  requestAnimationFrame(loop);
  if (!st.ears) return;
  const now = performance.now();
  micLevel = sound.hearing();
  if (!speaking) { A.hear(micLevel); heardLevels.push([now, micLevel]); }
  while (heardLevels.length && now - heardLevels[0][0] > 4000) heardLevels.shift();
})();
function roomLevel() {
  if (heardLevels.length < 10) return 0.05;
  const xs = heardLevels.map(h => h[1]).sort((a, b) => a - b);
  return Math.min(0.3, xs[Math.floor(xs.length * 0.2)]);
}

// ---- the run: acts in order; a restart aborts everything in flight ---------------------------
function onAbort(id, fn) { if (id === runId) aborters.push(fn); else fn(); }
function guard(id) { if (id !== runId) throw ABORT; }
function wait(id, ms, scaled = true) {
  guard(id);
  return new Promise((res, rej) => {
    const t = setTimeout(res, scaled ? ms / speed : ms);
    onAbort(id, () => { clearTimeout(t); rej(ABORT); });
  });
}
async function until(id, pred, ms = Infinity) {
  const t0 = performance.now();
  while (!pred() && (performance.now() - t0) * speed < ms) await wait(id, 250, false);
}

// ---- subtitles: the line appears as it's said, then fades -----------------------------------
let subText = '';
function showSub(text, who) {
  subText = text;
  sub.classList.remove('on');
  void sub.offsetWidth;   // restart the fade
  sub.replaceChildren();
  if (who) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; sub.append(w); }
  const said = document.createElement('span'), rest = document.createElement('span');
  said.className = 'said'; rest.className = 'rest';
  sub.append(said, rest);
  reveal(0);
  sub.classList.add('on');
}
function reveal(n) {
  const said = sub.querySelector('.said'), rest = sub.querySelector('.rest');
  if (!said) return;
  said.textContent = subText.slice(0, n); rest.textContent = subText.slice(n);
}

// Pauses shaped by meaning, not a metronome (the Kubrick pass: it was 0.65 s after every line): a
// question gets time to land, an exclamation moves on, a trailing "…" lingers, a long line needs a
// breath, and never exactly the same twice.
function holdFor(text) {
  const t = text.trim(), end = t.slice(-1), words = t.split(/\s+/).length;
  const ms = end === '?' ? 900 : end === '!' ? 520 : t.endsWith('…') ? 1000 : 700;
  return ms + Math.max(0, words - 8) * 25 + (Math.random() - 0.5) * 160;
}

// A held silence: the words fade, nothing sounds, the orb is just there. Its big moments are silent.
async function silence(id, ms) {
  guard(id);
  sub.classList.remove('on');
  await wait(id, ms);
}

// The leitmotif (sound.motif), with the orb's lips moving to its hummed "aah".
function motif(size) {
  const m = sound.motif(size);
  if (m.env.length) A.speak(m.env, 20, 60);
  return m.total;
}

async function say(id, text, feel = 'calm', { as, hold } = {}) {   // it talks calm by default
  if (hold === undefined) hold = holdFor(text);
  guard(id);
  if (feel) A.setEmotion(feel);
  showSub(text, as ? NAMES[as] : '');
  speaking = true;
  try {
    let said = false;
    if (st.voice && sound.model) {
      const c = CAST[as || 'orb'];
      try {
        await Promise.race([
          sound.speakModel(text, as ? c.sid : orbVoice(), { speed: c.speed, robot: c.robot, onStart: env => A.speak(env, 20, 0), onReveal: reveal }),
          new Promise((_, rej) => onAbort(id, () => rej(ABORT))),
        ]);
        said = true;
      } catch (e) {
        if (e === ABORT) throw e;
        console.warn('the voice server failed; falling back', e);   // this line and the rest: the fallback
        sound.model = null;
        updateDev(true);
      }
    }
    if (!said && st.voice && sound.canSpeak()) {
      await Promise.race([
        sound.speak(text, as || 'orb', feel, { onStart: env => A.speak(env, 20, 0), onReveal: reveal }),
        new Promise((_, rej) => onAbort(id, () => rej(ABORT))),
      ]);
    } else if (!said) {
      const p = sound.babble(text, feel || 'calm', { shape: st.voice ? 1 : 0.6 });
      A.speak(p.env, 20, 60);
      for (const r of p.reveal) {
        const t = setTimeout(() => reveal(r.to), 60 + r.at * 1000);
        onAbort(id, () => clearTimeout(t));
      }
      await wait(id, 60 + p.total * 1000 + 150, false);
    }
  } finally { speaking = false; }
  guard(id);
  reveal(text.length);
  A.setState('idle');
  if (hold) await wait(id, hold);
}

// ---- choices: soft buttons that appear only when the orb asks for something ------------------
function button(label, { size, quiet } = {}) {
  const b = document.createElement('button');
  b.className = 'choice' + (quiet ? ' quiet' : '');
  b.textContent = label;
  if (size) { const s = document.createElement('span'); s.className = 'size'; s.textContent = size; b.append(s); }
  return b;
}
const show = els => requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((e, k) => setTimeout(() => e.classList.add('on'), k * 90))));
function quietButton(label, onClick) {
  const b = button(label, { quiet: true });
  b.onclick = onClick;
  choices.append(b);
  show([b]);
  return b;
}
function portrait(opt) {
  const el = document.createElement('button');
  el.className = 'choice portrait';
  const dot = document.createElement('span'), name = document.createElement('span');
  dot.className = `dot ${opt.key}`; name.textContent = opt.label;
  el.append(dot, name);
  el.onpointerenter = () => A.setPalette(opt.key);   // the orb tries on their colours
  el.onpointerleave = () => A.setPalette('orb');
  return el;
}
function choose(id, options, { portraits = false } = {}) {
  guard(id);
  return new Promise((resolve, reject) => {
    const wrap = portraits ? Object.assign(document.createElement('div'), { className: 'portraits' }) : null;
    if (wrap) choices.append(wrap);
    const els = options.map(opt => {
      const el = portraits ? portrait(opt) : button(opt.label, opt);
      el.onclick = () => { clear(); setTimeout(() => resolve(opt.key), 250); };
      (wrap || choices).append(el);
      return el;
    });
    const clear = () => {
      els.forEach(e => { e.classList.remove('on'); e.onclick = e.onpointerenter = e.onpointerleave = null; });
      setTimeout(() => { els.forEach(e => e.remove()); wrap?.remove(); }, 450);
    };
    show(els);
    onAbort(id, () => { clear(); reject(ABORT); });
  });
}

// ---- progress: the orb fills with light; a small line says what and how much ----------------
function progress(label, p) {
  if (!label) { progressEl.classList.remove('on'); return; }
  progressEl.textContent = p == null ? label : `${label} · ${Math.round(p * 100)}%`;
  progressEl.classList.add('on');
}
async function unpack(id, label, ms, kind = 'voice') {
  guard(id);
  unpacking = true;
  const t0 = performance.now();
  let next = 0;
  try {
    for (;;) {
      const p = Math.min(1, (performance.now() - t0) * speed / ms);
      A.setFill(p, 1); progress(label, p);
      // It hums while it wakes: phrases grow and come quicker as it fills (sound.hum).
      if (performance.now() >= next && p < 0.96) {
        const h = sound.hum(p, kind);
        A.speak(h.env, 20, 60);
        next = performance.now() + h.total * 1000 + 650 - 400 * p + Math.random() * 250;
      }
      if (p >= 1) break;
      await wait(id, 60, false);
    }
  } finally { unpacking = false; }
  progress(null); A.setFill(-1);
  const a = sound.arrive(kind);   // awake: a little bright motif, and a hop
  A.speak(a.env, 20, 60); A.joy();
  await wait(id, 900, false);
  A.setState('idle');
  await wait(id, 400);
}

// The simulated download (the prototype's only fake): the brain in ~150 s at 1× (a real one: ~6-15
// min). Everything else is in the app.
const SIM = { brain: 150 };
setInterval(() => {
  for (const k of ['brain']) {
    if (!st[k + 'On'] || net === 'offline') continue;
    st[k] = Math.min(1, st[k] + (0.2 * speed / SIM[k]) * (net === 'mobile' ? 0.6 : 1));
    if (st[k] >= 1) {
      st[k + 'On'] = false; st[k + 'Done'] = true;
      if (k === 'brain') { A.setFill(-1); A.joy(); }
    }
  }
  if (!unpacking) {
    if (st.brainOn) { A.setFill(st.brain, 0.35); progress(net === 'offline' ? 'my brain · waiting for internet' : 'my brain', net === 'offline' ? null : st.brain); }
    else progress(null);
  }
  updateDev();
}, 200);

// ---- the acts' helpers ------------------------------------------------------------------------
async function fadeIn(id) {
  A.setAwake(0);
  await wait(id, 700, false);
  A.setAwake(0.35);   // small, dim, its light shut: asleep until you touch it
  await wait(id, 1200, false);
}
function waitForTouch(id) {
  guard(id);
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      hintEl.textContent = 'touch it'; hintEl.style.top = '66%'; hintEl.classList.add('on');
    }, 3500);
    touchWaiters.push(() => { clearTimeout(t); hintEl.classList.remove('on'); res(); });
    onAbort(id, () => { clearTimeout(t); hintEl.classList.remove('on'); rej(ABORT); });
  });
}
// It listens until you've said something and then stopped (0.9 s of quiet), leaning in while it
// does, with a soft "hm?" to say it's listening; false if you say nothing for waitMs. The thresholds
// sit above the room's own noise (roomLevel). A hint comes if you're quiet for 4 s.
async function hearYou(id, { waitMs = 8000, maxMs = 15000 } = {}) {
  A.setState('listening');
  sound.listenCue();
  try {
    const floor = roomLevel();
    const on = Math.max(0.25, floor + 0.15), off = Math.max(0.12, floor + 0.06);
    micNeeds = on;
    const t0 = performance.now();
    let spoke = 0, started = 0, quietSince = 0, last = t0;
    for (;;) {
      await wait(id, 50, false);
      const now = performance.now(), level = sound.hearing();
      if (level > on) { spoke += now - last; started ||= now; quietSince = 0; }
      else if (level < off && !quietSince) quietSince = now;
      last = now;
      if (spoke > 300 && quietSince && now - quietSince > 900) return true;   // you spoke, then stopped
      if (!started && now - t0 > waitMs) return false;                         // nothing came
      if (started && now - started > maxMs) return true;                       // a long one: answer anyway
      if (!started && now - t0 > 4000) hint('say something out loud');
      else hint(null);
    }
  } finally { A.setState('idle'); hint(null); micNeeds = 0; }
}

// Before a waking it asks you to do something (so you're playing, not waiting): a tap, a hold, three
// taps. A soft hint comes after a while; after longer, it does it itself.
const HINTS = { tap: 'tap it', hold: 'press and hold it', taps3: 'tap it three times' };
function hint(text) {
  if (!text) { hintEl.classList.remove('on'); return; }
  hintEl.textContent = text; hintEl.style.top = '66%'; hintEl.classList.add('on');
}
async function ask(id, kind, { hintAfter = 6000, giveUp = 25000 } = {}) {
  guard(id);
  window.__asking = kind;   // for the headless walkthrough: what it's waiting for
  try { return await asking(id, kind, hintAfter, giveUp); } finally { window.__asking = null; }
}
async function asking(id, kind, hintAfter, giveUp) {
  const t0 = performance.now(), since = taps.length ? taps[taps.length - 1] : 0;
  let charging = false;
  try {
    for (;;) {
      await wait(id, 40, false);
      const now = performance.now(), fresh = taps.filter(x => x > since && x > t0);
      if (kind === 'tap' && fresh.length) return 'done';
      if (kind === 'taps3' && fresh.filter(x => now - x < 1500).length >= 3) return 'done';
      if (kind === 'hold') {
        const held = holdStart && holdStart > t0 ? now - holdStart : 0;
        if (held && !charging) { charging = true; sound.charge(true); }
        if (!held && charging) { charging = false; sound.charge(false); A.setFill(-1); }
        if (held) A.setFill(Math.min(1, held / 1200) * 0.35, 1);   // holding fills it a little
        if (held >= 1200) { sound.charge(false); charging = false; A.setFill(-1); A.joy(); return 'done'; }
      }
      if (now - t0 > hintAfter) hint(HINTS[kind]);
      if (now - t0 > giveUp) return 'timeout';
    }
  } finally {
    if (charging) sound.charge(false);
    hint(null);
  }
}

// The orb's voice, once found (until then, the middle one: 4 and 5 blended).
const orbVoice = () => sound.orbVoice ?? STOPS[MIDDLE];
// Its first voice isn't settled: those lines are made in four voices spread from high to deep, and
// spliced (sound.speakGlitch). Chosen once per page, so they can be made in the background early.
const GLITCH = [0, 1, 2, 3].map(q => STOPS[3 + Math.min(12, Math.floor(((q + Math.random()) * 13) / 4))]);   // stops 3-15: no extremes
async function glitch(id, text, amount = 1, feel = 'calm', { hold = 650 } = {}) {
  guard(id);
  if (!sound.model) return say(id, text, feel, { hold });   // no voice model on this Mac: said plainly
  A.setEmotion(feel);
  showSub(text);
  speaking = true;
  try {
    await Promise.race([
      sound.speakGlitch(text, GLITCH, { amount, onStart: env => A.speak(env, 20, 0), onReveal: reveal }),
      new Promise((_, rej) => onAbort(id, () => rej(ABORT))),
    ]);
  } finally { speaking = false; }
  reveal(text.length);
  A.setState('idle');
  if (hold) await wait(id, hold);
}

// Finding its voice: drag the orb up (higher, smaller) and down (deeper, bigger). It says "is this
// me?" in the voice under your finger: a snippet while you move, the whole question when you rest.
// Let go to keep it. Nobody helping (40 s): it keeps the middle voice.
async function findVoice(id, { hintAfter = 7000, giveUp = 40000 } = {}) {
  guard(id);
  window.__asking = 'drag';
  const t0 = performance.now();
  let stop = -1, moved = 0, lastY = 0, rest = 0, dragging = false, found = null;
  const uOf = y => { const r = canvas.getBoundingClientRect(); return Math.min(1, Math.max(0, (y - r.top - r.height * 0.15) / (r.height * 0.7))); };
  const speakProbe = async full => { const env = await sound.probe(STOPS[stop], full); if (env) A.speak(env, 20, 0); };
  const down = ev => { dragging = true; lastY = ev.clientY; moved = 0; };
  const move = ev => {
    if (!dragging) return;
    moved += Math.abs(ev.clientY - lastY); lastY = ev.clientY;
    const u = uOf(ev.clientY), k = Math.round(u * (STOPS.length - 1));
    A.setTune(u); hint(null); sub.classList.remove('on');   // the ask has been heard; the orb has the stage
    if (k !== stop) {
      stop = k; speakProbe(false);
      clearTimeout(rest); rest = setTimeout(() => speakProbe(true), 350);
    }
  };
  const up = () => {
    if (!dragging) return;
    dragging = false; clearTimeout(rest);
    if (moved > 40 && stop >= 0) found = stop;
  };
  canvas.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up);
  try {
    for (;;) {
      await wait(id, 50, false);
      if (found != null) break;
      const now = performance.now();
      if (now - t0 > hintAfter && !dragging) hint('drag it up and down');
      if (now - t0 > giveUp && !dragging) break;
    }
  } finally {
    canvas.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    clearTimeout(rest); hint(null); A.setTune(-1); sound.stopProbe(); window.__asking = null;
  }
  sound.orbVoice = STOPS[found ?? MIDDLE];
  st.notes.push(`its voice: ${voiceName(sound.orbVoice)}${found == null ? ' (the middle one, nobody chose)' : ''}`);
  updateDev(true);
  prefetch();   // its lines again, in the voice it has now
  return found != null ? 'done' : 'timeout';
}

// A feeling, shown: the stage clears, the feeling comes (with its little sound) and stays a while,
// then it settles back to calm.
async function feel(id, name, ms = 4500) {
  guard(id);
  sub.classList.remove('on');
  A.setEmotion(name);
  const e = sound.emote(name);
  if (e) A.speak(e.env, 20, 60);
  if (name === 'happy' || name === 'curious') {   // the lively ones make their sound twice
    const t = setTimeout(() => { const e2 = sound.emote(name); if (e2) A.speak(e2.env, 20, 60); }, 2300 / speed);
    onAbort(id, () => clearTimeout(t));
  }
  await wait(id, ms);
  A.setState('idle');
  A.setEmotion('calm');
  await wait(id, 1300);
}
// Becoming, over the whole leitmotif: its colours turn, it goes dark on "C G C", the character forms
// under the held E and wakes with the last "G C". (The real morph is the avatar seat's.)
async function become(id, who) {
  const total = motif('whole');
  A.setPalette(who); A.setEmotion('surprised'); A.joy();
  sub.classList.remove('on');
  await wait(id, 1000, false);
  A.setAwake(0); A.setCharacter(who); A.setEmotion('calm');
  await wait(id, 700, false);
  A.setAwake(0.5);
  await wait(id, 1000, false);
  A.setAwake(1);
  await wait(id, Math.max(500, total * 1000 - 2700), false);
}

const ui = { layer, phone, hintEl, keys, avatar: A, sound, quietButton };
function helpers(id) {
  return {
    st,
    say: (text, feel, opts) => say(id, text, feel, opts),
    choose: (options, opts) => choose(id, options, opts),
    letters: opts => { guard(id); return askLetters(ui, { ...opts, abort: new Promise(r => onAbort(id, r)) }).finally(() => A.setState('idle')); },
    unpack: (label, ms, kind) => unpack(id, label, ms, kind),
    feel: (name, ms) => feel(id, name, ms),
    silence: ms => silence(id, ms),
    motif: size => motif(size),
    ask: (kind, opts) => ask(id, kind, opts),
    glitch: (text, amount, feel, opts) => glitch(id, text, amount, feel, opts),
    findVoice: opts => findVoice(id, opts),
    wait: ms => wait(id, ms),
    until: (pred, ms) => until(id, pred, ms),
    fadeIn: () => fadeIn(id),
    waitForTouch: () => waitForTouch(id),
    wake: () => A.setAwake(1),
    voiceOn: () => { st.voice = true; },
    listen: async () => { guard(id); st.ears = await sound.listen(); guard(id); return st.ears; },
    hearYou: opts => hearYou(id, opts),
    net: () => net,
    download: kind => { st[kind + 'On'] = true; },
    pct: kind => Math.round(st[kind] * 100),
    remember: note => { st.notes.push(note); updateDev(true); },
    palette: p => A.setPalette(p),
    become: who => become(id, who),
  };
}

async function run(from = 'hello') {
  const id = ++runId;
  const old = aborters; aborters = []; old.forEach(f => f());
  sound.stop(); keys.handler = null; touchWaiters = [];
  A.stopSpeaking(); A.setFill(-1); A.setCharacter('orb'); A.setPalette('orb'); A.setEmotion('calm'); A.setState('idle');
  choices.replaceChildren(); layer.replaceChildren(); sub.classList.remove('on'); hintEl.classList.remove('on'); progress(null);
  if (from === 'hello') { st = fresh(); sound.orbVoice = null; }
  else {
    A.setAwake(1);
    if (ORDER.indexOf(from) > ORDER.indexOf('voice')) st.voice = true;   // jumping past it: it has a voice
  }
  const o = helpers(id);
  try {
    for (const name of ORDER.slice(ORDER.indexOf(from))) { act = name; updateDev(true); await ACTS[name](o); }
    act = 'the end (restart on the left)';
  } catch (e) {
    if (e !== ABORT) { console.error(e); act = `stopped: ${e}`; }
  }
  updateDev(true);
}

// ---- the side panel (the prototype's own controls; not part of the design) -------------------
dev.innerHTML = `
  <h1>orb onboarding · prototype</h1>
  <p class="note">Not the app. In the app bundle: the voice, both ears, the three bodies. Simulated: the brain's download and the network.</p>
  <div class="row">voice: <b id="d-voice">checking…</b></div>
  <div class="row">the orb's voice: <b id="d-orbvoice"></b><br>${Array.from({ length: 10 }, (_, k) => `<button data-sid="${k}">${k}</button>`).join('')}</div>
  <div class="row">act: <b id="d-act"></b></div>
  <div class="row">network<br>${['wifi:Wi-Fi', 'mobile:mobile data', 'offline:offline'].map(x => `<button data-net="${x.split(':')[0]}">${x.split(':')[1]}</button>`).join('')}</div>
  <div class="row">babble<br>${Object.keys(STYLES).map(x => `<button data-style="${x}">${x}</button>`).join('')}</div>
  <div class="row">speed (pauses, downloads)<br>${[1, 3, 10].map(x => `<button data-speed="${x}">${x}×</button>`).join('')}</div>
  <div class="row">start at<br>${ORDER.map(x => `<button data-from="${x}">${x}</button>`).join('')}</div>
  <div class="row">download: <span id="d-dl"></span></div>
  <div class="row">mic: <span id="d-mic">off</span></div>
  <div class="row">it knows<div id="d-mem" class="mem"></div></div>`;
dev.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.net) net = b.dataset.net;
  if (b.dataset.style) sound.style = b.dataset.style;
  if (b.dataset.speed) speed = Number(b.dataset.speed);
  if (b.dataset.from) run(b.dataset.from);
  if (b.dataset.sid) {   // try it on: the orb says a line in that speaker's voice
    sound.orbVoice = Number(b.dataset.sid);
    prefetch();   // its lines again, in the new voice
    if (sound.model) sound.speakModel('hi. is this my voice?', sound.orbVoice, { onStart: env => A.speak(env, 20, 0) }).catch(() => {});
  }
  updateDev(true);
});
let memShown = -1;
function updateDev(full = false) {
  $('d-act').textContent = act;
  dev.querySelectorAll('[data-net]').forEach(b => b.classList.toggle('sel', b.dataset.net === net));
  dev.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('sel', b.dataset.style === sound.style));
  dev.querySelectorAll('[data-sid]').forEach(b => b.classList.toggle('sel', Number(b.dataset.sid) === sound.orbVoice));
  $('d-orbvoice').textContent = sound.orbVoice == null ? 'not found yet' : voiceName(sound.orbVoice);
  $('d-voice').textContent = sound.model ? "the app's own (Supertonic 3)" : sound.canSpeak() ? "the Mac's speech (the app's voice model isn't here)" : 'babble only';
  dev.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('sel', Number(b.dataset.speed) === speed));
  const dl = k => (st[k + 'Done'] ? 'here' : st[k + 'On'] ? `${Math.round(st[k] * 100)}%` : '–');
  $('d-dl').textContent = `brain ${dl('brain')}`;
  $('d-mic').textContent = !st.ears ? 'off' : `${'▮'.repeat(Math.round(micLevel * 10)).padEnd(10, '▯')} ${micLevel.toFixed(2)} · room ${roomLevel().toFixed(2)}${micNeeds ? ` · needs ${micNeeds.toFixed(2)}` : ''}`;
  if (full || memShown !== st.notes.length) {
    memShown = st.notes.length;
    $('d-mem').textContent = st.notes.length ? st.notes.map(n => `· ${n}`).join('\n') : '(nothing yet)';
  }
}
addEventListener('online', () => { net = 'wifi'; updateDev(); });
addEventListener('offline', () => { net = 'offline'; updateDev(); });

// The scripted lines are known ahead: have the voice server make them in the background (it keeps
// them), so a line starts the moment it's due instead of after its synthesis (0.5-2 s each). Lines
// with your name or memory in them are made when they come.
// Before its voice is found: the glitched lines (in their four voices), "is this me?" and the found
// line in every voice along the drag, and the characters' lines. After: the orb's lines in its voice.
let prefetchGen = 0, prefetchedEarly = false;
const literal = (m, q) => (q === '"' ? JSON.parse(`"${m}"`) : m.replace(/\\'/g, "'"));
async function prefetch() {
  const gen = ++prefetchGen, jobs = [];
  const say = /o\.say\(\s*(["'])((?:\\.|(?!\1).)*)\1(?:\s*,\s*["']\w+["'])?(?:\s*,\s*\{[^}]*?as:\s*["'](\w+)["'])?/g;
  const gl = /o\.glitch\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  const orb = [], cast = [];
  for (const fn of [...ORDER.map(a => ACTS[a]), needBrain]) {
    const src = fn.toString();
    if (!prefetchedEarly) for (const m of src.matchAll(gl)) for (const v of GLITCH) jobs.push([literal(m[2], m[1]), v, CAST.orb]);
    for (const m of src.matchAll(say)) (m[3] ? cast : orb).push([literal(m[2], m[1]), m[3]]);
    if (fn === ACTS.tour) for (const [, line] of FEELINGS) orb.push([line]);   // said in a loop
  }
  if (!prefetchedEarly) {
    for (const v of STOPS) jobs.push(['is this me?', v, CAST.orb]);
    for (const v of STOPS) jobs.push([FOUND, v, CAST.orb]);
    prefetchedEarly = true;
  }
  for (const [text] of orb) jobs.push([text, orbVoice(), CAST.orb]);
  for (const [text, as] of cast) jobs.push([text, CAST[as].sid, CAST[as]]);   // kept by the server: instant if made
  for (const [text, voice, c] of jobs) {
    if (gen !== prefetchGen || !sound.model) return;
    await fetch(sound.ttsUrl(text, voice, c)).catch(() => {});
  }
}
// The voice server takes a couple of seconds to load its model after `npm run proto`: keep asking
// while it's starting (503), and give up only if there's no model on this Mac (404).
(async () => {
  for (let i = 0; i < 20; i++) {
    const status = await sound.checkModel();
    if (sound.model || status === 404) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  updateDev(true);
  prefetch();
})();
run('hello');
