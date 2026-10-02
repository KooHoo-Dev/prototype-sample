// OWNER: P5 — 내부 파일(§1.3 src/view/world/) · 결정적 값 노이즈 — 지형 · 소품 배치 · 절차 텍스처가 같이 쓴다.
// Math.random 을 쓰지 않는다 — 같은 시드면 같은 풍경(heightAt 이 메시와 같은 함수여야 하므로 상태가 없다).

/** 정수 좌표 → [0, 1) */
export function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 정수 하나 → [0, 1) */
export function hash1(i, seed) { return hash2(i, 0x5bd1e995, seed); }

/** 시드 난수 열(배치용) — mulberry32 */
export function makeRand(seed) {
  let s = (seed | 0) ^ 0x6d2b79f5;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 부드러운 2D 값 노이즈 → [0, 1) */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** 프랙털 합 → 대략 [0, 1) */
export function fbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, z * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** 1D 프랙털(능선 윤곽) — 주기 period 로 감긴다(정수 격자 기준) */
export function fbm1Wrapped(t, period, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    const p = period * f;
    const x = t * f;
    const i = Math.floor(x);
    const fr = x - i;
    const u = fr * fr * (3 - 2 * fr);
    const a = hash1(((i % p) + p) % p, seed + o * 31);
    const b = hash1((((i + 1) % p) + p) % p, seed + o * 31);
    sum += (a + (b - a) * u) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
