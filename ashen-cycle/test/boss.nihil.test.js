// OWNER: P11 — 계약 §12.2 「boss.nihil.test.js」
// 니힐(§8.12)의 데이터 + 훅을 프레임워크 위에서 돌린다. P1 · P2의 구현에 기대지 않는다 —
// 합성 플레이어(makeTestState의 리터럴)를 직접 움직이고, 판정은 core/hitShapes.js로 본다.
// 구체의 비행은 계약 §3.6의 규칙(homingTime 동안 homing rad/s로 유도 · speed로 전진)을 이 파일 안에서 흉내 낸다.
// 뒤쪽은 "원거리 압박과 틈 찾기"가 성립하는가를 본다: 피할 수 있는가 · 붙을 틈이 있는가 · 붙으면 떼어 내는가.
// 맨 끝은 뷰(nihilView.js)를 Node에서 three만으로(WebGL 없이) 돌려 pose 7종 · 상태 10종 · 소켓을 본다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { DT, CUE_IDS, HAZARD_KINDS, PROJECTILE_KINDS } from '../src/core/constants.js';
import { angleDiff, angleOf, dist, turnToward } from '../src/core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../src/core/hitShapes.js';
import { circleOverlapsWorld, pushOutOfCircle, resolveCircleVsWorld } from '../src/core/collide.js';
import { PLAYER } from '../src/data/player.js';
import { BOSS_AI } from '../src/data/bossCommon.js';
import { COMBAT } from '../src/data/combat.js';
import { NIHIL, NIHIL_EXT } from '../src/data/bosses/nihil.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { nihilHooks } from '../src/sim/boss/hooks/nihil.js';
import { getBossHooks } from '../src/sim/boss/hooks/index.js';
import { createBossState, updateBoss, getBossHits, getBossTelegraphs, onBossDamaged } from '../src/sim/boss/bossSim.js';
import { selectAttack } from '../src/sim/boss/bossAI.js';
import { validateBossDef } from '../src/sim/boss/validateBossDef.js';
import * as THREE from 'three';
import { createNihilView, NIHIL_POSES } from '../src/view/bosses/nihilView.js';
import { makeTestState, makeTestCtx, makeTestBoss, countEvents, assertFiniteDeep } from './helpers.js';

// ───────────────────────────────────────────────────────────── 도구

const ONE = { hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0 };
const ATTACK_IDS = ['void_orbs', 'blink', 'beam_sweep', 'ground_burst', 'sword_rain', 'void_nova', 'scythe_slash', 'blink_strike', 'cataclysm'];
const POSE_KEYS = ['castOrbs', 'blink', 'beam', 'castGround', 'castSky', 'nova', 'scythe'];
const P2_ONLY = ['blink_strike', 'cataclysm'];
const WALK = PLAYER.move.walkSpeed;
const SPRINT = PLAYER.move.sprintSpeed;
const IFRAME = PLAYER.roll.iEnd - PLAYER.roll.iStart;
const HOVER = NIHIL_EXT.hoverY;

/**
 * 니힐 한 판. 보스는 원점에서 +Z를 보고 서 있고(state 'idle'), 플레이어는 (거리 d, 정면 기준 각 a)에 있다.
 * intro면 실제 스폰 자리에서 createBossState로 시작한다.
 * @param {{seed?:number, d?:number, a?:number, phase?:1|2, intro?:boolean, scaling?:any}} [o]
 */
function fight(o = {}) {
  const seed = o.seed ?? 1;
  const state = makeTestState({ bossDef: NIHIL, seed });
  const ctx = makeTestCtx(state, { bossDef: NIHIL, bossHooks: nihilHooks, seed, scaling: o.scaling });
  if (o.intro) {
    state.boss = createBossState(NIHIL, ONE, state.world.bossSpawn);
    state.player.pos = { x: state.world.playerSpawn.x, z: state.world.playerSpawn.z };
  } else {
    const boss = state.boss;
    boss.pos = { x: 0, z: 0 };
    boss.prevPos = { x: 0, z: 0 };
    boss.facing = 0;
    boss.prevFacing = 0;
    const d = o.d ?? 10;
    const a = o.a ?? 0;
    state.player.pos = { x: Math.sin(a) * d, z: Math.cos(a) * d };
  }
  state.player.prevPos = { ...state.player.pos };
  if (o.phase === 2) toPhase2(state.boss);
  return { state, ctx, get boss() { return state.boss; }, player: state.player, stats: newStats() };
}

/** 2페이즈 상태를 직접 만든다(전환 연출 없이) — enterPhaseShift가 하는 일과 같은 값. */
function toPhase2(boss) {
  boss.phase = 2;
  boss.hp = Math.round(boss.hpMax * 0.45);
  boss.dmgMul = NIHIL.phase2.dmgMul;
  boss.speedMul = NIHIL.phase2.speedMul;
}

function newStats() {
  return {
    attacks: /** @type {Record<string, {n:number, hit:number}>} */ ({}), order: [], chase: 0, idle: 0, ticks: 0,
    hazSeen: 0, projSeen: 0, orbs: [], orbHits: 0, orbWalls: 0, cur: null, touched: false, now: false, teleports: 0,
    live: /** @type {{h:any, t:number}[]} */ ([]), harm: false,
  };
}

/**
 * 이번 틱에 플레이어 원과 겹치는 보스 판정이 있는가: 공격 셰이프 · 새로 소환된 장판(그 자리에 가만히 있으면 맞는다) ·
 * 날아가는 구체(§3.6 규칙으로 흉내 — 유도 · 전진 · 기둥/경계 소멸 · 수명).
 * stats.harm은 더 엄격하다 — 이번 틱에 **실제로 피해가 들어올 수 있는가**(직접 타격 · 구체 접촉 · 경고가 끝나 터진 장판).
 */
function overlapsPlayer(e) {
  const p = e.player;
  const s = e.stats;
  let touched = false;
  let harm = false;
  for (const h of getBossHits(e.ctx)) {
    if (shapeHitsCircle(resolveShape(h.shapeDef, h.x, h.z, h.facing), p.pos.x, p.pos.z, p.radius)) touched = harm = true;
  }
  const hz = e.ctx.spawned.hazards;
  while (s.hazSeen < hz.length) {
    const h = hz[s.hazSeen++];
    s.live.push({ h, t: 0 });
    if (shapeHitsCircle(h.shape, p.pos.x, p.pos.z, p.radius)) touched = true;
  }
  // 장판: 소환 뒤 warn초에 터져 active초 동안 판정(§3.6)
  let lw = 0;
  for (const l of s.live) {
    l.t += DT;
    if (l.t >= l.h.warn + l.h.active - 1e-9) continue;
    if (l.t >= l.h.warn - 1e-9 && shapeHitsCircle(l.h.shape, p.pos.x, p.pos.z, p.radius)) harm = true;
    s.live[lw++] = l;
  }
  s.live.length = lw;
  const pr = e.ctx.spawned.projectiles;
  while (s.projSeen < pr.length) s.orbs.push({ ...pr[s.projSeen++] });
  let w = 0;
  for (const o of s.orbs) {
    if (o.homing > 0 && o.age < o.homingTime) o.dir = turnToward(o.dir, angleOf(p.pos.x - o.x, p.pos.z - o.z), o.homing * DT);
    o.x += Math.sin(o.dir) * o.speed * DT;
    o.z += Math.cos(o.dir) * o.speed * DT;
    o.age += DT;
    if (o.age >= o.life) continue;
    if (dist(o.x, o.z, p.pos.x, p.pos.z) <= o.r + p.radius) {
      touched = harm = true;
      s.orbHits += 1;
      continue;
    }
    if (circleOverlapsWorld(o.x, o.z, o.r, e.state.world)) {
      s.orbWalls += 1;
      continue;
    }
    s.orbs[w++] = o;
  }
  s.orbs.length = w;
  s.harm = harm;
  return touched;
}

/**
 * 한 틱: 합성 플레이어 이동 → updateBoss → (P2가 하는) 월드 충돌 · 몸통 밀어내기 → 통계.
 * 매 틱 boss.y === hoverY를 확인한다(첫 updateBoss 뒤로는 어떤 상태에서도).
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
  p.prevPos.x = p.pos.x;
  p.prevPos.z = p.pos.z;
  const ox = p.pos.x;
  const oz = p.pos.z;
  if (mover) mover(e, s.ticks);
  resolveCircleVsWorld(p.pos, p.radius, e.state.world);
  p.vel.x = (p.pos.x - ox) / DT;
  p.vel.z = (p.pos.z - oz) / DT;

  const n0 = e.ctx.events.length;
  updateBoss(e.ctx, DT);
  resolveCircleVsWorld(b.pos, b.radius, e.state.world);
  if (b.state !== 'dead') pushOutOfCircle(p.pos, p.radius, b.pos.x, b.pos.z, b.radius);
  resolveCircleVsWorld(p.pos, p.radius, e.state.world);
  assert.equal(b.y, HOVER, `boss.y === hoverY (상태 ${b.state})`);

  for (let k = n0; k < e.ctx.events.length; k++) {
    const ev = e.ctx.events[k];
    if (ev.name === EV.BOSS_TELEPORT) s.teleports += 1;
    if (ev.name !== EV.BOSS_ATTACK_WINDUP) continue;
    const id = ev.payload.attackId;
    s.cur = s.attacks[id] ?? (s.attacks[id] = { n: 0, hit: 0 });
    s.cur.n += 1;
    s.touched = false;
    s.order.push(id);
  }
  s.now = overlapsPlayer(e);
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
  e.ctx.bossHooks = { ...nihilHooks, forceAttack: () => id };
  step(e, mover);
  assert.equal(e.boss.state, 'attack');
  assert.equal(e.boss.attack.id, id);
  const atk = e.boss.attack;
  e.ctx.bossHooks = nihilHooks;
  let guard = 0;
  while (e.boss.attack === atk) {
    step(e, mover);
    if (each && e.boss.attack === atk) each(atk);
    assert.ok(++guard < 1200, `${id}가 끝나지 않는다`);
  }
  assertFiniteDeep(e.state);
  return atk;
}

// 합성 플레이어의 움직임 — 전부 사람이 낼 수 있는 속도다
/** 보스 기준 (거리 d, 정면 기준 각 a)에 붙어 다닌다. */
const glue = (d, a) => (e) => {
  const b = e.boss;
  e.player.pos.x = b.pos.x + Math.sin(b.facing + a) * d;
  e.player.pos.z = b.pos.z + Math.cos(b.facing + a) * d;
};
/** 보스 쪽으로 속력 v로 다가가 거리 stop에서 멈춘다(멀어지면 다시 쫓는다). */
const pursue = (v, stop) => (e) => {
  const b = e.boss;
  const p = e.player;
  const dx = b.pos.x - p.pos.x;
  const dz = b.pos.z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  if (d <= stop) return;
  const s = Math.min(v * DT, d - stop);
  p.pos.x += (dx / d) * s;
  p.pos.z += (dz / d) * s;
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

/** 표(§8.12)의 소환 개수: [1페이즈, 2페이즈] */
const PROJECTILES = { void_orbs: [3, 5] };
const HAZARDS = { ground_burst: [3, 3], sword_rain: [10, 10], cataclysm: [16, 16] };
const TELEPORTS = { blink: 1, blink_strike: 1 };

// ───────────────────────────────────────────────────────────── 정의

describe('니힐 정의(§8.12)', () => {
  test('validateBossDef 통과 · 머리 필드 · 레지스트리', () => {
    assert.deepEqual(validateBossDef(NIHIL), []);
    assert.equal(NIHIL.hp, 2800);   // (W3) 2400 → 2800
    assert.equal(NIHIL.reward, 3000);
    assert.equal(NIHIL.radius, 0.8);
    assert.equal(NIHIL.id, 'nihil');
    assert.equal(NIHIL.rig, 'floater');
    assert.equal(NIHIL.arenaId, 'arena_nihil');
    assert.equal(NIHIL.style, 'void');
    assert.equal(NIHIL.postureMax, 90);
    assert.equal(NIHIL.postureDecayDelay, 8.0);
    assert.equal(NIHIL.postureDecayRate, 5);
    assert.equal(NIHIL.height, 2.8);
    assert.equal(NIHIL.moveSpeed, 2.6);
    assert.equal(NIHIL.turnRate, 5.0);
    assert.equal(NIHIL.preferredRange, 10);
    assert.equal(NIHIL.kite, true);
    assert.equal(NIHIL.stride, 0);
    assert.deepEqual(NIHIL.think, [0.60, 1.00]);
    assert.deepEqual(NIHIL.phase2, { hpFrac: 0.5, speedMul: 1.10, dmgMul: 1.12, thinkMul: 0.6, moveSpeedMul: 1.2 });
    assert.equal(NIHIL.fallbackAttack, 'void_orbs');
    assert.equal(NIHIL.bodyParts, undefined);
    assert.equal(getBossDef('nihil'), NIHIL);
    assert.equal(getBossHooks('nihil'), nihilHooks);
    assert.equal(NIHIL_EXT.hoverY, 0.8);
    assert.equal(NIHIL_EXT.crowdRange, 3.5);
    assert.equal(NIHIL_EXT.crowdTime, 1.5);
    // (W3) kite는 프레임워크가 한다(고민하는 동안 d < preferredRange × kiteNear = 6m면 물러난다) — 훅의 kiteRange · kiteTime은 없앴다
    assert.deepEqual(Object.keys(NIHIL_EXT).sort(), ['crowdRange', 'crowdTime', 'hoverY']);
    assert.equal(NIHIL.kite, true);
    assert.ok(Math.abs(NIHIL.preferredRange * BOSS_AI.kiteNear - 6) < 1e-9);
    structuredClone(NIHIL); // 순수 데이터
  });

  test('공격 9종 · pose 7종 · 선택 조건(§8.12 표)', () => {
    assert.deepEqual(Object.keys(NIHIL.attacks).sort(), [...ATTACK_IDS].sort());
    const poses = new Set(ATTACK_IDS.map((id) => NIHIL.attacks[id].pose));
    assert.deepEqual([...poses].sort(), [...POSE_KEYS].sort());
    /** [거리 min, max, 각 상한, 가중, 쿨, 최소 페이즈, windup, active, recovery, turnRate, lockLead] */
    const table = {
      void_orbs: [5, 22, undefined, 3, 3, 1, 0.90, 0.60, 1.10, 5.0, 0.10],
      blink: [0, 4.5, undefined, 4, 5, 1, 0.45, 0.10, 0.40, 0, 0],
      beam_sweep: [4, 22, 1.0, 2, 8, 1, 1.20, 1.50, 1.40, 5.0, 0.25],
      ground_burst: [0, 22, undefined, 3, 6, 1, 0.80, 1.00, 1.00, 5.0, 0.10],
      sword_rain: [0, 22, undefined, 2, 12, 1, 1.10, 2.00, 1.20, 5.0, 0.10],
      void_nova: [0, 4.8, undefined, 3, 6, 1, 0.85, 0.15, 1.50, 0, 0],
      scythe_slash: [0, 4.0, 1.4, 2.5, 2, 1, 0.60, 0.15, 1.10, 5.0, 0.15],   // (W5) 선택 거리 4.2 → 4.0
      blink_strike: [6, 22, undefined, 2.5, 9, 2, 0.50, 0.10, 0.30, 0, 0],
      cataclysm: [0, 22, undefined, 1.5, 16, 2, 1.30, 2.40, 2.00, 5.0, 0.10],
    };
    for (const id of ATTACK_IDS) {
      const a = NIHIL.attacks[id];
      const [r0, r1, ang, w, cd, ph, wu, ac, rc, tr, ll] = table[id];
      assert.ok(a.sel, `${id}: 전부 AI가 직접 고른다`);
      assert.equal(a.sel.minRange, r0, id);
      assert.equal(a.sel.maxRange, r1, id);
      assert.equal(a.sel.maxAngle, ang, id);
      assert.equal(a.sel.minAngle, undefined, id);
      assert.equal(a.sel.weight, w, id);
      assert.equal(a.sel.cooldown, cd, id);
      assert.equal(a.sel.minPhase ?? 1, ph, id);
      assert.equal(a.sel.maxPhase, undefined, id);
      assert.deepEqual([a.windup, a.active, a.recovery], [wu, ac, rc], id);
      assert.deepEqual([a.track.turnRate, a.track.lockLead], [tr, ll], id);
      assert.equal(a.sel.minPhase === 2, P2_ONLY.includes(id), `${id}의 페이즈`);
    }
    assert.deepEqual(NIHIL.attacks.beam_sweep.track.sweep, { from: -0.95, to: 0.95 });
    assert.deepEqual(NIHIL.attacks.void_orbs.chain, [{ next: 'beam_sweep', chance: 0, chanceP2: 0.50, at: 0.40 }]);
    assert.deepEqual(NIHIL.attacks.blink.chain, [
      { next: 'void_orbs', chance: 0.50, chanceP2: 0.30, at: 0.10 },
      { next: 'ground_burst', chance: 0.30, chanceP2: 0.40, at: 0.10 },
    ]);
    assert.deepEqual(NIHIL.attacks.blink_strike.chain, [{ next: 'void_nova', chance: 1, chanceP2: 1, at: 0.05 }]);
    for (const id of ['beam_sweep', 'ground_burst', 'sword_rain', 'void_nova', 'scythe_slash', 'cataclysm']) {
      assert.deepEqual(NIHIL.attacks[id].chain, [], id);
    }
  });

  test('판정 · 투사체 · 장판의 수치(§8.12 표)', () => {
    const A = NIHIL.attacks;
    const beam = A.beam_sweep.hits[0];
    assert.deepEqual(beam.shape, { type: 'capsule', fwd0: 1.0, fwd1: 22, r: 0.6 });
    assert.deepEqual(beam.telegraphShape, { type: 'arc', r: 22, rInner: 1.0, halfAngle: 0.95 });
    assert.deepEqual([beam.t0, beam.t1, beam.interval, beam.damage], [0, 1.50, 0, 36]);   // (W3) 피해 전부 약 +20%
    assert.deepEqual([beam.guardable, beam.parryable, beam.knockdown, beam.telegraph], [true, false, false, true]);
    const start = A.beam_sweep.events.find((ev) => ev.cue === 'beam_start');
    assert.deepEqual(start.params, { length: 22, width: 1.2, socket: 'handL' });
    assert.equal(start.t, 0);
    assert.equal(A.beam_sweep.events.find((ev) => ev.cue === 'beam_end').t, 1.50);
    assert.equal(start.params.length, beam.shape.fwd1, '광선의 그림 길이 = 판정 길이');
    assert.equal(start.params.width, beam.shape.r * 2, '광선의 그림 굵기 = 판정 지름');
    assert.equal(beam.telegraphShape.halfAngle, A.beam_sweep.track.sweep.to, '부채 표식 = 쓸리는 범위 전체');

    const nova = A.void_nova.hits[0];
    assert.deepEqual(nova.shape, { type: 'circle', r: 5.0 });
    assert.deepEqual([nova.t0, nova.t1, nova.interval, nova.damage], [0, 0.15, 0, 34]);
    assert.deepEqual([nova.guardable, nova.parryable, nova.knockdown, nova.telegraph], [true, false, true, true]);
    assert.deepEqual(A.void_nova.events, [{ t: 0, type: 'cue', cue: 'slam', shake: [0.30, 0.35] }]);

    const scythe = A.scythe_slash.hits[0];
    assert.deepEqual(scythe.shape, { type: 'arc', r: 3.0, halfAngle: 1.4 });   // (W5) r 4.0 → 3.0(보이는 낫 끝 2.7m)
    assert.deepEqual([scythe.t0, scythe.t1, scythe.interval, scythe.damage], [0, 0.15, 0, 29]);
    assert.deepEqual([scythe.guardable, scythe.parryable, scythe.knockdown, scythe.telegraph], [true, true, false, false]);
    assert.deepEqual(A.scythe_slash.move, { kind: 'lunge', t0: -0.15, t1: 0.05, dist: 1.0 });
    assert.deepEqual(A.scythe_slash.events, [{ t: -0.15, type: 'cue', cue: 'whoosh' }]);

    const orbEvents = A.void_orbs.events.filter((ev) => ev.type === 'projectile');
    assert.equal(orbEvents.length, 2);
    assert.deepEqual([orbEvents[0].t, orbEvents[0].count, orbEvents[0].interval, orbEvents[0].spread, orbEvents[0].phase], [0, 3, 0.25, 0.5, undefined]);
    assert.deepEqual([orbEvents[1].t, orbEvents[1].count, orbEvents[1].interval, orbEvents[1].spread, orbEvents[1].phase], [0.12, 2, 0.25, 0.9, 2]);
    assert.deepEqual(orbEvents[0].origin, { fwd: 0.8, side: 0 });
    assert.deepEqual(orbEvents[0].proj, {
      kind: 'void_orb', style: 'void', speed: 9, r: 0.45, life: 5, homing: 2.2, homingTime: 2.5,
      damage: 22, guardable: true, parryable: true, knockdown: false, y: 1.4,
    });
    assert.equal(orbEvents[1].proj, orbEvents[0].proj, '2페이즈의 덧구체도 같은 구체다');

    const burst = A.ground_burst.events.find((ev) => ev.type === 'hazard');
    assert.deepEqual([burst.t, burst.count, burst.interval], [0, 3, 0.45]);
    assert.deepEqual(burst.place, { mode: 'chase', lead: 0.3 });
    assert.deepEqual(burst.hazard, {
      kind: 'void_burst', style: 'void', shape: { type: 'circle', r: 2.6 },
      warn: 0.9, active: 0.2, interval: 0, damage: 36, guardable: true, knockdown: true,
    });
    const rain = A.sword_rain.events.find((ev) => ev.type === 'hazard');
    assert.deepEqual([rain.t, rain.count, rain.interval], [0, 10, 0.2]);
    assert.deepEqual(rain.place, { mode: 'scatter', radius: 6 });
    assert.deepEqual(rain.hazard, {
      kind: 'void_sword', style: 'void', shape: { type: 'circle', r: 1.3 },
      warn: 0.7, active: 0.15, interval: 0, damage: 24, guardable: true, knockdown: false,
    });
    const cat = A.cataclysm.events.filter((ev) => ev.type === 'hazard');
    assert.deepEqual([cat[0].t, cat[0].count, cat[0].interval, cat[0].place], [0, 12, 0.2, { mode: 'scatter', radius: 7 }]);
    assert.deepEqual([cat[1].t, cat[1].count, cat[1].interval, cat[1].place], [0.3, 4, 0.6, { mode: 'chase', lead: 0.3 }]);
    assert.equal(cat[0].hazard, rain.hazard, '대격변의 검 = 검 비의 검');
    assert.equal(cat[1].hazard, burst.hazard, '대격변의 폭발 = 지면 폭발');
    assert.deepEqual(A.cataclysm.events[0], { t: -0.8, type: 'cue', cue: 'roar' });

    for (const id of ['blink', 'blink_strike']) {
      const ev = A[id].events;
      assert.deepEqual(ev.map((x) => [x.t, x.type, x.cue ?? x.to]), [[-0.05, 'cue', 'blink_out'], [0, 'teleport', id === 'blink' ? 'away' : 'behindTarget'], [0.02, 'cue', 'blink_in']]);
    }
    assert.equal(A.blink.events[1].dist, 11);
    assert.equal(A.blink_strike.events[1].dist, 2.5);
  });

  test('glow 규칙: danger는 패링 불가 직접 타격(void_nova)뿐 · 시전은 보스 색 · 패링 가능한 근접(scythe_slash)은 none', () => {
    const glows = Object.fromEntries(ATTACK_IDS.map((id) => [id, NIHIL.attacks[id].glow]));
    assert.deepEqual(glows, {
      void_orbs: 'void', blink: 'void', beam_sweep: 'void', ground_burst: 'void', sword_rain: 'void',
      void_nova: 'danger', scythe_slash: 'none', blink_strike: 'void', cataclysm: 'void',
    });
    for (const id of ATTACK_IDS) {
      const a = NIHIL.attacks[id];
      for (const h of a.hits) {
        assert.equal(h.guardable, true, `${id}: 전부 가드 가능`);
        if (a.glow === 'danger') assert.equal(h.parryable, false, `${id}: danger는 패링 불가`);
        if (a.glow === 'none') assert.equal(h.parryable, true, `${id}: 평범한 근접은 패링 가능`);
      }
      if (a.glow === 'danger') assert.ok(a.hits.length > 0 && a.hits.every((h) => h.telegraph), `${id}: 바닥 표식`);
    }
  });

  test('큐 · kind가 어휘 안 · 장판과 투사체의 필수 필드', () => {
    for (const id of ATTACK_IDS) {
      for (const ev of NIHIL.attacks[id].events) {
        if (ev.type === 'cue') assert.ok(CUE_IDS.includes(ev.cue), `${id}: ${ev.cue}`);
        if (ev.type === 'hazard') {
          assert.ok(HAZARD_KINDS.includes(ev.hazard.kind));
          assert.equal(ev.hazard.style, 'void');
          assert.equal(ev.hazard.grow, undefined);
        }
        if (ev.type === 'projectile') assert.ok(PROJECTILE_KINDS.includes(ev.proj.kind));
      }
    }
    // 시전 공격은 판정 시작에 cast 큐(손의 섬광)가 난다 — 뷰의 handL이 그 자리다
    for (const id of ['void_orbs', 'ground_burst', 'sword_rain']) {
      assert.deepEqual(NIHIL.attacks[id].events[0], { t: 0, type: 'cue', cue: 'cast' }, id);
    }
  });
});

// ───────────────────────────────────────────────────────────── 공격 하나씩

describe('공격 전부를 forceAttack으로 끝까지', () => {
  for (const phase of [1, 2]) {
    for (const id of ATTACK_IDS) {
      test(`${id} (${phase}페이즈)`, () => {
        const sel = NIHIL.attacks[id].sel;
        const d = Math.max(2, Math.min(14, (sel.minRange + sel.maxRange) / 2));
        const e = fight({ d, phase, seed: 3 });
        const def = NIHIL.attacks[id];
        let liveTicks = 0;
        let activeTicks = 0;
        const hitIds = new Set();
        const tp0 = e.stats.teleports;
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
              assert.equal(h.parryable, def.hits[0].parryable);
              assert.equal(h.knockdown, def.hits[0].knockdown);
            }
          }
          for (const t of getBossTelegraphs(e.ctx)) {
            assert.ok(t.progress >= 0 && t.progress <= 1);
            assert.equal(t.style, def.glow === 'danger' ? 'danger' : 'void');
          }
        });
        if (def.hits.length) {
          assert.ok(liveTicks > 0, '히트가 있는 공격은 판정 구간에 getBossHits가 non-empty');
          assert.equal(hitIds.size, def.hits.length, '지속 판정이 아니다 — 창 하나에 hitId 하나');
        } else {
          assert.equal(liveTicks, 0);
        }
        assert.ok(activeTicks > 0);
        // 표의 개수만큼
        assert.equal(e.ctx.spawned.projectiles.length, (PROJECTILES[id] ?? [0, 0])[phase - 1], '투사체 개수');
        assert.equal(e.ctx.spawned.hazards.length, (HAZARDS[id] ?? [0, 0])[phase - 1], '장판 개수');
        assert.equal(e.stats.teleports - tp0, TELEPORTS[id] ?? 0, '순간이동 횟수');
        for (const h of e.ctx.spawned.hazards) {
          assert.equal(h.style, 'void');
          assert.ok(Math.abs(h.damage / e.boss.dmgMul - Math.round(h.damage / e.boss.dmgMul)) < 1e-9, 'damageMul = boss.dmgMul');
          assert.ok(Math.hypot(h.x, h.z) <= e.state.world.radius + 1e-9, '장판은 아레나 안');
        }
        for (const p of e.ctx.spawned.projectiles) {
          assert.equal(p.kind, 'void_orb');
          assert.equal(p.parryable, true, '구체는 패링할 수 있다');
          assert.ok(Math.abs(p.damage - 22 * e.boss.dmgMul) < 1e-9);
        }
        const ends = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_END && x.payload.seq === atk.seq);
        assert.equal(ends.length, 1);
        assert.equal(ends[0].payload.interrupted, false);
        const cues = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.seq === atk.seq).map((x) => x.payload.cue);
        const want = def.events.filter((ev) => ev.type === 'cue').map((ev) => ev.cue);
        // 연속기로 넘어가면 남은 후딜의 이벤트는 없다 — 니힐의 큐는 전부 판정이 끝나기 전에 나므로 표와 같다
        assert.deepEqual(cues, want, '큐가 표의 순서대로 한 번씩');
        for (const c of e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.seq === atk.seq)) {
          assert.equal(c.payload.style, 'void');
          assert.equal(c.payload.bossId, 'nihil');
        }
        structuredClone(e.state);
      });
    }
  }
});

// ───────────────────────────────────────────────────────────── 보스별(§12.2): 순간이동 · 구체 · 광선 · 검 비 · 부유

describe('순간이동', () => {
  /** 플레이어 자리 [x, z] — 중앙 · 벽 앞 · 기둥 둘레 · 대각선 */
  const SPOTS = [[0, 3], [0, -3], [3, 0], [0, 0.9], [0, 20], [-20, 3], [14, 14], [15, 15], [-15, 14.5], [7.8, 9.5], [9.6, 7.8], [5, -19], [0, 12], [12, 0]];

  test('blink: 아레나 안 · 기둥과 겹치지 않음 · prevPos도 덮음 · 플레이어를 본다 · 플레이어에게서 멀어진다', () => {
    const world = makeTestState({ bossDef: NIHIL }).world;
    const lim = world.radius - NIHIL.radius - BOSS_AI.teleportMargin;
    for (const [px, pz] of SPOTS) {
      for (const [ox, oz] of [[0, 2.5], [2.2, -1], [-1.5, -2]]) {
        const e = fight({ d: 3 });
        e.player.pos.x = px;
        e.player.pos.z = pz;
        resolveCircleVsWorld(e.player.pos, e.player.radius, world);
        const bp = { x: e.player.pos.x + ox, z: e.player.pos.z + oz };
        resolveCircleVsWorld(bp, NIHIL.radius, world);
        e.boss.pos.x = bp.x; e.boss.pos.z = bp.z;
        e.boss.prevPos.x = bp.x; e.boss.prevPos.z = bp.z;
        let seen = null;
        let before = null;
        runAttack(e, 'blink', null, (k) => {
          const tA = k.t - k.windup;
          if (tA < -1e-9) before = { ...e.boss.pos };
        });
        const tp = e.ctx.events.filter((x) => x.name === EV.BOSS_TELEPORT);
        assert.equal(tp.length, 1);
        seen = tp[0].payload;
        const info = `플레이어 (${px}, ${pz}) 보스 +(${ox}, ${oz}) → (${seen.toX.toFixed(2)}, ${seen.toZ.toFixed(2)})`;
        assert.ok(Math.hypot(seen.toX, seen.toZ) <= lim + 1e-6, `아레나 안: ${info}`);
        assert.equal(circleOverlapsWorld(seen.toX, seen.toZ, NIHIL.radius, world), false, `기둥과 겹친다: ${info}`);
        assert.ok(Math.abs(seen.fromX - before.x) < 1e-9 && Math.abs(seen.fromZ - before.z) < 1e-9, 'from = 사라진 자리');
        const dAfter = dist(seen.toX, seen.toZ, e.player.pos.x, e.player.pos.z);
        const dBefore = dist(before.x, before.z, e.player.pos.x, e.player.pos.z);
        assert.ok(dAfter > dBefore + 2, `멀어진다 ${dBefore.toFixed(1)} → ${dAfter.toFixed(1)}: ${info}`);
        // 목표는 11m. 경계 안으로 당기거나 기둥에서 밀려나면 조금 달라진다
        assert.ok(dAfter >= 7 && dAfter <= 13, `플레이어에게서 7~13m: ${dAfter.toFixed(2)} ${info}`);
      }
    }
  });

  test('blink: 순간이동 틱에 pos = prevPos · facing = prevFacing(보간이 아레나를 가로지르지 않는다) · 큐 순서', () => {
    const e = fight({ d: 2.5, seed: 4 });
    let checked = false;
    e.ctx.bossHooks = { ...nihilHooks, forceAttack: () => 'blink' };
    step(e);
    e.ctx.bossHooks = nihilHooks;
    const atk = e.boss.attack;
    while (e.boss.attack === atk) {
      const n0 = e.ctx.events.length;
      step(e);
      const tp = e.ctx.events.slice(n0).find((x) => x.name === EV.BOSS_TELEPORT);
      if (tp) {
        checked = true;
        assert.deepEqual(e.boss.prevPos, e.boss.pos);
        assert.equal(e.boss.prevFacing, e.boss.facing);
        assert.deepEqual({ x: tp.payload.toX, z: tp.payload.toZ }, { x: e.boss.pos.x, z: e.boss.pos.z });
        const toPlayer = angleOf(e.player.pos.x - e.boss.pos.x, e.player.pos.z - e.boss.pos.z);
        assert.ok(Math.abs(angleDiff(e.boss.facing, toPlayer)) < 1e-9, '나타나면 플레이어를 본다');
      }
    }
    assert.ok(checked);
    const names = e.ctx.events
      .filter((x) => (x.name === EV.BOSS_CUE && x.payload.seq === atk.seq) || x.name === EV.BOSS_TELEPORT)
      .map((x) => (x.name === EV.BOSS_TELEPORT ? 'teleport' : x.payload.cue));
    assert.deepEqual(names, ['blink_out', 'teleport', 'blink_in'], '소멸 큐 → 이동 → 등장 큐');
    // 등장 큐는 새 자리에서 난다
    const cin = e.ctx.events.find((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'blink_in');
    const cout = e.ctx.events.find((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'blink_out');
    assert.ok(dist(cin.payload.x, cin.payload.z, cout.payload.x, cout.payload.z) > 5);
  });

  test('blink_strike: 플레이어의 등 뒤 2.5m에 나타나고(아레나 안) 곧바로 void_nova로 이어진다', () => {
    const world = makeTestState({ bossDef: NIHIL }).world;
    const lim = world.radius - NIHIL.radius - BOSS_AI.teleportMargin;
    for (const [px, pz, pf] of [[0, 10, Math.PI], [0, 10, 0], [5, 12, 2.0], [0, 20.5, Math.PI], [-18, 8, -1.2], [8.5, 9.5, -2.3]]) {
      const e = fight({ d: 10, phase: 2 });
      e.player.pos.x = px;
      e.player.pos.z = pz;
      e.player.facing = pf;
      resolveCircleVsWorld(e.player.pos, e.player.radius, world);
      const atk = runAttack(e, 'blink_strike');
      const tp = e.ctx.events.find((x) => x.name === EV.BOSS_TELEPORT).payload;
      assert.ok(Math.hypot(tp.toX, tp.toZ) <= lim + 1e-6);
      assert.equal(circleOverlapsWorld(tp.toX, tp.toZ, NIHIL.radius, world), false);
      const ideal = { x: e.player.pos.x - Math.sin(pf) * 2.5, z: e.player.pos.z - Math.cos(pf) * 2.5 };
      const free = Math.hypot(ideal.x, ideal.z) <= lim && !circleOverlapsWorld(ideal.x, ideal.z, NIHIL.radius, world);
      if (free) assert.ok(dist(tp.toX, tp.toZ, ideal.x, ideal.z) < 1e-6, '등 뒤 2.5m');
      // 연속기: 확률 1 — 곧바로 폭발 예고
      assert.equal(e.boss.state, 'attack');
      assert.equal(e.boss.attack.id, 'void_nova');
      assert.equal(e.boss.attack.chained, true);
      assert.equal(e.boss.attack.glow, 'danger');
      assert.ok(e.boss.attack.seq > atk.seq);
      // 등장부터 폭발까지: 남은 판정(0.10) + 후딜의 0.05초 + 폭발 예고 — 구르기 한 번을 누를 시간이 있다
      const gap = NIHIL.attacks.blink_strike.active + 0.05 + e.boss.attack.windup;
      assert.ok(gap >= 0.85, `등장 → 폭발 ${gap.toFixed(2)}초`);
    }
  });
});

describe('유도 구체', () => {
  test('1페이즈 3발 · 2페이즈 5발, 전부 패링 가능 · 0.25초 간격 · 부채로 벌어져 손 앞(0.8m)에서 나간다', () => {
    for (const [phase, want, times] of [[1, 3, [0, 0.25, 0.5]], [2, 5, [0, 0.12, 0.25, 0.37, 0.5]]]) {
      const e = fight({ d: 12, phase });
      const at = [];
      runAttack(e, 'void_orbs', null, (k) => {
        while (at.length < e.ctx.spawned.projectiles.length) at.push(k.t - k.windup);
      });
      const orbs = e.ctx.spawned.projectiles;
      assert.equal(orbs.length, want);
      for (let i = 0; i < want; i++) assert.ok(Math.abs(at[i] - times[i]) < DT + 1e-9, `${phase}페이즈 구체 ${i} tA = ${at[i]}`);
      for (const o of orbs) {
        assert.equal(o.parryable, true);
        assert.equal(o.guardable, true);
        assert.equal(o.knockdown, false);
        assert.equal(o.y, 1.4);
        assert.ok(Math.abs(dist(o.x, o.z, e.boss.pos.x, e.boss.pos.z) - 0.8) < 1e-6, '발사점 = 정면 0.8m');
      }
      // 기본 3발은 플레이어 방향 ±0.25 rad, 2페이즈의 덧 2발은 ±0.45 rad
      const toPlayer = angleOf(e.player.pos.x - orbs[0].x, e.player.pos.z - orbs[0].z);
      const offs = orbs.map((o) => Math.round(angleDiff(toPlayer, o.dir) * 1000) / 1000).sort((a, b) => a - b);
      assert.deepEqual(offs, phase === 1 ? [-0.25, 0, 0.25] : [-0.45, -0.25, 0, 0.25, 0.45]);
    }
  });

  test('서 있는 플레이어에게는 전부 닿고, 기둥 뒤의 플레이어에게 곧장 날아간 구체는 기둥에 막힌다', () => {
    /** 다음 공격을 고르지 못하게 한다(구체의 비행만 본다 — fallback 3초보다 짧게 돌린다) */
    const quiet = { ...nihilHooks, forceAttack: undefined, adjustWeights: (_ctx, cands) => { cands.length = 0; } };
    const e = fight({ d: 12 });
    runAttack(e, 'void_orbs');
    e.ctx.bossHooks = quiet;
    run(e, 2.5, null);
    assert.equal(e.stats.orbHits + e.stats.orbWalls + e.stats.orbs.length, 3);
    assert.equal(e.stats.orbHits, 3, '유도 구체 3발이 서 있는 플레이어에게 닿는다');

    // 기둥(반경 11m · 각 π/4) 바로 뒤
    const c = fight({ d: 14, a: Math.PI / 4 });
    c.boss.facing = Math.PI / 4;
    c.boss.prevFacing = Math.PI / 4;
    runAttack(c, 'void_orbs');
    c.ctx.bossHooks = quiet;
    run(c, 2.5, null);
    assert.ok(c.stats.orbWalls >= 1, '기둥은 구체를 막는 엄폐물이다');
    assert.ok(c.stats.orbHits <= 2);
  });

  test('2페이즈: 구체 뒤에 절반은 광선이 이어진다(1페이즈에는 없다 — 순환 보너스를 받아도)', () => {
    let chained = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = fight({ d: 12, phase: 2, seed });
      runAttack(e, 'void_orbs');
      if (e.boss.state === 'attack') {
        chained += 1;
        assert.equal(e.boss.attack.id, 'beam_sweep');
        assert.equal(e.boss.attack.chained, true);
      }
    }
    assert.ok(chained >= 10 && chained <= 30, `2페이즈 연계 확률 0.5 → 40번 중 ${chained}번`);
    for (let seed = 1; seed <= 20; seed++) {
      const e = fight({ d: 12, phase: 1, seed, scaling: { chainBonus: 0.3 } });
      runAttack(e, 'void_orbs');
      assert.notEqual(e.boss.state, 'attack', '1페이즈에는 구체 → 광선이 없다');
    }
  });
});

describe('광선 쓸기', () => {
  test('회전 각: 고정 방향 L에서 L − 0.95로 돌아간 뒤, 판정 1.5초 동안 L + 0.95까지 쓴다 · 표식은 L에 머문다', () => {
    for (const phase of [1, 2]) {
      const e = fight({ d: 10, phase });
      let L = null;
      let first = null;
      let last = null;
      let prev = null;
      let hitId = null;
      let lockedTele = 0;
      const atk = runAttack(e, 'beam_sweep', orbit(10, WALK), (k) => {
        const tA = k.t - k.windup;
        const tele = getBossTelegraphs(e.ctx);
        if (!k.locked) {
          assert.equal(tele.length, 1);
          assert.equal(tele[0].facing, e.boss.facing, '고정 전에는 표식이 따라 돈다');
          L = e.boss.facing;
          return;
        }
        if (L !== null && first === null && k.phase === 'windup') {
          // 고정된 틱의 facing이 L이다(그 틱의 회전까지 하고 고정한다)
          if (lockedTele === 0) L = tele[0].facing;
          lockedTele += 1;
          assert.equal(tele.length, 1);
          assert.ok(Math.abs(angleDiff(tele[0].facing, L)) < 1e-9, '고정 뒤 표식은 L에 머문다');
          assert.deepEqual(tele[0].shapeDef, NIHIL.attacks.beam_sweep.hits[0].telegraphShape);
          assert.ok(angleDiff(L, e.boss.facing) <= 1e-9 && angleDiff(L, e.boss.facing) >= -0.95 - 1e-9, '고정 뒤 예고: L → L − 0.95');
        }
        if (k.phase === 'active') {
          const hs = getBossHits(e.ctx);
          assert.equal(hs.length, 1);
          hitId = hitId ?? hs[0].hitId;
          assert.equal(hs[0].hitId, hitId, '한 번만 맞는다(판정 창 하나 · hitId 하나)');
          assert.equal(hs[0].facing, e.boss.facing, '판정이 광선을 따라간다');
          assert.equal(tele.length, 0, '판정이 시작되면 예고 표식은 끝난다');
          const off = angleDiff(L, e.boss.facing);
          if (first === null) first = off;
          if (prev !== null) assert.ok(off > prev, '한 방향으로만 쓴다');
          prev = off;
          last = off;
          assert.ok(Math.abs(off - (-0.95 + 1.9 * Math.min(1, tA / 1.5))) < 1e-6, `선형 회전 tA ${tA}`);
        }
        if (k.phase === 'recovery') {
          assert.ok(Math.abs(angleDiff(L, e.boss.facing) - 0.95) < 1e-9, '후딜에는 끝 방향에 머문다(등이 비어 있다)');
          assert.equal(getBossHits(e.ctx).length, 0);
        }
      });
      assert.ok(lockedTele > 0);
      assert.ok(Math.abs(first - (-0.95)) < 0.03, `판정 시작 각 ${first}`);
      assert.ok(Math.abs(last - 0.95) < 0.03, `판정 끝 각 ${last}`);
      assert.ok(Math.abs((last - first) - 1.9) < 0.05, `쓸린 각 ${last - first}`);
      assert.equal(atk.active, 1.5);
      const start = e.ctx.events.find((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'beam_start').payload;
      assert.deepEqual([start.length, start.width, start.socket, start.seq], [22, 1.2, 'handL', atk.seq]);
      assert.ok(Math.abs(angleDiff(L, start.facing) + 0.95) < 0.03, '광선은 오른쪽 끝에서 켜진다');
    }
  });

  test('가만히 서 있으면 쓸리는 중간에 맞고, 광선이 지나가는 시간은 구르기 무적 창 안이다', () => {
    const w = NIHIL.attacks.beam_sweep.track.sweep;
    const omega = (w.to - w.from) / NIHIL.attacks.beam_sweep.active;
    for (const d of [5, 8, 12, 18]) {
      const e = fight({ d });
      const touchedAt = [];
      runAttack(e, 'beam_sweep', null, (k) => { if (e.stats.now) touchedAt.push(k.t - k.windup); });
      assert.ok(touchedAt.length > 0, `거리 ${d}: 서 있으면 맞는다`);
      const exposure = touchedAt.length * DT;
      assert.ok(touchedAt[0] > 0.45 && touchedAt[touchedAt.length - 1] < 1.05, `거리 ${d}: 쓸리는 중간(0.75초 근처)에 지나간다`);
      assert.ok(exposure <= IFRAME + 1e-9, `거리 ${d}: 광선이 머무는 ${exposure.toFixed(3)}초 ≤ 무적 창 ${IFRAME}초`);
      // 산식: 지나가는 시간 ≈ 2 × asin((판정 반경 + 플레이어 반경) / 거리) / 각속도
      const expect = (2 * Math.asin((0.6 + PLAYER.radius) / d)) / omega;
      assert.ok(Math.abs(exposure - expect) < 3 * DT, `거리 ${d}: ${exposure} vs ${expect}`);
    }
  });

  test('부채 밖 · 등 뒤 · 몸에 붙은 옆자리는 안전하다(광선을 쏘는 동안이 접근 기회)', () => {
    // 고정된 뒤 부채 밖(정면 기준 1.3 rad)으로 빠져 있으면 닿지 않는다
    for (const a of [1.3, -1.3, Math.PI]) {
      const e = fight({ d: 6 });
      let touched = 0;
      runAttack(e, 'beam_sweep', (x) => {
        const k = x.boss.attack;
        if (!k || !k.locked) return;
        const L = k.fw.lockFacing;
        x.player.pos.x = x.boss.pos.x + Math.sin(L + a) * 6;
        x.player.pos.z = x.boss.pos.z + Math.cos(L + a) * 6;
      }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched, 0, `각 ${a}`);
    }
  });
});

describe('검 비 · 지면 폭발', () => {
  test('검 비: 10자루가 0.2초 간격으로, 첫 자루는 플레이어 자리 · 나머지는 그 순간의 플레이어 둘레 6m 안', () => {
    const e = fight({ d: 12, seed: 7 });
    const at = [];
    const where = [];
    runAttack(e, 'sword_rain', (x) => { x.player.pos.x += WALK * DT; }, (k) => {
      while (at.length < e.ctx.spawned.hazards.length) {
        at.push(k.t - k.windup);
        where.push({ ...e.player.pos });
      }
    });
    const hz = e.ctx.spawned.hazards;
    assert.equal(hz.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.ok(Math.abs(at[i] - i * 0.2) < DT + 1e-9, `검 ${i} tA = ${at[i]}`);
      assert.equal(hz[i].kind, 'void_sword');
      assert.equal(hz[i].state, 'warn');
      assert.equal(hz[i].warn, 0.7);
      assert.equal(hz[i].shape.r, 1.3);
      // 장판 위치는 그 틱의 플레이어 위치 기준(mover가 먼저 움직인다)
      assert.ok(dist(hz[i].x, hz[i].z, where[i].x, where[i].z) <= 6 + 1e-6, `검 ${i}는 플레이어 둘레 6m 안`);
    }
    assert.ok(dist(hz[0].x, hz[0].z, where[0].x, where[0].z) < 1e-9, '첫 자루는 플레이어 발밑');
    // 흩어진다: 전부 한 점이 아니다
    const spread = Math.max(...hz.map((h) => dist(h.x, h.z, where[0].x, where[0].z)));
    assert.ok(spread > 3, `검이 흩어진다 ${spread}`);
  });

  test('대격변(2페이즈): 검 12자루 + 지면 폭발 4발이 겹친다', () => {
    const e = fight({ d: 12, phase: 2, seed: 5 });
    const at = { void_sword: [], void_burst: [] };
    let seen = 0;
    runAttack(e, 'cataclysm', null, (k) => {
      while (seen < e.ctx.spawned.hazards.length) at[e.ctx.spawned.hazards[seen++].kind].push(k.t - k.windup);
    });
    assert.equal(at.void_sword.length, 12);
    assert.equal(at.void_burst.length, 4);
    for (let i = 0; i < 12; i++) assert.ok(Math.abs(at.void_sword[i] - i * 0.2) < DT + 1e-9);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(at.void_burst[i] - (0.3 + i * 0.6)) < DT + 1e-9);
    for (const h of e.ctx.spawned.hazards) assert.ok(Math.abs(h.damage - (h.kind === 'void_sword' ? 24 : 36) * 1.12) < 1e-9, '2페이즈 피해 배율');
    assert.equal(e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar' && x.payload.attackId === 'cataclysm').length, 1);
  });

  test('지면 폭발: 발밑을 0.3초 앞질러 쫓는다 — 서 있으면 3발 다 맞고, 달리거나 걷던 방향을 버리면 안 맞는다', () => {
    const still = fight({ d: 12 });
    runAttack(still, 'ground_burst');
    for (const h of still.ctx.spawned.hazards) assert.ok(shapeHitsCircle(h.shape, still.player.pos.x, still.player.pos.z, still.player.radius));

    /**
     * 플레이어를 mover로 움직이며 지면 폭발을 끝까지 본다. 장판의 경고 → 판정 시각은 §3.6의 규칙(warn 뒤 active초)으로 흉내 낸다.
     * @returns {{hit:number, live:{h:any, t:number}[], edge:number[]}} edge = 터지는 순간 장판 중심까지의 거리
     */
    const bursts = (mover) => {
      const e = fight({ d: 12 });
      /** @type {{h:any, t:number}[]} */
      const live = [];
      const edge = [];
      let seen = 0;
      let hit = 0;
      const tick = () => {
        while (seen < e.ctx.spawned.hazards.length) live.push({ h: e.ctx.spawned.hazards[seen++], t: 0, px: e.player.pos.x });
        for (const l of live) {
          const was = l.t >= l.h.warn - 1e-9;
          l.t += DT;
          const active = l.t >= l.h.warn - 1e-9 && l.t < l.h.warn + l.h.active - 1e-9;
          if (active && !was) edge.push(dist(l.h.x, l.h.z, e.player.pos.x, e.player.pos.z));
          if (active && shapeHitsCircle(l.h.shape, e.player.pos.x, e.player.pos.z, e.player.radius + 0.05)) hit += 1;
        }
      };
      runAttack(e, 'ground_burst', mover, tick);
      for (let i = 0; i < 90; i++) { step(e, mover); tick(); }
      assert.equal(live.length, 3);
      return { hit, live, edge };
    };

    // 달린다: 장판이 앞에 깔려도 터지기 전에 지나간다
    const sprint = bursts((x) => { x.player.pos.x += SPRINT * DT; });
    assert.equal(sprint.hit, 0, '달리면 지면 폭발에 맞지 않는다');
    // 걷다가 원이 보이면 돌아서 반대로 걷는다(첫 원이 뜬 뒤 한 번)
    let turned = 1;
    const back = bursts((x) => {
      if (x.ctx.spawned.hazards.length > 0 && turned === 1) turned = -1;
      x.player.pos.x += turned * WALK * DT;
    });
    assert.ok(back.edge[0] > 2.6 + PLAYER.radius + 1, `돌아서면 첫 폭발에서 멀리 벗어난다 ${back.edge[0]}`);

    // 걷던 방향 그대로면 0.3초 앞(1.5m)에 깔린 원의 가장자리에 걸린다 — 방향을 바꾸거나 달리라는 뜻이다
    const walk = bursts((x) => { x.player.pos.x += WALK * DT; });
    const xs = walk.live.map((l) => l.h.x);
    assert.ok(xs[1] > xs[0] + 1.5 && xs[2] > xs[1] + 1.5, `걷는 플레이어를 따라간다 ${xs}`);
    for (const l of walk.live) assert.ok(Math.abs((l.h.x - l.px) - WALK * 0.3) < WALK * DT * 2 + 1e-6, `0.3초 앞을 겨눈다 ${l.h.x - l.px}`);
    for (const d of walk.edge) assert.ok(Math.abs(d - (2.6 + PLAYER.radius)) < 0.2, `터지는 순간 가장자리 ${d.toFixed(2)}m`);
  });
});

describe('부유 — boss.y === hoverY', () => {
  test('모든 상태에서: 인트로 · 공격 · 추격 · 패링당함 없음 · 그로기 · 처형 · 회복 · 페이즈 전환 · 사망', () => {
    const e = fight({ intro: true, seed: 2 });
    assert.equal(e.boss.y, 0, '생성 직후(첫 틱 전)에는 프레임워크의 0이다');
    step(e); // step이 매 틱 boss.y === hoverY를 단언한다
    assert.equal(e.boss.state, 'intro');
    assert.deepEqual({ hoverY: e.boss.ext.hoverY, crowdT: e.boss.ext.crowdT }, { hoverY: 0.8, crowdT: 0 });
    run(e, 20, pursue(WALK, 2));
    const seen = new Set();
    const watch = () => seen.add(e.boss.state);
    // 그로기 → 처형 → 회복
    e.boss.posture = e.boss.postureMax;
    for (let i = 0; i < 30; i++) { step(e); watch(); }
    assert.equal(e.boss.state, 'groggy');
    onBossDamaged(e.ctx, hitResult({ execute: true }));
    for (let i = 0; i < 150; i++) { step(e); watch(); }
    // 페이즈 전환
    e.boss.hp = Math.round(e.boss.hpMax * 0.4);
    for (let i = 0; i < 600 && e.boss.phase === 1; i++) { step(e); watch(); }
    assert.equal(e.boss.phase, 2);
    for (let i = 0; i < 400; i++) { step(e, pursue(WALK, 2)); watch(); }
    // 사망
    e.boss.hp = 0;
    for (let i = 0; i < 200; i++) { step(e); watch(); }
    assert.equal(e.boss.state, 'dead');
    for (const s of ['groggy', 'executed', 'recover', 'phaseShift', 'attack', 'dead']) assert.ok(seen.has(s), `${s}를 거쳤다`);
    assert.ok(seen.has('idle') || seen.has('chase'), '고민(제자리 idle 또는 걸으며 chase)을 거쳤다');
    assert.equal(e.boss.y, HOVER);
    structuredClone(e.state);
    assertFiniteDeep(e.state);
  });

  test('ext는 순수 값이고, onCreate를 거치지 않은 상태(손수 만든 ext)도 받는다', () => {
    const e = fight({ d: 10 });
    e.boss.fw = { created: true, seq: 0, strafeT: 0 }; // onCreate를 건너뛴 것처럼
    e.boss.ext = {};
    step(e);
    assert.equal(e.boss.y, HOVER);
    assert.equal(e.boss.ext.hoverY, 0.8);
    assert.equal(e.boss.ext.crowdT, 0);
    assert.deepEqual(structuredClone(e.boss.ext), e.boss.ext);
  });
});

function hitResult(over = {}) {
  return {
    source: 'player', target: 'boss', outcome: 'hit', damage: 10, rawDamage: 10, posture: 0, staminaDamage: 0, crit: false,
    heavy: false, execute: false, knockdown: false, guardBreak: false, postureBroken: false, lethal: false,
    x: 0, z: 0, y: 1.5, dir: 0, attackId: 'light1', hitId: 999, ...over,
  };
}

// ───────────────────────────────────────────────────────────── 2페이즈

describe('2페이즈', () => {
  test('HP 50%에서 전환 → 배율 · 포효 · 신규 패턴(blink_strike · cataclysm · 구체 5발)', () => {
    const e = fight({ d: 12, seed: 5 });
    run(e, 3);
    e.boss.hp = 1200;
    onBossDamaged(e.ctx, hitResult());
    assert.equal(e.boss.pendingPhase, true);
    let guard = 0;
    while (e.boss.state !== 'phaseShift') {
      step(e);
      assert.ok(++guard < 900);
    }
    assert.equal(e.boss.phase, 2);
    assert.equal(e.boss.invulnerable, true);
    assert.ok(Math.abs(e.boss.dmgMul - 1.12) < 1e-9 && Math.abs(e.boss.speedMul - 1.10) < 1e-9);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_PHASE_CHANGED), 1);
    run(e, NIHIL.phaseShiftDur + 0.1);
    assert.notEqual(e.boss.state, 'phaseShift');
    assert.ok(e.ctx.events.some((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar' && x.payload.attackId === ''), '전환 포효');

    const p0 = e.ctx.spawned.projectiles.length;
    const s = run(e, 90, null);
    for (const id of P2_ONLY) assert.ok(s.ids.includes(id), `${id}가 나와야 한다 (${s.text})`);
    assert.ok(e.ctx.spawned.projectiles.length > p0);
    // blink_strike 뒤에는 언제나 void_nova
    const order = e.stats.order;
    for (let i = 0; i < order.length - 1; i++) if (order[i] === 'blink_strike') assert.equal(order[i + 1], 'void_nova');
  });

  test('2페이즈 전용 공격은 1페이즈에서 선택되지 않는다', () => {
    for (const [d, a] of [[1.5, 0], [3, 0.5], [4.4, 0], [2, Math.PI], [6, 0], [9, 0], [12, 0.4], [15, 0], [20, 0]]) {
      for (let seed = 1; seed <= 3; seed++) {
        const e = fight({ d, a, seed });
        const follow = d < 5 ? pursue(WALK, d) : null;
        for (let i = 0; i < 40 * 60; i++) {
          step(e, follow);
          const k = e.boss.attack;
          // 1페이즈에는 구체 → 광선 연계가 없다. 연속기는 blink 뒤의 시전뿐이다
          if (k && k.chained) assert.ok(['void_orbs', 'ground_burst'].includes(k.id) && e.stats.order.at(-2) === 'blink', `1페이즈 연속기 ${e.stats.order.slice(-2)}`);
        }
        const s = summary(e);
        assertFiniteDeep(e.state);
        for (const id of P2_ONLY) assert.equal(s.ids.includes(id), false, `1페이즈에 ${id} (d ${d})`);
        assert.equal(e.boss.phase, 1);
        // 1페이즈의 void_orbs는 3발씩이다
        assert.equal(e.ctx.spawned.projectiles.length, (e.stats.attacks.void_orbs?.n ?? 0) * 3 - pendingOrbs(e));
      }
    }
  });

  /** 지금 진행 중인 void_orbs가 아직 쏘지 않은 구체 수(판을 공격 도중에 끊었을 때의 보정). */
  function pendingOrbs(e) {
    const k = e.boss.attack;
    if (!k || k.id !== 'void_orbs') return 0;
    const tA = k.t - k.windup;
    if (tA < -1e-9) return 3;
    return 3 - Math.min(3, Math.floor(tA / 0.25 + 1e-6) + 1);
  }
});

// ───────────────────────────────────────────────────────────── 60초

describe('가만히 서 있는 플레이어를 상대로 60초', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`시드 ${seed}: 공격 4종 이상 · 플레이어 원과 겹치는 판정 · 선호 거리 안으로는 다가오지 않는다`, () => {
      const e = fight({ intro: true, seed });
      step(e);
      assert.equal(e.boss.state, 'intro');
      assert.equal(e.boss.invulnerable, true);
      const start = { ...e.boss.pos };
      const s = run(e, 60);
      assert.ok(s.ids.length >= 4, `공격 ${s.ids.length}종 (${s.text})`);
      assert.ok(s.hits >= 1, '겹치는 판정이 한 번 이상');
      assert.ok(s.total >= 12, `60초에 공격 ${s.total}번`);
      assert.ok(s.hitRate >= 0.9, `서 있는 상대에게는 거의 다 닿는다 (${s.text})`);
      assert.ok(s.topShare <= 0.5, `한 공격만 반복하지 않는다 (${s.text})`);
      assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), countEvents(e.ctx.events, EV.BOSS_ATTACK_END) + (e.boss.attack ? 1 : 0));
      const seqs = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_WINDUP).map((x) => x.payload.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'seq는 1부터 하나씩');
      assert.ok(e.ctx.events.some((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar'), '인트로 포효');
      assert.equal(countEvents(e.ctx.events, EV.BOSS_STEP), 0, '부유체는 발소리가 없다');
      // 원거리형(W3): 21m에서 그대로 쏘되, 고민하는 동안 선호 거리(preferredRange + approachBand = 11m)까지는 떠서 다가온다.
      // 그 안으로는 들어오지 않는다(붙는 것은 플레이어의 일이다).
      const dEnd = dist(e.boss.pos.x, e.boss.pos.z, e.player.pos.x, e.player.pos.z);
      const dStart = dist(start.x, start.z, e.player.pos.x, e.player.pos.z);
      const band = NIHIL.preferredRange + BOSS_AI.approachBand;
      assert.ok(dEnd <= dStart + 1e-6, '물러나지는 않는다');
      assert.ok(dEnd >= Math.min(dStart, band) - 0.1, `선호 거리 ${band}m 안으로 걸어 들어오지 않는다 (${dEnd.toFixed(2)})`);
      structuredClone(e.state);
    });
  }
});

// ───────────────────────────────────────────────────────────── 훅: 밀착 대응 · 거리 벌리기

describe('훅 — 밀착하면 떼어 낸다(crowd)', () => {
  test('crowdT는 3.5m 안에서만 쌓이고 벗어나면 0이 된다', () => {
    const e = fight({ d: 3.4 });
    for (let i = 0; i < 30; i++) updateBoss(e.ctx, DT);
    assert.ok(Math.abs(e.boss.ext.crowdT - 30 * DT) < 1e-9);
    e.player.pos.z = 3.6;
    updateBoss(e.ctx, DT);
    assert.equal(e.boss.ext.crowdT, 0);
  });

  test('forceAttack: 1.5초 넘게 붙어 있으면 blink(쿨다운 0) 또는 void_nova · 그 전에는 null', () => {
    const e = fight({ d: 2 });
    step(e);
    e.boss.ext.crowdT = 1.5;
    assert.equal(nihilHooks.forceAttack(e.ctx), null, '정확히 1.5초는 아직이다');
    e.boss.ext.crowdT = 1.51;
    e.boss.cooldowns = {};
    assert.equal(nihilHooks.forceAttack(e.ctx), 'blink');
    assert.equal(e.boss.ext.crowdT, 0, '강제한 뒤에는 다시 센다');
    e.boss.ext.crowdT = 1.51;
    e.boss.cooldowns = { blink: 0 };
    assert.equal(nihilHooks.forceAttack(e.ctx), 'blink');
    e.boss.ext.crowdT = 1.51;
    e.boss.cooldowns = { blink: 2.2 };
    assert.equal(nihilHooks.forceAttack(e.ctx), 'void_nova');
    e.boss.ext.crowdT = 0.4;
    assert.equal(nihilHooks.forceAttack(e.ctx), null);
  });

  test('몸에 붙어 다니는 플레이어: 1.5초 넘게 붙은 뒤의 선택은 언제나 blink 아니면 void_nova다 · 끝없이 붙어 있게 두지 않는다', () => {
    for (const phase of [1, 2]) {
      for (const seed of [1, 2, 3]) {
        const e = fight({ d: 2, phase, seed });
        let close = 0;
        let worst = 0;
        let forced = 0;
        const hug = pursue(SPRINT, 2);
        for (let i = 0; i < 60 * 60; i++) {
          const before = e.boss.attack;
          const crowd = e.boss.ext.crowdT ?? 0; // 이번 틱의 선택이 보는 값(지난 틱까지 쌓인 시간)
          step(e, hug);
          const k = e.boss.attack;
          if (k && k !== before && !k.chained && crowd > NIHIL_EXT.crowdTime) {
            forced += 1;
            assert.ok(k.id === 'blink' || k.id === 'void_nova', `${crowd.toFixed(2)}초 붙어 있었는데 ${k.id}`);
          }
          const d = dist(e.player.pos.x, e.player.pos.z, e.boss.pos.x, e.boss.pos.z);
          close = d < NIHIL_EXT.crowdRange ? close + DT : 0;
          worst = Math.max(worst, close);
        }
        const s = summary(e);
        const n = (id) => e.stats.attacks[id]?.n ?? 0;
        assert.ok(forced >= 8, `강제 ${forced}번 (${s.text})`);
        assert.ok(n('blink') >= 5, `blink ${n('blink')}번 (${s.text})`);
        assert.ok(n('void_nova') >= 4, `void_nova ${n('void_nova')}번 (${s.text})`);
        // 가장 긴 경우: 붙은 채 시작된 긴 시전(검 비 4.3초) + 고민 + 강제 폭발(2.5초) + 고민 + blink 예고
        assert.ok(worst <= 10, `${phase}페이즈 시드 ${seed}: ${worst.toFixed(2)}초 동안 붙어 있었다 (${s.text})`);
        // blink는 쿨다운(5초)보다 자주 나오지 않는다
        assert.ok(n('blink') <= Math.ceil(60 / 5) + 1);
      }
    }
  });
});

describe('거리를 벌린다(kite) — W3: 프레임워크의 「걸으며 고민」', () => {
  test('공격을 끝냈을 때 플레이어가 6m 안이면 고민하는 동안 뒤로 물러났다가 다음 공격을 고른다', () => {
    const e = fight({ d: 12, seed: 3 });
    runAttack(e, 'ground_burst');
    // 후딜 사이에 플레이어가 4.5m까지 들어왔다(붙지는 않는다)
    e.player.pos.z = e.boss.pos.z + 4.5;
    e.player.pos.x = e.boss.pos.x;
    const d0 = 4.5;
    let chaseTicks = 0;
    let retreatTicks = 0;
    let guard = 0;
    while (e.boss.state !== 'attack') {
      step(e);
      if (e.boss.state === 'chase') {
        chaseTicks += 1;
        // chase에 들어선 틱은 아직 'hold'다(다음 틱부터 움직인다). 6m까지 벌어지면 남은 고민 시간은 옆으로 돈다(strafe)
        assert.ok(['retreat', 'hold', 'strafe'].includes(e.boss.moveIntent), e.boss.moveIntent);
        if (e.boss.moveIntent === 'retreat') retreatTicks += 1;
      }
      assert.ok(++guard < 300);
    }
    const d1 = dist(e.player.pos.x, e.player.pos.z, e.boss.pos.x, e.boss.pos.z);
    assert.ok(d1 <= NIHIL.preferredRange * BOSS_AI.kiteNear + NIHIL.moveSpeed * DT + 1e-6, '6m까지만 물러난다');
    // 물러나는 시간 = 고민 시간(think 0.6~1.0초)
    assert.ok(chaseTicks * DT >= NIHIL.think[0] - DT && chaseTicks * DT <= NIHIL.think[1] + 2 * DT, `물러난 시간 ${(chaseTicks * DT).toFixed(2)}초`);
    assert.ok(d1 > d0 + 1.2, `거리 ${d0} → ${d1.toFixed(2)}`);
    assert.ok(Math.abs((d1 - d0) - NIHIL.moveSpeed * retreatTicks * DT) < 0.1, '물러나는 속력 = moveSpeed');
  });

  test('플레이어가 선호 거리 띠(6~11m) 안이면 움직이지 않고 바로 쏜다(원거리 압박이 느슨해지지 않는다)', () => {
    for (const d of [6.5, 10]) {
      const e = fight({ d, seed: 2 });
      const s = run(e, 40, null);
      assert.equal(e.stats.chase, 0, `거리 ${d}: chase ${e.stats.chase}틱 (${s.text})`);
    }
  });

  test('5m를 유지하며 따라오는 플레이어: 물러나기와 공격이 번갈아 나온다(추격만 하지도, 서 있기만 하지도 않는다)', () => {
    for (const phase of [1, 2]) {
      const e = fight({ d: 5, phase, seed: 4 });
      const s = run(e, 60, pursue(WALK, 5));
      assert.ok(s.chaseShare >= 0.08 && s.chaseShare <= 0.35, `chase ${s.chaseShare.toFixed(2)} (${s.text})`);
      assert.ok(s.total >= 10, `공격 ${s.total}번`);
      assert.equal(e.stats.order.includes('void_orbs'), true);
    }
  });

  test('훅은 후보를 건드리지 않는다(adjustWeights 없음) — 밀착 대응만 강제한다', () => {
    assert.equal(nihilHooks.adjustWeights, undefined);
    assert.equal(nihilHooks.onAttackStart, undefined);
    assert.equal(typeof nihilHooks.forceAttack, 'function');
  });
});

// ───────────────────────────────────────────────────────────── AI 분포

describe('AI 선택 분포 — 합성 플레이어를 거리 격자에 두고 수백 번', () => {
  /** 한 자리(d, a)에서 n번 선택한다. 고를 때마다 그 공격의 실제 길이 + 평균 고민 시간만큼 쿨다운을 흘려보낸다. */
  function sample(d, a, phase, n = 400, seed = 9) {
    const e = fight({ d, a, phase, seed });
    const boss = e.boss;
    const speed = phase === 2 ? NIHIL.phase2.speedMul : 1;
    const think = ((NIHIL.think[0] + NIHIL.think[1]) / 2) * (phase === 2 ? NIHIL.phase2.thinkMul : 1);
    /** @type {Record<string, number>} */
    const counts = {};
    let none = 0;
    for (let i = 0; i < n; i++) {
      const id = selectAttack(e.ctx);
      let elapsed = BOSS_AI.reselect;
      if (id) {
        const def = NIHIL.attacks[id];
        counts[id] = (counts[id] ?? 0) + 1;
        boss.cooldowns[id] = def.sel.cooldown;
        boss.lastAttacks.unshift(id);
        boss.lastAttacks.length = Math.min(2, boss.lastAttacks.length);
        elapsed = def.windup / speed + def.active + def.recovery / speed + think;
      } else {
        none += 1;
      }
      for (const k of Object.keys(boss.cooldowns)) boss.cooldowns[k] = Math.max(0, boss.cooldowns[k] - elapsed);
    }
    const ids = Object.keys(counts);
    const picks = n - none;
    const top = ids.reduce((m, k) => Math.max(m, counts[k]), 0);
    return { counts, ids, none: none / n, topShare: picks ? top / picks : 0, text: JSON.stringify(counts) };
  }

  test('먼 거리(6~20m): 구체 · 광선 · 지면 폭발 · 검 비가 섞인다 — 언제나 후보가 있다', () => {
    for (const d of [6, 9, 13, 18, 21]) {
      const p1 = sample(d, 0, 1);
      assert.equal(p1.none, 0, `d ${d}`);
      for (const id of ['void_orbs', 'beam_sweep', 'ground_burst', 'sword_rain']) assert.ok(p1.counts[id] > 0, `1페이즈 d ${d}: ${p1.text}`);
      assert.ok(p1.topShare <= 0.55, `1페이즈 d ${d}: ${p1.text}`);
      for (const id of ['blink', 'void_nova', 'scythe_slash', ...P2_ONLY]) assert.equal(p1.counts[id], undefined, `1페이즈 d ${d}: ${p1.text}`);
      const p2 = sample(d, 0, 2);
      for (const id of ['void_orbs', 'beam_sweep', 'ground_burst', 'sword_rain', 'blink_strike', 'cataclysm']) assert.ok(p2.counts[id] > 0, `2페이즈 d ${d}: ${p2.text}`);
      assert.ok(p2.topShare <= 0.5, `2페이즈 d ${d}: ${p2.text}`);
    }
  });

  test('근접(0~4.2m): 순간이동 · 폭발 · 낫이 나온다 — 구체 · 광선은 쓰지 않는다', () => {
    for (const d of [1.3, 2.5, 3.8]) {
      for (const phase of [1, 2]) {
        const s = sample(d, 0, phase);
        assert.equal(s.none, 0);
        for (const id of ['blink', 'void_nova', 'scythe_slash']) assert.ok(s.counts[id] > 0, `d ${d}: ${s.text}`);
        assert.equal(s.counts.void_orbs, undefined);
        assert.equal(s.counts.beam_sweep, undefined);
        assert.equal(s.counts.blink_strike, undefined, '등 뒤 순간이동은 먼 거리에서만');
        assert.ok(s.topShare <= 0.5, `d ${d}: ${s.text}`);
      }
    }
    // 등 뒤에 붙으면 낫(정면 1.4 rad)은 못 쓰지만 폭발 · 순간이동이 있다
    const back = sample(2, Math.PI, 1);
    assert.equal(back.counts.scythe_slash, undefined);
    assert.ok(back.counts.void_nova > 0 && back.counts.blink > 0);
  });

  test('광선은 정면 1.0 rad 안에 있을 때만 고른다', () => {
    assert.equal(sample(10, 1.2, 1).counts.beam_sweep, undefined);
    assert.ok(sample(10, 0.9, 1).counts.beam_sweep > 0);
  });
});

// ───────────────────────────────────────────────────────────── 읽고 · 피하고 · 붙는다

describe('원거리 압박과 틈 찾기 — 예고가 읽히고, 피할 수 있고, 붙을 틈이 있다', () => {
  test('모든 공격: 예고 ≥ 0.4초 · 고정 뒤에는 추적하지 않는다 · 후딜에는 판정이 없고 움직이지 않는다', () => {
    for (const phase of [1, 2]) {
      for (const id of ATTACK_IDS) {
        const def = NIHIL.attacks[id];
        const d = Math.max(2.5, Math.min(14, (def.sel.minRange + def.sel.maxRange) / 2));
        const e = fight({ d, phase, seed: 2 });
        let lockedAt = null;
        let lockedFacing = null;
        let recoveryTicks = 0;
        let recoveryPos = null;
        const atk = runAttack(e, id, orbit(d, WALK), (k) => {
          const tA = k.t - k.windup;
          if (k.locked && lockedAt === null) {
            lockedAt = tA;
            lockedFacing = e.boss.facing;
          }
          // 광선은 스스로 쓸고(위 테스트), 순간이동은 나타나며 돌아본다 — 그 밖에는 고정 뒤 회전이 없다
          if (k.locked && !def.track.sweep && !TELEPORTS[id]) assert.equal(e.boss.facing, lockedFacing, `${id}: 고정 뒤 회전`);
          if (k.phase === 'recovery') {
            recoveryTicks += 1;
            assert.equal(getBossHits(e.ctx).length, 0, `${id}: 후딜에 판정이 남아 있다`);
            recoveryPos = recoveryPos ?? { ...e.boss.pos };
            assert.deepEqual(e.boss.pos, recoveryPos, `${id}: 후딜에 움직인다`);
          }
        });
        assert.ok(atk.windup >= 0.4, `${id}: 예고 ${atk.windup}`);
        assert.ok(lockedAt !== null && lockedAt >= -def.track.lockLead - 1e-9 && lockedAt < -def.track.lockLead + DT + 1e-9, `${id}: 고정 시각 ${lockedAt}`);
        // 반격 창: 순간이동 둘을 빼면 2페이즈의 배속을 받아도 후딜이 0.9초는 남는다
        if (!TELEPORTS[id]) assert.ok(atk.recovery >= 0.9 && (recoveryTicks * DT >= 0.9 || def.chain.length > 0), `${id}: 후딜 ${atk.recovery}초`);
      }
    }
  });

  test('시전 공격은 직접 타격이 없다 — 시전하는 동안 몸은 무방비다(달려 들어가 때릴 수 있다)', () => {
    for (const id of ['void_orbs', 'ground_burst', 'sword_rain', 'cataclysm', 'blink', 'blink_strike']) {
      assert.deepEqual(NIHIL.attacks[id].hits, [], id);
      assert.equal(NIHIL.attacks[id].move, null, id);
    }
    // 긴 시전일수록 틈이 길다: 예고 + 판정 + 후딜
    const total = (id) => NIHIL.attacks[id].windup + NIHIL.attacks[id].active + NIHIL.attacks[id].recovery;
    assert.ok(total('sword_rain') >= 4 && total('cataclysm') >= 5.5 && total('beam_sweep') >= 4);
  });

  test('심연 폭발: 예고를 보고 달리면 붙어 있던 자리에서도 벗어난다 · 판정 창은 구르기 무적 창 안 · 서 있으면 맞는다', () => {
    const nova = NIHIL.attacks.void_nova;
    assert.ok(nova.hits[0].t1 - nova.hits[0].t0 <= IFRAME - 2 * DT, '구르기 한 번으로 넘긴다');
    for (const phase of [1, 2]) {
      const still = fight({ d: 2.5, phase });
      let hit = 0;
      runAttack(still, 'void_nova', null, () => { if (still.stats.now) hit += 1; });
      assert.ok(hit > 0, '서 있으면 맞는다');

      for (const d of [1.2, 2.5, 4]) {
        // 반응 0.2초 뒤 보스 반대로 달린다
        const e = fight({ d, phase });
        let touched = 0;
        runAttack(e, 'void_nova', (x) => {
          const k = x.boss.attack;
          if (!k || k.id !== 'void_nova' || k.t < 0.2) return;
          const dx = x.player.pos.x - x.boss.pos.x;
          const dz = x.player.pos.z - x.boss.pos.z;
          const l = Math.hypot(dx, dz) || 1;
          x.player.pos.x += (dx / l) * SPRINT * DT;
          x.player.pos.z += (dz / l) * SPRINT * DT;
        }, () => { if (e.stats.now) touched += 1; });
        // 1페이즈는 어디서든, 2페이즈(예고 0.77초)는 몸에 붙은 자리(1.2m)만 못 벗어난다 → 구른다
        if (phase === 1 || d >= 2.5) assert.equal(touched, 0, `${phase}페이즈 거리 ${d}: 달려서 벗어난다`);
      }
    }
    // 폭발 뒤 1.5초(2페이즈 1.36초)가 니힐의 가장 큰 근접 반격 창이다
    assert.ok(nova.recovery / NIHIL.phase2.speedMul >= 1.3);
  });

  test('낫 베기: 사거리 끝(4.0m)에서도 닿고, 등 뒤는 치지 못한다', () => {
    for (const d of [1.3, 2.8, 4.0]) {
      const e = fight({ d });
      let touched = 0;
      runAttack(e, 'scythe_slash', null, () => { if (e.stats.now) touched += 1; });
      assert.ok(touched > 0, `거리 ${d}`);
    }
    const e = fight({ d: 2.2 });
    let touched = 0;
    runAttack(e, 'scythe_slash', (x) => {
      const k = x.boss.attack;
      if (k && k.locked) glue(2.2, Math.PI)(x);
    }, () => { if (e.stats.now) touched += 1; });
    assert.equal(touched, 0, '고정 뒤 등 뒤로 돌아 들어가면 빗나간다');
  });

  test('검 비: 경고(0.7초) 동안 걸어서 원(1.3m)을 벗어난다 — 한 자루씩 읽고 피한다', () => {
    const sword = NIHIL.attacks.sword_rain.events[1].hazard;
    assert.ok(WALK * sword.warn >= (sword.shape.r + PLAYER.radius) * 2, '원의 지름을 가로질러도 걸어서 나온다');
    const burst = NIHIL.attacks.ground_burst.events[1].hazard;
    assert.ok(WALK * burst.warn >= burst.shape.r + PLAYER.radius, '지면 폭발: 중심에서 걸어 나온다');
    assert.ok(sword.active <= IFRAME && burst.active <= IFRAME, '장판의 판정 창도 구르기 무적 안');
  });

  test('순간이동 직후: 1초 안에는 어떤 피해도 들어오지 않는다(나타난 자리로 달려갈 시간이다)', () => {
    for (const phase of [1, 2]) {
      for (let seed = 1; seed <= 12; seed++) {
        const e = fight({ d: 2.5, seed, phase });
        const chaseDown = pursue(SPRINT, 1.5);
        e.ctx.bossHooks = { ...nihilHooks, forceAttack: () => 'blink' };
        step(e, chaseDown);
        e.ctx.bossHooks = nihilHooks;
        let since = null; // 순간이동 뒤 경과(초)
        let harmAt = null;
        let gap = null;
        for (let i = 0; i < 240; i++) {
          const tp = e.stats.teleports;
          step(e, chaseDown);
          if (e.stats.teleports > tp) {
            since = 0;
            gap = dist(e.player.pos.x, e.player.pos.z, e.boss.pos.x, e.boss.pos.z);
            continue;
          }
          if (since === null) continue;
          since += DT;
          if (e.stats.harm && harmAt === null) harmAt = since;
        }
        assert.ok(gap > 8, `순간이동으로 ${gap.toFixed(1)}m 벌어졌다`);
        assert.ok(harmAt === null || harmAt >= 1.0, `${phase}페이즈 시드 ${seed}: 순간이동 뒤 ${harmAt}초에 피해`);
      }
    }
  });

  test('구체는 체간을 쌓는 수단이다: 체간 90 = 구체 6개(패링 15씩), 감쇠 지연이 구체 사이 간격보다 길다', () => {
    const per = 30 * COMBAT.projectileParryPostureMul; // 기본 parryPosture 30
    assert.equal(per, 15);
    assert.equal(Math.ceil(NIHIL.postureMax / per), 6);
    // void_orbs 쿨다운 3초 + 공격 길이 < 감쇠 지연 8초 — 두 번의 시전을 다 받아치면 그로기
    assert.ok(NIHIL.postureDecayDelay > NIHIL.attacks.void_orbs.sel.cooldown + 2.6);
  });
});

// ───────────────────────────────────────────────────────────── 뷰(nihilView.js) — Node에서 three만으로

describe('뷰 — 부유 리그 · pose 7종 · 상태 10종 · 소켓', () => {
  const BODY = NIHIL.height - NIHIL_EXT.hoverY;
  /** 지팡이 머리(수정)의 무기 소켓 로컬 높이 — nihilView.js의 STAFF_HEAD_Y */
  const STAFF_HEAD_Y = 1.5;
  const gstate = makeTestState({ bossDef: NIHIL });
  const v3 = new THREE.Vector3();

  /** 보스 상태 리터럴(원점 · +Z를 본다 · y = hoverY). */
  const bossAt = (over = {}) => makeTestBoss(NIHIL, { pos: { x: 0, z: 0 }, facing: 0, y: HOVER, ...over });
  /** 공격 한 순간의 보스 상태. */
  function attacking(id, phase, phaseT, seq = 1) {
    const ad = NIHIL.attacks[id];
    const t = phase === 'windup' ? ad.windup * phaseT : phase === 'active' ? ad.windup + ad.active * phaseT : ad.windup + ad.active + ad.recovery * phaseT;
    return bossAt({
      state: 'attack', stateTime: t, stateDur: ad.windup + ad.active + ad.recovery,
      attack: { id, seq, pose: ad.pose, glow: ad.glow, phase, phaseT, t, windup: ad.windup, active: ad.active, recovery: ad.recovery,
        locked: true, aimX: 0, aimZ: 5, chained: false, fired: [], hitIds: [] },
    });
  }
  /** CharacterLayer가 하듯 root에 위치 · 회전을 넣고 뷰를 frames번 돌린 뒤 월드 행렬을 갱신한다. */
  function drive(view, boss, frames = 60, dt = DT) {
    const info = { alpha: 1, dt, time: 0, state: gstate };
    for (let i = 0; i < frames; i++) {
      view.root.position.set(boss.pos.x, boss.y, boss.pos.z);
      view.root.rotation.y = boss.facing;
      view.update(boss, info);
    }
    view.root.updateMatrixWorld(true);
    return view;
  }
  const sock = (view, name) => v3.setFromMatrixPosition(view.rig.sockets[name].matrixWorld).clone();
  const staffHead = (view) => new THREE.Vector3(0, STAFF_HEAD_Y, 0).applyMatrix4(view.rig.sockets.weapon.matrixWorld);
  /** 뷰의 모든 월드 행렬이 유한한가. */
  function assertFiniteView(view, label) {
    view.root.traverse((o) => {
      for (const e of o.matrixWorld.elements) assert.ok(Number.isFinite(e), `${label}: ${o.name || o.type}의 행렬에 NaN`);
    });
  }
  /** 뷰에 그려지는 재질의 최소 불투명도. */
  function minOpacity(view) {
    let m = 1;
    view.rig.root.traverse((o) => {
      if (o.isMesh && o.visible && o.material.blending !== THREE.AdditiveBlending) m = Math.min(m, o.material.opacity);
    });
    return m;
  }

  test('NIHIL_POSES: §8.12의 pose 7종 · 공격 9종의 pose가 전부 있다 · 관절 이름은 부유 리그의 것', () => {
    assert.deepEqual(Object.keys(NIHIL_POSES).sort(), [...POSE_KEYS].sort());
    for (const id of ATTACK_IDS) assert.ok(NIHIL_POSES[NIHIL.attacks[id].pose], `${id}: ${NIHIL.attacks[id].pose}`);
    const view = createNihilView();
    const joints = Object.keys(view.rig.joints);
    for (const key of POSE_KEYS) {
      const set = NIHIL_POSES[key];
      for (const part of ['windup', 'active', 'follow']) {
        assert.ok(set[part], `${key}.${part}`);
        for (const j of Object.keys(set[part].rot)) assert.ok(joints.includes(j), `${key}.${part}: 모르는 관절 ${j}`);
        for (const j of Object.keys(set[part].pos ?? {})) assert.ok(joints.includes(j), `${key}.${part}: 모르는 관절 ${j}`);
      }
    }
    view.dispose();
  });

  test('부유 리그: hover 0 · height = def.height − hoverY(두 번 뜨지 않는다) · 표준 소켓', () => {
    const view = createNihilView();
    assert.ok(Math.abs(view.rig.height - BODY) < 1e-9);
    for (const s of ['weapon', 'weaponBase', 'weaponTip', 'head', 'chest', 'handL']) assert.ok(view.rig.sockets[s], `소켓 ${s}`);
    for (const j of ['core', 'chest', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'robe1', 'robe2', 'robe3', 'halo']) {
      assert.ok(view.rig.joints[j], `관절 ${j}`);
    }
    drive(view, bossAt({ state: 'idle' }));
    // 자락 끝(root 원점 근처)은 sim이 올린 높이만큼 지면에서 떠 있고, 머리는 def.height 근처다
    assert.equal(view.rig.root.position.y, 0, '대기 중에는 뷰가 따로 높이를 더하지 않는다');
    const head = sock(view, 'head');
    assert.ok(head.y > NIHIL.height - 0.35 && head.y < NIHIL.height + 0.45, `머리 높이 ${head.y}`);
    assert.equal(typeof view.update, 'function');
    assert.equal(typeof view.onEvent, 'function');
    assertFiniteView(view, 'idle');
    view.dispose();
  });

  test('상태 10종 · 공격 9종 × 세 구간: 예외 0 · NaN 0', () => {
    const view = createNihilView();
    const states = [
      ['intro', 0.2, 1.6], ['intro', 0.8, 1.6], ['idle', 0.3, 0.8], ['chase', 0.2, 0.3], ['parried', 0.3, 1.0], ['groggy', 2, 5],
      ['executed', 0.3, 1.2], ['recover', 0.4, 0.8], ['phaseShift', 0.3, 2.6], ['phaseShift', 1.2, 2.6], ['dead', 0.5, 0], ['dead', 3, 0],
    ];
    for (const [state, stateTime, stateDur] of states) {
      const boss = bossAt({ state, stateTime, stateDur, phase: state === 'phaseShift' ? 2 : 1 });
      if (state === 'chase') boss.prevPos = { x: 0.02, z: 0.03 }; // 움직이는 중(기울임 · 자락 끌림)
      drive(view, boss, 20);
      assertFiniteView(view, state);
    }
    let seq = 1;
    for (const id of ATTACK_IDS) {
      for (const [phase, pT] of [['windup', 0.2], ['windup', 0.95], ['active', 0.1], ['active', 0.9], ['recovery', 0.2], ['recovery', 0.9]]) {
        drive(view, attacking(id, phase, pT, seq), 12);
        assertFiniteView(view, `${id} ${phase}`);
      }
      seq += 1;
    }
    // 히트스톱 · 일시정지(dt 0) · 피격 이벤트도 견딘다
    view.onEvent(EV.HIT, { target: 'boss', outcome: 'hit', dir: 2.1, heavy: true });
    view.onEvent(EV.BOSS_TELEPORT, { fromX: 0, fromZ: 0, toX: 3, toZ: 3 });
    drive(view, bossAt({ state: 'idle' }), 5, 0);
    drive(view, bossAt({ state: 'idle' }), 30);
    assertFiniteView(view, 'idle after events');
    view.dispose();
  });

  test('모르는 pose 키가 와도 죽지 않는다(첫 포즈로 대신 · 경고는 한 번)', () => {
    const view = createNihilView();
    const boss = attacking('void_orbs', 'windup', 0.5);
    boss.attack.pose = 'slashR'; // 스텁 정의의 pose
    const warn = console.warn;
    let n = 0;
    console.warn = () => { n += 1; };
    try {
      drive(view, boss, 10);
    } finally {
      console.warn = warn;
    }
    assert.equal(n, 1);
    assertFiniteView(view, 'unknown pose');
    view.dispose();
  });

  test('시전 손(handL): 광선은 몸의 중심선 앞 · 플레이어 몸 높이에서 나가고, 구체는 발사점 가까이에서 떠난다', () => {
    const view = createNihilView();
    drive(view, attacking('beam_sweep', 'active', 0.5));
    const beam = sock(view, 'handL');
    assert.ok(Math.abs(beam.x) < 0.15, `광선 원점이 판정 선(중심선)에서 ${beam.x}m 벗어났다`);
    assert.ok(beam.y > 1.1 && beam.y < 1.8, `광선 높이 ${beam.y} — 플레이어(키 ${PLAYER.height}) 몸 높이여야 한다`);
    assert.ok(beam.z > 0.6 && beam.z < 1.6, `광선 원점은 몸 앞 ${beam.z}`);

    drive(view, attacking('void_orbs', 'active', 0.9, 2));
    const orb = NIHIL.attacks.void_orbs.events.find((ev) => ev.type === 'projectile');
    const hand = sock(view, 'handL');
    const d = Math.hypot(hand.x - 0, hand.y - orb.proj.y, hand.z - orb.origin.fwd);
    assert.ok(d < 0.5, `구체 발사점(정면 ${orb.origin.fwd}m · 높이 ${orb.proj.y}m)과 손의 거리 ${d.toFixed(2)}m`);
    view.dispose();
  });

  test('시전 자세가 종류별로 구분된다: 예고 자세끼리 · 판정 자세끼리 손과 지팡이 머리가 1m 넘게 다르다', () => {
    const view = createNihilView();
    const idOf = (pose) => ATTACK_IDS.find((id) => NIHIL.attacks[id].pose === pose);
    for (const [phase, pT] of [['windup', 0.7], ['active', 0.9]]) {
      /** @type {Record<string, {hand:THREE.Vector3, staff:THREE.Vector3}>} */
      const at = {};
      let seq = 10;
      for (const key of POSE_KEYS) {
        drive(view, attacking(idOf(key), phase, pT, seq++));
        at[key] = { hand: sock(view, 'handL'), staff: staffHead(view) };
      }
      for (let i = 0; i < POSE_KEYS.length; i++) {
        for (let j = i + 1; j < POSE_KEYS.length; j++) {
          const a = at[POSE_KEYS[i]];
          const b = at[POSE_KEYS[j]];
          const diff = a.hand.distanceTo(b.hand) + a.staff.distanceTo(b.staff);
          assert.ok(diff > 1.0, `${phase}: ${POSE_KEYS[i]} ↔ ${POSE_KEYS[j]} 차이 ${diff.toFixed(2)}m`);
        }
      }
      // 한 공격 안에서도 예고 → 판정이 크게 다르다(§9.5 실루엣 규칙)
      if (phase === 'active') {
        for (const key of POSE_KEYS) {
          drive(view, attacking(idOf(key), 'windup', 0.7, seq++));
          const w = { hand: sock(view, 'handL'), staff: staffHead(view) };
          const move = w.hand.distanceTo(at[key].hand) + w.staff.distanceTo(at[key].staff);
          assert.ok(move > 1.0, `${key}: 예고 ↔ 판정 ${move.toFixed(2)}m`);
        }
      }
    }
    view.dispose();
  });

  test('낫 베기: 날이 펼쳐진 동안만 궤적 소켓이 벌어지고(리본), 예고 ↔ 판정의 날 끝이 2m 넘게 움직인다', () => {
    const view = createNihilView();
    drive(view, bossAt({ state: 'idle' }));
    assert.ok(sock(view, 'weaponBase').distanceTo(sock(view, 'weaponTip')) < 1e-6, '평소에는 한 점(리본이 생기지 않는다)');
    drive(view, attacking('void_orbs', 'active', 0.5, 2));
    assert.ok(sock(view, 'weaponBase').distanceTo(sock(view, 'weaponTip')) < 1e-6, '시전 중에도 한 점');

    drive(view, attacking('scythe_slash', 'windup', 0.8, 3));
    const w = sock(view, 'weaponTip');
    assert.ok(sock(view, 'weaponBase').distanceTo(w) > 0.8, '날의 뿌리 → 끝');
    drive(view, attacking('scythe_slash', 'active', 1, 3));
    const a = sock(view, 'weaponTip');
    assert.ok(w.distanceTo(a) > 2, `날 끝의 이동 ${w.distanceTo(a).toFixed(2)}m`);
    // 오른쪽(−X) 뒤에서 왼쪽(+X)으로 벤다
    assert.ok(w.x < -0.5 && a.x > 0.5, `날 끝 x: ${w.x.toFixed(2)} → ${a.x.toFixed(2)}`);
    drive(view, bossAt({ state: 'idle' }), 90);
    assert.ok(sock(view, 'weaponBase').distanceTo(sock(view, 'weaponTip')) < 1e-6, '날이 접히면 다시 한 점');
    view.dispose();
  });

  test('심연 폭발: 무기 끝 소켓이 몸의 중심(지면)에 있다 — fx의 slam 충격이 폭발 원의 한가운데에서 난다', () => {
    const view = createNihilView();
    for (const [phase, pT] of [['windup', 0.9], ['active', 0.1], ['active', 0.9]]) {
      const boss = attacking('void_nova', phase, pT, 4);
      boss.pos = { x: 3, z: -2 };
      boss.prevPos = { x: 3, z: -2 };
      boss.facing = 1.1;
      drive(view, boss, 20);
      const tip = sock(view, 'weaponTip');
      assert.ok(Math.hypot(tip.x - 3, tip.z + 2) < 1e-3 && Math.abs(tip.y) < 1e-3, `${phase}: (${tip.x.toFixed(2)}, ${tip.y.toFixed(2)}, ${tip.z.toFixed(2)})`);
    }
    view.dispose();
  });

  test('순간이동: 예고 끝에는 형체가 사라지고(가늘어지고 투명해진다), 판정에 들어서면 다시 나타난다', () => {
    const view = createNihilView();
    drive(view, bossAt({ state: 'idle' }));
    assert.equal(view.rig.root.scale.x, 1);
    assert.equal(minOpacity(view), 1);
    drive(view, attacking('blink', 'windup', 0.99, 7), 10);
    assert.ok(view.rig.root.scale.x < 0.1, `소멸 직전의 가로 배율 ${view.rig.root.scale.x}`);
    assert.ok(view.rig.root.scale.y > 1.3, '세로로 빨려 든다');
    assert.ok(minOpacity(view) < 0.1, `불투명도 ${minOpacity(view)}`);
    // 등장: 이벤트 없이 상태만 보고도 나타난다(§9.1 이벤트 누락에 안전)
    drive(view, attacking('blink', 'active', 0.2, 7), 1);
    assert.ok(view.rig.root.scale.x < 0.5, '나타나는 첫 프레임은 아직 가늘다');
    drive(view, attacking('blink', 'recovery', 0.5, 7), 30);
    assert.ok(Math.abs(view.rig.root.scale.x - 1) < 1e-6 && Math.abs(view.rig.root.scale.y - 1) < 1e-6);
    assert.equal(minOpacity(view), 1);
    // BOSS_TELEPORT 이벤트로도 같은 등장이 시작된다
    view.onEvent(EV.BOSS_TELEPORT, { fromX: 0, fromZ: 0, toX: 5, toZ: 5 });
    drive(view, bossAt({ state: 'idle' }), 1);
    assert.ok(view.rig.root.scale.x < 0.5);
    drive(view, bossAt({ state: 'idle' }), 30);
    assert.ok(Math.abs(view.rig.root.scale.x - 1) < 1e-6);
    view.dispose();
  });

  test('그로기: 추락해 지면에 무릎 꿇는다(sim의 y는 hoverY 그대로) → 회복하면 다시 떠오른다', () => {
    const view = createNihilView();
    drive(view, bossAt({ state: 'idle' }));
    const hover = sock(view, 'head').y;
    drive(view, bossAt({ state: 'groggy', stateTime: 1.5, stateDur: 5 }), 60);
    assert.ok(Math.abs(view.rig.root.position.y + HOVER) < 1e-6, `rig.root.y ${view.rig.root.position.y} = −hoverY`);
    const head = sock(view, 'head');
    assert.ok(head.y < 1.8 && head.y > 0.9, `꿇은 머리 높이 ${head.y} — 플레이어 눈높이 아래`);
    assert.ok(hover - head.y > 1.0, '눈에 띄게 내려앉는다');
    const chest = sock(view, 'chest');
    assert.ok(chest.y > 0.6 && chest.y < 1.6, `록온 · 처형이 겨누는 가슴 높이 ${chest.y}`);
    drive(view, bossAt({ state: 'executed', stateTime: 0.3, stateDur: 1.2 }), 20);
    assert.ok(Math.abs(view.rig.root.position.y + HOVER) < 1e-6, '처형당하는 동안에도 지면');
    drive(view, bossAt({ state: 'recover', stateTime: 0.8, stateDur: 0.8 }), 60);
    drive(view, bossAt({ state: 'idle' }), 60);
    assert.ok(Math.abs(view.rig.root.position.y) < 0.02, '다시 떠오른다');
    assert.ok(Math.abs(sock(view, 'head').y - hover) < 0.25);
    view.dispose();
  });

  test('사망: outro(2.6초)가 끝나기 전(2.2초)에 흩어져 사라진다 · dispose', () => {
    const view = createNihilView();
    const parent = new THREE.Group();
    parent.add(view.root);
    const end = COMBAT.outroVictory - 0.4;
    drive(view, bossAt({ state: 'dead', stateTime: end * 0.3 }), 30);
    assert.equal(view.root.visible, true);
    assert.equal(minOpacity(view), 1, '처음에는 쓰러질 뿐이다');
    drive(view, bossAt({ state: 'dead', stateTime: end * 0.8 }), 5);
    assert.ok(minOpacity(view) < 0.6, '흩어지는 중');
    drive(view, bossAt({ state: 'dead', stateTime: end + 0.01 }), 2);
    assert.equal(view.root.visible, false);
    // 재도전: 같은 뷰에 살아 있는 상태가 와도 되돌아온다(레이어는 뷰를 새로 만들지만 안전하게)
    drive(view, bossAt({ state: 'idle' }), 30);
    assert.equal(view.root.visible, true);
    view.dispose();
    assert.equal(view.root.parent, null);
  });
});
