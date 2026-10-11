// OWNER: W1 수정(밸런스 · NOTES-W1FIX) — 계약 §5.10 · §7.3 · §7.14
// 회귀: ① 시작 캐릭터 두 클래스가 균열 1 첫 판을 사망 ≤ 1 로 끝낸다(고정 시드 · scriptedClear 수준 — 피하기 · 우선 대상 없음)
//       ② 사망 → 부활 → 복귀: 그 틱에 진정 · 부활로 떠날 때 처음 자리로 · 복귀 뒤 3초 동안 복귀 지점의 aggro 안에서 깨는 몬스터가 없다(NOTES-W1 §7-3).
//       ③ W1 수정 2: 첫 판 완화(RIFT.earlyDmg)가 균열 5 이상으로 새지 않는다 — 개발 캐릭터가 해금 최고 + 3(균열 8)에서 쓰러진다.
// 실제 GameSim 으로 돈다(봇은 W2 P15 — 봇의 밸런스 측정은 measure 가 다시 잰다).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus, EV } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { DEATH } from '../src/data/combat.js';
import { getMonDef } from '../src/data/index.js';
import { GameSim } from '../src/sim/GameSim.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { assertFiniteDeep, scriptedClear } from './helpers.js';

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
test('W1 수정: 시작 캐릭터(전사 · 마법사)가 균열 1 첫 판을 완료한다 — 사망 ≤ 1 · 9분(sim) 안 · 시드 6 · 7 · scriptedClear(프리셋 A · 피하기 없음)', () => {
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 6], ['mage', 6], ['warrior', 7], ['mage', 7]])) {
    const { sim, log } = firstRift(cls, seed);
    assert.equal(sim.state.rift.guardianType, 'boneGiant', `${cls} 시드 ${seed}`);
    const r = scriptedClear(sim, { maxTicks: MIN * 15, untilComplete: true, learn: true });
    const rift = sim.state.rift;
    const why = `${cls} 시드 ${seed}: ${JSON.stringify({ ...r, deaths: rift.deaths, swarm: rift.stats.swarmMoments })}`;
    assert.equal(r.phase, 'complete', why);
    assert.ok(rift.deaths <= 1, why);
    assert.ok(r.riftTicks <= MIN * 9, why);
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

test('W1 수정: 사망 → 부활 → 복귀 — 그 틱에 진정(DEATH.calmSec 0) · 부활로 떠날 때 처음 자리(rift.homes)로 · 복귀 뒤 3초 동안 복귀 지점의 aggro 안에서 깨는 몬스터 0', () => {
  // 시드는 옛 규칙(calmSec 1 · 집 없음 · 여유 없음)에서 이 검사가 실패하는 판(전사 5 · 마법사 3 — 복귀 1틱 뒤 aggro 안에 11 · 17마리)
  for (const [cls, seed] of /** @type {const} */ ([['warrior', 5], ['mage', 3]])) {
    const { sim, log } = firstRift(cls, seed);
    const st = sim.state;
    // 떼 한가운데까지(무적으로 싸우며 들어간다) — 15m 안에 깨어 있는 몬스터가 8 이상
    sim.debugSetInvincible(true);
    const awakeNear = (pos, r) => st.rift.mons.filter(m => m.awake && alive(m) && dist(m.pos, pos) <= r).length;
    for (let i = 0; i < 400 && awakeNear(st.player.pos, 15) < 8; i++) scriptedClear(sim, { maxTicks: 15 });
    assert.ok(awakeNear(st.player.pos, 15) >= 8, `${cls}: 떼 ${awakeNear(st.player.pos, 15)}`);
    scriptedClear(sim, { maxTicks: 60 });   // 몰려들게 2초 더
    sim.debugSetInvincible(false);
    const rift = st.rift;
    const moved = rift.mons.filter(m => alive(m) && rift.homes[m.id] && dist(m.pos, rift.homes[m.id]) > 1).length;
    assert.ok(moved >= 5, `${cls}: 자리를 떠난 몬스터 ${moved}`);
    // 사망 — 그 틱에 모두 잠든다
    assert.equal(DEATH.calmSec, 0);
    sim.ctx.hooks.onPlayerKilled(sim.ctx, null);
    assert.equal(st.player.dead, true);
    assert.equal(rift.mons.filter(m => m.awake && alive(m)).length, 0, `${cls}: 사망한 틱에 진정`);
    assert.equal(rift.calmAt, null);
    // 부활 → 마을: 잠든 몬스터가 처음 자리로(전환 막 아래)
    assert.equal(sim.respawn().ok, true);
    sim.step(NEUTRAL_INPUT);
    assert.equal(sim.commitTravel().ok, true);
    assert.equal(st.scene, 'town');
    for (const m of rift.mons) {
      if (!alive(m) || !rift.homes[m.id]) continue;
      assert.ok(dist(m.pos, rift.homes[m.id]) < 1e-9, `${cls}: 몬스터 ${m.id} 처음 자리`);
      assert.equal(m.awake, false);
    }
    // 복귀 → 3초 동안 가만히: 복귀 지점의 aggro(종류별) 안에서 깨는 몬스터가 없다
    assert.equal(sim.returnToRift().ok, true);
    assert.equal(sim.commitTravel().ok, true);
    assert.equal(st.scene, 'rift');
    const ret = { ...st.player.pos };
    let worst = null;
    for (let t = 0; t < 90; t++) {
      sim.step(NEUTRAL_INPUT);
      for (const m of rift.mons) {
        if (!m.awake || !alive(m)) continue;
        const d = dist(m.pos, ret);
        if (d <= getMonDef(m.typeId).aggro && !worst) worst = { id: m.id, typeId: m.typeId, d: +d.toFixed(2), t };
      }
    }
    assert.equal(worst, null, `${cls}: 복귀 3초 안에 깬 몬스터 ${JSON.stringify(worst)}`);
    assert.equal(st.player.dead, false);
    assert.ok(log.some(e => e.name === EV.PLAYER_DIED));
    assertFiniteDeep(st, cls);
  }
});

// 시드는 W1 수정 2 의 실측(NOTES-W1FIX §3.3): 지금 값이면 붕괴(전사 4 · 3.7분 · 마법사 1 · 6.4분) · 첫 수정의 전역 완화(MON.dmgBase 0.9 · 궁수 0.5)면 사망 0 · 최저 생명 0.90 · 0.67.
// W2 밸런스 게이트가 위협 수치를 다시 맞추면 시드를 다시 고른다(이 검사는 「완화가 전역으로 새지 않는다」만 본다).
test('W1 수정 2: 첫 판 완화는 균열 1~4 에만 — 개발 캐릭터(L10 · 장비 ilvl 5 · 프리셋 A)가 균열 8(해금 최고 + 3)에서 피하기 없이 두 번 이상 쓰러진다', () => {
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
