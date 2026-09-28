# Maturing the VRoid placeholders (Mira, Kai)

Headless Blender (5.2) + VRM Add-on for Blender 4.7.2 (saturday06, MIT; extension zip
sha256 `e85588660bfbb4099910a86803fa87dc8348e65541a4ccdcaf40c538f60027dc`). Input is the
original CC0 VRoid export (`git show eca0d31:models/avatar/<name>.vrm`), never an already
matured file.

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
# 1. UV islands of the Tops mesh (labels: torso, sleeve, collar, placket, side)
$B --background --python islands.py -- orig/kai.vrm isl_kai.json
# 2. repaint the Tops atlas (textures pulled out of the .vrm; Kai = slate shirt, open collar,
#    Mira = oat knit V-neck); args: char tops.png islands.json body_texture.png out.png
python3 repaint.py kai Tops_01.png isl_kai.json Body_00.png tops_kai.png
# 3. wardrobe + proportions + face, export VRM 0.x
$B --background --python mature.py -- kai orig/kai.vrm ../../models/avatar/kai.vrm tops_kai.png isl_kai.json
# 3b. our own eyes/brows/lashes/face marks, drawn in millimetres on the face (then ART=<dir> for mature.py)
$B --background --python dump_face_uv.py -- ../../models/avatar/kai.vrm faceuv_kai.json
python3 face_art.py kai faceuv_kai.json <extracted textures dir> art_kai
ART=art_kai $B --background --python mature.py -- kai orig/kai.vrm ../../models/avatar/kai.vrm tops_kai.png isl_kai.json wardrobe,proportions,face,identity
# 4. verify budgets, blend-shape binds, bones, lookAt, meta
python3 ../vrm_check.py ../../models/avatar/*.vrm
```

What `mature.py` does (per-character numbers in `P`):
- **wardrobe**: deletes the bow/tie (`AccessoryNeck`), Mira's shirt collar and cyan hair clip;
  swaps in the repainted Tops texture; VRM meta gets a derivative note (CC0, commercial allowed).
- **proportions**: head subtree scaled about the head joint and raised (longer neck); arm
  subtrees moved out (broader shoulders). Vertices move by their skin weight toward those bones;
  bones move in edit mode by translation/uniform scale only, so the T-pose rest is unchanged.
- **face**: smaller eyes (Face mesh only), longer lower face, slimmer lower cheeks, as smooth
  position-based fields over every mesh so seams move together.
- Every deformation is applied to the basis **and every shape key** with the same map, so the
  morph targets (visemes, blinks, emotions) stay aligned.
- **identity**: our palette (Mira copper-rose hair, amber eyes; Kai ash slate hair, grey-green
  eyes) on the MToon factors, and our own iris, highlight, eyeline, lash, brow and face-skin
  textures from `face_art.py` (VRoid's lash spikes, iris, highlights and nose tick are gone;
  Mira has a beauty mark). Everything drawn is procedural, no third-party art.
