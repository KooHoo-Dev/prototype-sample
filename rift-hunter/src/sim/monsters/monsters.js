// OWNER: P3 — 계약 §6.9 · §5.17 · §8.1 · §8.2 · §8.3
// 몬스터 프레임워크 한 틱(updateMonsters) — 잠/깨움(팩 연결 · 상한) · 상태 관문 · 넉백 · 공격 진행(strike · MON_STRIKE) · 생각(BEHAVIORS) ·
// 이동(흐름장 · 직선 · 밀어내기 · 플레이어 원) · 속성 틱(hazard 는 팩 대표만) · 다시 잠 · targeting.
// ctx.hooks 의 onMonSpawn · onMonDamaged · onMonDeath · onMonHitPlayer 를 구현한다. spawn.js 의 넷을 다시 내보낸다.
// 프레임워크 파일이다 — 콘텐츠 ID 로 분기하지 않는다(차이는 행의 behavior · 속성 hook · 데이터 필드로만). 레지스트리를 import 하는 것은 이 파일뿐(+ behaviors.js 의 수호자 위임).
// 할당: 매 틱 도는 경로는 이웃 질의 버퍼 · 대표 캐시를 다시 쓴다(moveCircle 의 결과 객체 하나만 몬스터마다 생긴다).

import { DT } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { turnToward, yawOf } from '../../core/math.js';
import { ticks } from '../../core/time.js';
import { MON_AFFIXES_BY_ID, getMonDef } from '../../data/index.js';
import { FLOW } from '../../data/mapgen.js';
import { MON } from '../../data/monsters.js';
import { riftRow } from '../../data/rift.js';
import { awakeCount, getMonster } from '../entities.js';
import { monSpeedMul } from '../status.js';
import { createFlow, flowDir, updateFlow } from '../world/flow.js';
import { losClear, moveCircle } from '../world/nav.js';
import { AFFIX_HOOKS } from './affixHooks/index.js';
import { BEHAVIORS } from './behaviors.js';
import { GUARDIAN_IMPLS } from './guardians/index.js';
import { rollAffixes } from './packs.js';
import {
  aliveMon, attackOf, firstMelee, isAttackAct, isDisabled, isPreHitAct, packOf, packRep, seesPlayer, sleepMonster, spawnMonster, strikeDefault,
  wakeMonster,
} from './spawn.js';

export { monsterStats, spawnMonster, startAttack, findGuardianSpot } from './spawn.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').MonsterDef} MonsterDef */
/** @typedef {import('../../types.js').AttackDef} AttackDef */
/** @typedef {import('../../types.js').PackState} PackState */
/** @typedef {import('../../types.js').PlayerState} PlayerState */

/** 이웃 질의 버퍼(재사용) @type {number[]} */
const NEIGH = [];
/** 이번 틱 팩 대표 캐시(packId → 대표 ID) — updateMonsters 가 틱마다 비운다 */
const REP = new Map();
/** 리뷰 수정: 먼 흐름장(FLOW.far) — ctx.flow(균열 장면마다 새로 만든다)에 묶는다 · 상태가 아니다(흐름장처럼 플레이어 자리에서 다시 만든다) */
const FAR = new WeakMap();

/**
 * 먼 흐름장의 방향|null — 흐름장(FLOW.maxSteps) 밖의 깬 몬스터만 묻는다(그때만 만든다 · FLOW.far 의 간격 · 한도)
 * @param {SimCtx} ctx @param {import('../../types.js').MapData} map @param {MonsterState} m
 */
function farFlowDir(ctx, map, m) {
  const flow = ctx.flow;
  if (!flow || !map) return null;
  let far = FAR.get(flow);
  if (!far || far.dist.length !== map.nw * map.nh) { far = createFlow(map); FAR.set(flow, far); }
  updateFlow(far, map, ctx.state.player.pos, ctx.state.tick, false, FLOW.far);
  return flowDir(far, map, m.pos.x, m.pos.z);
}
/** 겹친 두 몸을 떼어 놓을 방향(같은 자리) — 황금각 */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ───────────────────────── 한 틱 ─────────────────────────

/**
 * §5.17 몬스터 한 틱 — 살아 있고 gone 이 아닌 것 · 배열 순서 · 이번 틱에 생긴 것은 다음 틱부터 · 생명 ≤ 0 이면 행동 · 판정 없음(§5.16-1)
 * @param {SimCtx} ctx
 */
export function updateMonsters(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift || !ctx.map) return;
  const tick = st.tick;
  REP.clear();
  const mons = rift.mons;
  for (let i = 0, n = mons.length; i < n; i++) {
    const m = mons[i];
    if (m.gone || m.dead) continue;
    if (m.hp <= 0) { m.targeting = false; continue; }
    if (!m.awake) {
      m.targeting = false;
      if (m.act === 'vanish' && tick >= m.actEnd) m.act = 'idle';   // 잠든 채 사라져 있지 않다(진정 · 잠이 사라짐 도중에 왔을 때)
      if ((tick + m.id) % MON.wakeCheckT === 0) sightCheck(ctx, m);
      continue;
    }
    updateOne(ctx, m, tick);
  }
}

/** 1 잠 — 플레이어가 aggro 안이고 시야(벽)가 트이면 팩을 깨운다 @param {SimCtx} ctx @param {MonsterState} m */
function sightCheck(ctx, m) {
  const p = ctx.state.player;
  if (p.dead || !ctx.map) return;
  const def = getMonDef(m.typeId);
  const dx = p.pos.x - m.pos.x, dz = p.pos.z - m.pos.z;
  if (dx * dx + dz * dz > def.aggro * def.aggro) return;
  if (!losClear(ctx.map, m.pos.x, m.pos.z, p.pos.x, p.pos.z)) return;
  wakeFrom(ctx, m, 'sight');
}

/** 깨어 있는 몬스터 하나의 한 틱(§5.17 2~9) @param {SimCtx} ctx @param {MonsterState} m @param {number} tick */
function updateOne(ctx, m, tick) {
  const def = getMonDef(m.typeId);
  const bh = /** @type {any} */ (BEHAVIORS)[def.behavior] ?? BEHAVIORS.melee;
  const b = /** @type {any} */ (m.ax.b ?? (m.ax.b = { move: 'chase', spd: 1, wokeAt: tick }));
  m.vel.x = 0;
  m.vel.z = 0;

  // 2 상태 관문 — 기절 · 빙결 · 경직 · 사라짐 중이면 4~6 을 건너뛴다. 사라짐은 actEnd 틱에 idle(그 틱의 4~6 도 건너뛴다 — 훅이 7 에서 자리를 옮긴다)
  let busy = false;
  if (m.act === 'vanish') {
    if (tick >= m.actEnd || m.actEnd < m.actStart) { m.act = 'idle'; m.actId = null; }
    busy = true;
  }
  if (isDisabled(m, tick)) busy = true;
  else if (m.act === 'stunned' || m.act === 'frozen' || m.act === 'flinch') { m.act = 'idle'; m.actId = null; }

  // 3 넉백 — 남아 있으면 그만큼 이동하고 4~6 으로 가지 않는다
  if (m.knock && tick < m.knock.until) {
    const ox = m.pos.x, oz = m.pos.z;
    const np = moveCircle(ctx.map, m.pos, m.r, m.knock.vx * DT, m.knock.vz * DT);
    m.pos.x = np.x;
    m.pos.z = np.z;
    m.vel.x = (np.x - ox) / DT;
    m.vel.z = (np.z - oz) / DT;
    busy = true;
  }

  if (!busy) {
    // 4 행동 진행
    if (isAttackAct(m.act)) progressAttack(ctx, m, def, bh, tick);
    else if (m.act === 'flee' && tick >= m.actEnd) { m.act = 'idle'; b.spd = 1; }
    if (m.hp > 0) {
      // 5 생각
      if (m.act === 'idle' || m.act === 'move') {
        b.spd = 1;
        bh.think(ctx, m, def);
      }
      // 6 이동
      if (m.act === 'idle' || m.act === 'move' || m.act === 'flee') moveOne(ctx, m, def, b, tick);
    }
  }
  if (m.hp <= 0 || m.dead || m.gone) { m.targeting = false; return; }

  // 7 속성 틱(깨어 있으면 늘 — hazard 속성은 팩의 대표만)
  const list = m.affixes;
  for (let k = 0; k < list.length; k++) {
    const row = MON_AFFIXES_BY_ID[list[k]];
    if (!row) continue;
    const hook = /** @type {any} */ (AFFIX_HOOKS)[row.hook];
    if (!hook || typeof hook.onAwakeTick !== 'function') continue;
    if (row.hazard && repOf(ctx, m) !== m.id) continue;
    hook.onAwakeTick(ctx, m, row, axOf(m, row.id));
    if (!m.awake || m.hp <= 0) break;
  }
  if (!m.awake) return;

  // 8 다시 잠 · 9 targeting
  const p = ctx.state.player.pos;
  const dx = p.x - m.pos.x, dz = p.z - m.pos.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > MON.leash * MON.leash) {
    if (m.sleepAt < 0) m.sleepAt = tick;
    else if (tick - m.sleepAt >= ticks(MON.leashSec)) { putToSleep(ctx, m); return; }
  } else {
    m.sleepAt = -1;
  }
  // 리뷰 수정: 어느 흐름장으로도 플레이어에 닿지 않는 채 MON.leashSec 이 지나면(벽 앞 직선 추격) 잠든다 — 직선 거리 목줄과 같은 처리
  const bb = /** @type {any} */ (m.ax.b);
  if (bb && bb.lostSeenAt === tick && bb.lostAt >= 0 && tick - bb.lostAt >= ticks(MON.leashSec)) { bb.lostAt = -1; putToSleep(ctx, m); return; }
  m.targeting = d2 <= MON.targetingRange * MON.targetingRange && m.act !== 'flee';
}

/** 속성 · 행동 훅 상태(처음엔 {}) @param {MonsterState} m @param {string} id */
function axOf(m, id) {
  return m.ax[id] ?? (m.ax[id] = {});
}

/** 이번 틱 팩 대표(캐시) @param {SimCtx} ctx @param {MonsterState} m */
function repOf(ctx, m) {
  if (!(m.packId >= 0)) return m.rank === 'minion' ? -1 : m.id;
  let r = REP.get(m.packId);
  if (r === undefined) {
    r = packRep(ctx, m);
    REP.set(m.packId, r);
  }
  return r;
}

// ───────────────────────── 4 공격 진행 ─────────────────────────

/** 공격을 끝낸다(idle) @param {MonsterState} m */
function endAttack(m) {
  m.act = 'idle';
  m.actId = null;
  m.aim = null;
  m.aimLocked = false;
}

/**
 * 예비 동안 조준(aim — 투사체 · 조준선)은 플레이어를 따라가다 actHit − aimLock 부터 멈춘다(aimLocked). aimLock 이 없으면 판정 틱까지 따라간다.
 * @param {SimCtx} ctx @param {MonsterState} m @param {AttackDef} atk @param {number} tick
 */
function aimUpdate(ctx, m, atk, tick) {
  if (m.aimLocked || !m.aim) return;
  if (typeof atk.aimLock === 'number' && tick >= m.actHit - ticks(atk.aimLock)) { m.aimLocked = true; return; }
  const p = ctx.state.player.pos;
  m.aim.x = p.x;
  m.aim.z = p.z;
}

/**
 * 공격 중 — [actStart, actHit) 예비(조준 갱신) → actHit 틱에 strike(행동의 strike · 없으면 기본) → MON_STRIKE → act strike → recover → actEnd 에 idle.
 * 행동의 tickAttack 이 true 면 그 틱을 맡는다(돌진 달리기).
 * @param {SimCtx} ctx @param {MonsterState} m @param {MonsterDef} def @param {any} bh @param {number} tick
 */
function progressAttack(ctx, m, def, bh, tick) {
  const atk = attackOf(def, m.actId);
  if (!atk) { endAttack(m); return; }
  if (typeof bh.tickAttack === 'function' && bh.tickAttack(ctx, m, def, atk)) return;
  if (isPreHitAct(m.act)) {
    if (tick < m.actHit) { aimUpdate(ctx, m, atk, tick); return; }
    m.act = 'strike';
    if (typeof bh.strike === 'function') bh.strike(ctx, m, def, atk);
    else strikeDefault(ctx, m, def, atk);
    ctx.emit(EV.MON_STRIKE, { id: m.id, actId: atk.id, x: m.pos.x, z: m.pos.z, facing: m.facing });
    if (m.act === 'strike' && tick >= m.actEnd) endAttack(m);
    return;
  }
  if (m.act === 'strike') m.act = 'recover';
  if (m.act === 'recover' && tick >= m.actEnd) endAttack(m);
}

// ───────────────────────── 6 이동 ─────────────────────────

/**
 * 이동 배율 — 기절 · 빙결이면 0 · 냉기(chill > 0) × (1 − chillSlow) · 감속 × (1 − pct)(§5.8 · 속성 speedMul 은 mon.speed 에 이미 있다).
 * W1 확정(통합 게이트): 계약의 정본 status.monSpeedMul 에 맡긴다(같은 규칙을 두 곳에 두지 않는다).
 * @param {MonsterState} m @param {number} tick
 */
export function moveMul(m, tick) {
  return monSpeedMul(m, tick);
}

/** chase 정지 거리 = r + 첫 근접 reach × stopFrac + player.r(근접이 없으면 r + sepPad + player.r) @param {MonsterState} m @param {MonsterDef} def @param {PlayerState} p */
export function chaseStop(m, def, p) {
  const atk = firstMelee(def);
  return m.r + (atk ? (atk.reach ?? 0) * MON.stopFrac : MON.sepPad) + p.r;
}

/** 이번 틱 움직이지 않을 이웃(구조물 · 공격 중 · 기절/빙결 · 잠) — 밀어내기를 혼자 다 진다 @param {MonsterState} o @param {number} tick */
function staysPut(o, tick) {
  return !(o.speed > 0) || isAttackAct(o.act) || isDisabled(o, tick) || !o.awake || o.act === 'vanish';
}

/**
 * §5.17-6 — 목표 방향(chase: 플레이어가 directChaseR 안 · 시야면 직선, 아니면 flowDir(ctx.flow, ctx.map, x, z) — null 이면 직선 · 정지 거리에서 멈춘다 /
 * flee: 반대쪽 / kite: keepMin..keepMax(시야가 막히거나 멀면 chase · 가까우면 뒷걸음 — backoff 안이면 backoffMul) / hold / {x, z}) ×
 * speed × 냉기 · 감속 × b.spd + 밀어내기(r + sepQueryPad 안 · 최대 sepMaxNeighbors · 겹친 만큼의 절반 · 움직이지 않을 이웃이면 전부) +
 * 플레이어 원(겹쳐 있으면 밀려난다) → nav.moveCircle. facing 은 이동 방향(멈춰 있거나 kite · hold 면 플레이어 쪽)으로 turnRate.
 * @param {SimCtx} ctx @param {MonsterState} m @param {MonsterDef} def @param {any} b @param {number} tick
 */
function moveOne(ctx, m, def, b, tick) {
  const map = /** @type {import('../../types.js').MapData} */ (ctx.map);
  const p = ctx.state.player;
  const px = p.pos.x, pz = p.pos.z;
  const dx = px - m.pos.x, dz = pz - m.pos.z;
  const d = Math.hypot(dx, dz);
  const ux = d > 0 ? dx / d : Math.sin(m.facing), uz = d > 0 ? dz / d : Math.cos(m.facing);
  if (!(m.speed > 0) || !(def.speed > 0)) {
    if (def.turnRate > 0 && d > 0) m.facing = turnToward(m.facing, yawOf(dx, dz), def.turnRate * DT);
    if (m.act === 'move') m.act = 'idle';
    return;
  }
  const spd = m.speed * moveMul(m, tick) * (b.spd > 0 ? b.spd : 1);
  const pr = def.params ?? {};
  let move = b.move ?? 'chase';
  if (move === 'kite') {
    if (d > (pr.keepMax ?? 0) || !seesPlayer(ctx, m, true)) move = 'chase';
    else if (d < (pr.keepMin ?? 0)) move = 'back';
    else move = 'hold';
  }
  let mx = 0, mz = 0, want = 0, faceP = false;
  if (move === 'chase') {
    const stopD = chaseStop(m, def, p);
    if (d > stopD) {
      if (d <= MON.directChaseR && losClear(map, m.pos.x, m.pos.z, px, pz)) {
        mx = ux; mz = uz;
        want = Math.min(spd * DT, d - stopD);
      } else {
        let f = ctx.flow ? flowDir(ctx.flow, map, m.pos.x, m.pos.z) : null;
        // 리뷰 수정: 흐름장 밖(경로가 maxSteps 넘게 먼 벽 너머)이면 먼 흐름장(FLOW.far — 맵 전체 · 필요할 때만)을 따라 돌아온다
        if (!f || (f.x === 0 && f.z === 0)) f = farFlowDir(ctx, map, m);
        if (f && (f.x !== 0 || f.z !== 0)) {
          const fl = Math.hypot(f.x, f.z);
          mx = f.x / fl; mz = f.z / fl;
          want = spd * DT;
        } else {
          // 어느 흐름장으로도 닿지 않는다 — 직선(옛 동작) · 이 상태가 연속으로 MON.leashSec 이어지면 잠든다(8 다시 잠 — 벽 앞에 영영 깬 채 서지 않게)
          mx = ux; mz = uz;
          want = Math.min(spd * DT, d - stopD);
          if (!(b.lostSeenAt === tick - 1 && b.lostAt >= 0)) b.lostAt = tick;
          b.lostSeenAt = tick;
        }
      }
    } else {
      faceP = true;
    }
  } else if (move === 'flee') {
    mx = -ux; mz = -uz;
    want = spd * DT;
  } else if (move === 'back') {
    mx = -ux; mz = -uz;
    want = spd * DT * (pr.backoff > 0 && d < pr.backoff ? (pr.backoffMul ?? 1) : 1);
    faceP = true;
  } else if (move && typeof move === 'object' && Number.isFinite(move.x) && Number.isFinite(move.z)) {
    const tx = move.x - m.pos.x, tz = move.z - m.pos.z;
    const tl = Math.hypot(tx, tz);
    if (tl > MON.moveEps) { mx = tx / tl; mz = tz / tl; want = Math.min(spd * DT, tl); }
    else faceP = true;
  } else {
    faceP = true;
  }

  // 밀어내기 — 이웃과 겹친 만큼의 절반(움직이지 않을 이웃이면 전부) · 한 틱 상한
  let sx = 0, sz = 0;
  NEIGH.length = 0;
  ctx.space.query(m.pos.x, m.pos.z, m.r + MON.sepQueryPad, NEIGH);
  let cnt = 0;
  for (let i = 0; i < NEIGH.length && cnt < MON.sepMaxNeighbors; i++) {
    const id = NEIGH[i];
    if (id === m.id) continue;
    const o = getMonster(ctx, id);
    if (!o || !aliveMon(o)) continue;
    const ox = m.pos.x - o.pos.x, oz = m.pos.z - o.pos.z;
    const od = Math.hypot(ox, oz);
    const minD = m.r + o.r + MON.sepPad;
    if (od >= minD) continue;
    cnt += 1;
    const share = staysPut(o, tick) ? 1 : 0.5;
    let nx, nz;
    if (od > 0) { nx = ox / od; nz = oz / od; }
    else { const a = (m.id - o.id) * GOLDEN; nx = Math.sin(a); nz = Math.cos(a); }
    sx += nx * (minD - od) * share;
    sz += nz * (minD - od) * share;
  }
  const sl = Math.hypot(sx, sz);
  if (sl > MON.sepMaxStep) { sx *= MON.sepMaxStep / sl; sz *= MON.sepMaxStep / sl; }

  // 플레이어 원 — 겹쳐 있으면 몬스터가 밀려난다(플레이어가 미는 것은 controller §5.2-8)
  const minP = m.r + p.r;
  if (!p.dead && d < minP) {
    sx -= ux * (minP - d);
    sz -= uz * (minP - d);
  }

  const tx = mx * want + sx, tz = mz * want + sz;
  let moved = 0;
  if (Math.abs(tx) + Math.abs(tz) > 0) {
    const ox = m.pos.x, oz = m.pos.z;
    const np = moveCircle(map, m.pos, m.r, tx, tz);
    m.pos.x = np.x;
    m.pos.z = np.z;
    m.vel.x = (np.x - ox) / DT;
    m.vel.z = (np.z - oz) / DT;
    moved = Math.hypot(np.x - ox, np.z - oz);
  }
  if (move === 'back') b.stuck = want > 0 && moved < want * MON.stuckFrac;
  else b.stuck = false;

  // facing — 이동 방향(멈춰 있으면 · 뒷걸음 · hold 면 플레이어 쪽)
  let target = null;
  if (faceP) target = d > 0 ? yawOf(dx, dz) : null;
  else if (want > 0) target = yawOf(mx, mz);
  if (target !== null && def.turnRate > 0) m.facing = turnToward(m.facing, target, def.turnRate * DT);
  if (m.act === 'idle' || m.act === 'move') m.act = moved > MON.moveEps ? 'move' : 'idle';
}

// ───────────────────────── 잠 · 깨움 ─────────────────────────

/**
 * 팩 깨우기 · MON_WAKE(팩 단위 · 새로 깬 수). 'sight' · 'link'는 깨어 있는 수가 MON.maxAwake(120)면 새로 깨지 않는다(구성원마다 · 피격 'damage' · 'debug'는 예외).
 * 'link'가 아니면 깨는 팩의 구성원에서 MON.linkRadius(8m) 안의 다른 잠든 팩도 한 단계('link') 깨운다.
 * @param {SimCtx} ctx @param {number} packId @param {'sight'|'damage'|'link'|'debug'} why @returns {number} 새로 깬 수
 */
export function wakePack(ctx, packId, why) {
  const pack = packOf(ctx, packId);
  if (!pack) return 0;
  const capped = why === 'sight' || why === 'link';
  let awakeN = capped ? awakeCount(ctx) : 0;
  let n = 0, fx = pack.anchor?.x ?? 0, fz = pack.anchor?.z ?? 0;
  const ids = pack.memberIds;
  for (let i = 0; i < ids.length; i++) {
    const m = getMonster(ctx, ids[i]);
    if (!m || m.awake || !aliveMon(m)) continue;
    if (capped && awakeN >= MON.maxAwake) break;
    if (!wakeMonster(ctx, m)) continue;
    if (n === 0) { fx = m.pos.x; fz = m.pos.z; }
    n += 1;
    awakeN += 1;
  }
  if (n > 0 || ids.some(id => { const m = getMonster(ctx, id); return !!m && m.awake && aliveMon(m); })) pack.awake = true;
  if (n > 0) {
    ctx.emit(EV.MON_WAKE, { packId: pack.id, kind: pack.kind, x: fx, z: fz, count: n });
    if (why !== 'link' && why !== 'debug') linkWake(ctx, pack);
  }
  return n;
}

/** 팩 연결 — 이 팩의 살아 있는 구성원에서 linkRadius 안에 잠든 구성원이 있는 다른 잠든 팩을 'link'로 @param {SimCtx} ctx @param {PackState} pack */
function linkWake(ctx, pack) {
  const rift = ctx.state.rift;
  if (!rift) return;
  // W1 수정(NOTES-W1FIX · 초반 경사): 깊이 < MON.linkMinDepth 인 팩(시작 방 · 그 이웃)은 연결로 깨우지도 깨지도 않는다(depth 가 없으면 깊은 팩)
  const minDepth = MON.linkMinDepth > 0 ? MON.linkMinDepth : 0;
  if (minDepth > 0 && (pack.depth ?? minDepth) < minDepth) return;
  const r2 = MON.linkRadius * MON.linkRadius;
  const packs = rift.packs;
  for (let i = 0; i < packs.length; i++) {
    const q = packs[i];
    if (q === pack || q.awake) continue;
    if (minDepth > 0 && (q.depth ?? minDepth) < minDepth) continue;
    let near = false;
    for (let a = 0; a < q.memberIds.length && !near; a++) {
      const qm = getMonster(ctx, q.memberIds[a]);
      if (!qm || qm.awake || !aliveMon(qm)) continue;
      for (let c = 0; c < pack.memberIds.length; c++) {
        const pm = getMonster(ctx, pack.memberIds[c]);
        if (!pm || pm.gone) continue;
        const dx = pm.pos.x - qm.pos.x, dz = pm.pos.z - qm.pos.z;
        if (dx * dx + dz * dz <= r2) { near = true; break; }
      }
    }
    if (near) wakePack(ctx, q.id, 'link');
  }
}

/** 몬스터에서 깨우기 — 팩이 있으면 팩째, 없으면 그 하나(MON_WAKE · 상한은 wakePack 과 같다) @param {SimCtx} ctx @param {MonsterState} m @param {'sight'|'damage'|'link'|'debug'} why */
function wakeFrom(ctx, m, why) {
  if (packOf(ctx, m.packId)) { wakePack(ctx, m.packId, why); return; }
  if ((why === 'sight' || why === 'link') && awakeCount(ctx) >= MON.maxAwake) return;
  if (wakeMonster(ctx, m)) ctx.emit(EV.MON_WAKE, { packId: m.packId, kind: m.rank === 'champion' || m.rank === 'elite' || m.rank === 'guardian' ? m.rank : 'normal', x: m.pos.x, z: m.pos.z, count: 1 });
}

/** 8 다시 잠 — 그 자리에서 · 생명 유지 · 팩에 깨어 있는 구성원이 없으면 팩도 잠든다 @param {SimCtx} ctx @param {MonsterState} m */
function putToSleep(ctx, m) {
  sleepMonster(m);
  const pack = packOf(ctx, m.packId);
  if (!pack) return;
  for (let i = 0; i < pack.memberIds.length; i++) {
    const o = getMonster(ctx, pack.memberIds[i]);
    if (o && o.awake && aliveMon(o)) return;
  }
  pack.awake = false;
}

// ───────────────────────── ctx.hooks 구현 ─────────────────────────

/** 속성 행 · 훅(없으면 null) @param {string} id */
function hookOf(id) {
  const row = MON_AFFIXES_BY_ID[id];
  if (!row) return null;
  const hook = /** @type {any} */ (AFFIX_HOOKS)[row.hook];
  return hook ? { row, hook } : null;
}

/** ctx.hooks 구현 — 스폰 직후 속성 onSpawn(mods 는 spawnMonster 가 이미 적용) @param {SimCtx} ctx @param {MonsterState} mon */
export function onMonSpawn(ctx, mon) {
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const h = hookOf(list[i]);
    if (h && typeof h.hook.onSpawn === 'function') h.hook.onSpawn(ctx, mon, h.row);
  }
}

/**
 * ctx.hooks 구현 — 팩 깨움(피격은 상한 예외) · 행동 onDamaged(주술사 부활 끊기 · 수호자 impl.onDamaged) · 속성 onDamaged(dmg > 0 —
 * 훅 인자 (ctx, mon, row, st, hit, spec))
 * @param {SimCtx} ctx @param {MonsterState} mon @param {import('../../types.js').HitResult} hit @param {Object} spec
 */
export function onMonDamaged(ctx, mon, hit, spec) {
  if (!mon) return;
  if (!mon.awake) wakeFrom(ctx, mon, 'damage');
  const def = getMonDef(mon.typeId);
  const bh = /** @type {any} */ (BEHAVIORS)[def.behavior];
  if (bh && typeof bh.onDamaged === 'function') bh.onDamaged(ctx, mon, def, hit);
  if (!(hit && hit.dmg > 0)) return;
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const h = hookOf(list[i]);
    if (h && typeof h.hook.onDamaged === 'function') h.hook.onDamaged(ctx, mon, h.row, axOf(mon, h.row.id), hit, spec);
  }
}

/**
 * ctx.hooks 구현 — mon.affixes 의 onHitPlayer(근접 · 투사체 · 돌진이 dmg > 0 을 준 뒤 · spec.noAffix 면 부르지 않는다).
 * 훅 인자 (ctx, mon, row, st, res, spec) — spec(P3 W1 · 여섯째)은 그 공격의 MonAttackSpec(화염 강화의 「같은 공격 피해의 30%」)
 * @param {SimCtx} ctx @param {MonsterState} mon @param {import('../../types.js').PlayerHitResult} res @param {import('../../types.js').MonAttackSpec} spec
 */
export function onMonHitPlayer(ctx, mon, res, spec) {
  if (!mon || (spec && spec.noAffix) || !(res && res.dmg > 0)) return;
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const h = hookOf(list[i]);
    if (h && typeof h.hook.onHitPlayer === 'function') h.hook.onHitPlayer(ctx, mon, h.row, axOf(mon, h.row.id), res, spec);
  }
}

/**
 * ctx.hooks 구현 — 속성 onDeath(분열 · 화염 강화 …) → 행동 onDeath(역병 덩어리 웅덩이) → 팩 정리(살아 있는 구성원이 없으면 pack.awake = false).
 * 배열에서 빼는 것은 cleanup(removeMarked)이다.
 * @param {SimCtx} ctx @param {MonsterState} mon
 */
export function onMonDeath(ctx, mon) {
  if (!mon) return;
  const list = mon.affixes;
  for (let i = 0; i < list.length; i++) {
    const h = hookOf(list[i]);
    if (h && typeof h.hook.onDeath === 'function') h.hook.onDeath(ctx, mon, h.row, axOf(mon, h.row.id));
  }
  const def = getMonDef(mon.typeId);
  const bh = /** @type {any} */ (BEHAVIORS)[def.behavior];
  if (bh && typeof bh.onDeath === 'function') bh.onDeath(ctx, mon, def);
  const pack = packOf(ctx, mon.packId);
  if (pack) {
    let any = false;
    for (let i = 0; i < pack.memberIds.length && !any; i++) {
      const o = getMonster(ctx, pack.memberIds[i]);
      if (o && o !== mon && aliveMon(o) && o.awake) any = true;
    }
    if (!any) pack.awake = false;
  }
}

// ───────────────────────── 수호자 ─────────────────────────

/**
 * 수호자 출현 — GUARDIANS[rift.guardianType] 행으로 spawnMonster(rank guardian · 속성 riftRow(L).guardianAffixes 개(rollAffixes · rng.ai · 수호자 태그로 배제) ·
 * 깨어 있게 · 팩 하나(kind guardian) · reason 'guardian' — 속성 mods.res 는 받지 않는다(monsterStats)) → GUARDIAN_IMPLS[typeId].init.
 * 대형 체력 바 이벤트(GUARDIAN_APPEAR)와 rift.guardianId 는 P2(rift.js)가 낸다.
 * @param {SimCtx} ctx @param {number} x @param {number} z @returns {MonsterState|null}
 */
export function spawnGuardian(ctx, x, z) {
  const st = ctx.state;
  const rift = st.rift;
  if (!rift) return null;
  const typeId = rift.guardianType;
  let def;
  try { def = getMonDef(typeId); } catch { return null; }
  const level = rift.level;
  const affixes = rollAffixes(ctx.rng.ai, def, riftRow(level).guardianAffixes, level);
  /** @type {PackState} */
  const pack = { id: ctx.nextId(), kind: 'guardian', memberIds: [], awake: true, nextHazardAt: -1, fled: false, anchor: { x, z } };
  rift.packs.push(pack);
  const p = st.player.pos;
  const facing = p.x !== x || p.z !== z ? yawOf(p.x - x, p.z - z) : 0;
  const mon = spawnMonster(ctx, { typeId, rank: 'guardian', level, affixes, packId: pack.id, x, z, facing, awake: true, reason: 'guardian' });
  pack.memberIds.push(mon.id);
  const impl = /** @type {any} */ (GUARDIAN_IMPLS)[typeId];
  if (impl && typeof impl.init === 'function') impl.init(ctx, mon, def);
  return mon;
}
