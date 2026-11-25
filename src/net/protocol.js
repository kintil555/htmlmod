import { CONFIG } from '../config.js';

/** Wire message types. Every message is JSON: { t, ... }. Reliable channel ('ctl') and unreliable channel ('state'). */
export const T = {
  HELLO: 'hello',         // guest -> host: { name, proto, mods }
  WELCOME: 'welcome',     // host -> guest: { id, players, started, snapshot }
  REJECT: 'reject',       // host -> guest: { reason, detail }
  JOIN: 'join',           // host -> guests: { id, name }
  LEAVE: 'leave',         // host -> guests: { id }
  START: 'start',         // host -> guests: the host pressed Start
  SPAWN_REQ: 'spawn-req', // guest -> host: { kind, def, x, y, z }
  SPAWNED: 'spawned',     // host -> guests: { nid, kind, def, x, y, z }
  REMOVE_REQ: 'remove-req', // guest -> host: { nid }
  REMOVED: 'removed',     // host -> guests: { nid }
  CLEAR_REQ: 'clear-req', // guest -> host
  STATE: 'ps',            // guest -> host (state channel): { s: [x, y, z, yaw, pitch, flags] }
  SNAP: 'snap',           // host -> guests (state channel): { p: [[id, ...state]], b: [[nid, x, y, z]] }
};

/** Bits of the state packet's flags field. */
export const FLAG = { ground: 1, sprint: 2, dead: 4 };

export const encode = msg => JSON.stringify(msg);

/** Parses a message; null for anything that is not a JSON object with a string `t`. */
export function decode(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch { return null; }
}

/** Display name: control characters and angle brackets removed, trimmed, length-capped. */
export function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, CONFIG.net.nameMax);
  return n || fallback;
}

export const round2 = n => Math.round(n * 100) / 100;

/** Invite code from what the player typed or pasted: the bare code, or any link carrying ?join=CODE. Null if invalid. */
export function parseInvite(text) {
  const N = CONFIG.net;
  let raw = String(text ?? '').trim();
  const m = raw.match(new RegExp(`[?&]${N.joinParam}=([^&#\\s]+)`));
  if (m) raw = m[1];
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${N.codeAlphabet}]{${N.codeLength}}$`).test(code) ? code : null;
}

/** Shareable link: this page with ?join=CODE. */
export function inviteLink(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(CONFIG.net.joinParam, code);
  return url.toString();
}
