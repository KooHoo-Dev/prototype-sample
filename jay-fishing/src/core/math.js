// OWNER: P0 — 계약 §0.2 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 순수 수학. yaw 규약: 앞 벡터 = (−sin θ, −cos θ) — three.js 카메라 rotation.y 와 같다(§0.2).

/** @typedef {import('../types.js').Vec2} Vec2 */

const TAU = Math.PI * 2;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
/** a == b 면 0 */
export function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
export function smoothstep(e0, e1, x) {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}
/** cur 를 target 쪽으로 maxDelta 까지 */
export function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}
/** 지수 평활 — 프레임 속도와 무관 */
export function damp(cur, target, lambda, dt) { return lerp(cur, target, 1 - Math.exp(-lambda * dt)); }

/** → (−π, π] */
export function wrapAngle(a) {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}
/** from 에서 to 로 가는 가장 짧은 각 = wrapAngle(to − from) */
export function angleDiff(from, to) { return wrapAngle(to - from); }
export function lerpAngle(a, b, t) { return a + angleDiff(a, b) * t; }

export function fwdX(yaw) { return -Math.sin(yaw); }
export function fwdZ(yaw) { return -Math.cos(yaw); }
/** @returns {Vec2} */
export function fwd(yaw, len = 1) { return { x: -Math.sin(yaw) * len, z: -Math.cos(yaw) * len }; }
/** 방향 (dx, dz) 의 yaw = atan2(−dx, −dz) */
export function yawOf(dx, dz) { return Math.atan2(-dx, -dz); }

/** @returns {Vec2} */ export function v2(x, z) { return { x, z }; }
/** @returns {Vec2} */ export function v2add(a, b) { return { x: a.x + b.x, z: a.z + b.z }; }
/** @returns {Vec2} */ export function v2sub(a, b) { return { x: a.x - b.x, z: a.z - b.z }; }
/** @returns {Vec2} */ export function v2scale(a, k) { return { x: a.x * k, z: a.z * k }; }
export function v2len(a) { return Math.hypot(a.x, a.z); }
export function v2dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
/** 길이 0 이면 {0, 0} @returns {Vec2} */
export function v2norm(a) {
  const l = Math.hypot(a.x, a.z);
  return l > 0 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}

/** [[x, y], …](x 오름차순) 꺾은선 보간 · 끝점 밖은 끝값 · 빈 배열이면 0 */
export function piecewise(points, x) {
  const n = points.length;
  if (!n) return 0;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[n - 1][0]) return points[n - 1][1];
  for (let i = 1; i < n; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return points[n - 1][1];
}

/** 해안선(Vec2[] · x 오름차순) 꺾은선의 z · 끝점 밖은 끝값 · 빈 배열이면 +Infinity(실내) */
export function shoreZAt(shore, x) {
  const n = shore.length;
  if (!n) return Infinity;
  if (x <= shore[0].x) return shore[0].z;
  if (x >= shore[n - 1].x) return shore[n - 1].z;
  for (let i = 1; i < n; i++) {
    const b = shore[i];
    if (x <= b.x) {
      const a = shore[i - 1];
      return b.x === a.x ? b.z : a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x);
    }
  }
  return shore[n - 1].z;
}

/** 신발끈 합 Σ(xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ) > 0 방향의 볼록 다각형 · 경계 포함 */
export function pointInConvex(poly, x, z) {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) return false;
  }
  return true;
}

/** 주기 1: 0 → 1(t = 0.5) → 0 */
export function triangleWave(t) {
  const f = t - Math.floor(t);
  return f < 0.5 ? 2 * f : 2 * (1 - f);
}

export function round1(v) { return Math.round(v * 10) / 10; }
export function round3(v) { return Math.round(v * 1000) / 1000; }
