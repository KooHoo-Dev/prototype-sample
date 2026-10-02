// OWNER: P4 — 계약 §6.7 · §3.7 · §11.5
// STUB — W0 스텁(§6.14): createSaveData = §3.7 모양(pendingCatch 반영 없음) · serializeSave = JSON.stringify
//   · parseSave = {save:null, error:'stub'} · migrateSave = null · sanitizeSettings = {...DEFAULT_SETTINGS, ...raw}. P4 가 채운다.

import { GAME_ID, SAVE_VERSION } from '../../core/constants.js';
import { DEFAULT_SETTINGS } from '../../data/settings.js';

/** @typedef {import('../../types.js').SaveData} SaveData */
/** @typedef {import('../../types.js').Settings} Settings */

/**
 * STUB — §3.7 모양. sim 상태는 바꾸지 않는다(프로필은 사본).
 * @param {Object} state GameState @param {number} savedAt ms @returns {SaveData}
 */
export function createSaveData(state, savedAt) {
  const s = /** @type {any} */ (state);
  return {
    game: GAME_ID,
    version: SAVE_VERSION,
    savedAt,
    seed: s.seed,
    clock: { day: s.clock.day, tickInDay: s.clock.tickInDay },
    scene: s.scene,
    profile: structuredClone(s.profile),
  };
}

/** @param {SaveData} save @returns {string} */
export function serializeSave(save) {
  return JSON.stringify(save);
}

/** STUB — 던지지 않는다 @param {string} text @returns {{save:SaveData|null, error:string|null}} */
export function parseSave(text) {
  void text;
  return { save: null, error: 'stub' };
}

/** STUB — v1 이 처음 @param {any} obj @returns {SaveData|null} */
export function migrateSave(obj) {
  void obj;
  return null;
}

/** STUB @param {any} raw @returns {Settings} */
export function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { ...structuredClone(DEFAULT_SETTINGS), ...r };
}
