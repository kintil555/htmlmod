import { CONFIG } from '../config.js';

/**
 * Shoreline swash maths (pure data, `node test/water.test.mjs`). Mirrors the node versions in Water.js, so the CPU surface (swimming, floating bodies)
 * equals the lifted mesh. `d` = baked signed depth: water depth, negative on the bank (how far the ground is above the still surface).
 * A swell whose phase runs with `d` travels up the slope: fast uprush, slow backwash, drawdown below the still level. See CONFIG.water.shore.
 */
const W = CONFIG.water;
const SH = W.shore;

export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Open-water wave amplitude factor by depth: shrinks in the shallows (keeps `shoreKeep` at the waterline) and dies out over the bank. */
export const waveFade = d => (W.waves.shoreKeep + (1 - W.waves.shoreKeep) * smooth(0, W.waves.shoreFade, d)) * smooth(-W.waves.bankFade, 0.05, d);

/** Swash cycle position 0..1 at world (x, z), signed depth d, time t. Higher ground (smaller d) is reached later: crests move shoreward. */
export function swashPhase(x, z, d, t) {
  let psi = t / SH.period + d * SH.phasePerDepth;
  for (const [kx, kz, c] of SH.wobble) psi += Math.sin(x * kx + z * kz) * c;
  return psi - Math.floor(psi);
}

/** Cycle profile 0..1: rises over `rise` of the cycle (uprush), falls over the rest (backwash), mean 0.5. */
export const swashBump = u => smooth(0, SH.rise, u) * (1 - smooth(SH.rise, 1, u));

/** Where the swell lives: the shallows and the bank up to `reach`; none in open water or high on the bank. */
export const swashEnv = d => (1 - smooth(SH.shallowStart, SH.shallowEnd, d)) * (1 - smooth(0, SH.reach, -d));

/** Surface lift (world units, above the still level) from the swash at (x, z, d, t). */
export const swashLift = (x, z, d, t) => SH.height * swashEnv(d) * (swashBump(swashPhase(x, z, d, t)) * (1 + SH.draw) - SH.draw);
