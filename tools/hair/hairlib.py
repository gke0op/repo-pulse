# hairlib.py: build a character's modular hair library in one VRM.
#   blender --background --python hairlib.py -- <character.vrm> <out.vrm> <TAG=donor.vrm> [TAG=donor.vrm ...]
# The character's own hair becomes set "O"; each donor's hair is fitted to the head, grafted (bones + springs),
# and split into parts. Every part is its own mesh "HairPart_<TAG>_<part>" with its own materials; every spring
# chain is labelled "hair:<TAG>:<part>" (boneGroup comment) so the app can show/colour/simulate parts freely.
import bpy, bmesh, sys, json
from mathutils import Vector, Matrix
args = sys.argv[sys.argv.index('--') + 1:]
char_p, out_p, donors = args[0], args[1], [a.split('=', 1) for a in args[2:]]
# TAG=path@mohawk keeps only the donor's strands along the centre line of the head (the cap makes the shaved sides)
donors = [(t, p.split('@')[0], (p.split('@') + [''])[1]) for t, p in donors]
PARTS = ('bangs', 'sides', 'back', 'extras', 'accessory')
TEX_MAX = 1024


def log(*x): print('HAIRLIB', *x)


def import_vrm(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.vrm(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    return next(o for o in new if o.type == 'ARMATURE'), new


def humanmap(arm):
    return {b.bone: b.node.bone_name for b in arm.data.vrm_addon_extension.vrm0.humanoid.human_bones if b.node.bone_name}


def head_metrics(arm, objs):
    h = arm.matrix_world @ arm.data.bones[humanmap(arm)['head']].head_local
    face = next(o for o in objs if o.type == 'MESH' and o.name.startswith('Face'))
    ids = {i for i, m in enumerate(face.data.materials) if m and 'Face_00_SKIN' in m.name}
    xs = [(face.matrix_world @ face.data.vertices[v].co).x for p in face.data.polygons if p.material_index in ids for v in p.vertices]
    return h, max(xs) - min(xs)


[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
arm, objs = import_vrm(char_p)
arm.name = 'CharArmature'
head = humanmap(arm)['head']
H, width = head_metrics(arm, objs)
face = next(o for o in objs if o.type == 'MESH' and o.name.startswith('Face'))
chin = min((face.matrix_world @ v.co).z for v in face.data.vertices)
ext = arm.data.vrm_addon_extension.vrm0
sa = ext.secondary_animation
cols_by_bone = {cg.node.bone_name: cg.uuid for cg in sa.collider_groups}


def chain_root(bn):
    b = arm.data.bones.get(bn)
    if b is None or bn == head: return head
    while b.parent and b.parent.name != head: b = b.parent
    return b.name


def split(hair, tag):
    """Split one fitted hair object into part objects; returns {chain_root: part}."""
    M = hair.matrix_world; me = hair.data
    gname = {g.index: g.name for g in hair.vertex_groups}
    tri_by_mat = {}
    for p in me.polygons: tri_by_mat[p.material_index] = tri_by_mat.get(p.material_index, 0) + len(p.vertices) - 2
    total = sum(tri_by_mat.values()); main_mat = max(tri_by_mat, key=tri_by_mat.get)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); dl = bm.verts.layers.deform.active
    seen = set(); pieces = []
    for f in bm.faces:
        if f.index in seen: continue
        st, fs = [f], []; seen.add(f.index)
        while st:
            x = st.pop(); fs.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y.index not in seen: seen.add(y.index); st.append(y)
        w = {}
        for x in fs:
            for v in x.verts:
                for gi, wt in v[dl].items(): w[gname[gi]] = w.get(gname[gi], 0) + wt
        dom = max(w, key=w.get) if w else head
        pieces.append(dict(faces=[x.index for x in fs], root=chain_root(dom), mat=fs[0].material_index,
                           P=[M @ v.co for x in fs for v in x.verts]))
    bm.free()
    groups = {}
    for k, pc in enumerate(pieces):
        groups.setdefault((pc['root'], pc['mat']) if pc['root'] != head else ('piece', k), []).append(pc)
    assign, root_part = {}, {}
    for key, pcs in groups.items():
        root = key[0] if key[0] != 'piece' else head; mat = pcs[0]['mat']
        P = [p for pc in pcs for p in pc['P']]; c = sum(P, Vector()) / len(P)
        lo = min(p.z for p in P)
        if tri_by_mat[mat] / total < 0.06 and mat != main_mat: part = 'accessory'
        elif lo < chin - 0.03 and abs(c.x - H.x) > 0.075 and c.y > H.y - 0.02 and root != head: part = 'extras'
        elif c.y < H.y - 0.03 and lo > chin - 0.01 and abs(c.x - H.x) < 0.07: part = 'bangs'
        elif c.y < H.y + 0.015 and abs(c.x - H.x) >= 0.045: part = 'sides'
        else: part = 'back'
        if root != head: root_part[root] = part
        for pc in pcs:
            for fi in pc['faces']: assign[fi] = part
    stats = {}
    for pt in sorted(set(assign.values())):
        o = hair.copy(); o.data = hair.data.copy(); bpy.context.scene.collection.objects.link(o)
        o.name = f'HairPart_{tag}_{pt}'; o.data.name = o.name
        for i, m in enumerate(o.data.materials):
            if m: mc = m.copy(); mc.name = f'Hair_{tag}_{pt}_{i}'; o.data.materials[i] = mc
        b2 = bmesh.new(); b2.from_mesh(o.data); b2.faces.ensure_lookup_table()
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if assign.get(f.index) != pt], context='FACES')
        b2.to_mesh(o.data); b2.free()
        stats[pt] = sum(len(p.vertices) - 2 for p in o.data.polygons)
    bpy.data.objects.remove(hair)
    log('split', tag, json.dumps(stats))
    return root_part


def rename_chains(root_part, tag):
    """Chain bones get names H_<tag>_<part>_<k>_<j>, so the app can tell which part a spring joint belongs to.
    Vertex groups on the hair meshes are renamed with them."""
    ren = {}
    for k, (root, pt) in enumerate(sorted(root_part.items())):
        b = arm.data.bones.get(root)
        if b is None: continue
        stack, j = [b], 0
        while stack:
            x = stack.pop(); ren[x.name] = f'H_{tag}_{pt}_{k}_{j}'; j += 1; stack.extend(x.children)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.startswith(f'HairPart_{tag}_'):
            for vg in o.vertex_groups:
                if vg.name in ren: vg.name = ren[vg.name]
    for old_n, new_n in ren.items(): arm.data.bones[old_n].name = new_n
    return ren


def label_chains(root_part, tag, spec_groups):
    """Recreate/label spring groups: one group per (part), roots from that part."""
    ren = rename_chains(root_part, tag)
    root_part = {ren.get(r, r): pt for r, pt in root_part.items()}
    spec_groups = [dict(g, roots=[ren.get(r, r) for r in g['roots']]) for g in spec_groups]
    by_part = {}
    for g in spec_groups:
        for r in g['roots']:
            pt = root_part.get(r)
            if pt is None or r not in arm.data.bones: continue
            by_part.setdefault((pt, g['stiff'], g['grav'], g['gdir'], g['drag'], g['r'], tuple(g['cols'])), []).append(r)
    for (pt, stiff, grav, gdir, drag, rad, cols), roots in by_part.items():
        ng = sa.bone_groups.add(); ng.comment = f'hair:{tag}:{pt}'
        for r in roots: ng.bones.add().bone_name = r
        ng.stiffiness, ng.gravity_power, ng.gravity_dir, ng.drag_force, ng.hit_radius = stiff, grav, gdir, drag, rad
        for c in cols:
            if c in cols_by_bone: ng.collider_groups.add().collider_group_uuid = cols_by_bone[c]


def take_groups(sa_src, colmap, scale=1.0):
    out = []
    for g in sa_src.bone_groups:
        roots = [b.bone_name for b in g.bones]
        if roots and all(r.startswith(('HairJoint', 'J_Sec_Hair')) for r in roots):
            out.append(dict(roots=roots, stiff=g.stiffiness, grav=g.gravity_power, gdir=tuple(g.gravity_dir), drag=g.drag_force,
                            r=g.hit_radius * scale, cols=[colmap.get(c.collider_group_uuid) for c in g.collider_groups]))
    return out


# ---- set O: the character's own hair
own = next(o for o in objs if o.type == 'MESH' and 'Hair' in o.name)
own_groups = take_groups(sa, {cg.uuid: cg.node.bone_name for cg in sa.collider_groups})
for i in reversed(range(len(sa.bone_groups))):
    if any(b.bone_name.startswith(('HairJoint', 'J_Sec_Hair')) for b in sa.bone_groups[i].bones): sa.bone_groups.remove(i)
label_chains(split(own, 'O'), 'O', own_groups)

# ---- donors
for tag, path, mode in donors:
    d_arm, d_objs = import_vrm(path)
    dH, dw = head_metrics(d_arm, d_objs)
    d_hair = [o for o in d_objs if o.type == 'MESH' and o.name.startswith('Hair')]
    d_sa = d_arm.data.vrm_addon_extension.vrm0.secondary_animation
    s = width / dw
    groups = take_groups(d_sa, {cg.uuid: cg.node.bone_name for cg in d_sa.collider_groups}, s)
    T = Matrix.Translation(H) @ Matrix.Scale(s, 4) @ Matrix.Translation(-dH)
    d_arm.matrix_world = T @ d_arm.matrix_world
    for o in d_hair: o.matrix_world = T @ o.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    for o in [d_arm] + d_hair: o.select_set(True)
    bpy.context.view_layer.objects.active = d_arm
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    def is_hair(b):
        while b:
            if b.name.startswith(('HairJoint', 'J_Sec_Hair')): return True
            b = b.parent
        return False
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in list(d_arm.data.edit_bones):
        if not is_hair(eb): d_arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')
    roots = [b.name for b in d_arm.data.bones if b.parent is None]
    for o in d_objs:
        if o not in d_hair and o is not d_arm and o.name in bpy.data.objects: bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True); d_arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT')
    for n in roots:
        if n in arm.data.edit_bones: arm.data.edit_bones[n].parent = arm.data.edit_bones[head]
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in d_hair:
        o.parent = arm
        for md in o.modifiers:
            if md.type == 'ARMATURE': md.object = arm
        for vg in o.vertex_groups:
            if vg.name not in arm.data.bones and vg.name.startswith('J_Bip_C_Head'): vg.name = head
    if len(d_hair) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in d_hair: o.select_set(True)
        bpy.context.view_layer.objects.active = d_hair[0]; bpy.ops.object.join()
    if mode == 'mohawk':
        hob = d_hair[0]; Mh = hob.matrix_world
        bmh = bmesh.new(); bmh.from_mesh(hob.data); bmh.faces.ensure_lookup_table()
        seen, kill, keep_n = set(), [], 0
        for f in bmh.faces:
            if f.index in seen: continue
            st, fs = [f], []; seen.add(f.index)
            while st:
                x = st.pop(); fs.append(x)
                for e in x.edges:
                    for y in e.link_faces:
                        if y.index not in seen: seen.add(y.index); st.append(y)
            P = [Mh @ v.co for x in fs for v in x.verts]; c = sum(P, Vector()) / len(P)
            if abs(c.x - H.x) > 0.024 or max(p.z for p in P) < H.z + 0.07: kill.extend(fs)
            else: keep_n += 1
        bmesh.ops.delete(bmh, geom=kill, context='FACES'); bmh.to_mesh(hob.data); bmh.free()
        log('mohawk', tag, 'kept', keep_n, 'strips')
    label_chains(split(d_hair[0], tag), tag, groups)

# ---- the scalp cap (body's HairBack material) becomes its own always-present part "HairPart_base_cap",
#      so the app can recolour it (e.g. skin tone for bald) independently of the body
body = next((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Body') and o.parent == arm), None)
if body:
    capi = {i for i, m in enumerate(body.data.materials) if m and 'HairBack' in m.name}
    if capi:
        cap = body.copy(); cap.data = body.data.copy(); bpy.context.scene.collection.objects.link(cap)
        cap.name = 'HairPart_base_cap'; cap.data.name = cap.name
        for i, m in enumerate(cap.data.materials):
            if i in capi: mc = m.copy(); mc.name = 'Hair_base_cap'; cap.data.materials[i] = mc
        for ob, keep in ((cap, True), (body, False)):
            b2 = bmesh.new(); b2.from_mesh(ob.data); b2.faces.ensure_lookup_table()
            bmesh.ops.delete(b2, geom=[f for f in b2.faces if (f.material_index in capi) != keep], context='FACES')
            b2.to_mesh(ob.data); b2.free()
        log('cap split', sum(len(p.vertices) - 2 for p in cap.data.polygons), 'tris')

# ---- default look: the character's own hair visible, everything else hidden (the app decides at runtime)
# (VRM has no per-mesh visibility; the app hides parts by name. Keep all visible in the file.)
# ---- textures: cap at TEX_MAX for the phone
for img in bpy.data.images:
    if img.size[0] > TEX_MAX or img.size[1] > TEX_MAX:
        f = TEX_MAX / max(img.size); img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f))); img.pack()
parts = sorted(o.name for o in bpy.data.objects if o.name.startswith('HairPart_'))
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.name.startswith('HairPart_')}
for o in bpy.data.objects:                          # donor leftovers: groups for bones that did not come along
    if o.name.startswith('HairPart_'):
        for vg in [vg for vg in o.vertex_groups if vg.name not in arm.data.bones]: o.vertex_groups.remove(vg)
bad_vg = [(o.name, vg.name) for o in bpy.data.objects if o.name.startswith('HairPart_') for vg in o.vertex_groups if vg.name not in arm.data.bones]
log('vertex groups without a bone', len(bad_vg), bad_vg[:3])
log('parts', len(parts), 'hair tris', sum(tris.values()), 'chains', len([g for g in sa.bone_groups if g.comment.startswith('hair:')]))
bpy.context.view_layer.objects.active = arm
log('export', bpy.ops.export_scene.vrm(filepath=out_p, armature_object_name=arm.name))
