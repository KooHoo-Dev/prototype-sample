// OWNER: P6 — 계약 §12.2 · §6.11 (가방 · 장착 · 보관함 · 정렬 · 잠금 · 내구도 · 사망 대가 · 수리비 · 재화 더하기/빼기 · 아이템 복사 0)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_SIZE, EQUIP_SLOTS, STASH_SIZE } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { ECON, PRICES } from '../src/data/economy.js';
import { ITEM } from '../src/data/items.js';
import { GROWTH } from '../src/data/rift.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { computeStats } from '../src/sim/loot/stats.js';
import {
  addConsumable, addGold, addMaterials, addToBag, applyDeathPenalty, equip, findItem, itemAt, moveItem, repairCost, setItemLocked,
  sortBag, sortStash, spendGold, spendMaterials, unequip,
} from '../src/sim/progression/inventory.js';
import { assertFiniteDeep, countEvents, makeTestCtx, makeTestState } from './helpers.js';

/** 마을 · 레벨 1 전사(또는 cls) · refreshStats 는 실제 시트를 다시 계산하고 횟수를 센다 */
function setup({ cls = 'warrior', scene = 'town', level = 1 } = {}) {
  const state = makeTestState({ scene, cls, level });
  const ctx = makeTestCtx(state);
  const calls = { refresh: 0 };
  ctx.refreshStats = () => { calls.refresh++; ctx.stats = computeStats(state.char); };
  return { state, ctx, ch: state.char, calls };
}
/** @param {any} ctx @param {string} baseId @param {Object} [o] */
const mk = (ctx, baseId, o = {}) => makeItem({ baseId, id: ctx.newItemId(), ...o });

/** 캐릭터 · 보관함의 모든 아이템 ID(장착 · 가방 · 재고 · 되사기 · 보관함) */
function allIds(state) {
  const ch = state.char;
  const ids = [];
  for (const s of EQUIP_SLOTS) if (ch.equip[s]) ids.push(ch.equip[s].id);
  for (const it of ch.bag) if (it) ids.push(it.id);
  for (const it of ch.shop.blacksmith) ids.push(it.id);
  for (const it of ch.shop.general) ids.push(it.id);
  for (const e of ch.buyback) ids.push(e.item.id);
  for (const it of state.account.stash) if (it) ids.push(it.id);
  return ids;
}
function assertUnique(state, msg = '') {
  const ids = allIds(state);
  assert.equal(new Set(ids).size, ids.length, `아이템 ID 중복 ${msg}`);
  return ids.length;
}

// ───────────────────────── 재화 ─────────────────────────

test('addGold: 정수 · 음수/NaN 은 0 · GOLD · 균열 장면이면 rift.stats.gold · meter.runGold 에도(마을이면 아니다)', () => {
  const { ctx, ch, state } = setup();
  assert.equal(addGold(ctx, 10.4, 'grant'), 10);
  assert.equal(addGold(ctx, -5, 'grant'), 0);
  assert.equal(addGold(ctx, NaN, 'grant'), 0);
  assert.equal(addGold(ctx, Infinity, 'grant'), 0);
  assert.equal(ch.gold, 10);
  assert.equal(countEvents(ctx.events, EV.GOLD), 1, '더한 것이 없으면 이벤트도 없다');
  assert.deepEqual(ctx.events.find(e => e.name === EV.GOLD).payload, { gold: 10, delta: 10, reason: 'grant' });
  assert.equal(state.meter.runGold, 0, '마을 판매 · 보상은 판 집계가 아니다');

  const r = setup({ scene: 'rift' });
  addGold(r.ctx, 7, 'pickup');
  addGold(r.ctx, 3, 'pickup');
  assert.equal(r.ch.gold, 10);
  assert.equal(r.state.rift.stats.gold, 10, '판 집계 한 번씩');
  assert.equal(r.state.meter.runGold, 10);
  assert.equal(countEvents(r.ctx.events, EV.GOLD), 2);
});

test('spendGold · spendMaterials: 모자라면 아무것도 바꾸지 않는다 · 결과는 음수가 아니다 · 이벤트 delta 음수', () => {
  const { ctx, ch } = setup();
  ch.gold = 50;
  assert.equal(spendGold(ctx, 60, 'buy'), false);
  assert.equal(ch.gold, 50);
  assert.equal(spendGold(ctx, -1, 'buy'), false);
  assert.equal(spendGold(ctx, 50, 'buy'), true);
  assert.equal(ch.gold, 0);
  assert.equal(ctx.events.at(-1).payload.delta, -50);
  addMaterials(ctx, { scrap: 5, dust: 2, essence: 0, bogus: 9 }, 'grant');
  assert.deepEqual(ch.materials, { scrap: 5, dust: 2, essence: 0 }, '모르는 재료는 무시');
  assert.equal(spendMaterials(ctx, { scrap: 3, dust: 3 }, 'craft'), false, '하나라도 모자라면 실패');
  assert.deepEqual(ch.materials, { scrap: 5, dust: 2, essence: 0 });
  assert.equal(spendMaterials(ctx, { scrap: 5, dust: 2 }, 'craft'), true);
  assert.deepEqual(ch.materials, { scrap: 0, dust: 0, essence: 0 });
  const m = ctx.events.filter(e => e.name === EV.MATERIALS).at(-1).payload;
  assert.deepEqual(m.delta, { scrap: -5, dust: -2 });
});

test('addConsumable: 상한(ECON)까지만 · 실제로 더한 수 · 음수는 0', () => {
  const { ctx, ch } = setup();
  ch.potions = ECON.potionMax - 2;
  assert.equal(addConsumable(ctx, 'potion', 5), 2);
  assert.equal(ch.potions, ECON.potionMax);
  assert.equal(addConsumable(ctx, 'potion', 1), 0);
  ch.scrolls = 0;
  assert.equal(addConsumable(ctx, 'scroll', -3), 0);
  assert.equal(addConsumable(ctx, 'scroll', 3), 3);
  assert.equal(addConsumable(ctx, 'nope', 3), 0);
});

test('addToBag: 빈 첫 칸 · 가득 차면 bagFull(가방 그대로) · BAG{reason}', () => {
  const { ctx, ch } = setup();
  ch.bag[0] = mk(ctx, 'helm');
  const r = addToBag(ctx, mk(ctx, 'boots'), 'grant');
  assert.deepEqual(r, { ok: true, idx: 1 });
  assert.equal(ctx.events.at(-1).name, EV.BAG);
  assert.equal(ctx.events.at(-1).payload.reason, 'grant');
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  const before = ch.bag.slice();
  assert.deepEqual(addToBag(ctx, mk(ctx, 'ring'), 'pickup'), { ok: false, reason: 'bagFull' });
  assert.deepEqual(ch.bag, before);
});

// ───────────────────────── 장착 ─────────────────────────

test('equip: 클래스 · 레벨 · 부위 검사 · 낀 것은 그 아이템이 있던 가방 칸으로 · refreshStats · EQUIPPED · SAVE', () => {
  const { ctx, ch, calls } = setup();
  ch.bag[3] = mk(ctx, 'wand');
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 3 }), { ok: false, reason: 'class' });
  ch.bag[4] = mk(ctx, 'axe', { ilvl: 5 });
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 4 }), { ok: false, reason: 'level', params: { n: 5 } });
  ch.bag[5] = mk(ctx, 'helm');
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 5 }, 'chest'), { ok: false, reason: 'slot' });
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 9 }), { ok: false, reason: 'noItem' });
  assert.deepEqual(equip(ctx, { where: 'stash', idx: 0 }), { ok: false, reason: 'invalid' });
  assert.equal(calls.refresh, 0, '실패는 아무것도 바꾸지 않는다');

  const oldSword = ch.equip.mainHand;
  const axe = mk(ctx, 'axe', { rarity: 'magic' });
  ch.bag[7] = axe;
  const n0 = assertUnique(ctx.state);
  const r = equip(ctx, { where: 'bag', idx: 7 });
  assert.deepEqual(r, { ok: true, slot: 'mainHand' });
  assert.equal(ch.equip.mainHand, axe);
  assert.equal(ch.bag[7], oldSword, '낀 것은 원래 칸으로');
  assert.equal(calls.refresh, 1);
  assert.equal(ctx.stats.weapon.baseId, 'axe');
  const eq = ctx.events.find(e => e.name === EV.EQUIPPED).payload;
  assert.deepEqual(eq, { slot: 'mainHand', itemId: axe.id, baseId: 'axe', tier: 0, rarity: 'magic' });
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'char'));
  assert.equal(assertUnique(ctx.state), n0, '개수 보존');

  // 개발용: 요구 레벨 무시
  ctx.dev.ignoreReqLevel = true;
  assert.equal(equip(ctx, { where: 'bag', idx: 4 }).ok, true);
});

test('equip: 양손 무기는 보조를 가방으로 · 빈칸이 없으면 bagFull(아무것도 바뀌지 않는다) · 양손을 든 채 보조는 twoHanded', () => {
  const { ctx, ch, state } = setup();
  const shield = mk(ctx, 'shield');
  ch.bag[0] = shield;
  assert.equal(equip(ctx, { where: 'bag', idx: 0 }).ok, true);
  assert.equal(ch.equip.offhand, shield);
  assert.equal(ch.bag[0], null);

  // 가방이 가득 — 양손 무기를 끼면 검(주무기)이 그 칸으로, 방패는 갈 곳이 없다
  for (let i = 0; i < BAG_SIZE; i++) ch.bag[i] = mk(ctx, 'belt');
  const gs = mk(ctx, 'greatsword');
  ch.bag[10] = gs;
  const snap = JSON.stringify({ bag: ch.bag, equip: ch.equip });
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 10 }), { ok: false, reason: 'bagFull' });
  assert.equal(JSON.stringify({ bag: ch.bag, equip: ch.equip }), snap);

  ch.bag[20] = null;
  const n0 = assertUnique(state);
  const sword = ch.equip.mainHand;
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 10 }), { ok: true, slot: 'mainHand' });
  assert.equal(ch.equip.mainHand, gs);
  assert.equal(ch.equip.offhand, null);
  assert.equal(ch.bag[10], sword);
  assert.equal(ch.bag[20], shield);
  assert.equal(assertUnique(state), n0);
  const offEv = ctx.events.filter(e => e.name === EV.EQUIPPED).at(-1).payload;
  assert.deepEqual(offEv, { slot: 'offhand', itemId: null, baseId: null, tier: null, rarity: null });

  // 양손 무기를 든 채 보조
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 20 }), { ok: false, reason: 'twoHanded' });
  assert.equal(ch.bag[20], shield);

  // 양손 무기 + 보조 없음 · 빈칸 없음이어도 된다(주무기 교체만)
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  ch.bag[30] = mk(ctx, 'greataxe');
  assert.equal(equip(ctx, { where: 'bag', idx: 30 }).ok, true);
});

test('equip: 반지는 빈 칸 → ring1 · ring2 · 둘 다 차면 powerScore 가 더 오르는 칸(부서진 반지 쪽) · toSlot 으로 고른다', () => {
  const { ctx, ch } = setup();
  const r1 = mk(ctx, 'ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 5 }] });
  const r2 = mk(ctx, 'ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 6 }] });
  const r3 = mk(ctx, 'ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 12 }] });
  ch.bag[0] = r1; ch.bag[1] = r2; ch.bag[2] = r3;
  assert.equal(equip(ctx, { where: 'bag', idx: 0 }).slot, 'ring1');
  assert.equal(equip(ctx, { where: 'bag', idx: 1 }).slot, 'ring2');
  r2.dur = 0;   // 부서진 반지를 바꾸는 쪽이 낫다
  assert.equal(equip(ctx, { where: 'bag', idx: 2 }).slot, 'ring2');
  assert.equal(ch.bag[2], r2);
  assert.deepEqual(equip(ctx, { where: 'bag', idx: 2 }, 'helm'), { ok: false, reason: 'slot' });
  assert.equal(equip(ctx, { where: 'bag', idx: 2 }, 'ring1').slot, 'ring1');
  assert.equal(ch.bag[2], r1);
  assert.equal(ch.equip.ring1, r2);
});

test('unequip: 가방 빈 첫 칸으로 · 가득 차면 bagFull · 모르는 칸 invalid · 빈 칸 noItem', () => {
  const { ctx, ch, calls } = setup();
  const chest = ch.equip.chest;
  assert.deepEqual(unequip(ctx, 'chest'), { ok: true, idx: 0 });
  assert.equal(ch.bag[0], chest);
  assert.equal(ch.equip.chest, null);
  assert.equal(calls.refresh, 1);
  assert.deepEqual(unequip(ctx, 'chest'), { ok: false, reason: 'noItem' });
  assert.deepEqual(unequip(ctx, 'tail'), { ok: false, reason: 'invalid' });
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  assert.deepEqual(unequip(ctx, 'mainHand'), { ok: false, reason: 'bagFull' });
  assert.ok(ch.equip.mainHand);
});

// ───────────────────────── 옮기기 · 정렬 · 잠금 ─────────────────────────

test('moveItem: 가방 ↔ 가방 자리 바꿈 · 가방 ↔ 보관함은 마을에서만 · 빈 첫 칸 · 가득 차면 stashFull · 보관함 ↔ 보관함', () => {
  const { ctx, ch, state } = setup();
  const a = mk(ctx, 'helm');
  const b = mk(ctx, 'boots');
  ch.bag[0] = a; ch.bag[5] = b;
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 0 }, { where: 'bag', idx: 5 }), { ok: true, idx: 5 });
  assert.equal(ch.bag[0], b);
  assert.equal(ch.bag[5], a);
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 1 }, { where: 'bag', idx: 2 }), { ok: false, reason: 'noItem' });
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 0 }, { where: 'bag', idx: 99 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(moveItem(ctx, { where: 'equip', slot: 'chest' }, { where: 'bag', idx: 2 }), { ok: false, reason: 'invalid' });

  // 보관함으로(빈 첫 칸)
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 0 }, { where: 'stash' }), { ok: true, idx: 0 });
  assert.equal(state.account.stash[0], b);
  assert.equal(ch.bag[0], null);
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'all'), '보관함이 바뀌면 계정까지');
  assert.deepEqual(moveItem(ctx, { where: 'stash', idx: 0 }, { where: 'stash', idx: 59 }), { ok: true, idx: 59 });
  assert.equal(state.account.stash[59], b);

  // 보관함 가득
  for (let i = 0; i < STASH_SIZE; i++) if (!state.account.stash[i]) state.account.stash[i] = mk(ctx, 'belt');
  assert.deepEqual(moveItem(ctx, { where: 'bag', idx: 5 }, { where: 'stash' }), { ok: false, reason: 'stashFull' });
  // 차 있는 칸이면 자리 바꿈
  const s3 = state.account.stash[3];
  assert.equal(moveItem(ctx, { where: 'bag', idx: 5 }, { where: 'stash', idx: 3 }).ok, true);
  assert.equal(state.account.stash[3], a);
  assert.equal(ch.bag[5], s3);
  assertUnique(state);

  // 균열에서는 보관함 X
  const r = setup({ scene: 'rift' });
  r.ch.bag[0] = mk(r.ctx, 'helm');
  assert.deepEqual(moveItem(r.ctx, { where: 'bag', idx: 0 }, { where: 'stash' }), { ok: false, reason: 'notInTown' });
  assert.equal(moveItem(r.ctx, { where: 'bag', idx: 0 }, { where: 'bag', idx: 4 }).ok, true, '가방 안은 균열에서도');
  assert.deepEqual(sortStash(r.ctx), { ok: false, reason: 'notInTown' });
});

test('sortBag · sortStash: 등급(높은 것 먼저) → 부위 → ilvl 내림 → id · 빈칸은 뒤로 · 개수 · ID 보존', () => {
  const { ctx, ch, state } = setup();
  const items = [
    mk(ctx, 'ring', { rarity: 'magic', ilvl: 3 }),
    mk(ctx, 'helm', { rarity: 'rare', ilvl: 2 }),
    mk(ctx, 'helm', { rarity: 'rare', ilvl: 5 }),
    mk(ctx, 'sword', { rarity: 'normal', ilvl: 1 }),
    mk(ctx, 'boots', { rarity: 'set', ilvl: 4, setPieceId: 'ironLordGreaves' }),
    mk(ctx, 'amulet', { rarity: 'legendary', ilvl: 4, legendaryId: 'bloodPact' }),
    mk(ctx, 'sword', { rarity: 'normal', ilvl: 1 }),
  ];
  const cells = [7, 0, 39, 12, 3, 20, 21];
  items.forEach((it, k) => { ch.bag[cells[k]] = it; });
  items[1].flags.locked = true;
  const n0 = assertUnique(state);
  assert.deepEqual(sortBag(ctx), { ok: true });
  const got = ch.bag.filter(Boolean).map(it => `${it.rarity}:${it.slot}:${it.ilvl}`);
  assert.deepEqual(got, ['set:boots:4', 'legendary:amulet:4', 'rare:helm:5', 'rare:helm:2', 'magic:ring:3', 'normal:mainHand:1', 'normal:mainHand:1']);
  assert.ok(ch.bag.slice(0, 7).every(Boolean) && ch.bag.slice(7).every(x => x === null), '빈칸은 뒤로');
  assert.ok(Number(ch.bag[5].id.slice(1)) < Number(ch.bag[6].id.slice(1)), '같으면 id 순');
  assert.equal(ch.bag[3].flags.locked, true, '잠금은 그대로 따라간다');
  assert.equal(assertUnique(state), n0);
  assert.equal(ctx.events.at(-2).payload.reason, 'sort');

  state.account.stash[50] = mk(ctx, 'belt', { rarity: 'magic' });
  state.account.stash[2] = mk(ctx, 'belt', { rarity: 'rare' });
  assert.deepEqual(sortStash(ctx), { ok: true });
  assert.equal(state.account.stash[0].rarity, 'rare');
  assert.equal(state.account.stash[1].rarity, 'magic');
  assert.equal(state.account.stash[2], null);
});

test('setItemLocked: 가방 · 장착 · 보관함 · 재고는 invalid · 없으면 noItem', () => {
  const { ctx, ch, state } = setup();
  ch.bag[2] = mk(ctx, 'helm');
  assert.deepEqual(setItemLocked(ctx, { where: 'bag', idx: 2 }, true), { ok: true });
  assert.equal(ch.bag[2].flags.locked, true);
  assert.deepEqual(setItemLocked(ctx, { where: 'bag', idx: 2 }, false), { ok: true });
  assert.equal(ch.bag[2].flags.locked, false);
  assert.equal(setItemLocked(ctx, { where: 'equip', slot: 'chest' }, true).ok, true);
  assert.equal(ch.equip.chest.flags.locked, true);
  state.account.stash[0] = mk(ctx, 'belt');
  assert.equal(setItemLocked(ctx, { where: 'stash', idx: 0 }, true).ok, true);
  assert.deepEqual(setItemLocked(ctx, { where: 'stock', shop: 'blacksmith', idx: 0 }, true), { ok: false, reason: 'invalid' });
  assert.deepEqual(setItemLocked(ctx, { where: 'bag', idx: 9 }, true), { ok: false, reason: 'noItem' });
});

test('findItem · itemAt: 다섯 자리 모두', () => {
  const { ctx, ch, state } = setup();
  const a = mk(ctx, 'helm'); ch.bag[4] = a;
  const b = mk(ctx, 'belt'); state.account.stash[7] = b;
  const c = mk(ctx, 'boots'); ch.shop.general = [c];
  const d = mk(ctx, 'gloves'); ch.buyback = [{ item: d, price: 1 }];
  assert.deepEqual(findItem(state, a.id), { where: 'bag', idx: 4 });
  assert.deepEqual(findItem(state, ch.equip.chest.id), { where: 'equip', slot: 'chest' });
  assert.deepEqual(findItem(state, b.id), { where: 'stash', idx: 7 });
  assert.deepEqual(findItem(state, c.id), { where: 'stock', shop: 'general', idx: 0 });
  assert.deepEqual(findItem(state, d.id), { where: 'buyback', idx: 0 });
  assert.equal(findItem(state, 'i999999'), null);
  for (const it of [a, b, c, d]) assert.equal(itemAt(state, findItem(state, it.id)), it);
});

// ───────────────────────── 내구도 · 사망 대가 · 수리비 ─────────────────────────

test('applyDeathPenalty: 장착 전부 −10 · 0 에서 멈춘다 · 부서진 칸 · refreshStats(능력치 꺼짐) · DURABILITY', () => {
  const { ctx, ch, calls } = setup();
  ch.equip.helm = mk(ctx, 'helm');
  ch.equip.helm.dur = 15;
  ch.bag[0] = mk(ctx, 'boots');
  applyDeathPenalty(ctx);
  assert.equal(ch.equip.mainHand.dur, ITEM.durMax - ITEM.deathDurLoss);
  assert.equal(ch.equip.chest.dur, ITEM.durMax - ITEM.deathDurLoss);
  assert.equal(ch.equip.helm.dur, 5);
  assert.equal(ch.bag[0].dur, ITEM.durMax, '가방은 그대로');
  assert.equal(calls.refresh, 1);
  applyDeathPenalty(ctx);
  assert.equal(ch.equip.helm.dur, 0, '0 에서 멈춘다');
  const ev = ctx.events.filter(e => e.name === EV.DURABILITY).at(-1).payload;
  assert.deepEqual(ev, { broken: ['helm'], fraction: ITEM.deathDurLoss / ITEM.durMax });
  for (let i = 0; i < 10; i++) applyDeathPenalty(ctx);
  assert.ok(EQUIP_SLOTS.every(s => !ch.equip[s] || ch.equip[s].dur === 0));
  assert.equal(ctx.stats.weapon.fist, true, '내구도 0 무기 → 맨손');
  assert.deepEqual(ctx.stats.broken.sort(), ['chest', 'helm', 'mainHand']);
  assertFiniteDeep(ch, 'char');
});

test('repairCost: §7.10 식 손 계산 · 등급과 무관 · 10칸 사망 1회 = 57.2 × G^(ilvl−1)', () => {
  const { ctx, ch } = setup();
  assert.equal(repairCost(ch), 0, '멀쩡하면 0');
  ch.equip.mainHand.dur = 90;   // 검(한손) 20 × 5 × 0.1 = 10(밸런스 게이트: repairBase 4 → 5)
  ch.equip.chest.dur = 50;       // 갑옷 18 × 5 × 0.5 = 45
  assert.equal(PRICES.repairBase, 5);
  assert.equal(repairCost(ch), 55);

  // 같은 부위 · ilvl · 내구도면 등급이 달라도 같은 값(전설 · 세트를 낄수록 사망이 비싸지지 않는다)
  const L = 8;
  for (const rarity of ['normal', 'magic', 'rare', 'legendary', 'set']) {
    const extra = rarity === 'legendary' ? { legendaryId: 'ragingHorn' } : rarity === 'set' ? { setPieceId: 'ironLordHelm' } : {};
    const helm = mk(ctx, 'helm', { ilvl: L, rarity, ...extra });
    helm.dur = 70;
    const c = { ...ch, equip: { ...ch.equip, mainHand: null, chest: null, helm } };
    assert.equal(repairCost(c), Math.round(12 * PRICES.repairBase * GROWTH.gold ** (L - 1) * 0.3), rarity);
  }

  // 장착 10칸(한손 무기 · 보조 포함) 사망 1회
  const full = { ...ch, equip: {} };
  const bases = { mainHand: 'sword', offhand: 'shield', helm: 'helm', chest: 'chest', gloves: 'gloves', boots: 'boots', belt: 'belt', amulet: 'amulet', ring1: 'ring', ring2: 'ring' };
  for (const s of EQUIP_SLOTS) full.equip[s] = mk(ctx, bases[s], { ilvl: L, rarity: 'rare' });
  const sum = Object.values(ITEM.slotValue).reduce((a, b) => a + b, 0) - ITEM.slotValue.mainHand2h + ITEM.slotValue.ring;   // 1h · ring × 2
  assert.equal(sum, 143);
  const c2 = makeTestCtx(makeTestState({ scene: 'town' }));
  c2.state.char = full;
  applyDeathPenalty(c2);
  assert.equal(repairCost(full), Math.round(143 * PRICES.repairBase * 0.1 * GROWTH.gold ** (L - 1)));   // 밸런스 게이트: 71.5 × G^(ilvl−1)
});

// ───────────────────────── 아이템 복사 0(퍼즈) ─────────────────────────

test('아이템 복사 0: 장착 · 해제 · 옮기기 · 정렬 · 잠금을 무작위로 3000번 — ID 유일 · 개수 보존 · 장착 규칙 유지', () => {
  const { ctx, ch, state } = setup();
  ch.level = 30;
  const pool = ['sword', 'axe', 'greatsword', 'greataxe', 'shield', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'ring', 'wand'];
  for (let i = 0; i < 30; i++) ch.bag[i] = mk(ctx, pool[i % pool.length], { ilvl: 1 + (i % 9), rarity: ['normal', 'magic', 'rare'][i % 3] });
  for (let i = 0; i < 25; i++) state.account.stash[i * 2] = mk(ctx, pool[(i * 5) % pool.length]);
  const n0 = assertUnique(state);
  const rng = makeRng(seedRng(1234));
  const bagRef = () => ({ where: 'bag', idx: rng.int(0, BAG_SIZE - 1) });
  const anyRef = () => (rng.chance(0.5) ? bagRef() : { where: 'stash', idx: rng.chance(0.2) ? -1 : rng.int(0, STASH_SIZE - 1) });
  for (let k = 0; k < 3000; k++) {
    const op = rng.int(0, 6);
    if (op === 0) equip(ctx, bagRef(), rng.chance(0.2) ? EQUIP_SLOTS[rng.int(0, 9)] : null);
    else if (op === 1) unequip(ctx, EQUIP_SLOTS[rng.int(0, 9)]);
    else if (op === 2) moveItem(ctx, rng.chance(0.5) ? bagRef() : { where: 'stash', idx: rng.int(0, STASH_SIZE - 1) }, anyRef());
    else if (op === 3) sortBag(ctx);
    else if (op === 4) sortStash(ctx);
    else if (op === 5) setItemLocked(ctx, bagRef(), rng.chance(0.5));
    else applyDeathPenalty(ctx);
    assert.equal(assertUnique(state, `#${k}`), n0, `개수 보존 #${k}`);
    for (const s of EQUIP_SLOTS) {
      const it = ch.equip[s];
      if (!it) continue;
      assert.ok(it.slot === s || (it.slot === 'ring' && (s === 'ring1' || s === 'ring2')), `부위 ${s}`);
      assert.ok(it.cls === null || it.cls === ch.cls, '클래스');
    }
    assert.ok(!(ch.equip.offhand && ch.equip.mainHand && ['greatsword', 'greataxe'].includes(ch.equip.mainHand.baseId)), '양손 + 보조 없음');
  }
  assertFiniteDeep(state);
});
