/**
 * Automatic navigation graph. Baked from a Collision world, so any map (current or new) is navigable with no
 * hand-placed waypoints. Pure module (no three.js), unit tested in Node.
 *
 * Nodes: every standable, open spot of a regular XZ grid, one per floor level (multi-storey, tunnels, roofs).
 * Edges: walk (neighbour cells within walkRise), jump (up to a ledge the bot can reach with its jump) and drop
 * (walk off a ledge). Jump and drop edges are only added where walking is blocked.
 * Flow: one reverse Dijkstra from the target gives every bot its next step with a table lookup (cost-to-go).
 */
import { riseTime, maxJumpRise } from '../entities/steering.js';

export const EDGE = { walk: 0, jump: 1, drop: 2 };
/** Neighbour offsets; direction i and (i + 4) % 8 are opposites. */
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]];

const nextFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class NavGraph {
  /**
   * @param {import('./Collision.js').Collision} collision
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
   * @param {object} cfg CONFIG.nextbot.nav
   * @param {{bodyHeight:number, jumpSpeed:number, gravity:number, clearance:number, step:number}} phys nextbot body, stride and jump numbers
   */
  constructor(collision, bounds, cfg, phys) {
    this.col = collision; this.cfg = cfg; this.phys = phys;
    this.ox = bounds.minX; this.oz = bounds.minZ;
    this.nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cfg.cell));
    this.nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cfg.cell));
    this.ready = false;
    this.count = 0;
    this.target = -1;
    this._flowT = 0;
    this._flowFor = -2;
    this.maxUp = maxJumpRise(phys.jumpSpeed, phys.gravity, phys.clearance, cfg.minAirWindow);
    this._p = { x: 0, z: 0 };
  }

  nodeX(i) { return this.ox + (this.nodeCell[i] % this.nx + 0.5) * this.cfg.cell; }
  nodeZ(i) { return this.oz + (Math.floor(this.nodeCell[i] / this.nx) + 0.5) * this.cfg.cell; }

  /** Bakes the whole graph, yielding to the event loop so the loading screen keeps painting. */
  async bake(onProgress = () => {}) {
    const budget = this.cfg.yieldMs;
    let t0 = now();
    for (const p of this._steps()) {
      if (now() - t0 > budget) { onProgress(p); await nextFrame(); t0 = now(); }
    }
    onProgress(1);
  }

  /** Same as bake() but blocking (tests, tools). */
  bakeSync() { for (const _ of this._steps()) { /* run to completion */ } }

  * _steps() {
    const { nx, nz } = this;
    const cells = nx * nz;
    yield* this._nodes(cells);
    yield* this._edges();
    this._finish();
    this.ready = true;
  }

  _open(x, z, h) {
    const { col, cfg, phys } = this;
    if (col.ceilingHeight(x, z, 0.3, h, 0) - h < cfg.headroom) return false;
    const p = this._p; p.x = x; p.z = z;
    col.resolveCircle(p, cfg.radius, h, phys.bodyHeight, phys.step);
    return Math.hypot(p.x - x, p.z - z) < 0.1;
  }

  /** True when floor continues edgeMargin in every cardinal direction (no standing on a ledge lip). */
  _supported(x, z, h) {
    const { col, cfg, phys } = this; const m = cfg.edgeMargin;
    const lo = h - cfg.walkRise - 0.05;
    return col.groundHeight(x + m, z, 0.3, h, phys.step) >= lo && col.groundHeight(x - m, z, 0.3, h, phys.step) >= lo
      && col.groundHeight(x, z + m, 0.3, h, phys.step) >= lo && col.groundHeight(x, z - m, 0.3, h, phys.step) >= lo;
  }

  * _nodes(cells) {
    const { nx, cfg, col } = this;
    const heights = []; const nodeCell = [];
    const cellStart = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) {
      cellStart[c] = heights.length;
      const x = this.ox + (c % nx + 0.5) * cfg.cell; const z = this.oz + (Math.floor(c / nx) + 0.5) * cfg.cell;
      for (const h of col.floorsAt(x, z)) {
        if (h <= col.floorY + 0.01) continue;
        if (this._open(x, z, h) && this._supported(x, z, h)) { heights.push(h); nodeCell.push(c); }
      }
      if (c % 256 === 0) yield c / cells * 0.5;
    }
    cellStart[cells] = heights.length;
    this.cellStart = cellStart;
    this.nodeH = Float32Array.from(heights);
    this.nodeCell = Int32Array.from(nodeCell);
    this.count = heights.length;
  }

  _addEdge(a, b, cost, type) { this._ef.push(a); this._et.push(b); this._ec.push(cost); this._ey.push(type); }

  * _edges() {
    const { nx, nz, cfg, col, phys, count } = this;
    this._ef = []; this._et = []; this._ec = []; this._ey = [];
    const mask = new Uint8Array(count);
    const cellOf = (cx, cz) => (cx < 0 || cz < 0 || cx >= nx || cz >= nz ? -1 : cz * nx + cx);

    // Walk edges: forward half of the directions, added both ways.
    for (let a = 0; a < count; a++) {
      const cx = this.nodeCell[a] % nx; const cz = Math.floor(this.nodeCell[a] / nx);
      const hA = this.nodeH[a]; const xA = this.nodeX(a); const zA = this.nodeZ(a);
      for (let d = 0; d < 4; d++) {
        const c = cellOf(cx + DIRS[d][0], cz + DIRS[d][1]);
        if (c < 0) continue;
        let b = -1; let best = cfg.walkRise + 1e-6;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const dh = Math.abs(this.nodeH[k] - hA);
          if (dh < best) { best = dh; b = k; }
        }
        if (b < 0) continue;
        const hB = this.nodeH[b];
        const mx = (xA + this.nodeX(b)) / 2; const mz = (zA + this.nodeZ(b)) / 2;
        const lo = Math.min(hA, hB);
        if (col.groundHeight(mx, mz, 0.3, Math.max(hA, hB), phys.step) < lo - 0.5) continue;   // pit between the two
        if (!this._open(mx, mz, (hA + hB) / 2)) continue;                          // wall between the two
        const dist = Math.hypot(this.nodeX(b) - xA, this.nodeZ(b) - zA);
        const cost = dist + best * 0.5;
        this._addEdge(a, b, cost, EDGE.walk); this._addEdge(b, a, cost, EDGE.walk);
        mask[a] |= 1 << d; mask[b] |= 1 << ((d + 4) % 8);
      }
      if (a % 256 === 0) yield 0.5 + a / count * 0.25;
    }

    // Jump and drop edges, only in directions where walking is blocked.
    for (let a = 0; a < count; a++) {
      const cx = this.nodeCell[a] % nx; const cz = Math.floor(this.nodeCell[a] / nx);
      const hA = this.nodeH[a]; const xA = this.nodeX(a); const zA = this.nodeZ(a);
      for (let d = 0; d < 8; d++) {
        if (mask[a] & (1 << d)) continue;
        const [sx, sz] = DIRS[d];
        const len = Math.hypot(sx, sz);
        const ux = sx / len; const uz = sz / len;
        this._tryJump(a, cx, cz, sx, sz, ux, uz, len, hA, xA, zA, cellOf);
        this._tryDrop(a, cx, cz, sx, sz, ux, uz, len, hA, cellOf);
      }
      if (a % 256 === 0) yield 0.75 + a / count * 0.25;
    }
  }

  _tryJump(a, cx, cz, sx, sz, ux, uz, len, hA, xA, zA, cellOf) {
    const { cfg, col, phys } = this;
    for (let k = 1; k <= cfg.jumpCells; k++) {
      const c = cellOf(cx + sx * k, cz + sz * k);
      if (c < 0) return;
      let b = -1; let best = Infinity;
      for (let i = this.cellStart[c]; i < this.cellStart[c + 1]; i++) {
        const dh = this.nodeH[i] - hA;
        if (dh > cfg.walkRise && dh <= this.maxUp && dh < best) { best = dh; b = i; }
      }
      if (b < 0) continue;
      const hB = this.nodeH[b];
      const dist = k * cfg.cell * len;
      if (col.ceilingHeight(xA, zA, 0.3, hA, 0) < hB + phys.bodyHeight) return;                   // low ceiling above the launch spot
      if (col.sweepBlocker(xA, zA, ux, uz, dist, cfg.radius, hB, phys.bodyHeight, phys.step)) return;       // something blocks the path over the lip
      this._addEdge(a, b, dist + cfg.jumpPenalty + best * 0.3, EDGE.jump);
      return;
    }
  }

  _tryDrop(a, cx, cz, sx, sz, ux, uz, len, hA, cellOf) {
    const { cfg, col, phys } = this;
    for (let k = 1; k <= cfg.dropCells; k++) {
      const c = cellOf(cx + sx * k, cz + sz * k);
      if (c < 0) return;
      let b = -1; let best = -Infinity;
      for (let i = this.cellStart[c]; i < this.cellStart[c + 1]; i++) {
        const dh = this.nodeH[i] - hA;
        if (dh < -cfg.walkRise && dh >= -cfg.maxDrop && dh > best) { best = dh; b = i; }
      }
      if (b < 0) continue;
      const dist = k * cfg.cell * len;
      if (col.sweepBlocker(this.nodeX(a), this.nodeZ(a), ux, uz, dist, cfg.radius, hA, phys.bodyHeight, phys.step)) return;
      this._addEdge(a, b, dist + cfg.dropPenalty - best * 0.05, EDGE.drop);
      return;
    }
  }

  /** Packs the edge lists into forward and reverse CSR tables. */
  _finish() {
    const n = this.count; const m = this._ef.length;
    const f = Int32Array.from(this._ef); const t = Int32Array.from(this._et);
    const cst = Float32Array.from(this._ec); const ty = Uint8Array.from(this._ey);
    const pack = (keyArr, otherArr) => {
      const start = new Int32Array(n + 1);
      for (let i = 0; i < m; i++) start[keyArr[i] + 1]++;
      for (let i = 0; i < n; i++) start[i + 1] += start[i];
      const fill = start.slice(0, n);
      const other = new Int32Array(m); const cost = new Float32Array(m); const type = new Uint8Array(m);
      for (let i = 0; i < m; i++) { const j = fill[keyArr[i]]++; other[j] = otherArr[i]; cost[j] = cst[i]; type[j] = ty[i]; }
      return { start, other, cost, type };
    };
    const fwd = pack(f, t); const rev = pack(t, f);
    this.eStart = fwd.start; this.eTo = fwd.other; this.eCost = fwd.cost; this.eType = fwd.type;
    this.rStart = rev.start; this.rFrom = rev.other; this.rCost = rev.cost;
    this.edgeCount = m;
    this.dist = new Float64Array(n).fill(Infinity);
    this._heapK = new Float64Array(m + n + 16); this._heapV = new Int32Array(m + n + 16);
    this._ef = this._et = this._ec = this._ey = null;
  }

  /** Graph node nearest a position: same cell first, then rings of cells. Picks the floor closest below `y`. Returns -1 if none. */
  nodeAt(x, z, y) {
    if (!this.ready) return -1;
    const { nx, nz, cfg } = this;
    const cx = Math.floor((x - this.ox) / cfg.cell); const cz = Math.floor((z - this.oz) / cfg.cell);
    for (let r = 0; r <= cfg.nodeSearch; r++) {
      let best = -1; let bestScore = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = cx + dx; const pz = cz + dz;
          if (px < 0 || pz < 0 || px >= nx || pz >= nz) continue;
          const c = pz * nx + px;
          for (let i = this.cellStart[c]; i < this.cellStart[c + 1]; i++) {
            const h = this.nodeH[i];
            const v = h <= y + cfg.walkRise ? y - h : (h - y) * 4 + 5;
            const score = v + Math.hypot(x - this.nodeX(i), z - this.nodeZ(i)) * 0.5;
            if (score < bestScore) { bestScore = score; best = i; }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Recomputes the shared cost-to-go field when the target moved to another node (at most every flowInterval). */
  updateFlow(dt, x, y, z) {
    if (!this.ready) return;
    this._flowT -= dt;
    if (this._flowT > 0) return;
    const node = this.nodeAt(x, z, y);
    if (node === this._flowFor) return;
    this._flowT = this.cfg.flowInterval;
    this.setTarget(node);
  }

  /** Reverse Dijkstra from `node`: dist[i] becomes the cheapest path cost from i to the target. */
  setTarget(node) {
    this._flowFor = node; this.target = node;
    const { dist, rStart, rFrom, rCost, _heapK: hk, _heapV: hv } = this;
    dist.fill(Infinity);
    if (node < 0) return;
    let size = 0;
    const push = (k, v) => {
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = k; hv[i] = v;
    };
    dist[node] = 0; push(0, node);
    while (size > 0) {
      const k = hk[0]; const u = hv[0];
      size--;
      if (size > 0) {
        const lk = hk[size]; const lv = hv[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= lk) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = lk; hv[i] = lv;
      }
      if (k > dist[u]) continue;
      for (let e = rStart[u]; e < rStart[u + 1]; e++) {
        const w = rFrom[e]; const nk = k + rCost[e];
        if (nk < dist[w]) { dist[w] = nk; push(nk, w); }
      }
    }
  }

  /** Path cost from `node` to the target (Infinity when unreachable or no target). */
  costFrom(node) { return node < 0 || !this.ready ? Infinity : this.dist[node]; }

  /** Best outgoing edge of `node` toward the target (never the one into node `ban`), or -1. */
  nextEdge(node, ban = -1) {
    if (node < 0 || !(this.dist[node] < Infinity) || node === this.target) return -1;
    let best = -1; let bestV = Infinity;
    for (let e = this.eStart[node]; e < this.eStart[node + 1]; e++) {
      if (this.eTo[e] === ban) continue;
      const v = this.eCost[e] + this.dist[this.eTo[e]];
      if (v < bestV) { bestV = v; best = e; }
    }
    return best;
  }

  /**
   * Next waypoint for a bot standing on `node`: {x, y, z, type, node} or null.
   * Walk edges are smoothed by skipping ahead along nearly straight walk edges (carrot).
   * Jump/drop edges are returned as-is so the caller can time the jump. `ban` is a node the first step must avoid.
   */
  waypoint(node, out = { x: 0, y: 0, z: 0, type: 0, node: -1 }, ban = -1) {
    const e = this.nextEdge(node, ban);
    if (e < 0) return null;
    let to = this.eTo[e];
    const type = this.eType[e];
    if (type === EDGE.walk) {
      const d1x = this.nodeX(to) - this.nodeX(node); const d1z = this.nodeZ(to) - this.nodeZ(node);
      const l1 = Math.hypot(d1x, d1z);
      for (let hop = 1; hop < this.cfg.carrotHops; hop++) {
        const e2 = this.nextEdge(to);
        if (e2 < 0 || this.eType[e2] !== EDGE.walk) break;
        const n2 = this.eTo[e2];
        const d2x = this.nodeX(n2) - this.nodeX(to); const d2z = this.nodeZ(n2) - this.nodeZ(to);
        if ((d1x * d2x + d1z * d2z) / (l1 * Math.hypot(d2x, d2z)) < this.cfg.carrotCos) break;
        to = n2;
      }
    }
    out.x = this.nodeX(to); out.z = this.nodeZ(to); out.y = this.nodeH[to]; out.type = type; out.node = to;
    return out;
  }

  /** Time a jump of this rise needs to reach the ledge (for timing the launch), or null if out of reach. */
  riseTimeFor(dh) { return riseTime(this.phys.jumpSpeed, this.phys.gravity, dh + this.phys.clearance); }
}
