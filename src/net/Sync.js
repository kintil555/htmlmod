import { CONFIG } from '../config.js';
import { STR } from '../content/strings.js';
import { NextbotRegistry, PropRegistry } from '../core/registries.js';
import { Assets } from '../core/Assets.js';
import { events } from '../core/Events.js';
import { Nextbot } from '../entities/Nextbot.js';
import { Prop } from '../entities/Prop.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';
import { toast } from '../ui/ui.js';
import { Net } from './Net.js';
import { T, FLAG, round2, RateLimiter } from './protocol.js';

const N = CONFIG.net;
const REGISTRY = { nextbot: NextbotRegistry, prop: PropRegistry };
const finite = (...v) => v.every(Number.isFinite);

/**
 * Game-side replication. The host owns the world: it runs the nextbots, accepts spawn / remove requests from guests and
 * announces every nextbot / prop it gets ("spawned" / "removed", each with a net id, `nid`). Guests mirror that: remote
 * nextbots are driven by snapshots, remote props are plain props. Every client owns its own player and sends its state.
 */
export class Sync {
  constructor(game) {
    this.game = game;
    /** id -> RemotePlayer. */
    this.remotes = new Map();
    /** nid -> entity (nextbot or prop) known to the net layer. */
    this.byNid = new Map();
    this.nextNid = 1;
    this._acc = 0;
    this._target = null;
    this._retarget = 0;
    /** Host: guest id -> { spawn: RateLimiter, clear: RateLimiter }. */
    this._limits = new Map();

    Net.snapshotProvider = () => this.snapshot();
    Net.events.on('players', () => this._syncPlayers());
    Net.events.on('msg', ({ from, msg }) => this._onMsg(from, msg));
    Net.events.on('state', ({ from, msg }) => this._onState(from, msg));
    events.on('game:entity:add', e => this._onAdd(e));
    events.on('game:entity:remove', e => this._onRemove(e));
  }

  /* ---------------- players ---------------- */

  /** Makes the set of RemotePlayer entities match Net.players (everyone except this client). */
  _syncPlayers() {
    const world = this.game.world;
    if (!world) return;
    const seen = new Set();
    for (const p of Net.players.values()) {
      if (p.id === Net.selfId) continue;
      seen.add(p.id);
      const known = this.remotes.get(p.id);
      if (known) { known.setName(p.name); continue; }
      const rp = world.add(new RemotePlayer(p.id, p.name));
      this.remotes.set(p.id, rp);
      if (this.game.state === 'playing') toast(STR.net.joined(p.name));
    }
    for (const [id, rp] of [...this.remotes]) {
      if (seen.has(id)) continue;
      this.remotes.delete(id);
      this._limits.delete(id);
      world.remove(rp);
      if (this.game.state === 'playing' && Net.active) toast(STR.net.left(rp.name));
    }
    if (this._target && !this.remotes.has(this._target.id) && this._target !== this.game.player) this._target = null;
    this.game.refreshPlayers?.();
  }

  /** Back to a clean slate (session ended): no remote players, no net ids. */
  reset() {
    const world = this.game.world;
    for (const rp of this.remotes.values()) world?.remove(rp);
    this.remotes.clear();
    this.byNid.clear();
    this._limits.clear();
    this._target = null;
  }

  /** Host: a guest's state packet made safe, or null. Everything is finite and inside the map, so a guest cannot park itself (and the nextbots) out of bounds. */
  _cleanState(s) {
    if (!Array.isArray(s) || s.length !== 6 || !s.every(Number.isFinite)) return null;
    const b = this.game.world.bounds;
    const top = Number.isFinite(b.maxY) ? b.maxY : b.minY + 500;
    const [x, y, z, yaw, pitch, flags] = s;
    const m = N.boundsMargin;
    if (x < b.minX - m || x > b.maxX + m || z < b.minZ - m || z > b.maxZ + m || y < b.minY - m || y > top + m) return null;
    if (Math.abs(yaw) > 1e4 || Math.abs(pitch) > 4) return null;
    return [x, y, z, yaw, pitch, flags & (FLAG.ground | FLAG.sprint | FLAG.dead)];
  }

  _limitsOf(id) {
    let l = this._limits.get(id);
    if (!l) this._limits.set(id, l = { spawn: new RateLimiter(N.spawnRate, N.spawnBurst), clear: new RateLimiter(1 / N.clearCooldownSec, 1) });
    return l;
  }

  /* ---------------- state packets ---------------- */

  _localState() {
    const p = this.game.player;
    const flags = (p.onGround ? FLAG.ground : 0) | (p.sprinting ? FLAG.sprint : 0) | (p.frozen ? FLAG.dead : 0);
    return [round2(p.pos.x), round2(p.pos.y), round2(p.pos.z), round2(p.yaw), round2(p.pitch), flags];
  }

  /** Called every frame while a session is active. Sends at CONFIG.net.sendRate. */
  update(dt) {
    if (!Net.active || this.game.state !== 'playing') return;
    this._acc += dt;
    const step = 1 / N.sendRate;
    if (this._acc < step) return;
    this._acc %= step;
    if (Net.isGuest) { Net.sendState({ t: T.STATE, s: this._localState() }); return; }
    const p = [[Net.selfId, ...this._localState()]];
    for (const [id, rp] of this.remotes) if (rp.raw) p.push([id, ...rp.raw]);
    const b = [];
    for (const e of this.byNid.values()) if (e.type === 'nextbot') b.push([e.nid, round2(e.s.x), round2(e.y), round2(e.s.z)]);
    Net.sendState({ t: T.SNAP, p, b });
  }

  _onState(from, msg) {
    if (msg.t === T.STATE && Net.isHost) {
      const clean = this._cleanState(msg.s);
      if (clean) this.remotes.get(from)?.setState(clean);
    } else if (msg.t === T.SNAP && Net.isGuest) {
      for (const row of Array.isArray(msg.p) ? msg.p.slice(0, N.maxPlayers) : []) {
        if (!Array.isArray(row) || row[0] === Net.selfId) continue;
        this.remotes.get(row[0])?.setState(row.slice(1));
      }
      for (const row of Array.isArray(msg.b) ? msg.b.slice(0, CONFIG.limits.maxNextbots) : []) {
        const bot = Array.isArray(row) ? this.byNid.get(row[0]) : null;
        if (bot?.remote && finite(row[1], row[2], row[3])) bot.setTarget(row[1], row[2], row[3]);
      }
    }
  }

  /* ---------------- nextbot target (host) ---------------- */

  /**
   * Who the nextbots chase this frame: on the host, the living player (local or remote) nearest to the pack, kept for
   * CONFIG.net.retargetSec unless they die. Anywhere else the local player.
   */
  chaseTarget(dt) {
    const me = this.game.player;
    if (!Net.isHost || !this.remotes.size) return me;
    this._retarget -= dt;
    if (this._retarget <= 0 || !this._target || this._target.frozen) {
      this._retarget = N.retargetSec;
      this._target = this._pickTarget(me);
    }
    return this._target;
  }

  _pickTarget(me) {
    const bots = this.game.world.ofType('nextbot');
    let cx = me.pos.x; let cz = me.pos.z;
    if (bots.length) {
      cx = 0; cz = 0;
      for (const b of bots) { cx += b.s.x; cz += b.s.z; }
      cx /= bots.length; cz /= bots.length;
    }
    let best = me; let bestD = Infinity;
    for (const c of [me, ...this.remotes.values()]) {
      if (c.frozen) continue;
      let d = Math.hypot(c.pos.x - cx, c.pos.z - cz);
      if (c === this._target) d *= N.retargetBias;
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  /* ---------------- spawning / removal ---------------- */

  /** Guest: ask the host to spawn. */
  requestSpawn(kind, def, point) {
    Net.send({ t: T.SPAWN_REQ, kind, def, x: round2(point.x), y: round2(point.y), z: round2(point.z) });
  }

  requestRemove(entity) { Net.send({ t: T.REMOVE_REQ, nid: entity.nid }); }

  requestClear() { Net.send({ t: T.CLEAR_REQ }); }

  /** Everything the host has spawned, for a joining guest. */
  snapshot() {
    const out = [];
    for (const e of this.byNid.values()) {
      const [x, y, z] = this._entityPos(e);
      out.push({ nid: e.nid, kind: e.type, def: e.def.id, x: round2(x), y: round2(y), z: round2(z) });
    }
    return { entities: out };
  }

  applySnapshot(snapshot) {
    const list = Array.isArray(snapshot?.entities) ? snapshot.entities.slice(0, CONFIG.limits.maxNextbots + CONFIG.limits.maxProps) : [];
    for (const s of list) this._applySpawn(s);
  }

  _entityPos(e) {
    return e.type === 'nextbot' ? [e.s.x, e.y, e.s.z] : [e.object3d.position.x, e.object3d.position.y, e.object3d.position.z];
  }

  _replicable(e) {
    return (e.type === 'nextbot' || e.type === 'prop') && typeof e.def?.id === 'string' && !e.remote;
  }

  /** Host: every nextbot / prop that enters the world (spawn tool, a mod, ...) gets a net id and is announced. */
  _onAdd(e) {
    if (!Net.isHost || !this._replicable(e)) return;
    if (e.nid == null) e.nid = this.nextNid++;
    this.byNid.set(e.nid, e);
    const [x, y, z] = this._entityPos(e);
    Net.send({ t: T.SPAWNED, nid: e.nid, kind: e.type, def: e.def.id, x: round2(x), y: round2(y), z: round2(z) });
  }

  _onRemove(e) {
    if (e.nid == null) return;
    this.byNid.delete(e.nid);
    if (Net.isHost) Net.send({ t: T.REMOVED, nid: e.nid });
  }

  /** Guest: build the entity the host announced. */
  _applySpawn(s) {
    const reg = REGISTRY[s?.kind];
    if (!reg || !Number.isInteger(s.nid) || !finite(s.x, s.y, s.z) || typeof s.def !== 'string' || !reg.has(s.def) || this.byNid.has(s.nid)) return;
    if (this.game.world.count(s.kind) >= (s.kind === 'nextbot' ? CONFIG.limits.maxNextbots : CONFIG.limits.maxProps)) return;
    const def = reg.get(s.def);
    let e;
    if (s.kind === 'nextbot') {
      e = new Nextbot(def, Assets.get(def.texture), s.x, s.z, this.game.player.pos, s.y);
      e.remote = true;
    } else {
      e = new Prop(def, s.x, s.z, s.y);
    }
    e.nid = s.nid;
    this.byNid.set(s.nid, e);
    this.game.world.add(e);
    this.game.spawnMenu?.updateCounts();
  }

  _onMsg(from, msg) {
    const g = this.game;
    if (Net.isHost) {
      const limits = this._limitsOf(from);
      if (msg.t === T.SPAWN_REQ) {
        const p = { x: msg.x, y: msg.y, z: msg.z };
        if (!finite(p.x, p.y, p.z) || typeof msg.def !== 'string' || !limits.spawn.allow()) return;
        const who = this.remotes.get(from);
        if (!who || Math.hypot(p.x - who.pos.x, p.y - who.pos.y, p.z - who.pos.z) > N.spawnReach) return;
        g.world.clamp(p, CONFIG.world.aimMargin);
        if (msg.kind === 'nextbot' && NextbotRegistry.has(msg.def)) g.spawnNextbot(msg.def, p, { quiet: true });
        else if (msg.kind === 'prop' && PropRegistry.has(msg.def)) g.spawnProp(msg.def, p, { quiet: true });
      } else if (msg.t === T.REMOVE_REQ) {
        if (!limits.spawn.allow()) return;
        const e = Number.isInteger(msg.nid) ? this.byNid.get(msg.nid) : null;
        if (e) g.world.remove(e);
      } else if (msg.t === T.CLEAR_REQ) {
        if (limits.clear.allow()) g.clearSpawned();
      }
      return;
    }
    if (msg.t === T.SPAWNED) this._applySpawn(msg);
    else if (msg.t === T.REMOVED) {
      const e = this.byNid.get(msg.nid);
      if (e) g.world.remove(e);
      g.spawnMenu?.updateCounts();
    }
  }
}
