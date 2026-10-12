// OWNER: P10 — 계약 §10.8
// 문면 조회 하나 — t(key, params). 없는 키면 키를 그대로 돌려주고 개발 콘솔에 한 번 경고한다(화면에 키가 보이면 ui.strings 테스트가 잡는다).
// 치환은 {이름}. 순수(DOM 없음) — Node 테스트가 import 한다.

import { STRINGS } from '../data/strings.ko.js';

const own = Object.prototype.hasOwnProperty;
const PARAM = /\{(\w+)\}/g;
/** @type {Set<string>} */
const warned = new Set();

/** 그 키가 있는가 @param {string} key */
export function has(key) {
  return typeof key === 'string' && own.call(STRINGS, key);
}

/**
 * 문면 — 없는 키는 키 그대로(경고 한 번) · params 에 없는 {이름}은 그대로 둔다.
 * @param {string} key @param {Record<string, string|number>} [params] @returns {string}
 */
export function t(key, params) {
  const s = has(key) ? STRINGS[key] : undefined;
  if (s === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      if (typeof console !== 'undefined') console.warn(`i18n: missing key ${key}`);
    }
    return String(key);
  }
  if (!params || s.indexOf('{') < 0) return s;
  return s.replace(PARAM, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

/**
 * 이름 키 배열(아이템 · 정예 이름 — §3.5 · §3.7)을 문면으로 — 공백으로 잇는다. 문자열 하나면 t 하나.
 * @param {string[]|string|null|undefined} keys @returns {string}
 */
export function tName(keys) {
  if (!keys) return '';
  if (typeof keys === 'string') return t(keys);
  let out = '';
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i]) continue;
    if (out) out += ' ';
    out += t(keys[i]);
  }
  return out;
}
