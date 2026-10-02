// OWNER: P2 — 계약 §12.2 「combat.test.js」
// 판정 규칙(§6.4) · 틱당 피격 1회 · 투사체 패링 · 히트스톱 · 투사체/장판 · 충돌 해소(§5.1 G).
// 상대 상태는 test/helpers.js의 리터럴로 만든다 — P1 · P3 · P4가 스텁이어도 완성본이어도 통과한다
// (P2가 직접 쓰는 값만 단언한다: 결과 · HP · 체간 · 스태미나 · 레지스트리 · 이벤트).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { DT } from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { COMBAT } from '../src/data/combat.js';
import { resolveHitOnBoss, resolveHitOnDummy, resolveHitOnPlayer } from '../src/sim/combat/damage.js';
import { hasHit, markHit } from '../src/sim/combat/hitRegistry.js';
import { clearProjectiles, resolveProjectiles, spawnProjectile, updateProjectiles } from '../src/sim/projectiles.js';
import { clearHazards, resolveHazards, spawnHazard, updateHazards } from '../src/sim/hazards.js';
import {
  assertFiniteDeep, countEvents, makeSynthBossDef, makeTestCtx, makeTestState, makeTestStats,
} from './helpers.js';
import { attackRuntime, bossHit, makeSim, neutralize, playerHit, startNeutralFight, stepN } from './gamesim.fixtures.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

/** 보스전 합성 상태 + ctx. 플레이어 (0, 0) facing 0(+Z), 보스 (0, 6) facing π — 서로 마주 본다. */
function fightCtx(opts = {}) {
  const def = opts.def ?? makeSynthBossDef();
  const state = makeTestState({ bossDef: def, stats: opts.stats });
  const ctx = makeTestCtx(state, { bossDef: def, scaling: opts.scaling });
  return { def, state, ctx, player: state.player, boss: state.boss, fight: state.fight };
}

const hits = (ctx, target) => ctx.events.filter((e) => e.name === EV.HIT && e.payload.target === target);

const ORB = {
  kind: 'void_orb', style: 'void', speed: 6, r: 0.35, life: 4, homing: 0, homingTime: 0,
  damage: 18, guardable: true, parryable: true, knockdown: false, y: 1.2,
};

const PILLAR = {
  kind: 'fire_pillar', style: 'fire', shape: { type: 'circle', r: 2 }, warn: 0.5, active: 0.3, interval: 0,
  damage: 15, guardable: true, knockdown: false,
};

describe('보스 · 투사체 · 장판 → 플레이어 (§6.4)', () => {
  test('일반 피격: HP · damageTaken · HIT · 히트스톱 · 충돌 지점', () => {
    const { state, ctx, player, fight } = fightCtx();
    const res = resolveHitOnPlayer(ctx, bossHit(state, { damage: 20.4 }));
    assert.equal(res.outcome, 'hit');
    assert.equal(res.damage, 20);
    assert.equal(res.target, 'player');
    assert.equal(res.source, 'boss');
    assert.equal(res.lethal, false);
    assert.equal(res.kind, 'synth_melee');
    assert.equal(player.hp, 80);
    assert.equal(fight.damageTaken, 20);
    assert.equal(state.hitstop, COMBAT.bossHitHitstop);
    assert.equal(hits(ctx, 'player').length, 1);
    assert.equal(countEvents(ctx.events, EV.CAMERA_SHAKE), 1);
    // 충돌 지점 = 플레이어 원의 보스 쪽 표면, dir = 보스 → 플레이어(−Z = π).
    near(res.x, 0);
    near(res.z, player.radius);
    near(Math.abs(res.dir), Math.PI);
    assert.equal(res.y, COMBAT.hitY.player);
    assertFiniteDeep(state);
  });

  test('넘어뜨리는 타격은 knockdown 히트스톱 · 치명타(lethal)는 HP 0에서 멈춘다', () => {
    const a = fightCtx();
    const r1 = resolveHitOnPlayer(a.ctx, bossHit(a.state, { knockdown: true, heavy: true }));
    assert.equal(r1.knockdown, true);
    assert.equal(a.state.hitstop, COMBAT.bossKnockdownHitstop);

    const b = fightCtx();
    b.player.hp = 12;
    const r2 = resolveHitOnPlayer(b.ctx, bossHit(b.state, { damage: 50 }));
    assert.equal(r2.damage, 12);
    assert.equal(r2.lethal, true);
    assert.equal(b.player.hp, 0);
    assert.equal(b.fight.damageTaken, 12);
    assertFiniteDeep(b.state);
  });

  test('무적 → dodge + 레지스트리 등록(같은 hitId는 다시 맞지 않는다) · HIT 없음', () => {
    const { state, ctx, player } = fightCtx();
    player.iframe = true;
    player.state = 'roll';
    const hit = bossHit(state);
    const res = resolveHitOnPlayer(ctx, hit);
    assert.equal(res.outcome, 'dodge');
    assert.equal(res.damage, 0);
    assert.equal(player.hp, player.stats.hpMax);
    assert.equal(hasHit(state, hit.hitId, 'player'), true);
    assert.equal(countEvents(ctx.events, EV.HIT), 0);
    assert.equal(countEvents(ctx.events, EV.PLAYER_DODGED), 1);
    assert.equal(ctx.events.find((e) => e.name === EV.PLAYER_DODGED).payload.attackId, 'synth_melee');
    // 무적이 풀린 뒤에도 같은 판정은 다시 맞지 않는다.
    player.iframe = false;
    player.state = 'idle';
    state.tick += 1;
    assert.equal(resolveHitOnPlayer(ctx, hit), null);
    assert.equal(player.hp, player.stats.hpMax);
    assert.equal(countEvents(ctx.events, EV.PLAYER_DODGED), 1);
    assertFiniteDeep(state);
  });

  test('구르기가 아닌 무적(피격 직후 등)은 PLAYER_DODGED를 내지 않는다', () => {
    const { state, ctx, player } = fightCtx();
    player.iframe = true;
    assert.equal(resolveHitOnPlayer(ctx, bossHit(state)).outcome, 'dodge');
    assert.equal(countEvents(ctx.events, EV.PLAYER_DODGED), 0);
  });

  test('정면 패링: 피해 0 · 스태미나 0 · 보스 체간 +parryPosture · parries', () => {
    const { def, state, ctx, player, boss, fight } = fightCtx();
    boss.state = 'attack';
    boss.attack = attackRuntime(def);
    player.state = 'guard';
    player.guarding = true;
    player.parryActive = true;
    player.parryT = 0.1;
    boss.postureIdle = 3;
    const res = resolveHitOnPlayer(ctx, bossHit(state));
    assert.equal(res.outcome, 'parry');
    assert.equal(res.damage, 0);
    assert.equal(res.staminaDamage, 0);
    assert.equal(res.posture, player.stats.parryPosture);
    assert.equal(player.hp, player.stats.hpMax);
    assert.equal(player.stamina, player.stats.staminaMax);
    assert.equal(fight.parries, 1);
    assert.equal(state.hitstop, COMBAT.parryHitstop);
    assert.equal(hits(ctx, 'player')[0].payload.outcome, 'parry');
    assert.ok(boss.posture >= player.stats.parryPosture - 1e-9 || boss.state === 'groggy');
    assertFiniteDeep(state);
  });

  test('패링으로 체간이 가득 차면 postureBroken', () => {
    const { def, state, ctx, player, boss } = fightCtx();
    boss.state = 'attack';
    boss.attack = attackRuntime(def);
    boss.posture = boss.postureMax - 5;
    player.state = 'guard';
    player.guarding = true;
    player.parryActive = true;
    const res = resolveHitOnPlayer(ctx, bossHit(state));
    assert.equal(res.outcome, 'parry');
    near(res.posture, 5);
    assert.equal(res.postureBroken, true);
  });

  test('등 뒤에서 온 공격은 패링도 가드도 안 된다', () => {
    const { state, ctx, player } = fightCtx();
    player.facing = Math.PI; // 보스를 등진다
    player.state = 'guard';
    player.guarding = true;
    player.parryActive = true;
    const res = resolveHitOnPlayer(ctx, bossHit(state));
    assert.equal(res.outcome, 'hit');
    assert.equal(res.damage, 20);
    assert.equal(player.stamina, player.stats.staminaMax);
  });

  test('패링 불가 공격은 패링 창 안에서도 가드로 받는다 · 가드 불가 공격은 그대로 맞는다', () => {
    const a = fightCtx();
    a.player.state = 'guard';
    a.player.guarding = true;
    a.player.parryActive = true;
    const r1 = resolveHitOnPlayer(a.ctx, bossHit(a.state, { parryable: false }));
    assert.equal(r1.outcome, 'guard');
    assert.equal(a.fight.parries, 0);

    const b = fightCtx();
    b.player.state = 'guard';
    b.player.guarding = true;
    const r2 = resolveHitOnPlayer(b.ctx, bossHit(b.state, { parryable: false, guardable: false }));
    assert.equal(r2.outcome, 'hit');
    assert.equal(r2.damage, 20);
  });

  test('가드: 피해 경감 · 스태미나 소모 — 순환 배율은 스태미나에 실리지 않는다', () => {
    const a = fightCtx();
    a.player.state = 'guard';
    a.player.guarding = true;
    const r1 = resolveHitOnPlayer(a.ctx, bossHit(a.state, { damage: 20 }));
    assert.equal(r1.outcome, 'guard');
    assert.equal(r1.damage, 5); // round(20 × (1 − 0.75))
    near(r1.staminaDamage, 18); // 20 × 0.9
    near(a.player.stamina, 82);
    assert.equal(a.player.hp, 95);
    assert.equal(r1.guardBreak, false);
    assert.equal(a.state.hitstop, COMBAT.guardHitstop);

    // 순환 1(dmgMul 1.3): 들어온 피해 26, 스태미나는 순환 배율을 뺀 20 기준.
    const b = fightCtx({ scaling: { dmgMul: 1.3 } });
    b.player.state = 'guard';
    b.player.guarding = true;
    const r2 = resolveHitOnPlayer(b.ctx, bossHit(b.state, { damage: 26 }));
    assert.equal(r2.damage, Math.round(26 * 0.25));
    near(r2.staminaDamage, 18, 1e-6);
    near(b.player.stamina, 82, 1e-6);
    assertFiniteDeep(b.state);
  });

  test('가드 붕괴: 스태미나가 0 이하가 되면 0으로 자르고 guardBreak', () => {
    const { state, ctx, player } = fightCtx();
    player.state = 'guard';
    player.guarding = true;
    player.stamina = 10;
    const res = resolveHitOnPlayer(ctx, bossHit(state));
    assert.equal(res.outcome, 'guard');
    assert.equal(res.guardBreak, true);
    assert.equal(player.stamina, 0);
    assert.equal(res.damage, 5);
  });

  test('마을 · 인트로 · godMode · 쓰러진 쪽에는 피해가 없다', () => {
    // godMode → dodge(등록) · HIT 없음
    const g = fightCtx();
    g.state.debug.godMode = true;
    const hit = bossHit(g.state);
    assert.equal(resolveHitOnPlayer(g.ctx, hit).outcome, 'dodge');
    assert.equal(g.player.hp, g.player.stats.hpMax);
    assert.equal(countEvents(g.ctx.events, EV.HIT), 0);
    assert.equal(countEvents(g.ctx.events, EV.PLAYER_DODGED), 0);
    assert.equal(hasHit(g.state, hit.hitId, 'player'), true);

    // 판정하지 않는 경우(null · 레지스트리 등록 없음)
    const cases = [
      (c) => { c.state.mode = 'town'; },
      (c) => { c.fight.phase = 'intro'; },
      (c) => { c.fight.phase = 'outro'; },
      (c) => { c.boss.hp = 0; },
      (c) => { c.player.hp = 0; },
    ];
    for (const prep of cases) {
      const c = fightCtx();
      prep(c);
      const hpBefore = c.player.hp;
      const h = bossHit(c.state);
      assert.equal(resolveHitOnPlayer(c.ctx, h), null);
      assert.equal(c.player.hp, hpBefore);
      assert.equal(hasHit(c.state, h.hitId, 'player'), false);
      assert.equal(c.ctx.events.length, 0);
    }
  });

  test('빗나간 판정은 등록되지 않는다(다음 틱에 다시 본다)', () => {
    const { state, ctx } = fightCtx();
    const hit = bossHit(state, { shapeDef: { type: 'arc', r: 3, halfAngle: 1.2 } }); // 거리 6 — 닿지 않는다
    assert.equal(resolveHitOnPlayer(ctx, hit), null);
    assert.equal(hasHit(state, hit.hitId, 'player'), false);
    state.boss.pos.z = 2.5;
    hit.z = 2.5;
    assert.equal(resolveHitOnPlayer(ctx, hit).outcome, 'hit');
  });
});

describe('틱당 플레이어 피격 1회 (§5.1 I)', () => {
  test('같은 틱의 보스 타격 + active 장판 → HIT 1회, 건너뛴 판정은 레지스트리에 없다', () => {
    const { state, ctx, player } = fightCtx();
    const hz = spawnHazard(ctx, { ...PILLAR, warn: 0 }, 0, 0, 0, 1);
    assert.equal(hz.state, 'active');
    const first = resolveHitOnPlayer(ctx, bossHit(state));
    assert.equal(first.outcome, 'hit');
    resolveHazards(ctx);
    assert.equal(hits(ctx, 'player').length, 1);
    assert.equal(hasHit(state, hz.hitId, 'player'), false);
    assert.equal(player.hp, 80);

    // 다음 틱에 다시 본다 — 그때는 P1이 세운 무적/가드 상태가 적용된다(맞든 흘리든 등록된다).
    state.tick += 1;
    resolveHazards(ctx);
    assert.equal(hasHit(state, hz.hitId, 'player'), true);
    assertFiniteDeep(state);
  });

  test('같은 틱의 보스 타격 + 투사체 → 투사체는 남아 다음 틱을 기다린다', () => {
    const { state, ctx } = fightCtx();
    const pr = spawnProjectile(ctx, ORB, 0, 0.5, Math.PI, 1);
    resolveHitOnPlayer(ctx, bossHit(state));
    resolveProjectiles(ctx);
    assert.equal(hits(ctx, 'player').length, 1);
    assert.equal(state.projectiles.length, 1);
    assert.equal(hasHit(state, pr.hitId, 'player'), false);
    assert.equal(countEvents(ctx.events, EV.PROJECTILE_ENDED), 0);
  });

  test('dodge는 1회에 세지 않는다 — 흘린 뒤의 판정도 같은 틱에 본다', () => {
    const { state, ctx, player } = fightCtx();
    player.iframe = true;
    const a = bossHit(state);
    const b = bossHit(state);
    assert.equal(resolveHitOnPlayer(ctx, a).outcome, 'dodge');
    assert.equal(resolveHitOnPlayer(ctx, b).outcome, 'dodge');
    assert.equal(hasHit(state, b.hitId, 'player'), true);
  });
});

describe('투사체 패링 (§6.4 규칙 3)', () => {
  test('parryable 투사체를 패링 창에서 맞으면 소멸 · 체간 × projectileParryPostureMul · 보스 공격은 끊기지 않는다', () => {
    const { def, state, ctx, player, boss, fight } = fightCtx();
    boss.state = 'attack';
    boss.attack = attackRuntime(def);
    boss.postureIdle = 4;
    player.state = 'guard';
    player.guarding = true;
    player.parryActive = true;
    const pr = spawnProjectile(ctx, ORB, 0, 0.6, Math.PI, 1);
    resolveProjectiles(ctx);
    assert.equal(state.projectiles.length, 0);
    const ended = ctx.events.filter((e) => e.name === EV.PROJECTILE_ENDED);
    assert.equal(ended.length, 1);
    assert.equal(ended[0].payload.reason, 'parry');
    assert.equal(ended[0].payload.id, pr.id);
    near(boss.posture, player.stats.parryPosture * COMBAT.projectileParryPostureMul);
    assert.equal(boss.postureIdle, 0);
    assert.equal(player.hp, player.stats.hpMax);
    assert.equal(fight.parries, 1);
    const h = hits(ctx, 'player');
    assert.equal(h.length, 1);
    assert.equal(h[0].payload.outcome, 'parry');
    assert.equal(h[0].payload.source, 'projectile');
    assert.equal(h[0].payload.kind, 'void_orb');
    // onBossParried를 부르지 않았다 — 보스는 공격을 이어 간다.
    assert.equal(boss.state, 'attack');
    assert.ok(boss.attack);
    assert.equal(countEvents(ctx.events, EV.BOSS_ATTACK_END), 0);
    assertFiniteDeep(state);
  });

  test('parryable:false 투사체는 패링 창에서도 가드, 가드가 없으면 피격', () => {
    const a = fightCtx();
    a.player.state = 'guard';
    a.player.guarding = true;
    a.player.parryActive = true;
    spawnProjectile(a.ctx, { ...ORB, parryable: false }, 0, 0.6, Math.PI, 1);
    resolveProjectiles(a.ctx);
    assert.equal(a.ctx.events.find((e) => e.name === EV.PROJECTILE_ENDED).payload.reason, 'guard');
    assert.equal(a.boss.posture, 0);
    assert.equal(a.player.hp, a.player.stats.hpMax - Math.round(18 * 0.25));

    const b = fightCtx();
    spawnProjectile(b.ctx, { ...ORB, parryable: false }, 0, 0.6, Math.PI, 1);
    resolveProjectiles(b.ctx);
    assert.equal(b.ctx.events.find((e) => e.name === EV.PROJECTILE_ENDED).payload.reason, 'hit');
    assert.equal(b.player.hp, b.player.stats.hpMax - 18);
    assert.equal(b.state.projectiles.length, 0);
  });

  test('무적으로 흘린 투사체는 사라지지 않고 지나간다(다시 맞지도 않는다)', () => {
    const { state, ctx, player } = fightCtx();
    player.iframe = true;
    player.state = 'roll';
    spawnProjectile(ctx, ORB, 0, 0.6, Math.PI, 1);
    resolveProjectiles(ctx);
    assert.equal(state.projectiles.length, 1);
    assert.equal(countEvents(ctx.events, EV.PLAYER_DODGED), 1);
    player.iframe = false;
    player.state = 'idle';
    state.tick += 1;
    resolveProjectiles(ctx);
    assert.equal(state.projectiles.length, 1);
    assert.equal(player.hp, player.stats.hpMax);
  });
});

describe('플레이어 → 보스 (§6.4)', () => {
  /** 플레이어 (0, 0) facing 0, 보스를 (0, 2)로 당겨 놓는다. */
  function melee(opts) {
    const c = fightCtx(opts);
    c.boss.pos.z = 2;
    c.boss.prevPos.z = 2;
    return c;
  }
  const SWING = { type: 'arc', r: 2.6, halfAngle: 1.0 };

  test('명중: HP · damageDealt · 체간 누적 · postureIdle · HIT(kind = 무기 id) · 히트스톱', () => {
    const { def, state, ctx, boss, fight } = melee();
    boss.postureIdle = 3;
    const res = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, damage: 21.6, posture: 12, hitstop: 0.05 }));
    assert.equal(res.outcome, 'hit');
    assert.equal(res.target, 'boss');
    assert.equal(res.damage, 22);
    assert.equal(res.crit, false);
    assert.equal(res.posture, 12);
    assert.equal(res.postureBroken, false);
    assert.equal(res.lethal, false);
    assert.equal(res.kind, 'longsword');
    assert.equal(boss.hp, def.hp - 22);
    assert.equal(fight.damageDealt, 22);
    assert.equal(boss.posture, 12);
    assert.equal(boss.postureIdle, 0);
    assert.equal(state.hitstop, 0.05);
    assert.equal(hits(ctx, 'boss').length, 1);
    near(res.y, def.height * COMBAT.hitY.bossFrac);
    // 충돌 지점 = 보스 원의 플레이어 쪽 표면.
    near(res.x, 0);
    near(res.z, 2 - def.radius);
    near(res.dir, 0);
    assertFiniteDeep(state);
  });

  test('같은 hitId는 한 번만 · 닿지 않으면 null(등록 없음)', () => {
    const { state, ctx, boss, def } = melee();
    const hit = playerHit(state, { shapeDef: SWING });
    assert.ok(resolveHitOnBoss(ctx, hit));
    assert.equal(resolveHitOnBoss(ctx, hit), null);
    assert.equal(boss.hp, def.hp - 20);

    const far = fightCtx(); // 보스 (0, 6)
    const miss = playerHit(far.state, { shapeDef: SWING });
    assert.equal(resolveHitOnBoss(far.ctx, miss), null);
    assert.equal(hasHit(far.state, miss.hitId, 'boss'), false);
    // 등 뒤로 휘두르면 빗나간다.
    const back = melee();
    assert.equal(resolveHitOnBoss(back.ctx, playerHit(back.state, { shapeDef: SWING, facing: Math.PI })), null);
  });

  test('체간이 가득 차면 postureBroken · 상한에서 멈춘다', () => {
    const { state, ctx, boss } = melee();
    boss.posture = boss.postureMax - 5;
    const res = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, posture: 12 }));
    assert.equal(res.postureBroken, true);
    near(res.posture, 5);
    assert.ok(boss.posture <= boss.postureMax);
  });

  test('(W5) 한 타가 쌓는 체간은 postureMax × postureHitCap까지 — 빈 체간을 한 방에 채우지 못한다', () => {
    const { state, ctx, boss } = melee();
    const cap = boss.postureMax * COMBAT.postureHitCap;
    assert.ok(COMBAT.postureHitCap > 0 && COMBAT.postureHitCap < 1);
    const r1 = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, posture: boss.postureMax * 3 }));
    near(r1.posture, cap);
    near(boss.posture, cap);
    assert.equal(r1.postureBroken, false, '한 방으로는 그로기가 나지 않는다');
    assert.notEqual(boss.state, 'groggy');
    // 둘째 타격이 나머지를 채운다
    const r2 = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, posture: boss.postureMax * 3 }));
    near(r2.posture, boss.postureMax - cap);
    assert.equal(r2.postureBroken, true);
    // 상한 아래의 타격은 그대로 쌓인다
    const small = melee();
    const r3 = resolveHitOnBoss(small.ctx, playerHit(small.state, { shapeDef: SWING, posture: cap - 1 }));
    near(r3.posture, cap - 1);
  });

  test('(W5) 체간 잠금(postureGuard): 피해는 들어가고 체간은 쌓이지 않는다 — 패링 체간도 같다', () => {
    const { state, ctx, boss, def } = melee();
    boss.postureGuard = true;
    boss.postureIdle = 3;
    const res = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, damage: 20, posture: 12 }));
    assert.equal(res.outcome, 'hit');
    assert.equal(res.damage, 20);
    assert.equal(boss.hp, def.hp - 20);
    assert.equal(res.posture, 0);
    assert.equal(res.postureBroken, false);
    assert.equal(boss.posture, 0);
    assert.equal(boss.postureIdle, 3, '쌓이지 않았으면 감쇠 시계도 되돌리지 않는다');

    const p = fightCtx();
    p.boss.state = 'attack';
    p.boss.attack = attackRuntime(p.def);
    p.boss.postureGuard = true;
    Object.assign(p.player, { state: 'guard', guarding: true, parryActive: true, parryT: 0.1 });
    const parry = resolveHitOnPlayer(p.ctx, bossHit(p.state));
    assert.equal(parry.outcome, 'parry');
    assert.equal(parry.posture, 0);
    assert.equal(p.boss.posture, 0);

    // 잠금이 풀리면 다시 쌓인다
    boss.postureGuard = false;
    const again = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, damage: 20, posture: 12 }));
    assert.equal(again.posture, 12);
  });

  test('그로기 · 패링당한 보스에는 치명 배율, 그로기에는 체간이 더 쌓이지 않는다', () => {
    const g = melee();
    g.boss.state = 'groggy';
    g.boss.stateDur = g.def.groggyDur;
    g.boss.posture = g.boss.postureMax;
    const r1 = resolveHitOnBoss(g.ctx, playerHit(g.state, { shapeDef: SWING, damage: 20, posture: 12 }));
    assert.equal(r1.crit, true);
    assert.equal(r1.damage, Math.round(20 * g.player.stats.critMul));
    assert.equal(r1.posture, 0);
    assert.equal(r1.postureBroken, false);

    const p = melee();
    p.boss.state = 'parried';
    p.boss.stateDur = p.def.parriedDur;
    const r2 = resolveHitOnBoss(p.ctx, playerHit(p.state, { shapeDef: SWING, damage: 20, posture: 12 }));
    assert.equal(r2.crit, true);
    assert.equal(r2.damage, 25);
    assert.equal(r2.posture, 12);
  });

  test('invulnerable → immune: 피해 0 · 체간 0 · HIT는 낸다', () => {
    const { def, state, ctx, boss, fight } = melee();
    boss.invulnerable = true;
    const res = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING }));
    assert.equal(res.outcome, 'immune');
    assert.equal(res.damage, 0);
    assert.equal(res.posture, 0);
    assert.equal(boss.hp, def.hp);
    assert.equal(boss.posture, 0);
    assert.equal(fight.damageDealt, 0);
    assert.equal(hits(ctx, 'boss').length, 1);
    assert.equal(hits(ctx, 'boss')[0].payload.outcome, 'immune');
  });

  test('처형: 셰이프와 무관하게 명중 · 치명 배율 없음 · 체간 누적 없음 · executions', () => {
    const { def, state, ctx, boss, fight } = fightCtx(); // 보스 (0, 6) — 셰이프로는 닿지 않는다
    boss.state = 'groggy';
    boss.stateDur = def.groggyDur;
    boss.posture = boss.postureMax;
    const res = resolveHitOnBoss(ctx, playerHit(state, {
      attackId: 'execute', shapeDef: SWING, damage: 100, posture: 0, execute: true, heavy: true, hitstop: 0,
    }));
    assert.equal(res.outcome, 'hit');
    assert.equal(res.execute, true);
    assert.equal(res.crit, false);
    assert.equal(res.damage, 100);
    assert.equal(res.posture, 0);
    assert.equal(boss.hp, def.hp - 100);
    assert.equal(fight.executions, 1);
    assert.equal(state.hitstop, COMBAT.executeHitstop);
    assertFiniteDeep(state);
  });

  test('fight.damageDealt는 hpMax를 넘지 않는다 · 남은 HP만큼만 깎는다 · 쓰러진 보스는 더 맞지 않는다', () => {
    const { state, ctx, boss, fight } = melee();
    boss.hp = 30;
    fight.damageDealt = boss.hpMax - 30;
    const res = resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, damage: 80 }));
    assert.equal(res.damage, 30);
    assert.equal(res.lethal, true);
    assert.equal(boss.hp, 0);
    assert.equal(fight.damageDealt, boss.hpMax);
    const before = ctx.events.length;
    assert.equal(resolveHitOnBoss(ctx, playerHit(state, { shapeDef: SWING, damage: 80 })), null);
    assert.equal(ctx.events.length, before);
    assert.equal(fight.damageDealt, boss.hpMax);
    assertFiniteDeep(state);
  });

  test('bodyParts: 중심 원에서는 빗나가는 타격이 머리 원에는 맞는다', () => {
    const REACH = { type: 'arc', r: 3.2, halfAngle: 1.0 };
    // 중심 원만: 보스 (0, 6) 반경 0.8 → 표면까지 5.2m — 빗나간다.
    const plain = fightCtx();
    assert.equal(resolveHitOnBoss(plain.ctx, playerHit(plain.state, { shapeDef: REACH })), null);

    // 머리 원: 보스가 π(−Z)를 보므로 머리 = (0, 6 − 2.2), 반경 0.7 → 표면까지 3.1m — 맞는다.
    const def = makeSynthBossDef({ bodyParts: [{ fwd: 0, r: 0.8 }, { fwd: 2.2, r: 0.7 }, { fwd: -2.0, r: 0.7 }] });
    const long = fightCtx({ def });
    const res = resolveHitOnBoss(long.ctx, playerHit(long.state, { shapeDef: REACH }));
    assert.ok(res);
    assert.equal(res.outcome, 'hit');
    near(res.x, 0);
    near(res.z, 6 - 2.2 - 0.7); // 닿은 원(머리)의 공격자 쪽 표면
    assert.equal(long.boss.hp, def.hp - 20);
  });
});

describe('허수아비', () => {
  test('피해 기록 · HIT(target dummy) · 같은 휘두르기는 한 번', () => {
    const state = makeTestState();
    const ctx = makeTestCtx(state);
    const d = state.dummy;
    state.player.pos = { x: d.x, z: d.z - 1.5 };
    const hit = playerHit(state, { shapeDef: { type: 'arc', r: 2.6, halfAngle: 1.0 }, damage: 21.6 });
    const res = resolveHitOnDummy(ctx, hit);
    assert.equal(res.target, 'dummy');
    assert.equal(res.outcome, 'hit');
    assert.equal(res.damage, 22);
    assert.equal(res.y, COMBAT.hitY.dummy);
    assert.equal(d.lastDamage, 22);
    assert.equal(d.total, 22);
    assert.equal(d.sinceHit, 0);
    assert.equal(resolveHitOnDummy(ctx, hit), null);
    resolveHitOnDummy(ctx, playerHit(state, { shapeDef: { type: 'arc', r: 2.6, halfAngle: 1.0 }, damage: 10 }));
    assert.equal(d.lastDamage, 10);
    assert.equal(d.total, 32);
    assert.equal(hits(ctx, 'dummy').length, 2);
    assertFiniteDeep(state);
  });
});

describe('히트스톱 요청 · 판정 등록부', () => {
  test('ctx.requestHitstop: max 병합 · 상한 COMBAT.hitstopMax', () => {
    const { sim, log } = makeSim();
    const ctx = sim._ctx;
    ctx.requestHitstop(0.05);
    assert.equal(sim.state.hitstop, 0.05);
    ctx.requestHitstop(0.03);
    assert.equal(sim.state.hitstop, 0.05);
    ctx.requestHitstop(0.09);
    assert.equal(sim.state.hitstop, 0.09);
    ctx.requestHitstop(5);
    assert.equal(sim.state.hitstop, COMBAT.hitstopMax);
    ctx.requestHitstop(0);
    assert.equal(sim.state.hitstop, COMBAT.hitstopMax);
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(countEvents(log, EV.HITSTOP) >= 1);
    sim.dispose();
  });

  test('hitLog: 대상별 등록 · 길이 상한(앞에서 버린다)', () => {
    const state = makeTestState();
    markHit(state, 5, 'boss');
    assert.equal(hasHit(state, 5, 'boss'), true);
    assert.equal(hasHit(state, 5, 'player'), false);
    assert.equal(hasHit(state, 6, 'boss'), false);
    for (let i = 100; i < 100 + COMBAT.hitLogMax + 40; i++) markHit(state, i, 'player');
    assert.equal(state.hitLog.length, COMBAT.hitLogMax);
    assert.equal(hasHit(state, 5, 'boss'), false);
    assert.equal(hasHit(state, 100, 'player'), false);
    assert.equal(hasHit(state, 100 + COMBAT.hitLogMax + 39, 'player'), true);
    structuredClone(state);
  });
});

describe('투사체 (§6.4 「sim/projectiles.js」)', () => {
  test('스폰: 피해 배율 · prev = 현재 · PROJECTILE_SPAWNED', () => {
    const { state, ctx } = fightCtx();
    const p = spawnProjectile(ctx, ORB, 3, 4, 1, 1.5);
    assert.equal(state.projectiles[0], p);
    near(p.damage, 27);
    assert.equal(p.prevX, 3);
    assert.equal(p.prevZ, 4);
    assert.notEqual(p.id, p.hitId);
    const ev = ctx.events.find((e) => e.name === EV.PROJECTILE_SPAWNED).payload;
    assert.deepEqual(ev, { id: p.id, kind: 'void_orb', style: 'void', x: 3, z: 4, y: 1.2 });
  });

  test('유도 → 직선 전환', () => {
    const { state, ctx } = fightCtx(); // 플레이어 (0, 0)
    const p = spawnProjectile(ctx, { ...ORB, homing: 2.5, homingTime: 0.5, speed: 4 }, 8, 0, 0, 1);
    const dirs = [];
    for (let i = 0; i < 60; i++) {
      updateProjectiles(ctx, DT);
      dirs.push(p.dir);
    }
    // 유도 구간: 플레이어(−X) 쪽으로 매 틱 최대 homing × DT씩 돈다.
    assert.ok(dirs[0] < 0);
    near(Math.abs(dirs[0]), 2.5 * DT, 1e-9);
    assert.ok(Math.abs(dirs[20]) > Math.abs(dirs[5]));
    // homingTime(0.5초 = 30틱) 뒤로는 방향이 변하지 않는다.
    assert.equal(dirs[59], dirs[32]);
    assert.notEqual(dirs[29], dirs[25]);
    assert.equal(state.projectiles.length, 1);
    assertFiniteDeep(state);
  });

  test('플레이어 명중 → 소멸(reason hit) · 피해', () => {
    const { state, ctx, player } = fightCtx();
    spawnProjectile(ctx, ORB, 0, 3, Math.PI, 1);
    let ticks = 0;
    while (state.projectiles.length > 0 && ticks < 120) {
      updateProjectiles(ctx, DT);
      resolveProjectiles(ctx);
      state.tick += 1;
      ticks += 1;
    }
    assert.ok(ticks < 60);
    const ended = ctx.events.find((e) => e.name === EV.PROJECTILE_ENDED).payload;
    assert.equal(ended.reason, 'hit');
    assert.equal(player.hp, player.stats.hpMax - 18);
    assert.equal(hits(ctx, 'player').length, 1);
    assertFiniteDeep(state);
  });

  test('기둥 · 경계에 닿으면 소멸(reason wall) · 수명이 다하면 expire', () => {
    const def = makeSynthBossDef({ arenaId: 'arena_fenrir' }); // 기둥 (0, 15) r 1.3 · 경계 24
    const run = (x, z, dir, spec = ORB) => {
      const c = fightCtx({ def });
      c.player.pos = { x: -10, z: -10 };
      const p = spawnProjectile(c.ctx, { ...spec, speed: 10 }, x, z, dir, 1);
      for (let i = 0; i < 600 && c.state.projectiles.length > 0; i++) {
        updateProjectiles(c.ctx, DT);
        resolveProjectiles(c.ctx);
      }
      assert.equal(c.state.projectiles.length, 0);
      assertFiniteDeep(c.state);
      return { p, ended: c.ctx.events.find((e) => e.name === EV.PROJECTILE_ENDED).payload };
    };
    const pillar = run(0, 8, 0);
    assert.equal(pillar.ended.reason, 'wall');
    assert.ok(pillar.p.z < 15 && pillar.p.z > 15 - 1.3 - 0.35 - 0.2);

    const edge = run(0, -18, Math.PI);
    assert.equal(edge.ended.reason, 'wall');
    assert.ok(Math.hypot(edge.p.x, edge.p.z) > 24 - 0.35 - 0.2);

    const old = run(5, 0, Math.PI / 2, { ...ORB, life: 0.3 });
    assert.equal(old.ended.reason, 'expire');
    near(old.p.age, 0.3, DT);
  });

  test("clearProjectiles: 전부 'clear'로 제거", () => {
    const { state, ctx } = fightCtx();
    spawnProjectile(ctx, ORB, 5, 5, 0, 1);
    spawnProjectile(ctx, ORB, -5, 5, 0, 1);
    clearProjectiles(ctx);
    assert.equal(state.projectiles.length, 0);
    const ended = ctx.events.filter((e) => e.name === EV.PROJECTILE_ENDED);
    assert.equal(ended.length, 2);
    assert.ok(ended.every((e) => e.payload.reason === 'clear'));
  });
});

describe('장판 (§6.4 「sim/hazards.js」)', () => {
  test('warn → active → 제거 · 이벤트 3종 · 판정은 active에서만', () => {
    const { state, ctx, player } = fightCtx();
    const h = spawnHazard(ctx, PILLAR, 0, 0.5, 0, 1.2);
    assert.equal(state.hazards[0], h);
    assert.equal(h.state, 'warn');
    near(h.damage, 18);
    assert.deepEqual(h.shape, { type: 'circle', x: 0, z: 0.5, r: 2 });
    const spawned = ctx.events.find((e) => e.name === EV.HAZARD_SPAWNED).payload;
    assert.equal(spawned.id, h.id);
    assert.equal(spawned.warn, 0.5);
    assert.equal(spawned.active, 0.3);
    assert.deepEqual(spawned.shape, h.shape);

    let activatedAt = -1;
    let endedAt = -1;
    for (let i = 1; i <= 80; i++) {
      updateHazards(ctx, DT);
      resolveHazards(ctx);
      state.tick += 1;
      if (activatedAt < 0 && countEvents(ctx.events, EV.HAZARD_ACTIVATED) === 1) activatedAt = i;
      if (endedAt < 0 && countEvents(ctx.events, EV.HAZARD_ENDED) === 1) endedAt = i;
      if (activatedAt < 0) assert.equal(player.hp, player.stats.hpMax, 'warn 중에는 맞지 않는다');
    }
    assert.ok(Math.abs(activatedAt - 30) <= 1, `activatedAt ${activatedAt}`);
    assert.ok(Math.abs(endedAt - activatedAt - 18) <= 1, `endedAt ${endedAt}`);
    assert.equal(state.hazards.length, 0);
    assert.equal(ctx.events.find((e) => e.name === EV.HAZARD_ENDED).payload.reason, 'expire');
    // interval 0 — 한 번만 맞는다. 장판은 패링 불가 · source 'hazard'.
    assert.equal(hits(ctx, 'player').length, 1);
    assert.equal(hits(ctx, 'player')[0].payload.source, 'hazard');
    assert.equal(hits(ctx, 'player')[0].payload.kind, 'fire_pillar');
    assert.equal(player.hp, player.stats.hpMax - 18);
    assertFiniteDeep(state);
  });

  test('warn === 0이면 바로 active', () => {
    const { ctx } = fightCtx();
    const h = spawnHazard(ctx, { ...PILLAR, warn: 0 }, 9, 9, 0, 1);
    assert.equal(h.state, 'active');
    assert.deepEqual(ctx.events.map((e) => e.name), [EV.HAZARD_SPAWNED, EV.HAZARD_ACTIVATED]);
  });

  test('장판은 패링 창에서도 패링되지 않는다(가드는 된다)', () => {
    const { ctx, player, boss } = fightCtx();
    player.state = 'guard';
    player.guarding = true;
    player.parryActive = true;
    spawnHazard(ctx, { ...PILLAR, warn: 0 }, 0, 0.5, 0, 1);
    resolveHazards(ctx);
    assert.equal(hits(ctx, 'player')[0].payload.outcome, 'guard');
    assert.equal(boss.posture, 0);
  });

  test('(W5) 발밑에서 솟는 장판(원 · 캡슐)은 중심이 등 뒤에 있어도 가드로 받는다 — 밖에서 걸친 것과 띠는 방향을 본다', () => {
    const guard = (c) => Object.assign(c.player, { state: 'guard', guarding: true });
    // 원: 중심이 등 뒤 1m(플레이어는 +Z를 본다) — 플레이어 중심이 원(r 2) 안이다
    const a = fightCtx();
    guard(a);
    spawnHazard(a.ctx, { ...PILLAR, warn: 0 }, 0, -1, 0, 1);
    resolveHazards(a.ctx);
    assert.equal(hits(a.ctx, 'player')[0].payload.outcome, 'guard', '발밑의 원');
    assert.ok(a.player.stamina < a.player.stats.staminaMax);

    // 캡슐(불길 줄): 원점이 등 뒤 3m, 줄이 플레이어를 지나 앞으로 뻗는다
    const b = fightCtx();
    guard(b);
    spawnHazard(b.ctx, { ...PILLAR, warn: 0, shape: { type: 'capsule', fwd0: 1, fwd1: 9, r: 0.9 } }, 0, -3, 0, 1);
    resolveHazards(b.ctx);
    assert.equal(hits(b.ctx, 'player')[0].payload.outcome, 'guard', '발밑의 캡슐');

    // 원의 가장자리에만 걸쳤고(플레이어 중심은 원 밖) 중심이 등 뒤 → 종전대로 등 뒤 공격
    const c = fightCtx();
    guard(c);
    spawnHazard(c.ctx, { ...PILLAR, warn: 0 }, 0, -2.3, 0, 1);
    resolveHazards(c.ctx);
    assert.equal(hits(c.ctx, 'player')[0].payload.outcome, 'hit', '밖에서 걸친 원 · 등 뒤');
    // 같은 자리에서 중심이 앞이면 가드
    const d = fightCtx();
    guard(d);
    spawnHazard(d.ctx, { ...PILLAR, warn: 0 }, 0, 2.3, 0, 1);
    resolveHazards(d.ctx);
    assert.equal(hits(d.ctx, 'player')[0].payload.outcome, 'guard', '밖에서 걸친 원 · 정면');

    // 충격파 띠: 원점(보스 쪽)이 분명하다 — 등지고 있으면 띠가 몸 위를 지나가도 막지 못한다
    const e = fightCtx();
    guard(e);
    e.player.facing = 0;
    const WAVE = { kind: 'shockwave', style: 'fire', grow: { r0: 3, r1: 3, width: 1 }, warn: 0, active: 0.5, interval: 0, damage: 15, guardable: true, knockdown: false };
    spawnHazard(e.ctx, WAVE, 0, -3, 0, 1);   // 띠의 중심 반경 3m — 플레이어(원점에서 3m) 바로 위
    resolveHazards(e.ctx);
    assert.equal(hits(e.ctx, 'player')[0].payload.outcome, 'hit', '등 뒤에서 온 띠');
    const f = fightCtx();
    guard(f);
    spawnHazard(f.ctx, WAVE, 0, 3, 0, 1);
    resolveHazards(f.ctx);
    assert.equal(hits(f.ctx, 'player')[0].payload.outcome, 'guard', '정면에서 온 띠');

    // guardable:false 장판은 발밑이어도 그대로 맞는다
    const g = fightCtx();
    guard(g);
    spawnHazard(g.ctx, { ...PILLAR, warn: 0, guardable: false }, 0, -1, 0, 1);
    resolveHazards(g.ctx);
    assert.equal(hits(g.ctx, 'player')[0].payload.outcome, 'hit');
  });

  test('interval 반복: 간격마다 새 hitId', () => {
    const { state, ctx } = fightCtx();
    const h = spawnHazard(ctx, { ...PILLAR, warn: 0, active: 1.0, interval: 0.25 }, 9, 9, 0, 1);
    const ids = [h.hitId];
    const changedAt = [];
    for (let i = 1; i <= 70 && state.hazards.length > 0; i++) {
      updateHazards(ctx, DT);
      if (h.hitId !== ids[ids.length - 1]) {
        ids.push(h.hitId);
        changedAt.push(i);
      }
    }
    assert.equal(state.hazards.length, 0);
    assert.equal(ids.length, 4); // t = 0 · 0.25 · 0.5 · 0.75
    assert.equal(new Set(ids).size, 4);
    for (let k = 0; k < changedAt.length; k++) assert.ok(Math.abs(changedAt[k] - 15 * (k + 1)) <= 1, `${changedAt}`);
  });

  test('interval 장판 위에 서 있으면 간격마다 다시 판정된다', () => {
    const { state, ctx, player } = fightCtx();
    spawnHazard(ctx, { ...PILLAR, warn: 0, active: 1.0, interval: 0.25, damage: 5 }, 0, 0, 0, 1);
    for (let i = 0; i < 70; i++) {
      updateHazards(ctx, DT);
      // P1의 피격 무적과 무관하게 본다(P2의 규칙: hitId가 바뀌면 다시 맞는다).
      player.iframe = false;
      resolveHazards(ctx);
      state.tick += 1;
    }
    assert.equal(hits(ctx, 'player').length, 4);
    assert.equal(player.hp, player.stats.hpMax - 20);
  });

  test('grow: 띠의 중심 반경이 r0 → r1로 커진다', () => {
    const { state, ctx, player } = fightCtx();
    const grow = { r0: 1, r1: 9, width: 1.2 };
    const h = spawnHazard(ctx, {
      kind: 'shockwave', style: 'fire', warn: 0, active: 0.8, interval: 0, damage: 22, guardable: true, knockdown: true, grow,
    }, 0, 6, 0, 1);
    assert.equal(h.shape.type, 'ring');
    near(h.shape.rInner, 0.4);
    near(h.shape.rOuter, 1.6);
    const spawned = ctx.events.find((e) => e.name === EV.HAZARD_SPAWNED).payload;
    near(spawned.shape.rInner, 0.4);
    let hitAt = -1;
    const tickOnce = (i) => {
      updateHazards(ctx, DT);
      resolveHazards(ctx);
      state.tick += 1;
      if (hitAt < 0 && hits(ctx, 'player').length === 1) hitAt = i;
    };
    for (let i = 1; i <= 24; i++) tickOnce(i);
    // 0.4초(절반) — 중심 반경 5.
    near((h.shape.rInner + h.shape.rOuter) / 2, 5, 1e-6);
    near(h.shape.rOuter - h.shape.rInner, 1.2, 1e-9);
    // 생성 때의 payload는 그 뒤로 변하지 않는다(복사본).
    near(spawned.shape.rInner, 0.4);
    for (let i = 25; i <= 28; i++) tickOnce(i);
    // 플레이어(원점 · 거리 6): 바깥 반경이 5.6에 닿는 순간(중심 5.0 = 24틱 무렵) 맞는다. 넘어뜨린다.
    assert.ok(hitAt >= 23 && hitAt <= 25, `hitAt ${hitAt}`);
    assert.equal(hits(ctx, 'player')[0].payload.knockdown, true);
    assert.equal(player.hp, player.stats.hpMax - 22);
    for (let i = 0; i < 40; i++) updateHazards(ctx, DT);
    assert.equal(state.hazards.length, 0);
    assertFiniteDeep(state);
  });

  test('회전된 캡슐 장판(불길 줄)도 월드 모양 그대로 판정된다', () => {
    const { ctx, player } = fightCtx();
    player.pos = { x: 3, z: 0 };
    // 원점에서 +X 방향(facing π/2)으로 뻗은 줄 — 플레이어 (3, 0)을 지난다.
    spawnHazard(ctx, {
      kind: 'fire_trail', style: 'fire', shape: { type: 'capsule', fwd0: 0, fwd1: 6, r: 0.5 }, warn: 0, active: 1,
      interval: 0, damage: 9, guardable: false, knockdown: false,
    }, 0, 0, Math.PI / 2, 1);
    resolveHazards(ctx);
    assert.equal(hits(ctx, 'player').length, 1);
    assert.equal(player.hp, player.stats.hpMax - 9);
  });

  test("clearHazards: 전부 'clear'로 제거", () => {
    const { state, ctx } = fightCtx();
    spawnHazard(ctx, PILLAR, 5, 5, 0, 1);
    spawnHazard(ctx, { ...PILLAR, warn: 0 }, -5, 5, 0, 1);
    clearHazards(ctx);
    assert.equal(state.hazards.length, 0);
    const ended = ctx.events.filter((e) => e.name === EV.HAZARD_ENDED);
    assert.equal(ended.length, 2);
    assert.ok(ended.every((e) => e.payload.reason === 'clear'));
  });
});

describe('충돌 해소 (§5.1 G)', () => {
  test('플레이어만 보스에게서 밀린다', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const { player, boss } = sim.state;
    const bx = boss.pos.x;
    const bz = boss.pos.z;
    player.pos.x = bx + 0.3;
    player.pos.z = bz;
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(boss.pos.x, bx);
    assert.equal(boss.pos.z, bz);
    near(Math.hypot(player.pos.x - bx, player.pos.z - bz), boss.radius + player.radius, 1e-9);
    assert.ok(player.pos.x > bx);
    assertFiniteDeep(sim.state);
    sim.dispose();
  });

  test('bodyParts의 모든 원이 민다', () => {
    const def = makeSynthBossDef({ bodyParts: [{ fwd: 0, r: 0.8 }, { fwd: 2.2, r: 0.7 }, { fwd: -2.0, r: 0.7 }] });
    for (const fwd of [2.2, -2.0]) {
      const { sim } = makeSim();
      startNeutralFight(sim, def);
      const { player, boss } = sim.state;
      const cx = boss.pos.x + Math.sin(boss.facing) * fwd;
      const cz = boss.pos.z + Math.cos(boss.facing) * fwd;
      player.pos.x = cx + 0.2;
      player.pos.z = cz;
      sim.step(DT, NEUTRAL_INPUT);
      assert.ok(Math.hypot(player.pos.x - cx, player.pos.z - cz) >= 0.7 + player.radius - 1e-9, `fwd ${fwd}`);
      sim.dispose();
    }
  });

  test('죽은 보스는 밀지 않는다', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const { player, boss } = sim.state;
    boss.hp = 0;
    boss.state = 'dead';
    player.pos.x = boss.pos.x + 0.3;
    player.pos.z = boss.pos.z;
    sim.step(DT, NEUTRAL_INPUT);
    near(player.pos.x, boss.pos.x + 0.3);
    near(player.pos.z, boss.pos.z);
    sim.dispose();
  });

  test('벽 앞 플레이어 + 미는 보스 → 플레이어는 경계 안에 남는다(G4)', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const { player, boss, world } = sim.state;
    const limit = world.radius - player.radius;
    player.pos.x = 0;
    player.pos.z = limit;
    boss.pos.x = 0;
    boss.pos.z = limit - 0.5; // 플레이어를 벽 쪽으로 민다
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(Math.hypot(player.pos.x, player.pos.z) <= limit + 1e-9);
    // 보스도 자기 반경만큼 경계 안.
    assert.ok(Math.hypot(boss.pos.x, boss.pos.z) <= world.radius - boss.radius + 1e-9);
    stepN(sim, 5);
    assert.ok(Math.hypot(player.pos.x, player.pos.z) <= limit + 1e-9);
    assertFiniteDeep(sim.state);
    sim.dispose();
  });

  test('(W3) 돌진 중에는 옆으로 비켜 세운다 — 일직선의 플레이어를 밀고 가지 않는다', () => {
    const def = makeSynthBossDef();
    def.attacks.synth_charge = {
      ...structuredClone(def.attacks.synth_melee), id: 'synth_charge',
      windup: 0.6, active: 0.4, recovery: 1.0,
      move: { kind: 'charge', t0: 0, t1: 0.4, dist: 10 },
    };
    for (const offset of [0, 0.3, -0.3]) {
      const { sim } = makeSim();
      startNeutralFight(sim, def);
      const { player, boss } = sim.state;
      boss.pos.x = 0;
      boss.pos.z = 0;
      boss.facing = 0;                      // +Z로 돌진
      player.pos.x = offset;
      player.pos.z = 4;                     // 돌진선 위(또는 살짝 옆) 4m 앞
      const z0 = player.pos.z;
      boss.state = 'attack';
      boss.attack = { ...attackRuntime(def, 'synth_charge'), t: 0.6, phase: 'active' };
      const step = (10 / 0.4) * DT;         // 돌진 속력 25 m/s
      let maxSide = 0;
      for (let i = 0; i < 24; i++) {
        boss.pos.z += step;
        boss.attack.t += DT;
        const x0 = player.pos.x;
        sim.step(DT, NEUTRAL_INPUT);
        maxSide = Math.max(maxSide, Math.abs(player.pos.x - x0));
        near(player.pos.z, z0, 1e-9);       // 진행 방향으로는 한 치도 밀리지 않는다
      }
      assert.ok(maxSide <= COMBAT.chargeShoveSpeed * DT + 1e-9, `한 틱의 옆 이동 ${maxSide} ≤ chargeShoveSpeed × DT`);
      assert.ok(Math.abs(player.pos.x) > 0.5, `옆으로 비켜났다 (x ${player.pos.x.toFixed(2)})`);
      if (offset !== 0) assert.equal(Math.sign(player.pos.x), Math.sign(offset), '서 있던 쪽으로 비킨다');
      assert.ok(boss.pos.z > z0 + 4, '보스는 지나쳤다');
      assertFiniteDeep(sim.state);
      sim.dispose();
    }

    // 돌진이 아니면(같은 자리 · 같은 겹침) 평소대로 중심선 방향으로 밀어낸다
    const { sim } = makeSim();
    startNeutralFight(sim, def);
    const { player, boss } = sim.state;
    boss.pos.x = 0;
    boss.pos.z = 0;
    boss.facing = 0;
    player.pos.x = 0;
    player.pos.z = 0.6;
    sim.step(DT, NEUTRAL_INPUT);
    near(player.pos.x, 0);
    near(player.pos.z, boss.radius + player.radius, 1e-9);
    sim.dispose();
  });

  test('월드 콜라이더 · 허수아비가 플레이어를 민다(마을)', () => {
    const { sim } = makeSim();
    neutralize(sim);
    const { player, dummy, world } = sim.state;
    player.pos.x = dummy.x + 0.1;
    player.pos.z = dummy.z;
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(Math.hypot(player.pos.x - dummy.x, player.pos.z - dummy.z) >= dummy.radius + player.radius - 1e-9);
    player.pos.x = 0.2; // 화톳불 원(반경 0.9) 안
    player.pos.z = 0;
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(Math.hypot(player.pos.x, player.pos.z) >= 0.9 + player.radius - 1e-9);
    player.pos.x = 0;
    player.pos.z = -40; // 경계 밖
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(Math.hypot(player.pos.x, player.pos.z) <= world.radius - player.radius + 1e-9);
    assertFiniteDeep(sim.state);
    sim.dispose();
  });
});

test('makeTestStats 기본값이 이 파일의 산수와 맞는다', () => {
  const s = makeTestStats();
  assert.equal(s.guardReduction, 0.75);
  assert.equal(s.guardStaminaFactor, 0.9);
  assert.equal(s.parryPosture, 30);
  assert.equal(s.critMul, 1.25);
});
