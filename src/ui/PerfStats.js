import { el } from './ui.js';

/**
 * Performance overlay, shown with ?perf in the URL. One line of numbers, refreshed twice a second: backend, fps, CPU ms spent per frame
 * (game update + render submission), draw calls and triangles of the whole frame (shadow cascades and reflections included), canvas size.
 * Also exposes the game as window.__game for profiling scripts.
 */
export class PerfStats {
  constructor(game) {
    this.game = game;
    this.root = el('div', { class: 'perf' });
    document.body.append(this.root);
    window.__game = game;
    game.renderer.info.autoReset = false;
    this._acc = 0; this._frames = 0; this._cpu = 0;
    this.last = null;
  }

  /** Call at the start of every frame. */
  begin() { this.game.renderer.info.reset(); this._t0 = performance.now(); }

  /** Call after the frame was submitted. rawDt = seconds since the previous frame. */
  end(rawDt) {
    this._cpu += performance.now() - this._t0;
    this._frames++;
    this._acc += rawDt;
    if (this._acc < 0.5) return;
    const g = this.game;
    const info = g.renderer.info;
    this.last = {
      backend: g.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
      fps: this._frames / this._acc,
      cpuMs: this._cpu / this._frames,
      drawCalls: info.render.drawCalls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      canvas: `${g.canvas.width}x${g.canvas.height}`,
    };
    const s = this.last;
    this.root.textContent = `${s.backend} ${s.fps.toFixed(0)}fps cpu ${s.cpuMs.toFixed(1)}ms calls ${s.drawCalls} tris ${s.triangles} ${s.canvas}`;
    this._acc = 0; this._frames = 0; this._cpu = 0;
  }
}
