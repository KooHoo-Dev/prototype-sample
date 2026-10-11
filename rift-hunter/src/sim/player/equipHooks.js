// OWNER: P1 — 계약 §6.7 · §8.5 · §7.9
// 전설 효과 훅 12(LEGENDARIES 의 hook 이름). 패치형 9 는 동작의 params 로만 닿는다(skillParams 가 행의 patch 를 합친다 — 여기는 표시 항목뿐) ·
// 사건형 3 은 이 표의 함수가 그 사건에서 돈다: frozenShatter · killExplode(at 'kill' — onPlayerKill) · globeDouble(at 'globe' — globeMods).
// 활성 전설 = ctx.stats.hooks(computeStats 가 내구도 > 0 인 것만 넣는다 — 내구도 0 이면 꺼진다). 같은 전설 둘(반지 두 칸)은 한 번만 돈다.
// 훅이 만든 적중은 noProcs(처치 훅 · 적중 회복 · 분노가 돌지 않는다 — 재귀 없음). 훅 구현 파일이라 자기 효과 ID 를 안다(§0.5).

import { DT } from '../../core/constants.js';
import { circle } from '../../core/shapes.js';
import { LEGENDARIES_BY_ID } from '../../data/index.js';
import { spawnEffect } from '../effects.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').LegendaryDef} LegendaryDef */

const own = (obj, k) => obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, k);

/**
 * 처치 사건의 플레이어 소유 효과 — resolveDeaths(§5.1-7)는 updateEffects(6) 뒤라 판정은 다음 틱(delay 한 틱)
 * @param {SimCtx} ctx @param {string} kind @param {number} x @param {number} z @param {number} r @param {Object} spec
 */
function killEffect(ctx, kind, x, z, r, spec) {
  return spawnEffect(ctx, {
    kind, owner: 'player', srcId: -1, packId: -1, hostile: false, shape: circle(x, z, r), delay: DT, dur: 0, tick: 0, spec, tickSpec: null, from: null,
  });
}

/** 패치형 — 동작은 skillParams 가 합친 patch 로 바뀐다(이 항목은 표시 · 검사용) */
const patchHook = () => Object.freeze({ kind: 'patch' });

/**
 * 전설 훅 12 — {kind:'patch'} | {kind:'event', at:'kill', onKill(ctx, mon, lastHit, leg)} | {kind:'event', at:'globe', globe(ctx, leg) → {mul, radiusAdd}}
 */
export const EQUIP_HOOKS = {
  whirlwindVortex: patchHook(),   // 회오리 → 불타는 소용돌이(spin · vortex)
  leapQuake: patchHook(),         // 도약 착지 → 지진(leap · landQuake)
  chargeRefund: patchHook(),      // 돌진 적중당 분노 · 3마리 이상이면 남은 쿨 1초(dash · refund)
  warCryHeal: patchHook(),        // 전투 함성 회복(buff · castHeal)
  stompShockwave: patchHook(),    // 지면 강타 앞 충격파(cone · shockwave)
  fireballPierce: patchHook(),    // 화염구 관통(fireball · pierce)
  chainBounce: patchHook(),       // 연쇄 번개 튕김 +(chain · bouncesAdd)
  teleportNova: patchHook(),      // 순간이동 도착 서리 노바(blink · arrivalNova)
  meteorShower: patchHook(),      // 작은 메테오(meteor · shower)

  /** 서리 반지 — 빙결 중에 처치하면 그 자리에서 얼음 폭발(냉기 · coef · noProcs) */
  frozenShatter: Object.freeze({
    kind: 'event', at: 'kill',
    /** @param {SimCtx} ctx @param {MonsterState} mon @param {any} lastHit @param {LegendaryDef} leg */
    onKill(ctx, mon, lastHit, leg) {
      if (!lastHit || !lastHit.frozen) return;
      const prm = leg.params ?? {};
      killEffect(ctx, 'iceBurst', mon.pos.x, mon.pos.z, prm.r, {
        skillId: leg.hook, coef: prm.coef, type: 'cold', tags: ['aoe'], actionId: ctx.nextId(), srcX: mon.pos.x, srcZ: mon.pos.z, noProcs: true,
      });
    },
  }),

  /** 피의 서약 — 처치 시 chance 로 시체 폭발(그 대상 최대 생명 × pctOfMax · 물리 · flat · noProcs) */
  killExplode: Object.freeze({
    kind: 'event', at: 'kill',
    /** @param {SimCtx} ctx @param {MonsterState} mon @param {any} lastHit @param {LegendaryDef} leg */
    onKill(ctx, mon, lastHit, leg) {
      const prm = leg.params ?? {};
      if (!ctx.rng.combat.chance(prm.chance ?? 0)) return;
      killEffect(ctx, 'corpseBlast', mon.pos.x, mon.pos.z, prm.r, {
        skillId: leg.hook, coef: 0, flat: (mon.hpMax ?? 0) * (prm.pctOfMax ?? 0), type: 'phys', tags: ['aoe'], actionId: ctx.nextId(),
        srcX: mon.pos.x, srcZ: mon.pos.z, noProcs: true,
      });
    },
  }),

  /** 생명의 띠 — 체력 구슬 회복 × mul · 줍기 반경 + radiusAdd */
  globeDouble: Object.freeze({
    kind: 'event', at: 'globe',
    /** @param {SimCtx} ctx @param {LegendaryDef} leg */
    globe(ctx, leg) {
      const prm = leg.params ?? {};
      return { mul: typeof prm.mul === 'number' ? prm.mul : 1, radiusAdd: typeof prm.radiusAdd === 'number' ? prm.radiusAdd : 0 };
    },
  }),
};

/** 활성 전설 중 그 사건(at)의 행 — 같은 ID 는 한 번 @param {SimCtx} ctx @param {'kill'|'globe'} at @returns {LegendaryDef[]} */
function activeAt(ctx, at) {
  const hooks = ctx?.stats?.hooks;
  if (!Array.isArray(hooks) || !hooks.length) return [];
  const out = [];
  for (const id of hooks) {
    if (!own(LEGENDARIES_BY_ID, id)) continue;
    const leg = LEGENDARIES_BY_ID[id];
    if (leg.at !== at || out.includes(leg)) continue;
    out.push(leg);
  }
  return out;
}

/**
 * ctx.hooks.onPlayerKill 구현 — 플레이어가 처치했고 lastHit.noProcs 가 아닐 때(P2 resolveDeaths) · 사건형 'kill' 전설을 돈다
 * @param {SimCtx} ctx @param {MonsterState} mon @param {Object} lastHit
 */
export function onPlayerKill(ctx, mon, lastHit) {
  if (!mon || (lastHit && /** @type {any} */ (lastHit).noProcs)) return;
  for (const leg of activeAt(ctx, 'kill')) {
    const h = own(EQUIP_HOOKS, leg.hook) ? /** @type {any} */ (EQUIP_HOOKS)[leg.hook] : null;
    if (h && typeof h.onKill === 'function') h.onKill(ctx, mon, lastHit, leg);
  }
}

/**
 * ctx.hooks.onGlobe 구현 → {mul, radiusAdd}(사건형 'globe' 전설 — 없으면 {mul:1, radiusAdd:0})
 * @param {SimCtx} ctx @returns {{mul:number, radiusAdd:number}}
 */
export function globeMods(ctx) {
  let mul = 1, radiusAdd = 0;
  for (const leg of activeAt(ctx, 'globe')) {
    const h = own(EQUIP_HOOKS, leg.hook) ? /** @type {any} */ (EQUIP_HOOKS)[leg.hook] : null;
    if (!h || typeof h.globe !== 'function') continue;
    const g = h.globe(ctx, leg);
    if (g.mul > mul) mul = g.mul;
    if (g.radiusAdd > radiusAdd) radiusAdd = g.radiusAdd;
  }
  return { mul, radiusAdd };
}
