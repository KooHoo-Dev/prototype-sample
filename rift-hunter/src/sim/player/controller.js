// OWNER: P1 — 계약 §6.7 · §5.2 · §5.1-4 · §5.3
// 플레이어 한 틱: 대상 검사 → 행동 진행 → 입력 해석(클릭 10규칙) → 선입력 실행 → 누르고 있는 스킬 → 채널 틱 → 의도 실행 →
// 이동(경로 · 밀림 · 회오리 · 일반 몬스터 밀기 · 정예 막힘) → 자원 · 포션 · 귀환 진행 → 도착(줍기 · 상호작용).
// 실행부는 노드 · 전설 ID 를 모른다(기본 공격은 CLASSES[cls].basic · 동작은 행의 behavior). 마을에서는 이동 · 상호작용 · 포션만.

import { DT, SKILL_BAR } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { NEUTRAL_INPUT } from '../../core/inputFrame.js';
import { fwdX, fwdZ, turnToward, yawOf } from '../../core/math.js';
import { ticks } from '../../core/time.js';
import { CLASSES, PLAYER, SHOVE } from '../../data/classes.js';
import { PICKUP } from '../../data/combat.js';
import { getMonDef } from '../../data/index.js';
import { pickupDrop } from '../drops.js';
import { getDrop, getMonster, getObject } from '../entities.js';
import { requestReturnToRift, requestTravel } from '../rift.js';
import { losClear, moveCircle } from '../world/nav.js';
import { findPath } from '../world/path.js';
import {
  RECALL, cancelRecall, castSkill, endChannel, emitFail, freshSk, isActionable, noIntent, pressPotion, progressAction, setBuffer,
  soonFreeAt, startRecall, updateChannel, updatePotionQueue, updateRecall, updateResource,
} from './actions.js';
import { barSkill, classOf, nodeOf, skillParams, targetAlive } from './skills.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').InputFrame} InputFrame */
/** @typedef {import('../../types.js').PlayerState} PlayerState */
/** @typedef {import('../../types.js').MonsterState} MonsterState */
/** @typedef {import('../../types.js').Vec2} Vec2 */

/** 몬스터 몸을 통과하는 행동(§5.2-8) — 몸 겹침을 풀지 않는다 */
const PASS_ACTS = ['dash', 'leap', 'blink', 'channel'];
/** 밀림을 받지 않는 행동(§5.6) */
const NO_KNOCK_ACTS = ['dash', 'leap', 'blink'];

const copy = (v) => ({ x: v.x, z: v.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ───────────────────────── 조회 도우미 ─────────────────────────

/** 목표 지점 = 커서(null 이면 facing 앞 PLAYER.noCursorDist m) — §5.2-6 @param {PlayerState} p @param {InputFrame} inp */
function aimPoint(p, inp) {
  if (inp.cursor) return copy(inp.cursor);
  return { x: p.pos.x + fwdX(p.facing) * PLAYER.noCursorDist, z: p.pos.z + fwdZ(p.facing) * PLAYER.noCursorDist };
}

/** 검사를 통과한 hover 몬스터 ID @param {PlayerState} p */
function hoverMonId(p) {
  return p.hover && p.hover.kind === 'monster' ? p.hover.id : null;
}

/** 이 몬스터가 플레이어를 막는가(정예급 등급 · 구조물 태그) — 아니면 밀고 지나간다(§5.2-8) @param {MonsterState} m */
function blocksPlayer(m) {
  if (!SHOVE.ranks.includes(m.rank)) return true;
  let def = null;
  try { def = getMonDef(m.typeId); } catch { def = null; }
  if (!def || !Array.isArray(def.tags)) return false;
  for (const t of SHOVE.blockTags) if (def.tags.includes(t)) return true;
  return false;
}

/** 기본 공격의 사거리 안인가 — 근접(reach): 중심 거리 ≤ p.r + mon.r + reach · 원거리: 거리 ≤ range 이고 시야(§5.2-5 · 막는 소품 포함) */
function inAttackRange(ctx, mon) {
  const p = ctx.state.player;
  const node = nodeOf(classOf(ctx).basic);
  const def = node?.skill;
  if (!def) return false;
  const d = dist(p.pos, mon.pos);
  if (typeof def.reach === 'number') return d <= p.r + mon.r + def.reach;
  // 투사체는 막는 소품에도 끝난다(P2 — 내비 막힘) — 기둥 너머로 쏘지 않고 돌아간다
  return d <= (def.range ?? 0) && (!ctx.map || losClear(ctx.map, p.pos.x, p.pos.z, mon.pos.x, mon.pos.z, { props: true }));
}

/** 경로(시작점 제외 · 마지막 = 목적지) — 맵이 없으면 직선 */
function pathTo(ctx, to) {
  const p = ctx.state.player;
  if (!ctx.map) return [copy(to)];
  const path = findPath(ctx.map, p.pos, to, { r: p.r });
  return Array.isArray(path) ? path : [];
}

// ───────────────────────── §5.2-1 대상 검사 ─────────────────────────

/**
 * input.hover 를 검사해 player.hover 에 넣는다(아니면 null) — 몬스터: 살아 있고 cursor 가 중심에서 r + validate + validateH × height 안 ·
 * 드랍: 있고 src 'label' 이면 플레이어에서 labelReach 안(커서 거리 없음) · 그 밖은 cursor 에서 validate 안 · 물체: getObject · cursor 가 r + validate + validateH × h 안
 * (장식 'deco' 는 대상이 아니다 — 바닥 클릭). 몬스터 · 드랍은 균열 장면에서만.
 * @param {SimCtx} ctx @param {InputFrame} inp
 */
function validateHover(ctx, inp) {
  const st = ctx.state, p = st.player;
  const h = inp.hover;
  let ok = false;
  if (h && typeof h === 'object') {
    const c = inp.cursor;
    if (h.kind === 'monster') {
      if (st.scene === 'rift' && c) {
        const m = getMonster(ctx, h.id);
        if (m && !m.gone && !m.dead && m.hp > 0 && dist(c, m.pos) <= m.r + PICKUP.validate + PICKUP.validateH * m.height) ok = true;
      }
    } else if (h.kind === 'drop') {
      if (st.scene === 'rift') {
        const d = getDrop(ctx, h.id);
        if (d) ok = h.src === 'label' ? dist(p.pos, d.pos) <= PICKUP.labelReach : !!c && dist(c, d.pos) <= PICKUP.validate;
      }
    } else if (h.kind === 'object') {
      if (c) {
        const o = getObject(ctx, h.id);
        if (o && o.kind !== 'deco') ok = Math.hypot(c.x - o.x, c.z - o.z) <= o.r + PICKUP.validate + PICKUP.validateH * (o.h ?? PICKUP.objectH);
      }
    }
  }
  if (!ok) { p.hover = null; return; }
  const src = h.src === 'label' ? 'label' : 'pick';
  const cur = p.hover;
  if (cur && cur.kind === h.kind && cur.id === h.id && cur.src === src) return;   // 같으면 새로 만들지 않는다
  p.hover = /** @type {any} */ ({ kind: h.kind, id: h.id, src });
}

// ───────────────────────── §5.2-2 · 4 좌클릭 ─────────────────────────

/** 좌클릭 누름 — 행동 가능할 때: 그 틱의 대상으로 의도를 정한다(§5.2-2) */
function intentFromClick(ctx, inp) {
  const st = ctx.state, p = st.player;
  const hv = p.hover;
  const inRift = st.scene === 'rift';
  p.buffer = null;
  if (inRift && inp.shift) {
    p.intent = { kind: 'standAttack', held: !!inp.lmb, point: aimPoint(p, inp) };
    p.path = [];
  } else if (hv && hv.kind === 'monster') {
    p.intent = { kind: 'attack', targetId: /** @type {number} */ (hv.id), held: !!inp.lmb };
    p.targetId = /** @type {number} */ (hv.id);
    p.path = [];
  } else if (hv && hv.kind === 'drop') {
    p.intent = { kind: 'pickup', targetId: /** @type {number} */ (hv.id) };
    p.path = [];
  } else if (hv && hv.kind === 'object') {
    p.intent = { kind: 'interact', objectId: /** @type {string} */ (hv.id) };
    p.path = [];
  } else if (inp.cursor) {
    p.intent = { kind: 'move', point: copy(inp.cursor), follow: true, held: !!inp.lmb };
    p.path = pathTo(ctx, inp.cursor);
  }
}

/** 좌클릭 누름 — 잠긴 동안: 공격 · 제자리 공격 · 이동은 선입력, 줍기 · 상호작용은 의도로(잠김이 풀리면 걸어간다 — NOTES-P1) */
function bufferClick(ctx, inp) {
  const st = ctx.state, p = st.player;
  const hv = p.hover;
  if (st.scene === 'rift' && inp.shift) setBuffer(ctx, { kind: 'basic', stand: true, point: aimPoint(p, inp), targetId: null });
  else if (hv && hv.kind === 'monster') setBuffer(ctx, { kind: 'attack', targetId: /** @type {number} */ (hv.id), point: aimPoint(p, inp) });
  else if (hv && hv.kind === 'drop') { p.intent = { kind: 'pickup', targetId: /** @type {number} */ (hv.id) }; p.buffer = null; }
  else if (hv && hv.kind === 'object') { p.intent = { kind: 'interact', objectId: /** @type {string} */ (hv.id) }; p.buffer = null; }
  else if (inp.cursor) setBuffer(ctx, { kind: 'move', point: copy(inp.cursor), targetId: null });
}

/** 좌클릭 뗌(§5.2-4) — held = false · 공격 · 제자리 공격은 지금 휘두름을 끝내고 멈춘다(새 휘두름 없음) · move 는 목적지까지 */
function handleRelease(ctx, inp) {
  const p = ctx.state.player;
  const it = p.intent;
  if (!it.held || inp.lmb) return;
  it.held = false;
  if ((it.kind === 'attack' || it.kind === 'standAttack') && p.act === 'attack') p.intent = noIntent();
}

/** 행동을 끊는 새 입력 — 채널은 후딜 없이 끝 · 귀환은 취소(그 입력은 같은 틱에 처리 — §5.3) */
function interruptForInput(ctx) {
  const p = ctx.state.player;
  if (p.act === 'channel' && p.channel) endChannel(ctx, false);
  if (p.act === RECALL || p.recall) cancelRecall(ctx, 'action');
}

/**
 * 누름 에지(§5.2-2 · 6 · 7 · §5.3): 좌클릭 → 스킬 칸(낮은 인덱스 먼저) → 귀환. 한 틱에 시작하는 행동은 하나 — 시작한 뒤의 누름은 버퍼로(새 것이 덮어쓴다)
 * @returns {boolean} 행동을 시작했다
 */
function handleEdges(ctx, inp) {
  const st = ctx.state, p = st.player;
  const inRift = st.scene === 'rift' && !!st.rift;
  let started = false;
  if (inp.lmbDown) {
    interruptForInput(ctx);
    if (isActionable(p)) intentFromClick(ctx, inp);
    else bufferClick(ctx, inp);
  }
  for (let i = 0; i < SKILL_BAR; i++) {
    if (!inp.slotDown[i]) continue;
    const id = barSkill(st.char, i);
    if (!id) { emitFail(ctx, null, 'empty'); continue; }
    if (!inRift) { emitFail(ctx, id, 'town'); continue; }
    if (p.act === 'channel' && p.channel && p.channel.skillId === id) continue;   // 채널 키 자체
    interruptForInput(ctx);
    const req = { slot: i, point: aimPoint(p, inp), targetId: hoverMonId(p), mode: /** @type {'edge'} */ ('edge') };
    if (isActionable(p) && !started) {
      p.buffer = null;
      if (castSkill(ctx, id, req) === 'started') started = true;
    } else {
      setBuffer(ctx, { kind: 'skill', slot: i, skillId: id, point: req.point, targetId: req.targetId, stand: false }, soonFreeAt(ctx, id));
    }
  }
  if (inp.recallDown) {
    if (!inRift) emitFail(ctx, RECALL, 'town');
    else if (!(st.char && st.char.scrolls > 0)) emitFail(ctx, RECALL, 'empty');
    else if (p.act !== RECALL) {
      if (p.act === 'channel' && p.channel) endChannel(ctx, false);
      if (isActionable(p) && !started) {
        p.buffer = null;
        if (startRecall(ctx)) started = true;
      } else {
        setBuffer(ctx, { kind: 'skill', skillId: RECALL, point: null, targetId: null, stand: false });
      }
    }
  }
  return started;
}

/**
 * 선입력 실행(§5.3 — 잠김이 풀린 첫 틱): 목표 지점은 그때의 cursor(null 이면 저장한 점) · 대상은 저장한 ID 가 살아 있으면 그것.
 * 공격 · 제자리 공격 · 이동은 의도로 바꿔 같은 틱의 의도 실행이 행동을 시작한다.
 * @returns {boolean} 행동을 시작했다
 */
function runBuffer(ctx, inp) {
  const st = ctx.state, p = st.player;
  const b = p.buffer;
  if (!b) return false;
  if (st.tick > b.until) { p.buffer = null; return false; }
  switch (b.kind) {
    case 'skill': {
      if (b.skillId === RECALL) { p.buffer = null; return startRecall(ctx); }
      const mon = targetAlive(ctx, b.targetId);
      const point = inp.cursor ? copy(inp.cursor) : b.point ?? aimPoint(p, inp);
      const r = castSkill(ctx, /** @type {string} */ (b.skillId), {
        slot: b.slot ?? -1, point, targetId: mon ? mon.id : hoverMonId(p), mode: 'buffer', until: b.until,
      });
      if (r === 'wait') return false;
      p.buffer = null;
      return r === 'started';
    }
    case 'attack': {
      p.buffer = null;
      const mon = targetAlive(ctx, b.targetId) ?? targetAlive(ctx, hoverMonId(p));
      if (!mon) return false;
      p.intent = { kind: 'attack', targetId: mon.id, held: !!inp.lmb };
      p.targetId = mon.id;
      p.path = [];
      return false;
    }
    case 'basic': {
      p.buffer = null;
      if (st.scene !== 'rift') return false;
      p.intent = { kind: 'standAttack', held: !!inp.lmb, point: inp.cursor ? copy(inp.cursor) : b.point ?? aimPoint(p, inp) };
      p.path = [];
      return false;
    }
    case 'move': {
      p.buffer = null;
      const pt = inp.cursor ?? b.point;
      if (!pt) return false;
      p.intent = { kind: 'move', point: copy(pt), follow: true, held: !!inp.lmb };
      p.path = pathTo(ctx, pt);
      return false;
    }
    default:
      p.buffer = null;
      return false;
  }
}

/** 누르고 있는 스킬 칸 — 행동 가능할 때마다 반복(장르 표준 · 조용히 — 실패 알림은 누름 에지만) · 낮은 인덱스 먼저 */
function heldSkills(ctx, inp) {
  const st = ctx.state, p = st.player;
  if (st.scene !== 'rift' || !st.rift) return false;
  for (let i = 0; i < SKILL_BAR; i++) {
    if (!inp.slot[i] || inp.slotDown[i]) continue;
    const id = barSkill(st.char, i);
    if (!id) continue;
    const r = castSkill(ctx, id, { slot: i, point: aimPoint(p, inp), targetId: hoverMonId(p), mode: 'held' });
    if (r === 'started') return true;
  }
  return false;
}

/**
 * 좌클릭 유지(§5.2-3): move-follow 는 6틱마다 커서가 0.75m 넘게 움직였으면 다시 경로(cursor null 이면 경로를 비우고 멈춘다) ·
 * attack 은 대상이 죽었거나 없어졌으면 hover 몬스터로 · 없으면 move-follow 로
 */
function handleHolds(ctx, inp) {
  const st = ctx.state, p = st.player;
  const it = p.intent;
  if (!it.held) return;
  if (it.kind === 'move') {
    if (!inp.cursor) {
      if (p.path.length) p.path = [];
      delete it.point;
      return;
    }
    if (!isActionable(p)) return;
    const cadence = st.tick % ticks(PLAYER.repathSec) === 0;
    const due = cadence || !p.path.length;
    // 밀리거나 막혀 멈춘 채 커서가 그대로면 6틱마다 다시(닿지 않는 커서는 6틱마다 한 번만 탐색)
    const stranded = cadence && !p.path.length && dist(p.pos, inp.cursor) > PLAYER.repathDist;
    if (!it.point || stranded || (due && dist(inp.cursor, it.point) > PLAYER.repathDist)) {
      it.point = copy(inp.cursor);
      p.path = pathTo(ctx, inp.cursor);
    }
  } else if (it.kind === 'attack') {
    if (targetAlive(ctx, it.targetId)) return;
    const hid = hoverMonId(p);
    if (hid !== null && targetAlive(ctx, hid)) {
      p.intent = { kind: 'attack', targetId: hid, held: true };
      p.targetId = hid;
    } else if (inp.cursor) {
      p.intent = { kind: 'move', follow: true, held: true };
      p.targetId = null;
    } else {
      p.intent = noIntent();
      p.targetId = null;
    }
  }
}

/** 기본 공격 하나 시작(의도 — 조용히) · held 가 아니면 한 번 휘두르고 의도를 지운다 */
function swing(ctx, inp, targetId, point) {
  const p = ctx.state.player;
  const r = castSkill(ctx, classOf(ctx).basic, { slot: -1, point, targetId, mode: 'held' });
  if (r !== 'started') return false;
  if (!p.intent.held) p.intent = noIntent();
  return true;
}

/**
 * 의도 실행(행동 가능할 때 · 이번 틱에 시작한 행동이 없을 때 — §5.2-5): 사거리 안이면 기본 공격 · 아니면 대상 쪽 경로
 * (대상이 attackRepathDist 넘게 움직이면 6틱마다 다시) · 줍기 · 상호작용 대상 쪽 경로
 * @returns {boolean} 행동을 시작했다
 */
function runIntent(ctx, inp) {
  const st = ctx.state, p = st.player;
  const it = p.intent;
  switch (it.kind) {
    case 'attack': {
      const mon = targetAlive(ctx, it.targetId);
      if (!mon) { p.intent = noIntent(); p.targetId = null; p.path = []; return false; }
      p.targetId = mon.id;
      if (inAttackRange(ctx, mon)) return swing(ctx, inp, mon.id, copy(mon.pos));
      const due = st.tick % ticks(PLAYER.repathSec) === 0;
      if (!it.point || (due && (dist(mon.pos, it.point) > PLAYER.attackRepathDist || !p.path.length))) {
        it.point = copy(mon.pos);
        p.path = pathTo(ctx, mon.pos);
      }
      return false;
    }
    case 'standAttack':
      if (st.scene !== 'rift') { p.intent = noIntent(); return false; }
      return swing(ctx, inp, null, inp.cursor ? copy(inp.cursor) : it.point ?? aimPoint(p, inp));
    case 'pickup': {
      const d = st.scene === 'rift' ? getDrop(ctx, /** @type {number} */ (it.targetId)) : null;
      if (!d) { p.intent = noIntent(); p.path = []; return false; }
      if (!it.point) { it.point = copy(d.pos); p.path = pathTo(ctx, d.pos); }
      else if (!p.path.length && dist(p.pos, d.pos) > PICKUP.itemReach) { p.intent = noIntent(); }   // 닿지 않는다 — 멈춘다
      return false;
    }
    case 'interact': {
      const o = getObject(ctx, /** @type {string} */ (it.objectId));
      if (!o || o.kind === 'deco') { p.intent = noIntent(); p.path = []; return false; }
      if (!it.point) { it.point = { x: o.x, z: o.z }; p.path = pathTo(ctx, it.point); }
      else if (!p.path.length && Math.hypot(p.pos.x - o.x, p.pos.z - o.z) > o.r + PICKUP.interactReach) { p.intent = noIntent(); }
      return false;
    }
    case 'move':
      if (!p.path.length && !it.held) p.intent = noIntent();
      return false;
    default:
      return false;
  }
}

// ───────────────────────── §5.2-8 이동 ─────────────────────────

/** 이동 배율 — 속박이면 0 · 감속(tick < slowUntil)이면 × (1 − slowPct) */
function moveMul(p, tick) {
  if (tick < p.st.rootUntil) return 0;
  return tick < p.st.slowUntil ? Math.max(0, 1 - p.st.slowPct) : 1;
}

/** 이번 걸음 앞을 일반 몬스터가 막고 있는가(밀고 지나가는 동안 이동 × shoveMul) */
function shovingAhead(ctx, ux, uz, step) {
  const st = ctx.state, p = st.player;
  if (st.scene !== 'rift' || !st.rift) return false;
  const nx = p.pos.x + ux * step, nz = p.pos.z + uz * step;
  for (const m of st.rift.mons) {
    if (m.gone || m.dead || m.hp <= 0) continue;
    const dx = m.pos.x - nx, dz = m.pos.z - nz;
    const rr = p.r + m.r;
    if (dx * dx + dz * dz >= rr * rr) continue;
    if ((m.pos.x - p.pos.x) * ux + (m.pos.z - p.pos.z) * uz <= 0) continue;
    if (!blocksPlayer(m)) return true;
  }
  return false;
}

/**
 * 플레이어 ↔ 몬스터 겹침은 여기서만 푼다(§5.2-8): 일반 · 하수인 · 사본 · 소환체는 겹친 만큼 밀어낸다(앞을 막은 것은 옆으로 비킨다 — 밀고 빠져나가기) ·
 * 챔피언 · 정예 · 수호자 · 구조물은 플레이어를 그 원에서 밀어낸다. (ux, uz) = 이번 틱 이동 방향.
 */
function resolveBodies(ctx, ux, uz) {
  const st = ctx.state, p = st.player;
  const map = ctx.map;
  if (st.scene !== 'rift' || !st.rift || !map) return;
  const rx = -uz, rz = ux;   // 이동 방향의 오른쪽(§0.2 — 앞 (sin θ, cos θ) → 오른쪽 (−cos θ, sin θ))
  for (const m of st.rift.mons) {
    if (m.gone || m.dead || m.hp <= 0) continue;
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    const rr = p.r + m.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    const overlap = rr - d;
    let nx, nz;
    if (d > 0) { nx = dx / d; nz = dz / d; }
    else if (ux || uz) { nx = ux; nz = uz; }
    else { nx = 0; nz = 1; }
    if (blocksPlayer(m)) {
      p.pos = moveCircle(map, p.pos, p.r, -nx * overlap, -nz * overlap);
    } else {
      const ahead = nx * ux + nz * uz;
      let px = nx * overlap, pz = nz * overlap;
      if (ahead > 0) {
        const side = nx * rx + nz * rz >= 0 ? 1 : -1;
        const k = overlap * PLAYER.shoveSide * ahead * side;
        px += rx * k;
        pz += rz * k;
      }
      m.pos = moveCircle(map, m.pos, m.r, px, pz);
    }
  }
}

/** 경로 따라가기(stats.moveSpeed × 이동 배율 · 경유점 도착 반경 arriveR · 벽 미끄러짐 · 밀기/막힘) */
function followPath(ctx) {
  const st = ctx.state, p = st.player;
  const map = ctx.map;
  while (p.path.length && dist(p.pos, p.path[0]) <= PLAYER.arriveR) p.path.shift();
  if (!p.path.length) return 0;
  const mul = moveMul(p, st.tick);
  if (!(mul > 0)) return 0;
  const speed = (ctx.stats?.moveSpeed ?? classOf(ctx).moveSpeed) * mul;
  let budget = speed * DT;
  const ox = p.pos.x, oz = p.pos.z;
  let ux = 0, uz = 0;
  let guard = p.path.length + 1;
  while (budget > 0 && p.path.length && guard-- > 0) {
    const wp = p.path[0];
    const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= PLAYER.arriveR) { p.path.shift(); continue; }
    ux = dx / d;
    uz = dz / d;
    let step = Math.min(budget, d);
    const shove = shovingAhead(ctx, ux, uz, step);
    if (shove) step *= PLAYER.shoveMul;   // 밀고 지나가는 동안 이동 × shoveMul — 이번 틱은 이 걸음으로 끝
    const bx = p.pos.x, bz = p.pos.z;
    p.pos = map ? moveCircle(map, p.pos, p.r, ux * step, uz * step) : { x: bx + ux * step, z: bz + uz * step };
    const moved = Math.hypot(p.pos.x - bx, p.pos.z - bz);
    budget = shove ? 0 : budget - step;
    if (dist(p.pos, wp) <= PLAYER.arriveR) p.path.shift();
    if (!(moved > 0)) { p.path = []; break; }   // 막혔다 — 멈춘다(누르고 있으면 다시 경로)
  }
  if (ux || uz) resolveBodies(ctx, ux, uz);
  const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
  if (ux || uz) p.facing = turnToward(p.facing, yawOf(ux, uz), PLAYER.turnRate * DT);
  return moved;
}

/** 회오리 이동 — 커서 쪽 직진(이동 속도 × moveMul · 벽 미끄러짐 · 몬스터 통과) */
function spinMove(ctx, inp) {
  const st = ctx.state, p = st.player;
  const c = inp.cursor;
  if (!c || !ctx.map) return 0;
  const dx = c.x - p.pos.x, dz = c.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= PLAYER.arriveR) return 0;
  const prm = skillParams(ctx, p.channel ? p.channel.skillId : '');
  const speed = (ctx.stats?.moveSpeed ?? classOf(ctx).moveSpeed) * (typeof prm.moveMul === 'number' ? prm.moveMul : 1) * moveMul(p, st.tick);
  if (!(speed > 0)) return 0;
  const step = Math.min(speed * DT, d);
  const ox = p.pos.x, oz = p.pos.z;
  p.pos = moveCircle(ctx.map, p.pos, p.r, (dx / d) * step, (dz / d) * step);
  p.facing = turnToward(p.facing, yawOf(dx, dz), PLAYER.turnRate * DT);
  return Math.hypot(p.pos.x - ox, p.pos.z - oz);
}

/**
 * 이동 단계: 밀림(player.knock — 경로 이동 대신 · 행동 · 시전 · 채널은 계속) → 회오리 → (행동 가능하면) 경로. speed · moving · act move/idle.
 * @param {SimCtx} ctx @param {InputFrame} inp
 */
function movePlayer(ctx, inp) {
  const st = ctx.state, p = st.player;
  if (p.dead) return;
  let moved = 0;
  const kn = p.knock;
  if (kn) {
    if (st.tick >= kn.until || NO_KNOCK_ACTS.includes(p.act)) p.knock = null;
    else if (ctx.map) {
      const ox = p.pos.x, oz = p.pos.z;
      p.pos = moveCircle(ctx.map, p.pos, p.r, kn.vx * DT, kn.vz * DT);
      moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
      if (!PASS_ACTS.includes(p.act) && moved > 0) resolveBodies(ctx, (p.pos.x - ox) / moved, (p.pos.z - oz) / moved);
      p.speed = moved / DT;
      p.moving = false;
      if (isActionable(p)) p.act = 'idle';
      return;
    }
  }
  if (p.act === 'channel' && p.channel) {
    moved = spinMove(ctx, inp);
    p.speed = moved / DT;
    p.moving = moved > 0;
    return;
  }
  if (!isActionable(p)) return;
  moved = followPath(ctx);
  p.speed = moved / DT;
  p.moving = moved > 0;
  p.act = p.moving ? 'move' : 'idle';
  const it = p.intent;
  if (!p.path.length && it.kind === 'move' && !it.held) p.intent = noIntent();
}

// ───────────────────────── §5.2-9 도착 ─────────────────────────

/** 상호작용 — INTERACT(npc · stash · riftStone 은 ui 가 패널 · 포털은 audio 용) · 마을 포털 → requestReturnToRift · 균열 포털 → 마을로 */
function interact(ctx, o) {
  const st = ctx.state, p = st.player;
  ctx.emit(EV.INTERACT, { kind: o.kind, id: o.id });
  if (st.scene === 'town') st.town.lastInteract = o.id;
  if (o.kind === 'townPortal') {
    requestReturnToRift(ctx);
  } else if (o.kind === 'riftPortal') {
    const exit = o.portalKind === 'exit';
    if (exit && st.rift) st.rift.returnPos = { x: p.pos.x, z: p.pos.z };
    requestTravel(ctx, { to: 'town', reason: exit ? 'exit' : 'riftPortal' });
  }
}

/** 도착 처리(행동 가능할 때): 줍기(드랍에서 itemReach 안 → pickupDrop) · 상호작용(물체 중심에서 r + interactReach 안) */
function arrive(ctx) {
  const st = ctx.state, p = st.player;
  if (!isActionable(p) || st.pendingTravel) return;
  const it = p.intent;
  if (it.kind === 'pickup') {
    const d = st.scene === 'rift' ? getDrop(ctx, /** @type {number} */ (it.targetId)) : null;
    if (!d) { p.intent = noIntent(); return; }
    if (dist(p.pos, d.pos) <= PICKUP.itemReach) {
      p.intent = noIntent();
      p.path = [];
      pickupDrop(ctx, d);
    }
  } else if (it.kind === 'interact') {
    const o = getObject(ctx, /** @type {string} */ (it.objectId));
    if (!o) { p.intent = noIntent(); return; }
    if (Math.hypot(p.pos.x - o.x, p.pos.z - o.z) <= o.r + PICKUP.interactReach) {
      p.intent = noIntent();
      p.path = [];
      interact(ctx, o);
    }
  }
}

// ───────────────────────── 공개 API ─────────────────────────

/**
 * 플레이어 한 틱 전부(§5.1 4 · 마을은 2 — 이동 · 상호작용 · 포션만 · 스킬은 SKILL_FAIL town · T 는 SKILL_FAIL recall town)
 * @param {SimCtx} ctx @param {InputFrame} input
 */
export function updatePlayer(ctx, input) {
  const st = ctx.state, p = st.player;
  const inp = input ?? NEUTRAL_INPUT;
  p.speed = 0;
  p.moving = false;
  if (p.dead || st.pendingTravel) { p.hover = null; return; }
  validateHover(ctx, inp);
  progressAction(ctx);
  if (p.dead) return;
  handleRelease(ctx, inp);
  let started = handleEdges(ctx, inp);
  if (!started && isActionable(p) && p.buffer) started = runBuffer(ctx, inp);
  if (!started && isActionable(p)) started = heldSkills(ctx, inp);
  handleHolds(ctx, inp);
  updateChannel(ctx, inp);
  if (!started && isActionable(p)) started = runIntent(ctx, inp);
  movePlayer(ctx, inp);
  // 걸어서 사거리에 들어온 틱에 곧바로 휘두른다(한 틱 늦지 않게)
  if (!started && isActionable(p) && p.intent.kind === 'attack') {
    const mon = targetAlive(ctx, p.intent.targetId);
    if (mon && inAttackRange(ctx, mon)) started = swing(ctx, inp, mon.id, copy(mon.pos));
  }
  updateResource(ctx);
  if (inp.potionDown) pressPotion(ctx);
  updatePotionQueue(ctx);
  updateRecall(ctx);
  arrive(ctx);
  // 대상 프레임 — 공격 의도의 대상 · 지금 휘두르는 대상
  if (p.intent.kind === 'attack') p.targetId = targetAlive(ctx, p.intent.targetId) ? /** @type {number} */ (p.intent.targetId) : null;
  else if (p.act === 'attack' && targetAlive(ctx, p.actTargetId)) p.targetId = p.actTargetId;
  else p.targetId = null;
}

/**
 * 위치 · prevPos · 경로 · 의도 · 행동 초기화(장면 전환 · 부활 · 디버그) — 진행 중이던 귀환은 RECALL cancel 'scene' · 채널은 CHANNEL off
 * @param {SimCtx} ctx @param {number} x @param {number} z @param {number} [facing]
 */
export function placePlayer(ctx, x, z, facing = 0) {
  const p = ctx.state.player;
  if (p.recall) cancelRecall(ctx, 'scene');
  if (p.channel) {
    ctx.emit(EV.CHANNEL, { skillId: p.channel.skillId, on: false });
    p.channel = null;
  }
  p.pos = { x, z };
  p.prevPos = { x, z };
  p.facing = facing;
  p.path = [];
  p.intent = noIntent();
  p.buffer = null;
  p.act = p.dead ? 'dead' : 'idle';
  p.actSkill = null;
  p.actPoint = null;
  p.actTargetId = null;
  p.air = null;
  p.knock = null;
  p.hover = null;
  p.targetId = null;
  p.sk = freshSk();
  p.speed = 0;
  p.moving = false;
}

/**
 * full 이면 생명 · 마나 가득 · 분노 0 · 버프 · 상태 · sk · knock 정리(캐릭터 붙이기 · 부활 · 새 균열 — refreshStats 뒤에 부른다).
 * full 이 아니면 진행 중인 행동 · 채널 · 귀환 · 밀림 · 선입력만 정리한다(생명 · 자원 · 버프 유지).
 * @param {SimCtx} ctx @param {{full:boolean}} opts
 */
export function resetPlayerForScene(ctx, { full }) {
  const st = ctx.state, p = st.player;
  if (p.recall) cancelRecall(ctx, 'scene');
  if (p.channel) {
    ctx.emit(EV.CHANNEL, { skillId: p.channel.skillId, on: false });
    p.channel = null;
  }
  p.air = null;
  p.knock = null;
  p.buffer = null;
  p.potionQueuedUntil = 0;
  p.sk = freshSk();
  if (!full) {
    if (!p.dead) { p.act = 'idle'; p.actSkill = null; }
    return;
  }
  const cls = st.char?.cls;
  const C = CLASSES.find(c => c.id === cls) ?? CLASSES[0];
  p.r = C.radius;
  p.life = p.lifeMax;
  p.resource = C.rage ? 0 : p.resourceMax;
  p.dead = false;
  p.deadAt = -1;
  p.act = 'idle';
  p.actSkill = null;
  p.actPoint = null;
  p.actTargetId = null;
  p.path = [];
  p.intent = noIntent();
  p.buffs = [];
  p.shield = 0;
  p.st = { slowPct: 0, slowUntil: 0, rootUntil: 0 };
  p.lowLife = false;
  p.invulnUntil = 0;
  p.combatUntil = 0;
  p.rageTaken = { windowStart: 0, sum: 0 };
  p.loh = { actionId: 0, n: 0 };
  p.hover = null;
  p.targetId = null;
}
