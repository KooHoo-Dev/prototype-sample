// OWNER: P2 — 계약 §12.2 「gamesim.test.js」
// 이벤트 순서 · 플러시 재진입 · 히트스톱 틱 · 보스전 흐름 · 맞교환 · forfeit · 텔레그래프 · 마을 · world 검사 · 결정성.
// P1 · P3의 틱 진입점은 GameSim의 이음매(sim._ops)로 중립/합성 함수로 갈아 끼운다 — 스텁 위에서도 완성본 위에서도 통과한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { DT } from '../src/core/constants.js';
import { NEUTRAL_INPUT, makeInput } from '../src/core/inputFrame.js';
import { createRng } from '../src/core/rng.js';
import { circleOverlapsWorld, segmentHitsCircle } from '../src/core/collide.js';
import { resolveShape } from '../src/core/hitShapes.js';
import { COMBAT } from '../src/data/combat.js';
import { PLAYER } from '../src/data/player.js';
import { WORLDS } from '../src/data/world.js';
import { computeStatBlock } from '../src/sim/progression/stats.js';
import { assertFiniteDeep, countEvents, makeSynthBossDef, makeTestProfile } from './helpers.js';
import {
  bossHit, endIntro, makeSim, names, neutralize, payloads, playerHit, startNeutralFight, stepN,
} from './gamesim.fixtures.js';

const OUTRO_VICTORY_TICKS = Math.ceil(COMBAT.outroVictory / DT) + 2;
const OUTRO_DEATH_TICKS = Math.ceil(COMBAT.outroDeath / DT) + 2;

/** a가 b보다 먼저 나왔는가(둘 다 있어야 한다). */
function assertOrder(log, ...evNames) {
  let from = 0;
  for (const n of evNames) {
    const i = log.findIndex((e, k) => k >= from && e.name === n);
    assert.ok(i >= 0, `${n}이(가) ${evNames.join(' → ')} 순서로 나오지 않았다: ${names(log).join(', ')}`);
    from = i + 1;
  }
}

describe('생성 · 모드 전환', () => {
  test('생성자는 이벤트를 내지 않는다 · 생성 직후 마을', () => {
    const { sim, log } = makeSim();
    assert.deepEqual(log, []);
    const s = sim.state;
    assert.equal(s.mode, 'town');
    assert.equal(s.world, WORLDS.town);
    assert.equal(s.boss, null);
    assert.equal(s.fight, null);
    assert.ok(s.dummy);
    assert.equal(s.player.pos.x, WORLDS.town.playerSpawn.x);
    assert.equal(s.player.pos.z, WORLDS.town.playerSpawn.z);
    assert.equal(s.events.length, 0);
    structuredClone(s);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('startBossFight: MODE_CHANGED → FIGHT_STARTED → FIGHT_PHASE(→ LOCKON_CHANGED) · 록온이 켜진 채 시작', () => {
    const { sim, log, profile } = makeSim();
    const def = makeSynthBossDef();
    sim.startBossFight('valder', { def, hooks: {} });
    const s = sim.state;
    assert.equal(log[0].name, EV.MODE_CHANGED);
    assertOrder(log, EV.MODE_CHANGED, EV.FIGHT_STARTED, EV.FIGHT_PHASE);
    assert.deepEqual(payloads(log, EV.MODE_CHANGED)[0], { mode: 'boss', worldId: 'arena_valder', bossId: 'valder' });
    assert.deepEqual(payloads(log, EV.FIGHT_STARTED)[0], { bossId: 'valder', cycle: profile.cycle, hpMax: s.boss.hpMax });
    assert.deepEqual(payloads(log, EV.FIGHT_PHASE)[0], { phase: 'intro' });
    assert.equal(PLAYER.lockOn.autoOnFight, true);
    assert.equal(s.player.lockOn, true);
    assert.deepEqual(payloads(log, EV.LOCKON_CHANGED), [{ on: true }]);
    assert.equal(s.mode, 'boss');
    assert.equal(s.world, WORLDS.arena_valder);
    assert.equal(s.dummy, null);
    assert.equal(s.fight.phase, 'intro');
    assert.equal(s.fight.bossId, 'valder');
    assert.equal(s.player.pos.z, WORLDS.arena_valder.playerSpawn.z);
    assert.equal(s.boss.pos.z, WORLDS.arena_valder.bossSpawn.z);
    assert.equal(sim._ctx.bossDef, def);
    assert.equal(s.events.length, 0, '플러시 뒤 큐는 빈다');
    structuredClone(s);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('enterTown: MODE_CHANGED가 첫 이벤트 · 보스 · fight · hitLog · 투사체 · 장판 제거', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const ctx = sim._ctx;
    ctx.spawnProjectile({
      kind: 'void_orb', style: 'void', speed: 1, r: 0.3, life: 9, homing: 0, homingTime: 0, damage: 5,
      guardable: true, parryable: true, knockdown: false, y: 1,
    }, 0, 0, 0, 1);
    ctx.spawnHazard({
      kind: 'fire_pillar', style: 'fire', shape: { type: 'circle', r: 1 }, warn: 5, active: 1, interval: 0, damage: 5,
      guardable: true, knockdown: false,
    }, 3, 3, 0, 1);
    sim.state.hitLog.push({ hitId: 1, target: 'boss' });
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(sim.state.telegraphs.length, 1);
    log.length = 0;
    sim.enterTown();
    const s = sim.state;
    assert.equal(log[0].name, EV.MODE_CHANGED);
    assert.deepEqual(log[0].payload, { mode: 'town', worldId: 'town', bossId: null });
    assert.equal(s.mode, 'town');
    assert.equal(s.boss, null);
    assert.equal(s.fight, null);
    assert.equal(s.projectiles.length, 0);
    assert.equal(s.hazards.length, 0);
    assert.equal(s.telegraphs.length, 0);
    assert.equal(s.hitLog.length, 0);
    assert.ok(s.dummy);
    assert.equal(s.player.lockOn, false);
    assert.equal(s.player.hp, s.player.stats.hpMax);
    // 모드 전환의 일괄 정리는 'clear'(연출 없이 사라진다).
    assert.deepEqual(payloads(log, EV.PROJECTILE_ENDED).map((p) => p.reason), ['clear']);
    assert.deepEqual(payloads(log, EV.HAZARD_ENDED).map((p) => p.reason), ['clear']);
    assert.equal(sim._ctx.bossDef, null);
    assert.equal(sim._ctx.scaling.dmgMul, 1);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('보스전마다 난수 시드가 도전 횟수로 갈린다 · 같은 프로필/시드면 같은 시작 상태', () => {
    const a = makeSim({ seed: 42 });
    const b = makeSim({ seed: 42 });
    a.sim.startBossFight('valder');
    b.sim.startBossFight('valder');
    assert.equal(a.sim.state.rngState, b.sim.state.rngState);
    assert.equal(JSON.stringify(a.sim.state), JSON.stringify(b.sim.state));
    a.sim.dispose();
    b.sim.dispose();
  });
});

describe('플러시 재진입 (§4.1)', () => {
  test('INTERACT 리스너 안에서 restAtBonfire()를 불러도 각 1회만 발행된다', () => {
    const { sim, bus, log } = makeSim();
    neutralize(sim);
    let inner = 0;
    bus.on(EV.INTERACT, () => {
      inner += 1;
      sim.state.player.hp = 1;
      sim.restAtBonfire();
      // 안쪽 플러시는 큐에 쌓기만 한다 — 아직 발행되지 않았다.
      assert.equal(countEvents(log, EV.PLAYER_RESTED), 0);
    });
    sim.step(DT, makeInput({ interactPressed: true }));
    assert.equal(inner, 1);
    assert.equal(countEvents(log, EV.INTERACT), 1);
    assert.equal(countEvents(log, EV.PLAYER_RESTED), 1);
    assertOrder(log, EV.NEAR_FACILITY_CHANGED, EV.INTERACT, EV.PLAYER_RESTED);
    assert.equal(sim.state.player.hp, sim.state.player.stats.hpMax);
    assert.equal(sim.state.events.length, 0);
    assert.equal(sim._flushing, false);
    stepN(sim, 3);
    assert.equal(countEvents(log, EV.INTERACT), 1);
    assert.equal(countEvents(log, EV.PLAYER_RESTED), 1);
    sim.dispose();
  });

  test('리스너 안에서 모드를 바꿔도 이벤트가 사라지거나 두 번 나가지 않는다', () => {
    const { sim, bus, log } = makeSim();
    neutralize(sim);
    const def = makeSynthBossDef();
    bus.once(EV.INTERACT, () => sim.startBossFight('valder', { def, hooks: {} }));
    sim.step(DT, makeInput({ interactPressed: true }));
    assert.equal(countEvents(log, EV.INTERACT), 1);
    assert.equal(countEvents(log, EV.MODE_CHANGED), 1);
    assert.equal(countEvents(log, EV.FIGHT_STARTED), 1);
    assertOrder(log, EV.INTERACT, EV.MODE_CHANGED, EV.FIGHT_STARTED, EV.FIGHT_PHASE);
    assert.equal(sim.state.mode, 'boss');
    assert.equal(sim.state.events.length, 0);
    sim.dispose();
  });

  test('리스너 예외는 전파되고, 그 뒤에도 플러시가 막히지 않는다', () => {
    const { sim, bus, log } = makeSim();
    neutralize(sim);
    const off = bus.on(EV.PLAYER_RESTED, () => {
      throw new Error('boom');
    });
    assert.throws(() => sim.restAtBonfire(), /boom/);
    assert.equal(sim._flushing, false);
    off();
    sim.restAtBonfire();
    assert.equal(countEvents(log, EV.PLAYER_RESTED), 2);
    sim.dispose();
  });
});

describe('틱 순서 (§5.1)', () => {
  test('진입점 호출 순서: updatePlayer → updateBoss → getPlayerHit → getBossHits → getBossTelegraphs', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const calls = [];
    sim._ops.updatePlayer = (ctx, input, dt) => {
      calls.push('updatePlayer');
      assert.equal(ctx, sim._ctx);
      assert.equal(ctx.state, sim.state);
      assert.equal(dt, DT);
      assert.equal(input.sprint, true);
    };
    sim._ops.updateBoss = (ctx, dt) => {
      calls.push('updateBoss');
      assert.equal(dt, DT);
    };
    sim._ops.getPlayerHit = () => (calls.push('getPlayerHit'), null);
    sim._ops.getBossHits = () => (calls.push('getBossHits'), []);
    sim._ops.getBossTelegraphs = () => (calls.push('getBossTelegraphs'), []);
    sim._ops.bufferPlayerInput = () => calls.push('bufferPlayerInput');
    const before = { tick: sim.state.tick, time: sim.state.time };
    sim.step(DT, makeInput({ sprint: true }));
    assert.deepEqual(calls, ['updatePlayer', 'updateBoss', 'getPlayerHit', 'getBossHits', 'getBossTelegraphs']);
    assert.equal(sim.state.tick, before.tick + 1);
    assert.ok(Math.abs(sim.state.time - before.time - DT) < 1e-12);
    sim.dispose();
  });

  test('prev 복사: 위치 · 방향 · 보스 y · 투사체', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const { player, boss } = sim.state;
    const pr = sim._ctx.spawnProjectile({
      kind: 'void_orb', style: 'void', speed: 3, r: 0.3, life: 9, homing: 0, homingTime: 0, damage: 5,
      guardable: true, parryable: true, knockdown: false, y: 1,
    }, 5, 5, 0, 1);
    sim._ops.updatePlayer = (ctx) => {
      ctx.state.player.pos.x += 0.1;
      ctx.state.player.facing += 0.2;
    };
    sim._ops.updateBoss = (ctx) => {
      ctx.state.boss.pos.z -= 0.05;
      ctx.state.boss.y += 0.3;
      ctx.state.boss.facing -= 0.1;
    };
    const p0 = { x: player.pos.x, f: player.facing };
    const b0 = { z: boss.pos.z, y: boss.y, f: boss.facing };
    const z0 = pr.z;
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(player.prevPos.x, p0.x);
    assert.equal(player.prevFacing, p0.f);
    assert.ok(player.pos.x > p0.x);
    assert.equal(boss.prevPos.z, b0.z);
    assert.equal(boss.prevY, b0.y);
    assert.equal(boss.prevFacing, b0.f);
    assert.equal(pr.prevZ, z0);
    assert.ok(pr.z > z0);
    sim.dispose();
  });

  test('히트스톱 틱: time 정지 · prev = cur · 선입력(bufferPlayerInput)만 받는다', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    const calls = [];
    const buffered = [];
    sim._ops.updatePlayer = (ctx) => {
      calls.push('updatePlayer');
      ctx.state.player.pos.x += 0.5;
    };
    sim._ops.updateBoss = () => calls.push('updateBoss');
    sim._ops.bufferPlayerInput = (ctx, input, dt) => {
      calls.push('bufferPlayerInput');
      buffered.push(input);
      assert.equal(ctx, sim._ctx);
      assert.equal(dt, DT);
    };
    sim.step(DT, NEUTRAL_INPUT); // pos가 움직여 prev ≠ cur
    assert.notEqual(s.player.prevPos.x, s.player.pos.x);
    calls.length = 0;

    sim._ctx.requestHitstop(2.5 * DT); // 3틱
    const t0 = s.time;
    const tick0 = s.tick;
    const fightTime0 = s.fight.time;
    const light = makeInput({ lightPressed: true, lockOnPressed: true });
    sim.step(DT, light);
    assert.equal(s.time, t0);
    assert.equal(s.tick, tick0 + 1);
    assert.equal(s.fight.time, fightTime0);
    assert.equal(s.player.prevPos.x, s.player.pos.x);
    assert.equal(s.player.prevPos.z, s.player.pos.z);
    assert.equal(s.boss.prevPos.z, s.boss.pos.z);
    assert.deepEqual(calls, ['bufferPlayerInput']);
    assert.equal(buffered[0], light);
    sim.step(DT, NEUTRAL_INPUT);
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(s.hitstop, 0);
    assert.equal(s.time, t0);
    assert.deepEqual(calls, ['bufferPlayerInput', 'bufferPlayerInput', 'bufferPlayerInput']);
    // 히트스톱이 끝난 다음 틱부터 다시 흐른다.
    sim.step(DT, NEUTRAL_INPUT);
    assert.ok(s.time > t0);
    assert.deepEqual(calls.slice(3), ['updatePlayer', 'updateBoss']);
    assertFiniteDeep(s);
    sim.dispose();
  });
});

describe('보스전 흐름 (§5.1 J)', () => {
  test('인트로 → 교전: 보스가 intro를 벗어나거나 introDur가 지나면', () => {
    const def = makeSynthBossDef();
    const a = makeSim();
    neutralize(a.sim);
    a.sim.startBossFight('valder', { def, hooks: {} });
    stepN(a.sim, Math.floor(def.introDur / DT) - 2);
    assert.equal(a.sim.state.fight.phase, 'intro');
    assert.equal(a.sim.state.fight.time, 0);
    stepN(a.sim, 4);
    assert.equal(a.sim.state.fight.phase, 'fight');
    assert.deepEqual(payloads(a.log, EV.FIGHT_PHASE).map((p) => p.phase), ['intro', 'fight']);
    a.sim.dispose();

    const b = makeSim();
    neutralize(b.sim);
    b.sim.startBossFight('valder', { def, hooks: {} });
    b.sim.state.boss.state = 'idle';
    b.sim.step(DT, NEUTRAL_INPUT);
    assert.equal(b.sim.state.fight.phase, 'fight');
    b.sim.dispose();
  });

  test('격파: debugDamageBoss → BOSS_DEFEATED → REWARD_GRANTED → PROFILE_CHANGED → outro → FIGHT_ENDED', () => {
    const { sim, log, profile } = makeSim();
    const def = startNeutralFight(sim);
    const s = sim.state;
    s.fight.time = 30; // 이미 30초 싸웠다
    const ctx = sim._ctx;
    ctx.spawnProjectile({
      kind: 'void_orb', style: 'void', speed: 1, r: 0.3, life: 9, homing: 0, homingTime: 0, damage: 5,
      guardable: true, parryable: true, knockdown: false, y: 1,
    }, 8, 8, 0, 1);
    log.length = 0;

    sim.debugDamageBoss(def.hp * 10);
    assert.equal(s.boss.hp, 0);
    const hit = payloads(log, EV.HIT);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].target, 'boss');
    assert.equal(hit[0].damage, def.hp);
    assert.equal(hit[0].lethal, true);
    assert.equal(s.fight.damageDealt, s.boss.hpMax);
    assert.equal(s.fight.phase, 'fight', '승패는 다음 틱의 J가 HP로 판정한다');
    assert.equal(s.hitstop, 0);

    sim.step(DT, NEUTRAL_INPUT);
    assertOrder(log, EV.PROJECTILE_ENDED, EV.BOSS_DEFEATED, EV.REWARD_GRANTED, EV.PROFILE_CHANGED, EV.FIGHT_PHASE);
    assert.equal(payloads(log, EV.PROJECTILE_ENDED)[0].reason, 'clear');
    assert.deepEqual(payloads(log, EV.BOSS_DEFEATED)[0], { bossId: 'valder', x: s.boss.pos.x, z: s.boss.pos.z });
    assert.deepEqual(payloads(log, EV.PROFILE_CHANGED)[0], { reason: 'reward' });
    assert.equal(payloads(log, EV.FIGHT_PHASE).at(-1).phase, 'outro');
    assert.equal(countEvents(log, EV.PLAYER_DIED), 0);
    const reward = payloads(log, EV.REWARD_GRANTED)[0].reward;
    assert.equal(reward, s.fight.reward);
    assert.equal(reward.victory, true);
    assert.equal(reward.bossId, 'valder');
    assert.equal(reward.damageFraction, 1);
    assert.ok(Math.abs(reward.duration - (30 + DT)) < 1e-9);
    assert.equal(s.fight.outcome, 'victory');
    assert.equal(s.fight.phase, 'outro');
    assert.equal(s.projectiles.length, 0);
    assert.equal(countEvents(log, EV.CYCLE_ADVANCED), reward.cycleAdvanced ? 1 : 0);
    assert.equal(s.profile, profile);

    stepN(sim, OUTRO_VICTORY_TICKS - 10);
    assert.equal(s.fight.phase, 'outro');
    assert.equal(countEvents(log, EV.FIGHT_ENDED), 0);
    stepN(sim, 12);
    assert.equal(s.fight.phase, 'done');
    assertOrder(log, EV.REWARD_GRANTED, EV.FIGHT_PHASE, EV.FIGHT_ENDED);
    assert.equal(payloads(log, EV.FIGHT_PHASE).at(-1).phase, 'done');
    const ended = payloads(log, EV.FIGHT_ENDED);
    assert.equal(ended.length, 1);
    assert.equal(ended[0].bossId, 'valder');
    assert.equal(ended[0].outcome, 'victory');
    assert.equal(ended[0].reward, reward);
    assert.equal(ended[0].damageFraction, 1);
    assert.equal(ended[0].duration, s.fight.time);
    assert.equal(countEvents(log, EV.REWARD_GRANTED), 1);
    assert.equal(countEvents(log, EV.BOSS_DEFEATED), 1);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('사망: player.hp 0 → PLAYER_DIED → REWARD_GRANTED{victory:false} → outro → FIGHT_ENDED (HP 기준)', () => {
    const { sim, log } = makeSim();
    const def = startNeutralFight(sim);
    const s = sim.state;
    sim.debugDamageBoss(def.hp * 0.3);
    s.player.hp = 0;
    log.length = 0;
    sim.step(DT, NEUTRAL_INPUT);
    assertOrder(log, EV.PLAYER_DIED, EV.REWARD_GRANTED, EV.PROFILE_CHANGED, EV.FIGHT_PHASE);
    assert.deepEqual(payloads(log, EV.PLAYER_DIED)[0], { x: s.player.pos.x, z: s.player.pos.z, bossId: 'valder' });
    assert.equal(countEvents(log, EV.BOSS_DEFEATED), 0);
    const reward = s.fight.reward;
    assert.equal(reward.victory, false);
    assert.ok(Math.abs(reward.damageFraction - 0.3) < 1e-9);
    assert.equal(s.fight.outcome, 'death');
    assert.equal(s.fight.phase, 'outro');
    stepN(sim, OUTRO_DEATH_TICKS);
    assert.equal(s.fight.phase, 'done');
    const ended = payloads(log, EV.FIGHT_ENDED);
    assert.equal(ended.length, 1);
    assert.equal(ended[0].outcome, 'death');
    assert.equal(ended[0].reward, reward);
    assert.ok(Math.abs(ended[0].damageFraction - 0.3) < 1e-9);
    assert.equal(countEvents(log, EV.REWARD_GRANTED), 1);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('세 보스를 모두 잡은 보상이면 CYCLE_ADVANCED를 낸다(보상이 그렇게 말할 때만)', () => {
    const profile = makeTestProfile({ seed: 3 });
    for (const id of ['fenrir', 'nihil']) {
      profile.bosses[id].unlocked = true;
      profile.bosses[id].killsThisCycle = 1;
      profile.bosses[id].totalKills = 1;
    }
    const { sim, log } = makeSim({ profile });
    const def = startNeutralFight(sim);
    sim.debugDamageBoss(def.hp);
    sim.step(DT, NEUTRAL_INPUT);
    const reward = sim.state.fight.reward;
    assert.equal(reward.victory, true);
    assert.equal(countEvents(log, EV.CYCLE_ADVANCED), reward.cycleAdvanced ? 1 : 0);
    if (reward.cycleAdvanced) {
      assert.deepEqual(payloads(log, EV.CYCLE_ADVANCED)[0], { cycle: profile.cycle });
      assertOrder(log, EV.BOSS_DEFEATED, EV.REWARD_GRANTED, EV.PROFILE_CHANGED, EV.CYCLE_ADVANCED, EV.FIGHT_PHASE);
    }
    sim.dispose();
  });

  test('승리 틱에는 플레이어가 맞지 않는다', () => {
    // 대조군: 같은 보스 판정이 평소에는 맞는다.
    const c = makeSim();
    startNeutralFight(c.sim);
    c.sim._ops.getBossHits = () => [bossHit(c.sim.state)];
    c.log.length = 0;
    c.sim.step(DT, NEUTRAL_INPUT);
    assert.equal(payloads(c.log, EV.HIT).filter((h) => h.target === 'player').length, 1);
    c.sim.dispose();

    const { sim, log } = makeSim();
    const def = startNeutralFight(sim);
    const s = sim.state;
    sim._ops.getBossHits = () => [bossHit(s)];
    sim._ops.getPlayerHit = () => playerHit(s, { damage: def.hp * 2 });
    sim._ctx.spawnHazard({
      kind: 'fire_pillar', style: 'fire', shape: { type: 'circle', r: 3 }, warn: 0, active: 1, interval: 0, damage: 5,
      guardable: true, knockdown: false,
    }, s.player.pos.x, s.player.pos.z, 0, 1);
    log.length = 0;
    sim.step(DT, NEUTRAL_INPUT);
    const hit = payloads(log, EV.HIT);
    assert.equal(hit.filter((h) => h.target === 'boss').length, 1);
    assert.equal(hit.filter((h) => h.target === 'player').length, 0);
    assert.equal(s.player.hp, s.player.stats.hpMax);
    assert.equal(countEvents(log, EV.BOSS_DEFEATED), 1);
    assert.equal(countEvents(log, EV.PLAYER_DIED), 0);
    assert.equal(s.fight.outcome, 'victory');
    sim.dispose();
  });

  test('디버그로 둘 다 0이면 승리로 본다', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    sim.debugSetBossHpFraction(0);
    assert.equal(s.boss.hp, 0);
    s.player.hp = 0;
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(s.fight.outcome, 'victory');
    assert.equal(countEvents(log, EV.BOSS_DEFEATED), 1);
    assert.equal(countEvents(log, EV.PLAYER_DIED), 0);
    sim.dispose();
  });

  test('debugSetBossHpFraction은 hp만 바꾼다(이벤트 없음 · 범위 자르기)', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    log.length = 0;
    sim.debugSetBossHpFraction(0.4);
    assert.equal(s.boss.hp, Math.round(s.boss.hpMax * 0.4));
    sim.debugSetBossHpFraction(7);
    assert.equal(s.boss.hp, s.boss.hpMax);
    assert.equal(log.length, 0);
    assert.equal(s.fight.damageDealt, 0);
    sim.dispose();
  });

  test('맞교환: 같은 틱의 플레이어 타격이 보스 공격을 끊어도 그 틱에 수집한 보스 판정은 유효하다', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    // P3처럼: 체간이 가득 차면(그로기) 더는 판정을 내지 않는다.
    sim._ops.getBossHits = () => (s.boss.posture < s.boss.postureMax ? [bossHit(s)] : []);
    sim._ops.getPlayerHit = () => playerHit(s, { posture: s.boss.postureMax });
    s.boss.posture = s.boss.postureMax * 0.5; // (W5) 한 타는 postureMax × postureHitCap까지만 쌓는다 — 절반을 채워 둔다
    log.length = 0;
    sim.step(DT, NEUTRAL_INPUT);
    const hit = payloads(log, EV.HIT);
    const onBoss = hit.filter((h) => h.target === 'boss');
    const onPlayer = hit.filter((h) => h.target === 'player');
    assert.equal(onBoss.length, 1);
    assert.equal(onBoss[0].postureBroken, true);
    assert.equal(onPlayer.length, 1, '수집해 둔 보스 판정이 플레이어를 때린다');
    assert.equal(onPlayer[0].outcome, 'hit');
    assert.equal(s.player.hp, s.player.stats.hpMax - 20);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('보스 판정은 배열 순서대로, 틱당 플레이어 피격은 1회', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    const first = bossHit(s, { attackId: 'first', damage: 10 });
    const second = bossHit(s, { attackId: 'second', damage: 30 });
    sim._ops.getBossHits = () => [first, second];
    log.length = 0;
    sim.step(DT, NEUTRAL_INPUT);
    const onPlayer = payloads(log, EV.HIT).filter((h) => h.target === 'player');
    assert.equal(onPlayer.length, 1);
    assert.equal(onPlayer[0].attackId, 'first');
    assert.equal(s.player.hp, s.player.stats.hpMax - 10);
    assert.equal(s.hitLog.some((e) => e.hitId === second.hitId), false, '건너뛴 판정은 등록되지 않는다');
    sim.dispose();
  });

  test("fight.phase === 'done' 이후 세계 정지", () => {
    const { sim, log } = makeSim();
    const def = startNeutralFight(sim);
    const s = sim.state;
    sim.debugDamageBoss(def.hp);
    stepN(sim, OUTRO_VICTORY_TICKS + 2);
    assert.equal(s.fight.phase, 'done');
    const calls = [];
    sim._ops.updatePlayer = () => calls.push('updatePlayer');
    sim._ops.updateBoss = () => calls.push('updateBoss');
    sim._ops.bufferPlayerInput = () => calls.push('bufferPlayerInput');
    const snap = JSON.stringify({ ...s, tick: 0 });
    const tick0 = s.tick;
    log.length = 0;
    stepN(sim, 10, makeInput({ moveX: 1, lightPressed: true, rollPressed: true }));
    assert.equal(s.tick, tick0 + 10);
    assert.equal(JSON.stringify({ ...s, tick: 0 }), snap);
    assert.deepEqual(calls, []);
    assert.equal(log.length, 0);
    // 결과 화면에서 즉시 재도전 — 새 판이 깨끗하게 시작한다.
    sim.startBossFight('valder', { def, hooks: {} });
    assert.equal(s.fight.phase, 'intro');
    assert.equal(s.boss.hp, s.boss.hpMax);
    assert.equal(s.fight.damageDealt, 0);
    assert.equal(s.fight.reward, null);
    sim.dispose();
  });
});

describe('forfeitFight', () => {
  test('교전 중에만: 사망 보상 지급 · phase done · FIGHT_ENDED/PLAYER_DIED 없음', () => {
    const { sim, log, profile } = makeSim();
    const def = makeSynthBossDef();
    neutralize(sim);

    assert.equal(sim.forfeitFight(), null, '마을에서는 no-op');
    sim.startBossFight('valder', { def, hooks: {} });
    log.length = 0;
    assert.equal(sim.forfeitFight(), null, 'intro에서는 no-op');
    assert.equal(log.length, 0);
    assert.equal(sim.state.fight.phase, 'intro');

    startNeutralFight(sim, def);
    const s = sim.state;
    sim.debugDamageBoss(def.hp * 0.3);
    sim._ctx.spawnHazard({
      kind: 'fire_pillar', style: 'fire', shape: { type: 'circle', r: 1 }, warn: 5, active: 1, interval: 0, damage: 5,
      guardable: true, knockdown: false,
    }, 3, 3, 0, 1);
    const embersBefore = profile.embers;
    log.length = 0;
    const reward = sim.forfeitFight();
    assert.ok(reward);
    assert.equal(reward.victory, false);
    assert.ok(Math.abs(reward.damageFraction - 0.3) < 1e-9);
    assert.equal(s.fight.reward, reward);
    assert.equal(s.fight.outcome, 'death');
    assert.equal(s.fight.phase, 'done');
    assert.equal(s.hazards.length, 0);
    assert.equal(profile.embers, embersBefore + reward.embers);
    assertOrder(log, EV.HAZARD_ENDED, EV.REWARD_GRANTED, EV.PROFILE_CHANGED, EV.FIGHT_PHASE);
    assert.equal(payloads(log, EV.FIGHT_PHASE).at(-1).phase, 'done');
    assert.equal(payloads(log, EV.REWARD_GRANTED)[0].reward, reward);
    assert.equal(countEvents(log, EV.FIGHT_ENDED), 0);
    assert.equal(countEvents(log, EV.PLAYER_DIED), 0);
    assert.equal(s.events.length, 0);

    log.length = 0;
    assert.equal(sim.forfeitFight(), null, 'done에서는 no-op');
    stepN(sim, 5);
    assert.equal(log.length, 0);
    assert.equal(countEvents(log, EV.FIGHT_ENDED), 0);
    sim.dispose();
  });

  test('outro에서는 no-op', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    sim.state.player.hp = 0;
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(sim.state.fight.phase, 'outro');
    const n = countEvents(log, EV.REWARD_GRANTED);
    assert.equal(sim.forfeitFight(), null);
    assert.equal(countEvents(log, EV.REWARD_GRANTED), n);
    sim.dispose();
  });
});

describe('텔레그래프 (§5.1 L)', () => {
  test('보스 예고 표식: 월드로 풀려 나타나고 progress가 단조 증가, 끝나면 사라진다', () => {
    const { sim } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    const shapeDef = { type: 'capsule', fwd0: 0, fwd1: 20, r: 0.8 };
    let k = 0;
    sim._ops.getBossTelegraphs = () => {
      k += 1;
      if (k > 30) return [];
      return [{
        id: 'atk:1:0', shapeDef, x: s.boss.pos.x, z: s.boss.pos.z, facing: s.boss.facing, progress: k / 30, style: 'danger',
      }];
    };
    let last = -1;
    for (let i = 0; i < 30; i++) {
      sim.step(DT, NEUTRAL_INPUT);
      assert.equal(s.telegraphs.length, 1);
      const t = s.telegraphs[0];
      assert.equal(t.id, 'atk:1:0');
      assert.equal(t.source, 'boss');
      assert.equal(t.style, 'danger');
      assert.deepEqual(t.shape, resolveShape(shapeDef, s.boss.pos.x, s.boss.pos.z, s.boss.facing));
      assert.ok(t.progress > last && t.progress <= 1, `progress ${last} → ${t.progress}`);
      last = t.progress;
    }
    assert.equal(last, 1);
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(s.telegraphs.length, 0);
    structuredClone(s);
    sim.dispose();
  });

  test("warn 중인 장판: 'hz:<id>' · progress 0→1 · active가 되면 사라진다", () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    const h = sim._ctx.spawnHazard({
      kind: 'void_burst', style: 'void', shape: { type: 'circle', r: 2.5 }, warn: 0.5, active: 0.2, interval: 0, damage: 5,
      guardable: true, knockdown: false,
    }, 6, -6, 0, 1);
    let last = -1;
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      sim.step(DT, NEUTRAL_INPUT);
      const t = s.telegraphs.find((x) => x.id === `hz:${h.id}`);
      if (h.state === 'warn' && s.hazards.includes(h)) {
        assert.ok(t, `warn 중(${i})에는 표식이 있다`);
        assert.equal(t.source, 'hazard');
        assert.equal(t.style, 'void');
        assert.deepEqual(t.shape, { type: 'circle', x: 6, z: -6, r: 2.5 });
        assert.ok(t.progress > last && t.progress <= 1);
        last = t.progress;
        seen += 1;
      } else {
        assert.equal(t, undefined);
      }
    }
    assert.ok(seen >= 28 && seen <= 30, `seen ${seen}`);
    assert.ok(last > 0.9);
    assertOrder(log, EV.HAZARD_SPAWNED, EV.HAZARD_ACTIVATED, EV.HAZARD_ENDED);
    assert.equal(s.telegraphs.length, 0);
    sim.dispose();
  });
});

describe('마을 (§5.1 K)', () => {
  test('부활 지점에서 바로 bonfire · INTERACT · 재입력 간격', () => {
    const { sim, log } = makeSim();
    neutralize(sim);
    const s = sim.state;
    assert.equal(s.nearFacility, null);
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(s.nearFacility, 'bonfire');
    assert.deepEqual(payloads(log, EV.NEAR_FACILITY_CHANGED), [{ id: 'bonfire' }]);
    stepN(sim, 5);
    assert.equal(countEvents(log, EV.NEAR_FACILITY_CHANGED), 1, '바뀔 때만 낸다');
    assert.equal(countEvents(log, EV.INTERACT), 0);

    const press = makeInput({ interactPressed: true });
    sim.step(DT, press);
    assert.deepEqual(payloads(log, EV.INTERACT), [{ id: 'bonfire' }]);
    sim.step(DT, press);
    assert.equal(countEvents(log, EV.INTERACT), 1, 'interactCooldown 안의 연타는 무시한다');
    stepN(sim, Math.ceil(COMBAT.interactCooldown / DT) + 1);
    sim.step(DT, press);
    assert.equal(countEvents(log, EV.INTERACT), 2);
    sim.dispose();
  });

  test('시설 원 밖이면 null · 가장 가까운 시설', () => {
    const { sim, log } = makeSim();
    neutralize(sim);
    const s = sim.state;
    const at = (x, z) => {
      s.player.pos.x = x;
      s.player.pos.z = z;
      sim.step(DT, makeInput({ interactPressed: true }));
      stepN(sim, Math.ceil(COMBAT.interactCooldown / DT) + 1);
      return s.nearFacility;
    };
    assert.equal(at(0, 2.4), 'bonfire');
    assert.equal(at(0, 6), null);
    assert.equal(at(0, 11.5), 'gate');
    assert.equal(at(-6.5, 4), 'blacksmith');
    assert.equal(at(6.5, 4), 'merchant');
    assert.equal(at(-6, -3.5), null); // 허수아비 근처 — 상호작용 대상이 아니다
    assert.deepEqual(payloads(log, EV.INTERACT).map((p) => p.id), ['bonfire', 'gate', 'blacksmith', 'merchant']);
    assert.deepEqual(
      payloads(log, EV.NEAR_FACILITY_CHANGED).map((p) => p.id),
      ['bonfire', null, 'gate', 'blacksmith', 'merchant', null],
    );
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('보스전으로 떠나면 nearFacility가 비워진다(프롬프트가 남지 않는다)', () => {
    const { sim, log } = makeSim();
    neutralize(sim);
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(sim.state.nearFacility, 'bonfire');
    log.length = 0;
    sim.startBossFight('valder', { def: makeSynthBossDef(), hooks: {} });
    assert.equal(sim.state.nearFacility, null);
    assert.equal(log[0].name, EV.MODE_CHANGED);
    assert.deepEqual(payloads(log, EV.NEAR_FACILITY_CHANGED), [{ id: null }]);
    stepN(sim, 5, makeInput({ interactPressed: true }));
    assert.equal(countEvents(log, EV.INTERACT), 0, '보스 모드에는 K가 없다');
    sim.dispose();
  });

  test('허수아비 타격: HIT(target dummy) · 누적 · resetAfter 뒤 초기화 · 마을에서는 피해를 받지 않는다', () => {
    const { sim, log } = makeSim();
    neutralize(sim);
    const s = sim.state;
    s.player.pos.x = s.dummy.x;
    s.player.pos.z = s.dummy.z + 1.6;
    s.player.facing = Math.PI;
    const swing = { shapeDef: { type: 'arc', r: 2.6, halfAngle: 1.0 }, damage: 21.6, hitstop: 0.05 };
    let hit = playerHit(s, swing);
    sim._ops.getPlayerHit = () => hit;
    sim.step(DT, NEUTRAL_INPUT);
    const h = payloads(log, EV.HIT);
    assert.equal(h.length, 1);
    assert.equal(h[0].target, 'dummy');
    assert.equal(h[0].damage, 22);
    assert.equal(s.dummy.lastDamage, 22);
    assert.equal(s.dummy.total, 22);
    assert.ok(s.hitstop > 0, '허수아비도 히트스톱을 준다');
    // 같은 휘두르기(hitId)는 한 번만.
    stepN(sim, 8);
    assert.equal(countEvents(log, EV.HIT), 1);
    hit = playerHit(s, swing);
    stepN(sim, 8);
    assert.equal(s.dummy.total, 44);
    hit = null;
    stepN(sim, Math.ceil(COMBAT.dummy.resetAfter / DT) - 20);
    assert.equal(s.dummy.total, 44);
    stepN(sim, 40);
    assert.equal(s.dummy.total, 0);
    assert.equal(s.dummy.lastDamage, 22);
    // 마을에는 I2~I4가 없다.
    sim._ops.getBossHits = () => {
      throw new Error('마을에서는 보스 판정을 묻지 않는다');
    };
    sim.step(DT, NEUTRAL_INPUT);
    assert.equal(s.player.hp, s.player.stats.hpMax);
    assertFiniteDeep(s);
    sim.dispose();
  });

  test('PROFILE_CHANGED → 능력치 재계산 + HP 가득(마을에서만)', () => {
    const { sim, bus, profile } = makeSim();
    neutralize(sim);
    const s = sim.state;
    s.player.hp = 10;
    s.player.stamina = 5;
    s.player.flasks = 0;
    profile.stats.vit += 3;
    bus.emit(EV.PROFILE_CHANGED, { reason: 'levelUp' });
    assert.deepEqual(s.player.stats, computeStatBlock(profile));
    assert.equal(s.player.hp, s.player.stats.hpMax);
    assert.equal(s.player.stamina, s.player.stats.staminaMax);
    assert.equal(s.player.flasks, s.player.stats.flaskCharges);

    // 보스전 중에는 채우지 않는다.
    startNeutralFight(sim);
    s.player.hp = 10;
    bus.emit(EV.PROFILE_CHANGED, { reason: 'debug' });
    assert.equal(s.player.hp, 10);

    // dispose 뒤에는 구독이 끊긴다.
    sim.enterTown();
    s.player.hp = 10;
    sim.dispose();
    bus.emit(EV.PROFILE_CHANGED, { reason: 'levelUp' });
    assert.equal(s.player.hp, 10);
  });

  test('restAtBonfire는 마을에서만 · refreshStats(false)는 채우지 않는다', () => {
    const { sim, log } = makeSim();
    neutralize(sim);
    const s = sim.state;
    s.player.hp = 10;
    sim.refreshStats(false);
    assert.equal(s.player.hp, 10);
    sim.refreshStats(true);
    assert.equal(s.player.hp, s.player.stats.hpMax);
    s.player.hp = 10;
    s.player.flasks = 0;
    sim.restAtBonfire();
    assert.equal(s.player.hp, s.player.stats.hpMax);
    assert.equal(s.player.flasks, s.player.stats.flaskCharges);
    assert.equal(countEvents(log, EV.PLAYER_RESTED), 1);

    startNeutralFight(sim);
    s.player.hp = 10;
    sim.restAtBonfire();
    assert.equal(s.player.hp, 10);
    assert.equal(countEvents(log, EV.PLAYER_RESTED), 1);
    sim.dispose();
  });

  test('setDebug는 state.debug에 반영된다 · godMode면 맞지 않는다', () => {
    const { sim, log } = makeSim();
    startNeutralFight(sim);
    const s = sim.state;
    sim.setDebug({ godMode: true });
    assert.deepEqual(s.debug, { godMode: true, noStamina: false });
    sim._ops.getBossHits = () => [bossHit(s)];
    stepN(sim, 5);
    assert.equal(s.player.hp, s.player.stats.hpMax);
    assert.equal(payloads(log, EV.HIT).filter((h) => h.target === 'player').length, 0);
    sim.setDebug({ godMode: false, noStamina: true });
    assert.deepEqual(s.debug, { godMode: false, noStamina: true });
    sim.dispose();
  });
});

describe('data/world.js 검사 (§6.4 · §7.8)', () => {
  test('스폰 · 허수아비는 콜라이더에서 1m 이상 · 두 스폰 사이 시선이 비어 있다', () => {
    assert.deepEqual(Object.keys(WORLDS), ['town', 'arena_valder', 'arena_fenrir', 'arena_nihil']);
    for (const [id, w] of Object.entries(WORLDS)) {
      const pad = PLAYER.radius + 1;
      assert.equal(circleOverlapsWorld(w.playerSpawn.x, w.playerSpawn.z, pad, w), false, `${id}.playerSpawn`);
      if (w.bossSpawn) assert.equal(circleOverlapsWorld(w.bossSpawn.x, w.bossSpawn.z, pad, w), false, `${id}.bossSpawn`);
      if (w.dummy) assert.equal(circleOverlapsWorld(w.dummy.x, w.dummy.z, pad, w), false, `${id}.dummy`);
      if (w.bossSpawn) {
        for (const c of w.colliders) {
          if (c.type !== 'circle') continue;
          const t = segmentHitsCircle(w.playerSpawn.x, w.playerSpawn.z, w.bossSpawn.x, w.bossSpawn.z, c.x, c.z, c.r);
          assert.equal(t, null, `${id}: 스폰 사이 시선을 기둥 (${c.x.toFixed(1)}, ${c.z.toFixed(1)})이 막는다`);
        }
      }
      for (const c of w.colliders) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z));
      assertFiniteDeep(w, id);
    }
  });

  test('§7.8의 값: 마을 배치 · 아레나 반경 · 기둥', () => {
    const t = WORLDS.town;
    assert.equal(t.kind, 'town');
    assert.equal(t.radius, 18);
    assert.deepEqual(t.playerSpawn, { x: 0, z: 2.4, facing: 0 });
    assert.deepEqual(t.facilities.map((f) => [f.id, f.x, f.z, f.r]), [
      ['bonfire', 0, 0, 2.6], ['blacksmith', -8, 5, 2.6], ['merchant', 8, 5, 2.6], ['gate', 0, 14, 3.2],
    ]);
    assert.deepEqual(t.dummy, { x: -6, z: -6 });
    assert.equal(t.colliders.length, 8);
    // (W3) 안개문 벽: 두 기둥 사이(안개 막)와 기둥 바깥을 한 줄로 막는 상자 — gate 시설 원 안에 중심이 있다
    const wall = t.colliders.filter((c) => c.type === 'box' && Math.hypot(c.x - 0, c.z - 14) < 3.2);
    assert.deepEqual(wall, [{ type: 'box', x: 0, z: 15.5, hw: 9.4, hd: 0.3 }]);
    assert.equal(t.bossSpawn, null);
    // 부활 지점은 화톳불 상호작용 원 안이다.
    assert.ok(Math.hypot(t.playerSpawn.x, t.playerSpawn.z) <= 2.6);

    assert.deepEqual([WORLDS.arena_valder.radius, WORLDS.arena_fenrir.radius, WORLDS.arena_nihil.radius], [20, 24, 22]);
    assert.equal(WORLDS.arena_valder.colliders.length, 0);
    assert.equal(WORLDS.arena_fenrir.colliders.length, 5);
    assert.equal(WORLDS.arena_nihil.colliders.length, 4);
    for (const c of WORLDS.arena_fenrir.colliders) {
      assert.ok(Math.abs(Math.hypot(c.x, c.z) - 15) < 1e-9);
      assert.equal(c.r, 1.3);
    }
    for (const c of WORLDS.arena_nihil.colliders) {
      assert.ok(Math.abs(Math.hypot(c.x, c.z) - 11) < 1e-9);
      assert.equal(c.r, 1.0);
    }
    assert.ok(Math.abs(WORLDS.arena_fenrir.colliders[1].x - 14.27) < 0.05);
    assert.ok(Math.abs(WORLDS.arena_fenrir.colliders[1].z - 4.64) < 0.05);
    for (const id of ['arena_valder', 'arena_fenrir', 'arena_nihil']) {
      assert.equal(WORLDS[id].kind, 'arena');
      assert.equal(WORLDS[id].bossSpawn.facing, Math.PI);
      assert.equal(WORLDS[id].playerSpawn.facing, 0);
    }
  });
});

describe('안개문 뒤로 걸어 들어갈 수 없다 (W3)', () => {
  test('막을 향해 곧장 걸어도 · 기둥 바깥으로 돌아도 문 뒤(z > 15.5)에 닿지 못한다 · 문 앞에서는 gate가 잡힌다', () => {
    const wall = WORLDS.town.colliders.find((c) => c.type === 'box' && c.z === 15.5);
    const front = wall.z - wall.hd - PLAYER.radius;
    // 여러 x에서 북쪽으로 6초 걷는다(막 한가운데 · 기둥 옆 · 담 · 광장 가장자리)
    for (const x of [0, 1.2, -1.2, 3.6, -3.6, 6, -8, 9]) {
      const { sim } = makeSim();
      const p = sim.state.player;
      p.pos.x = x;
      p.pos.z = 12;
      p.prevPos.x = x;
      p.prevPos.z = 12;
      for (let i = 0; i < 360; i++) {
        sim.step(DT, { ...NEUTRAL_INPUT, moveX: 0, moveZ: 1 });
        assert.ok(p.pos.z <= front + 1e-6, `x ${x}: z ${p.pos.z.toFixed(2)} — 문 뒤로 넘어갔다`);
      }
      if (x === 0) assert.equal(sim.state.nearFacility, 'gate', '막 앞에 서면 안개문 상호작용이 잡힌다');
      assertFiniteDeep(sim.state);
    }
    // 가장자리를 따라 북동쪽으로 달려도(벽을 타고 미끄러져도) 넘지 못한다
    const { sim } = makeSim();
    const p = sim.state.player;
    p.pos.x = 12;
    p.pos.z = 8;
    for (let i = 0; i < 600; i++) {
      const a = Math.atan2(p.pos.x, p.pos.z);
      sim.step(DT, { ...NEUTRAL_INPUT, moveX: Math.sin(a) * 0.6 - Math.cos(a) * 0.8, moveZ: Math.cos(a) * 0.6 + Math.sin(a) * 0.8, sprint: true });
      // 담의 끝과 광장 경계가 만나는 구석에서는 두 해소가 번갈아 밀어 1~2cm 겹칠 수 있다 — 담의 앞면을 넘지만 않으면 된다
      assert.ok(p.pos.z < wall.z - wall.hd, `가장자리: z ${p.pos.z.toFixed(2)}`);
    }
  });
});

describe('결정성', () => {
  /** 시드에서 뽑은 입력 열(틱마다 같은 순서로 난수를 쓴다). */
  function inputScript(seed, n) {
    const rng = createRng(seed);
    const out = [];
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      if (i % 20 === 0) {
        const a = rng.range(-Math.PI, Math.PI);
        const l = rng.chance(0.8) ? 1 : 0;
        mx = Math.sin(a) * l;
        mz = Math.cos(a) * l;
      }
      out.push(makeInput({
        moveX: mx,
        moveZ: mz,
        sprint: rng.chance(0.2),
        guard: rng.chance(0.15),
        heavyHeld: rng.chance(0.1),
        lightPressed: rng.chance(0.08),
        heavyPressed: rng.chance(0.02),
        rollPressed: rng.chance(0.03),
        flaskPressed: rng.chance(0.005),
        lockOnPressed: rng.chance(0.004),
        interactPressed: rng.chance(0.01),
      }));
    }
    return out;
  }

  /**
   * P2만의 경로를 두루 밟는 합성 구동(충돌 · 투사체 · 장판 · 판정 · 텔레그래프 · 히트스톱).
   * 구동 함수의 내부 상태는 클로저에 둔다 — 두 실행이 같은 순서로 같은 난수를 쓴다.
   */
  function installSynthDrivers(sim) {
    const orb = {
      kind: 'void_orb', style: 'void', speed: 7, r: 0.35, life: 3, homing: 2, homingTime: 0.8, damage: 9,
      guardable: true, parryable: true, knockdown: false, y: 1.2,
    };
    const burst = {
      kind: 'void_burst', style: 'void', shape: { type: 'circle', r: 2.2 }, warn: 0.5, active: 0.4, interval: 0.2,
      damage: 6, guardable: true, knockdown: false,
    };
    const wave = {
      kind: 'shockwave', style: 'fire', warn: 0.3, active: 0.9, interval: 0, damage: 8, guardable: true, knockdown: true,
      grow: { r0: 1, r1: 14, width: 1.4 },
    };
    let swing = null;
    let melee = null;
    let k = 0;
    sim._ops.updatePlayer = (ctx, input, dt) => {
      const p = ctx.state.player;
      if (p.hp <= 0) return;
      p.state = 'idle';
      p.pos.x += input.moveX * 5 * dt;
      p.pos.z += input.moveZ * 5 * dt;
      p.iframe = input.rollPressed;
      p.guarding = input.guard;
      p.parryActive = input.guard && input.sprint;
      if (input.lightPressed) swing = { hitId: ctx.nextHitId(), left: 4 };
      else if (swing && --swing.left <= 0) swing = null;
    };
    sim._ops.bufferPlayerInput = () => {};
    sim._ops.getPlayerHit = (ctx) => (swing ? playerHit(ctx.state, {
      hitId: swing.hitId, shapeDef: { type: 'arc', r: 3, halfAngle: 1.3 }, damage: 17.5, posture: 7,
    }) : null);
    sim._ops.updateBoss = (ctx, dt) => {
      const { boss, player } = ctx.state;
      if (boss.hp <= 0) return;
      if (boss.state === 'intro') endIntro(boss);
      k += 1;
      const dx = player.pos.x - boss.pos.x;
      const dz = player.pos.z - boss.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      boss.facing = Math.atan2(dx, dz);
      boss.pos.x += (dx / d) * 2.5 * dt;
      boss.pos.z += (dz / d) * 2.5 * dt;
      if (melee && --melee.left <= 0) melee = null;
      if (k % 45 !== 0) return;
      switch (ctx.rng.int(0, 3)) {
        case 0:
          ctx.spawnProjectile(orb, boss.pos.x, boss.pos.z, boss.facing + ctx.rng.range(-0.4, 0.4), boss.dmgMul);
          break;
        case 1:
          ctx.spawnHazard(burst, player.pos.x + ctx.rng.range(-1, 1), player.pos.z + ctx.rng.range(-1, 1), 0, boss.dmgMul);
          break;
        case 2:
          ctx.spawnHazard(wave, boss.pos.x, boss.pos.z, boss.facing, boss.dmgMul);
          break;
        default:
          melee = { hitId: ctx.nextHitId(), left: 6 };
      }
    };
    sim._ops.getBossHits = (ctx) => (melee ? [bossHit(ctx.state, {
      hitId: melee.hitId, shapeDef: { type: 'arc', r: 3.6, halfAngle: 1.2 }, damage: 11, parryable: true,
    })] : []);
    sim._ops.getBossTelegraphs = (ctx) => (melee ? [{
      id: `atk:${melee.hitId}:0`, shapeDef: { type: 'arc', r: 3.6, halfAngle: 1.2 }, x: ctx.state.boss.pos.x,
      z: ctx.state.boss.pos.z, facing: ctx.state.boss.facing, progress: 1 - melee.left / 6, style: 'fire',
    }] : []);
  }

  function runSynth(seed) {
    const { sim, log } = makeSim({ profile: makeTestProfile({ seed: 11 }), seed });
    const def = makeSynthBossDef({ hp: 400, introDur: 0.2 });
    sim.startBossFight('valder', { def, hooks: {} });
    installSynthDrivers(sim);
    const script = inputScript(99, 600);
    for (let i = 0; i < 600; i++) {
      sim.step(DT, script[i]);
      if (i % 60 === 0) assertFiniteDeep(sim.state);
    }
    return { sim, log };
  }

  test('같은 시드 · 같은 입력 열 → 600틱 뒤 JSON.stringify(state)가 같다 (P2 경로 — 합성 구동)', () => {
    const a = runSynth(5);
    const b = runSynth(5);
    const ja = JSON.stringify(a.sim.state);
    assert.equal(ja, JSON.stringify(b.sim.state));
    assert.deepEqual(names(a.log), names(b.log));
    assert.equal(JSON.stringify(a.log.map((e) => e.payload)), JSON.stringify(b.log.map((e) => e.payload)));
    structuredClone(a.sim.state);
    assertFiniteDeep(a.sim.state);
    // 시나리오가 실제로 P2 경로를 밟았는가(공허한 통과 방지).
    for (const ev of [EV.HIT, EV.PROJECTILE_SPAWNED, EV.PROJECTILE_ENDED, EV.HAZARD_SPAWNED, EV.HAZARD_ACTIVATED, EV.HAZARD_ENDED]) {
      assert.ok(countEvents(a.log, ev) > 0, `${ev}가 한 번도 나오지 않았다`);
    }
    assert.ok(a.sim.state.fight.damageDealt > 0);
    assert.ok(a.sim.state.fight.damageTaken > 0);
    // 다른 시드면 난수 경로가 갈린다.
    const c = runSynth(6);
    assert.notEqual(JSON.stringify(c.sim.state), ja);
    a.sim.dispose();
    b.sim.dispose();
    c.sim.dispose();
  });

  test('같은 시드 · 같은 입력 열 → 600틱 뒤 JSON.stringify(state)가 같다 (실제 P1 · P3 · P4 위에서 — 마을 60틱 + 발더전)', () => {
    const run = () => {
      const { sim, log } = makeSim({ profile: makeTestProfile({ seed: 21 }) });
      const script = inputScript(1234, 600);
      for (let i = 0; i < 60; i++) sim.step(DT, script[i]);
      sim.startBossFight('valder');
      for (let i = 60; i < 600; i++) {
        sim.step(DT, script[i]);
        if (i % 60 === 0) assertFiniteDeep(sim.state);
      }
      return { sim, log };
    };
    const a = run();
    const b = run();
    assert.equal(JSON.stringify(a.sim.state), JSON.stringify(b.sim.state));
    assert.deepEqual(names(a.log), names(b.log));
    assert.equal(a.sim.state.tick, 600);
    structuredClone(a.sim.state);
    assertFiniteDeep(a.sim.state);
    assert.equal(a.sim.state.events.length, 0);
    a.sim.dispose();
    b.sim.dispose();
  });
});
