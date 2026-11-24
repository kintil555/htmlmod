// Starter mod. Zip the FILES of this folder (mod.json at the zip root) and install the .zip from Mods.
// Full reference: README.md and htmlmod.d.ts.
export default async function (api) {
  const { THREE, ui } = api;

  // 1) Content. Ids become "hello-mod:<id>" so they never clash with the game or other mods.
  await api.nextbots.register({ id: 'smiley', name: 'Smiley', texture: 'bot.png', height: 3, speed: 12 });
  api.props.register({ id: 'tower', name: 'Tower', size: [2, 8, 2], color: '#c0392b' });

  // 2) A spawn-menu tab (Q menu) with a custom item that spawns three towers.
  api.spawnTabs.register({
    id: 'hello', label: 'Hello', order: 10,
    items: () => [{ id: 'towers', name: 'Three towers', swatch: '#c0392b' }],
    spawn: (_itemId, point) => { for (let i = -1; i <= 1; i++) api.spawn.prop('tower', point.clone().add(new THREE.Vector3(i * 3, 0, 0))); },
  });

  // 3) A setting (shows up in Settings) and a persistent counter.
  api.settings.define({ id: 'speed', label: 'Hello: player speed bonus', type: 'slider', min: 0, max: 10, step: 1, default: 0 });
  const applyBonus = () => api.config.set('player.walkSpeed', 14 + api.settings.get('speed')); // restored on unload
  applyBonus();
  api.settings.onChange(applyBonus);

  // 4) Game events + HUD. 'ready' fires once the game finished booting (or at once if it already did).
  api.on('ready', () => {
    const label = ui.el('div', { text: '' });
    label.style.cssText = 'position:absolute;left:16px;bottom:16px;color:var(--c-text);font-family:var(--font)';
    ui.mountHud(label);
    const show = () => { label.textContent = `Hello Mod: caught ${api.storage.get('caught', 0)} times (ever)`; };
    show();
    api.on('caught', () => { api.storage.set('caught', api.storage.get('caught', 0) + 1); show(); });
  });

  // 5) A hotkey: press G to spawn a smiley where you aim.
  api.on('keydown', ({ code, repeat }) => {
    if (code === 'KeyG' && !repeat && api.game?.state === 'playing') api.spawn.nextbot('smiley');
  });
}
