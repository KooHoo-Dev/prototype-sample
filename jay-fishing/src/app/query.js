// OWNER: P9 — 계약 §6.12 · §11.6
// 개발용 URL 쿼리 → DevQuery(순수 — DOM 없이 Node 에서 돈다 · app.query.test).
// 규칙: 모르는 키 · 잘못된 값은 무시한다(던지지 않는다). 숫자는 범위로 자르고(level 1..20 · time 0..24 · money ≥ 0 · gear 1..3), 숫자가 아니면 무시.
// quality · mute · nopause 를 뺀 쿼리가 **유효한 값으로** 하나라도 있으면 개발 세션(devSession) — 타이틀 없이 시작 · 세이브를 읽지도 쓰지도 않는다.

import { SCENE_IDS, WEATHER_IDS } from '../core/constants.js';
import { XP } from '../data/economy.js';
import { SPOTS_BY_ID } from '../data/stages/index.js';
import { FIXTURE_NAMES } from '../debug/fixtures.js';

/** @typedef {import('../types.js').DevQuery} DevQuery */

/** ?panel 로 열 수 있는 패널(§11.6) */
export const QUERY_PANELS = ['tackle', 'pc', 'sell', 'camp', 'map', 'bed', 'pause', 'result'];
/** ?bot 전략 — '1' · 'true' · '' 은 basic */
export const BOT_STRATEGIES = ['basic', 'controlled', 'mindless', 'locked'];
const QUALITIES = ['low', 'medium', 'high'];
const TRUE_WORDS = ['1', 'true', 'yes', 'on', ''];
const MONEY_MAX = 1e12;

/** @returns {DevQuery} 쿼리가 하나도 없을 때의 값 */
export function emptyQuery() {
  return {
    devSession: false, fresh: false, scene: null, spot: null, level: null, money: null, gear: null, time: null, weather: null,
    seed: null, bot: null, panel: null, fixture: null, nopause: false, overrides: {},
  };
}

/** @param {string|null} v @returns {boolean} */
function truthy(v) {
  return v !== null && TRUE_WORDS.includes(v.trim().toLowerCase());
}

/** @param {string|null} v @returns {number|null} 유한수가 아니면 null */
function num(v) {
  if (v === null) return null;
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** @param {string|null} v @param {readonly string[]} list @returns {string|null} */
function pick(v, list) {
  if (v === null) return null;
  const s = v.trim();
  return list.includes(s) ? s : null;
}

/**
 * location.search(앞의 '?' 있어도 없어도) → DevQuery. 던지지 않는다.
 * @param {string} search @returns {DevQuery}
 */
export function parseQuery(search) {
  const q = emptyQuery();
  let p;
  try {
    p = new URLSearchParams(typeof search === 'string' ? search : '');
  } catch {
    return q;
  }
  const get = (k) => p.get(k);

  q.fresh = truthy(get('fresh'));
  q.scene = /** @type {any} */ (pick(get('scene'), SCENE_IDS));
  q.spot = /** @type {any} */ (pick(get('spot'), Object.keys(SPOTS_BY_ID)));

  const level = num(get('level'));
  if (level !== null) q.level = Math.max(1, Math.min(XP.levelCap, Math.round(level)));
  const gear = num(get('gear'));
  if (gear !== null && [1, 2, 3].includes(Math.round(gear))) q.gear = Math.round(gear);
  const money = num(get('money'));
  if (money !== null && money >= 0) q.money = Math.min(MONEY_MAX, Math.round(money));
  const time = num(get('time'));
  if (time !== null && time >= 0 && time <= 24) q.time = time >= 24 ? 0 : time;
  q.weather = /** @type {any} */ (pick(get('weather'), WEATHER_IDS));
  const seed = num(get('seed'));
  if (seed !== null) q.seed = Math.trunc(seed) >>> 0;

  const bot = get('bot');
  if (bot !== null) {
    const b = bot.trim().toLowerCase();
    if (BOT_STRATEGIES.includes(b)) q.bot = /** @type {any} */ (b);
    else if (truthy(b)) q.bot = 'basic';
  }
  q.panel = /** @type {any} */ (pick(get('panel'), QUERY_PANELS));
  q.fixture = pick(get('fixture'), FIXTURE_NAMES);

  const quality = pick(get('quality'), QUALITIES);
  if (quality) q.overrides.quality = /** @type {any} */ (quality);
  if (truthy(get('mute'))) q.overrides.mute = true;
  q.nopause = truthy(get('nopause'));

  q.devSession = q.fresh || q.scene !== null || q.spot !== null || q.level !== null || q.money !== null || q.gear !== null || q.time !== null
    || q.weather !== null || q.seed !== null || q.bot !== null || q.panel !== null || q.fixture !== null;
  return q;
}
