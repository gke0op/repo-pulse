// Placeholder presence for characters whose real avatar isn't made yet:
// a softly breathing orb that brightens when it listens and pulses with its voice.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

const VERT = /* glsl */ `
varying vec3 vN, vW, vP;
void main() {
  vP = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uColA, uColB;
uniform float uTime, uEnergy, uSwirl;
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
  col += vec3(1.0) * pow(ndv, 6.0) * 0.05 * (1.0 + uEnergy);          // faint hot core
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform float uEnergy;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = exp(-d * d * 3.5) * (0.25 + 0.45 * uEnergy);
  gl_FragColor = vec4(uColA * a, a);
}`;

const PALETTES = {
  girl: [0xff6f91, 0xffc15e],
  boy: [0x3f7fff, 0x7fe0ff],
};

export class Orb {
  constructor(scene, id) {
    const [a, b] = PALETTES[id] || PALETTES.boy;
    this.u = {
      uColA: { value: new THREE.Color(a) }, uColB: { value: new THREE.Color(b) },
      uTime: { value: 0 }, uEnergy: { value: 0.2 }, uSwirl: { value: 0 },
    };
    this.group = new THREE.Group();
    this.group.position.set(0, 0.1, 0);
    this.sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 16),
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
  }

  update(s) {
    // Emotions tint the orb toward their glow color and liven or calm it.
    this._base = this._base || this.u.uColA.value.clone();
    this.u.uColA.value.copy(this._base).lerp(s.emo.glow, 0.55 * s.emo.amount);
    this.u.uTime.value = s.t;
    this.u.uSwirl.value = s.swirl;
    this.u.uEnergy.value = 0.15 + 0.35 * s.eyeLock * s.lean + 0.9 * s.speech + 0.3 * s.swirl + 0.4 * s.emo.energy;
    const k = s.breath * (1 + 0.06 * s.speech + 0.03 * s.lean - 0.05 * s.emo.sag);
    this.sphere.scale.setScalar(k);
    this.group.position.y = 0.1 + Math.sin(s.t * 0.8) * 0.04;
  }

  blinkCascade() {}

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
