import assert from 'node:assert/strict';
import { Collision } from '../src/world/Collision.js';
import { NavGraph, EDGE } from '../src/world/NavGraph.js';
import { CONFIG } from '../src/config.js';

const n = CONFIG.nextbot;
const phys = { bodyHeight: n.bodyHeight, jumpSpeed: n.jumpSpeed, gravity: n.gravity, clearance: n.clearance, step: n.stepHeight };
const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };

function world(boxes) {
  const c = new Collision({ step: CONFIG.player.stepHeight, floorY: -5 });
  c.add({ minX: -30, maxX: 30, minZ: -30, maxZ: 30, top: 0, bottom: -4 });
  for (const b of boxes) c.add(b);
  const nav = new NavGraph(c, bounds, n.nav, phys);
  nav.bakeSync();
  return nav;
}

/** Follows the flow field from (x,y,z) to the target; returns the edge types taken, or null if it never arrives. */
function route(nav, from, to) {
  nav.setTarget(nav.nodeAt(to.x, to.z, to.y));
  let node = nav.nodeAt(from.x, from.z, from.y);
  const types = [];
  for (let i = 0; i < 2000 && node !== nav.target; i++) {
    const e = nav.nextEdge(node);
    if (e < 0) return null;
    types.push(nav.eType[e]); node = nav.eTo[e];
  }
  return node === nav.target ? types : null;
}

// Open ground: connected, walk only.
{
  const nav = world([]);
  const r = route(nav, { x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: 20 });
  assert.ok(r && r.every(t => t === EDGE.walk), 'open ground is walkable');
}

// Long wall with a gap: route detours through the gap instead of straight through.
{
  const nav = world([{ minX: -1, maxX: 1, minZ: -30, maxZ: 12, top: 30 }]);
  const r = route(nav, { x: -15, y: 0, z: 0 }, { x: 15, y: 0, z: 0 });
  assert.ok(r && r.every(t => t === EDGE.walk), 'goes around the wall');
  assert.ok(r.length > 20 / n.nav.cell, 'detour is longer than the straight line, hops=' + r.length);
}

// Tunnel: a roofed corridor through a block is used when it is the only way.
{
  const nav = world([
    { minX: -1, maxX: 1, minZ: -30, maxZ: 30, top: 30, bottom: 4 },        // roof slab above a 4 high opening
    { minX: -1, maxX: 1, minZ: -30, maxZ: -3, top: 30 },                    // solid wall south of the tunnel mouth
    { minX: -1, maxX: 1, minZ: 3, maxZ: 30, top: 30 },                      // solid wall north of it
  ]);
  const r = route(nav, { x: -15, y: 0, z: 0 }, { x: 15, y: 0, z: 0 });
  assert.ok(r, 'bot finds the way through the tunnel');
}

// Elevated target: a 6 high platform with no stairs is reached with a jump edge.
{
  const nav = world([{ minX: 8, maxX: 22, minZ: -8, maxZ: 8, top: 6 }]);
  const r = route(nav, { x: -15, y: 0, z: 0 }, { x: 15, y: 6, z: 0 });
  assert.ok(r, 'bot can reach the platform');
  assert.ok(r.includes(EDGE.jump), 'path uses a jump');
  const back = route(nav, { x: 15, y: 6, z: 0 }, { x: -15, y: 0, z: 0 });
  assert.ok(back && back.includes(EDGE.drop), 'bot drops down from the platform');
}

// Too high to jump: unreachable, so the bot falls back to direct chase (cost Infinity).
{
  const nav = world([{ minX: 8, maxX: 22, minZ: -8, maxZ: 8, top: 25 }]);
  nav.setTarget(nav.nodeAt(15, 0, 25));
  assert.equal(nav.costFrom(nav.nodeAt(-15, 0, 0)), Infinity, 'unreachable ledge is reported as unreachable');
}

console.log('nav tests passed');
