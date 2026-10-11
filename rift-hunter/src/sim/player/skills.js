// OWNER: P1 — 계약 §6.7 · §5.4 · §8.4 · §7.2 · §9.6
// 스킬 동작 표(SKILL_BEHAVIORS — 동작 14: 기본 공격 2 + 액티브 12) · skillParams(변형 6 · 전설 패치 9 는 params 로만 닿는다) ·
// describeSkill · skillReady + 플레이어 쪽 공용 도우미(랭크 · 적중 정의 · 자원 · 적중 집계).
// 동작은 노드 · 전설 ID 를 모른다 — 차이는 행의 수치(skill · status · params)와 skillParams 가 합친 패치 키로만 낸다(§8.4).
// 이 파일은 actions.js · controller.js 를 import 하지 않는다(그 둘이 이것을 import 한다 — 순환 없음).
//
// 동작 항목: {act, channel?, start(ctx, node, rank, cast) → boolean, hit(ctx, node, rank, cast), tick?(ctx, node, rank, cast)}
//   start — 행동을 시작할 때(비용 · 쿨 검사 뒤 · 지불 전). false 면 시작하지 않는다(cast.fail = 실패 사유). cast.hitT · endT(틱 수)를 바꿀 수 있다.
//   hit   — 판정 틱(actHit). tick — 행동 중 매 틱(시작 다음 틱부터 · 채널은 채널 처리가 매 틱 부른다).
// cast = {nodeId, rank, actionId, x, z, facing, tx, tz, targetId, params, hitT, endT, fail} — 행동 중에는 상태(actSkill · actPoint ·
//   actTargetId · actId · facing)에서 다시 만든다(상태가 정본 · 시작 위치가 필요한 돌진 · 도약은 player.air.from).

import { APS_REF, CAM_AZIMUTH, DT, SKILL_BAR } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { clamp, deg2rad, fwdX, fwdZ, lerp, rightX, rightZ, yawOf } from '../../core/math.js';
import { circle, cone, line } from '../../core/shapes.js';
import { secOf, ticks } from '../../core/time.js';
import { CLASSES, PLAYER } from '../../data/classes.js';
import { CLASSES_BY_ID, LEGENDARIES_BY_ID, SKILL_NODES_BY_ID } from '../../data/index.js';
import { BASIC_SKILLS, SKILL_NODES } from '../../data/skills.js';
import { healPlayer, playerHit, playerHitShape } from '../combat.js';
import { CONDS } from '../conds.js';
import { spawnEffect } from '../effects.js';
import { getMonster, monstersIn, nearestMonster } from '../entities.js';
import { spawnProjectile } from '../projectiles.js';
import { addBuff } from '../status.js';
import { losClear, moveCircle, nearestWalkable, raycastWalk } from '../world/nav.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').PlayerStats} PlayerStats */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').SkillNode} SkillNode */
/** @typedef {import('../../types.js').SkillDef} SkillDef */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').HitResult} HitResult */
/** @typedef {import('../../types.js').Shape} Shape */
/**
 * @typedef {Object} Cast
 * @property {string} nodeId @property {number} rank @property {number} actionId
 * @property {number} x @property {number} z @property {number} facing @property {number} tx @property {number} tz
 * @property {number|null} targetId @property {Object} params @property {number} hitT @property {number} endT @property {string|null} fail
 */

/** 도약 착지 · 벽 앞 자르기의 이분 탐색 횟수(알고리즘 상수) */
const BISECT = 10;
/** 파생 적중의 태그(§7.2 「파생 적중」 — 동작이 정한 꼴) */
const TAGS_AOE = ['aoe'];
const TAGS_AOE_DOT = ['aoe', 'dot'];
const TAGS_PROJ = ['projectile'];
/** 불타는 소용돌이(spin 동작의 vortex 키)가 남기는 피해 종류 */
const VORTEX_TYPE = 'fire';

const own = (obj, k) => obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, k);

// ───────────────────────── 노드 · 랭크 · params ─────────────────────────

/** 기본 공격(BASIC_SKILLS)을 노드 꼴로 — 동작이 (ctx, node, rank, cast) 하나로 받는다 */
const BASIC_NODES = {};
for (const id of Object.keys(BASIC_SKILLS)) BASIC_NODES[id] = Object.freeze({ id, cls: null, kind: 'active', maxRank: 1, skill: BASIC_SKILLS[id] });

/** 액티브 노드 ID → 그 액티브를 바꾸는 변형 노드들 */
const TRANSFORMS_OF = {};
for (const n of SKILL_NODES) {
  if (n.kind !== 'transform' || !n.transforms) continue;
  if (!own(TRANSFORMS_OF, n.transforms)) TRANSFORMS_OF[n.transforms] = [];
  TRANSFORMS_OF[n.transforms].push(n);
}

/** 노드 ID 또는 기본 공격 ID → 노드(기본 공격은 {id, kind:'active', maxRank:1, skill}) · 없으면 null @param {any} id */
export function nodeOf(id) {
  if (typeof id !== 'string') return null;
  if (own(SKILL_NODES_BY_ID, id)) return SKILL_NODES_BY_ID[id];
  if (own(BASIC_NODES, id)) return BASIC_NODES[id];
  return null;
}

/** 기본 공격 노드인가 @param {any} node */
export function isBasicNode(node) { return !!node && own(BASIC_NODES, node.id) && BASIC_NODES[node.id] === node; }

/** 랭크별 값([rank − 1] · 배열이 짧으면 마지막) · 숫자는 그대로 · 그 밖은 0 @param {any} v @param {number} rank */
export function atRank(v, rank) {
  if (Array.isArray(v)) {
    if (!v.length) return 0;
    const r = Math.floor(rank) > 0 ? Math.floor(rank) : 1;
    return v[Math.min(v.length, r) - 1];
  }
  return typeof v === 'number' ? v : 0;
}

/** 지금 캐릭터가 찍은 랭크(기본 공격은 1 · 캐릭터가 없으면 0) @param {SimCtx} ctx @param {string} id */
export function learnedRank(ctx, id) {
  if (own(BASIC_NODES, id)) return 1;
  const ranks = ctx.state.char?.skills?.ranks;
  const r = ranks && own(ranks, id) ? ranks[id] : 0;
  return r > 0 ? r : 0;
}

/** 순수 데이터 깊은 복사(배열 · 객체 · 원시값) @param {any} v @returns {any} */
function cloneData(v) {
  if (Array.isArray(v)) return v.map(cloneData);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = cloneData(v[k]);
    return o;
  }
  return v;
}

/**
 * 행의 skill.params 에 찍은 변형의 patch → 낀 전설(패치형 · 그 스킬)의 patch 를 차례로 덮어쓴 새 객체(§8.4)
 * @param {any} node @param {(id:string) => boolean} isLearned @param {string[]|null|undefined} hooks 활성 전설 ID(PlayerStats.hooks)
 */
function mergeParams(node, isLearned, hooks) {
  const out = cloneData(node.skill?.params ?? {});
  const ts = own(TRANSFORMS_OF, node.id) ? TRANSFORMS_OF[node.id] : null;
  if (ts) for (const t of ts) if (t.patch && isLearned(t.id)) Object.assign(out, cloneData(t.patch));
  if (Array.isArray(hooks)) {
    for (const lid of hooks) {
      const leg = own(LEGENDARIES_BY_ID, lid) ? LEGENDARIES_BY_ID[lid] : null;
      if (leg && leg.patch && leg.skill === node.id) Object.assign(out, cloneData(leg.patch));
    }
  }
  return out;
}

/**
 * 행의 skill.params + 찍은 변형의 patch + 낀 전설(패치형 · 그 스킬)의 patch → 새 객체(§8.4).
 * 찍은 변형 = char.skills.ranks(1 이상) 또는 ctx.stats.transforms · 낀 전설 = ctx.stats.hooks(내구도 0 이면 computeStats 가 뺀다).
 * 기본 공격 ID 도 받는다 · 모르는 ID 면 {}.
 * @param {SimCtx} ctx @param {string} nodeId @returns {Object}
 */
export function skillParams(ctx, nodeId) {
  const node = nodeOf(nodeId);
  if (!node || !node.skill) return {};
  const ranks = ctx?.state?.char?.skills?.ranks;
  const tr = ctx?.stats?.transforms;
  return mergeParams(node, (id) => (!!ranks && own(ranks, id) && ranks[id] > 0) || (Array.isArray(tr) && tr.includes(id)), ctx?.stats?.hooks);
}

/** 그 노드를 바꾸는 변형 중 찍은 것의 ID(ACTION_HIT.transforms) @param {SimCtx} ctx @param {string} nodeId @returns {string[]} */
function learnedTransforms(ctx, nodeId) {
  const ts = own(TRANSFORMS_OF, nodeId) ? TRANSFORMS_OF[nodeId] : null;
  if (!ts) return [];
  const tr = ctx.stats?.transforms;
  const out = [];
  for (const t of ts) if (learnedRank(ctx, t.id) > 0 || (Array.isArray(tr) && tr.includes(t.id))) out.push(t.id);
  return out;
}

/** 같은 클래스에서 그 동작을 쓰는 첫 액티브(전설 「도약 착지가 지진」 · 「순간이동 도착에 서리 노바」 — ID 가 아니라 동작으로 찾는다) */
function classNodeByBehavior(cls, behavior) {
  for (const n of SKILL_NODES) if (n.cls === cls && n.kind === 'active' && n.skill?.behavior === behavior) return n;
  return null;
}

// ───────────────────────── 클래스 · 자원 · 시간 ─────────────────────────

/** 지금 캐릭터의 클래스 정의(없으면 첫 클래스) @param {SimCtx} ctx */
export function classOf(ctx) {
  const cls = ctx.state.char?.cls;
  return own(CLASSES_BY_ID, cls) ? CLASSES_BY_ID[cls] : CLASSES[0];
}

/** 자원을 더한다(음수면 뺀다) · [0, resourceMax] @param {SimCtx} ctx @param {number} amount */
export function addResource(ctx, amount) {
  if (!amount || !Number.isFinite(amount)) return;
  const p = ctx.state.player;
  p.resource = clamp(p.resource + amount, 0, p.resourceMax > 0 ? p.resourceMax : 0);
}

/** 주거나 받은 적중이 있었다 — combatUntil(분노 감소 시작) @param {SimCtx} ctx */
export function markCombat(ctx) {
  const p = ctx.state.player;
  const C = classOf(ctx);
  const until = ctx.state.tick + ticks(C.rage ? C.rage.decayDelay : PLAYER.combatSec);
  if (p.combatUntil < until) p.combatUntil = until;
}

/** 조건부 공격 속도(광전사 — 행동 시작 때)까지 더한 초당 공격 @param {SimCtx} ctx */
export function apsEff(ctx) {
  const s = ctx.stats;
  let add = 0;
  if (s && Array.isArray(s.conds)) {
    for (const c of s.conds) {
      const v = c?.stats?.attackSpeedPct;
      if (!v) continue;
      const fn = own(CONDS, c.cond) ? CONDS[c.cond] : null;
      if (fn && fn(ctx, null)) add += v;
    }
  }
  const aps = s && s.aps > 0 ? s.aps : APS_REF;
  return aps * (1 + add);
}

/** 행동 길이(초) — scaled 면 action × APS_REF / aps @param {SkillDef} def @param {number} aps */
export function actionSec(def, aps) {
  return def.action * (def.scaled ? APS_REF / (aps > 0 ? aps : APS_REF) : 1);
}

/** 채널 틱 간격(틱 · 1 이상) @param {SimCtx} ctx @param {SkillDef} def */
export function channelTicks(ctx, def) {
  return Math.max(1, ticks(actionSec(def, apsEff(ctx))));
}

/** 그 랭크의 쿨다운(초 · cdr 전) @param {SkillDef} def @param {number} rank */
export function cdAt(def, rank) { return atRank(def.cd, rank); }

/** 살아 있는(gone · dead · 생명 0 아님) 몬스터 @param {SimCtx} ctx @param {any} id @returns {MonsterState|null} */
export function targetAlive(ctx, id) {
  if (id === null || id === undefined || !ctx.state.rift) return null;
  const m = getMonster(ctx, id);
  return m && !m.gone && !m.dead && m.hp > 0 ? m : null;
}

/** SHAKE(스킬 흔들림) @param {SimCtx} ctx @param {number} amp */
export function shake(ctx, amp) {
  if (amp > 0) ctx.emit(EV.SHAKE, { amp, sec: PLAYER.shakeSec });
}

// ───────────────────────── 적중 정의 · 집계 ─────────────────────────

/**
 * 행에서 적중 정의(PlayerHitSpec) — status 는 랭크별 [rank − 1](§7.2) · 비율 0..1
 * @param {string} skillId @param {SkillDef} def @param {number} rank @param {number} actionId @param {number} srcX @param {number} srcZ
 * @returns {import('../../types.js').PlayerHitSpec & Object}
 */
export function hitSpec(skillId, def, rank, actionId, srcX, srcZ) {
  /** @type {any} */
  const spec = { skillId, coef: atRank(def.coef, rank), type: def.type ?? 'phys', tags: def.tags.slice(), actionId, srcX, srcZ };
  const st = def.status;
  if (st) {
    if (st.stun !== undefined) spec.stun = atRank(st.stun, rank);
    if (st.knock !== undefined) spec.knock = atRank(st.knock, rank);
    if (st.chill !== undefined) spec.chill = atRank(st.chill, rank);
    if (st.burnFrac !== undefined) spec.burnFrac = atRank(st.burnFrac, rank);
    if (st.shockChance !== undefined) spec.shockChance = atRank(st.shockChance, rank);
    if (st.slowPct !== undefined) spec.slow = { pct: atRank(st.slowPct, rank), sec: atRank(st.slowSec, rank) };
  }
  return spec;
}

/**
 * 파생 적중(변형 · 전설이 만든 적중 — 기절 · 넉백 없음 §5.8) — 그 행이 명시한 냉기/감전은 부르는 쪽이 더한다
 * @param {string} skillId @param {number} coef @param {string} type @param {string[]} tags @param {number} actionId @param {number} srcX @param {number} srcZ
 */
export function derivedSpec(skillId, coef, type, tags, actionId, srcX, srcZ) {
  return { skillId, coef, type, tags: tags.slice(), actionId, srcX, srcZ };
}

/**
 * 직접 적중의 집계 — sk.hitIds(맞힌 몬스터) · sk.hits(적중 수) · combatUntil · 분노(기본 공격 생성 · rageOnHit 행동마다 한 번)
 * @param {SimCtx} ctx @param {Array<HitResult|null>} results @param {boolean} basic @param {number} actionId @returns {number} 적중 수(무적 제외)
 */
export function noteHits(ctx, results, basic, actionId) {
  const p = ctx.state.player;
  let n = 0;
  for (const r of results) {
    if (!r) continue;
    if (!p.sk.hitIds.includes(r.monId)) p.sk.hitIds.push(r.monId);
    if (!r.immune) n++;
  }
  if (n <= 0) return 0;
  p.sk.hits += n;
  markCombat(ctx);
  const C = classOf(ctx);
  if (C.rage) {
    let gain = 0;
    if (basic) gain += C.rage.onBasicHit + Math.min(C.rage.extraCap, n - 1) * C.rage.perExtraTarget;
    const roh = ctx.stats?.rageOnHit ?? 0;
    if (roh > 0 && p.sk.rohId !== actionId) {
      gain += roh;
      p.sk.rohId = actionId;
    }
    addResource(ctx, gain);
  }
  return n;
}

/** 모양 안의 살아 있는 몬스터 중 (x, z)에서 가장 가까운 것 @param {SimCtx} ctx @param {Shape} shape */
function nearestIn(ctx, shape, x, z) {
  let best = null, bestD = Infinity;
  for (const m of monstersIn(ctx, shape)) {
    const d = Math.hypot(m.pos.x - x, m.pos.z - z);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** 플레이어 소유 효과(비적대 — 몬스터만 다친다 §5.4) */
function playerEffect(ctx, kind, shape, delay, spec, extra = null) {
  return spawnEffect(ctx, {
    kind, owner: 'player', srcId: -1, packId: -1, hostile: false, shape, delay,
    dur: extra?.dur ?? 0, tick: extra?.tick ?? 0, spec, tickSpec: extra?.tickSpec ?? null, from: extra?.from ?? null, cancelOnSrcDeath: false,
  });
}

/** 플레이어 투사체 — 몸 가장자리에서 facing 으로 */
function playerProj(ctx, visual, facing, speed, range, r, pierce, spec, explode) {
  const p = ctx.state.player;
  return spawnProjectile(ctx, {
    visual, owner: 'player', srcId: -1, x: p.pos.x + fwdX(facing) * p.r, z: p.pos.z + fwdZ(facing) * p.r,
    facing, speed, range, r, pierce: pierce > 0 ? pierce : 0, bounce: false, spec, explode,
  });
}

/** ACTION_HIT(판정 틱) @param {SimCtx} ctx @param {string} skillId @param {number} rank @param {Cast} cast */
export function emitActionHit(ctx, skillId, rank, cast) {
  ctx.emit(EV.ACTION_HIT, {
    skillId, x: cast.x, z: cast.z, facing: cast.facing, tx: cast.tx, tz: cast.tz, rank, transforms: learnedTransforms(ctx, skillId),
  });
}

// ───────────────────────── 동작이 같이 쓰는 조각 ─────────────────────────

/** 지진 파동(earthquake · 진동 장화) — 시전 자리 원 · 파동마다 새 actionId · 흔들림은 spec.shake(효과 판정 때 — NOTES-P1) */
function quakeWaves(ctx, qnode, rank, x, z, mul, prm, derived) {
  const def = qnode.skill;
  for (const w of prm.waves ?? []) {
    const id = ctx.nextId();
    const spec = derived
      ? derivedSpec(qnode.id, atRank(def.coef, rank) * mul, def.type ?? 'phys', TAGS_AOE, id, x, z)
      : hitSpec(qnode.id, def, rank, id, x, z);
    /** @type {any} */ (spec).shake = prm.shake;
    playerEffect(ctx, prm.fx, circle(x, z, def.radius), w, spec);
  }
}

/** 서리 노바 판정(제자리 원 · 냉기) + 얼음 파편(shards 키) */
function novaBurst(ctx, node, rank, prm, actionId, facing) {
  const p = ctx.state.player;
  const def = node.skill;
  const spec = hitSpec(node.id, def, rank, actionId, p.pos.x, p.pos.z);
  noteHits(ctx, playerHitShape(ctx, circle(p.pos.x, p.pos.z, def.radius), spec), false, actionId);
  const sh = prm.shards;
  if (sh && sh.n > 0) {
    for (let i = 0; i < sh.n; i++) {
      const f = facing + (i * 2 * Math.PI) / sh.n;
      const s2 = derivedSpec(node.id, spec.coef * sh.mul, def.type ?? 'cold', TAGS_PROJ, actionId, p.pos.x, p.pos.z);
      if (sh.chill > 0) /** @type {any} */ (s2).chill = sh.chill;
      playerProj(ctx, prm.visualShard, f, sh.speed, sh.range, sh.r, sh.pierce ?? 0, s2, null);
    }
  }
}

/** 번개 잔상 폭발(blast 키) 하나 */
function blastAt(ctx, node, rank, prm, actionId, x, z) {
  const b = prm.blast;
  const spec = derivedSpec(node.id, atRank(b.coef, rank), b.type ?? 'lightning', TAGS_AOE, actionId, x, z);
  if (b.shockChance > 0) /** @type {any} */ (spec).shockChance = b.shockChance;
  playerEffect(ctx, prm.fxBlast, circle(x, z, b.r), 0, spec);
}

/** 메테오 하나(충돌 spec + 불타는 바닥 tickSpec — 같은 원 · 효과 하나) */
function meteorAt(ctx, node, rank, cast, x, z, r, delay, mul) {
  const def = node.skill, prm = cast.params, burn = prm.burn;
  const spec = hitSpec(node.id, def, rank, cast.actionId, x, z);
  spec.coef *= mul;
  /** @type {any} */ (spec).shake = (prm.shake ?? 0) * mul;
  let tickSpec = null, dur = 0, tk = 0;
  if (burn && burn.tick > 0) {
    tickSpec = derivedSpec(node.id, atRank(burn.coefPerSec, rank) * burn.tick * mul, def.type ?? 'fire', def.tags, cast.actionId, x, z);
    dur = burn.dur;
    tk = burn.tick;
  }
  const back = CAM_AZIMUTH + Math.PI;   // 화면 위쪽(§0.2) — 낙하 연출의 출발점
  const fall = prm.fallDist ?? 0;
  playerEffect(ctx, prm.fx, circle(x, z, r), delay, spec, { dur, tick: tk, tickSpec, from: { x: x + fwdX(back) * fall, z: z + fwdZ(back) * fall } });
}

/** 연쇄 번개의 첫 대상 — hover 몬스터(사거리 · 시야 — 막는 소품 포함) → 커서 pickR 안 · 플레이어 사거리 안 · 시야의 가장 가까운 것 → null */
function pickChainTarget(ctx, def, prm, hoverId, cx, cz) {
  const p = ctx.state.player;
  const map = ctx.map;
  const ok = (m) => Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) <= def.range && (!map || losClear(map, p.pos.x, p.pos.z, m.pos.x, m.pos.z, { props: true }));
  const h = targetAlive(ctx, hoverId);
  if (h && ok(h)) return h;
  return nearestMonster(ctx, cx, cz, prm.pickR ?? 0, ok);
}

/** (dx, dz)의 단위 방향 · 길이(0 이면 facing) */
function dirOf(dx, dz, facing) {
  const d = Math.hypot(dx, dz);
  if (d > 0) return { ux: dx / d, uz: dz / d, d };
  return { ux: fwdX(facing), uz: fwdZ(facing), d: 0 };
}

/** 도약 착지점 — 시작점에서 목표까지 벽 타일이 막으면 그 앞 · 가장 가까운 걷기 가능 점(몸 반지름) */
function leapLanding(map, ax, az, bx, bz, r) {
  let x = bx, z = bz;
  if (!losClear(map, ax, az, bx, bz)) {
    let lo = 0, hi = 1;
    for (let k = 0; k < BISECT; k++) {
      const mid = (lo + hi) / 2;
      if (losClear(map, ax, az, ax + (bx - ax) * mid, az + (bz - az) * mid)) lo = mid;
      else hi = mid;
    }
    x = ax + (bx - ax) * lo;
    z = az + (bz - az) * lo;
  }
  const w = nearestWalkable(map, x, z) ?? { x: ax, z: az };
  const land = moveCircle(map, w, r, 0, 0);
  if (!losClear(map, ax, az, land.x, land.z)) return raycastWalk(map, ax, az, bx, bz, r);
  return land;
}

/** 순간이동 도착점 — 가장 가까운 걷기 가능 점(벽을 건넌다) · 없으면 이쪽 편에서 닿는 끝 */
function blinkLanding(map, ax, az, bx, bz, r) {
  const w = nearestWalkable(map, bx, bz);
  if (!w) return raycastWalk(map, ax, az, bx, bz, r);
  return moveCircle(map, w, r, 0, 0);
}

// ───────────────────────── 동작 14 ─────────────────────────

const yes = () => true;
const noop = () => {};

/** 동작 표 — 실행부(actions.js)는 노드 ID 를 모르고 이 표와 행만 본다(§8.4) */
export const SKILL_BEHAVIORS = {
  /** 강타 — 대상이 r + reach + 관용 안이면 그 하나 · 아니면(제자리 · 대상이 없어짐) 원뿔 70° · reach 안 가장 가까운 하나 · 분노 생성 */
  meleeBasic: {
    act: 'attack',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill;
      let mon = targetAlive(ctx, cast.targetId);
      if (mon && Math.hypot(mon.pos.x - p.pos.x, mon.pos.z - p.pos.z) > p.r + mon.r + def.reach + PLAYER.reachTolerance) mon = null;
      if (!mon) mon = nearestIn(ctx, cone(p.pos.x, p.pos.z, p.r + def.reach, p.facing, deg2rad(def.angleDeg ?? PLAYER.standConeDeg)), p.pos.x, p.pos.z);
      if (!mon) return;
      const spec = hitSpec(node.id, def, rank, cast.actionId, p.pos.x, p.pos.z);
      noteHits(ctx, [playerHit(ctx, mon, spec)], true, cast.actionId);
    },
  },

  /** 마력 화살 — 판정 틱에 대상(살아 있으면 지금 자리)/커서 쪽으로 투사체 */
  boltBasic: {
    act: 'attack',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      let f = cast.facing;
      const mon = targetAlive(ctx, cast.targetId);
      if (mon) {
        const dx = mon.pos.x - p.pos.x, dz = mon.pos.z - p.pos.z;
        if (dx || dz) { f = yawOf(dx, dz); p.facing = f; }
      }
      playerProj(ctx, prm.visual, f, prm.speed, def.range, prm.r, 0, hitSpec(node.id, def, rank, cast.actionId, p.pos.x, p.pos.z), null);
    },
  },

  /** 지면 강타 — 원뿔(radius · angleDeg) · 기절 · 흔들림 / aftershock: 같은 자리 · 방향 · delay 뒤 mul / shockwave: 앞으로 선 */
  cone: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      const x = p.pos.x, z = p.pos.z, f = cast.facing, ang = deg2rad(def.angleDeg);
      const spec = hitSpec(node.id, def, rank, cast.actionId, x, z);
      noteHits(ctx, playerHitShape(ctx, cone(x, z, def.radius, f, ang), spec), false, cast.actionId);
      shake(ctx, prm.shake);
      if (prm.aftershock) {
        const s2 = derivedSpec(node.id, spec.coef * prm.aftershock.mul, def.type ?? 'phys', TAGS_AOE, ctx.nextId(), x, z);
        /** @type {any} */ (s2).shake = prm.shake;
        playerEffect(ctx, prm.fxAftershock, cone(x, z, def.radius, f, ang), prm.aftershock.delay, s2);
      }
      if (prm.shockwave) {
        const sw = prm.shockwave;
        const s3 = derivedSpec(node.id, sw.coef, def.type ?? 'phys', TAGS_AOE, ctx.nextId(), x, z);
        playerEffect(ctx, prm.fxShockwave, line(x, z, f, sw.len, sw.width), 0, s3);
      }
    },
  },

  /** 지진 — 시전 자리 원 · 파동 waves(+초 · 판정 틱 기준) — 플레이어 소유 효과 셋 */
  quake: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      quakeWaves(ctx, node, rank, p.pos.x, p.pos.z, 1, cast.params, false);
    },
  },

  /** 돌진 — 커서(minRange..range · 벽 앞) · 판정 = 시작 + 1틱 · 매 틱 이동 선분(폭 width)의 아직 안 맞은 몬스터 · 옆 밀침 · refund */
  dash: {
    act: 'dash',
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      const { ux, uz, d } = dirOf(cast.tx - p.pos.x, cast.tz - p.pos.z, p.facing);
      const want = clamp(d, prm.minRange ?? 0, def.range);
      const gx = p.pos.x + ux * want, gz = p.pos.z + uz * want;
      const end = ctx.map ? raycastWalk(ctx.map, p.pos.x, p.pos.z, gx, gz, p.r) : { x: gx, z: gz };
      const dist = Math.hypot(end.x - p.pos.x, end.z - p.pos.z);
      const arriveT = Math.max(1, ticks(dist / prm.speed));
      cast.tx = end.x;
      cast.tz = end.z;
      cast.facing = yawOf(ux, uz);
      cast.hitT = 1;
      cast.endT = arriveT + Math.max(1, ticks(def.action));
      const now = ctx.state.tick;
      p.air = { from: { x: p.pos.x, z: p.pos.z }, to: { x: end.x, z: end.z }, start: now, end: now + arriveT, kind: 'dash' };
      return true;
    },
    tick(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const a = p.air;
      const now = ctx.state.tick;
      if (!a || now > a.end) return;
      const def = node.skill;
      const t = a.end > a.start ? (now - a.start) / (a.end - a.start) : 1;
      const ox = p.pos.x, oz = p.pos.z;
      const gx = lerp(a.from.x, a.to.x, t), gz = lerp(a.from.z, a.to.z, t);
      p.pos = ctx.map ? moveCircle(ctx.map, p.pos, p.r, gx - ox, gz - oz) : { x: gx, z: gz };
      const sx = p.pos.x - ox, sz = p.pos.z - oz;
      const len = Math.hypot(sx, sz);
      p.speed = len / DT;
      const f = len > 0 ? yawOf(sx, sz) : cast.facing;
      const mons = monstersIn(ctx, line(ox, oz, f, len, def.width), { exclude: p.sk.hitIds });
      if (!mons.length) return;
      const rx = rightX(f), rz = rightZ(f);
      const results = [];
      for (const m of mons) {
        // 선의 어느 쪽인지로 부호 — 넉백은 (srcX, srcZ) → 몬스터 방향이라 반대편 1m 를 출처로 둔다(§5.4 · §0.2 오른쪽 벡터)
        const side = (m.pos.x - ox) * rx + (m.pos.z - oz) * rz >= 0 ? 1 : -1;
        const spec = hitSpec(node.id, def, rank, cast.actionId, m.pos.x - rx * side, m.pos.z - rz * side);
        p.sk.hitIds.push(m.id);
        results.push(playerHit(ctx, m, spec));
      }
      const n = noteHits(ctx, results, false, cast.actionId);
      const rf = cast.params.refund;
      if (rf && n > 0) {
        addResource(ctx, (rf.ragePerHit ?? 0) * n);
        if (p.sk.hits >= rf.resetAt) {
          const cap = now + ticks(rf.resetTo);
          if (!(own(p.readyAt, node.id) && p.readyAt[node.id] <= cap)) p.readyAt[node.id] = cap;
        }
      }
    },
    hit: noop,   // 판정은 tick 이 시작 + 1틱부터 도착 틱까지 매 틱 한다
  },

  /** 회오리 — 채널 · 채널 틱(action 0.30 · scaled)마다 원 radius · 틱마다 새 actionId · 커서 쪽 이동(controller) · 유지 비용(actions) */
  spin: {
    act: 'channel',
    channel: true,
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const now = ctx.state.tick;
      const first = Math.max(1, Math.round(channelTicks(ctx, node.skill) * node.skill.hitFrac));
      p.channel = { skillId: node.id, nextAt: now + first, startedAt: now };
      if (cast.params.vortex) p.sk.nextAt = now + Math.max(1, ticks(cast.params.vortex.everySec));
      cast.hitT = first;
      cast.endT = first;
      ctx.emit(EV.CHANNEL, { skillId: node.id, on: true });
      return true;
    },
    tick(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const ch = p.channel;
      if (!ch) return;
      const now = ctx.state.tick;
      const def = node.skill, prm = cast.params;
      const vx = prm.vortex;
      if (vx && p.sk.nextAt >= 0 && now >= p.sk.nextAt) {
        const ts = derivedSpec(node.id, vx.coefPerSec * vx.tick, VORTEX_TYPE, TAGS_AOE_DOT, ctx.nextId(), p.pos.x, p.pos.z);
        playerEffect(ctx, prm.fxVortex, circle(p.pos.x, p.pos.z, vx.r), 0, null, { dur: vx.dur, tick: vx.tick, tickSpec: ts });
        p.sk.nextAt = now + Math.max(1, ticks(vx.everySec));
      }
      if (now < ch.nextAt) return;
      const actionId = ctx.nextId();
      p.actId = actionId;
      p.sk.hitIds = [];
      const spec = hitSpec(node.id, def, rank, actionId, p.pos.x, p.pos.z);
      /** @type {any} */ (spec).tickHit = true;   // 채널 틱 — 적중 회복 상한 COMBAT.lohTargetsTick(태그 'channel' 과 같은 뜻 · §5.6)
      const n = noteHits(ctx, playerHitShape(ctx, circle(p.pos.x, p.pos.z, def.radius), spec), false, actionId);
      if (prm.healPerTarget > 0 && n > 0) {
        const k = prm.healTargetsCap > 0 ? Math.min(n, prm.healTargetsCap) : n;
        healPlayer(ctx, p.lifeMax * prm.healPerTarget * k, 'skill');
      }
      ch.nextAt = now + channelTicks(ctx, def);
      p.actHit = now;
      p.actEnd = ch.nextAt;
      cast.actionId = actionId;
      cast.x = p.pos.x;
      cast.z = p.pos.z;
      emitActionHit(ctx, node.id, rank, cast);
    },
    hit: noop,   // 채널 판정은 tick 이 채널 틱마다
  },

  /** 전투 함성 — 버프(id = 노드 ID · value 방어도 배율 +) · 자원 생성(gen · 시작) · castHeal */
  buff: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const prm = cast.params;
      const sec = prm.buffSec ?? 0;
      const value = atRank(prm.value, rank);
      addBuff(ctx, node.id, sec, value);
      ctx.emit(EV.BUFF, { id: node.id, on: true, sec, value });
      if (prm.castHeal > 0) healPlayer(ctx, p.lifeMax * prm.castHeal, 'legend');
    },
  },

  /** 도약 — 커서(minRange..range · 벽 타일 앞 · 걷기 가능) · [시작, +i0) 출발점 · [+i0, +i1] 보간 · 뒤 목표 · 무적 [i0, i1) · 착지 원 */
  leap: {
    act: 'leap',
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      const { ux, uz, d } = dirOf(cast.tx - p.pos.x, cast.tz - p.pos.z, p.facing);
      const want = clamp(d, prm.minRange ?? 0, def.range);
      let tx = p.pos.x + ux * want, tz = p.pos.z + uz * want;
      if (ctx.map) {
        const land = leapLanding(ctx.map, p.pos.x, p.pos.z, tx, tz, p.r);
        tx = land.x;
        tz = land.z;
      }
      cast.tx = tx;
      cast.tz = tz;
      cast.facing = yawOf(ux, uz);
      const inv = prm.invuln ?? [0, 0];
      const t0 = ticks(inv[0]), t1 = Math.max(t0, ticks(inv[1]));
      if (cast.hitT < t1) cast.hitT = t1;   // 착지 판정 ≥ 도착
      if (cast.endT <= cast.hitT) cast.endT = cast.hitT + 1;
      const now = ctx.state.tick;
      p.air = { from: { x: p.pos.x, z: p.pos.z }, to: { x: tx, z: tz }, start: now + t0, end: now + cast.hitT, kind: 'leap' };
      return true;
    },
    tick(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const a = p.air;
      if (!a) return;
      const now = ctx.state.tick;
      const inv = cast.params.invuln ?? [0, 0];
      const t0 = p.actStart + ticks(inv[0]), t1 = Math.max(t0, p.actStart + ticks(inv[1]));
      let x, z;
      if (now < t0) { x = a.from.x; z = a.from.z; }
      else if (now < t1) {
        const t = (now - t0) / (t1 - t0);
        x = lerp(a.from.x, a.to.x, t);
        z = lerp(a.from.z, a.to.z, t);
      } else { x = a.to.x; z = a.to.z; }
      p.speed = Math.hypot(x - p.pos.x, z - p.pos.z) / DT;
      if (x !== p.pos.x || z !== p.pos.z) p.pos = { x, z };
      // 공중 무적: [t0, t1) — 무적이 끝나는 틱(t1)에 몸은 이미 도착점에 있다
      if (now >= t0 && now < t1 && p.invulnUntil < t1) p.invulnUntil = t1;
    },
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      if (p.air) p.pos = { x: p.air.to.x, z: p.air.to.z };
      const x = p.pos.x, z = p.pos.z;
      cast.x = x;
      cast.z = z;
      const spec = hitSpec(node.id, def, rank, cast.actionId, x, z);
      if (prm.landStun > 0) /** @type {any} */ (spec).stun = prm.landStun;
      noteHits(ctx, playerHitShape(ctx, circle(x, z, def.radius), spec), false, cast.actionId);
      shake(ctx, prm.shake);
      if (prm.landQuake) {
        const q = classNodeByBehavior(node.cls, 'quake');
        if (q) quakeWaves(ctx, q, Math.max(1, learnedRank(ctx, q.id)), x, z, prm.landQuake.mul ?? 1, skillParams(ctx, q.id), true);
      }
    },
  },

  /** 화염구 — 투사체 → 첫 몬스터 · 벽 · 사거리 끝에서 폭발 원 explodeR / split: ±spreadDeg n발 · mul / pierce: 관통 */
  fireball: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      const sp = prm.split;
      const n = sp && sp.n > 0 ? sp.n : 1;
      const spread = sp ? deg2rad(sp.spreadDeg ?? 0) : 0;
      const mul = sp ? sp.mul ?? 1 : 1;
      const visual = sp ? prm.visualSplit ?? prm.visual : prm.visual;
      for (let i = 0; i < n; i++) {
        const f = cast.facing + (i - (n - 1) / 2) * spread;
        const spec = hitSpec(node.id, def, rank, cast.actionId, p.pos.x, p.pos.z);
        spec.coef *= mul;
        // 접촉 적중과 폭발이 같은 정의 — 폭발이 판정이다(첫 대상이 두 번 맞지 않게 — NOTES-P1)
        const explode = { r: prm.explodeR, spec: { ...spec, tags: spec.tags.slice() }, visual };
        playerProj(ctx, visual, f, prm.speed, prm.range ?? def.range, prm.r, prm.pierce ?? 0, spec, explode);
      }
    },
  },

  /** 메테오 — 커서(range 로 자름) · 효과 하나(delay · 원 radius · 충돌 spec · 불타는 바닥 tickSpec) / shower: 작은 메테오 n */
  meteor: {
    act: 'cast',
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const { ux, uz, d } = dirOf(cast.tx - p.pos.x, cast.tz - p.pos.z, p.facing);
      const want = Math.min(d, node.skill.range);
      cast.tx = p.pos.x + ux * want;
      cast.tz = p.pos.z + uz * want;
      return true;
    },
    hit(ctx, node, rank, cast) {
      const def = node.skill, prm = cast.params;
      meteorAt(ctx, node, rank, cast, cast.tx, cast.tz, def.radius, prm.delay ?? 0, 1);
      const sh = prm.shower;
      if (sh && sh.n > 0) {
        for (let i = 0; i < sh.n; i++) {
          const a = cast.facing + Math.PI / 2 + (i * 2 * Math.PI) / sh.n;
          meteorAt(ctx, node, rank, cast, cast.tx + fwdX(a) * def.radius, cast.tz + fwdZ(a) * def.radius, sh.r, (prm.delay ?? 0) + (i + 1) * (sh.delay ?? 0), sh.mul ?? 1);
        }
      }
    },
  },

  /** 서리 노바 — 제자리 원 · 냉기 점수 / shards: n발 투사체(관통) */
  nova: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      novaBurst(ctx, node, rank, cast.params, cast.actionId, cast.facing);
    },
  },

  /** 마력 보호막 — player.shield = 생명 최대 × absorbPct(갱신 · 합치지 않는다) · 버프 dur */
  shield: {
    act: 'cast',
    start: yes,
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const prm = cast.params;
      const absorb = p.lifeMax * atRank(prm.absorbPct, rank);
      p.shield = absorb;
      addBuff(ctx, node.id, prm.dur ?? 0, absorb);
      ctx.emit(EV.BUFF, { id: node.id, on: true, sec: prm.dur ?? 0, value: absorb });
    },
  },

  /** 연쇄 번개 — 첫 대상(hover · 커서 집기) → 튕김(bounceR 안 가장 가까운 · 안 맞은 것) × (bounces + bouncesAdd) · 튕길 때마다 × decay */
  chain: {
    act: 'cast',
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const mon = pickChainTarget(ctx, node.skill, cast.params, cast.targetId, cast.tx, cast.tz);
      if (!mon) { cast.fail = 'noTarget'; return false; }
      cast.targetId = mon.id;
      cast.tx = mon.pos.x;
      cast.tz = mon.pos.z;
      const dx = mon.pos.x - p.pos.x, dz = mon.pos.z - p.pos.z;
      if (dx || dz) cast.facing = yawOf(dx, dz);
      return true;
    },
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const def = node.skill, prm = cast.params;
      const first = targetAlive(ctx, cast.targetId) ?? pickChainTarget(ctx, def, prm, null, cast.tx, cast.tz);
      if (!first) return;
      const bounces = atRank(prm.bounces, rank) + (prm.bouncesAdd > 0 ? prm.bouncesAdd : 0);
      const hitIds = [first.id];
      const pts = [{ x: p.pos.x, z: p.pos.z }, { x: first.pos.x, z: first.pos.z }];
      let coef = atRank(def.coef, rank);
      const specFor = (c) => {
        const s = hitSpec(node.id, def, rank, cast.actionId, p.pos.x, p.pos.z);
        s.coef = c;
        return s;
      };
      const results = [playerHit(ctx, first, specFor(coef))];
      let cur = first;
      for (let k = 0; k < bounces; k++) {
        const next = nearestMonster(ctx, cur.pos.x, cur.pos.z, prm.bounceR ?? 0, (m) => !hitIds.includes(m.id));
        if (!next) break;
        coef *= prm.decay ?? 1;
        hitIds.push(next.id);
        pts.push({ x: next.pos.x, z: next.pos.z });
        results.push(playerHit(ctx, next, specFor(coef)));
        cur = next;
      }
      noteHits(ctx, results, false, cast.actionId);
      playerEffect(ctx, prm.fx, { type: 'poly', x: p.pos.x, z: p.pos.z, pts }, 0, null, { dur: prm.arcSec ?? 0 });
    },
  },

  /** 순간이동 — 커서(range 로 자름 · 가장 가까운 걷기 가능 점 · 벽을 건넌다) · 판정 틱에 위치 이동 / blast: 출발 · 도착 폭발 / arrivalNova */
  blink: {
    act: 'blink',
    start(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const prm = cast.params;
      const range = prm.range ?? node.skill.range;
      const { ux, uz, d } = dirOf(cast.tx - p.pos.x, cast.tz - p.pos.z, p.facing);
      const want = Math.min(d, range);
      let tx = p.pos.x + ux * want, tz = p.pos.z + uz * want;
      if (ctx.map) {
        const land = blinkLanding(ctx.map, p.pos.x, p.pos.z, tx, tz, p.r);
        tx = land.x;
        tz = land.z;
      }
      cast.tx = tx;
      cast.tz = tz;
      if (d > 0) cast.facing = yawOf(ux, uz);
      return true;
    },
    hit(ctx, node, rank, cast) {
      const p = ctx.state.player;
      const prm = cast.params;
      const fx = p.pos.x, fz = p.pos.z;
      if (prm.blast) blastAt(ctx, node, rank, prm, cast.actionId, fx, fz);
      p.pos = { x: cast.tx, z: cast.tz };
      p.prevPos = { x: cast.tx, z: cast.tz };   // 보간을 끊는다(§5.12)
      p.path = [];
      if (prm.blast) blastAt(ctx, node, rank, prm, cast.actionId, cast.tx, cast.tz);
      if (prm.arrivalNova) {
        const nv = classNodeByBehavior(node.cls, 'nova');
        if (nv) {
          const nr = Math.max(1, Math.min(nv.maxRank, learnedRank(ctx, nv.id)));
          const nid = ctx.nextId();
          novaBurst(ctx, nv, nr, skillParams(ctx, nv.id), nid, cast.facing);
          emitActionHit(ctx, nv.id, nr, { ...cast, nodeId: nv.id, rank: nr, actionId: nid, x: cast.tx, z: cast.tz });
        }
      }
    },
  },
};

// ───────────────────────── 조회(순수) ─────────────────────────

/** params 를 그 랭크의 숫자로 펼친다(연출 ID 문자열은 뺀다 · 패치 객체는 같은 규칙으로) */
function flattenAtRank(v, rank) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length && typeof v[0] === 'number' ? atRank(v, rank) : undefined;
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      const x = flattenAtRank(v[k], rank);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return undefined;
}

/**
 * 순수 — ui 툴팁 · 스킬 패널 전/후(§10.6). nodeId 는 노드 ID 또는 BASIC_SKILLS ID('bash' · 'magicBolt').
 * dmgMin/Max = 무기 피해 × coef × (1 + 주 능력치/100) × (1 + 종류 · 스킬 · 범위 피해 %) — 치명타 전 · 저항 없는 대상 · 판정 한 번(파동 · 채널 틱 · 튕김 하나).
 * cost = 비용 × (1 − costReduce) · cd = 쿨 × (1 − cdr)(초) · range · radius(m) · extra = 그 랭크의 상태 · 동작 수치(패치 포함) · gen · costPerSec · actionSec.
 * 패치는 stats.transforms · stats.ranks(변형 1랭크) · stats.hooks(전설)로 본다. rank 는 [1, maxRank]로 자른다.
 * @param {PlayerStats|null} stats @param {string} nodeId @param {number} rank
 * @returns {{coefPct:number, dmgMin:number, dmgMax:number, cost:number, cd:number, range:number, radius:number, extra:Object}}
 */
export function describeSkill(stats, nodeId, rank) {
  const out = { coefPct: 0, dmgMin: 0, dmgMax: 0, cost: 0, cd: 0, range: 0, radius: 0, extra: {} };
  const node = nodeOf(nodeId);
  if (!node || !node.skill) return out;
  const def = node.skill;
  const r = clamp(Math.floor(rank) || 1, 1, node.maxRank);
  const tr = stats?.transforms;
  const rk = stats?.ranks;
  const prm = mergeParams(node, (id) => (Array.isArray(tr) && tr.includes(id)) || (!!rk && own(rk, id) && rk[id] > 0), stats?.hooks);
  const coef = atRank(def.coef, r);
  out.coefPct = coef * 100;
  if (def.type) {
    const add = (stats?.dmgPct?.[def.type] ?? 0) + (stats?.skillPct?.[node.id] ?? 0) + (def.tags.includes('aoe') ? stats?.aoePct ?? 0 : 0);
    const k = coef * (1 + (stats?.main ?? 0) / 100) * (1 + add);
    out.dmgMin = (stats?.weapon?.min ?? 0) * k;
    out.dmgMax = (stats?.weapon?.max ?? 0) * k;
  }
  out.cost = def.cost * (1 - (stats?.costReduce ?? 0));
  out.cd = cdAt(def, r) * (1 - (stats?.cdr ?? 0));
  out.range = def.range ?? def.reach ?? (typeof prm.range === 'number' ? prm.range : 0);
  out.radius = def.radius ?? 0;
  /** @type {Record<string, any>} */
  const extra = {};
  const fp = flattenAtRank(prm, r);
  if (fp && typeof fp === 'object') Object.assign(extra, fp);
  if (def.status) for (const k of Object.keys(def.status)) extra[k] = atRank(def.status[k], r);
  if (def.gen) extra.gen = def.gen;
  if (def.costPerSec) extra.costPerSec = def.costPerSec * (1 - (stats?.costReduce ?? 0));
  extra.actionSec = actionSec(def, stats?.aps ?? APS_REF);
  if (prm.absorbPct !== undefined) extra.absorb = (stats?.lifeMax ?? 0) * atRank(prm.absorbPct, r);
  out.extra = extra;
  return out;
}

/**
 * 순수 — HUD 쿨다운 부채 · 스킬 바(초). BASIC_SKILLS ID 도 받는다. 모르는 ID 면 {false, 0, 0, false}.
 * canAfford = 자원 ≥ 비용 × (1 − costReduce) · cooldownLeft = (readyAt − tick)/30 · cooldownTotal = 그 랭크의 쿨 × (1 − cdr)
 * @param {GameState} state @param {PlayerStats|null} stats @param {string} nodeId
 * @returns {{canAfford:boolean, cooldownLeft:number, cooldownTotal:number, ready:boolean}}
 */
export function skillReady(state, stats, nodeId) {
  const node = nodeOf(nodeId);
  if (!node || !node.skill) return { canAfford: false, cooldownLeft: 0, cooldownTotal: 0, ready: false };
  const def = node.skill;
  const p = state?.player;
  const tick = state?.tick ?? 0;
  const ranks = state?.char?.skills?.ranks;
  const learned = isBasicNode(node) ? 1 : ranks && own(ranks, nodeId) ? ranks[nodeId] : 0;
  const rank = clamp(Math.floor(learned) || 1, 1, node.maxRank);
  const cost = def.cost * (1 - (stats?.costReduce ?? 0));
  const canAfford = !p || p.resource >= cost;
  const total = cdAt(def, rank) * (1 - (stats?.cdr ?? 0));
  const readyAt = p && p.readyAt && own(p.readyAt, nodeId) ? p.readyAt[nodeId] : 0;
  const left = readyAt > tick ? secOf(readyAt - tick) : 0;
  return { canAfford, cooldownLeft: left, cooldownTotal: total, ready: canAfford && left <= 0 };
}

/** 스킬 바 칸 i 의 스킬 ID(없으면 null) @param {import('../../types.js').CharacterState|null} char @param {number} i */
export function barSkill(char, i) {
  if (!char || !char.skills || !Array.isArray(char.skills.bar) || i < 0 || i >= SKILL_BAR) return null;
  const id = char.skills.bar[i];
  return typeof id === 'string' && id ? id : null;
}
