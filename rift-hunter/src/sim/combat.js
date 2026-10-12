// OWNER: P2 — 계약 §6.8 · §5.6 · §5.8
// 피해 식 · 적중 적용(양방향) · 회복 · 화상 틱.
// combat.js 는 player/* · monsters/* · rift.js · drops.js 를 import 하지 않는다 — 피격 · 사망 뒤의 훅은 ctx.hooks 로 부른다(§2.2).
// NaN 방어: 입력(spec · 시트)에서 유한수가 아닌 값은 0 으로 읽고, 결과 피해가 유한한 양수가 아니면 0 이다 — 생명 · 계측 · 경험치로 번지지 않는다.

import { DMG_TYPES, DT } from '../core/constants.js';
import { EV } from '../core/events.js';
import { angleDiff, deg2rad, yawOf } from '../core/math.js';
import { ticks } from '../core/time.js';
import { PLAYER } from '../data/classes.js';
import { COMBAT, STATUS } from '../data/combat.js';
import { CLASSES_BY_ID, getMonDef, getRank } from '../data/index.js';
import { MON } from '../data/monsters.js';
import { condStatsFor } from './conds.js';
import { getMonster, monstersIn } from './entities.js';
import { DRa, DRr } from './loot/stats.js';
import { applyBurn, applyChill, applyFlinch, applyKnock, applyShock, applySlow, applyStun, removeBuff, rootPlayer, slowPlayer } from './status.js';

export { DRa, DRr } from './loot/stats.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').HitResult} HitResult */
/** @typedef {import('../types.js').PlayerHitResult} PlayerHitResult */
/** @typedef {import('../types.js').PlayerHitSpec} PlayerHitSpec */
/** @typedef {import('../types.js').MonAttackSpec} MonAttackSpec */
/** @typedef {import('../types.js').DmgType} DmgType */

/** 퍼센트 숫자 → 비율(주 능력치 · 시트의 main/100) */
const PCT = 100;
/** 버프 ID(§3.7 Buff) */
const WAR_CRY = 'warCry';
const SHIELD_BUFF = 'energyShield';
/** 막기가 되는 피해 경로(§5.6) */
const BLOCKABLE = new Set(['melee', 'projectile', 'charge']);
/** 정면 방패가 올라가 있는 행동(§5.6 — strike · recover · 기절 · 빙결 · 경직 중에는 내려가 있다) */
const SHIELD_UP_ACTS = new Set(['idle', 'move', 'windup']);
/** 챔피언 이상(정예 추가 피해 · 히트스톱 · big 처치) */
const ELITE_RANKS = new Set(['champion', 'elite', 'guardian']);
const NO_TAGS = Object.freeze([]);
const DOT_TAGS = Object.freeze(['dot']);

/** 유한수가 아니면 0 @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** DmgType 이 아니면 fallback @param {any} t @param {DmgType} fallback @returns {DmgType} */
const dmgType = (t, fallback) => (DMG_TYPES.includes(t) ? t : fallback);
/** 살아 있는(표시 · 사망 처리 전 생명 ≤ 0 이 아닌) 몬스터 @param {MonsterState|null|undefined} m */
const aliveMon = (m) => !!m && !m.gone && !m.dead && m.hp > 0;

/** @returns {HitResult} */
function hitResult(monId, dmg, crit, killed, immune, blocked) {
  return { monId, dmg, crit, killed, immune, blocked };
}
/** @returns {PlayerHitResult} */
function ignoredPlayer() {
  return { dmg: 0, absorbed: 0, blocked: false, killed: false, ignored: true };
}

/** 몬스터 저항(0 .. MON.resCap) @param {MonsterState} mon @param {DmgType} type */
function monRes(mon, type) {
  const r = num(mon.res?.[type]);
  return r < 0 ? 0 : r > MON.resCap ? MON.resCap : r;
}

/** 계측 · 판 집계에 준 피해 더하기 @param {SimCtx} ctx @param {number} amount */
function noteDealt(ctx, amount) {
  if (!(amount > 0)) return;
  const st = ctx.state;
  const m = st.meter;
  if (m && m.dealt.length) m.dealt[m.idx % m.dealt.length] += amount;
  if (st.rift) st.rift.stats.dmgDealt += amount;
}

/** 분노 감소 시작 틱(전사만) @param {SimCtx} ctx */
function touchCombat(ctx) {
  const st = ctx.state;
  const rage = st.char ? CLASSES_BY_ID[st.char.cls]?.rage : null;
  if (rage) st.player.combatUntil = st.tick + ticks(rage.decayDelay);
}

/** 활성 버프(없으면 null) @param {import('../types.js').PlayerState} p @param {string} id @param {number} tick */
function activeBuff(p, id, tick) {
  for (let i = 0; i < p.buffs.length; i++) {
    const b = p.buffs[i];
    if (b.id === id && b.until > tick) return b;
  }
  return null;
}

/**
 * 정면 방패(§5.6): 종류 params.frontBlock · aoe 가 아님 · act ∈ {idle, move, windup} · 출처 방향이 facing ± MON.frontDeg 안
 * @param {MonsterState} mon @param {PlayerHitSpec} spec @param {readonly string[]} tags
 */
function frontBlocked(mon, spec, tags) {
  if (!getMonDef(mon.typeId).params?.frontBlock) return false;
  if (tags.includes('aoe') || !SHIELD_UP_ACTS.has(mon.act)) return false;
  const sx = spec.srcX, sz = spec.srcZ;
  if (typeof sx !== 'number' || typeof sz !== 'number') return false;
  const dx = sx - mon.pos.x, dz = sz - mon.pos.z;
  if (dx === 0 && dz === 0) return true;
  return Math.abs(angleDiff(mon.facing, yawOf(dx, dz))) <= deg2rad(MON.frontDeg);
}

// ───────────────────────── 플레이어 → 몬스터 ─────────────────────────

/**
 * 플레이어 → 몬스터 적중 하나(§5.6). 무적이면 피해 0 · immune · 상태 이상 없음. 이미 생명 ≤ 0 · dead · gone 이면 아무 일도 없다(0 · 이벤트 없음).
 * 순서: 피해 → 생명 → 상태 이상(§5.8) → 경직 → 적중 회복(actionId 마다 lohTargets · 채널/지속 틱은 lohTargetsTick) → onMonDamaged → HIT → (히트스톱)
 * spec.tickHit(P2 W1 — 선택)이면 채널/지속 틱으로 친다(태그 channel 도 같다).
 * @param {SimCtx} ctx @param {MonsterState} mon @param {PlayerHitSpec} spec @returns {HitResult}
 */
export function playerHit(ctx, mon, spec) {
  if (!aliveMon(mon) || !spec) return hitResult(mon?.id ?? -1, 0, false, false, false, false);
  const st = ctx.state;
  const tick = st.tick;
  const stats = ctx.stats;
  const p = st.player;
  const type = dmgType(spec.type, stats.weapon.type);
  const tags = Array.isArray(spec.tags) ? spec.tags : NO_TAGS;
  const skillId = spec.skillId ?? null;

  if (mon.st.invulnUntil > tick) {
    ctx.emit(EV.HIT, { targetId: mon.id, x: mon.pos.x, z: mon.pos.z, amount: 0, type, crit: false, killed: false, immune: true, blocked: false, dot: false, skillId, big: false });
    return hitResult(mon.id, 0, false, false, true, false);
  }

  const flat = typeof spec.flat === 'number' && Number.isFinite(spec.flat) ? spec.flat : null;
  const cond = condStatsFor(ctx, mon, 'offense');
  const isElite = ELITE_RANKS.has(mon.rank);
  const base = flat !== null ? flat : ctx.rng.combat.range(stats.weapon.min, stats.weapon.max) * num(spec.coef);
  const add = num(stats.dmgPct[type]) + num(stats.skillPct[skillId]) + (tags.includes('aoe') ? num(stats.aoePct) : 0)
    + (isElite ? num(stats.elitePct) : 0) + num(cond.dmgPct);
  const cc = Math.min(COMBAT.critCap, num(stats.critChance) + num(cond.critChance));
  const cd = num(stats.critDamage) + num(cond.critDamage);
  const crit = flat === null && ctx.rng.combat.chance(cc);
  const blocked = frontBlocked(mon, spec, tags);
  // 저항 전 피해(화상의 총량 기준) → 저항
  let pre = base * (flat === null ? 1 + num(stats.main) / PCT : 1) * (1 + add) * (crit ? 1 + cd : 1)
    * (mon.st.shockUntil > tick ? 1 + STATUS.shockTaken : 1) * (blocked ? 1 - MON.shieldFront : 1);
  if (!(pre > 0) || !Number.isFinite(pre)) pre = 0;
  const dmg = pre * (1 - monRes(mon, type));

  const frozenBefore = mon.st.freezeUntil > tick;
  const actual = Math.min(dmg, mon.hp);
  mon.hp -= actual;
  const killed = mon.hp <= 0;
  const noProcs = !!spec.noProcs;
  if (mon.lastHit) {
    mon.lastHit.by = 'player';
    mon.lastHit.skillId = skillId;
    mon.lastHit.noProcs = noProcs;
    mon.lastHit.frozen = frozenBefore;
  } else {
    mon.lastHit = { by: 'player', skillId, noProcs, frozen: frozenBefore };
  }

  const rk = getRank(mon.rank);
  if (!killed) {
    if (spec.stun > 0) applyStun(ctx, mon, spec.stun);
    if (spec.chill > 0) applyChill(ctx, mon, spec.chill);
    const bf = num(spec.burnFrac) + (type === 'fire' ? num(stats.burnFrac) : 0);
    if (bf > 0 && pre > 0) applyBurn(ctx, mon, (pre * bf) / STATUS.burnSec);
    if (spec.shockChance > 0 && ctx.rng.combat.chance(spec.shockChance)) applyShock(ctx, mon);
    if (spec.slow && spec.slow.pct > 0) applySlow(ctx, mon, spec.slow.pct, num(spec.slow.sec));
    if (spec.knock > 0) applyKnock(ctx, mon, typeof spec.srcX === 'number' ? spec.srcX : p.pos.x, typeof spec.srcZ === 'number' ? spec.srcZ : p.pos.z, spec.knock);
    if (rk.flinchFrac !== null && dmg > 0 && dmg >= mon.hpMax * rk.flinchFrac) applyFlinch(ctx, mon);
  }

  if (actual > 0) {
    touchCombat(ctx);
    noteDealt(ctx, actual);
    if (!noProcs && !p.dead) {
      const loh = num(stats.lifeOnHit) + num(stats.lifePctOnHit) * p.lifeMax;
      if (loh > 0) {
        if (p.loh.actionId !== spec.actionId) {
          p.loh.actionId = spec.actionId;
          p.loh.n = 0;
        }
        const cap = spec.tickHit || tags.includes('channel') ? COMBAT.lohTargetsTick : COMBAT.lohTargets;
        if (p.loh.n < cap) {
          p.loh.n += 1;
          healPlayer(ctx, loh, 'hit');
        }
      }
    }
  }

  const big = dmg >= mon.hpMax * COMBAT.bigHitFrac || (killed && isElite);
  if (killed && big && rk.knockMul > 0) {
    const sx = typeof spec.srcX === 'number' ? spec.srcX : p.pos.x, sz = typeof spec.srcZ === 'number' ? spec.srcZ : p.pos.z;
    const dx = mon.pos.x - sx, dz = mon.pos.z - sz;
    const len = Math.hypot(dx, dz);
    if (len > 0) mon.launch = { x: (dx / len) * COMBAT.launchSpeed, z: (dz / len) * COMBAT.launchSpeed };
  }

  const result = hitResult(mon.id, actual, crit, killed, false, blocked);
  ctx.hooks.onMonDamaged(ctx, mon, result, spec);
  ctx.emit(EV.HIT, { targetId: mon.id, x: mon.pos.x, z: mon.pos.z, amount: dmg, type, crit, killed, immune: false, blocked, dot: false, skillId, big });

  if ((crit && dmg >= mon.hpMax * COMBAT.bigHitFrac) || (killed && isElite)) {
    if (p.hitstopAt < 0 || tick - p.hitstopAt >= ticks(COMBAT.hitstop.gap)) {
      p.hitstopAt = tick;
      ctx.emit(EV.HITSTOP, { sec: COMBAT.hitstop.sec });
    }
  }
  return result;
}

/**
 * 모양 적중 — monstersIn(살아 있고 gone 아님) · 모양 기준점에서 가까운 순(같으면 목록 순) · spec.maxTargets 까지
 * @param {SimCtx} ctx @param {import('../types.js').Shape} shape @param {PlayerHitSpec} spec @returns {HitResult[]}
 */
export function playerHitShape(ctx, shape, spec) {
  const list = monstersIn(ctx, shape);
  if (list.length > 1) {
    const ox = shape.x, oz = shape.z;
    list.sort((a, b) => ((a.pos.x - ox) ** 2 + (a.pos.z - oz) ** 2) - ((b.pos.x - ox) ** 2 + (b.pos.z - oz) ** 2));
  }
  const n = spec && spec.maxTargets > 0 ? Math.min(list.length, spec.maxTargets) : list.length;
  /** @type {HitResult[]} */
  const out = [];
  for (let i = 0; i < n; i++) out.push(playerHit(ctx, list[i], spec));
  return out;
}

// ───────────────────────── 몬스터 · 바닥 → 플레이어 ─────────────────────────

/**
 * 몬스터 · 바닥 → 플레이어 공통(§5.6). mon 이 있으면 근접 가시 · 밀림 · 속성 onHitPlayer 가 돈다.
 * @param {SimCtx} ctx @param {MonsterState|null} mon @param {MonAttackSpec} spec @param {MonsterState|null} killer
 * @returns {PlayerHitResult}
 */
function hitPlayer(ctx, mon, spec, killer) {
  const st = ctx.state;
  const p = st.player;
  const tick = st.tick;
  if (!spec || !st.char || st.scene !== 'rift' || p.dead || st.pendingTravel || st.flags.invincible
    || tick < p.protectUntil || tick < p.invulnUntil) return ignoredPlayer();
  const stats = ctx.stats;
  const type = dmgType(spec.type, 'phys');
  const level = num(spec.level) >= 1 ? spec.level : (st.rift?.level ?? 1);
  const raw = Math.max(0, num(spec.raw));
  const wc = activeBuff(p, WAR_CRY, tick);
  const armor = num(stats.armor) * (wc ? 1 + num(wc.value) : 1);
  const cond = condStatsFor(ctx, null, 'defense');
  let dmg = raw * (1 - DRa(armor, level)) * (1 - DRr(num(stats.res[type]), level))
    * Math.max(COMBAT.minTaken, 1 - num(stats.dmgTakenReduce) - num(cond.dmgTakenReduce));
  let blocked = false;
  if (BLOCKABLE.has(spec.via) && stats.block > 0 && ctx.rng.combat.chance(stats.block)) {
    dmg *= 1 - COMBAT.blockReduce;
    blocked = true;
  }
  if (!(dmg > 0) || !Number.isFinite(dmg)) dmg = 0;

  let absorbed = 0;
  if (p.shield > 0 && dmg > 0) {
    absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
    const buff = activeBuff(p, SHIELD_BUFF, tick);
    const max = buff ? buff.value : absorbed;
    if (p.shield <= 0) {
      p.shield = 0;
      ctx.emit(EV.SHIELD, { amount: 0, max, broken: true });
      removeBuff(ctx, SHIELD_BUFF);
    } else {
      ctx.emit(EV.SHIELD, { amount: p.shield, max, broken: false });
    }
  }

  if (dmg > 0) {
    p.life = Math.max(0, p.life - dmg);
    touchCombat(ctx);
    if (st.rift) st.rift.stats.dmgTaken += dmg;
    const m = st.meter;
    if (m && m.taken.length) m.taken[m.idx % m.taken.length] += dmg;
    ctx.hooks.onPlayerDamaged(ctx, dmg);
  }

  // 가시(근접 · 살아 있는 출처)
  if (mon && spec.via === 'melee' && stats.thorns > 0 && aliveMon(mon)) {
    damageMonsterRaw(ctx, mon, stats.thorns * (1 + num(stats.main) / PCT), 'phys', 'player');
  }

  // 적중 효과(피해가 보호막에 다 막혀도 맞은 것이다)
  const oh = spec.onHit;
  if (oh && !p.dead) {
    if (oh.chillSec > 0) slowPlayer(ctx, oh.slowPct > 0 ? oh.slowPct : STATUS.playerChill, oh.chillSec);
    if (oh.rootSec > 0) rootPlayer(ctx, oh.rootSec);
  }
  if (mon && spec.push > 0 && !p.dead && p.act !== 'dash' && p.act !== 'leap' && p.act !== 'blink' && tick >= p.invulnUntil) {
    let dx = p.pos.x - mon.pos.x, dz = p.pos.z - mon.pos.z;
    let len = Math.hypot(dx, dz);
    if (!(len > 0)) {
      dx = Math.sin(mon.facing);
      dz = Math.cos(mon.facing);
      len = 1;
    }
    const t = Math.max(1, ticks(PLAYER.pushSec));
    const v = spec.push / (t * DT);
    p.knock = { vx: (dx / len) * v, vz: (dz / len) * v, until: tick + t };
  }

  /** @type {PlayerHitResult} */
  const res = { dmg, absorbed, blocked, killed: p.life <= 0, ignored: false };
  if (mon && dmg > 0 && !spec.noAffix) ctx.hooks.onMonHitPlayer(ctx, mon, res, spec);
  ctx.emit(EV.PLAYER_HIT, {
    amount: dmg, absorbed, blocked, type, via: spec.via, srcId: spec.srcId ?? -1, x: p.pos.x, z: p.pos.z, life: p.life, lifeMax: p.lifeMax,
  });
  if (p.life <= 0 && !p.dead) ctx.hooks.onPlayerKilled(ctx, killer);
  return res;
}

/**
 * 몬스터 → 플레이어(§5.6) · dmg > 0 이고 !spec.noAffix 면 ctx.hooks.onMonHitPlayer. 출처가 이미 죽었거나(dead · gone · 생명 ≤ 0) 없으면:
 * 근접 · 돌진은 무시(§5.16-1), 그 밖(투사체 · 폭발)은 hazardHitPlayer 와 같다(속성 훅 없음).
 * @param {SimCtx} ctx @param {MonsterState|null} mon @param {MonAttackSpec} spec @returns {PlayerHitResult}
 */
export function monsterHitPlayer(ctx, mon, spec) {
  if (!aliveMon(mon)) {
    if (!spec || spec.via === 'melee' || spec.via === 'charge') return ignoredPlayer();
    return hitPlayer(ctx, null, spec, mon ?? getMonster(ctx, spec.srcId));
  }
  return hitPlayer(ctx, /** @type {MonsterState} */ (mon), spec, /** @type {MonsterState} */ (mon));
}

/**
 * 바닥 효과 · 출처 없는 투사체 → 플레이어(속성 onHitPlayer 없음 · 밀림 없음). 처치자는 spec.srcId 의 몬스터(있으면 — 사망 패널)
 * @param {SimCtx} ctx @param {MonAttackSpec} spec @returns {PlayerHitResult}
 */
export function hazardHitPlayer(ctx, spec) {
  return hitPlayer(ctx, null, spec, spec ? getMonster(ctx, spec.srcId) : null);
}

// ───────────────────────── 고정 피해 · 화상 · 회복 ─────────────────────────

/**
 * 화상 · 가시 · 폭발 — 치명타 · 보너스 없음 · 저항만 · HIT{dot}. 무적이면 0(HIT immune). lastHit.by = by(player 면 처치 훅이 돈다)
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} amount @param {string} type @param {'player'|'env'|'mon'} [by]
 * @returns {HitResult}
 */
export function damageMonsterRaw(ctx, mon, amount, type, by = 'player') {
  if (!aliveMon(mon)) return hitResult(mon?.id ?? -1, 0, false, false, false, false);
  const st = ctx.state;
  const tick = st.tick;
  const t = dmgType(type, 'phys');
  if (mon.st.invulnUntil > tick) {
    ctx.emit(EV.HIT, { targetId: mon.id, x: mon.pos.x, z: mon.pos.z, amount: 0, type: t, crit: false, killed: false, immune: true, blocked: false, dot: true, skillId: null, big: false });
    return hitResult(mon.id, 0, false, false, true, false);
  }
  const dmg = Math.max(0, num(amount)) * (1 - monRes(mon, t));
  if (!(dmg > 0)) return hitResult(mon.id, 0, false, false, false, false);
  const frozen = mon.st.freezeUntil > tick;
  const actual = Math.min(dmg, mon.hp);
  mon.hp -= actual;
  const killed = mon.hp <= 0;
  if (mon.lastHit) {
    mon.lastHit.by = by;
    mon.lastHit.skillId = null;
    mon.lastHit.noProcs = by !== 'player';
    mon.lastHit.frozen = frozen;
  } else {
    mon.lastHit = { by, skillId: null, noProcs: by !== 'player', frozen };
  }
  if (by === 'player') {
    noteDealt(ctx, actual);
    touchCombat(ctx);
  }
  const result = hitResult(mon.id, actual, false, killed, false, false);
  ctx.hooks.onMonDamaged(ctx, mon, result, { skillId: null, coef: 0, type: t, tags: DOT_TAGS, actionId: -1, srcX: mon.pos.x, srcZ: mon.pos.z, noProcs: true, dot: true });
  ctx.emit(EV.HIT, { targetId: mon.id, x: mon.pos.x, z: mon.pos.z, amount: dmg, type: t, crit: false, killed, immune: false, blocked: false, dot: true, skillId: null, big: false });
  return result;
}

/**
 * §5.1-6 화상 틱 — burn.nextAt 마다(≤ until) damageMonsterRaw(dps × burnTick · 화염 · dot) · 끝나면 burn = null · MON_STATUS{burn, off}
 * @param {SimCtx} ctx
 */
export function tickBurns(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  const step = Math.max(1, ticks(STATUS.burnTick));
  const mons = rift.mons;
  for (let i = 0, n = mons.length; i < n; i++) {
    const m = mons[i];
    const b = m.st.burn;
    if (!b) continue;
    if (!aliveMon(m)) {
      if (m.dead || m.gone) m.st.burn = null;
      continue;
    }
    while (b.nextAt >= 0 && b.nextAt <= tick && b.nextAt <= b.until) {
      damageMonsterRaw(ctx, m, b.dps * STATUS.burnTick, 'fire', 'player');
      b.nextAt += step;
      if (m.hp <= 0) break;
    }
    if (tick >= b.until || m.hp <= 0) {
      m.st.burn = null;
      ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'burn', on: false });
    }
  }
}

/**
 * 플레이어 회복 — [0, lifeMax] · PLAYER_HEAL{amount, source}(source 'hit' 이면 이벤트 없음 · 실제로 오른 양이 0 이면 없음)
 * @param {SimCtx} ctx @param {number} amount @param {string} source @returns {number} 실제로 오른 생명
 */
export function healPlayer(ctx, amount, source) {
  const p = ctx.state.player;
  if (p.dead || !(amount > 0) || !Number.isFinite(amount)) return 0;
  const before = p.life;
  p.life = Math.min(p.lifeMax, p.life + amount);
  const healed = p.life - before;
  if (healed > 0 && source !== 'hit') ctx.emit(EV.PLAYER_HEAL, { amount: healed, source });
  return healed;
}

/** 몬스터 회복(살아 있을 때 · hpMax 까지) @param {SimCtx} ctx @param {MonsterState} mon @param {number} amount @returns {number} 오른 양 */
export function healMonster(ctx, mon, amount) {
  if (!aliveMon(mon) || !(amount > 0) || !Number.isFinite(amount)) return 0;
  const before = mon.hp;
  mon.hp = Math.min(mon.hpMax, mon.hp + amount);
  return mon.hp - before;
}
