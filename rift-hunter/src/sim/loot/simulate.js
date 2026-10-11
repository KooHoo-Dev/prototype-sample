// OWNER: P5 — 계약 §6.10 · §10.9
// 드랍 시뮬레이터 집계기 — 분석 패널 · 측정 · 테스트 · __game.rollDropsSample 공용. 게임과 같은 rollDrops 를 처치마다 한 번 부른다.
// 순수 — 조각 실행(시간 예산 · 취소)은 ui 쪽이 run(n) 을 나눠 부른다. 같은 시드 = 같은 결과(나눠 부른 크기와 무관).

import { CLASS_IDS, ITEM_SLOTS, RARITIES } from '../../core/constants.js';
import { makeRng, seedRng } from '../../core/rng.js';
import { rollDrops } from './rollDrops.js';

/**
 * @typedef {Object} SimResult
 * @property {number} kills          굴린 처치 수
 * @property {number} gear           장비 수 @property {Record<string, number>} byRarity   등급별 장비 수 @property {Record<string, number>} bySlot   부위별 장비 수
 * @property {Record<number, number>} affixCount   옵션 수 → 장비 수 @property {number[]} tiers   옵션 티어 1..5 → 옵션 수(길이 5)
 * @property {number} gold           골드 더미 수 @property {number} goldAmount   골드 합
 * @property {number[]} killsToLegendary   전설이 나온 처치마다 「직전 전설(또는 시작) 뒤 그 처치까지의 처치 수」(히스토그램 재료)
 * @property {number} maxGearGap     전설 · 세트 없이 이어진 장비 드랍 수의 최대(불운 보정이 세는 수 · 지금 이어지는 구간 포함 — 켬이면 ≤ BLP.hard)
 */

/** @returns {SimResult} */
function emptyResult() {
  /** @type {Record<string, number>} */
  const byRarity = {};
  for (const r of RARITIES) byRarity[r] = 0;
  /** @type {Record<string, number>} */
  const bySlot = {};
  for (const s of ITEM_SLOTS) bySlot[s] = 0;
  return { kills: 0, gear: 0, byRarity, bySlot, affixCount: {}, tiers: [0, 0, 0, 0, 0], gold: 0, goldAmount: 0, killsToLegendary: [], maxGearGap: 0 };
}

/** @param {SimResult} r @param {number} gap @returns {SimResult} 깊은 사본(결과를 고쳐도 시뮬레이터가 바뀌지 않는다) */
function snapshot(r, gap) {
  return {
    kills: r.kills, gear: r.gear, byRarity: { ...r.byRarity }, bySlot: { ...r.bySlot }, affixCount: { ...r.affixCount },
    tiers: r.tiers.slice(), gold: r.gold, goldAmount: r.goldAmount, killsToLegendary: r.killsToLegendary.slice(), maxGearGap: Math.max(r.maxGearGap, gap),
  };
}

/**
 * @param {{rank:string, level:number, cls:string, mf?:number, blpOn?:boolean, seed?:number}} opts   mf = 비율(1.0 = 100%)
 * @returns {{run:(n:number) => number, result:() => SimResult, reset:() => void}}
 */
export function createDropSim({ rank, level, cls, mf = 0, blpOn = true, seed = 1 }) {
  const c = CLASS_IDS.includes(/** @type {any} */ (cls)) ? cls : CLASS_IDS[0];
  const lv = Math.max(1, Math.floor(Number(level)) || 1);
  const m = Number.isFinite(Number(mf)) && Number(mf) > 0 ? Number(mf) : 0;
  const on = blpOn !== false;
  /** @type {{s:number}} */
  let rs;
  /** @type {import('../../types.js').Rng} */
  let rng;
  let blp = 0, gap = 0, sinceLeg = 0, seq = 0;
  /** @type {SimResult} */
  let res;
  const newId = () => 'sim' + ++seq;
  const reset = () => {
    rs = seedRng(seed);
    rng = makeRng(rs);
    blp = 0; gap = 0; sinceLeg = 0; seq = 0;
    res = emptyResult();
  };
  reset();
  return {
    run(n) {
      const k = Math.max(0, Math.floor(Number(n)) || 0);
      for (let i = 0; i < k; i++) {
        const out = rollDrops(rng, { rank, level: lv, cls: c, mf: m, gf: 0, blp, blpOn: on, newId });
        blp = out.blp;
        res.kills += 1;
        sinceLeg += 1;
        let leg = false;
        for (let j = 0; j < out.drops.length; j++) {
          const d = out.drops[j];
          if (d.kind === 'gold') { res.gold += 1; res.goldAmount += d.amount; continue; }
          if (d.kind !== 'item' || !d.item) continue;
          const it = d.item;
          res.gear += 1;
          res.byRarity[it.rarity] = (res.byRarity[it.rarity] ?? 0) + 1;
          res.bySlot[it.slot] = (res.bySlot[it.slot] ?? 0) + 1;
          const na = it.affixes.length;
          res.affixCount[na] = (res.affixCount[na] ?? 0) + 1;
          for (let a = 0; a < na; a++) {
            const t = it.affixes[a].tier;
            if (t >= 1 && t <= res.tiers.length) res.tiers[t - 1] += 1;
          }
          if (it.rarity === 'legendary' || it.rarity === 'set') {
            if (gap > res.maxGearGap) res.maxGearGap = gap;
            gap = 0;
          } else gap += 1;
          if (it.rarity === 'legendary') leg = true;
        }
        if (leg) { res.killsToLegendary.push(sinceLeg); sinceLeg = 0; }
      }
      return k;
    },
    result() { return snapshot(res, gap); },
    reset,
  };
}
