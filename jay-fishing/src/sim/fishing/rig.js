// OWNER: P1 — 계약 §6.5 · §5.2 · §3.4(RigState)
// STUB — W0 스텁(§6.14): createRigState = §3.4 전 필드 · syncRig = §6.5 식(완성) · enterSpot = 자리에 세우고 ready(+ FISHING_ENTER)
//   · updateRig no-op · 명령은 {ok:false, reason:'stub'}. P1 이 채운다.
// rig → fight 단방향(fightImpl 로만 부른다) · rig → world 는 placePlayer 만(§2.2).

import { EV } from '../../core/events.js';
import { clamp } from '../../core/math.js';
import { CAST } from '../../data/bite.js';
import { getSpot } from '../../data/stages/index.js';
import { placePlayer } from '../world.js';
import { createFight, updateFight } from '../fight/fight.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').RigState} RigState */
/** @typedef {import('../../types.js').Profile} Profile */
/** @typedef {import('../../types.js').InputFrame} InputFrame */

const STUB = Object.freeze({ ok: false, reason: 'stub' });

/** rig 는 파이팅을 이 객체로만 부른다 — W1 테스트가 P2 를 기다리지 않고 바꿔 끼운다(P1 rig.test) */
export const fightImpl = { createFight, updateFight };

/**
 * phase 'idle' · set 'float' · 드랙 · 수심 필드는 profile.sets.float 에서.
 * @param {Profile} profile @returns {RigState}
 */
export function createRigState(profile) {
  const f = profile.sets.float;
  const dragNotches = 20;
  return {
    set: 'float',
    phase: 'idle',
    phaseTime: 0,
    origin: { x: 0, z: 0 },
    aimYaw: 0,
    power: 0,
    perfectFrom: 1,
    aimPreview: null,
    bobber: { x: 0, z: 0 },
    prevBobber: { x: 0, z: 0 },
    castT: 0,
    dist: 0,
    bearing: 0,
    waterDepth: 0,
    baitDepth: 0,
    layer: 'surface',
    floatDepth: f.depthM,
    bailOpen: false,
    drifting: false,
    bottomSlip: false,
    dragNotch: clamp(f.dragNotch, 0, dragNotches),
    dragNotches,
    dragKg: 0,
    castBaitId: null,
    pendingSet: null,
    signal: { kind: 'none', t: 0, strength: 0, takeStyle: 'sink', count: 0 },
    hookWindow: { open: false, remaining: 0, total: 0 },
    canCast: false,
    castBlock: null,
    failReason: null,
    lastLoss: null,
    castBuffered: false,
    bite: null,
  };
}

/**
 * rig 파생 필드를 profile · rigStats 에 맞춘다(§6.5). ctx.refresh() 가 끝에서 부른다(§3.8).
 * @param {SimCtx} ctx
 */
export function syncRig(ctx) {
  const r = ctx.state.rig;
  const p = ctx.state.profile;
  r.dragNotches = ctx.rigStats.dragNotches;
  r.dragNotch = clamp(p.sets[r.set].dragNotch, 0, r.dragNotches);
  r.dragKg = r.dragNotch * ctx.rigStats.dragNotchKg;
  r.floatDepth = p.sets.float.depthM;
}

/**
 * STUB(최소) — 걷기 → 낚시: ctx.spot · placePlayer(PLAYER_PLACED{spot}) · ready · FISHING_ENTER.
 * @param {SimCtx} ctx @param {string} spotId @returns {{ok:boolean, reason?:string}}
 */
export function enterSpot(ctx, spotId) {
  const s = ctx.state;
  const spot = getSpot(spotId);
  ctx.spot = spot;
  s.player.mode = 'fish';
  s.player.spotId = spotId;
  s.player.nearby = null;
  placePlayer(ctx, spot.stand, spot.facing, s.player.pitch, 'spot');
  const r = s.rig;
  r.phase = 'ready';
  r.phaseTime = 0;
  r.origin = { x: spot.stand.x, z: spot.stand.z };
  r.bobber = { x: spot.stand.x, z: spot.stand.z };
  r.prevBobber = { x: spot.stand.x, z: spot.stand.z };
  r.aimYaw = spot.facing;
  r.dist = 0;
  const cfg = s.profile.sets[r.set];
  r.canCast = (s.profile.baits[cfg.bait] ?? 0) > 0 && cfg.lineM >= CAST.minLineM;
  r.castBlock = r.canCast ? null : (s.profile.baits[cfg.bait] ?? 0) > 0 ? 'noLine' : 'noBait';
  ctx.emit(EV.FISHING_ENTER, { spotId, set: r.set });
  ctx.refresh();
  return { ok: true };
}

/** STUB → Result(§5.2) @param {SimCtx} ctx */
export function exitSpot(ctx) { void ctx; return { ...STUB }; }

/** STUB — §5.2 채비 단계 기계 @param {SimCtx} ctx @param {InputFrame} input */
export function updateRig(ctx, input) { void ctx; void input; }

/** STUB → Result @param {SimCtx} ctx @param {{swapUid?:number}} [opts] */
export function keepCatch(ctx, opts = {}) { void ctx; void opts; return { ...STUB }; }

/** STUB → Result @param {SimCtx} ctx */
export function releaseCatch(ctx) { void ctx; return { ...STUB }; }

/** STUB → Result(§5.2 의 depthSteps 단계 규칙) @param {SimCtx} ctx @param {number} depthM */
export function setFloatDepth(ctx, depthM) { void ctx; void depthM; return { ...STUB }; }

/** STUB — 디버그: ready 면 즉시 착수 → bite / waiting 이면 바로 bite @param {SimCtx} ctx @param {string} speciesId @param {number} pct */
export function forceBite(ctx, speciesId, pct) { void ctx; void speciesId; void pct; return { ...STUB }; }

/** STUB — 디버그: 입질 · 챔질을 건너뛰고 fighting(§6.3 debugForceFight) @param {SimCtx} ctx @param {string} speciesId @param {number} pct */
export function forceFight(ctx, speciesId, pct) { void ctx; void speciesId; void pct; return { ...STUB }; }

/** STUB — 디버그: result 로(pendingCatch · CATCH_RESULT) @param {SimCtx} ctx @param {string} speciesId @param {number} pct */
export function skipToResult(ctx, speciesId, pct) { void ctx; void speciesId; void pct; return { ...STUB }; }
