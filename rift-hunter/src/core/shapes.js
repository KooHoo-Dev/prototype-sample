// OWNER: P0 — 계약 §3.6 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 판정 모양의 정본. 몸(원 · 반지름 rb)과의 겹침은 overlaps 하나로만 본다.

import { angleDiff, segPointDist, yawOf } from './math.js';

/** @typedef {import('../types.js').Shape} Shape */

/**
 * 모양과 몸(중심 x, z · 반지름 rb)이 겹치는가.
 * circle: 중심 거리 ≤ r + rb · cone: 거리 ≤ r + rb 이고 방향 차 ≤ angle/2 + asin(rb/거리)(꼭짓점이 몸 안이면 참) ·
 * line: 선분까지 거리 ≤ width/2 + rb 이고 투영이 [−rb, len + rb] · ring: r0 − rb ≤ 거리 ≤ r + rb · poly: 판정 없음(false)
 * @param {Shape} shape @param {number} x @param {number} z @param {number} [rb]
 */
export function overlaps(shape, x, z, rb = 0) {
  const dx = x - shape.x, dz = z - shape.z;
  switch (shape.type) {
    case 'circle':
      return dx * dx + dz * dz <= (shape.r + rb) * (shape.r + rb);
    case 'ring': {
      const d = Math.hypot(dx, dz);
      return d >= (shape.r0 ?? 0) - rb && d <= shape.r + rb;
    }
    case 'cone': {
      const d = Math.hypot(dx, dz);
      if (d > shape.r + rb) return false;
      if (d <= rb || d === 0) return true;
      const slack = Math.asin(Math.min(1, rb / d));
      return Math.abs(angleDiff(shape.facing ?? 0, yawOf(dx, dz))) <= (shape.angle ?? 0) / 2 + slack;
    }
    case 'line': {
      const f = shape.facing ?? 0;
      const fx = Math.sin(f), fz = Math.cos(f);
      const len = shape.len ?? 0;
      const t = dx * fx + dz * fz;
      if (t < -rb || t > len + rb) return false;
      const d = segPointDist(shape.x, shape.z, shape.x + fx * len, shape.z + fz * len, x, z);
      return d <= (shape.width ?? 0) / 2 + rb;
    }
    default:
      return false;
  }
}

/** 판정 영역을 덮는 축 정렬 상자(m) @param {Shape} shape @returns {{x0:number, z0:number, x1:number, z1:number}} */
export function shapeBounds(shape) {
  switch (shape.type) {
    case 'circle':
    case 'ring':
    case 'cone': {
      const r = shape.r ?? 0;
      return { x0: shape.x - r, z0: shape.z - r, x1: shape.x + r, z1: shape.z + r };
    }
    case 'line': {
      const f = shape.facing ?? 0;
      const fx = Math.sin(f), fz = Math.cos(f);
      const rx = -Math.cos(f), rz = Math.sin(f);
      const len = shape.len ?? 0, hw = (shape.width ?? 0) / 2;
      const xs = [], zs = [];
      for (const a of [0, len]) for (const b of [-hw, hw]) {
        xs.push(shape.x + fx * a + rx * b);
        zs.push(shape.z + fz * a + rz * b);
      }
      return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
    }
    case 'poly': {
      const pts = shape.pts && shape.pts.length ? shape.pts : [{ x: shape.x, z: shape.z }];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.z < z0) z0 = p.z;
        if (p.z > z1) z1 = p.z;
      }
      return { x0, z0, x1, z1 };
    }
    default:
      return { x0: shape.x, z0: shape.z, x1: shape.x, z1: shape.z };
  }
}

/** 넓이(m² · 테스트용) @param {Shape} shape */
export function shapeArea(shape) {
  switch (shape.type) {
    case 'circle': return Math.PI * shape.r * shape.r;
    case 'ring': return Math.PI * (shape.r * shape.r - (shape.r0 ?? 0) ** 2);
    case 'cone': return (shape.r * shape.r * (shape.angle ?? 0)) / 2;
    case 'line': return (shape.len ?? 0) * (shape.width ?? 0);
    default: return 0;
  }
}

/** @returns {Shape} */
export function circle(x, z, r) { return { type: 'circle', x, z, r }; }
/** @param {number} angle 전체 각(rad) @returns {Shape} */
export function cone(x, z, r, facing, angle) { return { type: 'cone', x, z, r, facing, angle }; }
/** 시작점에서 facing 방향으로 len · 폭 width @returns {Shape} */
export function line(x, z, facing, len, width) { return { type: 'line', x, z, facing, len, width }; }
/** @returns {Shape} */
export function ring(x, z, r0, r) { return { type: 'ring', x, z, r0, r }; }
