# hairgen.py: our own procedural hair for Mira and Kai (imported by mature.py, runs inside Blender).
# Strands grow from roots on the scalp cap, follow the head surface at a small offset, fall under a
# style-specific flow, and become tapered V-profile ribbons with root->tip UVs. Nothing is copied:
# geometry, UVs and textures all come from this file.
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def head_bvh(objs, cap_mat_sub, z_min=-1e9):
    """BVH over the given meshes in armature space, head only (polygons above z_min: strands
    must not slide along neck and shoulders); tags[i] is True for cap (scalp) polygons."""
    verts, polys, tags = [], [], []
    for ob in objs:
        M = ob.matrix_world; base = len(verts)
        verts += [M @ v.co for v in ob.data.vertices]
        for p in ob.data.polygons:
            if max(verts[base + i].z for i in p.vertices) < z_min: continue
            polys.append([base + i for i in p.vertices])
            tags.append(cap_mat_sub in ob.data.materials[p.material_index].name)
    return BVHTree.FromPolygons(verts, polys), tags


def fib_dirs(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n); th = math.pi * (1 + 5 ** 0.5) * i
    return [Vector((math.cos(t) * math.sin(p), math.sin(t) * math.sin(p), math.cos(p))) for p, t in zip(phi, th)]


class Grower:
    def __init__(self, bvh, C):
        self.bvh, self.C = bvh, C

    def push_out(self, p, off):
        q, n, _, _ = self.bvh.find_nearest(p)
        if q is None: return p, (p - self.C).normalized()
        if n.dot(p - self.C) < 0: n = -n
        s = (p - q).dot(n)
        if s < off: p = p + n * (off - s)
        return p, n

    def grow(self, root, n_root, t0, length, off, flow, step=0.006, z_stop=None):
        """flow(p, t, frac) -> desired direction; returns the polyline."""
        p = root + n_root * off; t = t0.normalized(); pts = [p.copy()]; s = 0.0
        while s < length and (z_stop is None or p.z > z_stop):
            frac = s / length
            d = (t * 0.55 + flow(p, t, frac) * 0.45).normalized()
            p2, n = self.push_out(p + d * step, off + 0.002 * frac)
            t = (p2 - p).normalized(); p = p2; s += step; pts.append(p.copy())
        return pts


def resample(pts, n):
    P = np.array([tuple(p) for p in pts]); seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    c = np.concatenate([[0], np.cumsum(seg)]); u = np.linspace(0, c[-1], n + 1)
    return [Vector(tuple(np.interp(x, c, P[:, k]) for k in range(3))) for x in u]


def ribbon(bm, uvl, pts, width, ridge, C, u0, du, tip_pow=0.8, tip_min=0.04):
    """V-profile ribbon (3 verts per ring): edges and an outward ridge. Returns created verts."""
    rings, n = [], len(pts) - 1
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n)] - pts[max(i - 1, 0)]).normalized()
        out = (p - C); out = (out - t * out.dot(t)).normalized()
        b = t.cross(out).normalized()
        f = i / n; w = width * (1 - f) ** tip_pow * (0.85 + 0.15 * math.sin(math.pi * min(f * 3, 1)))
        w = max(w, width * tip_min)
        rings.append([bm.verts.new(p - b * w / 2), bm.verts.new(p + out * ridge * (1 - f) + b * 0.0), bm.verts.new(p + b * w / 2)])
    for i in range(n):
        for j in range(2):
            a, b_, c, d = rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]
            f = bm.faces.new((a, b_, c, d))
            for loop, (uu, vv) in zip(f.loops, [(j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1)]):
                loop[uvl].uv = (u0 + du * uu / 2, 1 - vv / n)
    return rings


# ---------------------------------------------------------------- styles
def style_mira(g, roots, L):
    """Chin-length soft bob, side part on her left, side-swept bangs, a small outward flip."""
    C, part_x = L['C'], L['C'].x + 0.022
    out = []
    for r, n in roots:
        rel = r - C
        front = r.y < C.y - 0.045 and r.z > L['brow_z'] + 0.02          # hairline at the forehead
        side = 1 if r.x > part_x else -1
        if front and -0.05 < r.x - part_x < 0.03:
            # bangs: a heavy sweep across the forehead away from the part, tips above the brow
            t0 = Vector((-1.0, -0.55, -0.15))
            ln = random.uniform(0.07, 0.095)
            def flow(p, t, f): return Vector((-1.0, -0.2, -0.55 - 0.6 * f)).normalized()
            out.append((r, n, t0, ln, 0.006, flow, random.uniform(0.030, 0.036), 'bang', None))
            continue
        z_end = L['chin_z'] + 0.008 + random.uniform(-0.008, 0.008)       # at the jaw: clear of the shoulders
        ln = 0.35                                                      # budget; the bob line stops it
        facing = rel.y < -0.02                                           # front half: clear the face first
        t0 = Vector((side * 1.0, -0.1 if facing else 0.3, -0.3)).normalized()
        def flow(p, t, f, side=side, facing=facing):
            radial = Vector((p.x - C.x, p.y - C.y, 0)).normalized()
            d = Vector((0, 0, -1)) + radial * 0.08
            if facing and abs(p.x - C.x) < 0.075: d = d + Vector((side * 1.2, 0, 0))
            if f > 0.85: d = d + radial * 0.9 * (f - 0.85) / 0.15
            return d.normalized()
        out.append((r, n, t0, ln, random.uniform(0.004, 0.009), flow, random.uniform(0.032, 0.040), 'lock', z_end))
    return out


def style_kai(g, roots, L):
    """Short textured cut, side part on his right, a short fringe swept to his left."""
    C, part_x = L['C'], L['C'].x - 0.025
    out = []
    for r, n in roots:
        rel = r - C
        side = 1 if r.x > part_x else -1
        front = r.y < C.y - 0.04 and r.z > L['brow_z'] + 0.02
        top = r.z > C.z + 0.035
        if front:
            t0 = Vector((0.55, -0.8, -0.15))
            ln = random.uniform(0.05, 0.068)
            def flow(p, t, f): return Vector((0.4, -0.35, -0.85)).normalized()
            out.append((r, n, t0, ln, 0.006, flow, random.uniform(0.022, 0.027), 'fringe', None))
        elif top and rel.y > 0.005:                                      # crown: lie back over the whorl
            t0 = Vector((side * 0.3, 1.0, 0.05)).normalized()
            ln = random.uniform(0.06, 0.08)
            def flow(p, t, f, side=side): return Vector((side * 0.2, 0.6, -1.0)).normalized()
            out.append((r, n, t0, ln, random.uniform(0.005, 0.009), flow, random.uniform(0.022, 0.028), 'top', None))
        elif top:
            t0 = Vector((side * 0.9, 0.35, 0.1)).normalized()
            ln = random.uniform(0.055, 0.075)
            def flow(p, t, f, side=side): return Vector((side * 0.5, 0.25, -1.0)).normalized()
            out.append((r, n, t0, ln, random.uniform(0.005, 0.009), flow, random.uniform(0.022, 0.028), 'top', None))
        else:
            t0 = Vector((rel.x * 0.4, 0.3 if rel.y > 0 else -0.2, -1)).normalized()
            ln = random.uniform(0.035, 0.05)
            def flow(p, t, f): return Vector((0, 0.1, -1)).normalized()
            out.append((r, n, t0, ln, random.uniform(0.003, 0.006), flow, random.uniform(0.018, 0.023), 'short', None))
    return out


def build(char, arm, head_bone, meshes, cap_sub, hair_mat, L, n_strands, seed):
    random.seed(seed)
    bvh, tags = head_bvh(meshes, cap_sub, z_min=L['chin_z'] + 0.01)
    C = L['C']; g = Grower(bvh, C)
    roots = []
    for d in fib_dirs(4000):
        if d.z < -0.35: continue
        o = C + d * 0.4
        loc, nrm, idx, _ = bvh.ray_cast(o, -d)
        if loc is None or not tags[idx]: continue
        if nrm.dot(d) < 0: nrm = -nrm
        roots.append((loc, nrm))
    random.shuffle(roots); roots = roots[:n_strands]
    plan = (style_mira if char == 'mira' else style_kai)(g, roots, L)
    me = bpy.data.meshes.new(f'{char}_hair'); ob = bpy.data.objects.new(f'{char.capitalize()}Hair', me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    kinds, strands = {}, []
    zs = [r.z for r, *_ in plan]; z0, z1 = min(zs), max(zs)
    for r, n, t0, ln, off, flow, w, kind, z_stop in plan:
        # shingles: the higher the root, the further out it lies, so upper strands always cover lower ones
        h = (r.z - z0) / max(z1 - z0, 1e-6)
        off = 0.003 + 0.009 * h + (0.004 if kind in ('bang', 'fringe') else 0.0) + random.uniform(0, 0.0006)
        pts = resample(g.grow(r, n, t0, ln, off, flow, z_stop=z_stop), 9)
        blunt = char == 'mira' and kind == 'lock'                         # a bob ends soft, not in points
        rings = ribbon(bm, uvl, pts, w, w * 0.08, C, random.uniform(0, 0.7), 0.3,
                       tip_pow=0.45 if blunt else 0.8, tip_min=0.35 if blunt else 0.04)
        strands.append(dict(kind=kind, pts=pts, rings=rings, root=r))
        kinds[kind] = kinds.get(kind, 0) + 1
    bm.verts.index_update()
    for st in strands: st['vids'] = [[v.index for v in ring] for ring in st['rings']]; del st['rings']
    bm.to_mesh(me); bm.free()
    me.materials.append(hair_mat)
    ob.parent = arm; ob.matrix_world = arm.matrix_world.copy()
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    return ob, kinds, len(me.polygons) * 2, strands


def rig(char, arm, head_bone, ob, strands, C, sa, collider_bones):
    """Spring chains per azimuth sector; strand vertices blend from the head into their sector's chain."""
    # Bangs/fringe stay pinned (nothing swings across the face); Kai's short cut needs no springs.
    cfg = {'mira': dict(sectors=12, bones=3, pin=0.35, kinds=('lock',), stiff=0.6, drag=0.45, grav=0.06, r=0.015),
           'kai':  dict(sectors=8, bones=2, pin=0.40, kinds=(), stiff=0.85, drag=0.55, grav=0.02, r=0.012)}[char]
    ang = lambda p: math.atan2(p.x - C.x, -(p.y - C.y))            # 0 = front
    sec = lambda p: int(((ang(p) + math.pi) / (2 * math.pi)) * cfg['sectors']) % cfg['sectors']
    moving = [st for st in strands if st['kind'] in cfg['kinds']]
    groups = {}
    for st in moving: groups.setdefault(sec(st['root']), []).append(st)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    head = arm.data.edit_bones[head_bone]; chains = {}
    for k, sts in groups.items():
        L = min(len(st['pts']) for st in sts)
        mean = [sum((st['pts'][i] for st in sts), Vector()) / len(sts) for i in range(L)]
        i0 = int(cfg['pin'] * (L - 1)); idx = np.linspace(i0, L - 1, cfg['bones'] + 1).round().astype(int)
        parent, names = head, []
        for b in range(cfg['bones']):
            eb = arm.data.edit_bones.new(f'Hair_{char}_{k:02d}_{b}')
            eb.head, eb.tail = mean[idx[b]], mean[idx[b + 1]]
            if (eb.tail - eb.head).length < 0.004: eb.tail = eb.head + Vector((0, 0, -0.004))
            eb.parent = parent; eb.use_connect = b > 0; parent = eb; names.append(eb.name)
        chains[k] = names
    bpy.ops.object.mode_set(mode='OBJECT')
    vg_head = ob.vertex_groups.new(name=head_bone)
    vgs = {n: ob.vertex_groups.new(name=n) for names in chains.values() for n in names}
    for st in strands:
        names = chains.get(sec(st['root'])) if st['kind'] in cfg['kinds'] else None
        n = len(st['vids']) - 1
        for i, ring in enumerate(st['vids']):
            f = i / n
            if not names or f <= cfg['pin']:
                vg_head.add(ring, 1.0, 'REPLACE'); continue
            x = (f - cfg['pin']) / (1 - cfg['pin']) * len(names)       # position along the chain, in bones
            b0 = min(int(x), len(names) - 1); t = min(x - b0, 1.0)
            if b0 == 0:
                blend = min(1.0, x * 2)                                  # ease out of the head
                vg_head.add(ring, 1 - blend, 'REPLACE'); vgs[names[0]].add(ring, blend, 'REPLACE')
            else:
                vgs[names[b0 - 1]].add(ring, 1 - t, 'REPLACE'); vgs[names[b0]].add(ring, t, 'REPLACE')
    cgs = [cg for cg in sa.collider_groups if cg.node.bone_name in collider_bones]
    for k, names in chains.items():
        grp = sa.bone_groups.add(); grp.comment = f'hair_{char}_{k:02d}'
        grp.bones.add().bone_name = names[0]
        grp.stiffiness, grp.drag_force, grp.gravity_power, grp.hit_radius = cfg['stiff'], cfg['drag'], cfg['grav'], cfg['r']
        grp.gravity_dir = (0.0, 0.0, -1.0)            # Blender down; exports as glTF (0, -1, 0)
        for cg in cgs: grp.collider_groups.add().collider_group_uuid = cg.uuid
    return len(chains), sum(len(v) for v in chains.values())


def hair_textures(W=512, H=1024, seed=3):
    """Base (value only; colour comes from the MToon factors) and an angel-ring emissive band."""
    rng = np.random.default_rng(seed)
    u = np.linspace(0, 1, W)[None, :]; v = np.linspace(0, 1, H)[:, None]    # v=0 top row = root
    strands = np.zeros(W)
    for k, a in [(90, 0.05), (220, 0.035), (500, 0.02)]:
        strands += a * np.sin(u[0] * k * 2 * np.pi + rng.uniform(0, 6.28))
    strands += 0.04 * np.convolve(rng.standard_normal(W), np.ones(5) / 5, 'same')
    base = 0.78 + strands[None, :] - 0.04 * np.exp(-v / 0.05) + 0.06 * v       # barely darker at the root (overlaps must not hatch)
    base = np.clip(base, 0, 1)
    band_c = 0.22 + 0.015 * np.sin(u * 2 * np.pi * 3)
    ring = 0.35 + 0.0 * band_c + 0.0 * v                      # an even lift; a banded ring shingled per strand
    rgba = lambda x: np.dstack([x, x, x, np.ones_like(x)])
    return rgba(np.repeat(base, 1, 0) * np.ones((H, W))), rgba(ring * np.ones((H, W)))
