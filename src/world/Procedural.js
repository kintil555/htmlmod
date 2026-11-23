import * as THREE from 'three';

function canvasTexture(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}

function speckle(g, size, count, alpha) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Grid floor, one tile = 4m. */
export function groundTexture(worldSize) {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#a9adb2'; g.fillRect(0, 0, s, s);
    speckle(g, s, 6000, 0.25);
    g.strokeStyle = 'rgba(20,24,28,0.55)'; g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = 'rgba(20,24,28,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, worldSize / 4);
}

export function concreteTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#c4c8cc'; g.fillRect(0, 0, s, s);
    speckle(g, s, 5000, 0.3);
    g.strokeStyle = 'rgba(30,34,38,0.3)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = Math.random() * s; let y = Math.random() * s;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

/** Deterministic RNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
