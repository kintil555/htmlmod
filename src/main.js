import './content/index.js';
import { Game } from './Game.js';
import { STR } from './content/strings.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

function fail(message) {
  uiRoot.dataset.backdrop = 'dim';
  uiRoot.textContent = message;
  uiRoot.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#fff;font:20px sans-serif';
  console.error(message);
}

try {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) throw new Error(STR.errors.webgl);
  await new Game({ canvas, uiRoot }).boot();
} catch (err) {
  fail(err.message);
}
