import { CONFIG } from '../config.js';
import { ZipError } from './Zip.js';

const slug = s => s.toLowerCase().replace(/\.zip$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Error carrying a STR.mods.err key (+ optional argument) so the UI can show a translated message. */
export class ModError extends Error {
  constructor(key, arg) { super(key); this.key = key; this.arg = arg; }
}

/** True when a mod targets an older mod API than this loader runs (it still loads, but may break). */
export const isOutdated = api => api < CONFIG.mods.apiVersion;

/** Maps a ZipError code to a STR.mods.err key. */
export function zipErrorKey(err) {
  const map = { 'not-a-zip': 'notZip', encrypted: 'encrypted', method: 'method', corrupt: 'corrupt', 'size-mismatch': 'sizeMismatch', 'too-many-entries': 'tooManyEntries', 'too-large': 'tooLarge', 'unsafe-path': 'unsafePath', 'missing-file': 'missingFile' };
  return new ModError(map[err.code] ?? 'corrupt', err.detail);
}

/**
 * Reads mod.json (optional) and decides the entry files.
 * mod.json: { id, name, version, author, description, api, main, html, css[] }.
 * Without mod.json the id comes from the file name and the entry is main.js | index.js | index.html.
 */
export async function parseManifest(zip, fileName = 'mod') {
  let m = {};
  if (zip.has('mod.json')) {
    try { m = JSON.parse(await zip.text('mod.json')); } catch (err) {
      if (err instanceof ZipError) throw zipErrorKey(err);
      throw new ModError('badManifest');
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ModError('badManifest');
  }
  const id = String(m.id ?? slug(fileName));
  if (!new RegExp(CONFIG.mods.idPattern).test(id)) throw new ModError('badId');
  const api = m.api == null ? 1 : Number(m.api);
  if (!Number.isFinite(api) || api > CONFIG.mods.apiVersion) throw new ModError('newerApi', api);
  if (api < CONFIG.mods.minApiVersion) throw new ModError('tooOldApi', api);
  let main = m.main ? String(m.main) : null;
  let html = m.html ? String(m.html) : null;
  if (!main && !html) {
    const found = CONFIG.mods.entryCandidates.find(c => zip.has(c));
    if (!found) throw new ModError('noEntry');
    if (found.endsWith('.html')) html = found; else main = found;
    if (main && !html && zip.has('index.html') && found !== 'index.html' && m.html === undefined) html = 'index.html';
  }
  for (const f of [main, html, ...(Array.isArray(m.css) ? m.css : [])]) if (f && !zip.has(f)) throw new ModError('missingFile', f);
  return {
    id,
    name: String(m.name ?? id),
    version: String(m.version ?? '1.0.0'),
    author: m.author ? String(m.author) : '',
    description: m.description ? String(m.description) : '',
    api,
    main,
    html,
    css: Array.isArray(m.css) ? m.css.map(String) : [],
  };
}
