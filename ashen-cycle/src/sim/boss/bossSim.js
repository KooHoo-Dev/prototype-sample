// OWNER: P3 — 계약 §6.5 · §8
// 보스 프레임워크의 공개 창구 + 상태 기계. 공격 시간축은 bossTimeline.js, 선택 · 추격 · 연속기는 bossAI.js.
// 보스 정의 · 훅 · 순환 배율은 레지스트리에서 찾지 않고 ctx.bossDef · ctx.bossHooks · ctx.scaling에서 읽는다.
// 보스 ID 분기 없음 — 보스마다 다른 동작은 데이터(BossDef)와 훅(BossHooks)으로만 들어온다.
import { EV } from '../../core/events.js';
import { EPS } from '../../core/constants.js';
import { BOSS_AI } from '../../data/bossCommon.js';
import {
  collectHits, collectTelegraphs, endAttack, ensureBossFw, startAttack, stepAttack,
} from './bossTimeline.js';
import {
  canAttack, faceTarget, hasRearCandidate, pickChain, selectAttack, thinkTime, thinkWalkIntent, updateChase,
} from './bossAI.js';

/** @typedef {import('../../types.js').BossDef} BossDef */
/** @typedef {import('../../types.js').BossState} BossState */
/** @typedef {import('../../types.js').BossStateName} BossStateName */
/** @typedef {import('../../types.js').BossHooks} BossHooks */
/** @typedef {import('../../types.js').CycleScaling} CycleScaling */
/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').OutgoingHit} OutgoingHit */
/** @typedef {import('../../types.js').TelegraphSrc} TelegraphSrc */
/** @typedef {import('../../types.js').DamageResult} DamageResult */

/** @type {BossHooks} */
const NO_HOOKS = Object.freeze({});

/**
 * 새 보스 상태. state 'intro', hp = round(def.hp × scaling.hpMul), posture 0, phase 1, prevPos = pos.
 * 끝에서 hooks.onCreate를 부르지 않는다(ctx가 없다) — 첫 updateBoss에서 한 번 부른다.
 * @param {BossDef} def
 * @param {CycleScaling} scaling
 * @param {{x:number, z:number, facing:number}} spawn
 * @returns {BossState}
 */
export function createBossState(def, scaling, spawn) {
  const hpMax = Math.round(def.hp * scaling.hpMul);
  /** @type {BossState} */
  const boss = {
    id: def.id,
    pos: { x: spawn.x, z: spawn.z },
    prevPos: { x: spawn.x, z: spawn.z },
    facing: spawn.facing,
    prevFacing: spawn.facing,
    y: 0,
    prevY: 0,
    radius: def.radius,
    hp: hpMax,
    hpMax,
    posture: 0,
    postureMax: def.postureMax,
    postureIdle: 0,
    postureGuard: false,
    phase: 1,
    pendingPhase: false,
    state: 'intro',
    stateTime: 0,
    stateDur: def.introDur,
    attack: null,
    lastAttacks: [],
    cooldowns: {},
    moveIntent: 'hold',
    strafeDir: 1,
    chaseTime: 0,
    invulnerable: true,
    dmgMul: scaling.dmgMul,
    speedMul: scaling.speedMul,
    stepDist: 0,
    ext: {},
  };
  ensureBossFw(boss);
  return boss;
}

/**
 * 한 틱 진행. ctx.bossDef · ctx.bossHooks를 쓴다. ctx.state.boss만 쓴다(+ ctx.spawn* · emit).
 * 매 틱 HP · 체간을 폴링한다(§8.7) — 디버그의 HP 변경과 투사체 패링이 이 경로로 반영된다.
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function updateBoss(ctx, dt) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  if (!boss || !def) return;
  const hooks = ctx.bossHooks || NO_HOOKS;
  const fw = ensureBossFw(boss);
  if (!fw.created) {
    fw.created = true;
    if (hooks.onCreate) hooks.onCreate(ctx);
  }

  for (const id in boss.cooldowns) {
    const c = boss.cooldowns[id] - dt;
    boss.cooldowns[id] = c > 0 ? c : 0;
  }

  // ── 폴링(§8.7). 사망이 다른 모든 전이보다 우선한다.
  let moved = false; // 이번 틱에 폴링이 상태를 바꿨으면 새 상태의 갱신은 다음 틱부터
  if (boss.state !== 'dead') {
    if (boss.hp <= 0) {
      die(ctx);
      moved = true;
    } else {
      reservePhase(boss, def);
      if (boss.posture >= boss.postureMax && canBreak(boss.state)) {
        enterGroggy(ctx);
        moved = true;
      } else {
        tickPosture(boss, def, dt);
      }
    }
  }

  if (!moved) {
    switch (boss.state) {
      case 'intro': {
        const before = boss.stateTime;
        boss.stateTime += dt;
        if (before < BOSS_AI.introRoarAt && boss.stateTime >= BOSS_AI.introRoarAt) emitRoar(ctx);
        if (boss.stateTime >= boss.stateDur - EPS) enterIdle(ctx);
        break;
      }
      case 'idle':
        if (boss.pendingPhase) {
          enterPhaseShift(ctx);
          break;
        }
        boss.stateTime += dt;
        // 뒤를 잡혔으면 돌아서지 않는다 — 그대로 등 뒤 공격을 고른다(enterIdle)
        if (!fw.rearHold) faceTarget(ctx, dt);
        if (boss.stateTime >= boss.stateDur - EPS) decide(ctx);
        break;
      case 'chase':
        if (boss.pendingPhase) {
          enterPhaseShift(ctx);
          break;
        }
        boss.stateTime += dt;
        boss.chaseTime += dt;
        updateChase(ctx, dt);
        if (boss.stateTime >= boss.stateDur - EPS) decide(ctx);
        break;
      case 'attack':
        updateAttack(ctx, dt);
        break;
      case 'parried':
      case 'recover':
        boss.stateTime += dt;
        if (boss.stateTime >= boss.stateDur - EPS) {
          if (boss.pendingPhase) enterPhaseShift(ctx);
          else enterIdle(ctx);
        }
        break;
      case 'groggy':
        // 처형 연출 동안은 그로기 타이머가 멈춘다(처형 타격이 닿기 전에 일어나지 않게)
        if (ctx.state.player.state !== 'execute') boss.stateTime += dt;
        if (boss.stateTime >= boss.stateDur - EPS) enterRecover(ctx);
        break;
      case 'executed':
        boss.stateTime += dt;
        if (boss.stateTime >= boss.stateDur - EPS) enterRecover(ctx);
        break;
      case 'phaseShift': {
        const before = boss.stateTime;
        boss.stateTime += dt;
        if (before < BOSS_AI.phaseRoarAt && boss.stateTime >= BOSS_AI.phaseRoarAt) {
          emitRoar(ctx);
          ctx.shake(BOSS_AI.phaseShake[0], BOSS_AI.phaseShake[1]);
        }
        if (boss.stateTime >= boss.stateDur - EPS) enterIdle(ctx);
        break;
      }
      default: // 'dead'
        boss.stateTime += dt;
        break;
    }
  }

  if (hooks.onTick) hooks.onTick(ctx, dt);
}

/**
 * 이번 틱에 살아 있는 보스 판정들(공격의 active 구간 · 각 hit의 t0..t1). damage에 boss.dmgMul이 곱해져 있다.
 * @param {SimCtx} ctx
 * @returns {OutgoingHit[]}
 */
export function getBossHits(ctx) {
  return collectHits(ctx);
}

/**
 * 예고 중인 표식(telegraph:true인 hit). 공격 시작부터 그 hit의 t0까지.
 * @param {SimCtx} ctx
 * @returns {TelegraphSrc[]}
 */
export function getBossTelegraphs(ctx) {
  return collectTelegraphs(ctx);
}

/**
 * 보스가 맞은 뒤 P2가 부른다. hp · posture는 이미 적용됐다. 사망 · 그로기 · 처형 반응 · 페이즈 예약을 처리.
 * 폴링(updateBoss)이 하는 일을 그 자리에서 즉시 할 뿐이다(중복 무해). 일반 피격으로는 경직되지 않는다(슈퍼아머).
 * @param {SimCtx} ctx
 * @param {DamageResult} result
 */
export function onBossDamaged(ctx, result) {
  const boss = ctx.state.boss;
  if (!boss || boss.state === 'dead') return;
  if (result.lethal || boss.hp <= 0) {
    die(ctx);
    return;
  }
  const def = ctx.bossDef;
  if (!def) return;
  reservePhase(boss, def);
  if (result.execute && result.outcome !== 'immune') {
    enterExecuted(ctx);
    return;
  }
  if ((result.postureBroken || boss.posture >= boss.postureMax) && canBreak(boss.state)) enterGroggy(ctx);
}

/**
 * 보스의 공격이 패링당한 뒤 P2가 부른다. posture는 이미 적용됐다. 공격 중단 → 'parried'(체간이 가득이면 'groggy').
 * @param {SimCtx} ctx
 * @param {DamageResult} result
 */
export function onBossParried(ctx, result) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  if (!boss || !def) return;
  // 같은 틱에 먼저 그로기 · 사망으로 넘어갔으면(맞교환) 그 상태가 우선한다
  if (boss.state !== 'attack' && boss.state !== 'idle' && boss.state !== 'chase' && boss.state !== 'parried') return;
  if (boss.posture >= boss.postureMax) {
    enterGroggy(ctx);
    return;
  }
  if (boss.attack) endAttack(ctx, true);
  setState(boss, 'parried', def.parriedDur, false);
}

// ───────────────────────────────────────────────────────────── 내부

/**
 * @param {BossState} boss
 * @param {BossStateName} name
 * @param {number} dur
 * @param {boolean} invulnerable
 */
function setState(boss, name, dur, invulnerable) {
  boss.state = name;
  boss.stateTime = 0;
  boss.stateDur = dur;
  boss.invulnerable = invulnerable;
  boss.moveIntent = 'hold';
}

/** 체간이 가득 찼을 때 그로기로 갈 수 있는 상태인가(§8.7 폴링). @param {BossStateName} state @returns {boolean} */
function canBreak(state) {
  return state !== 'groggy' && state !== 'executed' && state !== 'recover' && state !== 'phaseShift' && state !== 'dead';
}

/** @param {BossState} boss @param {BossDef} def */
function reservePhase(boss, def) {
  if (boss.phase === 1 && boss.hp <= boss.hpMax * def.phase2.hpFrac) boss.pendingPhase = true;
}

/**
 * 체간 감쇠: 마지막 체간 피해 뒤 postureDecayDelay가 지나면 초당 postureDecayRate. 그로기 중에는 가득인 채 고정.
 * @param {BossState} boss @param {BossDef} def @param {number} dt
 */
function tickPosture(boss, def, dt) {
  if (boss.state === 'groggy') {
    boss.posture = boss.postureMax;
    return;
  }
  boss.postureIdle += dt;
  if (boss.posture > 0 && boss.postureIdle >= def.postureDecayDelay) {
    const p = boss.posture - def.postureDecayRate * dt;
    boss.posture = p > 0 ? p : 0;
  }
}

/** 공격 밖의 포효 큐(인트로 · 페이즈 전환) — attackId '' · seq 0. @param {SimCtx} ctx */
function emitRoar(ctx) {
  const boss = ctx.state.boss;
  ctx.emit(EV.BOSS_CUE, {
    bossId: boss.id, attackId: '', seq: 0, cue: 'roar', style: ctx.bossDef.style,
    x: boss.pos.x, z: boss.pos.z, facing: boss.facing,
  });
}

/** @param {SimCtx} ctx @param {boolean} on */
function emitGroggy(ctx, on) {
  const boss = ctx.state.boss;
  ctx.emit(EV.BOSS_GROGGY, { bossId: boss.id, on, x: boss.pos.x, z: boss.pos.z });
}

/**
 * 다음 행동을 고르는 중(§8.6). 고민 시간은 같지만 서 있는 방식이 셋이다(W3):
 *   - 뒤를 잡혔다(등 뒤 전용 공격을 고를 수 있다) → rearChance 확률로, 돌아서지 않고 짧게(× rearThinkMul) 고민한 뒤 고른다.
 *   - 선호 거리 밖이다(kite 보스는 너무 가깝다) → 걸으면서 고민한다('chase' · stateDur = 고민 시간).
 *   - 그 밖 → 제자리에서 플레이어 쪽으로 돌며 고민한다('idle').
 * @param {SimCtx} ctx
 */
function enterIdle(ctx) {
  const boss = ctx.state.boss;
  const fw = ensureBossFw(boss);
  const think = thinkTime(ctx);
  fw.rearHold = false;
  if (canAttack(ctx)) {
    if (hasRearCandidate(ctx) && ctx.rng.chance(BOSS_AI.rearChance)) {
      fw.rearHold = true;
      setState(boss, 'idle', think * BOSS_AI.rearThinkMul, false);
      return;
    }
    if (thinkWalkIntent(ctx)) {
      setState(boss, 'chase', think, false);
      return;
    }
  }
  setState(boss, 'idle', think, false);
}

/**
 * §8.6 select(): 공격을 시작하거나, 후보가 없으면 chase로(이미 chase면 재선택 타이머만 되감는다).
 * @param {SimCtx} ctx
 */
function decide(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  ensureBossFw(boss).rearHold = false;
  if (!canAttack(ctx)) {
    // 싸울 상대가 없다 — 제자리에서 지켜본다
    if (boss.state !== 'idle') setState(boss, 'idle', 0, false);
    return;
  }
  const id = selectAttack(ctx);
  if (id) {
    startAttack(ctx, id, false, 0);
    return;
  }
  if (boss.chaseTime >= BOSS_AI.fallbackAfter - EPS && def.attacks[def.fallbackAttack]) {
    startAttack(ctx, def.fallbackAttack, false, 0); // 거리 · 쿨다운 무시
    return;
  }
  boss.state = 'chase';
  boss.stateTime = 0;
  boss.stateDur = BOSS_AI.reselect;
  boss.invulnerable = false;
}

/** @param {SimCtx} ctx @param {number} dt */
function updateAttack(ctx, dt) {
  const boss = ctx.state.boss;
  const atk = boss.attack;
  if (!atk) {
    enterIdle(ctx); // 손수 만든 상태 — 공격 없이 'attack'
    return;
  }
  const finished = stepAttack(ctx, dt);
  // 페이즈 전환이 예약돼 있으면 연속기보다 우선한다 — 후딜을 끝까지 치르고 포효로 간다
  if (atk.phase === 'recovery' && !boss.pendingPhase) {
    const next = pickChain(ctx);
    if (next) {
      /** @type {any} */
      const a = atk;
      const chainN = a.fw.chainN + 1;
      endAttack(ctx, false);
      startAttack(ctx, next, true, chainN);
      return;
    }
  }
  if (finished) {
    endAttack(ctx, false);
    if (boss.pendingPhase) enterPhaseShift(ctx);
    else enterIdle(ctx);
  }
}

/** 체간 붕괴: 공격 중단 → groggy · BOSS_GROGGY{on:true}. @param {SimCtx} ctx */
function enterGroggy(ctx) {
  const boss = ctx.state.boss;
  if (boss.attack) endAttack(ctx, true);
  boss.posture = boss.postureMax;
  setState(boss, 'groggy', ctx.bossDef.groggyDur, false);
  emitGroggy(ctx, true);
}

/** 처형 타격을 맞았다: executed(무적) → recover → idle. @param {SimCtx} ctx */
function enterExecuted(ctx) {
  const boss = ctx.state.boss;
  const wasGroggy = boss.state === 'groggy';
  if (boss.attack) endAttack(ctx, true);
  boss.posture = 0;
  boss.postureIdle = 0;
  setState(boss, 'executed', ctx.bossDef.executedDur, true);
  if (wasGroggy) emitGroggy(ctx, false);
}

/**
 * 그로기의 자연 종료 · 처형 뒤: 일어난다. 체간은 0에서 다시 시작.
 * (W5) 체간 잠금(postureGuard)을 건다 — 다음 공격의 판정이 시작될 때(bossTimeline.stepAttack) 풀린다.
 * 일어난 첫 틱에 맞춰 둔 큰 타격으로 보스가 공격 한 번 못 하고 다시 그로기가 되는 루프를 막는다(§8.7).
 * @param {SimCtx} ctx
 */
function enterRecover(ctx) {
  const boss = ctx.state.boss;
  const wasGroggy = boss.state === 'groggy';
  boss.posture = 0;
  boss.postureIdle = 0;
  boss.postureGuard = true;
  setState(boss, 'recover', ctx.bossDef.recoverDur, false);
  if (wasGroggy) emitGroggy(ctx, false);
}

/** 2페이즈 전환(§8.7): 무적 포효 · 체간 초기화 · 배율 갱신 · hooks.onPhaseChange. @param {SimCtx} ctx */
function enterPhaseShift(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const hooks = ctx.bossHooks || NO_HOOKS;
  boss.pendingPhase = false;
  boss.phase = 2;
  boss.posture = 0;
  boss.postureIdle = 0;
  boss.dmgMul = (ctx.scaling ? ctx.scaling.dmgMul : 1) * def.phase2.dmgMul;
  boss.speedMul = (ctx.scaling ? ctx.scaling.speedMul : 1) * def.phase2.speedMul;
  setState(boss, 'phaseShift', def.phaseShiftDur, true);
  ctx.emit(EV.BOSS_PHASE_CHANGED, { bossId: boss.id, phase: 2 });
  if (hooks.onPhaseChange) hooks.onPhaseChange(ctx, 2);
}

/** 사망: 즉시 dead(공격 중단 · 무적). 그로기 중이었다면 표식을 끈다. BOSS_DEFEATED는 P2가 낸다. @param {SimCtx} ctx */
function die(ctx) {
  const boss = ctx.state.boss;
  const wasGroggy = boss.state === 'groggy';
  if (boss.attack) endAttack(ctx, true);
  boss.pendingPhase = false;
  setState(boss, 'dead', 0, true);
  if (wasGroggy) emitGroggy(ctx, false);
}
