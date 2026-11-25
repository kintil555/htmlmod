import { CONFIG } from '../config.js';
import { STR } from '../content/strings.js';
import { Events } from '../core/Events.js';
import { Mods } from '../mods/Mods.js';
import { T, encode, decode, cleanName, inviteLink, RateLimiter } from './protocol.js';
import { solveCaptcha } from './captcha.js';
import { diffMods, sameMods } from './modsync.js';

const N = CONFIG.net;

/** Failure with a STR.net.err key (+ optional detail) so the UI can show a translated message. */
export class NetError extends Error {
  constructor(key, arg) { super(key); this.key = key; this.arg = arg; }
}

/** Human readable text for a NetError (or anything thrown). */
export function describeNetError(err) {
  if (err instanceof NetError) {
    const m = STR.net.err[err.key];
    return typeof m === 'function' ? m(err.arg) : m ?? err.key;
  }
  return err?.message ?? String(err);
}

/** Signalling server: ?signal=wss://host wins and is remembered, then the remembered value, then CONFIG.net.signalUrl. */
export function signalUrl() {
  let url = new URLSearchParams(location.search).get(N.signalParam);
  try {
    if (url) localStorage.setItem(N.signalStorage, url); else url = localStorage.getItem(N.signalStorage);
  } catch { /* storage unavailable */ }
  url = (url || N.signalUrl).replace(/^http/, 'ws').replace(/\/+$/, '');
  return url;
}

/**
 * Multiplayer session: one host, up to maxPlayers-1 guests, star topology over WebRTC data channels.
 * The Durable Object (worker/) only relays offers/answers/ICE between the host and a guest, keyed by the invite code.
 * Per peer: 'ctl' (reliable, ordered: lobby, spawns, removals) and 'state' (unordered, no retransmit: positions).
 * Events: 'players' (list changed), 'start' (host pressed Start), 'msg' {from, msg} (reliable game message),
 * 'state' {from, msg} (state packet), 'closed' {reason} (session ended without leave()), 'signal' {up} (host invite code on/off).
 */
class NetSession {
  constructor() {
    this.events = new Events();
    /** Host only: () => snapshot object sent to every new guest inside `welcome`. */
    this.snapshotProvider = null;
    this._reset();
  }

  _reset() {
    this.role = null;
    this.code = null;
    this.selfId = null;
    this.started = false;
    /** id -> { id, name } for everyone in the session, including this client. */
    this.players = new Map();
    this.peers = new Map();
    this.sock = null;
    this._ping = null;
    this._joinWait = null;
    this._joinTimer = null;
  }

  get active() { return this.role !== null; }
  get isHost() { return this.role === 'host'; }
  get isGuest() { return this.role === 'guest'; }
  get link() { return this.code ? inviteLink(this.code) : ''; }
  get name() { return this.players.get(this.selfId)?.name ?? ''; }

  /* ---------------- host / join / leave ---------------- */

  /** Opens a room. Resolves with the invite code. */
  async host(name) {
    this.leave();
    const hello = await this._openSignal('/host', await this._humanToken());
    this.role = 'host';
    this.selfId = 'host';
    this.code = hello.code;
    this.players.set('host', { id: 'host', name: cleanName(name, STR.net.unnamed) });
    this.events.emit('players');
    return this.code;
  }

  /** Joins a room by code. Resolves with the host's welcome message ({ id, players, started, snapshot }). Throws NetError. */
  async join(code, name) {
    this.leave();
    this._name = cleanName(name, STR.net.unnamed);
    this.role = 'guest';
    this.code = code;
    try {
      const hello = await this._openSignal(`/join?code=${encodeURIComponent(code)}`, await this._humanToken());
      this.selfId = hello.id;
      return await new Promise((resolve, reject) => {
        this._joinWait = { resolve, reject };
        this._joinTimer = setTimeout(() => reject(new NetError('timeout')), N.connectTimeoutMs);
      });
    } catch (err) {
      this.leave();
      throw err;
    }
  }

  /** "I'm not a robot" token for the signalling server (null when the check is off). Throws NetError('captcha'). */
  async _humanToken() {
    try { return await solveCaptcha(); } catch { throw new NetError('captcha'); }
  }

  /** Ends the session without emitting 'closed'. */
  leave() {
    const was = this.active;
    clearTimeout(this._joinTimer);
    this._joinWait = null;
    for (const peer of [...this.peers.values()]) this._closePeer(peer);
    this._closeSignal();
    this._reset();
    if (was) this.events.emit('players');
  }

  /** Ends the session because something broke: leave() + 'closed'. */
  _closed(reason) {
    if (!this.active) return;
    this.leave();
    this.events.emit('closed', { reason });
  }

  /** Host: tells everyone the game began. Guests that join later get `started` in their welcome. */
  markStarted() {
    this.started = true;
    this._broadcast({ t: T.START });
  }

  /* ---------------- sending ---------------- */

  /** Reliable message: a guest sends to the host, the host sends to every guest. */
  send(msg) {
    if (this.isGuest) { const h = this.peers.get('host'); if (h) this._raw(h, msg); } else this._broadcast(msg);
  }

  sendTo(id, msg) { const p = this.peers.get(id); if (p) this._raw(p, msg); }

  /** Unreliable state packet: guest -> host, host -> every guest. Dropped when a channel is backed up. */
  sendState(msg) {
    const data = encode(msg);
    for (const p of this.peers.values()) {
      if (!p.joined || p.state?.readyState !== 'open' || p.state.bufferedAmount > N.maxBuffered) continue;
      p.state.send(data);
    }
  }

  _raw(peer, msg) { if (peer.ctl?.readyState === 'open') peer.ctl.send(encode(msg)); }

  _broadcast(msg, except) {
    for (const p of this.peers.values()) if (p.joined && p.id !== except) this._raw(p, msg);
  }

  /* ---------------- signalling socket ---------------- */

  _openSignal(path, token = null) {
    return new Promise((resolve, reject) => {
      let ws;
      const query = token ? `${path.includes('?') ? '&' : '?'}ts=${encodeURIComponent(token)}` : '';
      try { ws = new WebSocket(`${signalUrl()}${path}${query}`); } catch { reject(new NetError('signal')); return; }
      let settled = false;
      const fail = key => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        reject(new NetError(key));
      };
      const timer = setTimeout(() => fail('timeout'), N.connectTimeoutMs);
      ws.onerror = () => fail('signal');
      ws.onclose = () => { if (settled) this._onSignalClose(ws); else fail('signal'); };
      ws.onmessage = ev => {
        const m = decode(ev.data, N.maxHostMsgChars);
        if (!m) return;
        if (settled) { this._onSignal(m); return; }
        if (m.t === 'hello') {
          settled = true;
          clearTimeout(timer);
          this.sock = ws;
          this._ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, N.signalPingMs);
          resolve(m);
        } else if (m.t === 'error') {
          fail(m.reason === 'no-room' ? 'noRoom' : m.reason === 'full' ? 'roomFull' : m.reason === 'captcha' ? 'captcha' : 'signal');
        }
      };
    });
  }

  _closeSignal() {
    clearInterval(this._ping);
    this._ping = null;
    const ws = this.sock;
    this.sock = null;
    if (!ws) return;
    ws.onclose = null; ws.onmessage = null; ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
  }

  _onSignalClose(ws) {
    if (ws !== this.sock) return;
    this.sock = null;
    clearInterval(this._ping);
    if (this.isHost) { this.code = null; this.events.emit('signal', { up: false }); }
    else if (this.isGuest && this._joinWait) this._joinWait.reject(new NetError('signal'));
  }

  _signal(to, data) {
    if (this.sock?.readyState === 1) this.sock.send(encode({ t: 'signal', to, data }));
  }

  _onSignal(m) {
    if (m.t === 'peer-join' && this.isHost && typeof m.id === 'string') this._offerTo(m.id);
    else if (m.t === 'peer-left' && this.isHost) { const p = this.peers.get(m.id); if (p && !p.joined) this._dropPeer(p.id); }
    else if (m.t === 'signal' && typeof m.from === 'string' && m.data) this._onRemoteSignal(m.from, m.data);
  }

  /* ---------------- WebRTC ---------------- */

  _makePeer(id) {
    const pc = new RTCPeerConnection({ iceServers: N.iceServers });
    const peer = { id, pc, ctl: null, state: null, joined: false, name: '', helloSeen: false, pendingIce: [], strikes: 0, ctlLimit: new RateLimiter(N.ctlRate, N.ctlBurst), stateLimit: new RateLimiter(N.stateRate, N.stateBurst), timer: setTimeout(() => this._dropPeer(id), N.connectTimeoutMs) };
    this.peers.set(id, peer);
    pc.onicecandidate = e => { if (e.candidate) this._signal(id, { ice: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this._dropPeer(id);
      else if (s === 'disconnected') setTimeout(() => { if (this.peers.get(id) === peer && pc.connectionState === 'disconnected') this._dropPeer(id); }, N.disconnectGraceMs);
    };
    return peer;
  }

  async _offerTo(id) {
    if (this.peers.has(id)) return;
    let pending = 0;
    for (const p of this.peers.values()) if (!p.joined) pending++;
    if (pending >= N.maxPending || this.peers.size >= N.maxPlayers * 2) return;
    const peer = this._makePeer(id);
    this._attachChannel(peer, peer.pc.createDataChannel('ctl'));
    this._attachChannel(peer, peer.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this._signal(id, { sdp: peer.pc.localDescription.toJSON() });
    } catch { this._dropPeer(id); }
  }

  async _onRemoteSignal(from, data) {
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (!peer) {
          if (!this.isGuest || from !== 'host') return;
          peer = this._makePeer(from);
          peer.pc.ondatachannel = e => this._attachChannel(peer, e.channel);
        }
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this._signal(from, { sdp: peer.pc.localDescription.toJSON() });
        }
      } else if (data.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice); else peer.pendingIce.push(data.ice);
      }
    } catch { if (peer) this._dropPeer(peer.id); }
  }

  _attachChannel(peer, ch) {
    if (ch.label === 'ctl') {
      peer.ctl = ch;
      ch.onopen = () => this._onCtlOpen(peer);
      ch.onmessage = e => this._onCtl(peer, e.data);
      ch.onclose = () => this._dropPeer(peer.id);
    } else if (ch.label === 'state') {
      peer.state = ch;
      ch.onmessage = e => {
        if (this.isHost && !this._allow(peer, peer.stateLimit)) return;
        const m = decode(e.data, this.isHost ? N.maxStateMsgChars : N.maxHostMsgChars);
        if (m && peer.joined) this.events.emit('state', { from: peer.id, msg: m });
      };
    }
  }

  /** Guest: the reliable channel is up, introduce ourselves (name + mods). */
  async _onCtlOpen(peer) {
    if (!this.isGuest) return;
    const mods = await Mods.signature();
    this._raw(peer, { t: T.HELLO, name: this._name, proto: N.protocol, mods });
  }

  /** Host: spends a token from a guest's bucket. Packets over the rate are dropped; a guest that keeps flooding is kicked. */
  _allow(peer, limiter) {
    if (limiter.allow()) return true;
    if (++peer.strikes > N.maxStrikes) this._dropPeer(peer.id);
    return false;
  }

  _onCtl(peer, raw) {
    if (this.isHost && !this._allow(peer, peer.ctlLimit)) return;
    const m = decode(raw, this.isHost ? N.maxGuestMsgChars : N.maxHostMsgChars);
    if (!m) { if (this.isHost) this._allow(peer, peer.ctlLimit); return; }
    if (this.isHost) {
      if (m.t === T.HELLO) { this._onHello(peer, m); return; }
      if (!peer.joined) return;
      this.events.emit('msg', { from: peer.id, msg: m });
      return;
    }
    if (m.t === T.WELCOME) this._onWelcome(peer, m);
    else if (m.t === T.REJECT) this._joinWait?.reject(new NetError(m.reason === 'mods' ? 'mods' : m.reason === 'full' ? 'full' : 'proto', m.detail));
    else if (!peer.joined) return;
    else if (m.t === T.JOIN && typeof m.id === 'string' && m.id.length <= 32 && this.players.size < N.maxPlayers) { this.players.set(m.id, { id: m.id, name: cleanName(m.name, STR.net.unnamed) }); this.events.emit('players'); }
    else if (m.t === T.LEAVE) { this.players.delete(m.id); this.events.emit('players'); }
    else if (m.t === T.START) { this.started = true; this.events.emit('start'); }
    else this.events.emit('msg', { from: peer.id, msg: m });
  }

  /** Host: validate a guest's hello (version, capacity, mods) and answer with welcome or reject. */
  async _onHello(peer, m) {
    if (peer.helloSeen) return;
    peer.helloSeen = true;
    const refuse = (reason, detail) => {
      this._raw(peer, { t: T.REJECT, reason, detail });
      setTimeout(() => this._dropPeer(peer.id), 500);
    };
    if (m.proto !== N.protocol) { refuse('proto', N.protocol); return; }
    if (this.players.size >= N.maxPlayers) { refuse('full'); return; }
    const diff = diffMods(await Mods.signature(), m.mods);
    if (this.peers.get(peer.id) !== peer) return;
    if (!sameMods(diff)) { refuse('mods', diff); return; }
    peer.name = cleanName(m.name, STR.net.unnamed);
    peer.joined = true;
    clearTimeout(peer.timer);
    this.players.set(peer.id, { id: peer.id, name: peer.name });
    this._raw(peer, { t: T.WELCOME, id: peer.id, players: [...this.players.values()], started: this.started, snapshot: this.snapshotProvider?.() ?? null });
    this._broadcast({ t: T.JOIN, id: peer.id, name: peer.name }, peer.id);
    this.events.emit('players');
  }

  /** Guest: accepted. The signalling socket is no longer needed. */
  _onWelcome(peer, m) {
    if (!this._joinWait) return;
    clearTimeout(this._joinTimer);
    peer.joined = true;
    clearTimeout(peer.timer);
    this.selfId = typeof m.id === 'string' ? m.id : this.selfId;
    this.started = !!m.started;
    this.players = new Map((Array.isArray(m.players) ? m.players : []).slice(0, N.maxPlayers)
      .filter(p => p && typeof p.id === 'string' && p.id.length <= 32)
      .map(p => [p.id, { id: p.id, name: cleanName(p.name, STR.net.unnamed) }]));
    this._closeSignal();
    const wait = this._joinWait;
    this._joinWait = null;
    this.events.emit('players');
    wait.resolve(m);
  }

  _closePeer(peer) {
    clearTimeout(peer.timer);
    for (const ch of [peer.ctl, peer.state]) if (ch) { ch.onclose = null; ch.onmessage = null; ch.onopen = null; try { ch.close(); } catch { /* closed */ } }
    peer.pc.onconnectionstatechange = null;
    peer.pc.onicecandidate = null;
    try { peer.pc.close(); } catch { /* closed */ }
    this.peers.delete(peer.id);
  }

  _dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this._closePeer(peer);
    if (this.isHost) {
      if (!peer.joined) return;
      this.players.delete(id);
      this._broadcast({ t: T.LEAVE, id });
      this.events.emit('players');
    } else if (this.isGuest) {
      if (this._joinWait) this._joinWait.reject(new NetError('lost'));
      else this._closed('hostLeft');
    }
  }
}

export const Net = new NetSession();
