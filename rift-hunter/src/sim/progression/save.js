// OWNER: P6 — 계약 §6.11 · §3.11
// STUB — W0 에 완성으로 내는 것: serializeAccount · serializeChar · 나머지(읽기 · 정화 · ID 정리 · 계정 복구)는 W1 에서 P6 이 채운다
// 직렬화 · 검증 · 이주 · 정화 — throw 하지 않는다.

import { CHAR_SLOTS, GAME_ID, SAVE_VERSION } from '../../core/constants.js';
import { createAccount, emptyArray } from '../state.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').AccountSave} AccountSave */
/** @typedef {import('../../types.js').CharSave} CharSave */

/** 순수 객체 깊은 복사(JSON 왕복) @template T @param {T} v @returns {T} */
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 계정 세이브(savedAt 은 app 이 덮어쓴다) @param {GameState} state @returns {AccountSave} */
export function serializeAccount(state) {
  const a = state.account;
  return { v: SAVE_VERSION, game: GAME_ID, savedAt: 0, chars: clone(a.chars), stash: clone(a.stash), nextItemId: a.nextItemId, lastSlot: a.lastSlot };
}

/** 캐릭터 세이브 — 재고는 저장하고 재굴림 제안만 뺀다 @param {CharacterState} char @returns {CharSave} */
export function serializeChar(char) {
  const { shop, ...rest } = char;
  const out = clone(rest);
  out.shop = { restocks: shop.restocks, stockRun: shop.stockRun, blacksmith: clone(shop.blacksmith), general: clone(shop.general) };
  return { v: SAVE_VERSION, game: GAME_ID, savedAt: 0, char: out };
}

/** STUB — 계정 읽기(JSON 문자열|null · throw 금지) @param {string|null} raw */
export function loadAccount(raw) {
  return { account: createAccount(), broken: false, reason: null };
}

/** STUB — 캐릭터 읽기 @param {string|null} raw @param {number} slot */
export function loadChar(raw, slot) {
  return { char: /** @type {CharacterState|null} */ (null), broken: false, reason: null };
}

/** STUB — 아이템 정화(모르는 기본형 → null) @param {any} raw @returns {import('../../types.js').Item|null} */
export function sanitizeItem(raw) { return null; }

/** STUB — ID 중복 정리 @param {import('../../types.js').AccountState} account @param {Array<CharacterState|null>} chars */
export function dedupeItemIds(account, chars) { return { changed: false }; }

/** STUB — 계정이 깨졌을 때 캐릭터 세이브로 다시 세운다 @param {Array<string|null>} charRaws */
export function rebuildAccount(charRaws) {
  return { account: createAccount(), chars: /** @type {Array<CharacterState|null>} */ (emptyArray(CHAR_SLOTS)) };
}
