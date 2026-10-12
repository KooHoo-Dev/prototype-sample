// OWNER: P15 — 계약 §12.1 「대상 · 스킬 · 피하기 · 생존 · 카이팅」 · §6.16
// 싸움의 결정: 대상 고르기(우선순위 / 거리 · 반응 지연 · 포기) → 피하기(알아챈 적대 예고 · 걸어서 → 이동 스킬) → 카이팅(원거리 클래스) →
// 바의 스킬을 「동작(behavior)별 규칙」으로(노드 ID 가 아니다 — 무작위 배분 빌드도 같은 규칙) → 기본 공격(좌클릭 누르고 있기).
// 입력은 사람과 같은 InputFrame 하나뿐이다 — 커서 · hover(src 'pick') · 좌클릭 · 스킬 칸 · 포션.

import { overlaps } from '../core/shapes.js';
import { segPointDist, yawOf } from '../core/math.js';
import { ticks } from '../core/time.js';
import { BOT_RULES } from '../data/bot.js';
import { getClass, getNode, getSkillDef } from '../data/index.js';
import { skillReady } from '../sim/player/skills.js';
import { flowDist } from '../sim/world/flow.js';
import { isWalkableR, losClear, raycastWalk } from '../sim/world/nav.js';
import { aliveMon, hasTag, inThreat, pathClearOfThreats } from './sense.js';

/** @typedef {import('../types.js').MonsterState} MonsterState */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('./sense.js').Sense} Sense */

/** 스킬을 고르는 차례(동작) — 방어 → 버프 → 이동 · 탈출 → 범위 → 단일. 같은 차례 안에서는 바 순서 */
export const BEH_ORDER = ['shield', 'buff', 'blink', 'quake', 'meteor', 'nova', 'leap', 'dash', 'spinSlash', 'spin', 'chain', 'fireball'];   // 피드백 1: cone → spinSlash
/** 피하기에 쓸 수 있는 이동 동작 */
export const MOVE_BEHS = ['leap', 'blink', 'dash'];
/** 정예급(「정예 대상」 · 「정예/수호자 6m 안」) */
const ELITE_RANKS = ['champion', 'elite', 'guardian'];
/** 정예 팩 한가운데(도약) — 정예 · 챔피언 · 하수인 */
const PACK_RANKS = ['champion', 'elite', 'minion'];
/** 카이팅 중에도 쓰는 동작(자기 둘레 · 탈출) */
const KITE_BEHS = ['shield', 'blink', 'nova', 'quake'];

const TAU = Math.PI * 2;

/**
 * 스킬 규칙이 보는 한 틱의 상황(순수 값 — skillRule 테스트가 직접 만든다)
 * @typedef {Object} Situation
 * @property {number} px @property {number} pz
 * @property {number} life        생명 비율 0..1
 * @property {number} resource
 * @property {boolean} combat     10m 안에 깨어 있는 몬스터
 * @property {Array<{x:number, z:number, r:number, rank:string, awake:boolean, melee:boolean, id:number}>} mons   보이는 살아 있는 몬스터
 * @property {{x:number, z:number, r:number, rank:string, id:number, d:number, los:boolean}|null} target
 * @property {number} meleeNear   kiteFrom 안의 깨어 있는 근접 종 수
 * @property {number} kiteCount   BOT.kiteCount(순간이동 규칙의 문턱)
 * @property {((x:number, z:number) => boolean)|null} walkable   그 점에 설 수 있는가(순간이동 반대쪽 · null 이면 늘 참)
 * @property {((x:number, z:number) => boolean)|null} [visible]  피드백 2 D8: 그 점이 플레이어 자리에서 벽(타일)에 가려지지 않는가(메테오 목표 · 없으면 늘 참)
 */

/** (x, z)에서 R 안(몸 r 포함)의 몬스터 수 @param {Situation} s @param {number} x @param {number} z @param {number} R */
export function countWithin(s, x, z, R) {
  let n = 0;
  for (const m of s.mons) {
    const d = Math.hypot(m.x - x, m.z - z);
    if (d <= R + m.r) n++;
  }
  return n;
}

/** 정예급이 R 안에 있는가 @param {Situation} s @param {number} R */
function eliteWithin(s, R) {
  for (const m of s.mons) if (ELITE_RANKS.includes(m.rank) && Math.hypot(m.x - s.px, m.z - s.pz) <= R + m.r) return m;
  return null;
}

/**
 * 동작별 사용 규칙(§12.1 표) — 쓸 때면 목표 {x, z, hover}(hover = 대상 몬스터 ID 또는 null) · 아니면 null. 준비됨(쿨다운 · 비용)은 부르는 쪽이 본다.
 * @param {string} beh @param {Situation} s @param {any} R BOT_RULES @param {{cost:number, angleDeg?:number, radius?:number, reserve?:number}} sk
 * @returns {{x:number, z:number, hover:number|null}|null}
 */
export function skillRule(beh, s, R, sk) {
  const T = s.target;
  switch (beh) {
    case 'spinSlash': {
      // 피드백 1: 회전 베기(360° 원) — 반지름(행의 radius · 없으면 규칙 값) − inner 안 ≥ count 마리 또는 정예급 대상이 그 안 · 분노 ≥ 비용 + rageKeep
      //   inner: 판정(시작 + 0.3초)까지 물러서는 적(궁수 · 주술사 뒷걸음)이 원 밖으로 나가지 않게 가장자리를 비운다
      if (!T) return null;
      const r = (sk.radius ?? R.spinSlash.range) - R.spinSlash.inner;
      if (s.resource < sk.cost + R.spinSlash.rageKeep + (sk.reserve ?? 0)) return null;
      if (countWithin(s, s.px, s.pz, r) >= R.spinSlash.count || (ELITE_RANKS.includes(T.rank) && T.d <= r + T.r)) return { x: T.x, z: T.z, hover: T.id };
      return null;
    }
    case 'quake': {
      if (countWithin(s, s.px, s.pz, R.quake.range) >= R.quake.count || eliteWithin(s, R.quake.range)) return { x: T ? T.x : s.px, z: T ? T.z : s.pz, hover: T ? T.id : null };
      return null;
    }
    case 'dash':
      return T && T.d >= R.dash.min && T.d <= R.dash.max ? { x: T.x, z: T.z, hover: null } : null;
    case 'spin':
      if (s.resource < R.spin.rage || countWithin(s, s.px, s.pz, R.spin.range) < R.spin.count) return null;
      return spinAim(s, R);
    case 'buff':
      return s.combat ? { x: T ? T.x : s.px, z: T ? T.z : s.pz, hover: T ? T.id : null } : null;
    case 'leap': {
      if (T && T.d >= R.leap.min && T.d <= R.leap.max) return { x: T.x, z: T.z, hover: null };
      // 정예 팩 한가운데 — 보이는 정예 · 챔피언 · 하수인의 무게중심이 도약 거리 안
      let n = 0, cx = 0, cz = 0;
      for (const m of s.mons) if (m.awake && PACK_RANKS.includes(m.rank)) { n++; cx += m.x; cz += m.z; }
      if (n >= R.leap.packCount) {
        cx /= n; cz /= n;
        const d = Math.hypot(cx - s.px, cz - s.pz);
        if (d >= R.leap.packMin && d <= R.leap.max && countWithin(s, cx, cz, R.leap.packR) >= R.leap.packCount) return { x: cx, z: cz, hover: null };
      }
      return null;
    }
    case 'fireball':
      return T && T.los && s.resource > sk.cost + R.fireball.reserve ? { x: T.x, z: T.z, hover: T.id } : null;
    case 'meteor': {
      // 피드백 2 D8: 벽에 가려진 몬스터는 고르지 않는다(sim 이 목표를 이쪽 벽 앞에서 자른다 — 헛친다)
      const seen = (x, z) => !s.visible || s.visible(x, z);
      let best = null, bn = 0;
      for (const m of s.mons) {
        if (Math.hypot(m.x - s.px, m.z - s.pz) > R.meteor.range) continue;
        const n = countWithin(s, m.x, m.z, R.meteor.cluster);
        if (n > bn && seen(m.x, m.z)) { bn = n; best = m; }
      }
      if (best && bn >= R.meteor.count) return { x: best.x, z: best.z, hover: null };
      if (T && ELITE_RANKS.includes(T.rank) && T.d <= R.meteor.range && seen(T.x, T.z)) return { x: T.x, z: T.z, hover: T.id };
      return null;
    }
    case 'nova':
      return countWithin(s, s.px, s.pz, R.nova.range) >= R.nova.count ? { x: T ? T.x : s.px, z: T ? T.z : s.pz, hover: T ? T.id : null } : null;
    case 'shield':
      return s.combat && s.life < R.shield.life ? { x: T ? T.x : s.px, z: T ? T.z : s.pz, hover: null } : null;
    case 'chain':
      return T && T.los && T.d <= R.chain.range ? { x: T.x, z: T.z, hover: T.id } : null;
    case 'blink':
      return s.meleeNear >= s.kiteCount ? awayPoint(s, R.blinkDist) : null;
    default:
      return null;
  }
}

/** 회오리의 커서 — 둘레 aimR 안 몬스터 무게중심 쪽 aimAhead m 너머(가장 촘촘한 쪽) @param {Situation} s @param {any} R */
export function spinAim(s, R) {
  let n = 0, cx = 0, cz = 0;
  for (const m of s.mons) {
    if (Math.hypot(m.x - s.px, m.z - s.pz) > R.spin.aimR + m.r) continue;
    n++; cx += m.x; cz += m.z;
  }
  if (!n) return { x: s.px, z: s.pz, hover: null };
  cx /= n; cz /= n;
  const dx = cx - s.px, dz = cz - s.pz, d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: cx, z: cz, hover: null };
  return { x: cx + (dx / d) * R.spin.aimAhead, z: cz + (dz / d) * R.spin.aimAhead, hover: null };
}

/** 근접 종 무게중심의 반대쪽 dist m(설 수 있는 쪽 — 0 · ±30 · ±60 · ±90°) @param {Situation} s @param {number} dist */
export function awayPoint(s, dist) {
  let n = 0, cx = 0, cz = 0;
  for (const m of s.mons) {
    if (!m.awake || !m.melee) continue;
    n++; cx += m.x; cz += m.z;
  }
  if (!n) return null;
  cx /= n; cz /= n;
  const base = yawOf(s.px - cx, s.pz - cz);
  const steps = [0, 1, -1, 2, -2, 3, -3];
  for (const k of steps) {
    const a = base + (k * TAU) / BOT_RULES.awayDirs;
    const x = s.px + Math.sin(a) * dist, z = s.pz + Math.cos(a) * dist;
    if (!s.walkable || s.walkable(x, z)) return { x, z, hover: null };
  }
  return null;
}

// ───────────────────────── 대상 ─────────────────────────

/** 그 몬스터의 우선순위(종류 → 등급 → 1) @param {any} P BOT.priority @param {MonsterState} m */
export function priorityOf(P, m) {
  return P[m.typeId] ?? P[m.rank] ?? 1;
}

/**
 * 닿는가 — 흐름장(플레이어 중심 · P4) 걸음 수가 직선의 reachMul 배 + reachPad 안(벽 너머 긴 우회 · 닿지 않는 곳은 고르지 않는다)
 * @param {any} bot @param {MonsterState} m @param {number} d
 */
function reachable(bot, m, d) {
  const ctx = bot.sim.ctx;
  if (!ctx.flow || !ctx.map) return true;
  const steps = flowDist(ctx.flow, ctx.map, m.pos.x, m.pos.z);
  if (!Number.isFinite(steps)) return false;
  return steps <= (d / 0.5) * bot.rules.reachMul + bot.rules.reachPad;
}

/**
 * 대상 고르기 — 점수 = priority / 거리 · 깨어 있는 것 먼저(없으면 잠든 것도 — 보이는 팩을 깨우러 간다) · 포기 목록 · 보호막(금빛 구체) 중인 것 제외
 * @param {any} bot @param {Sense} sv @param {boolean} allowSleeping @returns {MonsterState|null}
 */
export function pickTarget(bot, sv, allowSleeping) {
  const tick = sv.tick;
  let best = null, bs = -1;
  for (let pass = 0; pass < 2 && !best; pass++) {
    if (pass === 1 && !allowSleeping) break;
    for (let i = 0; i < sv.mons.length; i++) {
      const m = sv.mons[i];
      if (pass === 0 ? !m.awake : m.awake) continue;
      if ((bot.ignore.get(m.id) ?? -1) > tick) continue;
      if (m.st && m.st.invulnUntil > tick) continue;
      const d = sv.dist[i];
      if (!reachable(bot, m, d)) continue;
      const sc = priorityOf(bot.params.priority, m) / Math.max(0.5, d);
      if (sc > bs) { bs = sc; best = m; }
    }
  }
  return best;
}

/**
 * 지금 싸우는 대상(반응 지연 · 포기 규칙) — 대상이 죽거나 retargetDist 넘게 멀어지거나 chaseGiveUpSec 동안 생명이 줄지 않으면(포기 목록) 다시 고른다.
 * 새로 고른 대상은 반응 지연 뒤에 누른다(그동안은 옛 대상 · 없으면 null).
 * @param {any} bot @param {Sense} sv @param {boolean} allowSleeping @returns {MonsterState|null}
 */
export function currentTarget(bot, sv, allowSleeping) {
  const tick = sv.tick;
  const tg = bot.tg;
  const R = bot.rules;
  let cur = tg.id !== null ? monById(bot, tg.id) : null;
  if (cur) {
    const d = Math.hypot(cur.pos.x - sv.px, cur.pos.z - sv.pz);
    const ratio = cur.hp / Math.max(1e-9, cur.hpMax);
    if (ratio < tg.lastRatio - 1e-9) { tg.lastRatio = ratio; tg.lastHitAt = tick; }
    let drop = false;
    if (d > R.retargetDist) drop = true;
    else if (tick - tg.lastHitAt > ticks(bot.params.chaseGiveUpSec)) {
      drop = true;
      bot.ignore.set(cur.id, tick + ticks(R.giveUpIgnoreSec));
      bot.note('giveUp', { id: cur.id });
    } else if (cur.st && cur.st.invulnUntil > tick && pickTarget(bot, sv, false)) drop = true;
    if (drop) cur = null;
  }
  if (!cur) tg.id = null;
  // 다음 대상(반응 지연)
  if (!cur && tg.nextId === null) {
    const m = pickTarget(bot, sv, allowSleeping);
    if (m) { tg.nextId = m.id; tg.nextAt = tick + bot.reactTicks(); }
  }
  if (tg.nextId !== null) {
    const nx = monById(bot, tg.nextId);
    if (!nx || (bot.ignore.get(nx.id) ?? -1) > tick) { tg.nextId = null; }
    else if (!cur && tick >= tg.nextAt) {
      tg.id = nx.id;
      tg.lastRatio = nx.hp / Math.max(1e-9, nx.hpMax);
      tg.lastHitAt = tick;
      tg.nextId = null;
      cur = nx;
    }
  }
  return cur;
}

/** 보이는 몬스터 중 ID @param {any} bot @param {number} id */
function monById(bot, id) {
  const sv = bot.sv;
  for (let i = 0; i < sv.mons.length; i++) if (sv.mons[i].id === id) return sv.mons[i];
  return null;
}

// ───────────────────────── 상황 ─────────────────────────

/**
 * 스킬 규칙의 상황을 채운다(봇마다 하나를 재사용)
 * @param {any} bot @param {Sense} sv @param {MonsterState|null} T @returns {Situation}
 */
export function buildSituation(bot, sv, T) {
  const st = bot.sim.state;
  const p = st.player;
  const R = bot.rules;
  const s = /** @type {Situation} */ (bot.sit);
  s.px = sv.px; s.pz = sv.pz;
  s.life = p.lifeMax > 0 ? p.life / p.lifeMax : 1;
  s.resource = p.resource;
  s.combat = false;
  s.meleeNear = 0;
  s.kiteCount = bot.params.kiteCount;
  s.mons.length = 0;
  const pool = bot.sitPool;
  for (let i = 0; i < sv.mons.length; i++) {
    const m = sv.mons[i];
    const melee = hasTag(m, 'melee');
    let e = pool[i];
    if (!e) { e = { x: 0, z: 0, r: 0, rank: '', awake: false, melee: false, id: 0 }; pool[i] = e; }
    e.x = m.pos.x; e.z = m.pos.z; e.r = m.r; e.rank = m.rank; e.awake = m.awake; e.melee = melee; e.id = m.id;
    s.mons.push(e);
    if (m.awake && sv.dist[i] <= R.buff.combatR) s.combat = true;
    if (m.awake && melee && sv.dist[i] <= bot.params.kiteFrom + m.r) s.meleeNear++;
  }
  if (T) {
    const map = bot.sim.ctx.map;
    const d = Math.hypot(T.pos.x - sv.px, T.pos.z - sv.pz);
    s.target = { x: T.pos.x, z: T.pos.z, r: T.r, rank: T.rank, id: T.id, d, los: !map || losClear(map, sv.px, sv.pz, T.pos.x, T.pos.z, { props: true }) };
  } else s.target = null;
  return s;
}

// ───────────────────────── 피하기 ─────────────────────────

/**
 * 피하기(§12.1) — 알아챈 적대 예고가 플레이어 자리(+dodgeMargin)를 덮고 「hitAt − 지금 ≤ 걸어 나가는 시간 + dodgeSlack(+ 남은 행동 잠김)」이면:
 * 12방향 × 2~5m 표본 중 걷기 가능 · 곧게 걸어갈 수 있고 · 진행 중인 모든 알아챈 예고 밖이며 · 대상에 가까운 점으로 걷는다. 걸어서 못 나가면 이동 스킬로.
 * 이미 피하는 중이면 그 점까지 계속. → 이번 틱 입력을 만들었으면 true.
 * @param {any} bot @param {Sense} sv @param {InputFrame} inp @param {{x:number, z:number}|null} goal
 */
export function dodgeInput(bot, sv, inp, goal) {
  const st = bot.sim.state;
  const p = st.player;
  const map = bot.sim.ctx.map;
  const R = bot.rules;
  const tick = sv.tick;
  if (!map) return false;
  // 진행 중인 피하기
  const dg = bot.dodge;
  if (dg) {
    const arrived = Math.hypot(p.pos.x - dg.x, p.pos.z - dg.z) < 0.3;
    if (tick >= dg.until || (arrived && !inThreat(sv, p.pos.x, p.pos.z, p.r + R.dodgeSafePad))) bot.dodge = null;
    else {
      if (!dg.skill) bot.moveTo(inp, dg.x, dg.z, false);
      return true;
    }
  }
  if (!sv.threats.length) return false;
  // 덮는 위협 중 가장 급한 것
  let hitIn = Infinity, endAt = -1;
  for (const e of sv.threats) {
    if (!e.shape || !overlaps(e.shape, p.pos.x, p.pos.z, p.r + R.dodgeMargin)) continue;
    const left = tick < e.hitAt ? (e.hitAt - tick) / 30 : 0;
    if (left < hitIn) { hitIn = left; endAt = tick < e.hitAt ? e.hitAt + 1 : Math.min(e.end, tick + 30); }
  }
  if (!Number.isFinite(hitIn)) return false;
  if (st.player.st.rootUntil > tick) return false;   // 묶여 있다 — 걸을 수 없다
  const lockLeft = isLockedFor(p, tick);
  if (lockLeft < 0) return false;                      // 이동 스킬 · 공중 — 끝날 때까지
  const speed = Math.max(0.5, (bot.sim.getStats()?.moveSpeed ?? 6) * (tick < p.st.slowUntil ? Math.max(0.2, 1 - p.st.slowPct) : 1));
  const cand = bot.dodgeCand;
  cand.length = 0;
  let minT = Infinity;
  // 밸런스 게이트: 여유(dodgeSafePad)를 둔 점이 없으면(잿불 비 — 원 다섯이 고리로 덮는다) 몸 반지름만으로 다시 찾는다
  for (const padAdd of [R.dodgeSafePad, 0]) {
    const pad = p.r + padAdd;
    for (let k = 0; k < R.dodgeDirs; k++) {
      const a = (k * TAU) / R.dodgeDirs;
      for (const dd of R.dodgeDists) {
        const x = p.pos.x + Math.sin(a) * dd, z = p.pos.z + Math.cos(a) * dd;
        if (!isWalkableR(map, x, z, p.r)) continue;
        const end = raycastWalk(map, p.pos.x, p.pos.z, x, z, p.r);
        if (Math.hypot(end.x - x, end.z - z) > 0.1) continue;
        if (inThreat(sv, x, z, pad)) continue;
        if (blockedByBody(sv, p, x, z)) continue;   // 밸런스 게이트: 정예 · 챔피언 · 수호자 몸을 지나가는 길은 막힌다(§5.2-8 — 그 앞에서 섰다가 맞았다)
        if (!pathClearOfOthers(sv, p, x, z)) continue;   // 밸런스 게이트: 지금 서 있는 예고 밖의 다른 예고를 가로지르지 않는다(잿불 비 고리 원으로 뛰어들었다)
        const t = dd / speed;
        cand.push({ x, z, t });
        if (t < minT) minT = t;
      }
    }
    if (cand.length) break;
  }
  // 아직 이르면 기다린다 — 밸런스 게이트: dodgeLead(초)를 더해 「한 번 더 휘두르고 비키기」로 잠김에 갇히지 않게(사람은 표식을 보면 먼저 나온다)
  if (cand.length && hitIn > minT + R.dodgeSlack + lockLeft + R.dodgeLead) return false;
  const gx = goal ? goal.x : p.pos.x, gz = goal ? goal.z : p.pos.z;
  let best = null, bd = Infinity;
  for (const c of cand) {
    if (c.t + lockLeft > hitIn) continue;
    const d = Math.hypot(c.x - gx, c.z - gz);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) {
    bot.dodge = { x: best.x, z: best.z, until: endAt, skill: false };
    bot.counters.dodges++;
    bot.moveTo(inp, best.x, best.z, true);
    return true;
  }
  // 걸어서 못 나간다 — 이동 스킬(도약 · 순간이동 · 돌진)
  if (moveSkillEscape(bot, sv, inp, endAt)) return true;
  // 그래도 가장 가까운 안전한 점으로(최선)
  let near = null, nt = Infinity;
  for (const c of cand) if (c.t < nt) { nt = c.t; near = c; }
  if (near) {
    bot.dodge = { x: near.x, z: near.z, until: endAt, skill: false };
    bot.counters.dodges++;
    bot.moveTo(inp, near.x, near.z, true);
    return true;
  }
  return false;
}

/** 플레이어 → (x, z) 직선(0.5m 표본)이 지금 플레이어를 덮지 않은 알아챈 위협과 겹치지 않는가 @param {Sense} sv @param {any} p @param {number} x @param {number} z */
function pathClearOfOthers(sv, p, x, z) {
  const th = sv.threats;
  if (th.length < 2) return true;
  const len = Math.hypot(x - p.pos.x, z - p.pos.z);
  const n = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 0; i < th.length; i++) {
    const s = th[i].shape;
    if (!s || overlaps(s, p.pos.x, p.pos.z, p.r)) continue;   // 지금 덮고 있는 것(빠져나가는 중)
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (overlaps(s, p.pos.x + (x - p.pos.x) * t, p.pos.z + (z - p.pos.z) * t, p.r)) return false;
    }
  }
  return true;
}

/** 플레이어 → (x, z) 직선이 막는 몸(챔피언 · 정예 · 수호자 · structure 태그 — §5.2-8)을 지나가는가 @param {Sense} sv @param {any} p @param {number} x @param {number} z */
function blockedByBody(sv, p, x, z) {
  for (let i = 0; i < sv.mons.length; i++) {
    const m = sv.mons[i];
    const blocks = m.rank === 'champion' || m.rank === 'elite' || m.rank === 'guardian' || hasTag(m, 'structure');
    if (!blocks) continue;
    if (segPointDist(p.pos.x, p.pos.z, x, z, m.pos.x, m.pos.z) < m.r + p.r) return true;
  }
  return false;
}

/** 남은 행동 잠김(초) — 행동 가능 0 · 기본 공격 · 시전은 actEnd 까지 · 채널은 0(입력이 끊는다) · 이동 스킬은 −1(끊을 수 없다) */
function isLockedFor(p, tick) {
  if (p.act === 'idle' || p.act === 'move' || p.act === 'channel') return 0;
  if (p.act === 'dash' || p.act === 'leap' || p.act === 'blink') return -1;
  if (p.act === 'recall') return 0;
  return Math.max(0, (p.actEnd - tick) / 30);
}

/** 이동 스킬로 피하기 — 바에 있고 준비된 도약 · 순간이동 · 돌진을 안전한 점으로 @param {any} bot @param {Sense} sv @param {InputFrame} inp @param {number} endAt */
function moveSkillEscape(bot, sv, inp, endAt) {
  const st = bot.sim.state;
  const p = st.player;
  const map = bot.sim.ctx.map;
  const R = bot.rules;
  const slot = readySlotByBeh(bot, MOVE_BEHS);
  if (slot < 0) return false;
  const pad = p.r + R.dodgeSafePad;
  for (const dd of R.dodgeSkillDists) {
    for (let k = 0; k < R.dodgeDirs; k++) {
      const a = (k * TAU) / R.dodgeDirs;
      const x = p.pos.x + Math.sin(a) * dd, z = p.pos.z + Math.cos(a) * dd;
      if (!isWalkableR(map, x, z, p.r) || inThreat(sv, x, z, pad)) continue;
      bot.dodge = { x, z, until: endAt, skill: true };
      bot.counters.dodgeSkills++;
      bot.pressSlot(inp, slot, x, z, null);
      return true;
    }
  }
  return false;
}

/** 바에서 그 동작들 중 준비된 첫 칸(-1 = 없음) @param {any} bot @param {string[]} behs */
function readySlotByBeh(bot, behs) {
  const st = bot.sim.state;
  const ch = st.char;
  if (!ch) return -1;
  const stats = bot.sim.getStats();
  for (let i = 0; i < ch.skills.bar.length; i++) {
    const id = ch.skills.bar[i];
    if (!id) continue;
    const beh = behaviorOf(id);
    if (!beh || !behs.includes(beh)) continue;
    if (!skillReady(st, stats, id).ready) continue;
    return i;
  }
  return -1;
}

/** 노드의 동작(액티브만 · 없으면 null) @param {string} id */
export function behaviorOf(id) {
  let node = null;
  try { node = getNode(id); } catch { node = null; }
  return node && node.skill ? node.skill.behavior : null;
}

// ───────────────────────── 싸움 ─────────────────────────

/** 기본 공격이 원거리인가(데이터 — 클래스 기본 공격에 range 가 있다) @param {string} cls */
export function rangedBasic(cls) {
  try {
    const def = getSkillDef(getClass(/** @type {any} */ (cls)).basic);
    return typeof def.range === 'number' && !(typeof def.reach === 'number');
  } catch { return false; }
}

/**
 * 싸움 입력 — 대상이 있으면: (원거리 클래스) 카이팅 → 바의 스킬(동작별 규칙 · 준비된 것) → 기본 공격. 회오리 채널은 규칙이 참인 동안 누르고 있다.
 * @param {any} bot @param {Sense} sv @param {InputFrame} inp @param {MonsterState} T @returns {boolean}
 */
export function fightInput(bot, sv, inp, T) {
  const st = bot.sim.state;
  const p = st.player;
  const ch = st.char;
  const R = bot.rules;
  const tick = sv.tick;
  const s = buildSituation(bot, sv, T);
  // 채널(회오리) 유지
  if (p.act === 'channel' && p.channel) {
    const slot = ch.skills.bar.indexOf(p.channel.skillId);
    if (slot >= 0 && p.resource > 0 && countWithin(s, s.px, s.pz, R.spin.keepRange) >= R.spin.keepCount) {
      const aim = spinAim(s, R);
      bot.holdSlot(inp, slot, aim.x, aim.z);
      return true;
    }
    // 놓는다 — 다음 틱부터 기본 공격(이번 틱은 칸을 떼기만)
    bot.setCursor(inp, T.pos.x, T.pos.z);
    return true;
  }
  // 카이팅(원거리 클래스) — 근접 종이 kiteFrom 안에 kiteCount 이상 「몰려들면 먼저」 한 번 물러선다(kiteSec). 그 뒤에는 자리에서 싸우고,
  // 몰림이 풀린 채 kiteRearmSec 이 지나야 다시 물러선다(계속 걷기만 하면 화력이 사라진다 — 측정 NOTES-P15) · kiteGapSec 은 최소 간격
  const crowded = bot.ranged && s.meleeNear >= bot.params.kiteCount;
  if (!crowded) { if (bot.kiteCalmSince < 0) bot.kiteCalmSince = tick; if (tick - bot.kiteCalmSince >= ticks(R.kiteRearmSec)) bot.kiteArmed = true; }
  else bot.kiteCalmSince = -1;
  const kiting = crowded && bot.kiteArmed;
  if (bot.kiteUntil > tick && bot.kite) {
    if (crowded) { bot.moveTo(inp, bot.kite.x, bot.kite.z, false); return true; }
    bot.kiteUntil = -1;
  }
  const soon = actionableSoon(p, tick);
  if (soon && ch) {
    const used = trySkills(bot, s, inp, kiting ? KITE_BEHS : null);
    if (used) return true;
  }
  if (kiting && soon && tick >= bot.kiteNextAt) {
    const pt = kitePoint(bot, sv, s);
    if (pt) {
      bot.kite = pt;
      bot.kiteUntil = tick + Math.max(1, ticks(R.kiteSec));
      bot.kiteNextAt = bot.kiteUntil + ticks(R.kiteGapSec);
      bot.kiteArmed = false;
      bot.counters.kites++;
      bot.moveTo(inp, pt.x, pt.z, true);
      return true;
    }
  }
  bot.attack(inp, T);
  return true;
}

/**
 * 뒷걸음 점 — 근접 종 무게중심의 반대쪽 kiteDist(0 · ±30 · ±60 · ±90°) 중 설 수 있고 · 곧게 걸어갈 수 있고 · 알아챈 위협 밖이며 ·
 * 보이는 잠든 몬스터의 깨우는 거리(kiteSleepR) 밖인 첫 점(잠든 팩 쪽으로 물러나 떼를 늘리지 않는다)
 * @param {any} bot @param {Sense} sv @param {Situation} s
 */
function kitePoint(bot, sv, s) {
  const map = bot.sim.ctx.map;
  const p = bot.sim.state.player;
  const R = bot.rules;
  if (!map) return null;
  let n = 0, cx = 0, cz = 0;
  for (const m of s.mons) if (m.awake && m.melee) { n++; cx += m.x; cz += m.z; }
  if (!n) return null;
  cx /= n; cz /= n;
  const base = yawOf(s.px - cx, s.pz - cz);
  for (const k of [0, 1, -1, 2, -2, 3, -3]) {
    const a = base + (k * TAU) / R.awayDirs;
    const x = s.px + Math.sin(a) * R.kiteDist, z = s.pz + Math.cos(a) * R.kiteDist;
    if (!isWalkableR(map, x, z, p.r)) continue;
    const end = raycastWalk(map, s.px, s.pz, x, z, p.r);
    if (Math.hypot(end.x - x, end.z - z) > 0.1) continue;
    if (inThreat(sv, x, z, p.r + R.dodgeSafePad)) continue;
    let wakes = false;
    for (let i = 0; i < sv.mons.length && !wakes; i++) {
      const m = sv.mons[i];
      if (!m.awake && Math.hypot(m.pos.x - x, m.pos.z - z) < R.kiteSleepR) wakes = true;
    }
    if (wakes) continue;
    return { x, z };
  }
  return null;
}

/** 곧 행동할 수 있다 — 행동 가능 · 또는 기본 공격 · 시전이 2틱 안에 끝난다(누른 스킬은 선입력으로 나간다) */
function actionableSoon(p, tick) {
  if (p.dead) return false;
  if (p.act === 'idle' || p.act === 'move') return true;
  return (p.act === 'attack' || p.act === 'cast') && p.actEnd - tick <= 2;
}

/**
 * 바의 스킬을 BEH_ORDER 차례로 — 준비됨(skillReady) · 규칙 참이면 그 칸을 누른다(회오리는 누르기 시작)
 * @param {any} bot @param {Situation} s @param {InputFrame} inp @param {string[]|null} only 이 동작만(카이팅 중)
 */
function trySkills(bot, s, inp, only) {
  const st = bot.sim.state;
  const ch = st.char;
  const stats = bot.sim.getStats();
  const R = bot.rules;
  const bar = ch.skills.bar;
  const tick = st.tick;
  for (const beh of BEH_ORDER) {
    if (only && !only.includes(beh)) continue;
    for (let i = 0; i < bar.length; i++) {
      const id = bar[i];
      if (!id || behaviorOf(id) !== beh) continue;
      if (bot.pressedAt[i] > tick) continue;
      const rd = skillReady(st, stats, id);
      if (!rd.ready) continue;
      const def = getNode(id).skill;
      const cost = (def.cost ?? 0) * (1 - (stats?.costReduce ?? 0));
      const sk = bot.skScratch;
      sk.cost = cost;
      sk.angleDeg = def.angleDeg;
      sk.radius = def.radius;
      sk.reserve = channelReserve(bar, beh, R);
      const want = skillRule(beh, s, R, sk);
      if (!want) continue;
      if (beh === 'spin') bot.holdSlot(inp, i, want.x, want.z);
      else bot.pressSlot(inp, i, want.x, want.z, want.hover !== null ? monRef(bot, want.hover) : null);
      bot.counters.casts[beh] = (bot.counters.casts[beh] ?? 0) + 1;
      return true;
    }
  }
  return false;
}

/**
 * 피드백 1: 바에 채널(회오리 · spin) 스킬이 있으면 다른 분노 스킬(회전 베기)은 그 시작 분노(R.spin.rage)를 남겨 둔다 — 회오리는 분노당 피해가
 * 회전 베기의 ~3배인데, 회전 베기가 먼저 분노를 써 버려 회오리가 거의 시작되지 않았다(프리셋 B 「학살」이 A 보다 31% 느렸다). 동작으로만 본다.
 * @param {Array<string|null>} bar @param {string} beh @param {any} R
 */
function channelReserve(bar, beh, R) {
  if (beh === 'spin') return 0;
  for (const id of bar) if (id && behaviorOf(id) === 'spin') return R.spin.rage;
  return 0;
}

/** hover 용 몬스터(보이는 것) @param {any} bot @param {number} id */
function monRef(bot, id) {
  const m = monById(bot, id);
  return m && aliveMon(m) ? m : null;
}

/**
 * 구슬 — 생명 < globeLife 이고 globeR 안에 구슬이 있고 그 길에 알아챈 예고가 없으면 그쪽으로(자동 줍기 반경)
 * @param {any} bot @param {Sense} sv @param {InputFrame} inp @returns {boolean}
 */
export function globeInput(bot, sv, inp) {
  const st = bot.sim.state;
  const p = st.player;
  const R = bot.rules;
  if (!(p.lifeMax > 0) || p.life / p.lifeMax >= R.globeLife) return false;
  let best = null, bd = Infinity;
  for (const d of sv.drops) {
    if (d.kind !== 'globe' || d.gone) continue;
    const dist = Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z);
    if (dist > R.globeR || dist >= bd) continue;
    if (!pathClearOfThreats(sv, p.pos.x, p.pos.z, d.pos.x, d.pos.z, p.r)) continue;
    bd = dist; best = d;
  }
  if (!best) return false;
  bot.moveTo(inp, best.pos.x, best.pos.z, false);
  return true;
}
