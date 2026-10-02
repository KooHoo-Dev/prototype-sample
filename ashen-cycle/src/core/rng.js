// OWNER: P0 — 계약 §6.1 (완전 구현)
/** @typedef {import('../types.js').Rng} Rng */

const UINT32 = 4294967296;

/**
 * 시드 난수(mulberry32). 상태는 uint32 하나 — getState/setState로 저장 · 복원한다.
 *   next()       → [0, 1)
 *   range(a, b)  → [a, b) 실수
 *   int(a, b)    → a..b 정수(양끝 포함)
 *   chance(p)    → next() < p (p ≤ 0이면 항상 false, p ≥ 1이면 항상 true. 어느 경우든 난수 하나를 소비한다)
 *   pick(arr)    → 원소 하나(빈 배열이면 undefined. 난수 하나를 소비한다)
 * @param {number} seed uint32로 강제한다
 * @returns {Rng}
 */
export function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    getState: () => s,
    setState: (v) => {
      s = v >>> 0;
    },
  };
}

/**
 * 두 정수를 섞어 uint32 하나로(보스전 시드 = hashSeed(profile.seed, attempts)).
 * @param {number} a
 * @param {number} b
 * @returns {number} uint32
 */
export function hashSeed(a, b) {
  let h = (a >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h + Math.imul((b >>> 0) + 0x7f4a7c15, 0xc2b2ae35)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}
