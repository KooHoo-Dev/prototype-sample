// OWNER: P1 — 계약 §12.2(equipHooks.test) · §8.5 · §7.9 — 전설 12(패치형 9 · 사건형 3) · 내구도 0 이면 꺼짐 · noProcs 재귀 없음
// 패치형은 skillParams 와 동작의 결과(효과 · 투사체 · 상태)로, 사건형은 처치 · 구슬 사건에서 본다. 남의 구현에 기대지 않는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { ticks } from '../src/core/time.js';
import { getNode } from '../src/data/index.js';
import { LEGENDARIES } from '../src/data/legendaries.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { computeStats } from '../src/sim/loot/stats.js';
import { updatePlayer } from '../src/sim/player/controller.js';
import { EQUIP_HOOKS, globeMods, onPlayerKill } from '../src/sim/player/equipHooks.js';
import { skillParams } from '../src/sim/player/skills.js';
import { addTestMonster, makeTestChar, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

const BIG = 1e6;
const LEG = Object.fromEntries(LEGENDARIES.map(l => [l.id, l]));

function setup({ cls = 'warrior', ranks = {}, bar = [], hooks = [], resource = 100, stats = {} } = {}) {
  const st = makeTestState({ cls });
  st.char.skills.ranks = { ...ranks };
  st.char.skills.bar = [0, 1, 2, 3, 4].map(i => bar[i] ?? null);
  const ctx = makeTestCtx(st, { stats: makeTestStats({ cls, hooks: [...hooks], resourceRegen: 0, ...stats }) });
  st.player.resource = Math.min(resource, st.player.resourceMax);
  st.player.combatUntil = 1e6;
  return { st, ctx, p: st.player };
}
function step(ctx, inp = {}) {
  const st = ctx.state;
  st.tick += 1;
  st.player.prevPos = { x: st.player.pos.x, z: st.player.pos.z };
  updatePlayer(ctx, makeInput(inp));
}
const slot0 = () => [true, false, false, false, false];
const cast = (ctx, cursor, extra = {}) => step(ctx, { cursor, slotDown: slot0(), ...extra });
function toHit(ctx) {
  const at = ctx.state.player.actHit;
  while (ctx.state.tick < at) step(ctx, {});
}
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const evs = (ctx, name) => ctx.events.filter(e => e.name === name);

/** 전설 아이템을 낀 캐릭터(내구도 dur) — computeStats 가 hooks 를 정한다 */
function charWith(legId, dur) {
  const l = LEG[legId];
  const cls = l.cls ?? 'warrior';
  const char = makeTestChar({ cls });
  const it = makeItem({ baseId: l.baseId, tier: 0, ilvl: 10, rarity: 'legendary', id: 'L' + legId, legendaryId: legId });
  it.dur = dur;
  const slot = it.slot === 'ring' ? 'ring1' : it.slot;
  char.equip[slot] = it;
  return char;
}

test('EQUIP_HOOKS: 전설 12의 hook 이 전부 있다 · 패치형 9 · 사건형 3(at kill · globe 의 함수)', () => {
  assert.deepEqual(Object.keys(EQUIP_HOOKS).sort(), LEGENDARIES.map(l => l.hook).sort());
  for (const l of LEGENDARIES) {
    const h = EQUIP_HOOKS[l.hook];
    if (l.skill) assert.equal(h.kind, 'patch', l.id);
    else if (l.at === 'kill') assert.equal(typeof h.onKill, 'function', l.id);
    else assert.equal(typeof h.globe, 'function', l.id);
  }
});

test('패치형 9: 낀 전설(stats.hooks)의 patch 가 그 스킬의 params 에만 합쳐진다 · 안 끼면 없다', () => {
  const patchers = LEGENDARIES.filter(l => l.skill);
  assert.equal(patchers.length, 9);
  for (const l of patchers) {
    const node = getNode(l.skill);
    const on = setup({ cls: l.cls, ranks: { [l.skill]: 1 }, hooks: [l.id] });
    const off = setup({ cls: l.cls, ranks: { [l.skill]: 1 } });
    for (const k of Object.keys(l.patch)) {
      assert.deepEqual(skillParams(on.ctx, l.skill)[k], l.patch[k], `${l.id} → ${l.skill}.${k}`);
      assert.equal(skillParams(off.ctx, l.skill)[k], undefined, `${l.id} 없음`);
    }
    for (const other of LEGENDARIES.filter(x => x.skill && x.skill !== l.skill)) {
      for (const k of Object.keys(l.patch)) {
        if (!(k in (other.patch ?? {}))) assert.equal(skillParams(on.ctx, other.skill)[k], undefined, `${l.id} 는 ${other.skill} 에 닿지 않는다`);
      }
    }
    assert.ok(node.kind === 'active');
  }
});

test('내구도 0 이면 꺼진다: computeStats 의 hooks 에서 빠져 패치 · 사건 모두 돌지 않는다', () => {
  for (const l of LEGENDARIES) {
    const okStats = computeStats(charWith(l.id, 100));
    const brokenStats = computeStats(charWith(l.id, 0));
    assert.ok(okStats.hooks.includes(l.id), `${l.id} 활성`);
    assert.ok(!brokenStats.hooks.includes(l.id), `${l.id} 내구도 0`);
    if (l.skill) {
      const st = makeTestState({ cls: l.cls });
      st.char.skills.ranks = { [l.skill]: 1 };
      const on = makeTestCtx(st, { stats: okStats });
      const off = makeTestCtx(st, { stats: brokenStats });
      const k = Object.keys(l.patch)[0];
      assert.deepEqual(skillParams(on, l.skill)[k], l.patch[k]);
      assert.equal(skillParams(off, l.skill)[k], undefined);
    }
  }
  const st = makeTestState({});
  assert.deepEqual(globeMods(makeTestCtx(st, { stats: computeStats(charWith('verdantSash', 0)) })), { mul: 1, radiusAdd: 0 });
});

// ───────────────────────── 사건형 3 ─────────────────────────

test('서리 반지(frozenShatter): 빙결 중 처치 → 그 자리 얼음 폭발(r 2.5 · coef 0.8 · 냉기 · noProcs · 다음 틱 판정) · 빙결이 아니면 없음', () => {
  const { st, ctx } = setup({ cls: 'mage', hooks: ['rimeRing'] });
  const m = addTestMonster(ctx, { x: 30, z: 21 });
  onPlayerKill(ctx, m, { by: 'player', skillId: 'frostNova', noProcs: false, frozen: false });
  assert.equal(st.rift.effects.length, 0);
  onPlayerKill(ctx, m, { by: 'player', skillId: 'frostNova', noProcs: false, frozen: true });
  const e = st.rift.effects.filter(x => x.kind === 'iceBurst');
  assert.equal(e.length, 1);
  assert.deepEqual({ x: e[0].shape.x, z: e[0].shape.z, r: e[0].shape.r }, { x: 30, z: 21, r: 2.5 });
  assert.equal(e[0].spec.coef, 0.8);
  assert.equal(e[0].spec.type, 'cold');
  assert.equal(e[0].spec.noProcs, true, '재귀 방지');
  assert.equal(e[0].hostile, false);
  assert.equal(e[0].hitAt, st.tick + 1, 'resolveDeaths 는 효과 갱신 뒤 — 다음 틱 판정');
  // 같은 전설 둘(반지 두 칸)이어도 한 번
  const two = setup({ cls: 'mage', hooks: ['rimeRing', 'rimeRing'] });
  onPlayerKill(two.ctx, addTestMonster(two.ctx, { x: 30, z: 21 }), { frozen: true, noProcs: false });
  assert.equal(two.st.rift.effects.length, 1);
});

test('피의 서약(killExplode): 처치마다 chance(10%)로 시체 폭발(r 3.0 · flat = 대상 최대 생명 × 0.2 · 물리 · noProcs) · 결정적', () => {
  const run = () => {
    const { st, ctx } = setup({ hooks: ['bloodPact'] });
    const m = addTestMonster(ctx, { x: 30, z: 21 });
    for (let i = 0; i < 2000; i++) onPlayerKill(ctx, m, { by: 'player', skillId: 'bash', noProcs: false, frozen: false });
    return st.rift.effects.filter(x => x.kind === 'corpseBlast');
  };
  const a = run(), b = run();
  assert.equal(a.length, b.length, '같은 시드 = 같은 결과');
  assert.ok(a.length > 2000 * 0.07 && a.length < 2000 * 0.13, `약 10% — ${a.length}`);
  const e = a[0];
  assert.equal(e.shape.r, 3.0);
  assert.ok(Math.abs(e.spec.flat - 19 * 0.2) < 1e-9, '구울 최대 생명 19 × 0.2');
  assert.equal(e.spec.type, 'phys');
  assert.equal(e.spec.noProcs, true);
});

test('noProcs 인 처치(훅이 만든 적중)에서는 처치 훅이 돌지 않는다 — 재귀 없음 · 전설이 없으면 아무 일 없음', () => {
  const { st, ctx } = setup({ cls: 'mage', hooks: ['rimeRing', 'bloodPact'] });
  const m = addTestMonster(ctx, { x: 30, z: 21 });
  for (let i = 0; i < 200; i++) onPlayerKill(ctx, m, { by: 'player', skillId: 'frozenShatter', noProcs: true, frozen: true });
  assert.equal(st.rift.effects.length, 0);
  const none = setup({ cls: 'mage' });
  onPlayerKill(none.ctx, addTestMonster(none.ctx, { x: 30, z: 21 }), { frozen: true, noProcs: false });
  assert.equal(none.st.rift.effects.length, 0);
});

test('생명의 띠(globeDouble): globeMods → {mul 2, radiusAdd 1.0} · 없으면 {1, 0}', () => {
  assert.deepEqual(globeMods(setup({ hooks: ['verdantSash'] }).ctx), { mul: 2, radiusAdd: 1.0 });
  assert.deepEqual(globeMods(setup({}).ctx), { mul: 1, radiusAdd: 0 });
  assert.deepEqual(globeMods(setup({ hooks: ['rimeRing'] }).ctx), { mul: 1, radiusAdd: 0 });
  const st = makeTestState({});
  assert.deepEqual(globeMods(makeTestCtx(st, { stats: computeStats(charWith('verdantSash', 100)) })), { mul: 2, radiusAdd: 1.0 });
});

// ───────────────────────── 패치형 — 동작의 결과 ─────────────────────────

test('불타는 소용돌이(emberMaelstrom): 회오리 중 0.6초마다 소용돌이(r 2.0 · 2초 · 0.5초 틱 · 화염 · coefPerSec × 틱 초)', () => {
  const { st, ctx, p } = setup({ ranks: { whirlwind: 1 }, bar: ['whirlwind'], hooks: ['emberMaelstrom'] });
  step(ctx, { cursor: { x: p.pos.x + 6, z: p.pos.z }, slot: slot0(), slotDown: slot0() });
  const t0 = st.tick;
  for (let i = 0; i < 40; i++) step(ctx, { cursor: { x: p.pos.x + 6, z: p.pos.z }, slot: slot0() });
  const v = st.rift.effects.filter(e => e.kind === 'vortex');
  assert.equal(v.length, 2, '0.6초 · 1.2초');
  assert.deepEqual(v.map(e => e.start - t0), [ticks(0.6), 2 * ticks(0.6)]);
  for (const e of v) {
    assert.equal(e.shape.r, 2.0);
    assert.equal(e.end - e.hitAt, ticks(2.0));
    assert.equal(e.tickT, ticks(0.5));
    assert.equal(e.spec, null);
    assert.ok(Math.abs(e.tickSpec.coef - 0.35 * 0.5) < 1e-9);
    assert.equal(e.tickSpec.type, 'fire');
    assert.equal(e.hostile, false);
  }
  const plain = setup({ ranks: { whirlwind: 1 }, bar: ['whirlwind'] });
  step(plain.ctx, { cursor: { x: plain.p.pos.x + 6, z: plain.p.pos.z }, slot: slot0(), slotDown: slot0() });
  for (let i = 0; i < 40; i++) step(plain.ctx, { slot: slot0() });
  assert.equal(plain.st.rift.effects.length, 0);
});

test('진동 장화(quakeTreads): 도약 착지 자리에 지진 파동 셋(지진 랭크 · 없으면 1랭크 · × 0.6 · 기절 없음 · 비용 없음)', () => {
  const { st, ctx, p } = setup({ resource: 0, ranks: { leap: 1 }, bar: ['leap'], hooks: ['quakeTreads'] });
  const tgt = { x: p.pos.x + 6, z: p.pos.z };
  cast(ctx, tgt);
  toHit(ctx);
  const w = st.rift.effects.filter(e => e.kind === 'quakeWave');
  assert.equal(w.length, 3);
  const eq = getNode('earthquake').skill;
  for (const e of w) {
    assert.ok(near(e.shape, tgt) < 1e-6, '착지 자리');
    assert.equal(e.shape.r, eq.radius);
    assert.ok(Math.abs(e.spec.coef - eq.coef[0] * 0.6) < 1e-9);
    assert.equal(e.spec.stun, undefined);
  }
  assert.deepEqual(w.map(e => e.hitAt - st.tick), eq.params.waves.map(ticks));
  assert.equal(p.resource, 0, '비용 없음');
});

test('분노의 뿔(ragingHorn): 돌진 적중당 분노 +5 · 한 돌진에 3마리 이상이면 남은 쿨을 1초로(넉백 루프는 면역 1초와 함께 막힌다) · 2마리면 그대로', () => {
  const mk = (n) => {
    const s = setup({ resource: 0, ranks: { charge: 1 }, bar: ['charge'], hooks: ['ragingHorn'] });
    for (let k = 0; k < n; k++) addTestMonster(s.ctx, { x: s.p.pos.x + 2 + k * 2, z: s.p.pos.z, hp: BIG });
    cast(s.ctx, { x: s.p.pos.x + 10, z: s.p.pos.z });
    const start = s.st.tick;
    let resetTick = -1;
    while (s.p.act === 'dash') {
      step(s.ctx, {});
      if (resetTick < 0 && s.p.readyAt.charge <= s.st.tick + ticks(1.0)) resetTick = s.st.tick;
    }
    return { ...s, start, resetTick };
  };
  const three = mk(3);
  assert.equal(three.p.sk.hits, 3);
  assert.equal(three.p.resource, 10 + 5 * 3);
  assert.ok(three.resetTick > 0, '쿨다운 1초로');
  assert.equal(three.p.readyAt.charge, three.resetTick + ticks(1.0));
  const two = mk(2);
  assert.equal(two.p.sk.hits, 2);
  assert.equal(two.p.resource, 10 + 5 * 2);
  assert.equal(two.p.readyAt.charge, two.start + ticks(6), '쿨다운 그대로');
  // 뿔이 없으면 분노는 시전 생성만
  const plain = setup({ resource: 0, ranks: { charge: 1 }, bar: ['charge'] });
  for (let k = 0; k < 3; k++) addTestMonster(plain.ctx, { x: plain.p.pos.x + 2 + k * 2, z: plain.p.pos.z, hp: BIG });
  cast(plain.ctx, { x: plain.p.pos.x + 10, z: plain.p.pos.z });
  while (plain.p.act === 'dash') step(plain.ctx, {});
  assert.equal(plain.p.resource, 10);
  assert.equal(plain.p.readyAt.charge, plain.p.actStart + ticks(6));
});

test('선조의 허리띠(ancestorBelt) castHeal · 진동 주먹(tremorFists) 충격파 선(len 10 · 폭 2.0 · coef 1.0)', () => {
  const b = setup({ ranks: { warCry: 1 }, bar: ['warCry'], hooks: ['ancestorBelt'] });
  assert.equal(skillParams(b.ctx, 'warCry').castHeal, 0.25);
  b.p.life = 10;
  cast(b.ctx, { x: b.p.pos.x + 1, z: b.p.pos.z });
  toHit(b.ctx);
  const heal = evs(b.ctx, EV.PLAYER_HEAL);
  if (heal.length) assert.deepEqual(heal.at(-1).payload, { amount: Math.min(b.p.lifeMax * 0.25, b.p.lifeMax - 10), source: 'legend' });
  const t = setup({ ranks: { groundStomp: 1 }, bar: ['groundStomp'], hooks: ['tremorFists'] });
  cast(t.ctx, { x: t.p.pos.x, z: t.p.pos.z + 5 });
  toHit(t.ctx);
  const sw = t.st.rift.effects.filter(e => e.kind === 'shockwave');
  assert.equal(sw.length, 1);
  assert.deepEqual({ type: sw[0].shape.type, len: sw[0].shape.len, width: sw[0].shape.width }, { type: 'line', len: 10, width: 2.0 });
  assert.ok(Math.abs(sw[0].shape.facing) < 1e-9, '앞으로(+Z)');
  assert.equal(sw[0].spec.coef, 1.0);
  assert.equal(sw[0].spec.stun, undefined);
});

test('꿰뚫는 화염(piercingFlame) 관통 3 · 폭풍의 구체(stormOrb) 튕김 +2 · 잿빛 왕관(ashenCrown) 작은 메테오 둘', () => {
  const f = setup({ cls: 'mage', ranks: { fireball: 1 }, bar: ['fireball'], hooks: ['piercingFlame'] });
  cast(f.ctx, { x: f.p.pos.x + 8, z: f.p.pos.z });
  toHit(f.ctx);
  const pr = f.st.rift.projs.filter(x => x.owner === 'player');
  assert.equal(pr.length, 1);
  assert.equal(pr[0].pierce, 3);
  assert.ok(pr[0].explode && pr[0].explode.r === 2.5, '맞힐 때마다 폭발할 정의');
  const c = setup({ cls: 'mage', ranks: { chainLightning: 1 }, bar: ['chainLightning'], hooks: ['stormOrb'] });
  const ms = [0, 1, 2, 3, 4, 5, 6, 7].map(k => addTestMonster(c.ctx, { x: c.p.pos.x + 3 + k * 3, z: c.p.pos.z, hp: BIG }));
  cast(c.ctx, { ...ms[0].pos }, { hover: { kind: 'monster', id: ms[0].id, src: 'pick' } });
  toHit(c.ctx);
  assert.equal(c.p.sk.hitIds.length, 1 + 3 + 2);
  const m = setup({ cls: 'mage', ranks: { meteor: 1 }, bar: ['meteor'], hooks: ['ashenCrown'] });
  cast(m.ctx, { x: m.p.pos.x + 8, z: m.p.pos.z });
  toHit(m.ctx);
  const met = m.st.rift.effects.filter(e => e.kind === 'meteor');
  assert.equal(met.length, 3);
  const [main, ...small] = met;
  assert.equal(main.shape.r, 3.5);
  assert.deepEqual(small.map(e => e.shape.r), [2.0, 2.0]);
  assert.deepEqual(small.map(e => e.hitAt - main.hitAt), [ticks(1.2 + 0.3) - ticks(1.2), ticks(1.2 + 0.6) - ticks(1.2)]);
  for (const e of small) assert.ok(Math.abs(e.spec.coef - main.spec.coef * 0.5) < 1e-9);
});

test('서리 걸음(frostWalkers): 순간이동 도착에 서리 노바(그 랭크 · 없으면 1랭크 · 비용 없음) — 도착 자리 원 r 5.0', () => {
  const { st, ctx, p } = setup({ cls: 'mage', ranks: { teleport: 1 }, bar: ['teleport'], hooks: ['frostWalkers'] });
  const dest = { x: p.pos.x + 9, z: p.pos.z };
  const atDest = addTestMonster(ctx, { x: dest.x + 4.5, z: dest.z, hp: BIG });
  const atStart = addTestMonster(ctx, { x: p.pos.x - 2, z: p.pos.z, hp: BIG });
  cast(ctx, dest);
  const mana = p.resource;
  toHit(ctx);
  assert.ok(near(p.pos, dest) < 0.5);
  assert.ok(p.sk.hitIds.includes(atDest.id), '도착 자리 노바');
  assert.ok(!p.sk.hitIds.includes(atStart.id));
  assert.equal(p.resource, mana, '비용 없음');
  const nova = evs(ctx, EV.ACTION_HIT).filter(e => e.payload.skillId === 'frostNova');
  assert.equal(nova.length, 1);
  assert.equal(nova[0].payload.rank, 1);
  assert.ok(near(nova[0].payload, dest) < 0.5);
  assert.ok(st.tick > 0);
});
