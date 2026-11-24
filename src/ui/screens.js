import { el, Button, Panel, SettingControl, toast } from './ui.js';
import { Settings } from '../core/Settings.js';
import { MenuButtonRegistry } from '../core/registries.js';
import { Mods, describeError } from '../mods/Mods.js';
import { downloadSdk, downloadTemplate } from '../mods/Sdk.js';
import { STR } from '../content/strings.js';

/** Menu column: fixed buttons, then buttons mods added for `where`, then the tail. Rebuilds when mods change them. */
function MenuNav(where, head, tail = []) {
  const nav = el('nav', { class: 'menu__nav' });
  const render = () => nav.replaceChildren(
    ...head,
    ...MenuButtonRegistry.all().filter(b => b.where === where || b.where === 'both').map(b => Button({ label: b.label, onClick: b.onClick })),
    ...tail);
  MenuButtonRegistry.subscribe(render);
  render();
  return nav;
}

export function MainMenuScreen({ onPlay, onHelp, onSettings, onMods }) {
  return el('div', { class: 'menu' },
    el('div', { class: 'menu__logo', role: 'img', 'aria-label': 'Html' }),
    MenuNav('main', [
      Button({ label: STR.menu.play, onClick: onPlay }),
      Button({ label: STR.menu.help, onClick: onHelp }),
      Button({ label: STR.menu.settings, onClick: onSettings }),
      Button({ label: STR.menu.mods, onClick: onMods }),
    ]));
}

export function PauseScreen({ onResume, onHelp, onSettings, onMods, onQuit }) {
  return el('div', { class: 'menu' },
    MenuNav('pause', [
      Button({ label: STR.menu.resume, onClick: onResume }),
      Button({ label: STR.menu.help, onClick: onHelp }),
      Button({ label: STR.menu.settings, onClick: onSettings }),
      Button({ label: STR.menu.mods, onClick: onMods }),
    ], [Button({ label: STR.menu.quit, onClick: onQuit })]));
}

export function HelpScreen({ onBack }) {
  const body = STR.help.sections.map(sec => el('div', { class: 'help__sec' },
    el('h3', { text: sec.title }),
    sec.lines ? el('ul', {}, sec.lines.map(l => el('li', { text: l }))) : null,
    sec.keys ? el('table', { class: 'help__keys' }, sec.keys.map(([k, d]) =>
      el('tr', {}, el('td', {}, el('kbd', { text: k })), el('td', { text: d })))) : null));
  return el('div', { class: 'dialog' },
    Panel({ title: STR.help.title, body, className: 'dialog__panel' }),
    Button({ label: STR.menu.back, size: 'sm', onClick: onBack }));
}

/** Rebuilds from the Settings registry each time it is shown. */
export function SettingsScreen({ onBack }) {
  const bodyHost = el('div', { class: 'settings' });
  const root = el('div', { class: 'dialog' },
    Panel({ title: STR.settings.title, body: bodyHost, className: 'dialog__panel' }),
    Button({ label: STR.menu.back, size: 'sm', onClick: onBack }));
  root.refresh = () => {
    const defs = Settings.all();
    if (!defs.length) { bodyHost.replaceChildren(el('p', { class: 'settings__empty', text: STR.settings.empty })); return; }
    const groups = new Map();
    for (const d of defs) { const k = d.category ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    bodyHost.replaceChildren(...[...groups].map(([cat, list]) => el('div', { class: 'settings__group' },
      cat ? el('h3', { text: cat }) : null,
      list.map(d => SettingControl(d, Settings.get(d.id), v => Settings.set(d.id, v))))));
  };
  root.refresh();
  return root;
}

/** Install / enable / remove mods, download the SDK. Rebuilds itself whenever the mod host changes. */
export function ModsScreen({ onBack }) {
  const list = el('div', { class: 'mods__list' });
  const file = el('input', { type: 'file', accept: '.zip,application/zip', multiple: true, class: 'mods__file' });
  const attempt = async (job, onError = describeError) => { try { await job(); } catch (err) { console.error(err); toast(onError(err)); } };

  file.addEventListener('change', async () => {
    for (const f of file.files) {
      await attempt(async () => {
        const m = await Mods.install(f);
        toast(m.status === 'loaded' ? STR.mods.installed(m.name) : STR.mods.failed(m.name));
      });
    }
    file.value = '';
  });

  const row = m => {
    const toggle = el('input', { type: 'checkbox', class: 'ui-toggle' });
    toggle.checked = m.enabled;
    toggle.addEventListener('change', () => attempt(() => Mods.setEnabled(m.id, toggle.checked)));
    return el('div', { class: 'mods__row' },
      el('div', { class: 'mods__info' },
        el('b', { text: `${m.name} ${m.version}` }),
        m.author ? el('span', { class: 'mods__author', text: STR.mods.byAuthor(m.author) }) : null,
        m.description ? el('p', { class: 'mods__desc', text: m.description }) : null,
        el('span', { class: `mods__status mods__status--${m.status}`, text: STR.mods.status[m.status] }),
        m.error ? el('p', { class: 'mods__err', text: m.error }) : null),
      toggle,
      Button({ label: STR.mods.remove, size: 'sm', onClick: async () => { await attempt(() => Mods.remove(m.id)); toast(STR.mods.removed(m.name)); } }));
  };
  const render = () => {
    const mods = Mods.list();
    list.replaceChildren(...(mods.length ? mods.map(row) : [el('p', { class: 'settings__empty', text: STR.mods.empty })]));
  };
  Mods.events.on('change', render);
  render();

  const sdkFail = () => STR.mods.sdkFailed;
  const body = [
    el('p', { class: 'mods__warn', text: STR.mods.warning }),
    el('div', { class: 'mods__actions' },
      Button({ label: STR.mods.install, size: 'sm', onClick: () => file.click() }),
      Button({ label: STR.mods.sdk, size: 'sm', onClick: () => attempt(downloadSdk, sdkFail) }),
      Button({ label: STR.mods.template, size: 'sm', onClick: () => attempt(downloadTemplate, sdkFail) }),
      file),
    list,
    el('p', { class: 'mods__note', text: STR.mods.reloadNote }),
  ];
  return el('div', { class: 'dialog' },
    Panel({ title: STR.mods.title, body, className: 'dialog__panel' }),
    Button({ label: STR.menu.back, size: 'sm', onClick: onBack }));
}
