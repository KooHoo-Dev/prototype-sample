// OWNER: P0 — 계약 §6.1 · §5.14 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 결정성 검사용 해시 — 키를 정렬한 JSON(타입 배열은 일반 배열로).

/** 키 정렬 · 타입 배열은 일반 배열 · undefined 키는 빠진다 · NaN/Infinity 는 null(JSON 과 같다) */
export function stableStringify(obj) {
  return write(obj);
}

function write(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(v);
  if (t === 'undefined' || t === 'function' || t === 'symbol') return 'null';
  if (t === 'bigint') return JSON.stringify(String(v));
  if (ArrayBuffer.isView(v)) return '[' + Array.from(/** @type {any} */ (v), x => write(x)).join(',') + ']';
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : write(x))).join(',') + ']';
  const keys = Object.keys(v).sort();
  const parts = [];
  for (const k of keys) {
    const x = v[k];
    if (x === undefined || typeof x === 'function') continue;
    parts.push(JSON.stringify(k) + ':' + write(x));
  }
  return '{' + parts.join(',') + '}';
}

/** FNV-1a 32비트 → 8자리 16진 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, 0x01000193);
    if (c > 0xff) {
      h ^= c >>> 8;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 정수 여럿 → uint32(순서가 다르면 다른 값) @param {...number} ints */
export function hash32(...ints) {
  let h = (0x9e3779b9 ^ ints.length) >>> 0;
  for (const x of ints) {
    const n = Number(x);
    let k = Number.isFinite(n) ? (Math.floor(n) >>> 0) : 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 상태 해시 = fnv1a(stableStringify(events · flags 를 뺀 상태)) @param {Object} state */
export function hashState(state) {
  const { events, flags, ...rest } = state;
  return fnv1a(stableStringify(rest));
}
