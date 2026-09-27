// Avatar stage: renders the current character and exposes window.avatar for the app.
//
// API (called from Kotlin via evaluateJavascript):
//   avatar.setCharacter('girl' | 'boy' | 'machine')
//   avatar.setState('idle' | 'listening' | 'thinking' | 'speaking')
//   avatar.speak(envelope: number[0..1], frameMs, delayMs)   // lip-sync for one audio chunk
//   avatar.stopSpeaking()
//   avatar.flinch()                                          // interrupted / startled
//   avatar.setEmotion('calm'|'happy'|'sad'|'angry'|'surprised'|'curious'|'tender')
//   avatar.pause() / avatar.resume()
import * as THREE from 'three';
import { Shoggoth } from './shoggoth.js';
import { Orb } from './orb.js';
import { VrmAvatar } from './vrm.js';

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x05050a, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0.35, 7);

// Backdrop: a faint violet glow behind the character, fading to black.
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color(0x120a24) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTint; varying vec2 vUv;
      void main(){ float d = length((vUv - vec2(0.5, 0.52)) * vec2(1.0, 1.25)) * 2.0;
        vec3 c = uTint * exp(-d * d * 10.0) * 0.8 + vec3(0.0015, 0.0012, 0.0025);
        gl_FragColor = vec4(pow(c, vec3(1.0/2.2)), 1.0); }`,
    depthWrite: false,
  }),
);
backdrop.position.z = -6;
scene.add(backdrop);

// Drifting dust, so the space feels inhabited.
const DUST = 260;
const dustGeo = new THREE.BufferGeometry();
const seeds = new Float32Array(DUST * 3);
for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
dustGeo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
const dustU = { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } };
scene.add(new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `uniform float uTime, uPx; varying float vA;
    void main(){ vec3 s = position;
      vec3 p = vec3((s.x - 0.5) * 9.0, mod(s.y * 7.0 + uTime * (0.03 + s.z * 0.05), 7.0) - 3.2, -3.5 + s.z * 5.0);
      p.x += sin(uTime * 0.2 + s.y * 20.0) * 0.2;
      vA = (0.25 + 0.75 * fract(s.x * 91.7)) * (0.5 + 0.5 * sin(uTime * (0.5 + s.z) + s.y * 40.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uPx * (1.5 + 2.5 * s.z) * (6.0 / -mv.z);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vA * 0.35; gl_FragColor = vec4(vec3(0.7, 0.8, 1.0) * a, a); }`,
})));

// ---- state -------------------------------------------------------------------------
const STATES = {
  //            ripple lean unrest swirl eyeLock dilate pulse maskEyes glow
  idle:      [0.0, 0.0, 0.15, 0.0, 0.35, 0.3, 0.15, 1.0, 0x7fffe0],
  listening: [0.0, 1.0, 0.25, 0.0, 1.00, 1.0, 0.25, 1.0, 0xdffcff],
  thinking:  [1.0, 0.3, 0.80, 1.0, 0.10, 0.6, 0.55, 0.45, 0xffc86b],
  speaking:  [0.2, 0.4, 0.40, 0.0, 0.85, 0.5, 0.30, 1.0, 0x9ffff0],
};
const KEYS = ['ripple', 'lean', 'unrest', 'swirl', 'eyeLock', 'dilate', 'pulse', 'maskEyes'];

const s = {
  t: 0, breath: 1, speech: 0, mouth: 0, glitch: 0, nod: 0, tilt: 0,
  focus: new THREE.Vector3(0, 0.1, 7), glowColor: new THREE.Color(0x7fffe0),
};
const target = {};
let stateName = 'idle';

// ---- emotions (from the brain's tags) ----------------------------------------------
// glow: mask light; smile/brow/slant: mask shape; open: eye-slit openness; gold: kintsugi glow;
// vein/veinMix: vein color; energy: agitation; sag: + droop / - puff; gaze: + up / - down;
// dilate: pupils; tilt: head tilt; mouthOpen: jaw drop.
const E = (glow, o) => ({ glow, smile: 0, brow: 0, slant: 0, open: 1, gold: 0, vein: 0x7fffd4, veinMix: 0,
  energy: 0, sag: 0, gaze: 0, dilate: 0, tilt: 0, mouthOpen: 0, amount: 0.8, ...o });
const EMOTIONS = {
  calm:      E(0x7fffe0, { amount: 0 }),
  happy:     E(0xfff0b0, { smile: 0.8, brow: 0.7, open: 0.8, gold: 0.15, vein: 0x9fffe0, veinMix: 0.5, energy: 0.35, sag: -0.35, gaze: 0.15, dilate: 0.3 }),
  sad:       E(0x7f9fff, { smile: -0.7, brow: -0.3, slant: -0.7, open: 0.6, vein: 0x5040ff, veinMix: 0.7, sag: 1.0, gaze: -0.8, dilate: 0.2 }),
  angry:     E(0xff5040, { smile: -0.4, slant: 1.0, open: 0.55, vein: 0xff2030, veinMix: 0.9, energy: 1.0, sag: -0.2, dilate: -0.4 }),
  surprised: E(0xffffff, { open: 1.6, vein: 0xffffff, veinMix: 0.4, energy: 0.6, sag: -0.6, gaze: 0.1, dilate: -0.8, mouthOpen: 0.35 }),
  curious:   E(0x80ffb0, { smile: 0.15, brow: 0.2, open: 1.15, vein: 0x80ffb0, veinMix: 0.5, energy: 0.3, dilate: 0.7, tilt: 0.12 }),
  tender:    E(0xffc890, { smile: 0.45, brow: 0.35, open: 0.75, gold: 1.0, vein: 0xffa860, veinMix: 0.8, energy: 0.1, sag: 0.15, dilate: 0.5 }),
};
const EMO_KEYS = ['smile', 'brow', 'slant', 'open', 'gold', 'veinMix', 'energy', 'sag', 'gaze', 'dilate', 'tilt', 'mouthOpen', 'amount'];
s.emo = { ...EMOTIONS.calm, glow: new THREE.Color(EMOTIONS.calm.glow), vein: new THREE.Color(EMOTIONS.calm.vein) };
let emoTarget = EMOTIONS.calm, emoName = 'calm';
const emoGlow = new THREE.Color(), emoVein = new THREE.Color(), mixedGlow = new THREE.Color();
let calmAt = 0;   // when idle, drift back to calm at this time

function setEmotion(name) {
  const next = EMOTIONS[name];
  if (!next || name === emoName) return;
  emoName = name;
  emoTarget = next;
  emoGlow.set(next.glow);
  emoVein.set(next.vein);
  if (name === 'surprised') { character?.blinkCascade(); s.breath = 1.05; }
}
function applyState(name) {
  const row = STATES[name] || STATES.idle;
  KEYS.forEach((k, i) => { target[k] = row[i]; if (s[k] === undefined) s[k] = row[i]; });
  target.glow = new THREE.Color(row[8]);
  stateName = name;
}
applyState('idle');

let character = null;
let charId = null;
function setCharacter(id) {
  if (id === charId) return;
  character?.dispose();
  charId = id;
  character = id === 'machine' ? new Shoggoth(scene)
    : params.get('orb') ? new Orb(scene, id) : new VrmAvatar(scene, id);
}

// ---- lip-sync --------------------------------------------------------------------
let env = null, envFrameMs = 20, envStart = 0;
function speak(envelope, frameMs = 20, delayMs = 90) {
  env = Float32Array.from(envelope);
  envFrameMs = frameMs;
  envStart = performance.now() + delayMs;
  if (stateName !== 'speaking') applyState('speaking');
}
function envelopeNow(now) {
  if (!env) return 0;
  const i = Math.floor((now - envStart) / envFrameMs);
  if (i < 0) return 0;
  if (i >= env.length) { env = null; return 0; }
  return env[i];
}

// ---- touch: every eye follows your finger; a tap startles it -----------------------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -3);
let touchUntil = 0, touchPoint = new THREE.Vector3(), downAt = 0;
function pointerToFocus(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  ray.ray.intersectPlane(plane, touchPoint);
  touchUntil = performance.now() + 1500;
}
renderer.domElement.addEventListener('pointerdown', ev => { downAt = performance.now(); pointerToFocus(ev); });
renderer.domElement.addEventListener('pointermove', ev => { if (ev.buttons || ev.pointerType === 'touch') pointerToFocus(ev); });
renderer.domElement.addEventListener('pointerup', () => { if (performance.now() - downAt < 250) flinch(0.5); });

function flinch(strength = 1) {
  s.glitch = Math.max(s.glitch, strength);
  s.breath = 0.93;
  character?.blinkCascade();
}

// ---- loop ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  // Fit ~3.6 units wide and ~4.9 tall around the character, whichever is tighter.
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = Math.max(4.9 / 2 / half, 3.6 / 2 / (half * camera.aspect));
  camera.lookAt(0, -0.15, 0);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let running = true;
const timeOffset = parseFloat(params.get('t') || '0');
function frame() {
  if (!running) return;
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const now = performance.now();
  s.t = timer.getElapsed() + timeOffset;

  const k = 1 - Math.exp(-dt * 6.0);
  for (const key of KEYS) s[key] += (target[key] - s[key]) * k;
  // Emotions blend a little slower than states, so feelings read as moods, not twitches.
  const ke = 1 - Math.exp(-dt * 4.0);
  for (const key of EMO_KEYS) s.emo[key] += (emoTarget[key] - s.emo[key]) * ke;
  s.emo.glow.lerp(emoGlow, ke);
  s.emo.vein.lerp(emoVein, ke);
  if (calmAt && now > calmAt) { calmAt = 0; setEmotion('calm'); }
  s.glowColor.lerp(mixedGlow.copy(target.glow).lerp(s.emo.glow, s.emo.amount), k);

  const e = envelopeNow(now);
  s.mouth += (e - s.mouth) * (1 - Math.exp(-dt * (e > s.mouth ? 28 : 10)));
  s.speech += (e - s.speech) * (1 - Math.exp(-dt * 8));
  s.pulse = Math.max(s.pulse, s.speech * 0.9);
  s.breath += (1 + 0.015 * Math.sin(s.t * 0.9) - s.breath) * (1 - Math.exp(-dt * 4));
  s.glitch *= Math.exp(-dt * 6);
  s.nod = stateName === 'listening' ? Math.sin(s.t * 1.1) * 0.03 : s.nod * 0.95;
  s.tilt = stateName === 'thinking' ? Math.sin(s.t * 0.7) * 0.08 : s.tilt * 0.95;

  // Focus: your finger if touching, else you (the camera), in the character's space.
  const focusWorld = now < touchUntil ? touchPoint : camera.position;
  s.focus.copy(focusWorld);
  if (character?.group) character.group.worldToLocal(s.focus);
  if (now < touchUntil) s.eyeLock = 1;

  dustU.uTime.value = s.t;
  character?.update(s, dt);
  renderer.render(scene, camera);
}

window.avatar = {
  setCharacter,
  setState(name) {
    if (name === stateName) return;
    // Feelings outlast the reply a little, then settle.
    calmAt = name === 'idle' ? performance.now() + 6000 : 0;
    const wasThinking = stateName === 'thinking';
    applyState(name);
    if (name === 'listening' || wasThinking) character?.blinkCascade();
  },
  speak,
  stopSpeaking() { env = null; s.mouth = 0; },
  flinch,
  setEmotion,
  isLoaded: () => character?.vrm !== null,
  debug: () => character?.debug?.(),   // false while a VRM model is still loading
  pause() { running = false; },
  resume() { if (!running) { running = true; timer.update(); frame(); } },
};

setCharacter(params.get('char') || 'machine');
if (params.get('state')) window.avatar.setState(params.get('state'));
if (params.get('emo')) window.avatar.setEmotion(params.get('emo'));
frame();
window.AndroidAvatar?.onReady();
