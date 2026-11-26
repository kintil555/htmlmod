# Html — Sandbox

Three.js (r187) sandbox game, GMod-style. Spawn nextbots and props, survive.

## Run
ES modules need an HTTP server (not `file://`):

    python3 -m http.server 8080      # then open http://localhost:8080
    # or: npx serve .

Use desktop Chrome/Edge/Firefox. Renders with WebGPU (automatic WebGL2 fallback). Sun effects (god rays, lens flare, glow) toggle in Settings. Pointer lock requires a click on Play.

## Controls
WASD move, Shift sprint, Space jump (sprint at a wall, jump, then tap Space again at the wall to wall-jump: aim with WASD/look to kick sideways or across, push into the wall to climb it), mouse look, in water Space swims up, C dives and W/S swim where you look, hold/tap Q spawn menu, R remove aimed object, Esc pause.

## Touch
Phones and tablets get on-screen controls automatically: a floating stick on the left (push it all the way to sprint), drag on the right to look, round Jump / Dive buttons at the bottom right, Spawn / Remove / Pause at the top right. `?touch=1` forces them on a desktop (for testing), `?touch=0` turns them off. Tunables: `CONFIG.touch`.

## Performance (phones)
Settings → Graphics: **Quality** (Auto picks Low on touch devices; applies after a reload), **Render scale** (live) and **Lower resolution automatically when slow** (drops the scale step by step while fps stays under 40, never raises it). Low turns off GTAO and sun effects and shrinks shadow maps, mirror and water reflections, and caps the canvas at 1x CSS pixels. Presets: `CONFIG.quality`.

## Tuning
Player speed is in `src/config.js` (walk 14, sprint 21, jump 14.5). Nextbot jump/AI tunables are in `CONFIG.nextbot` (pathfinding in `CONFIG.nextbot.nav`; the graph is baked from any map automatically). Nextbot speed/turning/slide are per bot in `src/content/nextbots.js`.

## Map
GM Construct, baked from the Sketchfab model Gm_construct by CHANO (CC BY 4.0, see `assets/maps/gm_construct/LICENSE.txt`). Regenerate with `tools/bake_map.py`.

## Mods
Main menu → Mods: install `.zip` mods (HTML/JS), toggle or remove them, download the SDK and a starter template. Start without mods with `?nomods`. Authoring guide: `sdk/README.md`.

## Multiplayer
Play → Multiplayer → Host gives an invite code and a link (also in the pause menu); Join takes the code or the link (`?join=CODE`). Peer to peer over WebRTC, host-authoritative world (nextbots, props). Host and guests must have identical mods enabled. Player model: "MALE 07 (garry's mod) rig" by Tung tung tung sahur, CC BY 4.0 (`assets/players/male07/license.txt`).

The signalling server (Cloudflare Worker + Durable Object) is in `worker/`: deploy it once (see `worker/README.md`) and set `CONFIG.net.signalUrl`, or open the game with `?signal=wss://your-worker`.

Bot protection: optional Cloudflare Turnstile "I'm not a robot" check before host / join (`CONFIG.net.turnstileSiteKey` + `TURNSTILE_SECRET` on the worker, see `worker/README.md`), per-IP and per-socket rate limits on the worker, and host-side limits on every guest (packet size and rate, spawn rate and reach, state sanity checks, kick on flooding): `CONFIG.net`.

## Extending
See `docs/AGENTS.md`.
