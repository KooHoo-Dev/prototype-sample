// OWNER: P2 — 계약 §6.4 「sim/combat/damage.js」
// 판정 해소. 호출자는 GameSim(§5.1 I)뿐이지만 규칙은 모든 패키지가 안다.
// 공통: 레지스트리(hitId × 대상) 확인 → 셰이프를 resolveShape로 풀어 대상 원과 shapeHitsCircle → 등록 → 규칙 → HIT.
// hit.execute === true는 셰이프 검사를 건너뛴다(자동 명중).
import { EV } from '../../core/events.js';
import { EPS } from '../../core/constants.js';
import { angleDiff, angleOf } from '../../core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../../core/hitShapes.js';
import { COMBAT } from '../../data/combat.js';
import { PLAYER } from '../../data/player.js';
import { onBossDamaged, onBossParried } from '../boss/bossSim.js';
import { onPlayerDamaged, onPlayerDealtHit } from '../player/playerSim.js';
import { hasHit, markHit } from './hitRegistry.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').OutgoingHit} OutgoingHit */
/** @typedef {import('../../types.js').DamageResult} DamageResult */
/** @typedef {import('../../types.js').BossState} BossState */

/**
 * HIT payload = DamageResult 전 필드 + kind(무기 id · 투사체/장판 kind · 보스 attackId).
 * @param {SimCtx} ctx
 * @param {OutgoingHit} hit
 * @param {'player'|'boss'|'dummy'} target
 * @returns {DamageResult & {kind:string}}
 */
function makeResult(ctx, hit, target) {
  return {
    source: hit.source,
    target,
    outcome: 'hit',
    damage: 0,
    rawDamage: 0,
    posture: 0,
    staminaDamage: 0,
    crit: false,
    heavy: !!hit.heavy,
    execute: !!hit.execute,
    knockdown: false,
    guardBreak: false,
    postureBroken: false,
    lethal: false,
    x: 0,
    z: 0,
    y: 0,
    dir: 0,
    attackId: hit.attackId,
    hitId: hit.hitId,
    kind: hit.source === 'player' ? ctx.state.player.stats.weaponId : hit.attackId,
  };
}

/**
 * 충돌 지점(대상 원의 공격자 쪽 표면)과 힘의 방향(공격 원점 → 대상)을 채운다.
 * 원점이 대상 중심과 겹치면 공격의 기준 방향을 쓴다(NaN 금지).
 */
function setContact(result, hit, cx, cz, cr) {
  const dx = cx - hit.x;
  const dz = cz - hit.z;
  const d = Math.hypot(dx, dz);
  const dir = d > EPS ? angleOf(dx, dz) : hit.facing;
  result.dir = dir;
  result.x = cx - Math.sin(dir) * cr;
  result.z = cz - Math.cos(dir) * cr;
}

/**
 * 보스에 체간을 쌓는다(§6.4 「플레이어 → 보스」 규칙 4의 조건 · 상한). 무적 · 그로기 계열 상태에서는 쌓이지 않는다.
 * (W5) 그로기에서 일어난 보스는 다음 공격의 판정이 시작될 때까지 체간을 받지 않고(boss.postureGuard — §8.7),
 * 한 번에 쌓이는 양은 postureMax × COMBAT.postureHitCap까지다. 둘 다 「그로기 → 처형 → 일어나자마자 다시 그로기」
 * (보스가 한 번도 공격하지 못하는 무한 루프)를 막는다 — 완충 강공격 한 방이 체간 전부를 채우던 대검 + 기량에서 났다.
 * @param {BossState} boss
 * @param {number} amount
 * @returns {number} 실제로 쌓인 양
 */
function addBossPosture(boss, amount) {
  if (!(amount > 0) || boss.invulnerable || boss.postureGuard) return 0;
  switch (boss.state) {
    case 'groggy':
    case 'executed':
    case 'recover':
    case 'phaseShift':
    case 'dead':
      return 0;
    default:
  }
  const before = boss.posture;
  const capped = Math.min(amount, boss.postureMax * COMBAT.postureHitCap);
  boss.posture = Math.min(boss.postureMax, before + capped);
  boss.postureIdle = 0;
  return boss.posture - before;
}

/** 플레이어 타격의 히트스톱 · 흔들림(보스 · 허수아비 공통). */
function playerHitFeedback(ctx, hit) {
  const hs = hit.execute ? COMBAT.executeHitstop : hit.hitstop;
  if (hs > 0) ctx.requestHitstop(hs);
  const sh = hit.execute ? COMBAT.shake.execute : hit.heavy ? COMBAT.shake.playerHeavy : COMBAT.shake.playerLight;
  ctx.shake(sh[0], sh[1]);
}

/**
 * 플레이어 → 보스. 대상 원 = ctx.bossDef.bodyParts(어느 한 원에라도 닿으면 명중 — 여럿이면 플레이어에 가장 가까운 원).
 * 끝에서 onBossDamaged(ctx, result) [P3] → onPlayerDealtHit(ctx, result) [P1] → HIT.
 * 쓰러진 보스(hp 0)는 더 맞지 않는다(null).
 * @param {SimCtx} ctx
 * @param {OutgoingHit} hit
 * @param {{force?:boolean}} [opts] force(디버그): 셰이프 · 무적 · 치명 · 히트스톱 · onPlayerDealtHit을 건너뛴다
 * @returns {(DamageResult & {kind:string})|null} 레지스트리에 이미 있음/빗나감이면 null
 */
export function resolveHitOnBoss(ctx, hit, opts) {
  const state = ctx.state;
  const boss = state.boss;
  if (!boss || boss.hp <= 0) return null;
  if (hasHit(state, hit.hitId, 'boss')) return null;
  const force = opts?.force === true;
  const player = state.player;

  // 처형 · 디버그는 중심 원 기준.
  let cx = boss.pos.x;
  let cz = boss.pos.z;
  let cr = boss.radius;
  if (!hit.execute && !force) {
    const shape = resolveShape(hit.shapeDef, hit.x, hit.z, hit.facing);
    const parts = ctx.bossDef?.bodyParts;
    if (parts && parts.length > 0) {
      const s = Math.sin(boss.facing);
      const c = Math.cos(boss.facing);
      let bestGap = Infinity;
      for (let i = 0; i < parts.length; i++) {
        const px = boss.pos.x + parts[i].fwd * s;
        const pz = boss.pos.z + parts[i].fwd * c;
        if (!shapeHitsCircle(shape, px, pz, parts[i].r)) continue;
        const gap = Math.hypot(player.pos.x - px, player.pos.z - pz) - parts[i].r;
        if (gap < bestGap) {
          bestGap = gap;
          cx = px;
          cz = pz;
          cr = parts[i].r;
        }
      }
      if (bestGap === Infinity) return null;
    } else if (!shapeHitsCircle(shape, cx, cz, cr)) {
      return null;
    }
  }
  markHit(state, hit.hitId, 'boss');

  const result = makeResult(ctx, hit, 'boss');
  setContact(result, hit, cx, cz, cr);
  result.y = (ctx.bossDef ? ctx.bossDef.height : 0) * COMBAT.hitY.bossFrac;

  if (boss.invulnerable && !force) {
    // 튕기는 스파크만 — 보스에게는 아무 일도 일어나지 않았다.
    result.outcome = 'immune';
    ctx.emit(EV.HIT, result);
    return result;
  }

  const crit = !hit.execute && !force && (boss.state === 'parried' || boss.state === 'groggy');
  const raw = hit.damage * (crit ? player.stats.critMul : 1);
  const dmg = raw > 0 ? Math.round(raw) : 0;
  const dealt = Math.min(boss.hp, dmg);
  boss.hp -= dealt;
  result.crit = crit;
  result.rawDamage = raw > 0 ? raw : 0;
  result.damage = dealt;
  result.lethal = boss.hp <= 0;

  const fight = state.fight;
  if (fight) {
    fight.damageDealt = Math.min(boss.hpMax, fight.damageDealt + dealt);
    if (hit.execute) fight.executions += 1;
  }

  if (!hit.execute) {
    result.posture = addBossPosture(boss, hit.posture);
    result.postureBroken = result.posture > 0 && boss.posture >= boss.postureMax;
  }

  if (!force) playerHitFeedback(ctx, hit);
  onBossDamaged(ctx, result);
  if (!force) onPlayerDealtHit(ctx, result);
  ctx.emit(EV.HIT, result);
  return result;
}

/**
 * 플레이어 → 허수아비. 피해 = round(hit.damage). onPlayerDealtHit은 부르지 않는다.
 * @param {SimCtx} ctx
 * @param {OutgoingHit} hit
 * @returns {(DamageResult & {kind:string})|null}
 */
export function resolveHitOnDummy(ctx, hit) {
  const state = ctx.state;
  const dummy = state.dummy;
  if (!dummy) return null;
  if (hasHit(state, hit.hitId, 'dummy')) return null;
  if (!hit.execute) {
    const shape = resolveShape(hit.shapeDef, hit.x, hit.z, hit.facing);
    if (!shapeHitsCircle(shape, dummy.x, dummy.z, dummy.radius)) return null;
  }
  markHit(state, hit.hitId, 'dummy');

  const result = makeResult(ctx, hit, 'dummy');
  setContact(result, hit, dummy.x, dummy.z, dummy.radius);
  result.y = COMBAT.hitY.dummy;
  const dmg = hit.damage > 0 ? Math.round(hit.damage) : 0;
  result.rawDamage = hit.damage > 0 ? hit.damage : 0;
  result.damage = dmg;
  dummy.lastDamage = dmg;
  dummy.total += dmg;
  dummy.sinceHit = 0;

  playerHitFeedback(ctx, hit);
  ctx.emit(EV.HIT, result);
  return result;
}

/**
 * 보스 · 투사체 · 장판 → 플레이어. 무적 → dodge, 정면 패링 → parry, 정면 가드 → guard, 그 밖 → hit.
 * 끝에서 onPlayerDamaged(ctx, result) [P1](dodge 제외) → HIT.
 * 틱당 플레이어 피격은 최대 1회(§5.1 I) — 같은 틱에 hit · guard · parry가 이미 났으면 null(레지스트리 등록 없음).
 * @param {SimCtx} ctx
 * @param {OutgoingHit} hit
 * @returns {(DamageResult & {kind:string})|null}
 */
export function resolveHitOnPlayer(ctx, hit) {
  const state = ctx.state;
  const player = state.player;
  const boss = state.boss;
  const fight = state.fight;
  if (player.hp <= 0 || state.mode === 'town') return null;
  if (!fight || fight.phase !== 'fight' || !boss || boss.hp <= 0) return null;
  // 틱당 1회: 표식은 ctx에 둔다(상태가 아니다 — 같은 틱 안에서만 뜻이 있다).
  if (ctx._playerHitTick === state.tick) return null;
  if (hasHit(state, hit.hitId, 'player')) return null;
  // (W5) 발밑에서 솟는 장판인가: 원 · 캡슐 장판의 셰이프 안에 플레이어 중심이 있다 — 방향이 없는 공격이다(아래 2).
  // 띠 · 부채꼴처럼 원점에서 뻗어 나오는 셰이프는 해당하지 않는다.
  let underfoot = false;
  if (!hit.execute) {
    const shape = resolveShape(hit.shapeDef, hit.x, hit.z, hit.facing);
    if (!shapeHitsCircle(shape, player.pos.x, player.pos.z, player.radius)) return null;
    underfoot = hit.source === 'hazard' && (shape.type === 'circle' || shape.type === 'capsule')
      && shapeHitsCircle(shape, player.pos.x, player.pos.z, 0);
  }
  markHit(state, hit.hitId, 'player');

  const result = makeResult(ctx, hit, 'player');
  setContact(result, hit, player.pos.x, player.pos.z, player.radius);
  result.y = COMBAT.hitY.player;
  result.rawDamage = hit.damage > 0 ? hit.damage : 0;

  // 1. 무적 — 흘린 공격은 다시 맞지 않는다(등록은 이미 했다). HIT도 onPlayerDamaged도 없다.
  if (player.iframe || state.debug.godMode) {
    result.outcome = 'dodge';
    if (player.state === 'roll' || player.state === 'backstep') {
      ctx.emit(EV.PLAYER_DODGED, { attackId: hit.attackId, x: player.pos.x, z: player.pos.z });
    }
    return result;
  }

  // 2. 정면 판정 — 원점이 플레이어와 겹치면 정면으로 본다. 발밑에서 솟는 장판도 정면이다(W5):
  //    장판의 원점(= 원의 중심 · 불길 줄의 시작점)이 등 뒤에 있다는 것은 화면에서 읽을 수 없어, 가드가 무작위로 뚫려 보였다.
  //    밖에서 몸에 걸친 장판과 충격파 띠(원점이 분명하다)는 종전대로 원점 방향을 본다.
  const ox = hit.x - player.pos.x;
  const oz = hit.z - player.pos.z;
  const frontal = underfoot || Math.hypot(ox, oz) <= player.radius
    || Math.abs(angleDiff(player.facing, angleOf(ox, oz))) <= PLAYER.guard.arcHalf;
  const stats = player.stats;
  let dmg = 0;
  let shake;
  let hitstop;

  if (player.parryActive && hit.parryable && frontal) {
    // 3. 패링 — 피해 0 · 스태미나 0. 투사체는 체간만 쌓고 보스의 공격을 끊지 않는다.
    result.outcome = 'parry';
    const mul = hit.source === 'projectile' ? COMBAT.projectileParryPostureMul : 1;
    result.posture = addBossPosture(boss, stats.parryPosture * mul);
    result.postureBroken = result.posture > 0 && boss.posture >= boss.postureMax;
    fight.parries += 1;
    hitstop = COMBAT.parryHitstop;
    shake = COMBAT.shake.parry;
  } else if (player.guarding && hit.guardable && frontal) {
    // 4. 가드 — 순환 피해 배율은 스태미나에 싣지 않는다(페이즈 배율은 남는다).
    result.outcome = 'guard';
    dmg = Math.round(result.rawDamage * (1 - stats.guardReduction));
    const cycleMul = ctx.scaling && ctx.scaling.dmgMul > 0 ? ctx.scaling.dmgMul : 1;
    const drain = state.debug.noStamina ? 0 : (result.rawDamage / cycleMul) * stats.guardStaminaFactor;
    result.staminaDamage = drain;
    if (drain > 0) {
      player.stamina -= drain;
      if (player.stamina <= 0) {
        player.stamina = 0;
        result.guardBreak = true;
      }
    }
    hitstop = COMBAT.guardHitstop;
    shake = COMBAT.shake.guard;
  } else {
    // 5. 피격.
    dmg = Math.round(result.rawDamage);
    result.knockdown = !!hit.knockdown;
    hitstop = hit.hitstop > 0 ? hit.hitstop : result.knockdown ? COMBAT.bossKnockdownHitstop : COMBAT.bossHitHitstop;
    shake = result.knockdown ? COMBAT.shake.playerKnockdown : COMBAT.shake.playerHurt;
  }

  // 6. HP · 연출.
  const dealt = Math.min(player.hp, Math.max(0, dmg));
  player.hp -= dealt;
  result.damage = dealt;
  result.lethal = player.hp <= 0;
  fight.damageTaken += dealt;
  ctx._playerHitTick = state.tick;
  ctx.requestHitstop(hitstop);
  ctx.shake(shake[0], shake[1]);

  // 7. 반응.
  if (result.outcome === 'parry' && hit.source === 'boss') onBossParried(ctx, result);
  onPlayerDamaged(ctx, result);
  ctx.emit(EV.HIT, result);
  return result;
}
