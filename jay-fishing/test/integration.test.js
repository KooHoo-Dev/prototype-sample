// OWNER: 통합 게이트(W1 · W2) — 계약 §12.2(W1 확정). W2 의 P10 headless.test 가 더 넓게 덮으면 그쪽으로 옮겨도 된다.
// 패키지 테스트가 가짜로 바꿔 끼운 경계를 실제 구현끼리 맞물려 돈다: GameSim(P3) + rig(P1) + fight(P2) + progression(P4) + angler/policy(P1 · P2).
// 러너 규칙은 §6.8 · §12.4 그대로(명령은 step 전 · result 단계는 step 하지 않는다).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, RIG_PHASES, TICKS_PER_HOUR } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { SPOTS_BY_ID } from '../src/data/stages/index.js';
import { GameSim } from '../src/sim/GameSim.js';
import { createAngler } from '../src/bot/angler.js';
import { createBot } from '../src/bot/bot.js';
import { makeDevProfile } from '../src/sim/progression/profile.js';
import { createSaveData, parseSave, serializeSave } from '../src/sim/progression/save.js';
import { assertFiniteDeep, assertShape, randomInputs } from './helpers.js';

const BOT_COMMANDS = new Set(['keepCatch', 'releaseCatch', 'sellAll', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth', 'learnSkill', 'travel', 'waitNextBand', 'sleep', 'exitFishing']);

function makeSim(opts) {
  const bus = new EventBus();
  const log = [];
  /** @type {GameSim|null} */
  let sim = null;
  bus.onAny((name, payload) => log.push({ name, payload, tick: sim ? sim.state.tick : 0 }));
  sim = new GameSim({ bus, seed: 11, ...opts });
  sim.start();
  return { sim, log };
}
const count = (log, name) => log.filter(e => e.name === name).length;

/** 상태 모양(§3.4 — view · ui 가 읽는 필드가 실제 sim 에 있다) · 유한수 · 돈 */
function checkState(sim, where) {
  const s = sim.state;
  assertFiniteDeep(s, where);
  assert.ok(RIG_PHASES.includes(s.rig.phase), `${where}: phase ${s.rig.phase}`);
  assert.ok(s.profile.money >= 0, `${where}: 돈 음수`);
  assertShape(s.rig, 'RigState', where + '.rig');
  assertShape(s.player, 'PlayerState', where + '.player');
  if (s.fight) assertShape(s.fight, 'FightState', where + '.fight');
  if (s.pendingCatch) assertShape(s.pendingCatch, 'CatchRecord', where + '.pendingCatch');
}

/** §6.8 러너 */
function runBot(sim, bot, ticks, onTick) {
  let steps = 0;
  for (let d = 0; steps < ticks && d < ticks * 4; d++) {
    const a = bot.decide(sim.state, sim);
    if (a.command) {
      assert.ok(BOT_COMMANDS.has(a.command.name), a.command.name);
      const r = sim[a.command.name](...a.command.args);
      assert.ok(r && typeof r.ok === 'boolean', `${a.command.name} 결과 모양`);
    }
    if (sim.state.rig.phase === 'result') continue;
    sim.step(a.input);
    steps++;
    if (onTick) onTick(steps);
  }
  return steps;
}

test('핵심 루프: 실제 파이팅 위의 자리 봇 — 게임 2시간 · 입질 → 챔질 → 파이팅 → 결과/실패 → 보상 · 판매 · 집 · 수면 · 세이브 왕복', () => {
  const { sim, log } = makeSim({ start: { scene: 'lake', spotId: 'lake_gravel', hour: 6 } });
  const bot = createAngler({ strategy: 'basic', seed: 3, set: 'bottom', baitId: 'paste' });
  let up = 0;
  let down = 0;
  let prevDist = null;
  runBot(sim, bot, 2 * TICKS_PER_HOUR, (n) => {
    if (n % 600 === 0) checkState(sim, `@${n}`);
    const f = sim.state.fight;
    if (f && n % 30 === 0) {
      if (prevDist !== null) { if (f.dist - prevDist > 0.05) up++; if (f.dist - prevDist < -0.05) down++; }
      prevDist = f.dist;
    } else if (!f) prevDist = null;
  });
  checkState(sim, 'end');
  assert.ok(count(log, EV.HOOK_SET) >= 3, '챔질이 3번 미만');
  assert.ok(log.some(e => e.name === EV.FIGHT_END && e.payload.outcome === 'landed'), '랜딩 0');
  assert.ok(count(log, EV.CATCH_KEPT) + count(log, EV.CATCH_RELEASED) >= 1);
  assert.ok(count(log, EV.XP_GAINED) >= 1, '보상(경험치) 이벤트 0');
  assert.ok(up > 0 && down > 0, '파이팅 중 거리가 물고기 쪽(질주) · 플레이어 쪽(릴링) 양쪽으로 움직이지 않았다');

  const m0 = sim.state.profile.money;
  assert.equal(sim.exitFishing().ok, true);
  const quote = sim.getSellQuote().total;
  assert.equal(sim.sellAll().ok, true);
  assert.equal(sim.state.profile.money, m0 + quote);
  assert.equal(sim.travel('home').ok, true);
  assert.equal(sim.sleep().ok, true);
  checkState(sim, 'home');
  const { save, error } = parseSave(serializeSave(createSaveData(sim.state, 1)));
  assert.equal(error, null);
  const sim2 = new GameSim({ bus: new EventBus(), seed: save.seed, save });
  assert.deepEqual(sim2.state.profile, sim.state.profile);
});

test('두 끝 모두 도달: 무지성 손의 큰 잉어 → 실패 · 조절 손의 붕어 → 랜딩 → 결과', () => {
  const ends = { fail: 0, landed: 0 };
  for (const [strat, sp, pct, key] of [['mindless', 'carp', 0.99, 'fail'], ['controlled', 'crucian', 0.5, 'landed']]) {
    for (let i = 0; i < 8; i++) {
      const { sim, log } = makeSim({ seed: 100 + i, start: { scene: 'lake', spotId: 'lake_gravel', hour: 7 } });
      sim.debugForceFight(sp, pct);
      runBot(sim, createAngler({ strategy: strat, seed: 7 + i }), 60 * 200);
      const end = log.find(e => e.name === EV.FIGHT_END);
      assert.ok(end, `${strat}: 파이팅이 끝나지 않았다`);
      if (end.payload.outcome === 'landed') ends.landed++; else ends.fail++;
      checkState(sim, `${strat} ${i}`);
    }
  }
  assert.ok(ends.fail >= 1 && ends.landed >= 1, JSON.stringify(ends));
});

test('실패 → 재도전 2초(실제 applyLoss): 예비 스풀 · 로드 파손 → 예비 로드 · 낮춘 드랙', () => {
  const cases = {
    spareSpool: (sim) => { sim.state.profile.sets.float.lineM = 38; sim.ctx.refresh(); },
    rodBreak: (sim) => { sim.debugSetGear('line', 'line_3', 'float'); sim.debugSetGear('reel', 'reel_3', 'float'); sim.debugSetGear('rod', 'rod_float_2', 'float'); },
  };
  const seen = { spareSpool: 0, rodBreak: 0 };
  for (const [name, prep] of Object.entries(cases)) {
    for (let i = 0; i < 4; i++) {
      const { sim, log } = makeSim({ seed: 300 + i, session: { ignoreGates: true, devSession: true }, start: { scene: 'lake', spotId: 'lake_gravel', hour: 7 } });
      sim.state.profile.money = 0;
      prep(sim);
      const hand = createAngler({ strategy: 'mindless', seed: i });
      const caster = createAngler({ strategy: 'basic', seed: i });
      sim.debugForceFight('carp', 0.97);
      let failTick = -1;
      let castTick = -1;
      let loss = null;
      for (let k = 0; k < 60 * 300 && castTick < 0; k++) {
        const a = (failTick < 0 ? hand : caster).decide(sim.state, sim);
        if (a.command) sim[a.command.name](...a.command.args);
        if (sim.state.rig.phase === 'result') break;
        const n = log.length;
        sim.step(a.input);
        for (const e of log.slice(n)) {
          if (e.name === EV.FAIL && failTick < 0) { failTick = sim.state.tick; loss = e.payload.loss; }
          if (e.name === EV.CAST_RELEASE && failTick >= 0) castTick = sim.state.tick;
        }
      }
      assert.ok(loss, `${name}: 실패가 나지 않았다`);
      if (name === 'spareSpool' && loss.spareSpool) seen.spareSpool++;
      if (name === 'rodBreak' && loss.reason === 'rodBreak') {
        seen.rodBreak++;
        assert.ok(loss.rodLost && loss.dragKgAfter !== null);
      }
      assert.ok(castTick > 0, `${name}: 다시 던지지 못했다`);
      assert.ok((castTick - failTick) * DT <= 2.0 + 1e-9, `${name}: 재도전 ${((castTick - failTick) * DT).toFixed(2)}초`);
      checkState(sim, name);
    }
  }
  assert.ok(seen.spareSpool >= 1, '예비 스풀에 닿지 않았다');
  assert.ok(seen.rodBreak >= 1, '로드 파손에 닿지 않았다');
});

test('집 도착(실제 P4): 자동 판매 → line_1 무료 감기 → SAVE_REQUEST{scene} 순서 · 돈 = 견적', () => {
  const { sim, log } = makeSim({ start: { scene: 'lake', spotId: 'lake_gravel', hour: 9 } });
  for (let i = 0; i < 3; i++) { sim.debugSkipToResult('carp', 0.3 + i * 0.2); assert.equal(sim.keepCatch().ok, true); }
  sim.state.profile.sets.float.lineM = 50;
  sim.ctx.refresh();
  assert.equal(sim.exitFishing().ok, true);
  const quote = sim.getSellQuote().total;
  const m0 = sim.state.profile.money;
  const n = log.length;
  assert.equal(sim.travel('home').ok, true);
  const seq = log.slice(n);
  const iSold = seq.findIndex(e => e.name === EV.SOLD && e.payload.auto === true);
  const iLine = seq.findIndex(e => e.name === EV.LINE_REFILLED && e.payload.cost === 0);
  const iSave = seq.findLastIndex(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'scene');
  assert.ok(iSold >= 0 && iLine > iSold && iSave > iLine && iSave === seq.length - 1, seq.map(e => e.name).join(' → '));
  assert.equal(sim.state.profile.money, m0 + quote);
  assert.equal(sim.state.profile.hold.length, 0);
  assert.equal(sim.state.profile.sets.float.lineM, sim.getRigStats('float').spoolCapM);
});

test('파이팅 퍼즈: 아홉 자리 × 그 풀의 어종 × 1 · 3단계 로드 × 무작위 입력 — 예외 0 · NaN 0 · 상태 모양', () => {
  const outcomes = new Set();
  for (const spotId of Object.keys(SPOTS_BY_ID)) {
    const pool = SPOTS_BY_ID[spotId].pool.map(e => e.id);
    const { sim, log } = makeSim({ session: { ignoreGates: true, devSession: true }, start: { scene: spotId.split('_')[0], spotId, hour: 9 } });
    const gen = randomInputs(spotId.length * 7 + 1);
    let t = 0;
    for (let i = 0; i < 12; i++) {
      if (sim.state.rig.phase === 'result') sim.releaseCatch();
      for (let g = 0; !['ready', 'waiting'].includes(sim.state.rig.phase) && g < 600; g++) {
        if (sim.state.rig.phase === 'result') sim.releaseCatch();
        sim.step(NEUTRAL_INPUT);
      }
      sim.debugSetGear('rod', `rod_${sim.state.rig.set}_${i % 2 ? 3 : 1}`);
      sim.debugForceFight(pool[i % pool.length], (i * 0.137) % 1);
      for (let k = 0; k < 60 * 240 && sim.state.rig.phase === 'fighting'; k++) {
        sim.step(gen(t++));
        if (k % 600 === 0) checkState(sim, `${spotId} ${i}`);
      }
      checkState(sim, `${spotId} ${i} end`);
    }
    for (const e of log) if (e.name === EV.FIGHT_END) outcomes.add(e.payload.outcome);
  }
  for (const o of ['landed', 'lineBreak', 'hookOff', 'rodBreak']) assert.ok(outcomes.has(o), `퍼즈에서 ${o} 가 한 번도 나지 않았다`);
});

/**
 * app(Game) 규칙의 러너(W2 통합): travel · waitNextBand · sleep 은 전환 막 뒤에 실행된다(그동안 decide · step 없음) —
 * Game.travel 처럼 걷기 모드 · getTravel 로 먼저 거른다(거를 명령을 봇이 내면 실패). 결과 단계는 step 하지 않는다.
 */
function runApp(sim, bot, ticks, onTick, curtain = 40) {
  let steps = 0;
  for (let d = 0; steps < ticks && d < ticks * 4; d++) {
    const a = bot.decide(sim.state, sim);
    const c = a.command;
    if (c) {
      assert.ok(BOT_COMMANDS.has(c.name), c.name);
      if (['travel', 'waitNextBand', 'sleep'].includes(c.name)) {
        assert.equal(sim.state.player.mode, 'walk', `${c.name}: 걷기 모드가 아니다`);
        if (c.name === 'travel') {
          const t = sim.getTravel().find(e => e.id === c.args[0]);
          assert.ok(t && t.ok, `travel(${c.args[0]}): app 이 거절한다`);
        }
        d += curtain;                    // 막 — 그동안 sim 은 멈춘다
        const r = sim[c.name](...c.args);
        assert.ok(r && r.ok, `${c.name} 실패: ${r && r.reason}`);
        continue;
      }
      sim[c.name](...c.args);
    }
    if (sim.state.rig.phase === 'result') continue;
    sim.step(a.input);
    steps++;
    if (onTick) onTick(steps);
  }
  return steps;
}

test('W2: ?scene=<스테이지>&bot=1 의 계획 — 그 씬 spawn 에서 시작한 갯바위 · 강 하루 계획이 app 규칙(막 뒤 명령)으로 낚시 · 판매 · 집 · 수면 · 복귀', () => {
  for (const [scene, plan, level] of [['coast', 'coastDay', 6], ['river', 'riverDay', 12]]) {
    const profile = makeDevProfile({ level, money: 20000 });
    const { sim, log } = makeSim({ profile, session: { ignoreGates: true, devSession: true }, start: { scene, hour: 9 } });
    const bot = createBot({ strategy: 'controlled', seed: 7, plan });
    runApp(sim, bot, TICKS_PER_HOUR * 24, (n) => { if (n % 3000 === 0) checkState(sim, `${scene}@${n}`); });
    checkState(sim, `${scene} end`);
    const scenes = log.filter(e => e.name === EV.SCENE_CHANGED).map(e => e.payload.to);
    const landed = log.filter(e => e.name === EV.FIGHT_END && e.payload.outcome === 'landed').length;
    assert.ok(landed >= 5, `${scene}: 랜딩 ${landed}`);
    assert.ok(count(log, EV.SOLD) >= 1, `${scene}: 판매 0`);
    assert.ok(count(log, EV.XP_GAINED) >= landed, `${scene}: 랜딩 뒤 경험치`);
    assert.deepEqual(scenes.slice(0, 3), [scene, 'home', scene], `${scene}: ${scenes.join(' → ')}`);
    assert.equal(count(log, EV.CLOCK_DAY), 1, `${scene}: 날이 한 번 바뀌어야 한다`);
  }
});
