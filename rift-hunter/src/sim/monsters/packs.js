// OWNER: P3 — 계약 §6.9 · §7.5c · §5.14 · §8.2
// 팩 구성 · 배치 · 정예 이름 · 하수인 공유 · 균열 채우기(결정적 — 채우기 난수 makeRng(seedRng(hash32(seed, level, 2)))).
// 프레임워크 파일이다 — 콘텐츠 ID 로 분기하지 않는다(종류 · 팩 · 속성은 데이터 표의 가중치 · 배제 규칙으로만).
// monsters.js 를 import 하지 않는다(monsters.js → packs.js 단방향 — rollAffixes 를 수호자 출현이 쓴다). 깨우기는 spawn.js 의 wakeMonster.

import { EV } from '../../core/events.js';
import { hash32 } from '../../core/hash.js';
import { makeRng, seedRng } from '../../core/rng.js';
import { GUARDIAN_WEIGHTS } from '../../data/guardians.js';
import { MON_AFFIXES_BY_ID, PACKS_BY_ID, getMonDef, getRank } from '../../data/index.js';
import { MAPGEN } from '../../data/mapgen.js';
import { MON_AFFIXES, AFFIX_RULES } from '../../data/monsterAffixes.js';
import { ELITE_NAMES, ELITE_PACK, PACKS, PACK_PLACE, TILESET_PACKS } from '../../data/packs.js';
import { riftRow } from '../../data/rift.js';
import { isWalkableR, nearestWalkable } from '../world/nav.js';
import { spawnMonster, wakeMonster } from './spawn.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').Rng} Rng */
/** @typedef {import('../../types.js').MonRank} MonRank */
/** @typedef {import('../../types.js').PackState} PackState */
/** @typedef {import('../../types.js').PackSlot} PackSlot */
/** @typedef {import('../../types.js').MapData} MapData */

/** 균열 채우기 난수 줄기 번호(§5.14) */
const FILL_STREAM = 2;

// ───────────────────────── 속성 · 이름 ─────────────────────────

/**
 * 속성 굴림(§8.2) — minLevel ≤ level · 몬스터 태그가 excludeTags 와 겹치지 않음 · 이미 고른 것과 excludeAffixes(양쪽)가 겹치지 않음 · 가중치로 중복 없이 count 개
 * (AFFIX_RULES.minLevelByCount[k] > level 이면 k 번째부터는 굴리지 않는다). 후보가 바닥나면 그만큼 적다.
 * @param {Rng} rng @param {{tags:string[]}} typeDef @param {number} count @param {number} level @returns {string[]}
 */
export function rollAffixes(rng, typeDef, count, level) {
  const tags = typeDef?.tags ?? [];
  const L = Number.isFinite(level) ? level : 1;
  const byCount = AFFIX_RULES.minLevelByCount ?? [];
  /** @type {string[]} */
  const picked = [];
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  for (let k = 0; k < n; k++) {
    if (typeof byCount[k] === 'number' && byCount[k] > L) break;
    /** @type {Array<{id:string, w:number}>} */
    const cands = [];
    for (const a of MON_AFFIXES) {
      if (a.minLevel > L || picked.includes(a.id)) continue;
      if (a.excludeTags.some(t => tags.includes(t))) continue;
      if (picked.some(id => a.excludeAffixes.includes(id) || (MON_AFFIXES_BY_ID[id]?.excludeAffixes ?? []).includes(a.id))) continue;
      cands.push({ id: a.id, w: a.weight });
    }
    const id = rng.pick(cands);
    if (!id) break;
    picked.push(id);
  }
  return picked;
}

/** 정예 이름 → [elite.a.N, elite.b.M](문자열 키 · 부록 B) @param {Rng} rng @returns {string[]} */
export function eliteName(rng) {
  return ['elite.a.' + rng.int(0, ELITE_NAMES.a - 1), 'elite.b.' + rng.int(0, ELITE_NAMES.b - 1)];
}

/** 하수인이 받는 속성 — 정예 속성 중 minionShare 인 것 전부(순서 유지) @param {string[]} affixes */
export function minionAffixes(affixes) {
  return affixes.filter(id => MON_AFFIXES_BY_ID[id]?.minionShare);
}

// ───────────────────────── 배치 ─────────────────────────

/**
 * 구성원 자리 — (cx, cz)에서 rMin..rMax 떨어진 무작위 점 중 반지름 r 이 들어가고 이미 놓은 구성원과 겹치지 않는 첫 점(tries 번).
 * 없으면 가장 가까운 걷기 가능 점(그것도 없으면 중심).
 * @param {MapData} map @param {Rng} rng @param {number} cx @param {number} cz @param {number} rMin @param {number} rMax @param {number} r
 * @param {Array<{x:number, z:number, r:number}>} placed
 */
function placeMember(map, rng, cx, cz, rMin, rMax, r, placed) {
  for (let t = 0; t < PACK_PLACE.tries; t++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(rMin, rMax);
    const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
    if (!isWalkableR(map, x, z, r)) continue;
    let clash = false;
    for (const q of placed) {
      const gx = q.x - x, gz = q.z - z, need = q.r + r + PACK_PLACE.gap;
      if (gx * gx + gz * gz < need * need) { clash = true; break; }
    }
    if (clash) continue;
    return { x, z };
  }
  return nearestWalkable(map, cx + Math.sin(placed.length) * rMin, cz + Math.cos(placed.length) * rMin, rMax) ?? nearestWalkable(map, cx, cz, rMax) ?? { x: cx, z: cz };
}

/** 팩 상태 하나를 rift.packs 에 @param {SimCtx} ctx @param {PackState['kind']} kind @param {number} x @param {number} z @returns {PackState} */
function newPack(ctx, kind, x, z) {
  /** @type {PackState} */
  const pack = { id: ctx.nextId(), kind, memberIds: [], awake: false, nextHazardAt: -1, fled: false, anchor: { x, z } };
  /** @type {import('../../types.js').RiftState} */ (ctx.state.rift).packs.push(pack);
  return pack;
}

/**
 * 구성원 목록 → 몬스터(잠든 채 · 팩에 잇는다)
 * @param {SimCtx} ctx @param {MapData} map @param {Rng} rng @param {PackState} pack @param {number} level
 * @param {Array<{typeId:string, rank:MonRank, affixes:string[], name?:string[]|null, center?:boolean, rMin:number, rMax:number}>} list
 */
function placePack(ctx, map, rng, pack, level, list) {
  /** @type {Array<{x:number, z:number, r:number}>} */
  const placed = [];
  const cx = pack.anchor.x, cz = pack.anchor.z;
  for (const it of list) {
    const def = getMonDef(it.typeId);
    const r = def.radius * getRank(it.rank).scale;
    let pos;
    if (it.center) {
      pos = isWalkableR(map, cx, cz, r) && !placed.length ? { x: cx, z: cz } : placeMember(map, rng, cx, cz, 0, it.rMax, r, placed);
    } else {
      pos = placeMember(map, rng, cx, cz, it.rMin, it.rMax, r, placed);
    }
    placed.push({ x: pos.x, z: pos.z, r });
    const facing = rng.range(-Math.PI, Math.PI);
    const mon = spawnMonster(ctx, { typeId: it.typeId, rank: it.rank, level, affixes: it.affixes, packId: pack.id, x: pos.x, z: pos.z, facing, awake: false });
    if (it.name) mon.name = it.name;
    pack.memberIds.push(mon.id);
  }
}

// ───────────────────────── 팩 구성 ─────────────────────────

/** 일반 팩 구성원(PackDef 행 · 구성원마다 min..max) @param {Rng} rng @param {import('../../types.js').PackDef} def */
function normalMembers(rng, def) {
  const out = [];
  for (const mm of def.members) {
    const n = rng.int(mm.min, mm.max);
    for (let i = 0; i < n; i++) out.push({ typeId: mm.typeId, rank: /** @type {MonRank} */ ('normal'), affixes: [], rMin: PACK_PLACE.normalR[0], rMax: PACK_PLACE.normalR[1] });
  }
  return out;
}

/** 챔피언 팩 — 같은 종 min..max(종류별 상한) · 구성원이 같은 속성 @param {Rng} rng @param {string} typeId @param {string[]} affixes */
function championMembers(rng, typeId, affixes) {
  const cp = ELITE_PACK.champion;
  const max = Math.max(cp.min, Math.min(cp.max, /** @type {any} */ (cp.maxByType)?.[typeId] ?? cp.max));
  const n = rng.int(cp.min, max);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ typeId, rank: /** @type {MonRank} */ ('champion'), affixes: [...affixes], rMin: ELITE_PACK.placeR[0], rMax: ELITE_PACK.placeR[1] });
  return out;
}

/** 정예 1(가운데 · 이름) + 하수인 minions(같은 종 · minionShare 속성) @param {Rng} rng @param {string} typeId @param {string[]} affixes @param {string[]} name */
function eliteMembers(rng, typeId, affixes, name) {
  const [lo, hi] = ELITE_PACK.elite.minions;
  const n = rng.int(lo, hi);
  const mAff = minionAffixes(affixes);
  const out = [{ typeId, rank: /** @type {MonRank} */ ('elite'), affixes: [...affixes], name, center: true, rMin: 0, rMax: ELITE_PACK.placeR[0] }];
  for (let i = 0; i < n; i++) out.push({ typeId, rank: /** @type {MonRank} */ ('minion'), affixes: [...mAff], rMin: PACK_PLACE.minionR[0], rMax: PACK_PLACE.minionR[1] });
  return out;
}

/** 타일셋 · 레벨의 일반 팩 가중치(minLevel ≤ L — 데이터 순서) @param {string} tileset @param {number} level @returns {Array<{id:string, w:number}>} */
function packWeights(tileset, level) {
  const tw = /** @type {any} */ (TILESET_PACKS)[tileset] ?? TILESET_PACKS[/** @type {keyof typeof TILESET_PACKS} */ (Object.keys(TILESET_PACKS)[0])];
  const out = [];
  for (const id of Object.keys(tw)) {
    const def = PACKS_BY_ID[id];
    if (def && def.minLevel <= level && tw[id] > 0) out.push({ id, w: tw[id] });
  }
  if (!out.length) out.push({ id: PACKS[0].id, w: 1 });
  return out;
}

/**
 * 팩 자리 종류 — 지도의 kind 를 따르되 riftRow 의 챔피언 · 정예 팩 수에 맞춘다: 남는 champion/elite 자리는 normal 로,
 * 모자라면 depth ≥ MAPGEN.eliteMinDepth 인 normal 자리를 깊은 순(같으면 id 순)으로 올린다(정예 먼저).
 * @param {PackSlot[]} slots @param {{championPacks:number, elitePacks:number}} row @returns {Array<'normal'|'champion'|'elite'>}
 */
export function slotKinds(slots, row) {
  /** @type {Array<'normal'|'champion'|'elite'>} */
  const kinds = slots.map(s => (s.kind === 'champion' || s.kind === 'elite' ? s.kind : 'normal'));
  const want = { elite: row.elitePacks, champion: row.championPacks };
  for (const k of /** @type {const} */ (['elite', 'champion'])) {
    let have = 0;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== k) continue;
      have += 1;
      if (have > want[k]) kinds[i] = 'normal';
    }
  }
  for (const k of /** @type {const} */ (['elite', 'champion'])) {
    let have = kinds.filter(x => x === k).length;
    if (have >= want[k]) continue;
    const cands = [];
    for (let i = 0; i < slots.length; i++) if (kinds[i] === 'normal' && (slots[i].depth ?? 0) >= MAPGEN.eliteMinDepth) cands.push(i);
    cands.sort((a, b) => (slots[b].depth ?? 0) - (slots[a].depth ?? 0) || slots[a].id - slots[b].id);
    for (const i of cands) {
      if (have >= want[k]) break;
      kinds[i] = k;
      have += 1;
    }
  }
  return kinds;
}

/**
 * 균열 채우기 — map.packSlots → 팩 · 몬스터(잠든 채) · rift.guardianType. 채우기 난수(§5.14: makeRng(seedRng(hash32(seed, level, 2))))로만 —
 * 같은 seed · level 이면 같은 팩 · 몬스터. normal 자리: 타일셋 · 레벨의 PACKS 가중치로 팩 하나 · champion: ELITE_PACK.types 종 · riftRow.champAffixes ·
 * elite: 정예 1(이름) + 하수인 3~5(minionShare 속성) · riftRow.eliteAffixes. MON_SPAWNED 는 내지 않는다(§4.2).
 * @param {SimCtx} ctx
 */
export function populateRift(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const map = ctx.riftMap ?? ctx.map;
  if (!rift || !map) return;
  const level = rift.level;
  const rng = makeRng(seedRng(hash32(rift.seed, level, FILL_STREAM)));
  rift.guardianType = /** @type {string} */ (rng.pick(GUARDIAN_WEIGHTS) ?? Object.keys(GUARDIAN_WEIGHTS)[0]);
  const row = riftRow(level);
  const slots = map.packSlots ?? [];
  const kinds = slotKinds(slots, row);
  const weights = packWeights(rift.tileset, level);
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const kind = kinds[i];
    const at = nearestWalkable(map, slot.x, slot.z, ELITE_PACK.placeR[1]) ?? { x: slot.x, z: slot.z };
    const pack = newPack(ctx, kind, at.x, at.z);
    if (kind === 'normal') {
      const def = PACKS_BY_ID[/** @type {string} */ (rng.pick(weights))] ?? PACKS[0];
      placePack(ctx, map, rng, pack, level, normalMembers(rng, def));
    } else {
      const typeId = /** @type {string} */ (rng.pick(ELITE_PACK.types));
      const tdef = getMonDef(typeId);
      if (kind === 'champion') {
        placePack(ctx, map, rng, pack, level, championMembers(rng, typeId, rollAffixes(rng, tdef, row.champAffixes, level)));
      } else {
        const affixes = rollAffixes(rng, tdef, row.eliteAffixes, level);
        placePack(ctx, map, rng, pack, level, eliteMembers(rng, typeId, affixes, eliteName(rng)));
      }
    }
  }
}

/**
 * 디버그 · 측정용 팩 하나(rng.ai) → packId. rank champion: 챔피언 팩(2~4 · 종류별 상한) · elite: 정예(+ 하수인) · guardian: 수호자 하나(팩 kind guardian ·
 * impl 상태는 수호자 think 가 처음 돌 때 잡는다) · 그 밖(normal 등): 그 종의 팩 하나(PACKS 에서 그 종의 min..max · 없으면 1).
 * affixes 가 null 이면 riftRow(L)의 수만큼 굴린다. awake 면 깨운다(MON_WAKE · 'debug'). x, z 는 팩 자리.
 * @param {SimCtx} ctx @param {{typeId:string, rank:MonRank|string, affixes?:string[]|null, x:number, z:number, awake?:boolean}} opts @returns {number}
 */
export function spawnPack(ctx, { typeId, rank, affixes = null, x, z, awake = false }) {
  const st = ctx.state;
  const rift = st.rift;
  const map = ctx.map;
  if (!rift || !map) return -1;
  let tdef;
  try { tdef = getMonDef(typeId); } catch { return -1; }
  const rng = ctx.rng.ai;
  const level = rift.level;
  const row = riftRow(level);
  const at = nearestWalkable(map, x, z, ELITE_PACK.placeR[1]) ?? { x, z };
  const rk = /** @type {MonRank} */ (rank ?? 'normal');
  /** @type {PackState['kind']} */
  const kind = rk === 'champion' || rk === 'elite' || rk === 'guardian' ? rk : 'normal';
  const pack = newPack(ctx, kind, at.x, at.z);
  let list;
  if (rk === 'champion') {
    list = championMembers(rng, typeId, affixes ?? rollAffixes(rng, tdef, row.champAffixes, level));
  } else if (rk === 'elite') {
    list = eliteMembers(rng, typeId, affixes ?? rollAffixes(rng, tdef, row.eliteAffixes, level), eliteName(rng));
  } else if (rk === 'guardian') {
    list = [{ typeId, rank: rk, affixes: affixes ?? rollAffixes(rng, tdef, row.guardianAffixes, level), center: true, rMin: 0, rMax: ELITE_PACK.placeR[0] }];
  } else {
    let n = 1;
    for (const pd of PACKS) {
      const mm = pd.members.find(m => m.typeId === typeId);
      if (mm) { n = rng.int(mm.min, mm.max); break; }
    }
    list = [];
    for (let i = 0; i < n; i++) list.push({ typeId, rank: rk, affixes: affixes ? [...affixes] : [], rMin: PACK_PLACE.normalR[0], rMax: PACK_PLACE.normalR[1] });
  }
  placePack(ctx, map, rng, pack, level, list);
  if (awake) {
    let n = 0, fx = at.x, fz = at.z;
    for (const id of pack.memberIds) {
      const m = rift.mons.find(mm => mm.id === id);
      if (m && wakeMonster(ctx, m)) {
        if (n === 0) { fx = m.pos.x; fz = m.pos.z; }
        n += 1;
      }
    }
    pack.awake = n > 0;
    if (n > 0) ctx.emit(EV.MON_WAKE, { packId: pack.id, kind: pack.kind, x: fx, z: fz, count: n });
  }
  return pack.id;
}
