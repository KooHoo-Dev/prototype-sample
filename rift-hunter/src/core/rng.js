// OWNER: P0 — 계약 §6.1 · §5.14 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// mulberry32. 난수 상태는 상태 안의 {s} 순수 객체이고, makeRng 가 그 객체를 직접 고친다(결정성 · 직렬화).

/** @typedef {import('../types.js').Rng} Rng */

/** @param {number} seed @returns {{s:number}} (seed 0 이면 0x9e3779b9) */
export function seedRng(seed) {
  const s = (Number(seed) >>> 0) || 0x9e3779b9;
  return { s };
}

/** @param {{s:number}} st @returns {number} [0, 1) */
function nextOf(st) {
  st.s = (st.s + 0x6d2b79f5) >>> 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * @param {{s:number}} stateObj 상태 안의 난수 상태(직접 고친다)
 * @returns {Rng}
 */
export function makeRng(stateObj) {
  const st = stateObj;
  const rng = {
    state: st,
    next: () => nextOf(st),
    /** [a, b) */
    range: (a, b) => a + nextOf(st) * (b - a),
    /** 정수 · 양끝 포함 */
    int: (a, b) => {
      const lo = Math.ceil(Math.min(a, b));
      const hi = Math.floor(Math.max(a, b));
      return lo + Math.floor(nextOf(st) * (hi - lo + 1));
    },
    chance: (p) => nextOf(st) < p,
    sign: () => (nextOf(st) < 0.5 ? -1 : 1),
    /**
     * 가중치 뽑기. Record<string, number>(데이터에 적힌 키 순서로 누적) 또는 Array<{id, w}> → 키/id. 합 ≤ 0 이면 null.
     * 음수 · NaN 가중치는 0 으로 본다.
     */
    pick: (weights) => {
      if (Array.isArray(weights)) {
        let total = 0;
        for (const e of weights) total += e.w > 0 ? e.w : 0;
        if (!(total > 0)) return null;
        let r = nextOf(st) * total;
        let last = null;
        for (const e of weights) {
          const w = e.w > 0 ? e.w : 0;
          if (w <= 0) continue;
          last = e.id;
          if (r < w) return e.id;
          r -= w;
        }
        return last;
      }
      const keys = Object.keys(weights);
      let total = 0;
      for (const k of keys) total += weights[k] > 0 ? weights[k] : 0;
      if (!(total > 0)) return null;
      let r = nextOf(st) * total;
      let last = null;
      for (const k of keys) {
        const w = weights[k] > 0 ? weights[k] : 0;
        if (w <= 0) continue;
        last = k;
        if (r < w) return k;
        r -= w;
      }
      return last;
    },
    /** 가중치 배열 → 인덱스(합 ≤ 0 이면 -1) @param {number[]} arr */
    pickIndex: (arr) => {
      let total = 0;
      for (const w of arr) total += w > 0 ? w : 0;
      if (!(total > 0)) return -1;
      let r = nextOf(st) * total;
      let last = -1;
      for (let i = 0; i < arr.length; i++) {
        const w = arr[i] > 0 ? arr[i] : 0;
        if (w <= 0) continue;
        last = i;
        if (r < w) return i;
        r -= w;
      }
      return last;
    },
    /** 제자리 Fisher–Yates @template T @param {T[]} arr @returns {T[]} */
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(nextOf(st) * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
  };
  return rng;
}
