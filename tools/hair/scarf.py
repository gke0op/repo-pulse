# scarf.py: Mira's wish — a vibrant blue knitted scarf, built for her own neck, exported as a wardrobe accessory pack.
#   blender --background --python scarf.py -- <character.vrm> <out.glb> <texture.png>
# A soft rolled wrap around the neck (sitting over any collar), a knot at her left front, two tails hanging down.
# Skinned: wrap to neck/upper chest by height, tails to upper chest -> chest down their length.
import bpy, bmesh, sys, math
import numpy as np
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]; char_p, out_p, tex_p = a[:3]

[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
bpy.ops.import_scene.vrm(filepath=char_p)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
hb = {b.bone: b.node.bone_name for b in arm.data.vrm_addon_extension.vrm0.humanoid.human_bones if b.node.bone_name}
NECK, UCH, CH = hb['neck'], hb.get('upperChest', hb['chest']), hb['chest']
W = arm.matrix_world
neck = W @ arm.data.bones[NECK].head_local; head = W @ arm.data.bones[hb['head']].head_local
uch = W @ arm.data.bones[UCH].head_local

# neck size from the head-skin/outfit geometry around the neck base
pts = []
for o in bpy.data.objects:
    if o.type == 'MESH' and (o.name.startswith('Outfit_O') or o.name.startswith('Body')):
        M = o.matrix_world
        for v in o.data.vertices:
            p = M @ v.co
            if abs(p.z - (neck.z + 0.01)) < 0.012 and (p - neck).length < 0.12: pts.append(p)
r_neck = float(np.median([math.hypot(p.x - neck.x, p.y - neck.y) for p in pts])) if pts else 0.05
cx, cy = neck.x, float(np.mean([p.y for p in pts])) if pts else neck.y
print('SCARF neck r', round(r_neck, 4), 'at', tuple(round(x, 3) for x in neck), 'pts', len(pts))

R = r_neck + 0.030          # loose: sits over collars and turtlenecks
TUBE = 0.022                # rolled, cosy thickness
Z0 = neck.z - 0.006         # wrap height at the back
DROP = 0.030                # dips at the front
bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
verts_w = {}                # vertex -> [(bone, weight)]


def ring_point(t, s, R=R, T=TUBE):
    """t around the neck (0 = front, CCW seen from above), s around the tube."""
    ang = t * 2 * math.pi
    fx, fy = math.sin(ang), -math.cos(ang)                  # front is -Y
    front = 0.5 + 0.5 * math.cos(ang)
    z = Z0 - DROP * front
    rr = R + T * math.cos(s * 2 * math.pi) * 0.9
    return Vector((cx + fx * rr, cy + fy * rr * 1.08, z + T * math.sin(s * 2 * math.pi) * 1.25))


def grid(fn, nu, nv, u_rep, v_rep, closed_u, closed_v, weight_fn):
    V = [[None] * (nv + (0 if closed_v else 1)) for _ in range(nu + (0 if closed_u else 1))]
    for i in range(len(V)):
        for j in range(len(V[0])):
            p = fn(i / nu, j / nv); v = bm.verts.new(p); V[i][j] = v; verts_w[v] = weight_fn(p, i / nu, j / nv)
    for i in range(nu):
        for j in range(nv):
            i1 = (i + 1) % len(V) if closed_u else i + 1; j1 = (j + 1) % len(V[0]) if closed_v else j + 1
            f = bm.faces.new((V[i][j], V[i1][j], V[i1][j1], V[i][j1]))
            for l, (uu, vv) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                l[uvl].uv = (uu / nu * u_rep, vv / nv * v_rep)
    return V


def neck_weights(p, *_):
    t = max(0.0, min(1.0, (p.z - (uch.z + 0.02)) / max(neck.z - uch.z, 0.02)))
    return [(NECK, 0.35 + 0.45 * t), (UCH, 0.65 - 0.45 * t)]


# the wrap: two turns, the second slightly lower and looser (reads as a real wound scarf)
grid(lambda u, s: ring_point(u, s), 48, 10, 0.5, 0.25, True, True, neck_weights)       # u maps to texture rows
grid(lambda u, s: ring_point(u, s, R=R + 0.012, T=TUBE * 0.95) - Vector((0, 0, 0.030)), 48, 10, 0.5, 0.25, True, True, neck_weights)

# body surface in front, for draping the tails (ray cast from the front toward the body)
from mathutils.bvhtree import BVHTree
sv, sp = [], []
for o in bpy.data.objects:
    if o.type == 'MESH' and (o.name.startswith('Outfit_O') or o.name.startswith('Body')):
        M = o.matrix_world; base = len(sv); sv += [M @ v.co for v in o.data.vertices]
        sp += [[base + i for i in p.vertices] for p in o.data.polygons]
body_bvh = BVHTree.FromPolygons(sv, sp)
CLEAR = 0.024                                   # over her chest and over bulkier jackets
def front_y(x, z, fallback):
    hit = body_bvh.ray_cast(Vector((x, -0.6, z)), Vector((0, 1, 0)))
    return (hit[0].y - CLEAR) if hit[0] is not None else fallback

# knot + two tails from her left front
kx = cx + R * 0.50; ky = cy - R * 1.02; kz = Z0 - DROP - 0.030
def tail(side_off, length, swing):
    def fn(u, s):
        # u: along the tail (0 at the knot), s: across (0..1); a flat, slightly cupped strip that falls and flares
        down = u * length
        z_of = lambda uu: kz - uu * length
        x = kx + side_off + swing * u * u + (s - 0.5) * (0.066 + 0.020 * u)
        y = min(ky - 0.016, front_y(x, z_of(u), ky)) - 0.008 * math.sin(math.pi * s)   # drapes over the chest
        z = kz - down
        return Vector((x, y, z))
    def w(p, u, s):
        return [(UCH, 1.0 - 0.6 * u), (CH, 0.6 * u)]
    return fn, w
for off, ln, sw in ((0.000, 0.26, -0.014), (0.026, 0.21, 0.016)):
    fn, w = tail(off, ln, sw)
    grid(fn, 14, 6, 1.0, 1.0, False, False, w)
# the knot: a small squashed roll
knotc = Vector((kx + 0.013, min(ky - 0.022, front_y(kx + 0.013, kz + 0.004, ky) - 0.006), kz + 0.006))
def knot(u, s):
    # a solid, slightly lumpy ellipsoid (a tied knot), no hole
    th, ph = u * 2 * math.pi, s * math.pi
    lump = 1 + 0.10 * math.sin(3 * th) * math.sin(ph) + 0.06 * math.cos(2 * ph)
    return knotc + Vector((0.030 * math.cos(th) * math.sin(ph) * lump, -0.016 * math.sin(th) * math.sin(ph) * lump - 0.004,
                           0.024 * math.cos(ph) * lump))
grid(knot, 20, 10, 0.4, 0.4, True, False, lambda p, *_: [(UCH, 1.0)])

me = bpy.data.meshes.new('Outfit_scarf'); bm.normal_update()
bm.verts.index_update()
wlist = [(v.index, w) for v, w in verts_w.items()]
bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('Outfit_scarf', me); bpy.context.scene.collection.objects.link(ob)
ob.parent = arm
for bone in {b for _, w in wlist for b, _ in w}:
    ob.vertex_groups.new(name=bone)
for vi, w in wlist:
    for b, x in w: ob.vertex_groups[b].add([vi], x, 'REPLACE')
mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm

mat = bpy.data.materials.new('Scarf_CLOTH'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
img = bpy.data.images.load(tex_p); img.name = 'Scarf_knit'
tn = mat.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img
mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
mat.node_tree.links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
mat.use_backface_culling = False      # flat tails are seen from both sides
me.materials.append(mat)
for o in list(bpy.data.objects):
    if o not in (arm, ob): bpy.data.objects.remove(o)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in [e for e in arm.data.edit_bones if e.name.startswith(('HairJoint', 'J_Sec_Hair', 'H_'))]: arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
for o in bpy.data.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_p, export_format='GLB', use_selection=True, export_skins=True, export_morph=False,
                          export_animations=False, export_image_format='AUTO')
print('SCARF tris', sum(len(p.vertices) - 2 for p in me.polygons), '->', out_p)
