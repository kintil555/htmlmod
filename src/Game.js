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
import { loadMapData, buildMap } from './world/MapLoader.js';
import { Player } from './entities/Player.js';
import { Nextbot } from './entities/Nextbot.js';
import { Prop } from './entities/Prop.js';
import { el, ScreenManager, toast } from './ui/ui.js';
import { MainMenuScreen, PauseScreen, HelpScreen, SettingsScreen } from './ui/screens.js';
import { SpawnMenu } from './ui/SpawnMenu.js';
import { Hud } from './ui/Hud.js';

/** Orchestrator: state machine (menu | playing), pointer lock, spawn/remove tools, catch rules. */
export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.state = 'menu';
    this.paused = false;
    this._menuClosedAt = -Infinity;
    this.stats = { caught: 0, survived: 0 };
    this.respawnTimer = 0;
    this.hudTimer = 0;
    this.lastT = 0;
    this._qDownAt = 0;
    this._ignoreQUp = false;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 400;
  }

  async boot() {
    // WebGPU, with three.js' automatic WebGL2 fallback. Antialiasing is FXAA in PostFx, not MSAA.
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    await this.renderer.init();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    Assets.anisotropy = Math.min(8, this.renderer.getMaxAnisotropy());
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
    await Assets.preload(NextbotRegistry.all().map(d => d.texture), onAssets);
    const mapData = await loadMapData(MapRegistry.get(CONFIG.world.map), progress(STR.loadingStage.map, S.assets, S.map));

    this.world = new World(buildMap(mapData));
    await this.world.buildNav(progress(STR.loadingStage.nav, S.map, S.nav));
    this.env = new Environment(this.renderer, this.world.scene, this.world.bounds);
    this.fx = new PostFx(this.renderer, this.world.scene, this.camera, this.env.sun, this.env.sunDir);
    this.fx.setSunEffects(Settings.get('sunEffects'));
    Settings.events.on('change', ({ id, value }) => { if (id === 'sunEffects') this.fx.setSunEffects(value); });
    await this._warmUp(progress(STR.loadingStage.shaders, S.nav, 1));
    this.input = new Input();
    this.input.attach();
    this.player = new Player(this.camera, this.world.spawn);
    this.hud = new Hud();
    this.spawnMenu = new SpawnMenu({
      onSpawn: (tab, item) => tab.spawn(item.id, this.aimPoint(), this),
      onClear: () => { this.world.clear('nextbot'); this.world.clear('prop'); this.spawnMenu.updateCounts(); },
      counts: () => `${STR.hud.nextbots} ${this.world.count('nextbot')}/${CONFIG.limits.maxNextbots}   ${STR.hud.props} ${this.world.count('prop')}/${CONFIG.limits.maxProps}`,
    });
    this.uiRoot.append(this.hud.root, this.spawnMenu.root);

    const settingsScreen = SettingsScreen({ onBack: () => this.screens.back() });
    this.screens.register('mainmenu', MainMenuScreen({
      onPlay: () => this.startGame(),
      onHelp: () => this.screens.push('help'),
      onSettings: () => { settingsScreen.refresh(); this.screens.push('settings'); },
    }));
    this.screens.register('pause', PauseScreen({
      onResume: () => this.resume(),
      onHelp: () => this.screens.push('help'),
      onSettings: () => { settingsScreen.refresh(); this.screens.push('settings'); },
      onQuit: () => this.quitToMenu(),
    }));
    this.screens.register('help', HelpScreen({ onBack: () => this.screens.back() }));
    this.screens.register('settings', settingsScreen);
    this.screens.show('mainmenu');

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
    onProgress(0.7);
    await this.renderer.compileAsync(this.world.scene, this.camera);
    onProgress(0.9);
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + CONFIG.player.eyeHeight, this.world.spawn.z);
    this.env.markShadowsDirty();
    this.fx.render();
    await frame();
    this.fx.render();
    this.world.remove(bot);
    this.world.remove(prop);
    this.world.shadowDirty = true;
    onProgress(1);
    await frame();
  }

  /* ---------------- state ---------------- */
  startGame() {
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
    this._lock();
    toast(STR.hud.hints);
  }

  pause() {
    if (this.state !== 'playing' || this.paused) return;
    this.paused = true;
    this.spawnMenu.close();
    this.screens.setBackdrop('dim');
    this.screens.show('pause');
  }

  resume() {
    this.paused = false;
    this.screens.setBackdrop('none');
    this.screens.hideAll();
    this._lock();
  }

  quitToMenu() {
    this.state = 'menu';
    this.paused = false;
    this.spawnMenu.close();
    this.hud.hide();
    this.screens.setBackdrop('menu');
    this.screens.show('mainmenu');
  }

  _lock() {
    const p = this.canvas.requestPointerLock();
    p?.catch?.(() => {
      if (this.state !== 'playing' || this.paused || this.spawnMenu.isOpen) return;
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
      if (this.state === 'playing' && !this.paused && !this.spawnMenu.isOpen) this._lock();
    }, { once: true });
  }

  /* ---------------- input ---------------- */
  _bindInput() {
    document.addEventListener('pointerlockchange', () => {
      this.input.locked = document.pointerLockElement === this.canvas;
      if (this.input.locked || this.state !== 'playing' || this.paused || this.spawnMenu.isOpen) return;
      if (this._inMenuGrace()) this._armRelock();
      else this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.state !== 'playing' || this.paused || this.spawnMenu.isOpen) return;
      if (this._inMenuGrace()) this._armRelock(); else this.pause();
    });

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
      } else if (code === 'KeyR' && !this.spawnMenu.isOpen) {
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

  spawnNextbot(id, point) {
    if (this.world.count('nextbot') >= CONFIG.limits.maxNextbots) { toast(STR.spawn.nextbotLimit); return; }
    const def = NextbotRegistry.get(id);
    this.world.add(new Nextbot(def, Assets.get(def.texture), point.x, point.z, this.player.pos, point.y));
    this.spawnMenu.updateCounts();
  }

  spawnProp(id, point) {
    if (this.world.count('prop') >= CONFIG.limits.maxProps) { toast(STR.spawn.propLimit); return; }
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
    this.world.remove(entity);
    toast(STR.spawn.removed(entity.displayName));
  }

  /* ---------------- loop ---------------- */
  _resize() {
    const w = window.innerWidth; const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(t) {
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (this.state !== 'playing') return;
    if (!this.paused) this._update(dt);
    if (this.world.shadowDirty) { this.env.markShadowsDirty(); this.world.shadowDirty = false; }
    this.fx.render();
  }

  _update(dt) {
    const cfg = CONFIG.catchState;
    this.player.update(dt, this.input, this.world);
    this.world.update(dt, { player: this.player, camera: this.camera });
    this._voidCheck();

    if (this.player.frozen) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.player.respawn();
        this.player.invulnerable = cfg.invulnerable;
        this.world.pushNextbotsFrom(this.world.spawn.x, this.world.spawn.z, cfg.pushRadius);
        this.hud.hideCaught();
      }
    } else {
      this.stats.survived += dt;
      if (this.player.invulnerable <= 0) {
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
    });
  }
}
