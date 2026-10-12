// OWNER: P9 — 계약 §11.6 · §3.11 · §11.2(selectChar · newChar 의 저장소 판단)
// localStorage 감싸기(키 SAVE_KEYS · 백업 · 깨진 세이브 · 계정 복구) + 저장 시점 묶기(createSaveScheduler) + 설정 정화 · 디바운스.
// 저장소 객체는 주입한다({ls}) — Node 테스트는 가짜 저장소를 넘긴다. 어떤 입력에도 throw 하지 않는다(쓰기 실패 → false).
// 직렬화 · 검증 · 정화 · ID 정리 · 계정 다시 세우기는 P6 save.js 의 것을 그대로 쓴다(여기서 규칙을 다시 짜지 않는다).

import { CHAR_SLOTS, SAVE_KEYS } from '../core/constants.js';
import { SETTINGS_SCHEMA } from '../data/settings.js';
import { summaryOf } from '../sim/progression/character.js';
import { loadAccount as readAccount, loadChar as readChar, rebuildAccount, serializeAccount, serializeChar } from '../sim/progression/save.js';

/** @typedef {import('../types.js').AccountState} AccountState */
/** @typedef {import('../types.js').CharacterState} CharacterState */
/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {{getItem:(k:string) => string|null, setItem:(k:string, v:string) => void, removeItem:(k:string) => void, key?:(i:number) => string|null, readonly length?:number}} StorageLike */

/** 키마다 남기는 백업 수 */
export const BACKUPS_PER_KEY = 3;
/** 캐릭터 저장을 묶는 최소 간격(ms) */
export const CHAR_SAVE_GAP_MS = 1000;
/** 바로 쓰는 reason(§11.6 — trade = 사기 · 도박 · 재굴림 · 제작: 결과를 되돌리는 세이브 스컴 틈을 막는다) */
export const IMMEDIATE_REASONS = ['scene', 'death', 'complete', 'collapse', 'new', 'delete', 'quit', 'trade'];
/** 설정 쓰기 디바운스(ms) */
export const SETTINGS_DEBOUNCE_MS = 250;

const INDEX_KEY = SAVE_KEYS.backupPrefix + 'index';
const PROBE_KEY = SAVE_KEYS.account.split(':')[0] + ':probe';

/** @param {number} slot */
export function charKey(slot) { return SAVE_KEYS.charPrefix + slot; }

// ───────────────────────── 설정 정화 ─────────────────────────

/**
 * SETTINGS_SCHEMA 로 정화 — 모르는 키 · 타입이 다른 값은 버린다 · 숫자는 [min, max]로 자른다 · enum 은 목록 안만.
 * @param {any} obj @param {typeof SETTINGS_SCHEMA} [schema] @returns {Partial<Settings>}
 */
export function sanitizeSettings(obj, schema = SETTINGS_SCHEMA) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of Object.keys(schema)) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const rule = /** @type {any} */ (schema)[k];
    const v = obj[k];
    if (rule.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = Math.max(rule.min, Math.min(rule.max, v));
    } else if (rule.type === 'bool') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (rule.type === 'enum') {
      if (rule.values.includes(v)) out[k] = v;
    }
  }
  return out;
}

// ───────────────────────── 저장소 ─────────────────────────

/**
 * @param {{ls?:StorageLike|null, now?:() => number}} [deps] ls 없으면 localStorage(접근이 막혀 있으면 null)
 */
export function createStorage({ ls = undefined, now = () => Date.now() } = {}) {
  /** @type {StorageLike|null} */
  let store = null;
  if (ls !== undefined) store = ls;
  else {
    try { store = globalThis.localStorage ?? null; } catch { store = null; }
  }

  /** @param {string} k @returns {string|null} */
  const get = (k) => {
    if (!store) return null;
    try { return store.getItem(k); } catch { return null; }
  };
  /** @param {string} k @param {string} v @returns {boolean} */
  const set = (k, v) => {
    if (!store) return false;
    try { store.setItem(k, v); return true; } catch { return false; }
  };
  /** @param {string} k */
  const del = (k) => {
    if (!store) return false;
    try { store.removeItem(k); return true; } catch { return false; }
  };
  /** 저장소의 키 전부(가짜 저장소에 key · length 가 없으면 []) */
  const keys = () => {
    /** @type {string[]} */
    const out = [];
    if (!store || typeof store.key !== 'function') return out;
    try {
      const n = Number(store.length) || 0;
      for (let i = 0; i < n; i++) { const k = store.key(i); if (k !== null) out.push(k); }
    } catch { /* 읽지 못하면 빈 목록 */ }
    return out;
  };

  /** 백업 목록(깨졌으면 저장소를 훑어 다시) @returns {string[]} */
  const readIndex = () => {
    const raw = get(INDEX_KEY);
    if (raw !== null) {
      try {
        const a = JSON.parse(raw);
        if (Array.isArray(a) && a.every((x) => typeof x === 'string')) return a;
      } catch { /* 아래에서 다시 */ }
    }
    return keys().filter((k) => k.startsWith(SAVE_KEYS.backupPrefix) && k !== INDEX_KEY).sort((a, b) => stampOf(a) - stampOf(b));
  };
  /** 백업 키 끝의 ms @param {string} k */
  const stampOf = (k) => Number(k.slice(k.lastIndexOf(':') + 1)) || 0;

  const api = {
    /** 쓰기 · 지우기 시험 */
    available() {
      if (!store) return false;
      try {
        store.setItem(PROBE_KEY, '1');
        store.removeItem(PROBE_KEY);
        return true;
      } catch {
        return false;
      }
    },

    /** 저장된 설정(정화한 부분 객체 · 없거나 깨졌으면 {}) @returns {Partial<Settings>} */
    loadSettings() {
      const raw = get(SAVE_KEYS.settings);
      if (raw === null) return {};
      try { return sanitizeSettings(JSON.parse(raw)); } catch { return {}; }
    },
    /** @param {Settings} s @returns {boolean} */
    writeSettings(s) {
      return set(SAVE_KEYS.settings, JSON.stringify(sanitizeSettings(s)));
    },

    /**
     * 백업 — `backupPrefix + key + ':' + ms` · 키마다 최신 BACKUPS_PER_KEY 개 · 목록 `backupPrefix + 'index'`.
     * @param {string} key 원래 키(SAVE_KEYS.account · charKey(slot) …) @returns {string|null} 만든 백업 키(원본이 없거나 실패면 null)
     */
    backup(key) {
      const v = get(key);
      if (v === null) return null;
      let ms = Math.floor(now());
      let bk = SAVE_KEYS.backupPrefix + key + ':' + ms;
      while (get(bk) !== null) bk = SAVE_KEYS.backupPrefix + key + ':' + ++ms;
      if (!set(bk, v)) return null;
      const index = readIndex().filter((k) => k !== bk);
      index.push(bk);
      const mine = index.filter((k) => k.startsWith(SAVE_KEYS.backupPrefix + key + ':'));
      while (mine.length > BACKUPS_PER_KEY) {
        const old = /** @type {string} */ (mine.shift());
        del(old);
        index.splice(index.indexOf(old), 1);
      }
      set(INDEX_KEY, JSON.stringify(index));
      return bk;
    },
    /** 그 키의 백업 목록(오래된 것부터) @param {string} key */
    backupsOf(key) {
      return readIndex().filter((k) => k.startsWith(SAVE_KEYS.backupPrefix + key + ':'));
    },

    /**
     * 계정 읽기 — P6 loadAccount(raw) · 깨졌으면 백업 → rebuildAccount(칸 0..3 의 캐릭터 세이브) → 계정 · 다시 세운 캐릭터를 쓴다(ID 가 바뀌었을 수 있다) ·
     * 계정 키가 없는데 캐릭터 세이브가 있으면 말없이 같은 길로 다시 세운다 · 미래 버전이면 덮어쓰지 않는다(future) ·
     * 계정 요약이 빈 칸에 캐릭터 세이브가 있으면 요약을 채운다(새 캐릭터의 덮어쓰기 확인이 요약을 보므로).
     * @returns {{account:AccountState, broken:boolean, rebuilt:boolean, future:boolean, reason:string|null}}
     */
    loadAccount() {
      const raw = get(SAVE_KEYS.account);
      /** @type {Array<string|null>} */
      const charRaws = [];
      for (let s = 0; s < CHAR_SLOTS; s++) charRaws.push(get(charKey(s)));
      const r = readAccount(raw);
      if (r.future) return { account: r.account, broken: false, rebuilt: false, future: true, reason: r.reason };
      const hasChars = charRaws.some((x) => x !== null);
      if (r.broken || (raw === null && hasChars)) {
        if (r.broken) api.backup(SAVE_KEYS.account);
        const rb = rebuildAccount(charRaws);
        for (let s = 0; s < CHAR_SLOTS; s++) {
          const ch = rb.chars[s];
          if (!ch) continue;
          if (readChar(charRaws[s], s).future) continue;          // 미래 버전 캐릭터는 덮어쓰지 않는다
          set(charKey(s), JSON.stringify({ ...serializeChar(ch), savedAt: Math.floor(now()) }));
        }
        set(SAVE_KEYS.account, JSON.stringify({ ...serializeAccount(/** @type {any} */ ({ account: rb.account, char: null })), savedAt: Math.floor(now()) }));
        return { account: rb.account, broken: r.broken, rebuilt: true, future: false, reason: r.broken ? r.reason : 'missing' };
      }
      const account = r.account;
      for (let s = 0; s < CHAR_SLOTS; s++) {
        if (account.chars[s] || charRaws[s] === null) continue;
        const c = readChar(charRaws[s], s);
        if (c.char) account.chars[s] = summaryOf(c.char);
      }
      return { account, broken: false, rebuilt: false, future: false, reason: r.reason };
    },
    /**
     * 저장된 계정의 savedAt(ms — 없거나 읽지 못하면 null) — 여러 탭: 이 탭이 마지막으로 보거나 쓴 값보다 새로우면 다른 탭이 썼다(Game 이 쓰기 전에 본다)
     * @returns {number|null}
     */
    accountSavedAt() {
      const raw = get(SAVE_KEYS.account);
      if (raw === null) return null;
      try {
        const v = JSON.parse(raw)?.savedAt;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    },
    /** 계정 쓰기(serializeAccount · savedAt) @param {import('../types.js').GameState} state @returns {boolean} */
    writeAccount(state) {
      try {
        return set(SAVE_KEYS.account, JSON.stringify({ ...serializeAccount(state), savedAt: Math.floor(now()) }));
      } catch {
        return false;
      }
    },

    /**
     * 캐릭터 읽기 — P6 loadChar(raw, slot) · 깨졌으면 백업 → 그 칸 비움(키를 지운다) · 미래 버전이면 future(읽기만)
     * @param {number} slot @returns {{char:CharacterState|null, broken:boolean, future:boolean, reason:string|null}}
     */
    loadChar(slot) {
      const key = charKey(slot);
      const raw = get(key);
      const r = readChar(raw, slot);
      if (r.broken) {
        api.backup(key);
        del(key);
      }
      return { char: r.char, broken: r.broken, future: !!r.future, reason: r.reason };
    },
    /** 캐릭터 쓰기(serializeChar · savedAt) — 칸 = char.slot @param {CharacterState} char @returns {boolean} */
    writeChar(char) {
      if (!char || !Number.isInteger(char.slot) || char.slot < 0 || char.slot >= CHAR_SLOTS) return false;
      try {
        return set(charKey(char.slot), JSON.stringify({ ...serializeChar(char), savedAt: Math.floor(now()) }));
      } catch {
        return false;
      }
    },
    /** 저장소에 그 칸의 캐릭터 키가 있는가(계정 요약이 아니라 — §11.2 newChar) @param {number} slot */
    hasChar(slot) { return get(charKey(slot)) !== null; },
    /** 백업 뒤 지운다 @param {number} slot @returns {boolean} */
    removeChar(slot) {
      const key = charKey(slot);
      if (get(key) === null) return true;
      api.backup(key);
      return del(key);
    },
  };
  return api;
}

// ───────────────────────── 저장 시점 ─────────────────────────

/**
 * SAVE_REQUEST 묶기 — 프레임 끝에 take() 로 이번에 쓸 것을 정한다.
 *  · 캐릭터를 쓸 때는 계정도 같이(scope 'char' 도) · 캐릭터는 최소 gapMs 간격 · IMMEDIATE_REASONS 면 바로
 *  · force(탭 숨김 · pagehide)면 캐릭터가 있을 때 무조건 캐릭터 + 계정(밀린 것이 없어도 — 경험치 · 플레이 시간)
 *  · 캐릭터가 없어졌으면(타이틀로) 캐릭터 요청은 계정 쓰기로 바꾼다
 * @param {{gapMs?:number, immediate?:string[]}} [o]
 */
export function createSaveScheduler({ gapMs = CHAR_SAVE_GAP_MS, immediate = IMMEDIATE_REASONS } = {}) {
  let wantChar = false, wantAccount = false, urgent = false;
  let lastChar = -Infinity;
  return {
    /** @param {'char'|'account'|'all'|string} scope @param {string} [reason] */
    request(scope, reason = '') {
      if (scope === 'char' || scope === 'all') {
        wantChar = true;
        if (immediate.includes(reason)) urgent = true;
      }
      if (scope === 'account' || scope === 'all') wantAccount = true;
      if (scope !== 'char' && scope !== 'account' && scope !== 'all') { wantChar = true; wantAccount = true; }
    },
    /**
     * @param {number} nowMs @param {{force?:boolean, hasChar?:boolean}} [o]
     * @returns {{char:boolean, account:boolean}}
     */
    take(nowMs, { force = false, hasChar = true } = {}) {
      const out = { char: false, account: false };
      if (!hasChar && wantChar) { wantChar = false; urgent = false; wantAccount = true; }
      if (hasChar && (force || (wantChar && (urgent || nowMs - lastChar >= gapMs)))) {
        out.char = true;
        out.account = true;
        wantChar = false;
        urgent = false;
        wantAccount = false;
        lastChar = nowMs;
      }
      if (wantAccount) { out.account = true; wantAccount = false; }
      return out;
    },
    /** 밀린 요청이 있는가 */
    get pending() { return wantChar || wantAccount; },
    /** 마지막 캐릭터 쓰기 시각을 지금으로(바로 쓴 경로 — quitToTitle · selectChar) @param {number} nowMs */
    markWritten(nowMs) { lastChar = nowMs; wantChar = false; urgent = false; wantAccount = false; },
    clear() { wantChar = false; wantAccount = false; urgent = false; },
  };
}

/**
 * 디바운스 — schedule() 을 ms 안에 여러 번 불러도 마지막 뒤 한 번 · flush() 는 밀린 것을 바로(pagehide).
 * @param {() => void} fn @param {number} ms @param {{setTimer?:(f:() => void, ms:number) => any, clearTimer?:(h:any) => void}} [timers]
 */
export function createDebouncer(fn, ms, { setTimer = (f, t) => setTimeout(f, t), clearTimer = (h) => clearTimeout(h) } = {}) {
  /** @type {any} */
  let h = null;
  return {
    schedule() {
      if (h !== null) clearTimer(h);
      h = setTimer(() => { h = null; fn(); }, ms);
    },
    flush() {
      if (h === null) return;
      clearTimer(h);
      h = null;
      fn();
    },
    cancel() {
      if (h !== null) clearTimer(h);
      h = null;
    },
    get pending() { return h !== null; },
  };
}
