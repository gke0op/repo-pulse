// Procedural eye: the model keeps its own painted iris, lids and makeup; everything that moves with feeling
// is drawn here, in the MToon shader, from one parameter vector. No textures, no Blender round trips:
// a new look is new numbers. Grafted into three-vrm's MToon at three points: the iris UV is warped
// (pupil dilation compresses the painted iris like a real one), the sampled colour is reshaped
// (luminance-preserving hue shifts), and light is added before output (highlights, star, gems, specks).
import * as THREE from 'three';

// Per-model eye rigs, measured from the model's own iris texture (UV space, y down like the texture).
// c/r: iris centre and radius; pc/pr: painted pupil centre and radius; white: sclera UV frame per eye.
export const EYE_RIGS = {
  girl: {
    iris: [{ c: [0.2489, 0.4995], r: [0.1147, 0.2578], pc: [0.2534, 0.4778], pr: [0.0410, 0.0964] },
           { c: [0.7501, 0.4995], r: [0.1147, 0.2578], pc: [0.7456, 0.4750], pr: [0.0403, 0.0941] }],
    white: [{ u: [0.0127, 0.4869], v: [0.1507, 0.9145] }, { u: [0.5131, 0.9873], v: [0.1507, 0.9145] }],
    // our highlights, in iris units from the iris centre (y down): main soft blob + small counter-light
    hl: [[-0.32, -0.38, 0.26, 0.17, 0.5], [0.36, 0.40, 0.09, 0.09, 0.0]],
  },
};

// The eye's parameter space. Emotions are just points in it (see EYE_PRESETS); any state can drive it.
const NEUTRAL = {
  dil: 1, bodyHue: [1, 1, 1], bodyAmt: 0, bodyGain: 1, bodyLift: 0,
  glowHue: [1, 1, 1], glowAmt: 0, glowGain: 1, sclera: [1, 1, 1], veins: 0,
  hlGain: 1, hlScale: 1, star: 0, gems: 0, specks: 0, drops: 0,
};
// Directions from the audited research, looks from the user's picked concepts; sizes exaggerated to read on a phone.
export const EYE_PRESETS = {
  happy:     { dil: 1.6, bodyHue: [1.0, 0.64, 0.12], bodyAmt: 0.85, bodyGain: 3.2, bodyLift: 0.16,
               glowHue: [1.0, 0.66, 0.16], glowAmt: 0.35, glowGain: 1.7, hlGain: 1.6, hlScale: 1.3, specks: 1 },
  sad:       { dil: 1.15, bodyHue: [0.45, 0.62, 1.0], bodyAmt: 0.8, bodyGain: 2.0, bodyLift: 0.03,
               glowHue: [0.55, 0.70, 1.0], glowAmt: 0.8, glowGain: 0.6, sclera: [1.0, 0.83, 0.85], hlGain: 1.2, drops: 1 },
  angry:     { dil: 0.6, bodyHue: [1.0, 0.22, 0.12], bodyAmt: 0.7, bodyGain: 1.4,
               glowHue: [1.0, 0.18, 0.03], glowAmt: 0.9, glowGain: 1.3, sclera: [1.0, 0.86, 0.83], veins: 1,
               hlGain: 0.45, hlScale: 0.8 },
  surprised: { dil: 1.5, star: 1, hlGain: 1.4, hlScale: 1.25, glowGain: 1.3 },
  curious:   { dil: 1.35, gems: 1, glowGain: 1.25 },
  tender:    { dil: 1.3, bodyHue: [1.0, 0.42, 0.55], bodyAmt: 0.8, bodyGain: 2.8, bodyLift: 0.13,
               glowHue: [1.0, 0.60, 0.55], glowAmt: 0.5, glowGain: 1.1, hlGain: 0.8, hlScale: 1.15 },
};

const GLSL_COMMON = /* glsl */`
uniform vec4 eIris[2];   // centre.xy, radius.xy
uniform vec4 ePupil[2];  // centre.xy, radius.xy
uniform vec4 eHl[2];     // main blob x, y, rx, ry  (iris units)
uniform vec4 eHl2;       // small blob x, y, r, angle-of-main
uniform float eDil, eBodyAmt, eBodyGain, eBodyLift, eGlowAmt, eGlowGain;
uniform vec3 eBodyHue, eGlowHue;
uniform float eHlGain, eHlScale, eStar, eGems, eSpecks, eDrops, eTime;
uniform vec2 eLook;      // highlight parallax (iris units): highlights stay with the light as the eye turns
float eLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
int eSide(vec2 uv) { return uv.x < 0.5 ? 0 : 1; }
float eHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const GLSL_IRIS = GLSL_COMMON + /* glsl */`
float ePupilR0(int s) { vec4 ir = eIris[s], pu = ePupil[s]; return 0.5 * (pu.z / ir.z + pu.w / ir.w); }
// Pupil dilation as a radial warp about the pupil: the painted iris compresses toward the limbus.
vec2 eyeWarp(vec2 uv) {
  int s = eSide(uv); vec4 ir = eIris[s], pu = ePupil[s];
  vec2 q = (uv - pu.xy) / ir.zw; float r = length(q);
  float r0 = ePupilR0(s), r1 = clamp(r0 * eDil, 0.12, 0.85), rs = r;
  if (r < r1) rs = r * r0 / r1; else if (r < 1.0) rs = r0 + (r - r1) * (1.0 - r0) / (1.0 - r1);
  return r > 1e-5 ? pu.xy + q / r * rs * ir.zw : uv;
}
vec3 eColorize(vec3 col, vec3 hue, float amt, float gain, float lift) {
  vec3 t = hue * (eLum(col) * gain + lift) / max(eLum(hue), 1e-3);
  return mix(col, t, amt);
}
vec3 eyeColor(vec3 col, vec2 uv) {
  int s = eSide(uv); vec4 ir = eIris[s], pu = ePupil[s];
  vec2 q = (uv - pu.xy) / ir.zw; float r = length(q);
  float pupil = 1.0 - smoothstep(0.92, 1.12, r / clamp(ePupilR0(s) * eDil, 0.12, 0.85));
  float glow = smoothstep(0.02, 0.18, col.r - col.b) * smoothstep(0.03, 0.2, eLum(col));
  float low = smoothstep(-1.0, 1.0, (uv.y - ir.y) / ir.w);                      // washes weigh toward the bottom
  vec3 body = eColorize(col, eBodyHue, eBodyAmt * (1.0 - pupil), eBodyGain, eBodyLift * low);
  vec3 lit = eColorize(col, eGlowHue, eGlowAmt, 1.0, 0.0) * eGlowGain;
  return mix(body, lit, glow);
}
float eBlob(vec2 p, vec2 c, vec2 rad, float ang) {
  vec2 d = p - c; float ca = cos(ang), sa = sin(ang);
  d = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / rad;
  return 1.0 - smoothstep(0.75, 1.05, length(d));
}
float eStarShape(vec2 d, float thin) {
  float a = max(clamp(1.0 - abs(d.x) - abs(d.y) / thin, 0.0, 1.0), clamp(1.0 - abs(d.y) - abs(d.x) / thin, 0.0, 1.0));
  return max(pow(a, 0.7), clamp(1.0 - length(d) / 0.28, 0.0, 1.0));
}
float eDiamond(vec2 p, vec2 c, float rad) { vec2 d = (p - c) / vec2(rad, rad * 1.25); return clamp((1.0 - abs(d.x) - abs(d.y)) * 6.0, 0.0, 1.0); }
vec3 eyeEmit(vec2 uv) {
  int s = eSide(uv); vec4 ir = eIris[s], pu = ePupil[s];
  vec2 p = (uv - ir.xy) / ir.zw;                                                // iris units, y down
  if (length(p) > 1.02) return vec3(0.0);
  float shimmer = 1.0 + 0.06 * sin(eTime * 1.7) + 0.04 * sin(eTime * 4.3 + 1.0);
  vec2 hp = p - eLook;
  float hl = eBlob(hp, eHl[0].xy, eHl[0].zw * eHlScale, eHl2.w) + 0.9 * eBlob(hp, eHl2.xy, vec2(eHl2.z) * eHlScale, 0.0);
  vec3 e = vec3(hl * eHlGain * shimmer);
  // surprised: a star inside the pupil, breathing and turning slowly
  vec2 pc = (pu.xy - ir.xy) / ir.zw; float pr = ePupilR0(s) * clamp(eDil, 0.3, 2.5);
  float tw = 1.0 + 0.12 * sin(eTime * 5.0);
  float ang = 0.15 * sin(eTime * 0.6); mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  e += vec3(1.0, 0.96, 0.86) * eStar * eStarShape(rot * (p - pc - vec2(-0.08, -0.10) * pr) / (1.4 * pr * tw), 0.11);
  // curious: faceted catchlights that flicker like cut glass
  float fl = 0.85 + 0.15 * sin(eTime * 7.0);
  e += eGems * fl * (eDiamond(hp, vec2(-0.45, -0.45), 0.20) + eDiamond(hp, vec2(0.45, 0.50), 0.09)) * vec3(1.0);
  e += eGems * fl * eDiamond(hp, vec2(0.50, -0.50), 0.18) * vec3(0.35, 0.65, 1.0);
  // happy: star specks in the upper iris, each twinkling on its own
  for (int i = 0; i < 9; i++) {
    float fi = float(i) + float(s) * 17.0;
    float a = -2.6 + 2.1 * eHash(vec2(fi, 1.0)), rr = 0.45 + 0.4 * eHash(vec2(fi, 2.0));
    vec2 c = vec2(cos(a), sin(a)) * rr; float sz = 0.06 + 0.05 * eHash(vec2(fi, 3.0));
    float t = 0.55 + 0.45 * sin(eTime * (2.0 + 2.0 * eHash(vec2(fi, 4.0))) + fi);
    e += eSpecks * t * eStarShape((p - c) / sz, 0.18) * vec3(1.0, 0.95, 0.82);
  }
  // sad: wet droplets along the rim, trembling slightly
  vec2 wob = 0.012 * vec2(sin(eTime * 3.1), cos(eTime * 2.7));
  vec4 dr[5]; dr[0] = vec4(-2.4, 0.72, 0.055, 0.0); dr[1] = vec4(0.4, 0.78, 0.07, 0.0); dr[2] = vec4(1.2, 0.70, 0.05, 0.0);
  dr[3] = vec4(2.3, 0.74, 0.045, 0.0); dr[4] = vec4(-0.7, 0.62, 0.04, 0.0);
  for (int i = 0; i < 5; i++) {
    vec2 c = vec2(cos(dr[i].x), sin(dr[i].x)) * dr[i].y + wob;
    e += eDrops * (1.0 - smoothstep(0.7, 1.0, length(p - c) / (dr[i].z * 1.4))) * vec3(0.9, 0.96, 1.0);
  }
  return e;
}
`;

const GLSL_WHITE = /* glsl */`
uniform vec4 eWhite[2];  // u0, u1, v0, v1
uniform vec3 eSclera;
uniform float eVeins, eTime;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
vec3 scleraColor(vec3 col, vec2 uv) {
  vec4 w = uv.x < 0.5 ? eWhite[0] : eWhite[1];
  vec2 q = vec2((uv.x - 0.5 * (w.x + w.y)) / (0.5 * (w.y - w.x)), (uv.y - 0.5 * (w.z + w.w)) / (0.5 * (w.w - w.z)));
  // veins: ridged noise, only toward the corners, pulsing faintly
  float n = wNoise(q * vec2(7.0, 11.0)) * 0.65 + wNoise(q * vec2(15.0, 23.0)) * 0.35;
  float line = pow(1.0 - abs(n - 0.5) * 2.0, 22.0);
  float corner = smoothstep(0.45, 0.95, abs(q.x)) * (1.0 - smoothstep(0.55, 1.0, abs(q.y)));
  float v = eVeins * line * corner * (0.85 + 0.15 * sin(eTime * 2.2));
  return mix(col * eSclera, vec3(0.62, 0.05, 0.07), clamp(v, 0.0, 1.0));
}
`;

function graft(material, key, decl, edits) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;   // MToon has its own: chain, don't replace
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, material.userData.eyeUniforms);
    let f = shader.fragmentShader.replace('void main() {', decl + '\nvoid main() {');
    for (const [find, add] of edits) {
      if (!f.includes(find)) { console.warn('eye graft: anchor missing', find); return; }
      f = f.replace(find, find + '\n' + add);
    }
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|' + key;
  material.needsUpdate = true;
}

export class ProceduralEye {
  constructor(vrm, id) {
    this.rig = EYE_RIGS[id];
    this.ok = false;
    if (!this.rig) return;
    const find = sub => { let m = null; vrm.scene.traverse(o => [].concat(o.material || []).forEach(x => { if (x.name?.includes(sub)) m = m || x; })); return m; };
    const iris = find('EyeIris'), white = find('EyeWhite'), hl = find('EyeHighlight');
    if (!iris || !white) return;
    const R = this.rig, v4 = a => new THREE.Vector4(...a);
    this.u = {
      eIris: { value: R.iris.map(e => v4([...e.c, ...e.r])) }, ePupil: { value: R.iris.map(e => v4([...e.pc, ...e.pr])) },
      eHl: { value: [v4(R.hl[0].slice(0, 4)), v4(R.hl[0].slice(0, 4))] },
      eHl2: { value: v4([R.hl[1][0], R.hl[1][1], R.hl[1][2], R.hl[0][4]]) },
      eDil: { value: 1 }, eBodyAmt: { value: 0 }, eBodyGain: { value: 1 }, eBodyLift: { value: 0 },
      eGlowAmt: { value: 0 }, eGlowGain: { value: 1 }, eBodyHue: { value: new THREE.Vector3(1, 1, 1) },
      eGlowHue: { value: new THREE.Vector3(1, 1, 1) }, eHlGain: { value: 1 }, eHlScale: { value: 1 },
      eStar: { value: 0 }, eGems: { value: 0 }, eSpecks: { value: 0 }, eDrops: { value: 0 },
      eTime: { value: 0 }, eLook: { value: new THREE.Vector2() },
      eWhite: { value: R.white.map(w => v4([...w.u, ...w.v])) }, eSclera: { value: new THREE.Vector3(1, 1, 1) }, eVeins: { value: 0 },
    };
    iris.userData.eyeUniforms = this.u; white.userData.eyeUniforms = this.u;
    graft(iris, 'procedural-eye-iris', GLSL_IRIS, [
      ['uv = vUv;', 'uv = eyeWarp(uv);'],
      ['diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb = eyeColor(diffuseColor.rgb, vUv);'],
      ['material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;', 'material.shadeColor = eyeColor(material.shadeColor, vUv);'],
      ['material.diffuseColor = diffuseColor.rgb;', 'totalEmissiveRadiance += eyeEmit(vUv);'],
    ]);
    graft(white, 'procedural-eye-white', GLSL_WHITE, [
      ['diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb = scleraColor(diffuseColor.rgb, vUv);'],
      ['material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;', 'material.shadeColor = scleraColor(material.shadeColor, vUv);'],
    ]);
    if (hl) hl.visible = false;              // the highlights are drawn procedurally now
    this.p = structuredClone(NEUTRAL);
    this.ok = true;
  }

  // weights: { happy, sad, angry, surprised, curious, tender } in 0..1 (already smoothed by the caller)
  update(weights, t, look) {
    if (!this.ok) return;
    if (globalThis.__eyeOverride) weights = globalThis.__eyeOverride;   // debug/tuning: drive the eye directly
    const p = this.p, N = NEUTRAL;
    Object.assign(p, structuredClone(N));
    const hueAcc = { bodyHue: [0, 0, 0], glowHue: [0, 0, 0] }, hueW = { bodyHue: 0, glowHue: 0 };
    for (const [name, w] of Object.entries(weights)) {
      const e = EYE_PRESETS[name]; if (!e || w <= 0) continue;
      for (const [k, v] of Object.entries(e)) {
        if (k === 'bodyHue' || k === 'glowHue') {
          const a = w * (k === 'bodyHue' ? e.bodyAmt ?? 0 : e.glowAmt ?? 0);
          for (let i = 0; i < 3; i++) hueAcc[k][i] += v[i] * a; hueW[k] += a;
        } else if (k === 'sclera') for (let i = 0; i < 3; i++) p.sclera[i] *= 1 + (v[i] - 1) * w;
        else p[k] += (v - N[k]) * w;
      }
    }
    for (const k of ['bodyHue', 'glowHue']) if (hueW[k] > 1e-4) p[k] = hueAcc[k].map(x => x / hueW[k]);
    // hippus: the small, slow oscillation of a living pupil
    const dil = p.dil * (1 + 0.025 * Math.sin(t * 0.9) + 0.015 * Math.sin(t * 2.3 + 0.7));
    const u = this.u;
    u.eDil.value = dil; u.eBodyAmt.value = Math.min(p.bodyAmt, 1); u.eBodyGain.value = p.bodyGain; u.eBodyLift.value = p.bodyLift;
    u.eGlowAmt.value = Math.min(p.glowAmt, 1); u.eGlowGain.value = p.glowGain;
    u.eBodyHue.value.set(...p.bodyHue); u.eGlowHue.value.set(...p.glowHue);
    u.eHlGain.value = p.hlGain; u.eHlScale.value = p.hlScale;
    u.eStar.value = p.star; u.eGems.value = p.gems; u.eSpecks.value = p.specks; u.eDrops.value = p.drops;
    u.eSclera.value.set(...p.sclera); u.eVeins.value = p.veins;
    u.eTime.value = t;
    u.eLook.value.set(-(look?.yaw ?? 0) * 0.012, (look?.pitch ?? 0) * 0.012);
  }
}
