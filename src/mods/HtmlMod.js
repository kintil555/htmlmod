import { el } from '../ui/ui.js';
import { loadModule, resolveRelative } from './Modules.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;
const CSS_URL = /url\(\s*(["']?)([^)"']+)\1\s*\)/g;
const MEDIA = 'img,audio,video,source,track,image';

/** Mounts an HTML entry of a mod in a shadow root and runs its scripts. See sdk/README.md ("HTML mods"). */
export async function mountHtml(mod, api, track) {
  const { zip, manifest } = mod;
  const htmlPath = manifest.html;
  const doc = new DOMParser().parseFromString(await zip.text(htmlPath), 'text/html');
  const host = el('div', { class: 'mod-host', 'data-mod': mod.id });
  const root = host.attachShadow({ mode: 'open' });

  const local = (from, value) => {
    if (!value || EXTERNAL.test(value)) return null;
    const path = resolveRelative(from, value.startsWith('/') ? value : `./${value}`);
    return path && zip.has(path) ? path : null;
  };
  const cssText = async (text, from) => {
    const jobs = [];
    text.replace(CSS_URL, (all, q, value) => { const p = local(from, value); if (p) jobs.push([value, api.assets.url(p)]); return all; });
    let out = text;
    for (const [value, urlPromise] of jobs) out = out.split(value).join(await urlPromise);
    return out;
  };
  const style = async (text, from) => root.append(el('style', { text: await cssText(text, from) }));

  for (const f of manifest.css) await style(await zip.text(f), f);
  for (const node of doc.head.querySelectorAll('style,link[rel~="stylesheet"]')) {
    if (node.localName === 'style') { await style(node.textContent, htmlPath); continue; }
    const p = local(htmlPath, node.getAttribute('href'));
    if (p) await style(await zip.text(p), p);
  }
  for (const node of doc.body.querySelectorAll(MEDIA)) {
    const p = local(htmlPath, node.getAttribute('src'));
    if (p) node.setAttribute('src', await api.assets.url(p));
  }
  const scripts = [...doc.querySelectorAll('script')];
  for (const s of scripts) s.remove();
  for (const node of [...doc.body.childNodes]) root.append(document.importNode(node, true));
  api.ui.mount(host);

  let n = 0;
  for (const s of scripts) {
    const src = s.getAttribute('src');
    if (src) {
      const p = local(htmlPath, src);
      if (!p) continue;
      const ns = await loadModule(zip, p, track);
      const init = ns.default ?? ns.init;
      if (typeof init === 'function') await init(api, root);
      if (typeof ns.unload === 'function') api.onUnload(ns.unload);
    } else {
      const code = `${s.textContent}\n//# sourceURL=mod:///${mod.id}/inline-${n++}.js`;
      await new AsyncFunction('api', 'root', 'THREE', code)(api, root, api.THREE);
    }
  }
}
