// The orb: a newborn being of light. It's the onboarding's first character ('orb'), and Mira's and
// Kai's plasma look. It has no face, so it feels through where it goes, how big it gets, how fast it
// moves and what colour it turns: the whole 9:16 stage is its body language. Its skin stays calm.
//  - calm: floats a little above the middle, drifting.
//  - a tap is a hello: it hops up, grows, brightens and comes closer. Tap it a few times quickly and
//    it gets excited: small, bright and fast, bouncing off the edges of the screen.
//  - hold your finger down and it comes to hover just above it, following as you move.
//  - happy hops in place; sad sinks to the bottom edge, half hidden, dim; angry swells big and red
//    and shakes; surprised shrinks, then pops up; curious leans to one side, then the other;
//    tender comes close, big and warm; listening leans in; thinking rises and circles.
//  - it looks where it cares (a soft light inside it: you, your finger, where it's flying), glances
//    away now and then, and blinks. Asleep, it sinks low and small with its light shut.
// Moves are damped springs (a little overshoot, then settle); bounces press its soft skin, never its shape.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

const VERT = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uWobble, uStretch;
uniform vec3 uAxis;
varying vec3 vN, vW, vP;
// A firm body under a soft skin: squash, stretch and wobble only move the outer uShell of the radius,
// easing into that limit, so it always stays an orb.
uniform float uShell;
vec3 shape(vec3 n) {
  float along = dot(n, uAxis);
  float r = length(uAxis * along * (1.0 + uStretch) + (n - uAxis * along) / sqrt(1.0 + uStretch));
  float d = r - 1.0 + gnoise(n * 1.4 + vec3(0.0, uTime * 0.3, uTime * 0.2)) * uWobble;
  return n * 0.8 * (1.0 + uShell * tanh(d / uShell));
}
void main() {
  vec3 n = normalize(position);
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec3 p = shape(n);
  vec3 no = normalize(cross(shape(normalize(n + t1 * 0.03)) - p, shape(normalize(n + t2 * 0.03)) - p));
  if (dot(no, n) < 0.0) no = -no;
  vP = n * 0.8;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * no);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uColA, uColB, uGaze, uCoreCol;
uniform float uTime, uEnergy, uSwirl, uOpen, uPupil, uAwake, uGold, uFill, uFillOn;
varying vec3 vN, vW, vP;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(normalize(vN), V), 0.0);
  vec3 q = vP * 1.4 + vec3(0.0, uTime * (0.12 + uSwirl * 0.5), uTime * 0.04);
  float warp = fbm(q + fbm(q * 0.7) * 1.5);
  float thread = pow(1.0 - abs(warp), 7.0);                            // plasma filaments
  float fres = pow(1.0 - ndv, 2.4);
  vec3 col = uColA * 0.04;
  col += mix(uColA, uColB, 0.5 + 0.5 * warp) * thread * (0.35 + 0.9 * uEnergy) * (0.4 + 0.6 * ndv);
  col += mix(uColA, uColB, 0.6) * fres * (0.55 + 0.8 * uEnergy);
  // Its gaze: a soft light on the side it's looking at. A blink squeezes it shut like a lid.
  vec3 n = normalize(vP);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), uGaze));
  vec3 u = cross(uGaze, r);
  vec2 e = vec2(dot(n, r), dot(n, u) / max(uOpen, 0.04)) / uPupil;
  float lit = smoothstep(0.0, 0.3, dot(n, uGaze)) * smoothstep(0.02, 0.25, uOpen);
  float ee = dot(e, e);
  col += uCoreCol * (exp(-ee * 4.0) * 0.6 + exp(-ee * 30.0) * 0.7) * lit * (0.45 + 0.55 * ndv);
  col += vec3(1.0, 0.72, 0.42) * uGold * pow(ndv, 2.0) * 0.16 * (0.6 + 0.4 * thread);  // tender warmth
  // Progress: it fills with light from below, a gently moving surface line.
  float h = vP.y / 0.8;
  float line = mix(-1.05, 1.05, uFill) + 0.035 * sin(vP.x * 7.0 + uTime * 2.2) + 0.02 * sin(vP.z * 9.0 - uTime * 1.6);
  float below = smoothstep(line + 0.03, line - 0.03, h);
  float edge = exp(-pow((h - line) * 22.0, 2.0));
  col += (mix(uColA, uColB, 0.7) * 0.35 * below * (0.5 + 0.5 * ndv) + uColB * edge * 0.5) * uFillOn;
  col *= mix(0.3, 1.0, uAwake);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform float uEnergy, uAwake;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = exp(-d * d * 3.5) * (0.25 + 0.45 * uEnergy) * mix(0.35, 1.0, uAwake);
  gl_FragColor = vec4(uColA * a, a);
}`;

const PALETTES = {
  girl: [0xff6f91, 0xffc15e],
  boy: [0x3f7fff, 0x7fe0ff],
  orb: [0x8f7dff, 0x9ff6ff],   // its own: between Mira's warmth and Kai's cool, neither of them
  machine: [0x2fbfa0, 0xffc86b],   // Seven: his mask's teal and a hairline of kintsugi gold
};
const R = 0.8;   // radius at size 1
const SKIN = 0.025;   // how much of the radius is soft skin (the person: 6% was still too much)

// A damped spring: f in Hz, z the damping ratio (below 1 it overshoots, then settles).
class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  step(target, dt, f, z) {
    const w = 2 * Math.PI * f, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (w * w * (target - this.x) - 2 * z * w * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}
// Seeded, so the screenshot harness sees the same life every run.
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, k) => a + (b - a) * k;
const smooth = x => x * x * (3 - 2 * x);

export class Orb {
  constructor(scene, id) {
    const [a, b] = PALETTES[id] || PALETTES.boy;
    this.u = {
      uColA: { value: new THREE.Color(a) }, uColB: { value: new THREE.Color(b) },
      uTime: { value: 0 }, uEnergy: { value: 0.2 }, uSwirl: { value: 0 }, uAwake: { value: 1 },
      uWobble: { value: 0.006 }, uShell: { value: SKIN }, uStretch: { value: 0 }, uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uGaze: { value: new THREE.Vector3(0, 0, 1) }, uCoreCol: { value: new THREE.Color(1, 1, 1) },
      uOpen: { value: 1 }, uPupil: { value: 0.4 }, uGold: { value: 0 }, uFill: { value: 0 }, uFillOn: { value: 0 },
    };
    this.group = new THREE.Group();
    this.group.position.set(0, 0.1, 0);
    this.sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(R, 16),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG }),
    );
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.ShaderMaterial({
        uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: HALO_FRAG,
      }),
    );
    this.halo.position.z = -0.6;
    this.group.add(this.halo, this.sphere);
    scene.add(this.group);

    this.maxFps = 120;   // light to draw, and it lives by its motion: the panel's full rate
    this.rand = rng(7);
    this.clock = 0;
    this.pos = [new Spring(0), new Spring(0.1)];
    this.trail = [new Spring(0), new Spring(0.1)];     // the halo lags the body: follow-through
    this.size = new Spring(1);
    this.stretch = new Spring(0);
    this.axis = [new Spring(0), new Spring(1)];
    this.gaze = [new Spring(0), new Spring(0)];        // offsets from looking right at what it cares about
    this.pupil = new Spring(1);
    this.bright = new Spring(0);
    this.breathPhase = 0; this.hopWas = 0;
    this.glance = null; this.nextGlance = 2.5; this.nextBlink = 1.2; this.blinkAt = -9; this.blinkAgain = 0;
    this.firm = 0; this.joy = 0; this.taps = []; this.excitedUntil = 0; this.excite = 0;
    this.peekSide = 1; this.nextPeek = 0; this.lastEmo = 'calm';
    this.hue = 0;
    this.gazeDir = new THREE.Vector3(0, 0, 1);
    this._base = this.u.uColA.value.clone();
    this._baseB = this.u.uColB.value.clone();
    this._toA = this._base.clone(); this._toB = this._baseB.clone();
    this.fill = new Spring(0); this.fillOn = 0; this.fillWant = 0; this.fillStrength = 0;
    this.tune = -1;   // finding its voice: 0 high (small) .. 1 deep (big); < 0 off
    this._white = new THREE.Color(1, 1, 1);
    this._warm = new THREE.Color(0xffe3a0);
    this._excited = new THREE.Color();
  }

  /** A blink: the inner light squeezes shut and opens again. */
  blinkCascade() { if (this.clock - this.blinkAt > 0.25) this.blinkAt = this.clock; }

  /** A tap is a hello: a hop up, a little bigger, brighter. A few quick taps: it gets excited. */
  tap() {
    const t = this.clock;
    this.joy = 1;
    this.pos[1].v += 3.2;
    this.size.v += 1.6 * (1 - 0.8 * this.firm);
    this.pupil.v += 2.5;
    this.taps = this.taps.filter(x => t - x < 2).concat(t);
    if (this.taps.length >= 3) {
      if (this.excitedUntil < t) {   // off it goes, in a random upward direction
        const a = Math.PI * (0.15 + 0.7 * this.rand());
        this.pos[0].v = Math.cos(a) * 6; this.pos[1].v = Math.sin(a) * 6;
      }
      this.excitedUntil = t + 4.5;
    }
  }

  /** Progress as filling with light (level 0..1); a negative level empties it and fades it out. */
  setFill(level, strength = 1) {
    if (level < 0) { this.fillStrength = 0; return; }
    this.fillWant = clamp(level, 0, 1); this.fillStrength = clamp(strength, 0, 1);
  }

  /** Finding its voice (the onboarding): u 0 = high and small .. 1 = deep and big; < 0 ends it. */
  setTune(u) { this.tune = u < 0 ? -1 : clamp(u, 0, 1); }

  /** Take on a character's colours (the tour's voices, the choice); 'orb' is its own. */
  setPalette(id) {
    const [a, b] = PALETTES[id] || PALETTES.orb;
    this._toA.set(a); this._toB.set(b);
  }

  /** Startled (interrupted): a quick shrink, then it pops back. Never pushed around. */
  poke(strength = 1) {
    this.size.v -= 2.2 * strength * (1 - 0.8 * this.firm);
    this.pos[1].v += 1.2 * strength;
    this.blinkCascade();
  }

  update(s, dt = 1 / 60) {
    const t = (this.clock += dt), E = s.emo, u = this.u;
    const awake = s.awake ?? 1, asleep = 1 - awake;
    const v = s.view || { x0: -1.8, x1: 1.8, y0: -3.3, y1: 3.0 };
    const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, hw = (v.x1 - v.x0) / 2, hh = (v.y1 - v.y0) / 2;
    // Below zero, the skin is already a perfect sphere, so firmness goes on: its size stops bouncing
    // (no overshoot), and its breath and growth get smaller. Fully firm at -5%.
    const skin = s.skin ?? SKIN;
    this.firm = clamp(-skin / 0.05, 0, 1);
    const emo = s.emoName || 'calm', state = s.state || 'idle', touching = !!s.touch;
    const excited = t < this.excitedUntil && awake > 0.5;
    this.joy *= Math.exp(-dt * 1.2);
    if (emo !== this.lastEmo) {                 // entrances
      if (emo === 'surprised') { this.size.v -= 3 * (1 - 0.8 * this.firm); this.pos[1].v += 2.5; this.blinkCascade(); }
      if (emo === 'happy') this.pos[1].v += 2;
      this.lastEmo = emo;
    }

    // Where it wants to be, how big, how bright, and how lively it moves there.
    let tx = cx + (Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.19 + 1.3) * 0.4) * 0.12 * hw * awake;
    let ty = cy + 0.12 * hh + Math.sin(t * 0.8) * 0.05 + Math.sin(t * 0.27 + 2.1) * 0.05 * hh * awake;
    let size = 1, bright = 0, pace = 1, shake = 0;
    switch (emo) {
      case 'happy': {
        size = 1.1; bright = 0.25; pace = 1.4;
        const hs = Math.sin(t * 2 * Math.PI * 0.9);
        ty += 0.12 * hh * Math.pow(Math.max(0, hs), 0.8);
        if (this.hopWas > 0 && hs <= 0) { this.stretch.v -= 1.6; this.axis[0].x = 0; this.axis[1].x = 1; }
        this.hopWas = hs;
        break;
      }
      case 'sad': size = 0.78; bright = -0.35; pace = 0.45; tx = cx - 0.25 * hw; ty = v.y0 + 0.05; break;
      case 'angry': size = 1.4; bright = 0.1; pace = 0.8; ty = cy; shake = 0.035; break;
      case 'surprised': size = 1.15; bright = 0.45; pace = 1.6; ty = cy + 0.3 * hh; break;
      case 'curious': {   // leans to one side, then the other, bobbing, its eyes darting (never hiding:
        // it's curious about you, and it asks you things in this mood)
        if (t > this.nextPeek) { this.peekSide = -this.peekSide; this.nextPeek = t + 3 + 2 * this.rand(); }
        size = 0.95; bright = 0.1; pace = 1.2;
        tx = cx + this.peekSide * 0.3 * hw;
        ty = cy + 0.15 * hh + Math.sin(t * 1.3) * 0.06 * hh;
        break;
      }
      case 'tender': size = 1.55; bright = 0.15; pace = 0.5; ty = cy + 0.05 * hh; break;
    }
    if (state === 'listening') { size *= 1.12; bright += 0.1; }
    if (state === 'thinking') {
      size *= 0.9; pace *= 0.8;
      tx = mix(tx, cx + Math.cos(t * 0.7) * 0.3 * hw, 0.8);
      ty = mix(ty, cy + 0.4 * hh + Math.sin(t * 0.7) * 0.12 * hh, 0.8);
    }
    if (state === 'speaking') { size *= 1 + 0.07 * s.mouth; ty += 0.03 * Math.sin(t * 5) * s.speech; }
    if (s.hear > 0.02) { size *= 1 + 0.12 * s.hear; bright += 0.4 * s.hear; }   // it pulses with your voice
    if (this.tune >= 0) size *= mix(0.7, 1.35, this.tune);                        // a high voice is small, a deep one big
    if (touching && !excited) {                   // it comes to you, and hovers just above your finger
      tx = mix(tx, s.finger?.x ?? cx, 0.85);
      ty = mix(ty, (s.finger?.y ?? cy) + R * size * 1.3, 0.85);
      size *= 1.08; bright += 0.2;
    }
    size *= 1 + 0.2 * this.joy;
    bright += 0.5 * this.joy;
    tx = mix(tx, cx, asleep); ty = mix(ty, v.y0 + 0.35 * hh, asleep);
    size *= 1 - 0.35 * asleep; bright -= 0.3 * asleep; pace *= 1 - 0.6 * asleep;
    if (excited) { size = 0.4; bright = 0.9; }

    const sz = this.size.step(size, dt, 2 + 0.6 * pace, mix(0.45, 1, this.firm));
    const rad = R * Math.max(sz, 0.2);
    // Breath: in quicker than out; slower asleep or sad, quicker when stirred up.
    this.breathPhase += dt * (0.24 + 0.12 * E.energy + 0.08 * s.speech) * (1 - 0.45 * asleep) * (emo === 'sad' ? 0.75 : 1);
    const ph = this.breathPhase % 1;
    const breath = ((ph < 0.4 ? smooth(ph / 0.4) : 1 - smooth((ph - 0.4) / 0.6)) - 0.5) * (0.035 + 0.03 * asleep) * (1 - 0.8 * this.firm);

    // Moving: springs toward where it wants to be, or free flight when excited (bouncing off edges).
    const P = this.pos;
    if (excited) {
      let vx = P[0].v, vy = P[1].v;
      const turn = (this.rand() - 0.5) * 3 * dt;                  // a little wayward
      [vx, vy] = [vx * Math.cos(turn) - vy * Math.sin(turn), vx * Math.sin(turn) + vy * Math.cos(turn)];
      const sp = Math.hypot(vx, vy) || 1, want = 5.5;
      vx *= mix(1, want / sp, 1 - Math.exp(-dt * 3)); vy *= mix(1, want / sp, 1 - Math.exp(-dt * 3));
      let x = P[0].x + vx * dt, y = P[1].x + vy * dt;
      const hit = (nx, ny) => { this.stretch.v -= 3; this.axis[0].x = nx; this.axis[1].x = ny; this.axis[0].v = this.axis[1].v = 0; };
      if (x < v.x0 + rad) { x = v.x0 + rad; vx = Math.abs(vx); hit(1, 0); }
      if (x > v.x1 - rad) { x = v.x1 - rad; vx = -Math.abs(vx); hit(1, 0); }
      if (y < v.y0 + rad) { y = v.y0 + rad; vy = Math.abs(vy); hit(0, 1); }
      if (y > v.y1 - rad) { y = v.y1 - rad; vy = -Math.abs(vy); hit(0, 1); }
      P[0].x = x; P[0].v = vx; P[1].x = y; P[1].v = vy;
    } else {
      const f = 0.9 * pace, z = 0.5 + 0.2 * asleep;
      P[0].step(tx, dt, f, z); P[1].step(ty, dt, f, z);
    }
    const px = P[0].x + shake * Math.sin(t * 31) * Math.sin(t * 17.3), py = P[1].x + shake * Math.sin(t * 27.1) * Math.sin(t * 13.7);
    this.group.position.set(px, py, 0);
    const hx = this.trail[0].step(P[0].x, dt, 1.4, 0.6), hy = this.trail[1].step(P[1].x, dt, 1.4, 0.6);
    const lag = Math.hypot(hx - P[0].x, hy - P[1].x), keep = Math.min(1, 0.25 * sz / (lag || 1));  // trails, never detaches
    this.halo.position.set((hx - P[0].x) * keep / sz, (hy - P[1].x) * keep / sz, -0.6);
    this.group.scale.setScalar(sz * (1 + breath));

    // Squash and stretch, gently: along its flight, and on landing or hitting an edge.
    const vx = P[0].v, vy = P[1].v, speed = Math.hypot(vx, vy);
    const st = this.stretch.step(Math.min(speed * 0.025, 0.14), dt, 4, 0.4);
    u.uStretch.value = clamp(st, -0.28, 0.25);
    let ax = speed > 0.3 ? vx / speed : 0, ay = speed > 0.3 ? vy / speed : 1;
    if (ay < 0) { ax = -ax; ay = -ay; }                 // an axis, not a direction
    u.uAxis.value.set(this.axis[0].step(ax, dt, 3, 0.8), this.axis[1].step(ay, dt, 3, 0.8), 0).normalize();

    // Gaze: you or your finger; where it's flying when excited. It glances away now and then
    // (more when curious, rarely while listening), looks up while thinking, down when sad or asleep.
    const dir = excited ? this.gazeDir.set(vx, vy, 3).normalize() : this.gazeDir.copy(s.focus).normalize();
    if (!touching && s.hear < 0.15 && awake > 0.8 && !this.glance && t > this.nextGlance) {
      this.glance = { x: (this.rand() - 0.5) * 1.2, y: (this.rand() - 0.4) * 0.8, until: t + 0.35 + this.rand() * 0.9 };
    }
    if (this.glance && (t > this.glance.until || touching)) {
      this.glance = null;
      this.nextGlance = t + (2.5 + this.rand() * 4) * (1 + 1.5 * s.eyeLock) / (1 + 1.5 * Math.max(0, E.dilate));
    }
    const peekLook = emo === 'curious' ? -this.peekSide * 0.3 : 0;   // leaning out, it looks back in
    const gx = this.gaze[0].step((this.glance?.x ?? 0) + peekLook + Math.cos(t * 0.9) * 0.35 * s.swirl, dt, 6, 0.75);
    const gy = this.gaze[1].step((this.glance?.y ?? 0) + (0.45 + Math.sin(t * 0.9) * 0.15) * s.swirl
      + 0.35 * E.gaze - 0.7 * asleep, dt, 6, 0.75);
    u.uGaze.value.set(dir.x + gx, dir.y + gy, Math.max(dir.z, 0.25)).normalize();

    // Blinks: every few seconds awake, sometimes twice.
    if (awake > 0.9 && t > this.nextBlink) {
      this.blinkCascade();
      this.blinkAgain = this.rand() < 0.2 ? t + 0.3 : 0;
      this.nextBlink = t + 2.2 + this.rand() * 4.5;
    }
    if (this.blinkAgain && t > this.blinkAgain) { this.blinkAgain = 0; this.blinkCascade(); }
    const bt = t - this.blinkAt, lid = bt < 0.2 ? Math.sin(Math.PI * bt / 0.2) : 0;
    u.uOpen.value = clamp(E.open, 0.4, 1.5) * (1 - lid) * smooth(clamp((awake - 0.25) / 0.6, 0, 1));
    const pupil = this.pupil.step(1, dt, 2.5, 0.45);
    u.uPupil.value = 0.38 * (1 + 0.25 * s.dilate + 0.3 * E.dilate) * clamp(pupil, 0.6, 1.8);

    // Colour: its palette (eased toward another character's), the feeling's tint, a warm flash of
    // joy; excited, it runs through bright hues.
    const kp = 1 - Math.exp(-dt * 2);
    this._base.lerp(this._toA, kp); this._baseB.lerp(this._toB, kp);
    const br = this.bright.step(bright, dt, 1.5, 0.7);
    u.uColA.value.copy(this._base).lerp(E.glow, 0.7 * E.amount).lerp(this._warm, 0.6 * this.joy);
    u.uColB.value.copy(this._baseB).lerp(E.glow, 0.45 * E.amount).lerp(this._warm, 0.5 * this.joy);
    this.hue = (this.hue + dt * 0.6) % 1;
    this.excite = mix(this.excite ?? 0, excited ? 1 : 0, 1 - Math.exp(-dt * 4));
    if (this.excite > 0.01) {
      this._excited.setHSL(this.hue, 1, 0.55);
      u.uColA.value.lerp(this._excited, 0.9 * this.excite);
      u.uColB.value.lerp(this._excited.setHSL((this.hue + 0.12) % 1, 1, 0.65), 0.7 * this.excite);
    }
    u.uCoreCol.value.copy(this._white).lerp(u.uColB.value, 0.35).lerp(E.glow, 0.3 * E.amount);
    u.uTime.value = s.t;
    u.uSwirl.value = s.swirl;
    u.uEnergy.value = Math.max(0.05, 0.15 + 0.35 * s.eyeLock * s.lean + 0.9 * s.speech + 0.3 * s.swirl + 0.3 * E.energy + br);
    u.uAwake.value = awake;
    u.uShell.value = Math.max(0.001, skin);
    u.uGold.value = E.gold;
    u.uFill.value = this.fill.step(this.fillStrength ? this.fillWant : 0, dt, 1.2, 0.8);
    this.fillOn += (this.fillStrength - this.fillOn) * (1 - Math.exp(-dt * 3));
    u.uFillOn.value = this.fillOn;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
