import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const pending = new Map();
const done = new Map();

/** Texture cache. Preload at boot, then use Assets.get(url) synchronously. */
export const Assets = {
  texture(url) {
    if (!pending.has(url)) {
      pending.set(url, new Promise((resolve, reject) => {
        loader.load(url, t => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
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
  async preload(urls, onProgress) {
    let n = 0;
    await Promise.all(urls.map(u => this.texture(u).then(() => onProgress?.(++n / urls.length))));
  },
};
