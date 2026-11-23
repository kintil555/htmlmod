import { Events } from './Events.js';

/** Keyboard + mouse-look state. Emits 'keydown' / 'keyup' with {code, repeat}. */
export class Input {
  constructor() {
    this.events = new Events();
    this.keys = new Set();
    this.locked = false;
    this._dx = 0;
    this._dy = 0;
  }
  attach() {
    window.addEventListener('keydown', e => {
      if (this.locked && (e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
      }
      this.events.emit('keydown', { code: e.code, repeat: e.repeat });
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      this.events.emit('keyup', { code: e.code, repeat: false });
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this._dx += e.movementX;
      this._dy += e.movementY;
    });
  }
  isDown(code) { return this.keys.has(code); }
  consumeLook() {
    const r = { dx: this._dx, dy: this._dy };
    this._dx = 0; this._dy = 0;
    return r;
  }
}
