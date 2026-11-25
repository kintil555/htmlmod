import { el, Button, Panel, SettingControl, TextInput, CodeBox, toast } from './ui.js';
import { Settings } from '../core/Settings.js';
import { MenuButtonRegistry } from '../core/registries.js';
import { Mods, describeError } from '../mods/Mods.js';
import { downloadSdk, downloadTemplate } from '../mods/Sdk.js';
import { Net } from '../net/Net.js';
import { parseInvite } from '../net/protocol.js';
import { STR } from '../content/strings.js';
import { CONFIG } from '../config.js';

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

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(STR.net.copied); } catch { toast(STR.net.copyFailed); }
}

/** Invite code + link of the current session. refresh() re-reads Net; hidden when there is no code. */
function InviteBox() {
  const code = CodeBox({ label: STR.net.codeLabel, copyLabel: STR.net.copy, onCopy: copy });
  const link = CodeBox({ label: STR.net.linkLabel, copyLabel: STR.net.copy, onCopy: copy });
  const root = el('div', { class: 'net__invite' }, code, link);
  root.refresh = () => { root.hidden = !Net.code; code.set(Net.code ?? ''); link.set(Net.link); };
  root.refresh();
  return root;
}

/** Play: Singleplayer or Multiplayer. */
export function PlayModeScreen({ onSingle, onMulti, onBack }) {
  return el('div', { class: 'menu' },
    el('div', { class: 'menu__logo', role: 'img', 'aria-label': 'Html' }),
    el('nav', { class: 'menu__nav' },
      Button({ label: STR.net.singleplayer, onClick: onSingle }),
      Button({ label: STR.net.multiplayer, onClick: onMulti }),
      Button({ label: STR.menu.back, size: 'sm', onClick: onBack })));
}

/** Multiplayer: Host a game or Join one. */
export function MultiplayerScreen({ onHost, onJoin, onBack }) {
  return el('div', { class: 'menu' },
    el('div', { class: 'menu__logo', role: 'img', 'aria-label': 'Html' }),
    el('nav', { class: 'menu__nav' },
      Button({ label: STR.net.host, onClick: onHost }),
      Button({ label: STR.net.join, onClick: onJoin }),
      Button({ label: STR.menu.back, size: 'sm', onClick: onBack })));
}

/** Enter an invite code or paste a link. setCode(code), setStatus(text, isError), setBusy(bool). */
export function JoinScreen({ onJoin, onBack }) {
  const status = el('p', { class: 'net__status' });
  const go = () => {
    const code = parseInvite(input.value);
    if (!code) { root.setStatus(STR.net.err.badCode, true); return; }
    onJoin(code);
  };
  const input = TextInput({ placeholder: STR.net.codePlaceholder, maxLength: 200, onEnter: go });
  const actions = el('div', { class: 'dialog' },
    Button({ label: STR.net.join, onClick: go }),
    Button({ label: STR.menu.back, size: 'sm', onClick: onBack }));
  const root = el('div', { class: 'dialog' },
    Panel({ title: STR.net.joinTitle, body: [el('div', { class: 'ui-setting' }, input), status], className: 'net__panel' }),
    actions);
  root.setCode = code => { input.value = code; root.setStatus('', false); };
  root.setStatus = (text, isError = false) => { status.textContent = text; status.classList.toggle('is-error', isError); };
  root.setBusy = busy => { actions.classList.toggle('is-busy', busy); input.disabled = busy; if (busy) root.setStatus(STR.net.connecting); };
  return root;
}

/** Before the game starts: invite code + link, who is here, and (host only) Start. refresh() re-reads Net. */
export function LobbyScreen({ onStart, onLeave }) {
  const invite = InviteBox();
  const hint = el('p', { class: 'net__hint' });
  const list = el('ul', { class: 'net__players' });
  const panel = Panel({ title: STR.net.lobbyGuest, body: [invite, hint, el('h3', { class: 'net__title', text: STR.net.playersTitle }), list], className: 'net__panel' });
  const head = panel.querySelector('.ui-panel__head');
  const start = Button({ label: STR.net.start, onClick: onStart });
  const root = el('div', { class: 'dialog' }, panel, start, Button({ label: STR.net.leave, size: 'sm', onClick: onLeave }));
  root.refresh = () => {
    head.textContent = Net.isHost ? STR.net.lobbyHost : STR.net.lobbyGuest;
    invite.refresh();
    hint.textContent = Net.isHost ? STR.net.hostHint : STR.net.waitingHost;
    start.hidden = !Net.isHost;
    list.replaceChildren(...[...Net.players.values()].map(p => el('li', {},
      el('span', { text: p.name }),
      p.id === Net.selfId ? el('span', { class: 'net__tag', text: STR.net.you }) : null,
      p.id === 'host' ? el('span', { class: 'net__tag', text: STR.net.hostTag }) : null)));
  };
  root.refresh();
  return root;
}

/** Pause menu. refresh() shows the invite code while a multiplayer session is running. */
export function PauseScreen({ onResume, onHelp, onSettings, onMods, onQuit }) {
  const invite = InviteBox();
  const invitePanel = Panel({ title: STR.net.inviteTitle, body: invite, className: 'net__panel' });
  const root = el('div', { class: 'menu' },
    invitePanel,
    MenuNav('pause', [
      Button({ label: STR.menu.resume, onClick: onResume }),
      Button({ label: STR.menu.help, onClick: onHelp }),
      Button({ label: STR.menu.settings, onClick: onSettings }),
      Button({ label: STR.menu.mods, onClick: onMods }),
    ], [Button({ label: STR.menu.quit, onClick: onQuit })]));
  root.refresh = () => { invite.refresh(); invitePanel.hidden = !Net.code; };
  root.refresh();
  return root;
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
  /** Mods cannot change during a multiplayer session (both sides must run the same mods): `locked` jobs are refused then. */
  const attempt = async (job, onError = describeError, { locked = true } = {}) => {
    if (locked && Net.active) { toast(STR.net.modsLocked); render(); return false; }
    try { await job(); return true; } catch (err) { console.error(err); toast(onError(err)); return false; }
  };

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
        m.outdated ? el('span', { class: 'mods__badge', text: STR.mods.outdatedBadge }) : null,
        m.outdated ? el('p', { class: 'mods__outdated', text: STR.mods.outdatedInfo(m.api, CONFIG.mods.apiVersion) }) : null,
        m.error ? el('p', { class: 'mods__err', text: m.error }) : null),
      toggle,
      Button({ label: STR.mods.remove, size: 'sm', onClick: async () => { if (await attempt(() => Mods.remove(m.id))) toast(STR.mods.removed(m.name)); } }));
  };
  const banner = el('p', { class: 'mods__banner' });
  const render = () => {
    const mods = Mods.list();
    const outdated = mods.filter(m => m.outdated).length;
    banner.textContent = outdated ? STR.mods.outdatedBanner(outdated) : '';
    banner.hidden = !outdated;
    list.replaceChildren(...(mods.length ? mods.map(row) : [el('p', { class: 'settings__empty', text: STR.mods.empty })]));
  };
  Mods.events.on('change', render);
  render();

  const sdkFail = () => STR.mods.sdkFailed;
  const body = [
    el('p', { class: 'mods__warn', text: STR.mods.warning }),
    el('p', { class: 'mods__loader', text: STR.mods.loaderInfo(CONFIG.mods.apiVersion, CONFIG.mods.minApiVersion) }),
    banner,
    el('div', { class: 'mods__actions' },
      Button({ label: STR.mods.install, size: 'sm', onClick: () => file.click() }),
      Button({ label: STR.mods.sdk, size: 'sm', onClick: () => attempt(downloadSdk, sdkFail, { locked: false }) }),
      Button({ label: STR.mods.template, size: 'sm', onClick: () => attempt(downloadTemplate, sdkFail, { locked: false }) }),
      file),
    list,
    el('p', { class: 'mods__note', text: STR.mods.reloadNote }),
  ];
  return el('div', { class: 'dialog' },
    Panel({ title: STR.mods.title, body, className: 'dialog__panel' }),
    Button({ label: STR.menu.back, size: 'sm', onClick: onBack }));
}
