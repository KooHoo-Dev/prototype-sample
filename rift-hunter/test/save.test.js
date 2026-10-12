// OWNER: P6 — 계약 §12.2 · §6.11 · §3.11 · §11.6 (직렬화 왕복 · 깨진 세이브 · 정화 · ID 중복 정리 · 이주 자리 · 계정 복구 · throw 0)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_SIZE, CHAR_SLOTS, EQUIP_SLOTS, GAME_ID, SAVE_VERSION, STASH_SIZE } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { ECON } from '../src/data/economy.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { createCharacter, summaryOf } from '../src/sim/progression/character.js';
import { xpReq } from '../src/sim/progression/progress.js';
import {
  dedupeItemIds, loadAccount, loadChar, rebuildAccount, sanitizeItem, serializeAccount, serializeChar,
} from '../src/sim/progression/save.js';
import { priceSell } from '../src/sim/progression/shops.js';
import { createAccount, createGameState } from '../src/sim/state.js';
import { assertFiniteDeep, makeTestCtx, makeTestState } from './helpers.js';

/** 마을 · 캐릭터를 「진짜 ID」('i<n>')로 다시 만든 상태(가방 · 장착 · 보관함 · 재고 · 되사기 · 기록 · 최고 기록 · 안내 · 재굴림 제안까지) */
function richState({ cls = 'warrior' } = {}) {
  const state = makeTestState({ scene: 'town', cls });
  const ctx = makeTestCtx(state);
  const mk = (baseId, o = {}) => makeItem({ baseId, id: ctx.newItemId(), ...o });
  const ch = createCharacter({ slot: 2, cls, name: 'Saver', newId: ctx.newItemId, seed: 4321 });
  state.char = ch;
  state.account.chars[2] = summaryOf(ch);
  ch.level = 12;
  ch.xp = 1234;
  ch.xpTotal = 40000;
  ch.gold = 98765;
  ch.materials = { scrap: 12, dust: 7, essence: 2 };
  ch.potions = 8;
  ch.scrolls = 4;
  ch.skills = { ranks: { groundStomp: 3, weaponMastery: 2, earthquake: 2, warCry: 1 }, bar: ['groundStomp', 'earthquake', null, 'warCry', null] };
  ch.equip.helm = mk('helm', { ilvl: 9, rarity: 'legendary', legendaryId: 'ragingHorn', affixes: [{ id: 'vit', tier: 2, value: 9 }, { id: 'skillDmg', tier: 1, value: 10, param: 'charge' }] });
  ch.equip.ring1 = mk('ring', { ilvl: 8, rarity: 'magic', affixes: [{ id: 'critChance', tier: 2, value: 2.5 }] });
  ch.equip.boots = mk('boots', { ilvl: 7, rarity: 'set', setPieceId: 'ironLordGreaves', affixes: [{ id: 'moveSpeed', tier: 1, value: 5 }] });
  ch.equip.boots.dur = 30;
  ch.equip.boots.rerollIdx = 0;
  ch.equip.boots.rerolls = 2;
  ch.bag[0] = mk('greatsword', { ilvl: 10, rarity: 'rare', affixes: [{ id: 'weaponDmg', tier: 2, value: 18 }, { id: 'lifeOnHit', tier: 1, value: 1.4 }] });
  ch.bag[0].name = ['rare.a.3', 'rare.b.7'];
  ch.bag[0].flags.locked = true;
  ch.bag[17] = mk('belt', { ilvl: 3 });
  ch.bag[BAG_SIZE - 1] = mk('shield', { ilvl: 5, rarity: 'magic', affixes: [{ id: 'armor', tier: 1, value: 5 }] });
  ch.riftUnlocked = 9;
  ch.lastRiftLevel = 8;
  ch.best = { 7: { timeSec: 380.5, deaths: 0 }, 8: { timeSec: 410, deaths: 1 } };
  ch.records = [{ level: 8, seed: 11, tileset: 'cavern', cls, result: 'complete', timeSec: 410, kills: { normal: 280, champion: 12, elite: 2, minion: 8, guardian: 1, other: 3 },
    deaths: 1, drops: { normal: 18, magic: 14, rare: 5, legendary: 1, set: 0 }, gold: 1500, xp: 9000, upgrades: 2, recalls: 1, maxTargeting: 31, swarmMoments: 4,
    unlockedTo: 9, noDeath: false, record: true, at: 5000, charLevel: 12 }];
  ch.blp = { count: 57 };
  const sold = mk('gloves', { ilvl: 6, rarity: 'magic', affixes: [{ id: 'attackSpeed', tier: 1, value: 4 }] });
  ch.buyback = [{ item: sold, price: priceSell(sold) }];
  ch.shop.blacksmith = [mk('axe', { ilvl: 8, rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 11 }] }), mk('chest', { ilvl: 8, rarity: 'rare' })];
  ch.shop.general = [mk('amulet', { ilvl: 8, rarity: 'magic' }), mk('ring', { ilvl: 8, rarity: 'magic' })];
  ch.shop.restocks = 6;
  ch.shop.stockRun = 5;
  ch.shop.reroll = { itemId: ch.bag[0].id, where: 'bag', idx: 0, affixIdx: 1, options: [], cost: { gold: 1, dust: 1, essence: 0 } };
  ch.hints = { town: true, controls: true, skills: true };
  ch.playSec = 7777.5;
  ch.runs = 5;
  for (let i = 0; i < 6; i++) state.account.stash[i * 3] = mk(['helm', 'wand', 'orb', 'ring', 'boots', 'staff'][i], { ilvl: 2 + i, rarity: i % 2 ? 'magic' : 'normal' });
  state.account.lastSlot = 2;
  return { state, ctx, ch, mk };
}

/** 캐릭터 · 보관함의 모든 아이템 ID */
function idsOf(account, chars) {
  const ids = [];
  for (const ch of chars) {
    if (!ch) continue;
    for (const s of EQUIP_SLOTS) if (ch.equip[s]) ids.push(ch.equip[s].id);
    for (const it of ch.bag) if (it) ids.push(it.id);
    for (const it of ch.shop.blacksmith) ids.push(it.id);
    for (const it of ch.shop.general) ids.push(it.id);
    for (const e of ch.buyback) ids.push(e.item.id);
  }
  for (const it of account.stash) if (it) ids.push(it.id);
  return ids;
}
const idNum = (id) => Number(id.slice(1));

// ───────────────────────── 왕복 ─────────────────────────

test('직렬화 왕복: 캐릭터(상점 재고 · 되사기 · 기록 · 최고 기록 · 스킬 · 내구도 · 재굴림 고정 포함) → JSON → loadChar 가 같다 · 재굴림 제안만 빠진다', () => {
  const { ch } = richState();
  const save = serializeChar(ch);
  assert.equal(save.v, SAVE_VERSION);
  assert.equal(save.game, GAME_ID);
  assert.equal('reroll' in save.char.shop, false, '재굴림 제안은 저장하지 않는다');
  assert.equal(save.char.shop.blacksmith.length, 2, '재고는 저장한다(새로 고침으로 재고가 바뀌지 않게)');
  const r = loadChar(JSON.stringify(save), 2);
  assert.equal(r.broken, false);
  assert.equal(r.reason, null);
  const want = structuredClone(ch);
  want.shop.reroll = null;
  assert.deepEqual(r.char, want);
  // 두 번째 왕복도 같다(정화가 값을 흔들지 않는다)
  assert.deepEqual(loadChar(JSON.stringify(serializeChar(r.char)), 2).char, want);
});

test('계정 왕복: 보관함 · 칸 요약 · nextItemId · lastSlot — 지금 캐릭터 요약은 지금 값 · nextItemId ≥ 가진 번호 최대 + 1', () => {
  const { state, ch } = richState();
  ch.level = 14;   // 계정 요약이 낡았어도 저장할 때 지금 값으로
  state.account.nextItemId = 3;   // 낡은 값이어도
  const save = serializeAccount(state);
  assert.equal(save.chars[2].level, 14);
  const maxId = Math.max(...idsOf(state.account, [ch]).map(idNum));
  assert.equal(save.nextItemId, maxId + 1);
  const r = loadAccount(JSON.stringify(save));
  assert.equal(r.broken, false);
  assert.deepEqual(r.account.stash, state.account.stash);
  assert.deepEqual(r.account.chars, save.chars);
  assert.equal(r.account.nextItemId, maxId + 1);
  assert.equal(r.account.lastSlot, 2);
  assert.equal(r.account.stash.length, STASH_SIZE);
});

test('드랍 100개 → 캐릭터 저장(계정 함께) → 다시 읽기 → 새 아이템 ID 가 가방 · 보관함 · 장착의 ID 와 겹치지 않는다(계정이 캐릭터보다 낡아도)', () => {
  const state = makeTestState({ scene: 'rift' });
  const ctx = makeTestCtx(state);
  state.char = createCharacter({ slot: 0, cls: 'mage', name: 'D', newId: ctx.newItemId, seed: 3 });
  const ch = state.char;
  let n = 0;
  // 가방 + 보관함을 꽉(피드백 2 D4: 가방 30 — 옛 40 + 60 = 100 은 이제 30 + 60 = 90)
  for (let k = 0; k < BAG_SIZE + STASH_SIZE; k++) {
    const it = makeItem({ baseId: ['helm', 'wand', 'ring', 'boots'][k % 4], id: ctx.newItemId(), ilvl: 1 + (k % 5) });
    if (k < BAG_SIZE) ch.bag[k] = it;
    else state.account.stash[k - BAG_SIZE] = it;
    n++;
  }
  assert.equal(n, BAG_SIZE + STASH_SIZE);
  assert.equal(state.account.stash.length, STASH_SIZE, '보관함 밖에 쓰지 않았다');
  // 계정만 먼저 저장되고(낡음), 그 뒤 캐릭터가 10개를 더 주운 채 저장된 경우까지
  const accountOld = JSON.stringify(serializeAccount(state));
  for (let k = 0; k < 10; k++) { ch.bag[k] = null; ch.bag[k] = makeItem({ baseId: 'belt', id: ctx.newItemId() }); }
  const charRaw = JSON.stringify(serializeChar(ch));
  for (const accRaw of [JSON.stringify(serializeAccount(state)), accountOld]) {
    const A = loadAccount(accRaw).account;
    const C = loadChar(charRaw, 0).char;
    dedupeItemIds(A, [C]);
    const s2 = createGameState({ seed: 9, account: A });
    s2.char = C;
    const ctx2 = makeTestCtx(s2);
    const existing = new Set(idsOf(A, [C]));
    for (let k = 0; k < 50; k++) {
      const id = ctx2.newItemId();
      assert.ok(!existing.has(id), `새 ID ${id} 가 겹친다`);
      existing.add(id);
    }
  }
});

// ───────────────────────── 깨진 세이브 · 버전 ─────────────────────────

test('깨진 세이브: JSON 아님 · 모양 아님 · 다른 게임 · 버전 없음 → broken(새 계정 · 캐릭터 null) · 없으면 broken 아님 · throw 0', () => {
  for (const raw of [null, undefined, '']) {
    const a = loadAccount(raw);
    assert.equal(a.broken, false);
    assert.deepEqual(a.account, createAccount());
    const c = loadChar(raw, 0);
    assert.deepEqual([c.char, c.broken], [null, false]);
  }
  const bad = [['{not json', 'json'], ['[]', 'shape'], ['42', 'shape'], ['"str"', 'shape'], ['null', 'shape'],
    [JSON.stringify({ v: 1, game: 'other', chars: [] }), 'game'], [JSON.stringify({ game: GAME_ID }), 'version'], [JSON.stringify({ v: 'x', game: GAME_ID }), 'version']];
  for (const [raw, reason] of bad) {
    const a = loadAccount(raw);
    assert.equal(a.broken, true, raw);
    assert.equal(a.reason, reason, raw);
    assert.deepEqual(a.account, createAccount());
    const c = loadChar(raw, 1);
    assert.equal(c.broken, true, raw);
    assert.equal(c.char, null);
  }
  // 캐릭터 꼴이 아님 · 모르는 클래스
  assert.equal(loadChar(JSON.stringify({ v: 1, game: GAME_ID }), 0).broken, true);
  assert.equal(loadChar(JSON.stringify({ v: 1, game: GAME_ID, char: { cls: 'rogue' } }), 0).reason, 'class');
  // 이상한 타입도 throw 하지 않는다
  for (const raw of [123, {}, [], true, () => 1, Symbol.iterator]) {
    assert.doesNotThrow(() => loadAccount(/** @type {any} */ (raw)));
    assert.doesNotThrow(() => loadChar(/** @type {any} */ (raw), 0));
  }
});

test('버전 이주 자리: 지금 버전은 그대로 · 미래 버전은 읽되 future(덮어쓰지 않는다) · 이주 표에 없는 옛 버전은 broken version', () => {
  const { state, ch } = richState();
  const acc = serializeAccount(state);
  const future = loadAccount(JSON.stringify({ ...acc, v: SAVE_VERSION + 1 }));
  assert.equal(future.broken, false);
  assert.equal(future.future, true);
  assert.equal(future.reason, 'future');
  assert.deepEqual(future.account.stash, state.account.stash);
  const cs = serializeChar(ch);
  const fc = loadChar(JSON.stringify({ ...cs, v: SAVE_VERSION + 3 }), 2);
  assert.equal(fc.future, true);
  assert.equal(fc.char.name, 'Saver');
  const old = loadChar(JSON.stringify({ ...cs, v: 0 }), 2);
  assert.deepEqual([old.char, old.broken, old.reason], [null, true, 'version']);
});

// ───────────────────────── 정화 ─────────────────────────

test('sanitizeItem: 모르는 기본형 → null · 모르는 옵션 · 숫자 아닌 값은 뺀다 · 가치 · 부위 · 클래스 · 요구 레벨은 다시 계산 · 전설/세트 ID 가 안 맞으면 희귀', () => {
  const good = makeItem({ baseId: 'axe', id: 'i7', ilvl: 6, rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 12 }] });
  assert.deepEqual(sanitizeItem(JSON.parse(JSON.stringify(good))), good);
  assert.equal(sanitizeItem({ ...good, baseId: 'laserSword' }), null);
  for (const raw of [null, undefined, 'x', 5, [], { baseId: 'constructor' }, { baseId: '__proto__' }]) assert.equal(sanitizeItem(raw), null);

  const dirty = {
    ...JSON.parse(JSON.stringify(good)),
    slot: 'ring', cls: 'mage', reqLevel: 1, value: 999999, ilvl: '6',
    affixes: [{ id: 'str', tier: 2, value: 12 }, { id: 'bogus', tier: 1, value: 3 }, { id: 'vit', tier: 1, value: 'many' }, { id: 'cdr', tier: 9, value: 2 },
      { id: 'skillDmg', tier: 1, value: 10 }, { id: 'skillDmg', tier: 1, value: 10, param: 'notANode' }, { id: 'lifeOnHit', tier: 1, value: 0.7 }],
    dur: 250, durMax: 5, rerollIdx: 7, rerolls: -3, flags: { locked: true, hacked: true, bought: 'yes' },
    base: { dmg: ['a', 3], aps: -1, extra: 5 }, name: [42],
  };
  const s = sanitizeItem(dirty);
  assert.equal(s.slot, 'mainHand');
  assert.equal(s.cls, 'warrior');
  assert.equal(s.ilvl, 1, '숫자 아닌 ilvl → 1');
  assert.equal(s.reqLevel, s.ilvl);
  assert.deepEqual(s.affixes, [{ id: 'str', tier: 2, value: 12 }, { id: 'lifeOnHit', tier: 1, value: 0.7 }]);
  assert.equal(s.value, makeItem({ baseId: 'axe', id: 'x', ilvl: 1, rarity: 'magic' }).value, '가치는 다시 계산(판매가를 고쳐 쓴 세이브가 이득을 보지 않는다)');
  assert.equal(s.dur, s.durMax);
  assert.equal(s.durMax, 100);
  assert.equal(s.rerollIdx, null);
  assert.equal(s.rerolls, 0);
  assert.deepEqual(s.flags, { locked: true });
  assert.deepEqual(Object.keys(s.base).sort(), ['aps', 'dmg']);
  assert.ok(s.base.aps > 0 && s.base.dmg[1] > s.base.dmg[0]);
  assert.ok(Array.isArray(s.name) && s.name.every(k => typeof k === 'string'));
  assertFiniteDeep(s, 'item');

  const leg = sanitizeItem({ ...JSON.parse(JSON.stringify(good)), baseId: 'helm', rarity: 'legendary', legendaryId: 'piercingFlame' });
  assert.equal(leg.rarity, 'rare', '전설 ID 가 그 기본형이 아니면 희귀로');
  assert.equal(leg.legendaryId, undefined);
  const set = sanitizeItem({ ...JSON.parse(JSON.stringify(good)), baseId: 'boots', rarity: 'set', setPieceId: 'ashSageSteps' });
  assert.equal(set.rarity, 'set');
  assert.equal(set.setId, 'ashSage');
  assert.equal(sanitizeItem({ ...good, id: 77 }).id, '', '문자열 아닌 ID 는 비우고 dedupeItemIds 가 새로 준다');
});

test('캐릭터 정화: 숫자 아닌 값 · 범위 밖 · 모르는 노드 · 못 하는 스킬 배분 · 안 맞는 장착 · 양손 + 보조 · 되사기 값 · 기록 쓰레기', () => {
  const { ch } = richState();
  const raw = serializeChar(ch);
  const c = raw.char;
  Object.assign(c, { gold: 'lots', potions: 99, scrolls: -2, level: 99, xp: 1e12, riftUnlocked: 0, lastRiftLevel: 'x', playSec: -5, runs: 2.7, name: 12, seed: 'seed' });
  c.materials = { scrap: -1, dust: 3.6, essence: 'e', mithril: 5 };
  c.skills = { ranks: { groundStomp: 9, fireball: 2, ghostNode: 1 }, bar: ['fireball', 'groundStomp', 'groundStomp', 7, null, 'extra'] };
  c.equip.offhand = JSON.parse(JSON.stringify(makeItem({ baseId: 'shield', id: 'i9001' })));
  c.equip.mainHand = JSON.parse(JSON.stringify(makeItem({ baseId: 'greataxe', id: 'i9002' })));
  c.equip.gloves = JSON.parse(JSON.stringify(makeItem({ baseId: 'wand', id: 'i9003' })));   // 부위가 안 맞는다
  c.buyback[0].price = 1;
  c.records = [null, 5, { level: 'x' }, c.records[0], { level: 3, kills: 'many', drops: null, result: 'win' }];
  c.hints = { town: true, hacked: true, skills: 'yes' };
  c.best = { 3: { timeSec: -1 }, abc: { timeSec: 5 }, 4: { timeSec: 300, deaths: 'x' } };
  const r = loadChar(JSON.stringify(raw), 1);
  assert.equal(r.broken, false);
  const s = r.char;
  assert.equal(s.slot, 1, '칸은 인자 그대로');
  assert.equal(s.gold, 0);
  assert.equal(s.potions, ECON.potionMax);
  assert.equal(s.scrolls, 0);
  assert.equal(s.level, 30);
  assert.equal(s.xp, 0, '캡이면 0');
  assert.equal(s.riftUnlocked, 1);
  assert.equal(s.lastRiftLevel, 1);
  assert.equal(s.playSec, 0);
  assert.equal(s.runs, 2);
  assert.equal(s.name, '');
  assert.equal(s.seed, 1);
  assert.deepEqual(s.materials, { scrap: 0, dust: 3, essence: 0 });
  assert.deepEqual(s.skills.ranks, { groundStomp: 5 }, '모르는 · 다른 클래스 노드는 빼고 랭크는 최대까지');
  assert.deepEqual(s.skills.bar, [null, 'groundStomp', null, null, null]);
  assert.equal(s.equip.mainHand.baseId, 'greataxe');
  assert.equal(s.equip.offhand, null, '양손 무기와 겹친 보조는 가방으로');
  assert.equal(s.equip.gloves, null);
  assert.ok(s.bag.some(it => it && it.id === 'i9001') && s.bag.some(it => it && it.id === 'i9003'), '안 맞는 장착은 가방으로');
  assert.equal(s.buyback[0].price, priceSell(s.buyback[0].item), '되사기 값은 판매가로 다시');
  assert.equal(s.records.length, 2);
  assert.deepEqual(s.records[0], ch.records[0]);
  assert.equal(s.records[1].result, 'abandon');
  assert.deepEqual(s.hints, { town: true });
  assert.deepEqual(s.best, { 4: { timeSec: 300, deaths: 0 } });
  assert.equal(s.shop.reroll, null);
  assert.equal(s.bag.length, BAG_SIZE);
  assertFiniteDeep(s, 'char');

  // 레벨에 비해 포인트를 너무 많이 쓴 · 단계를 건너뛴 · req 없는 변형 배분은 전부 돌려준다
  for (const ranks of [{ groundStomp: 5, weaponMastery: 5 }, { earthquake: 1 }, { weaponMastery: 5, earthquake: 3, aftershock: 1 }]) {
    const raw2 = serializeChar({ ...ch, level: 10, skills: { ranks, bar: [null, null, null, null, null] } });
    assert.deepEqual(loadChar(JSON.stringify(raw2), 2).char.skills.ranks, {}, JSON.stringify(ranks));
  }
  const okRanks = { weaponMastery: 5, earthquake: 3, groundStomp: 1 };
  const raw3 = serializeChar({ ...ch, level: 10, skills: { ranks: okRanks, bar: ['earthquake', null, null, null, null] } });
  assert.deepEqual(loadChar(JSON.stringify(raw3), 2).char.skills.ranks, okRanks, '규칙을 지킨 배분은 그대로');
});

test('퍼즈: 정상 세이브를 무작위로 망가뜨려 600번 — throw 0 · 결과는 null 이거나 유한수 · 정해진 모양 · 다시 저장 → 읽기가 같다', () => {
  const { ch, state } = richState();
  const base = serializeChar(ch);
  const acc = serializeAccount(state);
  const rng = makeRng(seedRng(2024));
  const junk = () => [null, 0, -1, 1e308, 'x', '', true, [], {}, [1, 2], { a: 1 }, 3.5, 'i1'][rng.int(0, 12)];
  /** 객체 트리에서 무작위 경로 하나를 바꾸거나 지운다 */
  const mutate = (obj) => {
    let cur = obj;
    for (let d = 0; d < 6; d++) {
      const keys = cur && typeof cur === 'object' ? Object.keys(cur) : [];
      if (!keys.length) return;
      const k = keys[rng.int(0, keys.length - 1)];
      if (rng.chance(0.35) || !cur[k] || typeof cur[k] !== 'object') {
        if (rng.chance(0.3)) delete cur[k];
        else cur[k] = junk();
        return;
      }
      cur = cur[k];
    }
  };
  for (let k = 0; k < 600; k++) {
    const c = structuredClone(base);
    const a = structuredClone(acc);
    for (let m = rng.int(1, 6); m > 0; m--) { mutate(c); mutate(a); }
    let rc, ra;
    assert.doesNotThrow(() => { rc = loadChar(JSON.stringify(c), 2); ra = loadAccount(JSON.stringify(a)); }, `#${k}`);
    if (rc.char) {
      assertFiniteDeep(rc.char, `char #${k}`);
      assert.equal(rc.char.bag.length, BAG_SIZE);
      assert.deepEqual(Object.keys(rc.char.equip), EQUIP_SLOTS);
      assert.equal(rc.char.skills.bar.length, 5);
      assert.ok(rc.char.gold >= 0 && Number.isInteger(rc.char.gold));
      assert.deepEqual(loadChar(JSON.stringify(serializeChar(rc.char)), 2).char, rc.char, `안정 #${k}`);
    }
    assertFiniteDeep(ra.account, `account #${k}`);
    assert.equal(ra.account.stash.length, STASH_SIZE);
    assert.equal(ra.account.chars.length, CHAR_SLOTS);
    const ids = idsOf(ra.account, []);
    assert.equal(new Set(ids).size, ids.length, `보관함 ID 중복 #${k}`);
  }
});

// ───────────────────────── ID 정리 · 계정 복구 ─────────────────────────

test('dedupeItemIds: 겹치면 뒤의 것(보관함 쪽)을 새 ID 로 · 꼴이 다른 ID 도 · nextItemId = max(지금, 최대 + 1) · 바꿀 게 없으면 changed false', () => {
  const account = createAccount();
  const a = createCharacter({ slot: 0, cls: 'warrior', name: 'A', newId: (() => { let n = 1; return () => 'i' + n++; })() });   // i1 · i2
  const b = createCharacter({ slot: 1, cls: 'mage', name: 'B', newId: (() => { let n = 2; return () => 'i' + n++; })() });     // i2 · i3
  a.bag[0] = makeItem({ baseId: 'helm', id: 'i10' });
  account.stash[5] = makeItem({ baseId: 'belt', id: 'i10' });
  account.stash[6] = makeItem({ baseId: 'belt', id: 'banana' });
  account.stash[7] = makeItem({ baseId: 'belt', id: '' });
  account.nextItemId = 4;
  const r = dedupeItemIds(account, [a, null, b]);
  assert.equal(r.changed, true);
  const ids = idsOf(account, [a, b]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(a.bag[0].id, 'i10', '앞의 것(캐릭터)은 그대로');
  assert.equal(a.equip.mainHand.id, 'i1');
  assert.ok(ids.every(id => /^i\d+$/.test(id)));
  assert.ok(account.nextItemId > Math.max(...ids.map(idNum)));
  assert.deepEqual(dedupeItemIds(account, [a, b]), { changed: false });
  assert.doesNotThrow(() => dedupeItemIds(null, null));
  const acc2 = createAccount();
  acc2.nextItemId = 50;
  assert.deepEqual(dedupeItemIds(acc2, []), { changed: false });
  assert.equal(acc2.nextItemId, 50, '줄이지 않는다');
});

test('rebuildAccount: 계정만 깨졌을 때 칸 0..3 의 캐릭터 세이브로 목록 복원 · lastSlot · nextItemId = 최대 + 1 · 캐릭터 사이 ID 충돌 0 · 보관함은 빈 채', () => {
  const s0 = richState({ cls: 'warrior' });
  const s2 = richState({ cls: 'mage' });   // 같은 순서로 ID 를 받아 s0 과 ID 가 겹친다
  s2.ch.name = 'Mage';
  const raw0 = JSON.stringify(serializeChar({ ...s0.ch, slot: 0 }));
  const raw2 = JSON.stringify(serializeChar({ ...s2.ch, slot: 2 }));
  const before = new Set(idsOf(createAccount(), [loadChar(raw0, 0).char]));
  const overlap = idsOf(createAccount(), [loadChar(raw2, 2).char]).filter(id => before.has(id));
  assert.ok(overlap.length > 0, '시험 전제: 두 캐릭터의 ID 가 겹친다');

  const { account, chars } = rebuildAccount([raw0, null, raw2, '{broken']);
  assert.equal(chars.length, CHAR_SLOTS);
  assert.equal(chars[0].name, 'Saver');
  assert.equal(chars[1], null);
  assert.equal(chars[2].name, 'Mage');
  assert.equal(chars[3], null, '깨진 칸은 비운다');
  assert.deepEqual(account.chars[0], summaryOf(chars[0]));
  assert.equal(account.chars[0].level, 12);
  assert.deepEqual(account.chars[2], summaryOf(chars[2]));
  assert.equal(account.chars[1], null);
  assert.equal(account.lastSlot, 0);
  assert.ok(account.stash.every(x => x === null), '보관함은 빈 채(백업에 있다)');
  const ids = idsOf(account, chars);
  assert.equal(new Set(ids).size, ids.length, 'ID 충돌 0');
  assert.equal(account.nextItemId, Math.max(...ids.map(idNum)) + 1);
  // 그 계정으로 새 아이템을 만들어도 겹치지 않는다
  const st = createGameState({ seed: 1, account });
  st.char = chars[2];
  const ctx = makeTestCtx(st);
  for (let k = 0; k < 20; k++) assert.ok(!ids.includes(ctx.newItemId()));
  // 아무것도 없으면 빈 계정
  const empty = rebuildAccount([]);
  assert.deepEqual(empty.account, createAccount());
  assert.deepEqual(rebuildAccount(null).chars, [null, null, null, null]);
});

test('createCharacter → 저장 → 읽기: 새 캐릭터 그대로 · xp 는 그 레벨 필요량 안', () => {
  let n = 1;
  const ch = createCharacter({ slot: 3, cls: 'mage', name: 'New', newId: () => 'i' + n++, seed: 99 });
  const r = loadChar(JSON.stringify(serializeChar(ch)), 3);
  assert.deepEqual(r.char, ch);
  const big = serializeChar({ ...ch, level: 5, xp: 99999 });
  assert.equal(loadChar(JSON.stringify(big), 3).char.xp, xpReq(5) - 1);
});

// 피드백 1: 스킬 노드 ID 는 세이브에 들어 있다 — 지면 강타(groundStomp) · 여진(aftershock) · 강타(bash) 의 ID 는 그대로 두고 동작만 회전 베기 · 연속 회전 · 가르기로 바꿨다.
test('피드백 1 세이브 호환: 옛 세이브(같은 SAVE_VERSION)의 groundStomp · aftershock 랭크와 스킬 바가 그대로 읽히고, 그 칸이 회전 베기(spinSlash)로 돈다', async () => {
  const { getNode, getSkillDef } = await import('../src/data/index.js');
  const { skillParams } = await import('../src/sim/player/skills.js');
  const { CLASSES } = await import('../src/data/classes.js');
  const { ch } = richState();
  // 피드백 1 전의 세이브가 담던 그대로(레벨 15 · 14점: 지면 강타 5 · 무기 숙련 5 · 여진 1 · 지진 2 · 바 0 = 지면 강타)
  const raw = serializeChar({ ...ch, level: 15, skills: { ranks: { groundStomp: 5, weaponMastery: 5, aftershock: 1, earthquake: 2 }, bar: ['groundStomp', 'earthquake', null, null, null] } });
  assert.equal(raw.v ?? raw.version ?? SAVE_VERSION, SAVE_VERSION);
  const r = loadChar(JSON.stringify(raw), 0);
  assert.equal(r.broken, false);
  assert.deepEqual(r.char.skills.ranks, { groundStomp: 5, weaponMastery: 5, aftershock: 1, earthquake: 2 }, '랭크 그대로(이전 없음)');
  assert.deepEqual(r.char.skills.bar, ['groundStomp', 'earthquake', null, null, null], '바 그대로');
  assert.equal(getNode('groundStomp').skill.behavior, 'spinSlash');
  assert.equal(getSkillDef(CLASSES.find(c => c.id === 'warrior').basic).behavior, 'cleave', '기본 공격 bash = 가르기');
  const state = makeTestState({ cls: 'warrior' });
  state.char = r.char;
  const ctx = makeTestCtx(state);
  assert.deepEqual(skillParams(ctx, 'groundStomp').aftershock, { delay: 0.5, mul: 0.6 }, '여진 랭크 → 연속 회전 패치');
});
