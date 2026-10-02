// OWNER: P3 — 계약 §12.2 「boss.valder.test.js」
// 발더(§8.10)의 데이터 + 훅을 프레임워크 위에서 돌린다. P1 · P2의 구현에 기대지 않는다 —
// 합성 플레이어(makeTestState의 리터럴)를 직접 움직이고, 판정은 core/hitShapes.js로 본다.
// 뒤쪽 절반은 "퇴화 동작이 없는가"를 본다: 같은 공격만 반복 · 등 뒤에서 속수무책 · 사거리 밖 헛스윙.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { DT, CUE_IDS } from '../src/core/constants.js';
import { angleDiff, angleOf, dist } from '../src/core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../src/core/hitShapes.js';
import { pushOutOfCircle, resolveCircleVsWorld } from '../src/core/collide.js';
import { PLAYER } from '../src/data/player.js';
import { BOSS_AI } from '../src/data/bossCommon.js';
import { VALDER } from '../src/data/bosses/valder.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { valderHooks } from '../src/sim/boss/hooks/valder.js';
import { getBossHooks } from '../src/sim/boss/hooks/index.js';
import { createBossState, updateBoss, getBossHits, getBossTelegraphs, onBossDamaged } from '../src/sim/boss/bossSim.js';
import { selectAttack } from '../src/sim/boss/bossAI.js';
import { validateBossDef } from '../src/sim/boss/validateBossDef.js';
import { makeTestState, makeTestCtx, countEvents, assertFiniteDeep } from './helpers.js';

// ───────────────────────────────────────────────────────────── 도구

const ONE = { hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0 };
const ATTACK_IDS = ['slash_r', 'slash_l', 'overhead', 'thrust_charge', 'leap_slam', 'spin_slash', 'fire_wave', 'delayed_cleave', 'ember_burst'];
const P2_ONLY = ['fire_wave', 'delayed_cleave', 'ember_burst'];
const WALK = PLAYER.move.walkSpeed;
const SPRINT = PLAYER.move.sprintSpeed;
const ROLL_SPEED = PLAYER.roll.dist / PLAYER.roll.moveDur;

/**
 * 발더 한 판. 보스는 원점에서 +Z를 보고 서 있고(state 'idle'), 플레이어는 (거리 d, 정면 기준 각 a)에 있다.
 * @param {{seed?:number, d?:number, a?:number, phase?:1|2, hooks?:any, intro?:boolean}} [o]
 */
function fight(o = {}) {
  const seed = o.seed ?? 1;
  const state = makeTestState({ bossDef: VALDER, seed });
  const ctx = makeTestCtx(state, { bossDef: VALDER, bossHooks: o.hooks ?? valderHooks, seed });
  const boss = state.boss;
  if (o.intro) {
    state.boss = createBossState(VALDER, ONE, state.world.bossSpawn);
    state.player.pos = { x: state.world.playerSpawn.x, z: state.world.playerSpawn.z };
  } else {
    boss.pos = { x: 0, z: 0 };
    boss.prevPos = { x: 0, z: 0 };
    boss.facing = 0;
    boss.prevFacing = 0;
    const d = o.d ?? 3;
    const a = o.a ?? 0;
    state.player.pos = { x: Math.sin(a) * d, z: Math.cos(a) * d };
  }
  if (o.phase === 2) toPhase2(state.boss);
  return { state, ctx, get boss() { return state.boss; }, player: state.player, stats: newStats() };
}

/** 2페이즈 상태를 직접 만든다(전환 연출 없이) — enterPhaseShift가 하는 일과 같은 값. */
function toPhase2(boss) {
  boss.phase = 2;
  boss.hp = Math.round(boss.hpMax * 0.45);
  boss.dmgMul = VALDER.phase2.dmgMul;
  boss.speedMul = VALDER.phase2.speedMul;
  boss.ext.enchanted = true;
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
    if (h.grow) {
      // 충격파: 띠가 r0 → r1로 지나가는 범위 안에 서 있으면 닿는다
      const d = dist(h.x, h.z, p.pos.x, p.pos.z);
      const half = h.grow.width / 2 + p.radius;
      if (d >= h.grow.r0 - half && d <= h.grow.r1 + half) touched = true;
    } else if (shapeHitsCircle(h.shape, p.pos.x, p.pos.z, p.radius)) {
      touched = true;
    }
  }
  return touched;
}

/**
 * 한 틱: 합성 플레이어 이동 → updateBoss → (P2가 하는) 월드 충돌 · 몸통 밀어내기 → 통계.
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
  if (b.state !== 'dead') pushOutOfCircle(p.pos, p.radius, b.pos.x, b.pos.z, b.radius);
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
  e.ctx.bossHooks = { ...valderHooks, forceAttack: () => id };
  step(e, mover);
  assert.equal(e.boss.state, 'attack');
  assert.equal(e.boss.attack.id, id);
  const atk = e.boss.attack;
  e.ctx.bossHooks = valderHooks;
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

// ───────────────────────────────────────────────────────────── 정의

describe('발더 정의(§8.10)', () => {
  test('validateBossDef 통과 · 머리 필드 · 레지스트리', () => {
    assert.deepEqual(validateBossDef(VALDER), []);
    assert.equal(VALDER.hp, 1400);
    assert.equal(VALDER.reward, 1200);
    assert.equal(VALDER.radius, 0.8);
    assert.equal(VALDER.id, 'valder');
    assert.equal(VALDER.rig, 'humanoid');
    assert.equal(VALDER.arenaId, 'arena_valder');
    assert.equal(VALDER.style, 'fire');
    assert.equal(VALDER.fallbackAttack, 'thrust_charge');
    assert.equal(VALDER.kite, false);
    assert.equal(VALDER.bodyParts, undefined);
    assert.equal(getBossDef('valder'), VALDER);
    assert.equal(getBossHooks('valder'), valderHooks);
    structuredClone(VALDER); // 순수 데이터
  });

  test('공격 9종 · pose 9종 · 선택 조건', () => {
    assert.deepEqual(Object.keys(VALDER.attacks).sort(), [...ATTACK_IDS].sort());
    const poses = ATTACK_IDS.map((id) => VALDER.attacks[id].pose);
    assert.deepEqual([...poses].sort(), ['slashR', 'slashL', 'overhead', 'thrust', 'leap', 'spin', 'slamGround', 'delayed', 'cast'].sort());
    assert.equal(VALDER.attacks.slash_l.sel, null, 'slash_l은 연속기 전용');
    for (const id of ATTACK_IDS) {
      const a = VALDER.attacks[id];
      if (!a.sel) continue;
      assert.equal(a.sel.minPhase === 2, P2_ONLY.includes(id), `${id}의 페이즈`);
    }
    assert.equal(VALDER.attacks.slash_r.chain[0].next, 'slash_l');
    assert.equal(VALDER.attacks.slash_l.chain[0].next, 'overhead');
    assert.ok(VALDER.attacks.slash_r.chain[0].chanceP2 > VALDER.attacks.slash_r.chain[0].chance, '2페이즈에 연속기가 잦다');
  });

  test('glow 규칙: danger = 직접 타격이 패링 불가 · 패링 가능한 공격에는 danger를 쓰지 않는다', () => {
    const danger = ATTACK_IDS.filter((id) => VALDER.attacks[id].glow === 'danger');
    assert.deepEqual(danger.sort(), ['leap_slam', 'thrust_charge']);
    for (const id of ATTACK_IDS) {
      const a = VALDER.attacks[id];
      for (const h of a.hits) {
        assert.equal(h.guardable, true, `${id}: 전부 가드 가능`);
        if (a.glow === 'danger') assert.equal(h.parryable, false, `${id}: danger는 패링 불가`);
        if (a.glow === 'none') assert.equal(h.parryable, true, `${id}: 평범한 근접은 패링 가능`);
      }
      if (a.glow === 'danger') assert.ok(a.hits.length > 0 && a.hits.every((h) => h.telegraph), `${id}: 바닥 표식`);
    }
  });

  test('큐: 근접 공격은 whoosh @−0.15(무기가 출발하는 소리) · 어휘 안', () => {
    for (const id of ['slash_r', 'slash_l', 'spin_slash', 'delayed_cleave']) {
      const w = VALDER.attacks[id].events.filter((ev) => ev.type === 'cue' && ev.cue === 'whoosh');
      assert.equal(w.length, 1, id);
      assert.equal(w[0].t, -0.15, id);
    }
    for (const id of ATTACK_IDS) {
      for (const ev of VALDER.attacks[id].events) if (ev.type === 'cue') assert.ok(CUE_IDS.includes(ev.cue));
    }
  });
});

// ───────────────────────────────────────────────────────────── 공격 하나씩

describe('공격 전부를 forceAttack으로 끝까지', () => {
  /** 표(§8.10)의 장판 개수: [1페이즈, 2페이즈] */
  const HAZARDS = {
    slash_r: [0, 0], slash_l: [0, 0], overhead: [0, 1], thrust_charge: [0, 0], leap_slam: [0, 1],
    spin_slash: [0, 0], fire_wave: [1, 1], delayed_cleave: [0, 0], ember_burst: [3, 3],
  };
  const KINDS = { overhead: 'fire_trail', leap_slam: 'shockwave', fire_wave: 'shockwave', ember_burst: 'fire_pillar' };

  for (const phase of [1, 2]) {
    for (const id of ATTACK_IDS) {
      test(`${id} (${phase}페이즈)`, () => {
        const sel = VALDER.attacks[id].sel;
        const d = sel ? Math.max(1.5, (sel.minRange + sel.maxRange) / 2) : 3;
        const a = sel && sel.minAngle ? Math.PI : 0;
        const e = fight({ d, a, phase, seed: 3 });
        const def = VALDER.attacks[id];
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
            }
          }
          for (const t of getBossTelegraphs(e.ctx)) assert.ok(t.progress >= 0 && t.progress <= 1);
        });
        if (def.hits.length) {
          assert.ok(liveTicks > 0, '히트가 있는 공격은 판정 구간에 getBossHits가 non-empty');
          assert.equal(hitIds.size, def.hits.length);
        } else {
          assert.equal(liveTicks, 0);
        }
        assert.ok(activeTicks > 0);
        assert.equal(e.ctx.spawned.hazards.length, HAZARDS[id][phase - 1], '장판 개수');
        for (const h of e.ctx.spawned.hazards) {
          assert.equal(h.kind, KINDS[id]);
          assert.equal(h.style, 'fire');
          assert.ok(Math.abs(h.damage / e.boss.dmgMul - Math.round(h.damage / e.boss.dmgMul)) < 1e-9, 'damageMul = boss.dmgMul');
        }
        assert.equal(e.ctx.spawned.projectiles.length, 0, '발더는 투사체를 쓰지 않는다');
        assert.equal(countEvents(e.ctx.events, EV.BOSS_TELEPORT), 0);
        const ends = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_END && x.payload.seq === atk.seq);
        assert.equal(ends.length, 1);
        assert.equal(ends[0].payload.interrupted, false);
        assert.equal(e.boss.y, 0);
        const cues = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.seq === atk.seq).map((x) => x.payload.cue);
        assert.deepEqual(cues, def.events.filter((ev) => ev.type === 'cue').map((ev) => ev.cue), '큐가 표의 순서대로 한 번씩');
        structuredClone(e.state);
      });
    }
  }

  test('ember_burst: 불기둥 3개가 0.35초 간격으로 플레이어를 쫓는다', () => {
    const e = fight({ d: 12, phase: 2 });
    const at = [];
    runAttack(e, 'ember_burst', (x) => { x.player.pos.x += WALK * DT; }, (k) => {
      while (at.length < e.ctx.spawned.hazards.length) at.push(k.t - k.windup);
    });
    assert.equal(at.length, 3);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(at[i] - i * 0.35) < DT + 1e-9, `불기둥 ${i} tA = ${at[i]}`);
    const xs = e.ctx.spawned.hazards.map((h) => h.x);
    assert.ok(xs[1] > xs[0] + 1 && xs[2] > xs[1] + 1, `걷는 플레이어를 따라간다 ${xs}`);
    for (const h of e.ctx.spawned.hazards) assert.ok(h.warn >= 0.7, '걸어서 나올 시간이 있다');
  });

  test('leap_slam: 표식(착지 원)이 플레이어를 따라오다 0.35초 전에 멈추고, 그 자리에 떨어진다', () => {
    const e = fight({ d: 10 });
    let frozen = null;
    let peak = 0;
    const atk = runAttack(e, 'leap_slam', (x, i) => { x.player.pos.x = Math.sin(i / 20) * 2; }, (k) => {
      peak = Math.max(peak, e.boss.y);
      const tA = k.t - k.windup;
      const tele = getBossTelegraphs(e.ctx)[0];
      if (tA < -0.35 - 1e-9) {
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
    assert.ok(peak > 2.5, `도약 정점 ${peak}`);
    assert.ok(atk.locked);
  });
});

// ───────────────────────────────────────────────────────────── 2페이즈

describe('2페이즈', () => {
  test('HP 50%에서 전환 → ext.enchanted · enchant 큐 · 배율', () => {
    const e = fight({ d: 3, seed: 5 });
    step(e);
    assert.equal(e.boss.ext.enchanted, false, 'onCreate');
    run(e, 3);
    e.boss.hp = 700;
    onBossDamaged(e.ctx, {
      source: 'player', target: 'boss', outcome: 'hit', damage: 10, rawDamage: 10, posture: 0, staminaDamage: 0, crit: false,
      heavy: false, execute: false, knockdown: false, guardBreak: false, postureBroken: false, lethal: false,
      x: 0, z: 0, y: 1.5, dir: 0, attackId: 'light1', hitId: 999,
    });
    assert.equal(e.boss.pendingPhase, true);
    let guard = 0;
    while (e.boss.state !== 'phaseShift') {
      step(e);
      assert.ok(++guard < 600);
    }
    assert.equal(e.boss.phase, 2);
    assert.equal(e.boss.ext.enchanted, true);
    assert.equal(e.boss.invulnerable, true);
    assert.ok(Math.abs(e.boss.dmgMul - 1.15) < 1e-9 && Math.abs(e.boss.speedMul - 1.12) < 1e-9);
    const cues = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.attackId === '');
    assert.deepEqual(cues.map((x) => x.payload.cue), ['enchant']);
    assert.deepEqual({ ...cues[0].payload }, {
      bossId: 'valder', attackId: '', seq: 0, cue: 'enchant', style: 'fire', x: e.boss.pos.x, z: e.boss.pos.z, facing: e.boss.facing,
    });
    assert.equal(countEvents(e.ctx.events, EV.BOSS_PHASE_CHANGED), 1);
    run(e, VALDER.phaseShiftDur + 0.1);
    assert.notEqual(e.boss.state, 'phaseShift');
    const after = e.ctx.events.filter((x) => x.name === EV.BOSS_CUE && x.payload.attackId === '').map((x) => x.payload.cue);
    assert.deepEqual(after, ['enchant', 'roar']);

    // 2페이즈 60초: 신규 패턴 3종과 충격파 장판이 나온다
    const s = run(e, 60, keepDist(6, WALK));
    for (const id of ['fire_wave', 'delayed_cleave']) assert.ok(s.ids.includes(id), `${id}가 나와야 한다 (${s.text})`);
    assert.ok(e.ctx.spawned.hazards.some((h) => h.kind === 'shockwave' && h.grow), '충격파 장판');
  });

  test('2페이즈 전용 공격은 1페이즈에서 선택되지 않는다', () => {
    for (const [d, a] of [[1.5, 0], [3, 0.5], [4.5, 0], [2, Math.PI], [6, 0], [9, 0], [12, 0.4], [15, 0], [19, 0]]) {
      for (let seed = 1; seed <= 3; seed++) {
        const e = fight({ d, a, seed });
        const s = run(e, 40, keepDist(d, WALK));
        for (const id of P2_ONLY) assert.equal(s.ids.includes(id), false, `1페이즈에 ${id} (d ${d})`);
        assert.equal(e.boss.phase, 1);
        assert.equal(e.ctx.spawned.hazards.length, 0, '1페이즈에는 장판이 없다');
      }
    }
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
      assert.ok(s.total >= 15, `60초에 공격 ${s.total}번`);
      assert.ok(s.hitRate >= 0.9, `서 있는 상대에게는 거의 다 닿는다 (${s.text})`);
      assert.equal(countEvents(e.ctx.events, EV.BOSS_ATTACK_WINDUP), countEvents(e.ctx.events, EV.BOSS_ATTACK_END) + (e.boss.attack ? 1 : 0));
      const seqs = e.ctx.events.filter((x) => x.name === EV.BOSS_ATTACK_WINDUP).map((x) => x.payload.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'seq는 1부터 하나씩');
      assert.ok(e.ctx.events.some((x) => x.name === EV.BOSS_CUE && x.payload.cue === 'roar'), '인트로 포효');
      assert.ok(countEvents(e.ctx.events, EV.BOSS_STEP) > 0, '걸어오는 발소리');
      structuredClone(e.state);
    });
  }
});

// ───────────────────────────────────────────────────────────── 퇴화 동작이 없는가

describe('AI 선택 분포 — 합성 플레이어를 거리 · 각도 격자에 두고 수백 번', () => {
  /**
   * 한 자리(d, a)에서 n번 선택한다. 고를 때마다 그 공격의 실제 길이 + 평균 고민 시간만큼 쿨다운을 흘려보내
   * 실전의 박자를 흉내 낸다(후보가 없으면 재선택 간격만큼).
   */
  function sample(d, a, phase, n = 400, seed = 9) {
    const e = fight({ d, a, phase, seed });
    const boss = e.boss;
    const speed = phase === 2 ? VALDER.phase2.speedMul : 1;
    const think = ((VALDER.think[0] + VALDER.think[1]) / 2) * (phase === 2 ? VALDER.phase2.thinkMul : 1);
    /** @type {Record<string, number>} */
    const counts = {};
    let none = 0;
    let streak = 0;
    let wait = 0; // 후보 없이 기다린 가장 긴 시간(초)
    for (let i = 0; i < n; i++) {
      const id = selectAttack(e.ctx);
      let elapsed = BOSS_AI.reselect;
      if (id) {
        const def = VALDER.attacks[id];
        counts[id] = (counts[id] ?? 0) + 1;
        boss.cooldowns[id] = def.sel.cooldown;
        boss.lastAttacks.unshift(id);
        boss.lastAttacks.length = Math.min(2, boss.lastAttacks.length);
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

  test('정면 근접: 한 공격만 반복하지 않는다', () => {
    for (const d of [1.3, 2.5, 3.5, 4.4]) {
      for (const a of [0, 0.3, -0.6]) {
        const p1 = sample(d, a, 1);
        assert.equal(p1.none, 0, `1페이즈 (${d}, ${a}): 항상 후보가 있다`);
        assert.ok(p1.ids.length >= 2, `1페이즈 (${d}, ${a}): ${p1.text}`);
        assert.ok(p1.topShare <= 0.75, `1페이즈 (${d}, ${a}) 최다 ${p1.topShare}: ${p1.text}`);
        const p2 = sample(d, a, 2);
        assert.equal(p2.none, 0);
        assert.ok(p2.ids.length >= 4, `2페이즈 (${d}, ${a}): ${p2.text}`);
        assert.ok(p2.topShare <= 0.6, `2페이즈 (${d}, ${a}) 최다 ${p2.topShare}: ${p2.text}`);
      }
    }
  });

  test('등 뒤 · 옆 뒤: 회전 베기로 떼어 낸다(속수무책이 아니다)', () => {
    // (W5) 회전 베기의 선택 거리 4.0 → 3.5(판정 r 3.3 — 보이는 칼끝). 그 밖의 등 뒤는 돌아서서 상대한다
    for (const d of [1.3, 2.5, 3.4]) {
      for (const a of [1.5, -2.2, Math.PI]) {
        for (const phase of [1, 2]) {
          const s = sample(d, a, phase);
          assert.ok((s.counts.spin_slash ?? 0) > 0, `(${d}, ${a}) ${phase}페이즈: ${s.text}`);
          // 2페이즈는 한 바퀴(약 2.2초)가 회전 베기의 쿨다운(2.5초)보다 짧아 잠깐 기다릴 수 있다 — 길어야 0.6초
          assert.ok(s.wait <= 0.6 + 1e-9, `(${d}, ${a}) ${phase}페이즈: 후보 없이 ${s.wait}초`);
        }
      }
    }
    // 회전 베기는 실제로 전방위다: 등 뒤의 플레이어에게 닿는다
    const e = fight({ d: 3, a: Math.PI });
    let touched = 0;
    runAttack(e, 'spin_slash', null, () => { if (e.stats.now) touched += 1; });
    assert.ok(touched > 0);
  });

  test('먼 거리: 돌진과 도약이 번갈아 나온다 · 2페이즈에는 불기둥과 충격파가 더해진다', () => {
    for (const d of [8, 11, 13.5]) {
      const p1 = sample(d, 0, 1);
      assert.ok(p1.counts.thrust_charge > 0 && p1.counts.leap_slam > 0, `1페이즈 d ${d}: ${p1.text}`);
      const p2 = sample(d, 0, 2);
      assert.ok(p2.counts.thrust_charge > 0 && p2.counts.leap_slam > 0 && p2.counts.ember_burst > 0, `2페이즈 d ${d}: ${p2.text}`);
      assert.ok(p2.topShare <= 0.6, p2.text);
    }
    assert.ok(sample(8, 0, 2).counts.fire_wave > 0);
    // 돌진 · 도약은 옆이나 뒤를 보고는 쓰지 않는다
    const side = sample(10, 1.5, 1);
    assert.deepEqual(side.ids, [], `각이 맞지 않으면 먼저 돈다: ${side.text}`);
  });

  test('1페이즈의 어떤 자리에서도 2페이즈 전용 공격은 후보가 아니다', () => {
    for (const d of [1.3, 3, 4.8, 5.5, 7, 9.5, 12, 15.5, 19]) {
      for (const a of [0, 0.65, 1.3, 2, Math.PI]) {
        const s = sample(d, a, 1, 120);
        for (const id of P2_ONLY) assert.equal(s.counts[id], undefined, `(${d}, ${a}): ${s.text}`);
        assert.equal(s.counts.slash_l, undefined, '연속기 전용은 직접 고르지 않는다');
      }
    }
  });
});

describe('움직이는 합성 플레이어 60초 — 손 놓고 있거나 헛스윙만 하지 않는다', () => {
  const cases = [
    // [이름, 시작 거리, 시작 각, 움직임, 최소 공격 수, 최소 명중률, 최소 가짓수]
    ['제자리', 3, 0, null, 15, 0.9, 3],
    ['등 뒤에 붙어 다닌다(1.5m)', 1.5, Math.PI, glue(1.5, Math.PI), 15, 0.9, 1],
    ['등 뒤에 붙어 다닌다(3.5m)', 3.5, Math.PI, glue(3.5, Math.PI), 15, 0.9, 1],
    ['걸어서 맴돈다(반경 2.2m)', 2.2, 0, orbit(2.2, WALK), 15, 0.7, 3],
    ['달려서 맴돈다(반경 1.6m — 보스의 회전보다 빠르다)', 1.6, 0, orbit(1.6, SPRINT), 15, 0.5, 2],
    ['중거리를 유지한다(10m)', 10, 0, keepDist(10, WALK), 12, 0.6, 3],
    ['걸어서 계속 물러난다', 4, 0, keepDist(30, WALK), 10, 0.4, 3],
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
          // 같은 공격을 4번 넘게 잇달아 쓰지 않는다(등 뒤에 붙은 경우는 회전 베기가 정답이라 뺀다)
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
});

describe('사거리 끝에서도 닿는다 — 고른 공격이 헛스윙이 아니다', () => {
  for (const id of ATTACK_IDS) {
    const def = VALDER.attacks[id];
    test(id, () => {
      const a = def.sel && def.sel.minAngle ? Math.PI : 0;
      const phase = P2_ONLY.includes(id) ? 2 : 1;
      // 연속기 전용은 연속기의 거리 조건(앞 공격의 chain.maxRange)이 사거리다
      const lo = def.sel ? Math.max(1.3, def.sel.minRange) : 1.3;
      const hi = def.sel ? Math.min(def.sel.maxRange, 19) : VALDER.attacks.slash_r.chain[0].maxRange;
      for (const d of [lo, (lo + hi) / 2, hi]) {
        const e = fight({ d, a, phase });
        let touched = 0;
        runAttack(e, id, null, () => { if (e.stats.now) touched += 1; });
        assert.ok(touched > 0, `${id}: 거리 ${d}의 서 있는 플레이어에게 닿지 않는다`);
      }
    });
  }

  test('연속기 slash_r → slash_l → overhead: 이어진 공격도 다시 조준해 닿는다', () => {
    let chained = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const e = fight({ d: 3, seed });
      e.ctx.bossHooks = { ...valderHooks, forceAttack: () => 'slash_r' };
      step(e);
      e.ctx.bossHooks = valderHooks;
      // 예고 중에 옆으로 돌아 들어간다 — 연속기는 다시 추적해야 닿는다
      const mover = orbit(3, WALK);
      let guard = 0;
      while (e.boss.state === 'attack') {
        step(e, mover);
        assert.ok(++guard < 900);
      }
      const order = e.stats.order;
      assert.equal(order[0], 'slash_r');
      if (order.length > 1) {
        chained += 1;
        assert.equal(order[1], 'slash_l');
        assert.ok(e.stats.attacks.slash_l.hit >= 1, `시드 ${seed}: slash_l이 빗나갔다`);
        if (order.length > 2) assert.equal(order[2], 'overhead');
        assert.ok(order.length <= 3);
      }
    }
    assert.ok(chained >= 6 && chained <= 22, `1페이즈 연속기 확률 0.45 → 30번 중 ${chained}번`);
  });
});

// ───────────────────────────────────────────────────────────── 읽고 · 피하고 · 반격한다

describe('패턴 학습의 교과서 — 예고가 읽히고, 고정 뒤에는 피할 수 있고, 후딜에 반격할 수 있다', () => {
  test('모든 공격: 예고 ≥ 0.45초 · 판정 전에 방향 고정 · 판정과 후딜 내내 회전 없음 · 후딜에는 판정이 없다', () => {
    for (const phase of [1, 2]) {
      for (const id of ATTACK_IDS) {
        const def = VALDER.attacks[id];
        const sel = def.sel;
        const d = sel ? Math.max(2, (sel.minRange + sel.maxRange) / 2) : 3;
        const e = fight({ d, a: sel && sel.minAngle ? Math.PI : 0, phase, seed: 2 });
        let lockedAt = null;
        let lockedFacing = null;
        let recoveryTicks = 0;
        let recoveryPos = null;
        // 플레이어가 계속 옆으로 걷는다 — 고정 전에는 따라 돌고, 고정 뒤에는 따라 돌지 않아야 한다
        const atk = runAttack(e, id, orbit(d, WALK), (k) => {
          const tA = k.t - k.windup;
          if (k.locked && lockedAt === null) {
            lockedAt = tA;
            lockedFacing = e.boss.facing;
          }
          if (k.locked) assert.equal(e.boss.facing, lockedFacing, `${id}: 고정 뒤 회전`);
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
        // 고정은 틱 경계에서만 일어난다: −lockLead ≤ 고정 시각 < −lockLead + 한 틱
        assert.ok(lockedAt !== null && lockedAt >= -def.track.lockLead - 1e-9, `${id}: 고정이 너무 이르다 ${lockedAt}`);
        assert.ok(lockedAt < -def.track.lockLead + DT + 1e-9, `${id}: 고정 시각 ${lockedAt}`);
        // 반격 창: 2페이즈의 배속을 받아도 후딜이 0.85초는 남는다
        assert.ok(recoveryTicks * DT >= 0.85 || def.chain.length > 0, `${id}: 후딜 ${recoveryTicks * DT}초`);
        assert.ok(atk.recovery >= 0.85, `${id}: 후딜 ${atk.recovery}초`);
      }
    }
  });

  test('찌르기 돌진 · 내려찍기: 방향이 고정된 뒤 옆으로 구르면 빗나간다', () => {
    for (const [id, d] of [['thrust_charge', 10], ['thrust_charge', 6.5], ['overhead', 3], ['overhead', 4.4]]) {
      // 가만히 있으면 맞는다
      const still = fight({ d });
      let hit = 0;
      runAttack(still, id, null, () => { if (still.stats.now) hit += 1; });
      assert.ok(hit > 0, `${id} @${d}: 서 있으면 맞아야 한다`);

      // 고정을 본 순간 옆으로 구른다(구르기 속도 · 구르기 한 번의 이동 시간만큼)
      const e = fight({ d });
      let rolled = 0;
      let touched = 0;
      runAttack(e, id, (x) => {
        const k = x.boss.attack;
        if (k && k.locked && rolled < PLAYER.roll.moveDur) {
          x.player.pos.x += ROLL_SPEED * DT;
          rolled += DT;
        }
      }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched, 0, `${id} @${d}: 고정 뒤 옆 구르기로 피할 수 있어야 한다`);
    }
  });

  test('가로 베기는 등 뒤를 치지 못한다 — 예고 중에 뒤로 돌아 들어가면 반격 자리다', () => {
    for (const id of ['slash_r', 'slash_l', 'delayed_cleave', 'overhead']) {
      const e = fight({ d: 2.2, phase: 2 });
      let touched = 0;
      runAttack(e, id, (x) => {
        const k = x.boss.attack;
        // 방향이 고정된 순간 보스의 등 뒤로 빠진다(무적 구르기로 몸을 통과한 셈)
        if (k && k.locked) glue(2.2, Math.PI)(x);
      }, () => { if (e.stats.now) touched += 1; });
      assert.equal(touched, 0, `${id}: 등 뒤에 닿는다`);
    }
  });

  test('모든 직접 타격은 구르기 한 번으로 넘길 수 있다 — 판정 창 ≤ 무적 창, 아니면 옆으로 빠져 피한다', () => {
    const iframe = PLAYER.roll.iEnd - PLAYER.roll.iStart;
    const longWindows = [];
    for (const id of ATTACK_IDS) {
      for (const h of VALDER.attacks[id].hits) {
        assert.equal(h.interval, 0, `${id}: 발더에게 지속 판정은 없다`);
        if (h.t1 - h.t0 > iframe - 2 * DT) longWindows.push(id);
      }
    }
    // 무적 창보다 긴 판정은 찌르기 돌진뿐이고, 그것은 좁은 선이라 옆으로 빠져 피한다(위 테스트)
    assert.deepEqual(longWindows, ['thrust_charge']);
    assert.equal(VALDER.attacks.thrust_charge.hits[0].shape.type, 'capsule');
    assert.ok(VALDER.attacks.thrust_charge.hits[0].shape.r <= 1);
  });

  test('도약 내려찍기: 표식이 뜨자마자 달려도 원을 벗어나지 못한다 — 구르기 무적이나 가드로 받는 공격이다', () => {
    const e = fight({ d: 11 });
    let touched = 0;
    runAttack(e, 'leap_slam', (x) => {
      const k = x.boss.attack;
      if (k && k.t - k.windup >= -0.6) x.player.pos.z += SPRINT * DT;
    }, () => { if (e.stats.now) touched += 1; });
    assert.ok(touched > 0, '달리기만으로는 피하지 못한다(붉은 발광의 뜻)');
    // 대신 착지 원이 멈춘 뒤 판정까지(0.35초)는 구르기 무적 창(0.37초) 안에 들어온다
    const mv = VALDER.attacks.leap_slam.move;
    assert.ok(-mv.aimLock <= PLAYER.roll.iEnd - PLAYER.roll.iStart);
    assert.equal(VALDER.attacks.leap_slam.hits[0].guardable, true);
  });

  test('돌진은 플레이어를 지나쳐 등을 보인다(반격 기회)', () => {
    const e = fight({ d: 8 });
    // 방향이 고정된 뒤 옆으로 한 걸음 빠진다(정확히 일직선에 서 있으면 몸통 충돌이 플레이어를 앞으로 밀고 간다)
    let stepped = false;
    const atk = runAttack(e, 'thrust_charge', (x) => {
      const k = x.boss.attack;
      if (k && k.locked && !stepped) {
        stepped = true;
        x.player.pos.x += 1.5;
      }
    });
    const b = e.boss;
    const p = e.player;
    assert.ok(b.pos.z > p.pos.z + 1, `플레이어(z ${p.pos.z})를 지나쳤다(z ${b.pos.z})`);
    const toPlayer = angleOf(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
    assert.ok(Math.abs(angleDiff(b.facing, toPlayer)) > 2, '플레이어는 보스의 등 뒤쪽에 있다');
    assert.ok(atk.recovery >= 1.2);
  });
});
