// Modular hair: a character file can carry several hairstyles split into parts (meshes named
// HairPart_<style>_<part>, chain bones named H_<style>_<part>_...). The app picks one style per part,
// colours each part in code, and only the visible parts' spring chains simulate.
import * as THREE from 'three';

export const HAIR_PARTS = ['bangs', 'sides', 'back', 'extras', 'accessory'];

// Curated looks (setHair('<name>')): combinations the user picked.
export const HAIR_PRESETS = {
  boy: { long: { look: { bangs: 'M', sides: 'L', back: 'L' }, color: { '*': '#1f1b26' } } },
  girl: {},
};

const GLSL_V = /* glsl */`
varying float vHairH;
`;
const GLSL = /* glsl */`
uniform vec3 hTint, hTip, hSheen;
uniform float hAmt, hTipAmt, hGradStart, hSheenAmt, hBright, hTop, hBot, hLumRef;
varying float vHairH;
float hairGrad() {                                    // 0 at the part's top .. 1 at its tips, scaled by the tip amount
  float t = clamp((hTop - vHairH) / max(hTop - hBot, 1e-4), 0.0, 1.0);
  return smoothstep(hGradStart, 1.0, t) * hTipAmt;
}
vec3 hairColor(vec3 col) {
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // shading relative to this part's own average brightness: ~1 on a typical strand, whatever the donor
  float r = l / max(hLumRef, 1e-3);
  // base: hue and value come from hTint, the strand shading stays; hBright flattens it toward even light colour
  float value = mix(0.35 + 0.65 * r, 0.8 + 0.3 * r, hBright);
  vec3 base = hTint * value;
  // root-to-tip: height along this part, 0 at its top, 1 at its lowest tips
  float g = hairGrad();
  vec3 outc = mix(col, base, hAmt);
  outc = mix(outc, hTip * value, g);                  // the tip works on the hair's own colours too
  // sheen: the bright strand highlights take their own colour
  float spec = smoothstep(1.25, 2.2, r);                // the strands' own highlights, relative to the part
  return mix(outc, hSheen * (0.6 + 0.4 * r), spec * hSheenAmt);
}
`;

function graft(material, uniforms) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader.replace('void main() {', GLSL_V + '\nvoid main() {');
    v = v.includes('#include <skinning_vertex>') ? v.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n  vHairH = transformed.y;')
                                                 : v.replace('#include <project_vertex>', 'vHairH = transformed.y;\n#include <project_vertex>');
    shader.vertexShader = v;
    let f = shader.fragmentShader.replace('void main() {', GLSL + '\nvoid main() {');
    for (const [find, add] of [
      ['diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb = hairColor(diffuseColor.rgb);'],
      ['material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;', 'material.shadeColor = mix(material.shadeColor, diffuseColor.rgb * 0.5, clamp(hAmt + hairGrad(), 0.0, 1.0));'],
    ]) f = f.includes(find) ? f.replace(find, find + '\n' + add) : f;
    // the donor's baked glow (emission) and its coloured rim matcap belong to its original colours: fade them when recoloured
    f = f.replace('col += totalEmissiveRadiance;', 'col += totalEmissiveRadiance * (1.0 - 0.9 * hAmt);');
    f = f.replace('rim += matcapFactor * matcap;', 'rim += matcapFactor * matcap * (1.0 - 0.85 * hAmt);');
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|hair-tint4';
  material.needsUpdate = true;
}

// Average linear luminance of a part's main texture (times its colour factor): the reference its tint scales against.
function meanLum(mats) {
  for (const m of mats) {
    const img = m.map?.image; if (!img) continue;
    try {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data; let s = 0, n = 0;
      const lin = v => Math.pow(v / 255, 2.2);
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); n++; }
      const f = m.color ? (0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b) : 1;
      if (n) return Math.max(1e-3, (s / n) * f);
    } catch (e) { /* unreadable image: keep the default */ }
  }
  return 0.2;
}

export class HairLibrary {
  constructor(vrm, charId) {
    this.vrm = vrm; this.charId = charId;
    this.parts = new Map();                              // 'D:bangs' -> { style, part, objects, joints, u }
    vrm.scene.traverse(o => {
      const m = /^HairPart_([A-Za-z0-9]+)_([a-z]+)$/.exec(o.name);
      if (!m) return;
      const key = `${m[1]}:${m[2]}`;
      if (!this.parts.has(key)) this.parts.set(key, { style: m[1], part: m[2], objects: [], joints: [], u: null });
      this.parts.get(key).objects.push(o);
    });
    this.styles = [...new Set([...this.parts.values()].map(p => p.style))];
    const sbm = vrm.springBoneManager;
    this.sbm = sbm;
    for (const j of [...(sbm?.joints ?? [])]) {
      let b = j.bone, m = null;
      while (b && !(m = /^H_([A-Za-z0-9]+)_([a-z]+)_\d+_\d+$/.exec(b.name))) b = b.parent;
      if (m) this.parts.get(`${m[1]}:${m[2]}`)?.joints.push(j);
    }
    for (const p of this.parts.values()) {
      const box = new THREE.Box3();
      p.objects.forEach(o => o.traverse(x => { if (x.geometry) { x.geometry.computeBoundingBox(); box.union(x.geometry.boundingBox); } }));
      p.u = { hTint: { value: new THREE.Color(1, 1, 1) }, hAmt: { value: 0 }, hTip: { value: new THREE.Color(1, 1, 1) },
        hTipAmt: { value: 0 }, hGradStart: { value: 0.35 }, hSheen: { value: new THREE.Color(1, 1, 1) }, hSheenAmt: { value: 0 },
        hBright: { value: 0 }, hTop: { value: box.max.y }, hBot: { value: box.min.y }, hLumRef: { value: 0.2 } };
      const mats = new Set();
      p.objects.forEach(o => o.traverse(x => [].concat(x.material || []).forEach(mt => mats.add(mt))));
      mats.forEach(mt => graft(mt, p.u));
      p.u.hLumRef.value = meanLum(mats);
    }
    this.ok = this.parts.size > 0;
    this.look = {};
    globalThis.__hair = this;                             // debug/tuning handle
  }

  // look: { bangs: 'D', sides: 'D', back: 'G', extras: null, accessory: 'D' }  (missing part = hidden)
  setLook(look) {
    if (!this.ok) return;
    if (Object.keys(look).length) this.capHidden = false;
    this.look = { ...look };
    for (const p of this.parts.values()) {
      const on = p.style === 'base' ? !this.capHidden : look[p.part] === p.style;   // the scalp cap, unless bald
      p.objects.forEach(o => { o.visible = on; });
      for (const j of p.joints) {
        const has = this.sbm.joints.has(j);
        if (on && !has) { this.sbm.addJoint(j); j.reset?.(); }
        if (!on && has) this.sbm.deleteJoint(j);
      }
    }
  }

  // Bald: no hair parts and no scalp cap (the head's own skin shows).
  setBald() { this.capHidden = true; this.setLook({}); }

  // Buzz cut: no hair parts, just the scalp cap (it keeps a natural hairline); colour it with setColor('cap', ...).
  setBuzz() { this.capHidden = false; this.setLook({}); }

  // A whole style on every part it has.
  setStyle(style) {
    const pre = HAIR_PRESETS[this.charId]?.[style];
    if (pre) { this.setLook(pre.look); for (const [part, c] of Object.entries(pre.color || {})) this.setColor(part, c); return; }
    if (style === 'bald') return this.setBald();
    if (style === 'buzz') return this.setBuzz();
    this.capHidden = false;
    const look = {};
    for (const p of this.parts.values()) if (p.style === style) look[p.part] = style;
    this.setLook(look);
  }

  // Colour one part, or all with part = '*'.
  //   setColor(part, '#hex', amount)                       plain tint (amount 0..1; null hex = the part's own colours)
  //   setColor(part, { base, amount, tip, tipAmount, gradStart, sheen, sheenAmount, bright })
  //     base/tip/sheen: '#hex'; tip = root-to-tip ombré (gradStart 0..1 = where along the hair it begins);
  //     sheen = colour of the shine; bright 0..1 lifts dark hair so light colours (platinum, pastel) read.
  setColor(part, spec, amount = 1) {
    if (typeof spec === 'string' || spec == null) spec = { base: spec, amount };
    const lin = (c, hex) => c.set(hex).convertSRGBToLinear();
    for (const p of this.parts.values()) {
      if (part !== '*' && p.part !== part) continue;
      const u = p.u;
      if (spec.base) lin(u.hTint.value, spec.base);
      u.hAmt.value = spec.base ? (spec.amount ?? 1) : 0;
      if (spec.tip) lin(u.hTip.value, spec.tip);
      u.hTipAmt.value = spec.tip ? (spec.tipAmount ?? 1) : 0;
      u.hGradStart.value = spec.gradStart ?? 0.35;
      if (spec.sheen) lin(u.hSheen.value, spec.sheen);
      u.hSheenAmt.value = spec.sheen ? (spec.sheenAmount ?? 0.8) : 0;
      u.hBright.value = spec.bright ?? 0;
    }
  }
}
