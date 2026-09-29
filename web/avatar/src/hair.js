// Modular hair: a character file can carry several hairstyles split into parts (meshes named
// HairPart_<style>_<part>, chain bones named H_<style>_<part>_...). The app picks one style per part,
// colours each part in code, and only the visible parts' spring chains simulate.
import * as THREE from 'three';

export const HAIR_PARTS = ['bangs', 'sides', 'back', 'extras', 'accessory'];

const GLSL = /* glsl */`
uniform vec3 hTint;
uniform float hAmt;
vec3 hairColor(vec3 col) {
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 t = hTint * (0.25 + 1.6 * l);                     // the strand shading stays; the hue and value come from hTint
  return mix(col, t, hAmt);
}
`;

function graft(material, uniforms) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    let f = shader.fragmentShader.replace('void main() {', GLSL + '\nvoid main() {');
    for (const [find, add] of [
      ['diffuseColor *= sampledDiffuseColor;', 'diffuseColor.rgb = hairColor(diffuseColor.rgb);'],
      ['material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;', 'material.shadeColor = hairColor(material.shadeColor);'],
    ]) f = f.includes(find) ? f.replace(find, find + '\n' + add) : f;
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|hair-tint';
  material.needsUpdate = true;
}

export class HairLibrary {
  constructor(vrm) {
    this.vrm = vrm;
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
      p.u = { hTint: { value: new THREE.Color(1, 1, 1) }, hAmt: { value: 0 } };
      const mats = new Set();
      p.objects.forEach(o => o.traverse(x => [].concat(x.material || []).forEach(mt => mats.add(mt))));
      mats.forEach(mt => graft(mt, p.u));
    }
    this.ok = this.parts.size > 0;
    this.look = {};
  }

  // look: { bangs: 'D', sides: 'D', back: 'G', extras: null, accessory: 'D' }  (missing part = hidden)
  setLook(look) {
    if (!this.ok) return;
    this.look = { ...look };
    for (const p of this.parts.values()) {
      const on = look[p.part] === p.style;
      p.objects.forEach(o => { o.visible = on; });
      for (const j of p.joints) {
        const has = this.sbm.joints.has(j);
        if (on && !has) { this.sbm.addJoint(j); j.reset?.(); }
        if (!on && has) this.sbm.deleteJoint(j);
      }
    }
  }

  // A whole style on every part it has.
  setStyle(style) {
    const look = {};
    for (const p of this.parts.values()) if (p.style === style) look[p.part] = style;
    this.setLook(look);
  }

  // colour one part (or all with part = '*'): hex like '#2a1f4a', amount 0..1 (0 = the part's own colours)
  setColor(part, hex, amount = 1) {
    for (const p of this.parts.values()) {
      if (part !== '*' && p.part !== part) continue;
      if (hex) p.u.hTint.value.set(hex).convertSRGBToLinear();
      p.u.hAmt.value = hex ? amount : 0;
    }
  }
}
