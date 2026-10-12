// OWNER: P5 — 계약 §12.2 · §5.13 · §7.7~7.9 · §7.14
// 이론 확률: 합 1 · 손 계산 대조 · §7.14 한 판 기대값(L5: 장비 42.5 · 마법 16.9 · 희귀 5.24 · 전설 0.311) · 수확 체감 · 후보 규칙 · 시드 표가 계약 값 그대로.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_SLOTS, MON_RANKS, RARITIES } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BASES, BASE_TIERS, COMPARE, FIST, ITEM, SLOT_WEIGHTS } from '../src/data/items.js';
import { AFFIX_TIERS, ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { BLP, GOLD, GUARANTEE, MATERIAL_DROP, MF, RARITY, TREASURE } from '../src/data/drops.js';
import { LEGENDARIES, SETS } from '../src/data/legendaries.js';
import { GROWTH, riftRow } from '../src/data/rift.js';
import {
  affixCountDist, baseTierDist, blpMultiplier, effectiveMF, expectedGoldPile, expectedPerKill, rarityDist, rarityWeights, slotDist,
  specialCandidates, tcDist, tierDist,
} from '../src/sim/loot/theory.js';
import { rollDrops } from '../src/sim/loot/rollDrops.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
/** §7.14 가정 — 적정 레벨 한 판의 처치 */
const RUN = { normal: 300, champion: 12, elite: 2, minion: 8, guardian: 1 };

/** 한 판 기대값 */
function perRun(L, mf = 0) {
  const out = { gear: 0, gearBeforeGuardian: 0, gold: 0, goldAmount: 0, potion: 0, byRarity: { normal: 0, magic: 0, rare: 0, legendary: 0, set: 0 } };
  for (const [rank, n] of Object.entries(RUN)) {
    const e = expectedPerKill({ rank, level: L, mf });
    out.gear += e.gear * n;
    if (rank !== 'guardian') out.gearBeforeGuardian += e.gear * n;
    out.gold += e.gold * n;
    out.goldAmount += e.goldAmount * n;
    out.potion += e.potion * n;
    for (const r of RARITIES) out.byRarity[r] += e.byRarity[r] * n;
  }
  return out;
}

test('합 1: rarityDist(모든 등급 · 레벨 · MF · 보장) · tcDist · slotDist(섞음 포함) · affixCountDist · tierDist · baseTierDist', () => {
  for (const rank of MON_RANKS) {
    close(sum(tcDist(rank)), 1, 1e-12, `tcDist ${rank}`);
    for (const L of [1, 7, 20, 30, 99, 150]) for (const mf of [0, 0.5, 3]) {
      const d = rarityDist({ rank, level: L, mf });
      close(sum(d), 1, 1e-12, `rarityDist ${rank} L${L}`);
      for (const r of RARITIES) assert.ok(d[r] >= 0 && Number.isFinite(d[r]));
    }
    close(sum(rarityDist({ rank, level: 5, guaranteed: true })), 1, 1e-12, 'guaranteed');
    close(sum(slotDist('warrior', { rank, level: 9, mf: 1 })), 1, 1e-12, `slotDist mix ${rank}`);
  }
  for (const cls of ['warrior', 'mage']) close(sum(slotDist(cls)), 1, 1e-12, 'slotDist');
  for (const r of RARITIES) close(sum(affixCountDist(r)), 1, 1e-12, `affixCountDist ${r}`);
  for (const L of [1, 6, 12, 18, 24, 40]) { close(tierDist(L).reduce((a, b) => a + b), 1, 1e-12); close(baseTierDist(L).reduce((a, b) => a + b), 1, 1e-12); }
  assert.deepEqual(tcDist('spawn'), { none: 1, gold: 0, potion: 0, globe: 0, material: 0, gear: 0 }, '드랍 묶음이 없는 등급');
});

test('손 계산: 일반 L1 MF 0 · 엘리트 L5 MF 100% · 보장 · 불운 보정 배율 · 강제 전설(blp ≥ 400)', () => {
  const d = rarityDist({ rank: 'normal', level: 1 });
  const tot = 1000 + 640 + 95 + 6.5 + 1.8;
  close(d.normal, 1000 / tot, 1e-12); close(d.magic, 640 / tot, 1e-12); close(d.rare, 95 / tot, 1e-12);
  close(d.legendary, 6.5 / tot, 1e-12); close(d.set, 1.8 / tot, 1e-12);
  // 엘리트 L5 · MF 1.0 → effMF = 2/3
  const e = 2 / 3;
  const w = {
    normal: 1000,
    magic: 640 * 2.0 * (1 + 0.02 * 4) * (1 + e * 1.0),
    rare: 95 * 3.2 * (1 + 0.035 * 4) * (1 + e * 0.8),
    legendary: 6.5 * 3.5 * (1 + 0.05 * 4) * (1 + e * 0.6),
    set: 1.8 * 3.5 * (1 + 0.05 * 4) * (1 + e * 0.6),
  };
  const got = rarityWeights({ rank: 'elite', level: 5, mf: 1 });
  for (const r of RARITIES) close(got[r], w[r], 1e-9, `elite L5 w.${r}`);
  const de = rarityDist({ rank: 'elite', level: 5, mf: 1 });
  for (const r of RARITIES) close(de[r], w[r] / sum(w), 1e-12, `elite L5 P(${r})`);
  // 보장: 일반 · 마법 0 · GUARANTEE 가중치
  const g = rarityDist({ rank: 'guardian', level: 1, guaranteed: true });
  assert.equal(g.normal, 0); assert.equal(g.magic, 0);
  close(g.rare, 100 / 103.8, 1e-12); close(g.legendary, 3 / 103.8, 1e-12); close(g.set, 0.8 / 103.8, 1e-12);
  // 불운 보정
  assert.equal(blpMultiplier(0, true), 1);
  close(blpMultiplier(100, true), 1.4, 1e-12);
  close(blpMultiplier(1000, true), 1 + 0.004 * 300, 1e-12, '상한 capCount');
  assert.equal(blpMultiplier(250, false), 1);
  const on = rarityDist({ rank: 'normal', level: 1, blp: 200, blpOn: true });
  close(on.legendary, (6.5 * 1.8) / (tot - 6.5 + 6.5 * 1.8), 1e-12, 'blp 200 → × 1.8');
  assert.deepEqual(rarityDist({ rank: 'normal', level: 1, blp: BLP.hard, blpOn: true }), { normal: 0, magic: 0, rare: 0, legendary: 1, set: 0 });
  assert.notEqual(rarityDist({ rank: 'normal', level: 1, blp: BLP.hard, blpOn: false }).legendary, 1, '끔이면 강제 없음');
});

test('effectiveMF 수확 체감(§5.13): 0 → 0 · 1 → 0.667 · 3 → 1.2 · 6 → 1.5 · 음수 · NaN → 0', () => {
  assert.equal(effectiveMF(0), 0);
  close(effectiveMF(1), 2 / 3, 1e-12);
  close(effectiveMF(3), 1.2, 1e-12);
  close(effectiveMF(6), 1.5, 1e-12);
  assert.equal(effectiveMF(-1), 0);
  assert.equal(effectiveMF(NaN), 0);
  assert.ok(effectiveMF(1e9) < MF.k, '상한 k');
});

test('§7.14 한 판 기대값(L5 · MF 0): 장비 42.5(수호자 전 36.9) · 일반 20.0 · 마법 16.9 · 희귀 5.24 · 전설 0.311 · 세트 0.085 · L1 → L30 전설 0.28 → 0.47 · 희귀 5.0 → 6.5', () => {
  const r5 = perRun(5);
  close(r5.gear, 42.5, 0.05, '장비');
  close(r5.gearBeforeGuardian, 36.9, 0.05, '수호자 전 장비');
  close(r5.byRarity.normal, 20.0, 0.05, '일반');
  close(r5.byRarity.magic, 16.9, 0.06, '마법');
  close(r5.byRarity.rare, 5.24, 0.01, '희귀');
  close(r5.byRarity.legendary, 0.311, 0.001, '전설');
  close(r5.byRarity.set, 0.085, 0.001, '세트');
  close(sum(r5.byRarity), r5.gear, 1e-9, '등급 합 = 장비');
  const r1 = perRun(1), r30 = perRun(30);
  close(r1.byRarity.legendary, 0.28, 0.005); close(r30.byRarity.legendary, 0.47, 0.005);
  close(r1.byRarity.rare, 5.0, 0.03); close(r30.byRarity.rare, 6.5, 0.03);
  // 브리프 §7 드랍 목표(장비 30~60 · 마법 10~25 · 희귀 3~8 · 전설 0.2~0.5 · 세트 0.05~0.15)
  for (const L of [1, 5, 10, 20, 30]) {
    const r = perRun(L);
    assert.ok(r.gear >= 30 && r.gear <= 60 && r.byRarity.magic >= 10 && r.byRarity.magic <= 25 && r.byRarity.rare >= 3 && r.byRarity.rare <= 8, `L${L}`);
    assert.ok(r.byRarity.legendary >= 0.2 && r.byRarity.legendary <= 0.5 && r.byRarity.set >= 0.05 && r.byRarity.set <= 0.15, `L${L} 전설 · 세트`);
  }
  // 골드 더미 ~40개 × 3 × 등급 배율 → 168 × G^(L−1) · 포션 드랍 ~3.1개
  close(r1.goldAmount, 168, 1.5, '한 판 골드(L1)');
  close(perRun(10).goldAmount / r1.goldAmount, GROWTH.gold ** 9, 0.02 * GROWTH.gold ** 9, '골드 성장');
  close(r1.potion, 3.14, 0.01, '포션 드랍');
});

test('아이템 발견 수확 체감(§7.14): 일반 L5 희귀 이상 비율 MF 0 → 6.54% · 100% → 7.72% · 300% → 8.34% · 600% → 8.62% · 증가분이 줄어든다', () => {
  const rarePlus = (mf) => { const d = rarityDist({ rank: 'normal', level: 5, mf }); return (d.rare + d.legendary + d.set) * 100; };
  const v = [0, 1, 3, 6].map(rarePlus);
  close(v[0], 6.54, 0.01); close(v[1], 7.72, 0.01); close(v[2], 8.34, 0.01); close(v[3], 8.62, 0.01);
  const inc = [v[1] - v[0], v[2] - v[1], v[3] - v[2]];
  assert.ok(inc[0] > inc[1] && inc[1] > inc[2] && inc[2] > 0, `증가분 ${inc}`);
});

test('expectedPerKill · expectedGoldPile: 손 계산 · 몬테카를로와 같다 · 골드 획득 없이', () => {
  const e = expectedPerKill({ rank: 'champion', level: 1 });
  close(e.gear, 2 * 0.275, 1e-12); close(e.gold, 2 * 0.25, 1e-12); close(e.potion, 2 * 0.025, 1e-12);
  close(e.globe, 2 * 0.09, 1e-12); close(e.material, 2 * 0.045, 1e-12);
  const gd = expectedPerKill({ rank: 'guardian', level: 3 });
  close(gd.gear, 8 * 0.45 + 2, 1e-12, '수호자 장비(보장 2 포함)');
  assert.ok(gd.byRarity.rare + gd.byRarity.legendary + gd.byRarity.set >= 2, '보장 희귀 이상 2');
  const none = expectedPerKill({ rank: 'spawn', level: 3 });
  assert.equal(none.gear, 0); assert.equal(none.goldAmount, 0);
  // 골드 더미 하나 = max(1, round(c × U[0.5, 1.5)))
  const rng = makeRng(seedRng(5));
  for (const c of [0.4, 1.2, 3, 6.6, 47.3]) {
    let s = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) s += Math.max(1, Math.round(c * rng.range(GOLD.range[0], GOLD.range[1])));
    close(expectedGoldPile(c), s / N, Math.max(0.01, c * 0.005), `c ${c}`);
  }
});

test('tierDist · baseTierDist · affixCountDist 손 계산', () => {
  assert.deepEqual(tierDist(1), [1, 0, 0, 0, 0]);
  const w = [100, 70, 45, 25, 12];
  const t24 = tierDist(24);
  for (let i = 0; i < 5; i++) close(t24[i], w[i] / 252, 1e-12);
  const t12 = tierDist(12);
  for (let i = 0; i < 5; i++) close(t12[i], i < 3 ? w[i] / 215 : 0, 1e-12);
  assert.deepEqual(baseTierDist(9), [1, 0, 0]);
  close(baseTierDist(10)[1], 50 / 80, 1e-12);
  close(baseTierDist(25)[2], 70 / 150, 1e-12);
  assert.deepEqual(affixCountDist('normal'), { 0: 1 });
  assert.deepEqual(affixCountDist('magic'), { 1: 0.5, 2: 0.5 });
  const rare = affixCountDist('rare');
  close(rare[3], 0.30, 1e-12); close(rare[4], 0.35, 1e-12); close(rare[5], 0.25, 1e-12); close(rare[6], 0.10, 1e-12);
  assert.deepEqual(affixCountDist('set'), { 3: 0.5, 4: 0.5 });
  assert.deepEqual(affixCountDist('legendary'), { 3: 0.5, 4: 0.5 });
});

test('전설 · 세트 후보(specialCandidates): 부위를 고르면 그 부위 · 자기 클래스(공용 포함)만 · 고르지 않으면 다른 클래스 × 0.25 · 세트 0.8/0.2', () => {
  const ids = (r, o) => specialCandidates(r, o).map(e => e.id).sort();
  // 드랍(부위 없음): 12 전설 전부 · 다른 클래스 가중치 0.25
  const all = specialCandidates('legendary', { cls: 'warrior' });
  assert.equal(all.length, LEGENDARIES.length);
  for (const e of all) { const l = LEGENDARIES.find(x => x.id === e.id); assert.equal(e.w, l.cls === 'mage' ? ITEM.otherClassLegend : 1, e.id); }
  assert.equal(specialCandidates('legendary', { cls: 'warrior', ownClassOnly: true }).length, 7, '전사 5 + 공용 2');
  // 부위를 고른 굴림(도박 · 제작 · 재고)
  assert.deepEqual(ids('legendary', { slot: 'chest', cls: 'warrior' }), [], '갑옷 전설 없음');
  assert.deepEqual(ids('legendary', { slot: 'offhand', cls: 'warrior' }), [], '전사 보조 전설 없음(폭풍의 구체는 마법사)');
  assert.deepEqual(ids('legendary', { slot: 'offhand', cls: 'mage' }), ['stormOrb']);
  assert.deepEqual(ids('legendary', { slot: 'belt', cls: 'mage' }), ['verdantSash'], '공용 전설');
  assert.deepEqual(ids('legendary', { slot: 'ring1', cls: 'mage' }), ['rimeRing'], 'ring1 → ring');
  assert.deepEqual(ids('set', { slot: 'helm', cls: 'warrior' }), ['ironLordHelm']);
  assert.deepEqual(ids('set', { slot: 'amulet', cls: 'mage' }), [], '장신구 세트 없음');
  // 세트(부위 없음): 자기 세트 0.8 · 다른 세트 0.2 · 조각 균등
  const sets = specialCandidates('set', { cls: 'mage' });
  close(sum(Object.fromEntries(sets.filter(e => e.id.startsWith('ashSage')).map(e => [e.id, e.w]))), ITEM.ownSetChance, 1e-12);
  close(sum(Object.fromEntries(sets.map(e => [e.id, e.w]))), 1, 1e-12);
  assert.equal(new Set(sets.filter(e => e.id.startsWith('ironLord')).map(e => e.w)).size, 1, '조각 균등');
  assert.equal(specialCandidates('set', { cls: 'mage', ownClassOnly: true }).length, 4);
});

test('시드 표가 계약 §7.7 · §7.8 · §7.9 그대로(양손 무기 피해 · 포션 가중치 · 분노의 뿔 resetTo 포함)', () => {
  assert.deepEqual(ITEM.affixCount, { normal: { 0: 1 }, magic: { 1: 50, 2: 50 }, rare: { 3: 30, 4: 35, 5: 25, 6: 10 } });
  assert.deepEqual(ITEM.slotValue, { mainHand1h: 20, mainHand2h: 30, offhand: 15, helm: 12, chest: 18, gloves: 10, boots: 10, belt: 8, amulet: 20, ring: 15 });
  for (const [k, v] of Object.entries({ baseVar: 0.10, durMax: 100, deathDurLoss: 10, ownClassChance: 0.85, otherClassLegend: 0.25, ownSetChance: 0.8, mainBias: 3, offMainBias: 0.3 })) assert.equal(ITEM[k], v, k);
  assert.deepEqual(BASE_TIERS, [{ minIlvl: 1, mul: 1.00, weight: 30 }, { minIlvl: 10, mul: 1.06, weight: 50 }, { minIlvl: 20, mul: 1.12, weight: 70 }]);
  assert.deepEqual(SLOT_WEIGHTS, { mainHand: 14, offhand: 8, helm: 10, chest: 10, gloves: 10, boots: 10, belt: 9, amulet: 7, ring: 12 });
  assert.deepEqual(FIST, { warrior: { dmg: [3, 7], aps: 1.40, type: 'phys' }, mage: { dmg: [3, 6], aps: 1.40, type: 'lightning' } });
  assert.equal(COMPARE.minGain, 0.005);
  const B = Object.fromEntries(BASES.map(b => [b.id, b]));
  const want = {
    sword: [3, 7, 1.40, 25], axe: [3, 8, 1.30, 20], mace: [4, 8, 1.20, 20], greatsword: [5, 10, 1.15, 20], greataxe: [6, 11, 1.05, 15],
    wand: [3, 6, 1.40, 55], staff: [6, 10, 1.10, 45],
  };
  for (const [id, [lo, hi, aps, w]] of Object.entries(want)) assert.deepEqual([B[id].dmg[0], B[id].dmg[1], B[id].aps, B[id].weight], [lo, hi, aps, w], id);
  assert.equal(B.greatsword.hands, 2); assert.equal(B.greataxe.hands, 2); assert.equal(B.staff.hands, 2); assert.equal(B.sword.hands, 1);
  for (const [id, armor] of Object.entries({ shield: 10, helm: 6, chest: 12, gloves: 4, boots: 4, belt: 3 })) assert.equal(B[id].armor, armor, id);
  assert.equal(B.shield.block, 0.12); assert.deepEqual(B.orb.bonus, [0, 2]); assert.equal(B.orb.mana, 10);
  // 양손 기본 DPS 는 한손의 약 1.15~1.25배(대검 8.6 · 대도끼 8.9 / 검 7.0 · 도끼 7.15 · 철퇴 7.2 · 지팡이 8.8 / 마법봉 6.3 + 마법구 = 7.7)
  const dps = (b) => ((b.dmg[0] + b.dmg[1]) / 2) * b.aps;
  close(dps(B.greatsword), 8.625, 1e-9); close(dps(B.greataxe), 8.925, 1e-9); close(dps(B.staff), 8.8, 1e-9);
  for (const two of ['greatsword', 'greataxe']) for (const one of ['sword', 'axe', 'mace']) {
    const k = dps(B[two]) / dps(B[one]);
    assert.ok(k >= 1.15 && k <= 1.30, `${two}/${one} ${k}`);
  }
  const mageOne = dps(B.wand) + ((B.orb.bonus[0] + B.orb.bonus[1]) / 2) * B.wand.aps;
  close(mageOne, 7.7, 1e-9, '마법봉 + 마법구');
  assert.equal(ITEM_AFFIXES.length, 32);
  assert.deepEqual(AFFIX_TIERS, { minIlvl: [1, 6, 12, 18, 24], weight: [100, 70, 45, 25, 12] });
  // W1 수정(NOTES-W1FIX): normal · minion 의 globe ↔ none 맞교환(normal 25 → 80 · minion 80 → 150 — 합 1000 · 나머지 그대로 · 계약 §7.8)
  // 피드백 1: normal · minion 의 none → gold(90 → 270 · 150 → 300) · goldMul(1.0 → 1/3 · 1.2 → 0.6) — 골드 더미를 더 자주 · 더 작게(기대 골드는 drops.test)
  assert.deepEqual(TREASURE.map(t => [t.id, t.picks, t.goldMul, t.w.none, t.w.gold, t.w.potion, t.w.globe, t.w.material, t.w.gear, t.guaranteed ?? 0]), [
    ['normal', 1, 1 / 3, 552, 270, 5, 80, 8, 85, 0], ['minion', 1, 0.6, 300, 300, 30, 150, 20, 200, 0], ['champion', 2, 1.6, 315, 250, 25, 90, 45, 275, 0],
    ['elite', 4, 2.2, 150, 300, 50, 60, 40, 400, 0], ['guardian', 8, 4.0, 0, 400, 50, 0, 100, 450, 2], ['split', 1, 0.5, 900, 60, 0, 40, 0, 0, 0],
  ]);
  assert.deepEqual(RARITY.base, { normal: 1000, magic: 640, rare: 95, legendary: 6.5, set: 1.8 });
  assert.deepEqual(RARITY.rank.elite, { magic: 2.0, rare: 3.2, legendary: 3.5, set: 3.5 });
  assert.deepEqual(RARITY.rank.guardian, { magic: 2.5, rare: 5.0, legendary: 6.0, set: 6.0 });
  assert.deepEqual(RARITY.value, { normal: 1, magic: 2.5, rare: 6, legendary: 15, set: 15 });
  assert.deepEqual(GUARANTEE, { rare: 100, legendary: 3, set: 0.8 });
  assert.deepEqual(MF, { k: 2.0, scale: { magic: 1.0, rare: 0.8, legendary: 0.6, set: 0.6 } });
  assert.deepEqual(BLP, { rate: 0.004, capCount: 300, hard: 400 });
  assert.equal(GOLD.base, 3); assert.deepEqual(GOLD.range, [0.5, 1.5]);
  assert.deepEqual(MATERIAL_DROP, { scrap: 70, dust: 25, essence: 5 });
  assert.equal(LEGENDARIES.length, 12);
  const L = Object.fromEntries(LEGENDARIES.map(l => [l.id, l]));
  assert.deepEqual(L.ragingHorn.patch, { refund: { ragePerHit: 5, resetAt: 3, resetTo: 1.0 } });
  assert.deepEqual(L.emberMaelstrom.patch, { vortex: { everySec: 0.6, r: 2.0, dur: 2.0, tick: 0.5, coefPerSec: 0.35 } });
  assert.deepEqual(L.bloodPact.params, { chance: 0.10, r: 3.0, pctOfMax: 0.2 });
  assert.deepEqual(L.rimeRing.params, { r: 2.5, coef: 0.8 });
  assert.deepEqual(L.verdantSash.params, { mul: 2, radiusAdd: 1.0 });
  assert.deepEqual(LEGENDARIES.filter(l => l.at).map(l => [l.id, l.at]), [['rimeRing', 'kill'], ['bloodPact', 'kill'], ['verdantSash', 'globe']]);
  assert.equal(LEGENDARIES.filter(l => l.skill && l.patch).length, 9, '패치형 9');
  for (const l of LEGENDARIES) { assert.equal(l.weight, 1); assert.deepEqual(l.affixes, [3, 4]); }
  assert.deepEqual(SETS.map(s => [s.id, s.cls, s.pieces.map(p => p.slot), s.bonus2, s.bonus4]), [
    ['ironLord', 'warrior', ['helm', 'chest', 'gloves', 'boots'], { armorPct: 25, str: 20 }, { aoePct: 40, dmgTakenReduce: 10 }],
    ['ashSage', 'mage', ['helm', 'chest', 'gloves', 'boots'], { manaRegenPct: 40, int: 20 }, { firePct: 30, coldPct: 30, cdr: 8 }],
  ]);
  // 모든 부위에 L1 기본형
  for (const s of ITEM_SLOTS) assert.ok(BASES.some(b => b.slot === s), s);
  assert.equal(riftRow(5).rarityMul.legendary, 1.2);
});

// 피드백 1(Jay 2026-10-12): 골드 더미를 더 자주 · 더 작게 — 처치당 기대 골드(반올림 · 최소 1 을 넣은 정확한 적분)는 옛 표(normal gold 90 · goldMul 1.0 ·
// minion 150 · 1.2)와 같다(균열 1 · 6 이상 ±1% · 2~5 는 반올림 탓에 ±4% · 30레벨 평균 ±0.5%) · 장비 · 구슬 · 포션 · 재료 확률은 그대로 · 일반 처치의 골드 확률 25~35%
test('피드백 1: 일반 · 하수인 골드 — 확률은 오르고(일반 27%) 처치당 기대 골드는 옛 표와 같다 · 다른 드랍 확률 그대로 · 굴림 표본도 이론과 맞는다', () => {
  const OLD = { normal: { gold: 90, goldMul: 1.0, w: { potion: 5, globe: 80, material: 8, gear: 85 } }, minion: { gold: 150, goldMul: 1.2, w: { potion: 30, globe: 150, material: 20, gear: 200 } } };
  for (const rank of ['normal', 'minion']) {
    const tc = TREASURE.find(t => t.id === rank);
    const o = OLD[rank];
    const sumW = Object.values(tc.w).reduce((a, b) => a + b, 0);
    assert.equal(sumW, 1000, rank);
    for (const k of ['potion', 'globe', 'material', 'gear']) assert.equal(tc.w[k], o.w[k], `${rank}.${k} 그대로`);
    assert.ok(tc.w.gold > o.gold && tc.goldMul < o.goldMul, `${rank}: 더 자주 · 더 작게`);
    let drift = 0;
    for (let L = 1; L <= 30; L++) {
      const g = riftRow(L).goldMul;
      const before = (o.gold / 1000) * expectedGoldPile(GOLD.base * o.goldMul * g);
      const after = expectedPerKill({ rank, level: L }).goldAmount;
      const r = after / before - 1;
      drift += r;
      assert.ok(Math.abs(r) <= (L >= 2 && L <= 5 ? 0.04 : 0.01), `${rank} 균열 ${L}: ${before.toFixed(3)} → ${after.toFixed(3)}`);
    }
    assert.ok(Math.abs(drift / 30) <= 0.005, `${rank} 평균 ${(drift / 30 * 100).toFixed(2)}%`);
  }
  const pNormal = TREASURE.find(t => t.id === 'normal').w.gold / 1000;
  assert.ok(pNormal >= 0.25 && pNormal <= 0.35, `일반 처치 골드 확률 ${pNormal}`);
  // 굴림 표본(rollDrops) — 균열 5 일반 처치 6만 번의 골드 더미 수 · 골드 합이 이론과 ±3% 안
  const rng = makeRng(seedRng(4242));
  let n = 0;
  const newId = () => 'g' + (++n);
  let piles = 0, gold = 0;
  const N = 60000;
  for (let i = 0; i < N; i++) {
    for (const d of rollDrops(rng, { rank: 'normal', level: 5, cls: 'warrior', newId, blpOn: false }).drops) if (d.kind === 'gold') { piles++; gold += d.amount; }
  }
  const th = expectedPerKill({ rank: 'normal', level: 5 });
  assert.ok(Math.abs(piles / N / th.gold - 1) < 0.03, `더미 ${piles / N} vs ${th.gold}`);
  assert.ok(Math.abs(gold / N / th.goldAmount - 1) < 0.03, `골드 ${gold / N} vs ${th.goldAmount}`);
});
