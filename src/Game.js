import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { CONFIG } from './config.js';
import { STR } from './content/strings.js';
import { NextbotRegistry, PropRegistry, MapRegistry } from './core/registries.js';
import { Assets } from './core/Assets.js';
import { Input } from './core/Input.js';
import { World } from './world/World.js';
import { Environment } from './world/Environment.js';
import { PostFx } from './world/PostFx.js';
import { Settings } from './core/Settings.js';
import { Quality } from './core/Quality.js';
import { events } from './core/Events.js';
import { loadMapData, buildMap } from './world/MapLoader.js';
import { Player } from './entities/Player.js';
import { Nextbot } from './entities/Nextbot.js';
import { Prop } from './entities/Prop.js';
import { Avatar } from './entities/Avatar.js';
import { RemotePlayer } from './entities/RemotePlayer.js';
import { detectTouch } from './core/Input.js';
import { TouchControls } from './ui/TouchControls.js';
import { Net, NetError, describeNetError } from './net/Net.js';
import { Sync } from './net/Sync.js';
import { parseInvite } from './net/protocol.js';
import { el, ScreenManager, toast } from './ui/ui.js';
import { MainMenuScreen, PauseScreen, HelpScreen, SettingsScreen, ModsScreen, PlayModeScreen, MultiplayerScreen, JoinScreen, LobbyScreen } from './ui/screens.js';
import { SpawnMenu } from './ui/SpawnMenu.js';
import { Hud } from './ui/Hud.js';

/** Orchestrator: state machine (menu | playing), pointer lock, spawn/remove tools, catch rules, multiplayer session (net/). */
export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.state = 'menu';
    this.paused = false;
    this._menuClosedAt = -Infinity;
    this.stats = { caught: 0, survived: 0 };
    this.respawnTimer = 0;
    /** Number of open UI layers that need the mouse (mods call api.cursor.free()). */
    this.cursorHolds = 0;
    this._netBusy = false;
    /** Phone / tablet: on-screen controls, no pointer lock. */
    this.touch = detectTouch();
    this._touchOn = false;
    this.hudTimer = 0;
    this.lastT = 0;
    this._qDownAt = 0;
    this._ignoreQUp = false;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 400;
  }

  async boot() {
    // WebGPU, with three.js' automatic WebGL2 fallback. Antialiasing is FXAA in PostFx, not MSAA.
    // Reversed float depth: near-constant precision over the whole 0.1..600 range (no z-fighting or shadow/AO leaks at
    // distance). three.js falls back to the normal depth buffer by itself when the backend cannot do it.
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
    await this.renderer.init();
    // Merges the preset into CONFIG (shadows, AO, mirrors, water) before the world and post pipeline are built.
    this.quality = Quality.apply(Settings.get('quality'));
    /** Extra render scale from the adaptive resolution (1 = none). Only ever goes down. */
    this.adaptScale = 1;
    this._adapt = { warm: CONFIG.quality.adaptive.warmupSec, sec: 0, frames: 0 };
    Assets.anisotropy = Math.min(this.quality.anisotropy, this.renderer.getMaxAnisotropy());
    this.camera = new THREE.PerspectiveCamera(CONFIG.player.fov, 1, 0.1, 600);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.screens = new ScreenManager(this.uiRoot);
    this.screens.setBackdrop('menu');
    const bar = el('div', { class: 'loading__fill' });
    const stage = el('div', { class: 'loading__stage' });
    const loading = el('div', { class: 'loading' }, STR.loading, el('div', { class: 'loading__bar' }, bar), stage);
    this.screens.register('loading', loading);
    this.screens.show('loading');
    // One bar across all stages: each stage owns a slice [from, to] of it.
    const progress = (label, from, to) => {
      stage.textContent = label;
      return p => { bar.style.width = `${Math.round((from + (to - from) * p) * 100)}%`; };
    };
    const S = CONFIG.loading;

    const onAssets = progress(STR.loadingStage.assets, 0, S.assets);
    onAssets(0);
    await Avatar.preload();
    await Assets.preload(NextbotRegistry.all().map(d => d.texture), onAssets);
    const mapData = await loadMapData(MapRegistry.get(CONFIG.world.map), progress(STR.loadingStage.map, S.assets, S.map));

    this.world = new World(buildMap(mapData));
    await this.world.buildNav(progress(STR.loadingStage.nav, S.map, S.nav));
    this.env = new Environment(this.renderer, this.world.scene, this.world.bounds);
    this.fx = new PostFx(this.renderer, this.world.scene, this.camera, this.env.rayLight, this.env.sunDir);
    this.fx.setSunEffects(Settings.get('sunEffects'));
    Settings.events.on('change', ({ id, value }) => {
      if (id === 'sunEffects') this.fx.setSunEffects(value);
      else if (id === 'renderScale') this._resize();
      else if (id === 'adaptiveRes') { this.adaptScale = 1; this._resize(); }
      else if (id === 'quality') toast(STR.settings.quality.reload);
    });
    await this._warmUp(progress(STR.loadingStage.shaders, S.nav, 1));
    this.input = new Input();
    this.input.attach();
    this.player = new Player(this.camera, this.world.spawn);
    this.hud = new Hud();
    this.sync = new Sync(this);
    this.spawnMenu = new SpawnMenu({
      onSpawn: (tab, item) => tab.spawn(item.id, this.aimPoint(), this),
      onClear: () => this.clearSpawned(),
      onClose: () => this._closeSpawnMenu(),
      counts: () => `${STR.hud.nextbots} ${this.world.count('nextbot')}/${CONFIG.limits.maxNextbots}   ${STR.hud.props} ${this.world.count('prop')}/${CONFIG.limits.maxProps}`,
    });
    document.body.classList.toggle('is-touch', this.touch);
    if (this.touch) {
      this.touchUi = new TouchControls({ input: this.input, onPause: () => this.pause() });
      this.uiRoot.append(this.touchUi.root);
    }
    this.uiRoot.append(this.hud.root, this.spawnMenu.root);

    const settingsScreen = SettingsScreen({ onBack: () => this.screens.back() });
    this.screens.register('mods', ModsScreen({ onBack: () => this.screens.back() }));
    this.screens.register('mainmenu', MainMenuScreen({
      onPlay: () => this.screens.push('playmode'),
      onHelp: () => this.screens.push('help'),
      onSettings: () => { settingsScreen.refresh(); this.screens.push('settings'); },
      onMods: () => this.screens.push('mods'),
    }));
    this.screens.register('playmode', PlayModeScreen({
      onSingle: () => this.startGame(),
      onMulti: () => this.screens.push('multiplayer'),
      onBack: () => this.screens.back(),
    }));
    this.screens.register('multiplayer', MultiplayerScreen({
      onHost: () => this.hostGame(),
      onJoin: () => { this.joinScreen.setStatus('', false); this.screens.push('join'); },
      onBack: () => this.screens.back(),
    }));
    this.joinScreen = JoinScreen({ onJoin: code => this.joinGame(code), onBack: () => this.screens.back() });
    this.screens.register('join', this.joinScreen);
    this.lobby = LobbyScreen({
      onStart: () => { Net.markStarted(); this.startGame(); },
      onLeave: () => { this.leaveSession(); this.screens.show('mainmenu'); },
    });
    this.screens.register('lobby', this.lobby);
    this.pauseScreen = PauseScreen({
      onResume: () => this.resume(),
      onHelp: () => this.screens.push('help'),
      onSettings: () => { settingsScreen.refresh(); this.screens.push('settings'); },
      onMods: () => this.screens.push('mods'),
      onQuit: () => this.quitToMenu(),
    });
    this.screens.register('pause', this.pauseScreen);
    this.screens.register('help', HelpScreen({ onBack: () => this.screens.back() }));
    this.screens.register('settings', settingsScreen);
    this.screens.show('mainmenu');

    Net.events.on('players', () => { this.lobby.refresh(); this.pauseScreen.refresh(); });
    Net.events.on('signal', ({ up }) => { if (!up) { toast(STR.net.inviteClosed); this.lobby.refresh(); this.pauseScreen.refresh(); } });
    Net.events.on('start', () => { if (this.state !== 'playing') this.startGame({ lock: false }); });
    Net.events.on('closed', ({ reason }) => { toast(describeNetError(new NetError(reason))); this.quitToMenu(); });
    this._openInviteLink();

    this._bindInput();
    this.renderer.setAnimationLoop(t => this._frame(t));
  }

  /**
   * Pays every first-use GPU cost behind the loading screen: texture upload, shader compilation (map, prop and
   * nextbot materials, post pipeline) and the first shadow map. Nothing should hitch when the player presses Play.
   */
  async _warmUp(onProgress) {
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const tex = this.world.textures;
    for (let i = 0; i < tex.length; i++) {
      this.renderer.initTexture(tex[i]);
      if (i % CONFIG.loading.uploadBatch === CONFIG.loading.uploadBatch - 1) { onProgress((i + 1) / tex.length * 0.6); await frame(); }
    }
    const bot = this.world.add(new Nextbot(NextbotRegistry.all()[0], Assets.get(NextbotRegistry.all()[0].texture), 0, 0, { x: 0, z: 1 }));
    const prop = this.world.add(new Prop(PropRegistry.all()[0], 0, 0));
    const avatar = this.world.add(new RemotePlayer('warmup', 'warmup'));
    onProgress(0.7);
    await this.renderer.compileAsync(this.world.scene, this.camera);
    onProgress(0.9);
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + CONFIG.player.eyeHeight, this.world.spawn.z);
    this.fx.render();
    await frame();
    this.fx.render();
    this.world.remove(bot);
    this.world.remove(prop);
    this.world.remove(avatar);
    onProgress(1);
    await frame();
  }

  /* ---------------- state ---------------- */
  /** lock: false when the start was not caused by a click (a guest whose host pressed Start): the first click on the game locks the mouse. */
  startGame({ lock = true } = {}) {
    this.world.clear('nextbot');
    this.world.clear('prop');
    this.player.respawn();
    this.player.invulnerable = 0;
    this.stats = { caught: 0, survived: 0 };
    this.respawnTimer = 0;
    this.state = 'playing';
    this.paused = false;
    this.screens.setBackdrop('none');
    this.screens.hideAll();
    this.hud.hideCaught();
    this.hud.show();
    this._refreshHud();
    if (lock || this.touch) this._lock(); else this._armRelock();
    if (this.touch) this._enterFullscreen();
    toast(this.touch ? STR.hud.touchHints : STR.hud.hints);
    events.emit('game:start');
  }

  pause() {
    if (this.state !== 'playing' || this.paused) return;
    this.paused = true;
    this.spawnMenu.close();
    this.screens.setBackdrop('dim');
    this.pauseScreen.refresh();
    this.screens.show('pause');
    events.emit('game:pause');
  }

  resume() {
    this.paused = false;
    this.screens.setBackdrop('none');
    this.screens.hideAll();
    this._lock();
    events.emit('game:resume');
  }

  /* ---------------- multiplayer ---------------- */
  /** Ends the multiplayer session (if any) and forgets the remote players and shared entities. */
  leaveSession() {
    Net.leave();
    this.sync.reset();
  }

  /** A link with ?join=CODE opens the Join screen with the code filled in. The player still clicks Join (a click is needed to lock the mouse). */
  _openInviteLink() {
    const code = parseInvite(new URLSearchParams(location.search).get(CONFIG.net.joinParam));
    if (!code) return;
    this.screens.push('playmode');
    this.screens.push('multiplayer');
    this.screens.push('join');
    this.joinScreen.setCode(code);
  }

  async hostGame() {
    if (this._netBusy) return;
    this._netBusy = true;
    try {
      await Net.host(Settings.get('playerName'));
      this.lobby.refresh();
      this.screens.push('lobby');
    } catch (err) {
      toast(describeNetError(err));
    } finally { this._netBusy = false; }
  }

  async joinGame(code) {
    if (this._netBusy) return;
    this._netBusy = true;
    this.joinScreen.setBusy(true);
    try {
      const welcome = await Net.join(code, Settings.get('playerName'));
      this.joinScreen.setBusy(false);
      this.joinScreen.setStatus('', false);
      if (welcome.started) {
        this.startGame({ lock: false });
        this.sync.applySnapshot(welcome.snapshot);
      } else {
        this.lobby.refresh();
        this.screens.push('lobby');
      }
    } catch (err) {
      this.joinScreen.setBusy(false);
      this.joinScreen.setStatus(describeNetError(err), true);
    } finally { this._netBusy = false; }
  }

  /** Removes every nextbot and prop. A guest asks the host, which owns them. */
  clearSpawned() {
    if (Net.isGuest) { this.sync.requestClear(); return; }
    this.world.clear('nextbot');
    this.world.clear('prop');
    this.spawnMenu.updateCounts();
  }

  /** Re-reads the player count into the HUD. */
  refreshPlayers() { if (this.hud) this._refreshHud(); }

  quitToMenu() {
    this.leaveSession();
    this.state = 'menu';
    this.paused = false;
    this.spawnMenu.close();
    this.hud.hide();
    this.screens.setBackdrop('menu');
    this.screens.show('mainmenu');
    events.emit('game:quit');
  }

  /** True while the Q menu or a mod overlay needs the mouse. */
  get uiOpen() { return this.spawnMenu.isOpen || this.cursorHolds > 0; }

  /** Leaves pointer lock without pausing. Returns release(), which locks the mouse again. */
  freeCursor() {
    this.cursorHolds++;
    document.exitPointerLock();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.cursorHolds--;
      this._menuClosedAt = performance.now();
      if (this.state === 'playing' && !this.paused && !this.uiOpen) this._lock();
    };
  }

  /** Touch: full screen + landscape where the browser allows it (needs the tap that started the game; failures are ignored). */
  _enterFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }

  /** The on-screen controls show only while playing with nothing else open. */
  _syncTouch() {
    if (!this.touchUi) return;
    const on = this.state === 'playing' && !this.paused && !this.uiOpen;
    if (on === this._touchOn) return;
    this._touchOn = on;
    if (on) this.touchUi.show(); else this.touchUi.hide();
  }

  _lock() {
    // No pointer lock on touch screens: the camera is turned by dragging, and Pause is a button.
    if (this.touch) return;
    const p = this.canvas.requestPointerLock();
    p?.catch?.(() => {
      if (this.state !== 'playing' || this.paused || this.uiOpen) return;
      if (this._inMenuGrace()) this._armRelock(); else this.pause();
    });
  }

  /** True shortly after the Q menu closed: lock changes in this window come from the menu, not the player pausing. */
  _inMenuGrace() {
    return performance.now() - this._menuClosedAt < CONFIG.spawnMenu.closeGraceMs;
  }

  _armRelock() {
    if (this._relockArmed) return;
    this._relockArmed = true;
    toast(STR.hud.clickToResume);
    this.canvas.addEventListener('mousedown', () => {
      this._relockArmed = false;
      if (this.state === 'playing' && !this.paused && !this.uiOpen) this._lock();
    }, { once: true });
  }

  /* ---------------- input ---------------- */
  _bindInput() {
    document.addEventListener('pointerlockchange', () => {
      this.input.locked = document.pointerLockElement === this.canvas;
      if (this.input.locked || this.state !== 'playing' || this.paused || this.uiOpen) return;
      if (this._inMenuGrace()) this._armRelock();
      else this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.state !== 'playing' || this.paused || this.uiOpen) return;
      if (this._inMenuGrace()) this._armRelock(); else this.pause();
    });

    this.input.events.on('keydown', e => events.emit('game:keydown', e));
    this.input.events.on('keyup', e => events.emit('game:keyup', e));
    this.input.events.on('keydown', ({ code, repeat }) => {
      if (repeat || this.state !== 'playing' || this.paused) return;
      if (code === 'KeyQ') {
        if (this.spawnMenu.isOpen) { this._closeSpawnMenu(); this._ignoreQUp = true; } else {
          this._ignoreQUp = false;
          this._qDownAt = performance.now();
          this.spawnMenu.open();
          document.exitPointerLock();
        }
      } else if (code === 'Escape' && this.spawnMenu.isOpen) {
        this._closeMenuByEsc();
      } else if (code === 'KeyR' && !this.uiOpen) {
        this.removeAimed();
      }
    });
    this.input.events.on('keyup', ({ code }) => {
      if (code !== 'KeyQ') return;
      if (this._ignoreQUp) { this._ignoreQUp = false; return; }
      if (this.spawnMenu.isOpen && performance.now() - this._qDownAt > CONFIG.spawnMenu.stickyMs) this._closeSpawnMenu();
    });
  }

  /** Every menu close goes through here so the grace window is always stamped. */
  _closeSpawnMenu({ relock = true } = {}) {
    this._menuClosedAt = performance.now();
    this.spawnMenu.close();
    if (this.state !== 'playing' || this.paused) return;
    if (relock) this._lock(); else this._armRelock();
  }

  /** Esc closes the menu and relocks at once. Esc is not a user gesture, so if the browser refuses, the grace window falls back to click-to-resume instead of pausing. */
  _closeMenuByEsc() {
    this._closeSpawnMenu();
  }

  /* ---------------- tools ---------------- */
  /** Where the crosshair hits the world, dropped onto the surface below it. Falls back to 10 units ahead. */
  aimPoint() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.aimTargets(), false)[0];
    const p = hit ? hit.point.clone() : this.raycaster.ray.at(10, new THREE.Vector3());
    this.world.clamp(p, CONFIG.world.aimMargin);
    p.y = this.world.collision.groundHeight(p.x, p.z, CONFIG.player.radius, p.y);
    return p;
  }

  /** quiet: no limit toast (the host serving a guest's request). */
  spawnNextbot(id, point, { quiet = false } = {}) {
    if (Net.isGuest) { this.sync.requestSpawn('nextbot', id, point); return; }
    if (this.world.count('nextbot') >= CONFIG.limits.maxNextbots) { if (!quiet) toast(STR.spawn.nextbotLimit); return; }
    const def = NextbotRegistry.get(id);
    this.world.add(new Nextbot(def, Assets.get(def.texture), point.x, point.z, this.player.pos, point.y));
    this.spawnMenu.updateCounts();
  }

  spawnProp(id, point, { quiet = false } = {}) {
    if (Net.isGuest) { this.sync.requestSpawn('prop', id, point); return; }
    if (this.world.count('prop') >= CONFIG.limits.maxProps) { if (!quiet) toast(STR.spawn.propLimit); return; }
    this.world.add(new Prop(PropRegistry.get(id), point.x, point.z, point.y));
    this.spawnMenu.updateCounts();
  }

  removeAimed() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = 80;
    const hit = this.raycaster.intersectObjects(this.world.pickables(), false)[0];
    this.raycaster.far = 400;
    const entity = hit?.object.userData.entity;
    if (!entity) { toast(STR.spawn.nothingToRemove); return; }
    if (Net.isGuest && entity.nid != null) this.sync.requestRemove(entity); else this.world.remove(entity);
    toast(STR.spawn.removed(entity.displayName));
  }

  /* ---------------- loop ---------------- */
  /** Canvas pixels per CSS pixel: device ratio capped by the quality preset, times the render scale setting and the adaptive scale. */
  _pixelRatio() {
    return Math.max(0.25, Math.min(window.devicePixelRatio, this.quality.pixelRatio) * Settings.get('renderScale') * this.adaptScale);
  }

  /** Adaptive resolution: if the average fps over a window is below target, render at a lower scale (never back up). */
  _adaptResolution(rawDt) {
    const A = CONFIG.quality.adaptive;
    const s = this._adapt;
    if (!Settings.get('adaptiveRes') || this.state !== 'playing' || this.paused || this.adaptScale <= A.minScale) return;
    if (rawDt > 0.25) return; // tab switch or shader hitch, not a real frame time
    if (s.warm > 0) { s.warm -= rawDt; return; }
    s.sec += rawDt; s.frames++;
    if (s.sec < A.windowSec) return;
    const fps = s.frames / s.sec;
    s.sec = 0; s.frames = 0;
    if (fps >= A.targetFps) return;
    this.adaptScale = Math.max(A.minScale, Math.round((this.adaptScale - A.step) * 100) / 100);
    this._resize();
  }

  _resize() {
    const w = window.innerWidth; const h = window.innerHeight;
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(t) {
    const rawDt = (t - this.lastT) / 1000;
    const dt = Math.min(rawDt, 0.05);
    this.lastT = t;
    this._adaptResolution(rawDt);
    this._syncTouch();
    if (this.state !== 'playing') return;
    // In a multiplayer session the world keeps running behind the pause menu (the other players are still playing).
    if (!this.paused || Net.active) this._update(dt);
    this.fx.render();
  }

  _update(dt) {
    const cfg = CONFIG.catchState;
    const live = !this.paused;
    if (live) this.player.update(dt, this.input, this.world);
    this.world.update(dt, { player: this.player, target: this.sync.chaseTarget(dt), camera: this.camera, chase: !Net.isGuest });
    this.sync.update(dt);
    this._voidCheck();
    events.emit('game:update', dt);

    if (this.player.frozen) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.player.respawn();
        this.player.invulnerable = cfg.invulnerable;
        this.world.pushNextbotsFrom(this.world.spawn.x, this.world.spawn.z, cfg.pushRadius);
        this.hud.hideCaught();
      }
    } else {
      if (live) this.stats.survived += dt;
      if (live && this.player.invulnerable <= 0) {
        for (const bot of this.world.entities) {
          if (bot.type === 'nextbot' && bot.touches(this.player)) { this._onCaught(bot); break; }
        }
      }
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.2; this._refreshHud(); }
  }

  /** Anything that leaves the map and drops into the void is put back (player) or removed (nextbots). */
  _voidCheck() {
    const limit = this.world.bounds.minY - CONFIG.world.voidMargin;
    if (this.player.pos.y < limit && !this.player.frozen) { this.player.respawn(); this.player.invulnerable = CONFIG.catchState.invulnerable; }
    for (const e of this.world.ofType('nextbot')) if (e.y < limit) this.world.remove(e);
  }

  _onCaught(bot) {
    this.stats.caught++;
    this.stats.survived = 0;
    events.emit('game:caught', bot);
    this.player.die(bot.s.x, bot.s.z);
    this.respawnTimer = CONFIG.catchState.respawnDelay;
    this.hud.showCaught(bot.displayName);
    this._refreshHud();
  }

  _refreshHud() {
    this.hud.update({
      caught: this.stats.caught,
      survived: this.stats.survived,
      nextbots: this.world.count('nextbot'),
      props: this.world.count('prop'),
      players: Net.active ? Net.players.size : 0,
    });
  }
}
