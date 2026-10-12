// OWNER: P5 — 계약 §12.2 · §5.13 · §6.10
// rollDrops · rollRarity · rollGear · createDropSim — 10만 회 시뮬 vs 이론값(등급 · 부위 · 옵션 수 · 옵션 티어 · 상대 오차 ≤ 3% · 빈도 1% 이상 칸) ·
// MF 수확 체감 · 불운 보정 상한 400 · 보장 드랍 · 부위 고르기 · 후보 없으면 희귀 · 결정성 · 입력 불변.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_SLOTS, MATERIAL_IDS, RARITIES } from '../src/core/constants.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BASE_TIERS, ITEM, SLOT_WEIGHTS } from '../src/data/items.js';
import { BLP, GOLD, TREASURE } from '../src/data/drops.js';
import { LEGENDARIES_BY_ID, getBase } from '../src/data/index.js';
import { riftRow } from '../src/data/rift.js';
import { rollDrops, rollGear, rollRarity } from '../src/sim/loot/rollDrops.js';
import { createDropSim } from '../src/sim/loot/simulate.js';
import { affixCountDist, expectedPerKill, rarityDist, slotDist, tierDist } from '../src/sim/loot/theory.js';

const rngOf = (seed) => makeRng(seedRng(seed));
let seq = 0;
const newId = () => 'd' + ++seq;
const REL = 0.03;

/**
 * 계약 목표: 빈도 1% 이상 칸의 상대 오차 ≤ 3%(고정 시드) · 치우침 검사: 모든 칸이 표본 오차 4.5σ 안(시드를 바꿔도 견딘다 — 실제 치우침만 잡는다)
 * @param {Record<string, number>} counts @param {number} total @param {Record<string, number>} want
 */
function assertMatches(counts, total, want, label) {
  let checked = 0;
  for (const k of Object.keys(want)) {
    const p = want[k];
    const got = (counts[k] ?? 0) / total;
    if (p <= 0) { assert.equal(counts[k] ?? 0, 0, `${label} ${k}: 이론 0 인데 나왔다`); continue; }
    const z = Math.abs(got - p) / Math.sqrt((p * (1 - p)) / total);
    assert.ok(z <= 4.5, `${label} ${k}: 시뮬 ${got} vs 이론 ${p} — ${z.toFixed(2)}σ 치우침`);
    if (p < 0.01) continue;
    checked++;
    assert.ok(Math.abs(got - p) / p <= REL, `${label} ${k}: 시뮬 ${(got * 100).toFixed(3)}% vs 이론 ${(p * 100).toFixed(3)}% (상대 ${(Math.abs(got - p) / p * 100).toFixed(2)}%)`);
  }
  for (const k of Object.keys(counts)) if (!(k in want)) assert.equal(counts[k], 0, `${label} ${k}: 이론에 없는 칸`);
  assert.ok(checked > 0, `${label}: 비교한 칸 없음`);
}

test('10만 회 등급 굴림 vs rarityDist(일반 · 챔피언 · 엘리트 · 수호자 보장 · L1/L10/L25 · MF 0/150%): 상대 오차 ≤ 3%', () => {
  const N = 100000;
  const cases = [
    { rank: 'normal', level: 1, mf: 0 }, { rank: 'champion', level: 10, mf: 0 }, { rank: 'elite', level: 25, mf: 1.5 },
    { rank: 'guardian', level: 5, mf: 0, guaranteed: true },
  ];
  for (const c of cases) {
    const rng = rngOf(1000 + c.level);
    /** @type {Record<string, number>} */
    const cnt = {};
    for (let i = 0; i < N; i++) { const r = rollRarity(rng, { ...c, blp: 0, blpOn: false }).rarity; cnt[r] = (cnt[r] ?? 0) + 1; }
    assertMatches(cnt, N, rarityDist(c), `${c.rank} L${c.level}${c.guaranteed ? ' 보장' : ''}`);
    if (c.guaranteed) { assert.equal(cnt.normal ?? 0, 0); assert.equal(cnt.magic ?? 0, 0); }
  }
});

test('10만 처치 시뮬(createDropSim · 엘리트 L12 · 불운 보정 끔) vs 이론: 장비 수 · 등급 · 부위(전설 · 세트 부위 섞음) · 옵션 수 · 옵션 티어 · 골드 ≤ 3%', () => {
  const opts = { rank: 'elite', level: 12, cls: 'mage', mf: 0, blpOn: false, seed: 3 };
  const sim = createDropSim(opts);
  assert.equal(sim.run(60000), 60000);
  assert.equal(sim.run(40000), 40000);
  const r = sim.result();
  assert.equal(r.kills, 100000);
  const e = expectedPerKill({ rank: 'elite', level: 12 });
  assert.ok(Math.abs(r.gear / r.kills - e.gear) / e.gear <= REL, `장비/처치 ${r.gear / r.kills} vs ${e.gear}`);
  assert.ok(Math.abs(r.gold / r.kills - e.gold) / e.gold <= REL, `골드 더미/처치 ${r.gold / r.kills} vs ${e.gold}`);
  assert.ok(Math.abs(r.goldAmount / r.kills - e.goldAmount) / e.goldAmount <= REL, `골드/처치 ${r.goldAmount / r.kills} vs ${e.goldAmount}`);
  const rd = rarityDist({ rank: 'elite', level: 12 });
  assertMatches(r.byRarity, r.gear, rd, '등급');
  assertMatches(r.bySlot, r.gear, slotDist('mage', { rank: 'elite', level: 12 }), '부위');
  /** @type {Record<string, number>} */
  const ac = {};
  for (const rar of RARITIES) for (const [k, p] of Object.entries(affixCountDist(rar))) ac[k] = (ac[k] ?? 0) + rd[rar] * p;
  assertMatches(r.affixCount, r.gear, ac, '옵션 수');
  const tiers = Object.fromEntries(r.tiers.map((n, i) => [i, n]));
  const nt = r.tiers.reduce((a, b) => a + b, 0);
  assertMatches(tiers, nt, Object.fromEntries(tierDist(12).map((p, i) => [i, p])), '옵션 티어');
  assert.ok(Math.abs(Object.values(r.bySlot).reduce((a, b) => a + b, 0) - r.gear) === 0);
});

test('createDropSim: 같은 시드 = 같은 결과(나눠 부른 크기와 무관) · reset · result 는 사본 · 일반 등급 기대값', () => {
  const a = createDropSim({ rank: 'champion', level: 3, cls: 'warrior', seed: 7 });
  const b = createDropSim({ rank: 'champion', level: 3, cls: 'warrior', seed: 7 });
  a.run(3000);
  for (let i = 0; i < 30; i++) b.run(100);
  assert.deepEqual(a.result(), b.result());
  const snap = a.result();
  snap.byRarity.magic = -1; snap.killsToLegendary.push(-1);
  assert.notEqual(a.result().byRarity.magic, -1, 'result 는 사본');
  a.reset();
  assert.equal(a.result().kills, 0);
  a.run(3000);
  assert.deepEqual(a.result(), b.result(), 'reset 뒤 같은 시드로 다시');
  assert.equal(a.run(-5), 0); assert.equal(a.run(NaN), 0);
  const n = createDropSim({ rank: 'normal', level: 5, cls: 'warrior', seed: 9, blpOn: false });
  n.run(100000);
  const nr = n.result();
  const e = expectedPerKill({ rank: 'normal', level: 5 });
  assert.ok(Math.abs(nr.gear / nr.kills - e.gear) / e.gear <= REL, `일반 장비/처치 ${nr.gear / nr.kills}`);
  assertMatches(nr.byRarity, nr.gear, rarityDist({ rank: 'normal', level: 5 }), '일반 L5 등급');
  const sp = createDropSim({ rank: 'spawn', level: 5, cls: 'warrior' });
  sp.run(100);
  assert.equal(sp.result().gear, 0, '드랍 묶음 없는 등급');
});

test('아이템 발견 MF 0 / 100 / 300 / 600%: 희귀 이상 비율이 늘고 증가분이 줄어든다(시뮬 10만 등급 굴림 · 이론과 같다)', () => {
  const N = 100000;
  const v = [];
  for (const mf of [0, 1, 3, 6]) {
    const rng = rngOf(500 + mf);
    let rp = 0;
    for (let i = 0; i < N; i++) { const r = rollRarity(rng, { rank: 'normal', level: 5, mf, blpOn: false }).rarity; if (r === 'rare' || r === 'legendary' || r === 'set') rp++; }
    const d = rarityDist({ rank: 'normal', level: 5, mf });
    const want = d.rare + d.legendary + d.set;
    assert.ok(Math.abs(rp / N - want) / want <= REL, `MF ${mf}: ${rp / N} vs ${want}`);
    v.push(rp / N);
  }
  assert.ok(v[0] < v[1] && v[1] < v[2] && v[2] < v[3], `증가 ${v}`);
  const inc = [v[1] - v[0], v[2] - v[1], v[3] - v[2]];
  assert.ok(inc[0] > inc[1] && inc[1] > inc[2], `증가분 감소 ${inc}`);
});

test('불운 보정: 켬 → 전설 · 세트 사이 장비 드랍 수 최대 ≤ 400(BLP.hard) · 끔은 그보다 길다 · 켬의 전설 비율이 더 높다 · 400 에서 강제 전설 · 리셋', () => {
  const N = 300000;
  for (const on of [true, false]) {
    const rng = rngOf(on ? 31 : 32);
    let blp = 0, gap = 0, maxGap = 0, legs = 0;
    for (let i = 0; i < N; i++) {
      const r = rollRarity(rng, { rank: 'normal', level: 1, blp, blpOn: on });
      if (r.rarity === 'legendary' || r.rarity === 'set') { maxGap = Math.max(maxGap, gap); gap = 0; assert.equal(r.blp, 0); }
      else { gap++; assert.equal(r.blp, blp + 1); }
      if (r.rarity === 'legendary') legs++;
      blp = r.blp;
    }
    if (on) { assert.ok(maxGap <= BLP.hard, `켬 최대 ${maxGap}`); assert.ok(legs / N > rarityDist({ rank: 'normal', level: 1 }).legendary * 1.2, `켬 전설 비율 ${legs / N}`); }
    else assert.ok(maxGap > BLP.hard, `끔 최대 ${maxGap} — 보정이 없으면 400 을 넘는 구간이 생긴다`);
  }
  const rng = rngOf(33);
  const forced = rollRarity(rng, { rank: 'normal', level: 1, blp: BLP.hard, blpOn: true });
  assert.deepEqual(forced, { rarity: 'legendary', blp: 0 });
  const st = { ...rng.state };
  rollRarity(rng, { rank: 'normal', level: 1, blp: 999, blpOn: true });
  assert.deepEqual(rng.state, st, '강제 전설은 난수를 쓰지 않는다');
  // 시뮬레이터 집계: 켬이면 maxGearGap ≤ 400
  const sim = createDropSim({ rank: 'champion', level: 1, cls: 'warrior', seed: 5, blpOn: true });
  sim.run(150000);
  const r = sim.result();
  assert.ok(r.maxGearGap <= BLP.hard, `시뮬 maxGearGap ${r.maxGearGap}`);
  assert.ok(r.killsToLegendary.length > 50 && r.killsToLegendary.every(k => k >= 1));
  assert.ok(r.killsToLegendary.length <= r.byRarity.legendary, '전설이 나온 처치마다 하나');
  assert.ok(r.killsToLegendary.reduce((a, b) => a + b, 0) <= r.kills, '구간 합 ≤ 처치 수');
});

test('보장 드랍(수호자): 처치마다 희귀 이상 ≥ 2 · 드랍 모양(DropRoll) · 골드 정수 ≥ 1 · 재료 ID · gf 적용 · 입력 불변 · 결정성', () => {
  const rng = rngOf(61);
  for (let i = 0; i < 300; i++) {
    const opts = Object.freeze({ rank: 'guardian', level: 1 + (i % 30), cls: i % 2 ? 'warrior' : 'mage', mf: 0, gf: 0, blp: 3, blpOn: true, newId });
    const { drops, blp } = rollDrops(rng, opts);
    const gear = drops.filter(d => d.kind === 'item');
    assert.ok(gear.filter(d => ['rare', 'legendary', 'set'].includes(d.item.rarity)).length >= 2, '희귀 이상 2');
    assert.ok(Number.isInteger(blp) && blp >= 0);
    for (const d of drops) {
      assert.deepEqual(Object.keys(d).sort(), ['amount', 'item', 'kind', 'mat']);
      assert.ok(['item', 'gold', 'potion', 'globe', 'material'].includes(d.kind));
      if (d.kind === 'gold') assert.ok(Number.isInteger(d.amount) && d.amount >= 1);
      if (d.kind === 'material') assert.ok(MATERIAL_IDS.includes(d.mat));
      else assert.equal(d.mat, null);
      if (d.kind === 'item') { assert.equal(d.item.ilvl, riftRow(opts.level).ilvl); assert.equal(d.amount, 1); }
      else assert.equal(d.item, null);
    }
  }
  // gf: 골드 더미 × (1 + gf)
  const base = [], more = [];
  for (const [arr, gf] of [[base, 0], [more, 1]]) {
    const r = rngOf(62);
    for (let i = 0; i < 4000; i++) for (const d of rollDrops(r, { rank: 'elite', level: 10, cls: 'warrior', gf, newId }).drops) if (d.kind === 'gold') arr.push(d.amount);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(avg(more) / avg(base) - 2) < 0.03, `gf 100% → × 2 (${avg(more) / avg(base)})`);
  const lo = GOLD.base * TREASURE.find(t => t.id === 'elite').goldMul * riftRow(10).goldMul;
  assert.ok(Math.min(...base) >= Math.round(lo * GOLD.range[0]) && Math.max(...base) <= Math.round(lo * GOLD.range[1]));
  // 결정성
  let k1 = 0, k2 = 0;
  const a = rollDrops(rngOf(70), { rank: 'elite', level: 4, cls: 'mage', blp: 10, newId: () => 'z' + ++k1 });
  const b = rollDrops(rngOf(70), { rank: 'elite', level: 4, cls: 'mage', blp: 10, newId: () => 'z' + ++k2 });
  assert.deepEqual(a, b);
  // 드랍 묶음이 없는 등급 · 모르는 등급 · 이상한 blp
  assert.deepEqual(rollDrops(rngOf(1), { rank: 'spawn', level: 3, cls: 'warrior', blp: 7, newId }), { drops: [], blp: 7 });
  assert.deepEqual(rollDrops(rngOf(1), { rank: 'nope', level: 3, cls: 'warrior', blp: NaN, newId }), { drops: [], blp: 0 });
});

test('rollGear: 부위를 고른다(ring1 → ring) · slotWeights · ownClassOnly · 무기 · 보조 다른 클래스 ≈ 15% · 단계 = ilvl 이 연 것', () => {
  const rng = rngOf(81);
  for (const slot of ITEM_SLOTS) for (let i = 0; i < 40; i++) {
    const it = rollGear(rng, { rarity: 'magic', level: 7, cls: 'warrior', newId, slot });
    assert.equal(it.slot, slot);
  }
  assert.equal(rollGear(rng, { rarity: 'rare', level: 7, cls: 'warrior', newId, slot: 'ring2' }).slot, 'ring');
  const noJewel = { ...SLOT_WEIGHTS, amulet: 0, ring: 0 };
  let other = 0, weapons = 0;
  for (let i = 0; i < 6000; i++) {
    const it = rollGear(rng, { rarity: 'normal', level: 15, cls: 'mage', newId, slotWeights: noJewel });
    assert.ok(it.slot !== 'amulet' && it.slot !== 'ring', 'slotWeights 0 인 부위');
    assert.ok(BASE_TIERS[it.tier].minIlvl <= 15);
    if (it.slot === 'mainHand' || it.slot === 'offhand') { weapons++; if (it.cls !== 'mage') other++; }
    else assert.equal(it.cls, null);
  }
  assert.ok(Math.abs(other / weapons - (1 - ITEM.ownClassChance)) < 0.03, `다른 클래스 무기 ${other / weapons}`);
  for (let i = 0; i < 2000; i++) {
    const it = rollGear(rng, { rarity: 'rare', level: 4, cls: 'warrior', newId, ownClassOnly: true });
    if (it.slot === 'mainHand' || it.slot === 'offhand') assert.equal(it.cls, 'warrior');
  }
});

test('rollGear 전설 · 세트: 부위 없음 → 늘 그 등급(다른 클래스 × 0.25 · 세트 0.8) · 부위 · 클래스에 후보가 없으면 희귀 · 단계 = 열린 가장 높은 단계', () => {
  const rng = rngOf(91);
  let otherCls = 0, ownSet = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const it = rollGear(rng, { rarity: 'legendary', level: 22, cls: 'warrior', newId });
    assert.equal(it.rarity, 'legendary');
    const def = LEGENDARIES_BY_ID[it.legendaryId];
    assert.equal(it.baseId, def.baseId);
    assert.equal(it.tier, 2, 'ilvl 22 → 단계 2');
    if (def.cls === 'mage') otherCls++;
    const s = rollGear(rng, { rarity: 'set', level: 5, cls: 'warrior', newId });
    assert.equal(s.rarity, 'set'); assert.equal(s.tier, 0);
    if (s.setId === 'ironLord') ownSet++;
  }
  // 다른 클래스 전설 5 × 0.25 / (7 + 1.25)
  assert.ok(Math.abs(otherCls / N - 1.25 / 8.25) < 0.015, `다른 클래스 전설 ${otherCls / N}`);
  assert.ok(Math.abs(ownSet / N - ITEM.ownSetChance) < 0.02, `자기 세트 ${ownSet / N}`);
  // 부위를 고른 굴림(도박 · 제작): 그 부위 · 클래스에 없으면 희귀
  for (let i = 0; i < 200; i++) {
    assert.equal(rollGear(rng, { rarity: 'legendary', level: 9, cls: 'warrior', newId, slot: 'chest' }).rarity, 'rare', '갑옷 전설 없음');
    assert.equal(rollGear(rng, { rarity: 'legendary', level: 9, cls: 'warrior', newId, slot: 'offhand' }).rarity, 'rare', '전사 보조 전설 없음');
    assert.equal(rollGear(rng, { rarity: 'set', level: 9, cls: 'mage', newId, slot: 'ring' }).rarity, 'rare', '반지 세트 없음');
    const helm = rollGear(rng, { rarity: 'legendary', level: 9, cls: 'mage', newId, slot: 'helm' });
    assert.equal(helm.legendaryId, 'ashenCrown', '마법사 투구 = 잿빛 왕관만');
    assert.equal(helm.cls, 'mage');
    const sp = rollGear(rng, { rarity: 'set', level: 9, cls: 'warrior', newId, slot: 'gloves' });
    assert.equal(sp.setPieceId, 'ironLordGrips');
    const belt = rollGear(rng, { rarity: 'legendary', level: 9, cls: 'mage', newId, slot: 'belt' });
    assert.equal(belt.legendaryId, 'verdantSash', '공용 전설');
  }
  // 모르는 등급 · 이상한 레벨 · 모르는 클래스 — 던지지 않는다
  const odd = rollGear(rng, { rarity: /** @type {any} */ ('epic'), level: NaN, cls: 'nobody', newId });
  assert.equal(odd.rarity, 'normal'); assert.equal(odd.ilvl, 1);
  assert.ok(getBase(odd.baseId));
});
