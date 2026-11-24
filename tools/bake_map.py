#!/usr/bin/env python3
"""
Bake a Source-engine map exported as glTF (Sketchfab "gm_construct") into the compact format the game loads.

    python3 tools/bake_map.py <dir containing scene.gltf + scene.bin + textures/> assets/maps/gm_construct

Output (all in the map's own units, 1 unit = 100 Source units; the game scales it to the player at load):
  map.json   materials, bounds, collision boxes
  map.bin    per-material vertex/normal/uv/index arrays (little endian, 4-byte aligned)
  textures/  WebP, max TEXTURE_MAX px

Requires numpy and Pillow. Not needed at runtime. See docs/AGENTS.md "Add a map".
"""
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image

# ---- tunables -------------------------------------------------------------------------------------
SKY_Y = 60.0              # geometry whose lowest point is above this is the 3D-skybox miniature: dropped
CELL = 0.1                # collision raster cell (model units; ~0.27 game units)
QY = 0.15                 # collision height quantum (model units); times the load scale it must stay below the player's step height
FLOOR_NY = 0.5            # |normal.y| above this = floor/ceiling, else wall
UNPAIRED_CEILING = 0.2    # thickness given to a ceiling face that has no floor above it
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
            'vertices': len(pos), 'indices': len(idx), 'indexBytes': idx.itemsize,
            'pos': push(pos), 'nrm': push(nrm), 'uv': push(uv), 'idx': push(idx),
        })
    with open(os.path.join(out_dir, 'map.bin'), 'wb') as f:
        for c in chunks:
            f.write(c)
    return materials


# ---- collision -------------------------------------------------------------------------------------
FLOOR, CEIL, WALL = 0, 1, 2
NEG = -32768              # collider bottom meaning "solid all the way down"


def sample_triangles(tris, lo, nx, nz):
    """Rasterize triangles into per-cell events (cell, y0, y1, kind). Walls are edge-sampled (conservative); floors and ceilings sample cell centres only, which keeps slopes noise-free."""
    cell, y0s, y1s, kinds = [], [], [], []

    def emit(ix, iz, y0, y1, kind):
        ok = (ix >= 0) & (ix < nx) & (iz >= 0) & (iz < nz)
        cell.append((iz[ok] * nx + ix[ok]).astype(np.int64))
        y0s.append(np.broadcast_to(y0, ix.shape)[ok])
        y1s.append(np.broadcast_to(y1, ix.shape)[ok])
        kinds.append(np.full(ok.sum(), kind, np.int8))

    for a, b, c in tris:
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            continue
        ny = n[1] / ln
        kind = FLOOR if ny > FLOOR_NY else CEIL if ny < -FLOOR_NY else WALL
        for p, q in ((a, b), (b, c), (c, a)):
            steps = max(1, int(math.ceil(math.hypot(q[0] - p[0], q[2] - p[2]) / (CELL * 0.5))))
            t = np.linspace(0, 1, steps + 1)[:, None]
            pt = p + (q - p) * t
            ix = np.floor((pt[:, 0] - lo[0]) / CELL).astype(np.int64)
            iz = np.floor((pt[:, 2] - lo[2]) / CELL).astype(np.int64)
            if kind == WALL:
                emit(ix, iz, min(a[1], b[1], c[1]), max(a[1], b[1], c[1]), WALL)
        if kind == WALL:
            continue
        # interior cell centres, barycentric in XZ
        xs, zs = (a[0], b[0], c[0]), (a[2], b[2], c[2])
        i0, i1 = int(math.floor((min(xs) - lo[0]) / CELL)), int(math.floor((max(xs) - lo[0]) / CELL))
        j0, j1 = int(math.floor((min(zs) - lo[2]) / CELL)), int(math.floor((max(zs) - lo[2]) / CELL))
        gi, gj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
        px, pz = lo[0] + (gi + 0.5) * CELL, lo[2] + (gj + 0.5) * CELL
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d
        w1 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d
        w2 = 1 - w0 - w1
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if m.any():
            y = w0[m] * a[1] + w1[m] * b[1] + w2[m] * c[1]
            emit(gi[m], gj[m], y, y, kind)
    return (np.concatenate(cell), np.concatenate(y0s), np.concatenate(y1s), np.concatenate(kinds))


def column_spans(ev):
    """Solid vertical spans [(bottom, top)] (bottom may be -inf) for one cell from its sorted events (y0, y1, kind)."""
    spans = []
    for k, (y0, y1, kind) in enumerate(ev):
        if kind == WALL:
            spans.append((y0, y1))
        elif kind == FLOOR:
            bottom = -math.inf
            for j in range(k - 1, -1, -1):
                if ev[j][2] == CEIL:
                    bottom = ev[j][0]
                    break
            spans.append((bottom, y0))
        elif not any(e[2] == FLOOR for e in ev[k + 1:]):
            spans.append((y0, y0 + UNPAIRED_CEILING))
    spans.sort()
    merged = []
    for b, t in spans:
        if merged and b <= merged[-1][1] + QY * 0.5:
            merged[-1] = (merged[-1][0], max(merged[-1][1], t))
        else:
            merged.append((b, t))
    return merged


def merge_rects(cells):
    """Greedy rectangle cover of a set of (i, j) cells: runs along i, stacked while identical on consecutive j."""
    rows = defaultdict(list)
    for i, j in cells:
        rows[j].append(i)
    open_rects, rects = {}, []
    for j in sorted(rows):
        runs, cur = [], None
        for i in sorted(rows[j]):
            if cur and i == cur[1] + 1:
                cur[1] = i
            else:
                cur = [i, i]
                runs.append(cur)
        keys = {(r[0], r[1]) for r in runs}
        for key in list(open_rects):
            if key not in keys or open_rects[key][1] != j - 1:
                rects.append((key, open_rects.pop(key)))
        for key in keys:
            if key in open_rects:
                open_rects[key][1] = j
            else:
                open_rects[key] = [j, j]
    rects.extend(open_rects.items())
    return rects


def bake_collision(prims, gl, origin):
    g = gl.g
    tris = []
    for mat, pos, _nrm, _uv, tri in prims:
        if starts(g['materials'][mat]['name'], NO_COLLIDE):
            continue
        p = pos - origin
        tris.extend(zip(p[tri[:, 0]], p[tri[:, 1]], p[tri[:, 2]]))
    allp = np.array([v for t in tris for v in t])
    lo = allp.min(0) - CELL * 2
    hi = allp.max(0) + CELL * 2
    nx, nz = int(math.ceil((hi[0] - lo[0]) / CELL)), int(math.ceil((hi[2] - lo[2]) / CELL))
    print(f'collision grid {nx}x{nz}, {len(tris)} triangles')
    cell, y0, y1, kind = sample_triangles(tris, lo, nx, nz)
    order = np.lexsort((y0, cell))
    cell, y0, y1, kind = cell[order], y0[order], y1[order], kind[order]
    bounds = np.flatnonzero(np.diff(cell)) + 1
    groups = defaultdict(list)
    for s, e in zip(np.r_[0, bounds], np.r_[bounds, len(cell)]):
        ev = list(zip(y0[s:e].tolist(), y1[s:e].tolist(), kind[s:e].tolist()))
        c = int(cell[s])
        for b, t in column_spans(ev):
            qb, qt = (NEG if b == -math.inf else round(b / QY)), round(t / QY)
            if qb == NEG or qt > qb:
                groups[(qb, qt)].append((c % nx, c // nx))
    boxes = []
    for (qb, qt), cells in groups.items():
        for (i0, i1), (j0, j1) in merge_rects(cells):
            boxes += [i0, i1 + 1, j0, j1 + 1, qb, qt]
    print(f'collision boxes: {len(boxes) // 6}')
    return boxes, (lo, hi, nx, nz)


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
    boxes, grid = bake_collision(prims, gl, origin)
    meta = {
        'version': 1, 'title': 'gm_construct',
        'credit': gl.g['asset'].get('extras', {}),
        'bounds': {'min': (lo - origin).round(3).tolist(), 'max': (hi - origin).round(3).tolist()},
        'materials': materials,
        # flat ints, 6 per box: x0 x1 z0 z1 (cells) bottom top (height quanta; bottom == -32768 means unbounded)
        'collision': {'cell': CELL, 'quantum': QY, 'originX': round(float(grid[0][0]), 4), 'originZ': round(float(grid[0][2]), 4), 'boxes': boxes},
    }
    json.dump(meta, open(os.path.join(out, 'map.json'), 'w'), separators=(',', ':'))
    print('materials', len(materials), 'bin bytes', os.path.getsize(os.path.join(out, 'map.bin')))


if __name__ == '__main__':
    main()
