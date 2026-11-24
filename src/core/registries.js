import { Registry } from './Registry.js';
export const NextbotRegistry = new Registry('nextbot');
export const PropRegistry = new Registry('prop');
export const SpawnTabRegistry = new Registry('spawn-tab');
export const MapRegistry = new Registry('map');
/** Extra main/pause menu buttons: { id, label, order, where: 'main' | 'pause' | 'both', onClick() }. */
export const MenuButtonRegistry = new Registry('menu-button');
