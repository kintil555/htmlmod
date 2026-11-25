import * as THREE from 'three/webgpu';
import { Entity } from './Entity.js';
import { Avatar } from './Avatar.js';
import { CONFIG } from '../config.js';
import { FLAG } from '../net/protocol.js';

const N = CONFIG.net;
const PLANE = new THREE.PlaneGeometry(1, 1);
const tagMats = new Map();

/** Name plate texture (cached per name). Colours and font come from the theme tokens. */
function tagMaterial(name) {
  if (!tagMats.has(name)) {
    const css = getComputedStyle(document.documentElement);
    const T = N.nameTag;
    const canvas = document.createElement('canvas');
    canvas.width = T.canvasW; canvas.height = T.canvasH;
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${T.font}px ${css.getPropertyValue('--font')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = T.outline;
    ctx.strokeStyle = css.getPropertyValue('--c-ink');
    ctx.fillStyle = css.getPropertyValue('--c-text');
    ctx.strokeText(name, T.canvasW / 2, T.canvasH / 2);
    ctx.fillText(name, T.canvasW / 2, T.canvasH / 2);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    tagMats.set(name, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  }
  return tagMats.get(name);
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Another player: skinned avatar + name plate, driven by state packets. `pos` is the feet position and `frozen` mirrors
 * the owner's caught state, so nextbot AI can treat a RemotePlayer exactly like the local Player.
 */
export class RemotePlayer extends Entity {
  constructor(id, name) {
    super('player');
    this.id = id;
    this.pos = new THREE.Vector3();
    this.radius = CONFIG.player.radius;
    this.frozen = false;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.speed = 0;
    /** Last packet as received: [x, y, z, yaw, pitch, flags]. The host forwards it to the other guests. */
    this.raw = null;
    this._target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this._fresh = false;
    this.avatar = Avatar.create();
    this.tag = new THREE.Mesh(PLANE, tagMaterial('?'));
    this.tag.position.y = CONFIG.net.avatar.height + N.nameTag.above;
    this.tag.scale.set(N.nameTag.width, N.nameTag.height, 1);
    this.object3d.add(this.avatar.group, this.tag);
    this.object3d.visible = false; // until the first state packet says where the player is
    this.setName(name);
  }

  setName(name) {
    this.name = name;
    this.displayName = name;
    this.tag.material = tagMaterial(name);
  }

  /** Applies a state packet [x, y, z, yaw, pitch, flags]. */
  setState(s) {
    if (!Array.isArray(s) || s.length < 6 || !s.every(Number.isFinite)) return;
    this.raw = s;
    const t = this._target;
    [t.x, t.y, t.z, t.yaw, t.pitch] = s;
    this.frozen = (s[5] & FLAG.dead) !== 0;
    this.onGround = (s[5] & FLAG.ground) !== 0;
    if (!this._fresh) {
      this._fresh = true;
      this.object3d.visible = true;
      this.pos.set(t.x, t.y, t.z);
      this.yaw = t.yaw; this.pitch = t.pitch;
    }
  }

  update(dt, ctx) {
    const t = this._target;
    const k = 1 - Math.exp(-N.playerSmooth * dt);
    const px = this.pos.x; const pz = this.pos.z;
    if (Math.hypot(t.x - px, t.z - pz) > N.teleportDist || Math.abs(t.y - this.pos.y) > N.teleportDist) this.pos.set(t.x, t.y, t.z);
    else this.pos.set(px + (t.x - px) * k, this.pos.y + (t.y - this.pos.y) * k, pz + (t.z - pz) * k);
    this.yaw += wrap(t.yaw - this.yaw) * k;
    this.pitch += (t.pitch - this.pitch) * k;
    const inst = dt > 0 ? Math.hypot(this.pos.x - px, this.pos.z - pz) / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);

    this.object3d.position.copy(this.pos);
    this.avatar.group.rotation.y = this.yaw;
    this.avatar.pose({ speed: this.speed, onGround: this.onGround, pitch: this.pitch, dead: this.frozen, dt });
    const cx = ctx.camera.position.x - this.pos.x; const cz = ctx.camera.position.z - this.pos.z;
    this.tag.rotation.y = Math.atan2(cx, cz);
  }

  onRemoved() { this.avatar.dispose(); }
}
