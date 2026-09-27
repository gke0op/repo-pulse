# Blender headless: mature a VRoid VRM 0.x in place.
# blender --background --python mature.py -- <char> <in.vrm> <out.vrm> <tops.png> <islands.json> [stages]
# stages: comma list of wardrobe,proportions,face (default all)
import bpy, bmesh, sys, json, math
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
char, src, dst, tops_png, islp = a[:5]
stages = set((a[5] if len(a) > 5 else 'wardrobe,proportions,face').split(','))
P = {  # per-character tuning
    'mira': dict(neck=0.020, head=0.93, shoulder=0.010, eye=0.90, jaw=0.12, cheek=0.06),
    'kai':  dict(neck=0.026, head=0.91, shoulder=0.020, eye=0.85, jaw=0.20, cheek=0.10),
}[char]

[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
bpy.ops.import_scene.vrm(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body, face, hair = bpy.data.objects['Body'], bpy.data.objects['Face'], bpy.data.objects['Hair001']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
ext = arm.data.vrm_addon_extension
human = {b.bone: b.node.bone_name for b in ext.vrm0.humanoid.human_bones if b.node.bone_name}


def log(*x): print('MATURE', *x)


def tri_count():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)


log('tris before', tri_count())

# ---------------------------------------------------------------- wardrobe
def delete_faces(ob, pred):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if pred(f)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    # shape keys ride along: bmesh keeps shape layers
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return len(kill)


if 'wardrobe' in stages:
    mats = body.data.materials
    acc = [i for i, m in enumerate(mats) if 'AccessoryNeck' in m.name]
    log('removed bow/tie faces', delete_faces(body, lambda f: f.material_index in acc))
    if char == 'mira':
        tops = [i for i, m in enumerate(mats) if 'Tops' in m.name][0]
        bm = bmesh.new(); bm.from_mesh(body.data); uvl = bm.loops.layers.uv.active
        kill = []
        for f in bm.faces:
            if f.material_index != tops: continue
            us = [l[uvl].uv for l in f.loops]
            u0, u1 = min(u.x for u in us), max(u.x for u in us)
            v0 = min(u.y for u in us)
            if (u0 > 0.325 and u1 < 0.675 and v0 > 0.755) or (v0 > 0.59 and (u1 < 0.15 or u0 > 0.85) and max(u.y for u in us) < 0.635):
                kill.append(f)
        bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(body.data); bm.free()
        log('removed collar faces', len(kill))
        clip = [i for i, m in enumerate(hair.data.materials) if m.name.endswith('HAIR_02')]
        log('removed hair clip faces', delete_faces(hair, lambda f: f.material_index in clip))   # the cyan X clip
    img = next(n.image for m in mats if 'Tops' in m.name for n in m.node_tree.nodes
               if n.type == 'TEX_IMAGE' and n.image and 'Tops' in n.image.name)
    new = bpy.data.images.load(tops_png)
    assert tuple(new.size) == tuple(img.size)
    img.pixels.foreach_set(new.pixels[:]); img.update(); img.pack()   # repack from pixels, not the old bytes
    bpy.data.images.remove(new)
    log('tops texture replaced', img.name, tuple(img.size))

    meta = ext.vrm0.meta
    meta.title = {'mira': 'Mira', 'kai': 'Kai'}[char]
    meta.version = 'adult-1'
    base = {'mira': 'VRoid "Sendagaya Shino"', 'kai': 'VRoid "Sakurada Fumiriya"'}[char]
    meta.other_permission_url = ''
    meta.other_license_url = (f'Modified derivative of {base} (CC0): school uniform replaced, '
                              'proportions and face matured to adult. Still CC0.')
    log('meta', meta.license_name, meta.commercial_ussage_name)


# ---------------------------------------------------------------- shared deformation
def subtree(name):
    out, stack = set(), [arm.data.bones[name]]
    while stack:
        b = stack.pop(); out.add(b.name); stack.extend(b.children)
    return out


def deform(fn_vert, fn_bone):
    """fn_vert(ob, vi, co) -> new co (applied to the basis and to every shape key, so morphs stay aligned);
    fn_bone(name, co) -> new co for edit-bone heads/tails."""
    for ob in meshes:
        assert arm.matrix_world == arm.matrix_world.Identity(4)
        M = ob.matrix_world.copy(); Mi = M.inverted()          # meshes sit rotated 180 deg about Z
        me = ob.data
        blocks = me.shape_keys.key_blocks if me.shape_keys else []
        for vi, v in enumerate(me.vertices):
            v.co = Mi @ fn_vert(ob, vi, M @ v.co)
        for kb in blocks:
            for vi, d in enumerate(kb.data):
                d.co = Mi @ fn_vert(ob, vi, M @ d.co)
        me.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in arm.data.edit_bones:
        h, t, roll = fn_bone(eb.name, eb.head.copy(), 'head'), fn_bone(eb.name, eb.tail.copy(), 'tail'), eb.roll
        eb.head, eb.tail, eb.roll = h, t, roll
    bpy.ops.object.mode_set(mode='OBJECT')


def weight_of(ob, names):
    """Per-vertex share of the weight that belongs to bones in `names`."""
    idx = {g.index for g in ob.vertex_groups if g.name in names}
    out = []
    for v in ob.data.vertices:
        tot = sum(g.weight for g in v.groups) or 1.0
        out.append(sum(g.weight for g in v.groups if g.group in idx) / tot)
    return out


# ---------------------------------------------------------------- proportions
if 'proportions' in stages:
    head_bones = subtree(human['head'])
    pivot = arm.data.bones[human['head']].head_local.copy()
    s, d = P['head'], P['neck']
    up = Vector((0, 0, d))
    armL, armR = subtree(human['leftUpperArm']), subtree(human['rightUpperArm'])
    shL, shR = human['leftShoulder'], human['rightShoulder']
    # which side is +x: take it from the bone, not from a convention
    sgnL = 1 if arm.data.bones[human['leftUpperArm']].head_local.x > 0 else -1
    dxL, dxR = Vector((sgnL * P['shoulder'], 0, 0)), Vector((-sgnL * P['shoulder'], 0, 0))
    W = {ob.name: (weight_of(ob, head_bones), weight_of(ob, armL), weight_of(ob, armR),
                   weight_of(ob, {shL}), weight_of(ob, {shR})) for ob in meshes}

    def H(co): return pivot + (co - pivot) * s + up

    def fv(ob, vi, co):
        wh, wl, wr, wsl, wsr = (w[vi] for w in W[ob.name])
        co = co + (H(co) - co) * wh
        return co + dxL * (wl + 0.5 * wsl) + dxR * (wr + 0.5 * wsr)

    def fb(name, co, end):
        if name in head_bones: return H(co)
        if name == human['neck'] and end == 'tail': return co + up
        if name in armL: return co + dxL
        if name in armR: return co + dxR
        if name == shL and end == 'tail': return co + dxL
        if name == shR and end == 'tail': return co + dxR
        return co

    deform(fv, fb)
    log('proportions', f'head x{s}', f'neck +{d} m', f'shoulders +{P["shoulder"]} m/side')


# ---------------------------------------------------------------- face
def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


if 'face' in stages:
    # Landmarks from the (already re-proportioned) face, in armature space. Front is -Y here.
    fM = face.matrix_world
    def mat_verts(sub):
        ids = {i for i, m in enumerate(face.data.materials) if sub in m.name}
        vs = {v for p in face.data.polygons if p.material_index in ids for v in p.vertices}
        return [fM @ face.data.vertices[i].co for i in vs]
    eyes = []
    for side in (1, -1):
        v = [p for p in mat_verts('EyeWhite') if p.x * side > 0]
        c = sum(v, Vector()) / len(v)
        eyes.append((c, max(p.x for p in v) - min(p.x for p in v), max(p.z for p in v) - min(p.z for p in v)))
    skin = mat_verts('Face_00_SKIN')
    z_eye = eyes[0][0].z
    z_chin = min(p.z for p in skin if abs(p.x) < 0.006)
    z_piv = z_eye - 0.28 * (z_eye - z_chin)            # about the nose
    k, cheek, s_eye = P['jaw'], P['cheek'], P['eye']
    log('landmarks', f'eye z {z_eye:.4f}', f'chin z {z_chin:.4f}', f'pivot {z_piv:.4f}')

    def f_eye(ob, vi, p):                              # Face mesh only: smaller eyes, brows follow a little
        if ob is not face: return p
        for c, w, h in eyes:
            d = math.hypot((p.x - c.x) / (0.75 * w), (p.z - c.z) / (0.8 * h))
            a = (1 - s_eye) * (1 - smooth(1.0, 1.9, d))
            if a > 0:
                p = Vector((p.x - (p.x - c.x) * a, p.y, p.z - (p.z - c.z) * a))
        return p

    def f_jaw(ob, vi, p):                              # every mesh, by position: seams move together
        front = smooth(0.03, -0.04, p.y)
        if front <= 0 or p.z > z_piv or abs(p.x) > 0.16: return p
        below = max(z_chin - p.z, 0.0)
        fade = 1 - smooth(0.0, 0.03, below)            # gone 3 cm under the chin
        zz = max(p.z, z_chin)
        dz = -k * (z_piv - zz) * front * fade
        # lower cheeks in: nothing at the pivot, most between mouth and jaw
        t = smooth(z_piv, z_piv - 0.6 * (z_piv - z_chin), zz)
        sx = 1 - cheek * t * smooth(0.04, -0.02, p.y) * fade
        return Vector((p.x * sx, p.y, p.z + dz))

    deform(f_eye, lambda n, co, e: co)
    deform(f_jaw, lambda n, co, e: co)
    log('face', f'eyes x{s_eye}', f'lower face +{k:.0%}', f'lower cheeks -{cheek:.0%}')


# ---------------------------------------------------------------- export
bpy.context.view_layer.objects.active = arm
log('tris after', tri_count())
log('export', bpy.ops.export_scene.vrm(filepath=dst, armature_object_name=arm.name))
