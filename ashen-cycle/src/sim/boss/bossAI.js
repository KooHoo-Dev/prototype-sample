// OWNER: P3 — 계약 §8.6 (AI 선택 · chase · 연속기)
// 패키지 내부 파일 — bossSim.js만 import 한다. 상수는 data/bossCommon.js의 BOSS_AI에서 읽는다.
// 보스 ID 분기 없음: 읽는 것은 ctx.bossDef · ctx.bossHooks · ctx.scaling뿐이다.
import { EV } from '../../core/events.js';
import { EPS } from '../../core/constants.js';
import { angleDiff, angleOf, turnToward } from '../../core/math2d.js';
import { BOSS_AI } from '../../data/bossCommon.js';
import { ensureBossFw } from './bossTimeline.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').BossHooks} BossHooks */

/** @type {BossHooks} */
const NO_HOOKS = Object.freeze({});

/**
 * §8.6 select() 0단계 — 공격해도 되는가. 플레이어가 죽었거나 교전 구간이 아니면 공격하지 않는다.
 * @param {SimCtx} ctx
 * @returns {boolean}
 */
export function canAttack(ctx) {
  const s = ctx.state;
  const p = s.player;
  if (!p || p.state === 'dead' || p.hp <= 0) return false;
  return !s.fight || s.fight.phase === 'fight';
}

/**
 * §8.6 select() 1~5단계 — 다음 공격 id. 후보가 없으면 null(호출자가 chase로 보낸다).
 * 상태를 바꾸지 않는다(난수만 쓴다).
 * @param {SimCtx} ctx
 * @returns {string|null}
 */
export function selectAttack(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const hooks = ctx.bossHooks || NO_HOOKS;
  const player = ctx.state.player;

  if (hooks.forceAttack) {
    const forced = hooks.forceAttack(ctx);
    if (forced != null && def.attacks[forced]) return forced;
  }

  const dx = player.pos.x - boss.pos.x;
  const dz = player.pos.z - boss.pos.z;
  const d = Math.hypot(dx, dz);
  const a = d > EPS ? Math.abs(angleDiff(boss.facing, angleOf(dx, dz))) : 0;
  const penalty = BOSS_AI.repeatPenalty;

  /** @type {{id:string, weight:number}[]} */
  const cands = [];
  for (const id in def.attacks) {
    const sel = def.attacks[id].sel;
    if (!sel) continue;
    if (boss.phase < (sel.minPhase === undefined ? 1 : sel.minPhase)) continue;
    if (sel.maxPhase !== undefined && boss.phase > sel.maxPhase) continue;
    if (boss.cooldowns[id] > 0) continue;
    if (d < sel.minRange || d > sel.maxRange) continue;
    if (sel.minAngle !== undefined && a < sel.minAngle) continue;
    if (sel.maxAngle !== undefined && a > sel.maxAngle) continue;
    let weight = sel.weight;
    for (let i = 0; i < penalty.length; i++) {
      if (boss.lastAttacks[i] === id) weight *= penalty[i];
    }
    cands.push({ id, weight });
  }
  if (hooks.adjustWeights) hooks.adjustWeights(ctx, cands);

  let total = 0;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.weight > 0 && def.attacks[c.id]) total += c.weight;
  }
  if (!(total > 0)) return null;
  let r = ctx.rng.next() * total;
  let last = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!(c.weight > 0) || !def.attacks[c.id]) continue;
    last = c.id;
    r -= c.weight;
    if (r < 0) return c.id;
  }
  return last; // 부동소수 끝자리 — 마지막 후보
}

/**
 * 연속기(§8.6): 후딜이 chain[i].at에 닿으면 순서대로 본다. 넘어갈 공격 id 또는 null.
 * 확률이 0인 항목은 순환 보너스를 받아도 열리지 않는다(그 페이즈에는 없는 연속기다).
 * @param {SimCtx} ctx
 * @returns {string|null}
 */
export function pickChain(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const atk = boss.attack;
  const ad = def.attacks[atk.id];
  /** @type {any} */
  const a = atk;
  const fw = a.fw;
  if (!ad || !fw || !ad.chain || fw.chainIdx >= ad.chain.length) return null;
  if (fw.chainN >= BOSS_AI.maxChain) return null;
  if (!canAttack(ctx)) return null;

  const recT = atk.t - atk.windup - atk.active;
  const p = ctx.state.player.pos;
  const d = Math.hypot(p.x - boss.pos.x, p.z - boss.pos.z);
  const bonus = ctx.scaling ? ctx.scaling.chainBonus : 0;
  while (fw.chainIdx < ad.chain.length) {
    const c = ad.chain[fw.chainIdx];
    if (recT < c.at - EPS) break;
    fw.chainIdx += 1;
    if (!def.attacks[c.next]) continue;
    if (c.maxRange !== undefined && d > c.maxRange) continue;
    const base = boss.phase === 2 ? c.chanceP2 : c.chance;
    if (!(base > 0)) continue;
    if (ctx.rng.chance(base + bonus)) return c.next;
  }
  return null;
}

/**
 * 뒤를 잡혔는가(W3): 지금 각도로 고를 수 있는 「등 뒤 전용」 공격(sel.minAngle > 0)이 하나라도 있는가.
 * 있으면 호출자가 돌아서지 않고 짧게 고민한 뒤 고른다 — 고민하는 동안 돌아서 버리면 그 공격은 영영 나오지 않는다.
 * 상태를 바꾸지 않고 난수도 쓰지 않는다.
 * @param {SimCtx} ctx
 * @returns {boolean}
 */
export function hasRearCandidate(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const player = ctx.state.player;
  const dx = player.pos.x - boss.pos.x;
  const dz = player.pos.z - boss.pos.z;
  const d = Math.hypot(dx, dz);
  if (!(d > EPS)) return false;
  const a = Math.abs(angleDiff(boss.facing, angleOf(dx, dz)));
  for (const id in def.attacks) {
    const sel = def.attacks[id].sel;
    if (!sel || !(sel.minAngle > 0) || a < sel.minAngle) continue;
    if (sel.maxAngle !== undefined && a > sel.maxAngle) continue;
    if (boss.phase < (sel.minPhase === undefined ? 1 : sel.minPhase)) continue;
    if (sel.maxPhase !== undefined && boss.phase > sel.maxPhase) continue;
    if (boss.cooldowns[id] > 0) continue;
    if (d < sel.minRange || d > sel.maxRange) continue;
    if (!(sel.weight > 0)) continue;
    return true;
  }
  return false;
}

/**
 * 고민하는 동안 걸어야 하는가(W3): 선호 거리 밖이면 다가가고(approach), kite 보스가 너무 가까우면 물러난다(retreat).
 * 그 밖에는 제자리에서 고민한다(null). 판단식은 updateChase의 moveIntent와 같다.
 * @param {SimCtx} ctx
 * @returns {'approach'|'retreat'|null}
 */
export function thinkWalkIntent(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  if (!(def.moveSpeed > 0)) return null;
  const p = ctx.state.player.pos;
  const d = Math.hypot(p.x - boss.pos.x, p.z - boss.pos.z);
  if (d > def.preferredRange + BOSS_AI.approachBand) return 'approach';
  if (def.kite && d < def.preferredRange * BOSS_AI.kiteNear) return 'retreat';
  return null;
}

/**
 * 공격 사이 고민 시간(초) = rng.range(think) × thinkMul(순환 × 페이즈).
 * @param {SimCtx} ctx
 * @returns {number}
 */
export function thinkTime(ctx) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const cycleMul = ctx.scaling ? ctx.scaling.thinkMul : 1;
  const mul = cycleMul * (boss.phase === 2 ? def.phase2.thinkMul : 1);
  return ctx.rng.range(def.think[0], def.think[1]) * mul;
}

/**
 * 플레이어 쪽으로 def.turnRate 회전(idle · chase).
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function faceTarget(ctx, dt) {
  const boss = ctx.state.boss;
  const p = ctx.state.player.pos;
  const dx = p.x - boss.pos.x;
  const dz = p.z - boss.pos.z;
  if (dx * dx + dz * dz <= EPS) return;
  boss.facing = turnToward(boss.facing, angleOf(dx, dz), ctx.bossDef.turnRate * dt);
}

/**
 * chase 한 틱: moveIntent를 정해 움직이고, 플레이어 쪽으로 돌고, stride마다 BOSS_STEP.
 * @param {SimCtx} ctx
 * @param {number} dt
 */
export function updateChase(ctx, dt) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const p = ctx.state.player.pos;
  const fw = ensureBossFw(boss);
  const dx = p.x - boss.pos.x;
  const dz = p.z - boss.pos.z;
  const d = Math.hypot(dx, dz);
  const speed = def.moveSpeed * (boss.phase === 2 ? def.phase2.moveSpeedMul : 1);

  if (d > def.preferredRange + BOSS_AI.approachBand) boss.moveIntent = 'approach';
  else if (def.kite && d < def.preferredRange * BOSS_AI.kiteNear) boss.moveIntent = 'retreat';
  else boss.moveIntent = 'strafe';

  const ox = boss.pos.x;
  const oz = boss.pos.z;
  if (d > EPS) {
    const ux = dx / d;
    const uz = dz / d;
    if (boss.moveIntent === 'approach') {
      boss.pos.x += ux * speed * dt;
      boss.pos.z += uz * speed * dt;
    } else if (boss.moveIntent === 'retreat') {
      boss.pos.x -= ux * speed * dt;
      boss.pos.z -= uz * speed * dt;
    } else {
      fw.strafeT -= dt;
      if (fw.strafeT <= 0) {
        boss.strafeDir = ctx.rng.chance(0.5) ? 1 : -1;
        fw.strafeT = ctx.rng.range(BOSS_AI.strafeFlip[0], BOSS_AI.strafeFlip[1]);
      }
      // 플레이어를 중심으로 한 원운동(거리는 그대로). 몸이 닿을 만큼 가까우면 각속도가 폭주하지 않게 반경으로 받친다.
      const ang = (boss.strafeDir * speed * BOSS_AI.strafeSpeedMul * dt) / Math.max(d, boss.radius);
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      // 플레이어 → 보스 벡터 (−dx, −dz)를 ang만큼 돌린다(§0.2: 각이 커지면 +Z에서 +X 쪽으로)
      const rx = -dx * c - dz * s;
      const rz = -dz * c + dx * s;
      boss.pos.x = p.x + rx;
      boss.pos.z = p.z + rz;
      // 경계 · 기둥에 닿으면 P2가 같은 틱에 되민다(§5.1 G2) — 벽을 따라 미끄러진다
    }
  }
  faceTarget(ctx, dt);

  if (def.stride > 0) {
    boss.stepDist += Math.hypot(boss.pos.x - ox, boss.pos.z - oz);
    if (boss.stepDist >= def.stride) {
      boss.stepDist -= def.stride;
      ctx.emit(EV.BOSS_STEP, { x: boss.pos.x, z: boss.pos.z, heavy: boss.moveIntent !== 'strafe' });
    }
  }
}
