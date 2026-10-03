// OWNER: P4 — 계약 §6.7 · §3.7 · §11.5
// 세이브 만들기(결과 대기 물고기 반영) · 직렬화 · 읽기(던지지 않는다 — JSON → game → 미래 버전 → 마이그레이션 → 필수 필드 → sanitize) · 설정 정리.

import { GAME_ID, SAVE_VERSION, SCENE_IDS, TICKS_PER_DAY } from '../../core/constants.js';
import { hash32 } from '../../core/hash.js';
import { HOLD, LIMITS, SETTINGS_RANGE } from '../../data/economy.js';
import { DEFAULT_SETTINGS } from '../../data/settings.js';
import { STAGES_BY_ID } from '../../data/stages/index.js';
import { sanitizeProfile } from './profile.js';
import { applyCatchToProfile } from './progress.js';

/** @typedef {import('../../types.js').SaveData} SaveData */
/** @typedef {import('../../types.js').Settings} Settings */

/**
 * 버전 → 다음 버전으로 올리는 함수(v1 이 처음 — 미래 버전을 위한 자리). MIGRATIONS[v](obj) → v + 1 모양의 객체 | null.
 * @type {Record<number, (obj:any) => any>}
 */
const MIGRATIONS = {};

/** @param {any} v */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 옛 세이브(rng 없음)의 난수 상태 — 시드 · 저장 시각에서 만든다(세이브마다 다른 자리에서 시작한다).
 * @param {number} seed @param {number} day @param {number} tickInDay @returns {number} uint32
 */
export function derivedRngState(seed, day, tickInDay) {
  return hash32(seed, day, tickInDay, 0x5a7e) >>> 0;
}

/**
 * SaveData(§3.7). 프로필은 **사본**이다 — rig.phase === 'result' 면 결과 대기 물고기(pendingCatch)를 그 사본에 반영한다
 * (어창에 자리가 있으면 keep, 없으면 release — applyCatchToProfile). sim 상태는 바꾸지 않는다.
 * rng = 지금 난수 상태(state.rng.s) — 불러오면 난수열을 잇는다(리뷰 수정: 시드에서 다시 시작하면 이어하기 첫 물고기가 늘 같았다).
 * @param {Object} state GameState @param {number} savedAt ms @returns {SaveData}
 */
export function createSaveData(state, savedAt) {
  const s = /** @type {any} */ (state);
  const profile = structuredClone(s.profile);
  const rec = s.pendingCatch;
  if (s.rig && s.rig.phase === 'result' && rec && !profile.hold.some(c => c.uid === rec.uid)) {
    applyCatchToProfile(profile, structuredClone(rec), profile.hold.length < HOLD.capacity);
  }
  const seed = s.seed >>> 0;
  const clock = { day: s.clock.day, tickInDay: s.clock.tickInDay };
  const rngS = s.rng && typeof s.rng.s === 'number' && Number.isFinite(s.rng.s) ? s.rng.s >>> 0 : derivedRngState(seed, clock.day, clock.tickInDay);
  return {
    game: GAME_ID,
    version: SAVE_VERSION,
    savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
    seed,
    rng: rngS,
    clock,
    scene: s.scene,
    profile,
  };
}

/** @param {SaveData} save @returns {string} */
export function serializeSave(save) {
  return JSON.stringify(save);
}

/**
 * 세이브 원문 → {save, error}. 던지지 않는다. 순서: JSON 파싱('json') → game 일치('game') → version > SAVE_VERSION 이면 'future'
 * → version < SAVE_VERSION 이면 migrateSave(실패하면 'fields') → 필수 필드(profile · clock 객체 · seed 수 · scene 문자열 — 없으면 'fields')
 * → 범위 정리(seed uint32 · day ≥ 1 · tickInDay 0..TICKS_PER_DAY−1 · 모르는/잠긴 씬은 home) · sanitizeProfile.
 * rng(난수 상태)는 선택 필드 — 유한한 수면 uint32 로, 없거나 깨졌으면(옛 세이브) derivedRngState(seed, day, tickInDay).
 * @param {string} text @returns {{save:SaveData|null, error:'json'|'game'|'future'|'fields'|null}}
 */
export function parseSave(text) {
  try {
    /** @type {any} */
    let obj;
    try {
      if (typeof text !== 'string') return { save: null, error: 'json' };
      obj = JSON.parse(text);
    } catch {
      return { save: null, error: 'json' };
    }
    if (!isObj(obj)) return { save: null, error: 'json' };
    if (obj.game !== GAME_ID) return { save: null, error: 'game' };
    const v = obj.version;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { save: null, error: 'fields' };
    if (v > SAVE_VERSION) return { save: null, error: 'future' };
    if (v < SAVE_VERSION) {
      obj = migrateSave(obj);
      if (!isObj(obj)) return { save: null, error: 'fields' };
    }
    if (!isObj(obj.profile) || !isObj(obj.clock) || typeof obj.seed !== 'number' || !Number.isFinite(obj.seed) || typeof obj.scene !== 'string') {
      return { save: null, error: 'fields' };
    }
    const profile = sanitizeProfile(obj.profile);
    const dayRaw = obj.clock.day;
    const tickRaw = obj.clock.tickInDay;
    const day = typeof dayRaw === 'number' && Number.isFinite(dayRaw) ? Math.max(1, Math.min(LIMITS.statMax, Math.floor(dayRaw))) : 1;
    const tickInDay = typeof tickRaw === 'number' && Number.isFinite(tickRaw) ? Math.max(0, Math.min(TICKS_PER_DAY - 1, Math.floor(tickRaw))) : 0;
    let scene = SCENE_IDS.includes(obj.scene) ? obj.scene : 'home';
    const st = STAGES_BY_ID[scene];
    if (!st || profile.level < st.unlockLevel) scene = 'home';
    const seed = obj.seed >>> 0;
    const rng = typeof obj.rng === 'number' && Number.isFinite(obj.rng) ? obj.rng >>> 0 : derivedRngState(seed, day, tickInDay);
    return {
      save: {
        game: GAME_ID,
        version: SAVE_VERSION,
        savedAt: typeof obj.savedAt === 'number' && Number.isFinite(obj.savedAt) ? obj.savedAt : 0,
        seed,
        rng,
        clock: { day, tickInDay },
        scene: /** @type {any} */ (scene),
        profile,
      },
      error: null,
    };
  } catch {
    return { save: null, error: 'fields' };
  }
}

/**
 * 과거 버전 → 지금 버전(MIGRATIONS 를 차례로). 지금 버전이면 그대로 · 올릴 길이 없거나 미래 버전 · 모양이 깨졌으면 null. 던지지 않는다.
 * @param {any} obj @returns {SaveData|null}
 */
export function migrateSave(obj) {
  try {
    if (!isObj(obj) || typeof obj.version !== 'number' || !Number.isInteger(obj.version)) return null;
    let cur = obj;
    while (cur.version < SAVE_VERSION) {
      const step = MIGRATIONS[cur.version];
      if (!step) return null;
      const next = step(cur);
      if (!isObj(next) || !(next.version > cur.version)) return null;
      cur = next;
    }
    return cur.version === SAVE_VERSION ? cur : null;
  } catch {
    return null;
  }
}

/** @param {any} v @param {number} lo @param {number} hi @param {number} def */
function num(v, lo, hi, def) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 설정 정리(§3.7) — 모르는 키 제거 · 범위 자르기 · 잘못된 값은 기본값. 던지지 않는다.
 * @param {any} raw @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const r = isObj(raw) ? raw : {};
  const vol = isObj(r.volume) ? r.volume : {};
  /** @type {Record<string, number>} */
  const volume = {};
  for (const k of SETTINGS_RANGE.volumeKeys) volume[k] = num(vol[k], 0, 1, /** @type {any} */ (d.volume)[k]);
  return {
    version: d.version,
    mouseSens: num(r.mouseSens, SETTINGS_RANGE.mouseSens[0], SETTINGS_RANGE.mouseSens[1], d.mouseSens),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
    quality: /** @type {any} */ (SETTINGS_RANGE.quality.includes(r.quality) ? r.quality : d.quality),
    fov: num(r.fov, SETTINGS_RANGE.fov[0], SETTINGS_RANGE.fov[1], d.fov),
    volume: /** @type {any} */ (volume),
    hints: typeof r.hints === 'boolean' ? r.hints : d.hints,
  };
}
