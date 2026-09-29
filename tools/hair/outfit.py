# outfit.py: dress a character in a donor VRoid model's outfit (the donor's whole Body mesh: clothes + matching skin),
# retargeted from the donor's rest skeleton to the character's (linear-blend skinning by the donor's own weights),
# skin faces repainted with the character's skin material. The character's own Body is replaced; its scalp cap is kept.
#   blender --background --python outfit.py -- <character.vrm> <donor.vrm> <out.vrm>
import bpy, bmesh, sys
import numpy as np
from mathutils import Matrix
a = sys.argv[sys.argv.index('--') + 1:]; char_p, donor_p, out_p = a[:3]
import os; KEEP_SKIN = bool(os.environ.get('KEEP_SKIN'))


def log(*x): print('OUTFIT', *x)


def import_vrm(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    return next(o for o in new if o.type == 'ARMATURE'), new


[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
arm, objs = import_vrm(char_p)
body = next(o for o in objs if o.type == 'MESH' and o.name.startswith('Body'))
skin_mat = next(m for m in body.data.materials if m and 'Body_00_SKIN' in m.name)
d_arm, d_objs = import_vrm(donor_p)
d_body = next(o for o in d_objs if o.type == 'MESH' and o.name.startswith('Body'))


def rest(armobj, name):
    b = armobj.data.bones.get(name)
    return (armobj.matrix_world @ b.matrix_local) if b else None


# 1. retarget the donor body: v' = sum_i w_i * (R_char_i * R_donor_i^-1) v, in world space
me = d_body.data; Mw = d_body.matrix_world
gname = {g.index: g.name for g in d_body.vertex_groups}
xf, missing = {}, set()
for g in d_body.vertex_groups:
    rd, rc = rest(d_arm, g.name), rest(arm, g.name)
    if rd is not None and rc is not None: xf[g.name] = rc @ rd.inverted()
    else: missing.add(g.name)
out = []
for v in me.vertices:
    p = Mw @ v.co; acc = np.zeros(3); wsum = 0.0
    for g in v.groups:
        T = xf.get(gname[g.group])
        if T is None or g.weight <= 0: continue
        acc += g.weight * np.array(T @ p); wsum += g.weight
    out.append(acc / wsum if wsum > 1e-6 else np.array(p))
Mi = Mw.inverted()
for v, p in zip(me.vertices, out): v.co = Mi @ __import__('mathutils').Vector(p)
me.update()
log('retargeted', len(me.vertices), 'verts', 'groups without a character bone:', sorted(missing)[:8])

# 2. skin faces take the character's skin; drop the donor's scalp cap (the character keeps its own)
for i, m in enumerate(me.materials):
    if m and 'Body_00_SKIN' in m.name and not KEEP_SKIN: me.materials[i] = skin_mat
from mathutils.bvhtree import BVHTree
cap_c0 = {i for i, m in enumerate(body.data.materials) if m and 'HairBack' in m.name}
BM = body.matrix_world
cv = [BM @ v.co for v in body.data.vertices]
cp = [list(p.vertices) for p in body.data.polygons if p.material_index in cap_c0]
cap_bvh = BVHTree.FromPolygons(cv, cp) if cp else None
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
cap_i = {i for i, m in enumerate(me.materials) if m and 'HairBack' in m.name}
def under_cap(f):                     # donor scalp skin lying under the character's cap
    if cap_bvh is None: return False
    c = Mw @ f.calc_center_median(); hit = cap_bvh.find_nearest(c)
    return hit[0] is not None and hit[3] < 0.006
dl = bm.verts.layers.deform.active
head_gi = {g.index for g in d_body.vertex_groups if g.name == 'J_Bip_C_Head' or g.name.startswith(('J_Adj_L_FaceEye', 'J_Adj_R_FaceEye'))}
def head_dom(f, dl=dl, gi=head_gi):
    wh = wt = 0.0
    for v in f.verts:
        for k, w in v[dl].items():
            wt += w
            if k in gi: wh += w
    return wt > 0 and wh / wt > 0.5
face_obj = next(o for o in objs if o.type == 'MESH' and o.name.startswith('Face'))
CHIN = min((face_obj.matrix_world @ v.co).z for v in face_obj.data.vertices)
CUT = CHIN + float(os.environ.get('CUT_OFFSET', '0.012'))
kill = [f for f in bm.faces if f.material_index in cap_i or (head_dom(f) and (Mw @ f.calc_center_median()).z > CUT + 0.006)]
log('removed donor scalp faces', len(kill))
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(me); bm.free()

# 3. the character's body: keep only its scalp cap faces
cap_c = {i for i, m in enumerate(body.data.materials) if m and 'HairBack' in m.name}
bm = bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
cdl = bm.verts.layers.deform.active
c_head = {g.index for g in body.vertex_groups if g.name == 'J_Bip_C_Head' or g.name.startswith(('J_Adj_L_FaceEye', 'J_Adj_R_FaceEye'))}
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in cap_c and not (head_dom(f, cdl, c_head) and (BM @ f.calc_center_median()).z > CUT)], context='FACES')
bm.to_mesh(body.data); bm.free()

# 4. move the donor body onto the character's armature (same bone names), drop the rest of the donor
d_body.parent = arm; d_body.matrix_world = d_body.matrix_world  # keep world placement
for md in d_body.modifiers:
    if md.type == 'ARMATURE': md.object = arm
for g in list(d_body.vertex_groups):
    if g.name not in arm.data.bones: d_body.vertex_groups.remove(g)
d_body.name = 'Outfit'; d_body.data.name = 'Outfit'
for o in d_objs:
    if o is not d_body and o.name in bpy.data.objects: bpy.data.objects.remove(o)
if os.environ.get('NO_OUTLINE'):
    for m in me.materials:
        if m: m.vrm_addon_extension.mtoon1.extensions.vrmc_materials_mtoon.outline_width_mode = 'none'
tris = sum(len(p.vertices) - 2 for p in me.polygons)
bpy.context.view_layer.objects.active = arm
log('outfit tris', tris, 'export', bpy.ops.export_scene.vrm(filepath=out_p, armature_object_name=arm.name))
