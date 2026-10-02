// OWNER: P3 — 계약 §6.5 · §8.9
// 보스 정의 검사. 어휘 목록은 core/constants.js의 CUE_IDS · PROJECTILE_KINDS · HAZARD_KINDS, 하한은 data/bossCommon.js의 BOSS_AI.
// 던지지 않는다 — 어떤 모양의 입력이 와도 오류 문자열 배열을 돌려준다.
import { CUE_IDS, HAZARD_KINDS, PROJECTILE_KINDS } from '../../core/constants.js';
import { BOSS_AI } from '../../data/bossCommon.js';

/** @typedef {import('../../types.js').BossDef} BossDef */

const HEAD_NUMBERS = [
  'hp', 'postureMax', 'postureDecayDelay', 'postureDecayRate', 'radius', 'height', 'moveSpeed', 'turnRate',
  'preferredRange', 'stride', 'introDur', 'parriedDur', 'groggyDur', 'executedDur', 'recoverDur', 'phaseShiftDur', 'reward',
];
const HEAD_STRINGS = ['id', 'rig', 'arenaId', 'style', 'fallbackAttack'];
const PHASE2_NUMBERS = ['hpFrac', 'speedMul', 'dmgMul', 'thinkMul', 'moveSpeedMul'];
const PROJ_NUMBERS = ['speed', 'r', 'life', 'homing', 'homingTime', 'damage', 'y'];
const PROJ_BOOLS = ['guardable', 'parryable', 'knockdown'];
const HAZARD_NUMBERS = ['warn', 'active', 'interval', 'damage'];
const HAZARD_BOOLS = ['guardable', 'knockdown'];
const HIT_BOOLS = ['guardable', 'parryable', 'knockdown', 'telegraph'];
const MOVE_KINDS = ['lunge', 'charge', 'leap', 'hop'];
const EVENT_TYPES = ['projectile', 'hazard', 'teleport', 'cue', 'hook'];
const TELEPORT_TO = ['away', 'behindTarget', 'flank', 'center'];
const PLACE_MODES = ['self', 'target', 'aim', 'scatter', 'ringAround', 'chase'];

/** @param {any} v @returns {boolean} */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {any} v @returns {boolean} */
const obj = (v) => v !== null && typeof v === 'object';

/**
 * 셰이프 필드가 타입에 맞는가(§3.2).
 * @param {any} s
 * @param {string} at
 * @param {string[]} errors
 */
function checkShape(s, at, errors) {
  if (!obj(s)) {
    errors.push(`${at}: 셰이프가 없다`);
    return;
  }
  const opt = (k) => s[k] === undefined || num(s[k]);
  switch (s.type) {
    case 'circle':
      if (!num(s.r) || s.r <= 0) errors.push(`${at}: circle.r > 0`);
      if (!opt('fwd') || !opt('side')) errors.push(`${at}: circle.fwd/side는 수`);
      break;
    case 'arc':
      if (!num(s.r) || s.r <= 0) errors.push(`${at}: arc.r > 0`);
      if (!num(s.halfAngle) || s.halfAngle <= 0) errors.push(`${at}: arc.halfAngle > 0`);
      if (!opt('rInner') || (num(s.rInner) && (s.rInner < 0 || s.rInner >= s.r))) errors.push(`${at}: 0 ≤ arc.rInner < r`);
      if (!opt('dirOffset')) errors.push(`${at}: arc.dirOffset는 수`);
      break;
    case 'ring':
      if (!num(s.rInner) || !num(s.rOuter) || s.rInner < 0 || s.rOuter <= s.rInner) errors.push(`${at}: 0 ≤ ring.rInner < rOuter`);
      break;
    case 'capsule':
      if (!num(s.fwd0) || !num(s.fwd1)) errors.push(`${at}: capsule.fwd0/fwd1은 수`);
      if (!num(s.r) || s.r <= 0) errors.push(`${at}: capsule.r > 0`);
      if (!opt('side')) errors.push(`${at}: capsule.side는 수`);
      break;
    default:
      errors.push(`${at}: 모르는 셰이프 타입 '${s.type}'`);
  }
}

/**
 * 이 공격이 1페이즈에 AI가 고를 수 있는가.
 * @param {any} atk
 * @returns {boolean}
 */
function selectableInP1(atk) {
  return obj(atk) && obj(atk.sel) && (atk.sel.minPhase === undefined || atk.sel.minPhase <= 1);
}

/**
 * 이 공격이 1페이즈에 피해를 주는가(히트 · 투사체 · 장판 중 하나라도).
 * @param {any} atk
 * @returns {boolean}
 */
function damagingInP1(atk) {
  if (Array.isArray(atk.hits) && atk.hits.length > 0) return true;
  if (!Array.isArray(atk.events)) return false;
  return atk.events.some((ev) => obj(ev) && (ev.type === 'projectile' || ev.type === 'hazard')
    && (ev.phase === undefined || ev.phase === 1));
}

/**
 * 정의 검사 — 오류 문자열 배열(빈 배열이면 통과). §8.9의 규칙 1~8.
 * @param {BossDef} def
 * @returns {string[]}
 */
export function validateBossDef(def) {
  /** @type {string[]} */
  const errors = [];
  /** @type {any} */
  const d = def;
  const V = BOSS_AI.validate;
  if (!obj(d)) return ['정의가 객체가 아니다'];

  // ── 규칙 1: 머리 필드
  for (const k of HEAD_NUMBERS) if (!num(d[k])) errors.push(`${k}: 유한한 수가 아니다`);
  for (const k of HEAD_STRINGS) if (typeof d[k] !== 'string' || d[k] === '') errors.push(`${k}: 문자열이 아니다`);
  if (typeof d.kite !== 'boolean') errors.push('kite: boolean이 아니다');
  if (num(d.hp) && d.hp <= 0) errors.push('hp > 0');
  if (num(d.radius) && d.radius <= 0) errors.push('radius > 0');
  if (num(d.postureMax) && d.postureMax <= 0) errors.push('postureMax > 0');
  if (!Array.isArray(d.think) || !num(d.think[0]) || !num(d.think[1])) errors.push('think: [min, max] 수 두 개');
  else if (d.think[0] > d.think[1]) errors.push('think[0] ≤ think[1]');
  if (!obj(d.phase2)) errors.push('phase2가 없다');
  else for (const k of PHASE2_NUMBERS) if (!num(d.phase2[k])) errors.push(`phase2.${k}: 유한한 수가 아니다`);
  if (!obj(d.attacks) || Object.keys(d.attacks).length === 0) {
    errors.push('attacks가 비어 있다');
    return errors;
  }
  const attacks = d.attacks;

  // ── 규칙 2~4 · 5 · 7: 공격마다
  for (const key of Object.keys(attacks)) {
    const a = attacks[key];
    const at = `attacks.${key}`;
    if (!obj(a)) {
      errors.push(`${at}: 객체가 아니다`);
      continue;
    }
    if (a.id !== key) errors.push(`${at}: id('${a.id}')가 키와 다르다`);
    if (typeof a.pose !== 'string' || a.pose === '') errors.push(`${at}: pose가 문자열이 아니다`);
    if (typeof a.glow !== 'string') errors.push(`${at}: glow가 문자열이 아니다`);
    const windupOk = num(a.windup);
    if (!windupOk || a.windup < V.windupMin) errors.push(`${at}: windup ≥ ${V.windupMin}`);
    if (!num(a.active) || a.active < 0) errors.push(`${at}: active ≥ 0`);
    if (!num(a.recovery) || a.recovery < V.recoveryMin) errors.push(`${at}: recovery ≥ ${V.recoveryMin}`);
    const negMax = windupOk ? a.windup * BOSS_AI.negOffsetMax : 0;
    /** 규칙 4 @param {number} v @param {string} what */
    const checkNeg = (v, what) => {
      if (num(v) && v < 0 && -v > negMax + V.hitEndEps) errors.push(`${at}: ${what}(${v})의 절댓값 ≤ windup × ${BOSS_AI.negOffsetMax}`);
    };

    // sel
    if (a.sel !== null) {
      const s = a.sel;
      if (!obj(s)) errors.push(`${at}: sel은 객체 또는 null`);
      else {
        if (!num(s.minRange) || !num(s.maxRange) || s.minRange < 0 || s.minRange > s.maxRange) errors.push(`${at}: 0 ≤ sel.minRange ≤ maxRange`);
        if (!num(s.weight) || s.weight <= 0) errors.push(`${at}: sel.weight > 0`);
        if (!num(s.cooldown) || s.cooldown < 0) errors.push(`${at}: sel.cooldown ≥ 0`);
        for (const k of ['minAngle', 'maxAngle', 'minPhase', 'maxPhase']) {
          if (s[k] !== undefined && !num(s[k])) errors.push(`${at}: sel.${k}는 수`);
        }
      }
    }

    // track
    if (!obj(a.track) || !num(a.track.turnRate) || !num(a.track.lockLead) || a.track.turnRate < 0 || a.track.lockLead < 0) {
      errors.push(`${at}: track {turnRate ≥ 0, lockLead ≥ 0}`);
    } else {
      checkNeg(-a.track.lockLead, '−lockLead');
      if (a.track.activeTurnRate !== undefined && !num(a.track.activeTurnRate)) errors.push(`${at}: track.activeTurnRate는 수`);
      if (a.track.sweep !== undefined && (!obj(a.track.sweep) || !num(a.track.sweep.from) || !num(a.track.sweep.to))) {
        errors.push(`${at}: track.sweep {from, to}`);
      }
    }

    // 규칙 3: hits
    if (!Array.isArray(a.hits)) errors.push(`${at}: hits가 배열이 아니다`);
    else {
      a.hits.forEach((h, i) => {
        const hat = `${at}.hits[${i}]`;
        if (!obj(h)) {
          errors.push(`${hat}: 객체가 아니다`);
          return;
        }
        if (!num(h.t0) || !num(h.t1) || h.t0 < 0 || h.t0 >= h.t1 || (num(a.active) && h.t1 > a.active + V.hitEndEps)) {
          errors.push(`${hat}: 0 ≤ t0 < t1 ≤ active`);
        }
        if (!num(h.interval) || h.interval < 0) errors.push(`${hat}: interval ≥ 0`);
        if (!num(h.damage) || h.damage <= 0) errors.push(`${hat}: damage > 0`);
        for (const k of HIT_BOOLS) if (typeof h[k] !== 'boolean') errors.push(`${hat}: ${k}가 boolean이 아니다`);
        checkShape(h.shape, `${hat}.shape`, errors);
        if (h.telegraphShape !== undefined) checkShape(h.telegraphShape, `${hat}.telegraphShape`, errors);
        if (h.telegraphAt !== undefined && h.telegraphAt !== 'self' && h.telegraphAt !== 'aim') errors.push(`${hat}: telegraphAt은 'self' | 'aim'`);
      });
    }

    // move
    if (a.move !== null) {
      const m = a.move;
      if (!obj(m) || !MOVE_KINDS.includes(m.kind)) errors.push(`${at}: move.kind는 ${MOVE_KINDS.join(' | ')} (또는 move: null)`);
      else {
        if (!num(m.t0) || !num(m.t1) || m.t0 >= m.t1) errors.push(`${at}: move.t0 < t1`);
        if (!num(m.dist) || m.dist < 0) errors.push(`${at}: move.dist ≥ 0`);
        for (const k of ['stopShort', 'height', 'aimLock']) {
          if (m[k] !== undefined && !num(m[k])) errors.push(`${at}: move.${k}는 수`);
        }
        checkNeg(m.t0, 'move.t0');
        checkNeg(m.aimLock, 'move.aimLock');
      }
    }

    // events (규칙 3 · 4 · 7)
    if (!Array.isArray(a.events)) errors.push(`${at}: events가 배열이 아니다`);
    else {
      a.events.forEach((ev, i) => {
        const eat = `${at}.events[${i}]`;
        if (!obj(ev) || !EVENT_TYPES.includes(ev.type)) {
          errors.push(`${eat}: type은 ${EVENT_TYPES.join(' | ')}`);
          return;
        }
        if (!num(ev.t)) errors.push(`${eat}: t는 수`);
        checkNeg(ev.t, `events[${i}].t`);
        if (ev.phase !== undefined && ev.phase !== 1 && ev.phase !== 2) errors.push(`${eat}: phase는 1 | 2`);
        if (ev.count !== undefined && (!Number.isInteger(ev.count) || ev.count < 1)) errors.push(`${eat}: count는 1 이상 정수`);
        if (ev.interval !== undefined && (!num(ev.interval) || ev.interval < 0)) errors.push(`${eat}: interval ≥ 0`);
        switch (ev.type) {
          case 'projectile': {
            const p = ev.proj;
            if (!obj(p)) {
              errors.push(`${eat}: proj가 없다`);
              break;
            }
            if (!PROJECTILE_KINDS.includes(p.kind)) errors.push(`${eat}: proj.kind '${p.kind}'가 부록 A에 없다`);
            if (typeof p.style !== 'string') errors.push(`${eat}: proj.style이 없다`);
            for (const k of PROJ_NUMBERS) if (!num(p[k])) errors.push(`${eat}: proj.${k}가 없다`);
            for (const k of PROJ_BOOLS) if (typeof p[k] !== 'boolean') errors.push(`${eat}: proj.${k}가 없다`);
            if (ev.spread !== undefined && !num(ev.spread)) errors.push(`${eat}: spread는 수`);
            if (ev.origin !== undefined && (!obj(ev.origin) || !num(ev.origin.fwd) || !num(ev.origin.side))) errors.push(`${eat}: origin {fwd, side}`);
            break;
          }
          case 'hazard': {
            const h = ev.hazard;
            if (!obj(h)) {
              errors.push(`${eat}: hazard가 없다`);
              break;
            }
            if (!HAZARD_KINDS.includes(h.kind)) errors.push(`${eat}: hazard.kind '${h.kind}'가 부록 A에 없다`);
            if (typeof h.style !== 'string') errors.push(`${eat}: hazard.style이 없다`);
            for (const k of HAZARD_NUMBERS) if (!num(h[k])) errors.push(`${eat}: hazard.${k}가 없다`);
            for (const k of HAZARD_BOOLS) if (typeof h[k] !== 'boolean') errors.push(`${eat}: hazard.${k}가 없다`);
            const hasShape = h.shape !== undefined && h.shape !== null;
            const hasGrow = h.grow !== undefined && h.grow !== null;
            if (hasShape === hasGrow) errors.push(`${eat}: hazard는 shape와 grow 중 정확히 하나`);
            if (hasShape) checkShape(h.shape, `${eat}.hazard.shape`, errors);
            if (hasGrow && (!obj(h.grow) || !num(h.grow.r0) || !num(h.grow.r1) || !num(h.grow.width) || h.grow.width <= 0)) {
              errors.push(`${eat}: hazard.grow {r0, r1, width > 0}`);
            }
            if (ev.place !== undefined && (!obj(ev.place) || !PLACE_MODES.includes(ev.place.mode))) {
              errors.push(`${eat}: place.mode는 ${PLACE_MODES.join(' | ')}`);
            }
            break;
          }
          case 'teleport':
            if (!TELEPORT_TO.includes(ev.to)) errors.push(`${eat}: to는 ${TELEPORT_TO.join(' | ')}`);
            if (ev.to !== 'center' && !num(ev.dist)) errors.push(`${eat}: dist는 수`);
            break;
          case 'cue':
            if (!CUE_IDS.includes(ev.cue)) errors.push(`${eat}: cue '${ev.cue}'가 큐 어휘에 없다`);
            if (ev.shake !== undefined && (!Array.isArray(ev.shake) || !num(ev.shake[0]) || !num(ev.shake[1]))) {
              errors.push(`${eat}: shake는 [진폭, 길이]`);
            }
            break;
          default: // 'hook'
            if (typeof ev.name !== 'string' || ev.name === '') errors.push(`${eat}: hook은 name이 있어야 한다`);
        }
      });
    }

    // 규칙 5: chain
    if (!Array.isArray(a.chain)) errors.push(`${at}: chain이 배열이 아니다`);
    else {
      a.chain.forEach((c, i) => {
        const cat = `${at}.chain[${i}]`;
        if (!obj(c) || !obj(attacks[c.next])) {
          errors.push(`${cat}: next '${obj(c) ? c.next : c}'가 없는 공격이다`);
          return;
        }
        if (!num(c.chance) || !num(c.chanceP2)) errors.push(`${cat}: chance · chanceP2는 수`);
        if (!num(c.at) || c.at < 0) errors.push(`${cat}: at ≥ 0`);
        if (c.maxRange !== undefined && !num(c.maxRange)) errors.push(`${cat}: maxRange는 수`);
      });
    }
  }

  // ── 규칙 5: fallbackAttack
  if (typeof d.fallbackAttack === 'string' && !obj(attacks[d.fallbackAttack])) {
    errors.push(`fallbackAttack '${d.fallbackAttack}'가 없는 공격이다`);
  }

  // ── 규칙 6: 1페이즈 선택 가능 공격
  const p1 = Object.keys(attacks).map((k) => attacks[k]).filter(selectableInP1);
  const damaging = p1.filter(damagingInP1).length;
  if (damaging < V.minDamagingP1) errors.push(`1페이즈에 고를 수 있는 피해 공격이 ${damaging}개다(${V.minDamagingP1}개 이상)`);
  if (num(d.preferredRange)) {
    // 거리 [0, rangeMax]에서 어떤 공격도 고를 수 없는 구간을 찾아, preferredRange ± band에 걸치는지 본다
    const spans = p1
      .filter((a) => num(a.sel.minRange) && num(a.sel.maxRange))
      .map((a) => [a.sel.minRange, a.sel.maxRange])
      .sort((x, y) => x[0] - y[0]);
    const lo = d.preferredRange - V.preferredBand;
    const hi = d.preferredRange + V.preferredBand;
    /** @param {number} g0 @param {number} g1 */
    const checkGap = (g0, g1) => {
      if (g1 > g0 && g0 < hi && g1 > lo) {
        errors.push(`거리 ${g0}~${g1}m에서 1페이즈에 고를 공격이 없다(preferredRange ${d.preferredRange} ± ${V.preferredBand} 안)`);
      }
    };
    let covered = 0;
    for (const [s0, s1] of spans) {
      if (s0 > covered) checkGap(covered, Math.min(s0, V.rangeMax));
      if (s1 > covered) covered = s1;
      if (covered >= V.rangeMax) break;
    }
    if (covered < V.rangeMax) checkGap(covered, V.rangeMax);
  }

  // ── 규칙 8: bodyParts
  if (d.bodyParts !== undefined) {
    if (!Array.isArray(d.bodyParts) || d.bodyParts.length === 0) errors.push('bodyParts는 비어 있지 않은 배열');
    else {
      d.bodyParts.forEach((p, i) => {
        if (!obj(p) || !num(p.fwd) || !num(p.r) || p.r <= 0) errors.push(`bodyParts[${i}]: {fwd, r > 0}`);
      });
      if (!d.bodyParts.some((p) => obj(p) && p.fwd === 0)) errors.push('bodyParts에 fwd === 0인 중심 원이 없다');
    }
  }

  return errors;
}
