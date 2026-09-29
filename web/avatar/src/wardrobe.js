// Wardrobe: the character's own outfit is the mesh "Outfit_O" inside her VRM; other outfits are small GLB packs
// (tools/hair/outfitpack.py) fetched on demand from `base`, bound to her skeleton by bone name, and re-dressed in
// her own MToon material so they shade like the rest of her. One outfit visible at a time.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MToonMaterial } from '@pixiv/three-vrm';

export class Wardrobe {
  constructor(vrm, base = 'models/outfits/') {
    this.vrm = vrm; this.base = base;
    this.own = []; vrm.scene.traverse(o => { if (/^Outfit_O/.test(o.name) && (o.isMesh || o.children.some(c => c.isMesh))) this.own.push(o); });
    this.bones = new Map(); vrm.scene.traverse(o => { if (o.isBone) this.bones.set(o.name, o); });
    // template: her own cloth material (MToon), for re-dressing packs
    this.template = null;
    this.own.forEach(o => o.traverse(x => { if (!this.template && x.isMesh) this.template = [].concat(x.material)[0]; }));
    // her skin (the head-skin part of her body) is the template for a pack's skin
    this.skinTemplate = null;
    vrm.scene.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => { if (!this.skinTemplate && /Body_00_SKIN/.test(m.name)) this.skinTemplate = m; }); });
    this.bindRef = null; this.own.forEach(o => o.traverse(x => { if (!this.bindRef && x.isSkinnedMesh) this.bindRef = x; }));
    this.cache = new Map(); this.dressed = []; this.current = 'O'; this.ok = this.own.length > 0;
    globalThis.__wardrobe = this; globalThis.__THREE = THREE;   // debug/tuning handles
  }

  // Resolves when the outfit is on. id 'O' = her own outfit.
  async set(id) {
    if (!this.ok) return;
    const want = id || 'O'; this.wanted = want;
    const pack = want === 'O' ? null : await this.load(want);
    if (this.wanted !== want) return;                        // a later call won
    this.own.forEach(o => { o.visible = !pack; });
    for (const [k, g] of this.cache) if (g.root) g.root.visible = (k === want);
    this.current = want;
  }

  // Download (or reuse) a pack; returns its root group, already bound to her skeleton.
  load(id) {
    if (!this.cache.has(id)) {
      const entry = {};
      entry.promise = new GLTFLoader().loadAsync(`${this.base}${id}.glb`).then(gltf => {
        const root = new THREE.Group(); root.name = `Outfit_${id}`;
        const meshes = []; gltf.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
        // Her rest pose, by bone name, from her own outfit's skeleton.
        const ref = this.bindRef.skeleton, refInv = new Map(ref.bones.map((b, i) => [b.name, ref.boneInverses[i]]));
        const refBone = new Map(ref.bones.map(b => [b.name, b]));     // the exact bones her own outfit is skinned to
        for (const m of meshes) {
          const sk = m.skeleton, names = sk.bones.map(b => b.name);
          const used = new Set(), si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
          for (let v = 0; v < si.count; v++) for (let c = 0; c < 4; c++) if (sw.getComponent(v, c) > 0) used.add(si.getComponent(v, c));
          const missing = names.filter((n, i) => used.has(i) && !refBone.get(n));
          if (missing.length) console.warn('outfit', id, 'bones not in her skeleton', missing.slice(0, 5));
          // The pack's space vs hers (e.g. +Z vs -Z facing): T = herRest(hips) * packRest(hips)^-1, applied to the geometry.
          const k = names.indexOf('J_Bip_C_Hips') >= 0 ? names.indexOf('J_Bip_C_Hips') : names.findIndex(n => refInv.get(n));
          // Packs come from Blender's glTF export (front +Z); her VRM 0.x bind space faces -Z. VRoid rest bones carry no
          // rotation, so the turn can't be read from them: rotate 180 deg about Y, then fix any offset at the hips.
          const geo = m.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
          const herHips = new THREE.Vector3().setFromMatrixPosition(refInv.get(names[k]).clone().invert());
          const packHips = new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[k].clone().invert()).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
          geo.translate(herHips.x - packHips.x, herHips.y - packHips.y, herHips.z - packHips.z);
          const sm = new THREE.SkinnedMesh(geo, Array.isArray(m.material) ? m.material.map(mt => this.dress(mt)) : this.dress(m.material));   // an array only draws with geometry groups
          sm.frustumCulled = false; sm.name = m.name;
          const bones = names.map((n, i) => refBone.get(n) || this.bones.get(n) || sk.bones[i]);
          const inv = names.map((n, i) => (refInv.get(n) || sk.boneInverses[i]).clone());
          sm.bind(new THREE.Skeleton(bones, inv), this.bindRef.bindMatrix);
          root.add(sm);
        }
        const holder = this.own.find(o => !o.isMesh) || this.bindRef;   // her outfit's group: the pack goes beside it, not in it
        (holder.parent || this.vrm.scene).add(root);
        if (holder !== this.bindRef) { root.position.copy(holder.position); root.quaternion.copy(holder.quaternion); root.scale.copy(holder.scale); }
        root.visible = false; entry.root = root; return root;
      });
      this.cache.set(id, entry);
    }
    return this.cache.get(id).promise;
  }

  // A pack material (plain PBR from the glTF export) re-dressed as a copy of her own MToon cloth material.
  dress(src) {
    const t = /SKIN/i.test(src.name) && this.skinTemplate ? this.skinTemplate : this.template;
    const map = src.map || null;
    for (const tx of [map, src.emissiveMap]) if (tx) {       // exported samplers can be nearest: force smooth, mipmapped
      tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; tx.needsUpdate = true;
    }
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    const m = new MToonMaterial({ map, shadeMultiplyTexture: map, transparent: !!src.transparent, side: src.side ?? THREE.FrontSide });
    if (t?.isMToonMaterial) {                     // her lighting: toony band, shade colour, rim (the stage's violet rim)
      for (const k of ['shadingToonyFactor', 'shadingShiftFactor', 'giEqualizationFactor', 'parametricRimFresnelPowerFactor',
                       'parametricRimLiftFactor', 'rimLightingMixFactor'])
        if (k in t && k in m) m[k] = t[k];
      if (t.shadeColorFactor && m.shadeColorFactor) m.shadeColorFactor.copy(t.shadeColorFactor);
      if (t.parametricRimColorFactor && m.parametricRimColorFactor) m.parametricRimColorFactor.copy(t.parametricRimColorFactor);
    }
    if (src.color && m.color) m.color.copy(src.color);
    if (src.alphaTest) m.alphaTest = src.alphaTest;
    if (src.emissiveMap) { m.emissiveMap = src.emissiveMap; m.emissive?.setRGB?.(1, 1, 1); }   // glowing trims keep their glow
    m.name = `${src.name}__dressed`;
    this.dressed.push(m);
    return m;
  }

}
