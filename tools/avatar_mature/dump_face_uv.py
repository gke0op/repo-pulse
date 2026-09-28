# Per-material UV triangles + 3D positions (armature space) of the Face mesh -> JSON
import bpy, sys, json, bmesh
a = sys.argv[sys.argv.index('--')+1:]
[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
bpy.ops.import_scene.vrm(filepath=a[0])
face = bpy.data.objects['Face']; M = face.matrix_world
bm = bmesh.new(); bm.from_mesh(face.data); bm.faces.ensure_lookup_table(); uv = bm.loops.layers.uv.active
out = {}
for f in bm.faces:
    name = face.data.materials[f.material_index].name
    img = None
    for n in face.data.materials[f.material_index].node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and not n.image.name.startswith(('Shader_', 'Matcap')) and '_nml' not in n.image.name and '_out' not in n.image.name:
            img = n.image.name
    d = out.setdefault(name, {'image': img, 'tris': []})
    ls = list(f.loops)
    for i in range(1, len(ls) - 1):
        tri = [ls[0], ls[i], ls[i + 1]]
        d['tris'].append([[l[uv].uv.x, l[uv].uv.y, *(M @ l.vert.co)] for l in tri])
json.dump(out, open(a[1], 'w'))
for k, v in out.items(): print('UV', k, v['image'], len(v['tris']))
