// OWNER: P8 — 계약 §6.11 · §10.6
// W0 완성(§6.14 — i18n.t 는 동작) · 이후 P8 이 고친다.

import { STRINGS } from '../data/strings.ko.js';

const warned = new Set();

/**
 * {name} 치환. 없는 키는 개발 중 콘솔 경고 + 키를 그대로(ui.strings.test 가 막는다).
 * @param {string} key @param {Record<string, string|number>} [params] @returns {string}
 */
export function t(key, params = {}) {
  const s = STRINGS[key];
  if (s === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  return s.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

/** @param {string} key @returns {boolean} */
export function has(key) {
  return Object.prototype.hasOwnProperty.call(STRINGS, key);
}
