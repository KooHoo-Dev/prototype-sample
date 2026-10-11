// OWNER: P8 — 계약 §6.14 · §9.5 · §9.6
// STUB — W1 에서 P8 이 채운다(전사 · 마법사 리그 · 장비 외형 · 몬스터 템플릿 5 인스턴싱 · 포즈 · 등급 발광 · 시체 · NPC · 바닥 아이템 · 빛기둥 · 가림 외곽선).
// W0: 「자리 표시」 — 플레이어 = 파란 원기둥 · 몬스터 = 등급색 원기둥(InstancedMesh · 몸 폭 2 × mon.r · 높이 mon.height) · 드랍 = 등급색 작은 상자 · 상태를 읽어 그린다

import * as THREE from 'three';

const MAX_MONS = 160;
const MAX_DROPS = 128;
const RANK_COLOR = { normal: 0xc9c4b8, champion: 0x3d7bff, elite: 0xffd23d, minion: 0xd8b860, guardian: 0xff5a3d, split: 0x9aa0a8, spawn: 0xa8a090 };
const RARITY_COLOR = { normal: 0xe8e8e8, magic: 0x6f9bff, rare: 0xffd84a, legendary: 0xff9a2e, set: 0x4fe07a };
const DROP_COLOR = { gold: 0xffc83a, potion: 0xd02a2a, globe: 0xff3a3a, material: 0x9a7cff };
const DEAD_TINT = 0x4a4744;
const CULL_R = 32;

export class ActorLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.group = new THREE.Group();
    rc.layers.actors.add(this.group);
    this.player = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 16), new THREE.MeshStandardMaterial({ color: 0x3a7bff }));
    this.facing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    this.group.add(this.player, this.facing);
    // 단위 원기둥(반지름 1 · 높이 1 · 바닥 y=0) — 인스턴스 행렬로 크기를 준다
    const monGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
    monGeo.translate(0, 0.5, 0);
    this.mons = new THREE.InstancedMesh(monGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), MAX_MONS);
    this.mons.count = 0;
    this.mons.frustumCulled = false;
    const dropGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4);
    dropGeo.translate(0, 0.15, 0);
    this.drops = new THREE.InstancedMesh(dropGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }), MAX_DROPS);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.group.add(this.mons, this.drops);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** 마을 NPC · 맵 경계(W0: 없음) @param {import('../types.js').MapData|null} map */
  setMap(map) {}

  /** @param {import('../types.js').GameState} state @param {number} alpha */
  update(state, alpha, dtReal, cameraTarget) {
    const p = state.player;
    const lerp = (a, b) => a + (b - a) * alpha;
    const px = lerp(p.prevPos.x, p.pos.x), pz = lerp(p.prevPos.z, p.pos.z);
    this.player.position.set(px, p.dead ? 0.2 : 0.9, pz);
    this.player.scale.y = p.dead ? 0.2 : 1;
    this.facing.position.set(px + Math.sin(p.facing) * 0.5, 1.2, pz + Math.cos(p.facing) * 0.5);
    this.facing.rotation.y = p.facing;
    const ct = cameraTarget ?? { x: px, z: pz };

    let n = 0;
    const rift = state.scene === 'rift' ? state.rift : null;
    if (rift) {
      for (const m of rift.mons) {
        if (m.gone || n >= MAX_MONS) continue;
        const x = lerp(m.prevPos.x, m.pos.x), z = lerp(m.prevPos.z, m.pos.z);
        if (Math.hypot(x - ct.x, z - ct.z) > CULL_R) continue;
        const h = m.dead ? 0.15 : m.height;
        this._p.set(x, 0, z);
        this._q.setFromAxisAngle(this._up, m.facing);
        this._s.set(m.r, h, m.r);
        this._m4.compose(this._p, this._q, this._s);
        this.mons.setMatrixAt(n, this._m4);
        this._c.setHex(m.dead ? DEAD_TINT : RANK_COLOR[m.rank] ?? RANK_COLOR.normal);
        if (!m.dead && (m.act === 'windup' || m.act === 'cast' || m.act === 'swell')) this._c.lerp(new THREE.Color(0xff3b30), 0.35);
        if (!m.dead && (m.act === 'frozen')) this._c.lerp(new THREE.Color(0x5ac8ff), 0.6);
        this.mons.setColorAt(n, this._c);
        n++;
      }
    }
    this.mons.count = n;
    this.mons.instanceMatrix.needsUpdate = true;
    if (this.mons.instanceColor) this.mons.instanceColor.needsUpdate = true;

    let d = 0;
    if (rift) {
      for (const dr of rift.drops) {
        if (dr.gone || d >= MAX_DROPS) continue;
        if (Math.hypot(dr.pos.x - ct.x, dr.pos.z - ct.z) > CULL_R) continue;
        this._p.set(dr.pos.x, 0, dr.pos.z);
        this._q.identity();
        const big = dr.kind === 'gold' ? Math.min(2, 0.6 + Math.log10(1 + dr.amount) * 0.5) : 1;
        this._s.set(big, big, big);
        this._m4.compose(this._p, this._q, this._s);
        this.drops.setMatrixAt(d, this._m4);
        this._c.setHex(dr.item ? RARITY_COLOR[dr.rarity] ?? RARITY_COLOR.normal : DROP_COLOR[dr.kind] ?? 0xffffff);
        this.drops.setColorAt(d, this._c);
        d++;
      }
    }
    this.drops.count = d;
    this.drops.instanceMatrix.needsUpdate = true;
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const o of [this.player, this.facing, this.mons, this.drops]) {
      this.group.remove(o);
      o.geometry.dispose();
      /** @type {THREE.Material} */ (o.material).dispose();
    }
    this.rc.layers.actors.remove(this.group);
  }
}
