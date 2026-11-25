import { DurableObject } from 'cloudflare:workers';

/**
 * Signalling for htmlmod multiplayer. Gameplay data never passes through here: it flows peer to peer over WebRTC.
 * One Durable Object per invite code ("Room") pairs the host with each guest by relaying offer / answer / ICE messages.
 *
 *   GET /host            (WebSocket)  create a room; first message { t:'hello', id:'host', role:'host', code }
 *   GET /join?code=ABC123 (WebSocket) join it;       first message { t:'hello', id, role:'guest', code } or { t:'error', reason }
 *
 * Messages: client -> { t:'signal', to, data } ; server -> { t:'signal', from, data }, { t:'peer-join', id }, { t:'peer-left', id }.
 * Guests can only talk to the host. When the host's socket closes the room is closed.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const HOST_ATTEMPTS = 8;
const MAX_GUESTS = 15;
const MAX_MESSAGE_BYTES = 16 * 1024;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

/** Browsers always send Origin on a WebSocket handshake, so a request without one is a script: refused. (A script can still fake the header; the rate limit below is the real guard.) */
function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try { const h = new URL(origin).hostname; return h === 'localhost' || h === '127.0.0.1'; } catch { return false; }
}

/** Per-IP cap on room creation and join attempts (also slows invite-code guessing). Skipped when the RATE binding is absent. */
async function rateLimited(request, env) {
  if (!env.RATE) return false;
  const { success } = await env.RATE.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
  return !success;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('htmlmod signalling server', { status: 200 });
    if (!originAllowed(request, env)) return new Response('forbidden', { status: 403 });
    if (await rateLimited(request, env)) return new Response('too many requests', { status: 429 });

    if (url.pathname === '/host') {
      for (let i = 0; i < HOST_ATTEMPTS; i++) {
        const code = randomCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await room.fetch(new Request(`https://room/host?code=${code}`, request));
        if (res.status !== 409) return res;
      }
      return new Response('no free code', { status: 503 });
    }
    if (url.pathname === '/join') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      const room = env.ROOMS.get(env.ROOMS.idFromName(CODE_PATTERN.test(code) ? code : 'INVALID'));
      return room.fetch(new Request(`https://room/join?code=${code}`, request));
    }
    return new Response('not found', { status: 404 });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  _host() { return this.ctx.getWebSockets().find(ws => ws.deserializeAttachment()?.role === 'host'); }

  _byId(id) { return this.ctx.getWebSockets().find(ws => ws.deserializeAttachment()?.id === id); }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.pathname === '/host' ? 'host' : 'guest';
    const host = this._host();
    if (role === 'host' && host) return new Response('code in use', { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const reject = reason => { server.send(JSON.stringify({ t: 'error', reason })); server.close(1008, reason); };
    if (role === 'guest' && (!host || !CODE_PATTERN.test(url.searchParams.get('code') ?? ''))) reject('no-room');
    else if (role === 'guest' && this.ctx.getWebSockets().length - 2 >= MAX_GUESTS) reject('full');
    else {
      const id = role === 'host' ? 'host' : crypto.randomUUID().slice(0, 8);
      server.serializeAttachment({ role, id });
      server.send(JSON.stringify({ t: 'hello', id, role, code: url.searchParams.get('code') }));
      if (role === 'guest') host.send(JSON.stringify({ t: 'peer-join', id }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const me = ws.deserializeAttachment();
    if (!me || typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return;
    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (m?.t !== 'signal' || typeof m.to !== 'string') return;
    // A guest may only reach the host; the host may reach any guest.
    const target = me.role === 'guest' ? this._host() : this._byId(m.to);
    if (!target || target === ws) return;
    target.send(JSON.stringify({ t: 'signal', from: me.id, data: m.data }));
  }

  webSocketClose(ws) { this._left(ws); }

  webSocketError(ws) { this._left(ws); }

  _left(ws) {
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (me.role === 'host') {
      for (const other of this.ctx.getWebSockets()) if (other !== ws) { try { other.close(1001, 'host left'); } catch { /* closed */ } }
    } else {
      this._host()?.send(JSON.stringify({ t: 'peer-left', id: me.id }));
    }
  }
}
