// OWNER: P15 — 계약 §12.2 · §12.4 (headless.test.js — S1~S4 · S5 는 perf.test.js)
// 헤드리스 봇 시나리오 — 실제 GameSim(W1 sim) + 봇(P15) · P0 이벤트만(P9 를 기다리지 않는다). 시간은 틱으로 민다.
// S1 두 클래스: 새 캐릭터 → 마을 → 균열 1(basic 봇) 클리어(사망 ≤ 1) → 마을 정비(팔기 · 수리 · 장착 ≥ 1) → 균열 2 → 600틱 (300틱마다 불변식)
// S2 결정성: 같은 시드 · 같은 봇으로 균열 3판 → 상태 해시 같음 / 다른 시드 → 다름
// S3 퍼즈: 균열 3 에서 randomInputs 10,000틱 + 무작위 명령(장착 · 팔기 · 스킬) — 예외 · NaN · 불변식
// S4 새 캐릭터의 첫 사망 → 부활 → 복귀: 키 2번(Enter · Enter) + commit 만으로 다시 균열 · 그 사이 모달 안내 0 · 시스템 시간 1.3초 ≤ 1.7

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EQUIP_SLOTS } from '../src/core/constants.js';
import { EventBus, EV } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BOT_RULES } from '../src/data/bot.js';
import { DEATH } from '../src/data/combat.js';
import { nodesOf } from '../src/data/index.js';
import { Bot } from '../src/bot/bot.js';
import { runRift } from '../src/bot/measure.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { assertFiniteDeep, randomInputs } from './helpers.js';

const MIN = 30 * 60;

/** 실제 세션 · 이벤트 기록 @param {number} seed */
function newSim(seed) {
  const bus = new EventBus();
  /** @type {Array<{name:string, payload:any, tick:number}>} */
  const log = [];
  const sim = new GameSim({ bus, seed, devSession: true });
  bus.onAny((name, payload) => log.push({ name, payload, tick: sim.state.tick }));
  sim.start();
  return { sim, log };
}

/** 불변식 — 유한수 · 생명 · 자원 범위 · 골드 · 재료 정수 ≥ 0 · 아이템 ID 유일 · 살아 있는 몬스터는 걷기 가능 칸 @param {any} sim @param {string} why */
function invariants(sim, why) {
  const st = sim.state;
  assertFiniteDeep(st, why);
  const p = st.player;
  assert.ok(p.life >= 0 && p.life <= p.lifeMax + 1e-9, `${why}: 생명 ${p.life}/${p.lifeMax}`);
  assert.ok(p.resource >= 0 && p.resource <= p.resourceMax + 1e-9, `${why}: 자원 ${p.resource}/${p.resourceMax}`);
  const ch = st.char;
  if (ch) {
    assert.ok(Number.isInteger(ch.gold) && ch.gold >= 0, `${why}: 골드 ${ch.gold}`);
    for (const k of Object.keys(ch.materials)) assert.ok(Number.isInteger(ch.materials[k]) && ch.materials[k] >= 0, `${why}: 재료 ${k}`);
    const ids = new Set();
    const see = (it, where) => {
      if (!it) return;
      assert.ok(!ids.has(it.id), `${why}: 아이템 ID 중복 ${it.id}(${where})`);
      ids.add(it.id);
    };
    for (const s of EQUIP_SLOTS) see(ch.equip[s], 'equip');
    ch.bag.forEach((it) => see(it, 'bag'));
    st.account.stash.forEach((it) => see(it, 'stash'));
    ch.shop.blacksmith.forEach((it) => see(it, 'shop'));
    ch.shop.general.forEach((it) => see(it, 'shop'));
    ch.buyback.forEach((b) => see(b.item, 'buyback'));
  }
  if (st.scene === 'rift' && st.rift) {
    const map = sim.getMap();
    for (const m of st.rift.mons) {
      if (m.dead || m.gone || !(m.hp > 0)) continue;
      assert.ok(isWalkable(map, m.pos.x, m.pos.z), `${why}: 몬스터 ${m.id}(${m.typeId}) 가 막힌 칸 (${m.pos.x.toFixed(2)}, ${m.pos.z.toFixed(2)})`);
    }
  }
}

/** 봇 한 틱(autoCommit) */
function tick(sim, bot) {
  sim.step(bot.frame());
  bot.afterStep();
}

// S1 — 시드는 고정(결정적) · 두 클래스 모두 브리프 「처음 성공까지」(균열 1 첫 시도 · 사망 ≤ 1)
test('S1: 두 클래스 — 새 캐릭터 → 마을 → 균열 1 클리어(사망 ≤ 1) → 마을 정비(팔기 · 수리 · 장착 ≥ 1) → 균열 2 → 600틱 · 예외 0 · NaN 0 · 불변식', () => {
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 11], ['mage', 11]])) {
    const { sim, log } = newSim(seed);
    assert.equal(sim.newCharacter({ slot: 0, cls, name: cls }).ok, true);
    const bot = new Bot({ sim, cls, seed });
    const st = sim.state;
    let n = 0;
    // 균열 1 끝 → 마을
    while (n++ < MIN * 15) {
      tick(sim, bot);
      if (n % 300 === 0) invariants(sim, `${cls} 틱 ${st.tick}`);
      if (st.char.records.length && st.scene === 'town' && !st.pendingTravel) break;
    }
    const rec = st.char.records[0];
    const why = `${cls} 시드 ${seed}: ${JSON.stringify(rec && { level: rec.level, result: rec.result, timeSec: rec.timeSec, deaths: rec.deaths })}`;
    assert.ok(rec, why);
    assert.equal(rec.level, 1, why);
    assert.equal(rec.result, 'complete', why);
    assert.ok(rec.deaths <= 1, why);
    assert.ok(st.char.riftUnlocked >= 2, why);
    // 마을 정비 → 균열 2(두 번째 판은 2 로 고정 — 레벨 선택 규칙의 +1 은 6분 안이어야 한다)
    bot.levelOverride = 2;
    const damaged = EQUIP_SLOTS.some((s) => st.char.equip[s] && st.char.equip[s].dur < st.char.equip[s].durMax);
    const bagBefore = st.char.bag.filter(Boolean).length;
    n = 0;
    while (n++ < MIN * 2 && !(st.scene === 'rift' && st.rift && st.rift.level === 2)) {
      tick(sim, bot);
      if (n % 300 === 0) invariants(sim, `${cls} 마을 ${st.tick}`);
    }
    assert.equal(st.scene, 'rift', `${cls}: 균열 2 를 열었다`);
    assert.equal(st.rift.level, 2);
    const trades = log.filter((e) => e.name === EV.TRADE);
    if (bagBefore > 0) assert.ok(trades.some((t) => t.payload.kind === 'sellMany' || t.payload.kind === 'sell'), `${cls}: 팔기`);
    if (damaged) assert.ok(trades.some((t) => t.payload.kind === 'repair'), `${cls}: 수리`);
    assert.equal(EQUIP_SLOTS.some((s) => st.char.equip[s] && st.char.equip[s].dur < st.char.equip[s].durMax), false, `${cls}: 수리 뒤 내구도 가득`);
    assert.ok(log.filter((e) => e.name === EV.EQUIPPED).length >= 1, `${cls}: 장착 ≥ 1`);
    assert.equal(st.char.bag.filter(Boolean).length, 0, `${cls}: 가방을 비웠다`);
    for (let i = 0; i < 600; i++) {
      tick(sim, bot);
      if (i % 300 === 0) invariants(sim, `${cls} 균열 2 ${st.tick}`);
    }
    invariants(sim, `${cls} 끝`);
  }
});

/** 같은 시드 · 같은 봇으로 균열 3판(판마다 균열 시간 상한) → 상태 해시 @param {number} seed */
function threeRifts(seed) {
  const { sim } = newSim(seed);
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'w' });
  const bot = new Bot({ sim, cls: 'warrior', seed });
  const sums = [];
  for (let k = 0; k < 3; k++) {
    const s = runRift({ sim, bot, maxSec: 50 });
    assert.ok(s, `시드 ${seed}: 판 ${k + 1}`);
    sums.push(`${s.level}:${s.result}:${s.kills.normal}`);
  }
  return { hash: hashState(sim.state), sums: sums.join(','), log: JSON.stringify(bot.log) };
}

test('S2: 결정성 — 같은 시드 · 같은 봇으로 균열 3판 → 상태 해시 · 봇 기록 같음 / 다른 시드 → 다름', () => {
  const a = threeRifts(21);
  const b = threeRifts(21);
  const c = threeRifts(22);
  assert.equal(a.hash, b.hash, `${a.sums} / ${b.sums}`);
  assert.equal(a.log, b.log);
  assert.notEqual(a.hash, c.hash);
});

test('S3: 퍼즈 — 균열 3 에서 randomInputs 10,000틱 + 무작위 명령(장착 · 팔기 · 스킬 · 바) · 예외 0 · NaN 0 · 불변식', () => {
  const { sim } = newSim(31);
  const char = makeDevCharacter({ slot: 0, cls: 'mage', name: 'fz', level: 8, rift: 3, preset: 1, seed: 31, newId: sim.ctx.newItemId });
  assert.equal(sim.loadCharacter(0, char).ok, true);
  sim.debugGrant({ items: ['magic', 'rare', 'normal', 'magic', 'rare', 'legendary'] });
  assert.equal(sim.debugOpenRift(3, 31).ok, true);
  const inputs = randomInputs(31);
  const rng = makeRng(seedRng(77));
  const nodes = nodesOf('mage').map((n) => n.id);
  const st = sim.state;
  for (let t = 0; t < 10000; t++) {
    if (st.pendingTravel) sim.commitTravel();
    if (st.player.dead) {
      sim.respawn();
      if (st.pendingTravel) sim.commitTravel();
      sim.returnToRift();
      if (st.pendingTravel) sim.commitTravel();
      if (st.scene !== 'rift') sim.debugOpenRift(3, 31 + t);
    }
    if (t % 25 === 0) {
      const ch = st.char;
      const k = rng.int(0, 5);
      const bagIdx = ch.bag.findIndex(Boolean);
      if (k === 0 && bagIdx >= 0) sim.equip({ where: 'bag', idx: bagIdx });
      else if (k === 1 && bagIdx >= 0) assert.equal(sim.sell({ where: 'bag', idx: bagIdx }).ok, false, '균열에서는 팔 수 없다');
      else if (k === 2) sim.learnSkill(nodes[rng.int(0, nodes.length - 1)]);
      else if (k === 3) sim.setSkillBar(rng.int(0, 4), nodes[rng.int(0, nodes.length - 1)]);
      else if (k === 4) sim.unequip(EQUIP_SLOTS[rng.int(0, EQUIP_SLOTS.length - 1)]);
      else sim.sortBag();
    }
    sim.step(inputs(st.tick, st));
    if (t % 300 === 0) invariants(sim, `퍼즈 ${t}`);
  }
  invariants(sim, '퍼즈 끝');
});

test('S4: 새 캐릭터의 첫 사망 → 부활 → 복귀 — 키 2번(Enter · Enter)과 commit 만으로 다시 균열 · 그 사이 모달 안내 0 · 시스템 시간 1.3초 ≤ 1.7', () => {
  const { sim, log } = newSim(41);
  assert.equal(sim.newCharacter({ slot: 0, cls: 'warrior', name: 'w' }).ok, true);
  const st = sim.state;
  assert.equal(st.char.hints.death, undefined, '첫 사망 전');
  const bot = new Bot({ sim, cls: 'warrior', seed: 41 });
  // 첫 균열(새 캐릭터 · 안내가 끼는 경로) — 해금 밖의 높은 균열을 디버그로 열어 빨리 쓰러진다
  let n = 0;
  while (st.scene === 'town' && n++ < MIN) tick(sim, bot);
  assert.equal(st.scene, 'rift');
  assert.equal(sim.debugOpenRift(14, 41).ok, true);
  n = 0;
  while (!st.player.dead && n++ < MIN * 3) tick(sim, bot);
  assert.ok(st.player.dead, '쓰러졌다');
  const diedAt = st.tick;
  const iDied = log.length;
  const keys0 = bot.counters.keys;
  n = 0;
  while (!(st.scene === 'rift' && !st.player.dead && !st.pendingTravel) && n++ < 30 * 10) tick(sim, bot);
  assert.equal(st.scene, 'rift', '다시 균열');
  assert.equal(bot.counters.keys - keys0, 2, '키 입력 2번(부활 Enter · 복귀 Enter)');
  const between = log.slice(iDied);
  const travels = between.filter((e) => e.name === EV.TRAVEL_REQUEST).map((e) => e.payload.reason);
  assert.deepEqual(travels, ['respawn', 'townPortal'], '전환은 부활 · 복귀 둘뿐');
  const modal = between.filter((e) => e.name === EV.HINT && (e.payload.id === 'town' || e.payload.id === 'controls'));
  assert.equal(modal.length, 0, `모달 안내 0 — ${JSON.stringify(modal.map((e) => e.payload.id))}`);
  assert.ok(log.some((e) => e.name === EV.HINT && e.payload.id === 'death'), '첫 사망 안내(비모달)는 났다');
  // 시간: 시스템(사망 패널 지연 + 막 0.2 + 0.2 + 0.3 + 0.3 — §5.10 · §11.4) + 봇의 결정(반응 두 번)
  const system = DEATH.panelDelay + 0.2 + 0.2 + 0.3 + 0.3;
  assert.ok(Math.abs(system - 1.3) < 1e-9 && system <= 1.7, `시스템 ${system}`);
  const back = between.find((e) => e.name === EV.SCENE_CHANGED && e.payload.to === 'rift');
  const decisions = (back.tick - diedAt) / 30;   // 헤드리스는 막이 없다 — 이 시간은 봇의 반응(부활 · 복귀)뿐
  assert.ok(decisions <= 2 * BOT_RULES.reactMax + 2 / 30, `봇의 결정 ${decisions.toFixed(2)}초`);
  assert.ok(system + Math.max(0, decisions - DEATH.panelDelay) <= 2.0, `재도전 ${(system + decisions - DEATH.panelDelay).toFixed(2)}초 — 2초 안(브리프 §7)`);
  // 복귀 뒤에도 봇이 계속 돈다
  for (let i = 0; i < 300; i++) tick(sim, bot);
  invariants(sim, 'S4 끝');
});
