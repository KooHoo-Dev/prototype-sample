// OWNER: W1 수정(밸런스 · NOTES-W1FIX) — 계약 §5.10 · §7.3 · §7.14
// 회귀: ① 시작 캐릭터 두 클래스가 균열 1 첫 판을 사망 ≤ 1 로 끝낸다(고정 시드 · scriptedClear 수준 — 피하기 · 우선 대상 없음)
//       ② 사망 → 부활 → 복귀: 그 틱에 진정 · 부활로 떠날 때 처음 자리로 · 복귀 뒤 3초 동안 복귀 지점의 aggro 안에서 깨는 몬스터가 없다(NOTES-W1 §7-3).
//       (W1 수정 3 · 4) 사망 → 부활 → 복귀를 강제 사망 · 자연 사망 · 수호자 단계 · 수호자 출현 예고 중 사망(W1 수정 4 — 부활 commit 에서 수호자를 잠든 채 세운다)으로.
//       ③ W1 수정 2: 첫 판 완화(RIFT.earlyDmg)가 해금 최고 + 3 의 위협을 지우지 않는다 — 개발 캐릭터가 균열 8 에서 쓰러진다(밸런스 게이트: 경사는 균열 1~11 · §7.3).
//       ④ 밸런스 게이트: basic 봇(「보통 사람」)이 시작 캐릭터로 균열 1 첫 판을 사망 ≤ 1 · 9분 안에 완료한다(브리프 「처음 성공까지」).
// 실제 GameSim 으로 돈다(봇은 W2 P15 — 봇의 밸런스 측정은 measure 가 다시 잰다).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus, EV } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { DEATH } from '../src/data/combat.js';
import { getMonDef, getSkillDef } from '../src/data/index.js';
import { circle } from '../src/core/shapes.js';
import { playerHitShape } from '../src/sim/combat.js';
import { hitSpec } from '../src/sim/player/skills.js';
import { spawnMonster } from '../src/sim/monsters/spawn.js';
import { GameSim } from '../src/sim/GameSim.js';
import { losClear } from '../src/sim/world/nav.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { assertFiniteDeep, scriptedClear } from './helpers.js';
import { Bot } from '../src/bot/bot.js';
import { runRift } from '../src/bot/measure.js';

const MIN = 30 * 60;

/** 실제 세션 · 이벤트 기록 @param {number} seed */
function newSim(seed) {
  const bus = new EventBus();
  /** @type {Array<{name:string, payload:any}>} */
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed, devSession: true });
  sim.start();
  return { sim, log };
}

/** 새 캐릭터(시작 장비 · 포션 5) · 균열 1(시드 고정)을 연 세션 @param {'warrior'|'mage'} cls @param {number} seed */
function firstRift(cls, seed) {
  const s = newSim(seed);
  assert.equal(s.sim.newCharacter({ slot: 0, cls, name: cls }).ok, true);
  assert.equal(s.sim.openRift(1, seed).ok, true);
  assert.equal(s.sim.commitTravel().ok, true);
  return s;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (m) => !m.dead && !m.gone && m.hp > 0;

// 시드 6 · 7 — 수호자가 뼈 거인인 판(잿빛 마녀는 W1 에서 P16 스텁이라 공격하지 않는다 — P16 이 들어와도 이 검사가 흔들리지 않게)
// 밸런스 게이트(NOTES-BALANCE): 예고 기술 피해 × 3 · 챔피언 · 정예 생명이 늘어 피하지 않는 하네스(scriptedClear)는 첫 판에서 0~3번 쓰러진다(시드 1~16 실측) —
//   브리프 「처음 성공까지」는 봇(basic · 사람 설정)으로 잰다(아래 봇 검사 · headless S1). 하네스는 「피하지 않아도 붕괴하지 않고 끝난다」만 본다.
test('밸런스 게이트: 시작 캐릭터(전사 · 마법사)가 균열 1 첫 판을 basic 봇으로 완료한다 — 사망 ≤ 1 · 9분(sim) 안 · 시드 6 · 7', () => {
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 6], ['mage', 6], ['warrior', 7], ['mage', 7]])) {
    const { sim } = newSim(seed);
    assert.equal(sim.newCharacter({ slot: 0, cls, name: cls }).ok, true);
    const bot = new Bot({ sim, cls, seed });
    const s = runRift({ sim, bot, maxSec: 15 * 60 });
    const why = `${cls} 시드 ${seed}: ${JSON.stringify(s && { level: s.level, result: s.result, deaths: s.deaths, timeSec: s.timeSec })}`;
    assert.ok(s && s.level === 1 && s.result === 'complete', why);
    assert.ok(s.deaths <= 1, why);
    assert.ok(s.timeSec <= 9 * 60, why);
    assertFiniteDeep(sim.state, cls);
  }
});

test('W1 수정: 시작 캐릭터(전사 · 마법사)가 균열 1 첫 판을 피하지 않고도 붕괴 없이 끝낸다 — 사망 ≤ 2 · 12분(sim) 안 · 시드 6 · 7 · scriptedClear(프리셋 A · 피하기 없음)', () => {
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 6], ['mage', 6], ['warrior', 7], ['mage', 7]])) {
    const { sim, log } = firstRift(cls, seed);
    assert.equal(sim.state.rift.guardianType, 'boneGiant', `${cls} 시드 ${seed}`);
    const r = scriptedClear(sim, { maxTicks: MIN * 15, untilComplete: true, learn: true });
    const rift = sim.state.rift;
    const why = `${cls} 시드 ${seed}: ${JSON.stringify({ ...r, deaths: rift.deaths, swarm: rift.stats.swarmMoments })}`;
    assert.equal(r.phase, 'complete', why);
    assert.ok(rift.deaths <= 2, why);   // 밸런스 게이트: ≤ 1 → ≤ 2(피하지 않으면 예고 기술이 아프다 — 무회피 ≥ 2배 목표의 다른 얼굴)
    assert.ok(r.riftTicks <= MIN * 12, why);   // 밸런스 게이트: 9 → 12분(피하지 않는 하네스 · 시드 1~16 중앙 8.9분)
    assert.ok(r.minLife < 0.6, `${why} — 긴장이 남는다(완화가 지나치면 포션 문턱 40% 근처까지도 내려가지 않는다)`);
    for (let i = 0; i < 60; i++) sim.step(NEUTRAL_INPUT);   // 완료 마무리(RIFT.completeDelay 1.5초)
    assert.ok(log.some(e => e.name === EV.RIFT_COMPLETE), why);
    assert.ok(sim.state.char.level >= 3, `${why} — 첫 판 안에 스킬 점수(XP.reqEarly)`);
    assertFiniteDeep(sim.state, cls);
  }
});

// 민감도(W1 수정 2): 시드 6 · 7 은 쉬운 판이라 첫 판 피해 경사를 0.3 까지 올려도 통과한다 — 시드 3(뼈 거인 · 지금 사망 1 · 1)은
// 균열 1 의 RIFT.earlyDmg 가 0.26 이면 전사 3 · 0.3 이면 전사 3 · 마법사 2 로 넘는다(NOTES-W1FIX §3.6). 문턱은 브리프의 「≤ 1」보다 하나 느슨하게(봇 아닌 하네스의 흔들림).
test('W1 수정 2: 첫 판 민감도 — 시드 3(수호자 뼈 거인) 두 클래스가 균열 1 을 사망 ≤ 2 로 완료한다', () => {
  for (const cls of /** @type {const} */ (['warrior', 'mage'])) {
    const { sim } = firstRift(cls, 3);
    assert.equal(sim.state.rift.guardianType, 'boneGiant', cls);
    const r = scriptedClear(sim, { maxTicks: MIN * 15, untilComplete: true, learn: true });
    const rift = sim.state.rift;
    const why = `${cls} 시드 3: ${JSON.stringify({ ...r, deaths: rift.deaths })}`;
    assert.equal(r.phase, 'complete', why);
    assert.ok(rift.deaths <= 2, why);
  }
});

/**
 * 쓰러진 채로 → 부활(마을 · 처음 자리) → 복귀 → 3초 가만히. 확인: 사망한 틱에 진정 · 플레이어가 남긴 피해원(투사체 · 효과 · 화상 · 감전 — W1 수정 3) 없음 ·
 * 부활 commit 뒤 잠든 몬스터가 모두 `homes` 자리 · 복귀 뒤 90틱 동안 깬 팩(MON_WAKE) 0 · 복귀 지점의 종류별 aggro 안에 깨어 있는 몬스터 0(수호자 포함).
 * @param {any} sim @param {Array<{name:string, payload:any}>} log @param {string} why @returns {{ret:{x:number, z:number}, phase:string}}
 */
function respawnAndReturn(sim, log, why) {
  const st = sim.state;
  const rift = st.rift;
  const phase = rift.phase;
  const tick = st.tick;
  assert.equal(st.player.dead, true, why);
  assert.equal(DEATH.calmSec, 0);
  assert.equal(rift.mons.filter(m => m.awake && alive(m)).length, 0, `${why}: 사망한 틱에 진정`);
  assert.equal(rift.calmAt, null, why);
  assert.equal(rift.projs.filter(p => p.owner === 'player' && p.until > tick).length, 0, `${why}: 플레이어 투사체가 남았다`);
  assert.equal(rift.effects.filter(e => e.owner === 'player' && e.end > tick).length, 0, `${why}: 플레이어 효과가 남았다`);
  assert.equal(rift.mons.filter(m => alive(m) && (m.st.burn || m.st.shockUntil > tick)).length, 0, `${why}: 화상 · 감전이 남았다`);
  // 부활 → 마을: 잠든 몬스터가 처음 자리로(전환 막 아래)
  assert.equal(sim.respawn().ok, true, why);
  sim.step(NEUTRAL_INPUT);
  assert.equal(sim.commitTravel().ok, true, why);
  assert.equal(st.scene, 'town', why);
  for (const m of rift.mons) {
    if (!alive(m) || !rift.homes[m.id]) continue;
    assert.ok(dist(m.pos, rift.homes[m.id]) < 1e-9, `${why}: 몬스터 ${m.id} 처음 자리`);
    assert.equal(m.awake, false, why);
  }
  // 복귀 → 3초 동안 가만히: 깨는 팩이 없다(입력 없이 — 남은 피해원 · 시야 · 연결)
  assert.equal(sim.returnToRift().ok, true, why);
  assert.equal(sim.commitTravel().ok, true, why);
  assert.equal(st.scene, 'rift', why);
  const ret = { ...st.player.pos };
  const from = log.length;
  let worst = null;
  for (let t = 0; t < 90; t++) {
    sim.step(NEUTRAL_INPUT);
    for (const m of rift.mons) {
      if (!m.awake || !alive(m)) continue;
      const d = dist(m.pos, ret);
      if (d <= getMonDef(m.typeId).aggro && !worst) worst = { id: m.id, typeId: m.typeId, d: +d.toFixed(2), t };
    }
  }
  const wakes = log.slice(from).filter(e => e.name === EV.MON_WAKE).map(e => e.payload);
  assert.equal(worst, null, `${why}: 복귀 3초 안에 깬 몬스터 ${JSON.stringify(worst)}`);
  assert.deepEqual(wakes, [], `${why}: 복귀 3초 안에 깬 팩`);
  assert.equal(st.player.dead, false, why);
  assertFiniteDeep(st, why);
  return { ret, phase };
}

/** 개발 캐릭터(L10 · 장비 ilvl 5 · 프리셋 A)가 균열 8 을 scriptedClear(learn)로 돌다 처음 쓰러진 틱에 멈춘다 @param {'warrior'|'mage'} cls @param {number} seed */
function devDeath(cls, seed, level = 10) {
  const s = newSim(seed);
  const ch = makeDevCharacter({ slot: 0, cls, name: cls, level, rift: 5, preset: 0, seed, newId: s.sim.ctx.newItemId });
  ch.riftUnlocked = 8;
  assert.equal(s.sim.loadCharacter(0, ch).ok, true);
  assert.equal(s.sim.openRift(8, seed).ok, true);
  assert.equal(s.sim.commitTravel().ok, true);
  scriptedClear(s.sim, { maxTicks: MIN * 12, untilComplete: true, learn: true, stopOnDeath: true });
  assert.equal(s.sim.state.player.dead, true, `${cls} 시드 ${seed}: 균열 8 에서 쓰러진다`);
  return s;
}

test('W1 수정: 사망 → 부활 → 복귀(강제 사망) — 떼 한가운데에서 쓰러져도 그 틱에 진정 · 부활로 떠날 때 처음 자리(rift.homes)로 · 복귀 뒤 3초 동안 깨는 몬스터 0', () => {
  // 전사 5 · 마법사 3(떼 8): 옛 규칙(calmSec 1 · 집 없음 · 여유 없음)에서 실패하는 판(복귀 1틱 뒤 aggro 안에 11 · 17마리)
  // 마법사 7(떼 12 · W1 수정 3): 재검증의 「날아가던 마법 화살(번개)이 복귀 11틱 뒤 잠든 몬스터를 맞혀 팩 11마리를 깨운」 판
  for (const [cls, seed, swarm, bolt] of /** @type {const} */ ([['warrior', 5, 8, false], ['mage', 3, 8, false], ['mage', 7, 12, true]])) {
    const why = `${cls} 시드 ${seed} 떼 ${swarm}`;
    const { sim, log } = firstRift(cls, seed);
    const st = sim.state;
    // 떼 한가운데까지(무적으로 싸우며 들어간다) — 15m 안에 깨어 있는 몬스터가 swarm 이상
    sim.debugSetInvincible(true);
    const awakeNear = (pos, r) => st.rift.mons.filter(m => m.awake && alive(m) && dist(m.pos, pos) <= r).length;
    for (let i = 0; i < 400 && awakeNear(st.player.pos, 15) < swarm; i++) scriptedClear(sim, { maxTicks: 15 });
    assert.ok(awakeNear(st.player.pos, 15) >= swarm, `${why}: 떼 ${awakeNear(st.player.pos, 15)}`);
    const rift = st.rift;
    // 몰려들게 2초 더 — bolt 판은 떼가 다가오는 그 틱에 쓰러진다: 날아가는 마법 화살이 있다(떼에 둘러싸이면 화살이 바로 맞아 날지 않는다).
    // 옛 규칙이면 화살이 마을에서 멈춰 있다가 복귀 뒤 잠든 몬스터를 맞혀 팩째 깨웠다(재검증 — 복귀 11틱 뒤 11마리)
    if (bolt) assert.ok(rift.projs.some(p => p.owner === 'player' && p.until > st.tick), `${why}: 날아가는 화살`);
    else scriptedClear(sim, { maxTicks: 60 });
    sim.debugSetInvincible(false);
    const moved = rift.mons.filter(m => alive(m) && rift.homes[m.id] && dist(m.pos, rift.homes[m.id]) > 1).length;
    assert.ok(moved >= 5, `${why}: 자리를 떠난 몬스터 ${moved}`);
    sim.ctx.hooks.onPlayerKilled(sim.ctx, null);
    respawnAndReturn(sim, log, why);
    assert.ok(log.some(e => e.name === EV.PLAYER_DIED));
  }
});

test('W1 수정 3: 사망 → 부활 → 복귀(자연 사망 · 개발 캐릭터 균열 8) — 남은 화상 · 투사체 · 효과가 복귀 뒤 잠든 몬스터를 깨우지 않는다', () => {
  // 옛 규칙(사망 때 플레이어 투사체 · 효과 · 화상을 남김)이면 복귀 뒤 화상 틱이 잠든 팩을 깨워 연결로 번졌다(NOTES-W1FIX §3.8)
  for (const [cls, seed, n] of /** @type {const} */ ([['mage', 9, 2], ['mage', 12, 1], ['warrior', 9, 1]])) {
    const { sim, log } = devDeath(cls, seed);
    for (let k = 1; k <= n; k++) {
      const why = `${cls} 시드 ${seed} 자연 사망 ${k}`;
      if (k > 1) {
        scriptedClear(sim, { maxTicks: MIN * 12, untilComplete: true, learn: true, stopOnDeath: true });
        assert.equal(sim.state.player.dead, true, why);
      }
      const { phase } = respawnAndReturn(sim, log, why);
      assert.equal(phase, 'active', why);
    }
  }
});

test('W1 수정 3: 수호자 단계 사망 → 복귀 — 집으로 돌아간 수호자의 시야 밖으로 돌아오고, 다가가면 싸움이 다시 시작된다(수호자 생명 그대로)', () => {
  // 마법사 시드 10: 처음 사망이 수호자 단계(옛 규칙이면 복귀 지점이 수호자 7.6m 앞 · 3틱 만에 다시 깼다)
  // 밸런스 게이트: 몬스터 수치가 바뀌어 레벨 10 개발 캐릭터는 수호자 전에 쓰러진다 — 레벨 14 · 시드 1(처음 사망이 수호자 단계 — 시드 1 · 3 · 13 · 27 · 40)
  const { sim, log } = devDeath('mage', 1, 14);
  const st = sim.state;
  const rift = st.rift;
  assert.equal(rift.phase, 'guardian');
  const g = rift.mons.find(m => m.id === rift.guardianId);
  assert.ok(g && alive(g));
  const hp = g.hp;
  const { ret } = respawnAndReturn(sim, log, 'mage 시드 10 수호자 단계');
  assert.equal(g.awake, false);
  assert.equal(g.hp, hp, '수호자 생명은 그대로');
  assert.ok(dist(ret, rift.homes[g.id]) > getMonDef(g.typeId).aggro || !losClear(sim.ctx.map, g.pos.x, g.pos.z, ret.x, ret.z), '복귀 지점은 수호자 시야 밖');
  // 다가가면(scriptedClear 가 가장 가까운 몬스터 쪽으로 간다) 수호자가 다시 깬다 — 생명은 이어서
  let woke = false;
  for (let i = 0; i < 60 && !woke && !st.player.dead; i++) {
    scriptedClear(sim, { maxTicks: 15, untilComplete: true, learn: true, stopOnDeath: true });
    woke = g.awake;
  }
  assert.ok(woke, '다가가면 싸움이 다시 시작된다');
  assert.ok(g.hp <= hp);
});

test('W1 수정 4: 수호자 출현 예고(2초) 안에 쓰러져 그 안에 부활 → 복귀 — 수호자는 부활 commit 에 잠든 채 서고, 복귀 지점은 그 시야 밖 · 다가가면 깬다', () => {
  // 재검증의 판: 마법사 시작 캐릭터 시드 21 · 균열 1 · 게이지 100% 20틱 뒤 쓰러짐 · 9틱 뒤 부활.
  // 옛 규칙이면 남은 예고가 복귀 뒤로 밀려(shiftTicks) 수호자가 복귀 30틱 뒤 8.6m 앞에 깨어 나타나 걸어왔다.
  const { sim, log } = firstRift('mage', 21);
  const st = sim.state;
  const rift = st.rift;
  sim.debugSetInvincible(true);
  scriptedClear(sim, { maxTicks: MIN * 20, learn: true });
  assert.equal(rift.phase, 'guardian');
  assert.ok(rift.guardianSpawn && rift.guardianId === null, '게이지 100% — 출현 예고 중');
  for (let i = 0; i < 20; i++) sim.step(NEUTRAL_INPUT);
  sim.debugSetInvincible(false);
  sim.ctx.hooks.onPlayerKilled(sim.ctx, null);
  for (let i = 0; i < 9; i++) sim.step(NEUTRAL_INPUT);
  assert.ok(rift.guardianSpawn && rift.guardianId === null, '아직 예고 중에 부활한다');
  const why = 'mage 시드 21 예고 중 사망';
  const { ret, phase } = respawnAndReturn(sim, log, why);
  assert.equal(phase, 'guardian');
  const g = rift.mons.find(m => m.id === rift.guardianId);
  assert.ok(g && alive(g), `${why}: 부활 commit 에서 세웠다`);
  assert.equal(g.awake, false, why);
  assert.equal(g.hp, g.hpMax, why);
  assert.equal(rift.guardianSpawn, null, why);
  assert.ok(dist(ret, g.pos) > getMonDef(g.typeId).aggro || !losClear(sim.ctx.map, g.pos.x, g.pos.z, ret.x, ret.z), `${why}: 복귀 지점은 수호자 시야 밖`);
  let woke = false;
  for (let i = 0; i < 60 && !woke && !st.player.dead; i++) {
    scriptedClear(sim, { maxTicks: 15, untilComplete: true, learn: true, stopOnDeath: true });
    woke = g.awake;
  }
  assert.ok(woke, `${why}: 다가가면 싸움이 시작된다`);
});

// 시드는 W1 수정 2 의 실측(NOTES-W1FIX §3.3): 지금 값이면 붕괴(전사 4 · 3.7분 · 마법사 1 · 6.4분) · 첫 수정의 전역 완화(MON.dmgBase 0.9 · 궁수 0.5)면 사망 0 · 최저 생명 0.90 · 0.67.
// W2 밸런스 게이트가 위협 수치를 다시 맞추면 시드를 다시 고른다(이 검사는 「완화가 전역으로 새지 않는다」만 본다).
test('W1 수정 2 · 밸런스 게이트: 첫 판 완화(균열 1~11 경사)가 해금 최고 + 3 의 위협을 지우지 않는다 — 개발 캐릭터(L10 · 장비 ilvl 5 · 프리셋 A)가 균열 8(해금 최고 + 3)에서 피하기 없이 두 번 이상 쓰러진다', () => {
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 4], ['mage', 1]])) {
    const { sim } = newSim(seed);
    const ch = makeDevCharacter({ slot: 0, cls, name: cls, level: 10, rift: 5, preset: 0, seed, newId: sim.ctx.newItemId });
    ch.riftUnlocked = 8;
    assert.equal(sim.loadCharacter(0, ch).ok, true);
    assert.equal(sim.openRift(8, seed).ok, true);
    assert.equal(sim.commitTravel().ok, true);
    const r = scriptedClear(sim, { maxTicks: MIN * 12, untilComplete: true, learn: true });
    const rift = sim.state.rift;
    const why = `${cls} 시드 ${seed}: ${JSON.stringify({ ...r, deaths: rift.deaths, taken: Math.round(rift.stats.dmgTaken) })}`;
    assert.ok(rift.deaths >= 2, why);
    assert.equal(r.minLife, 0, why);
    assertFiniteDeep(sim.state, cls);
  }
});

// ───────────────────────── 피드백 1 — 회전 베기 정타 처치 수 ─────────────────────────
// Jay 피드백(2026-10-12): 「광역 스킬을 두 번에서 세 번 정도 정통으로 맞으면 몬스터가 죽는 게 좋다」 — 회전 베기(groundStomp · spinSlash) 정타 한 번 =
// 그 랭크의 판정 정의 그대로(hitSpec · 치명타 · 조건부 패시브 포함 · 넉백은 빼고 같은 자리)를 일반 몬스터(구울 · 소인 · 궁수 · 방패 해골)가 쓰러질 때까지.
// 기준(계약 §7.14 「피드백 1」): 적정 레벨 = 봇 basic 세션이 고른 균열 레벨과 그때의 캐릭터 레벨(4시드 중앙) · 장비 = makeDevCharacter(README 「바로 해 보기」 주소와 같은 개발 캐릭터) ·
// 첫 판 = 시작 장비(새 캐릭터 · 레벨 · 랭크만 그 순간). 데이터(계수 · 반지름 · 몬스터 생명)를 바꾸면 깨진다 — 다시 재고 계약 표를 고친다.
const NORMAL_TYPES = ['ghoul', 'fallen', 'skeletonArcher', 'shieldSkeleton'];

/** 균열 rift 에 선 sim(무적 · 몬스터 없음) — char 가 없으면 개발 캐릭터(level · 프리셋 A) */
function standAt({ cls, level, rift, seed, char = null }) {
  const { sim } = newSim(seed);
  const ch = char ?? makeDevCharacter({ slot: 0, cls, name: cls, level, rift, preset: 0, seed, newId: sim.ctx.newItemId });
  assert.equal(sim.loadCharacter(0, ch).ok, true);
  sim.debugOpenRift(rift, seed);
  if (sim.state.pendingTravel) sim.commitTravel();
  for (const m of sim.state.rift.mons) m.gone = true;
  sim.debugSetInvincible(true);
  sim.step(NEUTRAL_INPUT);
  return sim;
}

/** 정타 처치 수(trials 번 평균) — 몬스터를 플레이어 앞 1.2m 에(방패 해골은 플레이어를 본다) */
function hitsToKill(sim, skillId, typeId, trials) {
  const ctx = sim.ctx, st = sim.state, p = st.player;
  const def = getSkillDef(skillId);
  const rank = Math.max(1, st.char.skills.ranks[skillId] ?? 1);
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    const x = p.pos.x, z = p.pos.z + 1.2;
    const m = spawnMonster(ctx, { typeId, rank: 'normal', level: st.rift.level, x, z, facing: Math.PI, awake: false });
    let n = 0;
    while (!m.dead && m.hp > 0 && n < 40) {
      n++;
      const spec = hitSpec(skillId, def, rank, ctx.nextId(), p.pos.x, p.pos.z);
      delete spec.knock;
      m.pos = { x, z };
      m.act = 'idle';
      m.facing = Math.PI;
      playerHitShape(ctx, circle(x, z, 0.01), spec);
      st.tick += 18;
    }
    sum += n;
    m.gone = true;
    m.dead = true;
  }
  return sum / trials;
}

test('피드백 1: 회전 베기 정타 처치 수 — 적정 레벨(개발 캐릭터) 일반 몬스터 중앙 2~3번 · 시작 장비 첫 판 2~3번(옛 지면 강타 ~3.1)', (t) => {
  const dev = [];
  // (균열 · 캐릭터 레벨) = 봇 basic 4시드 세션이 그 균열을 돌 때의 캐릭터 레벨(계약 §7.14 피드백 1 표)
  for (const [rift, level] of [[3, 8], [5, 11], [10, 19], [15, 27]]) {
    const sim = standAt({ cls: 'warrior', level, rift, seed: 1 });
    const row = NORMAL_TYPES.map(t => hitsToKill(sim, 'groundStomp', t, 24));
    const why = `균열 ${rift} · 레벨 ${level}: ${row.map(v => v.toFixed(2)).join(' · ')}`;
    for (const v of row) assert.ok(v >= 1.2 && v <= 3.5, why);
    dev.push(...row);
  }
  const sorted = [...dev].sort((a, b) => a - b);
  const median = (sorted[(sorted.length >> 1) - 1] + sorted[sorted.length >> 1]) / 2;
  const mean = dev.reduce((a, b) => a + b, 0) / dev.length;
  t.diagnostic(`적정 레벨(개발 장비) 중앙 ${median.toFixed(2)} · 평균 ${mean.toFixed(2)}`);
  assert.ok(median >= 1.9 && median <= 3, `적정 레벨 중앙 ${median.toFixed(2)}`);
  assert.ok(mean >= 1.8 && mean <= 3, `적정 레벨 평균 ${mean.toFixed(2)}`);
  // 시작 장비 — 새 캐릭터(검 · 갑옷) · 첫 판에서 오르는 레벨 · 랭크(프리셋 A 의 순서)
  const first = [];
  for (const [rift, level, rank] of [[1, 2, 1], [1, 4, 2], [2, 6, 3]]) {
    const { sim: s0 } = newSim(5);
    assert.equal(s0.newCharacter({ slot: 0, cls: 'warrior', name: 'w' }).ok, true);
    const ch = JSON.parse(JSON.stringify(s0.state.char));
    ch.level = level;
    ch.skills.ranks = { groundStomp: rank };
    ch.skills.bar = ['groundStomp', null, null, null, null];
    const sim = standAt({ cls: 'warrior', rift, seed: 5, char: ch });
    first.push(...NORMAL_TYPES.map(t => hitsToKill(sim, 'groundStomp', t, 24)));
  }
  const fm = first.reduce((a, b) => a + b, 0) / first.length;
  t.diagnostic(`시작 장비 첫 판 평균 ${fm.toFixed(2)} — ${first.map(v => v.toFixed(2)).join(' · ')}`);
  // 위 끝 3.0 = Jay 「두세 번」 — 옛 계수(1.05/+0.11)는 이 표에서 3.02 로 걸린다(수정 단계 변이 실측 · 지금 값 2.76)
  assert.ok(fm >= 2.2 && fm <= 3.0, `첫 판 평균 ${fm.toFixed(2)} — ${first.map(v => v.toFixed(2)).join(' · ')}`);
});
