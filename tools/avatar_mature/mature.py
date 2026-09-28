# Blender headless: mature a VRoid VRM 0.x in place.
# blender --background --python mature.py -- <char> <in.vrm> <out.vrm> <tops.png> <islands.json> [stages]
# stages: comma list of wardrobe,proportions,face (default all)
import bpy, bmesh, sys, json, math, os
import numpy as np
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
        if not os.environ.get('CYBER'):
            clip = [i for i, m in enumerate(hair.data.materials) if m.name.endswith('HAIR_02')]
            log('removed hair clip faces', delete_faces(hair, lambda f: f.material_index in clip))   # the cyan X clip
    img = next(n.image for m in mats if 'Tops' in m.name for n in m.node_tree.nodes
               if n.type == 'TEX_IMAGE' and n.image and 'Tops' in n.image.name)
    if os.environ.get('CYBER'): tops_png = os.path.join(os.environ['CYBER'], 'tops_cyber.png')
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


# ---------------------------------------------------------------- identity: our colours and face art
PALETTE = {  # sRGB hex; MToon factors are linear
    'mira': dict(hair='#C8665A', hair_shade='#7A3E5C', brow='#5A2A2E', line='#3A1E22'),
    'kai':  dict(hair='#5E6B80', hair_shade='#34304A', brow='#2E3440', line='#262A33'),
}[char]


def lin(h):
    return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)]


def replace_pixels(img, path):
    new = bpy.data.images.load(path)
    assert tuple(new.size) == tuple(img.size), (img.name, tuple(new.size), tuple(img.size))
    img.pixels.foreach_set(new.pixels[:]); img.update(); img.pack()
    bpy.data.images.remove(new)


if 'identity' in stages:
    import os, glob
    art = os.environ['ART']
    for p in sorted(glob.glob(f'{art}/*.png')):
        name = os.path.basename(p)[3:-4]                 # "09_F00_000_EyeIris_00.png" -> image name
        replace_pixels(bpy.data.images[name], p)
        log('art', name)
    for m in (bpy.data.materials if not os.environ.get('KEEP_COLOURS') else []):   # KEEP_COLOURS: face art only
        if 'Outline' in m.name: continue
        t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
        if '_HAIR' in m.name and not ('HAIR_02' in m.name and char == 'mira'):
            t.pbr_metallic_roughness.base_color_factor = lin(PALETTE['hair']) + [1.0]
            x.shade_color_factor = lin(PALETTE['hair_shade'])
            t.emissive_factor = [c * 0.10 for c in lin(PALETTE['hair'])]
        elif 'FaceBrow' in m.name:
            t.pbr_metallic_roughness.base_color_factor = lin(PALETTE['brow']) + [1.0]
            x.shade_color_factor = lin(PALETTE['brow'])
        elif 'FaceEyelash' in m.name or 'FaceEyeline' in m.name:
            t.pbr_metallic_roughness.base_color_factor = lin(PALETTE['line']) + [1.0]
            x.shade_color_factor = lin(PALETTE['line'])
        else:
            continue
        log('colour', m.name)


# ---------------------------------------------------------------- cyber demo (Mira): colour lives in the textures
if os.environ.get('CYBER') and 'identity' in stages:
    cy = os.environ['CYBER']
    def img_from(path, like=None):
        im = bpy.data.images.load(path); im.pack(); return im
    for m in bpy.data.materials:
        if 'Outline' in m.name: continue
        t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
        if m.name.endswith('HAIR_01'):
            replace_pixels(t.pbr_metallic_roughness.base_color_texture.index.source, f'{cy}/hair_cyber.png')
            replace_pixels(t.emissive_texture.index.source, f'{cy}/hair_cyber_emis.png')
            t.pbr_metallic_roughness.base_color_factor = [1.0, 1.0, 1.0, 1.0]
            x.shade_color_factor = [0.42, 0.34, 0.62]
            t.emissive_factor = [0.5, 0.5, 0.5]
        elif 'HairBack' in m.name:
            bimg = t.pbr_metallic_roughness.base_color_texture.index.source
            root = [(int(h, 16) / 255) for h in ('2a', '18', '40')]
            a = np.array(bimg.pixels[:], np.float32).reshape(bimg.size[1], bimg.size[0], 4); a[..., :3] = root
            bimg.pixels.foreach_set(a.ravel()); bimg.update(); bimg.pack()
            t.pbr_metallic_roughness.base_color_factor = [1.0, 1.0, 1.0, 1.0]
            x.shade_color_factor = [0.5, 0.45, 0.7]; t.emissive_factor = [0.0, 0.0, 0.0]
        elif m.name.endswith('HAIR_02'):                                   # the X clip: neon cyan
            t.pbr_metallic_roughness.base_color_factor = lin('#3fe6e0') + [1.0]
            x.shade_color_factor = lin('#1f8f8c'); t.emissive_factor = [c * 1.6 for c in lin('#3fe6e0')]
        elif 'Tops' in m.name:
            t.emissive_texture.index.source = img_from(f'{cy}/tops_cyber_emis.png')
            t.emissive_factor = [1.0, 1.0, 1.0]
        else:
            continue
        log('cyber', m.name)


# ---------------------------------------------------------------- modular eyes (Mira first)
# Her iris is split into base / glow / pupil layers (eye_layers.py) stacked on duplicated iris geometry;
# sizes are shape keys scaled about each eye's own centre, colours are material binds, and both live in
# eye-only expressions (eye_happy, eye_angry, ...) that vrm.js drives from the emotion engine.
EYE_EMO = {  # directions from the audited research; sizes are judgement (exaggerated so they read on a phone)
    'eye_happy':     dict(keys={'EYE_PupilDilate': 0.35, 'EYE_HighlightGrow': 0.8, 'EYE_IrisGrow': 0.6},
                          mats={'hl': ('_EmissionColor', (0.5, 0.5, 0.5, 1)), 'glow': ('_EmissionColor', (0.30, 0.19, 0.07, 1))}),
    'eye_sad':       dict(keys={'EYE_PupilDilate': 0.2, 'EYE_HighlightGrow': 0.4},
                          mats={'white': ('_Color', (1.0, 0.88, 0.88, 1)), 'glow': ('_Color', (0.60, 0.60, 0.75, 1)),
                                'hl': ('_EmissionColor', (0.35, 0.38, 0.45, 1))}),
    'eye_angry':     dict(keys={'EYE_PupilConstrict': 0.25},
                          mats={'white': ('_Color', (1.0, 0.78, 0.78, 1)), 'glow': ('_Color', (0.45, 0.10, 0.08, 1)),
                                'hl': ('_Color', (1, 1, 1, 0.45))}),
    'eye_surprised': dict(keys={'EYE_PupilDilate': 0.4, 'EYE_HighlightGrow': 0.5}, mats={}),
    'eye_curious':   dict(keys={'EYE_PupilDilate': 0.3}, mats={'hl': ('_EmissionColor', (0.3, 0.3, 0.3, 1))}),
    'eye_tender':    dict(keys={'EYE_PupilDilate': 0.3, 'EYE_IrisGrow': 0.3},
                          mats={'glow': ('_EmissionColor', (0.20, 0.11, 0.04, 1))}),
}

if 'eyes' in stages:
    layers = json.load(open(os.path.join(os.environ['EYES'], 'eye_layers.json')))
    fme = face.data
    mid = {k: next(i for i, m in enumerate(fme.materials) if sub in m.name)
           for k, sub in (('iris', 'EyeIris'), ('hl', 'EyeHighlight'), ('white', 'EyeWhite'))}
    iris_mat, hl_mat, white_mat = fme.materials[mid['iris']], fme.materials[mid['hl']], fme.materials[mid['white']]
    # 1. layer materials: copies of the iris material with their own textures, drawn before the highlight
    def layer_mat(name, png, rqo):
        m = iris_mat.copy(); m.name = f'{iris_mat.name}_{name}'
        t = m.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
        im = bpy.data.images.load(os.path.join(os.environ['EYES'], png)); im.name = f'{name}_{char}'; im.pack()
        t.pbr_metallic_roughness.base_color_texture.index.source = im
        x.shade_multiply_texture.index.source = im
        t.alpha_mode = 'BLEND'; x.render_queue_offset_number = rqo; x.transparent_with_z_write = False
        fme.materials.append(m); return m, len(fme.materials) - 1
    replace_pixels(iris_mat.vrm_addon_extension.mtoon1.pbr_metallic_roughness.base_color_texture.index.source,
                   os.path.join(os.environ['EYES'], 'iris_base.png'))
    glow_mat, gi = layer_mat('IrisGlow', 'iris_glow.png', -3)
    pupil_mat, pi = layer_mat('Pupil', 'iris_pupil.png', -2)
    # 2. duplicate the iris faces twice, nudged toward the camera (local +Y), in every shape-key layer
    bm = bmesh.new(); bm.from_mesh(fme); bm.faces.ensure_lookup_table()
    iris_faces = [f for f in bm.faces if f.material_index == mid['iris']]
    skl = bm.verts.layers.shape
    uvl = bm.loops.layers.uv.active
    def uv_to_local(u, v):
        for f in iris_faces:
            ls = f.loops
            for k in range(1, len(ls) - 1):
                a, b, c = ls[0], ls[k], ls[k + 1]
                (x1, y1), (x2, y2), (x3, y3) = a[uvl].uv, b[uvl].uv, c[uvl].uv
                d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
                if abs(d) < 1e-12: continue
                l1 = ((y2 - y3) * (u - x3) + (x3 - x2) * (v - y3)) / d; l2 = ((y3 - y1) * (u - x3) + (x1 - x3) * (v - y3)) / d
                l3 = 1 - l1 - l2
                if min(l1, l2, l3) >= -1e-6: return a.vert.co * l1 + b.vert.co * l2 + c.vert.co * l3
        raise ValueError('uv not on iris')
    piv = {s: dict(iris=uv_to_local(*layers[s]['iris_c']), pupil=uv_to_local(*layers[s]['pupil_c'])) for s in ('left', 'right')}
    new_sets = {}
    for tag, mi, dy in (('glow', gi, 0.00012), ('pupil', pi, 0.00024)):
        ret = bmesh.ops.duplicate(bm, geom=iris_faces)
        fs = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
        vs = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        for f in fs: f.material_index = mi
        for v in vs:
            v.co.y += dy
            for lay in skl.values(): v[lay].y += dy
        new_sets[tag] = vs
    bm.verts.index_update()
    new_idx = {k: [v.index for v in vs] for k, vs in new_sets.items()}
    iris_idx = sorted({v.index for f in iris_faces for v in f.verts})
    hl_idx = sorted({v.index for f in bm.faces if f.material_index == mid['hl'] for v in f.verts})
    bm.to_mesh(fme); bm.free(); fme.update()
    # 3. shape keys: scale in the eye plane (local x, z) about each eye's own pivot
    B = [v.co.copy() for v in fme.vertices]
    def side_of(i, ref): return min(piv, key=lambda s: (B[i] - piv[s][ref]).length)
    def add_key(name, idx, s, ref):
        kb = face.shape_key_add(name=name, from_mix=False)
        for i in idx:
            p0 = piv[side_of(i, ref)][ref] if ref != 'hl' else hl_c[0 if B[i].x > 0 else 1]
            d = B[i] - p0
            kb.data[i].co = Vector((p0.x + d.x * s, B[i].y, p0.z + d.z * s))
    hlp = [B[i] for i in hl_idx]
    hl_c = [sum((p for p in hlp if p.x > 0), Vector()) / max(1, sum(1 for p in hlp if p.x > 0)),
            sum((p for p in hlp if p.x <= 0), Vector()) / max(1, sum(1 for p in hlp if p.x <= 0))]
    add_key('EYE_PupilDilate', new_idx['pupil'], 1.45, 'pupil')
    add_key('EYE_PupilConstrict', new_idx['pupil'], 0.62, 'pupil')
    add_key('EYE_IrisGrow', iris_idx + new_idx['glow'] + new_idx['pupil'], 1.07, 'iris')
    add_key('EYE_HighlightGrow', hl_idx, 1.35, 'hl')
    # 4. eye expressions: shape-key binds + material binds
    bsm = ext.vrm0.blend_shape_master
    matmap = {'hl': hl_mat, 'glow': glow_mat, 'white': white_mat, 'pupil': pupil_mat}
    for gname, spec in EYE_EMO.items():
        g = bsm.blend_shape_groups.add(); g.name = gname; g.preset_name = 'unknown'
        for key, w in spec['keys'].items():
            b = g.binds.add(); b.mesh.mesh_object_name = face.name; b.index = key; b.weight = w
        for mk, (prop, val) in spec['mats'].items():
            mv = g.material_values.add(); mv.material = matmap[mk]; mv.property_name = prop
            for c in val: mv.target_value.add().value = c
    log('eyes', f'layers glow/pupil +{len(new_idx["glow"]) + len(new_idx["pupil"])} verts',
        f'{len(EYE_EMO)} eye expressions', 'pivots mm', {s: tuple(round(x * 1000, 1) for x in piv[s]['pupil']) for s in piv})


# ---------------------------------------------------------------- hair: our own, replacing VRoid's
if 'hair' in stages:
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import hairgen
    # 1. old hair out: mesh, its HairJoint bones and their spring groups
    bpy.data.objects.remove(hair)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    sa = ext.vrm0.secondary_animation
    for i in reversed(range(len(sa.bone_groups))):
        if any(b.bone_name.startswith('HairJoint') for b in sa.bone_groups[i].bones):
            sa.bone_groups.remove(i)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    dead = [eb for eb in arm.data.edit_bones if eb.name.startswith('HairJoint')]
    for eb in dead: arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('old hair removed', f'{len(dead)} bones', f'{len(sa.bone_groups)} spring groups left')

    # 2. landmarks
    fM = face.matrix_world
    def zs(sub):
        ids = {i for i, m in enumerate(face.data.materials) if sub in m.name}
        return [(fM @ face.data.vertices[v].co) for p in face.data.polygons if p.material_index in ids for v in p.vertices]
    bM = body.matrix_world
    capi = {i for i, m in enumerate(body.data.materials) if 'HairBack' in m.name}
    capv = [bM @ body.data.vertices[v].co for p in body.data.polygons if p.material_index in capi for v in p.vertices]
    C = sum(capv, Vector()) / len(capv)
    skin = zs('Face_00_SKIN')
    L = dict(C=C, brow_z=sum(p.z for p in zs('FaceBrow')) / len(zs('FaceBrow')),
             chin_z=min(p.z for p in skin if abs(p.x) < 0.006))
    log('hair landmarks', tuple(round(x, 3) for x in C), 'brow', round(L['brow_z'], 3), 'chin', round(L['chin_z'], 3))

    # 3. grow
    hmat = next(m for m in bpy.data.materials if m.name.endswith('HAIR_01') and 'Outline' not in m.name)
    newhair, kinds, tris, strands = hairgen.build(char, arm, human['head'], [face, body], 'HairBack', hmat, L,
                                         n_strands={'mira': 330, 'kai': 380}[char], seed={'mira': 5, 'kai': 9}[char])
    meshes.append(newhair)
    log('hair grown', kinds, f'{tris} tris')
    nch, nb = hairgen.rig(char, arm, human['head'], newhair, strands, C, sa,
                          {human['neck'], human.get('upperChest', human['chest'])})   # not the head: chains start inside it
    log('hair rigged', f'{nch} spring chains', f'{nb} bones')

    # 4. our hair textures; flat normals; the cap takes a plain hair value
    t = hmat.vrm_addon_extension.mtoon1; x = t.extensions.vrmc_materials_mtoon
    base_img = t.pbr_metallic_roughness.base_color_texture.index.source
    base, ring = hairgen.hair_textures(*base_img.size)
    base_img.pixels.foreach_set(np.flipud(base).astype(np.float32).ravel()); base_img.update(); base_img.pack()
    em = t.emissive_texture.index.source
    if em is not None and tuple(em.size) == tuple(base_img.size):
        em.pixels.foreach_set(np.flipud(ring).astype(np.float32).ravel()); em.update(); em.pack()
    t.emissive_factor = [c * 0.45 for c in lin(PALETTE['hair'])]
    for m in bpy.data.materials:
        if '_HAIR' not in m.name or 'Outline' in m.name: continue
        mt = m.vrm_addon_extension.mtoon1
        nimg = mt.normal_texture.index.source
        if nimg is not None:
            flat = np.zeros((nimg.size[1], nimg.size[0], 4), np.float32); flat[...] = (0.5, 0.5, 1.0, 1.0)
            nimg.pixels.foreach_set(flat.ravel()); nimg.update(); nimg.pack()
        if 'HairBack' in m.name:
            bimg = mt.pbr_metallic_roughness.base_color_texture.index.source
            a = np.array(bimg.pixels[:], np.float32).reshape(bimg.size[1], bimg.size[0], 4)
            a[..., :3] = 0.68                    # the under-cap sits just below the hair's own value
            bimg.pixels.foreach_set(a.ravel()); bimg.update(); bimg.pack()
        m.use_backface_culling = False
        if hasattr(mt, 'double_sided'): mt.double_sided = True
    log('hair textures ours')


# ---------------------------------------------------------------- export
bpy.context.view_layer.objects.active = arm
log('tris after', tri_count())
log('export', bpy.ops.export_scene.vrm(filepath=dst, armature_object_name=arm.name))
