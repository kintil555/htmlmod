import { el, Button, Panel, SettingControl } from './ui.js';
import { Settings } from '../core/Settings.js';
import { STR } from '../content/strings.js';

export function MainMenuScreen({ onPlay, onHelp, onSettings }) {
  return el('div', { class: 'menu' },
    el('img', { class: 'menu__logo', src: 'assets/ui/logo.png', alt: 'Html', draggable: 'false' }),
    el('nav', { class: 'menu__nav' },
      Button({ label: STR.menu.play, onClick: onPlay }),
      Button({ label: STR.menu.help, onClick: onHelp }),
      Button({ label: STR.menu.settings, onClick: onSettings })));
}

export function PauseScreen({ onResume, onHelp, onSettings, onQuit }) {
  return el('div', { class: 'menu' },
    el('nav', { class: 'menu__nav' },
      Button({ label: STR.menu.resume, onClick: onResume }),
      Button({ label: STR.menu.help, onClick: onHelp }),
      Button({ label: STR.menu.settings, onClick: onSettings }),
      Button({ label: STR.menu.quit, onClick: onQuit })));
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
