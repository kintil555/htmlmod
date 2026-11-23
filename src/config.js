/** Single source of truth for tunables. Change numbers here, never inline them elsewhere. */
export const CONFIG = {
  player: {
    walkSpeed: 10,
    sprintSpeed: 15,
    jumpSpeed: 9.5,
    gravity: 26,
    radius: 0.4,
    eyeHeight: 1.7,
    accel: 70,
    airControl: 0.35,
    lookSensitivity: 0.0022,
    fov: 75,
    sprintFov: 82,
    spawn: { x: 0, z: 14, yaw: 0 },
  },
  world: {
    halfSize: 120,
    fogColor: 0x9aa0a6,
    fogDensity: 0.012,
    clearSpawnRadius: 16,
    seed: 1337,
  },
  limits: { maxNextbots: 30, maxProps: 80 },
  catchState: { respawnDelay: 1.6, invulnerable: 2.0, pushRadius: 14 },
  spawnMenu: { stickyMs: 250 },
};
