// OWNER: P3 — 계약 §6.9 · §5.6(몬스터 수치) · §8.2
// STUB — W0 에 완성으로 내는 것: monsterStats · spawnMonster(최소 부트 · 고정 상태) · startAttack 은 act · readyAt 만 · findGuardianSpot 은 플레이어 + (0, 8)
// 레지스트리(affixHooks/index.js · guardians/index.js)를 import 하지 않는다(§2.2 — 순환 · TDZ). 스폰 직후 속성 onSpawn 은 ctx.hooks.onMonSpawn.

import { DMG_TYPES } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { ticks } from '../../core/time.js';
import { MON_AFFIXES_BY_ID, getMonDef, getRank } from '../../data/index.js';
import { MON } from '../../data/monsters.js';
import { riftRow } from '../../data/rift.js';
import { addMonster } from '../entities.js';
import { createMonStatus } from '../state.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').MonRank} MonRank */

/**
 * 순수 — 몬스터 수치(§5.6): hpMax = MON.hpBase × type.hp × rank.hp × row.hpMul × Π affix.hpMul · dmg = MON.dmgBase × type.dmg × rank.dmg × row.dmgMul ·
 * res[t] = min(MON.resCap, type.res[t] + Σ affix.res[t])(수호자는 속성 res 를 받지 않는다) · r · height = def × rank.scale(이미 곱한 값)
 * @param {string} typeId @param {MonRank} rank @param {number} level @param {string[]} [affixes]
 * @returns {{hpMax:number, dmg:number, speed:number, r:number, height:number, scale:number, res:Record<string, number>, atkSpeedMul:number, immune:string[]}}
 */
export function monsterStats(typeId, rank, level, affixes = []) {
  const def = getMonDef(typeId);
  const rk = getRank(rank);
  const row = riftRow(level);
  let hpMul = 1, speedMul = 1, atkSpeedMul = 1;
  /** @type {Record<string, number>} */
  const resAdd = {};
  /** @type {string[]} */
  const immune = [];
  for (const id of affixes ?? []) {
    const a = MON_AFFIXES_BY_ID[id];
    if (!a) continue;
    const m = a.mods ?? {};
    if (m.hpMul) hpMul *= m.hpMul;
    if (m.speedMul) speedMul *= m.speedMul;
    if (m.atkSpeedMul) atkSpeedMul *= m.atkSpeedMul;
    if (m.res && rank !== 'guardian') for (const t of Object.keys(m.res)) resAdd[t] = (resAdd[t] ?? 0) + /** @type {any} */ (m.res)[t];
    for (const k of m.immune ?? []) if (!immune.includes(k)) immune.push(k);
  }
  /** @type {Record<string, number>} */
  const res = {};
  for (const t of DMG_TYPES) res[t] = Math.min(MON.resCap, (def.res?.[/** @type {import('../../types.js').DmgType} */ (t)] ?? 0) + (resAdd[t] ?? 0));
  return {
    hpMax: MON.hpBase * def.hp * rk.hp * row.hpMul * hpMul,
    dmg: MON.dmgBase * def.dmg * rk.dmg * row.dmgMul,
    speed: def.speed * speedMul,
    r: def.radius * rk.scale,
    height: def.height * rk.scale,
    scale: rk.scale,
    res,
    atkSpeedMul,
    immune,
  };
}

/**
 * 몬스터 하나를 만들어 rift.mons 에 넣는다 — mods 적용(monsterStats) → ctx.hooks.onMonSpawn(속성 onSpawn) → reason 이 있으면 MON_SPAWNED
 * @param {SimCtx} ctx
 * @param {{typeId:string, rank:MonRank, level:number, affixes?:string[], packId?:number, x:number, z:number, facing?:number, awake?:boolean, reason?:string|null, flags?:Object}} opts
 * @returns {MonsterState}
 */
export function spawnMonster(ctx, { typeId, rank, level, affixes = [], packId = -1, x, z, facing = 0, awake = false, reason = null, flags = {} }) {
  const s = monsterStats(typeId, rank, level, affixes);
  /** @type {MonsterState} */
  const mon = {
    id: ctx.nextId(),
    typeId,
    rank,
    packId,
    level,
    affixes: [...affixes],
    name: null,
    pos: { x, z },
    prevPos: { x, z },
    facing,
    vel: { x: 0, z: 0 },
    r: s.r,
    height: s.height,
    scale: s.scale,
    hp: s.hpMax,
    hpMax: s.hpMax,
    dmg: s.dmg,
    speed: s.speed,
    res: /** @type {any} */ (s.res),
    awake,
    targeting: false,
    act: 'idle',
    actId: null,
    actStart: 0,
    actHit: 0,
    actEnd: 0,
    aim: null,
    aimLocked: false,
    readyAt: {},
    st: createMonStatus(),
    knock: null,
    dead: false,
    deadAt: -1,
    gone: false,
    launch: null,
    ax: {},
    flags: { noXp: false, noDrops: false, noGauge: false, revived: false, ...flags },
    lastHit: null,
    sleepAt: -1,
  };
  addMonster(ctx, mon);
  ctx.hooks.onMonSpawn(ctx, mon);
  if (reason) ctx.emit(EV.MON_SPAWNED, { id: mon.id, typeId, rank, x, z, reason });
  return mon;
}

/**
 * STUB — 공격 예비 시작(빠름 규칙 · MON_ACT 는 P3). W0: act · actId · actStart/Hit/End · readyAt 만
 * @param {SimCtx} ctx @param {MonsterState} mon @param {string} atkId
 */
export function startAttack(ctx, mon, atkId) {
  const def = getMonDef(mon.typeId);
  const atk = def.attacks.find(a => a.id === atkId);
  if (!atk) return;
  const tick = ctx.state.tick;
  mon.act = atk.kind === 'cast' ? 'cast' : 'windup';
  mon.actId = atkId;
  mon.actStart = tick;
  mon.actHit = tick + Math.max(1, ticks(atk.windup));
  mon.actEnd = mon.actHit + ticks(atk.recover);
  mon.readyAt[atkId] = tick + ticks(atk.cd);
}

/** STUB — 수호자 출현 자리(플레이어에서 8~10m · 걷기 가능 · 시야). W0: 플레이어 + (0, 8) @param {SimCtx} ctx @returns {import('../../types.js').Vec2} */
export function findGuardianSpot(ctx) {
  const p = ctx.state.player.pos;
  return { x: p.x, z: p.z + 8 };
}
