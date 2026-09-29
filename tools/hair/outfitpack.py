# outfitpack.py: from a dressed character VRM (outfit.py output), export only the outfit as a small GLB pack:
# the Outfit skinned mesh + the skeleton it binds to (bones matched by name at runtime), textures capped.
#   blender --background --python outfitpack.py -- <dressed.vrm> <out.glb> [tex_max]
import bpy, sys, os
a = sys.argv[sys.argv.index('--') + 1:]; src, dst = a[:2]; TEX = int(a[2]) if len(a) > 2 else 1024
[bpy.data.objects.remove(o) for o in list(bpy.data.objects)]
bpy.ops.import_scene.vrm(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
out = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Outfit'))
for o in list(bpy.data.objects):
    if o not in (arm, out): bpy.data.objects.remove(o)
used = {g.name for g in out.vertex_groups}
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')                       # hair bones don't belong in an outfit pack
for eb in [e for e in arm.data.edit_bones if e.name.startswith(('HairJoint', 'J_Sec_Hair', 'H_'))]: arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
for g in [g for g in out.vertex_groups if g.name not in arm.data.bones]: out.vertex_groups.remove(g)
bpy.context.view_layer.objects.active = arm
for img in bpy.data.images:
    if img.size[0] > TEX or img.size[1] > TEX:
        f = TEX / max(img.size); img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f)))
for o in bpy.data.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_skins=True, export_morph=False,
                          export_animations=False, export_image_format=os.environ.get('PACK_FMT', 'WEBP'), export_image_quality=int(os.environ.get('PACK_Q', '90')))
tris = sum(len(p.vertices) - 2 for p in out.data.polygons)
print('PACK', dst, tris, 'tris', len(used), 'bone groups')
