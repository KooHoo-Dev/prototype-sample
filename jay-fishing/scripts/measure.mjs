// OWNER: P10 — 계약 §12.5 · §7.12 · §12.6
// 측정 목표(M1–M16)를 실제 GameSim + 봇(createBot · createAngler — 화면의 봇과 같은 정책)으로 잰다.
//   npm run measure                → §7.12 와 같은 표(설계 값 · 측정 값 · 판정) — 밸런스 게이트가 읽는다
//   npm run measure -- --only M1,M4 · --json · --quick(표본 절반 — 손잡이를 돌려 볼 때)
// test/measure.test.js · test/headless.test.js · test/bot.test.js 가 이 모듈의 러너와 시나리오를 그대로 쓴다.
//
// 러너 규칙(§6.8 · §12.4): 틱마다 a = bot.decide(state, sim) → a.command 가 있으면 step 전에 실행 →
// rig.phase === 'result' 면 그 틱은 step 하지 않는다 → 아니면 sim.step(a.input).
// 측정 하네스(이 파일)는 봇이 아니다 — 크기 분류 · 어종 · 낚싯대 교체 같은 「사람이 보지 못하는 값」과 debug* 는 하네스만 쓴다.

import { pathToFileURL } from 'node:url';
import { DT, RIG_PHASES, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { BAITS } from '../src/data/baits.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { BOT } from '../src/data/bot.js';
import { SPECIES_BY_ID } from '../src/data/species/index.js';
import { SPOTS_BY_ID, stageOfSpot } from '../src/data/stages/index.js';
import { GameSim } from '../src/sim/GameSim.js';
import { rollFish } from '../src/sim/fishing/catch.js';
import { fishPrice } from '../src/sim/progression/economy.js';
import { makeDevProfile } from '../src/sim/progression/profile.js';
import { createBot } from '../src/bot/bot.js';
import { createAngler } from '../src/bot/angler.js';

/** §6.8 — 봇이 낼 수 있는 명령 */
export const BOT_COMMANDS = new Set(['keepCatch', 'releaseCatch', 'sellAll', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth',
  'learnSkill', 'travel', 'waitNextBand', 'sleep', 'exitFishing']);

const BAIT_UNIT = Object.fromEntries(BAITS.map(b => [b.id, b.packPrice / b.packSize]));

// ── 기초 도구

/** 절대 틱 @param {{day:number, tickInDay:number}} c */
export const absTick = (c) => c.day * TICKS_PER_DAY + c.tickInDay;

/** @param {number[]} xs @param {number} q */
export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (xs) => quantile(xs, 0.5);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n, d) => (d > 0 ? n / d : NaN);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : String(v));
const p100 = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : String(v));

/**
 * GameSim 하나 + 이벤트 구독(시작 이벤트 전에 붙인다).
 * @param {{seed?:number, start?:Object, profile?:Object, save?:Object, session?:Object}} [opts]
 * @param {Array<(name:string, payload:any, sim:GameSim) => void>} [listeners]
 */
export function makeSim(opts = {}, listeners = []) {
  const bus = new EventBus();
  /** @type {GameSim|null} */
  let sim = null;
  const subs = [...listeners];
  bus.onAny((name, payload) => { for (const f of subs) f(name, payload, /** @type {GameSim} */ (sim)); });
  sim = new GameSim({ bus, seed: opts.seed ?? 1, save: opts.save ?? null, profile: opts.profile, session: opts.session, start: opts.start });
  sim.start();
  return { sim, bus, listen: (f) => subs.push(f) };
}

/**
 * §6.8 러너. until(state) 가 참이면 멈춘다. → 실제로 민 틱 수
 * @param {GameSim} sim @param {{decide:Function}} bot
 * @param {{maxTicks:number, until?:(s:any)=>boolean, onTick?:(sim:GameSim, a:any)=>void, onCommand?:(c:any, r:any, sim:GameSim)=>void}} o
 */
export function runBot(sim, bot, o) {
  let steps = 0;
  let resultSpins = 0;
  while (steps < o.maxTicks) {
    if (o.until && o.until(sim.state)) break;
    const a = bot.decide(sim.state, sim);
    if (a.command) {
      const c = a.command;
      if (!BOT_COMMANDS.has(c.name)) throw new Error(`봇이 목록 밖 명령을 냈다: ${c.name}`);
      const r = sim[c.name](...c.args);
      if (o.onCommand) o.onCommand(c, r, sim);
    }
    if (sim.state.rig.phase === 'result') {
      if (++resultSpins > 600) throw new Error('결과 단계에서 600번 넘게 명령 없이 돌았다');
      continue;
    }
    resultSpins = 0;
    sim.step(a.input);
    steps++;
    if (o.onTick) o.onTick(sim, a);
  }
  return steps;
}

/** NaN · Infinity 를 찾는다(경로를 돌려준다 — 없으면 null) */
export function findNonFinite(obj, path = 'state', seen = new Set()) {
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
  seen.add(obj);
  for (const k of Object.keys(obj)) {
    const r = findNonFinite(obj[k], `${path}.${k}`, seen);
    if (r) return r;
  }
  return null;
}

// ── 파이팅 기록(하네스 — 크기 · 어종은 사람이 못 보지만 측정은 본다)

/**
 * 입질 · 챔질 · 파이팅 · 결과 · 실패를 한 줄씩 모은다. listener 를 makeSim 에, onTick 을 runBot 에 꽂는다.
 * @param {{snagOf?:(sim:GameSim)=>number|null}} [o]
 */
export function createFightLog() {
  const log = {
    bites: 0, hookMiss: { early: 0, late: 0 }, fights: /** @type {any[]} */ ([]), fails: /** @type {any[]} */ ([]),
    catches: /** @type {any[]} */ ([]), sold: 0, soldCount: 0, casts: 0, perfect: 0, castsInSnag: 0, splashes: /** @type {number[]} */ ([]),
    biteWaits: /** @type {number[]} */ ([]), nLanded: 0, nMediumEnded: 0,
  };
  let phase = '';
  let biteStart = -1;
  let splashTick = -1;
  let castDist = 0;
  /** @type {any} */ let cur = null;
  const listener = (name, p, sim) => {
    const s = sim.state;
    switch (name) {
      case EV.CAST_RELEASE: log.casts++; if (p.perfect) log.perfect++; break;
      case EV.CAST_SPLASH: {
        splashTick = s.tick; castDist = p.distM; log.splashes.push(p.distM);
        const spot = s.player.spotId ? SPOTS_BY_ID[s.player.spotId] : null;
        if (spot && p.distM >= spot.snag.fromM) log.castsInSnag++;
        break;
      }
      case EV.HOOK_MISS: log.hookMiss[p.reason]++; break;
      case EV.HOOK_SET: {
        const spot = s.player.spotId ? SPOTS_BY_ID[s.player.spotId] : null;
        cur = {
          weightKg: p.weightKg, speciesId: s.fight ? s.fight.speciesId : null, pct: s.fight ? s.fight.roll.pct : null,
          biteTick: biteStart, hookTick: s.tick, startDist: s.fight ? s.fight.dist : castDist,
          inSnag: !!(spot && s.fight && s.fight.dist >= spot.snag.fromM), outcome: null, durationSec: 0, totalSec: 0,
          spotId: s.player.spotId, rod: s.profile.sets[s.rig.set].rod,
        };
        log.fights.push(cur);
        break;
      }
      case EV.FIGHT_END:
        if (cur) {
          cur.outcome = p.outcome;
          cur.durationSec = p.durationSec;
          if (p.outcome === 'landed') log.nLanded++;
          if (cur.weightKg >= 1) log.nMediumEnded++;
        }
        break;
      case EV.CATCH_RESULT:
        if (cur) cur.totalSec = (s.tick - cur.biteTick) * DT;
        log.catches.push({ ...p.catch });
        cur = null;
        break;
      case EV.FAIL: log.fails.push({ reason: p.reason, loss: p.loss, tick: s.tick, set: s.rig.set }); if (!['early', 'late'].includes(p.reason)) cur = null; break;
      case EV.SOLD: log.sold += p.total; log.soldCount += p.count; break;
      default: break;
    }
  };
  const onTick = (sim) => {
    const ph = sim.state.rig.phase;
    if (ph !== phase) {
      if (ph === 'bite') {
        log.bites++;
        biteStart = sim.state.tick;
        if (splashTick >= 0) log.biteWaits.push((biteStart - splashTick) * DT);
      }
      phase = ph;
    }
  };
  return { log, listener, onTick };
}

// ── 프로필 · 장비 꾸리기(하네스)

/**
 * 레벨 · 장비 단계를 갖춘 프로필(스킬은 skillOrder 앞에서부터 그 레벨의 포인트만큼 — 진행 봇이 그때 가졌을 모양).
 * @param {{level:number, tier:1|2|3, money?:number, hook?:string, baits?:number}} o
 */
export function makeGearedProfile({ level, tier, money = 50000, hook = null, baits = 40 }) {
  const p = makeDevProfile({ level, money });
  for (const id of BOT.plans.progress.skillOrder) {
    if (p.skillPoints < 1) break;
    if ((p.skills[id] ?? 0) >= 3) continue;
    p.skills[id] = (p.skills[id] ?? 0) + 1;
    p.skillPoints--;
  }
  if (tier >= 2) {
    const t = tier;
    const own = { [`rod_float_${t}`]: 1, [`rod_bottom_${t}`]: 1, [`reel_${t}`]: 2, [`float_${t}`]: 1, [`sinker_${t}`]: 1 };
    for (const [k, v] of Object.entries(own)) p.owned[k] = v;
    for (const set of ['float', 'bottom']) {
      const c = p.sets[set];
      c.rod = `rod_${set}_${t}`;
      c.reel = `reel_${t}`;
      c.lineId = `line_${t}`;
      c.lineM = GEAR_BY_ID[`reel_${t}`].capacityM;
      if (set === 'float') c.float = `float_${t}`; else c.sinker = `sinker_${t}`;
    }
  }
  if (hook) for (const set of ['float', 'bottom']) p.sets[set].hook = hook;
  for (const b of Object.keys(p.baits)) p.baits[b] = Math.max(p.baits[b], baits);
  return p;
}

/** 입 크기에 맞는 바늘 @param {string} speciesId */
export function hookFor(speciesId) {
  const m = SPECIES_BY_ID[speciesId].mouth;
  return m >= 3 ? 'hook_l' : m === 2 ? 'hook_m' : 'hook_s';
}

/** 그 세트를 단계 장비로 다시 채운다(로드 파손 · 라인 소모 뒤 매 판 — debugSetGear 는 보유 수를 무시한다) */
function regear(sim, set, tier, hook) {
  sim.debugSetGear('rod', `rod_${set}_${tier}`, set);
  sim.debugSetGear('reel', `reel_${tier}`, set);
  sim.debugSetGear('line', `line_${tier}`, set);
  if (set === 'float') sim.debugSetGear('float', `float_${tier}`, set); else sim.debugSetGear('sinker', `sinker_${tier}`, set);
  if (hook) sim.debugSetGear('hook', hook, set);
}

// ── 시나리오

/**
 * 하루 계획 봇을 days 일 돌린다(집 06:00 → … → 침대 → 다음 날 06:00). 새 프로필이 기본.
 * @param {{seed:number, plan:string, strategy:string, days?:number, profile?:Object, session?:Object, botSeed?:number,
 *          stopWhen?:(log:any, sim:GameSim)=>boolean, maxDays?:number, check?:boolean, onCommand?:Function, onTick?:Function}} o
 */
export function runDays(o) {
  const fl = createFightLog();
  const extra = [];
  const { sim } = makeSim({ seed: o.seed, profile: o.profile, session: o.session }, [fl.listener, (n, p, s) => { for (const f of extra) f(n, p, s); }]);
  const bot = createBot({ strategy: /** @type {any} */ (o.strategy), seed: o.botSeed ?? o.seed, plan: /** @type {any} */ (o.plan) });
  const t0 = absTick(sim.state.clock);
  const money0 = sim.state.profile.money;
  const days = o.days ?? 1;
  const maxDays = o.maxDays ?? days;
  const endAt = t0 + days * TICKS_PER_DAY;
  const hardEnd = t0 + maxDays * TICKS_PER_DAY;
  let n = 0;
  let badCheck = null;
  runBot(sim, bot, {
    maxTicks: Math.ceil(maxDays * TICKS_PER_DAY * 1.1) + 1000,
    until: (s) => {
      const t = absTick(s.clock);
      if (o.stopWhen && o.stopWhen(fl.log, sim)) return true;
      if (o.stopWhen) return t >= hardEnd && s.scene === 'home';
      return t >= endAt && s.scene === 'home';
    },
    onTick: (sm, a) => {
      fl.onTick(sm);
      if (o.onTick) o.onTick(sm, a);
      if (o.check && ++n % 600 === 0 && !badCheck) {
        const bad = findNonFinite(sm.state);
        if (bad) badCheck = `NaN/Infinity: ${bad} @${sm.state.tick}`;
        else if (sm.state.profile.money < 0) badCheck = `돈 음수 @${sm.state.tick}`;
        else if (!RIG_PHASES.includes(sm.state.rig.phase)) badCheck = `phase ${sm.state.rig.phase}`;
      }
    },
    onCommand: o.onCommand,
  });
  return {
    sim, log: fl.log, money0, net: sim.state.profile.money - money0, days: (absTick(sim.state.clock) - t0) / TICKS_PER_DAY,
    badCheck, listen: (f) => extra.push(f),
  };
}

/**
 * 한 자리에서 강제 입질(debugForceBite)을 차례로 — 손은 실제 자리 봇(createAngler · 파이팅은 createFightPolicy).
 * 결과는 하네스가 방생한다(어창이 차지 않게). 매 판 전에 장비 단계 · 바늘을 다시 채운다(로드 파손 · 라인 소모).
 * @param {{spotId:string, set:'float'|'bottom', tier:1|2|3, hook?:string|null, strategy:string, trials:Array<[string, number]>, seed?:number, hour?:number}} o
 */
export function forcedFights(o) {
  const fl = createFightLog();
  const stage = stageOfSpot(o.spotId);
  const { sim } = makeSim({ seed: o.seed ?? 1, session: { ignoreGates: true, devSession: true }, start: { scene: stage, spotId: o.spotId, hour: o.hour ?? 9, weather: 'clear' } }, [fl.listener]);
  for (const b of Object.keys(sim.state.profile.baits)) sim.state.profile.baits[b] = 9999;
  sim.state.profile.money = 1e7;
  const hand = createAngler({ strategy: /** @type {any} */ (o.strategy), seed: o.seed ?? 1, set: o.set });
  let i = 0;
  let open = false;
  let guard = 0;
  while (true) {
    const s = sim.state;
    if (s.rig.phase === 'result') { sim.releaseCatch(); continue; }
    if (s.rig.phase === 'ready' && s.rig.set === o.set) {
      if (open) open = false;
      if (i >= o.trials.length) break;
      regear(sim, o.set, o.tier, o.hook ?? null);
      if (s.clock.hour > 20 || s.clock.hour < 5) sim.debugSetTime(o.hour ?? 9);
      const [sp, pc] = o.trials[i++];
      const r = sim.debugForceBite(sp, pc);
      if (!r.ok) throw new Error(`debugForceBite ${sp}: ${r.reason}`);
      open = true;
    }
    const a = hand.decide(sim.state, sim);
    if (a.command) sim[a.command.name](...a.command.args);
    if (sim.state.rig.phase === 'result') continue;
    sim.step(a.input);
    fl.onTick(sim);
    if (++guard > o.trials.length * 60 * 600) throw new Error('forcedFights: 끝나지 않는다');
  }
  return { sim, log: fl.log };
}

/** 파이팅 목록의 랜딩률 · 사유 @param {any[]} fights */
export function outcomeRates(fights) {
  const n = fights.length;
  const c = (o) => fights.filter(f => f.outcome === o).length;
  return { n, landed: pct(c('landed'), n), lineBreak: pct(c('lineBreak'), n), hookOff: pct(c('hookOff'), n), rodBreak: pct(c('rodBreak'), n), spoolEmpty: pct(c('spoolEmpty'), n) };
}

/** 그 어종이 w kg 이상이 되는 퍼센타일(이분 탐색) */
function pctForWeight(speciesId, w) {
  const sp = SPECIES_BY_ID[speciesId];
  let lo = 0.0001;
  let hi = 0.9999;
  if (rollFish(null, sp, hi).weightKg < w) return null;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (rollFish(null, sp, mid).weightKg >= w) hi = mid; else lo = mid;
  }
  return hi;
}

/** 호수의 대형(≥5kg) 시험 목록 — 잉어 · 향어 · 메기의 트로피급(≥ 90%)이면서 5kg 이상 @param {number} n */
export function bigLakeTrials(n) {
  const out = [];
  const ids = ['carp', 'israeliCarp', 'catfish'];
  for (let i = 0; i < n; i++) {
    const id = ids[i % ids.length];
    const lo = Math.max(0.9, pctForWeight(id, 5) ?? 0.9);
    const u = ((i * 0.6180339887) % 1);
    out.push([id, lo + (0.999 - lo) * u]);
  }
  return out;
}

// ── 측정 표(§7.12 · §12.5)

/** 결과 한 줄 @typedef {{id:string, goal:string, design:string, measured:string, pass:boolean|null, knob:string, note?:string, data?:any}} Row */

/** 같은 프로세스 안에서 긴 자연 실행을 나눠 쓴다(M1 · M4 · M5 · M7 · M9) */
const naturalCache = new Map();

/**
 * 호수 lakeDay 를 그 전략으로 — 중형 이상(≥1kg) 파이팅 800 · 랜딩 600 · 입질 1,000(× s)을 모두 넘을 때까지 이어서 돈다.
 * M1 · M4 · M5 · M7 · M9 가 같은 실행을 나눠 쓴다(전략 · 배율마다 한 번).
 * @param {string} strategy @param {number} [s] 표본 배율
 */
export function naturalLake(strategy, s = 1) {
  const key = `${strategy}|${s}`;
  if (naturalCache.has(key)) return naturalCache.get(key);
  const need = { medium: Math.ceil(800 * s), landed: Math.ceil(600 * s), bites: Math.ceil(1000 * s) };
  const r = runDays({
    seed: 101, plan: 'lakeDay', strategy, days: 1, maxDays: 200,
    stopWhen: (log) => log.bites >= need.bites && log.nLanded >= need.landed && log.nMediumEnded >= need.medium,
  });
  naturalCache.set(key, r);
  return r;
}

/** @param {number} s 표본 배율 */
export function measureM1(s = 1) {
  const r = naturalLake('basic', s);
  const landed = r.log.fights.filter(f => f.outcome === 'landed' && f.totalSec > 0);
  const small = landed.filter(f => f.weightKg < 1).map(f => f.totalSec);
  const mid = landed.filter(f => f.weightKg >= 1 && f.weightKg < 5).map(f => f.totalSec);
  const bigNatural = landed.filter(f => f.weightKg >= 5).map(f => f.totalSec);
  // 대형은 따로 모은다(강제 입질 — 잉어 · 향어 · 메기의 트로피급 · 기본 봇 · 1단계 바닥)
  const fb = forcedFights({ spotId: 'lake_gravel', set: 'bottom', tier: 1, strategy: 'basic', trials: bigLakeTrials(Math.ceil(200 * s)), seed: 21 });
  const bigForced = fb.log.fights.filter(f => f.outcome === 'landed' && f.weightKg >= 5 && f.totalSec > 0).map(f => f.totalSec);
  const big = [...bigNatural, ...bigForced];
  const ms = median(small); const mm = median(mid); const mb = median(big);
  const pass = ms >= 10 && ms <= 25 && mm >= 25 && mm <= 60 && mb >= 60 && mb <= 150 && big.length >= 30;
  return /** @type {Row} */ ({
    id: 'M1', goal: '한 판 길이(기본 봇 · 호수 자갈 · 1단계): 소 10–25 · 중 25–60 · 대 60–150초', design: '소 21 · 중 36 · 대 약 100초',
    measured: `소 ${f1(ms)}초(n${small.length}) · 중 ${f1(mm)}초(n${mid.length}) · 대 ${f1(mb)}초(n${big.length} — 자연 ${bigNatural.length} + 강제 ${bigForced.length}/${fb.log.fights.length}판)`,
    pass, knob: 'STYLES.*.endurance · FIGHT.baseDrain · 릴 speedMS', data: { ms, mm, mb, nBig: big.length },
  });
}

/** 첫 입질 대기 — 자갈 · 바닥 · (미끼) · (시각) · 맑음. 하네스가 챔질하지 않게 손을 막는다(대기만 잰다) */
function waitSample(baitId, hour, casts, seed) {
  const fl = createFightLog();
  const { sim } = makeSim({ seed, start: { scene: 'lake', spotId: 'lake_gravel', hour, weather: 'clear' } }, [fl.listener]);
  for (const b of Object.keys(sim.state.profile.baits)) sim.state.profile.baits[b] = 9999;
  const hand = createAngler({ strategy: 'basic', seed, set: 'bottom', baitId });
  let guard = 0;
  while (fl.log.biteWaits.length < casts) {
    const s = sim.state;
    if (s.clock.hour >= hour + 3 || s.clock.hour < hour) sim.debugSetTime(hour);
    const a = hand.decide(s, sim);
    if (a.command) sim[a.command.name](...a.command.args);
    if (sim.state.rig.phase === 'result') { sim.releaseCatch(); continue; }
    a.input.hook = false;                               // 측정: 입질을 본 뒤 챔질하지 않는다(늦음 → 1초 → 다시 던진다)
    sim.step(a.input);
    fl.onTick(sim);
    if (++guard > casts * 60 * 600) throw new Error('waitSample: 끝나지 않는다');
  }
  return mean(fl.log.biteWaits);
}

export function measureM2(s = 1) {
  const n = Math.ceil(300 * s);
  const paste = waitSample('paste', 8, n, 31);
  const krill = waitSample('krill', 8, n, 32);
  const krillDay = waitSample('krill', 13, n, 33);
  const r1 = krill / paste;
  const r2 = krillDay / paste;
  const pass = paste >= 15 && paste <= 45 && r1 >= 2 && r1 <= 4 && r2 >= 2 && r2 <= 4;
  return /** @type {Row} */ ({
    id: 'M2', goal: '첫 입질 대기(자갈 · 바닥 · 떡밥 · 아침) 15–45초 · 부적합 · 비활동 2–4배', design: '26.7초 · 크릴 2.4배 · 크릴 + 낮 2.9배',
    measured: `${f1(paste)}초 · 크릴 ${f1(r1)}배(${f1(krill)}초) · 크릴 + 낮 ${f1(r2)}배(${f1(krillDay)}초) — 캐스팅 각 ${n}`,
    pass, knob: 'BITE.t0 · BITE.baitOther', data: { paste, r1, r2 },
  });
}

export function measureM3(s = 1) {
  const seeds = Math.ceil(50 * s);
  const tries = [];
  for (let i = 0; i < seeds; i++) {
    const r = runDays({ seed: 500 + i, plan: 'lakeDay', strategy: 'basic', maxDays: 1, stopWhen: (log) => log.catches.length >= 1 });
    tries.push(r.log.catches.length ? r.log.bites : Infinity);
  }
  const within = tries.filter(t => t <= 3).length / seeds;
  return /** @type {Row} */ ({
    id: 'M3', goal: '첫 랜딩까지 도전(입질) 1–3회 — 90% 이상이 3회 안', design: '입질당 랜딩 0.77 → 3회 안에 못 할 확률 1.2%',
    measured: `${p100(within)}가 3회 안 · 중앙 ${median(tries)}회 · 최대 ${Math.max(...tries)}회(시드 ${seeds})`,
    pass: within >= 0.9, knob: 'BOT.earlyRate · HOOK.activeRate', data: { within },
  });
}

export function measureM4(s = 1) {
  const r = naturalLake('basic', s);
  const L = r.log;
  const bites = L.bites;
  const c = (o) => L.fights.filter(f => f.outcome === o).length;
  const landed = c('landed') / bites;
  const lineBreak = (c('lineBreak') + c('spoolEmpty')) / bites;
  const hookOff = c('hookOff') / bites;
  const miss = (L.hookMiss.early + L.hookMiss.late) / bites;
  const inS = L.fights.filter(f => f.inSnag && f.outcome);
  const outS = L.fights.filter(f => !f.inSnag && f.outcome);
  const brk = (xs) => pct(xs.filter(f => f.outcome === 'lineBreak' || f.outcome === 'spoolEmpty').length, xs.length);
  const pass = landed >= 0.6 && landed <= 0.8 && lineBreak <= 0.15 && hookOff <= 0.2;
  return /** @type {Row} */ ({
    id: 'M4', goal: '랜딩률 60–80% · 끊김 ≤ 15% · 빠짐 ≤ 20%(기본 봇 · 입질 대비)', design: '77% · 끊김 11% · 빠짐 2% · 헛챔질 10%',
    measured: `${p100(landed)} · 끊김 ${p100(lineBreak)} · 빠짐 ${p100(hookOff)} · 헛챔질/늦음 ${p100(miss)}(입질 ${bites}) — 장애물 띠: 완벽 캐스팅 ${p100(pct(L.perfect, L.casts))} · 띠 안 시작 ${p100(pct(inS.length, inS.length + outS.length))} · 끊김 띠 안 ${inS.length ? p100(brk(inS)) : '—(0판)'} / 밖 ${p100(brk(outS))}`,
    pass, knob: 'lake_gravel.snag(fromM · rate) · BOT.earlyRate · HOOK.activeRate',
    data: { landed, lineBreak, hookOff, miss, inSnagShare: pct(inS.length, inS.length + outS.length), brkIn: brk(inS), brkOut: brk(outS) },
  });
}

export function measureM5(s = 1) {
  const n = Math.ceil(800 * s);
  const rate = {};
  for (const st of ['controlled', 'basic', 'mindless']) {
    const r = naturalLake(st, s);
    const fs = r.log.fights.filter(f => f.weightKg >= 1 && f.outcome).slice(0, n);
    rate[st] = outcomeRates(fs);
  }
  const trials = bigLakeTrials(Math.ceil(400 * s));
  const big = {};
  for (const st of ['controlled', 'locked']) {
    const r = forcedFights({ spotId: 'lake_gravel', set: 'bottom', tier: 1, strategy: st, trials, seed: 41 });
    big[st] = outcomeRates(r.log.fights.filter(f => f.weightKg >= 5 && f.outcome));
  }
  const dCM = rate.controlled.landed - rate.mindless.landed;
  const dCB = rate.controlled.landed - rate.basic.landed;
  const dBig = big.controlled.landed - big.locked.landed;
  const pass = dCM >= 0.25 && dCB >= 0.10 && dBig >= 0.10 && big.locked.landed <= 0.6;
  return /** @type {Row} */ ({
    id: 'M5', goal: '드랙 의미(≥1kg): 조절 − 무지성 ≥ 25%p · 조절 − 기본 ≥ 10%p / 대형 조절 − 고정 ≥ 10%p · 고정 ≤ 60%',
    design: '조절 94 · 기본 73 · 무지성 65% / 대형 조절 64 vs 고정 52%',
    measured: `조절 ${p100(rate.controlled.landed)} · 기본 ${p100(rate.basic.landed)} · 무지성 ${p100(rate.mindless.landed)}(각 ${n}) → ${f1(dCM * 100)}%p · ${f1(dCB * 100)}%p / 대형 조절 ${p100(big.controlled.landed)} vs 고정 ${p100(big.locked.landed)}(${big.controlled.n} · ${big.locked.n}판) → ${f1(dBig * 100)}%p`,
    pass, knob: 'FIGHT.stick · FIGHT.stickTime · lake_gravel.snag', data: { rate, big },
  });
}

export function measureM6(s = 1) {
  const n = Math.ceil(200 * s);
  const trials = Array.from({ length: n }, () => ['whiteSturgeon', 0.5]);
  const res = {};
  for (const [key, tier, st] of [['t1basic', 1, 'basic'], ['t1controlled', 1, 'controlled'], ['t3controlled', 3, 'controlled']]) {
    const r = forcedFights({ spotId: 'river_trench', set: 'bottom', tier: /** @type {any} */ (tier), hook: 'hook_l', strategy: st, trials, seed: 61, hour: 21 });
    res[key] = outcomeRates(r.log.fights.filter(f => f.outcome));
  }
  const pass = res.t1basic.landed <= 0.1 && res.t1controlled.landed <= 0.1 && res.t3controlled.landed >= 0.5;
  return /** @type {Row} */ ({
    id: 'M6', goal: '장비 의미(흰철갑상어 중앙값 · 강 깊은 홈): 1단계 ≤ 10% · 3단계 + 조절 ≥ 50%', design: '1단계 0%(스풀 바닥 37% · 끊김 53%) · 3단계 + 조절 97%',
    measured: `1단계 기본 ${p100(res.t1basic.landed)} · 조절 ${p100(res.t1controlled.landed)}(스풀 바닥 ${p100(res.t1controlled.spoolEmpty)} · 끊김 ${p100(res.t1controlled.lineBreak)}) · 3단계 + 조절 ${p100(res.t3controlled.landed)}(각 ${n})`,
    pass, knob: 'whiteSturgeon.fight.stamina · reel_1.capacityM', data: res,
  });
}

export function measureM7(s = 1) {
  const n = Math.ceil(800 * s);
  const rb = {};
  for (const st of ['controlled', 'basic', 'mindless']) {
    const r = naturalLake(st, s);
    rb[st] = outcomeRates(r.log.fights.filter(f => f.weightKg >= 1 && f.outcome).slice(0, n)).rodBreak;
  }
  const pass = rb.controlled <= 0.02 && rb.basic <= 0.05 && rb.mindless >= 0.15;
  return /** @type {Row} */ ({
    id: 'M7', goal: '로드 파손(≥1kg 파이팅당): 조절 ≤ 2% · 기본 ≤ 5% · 무지성 ≥ 15%', design: '조절 0 · 기본 0 · 무지성 16%',
    measured: `조절 ${p100(rb.controlled)} · 기본 ${p100(rb.basic)} · 무지성 ${p100(rb.mindless)}(각 ${n})`,
    pass, knob: 'FIGHT.rodBreakHold · rod_*_1.maxLoadKg', data: rb,
  });
}

/**
 * 실패 → 다시 던지기까지(시간 · 사람의 입력 수 — 누름 · 뗌 · Space · E). stay 계획 봇.
 * force(sim) 가 있으면 대기(waiting) 때마다 하네스가 파이팅을 불러온다(예비 스풀 · 로드 파손 같은 드문 끝).
 * @param {{seed:number, strategy:string, count:number, prep?:(sim:GameSim)=>void, force?:(sim:GameSim)=>void}} o @param {any[]} rows
 */
function retryWatch(o, rows) {
  const env = makeSim({ seed: o.seed, session: { ignoreGates: true, devSession: true }, start: { scene: 'lake', spotId: 'lake_gravel', hour: 6 } });
  const sim = env.sim;
  for (const b of Object.keys(sim.state.profile.baits)) sim.state.profile.baits[b] = 9999;
  const bot = createBot({ strategy: /** @type {any} */ (o.strategy), seed: o.seed, plan: 'stay', spotId: 'lake_gravel', set: 'bottom', baitId: 'paste' });
  let failTick = -1;
  let reason = null;
  let spare = false;
  let inputs = 0;
  let got = 0;
  env.listen((name, p, s) => {
    if (name === EV.FAIL && failTick < 0) { failTick = s.state.tick; reason = p.reason; spare = !!(p.loss && p.loss.spareSpool); inputs = 0; }
    if (name === EV.CAST_RELEASE && failTick >= 0) { rows.push({ reason, spare, sec: (s.state.tick - failTick) * DT, inputs }); failTick = -1; got++; }
  });
  if (o.prep) o.prep(sim);
  let guard = 0;
  while (got < o.count) {
    if (++guard > 40 * TICKS_PER_HOUR) throw new Error(`M8 ${o.strategy}: 실패가 모이지 않는다(${got}/${o.count})`);
    if (sim.state.clock.hour >= 20) sim.debugSetTime(6);
    if (o.force && sim.state.rig.phase === 'waiting') { if (o.prep) o.prep(sim); o.force(sim); }
    const a = bot.decide(sim.state, sim);
    if (a.command) sim[a.command.name](...a.command.args);
    if (sim.state.rig.phase === 'result') continue;
    sim.step(a.input);
    if (failTick >= 0) inputs += (a.input.primaryPressed ? 1 : 0) + (a.input.primaryReleased ? 1 : 0) + (a.input.hook ? 1 : 0) + (a.input.interact ? 1 : 0);
  }
}

export function measureM8(s = 1) {
  const want = Math.ceil(50 * s);
  const rows = [];
  retryWatch({ seed: 81, strategy: 'mindless', count: Math.ceil(want * 0.5) }, rows);   // 끊김 · 파손 · 빠짐
  retryWatch({ seed: 82, strategy: 'basic', count: Math.ceil(want * 0.3) }, rows);      // 헛챔질 · 끊김
  retryWatch({                                                                           // 예비 스풀(라인 36m · 큰 잉어)
    seed: 83, strategy: 'mindless', count: Math.ceil(want * 0.1),
    prep: (sim) => { sim.state.profile.sets.bottom.lineM = 36; sim.ctx.refresh(); }, force: (sim) => sim.debugForceFight('carp', 0.97),
  }, rows);
  retryWatch({                                                                           // 로드 파손(3단계 라인 · 릴 + 2단계 로드)
    seed: 84, strategy: 'mindless', count: Math.ceil(want * 0.1),
    prep: (sim) => { sim.debugSetGear('line', 'line_3', 'bottom'); sim.debugSetGear('reel', 'reel_3', 'bottom'); sim.debugSetGear('rod', 'rod_bottom_2', 'bottom'); },
    force: (sim) => sim.debugForceFight('carp', 0.97),
  }, rows);
  const worst = Math.max(...rows.map(r => r.sec));
  const maxIn = Math.max(...rows.map(r => r.inputs));
  const reasons = {};
  for (const r of rows) { const k = r.spare ? 'spareSpool' : r.reason; reasons[k] = (reasons[k] ?? 0) + 1; }
  const pass = rows.length >= want && worst <= 2.0 + 1e-9 && maxIn <= 2;
  return /** @type {Row} */ ({
    id: 'M8', goal: '실패 → 재도전: 입력 2 · ≤ 2.0초(모든 사유 · 예비 스풀 포함)', design: '알림 1.0 + 충전 0.7 = 1.7초 · 누름/뗌',
    measured: `${rows.length}번: 중앙 ${median(rows.map(r => r.sec)).toFixed(2)}초 · 최대 ${worst.toFixed(2)}초 · 입력 최대 ${maxIn} — ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    pass, knob: 'RIG.failNotice · CAST.gaugePeriod', data: { rows: rows.length, worst, maxIn, reasons },
  });
}

/** 소형 중앙가(블루길) @returns {number} */
function bluegillMedianPrice() {
  const sp = SPECIES_BY_ID.bluegill;
  return fishPrice(sp, rollFish(null, sp, 0.5).weightKg, 'normal');
}

export function measureM9(s = 1, dayRevenue = null) {
  // 산수: 세트별 라인 끊김 손실 = 미끼 1개 + 바늘 + 찌/봉돌 + 라인 30m
  const hook = GEAR_BY_ID.hook_m.lossCost;
  const arithFloat = BAIT_UNIT.worm + hook + GEAR_BY_ID.float_1.lossCost + 30 * GEAR_BY_ID.line_1.pricePerM;
  const arithBottom = BAIT_UNIT.paste + hook + GEAR_BY_ID.sinker_1.lossCost + 30 * GEAR_BY_ID.line_1.pricePerM;
  const cap = 2 * bluegillMedianPrice();
  // 실측: 기본 봇 자연 실행의 라인 끊김 50번
  const r = naturalLake('basic', s);
  const losses = r.log.fails.filter(f => f.reason === 'lineBreak').slice(0, Math.ceil(50 * s)).map(f => {
    const L = f.loss;                                     // lakeDay 기본 봇은 언제나 1단계 라인
    return L.tackleCost + (L.lineLostM ?? 0) * GEAR_BY_ID.line_1.pricePerM + (L.baitLost ? BAIT_UNIT[L.baitId] ?? 0 : 0);
  });
  const rev = dayRevenue ?? measureM10(s).data.revMean;
  const rodF = GEAR_BY_ID.rod_float_2.price / rev;
  const rodB = GEAR_BY_ID.rod_bottom_2.price / rev;
  const pass = Math.max(arithFloat, arithBottom) <= cap && median(losses) <= cap && rodF >= 0.2 && rodF <= 0.4 && rodB >= 0.2 && rodB <= 0.4;
  return /** @type {Row} */ ({
    id: 'M9', goal: '라인 끊김 손실 ≤ 소형 2마리 중앙가 · 2단계 로드 = 호수 하루 수입 20–40%', design: '찌 700 · 바닥 520 ≤ 858 · 로드 32% · 36%',
    measured: `산수 찌 ${f0(arithFloat)} · 바닥 ${f0(arithBottom)} ≤ ${f0(cap)} · 실측 ${losses.length}번 중앙 ${f0(median(losses))} · 최대 ${f0(Math.max(...losses))} / 로드 찌 ${p100(rodF)} · 바닥 ${p100(rodB)}(하루 매출 평균 ${f0(rev)})`,
    pass, knob: 'lossCost · line_1.pricePerM · 로드 가격', data: { arithFloat, arithBottom, cap, rodF, rodB },
  });
}

const m10Cache = new Map();
/** 하루 수입(입문 · 호수 · 기본 봇 · lakeDay) — 새 프로필 · 집 06:00 → 다음 날 06:00(M9 와 나눠 쓴다) */
export function measureM10(s = 1) {
  if (!m10Cache.has(s)) m10Cache.set(s, measureM10Run(s));
  return m10Cache.get(s);
}
function measureM10Run(s) {
  const seeds = Math.max(3, Math.ceil(20 * s));
  const nets = [];
  const revs = [];
  let trophyRev = 0;
  let allRev = 0;
  let bad = null;
  for (let i = 0; i < seeds; i++) {
    const r = runDays({ seed: 1000 + i, plan: 'lakeDay', strategy: 'basic', days: 1, check: true });
    if (r.badCheck) bad = r.badCheck;
    nets.push(r.net);
    revs.push(r.log.sold);
    for (const c of r.log.catches) { allRev += c.price; if (c.tier !== 'normal') trophyRev += c.price; }
  }
  const baitAvg = (BAIT_UNIT.paste + BAIT_UNIT.worm) / 2;
  const base = 20 * baitAvg;
  const reel = GEAR_BY_ID.reel_2.price;
  const lo = base + 0.5 * reel;
  const hi = base + reel;
  const netMed = median(nets);
  const pass = netMed >= lo && netMed <= hi && !bad;
  return /** @type {Row} */ ({
    id: 'M10', goal: '하루 순수입(입문 · 호수 · 기본 봇) 중앙 = 미끼 20 + reel_2 의 50–100%', design: '매출 평균 12.4만 · 순수입 중앙 11.0만(reel_2 의 56%)',
    measured: `순수입 중앙 ${f0(netMed)}(${p100((netMed - base) / reel)}) · 매출 평균 ${f0(mean(revs))} · 중앙 ${f0(median(revs))} · p10 ${f0(quantile(revs, 0.1))} · p90 ${f0(quantile(revs, 0.9))} · 트로피/레전드 몫 ${p100(trophyRev / allRev)}(시드 ${seeds})${bad ? ' · ' + bad : ''}`,
    pass, knob: '호수 어종 pricePerKg · reel_2 가격', data: { netMed, revMean: mean(revs), lo, hi },
  });
}

/** 진행 봇 하나를 maxDays 까지 — 이정표의 날(소수) */
export function runProgress(strategy, seed, maxDays, stopAt = {}) {
  const marks = { firstUpgrade: null, level5: null, level10: null, level20: null, tier3Full: null, lastDay: 0, money: 0, level: 1 };
  let t0 = null;
  const r = runDays({
    seed, plan: 'progress', strategy, days: maxDays, maxDays,
    stopWhen: (log, sim) => {
      const s = sim.state;
      if (t0 === null) t0 = absTick(s.clock);
      const d = (absTick(s.clock) - t0) / TICKS_PER_DAY;
      const p = s.profile;
      if (marks.level5 === null && p.level >= 5) marks.level5 = d;
      if (marks.level10 === null && p.level >= 10) marks.level10 = d;
      if (marks.level20 === null && p.level >= 20) marks.level20 = d;
      if (marks.tier3Full === null && tier3Full(p)) marks.tier3Full = d;
      marks.lastDay = d;
      if (stopAt.level && p.level >= stopAt.level && (!stopAt.tier3 || marks.tier3Full !== null)) return true;
      return false;
    },
    onCommand: (c, res, sim) => {
      if (marks.firstUpgrade === null && c.name === 'buy' && res.ok && !String(c.args[0]).startsWith('bait_')) {
        marks.firstUpgrade = (absTick(sim.state.clock) - /** @type {number} */ (t0)) / TICKS_PER_DAY;
      }
    },
  });
  marks.money = r.sim.state.profile.money;
  marks.level = r.sim.state.profile.level;
  return { marks, r };
}

/** 3단계 완비 — 두 세트 모두 3단계 로드 · 릴 · 라인 + 찌 · 봉돌 @param {any} p */
export function tier3Full(p) {
  const f = p.sets.float;
  const b = p.sets.bottom;
  const t = (id) => (GEAR_BY_ID[id] ? GEAR_BY_ID[id].tier : 0);
  return t(f.rod) === 3 && t(b.rod) === 3 && t(f.reel) === 3 && t(b.reel) === 3 && t(f.lineId) === 3 && t(b.lineId) === 3 && t(f.float) === 3 && t(b.sinker) === 3;
}

export function measureM11(s = 1) {
  const seeds = Math.max(1, Math.ceil(3 * s));
  const ms = [];
  for (let i = 0; i < seeds; i++) ms.push(runProgress('basic', 2000 + i, 12, { level: 10 }).marks);
  const fu = ms.map(m => m.firstUpgrade ?? Infinity);
  const l5 = ms.map(m => m.level5 ?? Infinity);
  const l10 = ms.map(m => m.level10 ?? Infinity);
  const inR = (xs, lo, hi) => xs.every(x => x >= lo && x <= hi);
  const pass = inR(fu, 0.5, 1.5) && inR(l5, 1, 2) && inR(l10, 4, 7);
  return /** @type {Row} */ ({
    id: 'M11', goal: '첫 업그레이드 0.5–1.5일 · 레벨 5 1–2일 · 레벨 10 4–7일(기본 봇 · progress)', design: '1.2–1.4일 · 1.13–1.33일 · 5.1–5.4일',
    measured: `첫 업그레이드 ${fu.map(f1x).join(' / ')}일 · 레벨 5 ${l5.map(f1x).join(' / ')}일 · 레벨 10 ${l10.map(f1x).join(' / ')}일(시드 ${seeds})`,
    pass, knob: 'XP.base · XP.exp · 어종 xp', data: { fu, l5, l10 },
  });
}
const f1x = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');

/** M12 · M16 은 같은 실행(조절 봇 · progress)을 쓴다 */
const progressCache = new Map();
function controlledProgress(seeds) {
  const key = seeds;
  if (progressCache.has(key)) return progressCache.get(key);
  const ms = [];
  for (let i = 0; i < seeds; i++) ms.push(runProgress('controlled', 3000 + i, 40, { level: 20, tier3: true }).marks);
  progressCache.set(key, ms);
  return ms;
}

export function measureM12(s = 1) {
  const seeds = Math.max(1, Math.ceil(3 * s));
  const ms = controlledProgress(seeds);
  const l20 = ms.map(m => m.level20 ?? Infinity);
  const pass = l20.every(x => x >= 15 && x <= 30);
  return /** @type {Row} */ ({
    id: 'M12', goal: '레벨 20(조절 봇 · progress) 15–30일', design: '20.4–22.2일',
    measured: `${l20.map(f1x).join(' / ')}일(시드 ${seeds}) · 그때 돈 ${ms.map(m => f0(m.money)).join(' / ')}`,
    pass, knob: 'XP.exp', data: { l20 },
  });
}

export function measureM16(s = 1) {
  const seeds = Math.max(1, Math.ceil(3 * s));
  const ms = controlledProgress(seeds);
  const t3 = ms.map(m => m.tier3Full ?? Infinity);
  const l20 = ms.map(m => m.level20 ?? Infinity);
  const pass = t3.every((x, i) => x >= 10 && x <= 20 && x < l20[i]);
  return /** @type {Row} */ ({
    id: 'M16', goal: '3단계 완비(조절 봇 · progress) 10–20일 · 레벨 20 보다 먼저', design: '10.0–11.5일(레벨 약 14–15)',
    measured: `${t3.map(f1x).join(' / ')}일 · 레벨 20 ${l20.map(f1x).join(' / ')}일(시드 ${seeds})`,
    pass, knob: 'reel_3 가격', data: { t3, l20 },
  });
}

export function measureM1b(s = 1) {
  const n = Math.ceil(200 * s);
  const cases = [
    ['whiteSturgeon', 'river_trench', 'bottom', 3, 21], ['chinookSalmon', 'river_tailrace', 'float', 3, 6],
    ['barredKnifejaw', 'coast_cape', 'bottom', 2, 13], ['redSeabream', 'coast_channel', 'float', 2, 6],
  ];
  const parts = [];
  let pass = true;
  const data = {};
  for (const [sp, spot, set, tier, hour] of cases) {
    const med = forcedFights({ spotId: /** @type {string} */ (spot), set: /** @type {any} */ (set), tier: /** @type {any} */ (tier), hook: hookFor(/** @type {string} */ (sp)), strategy: 'controlled', trials: Array.from({ length: n }, () => [sp, 0.5]), seed: 91, hour: /** @type {number} */ (hour) });
    const tro = forcedFights({ spotId: /** @type {string} */ (spot), set: /** @type {any} */ (set), tier: /** @type {any} */ (tier), hook: hookFor(/** @type {string} */ (sp)), strategy: 'controlled', trials: Array.from({ length: Math.ceil(n / 2) }, (_, i) => [sp, 0.9 + 0.09 * ((i * 0.618) % 1)]), seed: 92, hour: /** @type {number} */ (hour) });
    const lm = median(med.log.fights.filter(f => f.outcome === 'landed').map(f => f.totalSec));
    const lt = median(tro.log.fights.filter(f => f.outcome === 'landed').map(f => f.totalSec));
    data[/** @type {string} */ (sp)] = { lm, lt };
    if (!(lm <= 150 && lt <= 240)) pass = false;
    parts.push(`${sp} ${tier}단계 ${f1(lm)} / 트로피급 ${f1(lt)}초`);
  }
  return /** @type {Row} */ ({
    id: 'M1b', goal: '후반 한 판 길이(조절 봇): 중앙값 크기 ≤ 150초 · 트로피급 ≤ 240초', design: '철갑상어 71/153 · 치누크 27/57 · 돌돔 20 · 참돔 16초',
    measured: parts.join(' · '), pass, knob: 'whiteSturgeon.fight.stamina · STYLES.heavy.endurance', data,
  });
}

/** 그 스테이지 · 장비 단계 · 조절 봇의 하루(레벨 · 단계 프로필로) */
function stageDays(plan, level, tier, seeds, seed0, hook) {
  const out = [];
  for (let i = 0; i < seeds; i++) {
    const profile = makeGearedProfile({ level, tier, money: 50000, hook, baits: 30 });
    const r = runDays({ seed: seed0 + i, plan, strategy: 'controlled', days: 1, profile, check: true });
    const landed = r.log.fights.filter(f => f.outcome === 'landed').length;
    out.push({ net: r.net, rev: r.log.sold, bites: r.log.bites, landed, bad: r.badCheck });
  }
  return out;
}

export function measureM9b(s = 1) {
  const seeds = Math.max(2, Math.ceil(5 * s));
  const days = stageDays('riverDay', 15, 3, seeds, 4000, 'hook_l');
  const rev = median(days.map(d => d.rev));
  const rf = GEAR_BY_ID.rod_float_3.price / rev;
  const rbt = GEAR_BY_ID.rod_bottom_3.price / rev;
  const pass = rf >= 0.2 && rf <= 0.4 && rbt >= 0.2 && rbt <= 0.4;
  return /** @type {Row} */ ({
    id: 'M9b', goal: '3단계 로드 파손 = 강 하루 수입(3단계 · 조절 · riverDay) 20–40%', design: '매출 중앙 약 86만 → 찌 30% · 바닥 35%',
    measured: `매출 중앙 ${f0(rev)} → 찌 ${p100(rf)} · 바닥 ${p100(rbt)}(시드 ${seeds} · 레벨 15)`,
    pass, knob: '3단계 로드 가격', data: { rev, rf, rbt },
  });
}

export function measureM14(s = 1) {
  const n = Math.ceil(300 * s);
  const cases = [
    ['crucian', 'heavy', 'lake_gravel', 'bottom', 1], ['redSeabream', 'runner', 'coast_channel', 'float', 2],
    ['mandarinFish', 'thrasher', 'lake_cape', 'bottom', 1], ['largemouthBass', 'jumper', 'lake_shallows', 'float', 1],
    ['barredKnifejaw', 'diver', 'coast_cape', 'bottom', 2], ['bluegill', 'small', 'lake_shallows', 'float', 1],
  ];
  const parts = [];
  let pass = true;
  const data = {};
  for (const [sp, style, spot, set, tier] of cases) {
    const res = {};
    for (const st of ['controlled', 'basic']) {
      const r = forcedFights({ spotId: /** @type {string} */ (spot), set: /** @type {any} */ (set), tier: /** @type {any} */ (tier), hook: hookFor(/** @type {string} */ (sp)), strategy: st, trials: Array.from({ length: n }, () => [sp, 0.5]), seed: 141 });
      res[st] = outcomeRates(r.log.fights.filter(f => f.outcome));
    }
    data[/** @type {string} */ (sp)] = res;
    const ok = res.controlled.landed >= 0.65 && res.basic.landed >= 0.45 && res.controlled.hookOff <= 0.25 && res.basic.hookOff <= 0.25;
    if (!ok) pass = false;
    parts.push(`${style}(${sp}) 조절 ${p100(res.controlled.landed)} · 기본 ${p100(res.basic.landed)} · 빠짐 ${p100(Math.max(res.controlled.hookOff, res.basic.hookOff))}`);
  }
  return /** @type {Row} */ ({
    id: 'M14', goal: '성격별 공정성: 조절 ≥ 65% · 기본 ≥ 45% · 바늘 빠짐 ≤ 25%', design: '조절 89–100 · 기본 88–100% · 빠짐 최대 12%(큰입배스)',
    measured: parts.join(' / ') + ` (각 ${n})`, pass, knob: 'HOOK.* · STYLES.*.states', data,
  });
}

export function measureM15(s = 1) {
  const seeds = Math.max(2, Math.ceil(5 * s));
  const river = stageDays('riverDay', 10, 2, seeds, 5000, 'hook_l');
  const coast = stageDays('coastDay', 10, 2, seeds, 5000, null);
  const rn = median(river.map(d => d.net));
  const cn = median(coast.map(d => d.net));
  const land = river.reduce((a, d) => a + d.landed, 0) / Math.max(1, river.reduce((a, d) => a + d.bites, 0));
  const pass = rn >= cn && land >= 0.55;
  return /** @type {Row} */ ({
    id: 'M15', goal: '강 진입(레벨 10 · 2단계 · 조절 봇): 강 순수입 중앙 ≥ 갯바위 · 입질 대비 랜딩 ≥ 55%', design: '강 약 43만 vs 갯바위 39만(1.1배) · 랜딩 81%',
    measured: `강 ${f0(rn)} vs 갯바위 ${f0(cn)}(${f1(rn / cn)}배) · 강 랜딩 ${p100(land)}(시드 ${seeds})`,
    pass, knob: 'chinookSalmon.fight.force · GEAR_GATES.tier3Level(Jay)', data: { rn, cn, land },
  });
}

/** M13 — 1 게임 일(H1 과 같은 실행): 예외 · NaN · 돈 음수 */
export function measureM13() {
  let err = null;
  let r = null;
  try { r = runDays({ seed: 1300, plan: 'lakeDay', strategy: 'basic', days: 1, check: true }); } catch (e) { err = e; }
  const hash1 = r ? r.sim.hash() : null;
  let hash2 = null;
  try { hash2 = runDays({ seed: 1300, plan: 'lakeDay', strategy: 'basic', days: 1 }).sim.hash(); } catch (e) { err = err ?? e; }
  const pass = !err && r && !r.badCheck && hash1 === hash2;
  return /** @type {Row} */ ({
    id: 'M13', goal: '결정성 · 예외 · NaN · 돈 음수 0(1 게임 일)', design: '순수 sim · 시드 난수 · 상태 해시',
    measured: err ? `예외: ${err.message}` : `예외 0 · ${r.badCheck ?? 'NaN 0 · 돈 ≥ 0'} · 해시 ${hash1 === hash2 ? '같음' : '다름'}`,
    pass: !!pass, knob: '—',
  });
}

/** id → 측정 함수(표의 순서) */
export const MEASURES = {
  M1: measureM1, M1b: measureM1b, M2: measureM2, M3: measureM3, M4: measureM4, M5: measureM5, M6: measureM6, M7: measureM7,
  M8: measureM8, M9: measureM9, M9b: measureM9b, M10: measureM10, M11: measureM11, M12: measureM12, M13: measureM13, M14: measureM14,
  M15: measureM15, M16: measureM16,
};

/** 표(마크다운) @param {Row[]} rows */
export function formatTable(rows) {
  const lines = ['| ID | 목표 | 설계 값(§7.12) | 측정 값 | 판정 | 조정 손잡이 |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.id} | ${r.goal} | ${r.design} | ${r.measured} | ${r.pass === null ? '보고' : r.pass ? '○' : '✕'} | ${r.knob} |`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find(a => a.startsWith('--only'));
  const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',') : null;
  const scale = args.includes('--quick') ? 0.5 : 1;
  const ids = Object.keys(MEASURES).filter(id => !only || only.includes(id));
  const rows = [];
  let m10 = null;
  for (const id of ids) {
    const t0 = performance.now();
    let row;
    try {
      row = id === 'M9' ? measureM9(scale, m10 ? m10.data.revMean : null) : MEASURES[id](scale);
    } catch (e) {
      row = { id, goal: '', design: '', measured: `예외: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e}`, pass: false, knob: '' };
    }
    if (id === 'M10') m10 = row;
    row.note = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
    rows.push(row);
    if (!args.includes('--json')) console.error(`${id} ${row.pass ? 'ok' : 'FAIL'} (${row.note}) ${row.measured}`);
  }
  if (args.includes('--json')) console.log(JSON.stringify(rows.map(({ data, ...r }) => r), null, 1));
  else {
    console.log(`\n# 측정 결과 — jay-fishing (표본 배율 ${scale})\n`);
    console.log(formatTable(rows));
    const bad = rows.filter(r => r.pass === false).map(r => r.id);
    console.log(`\n목표 밖: ${bad.length ? bad.join(' · ') : '없음'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
