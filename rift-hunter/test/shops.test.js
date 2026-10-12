// OWNER: P6 — 계약 §12.2 · §6.11 · §7.10 (상점 4의 거래 전부 · 가격 식 · 재고 · 도박 확률 · 재굴림 · 무료 · 음수 0 · 복사 0)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_SIZE, EQUIP_SLOTS, ITEM_SLOTS, RARITIES } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { CRAFT, ECON, GAMBLE, PRICES, REROLL, SALVAGE, SHOP } from '../src/data/economy.js';
import { ITEM } from '../src/data/items.js';
import { GROWTH } from '../src/data/rift.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { computeStats } from '../src/sim/loot/stats.js';
import { repairCost } from '../src/sim/progression/inventory.js';
import {
  buy, buyback, buyPotions, buyScrolls, canTakeFree, craft, gamble, gambleOdds, gambleRarity, priceBuy, priceCraft, priceGamble, pricePotion,
  priceReroll, priceReset, priceScroll, priceSell, repairAll, rerollCancel, rerollChoose, rerollOffer, resetSkills, restockShops, salvage,
  salvageMany, salvageYield, sell, sellMany, takeFree,
} from '../src/sim/progression/shops.js';
import { assertFiniteDeep, countEvents, makeTestChar, makeTestCtx, makeTestState } from './helpers.js';

const G = GROWTH.gold;

function setup({ cls = 'warrior', scene = 'town', level = 10 } = {}) {
  const state = makeTestState({ scene, cls, level });
  const ctx = makeTestCtx(state);
  const calls = { refresh: 0 };
  ctx.refreshStats = () => { calls.refresh++; ctx.stats = computeStats(state.char); };
  return { state, ctx, ch: state.char, calls };
}
/** @param {any} ctx @param {string} baseId @param {Object} [o] */
const mk = (ctx, baseId, o = {}) => makeItem({ baseId, id: ctx.newItemId(), ...o });

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
  return ids;
}
function assertWallet(ch, msg = '') {
  assert.ok(Number.isInteger(ch.gold) && ch.gold >= 0, `골드 ${ch.gold} ${msg}`);
  for (const k of Object.keys(ch.materials)) assert.ok(Number.isInteger(ch.materials[k]) && ch.materials[k] >= 0, `재료 ${k} ${msg}`);
  assert.ok(ch.potions >= 0 && ch.potions <= ECON.potionMax && ch.scrolls >= 0 && ch.scrolls <= ECON.scrollMax, `소모품 ${msg}`);
}

// ───────────────────────── 가격 ─────────────────────────

test('가격 식(§7.10): 판매 · 구매 · 도박(부위별) · 재굴림 · 제작 · 초기화 · 포션 · 두루마리 — 정수 · PL / PLc', () => {
  const ch = makeTestChar({ level: 10, riftUnlocked: 5, lastRiftLevel: 2 });
  const it = makeItem({ baseId: 'helm', ilvl: 6, rarity: 'rare', id: 'i1' });
  assert.equal(it.value, Math.round(12 * 6 * G ** 5));
  assert.equal(priceSell(it), Math.max(1, Math.round(it.value * PRICES.sellRate)));
  assert.equal(priceSell({ ...it, value: 2 }), 1, '판매가는 최소 1');
  assert.equal(priceBuy(it), Math.round(it.value * PRICES.buyMul.rare));
  assert.equal(priceBuy({ ...it, rarity: 'magic' }), Math.round(it.value * PRICES.buyMul.magic));
  for (const r of RARITIES) assert.ok(priceBuy({ ...it, rarity: r }) > priceSell({ ...it, rarity: r }), `사고 팔기 이득 없음 ${r}`);

  // 도박 = round(110 × slotValue / 15 × G^(PL−1)) · 주무기는 24
  const L1 = makeTestChar();
  assert.equal(priceGamble(L1, 'helm'), Math.round(110 * 12 / 15));
  assert.equal(priceGamble(L1, 'mainHand'), Math.round(110 * GAMBLE.mainHandValue / 15));
  assert.equal(priceGamble(L1, 'ring'), 110);
  assert.equal(priceGamble(ch, 'chest'), Math.round(110 * 18 / 15 * G ** 4));
  assert.equal(priceGamble(ch, 'tail'), 0);
  const avg = ITEM_SLOTS.reduce((a, s) => a + priceGamble(L1, s), 0) / ITEM_SLOTS.length;
  assert.ok(Math.abs(avg - 110) < 12, `부위 평균 ≈ 110 (${avg})`);

  // 재굴림 — 골드 × 1.5^min(n, 8) · 가루 min(5, 1 + n) · 정수 n ≥ 3
  const want = [[90, 1, 0], [135, 2, 0], [203, 3, 0], [304, 4, 1], [456, 5, 1], [683, 5, 1]];
  for (let n = 0; n < want.length; n++) {
    assert.deepEqual(priceReroll({ ...it, ilvl: 1, rerolls: n }), { gold: want[n][0], dust: want[n][1], essence: want[n][2] }, `rerolls ${n}`);
  }
  assert.equal(priceReroll({ ...it, ilvl: 1, rerolls: 20 }).gold, Math.round(90 * 1.5 ** REROLL.cap), '증가 상한');
  assert.equal(priceReroll({ ...it, ilvl: 6, rerolls: 1 }).gold, Math.round(90 * G ** 5 * 1.5));

  assert.equal(priceCraft(L1), CRAFT.gold);
  assert.equal(priceCraft(ch), Math.round(CRAFT.gold * G ** 4), '제작은 PL');
  assert.equal(priceReset(ch), Math.round(PRICES.resetPerLevel * 10 * G ** 1), '초기화는 PLc = min(해금 5, 마지막 2)');
  assert.equal(pricePotion(ch), Math.round(PRICES.potion * G), '포션도 PLc');
  assert.equal(priceScroll(ch), Math.round(PRICES.scroll * G));
  assert.equal(pricePotion(L1), PRICES.potion);
});

// ───────────────────────── 재고 ─────────────────────────

test('restockShops: 같은 판이면 그대로(산 것만 빠진다) · 다음 판에 새로 · 대장장이 9(장신구 없음 · 자기 클래스) · 잡화상 목걸이 1 + 반지 3 · ilvl = max(1, PL − 1)', () => {
  const { ctx, ch } = setup({ level: 8 });
  ch.riftUnlocked = 6;
  ch.runs = 0;
  restockShops(ctx);
  assert.equal(ch.shop.stockRun, 0);
  assert.equal(ch.shop.restocks, 1);
  assert.equal(ch.shop.blacksmith.length, SHOP.blacksmithStock);
  assert.equal(ch.shop.general.length, SHOP.generalStock);
  for (const it of ch.shop.blacksmith) {
    assert.ok(it.slot !== 'amulet' && it.slot !== 'ring', `대장장이에 장신구 없음 (${it.slot})`);
    assert.ok(it.cls === null || it.cls === 'warrior', '자기 클래스 무기 · 보조');
    assert.equal(it.ilvl, 5);
    assert.ok(it.rarity === 'magic' || it.rarity === 'rare', it.rarity);
  }
  assert.deepEqual(ch.shop.general.map(i => i.slot).sort(), ['amulet', 'ring', 'ring', 'ring']);
  const ids0 = [...ch.shop.blacksmith, ...ch.shop.general].map(i => i.id);

  // 같은 판 — 몇 번 불러도 그대로
  restockShops(ctx);
  restockShops(ctx);
  assert.deepEqual([...ch.shop.blacksmith, ...ch.shop.general].map(i => i.id), ids0);
  assert.equal(ch.shop.restocks, 1);
  ch.gold = 1e6;
  assert.equal(buy(ctx, 'blacksmith', 0).ok, true);
  restockShops(ctx);
  assert.equal(ch.shop.blacksmith.length, SHOP.blacksmithStock - 1, '산 것만 빠진다');

  // 다음 판
  ch.runs = 1;
  restockShops(ctx);
  assert.equal(ch.shop.stockRun, 1);
  assert.equal(ch.shop.restocks, 2);
  assert.equal(ch.shop.blacksmith.length, SHOP.blacksmithStock);
  const ids1 = [...ch.shop.blacksmith, ...ch.shop.general].map(i => i.id);
  assert.ok(ids1.every(id => !ids0.includes(id)), '새 재고는 새 ID');
  assertUnique(ctx.state);

  // 결정성 — 같은 캐릭터 시드 · 판이면 같은 재고(ID 를 뺀 내용)
  const strip = (list) => list.map(({ id, ...rest }) => rest);
  const a = setup({ level: 8 }); a.ch.riftUnlocked = 6; a.ch.seed = 77; a.ch.runs = 3; restockShops(a.ctx);
  const b = setup({ level: 8 }); b.ch.riftUnlocked = 6; b.ch.seed = 77; b.ch.runs = 3; b.ctx.newItemId(); restockShops(b.ctx);
  assert.deepEqual(strip(a.ch.shop.blacksmith), strip(b.ch.shop.blacksmith));
  assert.deepEqual(strip(a.ch.shop.general), strip(b.ch.shop.general));
  assert.deepEqual(a.state.rng.shop, b.state.rng.shop, '상태의 shop 난수 줄기를 쓰지 않는다(새로 고침 · 왕복과 무관)');
});

// ───────────────────────── 사기 · 팔기 · 되사기 ─────────────────────────

test('buy: 골드 차감 · 재고에서 빠지고 가방으로 · flags.bought · gold/bagFull 이면 아무것도 바뀌지 않는다 · TRADE · SAVE', () => {
  const { ctx, ch, state } = setup();
  ch.shop.blacksmith = [mk(ctx, 'helm', { rarity: 'magic', ilvl: 4 }), mk(ctx, 'boots', { rarity: 'rare', ilvl: 4 })];
  const item = ch.shop.blacksmith[1];
  const price = priceBuy(item);
  ch.gold = price - 1;
  assert.deepEqual(buy(ctx, 'blacksmith', 1), { ok: false, reason: 'gold' });
  assert.equal(ch.shop.blacksmith.length, 2);
  assert.equal(ch.gold, price - 1);
  ch.gold = price + 5;
  const r = buy(ctx, 'blacksmith', 1);
  assert.equal(r.ok, true);
  assert.equal(r.cost, price);
  assert.equal(ch.gold, 5);
  assert.equal(ch.bag[r.idx], item);
  assert.equal(item.flags.bought, true);
  assert.equal(ch.shop.blacksmith.length, 1);
  const tr = ctx.events.find(e => e.name === EV.TRADE).payload;
  assert.deepEqual(tr, { shop: 'blacksmith', kind: 'buy', cost: price, itemId: item.id, rarity: 'rare' });
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'trade'));
  assert.deepEqual(buy(ctx, 'blacksmith', 5), { ok: false, reason: 'noItem' });
  assert.deepEqual(buy(ctx, 'mystic', 0), { ok: false, reason: 'invalid' });
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  ch.gold = 1e6;
  assert.deepEqual(buy(ctx, 'blacksmith', 0), { ok: false, reason: 'bagFull' });
  assert.equal(ch.gold, 1e6);
  assertUnique(state);
});

test('sell → buyback: 판 값 그대로(이득 0) · 같은 아이템 · 장착은 equipped · 잠김은 itemLocked · 되사기 10개 유지', () => {
  const { ctx, ch, state } = setup();
  const it = mk(ctx, 'chest', { rarity: 'rare', ilvl: 7 });
  ch.bag[4] = it;
  ch.gold = 100;
  const p = priceSell(it);
  assert.deepEqual(sell(ctx, { where: 'bag', idx: 4 }), { ok: true, gold: p });
  assert.equal(ch.gold, 100 + p);
  assert.equal(ch.bag[4], null);
  assert.deepEqual(ch.buyback[0], { item: it, price: p });
  const r = buyback(ctx, 0);
  assert.equal(r.ok, true);
  assert.equal(r.cost, p);
  assert.equal(ch.gold, 100, '이득 0');
  assert.equal(ch.bag[r.idx], it);
  assert.equal(ch.buyback.length, 0);
  assertUnique(state);

  assert.deepEqual(sell(ctx, { where: 'equip', slot: 'chest' }), { ok: false, reason: 'equipped' });
  it.flags.locked = true;
  assert.deepEqual(sell(ctx, { where: 'bag', idx: r.idx }), { ok: false, reason: 'itemLocked' });
  assert.deepEqual(sell(ctx, { where: 'bag', idx: 30 }), { ok: false, reason: 'noItem' });
  assert.deepEqual(sell(ctx, { where: 'stash', idx: 0 }), { ok: false, reason: 'invalid' });
  ch.gold = 0;
  ch.buyback = [];
  const belt = mk(ctx, 'belt', { ilvl: 3 });
  ch.bag[5] = belt;
  sell(ctx, { where: 'bag', idx: 5 });
  assert.equal(ch.gold, priceSell(belt));
  assert.equal(buyback(ctx, 0).ok, true, '판 돈으로 정확히 되산다');
  assert.equal(ch.gold, 0);
  assert.deepEqual(buyback(ctx, 0), { ok: false, reason: 'noItem' });
  sell(ctx, { where: 'bag', idx: ch.bag.indexOf(belt) });
  ch.gold = 0;
  assert.deepEqual(buyback(ctx, 0), { ok: false, reason: 'gold' });
  assert.equal(ch.buyback[0].item, belt, '모자라면 되사기 목록 그대로');

  // 12개를 팔면 되사기는 새것 10개
  const sold = [];
  for (let k = 0; k < 12; k++) { const x = mk(ctx, 'gloves'); ch.bag[10 + k] = x; sold.push(x); sell(ctx, { where: 'bag', idx: 10 + k }); }
  assert.equal(ch.buyback.length, ECON.buybackMax);
  assert.equal(ch.buyback[0].item, sold[11], '새것이 앞');
  assert.ok(!ch.buyback.some(e => e.item === sold[0] || e.item === sold[1]), '밀려난 것은 사라진다');
  assertUnique(state);
});

test('sellMany: 잠긴 것 · 장착 · 빈 칸 · 같은 칸 두 번은 건너뛴다 · GOLD 한 번 · 하나도 못 팔면 nothing', () => {
  const { ctx, ch } = setup();
  const a = mk(ctx, 'helm', { rarity: 'magic', ilvl: 3 });
  const b = mk(ctx, 'boots', { ilvl: 2 });
  const c = mk(ctx, 'belt', { rarity: 'rare' });
  c.flags.locked = true;
  ch.bag[0] = a; ch.bag[1] = b; ch.bag[2] = c;
  ch.gold = 0;
  const g0 = countEvents(ctx.events, EV.GOLD);
  const refs = [{ where: 'bag', idx: 0 }, { where: 'bag', idx: 1 }, { where: 'bag', idx: 2 }, { where: 'bag', idx: 0 }, { where: 'equip', slot: 'chest' }, { where: 'bag', idx: 9 }];
  const r = sellMany(ctx, refs);
  assert.deepEqual(r, { ok: true, sold: 2, gold: priceSell(a) + priceSell(b), skipped: 4 });
  assert.equal(ch.gold, priceSell(a) + priceSell(b));
  assert.equal(countEvents(ctx.events, EV.GOLD) - g0, 1);
  assert.equal(ch.bag[2], c, '잠긴 것은 남는다');
  assert.ok(ch.equip.chest, '장착은 남는다');
  assert.deepEqual(ch.buyback.map(e => e.item), [b, a]);
  assert.deepEqual(sellMany(ctx, [{ where: 'bag', idx: 2 }]), { ok: false, reason: 'nothing' });
  assert.deepEqual(sellMany(ctx, null), { ok: false, reason: 'invalid' });
});

// ───────────────────────── 수리 ─────────────────────────

test('repairAll: 전부(repairCost) · 고칠 것 없음 nothing · 부분 수리(주무기 → 갑옷 → 보조 → 나머지 · 살 수 있는 만큼) · 하나도 못 고치면 gold', () => {
  const { ctx, ch, calls } = setup();
  assert.deepEqual(repairAll(ctx), { ok: false, reason: 'nothing' });
  ch.equip.offhand = mk(ctx, 'shield');
  ch.equip.helm = mk(ctx, 'helm');
  for (const s of ['mainHand', 'chest', 'offhand', 'helm']) ch.equip[s].dur = 0;
  // 검 20×5 = 100 · 갑옷 18×5 = 90 · 방패 15×5 = 75 · 투구 12×5 = 60(밸런스 게이트: repairBase 4 → 5)
  assert.equal(repairCost(ch), 325);
  ch.gold = 1000;
  const full = repairAll(ctx);
  assert.deepEqual(full, { ok: true, partial: false, repaired: ['mainHand', 'offhand', 'helm', 'chest'], cost: 325 });
  assert.equal(ch.gold, 675);
  assert.ok(['mainHand', 'chest', 'offhand', 'helm'].every(s => ch.equip[s].dur === ITEM.durMax));
  assert.equal(calls.refresh, 1);

  for (const s of ['mainHand', 'chest', 'offhand', 'helm']) ch.equip[s].dur = 0;
  ch.gold = 200;
  assert.deepEqual(repairAll(ctx), { ok: true, partial: true, repaired: ['mainHand', 'chest'], cost: 190 });
  assert.equal(ch.gold, 10);
  assert.equal(ch.equip.offhand.dur, 0);
  ch.gold = 85;
  assert.deepEqual(repairAll(ctx), { ok: true, partial: true, repaired: ['offhand'], cost: 75 }, '비싼 것은 건너뛰고 살 수 있는 것을');
  ch.gold = 10;
  assert.deepEqual(repairAll(ctx), { ok: false, reason: 'gold' });
  assert.equal(ch.gold, 10);
  assertWallet(ch);
});

test('수리비는 등급과 무관 — 같은 부위 · ilvl · 내구도의 일반 / 전설 / 세트를 낀 사망 1회 수리비가 같다', () => {
  const costs = [];
  for (const [rarity, extra] of [['normal', {}], ['legendary', { legendaryId: 'ragingHorn' }], ['set', { setPieceId: 'ironLordHelm' }]]) {
    const { ctx, ch } = setup();
    ch.equip.helm = mk(ctx, 'helm', { ilvl: 9, rarity, ...extra });
    ch.equip.helm.dur = 90;
    ch.equip.mainHand = null; ch.equip.chest = null;
    ch.gold = 1e5;
    costs.push(repairAll(ctx).cost);
  }
  assert.equal(new Set(costs).size, 1, JSON.stringify(costs));
});

// ───────────────────────── 분해 · 제작 ─────────────────────────

test('salvage · salvageMany: SALVAGE[등급] 재료 · 아이템 사라짐 · 잠긴 것 itemLocked(일괄은 건너뜀) · 장착 equipped', () => {
  const { ctx, ch, state } = setup();
  const m = mk(ctx, 'helm', { rarity: 'magic' });
  const l = mk(ctx, 'amulet', { rarity: 'legendary', legendaryId: 'bloodPact' });
  ch.bag[0] = m; ch.bag[1] = l;
  assert.deepEqual(salvageYield(m), SALVAGE.magic);
  assert.deepEqual(salvage(ctx, { where: 'bag', idx: 0 }), { ok: true, materials: { scrap: 1, dust: 1 } });
  assert.deepEqual(ch.materials, { scrap: 1, dust: 1, essence: 0 });
  assert.equal(ch.bag[0], null);
  assert.equal(findIdx(state, m.id), -1, '아이템이 사라졌다');
  l.flags.locked = true;
  assert.deepEqual(salvage(ctx, { where: 'bag', idx: 1 }), { ok: false, reason: 'itemLocked' });
  assert.deepEqual(salvage(ctx, { where: 'equip', slot: 'chest' }), { ok: false, reason: 'equipped' });
  for (let k = 0; k < 5; k++) ch.bag[10 + k] = mk(ctx, 'belt');
  const r = salvageMany(ctx, [1, 10, 11, 12, 13, 14, 14].map(idx => ({ where: 'bag', idx })));
  assert.deepEqual(r, { ok: true, salvaged: 5, skipped: 2, materials: { scrap: 5 } });
  assert.deepEqual(ch.materials, { scrap: 6, dust: 1, essence: 0 });
  assert.equal(ch.bag[1], l);
  assert.deepEqual(salvageMany(ctx, [{ where: 'bag', idx: 1 }]), { ok: false, reason: 'nothing' });
  assertUnique(state);
});
function findIdx(state, id) { return allIds(state).indexOf(id); }

test('craft: 골드 + 고철 20 · 가루 10 → 그 부위 희귀 · ilvl = 해금 최고 · 자기 클래스 · flags.crafted · gold/materials/bagFull 이면 차감 없음', () => {
  const { ctx, ch, state } = setup();
  ch.riftUnlocked = 4;
  const cost = priceCraft(ch);
  ch.gold = cost;
  ch.materials = { scrap: CRAFT.scrap, dust: CRAFT.dust - 1, essence: 0 };
  assert.deepEqual(craft(ctx, 'gloves'), { ok: false, reason: 'materials' });
  assert.equal(ch.gold, cost);
  ch.materials.dust = CRAFT.dust;
  ch.gold = cost - 1;
  assert.deepEqual(craft(ctx, 'gloves'), { ok: false, reason: 'gold' });
  assert.deepEqual(ch.materials, { scrap: CRAFT.scrap, dust: CRAFT.dust, essence: 0 });
  ch.gold = cost;
  assert.deepEqual(craft(ctx, 'tail'), { ok: false, reason: 'invalid' });
  const r = craft(ctx, 'mainHand');
  assert.equal(r.ok, true);
  assert.equal(r.item.rarity, 'rare');
  assert.equal(r.item.slot, 'mainHand');
  assert.equal(r.item.ilvl, 4);
  assert.ok(r.item.cls === 'warrior', '자기 클래스 무기');
  assert.equal(r.item.flags.crafted, true);
  assert.equal(itemAtRef(ch, r.ref), r.item);
  assert.equal(ch.gold, 0);
  assert.deepEqual(ch.materials, { scrap: 0, dust: 0, essence: 0 });
  assertUnique(state);
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  ch.gold = 1e6; ch.materials = { scrap: 99, dust: 99, essence: 0 };
  assert.deepEqual(craft(ctx, 'helm'), { ok: false, reason: 'bagFull' });
  assert.equal(ch.gold, 1e6);
});
const itemAtRef = (ch, ref) => ch.bag[ref.idx];

// ───────────────────────── 도박 ─────────────────────────

test('gambleOdds: 합 1 · 기본 72 / 24 / 3 / 1 · 그 부위 · 클래스에 전설 · 세트가 없으면 그 몫이 희귀로', () => {
  const W = makeTestChar({ cls: 'warrior' });
  const M = makeTestChar({ cls: 'mage' });
  const tot = Object.values(GAMBLE.rarity).reduce((a, b) => a + b, 0);
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  for (const ch of [W, M]) for (const s of ITEM_SLOTS) {
    const o = gambleOdds(ch, s);
    assert.ok(near(Object.values(o).reduce((a, b) => a + b, 0), 1), `${ch.cls} ${s} 합 1`);
    assert.equal(o.normal, 0);
    assert.ok(near(o.magic, GAMBLE.rarity.magic / tot));
    assert.ok(near(o.rare + o.legendary + o.set, (GAMBLE.rarity.rare + GAMBLE.rarity.legendary + GAMBLE.rarity.set) / tot), '희귀 이상 비율은 같다');
  }
  // 전사 투구 = 분노의 뿔 + 강철 군주 → 그대로
  assert.deepEqual(Object.values(gambleOdds(W, 'helm')).map(v => Math.round(v * 1000)), [0, 720, 240, 30, 10]);
  // 전사 보조(방패) — 전설 · 세트 없음 → 희귀 28%
  assert.deepEqual(Object.values(gambleOdds(W, 'offhand')).map(v => Math.round(v * 1000)), [0, 720, 280, 0, 0]);
  // 전사 갑옷 — 세트(강철 군주의 판금)만
  assert.deepEqual(Object.values(gambleOdds(W, 'chest')).map(v => Math.round(v * 1000)), [0, 720, 270, 0, 10]);
  // 전사 반지 — 서리 반지는 마법사 것 → 전설 없음 · 마법사 반지는 있다
  assert.equal(gambleOdds(W, 'ring').legendary, 0);
  assert.ok(gambleOdds(M, 'ring').legendary > 0);
  // 공용 전설(피의 서약) — 목걸이는 둘 다
  assert.ok(gambleOdds(W, 'amulet').legendary > 0 && gambleOdds(M, 'amulet').legendary > 0);
});

test('도박 확률: 10만 회 굴림 vs gambleOdds — 칸마다 4σ 안 · 확률 0 인 등급은 한 번도 안 나온다', () => {
  const N = 100000;
  for (const [cls, slot] of [['warrior', 'helm'], ['mage', 'chest'], ['warrior', 'offhand'], ['mage', 'ring']]) {
    const ch = makeTestChar({ cls });
    const rng = makeRng(seedRng(4242));
    const odds = gambleOdds(ch, slot);
    const n = Object.fromEntries(RARITIES.map(r => [r, 0]));
    for (let i = 0; i < N; i++) n[gambleRarity(rng, ch, slot)]++;
    for (const r of RARITIES) {
      const p = odds[r];
      if (p === 0) { assert.equal(n[r], 0, `${cls} ${slot} ${r} 는 0`); continue; }
      const sd = Math.sqrt(N * p * (1 - p));
      assert.ok(Math.abs(n[r] - N * p) <= 4 * sd, `${cls} ${slot} ${r}: ${n[r]} vs ${N * p}`);
      if (p >= 0.05) assert.ok(Math.abs(n[r] / (N * p) - 1) <= 0.03, `${cls} ${slot} ${r} 상대 오차 ≤ 3%`);
    }
  }
});

test('gamble: 그 부위 가격 차감 · ilvl = 해금 최고 · flags.gambled · 부위 · gold/bagFull/invalid 이면 아무것도 바뀌지 않는다', () => {
  const { ctx, ch, state } = setup();
  ch.riftUnlocked = 3;
  const price = priceGamble(ch, 'boots');
  ch.gold = price - 1;
  assert.deepEqual(gamble(ctx, 'boots'), { ok: false, reason: 'gold' });
  assert.equal(ch.gold, price - 1);
  assert.deepEqual(gamble(ctx, 'wings'), { ok: false, reason: 'invalid' });
  ch.gold = price * 30;
  const seen = new Set();
  for (let k = 0; k < 30; k++) {
    const r = gamble(ctx, 'boots');
    assert.equal(r.ok, true);
    assert.equal(r.cost, price);
    assert.equal(r.item.slot, 'boots');
    assert.equal(r.item.ilvl, 3);
    assert.equal(r.item.flags.gambled, true);
    assert.ok(r.item.rarity !== 'normal');
    seen.add(r.item.id);
    ch.bag[r.ref.idx] = null;   // 다음 굴림에 자리
  }
  assert.equal(seen.size, 30, '굴림마다 새 ID');
  assert.equal(ch.gold, 0);
  assert.equal(countEvents(ctx.events, EV.TRADE), 30);
  assertWallet(ch);
  for (let i = 0; i < BAG_SIZE; i++) if (!ch.bag[i]) ch.bag[i] = mk(ctx, 'belt');
  ch.gold = 1e6;
  assert.deepEqual(gamble(ctx, 'boots'), { ok: false, reason: 'bagFull' });
  assert.equal(ch.gold, 1e6);
  assertUnique(state);
});

// ───────────────────────── 재굴림 ─────────────────────────

test('재굴림: 제안(비용 미리 · 결제 없음) · 취소 무료 · 다시 제안해도 같은 후보 · 고르면 결제 · 고정 · 횟수 · 비용 증가 · 다른 옵션은 rerollLocked', () => {
  const { ctx, ch, calls } = setup();
  const it = mk(ctx, 'helm', { rarity: 'rare', ilvl: 1, affixes: [{ id: 'vit', tier: 1, value: 5 }, { id: 'armor', tier: 1, value: 4 }, { id: 'allRes', tier: 1, value: 3 }] });
  ch.bag[6] = it;
  ch.gold = 1000;
  ch.materials = { scrap: 0, dust: 20, essence: 2 };
  assert.deepEqual(rerollChoose(ctx, 1), { ok: false, reason: 'noOffer' });
  assert.deepEqual(rerollOffer(ctx, { where: 'bag', idx: 6 }, 3), { ok: false, reason: 'invalid' });
  const o1 = rerollOffer(ctx, { where: 'bag', idx: 6 }, 1);
  assert.equal(o1.ok, true);
  assert.equal(o1.offer.itemId, it.id);
  assert.equal(o1.offer.options.length, 3);
  assert.deepEqual(o1.offer.options[0], { id: 'armor', tier: 1, value: 4 }, '0번 = 기존');
  assert.deepEqual(o1.offer.cost, priceReroll(it));
  assert.equal(ch.shop.reroll, o1.offer);
  assert.equal(ch.gold, 1000, '제안은 무료');
  assert.deepEqual(rerollCancel(ctx), { ok: true });
  assert.equal(ch.shop.reroll, null);
  assert.equal(ch.gold, 1000);
  assert.deepEqual(rerollCancel(ctx), { ok: false, reason: 'noOffer' });
  const o2 = rerollOffer(ctx, { where: 'bag', idx: 6 }, 1);
  assert.deepEqual(o2.offer.options, o1.offer.options, '취소 → 다시 제안해도 같은 후보(공짜로 새 후보를 보지 못한다)');

  const c1 = priceReroll(it);
  const r = rerollChoose(ctx, 2);
  assert.equal(r.ok, true);
  assert.deepEqual(it.affixes[1], o2.offer.options[2]);
  assert.equal(it.rerollIdx, 1);
  assert.equal(it.rerolls, 1);
  assert.equal(ch.gold, 1000 - c1.gold);
  assert.equal(ch.materials.dust, 20 - c1.dust);
  assert.equal(ch.shop.reroll, null);
  assert.equal(calls.refresh, 0, '가방 아이템이면 시트를 다시 계산하지 않는다');
  assert.deepEqual(rerollOffer(ctx, { where: 'bag', idx: 6 }, 0), { ok: false, reason: 'rerollLocked' });
  const c2 = priceReroll(it);
  assert.ok(c2.gold > c1.gold && c2.dust > c1.dust, '비용은 횟수마다 오른다');
  // 0 = 기존 유지도 결제 · 횟수
  assert.equal(rerollOffer(ctx, { where: 'bag', idx: 6 }, 1).ok, true);
  const keep = { ...it.affixes[1] };
  assert.equal(rerollChoose(ctx, 0).ok, true);
  assert.deepEqual(it.affixes[1], keep);
  assert.equal(it.rerolls, 2);
  assert.equal(ch.gold, 1000 - c1.gold - c2.gold);

  // 정수: rerolls ≥ 3 부터
  it.rerolls = REROLL.essenceFrom;
  ch.materials.essence = 0;
  assert.deepEqual(rerollOffer(ctx, { where: 'bag', idx: 6 }, 1), { ok: false, reason: 'materials' });
  ch.materials.essence = 1;
  ch.gold = 0;
  assert.deepEqual(rerollOffer(ctx, { where: 'bag', idx: 6 }, 1), { ok: false, reason: 'gold' });
  ch.gold = 1e5;
  assert.equal(rerollOffer(ctx, { where: 'bag', idx: 6 }, 1).ok, true);
  ch.gold = 1;
  assert.deepEqual(rerollChoose(ctx, 1), { ok: false, reason: 'gold' });
  assert.ok(ch.shop.reroll, '모자라면 제안은 남는다');
  ch.gold = 1e5;
  assert.equal(rerollChoose(ctx, 1).ok, true);
  assert.equal(ch.materials.essence, 0, '깊은 재굴림은 정수를 쓴다');
  assertWallet(ch);
});

test('재굴림: 장착 아이템이면 refreshStats · 제안 중 팔면 제안이 사라진다(noOffer) · 마법 등급 이름이 옵션을 따라간다', () => {
  const { ctx, ch, calls } = setup();
  ch.gold = 1e5;
  ch.materials = { scrap: 0, dust: 50, essence: 5 };
  ch.equip.boots = mk(ctx, 'boots', { rarity: 'magic', affixes: [{ id: 'moveSpeed', tier: 1, value: 5 }] });
  assert.equal(rerollOffer(ctx, { where: 'equip', slot: 'boots' }, 0).ok, true);
  assert.equal(ch.shop.reroll.where, 'equip');
  assert.equal(rerollChoose(ctx, 1).ok, true);
  assert.equal(calls.refresh, 1);
  const b = ch.equip.boots;
  assert.ok(b.name.includes('base.boots.0'));
  assert.ok(b.name.some(k => k.startsWith('afx.' + b.affixes[0].id + '.')), '이름이 바뀐 옵션을 따른다');

  const it = mk(ctx, 'helm', { rarity: 'rare', affixes: [{ id: 'vit', tier: 1, value: 5 }, { id: 'armor', tier: 1, value: 4 }, { id: 'allRes', tier: 1, value: 3 }] });
  ch.bag[0] = it;
  assert.equal(rerollOffer(ctx, { where: 'bag', idx: 0 }, 2).ok, true);
  assert.equal(sell(ctx, { where: 'bag', idx: 0 }).ok, true);
  assert.equal(ch.shop.reroll, null);
  assert.deepEqual(rerollChoose(ctx, 1), { ok: false, reason: 'noOffer' });
});

// ───────────────────────── 소모품 · 무료 · 초기화 ─────────────────────────

test('buyPotions · buyScrolls: 상한까지만 · 골드가 되는 만큼(partial) · full · gold · invalid', () => {
  const { ctx, ch } = setup();
  ch.potions = 5;
  ch.gold = 1000;
  const p = pricePotion(ch);
  assert.deepEqual(buyPotions(ctx, 10), { ok: true, bought: 5, cost: 5 * p, partial: true });
  assert.equal(ch.potions, ECON.potionMax);
  assert.equal(ch.gold, 1000 - 5 * p);
  assert.deepEqual(buyPotions(ctx, 1), { ok: false, reason: 'full' });
  ch.potions = 0;
  ch.gold = p * 2 + 1;
  assert.deepEqual(buyPotions(ctx, 4), { ok: true, bought: 2, cost: 2 * p, partial: true });
  assert.equal(ch.gold, 1);
  assert.deepEqual(buyPotions(ctx, 1), { ok: false, reason: 'gold' });
  assert.deepEqual(buyPotions(ctx, 0), { ok: false, reason: 'invalid' });
  ch.scrolls = 9;
  ch.gold = 100;
  assert.deepEqual(buyScrolls(ctx, 1), { ok: true, bought: 1, cost: priceScroll(ch), partial: false });
  assert.equal(ch.scrolls, ECON.scrollMax);
  assertWallet(ch);
});

test('takeFree: 0개이고 골드가 그 값보다 적을 때만 1개(파밍 경로가 아니다) · 아니면 notEligible', () => {
  const { ctx, ch } = setup();
  ch.potions = 0;
  ch.gold = pricePotion(ch) - 1;
  assert.equal(canTakeFree(ch, 'potion'), true);
  assert.deepEqual(takeFree(ctx, 'potion'), { ok: true });
  assert.equal(ch.potions, 1);
  assert.equal(ch.gold, pricePotion(ch) - 1, '골드는 그대로');
  assert.deepEqual(takeFree(ctx, 'potion'), { ok: false, reason: 'notEligible' }, '이미 하나 있다');
  ch.potions = 0;
  ch.gold = pricePotion(ch);
  assert.deepEqual(takeFree(ctx, 'potion'), { ok: false, reason: 'notEligible' }, '살 수 있으면 공짜가 아니다');
  ch.scrolls = 0;
  ch.gold = 0;
  assert.deepEqual(takeFree(ctx, 'scroll'), { ok: true });
  assert.equal(ch.scrolls, 1);
  assert.deepEqual(takeFree(ctx, 'gem'), { ok: false, reason: 'invalid' });
  // 반복해도 0 → 1 만 — 쌓이지 않는다
  for (let k = 0; k < 20; k++) takeFree(ctx, 'scroll');
  assert.equal(ch.scrolls, 1);
});

test('resetSkills: priceReset · ranks · bar 비움 · refreshStats · SKILLS{reset} · nothing · gold', () => {
  const { ctx, ch, calls } = setup({ level: 6 });
  assert.deepEqual(resetSkills(ctx), { ok: false, reason: 'nothing' });
  ch.skills.ranks = { groundStomp: 2, weaponMastery: 1 };
  ch.skills.bar = ['groundStomp', null, null, null, null];
  const price = priceReset(ch);
  ch.gold = price - 1;
  assert.deepEqual(resetSkills(ctx), { ok: false, reason: 'gold' });
  assert.equal(ch.skills.ranks.groundStomp, 2);
  ch.gold = price;
  assert.deepEqual(resetSkills(ctx), { ok: true, cost: price });
  assert.deepEqual(ch.skills.ranks, {});
  assert.deepEqual(ch.skills.bar, [null, null, null, null, null]);
  assert.equal(ch.gold, 0);
  assert.equal(calls.refresh, 1);
  assert.deepEqual(ctx.events.find(e => e.name === EV.SKILLS).payload, { reason: 'reset', nodeId: null, rank: 0 });
  assert.equal(ctx.events.find(e => e.name === EV.GOLD && e.payload.delta < 0).payload.reason, 'reset');
});

test('마을 밖에서는 모든 거래가 notInTown(아무것도 바뀌지 않는다)', () => {
  const { ctx, ch, state } = setup({ scene: 'rift' });
  ch.gold = 1e5;
  ch.materials = { scrap: 99, dust: 99, essence: 9 };
  ch.bag[0] = mk(ctx, 'helm', { rarity: 'rare', affixes: [{ id: 'vit', tier: 1, value: 5 }] });
  ch.shop.blacksmith = [mk(ctx, 'boots')];
  ch.buyback = [{ item: mk(ctx, 'belt'), price: 1 }];
  ch.equip.mainHand.dur = 0;
  ch.skills.ranks = { groundStomp: 1 };
  const snap = JSON.stringify(state.char);
  const results = [
    buy(ctx, 'blacksmith', 0), sell(ctx, { where: 'bag', idx: 0 }), sellMany(ctx, [{ where: 'bag', idx: 0 }]), buyback(ctx, 0), repairAll(ctx),
    salvage(ctx, { where: 'bag', idx: 0 }), salvageMany(ctx, [{ where: 'bag', idx: 0 }]), craft(ctx, 'helm'), gamble(ctx, 'helm'),
    rerollOffer(ctx, { where: 'bag', idx: 0 }, 0), rerollChoose(ctx, 0), rerollCancel(ctx), buyPotions(ctx, 1), buyScrolls(ctx, 1),
    takeFree(ctx, 'potion'), resetSkills(ctx),
  ];
  for (const r of results) assert.deepEqual(r, { ok: false, reason: 'notInTown' });
  assert.equal(JSON.stringify(state.char), snap);
});

// ───────────────────────── 음수 0 · 복사 0(퍼즈) ─────────────────────────

test('골드 · 재료 음수 0 · 아이템 복사 0: 상점 거래 전부를 무작위로 4000번(가난한 상태 포함) — 새 ID 만 생기고 정해진 경로로만 사라진다', () => {
  const { ctx, ch, state } = setup({ level: 30 });
  ch.riftUnlocked = 5;
  ch.lastRiftLevel = 5;
  for (let i = 0; i < 20; i++) ch.bag[i] = mk(ctx, ['helm', 'boots', 'ring', 'sword', 'chest'][i % 5], { ilvl: 1 + (i % 6), rarity: RARITIES[i % 3] });
  const rng = makeRng(seedRng(99));
  const bagRef = () => ({ where: 'bag', idx: rng.int(0, BAG_SIZE - 1) });
  for (let k = 0; k < 4000; k++) {
    if (rng.chance(0.05)) ch.gold = rng.chance(0.5) ? rng.int(0, 40) : rng.int(0, 20000);
    if (rng.chance(0.05)) ch.materials = { scrap: rng.int(0, 30), dust: rng.int(0, 15), essence: rng.int(0, 2) };
    if (rng.chance(0.03)) { ch.runs++; }
    if (rng.chance(0.05)) for (const s of EQUIP_SLOTS) if (ch.equip[s]) ch.equip[s].dur = rng.int(0, 100);
    const before = new Set(allIds(state));
    const maxBefore = Math.max(0, ...[...before].map(id => (id[0] === 'i' ? Number(id.slice(1)) : 0)));
    const bbBefore = ch.buyback.slice();
    const op = rng.int(0, 14);
    let r;
    switch (op) {
      case 0: r = buy(ctx, rng.chance(0.5) ? 'blacksmith' : 'general', rng.int(0, 9)); break;
      case 1: r = sell(ctx, bagRef()); break;
      case 2: r = sellMany(ctx, [bagRef(), bagRef(), bagRef()]); break;
      case 3: r = buyback(ctx, rng.int(0, 10)); break;
      case 4: r = repairAll(ctx); break;
      case 5: r = salvage(ctx, bagRef()); break;
      case 6: r = salvageMany(ctx, [bagRef(), bagRef()]); break;
      case 7: r = craft(ctx, ITEM_SLOTS[rng.int(0, 8)]); break;
      case 8: r = gamble(ctx, ITEM_SLOTS[rng.int(0, 8)]); break;
      case 9: { const ref = bagRef(); r = rerollOffer(ctx, ref, rng.int(0, 3)); break; }
      case 10: r = rerollChoose(ctx, rng.int(0, 2)); break;
      case 11: r = rng.chance(0.5) ? buyPotions(ctx, rng.int(1, 12)) : buyScrolls(ctx, rng.int(1, 12)); break;
      case 12: r = takeFree(ctx, rng.chance(0.5) ? 'potion' : 'scroll'); break;
      case 13: restockShops(ctx); r = { ok: true }; break;
      default: r = rerollCancel(ctx);
    }
    assert.ok(r && typeof r.ok === 'boolean', `결과 #${k}`);
    if (!r.ok) assert.equal(typeof r.reason, 'string');
    assertWallet(ch, `#${k} op ${op}`);
    const after = assertUnique(state, `#${k} op ${op}`);
    const added = after.filter(id => !before.has(id));
    const afterSet = new Set(after);
    const removed = [...before].filter(id => !afterSet.has(id));
    for (const id of added) assert.ok(Number(id.slice(1)) > maxBefore, `새 ID 만 생긴다 #${k} op ${op}`);
    if (op === 1 || op === 2) {
      // 팔기: 사라지는 것은 되사기에서 밀려난 옛것뿐
      for (const id of removed) assert.ok(bbBefore.some(e => e.item.id === id), `#${k} 팔기에서 사라진 것은 밀려난 되사기`);
      assert.equal(added.length, 0);
    } else if (op === 5 || op === 6) {
      assert.equal(removed.length, r.ok ? (r.salvaged ?? 1) : 0);
      assert.equal(added.length, 0);
    } else if (op === 7 || op === 8) {
      assert.equal(removed.length, 0);
      assert.equal(added.length, r.ok ? 1 : 0);
    } else if (op === 13) {
      for (const id of removed) assert.ok(!ch.bag.some(it => it && it.id === id), '재고 교체로 가방의 것은 사라지지 않는다');
    } else {
      assert.equal(removed.length, 0, `#${k} op ${op} 사라진 것 없음`);
      assert.equal(added.length, 0, `#${k} op ${op} 생긴 것 없음`);
    }
  }
  assertFiniteDeep(state);
});
