// OWNER: P2 — 계약 §12.2 · §5.1 · §5.11 · §4.1 · §6.8
// 틱 순서 · 재진입 안전 플러시 · 명령의 Result · pendingTravel 동안 step · commitTravel 전부 · 마을/균열 왕복(시각 밀기) · 부활 → 복귀 ·
// debugLoadState · newCharacter/loadCharacter 뒤 생명 가득 · unloadCharacter · 균열 장면이면 ctx.flow 가 늘 있다 · 결정성 · 고정 상태 15 견고성 ·
// pickHover · 디버그 명령. 남의 W1 구현의 결과(첫 재고 · 기록 · 균열 1 완주)는 그 파일이 스텁이면 건너뛴다(통합 게이트에서 돈다).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EventBus, EV } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { NEUTRAL_INPUT, makeInput } from '../src/core/inputFrame.js';
import { circle } from '../src/core/shapes.js';
import { ticks } from '../src/core/time.js';
import { DEATH, PICKUP } from '../src/data/combat.js';
import { TOWN } from '../src/data/town.js';
import { FIXTURES } from '../src/debug/fixtures.js';
import { GameSim } from '../src/sim/GameSim.js';
import { killPlayer, openRecallPortal, spawnGuardianNow } from '../src/sim/rift.js';
import { RIFT } from '../src/data/rift.js';
import { nearestWalkable } from '../src/sim/world/nav.js';
import { pickHover } from '../src/sim/pick.js';
import { createPlayerState } from '../src/sim/state.js';
import { createCharacter } from '../src/sim/progression/character.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import { buildTownMap } from '../src/sim/world/townMap.js';
import { addTestMonster, assertFiniteDeep, makeTestMap, makeTestState, randomInputs, scriptedClear } from './helpers.js';

/** 그 파일들 중 아직 스텁(파일 머리의 스텁 표시 줄)인 것 @param {string[]} rels */
const stubbed = (...rels) => rels.filter(r => /^\/\/ STUB\b/m.test(readFileSync(new URL('../' + r, import.meta.url), 'utf8')));
const skipIf = (...rels) => {
  const s = stubbed(...rels);
  return s.length ? `스텁: ${s.join(', ')} — 통합 게이트에서` : false;
};

/** 새 세션 + 이벤트 기록 @param {number} [seed] */
function newSim(seed = 3) {
  const bus = new EventBus();
  const log = /** @type {Array<{name:string, payload:any}>} */ ([]);
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed, devSession: true });
  sim.start();
  return { sim, bus, log };
}

/** 캐릭터를 만들고 균열 1 을 연 세션 — empty 면 몬스터 · 팩을 비운다(검사가 내용을 정한다) */
function riftSim({ seed = 3, cls = 'warrior', empty = true } = {}) {
  const s = newSim(seed);
  assert.equal(s.sim.newCharacter({ slot: 0, cls, name: 'T' }).ok, true);
  assert.equal(s.sim.openRift(1).ok, true);
  assert.equal(s.sim.commitTravel().ok, true);
  if (empty) {
    s.sim.state.rift.mons = [];
    s.sim.state.rift.packs = [];
  }
  s.log.length = 0;
  return s;
}

const names = (log) => log.map(e => e.name);

test('step: 0(tick) → 1(playSec · prevPos 값 복사) → … · pendingTravel 이 있거나 캐릭터가 없으면 tick 만 민다', () => {
  const { sim } = newSim();
  sim.step(NEUTRAL_INPUT);
  assert.equal(sim.state.tick, 1, '캐릭터 없음 — tick 만');
  const { sim: s2 } = riftSim();
  const st = s2.state;
  const p = st.player;
  const m = addTestMonster(s2.ctx, { x: p.pos.x + 9, z: p.pos.z + 9, awake: false });
  m.prevPos = { x: 0, z: 0 };
  p.prevPos = { x: 0, z: 0 };
  const t0 = st.tick, ticks0 = st.rift.ticksIn, play0 = st.char.playSec;
  s2.step(NEUTRAL_INPUT);
  assert.equal(st.tick, t0 + 1);
  assert.equal(st.rift.ticksIn, ticks0 + 1);
  assert.ok(Math.abs(st.char.playSec - play0 - 1 / 30) < 1e-12);
  assert.ok(m.prevPos.x !== 0 && p.prevPos.x !== 0, '직전 값 복사(잠든 것 포함)');
  assert.notEqual(m.prevPos, m.pos);
  st.pendingTravel = { to: 'town', reason: 'debug' };
  s2.step(NEUTRAL_INPUT);
  assert.equal(st.tick, t0 + 2);
  assert.equal(st.rift.ticksIn, ticks0 + 1, '전환 대기 중에는 균열이 돌지 않는다');
  assert.ok(Math.abs(st.char.playSec - play0 - 1 / 30) < 1e-12);
  assert.ok(s2.ctx.flow, '균열 장면이면 ctx.flow 가 있다');
});

test('틱 순서(§5.1-6 · 7): 투사체 → 효과 → 화상 → 사망 정리 → 자동 줍기 → cleanup — 한 틱의 이벤트 순서', () => {
  const { sim, log } = riftSim();
  const st = sim.state, ctx = sim.ctx, p = st.player;
  const px = p.pos.x, pz = p.pos.z;
  const A = addTestMonster(ctx, { x: px + 6, z: pz, hp: 1e6, awake: false });
  const B = addTestMonster(ctx, { x: px - 6, z: pz, hp: 1e6, awake: false });
  const C = addTestMonster(ctx, { x: px, z: pz - 6, hp: 1e6, awake: false });
  const D = addTestMonster(ctx, { x: px, z: pz + 6, hp: 0, awake: false });
  D.lastHit = { by: 'env', skillId: null, noProcs: true, frozen: false };
  const t = st.tick + 1;
  const spec = { skillId: 'bash', coef: 1, type: 'phys', tags: ['projectile'], actionId: 77, srcX: px, srcZ: pz };
  st.rift.projs.push({ id: ctx.nextId(), visual: 'magicBolt', owner: 'player', srcId: -1, pos: { x: px + 5.3, z: pz }, prevPos: { x: px + 5.3, z: pz }, vel: { x: 6, z: 0 }, r: 0.25, born: t - 5, until: t + 20, pierce: 0, hitIds: [], bounce: false, spec, explode: null });
  st.rift.effects.push({ id: ctx.nextId(), kind: 'stomp', owner: 'player', srcId: -1, packId: -1, cancelOnSrcDeath: false, hostile: false, shape: circle(B.pos.x, B.pos.z, 1), start: t - 10, hitAt: t, end: t + 1, tickT: 0, nextTickAt: -1, resolved: false, spec: { ...spec, actionId: 78, tags: ['aoe'] }, tickSpec: null, from: null });
  C.st.burn = { dps: 4, until: t + 60, nextAt: t };
  st.rift.drops.push({ id: ctx.nextId(), kind: 'gold', pos: { x: px + 0.5, z: pz }, from: { x: px, z: pz }, born: t - 3, item: null, amount: 9, mat: null, rarity: null, gone: false });
  sim.step(NEUTRAL_INPUT);
  const order = names(log);
  const at = (n, f = () => true) => log.findIndex(e => e.name === n && f(e.payload));
  const iProj = at(EV.PROJ_END, x => x.reason === 'hit');
  const iFx = at(EV.EFFECT_HIT);
  const iBurn = at(EV.HIT, x => x.dot && x.targetId === C.id);
  const iDied = at(EV.MON_DIED, x => x.id === D.id);
  const iPick = at(EV.DROP_PICKED);
  assert.ok(iProj >= 0 && iFx > iProj && iBurn > iFx && iDied > iBurn && iPick > iDied, order.join(' '));
  assert.equal(st.rift.drops.length, 0, '같은 틱 cleanup 이 주운 드랍을 뺐다');
  assert.equal(st.rift.projs.length, 0, '끝난 투사체(until = tick)도 같은 틱에');
  assert.equal(st.rift.effects.length, 1, '판정한 효과는 end(= hitAt + 1) 틱에 빠진다');
  assert.equal(st.rift.effects[0].resolved, true);
  assert.ok(A.hp < 1e6 && B.hp < 1e6 && C.hp < 1e6);
  assert.equal(st.char.gold, 9);
  sim.step(NEUTRAL_INPUT);
  assert.equal(st.rift.effects.length, 0);
});

test('재진입 안전 플러시: 리스너가 플러시 도중 부른 명령의 이벤트는 큐 뒤에 쌓였다가 같은 플러시에서 순서대로 나간다', () => {
  const { sim, bus, log } = newSim();
  let inner = null;
  bus.on(EV.CHAR_LOADED, () => { inner = sim.markHint('controls'); });
  const r = sim.newCharacter({ slot: 1, cls: 'mage', name: '마법사' });
  assert.equal(r.ok, true);
  assert.deepEqual(inner, { ok: true });
  const saves = log.filter(e => e.name === EV.SAVE_REQUEST).map(e => e.payload.reason);
  assert.deepEqual(saves, ['new', 'hint'], '바깥 명령의 이벤트가 먼저 다 나간 뒤');
  assert.equal(sim.state.events.length, 0);
  assert.equal(sim.state.char.hints.controls, true);
});

test('newCharacter · loadCharacter: 생명 가득(자리 값 1 이 아니다) · 마을 도착점 · CHAR_LOADED · PLAYER_SPAWNED · HINT town · SAVE{all, new} · 잘못된 입력은 Result', () => {
  const { sim, log } = newSim();
  assert.deepEqual(sim.newCharacter({ slot: 9, cls: 'warrior', name: 'x' }), { ok: false, reason: 'slot' });
  assert.deepEqual(sim.newCharacter({ slot: 0, cls: 'warrior', name: '  ' }), { ok: false, reason: 'name' });
  assert.deepEqual(sim.newCharacter({ slot: 0, cls: 'rogue', name: 'x' }), { ok: false, reason: 'class' });
  const r = sim.newCharacter({ slot: 0, cls: 'warrior', name: '전사' });
  assert.equal(r.ok, true);
  const p = sim.state.player;
  assert.ok(p.lifeMax > 1 && p.life === p.lifeMax, `${p.life}/${p.lifeMax}`);
  assert.equal(p.lifeMax, sim.getStats().lifeMax);
  assert.deepEqual(p.pos, { x: TOWN.arrive.x, z: TOWN.arrive.z });
  assert.equal(sim.state.account.chars[0].name, '전사');
  assert.equal(sim.state.account.lastSlot, 0);
  const n = names(log);
  assert.ok(n.includes(EV.CHAR_LOADED) && n.includes(EV.PLAYER_SPAWNED));
  assert.ok(log.some(e => e.name === EV.HINT && e.payload.id === 'town'));
  assert.ok(log.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'all' && e.payload.reason === 'new'));
  // 불러온 캐릭터(마법사 레벨 7)
  const ch = createCharacter({ slot: 2, cls: 'mage', name: 'M', newId: sim.ctx.newItemId, seed: 5 });
  ch.level = 7;
  sim.state.player.life = 1;
  assert.equal(sim.loadCharacter(2, ch).ok, true);
  const q = sim.state.player;
  assert.ok(q.lifeMax > 90 && q.life === q.lifeMax);
  assert.equal(q.resource, q.resourceMax, '마나 가득');
  assert.deepEqual(sim.loadCharacter(5, ch), { ok: false, reason: 'slot' });
  assert.deepEqual(sim.loadCharacter(1, null), { ok: false, reason: 'invalid' });
});

test('첫 마을의 대장장이 · 잡화상에 재고가 있다(붙이기 순서의 restockShops)', { skip: skipIf('src/sim/progression/shops.js') }, () => {
  const { sim } = newSim();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'S' });
  const shop = sim.state.char.shop;
  assert.ok(shop.blacksmith.length > 0 && shop.general.length > 0);
  assert.equal(shop.stockRun, sim.state.char.runs);
});

test('명령의 Result: 장소 · 상태 검사(조용한 실패 없음)', () => {
  const { sim } = newSim();
  assert.deepEqual(sim.equip({ where: 'bag', idx: 0 }), { ok: false, reason: 'invalid' }, '캐릭터 없음');
  assert.deepEqual(sim.openRift(1), { ok: false, reason: 'invalid' });
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'R' });
  assert.deepEqual(sim.openRift(2), { ok: false, reason: 'locked' });
  assert.deepEqual(sim.openRift(0), { ok: false, reason: 'invalid' });
  assert.deepEqual(sim.returnToRift(), { ok: false, reason: 'noRift' });
  assert.deepEqual(sim.respawn(), { ok: false, reason: 'notDead' });
  assert.deepEqual(sim.leaveRift(), { ok: false, reason: 'notInRift' });
  assert.deepEqual(sim.markHint('nope'), { ok: false, reason: 'invalid' });
  assert.deepEqual(sim.commitTravel(), { ok: false, reason: 'nothing' });
  assert.equal(sim.openRift(1).ok, true);
  assert.deepEqual(sim.openRift(1), { ok: false, reason: 'busy' });
  assert.deepEqual(sim.buy('blacksmith', 0), { ok: false, reason: 'busy' });
  sim.commitTravel();
  for (const r of [sim.buy('blacksmith', 0), sim.sell({ where: 'bag', idx: 0 }), sim.repairAll(), sim.gamble('helm'), sim.craft('helm'), sim.buyPotions(1), sim.takeFree('potion'), sim.resetSkills(), sim.rerollCancel()]) {
    assert.deepEqual(r, { ok: false, reason: 'notInTown' });
  }
  assert.deepEqual(sim.openRift(1), { ok: false, reason: 'notInTown' });
  assert.deepEqual(sim.leaveRift(), { ok: false, reason: 'invalid' }, '완료 단계에서만');
  assert.deepEqual(sim.addPlaySec(1e9), { ok: true });
  assert.ok(sim.state.char.playSec <= 60 + 1e-9);
  assert.equal(sim.priceOf({ where: 'bag', idx: 0 }, 'sell'), null, '빈 칸');
  const eq = sim.priceOf({ where: 'equip', slot: 'mainHand' }, 'sell');
  assert.ok(eq === null || Number.isInteger(eq));
  assert.ok(sim.previewRift(1).unlocked);
});

test('commitTravel(openRift): 맵 생성 → 상태 → 채우기 → flow → runs + 1 → 생명 가득 → spawn · 도착 보호 · MAP_LOADED → SCENE_CHANGED → PLAYER_SPAWNED → SAVE', () => {
  const { sim, log } = newSim();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'O' });
  sim.state.player.life = 3;
  log.length = 0;
  sim.openRift(1, 1234);
  assert.ok(log.some(e => e.name === EV.TRAVEL_REQUEST && e.payload.to === 'rift' && e.payload.reason === 'openRift'));
  sim.step(NEUTRAL_INPUT);
  assert.equal(sim.state.scene, 'town', 'commit 전에는 그대로');
  log.length = 0;
  assert.deepEqual(sim.commitTravel(), { ok: true });
  const st = sim.state;
  assert.equal(st.scene, 'rift');
  assert.equal(st.pendingTravel, null);
  assert.equal(st.rift.seed, 1234);
  assert.equal(st.rift.level, 1);
  assert.equal(st.char.runs, 1);
  assert.equal(st.char.lastRiftLevel, 1);
  assert.ok(sim.ctx.flow && sim.ctx.riftMap === sim.getMap() && sim.getMap().kind === 'rift');
  assert.equal(st.player.life, st.player.lifeMax);
  assert.deepEqual(st.player.pos, { x: sim.getMap().spawn.x, z: sim.getMap().spawn.z });
  assert.equal(st.player.protectUntil, st.tick + ticks(DEATH.protectSec));
  assert.equal(st.town.portalOpen, true);
  const seq = names(log).filter(n => [EV.MAP_LOADED, EV.SCENE_CHANGED, EV.PLAYER_SPAWNED, EV.SAVE_REQUEST].includes(n));
  assert.deepEqual(seq.slice(-4), [EV.MAP_LOADED, EV.SCENE_CHANGED, EV.PLAYER_SPAWNED, EV.SAVE_REQUEST]);
  assert.ok(log.some(e => e.name === EV.RIFT_OPENED && e.payload.lives === 3));
  assert.ok(log.some(e => e.name === EV.HINT && e.payload.id === 'controls'));
  assert.equal(log.find(e => e.name === EV.SCENE_CHANGED).payload.reason, 'openRift');
  // seed 를 주지 않으면 hash32(state.seed, runs + 1) — 같은 세션 시드면 같은 균열
  const a = newSim(9), b = newSim(9);
  for (const s of [a, b]) { s.sim.newCharacter({ slot: 0, cls: 'mage', name: 'x' }); s.sim.openRift(1); s.sim.commitTravel(); }
  assert.equal(a.sim.state.rift.seed, b.sim.state.rift.seed);
  assertFiniteDeep(st);
});

test('마을 왕복: 귀환 → 마을(생명 · 자원 유지) → 복귀하면 rift 하위 시각을 떠난 틱부터 민다(예고 · 공격 · 속성 주기 · 시체 · killTicks · 수호자 예고) · returnPos · 귀환 포털 닫힘', () => {
  const { sim, log } = riftSim();
  const st = sim.state, ctx = sim.ctx, rift = st.rift, p = st.player;
  for (let i = 0; i < 10; i++) sim.step(NEUTRAL_INPUT);
  const m = addTestMonster(ctx, { x: p.pos.x + 9, z: p.pos.z + 9, awake: false });
  m.act = 'windup';
  m.actStart = st.tick - 5; m.actHit = st.tick + 10; m.actEnd = st.tick + 20;
  m.readyAt.claw = st.tick + 50;
  m.ax.shielding = { nextAt: st.tick + 40, warnUntil: st.tick + 3, count: 7 };
  m.st.stunUntil = st.tick + 15;
  const corpse = addTestMonster(ctx, { x: p.pos.x - 9, z: p.pos.z - 9, awake: false });
  corpse.dead = true; corpse.hp = 0; corpse.deadAt = st.tick - 10;
  const fx = { id: ctx.nextId(), kind: 'plague', owner: 'mon', srcId: m.id, packId: -1, cancelOnSrcDeath: false, hostile: true, shape: circle(5, 5, 2), start: st.tick - 3, hitAt: st.tick + 27, end: st.tick + 177, tickT: 15, nextTickAt: st.tick + 42, resolved: false, spec: null, tickSpec: {}, from: null };
  rift.effects.push(fx);
  rift.guardianSpawn = { x: 5, z: 5, at: st.tick + 30 };
  st.meter.killTicks = [st.tick - 2];
  p.life = p.lifeMax * 0.5;
  const leave = st.tick;
  const snap = { actHit: m.actHit, ready: m.readyAt.claw, axNext: m.ax.shielding.nextAt, warn: m.ax.shielding.warnUntil, count: m.ax.shielding.count, stun: m.st.stunUntil, deadAt: corpse.deadAt, hitAt: fx.hitAt, next: fx.nextTickAt, gAt: rift.guardianSpawn.at, kt: st.meter.killTicks[0], opened: rift.openedAt };
  const where = { x: p.pos.x, z: p.pos.z };
  assert.equal(openRecallPortal(ctx, where).ok, true);
  assert.equal(rift.leftAt, leave);
  sim.commitTravel();
  assert.equal(st.scene, 'town');
  assert.deepEqual(p.pos, { x: TOWN.arrive.x, z: TOWN.arrive.z });
  assert.ok(Math.abs(p.life - p.lifeMax * 0.5) < 1e-9, '생명 유지');
  assert.equal(sim.getMap().kind, 'town');
  assert.equal(sim.ctx.flow, null);
  for (let i = 0; i < 90; i++) sim.step(NEUTRAL_INPUT);
  assert.equal(fx.hitAt, snap.hitAt, '마을에 있는 동안 균열은 멈춰 있다');
  assert.equal(sim.returnToRift().ok, true);
  sim.commitTravel();
  const delta = st.tick - leave;
  assert.ok(delta >= 90);
  assert.equal(st.scene, 'rift');
  assert.ok(sim.ctx.flow);
  assert.equal(rift.leftAt, -1);
  assert.equal(m.actHit, snap.actHit + delta);
  assert.equal(m.readyAt.claw, snap.ready + delta);
  assert.equal(m.ax.shielding.nextAt, snap.axNext + delta);
  assert.equal(m.ax.shielding.warnUntil, snap.warn + delta);
  assert.equal(m.ax.shielding.count, snap.count, '시각이 아닌 숫자는 그대로');
  assert.equal(m.st.stunUntil, snap.stun + delta);
  assert.equal(corpse.deadAt, snap.deadAt + delta, '시체가 한꺼번에 사라지지 않는다');
  assert.equal(fx.hitAt, snap.hitAt + delta);
  assert.equal(fx.nextTickAt, snap.next + delta);
  assert.equal(rift.guardianSpawn.at, snap.gAt + delta);
  assert.equal(st.meter.killTicks[0], snap.kt + delta);
  assert.equal(rift.openedAt, snap.opened + delta);
  assert.deepEqual(p.pos, where, 'returnPos 로');
  assert.equal(rift.returnPos, null);
  assert.equal(rift.portals.filter(x => x.kind === 'recall').length, 0, '귀환 포털 닫힘');
  assert.equal(p.protectUntil, st.tick + ticks(DEATH.protectSec));
  assert.ok(log.some(e => e.name === EV.PORTAL_CLOSED));
  assert.ok(log.some(e => e.name === EV.PLAYER_SPAWNED && e.payload.reason === 'portal'));
  // 돌아온 첫 틱에 밀린 위협이 한꺼번에 터지지 않는다
  const before = log.filter(e => e.name === EV.PLAYER_HIT).length;
  sim.step(NEUTRAL_INPUT);
  assert.equal(log.filter(e => e.name === EV.PLAYER_HIT).length, before);
  assert.equal(fx.resolved, false);
});

test('사망 → 부활 → 복귀: 명령 두 번(respawn · returnToRift) + commit 두 번 · 부활은 생명 가득 · 포털 옆 · 복귀는 checkpoint · 붕괴면 균열이 닫힌다', () => {
  const { sim, log } = riftSim();
  const st = sim.state;
  for (let i = 0; i < 5; i++) sim.step(NEUTRAL_INPUT);
  const cp = { x: st.rift.checkpoint.x, z: st.rift.checkpoint.z };
  killPlayer(sim.ctx, null);
  sim.step(NEUTRAL_INPUT);
  assert.equal(st.player.dead, true);
  assert.ok(log.some(e => e.name === EV.PLAYER_DIED));
  assert.equal(sim.respawn().ok, true);
  sim.commitTravel();
  assert.equal(st.scene, 'town');
  assert.equal(st.player.dead, false);
  assert.equal(st.player.life, st.player.lifeMax);
  assert.deepEqual(st.player.pos, { x: TOWN.respawn.x, z: TOWN.respawn.z });
  assert.equal(st.player.killedBy, null);
  assert.equal(st.town.returnPrompt, true);
  assert.ok(log.some(e => e.name === EV.PLAYER_SPAWNED && e.payload.reason === 'respawn'));
  assert.equal(sim.returnToRift().ok, true);
  sim.commitTravel();
  assert.equal(st.scene, 'rift');
  assert.deepEqual(st.player.pos, cp);
  assert.equal(st.town.returnPrompt, false);
  assert.equal(st.rift.lives, 2);
  // 붕괴
  st.rift.lives = 0;
  killPlayer(sim.ctx, null);
  assert.equal(st.rift.phase, 'collapsed');
  sim.respawn();
  sim.commitTravel();
  assert.equal(st.rift, null);
  assert.ok(log.some(e => e.name === EV.RIFT_CLOSED && e.payload.reason === 'collapse'));
  assert.equal(st.town.portalOpen, false);
  assert.deepEqual(sim.returnToRift(), { ok: false, reason: 'noRift' });
});

test('완료 뒤 나가기(leaveRift) → 마을 → 다시 들어가면 그 자리(남은 전리품) · 새 균열을 열면 이전 균열은 닫힌다(활동 중이면 기록 abandon)', () => {
  const { sim, log } = riftSim();
  const st = sim.state;
  assert.equal(sim.debugCompleteRift().ok, true);
  assert.equal(st.rift.phase, 'complete');
  assert.ok(st.rift.summary && st.rift.portals.some(p => p.kind === 'exit'));
  const at = { x: st.player.pos.x, z: st.player.pos.z };
  assert.equal(sim.leaveRift().ok, true);
  sim.commitTravel();
  assert.equal(st.scene, 'town');
  assert.equal(st.town.portalOpen, true, '완료한 균열도 다음 균열까지 열려 있다');
  sim.returnToRift();
  sim.commitTravel();
  assert.deepEqual(st.player.pos, at);
  sim.debugGotoTown();
  assert.equal(st.scene, 'town');
  st.char.riftUnlocked = 2;
  sim.openRift(2);
  sim.commitTravel();
  assert.equal(st.rift.level, 2);
  assert.ok(log.some(e => e.name === EV.RIFT_CLOSED && e.payload.reason === 'newRift'));
});

test('unloadCharacter: 열린 균열을 닫고(RIFT_CLOSED{quit}) → char null → player 새로 → 마을 · SAVE{all, quit} — app 이 상태를 직접 고치지 않는다', () => {
  const { sim, log } = riftSim();
  const ch = sim.state.char;
  const r = sim.unloadCharacter();
  assert.deepEqual(r, { ok: true });
  const st = sim.state;
  assert.equal(st.char, null);
  assert.equal(st.rift, null);
  assert.equal(st.scene, 'town');
  assert.equal(st.pendingTravel, null);
  assert.equal(sim.ctx.flow, null);
  assert.equal(sim.getMap().kind, 'town');
  const fresh = createPlayerState();
  assert.equal(st.player.life, fresh.life);
  assert.deepEqual(st.player.buffs, []);
  assert.ok(log.some(e => e.name === EV.RIFT_CLOSED && e.payload.reason === 'quit'));
  assert.ok(log.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'all' && e.payload.reason === 'quit'));
  assert.ok(log.some(e => e.name === EV.SCENE_CHANGED && e.payload.to === 'town'));
  if (!stubbed('src/sim/progression/progress.js').length) assert.equal(ch.records[0]?.result, 'abandon', '활동 중이던 균열은 기록 abandon');
  assert.deepEqual(sim.unloadCharacter(), { ok: false, reason: 'invalid' });
  sim.step(NEUTRAL_INPUT);
  // 지우기
  sim.newCharacter({ slot: 3, cls: 'warrior', name: 'D' });
  assert.equal(sim.deleteCharacter(3).ok, true);
  assert.equal(sim.state.char, null);
  assert.equal(sim.state.account.chars[3], null);
  assert.ok(log.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'account' && e.payload.reason === 'delete'));
});

test('debugLoadState: 상태 교체 · 균열이면 ctx.flow · riftMap · MAP_LOADED → SCENE_CHANGED{fixture} → PLAYER_SPAWNED{debug}', () => {
  const { sim, log } = newSim();
  const map = makeTestMap();
  const state = makeTestState({ map });
  log.length = 0;
  assert.deepEqual(sim.debugLoadState(state, map, map), { ok: true });
  assert.equal(sim.state, state);
  assert.ok(sim.ctx.flow);
  assert.equal(sim.ctx.riftMap, map);
  assert.deepEqual(names(log), [EV.MAP_LOADED, EV.SCENE_CHANGED, EV.PLAYER_SPAWNED]);
  assert.equal(log[1].payload.reason, 'fixture');
  sim.step(NEUTRAL_INPUT);
  assert.equal(state.rift.ticksIn, 1);
});

test('고정 상태 15개: 각각 600틱 무작위 입력(전환은 바로 commit)으로 돌려도 예외 0 · NaN 0', () => {
  for (const id of Object.keys(FIXTURES)) {
    const { sim } = newSim(17);
    const f = FIXTURES[id](17);
    sim.debugLoadState(f.state, f.map.kind === 'town' ? buildTownMap() : f.map, f.riftMap);
    const inp = randomInputs(4);
    for (let t = 0; t < 600; t++) {
      sim.step(inp(t, sim.state));
      if (sim.state.pendingTravel) sim.commitTravel();
      if (sim.state.player.dead && t % 90 === 0) sim.respawn();
    }
    assertFiniteDeep(sim.state, id);
    assert.ok(!sim.state.char || sim.state.char.gold >= 0, id);
  }
});

test('결정성: 같은 시드 · 같은 입력 열 → 같은 상태 해시 · 다른 시드 → 다름', () => {
  const run = (seed) => {
    const { sim } = riftSim({ seed, empty: false });
    const inp = randomInputs(5);
    for (let t = 0; t < 600; t++) {
      sim.step(inp(t, sim.state));
      if (sim.state.pendingTravel) sim.commitTravel();
    }
    return hashState(sim.state);
  };
  assert.equal(run(21), run(21));
  assert.notEqual(run(21), run(22));
});

test('pickHover: 몬스터 원기둥(머리를 눌러도) · 드랍 상자 · 마을 물체(장식 빼고) · kinds · 가장 가까운 교차', () => {
  const state = makeTestState();
  const map = makeTestMap();
  const ctx = { state, nextId: () => state.nextId++, monVer: 0 };
  const m = addTestMonster(/** @type {any} */ (ctx), { typeId: 'ghoul', x: 10, z: 10 });
  const drop = { id: 500, kind: 'item', pos: { x: 14, z: 10 }, from: { x: 14, z: 10 }, born: 0, item: null, amount: 1, mat: null, rarity: 'rare', gone: false };
  state.rift.drops.push(drop);
  // 카메라 쪽(+X+Z 위)에서 내려다보는 광선
  const ray = (tx, ty, tz) => {
    const ox = tx + 10, oy = ty + 14, oz = tz + 10;
    return { ox, oy, oz, dx: tx - ox, dy: ty - oy, dz: tz - oz };
  };
  assert.deepEqual(pickHover(state, map, ray(10, m.height - 0.05, 10)), { kind: 'monster', id: m.id, src: 'pick' }, '머리');
  assert.deepEqual(pickHover(state, map, ray(10, 0.1, 10)), { kind: 'monster', id: m.id, src: 'pick' });
  assert.equal(pickHover(state, map, ray(10, m.height + 0.5, 10)), null, '머리 위는 비었다');
  assert.deepEqual(pickHover(state, map, ray(14, 0.3, 10)), { kind: 'drop', id: 500, src: 'pick' });
  assert.equal(pickHover(state, map, ray(14, 0.3, 10), { kinds: ['monster'] }), null);
  drop.gone = true;
  assert.equal(pickHover(state, map, ray(14, 0.3, 10)), null, '주운 드랍은 없다');
  m.dead = true;
  assert.equal(pickHover(state, map, ray(10, 0.5, 10)), null, '시체는 고르지 않는다');
  // 마을
  const town = buildTownMap();
  const tstate = makeTestState({ scene: 'town', map: town });
  const bs = town.objects.find(o => o.id === 'blacksmith');
  assert.deepEqual(pickHover(tstate, town, ray(bs.x, 1, bs.z)), { kind: 'object', id: 'blacksmith', src: 'pick' });
  const fire = town.objects.find(o => o.kind === 'deco' && o.id === 'bonfire');
  assert.equal(pickHover(tstate, town, ray(fire.x, 0.5, fire.z), { kinds: ['object'] }), null, '장식은 고르지 않는다');
  assert.equal(pickHover(tstate, town, { ox: NaN, oy: 1, oz: 1, dx: 0, dy: -1, dz: 0 }), null);
  assert.ok(PICKUP.dropPickR > 0);
});

test('디버그 명령: openRift · spawnPack · killAll · dropItem · grant · setLevel · setRiftUnlocked · invincible · revealMap · resetSkills · gotoTown', () => {
  const { sim, log } = newSim();
  sim.newCharacter({ slot: 0, cls: 'mage', name: 'G' });
  assert.equal(sim.debugOpenRift(4, 77).ok, true);
  const st = sim.state;
  assert.equal(st.scene, 'rift');
  assert.equal(st.rift.level, 4);
  assert.equal(st.rift.seed, 77);
  assert.ok(sim.ctx.flow);
  const r = sim.debugSpawnPack('ghoul', 'champion');
  assert.equal(r.ok, true);
  const pack = st.rift.packs.find(p => p.id === r.packId);
  assert.ok(pack && pack.memberIds.length >= 1);
  assert.ok(pack.memberIds.every(id => st.rift.mons.find(m => m.id === id)?.awake));
  sim.debugKillAll();
  assert.ok(st.rift.mons.every(m => m.dead || m.gone));
  assert.equal(sim.debugDropItem({ rarity: 'rare', slot: 'helm' }).ok, true);
  assert.ok(st.rift.drops.some(d => d.kind === 'item' && d.item.slot === 'helm'));
  sim.debugGrant({ gold: 250, materials: { scrap: 3 }, items: ['magic'] });
  assert.equal(st.char.gold, 250);
  assert.equal(st.char.materials.scrap, 3);
  assert.ok(st.char.bag.some(Boolean));
  sim.debugSetLevel(12);
  assert.equal(st.char.level, 12);
  assert.equal(st.player.life, st.player.lifeMax);
  assert.ok(log.some(e => e.name === EV.XP && e.payload.level === 12));
  sim.debugSetRiftUnlocked(9);
  assert.equal(st.char.riftUnlocked, 9);
  assert.ok(log.some(e => e.name === EV.UNLOCK && e.payload.riftUnlocked === 9));
  sim.debugSetInvincible(true);
  const life = st.player.life;
  st.player.protectUntil = 0;
  sim.step(NEUTRAL_INPUT);
  assert.equal(st.player.life, life);
  sim.debugRevealMap();
  assert.ok(st.rift.explored.every(v => v === 1));
  st.char.skills.ranks = { fireball: 2 };
  sim.debugResetSkills();
  assert.deepEqual(st.char.skills.ranks, {});
  assert.equal(sim.debugGotoTown().ok, true);
  assert.equal(st.scene, 'town');
  assertFiniteDeep(st);
});

test('W1 통합: 시작 캐릭터 · scriptedClear — 실제 구현끼리 균열 1 이 끝(완료 또는 붕괴)까지 돈다(예외 0 · NaN 0) · 붕괴면 부활 → 마을 · 균열 닫힘', {
  skip: skipIf('src/sim/player/controller.js', 'src/sim/player/actions.js', 'src/sim/player/skills.js', 'src/sim/monsters/monsters.js', 'src/sim/monsters/behaviors.js',
    'src/sim/monsters/packs.js', 'src/sim/world/mapgen.js', 'src/sim/world/flow.js', 'src/sim/world/path.js', 'src/sim/loot/rollDrops.js', 'src/sim/progression/progress.js'),
}, () => {
  // W1 확정(통합 게이트): 지금 수치에서 시작 캐릭터는 균열 1 을 대개 붕괴로 끝낸다(NOTES-W1 — 밸런스 게이트의 첫 과제). 이 검사는 끝까지 도는 것만 본다.
  for (const cls of ['warrior', 'mage']) {
    const { sim, log } = newSim(31);
    sim.newCharacter({ slot: 0, cls, name: cls });
    sim.openRift(1);
    sim.commitTravel();
    const r = scriptedClear(sim, { maxTicks: 30 * 60 * 15 });
    assert.ok(r.gauge >= 100 || r.phase !== 'active', `${cls}: ${JSON.stringify(r)}`);
    assertFiniteDeep(sim.state, cls);
    if (r.phase === 'collapsed') {
      assert.ok(log.some(e => e.name === EV.RIFT_COLLAPSE), 'RIFT_COLLAPSE');
      assert.equal(sim.respawn().ok, true);
      assert.equal(sim.commitTravel().ok, true);
      assert.equal(sim.state.scene, 'town');
      assert.equal(sim.state.rift, null);
      assert.ok(log.some(e => e.name === EV.RIFT_CLOSED && e.payload.reason === 'collapse'));
      assert.equal(sim.state.char.records[0].result, 'collapse');
    }
  }
});

test('W1 통합: 완료 경로 — 개발 캐릭터(L10 · 프리셋 A) · 무적 · scriptedClear → 게이지 100% → 수호자 → 완료 → RIFT_COMPLETE · UNLOCK · 나가는 포털 → 마을 · 재고 갱신', {
  skip: skipIf('src/sim/player/controller.js', 'src/sim/player/skills.js', 'src/sim/monsters/monsters.js', 'src/sim/monsters/packs.js', 'src/sim/world/mapgen.js',
    'src/sim/progression/dev.js', 'src/sim/progression/progress.js', 'src/sim/progression/shops.js'),
}, () => {
  for (const cls of ['warrior', 'mage']) {
    const { sim, log } = newSim(7);
    const ch = makeDevCharacter({ slot: 0, cls, name: cls, level: 10, rift: 1, preset: 0, seed: 5, newId: sim.ctx.newItemId });
    assert.equal(sim.loadCharacter(0, ch).ok, true);
    sim.debugSetInvincible(true);
    assert.equal(sim.openRift(1).ok, true);
    sim.commitTravel();
    const r = scriptedClear(sim, { maxTicks: 30 * 60 * 15, untilComplete: true });
    assert.equal(r.phase, 'complete', `${cls}: ${JSON.stringify(r)}`);
    for (let i = 0; i < 60; i++) sim.step(NEUTRAL_INPUT);
    const st = sim.state;
    assert.ok(log.some(e => e.name === EV.GAUGE_FULL), 'GAUGE_FULL');
    assert.ok(log.some(e => e.name === EV.GUARDIAN_APPEAR), 'GUARDIAN_APPEAR');
    const done = log.find(e => e.name === EV.RIFT_COMPLETE);
    assert.ok(done, 'RIFT_COMPLETE');
    assert.equal(done.payload.summary.result, 'complete');
    assert.ok(done.payload.summary.kills.guardian === 1);
    assert.ok(log.some(e => e.name === EV.UNLOCK && e.payload.riftUnlocked === 3), '무사망 완료 +2');
    const exit = st.rift.portals.find(q => q.kind === 'exit');
    assert.ok(exit, '나가는 포털');
    const restocks = st.char.shop.restocks;
    assert.equal(sim.leaveRift().ok, true);
    assert.equal(sim.commitTravel().ok, true);
    assert.equal(st.scene, 'town');
    assert.equal(st.char.shop.restocks, restocks + 1, '판이 바뀐 뒤 첫 마을에서 재고 갱신');
    assert.equal(st.char.records[0].result, 'complete');
    assertFiniteDeep(st, cls);
  }
});

test('밸런스 게이트: 수호자 처치 직후(완료 마무리 completeDelay 전) 귀환해 마을로 가면 떠나는 commit 에서 마무리한다 — 요약 · 해금 · RIFT_COMPLETE 한 번 · 새 균열을 열어도 잃지 않는다', () => {
  const { sim, log } = riftSim({ seed: 5 });
  const st = sim.state;
  const rift = st.rift;
  const ch = st.char;
  const p = st.player;
  const unlock0 = ch.riftUnlocked;
  rift.gauge = 100;
  rift.phase = 'guardian';
  const at = nearestWalkable(sim.getMap(), p.pos.x + 6, p.pos.z, 4) ?? p.pos;
  const g = spawnGuardianNow(sim.ctx, at.x, at.z);
  assert.ok(g);
  // 귀환 시전이 끝나는 틱에 수호자가 쓰러진다(봇 실측: 처치 39틱 뒤 귀환 · completeAt 6틱 전)
  g.hp = 0;
  g.lastHit = { by: 'player', skillId: null, noProcs: true, frozen: false };
  sim.step(NEUTRAL_INPUT);
  assert.equal(rift.phase, 'complete');
  assert.ok(rift.completeAt !== null && rift.summary === null, '마무리는 completeDelay 뒤');
  assert.equal(openRecallPortal(sim.ctx, p.pos).ok, true);
  assert.equal(sim.commitTravel().ok, true);
  assert.equal(st.scene, 'town');
  assert.ok(rift.summary && rift.summary.result === 'complete', '떠날 때 마무리하지 않았다(요약 없음)');
  assert.equal(ch.riftUnlocked, unlock0 + RIFT.unlockNoDeath, '해금이 사라졌다');
  assert.equal(log.filter((e) => e.name === EV.RIFT_COMPLETE).length, 1);
  // 마을에서 새 균열을 열어도 그 판의 완료는 남는다
  assert.equal(sim.openRift(1).ok, true);
  assert.equal(sim.commitTravel().ok, true);
  assert.equal(ch.riftUnlocked, unlock0 + RIFT.unlockNoDeath);
  assert.equal(log.filter((e) => e.name === EV.RIFT_COMPLETE).length, 1);
  assertFiniteDeep(st, 'state');
});
