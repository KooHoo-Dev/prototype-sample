// OWNER: P2 — 계약 §6.8 · §5.10 · §5.11 · §5.18
// STUB — W0 에 완성으로 내는 것: requestTravel(§5.11 앞부분) · riftElapsedSec · 나머지(사망 · 부활 · 게이지 · 수호자 · 완료 · 붕괴 · 포털)는 W1 에서 P2 가 채운다
// rift.js 는 player/* 를 import 하지 않는다.

import { EV } from '../core/events.js';
import { TICK_HZ } from '../core/constants.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Travel} Travel */
/** @typedef {import('../types.js').Result} Result */

/**
 * 장면 전환 요청 — pendingTravel 이 있으면 {ok:false, reason:'busy'} · 균열 장면이면 rift.leftAt = tick · TRAVEL_REQUEST
 * @param {SimCtx} ctx @param {Travel} travel @returns {Result}
 */
export function requestTravel(ctx, travel) {
  const st = ctx.state;
  if (st.pendingTravel) return { ok: false, reason: 'busy' };
  if (st.scene === 'rift' && st.rift) st.rift.leftAt = st.tick;
  st.pendingTravel = { ...travel };
  ctx.emit(EV.TRAVEL_REQUEST, { to: travel.to, reason: travel.reason });
  return { ok: true };
}

/** STUB — 마을 포털 → 균열 복귀 요청 @param {SimCtx} ctx @returns {Result} */
export function requestReturnToRift(ctx) {
  return { ok: false, reason: 'stub' };
}

/** STUB — 귀환 완료(P1 이 부른다) @param {SimCtx} ctx @param {import('../types.js').Vec2} pos */
export function openRecallPortal(ctx, pos) {}

/** STUB — ctx.hooks.onPlayerKilled 구현(§5.10) @param {SimCtx} ctx @param {import('../types.js').MonsterState|null} killer */
export function killPlayer(ctx, killer) {}

/** STUB — 생명 ≤ 0 인 몬스터 처리 @param {SimCtx} ctx */
export function resolveDeaths(ctx) {}

/** STUB — 게이지 · 수호자 출현 · 완료 요약 · 탐색 · 안전 지점 · 진정 @param {SimCtx} ctx */
export function updateRift(ctx) {}

/** STUB @param {SimCtx} ctx @param {number} pct */
export function addGauge(ctx, pct) {}

/** 순수 — 균열 경과 초(ticksIn / 30 · 균열이 없으면 0) @param {import('../types.js').GameState} state */
export function riftElapsedSec(state) {
  return state.rift ? state.rift.ticksIn / TICK_HZ : 0;
}
