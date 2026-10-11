// OWNER: P5 — 계약 §12.2 · §5.13-4 · §6.10
// rollItem · makeItem · itemValue · tierFor · affixValue · rerollAffix — 옵션 수 · 접두/접미 상한 · 중복 없음 · 티어 ilvl 규칙 · 값 범위(pow 배율) ·
// 클래스 편향 · 이름 키 · 가치 식 · 결정성 · 입력 불변.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BASES, BASE_TIERS, ITEM } from '../src/data/items.js';
import { AFFIX_TIERS, ITEM_AFFIXES } from '../src/data/itemAffixes.js';
import { RARITY } from '../src/data/drops.js';
import { LEGENDARIES, SETS } from '../src/data/legendaries.js';
import { GROWTH } from '../src/data/rift.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { ITEM_AFFIXES_BY_ID, activesOf, affixesFor, getBase } from '../src/data/index.js';
import { affixValue, itemValue, makeItem, rerollAffix, rollItem, tierFor } from '../src/sim/loot/rollItem.js';
import { affixCountDist, tierDist } from '../src/sim/loot/theory.js';

const rngOf = (seed) => makeRng(seedRng(seed));
let seq = 0;
const newId = () => 'r' + ++seq;
const kindOf = (a) => ITEM_AFFIXES_BY_ID[a.id].kind;

/** 값 범위 검사(티어 범위 × pow 배율 · decimals 반올림 포함) */
function assertAffixInRange(a, ilvl, where) {
  const def = ITEM_AFFIXES_BY_ID[a.id];
  assert.ok(def, `${where}: 모르는 옵션 ${a.id}`);
  assert.ok(a.tier >= 1 && a.tier <= 5, `${where}: tier ${a.tier}`);
  assert.ok(AFFIX_TIERS.minIlvl[a.tier - 1] <= ilvl, `${where}: ilvl ${ilvl} 에 열리지 않은 티어 ${a.tier}`);
  const k = def.scale === 'pow' ? GROWTH.item ** (ilvl - 1) : 1;
  const [lo, hi] = def.tiers[a.tier - 1];
  const step = 10 ** -def.decimals / 2 + 1e-9;
  assert.ok(a.value >= lo * k - step && a.value <= hi * k + step, `${where}: ${a.id} T${a.tier} 값 ${a.value} ∉ [${lo * k}, ${hi * k}]`);
  assert.equal(a.value, Math.round(a.value * 10 ** def.decimals) / 10 ** def.decimals, `${where}: decimals ${def.decimals}`);
}

test('옵션 수: 일반 0 · 마법 1~2 · 희귀 3~6(가중치) · 전설 = 행의 affixes 범위 · 세트 3~4 — 분포가 affixCountDist 와 같다', () => {
  const rng = rngOf(11);
  const N = 6000;
  for (const rarity of ['normal', 'magic', 'rare', 'set', 'legendary']) {
    /** @type {Record<number, number>} */
    const cnt = {};
    for (let i = 0; i < N; i++) {
      const leg = LEGENDARIES[i % LEGENDARIES.length];
      const piece = SETS[i % SETS.length].pieces[i % 4];
      const baseId = rarity === 'legendary' ? leg.baseId : rarity === 'set' ? piece.baseId : BASES[i % BASES.length].id;
      const it = rollItem(rng, { baseId, tier: 0, rarity, ilvl: 10, cls: 'warrior', newId, legendaryId: rarity === 'legendary' ? leg.id : null, setPieceId: rarity === 'set' ? piece.id : null });
      assert.equal(it.rarity, rarity);
      if (rarity === 'legendary') assert.ok(it.affixes.length >= leg.affixes[0] && it.affixes.length <= leg.affixes[1], `전설 ${leg.id} 옵션 수 ${it.affixes.length}`);
      cnt[it.affixes.length] = (cnt[it.affixes.length] ?? 0) + 1;
    }
    const want = affixCountDist(rarity);
    for (const k of new Set([...Object.keys(cnt), ...Object.keys(want)])) {
      const p = (cnt[k] ?? 0) / N;
      assert.ok(Math.abs(p - (want[k] ?? 0)) < 0.025, `${rarity} 옵션 ${k}개: ${p.toFixed(3)} vs ${(want[k] ?? 0).toFixed(3)}`);
    }
  }
});

test('접두 ≤ maxPrefix · 접미 ≤ maxSuffix · 같은 옵션 중복 없음 · 순서 = 접두 먼저 · 모든 부위에서 희귀 6옵션이 3/3 으로 나온다', () => {
  const rng = rngOf(12);
  let six = 0;
  for (let i = 0; i < 4000; i++) {
    const base = BASES[i % BASES.length];
    for (const rarity of ['magic', 'rare']) {
      const it = rollItem(rng, { baseId: base.id, tier: 0, rarity, ilvl: 1 + (i % 30), cls: i % 2 ? 'mage' : 'warrior', newId });
      const pre = it.affixes.filter(a => kindOf(a) === 'prefix').length;
      const suf = it.affixes.filter(a => kindOf(a) === 'suffix').length;
      assert.ok(pre <= ITEM.maxPrefix[rarity] && suf <= ITEM.maxSuffix[rarity], `${rarity} ${base.id}: 접두 ${pre} · 접미 ${suf}`);
      assert.equal(new Set(it.affixes.map(a => a.id)).size, it.affixes.length, '중복 옵션');
      const kinds = it.affixes.map(kindOf);
      assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a === 'prefix' ? -1 : 1)), '접두 먼저');
      for (const a of it.affixes) assert.ok(ITEM_AFFIXES_BY_ID[a.id].slots.includes(base.slot), `${a.id} 는 ${base.slot} 에 안 붙는다`);
      if (rarity === 'rare' && it.affixes.length === 6) { six++; assert.equal(pre, 3); assert.equal(suf, 3); }
    }
  }
  assert.ok(six > 100, `희귀 6옵션 ${six}`);
});

test('티어: ilvl 이 연 티어만(minIlvl 1 · 6 · 12 · 18 · 24) · 분포 = tierDist · 값은 티어 범위 안(pow 는 × GROWTH.item^(ilvl−1)) · decimals', () => {
  const rng = rngOf(13);
  for (const ilvl of [1, 5, 6, 11, 12, 17, 18, 23, 24, 30]) {
    const counts = [0, 0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < 1500; i++) {
      const base = BASES[i % BASES.length];
      const it = rollItem(rng, { baseId: base.id, tier: 0, rarity: 'rare', ilvl, cls: 'mage', newId });
      for (const a of it.affixes) { assertAffixInRange(a, ilvl, `ilvl ${ilvl}`); counts[a.tier - 1]++; total++; }
    }
    const want = tierDist(ilvl);
    for (let t = 0; t < 5; t++) {
      if (want[t] === 0) assert.equal(counts[t], 0, `ilvl ${ilvl} T${t + 1} 가 나왔다`);
      else assert.ok(Math.abs(counts[t] / total - want[t]) < 0.02, `ilvl ${ilvl} T${t + 1}: ${(counts[t] / total).toFixed(3)} vs ${want[t].toFixed(3)}`);
    }
  }
  // tierFor · affixValue 단독
  const r2 = rngOf(14);
  for (let i = 0; i < 2000; i++) assert.equal(tierFor(r2, 1), 1);
  for (let i = 0; i < 2000; i++) assert.ok(tierFor(r2, 7) <= 2);
  const regen = ITEM_AFFIXES_BY_ID.lifeRegen;
  for (let i = 0; i < 500; i++) {
    const v = affixValue(r2, regen, 5, 21);
    const k = GROWTH.item ** 20;
    assert.ok(v >= 3.4 * k - 0.05 && v <= 4.6 * k + 0.05, `lifeRegen T5 ilvl 21 = ${v}`);
    assert.equal(v, Math.round(v * 10) / 10);
  }
  const str = ITEM_AFFIXES_BY_ID.str;
  for (let i = 0; i < 500; i++) { const v = affixValue(r2, str, 3, 30); assert.ok(Number.isInteger(v) && v >= 16 && v <= 25, `str T3 flat ${v}`); }
});

test('클래스 편향: 주 능력치 옵션은 아이템 클래스(공용이면 굴리는 캐릭터)의 것이 mainBias / offMainBias(= 10배) 더 자주 나온다', () => {
  const rng = rngOf(15);
  /** @param {string} baseId @param {string} cls */
  const ratio = (baseId, cls) => {
    let s = 0, n = 0;
    for (let i = 0; i < 6000; i++) {
      const it = rollItem(rng, { baseId, tier: 0, rarity: 'magic', ilvl: 5, cls, newId });
      for (const a of it.affixes) { if (a.id === 'str') s++; if (a.id === 'int') n++; }
    }
    return { s, n };
  };
  const want = ITEM.mainBias / ITEM.offMainBias;
  const w = ratio('ring', 'warrior');   // 공용 · 전사가 굴림 → str
  assert.ok(w.s / w.n > want * 0.7 && w.s / w.n < want * 1.4, `전사 반지 str/int ${w.s}/${w.n}`);
  const m = ratio('ring', 'mage');
  assert.ok(m.n / m.s > want * 0.7 && m.n / m.s < want * 1.4, `마법사 반지 int/str ${m.n}/${m.s}`);
  const wand = ratio('wand', 'warrior');   // 마법사 무기 — 아이템 클래스(mage)를 따른다
  assert.ok(wand.n > wand.s * 5, `전사가 주운 마법봉 int/str ${wand.n}/${wand.s}`);
});

test('skillPct 옵션의 param = 그 클래스(공용이면 굴리는 캐릭터) 액티브 노드 6개 중 하나 · 고르게', () => {
  const rng = rngOf(16);
  for (const cls of ['warrior', 'mage']) {
    const ids = activesOf(cls).map(n => n.id);
    assert.equal(ids.length, 6);
    /** @type {Record<string, number>} */
    const seen = {};
    for (let i = 0; i < 4000; i++) {
      const it = rollItem(rng, { baseId: 'amulet', tier: 0, rarity: 'rare', ilvl: 8, cls, newId });
      for (const a of it.affixes) if (a.id === 'skillDmg') { assert.ok(ids.includes(a.param), `${cls} skillDmg param ${a.param}`); seen[a.param] = (seen[a.param] ?? 0) + 1; }
      for (const a of it.affixes) if (a.id !== 'skillDmg') assert.equal(a.param, undefined);
    }
    const n = Object.values(seen);
    assert.equal(n.length, 6);
    assert.ok(Math.min(...n) > Math.max(...n) * 0.6, `${cls} 고르지 않다 ${JSON.stringify(seen)}`);
  }
  const orb = rollItem(rngOf(3), { baseId: 'orb', tier: 0, rarity: 'rare', ilvl: 8, cls: 'warrior', newId });
  for (const a of orb.affixes) if (a.param) assert.ok(activesOf('mage').some(n => n.id === a.param), '마법구는 마법사 스킬');
});

test('이름 키: 일반 [base] · 마법 [접미어?, 접두어?, base] · 희귀 [rare.a.i, rare.b.j](0..23) · 전설 [leg.id] · 세트 [setp.piece] — 전부 문자열 표에 있다', () => {
  const rng = rngOf(17);
  for (let i = 0; i < 3000; i++) {
    const base = BASES[i % BASES.length];
    const tier = i % 3;
    for (const rarity of ['normal', 'magic', 'rare']) {
      const it = rollItem(rng, { baseId: base.id, tier, rarity, ilvl: 20, cls: 'warrior', newId });
      for (const k of it.name) assert.ok(STRINGS[k] !== undefined, `문자열 키 없음 ${k}`);
      if (rarity === 'normal') assert.deepEqual(it.name, [`base.${base.id}.${tier}`]);
      if (rarity === 'magic') {
        const suf = it.affixes.find(a => kindOf(a) === 'suffix');
        const pre = it.affixes.find(a => kindOf(a) === 'prefix');
        assert.deepEqual(it.name, [...(suf ? [`afx.${suf.id}.s`] : []), ...(pre ? [`afx.${pre.id}.p`] : []), `base.${base.id}.${tier}`]);
      }
      if (rarity === 'rare') {
        assert.equal(it.name.length, 2);
        assert.match(it.name[0], /^rare\.a\.(\d|1\d|2[0-3])$/);
        assert.match(it.name[1], /^rare\.b\.(\d|1\d|2[0-3])$/);
      }
    }
  }
  for (const l of LEGENDARIES) {
    const it = rollItem(rng, { baseId: l.baseId, tier: 2, rarity: 'legendary', ilvl: 25, cls: 'mage', newId, legendaryId: l.id });
    assert.deepEqual(it.name, ['leg.' + l.id]);
    assert.equal(it.legendaryId, l.id);
    assert.equal(it.cls, l.cls ?? getBase(l.baseId).cls, `${l.id} 클래스`);
  }
  for (const s of SETS) for (const p of s.pieces) {
    const it = rollItem(rng, { baseId: p.baseId, tier: 0, rarity: 'set', ilvl: 3, cls: 'warrior', newId, setPieceId: p.id });
    assert.deepEqual(it.name, ['setp.' + p.id]);
    assert.equal(it.setId, s.id);
    assert.equal(it.cls, s.cls, '세트 조각은 세트 클래스 전용');
  }
});

test('기본 값: v ∈ [0.9, 1.1) 각자 · dmg/armor/bonus 정수 · 최대 ≥ 최소 + 1 · aps · block · mana 그대로 · 단계 배율 · GROWTH.item^(ilvl−1)', () => {
  const rng = rngOf(18);
  for (let i = 0; i < 3000; i++) {
    const b = BASES[i % BASES.length];
    const tier = i % 3;
    const ilvl = 1 + (i % 30);
    const it = rollItem(rng, { baseId: b.id, tier, rarity: 'normal', ilvl, cls: 'warrior', newId });
    const mul = BASE_TIERS[tier].mul * GROWTH.item ** (ilvl - 1);
    /** @param {number} x @param {number} got */
    const within = (x, got) => got >= Math.round(x * mul * 0.9) - 1 && got <= Math.round(x * mul * 1.1) + 1;
    if (b.dmg) {
      assert.ok(Number.isInteger(it.base.dmg[0]) && Number.isInteger(it.base.dmg[1]) && it.base.dmg[1] >= it.base.dmg[0] + 1);
      assert.ok(within(b.dmg[0], it.base.dmg[0]) && within(b.dmg[1], it.base.dmg[1]), `${b.id} dmg ${it.base.dmg}`);
      assert.equal(it.base.aps, b.aps);
    }
    if (b.armor !== undefined) { assert.ok(Number.isInteger(it.base.armor) && within(b.armor, it.base.armor), `${b.id} armor ${it.base.armor}`); }
    if (b.block !== undefined) assert.equal(it.base.block, b.block);
    if (b.mana !== undefined) assert.equal(it.base.mana, b.mana);
    if (b.bonus) assert.ok(it.base.bonus[1] >= it.base.bonus[0] + 1);
    assert.equal(it.reqLevel, ilvl);
    assert.equal(it.tier, tier);
    assert.equal(it.dur, ITEM.durMax);
    assert.equal(it.rerollIdx, null);
    assert.equal(it.rerolls, 0);
  }
  // 한 굴림의 v 하나가 최소 · 최대 둘 다에 — 검 3~7 의 비가 거의 그대로
  const sw = rollItem(rngOf(5), { baseId: 'sword', tier: 0, rarity: 'normal', ilvl: 30, cls: 'warrior', newId });
  assert.ok(Math.abs(sw.base.dmg[1] / sw.base.dmg[0] - 7 / 3) < 0.05, `검 비 ${sw.base.dmg}`);
});

test('가치 식(§7.10): round(slotValue[slotKey] × RARITY.value × GROWTH.gold^(ilvl−1)) · 주무기는 손 수로 1h · 2h', () => {
  const rng = rngOf(19);
  for (let i = 0; i < 400; i++) {
    const b = BASES[i % BASES.length];
    for (const rarity of ['normal', 'magic', 'rare']) {
      const ilvl = 1 + (i % 30);
      const it = rollItem(rng, { baseId: b.id, tier: 0, rarity, ilvl, cls: 'warrior', newId });
      const key = b.slot === 'mainHand' ? (b.hands === 2 ? 'mainHand2h' : 'mainHand1h') : b.slot;
      assert.equal(it.value, Math.round(ITEM.slotValue[key] * RARITY.value[rarity] * GROWTH.gold ** (ilvl - 1)));
      assert.equal(itemValue(it), it.value);
    }
  }
  assert.equal(itemValue(makeItem({ baseId: 'greataxe', id: 'v1' })), 30);
  assert.equal(itemValue(makeItem({ baseId: 'ring', rarity: 'rare', ilvl: 5, id: 'v2' })), Math.round(15 * 6 * 1.14 ** 4));
});

test('결정성 · 입력 불변: 같은 시드 = 같은 아이템 · rng 줄기 밖의 난수 없음 · 옵션 객체를 넘겨도 고치지 않는다', () => {
  const opts = Object.freeze({ baseId: 'staff', tier: 1, rarity: 'rare', ilvl: 14, cls: 'mage', legendaryId: null, setPieceId: null });
  let k1 = 0, k2 = 0;
  const a = [], b = [];
  const r1 = rngOf(77), r2 = rngOf(77);
  for (let i = 0; i < 50; i++) a.push(rollItem(r1, { ...opts, newId: () => 'x' + ++k1 }));
  for (let i = 0; i < 50; i++) b.push(rollItem(r2, { ...opts, newId: () => 'x' + ++k2 }));
  assert.deepEqual(a, b);
  assert.deepEqual(r1.state, r2.state);
  const r3 = rngOf(78);
  const c = rollItem(r3, { ...opts, newId: () => 'x1' });
  assert.notDeepEqual(c, a[0]);
});

test('makeItem: 난수 없이 v = 1 · 받은 옵션을 복사 · 시작 검 3~7 · 갑옷 12 · 단계 · ilvl 배율 · 전설/세트 필드와 클래스', () => {
  const sw = makeItem({ baseId: 'sword', id: 'm1' });
  assert.deepEqual(sw.base, { dmg: [3, 7], aps: 1.4 });
  assert.equal(sw.cls, 'warrior');
  assert.deepEqual(sw.name, ['base.sword.0']);
  assert.equal(makeItem({ baseId: 'chest', id: 'm2' }).base.armor, 12);
  const hi = makeItem({ baseId: 'chest', tier: 2, ilvl: 20, id: 'm3' });
  assert.equal(hi.base.armor, Math.round(12 * 1.12 * 1.1 ** 19));
  const affs = [{ id: 'vit', tier: 1, value: 4 }];
  const it = makeItem({ baseId: 'ring', rarity: 'magic', affixes: affs, id: 'm4' });
  it.affixes[0].value = 99;
  assert.equal(affs[0].value, 4, '받은 옵션 객체를 공유하지 않는다');
  assert.deepEqual(it.name, ['afx.vit.s', 'base.ring.0']);
  const leg = makeItem({ baseId: 'helm', rarity: 'legendary', legendaryId: 'ragingHorn', id: 'm5' });
  assert.equal(leg.legendaryId, 'ragingHorn');
  assert.equal(leg.cls, 'warrior');
  const st = makeItem({ baseId: 'gloves', rarity: 'set', setPieceId: 'ashSageGloves', id: 'm6' });
  assert.equal(st.setId, 'ashSage');
  assert.equal(st.cls, 'mage');
  assert.equal(makeItem({ baseId: 'amulet', rarity: 'legendary', legendaryId: 'bloodPact', id: 'm7' }).cls, null, '공용 전설');
  // 이상한 입력 — 단계 · ilvl 을 자른다
  const odd = makeItem({ baseId: 'axe', tier: 9, ilvl: -3, id: 'm8' });
  assert.equal(odd.tier, 2);
  assert.equal(odd.ilvl, 1);
});

test('rerollAffix: 같은 kind · 다른 옵션과 중복 없음 · 그 ilvl 티어 규칙 · 값 범위 · 아이템을 고치지 않는다 · 결정성 · 틀린 인덱스는 null', () => {
  const rng = rngOf(21);
  for (let i = 0; i < 1500; i++) {
    const b = BASES[i % BASES.length];
    const ilvl = 1 + (i % 30);
    const it = rollItem(rng, { baseId: b.id, tier: 0, rarity: 'rare', ilvl, cls: i % 2 ? 'mage' : 'warrior', newId });
    const before = JSON.stringify(it);
    const idx = i % it.affixes.length;
    const cand = rerollAffix(rng, it, idx, 'warrior');
    assert.ok(cand, 'candidate');
    assert.equal(kindOf(cand), kindOf(it.affixes[idx]), 'same kind');
    const others = it.affixes.filter((_, j) => j !== idx).map(a => a.id);
    assert.ok(!others.includes(cand.id), `중복 ${cand.id}`);
    assert.ok(affixesFor(b.slot).some(d => d.id === cand.id), '그 부위의 옵션');
    assertAffixInRange(cand, ilvl, 'reroll');
    if (ITEM_AFFIXES_BY_ID[cand.id].param) assert.ok(typeof cand.param === 'string');
    assert.equal(JSON.stringify(it), before, '아이템을 고치지 않는다');
  }
  const it = rollItem(rngOf(4), { baseId: 'helm', tier: 0, rarity: 'rare', ilvl: 9, cls: 'warrior', newId });
  assert.deepEqual(rerollAffix(rngOf(9), it, 0, 'warrior'), rerollAffix(rngOf(9), it, 0, 'warrior'));
  assert.equal(rerollAffix(rngOf(9), it, 99, 'warrior'), null);
  assert.equal(rerollAffix(rngOf(9), makeItem({ baseId: 'helm', id: 'n' }), 0, 'warrior'), null);
});

test('데이터: 모든 옵션이 어느 부위에선가 · 모든 부위가 접두 ≥ 3 · 접미 ≥ 3(희귀 6옵션이 늘 가능)', () => {
  for (const a of ITEM_AFFIXES) assert.ok(a.slots.length > 0, a.id);
  for (const s of ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring']) {
    const pool = affixesFor(s);
    assert.ok(pool.filter(a => a.kind === 'prefix').length >= 3, `${s} 접두`);
    assert.ok(pool.filter(a => a.kind === 'suffix').length >= 3, `${s} 접미`);
  }
});
