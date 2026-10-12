// OWNER: P15 — 계약 §12.2 (bot.test.js) · §12.1
// 봇 규칙: 반응 지연 · 피하기(예고 밖으로) · 무회피 · 레벨 선택 규칙 · 마을 정비(INTERACT 뒤 명령 · 차례 · townSec) · 동작별 스킬 사용 규칙 ·
// 사람과 같은 입력(hover src 'pick' · 대상 검사 통과) · 시야(viewR 밖은 고르지 않는다) · 스킬 배분(프리셋 순서 · 무작위 배분).
// 실제 GameSim(W1 sim) + P0 이벤트만 쓴다(P9 를 기다리지 않는다).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus, EV } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { circle, overlaps } from '../src/core/shapes.js';
import { BOT, BOT_RULES } from '../src/data/bot.js';
import { PRESETS } from '../src/data/presets.js';
import { Bot, RANDOM_BUILD } from '../src/bot/bot.js';
import { chooseLevel, nextSkillPoint } from '../src/bot/build.js';
import { lootTarget } from '../src/bot/loot.js';
import { skillRule } from '../src/bot/combat.js';
import { GameSim } from '../src/sim/GameSim.js';
import { spawnEffect } from '../src/sim/effects.js';
import { spawnMonster } from '../src/sim/monsters/monsters.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { pointsFree } from '../src/sim/progression/progress.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { isWalkableR, losClear } from '../src/sim/world/nav.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import { spawnDrops } from '../src/sim/drops.js';
import { makeTestState } from './helpers.js';

/** 실제 세션 · 이벤트 기록 @param {number} seed */
function newSim(seed = 1) {
  const bus = new EventBus();
  /** @type {Array<{name:string, payload:any, tick:number}>} */
  const log = [];
  const sim = new GameSim({ bus, seed, devSession: true });
  bus.onAny((name, payload) => log.push({ name, payload, tick: sim.state.tick }));
  sim.start();
  return { sim, log };
}

/** 개발 캐릭터로 균열을 열고(바로 commit) 맵의 몬스터를 치운다 — 깨끗한 장면 @param {'warrior'|'mage'} cls */
function cleanRift(cls, { level = 5, charLevel = 12, seed = 3 } = {}) {
  const s = newSim(seed);
  const char = makeDevCharacter({ slot: 0, cls, name: cls, level: charLevel, rift: level, preset: 0, seed, newId: s.sim.ctx.newItemId });
  assert.equal(s.sim.loadCharacter(0, char).ok, true);
  assert.equal(s.sim.debugOpenRift(level, seed).ok, true);
  for (const m of s.sim.state.rift.mons) m.gone = true;
  s.sim.debugRevealMap();   // 탐색할 곳이 없다 — 봇이 제자리에 선다(피하기 검사가 탐색 이동과 섞이지 않게)
  s.sim.step(NEUTRAL_INPUT);
  return s;
}

/** 봇 한 틱 */
function tickBot(sim, bot) {
  const inp = bot.frame();
  sim.step(inp);
  bot.afterStep();
  return inp;
}

/** 플레이어 둘레에서 걷기 가능 · 시야가 트인 점(거리 d) */
function openSpot(sim, d) {
  const p = sim.state.player.pos;
  const map = sim.getMap();
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI * 2) / 24;
    const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    if (isWalkableR(map, x, z, 1.0) && losClear(map, p.x, p.z, x, z)) return { x, z };
  }
  throw new Error('no open spot');
}

test('반응 지연 — N(reactSec, reactSd)를 [reactMin, reactMax]초로 자른 틱(밸런스 게이트 0.30 · 0.08 · [0.1, 0.5]) · 결정적(같은 시드 = 같은 열)', () => {
  const { sim } = newSim(1);
  const a = new Bot({ sim, cls: 'warrior', seed: 5 });
  const b = new Bot({ sim, cls: 'warrior', seed: 5 });
  const xs = [];
  for (let i = 0; i < 2000; i++) {
    const t = a.reactTicks();
    assert.equal(t, b.reactTicks());
    assert.ok(t >= Math.round(BOT_RULES.reactMin * 30) && t <= Math.round(BOT_RULES.reactMax * 30), `${t}`);
    xs.push(t);
  }
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length / 30;
  assert.ok(Math.abs(mean - BOT.reactSec) < 0.02, `평균 ${mean}`);
});

/** 플레이어 발밑에 적대 예고(원 r · delay 초)를 하나 놓는다 */
function hazardAtPlayer(sim, { r = 2.0, delay = 1.2 } = {}) {
  const p = sim.state.player.pos;
  return spawnEffect(sim.ctx, {
    kind: 'plague', owner: 'mon', srcId: -1, packId: -1, hostile: true, shape: circle(p.x, p.z, r), delay, dur: 0, tick: 0,
    spec: { srcId: -1, via: 'hazard', raw: 1, type: 'phys', level: 1, noAffix: true },
  });
}

test('피하기 — 알아챈 적대 예고(플레이어 발밑)를 반응 지연 뒤에, 판정 틱 전에 걸어서 벗어난다 · 그 전에는 움직이지 않는다', () => {
  let dodged = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { sim } = cleanRift('warrior', { seed });
    const bot = new Bot({ sim, cls: 'warrior', seed, params: { ...BOT, dodgeNotice: 1 } });
    tickBot(sim, bot);
    const e = hazardAtPlayer(sim);
    const p = sim.state.player;
    const start = { x: p.pos.x, z: p.pos.z };
    let firstMove = -1;
    while (sim.state.tick < e.hitAt) {
      const t = sim.state.tick;
      const inp = tickBot(sim, bot);
      if (firstMove < 0 && inp.lmbDown && bot.dodge) firstMove = t;
    }
    assert.ok(firstMove >= 0, `시드 ${seed}: 움직이지 않았다`);
    assert.ok(firstMove - e.start >= Math.round(BOT_RULES.reactMin * 30), `시드 ${seed}: 반응 지연 전에 움직였다(${firstMove - e.start}틱)`);
    assert.ok(!overlaps(e.shape, p.pos.x, p.pos.z, p.r), `시드 ${seed}: 판정 틱에 아직 안에 있다`);
    assert.ok(Math.hypot(p.pos.x - start.x, p.pos.z - start.z) <= BOT_RULES.dodgeDists.at(-1) + 0.5, `시드 ${seed}: 표본(2~5m) 밖으로 갔다`);
    dodged++;
  }
  assert.equal(dodged, 6);
});

test('피하기 — 예고가 길면 급할 때만 비킨다(hitAt − 지금 ≤ 걸어 나가는 시간 + 0.2초 + dodgeLead — 밸런스 게이트) · 알아챔 0 이면 피하지 않는다', () => {
  {
    const { sim } = cleanRift('mage', { seed: 2 });
    const bot = new Bot({ sim, cls: 'mage', seed: 2, params: { ...BOT, dodgeNotice: 1 } });
    tickBot(sim, bot);
    const e = hazardAtPlayer(sim, { r: 1.6, delay: 2.0 });
    let firstMove = -1;
    while (sim.state.tick < e.hitAt) {
      const t = sim.state.tick;
      const inp = tickBot(sim, bot);
      if (firstMove < 0 && inp.lmbDown && bot.dodge) firstMove = t;
    }
    assert.ok(firstMove >= 0);
    const left = (e.hitAt - firstMove) / 30;
    // 가장 가까운 안전 표본까지 걷는 시간(2.0 ~ 3m) + 0.2 + dodgeLead(밸런스 게이트 — 한 번 더 휘두르다 잠김에 갇히지 않게) + 1틱 여유
    assert.ok(left <= 3 / 6 + BOT_RULES.dodgeSlack + BOT_RULES.dodgeLead + 2 / 30, `너무 일찍 비켰다(남은 ${left.toFixed(2)}초)`);
    assert.ok(!overlaps(e.shape, sim.state.player.pos.x, sim.state.player.pos.z, sim.state.player.r));
  }
  {
    const { sim } = cleanRift('warrior', { seed: 4 });
    const bot = new Bot({ sim, cls: 'warrior', seed: 4, params: { ...BOT, dodgeNotice: 0 } });
    tickBot(sim, bot);
    const e = hazardAtPlayer(sim);
    while (sim.state.tick < e.hitAt) tickBot(sim, bot);
    assert.ok(overlaps(e.shape, sim.state.player.pos.x, sim.state.player.pos.z, sim.state.player.r), '알아채지 못한 예고는 피하지 않는다');
    assert.equal(bot.counters.dodges, 0);
  }
});

test('무회피(noDodge) — 같은 장면에서 예고를 피하지 않는다 · 기본(basic)은 피한다', () => {
  const run = (strategy) => {
    const { sim } = cleanRift('warrior', { seed: 5 });
    const bot = new Bot({ sim, cls: 'warrior', strategy, seed: 5 });
    tickBot(sim, bot);
    let inside = 0;
    for (let k = 0; k < 6; k++) {
      const e = hazardAtPlayer(sim);
      while (sim.state.tick < e.hitAt) tickBot(sim, bot);
      if (overlaps(e.shape, sim.state.player.pos.x, sim.state.player.pos.z, sim.state.player.r)) inside++;
      for (let i = 0; i < 15; i++) tickBot(sim, bot);
    }
    return { inside, dodges: bot.counters.dodges };
  };
  const nd = run('noDodge');
  assert.equal(nd.inside, 6);
  assert.equal(nd.dodges, 0);
  const b = run('basic');
  assert.ok(b.inside <= 2, `basic 은 대부분 피한다(알아챔 0.9): ${JSON.stringify(b)}`);
  assert.ok(b.dodges >= 4);
});

test('레벨 선택 — 첫 판 1 · 완료 · 무사망 · 6분 안 +1(해금 안) · 사망 2 이상/붕괴 −1(최소 1) · 그 밖 그대로 · challenge 늘 해금 최고 · override', () => {
  const P = BOT;
  const ch = (riftUnlocked, rec) => ({ riftUnlocked, records: rec ? [rec] : [] });
  const run = (level, result, deaths, timeSec) => ({ level, result, deaths, timeSec });
  assert.equal(chooseLevel('basic', ch(5, null), P), 1);
  assert.equal(chooseLevel('basic', ch(5, run(3, 'complete', 0, 300)), P), 4);
  assert.equal(chooseLevel('basic', ch(3, run(3, 'complete', 0, 300)), P), 3, '해금 안으로 자른다');
  assert.equal(chooseLevel('basic', ch(5, run(3, 'complete', 0, P.upMaxSec + 1)), P), 3, '6분 넘으면 그대로');
  assert.equal(chooseLevel('basic', ch(5, run(3, 'complete', 1, 300)), P), 3, '사망 1 은 그대로');
  assert.equal(chooseLevel('basic', ch(5, run(3, 'complete', 2, 300)), P), 2, '사망 2 → −1');
  assert.equal(chooseLevel('basic', ch(5, run(3, 'collapse', 4, 200)), P), 2, '붕괴 → −1');
  assert.equal(chooseLevel('basic', ch(5, run(1, 'collapse', 4, 200)), P), 1, '최소 1');
  assert.equal(chooseLevel('basic', ch(5, run(4, 'abandon', 0, 100)), P), 4, '포기는 그대로');
  assert.equal(chooseLevel('noDodge', ch(5, run(3, 'complete', 0, 300)), P), 4, 'noDodge 는 basic 과 같다');
  assert.equal(chooseLevel('challenge', ch(7, run(3, 'complete', 0, 300)), P), 7);
  assert.equal(chooseLevel('basic', ch(7, null), P, 5), 5);
  assert.equal(chooseLevel('basic', ch(4, null), P, 9), 4, 'override 도 해금 안');
});

test('마을 정비 — 대장장이(전부 팔기 · 수리) → 잡화상(포션 10 · 두루마리 5) → 균열석(레벨 선택 · 열기): 각 상점 명령은 그 NPC 의 INTERACT 뒤 · townSec 만큼 서 있는다 · autoCommit false 면 commit 하지 않는다', () => {
  const { sim, log } = newSim(9);
  const char = makeDevCharacter({ slot: 0, cls: 'warrior', name: 'w', level: 6, rift: 3, preset: 0, seed: 9, newId: sim.ctx.newItemId });
  char.gold = 2000;
  char.potions = 2;
  char.scrolls = 1;
  for (let i = 0; i < 5; i++) char.bag[i] = makeItem({ baseId: 'helm', ilvl: 2, id: 'i' + (900 + i) });
  for (const s of ['mainHand', 'chest']) if (char.equip[s]) char.equip[s].dur = 50;
  char.records = [{ level: 2, result: 'complete', deaths: 0, timeSec: 300 }];
  assert.equal(sim.loadCharacter(0, char).ok, true);
  const bot = new Bot({ sim, cls: 'warrior', seed: 9, autoCommit: false });
  let n = 0;
  while (!sim.state.pendingTravel && n++ < 30 * 120) tickBot(sim, bot);
  const st = sim.state;
  assert.ok(st.pendingTravel, '균열을 열었다');
  assert.equal(st.pendingTravel.level, 3, '직전 판(균열 2 · 무사망 · 5분) → 3');
  assert.equal(st.scene, 'town', 'autoCommit false — commit 은 app 의 막이 한다');
  const ch = st.char;
  assert.equal(ch.bag.filter(Boolean).length, 0, '가방 전부 팔았다');
  assert.equal(ch.equip.mainHand.dur, ch.equip.mainHand.durMax, '수리');
  assert.equal(ch.potions, BOT.potionsTo);
  assert.equal(ch.scrolls, BOT.scrollsTo);
  const at = (pred) => log.findIndex(pred);
  const iSmith = at((e) => e.name === EV.INTERACT && e.payload.id === 'blacksmith');
  const iGen = at((e) => e.name === EV.INTERACT && e.payload.id === 'general');
  const iStone = at((e) => e.name === EV.INTERACT && e.payload.id === 'riftStone');
  assert.ok(iSmith >= 0 && iGen > iSmith && iStone > iGen, '차례 대장장이 → 잡화상 → 균열석');
  const trades = log.filter((e) => e.name === EV.TRADE);
  for (const t of trades) {
    const i = log.indexOf(t);
    const npc = t.payload.shop === 'general' ? iGen : iSmith;
    assert.ok(i > npc, `${t.payload.kind} 은 ${t.payload.shop} INTERACT 뒤`);
  }
  // 상점마다 townSec 만큼 서 있었다(INTERACT → 다음 INTERACT · 열기 사이의 틱)
  const tick = (i) => log[i].tick;
  assert.ok(tick(iGen) - tick(iSmith) >= BOT.townSec.blacksmith * 30, '대장장이에서 20초');
  assert.ok(tick(iStone) - tick(iGen) >= BOT.townSec.general * 30, '잡화상에서 8초');
  const open = log.findIndex((e) => e.name === EV.TRAVEL_REQUEST);
  assert.ok(tick(open) - tick(iStone) >= BOT.townSec.riftStone * 30, '균열석에서 4초');
  // 한 틱 더 — commit 하지 않는다
  tickBot(sim, bot);
  assert.ok(sim.state.pendingTravel);
  assert.equal(sim.commitTravel().ok, true);
  assert.equal(sim.state.scene, 'rift');
});

test('마을 정비 — 할 일이 없는 상점은 들르지 않는다 · 부활해 온 마을은 정비 없이 반응 지연 뒤 복귀(Enter)', () => {
  const { sim, log } = newSim(4);
  assert.equal(sim.newCharacter({ slot: 0, cls: 'mage', name: 'm' }).ok, true);
  const bot = new Bot({ sim, cls: 'mage', seed: 4 });
  let n = 0;
  while (sim.state.scene === 'town' && n++ < 30 * 60) tickBot(sim, bot);
  assert.equal(sim.state.scene, 'rift');
  const ids = log.filter((e) => e.name === EV.INTERACT).map((e) => e.payload.id);
  assert.deepEqual(ids, ['riftStone'], '빈 가방 · 골드 0 — 대장장이 · 잡화상 건너뜀');
  assert.equal(sim.state.rift.level, 1, '첫 판 1');
  // 쓰러뜨린다(피할 수 없는 적대 판정 — 예고 0) → 부활 → 마을 → 복귀
  for (let i = 0; i < 60; i++) tickBot(sim, bot);
  sim.state.player.protectUntil = 0;
  const pp = sim.state.player.pos;
  spawnEffect(sim.ctx, { kind: 'slam', owner: 'mon', srcId: -1, packId: -1, hostile: true, shape: circle(pp.x, pp.z, 3), delay: 0, spec: { srcId: -1, via: 'hazard', raw: 1e6, type: 'phys', level: 1, noAffix: true } });
  n = 0;
  while (!sim.state.player.dead && n++ < 30 * 60) tickBot(sim, bot);
  assert.ok(sim.state.player.dead);
  const deadAt = sim.state.tick;
  n = 0;
  while (sim.state.scene !== 'town' && n++ < 30 * 5) tickBot(sim, bot);
  assert.equal(sim.state.scene, 'town');
  const respawnTick = log.find((e) => e.name === EV.TRAVEL_REQUEST && e.payload.reason === 'respawn').tick;
  assert.ok(respawnTick - deadAt >= Math.round(BOT_RULES.reactMin * 30) && respawnTick - deadAt <= Math.round(BOT_RULES.reactMax * 30) + 1, `부활까지 ${respawnTick - deadAt}틱`);
  const before = log.length;
  n = 0;
  while (sim.state.scene !== 'rift' && n++ < 30 * 5) tickBot(sim, bot);
  assert.equal(sim.state.scene, 'rift', '복귀');
  assert.equal(log.slice(before).filter((e) => e.name === EV.INTERACT).length, 0, '정비 없이');
  assert.equal(bot.counters.keys, 2, 'Enter 두 번(부활 · 복귀)');
});

/** 상황 리터럴 — 플레이어 (0, 0) */
function sit({ mons = [], target = null, life = 1, resource = 100, combat = true, meleeNear = 0 } = {}) {
  return { px: 0, pz: 0, life, resource, combat, mons, target, meleeNear, kiteCount: BOT.kiteCount, walkable: null };
}
const mon = (x, z, rank = 'normal', o = {}) => ({ x, z, r: 0.45, rank, awake: true, melee: true, id: Math.round(x * 100 + z), ...o });
const tgt = (m, o = {}) => ({ ...m, d: Math.hypot(m.x, m.z), los: true, ...o });
const R = BOT_RULES;

test('동작별 스킬 규칙(§12.1 표) — 원뿔 · 지진 · 돌진 · 회오리 · 버프 · 도약', () => {
  const sk = { cost: 14, angleDeg: 120 };
  const a = mon(0, 2), b = mon(0.8, 2.5), far = mon(0, 6);
  assert.ok(skillRule('cone', sit({ mons: [a, b], target: tgt(a) }), R, sk), 'cone: 4m 원뿔 안 2마리');
  assert.equal(skillRule('cone', sit({ mons: [a], target: tgt(a) }), R, sk), null, 'cone: 1마리');
  assert.ok(skillRule('cone', sit({ mons: [mon(0, 2, 'elite')], target: tgt(mon(0, 2, 'elite')) }), R, sk), 'cone: 정예 대상');
  assert.equal(skillRule('cone', sit({ mons: [a, mon(0, -2)], target: tgt(a) }), R, sk), null, 'cone: 뒤의 것은 원뿔 밖');
  assert.equal(skillRule('cone', sit({ mons: [far, mon(0.5, 6)], target: tgt(far) }), R, sk), null, 'cone: 대상이 4m 밖');
  const five = [mon(1, 1), mon(-1, 1), mon(2, -2), mon(-3, 2), mon(0, -4)];
  assert.ok(skillRule('quake', sit({ mons: five, target: tgt(five[0]) }), R, sk), 'quake: 6m 안 5마리');
  assert.equal(skillRule('quake', sit({ mons: five.slice(0, 4), target: tgt(five[0]) }), R, sk), null);
  assert.ok(skillRule('quake', sit({ mons: [mon(3, 3, 'guardian')], target: null }), R, sk), 'quake: 수호자 6m 안');
  const t8 = mon(0, 8);
  assert.ok(skillRule('dash', sit({ mons: [t8], target: tgt(t8) }), R, sk), 'dash: 6~10m');
  assert.equal(skillRule('dash', sit({ mons: [a], target: tgt(a) }), R, sk), null);
  assert.equal(skillRule('dash', sit({ mons: [mon(0, 11)], target: tgt(mon(0, 11)) }), R, sk), null);
  const three = [mon(1, 0), mon(-1, 1), mon(0, -1.5)];
  assert.ok(skillRule('spin', sit({ mons: three, target: tgt(three[0]), resource: 40 }), R, sk), 'spin: 2.4m 3마리 · 분노 30 이상');
  assert.equal(skillRule('spin', sit({ mons: three, target: tgt(three[0]), resource: 20 }), R, sk), null, 'spin: 분노 부족');
  assert.equal(skillRule('spin', sit({ mons: three.slice(0, 2), target: tgt(three[0]), resource: 60 }), R, sk), null);
  assert.ok(skillRule('buff', sit({ combat: true }), R, sk));
  assert.equal(skillRule('buff', sit({ combat: false }), R, sk), null);
  const t7 = mon(0, 7);
  assert.ok(skillRule('leap', sit({ mons: [t7], target: tgt(t7) }), R, sk), 'leap: 6~9m');
  const pack = [mon(4, 4, 'elite'), mon(4.5, 3.5, 'minion'), mon(3.5, 4.5, 'minion')];
  assert.ok(skillRule('leap', sit({ mons: pack, target: tgt(a) }), R, sk), 'leap: 정예 팩 한가운데');
  assert.equal(skillRule('leap', sit({ mons: [a], target: tgt(a) }), R, sk), null);
});

test('동작별 스킬 규칙(§12.1 표) — 화염구 · 메테오 · 노바 · 보호막 · 연쇄 번개 · 순간이동', () => {
  const sk = { cost: 16 };
  const t = mon(0, 9);
  assert.ok(skillRule('fireball', sit({ mons: [t], target: tgt(t), resource: 40 }), R, sk), 'fireball: 마나 > 비용 + 20');
  assert.equal(skillRule('fireball', sit({ mons: [t], target: tgt(t), resource: 30 }), R, sk), null, '보호막 여유');
  assert.equal(skillRule('fireball', sit({ mons: [t], target: tgt(t, { los: false }), resource: 90 }), R, sk), null, '시야');
  const cl = [mon(5, 5), mon(6, 5), mon(5, 6), mon(6.5, 6.5)];
  const w = skillRule('meteor', sit({ mons: cl, target: tgt(cl[0]) }), R, { cost: 40 });
  assert.ok(w && Math.hypot(w.x - 5.5, w.z - 5.5) < 2, 'meteor: 3.5m 안 4마리 모인 점');
  assert.equal(skillRule('meteor', sit({ mons: cl.slice(0, 3), target: tgt(cl[0]) }), R, { cost: 40 }), null);
  const el = mon(0, 10, 'elite');
  assert.ok(skillRule('meteor', sit({ mons: [el], target: tgt(el) }), R, { cost: 40 }), 'meteor: 정예');
  const near3 = [mon(2, 0), mon(-2, 1), mon(0, 3)];
  assert.ok(skillRule('nova', sit({ mons: near3 }), R, { cost: 20 }), 'nova: 5m 3마리');
  assert.equal(skillRule('nova', sit({ mons: near3.slice(0, 2) }), R, { cost: 20 }), null);
  assert.ok(skillRule('shield', sit({ combat: true, life: 0.6 }), R, sk), 'shield: 전투 · 생명 < 70%');
  assert.equal(skillRule('shield', sit({ combat: true, life: 0.8 }), R, sk), null);
  assert.equal(skillRule('shield', sit({ combat: false, life: 0.3 }), R, sk), null);
  assert.ok(skillRule('chain', sit({ mons: [t], target: tgt(t) }), R, sk), 'chain: 15m 안');
  assert.equal(skillRule('chain', sit({ mons: [mon(0, 16)], target: tgt(mon(0, 16)) }), R, sk), null);
  const crowd = [mon(1, 1), mon(-1, 1), mon(0, 2)];
  const bl = skillRule('blink', sit({ mons: crowd, meleeNear: 3 }), R, sk);
  assert.ok(bl && bl.z < -BOT_RULES.blinkDist + 2, 'blink: 근접 3 이상이 4m 안 → 반대쪽 10m');
  assert.equal(skillRule('blink', sit({ mons: crowd, meleeNear: 2 }), R, sk), null);
});

test('사람과 같은 입력 — 대상 hover(src pick)가 sim 의 대상 검사를 통과해 실제로 때린다 · 화면(viewR) 밖은 고르지 않는다', () => {
  for (const cls of /** @type {const} */ (['warrior', 'mage'])) {
    const { sim } = cleanRift(cls, { seed: 7 });
    const bot = new Bot({ sim, cls, seed: 7 });
    const st = sim.state;
    // viewR 밖의 잠든 몬스터 — 고르지 않는다(봇은 사람보다 많이 보지 않는다)
    const p = st.player.pos;
    const farSpot = (() => {
      const map = sim.getMap();
      for (let k = 0; k < 36; k++) {
        const a = (k * Math.PI * 2) / 36;
        for (const d of [14, 16, 18]) {
          const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
          if (isWalkableR(map, x, z, 0.6)) return { x, z };
        }
      }
      return null;
    })();
    assert.ok(farSpot);
    const far = spawnMonster(sim.ctx, { typeId: 'ghoul', rank: 'normal', level: st.rift.level, x: farSpot.x, z: farSpot.z, awake: false });
    for (let i = 0; i < 10; i++) {
      const inp = tickBot(sim, bot);
      assert.ok(!(inp.hover && inp.hover.kind === 'monster' && inp.hover.id === far.id), `${cls}: 화면 밖을 노렸다`);
    }
    far.gone = true;
    // 가까운 깨어 있는 몬스터 — 반응 지연 뒤 노리고 피해를 준다
    const spot = openSpot(sim, 5);
    const m = spawnMonster(sim.ctx, { typeId: 'ghoul', rank: 'normal', level: st.rift.level, x: spot.x, z: spot.z, awake: true });
    const hp0 = m.hp;
    let pick = 0;
    for (let i = 0; i < 90 && !m.dead; i++) {
      const inp = tickBot(sim, bot);
      if (inp.hover && inp.hover.kind === 'monster' && inp.hover.id === m.id) {
        assert.equal(inp.hover.src, 'pick');
        pick++;
      }
    }
    assert.ok(pick > 0, `${cls}: 노리지 않았다`);
    assert.ok(m.hp < hp0 || m.dead, `${cls}: 피해 0`);
  }
});

test('스킬 배분 — 프리셋 order 를 그대로(레벨 2 → 30) · 바는 preset.bar · 무작위 배분은 찍을 수 있는 노드 중에서(결정적)', () => {
  for (const cls of /** @type {const} */ (['warrior', 'mage'])) {
    for (const pi of [0, 1]) {
      const { sim } = newSim(2);
      assert.equal(sim.newCharacter({ slot: 0, cls, name: cls }).ok, true);
      assert.equal(sim.debugSetLevel(30).ok, true);
      const bot = new Bot({ sim, cls, preset: pi, seed: 2 });
      bot.afterStep();
      const ch = sim.state.char;
      assert.equal(pointsFree(ch), 0, `${cls} ${pi}: 29점을 다 찍었다`);
      /** @type {Record<string, number>} */
      const want = {};
      for (const id of PRESETS[cls][pi].order) want[id] = (want[id] ?? 0) + 1;
      assert.deepEqual(ch.skills.ranks, want, `${cls} ${pi}: 프리셋 order 그대로`);
      assert.deepEqual(ch.skills.bar, PRESETS[cls][pi].bar, `${cls} ${pi}: 바`);
    }
    // 무작위 배분 — 같은 시드면 같은 빌드 · 다른 시드면 대개 다르다 · 규칙(canLearn) 안
    const build = (seed) => {
      const { sim } = newSim(3);
      sim.newCharacter({ slot: 0, cls, name: cls });
      sim.debugSetLevel(15);
      const bot = new Bot({ sim, cls, preset: RANDOM_BUILD, seed });
      bot.afterStep();
      assert.equal(pointsFree(sim.state.char), 0);
      return JSON.stringify(sim.state.char.skills.ranks);
    };
    assert.equal(build(11), build(11));
    assert.ok(new Set([build(11), build(12), build(13), build(14)]).size >= 2, `${cls}: 무작위 배분이 늘 같다`);
  }
  // 순수 — 포인트가 없으면 null
  assert.equal(nextSkillPoint(/** @type {any} */ ({ cls: 'warrior', level: 1, skills: { ranks: {}, bar: [] } }), 0, null), null);
});

test('봇 기록 · 결정성 — 같은 시드 · 같은 봇이면 같은 입력 열 · log 는 순수 배열', () => {
  const run = () => {
    const { sim } = newSim(12);
    sim.newCharacter({ slot: 0, cls: 'warrior', name: 'w' });
    const bot = new Bot({ sim, cls: 'warrior', seed: 3 });
    const seq = [];
    for (let i = 0; i < 30 * 40; i++) {
      const inp = bot.frame();
      seq.push(`${inp.lmb ? 1 : 0}${inp.lmbDown ? 1 : 0}${inp.slotDown.map(Number).join('')}${inp.cursor ? inp.cursor.x.toFixed(2) + ',' + inp.cursor.z.toFixed(2) : '-'}`);
      sim.step(inp);
      bot.afterStep();
    }
    return { seq: seq.join('|'), log: JSON.stringify(bot.log) };
  };
  const a = run(), b = run();
  assert.equal(a.seq, b.seq);
  assert.equal(a.log, b.log);
  assert.ok(JSON.parse(a.log).some((e) => e.kind === 'openRift'));
});

/** lootTarget 만 보는 가짜 봇 · 시야(화면 밖 장비는 rift.drops 에서 고른다) */
function lootScene(dropDist) {
  const drop = { id: 77, kind: 'item', rarity: 'magic', gone: false, pos: { x: dropDist, z: 0 } };
  const bot = {
    sim: { state: { char: { bag: [null, null], potions: 0 }, rift: { phase: 'active', drops: [drop] } } },
    params: BOT, rules: BOT_RULES, lootIgnore: new Map(), lootTry: { id: -1, since: 0, last: -1e9 }, bagBlocked: false,
    notes: /** @type {string[]} */ ([]), note(kind) { this.notes.push(kind); },
  };
  const sv = { tick: 0, px: 0, pz: 0, drops: [], mons: [], dist: [] };
  return { bot, sv, drop };
}

test('줍기 — 화면 밖 장비: 쫓던 것은 lootMemoryR + lootMemoryPad 까지 놓지 않는다 · 그 밖은 고르지 않는다(밸런스 게이트 — 40m 경계에서 줍기 ↔ 탐색이 뒤집혀 제자리에서 떨었다)', () => {
  const R = BOT_RULES.lootMemoryR, pad = BOT_RULES.lootMemoryPad;
  // 처음 고를 때는 R 안이어야 한다
  const far = lootScene(R + 1);
  assert.equal(lootTarget(far.bot, far.sv), null);
  const s = lootScene(R - 1);
  assert.equal(lootTarget(s.bot, s.sv)?.id, 77);
  // 쫓는 중이면 R 밖(그러나 R + pad 안)이어도 그대로
  s.sv.tick = 1; s.sv.px = -(pad - 2);
  assert.equal(lootTarget(s.bot, s.sv)?.id, 77, 'R 바로 밖에서 놓았다');
  s.sv.tick = 2; s.sv.px = -(pad + 2);
  assert.equal(lootTarget(s.bot, s.sv), null, 'R + pad 밖도 쫓는다');
});

test('줍기 — 같은 드랍을 잠깐씩 끊어 고르면(lootTryGapSec 안) 쫓은 시간을 이어 세어 lootGiveUpSec 뒤 포기한다 · 틈이 길면 새로 센다', () => {
  const giveUp = Math.round(BOT_RULES.lootGiveUpSec * 30), gap = Math.round(BOT_RULES.lootTryGapSec * 30);
  const { bot, sv } = lootScene(10);
  let gaveUpAt = -1;
  // 12틱마다 6틱은 드랍이 고를 수 있는 거리 밖(줍기 ↔ 탐색이 뒤집히던 모양 — 전에는 그 틱에 시계가 0 으로 돌아갔다)
  for (let t = 0; t < giveUp + 60 && gaveUpAt < 0; t++) {
    sv.tick = t;
    const busy = t % 12 >= 6;
    sv.px = busy ? -100 : 0;
    const d = lootTarget(bot, sv);
    if (!busy && d === null) gaveUpAt = t;
  }
  assert.ok(gaveUpAt > 0 && gaveUpAt <= giveUp + 12, `포기하지 않았다(${gaveUpAt})`);
  assert.ok((bot.lootIgnore.get(77) ?? -1) > gaveUpAt);
  assert.deepEqual(bot.notes, ['lootGiveUp']);
  // 틈이 lootTryGapSec 보다 길면 처음부터 센다(다시 돌아온 드랍을 바로 버리지 않는다)
  const s2 = lootScene(10);
  s2.sv.tick = 0; assert.equal(lootTarget(s2.bot, s2.sv)?.id, 77);
  s2.sv.tick = giveUp - 10; assert.equal(lootTarget(s2.bot, s2.sv)?.id, 77);
  s2.sv.tick = giveUp - 10 + gap + 1; assert.equal(lootTarget(s2.bot, s2.sv)?.id, 77);
  s2.sv.tick = giveUp + gap + 5; assert.equal(lootTarget(s2.bot, s2.sv)?.id, 77, '틈 뒤 새로 세지 않았다');
});

test('리뷰 수정: 줍기 — 쫓던 드랍은 화면(sv.drops) · lootRadius 를 조금 벗어나도(lootMemoryPad 안) 계속 고른다 · 진척 시계 — 두 드랍을 번갈아 고르며 바닥 드랍이 줄지 않으면 lootGiveUpSec 뒤 버린다', () => {
  const giveUp = Math.round(BOT_RULES.lootGiveUpSec * 30);
  // 경계 여유: 마법 77(10m) 을 고른 뒤 화면 밖(12.5m) · 일반 88(5m) 이 보여도 77 을 놓지 않는다
  const s = lootScene(10);
  const other = { id: 88, kind: 'item', rarity: 'normal', gone: false, pos: { x: -5, z: 0 } };
  s.bot.sim.state.rift.drops.push(other);
  s.sv.drops = [s.drop, other];
  assert.equal(lootTarget(s.bot, s.sv)?.id, 77);
  s.sv.tick = 1; s.sv.px = -2.5; s.sv.drops = [other];
  assert.equal(lootTarget(s.bot, s.sv)?.id, 77, '화면 밖으로 나가자 다른 드랍으로 바뀌었다');
  s.sv.tick = 2; s.sv.px = -(BOT_RULES.lootMemoryPad + 3);
  assert.equal(lootTarget(s.bot, s.sv)?.id, 88, 'lootRadius + pad 밖이면 놓는다');
  // 진척 시계: 77 · 88 이 번갈아 보이고(쫓던 것은 lootRadius + pad 밖으로 — ID 시계가 계속 돌아간다) 바닥 드랍 수가 그대로면 lootGiveUpSec 뒤 버린다.
  //   pickAt 에 다른 드랍 하나를 주우면(바닥 드랍 수가 준다) 그때부터 다시 센다
  const alternate = (pickAt) => {
    const t = lootScene(10);
    const b2 = { id: 88, kind: 'item', rarity: 'magic', gone: false, pos: { x: 0, z: 10 } };
    const gold = { id: 89, kind: 'gold', gone: false, pos: { x: 60, z: 60 } };
    t.bot.sim.state.rift.drops.push(b2, gold);
    for (let k = 0; k < 3 * giveUp; k++) {
      t.sv.tick = k;
      if (k === pickAt) gold.gone = true;
      const phase = Math.floor(k / 6) % 2;
      t.drop.pos.x = phase ? 40 : 10;
      b2.pos.z = phase ? 10 : 40;
      t.sv.drops = phase ? [b2] : [t.drop];
      if (lootTarget(t.bot, t.sv) === null) return { at: k, notes: t.bot.notes };
    }
    return { at: -1, notes: t.bot.notes };
  };
  const a = alternate(-1);
  assert.ok(a.at > 0 && a.at <= giveUp + 12, `번갈아 고르는 동안 포기가 오지 않았다(${a.at})`);
  assert.ok(a.notes.includes('lootGiveUp'));
  const p = alternate(giveUp - 30);
  assert.ok(p.at >= 2 * giveUp - 30, `주운 뒤에도 시계를 이어 셌다(${p.at})`);
});

test('리뷰 수정: 줍기 — 벽 너머 긴 우회(직선 11m · 경로 약 80m)의 마법 드랍과 바로 닿는 일반 드랍 사이에서 번갈아 누르며 떨지 않는다(실제 GameSim · 봇) — 닿는 것을 줍는다', () => {
  const ascii = [
    '####################',
    '#....####....#######',
    '#S...####....#######',
    '#....####....#######',
    '#....####....#######',
    ...Array.from({ length: 13 }, () => '##.#######.#########'),
    '##.........#########',
    '####################',
  ].join('\n');
  const map = mapFromAscii(ascii, { id: 'test:livelock', kind: 'rift', tileset: 'crypt' });
  const { sim } = newSim(3);
  assert.equal(sim.debugLoadState(makeTestState({ map, cls: 'warrior' }), map, map).ok, true);
  sim.debugRevealMap();
  const ctx = sim.ctx;
  const [A] = spawnDrops(ctx, [{ kind: 'item', item: makeItem({ baseId: 'helm', ilvl: 1, rarity: 'magic', id: 'iA' }), amount: 0, mat: null }], 18.6, 5);
  const [B] = spawnDrops(ctx, [{ kind: 'item', item: makeItem({ baseId: 'helm', ilvl: 1, rarity: 'normal', id: 'iB' }), amount: 0, mat: null }], 9.4, 5);
  A.pos.x = 18.6; A.pos.z = 5; B.pos.x = 9.4; B.pos.z = 5;
  const bot = new Bot({ sim, cls: 'warrior', seed: 5 });
  let switches = 0, last = null, pickedB = -1;
  for (let t = 0; t < 30 * 30; t++) {
    const inp = tickBot(sim, bot);
    if (inp.lmbDown && inp.hover && inp.hover.kind === 'drop' && inp.hover.id !== last) { switches++; last = inp.hover.id; }
    if (pickedB < 0 && B.gone) pickedB = t;
  }
  assert.ok(pickedB >= 0 && pickedB < 30 * 10, `닿는 일반 드랍을 줍지 못했다(${pickedB})`);
  assert.ok(switches <= 4, `두 드랍을 번갈아 눌렀다(${switches}번 바뀜)`);
});
