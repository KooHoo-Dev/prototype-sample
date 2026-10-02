// OWNER: P0 — 계약 §6.1 · §7.3.4 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 정규분포 · 크기 모델 · 기술 통계. 전부 순수 함수.

export const Z05 = -1.6448536, Z999 = 3.0902323;

const SQRT2PI = 2.5066282746310002;

/**
 * 표준정규 누적분포 Φ(z) — Hart(1968) 5666 · West(2005) 구현(배정밀도 근처 · 오차 ≤ 1e-7 보장).
 * @param {number} z @returns {number}
 */
export function normalCdf(z) {
  if (Number.isNaN(z)) return NaN;
  const x = Math.abs(z);
  let c;
  if (x > 37) c = 0;
  else {
    const e = Math.exp(-x * x / 2);
    if (x < 7.07106781186547) {
      let b = 3.52624965998911e-2 * x + 0.700383064443688;
      b = b * x + 6.37396220353165;
      b = b * x + 33.912866078383;
      b = b * x + 112.079291497871;
      b = b * x + 221.213596169931;
      b = b * x + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * x + 1.75566716318264;
      b = b * x + 16.064177579207;
      b = b * x + 86.7807322029461;
      b = b * x + 296.564248779674;
      b = b * x + 637.333633378831;
      b = b * x + 793.826512519948;
      b = b * x + 440.413735824752;
      c /= b;
    } else {
      let b = x + 0.65;
      b = x + 4 / b;
      b = x + 3 / b;
      b = x + 2 / b;
      b = x + 1 / b;
      c = e / b / SQRT2PI;
    }
  }
  return z > 0 ? 1 - c : c;
}

const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
const P_LOW = 0.02425;

/**
 * 표준정규 분위수 Φ⁻¹(p) — Acklam 근사 + Halley 보정 한 번(오차 ≤ 1e-8).
 * p ≤ 0 → −Infinity · p ≥ 1 → +Infinity.
 * @param {number} p @returns {number}
 */
export function normalInv(p) {
  if (Number.isNaN(p)) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x;
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
        (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
         ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  // Halley 보정 한 번
  const e = normalCdf(x) - p;
  const u = e * SQRT2PI * Math.exp(x * x / 2);
  x -= u / (1 + x * u / 2);
  return x;
}

/**
 * §7.3.4 — 5 · 99.9 퍼센타일의 길이 · 무게 두 점에서 로그정규 길이와 W = a·L^b.
 * @param {[number, number]} lenCm @param {[number, number]} kg
 * @returns {{mu:number, sigma:number, a:number, b:number}}
 */
export function sizeModelFromRange(lenCm, kg) {
  const [L5, L999] = lenCm;
  const [W5, W999] = kg;
  const sigma = (Math.log(L999) - Math.log(L5)) / (Z999 - Z05);
  const mu = Math.log(L5) - Z05 * sigma;
  const b = Math.log(W999 / W5) / Math.log(L999 / L5);
  const a = W5 / Math.pow(L5, b);
  return { mu, sigma, a, b };
}

/** 빈 배열이면 NaN */
export function mean(a) {
  if (!a.length) return NaN;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

/** 모분산(n 으로 나눈다). 빈 배열이면 NaN */
export function variance(a) {
  if (!a.length) return NaN;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return s / a.length;
}

/** 선형 보간 분위수(정렬 사본 · q 0..1). 빈 배열이면 NaN */
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const pos = Math.min(Math.max(q, 0), 1) * (s.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
}

export function median(a) { return quantile(a, 0.5); }
