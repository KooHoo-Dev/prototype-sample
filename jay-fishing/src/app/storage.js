// OWNER: P9 — 계약 §6.12 · §11.5
// localStorage 저장. 던지지 않는다 — 막혀 있으면(canPersist false) 모든 쓰기는 조용히 false · 읽기는 빈 값.
// 세이브: SAVE_KEY 하나 · 손상/미래 버전 원문은 백업(최신 3개)하고 지운다 · 설정: SETTINGS_KEY(쿼리 덮어쓰기는 쓰지 않는다 — sanitizeSettings 가 모르는 키를 버린다).
// `storage` 인자(선택)는 테스트용 가짜 — 기본은 globalThis.localStorage.

import { GAME_ID, SAVE_BACKUP_KEY, SAVE_KEY, SETTINGS_KEY } from '../core/constants.js';
import { parseSave, sanitizeSettings, serializeSave } from '../sim/progression/save.js';

/** 백업을 남기는 개수(§11.5) */
export const BACKUP_KEEP = 3;
const PROBE_KEY = `${GAME_ID}:probe`;
const INDEX_KEY = `${SAVE_BACKUP_KEY}.index`;

/** @returns {Storage|null} */
function ls(storage) {
  if (storage) return storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;   // 막힌 환경에서는 접근자 자체가 던진다
  }
}

/** 쓰고 지울 수 있는가 @param {Storage} [storage] @returns {boolean} */
export function canPersist(storage) {
  const s = ls(storage);
  if (!s) return false;
  try {
    s.setItem(PROBE_KEY, '1');
    s.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** @param {Storage} s @param {string} k @returns {string|null} */
function getItem(s, k) {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}

/**
 * 세이브 읽기 — 없음 → {save:null} · 'future' → 백업 · 지움 · {future:true} · 그 밖의 실패 → 백업 · 지움 · {broken:true} · 성공 → {save}.
 * @param {Storage} [storage]
 * @returns {{save:Object|null, broken:boolean, future:boolean, raw:string|null}}
 */
export function loadSave(storage) {
  const out = { save: null, broken: false, future: false, raw: null };
  const s = ls(storage);
  if (!s) return out;
  const raw = getItem(s, SAVE_KEY);
  if (raw === null) return out;
  out.raw = raw;
  const r = parseSave(raw);
  if (r.save) {
    out.save = r.save;
    return out;
  }
  backupSave(raw, s);
  try { s.removeItem(SAVE_KEY); } catch { /* 지우지 못해도 다음 부팅에 다시 백업될 뿐 */ }
  if (r.error === 'future') out.future = true;
  else out.broken = true;
  return out;
}

/** @param {Object} save SaveData @param {Storage} [storage] @returns {boolean} */
export function writeSave(save, storage) {
  const s = ls(storage);
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, serializeSave(/** @type {any} */ (save)));
    return true;
  } catch {
    return false;
  }
}

/** @param {Storage} s @returns {number[]} */
function readIndex(s) {
  const raw = getItem(s, INDEX_KEY);
  if (raw === null) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(v => typeof v === 'number' && Number.isFinite(v)) : [];
  } catch {
    return [];
  }
}

/**
 * `${SAVE_BACKUP_KEY}.<ms>` 에 쓰고 목록에 더한 뒤 최신 BACKUP_KEEP 개만 남긴다. raw 가 없으면 지금 SAVE_KEY 값.
 * @param {string} [raw] @param {Storage} [storage] @returns {boolean}
 */
export function backupSave(raw, storage) {
  const s = ls(storage);
  if (!s) return false;
  const text = typeof raw === 'string' ? raw : getItem(s, SAVE_KEY);
  if (typeof text !== 'string') return false;
  try {
    const index = readIndex(s);
    let ms = Date.now();
    const last = index.length ? Math.max(...index) : -Infinity;
    if (ms <= last) ms = last + 1;   // 같은 ms 에 두 번 — 앞의 백업을 덮지 않는다
    s.setItem(`${SAVE_BACKUP_KEY}.${ms}`, text);
    index.push(ms);
    index.sort((a, b) => a - b);
    while (index.length > BACKUP_KEEP) {
      const old = index.shift();
      try { s.removeItem(`${SAVE_BACKUP_KEY}.${old}`); } catch { /* 무시 */ }
    }
    s.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

/** @param {Storage} [storage] @returns {string[]} 남아 있는 백업 키(오래된 것부터) */
export function listBackups(storage) {
  const s = ls(storage);
  if (!s) return [];
  return readIndex(s).map(ms => `${SAVE_BACKUP_KEY}.${ms}`);
}

/** @param {Storage} [storage] */
export function clearSave(storage) {
  const s = ls(storage);
  if (!s) return;
  try { s.removeItem(SAVE_KEY); } catch { /* 무시 */ }
}

/** @param {Storage} [storage] @returns {import('../types.js').Settings} 저장된 설정(정리됨) · 없거나 깨졌으면 기본값 */
export function loadSettings(storage) {
  const s = ls(storage);
  const raw = s ? getItem(s, SETTINGS_KEY) : null;
  let obj = null;
  if (raw !== null) {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  return sanitizeSettings(obj);
}

/** persisted 만 넘긴다(쿼리 덮어쓰기 제외 — 모르는 키는 sanitize 가 버린다) @param {Object} settings @param {Storage} [storage] @returns {boolean} */
export function writeSettings(settings, storage) {
  const s = ls(storage);
  if (!s) return false;
  try {
    s.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
