// OWNER: P5 — 계약 §12.2 · §5.6 · §3.8 · §6.10 · §5.13-5
// computeStats 손 계산(시작 전사 시트 DPS 7.9 · 생명 120 · 방어도 12) · 내구도 0 → 꺼짐 · 맨손 · 세트 2/4 · 패시브 · 조건부 · 상한 · StatKey 대응 ·
// DRa/DRr 레벨 불변 · powerScore · weaponVisual · compareEquip(반지 · 양손 · 보조) · isUpgrade · bestSlotFor · 한손 + 보조가 죽은 선택지가 아니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DMG_TYPES, EQUIP_SLOTS } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { CLASSES } from '../src/data/classes.js';
import { COMBAT } from '../src/data/combat.js';
import { COMPARE } from '../src/data/items.js';
import { ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { GROWTH } from '../src/data/rift.js';
import { DRa, DRr, computeStats, powerScore, weaponVisual } from '../src/sim/loot/stats.js';
import { bestSlotFor, compareEquip, isUpgrade } from '../src/sim/loot/compare.js';
import { rollGear } from '../src/sim/loot/rollDrops.js';
import { makeItem, rollItem } from '../src/sim/loot/rollItem.js';
import { assertFiniteDeep, makeTestChar, makeTestStats } from './helpers.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
let seq = 0;
const iid = () => 's' + ++seq;
const it = (baseId, o = {}) => makeItem({ baseId, id: iid(), ...o });
/** 얕은 캐릭터 사본 + 장착 덮어쓰기 */
const wear = (ch, slots) => ({ ...ch, equip: { ...ch.equip, ...slots } });

test('시작 전사: 시트 DPS 7.8925(≈ 7.9) · 생명 120 · 방어도 12 · ehp 138 · 분노 100 · weapon.type phys — makeTestStats 리터럴과 같다', () => {
  const s = computeStats(makeTestChar());
  close(s.sheetDps, 5 * 1.4 * 1.1 * 1.025);
  close(s.sheetDps, 7.8925, 1e-9);
  assert.equal(s.lifeMax, 120);
  assert.equal(s.armor, 12);
  close(s.ehp, 120 / (1 - 12 / 92));
  assert.equal(Math.round(s.ehp), 138);
  assert.deepEqual(s.weapon, { min: 3, max: 7, aps: 1.4, type: 'phys', hands: 1, baseId: 'sword', fist: false });
  assert.equal(s.resourceMax, 100); assert.equal(s.resourceRegen, 0);
  const lit = makeTestStats();
  for (const k of Object.keys(lit)) {
    if (typeof lit[k] === 'number') close(s[k], lit[k], 1e-9, k);
    else assert.deepEqual(s[k], lit[k], k);
  }
  const m = computeStats(makeTestChar({ cls: 'mage' }));
  const ml = makeTestStats({ cls: 'mage' });
  for (const k of Object.keys(ml)) {
    if (typeof ml[k] === 'number') close(m[k], ml[k], 1e-9, 'mage ' + k);
    else assert.deepEqual(m[k], ml[k], 'mage ' + k);
  }
  assert.equal(m.weapon.type, 'lightning', '마법사 weapon.type = magicBolt 의 type');
  close(m.sheetDps, 4.5 * 1.4 * 1.1 * 1.025);
});

test('char null · 이상한 값: throw 없이 전사 맨손 레벨 1 시트 · 모든 수가 유한', () => {
  const s = computeStats(null);
  assert.equal(s.cls, 'warrior'); assert.equal(s.level, 1);
  assert.equal(s.weapon.fist, true);
  assertFiniteDeep(s, 'stats(null)');
  const weird = makeTestChar({ level: NaN, riftUnlocked: undefined });
  weird.equip.mainHand = { ...weird.equip.mainHand, base: { dmg: [NaN, 5], aps: 1.4 } };
  weird.equip.chest = { ...weird.equip.chest, base: { armor: NaN }, affixes: [{ id: 'vit', tier: 1, value: NaN }, { id: 'nope', tier: 1, value: 5 }] };
  const w = computeStats(weird);
  assertFiniteDeep(w, 'weird');
  assert.equal(w.weapon.fist, true, '피해가 숫자가 아닌 무기 → 맨손');
  assert.equal(w.level, 1);
});

test('내구도 0 → 그 아이템이 없는 것으로(기본 값 · 옵션 · 전설 훅 · 세트 조각) · broken 칸 · 맨손 = 시작 무기 값', () => {
  const ch = makeTestChar();
  const broken = wear(ch, {
    mainHand: { ...ch.equip.mainHand, dur: 0 },
    chest: { ...it('chest', { rarity: 'magic', affixes: [{ id: 'vit', tier: 1, value: 5 }] }), dur: 0 },
    amulet: { ...it('amulet', { rarity: 'legendary', legendaryId: 'bloodPact' }), dur: 0 },
    helm: { ...it('helm', { rarity: 'set', setPieceId: 'ironLordHelm' }), dur: 0 },
    boots: it('boots', { rarity: 'set', setPieceId: 'ironLordGreaves' }),
  });
  const s = computeStats(broken);
  assert.deepEqual(s.broken, ['mainHand', 'helm', 'chest', 'amulet']);
  assert.equal(s.weapon.fist, true);
  assert.equal(s.weapon.min, 3); assert.equal(s.weapon.max, 7);
  assert.equal(s.vit, 0);
  assert.deepEqual(s.hooks, []);
  assert.deepEqual(s.setCounts, { ironLord: 1 });
  assert.equal(s.armor, 4, '장화 방어도만');
  // 맨손(무기 없음) = 시작 검과 같은 시트 DPS — 막히지 않는다
  const bare = computeStats(wear(ch, { mainHand: null }));
  close(bare.sheetDps, computeStats(ch).sheetDps);
  assert.equal(bare.weapon.baseId, null);
  const mage = computeStats(wear(makeTestChar({ cls: 'mage' }), { mainHand: null }));
  assert.deepEqual([mage.weapon.min, mage.weapon.max, mage.weapon.aps, mage.weapon.type], [3, 6, 1.4, 'lightning']);
});

test('손 계산 시트: 레벨 10 전사 · 무기 로컬 weaponDmgPct · 공격 속도 · 치명 · 주 능력치(다른 클래스 것은 0) · 활력 · 생명% · 방어도 · 저항 · ehp', () => {
  const ch = makeTestChar({ level: 10, riftUnlocked: 6 });
  const sword = it('sword', { ilvl: 8, rarity: 'rare', affixes: [{ id: 'weaponDmg', tier: 2, value: 20 }, { id: 'attackSpeed', tier: 2, value: 10 }, { id: 'str', tier: 2, value: 12 }] });
  const ring = it('ring', { rarity: 'rare', affixes: [{ id: 'critChance', tier: 2, value: 4.5 }, { id: 'critDamage', tier: 2, value: 20 }, { id: 'int', tier: 2, value: 30 }] });
  const amu = it('amulet', { rarity: 'rare', affixes: [{ id: 'str', tier: 2, value: 15 }, { id: 'physDmg', tier: 2, value: 10 }, { id: 'allRes', tier: 1, value: 10 }] });
  const chest = it('chest', { ilvl: 8, rarity: 'rare', affixes: [{ id: 'armor', tier: 2, value: 15 }, { id: 'vit', tier: 2, value: 20 }, { id: 'lifePct', tier: 2, value: 10 }, { id: 'fireRes', tier: 2, value: 20 }] });
  const s = computeStats(wear(ch, { mainHand: sword, ring1: ring, amulet: amu, chest }));
  const main = 10 + 2 * 9 + 12 + 15;
  assert.equal(s.main, main, 'int 30 은 전사에게 0');
  const min = sword.base.dmg[0] * 1.2, max = sword.base.dmg[1] * 1.2;
  close(s.weapon.min, min); close(s.weapon.max, max);
  close(s.aps, 1.4 * 1.1);
  close(s.critChance, 0.05 + 0.045); close(s.critDamage, 0.5 + 0.2);
  close(s.dmgPct.phys, 0.10); close(s.dmgPct.fire, 0);
  const life = 120 * 1.09 ** 9 * (1 + 20 * COMBAT.vitLife + 0.10);
  close(s.lifeMax, life, 1e-9, 'lifeMax');
  const armor = chest.base.armor + 15;
  close(s.armor, armor);
  close(s.res.phys, 10); close(s.res.fire, 30);
  const dps = ((min + max) / 2) * 1.4 * 1.1 * (1 + main / 100) * 1.10 * (1 + 0.095 * 0.7);
  close(s.sheetDps, dps, 1e-9, 'sheetDps');
  const drr = (DRr(10, 6) * 3 + DRr(30, 6)) / 4;
  close(s.ehp, life / ((1 - DRa(armor, 6)) * (1 - drr)), 1e-9, 'ehp(L = riftUnlocked 6)');
  close(computeStats(wear(ch, { chest }), { riftLevel: 1 }).ehp, computeStats(wear(ch, { chest }), { riftLevel: 1 }).lifeMax / ((1 - DRa(armor, 1)) * (1 - DRr(0, 1) * 3 / 4 - DRr(20, 1) / 4)), 1e-9, 'riftLevel 지정');
  close(powerScore(s), Math.sqrt(s.sheetDps * s.ehp));
});

test('마법사: 마법구 추가 피해 · 마나 · 마나 재생 % · 번개 피해 % 가 시트 DPS 에 들어간다(weapon.type lightning)', () => {
  const ch = makeTestChar({ cls: 'mage', level: 5 });
  const orb = it('orb', { rarity: 'magic', affixes: [{ id: 'lightningDmg', tier: 1, value: 6 }] });
  const s = computeStats(wear(ch, { offhand: orb }));
  close(s.weapon.min, 3 + 0); close(s.weapon.max, 6 + 2);
  assert.equal(s.resourceMax, 100 + 2 * 4 + 10);
  // 피드백 2 다듬기: 마나 재생은 데이터(CLASSES 마법사 regen — 10 + 0.05/레벨)로 — 레벨 5 = base + perLevel × 4
  const R = CLASSES.find(c => c.id === 'mage').regen;
  close(s.resourceRegen, R.base + R.perLevel * 4);
  close(s.dmgPct.lightning, 0.06);
  close(s.sheetDps, ((3 + 8) / 2) * 1.4 * (1 + 18 / 100) * 1.06 * 1.025);
  const ms = computeStats({ ...wear(ch, { offhand: orb }), skills: { ranks: { manaFlow: 2 }, bar: [] } });
  close(ms.resourceRegen, (R.base + R.perLevel * 4) * 1.2); close(ms.manaRegenPct, 0.2);
});

test('세트 2/4: 강철 군주 2 → armorPct 25 · str 20 / 4 → + aoePct 40 · dmgTakenReduce 10 · 다른 클래스가 끼면 주 능력치는 0', () => {
  const ch = makeTestChar();
  const pieces = { helm: 'ironLordHelm', chest: 'ironLordPlate', gloves: 'ironLordGrips', boots: 'ironLordGreaves' };
  const items = Object.fromEntries(Object.entries(pieces).map(([slot, pid]) => [slot, it(slot, { rarity: 'set', setPieceId: pid })]));
  const one = computeStats(wear(ch, { helm: items.helm }));
  assert.equal(one.main, 10); assert.deepEqual(one.setCounts, { ironLord: 1 });
  const two = computeStats(wear(ch, { helm: items.helm, chest: items.chest }));
  assert.equal(two.main, 30);
  close(two.armor, (6 + 12) * 1.25);
  assert.equal(two.aoePct, 0);
  const four = computeStats(wear(ch, items));
  close(four.aoePct, 0.4); close(four.dmgTakenReduce, 0.1); assert.equal(four.main, 30);
  close(four.armor, (6 + 12 + 4 + 4) * 1.25);
  const mage = computeStats(wear(makeTestChar({ cls: 'mage' }), { helm: items.helm, chest: items.chest }));
  assert.equal(mage.main, 10, '마법사는 str 0');
  const sage = { helm: 'ashSageCowl', chest: 'ashSageRobe', gloves: 'ashSageGloves', boots: 'ashSageSteps' };
  const sItems = Object.fromEntries(Object.entries(sage).map(([slot, pid]) => [slot, it(slot, { rarity: 'set', setPieceId: pid })]));
  const s4 = computeStats(wear(makeTestChar({ cls: 'mage' }), sItems));
  close(s4.dmgPct.fire, 0.3); close(s4.dmgPct.cold, 0.3); close(s4.cdr, 0.08); close(s4.manaRegenPct, 0.4); assert.equal(s4.main, 30);
});

test('패시브 · 조건부 · 변형: stats[key][rank−1] · conds 는 PlayerStats 단위(allPct → dmgPct · freezeAt → freezeAtReduce · 퍼센트 /100) · ranks 복사', () => {
  const ranks = { weaponMastery: 3, ironSkin: 2, bloodthirst: 5, berserker: 2, crusher: 1, undying: 3, aftershock: 1, groundStomp: 1 };
  const ch = { ...makeTestChar({ level: 20 }), skills: { ranks, bar: [] } };
  const s = computeStats(ch);
  close(s.dmgPct.phys, 0.18);
  close(s.armor, 12 * 1.16);
  close(s.lifePctOnHit, 0.015);
  assert.deepEqual(s.transforms, ['aftershock']);
  assert.deepEqual(s.ranks, ranks); assert.notEqual(s.ranks, ranks, '사본');
  const byCond = Object.fromEntries(s.conds.map(c => [c.cond, c.stats]));
  close(byCond.rage50.attackSpeedPct, 0.10); close(byCond.rage50.critChance, 0.06);
  close(byCond.targetDisabled.dmgPct, 0.10);
  close(byCond.lifeBelow35.dmgTakenReduce, 0.30);
  close(s.critChance, 0.05, 1e-12, '조건부 값은 시트에 더하지 않는다');
  const m = computeStats({ ...makeTestChar({ cls: 'mage', level: 20 }), skills: { ranks: { coldCore: 2, combustion: 3, heartOfFire: 1, shatter: 2, arcaneLore: 3 }, bar: [] } });
  assert.equal(m.freezeAtReduce, 16); close(m.freezeDurPct, 0.2); close(m.burnFrac, 0.6);
  close(m.dmgPct.fire, 0.08); close(m.critDamage, 0.5 + 0.3); close(m.cdr, 0.12);
  const mc = Object.fromEntries(m.conds.map(c => [c.cond, c.stats]));
  close(mc.targetBurning.critChance, 0.05); close(mc.targetFrozen.critDamage, 0.5);
  assert.deepEqual(m.conds.map(c => c.cond), ['targetBurning', 'targetFrozen'], '노드 배열 순서');
});

test('상한: 치명 확률 critCap 0.75 · 쿨감 0.40 · 비용 감소 0.40 · 이동 속도 × 1.25 · 받는 피해 감소 0.5', () => {
  const ch = makeTestChar();
  const big = (id, value, baseId) => it(baseId, { rarity: 'rare', affixes: [{ id, tier: 5, value }] });
  const s = computeStats(wear(ch, {
    ring1: big('critChance', 90, 'ring'), ring2: big('cdr', 80, 'ring'), helm: big('costReduce', 70, 'helm'), boots: big('moveSpeed', 60, 'boots'),
  }));
  assert.equal(s.critChance, COMBAT.critCap);
  assert.equal(s.cdr, COMBAT.cdrCap);
  assert.equal(s.costReduce, COMBAT.costCap);
  close(s.moveSpeed, 6 * (1 + COMBAT.moveCap));
  const t = computeStats({ ...wear(makeTestChar(), Object.fromEntries(['helm', 'chest', 'gloves', 'boots'].map((sl, i) => [sl, it(sl, { rarity: 'set', setPieceId: ['ironLordHelm', 'ironLordPlate', 'ironLordGrips', 'ironLordGreaves'][i] })]))), skills: { ranks: {}, bar: [] } });
  assert.ok(t.dmgTakenReduce <= COMBAT.dmgTakenCap);
});

test('StatKey 대응: 옵션 32개 각각이 맞는 시트 칸을 바꾼다(퍼센트 키 /100 · 고정값 그대로 · str/int 는 자기 클래스만 · skillPct 는 param · weaponDmgPct 는 무기)', () => {
  const pct = { attackSpeedPct: 'aps', critChance: 'critChance', critDamage: 'critDamage', cdr: 'cdr', costReduce: 'costReduce', aoePct: 'aoePct', elitePct: 'elitePct',
    goldFind: 'goldFind', magicFind: 'magicFind', xpPct: 'xpPct', potionPct: 'potionPct', globePct: 'globePct' };
  const flat = { lifeRegen: 'lifeRegen', lifeOnHit: 'lifeOnHit', thorns: 'thorns', armor: 'armor', vit: 'vit' };
  for (const a of ITEM_AFFIXES) {
    const slot = a.slots.includes('ring') ? 'ring' : a.slots[0];
    const baseId = slot === 'mainHand' ? 'sword' : slot === 'offhand' ? 'shield' : slot;
    const equipSlot = slot === 'ring' ? 'ring1' : slot;
    const ch = makeTestChar({ level: 5 });
    const v = 10;
    const item = it(baseId, { rarity: 'magic', affixes: [{ id: a.id, tier: 1, value: v, ...(a.param ? { param: 'charge' } : {}) }] });
    const plain = it(baseId, { rarity: 'normal' });
    const s0 = computeStats(wear(ch, { [equipSlot]: plain }));
    const s1 = computeStats(wear(ch, { [equipSlot]: item }));
    const d = (k) => s1[k] - s0[k];
    if (a.stat === 'str') close(d('main'), v, 1e-9, a.id);
    else if (a.stat === 'int') close(d('main'), 0, 1e-9, a.id);
    else if (a.stat === 'skillPct') close(s1.skillPct.charge, 0.1, 1e-9, a.id);
    else if (a.stat === 'weaponDmgPct') close(s1.weapon.max / s0.weapon.max, 1.1, 1e-9, a.id);
    else if (a.stat === 'attackSpeedPct') close(s1.aps / s0.aps, 1.1, 1e-9, a.id);
    else if (pct[a.stat]) close(d(pct[a.stat]), a.stat === 'critChance' ? 0.1 : 0.1, 1e-9, a.id);
    else if (flat[a.stat]) close(d(flat[a.stat]), v, 1e-9, a.id);
    else if (a.stat === 'lifePct') close(s1.lifeMax / s0.lifeMax, 1.1, 1e-9, a.id);
    else if (a.stat === 'moveSpeed') close(d('moveSpeed'), 0.6, 1e-9, a.id);
    else if (a.stat === 'allRes') for (const t of DMG_TYPES) close(s1.res[t] - s0.res[t], v, 1e-9, a.id);
    else if (/^(phys|fire|cold|lightning)Res$/.test(a.stat)) close(s1.res[a.stat.slice(0, -3)] - s0.res[a.stat.slice(0, -3)], v, 1e-9, a.id);
    else if (/^(phys|fire|cold|lightning)Pct$/.test(a.stat)) close(s1.dmgPct[a.stat.slice(0, -3)] - s0.dmgPct[a.stat.slice(0, -3)], 0.1, 1e-9, a.id);
    else assert.fail(`대응을 확인하지 않은 옵션 ${a.id} (${a.stat})`);
    assertFiniteDeep(s1, a.id);
  }
});

test('DRa · DRr: 맞춘 레벨의 값이면 레벨 불변(A = K × G^(L−1) → 0.5) · 상한 0.75 · 0 · 음수 · NaN', () => {
  for (const L of [1, 5, 13, 30, 60]) {
    close(DRa(COMBAT.armorK * GROWTH.item ** (L - 1), L), 0.5, 1e-12, `DRa L${L}`);
    close(DRr(COMBAT.resK * GROWTH.item ** (L - 1), L), 0.5, 1e-12, `DRr L${L}`);
  }
  assert.equal(DRa(1e9, 1), COMBAT.drCap); assert.equal(DRr(1e9, 1), COMBAT.drCap);
  assert.equal(DRa(0, 3), 0); assert.equal(DRa(-5, 3), 0); assert.equal(DRr(NaN, 3), 0);
  close(DRa(12, NaN), 12 / 92, 1e-12, '레벨 NaN → 1');
  assert.ok(DRa(50, 10) < DRa(50, 5), '오래된 장비는 높은 균열에서 감소율이 떨어진다');
});

test('powerScore · weaponVisual', () => {
  close(powerScore({ sheetDps: 9, ehp: 100 }), 30);
  assert.equal(powerScore({ sheetDps: NaN, ehp: 100 }), 0);
  assert.equal(powerScore(null), 0);
  assert.deepEqual(weaponVisual(it('greataxe', { tier: 2, ilvl: 20, rarity: 'rare' })), { look: 'greataxe', tier: 2, rarity: 'rare', hands: 2 });
  assert.deepEqual(weaponVisual(it('orb')), { look: 'orb', tier: 0, rarity: 'normal', hands: 1 });
  assert.equal(weaponVisual(null), null);
  assert.equal(weaponVisual({ baseId: 'nope' }), null);
});

test('compareEquip: 반지는 더 크게 오르는 칸 · slot 지정 · 양손 무기는 보조를 뺀 시트 · 양손을 낀 채 보조는 slot · 클래스 · 레벨 · delta · char 를 고치지 않는다', () => {
  const ch = makeTestChar({ level: 10 });
  const weak = it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 4 }] });
  const strong = it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 14 }] });
  const ringed = wear(ch, { ring1: strong, ring2: weak, offhand: it('shield') });
  const frozen = JSON.stringify(ringed);
  const mid = it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 10 }] });
  const c = compareEquip(ringed, mid);
  assert.equal(c.slot, 'ring2', '낮은 쪽(약한 반지)을 바꾼다');
  assert.equal(c.ok, true); assert.equal(c.upgrade, true);
  close(c.after.main - c.before.main, 6);
  close(c.delta.sheetDps, c.after.sheetDps - c.before.sheetDps); close(c.delta.power, powerScore(c.after) - powerScore(c.before));
  for (const t of DMG_TYPES) assert.equal(c.delta.res[t], 0);
  const r1 = compareEquip(ringed, mid, { slot: 'ring1' });
  assert.equal(r1.slot, 'ring1'); assert.equal(r1.upgrade, false, '강한 반지를 빼면 손해');
  assert.equal(compareEquip(ringed, mid, { slot: 'helm' }).reason, 'slot');
  // 양손 무기: 방패를 뺀 시트
  const gs = it('greatsword');
  const g = compareEquip(ringed, gs);
  assert.equal(g.slot, 'mainHand');
  assert.equal(g.after.block, 0); close(g.after.armor, 12, 1e-9, '방패 방어도가 빠진다');
  assert.equal(g.after.weapon.hands, 2);
  // 양손 무기를 낀 채 보조
  const two = wear(ch, { mainHand: gs, offhand: null });
  const sh = compareEquip(two, it('shield'));
  assert.deepEqual([sh.ok, sh.reason, sh.slot, sh.upgrade], [false, 'slot', null, false]);
  assert.equal(sh.after, sh.before); assert.equal(sh.delta.power, 0);
  // 클래스 · 레벨(가상의 after 는 계산한다)
  const wand = compareEquip(ch, it('wand'));
  assert.deepEqual([wand.ok, wand.reason, wand.upgrade], [false, 'class', false]);
  const hi = compareEquip(ch, it('helm', { ilvl: 15 }));
  assert.deepEqual([hi.ok, hi.reason, hi.upgrade], [false, 'level', false]);
  assert.ok(hi.after.armor > hi.before.armor, '레벨이 모자라도 「꼈다면」 값');
  // 이미 끼운 그 아이템
  const self = compareEquip(ringed, strong);
  assert.deepEqual([self.slot, self.ok, self.upgrade, self.delta.power], ['ring1', true, false, 0]);
  assert.equal(JSON.stringify(ringed), frozen, 'char 를 고치지 않는다');
  // riftLevel 이 ehp 기준
  const lv = compareEquip(ch, it('chest', { ilvl: 10, rarity: 'magic', affixes: [{ id: 'armor', tier: 2, value: 8 }] }), { riftLevel: 20 });
  close(lv.before.ehp, computeStats(ch, { riftLevel: 20 }).ehp);
});

test('isUpgrade(§5.13-5): 클래스 · reqLevel · 그 칸 powerScore > 지금 × (1 + 0.5%) · 반지 · 양손 · 보조 · compareEquip.upgrade 와 같다', () => {
  const ch = makeTestChar({ level: 5 });
  const stats = computeStats(ch);
  assert.equal(isUpgrade(stats, ch, it('helm', { rarity: 'magic', affixes: [{ id: 'vit', tier: 1, value: 5 }] })), true);
  assert.equal(isUpgrade(stats, ch, it('chest')), false, '같은 갑옷 → 0%');
  assert.equal(isUpgrade(stats, ch, it('wand', { rarity: 'rare', affixes: [{ id: 'weaponDmg', tier: 1, value: 14 }] })), false, '다른 클래스');
  assert.equal(isUpgrade(stats, ch, it('helm', { ilvl: 9 })), false, '요구 레벨');
  assert.equal(isUpgrade(stats, ch, it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 4 }] })), true, '빈 반지 칸');
  assert.equal(isUpgrade(stats, ch, it('greatsword')), true, '양손 대검(방패 없음)');
  const two = wear(ch, { mainHand: it('greatsword'), offhand: null });
  assert.equal(isUpgrade(computeStats(two), two, it('shield', { rarity: 'rare', affixes: [{ id: 'vit', tier: 5, value: 45 }] })), false, '양손을 낀 채 보조');
  // 0.5% 문턱: 아주 작은 이득은 업그레이드가 아니다
  const tiny = it('ring', { rarity: 'magic', affixes: [{ id: 'goldFind', tier: 1, value: 5 }] });
  assert.equal(isUpgrade(stats, ch, tiny), false, 'powerScore 0% 이득');
  assert.equal(isUpgrade(null, ch, it('helm', { rarity: 'magic', affixes: [{ id: 'vit', tier: 1, value: 5 }] })), true, 'stats 없으면 다시 계산');
  assert.equal(isUpgrade(stats, null, it('helm')), false);
  // compareEquip.upgrade 와 같다(무작위 장비 600개)
  const rng = makeRng(seedRng(8));
  let up = 0;
  for (let i = 0; i < 600; i++) {
    const g = rollGear(rng, { rarity: i % 3 ? 'magic' : 'rare', level: 1 + (i % 6), cls: 'warrior', newId: iid });
    const a = isUpgrade(stats, ch, g);
    assert.equal(a, compareEquip(ch, g).upgrade, `${g.baseId} ${g.rarity}`);
    if (a) up++;
  }
  assert.ok(up > 100 && up < 600, `업그레이드 ${up}/600`);
  // 문턱 값 그대로
  assert.equal(COMPARE.minGain, 0.005);
});

test('bestSlotFor: 부위 그대로 · 반지는 빈 칸(ring1 → ring2) 먼저 · 둘 다 차면 더 크게 오르는 칸 · 이미 낀 아이템은 그 칸', () => {
  const ch = makeTestChar();
  assert.equal(bestSlotFor(ch, it('helm')), 'helm');
  assert.equal(bestSlotFor(ch, it('shield')), 'offhand');
  assert.equal(bestSlotFor(ch, it('ring')), 'ring1');
  const r1 = it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 2, value: 12 }] });
  assert.equal(bestSlotFor(wear(ch, { ring1: r1 }), it('ring')), 'ring2');
  const r2 = it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 4 }] });
  assert.equal(bestSlotFor(wear(ch, { ring1: r1, ring2: r2 }), it('ring', { rarity: 'magic', affixes: [{ id: 'str', tier: 1, value: 8 }] })), 'ring2');
  assert.equal(bestSlotFor(wear(ch, { ring1: r1, ring2: r2 }), r1), 'ring1');
  assert.equal(bestSlotFor(ch, null), null);
  for (const s of EQUIP_SLOTS) assert.ok(s);
});

test('한손 + 방패/마법구가 죽은 선택지가 아니다: 같은 희귀 장비 위에서 양손 대 한손 + 보조의 powerScore 비 0.9~1.1 · 양손이 이기는 비율 30~70%(L10 · 두 클래스)', () => {
  const rng = makeRng(seedRng(4));
  for (const cls of ['warrior', 'mage']) {
    const one = cls === 'warrior' ? ['sword', 'axe', 'mace'] : ['wand'];
    const two = cls === 'warrior' ? ['greatsword', 'greataxe'] : ['staff'];
    const off = cls === 'warrior' ? 'shield' : 'orb';
    let a = 0, b = 0, wins2 = 0;
    const N = 500, L = 10;
    for (let i = 0; i < N; i++) {
      const ch = makeTestChar({ cls, level: L + 9, riftUnlocked: L });
      for (const s of ['helm', 'chest', 'gloves', 'boots', 'belt', 'amulet']) ch.equip[s] = rollGear(rng, { rarity: 'rare', level: L, cls, newId: iid, slot: s });
      ch.equip.ring1 = rollGear(rng, { rarity: 'rare', level: L, cls, newId: iid, slot: 'ring' });
      ch.equip.ring2 = rollGear(rng, { rarity: 'rare', level: L, cls, newId: iid, slot: 'ring' });
      const p1 = powerScore(computeStats(wear(ch, { mainHand: rollItem(rng, { baseId: one[i % one.length], tier: 0, rarity: 'rare', ilvl: L, cls, newId: iid }), offhand: rollItem(rng, { baseId: off, tier: 0, rarity: 'rare', ilvl: L, cls, newId: iid }) })));
      const p2 = powerScore(computeStats(wear(ch, { mainHand: rollItem(rng, { baseId: two[i % two.length], tier: 0, rarity: 'rare', ilvl: L, cls, newId: iid }), offhand: null })));
      a += p1; b += p2; if (p2 > p1) wins2++;
    }
    const ratio = b / a;
    assert.ok(ratio > 0.9 && ratio < 1.1, `${cls} 양손/한손+보조 ${ratio}`);
    assert.ok(wins2 / N > 0.3 && wins2 / N < 0.7, `${cls} 양손이 이기는 비율 ${wins2 / N}`);
  }
});
