// OWNER: P2 — 계약 §12.2 · §5.10 · §5.15 · §5.16 · §5.18
// 게이지 → 수호자 예고 → 출현 · 완료 → 요약 · 해금 · 사망 → 생명 − 1 · 0 에서 사망 → 붕괴 · complete 단계 사망 · 같은 틱 충돌(§5.16) ·
// 진정 · 안전 지점 · 귀환 포털 · 복귀 요청 · 반복 중 제거 0(표시 → removeMarked) · 처치 집계 · 계측(떼 순간).
// 마을 왕복(시각 밀기) · 부활 → 복귀는 GameSim 이 commit 하므로 gameSim.test.js 에 있다.
// 남의 W1 구현에 기대는 검사(해금 수치 · 경험치 · 드랍)는 그 파일이 아직 스텁이면 건너뛴다(통합 게이트에서 돈다).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { circle } from '../src/core/shapes.js';
import { ticks } from '../src/core/time.js';
import { DEATH, METER } from '../src/data/combat.js';
import { RIFT } from '../src/data/rift.js';
import { getMonster, removeMarked } from '../src/sim/entities.js';
import { meterView, updateMeter } from '../src/sim/meter.js';
import { unlockAfter } from '../src/sim/progression/progress.js';
import { addGauge, killPlayer, openRecallPortal, requestReturnToRift, requestTravel, resolveDeaths, riftElapsedSec, updateRift } from '../src/sim/rift.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { addTestMonster, assertFiniteDeep, countEvents, makeTestCtx, makeTestState } from './helpers.js';

/** 그 파일이 아직 스텁(파일 머리의 스텁 표시 줄)인가 @param {string[]} rels */
const stubbed = (...rels) => rels.filter(r => /^\/\/ STUB\b/m.test(readFileSync(new URL('../' + r, import.meta.url), 'utf8')));

function setup({ hooks = {}, level = 1 } = {}) {
  const state = makeTestState();
  state.tick = 200;
  state.rift.level = level;
  const ctx = makeTestCtx(state, { hooks: { onPlayerKilled: (c, k) => killPlayer(c, k), ...hooks } });
  return { state, ctx, p: state.player, rift: state.rift, ch: state.char };
}

const kill = (m, by = 'player') => {
  m.hp = 0;
  m.lastHit = { by, skillId: null, noProcs: false, frozen: false };
};

test('게이지: 처치마다 RANKS.gauge × 종류 gauge × 초반 배율(L ≤ 2 · 일반/하수인 1.25) · GAUGE · 100 → guardian · 출현 예고 → at 틱에 수호자', () => {
  const { state, ctx, rift } = setup();
  const g = addTestMonster(ctx, { x: 10, z: 10 });
  const c = addTestMonster(ctx, { x: 12, z: 10, rank: 'champion' });
  kill(g);
  kill(c);
  resolveDeaths(ctx);
  assert.ok(Math.abs(rift.gauge - (0.25 * 1.0 * RIFT.earlyGaugeMul + 1.0 * 1.0)) < 1e-9, String(rift.gauge));
  assert.equal(countEvents(ctx.events, EV.GAUGE), 2);
  const s3 = setup({ level: 3 });
  const g3 = addTestMonster(s3.ctx, { x: 10, z: 10 });
  kill(g3);
  resolveDeaths(s3.ctx);
  assert.ok(Math.abs(s3.rift.gauge - 0.25) < 1e-9, 'L3 은 초반 배율 없음');
  // 100%
  addGauge(ctx, 200);
  assert.equal(rift.gauge, 100);
  assert.equal(rift.phase, 'guardian');
  const spawn = rift.guardianSpawn;
  assert.ok(spawn && spawn.at === state.tick + ticks(RIFT.guardianDelay));
  assert.ok(isWalkable(ctx.map, spawn.x, spawn.z));
  const fx = rift.effects.find(e => e.kind === 'guardianSpawn');
  assert.ok(fx && fx.hostile === false && fx.spec === null && fx.shape.r === RIFT.guardianSpawnR);
  assert.ok(ctx.events.some(e => e.name === EV.GAUGE_FULL && e.payload.sec === RIFT.guardianDelay));
  assert.ok(ctx.events.some(e => e.name === EV.HINT && e.payload.id === 'gauge'));
  addGauge(ctx, 5);
  assert.equal(countEvents(ctx.events, EV.GAUGE), 3, 'guardian 단계에서는 오르지 않는다');
  state.tick = spawn.at - 1;
  updateRift(ctx);
  assert.equal(rift.guardianId, null);
  state.tick = spawn.at;
  updateRift(ctx);
  const guardian = getMonster(ctx, rift.guardianId);
  assert.ok(guardian && guardian.rank === 'guardian' && guardian.typeId === rift.guardianType && guardian.awake);
  assert.ok(ctx.events.some(e => e.name === EV.GUARDIAN_APPEAR && e.payload.id === guardian.id));
});

test('수호자 처치 → complete · 남은 몬스터는 경험치 · 드랍 · 게이지 · 사망 훅 없이 사라진다(MON_DIED 는 낸다 · 처치로 세지 않는다) · 적대 위협 지움 · completeAt 에 요약 → RIFT_COMPLETE → 나가는 포털', () => {
  const deathHooks = [];
  const { state, ctx, rift, ch } = setup({ hooks: { onMonDeath: (c, m) => deathHooks.push(m.id) } });
  rift.gauge = 100;
  rift.phase = 'guardian';
  const g = addTestMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', x: 20, z: 12 });
  rift.guardianId = g.id;
  const others = [addTestMonster(ctx, { x: 30, z: 30 }), addTestMonster(ctx, { x: 32, z: 30, rank: 'elite' })];
  const haz = { id: 900, kind: 'plague', owner: 'mon', srcId: others[0].id, packId: -1, cancelOnSrcDeath: false, hostile: true, shape: circle(0, 0, 2), start: state.tick, hitAt: state.tick + 30, end: state.tick + 180, tickT: 15, nextTickAt: state.tick + 45, resolved: false, spec: null, tickSpec: {}, from: null };
  rift.effects.push(haz);
  kill(g);
  resolveDeaths(ctx);
  assert.equal(rift.phase, 'complete');
  assert.equal(rift.completeAt, state.tick + ticks(RIFT.completeDelay));
  assert.equal(haz.end, state.tick, '남은 적대 위협 지움');
  assert.ok(others.every(m => m.hp === 0 && m.flags.noXp && m.flags.noDrops && m.flags.noGauge));
  state.tick += 1;
  resolveDeaths(ctx);   // 목록에서 수호자보다 앞에 있던 것은 이 호출에서 · 뒤에 있던 것은 같은 호출에서 정리된다
  assert.ok(others.every(m => m.dead));
  assert.equal(countEvents(ctx.events, EV.MON_DIED), 3);
  assert.deepEqual(deathHooks, [g.id], '사라지는 것은 화염 폭발 · 분열 같은 사망 훅을 돌리지 않는다');
  assert.equal(rift.stats.kills.guardian, 1);
  assert.equal(rift.stats.kills.normal + rift.stats.kills.elite, 0, '사라진 것은 처치가 아니다');
  state.tick = rift.completeAt - 1;
  updateRift(ctx);
  assert.equal(rift.summary, null);
  state.tick = rift.completeAt;
  rift.ticksIn = 300 * 30;
  updateRift(ctx);
  const s = rift.summary;
  assert.ok(s && s.result === 'complete' && s.level === 1 && s.cls === ch.cls && s.timeSec === 300 && s.noDeath === true);
  assert.equal(s.unlockedTo, unlockAfter(ch, 1, 0));
  assert.equal(s.record, true, '이 레벨의 첫 완료');
  assert.ok(ctx.events.some(e => e.name === EV.RIFT_COMPLETE));
  const exit = rift.portals.find(pt => pt.kind === 'exit');
  assert.ok(exit && exit.id.startsWith('portal:') && exit.r === RIFT.portalR);
  assert.ok(isWalkable(ctx.map, exit.pos.x, exit.pos.z));
  assert.ok(Math.abs(Math.hypot(exit.pos.x - g.pos.x, exit.pos.z - g.pos.z) - RIFT.exitPortalOffset) < 1e-6);
  assert.ok(ctx.events.some(e => e.name === EV.PORTAL_OPENED && e.payload.kind === 'exit'));
  updateRift(ctx);
  assert.equal(countEvents(ctx.events, EV.RIFT_COMPLETE), 1, '한 번만');
});

test('해금: 완료 +1 · 무사망 완료 +2 · 붕괴는 그대로(P6 unlockAfter · completeRun)', { skip: stubbed('src/sim/progression/progress.js').length ? 'P6 progress.js 스텁 — 통합 게이트에서' : false }, () => {
  for (const [deaths, want] of [[0, RIFT.unlockNoDeath], [1, RIFT.unlockClear]]) {
    const { state, ctx, rift, ch } = setup();
    rift.deaths = deaths;
    rift.phase = 'guardian';
    const g = addTestMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', x: 20, z: 12 });
    rift.guardianId = g.id;
    kill(g);
    resolveDeaths(ctx);
    state.tick = rift.completeAt;
    updateRift(ctx);
    assert.equal(rift.summary.unlockedTo, 1 + want);
    assert.equal(ch.riftUnlocked, 1 + want);
  }
});

test('플레이어 사망: dead · killedBy · 생명 − 1(LIVES) · 적대 투사체 · 예고 지움 · 진정 · returnPos = checkpoint · SAVE · HINT death · PLAYER_DIED', () => {
  const { state, ctx, p, rift } = setup();
  const m = addTestMonster(ctx, { typeId: 'charger', rank: 'elite', x: p.pos.x + 1, z: p.pos.z });
  m.name = ['elite.a.1', 'elite.b.2'];
  const hostile = { id: 801, visual: 'arrow', owner: 'mon', srcId: m.id, pos: { x: 1, z: 1 }, prevPos: { x: 1, z: 1 }, vel: { x: 1, z: 0 }, r: 0.2, born: state.tick, until: state.tick + 30, pierce: 0, hitIds: [], bounce: false, spec: {}, explode: null };
  const mine = { ...hostile, id: 802, owner: 'player', srcId: -1, hitIds: [] };
  rift.projs.push(hostile, mine);
  rift.effects.push({ id: 803, kind: 'mortar', owner: 'mon', srcId: m.id, packId: -1, cancelOnSrcDeath: false, hostile: true, shape: circle(0, 0, 1.5), start: state.tick, hitAt: state.tick + 20, end: state.tick + 21, tickT: 0, nextTickAt: -1, resolved: false, spec: {}, tickSpec: null, from: null });
  p.channel = { skillId: 'whirlwind', nextAt: state.tick + 3, startedAt: state.tick - 10 };
  ctx.hooks.onPlayerKilled(ctx, m);
  assert.equal(p.dead, true);
  assert.equal(p.act, 'dead');
  assert.equal(p.deadAt, state.tick);
  assert.deepEqual(p.killedBy, { typeId: 'charger', rank: 'elite', name: ['elite.a.1', 'elite.b.2'] });
  assert.equal(p.channel, null);
  assert.equal(rift.lives, RIFT.lives - 1);
  assert.equal(rift.deaths, 1);
  assert.equal(hostile.until, state.tick);
  assert.equal(mine.until, state.tick + 30, '플레이어 투사체는 그대로');
  assert.equal(rift.effects[0].end, state.tick);
  assert.equal(rift.calmAt, state.tick + ticks(DEATH.calmSec));
  assert.deepEqual(rift.returnPos, rift.checkpoint);
  assert.ok(ctx.events.some(e => e.name === EV.PROJ_END && e.payload.reason === 'cancel' && e.payload.id === 801));
  assert.ok(ctx.events.some(e => e.name === EV.LIVES && e.payload.lives === RIFT.lives - 1));
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'death'));
  assert.ok(ctx.events.some(e => e.name === EV.CHANNEL && e.payload.on === false));
  const died = ctx.events.find(e => e.name === EV.PLAYER_DIED).payload;
  assert.equal(died.collapse, false);
  assert.equal(died.killerId, m.id);
  assert.equal(died.killerTypeId, 'charger');
  // 두 번 부르면 아무 일도 없다
  ctx.hooks.onPlayerKilled(ctx, m);
  assert.equal(rift.deaths, 1);
  // 진정: calmAt 틱에 깨어 있는 몬스터를 그 자리에서 재운다(생명 그대로)
  const hp = m.hp;
  state.tick = rift.calmAt;
  updateRift(ctx);
  assert.equal(m.awake, false);
  assert.equal(m.hp, hp);
  assert.equal(rift.calmAt, null);
});

test('생명 0 에서 사망 → 붕괴(요약 collapse · RIFT_COLLAPSE · 마을 포털 꺼짐) · complete 단계 사망은 생명을 깎지 않는다', () => {
  const a = setup();
  a.rift.lives = 0;
  a.state.town.portalOpen = true;
  a.ctx.hooks.onPlayerKilled(a.ctx, null);
  assert.equal(a.rift.phase, 'collapsed');
  assert.equal(a.rift.summary.result, 'collapse');
  assert.ok(a.ctx.events.some(e => e.name === EV.RIFT_COLLAPSE));
  assert.equal(a.state.town.portalOpen, false);
  assert.equal(a.ctx.events.find(e => e.name === EV.PLAYER_DIED).payload.collapse, true);
  assert.equal(a.state.player.killedBy, null);
  const b = setup();
  b.rift.phase = 'complete';
  b.ctx.hooks.onPlayerKilled(b.ctx, null);
  assert.equal(b.rift.lives, RIFT.lives);
  assert.equal(b.rift.phase, 'complete');
  assert.equal(b.rift.deaths, 1);
});

test('§5.16-3 플레이어 사망과 수호자 처치가 같은 틱: 붕괴하지 않는다 · 생명 그대로 · 완료가 우선', () => {
  const { ctx, rift } = setup();
  rift.lives = 0;
  rift.phase = 'guardian';
  const g = addTestMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', x: 20, z: 12 });
  rift.guardianId = g.id;
  kill(g);   // 플레이어 적중(4)이 먼저
  ctx.hooks.onPlayerKilled(ctx, null);   // 같은 틱 몬스터(5)
  assert.equal(rift.phase, 'guardian');
  assert.equal(rift.lives, 0);
  resolveDeaths(ctx);   // 7
  assert.equal(rift.phase, 'complete');
});

test('§5.16-1 · 8: 반복 중 제거 0 — 사망 훅이 몬스터를 더해도 건너뛰지 않는다 · 새로 생긴 것은 다음 호출 · 사망 처리는 한 번 · 배열에서는 cleanup 만 뺀다', () => {
  const spawned = [];
  const { state, ctx, rift } = setup({
    hooks: {
      onMonDeath: (c, mon) => {
        if (spawned.includes(mon)) return;   // 분열은 한 번만(사본은 다시 나뉘지 않는다)
        for (let k = 0; k < 2; k++) {
          const s = addTestMonster(c, { x: mon.pos.x + k, z: mon.pos.z + 1, hp: 0 });
          s.lastHit = { by: 'player', skillId: null, noProcs: false, frozen: false };
          spawned.push(s);
        }
      },
    },
  });
  const ms = [0, 1, 2].map(i => addTestMonster(ctx, { x: 10 + i * 3, z: 10 }));
  ms.forEach(m => kill(m));
  kill(ms[1]);
  resolveDeaths(ctx);
  assert.equal(countEvents(ctx.events, EV.MON_DIED), 3);
  assert.equal(spawned.length, 6);
  assert.ok(spawned.every(s => !s.dead), '이번 호출에 생긴 것은 다음 호출에서');
  assert.equal(rift.mons.length, 9, '배열에서 빼지 않았다');
  state.tick += 1;
  resolveDeaths(ctx);
  assert.equal(countEvents(ctx.events, EV.MON_DIED), 9);
  // gone 표시 → cleanup 이 뺀다 · getMonster 는 다른 몬스터를 돌려주지 않는다
  ms[0].gone = true;
  removeMarked(ctx);
  assert.equal(getMonster(ctx, ms[0].id), null);
  assert.equal(getMonster(ctx, ms[1].id), ms[1]);
  state.tick += ticks(DEATH.corpseSec);
  removeMarked(ctx);
  assert.equal(rift.mons.length, 0, '시체 시간이 지나면 cleanup 이 뺀다');
  assert.equal(getMonster(ctx, ms[2].id), null);
});

test('처치 집계 · killTicks · 전설 처치 훅: 플레이어 처치만 · 스스로 사라짐(역병 덩어리 폭발)은 세지 않는다 · 되살린 소인은 센다 · noProcs 면 훅 없음', () => {
  const procs = [];
  const { state, ctx, rift } = setup({ hooks: { onPlayerKill: (c, m) => procs.push(m.id) } });
  const a = addTestMonster(ctx, { x: 10, z: 10 });
  const b = addTestMonster(ctx, { typeId: 'bloater', x: 12, z: 10 });
  const c = addTestMonster(ctx, { typeId: 'fallen', x: 14, z: 10 });
  const d = addTestMonster(ctx, { x: 16, z: 10, rank: 'minion' });
  const e = addTestMonster(ctx, { x: 18, z: 10, rank: 'split' });
  kill(a);
  kill(b);
  Object.assign(b.flags, { noXp: true, noDrops: true, noGauge: true });
  kill(c);
  Object.assign(c.flags, { noXp: true, noDrops: true, noGauge: true, revived: true });
  kill(d);
  d.lastHit.noProcs = true;
  kill(e, 'env');
  resolveDeaths(ctx);
  assert.deepEqual({ ...rift.stats.kills }, { normal: 2, champion: 0, elite: 0, minion: 1, guardian: 0, other: 0 });
  assert.deepEqual(state.meter.killTicks, [state.tick, state.tick, state.tick]);
  assert.deepEqual(procs, [a.id, c.id]);
  const died = ctx.events.filter(x => x.name === EV.MON_DIED).map(x => [x.payload.id, x.payload.byPlayer]);
  assert.deepEqual(died.find(x => x[0] === e.id), [e.id, false]);
  // killTicks 는 METER.killCap 개까지
  for (let i = 0; i < METER.killCap + 20; i++) kill(addTestMonster(ctx, { x: 20, z: 20 }));
  resolveDeaths(ctx);
  assert.equal(state.meter.killTicks.length, METER.killCap);
});

test('경험치 · 드랍: 처치가 grantXp(P6) · rollDrops(P5) → spawnDrops 로 이어진다', { skip: stubbed('src/sim/progression/progress.js', 'src/sim/loot/rollDrops.js').length ? `스텁: ${stubbed('src/sim/progression/progress.js', 'src/sim/loot/rollDrops.js').join(', ')} — 통합 게이트에서` : false }, () => {
  const { ctx, rift, ch } = setup();
  for (let i = 0; i < 60; i++) kill(addTestMonster(ctx, { x: 10 + (i % 10), z: 10 + Math.floor(i / 10), rank: i % 6 ? 'normal' : 'champion' }));
  resolveDeaths(ctx);
  assert.ok(rift.stats.xp > 0 && ch.xpTotal > 0);
  assert.ok(rift.drops.length > 0);
  assertFiniteDeep(ctx.state);
});

test('안전 지점: 15틱마다 15m 안에 깨어 있는 몬스터가 없으면 조용함 + 15 · 60틱 이상이면 그 자리 · 다가오면 0', () => {
  const { state, ctx, p, rift } = setup();
  const start = { ...rift.checkpoint };
  p.pos = { x: 30, z: 30 };
  const step = ticks(RIFT.checkpointEvery);
  state.tick = Math.ceil(state.tick / step) * step;
  for (let i = 0; i < 3; i++) { updateRift(ctx); state.tick += step; }
  assert.deepEqual(rift.checkpoint, start, '45틱은 아직');
  updateRift(ctx);
  assert.deepEqual(rift.checkpoint, { x: 30, z: 30 });
  p.pos = { x: 12, z: 12 };
  const m = addTestMonster(ctx, { x: 14, z: 12 });
  for (let i = 0; i < 6; i++) { state.tick += step; updateRift(ctx); }
  assert.deepEqual(rift.checkpoint, { x: 30, z: 30 });
  assert.equal(rift.checkpointCalm, 0);
  m.awake = false;
  for (let i = 0; i < 4; i++) { state.tick += step; updateRift(ctx); }
  assert.deepEqual(rift.checkpoint, { x: 12, z: 12 });
});

test('장면 전환 요청 · 귀환 포털 · 마을 포털 복귀 요청의 Result', () => {
  const { state, ctx, rift, ch } = setup();
  assert.deepEqual(requestReturnToRift(ctx), { ok: false, reason: 'notInTown' });
  const r = openRecallPortal(ctx, { x: 20, z: 20 });
  assert.equal(r.ok, true);
  assert.equal(rift.leftAt, state.tick);
  assert.deepEqual(state.pendingTravel, { to: 'town', reason: 'recall' });
  assert.deepEqual(rift.returnPos, { x: 20, z: 20 });
  assert.equal(rift.stats.recalls, 1);
  const pt = rift.portals.find(x => x.kind === 'recall');
  assert.ok(pt && pt.r === RIFT.portalR && pt.id.startsWith('portal:'));
  assert.deepEqual(requestTravel(ctx, { to: 'town', reason: 'debug' }), { ok: false, reason: 'busy' });
  // 마을에서(commit 은 GameSim — 여기서는 장면만 바꾼다)
  state.pendingTravel = null;
  state.scene = 'town';
  assert.deepEqual(requestReturnToRift(ctx), { ok: true });
  assert.deepEqual(state.pendingTravel, { to: 'rift', reason: 'townPortal' });
  state.pendingTravel = null;
  rift.phase = 'collapsed';
  assert.deepEqual(requestReturnToRift(ctx), { ok: false, reason: 'collapsed' });
  state.rift = null;
  assert.deepEqual(requestReturnToRift(ctx), { ok: false, reason: 'noRift' });
  // 가방이 찬 채 귀환
  const s2 = setup();
  s2.ch.bag.fill(/** @type {any} */ ({ id: 'x' }));
  openRecallPortal(s2.ctx, s2.p.pos);
  assert.equal(s2.rift.stats.bagFullRecall, true);
  // 새 귀환 포털은 이전 것을 닫는다
  s2.state.pendingTravel = null;
  openRecallPortal(s2.ctx, { x: 25, z: 25 });
  assert.equal(s2.rift.portals.filter(x => x.kind === 'recall').length, 1);
  assert.ok(s2.ctx.events.some(e => e.name === EV.PORTAL_CLOSED));
  assert.ok(ch);
});

test('계측: 노리는 몬스터 수 · 최대 · 떼 순간(25 이상 · 15 아래로 내려가야 다시) · DPS · 분당 처치 · 경과', () => {
  const { state, ctx, rift } = setup();
  const ms = [];
  for (let i = 0; i < 30; i++) {
    const m = addTestMonster(ctx, { x: 5 + (i % 10) * 3, z: 5 + Math.floor(i / 10) * 3 });
    m.targeting = true;
    ms.push(m);
  }
  updateMeter(ctx);
  assert.equal(state.meter.targeting, 30);
  assert.equal(rift.stats.maxTargeting, 30);
  assert.equal(rift.stats.swarmMoments, 1);
  updateMeter(ctx);
  assert.equal(rift.stats.swarmMoments, 1, 'armed 가 아니다');
  ms.slice(0, 16).forEach(m => { m.targeting = false; });
  updateMeter(ctx);
  ms.slice(0, 16).forEach(m => { m.targeting = true; });
  updateMeter(ctx);
  assert.equal(rift.stats.swarmMoments, 2);
  // DPS: 링 버퍼 합 / 5초
  state.meter.dealt.fill(0);
  state.meter.dealt[0] = 100;
  state.meter.dealt[7] = 50;
  state.meter.killTicks = [state.tick - 30, state.tick - 1900, state.tick];
  rift.ticksIn = 60 * 30;
  rift.gauge = 30;
  const v = meterView(state);
  assert.equal(v.dps, 150 / (METER.window / 30));
  assert.equal(v.killsPerMin, 2);
  assert.equal(v.elapsedSec, 60);
  assert.equal(riftElapsedSec(state), 60);
  assert.equal(v.gaugePerMin, 30);
  assert.equal(v.targeting, 30);
  assertFiniteDeep(v);
  // 균열이 없으면 0 으로 채운 모양
  state.rift = null;
  const z = meterView(state);
  assert.equal(z.elapsedSec, 0);
  assert.equal(z.drops.legendary, 0);
});
