import bpy, bmesh, sys
from mathutils import Vector
path = sys.argv[sys.argv.index('--')+1]
[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
bpy.ops.import_scene.vrm(filepath=path)
ob = bpy.data.objects['Body']; me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
uv = bm.loops.layers.uv.active
tops = [i for i,m in enumerate(me.materials) if 'Tops' in m.name][0]
faces = [f for f in bm.faces if f.material_index == tops]
# islands via shared-UV edges
from collections import defaultdict
key = lambda l: (l.vert.index, round(l[uv].uv.x,5), round(l[uv].uv.y,5))
parent = {}
def find(a):
    while parent[a]!=a: parent[a]=parent[parent[a]]; a=parent[a]
    return a
for f in faces: parent[f.index]=f.index
owner = defaultdict(list)
for f in faces:
    for l in f.loops: owner[key(l)].append(f.index)
for fs in owner.values():
    for x in fs[1:]:
        a,b=find(fs[0]),find(x)
        if a!=b: parent[a]=b
isl = defaultdict(list)
for f in faces: isl[find(f.index)].append(f)
for k,fs in sorted(isl.items(), key=lambda kv:-len(kv[1])):
    us=[l[uv].uv for f in fs for l in f.loops]; cs=[f.calc_center_median() for f in fs]
    c=sum(cs,Vector())/len(cs)
    zs=[v.co.z for f in fs for v in f.verts]
    print(f"ISL n={len(fs)} uv x[{min(u.x for u in us):.3f},{max(u.x for u in us):.3f}] y[{min(u.y for u in us):.3f},{max(u.y for u in us):.3f}] c3d=({c.x:.3f},{c.y:.3f},{c.z:.3f}) z[{min(zs):.3f},{max(zs):.3f}]")
import json
out=[]
for k,fs in isl.items():
    us=[l[uv].uv for f in fs for l in f.loops]
    x0,x1,y0,y1=min(u.x for u in us),max(u.x for u in us),min(u.y for u in us),max(u.y for u in us)
    n=len(fs)
    if n>500: lab='torso'
    elif y0>0.63 and (x1<0.34 or x0>0.66): lab='sleeve'
    elif x0>0.32 and x1<0.68 and y0>0.75: lab='collar'
    elif y0>0.59 and n==8: lab='collar'
    elif 0.40<x0 and x1<0.6: lab='placket'
    elif y1<0.64 and (x1<0.34 or x0>0.66): lab='side'
    else: lab='other'
    out.append({'label':lab,'n':n,'polys':[[[l[uv].uv.x,l[uv].uv.y] for l in f.loops] for f in fs],'faces':[f.index for f in fs]})
    print('LAB',lab,n,round(x0,3),round(x1,3),round(y0,3),round(y1,3))
json.dump(out,open(sys.argv[sys.argv.index('--')+2],'w'))
