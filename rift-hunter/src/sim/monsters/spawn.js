// OWNER: P3 — 계약 §6.9 · §5.6(몬스터 수치) · §5.17-4·5 · §8.2
// 몬스터 생성 · 수치 · 공격 시작(빠름 규칙) · 수호자 자리 + 행동 · 훅 파일이 함께 쓰는 순수 도우미.
// 레지스트리(affixHooks/index.js · guardians/index.js)와 monsters.js 를 import 하지 않는다(§2.2 — 순환 · TDZ). 스폰 직후 속성 onSpawn 은 ctx.hooks.onMonSpawn.
// 프레임워크 파일이다 — 콘텐츠 ID 로 분기하지 않는다(차이는 데이터 필드 · 훅 이름으로만).
// 훅 파일(affixHooks/* · guardians/*)과 behaviors.js 가 여기의 도우미를 쓴다: attackOf · attackReady · firstMelee · meleeStartOk · meleeHitOk ·
//   monSpec · strikeDefault · wakeMonster · packOf · packRep · isDisabled · isAttackAct · playerDist · seesPlayer · mcd(쿨다운 남음).

import { DMG_TYPES } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { deg2rad, yawOf } from '../../core/math.js';
import { overlaps } from '../../core/shapes.js';
import { secOf, ticks } from '../../core/time.js';
import { STATUS } from '../../data/combat.js';
import { GUARDIANS, GUARDIAN_SPOT } from '../../data/guardians.js';
import { MON_AFFIXES_BY_ID, getMonDef, getRank } from '../../data/index.js';
import { MON } from '../../data/monsters.js';
import { earlyDmgMul, riftRow } from '../../data/rift.js';
import { monsterHitPlayer } from '../combat.js';
import { addMonster, getMonster } from '../entities.js';
import { spawnProjectile } from '../projectiles.js';
import { createMonStatus } from '../state.js';
import { isWalkableR, losClear, nearestWalkable } from '../world/nav.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../../types.js').AttackDef} AttackDef */
/** @typedef {import('../../types.js').MonRank} MonRank */
/** @typedef {import('../../types.js').PlayerState} PlayerState */
/** @typedef {import('../../types.js').PackState} PackState */
/** @typedef {import('../../types.js').MonAttackSpec} MonAttackSpec */

/** 공격 중인 행동(예비 · 시전 · 채널 · 돌진 · 부풀기 · 판정 · 후딜) */
const ATTACK_ACTS = new Set(['windup', 'cast', 'channel', 'charge', 'swell', 'strike', 'recover']);
/** 판정 전 행동 — actHit 틱에 strike 가 한 번 돈다 */
const PRE_HIT_ACTS = new Set(['windup', 'cast', 'channel', 'swell']);
/** 상태 이상이 정한 행동(깨울 때 · 잠재울 때 건드리지 않는다) */
const DISABLED_ACTS = new Set(['stunned', 'frozen', 'flinch']);
/** 빠름(atkSpeedMul)을 예비에 곱하지 않는 예고 — 바닥 표식(그 효과의 예고 길이 · H5) */
const GROUND_TELEGRAPHS = new Set(['groundLine', 'groundCircle']);

/** 근접 판정용 원뿔(재사용 — 매 판정 할당하지 않는다) @type {import('../../types.js').Shape} */
const CONE = { type: 'cone', x: 0, z: 0, r: 0, facing: 0, angle: 0 };

// ───────────────────────── 수치 · 생성 ─────────────────────────

/**
 * 순수 — 몬스터 수치(§5.6): hpMax = MON.hpBase × type.hp × rank.hp × row.hpMul × Π affix.hpMul · dmg = MON.dmgBase × type.dmg × rank.dmg × row.dmgMul × earlyDmgMul(L)(W1 수정 2) ·
 * res[t] = min(MON.resCap, type.res[t] + Σ affix.res[t])(수호자는 속성 res 를 받지 않는다) · r · height = def × rank.scale(이미 곱한 값) ·
 * speed = def.speed × Π speedMul · atkSpeedMul = Π affix.atkSpeedMul · immune = 속성 mods.immune 합집합
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
    dmg: MON.dmgBase * def.dmg * rk.dmg * row.dmgMul * earlyDmgMul(row.level),   // W1 수정 2: × 첫 판 경사(균열 1~4 · §7.3)
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
 * 몬스터 하나를 만들어 rift.mons 에 넣는다 — mods 적용(monsterStats) → ctx.hooks.onMonSpawn(속성 onSpawn) → reason 이 있으면 MON_SPAWNED.
 * 수호자는 typeId = GUARDIANS 키(getMonDef). 팩 memberIds 에 잇는 것은 부르는 쪽이 한다.
 * @param {SimCtx} ctx
 * @param {{typeId:string, rank:MonRank, level:number, affixes?:string[], packId?:number, x:number, z:number, facing?:number, awake?:boolean, reason?:string|null, flags?:Object}} opts
 * @returns {MonsterState}
 */
export function spawnMonster(ctx, { typeId, rank, level, affixes = [], packId = -1, x, z, facing = 0, awake = false, reason = null, flags = {} }) {
  const lv = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  const s = monsterStats(typeId, rank, lv, affixes);
  /** @type {Object<string, Object>} */
  const ax = {};
  if (awake) {
    ax.b = { move: 'chase', spd: 1, wokeAt: ctx.state.tick };
    for (const id of affixes) ax[id] = {};
  }
  /** @type {MonsterState} */
  const mon = {
    id: ctx.nextId(),
    typeId,
    rank,
    packId,
    level: lv,
    affixes: [...affixes],
    name: null,
    pos: { x, z },
    prevPos: { x, z },
    facing: Number.isFinite(facing) ? facing : 0,
    vel: { x: 0, z: 0 },
    r: s.r,
    height: s.height,
    scale: s.scale,
    hp: s.hpMax,
    hpMax: s.hpMax,
    dmg: s.dmg,
    speed: s.speed,
    res: /** @type {any} */ (s.res),
    awake: !!awake,
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
    ax,
    flags: { noXp: false, noDrops: false, noGauge: false, revived: false, ...flags },
    lastHit: null,
    sleepAt: -1,
  };
  addMonster(ctx, mon);
  // W1 수정(NOTES-W1FIX · §3.7 RiftState.homes): 처음 놓인 자리 — 사망 진정 뒤 부활로 떠날 때 돌아간다(rift.settleOnRespawn)
  const homes = ctx.state.rift?.homes;
  if (homes) homes[mon.id] = { x, z, facing: mon.facing };
  ctx.hooks.onMonSpawn(ctx, mon);
  if (reason) ctx.emit(EV.MON_SPAWNED, { id: mon.id, typeId, rank, x, z, reason });
  return mon;
}

// ───────────────────────── 공격 ─────────────────────────

/** 행 · 공격 ID → AttackDef|null @param {MonsterDef} def @param {string|null} id @returns {AttackDef|null} */
export function attackOf(def, id) {
  if (!id) return null;
  const list = def.attacks;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** 첫 근접 공격(정지 거리 · 기본 공격) @param {MonsterDef} def @returns {AttackDef|null} */
export function firstMelee(def) {
  const list = def.attacks;
  for (let i = 0; i < list.length; i++) if (list[i].kind === 'melee') return list[i];
  return null;
}

/** 쿨다운이 끝났다 @param {MonsterState} mon @param {AttackDef} atk @param {number} tick */
export function attackReady(mon, atk, tick) {
  const r = mon.readyAt[atk.id];
  return !(typeof r === 'number' && tick < r);
}

/** 공격 중인 행동인가 @param {string} act */
export function isAttackAct(act) { return ATTACK_ACTS.has(act); }
/** 판정 전 행동인가(actHit 에 strike) @param {string} act */
export function isPreHitAct(act) { return PRE_HIT_ACTS.has(act); }

/** 기절 · 빙결 · 경직 중(상태의 시각으로 본다 — act 는 status.js 가 다음 단계에서 맞춘다) @param {MonsterState} mon @param {number} tick */
export function isDisabled(mon, tick) {
  const s = mon.st;
  return s.stunUntil > tick || s.freezeUntil > tick || s.flinchUntil > tick;
}

/** 속성 공격 속도 배율(빠름) — Π mods.atkSpeedMul @param {MonsterState} mon */
export function affixAtkMul(mon) {
  let k = 1;
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const m = MON_AFFIXES_BY_ID[list[i]]?.mods?.atkSpeedMul;
    if (m > 0) k *= m;
  }
  return k;
}

/** 바닥 표식 · 시전(그 효과의 예고)인 공격 — 빠름이 예비를 줄이지 않는다(§5.17-5) @param {AttackDef} atk */
export function isGroundAttack(atk) {
  return GROUND_TELEGRAPHS.has(atk.telegraph) || atk.kind === 'cast';
}

/**
 * 예비 시작(§5.17-5). 길이 = windup / atkSpeed — 속성 atkSpeedMul(빠름)은 telegraph pose · aimLine · glow 의 예비 · 후딜에만 곱하고,
 * groundLine · groundCircle · kind cast 의 예비(= 그 효과의 예고 길이)는 데이터 값 그대로(빠름은 쿨다운만 ÷) · 몬스터 냉기 감속(× (1 − chillSlow))은 모두에 곱한다(늘어난다).
 * actHit ≥ 시작 + 1틱 · actEnd ≥ actHit + 1틱 · readyAt = 시작 + cd ÷ atkSpeedMul · facing 은 시작 때 고정(기본 = 플레이어 쪽) · MON_ACT.
 * @param {SimCtx} ctx @param {MonsterState} mon @param {string} atkId
 * @param {{act?:string, facing?:number, aim?:{x:number, z:number}|null, lockAim?:boolean}} [opts]  (P3 W1 — 선택: 행동 이름 · facing · 조준점 고정)
 * @returns {number} 예비 길이(초 — 그 틱에 만드는 효과의 delay) · 공격이 없으면 0
 */
export function startAttack(ctx, mon, atkId, opts = {}) {
  const def = getMonDef(mon.typeId);
  const atk = attackOf(def, atkId);
  if (!atk) return 0;
  const tick = ctx.state.tick;
  const aff = affixAtkMul(mon);
  const chill = mon.st.chill > 0 ? 1 - STATUS.chillSlow : 1;
  const k = (isGroundAttack(atk) ? 1 : aff) * chill;
  const wT = Math.max(1, ticks(atk.windup / k));
  const rT = Math.max(1, ticks(atk.recover / k));
  mon.act = /** @type {any} */ (opts.act ?? (atk.kind === 'cast' ? 'cast' : atk.kind === 'explode' ? 'swell' : 'windup'));
  mon.actId = atk.id;
  mon.actStart = tick;
  mon.actHit = tick + wT;
  mon.actEnd = mon.actHit + rT;
  mon.readyAt[atk.id] = tick + ticks(atk.cd / aff);
  const p = ctx.state.player.pos;
  if (typeof opts.facing === 'number' && Number.isFinite(opts.facing)) mon.facing = opts.facing;
  else {
    const dx = p.x - mon.pos.x, dz = p.z - mon.pos.z;
    if (dx !== 0 || dz !== 0) mon.facing = yawOf(dx, dz);
  }
  if (opts.aim) mon.aim = { x: opts.aim.x, z: opts.aim.z };
  else mon.aim = atk.kind === 'projectile' || atk.kind === 'charge' ? { x: p.x, z: p.z } : null;
  mon.aimLocked = !!opts.lockAim;
  mon.vel.x = 0;
  mon.vel.z = 0;
  const dur = secOf(wT);
  ctx.emit(EV.MON_ACT, {
    id: mon.id, typeId: mon.typeId, act: mon.act, actId: atk.id, telegraph: atk.telegraph, x: mon.pos.x, z: mon.pos.z, facing: mon.facing, dur,
  });
  return dur;
}

/** 근접 원뿔(반지름 R · 지금 facing · 공격의 coneDeg)에 플레이어 몸이 닿는가 @param {MonsterState} mon @param {AttackDef} atk @param {PlayerState} p @param {number} R */
function coneReaches(mon, atk, p, R) {
  CONE.x = mon.pos.x;
  CONE.z = mon.pos.z;
  CONE.r = R;
  CONE.facing = mon.facing;
  CONE.angle = deg2rad(atk.coneDeg ?? 0);
  return overlaps(CONE, p.pos.x, p.pos.z, p.r);
}

/**
 * 근접 공격을 시작해도 되는가 — 중심 거리 ≤ mon.r + reach + player.r(관용 없음 · §7.4) 이고 지금 facing 의 원뿔(coneDeg — 몸 반지름 여유 포함) 안
 * @param {MonsterState} mon @param {AttackDef} atk @param {PlayerState} p
 */
export function meleeStartOk(mon, atk, p) {
  if (!atk || atk.kind !== 'melee' || p.dead) return false;
  return coneReaches(mon, atk, p, mon.r + (atk.reach ?? 0));
}

/**
 * 근접 판정 — 중심 거리 ≤ mon.r + reach + player.r + MON.reachTolerance(0.3) 이고 공격 시작 때 고정한 facing 의 원뿔 안(§5.17-4)
 * @param {MonsterState} mon @param {AttackDef} atk @param {PlayerState} p
 */
export function meleeHitOk(mon, atk, p) {
  if (!atk || p.dead) return false;
  return coneReaches(mon, atk, p, mon.r + (atk.reach ?? 0) + MON.reachTolerance);
}

/**
 * MonAttackSpec — raw = mon.dmg × mul · 몬스터 레벨 · push · onHit(있으면)
 * @param {MonsterState} mon @param {AttackDef} atk @param {MonAttackSpec['via']} via @param {number} [mul] (기본 atk.mul)
 * @returns {MonAttackSpec}
 */
export function monSpec(mon, atk, via, mul = atk.mul) {
  /** @type {MonAttackSpec} */
  const s = { srcId: mon.id, via, raw: mon.dmg * mul, type: atk.type, level: mon.level };
  if (atk.push > 0) s.push = atk.push;
  if (atk.onHit) s.onHit = { ...atk.onHit };
  return s;
}

/**
 * 프레임워크 기본 strike(§5.17-4) — 근접: meleeHitOk 면 monsterHitPlayer(via 'melee') · 원거리: 조준점(aim — 없으면 플레이어) 쪽으로 투사체.
 * 그 밖의 kind(돌진 · 폭발 · 소환 · 시전)는 행동 · 훅의 strike 가 맡는다.
 * @param {SimCtx} ctx @param {MonsterState} mon @param {MonsterDef} def @param {AttackDef} atk
 */
export function strikeDefault(ctx, mon, def, atk) {
  const p = ctx.state.player;
  if (atk.kind === 'melee') {
    if (meleeHitOk(mon, atk, p)) monsterHitPlayer(ctx, mon, monSpec(mon, atk, 'melee'));
    return;
  }
  if (atk.kind === 'projectile' && atk.proj) {
    const ax = mon.aim ? mon.aim.x : p.pos.x, az = mon.aim ? mon.aim.z : p.pos.z;
    const dx = ax - mon.pos.x, dz = az - mon.pos.z;
    const facing = dx !== 0 || dz !== 0 ? yawOf(dx, dz) : mon.facing;
    spawnProjectile(ctx, {
      visual: atk.proj.visual, owner: 'mon', srcId: mon.id, x: mon.pos.x, z: mon.pos.z, facing,
      speed: atk.proj.speed, life: atk.proj.life, r: atk.proj.r, spec: monSpec(mon, atk, 'projectile'),
    });
  }
}

// ───────────────────────── 깨우기 · 팩 · 거리 ─────────────────────────

/**
 * 몬스터 하나를 깨운다(팩 · 이벤트 · 상한은 부르는 쪽 — monsters.wakePack · packs.spawnPack). 깰 때마다 행동 상태(ax.b)와 속성 상태(ax[id])를 새로 —
 * 속성의 「깬 뒤 first」는 훅이 첫 onAwakeTick 에서 st 가 비어 있으면 잡는다. 수호자 상태(ax.g)는 남긴다. 상태 이상 행동은 그대로.
 * @param {SimCtx} ctx @param {MonsterState} mon @returns {boolean} 깨웠다
 */
export function wakeMonster(ctx, mon) {
  if (!mon || mon.awake || mon.dead || mon.gone || mon.hp <= 0) return false;
  const tick = ctx.state.tick;
  mon.awake = true;
  mon.sleepAt = -1;
  /** @type {Object<string, Object>} */
  const ax = {};
  if (mon.ax && mon.ax.g) ax.g = mon.ax.g;
  ax.b = { move: 'chase', spd: 1, wokeAt: tick };
  for (const id of mon.affixes) ax[id] = {};
  mon.ax = ax;
  if (!DISABLED_ACTS.has(mon.act)) {
    mon.act = 'idle';
    mon.actId = null;
    mon.aim = null;
    mon.aimLocked = false;
  }
  return true;
}

/** 잠재우기(그 자리에서 · 생명 유지) — 공격 · 이동 · 도망 · 사라짐은 멈춘다 @param {MonsterState} mon */
export function sleepMonster(mon) {
  mon.awake = false;
  mon.targeting = false;
  mon.sleepAt = -1;
  if (!DISABLED_ACTS.has(mon.act) && mon.act !== 'dead') {
    mon.act = 'idle';
    mon.actId = null;
  }
  mon.aim = null;
  mon.aimLocked = false;
  mon.vel.x = 0;
  mon.vel.z = 0;
}

/** 팩 상태(없으면 null) @param {SimCtx} ctx @param {number} packId @returns {PackState|null} */
export function packOf(ctx, packId) {
  const rift = ctx.state.rift;
  if (!rift || !(packId >= 0)) return null;
  const packs = rift.packs;
  for (let i = 0; i < packs.length; i++) if (packs[i].id === packId) return packs[i];
  return null;
}

/** 살아 있다(생명 > 0 · dead · gone 아님) @param {MonsterState|null|undefined} m */
export function aliveMon(m) {
  return !!m && !m.gone && !m.dead && m.hp > 0;
}

/**
 * 팩의 대표(§5.17-7) — memberIds 중 살아 있고 rank 가 minion 이 아닌 첫째(죽으면 다음) · 팩이 없으면 자기(하수인이 아니면). 없으면 -1
 * @param {SimCtx} ctx @param {MonsterState} mon @returns {number} 대표 몬스터 ID
 */
export function packRep(ctx, mon) {
  const pack = packOf(ctx, mon.packId);
  if (!pack) return mon.rank === 'minion' ? -1 : mon.id;
  const ids = pack.memberIds;
  for (let i = 0; i < ids.length; i++) {
    const m = getMonster(ctx, ids[i]);
    if (aliveMon(m) && /** @type {MonsterState} */ (m).rank !== 'minion') return ids[i];
  }
  return -1;
}

/** 플레이어까지 중심 거리(m) @param {SimCtx} ctx @param {MonsterState} mon */
export function playerDist(ctx, mon) {
  const p = ctx.state.player.pos;
  return Math.hypot(p.x - mon.pos.x, p.z - mon.pos.z);
}

/** 플레이어가 보인다(벽 — props 면 막는 소품도 · 투사체를 쏘기 전에는 props) @param {SimCtx} ctx @param {MonsterState} mon @param {boolean} [props] */
export function seesPlayer(ctx, mon, props = false) {
  const map = ctx.map;
  if (!map) return true;
  const p = ctx.state.player.pos;
  return losClear(map, mon.pos.x, mon.pos.z, p.x, p.z, { props });
}

/** 공격 쿨다운이 남은 틱(0 = 준비) @param {MonsterState} mon @param {string} atkId @param {number} tick */
export function mcd(mon, atkId, tick) {
  const r = mon.readyAt[atkId];
  return typeof r === 'number' && r > tick ? r - tick : 0;
}

// ───────────────────────── 수호자 자리 ─────────────────────────

/**
 * 수호자 출현 자리 — 플레이어에서 GUARDIAN_SPOT.min..max(8~10m) · 수호자 몸이 들어가는 걷기 가능 점 · 플레이어에서 시야(벽).
 * 플레이어가 보는 쪽부터 좌우로 번갈아 steps 방향 × 거리 셋(mid · min · max)을 본다(결정적 — 난수 없음). 없으면 가장 가까운 걷기 가능 점 · 그것도 없으면 플레이어 자리.
 * @param {SimCtx} ctx @returns {import('../../types.js').Vec2}
 */
export function findGuardianSpot(ctx) {
  const st = ctx.state;
  const p = st.player;
  const map = ctx.riftMap ?? ctx.map;
  const px = p.pos.x, pz = p.pos.z;
  if (!map) return { x: px, z: pz + GUARDIAN_SPOT.min };
  const typeId = st.rift?.guardianType ?? GUARDIANS[0].id;
  let r = 0;
  try { r = getMonDef(typeId).radius * getRank('guardian').scale; } catch { r = GUARDIANS[0].radius; }
  const n = Math.max(1, GUARDIAN_SPOT.steps);
  const step = (Math.PI * 2) / n;
  const dists = [GUARDIAN_SPOT.mid, GUARDIAN_SPOT.min, GUARDIAN_SPOT.max];
  for (let k = 0; k < n; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const a = p.facing + side * Math.ceil(k / 2) * step;
    const sx = Math.sin(a), sz = Math.cos(a);
    for (const d of dists) {
      const x = px + sx * d, z = pz + sz * d;
      if (isWalkableR(map, x, z, r) && losClear(map, px, pz, x, z)) return { x, z };
    }
  }
  const fx = px + Math.sin(p.facing) * GUARDIAN_SPOT.min, fz = pz + Math.cos(p.facing) * GUARDIAN_SPOT.min;
  return nearestWalkable(map, fx, fz, GUARDIAN_SPOT.max) ?? nearestWalkable(map, px, pz, GUARDIAN_SPOT.max) ?? { x: px, z: pz };
}
