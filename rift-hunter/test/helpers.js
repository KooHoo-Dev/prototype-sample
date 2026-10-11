// OWNER: P0 — 계약 §6.17 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 테스트 공용 도우미 — W1 테스트가 서로를 기다리지 않게 리터럴 · 데이터만으로 상태 · 문맥 · 몬스터를 만든다.

import assert from 'node:assert/strict';
import { BAG_SIZE, EQUIP_SLOTS, SKILL_BAR, STASH_SIZE } from '../src/core/constants.js';
import { makeInput } from '../src/core/inputFrame.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { SpatialHash } from '../src/core/spatialHash.js';
import { CLASSES } from '../src/data/classes.js';
import { START } from '../src/data/economy.js';
import { getMonDef, getRank } from '../src/data/index.js';
import { MON } from '../src/data/monsters.js';
import { riftRow } from '../src/data/rift.js';
import { DEFAULT_ROOM, mapFromAscii } from '../src/debug/fixtureMap.js';
import { addMonster } from '../src/sim/entities.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { createGameState, createMonStatus, createRiftState, emptyArray, emptyEquip } from '../src/sim/state.js';
import { createFlow, flowDist } from '../src/sim/world/flow.js';
import { findPath } from '../src/sim/world/path.js';

/** @typedef {import('../src/types.js').GameState} GameState */
/** @typedef {import('../src/types.js').SimCtx} SimCtx */
/** @typedef {import('../src/types.js').MapData} MapData */
/** @typedef {import('../src/types.js').PlayerStats} PlayerStats */
/** @typedef {import('../src/types.js').CharacterState} CharacterState */

export { DEFAULT_ROOM };

/** makeTestState 가 만든 맵(makeTestCtx 가 같은 맵을 쓴다) */
const TEST_MAPS = new WeakMap();
let itemSeq = 1;

/**
 * 레벨 1 전사(overrides.cls 가 'mage' 면 마법사) · 시작 장비(makeItem) · START 값 리터럴(createCharacter 를 부르지 않는다) + 얕은 덮어쓰기
 * @param {Partial<CharacterState>} [overrides] @returns {CharacterState}
 */
export function makeTestChar(overrides = {}) {
  const cls = overrides.cls ?? 'warrior';
  const C = CLASSES.find(c => c.id === cls) ?? CLASSES[0];
  const equip = emptyEquip();
  for (const g of C.startGear) {
    const it = makeItem({ baseId: g.baseId, tier: g.tier, ilvl: 1, rarity: 'normal', id: 't' + itemSeq++ });
    it.flags.start = true;
    equip[/** @type {any} */ (it.slot)] = it;
  }
  return {
    slot: 0, name: 'Tester', cls: C.id, level: 1, xp: 0, xpTotal: 0,
    gold: START.gold, materials: { ...START.materials }, potions: START.potions, scrolls: START.scrolls,
    skills: { ranks: {}, bar: emptyArray(SKILL_BAR) },
    equip,
    bag: emptyArray(BAG_SIZE),
    riftUnlocked: START.riftUnlocked, best: {}, records: [], blp: { count: 0 }, buyback: [],
    shop: { blacksmith: [], general: [], restocks: 0, stockRun: -1, reroll: null },
    hints: {}, playSec: 0, runs: 0, seed: 1, lastRiftLevel: 1,
    ...overrides,
  };
}

/**
 * FIST 가 아닌 시작 무기 · 레벨 1 PlayerStats 리터럴(§7 값으로 손 계산 — 전사: 검 3~7 · 1.40 · 생명 120 · 방어도 12 · 시트 DPS 7.8925 ·
 * ehp 138 / 마법사({cls:'mage'}): 마법봉 3~6 · 1.40 · 생명 90 · 마나 100 · 7/초 · 시트 DPS 7.1033 · ehp 103.5) + 얕은 덮어쓰기
 * @param {Partial<PlayerStats>} [overrides] @returns {PlayerStats}
 */
export function makeTestStats(overrides = {}) {
  const mage = overrides.cls === 'mage';
  const zero4 = () => ({ phys: 0, fire: 0, cold: 0, lightning: 0 });
  const weapon = mage
    ? { min: 3, max: 6, aps: 1.4, type: /** @type {const} */ ('lightning'), hands: /** @type {1} */ (1), baseId: 'wand', fist: false }
    : { min: 3, max: 7, aps: 1.4, type: /** @type {const} */ ('phys'), hands: /** @type {1} */ (1), baseId: 'sword', fist: false };
  const lifeMax = mage ? 90 : 120;
  // sheetDps = (min + max)/2 × aps × (1 + main/100) × (1 + 0) × (1 + 0.05 × 0.5)
  const sheetDps = ((weapon.min + weapon.max) / 2) * 1.4 * 1.1 * 1.025;
  // ehp = lifeMax / (1 − DRa(12, 1)) = lifeMax / (1 − 12/92)
  const ehp = lifeMax / (1 - 12 / 92);
  return {
    cls: mage ? 'mage' : 'warrior', level: 1,
    main: 10, vit: 0,
    lifeMax, resourceMax: 100, resourceRegen: mage ? 7 : 0,
    weapon,
    aps: 1.4,
    critChance: 0.05, critDamage: 0.5,
    dmgPct: zero4(), skillPct: {},
    aoePct: 0, elitePct: 0, cdr: 0, costReduce: 0,
    lifeRegen: 0, lifeOnHit: 0, lifePctOnHit: 0,
    armor: 12, res: zero4(), block: 0, moveSpeed: 6,
    thorns: 0, goldFind: 0, magicFind: 0, xpPct: 0, potionPct: 0, globePct: 0, dmgTakenReduce: 0, rageOnHit: 0,
    burnFrac: 0, freezeAtReduce: 0, freezeDurPct: 0, manaRegenPct: 0,
    hooks: [], ranks: {}, transforms: [], conds: [], broken: [], setCounts: {},
    sheetDps, ehp,
    ...overrides,
  };
}

/**
 * debug/fixtureMap.js 의 ASCII → MapData — 기본: 40 × 40m 방 하나 · 기둥 4 · 팩 자리 6
 * @param {string} [ascii] @returns {MapData}
 */
export function makeTestMap(ascii = DEFAULT_ROOM) {
  return mapFromAscii(ascii, { id: 'test:map', kind: 'rift', tileset: 'crypt' });
}

/**
 * 균열 1 상태(몬스터 없음) · 플레이어 spawn · 생명 가득(scene 'town' 이면 균열 없음 · 같은 맵의 spawn)
 * @param {{scene?:'town'|'rift', cls?:'warrior'|'mage', level?:number, seed?:number, map?:MapData|null}} [opts]
 * @returns {GameState}
 */
export function makeTestState({ scene = 'rift', cls = 'warrior', level = 1, seed = 1, map = null } = {}) {
  const m = map ?? makeTestMap();
  const state = createGameState({ seed, devSession: true });
  state.char = makeTestChar({ cls, level });
  state.account.chars[0] = { name: state.char.name, cls, level, riftUnlocked: state.char.riftUnlocked };
  state.account.lastSlot = 0;
  state.scene = scene;
  if (scene === 'rift') state.rift = createRiftState({ level: 1, seed, tileset: m.tileset, mapId: m.id, map: m });
  const C = CLASSES.find(c => c.id === cls) ?? CLASSES[0];
  const p = state.player;
  p.pos = { x: m.spawn.x, z: m.spawn.z };
  p.prevPos = { x: m.spawn.x, z: m.spawn.z };
  p.facing = m.spawn.facing;
  p.r = C.radius;
  p.lifeMax = C.life.base * C.life.growth ** (level - 1);
  p.life = p.lifeMax;
  p.resourceMax = C.resourceMax.base + C.resourceMax.perLevel * (level - 1);
  p.resource = C.resource === 'rage' ? 0 : p.resourceMax;
  TEST_MAPS.set(state, m);
  return state;
}

/**
 * SimCtx + {events: []} — emit 은 state.events 와 ctx.events 둘 다에 · stats 기본 makeTestStats({cls}) · refreshStats no-op(바꿀 수 있다) ·
 * hooks 기본 no-op(§3.10 의 여덟 · onGlobe 는 {mul:1, radiusAdd:0}) · monVer 0 · 균열이면 flow = createFlow(map)
 * @param {GameState} state @param {{map?:MapData|null, stats?:PlayerStats|null, hooks?:Object}} [opts]
 * @returns {SimCtx & {events:Array<{name:string, payload:Object}>}}
 */
export function makeTestCtx(state, { map = null, stats = null, hooks = {} } = {}) {
  const m = map ?? TEST_MAPS.get(state) ?? makeTestMap();
  /** @type {Array<{name:string, payload:Object}>} */
  const events = [];
  const ctx = {
    state,
    map: m,
    riftMap: state.rift ? m : null,
    flow: state.scene === 'rift' ? createFlow(m) : null,
    space: new SpatialHash(2),
    monVer: 0,
    stats: stats ?? makeTestStats({ cls: state.char?.cls ?? 'warrior' }),
    rng: {
      combat: makeRng(state.rng.combat),
      loot: makeRng(state.rng.loot),
      ai: makeRng(state.rng.ai),
      shop: makeRng(state.rng.shop),
    },
    emit: (name, payload = {}) => {
      const e = { name, payload };
      state.events.push(e);
      events.push(e);
    },
    nextId: () => state.nextId++,
    newItemId: () => 'i' + state.account.nextItemId++,
    refreshStats: () => {},
    hooks: {
      onMonSpawn: () => {},
      onMonDamaged: () => {},
      onMonDeath: () => {},
      onMonHitPlayer: () => {},
      onPlayerKill: () => {},
      onGlobe: () => ({ mul: 1, radiusAdd: 0 }),
      onPlayerDamaged: () => {},
      onPlayerKilled: () => {},
      ...hooks,
    },
    dev: {},
    events,
  };
  return /** @type {any} */ (ctx);
}

/**
 * 데이터 수치로 MonsterState 리터럴(monsterStats 를 부르지 않는다 · 속성 없음) → addMonster
 * @param {SimCtx} ctx @param {{typeId?:string, rank?:import('../src/types.js').MonRank, x:number, z:number, awake?:boolean, hp?:number|null}} opts
 * @returns {import('../src/types.js').MonsterState}
 */
export function addTestMonster(ctx, { typeId = 'ghoul', rank = 'normal', x, z, awake = true, hp = null }) {
  const def = getMonDef(typeId);
  const rk = getRank(rank);
  const level = ctx.state.rift?.level ?? 1;
  const row = riftRow(level);
  const hpMax = MON.hpBase * def.hp * rk.hp * row.hpMul;
  /** @type {Record<string, number>} */
  const res = {};
  for (const t of ['phys', 'fire', 'cold', 'lightning']) res[t] = Math.min(MON.resCap, def.res[t] ?? 0);
  /** @type {import('../src/types.js').MonsterState} */
  const mon = {
    id: ctx.nextId(), typeId, rank, packId: -1, level, affixes: [], name: null,
    pos: { x, z }, prevPos: { x, z }, facing: 0, vel: { x: 0, z: 0 },
    r: def.radius * rk.scale, height: def.height * rk.scale, scale: rk.scale,
    hp: hp ?? hpMax, hpMax, dmg: MON.dmgBase * def.dmg * rk.dmg * row.dmgMul, speed: def.speed,
    res: /** @type {any} */ (res),
    awake, targeting: false,
    act: 'idle', actId: null, actStart: 0, actHit: 0, actEnd: 0,
    aim: null, aimLocked: false, readyAt: {}, st: createMonStatus(), knock: null,
    dead: false, deadAt: -1, gone: false, launch: null, ax: {},
    flags: { noXp: false, noDrops: false, noGauge: false, revived: false },
    lastHit: null, sleepAt: -1,
  };
  addMonster(ctx, mon);
  return mon;
}

/** fn(i) 를 n 번 @param {number} n @param {(i:number) => void} fn */
export function runTicks(n, fn) {
  for (let i = 0; i < n; i++) fn(i);
}

/** 이름이 name 인 이벤트 수 @param {Array<{name:string}>} events @param {string} name */
export function countEvents(events, name) {
  let n = 0;
  for (const e of events) if (e.name === name) n++;
  return n;
}

/**
 * NaN · Infinity 를 경로와 함께 실패(타입 배열 포함 · 순환 참조는 한 번만 본다)
 * @param {any} obj @param {string} [path]
 */
export function assertFiniteDeep(obj, path = 'state') {
  const seen = new Set();
  const walk = (v, p) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) assert.fail(`유한수가 아니다: ${p} = ${v}`);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const arr = /** @type {any} */ (v);
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) assert.fail(`유한수가 아니다: ${p}[${i}] = ${arr[i]}`);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  walk(obj, path);
}

/**
 * 결정적 무작위 입력(퍼즈) — 커서는 플레이어 주변 12m · 가끔 근처 몬스터를 hover(src 'pick')
 * @param {number} seed @returns {(tick:number, state:GameState) => import('../src/types.js').InputFrame}
 */
export function randomInputs(seed) {
  const st = seedRng(seed);
  const rng = makeRng(st);
  let lmb = false;
  const slot = [false, false, false, false, false];
  return (tick, state) => {
    const p = state.player.pos;
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, 12);
    let cursor = rng.chance(0.03) ? null : { x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d };
    let hover = null;
    const mons = state.rift?.mons ?? [];
    if (cursor && mons.length && rng.chance(0.3)) {
      const m = mons[rng.int(0, mons.length - 1)];
      if (!m.dead && !m.gone && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 12) {
        cursor = { x: m.pos.x, z: m.pos.z };
        hover = { kind: 'monster', id: m.id, src: 'pick' };
      }
    }
    const wasL = lmb;
    if (rng.chance(0.2)) lmb = !lmb;
    const slotDown = [false, false, false, false, false];
    for (let i = 0; i < 5; i++) {
      const was = slot[i];
      if (rng.chance(0.05)) slot[i] = !slot[i];
      slotDown[i] = slot[i] && !was;
    }
    return makeInput({
      cursor, hover: /** @type {any} */ (hover), lmb, lmbDown: lmb && !wasL, slot, slotDown,
      shift: rng.chance(0.05), potionDown: rng.chance(0.01), recallDown: rng.chance(0.002),
    });
  };
}

/**
 * W1 통합 게이트용 간이 자동 입력(봇 아님) — 닿는 살아 있는 몬스터(흐름장 걸음 수가 가장 작은 것 · 깬 것 먼저)를 누르고 있고 스킬 칸 0 을 반복 ·
 * 생명 40% 아래면 포션 · 흐름장 안에 대상이 없으면 가장 가까운 몬스터(없으면 수호자 자리)까지의 경로를 8m 씩 클릭한다 · 게이지 100% 까지
 * (untilComplete 면 수호자를 잡아 완료(또는 붕괴)까지). pendingTravel 이 서면 commitTravel · 사망하면 respawn → commit → returnToRift → commit.
 * W1 확정(통합 게이트): 직선 거리로 고르던 것을 흐름장으로 — 벽 너머 직선 16m · 경로 120m 의 몬스터를 붙잡고 15분 서 있던 결함.
 * @param {any} sim GameSim @param {{maxTicks:number, untilComplete?:boolean}} opts
 * @returns {{ticks:number, gauge:number, phase:string|null, deaths:number}}
 */
export function scriptedClear(sim, { maxTicks, untilComplete = false }) {
  let t = 0, lastTarget = -1, deaths = 0, wasDead = false;
  /** @type {{x:number, z:number}|null} */
  let waypoint = null;
  let wpAt = -1e9;
  while (t < maxTicks) {
    const st = sim.state;
    if (st.pendingTravel) { sim.commitTravel(); continue; }
    const rift = st.rift;
    if (st.scene === 'town') {
      if (rift && rift.phase !== 'collapsed') sim.returnToRift();
      sim.step(makeInput({}));
      t++;
      if (st.pendingTravel) sim.commitTravel();
      if (!rift) break;
      continue;
    }
    if (!rift) break;
    if (untilComplete ? (rift.phase === 'complete' || rift.phase === 'collapsed') : (rift.gauge >= 100 || rift.phase !== 'active')) break;
    if (st.player.dead) {
      if (!wasDead) { deaths++; wasDead = true; }
      sim.respawn();
      sim.step(makeInput({}));
      t++;
      continue;
    }
    wasDead = false;
    const p = st.player;
    const potionDown = p.life < p.lifeMax * 0.4 && (st.char?.potions ?? 0) > 0 && st.tick >= (p.potionReadyAt ?? 0);
    const ctx = sim.ctx;
    let best = null, bestD = Infinity;
    for (const m of rift.mons) {
      if (m.dead || m.gone || m.hp <= 0) continue;
      let d = ctx.flow ? flowDist(ctx.flow, ctx.map, m.pos.x, m.pos.z) : Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
      if (!Number.isFinite(d)) continue;
      if (!m.awake) d += 6;
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) {
      const fresh = best.id !== lastTarget;
      lastTarget = best.id;
      sim.step(makeInput({
        cursor: { x: best.pos.x, z: best.pos.z },
        hover: { kind: 'monster', id: best.id, src: 'pick' },
        lmb: true, lmbDown: fresh || t % 15 === 0,
        slot: [t % 20 < 10, false, false, false, false], slotDown: [t % 20 === 0, false, false, false, false],
        potionDown,
      }));
      t++;
      continue;
    }
    // 흐름장 밖 — 가장 가까운 몬스터(없으면 수호자 자리)까지 경로를 8m 씩
    if (!waypoint || st.tick - wpAt > 30 || Math.hypot(p.pos.x - waypoint.x, p.pos.z - waypoint.z) < 1) {
      let goal = null, gd = Infinity;
      for (const m of rift.mons) {
        if (m.dead || m.gone) continue;
        const d = Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
        if (d < gd) { gd = d; goal = m.pos; }
      }
      goal = goal ?? rift.guardianSpawn;
      waypoint = null;
      if (goal) {
        const path = findPath(ctx.map, p.pos, goal, { r: p.r, maxNodes: 200000 });
        let acc = 0, prev = p.pos;
        waypoint = path.at(-1) ?? null;
        for (const q of path) { acc += Math.hypot(q.x - prev.x, q.z - prev.z); prev = q; if (acc > 8) { waypoint = q; break; } }
      }
      wpAt = st.tick;
    }
    sim.step(waypoint ? makeInput({ cursor: { ...waypoint }, lmb: true, lmbDown: st.tick === wpAt, potionDown }) : makeInput({ potionDown }));
    t++;
  }
  const r = sim.state.rift;
  return { ticks: t, gauge: r?.gauge ?? 0, phase: r?.phase ?? null, deaths };
}

// 빈 칸 길이 참고(테스트가 쓰면 된다)
export const SIZES = { BAG_SIZE, STASH_SIZE, EQUIP_SLOTS: EQUIP_SLOTS.length, SKILL_BAR };
