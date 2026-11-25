import { el, Joystick, HoldButton, LookPad } from './ui.js';
import { STR } from '../content/strings.js';
import { CONFIG } from '../config.js';

/**
 * On-screen controls for touch devices, built from ui.js components. Everything goes through Input, so the game cannot tell
 * a thumb from a keyboard: the stick presses W A S D (and Shift when pushed all the way), the buttons press Space, C, Q, R.
 * Look = drag anywhere that is not a control. Pause calls onPause.
 */
export class TouchControls {
  constructor({ input, onPause }) {
    const T = CONFIG.touch;
    this.input = input;
    const press = code => () => input.setKey(code, true);
    const lift = code => () => input.setKey(code, false);
    const tap = code => () => { input.setKey(code, true); input.setKey(code, false); };

    this.look = LookPad({ scale: T.lookScale, onLook: (dx, dy) => input.addLook(dx, dy) });
    this.stick = Joystick({
      radius: T.stick.radius,
      onChange: ({ x, y, mag }) => {
        const d = T.stick.deadzone;
        input.setKey('KeyD', x > d);
        input.setKey('KeyA', x < -d);
        input.setKey('KeyS', y > d);
        input.setKey('KeyW', y < -d);
        input.setKey('ShiftLeft', mag >= T.stick.sprintAt);
      },
    });
    this.buttons = [
      HoldButton({ label: STR.touch.jump, className: 'touch__jump', onDown: press('Space'), onUp: lift('Space') }),
      HoldButton({ label: STR.touch.dive, className: 'touch__dive', onDown: press('KeyC'), onUp: lift('KeyC') }),
      HoldButton({ label: STR.touch.spawn, onDown: tap('KeyQ') }),
      HoldButton({ label: STR.touch.remove, onDown: tap('KeyR') }),
      HoldButton({ label: STR.touch.pause, onDown: onPause }),
    ];
    const [jump, dive, ...top] = this.buttons;
    this.root = el('div', { class: 'touch' }, this.look, this.stick, jump, dive, el('div', { class: 'touch__top' }, top));
  }

  get visible() { return this.root.classList.contains('is-on'); }

  show() { this.root.classList.add('is-on'); }

  /** Hides the controls and lets go of everything that is held. */
  hide() {
    this.root.classList.remove('is-on');
    this.stick.release();
    this.look.release();
    for (const b of this.buttons) b.release();
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyC']) this.input.setKey(code, false);
  }
}
