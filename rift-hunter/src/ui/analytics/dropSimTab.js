// OWNER: P12 — 계약 §10.9(드랍 시뮬레이터) · §6.10(theory · simulate) · 브리프 §3.7 · §8.6
// 드랍 시뮬레이터 탭 — 게임과 같은 createDropSim(P5 · 같은 rollDrops)을 조각으로 굴리고 이론값(P5 theory.js)과 나란히 보인다.
//
// 조각 실행: MessageChannel(없으면 setTimeout 0)로 한 조각 = SLICE_MS(8ms) 안에서 굴릴 수 있는 만큼 — 시간은 performance.now(ui 계층).
//   requestAnimationFrame 을 쓰지 않는다(숨은 탭에서도 진행 — 브리프 §8.6) · Worker 를 쓰지 않는다(단일 번들).
//   한 묶음(batch)의 처치 수는 잰 처치당 시간으로 맞춰(예산의 1/4) 조각이 예산을 넘지 않게 한다 · 취소하면 다음 조각이 돌지 않는다.
// 이론값: 불운 보정 끔이면 rarityDist · slotDist · expectedPerKill 그대로. 켬이면 등급 확률이 불운 수(blp)에 따라 바뀌므로
//   불운 수의 정상 분포(장비 드랍마다 +1 · 전설 · 세트면 0 · BLP.hard 에서 전설 확정)로 rarityDist(blp = n) · slotDist(blp = n)를 섞는다 —
//   P5 의 함수만 부르고 식을 다시 쓰지 않는다(같은 표). 수호자처럼 보장 장비가 있는 등급은 처치 단위 사슬을 수렴할 때까지 민다.
//
// 아래 순수 함수(histogram · createChunkRunner · createScheduler · dropTheory · compareShare)는 Node 테스트가 import 한다 —
// DOM 은 createDropSimTab 안에서만 만진다.

import { CLASS_IDS, ITEM_SLOTS, MON_RANKS, RARITIES } from '../../core/constants.js';
import { BLP } from '../../data/drops.js';
import { RANKS_BY_ID, TREASURE_BY_ID } from '../../data/index.js';
import { KEYBINDS, PANEL_KEYS } from '../../data/keybinds.js';
import { RIFT_LEVELS, riftRow } from '../../data/rift.js';
import { createDropSim } from '../../sim/loot/simulate.js';
import { affixCountDist, effectiveMF, expectedPerKill, rarityDist, slotDist, tcDist, tierDist } from '../../sim/loot/theory.js';
import { fmtInt, fmtNum, fmtPct } from '../format.js';

/** 한 조각의 시간 예산(ms — 계약 §10.9) */
export const SLICE_MS = 8;
/** 굴리는 중 결과를 다시 그리는 최소 간격(ms) */
const RENDER_EVERY_MS = 120;
/** 횟수 선택지(계약 §10.9 — 1천 · 1만 · 10만) */
export const SIM_COUNTS = Object.freeze([1000, 10000, 100000]);
/** 아이템 발견 선택지(%) — 브리프 §7 의 0 · 100 · 300 · 600 을 포함 */
export const MF_STEPS = Object.freeze([0, 25, 50, 100, 150, 200, 300, 400, 600]);
/** 상대 오차 기준(브리프 §7 「≤ 3%」) · 표본 오차 배수 기준(칸이 30개 남짓이라 4σ — 3σ 면 한 번 굴릴 때 몇 %가 우연히 붉다) */
export const ERR_OK = 0.03;
export const Z_OK = 4;
/** 이론 빈도가 이 값 아래인 칸은 판정에서 흐리게(브리프 §7 「빈도 1% 이상 칸」) */
export const SMALL_SHARE = 0.01;
/** 히스토그램 막대 수 */
const HIST_BINS = 20;
/** 가방 단축키(데이터 표에 analytics 가 없으면 이 값 — NOTES-P12) */
const KEY_CANCEL = /** @type {any} */ (PANEL_KEYS).analytics?.cancel ?? 'KeyX';

/** event.code → 짧은 표시('KeyX' → 'X') @param {string} code */
export function keyLabel(code) {
  return String(code).replace(/^Key|^Digit/, '');
}

/** 처치 묶음을 가진 등급(장비가 나올 수 있는 것)만 — 시뮬레이터의 「몬스터 등급」 선택지 */
export const SIM_RANKS = Object.freeze(MON_RANKS.filter((r) => {
  const tc = treasureFor(r);
  return !!tc && (tcDist(r).gear > 0 || Math.floor(Number(tc.guaranteed) || 0) > 0);
}));

// ───────────────────────── 순수: 이론값 ─────────────────────────

/** 몬스터 등급의 드랍 묶음 행(데이터 — theory.js 와 같은 길) @param {string} rank */
function treasureFor(rank) {
  const rk = RANKS_BY_ID[rank];
  return rk && rk.tc ? TREASURE_BY_ID[rk.tc] ?? null : null;
}

/** 이항 분포 pmf @param {number} n @param {number} p @returns {number[]} */
function binomPmf(n, p) {
  const out = new Array(n + 1).fill(0);
  if (n <= 0) { out[0] = 1; return out; }
  const q = Math.min(1, Math.max(0, p));
  let c = 1;
  for (let k = 0; k <= n; k++) {
    out[k] = c * q ** k * (1 - q) ** (n - k);
    c = (c * (n - k)) / (k + 1);
  }
  return out;
}

/** @param {Float64Array} dst @param {Float64Array} src @param {number} k */
function addScaled(dst, src, k) {
  if (k === 0) return;
  for (let i = 0; i < dst.length; i++) dst[i] += src[i] * k;
}

/** @param {Float64Array} v */
function total(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s;
}

/**
 * 장비 드랍 한 번(불운 수 사슬의 한 걸음): 전설 · 세트(reset)면 0 · 아니면 n + 1 · 마지막 칸(BLP.hard)은 늘 0 으로
 * @param {Float64Array} x @param {Float64Array} reset @returns {Float64Array}
 */
function chainStep(x, reset) {
  const H = x.length - 1;
  const y = new Float64Array(x.length);
  for (let n = 0; n <= H; n++) {
    const m = x[n];
    if (m === 0) continue;
    if (n === H) { y[0] += m; continue; }
    const r = reset[n];
    y[0] += m * r;
    y[n + 1] += m * (1 - r);
  }
  return y;
}

/**
 * 같은 걸음에서 「이번 처치에 전설이 아직 없다」인 질량만 — 전설이면 빠지고 세트면 0 으로 · 아니면 n + 1
 * @param {Float64Array} x @param {Float64Array} leg @param {Float64Array} set @returns {Float64Array}
 */
function noLegStep(x, leg, set) {
  const H = x.length - 1;
  const y = new Float64Array(x.length);
  for (let n = 0; n <= H; n++) {
    const m = x[n];
    if (m === 0) continue;
    if (n === H) continue;                       // BLP.hard — 전설 확정
    y[0] += m * set[n];
    y[n + 1] += m * Math.max(0, 1 - leg[n] - set[n]);
  }
  return y;
}

/**
 * 불운 수 n = 0..H 마다의 등급 분포(rarityDist — capCount 위로는 같은 값이라 한 번만 부른다)
 * @param {{rank:string, level:number, mf:number, guaranteed:boolean}} o @param {number} H
 * @returns {Array<Record<string, number>>}
 */
function rarityByCount(o, H) {
  const cap = Math.max(0, Math.min(H, Math.floor(BLP.capCount)));
  /** @type {Array<Record<string, number>>} */
  const out = new Array(H + 1);
  for (let n = 0; n <= H; n++) {
    out[n] = n > cap && n < H ? out[cap] : rarityDist({ rank: o.rank, level: o.level, mf: o.mf, blp: n, blpOn: true, guaranteed: o.guaranteed });
  }
  return out;
}

/**
 * 이론값 — 시뮬레이터(createDropSim)와 같은 조건의 기대 분포.
 * rarity · slot · affixCount = 장비 하나당 비율 · tiers = 옵션 하나당 비율 · gearPerKill · goldPerKill · legPerKill = 처치당 기대값 ·
 * pKillLeg = 처치 하나에 전설이 하나 이상 나올 확률 → meanKillsToLeg = 1 / pKillLeg(「전설 하나까지 처치 수」의 평균 · 장기 평균) ·
 * gearSdPerKill = 처치당 장비 수의 표준편차(표본 오차용).
 * @param {{rank:string, level:number, cls:string, mf?:number, blpOn?:boolean}} opts   mf = 비율(1.0 = 100%)
 */
export function dropTheory({ rank, level, cls, mf = 0, blpOn = true }) {
  const row = riftRow(level);
  const lv = row.level;
  const c = CLASS_IDS.includes(/** @type {any} */ (cls)) ? cls : CLASS_IDS[0];
  const m = Number.isFinite(Number(mf)) && Number(mf) > 0 ? Number(mf) : 0;
  const per = expectedPerKill({ rank, level: lv, mf: m });
  /** @type {Record<string, number>} */
  const rarity = {};
  for (const r of RARITIES) rarity[r] = 0;
  /** @type {Record<string, number>} */
  const slot = {};
  for (const s of ITEM_SLOTS) slot[s] = 0;
  const out = {
    rank, level: lv, cls: c, mf: m, blpOn: !!blpOn,
    gearPerKill: per.gear, goldPerKill: per.goldAmount, legPerKill: 0, pKillLeg: 0, meanKillsToLeg: Infinity, gearSdPerKill: 0, goldSdPerKill: 0,
    rarity, slot, /** @type {Record<number, number>} */ affixCount: {}, tiers: tierDist(row.ilvl),
  };
  const tc = treasureFor(rank);
  if (!tc || !(per.gear > 0)) return out;
  const picks = Math.max(0, Math.floor(Number(tc.picks) || 0));
  const G = Math.max(0, Math.floor(Number(tc.guaranteed) || 0));
  const pG = tcDist(rank).gear;
  out.gearSdPerKill = Math.sqrt(picks * pG * (1 - pG));
  // 처치당 골드의 표준편차(근사 — 더미 = c × U(0.5, 1.5) · E[더미²] = c² × 13/12 · 반올림은 무시)
  const pGold = tcDist(rank).gold;
  const pile = per.gold > 0 ? per.goldAmount / per.gold : 0;
  out.goldSdPerKill = Math.sqrt(Math.max(0, picks * (pGold * pile * pile * (13 / 12) - (pGold * pile) ** 2)));
  const base = { rank, level: lv, mf: m };

  /** 상태(불운 수) 하나 = 그 상태에서 일어난 평 · 보장 장비 드랍 수(처치당 기대값) */
  /** @type {Float64Array} */ let occP;
  /** @type {Float64Array} */ let occG;
  /** @type {Array<Record<string, number>>} */ let rdP;
  /** @type {Array<Record<string, number>>} */ let rdG;
  let noLeg = 1;
  if (!blpOn) {
    rdP = [rarityDist({ ...base, blpOn: false })];
    rdG = [G > 0 ? rarityDist({ ...base, blpOn: false, guaranteed: true }) : rdP[0]];
    occP = Float64Array.of(picks * pG);
    occG = Float64Array.of(G);
    noLeg = (1 - pG * rdP[0].legendary) ** picks * (1 - rdG[0].legendary) ** G;
  } else {
    const H = Math.max(0, Math.floor(BLP.hard));
    rdP = rarityByCount({ ...base, guaranteed: false }, H);
    rdG = G > 0 ? rarityByCount({ ...base, guaranteed: true }, H) : rdP;
    const resetP = new Float64Array(H + 1), legP = new Float64Array(H + 1), setP = new Float64Array(H + 1);
    const resetG = new Float64Array(H + 1), legG = new Float64Array(H + 1), setG = new Float64Array(H + 1);
    for (let n = 0; n <= H; n++) {
      legP[n] = rdP[n].legendary; setP[n] = rdP[n].set; resetP[n] = n === H ? 1 : Math.min(1, legP[n] + setP[n]);
      legG[n] = rdG[n].legendary; setG[n] = rdG[n].set; resetG[n] = n === H ? 1 : Math.min(1, legG[n] + setG[n]);
    }
    const b = binomPmf(picks, pG);
    const tail = b.map((_, j) => b.slice(j + 1).reduce((a, x) => a + x, 0));
    /** 처치 하나의 끝 분포만(수렴용) — 평 장비 N ~ B(picks, pG) 번 → 보장 G 번 @param {Float64Array} v */
    const nextOf = (v) => {
      let cur = v;
      const mix = new Float64Array(H + 1);
      for (let j = 0; j <= picks; j++) {
        addScaled(mix, cur, b[j]);
        if (j < picks) cur = chainStep(cur, resetP);
      }
      let mm = mix;
      for (let g = 0; g < G; g++) mm = chainStep(mm, resetG);
      return mm;
    };
    /** 처치 하나 전부 — 끝 분포 · 상태별 드랍 수 · 「전설 없음」 확률 @param {Float64Array} v 처치 시작의 불운 수 분포 */
    const killPass = (v) => {
      let cur = v, u = v;
      const mix = new Float64Array(H + 1), uMix = new Float64Array(H + 1);
      const oP = new Float64Array(H + 1), oG = new Float64Array(H + 1);
      for (let j = 0; j <= picks; j++) {
        addScaled(mix, cur, b[j]);
        addScaled(uMix, u, b[j]);
        if (j < picks) {
          addScaled(oP, cur, tail[j]);
          cur = chainStep(cur, resetP);
          u = noLegStep(u, legP, setP);
        }
      }
      let mm = mix, um = uMix;
      for (let g = 0; g < G; g++) {
        addScaled(oG, mm, 1);
        mm = chainStep(mm, resetG);
        um = noLegStep(um, legG, setG);
      }
      return { next: mm, oP, oG, noLeg: total(um) };
    };
    /** @type {Float64Array} */
    let v;
    if (G === 0) {
      // 처치의 경계는 불운 수와 무관(장비 여부는 독립) — 장비 드랍 사슬의 정상 분포가 곧 처치 시작의 분포
      const S = new Float64Array(H + 1);
      S[0] = 1;
      for (let n = 0; n < H; n++) S[n + 1] = S[n] * (1 - resetP[n]);
      const sum = total(S);
      v = S.map((x) => x / sum);
    } else {
      // 보장 장비가 처치 끝에 몰려 있다 — 처치 단위 사슬을 수렴할 때까지(전설 · 세트가 잦아 수백 처치 안)
      v = new Float64Array(H + 1);
      v[0] = 1;
      for (let it = 0; it < 20000; it++) {
        const nx = nextOf(v);
        let d = 0;
        for (let i = 0; i <= H; i++) d += Math.abs(nx[i] - v[i]);
        v = nx;
        if (d < 1e-12) break;
      }
    }
    const pass = killPass(v);
    occP = pass.oP;
    occG = pass.oG;
    noLeg = pass.noLeg;
  }
  // 등급 — Σ 상태 · 종류 (드랍 수 × 그 상태의 분포)
  let W = 0;
  for (let n = 0; n < occP.length; n++) {
    for (let g = 0; g < 2; g++) {
      const w = g ? occG[n] : occP[n];
      if (!(w > 0)) continue;
      W += w;
      const rd = g ? rdG[n] : rdP[n];
      for (const r of RARITIES) rarity[r] += w * (rd[r] ?? 0);
    }
  }
  if (W > 0) for (const r of RARITIES) rarity[r] /= W;
  out.legPerKill = W * rarity.legendary;
  // 부위 — 부위는 등급만 보고 정해진다(불운 수 · 보장과 무관 · rollGear). slotDist 는 등급 분포에 대해 선형이므로
  //   일반 · 마법 · 희귀 = slotDist(cls) · 전설 = slotDist(전설 확정 — blp = BLP.hard) · 세트 = 한 번 더 부른 값에서 푼다(P5 의 표 그대로)
  const plain = slotDist(c);
  const legS = slotDist(c, { ...base, blpOn: true, blp: Math.max(0, Math.floor(BLP.hard)) });
  const rdB = rarityDist({ ...base, blpOn: false });
  const mixS = slotDist(c, { ...base, blpOn: false });
  const sB = rdB.set ?? 0;
  for (const s of ITEM_SLOTS) {
    const pl = plain[s] ?? 0;
    const lg = legS[s] ?? 0;
    const st = sB > 1e-9 ? ((mixS[s] ?? 0) - (1 - rdB.legendary - sB) * pl - rdB.legendary * lg) / sB : pl;
    slot[s] = (rarity.normal + rarity.magic + rarity.rare) * pl + rarity.legendary * lg + rarity.set * Math.max(0, st);
  }
  /** @type {Record<number, number>} */
  const ac = {};
  for (const r of RARITIES) {
    const d = affixCountDist(r);
    for (const k of Object.keys(d)) ac[Number(k)] = (ac[Number(k)] ?? 0) + rarity[r] * d[/** @type {any} */ (k)];
  }
  out.affixCount = ac;
  out.pKillLeg = Math.max(0, Math.min(1, 1 - noLeg));
  out.meanKillsToLeg = out.pKillLeg > 0 ? 1 / out.pKillLeg : Infinity;
  return out;
}

/**
 * 비율 칸 하나의 판정 — share = 시뮬 비율 · err = 상대 오차 · z = 표본 오차(σ = √(p(1−p)/n)) 배수 ·
 * ok = |err| ≤ ERR_OK 이거나 |z| < Z_OK(표본 오차 안) · small = 이론 빈도 < SMALL_SHARE(판정에서 흐리게)
 * @param {number} theory 이론 비율 @param {number} count 시뮬 개수 @param {number} n 시뮬 분모
 */
export function compareShare(theory, count, n) {
  const p = Number.isFinite(theory) && theory > 0 ? theory : 0;
  if (!(n > 0)) return { share: NaN, err: NaN, z: NaN, ok: true, small: p < SMALL_SHARE, empty: true };
  const share = count / n;
  if (p === 0) return { share, err: share > 0 ? Infinity : 0, z: share > 0 ? Infinity : 0, ok: share === 0, small: true, empty: false };
  const err = (share - p) / p;
  const sigma = Math.sqrt((p * (1 - p)) / n);
  const z = sigma > 0 ? (share - p) / sigma : 0;
  return { share, err, z, ok: Math.abs(err) <= ERR_OK || Math.abs(z) < Z_OK, small: p < SMALL_SHARE, empty: false };
}

// ───────────────────────── 순수: 히스토그램 ─────────────────────────

/**
 * 정수 값(처치 수)의 히스토그램 — 막대 i = (i × width, (i + 1) × width] · width = ceil(상한 / bins)(정수) ·
 * 상한 = max 인자 또는 99% 분위수 · 그 위는 over. 평균 · 중앙값 · 최대 · 가장 큰 막대(peak) 함께.
 * @param {ArrayLike<number>} values @param {{bins?:number, max?:number|null}} [opts]
 * @returns {{n:number, width:number, counts:number[], over:number, mean:number, median:number, max:number, peak:number}}
 */
export function histogram(values, { bins = HIST_BINS, max = null } = {}) {
  const nb = Math.max(1, Math.floor(bins) || 1);
  const counts = new Array(nb).fill(0);
  /** @type {number[]} */
  const vals = [];
  const len = values ? values.length : 0;
  for (let i = 0; i < len; i++) {
    const v = Number(values[i]);
    if (Number.isFinite(v) && v >= 0) vals.push(v);
  }
  const n = vals.length;
  if (!n) return { n: 0, width: 1, counts, over: 0, mean: 0, median: 0, max: 0, peak: 0 };
  const sorted = Float64Array.from(vals).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const top = sorted[n - 1];
  const hi = max !== null && Number.isFinite(max) && max > 0 ? max : sorted[Math.max(0, Math.ceil(0.99 * n) - 1)];
  const width = Math.max(1, Math.ceil(Math.max(1, hi) / nb));
  let over = 0;
  for (let i = 0; i < n; i++) {
    const v = sorted[i];
    const bin = v <= 0 ? 0 : Math.ceil(v / width) - 1;
    if (bin >= nb) over++;
    else counts[bin]++;
  }
  let peak = 0;
  for (const c of counts) if (c > peak) peak = c;
  return { n, width, counts, over, mean: sum / n, median, max: top, peak };
}

// ───────────────────────── 순수: 조각 실행기 ─────────────────────────

/** @returns {number} */
function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * 조각 스케줄러 — MessageChannel(숨은 탭에서도 타이머처럼 늦춰지지 않는다 · rAF 아님) · 없으면 setTimeout 0.
 * dispose() 가 채널을 닫는다(Node 에서는 열린 채널이 프로세스를 붙잡는다).
 * @param {any} [g] 전역(테스트가 바꿔 넣는다)
 * @returns {{kind:'message'|'timeout', schedule:(fn:() => void) => void, dispose:() => void}}
 */
export function createScheduler(g = globalThis) {
  /** @type {Array<() => void>} */
  const queue = [];
  /** @type {any} */
  let channel = null;
  if (g && typeof g.MessageChannel === 'function') {
    try {
      channel = new g.MessageChannel();
      channel.port1.onmessage = () => {
        const fn = queue.shift();
        if (fn) fn();
      };
    } catch {
      channel = null;
    }
  }
  return {
    kind: channel ? 'message' : 'timeout',
    schedule(fn) {
      if (channel) {
        queue.push(fn);
        channel.port2.postMessage(0);
      } else g.setTimeout(fn, 0);
    },
    dispose() {
      queue.length = 0;
      if (channel) {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        channel = null;
      }
    },
  };
}

/**
 * 조각 실행기 — step(k) 를 묶음으로 불러 한 조각이 budgetMs 를 넘지 않게 나누고, 조각 사이는 schedule 로 넘긴다.
 * 첫 조각도 start() 뒤 schedule 로(누른 손이 곧장 돌아온다). 묶음 크기는 잰 단위 시간으로 예산의 1/4 에 맞춘다(1 ~ maxBatch).
 * 다음 묶음이 예산을 넘길 것 같으면 그 조각을 끝낸다(묶음 하나는 늘 돈다 — 진행이 멈추지 않는다).
 * step 이 k 보다 적게 돌렸으면(더 굴릴 수 없다) 거기서 끝. cancel() 은 곧바로 onDone(cancelled) — 걸려 있던 조각은 아무것도 하지 않는다.
 * @param {{total:number, step:(k:number) => number, budgetMs?:number, now?:() => number, schedule:(fn:() => void) => void,
 *   onSlice?:((done:number, total:number, sliceMs:number) => void)|null, onDone?:((r:{done:number, total:number, cancelled:boolean}) => void)|null,
 *   firstBatch?:number, maxBatch?:number}} o
 */
export function createChunkRunner({ total: totalN, step, budgetMs = SLICE_MS, now = defaultNow, schedule, onSlice = null, onDone = null, firstBatch = 16, maxBatch = 8192 }) {
  const target = Math.max(0, Math.floor(Number(totalN)) || 0);
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : SLICE_MS;
  let done = 0;
  let running = false;
  let finished = false;
  let cancelled = false;
  let slices = 0;
  let batch = Math.max(1, Math.floor(firstBatch) || 1);
  let perUnit = 0;
  let maxSliceMs = 0;
  const finish = () => {
    running = false;
    finished = true;
    onDone?.({ done, total: target, cancelled });
  };
  const slice = () => {
    if (!running) return;
    slices++;
    const t0 = now();
    let stalled = false;
    while (done < target) {
      const k = Math.min(batch, target - done);
      const b0 = now();
      const ran = Math.max(0, Math.min(k, Math.floor(Number(step(k)) || 0)));
      const b1 = now();
      done += ran;
      if (ran < k) { stalled = true; break; }
      const u = Math.max(0, b1 - b0) / ran;
      perUnit = perUnit > 0 ? perUnit * 0.6 + u * 0.4 : u;
      batch = perUnit > 0 ? Math.max(1, Math.min(maxBatch, Math.floor(budget / 4 / perUnit))) : Math.min(maxBatch, batch * 2);
      if (done >= target) break;
      if (b1 - t0 + perUnit * Math.min(batch, target - done) > budget) break;
    }
    const ms = Math.max(0, now() - t0);
    if (ms > maxSliceMs) maxSliceMs = ms;
    onSlice?.(done, target, ms);
    if (!running) return;                          // onSlice 안에서 취소됐다
    if (stalled || done >= target) { finish(); return; }
    schedule(slice);
  };
  return {
    /** @returns {boolean} 시작했다 */
    start() {
      if (running || finished) return false;
      running = true;
      if (target === 0) { finish(); return true; }
      schedule(slice);
      return true;
    },
    /** @returns {boolean} 취소했다(돌고 있었다) */
    cancel() {
      if (!running) return false;
      cancelled = true;
      finish();
      return true;
    },
    get done() { return done; },
    get total() { return target; },
    get running() { return running; },
    get finished() { return finished; },
    get cancelled() { return cancelled; },
    get slices() { return slices; },
    get maxSliceMs() { return maxSliceMs; },
  };
}

// ───────────────────────── 화면: 값 고르기 줄 묶음 ─────────────────────────

/**
 * @typedef {Object} FormRow
 * @property {string} key
 * @property {string} [labelKey]        왼쪽 이름(t)
 * @property {() => string} [text]      값 문면
 * @property {(d:number) => void} [step] ←(−1) →(+1)
 * @property {(d:number) => boolean} [can]   그 방향으로 바꿀 수 있나(아니면 화살표 흐림)
 * @property {() => string} [valueClass] 값 칸에 붙일 클래스
 * @property {boolean} [action]          주 행동 줄(버튼 하나 — Enter · 클릭)
 * @property {() => string} [actionText] 버튼 문면
 * @property {() => boolean} [disabled]  버튼 흐림
 * @property {() => void} [onPick]
 */

/**
 * 값 고르기 줄 묶음 — ↑↓ 줄 · ←→ 값 · Enter = 그 줄이 행동 줄이면 그것 · 아니면 onEnter. 마우스: 줄 올림 = 포커스 · ◀ ▶ 클릭 · 행동 버튼 클릭.
 * 드랍 시뮬레이터 · 봇 탭이 같이 쓴다(같은 조작감).
 * @param {any} widgets @param {(key:string, params?:any) => string} t @param {FormRow[]} rows
 * @param {{onChange?:(key:string) => void, onEnter?:() => void}} [opts]
 */
export function stepperForm(widgets, t, rows, { onChange, onEnter } = {}) {
  const el = widgets.el('div', 'an-form');
  /** @type {Array<{row:FormRow, val:HTMLElement|null, prev:HTMLButtonElement|null, next:HTMLButtonElement|null, btn:HTMLButtonElement|null, lastText:string}>} */
  const items = [];
  const refresh = () => {
    for (const it of items) {
      const r = it.row;
      if (r.action) {
        const txt = r.actionText ? r.actionText() : '';
        if (it.btn && txt !== it.lastText) { it.btn.textContent = txt; it.lastText = txt; }
        if (it.btn) it.btn.disabled = !!r.disabled?.();
        continue;
      }
      const txt = r.text ? r.text() : '';
      if (it.val && txt !== it.lastText) { it.val.textContent = txt; it.lastText = txt; }
      if (it.val && r.valueClass) it.val.className = 'an-val ' + r.valueClass();
      if (it.prev) it.prev.disabled = !(r.can ? r.can(-1) : true);
      if (it.next) it.next.disabled = !(r.can ? r.can(1) : true);
    }
  };
  /** @param {number} i @param {number} d */
  const shift = (i, d) => {
    const it = items[i];
    if (!it || it.row.action || !it.row.step) return;
    if (it.row.can && !it.row.can(d)) return;
    it.row.step(d);
    refresh();
    onChange?.(it.row.key);
  };
  rows.forEach((row, i) => {
    const rowEl = el.appendChild(widgets.el('div', row.action ? 'an-row an-row-action' : 'an-row'));
    rowEl.dataset.key = row.key;
    if (row.action) {
      const btn = widgets.button('', () => { nav.focus(i, true); row.onPick?.(); refresh(); });
      btn.classList.add('is-primary', 'an-action');
      rowEl.appendChild(btn);
      items.push({ row, val: null, prev: null, next: null, btn, lastText: '' });
      return;
    }
    rowEl.appendChild(widgets.el('span', 'an-row-label', row.labelKey ? t(row.labelKey) : ''));
    const box = rowEl.appendChild(widgets.el('span', 'an-step'));
    const prev = widgets.button('', () => shift(i, -1));
    prev.classList.add('an-arrow');
    prev.textContent = '◀';
    const val = widgets.el('span', 'an-val');
    const next = widgets.button('', () => shift(i, 1));
    next.classList.add('an-arrow');
    next.textContent = '▶';
    box.append(prev, val, next);
    items.push({ row, val, prev, next, btn: null, lastText: '' });
  });
  const nav = widgets.listNav(el, (i, via) => {
    const it = items[i];
    if (!it) return;
    if (it.row.action) {
      if (via === 'key' && !it.row.disabled?.()) { it.row.onPick?.(); refresh(); }
      return;
    }
    if (via === 'key') onEnter?.();
  }, { wrap: false });
  refresh();
  return {
    el,
    nav,
    refresh,
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.type === 'keyup') return false;
      if (e.code === KEYBINDS.left || e.code === KEYBINDS.right) {
        if (nav.index < 0) nav.focus(0);
        shift(nav.index, e.code === KEYBINDS.left ? -1 : 1);
        return true;
      }
      return nav.handleKey(e);
    },
    destroy() { nav.destroy(); },
  };
}

// ───────────────────────── 화면: 탭 ─────────────────────────

/** 비율 → 문면(작은 값은 소수 셋째 자리) @param {number} v */
function pctText(v) {
  if (!Number.isFinite(v)) return '—';
  return fmtPct(v, v > 0 && v < 0.01 ? 3 : 2);
}
/** 상대 오차 → '+1.2%' @param {number} e */
function errText(e) {
  if (Number.isNaN(e)) return '—';
  if (!Number.isFinite(e)) return '∞';
  const s = fmtPct(e, 1);
  return e > 0 && s !== '0.0%' ? '+' + s : s;
}
/** z → '1.3σ' @param {number} z */
function zText(z) {
  if (Number.isNaN(z)) return '—';
  if (!Number.isFinite(z)) return '∞';
  return fmtNum(Math.abs(z), 1) + 'σ';
}

/**
 * 비교 표 하나(이름 · 이론값 · 시뮬값 · 오차 · z) — 줄은 처음에 만들고 글자만 바꾼다
 * @param {any} widgets @param {(key:string, params?:any) => string} t @param {string} titleKey
 * @param {Array<{id:string|number, label:string, cls?:string}>} rows
 */
function compareTable(widgets, t, titleKey, rows) {
  const box = widgets.el('div', 'an-block');
  box.appendChild(widgets.el('h3', 'an-h', t(titleKey)));
  const table = box.appendChild(widgets.el('table', 'an-cmp'));
  const head = table.appendChild(widgets.el('tr'));
  head.append(widgets.el('th', '', ''), widgets.el('th', '', t('analytics.theory')), widgets.el('th', '', t('analytics.sim')),
    widgets.el('th', '', t('analytics.err')), widgets.el('th', '', 'z'));
  /** @type {Map<string|number, {tr:HTMLElement, th:HTMLElement, sim:HTMLElement, err:HTMLElement, z:HTMLElement}>} */
  const cells = new Map();
  for (const r of rows) {
    const tr = table.appendChild(widgets.el('tr'));
    const name = tr.appendChild(widgets.el('td', 'an-name ' + (r.cls ?? ''), r.label));
    name.title = String(r.id);
    const th = tr.appendChild(widgets.el('td', 'an-num'));
    const sim = tr.appendChild(widgets.el('td', 'an-num'));
    const err = tr.appendChild(widgets.el('td', 'an-num'));
    const z = tr.appendChild(widgets.el('td', 'an-num an-z'));
    cells.set(r.id, { tr, th, sim, err, z });
  }
  return {
    el: box,
    /**
     * @param {(id:string|number) => number} theoryOf @param {((id:string|number) => number)|null} countOf 시뮬 개수(null = 아직 없음) @param {number} n 분모
     */
    set(theoryOf, countOf, n) {
      for (const [id, c] of cells) {
        const p = theoryOf(id);
        c.th.textContent = pctText(p);
        if (!countOf || !(n > 0)) {
          c.sim.textContent = '—';
          c.err.textContent = '';
          c.z.textContent = '';
          c.tr.className = p < SMALL_SHARE ? 'is-small' : '';
          continue;
        }
        const k = countOf(id);
        const cmp = compareShare(p, k, n);
        c.sim.textContent = pctText(cmp.share);
        c.err.textContent = p > 0 ? errText(cmp.err) : k > 0 ? '∞' : '—';
        c.z.textContent = p > 0 ? zText(cmp.z) : '';
        c.tr.className = (cmp.small ? 'is-small ' : '') + (cmp.ok ? 'is-ok' : 'is-bad');
      }
    },
  };
}

/**
 * 드랍 시뮬레이터 탭.
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:any) => string, ui:any, widgets:any}} ctx
 */
export function createDropSimTab(ctx) {
  const { widgets, t } = ctx;
  const W = widgets;
  const el = W.el('div', 'an-tab an-sim');
  el.dataset.tab = 'sim';
  const maxLevel = RIFT_LEVELS.length;

  const p = { level: 1, rank: SIM_RANKS[0] ?? 'normal', mf: 0, blpOn: true, cls: CLASS_IDS[0], n: SIM_COUNTS[1], seed: 1 };
  let initialized = false;
  /** @type {ReturnType<typeof dropTheory>|null} */
  let theory = null;
  /** @type {Map<string, ReturnType<typeof dropTheory>>} */
  const theoryCache = new Map();
  /** @type {ReturnType<typeof createDropSim>|null} */
  let dsim = null;
  /** @type {ReturnType<typeof createChunkRunner>|null} */
  let runner = null;
  /** @type {ReturnType<typeof createScheduler>|null} */
  let sched = null;
  /** 굴린 조건(결과가 어느 조건의 것인가) */
  let ranKey = '';
  let startedAt = 0;
  let lastRender = 0;
  let elapsedMs = 0;
  /** @type {'idle'|'running'|'done'|'cancelled'} */
  let phase = 'idle';

  const keyOf = () => `${p.rank}|${p.level}|${p.cls}|${p.mf}|${p.blpOn ? 1 : 0}`;
  const theoryNow = () => {
    const k = keyOf();
    let th = theoryCache.get(k);
    if (!th) {
      th = dropTheory({ rank: p.rank, level: p.level, cls: p.cls, mf: p.mf / 100, blpOn: p.blpOn });
      if (theoryCache.size > 32) theoryCache.clear();
      theoryCache.set(k, th);
    }
    return th;
  };
  /** @template T @param {readonly T[]} list @param {T} v @param {number} d */
  const cycle = (list, v, d) => {
    const i = list.indexOf(v);
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + d));
    return list[j];
  };
  /** @template T @param {readonly T[]} list @param {T} v @param {number} d */
  const canCycle = (list, v, d) => {
    const i = list.indexOf(v);
    return d < 0 ? i > 0 : i < list.length - 1;
  };
  const busy = () => !!runner && runner.running;

  // ── 왼쪽: 입력 · 굴리기 · 진행 · 요약 ──
  const left = el.appendChild(W.el('div', 'an-col an-sim-left'));
  /** @type {FormRow[]} */
  const rows = [
    { key: 'level', labelKey: 'analytics.f.level', text: () => t('riftStone.level', { n: p.level }),
      step: (d) => { p.level = Math.max(1, Math.min(maxLevel, p.level + d)); }, can: (d) => !busy() && (d < 0 ? p.level > 1 : p.level < maxLevel) },
    { key: 'rank', labelKey: 'analytics.f.rank', text: () => t('rank.' + p.rank), valueClass: () => 'rank-' + p.rank,
      step: (d) => { p.rank = cycle(SIM_RANKS, p.rank, d); }, can: (d) => !busy() && canCycle(SIM_RANKS, p.rank, d) },
    { key: 'mf', labelKey: 'stat.magicFind',
      text: () => `${p.mf}% ${t('char.effMf', { p: fmtNum(effectiveMF(p.mf / 100) * 100, 0) })}`,
      step: (d) => { p.mf = cycle(MF_STEPS, p.mf, d); }, can: (d) => !busy() && canCycle(MF_STEPS, p.mf, d) },
    { key: 'blp', labelKey: 'analytics.f.blp', text: () => t(p.blpOn ? 'settings.on' : 'settings.off'),
      step: () => { p.blpOn = !p.blpOn; }, can: () => !busy() },
    { key: 'cls', labelKey: 'analytics.f.cls', text: () => t('class.' + p.cls),
      step: (d) => { p.cls = cycle(CLASS_IDS, p.cls, d); }, can: (d) => !busy() && canCycle(CLASS_IDS, p.cls, d) },
    { key: 'n', labelKey: 'analytics.n', text: () => fmtInt(p.n),
      step: (d) => { p.n = cycle(SIM_COUNTS, p.n, d); }, can: (d) => !busy() && canCycle(SIM_COUNTS, p.n, d) },
    { key: 'seed', labelKey: 'analytics.f.seed', text: () => String(p.seed),
      step: (d) => { p.seed = Math.max(1, p.seed + d); }, can: (d) => !busy() && (d > 0 || p.seed > 1) },
    { key: 'run', action: true,
      actionText: () => (busy() ? t('analytics.cancel') + ' ' + keyLabel(KEY_CANCEL) : t('analytics.run') + ' Enter'),
      onPick: () => { if (busy()) cancel(); else run(); } },
  ];
  const form = stepperForm(W, t, rows, {
    onChange: () => { theory = theoryNow(); clearSim(); render(); },
    onEnter: () => { if (!busy()) run(); },
  });
  left.appendChild(form.el);
  const progress = W.bar(left.appendChild(W.el('div', 'an-progress')));
  const status = left.appendChild(W.el('div', 'an-status'));
  // 처치당 기대값 요약
  const sumBox = left.appendChild(W.el('div', 'an-block'));
  sumBox.appendChild(W.el('h3', 'an-h', t('analytics.sec.summary')));
  const sumTable = sumBox.appendChild(W.el('table', 'an-cmp an-sum'));
  const sumHead = sumTable.appendChild(W.el('tr'));
  sumHead.append(W.el('th', '', ''), W.el('th', '', t('analytics.theory')), W.el('th', '', t('analytics.sim')), W.el('th', '', t('analytics.err')));
  /** @param {string} key */
  const sumRow = (key) => {
    const tr = sumTable.appendChild(W.el('tr'));
    tr.appendChild(W.el('td', 'an-name', t(key)));
    return { tr, th: tr.appendChild(W.el('td', 'an-num')), sim: tr.appendChild(W.el('td', 'an-num')), err: tr.appendChild(W.el('td', 'an-num')) };
  };
  const sGear = sumRow('analytics.gearPerKill');
  const sGold = sumRow('analytics.goldPerKill');
  const sLeg = sumRow('analytics.legPerKill');
  const sToLeg = sumRow('analytics.killsToLegendMean');
  const sGap = sumRow('analytics.maxGap');

  // ── 가운데: 등급 · 옵션 수 · 티어 ──
  const mid = el.appendChild(W.el('div', 'an-col an-sim-mid'));
  const tRarity = compareTable(W, t, 'analytics.sec.rarity', RARITIES.map((r) => ({ id: r, label: t('rarity.' + r), cls: 'r-' + r })));
  mid.appendChild(tRarity.el);
  const AFFIX_KS = [0, 1, 2, 3, 4, 5, 6];
  const tAffix = compareTable(W, t, 'analytics.sec.affixCount', AFFIX_KS.map((k) => ({ id: k, label: String(k) })));
  mid.appendChild(tAffix.el);
  const tTier = compareTable(W, t, 'analytics.sec.tier', [1, 2, 3, 4, 5].map((k) => ({ id: k, label: 'T' + k })));
  mid.appendChild(tTier.el);

  // ── 오른쪽: 부위 · 전설까지 처치 수 히스토그램 ──
  const right = el.appendChild(W.el('div', 'an-col an-sim-right'));
  const tSlot = compareTable(W, t, 'analytics.sec.slot', ITEM_SLOTS.map((s) => ({ id: s, label: t('islot.' + s) })));
  right.appendChild(tSlot.el);
  const histBox = right.appendChild(W.el('div', 'an-block an-hist-box'));
  histBox.appendChild(W.el('h3', 'an-h', t('analytics.killsToLegend')));
  const hist = histBox.appendChild(W.el('div', 'an-hist'));
  /** @type {HTMLElement[]} */
  const bars = [];
  for (let i = 0; i < HIST_BINS; i++) {
    const b = hist.appendChild(W.el('div', 'an-hbar'));
    bars.push(b);
  }
  const theoryMark = hist.appendChild(W.el('div', 'an-hmark'));
  const axis = histBox.appendChild(W.el('div', 'an-haxis'));
  const axisL = axis.appendChild(W.el('span', '', '0'));
  const axisM = axis.appendChild(W.el('span'));
  const axisR = axis.appendChild(W.el('span'));
  const histCap = histBox.appendChild(W.el('div', 'an-hcap'));
  const histTh = histBox.appendChild(W.el('div', 'an-hcap an-hcap-th'));

  const foot = el.appendChild(W.el('div', 'an-foot'));
  foot.appendChild(W.el('div', 'panel-hint', t('analytics.errNote')));
  const hint = foot.appendChild(W.el('div', 'panel-hint', t('analytics.hint.sim')));
  void hint; void axisL;

  function clearSim() {
    if (busy()) return;
    dsim = null;
    runner = null;
    phase = 'idle';
    ranKey = '';
    progress.set(0, '');
  }

  function cancel() {
    if (runner && runner.cancel()) form.refresh();
  }

  function run() {
    if (busy()) return;
    theory = theoryNow();
    ranKey = keyOf();
    dsim = createDropSim({ rank: p.rank, level: p.level, cls: p.cls, mf: p.mf / 100, blpOn: p.blpOn, seed: p.seed });
    sched ??= createScheduler();
    const sim = dsim;
    const sc = sched;
    startedAt = defaultNow();
    lastRender = 0;
    elapsedMs = 0;
    phase = 'running';
    runner = createChunkRunner({
      total: p.n,
      step: (k) => sim.run(k),
      schedule: (fn) => sc.schedule(fn),
      onSlice: (done, all) => {
        elapsedMs = defaultNow() - startedAt;
        progress.set(all > 0 ? done / all : 1, fmtPct(all > 0 ? done / all : 1, 0));
        if (done >= all || defaultNow() - lastRender >= RENDER_EVERY_MS) render();
      },
      onDone: ({ cancelled }) => {
        elapsedMs = defaultNow() - startedAt;
        phase = cancelled ? 'cancelled' : 'done';
        // 화면 확인용 표식(조각 수 · 가장 긴 조각 ms — 헤드리스 검사가 읽는다)
        el.dataset.slices = String(runner?.slices ?? 0);
        el.dataset.maxSliceMs = (runner?.maxSliceMs ?? 0).toFixed(2);
        el.dataset.scheduler = sc.kind;
        form.refresh();
        render();
      },
    });
    runner.start();
    form.refresh();
    render();
  }

  /** 결과를 그린다(굴리는 중이면 지금까지의 결과) */
  function render() {
    lastRender = defaultNow();
    const th = theory ?? (theory = theoryNow());
    const r = dsim && ranKey === keyOf() ? dsim.result() : null;
    const done = runner ? runner.done : 0;
    // 상태 줄
    if (phase === 'running') status.textContent = t('analytics.state.running', { n: fmtInt(done), m: fmtInt(runner?.total ?? 0) });
    else if (phase === 'done') status.textContent = t('analytics.state.done', { n: fmtInt(done), sec: fmtNum(elapsedMs / 1000, 1) });
    else if (phase === 'cancelled') status.textContent = t('analytics.state.cancelled', { n: fmtInt(done), m: fmtInt(runner?.total ?? 0) });
    else status.textContent = t('analytics.state.idle');
    status.className = 'an-status is-' + phase;
    // 표 넷
    const gear = r ? r.gear : 0;
    tRarity.set((id) => th.rarity[id] ?? 0, r ? (id) => r.byRarity[id] ?? 0 : null, gear);
    tSlot.set((id) => th.slot[id] ?? 0, r ? (id) => r.bySlot[id] ?? 0 : null, gear);
    tAffix.set((id) => th.affixCount[/** @type {number} */ (id)] ?? 0, r ? (id) => r.affixCount[/** @type {number} */ (id)] ?? 0 : null, gear);
    let affixes = 0;
    if (r) for (const x of r.tiers) affixes += x;
    tTier.set((id) => th.tiers[Number(id) - 1] ?? 0, r ? (id) => r.tiers[Number(id) - 1] ?? 0 : null, affixes);
    // 요약
    const kills = r ? r.kills : 0;
    /** @param {{th:HTMLElement, sim:HTMLElement, err:HTMLElement, tr:HTMLElement}} row @param {number} tv @param {number} sv @param {number} d @param {number} [sd] 처치당 표준편차(표본 오차) */
    const putRow = (row, tv, sv, d, sd = NaN) => {
      row.th.textContent = Number.isFinite(tv) ? fmtNum(tv, d) : '∞';
      if (!(kills > 0) || !Number.isFinite(sv)) { row.sim.textContent = '—'; row.err.textContent = ''; row.tr.className = ''; return; }
      row.sim.textContent = fmtNum(sv, d);
      if (!(Number.isFinite(tv) && tv > 0)) { row.err.textContent = ''; row.tr.className = ''; return; }
      const e = (sv - tv) / tv;
      row.err.textContent = errText(e);
      const z = Number.isFinite(sd) && sd > 0 ? (sv - tv) / (sd / Math.sqrt(kills)) : NaN;
      const ok = Math.abs(e) <= ERR_OK || (Number.isFinite(z) && Math.abs(z) < Z_OK);
      row.tr.className = ok ? 'is-ok' : 'is-bad';
    };
    putRow(sGear, th.gearPerKill, r ? r.gear / kills : NaN, 3, th.gearSdPerKill);
    putRow(sGold, th.goldPerKill, r ? r.goldAmount / kills : NaN, 2, th.goldSdPerKill);
    const legs = r ? r.byRarity.legendary ?? 0 : 0;
    putRow(sLeg, th.legPerKill, r ? legs / kills : NaN, 4, Math.sqrt(Math.max(0, th.legPerKill)));   // 처치당 전설 수 ≈ 푸아송
    const h = histogram(r ? r.killsToLegendary : [], { bins: HIST_BINS });
    // 전설까지 처치 수 ≈ 기하 분포(평균 μ = 1/q · 표준편차 μ√(1−q)) — 평균의 표본 오차는 표본 수 h.n 으로(putRow 는 √kills 로 나누므로 맞춰 준다)
    const sdToLeg = Number.isFinite(th.meanKillsToLeg) ? th.meanKillsToLeg * Math.sqrt(Math.max(0, 1 - th.pKillLeg)) * Math.sqrt(kills / Math.max(1, h.n)) : NaN;
    putRow(sToLeg, th.meanKillsToLeg, h.n > 0 ? h.mean : NaN, 1, sdToLeg);
    // 최대 간격 — 켬이면 상한 BLP.hard 와 비교
    sGap.th.textContent = p.blpOn && ranKey ? '≤ ' + fmtInt(BLP.hard) : '—';
    if (r && kills > 0) {
      sGap.sim.textContent = fmtInt(r.maxGearGap);
      sGap.err.textContent = '';
      sGap.tr.className = p.blpOn ? (r.maxGearGap <= BLP.hard ? 'is-ok' : 'is-bad') : '';
    } else { sGap.sim.textContent = '—'; sGap.err.textContent = ''; sGap.tr.className = ''; }
    // 히스토그램
    const span = h.width * HIST_BINS;
    for (let i = 0; i < HIST_BINS; i++) {
      const v = h.peak > 0 ? h.counts[i] / h.peak : 0;
      bars[i].style.transform = `scaleY(${v.toFixed(3)})`;
      bars[i].title = `${fmtInt(i * h.width + 1)}–${fmtInt((i + 1) * h.width)}: ${fmtInt(h.counts[i])}`;
    }
    axisM.textContent = h.n > 0 ? fmtInt(span / 2) : '';
    axisR.textContent = h.n > 0 ? fmtInt(span) + (h.over > 0 ? '+' : '') : '';
    if (h.n > 0 && Number.isFinite(th.meanKillsToLeg) && th.meanKillsToLeg <= span) {
      theoryMark.hidden = false;
      theoryMark.style.left = `${((th.meanKillsToLeg / span) * 100).toFixed(2)}%`;
    } else theoryMark.hidden = true;
    histCap.textContent = h.n > 0
      ? t('analytics.hist.stats', { mean: fmtNum(h.mean, 1), median: fmtNum(h.median, 1), max: fmtInt(h.max), n: fmtInt(h.n), over: fmtInt(h.over) })
      : (r && kills > 0 ? t('analytics.hist.none') : '');
    histTh.textContent = t('analytics.hist.theory', { v: Number.isFinite(th.meanKillsToLeg) ? fmtNum(th.meanKillsToLeg, 1) : '∞' });
  }

  return {
    el,
    /** 패널이 이 탭을 보일 때 — 처음이면 지금 캐릭터 · 균열로 기본값 @param {any} state */
    show(state) {
      if (!initialized) {
        initialized = true;
        const ch = state?.char ?? null;
        if (ch && CLASS_IDS.includes(ch.cls)) p.cls = ch.cls;
        const lv = state?.rift?.level ?? ch?.riftUnlocked ?? 1;
        p.level = Math.max(1, Math.min(maxLevel, Math.floor(Number(lv)) || 1));
        theory = null;
      }
      form.nav.active = true;
      if (form.nav.index < 0) form.nav.focus(0, true);
      form.refresh();
      render();
    },
    hide() {
      form.nav.active = false;
    },
    /** 패널이 닫힐 때 — 굴리던 것은 멈춘다(닫힌 뒤 게임과 시간을 다투지 않게 · 결과는 그대로 남는다) */
    stop() { cancel(); },
    /** @param {any} _state */
    update(_state) {},
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.type === 'keyup') return false;
      if (e.code === KEY_CANCEL && busy()) { cancel(); return true; }
      return form.handleKey(e);
    },
    /** 테스트 · 화면 확인용 — 지금 상태 */
    get phase() { return phase; },
    get params() { return { ...p }; },
    run,
    cancel,
    dispose() {
      cancel();
      form.destroy();
      sched?.dispose();
      sched = null;
      el.remove();
    },
  };
}
