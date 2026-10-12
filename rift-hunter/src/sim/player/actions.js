// OWNER: P1 — 계약 §6.7 · §5.3 · §5.5 · §4.2(P1 이벤트)
// 행동 단계(예비 → 판정 → 후딜) · 시전 검사(장면 · 속박 · 쿨다운 · 자원) · 선입력 버퍼 · 채널 · 자원(분노 · 마나) · 포션 · 귀환 시전.
// 실행부는 노드 · 전설 ID 를 모른다 — 비용 · 쿨 · 행동 길이 · 판정 틱은 행(SkillDef)으로, 동작은 SKILL_BEHAVIORS[behavior]로(§8.4).

import { DT } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { yawOf } from '../../core/math.js';
import { secOf, ticks } from '../../core/time.js';
import { PLAYER } from '../../data/classes.js';
import { BUFFER, POTION } from '../../data/combat.js';
import { healPlayer } from '../combat.js';
import { openRecallPortal } from '../rift.js';
import {
  SKILL_BEHAVIORS, actionSec, addResource, apsEff, cdAt, classOf, emitActionHit, isBasicNode, learnedRank, markCombat, nodeOf,
  skillParams, targetAlive,
} from './skills.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').PlayerState} PlayerState */
/** @typedef {import('../../types.js').InputFrame} InputFrame */
/** @typedef {import('../../types.js').Buffered} Buffered */
/** @typedef {import('./skills.js').Cast} Cast */

/** 귀환 두루마리의 스킬 ID 겸 행동 이름(PlayerAct 'recall') */
export const RECALL = 'recall';

/** 판정이 있는 행동(act) — actHit 에 동작 hit · actEnd 에 idle */
const TIMED_ACTS = ['attack', 'cast', 'dash', 'leap', 'blink'];

/** @returns {import('../../types.js').Intent} */
export const noIntent = () => ({ kind: 'none' });
/** 행동마다 새로 — 동작이 키를 더한다(순수 값 · 절대 틱 키는 At 으로 끝난다) */
export const freshSk = () => ({ hitIds: [], hits: 0, nextAt: -1 });

/** 행동 가능 = act ∈ {idle, move} · 살아 있음(속박이면 이동 스킬만 불가 — castSkill 이 본다) @param {PlayerState} player */
export function isActionable(player) {
  return !player.dead && (player.act === 'idle' || player.act === 'move');
}

/**
 * ctx.hooks.onPlayerDamaged 구현(P2 가 생명 피해 > 0 일 때 부른다) — combatUntil · 분노(+onHitTaken · 초당 takenCapPerSec) · 귀환 취소
 * @param {SimCtx} ctx @param {number} dmg
 */
export function onPlayerDamaged(ctx, dmg) {
  const st = ctx.state, p = st.player;
  if (!(dmg > 0) || p.dead) return;
  markCombat(ctx);
  const C = classOf(ctx);
  if (C.rage) {
    const rt = p.rageTaken;
    if (st.tick - rt.windowStart >= ticks(1)) { rt.windowStart = st.tick; rt.sum = 0; }
    const add = Math.min(C.rage.onHitTaken, C.rage.takenCapPerSec - rt.sum);
    if (add > 0) {
      rt.sum += add;
      addResource(ctx, add);
    }
  }
  if (p.act === RECALL || p.recall) cancelRecall(ctx, 'damage');
}

/**
 * SKILL_FAIL — 같은 (skillId, reason)은 PLAYER.failGapSec(0.5초)에 한 번(player.failAt · failKey)
 * @param {SimCtx} ctx @param {string|null} skillId @param {string} reason @returns {boolean} 냈다
 */
export function emitFail(ctx, skillId, reason) {
  const p = ctx.state.player, tick = ctx.state.tick;
  const key = String(skillId) + '|' + reason;
  if (p.failKey === key && p.failAt >= 0 && tick - p.failAt < ticks(PLAYER.failGapSec)) return false;
  p.failKey = key;
  p.failAt = tick;
  ctx.emit(EV.SKILL_FAIL, { skillId, reason });
  return true;
}

// ───────────────────────── 선입력 ─────────────────────────

/**
 * 버퍼에 넣는다(하나 · 새 입력이 덮어쓴다 · §5.3). until = max(tick + BUFFER.sec, actEnd + BUFFER.tail(끝이 정해진 행동), freeAt + tail)
 * — 창은 잠김이 끝나기까지 남은 시간보다 늘 길다. channel · recall 처럼 끝이 정해지지 않은 행동이면 tick + BUFFER.sec.
 * @param {SimCtx} ctx @param {Omit<Buffered, 'until'>} entry @param {number} [freeAt] 곧 풀리는 쿨다운 · 속박의 틱(-1 = 없음)
 */
export function setBuffer(ctx, entry, freeAt = -1) {
  const p = ctx.state.player, tick = ctx.state.tick;
  let until = tick + ticks(BUFFER.sec);
  const endKnown = !isActionable(p) && p.act !== RECALL && !(p.act === 'channel' && p.channel);
  if (endKnown) until = Math.max(until, p.actEnd + ticks(BUFFER.tail));
  if (freeAt >= 0) until = Math.max(until, freeAt + ticks(BUFFER.tail));
  p.buffer = /** @type {Buffered} */ ({ ...entry, until });
}

/** 잠긴 동안 누른 스킬의 쿨다운 · 속박이 BUFFER.sec 안에 풀리면 그 틱(버퍼 창을 늘린다) · 아니면 -1 */
export function soonFreeAt(ctx, skillId) {
  const st = ctx.state, p = st.player;
  const node = nodeOf(skillId);
  if (!node || !node.skill) return -1;
  const win = ticks(BUFFER.sec);
  let at = -1;
  const ready = p.readyAt[skillId] ?? 0;
  if (ready > st.tick && ready - st.tick <= win) at = ready;
  if (node.skill.tags.includes('movement') && p.st.rootUntil > st.tick && p.st.rootUntil - st.tick <= win) at = Math.max(at, p.st.rootUntil);
  return at;
}

// ───────────────────────── 시전 ─────────────────────────

/**
 * 불가 상태(쿨다운 · 속박)의 처리 — held 는 조용히 · buffer 는 창 안에 풀리면 기다림 · edge 는 BUFFER.sec 안에 풀리면 버퍼 · 그 밖은 SKILL_FAIL
 * @returns {'silent'|'wait'|'buffered'|'failed'}
 */
function gate(ctx, skillId, req, freeAt, reason) {
  const tick = ctx.state.tick;
  if (req.mode === 'held') return 'silent';
  if (req.mode === 'buffer') {
    if (freeAt <= req.until) return 'wait';
    emitFail(ctx, skillId, reason);
    return 'failed';
  }
  if (freeAt - tick <= ticks(BUFFER.sec)) {
    setBuffer(ctx, { kind: 'skill', slot: req.slot, skillId, point: req.point, targetId: req.targetId, stand: false }, freeAt);
    return 'buffered';
  }
  emitFail(ctx, skillId, reason);
  return 'failed';
}

/** 행동을 시작할 때의 시전 값(목표 · 방향 · 기본 길이) */
function makeCast(ctx, node, rank, point, targetId) {
  const p = ctx.state.player;
  const def = node.skill;
  const dur = actionSec(def, apsEff(ctx));
  const hitT = Math.max(1, ticks(dur * def.hitFrac));
  const endT = Math.max(hitT + 1, ticks(dur));
  const mon = targetAlive(ctx, targetId);
  let tx = point.x, tz = point.z;
  if (mon && def.targeting !== 'point' && def.targeting !== 'self') { tx = mon.pos.x; tz = mon.pos.z; }
  let facing = p.facing;
  if (def.targeting !== 'self') {
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    if (dx || dz) facing = yawOf(dx, dz);
  }
  /** @type {Cast} */
  const cast = {
    nodeId: node.id, rank, actionId: 0, x: p.pos.x, z: p.pos.z, facing, tx, tz, targetId: mon ? mon.id : null,
    params: skillParams(ctx, node.id), hitT, endT, fail: null,
  };
  return cast;
}

/** 진행 중인 행동의 시전 값(상태가 정본) @param {SimCtx} ctx @param {any} node @returns {Cast} */
export function castFromState(ctx, node) {
  const p = ctx.state.player;
  const learned = learnedRank(ctx, node.id);
  const rank = Math.max(1, Math.min(node.maxRank, learned || 1));
  return {
    nodeId: node.id, rank, actionId: p.actId, x: p.pos.x, z: p.pos.z, facing: p.facing,
    tx: p.actPoint ? p.actPoint.x : p.pos.x, tz: p.actPoint ? p.actPoint.z : p.pos.z, targetId: p.actTargetId,
    params: skillParams(ctx, node.id), hitT: p.actHit - p.actStart, endT: p.actEnd - p.actStart, fail: null,
  };
}

/**
 * 스킬(또는 기본 공격) 시전 시도. 검사 순서: 장면(마을 → town) · 배운 것(→ empty) · 속박(이동 스킬) · 쿨다운 · 자원 · 동작 start(→ cast.fail).
 * mode: 'edge'(누름 — 실패는 SKILL_FAIL · 곧 풀리면 버퍼) · 'held'(누르고 있음 · 의도의 기본 공격 — 조용히) · 'buffer'(버퍼 실행 — 창 안이면 기다림)
 * @param {SimCtx} ctx @param {string} skillId
 * @param {{slot:number, point:{x:number, z:number}, targetId:number|null, mode:'edge'|'held'|'buffer', until?:number}} req
 * @returns {'started'|'buffered'|'wait'|'failed'|'silent'}
 */
export function castSkill(ctx, skillId, req) {
  const st = ctx.state, p = st.player, tick = st.tick;
  const loud = req.mode !== 'held';
  if (p.dead) return 'failed';
  if (st.scene !== 'rift' || !st.rift) {
    if (loud) emitFail(ctx, skillId, 'town');
    return 'failed';
  }
  const node = nodeOf(skillId);
  const learned = node ? learnedRank(ctx, skillId) : 0;
  if (!node || !node.skill || learned < 1) {
    if (loud) emitFail(ctx, skillId ?? null, 'empty');
    return 'failed';
  }
  const def = node.skill;
  const rank = Math.min(node.maxRank, learned);
  if (def.tags.includes('movement') && tick < p.st.rootUntil) {
    return gate(ctx, skillId, req, p.st.rootUntil, 'rooted');
  }
  const ready = p.readyAt[skillId] ?? 0;
  if (tick < ready) return gate(ctx, skillId, req, ready, 'cooldown');
  const cost = def.cost * (1 - (ctx.stats?.costReduce ?? 0));
  if (p.resource < cost) {
    if (loud) emitFail(ctx, skillId, 'resource');
    return 'failed';
  }
  const beh = SKILL_BEHAVIORS[def.behavior];
  if (!beh) {
    if (loud) emitFail(ctx, skillId, 'empty');
    return 'failed';
  }
  const cast = makeCast(ctx, node, rank, req.point, req.targetId);
  const prevSk = p.sk;
  p.sk = freshSk();
  if (!beh.start(ctx, node, rank, cast)) {
    p.sk = prevSk;
    if (loud) emitFail(ctx, skillId, cast.fail ?? 'noTarget');
    return 'failed';
  }
  // 지불 · 쿨다운 · 생성(시전 시작에)
  if (cost > 0) p.resource = Math.max(0, p.resource - cost);
  if (def.gen) addResource(ctx, def.gen);
  const cd = cdAt(def, rank);
  if (cd > 0) p.readyAt[skillId] = tick + ticks(cd * (1 - (ctx.stats?.cdr ?? 0)));
  beginAction(ctx, node, rank, cast, beh);
  return 'started';
}

/** 행동 시작 — 상태(act · actSkill · 시각 · 목표 · facing 즉시) · ACTION_START · 이동 경로 비우기(§5.2-6) */
function beginAction(ctx, node, rank, cast, beh) {
  const st = ctx.state, p = st.player, tick = st.tick;
  if (p.recall) cancelRecall(ctx, 'action');
  p.actId = ctx.nextId();
  cast.actionId = p.actId;
  p.act = beh.act;
  p.actSkill = node.id;
  p.actStart = tick;
  p.actHit = tick + cast.hitT;
  p.actEnd = tick + cast.endT;
  p.actPoint = { x: cast.tx, z: cast.tz };
  p.actTargetId = cast.targetId;
  p.facing = cast.facing;
  p.path = [];
  p.moving = false;
  // 스킬을 쓰면 경로를 비운다 — 좌클릭을 누르고 있는 의도는 남아 행동이 끝난 뒤 이어진다(move-follow 는 곧바로 다시 경로)
  if (!isBasicNode(node)) {
    if (!p.intent.held) p.intent = noIntent();
    else if (p.intent.kind === 'move') delete p.intent.point;
  }
  ctx.emit(EV.ACTION_START, {
    skillId: node.id, act: p.act, x: p.pos.x, z: p.pos.z, facing: p.facing, tx: cast.tx, tz: cast.tz,
    dur: secOf(cast.endT), hitIn: secOf(cast.hitT),
  });
}

/** 행동 끝 — idle(경로가 있으면 이동 단계가 move 로) @param {SimCtx} ctx */
export function endAction(ctx) {
  const p = ctx.state.player;
  if (p.dead) return;
  p.act = 'idle';
  p.actSkill = null;
  p.actTargetId = null;
  p.air = null;
}

/**
 * 행동 진행(§5.1-4 — 대상 검사 뒤 · 입력 해석 전): 시작 다음 틱부터 동작 tick · actHit 틱에 동작 hit + ACTION_HIT ·
 * tick ≥ actEnd 면 idle(잠김이 풀린 첫 틱 = actEnd 틱 — 같은 틱에 선입력이 나간다). 채널 후딜(channel null)도 actEnd 에 끝.
 * @param {SimCtx} ctx
 */
export function progressAction(ctx) {
  const st = ctx.state, p = st.player, tick = st.tick;
  if (p.dead) return;
  if (TIMED_ACTS.includes(p.act)) {
    const node = nodeOf(p.actSkill);
    const beh = node && node.skill ? SKILL_BEHAVIORS[node.skill.behavior] : null;
    if (beh && tick > p.actStart && (beh.tick || tick === p.actHit)) {
      const cast = castFromState(ctx, node);
      if (beh.tick) beh.tick(ctx, node, cast.rank, cast);
      if (tick === p.actHit && !p.dead) {
        beh.hit(ctx, node, cast.rank, cast);
        emitActionHit(ctx, node.id, cast.rank, cast);
      }
    }
    if (!p.dead && tick >= p.actEnd) endAction(ctx);
    return;
  }
  if (p.act === 'channel' && !p.channel && tick >= p.actEnd) endAction(ctx);
}

// ───────────────────────── 채널 ─────────────────────────

/** 채널 키(그 스킬이 놓인 바 칸)를 누르고 있는가 */
function channelHeld(ctx, input, skillId) {
  const bar = ctx.state.char?.skills?.bar;
  if (!bar || !input || !input.slot) return false;
  for (let i = 0; i < bar.length; i++) if (bar[i] === skillId && input.slot[i]) return true;
  return false;
}

/**
 * 채널 끝 — CHANNEL{on:false}. recover 면 endRecover 후딜(act 'channel' · channel null — 그 사이 입력은 버퍼로),
 * 아니면 바로 idle(다른 입력이 채널을 끊고 같은 틱에 나간다 · §5.3)
 * @param {SimCtx} ctx @param {boolean} recover
 */
export function endChannel(ctx, recover) {
  const st = ctx.state, p = st.player;
  const ch = p.channel;
  if (!ch) return;
  p.channel = null;
  ctx.emit(EV.CHANNEL, { skillId: ch.skillId, on: false });
  if (recover && !p.dead) {
    const er = skillParams(ctx, ch.skillId).endRecover;
    p.act = 'channel';
    p.actHit = st.tick;
    p.actEnd = st.tick + Math.max(1, ticks(typeof er === 'number' ? er : 0));
  } else {
    endAction(ctx);
  }
}

/**
 * 채널 한 틱(§5.1-4 「채널 틱」): 키를 뗐으면 후딜 · 유지 비용(costPerSec × DT · 시작 틱 제외 — 모자라면 후딜) · 동작 tick(채널 판정 · 소용돌이)
 * @param {SimCtx} ctx @param {InputFrame} input
 */
export function updateChannel(ctx, input) {
  const st = ctx.state, p = st.player;
  const ch = p.channel;
  if (!ch || p.act !== 'channel' || p.dead) return;
  const node = nodeOf(ch.skillId);
  if (!node || !node.skill) { endChannel(ctx, false); return; }
  const def = node.skill;
  if (!channelHeld(ctx, input, ch.skillId)) { endChannel(ctx, true); return; }
  if (st.tick > ch.startedAt && def.costPerSec) {
    const up = def.costPerSec * (1 - (ctx.stats?.costReduce ?? 0)) * DT;
    if (p.resource < up) { endChannel(ctx, true); return; }
    p.resource = Math.max(0, p.resource - up);
  }
  const beh = SKILL_BEHAVIORS[def.behavior];
  if (beh && beh.tick) {
    const cast = castFromState(ctx, node);
    beh.tick(ctx, node, cast.rank, cast);
  }
}

// ───────────────────────── 자원 ─────────────────────────

/** 자원 재생/감소(§5.5) — 마나: 초당 resourceRegen · 분노: tick ≥ combatUntil 이면 초당 decayPerSec @param {SimCtx} ctx */
export function updateResource(ctx) {
  const p = ctx.state.player;
  if (p.dead) return;
  const C = classOf(ctx);
  if (C.rage) {
    if (ctx.state.tick >= p.combatUntil && p.resource > 0) p.resource = Math.max(0, p.resource - C.rage.decayPerSec * DT);
  } else {
    const regen = ctx.stats?.resourceRegen ?? 0;
    if (regen > 0 && p.resource < p.resourceMax) p.resource = Math.min(p.resourceMax, p.resource + regen * DT);
  }
  if (p.resource > p.resourceMax) p.resource = Math.max(0, p.resourceMax);
}

// ───────────────────────── 포션 ─────────────────────────

/** 실제로 마신다(생명이 가득이면 POTION_FAIL full) · potions −1 · 쿨다운 · 회복은 healPlayer(PLAYER_HEAL potion) · POTION @param {SimCtx} ctx */
function drinkPotion(ctx) {
  const st = ctx.state, p = st.player, ch = st.char;
  if (!ch) return false;
  if (!(ch.potions > 0)) { ctx.emit(EV.POTION_FAIL, { reason: 'empty' }); return false; }
  if (p.life >= p.lifeMax) { ctx.emit(EV.POTION_FAIL, { reason: 'full' }); return false; }
  const amount = p.lifeMax * POTION.heal * (1 + (ctx.stats?.potionPct ?? 0));
  const heal = Math.min(amount, p.lifeMax - p.life);
  ch.potions = Math.max(0, ch.potions - 1);   // 소모는 여기서(더하는 곳은 P6 addConsumable — NOTES-P1)
  p.potionReadyAt = st.tick + ticks(POTION.cd);
  p.potionQueuedUntil = 0;
  if (st.scene === 'rift' && st.rift) st.rift.stats.potions += 1;
  healPlayer(ctx, heal, 'potion');
  ctx.emit(EV.POTION, { heal, left: ch.potions });
  return true;
}

/**
 * 포션 누름(KeyQ — 행동과 별개 · 행동을 잠그지 않는다): 0개 → empty · 쿨다운 남은 ≤ BUFFER.sec → 대기열(potionReadyAt 틱에 마신다) ·
 * 그보다 길면 cooldown · 생명 가득 → full
 * @param {SimCtx} ctx
 */
export function pressPotion(ctx) {
  const st = ctx.state, p = st.player, ch = st.char;
  if (!ch || p.dead) return;
  if (!(ch.potions > 0)) { ctx.emit(EV.POTION_FAIL, { reason: 'empty' }); return; }
  if (st.tick < p.potionReadyAt) {
    if (p.potionReadyAt - st.tick <= ticks(BUFFER.sec)) { p.potionQueuedUntil = p.potionReadyAt + ticks(BUFFER.tail); return; }
    ctx.emit(EV.POTION_FAIL, { reason: 'cooldown' });
    return;
  }
  drinkPotion(ctx);
}

/** 대기열의 포션 — potionReadyAt 틱에 마신다(그때 생명이 가득이면 POTION_FAIL full) @param {SimCtx} ctx */
export function updatePotionQueue(ctx) {
  const st = ctx.state, p = st.player;
  if (!(p.potionQueuedUntil > 0)) return;
  if (p.dead) { p.potionQueuedUntil = 0; return; }
  if (st.tick >= p.potionReadyAt) {
    p.potionQueuedUntil = 0;
    drinkPotion(ctx);
  } else if (st.tick > p.potionQueuedUntil) {
    p.potionQueuedUntil = 0;
  }
}

// ───────────────────────── 귀환 ─────────────────────────

/**
 * 귀환 시전 시작(행동 가능할 때) — 마을이면 SKILL_FAIL town · 두루마리 0 이면 empty · act 'recall' · 1.5초 · 이동 멈춤 · RECALL start
 * @param {SimCtx} ctx @returns {boolean} 시작했다
 */
export function startRecall(ctx) {
  const st = ctx.state, p = st.player, tick = st.tick;
  if (p.dead) return false;
  if (st.scene !== 'rift' || !st.rift) { emitFail(ctx, RECALL, 'town'); return false; }
  if (!(st.char && st.char.scrolls > 0)) { emitFail(ctx, RECALL, 'empty'); return false; }
  if (p.channel) endChannel(ctx, false);
  const end = tick + ticks(PLAYER.recallSec);
  p.act = RECALL;
  p.actSkill = RECALL;
  p.actStart = tick;
  p.actHit = tick;
  p.actEnd = end;
  p.actPoint = null;
  p.actTargetId = null;
  p.actId = ctx.nextId();
  p.recall = { start: tick, end };
  p.path = [];
  p.intent = noIntent();
  p.moving = false;
  p.speed = 0;
  ctx.emit(EV.RECALL, { phase: 'start', sec: PLAYER.recallSec });
  return true;
}

/** 귀환 취소 — RECALL cancel{reason} · idle @param {SimCtx} ctx @param {'damage'|'action'|'scene'} reason */
export function cancelRecall(ctx, reason) {
  const p = ctx.state.player;
  const rc = p.recall;
  if (!rc) return;
  p.recall = null;
  if (p.act === RECALL) endAction(ctx);
  ctx.emit(EV.RECALL, { phase: 'cancel', reason, sec: secOf(rc.end - rc.start) });
}

/** 귀환 진행 — 끝 틱에 scrolls −1 → openRecallPortal(P2 — 포털 · returnPos · 기록 · requestTravel) → RECALL done @param {SimCtx} ctx */
export function updateRecall(ctx) {
  const st = ctx.state, p = st.player;
  const rc = p.recall;
  if (!rc || p.act !== RECALL || p.dead || st.tick < rc.end) return;
  const pos = { x: p.pos.x, z: p.pos.z };
  p.recall = null;
  endAction(ctx);
  if (st.char && st.char.scrolls > 0) st.char.scrolls -= 1;   // 소모는 여기서(NOTES-P1)
  openRecallPortal(ctx, pos);
  ctx.emit(EV.RECALL, { phase: 'done', sec: secOf(rc.end - rc.start) });
}

