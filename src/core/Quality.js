import { CONFIG } from '../config.js';
import { detectTouch } from './Input.js';

const merge = (target, patch) => {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
    else target[k] = v;
  }
};

/** Graphics quality presets (CONFIG.quality). Call apply() once at boot, before the world, post pipeline or shadows are built. */
export const Quality = {
  /** 'low' | 'medium' | 'high' for a setting value ('auto' picks by device). */
  name(id) {
    const Q = CONFIG.quality;
    const pick = id === 'auto' || !Q.presets[id] ? (detectTouch() ? Q.autoTouch : Q.autoDesktop) : id;
    return Q.presets[pick] ? pick : 'high';
  },

  preset(id) { return CONFIG.quality.presets[this.name(id)]; },

  /** Merges the preset into CONFIG and returns it. */
  apply(id) {
    const p = this.preset(id);
    const L = CONFIG.lighting;
    merge(L.shadow, p.shadow);
    merge(L.ao, p.ao);
    merge(L.skyAmbient, p.skyAmbient);
    merge(L.mirror, p.mirror);
    merge(CONFIG.water.reflection, p.waterReflection);
    return p;
  },
};
