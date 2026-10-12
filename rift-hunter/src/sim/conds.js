// OWNER: P2 — 계약 §6.8 · §5.7
// 조건부 패시브 판정. CONDS[id] = (ctx, mon|null) => boolean — 프레임워크는 ID 를 모른다(표만 돈다).
// 패시브 노드의 cond 가 참인 적중(방어 쪽이면 피격)에만 condStats 가 더해진다. ctx.stats.conds 의 값은 이미 PlayerStats 단위다(§3.8).

import { ticks } from '../core/time.js';
import { COND } from '../data/combat.js';
import { CLASSES_BY_ID } from '../data/index.js';
import { knockEndTick } from './status.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */

/**
 * 기절 · 빙결 · 냉기 · 감속 · 피드백 2 D10: 밀려나는 중이거나 넉백이 끝난 뒤 COND.knockSec(0.5초) 안(회전 베기 넉백으로 분쇄자가 켜진다)
 * @param {SimCtx} ctx @param {MonsterState|null} mon
 */
function targetDisabled(ctx, mon) {
  if (!mon) return false;
  const t = ctx.state.tick, s = mon.st;
  if (s.stunUntil > t || s.freezeUntil > t || s.chill > 0 || (s.slow !== null && s.slow.until > t) || mon.act === 'stunned' || mon.act === 'frozen') return true;
  if (mon.knock && t < mon.knock.until) return true;
  const end = knockEndTick(mon);
  return end >= 0 && t < end + ticks(COND.knockSec);
}

/** @param {SimCtx} ctx @param {MonsterState|null} mon */
function targetBurning(ctx, mon) {
  return !!mon && mon.st.burn !== null && mon.st.burn.until >= ctx.state.tick;
}

/** @param {SimCtx} ctx @param {MonsterState|null} mon */
function targetFrozen(ctx, mon) {
  return !!mon && mon.st.freezeUntil > ctx.state.tick;
}

/** 전사(분노 자원)이고 분노 ≥ COND.rageAt @param {SimCtx} ctx */
function rage50(ctx) {
  const ch = ctx.state.char;
  if (!ch) return false;
  return CLASSES_BY_ID[ch.cls]?.resource === 'rage' && ctx.state.player.resource >= COND.rageAt;
}

/** 생명 ≤ 최대 × COND.lifeFrac(살아 있을 때) @param {SimCtx} ctx */
function lifeBelow35(ctx) {
  const p = ctx.state.player;
  return !p.dead && p.life <= p.lifeMax * COND.lifeFrac;
}

export const CONDS = { targetDisabled, targetBurning, targetFrozen, rage50, lifeBelow35 };

/** 방어 쪽(피격 때) 읽는 키 — 나머지는 공격 쪽(적중 때) */
const DEFENSE_KEYS = new Set(['dmgTakenReduce']);
const EMPTY = Object.freeze({});

/**
 * 참인 조건의 합(PlayerStats 단위 — 키: dmgPct(모든 종류) · critChance · critDamage · attackSpeedPct · dmgTakenReduce …).
 * side 'offense' 는 방어 키를 뺀 것, 'defense' 는 방어 키만. 참인 조건이 없으면 동결된 빈 객체(읽기만 한다).
 * @param {SimCtx} ctx @param {MonsterState|null} mon @param {'offense'|'defense'} side
 * @returns {Readonly<Record<string, number>>}
 */
export function condStatsFor(ctx, mon, side) {
  const list = ctx.stats?.conds;
  if (!list || !list.length) return EMPTY;
  const wantDefense = side === 'defense';
  /** @type {Record<string, number>|null} */
  let out = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const f = CONDS[/** @type {keyof typeof CONDS} */ (c.cond)];
    if (!f || !f(ctx, mon)) continue;
    for (const k of Object.keys(c.stats)) {
      if (DEFENSE_KEYS.has(k) !== wantDefense) continue;
      const v = c.stats[k];
      if (!Number.isFinite(v)) continue;
      if (!out) out = {};
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out ?? EMPTY;
}
