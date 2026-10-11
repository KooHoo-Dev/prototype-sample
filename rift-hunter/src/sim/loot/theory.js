// OWNER: P5 — 계약 §6.10 · §5.13
// 이론 확률 — 분석 패널 「이론값」 · 테스트 · 측정. 순수 함수.
// 드랍이 쓰는 가중치(등급 · 전설 · 세트 후보)도 여기 하나에 있다 — rollDrops · rollGear 가 이 함수를 그대로 써서 이론값과 시뮬값이 같은 표를 본다.

import { CLASS_IDS, ITEM_SLOTS, RARITIES } from '../../core/constants.js';
import { BASE_TIERS, ITEM, SLOT_WEIGHTS } from '../../data/items.js';
import { AFFIX_TIERS } from '../../data/itemAffixes.js';
import { BLP, GOLD, GUARANTEE, MF, RARITY } from '../../data/drops.js';
import { LEGENDARIES, SETS } from '../../data/legendaries.js';
import { riftRow } from '../../data/rift.js';
import { BASES_BY_ID, RANKS_BY_ID, TREASURE_BY_ID } from '../../data/index.js';

/** @typedef {import('../../types.js').Rarity} Rarity */
/** @typedef {import('../../types.js').ItemSlot} ItemSlot */

const TC_KEYS = /** @type {const} */ (['none', 'gold', 'potion', 'globe', 'material', 'gear']);

/** 0 이상 유한수(아니면 0) @param {any} v */
function nonNeg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 유효 아이템 발견(수확 체감) = mf × k / (mf + k) · mf 는 비율(1.0 = 100%) — 0 → 0 · 1 → 0.667 · 3 → 1.2 · 6 → 1.5 @param {number} mf */
export function effectiveMF(mf) {
  const m = nonNeg(mf);
  return m === 0 ? 0 : (m * MF.k) / (m + MF.k);
}

/** 불운 보정 배율 = 1 + BLP.rate × min(blp, capCount) (blpOn 이 아니면 1) @param {number} blp @param {boolean} blpOn */
export function blpMultiplier(blp, blpOn) {
  return blpOn ? 1 + BLP.rate * Math.min(Math.floor(nonNeg(blp)), BLP.capCount) : 1;
}

/** 그 몬스터 등급의 드랍 묶음(TREASURE 행 · 없으면 null) @param {string} rank */
export function treasureOf(rank) {
  const rk = RANKS_BY_ID[rank];
  const tc = rk ? rk.tc : null;
  return tc ? TREASURE_BY_ID[tc] ?? null : null;
}

/**
 * 등급 굴림의 가중치(§5.13-2 — 가중치 한 번 뽑기) · 키 순서 = RARITIES(뽑기 누적 순서)
 * w.normal = RARITY.base.normal(보장이면 0) · w.r = (보장 ? GUARANTEE[r] : RARITY.base[r] × RARITY.rank[rank][r]) × rarityMul[r] × (1 + effMF × MF.scale[r]) × (전설 ? blpMul : 1)
 * @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}} opts
 * @returns {Record<Rarity, number>}
 */
export function rarityWeights({ rank, level, mf = 0, blp = 0, blpOn = false, guaranteed = false }) {
  const row = riftRow(level);
  const eff = effectiveMF(mf);
  const rk = RANKS_BY_ID[rank];
  const rankMul = /** @type {Record<string, Record<string, number>>} */ (RARITY.rank)[rank]
    ?? (rk && rk.tc ? /** @type {Record<string, Record<string, number>>} */ (RARITY.rank)[rk.tc] : null) ?? null;
  const bm = blpMultiplier(blp, blpOn);
  /** @type {Record<string, number>} */
  const w = {};
  for (const r of RARITIES) {
    if (r === 'normal') { w[r] = guaranteed ? 0 : RARITY.base.normal; continue; }
    const head = guaranteed ? /** @type {Record<string, number>} */ (GUARANTEE)[r] ?? 0
      : /** @type {Record<string, number>} */ (RARITY.base)[r] * (rankMul?.[r] ?? 1);
    const scale = /** @type {Record<string, number>} */ (MF.scale)[r] ?? 0;
    const lv = /** @type {Record<string, number>} */ (row.rarityMul)[r] ?? 1;
    w[r] = head * lv * (1 + eff * scale) * (r === 'legendary' ? bm : 1);
  }
  return /** @type {Record<Rarity, number>} */ (w);
}

/** @param {Record<string, number>} w @returns {Record<string, number>} 합 1(합이 0 이면 0 그대로) */
function normalize(w) {
  let total = 0;
  for (const k of Object.keys(w)) total += w[k] > 0 ? w[k] : 0;
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of Object.keys(w)) out[k] = total > 0 && w[k] > 0 ? w[k] / total : 0;
  return out;
}

/**
 * 등급 분포(합 1) — rollRarity 와 같은 가중치. blpOn 이고 blp ≥ BLP.hard 면 전설 1
 * @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}} opts
 * @returns {Record<Rarity, number>}
 */
export function rarityDist({ rank, level, mf = 0, blp = 0, blpOn = false, guaranteed = false }) {
  if (blpOn && Math.floor(nonNeg(blp)) >= BLP.hard) {
    /** @type {Record<string, number>} */
    const out = {};
    for (const r of RARITIES) out[r] = r === 'legendary' ? 1 : 0;
    return /** @type {Record<Rarity, number>} */ (out);
  }
  return /** @type {Record<Rarity, number>} */ (normalize(rarityWeights({ rank, level, mf, blp, blpOn, guaranteed })));
}

/** 드랍 묶음 한 번 뽑기의 확률 — 드랍 묶음이 없는 등급(spawn)은 none 1 @param {string} rank */
export function tcDist(rank) {
  const tc = treasureOf(rank);
  /** @type {Record<string, number>} */
  const out = {};
  if (!tc) {
    for (const k of TC_KEYS) out[k] = k === 'none' ? 1 : 0;
    return /** @type {{none:number, gold:number, potion:number, globe:number, material:number, gear:number}} */ (out);
  }
  let total = 0;
  for (const k of TC_KEYS) total += nonNeg(tc.w[k]);
  for (const k of TC_KEYS) out[k] = total > 0 ? nonNeg(tc.w[k]) / total : 0;
  return /** @type {{none:number, gold:number, potion:number, globe:number, material:number, gear:number}} */ (out);
}

/**
 * 골드 더미 하나의 기대값 — amount = max(1, round(c × u)) · u ~ [GOLD.range) 균등(§5.13-1 — 0.5 ~ 1.5) · 정확한 적분
 * @param {number} c GOLD.base × tc.goldMul × row.goldMul × (1 + gf)
 */
export function expectedGoldPile(c) {
  if (!(c > 0)) return 1;
  const a = c * GOLD.range[0], b = c * GOLD.range[1];
  let sum = 0;
  for (let k = Math.round(a); k <= Math.round(b); k++) {
    const lo = Math.max(a, k - 0.5), hi = Math.min(b, k + 0.5);
    if (hi > lo) sum += (hi - lo) * Math.max(1, k);
  }
  return sum / (b - a);
}

/**
 * 처치 하나의 기대값(불운 보정 끔 · 골드 획득 0) — gear = 장비 수 · gold = 골드 더미 수 · goldAmount = 기대 골드 · byRarity = 등급별 장비 수
 * @param {{rank:string, level:number, mf?:number}} opts
 */
export function expectedPerKill({ rank, level, mf = 0 }) {
  /** @type {Record<string, number>} */
  const byRarity = {};
  for (const r of RARITIES) byRarity[r] = 0;
  const out = { gear: 0, gold: 0, goldAmount: 0, potion: 0, globe: 0, material: 0, byRarity: /** @type {Record<Rarity, number>} */ (byRarity) };
  const tc = treasureOf(rank);
  if (!tc) return out;
  const p = tcDist(rank);
  const row = riftRow(level);
  const picks = nonNeg(tc.picks);
  const gearPicks = picks * p.gear;
  const guaranteed = Math.floor(nonNeg(tc.guaranteed));
  out.gear = gearPicks + guaranteed;
  out.gold = picks * p.gold;
  out.goldAmount = out.gold * expectedGoldPile(GOLD.base * tc.goldMul * row.goldMul);
  out.potion = picks * p.potion;
  out.globe = picks * p.globe;
  out.material = picks * p.material;
  const rd = rarityDist({ rank, level, mf });
  const gd = guaranteed > 0 ? rarityDist({ rank, level, mf, guaranteed: true }) : null;
  for (const r of RARITIES) byRarity[r] = gearPicks * rd[r] + (gd ? guaranteed * gd[r] : 0);
  return out;
}

/** 클래스 ID 를 아는 값으로(모르면 첫 클래스) @param {string} cls */
function clsOf(cls) {
  return CLASS_IDS.includes(/** @type {any} */ (cls)) ? cls : CLASS_IDS[0];
}

/**
 * 전설 · 세트 후보(§5.13-3 · §6.10 rollGear) — Array<{id, w}>(합이 1일 필요는 없다 · 비면 그 등급을 희귀로 내린다).
 * 전설: slot 이 있으면 그 부위 기본형만 · strict(부위를 고른 굴림 · ownClassOnly)면 자기 클래스 · 공용만, 아니면 다른 클래스 × ITEM.otherClassLegend.
 * 세트: strict 면 자기 클래스 세트만, 아니면 자기 클래스 ITEM.ownSetChance · 다른 세트 나머지 → 조각 균등(slot 이 있으면 그 부위 조각만).
 * strict 의 기본값 = (slot 을 골랐거나 ownClassOnly) — 도박 · 제작 · 재고 · 개발 장비는 「그 부위 · 클래스」의 후보만 본다.
 * @param {'legendary'|'set'} rarity @param {{slot?:string|null, cls:string, ownClassOnly?:boolean}} opts
 * @returns {Array<{id:string, w:number}>}
 */
export function specialCandidates(rarity, { slot = null, cls, ownClassOnly = false }) {
  const c = clsOf(cls);
  const s = slot ? normSlot(slot) : null;
  const strict = ownClassOnly || s !== null;
  /** @type {Array<{id:string, w:number}>} */
  const out = [];
  if (rarity === 'legendary') {
    for (const l of LEGENDARIES) {
      const base = BASES_BY_ID[l.baseId];
      if (!base || (s && base.slot !== s)) continue;
      const own = l.cls === null || l.cls === c;
      if (!own && strict) continue;
      const w = nonNeg(l.weight) * (own ? 1 : ITEM.otherClassLegend);
      if (w > 0) out.push({ id: l.id, w });
    }
    return out;
  }
  if (rarity === 'set') {
    const ownSets = SETS.filter(x => x.cls === c);
    const otherSets = strict ? [] : SETS.filter(x => x.cls !== c);
    const ownShare = ownSets.length && otherSets.length ? ITEM.ownSetChance : 1;
    /** @param {typeof SETS} group @param {number} share */
    const addGroup = (group, share) => {
      for (const set of group) {
        const pieces = set.pieces.filter(p => !s || p.slot === s);
        if (!pieces.length) continue;
        // 조각 균등(부위를 고르지 않으면 세트 안의 모든 조각 · 고르면 그 부위 조각)
        for (const p of pieces) out.push({ id: p.id, w: share / group.length / set.pieces.length });
      }
    };
    if (ownSets.length) addGroup(ownSets, ownShare);
    if (otherSets.length) addGroup(otherSets, ownSets.length ? 1 - ITEM.ownSetChance : 1);
    return out;
  }
  return out;
}

/** 장착 칸 이름(ring1 · ring2)도 아이템 부위로 · 모르는 값은 null @param {string|null|undefined} slot @returns {ItemSlot|null} */
export function normSlot(slot) {
  if (!slot) return null;
  if (slot === 'ring1' || slot === 'ring2') return 'ring';
  return ITEM_SLOTS.includes(/** @type {any} */ (slot)) ? /** @type {ItemSlot} */ (slot) : null;
}

/**
 * 부위 분포. mix 가 없으면 일반 · 마법 · 희귀 장비의 부위(= SLOT_WEIGHTS) · mix = {rank, level, mf, blp, blpOn, guaranteed}면
 * 그 드랍의 등급 분포로 전설(후보 행의 기본형 부위) · 세트(조각 부위)를 섞은 정확한 분포(createDropSim 의 bySlot 과 대조)
 * @param {string} cls @param {{rank:string, level:number, mf?:number, blp?:number, blpOn?:boolean, guaranteed?:boolean}|null} [mix]
 * @returns {Record<ItemSlot, number>}
 */
export function slotDist(cls, mix = null) {
  const plain = normalize(/** @type {Record<string, number>} */ (SLOT_WEIGHTS));
  /** @type {Record<string, number>} */
  const out = {};
  for (const s of ITEM_SLOTS) out[s] = plain[s] ?? 0;
  if (!mix) return /** @type {Record<ItemSlot, number>} */ (out);
  const rd = rarityDist(mix);
  const special = /** @type {const} */ (['legendary', 'set']);
  /** @type {Record<string, Record<string, number>>} */
  const sd = {};
  let downgrade = 0;
  for (const r of special) {
    const cands = specialCandidates(r, { cls });
    let total = 0;
    for (const e of cands) total += e.w;
    sd[r] = {};
    for (const s of ITEM_SLOTS) sd[r][s] = 0;
    if (!(total > 0)) { downgrade += rd[r]; continue; }
    for (const e of cands) {
      const slot = r === 'legendary' ? BASES_BY_ID[LEGENDARIES.find(l => l.id === e.id)?.baseId ?? '']?.slot : SETS.flatMap(x => x.pieces).find(p => p.id === e.id)?.slot;
      if (slot) sd[r][slot] += e.w / total;
    }
  }
  const plainShare = rd.normal + rd.magic + rd.rare + downgrade;
  for (const s of ITEM_SLOTS) out[s] = plainShare * (plain[s] ?? 0) + rd.legendary * sd.legendary[s] + rd.set * sd.set[s];
  return /** @type {Record<ItemSlot, number>} */ (out);
}

/**
 * 옵션 수 분포 — 일반 {0:1} · 마법 · 희귀 = ITEM.affixCount · 전설 = 행들의 affixes 범위 균등을 행 가중치로 섞은 것 · 세트 = ITEM.setAffixes 균등
 * (모든 부위가 접두 · 접미 ≥ 3이라 굴린 수가 그대로 붙는다)
 * @param {string} rarity @returns {Record<number, number>}
 */
export function affixCountDist(rarity) {
  /** @type {Record<number, number>} */
  const out = {};
  /** @param {[number, number]} range @param {number} share */
  const uniform = (range, share) => {
    const n = range[1] - range[0] + 1;
    for (let k = range[0]; k <= range[1]; k++) out[k] = (out[k] ?? 0) + share / n;
  };
  if (rarity === 'legendary') {
    let total = 0;
    for (const l of LEGENDARIES) total += nonNeg(l.weight);
    for (const l of LEGENDARIES) if (total > 0 && l.weight > 0) uniform(/** @type {[number, number]} */ (l.affixes), l.weight / total);
    return out;
  }
  if (rarity === 'set') { uniform(/** @type {[number, number]} */ (ITEM.setAffixes), 1); return out; }
  const table = /** @type {Record<string, Record<string, number>>} */ (ITEM.affixCount)[rarity];
  if (!table) { out[0] = 1; return out; }
  const n = normalize(table);
  for (const k of Object.keys(n)) out[Number(k)] = n[k];
  return out;
}

/** 옵션 티어 분포 [p1..p5] — AFFIX_TIERS.minIlvl[t] ≤ ilvl 인 티어를 weight 로 @param {number} ilvl @returns {number[]} */
export function tierDist(ilvl) {
  const lv = Math.max(1, Math.floor(Number(ilvl)) || 1);
  const w = AFFIX_TIERS.weight.map((x, i) => (AFFIX_TIERS.minIlvl[i] <= lv ? x : 0));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map(x => (total > 0 ? x / total : 0));
}

/** 기본형 단계 분포 [p0..p2] — BASE_TIERS.minIlvl ≤ ilvl 인 단계를 weight 로(전설 · 세트는 열린 가장 높은 단계) @param {number} ilvl @returns {number[]} */
export function baseTierDist(ilvl) {
  const lv = Math.max(1, Math.floor(Number(ilvl)) || 1);
  const w = BASE_TIERS.map(t => (t.minIlvl <= lv ? t.weight : 0));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map(x => (total > 0 ? x / total : 0));
}
