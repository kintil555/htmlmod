import { NextbotRegistry } from '../core/registries.js';

/**
 * Add a nextbot: drop a PNG in assets/nextbots/ and add ONE entry here.
 * height  = world units tall (player is 1.8)
 * speed   = top speed (player walks 10, sprints 15)
 * turnRate= rad/s heading change (lower = easier to juke)
 * grip    = velocity follows heading (lower = more sliding)
 */
const T = id => `assets/nextbots/${id}.png`;
const defs = [
  { id: 'obunga',     name: 'Obunga',           height: 3.4, speed: 10.5, turnRate: 2.6, grip: 3.0 },
  { id: 'selene',     name: 'Selene',           height: 3.6, speed: 9.5,  turnRate: 3.0, grip: 3.5 },
  { id: 'nailong',    name: 'Nailong',          height: 3.8, speed: 10.0, turnRate: 2.4, grip: 2.8 },
  { id: 'dayun',      name: 'Dayun',            height: 2.6, speed: 11.0, turnRate: 2.0, grip: 2.4 },
  { id: 'dream',      name: 'Dream',            height: 3.4, speed: 9.0,  turnRate: 3.4, grip: 4.0 },
  { id: 'yoshie',     name: 'Yoshie',           height: 3.0, speed: 9.8,  turnRate: 2.8, grip: 3.0 },
  { id: 'munci',      name: 'Munci',            height: 3.0, speed: 10.0, turnRate: 2.8, grip: 3.0 },
  { id: 'supermunci', name: 'Super Munci',      height: 3.4, speed: 12.0, turnRate: 2.2, grip: 2.2 },
  { id: 'lanlao',     name: 'Lanlao',           height: 3.6, speed: 9.2,  turnRate: 3.2, grip: 3.6 },
  { id: 'fries',      name: "McDonald's Fries", height: 3.2, speed: 10.2, turnRate: 2.5, grip: 2.8 },
];
defs.forEach((d, i) => NextbotRegistry.register({ ...d, texture: T(d.id), order: i }));
