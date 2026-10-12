// OWNER: P2 — 계약 §6.8 · §5.8
// 상태 이상(몬스터 · 플레이어)의 적용과 틱 · 버프 · 플레이어 감속 · 속박.
// status.js 는 combat.js 를 import 하지 않는다(화상 틱은 combat.js 의 tickBurns).
// 규약(P2 W1 확정): apply* 는 데이터 값(초 · m · 점)을 받고 등급 배율(stunMul · freezeMul · knockMul)과 면역은 이 파일이 적용한다 —
//   부르는 쪽이 등급 배율을 미리 곱하지 않는다. 기절 · 빙결 · 경직 · 넉백은 예비 중인 공격을 취소하고(쿨다운은 쓴 채),
//   그 몬스터 몸에 붙은 예고(cancelOnSrcDeath · 아직 hitAt 전)도 지운다 — 판정 주체가 몸과 따로 남지 않게.

import { DT } from '../core/constants.js';
import { EV } from '../core/events.js';
import { ticks } from '../core/time.js';
import { COMBAT, HAZARD, STATUS } from '../data/combat.js';
import { MON_AFFIXES_BY_ID, getMonDef, getRank } from '../data/index.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').Buff} Buff */

/** 버프 ID(§3.7 Buff) — 마력 보호막이 끝나면 player.shield 를 비운다 */
const SHIELD_BUFF = 'energyShield';

/** 예비 · 시전 · 판정 · 후딜처럼 「공격 중」인 행동 — 기절 · 넉백 · 경직이 취소한다 */
const ATTACK_ACTS = new Set(['windup', 'cast', 'channel', 'charge', 'swell', 'strike', 'recover']);
/** 예고(바닥 표식)를 몸에 붙이고 있을 수 있는 행동 */
const TELEGRAPH_ACTS = new Set(['windup', 'cast', 'channel', 'charge', 'swell']);

/** 살아 있고 상태 이상이 걸릴 수 있는가(사라짐 · 솟아오름 중에는 안 걸린다) @param {MonsterState|null|undefined} mon */
function canAffect(mon) {
  return !!mon && !mon.gone && !mon.dead && mon.hp > 0 && mon.act !== 'vanish' && mon.act !== 'spawning';
}

/** 속성 mods.immune 에 what 이 있는가 @param {MonsterState} mon @param {string} what */
function immuneTo(mon, what) {
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const imm = MON_AFFIXES_BY_ID[list[i]]?.mods?.immune;
    if (imm && imm.includes(what)) return true;
  }
  return false;
}

/**
 * 공격 중이면 그 공격을 취소한다 — 몸에 붙은 예고(cancelOnSrcDeath · 아직 hitAt 전)도 지운다(end = tick · 표시만).
 * act 는 부르는 쪽이 바꾼다.
 * @param {SimCtx} ctx @param {MonsterState} mon
 */
function cancelAttack(ctx, mon) {
  if (!ATTACK_ACTS.has(mon.act)) return;
  const st = ctx.state;
  if (TELEGRAPH_ACTS.has(mon.act) && st.rift) {
    const tick = st.tick;
    const effects = st.rift.effects;
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (e.owner === 'mon' && e.srcId === mon.id && e.cancelOnSrcDeath && !e.resolved && e.hitAt > tick && e.end > tick) {
        e.end = tick;
        e.resolved = true;
      }
    }
  }
  mon.aimLocked = false;
}

/** 지금 상태에 맞는 「묶인」 행동(빙결 > 기절 > 경직) 또는 null @param {MonsterState} mon @param {number} tick */
function disabledAct(mon, tick) {
  const s = mon.st;
  if (s.freezeUntil > tick) return 'frozen';
  if (s.stunUntil > tick) return 'stunned';
  if (s.flinchUntil > tick) return 'flinch';
  return null;
}

// ───────────────────────── 몬스터 ─────────────────────────

/**
 * 기절 — sec × rank.stunMul · 면역 창(stunImmuneUntil) 안이면 안 걸림 · 기절 중의 새 기절은 끝 틱을 늘리지 않는다 ·
 * 면역 = 끝 + STATUS.stunImmune[rank] · 예비 공격 취소
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} sec @returns {boolean} 걸렸다
 */
export function applyStun(ctx, mon, sec) {
  if (!canAffect(mon) || !(sec > 0)) return false;
  const tick = ctx.state.tick;
  const s = mon.st;
  if (tick < s.stunImmuneUntil || s.stunUntil > tick) return false;
  const t = ticks(sec * getRank(mon.rank).stunMul);
  if (t <= 0) return false;
  s.stunUntil = tick + t;
  s.stunImmuneUntil = s.stunUntil + ticks(STATUS.stunImmune[mon.rank] ?? 0);
  cancelAttack(ctx, mon);
  if (mon.act !== 'frozen') mon.act = 'stunned';
  ctx.emit(EV.MON_STATUS, { id: mon.id, kind: 'stun', on: true });
  return true;
}

/**
 * 냉기 점수(0..STATUS.freezeAt) — chill > 0 이면 이동 · 새 공격 속도 × (1 − chillSlow) · 마지막 냉기 + chillDecayDelay 부터 감소.
 * chill ≥ freezeAt − stats.freezeAtReduce 이고 빙결 면역 밖이면 빙결: 길이 freezeSec × (1 + freezeDurPct) × rank.freezeMul · chill = 0 · 면역 = 끝 + freezeImmune
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} pts @returns {boolean} 빙결됐다
 */
export function applyChill(ctx, mon, pts) {
  if (!canAffect(mon) || !(pts > 0)) return false;
  const tick = ctx.state.tick;
  const s = mon.st;
  s.chill = Math.min(STATUS.freezeAt, s.chill + pts);
  s.chillDecayAt = tick + ticks(STATUS.chillDecayDelay);
  const stats = ctx.stats;
  const threshold = STATUS.freezeAt - (stats?.freezeAtReduce ?? 0);
  if (s.chill < threshold || tick < s.freezeImmuneUntil || s.freezeUntil > tick) return false;
  const t = ticks(STATUS.freezeSec * (1 + (stats?.freezeDurPct ?? 0)) * getRank(mon.rank).freezeMul);
  if (t <= 0) return false;
  s.freezeUntil = tick + t;
  s.freezeImmuneUntil = s.freezeUntil + ticks(STATUS.freezeImmune);
  s.chill = 0;
  cancelAttack(ctx, mon);
  mon.act = 'frozen';
  ctx.emit(EV.MON_STATUS, { id: mon.id, kind: 'freeze', on: true });
  return true;
}

/**
 * 화상 — 3초 동안 dps(0.5초마다 tickBurns 가 damageMonsterRaw). 이미 타는 중이면 dps 는 큰 쪽 · 길이 갱신(쌓이지 않는다)
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} dps 저항 전 초당 피해
 */
export function applyBurn(ctx, mon, dps) {
  if (!canAffect(mon) || !(dps > 0)) return;
  const tick = ctx.state.tick;
  const s = mon.st;
  const until = tick + ticks(STATUS.burnSec);
  if (s.burn && s.burn.until >= tick) {
    if (dps > s.burn.dps) s.burn.dps = dps;
    s.burn.until = until;
    return;
  }
  s.burn = { dps, until, nextAt: tick + Math.max(1, ticks(STATUS.burnTick)) };
  ctx.emit(EV.MON_STATUS, { id: mon.id, kind: 'burn', on: true });
}

/** 감전 — 받는 피해 + STATUS.shockTaken · shockSec(새로 걸면 길이 갱신) @param {SimCtx} ctx @param {MonsterState} mon */
export function applyShock(ctx, mon) {
  if (!canAffect(mon)) return;
  const tick = ctx.state.tick;
  const was = mon.st.shockUntil > tick;
  mon.st.shockUntil = tick + ticks(STATUS.shockSec);
  if (!was) ctx.emit(EV.MON_STATUS, { id: mon.id, kind: 'shock', on: true });
}

/** 감속 — 이동 × (1 − pct) · sec(이미 걸려 있으면 큰 pct · 긴 쪽) @param {SimCtx} ctx @param {MonsterState} mon @param {number} pct @param {number} sec */
export function applySlow(ctx, mon, pct, sec) {
  if (!canAffect(mon) || !(pct > 0) || !(sec > 0)) return;
  const tick = ctx.state.tick;
  const until = tick + ticks(sec);
  const p = Math.min(1, pct);
  const cur = mon.st.slow;
  if (cur && cur.until > tick) {
    if (p > cur.pct) cur.pct = p;
    if (until > cur.until) cur.until = until;
  } else {
    mon.st.slow = { pct: p, until };
  }
}

/**
 * 넉백 — dist × rank.knockMul 를 STATUS.knockSec 에 걸쳐(이동은 P3 가 knock 으로 · 벽 미끄러짐) · (fromX, fromZ) → 몬스터 방향.
 * 면역: 강인함(mods.immune 'knock') · 태그 structure · knockImmuneUntil 안 · 등급 배율 0. 걸리면 면역 = 끝 + knockImmune · 예비 공격 취소
 * @param {SimCtx} ctx @param {MonsterState} mon @param {number} fromX @param {number} fromZ @param {number} dist
 * @returns {boolean} 걸렸다
 */
export function applyKnock(ctx, mon, fromX, fromZ, dist) {
  if (!canAffect(mon) || !(dist > 0)) return false;
  const tick = ctx.state.tick;
  const s = mon.st;
  if (tick < s.knockImmuneUntil) return false;
  if (getMonDef(mon.typeId).tags.includes('structure') || immuneTo(mon, 'knock')) return false;
  const d = dist * getRank(mon.rank).knockMul;
  if (!(d > 0)) return false;
  let dx = mon.pos.x - fromX, dz = mon.pos.z - fromZ;
  let len = Math.hypot(dx, dz);
  if (!(len > 0)) {
    dx = -Math.sin(mon.facing);
    dz = -Math.cos(mon.facing);
    len = 1;
  }
  const t = Math.max(1, ticks(STATUS.knockSec));
  const v = d / (t * DT);
  mon.knock = { vx: (dx / len) * v, vz: (dz / len) * v, until: tick + t };
  s.knockImmuneUntil = mon.knock.until + ticks(STATUS.knockImmune);
  if (ATTACK_ACTS.has(mon.act)) {
    cancelAttack(ctx, mon);
    mon.act = 'idle';
  }
  return true;
}

/**
 * 피드백 2 D10 — 그 몬스터의 마지막 넉백이 끝난(끝날) 틱 · 넉백을 받은 적이 없으면 -1. applyKnock 이 knockImmuneUntil = 끝 + ticks(STATUS.knockImmune)로
 * 두므로 거기서 되돌린다(상태 필드를 더하지 않는다 — conds.targetDisabled 가 「넉백 직후 COND.knockSec」를 본다)
 * @param {MonsterState} mon @returns {number}
 */
export function knockEndTick(mon) {
  const u = mon?.st?.knockImmuneUntil;
  return Number.isFinite(u) && u >= 0 ? u - ticks(STATUS.knockImmune) : -1;
}

/**
 * 경직 — act flinch STATUS.flinchSec · 끝 + flinchImmune 면역 · 강인함(mods.immune 'flinch') · rank.flinchFrac null 면역 · 기절 · 빙결 중이면 안 걸림.
 * 「한 적중 ≥ hpMax × flinchFrac」 검사는 부르는 쪽(combat.playerHit)
 * @param {SimCtx} ctx @param {MonsterState} mon @returns {boolean} 걸렸다
 */
export function applyFlinch(ctx, mon) {
  if (!canAffect(mon)) return false;
  const tick = ctx.state.tick;
  const s = mon.st;
  if (getRank(mon.rank).flinchFrac === null || immuneTo(mon, 'flinch')) return false;
  if (tick < s.flinchImmuneUntil || s.stunUntil > tick || s.freezeUntil > tick) return false;
  s.flinchUntil = tick + Math.max(1, ticks(STATUS.flinchSec));
  s.flinchImmuneUntil = s.flinchUntil + ticks(STATUS.flinchImmune);
  cancelAttack(ctx, mon);
  mon.act = 'flinch';
  ctx.emit(EV.MON_STATUS, { id: mon.id, kind: 'flinch', on: true });
  return true;
}

/** 무적(보호막 속성 · 사라짐) — invulnUntil = max(지금 값, tick + sec) @param {SimCtx} ctx @param {MonsterState} mon @param {number} sec */
export function setInvuln(ctx, mon, sec) {
  if (!mon || !(sec > 0)) return;
  const until = ctx.state.tick + ticks(sec);
  if (until > mon.st.invulnUntil) mon.st.invulnUntil = until;
}

// ───────────────────────── 플레이어 ─────────────────────────

/** 플레이어 감속 — 이동 × (1 − pct) · sec(새로 걸리면 긴 쪽 · 큰 pct) · PLAYER_STATUS @param {SimCtx} ctx @param {number} pct @param {number} sec */
export function slowPlayer(ctx, pct, sec) {
  const st = ctx.state;
  const p = st.player;
  if (p.dead || !(pct > 0) || !(sec > 0)) return;
  const tick = st.tick;
  const until = tick + ticks(sec);
  const was = p.st.slowPct > 0 && p.st.slowUntil > tick;
  const k = Math.min(1, pct);
  if (was) {
    if (k > p.st.slowPct) p.st.slowPct = k;
    if (until > p.st.slowUntil) p.st.slowUntil = until;
  } else {
    p.st.slowPct = k;
    p.st.slowUntil = until;
    ctx.emit(EV.PLAYER_STATUS, { kind: 'slow', on: true, sec });
  }
}

/**
 * 플레이어 속박(감옥) — 이동 · 이동 스킬 불가 · sec · rift.rootLockUntil = 속박 끝 + HAZARD.afterRoot(§5.9 H2) · PLAYER_STATUS
 * @param {SimCtx} ctx @param {number} sec
 */
export function rootPlayer(ctx, sec) {
  const st = ctx.state;
  const p = st.player;
  if (p.dead || !(sec > 0)) return;
  const tick = st.tick;
  const was = p.st.rootUntil > tick;
  const until = tick + ticks(sec);
  if (until > p.st.rootUntil) p.st.rootUntil = until;
  if (st.rift) {
    const lock = p.st.rootUntil + ticks(HAZARD.afterRoot);
    if (lock > st.rift.rootLockUntil) st.rift.rootLockUntil = lock;
  }
  if (!was) ctx.emit(EV.PLAYER_STATUS, { kind: 'root', on: true, sec });
}

/**
 * 버프 하나(같은 ID 는 갈아 끼운다 — 합치지 않는다). BUFF{on:true} 는 시전한 쪽(P1)이 낸다 — 여기서는 끝날 때만 낸다(§4.2)
 * @param {SimCtx} ctx @param {string} id 'warCry' | 'energyShield' @param {number} sec @param {number} value
 * @returns {Buff}
 */
export function addBuff(ctx, id, sec, value) {
  const p = ctx.state.player;
  for (let i = p.buffs.length - 1; i >= 0; i--) if (p.buffs[i].id === id) p.buffs.splice(i, 1);
  /** @type {Buff} */
  const b = { id, until: ctx.state.tick + Math.max(1, ticks(sec)), value: Number.isFinite(value) ? value : 0 };
  p.buffs.push(b);
  return b;
}

/** 버프 끄기 — BUFF{on:false} · 마력 보호막이면 player.shield = 0 @param {SimCtx} ctx @param {string} id @returns {boolean} 있었다 */
export function removeBuff(ctx, id) {
  const p = ctx.state.player;
  let found = false;
  for (let i = p.buffs.length - 1; i >= 0; i--) {
    const b = p.buffs[i];
    if (b.id !== id) continue;
    p.buffs.splice(i, 1);
    found = true;
    ctx.emit(EV.BUFF, { id, on: false, sec: 0, value: b.value });
  }
  if (id === SHIELD_BUFF) p.shield = 0;
  return found;
}

/**
 * 플레이어 쪽 상태 틱 — 버프 만료(BUFF off · 보호막 비움) · 감속/속박/밀림 만료 · 생명 재생 · 저생명 플래그(LOW_LIFE).
 * 균열(updateStatus)과 마을(town.updateTown)에서 같이 돈다 — 플레이어 시각은 마을에서도 흐른다(§5.11)
 * @param {SimCtx} ctx
 */
export function updatePlayerStatus(ctx) {
  const st = ctx.state;
  const p = st.player;
  const tick = st.tick;
  for (let i = p.buffs.length - 1; i >= 0; i--) {
    const b = p.buffs[i];
    if (tick < b.until) continue;
    p.buffs.splice(i, 1);
    ctx.emit(EV.BUFF, { id: b.id, on: false, sec: 0, value: b.value });
    if (b.id === SHIELD_BUFF && p.shield > 0) {
      p.shield = 0;
      ctx.emit(EV.SHIELD, { amount: 0, max: b.value, broken: false });
    }
  }
  if (p.st.slowPct > 0 && tick >= p.st.slowUntil) {
    p.st.slowPct = 0;
    ctx.emit(EV.PLAYER_STATUS, { kind: 'slow', on: false, sec: 0 });
  }
  if (p.st.rootUntil > 0 && tick >= p.st.rootUntil) {
    p.st.rootUntil = 0;
    ctx.emit(EV.PLAYER_STATUS, { kind: 'root', on: false, sec: 0 });
  }
  if (p.knock && tick >= p.knock.until) p.knock = null;
  const regen = ctx.stats?.lifeRegen ?? 0;
  if (!p.dead && regen > 0 && p.life < p.lifeMax) p.life = Math.min(p.lifeMax, p.life + regen * DT);
  const low = !p.dead && p.life <= p.lifeMax * COMBAT.lowLife;
  if (low !== p.lowLife) {
    p.lowLife = low;
    ctx.emit(EV.LOW_LIFE, { on: low });
  }
}

/**
 * §5.1-6 상태 틱 — 몬스터: 냉기 감소 · 기절/빙결/경직 끝(act 를 idle 로 · MON_STATUS off) · 감전 끝 · 감속 · 넉백 만료.
 * 플레이어: updatePlayerStatus. 화상은 combat.tickBurns.
 * @param {SimCtx} ctx
 */
export function updateStatus(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const tick = st.tick;
  if (rift) {
    const mons = rift.mons;
    const decay = STATUS.chillDecayPerSec * DT;
    for (let i = 0, n = mons.length; i < n; i++) {
      const m = mons[i];
      if (m.gone || m.dead) continue;
      const s = m.st;
      if (s.chill > 0 && tick >= s.chillDecayAt) s.chill = Math.max(0, s.chill - decay);
      if (s.stunUntil === tick) ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'stun', on: false });
      if (s.freezeUntil === tick) ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'freeze', on: false });
      if (s.flinchUntil === tick) ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'flinch', on: false });
      if (s.shockUntil === tick) ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'shock', on: false });
      if (m.act === 'stunned' || m.act === 'frozen' || m.act === 'flinch') {
        const want = disabledAct(m, tick);
        if (want === null) m.act = 'idle';
        else if (want !== m.act) m.act = want;
      }
      if (s.slow && tick >= s.slow.until) s.slow = null;
      if (m.knock && tick >= m.knock.until) m.knock = null;
    }
  }
  updatePlayerStatus(ctx);
}

/**
 * 이동 배율(P3 가 쓴다) — 냉기(chill > 0 이면 × (1 − chillSlow)) · 감속 · 기절/빙결이면 0.
 * 속성 speedMul 은 spawnMonster 가 mon.speed 에 이미 곱했다(다시 곱하지 않는다)
 * @param {MonsterState} mon @param {number} tick
 */
export function monSpeedMul(mon, tick) {
  const s = mon.st;
  if (s.freezeUntil > tick || s.stunUntil > tick) return 0;
  let k = 1;
  if (s.chill > 0) k *= 1 - STATUS.chillSlow;
  if (s.slow && tick < s.slow.until) k *= 1 - s.slow.pct;
  return k;
}

/**
 * 공격 속도 배율 — 속성 mods.atkSpeedMul 의 곱 × 냉기(chill > 0 이면 × (1 − chillSlow)).
 * 빠름 규칙(§5.17-5: 바닥 표식 · cast 예비에는 속성 배율을 곱하지 않는다)은 P3 의 startAttack 이 고른다 — 냉기만 원하면 monSpeedMul 이 아니라
 * 1 − STATUS.chillSlow 를 직접 쓴다.
 * @param {MonsterState} mon @param {number} tick
 */
export function monAtkSpeedMul(mon, tick) {
  let k = 1;
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const m = MON_AFFIXES_BY_ID[list[i]]?.mods?.atkSpeedMul;
    if (m > 0) k *= m;
  }
  if (mon.st.chill > 0) k *= 1 - STATUS.chillSlow;
  return k;
}
