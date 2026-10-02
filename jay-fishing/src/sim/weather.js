// OWNER: P3 — 계약 §6.4 · §7.2
// STUB — W0 스텁(§6.14): weatherFor → 'clear' · refreshWeather → 전부 clear(+ env 갱신). P3 가 시드 해시로 채운다.

import { STAGE_IDS } from '../core/constants.js';
import { updateEnv } from './world.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').WeatherId} WeatherId */

/**
 * STUB — 순수: hash32(seed, day, 스테이지 순번)로 stage.weatherWeights 에서 고른다(§7.2).
 * @param {number} seed @param {number} day @param {string} stageId @returns {WeatherId}
 */
export function weatherFor(seed, day, stageId) {
  void seed; void day; void stageId;
  return 'clear';
}

/** STUB — today · tomorrow · current · env 갱신(지금은 전부 clear) @param {SimCtx} ctx */
export function refreshWeather(ctx) {
  const s = ctx.state;
  const today = {};
  const tomorrow = {};
  for (const id of STAGE_IDS) {
    today[id] = weatherFor(s.seed, s.clock ? s.clock.day : 1, id);
    tomorrow[id] = weatherFor(s.seed, (s.clock ? s.clock.day : 1) + 1, id);
  }
  s.weather.today = today;
  s.weather.tomorrow = tomorrow;
  s.weather.current = s.scene === 'home' ? today.lake : today[s.scene] ?? 'clear';
  updateEnv(ctx);
}
