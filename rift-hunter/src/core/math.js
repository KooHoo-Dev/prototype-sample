// OWNER: P0 — 계약 §6.1 · §0.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 순수 함수만. yaw θ 의 앞 벡터 = (sin θ, cos θ) — θ = 0 → +Z · θ = +π/2 → +X(three.js rotation.y 와 같다).
// 오른쪽 벡터 = (−cos θ, sin θ).

/** @typedef {import('../types.js').Vec2} Vec2 */

const TAU = Math.PI * 2;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
/** a == b 이면 0 */
export function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
export function smoothstep(e0, e1, x) {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}
/** cur 를 target 쪽으로 최대 maxDelta 만큼 */
export function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(target, cur + maxDelta);
  return Math.max(target, cur - maxDelta);
}

export function deg2rad(d) { return (d * Math.PI) / 180; }
/** (−π, π] */
export function wrapAngle(a) {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}
/** from → to 로 가장 짧게 도는 각(−π, π] */
export function angleDiff(from, to) { return wrapAngle(to - from); }
export function lerpAngle(a, b, t) { return wrapAngle(a + angleDiff(a, b) * t); }
/** cur 를 target 쪽으로 최대 maxStep(rad)만큼 돌린다 */
export function turnToward(cur, target, maxStep) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(cur + Math.sign(d) * maxStep);
}

export function fwdX(yaw) { return Math.sin(yaw); }
export function fwdZ(yaw) { return Math.cos(yaw); }
export function rightX(yaw) { return -Math.cos(yaw); }
export function rightZ(yaw) { return Math.sin(yaw); }
/** 두 점 사이 yaw(a → b 면 yawOf(b.x − a.x, b.z − a.z)) */
export function yawOf(dx, dz) { return Math.atan2(dx, dz); }

/** @returns {Vec2} */
export function v2(x = 0, z = 0) { return { x, z }; }
export function v2add(a, b) { return { x: a.x + b.x, z: a.z + b.z }; }
export function v2sub(a, b) { return { x: a.x - b.x, z: a.z - b.z }; }
export function v2scale(a, k) { return { x: a.x * k, z: a.z * k }; }
export function v2len(a) { return Math.hypot(a.x, a.z); }
export function v2dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
export function v2dist2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
/** 길이 0 이면 {0, 0} */
export function v2norm(a) {
  const l = Math.hypot(a.x, a.z);
  return l > 0 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}
export function v2lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }
export function v2copy(a) { return { x: a.x, z: a.z }; }

/** 선분 a–b 와 점 p 의 거리 */
export function segPointDist(ax, az, bx, bz, px, pz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function round1(v) { return Math.round(v * 10) / 10; }
export function roundTo(v, decimals) {
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}
