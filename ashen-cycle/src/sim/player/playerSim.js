// OWNER: P1 — 계약 §6.3 · §7.1 · §7.3
// 플레이어 상태 기계. 순수 sim(three · DOM 없음) — 수치는 전부 data/player.js · data/weapons.js에서 읽는다.
//
// 한 틱(updatePlayer)의 순서:
//   타이머 감소 → 록온 → 가드 에지(패링 장전/재장전) → 에지 입력을 버퍼에 저장
//   → stateTime 진행 · 구간 전환 → 버퍼 소비 · 가드 진입(상태가 허용하는 첫 틱) → 이동 적분 → 스태미나 회복 → 플래그
// 모든 에지 입력은 먼저 버퍼를 거친다("지금 누름" = "방금 저장된 버퍼"). 그래서 실행 경로가 하나뿐이고,
// 받을 수 없는 틱에 누른 입력은 남은 유효 시간 안에서 상태가 허용하는 첫 틱에 나간다.
// 상태에 들어간 틱의 stateTime은 0이고, 구간 경계는 `stateTime ≥ 경계`로 읽는다(경계가 틱 사이에 있으면 다음 틱).
import { DT, EPS } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { angleDiff, angleOf, clamp01, damp, lerp, turnToward, wrapAngle } from '../../core/math2d.js';
import { PLAYER } from '../../data/player.js';
import { getMoveDef, getWeaponDef } from '../../data/weapons.js';

/** @typedef {import('../../types.js').PlayerState} PlayerState */
/** @typedef {import('../../types.js').PlayerStateName} PlayerStateName */
/** @typedef {import('../../types.js').PlayerAttack} PlayerAttack */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').StatBlock} StatBlock */
/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').InputFrame} InputFrame */
/** @typedef {import('../../types.js').MoveDef} MoveDef */
/** @typedef {import('../../types.js').ShapeDef} ShapeDef */
/** @typedef {import('../../types.js').OutgoingHit} OutgoingHit */
/** @typedef {import('../../types.js').DamageResult} DamageResult */

// 상태가 지금 받는 행동(§7.1 상태별 허용 표)의 비트.
const LIGHT = 1;
const HEAVY = LIGHT * 2;
const ROLL = HEAVY * 2;
const FLASK = ROLL * 2;
const GUARD = FLASK * 2;
const MOVE = GUARD * 2;
const ALL = LIGHT | HEAVY | ROLL | FLASK | GUARD | MOVE;

const FIRST_LIGHT = 'light1';
const EXECUTE_ID = 'execute';

/** 처형 판정의 셰이프. P2는 execute 타격의 셰이프 검사를 건너뛰지만(자동 명중) 필드는 유효해야 한다. */
const EXECUTE_SHAPE = /** @type {ShapeDef} */ (Object.freeze({ type: 'circle', r: PLAYER.execute.range }));

// ───────────────────────── 작은 도구 ─────────────────────────

/** t가 경계 at에 닿았는가(누적 오차 허용). */
function reached(t, at) {
  return t >= at - EPS;
}

/** 이번 틱에 경계 at을 넘었는가(정확히 한 틱만 참). */
function crossed(t, dt, at) {
  return t >= at - EPS && t - dt < at - EPS;
}

/** 타이머를 줄인다. 다 되면 정확히 0(=== 0 비교가 통한다). */
function tickDown(v, dt) {
  return v - dt > EPS ? v - dt : 0;
}

/** 0..1 진행도. 길이가 0이면 끝난 것으로 본다. */
function frac(elapsed, dur) {
  return dur > 0 ? clamp01(elapsed / dur) : 1;
}

function easeOutQuad(u) {
  return 1 - (1 - u) * (1 - u);
}

/** 벡터 v를 (tx, tz) 쪽으로 최대 maxDelta만큼 옮긴다(제자리 수정). */
function approachVec(v, tx, tz, maxDelta) {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) {
    v.x = tx;
    v.z = tz;
  } else {
    const k = maxDelta / d;
    v.x += dx * k;
    v.z += dz * k;
  }
}

/** @param {GameState} state @param {PlayerState} p @returns {number} 보스 방향(rad). 보스가 없으면 현재 facing */
function angleToBoss(state, p) {
  const b = state.boss;
  if (!b) return p.facing;
  return angleOf(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
}

// ───────────────────────── 상태 전이 ─────────────────────────

/**
 * 후딜을 구르기 · 가드 · 플라스크로 캔슬해 빠져나갈 때, 그 무브가 원래 다음 공격을 허용했을 시각까지를 잠근다.
 * 캔슬은 방어 선택지다 — 가드 캔슬 뒤 곧바로 다시 때려 「강 → 강은 후딜 끝」 · 「연속기 끝은 후딜 끝」을
 * 앞지르는 길을 막는다(NOTES-P1 1번). 후딜을 다 채우고 나가면 0이다.
 * @param {PlayerState} p
 */
function lockAttacksAfterCancel(p) {
  const a = p.attack;
  if (!a || a.phase !== 'recovery') return;
  const mv = getMoveDef(a.weaponId, a.moveId);
  if (!mv) return;
  const rt = p.stateTime - (p.stateDur - mv.recovery);
  const light = mv.comboAt - rt;
  const heavy = (mv.kind === 'heavy' ? mv.recovery : mv.comboAt) - rt;
  p.lightLock = light > EPS ? light : 0;
  p.heavyLock = heavy > EPS ? heavy : 0;
}

/**
 * 상태를 바꾼다. 상태에 딸린 필드(attack · parryT · sprint)와 PLAYER_GUARD · 구르기 직후 창을 한곳에서 맞춘다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {PlayerStateName} name @param {number} dur 무기한이면 0
 */
function setState(ctx, p, name, dur) {
  const prev = p.state;
  const wasGuarding = prev === 'guard' || prev === 'guardHit';
  const nowGuarding = name === 'guard' || name === 'guardHit';
  // 구르기를 스스로 끝냈을 때만 직후 창이 열린다(맞아서 끊긴 구르기에는 없다).
  if ((prev === 'roll' || prev === 'backstep') && name !== 'stagger' && name !== 'knockdown' && name !== 'dead') {
    p.postRollT = p.stats.postRollWindow;
  }
  if (prev === 'attack' && name !== 'attack' && name !== 'execute') lockAttacksAfterCancel(p);
  p.state = name;
  p.stateTime = 0;
  p.stateDur = dur;
  if (name !== 'attack' && name !== 'execute') p.attack = null;
  if (name !== 'guard') p.parryT = 0;
  if (name !== 'move') {
    p.sprinting = false;
    p.sprintTime = 0;
  }
  if (wasGuarding !== nowGuarding) ctx.emit(EV.PLAYER_GUARD, { on: nowGuarding });
}

/** @param {SimCtx} ctx @param {PlayerState} p */
function die(ctx, p) {
  setState(ctx, p, 'dead', 0);
  p.buffer.action = null;
  p.buffer.t = 0;
  p.vel.x = 0;
  p.vel.z = 0;
  p.iframe = false;
  p.guarding = false;
  p.parryActive = false;
  p.canExecute = false;
}

// ───────────────────────── 스태미나 ─────────────────────────

/** @param {SimCtx} ctx @param {PlayerState} p */
function hasStamina(ctx, p) {
  return p.stamina > 0 || ctx.state.debug.noStamina;
}

/**
 * 스태미나를 쓴다(모자라면 0에서 멈춘다). 0을 찍으면 탈진.
 * 이미 탈진한 채로 다시 0을 찍는 것은 새 탈진이 아니다(W3) — 긴 지연도 PLAYER_STAMINA_OUT도 다시 걸지 않는다.
 * 그래야 스태미나가 바닥난 채 연타해도 매 타마다 탈진 연출 · 긴 회복 지연에 묶이지 않는다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {number} amount
 */
function spend(ctx, p, amount) {
  if (ctx.state.debug.noStamina || !(amount > 0)) return;
  const before = p.stamina;
  p.stamina = Math.max(0, before - amount);
  p.staminaDelay = PLAYER.stamina.regenDelay;
  if (p.stamina <= 0 && before > 0 && !p.exhausted) {
    p.exhausted = true;
    p.staminaDelay = PLAYER.stamina.exhaustedDelay;
    ctx.emit(EV.PLAYER_STAMINA_OUT, {});
  }
}

/** @param {PlayerState} p @param {number} dt */
function regenStamina(p, dt) {
  const st = p.state;
  const busy = st === 'attack' || st === 'roll' || st === 'backstep' || p.sprinting;
  if (!busy && p.staminaDelay <= 0 && p.stamina < p.stats.staminaMax) {
    const mul = st === 'guard' || st === 'guardHit' ? PLAYER.stamina.guardRegenMul : 1;
    p.stamina = Math.min(p.stats.staminaMax, p.stamina + p.stats.staminaRegen * mul * dt);
  }
  if (p.exhausted && p.stamina >= PLAYER.stamina.exhaustedUntil) p.exhausted = false;
}

// ───────────────────────── 록온 ─────────────────────────

/** @param {GameState} state @param {PlayerState} p */
function canLockOn(state, p) {
  const b = state.boss;
  if (state.mode !== 'boss' || !b || b.state === 'dead') return false;
  return Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) <= PLAYER.lockOn.maxRange;
}

/** @param {SimCtx} ctx @param {PlayerState} p @param {boolean} on */
function setLockOn(ctx, p, on) {
  if (p.lockOn === on) return;
  p.lockOn = on;
  ctx.emit(EV.LOCKON_CHANGED, { on });
}

/**
 * 록온 토글 + 자동 해제(§7.1). 켤 수 없는 조건에서는 켜지지 않고, 켜져 있었다면 꺼진다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {boolean} pressed
 */
function updateLockOn(ctx, p, pressed) {
  const can = canLockOn(ctx.state, p);
  if (pressed) setLockOn(ctx, p, !p.lockOn && can);
  else if (p.lockOn && !can) setLockOn(ctx, p, false);
}

// ───────────────────────── 선입력 ─────────────────────────

/**
 * 지금의 공격이 구르기 · 플라스크 캔슬을 받기까지 남은 시간(초). 공격 · 넉다운 중이 아니면 0.
 * 예고 · 차지 중에는 끝까지 모았을 때를 기준으로 잡는다 — 일찍 놓으면 그만큼 일찍 나갈 뿐이다(버퍼는 허용되는 첫 틱에 소비된다).
 * (W5 게이트) 넉다운은 「남은 넉다운 + 기상」이다(1.10 + 0.45초 — bufferAttack 0.70초로는 넘어지자마자 누른 구르기가 버려졌다).
 * @param {PlayerState} p
 * @returns {number}
 */
function cancelOpensIn(p) {
  if (p.state === 'knockdown') {
    const wake = p.stateDur - p.stateTime + PLAYER.hurt.getupDur;
    return wake > 0 ? wake : 0;
  }
  const a = p.attack;
  if (p.state !== 'attack' || !a) return 0;
  const mv = getMoveDef(a.weaponId, a.moveId);
  if (!mv) return 0;
  const activeStart = a.phase === 'windup' || a.phase === 'charge'
    ? mv.windup + mv.chargeMax
    : p.stateDur - mv.recovery - mv.active;
  const left = activeStart + mv.active + mv.rollCancelAt - p.stateTime;
  return left > 0 ? left : 0;
}

/**
 * 이번 틱의 에지 입력 하나를 버퍼에 넣는다(우선순위 roll > flask > heavy > light · 새 입력이 덮어쓴다).
 * 빈 플라스크는 저장하지 않고 그 자리에서 'empty'만 알린다 — 뒤늦게 나올 행동이 없기 때문이다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input
 */
function captureEdges(ctx, p, input) {
  /** @type {'light'|'heavy'|'roll'|'flask'|null} */
  let action = null;
  if (input.rollPressed) action = 'roll';
  else if (input.flaskPressed && p.flasks > 0) action = 'flask';
  else if (input.heavyPressed) action = 'heavy';
  else if (input.lightPressed) action = 'light';
  if (input.flaskPressed && !input.rollPressed && p.flasks <= 0) {
    ctx.emit(EV.PLAYER_FLASK, { phase: 'empty', amount: 0, left: 0 });
  }
  if (action === null) return;
  const b = p.buffer;
  b.action = action;
  // 곧 풀리는 잠금 상태(공격 · 구르기 · 경직 · 기상)에서 누른 입력은 그 상태가 풀릴 때까지 살아 있어야 씹히지 않는다.
  b.t = PLAYER.bufferLongStates.includes(p.state) ? PLAYER.bufferAttack : PLAYER.buffer;
  // (W5) 방어 입력(구르기 · 플라스크)은 지금 무브의 캔슬 창이 열릴 때까지(넉다운이면 일어날 때까지) 살아 있어야 한다 —
  // 긴 무브 · 차지에서도. 약 · 강은 그대로 둔다(한참 뒤에 튀어나오는 공격을 만들지 않는다).
  if (action === 'roll' || action === 'flask') {
    const need = cancelOpensIn(p) + PLAYER.bufferCancelSlack;
    if (need > b.t) b.t = need;
  }
  b.dirX = input.moveX;
  b.dirZ = input.moveZ;
}

/** @param {PlayerState} p */
function clearBuffer(p) {
  p.buffer.action = null;
  p.buffer.t = 0;
}

// ───────────────────────── 허용 표 ─────────────────────────

/**
 * 현재 상태 · 시각이 받는 행동의 비트 집합(§7.1 상태별 허용 표). 0이면 「버퍼만」.
 * @param {PlayerState} p
 * @returns {number}
 */
function permits(p) {
  const t = p.stateTime;
  switch (p.state) {
    case 'idle':
    case 'move':
    case 'guard':
      return ALL;
    case 'roll':
      return reached(t, PLAYER.roll.actAt) ? ALL : 0;
    case 'backstep':
      return reached(t, PLAYER.backstep.actAt) ? ALL : 0;
    case 'flask':
      return reached(t, PLAYER.flask.actAt) ? ALL : 0;
    case 'parry':
      return reached(t, PLAYER.parry.actAt) ? LIGHT | HEAVY | ROLL : 0;
    case 'attack': {
      const a = p.attack;
      if (!a || a.phase !== 'recovery') return 0;
      const mv = getMoveDef(a.weaponId, a.moveId);
      if (!mv) return 0;
      const rt = t - (p.stateDur - mv.recovery);   // 후딜 진입 후 경과
      let mask = 0;
      // 강 → 강은 comboAt으로 당겨지지 않는다 — 후딜이 끝나 idle이 된 틱에 나간다.
      if (reached(rt, mv.comboAt)) mask |= mv.kind === 'heavy' ? LIGHT : LIGHT | HEAVY;
      if (reached(rt, mv.rollCancelAt)) mask |= ROLL | FLASK | GUARD;
      return mask;
    }
    default:
      return 0;   // guardHit · guardBreak · stagger · knockdown · getup · execute · dead
  }
}

/**
 * 처형 조건(§7.1): 그로기 보스 · 거리 · 보스 정면각.
 * @param {GameState} state @param {PlayerState} p
 */
function executeReady(state, p) {
  const b = state.boss;
  if (state.mode !== 'boss' || !b || b.state !== 'groggy' || p.hp <= 0) return false;
  const dx = p.pos.x - b.pos.x;
  const dz = p.pos.z - b.pos.z;
  if (Math.hypot(dx, dz) > PLAYER.execute.range + b.radius) return false;
  return Math.abs(angleDiff(b.facing, angleOf(dx, dz))) <= PLAYER.execute.frontHalf;
}

/**
 * 지금의 약공격이 어떤 무브가 되는가. 연속기 끝(next 없음)이면 null — 후딜이 끝나길 기다린다.
 * @param {PlayerState} p
 * @returns {string|null}
 */
function pickLightMove(p) {
  switch (p.state) {
    case 'attack': {
      const a = p.attack;
      const mv = a && getMoveDef(a.weaponId, a.moveId);
      return mv ? mv.next : null;
    }
    case 'roll':
      return 'rollAtk';
    case 'move':
      return p.sprinting && reached(p.sprintTime, PLAYER.dashAttackMinSprint) ? 'dash' : FIRST_LIGHT;
    default:
      return FIRST_LIGHT;
  }
}

/** 약공격 연속기에서 몇 번째 타인가(light1 = 0). 연속기 밖의 무브는 0. */
function comboIndexOf(weaponId, moveId) {
  const weapon = getWeaponDef(weaponId);
  if (!weapon) return 0;
  const moves = weapon.moves;
  let cur = FIRST_LIGHT;
  let i = 0;
  // 반복 상한 = 무브 수 — next가 순환하는 데이터가 들어와도 멈춘다.
  for (const _ in moves) {
    const mv = moves[cur];
    if (!mv) break;
    if (cur === moveId) return i;
    if (!mv.next) break;
    cur = mv.next;
    i += 1;
  }
  return 0;
}

// ───────────────────────── 행동 시작 ─────────────────────────

/**
 * @param {SimCtx} ctx @param {PlayerState} p @param {string} moveId
 * @returns {boolean} 시작했는가
 */
function startAttack(ctx, p, moveId) {
  const weaponId = p.stats.weaponId;
  const mv = getMoveDef(weaponId, moveId) || getMoveDef(weaponId, FIRST_LIGHT);
  if (!mv) return false;
  spend(ctx, p, mv.stamina);
  setState(ctx, p, 'attack', mv.windup + mv.active + mv.recovery);
  const comboIndex = comboIndexOf(weaponId, mv.id);
  p.attack = {
    moveId: mv.id,
    weaponId,
    kind: mv.kind,
    motion: mv.motion,
    comboIndex,
    phase: 'windup',
    phaseT: 0,
    charge: 0,
    hitId: ctx.nextHitId(),
  };
  ctx.emit(EV.PLAYER_ATTACK_START, { moveId: mv.id, kind: mv.kind, motion: mv.motion, weaponId, comboIndex });
  return true;
}

/** @param {SimCtx} ctx @param {PlayerState} p */
function startExecute(ctx, p) {
  const b = ctx.state.boss;
  setState(ctx, p, 'execute', PLAYER.execute.dur);
  p.facing = angleToBoss(ctx.state, p);   // 스냅(prevFacing은 그대로 — 한 틱 보간으로 돈다)
  p.vel.x = 0;
  p.vel.z = 0;
  p.attack = {
    moveId: EXECUTE_ID,
    weaponId: p.stats.weaponId,
    kind: 'execute',
    motion: 'thrust',
    comboIndex: 0,
    phase: 'windup',
    phaseT: 0,
    charge: 0,
    hitId: ctx.nextHitId(),
  };
  ctx.emit(EV.EXECUTE_STARTED, { x: p.pos.x, z: p.pos.z, bossX: b ? b.pos.x : p.pos.x, bossZ: b ? b.pos.z : p.pos.z });
}

/**
 * 구르기 또는 백스텝. 방향: 소비 틱의 이동 의도 → 버퍼에 저장된 방향 → 없으면 백스텝.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input
 * @param {number} bufX 버퍼에 저장돼 있던 방향 @param {number} bufZ
 */
function startRoll(ctx, p, input, bufX, bufZ) {
  const min = PLAYER.move.dirIntentMin;
  let dx = input.moveX;
  let dz = input.moveZ;
  let l = Math.hypot(dx, dz);
  if (!(l > min)) {
    dx = bufX;
    dz = bufZ;
    l = Math.hypot(dx, dz);
  }
  p.vel.x = 0;
  p.vel.z = 0;
  if (l > min) {
    spend(ctx, p, PLAYER.roll.cost);
    setState(ctx, p, 'roll', PLAYER.roll.dur);
    p.rollDir.x = dx / l;
    p.rollDir.z = dz / l;
    // 진입 틱에 구르는 방향으로 스냅한다(록온 중에도) — view는 항상 facing 방향 앞구르기로 그린다.
    p.facing = angleOf(dx, dz);
    ctx.emit(EV.PLAYER_ROLL, { x: p.pos.x, z: p.pos.z, dir: p.facing, backstep: false });
  } else {
    spend(ctx, p, PLAYER.backstep.cost);
    setState(ctx, p, 'backstep', PLAYER.backstep.dur);
    p.rollDir.x = -Math.sin(p.facing);
    p.rollDir.z = -Math.cos(p.facing);
    ctx.emit(EV.PLAYER_ROLL, { x: p.pos.x, z: p.pos.z, dir: wrapAngle(p.facing + Math.PI), backstep: true });
  }
}

/** @param {SimCtx} ctx @param {PlayerState} p */
function startFlask(ctx, p) {
  setState(ctx, p, 'flask', PLAYER.flask.dur);
  ctx.emit(EV.PLAYER_FLASK, { phase: 'start', amount: 0, left: p.flasks });
}

/**
 * guard 상태로 들어간다. 패링 창은 가드 입력의 상승 에지로 장전돼 있을 때만 열린다(홀드만으로는 열리지 않는다).
 * @param {SimCtx} ctx @param {PlayerState} p
 */
function enterGuard(ctx, p) {
  setState(ctx, p, 'guard', 0);
  if (p.parryArmT > 0) {
    p.parryT = p.stats.parryWindow;
    p.parryArmT = 0;
  }
}

// ───────────────────────── 상태 진행 ─────────────────────────

/**
 * @param {SimCtx} ctx @param {PlayerState} p @param {PlayerAttack} a @param {MoveDef} mv
 * @param {number} charge 확정 차지량 0..1
 */
function beginActive(ctx, p, a, mv, charge) {
  a.charge = charge;
  a.phase = 'active';
  a.phaseT = 0;
  p.stateDur = mv.windup + charge * mv.chargeMax + mv.active + mv.recovery;
  ctx.emit(EV.PLAYER_SWING, {
    moveId: mv.id, kind: mv.kind, motion: mv.motion, weaponId: a.weaponId, charge, heavy: mv.heavy, dur: mv.active,
  });
}

/**
 * 공격 구간 전환. 한 틱에 한 구간씩만 넘어간다 — dt가 커도 판정 구간이 최소 한 틱은 선다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input
 */
function advanceAttack(ctx, p, input) {
  const a = p.attack;
  const mv = a ? getMoveDef(a.weaponId, a.moveId) : null;
  if (!a || !mv) {
    setState(ctx, p, 'idle', 0);
    return;
  }
  const t = p.stateTime;
  switch (a.phase) {
    case 'windup':
      if (!reached(t, mv.windup)) {
        a.phaseT = frac(t, mv.windup);
      } else if (mv.chargeMax > 0 && input.heavyHeld) {
        a.phase = 'charge';
        a.phaseT = frac(t - mv.windup, mv.chargeMax);
      } else {
        beginActive(ctx, p, a, mv, 0);
      }
      break;
    case 'charge': {
      const c = frac(t - mv.windup, mv.chargeMax);
      if (c >= 1) {
        ctx.emit(EV.PLAYER_CHARGE_FULL, { x: p.pos.x, z: p.pos.z });
        beginActive(ctx, p, a, mv, 1);
      } else if (!input.heavyHeld) {
        beginActive(ctx, p, a, mv, c);
      } else {
        a.phaseT = c;
        // 차지 중의 stateDur = 지금 놓았을 때의 총 길이(stateTime이 stateDur를 앞지르지 않게).
        p.stateDur = mv.windup + c * mv.chargeMax + mv.active + mv.recovery;
      }
      break;
    }
    case 'active': {
      const end = p.stateDur - mv.recovery;
      if (reached(t, end)) {
        a.phase = 'recovery';
        a.phaseT = frac(t - end, mv.recovery);
      } else {
        a.phaseT = frac(t - (end - mv.active), mv.active);
      }
      break;
    }
    default:
      if (reached(t, p.stateDur)) setState(ctx, p, 'idle', 0);
      else a.phaseT = frac(t - (p.stateDur - mv.recovery), mv.recovery);
  }
}

/** @param {SimCtx} ctx @param {PlayerState} p @param {number} dt */
function advanceExecute(ctx, p, dt) {
  const a = p.attack;
  const ex = PLAYER.execute;
  const t = p.stateTime;
  if (!a) {
    setState(ctx, p, 'idle', 0);
  } else if (crossed(t, dt, ex.hitAt)) {
    // 타격은 정확히 한 틱 — getPlayerHit이 이 틱에만 execute 판정을 내놓는다.
    a.phase = 'active';
    a.phaseT = 0;
    ctx.emit(EV.PLAYER_SWING, {
      moveId: EXECUTE_ID, kind: 'execute', motion: a.motion, weaponId: a.weaponId, charge: 0, heavy: true, dur: DT,
    });
  } else if (reached(t, p.stateDur)) {
    setState(ctx, p, 'idle', 0);
  } else if (!reached(t, ex.hitAt)) {
    a.phase = 'windup';
    a.phaseT = frac(t, ex.hitAt);
  } else {
    a.phase = 'recovery';
    a.phaseT = frac(t - ex.hitAt, ex.dur - ex.hitAt);
  }
}

/**
 * stateTime이 진행된 뒤의 구간 전환 · 시한 상태의 끝. 끝난 상태는 idle로 돌아가 같은 틱에 버퍼를 소비한다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input @param {number} dt
 */
function advanceState(ctx, p, input, dt) {
  const t = p.stateTime;
  switch (p.state) {
    case 'attack':
      advanceAttack(ctx, p, input);
      break;
    case 'execute':
      advanceExecute(ctx, p, dt);
      break;
    case 'flask':
      if (crossed(t, dt, PLAYER.flask.healAt) && p.flasks > 0) {
        const before = p.hp;
        p.hp = Math.min(p.stats.hpMax, before + Math.round(p.stats.flaskHeal));
        p.flasks -= 1;
        ctx.emit(EV.PLAYER_FLASK, { phase: 'heal', amount: p.hp - before, left: p.flasks });
      } else if (reached(t, p.stateDur)) {
        setState(ctx, p, 'idle', 0);
      }
      break;
    case 'guardHit':
      if (reached(t, p.stateDur)) {
        // 홀드를 유지했으면 guard로 — 에지가 없으니 패링 창도 없다.
        if (input.guard && !p.exhausted) enterGuard(ctx, p);
        else setState(ctx, p, 'idle', 0);
      }
      break;
    case 'knockdown':
      if (reached(t, p.stateDur)) setState(ctx, p, 'getup', PLAYER.hurt.getupDur);
      break;
    case 'getup':
      if (reached(t, p.stateDur)) {
        setState(ctx, p, 'idle', 0);
        p.hurtInvuln = PLAYER.hurt.wakeInvuln;   // 오래 남는 장판 위에서 일어나도 한 번은 대응할 수 있게
      }
      break;
    case 'roll':
    case 'backstep':
    case 'guardBreak':
    case 'parry':
    case 'stagger':
      if (reached(t, p.stateDur)) setState(ctx, p, 'idle', 0);
      break;
    default:
      break;   // idle · move · guard는 무기한
  }
}

// ───────────────────────── 행동 접수 ─────────────────────────

/**
 * 버퍼의 행동을 지금 실행할 수 있으면 실행한다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input @param {number} mask permits(p)
 * @returns {boolean} 새 상태를 시작했는가
 */
function consumeBuffer(ctx, p, input, mask) {
  const b = p.buffer;
  switch (b.action) {
    case 'roll': {
      if (!(mask & ROLL) || !hasStamina(ctx, p)) return false;
      const bx = b.dirX;
      const bz = b.dirZ;
      clearBuffer(p);
      startRoll(ctx, p, input, bx, bz);
      return true;
    }
    case 'flask':
      if (!(mask & FLASK)) return false;
      clearBuffer(p);
      if (p.flasks <= 0) {
        ctx.emit(EV.PLAYER_FLASK, { phase: 'empty', amount: 0, left: 0 });
        return false;
      }
      startFlask(ctx, p);
      return true;
    case 'heavy':
      if (!(mask & HEAVY) || !hasStamina(ctx, p)) return false;
      if (p.state !== 'attack' && p.heavyLock > 0) return false;
      if (!startAttack(ctx, p, 'heavy')) return false;
      clearBuffer(p);
      return true;
    case 'light': {
      if (!(mask & LIGHT)) return false;
      if (executeReady(ctx.state, p)) {
        clearBuffer(p);
        startExecute(ctx, p);
        return true;
      }
      if (p.state !== 'attack' && p.lightLock > 0) return false;
      const moveId = pickLightMove(p);
      if (moveId === null || !hasStamina(ctx, p)) return false;
      if (!startAttack(ctx, p, moveId)) return false;
      clearBuffer(p);
      return true;
    }
    default:
      return false;
  }
}

/**
 * 상태가 허용하는 행동을 받는다: 버퍼 소비 → 가드 홀드 → (구르기 · 플라스크의 꼬리에서) 이동으로 캔슬.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input
 */
function dispatch(ctx, p, input) {
  const mask = permits(p);
  if (mask === 0) return;
  if (p.buffer.action !== null && consumeBuffer(ctx, p, input, mask)) return;
  const wantGuard = input.guard && !p.exhausted;
  const st = p.state;
  if (st === 'guard') {
    if (wantGuard) return;
    // (W5) 탭 패링: 패링 창이 열려 있는 동안은 버튼을 떼도 가드를 내리지 않는다(최소 가드 유지 = 남은 창).
    // 짧게 누르고 뗀 클릭(60~120ms)이 창 안의 타격을 패링도 가드도 아닌 전액 피격으로 받던 것을 막는다. 탈진은 그대로 내린다.
    if (p.parryT > 0 && !p.exhausted) return;
    setState(ctx, p, 'idle', 0);
    // 연타 방지(rearm)는 가드가 실제로 내려간 틱부터 센다 — 탭을 연타해도 창이 더 자주 열리지 않는다.
    if (!input.guard) p.parryRearm = PLAYER.guard.rearm;
    return;
  }
  if ((mask & GUARD) && wantGuard) {
    enterGuard(ctx, p);
    return;
  }
  if ((mask & MOVE) && st !== 'idle' && st !== 'move' && Math.hypot(input.moveX, input.moveZ) > EPS) {
    setState(ctx, p, 'idle', 0);   // 이번 틱의 locomote가 move로 올린다
  }
}

// ───────────────────────── 이동 ─────────────────────────

/**
 * 걷기/달리기/가드 걸음/플라스크 걸음. idle ↔ move 전환도 여기서 한다.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input @param {number} dt
 * @param {number} speed 이 상태의 속력(m/s) @param {boolean} freeMove idle · move인가(달리기 · 상태 전환 가능)
 */
function locomote(ctx, p, input, dt, speed, freeMove) {
  const M = PLAYER.move;
  let ix = input.moveX;
  let iz = input.moveZ;
  let il = Math.hypot(ix, iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
    il = 1;
  }
  const moving = il > EPS;

  let sprint = false;
  if (freeMove) {
    const want = moving ? 'move' : 'idle';
    if (p.state !== want) setState(ctx, p, want, 0);
    sprint = input.sprint && il > M.sprintIntentMin && !p.exhausted && hasStamina(ctx, p);
  }
  if (sprint) {
    p.sprintTime += dt;
    spend(ctx, p, PLAYER.stamina.sprintDrain * dt);
  } else {
    p.sprintTime = 0;
  }
  p.sprinting = sprint;

  const v = sprint ? M.sprintSpeed : speed;
  approachVec(p.vel, ix * v, iz * v, (moving ? M.accel : M.decel) * dt);
  const stepLen = Math.hypot(p.vel.x, p.vel.z) * dt;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;

  // 록온이면 보스를 보며 스트레이프(달리기 중에는 이동 방향을 본다).
  if (p.lockOn && !sprint) p.facing = turnToward(p.facing, angleToBoss(ctx.state, p), M.lockTurnRate * dt);
  else if (moving) p.facing = turnToward(p.facing, angleOf(ix, iz), M.turnRate * dt);

  if (moving) {
    p.stepDist += stepLen;
    const stride = sprint ? M.strideSprint : M.strideWalk;
    if (p.stepDist >= stride) {
      p.stepDist -= stride;
      ctx.emit(EV.PLAYER_STEP, { x: p.pos.x, z: p.pos.z, sprint });
    }
  }
}

/**
 * 구르기/백스텝 이동: moveDur 동안 dist를 easeOutQuad로 간다(틱 증분의 합이 정확히 dist).
 * @param {SimCtx} ctx @param {PlayerState} p @param {{moveDur:number, dist:number, actAt:number}} cfg
 * @param {number} dt @param {boolean} turnAfterAct actAt 뒤에 록온 대상 쪽으로 돌아가는가(roll만)
 */
function rollMotion(ctx, p, cfg, dt, turnAfterAct) {
  const t = p.stateTime;
  const u1 = easeOutQuad(frac(t, cfg.moveDur));
  const u0 = easeOutQuad(frac(Math.max(0, t - dt), cfg.moveDur));
  const step = cfg.dist * (u1 - u0);
  p.pos.x += p.rollDir.x * step;
  p.pos.z += p.rollDir.z * step;
  const speed = dt > 0 ? step / dt : 0;
  p.vel.x = p.rollDir.x * speed;
  p.vel.z = p.rollDir.z * speed;
  if (turnAfterAct && p.lockOn && reached(t, cfg.actAt)) {
    p.facing = turnToward(p.facing, angleToBoss(ctx.state, p), PLAYER.move.lockTurnRate * dt);
  }
}

/**
 * 전진(lunge)의 진행 시계: 예고 끝 lead초 전에 출발해 판정 끝에 도착한다. 차지 중에는 멈춰 있다.
 * @param {number} t 공격 시작 후 경과 @param {MoveDef} mv @param {number} lead
 * @param {number} activeStart 판정 시작 시각(아직 모르면 Infinity)
 */
function lungeClock(t, mv, lead, activeStart) {
  const pre = Math.min(t, mv.windup) - (mv.windup - lead);
  const post = t > activeStart ? t - activeStart : 0;
  return frac(pre + post, lead + mv.active);
}

/**
 * 공격 중의 방향과 전진.
 * @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input @param {number} dt
 */
function attackMotion(ctx, p, input, dt) {
  const a = p.attack;
  const mv = a ? getMoveDef(a.weaponId, a.moveId) : null;
  p.vel.x = 0;
  p.vel.z = 0;
  if (!a || !mv) return;
  const M = PLAYER.move;
  const t = p.stateTime;
  const aiming = a.phase === 'windup' || a.phase === 'charge';

  // 조준: 시작 직후 attackSnapDur 동안 빠르게, 그 뒤 예고(차지) 끝까지 천천히. 판정부터는 고정.
  if (aiming) {
    const rate = reached(t, M.attackSnapDur) ? M.attackTurnRate : M.attackSnapTurnRate;
    if (p.lockOn) {
      p.facing = turnToward(p.facing, angleToBoss(ctx.state, p), rate * dt);
    } else if (Math.hypot(input.moveX, input.moveZ) > M.dirIntentMin) {
      p.facing = turnToward(p.facing, angleOf(input.moveX, input.moveZ), rate * dt);
    }
  }

  if (!(mv.lunge > 0)) return;
  const lead = Math.min(PLAYER.attack.lungeLead, mv.windup);
  const activeStart = aiming ? Infinity : p.stateDur - mv.recovery - mv.active;
  let step = mv.lunge * (lungeClock(t, mv, lead, activeStart) - lungeClock(Math.max(0, t - dt), mv, lead, activeStart));
  if (!(step > 0)) return;
  const b = ctx.state.boss;
  if (p.lockOn && b) {
    // 록온 전진은 보스 표면 앞에서 멈춘다(몸통을 밀고 들어가지 않는다).
    const room = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) - b.radius - PLAYER.attack.lockStopGap;
    step = Math.min(step, Math.max(0, room));
  }
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  p.pos.x += fx * step;
  p.pos.z += fz * step;
  const speed = dt > 0 ? step / dt : 0;
  p.vel.x = fx * speed;
  p.vel.z = fz * speed;
}

/** 스스로 움직일 수 없는 상태: 남은 속도를 감속으로 죽인다. */
function brake(p, dt) {
  approachVec(p.vel, 0, 0, PLAYER.move.decel * dt);
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
}

/** 넉백: pos에 더하고 지수 감쇠한다. */
function applyKnock(p, dt) {
  const k = p.knockVel;
  if (k.x === 0 && k.z === 0) return;
  p.pos.x += k.x * dt;
  p.pos.z += k.z * dt;
  k.x = damp(k.x, 0, PLAYER.hurt.knockDecay, dt);
  k.z = damp(k.z, 0, PLAYER.hurt.knockDecay, dt);
  if (Math.hypot(k.x, k.z) < EPS) {
    k.x = 0;
    k.z = 0;
  }
}

/** @param {SimCtx} ctx @param {PlayerState} p @param {InputFrame} input @param {number} dt */
function integrate(ctx, p, input, dt) {
  const M = PLAYER.move;
  switch (p.state) {
    case 'idle':
    case 'move':
      locomote(ctx, p, input, dt, M.walkSpeed, true);
      break;
    case 'guard':
      locomote(ctx, p, input, dt, M.guardSpeed, false);
      break;
    case 'flask':
      locomote(ctx, p, input, dt, M.flaskSpeed, false);
      break;
    case 'roll':
      rollMotion(ctx, p, PLAYER.roll, dt, true);
      break;
    case 'backstep':
      rollMotion(ctx, p, PLAYER.backstep, dt, false);
      break;
    case 'attack':
      attackMotion(ctx, p, input, dt);
      break;
    case 'execute':
      p.vel.x = 0;
      p.vel.z = 0;
      break;
    default:
      brake(p, dt);
  }
  applyKnock(p, dt);
}

// ───────────────────────── 플래그 ─────────────────────────

/** 구르기 무적 창: stateTime ∈ [iStart, iEnd). */
function inRollWindow(t, cfg) {
  return reached(t, cfg.iStart) && !reached(t, cfg.iEnd);
}

/** P2 · ui · 봇이 읽는 플래그를 현재 상태에서 다시 계산한다. */
function refreshFlags(ctx, p) {
  let inv = p.hurtInvuln > 0;
  switch (p.state) {
    case 'roll':
      inv = inv || inRollWindow(p.stateTime, PLAYER.roll);
      break;
    case 'backstep':
      inv = inv || inRollWindow(p.stateTime, PLAYER.backstep);
      break;
    case 'knockdown':
    case 'getup':
    case 'execute':
    case 'parry':
      inv = true;
      break;
    default:
      break;
  }
  p.iframe = inv;
  p.guarding = p.state === 'guard' || p.state === 'guardHit';
  p.parryActive = p.state === 'guard' && p.parryT > 0;
  p.canExecute = (permits(p) & LIGHT) !== 0 && executeReady(ctx.state, p);
}

// ───────────────────────── 공개 API (§6.3) ─────────────────────────

/**
 * 새 플레이어 상태. hp/stamina/flasks는 가득, state 'idle', prevPos = pos.
 * @param {StatBlock} stats
 * @param {{x:number, z:number, facing:number}} spawn
 * @returns {PlayerState}
 */
export function createPlayerState(stats, spawn) {
  return {
    pos: { x: spawn.x, z: spawn.z },
    prevPos: { x: spawn.x, z: spawn.z },
    vel: { x: 0, z: 0 },
    facing: spawn.facing,
    prevFacing: spawn.facing,
    radius: PLAYER.radius,
    hp: stats.hpMax,
    stamina: stats.staminaMax,
    staminaDelay: 0,
    exhausted: false,
    stats,
    state: 'idle',
    stateTime: 0,
    stateDur: 0,
    attack: null,
    iframe: false,
    guarding: false,
    parryActive: false,
    parryT: 0,
    parryArmT: 0,
    parryRearm: 0,
    guardHeldPrev: false,
    canExecute: false,
    lockOn: false,
    sprinting: false,
    sprintTime: 0,
    rollDir: { x: 0, z: 1 },
    flasks: stats.flaskCharges,
    buffer: { action: null, t: 0, dirX: 0, dirZ: 0 },
    hurtInvuln: 0,
    postRollT: 0,
    stepDist: 0,
    knockVel: { x: 0, z: 0 },
    // §3.4에 없는 P1 내부 타이머(초): 후딜 캔슬 뒤 약/강공격이 다시 허용되기까지 남은 시간 — lockAttacksAfterCancel
    lightLock: 0,
    heavyLock: 0,
  };
}

/**
 * 능력치를 갈아 끼운다(마을에서 구매 직후). refill이면 hp · stamina · flasks를 최대로.
 * refill이 아니면 현재 값을 새 상한 안으로만 자른다.
 * @param {PlayerState} player
 * @param {StatBlock} stats
 * @param {boolean} refill
 */
export function applyStatsToPlayer(player, stats, refill) {
  player.stats = stats;
  if (refill) {
    player.hp = stats.hpMax;
    player.stamina = stats.staminaMax;
    player.flasks = stats.flaskCharges;
    player.exhausted = false;
    player.staminaDelay = 0;
  } else {
    player.hp = Math.min(player.hp, stats.hpMax);
    player.stamina = Math.min(player.stamina, stats.staminaMax);
    player.flasks = Math.min(player.flasks, stats.flaskCharges);
  }
}

/**
 * 한 틱 진행. ctx.state.player만 쓴다(읽기는 state 전체). pos를 속도로 적분한다 — 충돌은 P2가 뒤에서 푼다.
 * 매 틱 iframe · guarding · parryActive · canExecute 플래그를 갱신한다. hp <= 0 && state !== 'dead'면 dead로.
 * @param {SimCtx} ctx
 * @param {InputFrame} input
 * @param {number} dt
 */
export function updatePlayer(ctx, input, dt) {
  const p = ctx.state.player;
  if (p.state !== 'dead' && p.hp <= 0) die(ctx, p);
  if (p.state === 'dead') {
    // 죽은 뒤에는 입력 · 버퍼 · 록온을 받지 않는다. 남은 밀림만 흘려보낸다.
    p.stateTime += dt;
    brake(p, dt);
    applyKnock(p, dt);
    p.iframe = false;
    p.guarding = false;
    p.parryActive = false;
    p.canExecute = false;
    return;
  }

  p.buffer.t = tickDown(p.buffer.t, dt);
  if (p.buffer.t === 0) p.buffer.action = null;
  p.staminaDelay = tickDown(p.staminaDelay, dt);
  p.hurtInvuln = tickDown(p.hurtInvuln, dt);
  p.postRollT = tickDown(p.postRollT, dt);
  p.parryT = tickDown(p.parryT, dt);
  p.parryArmT = tickDown(p.parryArmT, dt);
  p.parryRearm = tickDown(p.parryRearm, dt);
  // 내부 타이머는 없을 수도 있다(helpers의 리터럴 상태) — 없으면 0으로 채운다.
  p.lightLock = p.lightLock > 0 ? tickDown(p.lightLock, dt) : 0;
  p.heavyLock = p.heavyLock > 0 ? tickDown(p.heavyLock, dt) : 0;

  updateLockOn(ctx, p, input.lockOnPressed);

  // 패링 창은 가드 입력의 상승 에지로만 장전되고, 뗀 틱부터 rearm 동안은 장전되지 않는다(연타 방지).
  if (input.guard && !p.guardHeldPrev) {
    if (p.parryRearm === 0) p.parryArmT = PLAYER.parry.pressGrace;
  } else if (!input.guard && p.guardHeldPrev) {
    p.parryRearm = PLAYER.guard.rearm;
  }

  captureEdges(ctx, p, input);

  p.stateTime += dt;
  advanceState(ctx, p, input, dt);
  dispatch(ctx, p, input);
  integrate(ctx, p, input, dt);
  regenStamina(p, dt);
  refreshFlags(ctx, p);
  p.guardHeldPrev = input.guard;
}

/**
 * 히트스톱 틱용: 에지 입력(light · heavy · roll · flask)을 버퍼에 넣고, lockOnPressed는 즉시 처리한다
 * (§7.1 록온 토글 규칙 · LOCKON_CHANGED). 그 밖의 타이머 · 상태 · guardHeldPrev는 건드리지 않는다.
 * @param {SimCtx} ctx
 * @param {InputFrame} input
 * @param {number} dt
 */
export function bufferPlayerInput(ctx, input, dt) {
  const p = ctx.state.player;
  if (p.state === 'dead' || p.hp <= 0) return;
  if (input.lockOnPressed) updateLockOn(ctx, p, true);
  captureEdges(ctx, p, input);
}

/**
 * 이번 틱에 살아 있는 플레이어 판정. attack.phase === 'active'인 동안 같은 hitId로 매 틱 반환.
 * 처형은 타격 시각의 한 틱에만 execute:true로 반환. 없으면 null.
 * @param {SimCtx} ctx
 * @returns {OutgoingHit|null}
 */
export function getPlayerHit(ctx) {
  const p = ctx.state.player;
  const a = p.attack;
  if (!a || a.phase !== 'active') return null;
  const s = p.stats;
  // 판정은 attack 필드만 보고 낸다(상태 이름에 기대지 않는다 — 합성 상태에서도 같은 답).
  if (a.kind === 'execute') {
    return {
      source: 'player',
      attackId: EXECUTE_ID,
      hitId: a.hitId,
      shapeDef: EXECUTE_SHAPE,
      x: p.pos.x,
      z: p.pos.z,
      facing: p.facing,
      damage: s.weaponDamage * s.damageMul * PLAYER.execute.dmgMul * s.executeMul,
      posture: 0,
      guardable: false,
      parryable: false,
      knockdown: false,
      heavy: true,
      execute: true,
      hitstop: 0,   // P2가 COMBAT.executeHitstop을 쓴다
    };
  }
  const mv = getMoveDef(a.weaponId, a.moveId);
  if (!mv) return null;
  const postRoll = p.postRollT > 0 ? s.postRollDmgMul : 1;
  const lowHp = p.hp / s.hpMax <= s.lowHpThreshold ? s.lowHpDmgMul : 1;
  return {
    source: 'player',
    attackId: mv.id,
    hitId: a.hitId,
    shapeDef: mv.shape,
    x: p.pos.x,
    z: p.pos.z,
    facing: p.facing,
    damage: s.weaponDamage * mv.dmgMul * lerp(1, mv.chargeDmgMul, a.charge) * s.damageMul * postRoll * lowHp,
    posture: mv.posture * lerp(1, PLAYER.chargePostureMul, a.charge) * s.postureMul,
    guardable: false,
    parryable: false,
    knockdown: false,
    heavy: mv.heavy,
    execute: false,
    hitstop: mv.hitstop,
  };
}

/**
 * 플레이어의 타격이 명중한 뒤 P2가 부른다(흡혈 등). 수치(보스 HP · 체간)는 이미 P2가 적용했다.
 * @param {SimCtx} ctx
 * @param {DamageResult} result
 */
export function onPlayerDealtHit(ctx, result) {
  const p = ctx.state.player;
  const steal = p.stats.lifesteal;
  if (!(steal > 0) || !(result.damage > 0) || p.hp <= 0) return;
  p.hp = Math.min(p.stats.hpMax, p.hp + Math.round(result.damage * steal));
}

/**
 * 플레이어가 맞은 뒤 P2가 부른다. hp · stamina는 이미 깎였다. 여기서 상태 전이만 한다(§7.1 반응 표).
 * outcome hit · parry에서는 그 자리에서 player.iframe = true도 세운다.
 * @param {SimCtx} ctx
 * @param {DamageResult} result
 */
export function onPlayerDamaged(ctx, result) {
  const p = ctx.state.player;
  if (p.state === 'dead') return;
  const H = PLAYER.hurt;
  const dir = Number.isFinite(result.dir) ? result.dir : wrapAngle(p.facing + Math.PI);
  switch (result.outcome) {
    case 'hit':
      if (result.lethal || p.hp <= 0) {
        die(ctx, p);
        return;
      }
      if (result.knockdown) {
        setState(ctx, p, 'knockdown', H.knockdownDur);
        p.knockVel.x = Math.sin(dir) * H.knockdownPush;
        p.knockVel.z = Math.cos(dir) * H.knockdownPush;
      } else {
        setState(ctx, p, 'stagger', H.staggerDur);
        p.knockVel.x = Math.sin(dir) * H.staggerPush;
        p.knockVel.z = Math.cos(dir) * H.staggerPush;
        p.hurtInvuln = H.invuln;
      }
      break;
    case 'guard':
      if (result.guardBreak) {
        setState(ctx, p, 'guardBreak', PLAYER.guard.breakDur);
        p.exhausted = true;
        p.staminaDelay = PLAYER.stamina.exhaustedDelay;
        ctx.emit(EV.PLAYER_STAMINA_OUT, {});
      } else {
        setState(ctx, p, 'guardHit', PLAYER.guard.hitDur);
        p.staminaDelay = PLAYER.stamina.regenDelay;
      }
      p.knockVel.x = Math.sin(dir) * H.guardPush;
      p.knockVel.z = Math.cos(dir) * H.guardPush;
      break;
    case 'parry':
      setState(ctx, p, 'parry', PLAYER.parry.dur);
      break;
    default:
      return;   // dodge · immune은 호출되지 않는다
  }
  // 하던 동작의 속도(전진 · 구르기)를 끊는다 — 밀림은 knockVel만 맡는다.
  p.vel.x = 0;
  p.vel.z = 0;
  // 틱 끝 상태가 일관되게: 같은 틱의 남은 판정과 구독자가 새 상태의 플래그를 본다(다음 틱의 E가 다시 계산한다).
  refreshFlags(ctx, p);
  if (result.outcome !== 'guard') p.iframe = true;
}
