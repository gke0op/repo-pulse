#!/usr/bin/env python3
"""Check a VRM 0.x file against the avatar contract, straight from the glTF (no Blender).

Usage: python3 tools/vrm_check.py app/src/main/assets/avatar/models/*.vrm [--json]
Checks: triangles <= 40k, size <= 25 MB, textures <= 2048, every blend-shape bind hits a real
morph target, required expressions present, humanoid + eye bones, lookAt, CC0 + commercial meta.
Exit 1 if anything fails.
"""
import json, os, struct, sys

REQUIRED = ['a', 'i', 'u', 'e', 'o', 'blink', 'blink_l', 'blink_r', 'joy', 'angry', 'sorrow', 'fun', 'neutral']
CUSTOM = ['Surprised']
BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'leftEye', 'rightEye', 'leftShoulder', 'rightShoulder',
         'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']


def read_glb(path):
    b = open(path, 'rb').read()
    magic, _, _ = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67, 'not a GLB'
    n, _ = struct.unpack_from('<II', b, 12)
    doc = json.loads(b[20:20 + n])
    off = 20 + n
    bn, _ = struct.unpack_from('<II', b, off)
    return doc, b[off + 8:off + 8 + bn]


def image_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    if data[:2] == b'\xff\xd8':
        i = 2
        while i < len(data):
            m, ln = data[i + 1], struct.unpack('>H', data[i + 2:i + 4])[0]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', data[i + 5:i + 9])
                return w, h
            i += 2 + ln
    return (0, 0)


def check(path):
    doc, binc = read_glb(path)
    res, fails = {'file': os.path.basename(path)}, []
    res['mb'] = round(os.path.getsize(path) / 1e6, 2)
    tris = 0
    for m in doc['meshes']:
        for p in m['primitives']:
            if p.get('mode', 4) != 4: continue
            cnt = doc['accessors'][p['indices']]['count'] if 'indices' in p else doc['accessors'][p['attributes']['POSITION']]['count']
            tris += cnt // 3
    res['tris'] = tris
    sizes = []
    for im in doc.get('images', []):
        bv = doc['bufferViews'][im['bufferView']]
        sizes.append(image_size(binc[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))
    res['textures'] = len(sizes)
    res['max_tex'] = max((max(s) for s in sizes), default=0)

    vrm = doc.get('extensions', {}).get('VRM')
    if not vrm: fails.append('no VRM 0.x extension')
    else:
        groups = vrm['blendShapeMaster']['blendShapeGroups']
        names = {g.get('presetName') if g.get('presetName') not in (None, '', 'unknown') else g['name']: g for g in groups}
        res['groups'] = len(groups)
        for r in REQUIRED + CUSTOM:
            if r not in names: fails.append(f'missing expression {r}')
        bad = 0
        for g in groups:
            for bnd in g.get('binds', []):
                mesh = doc['meshes'][bnd['mesh']] if bnd['mesh'] < len(doc['meshes']) else None
                ok = mesh and all(bnd['index'] < len(p.get('targets', [])) for p in mesh['primitives'])
                if not ok:
                    bad += 1; fails.append(f"{g['name']}: bind mesh {bnd['mesh']} index {bnd['index']} invalid")
            if g.get('presetName') not in ('neutral',) and not g.get('binds') and not g.get('materialValues'):
                fails.append(f"{g['name']}: empty group")
        res['bad_binds'] = bad
        hb = {h['bone']: h['node'] for h in vrm['humanoid']['humanBones']}
        for bname in BONES:
            if bname not in hb or not (0 <= hb[bname] < len(doc['nodes'])): fails.append(f'missing bone {bname}')
        res['human_bones'] = len(hb)
        fp = vrm.get('firstPerson', {})
        res['lookAt'] = fp.get('lookAtTypeName')
        if fp.get('lookAtTypeName') not in ('Bone', 'BlendShape'): fails.append('no lookAt')
        meta = vrm.get('meta', {})
        res['license'] = meta.get('licenseName'); res['commercial'] = meta.get('commercialUssageName')
        res['meta_note'] = meta.get('otherLicenseUrl') or meta.get('otherPermissionUrl') or ''
        res['title'] = meta.get('title'); res['version'] = meta.get('version')
        if meta.get('licenseName') != 'CC0': fails.append('license not CC0')
        if meta.get('commercialUssageName') != 'Allow': fails.append('commercial use not allowed')
    if tris > 40000: fails.append(f'triangles {tris} > 40000')
    if res['mb'] > 25: fails.append(f"size {res['mb']} MB > 25")
    if res['max_tex'] > 2048: fails.append(f"texture {res['max_tex']} > 2048")
    res['fails'] = fails
    return res


if __name__ == '__main__':
    files = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = [check(f) for f in files]
    if '--json' in sys.argv: print(json.dumps(out, indent=1))
    else:
        for r in out:
            print({k: v for k, v in r.items() if k != 'fails'})
            for f in r['fails']: print('  FAIL', f)
    sys.exit(1 if any(r['fails'] for r in out) else 0)
