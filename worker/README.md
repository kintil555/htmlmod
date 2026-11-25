# htmlmod signalling (Cloudflare Worker + Durable Object)

Multiplayer is peer to peer (WebRTC). This Worker only introduces players to each other: one Durable Object per invite code relays offers, answers and ICE candidates between the host and each guest. No gameplay data passes through it.

## Deploy
    cd worker
    npx wrangler deploy

Or push to `main`: `.github/workflows/worker.yml` deploys it when the repo has the secrets `CLOUDFLARE_API_TOKEN` (Workers edit permission) and `CLOUDFLARE_ACCOUNT_ID`.

Wrangler prints the URL, for example `https://htmlmod-signal.<your-subdomain>.workers.dev`. The game connects to the same address with `wss://`:

- Put it in `CONFIG.net.signalUrl` (`src/config.js`), or
- open the game once with `?signal=wss://htmlmod-signal.<your-subdomain>.workers.dev` (remembered in the browser).

`ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to connect (`localhost` is always allowed; requests without an Origin header are refused). Add your own domain there. A per-IP rate limit (`RATE`, 20 connections per minute) guards against room spam and invite-code guessing.

## Protocol
- `GET /host` (WebSocket): creates a room. First message `{ t:'hello', id:'host', role:'host', code }`.
- `GET /join?code=ABC123` (WebSocket): first message `{ t:'hello', id, role:'guest', code }`, or `{ t:'error', reason:'no-room' | 'full' }`.
- Client sends `{ t:'signal', to, data }`; the server forwards `{ t:'signal', from, data }`. The host also gets `{ t:'peer-join', id }` and `{ t:'peer-left', id }`.
- `ping` is answered with `pong` (keep-alive). When the host disconnects the room is closed.

Players behind strict NATs may need a TURN server: add it to `CONFIG.net.iceServers`.
