// OWNER: P8 — 계약 §10.6
import { STR } from '../data/strings.ko.js';

/** @type {Set<string>} 이미 경고한 키 */
const warned = new Set();

/**
 * STR[key]의 {name} 자리를 params로 치환한다. 없는 키는 key 그대로 반환(+ 경고 1회).
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const s = STR[key];
  if (s === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/**
 * 키가 있는가(경고 없이 묻는다 — 키 이름처럼 있으면 쓰고 없으면 다른 표기로 넘어갈 때).
 * @param {string} key
 * @returns {boolean}
 */
export function hasStr(key) {
  return STR[key] !== undefined;
}
