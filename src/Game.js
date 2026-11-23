import * as THREE from 'three';
import { CONFIG } from './config.js';
import { STR } from './content/strings.js';
import { NextbotRegistry, PropRegistry } from './core/registries.js';
import { Assets } from './core/Assets.js';
import { Input } from './core/Input.js';
import { World } from './world/World.js';
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
    this._escCloseAt = -Infinity;
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
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(CONFIG.player.fov, 1, 0.1, 600);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.screens = new ScreenManager(this.uiRoot);
    this.screens.setBackdrop('menu');
    const bar = el('div', { class: 'loading__fill' });
    const loading = el('div', { class: 'loading' }, STR.loading, el('div', { class: 'loading__bar' }, bar));
    this.screens.register('loading', loading);
    this.screens.show('loading');

    const urls = [...NextbotRegistry.all().map(d => d.texture)];
    await Assets.preload(urls, p => { bar.style.width = `${Math.round(p * 100)}%`; });

    this.world = new World();
    this.input = new Input();
    this.input.attach();
    this.player = new Player(this.camera);
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
    p?.catch?.(() => { if (this.state === 'playing' && !this.paused) this.pause(); });
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
      if (performance.now() - this._escCloseAt < CONFIG.spawnMenu.escGraceMs) this._armRelock();
      else this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (performance.now() - this._escCloseAt < CONFIG.spawnMenu.escGraceMs) { this._armRelock(); return; }
      if (this.state === 'playing' && !this.paused) this.pause();
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

  _closeSpawnMenu() {
    this.spawnMenu.close();
    if (this.state === 'playing' && !this.paused) this._lock();
  }

  /** Esc is not a user gesture and the browser may eat it as a pointer-lock exit: close the menu, wait for a click to relock, never pause. */
  _closeMenuByEsc() {
    this._escCloseAt = performance.now();
    this.spawnMenu.close();
    this._armRelock();
  }

  /* ---------------- tools ---------------- */
  /** Where the crosshair hits the world. Falls back to 10 units ahead on the ground. */
  aimPoint() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.aimTargets(), false)[0];
    const lim = CONFIG.world.halfSize - 3;
    const p = hit ? hit.point.clone() : this.raycaster.ray.at(10, new THREE.Vector3());
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
    p.y = 0;
    return p;
  }

  spawnNextbot(id, point) {
    if (this.world.count('nextbot') >= CONFIG.limits.maxNextbots) { toast(STR.spawn.nextbotLimit); return; }
    const def = NextbotRegistry.get(id);
    this.world.add(new Nextbot(def, Assets.get(def.texture), point.x, point.z, this.player.pos));
    this.spawnMenu.updateCounts();
  }

  spawnProp(id, point) {
    if (this.world.count('prop') >= CONFIG.limits.maxProps) { toast(STR.spawn.propLimit); return; }
    this.world.add(new Prop(PropRegistry.get(id), point.x, point.z));
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
    this.renderer.render(this.world.scene, this.camera);
  }

  _update(dt) {
    const cfg = CONFIG.catchState;
    this.player.update(dt, this.input, this.world);
    this.world.update(dt, { player: this.player, camera: this.camera });

    if (this.player.frozen) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.player.respawn();
        this.player.invulnerable = cfg.invulnerable;
        this.world.pushNextbotsFrom(CONFIG.player.spawn.x, CONFIG.player.spawn.z, cfg.pushRadius);
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

  _onCaught(bot) {
    this.stats.caught++;
    this.stats.survived = 0;
    this.player.frozen = true;
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
