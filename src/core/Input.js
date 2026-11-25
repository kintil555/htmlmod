import { Events } from './Events.js';
import { CONFIG } from '../config.js';

/** True on phones / tablets (coarse primary pointer). ?touch=1 or ?touch=0 overrides. */
export function detectTouch() {
  const forced = new URLSearchParams(location.search).get(CONFIG.touch.param);
  if (forced === '1') return true;
  if (forced === '0') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

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
  /** Presses or releases a key from code (on-screen controls). Emits the same keydown / keyup events as the keyboard. */
  setKey(code, down) {
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      this.events.emit('keydown', { code, repeat: false });
    } else if (this.keys.delete(code)) {
      this.events.emit('keyup', { code, repeat: false });
    }
  }
  /** Adds camera movement in px (touch look). */
  addLook(dx, dy) { this._dx += dx; this._dy += dy; }
  consumeLook() {
    const r = { dx: this._dx, dy: this._dy };
    this._dx = 0; this._dy = 0;
    return r;
  }
}
