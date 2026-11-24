import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const pending = new Map();
const done = new Map();

/** Texture cache. Preload at boot, then use Assets.get(url) synchronously. */
export const Assets = {
  /** Set from the GPU's limit at boot, before any texture loads. */
  anisotropy: 4,
  /** opts.flipY: false for glTF-style UVs (baked maps). opts.repeat: tile instead of clamp. Options apply on first load of a url. */
  texture(url, { flipY = true, repeat = false } = {}) {
    if (!pending.has(url)) {
      pending.set(url, new Promise((resolve, reject) => {
        loader.load(url, t => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = this.anisotropy;
          t.flipY = flipY;
          if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          done.set(url, t);
          resolve(t);
        }, undefined, () => reject(new Error(`Failed to load ${url}`)));
      }));
    }
    return pending.get(url);
  },
  get(url) {
    const t = done.get(url);
    if (!t) throw new Error(`Texture not preloaded: ${url}`);
    return t;
  },
  async preload(urls, onProgress, opts) {
    let n = 0;
    await Promise.all(urls.map(u => this.texture(u, opts).then(() => onProgress?.(++n / urls.length))));
  },
};
