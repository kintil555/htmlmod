/**
 * Mod parity check. A signature is the list of enabled, running mods: [{ id, version, size, hash }] (see Mods.signature()).
 * Both sides must run exactly the same mods, so the host compares its own list with the one a guest sends.
 */
const clean = list => (Array.isArray(list) ? list : [])
  .filter(m => m && typeof m.id === 'string')
  .map(m => ({ id: m.id, version: String(m.version ?? ''), size: Number(m.size) || 0, hash: String(m.hash ?? '') }));

/**
 * Differences from the guest's point of view.
 * missing: the host has it, the guest does not. extra: the guest has it, the host does not.
 * mismatch: same id, different build (version, size or hash).
 */
export function diffMods(hostList, guestList) {
  const host = new Map(clean(hostList).map(m => [m.id, m]));
  const guest = new Map(clean(guestList).map(m => [m.id, m]));
  const missing = []; const extra = []; const mismatch = [];
  for (const [id, h] of host) {
    const g = guest.get(id);
    if (!g) missing.push(id);
    else if (g.version !== h.version || g.size !== h.size || g.hash !== h.hash) mismatch.push(id);
  }
  for (const id of guest.keys()) if (!host.has(id)) extra.push(id);
  return { missing, extra, mismatch };
}

export const sameMods = d => !d.missing.length && !d.extra.length && !d.mismatch.length;
