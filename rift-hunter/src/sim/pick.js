// OWNER: P2 — 계약 §6.8 · §11.5
// 광선 → 마우스 아래 대상(Hover · src 'pick'). 순수 — 상태 · 맵을 읽기만 한다.
// 몬스터: 세로 원기둥(반지름 mon.r · 높이 mon.height — 이미 등급 배율을 곱한 값) · 드랍: 상자(반 너비 PICKUP.dropPickR · 높이 dropPickH) ·
// 물체: 원기둥(r · h — 마을 물체는 h 없으면 PICKUP.objectH · 균열 포털 PICKUP.objectH). kinds 안에서 가장 가까운 교차 · 같은 거리면 몬스터 > 드랍 > 물체.

import { PICKUP } from '../data/combat.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */
/** @typedef {import('../types.js').Hover} Hover */
/** @typedef {{ox:number, oy:number, oz:number, dx:number, dy:number, dz:number}} Ray */

/** 같은 거리로 칠 차이(m) */
const TIE = 1e-6;
/** 몬스터 > 드랍 > 물체 */
const PRIORITY = { monster: 0, drop: 1, object: 2 };

/**
 * 세로 원기둥(중심 cx, cz · 반지름 r · y ∈ [0, h])과 광선이 처음 만나는 t(≥ 0) — 없으면 -1
 * @param {Ray} ray @param {number} cx @param {number} cz @param {number} r @param {number} h
 */
function rayCylinder(ray, cx, cz, r, h) {
  if (!(r > 0) || !(h > 0)) return -1;
  // XZ: |o + t·d − c|² ≤ r²
  const ox = ray.ox - cx, oz = ray.oz - cz;
  const a = ray.dx * ray.dx + ray.dz * ray.dz;
  const b = 2 * (ox * ray.dx + oz * ray.dz);
  const c = ox * ox + oz * oz - r * r;
  let t0, t1;
  if (a === 0) {
    if (c > 0) return -1;
    t0 = -Infinity;
    t1 = Infinity;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / (2 * a);
    t1 = (-b + s) / (2 * a);
  }
  // Y: 0 ≤ oy + t·dy ≤ h
  let y0, y1;
  if (ray.dy === 0) {
    if (ray.oy < 0 || ray.oy > h) return -1;
    y0 = -Infinity;
    y1 = Infinity;
  } else {
    const ta = (0 - ray.oy) / ray.dy, tb = (h - ray.oy) / ray.dy;
    y0 = Math.min(ta, tb);
    y1 = Math.max(ta, tb);
  }
  const lo = Math.max(t0, y0), hi = Math.min(t1, y1);
  if (lo > hi || hi < 0) return -1;
  return lo < 0 ? 0 : lo;
}

/**
 * 축 정렬 상자 [cx ± hw] × [0, h] × [cz ± hw]와 광선이 처음 만나는 t(≥ 0) — 없으면 -1(slab)
 * @param {Ray} ray @param {number} cx @param {number} cz @param {number} hw @param {number} h
 */
function rayBox(ray, cx, cz, hw, h) {
  slabLo = -Infinity;
  slabHi = Infinity;
  if (!slab(ray.ox, ray.dx, cx - hw, cx + hw) || !slab(ray.oy, ray.dy, 0, h) || !slab(ray.oz, ray.dz, cz - hw, cz + hw)) return -1;
  if (slabHi < 0) return -1;
  return slabLo < 0 ? 0 : slabLo;
}

/** rayBox 의 진행 구간(할당 없이 — 프레임마다 드랍 수만큼 불린다) */
let slabLo = -Infinity, slabHi = Infinity;
/** 한 축의 slab 으로 [slabLo, slabHi]를 좁힌다 — 비면 false @param {number} o @param {number} d @param {number} mn @param {number} mx */
function slab(o, d, mn, mx) {
  if (d === 0) return o >= mn && o <= mx;
  const ta = (mn - o) / d, tb = (mx - o) / d;
  if (ta < tb) {
    if (ta > slabLo) slabLo = ta;
    if (tb < slabHi) slabHi = tb;
  } else {
    if (tb > slabLo) slabLo = tb;
    if (ta < slabHi) slabHi = ta;
  }
  return slabLo <= slabHi;
}

/**
 * 순수 — ray = {ox, oy, oz, dx, dy, dz}(월드) → Hover|null(src 'pick')
 * @param {GameState} state @param {MapData|null} map
 * @param {Ray} ray @param {{kinds?:string[]}} [opts]
 * @returns {Hover|null}
 */
export function pickHover(state, map, ray, { kinds = ['monster', 'drop', 'object'] } = {}) {
  if (!ray || !state) return null;
  for (const k of ['ox', 'oy', 'oz', 'dx', 'dy', 'dz']) if (!Number.isFinite(/** @type {any} */ (ray)[k])) return null;
  const wantMon = kinds.includes('monster'), wantDrop = kinds.includes('drop'), wantObj = kinds.includes('object');
  /** @type {Hover|null} */
  let best = null;
  let bestT = Infinity;
  let bestP = Infinity;
  /** @param {number} t @param {'monster'|'drop'|'object'} kind @param {number|string} id */
  const consider = (t, kind, id) => {
    if (t < 0) return;
    const pr = PRIORITY[kind];
    if (t < bestT - TIE || (Math.abs(t - bestT) <= TIE && pr < bestP)) {
      bestT = t;
      bestP = pr;
      best = /** @type {Hover} */ ({ kind, id, src: 'pick' });
    }
  };
  const rift = state.scene === 'rift' ? state.rift : null;
  if (rift) {
    if (wantMon) {
      for (const m of rift.mons) {
        if (m.gone || m.dead || !(m.hp > 0)) continue;
        consider(rayCylinder(ray, m.pos.x, m.pos.z, m.r, m.height), 'monster', m.id);
      }
    }
    if (wantDrop) {
      for (const d of rift.drops) {
        if (d.gone) continue;
        consider(rayBox(ray, d.pos.x, d.pos.z, PICKUP.dropPickR, PICKUP.dropPickH), 'drop', d.id);
      }
    }
    if (wantObj) {
      for (const pt of rift.portals) consider(rayCylinder(ray, pt.pos.x, pt.pos.z, pt.r, PICKUP.objectH), 'object', pt.id);
    }
  } else if (wantObj && map && map.objects) {
    for (const o of map.objects) {
      if (o.kind === 'deco') continue;
      consider(rayCylinder(ray, o.x, o.z, o.r, o.h ?? PICKUP.objectH), 'object', o.id);
    }
  }
  return best;
}
