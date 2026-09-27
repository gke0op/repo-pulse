# Avatar handoff: making characters that plug into the app

For whoever builds Mira and Kai (or a new character) outside the main session.
Everything here describes the system as of v0.9.1 (`23b4c4b`).

## How the avatar system works today

```
Android app (Kotlin)                          WebView (three.js, fully offline)
───────────────────                          ─────────────────────────────────
Pipeline events ──▶ AvatarView.kt ──evaluateJavascript──▶ window.avatar.*  (web/avatar/src/main.js)
  onThinking            setState('thinking')                  │
  onSpeechChunk         speak(envelope, 20, delayMs)          ▼
  onInterrupted         flinch() + setState('listening')   state blend (s) ──▶ character.update(s, dt)
  onTurnDone            setState('idle')                                        Shoggoth | Orb | (your avatar)
VAD (mic) ──────────▶  setState('listening')
```

- Source: `web/avatar/src/`. Bundled by esbuild into `app/src/main/assets/avatar/avatar.js`
  (committed), loaded from `file:///android_asset/avatar/index.html`. No network at runtime.
- Character ids (fixed): `girl` = Mira, `boy` = Kai, `machine` = Unit Seven.
- `main.js` picks the class in `setCharacter(id)`. Today: `machine` is `Shoggoth`; `girl` and `boy`
  are placeholder `Orb`s.
- Build and check: `cd web/avatar && npm ci && npm run build && npm run shoot -- /tmp/shots`
  (`shoot` renders every state in headless Chromium and **fails on any console error**, e.g. a
  shader compile error or a model that won't load).

## The contract an avatar must fulfil

An avatar is a JS class with this shape (see `shoggoth.js` and `orb.js` for the two existing ones):

```js
class MyAvatar {
  constructor(scene)          // build meshes, add this.group to the scene
  group                       // THREE.Group; main.js converts the focus point into this group's space
  update(s, dt)               // called every frame; read s, move things. Never allocate per frame.
  blinkCascade()              // a wave of blinks (state changes, being startled); may be a no-op
  dispose()                   // remove from scene, free geometries/materials/textures
}
```

### The state `s` passed to `update()` (all values already smoothed by main.js)

| Field | Range | Meaning, and what a human avatar should do with it |
|---|---|---|
| `t` | seconds | Time. Idle motion. |
| `breath` | ~0.93–1.02 | Breathing scale; dips on a flinch. Chest/shoulders rise and fall. |
| `mouth` | 0–1 | **Lip-sync**, fast attack/slow release, from the real voice audio. Drive the `aa` viseme (plus a little `oh`/`ih` variation). |
| `speech` | 0–1 | Slower loudness. Subtle head bob, brighter eyes while talking. |
| `lean` | 0–1 | 1 while listening. Lean head and chest toward the camera (~6–8°). |
| `eyeLock` | 0–1 | 1 = eyes locked on `focus` (listening, speaking, touch); low = eyes wander. |
| `focus` | Vector3, in `group` space | What to look at: the camera (the user) or the user's finger. Feed it to VRM `lookAt`, head follows ~30%. |
| `swirl` | 0–1 | 1 while thinking. For a human: glance up and to the side, slow blink, maybe a small head tilt. |
| `nod`, `tilt` | radians, small | Pre-made listening nod and thinking tilt; add to head rotation. |
| `dilate` | 0–1 | Attention. Optional (pupil size / slightly wider eyes). |
| `pulse`, `ripple`, `unrest`, `glitch`, `maskEyes`, `glowColor` | — | Shoggoth-specific; ignore for humans. `glitch` > 0 means just startled: a small flinch. |

### States (set by the app; `main.js` blends between them over ~0.2 s)

| State | When | Should read as |
|---|---|---|
| `idle` | Nothing happening | Relaxed, breathing, occasional glances and blinks |
| `listening` | The user's voice is detected | Leaning in, eyes on the user, small nods |
| `thinking` | The user finished; the reply is being written (can be several seconds) | Looks away and up, thoughtful. This state carries the wait, so make it read as engaged, not frozen |
| `speaking` | Audio is playing | Mouth follows `mouth`, eyes mostly on the user |
| (flinch) | The user interrupted | Quick startle, blink, then `listening` |

## Humans (Mira, Kai): VRoid Studio to `.vrm`

The human path is **specified but not built yet**. The next integration step in the main repo is a
`VrmAvatar` class (using `@pixiv/three-vrm`) that implements the contract above. Make the models to
this spec and they will drop straight in.

### Export requirements (VRoid Studio → Export → VRM)

- **Format:** VRM 1.0 preferred (VRM 0.x also loads via three-vrm).
- **Expressions (blend shapes) that must exist and work.** VRoid includes them by default, so
  don't delete them:
  - Visemes `aa`, `ih`, `ou`, `ee`, `oh`: lip-sync, `aa` does most of the work.
  - `blink`, `blinkLeft`, `blinkRight`.
  - `happy`, `angry`, `sad`, `relaxed`, `surprised`: for the upcoming emotion tags.
- **LookAt** configured (VRoid does this); eyes must be able to track a point.
- **Humanoid bones:** standard VRoid rig (`hips`, `spine`, `chest`, `neck`, `head`, eyes). Lean, nod
  and breathing rotate `spine`/`chest`/`neck`/`head`.
- **Spring bones** (hair, clothes) are welcome; keep the count modest.
- **Mobile budget** (target: smooth 60 fps on an S24 Ultra, usable on an Exynos S20+). Use VRoid's
  export optimization:
  - Polygons: reduce to **≤ 40k triangles** (hide back hair layers and underclothes you never see).
  - Textures: atlas at **2048 × 2048 max**; "reduce materials" on.
  - File size: **≤ 25 MB** per `.vrm` (it ships inside the APK).
- **Framing:** the avatar view is portrait, about 1080 × 1000 px, showing **head and upper body**.
  Design the face, hair and shoulders to read well at that crop. Legs and shoes don't matter.

### Look and fit with the world

- The stage is near-black with a faint violet glow and drifting dust. Characters should hold up on
  dark backgrounds; rim-lit silhouettes read best.
- Voices already cast (Supertonic 3): Mira = speaker 1 (bright female), Kai = speaker 6 (calm male).
  Design faces that match those voices.
- Personalities (from `Characters.kt`): Mira is warm, playful and a little teasing, and notices small
  details. Kai is calm, dry-humored, thoughtful, says a lot with few words, and is fiercely loyal.
- Unit Seven stays procedural (the shoggoth). No VRM needed for him.

### Delivery

- Files: `mira.vrm`, `kai.vrm`, placed at `app/src/main/assets/avatar/models/`.
- Include the VRM meta (author, license). Commercial use must be allowed. Check VRoid Studio's
  current terms for preset hair and clothing assets before shipping; to my knowledge they allow
  this, but verify it.
- Quick self-check before handing over: open the file in a VRM viewer (e.g. VRoid Hub preview or any
  three-vrm viewer), move each viseme and blink slider, and confirm the eyes follow the cursor.

## Making another procedural character (like Unit Seven)

1. Add `web/avatar/src/<name>.js` implementing the contract above. Only use our own code or
   permissively licensed code; no downloaded models.
2. In `main.js` → `setCharacter`, map the character id to your class.
3. `npm run build && npm run shoot -- /tmp/shots`, check the screenshots of every state, then build
   the APK (`./gradlew :app:assembleDebug`).
4. Gotchas we hit with Unit Seven:
   - Anything placed on a deforming surface (eyes, the mask) must use the **same deformation in JS
     as in the shader** (`lobes()` exists twice on purpose).
   - Don't let independent parts move separately near each other: the "leaning in" motion had to
     become a whole-body tilt, or the flesh slid over the mask.
   - Shaders do manual gamma (`pow(col, 1/2.2)`); keep dark values really dark (≈0.003 linear),
     or the scene looks washed out.
   - Normals from fine noise make specular highlights look smudged; derive normals from the large
     shape only.

## What the main session builds next on its side

- `VrmAvatar` class (three-vrm) mapping `s` onto expressions, lookAt and bones as in the table above.
- Emotion tags from the brain (e.g. `[happy]`) driving the `happy`/`sad`/… expressions, and Unit
  Seven's mask and veins.
