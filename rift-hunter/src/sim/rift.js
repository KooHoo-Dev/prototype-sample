// OWNER: P2 — 계약 §6.8 · §5.10 · §5.11 · §5.18
// 균열 세션 — 장면 전환 요청 · 마을 포털 복귀 · 귀환 포털 · 플레이어 사망(killPlayer) · 몬스터 사망 정리(resolveDeaths) · 게이지 · 수호자 출현 ·
// 완료 · 붕괴 · 진정 · 탐색 · 안전 지점. rift.js 는 player/* 를 import 하지 않는다(§2.2 — 플레이어를 옮기는 commit 은 GameSim).
// 배열에서 빼지 않는다 — 몬스터는 dead · gone 표시, 투사체 · 효과는 until / end = tick(cleanup 이 뺀다 §5.14).

import { CLASS_IDS, TICK_HZ, TILE } from '../core/constants.js';
import { EV } from '../core/events.js';
import { yawOf } from '../core/math.js';
import { circle } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { DEATH, GAUGE, METER } from '../data/combat.js';
import { XP } from '../data/economy.js';
import { getMonDef, getRank } from '../data/index.js';
import { RIFT, riftRow } from '../data/rift.js';
import { spawnDrops } from './drops.js';
import { spawnEffect } from './effects.js';
import { getMonster } from './entities.js';
import { rollDrops } from './loot/rollDrops.js';
import { findGuardianSpot, spawnGuardian, spawnMonster } from './monsters/monsters.js';
import { applyDeathPenalty } from './progression/inventory.js';
import { completeRun, grantXp, recordRun, unlockAfter, xpForKill } from './progression/progress.js';
import { emitHint, syncTown } from './town.js';
import { isWalkable, isWalkableR, nearestWalkable } from './world/nav.js';

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
 * 균열 닫기 — 활동 중(active · guardian)이었으면 기록 abandon(recordRun) · RIFT_CLOSED{reason} · rift = null · ctx.riftMap = null · 마을 포털 끔
 * @param {SimCtx} ctx @param {'collapse'|'newRift'|'quit'|'debug'} reason
 */
export function closeRift(ctx, reason) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  if ((rift.phase === 'active' || rift.phase === 'guardian') && st.char) recordRun(ctx, makeSummary(ctx, 'abandon'));
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

// ───────────────────────── 플레이어 사망 ─────────────────────────

/**
 * §5.10 플레이어 사망 — ctx.hooks.onPlayerKilled 의 구현(combat 은 import 하지 않고 훅으로 부른다 · killer = MonsterState|null).
 * dead · act dead · killedBy · 경로/버퍼/채널/귀환 정리 · deaths + 1 · applyDeathPenalty(P6) · (active · guardian) 생명 − 1(LIVES) 또는 생명 0 이면 붕괴
 * (수호자가 이미 생명 ≤ 0 이면 붕괴하지 않고 생명도 깎지 않는다 — 완료가 우선) · 적대 투사체 · 예고 지움 · calmAt · returnPos = checkpoint ·
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
    rift.calmAt = tick + ticks(DEATH.calmSec);
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
      const early = rift.level <= RIFT.earlyGaugeTo && EARLY_RANKS.has(m.rank) ? RIFT.earlyGaugeMul : 1;
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
    if (m.id === rift.guardianId && (rift.phase === 'active' || rift.phase === 'guardian')) completeGuardian(ctx, m);
  }
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
 * 완료 마무리(completeAt 틱 · 디버그) — 완료 경험치(round(XP.completeBonus × xpMul(L))) → 요약 → completeRun(P6 — 해금 · 최고 기록 · 기록 · 저장) →
 * RIFT_COMPLETE → 나가는 포털(수호자 자리 + exitPortalOffset 의 걷기 가능 점) PORTAL_OPENED · SAVE_REQUEST{char, complete}
 * @param {SimCtx} ctx
 */
export function finishRift(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || rift.phase !== 'complete' || rift.summary) return;
  const ch = st.char;
  const bonus = Math.round(XP.completeBonus * riftRow(rift.level).xpMul);
  if (ch && bonus > 0) noteXp(ctx, grantXp(ctx, bonus, 'complete'));
  const summary = makeSummary(ctx, 'complete');
  rift.summary = summary;
  rift.completeAt = null;
  if (ch) completeRun(ctx, summary);
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
  const mons = rift.mons;
  for (let i = 0; i < mons.length; i++) {
    const m = mons[i];
    if (m.gone || m.dead || !m.awake || !(m.hp > 0)) continue;
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    if (dx * dx + dz * dz <= r2) {
      rift.checkpointCalm = 0;
      return;
    }
  }
  rift.checkpointCalm += Math.max(1, ticks(RIFT.checkpointEvery));
  const map = ctx.map;
  if (rift.checkpointCalm >= ticks(RIFT.checkpointCalm) && (!map || isWalkable(map, p.pos.x, p.pos.z))) {
    rift.checkpoint.x = p.pos.x;
    rift.checkpoint.z = p.pos.z;
  }
}

/** 진정(사망 뒤 calmAt) — 깨어 있는 몬스터를 그 자리에서 재운다(생명 그대로) · 팩도 @param {SimCtx} ctx */
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
