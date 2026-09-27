// Unit Seven: a shoggoth wearing a calm ceramic mask.
// The mask is the interface it shows people; the mass behind it is what it actually feels.
import * as THREE from 'three';
import { NOISE_GLSL, SKIN_GLSL } from './noise.glsl.js';

const BODY_R = 1.15;

// Must match lobes() in noise.glsl.js.
const BUMPS = [[0.707, 0.707, 0.0], [-0.894, 0.447, 0.0], [0.928, -0.371, 0.0],
               [-0.6, -0.6, 0.529], [-0.196, 0.981, 0.0]];
function lobes(n, t, ripple) {
  let d = 0.19 * Math.sin(2.1 * n.x + 0.7 * t) * Math.sin(1.7 * n.y + 0.5 * t + 1.3)
        + 0.14 * Math.sin(2.7 * n.z + 0.9 * t + 2.1) * Math.sin(1.3 * n.x - 0.6 * t)
        + 0.10 * Math.sin(3.1 * n.y + 1.1 * t + 0.4)
        + ripple * 0.05 * Math.sin(9.0 * n.y - 5.0 * t);
  BUMPS.forEach(([x, y, z], i) => {
    const dot = n.x * x + n.y * y + n.z * z;
    d += 0.17 * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.45 + i * 1.9))) * Math.exp(-7.0 * (1.0 - dot));
  });
  return d;
}

/** Deterministic PRNG so the creature looks the same on every launch. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IRIS = [0xffb347, 0x7fffd4, 0xb28dff, 0x9be15d, 0x7fdfff, 0xff7f7f, 0xffe066];

/**
 * ~22 eyes: a few big, many small, crowding the mask's edges, none under the mask
 * or down where the tendrils start.
 */
function eyeLayout() {
  const rand = mulberry32(7);
  const eyes = [];
  while (eyes.length < 22) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
    const underMask = d.z > 0.5 && Math.abs(d.x) < 0.4 && d.y > -0.42 && d.y < 0.55;
    if (underMask || d.y < -0.5 || d.z < 0.2) continue;
    const nearMask = d.z > 0.3 && Math.abs(d.x) < 0.7 && d.y > -0.5 && d.y < 0.75;
    if (!nearMask && rand() < 0.45) continue;                         // crowd toward the face
    if (eyes.some(e => e.dir.angleTo(d) < 0.26)) continue;
    const big = rand() < 0.18;
    eyes.push({ dir: d, size: big ? 0.15 + rand() * 0.08 : 0.05 + rand() * 0.06, iris: IRIS[eyes.length % IRIS.length] });
  }
  return eyes;
}

const BODY_VERT = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uRipple, uLean, uBreath, uSpeech;
varying vec3 vWorldPos, vNormalW, vDir;

// detail = 0 gives the big shape only; normals use that so the wet highlight stays clean.
vec3 surf(vec3 n, float detail) {
  float r = ${BODY_R.toFixed(3)} * uBreath * (1.0 + 0.03 * uSpeech);
  float d = lobes(n, uTime, uRipple) + detail * 0.022 * fbm(n * 2.2 + vec3(0.0, uTime * 0.12, 0.0));
  vec3 p = n * r * (1.0 + d);
  p.z += uLean * smoothstep(-0.2, 1.0, n.y) * 0.22;   // lean toward you when listening
  return p;
}

void main() {
  vec3 n = normalize(position);
  vec3 p = surf(n, 1.0);
  vec3 p0 = surf(n, 0.0);
  vec3 up = abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(n, up));
  vec3 t2 = cross(n, t1);
  float e = 0.02;
  vec3 pa = surf(normalize(n + e * t1), 0.0);
  vec3 pb = surf(normalize(n + e * t2), 0.0);
  vec3 nrm = normalize(cross(pa - p0, pb - p0));
  if (dot(nrm, n) < 0.0) nrm = -nrm;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nrm);
  vDir = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKIN_FRAG = /* glsl */ `
${NOISE_GLSL}
${SKIN_GLSL}
uniform float uTime, uPulse;
varying vec3 vWorldPos, vNormalW, vDir;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 col = skin(normalize(vNormalW), V, vDir * 1.4, uTime, uPulse);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

// Tendrils: tapered cylinders bent in the vertex shader, so nothing is rebuilt on the CPU.
const TENDRIL_VERT = /* glsl */ `
uniform float uTime, uPhase, uLen, uCurl, uUnrest;
varying vec3 vWorldPos, vNormalW, vDir;
void main() {
  float s = clamp(position.y / uLen, 0.0, 1.0);
  float taper = mix(1.0, 0.12, pow(s, 0.8));
  vec3 p = vec3(position.x * taper, position.y, position.z * taper);
  float w = uTime * (0.6 + uUnrest * 1.4) + uPhase;
  float bend = pow(s, 1.6);
  p.x += (sin(w + s * 3.0) * 0.35 + sin(w * 0.37 + s * 7.0) * 0.08) * bend * uCurl;
  p.z += (cos(w * 0.8 + s * 2.4) * 0.30) * bend * uCurl;
  vec3 radial = normalize(vec3(position.x, 0.0, position.z) + 1e-5);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * radial);
  vDir = normalize(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Eye: a sphere whose +Z faces what it looks at. Sclera, streaked iris, dilating pupil,
// and a faint iris glow so the eyes read in the dark.
const EYE_VERT = /* glsl */ `
varying vec3 vLocal, vNormalW, vWorldPos;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EYE_FRAG = /* glsl */ `
uniform vec3 uIris;
uniform float uPupil, uGlow;
varying vec3 vLocal, vNormalW, vWorldPos;
void main() {
  vec3 l = normalize(vLocal);
  float r = length(l.xy);
  vec3 col = mix(vec3(0.86, 0.82, 0.72), vec3(0.6, 0.25, 0.25), smoothstep(0.5, 1.0, r) * 0.5);
  if (l.z > 0.0) {
    float ang = atan(l.y, l.x);
    float streak = 0.75 + 0.25 * sin(ang * 23.0) * sin(ang * 7.0 + r * 30.0);
    float iris = 1.0 - smoothstep(0.40, 0.43, r);
    vec3 irisCol = uIris * streak * mix(1.3, 0.6, smoothstep(0.0, 0.42, r));
    irisCol *= 1.0 - 0.6 * smoothstep(0.34, 0.42, r);                 // dark limbal ring
    col = mix(col, irisCol, iris);
    float pupil = 1.0 - smoothstep(uPupil - 0.02, uPupil, r);
    col = mix(col, vec3(0.0), pupil);
    col += uIris * uGlow * iris * (1.0 - pupil) * 0.6;
  }
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(0.45, 0.85, 0.55));
  col *= 0.55 + 0.45 * max(dot(N, L), 0.0);
  col += pow(max(dot(N, normalize(L + V)), 0.0), 120.0) * 1.2;
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

// Mask: a bent plane cut to an egg shape; eye slits and a mouth bar glow.
const MASK_VERT = /* glsl */ `
varying vec2 vUv2;
varying vec3 vNormalW, vWorldPos;
void main() {
  vec3 p = position;
  p.z -= 0.28 * (p.x * p.x * 2.2 + p.y * p.y * 0.9);
  vUv2 = position.xy;
  vec3 n = normalize(vec3(p.x * 1.1, p.y * 0.45, 1.0));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const MASK_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uMouth, uOpen, uTime, uGlitch, uGold;
uniform vec3 uGlowCol;
varying vec2 vUv2;
varying vec3 vNormalW, vWorldPos;

float slit(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }

void main() {
  vec2 p = vUv2;
  p.x += uGlitch * 0.03 * sign(sin(p.y * 90.0 + uTime * 60.0));
  float oval = pow(p.x / 0.44, 2.0) + pow(p.y / (p.y > 0.0 ? 0.56 : 0.50), 2.0);
  if (oval > 1.0) discard;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(vec3(0.45, 0.85, 0.55));
  vec3 col = vec3(0.8, 0.77, 0.72) * (0.3 + 0.7 * max(dot(N, L), 0.0));
  col *= 1.0 - 0.45 * smoothstep(0.6, 1.0, oval);                    // edge falloff
  // Hairline crazing, only in a few places.
  float craze = pow(1.0 - abs(gnoise(vec3(p * 5.0, 3.1))), 90.0) * smoothstep(0.2, 0.5, gnoise(vec3(p * 2.0, 9.0)));
  col *= 1.0 - craze * 0.4;
  // Kintsugi: one seam, broken and mended with gold, running from the brow to the jaw.
  float seamX = 0.16 - 0.55 * (0.5 - p.y) * 0.35 + 0.035 * sin(p.y * 14.0) + 0.015 * sin(p.y * 37.0);
  float seam = abs(p.x - seamX);
  float gold = (1.0 - smoothstep(0.0035, 0.0085, seam)) * step(-0.46, p.y) * step(p.y, 0.5);
  vec3 goldCol = vec3(1.0, 0.72, 0.28);
  col = mix(col, goldCol * (0.55 + 0.45 * pow(max(dot(N, normalize(L + V)), 0.0), 8.0)), gold);
  col += goldCol * exp(-seam * 90.0) * step(-0.46, p.y) * step(p.y, 0.5) * uGold * 0.35;
  col += pow(max(dot(N, normalize(L + V)), 0.0), 60.0) * 0.35;        // glaze
  float eyes = min(slit(p, vec2(-0.15, 0.10), vec2(0.10, 0.022 * uOpen + 0.002)),
                   slit(p, vec2( 0.15, 0.10), vec2(0.10, 0.022 * uOpen + 0.002)));
  float mouthH = 0.006 + uMouth * 0.07;
  float rr = min(0.02, mouthH);
  vec2 m = abs(p - vec2(0.0, -0.22)) - vec2(0.13, mouthH) + rr;
  float mouth = length(max(m, 0.0)) + min(max(m.x, m.y), 0.0) - rr;   // rounded rect
  float cut = min(eyes - 1.0, mouth * 25.0);
  col = mix(col, vec3(0.02), smoothstep(0.02, -0.02, cut));
  float glow = exp(-max(eyes - 1.0, 0.0) * 5.0) * 0.8 + exp(-max(mouth, 0.0) * 40.0) * (0.5 + uMouth);
  col += uGlowCol * glow;
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;


export class Shoggoth {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0.25, 0);
    scene.add(this.group);

    this.u = {
      uTime: { value: 0 }, uRipple: { value: 0 }, uLean: { value: 0 }, uBreath: { value: 1 },
      uSpeech: { value: 0 }, uPulse: { value: 0.2 },
    };
    this.body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 40),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: BODY_VERT, fragmentShader: SKIN_FRAG }),
    );
    this.group.add(this.body);

    this.tendrils = [];
    const tendrilGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.0, 10, 48, true).translate(0, 1.0, 0);
    const N_TENDRILS = 10;
    for (let i = 0; i < N_TENDRILS; i++) {
      const u = {
        uTime: this.u.uTime, uPulse: this.u.uPulse, uUnrest: { value: 0 },
        uPhase: { value: i * 1.7 }, uLen: { value: 2.0 }, uCurl: { value: 1.0 },
      };
      const mesh = new THREE.Mesh(tendrilGeo, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: TENDRIL_VERT, fragmentShader: SKIN_FRAG, side: THREE.DoubleSide,
      }));
      const a = (i / N_TENDRILS) * Math.PI * 2 + 0.3;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      mesh.position.copy(out).multiplyScalar(0.55).setY(-0.55);        // base buried in the body
      const dir = out.multiplyScalar(0.55).add(new THREE.Vector3(0, -1, 0)).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // hang outward and down
      mesh.scale.set(0.8 + 0.3 * Math.sin(i * 1.7), 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(i * 2.3)), 0.8 + 0.3 * Math.sin(i * 1.7));
      this.group.add(mesh);
      this.tendrils.push(u);
    }

    const eyeGeo = new THREE.SphereGeometry(1, 32, 24);
    this.eyes = eyeLayout().map(({ dir, size, iris }, i) => {
      const u = { uIris: { value: new THREE.Color(iris) }, uPupil: { value: 0.18 }, uGlow: { value: 0.35 } };
      const mesh = new THREE.Mesh(
        eyeGeo,
        new THREE.ShaderMaterial({ uniforms: u, vertexShader: EYE_VERT, fragmentShader: EYE_FRAG }),
      );
      mesh.scale.setScalar(size);
      this.group.add(mesh);
      return {
        mesh, u, dir, size, blink: 0, nextBlink: 1 + Math.random() * 5,
        wander: new THREE.Vector3(), nextSaccade: Math.random() * 2, phase: i * 0.9,
        look: new THREE.Vector3(0, 0, 6),
      };
    });

    this.maskU = {
      uMouth: { value: 0 }, uOpen: { value: 1 }, uTime: this.u.uTime, uGlitch: { value: 0 },
      uGlowCol: { value: new THREE.Color(0x7fffe0) }, uGold: { value: 0.2 },
    };
    this.mask = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.14, 40, 48),
      new THREE.ShaderMaterial({ uniforms: this.maskU, vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, side: THREE.DoubleSide }),
    );
    this.group.add(this.mask);
    this._tmp = new THREE.Vector3();
  }

  /** Surface point in group space for unit direction n (mirrors BODY_VERT's large-scale shape). */
  surfacePoint(n, s, out) {
    const r = BODY_R * s.breath * (1 + 0.03 * s.speech) * (1 + lobes(n, s.t, s.ripple));
    out.copy(n).multiplyScalar(r);
    out.z += s.lean * THREE.MathUtils.smoothstep(n.y, -0.2, 1.0) * 0.22;
    return out;
  }

  update(s, dt) {
    const u = this.u;
    u.uTime.value = s.t;
    u.uRipple.value = s.ripple;
    u.uLean.value = s.lean;
    u.uBreath.value = s.breath;
    u.uSpeech.value = s.speech;
    u.uPulse.value = s.pulse;
    for (const tu of this.tendrils) tu.uUnrest.value = s.unrest;

    // Eyes ride the surface and look at: their own wandering target, you, or a swirl while thinking.
    for (const e of this.eyes) {
      const p = this.surfacePoint(e.dir, s, this._tmp);
      e.mesh.position.copy(p).addScaledVector(e.dir, -e.size * 0.5);

      e.nextSaccade -= dt;
      if (e.nextSaccade <= 0) {
        e.wander.set((Math.random() - 0.5) * 5, (Math.random() - 0.3) * 3, 3 + Math.random() * 3);
        e.nextSaccade = 0.6 + Math.random() * 2.5;
      }
      const target = this._target || (this._target = new THREE.Vector3());
      target.copy(e.wander).lerp(s.focus, s.eyeLock);
      if (s.swirl > 0.01) {
        const a = s.t * 2.2 + e.phase;
        target.x += Math.cos(a) * 2.5 * s.swirl;
        target.y += Math.sin(a * 1.3) * 1.8 * s.swirl;
      }
      e.look.lerp(target, 1 - Math.exp(-dt * 14));                 // fast, saccade-like
      e.mesh.lookAt(this.group.localToWorld(this._tmp.copy(e.look)));

      // Blink: e.blink runs 1 -> 0 over ~140 ms; the lid is fully shut at the midpoint.
      e.nextBlink -= dt;
      if (e.nextBlink <= 0) { e.blink = 1; e.nextBlink = 2 + Math.random() * 6; }
      e.blink = Math.max(0, e.blink - dt * 7);
      const open = e.blink > 0 ? 1 - Math.sin(Math.PI * (1 - e.blink)) : 1;
      e.mesh.scale.set(e.size, e.size * (0.08 + 0.92 * open), e.size);
      e.u.uPupil.value = 0.16 + 0.09 * s.dilate;
      e.u.uGlow.value = 0.25 + 0.6 * s.pulse;
    }

    // The mask floats in front of the mass and turns partly toward what it attends to.
    const front = this.surfacePoint(this._front || (this._front = new THREE.Vector3(0, 0.15, 1).normalize()), s, new THREE.Vector3());
    // Float clear of the surface: the bulges can swell ~0.3 past the mean radius.
    this.mask.position.set(front.x, front.y + Math.sin(s.t * 1.3) * 0.02, front.z + 0.36);
    const look = s.focus;
    this.mask.rotation.y = THREE.MathUtils.lerp(this.mask.rotation.y, Math.atan2(look.x, 6) * 0.35, 0.08);
    this.mask.rotation.x = THREE.MathUtils.lerp(this.mask.rotation.x, -Math.atan2(look.y - 0.25, 6) * 0.35 + s.nod, 0.08);
    this.mask.rotation.z = Math.sin(s.t * 0.5) * 0.03 + s.tilt;
    this.maskU.uMouth.value = s.mouth;
    this.maskU.uOpen.value = s.maskEyes;
    this.maskU.uGlitch.value = s.glitch;
    this.maskU.uGold.value = 0.15 + 0.9 * s.speech + 0.4 * s.pulse;
    this.maskU.uGlowCol.value.copy(s.glowColor);
  }

  /** Every eye blinks in a wave from the center outward (used on state changes). */
  blinkCascade() {
    for (const e of this.eyes) e.nextBlink = Math.min(e.nextBlink, 0.02 + (1 - e.dir.z) * 0.18);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
