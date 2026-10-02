// OWNER: P0 — 계약 §3.2 · §6.1 (완전 구현)
// 셰이프 판정. sim · bot · fx(텔레그래프) · 테스트가 전부 이 함수를 쓴다.
import { angleDiff, angleOf, clamp01, distPointSegment, lerp, localToWorld, wrapAngle } from './math2d.js';

/** @typedef {import('../types.js').ShapeDef} ShapeDef */
/** @typedef {import('../types.js').HitShape} HitShape */

/**
 * 상대 셰이프(ShapeDef)를 월드 공간(HitShape)으로 푼다.
 *   circle  → 중심 localToWorld(x, z, facing, fwd ?? 0, side ?? 0)
 *   arc     → dir = wrapAngle(facing + (dirOffset ?? 0)), rInner ?? 0
 *   ring    → 원점 그대로
 *   capsule → a = localToWorld(…, fwd0, side ?? 0), b = localToWorld(…, fwd1, side ?? 0)
 * @param {ShapeDef} def
 * @param {number} x 원점 x
 * @param {number} z 원점 z
 * @param {number} facing 기준 방향(rad)
 * @returns {HitShape}
 */
export function resolveShape(def, x, z, facing) {
  switch (def.type) {
    case 'circle': {
      const c = localToWorld(x, z, facing, def.fwd ?? 0, def.side ?? 0);
      return { type: 'circle', x: c.x, z: c.z, r: def.r };
    }
    case 'arc':
      return {
        type: 'arc',
        x,
        z,
        r: def.r,
        rInner: def.rInner ?? 0,
        dir: wrapAngle(facing + (def.dirOffset ?? 0)),
        halfAngle: def.halfAngle,
      };
    case 'ring':
      return { type: 'ring', x, z, rInner: def.rInner, rOuter: def.rOuter };
    case 'capsule': {
      const side = def.side ?? 0;
      const a = localToWorld(x, z, facing, def.fwd0, side);
      const b = localToWorld(x, z, facing, def.fwd1, side);
      return { type: 'capsule', ax: a.x, az: a.z, bx: b.x, bz: b.z, r: def.r };
    }
    default:
      throw new Error(`resolveShape: unknown shape type '${def && def.type}'`);
  }
}

/**
 * 월드 셰이프 × 원 → 명중 여부. d = 셰이프 원점(캡슐은 선분)에서 원 중심까지 거리.
 *   circle  : d ≤ r + cr
 *   ring    : d + cr ≥ rInner && d − cr ≤ rOuter
 *   arc     : d − cr ≤ r && d + cr ≥ rInner &&
 *             (halfAngle ≥ π || d ≤ cr || |angleDiff(dir, angleOf(c − o))| ≤ halfAngle + asin(min(1, cr / d)))
 *   capsule : distPointSegment(c, a, b) ≤ r + cr
 * @param {HitShape} shape
 * @param {number} cx 대상 원 중심 x
 * @param {number} cz
 * @param {number} cr 대상 원 반경
 * @returns {boolean}
 */
export function shapeHitsCircle(shape, cx, cz, cr) {
  switch (shape.type) {
    case 'circle':
      return Math.hypot(cx - shape.x, cz - shape.z) <= shape.r + cr;
    case 'ring': {
      const d = Math.hypot(cx - shape.x, cz - shape.z);
      return d + cr >= shape.rInner && d - cr <= shape.rOuter;
    }
    case 'arc': {
      const dx = cx - shape.x;
      const dz = cz - shape.z;
      const d = Math.hypot(dx, dz);
      if (d - cr > shape.r || d + cr < shape.rInner) return false;
      if (shape.halfAngle >= Math.PI || d <= cr) return true;
      const off = Math.abs(angleDiff(shape.dir, angleOf(dx, dz)));
      return off <= shape.halfAngle + Math.asin(Math.min(1, cr / d));
    }
    case 'capsule':
      return distPointSegment(cx, cz, shape.ax, shape.az, shape.bx, shape.bz) <= shape.r + cr;
    default:
      throw new Error(`shapeHitsCircle: unknown shape type '${shape && shape.type}'`);
  }
}

/**
 * 충격파 띠. 중심 반경 c = lerp(r0, r1, u), rInner = max(0, c − width/2), rOuter = c + width/2.
 * @param {number} x 원점 x
 * @param {number} z
 * @param {{r0:number, r1:number, width:number}} grow
 * @param {number} u 0..1 (범위 밖은 자른다)
 * @returns {{type:'ring', x:number, z:number, rInner:number, rOuter:number}}
 */
export function ringFromGrow(x, z, grow, u) {
  const c = lerp(grow.r0, grow.r1, clamp01(u));
  const half = grow.width / 2;
  return { type: 'ring', x, z, rInner: Math.max(0, c - half), rOuter: c + half };
}
