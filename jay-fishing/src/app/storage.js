// OWNER: P9 — 계약 §6.12 · §11.5
// STUB — W0 스텁(빈 export · 시그니처만): 저장하지 않는다. 던지지 않는다. P9 가 채운다(localStorage 는 함수 안에서만).

import { DEFAULT_SETTINGS } from '../data/settings.js';

/** @returns {boolean} */
export function canPersist() { return false; }

/** @returns {{save:Object|null, broken:boolean, future:boolean, raw:string|null}} */
export function loadSave() { return { save: null, broken: false, future: false, raw: null }; }

/** @param {Object} save @returns {boolean} */
export function writeSave(save) { void save; return false; }

/** @param {string} [raw] @returns {boolean} */
export function backupSave(raw) { void raw; return false; }

export function clearSave() {}

/** @returns {import('../types.js').Settings} */
export function loadSettings() { return structuredClone(DEFAULT_SETTINGS); }

/** @param {import('../types.js').Settings} settings @returns {boolean} */
export function writeSettings(settings) { void settings; return false; }
