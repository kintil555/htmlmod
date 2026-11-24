# Html — Sandbox

Three.js (r187) sandbox game, GMod-style. Spawn nextbots and props, survive.

## Run
ES modules need an HTTP server (not `file://`):

    python3 -m http.server 8080      # then open http://localhost:8080
    # or: npx serve .

Use desktop Chrome/Edge/Firefox. Pointer lock requires a click on Play.

## Controls
WASD move, Shift sprint, Space jump (sprint at a wall, jump, then tap Space again at the wall to wall-jump: aim with WASD/look to kick sideways or across, push into the wall to climb it), mouse look, hold/tap Q spawn menu, R remove aimed object, Esc pause.

## Tuning
Player speed is in `src/config.js` (walk 14, sprint 21, jump 14.5). Nextbot jump/AI tunables are in `CONFIG.nextbot` (pathfinding in `CONFIG.nextbot.nav`; the graph is baked from any map automatically). Nextbot speed/turning/slide are per bot in `src/content/nextbots.js`.

## Map
GM Construct, baked from the Sketchfab model Gm_construct by CHANO (CC BY 4.0, see `assets/maps/gm_construct/LICENSE.txt`). Regenerate with `tools/bake_map.py`.

## Extending
See `docs/AGENTS.md`.
