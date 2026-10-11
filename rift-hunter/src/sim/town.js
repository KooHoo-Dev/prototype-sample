// OWNER: P2 — 계약 §6.8 · §5.1-2 · §4.2(HINT)
// 마을 장면 — 포털 상태 · 복귀 안내 · 마을에서도 흐르는 플레이어 상태(버프 만료 · 재생 · 저생명) · 안내 카드 발행(emitHint).
// 상호작용(INTERACT · 마을 포털 도착)은 P1 controller 가 한다.

import { EV } from '../core/events.js';
import { updatePlayerStatus } from './status.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').GameState} GameState */

/** 한 세션 안에 이미 낸 안내(캐릭터 객체마다 — 상태가 아니다 · markHint 전에 같은 안내를 되풀이하지 않게) */
const SENT = new WeakMap();

/**
 * 안내 카드 — char.hints[id] 가 없고 이 세션에 아직 내지 않았으면 HINT{id}(본 뒤 ui 가 sim.markHint(id))
 * @param {SimCtx} ctx @param {import('../types.js').HintId} id @returns {boolean} 냈다
 */
export function emitHint(ctx, id) {
  const ch = ctx.state.char;
  if (!ch || ch.hints?.[id]) return false;
  let sent = SENT.get(ch);
  if (!sent) {
    sent = new Set();
    SENT.set(ch, sent);
  }
  if (sent.has(id)) return false;
  sent.add(id);
  ctx.emit(EV.HINT, { id });
  return true;
}

/** 포털 상태 — portalOpen = 열린 균열이 있고 붕괴하지 않았다 · 포털이 꺼지면 복귀 안내도 내린다 @param {GameState} state */
export function syncTown(state) {
  const town = state.town;
  town.portalOpen = !!state.rift && state.rift.phase !== 'collapsed';
  if (!town.portalOpen) town.returnPrompt = false;
}

/**
 * §5.1-2 마을 한 틱(updatePlayer 뒤) — 포털 상태 · 복귀 안내 · 플레이어 상태(버프 · 감속 · 속박 만료 · 생명 재생 · 저생명)
 * @param {SimCtx} ctx
 */
export function updateTown(ctx) {
  syncTown(ctx.state);
  updatePlayerStatus(ctx);
}
