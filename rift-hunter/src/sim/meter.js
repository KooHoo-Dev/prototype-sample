// OWNER: P2 — 계약 §6.8 · §5.15
// STUB — W1 에서 P2 가 채운다(DPS · 받은 피해 · 분당 처치 · 떼 순간). W0: updateMeter no-op · meterView 는 0 으로 채운 모양

import { RARITIES } from '../core/constants.js';

/** STUB @param {import('../types.js').SimCtx} ctx */
export function updateMeter(ctx) {}

/**
 * STUB — 순수 · 계측 HUD · 분석
 * @param {import('../types.js').GameState} state
 * @returns {{dps:number, takenPerSec:number, killsPerMin:number, xpPerHour:number, goldPerHour:number, elapsedSec:number, gaugePerMin:number, targeting:number, drops:Record<string, number>}}
 */
export function meterView(state) {
  /** @type {Record<string, number>} */
  const drops = {};
  for (const r of RARITIES) drops[r] = 0;
  return { dps: 0, takenPerSec: 0, killsPerMin: 0, xpPerHour: 0, goldPerHour: 0, elapsedSec: 0, gaugePerMin: 0, targeting: 0, drops };
}
