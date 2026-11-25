import * as THREE from 'three/webgpu';
import { Assets } from '../core/Assets.js';
import { SkyAmbient } from '../world/SkyAmbient.js';
import { CONFIG } from '../config.js';

const A = CONFIG.net.avatar;
const G = A.gait;
const L = A.look;

const COMPONENT = {
  5120: [Int8Array, 'getInt8'], 5121: [Uint8Array, 'getUint8'], 5122: [Int16Array, 'getInt16'],
  5123: [Uint16Array, 'getUint16'], 5125: [Uint32Array, 'getUint32'], 5126: [Float32Array, 'getFloat32'],
};
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Copies one glTF accessor out of the binary buffer into a tight typed array (honours byteStride). */
function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const [Type, getter] = COMPONENT[acc.componentType];
  const n = WIDTH[acc.type];
  const out = new Type(acc.count * n);
  const dv = new DataView(bin);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? n * Type.BYTES_PER_ELEMENT;
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) out[i * n + k] = dv[getter](base + i * stride + k * Type.BYTES_PER_ELEMENT, true);
  }
  return out;
}

let asset = null;

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * Skinned human model (assets/players/male07, glTF) with a procedural walk cycle: the file has no animations, so legs, arms,
 * spine and head are posed from the player's speed, pitch and state. Built once (preload), cloned per player (create).
 * The model is normalised at build time: feet at y = 0, forward = -Z (same as a player with yaw 0), height = CONFIG.net.avatar.height.
 */
export const Avatar = {
  /** Loads geometry + texture once. Call before create(). */
  async preload() {
    if (asset) return;
    const base = new URL(A.url, document.baseURI);
    const json = await (await fetch(base)).json();
    const bin = await (await fetch(new URL(json.buffers[0].uri, base))).arrayBuffer();
    const prim = json.meshes[0].primitives[0];
    const at = prim.attributes;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(readAccessor(json, bin, at.POSITION), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(readAccessor(json, bin, at.NORMAL), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(readAccessor(json, bin, at.TEXCOORD_0), 2));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(readAccessor(json, bin, at.JOINTS_0), 4));
    const weights = readAccessor(json, bin, at.WEIGHTS_0);
    for (let i = 0; i < weights.length; i += 4) {
      const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
      if (sum > 0) for (let k = 0; k < 4; k++) weights[i + k] /= sum;
    }
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    geometry.setIndex(new THREE.BufferAttribute(readAccessor(json, bin, prim.indices), 1));
    const texture = await Assets.texture(new URL(json.images[0].uri, base).href, { flipY: false, repeat: true });
    const material = new THREE.MeshLambertNodeMaterial({ map: texture, side: THREE.DoubleSide });
    material.aoNode = SkyAmbient.node;
    const inverses = readAccessor(json, bin, json.skins[0].inverseBindMatrices);
    asset = { json, geometry, material, inverses };
  },

  /** A fresh posable instance: { group, pose(state), dispose() }. state = { speed, onGround, pitch, dead, dt }. */
  create() {
    if (!asset) throw new Error('Avatar.preload() has not finished');
    const { json, geometry, material, inverses } = asset;
    const skin = json.skins[0];
    const joints = new Set(skin.joints);
    const objs = json.nodes.map((n, i) => {
      const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
      o.name = n.name ?? '';
      if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); } else {
        if (n.translation) o.position.fromArray(n.translation);
        if (n.rotation) o.quaternion.fromArray(n.rotation);
        if (n.scale) o.scale.fromArray(n.scale);
      }
      return o;
    });
    json.nodes.forEach((n, i) => n.children?.forEach(c => objs[i].add(objs[c])));

    const wrapper = new THREE.Group();
    const align = new THREE.Group();
    wrapper.add(align);
    align.add(objs[json.scenes[json.scene].nodes[0]]);
    const meshNode = json.nodes.findIndex(n => n.mesh !== undefined && n.skin !== undefined);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objs[meshNode].add(mesh);

    const bones = skin.joints.map(j => objs[j]);
    const boneInverses = bones.map((_, i) => new THREE.Matrix4().fromArray(inverses, i * 16));
    wrapper.updateMatrixWorld(true);
    // Identity bind matrix, like three's GLTFLoader: the file's inverse bind matrices already hold the whole bind pose (in the rig's own cm units).
    // Binding with mesh.matrixWorld here applied the node scale twice, so every bone pivoted about the wrong point (flat head, stretched legs).
    mesh.bind(new THREE.Skeleton(bones, boneInverses), new THREE.Matrix4());

    const bone = key => {
      const b = bones.find(x => x.name === A.rig[key]);
      if (!b) throw new Error(`Avatar rig: bone "${A.rig[key]}" not found`);
      return b;
    };
    const B = Object.fromEntries(Object.keys(A.rig).map(k => [k, bone(k)]));

    // Face -Z (the direction a player with yaw 0 looks): the toes point along the model's forward.
    wrapper.updateMatrixWorld(true);
    B.footL.getWorldPosition(_p0);
    B.toesL.getWorldPosition(_p1);
    align.rotation.y = Math.PI - Math.atan2(_p1.x - _p0.x, _p1.z - _p0.z);
    wrapper.updateMatrixWorld(true);

    // Height + feet on y = 0 (the skinned bounds follow the bind pose).
    mesh.computeBoundingBox();
    const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const k = A.height / (box.max.y - box.min.y);
    align.scale.setScalar(k);
    align.position.y = -box.min.y * k;
    wrapper.updateMatrixWorld(true);

    // Rotates `b` so the segment b -> child points along `dir` (wrapper space).
    const aim = (b, child, dir) => {
      b.getWorldPosition(_p0);
      child.getWorldPosition(_p1);
      _dir.subVectors(_p1, _p0).normalize();
      _q.setFromUnitVectors(_dir, dir.clone().normalize());
      b.getWorldQuaternion(_wq).premultiply(_q);
      b.parent.getWorldQuaternion(_pq);
      b.quaternion.copy(_pq.invert().multiply(_wq));
      wrapper.updateMatrixWorld(true);
    };
    // Arms hang down (the file is in an A/T pose). The side is whichever way the arm already points.
    for (const [arm, elbow, hand] of [[B.armL, B.elbowL, B.handL], [B.armR, B.elbowR, B.handR]]) {
      arm.getWorldPosition(_p0);
      const side = Math.sign(_p0.x - wrapper.position.x) || 1;
      aim(arm, elbow, new THREE.Vector3(side * A.armDrop.out, -1, -A.armDrop.forward));
      aim(elbow, hand, new THREE.Vector3(side * A.elbowDrop.out, -1, A.elbowDrop.forward));
    }

    // Per posed bone: its rest rotation and the wrapper X axis (the body's left-right) expressed in the parent's frame.
    const rig = key => {
      const b = B[key];
      b.parent.getWorldQuaternion(_pq);
      return { bone: b, rest: b.quaternion.clone(), axis: RIGHT.clone().applyQuaternion(_pq.invert()) };
    };
    const R = Object.fromEntries(['thighL', 'thighR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'spine', 'chest', 'neck', 'head'].map(k2 => [k2, rig(k2)]));
    const swing = (r, angle) => r.bone.quaternion.setFromAxisAngle(r.axis, angle).multiply(r.rest);

    let phase = 0;
    let amp = 0;
    let fall = 0;
    const group = new THREE.Group();
    group.add(wrapper);

    return {
      group,
      /** Positive angle about X swings a limb forward (-Z); a knee or elbow flexes with the opposite sign conventions below. */
      pose({ speed, onGround, pitch, dead, dt }) {
        const target = onGround ? Math.min(1, speed / G.speedFull) : 0;
        amp += (target - amp) * Math.min(1, dt * G.blend);
        if (onGround && speed > 0.5) phase += Math.PI * 2 * (speed / G.stride) * dt;
        const s = Math.sin(phase);
        const c = Math.cos(phase);
        if (onGround) {
          swing(R.thighL, s * G.swing * amp);
          swing(R.thighR, -s * G.swing * amp);
          swing(R.kneeL, -Math.max(0, c) * G.knee * amp);
          swing(R.kneeR, -Math.max(0, -c) * G.knee * amp);
          swing(R.armL, -s * G.arm * amp);
          swing(R.armR, s * G.arm * amp);
          swing(R.elbowL, G.elbow * (0.4 + 0.6 * amp));
          swing(R.elbowR, G.elbow * (0.4 + 0.6 * amp));
        } else {
          swing(R.thighL, A.air.thighFront);
          swing(R.thighR, A.air.thighBack);
          swing(R.kneeL, -A.air.knee);
          swing(R.kneeR, -A.air.knee * 0.5);
          swing(R.armL, -A.air.arm);
          swing(R.armR, A.air.arm);
          swing(R.elbowL, G.elbow);
          swing(R.elbowR, G.elbow);
        }
        swing(R.spine, -G.lean * amp);
        swing(R.chest, pitch * L.chest);
        swing(R.neck, pitch * L.neck);
        swing(R.head, pitch * L.head);
        // A caught player falls over backwards and stays down.
        fall += ((dead ? 1 : 0) - fall) * Math.min(1, dt * A.fall.rate);
        wrapper.rotation.x = fall * A.fall.angle;
      },
      dispose() { mesh.skeleton.dispose(); },
    };
  },
};
