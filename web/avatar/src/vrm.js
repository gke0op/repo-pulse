// Human characters (Mira, Kai): a VRM model driven by the shared state `s`.
// Models live in assets/avatar/models/<name>.vrm and load asynchronously; until then nothing shows.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { ProceduralEye } from './eye.js';
import { HairLibrary } from './hair.js';
import { Wardrobe } from './wardrobe.js';

const MODELS = { girl: 'models/mira.vrm', boy: 'models/kai.vrm' };
// Emotion A/B (avatar.setProfile): A = subtle, capped where VRoid shapes start fighting
// blink/speech; B = louder face and body. Face weights per expression; `body` scales posture.
const PROFILES = {
  A: { happy: 0.6, sad: 0.85, angry: 0.38, relaxed: 0.55, surprised: 0.7, body: 1.0, talk: 0.35 },
  B: { happy: 1.0, sad: 1.0, angry: 0.55, relaxed: 0.9, surprised: 1.0, body: 2.5, talk: 0.15 },
};
const RIM = new THREE.Color(0x8a5cff);        // violet rim, matches the stage glow
const HEAD_Y = 0.35;                           // where the head sits in stage units
const SCALE = 7.4;                             // metres -> stage units (head-and-shoulders crop)

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

export class VrmAvatar {
  constructor(scene, id) {
    this.id = id;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.key = new THREE.DirectionalLight(0xfff4ec, 2.4);
    this.key.position.set(-1.2, 2.0, 3.0);
    this.fill = new THREE.DirectionalLight(0x9a80ff, 0.9);
    this.fill.position.set(2.0, 0.5, -1.5);
    this.group.add(this.key, this.fill, new THREE.AmbientLight(0x6060a0, 0.6));
    this.target = new THREE.Object3D();       // what the eyes look at, in group space
    this.group.add(this.target);

    this.vrm = null;
    this.gone = false;
    this.blinkAt = 1.5; this.blinkT = -1; this.blinkQueue = 0;
    this.eyeW = { happy: 0, sad: 0, angry: 0, surprised: 0, curious: 0, tender: 0 };
    this.wander = new THREE.Vector3(); this.wanderAt = 0;
    this.headYaw = 0; this.headPitch = 0;
    this.rim = new THREE.Color();
    this.v = new THREE.Vector3(); this.headPos = new THREE.Vector3();

    const loader = new GLTFLoader();
    loader.register(p => new VRMLoaderPlugin(p));
    loader.load(MODELS[id] || MODELS.girl, gltf => this._onLoad(gltf),
      undefined, e => console.error('vrm load failed', MODELS[id], e?.message || e));
  }

  _onLoad(gltf) {
    const vrm = gltf.userData.vrm;
    if (this.gone || !vrm) { if (vrm) VRMUtils.deepDispose(vrm.scene); return; }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);                 // VRM0 faces -Z; turn it to face the camera
    vrm.scene.traverse(o => { o.frustumCulled = false; });
    // VRM0 normalized bones live in a frame turned 180° about Y: pitch and roll flip sign.
    this.sx = vrm.meta?.metaVersion === '0' ? -1 : 1;
    const h = vrm.humanoid;
    this.b = {};
    for (const n of ['spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) this.b[n] = h.getNormalizedBoneNode(n);

    vrm.scene.scale.setScalar(SCALE);
    this.group.add(vrm.scene);
    this._pose(0);
    vrm.update(0);
    this.b.head.getWorldPosition(this.headPos);
    this.group.worldToLocal(this.headPos);
    vrm.scene.position.y = HEAD_Y - this.headPos.y;
    // Spring bones simulate in world units; gravity must scale with the model.
    vrm.springBoneManager?.joints.forEach(j => { j.settings.gravityPower *= SCALE; });
    vrm.springBoneManager?.reset();

    const em = vrm.expressionManager;
    this.x = {};
    for (const n of ['aa', 'ih', 'oh', 'ou', 'ee', 'blink', 'blinkLeft', 'blinkRight', 'happy', 'sad', 'angry', 'relaxed'])
      if (em.getExpression(n)) this.x[n] = n;
    this.x.surprised = em.getExpression('surprised') ? 'surprised' : em.getExpression('Surprised') ? 'Surprised' : null;
    this.eye = new ProceduralEye(vrm, this.id);   // models with an eye rig get the procedural eye
    this.hair = new HairLibrary(vrm, this.id);              // models with a hair library: own style by default
    if (this.hair.ok) this.hair.setStyle('O');
    this.wardrobe = new Wardrobe(vrm);
    for (const [fn, args] of this.pendingHair || []) this[fn](...args);

    this.mtoon = [];
    vrm.scene.traverse(o => [].concat(o.material || []).forEach(m => { if (m.isMToonMaterial && !this.mtoon.includes(m)) this.mtoon.push(m); }));
    this.mtoon.forEach(m => {
      m.parametricRimFresnelPowerFactor = 2.6;
      m.parametricRimLiftFactor = 0.05;
      m.rimLightingMixFactor = 1.0;
    });
    vrm.lookAt.target = this.target;
    this.vrm = vrm;
  }

  // Relaxed arms, then the per-frame additions.
  _pose(breathe) {
    const b = this.b, sx = this.sx;
    b.leftUpperArm.rotation.set(0, 0, -1.22 * sx);
    b.rightUpperArm.rotation.set(0, 0, 1.22 * sx);
    b.leftLowerArm.rotation.set(0, -0.25 * sx, 0);
    b.rightLowerArm.rotation.set(0, 0.25 * sx, 0);
    b.leftShoulder.rotation.set(0, 0, -breathe * sx);
    b.rightShoulder.rotation.set(0, 0, breathe * sx);
  }

  update(s, dt) {
    const vrm = this.vrm;
    if (!vrm) return;
    const t = s.t, b = this.b, sx = this.sx, em = vrm.expressionManager, x = this.x;

    // ---- gaze: focus when locked, drifting glances otherwise, up-and-aside while thinking
    if (t > this.wanderAt) {
      this.wanderAt = t + 1.2 + Math.random() * 2.5;
      this.wander.set((Math.random() - 0.5) * 3.0, HEAD_Y + (Math.random() - 0.5) * 0.6, 4);
    }
    const P = PROFILES[s.profile] || PROFILES.A;
    const sag = s.emo.sag * P.body;
    const gazeUp = s.emo.gaze * 1.5 * P.body;
    this.v.copy(this.wander).lerp(s.focus, clamp01(s.eyeLock));
    this.v.x += s.swirl * 2.6; this.v.y += s.swirl * 2.2 + gazeUp;
    this.target.position.lerp(this.v, 1 - Math.exp(-dt * 10));

    // ---- head follows ~30% of the gaze, plus nod/tilt/lean/flinch
    const dx = this.target.position.x, dy = this.target.position.y - HEAD_Y, dz = Math.max(this.target.position.z, 0.5);
    const yaw = Math.atan2(dx, dz) * 0.3, pitch = -Math.atan2(dy, dz) * 0.3;
    const kh = 1 - Math.exp(-dt * 3);
    this.headYaw += (yaw - this.headYaw) * kh;
    this.headPitch += (pitch - this.headPitch) * kh;
    const flinch = s.glitch;
    const sway = Math.sin(t * 0.5) * 0.02 + Math.sin(t * 0.23) * 0.015;
    const tilt = s.tilt + s.emo.tilt * P.body + s.swirl * 0.1 + sway;
    // Leaning in bends spine, chest and neck forward; the head counters it so the face stays on you.
    const counter = -s.lean * 0.14;
    b.head.rotation.set(sx * (counter + this.headPitch * 0.6 + s.nod - flinch * 0.12 + sag * 0.08), this.headYaw * 0.6, sx * tilt * 0.7);
    b.neck.rotation.set(sx * (this.headPitch * 0.4 + s.lean * 0.05), this.headYaw * 0.4, sx * tilt * 0.3);

    // ---- body: breathing, leaning in, emotional slump/lift
    const breathe = (s.breath - 1) * 1.6 + Math.sin(t * 1.3) * 0.012;
    b.spine.rotation.set(sx * (s.lean * 0.06 + sag * 0.05 - flinch * 0.05), sway * 0.4, 0);
    b.chest.rotation.set(sx * (s.lean * 0.05 - breathe * 0.6), 0, 0);
    this._pose(breathe * 0.5 + flinch * 0.08 + Math.max(0, -sag) * 0.03);

    // ---- face: emotions derived from the blended mood (see EMOTIONS in main.js)
    const e = s.emo, a = e.amount;
    const happy = clamp01(e.smile / 0.8) * (1 - 0.6 * e.gold) * a;
    const sad = clamp01(-e.smile / 0.7) * clamp01(e.sag) * a;
    const angry = clamp01(e.slant) * a;
    const surprised = clamp01((e.open - 1) / 0.6) * a;
    const relaxed = (e.gold * 0.6 + clamp01(e.smile) * 0.2) * a;
    const talk = 1 - P.talk * s.speech;           // keep the mouth free for words
    const set = (n, v) => { if (n) em.setValue(n, v); };
    set(x.happy, P.happy * happy * talk);
    set(x.sad, P.sad * sad * talk);
    set(x.angry, P.angry * angry * talk);   // VRoid's angry shuts the eyes past ~0.4
    set(x.relaxed, P.relaxed * relaxed * talk);
    set(x.surprised, P.surprised * surprised * talk);
    // The eye follows the mood on its own, uncapped and about a second slower than the face.
    if (this.eye?.ok) {
      const eyeT = { happy, sad, angry, surprised, curious: clamp01((e.dilate - 0.55) / 0.15) * a, tender: clamp01(e.gold) * a };
      const k = 1 - Math.exp(-dt / 0.8);
      for (const n in eyeT) this.eyeW[n] += (eyeT[n] - this.eyeW[n]) * k;
      this.eye.update(this.eyeW, t, vrm.lookAt);
    }

    // ---- blinks: natural rhythm, doubles now and then, slow while thinking; none through a smile
    if (this.blinkT < 0 && (t > this.blinkAt || this.blinkQueue > 0)) {
      this.blinkT = t;                        // start time; blinks run on the clock so jank can't stretch them
      if (this.blinkQueue > 0) this.blinkQueue--;
      else if (Math.random() < 0.2) this.blinkQueue = 1;
      this.blinkAt = t + 2 + Math.random() * 4;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      const dur = 0.16 + s.swirl * 0.18;
      const p = (t - this.blinkT) / dur;
      blink = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
      if (p >= 1) { this.blinkT = -1; blink = 0; }
    }
    set(x.blink, clamp01(blink) * (1 - happy * 0.8) * (1 - surprised * 0.5));

    // ---- lip-sync: `aa` carries the voice, `oh`/`ih` keep it from looking mechanical
    const m = s.mouth;
    set(x.aa, clamp01(m * 0.85));
    set(x.oh, clamp01(m * 0.35 * (0.5 + 0.5 * Math.sin(t * 9.0))));
    set(x.ih, clamp01(m * 0.3 * (0.5 + 0.5 * Math.sin(t * 13.0 + 1.0))));

    // ---- rim light takes a little of the mood's color
    this.rim.copy(RIM).lerp(e.glow, 0.45 * a).multiplyScalar(0.55 + 0.25 * s.speech + 0.15 * s.lean);
    for (const mat of this.mtoon) mat.parametricRimColorFactor.copy(this.rim);

    vrm.update(dt);
  }

  debug() { const em = this.vrm?.expressionManager; return em && Object.fromEntries(em.expressions.map(x => [x.expressionName, +x.weight.toFixed(2)]).filter(([, w]) => w > 0.01)); }

  // Hair: a style id ('O' own, 'D', ...), or a look { bangs, sides, back, extras, accessory } of style ids.
  setHair(x) {
    if (!this.hair) { (this.pendingHair ||= []).push(['setHair', [x]]); return; }
    if (typeof x === 'string') this.hair.setStyle(x); else this.hair.setLook(x);
  }
  setOutfit(id) {
    if (!this.wardrobe) { (this.pendingHair ||= []).push(['setOutfit', [id]]); return Promise.resolve(); }
    return this.wardrobe.set(id);
  }
  wear(id, on) {
    if (!this.wardrobe) { (this.pendingHair ||= []).push(['wear', [id, on]]); return Promise.resolve(); }
    return this.wardrobe.wear(id, on);
  }
  setHairColor(part, hex, amount) {
    if (!this.hair) { (this.pendingHair ||= []).push(['setHairColor', [part, hex, amount]]); return; }
    this.hair.setColor(part, hex, amount);
  }

  blinkCascade() { this.blinkQueue = 2; this.blinkAt = 0; }

  dispose() {
    this.gone = true;
    this.group.removeFromParent();
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
  }
}
