import { PropRegistry } from '../core/registries.js';

/** Add a prop: one entry. size = [width(x), height(y), depth(z)], axis-aligned. */
const defs = [
  { id: 'crate',    name: 'Crate',        size: [1.6, 1.4, 1.6], color: '#9a9fa5' },
  { id: 'barrier',  name: 'Barrier',      size: [3, 1.1, 0.6],   color: '#b0b4b9' },
  { id: 'platform', name: 'Platform',     size: [4, 1, 4],       color: '#8e9399' },
  { id: 'pillar',   name: 'Pillar',       size: [1, 4.5, 1],     color: '#80858b' },
  { id: 'wall-x',   name: 'Wall',         size: [7, 2.8, 0.7],   color: '#a3a8ad' },
  { id: 'wall-z',   name: 'Wall (turned)', size: [0.7, 2.8, 7],  color: '#a3a8ad' },
  { id: 'block',    name: 'Big Block',    size: [5, 3, 5],       color: '#767b81' },
];
defs.forEach((d, i) => PropRegistry.register({ ...d, order: i }));
