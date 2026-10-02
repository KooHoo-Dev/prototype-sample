// OWNER: P10 — 계약 §12.2(bot) · §12.1 · §6.8
// 봇이 사람과 같은 것만 하는가: 명령 목록 · 패널을 열 수 있는 상황 · 숨은 값 접근 · 전략별 손 · 손의 속도.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/core/constants.js';
import { BOT } from '../src/data/bot.js';
import { makeDevProfile } from '../src/sim/progression/profile.js';
import { makeFixtureState } from '../src/debug/fixtures.js';
import { createBot } from '../src/bot/bot.js';
import { createPlanner, equipWanted, nextPurchase, nextSkill } from '../src/bot/planner.js';
import { BOT_COMMANDS, makeSim, runBot } from '../scripts/measure.mjs';
import { makeTestRigStats } from './helpers.js';

/** 채비 패널(Tab)이 열리는 단계 — §10.2 */
const TACKLE_PHASES = ['ready', 'charging', 'waiting', 'retrieving', 'failed'];
/** 사람에게 보이지 않는 값(§12.1) — 경로 */
const HIDDEN = new Set(['state.rig.bite', 'state.fight.speciesId', 'state.fight.k', 'state.fight.brain', 'state.fight.stamina']);
/** 봇이 부르는 GameSim 조회(§6.8) */
const SIM_READS = new Set(['getRigStats', 'getShop', 'getTravel']);

/**
 * 상태를 감싸 접근 경로를 기록한다(살아 있는 상태를 그대로 비춘다 — 쓰기는 막는다).
 * @param {any} target @param {string} path @param {Set<string>} seen
 */
function spy(target, path, seen) {
  return new Proxy(target, {
    get(t, key, recv) {
      const v = Reflect.get(t, key, recv);
      if (typeof key !== 'string') return v;
      const p = `${path}.${key}`;
      if (HIDDEN.has(p)) seen.add(p);
      return v && typeof v === 'object' ? spy(v, p, seen) : v;
    },
    set(t, key) { throw new Error(`봇이 상태를 직접 썼다: ${path}.${String(key)}`); },
  });
}

/** GameSim 을 감싸 봇이 부른 것을 기록한다 @param {any} sim @param {Set<string>} used */
function simSpy(sim, used) {
  return new Proxy(sim, {
    get(t, key) {
      if (typeof key === 'string') used.add(key);
      const v = t[key];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/**
 * 봇을 돌리며 명령마다 그때의 상황을 검사한다(§6.8 「사람이 그 패널을 열 수 있는 상황에서만」).
 * @param {any} sim @param {any} bot @param {number} ticks
 */
function runChecked(sim, bot, ticks) {
  const hidden = new Set();
  const used = new Set();
  const cmds = {};
  const handSpeed = { maxAbs: 0, consecutive: 0 };
  let prevDrag = 0;
  const wrapped = {
    decide: (state, s) => {
      const a = bot.decide(spy(state, 'state', hidden), simSpy(s, used));
      const c = a.command;
      if (c) {
        assert.ok(BOT_COMMANDS.has(c.name), `목록 밖 명령 ${c.name}`);
        const st = sim.state;
        const p = st.player;
        const near = p.nearby ? p.nearby.kind : null;
        const ctx = `${c.name}(${JSON.stringify(c.args)}) — mode ${p.mode} · phase ${st.rig.phase} · nearby ${near} · scene ${st.scene}`;
        switch (c.name) {
          case 'keepCatch': case 'releaseCatch': assert.equal(st.rig.phase, 'result', ctx); break;
          case 'sellAll': case 'refillLine': assert.ok(p.mode === 'walk' && (near === 'npc' || near === 'pc'), ctx); break;
          case 'buy':
            assert.equal(p.mode, 'walk', ctx);
            if (String(c.args[0]).startsWith('bait_') || String(c.args[0]).startsWith('refill_')) assert.ok(near === 'npc' || near === 'pc', ctx);
            else assert.equal(near, 'pc', ctx);
            break;
          case 'equip': case 'learnSkill': case 'setBait': case 'setDepth':
            assert.ok(p.mode === 'walk' || TACKLE_PHASES.includes(st.rig.phase), ctx); break;
          case 'travel': assert.ok(p.mode === 'walk' && near === (st.scene === 'home' ? 'door' : 'camp'), ctx); break;
          case 'waitNextBand': assert.ok(p.mode === 'walk' && near === 'camp', ctx); break;
          case 'sleep': assert.ok(p.mode === 'walk' && near === 'bed', ctx); break;
          case 'exitFishing': assert.equal(p.mode, 'fish', ctx); break;
          default: break;
        }
        cmds[c.name] = (cmds[c.name] ?? 0) + 1;
      }
      const d = a.input.dragSteps;
      assert.ok(Number.isInteger(d), 'dragSteps 정수');
      handSpeed.maxAbs = Math.max(handSpeed.maxAbs, Math.abs(d));
      if (d !== 0 && prevDrag !== 0) handSpeed.consecutive++;
      prevDrag = d;
      return a;
    },
  };
  runBot(sim, wrapped, { maxTicks: ticks });
  return { hidden, used, cmds, handSpeed };
}

test('명령은 §6.8 목록뿐 · 그 패널을 열 수 있는 상황에서만 — lakeDay 하루(판매 · 미끼 · 캠프 · 집 · 침대)', () => {
  const { sim } = makeSim({ seed: 7 });
  const r = runChecked(sim, createBot({ strategy: 'basic', seed: 7, plan: 'lakeDay' }), 216000 + 4000);
  for (const name of ['travel', 'sleep', 'sellAll', 'exitFishing', 'keepCatch']) assert.ok(r.cmds[name] >= 1, `${name} 를 한 번도 내지 않았다: ${JSON.stringify(r.cmds)}`);
});

test('진행 봇: PC 구매 · 장착 · 스킬 · 라인 · 강의 바늘도 패널 규칙 안 — 레벨 12 · 돈 300만에서 반나절', () => {
  const profile = makeDevProfile({ level: 12, money: 3000000 });
  const { sim } = makeSim({ seed: 9, profile });
  const r = runChecked(sim, createBot({ strategy: 'controlled', seed: 9, plan: 'progress' }), 216000 / 2);
  for (const name of ['buy', 'equip', 'learnSkill', 'travel', 'refillLine']) assert.ok(r.cmds[name] >= 1, `${name} 를 한 번도 내지 않았다: ${JSON.stringify(r.cmds)}`);
  const p = sim.state.profile;
  const tier = (id) => Number(id.slice(-1));
  assert.ok(tier(p.sets.float.rod) >= 2 && tier(p.sets.bottom.rod) >= 2, `로드를 바꿔 끼우지 않았다: ${p.sets.float.rod} · ${p.sets.bottom.rod}`);
  assert.ok(tier(p.sets.float.reel) >= 2, `릴: ${p.sets.float.reel}`);
  assert.equal(sim.state.scene, 'river', '레벨 10 이상은 강으로 간다');
  for (const set of ['float', 'bottom']) assert.equal(p.sets[set].hook, BOT.plans.progress.riverHook, '강에서는 두 세트에 큰 바늘');
  assert.ok(p.skillPoints <= 1, `스킬 포인트를 쓰지 않았다: ${p.skillPoints}`);
});

test('진행 봇은 잃은 것을 되돌린다: 부러진 2단계 로드를 다시 사서 끼우고 · 예비 스풀로 내려간 라인을 산 것 중 최고 단계로 다시 감는다', () => {
  const profile = makeDevProfile({ level: 6, money: 200000 });
  Object.assign(profile.owned, { reel_2: 2, float_2: 1, rod_bottom_2: 1, sinker_2: 1 });   // rod_float_2 는 부러져 0
  Object.assign(profile.sets.float, { rod: 'rod_float_1', reel: 'reel_2', float: 'float_2', lineId: 'line_1', lineM: 200 });   // 예비 스풀
  Object.assign(profile.sets.bottom, { rod: 'rod_bottom_2', reel: 'reel_2', sinker: 'sinker_2', lineId: 'line_2', lineM: 200 });
  const { sim } = makeSim({ seed: 17, profile });
  const r = runChecked(sim, createBot({ strategy: 'controlled', seed: 17, plan: 'progress' }), 9000);
  const p = sim.state.profile;
  assert.equal(p.owned.rod_float_2, 1, JSON.stringify(r.cmds));
  assert.equal(p.sets.float.rod, 'rod_float_2');
  assert.equal(p.sets.float.lineId, 'line_2', '라인을 2단계로 다시 감지 않았다');
  assert.equal(sim.state.scene, 'coast', '레벨 5 이상은 갯바위로 간다');
});

test('숨은 값을 읽지 않는다(상태 프록시 — angler · policy 포함) · GameSim 은 getRigStats · getShop · getTravel 만', () => {
  for (const [strategy, plan] of [['basic', 'lakeDay'], ['controlled', 'lakeDay'], ['mindless', 'stay'], ['locked', 'stay']]) {
    const { sim } = makeSim({ seed: 21, start: plan === 'stay' ? { scene: 'lake', spotId: 'lake_gravel', hour: 7 } : undefined });
    const r = runChecked(sim, createBot({ strategy: /** @type {any} */ (strategy), seed: 2, plan: /** @type {any} */ (plan) }), 216000 / 4);
    assert.deepEqual([...r.hidden], [], `${strategy}: 숨은 값 접근 ${[...r.hidden].join(', ')}`);
    for (const k of r.used) assert.ok(SIM_READS.has(k), `${strategy}: GameSim.${k} 를 읽었다`);
    assert.ok(sim.state.profile.stats.landed >= 1, `${strategy}: 파이팅까지 가지 않았다`);
  }
});

test('손의 속도: |dragSteps| ≤ 1 · 연속 두 틱에 0 이 아닌 값 없음(네 전략 · 실제 파이팅)', () => {
  for (const strategy of ['basic', 'controlled', 'mindless', 'locked']) {
    const { sim } = makeSim({ seed: 33, start: { scene: 'lake', spotId: 'lake_gravel', hour: 6 } });
    const r = runChecked(sim, createBot({ strategy: /** @type {any} */ (strategy), seed: 4, plan: 'stay' }), 216000 / 6);
    assert.ok(r.handSpeed.maxAbs <= 1, `${strategy}: |dragSteps| ${r.handSpeed.maxAbs}`);
    assert.equal(r.handSpeed.consecutive, 0, `${strategy}: 연속 두 틱 드랙 조작 ${r.handSpeed.consecutive}번`);
  }
});

// ── 전략별 손(고정 상태 위의 단위 검사 — createBot → angler → policy 그대로)

/** 파이팅 고정 상태 + 그 위에서 n 틱 손을 본다(드랙 눈금은 하네스가 반영) */
function fightHarness(strategy, edit) {
  const state = makeFixtureState('fightRun');
  const rs = makeTestRigStats('bottom');
  edit(state);
  const sim = { getRigStats: () => rs, getShop: () => [], getTravel: () => [] };
  const bot = createBot({ strategy, seed: 1, plan: 'stay' });
  const ticks = [];
  return {
    state, rs,
    run(n, each) {
      for (let i = 0; i < n; i++) {
        if (each) each(state, i);
        const a = bot.decide(state, sim);
        state.rig.dragNotch = Math.max(0, Math.min(rs.dragNotches, state.rig.dragNotch + a.input.dragSteps));
        ticks.push(a.input);
      }
      return ticks;
    },
  };
}

test('basic: 드랙 = 라인 강도의 30%(가까운 눈금) 고정 · 텐션 50% 아래면 릴링 · 펌핑 없음', () => {
  const h = fightHarness('basic', (s) => { s.fight.behavior = 'rest'; s.rig.dragNotch = 15; });
  const want = Math.round(BOT.basic.dragRatio * h.state.fight.lineKg / h.rs.dragNotchKg);
  const t = h.run(60);
  assert.equal(h.state.rig.dragNotch, want);
  assert.ok(t.every(i => !i.secondary), '펌핑했다');
  h.state.fight.tension = 0.49 * h.state.fight.lineEffKg;
  assert.equal(h.run(1)[60].primary, true);
  h.state.fight.tension = 0.51 * h.state.fight.lineEffKg;
  assert.equal(h.run(1)[61].primary, false);
});

test('locked: 드랙 = 라인의 85% · 항상 릴링 · 펌핑 · 점프 대응 없음', () => {
  const h = fightHarness('locked', (s) => { s.fight.telegraph = { kind: 'jump', remaining: 0.5, total: 0.6 }; s.rig.dragNotch = 0; });
  const t = h.run(60);
  assert.equal(h.state.rig.dragNotch, Math.round(BOT.locked.dragRatio * h.state.fight.lineKg / h.rs.dragNotchKg));
  assert.ok(t.every(i => i.primary && !i.secondary));
});

test('mindless: 드랙 최대 · 항상 릴링 · 세우기 0.8초 / 숙이기 0.4초 반복', () => {
  const h = fightHarness('mindless', (s) => { s.rig.dragNotch = 0; });
  const [u0, d0] = BOT.mindless.pumpCycle;
  const t = h.run(Math.round(2 * (u0 + d0) / DT));      // 두 주기
  assert.equal(h.state.rig.dragNotch, h.rs.dragNotches);
  assert.ok(t.every(i => i.primary));
  const up = t.filter(i => i.secondary).length;
  const [u, d] = BOT.mindless.pumpCycle;
  assert.ok(Math.abs(up / t.length - u / (u + d)) < 0.05, `세운 비율 ${up / t.length}`);
});

test('controlled: 휴식 0.70 · 질주 0.45 · 장애물 0.80 × lineEffKg(로드 0.9 · 릴 최대 상한) · 패닉 · 펌핑 시작/멈춤 · 뜰채 반응', () => {
  const p = BOT.controlled;
  const target = (h, f) => Math.floor(Math.min(f * h.state.fight.lineEffKg, h.rs.reelMaxDragKg, p.rodCap * h.rs.rodMaxLoadKg) / h.rs.dragNotchKg);
  // 휴식(장애물 밖)
  let h = fightHarness('controlled', (s) => { s.fight.behavior = 'rest'; s.fight.inSnag = false; s.fight.tension = 0.3; s.rig.dragNotch = 0; });
  h.run(80);
  assert.equal(h.state.rig.dragNotch, target(h, p.restDrag));
  // 질주 중
  h = fightHarness('controlled', (s) => { s.fight.behavior = 'run'; s.fight.inSnag = false; s.fight.tension = 0.3; s.rig.dragNotch = 20; });
  h.run(80);
  assert.equal(h.state.rig.dragNotch, target(h, p.runDrag));
  // 장애물 띠
  h = fightHarness('controlled', (s) => { s.fight.behavior = 'rest'; s.fight.inSnag = true; s.fight.tension = 0.3; s.rig.dragNotch = 0; });
  h.run(80);
  assert.equal(h.state.rig.dragNotch, target(h, p.snagDrag));
  // 패닉: 텐션이 0.8 × lineEffKg 를 넘으면 푼다
  h = fightHarness('controlled', (s) => { s.fight.behavior = 'rest'; s.fight.inSnag = false; s.rig.dragNotch = 10; s.fight.tension = 0.95 * s.fight.lineEffKg; });
  h.run(6);
  assert.ok(h.state.rig.dragNotch < 10, '패닉에 드랙을 풀지 않았다');
  // 펌핑: 휴식 · 텐션 < 0.5 × min(eff, rodMax) · 숙인 상태 → 세움 / 텐션 > 0.8 × rodMax → 숙임
  h = fightHarness('controlled', (s) => { s.fight.behavior = 'rest'; s.fight.inSnag = false; s.fight.rodLift = 0; s.fight.tension = 0.2; });
  assert.equal(h.run(1)[0].secondary, true, '펌핑을 시작하지 않았다');
  h.state.fight.rodLift = 0.5;
  h.state.fight.tension = 0.85 * h.rs.rodMaxLoadKg;
  assert.equal(h.run(1)[1].secondary, false, '로드 한계 근처에서 숙이지 않았다');
  // 뜰채: canNet 을 BOT.netReact 동안 본 뒤 Space
  h = fightHarness('controlled', (s) => { s.fight.behavior = 'rest'; s.fight.canNet = true; });
  const t = h.run(Math.ceil(BOT.netReact / DT) + 2);
  const first = t.findIndex(i => i.hook);
  assert.ok(first >= Math.floor(BOT.netReact / DT) - 1 && first <= Math.ceil(BOT.netReact / DT) + 1, `뜰채 반응 ${first}틱`);
});

// ── 계획(순수 함수)

test('계획: skillOrder · buyOrder 는 프로필에서 다시 읽는다 — 부러진 로드는 buyOrder 보다 먼저 · 첫 reel_2 는 찌 · 첫 reel_3 은 바닥', () => {
  const p = makeDevProfile({ level: 12, money: 0 });
  assert.equal(nextSkill(p), BOT.plans.progress.skillOrder[0]);
  p.skills.hookset = 1;
  assert.equal(nextSkill(p), BOT.plans.progress.skillOrder[1]);
  p.skillPoints = 0;
  assert.equal(nextSkill(p), null);
  assert.equal(nextPurchase(p, 1), 'rod_float_2');
  Object.assign(p.owned, { rod_float_2: 1, reel_2: 2, float_2: 1, rod_bottom_2: 1, sinker_2: 1 });
  assert.equal(nextPurchase(p, 1), 'line_2', '라인은 산 적 있는 최고 단계로 본다');
  assert.equal(nextPurchase(p, 2), 'rod_bottom_3');
  p.owned.rod_float_2 = 0;                            // 부러졌다
  assert.equal(nextPurchase(p, 2), 'rod_float_2');
  p.owned.rod_float_2 = 1;
  p.owned.reel_3 = 1;
  p.sets.float.reel = 'reel_2';
  p.sets.bottom.reel = 'reel_2';
  const eq = equipWanted(p, null);
  assert.ok(eq.some(([s, slot, id]) => s === 'bottom' && slot === 'reel' && id === 'reel_3'), JSON.stringify(eq));
  assert.ok(!eq.some(([s, slot]) => s === 'float' && slot === 'reel'), JSON.stringify(eq));
  assert.throws(() => createPlanner(/** @type {any} */ ('nope')));
});
