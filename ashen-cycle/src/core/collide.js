// OWNER: P0 — 계약 §3.7 · §6.1 (완전 구현)
// 월드 충돌 기하. sim(§5.1 G) · bot · view(카메라 충돌) · 테스트가 같은 함수를 쓴다.
import { EPS } from './constants.js';

/** @typedef {import('../types.js').Vec2} Vec2 */
/** @typedef {import('../types.js').WorldDef} WorldDef */

/**
 * pos(반경 radius)를 원 (ox, oz, or) 밖으로 민다. 겹침이 없으면 그대로.
 * 중심이 정확히 겹치면 +Z 쪽으로 민다(NaN 금지).
 * @param {Vec2} pos 제자리에서 고친다
 * @param {number} radius
 * @param {number} ox
 * @param {number} oz
 * @param {number} or
 * @returns {boolean} 밀었으면 true
 */
export function pushOutOfCircle(pos, radius, ox, oz, or) {
  const dx = pos.x - ox;
  const dz = pos.z - oz;
  const min = radius + or;
  const d = Math.hypot(dx, dz);
  if (d >= min) return false;
  if (d < EPS) {
    pos.x = ox;
    pos.z = oz + min;
    return true;
  }
  const k = min / d;
  pos.x = ox + dx * k;
  pos.z = oz + dz * k;
  return true;
}

/**
 * pos(반경 radius)를 축 정렬 상자 밖으로 민다.
 * @param {Vec2} pos
 * @param {number} radius
 * @param {{x:number, z:number, hw:number, hd:number}} box
 * @returns {boolean}
 */
function pushOutOfBox(pos, radius, box) {
  const lx = pos.x - box.x;
  const lz = pos.z - box.z;
  const inside = Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd;
  if (inside) {
    // 중심이 상자 안: 가장 얕은 축으로 밀어낸다(동률이면 z).
    const penX = box.hw - Math.abs(lx);
    const penZ = box.hd - Math.abs(lz);
    if (penX < penZ) pos.x = box.x + (lx >= 0 ? 1 : -1) * (box.hw + radius);
    else pos.z = box.z + (lz >= 0 ? 1 : -1) * (box.hd + radius);
    return true;
  }
  const qx = Math.max(-box.hw, Math.min(box.hw, lx));
  const qz = Math.max(-box.hd, Math.min(box.hd, lz));
  const dx = lx - qx;
  const dz = lz - qz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return false;
  // 중심이 상자 밖이므로 d > 0이다.
  const k = radius / d;
  pos.x = box.x + qx + dx * k;
  pos.z = box.z + qz + dz * k;
  return true;
}

/**
 * 원 pos를 월드와 충돌 해소한다: 콜라이더(원 · 축 정렬 상자) 밖으로 민 뒤 경계 안으로(len(pos) ≤ world.radius − radius).
 * @param {Vec2} pos 제자리에서 고친다
 * @param {number} radius
 * @param {WorldDef} world
 * @returns {boolean} 고쳤으면 true
 */
export function resolveCircleVsWorld(pos, radius, world) {
  let changed = false;
  const colliders = world.colliders;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.type === 'circle') {
      if (pushOutOfCircle(pos, radius, c.x, c.z, c.r)) changed = true;
    } else if (pushOutOfBox(pos, radius, c)) {
      changed = true;
    }
  }
  const max = Math.max(0, world.radius - radius);
  const l = Math.hypot(pos.x, pos.z);
  if (l > max) {
    const k = l > 0 ? max / l : 0;
    pos.x *= k;
    pos.z *= k;
    changed = true;
  }
  return changed;
}

/**
 * 원 (x, z, radius)이 콜라이더와 겹치거나 경계 밖이면 true(순간이동 목적지 · 스폰 검사).
 * 맞닿은 것(EPS 이내)은 겹침으로 보지 않는다 — resolveCircleVsWorld의 결과는 false다.
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {WorldDef} world
 * @returns {boolean}
 */
export function circleOverlapsWorld(x, z, radius, world) {
  if (Math.hypot(x, z) > world.radius - radius + EPS) return true;
  const colliders = world.colliders;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.type === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + radius - EPS) return true;
    } else {
      const dx = Math.max(0, Math.abs(x - c.x) - c.hw);
      const dz = Math.max(0, Math.abs(z - c.z) - c.hd);
      if (Math.hypot(dx, dz) < radius - EPS) return true;
    }
  }
  return false;
}

/**
 * 원 (x, z, radius)을 단위 방향 (dx, dz)로 곧게 옮길 때 콜라이더 · 경계에 처음 닿기까지 갈 수 있는 거리(0..dist).
 * 도약처럼 「목적지를 먼저 정하고 가는」 이동이 쓴다 — 길이 막혔으면 그 앞을 목적지로 삼는다(매 틱 되밀려 제자리에 걸리지 않게).
 * 이미 맞닿았거나 겹친 원 콜라이더는 그 안쪽으로 파고드는 방향일 때만 막는다(멀어지는 방향은 그대로 간다).
 * 상자는 radius만큼 부풀린 축 정렬 상자로 본다(모서리에서 조금 일찍 멈춘다). 이미 그 안이면 막지 않는다(밀어내기가 푼다).
 * @param {number} x
 * @param {number} z
 * @param {number} dx 단위 방향
 * @param {number} dz
 * @param {number} dist 가려는 거리(≥ 0)
 * @param {number} radius
 * @param {WorldDef} world
 * @returns {number}
 */
export function sweepCircleVsWorld(x, z, dx, dz, dist, radius, world) {
  if (!(dist > 0)) return 0;
  let best = dist;
  const colliders = world.colliders;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.type === 'circle') {
      const fx = x - c.x;
      const fz = z - c.z;
      const R = c.r + radius;
      const b = fx * dx + fz * dz;
      if (b >= 0) continue;                     // 멀어지거나 스쳐 지나간다
      const cc = fx * fx + fz * fz - R * R;
      if (cc <= EPS) return 0;                  // 이미 맞닿은 채 파고든다
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < best) best = t;
    } else {
      const hw = c.hw + radius;
      const hd = c.hd + radius;
      const lx = x - c.x;
      const lz = z - c.z;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) continue;
      let t0 = 0;
      let t1 = best;
      let miss = false;
      for (let axis = 0; axis < 2 && !miss; axis++) {
        const p = axis === 0 ? lx : lz;
        const d = axis === 0 ? dx : dz;
        const h = axis === 0 ? hw : hd;
        if (Math.abs(d) < EPS) {
          if (Math.abs(p) >= h) miss = true;
        } else {
          const a = (-h - p) / d;
          const b = (h - p) / d;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
          if (t0 > t1) miss = true;
        }
      }
      if (!miss && t0 < best) best = t0;
    }
  }
  // 경계: len(pos) ≤ world.radius − radius
  const lim = Math.max(0, world.radius - radius);
  const b = x * dx + z * dz;
  const cc = x * x + z * z - lim * lim;
  if (cc >= 0) {
    if (b > 0) return 0;                        // 경계에 닿은 채 바깥으로
  } else {
    const t = -b + Math.sqrt(b * b - cc);
    if (t < best) best = t;
  }
  return best > 0 ? best : 0;
}

/**
 * 선분 a→b가 원 (cx, cz, cr)에 처음 닿는 매개변수 t(0..1). a가 이미 원 안이면 0. 안 닿으면 null.
 * (카메라 충돌 · 시선 검사)
 * @returns {number|null}
 */
export function segmentHitsCircle(ax, az, bx, bz, cx, cz, cr) {
  const fx = ax - cx;
  const fz = az - cz;
  const c = fx * fx + fz * fz - cr * cr;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
