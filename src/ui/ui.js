/**
 * UI component library (VGUI-style). ALL game UI is built from these. Styling lives in theme.css.
 * Do not create ad-hoc DOM/CSS elsewhere: add or extend a component here instead.
 */
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** Image-skinned button. size: 'md' | 'sm'. */
export function Button({ label, onClick, size = 'md', active = false }) {
  return el('button', { class: `ui-btn ui-btn--${size}${active ? ' is-active' : ''}`, type: 'button', onClick },
    el('span', { class: 'ui-btn__label', text: label }));
}

export function Panel({ title, body, footer, className = '' }) {
  return el('section', { class: `ui-panel ${className}`.trim() },
    title ? el('header', { class: 'ui-panel__head', text: title }) : null,
    el('div', { class: 'ui-panel__body' }, body),
    footer ? el('footer', { class: 'ui-panel__foot' }, footer) : null);
}

/** tabs: [{id,label,render:()=>Node}]. Returns {root, select(id), refresh(), activeId}. */
export function Tabs({ tabs, active }) {
  const bar = el('div', { class: 'ui-tabs__bar' });
  const content = el('div', { class: 'ui-tabs__content' });
  const root = el('div', { class: 'ui-tabs' }, bar, content);
  const api = {
    root,
    activeId: active ?? tabs[0]?.id,
    select(id) {
      api.activeId = id;
      bar.replaceChildren(...tabs.map(t => Button({ label: t.label, size: 'sm', active: t.id === id, onClick: () => api.select(t.id) })));
      const tab = tabs.find(t => t.id === id);
      content.replaceChildren(tab ? tab.render() : '');
    },
    refresh() { api.select(api.activeId); },
  };
  api.select(api.activeId);
  return api;
}

/** Grid item. Provide `image` (url) or `swatch` (css color). */
export function Card({ name, image, swatch, onClick }) {
  const thumb = image
    ? el('img', { class: 'ui-card__img', src: image, alt: name, draggable: 'false' })
    : el('div', { class: 'ui-card__swatch' });
  if (swatch) thumb.style.background = swatch;
  return el('button', { class: 'ui-card', type: 'button', onClick },
    el('div', { class: 'ui-card__thumb' }, thumb),
    el('span', { class: 'ui-card__name', text: name }));
}

/** Single-line text field. onInput(value) on every edit, onEnter(value) on Enter. Returns the <input>. */
export function TextInput({ value = '', placeholder = '', maxLength = 64, onInput, onEnter }) {
  const i = el('input', { type: 'text', class: 'ui-input', placeholder, maxlength: String(maxLength), spellcheck: 'false', autocomplete: 'off' });
  i.value = value;
  if (onInput) i.addEventListener('input', () => onInput(i.value));
  if (onEnter) i.addEventListener('keydown', e => { if (e.key === 'Enter') onEnter(i.value); });
  return i;
}

/** Label, a selectable value and a Copy button. root.set(text) changes the value; onCopy(text) runs on click. */
export function CodeBox({ label, copyLabel, onCopy }) {
  const value = el('output', { class: 'ui-code__value' });
  const root = el('div', { class: 'ui-code' },
    el('span', { class: 'ui-code__label', text: label }),
    value,
    Button({ label: copyLabel, size: 'sm', onClick: () => onCopy(value.textContent) }));
  root.set = text => { value.textContent = text; };
  return root;
}

/**
 * Floating virtual stick over its zone: appears where the thumb lands. onChange({ x, y, mag }) with x right and y down
 * in -1..1 and mag 0..1; all zero on release. root.release() lets go (used when the controls hide).
 */
export function Joystick({ radius, onChange }) {
  const knob = el('div', { class: 'ui-stick__knob' });
  const base = el('div', { class: 'ui-stick__base' }, knob);
  const root = el('div', { class: 'ui-stick' }, base);
  root.style.setProperty('--stick-r', `${radius}px`);
  let id = null; let ox = 0; let oy = 0;
  const move = (cx, cy) => {
    let dx = cx - ox; let dy = cy - oy;
    const d = Math.hypot(dx, dy);
    if (d > radius) { dx *= radius / d; dy *= radius / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange({ x: dx / radius, y: dy / radius, mag: Math.min(1, d / radius) });
  };
  const release = () => {
    if (id === null) return;
    try { root.releasePointerCapture(id); } catch { /* already released */ }
    id = null;
    root.classList.remove('is-active');
    knob.style.transform = '';
    base.style.left = ''; base.style.top = '';
    onChange({ x: 0, y: 0, mag: 0 });
  };
  root.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId;
    root.setPointerCapture(id);
    const r = root.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    base.style.left = `${ox - r.left}px`; base.style.top = `${oy - r.top}px`;
    root.classList.add('is-active');
    move(ox, oy);
    e.preventDefault();
  });
  root.addEventListener('pointermove', e => { if (e.pointerId === id) move(e.clientX, e.clientY); });
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, e => { if (e.pointerId === id) release(); });
  root.release = release;
  return root;
}

/** Round on-screen button. onDown() when pressed, onUp() when let go. root.release() lets go. */
export function HoldButton({ label, onDown, onUp, className = '' }) {
  const b = el('button', { class: `ui-hold ${className}`.trim(), type: 'button' }, el('span', { text: label }));
  let id = null;
  const release = () => {
    if (id === null) return;
    try { b.releasePointerCapture(id); } catch { /* already released */ }
    id = null;
    b.classList.remove('is-pressed');
    onUp?.();
  };
  b.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId;
    b.setPointerCapture(id);
    b.classList.add('is-pressed');
    onDown?.();
    e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel']) b.addEventListener(type, e => { if (e.pointerId === id) release(); });
  b.release = release;
  return b;
}

/** Full-area drag surface: onLook(dx, dy) in px (times `scale`) while a finger moves over it. */
export function LookPad({ onLook, scale = 1 }) {
  const root = el('div', { class: 'ui-look' });
  let id = null; let lx = 0; let ly = 0;
  root.addEventListener('pointerdown', e => {
    if (id !== null) return;
    id = e.pointerId; lx = e.clientX; ly = e.clientY;
    root.setPointerCapture(id);
    e.preventDefault();
  });
  root.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    onLook((e.clientX - lx) * scale, (e.clientY - ly) * scale);
    lx = e.clientX; ly = e.clientY;
  });
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, e => { if (e.pointerId === id) id = null; });
  root.release = () => { id = null; };
  return root;
}

export function SettingControl(def, value, onChange) {
  const row = el('label', { class: 'ui-setting' }, el('span', { class: 'ui-setting__label', text: def.label }));
  if (def.type === 'toggle') {
    const i = el('input', { type: 'checkbox', class: 'ui-toggle' });
    i.checked = !!value;
    i.addEventListener('change', () => onChange(i.checked));
    row.append(i);
  } else if (def.type === 'slider') {
    const out = el('span', { class: 'ui-setting__value', text: String(value) });
    const i = el('input', { type: 'range', class: 'ui-slider', min: def.min, max: def.max, step: def.step ?? 1 });
    i.value = value;
    i.addEventListener('input', () => { out.textContent = i.value; onChange(Number(i.value)); });
    row.append(i, out);
  } else if (def.type === 'text') {
    row.append(TextInput({ value, maxLength: def.maxLength ?? 64, onInput: onChange }));
  } else if (def.type === 'select') {
    const s = el('select', { class: 'ui-select' }, def.options.map(o => el('option', { value: o.value, text: o.label })));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    row.append(s);
  } else {
    throw new Error(`Unknown setting type "${def.type}"`);
  }
  return row;
}

let toastBox = null;
export function toast(message) {
  toastBox ??= document.body.appendChild(el('div', { class: 'ui-toasts' }));
  const t = el('div', { class: 'ui-toast', text: message });
  toastBox.append(t);
  setTimeout(() => t.remove(), 2000);
}

/** Stack-based screen switcher: show() replaces, push() overlays so back() can return. */
export class ScreenManager {
  constructor(root) { this.root = root; this.screens = new Map(); this.stack = []; }
  register(id, node) {
    node.classList.add('screen');
    this.root.append(node);
    this.screens.set(id, node);
  }
  show(id) { this.stack = [id]; this._apply(); }
  push(id) { this.stack.push(id); this._apply(); }
  back() { this.stack.pop(); this._apply(); }
  hideAll() { this.stack = []; this._apply(); }
  get current() { return this.stack.at(-1) ?? null; }
  /** 'menu' (background art) | 'dim' | 'none' */
  setBackdrop(kind) { this.root.dataset.backdrop = kind; }
  _apply() { for (const [id, n] of this.screens) n.classList.toggle('is-active', id === this.current); }
}
