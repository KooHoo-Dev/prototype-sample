// OWNER: P10 — 계약 §12.4
// 헤드리스 봇 시나리오 H1–H5. 러너 규칙(§6.8 · §12.4): 명령은 step 전 · result 단계는 step 하지 않는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIG_PHASES, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { HOLD } from '../src/data/economy.js';
import { GameSim } from '../src/sim/GameSim.js';
import { EventBus } from '../src/core/events.js';
import { createSaveData, parseSave, serializeSave } from '../src/sim/progression/save.js';
import { createBot } from '../src/bot/bot.js';
import { absTick, createFightLog, makeSim, runBot } from '../scripts/measure.mjs';
import { assertFiniteDeep, randomInputs } from './helpers.js';

/** 상태 검사(600틱마다) */
function check(sim, where) {
  const s = sim.state;
  assertFiniteDeep(s, where);
  assert.ok(s.profile.money >= 0, `${where}: 돈 음수`);
  assert.ok(RIG_PHASES.includes(s.rig.phase), `${where}: phase ${s.rig.phase}`);
}

/**
 * H1 의 하루(새 프로필 · lakeDay · basic): 집 → 호수 → 낚시 · 판매 → 집 → 침대 → 다음 날 06:00.
 * stopAt(state) 가 참이면 그 자리에서 멈춘다(H4).
 */
function coreDay(seed, stopAt = null) {
  const fl = createFightLog();
  const ev = { scene: /** @type {string[]} */ ([]), day: 0, sold: 0, fail: 0, recastAfterFail: 0 };
  let failOpen = false;
  const { sim } = makeSim({ seed }, [fl.listener, (name, p) => {
    if (name === EV.SCENE_CHANGED) ev.scene.push(`${p.reason}:${p.to}`);
    if (name === EV.CLOCK_DAY) ev.day++;
    if (name === EV.SOLD) ev.sold++;
    if (name === EV.FAIL) { ev.fail++; failOpen = true; }
    if (name === EV.CAST_RELEASE && failOpen) { ev.recastAfterFail++; failOpen = false; }
  }]);
  const bot = createBot({ strategy: 'basic', seed, plan: 'lakeDay' });
  const t0 = absTick(sim.state.clock);
  let n = 0;
  runBot(sim, bot, {
    maxTicks: Math.ceil(TICKS_PER_DAY * 1.05),
    until: (s) => (stopAt ? stopAt(s) : absTick(s.clock) >= t0 + TICKS_PER_DAY && s.scene === 'home'),
    onTick: (sm) => { fl.onTick(sm); if (++n % 600 === 0) check(sm, `@${sm.state.tick}`); },
  });
  return { sim, bot, log: fl.log, ev, t0 };
}

test('H1 핵심 루프 완주: 새 프로필 · lakeDay · basic · 1 게임 일(집 → 호수 → 낚시 · 판매 → 집 → 침대 → 다음 날 06:00)', () => {
  const { sim, log, ev, t0 } = coreDay(11);
  check(sim, 'end');
  const s = sim.state;
  assert.equal(s.scene, 'home');
  // 수면 명령 뒤 그 틱의 step 하나(§6.8 러너 — 명령은 step 전)까지 — 다음 날 06:00
  assert.ok(absTick(s.clock) - (t0 + TICKS_PER_DAY) <= 1 && absTick(s.clock) >= t0 + TICKS_PER_DAY, `다음 날 06:00 에 끝나지 않았다: ${s.clock.day}일 ${s.clock.hour}`);
  const landed = log.fights.filter(f => f.outcome === 'landed').length;
  assert.ok(landed >= 25, `랜딩 ${landed}`);
  assert.ok(ev.sold >= 1, '판매 0');
  assert.ok(ev.fail >= 1 && ev.recastAfterFail >= 1, `실패 ${ev.fail} · 그 뒤 재캐스팅 ${ev.recastAfterFail}`);
  assert.ok(ev.scene.length >= 3, ev.scene.join(' → '));
  assert.deepEqual(ev.scene.slice(0, 2), ['start:home', 'travel:lake']);
  assert.ok(ev.scene.includes('travel:home'), ev.scene.join(' → '));
  assert.equal(ev.day, 1);
  assert.ok(s.profile.hold.length === 0, '집에 왔는데 어창이 비지 않았다');
});

test('H2 결정성: 같은 시드 · 같은 봇으로 0.25 게임 일 두 번 → 해시 같음 · 시드를 바꾸면 다름', () => {
  const run = (seed) => {
    const { sim } = makeSim({ seed });
    runBot(sim, createBot({ strategy: 'controlled', seed: 5, plan: 'lakeDay' }), { maxTicks: TICKS_PER_DAY / 4 });
    return sim.hash();
  };
  const a = run(42);
  assert.equal(run(42), a);
  assert.notEqual(run(43), a);
});

test('H3 무작위 입력 퍼즈: randomInputs 50,000틱 × 호수 자리 3곳 — 예외 0 · NaN 0 · 돈 ≥ 0 · phase ∈ RIG_PHASES', () => {
  for (const spotId of ['lake_shallows', 'lake_gravel', 'lake_cape']) {
    const { sim } = makeSim({ seed: spotId.length, start: { scene: 'lake', spotId, hour: 5 } });
    const gen = randomInputs(spotId.length * 31 + 7);
    for (let t = 0; t < 50000; t++) {
      const s = sim.state;
      if (s.rig.phase === 'result') {
        // 결과 단계는 명령으로만 풀린다(사람의 패널) — 어창이 차면 방생
        if (s.profile.hold.length < HOLD.capacity && t % 2 === 0) sim.keepCatch(); else sim.releaseCatch();
        continue;
      }
      sim.step(gen(t));
      if (t % 600 === 0) check(sim, `${spotId}@${t}`);
    }
    check(sim, `${spotId} end`);
  }
});

test('H4 세이브 왕복: H1 도중(정오) 저장 → parseSave → 새 GameSim → 같은 봇 — 프로필 동일 · 이어서 1시간 예외 0', () => {
  const { sim } = coreDay(13, (s) => s.clock.hour >= 12 && s.clock.day === 1);
  const saveText = serializeSave(createSaveData(sim.state, 1));
  const { save, error } = parseSave(saveText);
  assert.equal(error, null);
  const sim2 = new GameSim({ bus: new EventBus(), seed: save.seed, save });
  sim2.start();
  assert.deepEqual(sim2.state.profile, save.profile);
  if (sim.state.rig.phase !== 'result') assert.deepEqual(sim2.state.profile, sim.state.profile, '결과 대기가 아니면 프로필이 그대로');
  assert.equal(sim2.state.scene, sim.state.scene);
  const bot2 = createBot({ strategy: 'basic', seed: 13, plan: 'lakeDay' });
  const fl = createFightLog();
  let n = 0;
  const steps = runBot(sim2, bot2, { maxTicks: TICKS_PER_HOUR, onTick: (sm) => { fl.onTick(sm); if (++n % 600 === 0) check(sm, `load@${n}`); } });
  assert.equal(steps, TICKS_PER_HOUR);
  check(sim2, 'load end');
  assert.equal(sim2.state.player.mode, 'fish', '불러온 뒤 자리로 돌아가 낚시를 잇지 않았다');
});

/** 자리마다 세트 · 미끼 · 시각(그 자리 풀이 무는 때) */
const SPOT_RIG = {
  lake_shallows: ['float', 'worm', 7], lake_gravel: ['bottom', 'paste', 7], lake_cape: ['bottom', 'worm', 5],
  coast_shoal: ['float', 'krill', 8], coast_channel: ['float', 'krill', 6], coast_cape: ['bottom', 'shrimp', 21],
  river_tailrace: ['float', 'shrimp', 6], river_trench: ['bottom', 'live', 21], river_riffle: ['float', 'worm', 12],
};

test('H5 모든 자리: 9자리 × (1 · 3단계 장비) × 조절 봇 × 입질 30 — 예외 0 · NaN 0 · 자리마다 랜딩 ≥ 1', () => {
  const report = [];
  for (const [spotId, [set, bait, hour]] of Object.entries(SPOT_RIG)) {
    let landedSpot = 0;
    for (const tier of [1, 3]) {
      const fl = createFightLog();
      const { sim } = makeSim({ seed: 70 + tier, session: { ignoreGates: true, devSession: true }, start: { scene: spotId.split('_')[0], spotId, hour } }, [fl.listener]);
      for (const b of Object.keys(sim.state.profile.baits)) sim.state.profile.baits[b] = 9999;
      if (tier === 3) {
        for (const st of ['float', 'bottom']) {
          for (const [slot, id] of [['rod', `rod_${st}_3`], ['reel', 'reel_3'], ['line', 'line_3'], [st === 'float' ? 'float' : 'sinker', `${st === 'float' ? 'float' : 'sinker'}_3`]]) {
            assert.equal(sim.debugSetGear(slot, id, st).ok, true, `${slot} ${id}`);
          }
        }
      }
      const bot = createBot({ strategy: 'controlled', seed: tier, plan: 'stay', spotId, set: /** @type {any} */ (set), baitId: bait });
      let n = 0;
      runBot(sim, bot, {
        maxTicks: 30 * TICKS_PER_HOUR,
        until: () => fl.log.bites >= 30,
        onTick: (sm) => { fl.onTick(sm); if (++n % 600 === 0) check(sm, `${spotId} t${tier}@${n}`); },
      });
      check(sim, `${spotId} t${tier} end`);
      assert.ok(fl.log.bites >= 30, `${spotId} t${tier}: 입질 ${fl.log.bites}`);
      const landed = fl.log.fights.filter(f => f.outcome === 'landed').length;
      landedSpot += landed;
      report.push(`${spotId} t${tier} ${landed}/${fl.log.bites}`);
    }
    assert.ok(landedSpot >= 1, `${spotId}: 랜딩 0`);
  }
  console.log(`# H5 랜딩/입질: ${report.join(' · ')}`);
});
