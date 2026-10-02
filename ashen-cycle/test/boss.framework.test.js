// OWNER: P3 — 계약 §12.2 「boss.framework.test.js」
// 합성 BossDef로 프레임워크(§8.1~§8.9)를 검증한다. P1 · P2의 구현에 기대지 않는다 —
// 상대 상태는 test/helpers.js의 리터럴 빌더로 만들고, 판정은 core/hitShapes.js로 직접 본다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EV } from '../src/core/events.js';
import { DT, BOSS_IDS } from '../src/core/constants.js';
import { angleDiff, angleOf, dist } from '../src/core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../src/core/hitShapes.js';
import { circleOverlapsWorld } from '../src/core/collide.js';
import { getWorld } from '../src/data/world.js';
import { BOSS_AI } from '../src/data/bossCommon.js';
import {
  createBossState, updateBoss, getBossHits, getBossTelegraphs, onBossDamaged, onBossParried,
} from '../src/sim/boss/bossSim.js';
import { validateBossDef } from '../src/sim/boss/validateBossDef.js';
import {
  makeTestState, makeTestCtx, makeSynthBossDef, countEvents, assertFiniteDeep,
} from './helpers.js';

// ───────────────────────────────────────────────────────────── 도구

const SEL_ANY = { minRange: 0, maxRange: 40, weight: 1, cooldown: 0 };

/** 기본 판정 하나(정면 부채꼴). */
const hit = (o = {}) => ({
  t0: 0, t1: 0.2, interval: 0, shape: { type: 'arc', r: 4, halfAngle: 1.2 }, damage: 20,
  guardable: true, parryable: true, knockdown: false, telegraph: false, ...o,
});

/** 기본 공격 정의(예고 0.6 · 판정 0.2 · 후딜 0.6 · 추적 없음). */
const atk = (id, o = {}) => ({
  id, pose: 'slashR', glow: 'none', windup: 0.6, active: 0.2, recovery: 0.6,
  sel: { ...SEL_ANY }, hits: [], move: null, track: { turnRate: 0, lockLead: 0 }, events: [], chain: [], ...o,
});

const HAZARD = {
  kind: 'shockwave', style: 'fire', shape: { type: 'circle', r: 2 },
  warn: 0.5, active: 0.2, interval: 0, damage: 10, guardable: true, knockdown: false,
};
const PROJ = {
  kind: 'void_orb', style: 'void', speed: 9, r: 0.45, life: 5, homing: 2, homingTime: 2,
  damage: 18, guardable: true, parryable: true, knockdown: false, y: 1.4,
};

/**
 * 합성 정의 + 상태 + ctx. 플레이어는 원점(facing 0), 보스는 (0, 6)에서 플레이어를 본다(facing π), state 'idle'.
 * @param {Record<string, any>} attacks
 * @param {{def?:any, hooks?:any, scaling?:any, seed?:number, world?:any}} [opts]
 */
function mk(attacks, opts = {}) {
  // (W3) preferredRange 6: 보스가 선 자리(6m)가 선호 거리 안이라 고민을 제자리(idle)에서 한다 —
  // 선호 거리 밖이면 걸으면서 고민한다('chase'). 그 동작은 「걸으며 고민」 테스트가 따로 본다.
  const def = makeSynthBossDef({ attacks, fallbackAttack: Object.keys(attacks)[0], preferredRange: 6, ...(opts.def ?? {}) });
  const state = makeTestState({ bossDef: def, seed: opts.seed, world: opts.world });
  const ctx = makeTestCtx(state, { bossDef: def, bossHooks: opts.hooks ?? {}, scaling: opts.scaling, seed: opts.seed });
  return { def, state, ctx, boss: state.boss, player: state.player };
}

/** GameSim.step의 A(prev 복사) + F(updateBoss)만 흉내 낸다. */
function tick(e, n = 1) {
  for (let i = 0; i < n; i++) {
    const b = e.state.boss;
    b.prevPos.x = b.pos.x;
    b.prevPos.z = b.pos.z;
    b.prevFacing = b.facing;
    b.prevY = b.y;
    e.state.tick += 1;
    updateBoss(e.ctx, DT);
  }
}

/** 조건이 참이 될 때까지 틱(최대 max). 지난 틱 수를 돌려준다. */
function tickUntil(e, cond, max = 2000) {
  for (let i = 1; i <= max; i++) {
    tick(e);
    if (cond()) return i;
  }
  assert.fail(`조건이 ${max}틱 안에 참이 되지 않았다`);
  return max;
}

/** 이 공격만 고르게 한다(이미 있는 훅은 유지). */
function force(e, id) {
  e.ctx.bossHooks = { ...e.ctx.bossHooks, forceAttack: () => id };
}

/** 강제로 공격 id를 시작시킨다 — 돌아올 때 attack.t === 0. */
function start(e, id) {
  force(e, id);
  tick(e);
  assert.equal(e.boss.state, 'attack');
  assert.equal(e.boss.attack.id, id);
  assert.equal(e.boss.attack.t, 0);
  return e.boss.attack;
}

const evs = (e, name) => e.ctx.events.filter((x) => x.name === name).map((x) => x.payload);
const tA = (a) => a.t - a.windup;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const TICK = DT + 1e-9;

/** DamageResult 리터럴(P2가 넘겨줄 모양). */
const result = (o = {}) => ({
  source: 'player', target: 'boss', outcome: 'hit', damage: 0, rawDamage: 0, posture: 0, staminaDamage: 0,
  crit: false, heavy: false, execute: false, knockdown: false, guardBreak: false, postureBroken: false, lethal: false,
  x: 0, z: 0, y: 1, dir: 0, attackId: 'light1', hitId: 1, ...o,
});

function finish(e) {
  assertFiniteDeep(e.state);
  structuredClone(e.state);
}

// ───────────────────────────────────────────────────────────── 생성 · 인트로

describe('createBossState · 인트로', () => {
  test('§3.5 전 필드 · 순환 배율 · intro(무적) → 0.5초 포효 → idle', () => {
    const def = makeSynthBossDef({ preferredRange: 6 });   // 선호 거리 안 — 인트로 뒤 제자리에서 고민한다(밖이면 걸으며 고민 = 'chase')
    const scaling = { hpMul: 1.5, dmgMul: 1.2, rewardMul: 1, speedMul: 1.1, thinkMul: 1, chainBonus: 0 };
    const boss = createBossState(def, scaling, { x: 1, z: 5, facing: Math.PI });
    assert.equal(boss.state, 'intro');
    assert.equal(boss.hp, 1500);
    assert.equal(boss.hpMax, 1500);
    assert.equal(boss.posture, 0);
    assert.equal(boss.phase, 1);
    assert.equal(boss.invulnerable, true);
    assert.equal(boss.dmgMul, 1.2);
    assert.equal(boss.speedMul, 1.1);
    assert.deepEqual(boss.pos, { x: 1, z: 5 });
    assert.deepEqual(boss.prevPos, boss.pos);
    assert.notEqual(boss.prevPos, boss.pos);
    assert.equal(boss.attack, null);
    assert.equal(boss.stateDur, def.introDur);
    for (const k of ['id', 'facing', 'prevFacing', 'y', 'prevY', 'radius', 'postureMax', 'postureIdle', 'pendingPhase',
      'stateTime', 'lastAttacks', 'cooldowns', 'moveIntent', 'strafeDir', 'chaseTime', 'stepDist', 'ext']) {
      assert.ok(k in boss, `BossState.${k}`);
    }
    structuredClone(boss);

    const state = makeTestState({ bossDef: def });
    state.boss = boss;
    let created = 0;
    const ctx = makeTestCtx(state, { bossDef: def, bossHooks: { onCreate: () => { created += 1; } }, scaling });
    const e = { def, state, ctx, boss, player: state.player };
    tick(e, 29);
    assert.equal(countEvents(ctx.events, EV.BOSS_CUE), 0);
    tick(e, 2);
    const cues = evs(e, EV.BOSS_CUE);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].cue, 'roar');
    assert.equal(cues[0].attackId, '');
    assert.equal(cues[0].seq, 0);
    assert.equal(cues[0].bossId, def.id);
    assert.equal(boss.state, 'intro');
    assert.equal(boss.invulnerable, true);
    tick(e, 30); // introDur 1.0
    assert.equal(boss.state, 'idle');
    assert.equal(boss.invulnerable, false);
    assert.equal(created, 1, 'onCreate는 첫 updateBoss에서 한 번');
    assert.equal(countEvents(ctx.events, EV.BOSS_ATTACK_WINDUP), 0, '인트로 중에는 공격하지 않는다');
    finish(e);
  });
});

// ───────────────────────────────────────────────────────────── §8.1 시간축

describe('§8.1 공격의 시간축 tA', () => {
  test('구간 전환 틱 · WINDUP/ACTIVE/END · seq 증가', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    const a = start(e, 'a');
    assert.equal(a.phase, 'windup');
    assert.equal(a.seq, 1);
    assert.ok(near(a.windup, 0.6) && near(a.active, 0.2) && near(a.recovery, 0.6));
    const w = evs(e, EV.BOSS_ATTACK_WINDUP);
    assert.equal(w.length, 1);
    assert.deepEqual(
      { ...w[0] },
      { bossId: 'valder', attackId: 'a', seq: 1, pose: 'slashR', glow: 'none', windup: a.windup, x: 0, z: 6, facing: Math.PI },
    );

    tick(e, 35);
    assert.equal(a.phase, 'windup');
    assert.ok(tA(a) < 0);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_ACTIVE), 0);
    assert.equal(getBossHits(e.ctx).length, 0, '예고 중에는 판정이 없다');

    tick(e); // t = 0.6 → tA = 0
    assert.equal(a.phase, 'active');
    assert.ok(near(tA(a), 0, 1e-9));
    const act = evs(e, EV.BOSS_ATTACK_ACTIVE);
    assert.equal(act.length, 1);
    assert.equal(act[0].seq, 1);
    assert.equal(act[0].attackId, 'a');
    assert.equal(act[0].active, 0.2);
    assert.equal(getBossHits(e.ctx).length, 1);

    tick(e, 11);
    assert.equal(a.phase, 'active');
    assert.equal(getBossHits(e.ctx).length, 1);
    tick(e); // tA = 0.2
    assert.equal(a.phase, 'recovery');
    assert.equal(getBossHits(e.ctx).length, 0, '후딜에는 판정이 없다');
    assert.ok(a.phaseT >= 0 && a.phaseT < 0.05);

    tick(e, 35);
    assert.equal(e.boss.state, 'attack');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_END), 0);
    tick(e);
    assert.equal(e.boss.state, 'idle');
    assert.equal(e.boss.attack, null);
    const end = evs(e, EV.BOSS_ATTACK_END);
    assert.deepEqual(end.map((x) => ({ ...x })), [{ bossId: 'valder', attackId: 'a', seq: 1, interrupted: false }]);

    // 다음 인스턴스는 seq 2 — 연속기에서 같은 attackId가 다시 나와도 seq로 짝짓는다
    tickUntil(e, () => e.boss.state === 'attack');
    assert.equal(e.boss.attack.seq, 2);
    assert.equal(evs(e, EV.BOSS_ATTACK_WINDUP)[1].seq, 2);
    assert.deepEqual(e.boss.lastAttacks, ['a', 'a']);
    finish(e);
  });

  test('배속: windup · recovery ÷ speedMul, active는 그대로, 예고 하한 BOSS_AI.minWindup', () => {
    const e = mk({ a: atk('a', { windup: 0.6, active: 0.2, recovery: 0.6 }) });
    e.boss.speedMul = 1.2;
    const a = start(e, 'a');
    assert.ok(near(a.windup, 0.5));
    assert.ok(near(a.active, 0.2));
    assert.ok(near(a.recovery, 0.5));
    assert.ok(near(evs(e, EV.BOSS_ATTACK_WINDUP)[0].windup, 0.5));
    assert.ok(near(e.boss.stateDur, 1.2));

    const f = mk({ a: atk('a', { windup: 0.6, active: 0.2, recovery: 0.6 }) });
    f.boss.speedMul = 3;
    const b = start(f, 'a');
    assert.equal(b.windup, BOSS_AI.minWindup);
    assert.ok(near(b.recovery, 0.2));
    // 하한이 걸린 예고는 실제로 0.40초(24틱) 뒤에 판정이 시작된다
    const n = tickUntil(f, () => b.phase === 'active');
    assert.equal(n, 24);
    finish(e);
    finish(f);
  });

  test('큰 dt로 판정 구간을 건너뛰어도 ACTIVE · END는 한 번씩 나고 NaN이 없다', () => {
    const e = mk({ a: atk('a', { hits: [hit()], events: [{ t: 0.05, type: 'cue', cue: 'slam' }] }) });
    start(e, 'a');
    e.ctx.bossHooks = {};
    updateBoss(e.ctx, 0.5);
    updateBoss(e.ctx, 0.5);
    updateBoss(e.ctx, 0.5);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_ACTIVE), 1);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_END), 1);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_CUE), 1);
    assert.notEqual(e.boss.state, 'attack');
    finish(e);
  });
});

// ───────────────────────────────────────────────────────────── §8.3 추적 · 고정

describe('§8.3 추적과 방향 고정', () => {
  test('예고 중 turnRate로 추적 → lockLead에 고정 → 이후 facing 불변', () => {
    const e = mk({ a: atk('a', { track: { turnRate: 2, lockLead: 0.2 }, hits: [hit()] }) });
    e.player.pos = { x: 6, z: 6 }; // 보스(0, 6)에서 +X 쪽 = π/2
    const a = start(e, 'a');
    const f0 = e.boss.facing; // 시작 틱의 idle 회전(def.turnRate)이 한 번 들어 있다
    assert.equal(a.locked, false);
    tick(e, 12);
    assert.equal(a.locked, false);
    assert.ok(near(e.boss.facing, f0 - 2 * 12 * DT, 1e-9), '초당 2 rad로 플레이어 쪽(각이 줄어드는 쪽)으로 돈다');
    assert.ok(near(a.aimX, 6) && near(a.aimZ, 6), '고정 전 조준점 = 플레이어 현재 위치');
    tickUntil(e, () => a.locked);
    assert.ok(tA(a) >= -0.2 - 1e-9 && tA(a) < -0.2 + TICK, `고정 시각 tA = ${tA(a)}`);
    const locked = e.boss.facing;
    assert.ok(near(locked, f0 - 2 * 0.4, 2 * DT + 1e-9));

    // 고정 뒤에 플레이어가 반대편으로 가도(= 구르기) 방향 · 조준점은 그대로
    e.player.pos = { x: -6, z: 6 };
    tickUntil(e, () => e.boss.state !== 'attack', 200);
    assert.equal(evs(e, EV.BOSS_ATTACK_ACTIVE)[0].facing, locked);
    assert.equal(e.boss.prevFacing, locked, '판정 · 후딜 내내 회전 없음');
    assert.ok(near(a.aimX, 6) && near(a.aimZ, 6));
    finish(e);
  });

  test('고정 뒤 옆으로 빠지면 좁은 판정은 빗나간다(구르기로 피할 수 있다)', () => {
    const e = mk({
      a: atk('a', {
        track: { turnRate: 4, lockLead: 0.2 },
        hits: [hit({ shape: { type: 'capsule', fwd0: 0, fwd1: 8, r: 0.8 } })],
      }),
    });
    const a = start(e, 'a');
    tickUntil(e, () => a.locked);
    e.player.pos = { x: 3, z: 0 };
    let touched = 0;
    tickUntil(e, () => {
      for (const h of getBossHits(e.ctx)) {
        if (shapeHitsCircle(resolveShape(h.shapeDef, h.x, h.z, h.facing), e.player.pos.x, e.player.pos.z, e.player.radius)) touched += 1;
      }
      return e.boss.state !== 'attack';
    }, 200);
    assert.equal(touched, 0);

    // 가만히 있으면 맞는다
    const f = mk({
      a: atk('a', { track: { turnRate: 4, lockLead: 0.2 }, hits: [hit({ shape: { type: 'capsule', fwd0: 0, fwd1: 8, r: 0.8 } })] }),
    });
    start(f, 'a');
    let hitTicks = 0;
    tickUntil(f, () => {
      for (const h of getBossHits(f.ctx)) {
        if (shapeHitsCircle(resolveShape(h.shapeDef, h.x, h.z, h.facing), 0, 0, 0.4)) hitTicks += 1;
      }
      return f.boss.state !== 'attack';
    }, 200);
    assert.ok(hitTicks > 0);
    finish(e);
    finish(f);
  });

  test('activeTurnRate: 판정 중에만 느리게 추적한다', () => {
    const e = mk({
      a: atk('a', { active: 0.5, track: { turnRate: 0, lockLead: 0.1, activeTurnRate: 1 }, hits: [hit({ t1: 0.5 })] }),
    });
    e.player.pos = { x: 6, z: 6 };
    const a = start(e, 'a');
    const f0 = e.boss.facing;
    tick(e, 35);
    assert.equal(a.phase, 'windup');
    assert.equal(e.boss.facing, f0, '예고 중에는(turnRate 0) 돌지 않는다');
    tickUntil(e, () => a.phase === 'recovery');
    const turned = angleDiff(f0, e.boss.facing);
    assert.ok(near(-turned, 0.5, 2 * DT), `판정 0.5초 × 1 rad/s = 0.5, 플레이어 쪽으로 (실제 ${turned})`);
    const f1 = e.boss.facing;
    tick(e, 10);
    assert.equal(e.boss.facing, f1, '후딜에는 회전 없음');
    finish(e);
  });

  test('sweep: 고정 방향 L 기준 from → to로 회전 · 텔레그래프 facing은 L', () => {
    const tele = { type: 'arc', r: 10, rInner: 1, halfAngle: 0.5 };
    const e = mk({
      a: atk('a', {
        active: 0.5,
        track: { turnRate: 0, lockLead: 0.2, sweep: { from: -0.5, to: 0.5 } },
        hits: [hit({ t1: 0.5, shape: { type: 'capsule', fwd0: 1, fwd1: 10, r: 0.5 }, telegraph: true, telegraphShape: tele })],
      }),
    });
    const a = start(e, 'a');
    const L = Math.PI;
    tickUntil(e, () => a.locked);
    let t = getBossTelegraphs(e.ctx);
    assert.equal(t.length, 1);
    assert.equal(t[0].id, 'atk:1:0');
    assert.deepEqual(t[0].shapeDef, tele);
    tick(e, 6); // 고정 뒤 L + from 쪽으로 돌아가는 중
    assert.ok(Math.abs(angleDiff(L, e.boss.facing)) > 0.1);
    t = getBossTelegraphs(e.ctx);
    assert.ok(near(angleDiff(L, t[0].facing), 0, 1e-9), '표식은 L에 머문다');

    tickUntil(e, () => a.phase === 'active');
    assert.ok(near(angleDiff(L, e.boss.facing), -0.5, 1e-6), `판정 시작 = L + from (${angleDiff(L, e.boss.facing)})`);
    assert.equal(getBossTelegraphs(e.ctx).length, 0, 't0부터는 표식이 없다');
    const hitFacing = getBossHits(e.ctx)[0].facing;
    assert.equal(hitFacing, e.boss.facing, '판정의 기준 방향은 보스의 현재 facing(광선이 따라 돈다)');
    tick(e, 15);
    assert.ok(near(angleDiff(L, e.boss.facing), 0, 1e-6), '판정 한가운데 = L');
    tickUntil(e, () => a.phase === 'recovery');
    assert.ok(near(angleDiff(L, e.boss.facing), 0.5, 1e-6), '판정 끝 = L + to');
    tick(e, 10);
    assert.ok(near(angleDiff(L, e.boss.facing), 0.5, 1e-6));
    finish(e);
  });

  test('텔레그래프: 공격 시작부터 t0까지 · progress 단조 증가 · style', () => {
    const e = mk({
      a: atk('a', {
        glow: 'danger', track: { turnRate: 3, lockLead: 0.2 },
        hits: [hit({ telegraph: true }), hit({ t0: 0.1, t1: 0.2, telegraph: true }), hit({ telegraph: false })],
      }),
      b: atk('b', { hits: [hit({ telegraph: true })] }),
    });
    const a = start(e, 'a');
    let last = -1;
    let seen = 0;
    while (e.boss.state === 'attack' && tA(a) < 0.1 - 1e-9) {
      const t = getBossTelegraphs(e.ctx);
      const first = t.find((x) => x.id === 'atk:1:0');
      const second = t.find((x) => x.id === 'atk:1:1');
      assert.ok(second, '두 번째 창의 표식은 그 창의 t0까지 남는다');
      assert.equal(t.some((x) => x.id === 'atk:1:2'), false);
      if (tA(a) < -1e-9) {
        assert.ok(first);
        assert.ok(first.progress >= last && first.progress >= 0 && first.progress <= 1);
        last = first.progress;
        assert.equal(first.style, 'danger');
        assert.equal(first.x, e.boss.pos.x);
        assert.equal(first.facing, e.boss.facing);
        assert.ok(second.progress < first.progress || first.progress === 0);
        seen += 1;
      } else {
        assert.equal(first, undefined, '판정이 시작되면 사라진다');
      }
      tick(e);
    }
    assert.ok(seen >= 36);
    assert.ok(last > 0.95, `마지막 progress ${last}`);
    assert.equal(getBossTelegraphs(e.ctx).length, 0);

    // glow 'none'이면 보스 대표 색
    const f = mk({ b: atk('b', { hits: [hit({ telegraph: true })] }) });
    start(f, 'b');
    assert.equal(getBossTelegraphs(f.ctx)[0].style, f.def.style);
    finish(e);
    finish(f);
  });
});

// ───────────────────────────────────────────────────────────── §8.4 이동

describe('§8.4 이동 4종', () => {
  /** 공격이 끝날 때까지 돌리고 보스의 변위(시작 facing 기준 앞/옆)와 y 최댓값을 돌려준다. */
  function runMove(e, id) {
    start(e, id);
    const p0 = { ...e.boss.pos };
    const f0 = e.boss.facing;
    let yMax = 0;
    let yAtEnd = 0;
    tickUntil(e, () => {
      yMax = Math.max(yMax, e.boss.y);
      if (e.boss.state === 'attack') yAtEnd = e.boss.y;
      return e.boss.state !== 'attack';
    }, 400);
    const dx = e.boss.pos.x - p0.x;
    const dz = e.boss.pos.z - p0.z;
    return { fwd: dx * Math.sin(f0) + dz * Math.cos(f0), side: -dx * Math.cos(f0) + dz * Math.sin(f0), yMax, yAtEnd };
  }

  test('lunge: 현재 facing으로 dist 전진 · 플레이어 앞 stopShort에서 멈춘다', () => {
    const e = mk({ a: atk('a', { move: { kind: 'lunge', t0: -0.2, t1: 0.1, dist: 2 } }) });
    e.boss.pos = { x: 0, z: 12 };
    const r = runMove(e, 'a');
    assert.ok(near(r.fwd, 2, 1e-6) && near(r.side, 0, 1e-6), `변위 ${r.fwd}`);
    assert.equal(r.yMax, 0);

    // 기본 stopShort = radius + BOSS_AI.stopShortPad
    const f = mk({ a: atk('a', { move: { kind: 'lunge', t0: -0.2, t1: 0.1, dist: 8 } }) });
    f.boss.pos = { x: 0, z: 3 };
    runMove(f, 'a');
    assert.ok(near(dist(0, 0, f.boss.pos.x, f.boss.pos.z), f.def.radius + BOSS_AI.stopShortPad, 1e-6));

    // 명시한 stopShort
    const g = mk({ a: atk('a', { move: { kind: 'lunge', t0: -0.2, t1: 0.1, dist: 8, stopShort: 2.5 } }) });
    runMove(g, 'a');
    assert.ok(near(g.boss.pos.z, 2.5, 1e-6));

    // 이미 stopShort 안이면 물러나지도 다가가지도 않는다
    const h = mk({ a: atk('a', { move: { kind: 'lunge', t0: -0.2, t1: 0.1, dist: 8 } }) });
    h.boss.pos = { x: 0, z: 1.3 };
    runMove(h, 'a');
    assert.ok(near(h.boss.pos.z, 1.3, 1e-9));
    for (const x of [e, f, g, h]) finish(x);
  });

  test('charge: 고정된 facing으로 등속 dist 전진 — 플레이어를 지나친다', () => {
    const e = mk({ a: atk('a', { active: 0.4, track: { turnRate: 3, lockLead: 0.2 }, move: { kind: 'charge', t0: 0, t1: 0.4, dist: 9 } }) });
    const a = start(e, 'a');
    tickUntil(e, () => a.phase === 'active');
    const z0 = e.boss.pos.z;
    tick(e, 12);
    const stepped = z0 - e.boss.pos.z;
    assert.ok(near(stepped, (9 / 0.4) * 12 * DT, 1e-6), `등속(12틱에 ${stepped}m)`);
    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.ok(near(e.boss.pos.z, 6 - 9, 1e-6), '9m 전진해 플레이어(원점)를 지나쳤다');
    assert.ok(near(e.boss.pos.x, 0, 1e-6));
    finish(e);
  });

  test('leap: 조준점 − stopShort에 착지 · y 포물선 · aimLock에 조준점 고정 · dist 상한', () => {
    const mv = { kind: 'leap', t0: -0.5, t1: 0, dist: 10, stopShort: 1.5, height: 2, aimLock: -0.3 };
    const leap = () => atk('a', {
      windup: 1.0, track: { turnRate: 4, lockLead: 0.3 }, move: { ...mv },
      hits: [hit({ shape: { type: 'circle', r: 3, fwd: 1.5 }, telegraph: true, telegraphAt: 'aim', telegraphShape: { type: 'circle', r: 3 } })],
    });
    const e = mk({ a: leap() });
    e.boss.pos = { x: 0, z: 8 };
    const a = start(e, 'a');
    // 고정 전: 조준점 · 표식이 플레이어를 따라다닌다
    tick(e, 10);
    e.player.pos = { x: 1, z: 0 };
    tick(e);
    assert.ok(near(a.aimX, 1) && near(a.aimZ, 0));
    let t = getBossTelegraphs(e.ctx)[0];
    assert.ok(near(t.x, 1) && near(t.z, 0), "telegraphAt 'aim'");
    tickUntil(e, () => tA(a) >= -0.3 - 1e-9);
    // 고정 뒤: 플레이어가 멀리 굴러도 조준점 · 표식은 멈춘다
    e.player.pos = { x: 5, z: -3 };
    let yMax = 0;
    const ys = [];
    tickUntil(e, () => {
      yMax = Math.max(yMax, e.boss.y);
      ys.push(e.boss.y);
      if (a.phase === 'windup') {
        t = getBossTelegraphs(e.ctx)[0];
        assert.ok(near(t.x, 1) && near(t.z, 0), '고정 뒤 표식은 멈춘다');
      }
      return a.phase === 'active';
    });
    assert.ok(near(a.aimX, 1) && near(a.aimZ, 0));
    assert.ok(near(dist(1, 0, e.boss.pos.x, e.boss.pos.z), 1.5, 1e-6), `착지 = 조준점에서 stopShort (${dist(1, 0, e.boss.pos.x, e.boss.pos.z)})`);
    assert.equal(e.boss.y, 0, '판정 시작에는 땅에 있다');
    assert.ok(yMax > 1.9 && yMax <= 2 + 1e-9, `정점 ${yMax}`);
    // 착지 원(fwd = stopShort)의 중심이 조준점이다 — 표식과 판정이 같은 자리
    const h = getBossHits(e.ctx)[0];
    const s = resolveShape(h.shapeDef, h.x, h.z, h.facing);
    assert.ok(near(s.x, 1, 0.15) && near(s.z, 0, 0.15), `판정 중심 (${s.x}, ${s.z})`);

    // y는 올라갔다 내려온다(포물선 한 번)
    const f = mk({ a: leap() });
    f.boss.pos = { x: 0, z: 8 };
    const b = start(f, 'a');
    const trace = [];
    tickUntil(f, () => { trace.push(f.boss.y); return b.phase === 'active'; });
    const peak = trace.indexOf(Math.max(...trace));
    for (let i = 1; i <= peak; i++) assert.ok(trace[i] >= trace[i - 1]);
    for (let i = peak + 1; i < trace.length; i++) assert.ok(trace[i] <= trace[i - 1]);

    // 도약 거리 상한: 플레이어가 dist보다 멀면 조준점을 dist 안으로 당긴다
    const g = mk({ a: leap() });
    g.boss.pos = { x: 0, z: 18 };
    const c = start(g, 'a');
    tickUntil(g, () => c.phase === 'active');
    assert.ok(near(c.aimZ, 8, 1e-6), `조준점 z = 18 − 10 (${c.aimZ})`);
    assert.ok(near(g.boss.pos.z, 9.5, 1e-6), `착지 z = 8 + 1.5 (${g.boss.pos.z})`);

    // 도약 도중에 끊기면 공중에 남지 않는다
    const k = mk({ a: leap() });
    k.boss.pos = { x: 0, z: 8 };
    const d = start(k, 'a');
    tickUntil(k, () => k.boss.y > 1);
    assert.equal(d.phase, 'windup');
    k.boss.posture = k.boss.postureMax;
    tick(k);
    assert.equal(k.boss.state, 'groggy');
    assert.equal(k.boss.y, 0);
    for (const x of [e, f, g, k]) finish(x);
  });

  test('(W5) leap: 착지점까지의 길이 기둥 · 경계에 막히면 그 앞에 내린다 — 조준점(표식 · 판정 원)도 함께 당겨진다', () => {
    const mv = { kind: 'leap', t0: -0.5, t1: 0, dist: 12, stopShort: 1.5, height: 2, aimLock: -0.3 };
    const leap = () => atk('a', {
      windup: 1.0, track: { turnRate: 4, lockLead: 0.3 }, move: { ...mv },
      hits: [hit({ shape: { type: 'circle', r: 3, fwd: 1.5 }, telegraph: true, telegraphAt: 'aim', telegraphShape: { type: 'circle', r: 3 } })],
    });
    // 기둥 (0, 4, r 1): 보스(반경 0.8)의 중심은 기둥 중심에서 1.8m까지만 다가간다
    const world = { ...getWorld('arena_valder'), colliders: [{ type: 'circle', x: 0, z: 4, r: 1 }] };
    const e = mk({ a: leap() }, { world });
    e.boss.pos = { x: 0, z: 10 };
    const a = start(e, 'a');
    let maxStep = 0;
    let stall = 0;
    let last = e.boss.pos.z;
    tickUntil(e, () => {
      const step = Math.abs(e.boss.pos.z - last);
      last = e.boss.pos.z;
      if (tA(a) > -0.5 + TICK && tA(a) <= 1e-9) {
        maxStep = Math.max(maxStep, step);
        if (step < 1e-6) stall += 1;
      }
      if (a.phase === 'windup' && tA(a) > -0.5) {
        const t = getBossTelegraphs(e.ctx)[0];
        assert.ok(near(t.x, 0) && near(t.z, 4.3, 1e-6), `표식은 기둥 앞 착지 원의 자리 (${t.z})`);
      }
      return a.phase === 'active';
    });
    assert.ok(near(e.boss.pos.z, 5.8, 1e-6) && near(e.boss.pos.x, 0), `기둥 앞에 내린다 (${e.boss.pos.z})`);
    assert.ok(near(a.aimZ, 4.3, 1e-6), `조준점 = 착지점 + stopShort (${a.aimZ})`);
    assert.equal(circleOverlapsWorld(e.boss.pos.x, e.boss.pos.z, e.boss.radius, world), false);
    assert.equal(stall, 0, '공중에서 멈추지 않는다');
    assert.ok(maxStep < 0.2, `틱당 이동 ${maxStep} — 4.2m를 30틱에 고르게`);
    const h = getBossHits(e.ctx)[0];
    const s = resolveShape(h.shapeDef, h.x, h.z, h.facing);
    assert.ok(near(s.x, 0, 1e-6) && near(s.z, 4.3, 1e-6), `판정 원 = 표식 (${s.z})`);

    // 기둥을 스쳐 지나가는 길(옆으로 2m — 1.8m보다 멀다)은 막히지 않는다
    const f = mk({ a: leap() }, { world });
    f.boss.pos = { x: 2, z: 10 };
    f.player.pos = { x: 2, z: 0 };
    const b = start(f, 'a');
    tickUntil(f, () => b.phase === 'active');
    assert.ok(near(f.boss.pos.z, 1.5, 1e-6) && near(b.aimZ, 0, 1e-6));

    // 경계: 벽에 붙은 플레이어에게 벽을 따라 도약하면 착지점이 경계 밖일 수 있다 — 경계 안에 내린다
    const g = mk({ a: leap() });
    const lim = g.state.world.radius - g.boss.radius;
    g.boss.pos = { x: -8, z: Math.sqrt(lim * lim - 64) };
    g.player.pos = { x: 6, z: Math.sqrt(19.6 * 19.6 - 36) };
    const c = start(g, 'a');
    tickUntil(g, () => c.phase === 'active');
    assert.ok(Math.hypot(g.boss.pos.x, g.boss.pos.z) <= lim + 1e-6, `경계 안 (${Math.hypot(g.boss.pos.x, g.boss.pos.z)} ≤ ${lim})`);
    for (const x of [e, f, g]) finish(x);
  });

  test('hop: facing 반대로 dist · y 포물선', () => {
    const e = mk({ a: atk('a', { active: 0.3, move: { kind: 'hop', t0: 0, t1: 0.3, dist: 4, height: 1.2 } }) });
    const r = runMove(e, 'a');
    assert.ok(near(r.fwd, -4, 1e-6), `뒤로 4m (${r.fwd})`);
    assert.ok(near(r.side, 0, 1e-6));
    assert.ok(r.yMax > 1.1 && r.yMax <= 1.2 + 1e-9);
    assert.equal(e.boss.y, 0);
    finish(e);
  });
});

// ───────────────────────────────────────────────────────────── §8.5 타임라인 이벤트

describe('§8.5 타임라인 이벤트', () => {
  test('5종이 정확히 한 번씩 · tA ≥ ev.t의 첫 틱 · payload', () => {
    const hooked = [];
    const e = mk({
      a: atk('a', {
        events: [
          { t: -0.2, type: 'cue', cue: 'slam', shake: [0.3, 0.4], params: { length: 9, halfAngle: 0.5 } },
          { t: 0, type: 'projectile', proj: PROJ, origin: { fwd: 1, side: 0 } },
          { t: 0.05, type: 'hazard', hazard: HAZARD, place: { mode: 'self' } },
          { t: 0.1, type: 'teleport', to: 'center' },
          { t: 0.15, type: 'hook', name: 'custom' },
        ],
      }),
    }, { hooks: { onTimelineEvent: (ctx, ev) => hooked.push(ev.name) } });
    e.player.pos = { x: 3, z: -4 };
    e.boss.facing = angleOf(3, -10);
    e.boss.prevFacing = e.boss.facing;
    e.boss.dmgMul = 1.5;
    const a = start(e, 'a');

    tickUntil(e, () => countEvents(e.ctx.events, EV.BOSS_CUE) > 0);
    assert.ok(tA(a) >= -0.2 - 1e-9 && tA(a) < -0.2 + TICK, `cue 시각 tA = ${tA(a)}`);
    const cue = evs(e, EV.BOSS_CUE)[0];
    assert.deepEqual({ ...cue }, {
      bossId: 'valder', attackId: 'a', seq: 1, cue: 'slam', style: 'fire',
      x: 0, z: 6, facing: e.boss.facing, length: 9, halfAngle: 0.5,
    });
    assert.deepEqual(evs(e, EV.CAMERA_SHAKE).map((x) => ({ ...x })), [{ amp: 0.3, dur: 0.4 }]);

    tickUntil(e, () => e.ctx.spawned.projectiles.length > 0);
    assert.ok(near(tA(a), 0, 1e-9));
    const p = e.ctx.spawned.projectiles[0];
    assert.ok(near(dist(0, 6, p.x, p.z), 1, 1e-9), 'origin fwd 1');
    assert.ok(near(angleDiff(p.dir, angleOf(3 - p.x, -4 - p.z)), 0, 1e-9), '플레이어 방향');
    assert.ok(near(p.damage, PROJ.damage * 1.5), 'damageMul = boss.dmgMul');

    tickUntil(e, () => e.ctx.spawned.hazards.length > 0);
    assert.ok(tA(a) >= 0.05 - 1e-9 && tA(a) < 0.05 + TICK);
    const hz = e.ctx.spawned.hazards[0];
    assert.ok(near(hz.x, 0) && near(hz.z, 6));
    assert.ok(near(hz.damage, HAZARD.damage * 1.5));

    tickUntil(e, () => countEvents(e.ctx.events, EV.BOSS_TELEPORT) > 0);
    assert.deepEqual({ ...evs(e, EV.BOSS_TELEPORT)[0] }, { fromX: 0, fromZ: 6, toX: 0, toZ: 0 });
    assert.deepEqual(e.boss.pos, { x: 0, z: 0 });
    assert.deepEqual(e.boss.prevPos, { x: 0, z: 0 }, 'prevPos도 같이 덮어쓴다(보간이 화면을 가로지르지 않게)');
    assert.ok(near(angleDiff(e.boss.facing, angleOf(3, -4)), 0, 1e-9), '이동 뒤 facing은 플레이어 쪽');

    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.deepEqual(hooked, ['custom']);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_CUE), 1);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_TELEPORT), 1);
    assert.equal(e.ctx.spawned.projectiles.length, 1);
    assert.equal(e.ctx.spawned.hazards.length, 1);
    assert.deepEqual([...a.fired].sort(), [0, 1, 2, 3, 4]);
    finish(e);
  });

  test('phase 조건: 그 페이즈에서만 실행', () => {
    const def = () => ({
      a: atk('a', {
        events: [
          { t: 0, type: 'hazard', phase: 2, hazard: HAZARD, place: { mode: 'self' } },
          { t: 0, type: 'cue', phase: 1, cue: 'stomp' },
          { t: 0, type: 'cue', cue: 'land' },
        ],
      }),
    });
    const e = mk(def());
    const a = start(e, 'a');
    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.equal(e.ctx.spawned.hazards.length, 0);
    assert.deepEqual(evs(e, EV.BOSS_CUE).map((x) => x.cue), ['stomp', 'land']);
    assert.deepEqual([...a.fired].sort(), [1, 2], '건너뛴 이벤트는 fired에 없다');

    const f = mk(def());
    f.boss.phase = 2;
    start(f, 'a');
    tickUntil(f, () => f.boss.state !== 'attack', 300);
    assert.equal(f.ctx.spawned.hazards.length, 1);
    assert.deepEqual(evs(f, EV.BOSS_CUE).map((x) => x.cue), ['land']);
    finish(e);
    finish(f);
  });

  test('count/interval: 투사체 부채 · 장판 place 6종', () => {
    // 투사체 3발 · 0.1초 간격 · 부채 0.6
    const e = mk({ a: atk('a', { active: 0.5, events: [{ t: 0, type: 'projectile', proj: PROJ, count: 3, interval: 0.1, spread: 0.6 }] }) });
    const a = start(e, 'a');
    const at = [];
    tickUntil(e, () => {
      while (at.length < e.ctx.spawned.projectiles.length) at.push(tA(a));
      return e.boss.state !== 'attack';
    }, 300);
    assert.equal(at.length, 3);
    for (let k = 0; k < 3; k++) assert.ok(at[k] >= k * 0.1 - 1e-9 && at[k] < k * 0.1 + TICK, `발사 ${k} tA = ${at[k]}`);
    const dirs = e.ctx.spawned.projectiles.map((p) => angleDiff(Math.PI, p.dir));
    assert.ok(near(dirs[0], -0.3, 1e-9) && near(dirs[1], 0, 1e-9) && near(dirs[2], 0.3, 1e-9), `부채 ${dirs}`);

    // 간격 없이 count만: 한 틱에 전부
    const f = mk({ a: atk('a', { events: [{ t: 0, type: 'projectile', proj: PROJ, count: 5, spread: 0.8 }] }) });
    const b = start(f, 'a');
    tickUntil(f, () => b.phase === 'active');
    assert.equal(f.ctx.spawned.projectiles.length, 5);

    // ringAround: 보스 중심 radius 원 위에 균등
    const g = mk({ a: atk('a', { events: [{ t: 0, type: 'hazard', hazard: HAZARD, count: 6, place: { mode: 'ringAround', radius: 4.5 } }] }) });
    const c = start(g, 'a');
    tickUntil(g, () => c.phase === 'active');
    assert.equal(g.ctx.spawned.hazards.length, 6);
    const angs = g.ctx.spawned.hazards.map((h) => {
      assert.ok(near(dist(0, 6, h.x, h.z), 4.5, 1e-9));
      return angleOf(h.x, h.z - 6);
    });
    for (let i = 1; i < 6; i++) assert.ok(near(Math.abs(angleDiff(angs[i - 1], angs[i])), Math.PI / 3, 1e-9));

    // scatter: 첫 개는 플레이어 위치, 나머지는 radius 안 · 아레나 안
    const h = mk({ a: atk('a', { events: [{ t: 0, type: 'hazard', hazard: HAZARD, count: 8, place: { mode: 'scatter', radius: 5 } }] }) });
    h.player.pos = { x: 2, z: -17 };
    const d = start(h, 'a');
    tickUntil(h, () => d.phase === 'active');
    const sc = h.ctx.spawned.hazards;
    assert.equal(sc.length, 8);
    assert.ok(near(sc[0].x, 2) && near(sc[0].z, -17));
    for (const z of sc) {
      assert.ok(dist(2, -17, z.x, z.z) <= 5 + 1e-9);
      assert.ok(Math.hypot(z.x, z.z) <= h.state.world.radius + 1e-9, '아레나 밖에 깔리지 않는다');
    }
    assert.ok(new Set(sc.map((z) => `${z.x},${z.z}`)).size >= 7, '흩어져 있다');

    // chase: interval마다 그 순간의 플레이어 위치 + 속도 × lead
    const k = mk({ a: atk('a', { active: 0.6, events: [{ t: 0, type: 'hazard', hazard: HAZARD, count: 3, interval: 0.2, place: { mode: 'chase', lead: 0.5 } }] }) });
    k.player.vel = { x: 2, z: 0 };
    const m = start(k, 'a');
    const where = [];
    tickUntil(k, () => {
      k.player.pos.x += 2 * DT;
      return k.boss.state !== 'attack';
    }, 300);
    for (const z of k.ctx.spawned.hazards) where.push(z.x);
    assert.equal(where.length, 3);
    assert.ok(where[1] - where[0] > 0.35 && where[2] - where[1] > 0.35, `플레이어를 따라간다 ${where}`);
    assert.ok(where[0] > 1.0, 'lead 0.5초 × 2 m/s 앞을 겨눈다');
    assert.ok(m.fired.includes(0));

    // target · aim
    const n = mk({
      a: atk('a', {
        track: { turnRate: 0, lockLead: 0.3 },
        events: [
          { t: 0, type: 'hazard', hazard: HAZARD, place: { mode: 'target' } },
          { t: 0, type: 'hazard', hazard: HAZARD, place: { mode: 'aim' } },
        ],
      }),
    });
    const q = start(n, 'a');
    tickUntil(n, () => q.locked);
    n.player.pos = { x: 4, z: 1 };
    tickUntil(n, () => q.phase === 'active');
    const [tg, am] = n.ctx.spawned.hazards;
    assert.ok(near(tg.x, 4) && near(tg.z, 1), 'target = 플레이어 현재 위치');
    assert.ok(near(am.x, 0) && near(am.z, 0), 'aim = 고정된 조준점');
    for (const x of [e, f, g, h, k, n]) finish(x);
  });

  test('공격이 중단되면 남은 이벤트는 버려진다 · BOSS_ATTACK_END{interrupted:true}', () => {
    const e = mk({
      a: atk('a', {
        hits: [hit()],
        events: [{ t: -0.3, type: 'cue', cue: 'whoosh' }, { t: 0.05, type: 'hazard', hazard: HAZARD }, { t: 0.1, type: 'cue', cue: 'slam' }],
      }),
    });
    const a = start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => a.phase === 'active');
    onBossParried(e.ctx, result({ source: 'boss', target: 'player', outcome: 'parry' }));
    assert.equal(e.boss.state, 'parried');
    assert.equal(e.boss.attack, null);
    assert.deepEqual({ ...evs(e, EV.BOSS_ATTACK_END)[0] }, { bossId: 'valder', attackId: 'a', seq: 1, interrupted: true });
    assert.equal(getBossHits(e.ctx).length, 0);
    e.player.state = 'dead'; // 다음 공격이 섞이지 않게
    tick(e, 120);
    assert.equal(e.ctx.spawned.hazards.length, 0);
    assert.deepEqual(evs(e, EV.BOSS_CUE).map((x) => x.cue), ['whoosh']);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_END), 1);
    finish(e);
  });

  test('순간이동 4종: 아레나 안 · 콜라이더 밖 · prevPos', () => {
    const world = getWorld('arena_nihil'); // 석주 4개(반경 11m 원 위)
    const lim = world.radius - 0.8 - BOSS_AI.teleportMargin;
    const run = (to, dist2, setup) => {
      const e = mk({ a: atk('a', { events: [{ t: 0, type: 'teleport', to, dist: dist2 }] }) }, { world, seed: 5 });
      setup(e);
      const a = start(e, 'a');
      tickUntil(e, () => a.phase === 'active');
      assert.equal(countEvents(e.ctx.events, EV.BOSS_TELEPORT), 1);
      assert.deepEqual(e.boss.prevPos, e.boss.pos);
      assert.ok(Math.hypot(e.boss.pos.x, e.boss.pos.z) <= lim + 1e-6, `${to}: 경계 여유 안`);
      assert.equal(circleOverlapsWorld(e.boss.pos.x, e.boss.pos.z, e.boss.radius, world), false, `${to}: 콜라이더와 겹치지 않는다`);
      const p = e.player.pos;
      assert.ok(near(angleDiff(e.boss.facing, angleOf(p.x - e.boss.pos.x, p.z - e.boss.pos.z)), 0, 1e-9));
      finish(e);
      return e;
    };

    // away: 플레이어 → 원점 방향으로 dist
    let e = run('away', 11, (x) => { x.player.pos = { x: 0, z: -15 }; x.boss.pos = { x: 0, z: -12 }; });
    assert.ok(near(e.boss.pos.x, 0, 1e-9) && near(e.boss.pos.z, -4, 1e-9));
    // away: 플레이어가 원점이면 보스가 서 있던 쪽으로
    e = run('away', 11, (x) => { x.player.pos = { x: 0, z: 0 }; x.boss.pos = { x: 0, z: 3 }; });
    assert.ok(near(dist(0, 0, e.boss.pos.x, e.boss.pos.z), 11, 1e-6) && e.boss.pos.z > 0);
    // away: 경계를 넘으면 안으로
    e = run('away', 60, (x) => { x.player.pos = { x: 3, z: -15 }; });
    assert.ok(near(Math.hypot(e.boss.pos.x, e.boss.pos.z), lim, 1e-6));

    // behindTarget: 플레이어 등 뒤 dist
    e = run('behindTarget', 2.5, (x) => { x.player.pos = { x: 2, z: 0 }; x.player.facing = Math.PI / 2; });
    assert.ok(near(e.boss.pos.x, -0.5, 1e-9) && near(e.boss.pos.z, 0, 1e-9));
    // behindTarget이 석주 안이면 밖으로 고친다
    const pil = world.colliders[0];
    e = run('behindTarget', 2.5, (x) => { x.player.pos = { x: pil.x, z: pil.z + 2.5 }; x.player.facing = 0; });
    assert.ok(dist(pil.x, pil.z, e.boss.pos.x, e.boss.pos.z) >= pil.r + 0.8 - 1e-6);

    // flank: 플레이어 옆(좌우) dist
    e = run('flank', 4, (x) => { x.player.pos = { x: 0, z: -2 }; x.player.facing = 0; });
    assert.ok(near(Math.abs(e.boss.pos.x), 4, 1e-9) && near(e.boss.pos.z, -2, 1e-9));

    // center
    e = run('center', 0, (x) => { x.player.pos = { x: 0, z: -8 }; });
    assert.deepEqual(e.boss.pos, { x: 0, z: 0 });
  });
});

// ───────────────────────────────────────────────────────────── §8.2 다단 히트

describe('§8.2 다단 히트 · 지속 판정', () => {
  test('창마다 새 hitId · OutgoingHit 채움 규칙 · 원점은 보스의 현재 위치', () => {
    const e = mk({
      a: atk('a', {
        active: 0.4,
        move: { kind: 'charge', t0: 0, t1: 0.4, dist: 4 },
        hits: [
          hit({ t0: 0, t1: 0.1, damage: 10, knockdown: true, parryable: false }),
          hit({ t0: 0.2, t1: 0.3, damage: 30, guardable: false }),
        ],
      }),
    });
    e.boss.dmgMul = 1.5;
    const a = start(e, 'a');
    const seen = [];
    tickUntil(e, () => {
      const hs = getBossHits(e.ctx);
      assert.ok(hs.length <= 1);
      if (hs.length) {
        seen.push({ tA: tA(a), ...hs[0] });
        assert.equal(hs[0].x, e.boss.pos.x);
        assert.equal(hs[0].z, e.boss.pos.z, '움직이는 판정은 보스를 따라간다');
        assert.equal(hs[0].facing, e.boss.facing);
      }
      return e.boss.state !== 'attack';
    }, 300);
    const first = seen.filter((h) => h.tA < 0.15);
    const second = seen.filter((h) => h.tA >= 0.15);
    assert.equal(first.length, 6, '0 ≤ tA < 0.1 → 6틱');
    assert.equal(second.length, 6);
    assert.equal(new Set(first.map((h) => h.hitId)).size, 1, '한 창 동안 hitId는 같다');
    assert.equal(new Set(second.map((h) => h.hitId)).size, 1);
    assert.notEqual(first[0].hitId, second[0].hitId, '창이 둘이면 두 번 맞을 수 있다');
    assert.ok(first[0].hitId > 0 && second[0].hitId > 0);
    assert.deepEqual(a.hitIds, [first[0].hitId, second[0].hitId]);

    const { tA: _t, x: _x, z: _z, facing: _f, hitId: _h, ...rest } = first[0];
    assert.deepEqual(rest, {
      source: 'boss', attackId: 'a', shapeDef: e.def.attacks.a.hits[0].shape, damage: 15, posture: 0,
      guardable: true, parryable: false, knockdown: true, heavy: true, execute: false, hitstop: 0,
    });
    assert.equal(second[0].damage, 45);
    assert.equal(second[0].guardable, false);
    assert.equal(second[0].heavy, false);
    assert.ok(second[0].z < first[0].z - 1, '돌진한 만큼 원점이 옮겨졌다');
    finish(e);
  });

  test('interval: t0부터 간격마다 hitId 갱신(브레스)', () => {
    const e = mk({ a: atk('a', { active: 1.4, hits: [hit({ t0: 0, t1: 1.4, interval: 0.35 })] }) });
    const a = start(e, 'a');
    /** @type {Map<number, number[]>} */
    const byId = new Map();
    tickUntil(e, () => {
      for (const h of getBossHits(e.ctx)) {
        if (!byId.has(h.hitId)) byId.set(h.hitId, []);
        byId.get(h.hitId).push(tA(a));
      }
      return e.boss.state !== 'attack';
    }, 400);
    assert.equal(byId.size, 4, '1.4초 ÷ 0.35초 = 4번');
    let k = 0;
    for (const ts of byId.values()) {
      assert.equal(ts.length, 21, '0.35초 = 21틱');
      assert.ok(ts[0] >= k * 0.35 - 1e-9 && ts[0] < k * 0.35 + TICK);
      k += 1;
    }
    finish(e);
  });

  test('§3.5 필드만으로 손수 만든 attack도 판정 · 텔레그래프 · 진행이 된다', () => {
    const e = mk({ a: atk('a', { hits: [hit({ telegraph: true })] }) });
    e.boss.state = 'attack';
    e.boss.attack = {
      id: 'a', seq: 7, pose: 'slashR', glow: 'none', phase: 'active', phaseT: 0, t: 0.62,
      windup: 0.6, active: 0.2, recovery: 0.6, locked: true, aimX: 0, aimZ: 0, chained: false, fired: [], hitIds: [],
    };
    const hs = getBossHits(e.ctx);
    assert.equal(hs.length, 1);
    assert.ok(hs[0].hitId > 0);
    assert.equal(getBossHits(e.ctx)[0].hitId, hs[0].hitId);
    e.boss.attack.t = 0.3;
    e.boss.attack.phase = 'windup';
    assert.equal(getBossTelegraphs(e.ctx)[0].id, 'atk:7:0');
    tickUntil(e, () => e.boss.state !== 'attack', 200);
    assert.equal(evs(e, EV.BOSS_ATTACK_END)[0].seq, 7);
    force(e, 'a');
    tickUntil(e, () => e.boss.state === 'attack');
    assert.equal(e.boss.attack.seq, 8, 'seq는 계속 커진다');
    finish(e);
  });
});

// ───────────────────────────────────────────────────────────── §8.6 AI

describe('§8.6 AI 선택', () => {
  const aiDef = () => ({
    near: atk('near', { sel: { minRange: 0, maxRange: 3, maxAngle: 1.0, weight: 1, cooldown: 3 } }),
    far: atk('far', { sel: { minRange: 5, maxRange: 10, weight: 1, cooldown: 0 } }),
    back: atk('back', { sel: { minRange: 0, maxRange: 3, minAngle: 2.0, weight: 1, cooldown: 0 } }),
    p1only: atk('p1only', { sel: { minRange: 11, maxRange: 20, weight: 1, cooldown: 0, maxPhase: 1 } }),
    p2only: atk('p2only', { sel: { minRange: 11, maxRange: 20, weight: 1, cooldown: 0, minPhase: 2 } }),
    combo: atk('combo', { sel: null }),
  });
  /** 보스를 원점에 두고 플레이어를 (거리, 보스 정면 기준 각)에 놓는다. */
  const place = (e, d, a) => {
    e.boss.pos = { x: 0, z: 0 };
    e.boss.prevPos = { x: 0, z: 0 };
    e.boss.facing = 0;
    e.player.pos = { x: Math.sin(a) * d, z: Math.cos(a) * d };
  };
  const firstPick = (d, a, phase = 1, seed = 1) => {
    const e = mk(aiDef(), { seed });
    place(e, d, a);
    e.boss.phase = phase;
    tick(e);
    finish(e);
    return e.boss.attack ? e.boss.attack.id : e.boss.state;
  };

  test('거리 · 각 · 페이즈 필터', () => {
    assert.equal(firstPick(2, 0), 'near');
    assert.equal(firstPick(2, 0.9), 'near');
    assert.equal(firstPick(2, -0.9), 'near', '각은 절댓값으로 본다');
    assert.equal(firstPick(2, 1.5), 'chase', '각 1.0~2.0은 아무 후보도 없다');
    assert.equal(firstPick(2, 2.5), 'back');
    assert.equal(firstPick(2, Math.PI), 'back');
    assert.equal(firstPick(7, 0), 'far');
    assert.equal(firstPick(7, 3), 'far', '각 조건이 없으면 전 방위');
    assert.equal(firstPick(4, 0), 'chase', '3~5m는 공백');
    assert.equal(firstPick(12, 0, 1), 'p1only');
    assert.equal(firstPick(12, 0, 2), 'p2only');
    assert.equal(firstPick(25, 0), 'chase');
    for (let seed = 1; seed <= 50; seed++) assert.notEqual(firstPick(2, 0, 1, seed), 'combo', 'sel null은 AI가 고르지 않는다');
  });

  test('쿨다운: 남아 있으면 후보에서 빠지고 매 틱 줄어든다', () => {
    const e = mk(aiDef());
    place(e, 2, 0);
    tick(e);
    assert.equal(e.boss.attack.id, 'near');
    assert.equal(e.boss.cooldowns.near, 3);
    assert.equal(e.boss.chaseTime, 0);
    let ticks = 1;
    ticks += tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.ok(near(e.boss.cooldowns.near, 3 - (ticks - 1) * DT, 1e-6));
    // 공격 1.4초 + 고민 0.5초 = 1.9초 — 아직 쿨다운 → chase(스트레이프) → 3.0초에 다시 near
    ticks += tickUntil(e, () => e.boss.state === 'chase', 100);
    place(e, 2, 0);
    ticks += tickUntil(e, () => {
      place(e, 2, 0);
      return e.boss.state === 'attack';
    }, 300);
    assert.equal(e.boss.attack.id, 'near');
    const t = (ticks - 1) * DT;
    assert.ok(t >= 3 - 1e-6 && t <= 3 + BOSS_AI.reselect + DT, `재사용 시각 ${t}`);
    assert.equal(e.boss.cooldowns.far, undefined);
    finish(e);
  });

  test('직전 · 전전 공격 감쇠(시드 200개 통계)', () => {
    const two = () => ({ a: atk('a'), b: atk('b') });
    const count = (lastAttacks) => {
      let n = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const e = mk(two(), { seed });
        e.boss.lastAttacks = [...lastAttacks];
        tick(e);
        if (e.boss.attack.id === 'a') n += 1;
      }
      return n;
    };
    const base = count([]);
    assert.ok(base > 75 && base < 125, `감쇠 없음 ≈ 100 (실제 ${base})`);
    const afterA = count(['a']); // a 0.3 : b 1 → 23%
    assert.ok(afterA > 25 && afterA < 70, `직전이 a ≈ 46 (실제 ${afterA})`);
    const afterBA = count(['b', 'a']); // a 0.6 : b 0.3 → 67%
    assert.ok(afterBA > 110 && afterBA < 155, `직전 b · 전전 a ≈ 133 (실제 ${afterBA})`);
    const afterAA = count(['a', 'a']); // a 0.18 : b 1 → 15%
    assert.ok(afterAA > 12 && afterAA < 50, `a를 두 번 ≈ 30 (실제 ${afterAA})`);
    assert.ok(afterAA < afterA);
  });

  test('후보 없음 → chase(approach / strafe / retreat) → 3초 뒤 fallback', () => {
    // approach: preferredRange + 1보다 멀면 moveSpeed로 다가간다
    const e = mk({ near: atk('near', { sel: { minRange: 0, maxRange: 2, weight: 1, cooldown: 0 } }) });
    e.boss.pos = { x: 0, z: 15 };
    tick(e);
    assert.equal(e.boss.state, 'chase');
    tick(e, 60);
    assert.equal(e.boss.moveIntent, 'approach');
    assert.ok(near(e.boss.pos.z, 15 - e.def.moveSpeed * 60 * DT, 1e-6), `1초에 moveSpeed만큼 (${e.boss.pos.z})`);
    assert.ok(countEvents(e.ctx.events, EV.BOSS_STEP) === 1, 'stride 1.6m마다 발소리(3m → 1번)');
    assert.equal(evs(e, EV.BOSS_STEP)[0].heavy, true);
    finish(e);

    // strafe: 거리 그대로 원운동 · 플레이어를 계속 본다 · 3초 뒤 fallback(거리 · 쿨다운 무시)
    const f = mk({
      near: atk('near', { sel: { minRange: 0, maxRange: 2, weight: 1, cooldown: 0 } }),
      fb: atk('fb', { sel: { minRange: 30, maxRange: 40, weight: 1, cooldown: 0 } }),
    }, { def: { fallbackAttack: 'fb' } });
    f.boss.pos = { x: 0, z: 3.5 };
    f.boss.cooldowns.fb = 99;
    tick(f);
    assert.equal(f.boss.state, 'chase');
    const p0 = { ...f.boss.pos };
    const n = tickUntil(f, () => {
      if (f.boss.state === 'chase') {
        assert.equal(f.boss.moveIntent, 'strafe');
        assert.ok(near(dist(0, 0, f.boss.pos.x, f.boss.pos.z), 3.5, 1e-6), '스트레이프는 거리를 유지한다');
        const want = angleOf(-f.boss.pos.x, -f.boss.pos.z);
        assert.ok(Math.abs(angleDiff(f.boss.facing, want)) < 0.2, '플레이어를 본다');
      }
      return f.boss.state === 'attack';
    }, 400);
    assert.equal(f.boss.attack.id, 'fb');
    assert.ok(n * DT >= BOSS_AI.fallbackAfter - 1e-6 && n * DT <= BOSS_AI.fallbackAfter + BOSS_AI.reselect + DT, `fallback 시각 ${n * DT}`);
    assert.ok(dist(p0.x, p0.z, f.boss.pos.x, f.boss.pos.z) > 1, '실제로 옆으로 움직였다');
    assert.equal(f.boss.chaseTime, 0, '공격을 시작하면 chaseTime은 0');
    assert.equal(f.boss.moveIntent, 'hold');
    finish(f);

    // retreat: kite 보스는 preferredRange × 0.6 안에서 물러난다
    const g = mk({ far: atk('far', { sel: { minRange: 8, maxRange: 20, weight: 1, cooldown: 0 } }) }, { def: { kite: true, preferredRange: 10 } });
    g.boss.pos = { x: 0, z: 3 };
    tick(g);
    tick(g, 30);
    assert.equal(g.boss.moveIntent, 'retreat');
    assert.ok(near(g.boss.pos.z, 3 + g.def.moveSpeed * 30 * DT, 1e-6));
    assert.ok(near(angleDiff(g.boss.facing, Math.PI), 0, 1e-9), '물러나면서도 플레이어를 본다');
    finish(g);

    // 2페이즈 이동 속도
    const h = mk({ near: atk('near', { sel: { minRange: 0, maxRange: 2, weight: 1, cooldown: 0 } }) });
    h.boss.pos = { x: 0, z: 15 };
    h.boss.phase = 2;
    tick(h);
    tick(h, 60);
    assert.ok(near(h.boss.pos.z, 15 - h.def.moveSpeed * h.def.phase2.moveSpeedMul * 60 * DT, 1e-6));
    finish(h);
  });

  test('플레이어가 죽었거나 교전 구간이 아니면 공격하지 않는다', () => {
    const e = mk({ a: atk('a') });
    e.player.state = 'dead';
    e.player.hp = 0;
    tick(e, 300);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), 0);
    assert.equal(e.boss.state, 'idle');
    finish(e);

    const f = mk({ a: atk('a') });
    f.state.fight.phase = 'intro';
    tick(f, 120);
    assert.equal(countEvents(f.ctx.events, EV.BOSS_ATTACK_WINDUP), 0);
    f.state.fight.phase = 'fight';
    tick(f, 2);
    assert.equal(f.boss.state, 'attack');
    finish(f);

    // chase 중에 플레이어가 죽으면 멈춘다(fallback도 없다)
    const g = mk({ near: atk('near', { sel: { minRange: 0, maxRange: 2, weight: 1, cooldown: 0 } }) });
    g.boss.pos = { x: 0, z: 15 };
    tick(g, 30);
    assert.equal(g.boss.state, 'chase');
    g.player.state = 'dead';
    tick(g, 400);
    assert.equal(g.boss.state, 'idle');
    assert.equal(g.boss.moveIntent, 'hold');
    assert.equal(countEvents(g.ctx.events, EV.BOSS_ATTACK_WINDUP), 0);
    finish(g);
  });

  test('idle: 제자리에서 def.turnRate로 플레이어 쪽으로 돈다 · 고민 시간 = think × thinkMul', () => {
    const e = mk({ a: atk('a') }, { scaling: { thinkMul: 2 } });
    start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => e.boss.state === 'idle', 300);
    assert.ok(near(e.boss.stateDur, 0.5 * 2), `think 0.5 × 순환 2 (${e.boss.stateDur})`);
    e.player.pos = { x: 6, z: 6 };
    const p0 = { ...e.boss.pos };
    const f0 = e.boss.facing;
    tick(e, 20);
    assert.equal(e.boss.state, 'idle');
    assert.deepEqual(e.boss.pos, p0);
    assert.ok(near(e.boss.facing, f0 - e.def.turnRate * 20 * DT, 1e-9));

    const f = mk({ a: atk('a') }, { scaling: { thinkMul: 2 } });
    f.boss.phase = 2;
    start(f, 'a');
    tickUntil(f, () => f.boss.state === 'idle', 300);
    assert.ok(near(f.boss.stateDur, 0.5 * 2 * 0.7), '2페이즈 thinkMul 0.7');
    finish(e);
    finish(f);
  });
});

describe('§8.6 고민하는 동안의 움직임 (W3)', () => {
  const WINDUPS = (e) => countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP);
  const placeBoss = (e, z) => {
    e.boss.pos = { x: 0, z };
    e.boss.prevPos = { x: 0, z };
  };

  test('걸으며 고민: 선호 거리 밖이면 고민 시간 동안 다가간다(chase · stateDur = 고민 시간) · 끝나야 고른다', () => {
    const e = mk({ a: atk('a') }, { def: { preferredRange: 3 } });
    placeBoss(e, 8);
    start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.equal(e.boss.state, 'chase', '8m > 선호 거리 3 + 1 — 걸으면서 고민한다');
    assert.ok(near(e.boss.stateDur, 0.5), `고민 시간 그대로 (${e.boss.stateDur})`);
    const z0 = e.boss.pos.z;
    const before = WINDUPS(e);
    tick(e, 29);
    assert.equal(e.boss.state, 'chase');
    assert.equal(e.boss.moveIntent, 'approach');
    assert.equal(WINDUPS(e), before, '고민이 끝나기 전에는 후보가 있어도 고르지 않는다');
    assert.ok(near(e.boss.pos.z, z0 - e.def.moveSpeed * 29 * DT, 1e-6), `moveSpeed로 다가온다 (${e.boss.pos.z})`);
    tick(e, 1);
    assert.equal(e.boss.state, 'attack', '고민 시간이 끝난 틱에 고른다');
    finish(e);

    // 선호 거리 안(3.5m ≤ 3 + 1)이면 제자리에서 고민한다
    const f = mk({ a: atk('a') }, { def: { preferredRange: 3 } });
    placeBoss(f, 3.5);
    start(f, 'a');
    f.ctx.bossHooks = {};
    tickUntil(f, () => f.boss.state !== 'attack', 300);
    assert.equal(f.boss.state, 'idle');
    const p0 = { ...f.boss.pos };
    tick(f, 20);
    assert.deepEqual(f.boss.pos, p0);
    finish(f);

    // 인트로가 끝난 뒤의 첫 고민도 같다
    const g = mk({ a: atk('a') }, { def: { preferredRange: 3 } });
    placeBoss(g, 12);
    g.boss.state = 'intro';
    g.boss.stateTime = 0;
    g.boss.stateDur = 0.1;
    tickUntil(g, () => g.boss.state !== 'intro', 30);
    assert.equal(g.boss.state, 'chase');
    finish(g);
  });

  test('걸으며 고민: kite 보스는 preferredRange × kiteNear 안이면 고민하는 동안 물러난다', () => {
    const e = mk({ a: atk('a') }, { def: { kite: true, preferredRange: 10 } });
    placeBoss(e, 3);
    start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.equal(e.boss.state, 'chase');
    const z0 = e.boss.pos.z;
    tick(e, 20);
    assert.equal(e.boss.moveIntent, 'retreat');
    assert.ok(near(e.boss.pos.z, z0 + e.def.moveSpeed * 20 * DT, 1e-6));
    finish(e);

    // 선호 거리 띠 안(7m: 6 ≤ d ≤ 11)이면 제자리
    const f = mk({ a: atk('a') }, { def: { kite: true, preferredRange: 10 } });
    placeBoss(f, 7);
    start(f, 'a');
    f.ctx.bossHooks = {};
    tickUntil(f, () => f.boss.state !== 'attack', 300);
    assert.equal(f.boss.state, 'idle');
    finish(f);
  });

  test('뒤를 잡혔다: rearChance 확률로 돌아서지 않고 짧게(× rearThinkMul) 고민한 뒤 등 뒤 공격을 고른다', () => {
    const defs = () => ({
      a: atk('a', { sel: { ...SEL_ANY, maxAngle: 1.0 } }),
      back: atk('back', { sel: { minRange: 0, maxRange: 8, minAngle: 2.0, weight: 1, cooldown: 0 } }),
    });
    let held = 0;
    const N = 200;
    for (let seed = 1; seed <= N; seed++) {
      const e = mk(defs(), { seed });
      start(e, 'a');
      e.ctx.bossHooks = {};
      e.player.pos = { x: 0, z: 9 };   // 보스(0, 6 · facing π)의 등 뒤 3m
      tickUntil(e, () => e.boss.state !== 'attack', 300);
      assert.equal(e.boss.state, 'idle');
      const f0 = e.boss.facing;
      if (near(e.boss.stateDur, 0.5 * BOSS_AI.rearThinkMul)) {
        held += 1;
        tickUntil(e, () => {
          if (e.boss.state === 'idle') assert.equal(e.boss.facing, f0, '돌아서지 않는다');
          return e.boss.state === 'attack';
        }, 30);
        assert.equal(e.boss.attack.id, 'back');
      } else {
        assert.ok(near(e.boss.stateDur, 0.5), `평소의 고민 시간 (${e.boss.stateDur})`);
        tick(e, 5);
        assert.notEqual(e.boss.facing, f0, '평소대로 플레이어 쪽으로 돈다');
      }
      finish(e);
    }
    const p = BOSS_AI.rearChance;
    assert.ok(held > N * p - 35 && held < N * p + 35, `rearChance ${p} ≈ ${N * p}번 (실제 ${held})`);

    // 등 뒤 공격이 쿨다운이면 평소대로 돈다
    const c = mk(defs(), { seed: 1 });
    start(c, 'a');
    c.ctx.bossHooks = {};
    c.boss.cooldowns.back = 99;
    c.player.pos = { x: 0, z: 9 };
    tickUntil(c, () => c.boss.state !== 'attack', 300);
    assert.ok(near(c.boss.stateDur, 0.5));
    finish(c);
  });
});

// ───────────────────────────────────────────────────────────── 연속기

describe('§8.6 연속기', () => {
  const chainDef = (c = {}) => ({
    a: atk('a', { chain: [{ next: 'b', chance: 1, chanceP2: 1, at: 0.2, ...c }] }),
    b: atk('b', { sel: null, chain: [{ next: 'a', chance: 1, chanceP2: 1, at: 0.2 }] }),
  });
  /** a를 한 번 강제로 시작하고 idle로 돌아올 때까지의 공격 열. */
  const sequence = (e) => {
    start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => e.boss.state !== 'attack', 1000);
    return evs(e, EV.BOSS_ATTACK_WINDUP).map((x) => x.attackId);
  };

  test('후딜 at에 넘어간다(남은 후딜 버림 · chained · 쿨다운 무시) · 최대 3번', () => {
    const e = mk(chainDef());
    const first = start(e, 'a');
    e.ctx.bossHooks = {};
    e.boss.cooldowns.b = 50;
    const n = tickUntil(e, () => e.boss.attack !== first);
    assert.ok(near(n * DT, 0.6 + 0.2 + 0.2, DT + 1e-9), `전환 시각 ${n * DT}`);
    assert.equal(e.boss.attack.id, 'b');
    assert.equal(e.boss.attack.chained, true);
    assert.equal(first.chained, false);
    assert.equal(e.boss.attack.seq, 2);
    assert.equal(e.boss.attack.phase, 'windup', '연속기도 예고부터 다시 시작한다(다시 추적한다)');
    assert.deepEqual({ ...evs(e, EV.BOSS_ATTACK_END)[0] }, { bossId: 'valder', attackId: 'a', seq: 1, interrupted: false });

    tickUntil(e, () => e.boss.state !== 'attack', 1000);
    const ids = evs(e, EV.BOSS_ATTACK_WINDUP).map((x) => x.attackId);
    assert.deepEqual(ids, ['a', 'b', 'a', 'b'], `연속기는 ${BOSS_AI.maxChain}번까지`);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_END), 4);
    assert.equal(e.boss.state, 'idle');
    finish(e);
  });

  test('거리 조건 · 확률 · 2페이즈 확률 · 순환 보너스', () => {
    const farE = mk(chainDef({ maxRange: 4 }));
    assert.deepEqual(sequence(farE), ['a'], '플레이어가 maxRange 밖이면 잇지 않는다');
    const nearE = mk(chainDef({ maxRange: 7 }));
    assert.equal(sequence(nearE).length, 4);

    const rate = (c, opts = {}) => {
      let n = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const e = mk({ a: atk('a', { chain: [{ next: 'b', at: 0.2, ...c }] }), b: atk('b', { sel: null }) }, { seed, scaling: opts.scaling });
        if (opts.phase) e.boss.phase = opts.phase;
        if (sequence(e).length === 2) n += 1;
      }
      return n;
    };
    const half = rate({ chance: 0.5, chanceP2: 1 });
    assert.ok(half > 70 && half < 130, `chance 0.5 ≈ 100 (실제 ${half})`);
    assert.equal(rate({ chance: 0, chanceP2: 1 }), 0, '1페이즈 확률 0');
    assert.equal(rate({ chance: 0, chanceP2: 1 }, { phase: 2 }), 200, '2페이즈는 chanceP2');
    assert.equal(rate({ chance: 0.5, chanceP2: 0 }, { scaling: { chainBonus: 0.5 } }), 200, 'chance + scaling.chainBonus');
    assert.equal(rate({ chance: 0, chanceP2: 1 }, { scaling: { chainBonus: 0.5 } }), 0, '확률 0인 항목은 보너스로도 열리지 않는다');
  });

  test('chain 배열은 순서대로 본다 — 앞 항목이 실패하면 다음 항목', () => {
    const e = mk({
      a: atk('a', { chain: [{ next: 'b', chance: 1, chanceP2: 1, at: 0.1, maxRange: 2 }, { next: 'c', chance: 1, chanceP2: 1, at: 0.1 }] }),
      b: atk('b', { sel: null }),
      c: atk('c', { sel: null }),
    });
    start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => e.boss.state !== 'attack', 1000);
    assert.deepEqual(evs(e, EV.BOSS_ATTACK_WINDUP).map((x) => x.attackId), ['a', 'c']);
    finish(e);
  });
});

// ───────────────────────────────────────────────────────────── §8.7

describe('§8.7 체간 · 패링 · 그로기 · 처형', () => {
  test('체간 감쇠: postureDecayDelay 뒤 초당 postureDecayRate', () => {
    const e = mk({ a: atk('a') });
    e.player.state = 'dead'; // 공격하지 않게
    e.boss.posture = 50;
    e.boss.postureIdle = 0;
    tick(e, 299);
    assert.equal(e.boss.posture, 50, '5초 전에는 줄지 않는다');
    tick(e, 61);
    assert.ok(near(e.boss.posture, 50 - 6 * 1, 0.25), `1초에 6 (${e.boss.posture})`);
    e.boss.postureIdle = 0; // P2가 체간을 쌓으면 0으로 되돌린다
    const p = e.boss.posture;
    tick(e, 60);
    assert.equal(e.boss.posture, p);
    tick(e, 60 * 20);
    assert.equal(e.boss.posture, 0, '0 아래로 내려가지 않는다');
    finish(e);
  });

  test('패링당함: 공격 중단 → parried → idle. 체간이 가득이면 groggy', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    const a = start(e, 'a');
    e.ctx.bossHooks = {};
    tickUntil(e, () => a.phase === 'active');
    onBossParried(e.ctx, result({ source: 'boss', target: 'player', outcome: 'parry' }));
    assert.equal(e.boss.state, 'parried');
    assert.equal(e.boss.stateDur, e.def.parriedDur);
    assert.equal(e.boss.invulnerable, false, '패링당한 보스는 맞는다(치명)');
    assert.equal(evs(e, EV.BOSS_ATTACK_END)[0].interrupted, true);
    const f0 = e.boss.facing;
    e.player.pos = { x: 5, z: 6 };
    tick(e, 59);
    assert.equal(e.boss.state, 'parried');
    assert.equal(e.boss.facing, f0, '튕겨난 동안 돌지 않는다');
    tick(e, 1);
    assert.equal(e.boss.state, 'idle');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 0);
    finish(e);

    const f = mk({ a: atk('a', { hits: [hit()] }) });
    start(f, 'a');
    f.boss.posture = f.boss.postureMax; // P2가 parryPosture를 이미 쌓았다
    onBossParried(f.ctx, result({ source: 'boss', target: 'player', outcome: 'parry' }));
    assert.equal(f.boss.state, 'groggy');
    assert.equal(f.boss.attack, null);
    assert.deepEqual(evs(f, EV.BOSS_GROGGY).map((x) => x.on), [true]);
    finish(f);
  });

  test('체간 붕괴 → groggy(체간 고정 · 회전 없음) → 자연 종료 → recover → idle', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    start(e, 'a');
    e.ctx.bossHooks = {};
    e.boss.posture = e.boss.postureMax;
    onBossDamaged(e.ctx, result({ postureBroken: true, damage: 10 }));
    assert.equal(e.boss.state, 'groggy');
    assert.equal(e.boss.stateDur, e.def.groggyDur);
    assert.equal(e.boss.attack, null);
    assert.equal(evs(e, EV.BOSS_ATTACK_END)[0].interrupted, true);
    assert.deepEqual({ ...evs(e, EV.BOSS_GROGGY)[0] }, { bossId: 'valder', on: true, x: 0, z: 6 });
    onBossDamaged(e.ctx, result({ damage: 20, crit: true })); // 그로기 중 일반 타격 — 상태 유지
    assert.equal(e.boss.state, 'groggy');
    e.player.pos = { x: 5, z: 6 };
    const f0 = e.boss.facing;
    tick(e, 299);
    assert.equal(e.boss.state, 'groggy');
    assert.equal(e.boss.posture, e.boss.postureMax, '그로기 동안 체간은 가득인 채');
    assert.equal(e.boss.facing, f0);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 1);
    tick(e, 1);
    assert.equal(e.boss.state, 'recover');
    assert.equal(e.boss.posture, 0);
    assert.deepEqual(evs(e, EV.BOSS_GROGGY).map((x) => x.on), [true, false], '자연 종료에서도 on:false');
    tick(e, 47);
    assert.equal(e.boss.state, 'recover');
    tick(e, 1);
    assert.equal(e.boss.state, 'idle');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 2);
    finish(e);
  });

  test('처형: executed(무적) → recover → idle · on:false · 처형 연출 중 그로기 타이머 정지', () => {
    const e = mk({ a: atk('a') });
    e.boss.posture = e.boss.postureMax;
    tick(e); // 폴링이 그로기로 보낸다
    assert.equal(e.boss.state, 'groggy');
    tick(e, 100);
    const t0 = e.boss.stateTime;
    e.player.state = 'execute';
    tick(e, 400); // groggyDur(5초)을 넘겨도
    assert.equal(e.boss.state, 'groggy');
    assert.equal(e.boss.stateTime, t0, '처형 연출 동안 타이머는 멈춘다');

    e.boss.hp -= 200;
    onBossDamaged(e.ctx, result({ execute: true, damage: 200, heavy: true }));
    assert.equal(e.boss.state, 'executed');
    assert.equal(e.boss.invulnerable, true);
    assert.equal(e.boss.posture, 0);
    assert.equal(e.boss.stateDur, e.def.executedDur);
    assert.deepEqual(evs(e, EV.BOSS_GROGGY).map((x) => x.on), [true, false]);
    e.player.state = 'idle';
    tick(e, 71);
    assert.equal(e.boss.state, 'executed');
    tick(e, 1);
    assert.equal(e.boss.state, 'recover');
    assert.equal(e.boss.invulnerable, false);
    tick(e, 48);
    assert.equal(e.boss.state, 'idle');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 2, 'on:false는 한 번만');
    finish(e);
  });

  test('(W5) 체간 잠금: 일어날 때(recover) 걸리고 다음 공격의 판정이 시작될 때 풀린다 — 자연 종료 · 처형 둘 다', () => {
    for (const executed of [false, true]) {
      const e = mk({ a: atk('a', { hits: [hit()] }) });
      assert.equal(createBossState(e.def, { hpMul: 1, dmgMul: 1, speedMul: 1 }, { x: 0, z: 6, facing: Math.PI }).postureGuard, false);
      assert.ok(!e.boss.postureGuard, '처음에는 잠겨 있지 않다');
      e.boss.posture = e.boss.postureMax;
      tick(e);
      assert.equal(e.boss.state, 'groggy');
      assert.ok(!e.boss.postureGuard, '그로기 동안은 상태가 막는다(잠금은 일어날 때 건다)');
      if (executed) {
        onBossDamaged(e.ctx, result({ execute: true, damage: 100, heavy: true }));
        tickUntil(e, () => e.boss.state === 'recover');
      } else {
        tickUntil(e, () => e.boss.state === 'recover');
      }
      assert.equal(e.boss.postureGuard, true, 'recover 진입에 잠근다');
      tickUntil(e, () => e.boss.state === 'idle');
      assert.equal(e.boss.postureGuard, true, '고민하는 동안에도 잠겨 있다');
      force(e, 'a');
      tickUntil(e, () => e.boss.state === 'attack');
      // 예고 내내 잠겨 있다가 판정 시작 틱에 풀린다
      while (tA(e.boss.attack) < -TICK) {
        assert.equal(e.boss.postureGuard, true, `예고 중(tA ${tA(e.boss.attack).toFixed(3)})`);
        tick(e);
      }
      tick(e);
      assert.ok(tA(e.boss.attack) >= -1e-9);
      assert.equal(e.boss.postureGuard, false, '판정 시작에 풀린다');
      assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_ACTIVE), 1);
      finish(e);
    }
  });

  test('그로기 중 사망: 즉시 dead · on:false · 무적', () => {
    const e = mk({ a: atk('a') });
    e.boss.posture = e.boss.postureMax;
    tick(e);
    assert.equal(e.boss.state, 'groggy');
    e.boss.hp = 0;
    onBossDamaged(e.ctx, result({ damage: 50, lethal: true, crit: true }));
    assert.equal(e.boss.state, 'dead');
    assert.equal(e.boss.invulnerable, true);
    assert.deepEqual(evs(e, EV.BOSS_GROGGY).map((x) => x.on), [true, false]);
    tick(e, 600);
    assert.equal(e.boss.state, 'dead');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 2);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), 0);
    finish(e);
  });

  test('슈퍼아머: 일반 피격으로는 공격이 끊기지 않는다 · 무적(immune) 결과는 아무것도 바꾸지 않는다', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    const a = start(e, 'a');
    tick(e, 10);
    e.boss.hp -= 30;
    e.boss.posture += 20;
    onBossDamaged(e.ctx, result({ damage: 30, posture: 20 }));
    assert.equal(e.boss.state, 'attack');
    assert.equal(e.boss.attack, a);
    onBossDamaged(e.ctx, result({ outcome: 'immune', execute: true }));
    assert.equal(e.boss.state, 'attack');
    finish(e);
  });
});

describe('§8.7 페이즈 전환 · 사망', () => {
  test('50%에서 예약 → 후딜 끝에 phaseShift(무적 · 연속기보다 우선) → dmgMul/speedMul 갱신 → idle', () => {
    let phaseHook = 0;
    const e = mk({
      a: atk('a', { hits: [hit()], chain: [{ next: 'b', chance: 1, chanceP2: 1, at: 0.1 }] }),
      b: atk('b', { sel: null }),
    }, { scaling: { dmgMul: 2, speedMul: 1.5 }, hooks: { onPhaseChange: (ctx, p) => { phaseHook = p; } } });
    e.boss.dmgMul = 2;
    e.boss.speedMul = 1.5;
    const a = start(e, 'a');
    e.ctx.bossHooks = { onPhaseChange: e.ctx.bossHooks.onPhaseChange };
    tick(e, 5);
    e.boss.hp = 500;
    onBossDamaged(e.ctx, result({ damage: 100 }));
    assert.equal(e.boss.pendingPhase, true);
    assert.equal(e.boss.state, 'attack', '공격은 끝까지 한다');
    assert.equal(e.boss.phase, 1);

    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.equal(e.boss.state, 'phaseShift', '연속기 대신 포효');
    assert.ok(a.t >= a.windup + a.active + a.recovery - 1e-6, '후딜을 끝까지 치렀다');
    assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), 1);
    assert.equal(e.boss.phase, 2);
    assert.equal(e.boss.pendingPhase, false);
    assert.equal(e.boss.invulnerable, true);
    assert.equal(e.boss.posture, 0);
    assert.ok(near(e.boss.dmgMul, 2 * 1.15) && near(e.boss.speedMul, 1.5 * 1.1), '순환 × 페이즈');
    assert.equal(phaseHook, 2);
    assert.deepEqual(evs(e, EV.BOSS_PHASE_CHANGED).map((x) => ({ ...x })), [{ bossId: 'valder', phase: 2 }]);

    tick(e, 35);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_CUE), 0);
    tick(e, 2);
    const roar = evs(e, EV.BOSS_CUE);
    assert.equal(roar.length, 1);
    assert.deepEqual([roar[0].cue, roar[0].attackId, roar[0].seq], ['roar', '', 0]);
    assert.deepEqual({ ...evs(e, EV.CAMERA_SHAKE)[0] }, { amp: BOSS_AI.phaseShake[0], dur: BOSS_AI.phaseShake[1] });
    tickUntil(e, () => e.boss.state !== 'phaseShift', 200);
    assert.ok(near(e.boss.stateTime, 0) && e.boss.state === 'idle');
    assert.equal(e.boss.invulnerable, false);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_PHASE_CHANGED), 1);

    // 2페이즈의 다음 공격: 배속이 실제 길이에 반영되고 피해 배율이 판정에 실린다
    force(e, 'a');
    tickUntil(e, () => e.boss.state === 'attack', 200);
    const b = e.boss.attack;
    assert.equal(b.windup, BOSS_AI.minWindup, '0.6 ÷ 1.65 = 0.36 → 하한 0.40');
    assert.ok(near(b.recovery, 0.6 / (1.5 * 1.1)));
    tickUntil(e, () => b.phase === 'active');
    assert.ok(near(getBossHits(e.ctx)[0].damage, 20 * 2 * 1.15));
    finish(e);
  });

  test('idle · chase · parried · recover에서도 예약된 전환이 일어난다', () => {
    const idle = mk({ a: atk('a') });
    idle.player.state = 'dead';
    idle.boss.hp = 400;
    tick(idle, 2);
    assert.equal(idle.boss.state, 'phaseShift');
    finish(idle);

    const chase = mk({ near: atk('near', { sel: { minRange: 0, maxRange: 1, weight: 1, cooldown: 0 } }) });
    tick(chase, 5);
    assert.equal(chase.boss.state, 'chase');
    chase.boss.hp = 400;
    tick(chase, 2);
    assert.equal(chase.boss.state, 'phaseShift');
    finish(chase);

    const par = mk({ a: atk('a', { hits: [hit()] }) });
    start(par, 'a');
    par.boss.hp = 400;
    onBossParried(par.ctx, result({ outcome: 'parry' }));
    tick(par, 30);
    assert.equal(par.boss.state, 'parried');
    assert.equal(par.boss.pendingPhase, true);
    tick(par, 31);
    assert.equal(par.boss.state, 'phaseShift');
    finish(par);

    const rec = mk({ a: atk('a') });
    rec.boss.posture = rec.boss.postureMax;
    tick(rec);
    rec.boss.hp = 400;
    onBossDamaged(rec.ctx, result({ execute: true, damage: 100 }));
    assert.equal(rec.boss.state, 'executed');
    tickUntil(rec, () => rec.boss.state !== 'executed' && rec.boss.state !== 'recover', 300);
    assert.equal(rec.boss.state, 'phaseShift');
    assert.equal(rec.boss.phase, 2);
    finish(rec);
  });

  test('사망이 최우선: 전환 예약 · 공격 중이어도 즉시 dead', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    start(e, 'a');
    tick(e, 40);
    e.boss.pendingPhase = true;
    e.boss.posture = e.boss.postureMax;
    e.boss.hp = 0;
    onBossDamaged(e.ctx, result({ damage: 100, lethal: true, postureBroken: true }));
    assert.equal(e.boss.state, 'dead');
    assert.equal(e.boss.attack, null);
    assert.equal(e.boss.invulnerable, true);
    assert.equal(evs(e, EV.BOSS_ATTACK_END)[0].interrupted, true);
    assert.equal(getBossHits(e.ctx).length, 0);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_GROGGY), 0);
    tick(e, 300);
    assert.equal(e.boss.state, 'dead');
    assert.equal(e.boss.phase, 1);
    assert.equal(countEvents(e.ctx.events, EV.BOSS_PHASE_CHANGED), 0);
    onBossParried(e.ctx, result({ outcome: 'parry' }));
    onBossDamaged(e.ctx, result({ damage: 1 }));
    assert.equal(e.boss.state, 'dead');
    finish(e);
  });

  test('폴링: hp · posture를 직접 바꾸면 다음 틱에 반영된다(디버그 · 투사체 패링 경로)', () => {
    const e = mk({ a: atk('a', { hits: [hit()] }) });
    start(e, 'a');
    e.boss.hp = e.boss.hpMax * 0.5;
    tick(e);
    assert.equal(e.boss.pendingPhase, true);

    const f = mk({ a: atk('a', { hits: [hit()] }) });
    start(f, 'a');
    tick(f, 20);
    f.boss.posture = f.boss.postureMax;
    tick(f);
    assert.equal(f.boss.state, 'groggy');
    assert.equal(f.boss.attack, null);
    assert.equal(evs(f, EV.BOSS_ATTACK_END)[0].interrupted, true);
    assert.deepEqual(evs(f, EV.BOSS_GROGGY).map((x) => x.on), [true]);

    const g = mk({ a: atk('a', { hits: [hit()] }) });
    start(g, 'a');
    g.boss.hp = 0;
    tick(g);
    assert.equal(g.boss.state, 'dead');
    assert.equal(g.boss.invulnerable, true);
    assert.equal(evs(g, EV.BOSS_ATTACK_END)[0].interrupted, true);

    // 무적 상태(phaseShift)에서는 체간이 가득이어도 그로기로 가지 않는다
    const h = mk({ a: atk('a') });
    h.boss.state = 'phaseShift';
    h.boss.stateDur = 2;
    h.boss.posture = h.boss.postureMax;
    tick(h, 5);
    assert.equal(h.boss.state, 'phaseShift');
    for (const x of [e, f, g, h]) finish(x);
  });
});

// ───────────────────────────────────────────────────────────── 훅 · 프레임워크 순수성

describe('§8.8 훅', () => {
  test('8종이 제때 불린다', () => {
    const log = [];
    let ticks = 0;
    const hooks = {
      onCreate: (ctx) => { log.push('create'); ctx.state.boss.ext.n = 0; },
      onTick: (ctx, dt) => { ticks += 1; assert.equal(dt, DT); ctx.state.boss.ext.n += 1; },
      adjustWeights: (ctx, cands) => {
        log.push(`weights:${cands.map((c) => c.id).sort().join(',')}`);
        for (const c of cands) if (c.id !== 'b') c.weight = 0;
      },
      forceAttack: () => { log.push('force'); return null; },
      onAttackStart: (ctx, a) => log.push(`start:${a.id}:${a.seq}`),
      onAttackEnd: (ctx, a) => log.push(`end:${a.id}:${a.seq}`),
      onTimelineEvent: (ctx, ev) => log.push(`event:${ev.name}`),
      onPhaseChange: (ctx, p) => log.push(`phase:${p}`),
    };
    const e = mk({
      a: atk('a'),
      b: atk('b', { events: [{ t: 0, type: 'hook', name: 'boom' }] }),
    }, { hooks });
    tick(e);
    assert.deepEqual(log, ['create', 'force', 'weights:a,b', 'start:b:1'], 'adjustWeights가 b만 남겼다');
    tickUntil(e, () => e.boss.state !== 'attack', 300);
    assert.deepEqual(log.slice(4), ['event:boom', 'end:b:1']);
    e.boss.hp = 100;
    tickUntil(e, () => e.boss.state === 'phaseShift', 300);
    assert.ok(log.includes('phase:2'));
    assert.equal(log.filter((x) => x === 'create').length, 1);
    assert.equal(ticks, e.state.tick, 'onTick은 매 틱');
    assert.equal(e.boss.ext.n, ticks);

    // forceAttack이 id를 주면 AI 선택(거리 · 쿨다운)을 건너뛴다
    const f = mk({ a: atk('a'), far: atk('far', { sel: { minRange: 30, maxRange: 40, weight: 1, cooldown: 9 } }) }, { hooks: { forceAttack: () => 'far' } });
    f.boss.cooldowns.far = 5;
    tick(f);
    assert.equal(f.boss.attack.id, 'far');
    // 없는 id는 무시하고 평소대로 고른다
    const g = mk({ a: atk('a') }, { hooks: { forceAttack: () => 'nope' } });
    tick(g);
    assert.equal(g.boss.attack.id, 'a');
    for (const x of [e, f, g]) finish(x);
  });

  test('프레임워크는 보스 id가 아니라 ctx.bossDef · ctx.bossHooks만 본다', () => {
    const run = (id) => {
      const e = mk({ a: atk('a', { hits: [hit()], events: [{ t: 0, type: 'cue', cue: 'slam' }] }) }, { def: { id }, seed: 3 });
      e.boss.id = id;
      tick(e, 400);
      return e.ctx.events.map((x) => `${x.name}:${x.payload.attackId ?? ''}:${x.payload.seq ?? ''}`);
    };
    const a = run('valder');
    assert.ok(a.length > 5);
    assert.deepEqual(run('nihil'), a);
    assert.deepEqual(run('someone_else'), a);
  });

  test('프레임워크 소스에 보스 id 문자열이 없고, 상수는 BOSS_AI에서 읽는다', () => {
    const dir = new URL('../src/sim/boss/', import.meta.url);
    for (const name of ['bossSim.js', 'bossAI.js', 'bossTimeline.js', 'validateBossDef.js']) {
      const src = readFileSync(new URL(name, dir), 'utf8');
      for (const id of BOSS_IDS) assert.equal(src.includes(id), false, `${name}에 '${id}'가 있다`);
      assert.equal(/data\/bosses\//.test(src), false, `${name}가 보스 정의를 직접 import한다(ctx.bossDef만 써야 한다)`);
      assert.equal(/hooks\/index/.test(src), false, `${name}가 훅 레지스트리를 import한다(ctx.bossHooks만 써야 한다)`);
    }
    for (const name of ['bossSim.js', 'bossAI.js', 'bossTimeline.js']) {
      const src = readFileSync(new URL(name, dir), 'utf8');
      assert.ok(src.includes('BOSS_AI'), `${name}`);
    }
  });

  test('결정성: 같은 시드 → 같은 상태', () => {
    const run = (seed) => {
      const e = mk(makeSynthBossDef().attacks, { seed });
      for (let i = 0; i < 1200; i++) {
        e.player.pos.x = Math.sin(i / 90) * 6;
        e.player.pos.z = Math.cos(i / 130) * 5;
        tick(e);
        getBossHits(e.ctx);
        e.state.events.length = 0;
      }
      finish(e);
      return JSON.stringify(e.state);
    };
    assert.equal(run(11), run(11));
    assert.notEqual(run(11), run(12));
  });
});

// ───────────────────────────────────────────────────────────── §8.9 validateBossDef

describe('§8.9 validateBossDef', () => {
  const ok = () => makeSynthBossDef();
  const bad = (mutate, re) => {
    const def = ok();
    mutate(def);
    const errors = validateBossDef(def);
    assert.ok(errors.length > 0, '오류가 있어야 한다');
    for (const s of errors) assert.equal(typeof s, 'string');
    if (re) assert.ok(errors.some((s) => re.test(s)), `${re} 를 찾지 못했다: ${errors.join(' | ')}`);
    return errors;
  };
  const melee = (def) => def.attacks.synth_melee;
  const ranged = (def) => def.attacks.synth_ranged;

  test('합성 정의는 통과한다 · 던지지 않는다', () => {
    assert.deepEqual(validateBossDef(ok()), []);
    assert.ok(validateBossDef(null).length > 0);
    assert.ok(validateBossDef({}).length > 0);
    assert.ok(validateBossDef({ attacks: { x: null } }).length > 0);
  });

  test('규칙 1: 머리 필드 · hp > 0 · think 순서', () => {
    bad((d) => { delete d.moveSpeed; }, /moveSpeed/);
    bad((d) => { d.postureMax = NaN; }, /postureMax/);
    bad((d) => { d.hp = 0; }, /hp/);
    bad((d) => { d.think = [1, 0.5]; }, /think/);
    bad((d) => { delete d.phase2.thinkMul; }, /thinkMul/);
    bad((d) => { d.reward = Infinity; }, /reward/);
    bad((d) => { d.attacks = {}; }, /attacks/);
  });

  test('규칙 2: windup ≥ 0.45 · active ≥ 0 · recovery ≥ 0.3 · id = 키 · pose', () => {
    bad((d) => { melee(d).windup = 0.44; }, /windup/);
    bad((d) => { melee(d).active = -0.1; melee(d).hits = []; }, /active/);
    bad((d) => { melee(d).recovery = 0.29; }, /recovery/);
    bad((d) => { melee(d).id = 'other'; }, /id/);
    bad((d) => { melee(d).pose = 5; }, /pose/);
    assert.deepEqual(validateBossDef({ ...ok(), attacks: { ...ok().attacks, x: atk('x', { windup: 0.45, recovery: 0.3 }) } }), []);
  });

  test('규칙 3: 판정 창 · 피해 · 셰이프 · 장판은 shape와 grow 중 하나 · 필수 필드', () => {
    bad((d) => { melee(d).hits[0].t1 = 0.2; }, /t0 < t1/);
    bad((d) => { melee(d).hits[0].t0 = 0.15; }, /t0 < t1/);
    bad((d) => { melee(d).hits[0].t0 = -0.1; }, /t0 < t1/);
    bad((d) => { melee(d).hits[0].damage = 0; }, /damage/);
    bad((d) => { melee(d).hits[0].shape = { type: 'arc', r: 4 }; }, /halfAngle/);
    bad((d) => { melee(d).hits[0].shape = { type: 'circle' }; }, /circle/);
    bad((d) => { melee(d).hits[0].shape = { type: 'ring', rInner: 3, rOuter: 2 }; }, /ring/);
    bad((d) => { ranged(d).hits[0].shape = { type: 'capsule', fwd0: 0, r: 1 }; }, /capsule/);
    bad((d) => { melee(d).hits[0].shape = { type: 'blob', r: 1 }; }, /blob/);
    bad((d) => { delete melee(d).hits[0].parryable; }, /parryable/);
    bad((d) => { ranged(d).hits[0].telegraphShape = { type: 'circle', r: -1 }; }, /telegraphShape/);
    const ev = (h) => ({ t: 0, type: 'hazard', hazard: h });
    bad((d) => { melee(d).events = [ev({ ...HAZARD, grow: { r0: 1, r1: 5, width: 1 } })]; }, /정확히 하나/);
    const { shape: _s, ...noShape } = HAZARD;
    bad((d) => { melee(d).events = [ev(noShape)]; }, /정확히 하나/);
    const { warn: _w, ...noWarn } = HAZARD;
    bad((d) => { melee(d).events = [ev(noWarn)]; }, /warn/);
    const { homing: _h, ...noHoming } = PROJ;
    bad((d) => { melee(d).events = [{ t: 0, type: 'projectile', proj: noHoming }]; }, /homing/);
    bad((d) => { melee(d).events = [{ t: 0, type: 'projectile' }]; }, /proj/);
    bad((d) => { melee(d).events = [{ t: 0, type: 'explode' }]; }, /type/);
    const good = ok();
    melee(good).events = [ev(HAZARD), ev({ ...noShape, grow: { r0: 1, r1: 5, width: 1 } }), { t: 0, type: 'projectile', proj: PROJ }];
    assert.deepEqual(validateBossDef(good), []);
  });

  test('규칙 4: 음수 오프셋의 절댓값 ≤ windup × 0.75', () => {
    bad((d) => { melee(d).move = { kind: 'lunge', t0: -0.46, t1: 0, dist: 1 }; }, /move\.t0/);
    bad((d) => { melee(d).move = { kind: 'leap', t0: -0.3, t1: 0, dist: 5, aimLock: -0.5 }; }, /aimLock/);
    bad((d) => { melee(d).events = [{ t: -0.5, type: 'cue', cue: 'whoosh' }]; }, /events\[0\]\.t/);
    bad((d) => { melee(d).track.lockLead = 0.5; }, /lockLead/);
    const good = ok();
    melee(good).move = { kind: 'lunge', t0: -0.45, t1: 0, dist: 1 }; // 0.6 × 0.75 = 0.45
    melee(good).events = [{ t: -0.45, type: 'cue', cue: 'whoosh' }];
    assert.deepEqual(validateBossDef(good), []);
  });

  test('규칙 5: chain.next · fallbackAttack이 있는 공격', () => {
    bad((d) => { melee(d).chain = [{ next: 'ghost', chance: 1, chanceP2: 1, at: 0.2 }]; }, /ghost/);
    bad((d) => { d.fallbackAttack = 'ghost'; }, /fallbackAttack/);
  });

  test('규칙 6: 1페이즈 피해 공격 2개 이상 · preferredRange 근처에 공백 없음', () => {
    bad((d) => { delete d.attacks.synth_ranged; }, /1페이즈/);
    bad((d) => { ranged(d).sel.minPhase = 2; }, /1페이즈/);
    bad((d) => { ranged(d).hits = []; }, /1페이즈/);
    bad((d) => { ranged(d).sel = null; }, /1페이즈/);
    // 공백 3~6m가 preferredRange 3 ± 1에 걸친다
    bad((d) => { melee(d).sel.maxRange = 3; ranged(d).sel.minRange = 6; }, /고를 공격이 없다/);
    bad((d) => { melee(d).sel.minRange = 2.5; }, /고를 공격이 없다/);
    // 공백이 있어도 preferredRange에서 멀면 통과
    const good = ok();
    melee(good).sel.maxRange = 5;
    ranged(good).sel.minRange = 7;
    ranged(good).sel.maxRange = 12;
    assert.deepEqual(validateBossDef(good), []);
    // 2페이즈 전용 장판만 있는 공격은 1페이즈 피해 공격이 아니다
    const p2 = ok();
    ranged(p2).hits = [];
    ranged(p2).events = [{ t: 0, type: 'hazard', phase: 2, hazard: HAZARD }];
    assert.ok(validateBossDef(p2).some((s) => /1페이즈/.test(s)));
    ranged(p2).events = [{ t: 0, type: 'hazard', hazard: HAZARD }];
    assert.deepEqual(validateBossDef(p2), []);
  });

  test('규칙 7: 큐 어휘 · hazard.kind · proj.kind', () => {
    bad((d) => { melee(d).events = [{ t: 0, type: 'cue', cue: 'kaboom' }]; }, /kaboom/);
    bad((d) => { melee(d).events = [{ t: 0, type: 'hazard', hazard: { ...HAZARD, kind: 'lava' } }]; }, /lava/);
    bad((d) => { melee(d).events = [{ t: 0, type: 'projectile', proj: { ...PROJ, kind: 'arrow' } }]; }, /arrow/);
  });

  test('규칙 8: bodyParts는 r > 0 · 중심 원(fwd 0)이 하나 이상', () => {
    bad((d) => { d.bodyParts = [{ fwd: 1.9, r: 1 }, { fwd: -1.7, r: 1 }]; }, /중심 원/);
    bad((d) => { d.bodyParts = [{ fwd: 0, r: 0 }]; }, /bodyParts/);
    bad((d) => { d.bodyParts = []; }, /bodyParts/);
    const good = ok();
    good.bodyParts = [{ fwd: 1.9, r: 1.0 }, { fwd: 0, r: 1.3 }, { fwd: -1.7, r: 1.0 }];
    assert.deepEqual(validateBossDef(good), []);
  });
});
