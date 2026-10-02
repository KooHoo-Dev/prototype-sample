// OWNER: P1 — 계약 §12.2 「player.test.js」 15항목 + 조작감 보증(프레임 단위 타이밍 · 입력이 씹히지 않음).
// 규칙(§12.1): node:test + node:assert/strict만 쓴다. 다른 패키지의 구현에 기대지 않는다 — 상대 상태는
//   test/helpers.js의 리터럴 빌더로 만든다(보스는 합성 BossDef의 BossState 리터럴, 판정 결과는 DamageResult 리터럴).
//
// 틱 표기: 행동을 시작한 updatePlayer 호출을 0번 틱이라 한다. k번 틱이 끝난 뒤 stateTime = k × DT.
//   경계 시각 s에 처음 닿는 틱 = ticksTo(s) = ceil(s / DT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, WEAPON_IDS } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeInput, NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { angleDiff, angleOf, lerp } from '../src/core/math2d.js';
import { createRng } from '../src/core/rng.js';
import { PLAYER } from '../src/data/player.js';
import { WEAPONS, getMoveDef, getWeaponDef } from '../src/data/weapons.js';
import {
  applyStatsToPlayer, bufferPlayerInput, createPlayerState, getPlayerHit, onPlayerDamaged, onPlayerDealtHit,
  updatePlayer,
} from '../src/sim/player/playerSim.js';
import {
  assertFiniteDeep, countEvents, makeSynthBossDef, makeTestCtx, makeTestPlayer, makeTestState, makeTestStats,
} from './helpers.js';

// ───────────────────────── 하네스 ─────────────────────────

const ticksTo = (sec) => Math.ceil(sec / DT - 1e-6);

function near(actual, expected, tol, label = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${label} ${actual} ≉ ${expected} (±${tol})`);
}

/**
 * 플레이어만 도는 작은 시뮬레이션(GameSim.step의 A · D · E 단계). boss: true면 합성 보스가 (0, 6)에 서 있다.
 * @param {{boss?:boolean, stats?:Object, facing?:number, lockOn?:boolean, bossPos?:{x:number, z:number}}} [opts]
 */
function makeSim(opts = {}) {
  const def = opts.boss ? makeSynthBossDef() : null;
  const stats = makeTestStats(opts.stats);
  const state = makeTestState(def ? { bossDef: def, stats } : { stats });
  state.player = createPlayerState(stats, { x: 0, z: 0, facing: opts.facing ?? 0 });
  if (opts.lockOn) state.player.lockOn = true;
  if (opts.bossPos && state.boss) {
    state.boss.pos = { ...opts.bossPos };
    state.boss.prevPos = { ...opts.bossPos };
  }
  const ctx = makeTestCtx(state, { bossDef: def });
  const sim = {
    state,
    ctx,
    p: state.player,
    boss: state.boss,
    /** 한 틱. partial은 InputFrame의 일부(없으면 중립). */
    tick(partial) {
      const p = state.player;
      state.tick += 1;
      state.time += DT;
      p.prevPos.x = p.pos.x;
      p.prevPos.z = p.pos.z;
      p.prevFacing = p.facing;
      updatePlayer(ctx, partial ? makeInput(partial) : NEUTRAL_INPUT, DT);
      return p;
    },
    /** n틱. inputFn(i) → partial | undefined, observe(i, p)는 그 틱이 끝난 뒤 불린다. */
    run(n, inputFn, observe) {
      for (let i = 0; i < n; i++) {
        const partial = typeof inputFn === 'function' ? inputFn(i) : inputFn;
        sim.tick(partial || undefined);
        if (observe) observe(i, state.player);
      }
    },
    events: (name) => ctx.events.filter((e) => e.name === name).map((e) => e.payload),
    count: (name) => countEvents(ctx.events, name),
  };
  return sim;
}

/** DamageResult 리터럴(P2가 onPlayerDamaged에 넘기는 모양). */
function dmg(over = {}) {
  return {
    source: 'boss', target: 'player', outcome: 'hit', damage: 10, rawDamage: 10, posture: 0, staminaDamage: 0,
    crit: false, heavy: false, execute: false, knockdown: false, guardBreak: false, postureBroken: false,
    lethal: false, x: 0, z: 0.4, y: 1.1, dir: Math.PI, attackId: 'synth_melee', hitId: 9999, ...over,
  };
}

/** 한 번 누르고 뗀 입력 열: i === at일 때만 partial. */
const pressAt = (at, partial) => (i) => (i === at ? partial : undefined);

/** PLAYER_ATTACK_START가 난 틱 번호를 moveId와 함께 기록하며 n틱 돈다. */
function recordAttackStarts(sim, n, inputFn) {
  const starts = [];
  let seen = sim.count(EV.PLAYER_ATTACK_START);
  sim.run(n, inputFn, (i) => {
    const all = sim.events(EV.PLAYER_ATTACK_START);
    while (seen < all.length) {
      starts.push({ tick: i, moveId: all[seen].moveId, comboIndex: all[seen].comboIndex });
      seen += 1;
    }
  });
  return starts;
}

const moveTotal = (mv) => mv.windup + mv.active + mv.recovery;
const comboBeat = (mv) => mv.windup + mv.active + mv.comboAt;
const rollCancelTime = (mv) => mv.windup + mv.active + mv.rollCancelAt;

const LS = WEAPONS.longsword.moves;

// ───────────────────────── 0. 상태 모양 ─────────────────────────

test('createPlayerState · applyStatsToPlayer: §3.4 전 필드 · 가득 찬 시작값 · 복제 가능', () => {
  const stats = makeTestStats({ hpMax: 140, staminaMax: 120, flaskCharges: 4 });
  const p = createPlayerState(stats, { x: 3, z: -2, facing: 1.2 });
  // §3.4의 전 필드 + P1 내부 타이머 둘(후딜 캔슬 잠금 — NOTES-P1 1번)
  assert.deepEqual(Object.keys(p).sort(), [...Object.keys(makeTestPlayer(stats)), 'lightLock', 'heavyLock'].sort());
  assert.deepEqual(p.pos, { x: 3, z: -2 });
  assert.deepEqual(p.prevPos, { x: 3, z: -2 });
  assert.notEqual(p.pos, p.prevPos);
  assert.equal(p.facing, 1.2);
  assert.equal(p.prevFacing, 1.2);
  assert.equal(p.radius, PLAYER.radius);
  assert.equal(p.hp, 140);
  assert.equal(p.stamina, 120);
  assert.equal(p.flasks, 4);
  assert.equal(p.state, 'idle');
  assert.equal(p.attack, null);
  assert.deepEqual(p.buffer, { action: null, t: 0, dirX: 0, dirZ: 0 });
  assert.deepEqual(structuredClone(p), p);

  // refill: 최대로 채운다(+ 탈진 해제). refill 아님: 값은 두고 새 상한 안으로만 자른다.
  p.hp = 10;
  p.stamina = 0;
  p.flasks = 0;
  p.exhausted = true;
  const bigger = makeTestStats({ hpMax: 200, staminaMax: 150, flaskCharges: 5 });
  applyStatsToPlayer(p, bigger, false);
  assert.equal(p.stats, bigger);
  assert.equal(p.hp, 10);
  assert.equal(p.flasks, 0);
  applyStatsToPlayer(p, bigger, true);
  assert.equal(p.hp, 200);
  assert.equal(p.stamina, 150);
  assert.equal(p.flasks, 5);
  assert.equal(p.exhausted, false);
  applyStatsToPlayer(p, makeTestStats(), false);
  assert.equal(p.hp, 100);
  assert.equal(p.stamina, 100);
  assert.equal(p.flasks, 3);
  assertFiniteDeep(p, 'player');
});

// ───────────────────────── 1. 이동 ─────────────────────────

test('1. 이동: 걷기 속력 수렴 · 달리기 속력과 소모 · 록온 시 보스를 향한다', () => {
  // 걷기
  let sim = makeSim();
  sim.tick({ moveZ: 1 });
  assert.equal(sim.p.state, 'move');
  near(Math.hypot(sim.p.vel.x, sim.p.vel.z), PLAYER.move.accel * DT, 1e-9, '첫 틱 가속');
  sim.run(59, { moveZ: 1 });
  near(Math.hypot(sim.p.vel.x, sim.p.vel.z), PLAYER.move.walkSpeed, 1e-9, '걷기 속력');
  assert.equal(sim.p.stamina, 100, '걷기는 스태미나를 쓰지 않는다');
  assert.equal(sim.p.sprinting, false);
  assert.ok(sim.p.pos.z > 4 && sim.p.pos.z < PLAYER.move.walkSpeed, `1초 걸은 거리 ${sim.p.pos.z}`);
  assert.ok(sim.count(EV.PLAYER_STEP) >= 2, '보폭마다 PLAYER_STEP');
  assert.equal(sim.events(EV.PLAYER_STEP)[0].sprint, false);
  // 멈추면 감속해 idle
  sim.run(10);
  assert.equal(sim.p.state, 'idle');
  assert.equal(Math.hypot(sim.p.vel.x, sim.p.vel.z), 0);
  // 방향 전환: 이동 방향으로 turnRate로 돈다(+X = π/2)
  sim.run(30, { moveX: 1 });
  near(sim.p.facing, Math.PI / 2, 1e-9, '이동 방향을 본다');
  assertFiniteDeep(sim.state);

  // 달리기
  sim = makeSim();
  sim.run(60, { moveX: 1, sprint: true });
  near(Math.hypot(sim.p.vel.x, sim.p.vel.z), PLAYER.move.sprintSpeed, 1e-9, '달리기 속력');
  near(100 - sim.p.stamina, PLAYER.stamina.sprintDrain, 1e-6, '초당 소모');
  assert.equal(sim.p.sprinting, true);
  near(sim.p.sprintTime, 1, 1e-6, 'sprintTime');
  assert.ok(sim.events(EV.PLAYER_STEP).some((e) => e.sprint === true));
  // 이동 의도가 sprintIntentMin 이하면 달리기가 아니다
  sim.run(5, { moveX: PLAYER.move.sprintIntentMin, sprint: true });
  assert.equal(sim.p.sprinting, false);
  assert.equal(sim.p.sprintTime, 0);
  assertFiniteDeep(sim.state);

  // 록온: 옆걸음 중에도 보스(0, 6)를 본다. 달리면 이동 방향을 본다.
  sim = makeSim({ boss: true, lockOn: true, facing: Math.PI / 2 });
  sim.run(40, { moveX: 1 });
  const toBoss = angleOf(sim.boss.pos.x - sim.p.pos.x, sim.boss.pos.z - sim.p.pos.z);
  near(angleDiff(sim.p.facing, toBoss), 0, 0.05, '록온 스트레이프 중 보스 방향');
  assert.ok(sim.p.pos.x > 2, '옆으로는 계속 걷는다');
  sim.run(40, { moveX: 1, sprint: true });
  near(sim.p.facing, Math.PI / 2, 1e-6, '록온 달리기는 이동 방향');
  // 가만히 서 있어도 보스 쪽으로 돈다
  sim.run(60);
  near(angleDiff(sim.p.facing, angleOf(sim.boss.pos.x - sim.p.pos.x, sim.boss.pos.z - sim.p.pos.z)), 0, 1e-6, '정지 록온');
  assertFiniteDeep(sim.state);
});

test('1b. 록온 토글: 보스가 있어야 켜지고, 죽거나 멀어지면 스스로 꺼진다', () => {
  let sim = makeSim({ boss: true });
  sim.tick({ lockOnPressed: true });
  assert.equal(sim.p.lockOn, true);
  assert.deepEqual(sim.events(EV.LOCKON_CHANGED), [{ on: true }]);
  sim.tick({ lockOnPressed: true });
  assert.equal(sim.p.lockOn, false);
  assert.deepEqual(sim.events(EV.LOCKON_CHANGED), [{ on: true }, { on: false }]);
  sim.tick({ lockOnPressed: true });
  sim.boss.state = 'dead';
  sim.tick();
  assert.equal(sim.p.lockOn, false, '보스가 죽으면 자동 해제');
  assert.equal(sim.count(EV.LOCKON_CHANGED), 4);
  sim.tick({ lockOnPressed: true });
  assert.equal(sim.p.lockOn, false, '죽은 보스에는 켜지지 않는다');
  assert.equal(sim.count(EV.LOCKON_CHANGED), 4);

  // 사거리 밖
  sim = makeSim({ boss: true, lockOn: true, bossPos: { x: 0, z: PLAYER.lockOn.maxRange + 1 } });
  sim.tick();
  assert.equal(sim.p.lockOn, false);
  assert.deepEqual(sim.events(EV.LOCKON_CHANGED), [{ on: false }]);

  // 마을에서는 항상 false
  sim = makeSim();
  sim.tick({ lockOnPressed: true });
  assert.equal(sim.p.lockOn, false);
  assert.equal(sim.count(EV.LOCKON_CHANGED), 0);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 2. 구르기 ─────────────────────────

test('2. 구르기: 길이 · 거리 · 무적 창 [0.03, 0.40) · 소모 · facing 스냅과 고정 · 백스텝', () => {
  const R = PLAYER.roll;
  let sim = makeSim();
  sim.tick({ moveX: 1, rollPressed: true });
  const p = sim.p;
  assert.equal(p.state, 'roll');
  assert.equal(p.stateTime, 0);
  assert.equal(p.stateDur, R.dur);
  assert.equal(p.stamina, 100 - R.cost);
  assert.deepEqual(p.rollDir, { x: 1, z: 0 });
  near(p.facing, Math.PI / 2, 1e-12, '진입 틱 스냅');
  assert.equal(p.prevFacing, 0, 'prevFacing은 그대로(한 틱 보간으로 돈다)');
  assert.equal(p.iframe, false, '0번 틱은 아직 무적이 아니다(iStart 전)');
  assert.deepEqual(sim.events(EV.PLAYER_ROLL), [{ x: 0, z: 0, dir: Math.PI / 2, backstep: false }]);

  const iframeTicks = [];
  let endTick = -1;
  sim.run(60, null, (i, pl) => {
    const k = i + 1;   // 구르기 시작 후 k번째 틱
    if (pl.state === 'roll') {
      if (pl.iframe) iframeTicks.push(k);
      // 플래그가 stateTime 구간과 정확히 같다
      assert.equal(pl.iframe, pl.stateTime >= R.iStart - 1e-6 && pl.stateTime < R.iEnd - 1e-6, `tick ${k}`);
      if (k < ticksTo(R.actAt)) near(pl.facing, Math.PI / 2, 1e-12, `actAt 전 facing 고정 tick ${k}`);
    } else if (endTick < 0) {
      endTick = k;
    }
  });
  // 무적은 정확히 [0.03, 0.40): 2번 틱(0.033초)부터 23번 틱(0.383초)까지.
  assert.equal(iframeTicks[0], ticksTo(R.iStart));
  assert.equal(iframeTicks[0], 2);
  assert.equal(iframeTicks.at(-1), ticksTo(R.iEnd) - 1);
  assert.equal(iframeTicks.at(-1), 23);
  assert.equal(iframeTicks.length, 22);
  // 길이 0.62초 → 38번 틱에 idle
  assert.equal(endTick, ticksTo(R.dur));
  assert.equal(endTick, 38);
  near(p.pos.x, R.dist, 0.15, '이동 거리');
  near(p.pos.x, R.dist, 1e-9, '증분의 합이 정확히 dist');
  assert.equal(p.pos.z, 0);
  assert.equal(p.state, 'idle');
  assert.equal(p.iframe, false);
  assertFiniteDeep(sim.state);

  // 록온 중에도 진입 틱에 구르는 방향으로 스냅, actAt까지 고정. 그 뒤에는 보스 쪽으로 돌아간다.
  sim = makeSim({ boss: true, lockOn: true });
  sim.tick({ moveX: -1, rollPressed: true });
  near(sim.p.facing, -Math.PI / 2, 1e-12, '록온 구르기 스냅');
  sim.run(ticksTo(R.actAt) - 1);
  near(sim.p.facing, -Math.PI / 2, 1e-12, 'actAt 직전까지 고정');
  sim.tick();
  assert.ok(sim.p.facing > -Math.PI / 2, 'actAt부터 보스 쪽으로 돈다');
  sim.run(30);
  near(angleDiff(sim.p.facing, angleOf(sim.boss.pos.x - sim.p.pos.x, sim.boss.pos.z - sim.p.pos.z)), 0, 1e-6, '보스 쪽 복귀');
  assertFiniteDeep(sim.state);

  // 방향 입력 없음 → 백스텝: facing 불변, facing 반대로 이동
  const B = PLAYER.backstep;
  sim = makeSim({ facing: 0.7 });
  sim.tick({ rollPressed: true });
  assert.equal(sim.p.state, 'backstep');
  assert.equal(sim.p.stamina, 100 - B.cost);
  assert.equal(sim.p.stateDur, B.dur);
  assert.equal(sim.events(EV.PLAYER_ROLL)[0].backstep, true);
  const bsFrames = [];
  let bsEnd = -1;
  sim.run(40, null, (i, pl) => {
    const k = i + 1;
    assert.equal(pl.facing, 0.7, 'backstep은 facing을 바꾸지 않는다');
    if (pl.state === 'backstep') {
      if (pl.iframe) bsFrames.push(k);
    } else if (bsEnd < 0) bsEnd = k;
  });
  assert.equal(bsFrames[0], ticksTo(B.iStart));
  assert.equal(bsFrames.at(-1), ticksTo(B.iEnd) - 1);
  assert.equal(bsEnd, ticksTo(B.dur));
  near(sim.p.pos.x, -Math.sin(0.7) * B.dist, 1e-9, '백스텝 x');
  near(sim.p.pos.z, -Math.cos(0.7) * B.dist, 1e-9, '백스텝 z');
  // 이동 의도가 dirIntentMin 이하면 방향 입력으로 치지 않는다
  sim = makeSim();
  sim.tick({ moveX: PLAYER.move.dirIntentMin, rollPressed: true });
  assert.equal(sim.p.state, 'backstep');
  assertFiniteDeep(sim.state);
});

test('2b. 구르기 꼬리: actAt 이후 이동 · 가드로 캔슬되고, 재구르기가 나간다', () => {
  const R = PLAYER.roll;
  // 방향을 계속 누르고 있으면 actAt에 걷기로 넘어간다(구르기 → 달리기가 끊기지 않는다)
  let sim = makeSim();
  let leftAt = -1;
  sim.run(45, (i) => (i === 0 ? { moveX: 1, rollPressed: true } : { moveX: 1 }), (i, p) => {
    if (leftAt < 0 && i > 0 && p.state !== 'roll') leftAt = i;
  });
  assert.equal(leftAt, ticksTo(R.actAt));
  assert.equal(sim.p.state, 'move');
  // 구르기 선입력 → actAt에 재구르기(방향은 소비 틱의 이동 의도)
  sim = makeSim();
  sim.run(ticksTo(R.actAt) + 1, (i) => {
    if (i === 0) return { moveX: 1, rollPressed: true };
    if (i === 20) return { rollPressed: true };
    if (i === ticksTo(R.actAt)) return { moveZ: 1 };
    return undefined;
  });
  assert.equal(sim.p.state, 'roll');
  assert.equal(sim.p.stateTime, 0);
  assert.deepEqual(sim.p.rollDir, { x: 0, z: 1 });
  assert.equal(sim.count(EV.PLAYER_ROLL), 2);
  assert.equal(sim.p.stamina, 100 - R.cost * 2);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 3. 약공격 ─────────────────────────

test('3. 약공격: 구간 전환 시각 · getPlayerHit은 판정 구간에만 · hitId 고정 · damage 공식 · 시작 스냅', () => {
  const mv = LS.light1;
  let sim = makeSim();
  sim.tick({ lightPressed: true });
  const p = sim.p;
  assert.equal(p.state, 'attack');
  assert.equal(p.stateTime, 0);
  assert.equal(p.stamina, 100 - mv.stamina, '스태미나는 시작 때 낸다');
  assert.equal(p.attack.moveId, 'light1');
  assert.equal(p.attack.weaponId, 'longsword');
  assert.equal(p.attack.kind, 'light');
  assert.equal(p.attack.motion, 'slashR');
  assert.equal(p.attack.comboIndex, 0);
  assert.equal(p.attack.phase, 'windup');
  assert.equal(p.attack.charge, 0);
  near(p.stateDur, moveTotal(mv), 1e-12, 'stateDur');
  assert.deepEqual(sim.events(EV.PLAYER_ATTACK_START), [
    { moveId: 'light1', kind: 'light', motion: 'slashR', weaponId: 'longsword', comboIndex: 0 },
  ]);
  assert.equal(getPlayerHit(sim.ctx), null, '예고 중에는 판정이 없다');
  const hitId = p.attack.hitId;

  const first = {};
  const hitTicks = [];
  let lastPhaseT = -1;
  let lastPhase = 'windup';
  sim.run(60, null, (i, pl) => {
    const k = i + 1;
    const phase = pl.attack ? pl.attack.phase : 'idle';
    if (first[phase] === undefined) first[phase] = k;
    const hit = getPlayerHit(sim.ctx);
    assert.equal(hit !== null, phase === 'active', `tick ${k}: 판정은 active 구간에만`);
    if (hit) {
      hitTicks.push(k);
      assert.equal(hit.hitId, hitId, '휘두르기 동안 hitId가 같다');
    }
    if (pl.attack) {
      assert.ok(pl.attack.phaseT >= 0 && pl.attack.phaseT <= 1);
      if (phase === lastPhase) assert.ok(pl.attack.phaseT >= lastPhaseT, 'phaseT는 구간 안에서 단조 증가');
      lastPhase = phase;
      lastPhaseT = pl.attack.phaseT;
    }
  });
  // 예고 0.27 → 17번 틱에 판정, 0.37 → 23번 틱에 후딜, 0.75 → 45번 틱에 idle (계약 값 ±1틱)
  assert.equal(first.active, ticksTo(mv.windup));
  assert.equal(first.recovery, ticksTo(mv.windup + mv.active));
  assert.equal(first.idle, ticksTo(moveTotal(mv)));
  near(first.active, mv.windup / DT, 1, '예고 → 판정');
  near(first.recovery, (mv.windup + mv.active) / DT, 1, '판정 → 후딜');
  near(first.idle, moveTotal(mv) / DT, 1, '후딜 → idle');
  assert.equal(hitTicks.length, Math.round(mv.active / DT), '판정이 서 있는 틱 수');
  assert.equal(p.state, 'idle');
  assert.equal(p.attack, null);
  assert.deepEqual(sim.events(EV.PLAYER_SWING), [
    { moveId: 'light1', kind: 'light', motion: 'slashR', weaponId: 'longsword', charge: 0, heavy: false, dur: mv.active },
  ]);
  near(p.pos.z, mv.lunge, 1e-9, '전진 거리(lunge)');
  assertFiniteDeep(sim.state);

  // OutgoingHit 필드와 damage 공식
  sim = makeSim({
    stats: { weaponDamage: 30, damageMul: 1.2, postureMul: 1.5, postRollDmgMul: 1.25, lowHpThreshold: 0.5, lowHpDmgMul: 1.3 },
    facing: 0.4,
  });
  sim.tick({ lightPressed: true });
  sim.run(ticksTo(mv.windup));
  let hit = getPlayerHit(sim.ctx);
  assert.deepEqual(Object.keys(hit).sort(), [
    'attackId', 'damage', 'execute', 'facing', 'guardable', 'heavy', 'hitId', 'hitstop', 'knockdown', 'parryable',
    'posture', 'shapeDef', 'source', 'x', 'z',
  ]);
  assert.equal(hit.source, 'player');
  assert.equal(hit.attackId, 'light1');
  assert.equal(hit.shapeDef, mv.shape);
  assert.equal(hit.x, sim.p.pos.x);
  assert.equal(hit.z, sim.p.pos.z);
  assert.equal(hit.facing, sim.p.facing);
  assert.equal(hit.guardable, false);
  assert.equal(hit.parryable, false);
  assert.equal(hit.knockdown, false);
  assert.equal(hit.execute, false);
  assert.equal(hit.heavy, mv.heavy);
  assert.equal(hit.hitstop, mv.hitstop);
  near(hit.damage, 30 * mv.dmgMul * 1.2, 1e-9, '기본 피해');
  near(hit.posture, mv.posture * 1.5, 1e-9, '체간');
  sim.p.postRollT = 1;
  near(getPlayerHit(sim.ctx).damage, 30 * mv.dmgMul * 1.2 * 1.25, 1e-9, '구르기 직후 배율');
  sim.p.hp = 50;
  near(getPlayerHit(sim.ctx).damage, 30 * mv.dmgMul * 1.2 * 1.25 * 1.3, 1e-9, '저체력 배율');
  sim.p.postRollT = 0;
  sim.p.hp = 51;
  hit = getPlayerHit(sim.ctx);
  near(hit.damage, 30 * mv.dmgMul * 1.2, 1e-9, '배율 해제');
  assertFiniteDeep(sim.state);

  // 시작 스냅: 보스를 등지고 록온 약공격 → 판정 시작 시 보스 방향 ±0.2 rad, 판정부터 후딜 끝까지 고정
  sim = makeSim({ boss: true, lockOn: true, facing: Math.PI });
  sim.tick({ lightPressed: true });
  sim.run(ticksTo(PLAYER.move.attackSnapDur) - 1);
  near(sim.p.facing, 0, 1e-9, 'attackSnapDur 안에 돌아선다');
  sim.run(ticksTo(mv.windup) - ticksTo(PLAYER.move.attackSnapDur) + 1);
  assert.equal(sim.p.attack.phase, 'active');
  near(angleDiff(sim.p.facing, angleOf(sim.boss.pos.x - sim.p.pos.x, sim.boss.pos.z - sim.p.pos.z)), 0, 0.2, '판정 시작 방향');
  const locked = sim.p.facing;
  sim.boss.pos.x = 5;   // 판정 뒤에는 보스가 움직여도 따라 돌지 않는다
  sim.run(20, { moveX: 1 }, (i, pl) => {
    if (pl.state === 'attack') assert.equal(pl.facing, locked, '판정 ~ 후딜 방향 고정');
  });
  assertFiniteDeep(sim.state);

  // 록온이 아니면 이동 의도 방향으로 조준, 의도가 없으면 현재 facing
  sim = makeSim();
  sim.run(ticksTo(mv.windup) + 1, (i) => (i === 0 ? { lightPressed: true, moveX: -1 } : { moveX: -1 }));
  near(sim.p.facing, -Math.PI / 2, 1e-9, '이동 의도 방향 조준');
  sim = makeSim({ facing: 1 });
  sim.run(ticksTo(mv.windup) + 1, pressAt(0, { lightPressed: true }));
  assert.equal(sim.p.facing, 1);
});

test('3b. 전진: 록온 전진은 보스 표면 lockStopGap 앞에서 멈춘다', () => {
  const mv = LS.light1;
  const stop = PLAYER.attack.lockStopGap;
  const sim = makeSim({ boss: true, lockOn: true });
  sim.p.pos.z = sim.boss.pos.z - sim.boss.radius - stop - 0.1;   // 남은 여유 0.1m < lunge 0.8m
  sim.run(ticksTo(moveTotal(mv)) + 1, pressAt(0, { lightPressed: true }));
  near(sim.boss.pos.z - sim.p.pos.z, sim.boss.radius + stop, 1e-9, '보스 표면 앞에서 정지');
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 4. 연속기 ─────────────────────────

test('4. 연속기: comboAt에 다음 타 · 마지막 타는 후딜 끝까지 대기 · 강 → 강은 후딜 끝', () => {
  // 후딜 중 선입력 → comboAt에 light2
  let sim = makeSim();
  let starts = recordAttackStarts(sim, 40, (i) => (i === 0 || i === 25 ? { lightPressed: true } : undefined));
  assert.deepEqual(starts, [
    { tick: 0, moveId: 'light1', comboIndex: 0 },
    { tick: ticksTo(comboBeat(LS.light1)), moveId: 'light2', comboIndex: 1 },
  ]);
  assert.equal(starts[1].tick, 30, '장검 1타 박자 0.49초 → 30번 틱');
  assert.equal(sim.p.stamina, 100 - LS.light1.stamina - LS.light2.stamina);

  // 연타: 4타 연속기의 총 시간(틱 단위) — 각 타는 앞 타의 comboAt에, 마지막 타 뒤의 light1은 후딜이 끝난 틱에.
  sim = makeSim();
  starts = recordAttackStarts(sim, 170, () => ({ lightPressed: true }));
  const t1 = ticksTo(comboBeat(LS.light1));
  const t2 = t1 + ticksTo(comboBeat(LS.light2));
  const t3 = t2 + ticksTo(comboBeat(LS.light3));
  const t4 = t3 + ticksTo(moveTotal(LS.light4));
  assert.deepEqual(starts, [
    { tick: 0, moveId: 'light1', comboIndex: 0 },
    { tick: t1, moveId: 'light2', comboIndex: 1 },
    { tick: t2, moveId: 'light3', comboIndex: 2 },
    { tick: t3, moveId: 'light4', comboIndex: 3 },
    { tick: t4, moveId: 'light1', comboIndex: 0 },
  ]);
  assert.deepEqual([t1, t2, t3, t4], [30, 58, 89, 153]);
  // 3타까지의 시간 = 0.49 + 0.46 + 0.51 = 1.46초(±1틱/타)
  near(t3 * DT, comboBeat(LS.light1) + comboBeat(LS.light2) + comboBeat(LS.light3), 3 * DT, '3타 연속기 총 시간');
  assert.equal(LS.light4.comboAt, LS.light4.recovery, '연속기 끝의 comboAt은 recovery와 같다');
  assertFiniteDeep(sim.state);

  // 마지막 타(light4) 후딜 중간의 약 입력은 후딜이 끝난 틱에 light1로 나간다(중간에 당겨지지 않는다)
  sim = makeSim();
  starts = recordAttackStarts(sim, 170, (i) => (i <= t3 || i === t4 - 15 ? { lightPressed: true } : undefined));
  assert.equal(starts.length, 5);
  assert.deepEqual(starts[4], { tick: t4, moveId: 'light1', comboIndex: 0 });

  // 강 → 강: comboAt이 지나도 시작하지 않고 후딜이 끝난 틱에 시작한다
  const H = LS.heavy;
  const hCombo = ticksTo(comboBeat(H));
  const hEnd = ticksTo(moveTotal(H));
  assert.ok(hCombo < hEnd);
  sim = makeSim();
  starts = recordAttackStarts(sim, hEnd + 5, (i) => (i === 0 || i === hCombo + 2 ? { heavyPressed: true } : undefined));
  assert.deepEqual(starts, [
    { tick: 0, moveId: 'heavy', comboIndex: 0 },
    { tick: hEnd, moveId: 'heavy', comboIndex: 0 },
  ]);
  assert.equal(hEnd, 69, '장검 강공격 주기 1.14초');

  // 약 → 강은 comboAt
  sim = makeSim();
  starts = recordAttackStarts(sim, 40, (i) => (i === 0 ? { lightPressed: true } : i === 20 ? { heavyPressed: true } : undefined));
  assert.deepEqual(starts[1], { tick: ticksTo(comboBeat(LS.light1)), moveId: 'heavy', comboIndex: 0 });

  // 강 → 약(next)은 comboAt
  sim = makeSim();
  starts = recordAttackStarts(sim, 60, (i) => (i === 0 ? { heavyPressed: true } : i === 40 ? { lightPressed: true } : undefined));
  assert.deepEqual(starts[1], { tick: hCombo, moveId: H.next, comboIndex: 0 });
  assert.equal(hCombo, 48);
  assertFiniteDeep(sim.state);
});

test('4b. 후딜 캔슬은 공격을 당기지 못한다: 가드 캔슬 뒤의 강 → 강 · 연속기 끝 → 약은 원래 시각에', () => {
  const H = LS.heavy;
  const hEnd = ticksTo(moveTotal(H));
  const hCancel = ticksTo(rollCancelTime(H));
  // 강 → (가드 캔슬) → 강: 후딜이 끝났을 틱(69)보다 빨라지지 않는다. 그동안 누른 입력은 버퍼가 들고 있다.
  let sim = makeSim();
  let guardAt = -1;
  let starts = recordAttackStarts(sim, hEnd + 3, (i) => {
    if (i === 0) return { heavyPressed: true };
    return { guard: i >= 40, heavyPressed: i === hEnd - 15 };
  });
  assert.deepEqual(starts.map((s) => s.tick), [0, hEnd]);
  // 가드 자체는 rollCancelAt에 선다(방어는 늦어지지 않는다)
  sim = makeSim();
  sim.run(hCancel + 1, (i) => (i === 0 ? { heavyPressed: true } : { guard: i >= 40 }), (i, p) => {
    if (guardAt < 0 && p.state === 'guard') guardAt = i;
  });
  assert.equal(guardAt, hCancel);
  assert.equal(sim.p.guarding, true);
  near(sim.p.heavyLock, H.recovery - (hCancel * DT - H.windup - H.active), 1e-9, '남은 후딜만큼 잠근다');
  assert.equal(sim.p.lightLock, 0, '강 → 약은 comboAt에 이미 열려 있었다');
  // 강 → (가드 캔슬) → 약: 원래도 comboAt에 열리므로 바로 나간다
  sim = makeSim();
  starts = recordAttackStarts(sim, hCancel + 6, (i) => {
    if (i === 0) return { heavyPressed: true };
    return { guard: i >= 40, lightPressed: i === hCancel + 3 };
  });
  assert.deepEqual(starts.map((s) => [s.tick, s.moveId]), [[0, 'heavy'], [hCancel + 3, 'light1']]);

  // 연속기 끝(light4) → (가드 캔슬) → 약: light4의 후딜 끝(원래 light1이 나갈 틱)보다 빨라지지 않는다
  const t3 = ticksTo(comboBeat(LS.light1)) + ticksTo(comboBeat(LS.light2)) + ticksTo(comboBeat(LS.light3));
  const t4 = t3 + ticksTo(moveTotal(LS.light4));
  const cancel4 = t3 + ticksTo(rollCancelTime(LS.light4));
  sim = makeSim();
  starts = recordAttackStarts(sim, t4 + 3, (i) => {
    if (i <= t3) return { lightPressed: true };
    return { guard: true, lightPressed: i === t4 - 10 };
  });
  assert.equal(starts.length, 5);
  assert.deepEqual(starts[4], { tick: t4, moveId: 'light1', comboIndex: 0 });
  assert.ok(cancel4 < t4 - 10, '가드는 그 전에 서 있었다');

  // 구르기 캔슬도 같다: 대검 강공격 → 백스텝 캔슬 → 강은 원래 후딜 끝보다 빠르지 않다
  const GH = getMoveDef('greatsword', 'heavy');
  const gEnd = ticksTo(moveTotal(GH));
  sim = makeSim({ stats: { weaponId: 'greatsword', weaponDamage: 34 } });
  starts = recordAttackStarts(sim, gEnd + 3, (i) => {
    if (i === 0) return { heavyPressed: true };
    if (i === 50) return { rollPressed: true };
    return i === gEnd - 12 ? { heavyPressed: true } : undefined;
  });
  assert.equal(sim.count(EV.PLAYER_ROLL), 1);
  assert.deepEqual(starts.map((s) => s.tick), [0, gEnd]);
  // 처형은 잠기지 않는다
  sim = makeSim({ boss: true, bossPos: { x: 0, z: 2.5 } });
  sim.run(hCancel + 1, (i) => (i === 0 ? { heavyPressed: true } : { guard: i >= 40 }));
  assert.ok(sim.p.heavyLock > 0);
  sim.boss.state = 'groggy';
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.state, 'execute');
  assertFiniteDeep(sim.state);
});

test('4c. helpers의 리터럴 상태(makeTestPlayer — 내부 타이머 없음)로도 그대로 돈다', () => {
  const state = makeTestState({ bossDef: makeSynthBossDef() });
  const ctx = makeTestCtx(state, { bossDef: null });
  const p = state.player;
  assert.equal(p.lightLock, undefined);
  const script = [{ heavyPressed: true }, ...Array(60).fill({ guard: true }), { guard: true, lightPressed: true }, ...Array(80).fill({})];
  for (const partial of script) updatePlayer(ctx, makeInput(partial), DT);
  assert.equal(p.state, 'idle');
  assert.equal(countEvents(ctx.events, EV.PLAYER_ATTACK_START), 2);
  assertFiniteDeep(state);
  assert.deepEqual(structuredClone(p), p);
});

// ───────────────────────── 5. 선입력 ─────────────────────────

test('5. 선입력: 구르기 중 약 → actAt에 rollAtk · buffer 0.35초 소멸 · 공격/구르기/경직 중 bufferAttack 0.70초', () => {
  const R = PLAYER.roll;
  const actTick = ticksTo(R.actAt);
  assert.equal(actTick, 29);
  // 구르기 중 약 → actAt에 rollAtk
  let sim = makeSim();
  let starts = recordAttackStarts(sim, 40, (i) => {
    if (i === 0) return { moveX: 1, rollPressed: true };
    if (i === 15) return { lightPressed: true };
    return undefined;
  });
  assert.deepEqual(starts, [{ tick: actTick, moveId: 'rollAtk', comboIndex: 0 }]);

  // (W3) 구르기는 bufferLongStates다 — 구르기를 시작한 직후(1틱 뒤)에 누른 약 · 구르기도 actAt까지 살아 있다(씹히지 않는다)
  assert.ok(PLAYER.bufferLongStates.includes('roll') && R.actAt < PLAYER.bufferAttack);
  sim = makeSim();
  starts = recordAttackStarts(sim, 60, (i) => {
    if (i === 0) return { moveX: 1, rollPressed: true };
    if (i === 1) return { lightPressed: true };
    return undefined;
  });
  assert.deepEqual(starts, [{ tick: actTick, moveId: 'rollAtk', comboIndex: 0 }]);
  sim = makeSim();
  sim.tick({ moveX: 1, rollPressed: true });
  sim.tick({ moveX: 1, rollPressed: true });   // 연타한 두 번째 구르기
  assert.equal(sim.p.buffer.action, 'roll');
  sim.run(actTick - 2, { moveX: 1 });
  assert.equal(sim.p.state, 'roll');
  sim.tick({ moveX: 1 });
  assert.equal(sim.p.state, 'roll');
  assert.equal(sim.p.stateTime, 0, '첫 구르기의 actAt에 두 번째 구르기가 나간다');
  assert.equal(sim.count(EV.PLAYER_ROLL), 2);

  // 0.35초의 경계를 틱으로(긴 잠금 상태 — 플라스크): actAt 20틱 전(0.333초)에 누르면 나가고, 21틱 전(0.35초)에 누르면 소멸한다
  assert.ok(!PLAYER.bufferLongStates.includes('flask'));
  const flaskAct = ticksTo(PLAYER.flask.actAt);
  const lastGood = flaskAct - Math.ceil(PLAYER.buffer / DT - 1e-6) + 1;
  sim = makeSim();
  starts = recordAttackStarts(sim, 100, (i) => {
    if (i === 0) return { flaskPressed: true };
    if (i === lastGood) return { lightPressed: true };
    return undefined;
  });
  assert.deepEqual(starts, [{ tick: flaskAct, moveId: 'light1', comboIndex: 0 }]);
  sim = makeSim();
  starts = recordAttackStarts(sim, 100, (i) => {
    if (i === 0) return { flaskPressed: true };
    if (i === lastGood - 1) return { lightPressed: true };
    return undefined;
  });
  assert.deepEqual(starts, [], 'buffer가 지나면 소멸');
  assert.equal(sim.p.buffer.action, null);
  assert.equal(sim.p.buffer.t, 0);
  assert.equal(sim.p.state, 'idle');

  // 저장 시 유효 시간: bufferLongStates(공격 · 구르기 · 백스텝 · 경직 · 기상)면 bufferAttack, 그 밖이면 buffer
  sim = makeSim();
  sim.tick({ moveX: 1, rollPressed: true });
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.buffer.action, 'light');
  assert.equal(sim.p.buffer.t, PLAYER.bufferAttack);
  sim.tick();
  near(sim.p.buffer.t, PLAYER.bufferAttack - DT, 1e-12, '매 틱 t −= dt');
  sim = makeSim();
  sim.tick({ flaskPressed: true });
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.buffer.t, PLAYER.buffer);

  // 대검 light1 시작 0.2초의 클릭이 comboAt에 light2로 나간다(0.54초 뒤 — buffer 0.35로는 닿지 않는 거리)
  const GS = WEAPONS.greatsword.moves;
  sim = makeSim({ stats: { weaponId: 'greatsword', weaponDamage: 34 } });
  const click = Math.round(0.2 / DT);
  starts = recordAttackStarts(sim, 60, (i) => (i === 0 || i === click ? { lightPressed: true } : undefined));
  assert.equal(sim.events(EV.PLAYER_ATTACK_START)[0].weaponId, 'greatsword');
  assert.deepEqual(starts[1], { tick: ticksTo(comboBeat(GS.light1)), moveId: 'light2', comboIndex: 1 });
  assert.ok(comboBeat(GS.light1) - 0.2 > PLAYER.buffer && comboBeat(GS.light1) - 0.2 < PLAYER.bufferAttack);
  sim = makeSim({ stats: { weaponId: 'greatsword', weaponDamage: 34 } });
  sim.tick({ lightPressed: true });
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.buffer.t, PLAYER.bufferAttack);

  // 버퍼된 구르기가 후딜 캔슬 창(rollCancelAt)에서 나가는 틱. 예고 · 판정 중에는 캔슬되지 않는다.
  const cancelTick = ticksTo(rollCancelTime(LS.light1));
  assert.equal(cancelTick, 32);
  sim = makeSim();
  sim.run(cancelTick + 1, (i) => (i === 0 ? { lightPressed: true } : i === 5 ? { moveX: 1, rollPressed: true } : undefined), (i, p) => {
    if (i < cancelTick) assert.equal(p.state, 'attack', `tick ${i}: 캔슬 창 전에는 공격이 이어진다`);
  });
  assert.equal(sim.p.state, 'roll');
  assert.equal(sim.p.stateTime, 0);
  assert.equal(sim.p.attack, null);
  assertFiniteDeep(sim.state);
});

test('5b. 선입력: dead를 뺀 모든 상태가 버퍼를 받고, 상태가 허용하는 첫 틱에 나간다', () => {
  /** @type {Record<string, (sim: ReturnType<typeof makeSim>) => void>} */
  const enter = {
    roll: (s) => s.tick({ moveX: 1, rollPressed: true }),
    backstep: (s) => s.tick({ rollPressed: true }),
    attack: (s) => s.tick({ lightPressed: true }),
    flask: (s) => s.tick({ flaskPressed: true }),
    guardHit: (s) => { s.tick({ guard: true }); onPlayerDamaged(s.ctx, dmg({ outcome: 'guard' })); },
    guardBreak: (s) => { s.tick({ guard: true }); onPlayerDamaged(s.ctx, dmg({ outcome: 'guard', guardBreak: true })); },
    parry: (s) => { s.tick({ guard: true }); onPlayerDamaged(s.ctx, dmg({ outcome: 'parry', damage: 0 })); },
    stagger: (s) => onPlayerDamaged(s.ctx, dmg()),
    knockdown: (s) => onPlayerDamaged(s.ctx, dmg({ knockdown: true })),
    getup: (s) => { onPlayerDamaged(s.ctx, dmg({ knockdown: true })); s.run(ticksTo(PLAYER.hurt.knockdownDur)); },
    execute: (s) => { s.boss.state = 'groggy'; s.boss.pos.z = 2; s.tick({ lightPressed: true }); },
  };
  for (const [name, go] of Object.entries(enter)) {
    for (const [edge, action] of [['lightPressed', 'light'], ['heavyPressed', 'heavy'], ['rollPressed', 'roll'], ['flaskPressed', 'flask']]) {
      const sim = makeSim({ boss: true });
      go(sim);
      assert.equal(sim.p.state, name, `${name} 상태 진입`);
      const before = sim.p.stateTime;
      sim.tick({ [edge]: true, moveX: 1 });
      assert.equal(sim.p.state, name, `${name}: 지금은 실행하지 않는다`);
      assert.equal(sim.p.buffer.action, action, `${name}: ${action} 입력이 버퍼에 들어간다`);
      assert.deepEqual([sim.p.buffer.dirX, sim.p.buffer.dirZ], [1, 0]);
      // (W5 게이트) 넉다운 중의 구르기 · 플라스크는 일어날 때까지 살아 있다(남은 넉다운 + 기상 + 여유) — 그 밖은 종전 값
      const wake = name === 'knockdown' && (action === 'roll' || action === 'flask')
        ? PLAYER.hurt.knockdownDur - before + PLAYER.hurt.getupDur + PLAYER.bufferCancelSlack
        : 0;
      near(sim.p.buffer.t, Math.max(wake, PLAYER.bufferLongStates.includes(name) ? PLAYER.bufferAttack : PLAYER.buffer), 1e-9, `${name} ${action}: 유효 시간`);
      near(sim.p.stateTime, before + DT, 1e-12, '상태는 그대로 진행');
      assertFiniteDeep(sim.state);
    }
  }
  // dead는 버퍼도 받지 않는다
  const dead = makeSim();
  onPlayerDamaged(dead.ctx, dmg({ lethal: true }));
  dead.tick({ lightPressed: true, rollPressed: true, heavyPressed: true, flaskPressed: true });
  assert.equal(dead.p.state, 'dead');
  assert.equal(dead.p.buffer.action, null);

  // 경직 끝 0.35초 안에 누른 구르기는 경직이 끝나는 틱에 나간다
  const sim = makeSim();
  onPlayerDamaged(sim.ctx, dmg());
  const end = ticksTo(PLAYER.hurt.staggerDur);   // 피격 뒤 27번째 update
  sim.run(end, (i) => (i === 10 ? { moveX: -1, rollPressed: true } : undefined), (i, p) => {
    if (i < end - 1) assert.equal(p.state, 'stagger');
  });
  assert.equal(sim.p.state, 'roll');
  assert.equal(sim.p.stateTime, 0);
  assert.deepEqual(sim.p.rollDir, { x: -1, z: 0 });
  assertFiniteDeep(sim.state);
});

test('5d. (W5) 선입력: 공격 중에 누른 구르기 · 플라스크는 그 무브의 캔슬 창까지 살아 있다 — 긴 무브 · 차지에서도 씹히지 않는다', () => {
  // 캔슬 창까지가 bufferAttack(0.70초)보다 먼 무브들. 시작 직후(3틱 = 0.05초)에 누른 구르기가 캔슬 창이 열리는 틱에 나간다
  const CASES = [
    ['greatsword', 'light1', { lightPressed: true }],
    ['greatsword', 'heavy', { heavyPressed: true }],
    ['longsword', 'heavy', { heavyPressed: true }],
    ['spear', 'heavy', { heavyPressed: true }],
  ];
  for (const [weaponId, moveId, start] of CASES) {
    const mv = WEAPONS[weaponId].moves[moveId];
    assert.ok(rollCancelTime(mv) - 0.05 > PLAYER.bufferAttack, `${weaponId} ${moveId}: 0.70초로는 닿지 않는 무브`);
    const cancelTick = ticksTo(rollCancelTime(mv));
    const sim = makeSim({ stats: { weaponId } });
    sim.run(cancelTick + 1, (i) => (i === 0 ? start : i === 3 ? { moveX: 1, rollPressed: true } : undefined), (i, p) => {
      if (i < cancelTick) assert.equal(p.state, 'attack', `${weaponId} ${moveId} tick ${i}: 캔슬 창 전에는 공격이 이어진다`);
    });
    assert.equal(sim.p.state, 'roll', `${weaponId} ${moveId}: 캔슬 창이 열리는 틱에 구른다`);
    assert.equal(sim.p.stateTime, 0);
    assert.equal(sim.count(EV.PLAYER_ROLL), 1);
    assertFiniteDeep(sim.state);
  }

  // 대검 연속기의 셋째 타(light3 — 캔슬 창까지 0.96초)에 들어가자마자 누른 구르기
  const GS = WEAPONS.greatsword.moves;
  let sim = makeSim({ stats: { weaponId: 'greatsword' } });
  let pressedAt = -1;
  sim.run(400, () => {
    const a = sim.p.attack;
    if (sim.p.state === 'roll') return undefined;
    if (a && a.moveId === 'light3' && pressedAt < 0 && sim.p.stateTime >= 0.1 - 1e-9) {
      pressedAt = sim.p.stateTime;
      return { moveX: 1, rollPressed: true };
    }
    if (pressedAt < 0) return { lightPressed: true };   // 연타해 light3까지 간다
    return undefined;
  }, (i, p) => {
    if (pressedAt >= 0 && p.state === 'attack') assert.equal(p.attack.moveId, 'light3');
  });
  assert.ok(pressedAt >= 0, 'light3까지 갔다');
  assert.ok(rollCancelTime(GS.light3) - pressedAt > PLAYER.bufferAttack);
  assert.equal(sim.count(EV.PLAYER_ROLL), 1, 'light3의 0.10초에 누른 구르기가 나간다');

  // 차지: 장검 강공격을 끝까지 모으는 동안(0.30초에) 누른 구르기 — 차지가 끝난 뒤의 캔슬 창에 나간다
  const H = LS.heavy;
  const fullCancel = ticksTo(H.windup + H.chargeMax + H.active + H.rollCancelAt);
  sim = makeSim();
  const press = Math.round(0.30 / DT);
  sim.run(fullCancel + 1, (i) => {
    if (i === 0) return { heavyPressed: true, heavyHeld: true };
    if (i === press) return { heavyHeld: true, moveX: 1, rollPressed: true };
    return { heavyHeld: true };
  }, (i, p) => {
    if (i < fullCancel) assert.equal(p.state, 'attack', `tick ${i}`);
  });
  assert.equal(sim.p.state, 'roll', '완충 강공격의 캔슬 창에 구른다');
  assert.equal(sim.count(EV.PLAYER_CHARGE_FULL), 1);
  // 일찍 놓으면 그만큼 일찍 나간다(버퍼가 길다고 늦어지지 않는다)
  sim = makeSim();
  sim.run(200, (i) => {
    if (i === 0) return { heavyPressed: true, heavyHeld: true };
    if (i === press) return { heavyHeld: true, moveX: 1, rollPressed: true };
    return undefined;   // press 다음 틱에 놓는다
  });
  assert.equal(sim.count(EV.PLAYER_ROLL), 1);
  assert.equal(sim.count(EV.PLAYER_CHARGE_FULL), 0);

  // 플라스크도 같은 캔슬 창을 쓴다 — 같은 규칙
  sim = makeSim({ stats: { weaponId: 'greatsword' } });
  sim.run(ticksTo(rollCancelTime(GS.light1)) + 1, (i) => (i === 0 ? { lightPressed: true } : i === 3 ? { flaskPressed: true } : undefined));
  assert.equal(sim.p.state, 'flask');

  // 약 · 강 선입력의 유효 시간은 그대로다(bufferAttack) — 늦게 튀어나오는 공격을 만들지 않는다
  sim = makeSim({ stats: { weaponId: 'greatsword' } });
  sim.tick({ lightPressed: true });
  sim.run(3);
  sim.tick({ heavyPressed: true });
  assert.equal(sim.p.buffer.t, PLAYER.bufferAttack);
  // 저장되는 시간 = 캔슬 창까지 남은 시간 + bufferCancelSlack(그보다 bufferAttack이 길면 bufferAttack)
  sim = makeSim({ stats: { weaponId: 'greatsword' } });
  sim.tick({ lightPressed: true });
  sim.run(2);
  sim.tick({ rollPressed: true });
  // (저장은 그 틱의 stateTime이 진행되기 전에 한다 — 한 틱 전의 시각 기준)
  near(sim.p.buffer.t, rollCancelTime(GS.light1) - (sim.p.stateTime - DT) + PLAYER.bufferCancelSlack, 1e-9, '대검 light1');
  assert.ok(sim.p.buffer.t > PLAYER.bufferAttack);
  sim = makeSim();
  sim.tick({ lightPressed: true });
  sim.run(2);
  sim.tick({ rollPressed: true });
  assert.equal(sim.p.buffer.t, PLAYER.bufferAttack, '장검 light1은 0.70초로 충분하다');
});

test('5e. (W5 게이트) 선입력: 넘어지자마자 누른 구르기 · 플라스크는 일어나는 틱에 나간다(1.55초 뒤) — 약 · 강은 0.70초 그대로', () => {
  const H = PLAYER.hurt;
  const wakeTick = ticksTo(H.knockdownDur) + ticksTo(H.getupDur);
  assert.ok(H.knockdownDur + H.getupDur - 0.05 > PLAYER.bufferAttack, '0.70초로는 닿지 않는다');
  // 넉다운 3틱째(0.05초)에 누른 구르기
  let sim = makeSim();
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true }));
  assert.equal(sim.p.state, 'knockdown');
  let rolledAt = -1;
  sim.run(wakeTick + 2, (i) => (i === 3 ? { moveX: -1, rollPressed: true } : undefined), (i, p) => {
    if (rolledAt < 0 && p.state === 'roll') rolledAt = i;
    if (rolledAt < 0 && i < wakeTick - 1) assert.ok(p.state === 'knockdown' || p.state === 'getup', `tick ${i}: ${p.state}`);
  });
  assert.ok(rolledAt >= wakeTick - 1 && rolledAt <= wakeTick, `일어나는 틱에 구른다(${rolledAt} / ${wakeTick})`);
  assert.equal(sim.count(EV.PLAYER_ROLL), 1);
  assert.deepEqual(sim.p.rollDir, { x: -1, z: 0 }, '누를 때의 방향');
  // 플라스크도 같다
  sim = makeSim();
  sim.p.hp = 40;
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true }));
  sim.run(wakeTick + 2, (i) => (i === 3 ? { flaskPressed: true } : undefined));
  assert.equal(sim.p.state, 'flask');
  // 약공격은 종전대로 0.70초 — 넘어지자마자 누른 공격이 1.5초 뒤에 튀어나오지 않는다
  sim = makeSim();
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true }));
  sim.run(wakeTick + 5, (i) => (i === 3 ? { lightPressed: true } : undefined));
  assert.equal(sim.count(EV.PLAYER_ATTACK_START), 0);
  assert.equal(sim.p.state, 'idle');
  // 기상 끝 0.70초 안에 누른 약공격은 종전대로 나간다
  sim = makeSim();
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true }));
  sim.run(wakeTick + 2, (i) => (i === wakeTick - 20 ? { lightPressed: true } : undefined));
  assert.equal(sim.count(EV.PLAYER_ATTACK_START), 1);
  assertFiniteDeep(sim.state);
});

test('5c. 선입력: 우선순위 roll > flask > heavy > light · 새 입력이 덮어쓴다 · 버퍼된 구르기의 방향', () => {
  let sim = makeSim();
  sim.tick({ rollPressed: true, flaskPressed: true, heavyPressed: true, lightPressed: true });
  assert.equal(sim.p.state, 'backstep');
  sim = makeSim();
  sim.tick({ flaskPressed: true, heavyPressed: true, lightPressed: true });
  assert.equal(sim.p.state, 'flask');
  sim = makeSim();
  sim.tick({ heavyPressed: true, lightPressed: true });
  assert.equal(sim.p.attack.moveId, 'heavy');
  // 플라스크가 비었으면 flask 에지는 자리를 차지하지 않는다(아래 순위가 나간다)
  sim = makeSim();
  sim.p.flasks = 0;
  sim.tick({ flaskPressed: true, lightPressed: true });
  assert.equal(sim.p.attack.moveId, 'light1');
  assert.deepEqual(sim.events(EV.PLAYER_FLASK), [{ phase: 'empty', amount: 0, left: 0 }]);

  // 한 칸: 새 입력이 덮어쓴다
  sim = makeSim();
  sim.tick({ lightPressed: true });
  sim.tick({ heavyPressed: true });
  assert.equal(sim.p.buffer.action, 'heavy');
  sim.tick({ rollPressed: true });
  assert.equal(sim.p.buffer.action, 'roll');
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.buffer.action, 'light');

  // 버퍼된 구르기의 방향: 소비 틱의 이동 의도 → 저장된 방향 → 백스텝
  const cancelTick = ticksTo(rollCancelTime(LS.light1));
  const script = (pressDir, consumeDir) => (i) => {
    if (i === 0) return { lightPressed: true };
    if (i === 5) return { rollPressed: true, ...pressDir };
    if (i === cancelTick) return consumeDir;
    return undefined;
  };
  sim = makeSim();
  sim.run(cancelTick + 1, script({ moveX: 1 }, { moveZ: -1 }));
  assert.equal(sim.p.state, 'roll');
  assert.deepEqual(sim.p.rollDir, { x: 0, z: -1 }, '소비 틱의 이동 의도가 우선');
  near(Math.abs(sim.p.facing), Math.PI, 1e-12, '구르는 방향으로 스냅');
  sim = makeSim();
  sim.run(cancelTick + 1, script({ moveX: 1 }, undefined));
  assert.equal(sim.p.state, 'roll');
  assert.deepEqual(sim.p.rollDir, { x: 1, z: 0 }, '의도가 없으면 저장된 방향');
  sim = makeSim();
  sim.run(cancelTick + 1, script({}, undefined));
  assert.equal(sim.p.state, 'backstep', '둘 다 없으면 백스텝');
  sim = makeSim();
  sim.run(cancelTick + 1, script({ moveX: 1 }, { moveZ: PLAYER.move.dirIntentMin }));
  assert.deepEqual(sim.p.rollDir, { x: 1, z: 0 }, '소비 틱의 의도가 dirIntentMin 이하면 저장된 방향');
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 6. 강공격 차지 ─────────────────────────

test('6. 강공격 차지: 홀드 → charge(최대 chargeMax) · 일찍 놓으면 그만큼 · 피해/체간 배율 · PLAYER_CHARGE_FULL', () => {
  const H = LS.heavy;
  const wTick = ticksTo(H.windup);
  // 누르고 바로 뗌 → 차지 없이 판정
  let sim = makeSim();
  sim.run(wTick + 1, pressAt(0, { heavyPressed: true, heavyHeld: true }));
  assert.equal(sim.p.attack.phase, 'active');
  assert.equal(sim.p.attack.charge, 0);
  let hit = getPlayerHit(sim.ctx);
  near(hit.damage, 20 * H.dmgMul, 1e-9, '무차지 피해');
  near(hit.posture, H.posture, 1e-9, '무차지 체간');
  assert.equal(hit.heavy, true);
  assert.equal(sim.count(EV.PLAYER_CHARGE_FULL), 0);
  near(sim.p.stateDur, moveTotal(H), 1e-12, '무차지 stateDur');

  // 끝까지 홀드 → 가득 차는 순간 PLAYER_CHARGE_FULL + 판정
  sim = makeSim();
  const fullTick = ticksTo(H.windup + H.chargeMax);
  assert.equal(fullTick, 74);
  let chargeTicks = 0;
  let lastT = -1;
  sim.run(fullTick + 1, (i) => (i === 0 ? { heavyPressed: true, heavyHeld: true } : { heavyHeld: true }), (i, p) => {
    if (p.attack.phase === 'charge') {
      chargeTicks += 1;
      assert.ok(p.attack.phaseT > lastT && p.attack.phaseT < 1, 'charge 구간의 phaseT = 차지량');
      lastT = p.attack.phaseT;
      assert.equal(getPlayerHit(sim.ctx), null);
    }
    if (i === wTick) assert.equal(p.attack.phase, 'charge', '예고가 끝난 틱에 charge로');
    if (i < fullTick) assert.notEqual(p.attack.phase, 'active');
  });
  assert.equal(sim.p.attack.phase, 'active');
  assert.equal(sim.p.attack.charge, 1);
  assert.equal(chargeTicks, fullTick - wTick);
  near(chargeTicks * DT, H.chargeMax, DT, 'charge 길이 ≤ chargeMax');
  // 가득 찬 순간의 위치(예고 끝 lungeLead 동안 반쯤 내디딘 자리)
  assert.equal(sim.count(EV.PLAYER_CHARGE_FULL), 1);
  near(sim.events(EV.PLAYER_CHARGE_FULL)[0].x, 0, 1e-12, 'CHARGE_FULL.x');
  near(sim.events(EV.PLAYER_CHARGE_FULL)[0].z, H.lunge * PLAYER.attack.lungeLead / (PLAYER.attack.lungeLead + H.active), 1e-9, 'CHARGE_FULL.z');
  hit = getPlayerHit(sim.ctx);
  near(hit.damage, 20 * H.dmgMul * H.chargeDmgMul, 1e-9, '완충 피해');
  near(hit.posture, H.posture * PLAYER.chargePostureMul, 1e-9, '완충 체간');
  assert.equal(sim.events(EV.PLAYER_SWING)[0].charge, 1);
  near(sim.p.stateDur, moveTotal(H) + H.chargeMax, 1e-12, '완충 stateDur');
  // 완충 뒤에도 판정 → 후딜 → idle로 끝난다
  sim.run(ticksTo(H.active + H.recovery) + 1, { heavyHeld: true });
  assert.equal(sim.p.state, 'idle');

  // 일찍 놓음: 51번 틱에 놓으면 차지량 = (51/60 − 0.42) / 0.80
  sim = makeSim();
  const release = 51;
  sim.run(release + 1, (i) => (i === 0 ? { heavyPressed: true, heavyHeld: true } : i < release ? { heavyHeld: true } : undefined));
  const c = (release * DT - H.windup) / H.chargeMax;
  assert.equal(sim.p.attack.phase, 'active');
  near(sim.p.attack.charge, c, 1e-9, '확정 차지량');
  near(sim.p.attack.charge, 0.5375, 1e-9, '확정 차지량(값)');
  hit = getPlayerHit(sim.ctx);
  near(hit.damage, 20 * H.dmgMul * lerp(1, H.chargeDmgMul, c), 1e-9, '부분 차지 피해');
  near(hit.posture, H.posture * lerp(1, PLAYER.chargePostureMul, c), 1e-9, '부분 차지 체간');
  assert.equal(sim.count(EV.PLAYER_CHARGE_FULL), 0);
  near(sim.events(EV.PLAYER_SWING)[0].charge, c, 1e-9, 'SWING.charge');
  // 차지한 공격도 전진 합은 lunge 그대로다(차지 중에는 멈춰 있다가 놓을 때 마저 간다)
  sim.run(ticksTo(H.active + H.recovery) + 1);
  assert.equal(sim.p.state, 'idle');
  near(sim.p.pos.z, H.lunge, 1e-9, '차지 공격의 전진 합');
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 7. 대시 공격 ─────────────────────────

test('7. 대시 공격: sprintTime ≥ dashAttackMinSprint에서만 약 → dash', () => {
  const need = ticksTo(PLAYER.dashAttackMinSprint);   // 18틱 달린 뒤
  const run = (pressTick, sprint = true) => {
    const sim = makeSim();
    sim.run(pressTick + 1, (i) => (i === pressTick ? { moveZ: 1, sprint, lightPressed: true } : { moveZ: 1, sprint }));
    return sim;
  };
  let sim = run(need);
  assert.equal(sim.p.attack.moveId, 'dash');
  assert.equal(sim.p.attack.kind, 'dash');
  assert.equal(sim.p.sprinting, false, '공격에 들어가면 달리기는 끝난다');
  sim = run(need - 1);
  assert.equal(sim.p.attack.moveId, 'light1', '0.30초를 못 채우면 일반 약공격');
  sim = run(need + 20, false);
  assert.equal(sim.p.attack.moveId, 'light1', '걷기에서는 일반 약공격');
  // 대시 공격 뒤의 약 입력은 next(light2)로 이어진다
  sim = makeSim();
  const starts = recordAttackStarts(sim, need + 60, (i) => {
    if (i <= need) return { moveZ: 1, sprint: true, lightPressed: i === need };
    return i === need + 30 ? { lightPressed: true } : undefined;
  });
  assert.deepEqual(starts.map((s) => s.moveId), ['dash', LS.dash.next]);
  assert.equal(starts[1].tick - starts[0].tick, ticksTo(comboBeat(LS.dash)));
  assert.equal(starts[1].comboIndex, 1);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 8. 가드 · 패링 ─────────────────────────

test('8. 가드/패링: guarding · parryActive 길이 · rearm · 상승 에지에서만 창이 열린다 · pressGrace', () => {
  const held = { guard: true };
  let sim = makeSim();
  const active = [];
  sim.run(30, held, (i, p) => {
    assert.equal(p.state, 'guard');
    assert.equal(p.guarding, true);
    assert.equal(p.parryActive, p.parryT > 0);
    if (p.parryActive) active.push(i);
  });
  // 창은 누른 틱부터 parryWindow 동안: 0..10번 틱(0.18초 = 10.8틱 → 11틱)
  assert.equal(active[0], 0);
  assert.equal(active.length, ticksTo(PLAYER.base.parryWindow));
  assert.deepEqual(active, Array.from({ length: active.length }, (_, i) => i), '창은 끊기지 않는다');
  near(active.length * DT, sim.p.stats.parryWindow, DT, 'parryActive 길이 = stats.parryWindow');
  assert.deepEqual(sim.events(EV.PLAYER_GUARD), [{ on: true }]);
  // 떼면 idle
  sim.tick();
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.guarding, false);
  assert.deepEqual(sim.events(EV.PLAYER_GUARD), [{ on: true }, { on: false }]);
  assert.equal(sim.p.parryRearm, PLAYER.guard.rearm, '뗀 틱에 rearm');

  // 놓았다 바로 다시 눌러도 rearm 동안은 창이 없다. 경계: 뗀 뒤 24틱(0.40초)째에 누르면 열리고 23틱째면 안 열린다.
  const rearmTicks = ticksTo(PLAYER.guard.rearm);
  for (const [gap, expectOpen] of [[1, false], [rearmTicks - 1, false], [rearmTicks, true]]) {
    sim = makeSim();
    sim.run(20, held);
    sim.run(gap);                 // gap틱 동안 뗀다(첫 틱이 「뗀 틱」)
    let opened = false;
    sim.run(30, held, (i, p) => { opened = opened || p.parryActive; });
    assert.equal(sim.p.state, 'guard');
    assert.equal(opened, expectOpen, `뗀 뒤 ${gap}틱째 재입력`);
  }

  // stats.parryWindow(유물)가 창 길이를 정한다
  sim = makeSim({ stats: { parryWindow: 0.3 } });
  let n = 0;
  sim.run(40, held, (i, p) => { if (p.parryActive) n += 1; });
  assert.equal(n, ticksTo(0.3));

  // 홀드를 유지한 채 구르기 뒤에 guard로 돌아오면 창이 없다
  sim = makeSim();
  sim.run(20, held);
  let reGuardAt = -1;
  sim.run(60, (i) => (i === 0 ? { guard: true, moveX: 1, rollPressed: true } : held), (i, p) => {
    if (i === 0) assert.equal(p.state, 'roll', '가드 중 구르기');
    if (i > 0 && reGuardAt < 0 && p.state === 'guard') reGuardAt = i;
    assert.equal(p.parryActive, false, `구르기 → 가드 복귀 tick ${i}`);
  });
  assert.equal(reGuardAt, ticksTo(PLAYER.roll.actAt), '구르기 actAt에 가드로');

  // 홀드를 유지한 채 공격 뒤에 guard로 돌아오면 창이 없다
  sim = makeSim();
  sim.run(20, held);
  reGuardAt = -1;
  sim.run(60, (i) => (i === 0 ? { guard: true, lightPressed: true } : held), (i, p) => {
    if (i === 0) assert.equal(p.state, 'attack', '가드 중 약공격');
    if (i > 0 && reGuardAt < 0 && p.state === 'guard') reGuardAt = i;
    assert.equal(p.parryActive, false, `공격 → 가드 복귀 tick ${i}`);
  });
  assert.equal(reGuardAt, ticksTo(rollCancelTime(LS.light1)), '후딜 rollCancelAt에 가드로');

  // 홀드를 유지한 채 guardHit 뒤에 guard로 돌아오면 창이 없다
  sim = makeSim();
  sim.run(20, held);
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'guard', staminaDamage: 9 }));
  assert.equal(sim.p.state, 'guardHit');
  assert.equal(sim.p.guarding, true, 'guardHit에서도 guarding 유지');
  const hitEnd = ticksTo(PLAYER.guard.hitDur);
  sim.run(hitEnd + 5, held, (i, p) => {
    assert.equal(p.guarding, true);
    assert.equal(p.parryActive, false);
    assert.equal(p.state, i < hitEnd - 1 ? 'guardHit' : 'guard', `tick ${i}`);
  });
  assert.deepEqual(sim.events(EV.PLAYER_GUARD), [{ on: true }], 'guard ↔ guardHit 사이에는 PLAYER_GUARD를 다시 내지 않는다');
  // guardHit 중에 떼면 끝나고 idle
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'guard' }));
  sim.run(hitEnd);
  assert.equal(sim.p.state, 'idle');

  // 에지 뒤 pressGrace 안에 guard에 들어가면 창이 열린다(후딜 캔슬 직전에 누른 가드)
  const cancelTick = ticksTo(rollCancelTime(LS.light1));
  const graceTicks = Math.ceil(PLAYER.parry.pressGrace / DT - 1e-6);   // 9틱
  for (const [lead, expectOpen] of [[graceTicks - 1, true], [graceTicks, false]]) {
    sim = makeSim();
    sim.run(cancelTick + 1, (i) => {
      if (i === 0) return { lightPressed: true };
      return i >= cancelTick - lead ? held : undefined;
    });
    assert.equal(sim.p.state, 'guard');
    assert.equal(sim.p.stateTime, 0);
    assert.equal(sim.p.parryActive, expectOpen, `캔슬 ${lead}틱 전에 누른 가드`);
  }

  // 탈진 중에는 가드가 서지 않는다
  sim = makeSim();
  sim.p.exhausted = true;
  sim.p.stamina = 5;
  sim.p.staminaDelay = 5;
  sim.run(10, held);
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.guarding, false);
  // 가드 걸음은 guardSpeed
  sim = makeSim();
  sim.run(40, { guard: true, moveZ: 1 });
  assert.equal(sim.p.state, 'guard');
  near(Math.hypot(sim.p.vel.x, sim.p.vel.z), PLAYER.move.guardSpeed, 1e-9, '가드 걸음');
  assertFiniteDeep(sim.state);
});

test('8b. (W5) 탭 패링: 창 안에서 버튼을 떼도 창이 끝날 때까지 guard · parryActive가 유지된다 — rearm은 가드가 내려간 틱부터', () => {
  const windowTicks = ticksTo(PLAYER.base.parryWindow);
  const rearmTicks = ticksTo(PLAYER.guard.rearm);
  for (const holdTicks of [1, 3, 5]) {
    const sim = makeSim();
    const active = [];
    const guarding = [];
    sim.run(windowTicks + 3, (i) => (i < holdTicks ? { guard: true } : undefined), (i, p) => {
      if (p.parryActive) active.push(i);
      if (p.guarding) guarding.push(i);
      assert.equal(p.parryActive, p.state === 'guard' && p.parryT > 0);
    });
    assert.deepEqual(active, Array.from({ length: windowTicks }, (_, i) => i), `${holdTicks}틱 탭: 창이 끝까지 열려 있다`);
    assert.deepEqual(guarding, active, '창이 끝나는 틱에 가드가 내려간다(버튼은 이미 뗐다)');
    assert.equal(sim.p.state, 'idle');
    assert.deepEqual(sim.events(EV.PLAYER_GUARD), [{ on: true }, { on: false }]);
    // 연타 방지는 그대로다: 가드가 내려간 틱(= 창의 끝)부터 rearm을 센다 — 탭을 연타해도 창이 더 자주 열리지 않는다
    near(sim.p.parryRearm, PLAYER.guard.rearm - 2 * DT, 1e-9, 'rearm은 가드가 내려간 틱부터');
    for (const [gap, expectOpen] of [[rearmTicks - 4, false], [rearmTicks - 3, true]]) {
      const again = makeSim();
      again.run(windowTicks + 3, (i) => (i < holdTicks ? { guard: true } : undefined));
      again.run(gap);
      let opened = false;
      again.run(5, { guard: true }, (i, p) => { opened = opened || p.parryActive; });
      assert.equal(opened, expectOpen, `${holdTicks}틱 탭 뒤 ${gap}틱째 재입력`);
    }
  }

  // 유지되는 동안에도 버퍼가 먼저다: 탭 직후의 구르기 · 공격은 곧바로 나간다
  let sim = makeSim();
  sim.tick({ guard: true });
  sim.tick({ moveX: 1, rollPressed: true });
  assert.equal(sim.p.state, 'roll');
  sim = makeSim();
  sim.tick({ guard: true });
  sim.tick({ lightPressed: true });
  assert.equal(sim.p.state, 'attack');

  // 창이 끝난 뒤에 떼면 종전대로 그 틱에 idle
  sim = makeSim();
  sim.run(windowTicks + 5, { guard: true });
  assert.equal(sim.p.parryActive, false);
  sim.tick();
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.parryRearm, PLAYER.guard.rearm);

  // 탈진하면 창이 남아 있어도 가드가 내려간다
  sim = makeSim();
  sim.tick({ guard: true });
  sim.p.exhausted = true;
  sim.p.stamina = 0;
  sim.p.staminaDelay = 5;
  sim.tick();
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.parryActive, false);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 9. 스태미나 ─────────────────────────

test('9. 스태미나: 0 → exhausted · PLAYER_STAMINA_OUT · exhaustedUntil까지 달리기/가드 불가 · 회복 지연', () => {
  const S = PLAYER.stamina;
  let sim = makeSim();
  sim.p.stamina = 10;
  sim.tick({ moveX: 1, rollPressed: true });
  assert.equal(sim.p.state, 'roll', '모자라도 시작한다');
  assert.equal(sim.p.stamina, 0, '0에서 멈춘다');
  assert.equal(sim.p.exhausted, true);
  assert.equal(sim.count(EV.PLAYER_STAMINA_OUT), 1);
  assert.equal(sim.p.staminaDelay, S.exhaustedDelay);
  // 탈진 회복 지연(W3: 0.9 → 0.75초): 44번 틱까지 0, 45번 틱부터 회복. exhaustedUntil(16)이 될 때까지 달리기 · 가드 불가.
  const resume = ticksTo(S.exhaustedDelay);
  let firstRegen = -1;
  let cleared = -1;
  sim.run(120, { moveX: 1, sprint: true, guard: true }, (i, p) => {
    const k = i + 1;
    if (firstRegen < 0 && p.stamina > 0) firstRegen = k;
    if (p.exhausted) {
      assert.equal(p.sprinting, false, `tick ${k}: 탈진 중 달리기 불가`);
      assert.equal(p.guarding, false, `tick ${k}: 탈진 중 가드 불가`);
      assert.ok(p.stamina < S.exhaustedUntil);
    } else if (cleared < 0) {
      cleared = k;
      assert.ok(p.stamina >= S.exhaustedUntil);
    }
  });
  assert.equal(firstRegen, resume);
  assert.equal(firstRegen, 45);
  near(cleared, resume + S.exhaustedUntil / sim.p.stats.staminaRegen / DT, 1.01, 'exhaustedUntil에 닿는 틱');
  assert.equal(sim.p.guarding, true, '풀리면 누르고 있던 가드가 선다');
  assert.equal(sim.count(EV.PLAYER_STAMINA_OUT), 1);

  // 스태미나 0에서는 구르기 · 공격이 나가지 않고 버퍼에 남는다 → 회복되면 유효 시간 안에서 나간다
  sim = makeSim();
  sim.p.stamina = 0;
  sim.p.exhausted = true;
  sim.p.staminaDelay = 10 * DT;
  sim.tick({ moveX: 1, rollPressed: true });
  assert.equal(sim.p.state, 'move');
  assert.equal(sim.p.buffer.action, 'roll');
  sim.run(9);
  assert.notEqual(sim.p.state, 'roll');
  sim.run(2);
  assert.equal(sim.p.state, 'roll', '스태미나가 돌아온 틱에 버퍼의 구르기가 나간다');
  // (W3) 탈진한 채 다시 0을 찍는 것은 새 탈진이 아니다 — 이벤트도 긴 지연도 다시 걸지 않는다(연타해도 매 타 탈진 연출에 묶이지 않는다)
  assert.equal(sim.p.stamina, 0);
  assert.equal(sim.p.exhausted, true);
  assert.equal(sim.count(EV.PLAYER_STAMINA_OUT), 0, '이미 탈진 중 — PLAYER_STAMINA_OUT을 다시 내지 않는다');
  assert.ok(sim.p.staminaDelay <= S.regenDelay + 1e-9 && sim.p.staminaDelay > S.regenDelay - 2 * DT,
    `긴 지연(exhaustedDelay ${S.exhaustedDelay})이 아니라 평소의 회복 지연(${sim.p.staminaDelay})`);

  // 일반 회복 지연 0.7초: 구르기(22) 뒤 41번 틱까지 그대로, 42번 틱부터 회복
  sim = makeSim();
  sim.tick({ moveX: 1, rollPressed: true });
  const regenAt = ticksTo(S.regenDelay);
  sim.run(regenAt - 1);
  assert.equal(sim.p.stamina, 100 - PLAYER.roll.cost);
  sim.tick();
  near(sim.p.stamina, 100 - PLAYER.roll.cost + sim.p.stats.staminaRegen * DT, 1e-9, '회복 재개 틱');
  sim.run(120);
  assert.equal(sim.p.stamina, 100, '상한에서 멈춘다');

  // 공격 중에는 회복하지 않는다(지연이 끝났어도)
  sim = makeSim({ stats: { weaponId: 'greatsword', weaponDamage: 34 } });
  const gsHeavy = getMoveDef('greatsword', 'heavy');
  sim.run(ticksTo(moveTotal(gsHeavy)) + 1, pressAt(0, { heavyPressed: true }), (i, p) => {
    if (p.state === 'attack') assert.equal(p.stamina, 100 - gsHeavy.stamina);
  });
  assert.ok(sim.p.stamina > 100 - gsHeavy.stamina, '후딜이 끝나면 바로 회복(지연 0.7초는 이미 지났다)');

  // 가드 중 회복은 guardRegenMul 배
  sim = makeSim();
  sim.p.stamina = 50;
  sim.run(10, { guard: true });
  near(sim.p.stamina, 50 + 10 * sim.p.stats.staminaRegen * S.guardRegenMul * DT, 1e-9, '가드 중 회복');

  // noStamina: 소모 0
  sim = makeSim();
  sim.state.debug.noStamina = true;
  sim.run(40, (i) => (i === 0 ? { moveX: 1, rollPressed: true } : { moveX: 1, sprint: true }));
  assert.equal(sim.p.stamina, 100);
  assert.equal(sim.p.exhausted, false);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 10. 플라스크 ─────────────────────────

test('10. 플라스크: 0.70초에 회복 · 차감 · 그 전에 맞으면 차감 없음 · empty · 가드/후딜에서', () => {
  const F = PLAYER.flask;
  const healTick = ticksTo(F.healAt);
  const actTick = ticksTo(F.actAt);
  assert.deepEqual([healTick, actTick], [42, 63]);

  let sim = makeSim();
  sim.p.hp = 30;
  sim.tick({ flaskPressed: true });
  assert.equal(sim.p.state, 'flask');
  assert.equal(sim.p.stateDur, F.dur);
  assert.deepEqual(sim.events(EV.PLAYER_FLASK), [{ phase: 'start', amount: 0, left: 3 }]);
  sim.run(healTick - 1);
  assert.equal(sim.p.hp, 30, 'healAt 전에는 회복하지 않는다');
  assert.equal(sim.p.flasks, 3);
  sim.tick();
  assert.equal(sim.p.hp, 30 + sim.p.stats.flaskHeal);
  assert.equal(sim.p.flasks, 2);
  assert.deepEqual(sim.events(EV.PLAYER_FLASK)[1], { phase: 'heal', amount: 45, left: 2 });
  // actAt 전에는 어떤 행동으로도 취소할 수 없다. 버퍼된 구르기는 actAt에 나간다.
  sim.run(actTick - healTick, (i) => (i === actTick - healTick - 6 ? { moveX: 1, rollPressed: true } : { guard: true, moveX: 1 }), (i, p) => {
    if (healTick + 1 + i < actTick) assert.equal(p.state, 'flask', `tick ${healTick + 1 + i}`);
  });
  assert.equal(sim.p.state, 'roll', 'actAt에 버퍼의 구르기');
  assert.equal(sim.count(EV.PLAYER_FLASK), 2, '회복은 한 번만');

  // 아무것도 안 누르면 dur까지 flask, 걷는 속력은 flaskSpeed
  sim = makeSim();
  sim.p.hp = 90;
  sim.run(ticksTo(F.actAt), (i) => (i === 0 ? { flaskPressed: true, moveZ: 1 } : { moveZ: 1 }));
  assert.equal(sim.p.state, 'flask');
  near(Math.hypot(sim.p.vel.x, sim.p.vel.z), PLAYER.move.flaskSpeed, 1e-9, '플라스크 걸음');
  assert.equal(sim.p.hp, 100, '상한 hpMax');
  assert.equal(sim.events(EV.PLAYER_FLASK)[1].amount, 10);
  sim = makeSim();
  let endTick = -1;
  sim.run(90, pressAt(0, { flaskPressed: true }), (i, p) => { if (endTick < 0 && i > 0 && p.state !== 'flask') endTick = i; });
  assert.equal(endTick, ticksTo(F.dur));

  // 회복 전에 맞으면 중단되고 충전은 줄지 않는다
  sim = makeSim();
  sim.p.hp = 30;
  sim.run(20, pressAt(0, { flaskPressed: true }));
  onPlayerDamaged(sim.ctx, dmg());
  assert.equal(sim.p.state, 'stagger');
  sim.run(90);
  assert.equal(sim.p.flasks, 3);
  assert.equal(sim.p.hp, 30);
  assert.equal(sim.events(EV.PLAYER_FLASK).filter((e) => e.phase === 'heal').length, 0);

  // 0개면 empty만
  sim = makeSim();
  sim.p.flasks = 0;
  sim.tick({ flaskPressed: true });
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.buffer.action, null);
  assert.deepEqual(sim.events(EV.PLAYER_FLASK), [{ phase: 'empty', amount: 0, left: 0 }]);

  // guard에서 누르면 가드를 풀고 바로 마신다
  sim = makeSim();
  sim.run(20, { guard: true });
  sim.tick({ guard: true, flaskPressed: true });
  assert.equal(sim.p.state, 'flask');
  assert.equal(sim.p.guarding, false);
  assert.deepEqual(sim.events(EV.PLAYER_GUARD), [{ on: true }, { on: false }]);

  // 공격 후딜의 rollCancelAt 이후에 나간다
  sim = makeSim();
  const cancelTick = ticksTo(rollCancelTime(LS.light1));
  sim.run(cancelTick + 1, (i) => (i === 0 ? { lightPressed: true } : i === 25 ? { flaskPressed: true } : undefined), (i, p) => {
    if (i < cancelTick) assert.equal(p.state, 'attack');
  });
  assert.equal(sim.p.state, 'flask');
  assert.equal(sim.p.stateTime, 0);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 11. 피격 반응 ─────────────────────────

test('11. onPlayerDamaged: 전이 6종 · knockVel 감쇠 · staminaDelay · iframe · 기상 무적', () => {
  const H = PLAYER.hurt;
  // hit && lethal → dead
  let sim = makeSim();
  sim.p.hp = 0;
  onPlayerDamaged(sim.ctx, dmg({ lethal: true }));
  assert.equal(sim.p.state, 'dead');
  assert.equal(sim.p.stateDur, 0);

  // hit && knockdown → knockdown → getup → idle, 전 구간 무적 + 기상 후 wakeInvuln
  sim = makeSim();
  sim.run(10, pressAt(0, { lightPressed: true }));
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true, dir: Math.PI / 2 }));
  assert.equal(sim.p.state, 'knockdown');
  assert.equal(sim.p.stateDur, H.knockdownDur);
  assert.equal(sim.p.attack, null, '공격은 중단된다');
  assert.equal(getPlayerHit(sim.ctx), null);
  assert.equal(sim.p.iframe, true, 'hit 직후 iframe');
  near(sim.p.knockVel.x, H.knockdownPush, 1e-9, 'knockVel = fromAngle(dir, knockdownPush)');
  near(sim.p.knockVel.z, 0, 1e-9, 'knockVel.z');
  const kd = ticksTo(H.knockdownDur);
  const gu = ticksTo(H.getupDur);
  sim.run(kd + gu, null, (i, p) => {
    const k = i + 1;
    assert.equal(p.iframe, true, `tick ${k}: 넘어짐 ~ 기상 무적`);
    assert.equal(p.state, k < kd ? 'knockdown' : k < kd + gu ? 'getup' : 'idle', `tick ${k}`);
  });
  assert.equal(sim.p.state, 'idle');
  assert.equal(sim.p.hurtInvuln, H.wakeInvuln, 'getup이 끝난 틱에 hurtInvuln = wakeInvuln');
  let wake = 1;   // 일어난 틱 포함
  sim.run(30, null, (i, p) => { if (p.iframe) wake += 1; });
  assert.equal(wake, ticksTo(H.wakeInvuln), '기상 무적 0.20초');
  assert.ok(sim.p.pos.x > 0.5, '넉백으로 밀렸다');
  near(sim.p.pos.x, H.knockdownPush / H.knockDecay, 0.1, '넉백 거리 ≈ push / decay');
  assertFiniteDeep(sim.state);

  // hit → stagger, hurtInvuln, knockVel 지수 감쇠
  sim = makeSim();
  onPlayerDamaged(sim.ctx, dmg({ dir: 0 }));
  assert.equal(sim.p.state, 'stagger');
  assert.equal(sim.p.stateDur, H.staggerDur);
  assert.equal(sim.p.hurtInvuln, H.invuln);
  assert.equal(sim.p.iframe, true);
  near(sim.p.knockVel.z, H.staggerPush, 1e-9, 'staggerPush');
  let prev = sim.p.knockVel.z;
  sim.tick();
  near(sim.p.knockVel.z, H.staggerPush * Math.exp(-H.knockDecay * DT), 1e-9, '한 틱 감쇠');
  near(sim.p.pos.z, H.staggerPush * DT, 1e-9, '밀린 거리');
  let invulnTicks = 2;   // 피격 틱 + 방금 틱
  let staggerEnd = -1;
  sim.run(60, null, (i, p) => {
    const k = i + 2;
    assert.ok(p.knockVel.z <= prev, 'knockVel 단조 감소');
    prev = p.knockVel.z;
    if (p.iframe) invulnTicks += 1;
    if (staggerEnd < 0 && p.state !== 'stagger') staggerEnd = k;
  });
  assert.equal(staggerEnd, ticksTo(H.staggerDur));
  assert.equal(invulnTicks, ticksTo(H.invuln), '피격 무적 0.50초');
  assert.equal(sim.p.iframe, false);

  // guard → guardHit: staminaDelay = regenDelay, knockVel = guardPush
  sim = makeSim();
  sim.run(30, { guard: true });
  sim.p.stamina = 60;
  sim.p.staminaDelay = 0;
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'guard', staminaDamage: 20, dir: 0 }));
  assert.equal(sim.p.state, 'guardHit');
  assert.equal(sim.p.stateDur, PLAYER.guard.hitDur);
  assert.equal(sim.p.staminaDelay, PLAYER.stamina.regenDelay);
  assert.equal(sim.p.exhausted, false);
  near(sim.p.knockVel.z, H.guardPush, 1e-9, 'guardPush');
  assert.equal(sim.p.guarding, true);
  assert.equal(sim.count(EV.PLAYER_STAMINA_OUT), 0);

  // guard && guardBreak → guardBreak: exhausted · exhaustedDelay · PLAYER_STAMINA_OUT
  sim = makeSim();
  sim.run(30, { guard: true });
  sim.p.stamina = 0;   // P2가 이미 깎았다
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'guard', guardBreak: true, staminaDamage: 30, dir: 0 }));
  assert.equal(sim.p.state, 'guardBreak');
  assert.equal(sim.p.stateDur, PLAYER.guard.breakDur);
  assert.equal(sim.p.exhausted, true);
  assert.equal(sim.p.staminaDelay, PLAYER.stamina.exhaustedDelay);
  assert.equal(sim.count(EV.PLAYER_STAMINA_OUT), 1);
  assert.equal(sim.p.guarding, false);
  assert.equal(sim.p.iframe, false, '가드 붕괴에는 무적이 없다');
  near(sim.p.knockVel.z, H.guardPush, 1e-9, 'guardPush');
  assert.deepEqual(sim.events(EV.PLAYER_GUARD).at(-1), { on: false });
  let breakEnd = -1;
  sim.run(90, { guard: true }, (i, p) => { if (breakEnd < 0 && p.state !== 'guardBreak') breakEnd = i + 1; });
  assert.equal(breakEnd, ticksTo(PLAYER.guard.breakDur));

  // parry → parry: 전 구간 무적, actAt 이후 약 · 강 · 구르기
  sim = makeSim();
  sim.tick({ guard: true });
  assert.equal(sim.p.parryActive, true);
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'parry', damage: 0 }));
  assert.equal(sim.p.state, 'parry');
  assert.equal(sim.p.stateDur, PLAYER.parry.dur);
  assert.equal(sim.p.iframe, true, 'parry 직후 iframe');
  assert.equal(sim.p.parryActive, false);
  assert.equal(sim.p.guarding, false);
  const pAct = ticksTo(PLAYER.parry.actAt);
  const starts = recordAttackStarts(sim, pAct + 1, (i) => (i === 2 ? { guard: true, lightPressed: true } : { guard: true }));
  assert.deepEqual(starts, [{ tick: pAct - 1, moveId: 'light1', comboIndex: 0 }], '패링 0.12초 뒤 반격');
  sim = makeSim();
  sim.tick({ guard: true });
  onPlayerDamaged(sim.ctx, dmg({ outcome: 'parry', damage: 0 }));
  let parryEnd = -1;
  sim.run(40, { guard: true }, (i, p) => {
    const k = i + 1;
    if (p.state === 'parry') assert.equal(p.iframe, true, `tick ${k}: 패링 자세 무적`);
    else if (parryEnd < 0) parryEnd = k;
    assert.equal(p.parryActive, false, '홀드로 돌아온 가드에는 창이 없다');
  });
  assert.equal(parryEnd, ticksTo(PLAYER.parry.dur));
  assert.equal(sim.p.state, 'guard', '홀드 중이면 패링 자세 뒤 가드로');
  assertFiniteDeep(sim.state);
});

test('11b. onPlayerDealtHit: 흡혈은 준 피해 × lifesteal(상한 hpMax), 기본은 0', () => {
  let sim = makeSim({ stats: { lifesteal: 0.05 } });
  sim.p.hp = 50;
  onPlayerDealtHit(sim.ctx, dmg({ source: 'player', target: 'boss', damage: 100 }));
  assert.equal(sim.p.hp, 55);
  sim.p.hp = 98;
  onPlayerDealtHit(sim.ctx, dmg({ source: 'player', target: 'boss', damage: 100 }));
  assert.equal(sim.p.hp, 100);
  sim = makeSim();
  sim.p.hp = 50;
  onPlayerDealtHit(sim.ctx, dmg({ source: 'player', target: 'boss', damage: 100 }));
  assert.equal(sim.p.hp, 50);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 12. 처형 ─────────────────────────

test('12. 처형: 조건 충족 시 execute · hitAt의 한 틱에 execute 판정 · canExecute · attack 필드 · SWING', () => {
  const X = PLAYER.execute;
  // 보스는 (0, 3)에서 −Z(플레이어 쪽)를 본다. 거리 3 ≤ range 2.4 + radius 0.8.
  const groggySim = (opts = {}) => {
    const sim = makeSim({ boss: true, bossPos: { x: 0, z: 3 }, stats: { executeMul: 1.5, damageMul: 1.2 }, ...opts });
    sim.boss.state = 'groggy';
    return sim;
  };
  let sim = groggySim({ facing: 2 });
  sim.tick();
  assert.equal(sim.p.canExecute, true);
  sim.tick({ lightPressed: true });
  const p = sim.p;
  assert.equal(p.state, 'execute');
  assert.equal(p.stateDur, X.dur);
  near(p.facing, 0, 1e-12, '보스를 바라보게 스냅');
  assert.equal(p.iframe, true);
  assert.equal(p.stamina, 100, '처형은 스태미나를 쓰지 않는다');
  assert.deepEqual(sim.events(EV.EXECUTE_STARTED), [{ x: 0, z: 0, bossX: 0, bossZ: 3 }]);
  const { hitId, ...rest } = p.attack;
  assert.deepEqual(rest, {
    moveId: 'execute', weaponId: 'longsword', kind: 'execute', motion: 'thrust', comboIndex: 0,
    phase: 'windup', phaseT: 0, charge: 0,
  });
  assert.equal(typeof hitId, 'number');
  assert.equal(sim.count(EV.PLAYER_ATTACK_START), 0, '처형은 일반 공격 시작 이벤트를 내지 않는다');

  const hitTick = ticksTo(X.hitAt);
  const endTick = ticksTo(X.dur);
  assert.deepEqual([hitTick, endTick], [42, 96]);
  const hits = [];
  sim.run(endTick, null, (i, pl) => {
    const k = i + 1;
    const hit = getPlayerHit(sim.ctx);
    if (hit) hits.push({ k, hit });
    if (k < endTick) {
      assert.equal(pl.state, 'execute');
      assert.equal(pl.iframe, true, `tick ${k}: 처형 중 무적`);
      assert.equal(pl.canExecute, false, '처형 중에는 약공격을 받지 않는다');
      const phase = k < hitTick ? 'windup' : k === hitTick ? 'active' : 'recovery';
      assert.equal(pl.attack.phase, phase, `tick ${k}`);
      if (phase === 'windup') near(pl.attack.phaseT, pl.stateTime / X.hitAt, 1e-9, 'windup phaseT');
      if (phase === 'recovery') near(pl.attack.phaseT, (pl.stateTime - X.hitAt) / (X.dur - X.hitAt), 1e-9, 'recovery phaseT');
    }
  });
  assert.equal(p.state, 'idle');
  assert.equal(p.attack, null);
  assert.equal(hits.length, 1, '판정은 한 틱만');
  assert.equal(hits[0].k, hitTick);
  const h = hits[0].hit;
  assert.equal(h.execute, true);
  assert.equal(h.attackId, 'execute');
  assert.equal(h.heavy, true);
  assert.equal(h.posture, 0);
  assert.equal(h.hitId, hitId);
  near(h.damage, 20 * 1.2 * X.dmgMul * 1.5, 1e-9, 'weaponDamage × damageMul × dmgMul × executeMul');
  assert.deepEqual(sim.events(EV.PLAYER_SWING), [
    { moveId: 'execute', kind: 'execute', motion: 'thrust', weaponId: 'longsword', charge: 0, heavy: true, dur: DT },
  ]);
  assertFiniteDeep(sim.state);

  // canExecute가 조건(거리 · 정면각 · 보스 상태 · 플레이어 상태)과 같이 움직인다. 불충족이면 일반 공격.
  const cases = [
    ['거리 경계 안', (s) => { s.boss.pos.z = X.range + s.boss.radius - 0.01; }, true],
    ['거리 밖', (s) => { s.boss.pos.z = X.range + s.boss.radius + 0.01; }, false],
    ['정면각 안', (s) => { s.boss.facing = Math.PI - (X.frontHalf - 0.01); }, true],
    ['정면각 밖(옆/뒤)', (s) => { s.boss.facing = Math.PI - (X.frontHalf + 0.01); }, false],
    ['보스의 등 뒤', (s) => { s.boss.facing = 0; }, false],
    ['그로기가 아님', (s) => { s.boss.state = 'recover'; }, false],
  ];
  for (const [label, mutate, expected] of cases) {
    sim = groggySim();
    mutate(sim);
    sim.tick();
    assert.equal(sim.p.canExecute, expected, `canExecute: ${label}`);
    sim.tick({ lightPressed: true });
    assert.equal(sim.p.state, expected ? 'execute' : 'attack', label);
    if (!expected) assert.equal(sim.p.attack.moveId, 'light1');
  }
  // 상태가 약공격을 받지 않으면 false(경직 중), 받게 되면 true
  sim = groggySim();
  onPlayerDamaged(sim.ctx, dmg({ dir: Math.PI / 2 }));
  assert.equal(sim.p.canExecute, false);
  const stEnd = ticksTo(PLAYER.hurt.staggerDur);
  sim.run(stEnd, null, (i, pl) => assert.equal(pl.canExecute, i === stEnd - 1, `stagger tick ${i}`));
  // 공격 후딜의 comboAt 이후에는 처형이 된다(버퍼된 약 입력 포함)
  sim = groggySim();
  sim.boss.state = 'idle';
  const combo = ticksTo(comboBeat(LS.light1));
  sim.run(combo + 1, (i) => (i === 0 || i === 20 ? { lightPressed: true } : undefined), (i, pl) => {
    if (i === 10) sim.boss.state = 'groggy';
    if (i >= 10 && i < combo) assert.equal(pl.canExecute, false, `tick ${i}: 후딜 comboAt 전`);
  });
  assert.equal(sim.p.state, 'execute', '버퍼의 약 입력이 comboAt에 처형으로');
  // 마을에서는 항상 false
  sim = makeSim();
  sim.tick();
  assert.equal(sim.p.canExecute, false);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 13. 히트스톱 버퍼 ─────────────────────────

test('13. bufferPlayerInput: stateTime을 움직이지 않는다 · 히트스톱 틱의 록온 토글은 즉시', () => {
  const sim = makeSim({ boss: true });
  sim.run(20, pressAt(0, { lightPressed: true }));
  const snap = structuredClone(sim.p);
  // 히트스톱 3틱: 구르기를 누르고, 가드를 누르고 있고, 록온을 켠다
  bufferPlayerInput(sim.ctx, makeInput({ guard: true }), DT);
  bufferPlayerInput(sim.ctx, makeInput({ guard: true, moveX: 1, rollPressed: true }), DT);
  bufferPlayerInput(sim.ctx, makeInput({ guard: true, lockOnPressed: true }), DT);
  assert.equal(sim.p.lockOn, true, '록온은 즉시 토글');
  assert.deepEqual(sim.events(EV.LOCKON_CHANGED), [{ on: true }]);
  assert.deepEqual(sim.p.buffer, { action: 'roll', t: PLAYER.bufferAttack, dirX: 1, dirZ: 0 });
  // 그 밖의 필드는 전부 그대로다
  const after = structuredClone(sim.p);
  after.lockOn = snap.lockOn;
  after.buffer = snap.buffer;
  assert.deepEqual(after, snap, '타이머 · 상태 · guardHeldPrev는 건드리지 않는다');
  assert.equal(sim.p.stateTime, snap.stateTime);
  assert.equal(sim.p.guardHeldPrev, false);
  // 한 번 더 누르면 꺼진다
  bufferPlayerInput(sim.ctx, makeInput({ lockOnPressed: true }), DT);
  assert.equal(sim.p.lockOn, false);
  assert.equal(sim.count(EV.LOCKON_CHANGED), 2);
  // 버퍼는 히트스톱 동안 줄지 않는다 → 캔슬 창에서 구르기가 나간다
  const cancelTick = ticksTo(rollCancelTime(LS.light1));
  sim.run(cancelTick - 19 - 1);
  assert.equal(sim.p.state, 'attack');
  sim.tick();
  assert.equal(sim.p.state, 'roll');

  // 히트스톱 중에 누른 가드는 다음 정상 틱에 에지로 잡힌다(패링 창이 열린다)
  const g = makeSim();
  g.tick();
  bufferPlayerInput(g.ctx, makeInput({ guard: true }), DT);
  bufferPlayerInput(g.ctx, makeInput({ guard: true }), DT);
  assert.equal(g.p.state, 'idle');
  assert.equal(g.p.guardHeldPrev, false);
  g.tick({ guard: true });
  assert.equal(g.p.state, 'guard');
  assert.equal(g.p.parryActive, true);

  // 마을에서는 켜지지 않는다. 죽으면 버퍼도 록온도 받지 않는다.
  const town = makeSim();
  bufferPlayerInput(town.ctx, makeInput({ lockOnPressed: true, lightPressed: true }), DT);
  assert.equal(town.p.lockOn, false);
  assert.equal(town.count(EV.LOCKON_CHANGED), 0);
  assert.equal(town.p.buffer.action, 'light');
  assert.equal(town.p.buffer.t, PLAYER.buffer);
  const dead = makeSim({ boss: true });
  onPlayerDamaged(dead.ctx, dmg({ lethal: true }));
  bufferPlayerInput(dead.ctx, makeInput({ lockOnPressed: true, rollPressed: true }), DT);
  assert.equal(dead.p.buffer.action, null);
  assert.equal(dead.p.lockOn, false);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 14. 무기 3종 × 전 무브 ─────────────────────────

const MOVE_FIELDS = [
  'id', 'kind', 'motion', 'windup', 'active', 'recovery', 'chargeMax', 'dmgMul', 'chargeDmgMul', 'posture', 'stamina',
  'shape', 'lunge', 'comboAt', 'rollCancelAt', 'next', 'hitstop', 'heavy',
];
const MOTIONS = ['slashR', 'slashL', 'slashUp', 'overhead', 'thrust', 'spin', 'sweep'];

test('14. 무기 3종 × 전 무브: 표의 필드 완비 · 한 번씩 끝까지 — 예외 0 · NaN 0', () => {
  assert.deepEqual(Object.keys(WEAPONS), WEAPON_IDS);
  assert.deepEqual(WEAPON_IDS.map((id) => Object.keys(WEAPONS[id].moves).length), [7, 6, 7], '장검 7 · 대검 6 · 창 7');
  const cycle = {};
  for (const weaponId of WEAPON_IDS) {
    const w = getWeaponDef(weaponId);
    assert.equal(w.id, weaponId);
    for (const f of ['baseDamage', 'guardReduction', 'guardStaminaFactor', 'reach', 'length']) {
      assert.ok(Number.isFinite(w[f]) && w[f] > 0, `${weaponId}.${f}`);
    }
    assert.ok(['oneHand', 'twoHand', 'polearm'].includes(w.grip));
    for (const id of ['light1', 'heavy', 'dash', 'rollAtk']) assert.ok(w.moves[id], `${weaponId}.${id}`);
    for (const [id, mv] of Object.entries(w.moves)) {
      const at = `${weaponId}.${id}`;
      assert.deepEqual(Object.keys(mv).sort(), [...MOVE_FIELDS].sort(), `${at}: MoveDef 필드`);
      assert.equal(mv.id, id);
      assert.equal(getMoveDef(weaponId, id), mv);
      assert.ok(MOTIONS.includes(mv.motion), `${at}.motion`);
      assert.equal(mv.kind, id.startsWith('light') ? 'light' : id === 'rollAtk' ? 'roll' : id);
      for (const f of ['windup', 'active', 'recovery', 'dmgMul', 'posture', 'stamina', 'lunge', 'hitstop']) {
        assert.ok(Number.isFinite(mv[f]) && mv[f] > 0, `${at}.${f}`);
      }
      assert.ok(mv.comboAt > 0 && mv.comboAt <= mv.recovery, `${at}.comboAt ≤ recovery`);
      assert.ok(mv.rollCancelAt > 0 && mv.rollCancelAt <= mv.recovery, `${at}.rollCancelAt ≤ recovery`);
      assert.ok(mv.next === null || w.moves[mv.next], `${at}.next가 가리키는 무브가 있다`);
      if (mv.next === null) assert.equal(mv.comboAt, mv.recovery, `${at}: 연속기 끝이면 comboAt = recovery`);
      assert.equal(mv.heavy, mv.hitstop >= 0.07, `${at}.heavy = hitstop ≥ 0.07`);
      if (mv.kind === 'heavy') {
        assert.ok(mv.chargeMax > 0 && mv.chargeDmgMul > 1, `${at}: 차지`);
      } else {
        assert.equal(mv.chargeMax, 0);
        assert.equal(mv.chargeDmgMul, 1);
      }
      assert.ok(['arc', 'capsule'].includes(mv.shape.type));
      assert.ok(mv.windup >= PLAYER.move.attackSnapDur, `${at}: 조준 스냅이 예고 안에 끝난다`);
      // 캔슬 창에서 나가려면 예고 시작에 누른 구르기가 아니어도 된다 — 후딜에 누른 입력은 항상 살아 있다
      assert.ok(mv.recovery <= PLAYER.bufferAttack + mv.rollCancelAt, `${at}: 후딜에 누른 입력은 끝까지 유효`);
    }
    assert.equal(getMoveDef(weaponId, 'nope'), null);
    // 약 연속기 한 사이클의 화력(§7.3)
    let t = 0;
    let d = 0;
    for (let mv = w.moves.light1; mv; mv = mv.next ? w.moves[mv.next] : null) {
      t += comboBeat(mv);
      d += w.baseDamage * mv.dmgMul;
    }
    cycle[weaponId] = d / t;
  }
  // 세 무기의 사이클 화력 비 1 : 1.15 : 0.89 (±5%)
  near(cycle.greatsword / cycle.longsword, 1.15, 1.15 * 0.05, '대검/장검 화력 비');
  near(cycle.spear / cycle.longsword, 0.89, 0.89 * 0.05, '창/장검 화력 비');
  near(cycle.longsword, 35.7, 0.1, '장검 사이클 화력');

  // 전 무브를 실제 입력으로 한 번씩 끝까지
  for (const weaponId of WEAPON_IDS) {
    const w = getWeaponDef(weaponId);
    const stats = { weaponId, weaponDamage: w.baseDamage, guardReduction: w.guardReduction, guardStaminaFactor: w.guardStaminaFactor };
    const seen = new Set();
    /** 공격이 끝날 때까지 돌며 구간 · 판정을 검사한다. */
    const finish = (sim, label) => {
      let guard = 0;
      while (sim.p.state === 'attack') {
        const a = sim.p.attack;
        const mv = getMoveDef(weaponId, a.moveId);
        assert.ok(mv, `${label}: ${a.moveId}`);
        assert.equal(a.weaponId, weaponId);
        assert.equal(a.motion, mv.motion);
        assert.equal(a.kind, mv.kind);
        const hit = getPlayerHit(sim.ctx);
        assert.equal(hit !== null, a.phase === 'active');
        if (hit) {
          seen.add(a.moveId);
          assert.equal(hit.shapeDef, mv.shape);
          near(hit.damage, w.baseDamage * mv.dmgMul * lerp(1, mv.chargeDmgMul, a.charge), 1e-9, `${label} 피해`);
          assert.equal(hit.hitstop, mv.hitstop);
        }
        sim.tick();
        assert.ok((guard += 1) < 400, `${label}: 공격이 끝나지 않는다`);
      }
      assert.equal(sim.p.state, 'idle', label);
      assert.equal(sim.p.attack, null);
      assertFiniteDeep(sim.state, `${label} state`);
    };
    // 약 연속기 전체(연타)
    let sim = makeSim({ stats });
    const chain = [];
    for (let mv = w.moves.light1; mv; mv = mv.next ? w.moves[mv.next] : null) chain.push(mv.id);
    let total = 0;
    for (const id of chain) total += ticksTo(moveTotal(w.moves[id]));
    let lastStarted = false;
    const starts = recordAttackStarts(sim, total, () => {
      lastStarted = lastStarted || (sim.p.attack !== null && sim.p.attack.moveId === chain.at(-1));
      return lastStarted ? undefined : { lightPressed: true };
    });
    assert.deepEqual(starts.map((s) => s.moveId), chain, `${weaponId} 약 연속기`);
    assert.deepEqual(starts.map((s) => s.comboIndex), chain.map((_, i) => i));
    // 무브 하나씩
    for (const id of chain) {
      sim = makeSim({ stats });
      // 앞 타들을 comboAt에서 이어 목표 타까지 간 뒤, 그 타를 끝까지 본다
      let guard = 0;
      while (!(sim.p.attack && sim.p.attack.moveId === id)) {
        sim.tick({ lightPressed: true });
        assert.ok((guard += 1) < 600);
      }
      finish(sim, `${weaponId}.${id}`);
    }
    sim = makeSim({ stats });
    sim.tick({ heavyPressed: true });
    finish(sim, `${weaponId}.heavy`);
    sim = makeSim({ stats });
    sim.run(100, (i) => (i === 0 ? { heavyPressed: true, heavyHeld: true } : { heavyHeld: true }));
    finish(sim, `${weaponId}.heavy(완충)`);
    sim = makeSim({ stats });
    sim.run(31, (i) => ({ moveX: 1, sprint: true, lightPressed: i === 30 }));
    assert.equal(sim.p.attack.moveId, 'dash');
    finish(sim, `${weaponId}.dash`);
    sim = makeSim({ stats });
    sim.run(ticksTo(PLAYER.roll.actAt) + 1, (i) => (i === 0 ? { moveX: 1, rollPressed: true } : i === 20 ? { lightPressed: true } : undefined));
    assert.equal(sim.p.attack.moveId, 'rollAtk');
    finish(sim, `${weaponId}.rollAtk`);
    assert.deepEqual([...seen].sort(), Object.keys(w.moves).sort(), `${weaponId}: 전 무브가 판정을 냈다`);
  }
});

// ───────────────────────── 15. 직접 사망 ─────────────────────────

test('15. hp를 직접 0으로 쓰면 다음 틱에 dead — 그 뒤로는 아무 입력도 받지 않는다', () => {
  const sim = makeSim({ boss: true, lockOn: true });
  sim.run(10, { guard: true });
  sim.tick({ guard: true, lightPressed: true });
  assert.equal(sim.p.state, 'attack');
  sim.p.hp = 0;
  sim.tick({ guard: true });
  assert.equal(sim.p.state, 'dead');
  assert.equal(sim.p.stateTime, DT);
  assert.equal(sim.p.stateDur, 0);
  assert.equal(sim.p.attack, null);
  assert.equal(getPlayerHit(sim.ctx), null);
  assert.equal(sim.p.iframe, false);
  assert.equal(sim.p.guarding, false);
  assert.equal(sim.p.parryActive, false);
  assert.equal(sim.p.canExecute, false);
  const eventsBefore = sim.ctx.events.length;
  const pos = { ...sim.p.pos };
  sim.run(60, { moveX: 1, sprint: true, guard: true, lightPressed: true, rollPressed: true, flaskPressed: true, heavyPressed: true, lockOnPressed: true });
  assert.equal(sim.p.state, 'dead');
  assert.equal(sim.p.buffer.action, null);
  assert.deepEqual(sim.p.pos, pos, '죽은 뒤에는 움직이지 않는다');
  assert.equal(sim.ctx.events.length, eventsBefore, '죽은 뒤에는 이벤트를 내지 않는다');
  near(sim.p.stateTime, 61 * DT, 1e-9, 'dead의 stateTime은 흐른다(view의 쓰러짐 연출)');
  // 죽은 뒤의 피격 통지는 무시한다
  onPlayerDamaged(sim.ctx, dmg({ knockdown: true }));
  assert.equal(sim.p.state, 'dead');
  // 가드 중 사망이면 PLAYER_GUARD{on:false}가 나간다
  const g = makeSim();
  g.run(5, { guard: true });
  g.p.hp = 0;
  g.tick({ guard: true });
  assert.equal(g.p.state, 'dead');
  assert.deepEqual(g.events(EV.PLAYER_GUARD), [{ on: true }, { on: false }]);
  assertFiniteDeep(sim.state);
});

// ───────────────────────── 16. 불변식(무작위 입력) ─────────────────────────

test('16. 무작위 입력 · 피격 20000틱: 예외 0 · NaN 0 · 상태 불변식 · dt가 커도 안전', () => {
  const STATES = ['idle', 'move', 'roll', 'backstep', 'attack', 'guard', 'guardHit', 'guardBreak', 'parry', 'flask',
    'stagger', 'knockdown', 'getup', 'execute', 'dead'];
  const visited = new Set();
  for (const weaponId of WEAPON_IDS) {
    const rng = createRng(1234 + weaponId.length);
    const w = getWeaponDef(weaponId);
    const sim = makeSim({ boss: true, stats: { weaponId, weaponDamage: w.baseDamage, lifesteal: 0.05, postRollWindow: 1.5, postRollDmgMul: 1.25 } });
    let held = { moveX: 0, moveZ: 0, sprint: false, guard: false, heavyHeld: false };
    for (let i = 0; i < 20000 / WEAPON_IDS.length; i++) {
      const p = sim.p;
      // 400틱마다 성향을 바꾼다: 공격적(연타 · 달리기) ↔ 수비적(가드 위주 — guardHit · guardBreak를 밟는다)
      const calm = Math.floor(i / 400) % 2 === 1;
      const busy = calm ? 0.15 : 1;
      if (rng.chance(0.05)) {
        const a = rng.range(-Math.PI, Math.PI);
        const m = rng.chance(0.3) ? 0 : rng.range(0, 1);
        held = {
          moveX: Math.sin(a) * m, moveZ: Math.cos(a) * m, sprint: rng.chance(calm ? 0.1 : 0.4),
          guard: rng.chance(calm ? 0.8 : 0.3), heavyHeld: rng.chance(0.3),
        };
      }
      const input = {
        ...held,
        lightPressed: rng.chance(0.06 * busy), heavyPressed: rng.chance(0.03 * busy), rollPressed: rng.chance(0.04 * busy),
        flaskPressed: rng.chance(0.01), lockOnPressed: rng.chance(0.01),
      };
      if (rng.chance(0.1)) bufferPlayerInput(sim.ctx, makeInput(input), DT);   // 히트스톱 틱
      else sim.tick(input);
      visited.add(p.state);

      // 보스 쪽 사정: 가끔 그로기 · 사망 · 위치 변화
      if (rng.chance(0.004)) sim.boss.state = rng.pick(['idle', 'attack', 'groggy', 'groggy', 'dead', 'idle']);
      if (rng.chance(0.01)) { sim.boss.pos.x = p.pos.x + rng.range(-3, 3); sim.boss.pos.z = p.pos.z + rng.range(-3, 3); }
      // P2가 할 일을 흉내 낸다: 판정 → hp/stamina 차감 → onPlayerDamaged, 명중 통지
      if (getPlayerHit(sim.ctx) && rng.chance(0.3)) onPlayerDealtHit(sim.ctx, dmg({ source: 'player', target: 'boss', damage: 30 }));
      if (p.state !== 'dead' && rng.chance(0.02) && !p.iframe) {
        const dir = rng.range(-Math.PI, Math.PI);
        if (p.parryActive) {
          onPlayerDamaged(sim.ctx, dmg({ outcome: 'parry', damage: 0, dir }));
        } else if (p.guarding) {
          p.stamina = Math.max(0, p.stamina - 30);
          onPlayerDamaged(sim.ctx, dmg({ outcome: 'guard', guardBreak: p.stamina === 0, dir }));
        } else {
          p.hp = Math.max(0, p.hp - 20);
          onPlayerDamaged(sim.ctx, dmg({ outcome: 'hit', knockdown: rng.chance(0.3), lethal: p.hp === 0, dir }));
        }
      }
      if (rng.chance(0.002)) p.hp = 0;                       // 디버그가 직접 쓴 사망
      if (p.state === 'dead' && rng.chance(0.02)) {          // 재도전
        sim.state.player = createPlayerState(p.stats, { x: 0, z: 0, facing: 0 });
        sim.p = sim.state.player;
        continue;
      }

      // 불변식
      const at = `${weaponId} tick ${i} (${p.state})`;
      assert.ok(STATES.includes(p.state), at);
      assert.equal(p.attack !== null, p.state === 'attack' || p.state === 'execute', `${at}: attack 필드는 attack/execute에서만`);
      assert.ok(p.stamina >= 0 && p.stamina <= p.stats.staminaMax, `${at}: stamina ${p.stamina}`);
      assert.ok(p.hp >= 0 && p.hp <= p.stats.hpMax && Number.isInteger(p.hp), `${at}: hp ${p.hp}`);
      assert.ok(p.flasks >= 0 && p.flasks <= p.stats.flaskCharges, `${at}: flasks`);
      assert.ok(p.facing > -Math.PI - 1e-9 && p.facing <= Math.PI + 1e-9, `${at}: facing ${p.facing}`);
      assert.equal(p.buffer.action === null, p.buffer.t === 0, `${at}: 버퍼의 action과 t는 같이 비워진다`);
      if (p.state !== 'dead') {
        assert.equal(p.guarding, p.state === 'guard' || p.state === 'guardHit', `${at}: guarding`);
        if (p.parryActive) assert.equal(p.state, 'guard', `${at}: parryActive`);
        if (p.sprinting) assert.equal(p.state, 'move', `${at}: sprinting`);
        if (p.canExecute) assert.equal(sim.boss.state, 'groggy', `${at}: canExecute`);
      }
      if (p.stateDur > 0) assert.ok(p.stateTime < p.stateDur + 1e-6, `${at}: stateTime ${p.stateTime} / ${p.stateDur}`);
      const hit = getPlayerHit(sim.ctx);
      assert.equal(hit !== null, p.attack !== null && p.attack.phase === 'active', `${at}: 판정`);
      for (const t of [p.buffer.t, p.staminaDelay, p.hurtInvuln, p.postRollT, p.parryT, p.parryArmT, p.parryRearm, p.lightLock, p.heavyLock]) {
        assert.ok(t >= 0, `${at}: 타이머는 음수가 되지 않는다`);
      }
      if (i % 200 === 0) {
        assertFiniteDeep(sim.state, at);
        structuredClone(sim.state.player);
      }
    }
    assertFiniteDeep(sim.state);
  }
  assert.deepEqual([...visited].sort(), [...STATES].sort(), '15개 상태를 전부 지나갔다');

  // dt가 커도(프레임 드랍) NaN 없이 굴러가고, 한 번뿐인 일(판정 · 회복 · 처형 타격)은 정확히 한 번 일어난다
  for (const dt of [0.1, 0.5]) {
    const big = (partial) => {
      const sim = makeSim({ boss: true, bossPos: { x: 0, z: 3 } });
      const step = (p) => updatePlayer(sim.ctx, makeInput(p), dt);
      step(partial);
      return { sim, step };
    };
    for (const press of [{ lightPressed: true }, { heavyPressed: true }, { heavyPressed: true, heavyHeld: true }]) {
      const { sim, step } = big(press);
      let activeTicks = 0;
      for (let i = 0; i < 40 && sim.p.state === 'attack'; i++) {
        if (getPlayerHit(sim.ctx)) activeTicks += 1;
        step({ heavyHeld: press.heavyHeld === true });
      }
      assert.equal(sim.p.state, 'idle');
      assert.ok(activeTicks >= 1, `dt ${dt}: 판정 구간이 최소 한 틱 선다`);
      assert.equal(sim.count(EV.PLAYER_SWING), 1);
      assertFiniteDeep(sim.state, `dt ${dt}`);
    }
    {
      const { sim, step } = big({ moveX: 1, rollPressed: true });
      for (let i = 0; i < 10; i++) step({});
      near(sim.p.pos.x, PLAYER.roll.dist, 1e-9, `dt ${dt}: 구르기 거리`);
      assert.equal(sim.p.state, 'idle');
    }
    {
      const { sim, step } = big({ flaskPressed: true });
      sim.p.hp = 10;
      for (let i = 0; i < 20; i++) step({});
      assert.equal(sim.p.hp, 10 + sim.p.stats.flaskHeal);
      assert.equal(sim.p.flasks, sim.p.stats.flaskCharges - 1);
      assert.equal(sim.p.state, 'idle');
    }
    {
      const sim = makeSim({ boss: true, bossPos: { x: 0, z: 3 } });
      sim.boss.state = 'groggy';
      updatePlayer(sim.ctx, makeInput({ lightPressed: true }), dt);
      assert.equal(sim.p.state, 'execute');
      let hits = 0;
      for (let i = 0; i < 20 && sim.p.state === 'execute'; i++) {
        updatePlayer(sim.ctx, NEUTRAL_INPUT, dt);
        if (getPlayerHit(sim.ctx)) hits += 1;
      }
      assert.equal(hits, 1, `dt ${dt}: 처형 타격은 한 번`);
      assert.equal(sim.p.state, 'idle');
      assertFiniteDeep(sim.state, `dt ${dt}`);
    }
  }
  // dt = 0(일시정지에 가까운 호출)에도 NaN이 나오지 않는다
  {
    const sim = makeSim({ boss: true, lockOn: true });
    for (const partial of [{ lightPressed: true }, {}, { moveX: 1, rollPressed: true }, {}, { guard: true, moveZ: 1 }, { flaskPressed: true }, {}]) {
      updatePlayer(sim.ctx, makeInput(partial), 0);
      assertFiniteDeep(sim.state, 'dt 0');
    }
  }
});
