// OWNER: P15 — 계약 §6.16 · §12.5 · §12.6 · §7.14
// 측정(순수 — 테스트 · scripts/measure.mjs 공용). 판을 새로 만드는 함수는 makeSim(seed, account) → GameSim 을 인자로 받는다(GameSim 을 import 하지 않는다 · §2.2).
// 봇이 사람처럼 판을 돌고, 측정 하네스(이 파일)는 sim 의 이벤트 버스를 엿들어 처치 시간 · 기본 공격 타수 · 업그레이드 · 거래를 센다
// (하네스는 상태를 읽어도 된다 — 봇의 결정에는 쓰지 않는다). 시간은 틱으로 민다. 리포트 문면(한국어)은 이 파일에 둔다(§12.3-8 예외).

import { EQUIP_SLOTS, ITEM_SLOTS, LEVEL_CAP, RARITIES, TICK_HZ } from '../core/constants.js';
import { EV } from '../core/events.js';
import { hash32 } from '../core/hash.js';
import { NEUTRAL_INPUT } from '../core/inputFrame.js';
import { makeRng, seedRng } from '../core/rng.js';
import { BOT, BOT_MEASURE as M } from '../data/bot.js';
import { CLASSES } from '../data/classes.js';
import { getClass } from '../data/index.js';
import { ITEM } from '../data/items.js';
import { MON_AFFIXES } from '../data/monsterAffixes.js';
import { MONSTERS } from '../data/monsters.js';
import { earlyDmgMul, earlyHpMul, riftRow } from '../data/rift.js';
import { compareEquip } from '../sim/loot/compare.js';
import { rollGear, rollRarity } from '../sim/loot/rollDrops.js';
import { makeItem } from '../sim/loot/rollItem.js';
import { createDropSim } from '../sim/loot/simulate.js';
import { powerScore } from '../sim/loot/stats.js';
import { rarityDist } from '../sim/loot/theory.js';
import { makeDevCharacter } from '../sim/progression/dev.js';
import { repairCost } from '../sim/progression/inventory.js';
import { gambleOdds, priceGamble, priceReroll } from '../sim/progression/shops.js';
import { makeSummary } from '../sim/rift.js';
import { isWalkableR, losClear } from '../sim/world/nav.js';
import { createAccount, emptyArray } from '../sim/state.js';
import { Bot, RANDOM_BUILD } from './bot.js';

/** @typedef {import('../types.js').RunSummary} RunSummary */
/** @typedef {import('../types.js').CharacterState} CharacterState */
/** @typedef {(seed:number, account:any) => any} MakeSim */

const TICK = TICK_HZ;
const HOUR = 3600;

// ───────────────────────── 하네스 도우미 ─────────────────────────

/** 캐릭터 깊은 사본(순수 값) @param {CharacterState} char @returns {CharacterState} */
export function cloneChar(char) {
  return JSON.parse(JSON.stringify(char));
}

/** 캐릭터의 가장 큰 아이템 번호(새 세션의 nextItemId) @param {CharacterState} char */
function maxItemNum(char) {
  let n = 0;
  const see = (it) => {
    if (!it || typeof it.id !== 'string') return;
    const k = parseInt(it.id.replace(/^\D+/, ''), 10);
    if (Number.isFinite(k) && k > n) n = k;
  };
  for (const s of EQUIP_SLOTS) see(char.equip?.[s]);
  for (const it of char.bag ?? []) see(it);
  for (const it of char.shop?.blacksmith ?? []) see(it);
  for (const it of char.shop?.general ?? []) see(it);
  for (const b of char.buyback ?? []) see(b?.item);
  return n;
}

/**
 * 새 세션 — 계정(아이템 번호가 캐릭터와 겹치지 않게) · makeSim · start · 캐릭터(사본을 붙이거나 새로)
 * @param {MakeSim} makeSim @param {number} seed @param {{cls:string, char?:CharacterState|null}} o
 */
export function newSession(makeSim, seed, { cls, char = null }) {
  const account = createAccount();
  if (char) account.nextItemId = maxItemNum(char) + 1;
  const sim = makeSim(seed >>> 0, account);
  if (typeof sim.start === 'function') sim.start();
  const r = char ? sim.loadCharacter(0, cloneChar(char)) : sim.newCharacter({ slot: 0, cls, name: cls });
  if (!r || !r.ok) throw new Error('measure: character attach failed — ' + (r && r.reason));
  return sim;
}

// ───────────────────────── 기록기(버스) ─────────────────────────

/** 판 하나의 측정 누적 */
function newAcc(level) {
  return {
    level, sales: 0, repair: 0, consumables: 0, upGain: 0, upDrops: 0,
    basicHits: /** @type {Record<string, number>} */ ({}),
    packs: { champion: /** @type {number[]} */ ([]), elite: /** @type {number[]} */ ([]) },
    guardianSec: -1, guardianAt: -1,
  };
}

const RECORDERS = new WeakMap();

/**
 * sim 하나에 붙는 측정 기록기 — RIFT_OPENED 로 판 누적을 바꾸고 HIT · MON_DIED · DROP_SPAWN · TRADE · LEVEL_UP · UNLOCK · GUARDIAN_APPEAR 를 센다
 * @param {any} sim
 */
export function attachRecorder(sim) {
  const old = RECORDERS.get(sim);
  if (old) return old;
  const bus = sim.bus;
  const rec = {
    cur: /** @type {any} */ (null),
    byRift: new Map(),
    levelAt: /** @type {Record<number, number>} */ ({}),
    unlockAt: /** @type {Record<number, number>} */ ({}),
    monIdx: new Map(),
    monVer: -1,
    normalHits: new Map(),
    packTrack: new Map(),
    offs: /** @type {Array<() => void>} */ ([]),
  };
  const st = () => sim.state;
  const monOf = (id) => {
    const rift = st().rift;
    if (!rift) return null;
    let m = rec.monIdx.get(id);
    if (m && m === rift.mons.find((x) => x === m)) return m;
    m = null;
    for (let i = rift.mons.length - 1; i >= 0; i--) if (rift.mons[i].id === id) { m = rift.mons[i]; break; }
    if (m) rec.monIdx.set(id, m);
    return m;
  };
  const on = (name, fn) => { if (bus && typeof bus.on === 'function') rec.offs.push(bus.on(name, fn)); };
  on(EV.RIFT_OPENED, (p) => {
    rec.cur = newAcc(p.level);
    rec.byRift.set(st().rift, rec.cur);
    rec.monIdx.clear();
    rec.normalHits.clear();
    rec.packTrack.clear();
  });
  const basicId = () => (st().char ? getClass(st().char.cls).basic : null);
  on(EV.HIT, (p) => {
    const a = rec.cur;
    if (!a || !(p.amount > 0)) return;
    const m = monOf(p.targetId);
    if (!m) return;
    if (m.rank === 'normal') {
      let h = rec.normalHits.get(m.id);
      if (!h) { h = { basic: 0, other: false }; rec.normalHits.set(m.id, h); }
      if (p.skillId === basicId() && !p.dot) h.basic++;
      else h.other = true;
    }
    if (m.packId >= 0 && (m.rank === 'champion' || m.rank === 'elite' || m.rank === 'minion') && !rec.packTrack.has(m.packId)) {
      const pk = st().rift.packs.find((x) => x.id === m.packId);
      if (pk && (pk.kind === 'champion' || pk.kind === 'elite')) rec.packTrack.set(m.packId, { kind: pk.kind, start: st().tick, left: new Set(pk.memberIds) });
    }
    if (m.rank === 'guardian' && a.guardianAt < 0) a.guardianAt = st().tick;
  });
  on(EV.MON_DIED, (p) => {
    const a = rec.cur;
    if (!a) return;
    if (p.rank === 'normal') {
      const h = rec.normalHits.get(p.id);
      if (h && !h.other && h.basic > 0) a.basicHits[h.basic] = (a.basicHits[h.basic] ?? 0) + 1;
      rec.normalHits.delete(p.id);
    }
    const m = monOf(p.id);
    if (m && rec.packTrack.has(m.packId)) {
      const t = rec.packTrack.get(m.packId);
      t.left.delete(p.id);
      if (!t.left.size) {
        a.packs[t.kind].push((st().tick - t.start) / TICK);
        rec.packTrack.delete(m.packId);
      }
    }
    if (p.rank === 'guardian' && a.guardianAt >= 0) a.guardianSec = (st().tick - a.guardianAt) / TICK;
  });
  on(EV.GUARDIAN_APPEAR, () => { if (rec.cur && rec.cur.guardianAt < 0 && st().scene === 'rift') rec.cur.guardianAt = st().tick; });
  on(EV.DROP_SPAWN, (p) => {
    const a = rec.cur;
    const ch = st().char;
    if (!a || !ch || p.kind !== 'item') return;
    const drops = st().rift?.drops ?? [];
    let d = null;
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].id === p.id) { d = drops[i]; break; }
    if (!d || !d.item) return;
    const r = compareEquip(ch, d.item);
    if (r.upgrade) {
      const before = powerScore(r.before);
      a.upGain += before > 0 ? r.delta.power / before : 0;
      a.upDrops += 1;
    }
  });
  on(EV.TRADE, (p) => {
    const a = rec.cur;
    if (!a) return;
    if (p.kind === 'sell' || p.kind === 'sellMany') a.sales += p.cost ?? 0;
    else if (p.kind === 'repair') a.repair += p.cost ?? 0;
    else if (p.kind === 'potion' || p.kind === 'scroll') a.consumables += p.cost ?? 0;
  });
  on(EV.LEVEL_UP, (p) => { const ch = st().char; if (ch && rec.levelAt[p.level] === undefined) rec.levelAt[p.level] = ch.playSec; });
  on(EV.UNLOCK, (p) => {
    const ch = st().char;
    if (!ch) return;
    for (let L = 1; L <= p.riftUnlocked; L++) if (rec.unlockAt[L] === undefined) rec.unlockAt[L] = ch.playSec;
  });
  RECORDERS.set(sim, rec);
  return rec;
}

/** 기록기 떼기 @param {any} sim */
export function detachRecorder(sim) {
  const rec = RECORDERS.get(sim);
  if (!rec) return;
  for (const off of rec.offs) if (typeof off === 'function') off();
  RECORDERS.delete(sim);
}

/** 그 캐릭터가 한 번 쓰러지면 드는 수리비(장착 전부 내구도 − deathDurLoss) @param {CharacterState} ch */
function deathRepairCost(ch) {
  const c = cloneChar(ch);
  for (const s of EQUIP_SLOTS) {
    const it = c.equip[s];
    if (it) it.dur = Math.max(0, (it.durMax || ITEM.durMax) - ITEM.deathDurLoss);
  }
  return repairCost(c);
}

// ───────────────────────── 판 · 세션 ─────────────────────────

/**
 * 균열 한 판 → RunSummary(+ 측정 m). 봇이 마을에서 균열을 열고(또는 이미 균열 안이면 그 판) 완료 · 붕괴로 끝나 마을에 돌아올 때까지 민다.
 * 균열 시간이 maxSec 를 넘으면 그 판을 버리고(result 'abandon' · 측정 하네스가 마을로 보낸다 · 봇은 다음에 새 균열) 돌려준다. 판이 시작되지 않으면 null.
 * @param {{sim:any, bot:any, maxSec:number}} o @returns {(RunSummary & {m:any})|null}
 */
export function runRift({ sim, bot, maxSec }) {
  const rec = attachRecorder(sim);
  const st = sim.state;
  const live = (r) => !!r && (r.phase === 'active' || r.phase === 'guardian');
  let R = st.scene === 'rift' && live(st.rift) ? st.rift : null;
  const maxTicks = Math.round((maxSec + M.townAllowSec) * TICK);
  for (let n = 0; n < maxTicks; n++) {
    sim.step(bot.frame());
    bot.afterStep();
    if (!st.char) return null;
    if (!R && st.scene === 'rift' && live(st.rift)) R = st.rift;
    if (!R) continue;
    if (st.pendingTravel) continue;
    if (R.summary && st.scene === 'town') return finish(sim, rec, R, R.summary);
    if (st.rift !== R) return finish(sim, rec, R, R.summary ?? { ...makeSummaryOf(sim, R), result: 'abandon' });
    if (R.ticksIn > maxSec * TICK && live(R)) {
      const s = makeSummaryOf(sim, R);
      bot.abandonRift = true;
      sim.debugGotoTown();
      bot.afterStep();
      return finish(sim, rec, R, { ...s, result: 'abandon' });
    }
  }
  return R ? finish(sim, rec, R, R.summary ?? { ...makeSummaryOf(sim, R), result: 'abandon' }) : null;
}

/** 그 균열의 요약(rift.js makeSummary — 순수 조회 · 지금 균열이 아니면 통계에서 직접) */
function makeSummaryOf(sim, R) {
  if (sim.state.rift === R) return makeSummary(sim.ctx, 'abandon');
  const s = R.stats;
  return {
    level: R.level, seed: R.seed, tileset: R.tileset, cls: sim.state.char?.cls ?? 'warrior', result: 'abandon', timeSec: R.ticksIn / TICK,
    kills: { ...s.kills }, deaths: R.deaths, drops: { ...s.drops }, gold: s.gold, xp: s.xp, upgrades: s.upgrades, recalls: s.recalls,
    maxTargeting: s.maxTargeting, swarmMoments: s.swarmMoments, unlockedTo: sim.state.char?.riftUnlocked ?? 1, noDeath: R.deaths === 0, record: false,
  };
}

/** 요약 + 측정(판 누적 · 가방 귀환 · 받은 피해 · 사망 수리비 · 그때의 캐릭터) */
function finish(sim, rec, R, summary) {
  const ch = sim.state.char;
  const acc = rec.byRift.get(R) ?? newAcc(R.level);
  acc.bagFull = !!R.stats.bagFullRecall;
  acc.gauge = R.gauge;
  acc.dmgTaken = R.stats.dmgTaken;
  acc.playSec = ch ? ch.playSec : 0;
  acc.charLevel = ch ? ch.level : 0;
  acc.riftUnlocked = ch ? ch.riftUnlocked : 0;
  acc.deathRepair = ch ? deathRepairCost(ch) : 0;
  return { ...summary, m: acc };
}

/**
 * 세션 — 새 캐릭터(또는 char 사본)로 봇이 hours 시간(플레이 시간 playSec) 또는 maxRuns 판을 돈다.
 * riftLevel 이 있으면 그 레벨만(측정). onRun(summary, {sim, bot, index}) · snapshots 면 판마다 시작 때의 캐릭터 사본을 모은다.
 * @param {{cls:string, strategy?:string, preset?:number, seed:number, hours:number, makeSim:MakeSim, riftLevel?:number|null, char?:CharacterState|null,
 *   onRun?:Function|null, maxRuns?:number, maxRiftSec?:number, snapshots?:boolean}} o
 * @returns {{runs:Array<RunSummary & {m:any}>, timeline:Array<{playSec:number, level:number, riftUnlocked:number}>, char:CharacterState, levelAt:Object, unlockAt:Object, snaps:string[], bot:any}}
 */
export function runSession({ cls, strategy = 'basic', preset = 0, seed, hours, makeSim, riftLevel = null, char = null, onRun = null,
  maxRuns = Infinity, maxRiftSec = M.maxRiftSec, snapshots = false }) {
  const sim = newSession(makeSim, seed, { cls, char });
  const rec = attachRecorder(sim);
  const ch0 = sim.state.char;
  const bot = new Bot({ sim, strategy: /** @type {any} */ (strategy), cls: /** @type {any} */ (ch0.cls), preset, seed: hash32(seed, 0xb07), autoCommit: true });
  if (riftLevel !== null && riftLevel !== undefined) bot.levelOverride = riftLevel;
  const runs = [];
  const timeline = [{ playSec: ch0.playSec, level: ch0.level, riftUnlocked: ch0.riftUnlocked }];
  /** @type {string[]} */
  const snaps = [];
  const endSec = ch0.playSec + hours * HOUR;
  while (sim.state.char && sim.state.char.playSec < endSec && runs.length < maxRuns) {
    if (snapshots) snaps.push(JSON.stringify(sim.state.char));
    const s = runRift({ sim, bot, maxSec: maxRiftSec });
    if (!s) break;
    runs.push(s);
    const ch = sim.state.char;
    timeline.push({ playSec: ch.playSec, level: ch.level, riftUnlocked: ch.riftUnlocked });
    if (onRun) onRun(s, { sim, bot, index: runs.length - 1 });
  }
  // 마지막 판의 마을 정비(팔기 · 수리)까지 — 다음 균열을 열기 전에 멈춘다
  for (let n = 0; n < M.tailTownSec * TICK && sim.state.char && sim.state.scene === 'town' && !sim.state.pendingTravel && bot.townPlan && !bot.townPlan.done && bot.townPlan.cur !== 'riftStone'; n++) {
    sim.step(bot.frame());
    bot.afterStep();
  }
  return { runs, timeline, char: sim.state.char, levelAt: { ...rec.levelAt }, unlockAt: { ...rec.unlockAt }, snaps, bot };
}

// ───────────────────────── 정예 속성 탐침 ─────────────────────────

/** 그 속성을 달 수 있는 종류(구울 먼저 · 배제 태그를 피한다) @param {string|null} affixId */
export function probeType(affixId) {
  const row = affixId ? MON_AFFIXES.find((a) => a.id === affixId) : null;
  const ok = (def) => def.eliteOk && (!row || !row.excludeTags.some((t) => def.tags.includes(t)));
  const ghoul = MONSTERS.find((d) => d.id === 'ghoul');
  if (ghoul && ok(ghoul)) return ghoul.id;
  const d = MONSTERS.find(ok);
  return d ? d.id : 'ghoul';
}

/** 탐침 캐릭터 레벨(균열 레벨 → 그 무렵의 캐릭터 레벨 · NOTES-W1FIX 의 (5, 10) · (10, 18) · (15, 24)) @param {number} level */
export function probeCharLevel(level) {
  return Math.max(1, Math.min(LEVEL_CAP, Math.round(level * M.probeCharA + M.probeCharB)));
}

/**
 * 그 속성 하나만 단 정예 팩(정예 + 하수인 — 하수인은 minionShare 면 같은 속성) 하나를 상대한 봇의 받은 피해 · 처치 시간(균열 시간) · 사망.
 * affixId null 이면 속성 없는 정예(기준). 개발 캐릭터(probeCharLevel · 프리셋 0) · 균열 level · 맵의 다른 몬스터는 치운다.
 * @param {{cls:string, affixId:string|null, level:number, seed:number, makeSim:MakeSim, typeId?:string|null, maxSec?:number}} o
 * @returns {{dmgTaken:number, ttkSec:number, deaths:number, done:boolean, typeId:string}}
 */
export function affixProbe({ cls, affixId, level, seed, makeSim, typeId = null, maxSec = M.probeMaxSec }) {
  const account = createAccount();
  const sim = makeSim(seed >>> 0, account);
  if (typeof sim.start === 'function') sim.start();
  const char = makeDevCharacter({ slot: 0, cls: /** @type {any} */ (cls), name: cls, level: probeCharLevel(level), rift: level, preset: 0, seed, newId: sim.ctx.newItemId });
  char.potions = BOT.potionsTo;
  sim.loadCharacter(0, char);
  sim.debugOpenRift(level, hash32(seed, 0xa1f));
  const st = sim.state;
  // 맵의 몬스터를 치운다(측정 하네스 — 탐침 팩 하나만 남긴다)
  for (const m of st.rift.mons) m.gone = true;
  sim.step(NEUTRAL_INPUT);
  const tId = typeId ?? probeType(affixId);
  const at = probeSpot(sim);
  const r = sim.debugSpawnPack(tId, 'elite', affixId ? [affixId] : [], at);
  const packId = r && r.packId;
  const pack = st.rift.packs.find((pk) => pk.id === packId);
  const members = new Set(pack ? pack.memberIds : []);
  const bot = new Bot({ sim, strategy: 'basic', cls: /** @type {any} */ (cls), preset: 0, seed: hash32(seed, 0x9b), autoCommit: true });
  const startTaken = st.rift.stats.dmgTaken;
  const startIn = st.rift.ticksIn;
  const rift = st.rift;
  const alive = () => {
    for (const m of rift.mons) if (members.has(m.id) && !m.dead && !m.gone && m.hp > 0) return true;
    // 분열 사본 · 소환체(같은 팩) 도 남아 있으면 싸움 중
    for (const m of rift.mons) if (m.packId === packId && !m.dead && !m.gone && m.hp > 0) return true;
    return false;
  };
  let done = false;
  for (let n = 0; n < (maxSec + M.townAllowSec) * TICK; n++) {
    sim.step(bot.frame());
    bot.afterStep();
    if (st.rift !== rift || rift.phase === 'collapsed') break;
    if (!alive()) { done = true; break; }
    if (rift.ticksIn - startIn > maxSec * TICK) break;
  }
  return { dmgTaken: rift.stats.dmgTaken - startTaken, ttkSec: (rift.ticksIn - startIn) / TICK, deaths: rift.deaths, done, typeId: tId };
}

/** 탐침 팩 자리 — 플레이어에서 9m · 걷기 가능 · 벽 시야가 트인 첫 방향(facing 부터 30° 씩) */
function probeSpot(sim) {
  const st = sim.state;
  const map = sim.getMap();
  const p = st.player.pos;
  const f = st.player.facing;
  for (let k = 0; k < M.probeDirs; k++) {
    const a = f + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((Math.PI * 2) / M.probeDirs);
    const x = p.x + Math.sin(a) * M.probeDist, z = p.z + Math.cos(a) * M.probeDist;
    if (map && isWalkableR(map, x, z, M.probeR) && losClear(map, p.x, p.z, x, z)) return { x, z };
  }
  return { x: p.x + Math.sin(f) * M.probeDist, z: p.z + Math.cos(f) * M.probeDist };
}

// ───────────────────────── 작업(병렬 측정의 단위) ─────────────────────────

/** 판 하나를 리포트용 작은 값으로(runRift 결과 → 순수 값) @param {RunSummary & {m:any}} s */
export function compactRun(s) {
  return {
    level: s.level, result: s.result, timeSec: s.timeSec, deaths: s.deaths, kills: s.kills, drops: s.drops, gold: s.gold, xp: s.xp,
    upgrades: s.upgrades, swarm: s.swarmMoments, maxTargeting: s.maxTargeting, recalls: s.recalls,
    bagFull: s.m.bagFull, sales: s.m.sales, repair: s.m.repair, consumables: s.m.consumables, upGain: s.m.upGain, upDrops: s.m.upDrops,
    basicHits: s.m.basicHits, packs: s.m.packs, guardianSec: s.m.guardianSec, dmgTaken: s.m.dmgTaken, playSec: s.m.playSec,
    charLevel: s.m.charLevel, riftUnlocked: s.m.riftUnlocked, deathRepair: s.m.deathRepair, gauge: s.m.gauge,
  };
}

/** 도박 기대값 — 그 캐릭터로 부위마다 n 번(gambleOdds · rollGear · 가격 priceGamble) → 골드당 업그레이드 power 상승 비율 */
function gambleProbe(char, n, seed) {
  const rng = makeRng(seedRng(hash32(seed, 0x6a3b)));
  let gain = 0, gold = 0, seq = 0;
  const newId = () => 'g' + ++seq;
  const base = powerScore(compareEquip(char, makeItem({ baseId: getClass(char.cls).startGear[0].baseId, id: 'x0' })).before);
  for (const slot of ITEM_SLOTS) {
    const odds = gambleOdds(char, slot);
    const price = priceGamble(char, slot);
    for (let i = 0; i < n; i++) {
      const rarity = /** @type {any} */ (rng.pick(odds));
      const item = rollGear(rng, { rarity, level: Math.max(1, char.riftUnlocked), cls: char.cls, newId, slot });
      const r = compareEquip(char, item);
      if (r.upgrade && base > 0) gain += r.delta.power / base;
      gold += price;
    }
  }
  return { gainPerGold: gold > 0 ? gain / gold : 0, avgPrice: gold / (ITEM_SLOTS.length * n), rerollPrice: avgReroll(char) };
}

/**
 * 경제 탐침 — 해금이 처음 ECON_LEVEL(10) 이상이 된 다음 판의 시작 캐릭터(그 무렵 · 캐릭터 레벨 캡 전)로 도박 기대값 · 재굴림 가격.
 * 리포트는 그 판 레벨 ± 2 의 판으로 사냥 쪽(골드 · 업그레이드 상승)을 잰다. 세션이 거기까지 못 가면 마지막 캐릭터.
 */
function econProbe(r, seed) {
  const i = r.runs.findIndex((x) => x.m.riftUnlocked >= M.econLevel);
  const snap = i >= 0 && i + 1 < r.snaps.length ? r.snaps[i + 1] : null;
  const char = snap ? JSON.parse(snap) : r.char;
  const level = i >= 0 && i + 1 < r.runs.length ? r.runs[i + 1].level : r.runs.at(-1)?.level ?? 1;
  return { level, charLevel: char.level, ...gambleProbe(char, M.gambleSamples, seed) };
}

/** 낀 아이템 재굴림 2번(1 · 2회째) 평균 골드 */
function avgReroll(char) {
  let s = 0, k = 0;
  for (const sl of EQUIP_SLOTS) {
    const it = char.equip[sl];
    if (!it) continue;
    s += priceReroll({ ...it, rerolls: 0 }).gold + priceReroll({ ...it, rerolls: 1 }).gold;
    k++;
  }
  return k ? s / k : 0;
}

/** 시작 장비로 바꾼 캐릭터(같은 레벨 · 스킬 — 장비만 시작 장비 · 새 ID) @param {CharacterState} char */
function withStartGear(char) {
  const c = cloneChar(char);
  let n = maxItemNum(c) + 1;
  for (const s of EQUIP_SLOTS) c.equip[s] = null;
  for (const g of getClass(c.cls).startGear) {
    const it = makeItem({ baseId: g.baseId, tier: /** @type {any} */ (g.tier), ilvl: 1, rarity: 'normal', id: 'i' + n++ });
    it.flags.start = true;
    c.equip[/** @type {any} */ (it.slot)] = it;
  }
  return c;
}

/**
 * 측정 작업 목록(§12.5) — 1단계: 두 클래스 × (basic 세션 · challenge 20판 · 빌드 비교 · 속성 탐침) + 드랍 표 / 2단계(basic 세션의 사본이 있어야): noDodge · 해금 + 3 · 장비 비교
 * @param {{hours?:number, seed?:number, classes?:string[], challengeRuns?:number, replayRuns?:number, buildRuns?:number, gearRuns?:number, probeSeeds?:number, probeLevel?:number, buildChar?:{level:number, rift:number}}} [o]
 */
export function measureJobs(o = {}) {
  const P = jobParams(o);
  const jobs = [];
  for (const cls of P.classes) {
    jobs.push({ kind: 'session', cls, seed: hash32(P.seed, 1), hours: P.hours });
    jobs.push({ kind: 'challenge', cls, seed: hash32(P.seed, 2), runs: P.challengeRuns });
    for (const build of ['A', 'B', 'R1', 'R2', 'R3']) jobs.push({ kind: 'build', cls, build, seed: hash32(P.seed, 3), runs: P.buildRuns, char: P.buildChar });
    for (const affixId of [null, ...MON_AFFIXES.map((a) => a.id)]) jobs.push({ kind: 'affix', cls, affixId, level: P.probeLevel, seeds: P.probeSeeds, seed: hash32(P.seed, 4) });
  }
  jobs.push({ kind: 'drops', seed: hash32(P.seed, 5), n: M.dropRolls, level: M.dropLevel });
  return jobs;
}

/** 2단계 작업(세션 결과의 사본으로) @param {any[]} sessions @param {any} [o] */
export function measureJobs2(sessions, o = {}) {
  const P = jobParams(o);
  const jobs = [];
  for (const s of sessions) {
    const picks = evenPicks(s.snaps.length, P.replayRuns);
    jobs.push({ kind: 'replay', cls: s.cls, strategy: 'noDodge', plus: 0, seed: hash32(P.seed, 6), items: picks.map((i) => ({ idx: i, snap: s.snaps[i] })) });
    jobs.push({ kind: 'replay', cls: s.cls, strategy: 'basic', plus: M.gearPlus, seed: hash32(P.seed, 7), items: picks.map((i) => ({ idx: i, snap: s.snaps[i] })) });
    const gi = s.runs.findIndex((r) => r.riftUnlocked >= P.gearLevel);
    const snap = gi >= 0 && gi + 1 < s.snaps.length ? s.snaps[gi + 1] : null;
    jobs.push({ kind: 'gear', cls: s.cls, which: 'bot', seed: hash32(P.seed, 8), runs: P.gearRuns, level: P.gearLevel, snap });
    jobs.push({ kind: 'gear', cls: s.cls, which: 'start', seed: hash32(P.seed, 8), runs: P.gearRuns, level: P.gearLevel, snap });
  }
  return jobs;
}

function jobParams(o) {
  return {
    hours: o.hours ?? M.hours, seed: o.seed ?? 1, classes: o.classes ?? CLASSES.map((c) => c.id), challengeRuns: o.challengeRuns ?? M.challengeRuns,
    replayRuns: o.replayRuns ?? M.replayRuns, buildRuns: o.buildRuns ?? M.buildRuns, gearRuns: o.gearRuns ?? M.gearRuns, probeSeeds: o.probeSeeds ?? M.probeSeeds,
    probeLevel: o.probeLevel ?? M.probeLevel, buildChar: o.buildChar ?? M.buildChar, gearLevel: o.gearLevel ?? M.gearLevel,
  };
}

/** 0..n−1 에서 k 개를 고르게 @param {number} n @param {number} k */
function evenPicks(n, k) {
  if (n <= 0) return [];
  const out = [];
  const m = Math.min(n, k);
  for (let i = 0; i < m; i++) out.push(Math.floor(((i + 0.5) * n) / m));
  return out;
}

/**
 * 작업 하나를 돌린다 → JSON 으로 옮길 수 있는 결과(scripts/measure.mjs 가 워커에서 부른다)
 * @param {any} job @param {MakeSim} makeSim
 */
export function runJob(job, makeSim) {
  switch (job.kind) {
    case 'session': {
      const r = runSession({ cls: job.cls, strategy: 'basic', preset: 0, seed: job.seed, hours: job.hours, makeSim, snapshots: true });
      const runs = r.runs.map(compactRun);
      const firstLeg = runs.findIndex((x) => (x.drops.legendary ?? 0) > 0);
      const final = r.char;
      return {
        kind: 'session', cls: job.cls, hours: job.hours, runs, levelAt: r.levelAt, unlockAt: r.unlockAt, timeline: r.timeline, snaps: r.snaps,
        firstLegendaryRun: firstLeg >= 0 ? firstLeg + 1 : null, final: { level: final.level, riftUnlocked: final.riftUnlocked, playSec: final.playSec },
        econ: econProbe(r, job.seed), counters: r.bot.counters,
      };
    }
    case 'challenge': {
      const r = runSession({ cls: job.cls, strategy: 'challenge', preset: 0, seed: job.seed, hours: 1e6, makeSim, maxRuns: job.runs });
      return { kind: 'challenge', cls: job.cls, runs: r.runs.map(compactRun) };
    }
    case 'build': {
      const sim0 = makeSim(job.seed >>> 0, createAccount());
      const preset = job.build === 'B' ? 1 : 0;
      const char = makeDevCharacter({ slot: 0, cls: job.cls, name: job.cls, level: job.char.level, rift: job.char.rift, preset, seed: job.seed, newId: sim0.ctx.newItemId });
      if (job.build.startsWith('R')) { char.skills.ranks = {}; char.skills.bar = emptyArray(char.skills.bar.length); }
      const runs = [];
      for (let i = 0; i < job.runs; i++) {
        const bseed = job.build.startsWith('R') ? hash32(job.seed, 100 + Number(job.build.slice(1)), i) : hash32(job.seed, 100, i);
        const r = runSession({ cls: job.cls, preset: job.build.startsWith('R') ? RANDOM_BUILD : preset, seed: bseed, hours: 1e6, makeSim, char, riftLevel: job.char.rift, maxRuns: 1 });
        if (r.runs[0]) runs.push(compactRun(r.runs[0]));
      }
      return { kind: 'build', cls: job.cls, build: job.build, char: job.char, runs };
    }
    case 'affix': {
      const probes = [];
      for (let i = 0; i < job.seeds; i++) probes.push(affixProbe({ cls: job.cls, affixId: job.affixId, level: job.level, seed: hash32(job.seed, i), makeSim }));
      return { kind: 'affix', cls: job.cls, affixId: job.affixId, level: job.level, probes };
    }
    case 'replay': {
      const runs = [];
      for (const it of job.items) {
        const char = JSON.parse(it.snap);
        // 해금 + 3 은 해금 밖이다 — 레벨 선택이 해금 안으로 자르지 않게 캐릭터의 해금을 올린 사본으로(장비 · 레벨 · 스킬은 그대로)
        const level = job.plus ? char.riftUnlocked + job.plus : null;
        if (level !== null) char.riftUnlocked = level;
        const r = runSession({ cls: job.cls, strategy: job.strategy, preset: 0, seed: hash32(job.seed, it.idx), hours: 1e6, makeSim, char, riftLevel: level, maxRuns: 1 });
        if (r.runs[0]) runs.push({ idx: it.idx, ...compactRun(r.runs[0]) });
      }
      return { kind: 'replay', cls: job.cls, strategy: job.strategy, plus: job.plus, runs };
    }
    case 'gear': {
      let char = job.snap ? JSON.parse(job.snap) : null;
      let source = 'session';
      if (!char) {
        const sim0 = makeSim(job.seed >>> 0, createAccount());
        char = makeDevCharacter({ slot: 0, cls: job.cls, name: job.cls, level: probeCharLevel(job.level), rift: job.level, preset: 0, seed: job.seed, newId: sim0.ctx.newItemId });
        source = 'dev';
      }
      char.riftUnlocked = Math.max(char.riftUnlocked, job.level);
      if (job.which === 'start') char = withStartGear(char);
      // 판 시작 사본의 가방에는 앞 판의 전리품이 있다 — 비운다(가방에서 장착해 「시작 장비」가 바뀌지 않게 · 두 쪽 같게)
      char.bag = char.bag.map(() => null);
      const runs = [];
      for (let i = 0; i < job.runs; i++) {
        const r = runSession({ cls: job.cls, preset: 0, seed: hash32(job.seed, 200, i), hours: 1e6, makeSim, char, riftLevel: job.level, maxRuns: 1 });
        if (r.runs[0]) runs.push(compactRun(r.runs[0]));
      }
      return { kind: 'gear', cls: job.cls, which: job.which, level: job.level, source, charLevel: char.level, runs };
    }
    case 'drops': {
      // 등급 굴림 n 번(rollRarity — rollDrops 가 장비마다 부르는 단계) vs 이론값(theory.rarityDist)
      const out = [];
      for (const rank of ['normal', 'champion', 'elite']) {
        const rng = makeRng(seedRng(hash32(job.seed, rank.length)));
        /** @type {Record<string, number>} */
        const by = {};
        for (let i = 0; i < job.n; i++) {
          const r = rollRarity(rng, { rank, level: job.level, mf: 0, blp: 0, blpOn: false });
          by[r.rarity] = (by[r.rarity] ?? 0) + 1;
        }
        const theory = rarityDist({ rank, level: job.level, mf: 0, blp: 0, blpOn: false });
        out.push({ rank, gear: job.n, byRarity: by, theory });
      }
      const mf = [0, 100, 300, 600].map((m) => {
        const t = rarityDist({ rank: 'normal', level: job.level, mf: m, blp: 0, blpOn: false });
        return { mf: m, rarePlus: (t.rare ?? 0) + (t.legendary ?? 0) + (t.set ?? 0) };
      });
      const blp = createDropSim({ rank: 'elite', level: job.level, cls: 'warrior', mf: 0, blpOn: true, seed: job.seed });
      blp.run(job.n);
      return { kind: 'drops', level: job.level, n: job.n, ranks: out, mf, maxGearGap: blp.result().maxGearGap };
    }
    default:
      throw new Error('measure: unknown job ' + job.kind);
  }
}

/**
 * MEASURE.md 마크다운 — results(runJob 결과 목록)가 없으면 makeSim 으로 모든 작업을 차례로 돌린다(느리다 — 스크립트는 워커로 나눠 돌린 결과를 넘긴다)
 * @param {{results?:any[]|null, makeSim?:MakeSim|null, generatedAt?:string, perf?:any, hours?:number, seed?:number, classes?:string[]}} [o]
 * @returns {string}
 */
export function measureTable(o = {}) {
  let results = o.results ?? null;
  if (!results) {
    if (!o.makeSim) return '(측정 없음)';
    results = measureJobs(o).map((j) => runJob(j, /** @type {MakeSim} */ (o.makeSim)));
    const sessions = results.filter((r) => r.kind === 'session');
    results = results.concat(measureJobs2(sessions, o).map((j) => runJob(j, /** @type {MakeSim} */ (o.makeSim))));
  }
  return formatReport(results, o);
}

// ───────────────────────── 리포트 ─────────────────────────

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const f0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const pct = (v) => (Number.isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(0) + '%' : '—');
const spct = (v) => (Number.isFinite(v) ? (v < 0 ? '−' : '+') + Math.abs(v * 100).toFixed(0) + '%' : '—');
const min = (s) => (Number.isFinite(s) ? (s / 60).toFixed(1) + '분' : '—');
const hrs = (s) => (Number.isFinite(s) ? (s / 3600 >= 1 ? (s / 3600).toFixed(2) + '시간' : (s / 60).toFixed(0) + '분') : '미도달');
const kills = (k) => (k.normal ?? 0) + (k.champion ?? 0) + (k.elite ?? 0) + (k.minion ?? 0) + (k.guardian ?? 0) + (k.other ?? 0);
const gear = (d) => RARITIES.reduce((s, r) => s + (d[r] ?? 0), 0);
const income = (r) => r.gold + r.sales;
/** 판정 — 상한 안이면 ✓ · 측정 없음 — · 밖 ✗ */
const judgeMax = (v, hi) => (!Number.isFinite(v) ? '— 측정 없음' : v <= hi ? '✓' : '✗');
const CLS_KO = { warrior: '전사', mage: '마법사' };
const clsKo = (c) => CLS_KO[c] ?? c;

/** 적정 레벨 판 — basic 세션에서 그 판의 레벨이 다음 판에 그대로이거나(평형) 상승 조건으로 오른 판 전부(초반 상승 구간 포함) */
function fitRuns(sess) {
  return sess.runs.filter((r) => r.result !== 'abandon');
}

/** 상승 조건(무사망 · 완료 · upMaxSec 안) @param {any} r */
const upOk = (r) => r.result === 'complete' && r.deaths === 0 && r.timeSec <= BOT.upMaxSec;

/** 보상(L) = √(E[업그레이드 drop 의 power 상승 비율] × 골드/판) */
const rewardOf = (runs) => Math.sqrt(Math.max(0, avg(runs.map((r) => r.upGain))) * Math.max(0, avg(runs.map(income))));

/** 레벨별 묶음 */
function byLevel(runs) {
  const m = new Map();
  for (const r of runs) {
    if (!m.has(r.level)) m.set(r.level, []);
    m.get(r.level).push(r);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

/** 기본 공격 타수 분포 → 중앙값 */
function hitsMedian(runs) {
  const all = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.basicHits ?? {})) all[k] = (all[k] ?? 0) + v;
  const arr = [];
  for (const [k, v] of Object.entries(all)) for (let i = 0; i < v; i++) arr.push(Number(k));
  return { median: median(arr), n: arr.length, mean: avg(arr) };
}

function formatReport(results, o) {
  const sessions = results.filter((r) => r.kind === 'session');
  const lines = [];
  const L = (s = '') => lines.push(s);
  L('<!-- OWNER: P15 — 계약 §12.5 · scripts/measure.mjs 의 출력(손으로 고치지 않는다 — npm run measure 로 다시 쓴다) -->');
  L('# MEASURE — rift-hunter 측정 리포트');
  L('');
  L(`> \`npm run measure\` — 헤드리스 봇(P15)이 두 클래스로 판을 돌아 브리프 §7 의 목표를 잰 결과다. 시간은 틱으로 민다(30Hz · 플레이 시간 = playSec — 마을 정비 시간 BOT.townSec 포함).`);
  if (o.generatedAt) L(`> 생성: ${o.generatedAt}${o.wallSec ? ` · 실행 ${Math.round(o.wallSec)}초` : ''} · 시드 ${o.seed ?? 1}`);
  L(`> 구성: basic 세션 ${sessions.map((s) => `${clsKo(s.cls)} ${s.hours}시간(${s.runs.length}판)`).join(' · ')} · noDodge · 해금 + 3 각 ${o.replayRuns ?? M.replayRuns}판(basic 세션 사본에서) · challenge ${o.challengeRuns ?? M.challengeRuns}판 · 빌드 비교 · 장비 비교 · 정예 속성 탐침 · 드랍 표 10만 회.`);
  L('');
  // ── 목표 대조표
  const goals = goalRows(results);
  L('## 1. 목표 대조표 (브리프 §7)');
  L('');
  L('| 무엇 | 목표 | 측정값 | 판정 |');
  L('|---|---|---|---|');
  for (const g of goals) L(`| ${g.what} | ${g.target} | ${g.value} | ${g.verdict} |`);
  L('');
  const fails = goals.filter((g) => g.verdict.startsWith('✗')).length;
  L(`판정 요약: ✓ ${goals.filter((g) => g.verdict.startsWith('✓')).length} · ✗ ${fails} · — ${goals.filter((g) => g.verdict.startsWith('—')).length} (✗ 는 밸런스 게이트(§12.7)의 조정 손잡이로 맞출 것 — 아래 표가 근거)`);
  L('');
  // ── 레벨별 표
  L('## 2. 균열 레벨별 (basic 봇 · 적정 레벨 = basic 이 고른 레벨)');
  L('');
  for (const s of sessions) {
    L(`### ${clsKo(s.cls)} — ${s.runs.length}판 · ${hrs(s.final.playSec)} · 최종 캐릭터 레벨 ${s.final.level} · 해금 균열 ${s.final.riftUnlocked}`);
    L('');
    L('| 균열 | 판 | 시간 평균/중앙 | 사망/판 | 붕괴 | 처치(일반/챔/정예/하수인/수호자/기타) | 분당 처치 | 떼 순간/판 | 장비/판(마법·희귀·전설·세트) | 골드/판(줍기+판매) | 경험치/판 | 업그레이드 판 | 도중 귀환 | 수리비/수입 | 상승 조건 | 보상(L) |');
    L('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [lv, rs] of byLevel(fitRuns(s))) {
      const k = (key) => avg(rs.map((r) => r.kills[key] ?? 0));
      const kpm = avg(rs.map((r) => kills(r.kills) / Math.max(1e-9, r.timeSec / 60)));
      const d = (key) => avg(rs.map((r) => r.drops[key] ?? 0));
      const repairShare = avg(rs.map((r) => r.deathRepair / Math.max(1, income(r))));
      L(`| ${lv} | ${rs.length} | ${min(avg(rs.map((r) => r.timeSec)))} / ${min(median(rs.map((r) => r.timeSec)))} | ${f2(avg(rs.map((r) => r.deaths)))} | ${pct(avg(rs.map((r) => (r.result === 'collapse' ? 1 : 0))))} | ${f0(k('normal'))}/${f1(k('champion'))}/${f1(k('elite'))}/${f1(k('minion'))}/${f1(k('guardian'))}/${f1(k('other'))} | ${f0(kpm)} | ${f1(avg(rs.map((r) => r.swarm)))} | ${f1(avg(rs.map((r) => gear(r.drops))))} (${f1(d('magic'))}·${f1(d('rare'))}·${f2(d('legendary'))}·${f2(d('set'))}) | ${f0(avg(rs.map((r) => r.gold)))}+${f0(avg(rs.map((r) => r.sales)))} | ${f0(avg(rs.map((r) => r.xp)))} | ${pct(avg(rs.map((r) => (r.upgrades > 0 ? 1 : 0))))} | ${pct(avg(rs.map((r) => (r.bagFull ? 1 : 0))))} | ${pct(repairShare)} | ${pct(avg(rs.map((r) => (upOk(r) ? 1 : 0))))} | ${f2(rewardOf(rs))} |`);
    }
    L('');
    L(`- 수리비/수입 = 「사망 1회 수리비(그 판 끝의 장착으로 계산)」/「그 판 골드 수입(줍기 + 판매)」. 상승 조건 = 완료 · 무사망 · ${BOT.upMaxSec}초 안(목표 40~60% — §7.14 평형). 보상(L) = √(업그레이드 드랍의 power 상승 비율 합/판 × 골드/판)(§7.14).`);
    L(`- 처치 시간 — 일반 몬스터 기본 공격 타수(기본 공격만으로 죽은 것) 중앙 ${f1(hitsMedian(s.runs).median)}방(${hitsMedian(s.runs).n}마리) · 챔피언 팩 중앙 ${f1(median(s.runs.flatMap((r) => r.packs.champion)))}초 · 정예 팩 중앙 ${f1(median(s.runs.flatMap((r) => r.packs.elite)))}초 · 수호자 중앙 ${f1(median(s.runs.map((r) => r.guardianSec).filter((x) => x >= 0)))}초.`);
    const over = s.runs.filter((r) => r.level > LEVEL_CAP && r.result !== 'abandon');
    if (over.length) L(`- 균열 ${LEVEL_CAP} 초과 판 ${over.length}개: 업그레이드 판 ${pct(avg(over.map((r) => (r.upgrades > 0 ? 1 : 0))))} — 드랍의 요구 레벨(= 아이템 레벨)이 캐릭터 레벨 캡 ${LEVEL_CAP} 보다 높아 낄 수 없다(§3.5 reqLevel). 사망/판 ${f2(avg(over.map((r) => r.deaths)))}.`);
    L(`- 봇 행동(세션 합): 피하기 ${s.counters.dodges}(이동 스킬 ${s.counters.dodgeSkills}) · 카이팅 ${s.counters.kites} · 스킬 ${Object.entries(s.counters.casts).map(([k, v]) => `${k} ${v}`).join(' · ')} · 장착 ${s.counters.equips} · 판매 ${s.counters.sold}개 · 끼임 풀기 ${s.counters.stuck}.`);
    L('');
  }
  // ── 진행
  L('## 3. 진행 속도 (basic · 플레이 시간)');
  L('');
  L('| 클래스 | 캐릭터 레벨 5 | 10 | 20 | 30 | 균열 해금 5 | 10 | 20 | 9시간 시점 해금 균열 · 캐릭터 레벨 | 첫 전설(판) |');
  L('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of sessions) {
    const at9 = s.timeline.filter((t) => t.playSec <= 9 * HOUR).at(-1) ?? s.timeline[0];
    L(`| ${clsKo(s.cls)} | ${hrs(s.levelAt[5])} | ${hrs(s.levelAt[10])} | ${hrs(s.levelAt[20])} | ${hrs(s.levelAt[30])} | ${hrs(s.unlockAt[5])} | ${hrs(s.unlockAt[10])} | ${hrs(s.unlockAt[20])} | 균열 ${at9.riftUnlocked} · 레벨 ${at9.level}${s.final.playSec < 9 * HOUR ? ` (세션 ${hrs(s.final.playSec)})` : ''} | ${s.firstLegendaryRun ?? '없음'} |`);
  }
  L('');
  // ── 위협
  L('## 4. 위협 (basic · noDodge · 해금 + 3 · challenge)');
  L('');
  L('| 클래스 | basic 사망/판(같은 판) | noDodge 사망/판 | 배수 | 해금 + 3 붕괴율 | challenge 20판: 사망/판 · 붕괴율 · 마지막 해금 |');
  L('|---|---|---|---|---|---|');
  for (const s of sessions) {
    const nd = results.find((r) => r.kind === 'replay' && r.cls === s.cls && r.strategy === 'noDodge');
    const p3 = results.find((r) => r.kind === 'replay' && r.cls === s.cls && r.plus === M.gearPlus);
    const ch = results.find((r) => r.kind === 'challenge' && r.cls === s.cls);
    const same = nd ? nd.runs.map((r) => s.runs[r.idx]).filter(Boolean) : [];
    const bd = avg(same.map((r) => r.deaths));
    const ndd = nd ? avg(nd.runs.map((r) => r.deaths)) : NaN;
    L(`| ${clsKo(s.cls)} | ${f2(bd)} | ${f2(ndd)} | ${bd > 0 ? f2(ndd / bd) : ndd > 0 ? '∞' : '—'} | ${p3 ? pct(avg(p3.runs.map((r) => (r.result === 'collapse' ? 1 : 0)))) : '—'} (${p3 ? p3.runs.length : 0}판) | ${ch ? `${f2(avg(ch.runs.map((r) => r.deaths)))} · ${pct(avg(ch.runs.map((r) => (r.result === 'collapse' ? 1 : 0))))} · ${ch.runs.at(-1)?.riftUnlocked ?? '—'}` : '—'} |`);
  }
  L('');
  // ── 속성
  L('## 5. 정예 속성 — 속성 하나만 단 정예 팩(정예 + 하수인) 탐침');
  L('');
  const probes = results.filter((r) => r.kind === 'affix');
  const lvl = probes[0]?.level ?? 5;
  L(`균열 ${lvl} · 개발 캐릭터(레벨 ${probeCharLevel(lvl)} · 프리셋 0 · 장비 ilvl ${lvl}) · 클래스마다 ${probes[0]?.probes.length ?? 0}회 평균. 기준 = 속성 없는 같은 종류 정예 팩. 「차이」 = 받은 피해 · 처치 시간 · 사망 중 기준과 가장 크게 다른 비율.`);
  L('');
  L('| 속성 | 종류 | 전사: 받은 피해 · 처치 초 · 사망 | 마법사: 받은 피해 · 처치 초 · 사망 | 차이(전사 / 마법사) | 판정(≥ 5%) |');
  L('|---|---|---|---|---|---|');
  for (const row of affixRows(results)) L(`| ${row.affixId ?? '(기준 없음)'} | ${row.typeId} | ${row.w} | ${row.m} | ${row.diff} | ${row.verdict} |`);
  L('');
  // ── 빌드 · 장비
  L('## 6. 빌드 · 장비');
  L('');
  L('| 클래스 | 빌드 | 판 | 완료 | 시간 평균 | 사망/판 |');
  L('|---|---|---|---|---|---|');
  for (const b of results.filter((r) => r.kind === 'build')) {
    const done = b.runs.filter((r) => r.result === 'complete');
    L(`| ${clsKo(b.cls)} | ${b.build === 'A' || b.build === 'B' ? '프리셋 ' + b.build : '무작위 배분 ' + b.build.slice(1)} (레벨 ${b.char.level} · 균열 ${b.char.rift}) | ${b.runs.length} | ${done.length} | ${min(avg(b.runs.map((r) => r.timeSec)))} | ${f2(avg(b.runs.map((r) => r.deaths)))} |`);
  }
  L('');
  L('| 클래스 | 장비 | 출처 | 캐릭터 레벨 | 판 | 붕괴율 | 사망/판 | 시간 평균 |');
  L('|---|---|---|---|---|---|---|---|');
  for (const g of results.filter((r) => r.kind === 'gear')) {
    L(`| ${clsKo(g.cls)} | ${g.which === 'start' ? '시작 장비' : '봇이 모은 장비'} · 균열 ${g.level} | ${g.source === 'session' ? `basic 세션(균열 ${g.level} 해금 시점)` : '개발 캐릭터(세션이 해금하지 못함)'} | ${g.charLevel} | ${g.runs.length} | ${pct(avg(g.runs.map((r) => (r.result === 'collapse' ? 1 : 0))))} | ${f2(avg(g.runs.map((r) => r.deaths)))} | ${min(avg(g.runs.map((r) => r.timeSec)))} |`);
  }
  L('');
  // ── 드랍
  const dr = results.find((r) => r.kind === 'drops');
  if (dr) {
    L(`## 7. 드랍 표 — 등급 굴림(rollRarity) ${dr.n.toLocaleString('en-US')}회(균열 ${dr.level} · MF 0 · 불운 보정 끔) vs 이론값(theory.rarityDist)`);
    L('');
    L('| 등급(몬스터) | 굴림 수 | 일반 | 마법 | 희귀 | 전설 | 세트 | 최대 상대 오차(빈도 1% 이상) |');
    L('|---|---|---|---|---|---|---|---|');
    for (const x of dr.ranks) {
      let worst = 0;
      const cells = RARITIES.map((r) => {
        const sim = x.gear > 0 ? (x.byRarity[r] ?? 0) / x.gear : 0;
        const th = x.theory[r] ?? 0;
        if (th >= 0.01) worst = Math.max(worst, Math.abs(sim - th) / th);
        return `${(sim * 100).toFixed(2)} / ${(th * 100).toFixed(2)}%`;
      });
      L(`| ${x.rank} | ${x.gear} | ${cells.join(' | ')} | ${pct(worst)} ${worst <= 0.03 ? '✓' : '✗'} |`);
    }
    L('');
    L(`- 아이템 발견(희귀 이상 비율 · 이론): ${dr.mf.map((m) => `MF ${m.mf}% ${(m.rarePlus * 100).toFixed(2)}%`).join(' → ')} · 불운 보정 켬(정예 ${dr.n.toLocaleString('en-US')}회): 전설 사이 장비 드랍 수 최대 ${dr.maxGearGap}.`);
    L('');
  }
  if (o.perf) {
    L('## 8. 성능 (Node · 이 머신)');
    L('');
    L(`- 깨어 있는 몬스터 ${o.perf.mons} + 투사체 ${o.perf.projs}: sim 한 틱 평균 ${f2(o.perf.stepMs)}ms(${o.perf.ticks}틱) · generateRift 시드 20개 최대 ${f1(o.perf.mapMaxMs)}ms · 봇 한 틱(세션 평균 · 봇 + sim) ${f2(o.perf.sessionMsPerTick)}ms.`);
    L('');
  }
  L('## 9. 측정의 한계');
  L('');
  L(`- 봇은 **도박 · 재굴림 · 제작 · 보관함을 쓰지 않는다**(§12.6) — 경제 목표의 도박 쪽은 해금 ${M.econLevel} 무렵(basic 세션의 그 판 시작 사본) 캐릭터로 부위마다 ${M.gambleSamples}번 굴린 기대값(위 표 「경제」 행), 재굴림은 가격만 본다(옵션 하나를 바꾼 기대 상승은 재지 않았다).`);
  L('- 봇의 장착 판단은 `compareEquip`의 power(√(시트 DPS × 유효 생명)) 하나다 — 저항 · 이동 속도 · 골드/아이템 발견 같은 power 밖의 가치는 보지 않는다. 가방은 마을에서 전부 판다(분해하지 않는다 — 재료 수요 측정 없음).');
  L('- 수동 조준의 정밀함: 봇은 커서를 대상 중심에 두고 2% 확률로 1m 안에서 흐트린다 · 예고를 알아챌 확률 0.9 · 반응 0.22±0.06초 — 사람의 편차(늦은 반응 · 겁 · 실수 연타)는 이 숫자 밖이다. 봇은 화면(viewR 11.4m) 안만 본다.');
  L('- 마법사의 카이팅은 「몰려들면 먼저 한 번 물러서고 그 뒤 자리에서 싸운다」로 구현했다(계속 물러서면 화력이 사라진다 — NOTES-P15). 원거리 투사체(궁수 화살 · 주술사 화염탄)는 피하지 않는다(바닥 예고만 피한다).');
  L('- 마을 정비 시간은 BOT.townSec(대장장이 20 · 잡화상 8 · 균열석 4초) 모델이다 — 사람의 패널 시간은 addPlaySec 로 따로 들어간다. 소리 · 화면 읽기 · 실시간 조작감은 재지 못한다.');
  L('- 드랍 목표는 「MF 0」 기준이지만 봇이 낀 장비에 아이템 발견 옵션이 붙으면 그만큼 섞인다(표의 장비/판은 실제 판 그대로).');
  L('- 해금 + 3 · noDodge 는 basic 세션의 판 시작 사본(고르게 20개)에서 한 판씩 돌린 값이다 — 같은 캐릭터 · 같은 레벨 경로.');
  L('');
  return lines.join('\n') + '\n';
}

/** 속성 표 행 */
function affixRows(results) {
  const probes = results.filter((r) => r.kind === 'affix');
  const base = {};
  for (const p of probes) if (p.affixId === null) base[p.cls] = p;
  const agg = (p) => ({ dmg: avg(p.probes.map((x) => x.dmgTaken)), ttk: avg(p.probes.map((x) => x.ttkSec)), deaths: avg(p.probes.map((x) => x.deaths)), type: p.probes[0]?.typeId });
  const ids = [...new Set(probes.map((p) => p.affixId))];
  const rows = [];
  for (const id of ids) {
    const per = {};
    for (const cls of ['warrior', 'mage']) {
      const p = probes.find((x) => x.affixId === id && x.cls === cls);
      if (p) per[cls] = agg(p);
    }
    const diff = {};
    for (const cls of Object.keys(per)) {
      const b = base[cls] ? agg(base[cls]) : null;
      if (!b || id === null) continue;
      const rel = (a, c) => (c > 0 ? Math.abs(a - c) / c : a > 0 ? 1 : 0);
      diff[cls] = Math.max(rel(per[cls].dmg, b.dmg), rel(per[cls].ttk, b.ttk), Math.abs(per[cls].deaths - b.deaths));
    }
    const cell = (cls) => (per[cls] ? `${f0(per[cls].dmg)} · ${f1(per[cls].ttk)} · ${f2(per[cls].deaths)}` : '—');
    const ds = Object.values(diff);
    const best = ds.length ? Math.max(...ds) : NaN;
    rows.push({
      affixId: id, typeId: (per.warrior ?? per.mage)?.type ?? '—', w: cell('warrior'), m: cell('mage'),
      diff: id === null ? '(기준)' : `${pct(diff.warrior)} / ${pct(diff.mage)}`,
      verdict: id === null ? '—' : Number.isFinite(best) ? (best >= 0.05 ? '✓' : '✗ 효과 없음') : '— 측정 없음',
      best,
    });
  }
  return rows;
}

/** 목표 대조표의 행(브리프 §7 의 모든 목표) */
function goalRows(results) {
  const sessions = results.filter((r) => r.kind === 'session');
  const rows = [];
  const R = (what, target, value, verdict) => rows.push({ what, target, value, verdict });
  const per = (fn) => sessions.map((s) => `${clsKo(s.cls)} ${fn(s)}`).join(' · ');
  const all = (fn) => sessions.length > 0 && sessions.every(fn);
  const anyNaN = (fn) => sessions.some((s) => !Number.isFinite(fn(s)));
  const verdictAll = (fn, lo, hi) => (anyNaN(fn) ? '— 측정 없음' : all((s) => fn(s) >= lo && fn(s) <= hi) ? '✓' : '✗');
  const fit = (s) => fitRuns(s);
  // 「적정 레벨」 판 = basic 이 고른 레벨의 판 전부(첫 판 포함 · 버린 판 제외) — 평형(상승이 멈춘 레벨)은 §2 표와 「상승 조건」 열로 본다
  const eq = (s) => fit(s);
  // 경제 — 해금 10 무렵(econ.level ± 2)의 판
  const econRuns = (s) => fit(s).filter((r) => Math.abs(r.level - s.econ.level) <= M.econBand);
  const len = (s) => median(eq(s).filter((r) => r.result === 'complete').map((r) => r.timeSec)) / 60;
  R('한 판 길이(적정 레벨 · basic · 게이지 + 수호자)', '5~8분', per((s) => `${f1(len(s))}분`), verdictAll(len, 5, 8));
  const first = (s) => s.runs[0];
  R('처음 성공까지(균열 1 · 시작 장비 · 첫 시도 · 사망 ≤ 1)', '두 클래스 모두 클리어', per((s) => `${first(s)?.result ?? '—'} · 사망 ${first(s)?.deaths ?? '—'}`),
    sessions.length && all((s) => first(s) && first(s).level === 1 && first(s).result === 'complete' && first(s).deaths <= 1) ? '✓' : '✗');
  const repShare = (s) => median(eq(s).map((r) => r.deathRepair / Math.max(1, income(r))));
  R('실패 한 번으로 잃는 것(사망 1회 수리비 / 한 판 골드)', '10~20%', per((s) => pct(repShare(s))), verdictAll(repShare, 0.10, 0.20));
  R('실패 → 재도전', '키 2번 · 2초 안', 'headless S4(키 2번 · 시스템 1.3초 + 봇 반응)', '— headless.test');
  const swarm = (s) => avg(eq(s).map((r) => r.swarm));
  const kpm = (s) => median(eq(s).map((r) => kills(r.kills) / Math.max(1e-9, r.timeSec / 60)));
  R('다수의 몬스터 — 25마리 이상 동시 순간/판', '≥ 3', per((s) => f1(swarm(s))), sessions.length && !anyNaN(swarm) ? (all((s) => swarm(s) >= 3) ? '✓' : '✗') : '— 측정 없음');
  R('다수의 몬스터 — 적정 레벨 분당 처치', '40~80', per((s) => f0(kpm(s))), verdictAll(kpm, 40, 80));
  const hits = (s) => hitsMedian(eq(s)).median;
  const champ = (s) => median(eq(s).flatMap((r) => r.packs.champion));
  const elite = (s) => median(eq(s).flatMap((r) => r.packs.elite));
  const guard = (s) => median(eq(s).map((r) => r.guardianSec).filter((x) => x >= 0));
  R('처치 시간 — 일반 몬스터 기본 공격', '2~4방', per((s) => `${f1(hits(s))}방`), verdictAll(hits, 2, 4));
  R('처치 시간 — 챔피언 팩', '8~20초', per((s) => `${f1(champ(s))}초`), verdictAll(champ, 8, 20));
  R('처치 시간 — 정예 팩', '15~35초', per((s) => `${f1(elite(s))}초`), verdictAll(elite, 15, 35));
  R('처치 시간 — 수호자', '30~70초', per((s) => `${f1(guard(s))}초`), verdictAll(guard, 30, 70));
  const deaths = (s) => avg(eq(s).map((r) => r.deaths));
  R('위협 — 적정 레벨 basic 사망/판', '0.2~1.0', per((s) => f2(deaths(s))), verdictAll(deaths, 0.2, 1.0));
  const ndRatio = (s) => {
    const nd = results.find((r) => r.kind === 'replay' && r.cls === s.cls && r.strategy === 'noDodge');
    if (!nd || !nd.runs.length) return NaN;
    const bd = avg(nd.runs.map((r) => s.runs[r.idx]?.deaths ?? 0));
    const x = avg(nd.runs.map((r) => r.deaths));
    return bd > 0 ? x / bd : x > 0 ? Infinity : 0;
  };
  const ndCell = (s) => {
    const nd = results.find((r) => r.kind === 'replay' && r.cls === s.cls && r.strategy === 'noDodge');
    if (!nd || !nd.runs.length) return '—';
    const bd = avg(nd.runs.map((r) => s.runs[r.idx]?.deaths ?? 0)), x = avg(nd.runs.map((r) => r.deaths));
    return bd > 0 ? `${f2(x / bd)}배(${f2(x)} / ${f2(bd)})` : `${f2(x)} / ${f2(bd)}`;
  };
  R('위협 — 같은 판 noDodge 사망 / basic', '≥ 2배', per(ndCell),
    sessions.length && sessions.every((s) => ndRatio(s) >= 2) ? '✓' : sessions.some((s) => Number.isNaN(ndRatio(s))) ? '— 측정 없음' : '✗');
  const p3 = (s) => {
    const r = results.find((x) => x.kind === 'replay' && x.cls === s.cls && x.plus === M.gearPlus);
    return r && r.runs.length ? avg(r.runs.map((x) => (x.result === 'collapse' ? 1 : 0))) : NaN;
  };
  R('위협 — 해금 최고 + 3 에서 basic 붕괴', '≥ 50%', per((s) => pct(p3(s))), anyNaN(p3) ? '— 측정 없음' : all((s) => p3(s) >= 0.5) ? '✓' : '✗');
  const ar = affixRows(results).filter((r) => r.affixId !== null);
  const noEffect = ar.filter((r) => Number.isFinite(r.best) && r.best < 0.05).map((r) => r.affixId);
  R('정예 속성이 다르다(속성 12종 · 기준과 차이 < 5% 인 속성)', '0개', ar.length ? `${noEffect.length}개${noEffect.length ? ' (' + noEffect.join(', ') + ')' : ''}` : '—', ar.length ? (noEffect.length === 0 ? '✓' : '✗') : '— 측정 없음');
  const dGear = (s) => avg(eq(s).map((r) => gear(r.drops)));
  const dR = (s, k) => avg(eq(s).map((r) => r.drops[k] ?? 0));
  R('드랍/판 — 장비', '30~60', per((s) => f1(dGear(s))), verdictAll(dGear, 30, 60));
  R('드랍/판 — 마법', '10~25', per((s) => f1(dR(s, 'magic'))), verdictAll((s) => dR(s, 'magic'), 10, 25));
  R('드랍/판 — 희귀', '3~8', per((s) => f1(dR(s, 'rare'))), verdictAll((s) => dR(s, 'rare'), 3, 8));
  R('드랍/판 — 전설', '0.2~0.5', per((s) => f2(dR(s, 'legendary'))), verdictAll((s) => dR(s, 'legendary'), 0.2, 0.5));
  R('드랍/판 — 세트', '0.05~0.15', per((s) => f2(dR(s, 'set'))), verdictAll((s) => dR(s, 'set'), 0.05, 0.15));
  R('첫 전설', '2~5판(불운 보정 켬)', per((s) => (s.firstLegendaryRun !== null ? s.firstLegendaryRun + '판째' : '없음')), sessions.length && all((s) => s.firstLegendaryRun !== null && s.firstLegendaryRun >= 2 && s.firstLegendaryRun <= 5) ? '✓' : '✗');
  const upRate = (s, lo, hi) => { const rs = fit(s).filter((r) => r.level >= lo && r.level <= hi); return rs.length ? avg(rs.map((r) => (r.upgrades > 0 ? 1 : 0))) : NaN; };
  R('한 번 다녀오면 바뀐다 — 균열 1~5 업그레이드 판 비율', '70~95%', per((s) => pct(upRate(s, 1, 5))), verdictAll((s) => upRate(s, 1, 5), 0.7, 0.95));
  R('한 번 다녀오면 바뀐다 — 균열 10 무렵(9~11)', '30~60%', per((s) => pct(upRate(s, 9, 11))), verdictAll((s) => upRate(s, 9, 11), 0.3, 0.6));
  R('한 번 다녀오면 바뀐다 — 균열 20 무렵(18~22)', '15~35%', per((s) => pct(upRate(s, 18, 22))), verdictAll((s) => upRate(s, 18, 22), 0.15, 0.35));
  // 레벨 곡선 — 균열 1~20 판으로 log(보상) 과 log(어려움) 을 레벨에 대해 직선 맞춤 → 레벨당 증가 배율의 비(어려움 / 보상 · §7.14 정의)
  const curve = (s) => {
    const pts = fit(s).filter((r) => r.level <= 20).map((r) => ({ L: r.level, rw: Math.sqrt(Math.max(0, r.upGain) * Math.max(0, income(r))) })).filter((p) => p.rw > 0);
    if (pts.length < 4 || new Set(pts.map((p) => p.L)).size < 3) return { ratio: NaN, hard: NaN, rew: NaN, n: pts.length };
    const slope = (xs, ys) => { const mx = avg(xs), my = avg(ys); let a = 0, b = 0; for (let k = 0; k < xs.length; k++) { a += (xs[k] - mx) * (ys[k] - my); b += (xs[k] - mx) ** 2; } return b > 0 ? a / b : NaN; };
    const Ls = pts.map((p) => p.L);
    const gr = Math.exp(slope(Ls, pts.map((p) => Math.log(p.rw))));
    const hardOf = (L) => { const a = riftRow(L); return Math.sqrt(a.hpMul * earlyHpMul(L) * a.dmgMul * earlyDmgMul(L)); };
    const gh = Math.exp(slope(Ls, Ls.map((L) => Math.log(hardOf(L)))));
    return { ratio: gh / gr, hard: gh - 1, rew: gr - 1, n: pts.length };
  };
  const ratio = (s) => curve(s).ratio;
  R('레벨이 의미 있다 — 레벨당 어려움 / 보상 증가 배율의 비(균열 1~20 직선 맞춤)', '0.8~1.25', per((s) => { const c = curve(s); return Number.isFinite(c.ratio) ? `${f2(c.ratio)}(레벨당 어려움 ${spct(c.hard)} · 보상 ${spct(c.rew)} · ${c.n}판)` : '—'; }), verdictAll(ratio, 0.8, 1.25));
  const at = (s, key, n) => s[key][n];
  R('진행 속도 — 균열 5 해금', '30~60분', per((s) => hrs(at(s, 'unlockAt', 5))), verdictAll((s) => at(s, 'unlockAt', 5) ?? NaN, 1800, 3600));
  R('진행 속도 — 균열 10 해금', '1.5~3시간', per((s) => hrs(at(s, 'unlockAt', 10))), verdictAll((s) => at(s, 'unlockAt', 10) ?? NaN, 5400, 10800));
  R('진행 속도 — 캐릭터 레벨 10', '30~50분', per((s) => hrs(at(s, 'levelAt', 10))), verdictAll((s) => at(s, 'levelAt', 10) ?? NaN, 1800, 3000));
  R('진행 속도 — 캐릭터 레벨 30', '5~9시간', per((s) => hrs(at(s, 'levelAt', 30))), verdictAll((s) => at(s, 'levelAt', 30) ?? NaN, 5 * HOUR, 9 * HOUR));
  const bag = (s) => avg(eq(s).map((r) => (r.bagFull ? 1 : 0)));
  R('귀환 루프 — 가방이 차서 도중 귀환한 판', '30~60%', per((s) => pct(bag(s))), verdictAll(bag, 0.3, 0.6));
  const left = (s) => {
    const rs = econRuns(s);
    const net = avg(rs.map((r) => income(r) - r.deathRepair * r.deaths - r.consumables));
    return { net, gambles: net / Math.max(1, s.econ.avgPrice), rerolls: net / Math.max(1, s.econ.rerollPrice) };
  };
  R('경제 — 수리 · 포션 뒤 남는 골드(해금 10 무렵 판)', '도박 1~3회 또는 재굴림 1~2회', per((s) => `균열 ${s.econ.level}: 도박 ${f1(left(s).gambles)}회 · 재굴림 ${f1(left(s).rerolls)}세트`),
    sessions.length && all((s) => (left(s).gambles >= 1 && left(s).gambles <= 3) || (left(s).rerolls >= 1 && left(s).rerolls <= 2)) ? '✓' : '✗');
  const huntPerGold = (s) => { const rs = econRuns(s); return avg(rs.map((r) => r.upGain)) / Math.max(1, avg(rs.map(income))); };
  R('경제 — 도박의 골드당 기대 상승 < 사냥(해금 10 무렵)', '도박 < 사냥', per((s) => `도박 ${(s.econ.gainPerGold * 1000).toFixed(3)} · 사냥 ${(huntPerGold(s) * 1000).toFixed(3)}(‰/골드 · 캐릭터 레벨 ${s.econ.charLevel})`),
    sessions.length && all((s) => s.econ.gainPerGold < huntPerGold(s)) ? '✓' : '✗');
  const gearRate = (cls, which) => { const g = results.find((r) => r.kind === 'gear' && r.cls === cls && r.which === which); return g && g.runs.length ? avg(g.runs.map((r) => (r.result === 'collapse' ? 1 : 0))) : NaN; };
  R('장비가 의미 있다 — 시작 장비로 균열 8 붕괴', '≥ 80%', per((s) => pct(gearRate(s.cls, 'start'))), anyNaN((s) => gearRate(s.cls, 'start')) ? '— 측정 없음' : all((s) => gearRate(s.cls, 'start') >= 0.8) ? '✓' : '✗');
  R('장비가 의미 있다 — 봇 장비(균열 8 해금 시점)로 붕괴', '≤ 20%', per((s) => pct(gearRate(s.cls, 'bot'))), anyNaN((s) => gearRate(s.cls, 'bot')) ? '— 측정 없음' : all((s) => gearRate(s.cls, 'bot') <= 0.2) ? '✓' : '✗');
  const bt = (cls, b) => { const x = results.find((r) => r.kind === 'build' && r.cls === cls && r.build === b); return x && x.runs.length ? avg(x.runs.map((r) => r.timeSec)) : NaN; };
  const randGap = (s) => { const p = Math.min(bt(s.cls, 'A'), bt(s.cls, 'B')); const r = avg(['R1', 'R2', 'R3'].map((b) => bt(s.cls, b)).filter(Number.isFinite)); return p > 0 ? (r - p) / p : NaN; };
  const presetGap = (s) => { const a = bt(s.cls, 'A'), b = bt(s.cls, 'B'); return Math.min(a, b) > 0 ? Math.abs(a - b) / Math.min(a, b) : NaN; };
  R('스킬 트리 — 프리셋 vs 무작위 배분 클리어 시간 차', '≥ 15%', per((s) => pct(randGap(s))), anyNaN(randGap) ? '— 측정 없음' : all((s) => randGap(s) >= 0.15) ? '✓' : '✗');
  R('스킬 트리 — 두 프리셋끼리 차', '≤ 20%', per((s) => pct(presetGap(s))), anyNaN(presetGap) ? '— 측정 없음' : all((s) => presetGap(s) <= 0.2) ? '✓' : '✗');
  const w = sessions.find((s) => s.cls === 'warrior'), m = sessions.find((s) => s.cls === 'mage');
  const lenGap = w && m ? Math.abs(len(w) - len(m)) / Math.min(len(w), len(m)) : NaN;
  const u10 = (s) => s?.unlockAt?.[10];
  const r10Gap = w && m && u10(w) && u10(m) ? Math.abs(u10(w) - u10(m)) / Math.min(u10(w), u10(m)) : NaN;
  R('클래스 균형 — 적정 레벨 클리어 시간 차', '≤ 25%', pct(lenGap), judgeMax(lenGap, 0.25));
  R('클래스 균형 — 균열 10 도달 시간 차', '≤ 30%', Number.isFinite(r10Gap) ? pct(r10Gap) : '— (미도달)', judgeMax(r10Gap, 0.3));
  const dr = results.find((r) => r.kind === 'drops');
  let worst = NaN;
  if (dr) {
    worst = 0;
    for (const x of dr.ranks) for (const r of RARITIES) {
      const th = x.theory[r] ?? 0;
      if (th < 0.01 || !(x.gear > 0)) continue;
      worst = Math.max(worst, Math.abs((x.byRarity[r] ?? 0) / x.gear - th) / th);
    }
  }
  R('드랍 확률이 표와 같다(등급 · 10만 회 · 빈도 1% 이상)', '상대 오차 ≤ 3% · MF 수확 체감 · 불운 상한', dr ? `최대 ${pct(worst)} · 불운 최대 간격 ${dr.maxGearGap}(rollDrops.test 가 부위 · 티어까지 본다)` : '—', dr ? judgeMax(worst, 0.03) : '— 측정 없음');
  R('성능(Node)', 'step ≤ 4ms · 맵 ≤ 150ms', 'perf.test(S5) · 아래 §8', '— perf.test');
  R('결정성 · 견고성', '해시 동일 · 예외 · NaN · 음수 · 복사 0', 'headless.test(S1 · S2 · S3)', '— headless.test');
  R('데이터 완결성', '모든 행이 스키마 · 참조', 'data.schema.test', '— data.schema.test');
  return rows;
}

