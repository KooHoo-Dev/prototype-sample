// OWNER: P0 — 계약 §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// mulberry32 시드 난수. 상태는 {s} 순수 객체 하나 — 게임 상태(state.rng)에 그대로 들어간다.

const UINT32 = 4294967296;
const GOLDEN = 0x9e3779b9;
const STEP = 0x6d2b79f5;

/** @param {number} seed @returns {{s:number}} seed 0 이면 0x9e3779b9 */
export function seedRng(seed) {
  let s = Number(seed) >>> 0;
  if (s === 0) s = GOLDEN;
  return { s };
}

/** @typedef {Object} Rng
 * @property {() => number} next              [0, 1)
 * @property {(a:number|[number,number], b?:number) => number} range   [a, b) — 배열 [a, b] 도 받는다
 * @property {(a:number|[number,number], b?:number) => number} int     양끝 포함 정수 — 배열도 받는다
 * @property {(p:number) => boolean} chance
 * @property {() => number} sign             ±1
 * @property {() => number} normal           표준정규(Box–Muller — 매번 두 개를 뽑아 하나만 쓴다 · 여분 상태 없음)
 * @property {(weights:Record<string,number>|Array<{id:string,w:number}>) => string|null} pick   합 ≤ 0 이면 null
 */

/** @param {{s:number}} st 상태 객체 — 직접 고친다 @returns {Rng} */
export function makeRng(st) {
  const next = () => {
    st.s = (st.s + STEP) >>> 0;
    let t = st.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
  const pair = (a, b) => (Array.isArray(a) ? a : [a, b]);
  return {
    next,
    range(a, b) {
      const [lo, hi] = pair(a, b);
      return lo + (hi - lo) * next();
    },
    int(a, b) {
      const [lo, hi] = pair(a, b);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p) {
      return next() < p;
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    normal() {
      const u1 = 1 - next();            // (0, 1]
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick(weights) {
      /** @type {Array<[string, number]>} */
      const items = Array.isArray(weights)
        ? weights.map(e => [e.id, e.w])
        : Object.keys(weights).map(k => [k, weights[k]]);
      let sum = 0;
      for (const [, w] of items) if (w > 0) sum += w;
      if (!(sum > 0)) return null;
      let r = next() * sum;
      let last = null;
      for (const [id, w] of items) {
        if (!(w > 0)) continue;
        last = id;
        r -= w;
        if (r < 0) return id;
      }
      return last;
    },
  };
}
