// OWNER: P2 — 계약 §12.2 · §7.6 · §5.13-5 · §5.16-7
// 흩뿌림(걷기 가능 · 간격) · 자동 줍기 반경 · 포션 상한 · 구슬(onGlobe) · 가방 가득 → 드랍 남음 + PICKUP_FAIL · 먼저 주운 것만 ·
// 업그레이드 집계 · 골드 음수 없음 · 줍기는 표시만(cleanup 이 뺀다).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BAG_SIZE } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { GLOBE, PICKUP } from '../src/data/combat.js';
import { ECON } from '../src/data/economy.js';
import { pickupDrop, spawnDrops, updatePickups } from '../src/sim/drops.js';
import { removeMarked } from '../src/sim/entities.js';
import { isUpgrade } from '../src/sim/loot/compare.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { assertFiniteDeep, countEvents, makeTestCtx, makeTestState, makeTestStats } from './helpers.js';

let seq = 1;
const newItem = (o = {}) => makeItem({ baseId: 'helm', tier: 0, ilvl: 1, rarity: 'magic', id: 'd' + seq++, ...o });

function setup({ hooks = {}, stats = {} } = {}) {
  const state = makeTestState();
  state.tick = 50;
  const ctx = makeTestCtx(state, { stats: makeTestStats(stats), hooks });
  return { state, ctx, p: state.player, ch: state.char };
}

/** 플레이어에서 (dx, dz)에 드랍 하나를 놓는다(흩뿌림 없이) */
function place(ctx, kind, dx, dz, extra = {}) {
  const p = ctx.state.player.pos;
  const d = { id: ctx.nextId(), kind, pos: { x: p.x + dx, z: p.z + dz }, from: { x: p.x, z: p.z }, born: ctx.state.tick, item: null, amount: 1, mat: null, rarity: null, gone: false, ...extra };
  ctx.state.rift.drops.push(d);
  return d;
}

test('흩뿌림: 걷기 가능 · 서로 scatterSep 넘게 · 떨어진 자리에서 scatterMin..scatterMax · DROP_SPAWN · 같은 시드면 같은 자리', () => {
  const run = () => {
    const { state, ctx } = setup();
    const rolls = Array.from({ length: 8 }, (_, i) => (i % 2 ? { kind: 'gold', item: null, amount: 5 + i, mat: null } : { kind: 'item', item: newItem(), amount: 1, mat: null }));
    const drops = spawnDrops(ctx, rolls, 20, 20);
    return { state, ctx, drops };
  };
  const { ctx, drops } = run();
  assert.equal(drops.length, 8);
  for (const d of drops) {
    assert.ok(isWalkable(ctx.map, d.pos.x, d.pos.z));
    const r = Math.hypot(d.pos.x - 20, d.pos.z - 20);
    assert.ok(r >= PICKUP.scatterMin - 1e-9 && r <= PICKUP.scatterMax + 1e-9, String(r));
    assert.deepEqual(d.from, { x: 20, z: 20 });
  }
  for (let i = 0; i < drops.length; i++) for (let j = i + 1; j < drops.length; j++) {
    assert.ok(Math.hypot(drops[i].pos.x - drops[j].pos.x, drops[i].pos.z - drops[j].pos.z) > PICKUP.scatterSep, `${i}-${j}`);
  }
  assert.equal(countEvents(ctx.events, EV.DROP_SPAWN), 8);
  const again = run();
  assert.deepEqual(again.drops.map(d => d.pos), drops.map(d => d.pos), '결정적');
  // 벽 구석에서도 바닥 위
  const { ctx: c2 } = setup();
  const corner = spawnDrops(c2, Array.from({ length: 12 }, () => ({ kind: 'gold', item: null, amount: 1, mat: null })), 2.2, 2.2);
  for (const d of corner) assert.ok(isWalkable(c2.map, d.pos.x, d.pos.z));
  // 양이 0 이하 · 아이템 없는 item 행은 버린다
  assert.equal(spawnDrops(c2, [{ kind: 'gold', item: null, amount: -5, mat: null }, { kind: 'item', item: null, amount: 1, mat: null }], 20, 20).length, 0);
});

test('장비 드랍 집계: rift.stats.drops[rarity] · 업그레이드 = isUpgrade(P5) 가 참인 것의 수 · 첫 장비면 HINT labels(한 번)', () => {
  const { state, ctx, ch } = setup();
  const items = [newItem({ rarity: 'rare' }), newItem({ rarity: 'magic', baseId: 'boots' }), newItem({ rarity: 'normal', baseId: 'sword' })];
  const want = items.filter(it => isUpgrade(ctx.stats, ch, it)).length;
  spawnDrops(ctx, items.map(item => ({ kind: 'item', item, amount: 1, mat: null })), 20, 20);
  assert.equal(state.rift.stats.drops.rare, 1);
  assert.equal(state.rift.stats.drops.magic, 1);
  assert.equal(state.rift.stats.drops.normal, 1);
  assert.equal(state.rift.stats.upgrades, want);
  assert.equal(ctx.events.filter(e => e.name === EV.HINT && e.payload.id === 'labels').length, 1);
});

test('자동 줍기: 골드 goldR · 재료 matR · 포션 potionR(상한 아래만) · 장비는 클릭으로만 · 주우면 표시 → cleanup 이 뺀다 · DROP_PICKED', () => {
  const { state, ctx, ch } = setup();
  const g1 = place(ctx, 'gold', PICKUP.goldR - 0.05, 0, { amount: 12 });
  const g2 = place(ctx, 'gold', PICKUP.goldR + 0.2, 0, { amount: 99 });
  const mat = place(ctx, 'material', 0, PICKUP.matR - 0.05, { mat: 'dust', amount: 2 });
  const pot = place(ctx, 'potion', 0, -(PICKUP.potionR - 0.05));
  const it = place(ctx, 'item', 0.3, 0.3, { item: newItem(), rarity: 'magic' });
  const gold0 = ch.gold, pots0 = ch.potions;
  updatePickups(ctx);
  assert.equal(ch.gold, gold0 + 12);
  assert.equal(ch.materials.dust, 2);
  assert.equal(ch.potions, pots0 + 1);
  assert.equal(g1.gone && mat.gone && pot.gone, true);
  assert.equal(g2.gone, false);
  assert.equal(it.gone, false, '장비는 자동으로 줍지 않는다');
  assert.equal(countEvents(ctx.events, EV.DROP_PICKED), 3);
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'pickup'));
  assert.equal(state.rift.drops.length, 5, '표시만 — 배열에서는 아직');
  removeMarked(ctx);
  assert.equal(state.rift.drops.length, 2);
  // 포션 상한
  ch.potions = ECON.potionMax;
  const pot2 = place(ctx, 'potion', 0.2, 0);
  updatePickups(ctx);
  assert.equal(pot2.gone, false, '상한이면 자동으로 줍지 않는다');
  const r = pickupDrop(ctx, pot2);
  assert.deepEqual(r, { ok: false, reason: 'full' });
  assert.ok(ctx.events.some(e => e.name === EV.PICKUP_FAIL && e.payload.reason === 'full'), '조용한 실패 없음');
  assert.equal(ch.potions, ECON.potionMax);
});

test('체력 구슬: 생명이 가득이 아닐 때 globeR + onGlobe().radiusAdd 안 · 회복 = lifeMax × 0.2 × (1 + globePct) × onGlobe().mul · PLAYER_HEAL{globe}', () => {
  const { ctx, p } = setup({ hooks: { onGlobe: () => ({ mul: 2, radiusAdd: 1.0 }) }, stats: { globePct: 0.5 } });
  const far = place(ctx, 'globe', PICKUP.globeR + 0.8, 0);
  updatePickups(ctx);
  assert.equal(far.gone, false, '가득이면 줍지 않는다');
  p.life = 10;
  updatePickups(ctx);
  assert.equal(far.gone, true, '반경 + 1.0');
  assert.equal(p.life, Math.min(p.lifeMax, 10 + p.lifeMax * GLOBE.heal * 1.5 * 2));
  const heal = ctx.events.find(e => e.name === EV.PLAYER_HEAL);
  assert.equal(heal.payload.source, 'globe');
});

test('가방 가득: 줍기 실패 → 드랍은 그대로 · PICKUP_FAIL{bagFull} · HINT bagFull · 두 드랍이면 먼저 주운 것만 들어간다', () => {
  const { ctx, ch } = setup();
  for (let i = 0; i < BAG_SIZE - 1; i++) ch.bag[i] = newItem();
  const a = place(ctx, 'item', 0.2, 0, { item: newItem({ rarity: 'rare' }), rarity: 'rare' });
  const b = place(ctx, 'item', -0.2, 0, { item: newItem({ rarity: 'rare' }), rarity: 'rare' });
  assert.equal(pickupDrop(ctx, a).ok, true);
  const r = pickupDrop(ctx, b);
  assert.deepEqual(r, { ok: false, reason: 'bagFull' });
  assert.equal(b.gone, false);
  assert.equal(ch.bag[BAG_SIZE - 1].id, a.item.id);
  assert.ok(ctx.events.some(e => e.name === EV.PICKUP_FAIL && e.payload.id === b.id && e.payload.reason === 'bagFull'));
  assert.ok(ctx.events.some(e => e.name === EV.HINT && e.payload.id === 'bagFull'));
  // 이미 주운 것 · 없는 것
  assert.deepEqual(pickupDrop(ctx, a), { ok: false, reason: 'noItem' });
  assert.deepEqual(pickupDrop(ctx, null), { ok: false, reason: 'noItem' });
});

test('골드 · 재료는 음수가 되지 않는다 · 아이템 ID 는 복사되지 않는다(같은 드랍을 두 번 주울 수 없다)', () => {
  const { state, ctx, ch } = setup();
  const d = place(ctx, 'gold', 0.1, 0, { amount: 7 });
  assert.equal(pickupDrop(ctx, d).ok, true);
  assert.equal(pickupDrop(ctx, d).ok, false);
  assert.equal(ch.gold, 7);
  const it = place(ctx, 'item', 0.1, 0, { item: newItem(), rarity: 'magic' });
  pickupDrop(ctx, it);
  pickupDrop(ctx, it);
  const ids = ch.bag.filter(Boolean).map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ch.gold >= 0 && Object.values(ch.materials).every(v => v >= 0));
  assert.equal(state.rift.stats.gold, 7);
  assertFiniteDeep(state);
});

test('쓰러져 있으면 · 전환 대기 중이면 자동 줍기를 하지 않는다', () => {
  const { state, ctx, ch } = setup();
  place(ctx, 'gold', 0.1, 0, { amount: 3 });
  state.player.dead = true;
  updatePickups(ctx);
  assert.equal(ch.gold, 0);
  state.player.dead = false;
  state.pendingTravel = { to: 'town', reason: 'recall' };
  updatePickups(ctx);
  assert.equal(ch.gold, 0);
  state.pendingTravel = null;
  updatePickups(ctx);
  assert.equal(ch.gold, 3);
});
