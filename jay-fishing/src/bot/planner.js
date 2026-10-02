// OWNER: P10 — 계약 §6.8 · §12.1
// 하루 계획 — 지금 무엇을 할지(Goal)와, 판매상 · PC 앞에서 패널로 할 일(BotCommand)을 정한다.
// 읽는 것: 상태(시계 · 씬 · 프로필 · 플레이어 · rig 단계)와 데이터 표, GameSim 의 getRigStats 뿐.
// 읽지 않는 것: rig.bite · fight.* 의 숨은 값 · biteInfo() — 계획은 파이팅을 보지 않는다.
// 기억(사람의 머릿속)은 판매상을 다녀온 시각 · PC 를 마친 귀가 · 산 라인의 최고 단계뿐이고, 나머지는 프로필에서 다시 읽는다
// — 세이브를 불러 새로 만든 봇도 같은 계획을 이어 간다(H4).

import { TICKS_PER_DAY, TICKS_PER_HOUR, SET_IDS } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { BOT, PLAN } from '../data/bot.js';
import { BAITS } from '../data/baits.js';
import { CAST } from '../data/bite.js';
import { GEAR, GEAR_BY_ID, GEAR_GATES } from '../data/gear.js';
import { HOLD } from '../data/economy.js';
import { TIME } from '../data/time.js';
import { STAGES_BY_ID, SPOTS_BY_ID, stageOfSpot } from '../data/stages/index.js';
import { depthAt } from '../sim/fishing/biteModel.js';
import { availableCount, skillRank } from '../sim/progression/modifiers.js';

/** @typedef {import('../types.js').BotCommand} BotCommand */
/**
 * @typedef {{kind:'fish', spotId:string, set:'float'|'bottom', baitId:string, depthM:number|null, hook:string|null}
 *   | {kind:'sell', at:'vendor'} | {kind:'buy', at:'pc'} | {kind:'travel', to:string} | {kind:'sleep'}
 *   | {kind:'skill', skillId:string} | {kind:'walkTo', x:number, z:number}} Goal
 */

/** 미끼가 물속에 있는 단계(일어나면 회수 — 돌려받는다) */
const IN_WATER = ['casting', 'waiting', 'retrieving'];
const PLAN_IDS = ['lakeDay', 'coastDay', 'riverDay', 'progress', 'stay'];
/** 스테이지 → 그 스테이지의 하루 계획(진행 봇이 지금 있는 스테이지에서 쓰는 byBand) */
const DAY_PLAN_OF_STAGE = { lake: 'lakeDay', coast: 'coastDay', river: 'riverDay' };
const BAITS_BY_ID = Object.fromEntries(BAITS.map(b => [b.id, b]));
const BAIT_PACK = 'bait_';
/** 세트 · 부위마다 끼울 수 있는 2·3단계 장비(단계 내림차순) — 보유한 것 중 가장 좋은 것을 끼운다 */
const UPGRADE_SLOTS = { float: ['rod', 'float'], bottom: ['rod', 'sinker'] };

/** 같은 Goal 을 틱마다 새로 만들지 않는다 */
const SLEEP = Object.freeze({ kind: 'sleep' });
const SELL = Object.freeze({ kind: 'sell', at: 'vendor' });
const BUY = Object.freeze({ kind: 'buy', at: 'pc' });
const TRAVEL = Object.fromEntries(['home', 'lake', 'coast', 'river'].map(id => [id, Object.freeze({ kind: 'travel', to: id })]));
/** @param {string} to @returns {Goal} */
function travelGoal(to) {
  return /** @type {Goal} */ (TRAVEL[to]);
}

/** 절대 틱(일 경계를 넘는 비교용) @param {{day:number, tickInDay:number}} c */
export function absTick(c) {
  return c.day * TICKS_PER_DAY + c.tickInDay;
}

/** 시각 h 가 [from, to) 안인가(자정을 넘는 구간 포함) */
function inHours(h, from, to) {
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** 장비 단계(모르는 ID 는 1) @param {string|null} id */
function tierOf(id) {
  const g = id ? GEAR_BY_ID[id] : null;
  return g ? g.tier : 1;
}

/** 2·3단계 장비를 지금 살 수 있는 레벨 · 숙련인가(GEAR_GATES — PC 상점의 잠김과 같은 규칙) @param {any} profile @param {number} tier */
function gateOk(profile, tier) {
  if (tier >= 3) return profile.level >= GEAR_GATES.tier3Level && skillRank(profile, 'mastery') >= GEAR_GATES.tier3Mastery;
  if (tier >= 2) return profile.level >= GEAR_GATES.tier2Level;
  return true;
}

/** 라인 감기 비용(판매상 값 — 같은 라인이면 모자란 m, 다른 라인이면 스풀 가득) @param {any} profile @param {string} set @param {string} lineId */
export function refillCost(profile, set, lineId) {
  const cfg = profile.sets[set];
  const cap = GEAR_BY_ID[cfg.reel].capacityM;
  const line = GEAR_BY_ID[lineId];
  const meters = cfg.lineId === lineId ? Math.max(0, cap - cfg.lineM) : cap;
  return Math.round(meters * line.pricePerM);
}

/** 스킬 순서에서 다음에 배울 것(없으면 null) — 프로필의 랭크에서 다시 읽는다 @param {any} profile */
export function nextSkill(profile) {
  if (!(profile.skillPoints >= 1)) return null;
  const seen = {};
  for (const id of BOT.plans.progress.skillOrder) {
    seen[id] = (seen[id] ?? 0) + 1;
    if (skillRank(profile, id) < seen[id]) return id;
  }
  return null;
}

/**
 * buyOrder 의 다음 항목(없으면 null). 장비는 보유 수가 그 항목까지의 등장 수에 못 미치면 아직 — 부러져 잃은 로드도 여기서 다시 나온다
 * (순서상 먼저라 「buyOrder 보다 먼저」가 저절로 지켜진다). 라인은 산 적 있는 최고 단계(bestLine)로 본다.
 * @param {any} profile @param {number} bestLine
 */
export function nextPurchase(profile, bestLine) {
  const need = {};
  for (const id of BOT.plans.progress.buyOrder) {
    const g = GEAR_BY_ID[id];
    if (!g) continue;
    if (g.slot === 'line') {
      if (bestLine >= g.tier) continue;
      return id;
    }
    need[id] = (need[id] ?? 0) + 1;
    if ((profile.owned[id] ?? 0) >= need[id]) continue;
    return id;
  }
  return null;
}

/** 다음 항목의 값(라인은 두 세트를 그 라인으로 감는 비용) @param {any} profile @param {string} id */
export function purchaseCost(profile, id) {
  const g = GEAR_BY_ID[id];
  if (g.slot !== 'line') return g.price;
  let c = 0;
  for (const set of SET_IDS) if (tierOf(profile.sets[set].lineId) < g.tier) c += refillCost(profile, set, id);
  return c;
}

/**
 * 보유한 것 중 가장 좋은 장비 배치(§12.1): 로드 · 찌 · 봉돌은 그 세트의 최고 단계, 릴은 첫 reel_2 를 찌 세트 · 첫 reel_3 을 바닥 세트에.
 * 바늘은 hook(강의 riverHook)이 있으면 두 세트에. → 지금과 다른 [set, slot, itemId] 목록
 * @param {any} profile @param {string|null} hook
 */
export function equipWanted(profile, hook) {
  /** @type {Array<[string, string, string]>} */
  const out = [];
  for (const set of SET_IDS) {
    for (const slot of UPGRADE_SLOTS[set]) {
      let best = null;
      for (const g of GEAR) {
        if (g.slot !== slot || g.tier < 2 || (profile.owned[g.id] ?? 0) < 1) continue;
        if (slot === 'rod' && g.set !== set) continue;
        if (!best || g.tier > best.tier) best = g;
      }
      const cur = profile.sets[set][slot];
      if (best && best.tier > tierOf(cur)) out.push([set, slot, best.id]);
    }
  }
  // 릴: 보유한 2·3단계 릴을 단계 내림차순으로 펼쳐 첫째는 선호 세트(3단계 → 바닥 · 2단계 → 찌), 둘째는 다른 세트
  const reels = [];
  for (const g of GEAR) {
    if (g.slot !== 'reel' || g.tier < 2) continue;
    for (let i = 0; i < Math.min(2, profile.owned[g.id] ?? 0); i++) reels.push(g);
  }
  reels.sort((a, b) => b.tier - a.tier);                 // 세트는 둘 — 앞의 둘만 쓴다
  if (reels.length) {
    const first = reels[0].tier >= 3 ? 'bottom' : 'float';
    const second = first === 'float' ? 'bottom' : 'float';
    const want = { [first]: reels[0], [second]: reels[1] ?? null };
    for (const set of SET_IDS) {
      const g = want[set];
      if (g && g.tier > tierOf(profile.sets[set].reel)) out.push([set, 'reel', g.id]);
    }
  }
  if (hook) for (const set of SET_IDS) if (profile.sets[set].hook !== hook) out.push([set, 'hook', hook]);
  // 지금 끼울 수 있는 것만(다른 세트가 쓰는 중이면 그 세트가 먼저 바뀐다)
  return out.filter(([set, , id]) => GEAR_BY_ID[id].tier === 1 || availableCount(profile, id, /** @type {any} */ (set)) >= 1);
}

/**
 * @param {'lakeDay'|'coastDay'|'riverDay'|'progress'|'stay'} planId
 * @param {{spotId?:string|null, set?:string|null, baitId?:string|null}} [opts]
 * @returns {{next(state:Object, sim:Object): Goal|null, command(state:Object, at:'vendor'|'pc', tried:Set<string>): BotCommand|null,
 *            done(state:Object, at:'vendor'|'pc'):void, skill(state:Object): string|null, equips(state:Object, goal:Goal|null): Array<[string,string,string]>,
 *            reset():void, planId:string}}
 */
export function createPlanner(planId, opts = {}) {
  if (!PLAN_IDS.includes(planId)) throw new Error(`unknown plan: ${planId}`);
  const progress = planId === 'progress';
  const o = opts || {};

  // 사람의 기억
  let bestLine = 1;          // 산 적 있는 라인의 최고 단계(예비 스풀로 내려가도 기억한다)
  let vendorAt = -Infinity;  // 판매상 일을 마친 절대 틱
  let pcDoneScene = 0;       // PC 를 마친 귀가의 번호(집에 들어올 때마다 +1)
  let homeVisit = 0;
  let lastScene = '';
  /** 찌 수심 캐시(자리 · 비거리가 같으면 다시 계산하지 않는다) */
  let depthKey = '';
  let depthVal = 0;
  /** 같은 fish Goal 을 틱마다 새로 만들지 않는다 */
  let fishGoal = /** @type {any} */ (null);

  function reset() {
    bestLine = 1;
    vendorAt = -Infinity;
    pcDoneScene = 0;
    homeVisit = 0;
    lastScene = '';
    depthKey = '';
    fishGoal = null;
  }

  /** 지금 있는 스테이지에서 쓸 하루 계획 id @param {any} state */
  function dayPlanHere(state) {
    if (!progress) return planId;
    return DAY_PLAN_OF_STAGE[state.scene] ?? 'lakeDay';
  }

  /** 진행 봇이 오늘 갈 스테이지(레벨 — 잠겨 있으면 그 아래) @param {any} profile */
  function targetStage(profile) {
    if (!progress) return BOT.plans[planId].stage;
    const p = BOT.plans.progress;
    if (profile.level >= p.riverFromLevel) return 'river';
    if (profile.level >= p.coastFromLevel) return 'coast';
    return 'lake';
  }

  /** 찌 세트의 수심 = 그 자리에서 BOT.castPower 로 던졌을 때 착수점 수심의 절반(중층 — §12.1) @param {any} sim @param {any} spot */
  function midDepth(sim, spot) {
    const rs = sim && typeof sim.getRigStats === 'function' ? sim.getRigStats('float') : null;
    const castMax = rs ? rs.castMaxM : 24;
    const key = spot.id + '|' + castMax;
    if (key === depthKey) return depthVal;
    const dist = clamp(castMax * (CAST.minFactor + CAST.slope * BOT.castPower.target), spot.minCastM, castMax);
    const d = depthAt(spot, dist) / 2;
    depthVal = clamp(Math.round(d / CAST.depthStepM) * CAST.depthStepM, CAST.depthMinM, CAST.depthMaxM);
    depthKey = key;
    return depthVal;
  }

  /** @param {any} state @param {any} sim @param {string} spotId @param {any} set @param {string} baitId */
  function fish(state, sim, spotId, set, baitId) {
    const spot = SPOTS_BY_ID[spotId];
    const depthM = set === 'float' && spot ? midDepth(sim, spot) : null;
    const hook = progress && stageOfSpot(spotId) === 'river' ? BOT.plans.progress.riverHook : null;
    const g = fishGoal;
    if (g && g.spotId === spotId && g.set === set && g.baitId === baitId && g.depthM === depthM && g.hook === hook) return g;
    fishGoal = Object.freeze({ kind: 'fish', spotId, set, baitId, depthM, hook });
    return fishGoal;
  }

  /** 지금 시간대의 [자리, 세트, 미끼] (지금 스테이지의 하루 계획) @param {any} state */
  function bandEntry(state) {
    const plan = BOT.plans[dayPlanHere(state)];
    return plan.byBand[state.clock.band] ?? plan.byBand.day;
  }

  /** 이 스테이지 계획이 쓰는 미끼 전부 @param {string} stage */
  function planBaits(stage) {
    const plan = BOT.plans[DAY_PLAN_OF_STAGE[stage]];
    const out = [];
    if (!plan) return out;
    for (const b of Object.keys(plan.byBand)) if (!out.includes(plan.byBand[b][2])) out.push(plan.byBand[b][2]);
    return out;
  }

  /** 라인을 다시 감아야 하는 세트의 [set, lineId, cost] (진행 봇 — 산 것 중 최고 단계 · 70% 아래) @param {any} profile @param {boolean} atHome */
  function lineRestore(profile, atHome) {
    const out = [];
    if (!progress) return out;
    for (const set of SET_IDS) {
      const cfg = profile.sets[set];
      const cap = GEAR_BY_ID[cfg.reel].capacityM;
      const tier = tierOf(cfg.lineId);
      let lineId = null;
      if (tier < bestLine) lineId = `line_${bestLine}`;
      else if (cfg.lineM < PLAN.lineRestoreFrac * cap) lineId = cfg.lineId;
      if (!lineId || !GEAR_BY_ID[lineId]) continue;
      const free = atHome && lineId === 'line_1';
      out.push([set, lineId, free ? 0 : refillCost(profile, set, lineId)]);
    }
    return out;
  }

  /** 다음 업그레이드를 지금 살 수 있나(레벨 · 숙련 · 돈 + 미끼 여유) → 항목 id 또는 null @param {any} profile */
  function affordableUpgrade(profile) {
    if (!progress) return null;
    const id = nextPurchase(profile, bestLine);
    if (!id) return null;
    const g = GEAR_BY_ID[id];
    if (!gateOk(profile, g.tier)) return null;
    return profile.money >= purchaseCost(profile, id) + PLAN.moneyReserve ? id : null;
  }

  /** 판매상에 가야 하나(어창 가득 · 미끼 부족 · 라인 · 라인 업그레이드) @param {any} state */
  function vendorNeeded(state) {
    const p = state.profile;
    if (p.hold.length >= HOLD.capacity) return true;
    if (absTick(state.clock) - vendorAt < PLAN.retryHours * TICKS_PER_HOUR) return false;
    const bait = bandEntry(state)[2];
    const pack = BAITS_BY_ID[bait];
    // 물속의 미끼도 센다(일어나면 회수해 돌려받는다 — 세지 않으면 일어남 ↔ 다시 앉음을 되풀이한다)
    const r = state.rig;
    const wet = state.player.mode === 'fish' && IN_WATER.includes(r.phase) && r.castBaitId === bait ? 1 : 0;
    if ((p.baits[bait] ?? 0) + wet < PLAN.baitLow && pack && p.money >= pack.packPrice) return true;
    for (const [, , cost] of lineRestore(p, false)) if (p.money >= cost) return true;
    const up = affordableUpgrade(p);
    return !!up && GEAR_BY_ID[up].slot === 'line';
  }

  /**
   * 지금의 목표.
   * @param {any} state @param {any} sim @returns {Goal|null}
   */
  function next(state, sim) {
    const p = state.profile;
    if (state.scene !== lastScene) {
      if (state.scene === 'home') homeVisit++;
      lastScene = state.scene;
    }
    for (const set of SET_IDS) bestLine = Math.max(bestLine, tierOf(p.sets[set].lineId));

    if (planId === 'stay') {
      const spotId = o.spotId && SPOTS_BY_ID[o.spotId] && stageOfSpot(o.spotId) === state.scene ? o.spotId
        : (state.player.spotId ?? (STAGES_BY_ID[state.scene]?.spots[0]?.id ?? null));
      if (!spotId) return null;
      const set = /** @type {any} */ (o.set ?? state.rig.set);
      const bait = o.baitId ?? p.sets[set].bait;
      return fish(state, sim, spotId, set, bait);
    }

    const hour = state.clock.hour;
    if (state.scene === 'home') {
      if (progress && pcDoneScene !== homeVisit && command(state, 'pc', null)) return BUY;
      if (inHours(hour, PLAN.homeSleepFrom, TIME.wakeHour)) return SLEEP;
      let to = targetStage(p);
      // 지도 패널이 보이는 것(getTravel)으로 잠김을 본다 — 잠겼으면 호수로
      const travel = sim && typeof sim.getTravel === 'function' ? sim.getTravel() : null;
      const row = travel ? travel.find(t => t.id === to) : null;
      if (row && !row.ok) to = 'lake';
      return travelGoal(to);
    }
    // 야외
    if (inHours(hour, PLAN.dayEndHour, TIME.wakeHour)) return travelGoal('home');
    if (!progress && state.scene !== BOT.plans[planId].stage) return travelGoal('home');
    if (progress) {
      const up = affordableUpgrade(p);
      if (up && GEAR_BY_ID[up].slot !== 'line') return travelGoal('home');
    }
    if (vendorNeeded(state)) return SELL;
    const [spotId, set, bait] = bandEntry(state);
    return fish(state, sim, spotId, set, bait);
  }

  /** 미끼 팩 구매 명령(이 스테이지 계획 미끼 중 baitRestock 아래인 것을 baitTarget 까지 — 돈 안에서) @param {any} p @param {string} stage */
  function baitCommand(p, stage, tried) {
    for (const bait of planBaits(stage)) {
      const pack = BAITS_BY_ID[bait];
      const have = p.baits[bait] ?? 0;
      if (!pack || have >= PLAN.baitRestock) continue;
      const want = Math.ceil((PLAN.baitTarget - have) / pack.packSize);
      const qty = Math.min(want, Math.floor(p.money / pack.packPrice));
      const key = 'buy|' + BAIT_PACK + bait;
      if (qty >= 1 && !(tried && tried.has(key))) return { name: 'buy', args: [BAIT_PACK + bait, qty], key };
    }
    return null;
  }

  /**
   * 판매상 · PC 패널에서 낼 다음 명령(없으면 null — 그 자리의 일이 끝났다). tried 의 key 는 이번 방문에 이미 낸 것(실패해도 되풀이하지 않는다).
   * @param {any} state @param {'vendor'|'pc'} at @param {Set<string>|null} tried
   * @returns {(BotCommand & {key:string})|null}
   */
  function command(state, at, tried) {
    const p = state.profile;
    const has = (k) => !!(tried && tried.has(k));
    if (p.hold.length > 0 && !has('sellAll')) return { name: 'sellAll', args: [], key: 'sellAll' };
    const atHome = at === 'pc';
    // 업그레이드(진행 봇): 장비는 PC 에서만, 라인은 두 곳 다
    if (progress) {
      const up = affordableUpgrade(p);
      if (up) {
        const g = GEAR_BY_ID[up];
        if (g.slot === 'line') {
          for (const set of SET_IDS) {
            const key = `refill|${set}|${up}`;
            if (tierOf(p.sets[set].lineId) < g.tier && !has(key)) return { name: 'refillLine', args: [set, up], key };
          }
        } else if (atHome && !has('buy|' + up)) {
          return { name: 'buy', args: [up, 1], key: 'buy|' + up };
        }
      }
      for (const [set, lineId, cost] of lineRestore(p, atHome)) {
        const key = `refill|${set}|${lineId}`;
        if (p.money >= cost && !has(key)) return { name: 'refillLine', args: [set, lineId], key };
      }
    }
    const stage = atHome ? targetStage(p) : state.scene;
    return baitCommand(p, stage, tried);
  }

  /** 그 자리의 일이 끝났다(다시 가지 않게 기억한다) @param {any} state @param {'vendor'|'pc'} at */
  function done(state, at) {
    if (at === 'vendor') vendorAt = absTick(state.clock);
    else pcDoneScene = homeVisit;
  }

  /** 지금 배울 스킬(진행 봇만 — skillOrder) @param {any} state */
  function skill(state) {
    return progress ? nextSkill(state.profile) : null;
  }

  /** 지금 끼울 장비(진행 봇 — 보유한 최고 단계 · 강의 바늘) @param {any} state @param {Goal|null} goal */
  function equips(state, goal) {
    if (!progress) return [];
    const hook = goal && goal.kind === 'fish' ? goal.hook : null;
    return equipWanted(state.profile, hook);
  }

  return { next, command, done, skill, equips, reset, planId };
}
