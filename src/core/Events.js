/** Tiny event emitter. */
export class Events {
  constructor() { this._h = new Map(); }
  on(name, fn) {
    if (!this._h.has(name)) this._h.set(name, new Set());
    this._h.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { this._h.get(name)?.delete(fn); }
  emit(name, payload) { for (const fn of [...(this._h.get(name) ?? [])]) fn(payload); }
}
export const events = new Events();
