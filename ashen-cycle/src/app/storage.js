// OWNER: P9 — 계약 §11.4
// localStorage 읽기/쓰기. 프로필과 설정은 다른 키다(SAVE_KEY · SETTINGS_KEY) — 세이브가 깨지거나 지워져도 감도 · 볼륨은 남는다.
// 직렬화 · 이주 · 정화 · 검증은 sim/progression/save.js(P4)의 일이고, 여기는 저장소와 시계만 안다.
// localStorage가 없거나 막혀 있어도 게임은 돈다(읽기는 기본값, 쓰기는 무시) — 어떤 함수도 던지지 않는다.
import { SAVE_KEY, SAVE_BACKUP_KEY, SETTINGS_KEY } from '../core/constants.js';
import { DEFAULT_SETTINGS } from '../data/settings.js';
import { createSaveData, loadProfileFromText, sanitizeSettings, serializeSave } from '../sim/progression/save.js';

/** @typedef {import('../types.js').SaveData} SaveData */
/** @typedef {import('../types.js').Profile} Profile */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {{getItem:(k:string)=>string|null, setItem:(k:string, v:string)=>void, removeItem:(k:string)=>void}} StorageLike */

/**
 * 브라우저의 localStorage. 접근 자체가 던질 수 있다(샌드박스 iframe · 쿠키 차단) — 그때는 null.
 * @returns {StorageLike|null}
 */
function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

/** @param {StorageLike|null} storage @param {string} key @returns {string|null} */
function read(storage, key) {
  if (!storage) return null;
  try {
    const v = storage.getItem(key);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** @param {StorageLike|null} storage @param {string} key @param {string} value @returns {boolean} 썼으면 true */
function write(storage, key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false; // 용량 초과 · 사생활 보호 모드
  }
}

/**
 * localStorage[SAVE_KEY] → loadProfileFromText(text). 텍스트가 있는데 읽지 못하면(깨짐 · 미래 버전 · 검증 실패)
 * 원문을 SAVE_BACKUP_KEY에 복사하고 {save: null, broken: true}. 원래 키는 건드리지 않는다 —
 * 사용자가 「새 게임」을 고르기 전에는 읽지 못한 세이브를 덮지 않는다.
 * @param {StorageLike|null} [storage] 테스트용 주입(기본: localStorage)
 * @returns {{save:SaveData|null, broken:boolean}}
 */
export function loadSave(storage = defaultStorage()) {
  const text = read(storage, SAVE_KEY);
  if (text === null || text === '') return { save: null, broken: false };
  const save = loadProfileFromText(text);
  if (save) return { save, broken: false };
  write(storage, SAVE_BACKUP_KEY, text);
  return { save: null, broken: true };
}

/**
 * createSaveData(profile, Date.now()) → serializeSave → setItem(SAVE_KEY). 실패해도 던지지 않는다.
 * @param {Profile} profile
 * @param {StorageLike|null} [storage]
 * @returns {boolean} 썼으면 true
 */
export function writeSave(profile, storage = defaultStorage()) {
  try {
    return write(storage, SAVE_KEY, serializeSave(createSaveData(profile, Date.now())));
  } catch {
    return false;
  }
}

/**
 * 지금의 세이브 원문을 SAVE_BACKUP_KEY에 복사한다 — 「새 게임」이 기존 진행을 덮기 직전에 부른다.
 * 잘못 누른 새 게임으로 진행이 사라져도 원문은 한 벌 남는다(읽지 못한 세이브의 백업과 같은 키).
 * @param {StorageLike|null} [storage]
 * @returns {boolean} 복사했으면 true(세이브가 없으면 false — 기존 백업은 건드리지 않는다)
 */
export function backupSave(storage = defaultStorage()) {
  const text = read(storage, SAVE_KEY);
  if (text === null || text === '') return false;
  return write(storage, SAVE_BACKUP_KEY, text);
}

/**
 * 이 브라우저에 진행을 저장할 수 있는가(쿠키 · 사이트 데이터 차단, 저장소가 막힌 iframe이면 false).
 * 탐침 키를 썼다 지워 본다 — 세이브 · 설정 키는 건드리지 않는다.
 * @param {StorageLike|null} [storage]
 * @returns {boolean}
 */
export function canPersist(storage = defaultStorage()) {
  if (!storage) return false;
  const key = `${SAVE_KEY}.probe`;
  try {
    storage.setItem(key, '1');
    const ok = storage.getItem(key) === '1';
    storage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

/** @param {StorageLike|null} [storage] */
export function clearSave(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // 막힌 저장소 — 무시
  }
}

/**
 * localStorage[SETTINGS_KEY] → JSON.parse → sanitizeSettings. 없거나 깨졌으면 DEFAULT_SETTINGS의 복사본.
 * 돌려주는 객체는 app이 수명 내내 쥐고 필드만 바꾼다.
 * @param {StorageLike|null} [storage]
 * @returns {Settings}
 */
export function loadSettings(storage = defaultStorage()) {
  const text = read(storage, SETTINGS_KEY);
  if (text !== null && text !== '') {
    try {
      return sanitizeSettings(JSON.parse(text));
    } catch {
      // 깨진 설정 — 기본값으로
    }
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * setItem(SETTINGS_KEY). 실패해도 던지지 않는다.
 * @param {Settings} settings
 * @param {StorageLike|null} [storage]
 * @returns {boolean} 썼으면 true
 */
export function writeSettings(settings, storage = defaultStorage()) {
  try {
    return write(storage, SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    return false;
  }
}
