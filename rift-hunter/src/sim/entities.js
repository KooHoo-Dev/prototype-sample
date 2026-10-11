// OWNER: P0 — 계약 §6.4 · §5.14 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 엔티티 추가/찾기/제거 · 모양 질의. 배열에서 실제로 빼는 곳은 removeMarked(cleanup) 하나뿐이다 — 그 밖은 표시만(gone · until · end).

import { overlaps, shapeBounds } from '../core/shapes.js';
import { ticks } from '../core/time.js';
import { DEATH, PICKUP } from '../data/combat.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').Drop} Drop */
/** @typedef {import('../types.js').Proj} Proj */
/** @typedef {import('../types.js').Effect} Effect */
/** @typedef {import('../types.js').Shape} Shape */
/** @typedef {import('../types.js').MapObject} MapObject */

/** ctx → {ver, arr, map} — 몬스터 ID 색인(ctx.monVer 가 바뀌거나 목록 배열이 바뀌면 다시 만든다) */
const MON_INDEX = new WeakMap();

/**
 * ID 로 몬스터 찾기(gone · dead 도 돌려준다 — 부르는 쪽이 본다)
 * @param {SimCtx} ctx @param {number} id @returns {MonsterState|null}
 */
export function getMonster(ctx, id) {
  const rift = ctx.state.rift;
  if (!rift) return null;
  let idx = MON_INDEX.get(ctx);
  if (!idx || idx.ver !== ctx.monVer || idx.arr !== rift.mons) {
    const map = new Map();
    for (const m of rift.mons) map.set(m.id, m);
    idx = { ver: ctx.monVer, arr: rift.mons, map };
    MON_INDEX.set(ctx, idx);
  }
  return idx.map.get(id) ?? null;
}

/** rift.mons.push · ctx.monVer += 1 @param {SimCtx} ctx @param {MonsterState} mon @returns {MonsterState} */
export function addMonster(ctx, mon) {
  const rift = ctx.state.rift;
  if (!rift) return mon;
  rift.mons.push(mon);
  ctx.monVer += 1;
  return mon;
}

/** @param {MonsterState} m @param {any} exclude */
function isExcluded(m, exclude) {
  if (exclude === null || exclude === undefined) return false;
  if (typeof exclude === 'number') return m.id === exclude;
  if (typeof exclude === 'function') return !!exclude(m);
  if (Array.isArray(exclude)) return exclude.includes(m.id);
  if (exclude instanceof Set) return exclude.has(m.id);
  return false;
}

/**
 * 모양과 겹치는 몬스터(rift.mons 순서) — overlaps(shape, mon.pos, mon.r) · gone 제외.
 * alive: hp > 0 이고 dead 아님 · awakeOnly: ctx.space(깨어 있고 살아 있는 몬스터)로 거른다 · exclude: id | id[] | Set | (mon) => boolean
 * @param {SimCtx} ctx @param {Shape} shape
 * @param {{alive?:boolean, awakeOnly?:boolean, exclude?:any}} [opts]
 * @returns {MonsterState[]}
 */
export function monstersIn(ctx, shape, { alive = true, awakeOnly = false, exclude = null } = {}) {
  const rift = ctx.state.rift;
  if (!rift) return [];
  const out = [];
  const b = shapeBounds(shape);
  if (awakeOnly) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const r = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2;
    const ids = ctx.space.query(cx, cz, r);
    for (const id of ids) {
      const m = getMonster(ctx, id);
      if (!m || m.gone || !m.awake) continue;
      if (alive && (m.dead || m.hp <= 0)) continue;
      if (isExcluded(m, exclude)) continue;
      if (overlaps(shape, m.pos.x, m.pos.z, m.r)) out.push(m);
    }
    return out;
  }
  for (const m of rift.mons) {
    if (m.gone) continue;
    if (alive && (m.dead || m.hp <= 0)) continue;
    const x = m.pos.x, z = m.pos.z, r = m.r;
    if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
    if (isExcluded(m, exclude)) continue;
    if (overlaps(shape, x, z, r)) out.push(m);
  }
  return out;
}

/**
 * 중심 거리로 가장 가까운 살아 있는 몬스터(gone 제외 · maxR 안)
 * @param {SimCtx} ctx @param {number} x @param {number} z @param {number} maxR
 * @param {((mon:MonsterState) => boolean)|null} [filter]
 * @returns {MonsterState|null}
 */
export function nearestMonster(ctx, x, z, maxR, filter = null) {
  const rift = ctx.state.rift;
  if (!rift) return null;
  let best = null;
  let bestD2 = maxR * maxR;
  for (const m of rift.mons) {
    if (m.gone || m.dead || m.hp <= 0) continue;
    const dx = m.pos.x - x, dz = m.pos.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2) continue;
    if (filter && !filter(m)) continue;
    best = m;
    bestD2 = d2;
  }
  return best;
}

/** 깨어 있고 살아 있는(hp > 0) 몬스터 → ctx.space @param {SimCtx} ctx */
export function rebuildSpace(ctx) {
  ctx.space.clear();
  const rift = ctx.state.rift;
  if (!rift) return;
  for (const m of rift.mons) {
    if (m.gone || m.dead || !m.awake || m.hp <= 0) continue;
    ctx.space.insert(m.id, m.pos.x, m.pos.z, m.r);
  }
}

/** 깨어 있고 살아 있는 수 @param {SimCtx} ctx */
export function awakeCount(ctx) {
  const rift = ctx.state.rift;
  if (!rift) return 0;
  let n = 0;
  for (const m of rift.mons) if (!m.gone && !m.dead && m.hp > 0 && m.awake) n++;
  return n;
}

/** 살아 있는 수 @param {SimCtx} ctx */
export function aliveCount(ctx) {
  const rift = ctx.state.rift;
  if (!rift) return 0;
  let n = 0;
  for (const m of rift.mons) if (!m.gone && !m.dead && m.hp > 0) n++;
  return n;
}

/** @param {SimCtx} ctx @param {Proj} p @returns {Proj} */
export function addProj(ctx, p) {
  if (ctx.state.rift) ctx.state.rift.projs.push(p);
  return p;
}
/** @param {SimCtx} ctx @param {Effect} e @returns {Effect} */
export function addEffect(ctx, e) {
  if (ctx.state.rift) ctx.state.rift.effects.push(e);
  return e;
}
/** @param {SimCtx} ctx @param {Drop} d @returns {Drop} */
export function addDrop(ctx, d) {
  if (ctx.state.rift) ctx.state.rift.drops.push(d);
  return d;
}

/** ID 로 바닥 드랍 찾기 — gone(주웠다 · 사라졌다)이면 null @param {SimCtx} ctx @param {number} id @returns {Drop|null} */
export function getDrop(ctx, id) {
  const rift = ctx.state.rift;
  if (!rift) return null;
  for (const d of rift.drops) if (d.id === id) return d.gone ? null : d;
  return null;
}

/** drop.gone 표시(배열에서는 removeMarked 가 뺀다) @param {SimCtx} ctx @param {number} id @returns {boolean} 표시했다 */
export function removeDrop(ctx, id) {
  const rift = ctx.state.rift;
  if (!rift) return false;
  for (const d of rift.drops) {
    if (d.id === id) {
      if (d.gone) return false;
      d.gone = true;
      return true;
    }
  }
  return false;
}

/**
 * cleanup(§5.1-7)만 부른다 — gone · 시체 시간(DEATH.corpseSec) 지난 몬스터 · until ≤ tick 투사체 · end ≤ tick 효과 · gone 드랍을
 * 배열에서 뺀다(순서 유지) · 빠진 몬스터를 팩 memberIds 에서도 빼고, 구성원이 없는 팩은 지운다 · 몬스터가 빠졌으면 ctx.monVer += 1
 * @param {SimCtx} ctx
 */
export function removeMarked(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return;
  const tick = st.tick;
  const corpseT = ticks(DEATH.corpseSec);

  const removed = new Set();
  let w = 0;
  for (let i = 0; i < rift.mons.length; i++) {
    const m = rift.mons[i];
    if (m.gone || (m.dead && m.deadAt >= 0 && tick - m.deadAt >= corpseT)) {
      removed.add(m.id);
      continue;
    }
    rift.mons[w++] = m;
  }
  rift.mons.length = w;
  if (removed.size) {
    ctx.monVer += 1;
    let pw = 0;
    for (let i = 0; i < rift.packs.length; i++) {
      const p = rift.packs[i];
      p.memberIds = p.memberIds.filter(id => !removed.has(id));
      if (p.memberIds.length) rift.packs[pw++] = p;
    }
    rift.packs.length = pw;
  }

  compact(rift.projs, p => p.until <= tick);
  compact(rift.effects, e => e.end <= tick);
  compact(rift.drops, d => d.gone);
}

/** @template T @param {T[]} arr @param {(x:T) => boolean} drop */
function compact(arr, drop) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (!drop(arr[i])) arr[w++] = arr[i];
  arr.length = w;
}

/**
 * 상호작용 물체 → MapObject 꼴(복사본) | null.
 * 균열 장면: 'portal:<n>' → {id, kind:'riftPortal', portalKind, x, z, r, h: PICKUP.objectH, facing:0, look:'riftPortal'}
 * 그 밖: ctx.map.objects 에서 id(h 없으면 PICKUP.objectH)
 * @param {SimCtx} ctx @param {string} id @returns {MapObject|null}
 */
export function getObject(ctx, id) {
  const st = ctx.state;
  if (typeof id !== 'string') return null;
  if (id.startsWith('portal:')) {
    if (st.scene !== 'rift' || !st.rift) return null;
    for (const p of st.rift.portals) {
      if (p.id === id) {
        return { id: p.id, kind: 'riftPortal', portalKind: p.kind, x: p.pos.x, z: p.pos.z, facing: 0, r: p.r, h: PICKUP.objectH, look: 'riftPortal' };
      }
    }
    return null;
  }
  const objs = ctx.map?.objects;
  if (!objs) return null;
  for (const o of objs) {
    if (o.id === id) return { ...o, h: o.h ?? PICKUP.objectH };
  }
  return null;
}

/** = ctx.state.player @param {SimCtx} ctx */
export function playerRef(ctx) {
  return ctx.state.player;
}
