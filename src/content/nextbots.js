import { NextbotRegistry } from '../core/registries.js';

/**
 * Add a nextbot: drop a PNG in assets/nextbots/ and add ONE entry here.
 * height  = world units tall (player is 1.8)
 * speed   = top speed (player walks 14, sprints 21)
 * turnRate= rad/s heading change (lower = easier to juke)
 * accel   = units/s^2 speeding up toward top speed (lower = slower to get going)
 * decel   = units/s^2 braking when the bot must reverse or turn hard (lower = overshoots more)
 */
const T = id => `assets/nextbots/${id}.png`;
const defs = [
  { id: 'obunga',     name: 'Obunga',           height: 3.4, speed: 14.7, turnRate: 2.6, accel: 26, decel: 32 },
  { id: 'selene',     name: 'Selene',           height: 3.6, speed: 13.3, turnRate: 3.0, accel: 28, decel: 35 },
  { id: 'nailong',    name: 'Nailong',          height: 3.8, speed: 14.0, turnRate: 2.4, accel: 24, decel: 30 },
  { id: 'dayun',      name: 'Dayun',            height: 2.6, speed: 15.4, turnRate: 2.0, accel: 22, decel: 28 },
  { id: 'dream',      name: 'Dream',            height: 3.4, speed: 12.6, turnRate: 3.4, accel: 30, decel: 38 },
  { id: 'yoshie',     name: 'Yoshie',           height: 3.0, speed: 13.7, turnRate: 2.8, accel: 25, decel: 31 },
  { id: 'munci',      name: 'Munci',            height: 3.0, speed: 14.0, turnRate: 2.8, accel: 25, decel: 31 },
  { id: 'supermunci', name: 'Super Munci',      height: 3.4, speed: 16.8, turnRate: 2.2, accel: 22, decel: 28 },
  { id: 'lanlao',     name: 'Lanlao',           height: 3.6, speed: 12.9, turnRate: 3.2, accel: 28, decel: 35 },
  { id: 'fries',      name: "McDonald's Fries", height: 3.2, speed: 14.3, turnRate: 2.5, accel: 24, decel: 30 },
];
defs.forEach((d, i) => NextbotRegistry.register({ ...d, texture: T(d.id), order: i }));
