import { MapRegistry } from '../core/registries.js';

/**
 * Add a map: bake it with tools/bake_map.py into assets/maps/<id>/ and add ONE entry here.
 * url       = folder holding map.json, map.bin and textures/
 * eyeHeight = player eye height in the baked map's own units. Source uses 64 units and the bake uses
 *             1 unit = 100 Source units, so 0.64. The map is scaled at load so this becomes CONFIG.player.eyeHeight.
 * spawn     = player start in the baked map's units (y up, yaw in radians). Pick open, level ground.
 */
MapRegistry.register({
  id: 'gm_construct',
  name: 'GM Construct',
  url: 'assets/maps/gm_construct/',
  eyeHeight: 0.64,
  spawn: { x: 1.5, y: 0, z: 0, yaw: 0 },
});
