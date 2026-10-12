// OWNER: P2 — 계약 §6.8 · §5.9 · §3.7(Effect)
// 예고 · 바닥 효과 · 위협 간격 규칙(H1~H5). 판정 주체는 효과 하나다 — 예고 = [start, hitAt) · 판정 = hitAt(spec) · 지속 = [hitAt, end)(tickSpec ?? spec).
// spec null 은 판정 없는 표시 전용(돌진 선 · 역병의 예고 부분) · 첫 지속 판정 = hitAt + tickT(웅덩이가 놓이는 틱에 바로 맞지 않는다).
// 끝난 것 · 취소된 것(end ≤ tick 이고 resolved 이거나 end ≤ hitAt)은 건드리지 않는다 — 판정 전에 취소된 예고가 같은 틱에 맞히지 않는다.

import { TICK_HZ } from '../core/constants.js';
import { EV } from '../core/events.js';
import { overlaps } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { COMBAT, HAZARD } from '../data/combat.js';
import { hazardHitPlayer, playerHitShape } from './combat.js';
import { addEffect, getMonster } from './entities.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Effect} Effect */
/** @typedef {import('../types.js').Shape} Shape */

/**
 * 효과 하나 → Effect · EFFECT_SPAWN. 시각(틱): start = 지금 · hitAt = start + ticks(delay) · end = hitAt + max(1, ticks(dur))(dur 0 이면 판정 한 틱 뒤 끝) ·
 * tickT = ticks(tick) · nextTickAt = tickT > 0 ? hitAt + tickT : -1(첫 지속 판정 = hitAt + tickT)
 * spec.shake(선택 · 0..1)가 있으면 hitAt 판정에 SHAKE 를 낸다.
 * @param {SimCtx} ctx
 * @param {{kind:string, owner:'player'|'mon'|'env', srcId:number, packId?:number, hostile:boolean, shape:Shape, delay:number,
 *   dur?:number, tick?:number, spec:Object|null, tickSpec?:Object|null, from?:import('../types.js').Vec2|null, cancelOnSrcDeath?:boolean}} def
 *   delay · dur · tick 은 초
 * @returns {Effect}
 */
export function spawnEffect(ctx, def) {
  const now = ctx.state.tick;
  const delay = Number.isFinite(def.delay) && def.delay > 0 ? def.delay : 0;
  const dur = Number.isFinite(def.dur) && def.dur > 0 ? def.dur : 0;
  const tickT = ticks(Number.isFinite(def.tick) ? def.tick : 0);
  const hitAt = now + ticks(delay);
  /** @type {Effect} */
  const e = {
    id: ctx.nextId(),
    kind: def.kind,
    owner: def.owner,
    srcId: def.srcId,
    packId: def.packId ?? -1,
    cancelOnSrcDeath: !!def.cancelOnSrcDeath,
    hostile: !!def.hostile,
    shape: { ...def.shape },
    start: now,
    hitAt,
    end: hitAt + Math.max(1, ticks(dur)),
    tickT,
    nextTickAt: tickT > 0 ? hitAt + tickT : -1,
    resolved: false,
    spec: def.spec ?? null,
    tickSpec: def.tickSpec ?? null,
    from: def.from ? { x: def.from.x, z: def.from.z } : null,
  };
  addEffect(ctx, e);
  ctx.emit(EV.EFFECT_SPAWN, { id: e.id, kind: e.kind, hostile: e.hostile, shape: { ...e.shape }, sec: delay, dur });
  return e;
}

/** 끝났거나 취소됐다(다시 판정하지 않는다) @param {Effect} e @param {number} tick */
function finished(e, tick) {
  return e.end <= tick && (e.resolved || e.end <= e.hitAt);
}

/**
 * 진행 중인 적대 예고 — start ≤ tick ≤ hitAt 이고 아직 판정 전 · 취소 안 됨. hitAt 틱을 넣는 까닭: 몬스터 단계(§5.1-5)가 효과 판정(6)보다 먼저라
 * 이번 틱에 판정될(감옥이 묶을) 예고가 아직 resolved 가 아니다 — 그 틱에 시작하는 표식이 속박과 겹치지 않게.
 * @param {Effect} e @param {number} tick
 */
function telegraphing(e, tick) {
  return e.hostile && !e.resolved && e.start <= tick && tick <= e.hitAt && !finished(e, tick);
}

/**
 * 판정 한 번 — 적대: 플레이어 몸이 모양과 겹치면 hazardHitPlayer / 비적대: playerHitShape(지속 틱은 틱마다 새 actionId · tickHit)
 * @param {SimCtx} ctx @param {Effect} e @param {Object} spec @param {boolean} isTick @returns {{hitPlayer:boolean, targets:number}}
 */
function judge(ctx, e, spec, isTick) {
  if (e.hostile) {
    const p = ctx.state.player;
    if (p.dead || !overlaps(e.shape, p.pos.x, p.pos.z, p.r)) return { hitPlayer: false, targets: 0 };
    const res = hazardHitPlayer(ctx, /** @type {any} */ (spec));
    return { hitPlayer: !res.ignored, targets: 0 };
  }
  const s = isTick ? { ...spec, actionId: ctx.nextId(), tickHit: true } : spec;
  const hits = playerHitShape(ctx, e.shape, /** @type {any} */ (s));
  return { hitPlayer: false, targets: hits.length };
}

/**
 * 한 틱 — cancelOnSrcDeath 검사(§5.16-6: 출처가 dead · 없음이면 판정 전에 end = tick — hitAt 틱에 생명 ≤ 0 이 된 출처는 판정한다) →
 * hitAt 에 spec 판정(null 이면 없음) · EFFECT_HIT(spec · tickSpec 중 하나라도 있으면) → 지속 틱(hitAt + tickT 부터 tickT 마다 · tickSpec ?? spec).
 * 배열에서는 removeMarked 가 뺀다.
 * @param {SimCtx} ctx
 */
export function updateEffects(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  const effects = rift.effects;
  for (let i = 0, n = effects.length; i < n; i++) {
    const e = effects[i];
    if (finished(e, tick)) continue;
    if (e.cancelOnSrcDeath && e.owner === 'mon') {
      const src = getMonster(ctx, e.srcId);
      if (!src || src.dead || src.gone) {
        e.end = tick;
        e.resolved = true;
        continue;
      }
    }
    if (!e.resolved && tick >= e.hitAt) {
      e.resolved = true;
      let r = null;
      if (e.spec) r = judge(ctx, e, e.spec, false);
      if (e.spec || e.tickSpec) {
        ctx.emit(EV.EFFECT_HIT, { id: e.id, kind: e.kind, hostile: e.hostile, shape: e.shape, hitPlayer: r ? r.hitPlayer : false, targets: r ? r.targets : 0 });
      }
      const amp = e.spec ? /** @type {any} */ (e.spec).shake : 0;
      if (amp > 0) ctx.emit(EV.SHAKE, { amp: Math.min(1, amp), sec: COMBAT.shakeSec });
    }
    if (e.tickT > 0 && e.nextTickAt >= 0 && tick >= e.nextTickAt && tick < e.end) {
      e.nextTickAt += e.tickT;
      const spec = e.tickSpec ?? e.spec;
      if (spec) judge(ctx, e, spec, true);
    }
  }
}

/** 몸에 원(nearR)을 둔 플레이어와 겹치는가 — shape 가 있으면 overlaps, 없으면 (x, z) 점 거리 @param {Shape|null} shape */
function nearPlayer(px, pz, x, z, shape, r) {
  if (shape) return overlaps(shape, px, pz, r);
  const dx = x - px, dz = z - pz;
  return dx * dx + dz * dz <= r * r;
}

/**
 * §5.9 위협 간격 — 새 적대 바닥 위협을 지금 시작해도 되는가. (x, z) = 위협의 목표점(플레이어 자리 · 몸 중심 · 선의 시작) · opts.shape(선택)이면 그 모양으로 본다.
 *   srcId 몬스터가 기절 · 빙결 중 → false(§5.17-2)
 *   H1 팩 간격: tick < pack.nextHazardAt → false
 *   H2 속박 잠금: 플레이어 발밑(nearR)인 위협은 tick < rift.rootLockUntil 이면 false — (P2 W1 확정) 묶는 예고(spec.onHit.rootSec)가 플레이어 발밑에서
 *      진행 중일 때도 false(다른 팩의 표식이 감옥 예고 위에 겹쳐 「묶인 채 맞는」 경우를 막는다)
 *   H3 감옥(jail): 플레이어 발밑(nearR)인 적대 예고가 진행 중이면 false
 *   H4 겹침 상한: 플레이어(countR)와 겹치는 진행 중 적대 예고 수 + count > HAZARD.maxNear 면 false(새 위협이 플레이어 근처일 때)
 * @param {SimCtx} ctx @param {number} packId @param {number} x @param {number} z
 * @param {{jail?:boolean, count?:number, srcId?:number, shape?:Shape|null}} [opts]
 * @returns {boolean}
 */
export function canStartHazard(ctx, packId, x, z, { jail = false, count = 1, srcId = -1, shape = null } = {}) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return false;
  const tick = st.tick;
  if (srcId >= 0) {
    const m = getMonster(ctx, srcId);
    if (m && (m.st.stunUntil > tick || m.st.freezeUntil > tick || m.act === 'stunned' || m.act === 'frozen')) return false;
  }
  if (packId >= 0) {
    const pk = findPack(rift, packId);
    if (pk && tick < pk.nextHazardAt) return false;
  }
  const p = st.player;
  const px = p.pos.x, pz = p.pos.z;
  const near = nearPlayer(px, pz, x, z, shape, HAZARD.nearR);
  if (near && tick < rift.rootLockUntil) return false;
  const nearCount = nearPlayer(px, pz, x, z, shape, HAZARD.countR);
  let inProgress = 0;
  const effects = rift.effects;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    if (!telegraphing(e, tick)) continue;
    const underFoot = overlaps(e.shape, px, pz, HAZARD.nearR);
    if (underFoot && (jail || (near && isRooting(e)))) return false;
    if (overlaps(e.shape, px, pz, HAZARD.countR)) inProgress += 1;
  }
  const c = Number.isFinite(count) && count > 0 ? count : 1;
  if (nearCount && inProgress + c > HAZARD.maxNear) return false;
  return true;
}

/**
 * 리뷰 수정 — 위협 간격(H1~H4)의 예외인 사망 위협(화염 강화 폭발 · 역병 덩어리 웅덩이)도 「묶인 채 맞는」 일이 없게 예고를 늘린다.
 * 플레이어가 묶여 있고(tick < player.st.rootUntil) 그 원이 플레이어 몸과 겹치면 →
 *   max(delay, 남은 속박(초) + HAZARD.react + (원 r + 몸 r − 중심 거리) / HAZARD.slowSpeed) — 풀린 뒤에도 H5 처럼 걸어 나갈 시간이 있다.
 * 그 밖에는 delay 그대로(원이 아닌 모양도 그대로).
 * @param {SimCtx} ctx @param {Shape} shape @param {number} delay 초 @returns {number} 초
 */
export function rootSafeDelay(ctx, shape, delay) {
  const st = ctx.state;
  const p = st.player;
  const d0 = Number.isFinite(delay) && delay > 0 ? delay : 0;
  if (!p || p.dead || !st.rift || !shape || shape.type !== 'circle') return d0;
  const tick = st.tick;
  const rootUntil = p.st?.rootUntil ?? -1;
  if (!(rootUntil > tick) || !overlaps(shape, p.pos.x, p.pos.z, p.r)) return d0;
  const out = Math.max(0, shape.r + p.r - Math.hypot(p.pos.x - shape.x, p.pos.z - shape.z));
  const need = (rootUntil - tick) / TICK_HZ + HAZARD.react + out / HAZARD.slowSpeed;
  return Math.max(d0, need);
}

/** 플레이어를 묶는 예고인가(판정 spec 의 onHit.rootSec) @param {Effect} e */
function isRooting(e) {
  const oh = /** @type {any} */ (e.spec)?.onHit;
  return !!oh && oh.rootSec > 0;
}

/** @param {import('../types.js').RiftState} rift @param {number} packId */
function findPack(rift, packId) {
  const packs = rift.packs;
  for (let i = 0; i < packs.length; i++) if (packs[i].id === packId) return packs[i];
  return null;
}

/** H1 기록 — 그 팩의 다음 위협은 HAZARD.packGap 뒤 @param {SimCtx} ctx @param {number} packId */
export function noteHazard(ctx, packId) {
  const rift = ctx.state.rift;
  if (!rift || !(packId >= 0)) return;
  const pk = findPack(rift, packId);
  if (pk) pk.nextHazardAt = ctx.state.tick + ticks(HAZARD.packGap);
}
