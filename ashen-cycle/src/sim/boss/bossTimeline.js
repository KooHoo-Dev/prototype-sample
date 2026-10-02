// OWNER: P3 — 계약 §8.1~§8.5 (공격 시간축 tA · 다단 히트 · 추적/고정 · 이동 4종 · 타임라인 이벤트 5종)
// 패키지 내부 파일 — bossSim.js만 import 한다. 보스 ID 분기 없음: 읽는 것은 ctx.bossDef · ctx.bossHooks · ctx.scaling뿐이다.
//
// 공격 인스턴스의 프레임워크 전용 기억은 attack.fw 에 둔다(계약 §3.5 밖의 내부 필드 · 순수 값).
// 테스트가 §3.5 필드만으로 손수 만든 attack 을 끼워 넣어도 돌도록, fw 가 없으면 그 자리에서 만든다.
import { EV } from '../../core/events.js';
import { EPS, TAU } from '../../core/constants.js';
import { angleOf, clamp01, lerp, localToWorld, turnToward, wrapAngle } from '../../core/math2d.js';
import { circleOverlapsWorld, resolveCircleVsWorld, sweepCircleVsWorld } from '../../core/collide.js';
import { BOSS_AI } from '../../data/bossCommon.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').BossState} BossState */
/** @typedef {import('../../types.js').BossAttackDef} BossAttackDef */
/** @typedef {import('../../types.js').BossAttackRuntime} BossAttackRuntime */
/** @typedef {import('../../types.js').BossMoveDef} BossMoveDef */
/** @typedef {import('../../types.js').BossTimelineEvent} BossTimelineEvent */
/** @typedef {import('../../types.js').BossHooks} BossHooks */
/** @typedef {import('../../types.js').OutgoingHit} OutgoingHit */
/** @typedef {import('../../types.js').TelegraphSrc} TelegraphSrc */

/**
 * 공격 인스턴스의 내부 기억.
 * @typedef {Object} AttackFw
 * @property {number} lockFacing  고정된 방향 L(§8.3 — sweep · 텔레그래프 기준)
 * @property {boolean} aimLocked  조준점이 고정됐는가(leap은 aimLock, 그 밖은 방향 고정과 같은 순간)
 * @property {boolean} activeSent BOSS_ATTACK_ACTIVE를 냈는가
 * @property {boolean} moveOn     이동이 시작됐는가
 * @property {number} moveU       이동 진행도 0..1(마지막으로 적용한 값)
 * @property {number} startX      이동 시작 위치(leap의 dist 상한 기준)
 * @property {number} startZ
 * @property {number[]} hitTick   hits[i]의 현재 반복 번호(−1 = 아직 안 열림)
 * @property {number[]} evN       events[i]의 실행 횟수(−1 = 끝났거나 건너뜀)
 * @property {number} chainN      이 공격까지 이어 온 연속기 횟수
 * @property {number} chainIdx    다음에 볼 chain 항목
 */

/** @type {BossHooks} */
const NO_HOOKS = Object.freeze({});
/** track이 빠진 정의(손수 만든 합성 정의)를 위한 기본값 — 추적 없음 · 판정 시작에 고정 */
const NO_TRACK = Object.freeze({ turnRate: 0, lockLead: 0 });
/** hits · events가 빠진 정의를 위한 빈 목록 @type {any[]} */
const NO_LIST = Object.freeze([]);

/** @param {number} u @returns {number} */
function easeOutQuad(u) {
  return 1 - (1 - u) * (1 - u);
}

/**
 * 보스 상태의 프레임워크 전용 기억(boss.fw — 계약 §3.5 밖의 내부 필드 · 순수 값).
 *   created: hooks.onCreate를 불렀는가 · seq: 공격 인스턴스 일련번호 · strafeT: 스트레이프 방향 재추첨까지 남은 초
 *   rearHold: 뒤를 잡힌 채 고민 중인가(idle에서 돌아서지 않는다 — bossSim.enterIdle)
 * helpers의 makeTestBoss처럼 fw 없이 만든 상태도 받는다.
 * @param {BossState} boss
 * @returns {{created:boolean, seq:number, strafeT:number, rearHold:boolean}}
 */
export function ensureBossFw(boss) {
  /** @type {any} */
  const b = boss;
  if (!b.fw) b.fw = { created: false, seq: 0, strafeT: 0, rearHold: false };
  return b.fw;
}

/**
 * @param {BossAttackRuntime} atk
 * @param {BossAttackDef} ad
 * @param {BossState} boss
 * @returns {AttackFw}
 */
function ensureAttackFw(atk, ad, boss) {
  /** @type {any} */
  const a = atk;
  if (!a.fw) {
    if (!Array.isArray(atk.fired)) atk.fired = [];
    if (!Array.isArray(atk.hitIds)) atk.hitIds = [];
    a.fw = {
      lockFacing: boss.facing,
      aimLocked: !!atk.locked,
      activeSent: atk.phase !== 'windup',
      moveOn: false,
      moveU: 0,
      startX: boss.pos.x,
      startZ: boss.pos.z,
      hitTick: (ad.hits || NO_LIST).map(() => -1),
      evN: (ad.events || NO_LIST).map((_, i) => (atk.fired.includes(i) ? -1 : 0)),
      chainN: 0,
      chainIdx: 0,
    };
  }
  return a.fw;
}

/**
 * 공격 시작(§8.1). 예고부터 다시 시작하므로 연속기도 다시 추적한다.
 * BOSS_ATTACK_WINDUP · hooks.onAttackStart. 쿨다운 · lastAttacks · chaseTime을 갱신한다.
 * @param {SimCtx} ctx
 * @param {string} id
 * @param {boolean} chained
 * @param {number} chainN 이 공격까지 이어 온 연속기 횟수(AI가 고른 공격은 0)
 */
export function startAttack(ctx, id, chained, chainN) {
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  const ad = def.attacks[id];
  const player = ctx.state.player;
  const bfw = ensureBossFw(boss);
  const speed = boss.speedMul > 0 ? boss.speedMul : 1;
  const windup = Math.max(BOSS_AI.minWindup, ad.windup / speed);
  const recovery = ad.recovery / speed;
  const prevSeq = boss.attack ? boss.attack.seq : 0;
  bfw.seq = Math.max(bfw.seq, prevSeq) + 1;

  /** @type {any} */
  const atk = {
    id,
    seq: bfw.seq,
    pose: ad.pose,
    glow: ad.glow,
    phase: 'windup',
    phaseT: 0,
    t: 0,
    windup,
    active: ad.active,
    recovery,
    locked: false,
    aimX: player.pos.x,
    aimZ: player.pos.z,
    chained,
    fired: [],
    hitIds: (ad.hits || NO_LIST).map(() => 0),
    fw: {
      lockFacing: boss.facing,
      aimLocked: false,
      activeSent: false,
      moveOn: false,
      moveU: 0,
      startX: boss.pos.x,
      startZ: boss.pos.z,
      hitTick: (ad.hits || NO_LIST).map(() => -1),
      evN: (ad.events || NO_LIST).map(() => 0),
      chainN,
      chainIdx: 0,
    },
  };
  boss.attack = atk;
  boss.state = 'attack';
  boss.stateTime = 0;
  boss.stateDur = windup + ad.active + recovery;
  boss.invulnerable = false;
  boss.moveIntent = 'hold';
  boss.chaseTime = 0;
  if (ad.sel) boss.cooldowns[id] = ad.sel.cooldown;
  boss.lastAttacks.unshift(id);
  const keep = BOSS_AI.repeatPenalty.length; // 직전 · 전전까지만 기억한다
  if (boss.lastAttacks.length > keep) boss.lastAttacks.length = keep;

  ctx.emit(EV.BOSS_ATTACK_WINDUP, {
    bossId: boss.id, attackId: id, seq: atk.seq, pose: ad.pose, glow: ad.glow, windup,
    x: boss.pos.x, z: boss.pos.z, facing: boss.facing,
  });
  const hooks = ctx.bossHooks || NO_HOOKS;
  if (hooks.onAttackStart) hooks.onAttackStart(ctx, atk);
}

/**
 * 공격 끝(후딜 종료 · 연속기 전환 · 중단). BOSS_ATTACK_END · hooks.onAttackEnd. 남은 타임라인 이벤트는 버려진다.
 * @param {SimCtx} ctx
 * @param {boolean} interrupted
 */
export function endAttack(ctx, interrupted) {
  const boss = ctx.state.boss;
  const atk = boss.attack;
  if (!atk) return;
  const ad = ctx.bossDef ? ctx.bossDef.attacks[atk.id] : null;
  const bfw = ensureBossFw(boss);
  if (atk.seq > bfw.seq) bfw.seq = atk.seq; // 손수 만든 attack 뒤에도 seq는 계속 커진다
  boss.attack = null;
  // 도약 · 백홉 도중에 끊기면 공중에 남지 않게 한다(부유 보스는 훅의 onTick이 다시 올린다).
  if (ad && ad.move && ad.move.height) boss.y = 0;
  ctx.emit(EV.BOSS_ATTACK_END, { bossId: boss.id, attackId: atk.id, seq: atk.seq, interrupted });
  const hooks = ctx.bossHooks || NO_HOOKS;
  if (hooks.onAttackEnd) hooks.onAttackEnd(ctx, atk);
}

/**
 * 현재 공격을 한 틱 진행한다: 구간 · 추적/고정 · 조준점 · 이동 · 판정 창(hitId) · 타임라인 이벤트.
 * @param {SimCtx} ctx
 * @param {number} dt
 * @returns {boolean} 후딜까지 끝났으면 true
 */
export function stepAttack(ctx, dt) {
  const boss = ctx.state.boss;
  const atk = boss.attack;
  const ad = ctx.bossDef.attacks[atk.id];
  if (!ad) return true; // 정의에 없는 공격(손수 만든 상태) — 바로 끝낸다
  const fw = ensureAttackFw(atk, ad, boss);
  const player = ctx.state.player;

  atk.t += dt;
  const total = atk.windup + atk.active + atk.recovery;
  boss.stateTime = atk.t;
  boss.stateDur = total;
  const tA = atk.t - atk.windup;

  // ── 구간(§8.1)
  if (tA < -EPS) {
    atk.phase = 'windup';
    atk.phaseT = atk.windup > 0 ? clamp01(atk.t / atk.windup) : 1;
  } else if (tA < atk.active - EPS) {
    atk.phase = 'active';
    atk.phaseT = clamp01(tA / atk.active);
  } else {
    atk.phase = 'recovery';
    atk.phaseT = atk.recovery > 0 ? clamp01((tA - atk.active) / atk.recovery) : 1;
  }

  // ── 추적과 방향 고정(§8.3)
  const track = ad.track || NO_TRACK;
  const lockAt = -(track.lockLead || 0);
  const pdx = player.pos.x - boss.pos.x;
  const pdz = player.pos.z - boss.pos.z;
  const hasDir = pdx * pdx + pdz * pdz > EPS;
  if (!atk.locked) {
    if (track.turnRate > 0 && hasDir) boss.facing = turnToward(boss.facing, angleOf(pdx, pdz), track.turnRate * dt);
    if (tA >= lockAt - EPS) {
      atk.locked = true;
      fw.lockFacing = boss.facing;
    }
  }
  if (atk.locked) {
    const sw = track.sweep;
    if (sw) {
      // 고정 순간 → tA 0: L → L + from, 판정 동안: L + from → L + to. 후딜에는 L + to에 머문다.
      let off;
      if (tA < 0) off = sw.from * (lockAt < 0 ? clamp01((tA - lockAt) / -lockAt) : 1);
      else off = lerp(sw.from, sw.to, atk.active > 0 ? clamp01(tA / atk.active) : 1);
      boss.facing = wrapAngle(fw.lockFacing + off);
    } else if (track.activeTurnRate > 0 && atk.phase === 'active' && hasDir) {
      boss.facing = turnToward(boss.facing, angleOf(pdx, pdz), track.activeTurnRate * dt);
    }
  }

  // ── 조준점: 고정 전에는 플레이어를 따라간다
  const mv = ad.move;
  if (!fw.aimLocked) {
    let ax = player.pos.x;
    let az = player.pos.z;
    if (mv && mv.kind === 'leap') {
      // 도약 거리가 dist를 넘으면 그 안으로 당긴다(§8.4)
      const ox = fw.moveOn ? fw.startX : boss.pos.x;
      const oz = fw.moveOn ? fw.startZ : boss.pos.z;
      const dx = ax - ox;
      const dz = az - oz;
      const d = Math.hypot(dx, dz);
      if (d > mv.dist && d > 0) {
        ax = ox + (dx / d) * mv.dist;
        az = oz + (dz / d) * mv.dist;
      }
      // (W5) 착지점까지의 직선이 기둥 · 경계에 막히면 그 앞에 내려앉는다 — 조준점(바닥 표식 · 판정 원)도 함께 당긴다.
      // 막힌 채 「남은 거리의 비율」로 가면 매 틱 되밀려 공중에 걸려 있다가 마지막 틱에 남은 거리를 한 번에 뛴다.
      const stop = leapStop(boss, mv);
      const lx = ax - boss.pos.x;
      const lz = az - boss.pos.z;
      const ld = Math.hypot(lx, lz);
      if (ld > stop) {
        const ux = lx / ld;
        const uz = lz / ld;
        const free = sweepCircleVsWorld(boss.pos.x, boss.pos.z, ux, uz, ld - stop, boss.radius, ctx.state.world);
        if (free < ld - stop) {
          ax = boss.pos.x + ux * (free + stop);
          az = boss.pos.z + uz * (free + stop);
        }
      }
    }
    atk.aimX = ax;
    atk.aimZ = az;
    const aimAt = mv && mv.kind === 'leap' && mv.aimLock !== undefined ? mv.aimLock : lockAt;
    if (tA >= aimAt - EPS) fw.aimLocked = true;
  }

  // ── 이동(§8.4)
  if (mv) stepMove(ctx, atk, mv, fw, tA);

  // ── 판정 시작 알림
  if (!fw.activeSent && tA >= -EPS) {
    fw.activeSent = true;
    boss.postureGuard = false; // (W5) 일어난 뒤의 첫 공격이 나왔다 — 체간 잠금을 푼다(§8.7)
    ctx.emit(EV.BOSS_ATTACK_ACTIVE, {
      bossId: boss.id, attackId: atk.id, seq: atk.seq, pose: atk.pose, active: atk.active,
      x: boss.pos.x, z: boss.pos.z, facing: boss.facing,
    });
  }

  // ── 판정 창(§8.2): 창이 열릴 때 · interval마다 hitId를 새로 받는다
  const hits = ad.hits || NO_LIST;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (tA < h.t0 - EPS || tA >= h.t1 - EPS) continue;
    const k = h.interval > 0 ? Math.floor((tA - h.t0) / h.interval + EPS) : 0;
    if (fw.hitTick[i] !== k) {
      fw.hitTick[i] = k;
      atk.hitIds[i] = ctx.nextHitId();
    }
  }

  // ── 타임라인 이벤트(§8.5)
  const events = ad.events || NO_LIST;
  for (let i = 0; i < events.length; i++) {
    const done = fw.evN[i];
    if (done < 0) continue;
    const ev = events[i];
    if (tA < ev.t - EPS) continue;
    if (done === 0) {
      if (ev.phase !== undefined && ev.phase !== boss.phase) {
        fw.evN[i] = -1;
        continue;
      }
      atk.fired.push(i);
    }
    const multi = ev.type === 'projectile' || ev.type === 'hazard';
    const count = multi ? Math.max(1, ev.count === undefined ? 1 : ev.count) : 1;
    const interval = ev.interval || 0;
    const due = count > 1 && interval > 0
      ? Math.min(count, Math.floor((tA - ev.t) / interval + EPS) + 1)
      : count;
    let n = done;
    while (n < due) {
      fireEvent(ctx, atk, ev, n, count);
      n += 1;
    }
    fw.evN[i] = n >= count ? -1 : n;
  }

  return atk.t >= total - EPS;
}

/**
 * @param {SimCtx} ctx
 * @param {BossAttackRuntime} atk
 * @param {BossMoveDef} mv
 * @param {AttackFw} fw
 * @param {number} tA
 */
function stepMove(ctx, atk, mv, fw, tA) {
  const boss = ctx.state.boss;
  // 배속으로 예고가 줄어 t0가 공격 시작보다 앞서면, 남은 구간에 전체 이동을 눌러 담는다.
  const t0 = Math.max(mv.t0, -atk.windup);
  const span = mv.t1 - t0;
  const u1 = span > 0 ? clamp01((tA - t0) / span) : (tA >= mv.t1 - EPS ? 1 : 0);
  const u0 = fw.moveU;
  if (u1 <= u0) return;
  if (!fw.moveOn) {
    fw.moveOn = true;
    fw.startX = boss.pos.x;
    fw.startZ = boss.pos.z;
  }
  fw.moveU = u1;
  const fx = Math.sin(boss.facing);
  const fz = Math.cos(boss.facing);
  const height = mv.height || 0;

  switch (mv.kind) {
    case 'lunge': {
      const want = mv.dist * (easeOutQuad(u1) - easeOutQuad(u0));
      const s = Math.min(want, lungeRoom(ctx, mv, fx, fz));
      if (s > 0) {
        boss.pos.x += fx * s;
        boss.pos.z += fz * s;
      }
      break;
    }
    case 'charge': {
      const s = mv.dist * (u1 - u0);
      boss.pos.x += fx * s;
      boss.pos.z += fz * s;
      break;
    }
    case 'hop': {
      const s = mv.dist * (u1 - u0);
      boss.pos.x -= fx * s;
      boss.pos.z -= fz * s;
      boss.y = u1 < 1 ? height * Math.sin(Math.PI * u1) : 0;
      break;
    }
    case 'leap': {
      // 남은 거리의 (u1 − u0) / (1 − u0)만큼 간다 — 방해가 없으면 선형 보간과 같고, 조준점이 움직여도 t1에 정확히 닿는다.
      const stop = leapStop(boss, mv);
      const dx = atk.aimX - boss.pos.x;
      const dz = atk.aimZ - boss.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > stop) {
        const go = (d - stop) * ((u1 - u0) / (1 - u0));
        boss.pos.x += (dx / d) * go;
        boss.pos.z += (dz / d) * go;
      }
      boss.y = u1 < 1 ? height * Math.sin(Math.PI * u1) : 0;
      break;
    }
    default:
      break;
  }
}

/** leap이 조준점에서 못 미쳐 멈추는 거리(m). @param {BossState} boss @param {BossMoveDef} mv @returns {number} */
function leapStop(boss, mv) {
  return mv.stopShort === undefined ? boss.radius + BOSS_AI.stopShortPad : mv.stopShort;
}

/**
 * lunge가 앞으로 더 갈 수 있는 거리 — 플레이어 중심에서 stopShort 앞에서 멈춘다.
 * @param {SimCtx} ctx
 * @param {BossMoveDef} mv
 * @param {number} fx 전진 방향
 * @param {number} fz
 * @returns {number}
 */
function lungeRoom(ctx, mv, fx, fz) {
  const boss = ctx.state.boss;
  const p = ctx.state.player.pos;
  const stop = mv.stopShort === undefined ? boss.radius + BOSS_AI.stopShortPad : mv.stopShort;
  const rx = p.x - boss.pos.x;
  const rz = p.z - boss.pos.z;
  const ahead = rx * fx + rz * fz;
  if (ahead <= 0) return mv.dist; // 플레이어가 뒤에 있다 — 막을 것이 없다
  const side2 = rx * rx + rz * rz - ahead * ahead;
  const stop2 = stop * stop;
  if (side2 >= stop2) return mv.dist; // 옆으로 비켜 지나간다
  return Math.max(0, ahead - Math.sqrt(stop2 - side2));
}

/**
 * 타임라인 이벤트 하나(§8.5). k = 이 이벤트의 몇 번째 실행인가(0부터), count = 전체 횟수.
 * @param {SimCtx} ctx
 * @param {BossAttackRuntime} atk
 * @param {BossTimelineEvent} ev
 * @param {number} k
 * @param {number} count
 */
function fireEvent(ctx, atk, ev, k, count) {
  const boss = ctx.state.boss;
  const player = ctx.state.player;
  switch (ev.type) {
    case 'projectile': {
      const o = ev.origin;
      const from = localToWorld(boss.pos.x, boss.pos.z, boss.facing, o ? o.fwd : 0, o ? o.side : 0);
      const dx = player.pos.x - from.x;
      const dz = player.pos.z - from.z;
      let dir = dx * dx + dz * dz > EPS ? angleOf(dx, dz) : boss.facing;
      if (ev.spread && count > 1) dir += lerp(-ev.spread / 2, ev.spread / 2, k / (count - 1));
      ctx.spawnProjectile(ev.proj, from.x, from.z, wrapAngle(dir), boss.dmgMul);
      break;
    }
    case 'hazard':
      spawnPlacedHazard(ctx, atk, ev, k, count);
      break;
    case 'teleport':
      teleport(ctx, atk, ev);
      break;
    case 'cue': {
      ctx.emit(EV.BOSS_CUE, {
        bossId: boss.id, attackId: atk.id, seq: atk.seq, cue: ev.cue, style: ctx.bossDef.style,
        x: boss.pos.x, z: boss.pos.z, facing: boss.facing, ...ev.params,
      });
      if (ev.shake) ctx.shake(ev.shake[0], ev.shake[1]);
      break;
    }
    case 'hook': {
      const hooks = ctx.bossHooks || NO_HOOKS;
      if (hooks.onTimelineEvent) hooks.onTimelineEvent(ctx, ev);
      break;
    }
    default:
      break;
  }
}

/**
 * place 규칙으로 위치를 정해 장판을 소환한다.
 * @param {SimCtx} ctx
 * @param {BossAttackRuntime} atk
 * @param {BossTimelineEvent} ev
 * @param {number} k
 * @param {number} count
 */
function spawnPlacedHazard(ctx, atk, ev, k, count) {
  const boss = ctx.state.boss;
  const player = ctx.state.player;
  const place = ev.place;
  const mode = place ? place.mode : 'self';
  const radius = place && place.radius ? place.radius : 0;
  let x = boss.pos.x;
  let z = boss.pos.z;
  let facing = boss.facing;
  switch (mode) {
    case 'target':
      x = player.pos.x;
      z = player.pos.z;
      break;
    case 'aim':
      x = atk.aimX;
      z = atk.aimZ;
      break;
    case 'scatter': {
      x = player.pos.x;
      z = player.pos.z;
      if (k > 0) {
        // 원판 안 균등 분포. 첫 개는 플레이어 위치 그대로다(가만히 있으면 반드시 맞는다).
        const a = ctx.rng.range(-Math.PI, Math.PI);
        const r = radius * Math.sqrt(ctx.rng.next());
        x += Math.sin(a) * r;
        z += Math.cos(a) * r;
      }
      break;
    }
    case 'ringAround': {
      const a = wrapAngle(boss.facing + (k * TAU) / count);
      x = boss.pos.x + Math.sin(a) * radius;
      z = boss.pos.z + Math.cos(a) * radius;
      facing = a;
      break;
    }
    case 'chase': {
      const lead = place.lead || 0;
      x = player.pos.x + player.vel.x * lead;
      z = player.pos.z + player.vel.z * lead;
      break;
    }
    default: // 'self'
      break;
  }
  if (mode !== 'self') {
    // 아레나 밖에 깔리는 장판은 버려지는 연출이다 — 경계 안으로 당긴다.
    const lim = ctx.state.world.radius;
    const l = Math.hypot(x, z);
    if (l > lim && l > 0) {
      x *= lim / l;
      z *= lim / l;
    }
  }
  ctx.spawnHazard(ev.hazard, x, z, facing, boss.dmgMul);
}

/**
 * 순간이동(§8.5). pos와 prevPos를 함께 덮어쓴다(§5.4 순간 이동 규칙). 이동 뒤 facing은 플레이어 쪽.
 * @param {SimCtx} ctx
 * @param {BossAttackRuntime} atk
 * @param {BossTimelineEvent} ev
 */
function teleport(ctx, atk, ev) {
  const boss = ctx.state.boss;
  const player = ctx.state.player;
  const world = ctx.state.world;
  const px = player.pos.x;
  const pz = player.pos.z;
  const dist = ev.dist || 0;
  const fromX = boss.pos.x;
  const fromZ = boss.pos.z;
  let x = 0;
  let z = 0;
  switch (ev.to) {
    case 'away': {
      // 플레이어 → 원점 방향(가장 넓은 쪽). 플레이어가 원점에 있으면 지금 서 있는 쪽으로 물러난다.
      let dx = -px;
      let dz = -pz;
      let l = Math.hypot(dx, dz);
      if (l < EPS) {
        dx = fromX - px;
        dz = fromZ - pz;
        l = Math.hypot(dx, dz);
      }
      if (l < EPS) {
        dx = 0;
        dz = 1;
        l = 1;
      }
      x = px + (dx / l) * dist;
      z = pz + (dz / l) * dist;
      break;
    }
    case 'behindTarget':
      x = px - Math.sin(player.facing) * dist;
      z = pz - Math.cos(player.facing) * dist;
      break;
    case 'flank': {
      // 오른쪽 벡터 = (−cos θ, sin θ) (§0.2)
      const side = ctx.rng.chance(0.5) ? 1 : -1;
      x = px - Math.cos(player.facing) * dist * side;
      z = pz + Math.sin(player.facing) * dist * side;
      break;
    }
    default: // 'center'
      break;
  }

  // 목적지는 world.radius − radius − margin 안, 콜라이더와 겹치지 않게
  const lim = Math.max(0, world.radius - boss.radius - BOSS_AI.teleportMargin);
  const dest = { x, z };
  for (let i = 0; i < BOSS_AI.teleportTries; i++) {
    const l = Math.hypot(dest.x, dest.z);
    if (l > lim) {
      const s = l > 0 ? lim / l : 0;
      dest.x *= s;
      dest.z *= s;
    }
    if (!circleOverlapsWorld(dest.x, dest.z, boss.radius, world)) break;
    resolveCircleVsWorld(dest, boss.radius, world);
  }
  if (!Number.isFinite(dest.x) || !Number.isFinite(dest.z) || circleOverlapsWorld(dest.x, dest.z, boss.radius, world)) {
    // 끝내 자리를 못 찾으면 움직이지 않는다
    dest.x = fromX;
    dest.z = fromZ;
  }

  boss.pos.x = dest.x;
  boss.pos.z = dest.z;
  boss.prevPos.x = dest.x;
  boss.prevPos.z = dest.z;
  const dx = px - dest.x;
  const dz = pz - dest.z;
  if (dx * dx + dz * dz > EPS) boss.facing = angleOf(dx, dz);
  boss.prevFacing = boss.facing;
  /** @type {any} */
  const a = atk;
  if (a.fw) a.fw.lockFacing = boss.facing;
  ctx.emit(EV.BOSS_TELEPORT, { fromX, fromZ, toX: dest.x, toZ: dest.z });
}

/**
 * 이번 틱에 살아 있는 판정들(§8.2). 셰이프 원점 = 보스 현재 pos, 기준 방향 = 현재 facing.
 * @param {SimCtx} ctx
 * @returns {OutgoingHit[]}
 */
export function collectHits(ctx) {
  /** @type {OutgoingHit[]} */
  const out = [];
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  if (!boss || !def || boss.state !== 'attack' || !boss.attack) return out;
  const atk = boss.attack;
  const ad = def.attacks[atk.id];
  if (!ad) return out;
  const tA = atk.t - atk.windup;
  const hits = ad.hits || NO_LIST;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (tA < h.t0 - EPS || tA >= h.t1 - EPS) continue;
    if (!Array.isArray(atk.hitIds)) atk.hitIds = [];
    if (!(atk.hitIds[i] > 0)) atk.hitIds[i] = ctx.nextHitId(); // 손수 만든 attack — 번호가 아직 없다
    out.push({
      source: 'boss',
      attackId: atk.id,
      hitId: atk.hitIds[i],
      shapeDef: h.shape,
      x: boss.pos.x,
      z: boss.pos.z,
      facing: boss.facing,
      damage: h.damage * boss.dmgMul,
      posture: 0,
      guardable: h.guardable,
      parryable: h.parryable,
      knockdown: h.knockdown,
      heavy: h.knockdown,
      execute: false,
      hitstop: 0,
    });
  }
  return out;
}

/**
 * 예고 중인 표식(telegraph:true인 hit) — 공격 시작부터 그 hit의 t0까지(§8.3 · §8.4).
 * @param {SimCtx} ctx
 * @returns {TelegraphSrc[]}
 */
export function collectTelegraphs(ctx) {
  /** @type {TelegraphSrc[]} */
  const out = [];
  const boss = ctx.state.boss;
  const def = ctx.bossDef;
  if (!boss || !def || boss.state !== 'attack' || !boss.attack) return out;
  const atk = boss.attack;
  const ad = def.attacks[atk.id];
  if (!ad) return out;
  const tA = atk.t - atk.windup;
  const hits = ad.hits || NO_LIST;
  /** @type {any} */
  const a = atk;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (!h.telegraph || tA >= h.t0 - EPS) continue;
    const atAim = h.telegraphAt === 'aim';
    // sweep 공격의 표식은 고정 방향 L에 머문다(쓸리는 범위 전체를 그린다 — §8.3)
    const sweepLocked = atk.locked && ad.track && ad.track.sweep && a.fw;
    const lead = atk.windup + h.t0;
    out.push({
      id: `atk:${atk.seq}:${i}`,
      shapeDef: h.telegraphShape || h.shape,
      x: atAim ? atk.aimX : boss.pos.x,
      z: atAim ? atk.aimZ : boss.pos.z,
      facing: sweepLocked ? a.fw.lockFacing : boss.facing,
      progress: lead > 0 ? clamp01(atk.t / lead) : 1,
      style: atk.glow && atk.glow !== 'none' ? atk.glow : def.style,
    });
  }
  return out;
}
