// OWNER: P1 — 계약 §12.2(player.test) · §5.2 클릭 해석 10규칙 · §5.3 선입력 · §5.5 포션 · 귀환
// 같은 웨이브의 남의 구현에 기대지 않는다 — 스텁이든 실제 구현이든 통과하도록 P1 상태 · P1 이벤트만 본다(테스트 헬퍼 §6.17).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { ticks } from '../src/core/time.js';
import { CLASSES, PLAYER } from '../src/data/classes.js';
import { BUFFER, PICKUP, POTION } from '../src/data/combat.js';
import { BASIC_SKILLS } from '../src/data/skills.js';
import { townMapFromData } from '../src/debug/fixtureMap.js';
import { addDrop } from '../src/sim/entities.js';
import { requestReturnToRift } from '../src/sim/rift.js';
import { onPlayerDamaged } from '../src/sim/player/actions.js';
import { placePlayer, resetPlayerForScene, updatePlayer } from '../src/sim/player/controller.js';
import { createRiftState } from '../src/sim/state.js';
import { addTestMonster, assertFiniteDeep, countEvents, makeTestCtx, makeTestMap, makeTestState, makeTestStats, randomInputs } from './helpers.js';

const BIG = 1e6;

/** 균열(또는 마을) 문맥 — ranks · bar · 자원을 바로 정한다 */
function setup({ cls = 'warrior', scene = 'rift', ranks = {}, bar = [], resource = null, stats = {}, map = null } = {}) {
  const st = makeTestState({ scene, cls, map });
  st.char.skills.ranks = { ...ranks };
  st.char.skills.bar = [0, 1, 2, 3, 4].map(i => bar[i] ?? null);
  const ctx = makeTestCtx(st, { stats: makeTestStats({ cls, ...stats }) });
  if (resource !== null) st.player.resource = resource;
  return { st, ctx, p: st.player };
}

/** 한 틱(GameSim 의 0 · 1 처럼 tick · prevPos 를 민 뒤 updatePlayer) */
function step(ctx, inp = {}) {
  const st = ctx.state;
  st.tick += 1;
  st.player.prevPos = { x: st.player.pos.x, z: st.player.pos.z };
  updatePlayer(ctx, makeInput(inp));
}
const onMon = (m) => ({ cursor: { x: m.pos.x, z: m.pos.z }, hover: { kind: 'monster', id: m.id, src: 'pick' } });
const evs = (ctx, name) => ctx.events.filter(e => e.name === name);
const lastStart = (ctx) => evs(ctx, EV.ACTION_START).at(-1);
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const slots = (i) => { const a = [false, false, false, false, false]; a[i] = true; return a; };

/** 바닥 드랍 하나(리터럴 · 엔티티 질의용) */
function addTestDrop(ctx, x, z, kind = 'gold') {
  return addDrop(ctx, { id: ctx.nextId(), kind, pos: { x, z }, from: { x, z }, born: ctx.state.tick, item: null, amount: 5, mat: null, rarity: null, gone: false });
}

// ───────────────────────── §5.2-1 대상 검사 ─────────────────────────

test('대상 검사: 몬스터는 살아 있고 커서가 r + validate + validateH × height 안일 때만 · 죽으면 null', () => {
  const { ctx, p } = setup();
  const m = addTestMonster(ctx, { x: 30, z: 21, hp: BIG });
  const lim = m.r + PICKUP.validate + PICKUP.validateH * m.height;
  step(ctx, { cursor: { x: 30 + lim - 0.05, z: 21 }, hover: { kind: 'monster', id: m.id, src: 'pick' } });
  assert.deepEqual(p.hover, { kind: 'monster', id: m.id, src: 'pick' });
  step(ctx, { cursor: { x: 30 + lim + 0.1, z: 21 }, hover: { kind: 'monster', id: m.id, src: 'pick' } });
  assert.equal(p.hover, null, '커서가 멀면 통과하지 않는다');
  step(ctx, { cursor: null, hover: { kind: 'monster', id: m.id, src: 'pick' } });
  assert.equal(p.hover, null, '커서가 없으면 통과하지 않는다');
  m.dead = true;
  step(ctx, onMon(m));
  assert.equal(p.hover, null, '죽은 몬스터');
  m.dead = false; m.gone = true;
  step(ctx, onMon(m));
  assert.equal(p.hover, null, 'gone 몬스터');
});

test('대상 검사: 뼈 거인의 머리를 눌러도(바닥 점이 카메라 쪽으로 0.70h 밀림) 통과 → 공격이 된다', () => {
  const { ctx, p } = setup({ resource: 0 });
  const g = addTestMonster(ctx, { typeId: 'boneGiant', rank: 'guardian', x: 30, z: 21, hp: BIG });
  const shift = 0.70 * g.height / Math.SQRT2;   // 카메라 쪽(+X+Z)
  const head = { x: g.pos.x + shift, z: g.pos.z + shift };
  step(ctx, { cursor: head, hover: { kind: 'monster', id: g.id, src: 'pick' }, lmb: true, lmbDown: true });
  assert.equal(p.hover?.id, g.id);
  assert.equal(p.intent.kind, 'attack', '머리 클릭이 이동이 되지 않는다');
  assert.equal(p.intent.targetId, g.id);
});

test('대상 검사: 이름표(src label)는 커서 거리 없이 플레이어에서 labelReach 안 · 그 밖의 드랍은 커서 1.5m 안', () => {
  const { ctx, p } = setup();
  const d1 = addTestDrop(ctx, p.pos.x + PICKUP.labelReach - 0.5, p.pos.z);
  step(ctx, { cursor: { x: p.pos.x, z: p.pos.z + 5 }, hover: { kind: 'drop', id: d1.id, src: 'label' } });
  assert.deepEqual(p.hover, { kind: 'drop', id: d1.id, src: 'label' }, '쌓여 아래로 밀린 이름표도 줍기 대상');
  const d2 = addTestDrop(ctx, p.pos.x + PICKUP.labelReach + 1, p.pos.z);
  step(ctx, { cursor: null, hover: { kind: 'drop', id: d2.id, src: 'label' } });
  assert.equal(p.hover, null, '20m 밖 이름표');
  step(ctx, { cursor: { x: d1.pos.x + PICKUP.validate - 0.1, z: d1.pos.z }, hover: { kind: 'drop', id: d1.id, src: 'pick' } });
  assert.equal(p.hover?.id, d1.id);
  step(ctx, { cursor: { x: d1.pos.x + PICKUP.validate + 0.2, z: d1.pos.z }, hover: { kind: 'drop', id: d1.id, src: 'pick' } });
  assert.equal(p.hover, null);
});

test('대상 검사: 물체는 getObject · r + validate + validateH × h · 장식(deco)은 대상이 아니다', () => {
  const map = townMapFromData();
  const { ctx, p } = setup({ scene: 'town', map });
  const bs = map.objects.find(o => o.id === 'blacksmith');
  step(ctx, { cursor: { x: bs.x + 1, z: bs.z }, hover: { kind: 'object', id: 'blacksmith', src: 'pick' } });
  assert.deepEqual(p.hover, { kind: 'object', id: 'blacksmith', src: 'pick' });
  const fire = map.objects.find(o => o.kind === 'deco');
  step(ctx, { cursor: { x: fire.x, z: fire.z }, hover: { kind: 'object', id: fire.id, src: 'pick' } });
  assert.equal(p.hover, null);
});

// ───────────────────────── §5.2-2 · 3 · 4 좌클릭 ─────────────────────────

test('바닥 클릭: 경로를 따라 6 m/s 로 가고 도착하면 멈춘다(뗐으면 의도가 지워진다)', () => {
  const { ctx, p } = setup();
  const start = { ...p.pos };
  const goal = { x: start.x + 6, z: start.z };
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  assert.equal(p.intent.kind, 'move');
  assert.ok(p.path.length >= 1);
  step(ctx, { cursor: goal });   // 뗐다 — move 는 목적지까지 계속
  for (let i = 0; i < 40; i++) step(ctx, { cursor: goal });
  assert.ok(near(p.pos, goal) <= PLAYER.arriveR + 1e-6, `도착 ${JSON.stringify(p.pos)}`);
  assert.equal(p.intent.kind, 'none');
  assert.equal(p.act, 'idle');
  assert.equal(p.moving, false);
});

test('바닥 클릭 속도: 한 틱 이동 = stats.moveSpeed × DT · 감속이면 × (1 − slowPct) · 속박이면 0', () => {
  const { st, ctx, p } = setup();
  const goal = { x: p.pos.x + 10, z: p.pos.z };
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  const x0 = p.pos.x;
  step(ctx, { cursor: goal, lmb: true });
  assert.ok(Math.abs(p.pos.x - x0 - 6 / 30) < 1e-6);
  p.st.slowPct = 0.4; p.st.slowUntil = st.tick + 30;
  const x1 = p.pos.x;
  step(ctx, { cursor: goal, lmb: true });
  assert.ok(Math.abs(p.pos.x - x1 - 0.6 * 6 / 30) < 1e-6);
  p.st.rootUntil = st.tick + 30;
  const x2 = p.pos.x;
  step(ctx, { cursor: goal, lmb: true });
  assert.equal(p.pos.x, x2);
});

test('누르고 있는 이동: 커서가 0.75m 넘게 움직이면 6틱 안에 다시 경로 · 커서 null 이면 경로를 비우고 멈춘다', () => {
  const { ctx, p } = setup();
  const a = { x: p.pos.x + 8, z: p.pos.z };
  step(ctx, { cursor: a, lmb: true, lmbDown: true });
  const b = { x: p.pos.x, z: p.pos.z + 8 };
  let ok = false;
  for (let i = 0; i < ticks(PLAYER.repathSec); i++) {
    step(ctx, { cursor: b, lmb: true });
    if (p.path.length && near(p.path.at(-1), b) < 0.6) { ok = true; break; }
  }
  assert.ok(ok, '다시 경로를 잡았다');
  step(ctx, { cursor: null, lmb: true });
  assert.equal(p.path.length, 0);
  const pos = { ...p.pos };
  step(ctx, { cursor: null, lmb: true });
  assert.deepEqual(p.pos, pos, '멈춰 있다');
  step(ctx, { cursor: b, lmb: true });
  assert.ok(p.path.length >= 1, '커서가 돌아오면 다시 따라간다');
});

test('몬스터 클릭: 근접은 중심 거리 ≤ p.r + mon.r + reach 까지 다가가 강타 · 누르고 있으면 반복 · 뗀 뒤 새 휘두름 없음', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 6, z: p.pos.z, hp: BIG });
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true });
  assert.equal(p.intent.kind, 'attack');
  let firstAt = -1;
  for (let i = 0; i < 60 && firstAt < 0; i++) {
    step(ctx, { ...onMon(m), lmb: true });
    if (p.act === 'attack') firstAt = st.tick;
  }
  assert.ok(firstAt > 0, '강타 시작');
  const reach = p.r + m.r + BASIC_SKILLS.bash.reach;
  assert.ok(near(p.pos, m.pos) <= reach + 1e-6, '사거리 안에서 시작');
  assert.ok(near(p.pos, m.pos) > reach - 6 / 30 - 1e-6, '사거리에 들어온 틱에 곧바로');
  assert.equal(p.actSkill, 'bash');
  const n0 = countEvents(ctx.events, EV.ACTION_START);
  for (let i = 0; i < 50; i++) step(ctx, { ...onMon(m), lmb: true });
  assert.ok(countEvents(ctx.events, EV.ACTION_START) - n0 >= 2, '누르고 있으면 반복');
  // 뗀다 — 지금 휘두름은 끝내고 새 휘두름 없음
  step(ctx, onMon(m));
  const n1 = countEvents(ctx.events, EV.ACTION_START);
  for (let i = 0; i < 60; i++) step(ctx, onMon(m));
  assert.equal(countEvents(ctx.events, EV.ACTION_START), n1);
  assert.equal(p.act, 'idle');
  assert.equal(p.intent.kind, 'none');
});

test('몬스터 탭(누름 → 곧 뗌)이면 걸어가서 한 번만 휘두른다', () => {
  const { ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 5, z: p.pos.z, hp: BIG });
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true });
  for (let i = 0; i < 90; i++) step(ctx, onMon(m));
  assert.equal(countEvents(ctx.events, EV.ACTION_START), 1);
  assert.equal(countEvents(ctx.events, EV.ACTION_HIT), 1);
});

test('떼 속에서 누르고 있으면 계속 싸운다: 대상이 죽으면 hover 몬스터로 · hover 가 없으면 move-follow', () => {
  const { ctx, p } = setup({ resource: 0 });
  const a = addTestMonster(ctx, { x: p.pos.x + 1.6, z: p.pos.z, hp: BIG });
  const b = addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + 1.6, hp: BIG });
  step(ctx, { ...onMon(a), lmb: true, lmbDown: true });
  for (let i = 0; i < 5; i++) step(ctx, { ...onMon(a), lmb: true });
  a.dead = true; a.hp = 0;
  step(ctx, { ...onMon(b), lmb: true });
  assert.equal(p.intent.kind, 'attack');
  assert.equal(p.intent.targetId, b.id, '다음 대상');
  b.dead = true; b.hp = 0;
  step(ctx, { cursor: { x: p.pos.x + 5, z: p.pos.z }, lmb: true });
  assert.equal(p.intent.kind, 'move', 'hover 가 없으면 따라 걷기');
  assert.equal(p.intent.held, true);
});

test('Shift + 클릭: 제자리 · 커서 방향으로 강타(이동 없음 · facing 즉시)', () => {
  const { ctx, p } = setup({ resource: 0 });
  const pos = { ...p.pos };
  step(ctx, { cursor: { x: pos.x, z: pos.z - 5 }, lmb: true, lmbDown: true, shift: true });
  assert.equal(p.act, 'attack');
  assert.deepEqual(p.pos, pos);
  assert.ok(Math.abs(Math.abs(p.facing) - Math.PI) < 1e-9, '−Z 를 본다');
});

test('마법사: 15m 안이고 시야가 트이면 그 자리에서 마력 화살 · 아니면 다가간다', () => {
  const { st, ctx, p } = setup({ cls: 'mage' });
  const far = addTestMonster(ctx, { x: p.pos.x, z: p.pos.z + BASIC_SKILLS.magicBolt.range + 3, hp: BIG });
  step(ctx, { ...onMon(far), lmb: true, lmbDown: true });
  assert.notEqual(p.act, 'attack');
  let at = -1;
  for (let i = 0; i < 40 && at < 0; i++) { step(ctx, { ...onMon(far), lmb: true }); if (p.act === 'attack') at = st.tick; }
  assert.ok(at > 0);
  assert.ok(near(p.pos, far.pos) <= BASIC_SKILLS.magicBolt.range + 1e-6);
  assert.ok(near(p.pos, far.pos) > BASIC_SKILLS.magicBolt.range - 0.5, '사거리 끝에서 멈춘다(근접하지 않는다)');
  for (let i = 0; i < 25; i++) step(ctx, { ...onMon(far), lmb: true });
  assert.ok(st.rift.projs.some(pr => pr.owner === 'player' && pr.visual === BASIC_SKILLS.magicBolt.params.visual), '투사체');
});

test('마법사: 기둥(막는 소품)이 가리면 그 자리에서 쏘지 않는다(투사체는 소품에 끝난다) · 시야가 트인 자리면 쏜다', async () => {
  const { losClear } = await import('../src/sim/world/nav.js');
  const PILLAR = [
    '################',
    '#..............#',
    '#..............#',
    '#..S...P.......#',
    '#..............#',
    '#..............#',
    '################',
  ].join('\n');
  const map = makeTestMap(PILLAR);
  const { st, ctx, p } = setup({ cls: 'mage', map });
  const m = addTestMonster(ctx, { x: p.pos.x + 13, z: p.pos.z, hp: BIG });
  assert.ok(losClear(map, p.pos.x, p.pos.z, m.pos.x, m.pos.z), '벽만 보면 트였다');
  assert.ok(!losClear(map, p.pos.x, p.pos.z, m.pos.x, m.pos.z, { props: true }), '기둥이 가린다');
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true });
  for (let i = 0; i < 10; i++) {
    assert.notEqual(p.act, 'attack', '기둥 너머로 쏘지 않는다(다가간다)');
    step(ctx, { ...onMon(m), lmb: true });
  }
  // 옆으로 비켜 시야가 트인 자리(경로 탐색은 P4 — 여기서는 자리를 직접 옮긴다)
  p.pos = { x: p.pos.x, z: p.pos.z + 3 };
  p.path = [];
  assert.ok(losClear(map, p.pos.x, p.pos.z, m.pos.x, m.pos.z, { props: true }));
  step(ctx, { ...onMon(m), lmb: true });
  assert.equal(p.act, 'attack', '트이면 그 자리에서 쏜다');
  assert.ok(st.tick > 0);
});

// ───────────────────────── §5.3 선입력 ─────────────────────────

/** 강타 하나를 시작해 둔다 → {actEnd} */
function startBash(ctx, m) {
  const p = ctx.state.player;
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true });
  step(ctx, onMon(m));   // 뗀다 — 한 번만
  assert.equal(p.act, 'attack');
  return { actEnd: p.actEnd, actStart: p.actStart };
}

test('선입력: 후딜 중 누른 스킬은 버퍼(창 ≥ 남은 잠김)에 들어가 actEnd 틱에 시작한다', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { groundStomp: 1 }, bar: ['groundStomp'] });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  const { actEnd } = startBash(ctx, m);
  while (st.tick < actEnd - 8) step(ctx, onMon(m));
  step(ctx, { ...onMon(m), slotDown: slots(0) });   // 눌렀다 뗐다
  assert.equal(p.buffer?.kind, 'skill');
  assert.ok(p.buffer.until >= actEnd, `창 ${p.buffer.until} ≥ actEnd ${actEnd}`);
  assert.equal(countEvents(ctx.events, EV.SKILL_FAIL), 0);
  while (st.tick < actEnd) step(ctx, onMon(m));
  const s = lastStart(ctx);
  assert.equal(s.payload.skillId, 'groundStomp');
  assert.equal(p.actStart, actEnd, '잠김이 풀린 첫 틱(actEnd)에 나갔다');
  assert.equal(p.buffer, null);
});

test('선입력: 잠긴 동안의 바닥 클릭 · 다른 몬스터 클릭도 actEnd 틱에 나간다', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  const { actEnd } = startBash(ctx, m);
  const goal = { x: p.pos.x - 6, z: p.pos.z };
  step(ctx, { cursor: goal, lmbDown: true });
  assert.equal(p.buffer?.kind, 'move');
  while (st.tick < actEnd) step(ctx, { cursor: goal });
  assert.equal(p.intent.kind, 'move');
  assert.equal(p.act, 'move', 'actEnd 틱에 걷기 시작');
  // 몬스터 클릭 선입력
  const s2 = setup({ resource: 0 });
  const a = addTestMonster(s2.ctx, { x: s2.p.pos.x + 1.5, z: s2.p.pos.z, hp: BIG });
  const b = addTestMonster(s2.ctx, { x: s2.p.pos.x - 1.5, z: s2.p.pos.z, hp: BIG });
  const r = startBash(s2.ctx, a);
  step(s2.ctx, { ...onMon(b), lmbDown: true });
  assert.equal(s2.p.buffer?.kind, 'attack');
  while (s2.st.tick < r.actEnd) step(s2.ctx, onMon(b));
  assert.equal(s2.p.act, 'attack');
  assert.equal(s2.p.actStart, r.actEnd);
  assert.equal(s2.p.actTargetId, b.id);
});

test('누르고 있는 스킬은 가능해질 때마다 반복 · 한 틱에 행동 하나(스킬 칸 > 좌클릭)', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { groundStomp: 1 }, bar: ['groundStomp'] });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true, slot: slots(0), slotDown: slots(0) });
  assert.equal(countEvents(ctx.events, EV.ACTION_START), 1, '한 틱에 하나');
  assert.equal(lastStart(ctx).payload.skillId, 'groundStomp', '스킬이 우선');
  for (let i = 0; i < 60; i++) { p.resource = 100; step(ctx, { ...onMon(m), lmb: true, slot: slots(0) }); }
  const stomps = evs(ctx, EV.ACTION_START).filter(e => e.payload.skillId === 'groundStomp').length;
  assert.ok(stomps >= 3, `반복 ${stomps}`);
  assert.ok(st.tick > 0);
});

test('채널 중 다른 칸 누름: 그 틱에 채널을 끊고(후딜 없이) 돌진이 바로 나간다', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { whirlwind: 1, charge: 1 }, bar: ['whirlwind', 'charge'] });
  const cur = { x: p.pos.x + 8, z: p.pos.z };
  step(ctx, { cursor: cur, slot: slots(0), slotDown: slots(0) });
  assert.equal(p.act, 'channel');
  assert.ok(p.channel);
  for (let i = 0; i < 10; i++) step(ctx, { cursor: cur, slot: slots(0) });
  const t = st.tick + 1;
  step(ctx, { cursor: cur, slot: [true, true, false, false, false], slotDown: slots(1) });
  const off = evs(ctx, EV.CHANNEL).filter(e => e.payload.on === false);
  assert.equal(off.length, 1);
  assert.equal(p.act, 'dash');
  assert.equal(p.actStart, t, '같은 틱');
  assert.equal(lastStart(ctx).payload.skillId, 'charge');
});

test('채널 키를 떼면 endRecover 후딜 — 그 사이 누름은 버퍼로', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { whirlwind: 1, groundStomp: 1 }, bar: ['whirlwind', 'groundStomp'] });
  step(ctx, { cursor: { x: p.pos.x + 5, z: p.pos.z }, slot: slots(0), slotDown: slots(0) });
  for (let i = 0; i < 5; i++) step(ctx, { slot: slots(0) });
  step(ctx, {});   // 뗐다
  assert.equal(p.channel, null);
  assert.equal(p.act, 'channel', '후딜');
  const end = p.actEnd;
  assert.ok(end > st.tick);
  step(ctx, { slotDown: slots(1) });
  assert.equal(p.buffer?.skillId, 'groundStomp');
  while (st.tick < end) step(ctx, {});
  assert.equal(lastStart(ctx).payload.skillId, 'groundStomp');
  assert.equal(p.actStart, end);
});

test('곧 풀릴 쿨다운(≤ BUFFER.sec)의 누름은 SKILL_FAIL 대신 버퍼 → 풀린 틱에 · 그보다 길면 SKILL_FAIL cooldown', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { warCry: 1 }, bar: ['warCry'] });
  step(ctx, { slotDown: slots(0) });
  assert.equal(lastStart(ctx).payload.skillId, 'warCry');
  const readyAt = p.readyAt.warCry;
  assert.ok(readyAt > st.tick + ticks(BUFFER.sec));
  while (p.act !== 'idle') step(ctx, {});
  step(ctx, { slotDown: slots(0) });
  assert.deepEqual(evs(ctx, EV.SKILL_FAIL).map(e => e.payload), [{ skillId: 'warCry', reason: 'cooldown' }]);
  while (st.tick < readyAt - ticks(BUFFER.sec)) step(ctx, {});
  step(ctx, { slotDown: slots(0) });
  assert.equal(countEvents(ctx.events, EV.SKILL_FAIL), 1, '버퍼 — 실패 알림 없음');
  assert.ok(p.buffer && p.buffer.until >= readyAt);
  while (st.tick < readyAt) step(ctx, {});
  assert.equal(p.actStart, readyAt, '풀린 첫 틱');
  assert.equal(countEvents(ctx.events, EV.ACTION_START), 2);
});

test('속박: 남은 ≤ BUFFER.sec 인 이동 스킬 누름은 버퍼 → 풀린 틱에 · 길면 SKILL_FAIL rooted · 이동 스킬이 아니면 그냥 된다', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { charge: 1, groundStomp: 1 }, bar: ['charge', 'groundStomp'] });
  const cur = { x: p.pos.x + 6, z: p.pos.z };
  p.st.rootUntil = st.tick + 40;
  step(ctx, { cursor: cur, slotDown: slots(0) });
  assert.deepEqual(evs(ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'charge', reason: 'rooted' });
  step(ctx, { cursor: cur, slotDown: slots(1) });
  assert.equal(lastStart(ctx).payload.skillId, 'groundStomp', '공격 · 시전은 된다');
  while (p.act !== 'idle') step(ctx, { cursor: cur });
  p.st.rootUntil = st.tick + 10;
  step(ctx, { cursor: cur, slotDown: slots(0) });
  assert.equal(p.buffer?.skillId, 'charge');
  const rootUntil = p.st.rootUntil;
  while (st.tick < rootUntil) step(ctx, { cursor: cur });
  assert.equal(p.act, 'dash');
  assert.equal(p.actStart, rootUntil);
});

test('빈 칸 · 마을의 스킬 · 마을의 T 는 SKILL_FAIL(empty · town · recall town) — 같은 실패는 0.5초에 한 번', () => {
  const r = setup({ resource: 100 });
  step(r.ctx, { slotDown: slots(2) });
  assert.deepEqual(evs(r.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: null, reason: 'empty' });
  step(r.ctx, { slotDown: slots(2) });
  assert.equal(countEvents(r.ctx.events, EV.SKILL_FAIL), 1, '0.5초 안의 같은 실패는 한 번');
  for (let i = 0; i < ticks(PLAYER.failGapSec); i++) step(r.ctx, {});
  step(r.ctx, { slotDown: slots(2) });
  assert.equal(countEvents(r.ctx.events, EV.SKILL_FAIL), 2);
  const t = setup({ scene: 'town', map: townMapFromData(), ranks: { groundStomp: 1 }, bar: ['groundStomp'], resource: 100 });
  step(t.ctx, { slotDown: slots(0), cursor: { x: 24, z: 24 } });
  assert.deepEqual(evs(t.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'groundStomp', reason: 'town' });
  step(t.ctx, { recallDown: true });
  assert.deepEqual(evs(t.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'recall', reason: 'town' });
  assert.equal(countEvents(t.ctx.events, EV.ACTION_START), 0);
});

// ───────────────────────── §5.5 포션 ─────────────────────────

test('포션: 회복 · 개수 −1 · 쿨다운 · 행동을 잠그지 않는다(같은 틱에 강타)', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  p.life = 30;
  const before = st.char.potions;
  step(ctx, { ...onMon(m), lmb: true, lmbDown: true, potionDown: true });
  const pe = evs(ctx, EV.POTION);
  assert.equal(pe.length, 1);
  assert.ok(Math.abs(pe[0].payload.heal - Math.min(p.lifeMax * POTION.heal, p.lifeMax - 30)) < 1e-9);
  assert.equal(pe[0].payload.left, before - 1);
  assert.equal(st.char.potions, before - 1);
  assert.equal(p.potionReadyAt, st.tick + ticks(POTION.cd));
  assert.equal(p.act, 'attack', '포션이 행동을 막지 않는다');
  assert.ok(p.life >= 30);
});

test('포션: 쿨다운 남은 ≤ BUFFER.sec 면 대기열 → potionReadyAt 틱에 마신다 · 길면 cooldown · 가득이면 full · 0개면 empty', () => {
  const { st, ctx, p } = setup();
  p.life = 10;
  step(ctx, { potionDown: true });
  const readyAt = p.potionReadyAt;
  step(ctx, { potionDown: true });
  assert.deepEqual(evs(ctx, EV.POTION_FAIL).at(-1).payload, { reason: 'cooldown' });
  while (st.tick < readyAt - ticks(BUFFER.sec)) step(ctx, {});
  p.life = 10;
  step(ctx, { potionDown: true });
  assert.ok(p.potionQueuedUntil >= readyAt);
  const n = countEvents(ctx.events, EV.POTION);
  while (st.tick < readyAt) step(ctx, {});
  assert.equal(countEvents(ctx.events, EV.POTION), n + 1, 'potionReadyAt 틱에 마셨다');
  assert.equal(p.potionQueuedUntil, 0);
  // 대기 중에 생명이 가득 차면 full
  const s2 = setup();
  s2.p.life = 10;
  step(s2.ctx, { potionDown: true });
  while (s2.st.tick < s2.p.potionReadyAt - 3) step(s2.ctx, {});
  step(s2.ctx, { potionDown: true });
  s2.p.life = s2.p.lifeMax;
  for (let i = 0; i < 5; i++) step(s2.ctx, {});
  assert.deepEqual(evs(s2.ctx, EV.POTION_FAIL).at(-1).payload, { reason: 'full' });
  // 가득 · 0개
  const s3 = setup();
  step(s3.ctx, { potionDown: true });
  assert.deepEqual(evs(s3.ctx, EV.POTION_FAIL).at(-1).payload, { reason: 'full' });
  s3.st.char.potions = 0;
  s3.p.life = 5;
  step(s3.ctx, { potionDown: true });
  assert.deepEqual(evs(s3.ctx, EV.POTION_FAIL).at(-1).payload, { reason: 'empty' });
  assert.equal(s3.st.char.potions, 0);
});

test('포션은 마을에서도 된다', () => {
  const { ctx, p } = setup({ scene: 'town', map: townMapFromData() });
  p.life = 10;
  step(ctx, { potionDown: true });
  assert.equal(countEvents(ctx.events, EV.POTION), 1);
});

// ───────────────────────── §5.5 귀환 ─────────────────────────

test('귀환: T → 1.5초 시전(이동 멈춤 · RECALL start) → 두루마리 −1 · RECALL done', () => {
  const { st, ctx, p } = setup();
  const goal = { x: p.pos.x + 8, z: p.pos.z };
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  const scrolls = st.char.scrolls;
  step(ctx, { cursor: goal, lmb: true, recallDown: true });
  assert.equal(p.act, 'recall');
  assert.deepEqual(evs(ctx, EV.RECALL).at(-1).payload, { phase: 'start', sec: PLAYER.recallSec });
  assert.equal(p.recall.end - p.recall.start, ticks(PLAYER.recallSec));
  const pos = { ...p.pos };
  const end = p.recall.end;
  while (st.tick < end - 1) { step(ctx, {}); assert.deepEqual(p.pos, pos, '시전 중 이동 없음'); }
  assert.equal(st.char.scrolls, scrolls);
  step(ctx, {});
  assert.equal(st.char.scrolls, scrolls - 1);
  assert.equal(evs(ctx, EV.RECALL).at(-1).payload.phase, 'done');
  assert.equal(p.recall, null);
  assert.equal(p.act, 'idle');
});

test('귀환 취소: 생명 피해(onPlayerDamaged) → cancel damage · 새 행동 입력 → cancel action(그 입력은 같은 틱에) · 0개 → SKILL_FAIL empty', () => {
  const a = setup({ resource: 0 });
  step(a.ctx, { recallDown: true });
  onPlayerDamaged(a.ctx, 5);
  assert.deepEqual(evs(a.ctx, EV.RECALL).at(-1).payload.reason, 'damage');
  assert.equal(a.p.recall, null);
  assert.equal(a.p.act, 'idle');
  onPlayerDamaged(a.ctx, 0);   // 0 은 무시
  const b = setup({ resource: 0 });
  const m = addTestMonster(b.ctx, { x: b.p.pos.x + 1.5, z: b.p.pos.z, hp: BIG });
  step(b.ctx, { recallDown: true });
  step(b.ctx, { ...onMon(m), lmb: true, lmbDown: true });
  assert.equal(evs(b.ctx, EV.RECALL).at(-1).payload.reason, 'action');
  assert.equal(b.p.act, 'attack', '취소한 틱에 그 입력이 나갔다');
  const c = setup();
  c.st.char.scrolls = 0;
  step(c.ctx, { recallDown: true });
  assert.deepEqual(evs(c.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'recall', reason: 'empty' });
  assert.equal(c.p.act, 'idle');
});

test('귀환: 행동 중 T 는 선입력(행동이 끝난 첫 틱에 시작)', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  const { actEnd } = startBash(ctx, m);
  step(ctx, { ...onMon(m), recallDown: true });
  assert.equal(p.buffer?.skillId, 'recall');
  while (st.tick < actEnd) step(ctx, onMon(m));
  assert.equal(p.act, 'recall');
  assert.equal(p.recall.start, actEnd);
});

// ───────────────────────── §5.2-8 몸 · 밀림 ─────────────────────────

test('일반 몬스터는 밀고 빠져나간다(이동 × shoveMul · 겹친 만큼 비킨다) · 정예 · 구조물에는 막힌다', () => {
  const { st, ctx, p } = setup();
  const goal = { x: p.pos.x + 8, z: p.pos.z };
  const g = addTestMonster(ctx, { x: p.pos.x + 3, z: p.pos.z, hp: BIG });
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  let slowed = false;
  for (let i = 0; i < 80; i++) {
    const x0 = p.pos.x;
    step(ctx, { cursor: goal, lmb: true });
    if (p.pos.x - x0 > 0 && p.pos.x - x0 < 6 / 30 - 1e-6) slowed = true;
  }
  assert.ok(near(p.pos, goal) < 0.5, `빠져나가 목적지에 닿았다 ${JSON.stringify(p.pos)}`);
  assert.ok(slowed, '미는 동안 느려졌다');
  assert.ok(near(p.pos, g.pos) >= p.r + g.r - 1e-6, '겹치지 않는다');
  // 정예 — 막힌다
  const e = setup();
  const goal2 = { x: e.p.pos.x + 8, z: e.p.pos.z };
  const el = addTestMonster(e.ctx, { rank: 'elite', x: e.p.pos.x + 3, z: e.p.pos.z, hp: BIG });
  const elPos = { ...el.pos };
  step(e.ctx, { cursor: goal2, lmb: true, lmbDown: true });
  for (let i = 0; i < 60; i++) {
    step(e.ctx, { cursor: goal2, lmb: true });
    assert.ok(near(e.p.pos, el.pos) >= e.p.r + el.r - 1e-6, '정예 원 안으로 들어가지 않는다');
  }
  assert.deepEqual(el.pos, elPos, '정예는 밀리지 않는다');
  assert.ok(e.p.pos.x < el.pos.x, '정예 너머로 가지 못했다(정면)');
  // 구조물(뼈 둥지 · 일반 등급) — 막힌다
  const n = setup();
  const goal3 = { x: n.p.pos.x + 8, z: n.p.pos.z };
  const nest = addTestMonster(n.ctx, { typeId: 'boneNest', x: n.p.pos.x + 3, z: n.p.pos.z, hp: BIG });
  const nestPos = { ...nest.pos };
  step(n.ctx, { cursor: goal3, lmb: true, lmbDown: true });
  for (let i = 0; i < 60; i++) step(n.ctx, { cursor: goal3, lmb: true });
  assert.deepEqual(nest.pos, nestPos);
  assert.ok(near(n.p.pos, nest.pos) >= n.p.r + nest.r - 1e-6);
  assert.ok(st.tick > 0);
});

test('떼에 둘러싸여도 걸어서 빠져나온다(일반 8마리 고리)', () => {
  const { ctx, p } = setup();
  const c = { ...p.pos };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    addTestMonster(ctx, { x: c.x + Math.sin(a) * 0.9, z: c.z + Math.cos(a) * 0.9, hp: BIG });
  }
  const goal = { x: c.x + 6, z: c.z + 1 };
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  for (let i = 0; i < 90; i++) step(ctx, { cursor: goal, lmb: true });
  assert.ok(near(p.pos, c) > 4, `빠져나왔다 ${near(p.pos, c).toFixed(2)}m`);
});

test('밀림(knock): 남은 동안 경로 이동 대신 밀린다 · 행동은 계속 · until 이 지나면 사라진다', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const goal = { x: p.pos.x + 8, z: p.pos.z };
  step(ctx, { cursor: goal, lmb: true, lmbDown: true });
  p.knock = { vx: 0, vz: 8, until: st.tick + 4 };
  const x0 = p.pos.x, z0 = p.pos.z;
  for (let i = 0; i < 3; i++) step(ctx, { cursor: goal, lmb: true });
  assert.equal(p.pos.x, x0, '경로 이동이 멈췄다');
  assert.ok(Math.abs(p.pos.z - z0 - 3 * 8 / 30) < 1e-6, '밀린 거리');
  step(ctx, { cursor: goal, lmb: true });
  step(ctx, { cursor: goal, lmb: true });
  assert.equal(p.knock, null);
  assert.ok(p.pos.x > x0, '다시 걷는다');
  // 행동 중 밀림 — 행동은 계속
  const s = setup({ resource: 0 });
  const m = addTestMonster(s.ctx, { x: s.p.pos.x + 1.5, z: s.p.pos.z, hp: BIG });
  const { actEnd } = startBash(s.ctx, m);
  s.p.knock = { vx: -6, vz: 0, until: s.st.tick + 3 };
  step(s.ctx, onMon(m));
  assert.equal(s.p.act, 'attack');
  assert.equal(s.p.actEnd, actEnd);
});

// ───────────────────────── §5.2-9 도착 ─────────────────────────

test('줍기: 드랍(이름표 클릭)으로 걸어가 itemReach 안에서 pickupDrop · 의도 끝', () => {
  const { ctx, p } = setup();
  const d = addTestDrop(ctx, p.pos.x + 6, p.pos.z + 2);
  step(ctx, { cursor: null, hover: { kind: 'drop', id: d.id, src: 'label' }, lmbDown: true });
  assert.equal(p.intent.kind, 'pickup');
  let arrived = false;
  for (let i = 0; i < 60; i++) {
    step(ctx, {});
    if (p.intent.kind === 'none') { arrived = true; break; }
  }
  assert.ok(arrived);
  assert.ok(near(p.pos, d.pos) <= PICKUP.itemReach + 1e-6);
});

test('상호작용: NPC 에 도착하면 INTERACT{npc} · 마을 포털이면 requestReturnToRift · 균열 나가는 포털이면 returnPos + 마을로', () => {
  const map = townMapFromData();
  const t = setup({ scene: 'town', map });
  const bs = map.objects.find(o => o.id === 'blacksmith');
  step(t.ctx, { cursor: { x: bs.x, z: bs.z }, hover: { kind: 'object', id: 'blacksmith', src: 'pick' }, lmbDown: true });
  for (let i = 0; i < 120 && !countEvents(t.ctx.events, EV.INTERACT); i++) step(t.ctx, {});
  assert.deepEqual(evs(t.ctx, EV.INTERACT)[0].payload, { kind: 'npc', id: 'blacksmith' });
  assert.ok(Math.hypot(t.p.pos.x - bs.x, t.p.pos.z - bs.z) <= bs.r + PICKUP.interactReach + 1e-6);
  // 마을 포털(열린 균열이 있다) — 이벤트는 audio 용 · 실제 이동은 requestReturnToRift(P2 — 스텁이면 아무 일 없음)
  const withRift = () => {
    const s = setup({ scene: 'town', map });
    const rm = makeTestMap();
    s.st.rift = createRiftState({ level: 1, seed: 3, tileset: rm.tileset, mapId: rm.id, map: rm });
    return s;
  };
  const probe = requestReturnToRift(withRift().ctx);
  const u = withRift();
  const tp = map.objects.find(o => o.id === 'townPortal');
  step(u.ctx, { cursor: { x: tp.x, z: tp.z }, hover: { kind: 'object', id: 'townPortal', src: 'pick' }, lmbDown: true });
  for (let i = 0; i < 120 && !countEvents(u.ctx.events, EV.INTERACT); i++) step(u.ctx, {});
  assert.deepEqual(evs(u.ctx, EV.INTERACT)[0].payload, { kind: 'townPortal', id: 'townPortal' });
  assert.equal(u.p.intent.kind, 'none');
  if (probe.ok) assert.deepEqual(u.st.pendingTravel && { to: u.st.pendingTravel.to, reason: u.st.pendingTravel.reason }, { to: 'rift', reason: 'townPortal' }, '마을 포털 → 균열 복귀');
  else assert.equal(u.st.pendingTravel, null);
  // 균열 나가는 포털
  const r = setup();
  const portal = { id: 'portal:900', kind: 'exit', pos: { x: r.p.pos.x + 4, z: r.p.pos.z }, r: 1.0, born: 0 };
  r.st.rift.portals.push(portal);
  step(r.ctx, { cursor: { ...portal.pos }, hover: { kind: 'object', id: portal.id, src: 'pick' }, lmbDown: true });
  for (let i = 0; i < 60 && !r.st.pendingTravel; i++) step(r.ctx, {});
  assert.deepEqual(r.st.pendingTravel && { to: r.st.pendingTravel.to, reason: r.st.pendingTravel.reason }, { to: 'town', reason: 'exit' });
  assert.ok(r.st.rift.returnPos && near(r.st.rift.returnPos, r.p.pos) < 1e-9);
  assert.deepEqual(evs(r.ctx, EV.INTERACT)[0].payload, { kind: 'riftPortal', id: 'portal:900' });
});

test('잠긴 동안 드랍 클릭은 의도로 남아 행동이 끝난 뒤 걸어가 줍는다', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  const d = addTestDrop(ctx, p.pos.x - 4, p.pos.z);
  const { actEnd } = startBash(ctx, m);
  step(ctx, { cursor: { ...d.pos }, hover: { kind: 'drop', id: d.id, src: 'pick' }, lmbDown: true });
  assert.equal(p.intent.kind, 'pickup');
  assert.equal(p.act, 'attack', '지금 휘두름은 끝낸다');
  while (st.tick < actEnd + 40 && p.intent.kind === 'pickup') step(ctx, {});
  assert.equal(p.intent.kind, 'none');
  assert.ok(near(p.pos, d.pos) <= PICKUP.itemReach + 1e-6);
});

// ───────────────────────── 분노 · 자원 · 장면 ─────────────────────────

test('분노: 강타 적중 +onBasicHit · 피격 +onHitTaken(초당 상한) · 3초 뒤 초당 감소', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
  const { actStart } = startBash(ctx, m);
  while (countEvents(ctx.events, EV.ACTION_HIT) < 1) step(ctx, onMon(m));
  // W1 수정(NOTES-W1FIX): onBasicHit 6 → 8 — 데이터 값으로 본다(계약 §7.1)
  const onHit = CLASSES[0].rage.onBasicHit;
  assert.equal(onHit, 8);
  assert.equal(p.resource, onHit);
  assert.ok(st.tick - actStart >= 1);
  for (let i = 0; i < 10; i++) onPlayerDamaged(ctx, 3);
  assert.equal(p.resource, onHit + 8, '피격 분노는 초당 8 까지');
  const peak = p.resource;
  const until = p.combatUntil;
  while (st.tick < until - 1) step(ctx, onMon(m));
  assert.equal(p.resource, peak, '전투 중에는 줄지 않는다');
  for (let i = 0; i < 30; i++) step(ctx, onMon(m));
  assert.ok(Math.abs(p.resource - (peak - 5)) < 0.2, `초당 5 감소 ${p.resource}`);
});

test('마나: 초당 resourceRegen 으로 차고 최대에서 멈춘다', () => {
  const { ctx, p } = setup({ cls: 'mage', resource: 10 });
  for (let i = 0; i < 30; i++) step(ctx, {});
  // 1초 = 10 + ctx.stats.resourceRegen(makeTestStats 레벨 1 — 데이터의 마법사 regen.base · 피드백 2 다듬기 7 → 10)
  assert.ok(ctx.stats.resourceRegen > 0);
  assert.ok(Math.abs(p.resource - (10 + ctx.stats.resourceRegen)) < 1e-6, `${p.resource}`);
  for (let i = 0; i < 600; i++) step(ctx, {});
  assert.equal(p.resource, p.resourceMax);
});

test('placePlayer 는 위치 · 경로 · 의도 · 행동을 정리 · resetPlayerForScene({full}) 은 생명 · 마나 가득 · 분노 0 · 버프 · 상태 정리', () => {
  const { st, ctx, p } = setup({ resource: 50, ranks: { whirlwind: 1 }, bar: ['whirlwind'] });
  step(ctx, { cursor: { x: p.pos.x + 5, z: p.pos.z }, slot: slots(0), slotDown: slots(0) });
  assert.ok(p.channel);
  placePlayer(ctx, 10, 12, 1);
  assert.deepEqual(p.pos, { x: 10, z: 12 });
  assert.deepEqual(p.prevPos, { x: 10, z: 12 });
  assert.equal(p.facing, 1);
  assert.equal(p.channel, null);
  assert.equal(p.act, 'idle');
  assert.deepEqual(p.intent, { kind: 'none' });
  assert.equal(evs(ctx, EV.CHANNEL).at(-1).payload.on, false);
  p.life = 3; p.buffs = [{ id: 'warCry', until: st.tick + 99, value: 0.4 }]; p.st.rootUntil = st.tick + 50; p.shield = 9;
  resetPlayerForScene(ctx, { full: true });
  assert.equal(p.life, p.lifeMax);
  assert.equal(p.resource, 0, '분노 0');
  assert.deepEqual(p.buffs, []);
  assert.equal(p.shield, 0);
  assert.equal(p.st.rootUntil, 0);
  const m = setup({ cls: 'mage', resource: 1 });
  resetPlayerForScene(m.ctx, { full: true });
  assert.equal(m.p.resource, m.p.resourceMax, '마나 가득');
});

test('퍼즈: 무작위 입력 3,000틱(전사 · 마법사) — 예외 0 · 유한수 · 생명 · 자원 범위 · 걷기 가능', async () => {
  const { isWalkable } = await import('../src/sim/world/nav.js');
  for (const cls of ['warrior', 'mage']) {
    const ranks = cls === 'warrior'
      ? { groundStomp: 2, charge: 1, whirlwind: 1, leap: 1, warCry: 1, earthquake: 1 }
      : { fireball: 2, frostNova: 1, teleport: 1, chainLightning: 1, meteor: 1, energyShield: 1 };
    const bar = Object.keys(ranks).slice(0, 5);
    const { st, ctx, p } = setup({ cls, ranks, bar, resource: 50 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      addTestMonster(ctx, { x: p.pos.x + Math.sin(a) * (3 + k % 4), z: p.pos.z + Math.cos(a) * (3 + k % 4), hp: BIG, rank: k === 3 ? 'elite' : 'normal' });
    }
    const gen = randomInputs(7 + cls.length);
    for (let i = 0; i < 3000; i++) {
      st.tick += 1;
      p.prevPos = { x: p.pos.x, z: p.pos.z };
      updatePlayer(ctx, gen(st.tick, st));
      if (st.pendingTravel) st.pendingTravel = null;
      if (i % 50 === 0) p.resource = Math.min(p.resourceMax, p.resource + 10);
      assert.ok(p.life >= 0 && p.life <= p.lifeMax + 1e-9);
      assert.ok(p.resource >= 0 && p.resource <= p.resourceMax + 1e-9);
      assert.ok(isWalkable(ctx.map, p.pos.x, p.pos.z), `걷기 가능 ${JSON.stringify(p.pos)} @${i}`);
    }
    const { events, ...rest } = st;
    assertFiniteDeep(rest);
    assert.ok(countEvents(ctx.events, EV.ACTION_START) > 20, `${cls} 행동이 실제로 일어났다`);
    assert.ok(JSON.stringify(rest).length > 0, '순수 객체(JSON)');
  }
});
