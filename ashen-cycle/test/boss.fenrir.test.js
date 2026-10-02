// OWNER: P10 — 계약 §12.2 「boss.fenrir.test.js」
// 펜리르(§8.11)의 데이터 + 훅을 프레임워크 위에서 돌리고, 뷰(fenrirView.js)를 Node에서 three만으로(WebGL 없이) 돌린다.
// sim 쪽은 P1 · P2의 구현에 기대지 않는다 — 합성 플레이어(makeTestState의 리터럴)를 직접 움직이고, 판정은 core/hitShapes.js로 본다.
// 맨 끝의 한 묶음만 실제 GameSim으로 한 판을 돌려 본다(데이터가 P2의 판정 해소 · 장판과 맞물리는지).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EV, EventBus } from '../src/core/events.js';
import { DT, CUE_IDS, HAZARD_KINDS, TAU } from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { angleDiff, angleOf, dist } from '../src/core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../src/core/hitShapes.js';
import { circleOverlapsWorld, pushOutOfCircle, resolveCircleVsWorld } from '../src/core/collide.js';
import { PLAYER } from '../src/data/player.js';
import { COMBAT } from '../src/data/combat.js';
import { BOSS_AI } from '../src/data/bossCommon.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { FENRIR, FENRIR_EXT } from '../src/data/bosses/fenrir.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { fenrirHooks } from '../src/sim/boss/hooks/fenrir.js';
import { getBossHooks } from '../src/sim/boss/hooks/index.js';
import { createBossState, updateBoss, getBossHits, getBossTelegraphs, onBossDamaged } from '../src/sim/boss/bossSim.js';
import { selectAttack } from '../src/sim/boss/bossAI.js';
import { validateBossDef } from '../src/sim/boss/validateBossDef.js';
import { GameSim } from '../src/sim/GameSim.js';
import { bossReleaseT } from '../src/view/characters/pose.js';
import { CharacterLayer } from '../src/view/characters/CharacterLayer.js';
import { createBossView } from '../src/view/bosses/index.js';
import { FENRIR_POSES, createFenrirView } from '../src/view/bosses/fenrirView.js';
import { makeTestState, makeTestCtx, makeTestBoss, makeTestProfile, countEvents, assertFiniteDeep } from './helpers.js';

// ───────────────────────────────────────────────────────────── 도구

const ONE = { hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0 };
const ATTACK_IDS = ['bite', 'bite2', 'claw_swipe', 'tail_sweep', 'charge', 'pounce', 'frost_breath', 'backhop', 'ice_spikes'];
const P2_ONLY = ['ice_spikes'];
const POSE_KEYS = ['bite', 'claw', 'tail', 'charge', 'pounce', 'breath', 'hop', 'howl'];
const BOSS_STATES = ['intro', 'idle', 'chase', 'attack', 'parried', 'groggy', 'executed', 'recover', 'phaseShift', 'dead'];
const WALK = PLAYER.move.walkSpeed;
const SPRINT = PLAYER.move.sprintSpeed;
const ROLL_SPEED = PLAYER.roll.dist / PLAYER.roll.moveDur;
/** 얼음 기둥 5개(각 k × TAU/5) 사이를 보는 방향 — 돌진 · 백홉의 경로에 기둥이 없다 */
const OPEN = TAU / 10;

/**
 * 펜리르 한 판. 보스는 원점에서 facing(기본: 기둥 사이)을 보고 서 있고(state 'idle'), 플레이어는 (거리 d, 정면 기준 각 a)에 있다.
 * @param {{seed?:number, d?:number, a?:number, phase?:1|2, hooks?:any, intro?:boolean, facing?:number, scaling?:object, at?:{x:number, z:number}}} [o]
 */
function fight(o = {}) {
  const seed = o.seed ?? 1;
  const state = makeTestState({ bossDef: FENRIR, seed });
  const ctx = makeTestCtx(state, { bossDef: FENRIR, bossHooks: o.hooks ?? fenrirHooks, seed, scaling: o.scaling });
  const boss = state.boss;
  if (o.intro) {
    state.boss = createBossState(FENRIR, ONE, state.world.bossSpawn);
    state.player.pos = { x: state.world.playerSpawn.x, z: state.world.playerSpawn.z };
  } else {
    const at = o.at ?? { x: 0, z: 0 };
    const facing = o.facing ?? OPEN;
    boss.pos = { x: at.x, z: at.z };
    boss.prevPos = { x: at.x, z: at.z };
    boss.facing = facing;
    boss.prevFacing = facing;
    const d = o.d ?? 3;
    const a = o.a ?? 0;
    state.player.pos = { x: at.x + Math.sin(facing + a) * d, z: at.z + Math.cos(facing + a) * d };
  }
  if (o.phase === 2) toPhase2(state.boss);
  return { state, ctx, get boss() { return state.boss; }, player: state.player, stats: newStats() };
}

/** 2페이즈 상태를 직접 만든다(전환 연출 없이) — enterPhaseShift가 하는 일과 같은 값. */
function toPhase2(boss) {
  boss.phase = 2;
  boss.hp = Math.round(boss.hpMax * 0.45);
  boss.dmgMul = FENRIR.phase2.dmgMul;
  boss.speedMul = FENRIR.phase2.speedMul;
}

function newStats() {
  return { attacks: /** @type {Record<string, {n:number, hit:number}>} */ ({}), order: [], chase: 0, idle: 0, ticks: 0, hazSeen: 0, cur: null, touched: false, now: false };
}

/** 이번 틱에 플레이어 원과 겹치는 보스 판정(공격 셰이프 · 새로 소환된 장판)이 있는가. */
function overlapsPlayer(e) {
  const p = e.player;
  let touched = false;
  for (const h of getBossHits(e.ctx)) {
    if (shapeHitsCircle(resolveShape(h.shapeDef, h.x, h.z, h.facing), p.pos.x, p.pos.z, p.radius)) touched = true;
  }
  const hz = e.ctx.spawned.hazards;
  while (e.stats.hazSeen < hz.length) {
    const h = hz[e.stats.hazSeen++];
    if (shapeHitsCircle(h.shape, p.pos.x, p.pos.z, p.radius)) touched = true;
  }
  return touched;
}

/**
 * 한 틱: 합성 플레이어 이동 → updateBoss → (P2가 하는) 월드 충돌 · 몸통 밀어내기(bodyParts의 모든 원) → 통계.
 * @param {(e:any, i:number)=>void} [mover]
 */
function step(e, mover) {
  const b = e.boss;
  const p = e.player;
  const s = e.stats;
  b.prevPos.x = b.pos.x;
  b.prevPos.z = b.pos.z;
  b.prevFacing = b.facing;
  b.prevY = b.y;
  const ox = p.pos.x;
  const oz = p.pos.z;
  if (mover) mover(e, s.ticks);
  resolveCircleVsWorld(p.pos, p.radius, e.state.world);
  p.vel.x = (p.pos.x - ox) / DT;
  p.vel.z = (p.pos.z - oz) / DT;

  const n0 = e.ctx.events.length;
  updateBoss(e.ctx, DT);
  resolveCircleVsWorld(b.pos, b.radius, e.state.world);
  if (b.state !== 'dead') {
    for (const part of FENRIR.bodyParts) {
      pushOutOfCircle(p.pos, p.radius, b.pos.x + Math.sin(b.facing) * part.fwd, b.pos.z + Math.cos(b.facing) * part.fwd, part.r);
    }
  }
  resolveCircleVsWorld(p.pos, p.radius, e.state.world);

  for (let k = n0; k < e.ctx.events.length; k++) {
    const ev = e.ctx.events[k];
    if (ev.name !== EV.BOSS_ATTACK_WINDUP) continue;
    const id = ev.payload.attackId;
    s.cur = s.attacks[id] ?? (s.attacks[id] = { n: 0, hit: 0 });
    s.cur.n += 1;
    s.touched = false;
    s.order.push(id);
  }
  s.now = overlapsPlayer(e); // 이번 틱에 겹쳤는가(장판은 소환된 틱에 한 번 본다)
  if (s.now && s.cur && !s.touched) {
    s.touched = true;
    s.cur.hit += 1;
  }
  if (b.state === 'chase') s.chase += 1;
  if (b.state === 'idle') s.idle += 1;
  s.ticks += 1;
  e.state.tick += 1;
  e.state.events.length = 0;
}

function run(e, seconds, mover) {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(e, mover);
  assertFiniteDeep(e.state);
  return summary(e);
}

function summary(e) {
  const s = e.stats;
  const ids = Object.keys(s.attacks);
  const total = ids.reduce((n, k) => n + s.attacks[k].n, 0);
  const hits = ids.reduce((n, k) => n + s.attacks[k].hit, 0);
  const top = ids.reduce((m, k) => Math.max(m, s.attacks[k].n), 0);
  return {
    ids, total, hits, hitRate: total ? hits / total : 0, topShare: total ? top / total : 0,
    chaseShare: s.chase / Math.max(1, s.ticks), text: ids.map((k) => `${k}:${s.attacks[k].n}/${s.attacks[k].hit}`).join(' '),
  };
}

/** 공격 id를 강제로 시작해 끝(BOSS_ATTACK_END)까지 돌린다. 연속기는 잇지 않는다(다음 공격의 예고에서 멈춘다). */
function runAttack(e, id, mover, each) {
  const hooks = e.ctx.bossHooks;
  e.ctx.bossHooks = { ...hooks, forceAttack: () => id };
  // 지금 다른 공격 중이면 끝나기를 기다린다. forceAttack은 선택 시점(idle 끝 · chase의 재선택)에만 불린다
  const before = e.boss.attack;
  let guard = 0;
  do {
    step(e, mover);
    assert.ok(++guard < 600, `${id}가 시작되지 않는다`);
  } while (!e.boss.attack || e.boss.attack === before || e.boss.attack.id !== id);
  assert.equal(e.boss.state, 'attack');
  assert.equal(e.boss.attack.phase, 'windup');
  const atk = e.boss.attack;
  e.ctx.bossHooks = hooks;
  guard = 0;
  while (e.boss.attack === atk) {
    step(e, mover);
    if (each && e.boss.attack === atk) each(atk);
    assert.ok(++guard < 1200, `${id}가 끝나지 않는다`);
  }
  assertFiniteDeep(e.state);
  return atk;
}

/** 공격별로 서 있는 플레이어를 둘 자리(거리 · 각) */
function standFor(id) {
  const sel = FENRIR.attacks[id].sel;
  const d = sel ? Math.max(2.2, Math.min((sel.minRange + sel.maxRange) / 2, 12)) : 3;
  const a = sel && sel.minAngle ? Math.PI : 0;
  return { d, a };
}

// 합성 플레이어의 움직임 — 전부 사람이 낼 수 있는 속도다
const glue = (d, a) => (e) => {
  const b = e.boss;
  e.player.pos.x = b.pos.x + Math.sin(b.facing + a) * d;
  e.player.pos.z = b.pos.z + Math.cos(b.facing + a) * d;
};
/** 보스 둘레를 반경 r로 돈다(속력 v). 반경이 틀어지면 먼저 맞춘다. */
const orbit = (r, v) => (e) => {
  const b = e.boss;
  const p = e.player;
  const dx = p.pos.x - b.pos.x;
  const dz = p.pos.z - b.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const rad = Math.max(-v * DT, Math.min(v * DT, r - d));
  const tan = Math.sqrt(Math.max(0, (v * DT) ** 2 - rad * rad));
  p.pos.x += (dx / d) * rad + (dz / d) * tan;
  p.pos.z += (dz / d) * rad - (dx / d) * tan;
};
/** 보스와 거리 want를 유지하려고 앞뒤로 움직인다(속력 v). */
const keepDist = (want, v) => (e) => {
  const b = e.boss;
  const p = e.player;
  const dx = p.pos.x - b.pos.x;
  const dz = p.pos.z - b.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const rad = Math.max(-v * DT, Math.min(v * DT, want - d));
  p.pos.x += (dx / d) * rad;
  p.pos.z += (dz / d) * rad;
};
/** 플레이어가 보스 정면에서 벗어난 각(절댓값) */
const offFront = (e) => Math.abs(angleDiff(e.boss.facing, angleOf(e.player.pos.x - e.boss.pos.x, e.player.pos.z - e.boss.pos.z)));

// ───────────────────────────────────────────────────────────── 정의

describe('펜리르 정의(§8.11)', () => {
  test('validateBossDef 통과 · 머리 필드 · 레지스트리', () => {
    assert.deepEqual(validateBossDef(FENRIR), []);
    assert.equal(FENRIR.hp, 1700);   // (W3) 1900 → 1700
    assert.equal(FENRIR.reward, 2000);
    assert.equal(FENRIR.radius, 1.3);
    assert.equal(FENRIR.id, 'fenrir');
    assert.equal(FENRIR.rig, 'quadruped');
    assert.equal(FENRIR.arenaId, 'arena_fenrir');
    assert.equal(FENRIR.style, 'frost');
    assert.equal(FENRIR.fallbackAttack, 'charge');
    assert.equal(FENRIR.kite, false);
    assert.deepEqual(
      [FENRIR.postureMax, FENRIR.postureDecayDelay, FENRIR.postureDecayRate, FENRIR.height, FENRIR.moveSpeed, FENRIR.turnRate,
        FENRIR.preferredRange, FENRIR.stride, FENRIR.think, FENRIR.introDur, FENRIR.parriedDur, FENRIR.groggyDur, FENRIR.executedDur,
        FENRIR.recoverDur, FENRIR.phaseShiftDur],
      [120, 4.0, 8, 2.4, 5.5, 4.5, 4.0, 2.4, [0.40, 0.80], 1.6, 0.9, 4.5, 1.2, 0.8, 2.6],
    );
    assert.deepEqual(FENRIR.phase2, { hpFrac: 0.5, speedMul: 1.12, dmgMul: 1.12, thinkMul: 0.7, moveSpeedMul: 1.15 });
    assert.equal(getBossDef('fenrir'), FENRIR);
    assert.equal(getBossHooks('fenrir'), fenrirHooks);
    structuredClone(FENRIR); // 순수 데이터
    for (const [k, v] of Object.entries(FENRIR_EXT)) assert.ok(Number.isFinite(v), `FENRIR_EXT.${k}`);
  });

  test('bodyParts 3개 — 머리 · 몸통 · 엉덩이가 앞 2.9m ~ 뒤 2.7m를 덮는다', () => {
    assert.deepEqual(FENRIR.bodyParts, [{ fwd: 1.9, r: 1.0 }, { fwd: 0, r: 1.3 }, { fwd: -1.7, r: 1.0 }]);
    assert.equal(FENRIR.bodyParts.length, 3);
    const front = Math.max(...FENRIR.bodyParts.map((p) => p.fwd + p.r));
    const back = Math.min(...FENRIR.bodyParts.map((p) => p.fwd - p.r));
    assert.ok(Math.abs(front - 2.9) < 1e-9 && Math.abs(back + 2.7) < 1e-9);
    assert.equal(FENRIR.bodyParts.find((p) => p.fwd === 0).r, FENRIR.radius, '중심 원 = radius');
    // 이웃한 원끼리 겹쳐 몸 사이에 구멍이 없다
    const sorted = [...FENRIR.bodyParts].sort((a, b) => a.fwd - b.fwd);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].fwd - sorted[i - 1].fwd < sorted[i].r + sorted[i - 1].r);
  });

  test('공격 9종의 선택 · 타이밍이 §8.11 표와 같다', () => {
    assert.deepEqual(Object.keys(FENRIR.attacks).sort(), [...ATTACK_IDS].sort());
    // [pose, glow, minRange, maxRange, minAngle, maxAngle, weight, cooldown, minPhase, windup, active, recovery, turnRate, lockLead]
    const TABLE = {
      bite: ['bite', 'none', 0, 4.4, undefined, 0.9, 4, 0, undefined, 0.50, 0.12, 0.80, 6.0, 0.12],
      bite2: ['bite', 'none', null, null, null, null, null, null, null, 0.45, 0.12, 1.00, 6.0, 0.12],
      claw_swipe: ['claw', 'none', 0, 4.4, undefined, 1.4, 3, 2, undefined, 0.60, 0.15, 0.95, 5.0, 0.15],   // (W5) 선택 거리 4.8 → 4.4
      tail_sweep: ['tail', 'danger', 0, 4.5, 1.7, undefined, 6, 2, undefined, 0.65, 0.20, 1.00, 0, 0],       // (W5) 선택 거리 5.2 → 4.5
      charge: ['charge', 'danger', 7, 17, undefined, 0.6, 3, 5, undefined, 0.90, 0.55, 1.40, 4.0, 0.22],   // (W3) 선택 거리 18 → 17
      pounce: ['pounce', 'danger', 5, 13, undefined, 1.2, 3, 6, undefined, 0.80, 0.15, 1.20, 5.0, 0.30],
      frost_breath: ['breath', 'frost', 3, 9, undefined, 0.8, 2, 9, undefined, 1.10, 1.40, 1.30, 4.0, 0.20],   // (W3) 선택 거리 10 → 9
      backhop: ['hop', 'none', 0, 3.5, undefined, undefined, 1.5, 7, undefined, 0.45, 0.35, 0.30, 5.0, 0],
      ice_spikes: ['howl', 'frost', 0, 24, undefined, undefined, 2.5, 10, 2, 1.00, 0.30, 1.20, 3.0, 0.20],
    };
    for (const id of ATTACK_IDS) {
      const a = FENRIR.attacks[id];
      const s = a.sel;
      const row = [a.pose, a.glow, ...(s ? [s.minRange, s.maxRange, s.minAngle, s.maxAngle, s.weight, s.cooldown, s.minPhase] : Array(7).fill(null)),
        a.windup, a.active, a.recovery, a.track.turnRate, a.track.lockLead];
      assert.deepEqual(row, TABLE[id], id);
    }
    assert.equal(FENRIR.attacks.bite2.sel, null, 'bite2는 연속기 전용');
    assert.equal(FENRIR.attacks.frost_breath.track.activeTurnRate, 0.9);
    assert.deepEqual([...new Set(ATTACK_IDS.map((id) => FENRIR.attacks[id].pose))].sort(), [...POSE_KEYS].sort(), 'pose 8종');
    for (const id of ATTACK_IDS) {
      const a = FENRIR.attacks[id];
      if (a.sel) assert.equal(a.sel.minPhase === 2, P2_ONLY.includes(id), `${id}의 페이즈`);
    }
  });

  test('판정 · 이동 · 연속기가 §8.11 표와 같다', () => {
    const A = FENRIR.attacks;
    const hit = (id) => A[id].hits[0];
    assert.deepEqual(hit('bite'), { t0: 0, t1: 0.12, interval: 0, shape: { type: 'arc', r: 3.8, halfAngle: 0.7 }, damage: 24,
      guardable: true, parryable: true, knockdown: false, telegraph: false });
    assert.deepEqual({ ...hit('bite2'), damage: 0 }, { ...hit('bite'), damage: 0 });
    assert.equal(hit('bite2').damage, 22);
    assert.deepEqual(hit('claw_swipe').shape, { type: 'circle', r: 2.1, fwd: 1.3 });   // (W5) 부채꼴 r4.4 ±80° → 가슴 앞의 원
    assert.equal(hit('claw_swipe').damage, 26);
    assert.deepEqual(hit('tail_sweep').shape, { type: 'arc', r: 4.3, halfAngle: 1.75, dirOffset: Math.PI });   // (W5) r 5.2 → 4.3
    assert.deepEqual([hit('tail_sweep').damage, hit('tail_sweep').t1], [24, 0.20]);
    assert.deepEqual(hit('charge').shape, { type: 'capsule', fwd0: -0.5, fwd1: 2.6, r: 1.4 });
    assert.deepEqual(hit('charge').telegraphShape, { type: 'capsule', fwd0: 0, fwd1: 15.8, r: 1.4 });
    assert.deepEqual([hit('charge').damage, hit('charge').knockdown, hit('charge').telegraph, hit('charge').t1], [32, true, true, 0.55]);
    assert.deepEqual(hit('pounce').shape, { type: 'circle', r: 3.0, fwd: 1.8 });
    assert.deepEqual(hit('pounce').telegraphShape, { type: 'circle', r: 3.0 });
    assert.deepEqual([hit('pounce').damage, hit('pounce').knockdown, hit('pounce').telegraphAt], [34, true, 'aim']);
    assert.deepEqual(hit('frost_breath'), { t0: 0, t1: 1.40, interval: 0.35, shape: { type: 'arc', r: 9.0, rInner: 1.0, halfAngle: 0.5 }, damage: 11,
      guardable: true, parryable: false, knockdown: false, telegraph: true });
    assert.equal(A.backhop.hits.length, 0);
    assert.equal(A.ice_spikes.hits.length, 0);

    assert.deepEqual(A.bite.move, { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.8 });
    assert.deepEqual(A.bite2.move, { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 2.2 });
    assert.deepEqual(A.claw_swipe.move, { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.0 });
    assert.equal(A.tail_sweep.move, null);
    assert.deepEqual(A.charge.move, { kind: 'charge', t0: 0, t1: 0.55, dist: 13.2 });
    assert.deepEqual(A.pounce.move, { kind: 'leap', t0: -0.50, t1: 0, dist: 12, stopShort: 1.8, height: 2.4, aimLock: -0.30 });
    assert.deepEqual(A.backhop.move, { kind: 'hop', t0: 0, t1: 0.35, dist: 6, height: 1.2 });
    assert.equal(A.frost_breath.move, null);

    assert.deepEqual(A.bite.chain, [{ next: 'bite2', chance: 0.50, chanceP2: 0.70, at: 0.25, maxRange: 6 }]);
    assert.deepEqual(A.bite2.chain, [{ next: 'tail_sweep', chance: 0.25, chanceP2: 0.50, at: 0.30, maxRange: 4.5 }]);
    assert.deepEqual(A.claw_swipe.chain, [{ next: 'bite', chance: 0, chanceP2: 0.50, at: 0.30, maxRange: 6 }]);
    assert.deepEqual(A.backhop.chain, [
      { next: 'charge', chance: 0.40, chanceP2: 0.30, at: 0.10 },
      { next: 'frost_breath', chance: 0.30, chanceP2: 0.40, at: 0.10 },
    ]);
    for (const id of ['tail_sweep', 'charge', 'pounce', 'frost_breath', 'ice_spikes']) assert.deepEqual(A[id].chain, [], id);
  });

  test('glow 규칙: danger 3종 = 직접 타격이 패링 불가 · 평범한 근접은 패링 가능 · 브레스 · 가시 시전은 보스 대표 색', () => {
    const danger = ATTACK_IDS.filter((id) => FENRIR.attacks[id].glow === 'danger');
    assert.deepEqual(danger.sort(), ['charge', 'pounce', 'tail_sweep']);
    for (const id of ATTACK_IDS) {
      const a = FENRIR.attacks[id];
      for (const h of a.hits) {
        assert.equal(h.guardable, true, `${id}: 전부 가드 가능`);
        if (a.glow === 'danger') assert.equal(h.parryable, false, `${id}: danger는 패링 불가`);
        if (a.glow === 'none') assert.equal(h.parryable, true, `${id}: 평범한 근접은 패링 가능`);
      }
      if (a.glow === 'danger') assert.ok(a.hits.length > 0, `${id}: 직접 타격이 있다`);
    }
    assert.equal(FENRIR.attacks.frost_breath.glow, FENRIR.style);
    assert.equal(FENRIR.attacks.ice_spikes.glow, FENRIR.style);
  });

  test('큐 · 장판: 근접은 whoosh @−0.15 · 어휘 안 · 가시는 전부 ice_spike(frost) · 2페이즈 전용 표시', () => {
    for (const id of ['bite', 'bite2', 'claw_swipe', 'tail_sweep']) {
      const w = FENRIR.attacks[id].events.filter((ev) => ev.type === 'cue' && ev.cue === 'whoosh');
      assert.equal(w.length, 1, id);
      assert.equal(w[0].t, -0.15, id);
    }
    const cuesOf = (id) => FENRIR.attacks[id].events.filter((ev) => ev.type === 'cue').map((ev) => [ev.cue, ev.t]);
    assert.deepEqual(cuesOf('charge'), [['charge_start', 0]]);
    assert.deepEqual(cuesOf('pounce'), [['land', 0]]);
    assert.deepEqual(cuesOf('frost_breath'), [['breath_start', 0], ['breath_end', 1.40]]);
    assert.deepEqual(cuesOf('ice_spikes'), [['howl', -0.6], ['shatter', 0.9]]);
    assert.deepEqual(FENRIR.attacks.pounce.events[0].shake, [0.30, 0.35]);
    assert.deepEqual(FENRIR.attacks.ice_spikes.events[0].shake, [0.20, 0.50]);
    assert.deepEqual(FENRIR.attacks.frost_breath.events[0].params, { length: 9, halfAngle: 0.5, socket: 'mouth' });
    // 브레스 큐의 모양 = 판정 셰이프
    const breath = FENRIR.attacks.frost_breath.hits[0].shape;
    assert.equal(FENRIR.attacks.frost_breath.events[0].params.length, breath.r);
    assert.equal(FENRIR.attacks.frost_breath.events[0].params.halfAngle, breath.halfAngle);

    const hazards = [];
    for (const id of ATTACK_IDS) {
      for (const ev of FENRIR.attacks[id].events) {
        if (ev.type === 'cue') assert.ok(CUE_IDS.includes(ev.cue), `${id}: ${ev.cue}`);
        assert.notEqual(ev.type, 'projectile', '펜리르는 투사체를 쓰지 않는다');
        assert.notEqual(ev.type, 'teleport');
        if (ev.type === 'hazard') hazards.push([id, ev]);
      }
    }
    assert.deepEqual(hazards.map(([id]) => id), ['charge', 'pounce', 'frost_breath', 'ice_spikes']);
    for (const [id, ev] of hazards) {
      assert.ok(HAZARD_KINDS.includes(ev.hazard.kind));
      assert.equal(ev.hazard.kind, 'ice_spike', id);
      assert.equal(ev.hazard.style, 'frost', id);
      assert.equal(ev.hazard.guardable, true, id);
      assert.equal(ev.phase, id === 'ice_spikes' ? undefined : 2, `${id}: 2페이즈 전용`);
      assert.ok(ev.hazard.warn >= 0.5, `${id}: 경고 ${ev.hazard.warn}초 — 걸어 나올 시간`);
    }
    const [charge, pounce, breath2, spikes] = hazards.map(([, ev]) => ev);
    assert.deepEqual([charge.t, charge.place.mode, charge.hazard.shape, charge.hazard.warn, charge.hazard.active, charge.hazard.damage],
      [0.55, 'self', { type: 'capsule', fwd0: -13, fwd1: 0, r: 1.2 }, 0.5, 0.3, 20]);
    assert.deepEqual([pounce.t, pounce.place, pounce.count, pounce.hazard.shape, pounce.hazard.warn, pounce.hazard.active, pounce.hazard.damage],
      [0.05, { mode: 'ringAround', radius: 4.5 }, 6, { type: 'circle', r: 1.4 }, 0.6, 0.25, 20]);
    assert.deepEqual([breath2.t, breath2.place, breath2.count], [0.70, { mode: 'scatter', radius: 5 }, 4]);
    assert.deepEqual([spikes.t, spikes.place, spikes.count, spikes.hazard.shape, spikes.hazard.warn, spikes.hazard.active, spikes.hazard.damage],
      [0, { mode: 'scatter', radius: 7 }, 6, { type: 'circle', r: 1.8 }, 0.9, 0.25, 26]);
    assert.equal(breath2.hazard, spikes.hazard, '브레스 도중의 가시는 ice_spikes와 같은 spec');
  });
});

// ───────────────────────────────────────────────────────────── 공격 하나씩

describe('공격 전부를 forceAttack으로 끝까지', () => {
  /** 표(§8.11)의 가시 개수: [1페이즈, 2페이즈] */
  const HAZARDS = {
    bite: [0, 0], bite2: [0, 0], claw_swipe: [0, 0], tail_sweep: [0, 0], charge: [0, 1], pounce: [0, 6],
    frost_breath: [0, 4], backhop: [0, 0], ice_spikes: [6, 6],
  };

  for (const phase of [1, 2]) {
    for (const id of ATTACK_IDS) {
      test(`${id} (${phase}페이즈)`, () => {
        const { d, a } = standFor(id);
        const e = fight({ d, a, phase, seed: 3 });
        const def = FENRIR.attacks[id];
        let liveTicks = 0;
        let activeTicks = 0;
        const hitIds = new Set();
        const atk = runAttack(e, id, null, (k) => {
          const hs = getBossHits(e.ctx);
          if (k.phase === 'active') activeTicks += 1;
          if (hs.length) {
            liveTicks += 1;
            assert.equal(k.phase, 'active', '판정은 active 구간에만');
            for (const h of hs) {
              hitIds.add(h.hitId);
              assert.equal(h.source, 'boss');
              assert.equal(h.attackId, id);
              assert.ok(Math.abs(h.damage - def.hits[0].damage * e.boss.dmgMul) < 1e-9);
              assert.equal(h.heavy, def.hits[0].knockdown);
              assert.equal(h.posture, 0);
            }
          }
          for (const t of getBossTelegraphs(e.ctx)) {
            assert.ok(t.progress >= 0 && t.progress <= 1);
            assert.equal(t.style, def.glow === 'none' ? 'frost' : def.glow);
          }
        });
        if (def.hits.length) {
          assert.ok(liveTicks > 0, '히트가 있는 공격은 판정 구간에 getBossHits가 non-empty');
          const windows = def.hits.reduce((n, h) => n + (h.interval > 0 ? Math.ceil((h.t1 - h.t0) / h.interval - 1e-9) : 1), 0);
          assert.equal(hitIds.size, windows, '판정 창마다 hitId 하나');
        } else {
          assert.equal(liveTicks, 0);
        }
        assert.ok(activeTicks > 0);
        assert.equal(e.ctx.spawned.hazards.length, HAZARDS[id][phase - 1], '가시 개수');
        for (const h of e.ctx.spawned.hazards) {
          assert.equal(h.kind, 'ice_spike');
          assert.equal(h.style, 'frost');
          assert.ok(Math.abs(h.damage / e.boss.dmgMul - Math.round(h.damage / e.boss.dmgMul)) < 1e-9, 'damageMul = boss.dmgMul');
          assert.ok(Math.hypot(h.x, h.z) <= e.state.world.radius + 1e-9, '아레나 안');
        }
        assert.equal(e.ctx.spawned.projectiles.length, 0, '펜리르는 투사체를 쓰지 않는다');
        assert.equal(countEvents(e.ctx.events, EV.BOSS_TELEPORT), 0);
        const ends = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_END && x.payload.seq === atk.seq);
        assert.equal(ends.length, 1);
        assert.equal(ends[0].payload.interrupted, false);
        assert.equal(e.boss.y, 0);
        if (def.chain.length === 0) {
          const cues = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.seq === atk.seq).map((x) => x.payload.cue);
          assert.deepEqual(cues, def.events.filter((ev) => ev.type === 'cue').map((ev) => ev.cue), '큐가 표의 순서대로 한 번씩');
        }
        assert.ok(atk.windup >= BOSS_AI.minWindup);
        structuredClone(e.state);
      });
    }
  }

  test('frost_breath: 서 있으면 0.35초마다 한 번씩 네 번 맞는다(다단 히트) · 큐의 seq가 짝지어진다', () => {
    const e = fight({ d: 6 });
    const ids = [];
    const at = [];
    const atk = runAttack(e, 'frost_breath', null, (k) => {
      for (const h of getBossHits(e.ctx)) {
        if (!shapeHitsCircle(resolveShape(h.shapeDef, h.x, h.z, h.facing), e.player.pos.x, e.player.pos.z, e.player.radius)) continue;
        if (!ids.includes(h.hitId)) {
          ids.push(h.hitId);
          at.push(k.t - k.windup);
        }
      }
    });
    assert.equal(ids.length, 4, `다단 히트 ${ids.length}번`);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(at[i] - i * 0.35) < DT + 1e-9, `틱 ${i} tA = ${at[i]}`);
    assert.deepEqual([...ids].sort((x, y) => x - y), ids, 'hitId가 틱마다 새로 나온다');
    const cues = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE);
    assert.deepEqual(cues.map((x) => x.payload.cue), ['breath_start', 'breath_end']);
    for (const c of cues) assert.equal(c.payload.seq, atk.seq);
    assert.deepEqual(
      { length: cues[0].payload.length, halfAngle: cues[0].payload.halfAngle, socket: cues[0].payload.socket, style: cues[0].payload.style },
      { length: 9, halfAngle: 0.5, socket: 'mouth', style: 'frost' },
    );
    // 예고 내내 바닥 표식(부채꼴)이 보인다
    const e2 = fight({ d: 6 });
    let tele = 0;
    runAttack(e2, 'frost_breath', null, (k) => {
      const ts = getBossTelegraphs(e2.ctx);
      if (k.phase === 'windup') {
        assert.equal(ts.length, 1);
        assert.deepEqual(ts[0].shapeDef, FENRIR.attacks.frost_breath.hits[0].shape);
        tele += 1;
      } else assert.equal(ts.length, 0);
    });
    assert.ok(tele > 30);
  });

  test('frost_breath: 판정 중에는 느리게(0.9 rad/s) 따라 돈다 — 옆 · 뒤로 돌아 들어가면 맞지 않는다', () => {
    // 가까이(3.6m — 머리 원이 미는 범위 바로 밖)에서 걸어서 옆으로 돈다: 걷는 각속도(1.39 rad/s) > 추적(0.9 rad/s) → 부채꼴을 벗어난다
    const e = fight({ d: 3.6 });
    let touchedLate = 0;
    let turned = 0;
    let prevFacing = null;
    const atk = runAttack(e, 'frost_breath', orbit(3.6, WALK), (k) => {
      const tA = k.t - k.windup;
      if (k.phase === 'active') {
        if (prevFacing !== null) turned += Math.abs(angleDiff(prevFacing, e.boss.facing));
        prevFacing = e.boss.facing;
        if (tA > 0.9 && e.stats.now) touchedLate += 1;
      }
    });
    assert.ok(turned > 0.5, `판정 중에 따라 돈다(${turned.toFixed(2)} rad)`);
    assert.ok(turned <= 0.9 * atk.active + 1e-6, `추적은 0.9 rad/s를 넘지 않는다(${turned.toFixed(2)} rad)`);
    assert.equal(touchedLate, 0, '걸어서 옆으로 빠지면 브레스의 뒷부분은 맞지 않는다');
    assert.ok(offFront(e) > 0.8, `보스의 옆구리에 서 있다(반격 자리 — ${offFront(e).toFixed(2)} rad)`);
    // 방향이 고정된 순간 등 뒤에 있으면 한 틱도 맞지 않는다
    const e2 = fight({ d: 3 });
    let touched = 0;
    runAttack(e2, 'frost_breath', (x) => {
      const k = x.boss.attack;
      if (k && k.locked) glue(3, Math.PI)(x);
    }, () => { if (e2.stats.now) touched += 1; });
    assert.equal(touched, 0, '등 뒤에 닿는다');
    // 긴 후딜: 판정 1.4초 + 후딜 1.3초가 통째로 반격 시간이다
    assert.ok(atk.active + atk.recovery >= 2.6);
  });

  test('backhop: 판정 없이 뒤로 6m 뛴다(정점 1.2m) · 예고 내내 플레이어를 본다', () => {
    const e = fight({ d: 2.5 });
    const start = { ...e.boss.pos };
    const face = e.boss.facing;
    let peak = 0;
    let hits = 0;
    const atk = runAttack(e, 'backhop', null, (k) => {
      peak = Math.max(peak, e.boss.y);
      hits += getBossHits(e.ctx).length;
      if (k.phase !== 'active') assert.equal(e.boss.y, 0);
    });
    const moved = (e.boss.pos.x - start.x) * Math.sin(face) + (e.boss.pos.z - start.z) * Math.cos(face);
    assert.ok(moved < -5.9 && moved > -6.1, `뒤로 이동 ${moved.toFixed(2)}m`);
    assert.ok(Math.abs(peak - 1.2) < 0.02, `정점 ${peak}`);
    assert.equal(hits, 0);
    assert.equal(e.boss.y, 0);
    assert.ok(dist(e.boss.pos.x, e.boss.pos.z, e.player.pos.x, e.player.pos.z) > 8, '사거리 밖으로 빠진다');
    assert.ok(atk.windup >= 0.45 - 1e-9);
    // 옆으로 도는 플레이어를 예고 내내 따라 본다(lockLead 0) → 뛰는 방향 = 플레이어 반대
    const e2 = fight({ d: 2.5 });
    runAttack(e2, 'backhop', (x) => { if (x.boss.attack && x.boss.attack.phase === 'windup') orbit(2.5, WALK)(x); });
    assert.ok(offFront(e2) < 0.3, `뛴 뒤에도 플레이어가 정면에 있다(${offFront(e2).toFixed(2)})`);
  });

  test('backhop → charge · frost_breath 연속기: 빠진 뒤 곧바로 이어 친다(시드 80개)', () => {
    const next = { charge: 0, frost_breath: 0, none: 0 };
    for (let seed = 1; seed <= 80; seed++) {
      const e = fight({ d: 2.5, seed });
      runAttack(e, 'backhop');
      const order = e.stats.order;
      if (order.length > 1) {
        next[order[1]] += 1;
        assert.equal(e.boss.attack.chained, true);
        assert.equal(e.boss.attack.phase, 'windup', '이어진 공격도 예고부터 다시 시작한다');
      } else next.none += 1;
    }
    // 1페이즈: charge 0.40, 아니면 frost_breath 0.30 → 0.40 / 0.18 / 0.42
    assert.ok(next.charge >= 20 && next.charge <= 45, JSON.stringify(next));
    assert.ok(next.frost_breath >= 5 && next.frost_breath <= 26, JSON.stringify(next));
    assert.ok(next.none >= 20, JSON.stringify(next));
  });

  test('얼음 가시의 자리: ice_spikes는 플레이어 둘레 7m(첫 개는 발밑) · pounce는 착지 둘레 4.5m 고리 · charge는 달려온 궤적 · breath는 5m', () => {
    // ice_spikes
    let e = fight({ d: 9, phase: 2, seed: 4 });
    runAttack(e, 'ice_spikes');
    let hz = e.ctx.spawned.hazards;
    assert.equal(hz.length, 6);
    assert.ok(dist(hz[0].x, hz[0].z, e.player.pos.x, e.player.pos.z) < 1e-9, '첫 개는 플레이어 발밑');
    for (const h of hz) {
      assert.ok(dist(h.x, h.z, e.player.pos.x, e.player.pos.z) <= 7 + 1e-9);
      assert.equal(h.shape.type, 'circle');
      assert.equal(h.shape.r, 1.8);
      assert.equal(h.warn, 0.9);
      assert.ok(Math.abs(h.damage - 26 * e.boss.dmgMul) < 1e-9);
    }
    assert.ok(new Set(hz.map((h) => `${h.x.toFixed(3)},${h.z.toFixed(3)}`)).size === 6, '흩어진다');

    // pounce: 착지한 보스 둘레의 고리
    e = fight({ d: 9, phase: 2, seed: 4 });
    runAttack(e, 'pounce');
    hz = e.ctx.spawned.hazards;
    assert.equal(hz.length, 6);
    const b = e.boss;
    for (let k = 0; k < 6; k++) {
      assert.ok(Math.abs(dist(hz[k].x, hz[k].z, b.pos.x, b.pos.z) - 4.5) < 1e-6, '반경 4.5m');
      assert.equal(hz[k].shape.r, 1.4);
    }
    const angs = hz.map((h) => angleOf(h.x - b.pos.x, h.z - b.pos.z));
    for (let k = 1; k < 6; k++) assert.ok(Math.abs(Math.abs(angleDiff(angs[k - 1], angs[k])) - TAU / 6) < 1e-6, '균등 배치');
    // 고리의 가시는 착지 직격(원 r 3.0 @ fwd 1.8) 바깥을 두른다 — 착지를 굴러 나온 자리를 한 번 더 움직이게 한다
    assert.ok(4.5 - 1.4 > FENRIR.radius + PLAYER.radius, '보스 몸에 붙어 있으면 고리에 닿지 않는다');

    // charge: 끝난 자리에서 뒤로 13m의 캡슐 = 달려온 궤적
    e = fight({ d: 12, phase: 2, seed: 4 });
    const start = { ...e.boss.pos };
    runAttack(e, 'charge', (x) => { if (x.boss.attack && x.boss.attack.locked && x.stats.ticks % 1 === 0 && !x.sidestep) { x.sidestep = true; x.player.pos.x += 3; } });
    hz = e.ctx.spawned.hazards;
    assert.equal(hz.length, 1);
    assert.equal(hz[0].shape.type, 'capsule');
    assert.ok(dist(e.boss.pos.x, e.boss.pos.z, start.x, start.z) > 13, '13.2m를 달렸다');
    assert.ok(shapeHitsCircle(hz[0].shape, start.x, start.z, 0.01), '출발점이 가시 줄 안');
    assert.ok(shapeHitsCircle(hz[0].shape, (start.x + e.boss.pos.x) / 2, (start.z + e.boss.pos.z) / 2, 0.01), '중간이 가시 줄 안');
    assert.equal(hz[0].shape.r, 1.2);

    // frost_breath: 판정 도중(0.7초)에 4개
    e = fight({ d: 6, phase: 2, seed: 4 });
    const at = [];
    runAttack(e, 'frost_breath', null, (k) => { while (at.length < e.ctx.spawned.hazards.length) at.push(k.t - k.windup); });
    hz = e.ctx.spawned.hazards;
    assert.equal(hz.length, 4);
    for (const t of at) assert.ok(Math.abs(t - 0.70) < DT + 1e-9, `tA ${t}`);
    assert.ok(dist(hz[0].x, hz[0].z, e.player.pos.x, e.player.pos.z) < 1e-9);
    for (const h of hz) assert.ok(dist(h.x, h.z, e.player.pos.x, e.player.pos.z) <= 5 + 1e-9);

    // 1페이즈의 pounce · charge · frost_breath는 가시가 없다
    for (const id of ['pounce', 'charge', 'frost_breath']) {
      const p1 = fight({ ...standFor(id), phase: 1 });
      runAttack(p1, id);
      assert.equal(p1.ctx.spawned.hazards.length, 0, `1페이즈 ${id}`);
    }
  });

  test('pounce: 표식(착지 원)이 플레이어를 따라오다 0.30초 전에 멈추고, 그 자리에 떨어진다', () => {
    const e = fight({ d: 9 });
    let frozen = null;
    let peak = 0;
    const atk = runAttack(e, 'pounce', (x, i) => { x.player.pos.x += Math.cos(i / 20) * 0.1; }, (k) => {
      peak = Math.max(peak, e.boss.y);
      const tA = k.t - k.windup;
      const tele = getBossTelegraphs(e.ctx)[0];
      if (tA < -0.30 - 1e-9) {
        assert.ok(Math.abs(tele.x - e.player.pos.x) < 1e-9 && Math.abs(tele.z - e.player.pos.z) < 1e-9, '고정 전에는 따라다닌다');
        assert.equal(tele.style, 'danger');
      } else if (tA < -1e-9) {
        frozen = frozen ?? { x: tele.x, z: tele.z };
        assert.deepEqual({ x: tele.x, z: tele.z }, frozen, '고정 뒤에는 멈춘다');
      } else if (k.phase === 'active') {
        const h = getBossHits(e.ctx)[0];
        const s = resolveShape(h.shapeDef, h.x, h.z, h.facing);
        assert.ok(dist(s.x, s.z, frozen.x, frozen.z) < 0.3, '판정 원 = 표식 자리');
        assert.equal(e.boss.y, 0);
      }
    });
    assert.ok(frozen);
    assert.ok(peak > 2.3 && peak <= 2.4 + 1e-9, `도약 정점 ${peak}`);
    assert.ok(atk.locked);
    // 착지 원이 멈춘 뒤 판정 끝까지(0.30 + 0.15초)는 구르기 한 번(무적 0.37초 · 같은 hitId는 한 번만)으로 넘긴다
    assert.ok(0.30 <= PLAYER.roll.iEnd - PLAYER.roll.iStart);
  });
});

// ───────────────────────────────────────────────────────────── 2페이즈

describe('2페이즈', () => {
  test('HP 50%에서 전환 → 배율 · 포효의 순간에 shatter 큐 한 번 · 이후 얼음 가시 장판이 나온다', () => {
    const fresh = fight({ d: 3, seed: 5 });
    fenrirHooks.onCreate(fresh.ctx);
    assert.deepEqual(fresh.boss.ext, { sinceHop: FENRIR_EXT.hopGapAttacks, pressure: 0, lastHp: fresh.boss.hp, burst: false }, 'onCreate');
    const e = fight({ d: 3, seed: 5 });
    step(e);
    assert.deepEqual(Object.keys(e.boss.ext).sort(), ['burst', 'lastHp', 'pressure', 'sinceHop'], '첫 틱에 onCreate가 불린다');
    run(e, 3);
    e.boss.hp = FENRIR.hp / 2;
    onBossDamaged(e.ctx, {
      source: 'player', target: 'boss', outcome: 'hit', damage: 10, rawDamage: 10, posture: 0, staminaDamage: 0, crit: false,
      heavy: false, execute: false, knockdown: false, guardBreak: false, postureBroken: false, lethal: false,
      x: 0, z: 0, y: 1.3, dir: 0, attackId: 'light1', hitId: 999,
    });
    assert.equal(e.boss.pendingPhase, true);
    let guard = 0;
    while (e.boss.state !== 'phaseShift') {
      step(e);
      assert.ok(++guard < 600);
    }
    assert.equal(e.boss.phase, 2);
    assert.equal(e.boss.invulnerable, true);
    assert.ok(Math.abs(e.boss.dmgMul - 1.12) < 1e-9 && Math.abs(e.boss.speedMul - 1.12) < 1e-9);
    const bare = () => e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.attackId === '').map((x) => x.payload.cue);
    assert.deepEqual(bare(), [], '포효 전에는 큐가 없다');
    assert.equal(e.boss.ext.burst, false);
    run(e, BOSS_AI.phaseRoarAt + 0.05);
    assert.deepEqual(bare().sort(), ['roar', 'shatter'], '포효와 같은 틱에 얼음이 터진다');
    assert.equal(e.boss.ext.burst, true);
    const sh = e.ctx.events.find((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'shatter');
    assert.deepEqual({ ...sh.payload }, {
      bossId: 'fenrir', attackId: '', seq: 0, cue: 'shatter', style: 'frost', x: e.boss.pos.x, z: e.boss.pos.z, facing: e.boss.facing,
    });
    const roarIdx = e.ctx.events.findIndex((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar');
    assert.equal(e.ctx.events.indexOf(sh), roarIdx + 2, 'roar → 흔들림 → shatter(같은 틱)');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_PHASE_CHANGED), 1);
    run(e, FENRIR.phaseShiftDur);
    assert.notEqual(e.boss.state, 'phaseShift');
    assert.deepEqual(bare().sort(), ['roar', 'shatter'], '한 번만');

    // 2페이즈 90초: 신규 패턴(ice_spikes)과 가시 장판이 나온다
    const s = run(e, 90, keepDist(7, WALK));
    assert.ok(s.ids.includes('ice_spikes'), `ice_spikes가 나와야 한다 (${s.text})`);
    assert.ok(e.ctx.spawned.hazards.length >= 6, '얼음 가시 장판');
    assert.ok(e.ctx.spawned.hazards.every((h) => h.kind === 'ice_spike'));
  });

  test('2페이즈 전용 공격은 1페이즈에서 선택되지 않는다 — 1페이즈에는 장판이 하나도 없다', () => {
    for (const [d, a] of [[2, 0], [3.5, 0.5], [4.5, 0], [2.5, Math.PI], [6, 0], [9, 0], [12, 0.4], [16, 0], [21, 0]]) {
      for (let seed = 1; seed <= 3; seed++) {
        const e = fight({ d, a, seed });
        const s = run(e, 40, keepDist(d, WALK));
        for (const id of P2_ONLY) assert.equal(s.ids.includes(id), false, `1페이즈에 ${id} (d ${d})`);
        assert.equal(e.boss.phase, 1);
        assert.equal(e.ctx.spawned.hazards.length, 0, '1페이즈에는 장판이 없다');
      }
    }
  });

  test('claw_swipe → bite 연속기는 2페이즈에만 있다 — 순환 보너스(chainBonus)를 받아도 1페이즈에는 새지 않는다', () => {
    const count = (phase, scaling) => {
      let chained = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const e = fight({ d: 3, phase, seed, scaling });
        runAttack(e, 'claw_swipe');
        if (e.stats.order.length > 1) {
          chained += 1;
          assert.equal(e.stats.order[1], 'bite');
        }
      }
      return chained;
    };
    assert.equal(count(1, undefined), 0);
    assert.equal(count(1, { chainBonus: 0.3 }), 0, '확률 0인 항목에는 보너스가 붙지 않는다');
    const p2 = count(2, undefined);
    assert.ok(p2 >= 10 && p2 <= 30, `2페이즈 0.50 → 40번 중 ${p2}번`);
  });
});

// ───────────────────────────────────────────────────────────── 60초

describe('가만히 서 있는 플레이어를 상대로 60초', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`시드 ${seed}: 공격 4종 이상 · 플레이어 원과 겹치는 판정`, () => {
      const e = fight({ intro: true, seed });
      step(e);
      assert.equal(e.boss.state, 'intro');
      assert.equal(e.boss.invulnerable, true);
      const s = run(e, 60);
      assert.ok(s.ids.length >= 4, `공격 ${s.ids.length}종 (${s.text})`);
      assert.ok(s.hits >= 1, '겹치는 판정이 한 번 이상');
      assert.ok(s.total >= 18, `60초에 공격 ${s.total}번 — 주기가 짧다`);
      assert.ok(s.hitRate >= 0.6, `서 있는 상대에게는 대부분 닿는다 (${s.text})`);
      assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), countEvents(e.ctx.events, EV.BOSS_ATTACK_END) + (e.boss.attack ? 1 : 0));
      const seqs = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_WINDUP).map((x) => x.payload.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'seq는 1부터 하나씩');
      assert.ok(e.ctx.events.some((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar'), '인트로 포효');
      assert.ok(countEvents(e.ctx.events, EV.BOSS_STEP) > 0, '달려오는 발소리');
      assert.equal(e.boss.y, e.boss.attack && FENRIR.attacks[e.boss.attack.id].move?.height ? e.boss.y : 0);
      structuredClone(e.state);
    });
  }
});

// ───────────────────────────────────────────────────────────── AI · 훅

describe('AI 선택 분포 — 합성 플레이어를 거리 · 각도 격자에 두고 수백 번', () => {
  /** 한 자리(d, a)에서 n번 선택한다. 고를 때마다 그 공격의 실제 길이 + 평균 고민 시간만큼 쿨다운을 흘려보낸다. */
  function sample(d, a, phase, n = 400, seed = 9, prep) {
    const e = fight({ d, a, phase, seed });
    const boss = e.boss;
    if (prep) prep(e);
    const speed = phase === 2 ? FENRIR.phase2.speedMul : 1;
    const think = ((FENRIR.think[0] + FENRIR.think[1]) / 2) * (phase === 2 ? FENRIR.phase2.thinkMul : 1);
    /** @type {Record<string, number>} */
    const counts = {};
    let none = 0;
    let streak = 0;
    let wait = 0;
    for (let i = 0; i < n; i++) {
      const id = selectAttack(e.ctx);
      let elapsed = BOSS_AI.reselect;
      if (id) {
        const def = FENRIR.attacks[id];
        counts[id] = (counts[id] ?? 0) + 1;
        boss.cooldowns[id] = def.sel.cooldown;
        boss.lastAttacks.unshift(id);
        boss.lastAttacks.length = Math.min(2, boss.lastAttacks.length);
        fenrirHooks.onAttackStart(e.ctx, { id });
        elapsed = def.windup / speed + def.active + def.recovery / speed + think;
        streak = 0;
      } else {
        none += 1;
        streak += 1;
        wait = Math.max(wait, streak * BOSS_AI.reselect);
      }
      for (const k of Object.keys(boss.cooldowns)) boss.cooldowns[k] = Math.max(0, boss.cooldowns[k] - elapsed);
    }
    const ids = Object.keys(counts);
    const picks = n - none;
    const top = ids.reduce((m, k) => Math.max(m, counts[k]), 0);
    return { counts, ids, none: none / n, wait, topShare: picks ? top / picks : 0, text: JSON.stringify(counts) };
  }

  test('정면 근접: 물기 · 할퀴기 · 백홉이 섞인다(한 공격만 반복하지 않는다)', () => {
    for (const d of [1.8, 2.6, 3.4]) {
      for (const a of [0, 0.4, -0.7]) {
        for (const phase of [1, 2]) {
          const s = sample(d, a, phase);
          assert.equal(s.none, 0, `(${d}, ${a}): 항상 후보가 있다`);
          for (const id of ['bite', 'claw_swipe', 'backhop']) assert.ok((s.counts[id] ?? 0) > 0, `(${d}, ${a}) ${phase}페이즈: ${s.text}`);
          assert.ok(s.topShare <= 0.7, `(${d}, ${a}) 최다 ${s.topShare}: ${s.text}`);
          assert.equal(s.counts.bite2, undefined, '연속기 전용은 직접 고르지 않는다');
          if (phase === 1) assert.equal(s.counts.ice_spikes, undefined);
          else assert.ok(s.counts.ice_spikes > 0, s.text);
        }
      }
    }
  });

  test('등 뒤 · 옆 뒤(≥ 1.7 rad): 꼬리 쓸기가 가장 많이 나온다 · 물기 · 할퀴기는 고르지 않는다', () => {
    // (W5) 꼬리 쓸기의 선택 거리 5.2 → 4.5(판정 r 4.3 — 보이는 꼬리 끝)
    for (const d of [1.8, 3, 4.4]) {
      for (const a of [1.8, -2.4, Math.PI]) {
        for (const phase of [1, 2]) {
          const s = sample(d, a, phase);
          assert.ok((s.counts.tail_sweep ?? 0) > 0, `(${d}, ${a}) ${phase}페이즈: ${s.text}`);
          assert.equal(s.counts.bite, undefined, s.text);
          assert.equal(s.counts.claw_swipe, undefined, s.text);
          const top = Object.entries(s.counts).sort((x, y) => y[1] - x[1])[0][0];
          assert.equal(top, 'tail_sweep', `(${d}, ${a}) ${phase}페이즈: ${s.text}`);
        }
      }
    }
    // 꼬리 쓸기는 등 뒤의 플레이어에게 닿고, 정면의 플레이어에게는 닿지 않는다(정면 ±80°는 안전)
    for (const [a, want] of [[Math.PI, true], [2.0, true], [-1.6, true], [0, false], [1.2, false], [-1.2, false]]) {
      const e = fight({ d: 3.5, a });
      let touched = 0;
      let face = null;
      runAttack(e, 'tail_sweep', null, () => {
        if (e.stats.now) touched += 1;
        face = face ?? e.boss.facing;
        assert.equal(e.boss.facing, face, '꼬리 쓸기는 돌지 않는다(추적 없음)');
      });
      assert.equal(touched > 0, want, `각 ${a}`);
    }
  });

  test('거리별: 3~9m 브레스 · 5~13m 덮치기 · 7~17m 돌진 — 옆 · 뒤를 보고는 쓰지 않는다', () => {
    const p6 = sample(6, 0, 1);
    assert.deepEqual(Object.keys(p6.counts).sort(), ['frost_breath', 'pounce'], p6.text);
    for (const d of [8, 8.9]) {
      const s = sample(d, 0, 1);
      assert.deepEqual(Object.keys(s.counts).sort(), ['charge', 'frost_breath', 'pounce'], `d ${d}: ${s.text}`);
    }
    assert.deepEqual(Object.keys(sample(12, 0, 1).counts).sort(), ['charge', 'pounce']);
    assert.deepEqual(Object.keys(sample(16, 0, 1).counts), ['charge']);
    assert.deepEqual(Object.keys(sample(21, 0, 1).counts), [], '18m 밖에서는 먼저 달려온다');
    assert.deepEqual(Object.keys(sample(21, 0, 2).counts), ['ice_spikes'], '2페이즈: 멀리서도 가시를 부른다');
    assert.deepEqual(sample(10, 1.5, 1).ids, [], '각이 맞지 않으면 먼저 돈다');
  });

  test('훅: 백홉은 뒤에 빠질 자리가 있을 때만 — 벽을 등지거나 기둥이 뒤에 있으면 뛰지 않는다', () => {
    const R = getBossDef('fenrir').arenaId === 'arena_fenrir' ? 24 : 0;
    // 벽을 등진 보스(가장자리 3m 안): 플레이어는 안쪽
    const wall = sample(2.5, 0, 1, 300, 9, (e) => {
      const b = e.boss;
      b.pos = { x: Math.sin(OPEN) * (R - 3.5), z: Math.cos(OPEN) * (R - 3.5) };
      b.facing = OPEN + Math.PI; // 안쪽을 본다
      e.player.pos = { x: b.pos.x + Math.sin(b.facing) * 2.5, z: b.pos.z + Math.cos(b.facing) * 2.5 };
    });
    assert.equal(wall.counts.backhop, undefined, `벽을 등지고는 뛰지 않는다: ${wall.text}`);
    assert.ok(wall.counts.bite > 0 && wall.counts.claw_swipe > 0);
    // 기둥(0, 15)을 등진 보스
    const pillar = sample(2.5, 0, 1, 300, 9, (e) => {
      const b = e.boss;
      b.pos = { x: 0, z: 11 };
      b.facing = Math.PI;
      e.player.pos = { x: 0, z: 8.5 };
    });
    assert.equal(pillar.counts.backhop, undefined, `기둥을 등지고는 뛰지 않는다: ${pillar.text}`);
    // 트인 곳
    const open = sample(2.5, 0, 1, 300);
    assert.ok(open.counts.backhop > 0, open.text);
    // 실제로 뛴 자리는 언제나 아레나 안 · 기둥 밖이다(60초 × 시드 5)
    for (let seed = 1; seed <= 5; seed++) {
      const e = fight({ d: 2.5, seed, at: { x: Math.sin(OPEN) * 14, z: Math.cos(OPEN) * 14 } });
      let hops = 0;
      for (let i = 0; i < 3600; i++) {
        step(e, glue(2.5, 0));
        const k = e.boss.attack;
        if (k && k.id === 'backhop' && k.phase === 'recovery' && k.t - k.windup - k.active < DT + 1e-9) {
          hops += 1;
          assert.equal(circleOverlapsWorld(e.boss.pos.x, e.boss.pos.z, e.boss.radius, e.state.world), false);
        }
      }
      assert.ok(hops >= 1, `시드 ${seed}: 붙어 있는 플레이어에게서 한 번은 빠진다`);
    }
  });

  test('훅: 백홉 뒤에는 다른 공격을 hopGapAttacks번 한 뒤에야 다시 뛴다 · 얻어맞으면 더 자주 빠진다', () => {
    const e = fight({ d: 2.5 });
    step(e);
    const pick = (n) => {
      const c = {};
      for (let i = 0; i < n; i++) {
        const id = selectAttack(e.ctx);
        c[id] = (c[id] ?? 0) + 1;
      }
      return c;
    };
    assert.ok(pick(300).backhop > 0);
    fenrirHooks.onAttackStart(e.ctx, { id: 'backhop' });
    assert.equal(e.boss.ext.sinceHop, 0);
    assert.equal(pick(300).backhop, undefined, '방금 뛰었다');
    fenrirHooks.onAttackStart(e.ctx, { id: 'bite' });
    assert.equal(pick(300).backhop, undefined, '한 번으로는 모자라다');
    for (let i = 1; i < FENRIR_EXT.hopGapAttacks; i++) fenrirHooks.onAttackStart(e.ctx, { id: 'claw_swipe' });
    const calm = pick(2000).backhop;
    assert.ok(calm > 0);

    // 압박: HP가 깎이면 쌓이고(hpMax 대비), 시간이 지나면 식는다
    const before = e.boss.ext.pressure;
    assert.equal(before, 0);
    e.boss.hp -= Math.round(e.boss.hpMax * FENRIR_EXT.pressureFull);
    fenrirHooks.onTick(e.ctx, DT);
    assert.ok(e.boss.ext.pressure > FENRIR_EXT.pressureFull * 0.95, `압박 ${e.boss.ext.pressure}`);
    const hot = pick(2000).backhop;
    assert.ok(hot > calm * 1.6, `맞고 있으면 백홉이 는다: ${calm} → ${hot}`);
    for (let i = 0; i < 600; i++) fenrirHooks.onTick(e.ctx, DT);
    assert.ok(e.boss.ext.pressure < FENRIR_EXT.pressureFull * 0.05, '10초 뒤에는 식는다');
    fenrirHooks.onAttackStart(e.ctx, { id: 'backhop' });
    assert.equal(e.boss.ext.pressure, 0, '빠지면 압박을 턴다');
    // 가중치는 backhop만 고친다
    const cands = [{ id: 'bite', weight: 4 }, { id: 'claw_swipe', weight: 3 }];
    fenrirHooks.adjustWeights(e.ctx, cands);
    assert.deepEqual(cands, [{ id: 'bite', weight: 4 }, { id: 'claw_swipe', weight: 3 }]);
    assertFiniteDeep(e.state);
    structuredClone(e.state);
  });

  test('훅은 플레이어 상태 · boss.state/attack을 쓰지 않는다(얼린 플레이어로 30초)', () => {
    const e = fight({ d: 3, seed: 11 });
    const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
    e.state.player = freeze(structuredClone(e.state.player));
    for (let i = 0; i < 1800; i++) {
      updateBoss(e.ctx, DT);
      resolveCircleVsWorld(e.boss.pos, e.boss.radius, e.state.world);
      e.state.events.length = 0;
    }
    assert.ok(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP) > 5);
    // 훅만 따로 불러도 상태 기계는 그대로다
    const b = e.boss;
    const snap = JSON.stringify([b.state, b.attack, b.pos, b.facing, b.cooldowns]);
    fenrirHooks.onTick(e.ctx, DT);
    fenrirHooks.adjustWeights(e.ctx, [{ id: 'backhop', weight: 1.5 }]);
    fenrirHooks.onPhaseChange(e.ctx, 2);
    assert.equal(JSON.stringify([b.state, b.attack, b.pos, b.facing, b.cooldowns]), snap);
    // onCreate 없이 만든 상태(ext {})도 받는다
    const raw = fight({ d: 3, hooks: {} });
    fenrirHooks.adjustWeights(raw.ctx, [{ id: 'backhop', weight: 1.5 }]);
    fenrirHooks.onTick(raw.ctx, DT);
    assertFiniteDeep(raw.state);
  });
});

describe('움직이는 합성 플레이어 60초 — 손 놓고 있거나 헛스윙만 하지 않는다', () => {
  const cases = [
    // [이름, 시작 거리, 시작 각, 움직임, 최소 공격 수, 최소 명중률, 최소 가짓수]
    ['제자리', 3, 0, null, 18, 0.6, 4],
    // 등 뒤: 꼬리 쓸기가 답이다. 백홉(판정 없음)과 그 뒤의 돌진 · 브레스(플레이어 반대쪽을 본다)는 빗나간다
    ['등 뒤에 붙어 다닌다(2.5m)', 2.5, Math.PI, glue(2.5, Math.PI), 15, 0.55, 1],
    ['걸어서 맴돈다(반경 3.6m)', 3.6, 0, orbit(3.6, WALK), 15, 0.4, 3],
    ['중거리를 유지한다(9m)', 9, 0, keepDist(9, WALK), 12, 0.5, 3],
    // 달아나는 플레이어: 돌진 · 덮치기를 거리로 흘린다(거리 조절이 통한다) — 그래도 쉬지 않고 쫓아온다
    ['걸어서 계속 물러난다', 4, 0, keepDist(40, WALK), 10, 0.05, 3],
  ];
  for (const phase of [1, 2]) {
    for (const [name, d, a, mover, minAttacks, minHitRate, minKinds] of cases) {
      test(`${phase}페이즈 · ${name}`, () => {
        for (const seed of [1, 2, 3]) {
          const e = fight({ d, a, phase, seed });
          const s = run(e, 60, mover);
          const info = `시드 ${seed}: ${s.text} · chase ${s.chaseShare.toFixed(2)}`;
          assert.ok(s.total >= minAttacks, `공격 수 ${s.total} < ${minAttacks} — ${info}`);
          assert.ok(s.hitRate >= minHitRate, `명중률 ${s.hitRate.toFixed(2)} < ${minHitRate} — ${info}`);
          assert.ok(s.ids.length >= minKinds, `가짓수 ${s.ids.length} < ${minKinds} — ${info}`);
          assert.ok(s.chaseShare <= 0.5, `추격만 하고 있다 — ${info}`);
          if (name.startsWith('등 뒤')) {
            const t = e.stats.attacks.tail_sweep;
            assert.ok(t && t.n >= 10 && t.hit / t.n >= 0.9, `등 뒤에는 꼬리 쓸기가 닿는다 — ${info}`);
          }
          if (minKinds > 1) {
            let streak = 1;
            let worst = 1;
            for (let i = 1; i < e.stats.order.length; i++) {
              streak = e.stats.order[i] === e.stats.order[i - 1] ? streak + 1 : 1;
              worst = Math.max(worst, streak);
            }
            assert.ok(worst <= 4, `같은 공격 ${worst}연속 — ${e.stats.order.join(' ')}`);
          }
        }
      });
    }
  }

  test('발더와 다른 리듬: 주기가 짧고(60초에 25번 이상) 사거리 밖으로 자주 빠진다', () => {
    let total = 0;
    let hops = 0;
    for (const seed of [1, 2, 3, 4]) {
      const e = fight({ d: 3, seed });
      const s = run(e, 60, keepDist(3, WALK));
      total += s.total;
      hops += e.stats.attacks.backhop ? e.stats.attacks.backhop.n : 0;
    }
    assert.ok(total / 4 >= 25, `평균 ${total / 4}번`);
    assert.ok(hops >= 4, `붙어 다니는 플레이어에게서 4판에 ${hops}번 빠졌다`);
  });
});

describe('사거리 끝에서도 닿는다 — 고른 공격이 헛스윙이 아니다', () => {
  for (const id of ATTACK_IDS) {
    const def = FENRIR.attacks[id];
    if (def.hits.length === 0 && id !== 'ice_spikes') continue;
    test(id, () => {
      const a = def.sel && def.sel.minAngle ? Math.PI : 0;
      const phase = P2_ONLY.includes(id) ? 2 : 1;
      // 연속기 전용은 연속기의 거리 조건(앞 공격의 chain.maxRange)이 사거리다
      const lo = def.sel ? Math.max(1.8, def.sel.minRange) : 1.8;
      // (W3: 선택 거리 상한을 돌진 18 → 17 · 브레스 10 → 9로 줄였다 — 아래는 W2의 관찰이고 REACH는 그대로 안전한 값이다)
      // 표의 선택 거리 상한이 실제 사거리보다 0.6~0.8m 긴 공격이 둘 있다(NOTES-P10): 돌진 18 > 17.2(판정 마지막 틱의 자리 12.8 +
      // 앞 2.6 + 반경 1.4 + 플레이어 0.4), 브레스 10 > 9.0 + 0.4 = 9.4 — 그 끝자락의 서 있는 플레이어 앞에서 멈춘다. 여기서는 닿는 거리까지만 본다
      const REACH = { charge: 17.1, frost_breath: 9.3 };
      const hi = REACH[id] ?? (def.sel ? Math.min(def.sel.maxRange, 21) : FENRIR.attacks.bite.chain[0].maxRange);
      for (const d of [lo, (lo + hi) / 2, hi]) {
        const e = fight({ d, a, phase });
        let touched = 0;
        runAttack(e, id, null, () => { if (e.stats.now) touched += 1; });
        assert.ok(touched > 0, `${id}: 거리 ${d}의 서 있는 플레이어에게 닿지 않는다`);
      }
    });
  }

  test('연속기 bite → bite2 → tail_sweep: 이어진 물기는 다시 조준해 닿고, 꼬리 쓸기는 등 뒤로 구른 플레이어를 노린다', () => {
    let two = 0;
    let three = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const e = fight({ d: 3.6, seed });
      e.ctx.bossHooks = { ...fenrirHooks, forceAttack: () => 'bite' };
      step(e);
      e.ctx.bossHooks = fenrirHooks;
      // 예고 중에 옆으로 돌아 들어간다 — 연속기는 다시 추적해야 닿는다
      const mover = orbit(3.6, WALK);
      let guard = 0;
      while (e.boss.state === 'attack') {
        step(e, mover);
        assert.ok(++guard < 900);
      }
      const order = e.stats.order;
      assert.equal(order[0], 'bite');
      if (order.length > 1) {
        two += 1;
        assert.equal(order[1], 'bite2');
        assert.ok(e.stats.attacks.bite2.hit >= 1, `시드 ${seed}: bite2가 빗나갔다`);
        if (order.length > 2) {
          three += 1;
          assert.equal(order[2], 'tail_sweep');
        }
        assert.ok(order.length <= 3);
      }
    }
    assert.ok(two >= 18 && two <= 42, `1페이즈 bite → bite2 0.50 → 60번 중 ${two}번`);
    assert.ok(three >= 1 && three <= 20, `bite2 → tail_sweep 0.25 → ${two}번 중 ${three}번`);
    // 물기를 등 뒤로 굴러 피한 플레이어: 이어진 꼬리 쓸기가 닿는다
    const e = fight({ d: 3 });
    runAttack(e, 'bite2', (x) => { if (x.boss.attack && x.boss.attack.locked) glue(2.5, Math.PI)(x); });
    let touched = 0;
    runAttack(e, 'tail_sweep', glue(2.5, Math.PI), () => { if (e.stats.now) touched += 1; });
    assert.ok(touched > 0);
  });
});

// ───────────────────────────────────────────────────────────── 읽고 · 피하고 · 반격한다

describe('속도와 거리 조절 — 예고가 읽히고, 구르기 또는 위치로 피할 수 있고, 후딜에 반격할 수 있다', () => {
  test('모든 공격: 예고 ≥ 0.40초 · 판정 전에 방향 고정 · 후딜에는 판정도 회전도 이동도 없다', () => {
    for (const phase of [1, 2]) {
      for (const id of ATTACK_IDS) {
        const def = FENRIR.attacks[id];
        const { d, a } = standFor(id);
        const e = fight({ d, a, phase, seed: 2 });
        let lockedAt = null;
        let lockedFacing = null;
        let recoveryTicks = 0;
        let recoveryPos = null;
        // 플레이어가 계속 옆으로 걷는다 — 고정 전에는 따라 돌고, 고정 뒤에는 따라 돌지 않아야 한다(브레스의 판정 구간만 예외)
        const atk = runAttack(e, id, orbit(d, WALK), (k) => {
          const tA = k.t - k.windup;
          if (k.locked && lockedAt === null) {
            lockedAt = tA;
            lockedFacing = e.boss.facing;
          }
          if (k.locked && !(def.track.activeTurnRate && k.phase === 'active')) {
            if (k.phase === 'recovery' && def.track.activeTurnRate) lockedFacing = lockedFacing === 'r' ? lockedFacing : (recoveryTicks === 0 ? e.boss.facing : lockedFacing);
            assert.equal(e.boss.facing, lockedFacing, `${id}: 고정 뒤 회전`);
          }
          if (k.phase === 'recovery') {
            recoveryTicks += 1;
            assert.equal(getBossHits(e.ctx).length, 0, `${id}: 후딜에 판정이 남아 있다`);
            if (tA > def.active + 0.1) {
              recoveryPos = recoveryPos ?? { ...e.boss.pos };
              assert.deepEqual(e.boss.pos, recoveryPos, `${id}: 후딜에 움직인다`);
            }
          }
        });
        assert.ok(atk.windup >= 0.4, `${id}: 예고 ${atk.windup}`);
        assert.ok(lockedAt !== null && lockedAt >= -def.track.lockLead - 1e-9, `${id}: 고정이 너무 이르다 ${lockedAt}`);
        assert.ok(lockedAt < -def.track.lockLead + DT + 1e-9, `${id}: 고정 시각 ${lockedAt}`);
        // 반격 창: 피해를 주는 공격은 2페이즈의 배속을 받아도 후딜이 0.7초는 남는다(백홉은 판정이 없다)
        if (def.hits.length || id === 'ice_spikes') assert.ok(atk.recovery >= 0.7, `${id}: 후딜 ${atk.recovery}초`);
      }
    }
  });

  test('직접 타격의 판정 창은 구르기 무적 창보다 짧다 — 긴 것은 돌진(좁은 선)과 브레스(느린 추적)뿐이다', () => {
    const iframe = PLAYER.roll.iEnd - PLAYER.roll.iStart;
    const long = [];
    for (const id of ATTACK_IDS) {
      for (const h of FENRIR.attacks[id].hits) {
        if (h.t1 - h.t0 > iframe - 2 * DT) long.push(id);
      }
    }
    assert.deepEqual(long, ['charge', 'frost_breath']);
    assert.equal(FENRIR.attacks.charge.hits[0].shape.type, 'capsule');
    assert.ok(FENRIR.attacks.frost_breath.hits[0].interval > 0);
  });

  test('돌진: 방향이 고정된 뒤 옆으로 구르면 빗나가고, 플레이어를 지나쳐 등을 보인다(긴 후딜)', () => {
    for (const d of [8, 12, 17]) {
      // 가만히 있으면 맞는다
      const still = fight({ d });
      let hit = 0;
      runAttack(still, 'charge', null, () => { if (still.stats.now) hit += 1; });
      assert.ok(hit > 0, `charge @${d}: 서 있으면 맞아야 한다`);

      const e = fight({ d });
      let rolled = 0;
      let touched = 0;
      const atk = runAttack(e, 'charge', (x) => {
        const k = x.boss.attack;
        if (k && k.locked && rolled < PLAYER.roll.moveDur) {
          // 보스의 진행 방향에 수직으로 구른다
          x.player.pos.x += Math.cos(x.boss.facing) * ROLL_SPEED * DT;
          x.player.pos.z -= Math.sin(x.boss.facing) * ROLL_SPEED * DT;
          rolled += DT;
        }
      }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched, 0, `charge @${d}: 고정 뒤 옆 구르기로 피할 수 있어야 한다`);
      if (d <= 8) {
        assert.ok(offFront(e) > 2, `@${d}: 플레이어는 보스의 등 뒤쪽에 있다(${offFront(e).toFixed(2)})`);
      }
      assert.ok(atk.recovery >= 1.4 - 1e-9);
    }
    // 멀리서는(12m) 걸어서도 피한다: 방향이 고정된 뒤 옆으로 걸으면 닿기 전에 선 밖이다 — 거리가 곧 여유다
    const w = fight({ d: 12 });
    let touched = 0;
    let lockFacing = null;
    runAttack(w, 'charge', (x) => {
      const k = x.boss.attack;
      if (k && k.locked) {
        x.player.pos.x += Math.cos(x.boss.facing) * WALK * DT;
        x.player.pos.z -= Math.sin(x.boss.facing) * WALK * DT;
      }
    }, (k) => {
      if (w.stats.now) touched += 1;
      if (k.locked) {
        lockFacing = lockFacing ?? w.boss.facing;
        assert.equal(w.boss.facing, lockFacing, '고정된 뒤에는 따라 돌지 않는다');
      }
    });
    assert.equal(touched, 0, '고정된 뒤 옆으로 걸어 선 밖으로 나간다(12m)');
    // 고정을 0.15초 늦게 알아챈 사람은 걸어서는 못 피한다(7m) — 그때는 굴러야 한다
    const late = fight({ d: 7 });
    touched = 0;
    let since = 0;
    runAttack(late, 'charge', (x) => {
      const k = x.boss.attack;
      if (k && k.locked) {
        since += DT;
        if (since > 0.15) {
          x.player.pos.x += Math.cos(x.boss.facing) * WALK * DT;
          x.player.pos.z -= Math.sin(x.boss.facing) * WALK * DT;
        }
      }
    }, () => { if (late.stats.now) touched += 1; });
    assert.ok(touched > 0, '7m에서 늦게 걷기 시작하면 맞는다');
    assert.ok(SPRINT > WALK);
  });

  test('물기 · 할퀴기는 등 뒤를 치지 못한다 — 예고 중에 뒤로 굴러 들어가면 반격 자리다', () => {
    for (const id of ['bite', 'bite2', 'claw_swipe']) {
      const e = fight({ d: 2.6, phase: 2 });
      let touched = 0;
      runAttack(e, id, (x) => {
        const k = x.boss.attack;
        if (k && k.locked) glue(2.6, Math.PI)(x); // 무적 구르기로 몸을 통과한 셈
      }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched, 0, `${id}: 등 뒤에 닿는다`);
    }
    // 물기는 좁다(±40°): 옆구리(1.2 rad)에 붙어 있으면 닿지 않는다. 할퀴기(±80°)는 닿는다
    for (const [id, want] of [['bite', false], ['claw_swipe', true]]) {
      const e = fight({ d: 2.6 });
      let touched = 0;
      runAttack(e, id, (x) => { if (x.boss.attack && x.boss.attack.locked) glue(2.6, 1.2)(x); }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched > 0, want, id);
    }
  });

  test('물기는 거리로 피한다: 사거리 끝(4.4m)에서 예고를 보고 뒤로 걸으면 닿지 않는다', () => {
    const e = fight({ d: 4.4 });
    let touched = 0;
    runAttack(e, 'bite', keepDist(40, WALK), () => { if (e.stats.now) touched += 1; });
    assert.equal(touched, 0);
    // 붙어 있으면(2.5m) 뒤로 걸어서는 못 피한다 — 덤벼든다(lunge 1.8m)
    const near = fight({ d: 2.5 });
    touched = 0;
    runAttack(near, 'bite', keepDist(40, WALK), () => { if (near.stats.now) touched += 1; });
    assert.ok(touched > 0);
  });

  test('꼬리 쓸기: 예고(0.65초)를 보고 뒤로 걸어 나가면 닿지 않는다', () => {
    const e = fight({ d: 3, a: Math.PI });
    let touched = 0;
    runAttack(e, 'tail_sweep', keepDist(40, WALK), () => { if (e.stats.now) touched += 1; });
    assert.equal(touched, 0);
  });

  test('도약 덮치기: 표식이 멈춘 뒤 달려도 원을 벗어나지 못한다 — 구르기 무적이나 가드로 받는 공격이다', () => {
    const e = fight({ d: 9 });
    let touched = 0;
    runAttack(e, 'pounce', (x) => {
      const k = x.boss.attack;
      if (k && k.t - k.windup >= -0.30) {
        x.player.pos.x += Math.cos(x.boss.facing) * SPRINT * DT;
        x.player.pos.z -= Math.sin(x.boss.facing) * SPRINT * DT;
      }
    }, () => { if (e.stats.now) touched += 1; });
    assert.ok(touched > 0, '달리기만으로는 피하지 못한다(붉은 발광의 뜻)');
    assert.equal(FENRIR.attacks.pounce.hits[0].guardable, true);
    // 구르기: 표식이 멈춘 순간(−0.30초)부터 판정 직전(−0.05초)까지 언제 굴러도 무적 창이 판정 시작(tA 0)을 덮는다
    // (같은 hitId는 한 번만 판정하므로 판정 시작을 무적으로 넘기면 끝이다)
    const mv = FENRIR.attacks.pounce.move;
    for (const startAt of [mv.aimLock, -0.2, -0.05]) {
      assert.ok(startAt + PLAYER.roll.iStart <= 0 && startAt + PLAYER.roll.iEnd > 0, `tA ${startAt}에 구르면 무적이 착지를 덮는다`);
    }
    // 표식이 뜨자마자(고정 전) 구르면 따라온다 — 멈추는 것을 보고 굴러야 한다
    const early = fight({ d: 9 });
    let rolled = 0;
    let hitEarly = 0;
    runAttack(early, 'pounce', (x) => {
      const k = x.boss.attack;
      if (k && rolled < PLAYER.roll.moveDur) {
        x.player.pos.x += Math.cos(x.boss.facing) * ROLL_SPEED * DT;
        x.player.pos.z -= Math.sin(x.boss.facing) * ROLL_SPEED * DT;
        rolled += DT;
      }
    }, () => { if (early.stats.now) hitEarly += 1; });
    assert.ok(hitEarly > 0, '예고 시작에 구르면 착지점이 따라온다');
  });

  test('얼음 가시 장판은 경고 동안 걸어 나올 수 있다', () => {
    for (const id of ['ice_spikes', 'pounce', 'charge', 'frost_breath']) {
      for (const ev of FENRIR.attacks[id].events) {
        if (ev.type !== 'hazard') continue;
        const s = ev.hazard.shape;
        const out = s.r + PLAYER.radius; // 원의 중심(캡슐의 축)에서 밖까지
        assert.ok(WALK * ev.hazard.warn > out, `${id}: ${ev.hazard.warn}초에 ${out}m`);
        assert.ok(ev.hazard.active <= 0.3, `${id}: 솟는 시간은 짧다`);
        assert.equal(ev.hazard.interval, 0);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────── 뷰

describe('fenrirView — 사족 리그 · pose 8종 · 상태 10종 (Node · WebGL 없이)', () => {
  const worldPos = (obj) => new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  const assertFiniteTree = (root, label) => {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      for (const v of o.matrixWorld.elements) assert.ok(Number.isFinite(v), `${label}: ${o.name || o.type}의 행렬에 NaN`);
    });
  };
  const mkAttack = (id, phase, phaseT, seq = 1, over = {}) => {
    const ad = FENRIR.attacks[id];
    return { id, seq, pose: ad.pose, glow: ad.glow, phase, phaseT, t: 0, windup: ad.windup, active: ad.active, recovery: ad.recovery,
      locked: false, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [], ...over };
  };
  const mkInfo = () => ({ alpha: 1, dt: 1 / 60, time: 0, state: makeTestState({ bossDef: FENRIR }) });
  const at0 = { pos: { x: 0, z: 0 }, facing: 0 };
  /** 뷰를 그 상태로 수렴시킨다(블렌더가 따라올 때까지) */
  const settle = (view, boss, info, frames = 40) => {
    for (let i = 0; i < frames; i++) view.update(boss, info);
    view.root.updateMatrixWorld(true);
  };
  const PAWS = ['pawFL', 'pawFR', 'pawBL', 'pawBR'];

  test('FENRIR_POSES가 §8.11의 pose 8종을 가진다 · 데이터의 모든 공격이 포즈를 찾는다', () => {
    assert.deepEqual(Object.keys(FENRIR_POSES).sort(), [...POSE_KEYS].sort());
    for (const k of POSE_KEYS) {
      const set = FENRIR_POSES[k];
      assert.ok(set && set.windup && set.active && set.follow, `FENRIR_POSES.${k}`);
      for (const part of ['windup', 'active', 'follow']) {
        for (const tbl of [set[part].rot, set[part].pos ?? {}]) {
          for (const [j, v] of Object.entries(tbl)) {
            assert.equal(v.length, 3, `${k}.${part}.${j}`);
            for (const x of v) assert.ok(Number.isFinite(x), `${k}.${part}.${j}`);
          }
        }
      }
      assert.ok((set.holdAt ?? 0.6) > 0 && (set.holdAt ?? 0.6) <= 0.6, `${k}.holdAt`);
    }
    for (const id of ATTACK_IDS) assert.ok(FENRIR_POSES[FENRIR.attacks[id].pose], `${id}의 pose '${FENRIR.attacks[id].pose}'`);
    // 예고가 실루엣으로 읽히는 시간: 자세가 완성된 채 멈춰 있는 구간이 있다(holdAt < 1 − releaseT)
    for (const id of ATTACK_IDS) {
      const ad = FENRIR.attacks[id];
      const hold = FENRIR_POSES[ad.pose].holdAt ?? 0.6;
      assert.ok(hold <= 1 - bossReleaseT(ad.windup) + 1e-9, `${id}: 출발 전에 자세가 완성된다`);
    }
    // 도약: 뛰기 전(예고의 0.30초)에 웅크림이 완성된다. 울부짖음: howl 큐(@−0.6) 전에 고개가 올라간다
    assert.ok(FENRIR_POSES.pounce.holdAt * FENRIR.attacks.pounce.windup <= FENRIR.attacks.pounce.windup + FENRIR.attacks.pounce.move.t0 + 1e-9);
    assert.ok(FENRIR_POSES.howl.holdAt * FENRIR.attacks.ice_spikes.windup <= FENRIR.attacks.ice_spikes.windup - 0.6 + 1e-9);
  });

  test('사족 리그: 표준 관절 · 소켓 · 키 · 보이는 몸 = 맞는 몸(코끝 ≤ 2.9m · 엉덩이 ≥ −2.7m) · 레지스트리', () => {
    const view = createFenrirView();
    assert.equal(view.root.name, 'boss:fenrir');
    assert.equal(view.rig.height, FENRIR.height);
    for (const j of ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'shoulderFL', 'elbowFL', 'pawFL', 'shoulderFR', 'elbowFR', 'pawFR',
      'hipBL', 'kneeBL', 'pawBL', 'hipBR', 'kneeBR', 'pawBR', 'tail1', 'tail2', 'tail3']) {
      assert.ok(view.rig.joints[j] instanceof THREE.Object3D, `관절 ${j}`);
    }
    for (const s of ['mouth', 'head', 'chest', 'tailTip']) assert.ok(view.rig.sockets[s] instanceof THREE.Object3D, `소켓 ${s}`);
    assert.equal(view.rig.sockets.weaponTip, undefined, '사족에는 무기 소켓이 없다(보스 궤적 없음)');
    const info = mkInfo();
    const boss = makeTestBoss(FENRIR, { ...at0, state: 'idle' });
    settle(view, boss, info);
    const mouth = worldPos(view.rig.sockets.mouth);
    const front = Math.max(...FENRIR.bodyParts.map((p) => p.fwd + p.r));
    const back = Math.min(...FENRIR.bodyParts.map((p) => p.fwd - p.r));
    assert.ok(mouth.z > 2.2 && mouth.z <= front + 0.05, `코끝 z = ${mouth.z}`);
    assert.ok(worldPos(view.rig.joints.hips).z > back, `엉덩이 z = ${worldPos(view.rig.joints.hips).z}`);
    assert.ok(Math.abs(mouth.x) < 0.3, '플레이어가 정면 6m에 있으면 고개는 정면');
    // 낮게 깐 머리: 입은 어깨(키 2.4m)보다 한참 아래, 솟은 어깨(가슴 소켓 위쪽)가 가장 높다
    assert.ok(mouth.y < FENRIR.height * 0.75 && mouth.y > 0.8, `입 높이 ${mouth.y}`);
    assert.ok(worldPos(view.rig.sockets.head).y < FENRIR.height, `머리 높이 ${worldPos(view.rig.sockets.head).y}`);
    // 거대한 늑대: 플레이어(1.8m)보다 어깨가 높고 몸길이가 세 배
    assert.ok(view.rig.height > PLAYER.height * 1.3);
    assert.ok(mouth.z - worldPos(view.rig.sockets.tailTip).z > 5.6);
    view.dispose();
    const viaRegistry = createBossView('fenrir');
    assert.equal(viaRegistry.root.name, 'boss:fenrir');
    viaRegistry.dispose();
  });

  test('다리 IK: 서 있는 · 웅크린 · 덤비는 자세에서 디딘 발이 땅에 붙어 있다 · 걷지 않으면 발이 미끄러지지 않는다', () => {
    const view = createFenrirView();
    const info = mkInfo();
    const rest = 0.06 * FENRIR.height; // 리그의 rest 발목 높이
    const planted = (label, feet = PAWS) => {
      for (const k of feet) {
        const y = worldPos(view.rig.joints[k]).y;
        assert.ok(Math.abs(y - rest) < 0.03, `${label}: ${k} 높이 ${y.toFixed(3)}`);
      }
    };
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle' }), info);
    planted('idle');
    const idleFeet = PAWS.map((k) => worldPos(view.rig.joints[k]));
    let seq = 1;
    for (const [id, phase, pT, feet] of [
      ['bite', 'windup', 0.6, PAWS], ['bite', 'active', 1, PAWS], ['charge', 'windup', 0.2, PAWS], ['pounce', 'windup', 0.35, PAWS],
      ['pounce', 'active', 1, PAWS], ['frost_breath', 'active', 1, PAWS], ['backhop', 'windup', 0.7, PAWS], ['ice_spikes', 'active', 1, PAWS],
      ['claw_swipe', 'windup', 0.6, ['pawFL', 'pawBL', 'pawBR']], ['tail_sweep', 'windup', 0.6, ['pawFL', 'pawFR']],
    ]) {
      settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack(id, phase, pT, seq++) }), info);
      planted(`${id} ${phase}`, feet);
    }
    // 웅크려도(도약 예고) 발 자리는 그대로다 — 몸만 내려간다
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack('charge', 'windup', 0.2, seq++) }), info);
    const hindNow = ['pawBL', 'pawBR'].map((k) => worldPos(view.rig.joints[k]));
    assert.ok(hindNow[0].distanceTo(idleFeet[2]) < 0.25 && hindNow[1].distanceTo(idleFeet[3]) < 0.25, '뒷발은 제자리');
    // 할퀴기 예고: 오른 앞발이 어깨 위로 올라간다
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack('claw_swipe', 'windup', 0.6, seq++) }), info);
    assert.ok(worldPos(view.rig.joints.pawFR).y > 2.0, `쳐든 앞발 ${worldPos(view.rig.joints.pawFR).y}`);
    assert.ok(worldPos(view.rig.joints.pawFR).x < -0.8, '오른쪽(−X)으로');
    view.dispose();
  });

  test('실루엣 규칙: pose 8종의 예고 ↔ 판정에서 읽는 부위(입 · 앞발 · 꼬리 · 몸)가 1.5m 이상 움직인다', () => {
    const view = createFenrirView();
    const info = mkInfo();
    /** pose → [공격 id, 읽는 부위, 최소 이동(m)] */
    const READ = {
      bite: ['bite', (v) => worldPos(v.rig.sockets.mouth), 2.0],
      claw: ['claw_swipe', (v) => worldPos(v.rig.joints.pawFR), 2.5],
      tail: ['tail_sweep', (v) => worldPos(v.rig.sockets.tailTip), 4.0],
      charge: ['charge', (v) => worldPos(v.rig.sockets.tailTip), 1.5],
      pounce: ['pounce', (v) => worldPos(v.rig.sockets.chest), 0.5],
      breath: ['frost_breath', (v) => worldPos(v.rig.sockets.mouth), 2.5],
      hop: ['backhop', (v) => worldPos(v.rig.sockets.head), 0.6],
      howl: ['ice_spikes', (v) => worldPos(v.rig.sockets.mouth), 3.0],
    };
    let seq = 1;
    for (const key of POSE_KEYS) {
      const [id, read, min] = READ[key];
      const ad = FENRIR.attacks[id];
      const hold = FENRIR_POSES[key].holdAt ?? 0.6;
      settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack(id, 'windup', hold, seq++) }), info);
      const w = read(view);
      const idle = (() => { settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle' }), info); return read(view); })();
      settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack(id, 'active', 1, seq++) }), info);
      const a = read(view);
      assert.ok(w.distanceTo(a) >= min, `${key}: 예고 ↔ 판정 ${w.distanceTo(a).toFixed(2)}m < ${min}`);
      assert.ok(w.distanceTo(idle) >= 0.25, `${key}: 대기 ↔ 예고 ${w.distanceTo(idle).toFixed(2)}m — 예고가 대기와 구분된다`);
      assert.ok(ad.windup > 0);
    }
    // 예고의 방향이 다르다: 물기 = 머리를 높이 든다 · 브레스 = 더 높이 젖힌다 · 돌진 = 머리를 땅에 붙인다 · 도약 = 몸 전체가 낮다
    const mouthY = (id, phase, pT) => {
      settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack(id, phase, pT, seq++) }), info);
      return worldPos(view.rig.sockets.mouth).y;
    };
    const idleY = (() => { settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle' }), info); return worldPos(view.rig.sockets.mouth).y; })();
    assert.ok(mouthY('bite', 'windup', 0.5) > idleY + 0.8, '물기 예고: 머리를 든다');
    assert.ok(mouthY('frost_breath', 'windup', 0.5) > idleY + 1.5, '브레스 예고: 고개를 젖힌다');
    assert.ok(mouthY('ice_spikes', 'windup', 0.4) > idleY + 2.0, '울부짖음: 하늘을 본다');
    assert.ok(mouthY('charge', 'windup', 0.6) < idleY - 0.3, '돌진 예고: 가슴을 땅에 붙인다');
    assert.ok(mouthY('frost_breath', 'active', 1) < idleY + 0.2, '브레스 판정: 머리를 낮게 내민다');
    // 브레스 판정 중 입 소켓(= fx의 원점)은 정면 · 사람 가슴~머리 높이
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack('frost_breath', 'active', 0.8, seq++) }), info);
    const m = worldPos(view.rig.sockets.mouth);
    assert.ok(Math.abs(m.x) < 0.25 && m.z > 2.5 && m.y > 0.6 && m.y < 1.9, `브레스 원점 ${m.toArray().map((x) => x.toFixed(2))}`);
    view.dispose();
  });

  test('보스 공통 releaseT 규칙: 판정 0.18초 전에 몸이 출발하고, 예고 끝 = 판정 시작(순간 이동 없음)', () => {
    const view = createFenrirView();
    const info = { ...mkInfo(), dt: 0.2 };
    const mouthOf = (phase, phaseT) => {
      const b = makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack('bite', phase, phaseT, 1, { locked: true }) });
      for (let i = 0; i < 20; i++) view.update(b, info);
      view.root.updateMatrixWorld(true);
      return worldPos(view.rig.sockets.mouth);
    };
    const releaseT = bossReleaseT(FENRIR.attacks.bite.windup);
    const hold = mouthOf('windup', 1 - releaseT);
    const end = mouthOf('windup', 1);
    const start = mouthOf('active', 0);
    assert.ok(hold.distanceTo(end) > 0.4, `예고 끝에 머리가 움직인다(${hold.distanceTo(end).toFixed(2)}m)`);
    assert.ok(end.distanceTo(start) < 0.25, `예고 끝 = 판정 시작: ${end.distanceTo(start).toFixed(3)}m`);
    assert.ok(mouthOf('active', 1).distanceTo(end) > 1, '판정 구간에 나머지 궤적을 간다');
    // 무는 입: 출발 구간에 벌어지고 판정 끝에는 닫힌다
    const jaw = (phase, phaseT) => { mouthOf(phase, phaseT); return view.rig.joints.jaw.rotation.x; };
    assert.ok(jaw('windup', 1) > jaw('windup', 1 - releaseT) + 0.4, '출발 구간에 입이 벌어진다');
    assert.ok(jaw('active', 1) < 0.15, '판정 끝에는 닫힌다');
    view.dispose();
  });

  test('상태 10종 × pose 8종 × 구간: NaN 0 · 상태를 고치지 않는다 · 모르는 pose는 첫 포즈로 대체(경고 한 번)', () => {
    const view = createFenrirView();
    const info = mkInfo();
    const run1 = (over, label) => {
      const b = makeTestBoss(FENRIR, over);
      const before = JSON.stringify(b);
      const st = JSON.stringify(info.state);
      for (const dt of [1 / 60, 0, 0.1, 1 / 60]) {
        info.dt = dt;
        view.update(b, info);
      }
      assert.equal(JSON.stringify(b), before, '뷰는 보스 상태를 고치지 않는다');
      assert.equal(JSON.stringify(info.state), st, '뷰는 게임 상태를 고치지 않는다');
      assertFiniteTree(view.root, label);
    };
    const durs = { intro: FENRIR.introDur, parried: FENRIR.parriedDur, groggy: FENRIR.groggyDur, executed: FENRIR.executedDur,
      recover: FENRIR.recoverDur, phaseShift: FENRIR.phaseShiftDur };
    for (const st of BOSS_STATES) {
      if (st === 'attack') continue;
      for (const frac of [0, 0.1, 0.3, 0.6, 1, 1.4]) {
        const dur = durs[st] ?? 0;
        run1({ state: st, stateDur: dur, stateTime: (dur || 2.2) * frac, phase: frac > 0.5 ? 2 : 1,
          prevPos: st === 'chase' ? { x: 0.05, z: 5.92 } : { x: 0, z: 6 }, prevFacing: st === 'idle' ? Math.PI - 0.07 : Math.PI }, `fenrir ${st} ${frac}`);
      }
    }
    let seq = 1;
    const warn = console.warn;
    const warned = [];
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      for (const id of ATTACK_IDS) {
        for (const phase of ['windup', 'active', 'recovery']) {
          for (const pt of [0, 0.4, 0.8, 1]) {
            const mv = FENRIR.attacks[id].move;
            const y = mv && mv.height && ((mv.kind === 'leap' && phase === 'windup') || (mv.kind === 'hop' && phase === 'active')) ? mv.height * Math.sin(Math.PI * pt) : 0;
            run1({ state: 'attack', attack: mkAttack(id, phase, pt, seq++), y, prevY: y * 0.9,
              prevPos: id === 'charge' && phase === 'active' ? { x: 0, z: 6.4 } : { x: 0, z: 6 } }, `fenrir ${id} ${phase} ${pt}`);
          }
        }
      }
      for (let i = 0; i < 3; i++) run1({ state: 'attack', attack: mkAttack('bite', 'active', 0.5, seq++, { pose: 'unknown_pose' }) }, 'unknown pose');
      run1({ state: 'attack', attack: null }, 'attack without runtime');
    } finally {
      console.warn = warn;
    }
    assert.equal(warned.length, 1, '모르는 pose 경고는 한 번만');
    assert.ok(warned[0].includes('unknown_pose'));
    // 이벤트: 피격 움찔 · 그 밖의 이벤트 — 예외 없음
    view.onEvent(EV.HIT, { target: 'boss', outcome: 'hit', dir: 1.2, heavy: true });
    view.onEvent(EV.HIT, { target: 'player', outcome: 'hit', dir: 0 });
    for (const name of [EV.BOSS_ATTACK_WINDUP, EV.BOSS_CUE, EV.BOSS_PHASE_CHANGED, EV.BOSS_GROGGY, EV.BOSS_DEFEATED, EV.BOSS_STEP]) view.onEvent(name, { bossId: 'fenrir' });
    view.onEvent(EV.HIT, null);
    run1({ state: 'idle' }, 'after hit');
    view.dispose();
  });

  test('걷기 · 달리기 · 제자리 회전: 네 발이 번갈아 뜨고, 디딘 발은 땅에 있다 · 공중 자세(도약)는 네 발이 다 뜬다', () => {
    const rest = 0.06 * FENRIR.height;
    for (const [label, vf, vl, om] of [['달리기', 5.5, 0, 0], ['옆걸음', 0, 3.3, 0], ['제자리 회전', 0, 0, 4.5], ['뒤로', -3, 0, 1]]) {
      const view = createFenrirView();
      const info = mkInfo();
      const boss = makeTestBoss(FENRIR, { ...at0, state: 'chase', moveIntent: 'approach' });
      const maxY = [0, 0, 0, 0];
      let minY = Infinity;
      let lifted = 0;
      for (let f = 0; f < 150; f++) {
        boss.prevPos = { x: boss.pos.x, z: boss.pos.z };
        boss.prevFacing = boss.facing;
        boss.facing += om * DT;
        const sn = Math.sin(boss.facing);
        const cs = Math.cos(boss.facing);
        boss.pos.x += (vf * sn + vl * cs) * DT;
        boss.pos.z += (vf * cs - vl * sn) * DT;
        view.root.position.set(boss.pos.x, 0, boss.pos.z);
        view.root.rotation.y = boss.facing;
        view.update(boss, info);
        if (f < 30) continue;
        view.root.updateMatrixWorld(true);
        let up = 0;
        PAWS.forEach((k, i) => {
          const y = worldPos(view.rig.joints[k]).y;
          maxY[i] = Math.max(maxY[i], y);
          minY = Math.min(minY, y);
          if (y > rest + 0.08) up += 1;
        });
        lifted = Math.max(lifted, up);
      }
      for (let i = 0; i < 4; i++) assert.ok(maxY[i] > rest + 0.12, `${label}: ${PAWS[i]}가 뜨지 않는다(${maxY[i].toFixed(2)})`);
      assert.ok(minY > rest - 0.06, `${label}: 발이 땅을 뚫는다(${minY.toFixed(2)})`);
      assert.ok(lifted <= 4);
      assertFiniteTree(view.root, label);
      view.dispose();
    }
    // 서 있으면 발이 뜨지 않는다
    const view = createFenrirView();
    const info = mkInfo();
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle' }), info, 90);
    for (const k of PAWS) assert.ok(Math.abs(worldPos(view.rig.joints[k]).y - rest) < 0.03);
    // 도약 정점: 네 발이 다 떠 있다(root는 CharacterLayer가 boss.y만큼 올린다 — 여기서는 0에 두고 본다)
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'attack', attack: mkAttack('pounce', 'windup', 0.7), y: 2.4, prevY: 2.4 }), info);
    for (const k of PAWS) assert.ok(worldPos(view.rig.joints[k]).y > rest + 0.3, `도약 중 ${k}`);
    view.dispose();
  });

  test('그로기는 쓰러지고(머리가 땅에) · 2페이즈에는 얼음 결정이 자라고 · 사망 연출은 outro 안에 끝난다', () => {
    const view = createFenrirView();
    const info = mkInfo();
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle' }), info);
    const standY = worldPos(view.rig.sockets.chest).y;
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'groggy', stateTime: 2, stateDur: FENRIR.groggyDur }), info, 80);
    assert.ok(worldPos(view.rig.sockets.chest).y < standY - 0.9, `쓰러진 가슴 높이 ${worldPos(view.rig.sockets.chest).y}`);
    assert.ok(worldPos(view.rig.sockets.mouth).y < 0.9, `머리가 땅에: ${worldPos(view.rig.sockets.mouth).y}`);
    for (const k of PAWS) assert.ok(worldPos(view.rig.joints[k]).y > -0.05, `${k}가 땅을 뚫는다`);
    // 처형 자리(정면 radius + 1.6m)에서 머리가 손 닿는 곳에 있다
    assert.ok(worldPos(view.rig.sockets.mouth).z > 2.2);

    // 2페이즈: 덧붙인 얼음 결정(강조 재질)이 자란다
    // 강조 재질(눈 · 얼음)을 쓰는 메시 가운데 스케일이 가장 작은 것 = 덧붙인 결정(리그의 것은 언제나 1)
    const crystals = () => {
      let min = Infinity;
      let shown = 0;
      let n = 0;
      view.root.traverse((o) => {
        if (!o.isMesh || !o.material.emissive || !(o.material.emissiveIntensity > 1)) return;
        n += 1;
        min = Math.min(min, o.scale.x);
        if (o.visible) shown += 1;
      });
      return { min, shown, n };
    };
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle', phase: 1 }), info, 80);
    const p1 = crystals();
    assert.ok(p1.min < 0.01 && p1.shown < p1.n, '1페이즈: 큰 결정은 숨어 있다');
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'phaseShift', phase: 2, stateTime: 0.3, stateDur: FENRIR.phaseShiftDur }), info, 20);
    assert.ok(crystals().min < 0.01, '포효 전에는 아직 자라지 않는다');
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'phaseShift', phase: 2, stateTime: 1.0, stateDur: FENRIR.phaseShiftDur }), info, 60);
    assert.ok(crystals().min > 0.9, '포효와 함께 터져 자란다');
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle', phase: 2 }), info, 120);
    const p2 = crystals();
    assert.ok(Math.abs(p2.min - 1) < 0.02 && p2.shown === p2.n, `2페이즈: 결정이 다 자랐다(${p2.min})`);
    settle(view, makeTestBoss(FENRIR, { ...at0, state: 'idle', phase: 1 }), info, 120);
    assert.ok(crystals().min < 0.01, '재도전(1페이즈)하면 다시 숨는다');

    // 사망: outroVictory − 0.4초에 걸쳐 쓰러지고 흩어지고 숨는다 → 다시 살아나면 보인다
    info.dt = 1 / 60;
    view.update(makeTestBoss(FENRIR, { state: 'dead', stateTime: 0.5 }), info);
    assert.equal(view.root.visible, true);
    view.update(makeTestBoss(FENRIR, { state: 'dead', stateTime: COMBAT.outroVictory - 0.4 }), info);
    assert.equal(view.root.visible, false, '연출이 outro 안에 끝난다');
    view.update(makeTestBoss(FENRIR, { state: 'idle' }), info);
    assert.equal(view.root.visible, true);
    view.root.traverse((o) => { if (o.isMesh && o.material.emissive) assert.equal(o.material.opacity, 1); });
    assertFiniteTree(view.root, 'after death');
    view.dispose();
  });

  test('CharacterLayer와 함께: 보스 소켓(mouth · chest · head)이 같은 프레임의 위치를 준다 · 예고 발광이 강조 재질에 실린다', () => {
    const bus = new EventBus();
    const scene = new THREE.Scene();
    const layer = new CharacterLayer({ scene, bus, settings: { ...DEFAULT_SETTINGS } });
    const state = makeTestState({ bossDef: FENRIR });
    for (let i = 0; i < 3; i++) layer.update(state, 0.5, 1 / 60);
    const out = new THREE.Vector3();
    for (const s of ['mouth', 'chest', 'head', 'tailTip']) {
      assert.equal(layer.getSocketWorld('boss', s, out), true, s);
      assert.ok(Math.hypot(out.x - state.boss.pos.x, out.z - state.boss.pos.z) < 5 && out.y > 0.3 && out.y < 3.5, `${s} = ${out.toArray()}`);
    }
    assert.equal(layer.getSocketWorld('boss', 'weaponTip', out), false);
    // 입은 보스의 정면(facing π → −Z)에 있다
    layer.getSocketWorld('boss', 'mouth', out);
    assert.ok(out.z < state.boss.pos.z - 2, `mouth.z ${out.z}`);
    // 도약의 높이가 root에 실린다
    const y0 = out.y;
    state.boss.y = 2;
    state.boss.prevY = 2;
    layer.update(state, 1, 1 / 60);
    layer.getSocketWorld('boss', 'mouth', out);
    assert.ok(out.y - y0 > 1.5);
    state.boss.y = 0;
    state.boss.prevY = 0;

    // 예고 발광: danger 공격의 예고가 진행되면 강조 재질(눈 · 얼음 결정)이 붉어진다
    const charRoot = scene.children[0];
    const bossRoot = charRoot.children.find((c) => c.name === 'boss:fenrir');
    const accent = () => {
      let m = null;
      bossRoot.traverse((o) => { if (o.isMesh && o.material.emissive && o.material.emissiveIntensity > 1.5) m = o.material; });
      return m;
    };
    layer.update(state, 1, 1 / 60);
    const calm = accent();
    assert.ok(calm.emissive.b > calm.emissive.r, '평소에는 푸르다');
    const base = calm.emissiveIntensity;
    state.boss.state = 'attack';
    state.boss.attack = { id: 'charge', seq: 1, pose: 'charge', glow: 'danger', phase: 'windup', phaseT: 0.9, t: 0.8, windup: 0.9, active: 0.55, recovery: 1.4,
      locked: true, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [] };
    layer.update(state, 1, 1 / 60);
    const hot = accent();
    assert.ok(hot.emissive.r > hot.emissive.b * 2 && hot.emissiveIntensity > base + 1, '붉게 달아오른다');
    // 이벤트 경로(HIT → 점멸 · 움찔)도 예외 없이 돈다
    bus.emit(EV.HIT, { source: 'player', target: 'boss', outcome: 'hit', damage: 10, dir: 0.4, heavy: false, crit: true, x: 0, z: 0, y: 1 });
    layer.update(state, 1, 1 / 60);
    bus.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: state.world.id, bossId: 'fenrir' });
    layer.update(state, 1, 1 / 60);
    layer.dispose();
    assert.equal(scene.children.length, 0);
  });
});

// ───────────────────────────────────────────────────────────── GameSim 한 판

describe('실제 GameSim 위에서 — 데이터가 판정 해소 · 장판 · 텔레그래프와 맞물린다', () => {
  test('가만히 선 플레이어(godMode): 60초에 피격 · 표식 · 2페이즈 전환 · 얼음 가시 · 격파까지 예외 0 · NaN 0', () => {
    const bus = new EventBus();
    const seen = {};
    bus.onAny((name, payload) => { (seen[name] ??= []).push(payload); });
    const sim = new GameSim({ profile: makeTestProfile({ seed: 5 }), bus });
    sim.startBossFight('fenrir');
    assert.equal(sim.state.boss.id, 'fenrir');
    assert.equal(sim.state.boss.hpMax, FENRIR.hp);
    assert.equal(sim.state.world.id, 'arena_fenrir');
    const teleShapes = new Set();
    /** 한 틱 + 죽지 않게 HP를 채운다(무적 디버그는 HIT를 내지 않는다 — 실제 피격을 보려는 것) */
    const tick = () => {
      sim.step(DT, NEUTRAL_INPUT);
      sim.state.player.hp = sim.state.player.stats.hpMax;
    };
    for (let i = 0; i < 1800; i++) {
      tick();
      for (const t of sim.state.telegraphs) teleShapes.add(t.shape.type);
      if (i % 120 === 0) assertFiniteDeep(sim.state);
    }
    assert.equal(sim.state.fight.phase, 'fight');
    assert.ok((seen[EV.BOSS_ATTACK_WINDUP] ?? []).length >= 8, '30초에 공격 8번 이상');
    const hitsOnPlayer = (seen[EV.HIT] ?? []).filter((h) => h.target === 'player');
    assert.ok(hitsOnPlayer.length >= 3, `플레이어가 맞는다(${hitsOnPlayer.length})`);
    assert.ok(hitsOnPlayer.every((h) => ATTACK_IDS.includes(h.attackId) || h.attackId === 'ice_spike'));
    assert.ok(teleShapes.size >= 1, `바닥 표식이 나온다(${[...teleShapes]})`);
    assert.equal((seen[EV.HAZARD_SPAWNED] ?? []).length, 0, '1페이즈에는 장판이 없다');

    sim.debugSetBossHpFraction(0.45);
    for (let i = 0; i < 3600; i++) tick();
    assertFiniteDeep(sim.state);
    assert.equal(sim.state.boss.phase, 2);
    assert.equal((seen[EV.BOSS_PHASE_CHANGED] ?? []).length, 1);
    assert.ok((seen[EV.BOSS_CUE] ?? []).some((c) => c.cue === 'shatter' && c.attackId === ''), '2페이즈 포효의 shatter');
    const spikes = seen[EV.HAZARD_SPAWNED] ?? [];
    assert.ok(spikes.length >= 6, `얼음 가시 ${spikes.length}개`);
    assert.ok(spikes.every((h) => h.kind === 'ice_spike' && h.style === 'frost'));
    assert.ok((seen[EV.HAZARD_ACTIVATED] ?? []).length >= 6);
    assert.ok((seen[EV.HIT] ?? []).some((h) => h.source === 'hazard' && h.target === 'player'), '발밑 가시에 맞는다');
    assert.ok((seen[EV.BOSS_CUE] ?? []).some((c) => c.cue === 'breath_start' && c.socket === 'mouth'));
    structuredClone(sim.state);

    sim.debugDamageBoss(1e9);
    for (let i = 0; i < 400 && sim.state.fight.phase !== 'done'; i++) sim.step(DT, NEUTRAL_INPUT);
    assert.equal((seen[EV.BOSS_DEFEATED] ?? []).length, 1);
    assert.equal(sim.state.fight.outcome, 'victory');
    assert.equal(seen[EV.REWARD_GRANTED][0].reward.embers, 2000);
    assert.equal(sim.state.hazards.length, 0, '격파하면 장판이 정리된다');
    sim.dispose();
  });

  test('같은 시드 · 같은 입력의 펜리르전 20초가 두 번 같다(결정성 — 훅이 ctx.rng만 쓴다)', () => {
    const play = () => {
      const sim = new GameSim({ profile: makeTestProfile({ seed: 9 }), bus: new EventBus() });
      sim.setDebug({ godMode: true });
      sim.startBossFight('fenrir');
      sim.debugSetBossHpFraction(0.6);
      for (let i = 0; i < 1200; i++) sim.step(DT, NEUTRAL_INPUT);
      const out = JSON.stringify(sim.state);
      sim.dispose();
      return out;
    };
    assert.equal(play(), play());
  });
});
