// OWNER: P2 — 계약 §6.8 · §5.10 · §5.11 · §5.18
// 균열 세션 — 장면 전환 요청 · 마을 포털 복귀 · 귀환 포털 · 플레이어 사망(killPlayer) · 몬스터 사망 정리(resolveDeaths) · 게이지 · 수호자 출현 ·
// 완료 · 붕괴 · 진정 · 탐색 · 안전 지점. rift.js 는 player/* 를 import 하지 않는다(§2.2 — 플레이어를 옮기는 commit 은 GameSim).
// 배열에서 빼지 않는다 — 몬스터는 dead · gone 표시, 투사체 · 효과는 until / end = tick(cleanup 이 뺀다 §5.14).

import { CLASS_IDS, TICK_HZ, TILE, TILE_FLOOR } from '../core/constants.js';
import { EV } from '../core/events.js';
import { yawOf } from '../core/math.js';
import { circle } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { DEATH, GAUGE, METER } from '../data/combat.js';
import { XP } from '../data/economy.js';
import { getMonDef, getRank } from '../data/index.js';
import { RIFT, earlyGaugeMulOf, riftRow } from '../data/rift.js';
import { spawnDrops } from './drops.js';
import { spawnEffect } from './effects.js';
import { getMonster } from './entities.js';
import { rollDrops } from './loot/rollDrops.js';
import { findGuardianSpot, spawnGuardian, spawnMonster } from './monsters/monsters.js';
import { applyDeathPenalty } from './progression/inventory.js';
import { completeRun, grantXp, recordRun, unlockAfter, xpForKill } from './progression/progress.js';
import { emitHint, syncTown } from './town.js';
import { isWalkable, isWalkableR, losClear, nearestWalkable } from './world/nav.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Travel} Travel */
/** @typedef {import('../types.js').Result} Result */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').RunSummary} RunSummary */
/** @typedef {import('../types.js').Vec2} Vec2 */

const TAU = Math.PI * 2;
/** 처치 집계 칸(§3.7 RunStats.kills — split · spawn 은 other) */
const KILL_KEYS = new Set(['normal', 'champion', 'elite', 'minion', 'guardian']);
/** 챔피언 이상(MON_DIED.elite) */
const ELITE_RANKS = new Set(['champion', 'elite', 'guardian']);
/** 게이지 초반 배율을 받는 등급(§5.18) */
const EARLY_RANKS = new Set(['normal', 'minion']);
/** 진정에서 쉬는 자세로 돌리는 행동(공격 · 이동) — 기절 · 빙결 · 사라짐 · 사망은 그대로 */
const CALM_ACTS = new Set(['move', 'windup', 'strike', 'recover', 'cast', 'channel', 'charge', 'swell', 'flee']);

/** @param {string} reason @returns {{ok:false, reason:string}} */
const fail = (reason) => ({ ok: false, reason });

// ───────────────────────── 장면 전환 요청 ─────────────────────────

/**
 * 장면 전환 요청 — pendingTravel 이 있으면 {ok:false, reason:'busy'} · 균열 장면이면 rift.leftAt = tick · TRAVEL_REQUEST
 * @param {SimCtx} ctx @param {Travel} travel @returns {Result}
 */
export function requestTravel(ctx, travel) {
  const st = ctx.state;
  if (st.pendingTravel) return fail('busy');
  if (!travel || (travel.to !== 'town' && travel.to !== 'rift')) return fail('invalid');
  if (st.scene === 'rift' && st.rift) st.rift.leftAt = st.tick;
  st.pendingTravel = { ...travel };
  ctx.emit(EV.TRAVEL_REQUEST, { to: travel.to, reason: travel.reason });
  return { ok: true };
}

/**
 * 마을 포털 → 균열 복귀 요청 — 캐릭터 · 마을 · 열린 균열 · 붕괴 아님 · 살아 있음 → requestTravel{to:'rift', reason:'townPortal'}
 * (GameSim.returnToRift 와 P1 의 마을 포털 도착이 부른다)
 * @param {SimCtx} ctx @returns {Result}
 */
export function requestReturnToRift(ctx) {
  const st = ctx.state;
  if (!st.char) return fail('invalid');
  if (st.pendingTravel) return fail('busy');
  if (st.scene !== 'town') return fail('notInTown');
  if (!st.rift) return fail('noRift');
  if (st.rift.phase === 'collapsed') return fail('collapsed');
  if (st.player.dead) return fail('dead');
  return requestTravel(ctx, { to: 'rift', reason: 'townPortal' });
}

/**
 * 귀환 완료(P1 이 부른다) — 이전 귀환 포털을 닫고 그 자리에 포털(kind recall) · returnPos · 기록(recalls · 가방이 찼으면 bagFullRecall) ·
 * PORTAL_OPENED → requestTravel{to:'town', reason:'recall'}
 * @param {SimCtx} ctx @param {Vec2} pos @returns {Result}
 */
export function openRecallPortal(ctx, pos) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || st.scene !== 'rift') return fail('notInRift');
  if (st.pendingTravel) return fail('busy');
  const x = Number.isFinite(pos?.x) ? pos.x : st.player.pos.x, z = Number.isFinite(pos?.z) ? pos.z : st.player.pos.z;
  closePortals(ctx, 'recall');
  const portal = { id: 'portal:' + ctx.nextId(), kind: /** @type {'recall'} */ ('recall'), pos: { x, z }, r: RIFT.portalR, born: st.tick };
  rift.portals.push(portal);
  rift.returnPos = { x, z };
  rift.stats.recalls += 1;
  if (st.char && !st.char.bag.includes(null)) rift.stats.bagFullRecall = true;
  ctx.emit(EV.PORTAL_OPENED, { id: portal.id, kind: portal.kind, x, z });
  return requestTravel(ctx, { to: 'town', reason: 'recall' });
}

/** 그 종류의 포털을 닫는다(PORTAL_CLOSED) @param {SimCtx} ctx @param {'recall'|'exit'} kind */
export function closePortals(ctx, kind) {
  const rift = ctx.state.rift;
  if (!rift) return;
  let w = 0;
  for (let i = 0; i < rift.portals.length; i++) {
    const pt = rift.portals[i];
    if (pt.kind === kind) ctx.emit(EV.PORTAL_CLOSED, { id: pt.id });
    else rift.portals[w++] = pt;
  }
  rift.portals.length = w;
}

/**
 * 균열 닫기 — 활동 중(active · guardian)이었으면 기록 abandon(recordRun) · 완료 단계면 정산(settleComplete — 이미 했으면 아무것도 안 한다) ·
 * RIFT_CLOSED{reason} · rift = null · ctx.riftMap = null · 마을 포털 끔
 * @param {SimCtx} ctx @param {'collapse'|'newRift'|'quit'|'debug'} reason
 */
export function closeRift(ctx, reason) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  if ((rift.phase === 'active' || rift.phase === 'guardian') && st.char) recordRun(ctx, makeSummary(ctx, 'abandon'));
  // 리뷰 수정: 완료 단계인데 아직 정산하지 않았으면(처치 틱 정산 전의 상태를 불러온 경우 등) 닫기 전에 정산한다 — 「타이틀로」 · 새 균열 · 디버그 모두
  if (rift.phase === 'complete' && st.char) settleComplete(ctx);
  ctx.emit(EV.RIFT_CLOSED, { reason });
  st.rift = null;
  ctx.riftMap = null;
  ctx.monVer += 1;
  syncTown(st);
}

// ───────────────────────── 요약 ─────────────────────────

/**
 * 판 요약(§3.9) — complete 면 unlockedTo = unlockAfter(P6) · record = 이 레벨의 최고 기록보다 빠름(completeRun 전에 본다)
 * @param {SimCtx} ctx @param {'complete'|'collapse'|'abandon'} result @returns {RunSummary}
 */
export function makeSummary(ctx, result) {
  const st = ctx.state;
  const rift = /** @type {import('../types.js').RiftState} */ (st.rift);
  const ch = st.char;
  const s = rift.stats;
  const timeSec = rift.ticksIn / TICK_HZ;
  let unlockedTo = ch?.riftUnlocked ?? 1;
  let record = false;
  if (result === 'complete' && ch) {
    const u = unlockAfter(ch, rift.level, rift.deaths);
    if (Number.isFinite(u)) unlockedTo = u;
    const best = ch.best?.[String(rift.level)];
    record = !best || timeSec < best.timeSec;
  }
  return {
    level: rift.level, seed: rift.seed, tileset: rift.tileset, cls: ch?.cls ?? /** @type {any} */ (CLASS_IDS[0]), result, timeSec,
    kills: { ...s.kills }, deaths: rift.deaths, drops: { ...s.drops }, gold: s.gold, xp: s.xp, upgrades: s.upgrades,
    recalls: s.recalls, maxTargeting: s.maxTargeting, swarmMoments: s.swarmMoments, unlockedTo, noDeath: rift.deaths === 0, record,
  };
}

// ───────────────────────── 적대 정리 ─────────────────────────

/** 적대 투사체(until = tick · PROJ_END cancel) · 적대 효과(end = tick)를 지운다(표시만) @param {SimCtx} ctx */
function clearHostiles(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  for (let i = 0; i < rift.projs.length; i++) {
    const pr = rift.projs[i];
    if (pr.owner !== 'mon' || pr.until <= tick) continue;
    pr.until = tick;
    ctx.emit(EV.PROJ_END, { id: pr.id, visual: pr.visual, x: pr.pos.x, z: pr.pos.z, reason: 'cancel' });
  }
  for (let i = 0; i < rift.effects.length; i++) {
    const e = rift.effects[i];
    if (!e.hostile || e.end <= tick) continue;
    e.end = tick;
    e.resolved = true;
  }
}

/**
 * W1 수정 3(NOTES-W1FIX §2.0b · §5.10) — 플레이어가 세상에 남긴 피해원을 지운다: 플레이어 투사체(until = tick · PROJ_END cancel) ·
 * 플레이어 효과(end = tick — 표시만) · 몬스터에 건 화상 · 감전(MON_STATUS off). 사망한 틱(killPlayer)과 부활로 떠나는 순간(settleOnRespawn)에 부른다 —
 * 남겨 두면 마을에서 멈춰 있던 투사체 · 효과 · 화상이 복귀 뒤 잠든 몬스터를 맞혀 팩째(연결로 이웃 팩까지) 깨웠다.
 * @param {SimCtx} ctx
 */
function clearPlayerTraces(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  for (let i = 0; i < rift.projs.length; i++) {
    const pr = rift.projs[i];
    if (pr.owner !== 'player' || pr.until <= tick) continue;
    pr.until = tick;
    ctx.emit(EV.PROJ_END, { id: pr.id, visual: pr.visual, x: pr.pos.x, z: pr.pos.z, reason: 'cancel' });
  }
  for (let i = 0; i < rift.effects.length; i++) {
    const e = rift.effects[i];
    if (e.owner !== 'player' || e.hostile || e.end <= tick) continue;
    e.end = tick;
    e.resolved = true;
  }
  for (let i = 0; i < rift.mons.length; i++) {
    const m = rift.mons[i];
    if (m.gone || m.dead) continue;
    const s = m.st;
    if (s.burn) {
      s.burn = null;
      ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'burn', on: false });
    }
    if (s.shockUntil > tick) {
      s.shockUntil = -1;
      ctx.emit(EV.MON_STATUS, { id: m.id, kind: 'shock', on: false });
    }
  }
}

// ───────────────────────── 플레이어 사망 ─────────────────────────

/**
 * §5.10 플레이어 사망 — ctx.hooks.onPlayerKilled 의 구현(combat 은 import 하지 않고 훅으로 부른다 · killer = MonsterState|null).
 * dead · act dead · killedBy · 경로/버퍼/채널/귀환 정리 · deaths + 1 · applyDeathPenalty(P6) · (active · guardian) 생명 − 1(LIVES) 또는 생명 0 이면 붕괴
 * (수호자가 이미 생명 ≤ 0 이면 붕괴하지 않고 생명도 깎지 않는다 — 완료가 우선) · 적대 투사체 · 예고 지움 · 플레이어 투사체 · 효과 · 화상 · 감전 지움(W1 수정 3) ·
 * 진정(calmSec 0 이면 그 틱) · returnPos = checkpoint ·
 * SAVE_REQUEST{char, death} · HINT death · PLAYER_DIED
 * @param {SimCtx} ctx @param {MonsterState|null} killer
 */
export function killPlayer(ctx, killer) {
  const st = ctx.state;
  const p = st.player;
  if (p.dead) return;
  const tick = st.tick;
  p.dead = true;
  p.deadAt = tick;
  p.life = 0;
  p.act = 'dead';
  p.actSkill = null;
  p.killedBy = killer ? { typeId: killer.typeId, rank: killer.rank, name: killer.name ? [...killer.name] : null } : null;
  p.path = [];
  p.buffer = null;
  p.intent = { kind: 'none' };
  p.air = null;
  p.knock = null;
  p.potionQueuedUntil = 0;
  if (p.channel) {
    ctx.emit(EV.CHANNEL, { skillId: p.channel.skillId, on: false });
    p.channel = null;
  }
  if (p.recall) {
    ctx.emit(EV.RECALL, { phase: 'cancel', reason: 'damage', sec: 0 });
    p.recall = null;
  }
  const rift = st.rift;
  let collapse = false;
  if (rift) rift.deaths += 1;
  if (st.char) applyDeathPenalty(ctx);
  if (rift && (rift.phase === 'active' || rift.phase === 'guardian')) {
    const g = rift.guardianId !== null ? getMonster(ctx, rift.guardianId) : null;
    const guardianDown = !!g && g.hp <= 0;
    if (!guardianDown) {
      if (rift.lives > 0) {
        rift.lives -= 1;
        ctx.emit(EV.LIVES, { lives: rift.lives });
      } else {
        collapse = true;
        rift.phase = 'collapsed';
        const summary = makeSummary(ctx, 'collapse');
        rift.summary = summary;
        rift.completeAt = null;
        if (st.char) recordRun(ctx, summary);
        ctx.emit(EV.RIFT_COLLAPSE, { summary });
        ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'collapse' });
        syncTown(st);
      }
    }
  }
  if (rift) {
    clearHostiles(ctx);
    clearPlayerTraces(ctx);   // W1 수정 3: 플레이어 투사체 · 효과 · 화상 · 감전도 그 틱에(복귀 뒤 잠든 몬스터를 깨우지 않게)
    // W1 수정(NOTES-W1FIX): calmSec 0 이면 그 틱에 진정 — 1초 뒤(calmAt)로 미루면 1초 안에 부활할 때 진정이 복귀 뒤로 밀렸다(shiftTicks)
    if (DEATH.calmSec > 0) rift.calmAt = tick + ticks(DEATH.calmSec);
    else { rift.calmAt = null; calmMonsters(ctx); }
    rift.returnPos = { x: rift.checkpoint.x, z: rift.checkpoint.z };
  }
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'death' });
  emitHint(ctx, 'death');
  ctx.emit(EV.PLAYER_DIED, {
    x: p.pos.x, z: p.pos.z, lives: rift ? rift.lives : 0, collapse,
    killerId: killer ? killer.id : null, killerName: killer && killer.name ? [...killer.name] : null, killerTypeId: killer ? killer.typeId : null,
  });
}

// ───────────────────────── 몬스터 사망 ─────────────────────────

/** 판 경험치 집계(rift.stats.xp · meter.runXp) @param {SimCtx} ctx @param {any} res grantXp 결과 */
function noteXp(ctx, res) {
  const n = res && Number.isFinite(res.amount) && res.amount > 0 ? res.amount : 0;
  if (!n) return;
  if (ctx.state.rift) ctx.state.rift.stats.xp += n;
  ctx.state.meter.runXp += n;
}

/**
 * §5.10 몬스터 사망 — 생명 ≤ 0 이고 dead 가 아닌 것(목록 순서 · 이 호출 중에 생긴 것은 다음 틱): dead · deadAt · act dead → onMonDeath(P3) →
 * 경험치(!noXp) → 게이지(active · !noGauge · 초반 배율) → 드랍(!noDrops · rollDrops → spawnDrops · blp) → 처치 집계 · killTicks →
 * 플레이어 처치면 onPlayerKill(P1 · !noProcs) → MON_DIED. 수호자면 완료로(§5.10 「완료 뒤」).
 * 처치로 세는 것: lastHit.by 'player' 이고 「스스로 사라짐」(noXp · noDrops · noGauge 를 다 세웠고 revived 아님 — 역병 덩어리 폭발 · 완료 정리)이 아닌 것.
 * @param {SimCtx} ctx
 */
export function resolveDeaths(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  const ch = st.char;
  const mons = rift.mons;
  let completed = false;
  for (let i = 0, n = mons.length; i < n; i++) {
    const m = mons[i];
    if (m.gone || m.dead || m.hp > 0) continue;
    m.dead = true;
    m.deadAt = tick;
    m.hp = 0;
    m.act = 'dead';
    m.targeting = false;
    m.knock = null;
    m.aim = null;
    m.aimLocked = false;
    m.vel.x = 0;
    m.vel.z = 0;
    const f = m.flags;
    const byPlayer = !!m.lastHit && m.lastHit.by === 'player';
    const selfGone = f.noXp && f.noDrops && f.noGauge && !f.revived;
    const counted = byPlayer && !selfGone;
    // 완료 정리로 사라지는 몬스터는 사망 훅(화염 강화 폭발 · 분열 사본 · 웅덩이)을 돌리지 않는다 — 끝난 판에 새 위협이 생기지 않게
    const vanished = rift.phase === 'complete' && selfGone && !!m.lastHit && m.lastHit.by === 'env' && m.id !== rift.guardianId;
    if (!vanished) ctx.hooks.onMonDeath(ctx, m);

    const def = getMonDef(m.typeId);
    const rk = getRank(m.rank);

    if (ch && !f.noXp) {
      const amount = xpForKill(m, ch.level, ctx.stats.xpPct ?? 0);
      if (Number.isFinite(amount) && amount > 0) noteXp(ctx, grantXp(ctx, Math.round(amount), 'kill'));
    }
    if (rift.phase === 'active' && !f.noGauge) {
      const early = EARLY_RANKS.has(m.rank) ? earlyGaugeMulOf(rift.level) : 1;   // 밸런스 게이트: 균열별 배열(data/rift.js)
      const pct = rk.gauge * def.gauge * early;
      if (pct > 0) addGauge(ctx, pct);
    }
    if (ch && !f.noDrops) {
      const res = rollDrops(ctx.rng.loot, {
        rank: m.rank, level: m.level, cls: ch.cls, mf: ctx.stats.magicFind ?? 0, gf: ctx.stats.goldFind ?? 0,
        blp: ch.blp.count, blpOn: true, newId: ctx.newItemId,
      });
      if (res) {
        if (Number.isFinite(res.blp) && res.blp >= 0) ch.blp.count = res.blp;
        if (res.drops && res.drops.length) spawnDrops(ctx, res.drops, m.pos.x, m.pos.z);
      }
    }
    if (counted) {
      const key = KILL_KEYS.has(m.rank) ? m.rank : 'other';
      rift.stats.kills[/** @type {keyof typeof rift.stats.kills} */ (key)] += 1;
      const kt = st.meter.killTicks;
      kt.push(tick);
      if (kt.length > METER.killCap) kt.splice(0, kt.length - METER.killCap);
      if (!m.lastHit.noProcs) ctx.hooks.onPlayerKill(ctx, m, m.lastHit);
    }
    ctx.emit(EV.MON_DIED, {
      id: m.id, typeId: m.typeId, rank: m.rank, x: m.pos.x, z: m.pos.z, facing: m.facing,
      launch: m.launch ? { x: m.launch.x, z: m.launch.z } : null, byPlayer, elite: ELITE_RANKS.has(m.rank),
    });
    if (m.id === rift.guardianId && (rift.phase === 'active' || rift.phase === 'guardian')) { completeGuardian(ctx, m); completed = true; }
  }
  // 리뷰 수정: 수호자를 쓰러뜨린 그 틱에 보상을 정산한다(같은 틱의 다른 처치까지 센 뒤) — completeDelay 는 패널 · 나가는 포털 연출에만 쓴다.
  //   전에는 completeAt(+1.5초) 전에 「타이틀로」 · 탭 닫기(pagehide 저장)를 하면 해금 · 완료 경험치 · 기록이 사라졌다.
  if (completed && rift.phase === 'complete') settleComplete(ctx);
}

/**
 * 수호자 처치 → phase complete · 남은 몬스터는 경험치 · 드랍 · 게이지 없이 사라진다(flags.no* · 생명 0 — 다음 resolveDeaths 가 정리 · MON_DIED 는 낸다) ·
 * 남은 적대 투사체 · 예고를 지운다(싸움이 끝났다) · completeAt
 * @param {SimCtx} ctx @param {MonsterState} guardian
 */
function completeGuardian(ctx, guardian) {
  const st = ctx.state;
  const rift = /** @type {import('../types.js').RiftState} */ (st.rift);
  rift.phase = 'complete';
  rift.guardianSpawn = null;
  for (let i = 0; i < rift.mons.length; i++) {
    const m = rift.mons[i];
    if (m === guardian || m.gone || m.dead || m.hp <= 0) continue;
    m.flags.noXp = true;
    m.flags.noDrops = true;
    m.flags.noGauge = true;
    m.hp = 0;
    m.lastHit = { by: 'env', skillId: null, noProcs: true, frozen: false };
  }
  clearHostiles(ctx);
  rift.completeAt = st.tick + ticks(RIFT.completeDelay);
}

// ───────────────────────── 게이지 · 수호자 ─────────────────────────

/**
 * 게이지(%) — active 에서만 · GAUGE{gauge, delta} · 100 이면 phase guardian · 출현 자리(findGuardianSpot · 걷기 가능) · guardianSpawn{at} ·
 * 비적대 효과 guardianSpawn(예고 RIFT.guardianDelay) · GAUGE_FULL · HINT gauge
 * @param {SimCtx} ctx @param {number} pct
 */
export function addGauge(ctx, pct) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || rift.phase !== 'active' || !(pct > 0) || !Number.isFinite(pct)) return;
  const before = rift.gauge;
  rift.gauge = Math.min(GAUGE.max, rift.gauge + pct);
  ctx.emit(EV.GAUGE, { gauge: rift.gauge, delta: rift.gauge - before });
  if (rift.gauge < GAUGE.max) return;
  rift.phase = 'guardian';
  const spot = guardianSpot(ctx);
  rift.guardianSpawn = { x: spot.x, z: spot.z, at: st.tick + ticks(RIFT.guardianDelay) };
  spawnEffect(ctx, {
    kind: 'guardianSpawn', owner: 'env', srcId: -1, hostile: false, shape: circle(spot.x, spot.z, RIFT.guardianSpawnR),
    delay: RIFT.guardianDelay, spec: null,
  });
  ctx.emit(EV.GAUGE_FULL, { x: spot.x, z: spot.z, sec: RIFT.guardianDelay });
  emitHint(ctx, 'gauge');
}

/** 수호자 자리 — findGuardianSpot(P3) 이 걷기 가능하지 않으면 가장 가까운 걷기 가능 점 · 그것도 없으면 플레이어 자리 @param {SimCtx} ctx */
function guardianSpot(ctx) {
  const p = ctx.state.player.pos;
  const map = ctx.riftMap ?? ctx.map;
  const s = findGuardianSpot(ctx);
  let x = s && Number.isFinite(s.x) ? s.x : p.x, z = s && Number.isFinite(s.z) ? s.z : p.z;
  if (map && !isWalkable(map, x, z)) {
    const q = nearestWalkable(map, x, z) ?? nearestWalkable(map, p.x, p.z);
    x = q ? q.x : p.x;
    z = q ? q.z : p.z;
  }
  return { x, z };
}

/**
 * 수호자를 지금 세운다 — spawnGuardian(P3 · GUARDIAN_IMPLS.init) · 돌려준 값이 없으면 이번에 생긴 수호자 등급 몬스터를 찾고 ·
 * 그래도 없으면 spawnMonster 로 직접(팩 하나 · 깨어 있게 — 수호자가 나타나지 않아 판이 멈추지 않게) → guardianId · GUARDIAN_APPEAR
 * @param {SimCtx} ctx @param {number} x @param {number} z @returns {MonsterState|null}
 */
export function spawnGuardianNow(ctx, x, z) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return null;
  const before = rift.mons.length;
  const ret = /** @type {any} */ (spawnGuardian(ctx, x, z));
  /** @type {MonsterState|null} */
  let g = null;
  if (ret && typeof ret === 'object' && typeof ret.id === 'number') g = ret;
  else if (typeof ret === 'number') g = getMonster(ctx, ret);
  if (!g) {
    for (let i = rift.mons.length - 1; i >= before; i--) {
      if (rift.mons[i].rank === 'guardian' && !rift.mons[i].dead) { g = rift.mons[i]; break; }
    }
  }
  if (!g) {
    const p = st.player.pos;
    const pack = { id: ctx.nextId(), kind: /** @type {'guardian'} */ ('guardian'), memberIds: /** @type {number[]} */ ([]), awake: true, nextHazardAt: -1, fled: false, anchor: { x, z } };
    rift.packs.push(pack);
    g = spawnMonster(ctx, { typeId: rift.guardianType, rank: 'guardian', level: rift.level, packId: pack.id, x, z, facing: yawOf(p.x - x, p.z - z), awake: true, reason: 'guardian' });
    pack.memberIds.push(g.id);
  }
  g.awake = true;
  rift.guardianId = g.id;
  rift.guardianSpawn = null;
  ctx.emit(EV.GUARDIAN_APPEAR, { id: g.id, typeId: g.typeId, x: g.pos.x, z: g.pos.z, name: g.name ? [...g.name] : [] });
  return g;
}

/**
 * 완료 정산(수호자 처치 틱 — resolveDeaths 가 그 호출 끝에 부른다 · 리뷰 수정) — 완료 경험치(round(XP.completeBonus × xpMul(L))) → 요약 →
 * completeRun(P6 — 해금 · 최고 기록 · 기록 · SAVE_REQUEST{char, complete}) → rift.settled = 요약. 패널(rift.summary)은 completeAt 에 finishRift 가 연다.
 * 이미 정산했거나(settled) 요약이 있으면(옛 상태 · 고정 상태) 아무것도 하지 않는다 → 그 요약
 * @param {SimCtx} ctx @returns {RunSummary|null}
 */
export function settleComplete(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || rift.phase !== 'complete') return null;
  if (rift.settled) return rift.settled;
  if (rift.summary) return rift.summary;
  const ch = st.char;
  const bonus = Math.round(XP.completeBonus * riftRow(rift.level).xpMul);
  if (ch && bonus > 0) noteXp(ctx, grantXp(ctx, bonus, 'complete'));
  const summary = makeSummary(ctx, 'complete');
  rift.settled = summary;
  if (ch) completeRun(ctx, summary);
  return summary;
}

/**
 * 완료 마무리(completeAt 틱 · 디버그 · 떠나는 commit) — 정산(settleComplete — 처치 틱에 이미 했으면 그 요약) → rift.summary(패널) →
 * RIFT_COMPLETE → 나가는 포털(수호자 자리 + exitPortalOffset 의 걷기 가능 점) PORTAL_OPENED · SAVE_REQUEST{char, complete}
 * @param {SimCtx} ctx
 */
export function finishRift(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || rift.phase !== 'complete' || rift.summary) return;
  const summary = settleComplete(ctx);
  if (!summary) return;
  rift.summary = summary;
  rift.completeAt = null;
  ctx.emit(EV.RIFT_COMPLETE, { summary });
  const pos = exitPortalSpot(ctx);
  const portal = { id: 'portal:' + ctx.nextId(), kind: /** @type {'exit'} */ ('exit'), pos, r: RIFT.portalR, born: st.tick };
  rift.portals.push(portal);
  ctx.emit(EV.PORTAL_OPENED, { id: portal.id, kind: portal.kind, x: pos.x, z: pos.z });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'complete' });
}

/** 나가는 포털 자리 — 수호자(시체) 자리에서 플레이어 쪽부터 돌며 exitPortalOffset 의 걷기 가능 점 @param {SimCtx} ctx @returns {Vec2} */
function exitPortalSpot(ctx) {
  const st = ctx.state;
  const rift = /** @type {import('../types.js').RiftState} */ (st.rift);
  const p = st.player.pos;
  const map = ctx.riftMap ?? ctx.map;
  const g = rift.guardianId !== null ? getMonster(ctx, rift.guardianId) : null;
  const cx = g ? g.pos.x : p.x, cz = g ? g.pos.z : p.z;
  const base = yawOf(p.x - cx, p.z - cz);
  const n = Math.max(1, RIFT.exitPortalTries);
  for (let k = 0; k < n; k++) {
    const a = base + (k * TAU) / n;
    const x = cx + Math.sin(a) * RIFT.exitPortalOffset, z = cz + Math.cos(a) * RIFT.exitPortalOffset;
    if (!map || isWalkableR(map, x, z, RIFT.portalR / 2)) return { x, z };
  }
  const q = map ? nearestWalkable(map, cx, cz) ?? nearestWalkable(map, p.x, p.z) : null;
  return q ? { x: q.x, z: q.z } : { x: p.x, z: p.z };
}

// ───────────────────────── 틱 진행 ─────────────────────────

/** 플레이어 둘레 RIFT.exploreR 안의 타일을 탐색함으로(미니맵) @param {SimCtx} ctx */
export function markExplored(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const map = ctx.map;
  if (!rift || !map || map.kind !== 'rift' || rift.explored.length !== map.w * map.h) return;
  const p = st.player.pos;
  const R = RIFT.exploreR;
  const T = TILE;
  const i0 = Math.max(0, Math.floor((p.x - R) / T)), i1 = Math.min(map.w - 1, Math.floor((p.x + R) / T));
  const j0 = Math.max(0, Math.floor((p.z - R) / T)), j1 = Math.min(map.h - 1, Math.floor((p.z + R) / T));
  const r2 = R * R;
  for (let j = j0; j <= j1; j++) {
    const cz = (j + 0.5) * T - p.z;
    for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * T - p.x;
      if (cx * cx + cz * cz <= r2) rift.explored[j * map.w + i] = 1;
    }
  }
}

/** 안전 지점(§5.10) — checkpointEvery 마다 checkpointR 안에 깨어 있는 몬스터가 없고 살아 있으면 조용한 시간 + · checkpointCalm 이상이면 그 자리 @param {SimCtx} ctx */
function updateCheckpoint(ctx) {
  const st = ctx.state;
  const rift = /** @type {import('../types.js').RiftState} */ (st.rift);
  const p = st.player;
  if (p.dead || p.act === 'dash' || p.act === 'leap' || p.act === 'blink' || st.pendingTravel) {
    rift.checkpointCalm = 0;
    return;
  }
  const r2 = RIFT.checkpointR * RIFT.checkpointR;
  const margin = RIFT.checkpointSleepMargin;
  const map = ctx.map;
  const mons = rift.mons;
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (m.gone || m.dead || !(m.hp > 0)) continue;
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    const d2 = dx * dx + dz * dz;
    if (m.awake) {
      if (d2 <= r2) {
        rift.checkpointCalm = 0;
        return;
      }
      continue;
    }
    // W1 수정(NOTES-W1FIX): 잠든 몬스터의 시야(aggro + margin · 벽 시야) 안은 조용하지 않다 — 깨기 직전 자리가 안전 지점이 되지 않게
    if (!(margin >= 0) || !map) continue;
    if (sleeperSees(map, m, p.pos.x, p.pos.z, margin)) {
      rift.checkpointCalm = 0;
      return;
    }
  }
  rift.checkpointCalm += Math.max(1, ticks(RIFT.checkpointEvery));
  if (rift.checkpointCalm >= ticks(RIFT.checkpointCalm) && (!map || isWalkable(map, p.pos.x, p.pos.z))) {
    rift.checkpoint.x = p.pos.x;
    rift.checkpoint.z = p.pos.z;
  }
}

/** 잠든 몬스터 m 의 시야 — (x, z)가 aggro + margin 안이고 벽 시야가 트였다(§5.10 안전 지점 · 복귀 지점) @param {import('../types.js').MapData} map @param {MonsterState} m */
function sleeperSees(map, m, x, z, margin) {
  const R = getMonDef(m.typeId).aggro + margin;
  const dx = m.pos.x - x, dz = m.pos.z - z;
  return dx * dx + dz * dz <= R * R && losClear(map, m.pos.x, m.pos.z, x, z);
}

/** (x, z)를 보는 살아 있고 잠든 몬스터가 있다 @param {SimCtx} ctx @param {number} margin */
function seenBySleeper(ctx, x, z, margin) {
  const map = /** @type {import('../types.js').MapData} */ (ctx.map);
  const mons = /** @type {import('../types.js').RiftState} */ (ctx.state.rift).mons;
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (m.gone || m.dead || m.awake || !(m.hp > 0)) continue;
    if (sleeperSees(map, m, x, z, margin)) return true;
  }
  return false;
}

/**
 * W1 수정 3(§5.10) — 복귀 지점 다시 고르기: from 이 잠든 몬스터의 시야(aggro + checkpointSleepMargin · 벽 시야) 안이면 from 의 타일에서 바닥 타일을
 * 너비 우선(4방향 · 이웃 순서 +x · −x · +z · −z — 결정적)으로 넓혀 가며 처음 만나는 「시야 밖이고 플레이어 몸이 들어가는」 타일 가운데. 없으면 from 그대로.
 * (집으로 돌아간 수호자 — aggro 99 — 처럼 안전 지점을 정한 뒤에 생긴 · 돌아온 몬스터의 시야 안이 된 경우)
 * @param {SimCtx} ctx @param {Vec2} from @returns {Vec2}
 */
function safeReturnPos(ctx, from) {
  const map = ctx.map;
  const margin = RIFT.checkpointSleepMargin;
  if (!map || !(margin >= 0) || !seenBySleeper(ctx, from.x, from.z, margin)) return from;
  const r = ctx.state.player.r > 0 ? ctx.state.player.r : 0;
  const w = map.w, h = map.h;
  const i0 = Math.floor(from.x / TILE), j0 = Math.floor(from.z / TILE);
  if (i0 < 0 || j0 < 0 || i0 >= w || j0 >= h) return from;
  const seen = new Uint8Array(w * h);
  const queue = [j0 * w + i0];
  seen[queue[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    const idx = queue[q];
    const i = idx % w, j = (idx - i) / w;
    if (q > 0) {
      const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
      if (isWalkableR(map, x, z, r) && !seenBySleeper(ctx, x, z, margin)) return { x, z };
    }
    for (let k = 0; k < 4; k++) {
      const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const n = nj * w + ni;
      if (seen[n] || map.tiles[n] !== TILE_FLOOR) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return from;
}

/**
 * W1 수정(NOTES-W1FIX · §5.10) — 부활로 균열을 떠날 때(GameSim 의 respawn commit): 깨어 있는 몬스터를 모두 재우고(남은 calmAt · 죽어 있는 동안 깬 팩),
 * 플레이어가 남긴 피해원(투사체 · 효과 · 화상 · 감전 — W1 수정 3)을 지우고, 잠든 몬스터를 처음 놓인 자리(`rift.homes[id]`)로 되돌린다(생명은 그대로 ·
 * 화면은 전환 막 아래). 마지막으로 복귀 지점이 잠든 몬스터의 시야 안이면 가장 가까운 시야 밖으로 옮긴다(W1 수정 3 — 수호자 단계).
 * (W1 수정 4) 맨 앞: 수호자 출현 예고 중(guardianSpawn 있음 · guardianId null)이면 수호자를 지금 세운다 — 뒤의 진정 · 처음 자리 · 복귀 지점 규칙을 똑같이 받는다.
 * 복귀한 플레이어가 같은 떼 · 같은 수호자 앞에 서지 않는다 — 싸움은 플레이어가 다가가면 다시 시작된다.
 * @param {SimCtx} ctx
 */
export function settleOnRespawn(ctx) {
  const rift = ctx.state.rift;
  if (!rift) return;
  // W1 수정 4: 게이지가 찬 뒤 수호자 출현 예고(RIFT.guardianDelay) 안에 쓰러져 아직 나오지 않았으면 지금 세운다 — 아래의 진정 · 처음 자리 ·
  // 복귀 지점 다시 고르기를 이미 나온 수호자와 똑같이 받는다(미뤄 두면 복귀 직후 깨어 있는 채로 나와 복귀 지점으로 걸어왔다 · 예고 효과도 여기서 끝)
  if (rift.phase === 'guardian' && rift.guardianId === null && rift.guardianSpawn) {
    spawnGuardianNow(ctx, rift.guardianSpawn.x, rift.guardianSpawn.z);
    endGuardianTelegraph(ctx);
  }
  // 남은 진정(calmAt)과 죽어 있는 동안 깬 팩을 함께 — 늘 진정한다(잠든 몬스터에는 아무것도 하지 않는다)
  calmMonsters(ctx);
  rift.calmAt = null;
  // 사망 틱(killPlayer)에 지웠어도 그 뒤(같은 틱의 처치 훅 등)에 생긴 것까지 — 떠나는 순간 플레이어의 것은 남지 않는다
  clearPlayerTraces(ctx);
  if (rift.homes) {
    for (let i = 0; i < rift.mons.length; i++) {
      const m = rift.mons[i];
      const h = rift.homes[m.id];
      if (!h || m.gone || m.dead || m.awake || !(m.hp > 0)) continue;
      if (m.pos.x === h.x && m.pos.z === h.z) continue;
      m.pos.x = h.x;
      m.pos.z = h.z;
      m.prevPos = { x: h.x, z: h.z };
      m.facing = h.facing;
      m.knock = null;
      m.vel.x = 0;
      m.vel.z = 0;
    }
  }
  const from = rift.returnPos ?? rift.checkpoint;
  const to = safeReturnPos(ctx, from);
  if (to !== from) {
    rift.returnPos = { x: to.x, z: to.z };
    rift.checkpoint.x = to.x;
    rift.checkpoint.z = to.z;
  }
}

/** 수호자 출현 예고 효과(addGauge 의 env · guardianSpawn — 표시만)를 이 틱에 끝낸다 — 예고보다 먼저 세웠을 때(settleOnRespawn) @param {SimCtx} ctx */
function endGuardianTelegraph(ctx) {
  const rift = /** @type {import('../types.js').RiftState} */ (ctx.state.rift);
  const tick = ctx.state.tick;
  for (let i = 0; i < rift.effects.length; i++) {
    const e = rift.effects[i];
    if (e.owner !== 'env' || e.kind !== 'guardianSpawn' || e.end <= tick) continue;
    e.end = tick;
    e.resolved = true;
  }
}

/** 진정(사망 — §5.10) — 깨어 있는 몬스터를 그 자리에서 재운다(생명 그대로) · 팩도 @param {SimCtx} ctx */
function calmMonsters(ctx) {
  const rift = /** @type {import('../types.js').RiftState} */ (ctx.state.rift);
  for (let i = 0; i < rift.mons.length; i++) {
    const m = rift.mons[i];
    if (m.gone || m.dead || !m.awake) continue;
    m.awake = false;
    m.targeting = false;
    if (CALM_ACTS.has(m.act)) m.act = 'idle';
    m.aim = null;
    m.aimLocked = false;
    m.vel.x = 0;
    m.vel.z = 0;
  }
  for (let i = 0; i < rift.packs.length; i++) rift.packs[i].awake = false;
}

/**
 * §5.1-7 진행 — 수호자 출현(guardianSpawn.at) · 완료 마무리(completeAt) · 진정(calmAt) · 탐색 · 안전 지점 · 정예 안내
 * @param {SimCtx} ctx
 */
export function updateRift(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  if (rift.phase === 'guardian' && rift.guardianSpawn && rift.guardianId === null && tick >= rift.guardianSpawn.at) {
    spawnGuardianNow(ctx, rift.guardianSpawn.x, rift.guardianSpawn.z);
  }
  if (rift.phase === 'complete' && !rift.summary && rift.completeAt !== null && tick >= rift.completeAt) finishRift(ctx);
  if (rift.calmAt !== null && tick >= rift.calmAt) {
    calmMonsters(ctx);
    rift.calmAt = null;
  }
  if (tick % Math.max(1, ticks(RIFT.exploreEvery)) === 0) markExplored(ctx);
  if (tick % Math.max(1, ticks(RIFT.checkpointEvery)) === 0) updateCheckpoint(ctx);
  if (st.char && !st.char.hints?.elites && tick % Math.max(1, ticks(RIFT.hintEvery)) === 0) {
    for (let i = 0; i < rift.packs.length; i++) {
      const pk = rift.packs[i];
      if (pk.awake && (pk.kind === 'champion' || pk.kind === 'elite')) {
        emitHint(ctx, 'elites');
        break;
      }
    }
  }
}

/** 순수 — 균열 경과 초(ticksIn / 30 · 균열이 없으면 0) @param {import('../types.js').GameState} state */
export function riftElapsedSec(state) {
  return state.rift ? state.rift.ticksIn / TICK_HZ : 0;
}
