// OWNER: P3 — 계약 §6.4 · §7.2b · §5.1
// STUB — W0 스텁(§6.14): updateWalk → {enterSpotId:null} · findNearby → null.
//   placePlayer · updateEnv 는 계약 식 그대로 W0 에 완성으로 냈다(최소 부트의 ?spot · ?time 이 쓴다) — P3 가 그대로 두거나 다시 쓴다.
// fishing/* 을 import 하지 않는다(§2.2).

import { EV } from '../core/events.js';
import { WEATHER } from '../data/weather.js';
import { getStage } from '../data/stages/index.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').InteractTarget} InteractTarget */
/** @typedef {import('../types.js').Vec2} Vec2 */

/**
 * STUB — 이동 · 볼록 다각형 충돌 · nearby · 상호작용(§7.2b). 자리 진입은 돌려주기만 한다.
 * @param {SimCtx} ctx @param {InputFrame} input @returns {{enterSpotId: string|null}}
 */
export function updateWalk(ctx, input) {
  void ctx; void input;
  return { enterSpotId: null };
}

/** STUB @param {Object} state @param {Object} stage @returns {InteractTarget|null} */
export function findNearby(state, stage) {
  void state; void stage;
  return null;
}

/**
 * 플레이어를 놓고 PLAYER_PLACED 를 낸다(보간 끊기 — prevPos 도 같은 점).
 * @param {SimCtx} ctx @param {Vec2} pos @param {number} yaw @param {number} pitch
 * @param {'spawn'|'spot'|'exitSpot'|'debug'} reason
 */
export function placePlayer(ctx, pos, yaw, pitch, reason) {
  const p = ctx.state.player;
  p.pos = { x: pos.x, z: pos.z };
  p.prevPos = { x: pos.x, z: pos.z };
  p.yaw = yaw;
  p.pitch = pitch;
  p.speed = 0;
  ctx.emit(EV.PLAYER_PLACED, { x: pos.x, z: pos.z, yaw, pitch, reason });
}

/** env(§3.4 EnvState) — view · audio 용 파생 값 @param {SimCtx} ctx */
export function updateEnv(ctx) {
  const s = ctx.state;
  const stage = ctx.stage || getStage(s.scene);
  const outdoor = stage.kind === 'outdoor';
  const w = WEATHER[s.weather.current] || WEATHER.clear;
  const env = s.env;
  env.waveAmp = outdoor ? stage.waves.amp * w.waveMul : 0;
  env.wavePeriod = stage.waves.period;
  env.headlamp = outdoor && !!(s.clock && s.clock.night);
  env.rain = outdoor ? w.rain : 0;
  env.ambience = stage.ambience;
}
