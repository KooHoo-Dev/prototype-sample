// OWNER: P0 — 계약 §0.1 · §5.11 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 상태 안의 시각은 틱 정수다. 데이터의 초를 상태로 옮길 때는 반드시 ticks().

import { TICK_HZ } from './constants.js';

/** 초 → 틱(0 이상 정수) */
export function ticks(sec) { return Math.max(0, Math.round(sec * TICK_HZ)); }
/** 틱 → 초 */
export function secOf(t) { return t / TICK_HZ; }
/** [start, end] 안의 진행 0..1 (end ≤ start 면 1) */
export function progress(start, end, tick) {
  if (end <= start) return 1;
  const p = (tick - start) / (end - start);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** 이 이름이면 절대 틱이다(§5.11 · 끝이 At · Until 인 것과 함께) */
const TICK_KEYS = new Set(['until', 'start', 'end', 'born', 'at', 'actStart', 'actHit', 'actEnd']);

/** 키 이름이 절대 틱을 뜻하는가 */
export function isTickKey(key) {
  return TICK_KEYS.has(key) || key.endsWith('At') || key.endsWith('Until');
}

/**
 * 절대 틱을 제자리에서 delta 만큼 민다(순수 · 재귀) — 마을에 다녀온 균열(§5.11).
 * 대상: 값 ≥ 0 인 숫자 중 키 이름이 At · Until 로 끝나거나 until · start · end · born · at · actStart · actHit · actEnd 인 것,
 * 키가 readyAt 인 객체의 값 전부(≥ 0). 배열 안의 숫자는 그 배열을 담은 키의 규칙을 따른다. -1 · null 은 「없음」이라 밀지 않는다.
 * @param {any} obj @param {number} delta @returns {any} obj
 */
export function shiftTicks(obj, delta) {
  if (!delta || obj === null || typeof obj !== 'object') return obj;
  walk(obj, delta);
  return obj;
}

function walk(node, delta) {
  if (Array.isArray(node)) {
    for (const v of node) if (v !== null && typeof v === 'object') walk(v, delta);
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'number') {
      if (v >= 0 && isTickKey(key)) node[key] = v + delta;
    } else if (v !== null && typeof v === 'object') {
      if (key === 'readyAt' && !Array.isArray(v)) {
        for (const k of Object.keys(v)) if (typeof v[k] === 'number' && v[k] >= 0) v[k] += delta;
      } else if (Array.isArray(v) && isTickKey(key)) {
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] === 'number') { if (v[i] >= 0) v[i] += delta; }
          else if (v[i] !== null && typeof v[i] === 'object') walk(v[i], delta);
        }
      } else {
        walk(v, delta);
      }
    }
  }
}
