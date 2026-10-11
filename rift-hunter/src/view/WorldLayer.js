// OWNER: P7 — 계약 §6.14 · §9.4
// STUB — W1 에서 P7 이 채운다(던전 2타일셋 · 마을 건물 · 소품 메시 · 빛 풀 · 가리는 벽 낮추기 · 포털 · 균열석). W0: 「자리 표시」 —
//   바닥 = 회색 판 하나 · 벽 = 상자 인스턴스 · 소품 = 원기둥 · 마을 물체 = 상자/원기둥 · 상태를 읽어 그린다(포털 켜짐 · 균열 포털)

import * as THREE from 'three';
import { TILE, TILE_WALL } from '../core/constants.js';

const WALL_H = 3.0;
const COLORS = {
  floor: { crypt: 0x55524e, cavern: 0x4d3f37, town: 0x5b5446 },
  wall: { crypt: 0x8a857c, cavern: 0x6b5446, town: 0x7a6f60 },
  prop: 0x9a8f80,
  deco: 0x6e5a44,
  object: { townPortal: 0x7f6cff, riftStone: 0x9a62ff, stash: 0xc59b4a, npc: 0x3fa9a0 },
  portalOn: 0xb39bff,
  riftPortal: 0x7fd3ff,
};

export class WorldLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.group = new THREE.Group();
    rc.layers.world.add(this.group);
    /** @type {THREE.Object3D[]} */
    this._owned = [];
    /** @type {Map<string, THREE.Mesh>} */
    this._objects = new Map();
    this._portalGeo = new THREE.TorusGeometry(1, 0.12, 8, 24);
    this._portalMat = new THREE.MeshStandardMaterial({ color: COLORS.riftPortal, emissive: COLORS.riftPortal, emissiveIntensity: 0.6 });
    /** @type {THREE.Mesh[]} */
    this._portals = [];
    this.map = null;
  }

  _add(obj) {
    this.group.add(obj);
    this._owned.push(obj);
    return obj;
  }

  _clear() {
    for (const o of this._owned) {
      this.group.remove(o);
      o.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
      });
    }
    this._owned = [];
    this._objects.clear();
  }

  /** 이전 맵 지오메트리 해제 → 새 맵 @param {import('../types.js').MapData|null} map */
  setMap(map) {
    this._clear();
    this.map = map;
    if (!map) return;
    const ts = map.tileset;
    const b = map.bounds;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0),
      new THREE.MeshStandardMaterial({ color: COLORS.floor[ts] ?? COLORS.floor.crypt, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    this._add(floor);

    let walls = 0;
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_WALL) walls++;
    if (walls) {
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_H, TILE), new THREE.MeshStandardMaterial({ color: COLORS.wall[ts] ?? COLORS.wall.crypt, roughness: 0.9 }), walls);
      const m4 = new THREE.Matrix4();
      let k = 0;
      for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
        if (map.tiles[j * map.w + i] !== TILE_WALL) continue;
        m4.makeTranslation((i + 0.5) * TILE, WALL_H / 2, (j + 0.5) * TILE);
        inst.setMatrixAt(k++, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      this._add(inst);
    }

    for (const p of map.props) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, Math.max(0.05, p.h), 10), new THREE.MeshStandardMaterial({ color: COLORS.prop }));
      mesh.position.set(p.x, Math.max(0.05, p.h) / 2, p.z);
      this._add(mesh);
    }

    for (const o of map.objects) {
      let mesh;
      if (o.kind === 'deco' && o.w && o.d) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h ?? 3, o.d), new THREE.MeshStandardMaterial({ color: COLORS.deco }));
        mesh.position.set(o.x, (o.h ?? 3) / 2, o.z);
      } else {
        const color = o.kind === 'deco' ? 0xff8a3a : COLORS.object[o.kind] ?? COLORS.object.npc;
        const h = o.h ?? (o.kind === 'npc' ? 1.8 : 2.2);
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.8, o.r, h, 12), new THREE.MeshStandardMaterial({ color, emissive: o.kind === 'deco' ? 0x662200 : 0x000000 }));
        mesh.position.set(o.x, h / 2, o.z);
      }
      this._objects.set(o.id, /** @type {THREE.Mesh} */ (mesh));
      this._add(mesh);
    }
  }

  /** 상태를 읽어 포털 켜짐 · 균열 포털을 맞춘다 @param {import('../types.js').GameState} state */
  update(state, alpha, dtReal, cameraTarget) {
    const tp = this._objects.get('townPortal');
    if (tp) {
      const mat = /** @type {THREE.MeshStandardMaterial} */ (tp.material);
      mat.emissive.setHex(state.town.portalOpen ? COLORS.portalOn : 0x000000);
    }
    const portals = state.scene === 'rift' && state.rift ? state.rift.portals : [];
    while (this._portals.length < portals.length) {
      const m = new THREE.Mesh(this._portalGeo, this._portalMat);
      m.rotation.x = -Math.PI / 2;
      this.group.add(m);
      this._portals.push(m);
    }
    this._portals.forEach((m, i) => {
      const p = portals[i];
      m.visible = !!p;
      if (p) { m.position.set(p.pos.x, 0.1, p.pos.z); m.scale.setScalar(p.r); }
    });
  }

  dispose() {
    this._clear();
    for (const m of this._portals) this.group.remove(m);
    this._portalGeo.dispose();
    this._portalMat.dispose();
    this.rc.layers.world.remove(this.group);
  }
}
