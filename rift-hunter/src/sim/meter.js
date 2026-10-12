// OWNER: P2 — 계약 §6.8 · §5.15
// 계측 — DPS(최근 5초 링 버퍼) · 받은 피해/초 · 분당 처치 · 시간당 경험치 · 골드 · 떼 순간(25마리 이상이 노린 순간).
// 준 · 받은 피해는 combat.js 가 그 틱의 칸(meter.dealt[idx] · taken[idx])에 쌓고, updateMeter 가 틱 끝에 칸을 넘긴다.
// 처치 틱(killTicks)은 rift.resolveDeaths 가 쌓는다(최근 METER.killCap 개).

import { RARITIES, TICK_HZ } from '../core/constants.js';
import { METER } from '../data/combat.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').GameState} GameState */

/** 단위 환산(초) */
const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;

/**
 * 틱 끝 — 노리는 몬스터 수(깨어 있고 살아 있고 targeting) · 최대 · 떼 순간(swarmOn 이상이고 swarmArmed 면 +1 · swarmOff 아래로 내려가면 다시 armed) ·
 * 링 버퍼 다음 칸으로(그 칸을 0 으로)
 * @param {SimCtx} ctx
 */
export function updateMeter(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const m = st.meter;
  if (!rift || !m) return;
  const mons = rift.mons;
  let n = 0;
  for (let i = 0; i < mons.length; i++) {
    const mon = mons[i];
    if (mon.awake && mon.targeting && !mon.dead && !mon.gone && mon.hp > 0) n++;
  }
  m.targeting = n;
  if (n > rift.stats.maxTargeting) rift.stats.maxTargeting = n;
  if (m.swarmArmed && n >= METER.swarmOn) {
    rift.stats.swarmMoments += 1;
    m.swarmArmed = false;
  } else if (!m.swarmArmed && n < METER.swarmOff) {
    m.swarmArmed = true;
  }
  const len = m.dealt.length || METER.window;
  m.idx = (m.idx + 1) % len;
  m.dealt[m.idx] = 0;
  if (m.taken.length === len) m.taken[m.idx] = 0;
}

/**
 * 순수 — 계측 HUD · 분석. 균열이 없으면 0 으로 채운 모양.
 * @param {GameState} state
 * @returns {{dps:number, takenPerSec:number, killsPerMin:number, xpPerHour:number, goldPerHour:number, elapsedSec:number, gaugePerMin:number, targeting:number, drops:Record<string, number>}}
 */
export function meterView(state) {
  /** @type {Record<string, number>} */
  const drops = {};
  const rift = state.rift;
  for (const r of RARITIES) drops[r] = rift ? rift.stats.drops[r] ?? 0 : 0;
  const m = state.meter;
  if (!m) return { dps: 0, takenPerSec: 0, killsPerMin: 0, xpPerHour: 0, goldPerHour: 0, elapsedSec: 0, gaugePerMin: 0, targeting: 0, drops };
  let dealt = 0, taken = 0;
  for (let i = 0; i < m.dealt.length; i++) dealt += m.dealt[i];
  for (let i = 0; i < m.taken.length; i++) taken += m.taken[i];
  const winSec = (m.dealt.length || METER.window) / TICK_HZ;
  const since = state.tick - SEC_PER_MIN * TICK_HZ;
  let kills = 0;
  for (let i = 0; i < m.killTicks.length; i++) if (m.killTicks[i] > since) kills++;
  const elapsedSec = rift ? rift.ticksIn / TICK_HZ : 0;
  const perHour = (v) => (elapsedSec > 0 ? (v / elapsedSec) * SEC_PER_HOUR : 0);
  return {
    dps: dealt / winSec,
    takenPerSec: taken / winSec,
    killsPerMin: kills,
    xpPerHour: perHour(m.runXp),
    goldPerHour: perHour(m.runGold),
    elapsedSec,
    gaugePerMin: rift && elapsedSec > 0 ? rift.gauge / (elapsedSec / SEC_PER_MIN) : 0,
    targeting: m.targeting,
    drops,
  };
}
