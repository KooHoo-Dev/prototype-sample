// OWNER: P11 — 계약 §12.2(ui.panels) · §10.6
// itemText(툴팁 줄 · 고급 티어 범위 · 비교 색 방향)와 패널이 고르는 순수 규칙(pnlLogic — 일괄 판매 대상 · 균열석 기본 포커스 · 부분 수리 ·
// 스킬 트리 배치 · 노드 전/후 · 제작 분포 · 남은 전리품 · 확인 필요 여부)을 본다. 패널 모듈은 import 만으로 DOM 을 건드리지 않는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_IDS, EQUIP_SLOTS, ITEM_SLOTS } from '../src/core/constants.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { ITEM_AFFIXES_BY_ID, nodesOf } from '../src/data/index.js';
import { RIFT, GROWTH } from '../src/data/rift.js';
import { REPAIR_ORDER } from '../src/data/economy.js';
import { FIXTURES } from '../src/debug/fixtures.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { compareEquip, isUpgrade } from '../src/sim/loot/compare.js';
import { computeStats } from '../src/sim/loot/stats.js';
import { priceSell, repairAll } from '../src/sim/progression/shops.js';
import { makeTestChar, makeTestCtx, makeTestState } from './helpers.js';
import { affixLine, affixRange, compareLines, itemLines, lineText } from '../src/ui/itemText.js';
import {
  bulkSellPlan, craftDist, defaultRiftLevel, leftLootCount, mysticEquipList, needsCloseConfirm, nodeStatRows, repairPlan, riftListMax,
  salvageNormalRefs, skillLayout,
} from '../src/ui/pnlLogic.js';
// 패널 · 조각 모듈 — import 시점에 DOM 을 건드리지 않는다(§0.5)
import { createInventoryPanel } from '../src/ui/panels/inventory.js';
import { createSkillsPanel } from '../src/ui/panels/skills.js';
import { createCharacterPanel } from '../src/ui/panels/character.js';
import { createBlacksmithPanel } from '../src/ui/panels/blacksmith.js';
import { createGeneralPanel } from '../src/ui/panels/general.js';
import { createGamblerPanel } from '../src/ui/panels/gambler.js';
import { createMysticPanel } from '../src/ui/panels/mystic.js';
import { createStashPanel } from '../src/ui/panels/stash.js';
import { createRiftStonePanel } from '../src/ui/panels/riftStone.js';
import { createTooltip, itemCard } from '../src/ui/tooltip.js';
import { createAreas, createBagGrid, createItemGrid, createItemList } from '../src/ui/pnlBagGrid.js';

const own = Object.prototype.hasOwnProperty;
let seq = 1;
/** @param {Object} o */
const mk = (o) => makeItem({ id: 'u' + seq++, ...o });

/** 줄이 쓰는 문자열 키가 전부 있다 @param {any} ln */
function keysOf(ln) {
  const out = [];
  if (ln.key) out.push(ln.key);
  if (ln.keys) out.push(...ln.keys);
  if (ln.parts) out.push(...ln.parts);
  if (ln.label) out.push(...ln.label);
  if (ln.pkeys) out.push(...Object.values(ln.pkeys));
  return out;
}

test('패널 모듈은 import 만으로 DOM 을 건드리지 않고 계약 이름을 낸다(§10.1)', () => {
  for (const fn of [createInventoryPanel, createSkillsPanel, createCharacterPanel, createBlacksmithPanel, createGeneralPanel,
    createGamblerPanel, createMysticPanel, createStashPanel, createRiftStonePanel, createTooltip, itemCard, createAreas, createBagGrid, createItemGrid, createItemList]) {
    assert.equal(typeof fn, 'function');
  }
});

test('itemLines — 이름(등급색) · 등급 · 부위 · 기본형 · 기본 값 · 옵션 · 요구 레벨 · 판매가(§10.6)', () => {
  const char = makeTestChar({ level: 5 });
  const it = mk({ baseId: 'chest', tier: 1, ilvl: 20, rarity: 'rare', affixes: [{ id: 'armor', tier: 3, value: 50 }, { id: 'vit', tier: 3, value: 18 }, { id: 'lifePct', tier: 3, value: 8 }] });
  it.name = ['rare.a.17', 'rare.b.20'];
  const lines = itemLines(it, { char });
  const name = lines.find((l) => l.kind === 'name');
  assert.deepEqual(name.keys, ['rare.a.17', 'rare.b.20']);
  assert.equal(name.cls, 'r-rare');
  assert.deepEqual(lines.find((l) => l.kind === 'sub').parts, ['rarity.rare', 'islot.chest']);
  assert.equal(lines.find((l) => l.kind === 'base').key, 'base.chest.1', '희귀는 이름이 기본형을 담지 않는다 — 기본형 줄');
  const armor = lines.find((l) => l.kind === 'stat' && l.label?.[0] === 'stat.armor');
  assert.equal(armor.value, String(it.base.armor));
  const aff = lines.filter((l) => l.kind === 'affix');
  assert.deepEqual(aff.map((l) => l.key), ['afx.armor.line', 'afx.vit.line', 'afx.lifePct.line']);
  assert.deepEqual(aff.map((l) => l.params.v), ['50', '18', '8']);
  assert.ok(aff.every((l) => !l.adv), '고급이 아니면 범위 없음');
  const req = lines.find((l) => l.kind === 'req');
  assert.equal(req.params.n, 20);
  assert.equal(req.bad, true, '레벨 5 캐릭터는 요구 레벨 20을 못 낀다 — 붉게');
  const price = lines.find((l) => l.kind === 'price');
  assert.equal(price.key, 'inv.sellPrice');
  assert.equal(price.params.n, String(priceSell(it)));
  // 일반 등급은 이름이 곧 기본형 — 기본형 줄 없음 · 무기 피해 · aps
  const sword = mk({ baseId: 'sword', ilvl: 1 });
  const sl = itemLines(sword, { char });
  assert.ok(!sl.some((l) => l.kind === 'base'));
  const dmg = sl.find((l) => l.key === 'skill.dmg');
  assert.deepEqual(dmg.params, { a: String(sword.base.dmg[0]), b: String(sword.base.dmg[1]) });
  assert.ok(sl.some((l) => l.label?.[0] === 'stat.aps'));
  assert.equal(sl.find((l) => l.kind === 'req').bad, false);
  assert.deepEqual(itemLines(null), []);
  assert.deepEqual(itemLines(/** @type {any} */ ('x')), []);
});

test('itemLines — 고급 툴팁: 옵션마다 티어와 그 ilvl 의 값 범위(pow 는 GROWTH.item^(ilvl−1)) · lineText 의 [티어 n a–b]', () => {
  const it = mk({ baseId: 'chest', tier: 1, ilvl: 20, rarity: 'rare', affixes: [{ id: 'armor', tier: 3, value: 50 }, { id: 'vit', tier: 3, value: 18 }, { id: 'lifeRegen', tier: 2, value: 7.1 }] });
  const lines = itemLines(it, { advanced: true }).filter((l) => l.kind === 'affix');
  // flat: 활력 T3 13–20 그대로
  assert.deepEqual(lines[1].adv, { t: 3, a: '13', b: '20' });
  // pow: 방어도 T3 10–15 × 1.1^19 → 정수
  const k = GROWTH.item ** 19;
  assert.deepEqual(lines[0].adv, { t: 3, a: String(Math.round(10 * k)), b: String(Math.round(15 * k)) });
  assert.deepEqual(affixRange('armor', 3, 20), [Math.round(10 * k), Math.round(15 * k)]);
  // pow · 소수 한 자리: 초당 생명 회복 T2 1.0–1.6
  assert.deepEqual(affixRange('lifeRegen', 2, 20), [Math.round(1.0 * k * 10) / 10, Math.round(1.6 * k * 10) / 10]);
  assert.equal(lines[2].adv.a, String(Math.round(1.0 * k * 10) / 10));
  // ilvl 1 이면 배율 1
  assert.deepEqual(affixRange('armor', 1, 1), [3, 6]);
  assert.equal(affixRange('nope', 1, 1), null);
  // 문면: 「방어도 +50 [티어 3 a–b]」
  const s = lineText(lines[0]);
  assert.ok(s.startsWith(STRINGS['afx.armor.line'].replace('{v}', '50')), s);
  assert.ok(s.includes('[' + STRINGS['inv.tier'].replace('{t}', '3') + ' '), s);
  assert.ok(s.endsWith(']'), s);
  // 모든 옵션 · 모든 티어 · 여러 ilvl 에서 범위가 유한하고 a ≤ b · 그 티어 행의 값을 담는다(flat)
  for (const id of Object.keys(ITEM_AFFIXES_BY_ID)) {
    const def = ITEM_AFFIXES_BY_ID[id];
    for (let t = 1; t <= def.tiers.length; t++) {
      for (const lv of [1, 7, 30]) {
        const r = affixRange(id, t, lv);
        assert.ok(r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] <= r[1], `${id} T${t} L${lv}`);
        if (def.scale === 'flat') assert.deepEqual(r, def.tiers[t - 1]);
      }
    }
  }
});

test('itemLines — 전설 효과 · 세트 이름(낀 조각 수) · 세트 효과 켬/끔 · 클래스 · 내구도 · 잠김 · skillPct 의 스킬 이름', () => {
  const char = makeTestChar({ level: 30 });
  const leg = mk({ baseId: 'greatsword', ilvl: 9, rarity: 'legendary', legendaryId: 'emberMaelstrom', affixes: [{ id: 'str', tier: 2, value: 12 }] });
  const ll = itemLines(leg, { char });
  assert.equal(ll.find((l) => l.kind === 'legend').key, 'legfx.emberMaelstrom');
  assert.equal(ll.find((l) => l.kind === 'class').key, 'class.warrior');
  assert.equal(ll.find((l) => l.kind === 'class').bad, false);
  const set = mk({ baseId: 'gloves', ilvl: 9, rarity: 'set', setPieceId: 'ironLordGrips', affixes: [{ id: 'armor', tier: 2, value: 10 }] });
  const sl = itemLines(set, { char, setCounts: { ironLord: 2 } });
  assert.deepEqual(sl.find((l) => l.kind === 'set').label, ['set.ironLord']);
  assert.equal(sl.find((l) => l.kind === 'set').value, STRINGS['inv.setCount'].replace('{n}', '2'));
  const bonus = sl.filter((l) => l.kind === 'setBonus');
  assert.deepEqual(bonus.map((b) => [b.key, b.cls]), [['set.ironLord.b2', 'on'], ['set.ironLord.b4', 'off']]);
  // 다른 클래스 · 내구도 0 · 잠김
  const wand = mk({ baseId: 'wand', ilvl: 1 });
  wand.dur = 0;
  wand.flags.locked = true;
  const wl = itemLines(wand, { char });
  assert.equal(wl.find((l) => l.kind === 'class').bad, true);
  assert.equal(wl.find((l) => l.kind === 'durZero').bad, true);
  assert.ok(wl.some((l) => l.kind === 'locked'));
  const half = mk({ baseId: 'helm', ilvl: 1 });
  half.dur = 40;
  const dl = itemLines(half).find((l) => l.kind === 'dur');
  assert.deepEqual(dl.params, { n: '40', m: '100' });
  // skillPct 옵션 — {skill} 은 노드 이름 키(lineText 가 문면으로)
  const sk = affixLine({ id: 'skillDmg', tier: 1, value: 10, param: 'fireball' }, 1);
  assert.deepEqual(sk.pkeys, { skill: 'node.fireball.name' });
  assert.equal(lineText(sk), STRINGS['afx.skillDmg.line'].replace('{skill}', STRINGS['node.fireball.name']).replace('{v}', '10'));
  // 상점 값(가격 줄 바꾸기) — 「사기 — n 골드」
  const pl = itemLines(half, { price: { key: 'shop.gambleSlotPrice', n: 1234, pkeys: { slot: 'shop.buy' } } }).find((l) => l.kind === 'price');
  assert.equal(lineText(pl), STRINGS['shop.gambleSlotPrice'].replace('{slot}', STRINGS['shop.buy']).replace('{n}', '1,234'));
});

test('itemLines — 고정 상태의 모든 아이템(가방 · 보관함 · 재고 · 되사기)에서 쓰는 키가 전부 strings.ko.js 에 있다 · 문면에 키가 그대로 나오지 않는다', () => {
  let n = 0;
  for (const id of ['bag', 'shops', 'skillTree', 'riftLoot', 'riftComplete']) {
    const { state } = FIXTURES[id](7);
    const ch = state.char;
    const items = [...ch.bag, ...EQUIP_SLOTS.map((s) => ch.equip[s]), ...state.account.stash, ...ch.shop.blacksmith, ...ch.shop.general, ...ch.buyback.map((b) => b.item),
      ...(state.rift?.drops ?? []).map((d) => d.item)].filter(Boolean);
    for (const it of items) {
      for (const advanced of [false, true]) {
        for (const ln of itemLines(it, { advanced, char: ch, setCounts: { ironLord: 2, ashSage: 4 } })) {
          for (const k of keysOf(ln)) assert.ok(own.call(STRINGS, k), `${id}: 없는 키 ${k}`);
          const s = lineText(ln);
          assert.ok(s.length > 0 && !/\{\w+\}/.test(s), `${id}: 치환 안 된 문면 ${s}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 500, `줄 수 ${n}`);
});

test('compareLines — 시트 DPS · 생명 · 방어도 · 저항 넷 · 오름 녹(dir 1) · 내림 적(−1) · 같음 0 · 끼울 수 없으면 사유 줄', () => {
  const char = makeTestChar({ level: 30 });
  // 더 센 검 → DPS 오름
  const strong = mk({ baseId: 'sword', tier: 2, ilvl: 30, rarity: 'rare', affixes: [{ id: 'weaponDmg', tier: 5, value: 55 }] });
  const up = compareLines(compareEquip(char, strong), strong);
  assert.equal(up.length, 7);
  assert.deepEqual(up.map((l) => l.label.join(' ')), ['stat.sheetDps', 'stat.lifeMax', 'stat.armor', 'dmg.phys stat.res', 'dmg.fire stat.res', 'dmg.cold stat.res', 'dmg.lightning stat.res']);
  assert.equal(up[0].dir, 1);
  assert.ok(up[0].delta.startsWith('+'), up[0].delta);
  assert.equal(up[2].dir, 0);
  assert.equal(up[2].delta, '0');
  assert.ok(up.slice(3).every((l) => l.zero), '저항이 둘 다 0 이면 zero');
  // 맨손보다 약한 낡은 검을 끼고 있는 상태에서 방어구를 벗기는 비교 — 방어도 내림
  const weakChest = mk({ baseId: 'chest', ilvl: 1 });
  weakChest.base.armor = 0;
  const cmp = compareEquip(char, weakChest);
  const down = compareLines(cmp, weakChest);
  const armor = down.find((l) => l.key === 'stat.armor');
  assert.equal(armor.dir, -1);
  assert.ok(armor.delta.startsWith('−'), armor.delta);
  // 레벨이 모자라면 맨 앞에 사유(dir −1 · n = 요구 레벨) — 값은 「꼈다면」
  const low = makeTestChar({ level: 2 });
  const big = mk({ baseId: 'helm', ilvl: 12, rarity: 'magic', affixes: [{ id: 'vit', tier: 2, value: 10 }] });
  const gated = compareLines(compareEquip(low, big), big);
  assert.equal(gated[0].kind, 'reason');
  assert.equal(gated[0].key, 'reason.level');
  assert.equal(gated[0].params.n, 12);
  assert.equal(gated[0].dir, -1);
  assert.equal(gated.find((l) => l.key === 'stat.lifeMax').dir, 1, '꼈다면 생명이 오른다');
  // dir 은 표시 자리수로 반올림한 변화의 부호(작은 차이는 0)
  const fake = { ok: true, before: { sheetDps: 10, lifeMax: 100, armor: 5, res: { phys: 0, fire: 3, cold: 0, lightning: 0 } },
    after: { sheetDps: 10.04, lifeMax: 100.4, armor: 4.4, res: { phys: 0, fire: 3, cold: 0, lightning: 1 } } };
  const fl = compareLines(fake);
  assert.deepEqual(fl.map((l) => l.dir), [0, 0, -1, 0, 0, 0, 1]);
  assert.equal(fl[4].zero, false, '화염 저항 3 → 3 은 보인다');
  assert.equal(fl[6].before, '0');
  assert.equal(fl[6].after, '1');
  assert.deepEqual(compareLines(null), []);
});

test('bulkSellPlan — 가방의 일반 · 마법 중 업그레이드가 아니고 잠기지 않은 것 · 합계 = priceSell 합(§10.6)', () => {
  const { state } = FIXTURES.bag(3);
  const ch = state.char;
  const stats = computeStats(ch);
  const plan = bulkSellPlan(ch, stats);
  let gold = 0;
  for (const r of plan.refs) {
    const it = ch.bag[r.idx];
    assert.ok(it, '빈 칸 없음');
    assert.ok(it.rarity === 'normal' || it.rarity === 'magic', it.rarity);
    assert.ok(!it.flags?.locked, '잠긴 것 제외');
    assert.ok(!isUpgrade(stats, ch, it), '업그레이드 제외');
    gold += priceSell(it);
  }
  assert.equal(plan.gold, gold);
  assert.equal(plan.count, plan.refs.length);
  // 빠진 것은 전부 사유가 있다
  for (let i = 0; i < ch.bag.length; i++) {
    const it = ch.bag[i];
    if (!it || plan.refs.some((r) => r.idx === i)) continue;
    assert.ok(it.flags?.locked || !(it.rarity === 'normal' || it.rarity === 'magic') || isUpgrade(stats, ch, it), `칸 ${i}`);
  }
  assert.ok(plan.count > 0 && plan.count < ch.bag.filter(Boolean).length);
  assert.deepEqual(bulkSellPlan(null, null), { refs: [], count: 0, gold: 0 });
  // 일반 전부 분해 — 일반 · 잠기지 않은 것만
  for (const r of salvageNormalRefs(ch)) assert.ok(ch.bag[r.idx].rarity === 'normal' && !ch.bag[r.idx].flags?.locked);
});

test('defaultRiftLevel — 균열석 기본 포커스(Enter 한 번이 다음 판 · §10.6)', () => {
  const rec = (level, result, deaths) => ({ level, result, deaths });
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 5, records: [] })), 1, '기록 없음 → 1');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 5, records: [rec(3, 'complete', 0)] })), 4, '무사망 완료 → +1');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 3, records: [rec(3, 'complete', 0)] })), 3, '해금 위로는 가지 않는다');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 6, records: [rec(4, 'complete', 1)] })), 4, '사망 1 완료 → 그대로');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 6, records: [rec(4, 'complete', 2)] })), 3, '사망 ≥ 2 → −1');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 6, records: [rec(4, 'collapse', 3)] })), 3, '붕괴 → −1');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 6, records: [rec(1, 'collapse', 3)] })), 1, '1 아래로 가지 않는다');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 6, records: [rec(5, 'abandon', 0)] })), 5, '그 밖 → 그대로');
  assert.equal(defaultRiftLevel(makeTestChar({ riftUnlocked: 9, records: [rec(2, 'complete', 0), rec(8, 'complete', 0)] })), 3, '가장 최근(records[0])');
  assert.equal(defaultRiftLevel(null), 1);
  assert.equal(riftListMax(makeTestChar({ riftUnlocked: 4 })), 7, '해금 + 3');
  assert.equal(riftListMax(makeTestChar({ riftUnlocked: RIFT.maxLevel })), RIFT.maxLevel);
});

test('repairPlan — P6 repairAll 과 같은 순서 · 같은 비용(전부 · 부분 · 없음)', () => {
  for (const gold of [0, 1, 5, 20, 60, 100000]) {
    const state = makeTestState({ scene: 'town', level: 20 });
    const ch = /** @type {any} */ (state.char);
    for (const s of ['mainHand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1']) {
      const base = s === 'mainHand' ? 'sword' : s === 'ring1' ? 'ring' : s;
      ch.equip[s] = mk({ baseId: base, ilvl: 10 });
      ch.equip[s].dur = s === 'helm' ? 100 : 30;
    }
    ch.gold = gold;
    const plan = repairPlan(ch);
    const ctx = makeTestCtx(state);
    const res = repairAll(/** @type {any} */ (ctx));
    if (!plan.partialSlots.length) {
      assert.equal(res.ok, false, `골드 ${gold}`);
      continue;
    }
    assert.equal(res.ok, true, `골드 ${gold}`);
    assert.deepEqual([...res.repaired].sort(), [...plan.partialSlots].sort(), `골드 ${gold}`);
    assert.equal(res.cost, plan.partialCost, `골드 ${gold}`);
    assert.equal(res.partial, !plan.canFull);
    if (plan.canFull) assert.equal(plan.partialCost, plan.full);
  }
  // 우선순위: 주무기가 맨 앞
  assert.equal(REPAIR_ORDER[0], 'mainHand');
  const ch = makeTestChar();
  assert.equal(repairPlan(ch).nothing, true, '시작 장비는 고칠 것이 없다');
});

test('skillLayout — 열 = 갈래 · 노드마다 한 번 · 열 안은 단계 순 · 변형은 같은 단계의 액티브 · 패시브 뒤(§10.6)', () => {
  for (const cls of CLASS_IDS) {
    const L = skillLayout(cls);
    const nodes = nodesOf(cls);
    assert.equal(L.cols, 3);
    assert.equal(L.cells.length, L.cols * L.rows);
    const ids = L.cells.filter(Boolean);
    assert.equal(ids.length, nodes.length);
    assert.equal(new Set(ids).size, nodes.length);
    for (let c = 0; c < L.cols; c++) {
      let lastTier = 0;
      for (let r = 0; r < L.rows; r++) {
        const id = L.cells[r * L.cols + c];
        if (!id) continue;
        const n = nodes.find((x) => x.id === id);
        assert.equal(n.branch, c, `${id} 의 열`);
        assert.ok(n.tier >= lastTier, `${id} 단계 순`);
        lastTier = n.tier;
      }
    }
    // 변형의 대상 액티브는 같은 열 · 위에 있다
    for (const n of nodes.filter((x) => x.kind === 'transform')) {
      const i = L.cells.indexOf(n.id);
      const j = L.cells.indexOf(n.transforms);
      assert.ok(j >= 0 && j % L.cols === i % L.cols && j < i, `${n.id} → ${n.transforms}`);
    }
  }
});

test('nodeStatRows — 패시브 수치 전/후(옵션과 같은 스탯은 그 문면 · 아니면 라벨 + %) · 조건부 표시', () => {
  const wm = nodeStatRows('weaponMastery', 0, 1);
  assert.deepEqual(wm, [{ key: 'afx.physDmg.line', before: '0', after: '6', cond: false }]);
  const is = nodeStatRows('ironSkin', 2, 3);
  assert.deepEqual(is.map((r) => [r.label?.[0], r.before, r.after]), [['stat.armor', '16%', '24%'], ['stat.res', '10%', '15%']]);
  const cr = nodeStatRows('crusher', 1, 2);
  assert.ok(cr.length && cr.every((r) => r.cond));
  assert.deepEqual(nodeStatRows('fireball', 0, 1), [], '액티브는 패시브 수치가 없다');
  assert.deepEqual(nodeStatRows('nope', 0, 1), []);
  // 모든 노드 · 모든 랭크에서 쓰는 키가 있다
  for (const cls of CLASS_IDS) for (const n of nodesOf(cls)) {
    for (let r = 0; r < n.maxRank; r++) {
      for (const row of nodeStatRows(n.id, r, r + 1)) {
        for (const k of row.key ? [row.key] : row.label) assert.ok(own.call(STRINGS, k), `${n.id}: ${k}`);
        assert.ok(row.before !== 'NaN' && row.after !== 'NaN');
      }
    }
  }
});

test('craftDist — 제작 결과 분포(옵션 수 · 옵션 티어 · 기본형 단계)가 합 1 · ilvl = 해금 최고 균열(§10.6)', () => {
  for (const unl of [1, 9, 25]) {
    const ch = makeTestChar({ riftUnlocked: unl });
    for (const slot of ITEM_SLOTS) {
      const d = craftDist(ch, slot);
      assert.equal(d.ilvl, unl);
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(sum(d.count.map((c) => c[1])) - 1) < 1e-9);
      assert.ok(Math.abs(sum(d.tiers) - 1) < 1e-9);
      assert.ok(Math.abs(sum(d.baseTiers.map((b) => b.p)) - 1) < 1e-9);
      assert.ok(d.baseTiers.every((b) => b.names.length >= 1 && b.names.every((k) => own.call(STRINGS, k))), `${slot}`);
    }
  }
  assert.deepEqual(craftDist(makeTestChar(), 'helm').baseTiers.map((b) => b.names), [['base.helm.0']], '균열 1은 단계 0만');
  assert.ok(craftDist(makeTestChar({ cls: 'mage' }), 'mainHand').baseTiers[0].names.every((k) => k.startsWith('base.wand.') || k.startsWith('base.staff.')), '자기 클래스 무기만');
});

test('leftLootCount · needsCloseConfirm — 남은 희귀 이상 · 진행 중인 균열만 확인(완료면 조용히 · §10.2)', () => {
  const { state } = FIXTURES.riftComplete(5);
  assert.equal(needsCloseConfirm(state), false, '완료는 확인 없이 닫는다');
  const n = state.rift.drops.filter((d) => !d.gone && d.kind === 'item' && ['rare', 'legendary', 'set'].includes(d.item.rarity)).length;
  assert.ok(n > 0);
  assert.equal(leftLootCount(state), n);
  state.rift.drops[0].gone = true;
  assert.equal(leftLootCount(state), n - (state.rift.drops[0].kind === 'item' && ['rare', 'legendary', 'set'].includes(state.rift.drops[0].item?.rarity) ? 1 : 0));
  for (const [ph, want] of [['active', true], ['guardian', true], ['complete', false], ['collapsed', false]]) {
    state.rift.phase = /** @type {any} */ (ph);
    assert.equal(needsCloseConfirm(state), want, ph);
  }
  state.rift = null;
  assert.equal(needsCloseConfirm(state), false);
  assert.equal(leftLootCount(state), 0);
});

test('mysticEquipList — 옵션이 있는 장착 아이템만 · 칸 순서', () => {
  const { state } = FIXTURES.shops(2);
  const list = mysticEquipList(state.char);
  for (const e of list) assert.ok(e.item.affixes.length > 0 && state.char.equip[e.slot] === e.item);
  const order = list.map((e) => EQUIP_SLOTS.indexOf(e.slot));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual(mysticEquipList(makeTestChar()), [], '시작 장비(일반)는 옵션이 없다');
});

test('besideBoxes — 툴팁 자리는 격자 상자들 밖(오른쪽 자리가 있는 상자까지) · 칸의 세로는 그대로(화면 패스 — 상점 첫 툴팁이 가방을 덮은 회귀)', async () => {
  const { besideBoxes } = await import('../src/ui/tooltip.js');
  const box = (left, right) => ({ getBoundingClientRect: () => ({ left, right, top: 0, bottom: 100, width: right - left, height: 100 }) });
  const cell = { left: 130, right: 420, top: 240, bottom: 270 };
  // 1280 폭(Node 에는 window 가 없다 — 1280 으로 본다): 재고 116..446 · 가방 462..876 · 오른쪽 상자 892..1163
  const r = besideBoxes(cell, box(116, 446), box(462, 876), box(892, 1163));
  assert.equal(r.left, 116);
  assert.equal(r.right, 876, '오른쪽 상자까지 합치면 오른쪽에 카드 자리가 없다 — 가방까지만');
  assert.equal(r.top, 240);
  assert.equal(r.bottom, 270);
  assert.equal(besideBoxes(null, box(0, 10)), null);
  const only = besideBoxes(cell, box(0, 0));
  assert.equal(only.left, 130, '크기 없는 상자는 건너뛴다');
});
