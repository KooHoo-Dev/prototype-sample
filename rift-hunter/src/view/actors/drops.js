// OWNER: P8 — 계약 §9.5 「바닥 아이템」(내부 — 드랍 인스턴싱)
// 부위별 작은 메시가 바닥에 눕는다(검 · 투구 · 장갑 …) · 등급색 · 희귀 이상 테두리 발광 · 전설 · 세트는 빛기둥(원기둥 4m · 가산 · 0.35 · 천천히 맥동) ·
// 골드 동전 더미 3단계 · 포션 붉은 병 · 구슬 붉은 구 r 0.3(위아래로 흔들림) · 재료 결정(고철 회색 · 가루 파랑 · 정수 보라).
// 등장 = from → pos 0.35초 포물선(높이 1.0m · 진행 = 틱).

import { BufferAttribute, Color, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { ticks } from '../../core/time.js';
import { BASES_BY_ID } from '../../data/index.js';
import { build } from './geom.js';
import { weaponGeo } from './gear.js';

const PI = Math.PI;
/** 연출 상수 */
export const RARITY_HEX = Object.freeze({ normal: 0xe8e8e8, magic: 0x6f9bff, rare: 0xffd84a, legendary: 0xff9a2e, set: 0x4fe07a });
const MAT_HEX = { scrap: 0x9aa0a8, dust: 0x5aa0ff, essence: 0xb070ff };
const ARC_SEC = 0.35, ARC_H = 1.0;
const PILLAR = { h: 4, r: 0.28, opacity: 0.35 };
const GOLD_TIERS = [15, 80];
const CULL_R = 32;

/** 바닥에 누운 무기(+Y 날 → +X · 땅 위) */
function lyingWeapon(look) {
  const g = weaponGeo({ look, tier: 0, rarity: 'normal' });
  if (g?.glow) g.glow.dispose();
  const geo = g.main;
  geo.applyMatrix4(new Matrix4().makeRotationZ(-PI / 2));
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y + 0.01, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingSphere();
  return geo;
}
const coin = (x, y, z, c = '#f0c040') => ({ k: 'cyl', s: [0.05, 0.05, 0.016], p: [x, y, z], seg: 7, c });

const DROP_MESHES = {
  w_sword: { make: () => lyingWeapon('sword'), cap: 32 },
  w_axe: { make: () => lyingWeapon('axe'), cap: 32 },
  w_mace: { make: () => lyingWeapon('mace'), cap: 32 },
  w_greatsword: { make: () => lyingWeapon('greatsword'), cap: 32 },
  w_greataxe: { make: () => lyingWeapon('greataxe'), cap: 32 },
  w_wand: { make: () => lyingWeapon('wand'), cap: 32 },
  w_staff: { make: () => lyingWeapon('staff'), cap: 32 },
  shield: { make: () => build([{ k: 'cyl', s: [0.3, 0.3, 0.05], p: [0, 0.03, 0], seg: 8, c: '#7a5a3a' }, { k: 'cyl', s: [0.31, 0.31, 0.03], p: [0, 0.02, 0], seg: 8, c: '#9a9ea4' }, { k: 'ico', s: [0.06], p: [0, 0.07, 0], c: '#b0b4ba' }]), cap: 32 },
  orb: { make: () => build([{ k: 'ico', s: [0.1], d: 1, p: [0, 0.1, 0], c: '#9adcff' }, { k: 'box', s: [0.14, 0.03, 0.14], p: [0, 0.015, 0], c: '#9a9ea4' }]), cap: 32 },
  helm: { make: () => build([{ k: 'cyl', s: [0.13, 0.15, 0.14], p: [0, 0.07, 0], seg: 8, c: '#a0a4aa' }, { k: 'cone', s: [0.13, 0.08], p: [0, 0.18, 0], seg: 8, c: '#a0a4aa' }, { k: 'box', s: [0.03, 0.1, 0.03], p: [0, 0.06, 0.15], c: '#8a8e94' }]), cap: 32 },
  chest: { make: () => build([{ k: 'box', s: [0.36, 0.08, 0.42], p: [0, 0.04, 0], c: '#9a8a74' }, { k: 'box', s: [0.56, 0.07, 0.14], p: [0, 0.05, 0.16], c: '#8a7a64' }, { k: 'box', s: [0.38, 0.03, 0.06], p: [0, 0.09, -0.12], c: '#6a5a44' }]), cap: 32 },
  gloves: { make: () => build([{ k: 'box', s: [0.09, 0.06, 0.15], p: [-0.07, 0.03, 0], r: [0, 0.3, 0], c: '#8a6a4a' }, { k: 'box', s: [0.09, 0.06, 0.15], p: [0.08, 0.03, 0.02], r: [0, -0.4, 0], c: '#8a6a4a' }]), cap: 32 },
  boots: { make: () => build([{ k: 'box', s: [0.09, 0.16, 0.09], p: [-0.08, 0.08, -0.03], c: '#6a4a2e' }, { k: 'box', s: [0.09, 0.06, 0.2], p: [-0.08, 0.03, 0.03], c: '#5a3a24' }, { k: 'box', s: [0.09, 0.16, 0.09], p: [0.08, 0.08, -0.03], c: '#6a4a2e' }, { k: 'box', s: [0.09, 0.06, 0.2], p: [0.08, 0.03, 0.03], c: '#5a3a24' }]), cap: 32 },
  belt: { make: () => { const p = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; p.push({ k: 'box', s: [0.09, 0.025, 0.035], p: [Math.cos(a) * 0.13, 0.015, Math.sin(a) * 0.13], r: [0, -a + PI / 2, 0], c: '#6a4a2e' }); } p.push({ k: 'box', s: [0.06, 0.035, 0.05], p: [0.13, 0.02, 0], c: '#d0a840' }); return build(p); }, cap: 32 },
  amulet: { make: () => { const p = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; p.push({ k: 'box', s: [0.02, 0.012, 0.02], p: [Math.cos(a) * 0.09, 0.008, Math.sin(a) * 0.09], c: '#d0a840' }); } p.push({ k: 'oct', s: [0.045], p: [0, 0.03, 0.12], c: '#ff6a8a' }); return build(p); }, cap: 32 },
  ring: { make: () => { const p = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; p.push({ k: 'box', s: [0.025, 0.02, 0.02], p: [Math.cos(a) * 0.055, 0.012, Math.sin(a) * 0.055], c: '#d0a840' }); } p.push({ k: 'oct', s: [0.03], p: [0.055, 0.03, 0], c: '#7ad0ff' }); return build(p); }, cap: 32 },
  gold0: { make: () => build([coin(0, 0.008, 0), coin(0.06, 0.008, 0.03), coin(0.02, 0.024, -0.02)]), cap: 64 },
  gold1: { make: () => { const p = []; for (let i = 0; i < 9; i++) { const a = i * 2.4; p.push(coin(Math.cos(a) * 0.04 * Math.sqrt(i), 0.008 + (i % 3) * 0.016, Math.sin(a) * 0.04 * Math.sqrt(i))); } return build(p); }, cap: 64 },
  gold2: { make: () => { const p = [{ k: 'cone', s: [0.2, 0.16], p: [0, 0.08, 0], seg: 8, c: '#e0b030' }]; for (let i = 0; i < 12; i++) { const a = i * 2.4; p.push(coin(Math.cos(a) * 0.03 * (2 + Math.sqrt(i)), 0.008 + (i % 2) * 0.016, Math.sin(a) * 0.03 * (2 + Math.sqrt(i)))); } return build(p); }, cap: 64 },
  potion: { make: () => build([{ k: 'cyl', s: [0.065, 0.075, 0.15], p: [0, 0.075, 0], seg: 7, c: '#d02a2a' }, { k: 'cyl', s: [0.026, 0.03, 0.07], p: [0, 0.18, 0], seg: 6, c: '#e8d8d8' }, { k: 'cyl', s: [0.03, 0.028, 0.03], p: [0, 0.225, 0], seg: 6, c: '#8a5a3a' }]), cap: 32 },
  globe: { make: () => build([{ k: 'ico', s: [0.3], d: 1, c: '#ff2a2a' }, { k: 'ico', s: [0.1], d: 0, p: [0.1, 0.12, 0.18], c: '#ff9a9a' }]), cap: 32 },
  crystal: { make: () => build([{ k: 'oct', s: [0.12], p: [0, 0.16, 0], sc: [1, 1.6, 1] }, { k: 'oct', s: [0.07], p: [0.1, 0.08, 0.04], sc: [1, 1.5, 1], r: [0, 0, 0.5] }]), cap: 48 },
};

/** 기본형 ID → 메시 ID(처음 볼 때 한 번 — 프레임마다 문자열을 만들지 않는다) @type {Map<string, string>} */
const BASE_MESH = new Map();
function baseMesh(baseId) {
  let id = BASE_MESH.get(baseId);
  if (id === undefined) {
    const look = BASES_BY_ID[baseId]?.look ?? null;
    id = !look ? 'chest' : Object.prototype.hasOwnProperty.call(DROP_MESHES, 'w_' + look) ? 'w_' + look : Object.prototype.hasOwnProperty.call(DROP_MESHES, look) ? look : 'chest';
    BASE_MESH.set(baseId, id);
  }
  return id;
}

/** 아이템 → 메시 ID @param {import('../../types.js').Drop} d */
export function dropMeshId(d) {
  switch (d.kind) {
    case 'item': return d.item ? baseMesh(d.item.baseId) : 'chest';
    case 'gold': return d.amount < GOLD_TIERS[0] ? 'gold0' : d.amount < GOLD_TIERS[1] ? 'gold1' : 'gold2';
    case 'potion': return 'potion';
    case 'globe': return 'globe';
    default: return 'crystal';
  }
}

/** 빛기둥 지오메트리(열린 원기둥 · 정점 색 아래 밝음 → 위 0 — 가산이라 0 은 안 보인다) */
function pillarGeo() {
  const g = build([{ k: 'cyl', s: [PILLAR.r * 0.7, PILLAR.r, PILLAR.h], p: [0, PILLAR.h / 2, 0], seg: 10 }]);
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - Math.max(0, Math.min(1, pos.getY(i) / PILLAR.h));
    col.setXYZ(i, k, k, k);
  }
  /** @type {BufferAttribute} */ (col).needsUpdate = true;
  return g;
}

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _p = new Vector3(), _s = new Vector3(1, 1, 1), _c = new Color();

/** 결정적 각도(드랍 ID) */
function yawOfId(id) { return ((Math.imul(id | 0, 2654435761) >>> 0) / 4294967296) * PI * 2; }

export class DropInstancer {
  /** @param {import('three').Group} group @param {ReturnType<typeof import('./materials.js').makeInstanceMaterials>} mats */
  constructor(group, mats) {
    this.group = group;
    this.mats = mats;
    this.meshes = {};
    for (const id of Object.keys(DROP_MESHES)) {
      const spec = DROP_MESHES[id];
      const geo = spec.make();
      const cap = spec.cap;
      const glow = new Float32Array(cap * 4);
      geo.setAttribute('aGlow', new InstancedBufferAttribute(glow, 4));
      const mesh = new InstancedMesh(geo, id.startsWith('w_') || id === 'shield' || id === 'helm' ? mats.metal : mats.std, cap);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = 'drop:' + id;
      group.add(mesh);
      this.meshes[id] = { mesh, geo, cap, n: 0, glow, glowAttr: geo.getAttribute('aGlow') };
    }
    const pg = pillarGeo();
    this.pillar = new InstancedMesh(pg, mats.pillar, 32);
    this.pillar.instanceColor = new InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.pillar.count = 0;
    this.pillar.frustumCulled = false;
    this.pillar.renderOrder = 4;
    this.pillar.name = 'drop:pillar';
    group.add(this.pillar);
    this.pillarGeo = pg;
    this.drawn = 0;
  }

  reset() {
    for (const k of Object.keys(this.meshes)) { this.meshes[k].n = 0; this.meshes[k].mesh.count = 0; }
    this.pillar.count = 0;
  }

  /**
   * @param {import('../../types.js').Drop[]|null} drops @param {number} now @param {number} t 실제 시간 @param {{x:number,z:number}} ct @param {number|null} hoverId
   */
  update(drops, now, t, ct, hoverId) {
    const M = this.meshes;
    for (const k in M) M[k].n = 0;
    let np = 0, drawn = 0;
    if (drops) {
      const arcT = Math.max(1, ticks(ARC_SEC));
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.gone) continue;
        const dx = d.pos.x - ct.x, dz = d.pos.z - ct.z;
        if (dx * dx + dz * dz > CULL_R * CULL_R) continue;
        const e = M[dropMeshId(d)];
        if (!e || e.n >= e.cap) continue;
        const p = (now - d.born) / arcT;
        let x = d.pos.x, z = d.pos.z, y = 0, spin = 0;
        if (p < 1 && d.from) {
          const k = p < 0 ? 0 : p;
          x = d.from.x + (d.pos.x - d.from.x) * k;
          z = d.from.z + (d.pos.z - d.from.z) * k;
          y = ARC_H * 4 * k * (1 - k);
          spin = k * PI * 2;
        }
        let yaw = yawOfId(d.id);
        if (d.kind === 'globe') { y += 0.36 + 0.08 * Math.sin(t * 3 + d.id); yaw = t * 0.6; }
        if (d.kind === 'material') y += 0.02;
        _p.set(x, y, z);
        _e.set(spin, yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p, _q, _s);
        const idx = e.n++;
        e.mesh.instanceMatrix.array.set(_m.elements, idx * 16);
        // 색 · 발광
        let rr = 0, rg = 0, rb = 0, emit = 0.04;
        const col = /** @type {Float32Array} */ (e.mesh.instanceColor.array);
        if (d.kind === 'item') {
          const rar = d.rarity ?? 'normal';
          _c.setHex(RARITY_HEX[rar] ?? RARITY_HEX.normal);
          const k = rar === 'normal' ? 0 : 0.55;
          col[idx * 3] = 1 + (_c.r - 1) * k; col[idx * 3 + 1] = 1 + (_c.g - 1) * k; col[idx * 3 + 2] = 1 + (_c.b - 1) * k;
          const rim = rar === 'normal' ? 0 : rar === 'magic' ? 0.3 : 1.1;
          rr = _c.r * rim; rg = _c.g * rim; rb = _c.b * rim;
          if (rar === 'legendary' || rar === 'set') {
            emit = 0.18;
            if (p >= 1 && np < 32) {
              const pk = PILLAR.opacity * (0.8 + 0.2 * Math.sin(t * 2 + d.id));
              _m.makeTranslation(d.pos.x, 0, d.pos.z);
              this.pillar.instanceMatrix.array.set(_m.elements, np * 16);
              const pc = /** @type {Float32Array} */ (this.pillar.instanceColor.array);
              pc[np * 3] = _c.r * pk; pc[np * 3 + 1] = _c.g * pk; pc[np * 3 + 2] = _c.b * pk;
              np++;
            }
          }
        } else if (d.kind === 'material') {
          _c.setHex(MAT_HEX[d.mat] ?? MAT_HEX.scrap);
          col[idx * 3] = _c.r; col[idx * 3 + 1] = _c.g; col[idx * 3 + 2] = _c.b;
          emit = 0.3;
        } else {
          col[idx * 3] = 1; col[idx * 3 + 1] = 1; col[idx * 3 + 2] = 1;
          if (d.kind === 'globe') { emit = 0.45; rr = 0.8; rg = 0.1; rb = 0.1; }
          if (d.kind === 'gold') emit = 0.12;
        }
        if (hoverId === d.id) {
          const k = 0.6 + 0.35 * Math.sin(t * 7);
          rr = Math.max(rr, k); rg = Math.max(rg, k); rb = Math.max(rb, k);
        }
        const o4 = idx * 4;
        e.glow[o4] = rr; e.glow[o4 + 1] = rg; e.glow[o4 + 2] = rb; e.glow[o4 + 3] = emit;
        drawn++;
      }
    }
    for (const k in M) {
      const e = M[k];
      e.mesh.count = e.n;
      e.mesh.visible = e.n > 0;
      if (e.n > 0) {
        e.mesh.instanceMatrix.needsUpdate = true;
        /** @type {any} */ (e.mesh.instanceColor).needsUpdate = true;
        e.glowAttr.needsUpdate = true;
      }
    }
    this.pillar.count = np;
    this.pillar.visible = np > 0;
    if (np > 0) {
      this.pillar.instanceMatrix.needsUpdate = true;
      /** @type {any} */ (this.pillar.instanceColor).needsUpdate = true;
    }
    this.drawn = drawn;
    this.pillars = np;
  }

  meshCount() { return Object.keys(this.meshes).length + 1; }

  dispose() {
    for (const k of Object.keys(this.meshes)) {
      const e = this.meshes[k];
      this.group.remove(e.mesh);
      e.geo.dispose();
      e.mesh.dispose();
    }
    this.group.remove(this.pillar);
    this.pillarGeo.dispose();
    this.pillar.dispose();
    this.meshes = {};
  }
}

export { PILLAR, DROP_MESHES };
