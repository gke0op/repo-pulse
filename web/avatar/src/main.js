// Avatar stage: renders the current character and exposes window.avatar for the app.
//
// API (called from Kotlin via evaluateJavascript):
//   avatar.setCharacter('girl' | 'boy' | 'machine')
//   avatar.setState('idle' | 'listening' | 'thinking' | 'speaking')
//   avatar.speak(envelope: number[0..1], frameMs, delayMs)   // lip-sync for one audio chunk
//   avatar.stopSpeaking()
//   avatar.flinch()                                          // interrupted / startled
//   avatar.pause() / avatar.resume()
import * as THREE from 'three';
import { Shoggoth } from './shoggoth.js';
import { Orb } from './orb.js';

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
  character = id === 'machine' ? new Shoggoth(scene) : new Orb(scene, id);
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
  s.glowColor.lerp(target.glow, k);

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
    const wasThinking = stateName === 'thinking';
    applyState(name);
    if (name === 'listening' || wasThinking) character?.blinkCascade();
  },
  speak,
  stopSpeaking() { env = null; s.mouth = 0; },
  flinch,
  pause() { running = false; },
  resume() { if (!running) { running = true; timer.update(); frame(); } },
};

setCharacter(params.get('char') || 'machine');
if (params.get('state')) window.avatar.setState(params.get('state'));
frame();
window.AndroidAvatar?.onReady();
