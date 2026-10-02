// OWNER: P2 — 계약 §5.1 K · §7.8 「상호작용」
// GameSim만 import 하는 패키지 내부 파일.
import { EV } from '../../core/events.js';
import { COMBAT } from '../../data/combat.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').InputFrame} InputFrame */
/** @typedef {import('../../types.js').FacilityId} FacilityId */

/**
 * 마을 틱: nearFacility 갱신(플레이어가 시설 원 안이면 가장 가까운 것 · 바뀌면 NEAR_FACILITY_CHANGED),
 * input.interactPressed면 INTERACT. 연타로 패널이 겹쳐 열리지 않게 COMBAT.interactCooldown 동안은 다시 내지 않는다
 * (남은 시간은 ctx._interactCd — 표현용 알림의 간격일 뿐이라 상태에 넣지 않는다).
 * @param {SimCtx} ctx
 * @param {InputFrame} input
 * @param {number} dt
 */
export function updateTown(ctx, input, dt) {
  const state = ctx.state;
  const p = state.player.pos;
  const facilities = state.world.facilities;
  /** @type {FacilityId|null} */
  let near = null;
  let best = Infinity;
  for (let i = 0; i < facilities.length; i++) {
    const f = facilities[i];
    const d = Math.hypot(p.x - f.x, p.z - f.z);
    if (d <= f.r && d < best) {
      best = d;
      near = f.id;
    }
  }
  if (near !== state.nearFacility) {
    state.nearFacility = near;
    ctx.emit(EV.NEAR_FACILITY_CHANGED, { id: near });
  }

  const cd = ctx._interactCd > 0 ? ctx._interactCd - dt : 0;
  ctx._interactCd = cd > 0 ? cd : 0;
  if (input.interactPressed && near !== null && ctx._interactCd === 0) {
    ctx._interactCd = COMBAT.interactCooldown;
    ctx.emit(EV.INTERACT, { id: near });
  }
}
