// OWNER: P0 — 계약 §0.2 · §6.1 (완전 구현 · 전부 순수 함수)
//
// 각도 규약(§0.2): facing θ의 방향 벡터 = (x, z) = (sin θ, cos θ).
//   θ = 0 → +Z, θ = +π/2 → +X. 오른쪽 벡터 = (−cos θ, sin θ).
import { TAU } from './constants.js';

/** @typedef {import('../types.js').Vec2} Vec2 */

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} v @returns {number} */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** @param {number} a @param {number} b @param {number} t @returns {number} */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** clamp 없음. a === b면 0. @param {number} a @param {number} b @param {number} v @returns {number} */
export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

/** 0..1 → 0..1 (입력은 0..1로 자른다). @param {number} t @returns {number} */
export function smoothstep(t) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** cur를 target 쪽으로 최대 maxDelta만큼 옮긴다(넘치지 않는다). @returns {number} */
export function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return target;
}

/** 지수 감쇠: lerp(cur, target, 1 − exp(−lambda·dt)). @returns {number} */
export function damp(cur, target, lambda, dt) {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}

/** @param {number} x @param {number} z @returns {number} */
export function len(x, z) {
  return Math.hypot(x, z);
}

/** @returns {number} */
export function dist(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

/** @returns {number} */
export function distSq(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** 길이 0이면 {0, 0}. @param {number} x @param {number} z @returns {Vec2} */
export function normalize(x, z) {
  const l = Math.hypot(x, z);
  if (!(l > 0) || !Number.isFinite(l)) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}

/** (dx, dz) 방향의 각 = Math.atan2(dx, dz). @returns {number} */
export function angleOf(dx, dz) {
  return Math.atan2(dx, dz);
}

/** @param {number} a @returns {number} sin a */
export function dirX(a) {
  return Math.sin(a);
}

/** @param {number} a @returns {number} cos a */
export function dirZ(a) {
  return Math.cos(a);
}

/** @param {number} a @param {number} [length] @returns {Vec2} */
export function fromAngle(a, length = 1) {
  return { x: Math.sin(a) * length, z: Math.cos(a) * length };
}

/** @param {number} a @returns {number} (−π, π] */
export function wrapAngle(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** 부호 있는 각도 차 = wrapAngle(to − from). +는 θ가 커지는 방향. @returns {number} */
export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

/** cur에서 target 쪽으로 최단 호를 따라 최대 maxStep만큼 돈다. @returns {number} 새 각(wrap 됨) */
export function turnToward(cur, target, maxStep) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * maxStep);
}

/** 최단 호 보간. @returns {number} (wrap 됨) */
export function lerpAngle(a, b, t) {
  return wrapAngle(a + angleDiff(a, b) * t);
}

/**
 * 로컬 → 월드: pos + fwd·(sin θ, cos θ) + side·(−cos θ, sin θ). side 양수 = 오른쪽.
 * @param {number} x @param {number} z @param {number} facing @param {number} fwd @param {number} side
 * @returns {Vec2}
 */
export function localToWorld(x, z, facing, fwd, side) {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  return { x: x + fwd * s - side * c, z: z + fwd * c + side * s };
}

/** 점 p에서 선분 a→b까지의 거리. @returns {number} */
export function distPointSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  if (l2 === 0) return Math.hypot(px - ax, pz - az);
  const t = clamp01(((px - ax) * abx + (pz - az) * abz) / l2);
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/** @param {Vec2} v @returns {boolean} */
export function isFiniteVec(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.z);
}
