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
