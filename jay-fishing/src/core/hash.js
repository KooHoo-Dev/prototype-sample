// OWNER: P0 — 계약 §6.1 · §12.3 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 결정성 검사용 해시. 키 순서에 기대지 않는다.

/** 키를 정렬한 JSON(undefined 값의 키는 빠진다 — JSON.stringify 와 같다) @param {any} obj @returns {string} */
export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    const s = JSON.stringify(obj);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(obj)) return '[' + obj.map(v => (v === undefined || typeof v === 'function' ? 'null' : stableStringify(v))).join(',') + ']';
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined && typeof obj[k] !== 'function').sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** FNV-1a 32비트 → 8자리 16진 @param {string} str @returns {string} */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** events · debug 를 뺀 게임 상태의 해시 @param {Object} state @returns {string} */
export function hashState(state) {
  const { events, debug, ...rest } = state;
  return fnv1a(stableStringify(rest));
}

/** 정수 여러 개 → uint32(날씨 등 결정적 해시) @param {...number} ints @returns {number} */
export function hash32(...ints) {
  let h = 0x2545f491;
  for (const v of ints) {
    let k = Math.trunc(Number(v)) >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= ints.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
