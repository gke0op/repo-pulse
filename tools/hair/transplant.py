# transplant.py: put a donor VRoid model's hair (mesh + hair bones + spring chains) on Mira.
# blender --background --python transplant.py -- <mira.vrm> <donor.vrm> <out.vrm> [hair_hex]
import bpy, sys
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
mira_p, donor_p, out_p = a[:3]
hair_hex = a[3] if len(a) > 3 else None


def log(*x): print('TRANSPLANT', *x)


def import_vrm(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    return next(o for o in new if o.type == 'ARMATURE'), new


def human(arm):
    return {b.bone: b.node.bone_name for b in arm.data.vrm_addon_extension.vrm0.humanoid.human_bones if b.node.bone_name}


def head_metrics(arm, objs):
    """Head joint (armature space) and head width from the face skin."""
    h = arm.data.bones[human(arm)['head']].head_local.copy()
    face = next(o for o in objs if o.type == 'MESH' and o.name.startswith('Face'))
    ids = {i for i, m in enumerate(face.data.materials) if m and 'Face_00_SKIN' in m.name}
    xs = [(face.matrix_world @ face.data.vertices[v].co).x for p in face.data.polygons if p.material_index in ids for v in p.vertices]
    return arm.matrix_world @ h, max(xs) - min(xs)


[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
m_arm, m_objs = import_vrm(mira_p)
m_arm.name = 'MiraArmature'
m_head, m_w = head_metrics(m_arm, m_objs)
m_ext = m_arm.data.vrm_addon_extension.vrm0

# 1. Mira's old hair out: mesh, HairJoint bones, their spring groups
for old in [o for o in m_objs if o.type == 'MESH' and 'Hair' in o.name]: bpy.data.objects.remove(old)
sa = m_ext.secondary_animation
for i in reversed(range(len(sa.bone_groups))):
    if any(b.bone_name.startswith(('HairJoint', 'Hair_')) for b in sa.bone_groups[i].bones): sa.bone_groups.remove(i)
bpy.context.view_layer.objects.active = m_arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in [e for e in m_arm.data.edit_bones if e.name.startswith('HairJoint')]: m_arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')

# 2. donor in; remember its hair spring groups before its armature goes away
d_arm, d_objs = import_vrm(donor_p)
d_head, d_w = head_metrics(d_arm, d_objs)
d_hair = [o for o in d_objs if o.type == 'MESH' and o.name.startswith('Hair')]
d_sa = d_arm.data.vrm_addon_extension.vrm0.secondary_animation
d_colliders = {cg.uuid: cg.node.bone_name for cg in d_sa.collider_groups}
groups = []
for g in d_sa.bone_groups:
    roots = [b.bone_name for b in g.bones]
    if roots and all(r.startswith('HairJoint') or 'Hair' in r for r in roots):
        groups.append(dict(roots=roots, stiff=g.stiffiness, grav=g.gravity_power, gdir=tuple(g.gravity_dir),
                           drag=g.drag_force, r=g.hit_radius, cols=[d_colliders.get(c.collider_group_uuid) for c in g.collider_groups]))
# the donor's own scalp cap, to reuse on Mira
d_cap = None
for o in d_objs:
    if o.type != 'MESH' or not o.name.startswith('Body'): continue
    for m in o.data.materials:
        if m and 'HairBack' in m.name:
            t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
            img = t.pbr_metallic_roughness.base_color_texture.index.source
            d_cap = dict(base=list(t.pbr_metallic_roughness.base_color_factor), shade=list(x.shade_color_factor),
                         pixels=img.pixels[:] if img is not None else None, size=tuple(img.size) if img is not None else None)
if d_cap is None:                         # hair-only samples: take the main (largest) hair material's colour
    import numpy as np
    area = {}
    for o in d_hair:
        for pg in o.data.polygons: area[o.data.materials[pg.material_index].name] = area.get(o.data.materials[pg.material_index].name, 0) + pg.area
    m = bpy.data.materials[max(area, key=area.get)]
    t = m.vrm_addon_extension.mtoon1; img = t.pbr_metallic_roughness.base_color_texture.index.source
    f = np.array(list(t.pbr_metallic_roughness.base_color_factor)[:3])
    if img is not None:
        px = np.array(img.pixels[:], np.float32).reshape(-1, 4); px = px[px[:, 3] > 0.5][:, :3]
        f = f * np.median(px, 0)
    f = f * 0.22                          # the texture median is its highlight; the hair reads near its shade
    d_cap = dict(base=[float(c) for c in f] + [1.0], shade=[float(c) * 0.6 for c in f], pixels=None, size=None, flat=True)
s = m_w / d_w
log('fit', 'scale', round(s, 3), 'head', tuple(round(x, 3) for x in d_head), '->', tuple(round(x, 3) for x in m_head), 'groups', len(groups))

# 3. fit the donor: move/scale its armature so its head joint lands on Mira's, then bake the transform
T = Matrix.Translation(m_head) @ Matrix.Scale(s, 4) @ Matrix.Translation(-d_head)
d_arm.matrix_world = T @ d_arm.matrix_world
for o in d_hair: o.matrix_world = T @ o.matrix_world
bpy.ops.object.select_all(action='DESELECT')
for o in [d_arm] + d_hair: o.select_set(True)
bpy.context.view_layer.objects.active = d_arm
bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)

# 4. keep only the donor's hair bones, graft them onto Mira's head
hair_bones = {b.name for b in d_arm.data.bones if b.name.startswith('HairJoint') or (b.parent and b.parent.name.startswith('HairJoint'))}
def is_hair(b):
    while b:
        if b.name.startswith('HairJoint'): return True
        b = b.parent
    return False
bpy.ops.object.mode_set(mode='EDIT')
for eb in list(d_arm.data.edit_bones):
    if not is_hair(eb): d_arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
kept = {b.name for b in d_arm.data.bones}
roots_parented = [b.name for b in d_arm.data.bones if b.parent is None]
# other objects of the donor (body, face...) go
for o in d_objs:
    if o not in d_hair and o is not d_arm and o.name in bpy.data.objects: bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
m_arm.select_set(True); d_arm.select_set(True); bpy.context.view_layer.objects.active = m_arm
bpy.ops.object.join()
head_name = human(m_arm)['head']
bpy.ops.object.mode_set(mode='EDIT')
for n in roots_parented:
    if n in m_arm.data.edit_bones: m_arm.data.edit_bones[n].parent = m_arm.data.edit_bones[head_name]
bpy.ops.object.mode_set(mode='OBJECT')

# 5. hair meshes follow Mira's armature; donor head weights map to her head bone (same name after the join)
for o in d_hair:
    o.parent = m_arm
    for md in o.modifiers:
        if md.type == 'ARMATURE': md.object = m_arm
    for vg in o.vertex_groups:
        if vg.name not in m_arm.data.bones and vg.name.startswith('J_Bip_C_Head'): vg.name = head_name

# 6. spring chains, with colliders matched to Mira's by bone
m_cols = {cg.node.bone_name: cg.uuid for cg in m_ext.secondary_animation.collider_groups}
for g in groups:
    ng = m_ext.secondary_animation.bone_groups.add(); ng.comment = 'donor_hair'
    for r in g['roots']:
        if r in m_arm.data.bones: ng.bones.add().bone_name = r
    ng.stiffiness, ng.gravity_power, ng.gravity_dir, ng.drag_force, ng.hit_radius = g['stiff'], g['grav'], g['gdir'], g['drag'], g['r'] * s
    for c in g['cols']:
        if c in m_cols: ng.collider_groups.add().collider_group_uuid = m_cols[c]

# 6b. the scalp cap (her body's HairBack material) takes the donor's own cap: texture + colours, designed to match its hair
body = next((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Body') and o.parent == m_arm), None)
if body and d_cap:
    for m in body.data.materials:
        if m and 'HairBack' in m.name:
            t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
            img = t.pbr_metallic_roughness.base_color_texture.index.source
            if img is not None and d_cap.get('flat'):        # flat colour: a white texture so the factor is the colour
                import numpy as np
                a_ = np.ones(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_set(a_); img.update(); img.pack()
            if img is not None and d_cap['pixels'] is not None:
                src = d_cap['pixels']
                if tuple(d_cap['size']) != tuple(img.size): img.scale(*d_cap['size'])
                img.pixels.foreach_set(src); img.update(); img.pack()
            t.pbr_metallic_roughness.base_color_factor = d_cap['base']
            x.shade_color_factor = d_cap['shade']
            log('cap', m.name, 'from donor', [round(c, 3) for c in d_cap['base'][:3]])

# 7. optional recolour (hair MToon base + shade), and Mira's scalp cap takes the hair colour
if hair_hex:
    lin = [(int(hair_hex[i:i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)]
    for o in d_hair:
        for m in o.data.materials:
            t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
            t.pbr_metallic_roughness.base_color_factor = lin + [1.0]
            x.shade_color_factor = [c * 0.55 for c in lin]

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in d_hair)
log('hair', [o.name for o in d_hair], tris, 'tris', len(kept), 'bones', len(groups), 'chains')
bpy.context.view_layer.objects.active = m_arm
log('export', bpy.ops.export_scene.vrm(filepath=out_p, armature_object_name=m_arm.name))
