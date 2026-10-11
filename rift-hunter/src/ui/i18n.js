// OWNER: P10 — 계약 §10.8
// STUB — W2 에서 P10 이 다듬는다. W0: t(key, params) — 없는 키면 키를 그대로 돌려주고 콘솔에 한 번 경고 · {이름} 치환

import { STRINGS } from '../data/strings.ko.js';

const warned = new Set();

/** @param {string} key @param {Record<string, string|number>} [params] @returns {string} */
export function t(key, params = {}) {
  const s = STRINGS[key];
  if (s === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      if (typeof console !== 'undefined') console.warn(`i18n: missing key ${key}`);
    }
    return key;
  }
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}
