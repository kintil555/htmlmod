import { el } from './ui.js';
import { STR } from '../content/strings.js';

const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  constructor() {
    this.stats = el('div', { class: 'hud__stats' });
    this.flash = el('div', { class: 'hud__flash' });
    this.caught = el('div', { class: 'hud__caught' });
    this.root = el('div', { class: 'hud' },
      this.flash,
      el('div', { class: 'hud__cross' }),
      this.stats,
      this.caught,
      el('div', { class: 'hud__hints', text: STR.hud.hints }));
  }
  show() { this.root.classList.add('is-on'); }
  hide() { this.root.classList.remove('is-on'); this.hideCaught(); }
  update({ caught, survived, nextbots, props, players = 0 }) {
    const row = (k, v) => el('div', { class: 'hud__row' }, el('span', { text: k }), el('b', { text: String(v) }));
    this.stats.replaceChildren(...[
      row(STR.hud.caught, caught), row(STR.hud.survived, fmt(survived)),
      row(STR.hud.nextbots, nextbots), row(STR.hud.props, props),
      players > 0 ? row(STR.hud.players, players) : null].filter(Boolean));
  }
  showCaught(name) {
    this.caught.textContent = STR.hud.caughtBy(name);
    this.caught.classList.add('is-on');
    this.flash.classList.add('is-on');
  }
  hideCaught() { this.caught.classList.remove('is-on'); this.flash.classList.remove('is-on'); }
}
