// OWNER: P9 — 계약 §6.7 · §12.3 (헤드리스 봇 · 순수 JS)
// 봇은 사람과 같은 창구만 쓴다: 매 틱 GameState를 **읽고** InputFrame 하나를 만든다. 상태를 고치지 않는다.
// import는 core/ · data/뿐이다(셰이프 판정은 core/hitShapes.js). 수치는 전부 data/bot.js의 BOT에 있다.
//
// 규칙(위에서부터 우선 — §12.3):
//   1 없음 → 2 록온 → 3 위협 평가 → 4 구르기 → 5 장판 탈출 → 6 회복 → 7 처형 → 8 반격 → 9 거리 유지 → 10 옆걸음
// 계약 본문에 더한 것(전부 「사람이 패턴을 익히면 하는 일」이다 — docs/NOTES-P9.md):
//   - 예고 중의 위협은 보스가 전진(lunge) · 도약(leap) · 돌진(charge)한 뒤의 자리로 어림한다.
//   - 이미 흘렸거나 맞은 판정(state.hitLog)은 위협에서 뺀다 → 한 번의 휘두르기에 두 번 구르지 않는다.
//   - 연속기 판정 시각(chain.at)이 남아 있는 후딜은 「아직 반격할 틈이 아니다」로 본다.
import { NEUTRAL_INPUT, makeInput } from '../core/inputFrame.js';
import { EPS } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { clamp01, normalize } from '../core/math2d.js';
import { resolveShape, shapeHitsCircle } from '../core/hitShapes.js';
import { circleOverlapsWorld } from '../core/collide.js';
import { BOT } from '../data/bot.js';
import { PLAYER } from '../data/player.js';
import { BOSS_AI } from '../data/bossCommon.js';
import { getWeaponDef } from '../data/weapons.js';
import { getBossDef } from '../data/bosses/index.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').BossDef} BossDef */
/** @typedef {import('../types.js').BossState} BossState */
/** @typedef {import('../types.js').BossAttackDef} BossAttackDef */
/** @typedef {import('../types.js').PlayerState} PlayerState */
/** @typedef {import('../types.js').HitShape} HitShape */
/** @typedef {import('../types.js').ShapeDef} ShapeDef */
/** @typedef {import('../types.js').Vec2} Vec2 */

/**
 * 가장 이른 피격 예상.
 * @typedef {Object} Threat
 * @property {number} t          피격까지 남은 시간(초). 0 = 지금
 * @property {string} inst       위협 인스턴스 키('atk:<seq>' · 'hz:<id>' · 'pr:<id>') — 구르기 판정은 인스턴스당 한 번
 * @property {number} parity     좌우를 고르는 번호(seq · id)
 * @property {boolean} through   중심을 향해 굴러 뚫는가(충격파 띠 · 큰 원)
 * @property {number} cx         through의 중심
 * @property {number} cz
 * @property {{ax:number, az:number, bx:number, bz:number}|null} lane  선 모양(돌진 · 세로 베기 · 투사체) — 구르기는 이 선에 수직
 * @property {boolean} escape    걸어서 벗어날 수 있는 장판 · 지속 판정인가(규칙 5)
 * @property {Vec2|null} [away]  escape일 때 벗어날 방향(지속 판정의 부채꼴 — 가까운 가장자리 쪽). 없으면 장판 규칙으로 구한다
 * @property {boolean} [guard]   막을 수 있는 투사체인가(규칙 4a — 유도 구체는 구르기보다 가드가 답이다)
 */

const HALF_PI = Math.PI / 2;

/** @param {number} u */
function easeOutQuad(u) {
  return 1 - (1 - u) * (1 - u);
}

/** 그 hitId가 플레이어에게 이미 해소됐는가(흘림 · 가드 · 피격). @param {GameState} state @param {number} hitId */
function resolvedOnPlayer(state, hitId) {
  const log = state.hitLog;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].hitId === hitId && log[i].target === 'player') return true;
  }
  return false;
}

/** 셰이프가 앞으로 닿는 거리(m). @param {ShapeDef} s */
function shapeReach(s) {
  switch (s.type) {
    case 'capsule': return Math.max(s.fwd0, s.fwd1);
    case 'circle': return (s.fwd ?? 0) + s.r;
    case 'arc': return s.r;
    default: return s.rOuter;
  }
}

/** 셰이프의 옆 폭 절반(m). @param {ShapeDef} s */
function shapeHalfWidth(s) {
  switch (s.type) {
    case 'capsule': return s.r;
    case 'circle': return s.r;
    case 'arc': return s.r * Math.sin(Math.min(s.halfAngle, HALF_PI));
    default: return s.rOuter;
  }
}

/** 월드 셰이프의 「선」(캡슐이면 그 선분). @param {HitShape} shape */
function laneOf(shape) {
  return shape.type === 'capsule' ? { ax: shape.ax, az: shape.az, bx: shape.bx, bz: shape.bz } : null;
}

/** 큰 원/띠인가(중심을 향해 굴러 뚫는다 — 규칙 4). @param {HitShape} shape */
function isBigRound(shape) {
  if (shape.type === 'ring') return true;
  if (shape.type === 'circle') return shape.r > BOT.bigRadius;
  return shape.type === 'arc' && shape.halfAngle >= Math.PI && shape.r > BOT.bigRadius;
}

/** @param {BossDef} def @param {BossState} boss @param {{stopShort?:number}} mv */
function stopShortOf(def, boss, mv) {
  return mv.stopShort === undefined ? boss.radius + BOSS_AI.stopShortPad : mv.stopShort;
}

/**
 * 구르기 도착점이 아레나 안이고 기둥과 겹치지 않는가.
 * @param {GameState} state @param {Vec2} dir
 */
function rollEndsOk(state, dir) {
  const p = state.player;
  const ex = p.pos.x + dir.x * PLAYER.roll.dist;
  const ez = p.pos.z + dir.z * PLAYER.roll.dist;
  return !circleOverlapsWorld(ex, ez, p.radius, state.world);
}

/**
 * 경계 근처에서 바깥으로 가려는 이동을 벽을 따라 미끄러뜨린다.
 * @param {GameState} state @param {number} dx @param {number} dz 단위 벡터 @param {number} side 접선을 고를 때의 좌우(±1)
 * @returns {Vec2}
 */
function slideAlongWall(state, dx, dz, side) {
  const pos = state.player.pos;
  const limit = state.world.radius - BOT.wallMargin;
  const d = Math.hypot(pos.x, pos.z);
  if (d < limit || d <= EPS) return { x: dx, z: dz };
  const nx = pos.x / d;
  const nz = pos.z / d;
  const outward = dx * nx + dz * nz;
  if (outward <= 0) return { x: dx, z: dz };
  const t = normalize(dx - outward * nx, dz - outward * nz);
  if (t.x !== 0 || t.z !== 0) return t;
  return { x: -nz * side, z: nx * side }; // 벽을 정면으로 본다 — 접선으로 돈다
}

/**
 * 보스가 「지금부터 이만큼은 때리지 못한다」고 볼 수 있는 시간(초). 모르면 0.
 * 후딜에 연속기 판정이 남아 있으면 그 시각까지만 센다.
 * @param {BossState} boss @param {BossDef} def @param {number} dist 플레이어 ↔ 보스 거리
 */
function bossBusyFor(boss, def, dist) {
  switch (boss.state) {
    case 'attack': {
      const atk = boss.attack;
      if (!atk || atk.phase !== 'recovery') return 0;
      const recT = atk.t - atk.windup - atk.active;
      const left = atk.recovery - recT;
      const ad = def.attacks[atk.id];
      const chain = ad && ad.chain ? ad.chain : [];
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        const chance = boss.phase === 2 ? c.chanceP2 : c.chance;
        if (!(chance > 0) || recT >= c.at) continue;
        if (c.maxRange !== undefined && dist > c.maxRange) continue;
        return Math.min(left, c.at - recT); // 아직 이어질 수 있다
      }
      return left;
    }
    case 'parried':
    case 'groggy':
    case 'executed':
    case 'recover':
    case 'phaseShift':
      return Math.max(0, boss.stateDur - boss.stateTime);
    default:
      return 0;
  }
}

/** 후딜에 아직 판정하지 않은 연속기가 남아 있는가. @param {BossState} boss @param {BossDef} def @param {number} dist */
function chainPending(boss, def, dist) {
  const atk = boss.attack;
  if (!atk || atk.phase !== 'recovery') return false;
  const ad = def.attacks[atk.id];
  if (!ad || !ad.chain) return false;
  const recT = atk.t - atk.windup - atk.active;
  for (let i = 0; i < ad.chain.length; i++) {
    const c = ad.chain[i];
    const chance = boss.phase === 2 ? c.chanceP2 : c.chance;
    if (chance > 0 && recT < c.at && (c.maxRange === undefined || dist <= c.maxRange)) return true;
  }
  return false;
}

/**
 * @param {{seed?:number, dodgeChance?:number, reaction?:number, aggression?:number}} [opts] 기본값은 BOT
 * @returns {{decide:(state:GameState)=>InputFrame, reset:()=>void}}
 */
export function createBot(opts = {}) {
  const seed = (opts.seed ?? BOT.seed) >>> 0;
  const cfg = {
    dodgeChance: opts.dodgeChance ?? BOT.dodgeChance,
    reaction: opts.reaction ?? BOT.reaction,
    aggression: opts.aggression ?? BOT.aggression,
  };
  const rng = createRng(seed);

  /** 봇 자신의 기억(sim 상태가 아니다). */
  const mem = {
    /** @type {Map<string, boolean>} 위협 인스턴스 → 이번에는 구르는가 */
    dodge: new Map(),
    aggro: false,          // 이번 보스 idle/chase 구간에 먼저 때리는가
    bossState: '',
    bossStateTime: 0,
    comboFor: 0,           // 후딜에서 이미 다음 타를 누른 공격의 hitId
    strafe: 1,             // 옆걸음 방향(±1)
    /** @type {Vec2|null} 선입력해 둔 구르기의 방향 */
    rollDir: null,
  };

  function reset() {
    rng.setState(seed);
    mem.dodge.clear();
    mem.aggro = false;
    mem.bossState = '';
    mem.bossStateTime = 0;
    mem.comboFor = 0;
    mem.strafe = 1;
    mem.rollDir = null;
  }

  /** 인스턴스당 한 번 굴린다. @param {string} inst */
  function willDodge(inst) {
    let v = mem.dodge.get(inst);
    if (v === undefined) {
      if (mem.dodge.size >= BOT.memoryMax) mem.dodge.clear();
      v = rng.chance(cfg.dodgeChance);
      mem.dodge.set(inst, v);
    }
    return v;
  }

  /** 보스의 idle/chase 구간이 새로 시작될 때마다 「먼저 때릴까」를 굴린다. @param {BossState} boss */
  function trackBoss(boss) {
    const fresh = boss.state !== mem.bossState || boss.stateTime < mem.bossStateTime;
    mem.bossState = boss.state;
    mem.bossStateTime = boss.stateTime;
    if (fresh && (boss.state === 'idle' || boss.state === 'chase')) mem.aggro = rng.chance(cfg.aggression);
  }

  // ───────────────────────── 규칙 3: 위협 평가 ─────────────────────────

  /**
   * 보스의 현재 공격.
   * @param {GameState} state @param {BossDef} def @param {(th:Threat)=>void} offer
   */
  function bossThreats(state, def, offer) {
    const boss = state.boss;
    const atk = boss.attack;
    if (boss.state !== 'attack' || !atk) return;
    const ad = def.attacks[atk.id];
    if (!ad || !ad.hits) return;
    const p = state.player;
    const cr = p.radius + BOT.threatPad;
    const tA = atk.t - atk.windup;
    const mv = ad.move;
    const fx = Math.sin(boss.facing);
    const fz = Math.cos(boss.facing);

    // 돌진: 아직 달릴 거리(판정 셰이프를 그만큼 앞으로 늘인 선이 위협이다)
    let chargeLeft = 0;
    if (mv && mv.kind === 'charge') {
      const span = mv.t1 - mv.t0;
      const u = span > 0 ? clamp01((tA - mv.t0) / span) : 1;
      chargeLeft = mv.dist * (1 - u);
    }

    for (let i = 0; i < ad.hits.length; i++) {
      const h = ad.hits[i];
      if (tA >= h.t1 - EPS) continue;
      let wait = h.t0 - tA;
      /** @type {HitShape|null} */
      let shape = null;
      if (wait > EPS) {
        // 예고 중: 바닥 표식이 있으면 그것이 정본이다(조준점 · 긴 선 · 쓸리는 부채)
        const id = `atk:${atk.seq}:${i}`;
        for (let k = 0; k < state.telegraphs.length; k++) {
          if (state.telegraphs[k].id === id) shape = state.telegraphs[k].shape;
        }
      } else {
        wait = 0;
        const hitId = atk.hitIds ? atk.hitIds[i] : 0;
        if (hitId > 0 && resolvedOnPlayer(state, hitId)) {
          // 이번 판정은 끝났다. 반복 타격(브레스)이면 다음 간격이 위협이다.
          if (!(h.interval > 0)) continue;
          const next = h.t0 + (Math.floor((tA - h.t0) / h.interval + EPS) + 1) * h.interval;
          if (next >= h.t1 - EPS) continue;
          wait = next - tA;
        }
      }
      if (!shape) {
        let ox = boss.pos.x;
        let oz = boss.pos.z;
        if (wait > EPS && mv && mv.kind === 'lunge') {
          // 판정 전에 플레이어 앞까지 전진한다 — 남은 전진 거리만큼 앞에서 휘두른다고 본다
          const span = mv.t1 - mv.t0;
          const u = span > 0 ? clamp01((tA - mv.t0) / span) : 1;
          const left = mv.dist * (1 - easeOutQuad(u));
          const ahead = (p.pos.x - ox) * fx + (p.pos.z - oz) * fz;
          const go = Math.min(left, Math.max(0, ahead - stopShortOf(def, boss, mv)));
          ox += fx * go;
          oz += fz * go;
        } else if (wait > EPS && mv && mv.kind === 'leap') {
          // 조준점 앞 stopShort에 착지한다
          const dx = atk.aimX - ox;
          const dz = atk.aimZ - oz;
          const d = Math.hypot(dx, dz);
          const stop = stopShortOf(def, boss, mv);
          if (d > stop) {
            ox += (dx / d) * (d - stop);
            oz += (dz / d) * (d - stop);
          }
        }
        if (chargeLeft > 0) {
          shape = resolveShape(
            { type: 'capsule', fwd0: 0, fwd1: shapeReach(h.shape) + chargeLeft, r: shapeHalfWidth(h.shape) },
            ox, oz, boss.facing,
          );
        } else {
          shape = resolveShape(h.shape, ox, oz, boss.facing);
        }
      }
      if (!shapeHitsCircle(shape, p.pos.x, p.pos.z, cr)) continue;
      const big = isBigRound(shape);
      // 지속 판정(브레스 — interval > 0)은 방향이 고정된 뒤부터 달려 나갈 수 있다(판정 중의 추적은 느리다).
      // 부채꼴은 보스 쪽이 좁다 — 멀리 있으면 옆 + 보스 쪽(옆구리)으로 비스듬히 파고드는 것이 가장 빨리 벗어나는 길이고,
      // 벗어난 자리가 곧 반격 자리다. 가까우면(coneNear 안) 옆으로만.
      const sustained = h.interval > 0 && atk.locked && !big;
      let away = null;
      if (sustained) {
        const rx = p.pos.x - boss.pos.x;
        const rz = p.pos.z - boss.pos.z;
        const side = rx * fz - rz * fx;
        const s = Math.abs(side) > EPS ? Math.sign(side) : (atk.seq % 2 === 0 ? 1 : -1);
        const d = Math.hypot(rx, rz);
        const inward = d > BOT.coneNear ? BOT.coneInward : 0;
        away = normalize(fz * s - (d > EPS ? rx / d : 0) * inward, -fx * s - (d > EPS ? rz / d : 0) * inward);
      }
      offer({
        t: wait,
        inst: `atk:${atk.seq}`,
        parity: atk.seq,
        through: big,
        cx: big ? shape.x : 0,
        cz: big ? shape.z : 0,
        lane: laneOf(shape),
        escape: sustained,
        away,
      });
    }
  }

  /** @param {GameState} state @param {(th:Threat)=>void} offer */
  function hazardThreats(state, offer) {
    const p = state.player;
    const px = p.pos.x;
    const pz = p.pos.z;
    const cr = p.radius + BOT.hazardPad;
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      const warnLeft = hz.state === 'warn' ? Math.max(0, hz.warn - hz.t) : 0;
      if (hz.grow) {
        // 충격파 띠: 중심에서 밖으로 달린다. 이미 지나갔거나 닿지 못하면 위협이 아니다.
        if (resolvedOnPlayer(state, hz.hitId)) continue;
        const d = Math.hypot(px - hz.x, pz - hz.z);
        const half = hz.grow.width / 2;
        const outer = hz.shape.rOuter;
        const inner = hz.shape.rInner;
        if (d + p.radius < inner) continue;                 // 띠 안쪽 — 이미 지나갔다
        if (d - p.radius > hz.grow.r1 + half) continue;      // 끝까지 커져도 닿지 않는다
        const speed = hz.active > 0 ? (hz.grow.r1 - hz.grow.r0) / hz.active : 0;
        const gap = d - p.radius - outer;
        let t;
        if (gap <= 0) t = warnLeft;
        else if (gap <= BOT.ringNear && speed > 0) t = warnLeft + gap / speed;
        else continue;
        offer({ t, inst: `hz:${hz.id}`, parity: hz.id, through: true, cx: hz.x, cz: hz.z, lane: null, escape: false });
        continue;
      }
      if (!shapeHitsCircle(hz.shape, px, pz, cr)) continue;
      let t = warnLeft;
      if (hz.state === 'active' && resolvedOnPlayer(state, hz.hitId)) {
        // 이번 타격은 끝났다 — 반복 장판이면 다음 타격 전에 걸어 나온다
        if (!(hz.interval > 0) || hz.t + hz.nextTick >= hz.active) continue;
        t = hz.nextTick;
      }
      const big = isBigRound(hz.shape);
      offer({
        t,
        inst: `hz:${hz.id}`,
        parity: hz.id,
        through: big,
        cx: big ? hz.shape.x : 0,
        cz: big ? hz.shape.z : 0,
        lane: laneOf(hz.shape),
        escape: true,
      });
    }
  }

  /** @param {GameState} state @param {(th:Threat)=>void} offer */
  function projectileThreats(state, offer) {
    const p = state.player;
    for (let i = 0; i < state.projectiles.length; i++) {
      const pr = state.projectiles[i];
      if (resolvedOnPlayer(state, pr.hitId)) continue; // 흘린 투사체는 그대로 지나간다
      const dx = p.pos.x - pr.x;
      const dz = p.pos.z - pr.z;
      const d = Math.hypot(dx, dz);
      const vx = Math.sin(pr.dir);
      const vz = Math.cos(pr.dir);
      const gap = d - pr.r - p.radius;
      const homing = pr.homing > 0 && pr.age < pr.homingTime;
      const toward = d > EPS ? (dx * vx + dz * vz) / d : 1;
      if (gap > 0 && !homing && toward < BOT.projAimCos) continue;
      const t = gap <= 0 || !(pr.speed > 0) ? 0 : gap / pr.speed;
      if (t > BOT.projLead) continue;
      offer({
        t,
        inst: `pr:${pr.id}`,
        parity: pr.id,
        through: false,
        cx: 0,
        cz: 0,
        lane: { ax: pr.x, az: pr.z, bx: pr.x + vx, bz: pr.z + vz },
        escape: false,
        guard: pr.guardable === true,
      });
    }
  }

  /**
   * @param {GameState} state @param {BossDef} def
   * @returns {Threat|null} 가장 이른 위협
   */
  function evalThreat(state, def) {
    /** @type {Threat|null} */
    let best = null;
    const offer = (/** @type {Threat} */ th) => {
      if (!best || th.t < best.t) best = th;
    };
    bossThreats(state, def, offer);
    hazardThreats(state, offer);
    projectileThreats(state, offer);
    return best;
  }

  // ───────────────────────── 규칙 4 · 5: 구르기 · 탈출 방향 ─────────────────────────

  /**
   * @param {GameState} state @param {Threat} th
   * @returns {Vec2} 단위 벡터
   */
  function rollDirection(state, th) {
    const p = state.player;
    const boss = state.boss;
    const px = p.pos.x;
    const pz = p.pos.z;
    const sign = th.parity % 2 === 0 ? 1 : -1;
    /** @type {Vec2|null} */
    let dir = null;
    if (th.away) {
      // 지속 판정(브레스): 부채꼴의 가까운 가장자리 쪽으로
      dir = th.away;
    } else if (th.through) {
      // 큰 원 · 띠: 중심을 향해(무적으로 뚫는다)
      const v = normalize(th.cx - px, th.cz - pz);
      if (v.x !== 0 || v.z !== 0) dir = v;
    } else if (th.lane) {
      // 돌진 선 · 세로 베기 · 투사체: 선에 수직, 지금 서 있는 쪽으로
      const l = normalize(th.lane.bx - th.lane.ax, th.lane.bz - th.lane.az);
      if (l.x !== 0 || l.z !== 0) {
        const off = (px - th.lane.ax) * l.z - (pz - th.lane.az) * l.x;
        const s = Math.abs(off) > EPS ? Math.sign(off) : sign;
        dir = { x: l.z * s, z: -l.x * s };
      }
    }
    if (!dir) {
      // 기본: 보스 방향에 수직(인스턴스 번호의 홀짝으로 좌우)
      const b = normalize(boss.pos.x - px, boss.pos.z - pz);
      dir = b.x === 0 && b.z === 0 ? { x: sign, z: 0 } : { x: b.z * sign, z: -b.x * sign };
    }
    if (!rollEndsOk(state, dir)) {
      const flip = { x: -dir.x, z: -dir.z };
      if (!th.through && rollEndsOk(state, flip)) {
        dir = flip;
      } else {
        const c = normalize(-px, -pz); // 양쪽이 막혔다 — 아레나 중심 쪽으로
        if (c.x !== 0 || c.z !== 0) dir = c;
      }
    }
    return dir;
  }

  /**
   * 장판을 걸어서 벗어나는 방향.
   * @param {GameState} state @param {Threat} th
   * @returns {Vec2}
   */
  function escapeDirection(state, th) {
    const p = state.player;
    const px = p.pos.x;
    const pz = p.pos.z;
    let v = { x: 0, z: 0 };
    if (th.away) {
      v = th.away;
    } else if (th.lane) {
      const l = normalize(th.lane.bx - th.lane.ax, th.lane.bz - th.lane.az);
      const off = (px - th.lane.ax) * l.z - (pz - th.lane.az) * l.x;
      const s = Math.abs(off) > EPS ? Math.sign(off) : mem.strafe;
      v = { x: l.z * s, z: -l.x * s };
    } else {
      // 가장 가까운 원형 장판의 중심에서 멀어진다
      let best = Infinity;
      for (let i = 0; i < state.hazards.length; i++) {
        const s = state.hazards[i].shape;
        if (s.type === 'capsule') continue;
        const d = Math.hypot(px - s.x, pz - s.z);
        if (d < best) {
          best = d;
          v = normalize(px - s.x, pz - s.z);
        }
      }
    }
    if (v.x === 0 && v.z === 0) {
      const b = normalize(px - state.boss.pos.x, pz - state.boss.pos.z);
      v = b.x === 0 && b.z === 0 ? { x: mem.strafe, z: 0 } : b;
    }
    return slideAlongWall(state, v.x, v.z, mem.strafe);
  }

  /** 지금 구르기를 누를 수 있는가(이미 구르는 중 · 선입력해 둔 상태면 다시 누르지 않는다). @param {GameState} state */
  function canPressRoll(state) {
    const p = state.player;
    if (!(p.stamina > 0) && !state.debug.noStamina) return false;
    if (p.buffer.action === 'roll') return false;
    if (p.state === 'execute') return false; // 처형 연출은 무적이다
    // 넘어져 있는 동안의 위협은 넉다운 무적이 받는다. 일어나기 직전(선입력 0.70초 안)의 것만 누른다 —
    // (W5 게이트) 넉다운 중의 구르기 선입력이 일어날 때까지 살게 되어, 일찍 누르면 1.5초 묵은 구르기가 나간다.
    if (p.state === 'knockdown') return p.stateDur - p.stateTime + PLAYER.hurt.getupDur <= PLAYER.bufferAttack;
    if (p.state === 'roll') return p.stateTime >= PLAYER.roll.iEnd;         // 무적 창이 끝난 뒤의 꼬리에서는 다시 누른다
    if (p.state === 'backstep') return p.stateTime >= PLAYER.backstep.iEnd;
    return true;
  }

  // ───────────────────────── decide ─────────────────────────

  /**
   * @param {GameState} state
   * @returns {InputFrame}
   */
  function decide(state) {
    // 1. 없음
    if (!state || state.mode !== 'boss') return NEUTRAL_INPUT;
    const p = state.player;
    const boss = state.boss;
    const fight = state.fight;
    if (!p || !boss || !fight) return NEUTRAL_INPUT;
    if (p.state === 'dead' || p.hp <= 0 || boss.hp <= 0 || boss.state === 'dead') return NEUTRAL_INPUT;
    if (fight.phase === 'done' || fight.phase === 'outro') return NEUTRAL_INPUT;
    const def = getBossDef(boss.id);
    const weapon = getWeaponDef(p.stats.weaponId);
    if (!def || !weapon) return NEUTRAL_INPUT;

    const out = makeInput();
    trackBoss(boss);

    // 2. 록온
    if (!p.lockOn) out.lockOnPressed = true;

    const dx = boss.pos.x - p.pos.x;
    const dz = boss.pos.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const toBoss = dist > EPS ? { x: dx / dist, z: dz / dist } : { x: 0, z: 1 };

    // 3. 위협 평가
    const threat = evalThreat(state, def);

    // 4a. 막을 수 있는 투사체(유도 구체)는 가드로 받는다 — 연달아 오는 구체는 구르기 한 번의 무적으로 다 흘릴 수 없다.
    //     인스턴스당 한 번 굴려(구르기와 같은 주사위) 성공이면 닿을 때까지 가드를 쥔다. 스태미나가 모자라면 구른다(아래).
    if (threat && threat.guard && !p.exhausted && (p.stamina >= BOT.guardStamina || state.debug.noStamina)
      && willDodge(threat.inst)) {
      out.guard = true;
      return out;
    }

    // 4. 구르기 — 인스턴스당 한 번 굴려 성공이면 누른다
    if (threat && threat.t <= cfg.reaction && willDodge(threat.inst) && canPressRoll(state)) {
      const dir = rollDirection(state, threat);
      mem.rollDir = dir;
      out.rollPressed = true;
      out.moveX = dir.x;
      out.moveZ = dir.z;
      return out;
    }
    // 선입력해 둔 구르기는 소비되는 틱의 이동 의도를 방향으로 쓴다 — 그때까지 같은 방향을 쥐고 있는다
    if (p.buffer.action === 'roll' && mem.rollDir) {
      out.moveX = mem.rollDir.x;
      out.moveZ = mem.rollDir.z;
      return out;
    }

    // 5. 장판 탈출 — 시간이 남았으면 걸어서(달려서) 나온다
    if (threat && threat.escape && threat.t > cfg.reaction) {
      const dir = escapeDirection(state, threat);
      out.moveX = dir.x;
      out.moveZ = dir.z;
      out.sprint = p.stamina > BOT.retreatStamina && !p.exhausted;
      return out;
    }

    const busy = bossBusyFor(boss, def, dist);
    const winding = boss.state === 'attack' && !!boss.attack && boss.attack.phase !== 'recovery';

    // 6. 회복 — 안전하면 마시고, 아니면 거리를 벌린다
    if (p.hp / p.stats.hpMax < BOT.healBelow && p.flasks > 0) {
      const away = slideAlongWall(state, -toBoss.x, -toBoss.z, mem.strafe);
      const safe = (dist > BOT.healSafeDist && !winding) || busy > BOT.healRecovery;
      if (p.state === 'flask' || safe) {
        if (p.state !== 'flask' && p.buffer.action !== 'flask') out.flaskPressed = true;
        out.moveX = away.x * BOT.flaskDrift;
        out.moveZ = away.z * BOT.flaskDrift;
        return out;
      }
      out.moveX = away.x;
      out.moveZ = away.z;
      out.sprint = p.stamina > BOT.retreatStamina && !p.exhausted;
      return out;
    }

    // 7. 처형 — 그로기면 보스 정면으로 가서, 조건이 되면 약공격(조건식은 sim의 canExecute가 정본이다)
    if (boss.state === 'groggy') {
      if (p.canExecute) {
        if (p.buffer.action !== 'light') out.lightPressed = true;
        return out;
      }
      const stand = boss.radius + BOT.executeStand;
      const tx = boss.pos.x + Math.sin(boss.facing) * stand - p.pos.x;
      const tz = boss.pos.z + Math.cos(boss.facing) * stand - p.pos.z;
      const td = Math.hypot(tx, tz);
      if (td > BOT.edgeBand) {
        out.moveX = tx / td;
        out.moveZ = tz / td;
        out.sprint = td > BOT.executeStand && p.stamina > BOT.retreatStamina && !p.exhausted;
      }
      return out;
    }

    // 8. 반격
    const reach = weapon.reach + boss.radius - BOT.reachPad;
    const inReach = dist <= reach;
    const fighting = fight.phase === 'fight' && !boss.invulnerable;
    const punish = boss.state === 'attack' && !!boss.attack && boss.attack.phase === 'recovery'
      && busy >= BOT.punishRecovery && !chainPending(boss, def, dist);
    const downed = boss.state === 'parried' || (boss.state === 'recover' && busy >= BOT.punishRecovery);
    const first = (boss.state === 'idle' || boss.state === 'chase') && mem.aggro;
    const safeToCommit = !threat || threat.t >= BOT.attackCommit;
    if (fighting && inReach && safeToCommit && (punish || downed || first)
      && (p.stamina >= BOT.attackStamina || state.debug.noStamina)) {
      const a = p.attack;
      if (p.state === 'attack' && a) {
        // 공격 중이면 후딜에 들어설 때마다 다시(선입력 → comboAt에 다음 타)
        if (a.phase === 'recovery' && mem.comboFor !== a.hitId && p.buffer.action !== 'light') {
          mem.comboFor = a.hitId;
          out.lightPressed = true;
        }
      } else if (p.buffer.action !== 'light') {
        out.lightPressed = true;
      }
      return out;
    }

    // 9. 거리 유지
    if (p.stamina < BOT.retreatStamina && !state.debug.noStamina) {
      const away = slideAlongWall(state, -toBoss.x, -toBoss.z, mem.strafe);
      out.moveX = away.x;
      out.moveZ = away.z;
      return out;
    }
    if (!inReach) {
      out.moveX = toBoss.x;
      out.moveZ = toBoss.z;
      out.sprint = dist > BOT.sprintDist && p.stamina > BOT.sprintStamina && !p.exhausted;
      return out;
    }
    if (winding) return out; // 사거리 안이고 보스가 예고 중이면 멈춰서 위협 평가를 기다린다

    // 10. 사거리 끝에서 옆걸음
    let sx = toBoss.z * mem.strafe;
    let sz = -toBoss.x * mem.strafe;
    const slid = slideAlongWall(state, sx, sz, mem.strafe);
    if (slid.x !== sx || slid.z !== sz) mem.strafe = -mem.strafe; // 벽에 닿으면 방향을 바꾼다
    sx = slid.x;
    sz = slid.z;
    // 사거리 끝(reach − edgeBand ~ reach)에 머문다
    let radial = 0;
    if (dist > reach - BOT.edgeBand) radial = 1;
    else if (dist < reach - 2 * BOT.edgeBand) radial = -1;
    const m = normalize(sx + toBoss.x * radial * 0.5, sz + toBoss.z * radial * 0.5);
    out.moveX = m.x;
    out.moveZ = m.z;
    return out;
  }

  return { decide, reset };
}
