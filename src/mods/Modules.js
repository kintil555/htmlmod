import { ModError } from './Manifest.js';

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;
const JS_TRY = ['', '.js', '.mjs', '/index.js'];

export const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Resolves a relative specifier against a file path inside the zip. Returns the normalized path or null. */
export function resolveRelative(fromPath, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/')) return null;
  const parts = spec.startsWith('/') ? [] : dirname(fromPath).split('/').filter(Boolean);
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

/** Lists the relative specifiers of a source text: [{ spec, target }]. target = resolved existing zip path or null. */
export function findImports(path, source, has) {
  const out = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const base = resolveRelative(path, m[3]);
    if (base == null) continue;
    const target = JS_TRY.map(ext => base + ext).find(has) ?? null;
    out.push({ spec: m[3], target });
  }
  return out;
}

/** Replaces each relative specifier by urlFor(targetPath). Unresolved specifiers stay untouched. */
export function rewriteImports(path, source, has, urlFor) {
  return source.replace(IMPORT_RE, (all, head, q, spec) => {
    const base = resolveRelative(path, spec);
    if (base == null) return all;
    const target = JS_TRY.map(ext => base + ext).find(has);
    return target ? `${head}${q}${urlFor(target)}${q}` : all;
  });
}

/**
 * Loads a JS file of the zip as an ES module. Relative imports between files of the zip are resolved
 * (dependencies are turned into blob URLs first, in order). Bare imports ('three') use the page import map.
 * Circular imports are not supported.
 * @param {{has(p):boolean, text(p):Promise<string>}} zip
 * @param {string} entry
 * @param {(url:string)=>void} track receives every blob URL created (revoked later by the caller)
 * @param {(url:string)=>Promise<object>} importer defaults to dynamic import (swappable for tests)
 */
export async function loadModule(zip, entry, track, importer = url => import(url)) {
  const urls = new Map();
  const visiting = new Set();
  const build = async path => {
    if (urls.has(path)) return urls.get(path);
    if (visiting.has(path)) throw new ModError('cycle', path);
    visiting.add(path);
    const source = await zip.text(path);
    for (const { target } of findImports(path, source, p => zip.has(p))) if (target) await build(target);
    const code = rewriteImports(path, source, p => zip.has(p), p => urls.get(p)) + `\n//# sourceURL=mod:///${path}`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    track(url);
    urls.set(path, url);
    visiting.delete(path);
    return url;
  };
  return importer(await build(entry));
}
