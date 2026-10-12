// OWNER: P1 — 계약 §12.2(skills.test) · §5.4 동작 14 · §7.2 수치 · §9.6 치수 · §8.4 변형 패치 · describeSkill · skillReady
// 같은 웨이브의 남의 구현에 기대지 않는다 — 판정 대상은 P1 상태(sk.hitIds · 효과 · 투사체)로 보고, 피해 · 상태 이상은
// 실제 combat 이 있을 때만(탐침으로 확인) 더 본다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APS_REF, PLAYER_ACTS } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { deg2rad, wrapAngle } from '../src/core/math.js';
import { ticks } from '../src/core/time.js';
import { CLASSES, PLAYER } from '../src/data/classes.js';
import { getNode } from '../src/data/index.js';
import { LEGENDARIES } from '../src/data/legendaries.js';
import { MONSTERS } from '../src/data/monsters.js';
import { BASIC_SKILLS, PATCH_KEYS, SKILL_NODES } from '../src/data/skills.js';
import { mapFromAscii } from '../src/debug/fixtureMap.js';
import { playerHit } from '../src/sim/combat.js';
import { updatePlayer } from '../src/sim/player/controller.js';
import { SKILL_BEHAVIORS, describeSkill, skillParams, skillReady } from '../src/sim/player/skills.js';
import { updateEffects } from '../src/sim/effects.js';
import { isWalkableR, tileAt } from '../src/sim/world/nav.js';
import { addTestMonster, countEvents, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

const BIG = 1e6;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 가운데 벽 기둥(i = 6 · x ∈ [12, 14))이 있는 방 — 시작점 (7, 7) */
const WALL_MAP = [
  '##############',
  '#.....#......#',
  '#.....#......#',
  '#..S..#......#',
  '#.....#......#',
  '#.....#......#',
  '##############',
].join('\n');

/** steady: 자원이 저절로 바뀌지 않게(전사 — 전투 중으로 둬 분노 감소 없음 · 마법사 — 마나 재생 0) — 비용을 정확히 본다 */
function setup({ cls = 'warrior', ranks = {}, bar = [], resource = 100, stats = {}, map = null, steady = true } = {}) {
  const m = map ? mapFromAscii(map, { id: 'test:wall', kind: 'rift', tileset: 'crypt' }) : null;
  const st = makeTestState({ cls, map: m });
  st.char.skills.ranks = { ...ranks };
  st.char.skills.bar = [0, 1, 2, 3, 4].map(i => bar[i] ?? null);
  const ctx = makeTestCtx(st, { map: m, stats: makeTestStats({ cls, ...(steady ? { resourceRegen: 0 } : {}), ...stats }) });
  st.player.resource = Math.min(resource, st.player.resourceMax);
  if (steady) st.player.combatUntil = 1e6;
  return { st, ctx, p: st.player };
}
function step(ctx, inp = {}) {
  const st = ctx.state;
  st.tick += 1;
  st.player.prevPos = { x: st.player.pos.x, z: st.player.pos.z };
  updatePlayer(ctx, makeInput(inp));
}
const slots = (i) => { const a = [false, false, false, false, false]; a[i] = true; return a; };
const evs = (ctx, name) => ctx.events.filter(e => e.name === name);
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** 칸 0 의 스킬을 커서에 시전(누름) */
const cast = (ctx, cursor, extra = {}) => step(ctx, { cursor, slotDown: slots(0), ...extra });
/** 판정 틱까지 민다 */
function toHit(ctx, inp = {}) {
  const p = ctx.state.player;
  const at = p.actHit;
  while (ctx.state.tick < at) step(ctx, inp);
}

/** 실제 combat(P2)이 있는가 — 스텁은 피해 0 */
function realCombat() {
  const st = makeTestState({});
  const ctx = makeTestCtx(st);
  const m = addTestMonster(ctx, { x: st.player.pos.x + 1, z: st.player.pos.z, hp: BIG });
  const r = playerHit(ctx, m, { skillId: 'bash', coef: 1, type: 'phys', tags: ['melee'], actionId: 1, srcX: st.player.pos.x, srcZ: st.player.pos.z });
  return r.dmg > 0;
}
const REAL = realCombat();

// ───────────────────────── 시각 · 비용 · 쿨 ─────────────────────────

test('행동 길이: 기본 공격 = 1/aps · 판정 = × hitFrac · scaled 스킬 = action × APS_REF / aps · 고정 스킬은 그대로', () => {
  for (const aps of [1.4, 2.0]) {
    const { st, ctx, p } = setup({ ranks: { groundStomp: 1, warCry: 1 }, bar: ['groundStomp', 'warCry'], stats: { aps } });
    const m = addTestMonster(ctx, { x: p.pos.x + 1.5, z: p.pos.z, hp: BIG });
    step(ctx, { cursor: { ...m.pos }, hover: { kind: 'monster', id: m.id, src: 'pick' }, lmbDown: true });
    const dur = 1 / aps;
    assert.equal(p.actHit - p.actStart, Math.max(1, ticks(dur * BASIC_SKILLS.bash.hitFrac)));
    assert.equal(p.actEnd - p.actStart, ticks(dur));
    while (p.act !== 'idle') step(ctx, {});
    cast(ctx, { x: p.pos.x + 3, z: p.pos.z });
    const gs = getNode('groundStomp').skill;
    const d2 = gs.action * APS_REF / aps;
    assert.equal(p.actSkill, 'groundStomp');
    assert.equal(p.actEnd - p.actStart, ticks(d2));
    assert.equal(p.actHit - p.actStart, ticks(d2 * gs.hitFrac));
    while (p.act !== 'idle') step(ctx, {});
    step(ctx, { slotDown: slots(1) });
    assert.equal(p.actSkill, 'warCry');
    assert.equal(p.actEnd - p.actStart, ticks(getNode('warCry').skill.action), '전투 함성은 공격 속도와 무관');
    assert.ok(st.tick > 0);
  }
});

test('비용 · 쿨다운: 시작에 지불(× (1 − costReduce)) · readyAt = tick + ticks(cd × (1 − cdr)) · 모자라면 SKILL_FAIL resource(행동 없음)', () => {
  const a = setup({ resource: 10, ranks: { groundStomp: 1 }, bar: ['groundStomp'] });
  cast(a.ctx, { x: a.p.pos.x + 3, z: a.p.pos.z });
  assert.deepEqual(evs(a.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'groundStomp', reason: 'resource' });
  assert.equal(a.p.act, 'idle');
  assert.equal(a.p.resource, 10);
  const b = setup({ resource: 100, ranks: { earthquake: 1 }, bar: ['earthquake'], stats: { cdr: 0.25, costReduce: 0.2 } });
  cast(b.ctx, { x: b.p.pos.x + 3, z: b.p.pos.z });
  assert.equal(b.p.actSkill, 'earthquake');
  assert.ok(Math.abs(b.p.resource - (100 - 30 * 0.8)) < 1e-9);
  assert.equal(b.p.readyAt.earthquake, b.st.tick + ticks(8 * 0.75));
  const c = setup({ cls: 'mage', ranks: { teleport: 3 }, bar: ['teleport'] });
  cast(c.ctx, { x: c.p.pos.x + 5, z: c.p.pos.z });
  assert.equal(c.p.readyAt.teleport, c.st.tick + ticks(2.6), '랭크별 쿨다운');
  assert.ok(Math.abs(c.p.resource - (100 - 18)) < 1e-9);
});

test('분노 생성(gen): 돌진 +10 · 전투 함성 +30 은 시전 시작에', () => {
  const { ctx, p } = setup({ resource: 0, ranks: { charge: 1, warCry: 1 }, bar: ['charge', 'warCry'] });
  cast(ctx, { x: p.pos.x + 6, z: p.pos.z });
  assert.equal(p.resource, 10);
  while (p.act !== 'idle') step(ctx, {});
  step(ctx, { slotDown: slots(1) });
  assert.equal(p.resource, 40);
  const buff = evs(ctx, EV.BUFF);
  toHit(ctx);
  const on = evs(ctx, EV.BUFF).filter(e => e.payload.on);
  assert.equal(buff.length, 0, '버프는 판정 틱에');
  assert.deepEqual(on.at(-1).payload, { id: 'warCry', on: true, sec: 8, value: 0.40 });
});

// ───────────────────────── 모양 치수(§9.6) ─────────────────────────

test('피드백 1 — 회전 베기(groundStomp · spinSlash): 플레이어 중심 원 r 2.5 · 360°(앞 · 옆 · 뒤 모두 · 몸 반지름 포함) — 밖은 안 맞는다 · 넉백은 바깥쪽 · 흔들림 없음', () => {
  const { st, ctx, p } = setup({ ranks: { groundStomp: 1 }, bar: ['groundStomp'] });
  const gs = getNode('groundStomp').skill;
  assert.equal(gs.behavior, 'spinSlash');
  assert.equal(gs.radius, 2.5);
  const o = { ...p.pos };
  const r = 0.45;
  const R = gs.radius + r;
  const at = (deg, d) => { const a = deg2rad(90 + deg); return { x: o.x + Math.sin(a) * d, z: o.z + Math.cos(a) * d }; };
  const front = addTestMonster(ctx, { ...at(0, R - 0.05), hp: BIG });
  const side = addTestMonster(ctx, { ...at(90, R - 0.05), hp: BIG });
  const back = addTestMonster(ctx, { ...at(180, R - 0.05), hp: BIG });
  const backLeft = addTestMonster(ctx, { ...at(-135, 1.2), hp: BIG });
  const beyond = addTestMonster(ctx, { ...at(180, R + 0.1), hp: BIG });
  const beyond2 = addTestMonster(ctx, { ...at(45, R + 0.1), hp: BIG });
  cast(ctx, { x: o.x + 5, z: o.z });   // +X 를 본다(충격파 · 연출의 시작각)
  assert.equal(p.act, 'attack');
  assert.ok(Math.abs(p.facing - Math.PI / 2) < 1e-9);
  toHit(ctx);
  assert.deepEqual([...p.sk.hitIds].sort((a, b) => a - b), [front.id, side.id, back.id, backLeft.id].sort((a, b) => a - b), '둘레 360° 안은 모두');
  assert.ok(!p.sk.hitIds.includes(beyond.id) && !p.sk.hitIds.includes(beyond2.id), '반지름 밖');
  assert.equal(evs(ctx, EV.SHAKE).length, 0, '횡베기 — 화면 흔들림 없음');
  assert.equal(evs(ctx, EV.ACTION_HIT).at(-1).payload.skillId, 'groundStomp');
  if (REAL) {
    assert.ok(back.knock, '넉백(실제 combat)');
    const vx = back.knock.vx, vz = back.knock.vz;
    assert.ok(vx * (back.pos.x - o.x) + vz * (back.pos.z - o.z) > 0, '플레이어에게서 바깥쪽');
    assert.ok(!(back.st.stunUntil > st.tick), '기절 없음(옛 지면 강타의 기절은 넉백으로 바뀌었다)');
  }
});

test('피드백 1 — 가르기(bash · cleave): 대상 쪽 반원(180°) · 반지름 = 몸 r + reach + 관용 — 닿는 적 모두 · 등 뒤 · 부채꼴 밖 · 사거리 밖은 안 맞는다 · 분노 = onBasicHit + 추가 대상(상한)', () => {
  const { st, ctx, p } = setup({ resource: 0 });
  const def = BASIC_SKILLS.bash;
  assert.equal(def.behavior, 'cleave');
  assert.equal(def.angleDeg, 180);
  const o = { ...p.pos };
  const r = 0.45;
  const R = p.r + def.reach + PLAYER.reachTolerance;
  assert.ok(Math.abs(R - 1.9) < 1e-9, '판정 부채꼴 반지름 1.9m(§9.6)');
  const at = (deg, d) => { const a = deg2rad(90 + deg); return { x: o.x + Math.sin(a) * d, z: o.z + Math.cos(a) * d }; };
  const target = addTestMonster(ctx, { ...at(0, 1.5), hp: BIG });
  const left = addTestMonster(ctx, { ...at(-60, 1.6), hp: BIG });
  const right = addTestMonster(ctx, { ...at(80, R + r - 0.05), hp: BIG });
  const edge = addTestMonster(ctx, { ...at(0, R + r - 0.05), hp: BIG });
  const behind = addTestMonster(ctx, { ...at(180, 1.2), hp: BIG });
  const backSide = addTestMonster(ctx, { ...at(-135, 1.6), hp: BIG });
  const far = addTestMonster(ctx, { ...at(20, R + r + 0.1), hp: BIG });
  step(ctx, { cursor: { ...target.pos }, hover: { kind: 'monster', id: target.id, src: 'pick' }, lmb: true, lmbDown: true });
  assert.equal(p.act, 'attack');
  assert.equal(p.actSkill, 'bash');
  assert.ok(Math.abs(p.facing - Math.PI / 2) < 1e-9, '대상 쪽을 본다');
  toHit(ctx, { cursor: { ...target.pos }, hover: { kind: 'monster', id: target.id, src: 'pick' }, lmb: true });
  const hit = [target.id, left.id, right.id, edge.id].sort((a, b) => a - b);
  assert.deepEqual([...p.sk.hitIds].sort((a, b) => a - b), hit, '부채꼴 안 모두');
  for (const m of [behind, backSide, far]) assert.ok(!p.sk.hitIds.includes(m.id), `밖 ${m.id}`);
  const C = CLASSES.find(c => c.id === 'warrior').rage;
  assert.equal(p.resource, C.onBasicHit + Math.min(C.extraCap, hit.length - 1) * C.perExtraTarget, '분노 = 8 + min(3, n − 1)');
  assert.ok(st.tick > 0);
});

test('피드백 1 — 가르기: 대상 고정 — 휘두르는 사이 대상이 부채꼴 밖(옆 뒤)으로 비켜도 r + reach + 관용 안이면 맞는다 · Shift 제자리는 커서 쪽 반원', () => {
  const { ctx, p } = setup({ resource: 0 });
  const o = { ...p.pos };
  const m = addTestMonster(ctx, { x: o.x + 1.4, z: o.z, hp: BIG });
  step(ctx, { cursor: { ...m.pos }, hover: { kind: 'monster', id: m.id, src: 'pick' }, lmb: true, lmbDown: true });
  assert.equal(p.act, 'attack');
  m.pos = { x: o.x - 0.6, z: o.z - 1.2 };   // 옆 뒤로(부채꼴 밖 · 사거리 안)
  toHit(ctx, {});
  assert.deepEqual(p.sk.hitIds, [m.id]);
  const s = setup({ resource: 0 });
  const q = { ...s.p.pos };
  const south = addTestMonster(s.ctx, { x: q.x, z: q.z - 1.5, hp: BIG });
  const north = addTestMonster(s.ctx, { x: q.x, z: q.z + 1.5, hp: BIG });
  step(s.ctx, { cursor: { x: q.x, z: q.z - 5 }, lmb: true, lmbDown: true, shift: true });
  toHit(s.ctx, {});
  assert.deepEqual(s.p.sk.hitIds, [south.id], '커서(−Z) 쪽 반원만');
  assert.ok(!s.p.sk.hitIds.includes(north.id));
});

test('지진: 시전 자리 원 r 6.0 · 파동 셋(판정 틱 + 0.4 · 0.9 · 1.4초) · 비적대 · 파동마다 새 actionId · 흔들림 0.35', () => {
  const { st, ctx, p } = setup({ ranks: { earthquake: 2 }, bar: ['earthquake'] });
  cast(ctx, { x: p.pos.x + 5, z: p.pos.z });
  toHit(ctx);
  const hitTick = st.tick;
  const waves = st.rift.effects.filter(e => e.kind === 'quakeWave');
  assert.equal(waves.length, 3);
  assert.deepEqual(waves.map(e => e.hitAt - hitTick), [0.4, 0.9, 1.4].map(ticks));
  for (const e of waves) {
    assert.equal(e.hostile, false);
    assert.equal(e.owner, 'player');
    assert.deepEqual({ type: e.shape.type, x: e.shape.x, z: e.shape.z, r: e.shape.r }, { type: 'circle', x: p.pos.x, z: p.pos.z, r: 6.0 });
    assert.ok(Math.abs(e.spec.coef - (0.85 + 0.095)) < 1e-9, '랭크 2 계수');   // 밸런스 게이트: 0.85 / +0.095
    assert.equal(e.spec.shake, 0.35);
  }
  assert.equal(new Set(waves.map(e => e.spec.actionId)).size, 3);
});

test('돌진: 커서(2~10m · 벽 앞) · 판정 = 시작 + 1틱 · 선 폭 1.6 · 한 몬스터에 한 번 · 옆 밀침 정의 · 도착 + 0.1초 끝', () => {
  const { st, ctx, p } = setup({ resource: 0, ranks: { charge: 1 }, bar: ['charge'] });
  const o = { ...p.pos };
  const r = 0.45;
  const onLine = addTestMonster(ctx, { x: o.x + 3, z: o.z, hp: BIG });
  const sideIn = addTestMonster(ctx, { x: o.x + 5, z: o.z + 0.8 + r - 0.05, hp: BIG });
  const sideOut = addTestMonster(ctx, { x: o.x + 6, z: o.z - (0.8 + r + 0.15), hp: BIG });
  const farOne = addTestMonster(ctx, { x: o.x + 7.5, z: o.z, hp: BIG });
  cast(ctx, { x: o.x + 30, z: o.z });
  assert.equal(p.act, 'dash');
  assert.equal(p.actHit, p.actStart + 1);
  assert.equal(p.air.kind, 'dash');
  assert.ok(Math.abs(p.actPoint.x - (o.x + 10)) < 1e-6, '10m 로 자른다');
  const arrive = p.air.end;
  assert.equal(arrive - p.actStart, Math.max(1, ticks(10 / 22)));
  assert.equal(p.actEnd, arrive + ticks(0.1));
  const seen = [];
  while (p.act === 'dash') {
    step(ctx, {});
    seen.push(...p.sk.hitIds);
  }
  assert.ok(near(p.pos, { x: o.x + 10, z: o.z }) < 1e-6, '도착점');
  const ids = p.sk.hitIds;
  assert.equal(new Set(ids).size, ids.length, '한 몬스터에 한 번');
  assert.deepEqual([...ids].sort((a, b) => a - b), [onLine.id, sideIn.id, farOne.id].sort((a, b) => a - b));
  assert.ok(!ids.includes(sideOut.id));
  assert.equal(p.sk.hits, 3);
  assert.ok(st.tick > 0 && seen.length > 0);
  // 짧은 클릭은 2m 로 늘린다
  const s2 = setup({ resource: 0, ranks: { charge: 1 }, bar: ['charge'] });
  cast(s2.ctx, { x: s2.p.pos.x + 0.5, z: s2.p.pos.z });
  assert.ok(Math.abs(near(s2.p.actPoint, s2.p.pos) - 2) < 1e-6);
});

test('돌진은 벽 앞에서 멈춘다(raycastWalk · 몸 반지름)', () => {
  const { ctx, p } = setup({ resource: 0, ranks: { charge: 1 }, bar: ['charge'], map: WALL_MAP });
  cast(ctx, { x: p.pos.x + 10, z: p.pos.z });
  assert.ok(p.actPoint.x <= 12 - p.r + 1e-6, `벽(x = 12) 앞 ${p.actPoint.x}`);
  while (p.act === 'dash') step(ctx, {});
  assert.ok(isWalkableR(ctx.map, p.pos.x, p.pos.z, p.r));
});

test('회오리: 채널 · 틱(0.30 × APS_REF/aps)마다 원 r 2.4 · 틱마다 새 actionId · 유지 비용 10/초(밸런스 게이트 12 → 10) · 커서 쪽 0.7 속도 · 몬스터 통과', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { whirlwind: 1 }, bar: ['whirlwind'] });
  const o = { ...p.pos };
  const cur = { x: o.x + 10, z: o.z };
  const ahead = addTestMonster(ctx, { x: o.x + 1.0, z: o.z, hp: BIG });
  const outside = addTestMonster(ctx, { x: o.x - 2.4 - 0.45 - 0.3, z: o.z, hp: BIG });
  step(ctx, { cursor: cur, slot: slots(0), slotDown: slots(0) });
  assert.equal(p.act, 'channel');
  assert.deepEqual(evs(ctx, EV.CHANNEL).at(-1).payload, { skillId: 'whirlwind', on: true });
  assert.equal(p.resource, 90, '시작 비용 10');
  const iv = ticks(0.30);
  assert.equal(p.channel.nextAt - st.tick, iv);
  const aheadPos = { ...ahead.pos };
  const ids = [];
  let firstHits = null;
  for (let i = 0; i < 3 * iv; i++) {
    step(ctx, { cursor: cur, slot: slots(0) });
    if (st.tick === p.actHit) { ids.push(p.actId); if (!firstHits) firstHits = [...p.sk.hitIds]; }
  }
  assert.equal(ids.length, 3, '채널 틱 셋');
  assert.equal(new Set(ids).size, 3, '틱마다 새 actionId');
  assert.ok(firstHits.includes(ahead.id) && !firstHits.includes(outside.id));
  assert.ok(Math.abs(p.resource - (90 - 10 * (3 * iv) / 30)) < 1e-6, `유지 비용(시작 틱 뒤 매 틱) ${p.resource}`);
  assert.ok(Math.abs(p.pos.x - (o.x + 6 * 0.7 * (3 * iv + 1) / 30)) < 1e-6, `0.7 속도로 커서 쪽(시작 틱부터) ${p.pos.x - o.x}`);
  if (!REAL) assert.deepEqual(ahead.pos, aheadPos, '몬스터를 밀지 않는다(통과)');
  assert.equal(countEvents(ctx.events, EV.ACTION_HIT), 3);
});

test('회오리: 분노가 모자라면 끝(CHANNEL off · 후딜 endRecover)', () => {
  const { st, ctx, p } = setup({ resource: 15, ranks: { whirlwind: 1 }, bar: ['whirlwind'] });
  step(ctx, { cursor: { x: p.pos.x + 4, z: p.pos.z }, slot: slots(0), slotDown: slots(0) });
  let endedAt = -1;
  for (let i = 0; i < 40 && endedAt < 0; i++) {
    step(ctx, { slot: slots(0) });
    if (!p.channel) endedAt = st.tick;
  }
  assert.ok(endedAt > 0);
  assert.equal(evs(ctx, EV.CHANNEL).at(-1).payload.on, false);
  assert.equal(p.act, 'channel', '후딜');
  assert.equal(p.actEnd - endedAt, Math.max(1, ticks(0.15)));
  assert.ok(p.resource >= 0 && p.resource < 12 / 30 + 1e-9);
});

test('도약: [시작, +0.10) 출발점 · [+0.10, +0.45] 보간 · 뒤 목표 · 무적 [+0.10, +0.45) — 무적이 끝나는 틱에 몸은 도착점 · 착지 원 r 3.5', () => {
  const { st, ctx, p } = setup({ resource: 0, ranks: { leap: 1 }, bar: ['leap'] });
  const o = { ...p.pos };
  const tgt = { x: o.x + 6, z: o.z };
  const nearLand = addTestMonster(ctx, { x: tgt.x + 3.5 + 0.45 - 0.05, z: tgt.z, hp: BIG });
  const farLand = addTestMonster(ctx, { x: tgt.x, z: tgt.z + 3.5 + 0.45 + 0.1, hp: BIG });
  cast(ctx, tgt);
  const S = p.actStart;
  const t0 = S + ticks(0.10), t1 = S + ticks(0.45);
  assert.equal(p.act, 'leap');
  assert.deepEqual(p.air.from, o);
  assert.ok(near(p.air.to, tgt) < 1e-6);
  assert.ok(p.actHit >= t1, '착지 판정 ≥ 도착');
  assert.equal(p.actHit, S + ticks(0.55));
  assert.equal(p.actEnd - p.actHit, ticks(0.70) - ticks(0.55), '후딜 0.15');
  while (st.tick < p.actEnd) {
    step(ctx, {});
    const t = st.tick;
    const invuln = t < p.invulnUntil;
    if (t < t0) { assert.deepEqual(p.pos, o); assert.ok(!invuln, `${t}: 출발 전 무적 아님`); }
    else if (t < t1) {
      assert.ok(invuln, `${t}: 공중 무적`);
      const k = (t - t0) / (t1 - t0);
      assert.ok(Math.abs(p.pos.x - (o.x + 6 * k)) < 1e-6, `${t}: 보간`);
    } else {
      assert.ok(!invuln, `${t}: 무적 끝`);
      assert.ok(near(p.pos, tgt) < 1e-6, `${t}: 무적이 끝나는 틱에 이미 도착점`);
    }
    if (t === p.actHit) {
      assert.ok(p.sk.hitIds.includes(nearLand.id));
      assert.ok(!p.sk.hitIds.includes(farLand.id));
      assert.equal(evs(ctx, EV.SHAKE).at(-1).payload.amp, 0.35);
    }
  }
  assert.equal(p.act, 'idle');
  assert.equal(p.air, null);
});

test('도약: 2~9m 로 자르고 벽 타일이 막으면 그 앞(걷기 가능)에 내린다 · 속박이면 이동 스킬이라 못 쓴다', () => {
  const a = setup({ resource: 0, ranks: { leap: 1 }, bar: ['leap'] });
  cast(a.ctx, { x: a.p.pos.x + 20, z: a.p.pos.z });
  assert.ok(Math.abs(near(a.p.air.to, a.p.air.from) - 9) < 1e-6);
  const b = setup({ resource: 0, ranks: { leap: 1 }, bar: ['leap'], map: WALL_MAP });
  cast(b.ctx, { x: b.p.pos.x + 8, z: b.p.pos.z });
  const to = b.p.air.to;
  assert.ok(to.x < 12, `벽 앞 ${to.x}`);
  assert.ok(isWalkableR(b.ctx.map, to.x, to.z, b.p.r));
  const c = setup({ resource: 0, ranks: { leap: 1 }, bar: ['leap'] });
  c.p.st.rootUntil = c.st.tick + 60;
  cast(c.ctx, { x: c.p.pos.x + 5, z: c.p.pos.z });
  assert.equal(evs(c.ctx, EV.SKILL_FAIL).at(-1).payload.reason, 'rooted');
});

test('순간이동: 12m 로 자르고 가장 가까운 걷기 가능 점 · 벽을 건넌다 · 판정 틱(+0.15초)에 위치 이동', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { teleport: 1 }, bar: ['teleport'], map: WALL_MAP });
  const o = { ...p.pos };
  cast(ctx, { x: 18, z: o.z });
  assert.equal(p.act, 'blink');
  assert.equal(p.actHit - p.actStart, ticks(0.25 * 0.60));
  while (st.tick < p.actHit - 1) { step(ctx, {}); assert.deepEqual(p.pos, o); }
  step(ctx, {});
  assert.ok(p.pos.x > 14, `벽 너머 ${p.pos.x}`);
  assert.ok(Math.abs(p.pos.x - 18) < 0.5);
  assert.deepEqual(p.prevPos, p.pos, '보간을 끊는다');
  assert.equal(tileAt(ctx.map, p.pos.x, p.pos.z), 1);
  const b = setup({ cls: 'mage', ranks: { teleport: 1 }, bar: ['teleport'] });
  cast(b.ctx, { x: b.p.pos.x, z: b.p.pos.z + 30 });
  assert.ok(near(b.p.actPoint, b.p.pos) <= 12 + 1e-6);
});

test('화염구: 투사체 r 0.35 · 18 m/s · 16m · 폭발 원 2.5 · 판정 틱에 커서 방향', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { fireball: 2 }, bar: ['fireball'] });
  cast(ctx, { x: p.pos.x, z: p.pos.z + 10 });
  assert.ok(Math.abs(p.facing) < 1e-9, '+Z');
  toHit(ctx);
  const pr = st.rift.projs.filter(x => x.owner === 'player');
  assert.equal(pr.length, 1);
  assert.equal(pr[0].visual, 'fireball');
  assert.equal(pr[0].r, 0.35);
  assert.ok(Math.abs(Math.hypot(pr[0].vel.x, pr[0].vel.z) - 18) < 1e-9);
  assert.equal(pr[0].until - pr[0].born, Math.max(1, ticks(16 / 18)));
  assert.equal(pr[0].explode.r, 2.5);
  assert.ok(Math.abs(pr[0].spec.coef - 1.455) < 1e-9);   // 밸런스 게이트: 1.25 / +0.15 · 피드백 2: 1.30 / +0.155(랭크 2)
  assert.equal(pr[0].pierce, 0);
  assert.equal(pr[0].spec.type, 'fire');
});

test('메테오: 커서(18m 로 자름) · 효과 하나(예고 1.2 · 원 3.5 · 불타는 바닥 3초 · 0.5초 틱 · tickSpec coef = coefPerSec × 0.5)', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { meteor: 1 }, bar: ['meteor'] });
  cast(ctx, { x: p.pos.x, z: p.pos.z + 30 });
  assert.ok(Math.abs(near(p.actPoint, p.pos) - 18) < 1e-6);
  toHit(ctx);
  const hitTick = st.tick;
  const e = st.rift.effects.filter(x => x.kind === 'meteor');
  assert.equal(e.length, 1);
  assert.equal(e[0].hitAt - hitTick, ticks(1.2));
  assert.equal(e[0].shape.r, 3.5);
  assert.equal(e[0].end - e[0].hitAt, ticks(3));
  assert.equal(e[0].tickT, ticks(0.5));
  assert.ok(Math.abs(e[0].spec.coef - 2.4) < 1e-9);   // 밸런스 게이트: 2.70 / +0.30 · 피드백 2: 2.40 / +0.27(랭크 1)
  assert.ok(Math.abs(e[0].tickSpec.coef - 0.35 * 0.5) < 1e-9);
  assert.equal(e[0].hostile, false);
  assert.ok(e[0].from && Number.isFinite(e[0].from.x));
});

test('서리 노바: 제자리 원 r 5.0 · 냉기 점수(랭크) · 비용 20', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { frostNova: 2 }, bar: ['frostNova'] });
  const inside = addTestMonster(ctx, { x: p.pos.x + 5.0 + 0.45 - 0.05, z: p.pos.z, hp: BIG });
  const outside = addTestMonster(ctx, { x: p.pos.x - 5.0 - 0.45 - 0.1, z: p.pos.z, hp: BIG });
  cast(ctx, { x: p.pos.x + 1, z: p.pos.z });
  assert.ok(Math.abs(p.resource - 80) < 1e-6);
  toHit(ctx);
  assert.ok(p.sk.hitIds.includes(inside.id) && !p.sk.hitIds.includes(outside.id));
  if (REAL) assert.ok(inside.st.chill > 0 || inside.st.freezeUntil > st.tick, '냉기(실제 combat)');
});

test('마력 보호막: player.shield = 생명 최대 × absorbPct · 다시 쓰면 갱신(합치지 않는다) · BUFF', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { energyShield: 1 }, bar: ['energyShield'] });
  cast(ctx, { x: p.pos.x + 1, z: p.pos.z });
  toHit(ctx);
  assert.ok(Math.abs(p.shield - p.lifeMax * 0.30) < 1e-9);
  assert.deepEqual(evs(ctx, EV.BUFF).at(-1).payload, { id: 'energyShield', on: true, sec: 6, value: p.lifeMax * 0.30 });
  while (st.tick < p.readyAt.energyShield) step(ctx, {});
  p.shield = p.lifeMax * 0.1;
  p.resource = 100;
  cast(ctx, { x: p.pos.x + 1, z: p.pos.z });
  toHit(ctx);
  assert.ok(Math.abs(p.shield - p.lifeMax * 0.30) < 1e-9, '갱신');
});

test('연쇄 번개: 첫 대상 = hover(15m · 시야) → 커서 4m 안 → 없으면 SKILL_FAIL noTarget(비용 없음) · 튕김 수 · ×0.9 · chainArc', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { chainLightning: 1 }, bar: ['chainLightning'] });
  const o = { ...p.pos };
  const ms = [0, 1, 2, 3, 4, 5].map(k => addTestMonster(ctx, { x: o.x + 4 + k * 3, z: o.z, hp: BIG }));
  cast(ctx, { ...ms[1].pos }, { hover: { kind: 'monster', id: ms[1].id, src: 'pick' } });
  assert.equal(p.actTargetId, ms[1].id);
  assert.ok(Math.abs(p.resource - 86) < 1e-6);
  toHit(ctx);
  assert.equal(p.sk.hitIds[0], ms[1].id);
  assert.equal(p.sk.hitIds.length, 1 + 3, '랭크 1 튕김 3');
  assert.equal(new Set(p.sk.hitIds).size, 4);
  const arc = st.rift.effects.filter(e => e.kind === 'chainArc');
  assert.equal(arc.length, 1);
  assert.equal(arc[0].shape.type, 'poly');
  assert.equal(arc[0].shape.pts.length, 5);
  assert.equal(arc[0].spec, null, '표시 전용');
  assert.equal(arc[0].end - arc[0].hitAt, ticks(0.2));
  // hover 없음 → 커서 4m 안 · 플레이어 15m 안의 가장 가까운 것
  const b = setup({ cls: 'mage', ranks: { chainLightning: 1 }, bar: ['chainLightning'] });
  const m2 = addTestMonster(b.ctx, { x: b.p.pos.x + 8, z: b.p.pos.z, hp: BIG });
  cast(b.ctx, { x: b.p.pos.x + 8 + 3.5, z: b.p.pos.z });
  assert.equal(b.p.actTargetId, m2.id);
  // 아무도 없음 → noTarget · 비용 없음
  const c = setup({ cls: 'mage', ranks: { chainLightning: 1 }, bar: ['chainLightning'] });
  cast(c.ctx, { x: c.p.pos.x + 8, z: c.p.pos.z });
  assert.deepEqual(evs(c.ctx, EV.SKILL_FAIL).at(-1).payload, { skillId: 'chainLightning', reason: 'noTarget' });
  assert.equal(c.p.resource, 100);
  assert.equal(countEvents(c.ctx.events, EV.ACTION_START), 0);
});

// ───────────────────────── 변형 6 ─────────────────────────

test('변형 6: 찍었을 때만 skillParams 에 patch 가 합쳐진다 · 기본 행 params 에는 패치 키가 없다', () => {
  const pairs = SKILL_NODES.filter(n => n.kind === 'transform');
  assert.equal(pairs.length, 6);
  for (const t of pairs) {
    const off = setup({ cls: t.cls, ranks: { [t.req]: 1 } });
    const on = setup({ cls: t.cls, ranks: { [t.req]: 1, [t.id]: 1 } });
    const a = skillParams(off.ctx, t.req), b = skillParams(on.ctx, t.req);
    for (const k of Object.keys(t.patch)) {
      assert.equal(a[k], undefined, `${t.id}: 안 찍으면 ${k} 없음`);
      assert.deepEqual(b[k], t.patch[k], `${t.id}: 찍으면 ${k}`);
    }
    const viaStats = setup({ cls: t.cls, ranks: { [t.req]: 1 }, stats: { transforms: [t.id] } });
    for (const k of Object.keys(t.patch)) assert.deepEqual(skillParams(viaStats.ctx, t.req)[k], t.patch[k], 'stats.transforms 로도');
    b[Object.keys(t.patch)[0]] = 'mutated';
    assert.deepEqual(skillParams(on.ctx, t.req)[Object.keys(t.patch)[0]], t.patch[Object.keys(t.patch)[0]], '새 객체(데이터를 고치지 않는다)');
  }
  for (const n of SKILL_NODES.filter(x => x.kind === 'active')) for (const k of PATCH_KEYS) assert.ok(!(k in n.skill.params), `${n.id}.${k}`);
});

test('변형 — 연속 회전(aftershock · 피드백 1): 0.5초 뒤 플레이어를 따라가 원 r 2.5 · 60%(spinEcho · 비적대 · 넉백 · 기절 없음) · 진동 착지: 착지 기절 1.2', () => {
  const { st, ctx, p } = setup({ ranks: { groundStomp: 1, aftershock: 1 }, bar: ['groundStomp'] });
  const gs = getNode('groundStomp').skill;
  cast(ctx, { x: p.pos.x + 3, z: p.pos.z });
  toHit(ctx);
  const e = st.rift.effects.filter(x => x.kind === gs.params.fxAftershock);
  assert.equal(gs.params.fxAftershock, 'spinEcho');
  assert.equal(e.length, 1);
  assert.equal(e[0].hitAt - st.tick, ticks(0.5));
  assert.equal(e[0].shape.type, 'circle');
  assert.equal(e[0].shape.r, gs.radius);
  assert.equal(e[0].follow, 'player');
  assert.ok(Math.abs(e[0].spec.coef - gs.coef[0] * 0.6) < 1e-9);
  assert.equal(e[0].spec.stun, undefined, '파생 적중 — 기절 없음');
  assert.equal(e[0].spec.knock, undefined, '파생 적중 — 넉백 없음');
  assert.equal(e[0].hostile, false);
  assert.deepEqual(evs(ctx, EV.ACTION_HIT).at(-1).payload.transforms, ['aftershock']);
  // 판정 전에 플레이어가 움직이면 원이 따라온다 — 판정은 그때의 자리에서
  const moved = { x: p.pos.x + 2, z: p.pos.z + 1 };
  p.pos = { ...moved };
  const near1 = addTestMonster(ctx, { x: moved.x, z: moved.z + 2.0, hp: BIG });
  while (st.tick < e[0].hitAt) { st.tick += 1; updateEffects(ctx); }
  assert.deepEqual({ x: e[0].shape.x, z: e[0].shape.z }, moved);
  assert.equal(e[0].resolved, true);
  if (REAL) assert.ok(near1.hp < BIG, '따라온 원 안의 몬스터가 맞았다');
  const q = setup({ resource: 0, ranks: { leap: 1, quakeLanding: 1 }, bar: ['leap'] });
  const m = addTestMonster(q.ctx, { x: q.p.pos.x + 6.5, z: q.p.pos.z, hp: BIG });
  cast(q.ctx, { x: q.p.pos.x + 6, z: q.p.pos.z });
  assert.equal(skillParams(q.ctx, 'leap').landStun, 1.2);
  toHit(q.ctx);
  assert.ok(q.p.sk.hitIds.includes(m.id));
  if (REAL) assert.ok(m.st.stunUntil > q.st.tick, '착지 기절(실제 combat)');
});

test('변형 — 피의 회오리 · 분열 화염구(±15° 셋 · 70%) · 얼음 파편(8발 관통 · 냉기 20) · 번개 잔상(출발 · 도착 폭발 r 3.0)', () => {
  const w = setup({ ranks: { whirlwind: 1, bloodWhirl: 1 } });
  const wp = skillParams(w.ctx, 'whirlwind');
  assert.equal(wp.healPerTarget, 0.006);
  assert.equal(wp.healTargetsCap, 3);
  const f = setup({ cls: 'mage', ranks: { fireball: 1, splitFireball: 1 }, bar: ['fireball'] });
  cast(f.ctx, { x: f.p.pos.x, z: f.p.pos.z + 8 });
  toHit(f.ctx);
  const pr = f.st.rift.projs.filter(x => x.owner === 'player');
  assert.equal(pr.length, 3);
  const ang = pr.map(x => Math.atan2(x.vel.x, x.vel.z)).sort((a, b) => a - b);
  assert.ok(Math.abs(ang[0] + deg2rad(15)) < 1e-9 && Math.abs(ang[1]) < 1e-9 && Math.abs(ang[2] - deg2rad(15)) < 1e-9);
  for (const x of pr) { assert.equal(x.visual, 'fireballSplit'); assert.ok(Math.abs(x.spec.coef - 1.3 * 0.7) < 1e-9); }   // 밸런스 게이트: 화염구 1.25 · 피드백 2: 1.30(랭크 1)
  const n = setup({ cls: 'mage', ranks: { frostNova: 1, iceShards: 1 }, bar: ['frostNova'] });
  cast(n.ctx, { x: n.p.pos.x + 1, z: n.p.pos.z });
  toHit(n.ctx);
  const sh = n.st.rift.projs.filter(x => x.owner === 'player');
  assert.equal(sh.length, 8);
  for (const x of sh) {
    assert.equal(x.visual, 'iceShard');
    assert.ok(x.pierce > 0, '관통');
    assert.equal(x.spec.chill, 20);
    assert.ok(Math.abs(x.spec.coef - 1.0 * 0.45) < 1e-9);
    assert.equal(x.r, 0.25);
    assert.ok(Math.abs(Math.hypot(x.vel.x, x.vel.z) - 16) < 1e-9);
  }
  const t = setup({ cls: 'mage', ranks: { teleport: 2, lightningAfterimage: 1 }, bar: ['teleport'] });
  const from = { ...t.p.pos };
  cast(t.ctx, { x: from.x + 8, z: from.z });
  toHit(t.ctx);
  const bl = t.st.rift.effects.filter(x => x.kind === 'afterimageBlast');
  assert.equal(bl.length, 2);
  assert.ok(near(bl[0].shape, from) < 1e-9, '출발');
  assert.ok(near(bl[1].shape, t.p.pos) < 1e-9, '도착');
  for (const e of bl) {
    assert.equal(e.shape.r, 3.0);
    assert.equal(e.spec.coef, 1.5, '랭크 2');
    assert.equal(e.spec.type, 'lightning');
    assert.equal(e.spec.shockChance, 0.5);
  }
});

// ───────────────────────── 조회 ─────────────────────────

test('describeSkill: 계수 · 피해(무기 × coef × (1 + 주/100) × (1 + 보너스)) · 비용 · 쿨 · 사거리 · 반지름 · extra · 기본 공격 ID', () => {
  const s = makeTestStats();
  const b = describeSkill(s, 'bash', 1);
  const bc = BASIC_SKILLS.bash.coef[0];   // 피드백 1: 가르기 — 닿는 적마다
  assert.ok(Math.abs(b.coefPct - bc * 100) < 1e-9);
  assert.ok(Math.abs(b.dmgMin - 3 * bc * 1.1) < 1e-9 && Math.abs(b.dmgMax - 7 * bc * 1.1) < 1e-9);
  assert.equal(b.range, BASIC_SKILLS.bash.reach);
  assert.equal(b.cost, 0);
  const g = describeSkill({ ...s, costReduce: 0.2, aoePct: 0.1 }, 'groundStomp', 3);
  const gc = getNode('groundStomp').skill.coef[2];   // 피드백 1: 회전 베기 랭크 3
  assert.ok(Math.abs(g.coefPct - gc * 100) < 1e-9);
  assert.ok(Math.abs(g.dmgMin - 3 * gc * 1.1 * 1.1) < 1e-9);
  assert.ok(Math.abs(g.cost - 14 * 0.8) < 1e-9);   // 회전 베기 비용 14(W1 수정 · NOTES-W1FIX — 계약 §7.2) × (1 − 0.2)
  assert.equal(g.radius, 2.5);
  assert.equal(g.extra.knock, 0.8, '넉백(피드백 1 — 옛 기절)');
  assert.equal(g.extra.stun, undefined);
  const t = describeSkill({ ...makeTestStats({ cls: 'mage' }), cdr: 0.1 }, 'teleport', 3);
  assert.ok(Math.abs(t.cd - 2.6 * 0.9) < 1e-9);
  assert.equal(t.range, 12);
  assert.equal(t.dmgMax, 0, '피해 없는 스킬');
  const a = describeSkill({ ...s, transforms: ['aftershock'] }, 'groundStomp', 1);
  assert.deepEqual(a.extra.aftershock, { delay: 0.5, mul: 0.6 });
  const e = describeSkill(makeTestStats({ cls: 'mage' }), 'energyShield', 2);
  assert.ok(Math.abs(e.extra.absorb - 100 * 0.34) < 1e-9);   // 밸런스 게이트: 마법사 생명 90 → 100
  assert.equal(e.extra.absorbPct, 0.34);
  const m = describeSkill(makeTestStats({ cls: 'mage' }), 'meteor', 2);
  assert.ok(Math.abs(m.extra.burn.coefPerSec - 0.39) < 1e-9);
  assert.deepEqual(describeSkill(s, 'nope', 1), { coefPct: 0, dmgMin: 0, dmgMax: 0, cost: 0, cd: 0, range: 0, radius: 0, extra: {} });
  for (const n of SKILL_NODES.filter(x => x.kind === 'active')) {
    for (let r = 1; r <= n.maxRank; r++) {
      const d = describeSkill(s, n.id, r);
      for (const k of ['coefPct', 'dmgMin', 'dmgMax', 'cost', 'cd', 'range', 'radius']) assert.ok(Number.isFinite(d[k]), `${n.id} r${r} ${k}`);
    }
  }
});

test('skillReady: cooldownLeft · cooldownTotal(초) · canAfford · ready · 기본 공격 ID · 모르는 ID', () => {
  const { st, ctx, p } = setup({ resource: 100, ranks: { earthquake: 1 }, bar: ['earthquake'] });
  let r = skillReady(st, ctx.stats, 'earthquake');
  assert.deepEqual(r, { canAfford: true, cooldownLeft: 0, cooldownTotal: 8, ready: true });
  cast(ctx, { x: p.pos.x + 1, z: p.pos.z });
  for (let i = 0; i < 30; i++) step(ctx, {});
  r = skillReady(st, ctx.stats, 'earthquake');
  assert.ok(Math.abs(r.cooldownLeft - 7) < 1e-9);
  assert.equal(r.cooldownTotal, 8);
  assert.equal(r.ready, false);
  p.resource = 10;
  assert.equal(skillReady(st, ctx.stats, 'earthquake').canAfford, false);
  assert.deepEqual(skillReady(st, ctx.stats, 'bash'), { canAfford: true, cooldownLeft: 0, cooldownTotal: 0, ready: true });
  assert.equal(skillReady(st, ctx.stats, 'nope').ready, false);
});

// ───────────────────────── 규칙 ─────────────────────────

test('동작 14가 표에 있고 모든 액티브 · 기본 공격의 behavior 가 그중 하나 · act 는 PlayerAct', () => {
  const keys = ['cleave', 'boltBasic', 'spinSlash', 'quake', 'dash', 'spin', 'buff', 'leap', 'fireball', 'meteor', 'nova', 'shield', 'chain', 'blink'];   // 피드백 1: meleeBasic → cleave · cone → spinSlash
  assert.deepEqual(Object.keys(SKILL_BEHAVIORS).sort(), [...keys].sort());
  for (const k of keys) {
    const b = SKILL_BEHAVIORS[k];
    assert.equal(typeof b.start, 'function');
    assert.equal(typeof b.hit, 'function');
    assert.ok(PLAYER_ACTS.includes(b.act), `${k}.act`);
  }
  for (const n of SKILL_NODES.filter(x => x.kind === 'active')) assert.ok(keys.includes(n.skill.behavior));
  for (const d of Object.values(BASIC_SKILLS)) assert.ok(keys.includes(d.behavior));
});

test('실행부(controller · actions · 동작 skills.js)의 문자열 리터럴에 노드 · 전설 · 몬스터 ID 가 없다(구조 어휘 제외)', () => {
  const reserved = new Set([...PLAYER_ACTS, ...Object.keys(SKILL_BEHAVIORS)]);
  const ids = new Set([...SKILL_NODES.map(n => n.id), ...LEGENDARIES.map(l => l.id), ...LEGENDARIES.map(l => l.hook), ...MONSTERS.map(m => m.id)].filter(x => !reserved.has(x)));
  for (const f of ['src/sim/player/controller.js', 'src/sim/player/actions.js', 'src/sim/player/skills.js']) {
    const code = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const lits = [...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);
    const bad = lits.filter(s => ids.has(s.trim()));
    assert.deepEqual(bad, [], `${f}: ${bad.join(', ')}`);
  }
});

test('결정성: 같은 입력 열이면 같은 플레이어 상태', () => {
  const run = () => {
    const { st, ctx, p } = setup({ resource: 60, ranks: { charge: 1, groundStomp: 2, whirlwind: 1 }, bar: ['groundStomp', 'charge', 'whirlwind'] });
    for (let k = 0; k < 6; k++) addTestMonster(ctx, { x: p.pos.x + 2 + k, z: p.pos.z + (k % 2 ? 1 : -1), hp: BIG });
    for (let i = 0; i < 240; i++) {
      const c = { x: p.pos.x + Math.sin(i / 9) * 6, z: p.pos.z + Math.cos(i / 7) * 6 };
      step(ctx, { cursor: c, lmb: i % 40 < 20, lmbDown: i % 40 === 0, slot: slots(Math.floor(i / 60) % 3), slotDown: i % 30 === 0 ? slots(Math.floor(i / 60) % 3) : undefined });
    }
    return JSON.stringify({ player: st.player, rift: st.rift, nextId: st.nextId, rng: st.rng });
  };
  assert.equal(run(), run());
  assert.ok(wrapAngle(0) === 0 && PLAYER.turnRate > 0);
});
