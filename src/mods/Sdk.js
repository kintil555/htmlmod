import { CONFIG } from '../config.js';
import { el } from '../ui/ui.js';
import { writeZip } from './Zip.js';

const SDK_DIR = 'sdk/';

async function fetchBytes(rel) {
  const res = await fetch(`${SDK_DIR}${rel}`);
  if (!res.ok) throw new Error(`${res.status} ${SDK_DIR}${rel}`);
  return new Uint8Array(await res.arrayBuffer());
}

function save(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const collect = (paths, rename) => Promise.all(paths.map(async p => ({ path: rename(p), data: await fetchBytes(p) })));

/** Downloads the SDK: API reference, TypeScript typings and example mods (list in CONFIG.mods.sdkFiles). */
export async function downloadSdk() {
  const m = CONFIG.mods;
  save(await writeZip(await collect(m.sdkFiles, p => `htmlmod-sdk/${p}`)), m.sdkZipName);
}

/** Downloads the starter mod (CONFIG.mods.templateDir) as a ZIP the game can install as is. */
export async function downloadTemplate() {
  const m = CONFIG.mods;
  const files = m.sdkFiles.filter(p => p.startsWith(m.templateDir));
  save(await writeZip(await collect(files, p => p.slice(m.templateDir.length))), m.templateZipName);
}
