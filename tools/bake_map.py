#!/usr/bin/env python3
"""
Bake a Source-engine map exported as glTF (Sketchfab "gm_construct") into the compact format the game loads.

    python3 tools/bake_map.py <dir containing scene.gltf + scene.bin + textures/> assets/maps/gm_construct

Output (all in the map's own units, 1 unit = 100 Source units; the game scales it to the player at load):
  map.json   materials (with a `collide` flag), bounds; collision is built from the meshes at load
  map.bin    per-material vertex/normal/uv/index arrays (little endian, 4-byte aligned)
  textures/  WebP, max TEXTURE_MAX px

Requires numpy and Pillow. Not needed at runtime. See docs/AGENTS.md "Add a map".
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image

# ---- tunables -------------------------------------------------------------------------------------
SKY_Y = 60.0              # geometry whose lowest point is above this is the 3D-skybox miniature: dropped
TEXTURE_MAX = 1024
WEBP_QUALITY = 82
ALPHA_MASK_BELOW = 250    # texture alpha min below this => alpha-tested material
NO_RENDER = ('tools',)    # material-name prefixes that are never drawn (nodraw, skybox, clips)
NO_COLLIDE = ('materialsmodelsprops_interiorsflorescent', 'materialsmodelsdav0r', 'metalmetalladder',
              'gm_constructoverlay', 'decals', 'gm_constructconstruct_credits', 'gm_constructwater')
DECAL = ('gm_constructoverlay', 'decals', 'gm_constructconstruct_credits')
WATER = ('gm_constructwater',)

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
WRAP = {10497: 'repeat', 33071: 'clamp', 33648: 'mirror'}


class Gltf:
    def __init__(self, base):
        self.base = base
        self.g = json.load(open(os.path.join(base, 'scene.gltf')))
        self.blob = open(os.path.join(base, 'scene.bin'), 'rb').read()
        self.inst = []
        for root in self.g['scenes'][self.g.get('scene', 0)]['nodes']:
            self._walk(root, np.eye(4))

    def accessor(self, i):
        a = self.g['accessors'][i]
        bv = self.g['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']])
        n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0)
        if stride and stride != dt.itemsize * n:
            raw = np.frombuffer(self.blob, np.uint8, a['count'] * stride, off).reshape(a['count'], stride)
            arr = raw[:, :dt.itemsize * n].copy().view(dt)
        else:
            arr = np.frombuffer(self.blob, dt, a['count'] * n, off)
        return arr.reshape(a['count'], n)

    @staticmethod
    def local(node):
        if 'matrix' in node:
            return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
        m = np.eye(4)
        if 'scale' in node:
            m = np.diag(list(node['scale']) + [1]) @ m
        if 'rotation' in node:
            x, y, z, w = node['rotation']
            r = np.eye(4)
            r[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
            m = r @ m
        if 'translation' in node:
            t = np.eye(4)
            t[:3, 3] = node['translation']
            m = t @ m
        return m

    def _walk(self, i, parent):
        node = self.g['nodes'][i]
        m = parent @ self.local(node)
        if 'mesh' in node:
            self.inst.append((node['mesh'], m))
        for c in node.get('children', []):
            self._walk(c, m)

    def primitives(self):
        """Yield (material index, world positions, world normals, uvs, triangles) with winding fixed for mirrored nodes."""
        for mesh, m in self.inst:
            flip = np.linalg.det(m[:3, :3]) < 0
            for p in self.g['meshes'][mesh]['primitives']:
                at = p['attributes']
                pos = self.accessor(at['POSITION']).astype(np.float64)
                pos = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3]
                nrm = None
                if 'NORMAL' in at:
                    nrm = self.accessor(at['NORMAL']).astype(np.float64) @ np.linalg.inv(m[:3, :3])
                    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
                    nrm = nrm / np.where(ln == 0, 1, ln)
                uv = self.accessor(at['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in at else np.zeros((len(pos), 2))
                tri = self.accessor(p['indices']).astype(np.int64).reshape(-1, 3) if 'indices' in p else np.arange(len(pos)).reshape(-1, 3)
                if flip:
                    tri = tri[:, ::-1]
                yield p.get('material', -1), pos, nrm, uv, tri


def starts(name, prefixes):
    return name.startswith(prefixes)


# ---- rendering geometry + textures -----------------------------------------------------------------
def bake_render(gl, prims, origin, out_dir):
    g = gl.g
    per = defaultdict(lambda: {'pos': [], 'nrm': [], 'uv': [], 'idx': [], 'n': 0})
    for mat, pos, nrm, uv, tri in prims:
        name = g['materials'][mat]['name']
        if starts(name, NO_RENDER):
            continue
        d = per[mat]
        if nrm is None:
            a, b, c = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
            fn = np.cross(b - a, c - a)
            fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
            nrm = np.zeros_like(pos)
            nrm[tri[:, 0]] = fn
        d['pos'].append(pos - origin)
        d['nrm'].append(nrm)
        d['uv'].append(uv)
        d['idx'].append(tri + d['n'])
        d['n'] += len(pos)

    os.makedirs(os.path.join(out_dir, 'textures'), exist_ok=True)
    tex_cache = {}

    def texture_for(mat_json):
        ref = mat_json.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if not ref:
            return None, 'opaque', 'repeat', 'repeat'
        tex = g['textures'][ref['index']]
        src = g['images'][tex['source']]['uri']
        smp = g['samplers'][tex['sampler']] if 'sampler' in tex else {}
        wrap_s, wrap_t = WRAP.get(smp.get('wrapS', 10497), 'repeat'), WRAP.get(smp.get('wrapT', 10497), 'repeat')
        if src not in tex_cache:
            img = Image.open(os.path.join(gl.base, src))
            has_alpha = img.mode in ('RGBA', 'LA') or 'transparency' in img.info
            img = img.convert('RGBA' if has_alpha else 'RGB')
            alpha_min = int(np.asarray(img)[..., 3].min()) if has_alpha else 255
            if max(img.size) > TEXTURE_MAX:
                s = TEXTURE_MAX / max(img.size)
                img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
            if alpha_min >= ALPHA_MASK_BELOW:
                img = img.convert('RGB')
            rel = 'textures/' + os.path.splitext(os.path.basename(src))[0] + '.webp'
            img.save(os.path.join(out_dir, rel), 'WEBP', quality=WEBP_QUALITY, method=4)
            tex_cache[src] = (rel, 'opaque' if alpha_min >= ALPHA_MASK_BELOW else 'mask')
        rel, alpha = tex_cache[src]
        return rel, alpha, wrap_s, wrap_t

    chunks, materials, cursor = [], [], 0

    def push(arr):
        nonlocal cursor
        raw = arr.tobytes()
        raw += b'\0' * (-len(raw) % 4)
        chunks.append(raw)
        start = cursor
        cursor += len(raw)
        return start

    for mat in sorted(per):
        d, mj = per[mat], g['materials'][mat]
        pos = np.concatenate(d['pos']).astype(np.float32)
        nrm = np.clip(np.round(np.concatenate(d['nrm']) * 127), -127, 127).astype(np.int8)
        uv = np.concatenate(d['uv']).astype(np.float32)
        idx = np.concatenate(d['idx'])
        idx = idx.astype(np.uint16 if len(pos) < 65536 else np.uint32).reshape(-1)
        rel, alpha, wrap_s, wrap_t = texture_for(mj)
        color = mj.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3]
        name = mj['name']
        materials.append({
            'name': name, 'texture': rel, 'color': [round(c, 3) for c in color], 'alpha': alpha,
            'wrap': [wrap_s, wrap_t], 'decal': starts(name, DECAL), 'water': starts(name, WATER),
            'collide': not starts(name, NO_COLLIDE),
            'vertices': len(pos), 'indices': len(idx), 'indexBytes': idx.itemsize,
            'pos': push(pos), 'nrm': push(nrm), 'uv': push(uv), 'idx': push(idx),
        })
    with open(os.path.join(out_dir, 'map.bin'), 'wb') as f:
        for c in chunks:
            f.write(c)
    return materials


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    gl = Gltf(src)
    prims = [p for p in gl.primitives() if p[1][:, 1].min() < SKY_Y]
    allp = np.concatenate([p[1] for p in prims])
    lo, hi = allp.min(0), allp.max(0)
    ground = float(os.environ.get('GROUND_Y', -1.5))   # main floor level of the source map -> y = 0
    origin = np.array([(lo[0] + hi[0]) / 2, ground, (lo[2] + hi[2]) / 2])
    print('source bounds', lo.round(2), hi.round(2), 'origin', origin.round(2))
    materials = bake_render(gl, prims, origin, out)
    meta = {
        'version': 1, 'title': 'gm_construct',
        'credit': gl.g['asset'].get('extras', {}),
        'bounds': {'min': (lo - origin).round(3).tolist(), 'max': (hi - origin).round(3).tolist()},
        'materials': materials,
    }
    json.dump(meta, open(os.path.join(out, 'map.json'), 'w'), separators=(',', ':'))
    print('materials', len(materials), 'bin bytes', os.path.getsize(os.path.join(out, 'map.bin')))


if __name__ == '__main__':
    main()
