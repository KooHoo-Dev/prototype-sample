// OWNER: P3 — 계약 §6.4 · §7.2
// 날씨 — 하루 단위 · 스테이지마다 · 시드 해시로 정해진다. 예보(내일)도 같은 함수(day + 1)라 예보 = 다음 날 실제다.

import { STAGE_IDS, WEATHER_IDS } from '../core/constants.js';
import { hash32 } from '../core/hash.js';
import { STAGES_BY_ID } from '../data/stages/index.js';
import { updateEnv } from './world.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').WeatherId} WeatherId */

const U32 = 4294967296;   // 2^32

/**
 * 순수: u = hash32(seed, day, 스테이지 순번 + 1) / 2^32 → stage.weatherWeights 를 WEATHER_IDS 순서로 누적해 고른다(§7.2).
 * 모르는 스테이지 · 가중치 합 ≤ 0 이면 'clear'.
 * @param {number} seed @param {number} day @param {string} stageId @returns {WeatherId}
 */
export function weatherFor(seed, day, stageId) {
  const idx = STAGE_IDS.indexOf(stageId);
  const stage = STAGES_BY_ID[stageId];
  if (idx < 0 || !stage) return 'clear';
  const ww = stage.weatherWeights || {};
  let total = 0;
  for (const id of WEATHER_IDS) total += Math.max(0, ww[id] || 0);
  if (!(total > 0)) return 'clear';
  const u = hash32(seed, day, idx + 1) / U32;
  let acc = 0;
  for (const id of WEATHER_IDS) {
    acc += Math.max(0, ww[id] || 0) / total;
    if (u < acc) return /** @type {WeatherId} */ (id);
  }
  // 부동소수 누적 오차로 끝까지 왔으면 가중치가 있는 마지막 날씨
  for (let i = WEATHER_IDS.length - 1; i >= 0; i--) if ((ww[WEATHER_IDS[i]] || 0) > 0) return /** @type {WeatherId} */ (WEATHER_IDS[i]);
  return 'clear';
}

/**
 * 지금 씬의 날씨(집은 lake 의 날씨 — 창밖 연출용) @param {{scene:string, weather:{today:Object}}} state @returns {WeatherId}
 */
export function currentWeatherOf(state) {
  const key = state.scene === 'home' ? 'lake' : state.scene;
  return state.weather.today[key] || 'clear';
}

/** today · tomorrow(시드 해시) · current · env 갱신. 이벤트는 내지 않는다(부르는 쪽이 WEATHER_CHANGED) @param {SimCtx} ctx */
export function refreshWeather(ctx) {
  const s = ctx.state;
  const day = s.clock ? s.clock.day : 1;
  const today = {};
  const tomorrow = {};
  for (const id of STAGE_IDS) {
    today[id] = weatherFor(s.seed, day, id);
    tomorrow[id] = weatherFor(s.seed, day + 1, id);
  }
  s.weather.today = today;
  s.weather.tomorrow = tomorrow;
  s.weather.current = currentWeatherOf(s);
  updateEnv(ctx);
}

/** WEATHER_CHANGED payload(사본 — 구독자가 상태를 붙잡지 않게) @param {{weather:Object}} state */
export function weatherPayload(state) {
  const w = state.weather;
  return { current: w.current, today: { ...w.today }, tomorrow: { ...w.tomorrow } };
}
