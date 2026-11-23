import { SpawnTabRegistry, NextbotRegistry, PropRegistry } from '../core/registries.js';

/**
 * Spawn menu tabs. A tab = { id, label, order, items(): [{id,name,image?|swatch?}], spawn(itemId, point, game) }.
 */
SpawnTabRegistry.register({
  id: 'nextbots', label: 'Nextbots', order: 1,
  items: () => NextbotRegistry.all().map(d => ({ id: d.id, name: d.name, image: d.texture })),
  spawn: (itemId, point, game) => game.spawnNextbot(itemId, point),
});
SpawnTabRegistry.register({
  id: 'props', label: 'Props', order: 2,
  items: () => PropRegistry.all().map(d => ({ id: d.id, name: d.name, swatch: d.color })),
  spawn: (itemId, point, game) => game.spawnProp(itemId, point),
});
