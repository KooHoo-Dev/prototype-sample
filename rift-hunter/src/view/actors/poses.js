// OWNER: P8 — 계약 §9.5 · §9.1 (내부 — 포즈 순수 함수)
// 포즈 = 리그의 포즈 배열(rig.js 의 BP · QP · OP · NP 색인). 시각 진행은 틱으로 정한다(§9.1 — now = state.tick + alpha).
// 걷기 주기 = 이동한 거리 / 보폭(보폭은 속도에 비례): 한 주기(두 걸음)에 몸이 2 × step 만큼 간다 · 디딘 발은 루트 좌표에서
//   진행 방향 반대로 정확히 몸이 간 만큼 물러난다 → 월드에서 발이 멈춰 있다(미끄러짐 없음 — view.actors.test 가 FK 로 잰다).
// 공격 = [actStart, actHit − HOLD) 예비(앞 SWING_AT 은 「뒤로 빼기」 · 나머지는 휘두름) → [actHit − HOLD, actHit + HOLD] 판정 자세 고정 → 후딜에서 돌아옴.
//   판정 틱(actHit)에 무기 · 팔 · 머리는 늘 공격 끝 자세다(QUALITY §4 — 예고 자세인 채 피해가 들어가지 않는다).

import { BP, OP, QP } from './rig.js';

const PI = Math.PI;
/** 판정 자세를 actHit 앞뒤로 붙잡는 틱 수 */
export const HOLD = 1;
/** 예비 구간에서 「뒤로 빼기」가 차지하는 비율 — 나머지가 휘두름 */
export const SWING_AT = 0.72;

// ───────────────────────── 기초 ─────────────────────────

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
export function easeIn(t) { t = clamp01(t); return t * t; }
export function easeOut(t) { t = clamp01(t); return 1 - (1 - t) * (1 - t); }
/** 0..1 소수부 */
export function frac(v) { return v - Math.floor(v); }

/** out = a + (b − a)·t (전 성분) */
export function mixArr(out, a, b, t) {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
export function copyArr(out, a) { out.set(a); return out; }
/** out = out + (b − out)·t */
export function towardArr(out, b, t) {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] += (b[i] - out[i]) * t;
  return out;
}

// ───────────────────────── 방향(facing) 보간 ─────────────────────────
// sim 은 facing 의 직전 틱 값을 주지 않는다(prevPos 만 — §5.12). 위치는 lerp(prevPos, pos, alpha)로 화면 주사율에 맞춰 움직이는데
// 방향을 틱 값 그대로 그리면 돌아서는 동안 30Hz 로 최대 turnRate × DT(플레이어 0.6 rad ≈ 34°)씩 끊겨 돈다 —
// view 가 엔티티마다 마지막 두 틱의 facing 을 기억해 위치와 같은 alpha 로 최단 호 보간한다(sim 계약은 그대로).

/** 이만큼 넘게 틱이 비면(컬링 · 장면 전환 뒤 다시 보임) 보간하지 않고 지금 값으로 — 루프의 한 프레임 최대 step(5)보다 크게 */
export const FACING_GAP_MAX = 6;

/** 각도를 [−π, π) 로 @param {number} a */
export function wrapAngle(a) { return a - 2 * PI * Math.floor((a + PI) / (2 * PI)); }

/** 방향 보간 기록 — 필드는 엔티티 기록(rec · PlayerPoser)에 섞어 둔다 @returns {{fPrev:number, fCur:number, fTick:number}} */
export function newFacingTrack() { return { fPrev: 0, fCur: 0, fTick: -1 }; }

/**
 * 이번 프레임의 sim facing 을 받아 기록을 넘기고 그릴 방향을 낸다(할당 없음).
 * 틱이 바뀌면 fPrev ← fCur · fCur ← facing. 보간을 끊는 경우(snap — 위치 순간이동 · PLAYER_SPAWNED · 새 기록)와
 * 틱이 FACING_GAP_MAX 넘게 비었거나 거꾸로 갔을 때 · 같은 틱인데 값이 바뀌었을 때(틱 밖의 명령 — 디버그 · 고정 상태)는 지금 값으로 끊는다.
 * 그린 각도 = fPrev + wrap(fCur − fPrev) × alpha — alpha ≈ 1(디버그 step 뒤)이면 sim 값 그대로라 정지 화면은 같은 틱이면 같은 그림이다.
 * @param {{fPrev:number, fCur:number, fTick:number}} rec @param {number} facing sim 값 @param {number} tick state.tick @param {number} alpha 0..1 @param {boolean} snap
 * @returns {number}
 */
export function trackFacing(rec, facing, tick, alpha, snap) {
  if (!Number.isFinite(facing)) return facing;
  const gap = tick - rec.fTick;
  if (snap || rec.fTick < 0 || gap < 0 || gap > FACING_GAP_MAX || (gap === 0 && facing !== rec.fCur)) {
    rec.fPrev = facing; rec.fCur = facing; rec.fTick = tick;
    return facing;
  }
  if (gap > 0) { rec.fPrev = rec.fCur; rec.fCur = facing; rec.fTick = tick; }
  const d = wrapAngle(rec.fCur - rec.fPrev);
  return d === 0 ? rec.fCur : rec.fPrev + d * alpha;
}

/**
 * 부분 포즈 → 완전한 배열. partial = {이름: 값(절대)} · {'+이름': 값(base 에 더함)}
 * @param {Float32Array} base @param {Record<string, number>} partial @param {Record<string, number>} index
 */
export function compileKey(base, partial, index) {
  const out = new Float32Array(base);
  for (const k of Object.keys(partial ?? {})) {
    const add = k[0] === '+';
    const name = add ? k.slice(1) : k;
    const i = index[name];
    if (typeof i !== 'number') throw new Error(`pose: unknown param '${name}'`);
    out[i] = add ? base[i] + partial[k] : partial[k];
  }
  return out;
}

/**
 * 공격 단계 — stage 0 예비(u 0..1) · 1 판정 자세 · 2 후딜(r 0..1)
 * @param {number} now state.tick + alpha @param {{stage:number,u:number,r:number}} out
 */
export function attackPhase(now, actStart, actHit, actEnd, out) {
  const h0 = actHit - HOLD, h1 = actHit + HOLD;
  if (now < h0 && h0 > actStart) {
    out.stage = 0;
    out.u = clamp01((now - actStart) / (h0 - actStart));
    out.r = 0;
  } else if (now <= h1 || actEnd <= h1) {
    out.stage = now < h0 ? 0 : 1;
    out.u = 1;
    out.r = 0;
    if (now > h1) { out.stage = 2; out.r = 1; }
  } else {
    out.stage = 2;
    out.u = 1;
    out.r = clamp01((now - h1) / (actEnd - h1));
  }
  return out;
}

/**
 * 예비 → 판정 → 후딜 포즈(완전한 배열 셋을 섞는다)
 * @param {Float32Array} out @param {Float32Array} rest @param {Float32Array} wind @param {Float32Array} hit @param {{stage:number,u:number,r:number}} ph
 */
export function actionPose(out, rest, wind, hit, ph) {
  if (ph.stage === 0) {
    if (ph.u < SWING_AT) return mixArr(out, rest, wind, ease(ph.u / SWING_AT));
    return mixArr(out, wind, hit, easeIn((ph.u - SWING_AT) / (1 - SWING_AT)));
  }
  if (ph.stage === 1) return copyArr(out, hit);
  return mixArr(out, hit, rest, ease(ph.r));
}

// ───────────────────────── 두 발 — 기본 · 걷기 ─────────────────────────

/**
 * @typedef {Object} Gait
 * @property {number} step 보폭(m · refSpeed 에서) @property {number} refSpeed m/s @property {number} stance 한 발이 땅에 있는 주기 비율
 * @property {number} lift 발 드는 높이(m) @property {number} armSwing rad @property {number} lean 앞 숙임(rad · 최고 속도) @property {number} crouch 달릴 때 낮추는 골반(m)
 * @property {number} bob 골반 위아래(m)
 */

/** 두 발 기본(서 있기) 배열 — 발 목표 · 골반 높이 · 팔 내림 + 변형 partial @param {import('./rig.js').BipedDims & {hipY:number, footW:number}} d */
export function bipedBase(d, partial = null) {
  const P = new Float32Array(BP.N);
  P[BP.HIPY] = d.hipY;
  P[BP.LFX] = d.footW; P[BP.LFY] = d.ankleY; P[BP.LFZ] = 0.02;
  P[BP.RFX] = -d.footW; P[BP.RFY] = d.ankleY; P[BP.RFZ] = -0.02;
  P[BP.LSHA] = 0.08; P[BP.RSHA] = 0.08;
  P[BP.LELB] = 0.15; P[BP.RELB] = 0.15;
  P[BP.LWRI] = PI / 2; P[BP.RWRI] = PI / 2;
  P[BP.FADE] = 1; P[BP.SWELL] = 1;
  return partial ? compileKey(P, partial, BP) : P;
}

/** 보폭(m) — 속도에 비례(§9.5) · 너무 작아지지 않게 @param {Gait} g @param {number} speed m/s */
export function stepLenOf(g, speed) {
  const k = g.refSpeed > 0 ? speed / g.refSpeed : 1;
  return g.step * Math.max(0.3, Math.min(1.35, k));
}
/** 한 프레임 이동 거리 → 걷기 위상 증가(한 주기 = 두 걸음) */
export function phaseStep(dist, stepLen) { return stepLen > 1e-6 ? dist / (2 * stepLen) : 0; }

/**
 * 발 하나의 루트 좌표 진행 방향 오프셋 · 들림 — q = 그 발의 위상(0..1) · A = 진폭(= stance × step)
 * 디딤(q < stance): +A → −A 선형(몸이 간 만큼) · 들기: −A → +A(부드럽게) + 들림
 * @returns {number} 디딤이면 1
 */
export function footCycle(q, stance, A, lift, out) {
  if (q < stance) {
    out.f = A - (q / stance) * 2 * A;
    out.h = 0;
    return 1;
  }
  const s = (q - stance) / (1 - stance);
  out.f = -A + 2 * A * ease(s);
  out.h = lift * Math.sin(PI * s);
  return 0;
}
const _fc = { f: 0, h: 0 };

/**
 * 두 발 걷기 — out(기본 포즈가 든 배열)에 amt(0..1)만큼 걷기를 섞는다. (mdx, mdz) = 루트 좌표의 이동 방향(단위).
 * @returns {number} 디딘 발 비트(1 = 왼발 · 2 = 오른발)
 */
export function bipedWalk(out, d, g, phase, stepLen, mdx, mdz, amt, armL = 1, armR = 1) {
  if (amt <= 0) return 3;
  const A = g.stance * stepLen;
  const sf = clamp01(stepLen / g.step);
  const liftH = g.lift * (0.4 + 0.6 * sf);
  const L = (d.thigh + d.shin) * 0.995;
  let planted = 0;
  let hipMax = d.hipY;
  const hipZ = out[BP.HIPZ];
  // 왼발 위상 0 · 오른발 0.5
  for (let side = 0; side < 2; side++) {
    const q = frac(phase + side * 0.5);
    const on = footCycle(q, g.stance, A, liftH, _fc);
    const bx = side === 0 ? d.footW : -d.footW;
    const fx = bx + mdx * _fc.f, fz = mdz * _fc.f, fy = d.ankleY + _fc.h;
    const ix = side === 0 ? BP.LFX : BP.RFX;
    out[ix] += (fx - out[ix]) * amt;
    out[ix + 1] += (fy - out[ix + 1]) * amt;
    out[ix + 2] += (fz - out[ix + 2]) * amt;
    if (on) {
      planted |= side === 0 ? 1 : 2;
      const lx = Math.abs(out[ix]) - d.hipX, lz = out[ix + 2] - hipZ;
      const v = L * L - lx * lx - lz * lz;
      const reach = out[ix + 1] + (v > 0 ? Math.sqrt(v) : 0);
      if (reach < hipMax) hipMax = reach;
    }
    // 팔은 반대쪽 다리와 같이(왼다리 앞 → 오른팔 앞)
    const sw = g.armSwing * (_fc.f / (A > 1e-6 ? A : 1)) * amt * sf;
    if (side === 0) out[BP.RSHP] += sw * armR;
    else out[BP.LSHP] += sw * armL;
  }
  const bob = g.bob * sf * (0.5 - 0.5 * Math.cos(4 * PI * phase));
  const want = d.hipY - g.crouch * sf + bob;
  const cur = out[BP.HIPY];
  const target = Math.min(want, hipMax);
  out[BP.HIPY] = cur + (target - cur) * amt;
  if (out[BP.HIPY] > hipMax) out[BP.HIPY] = hipMax;
  out[BP.SPITCH] += g.lean * sf * amt * mdz;
  out[BP.PYAW] += 0.12 * Math.sin(2 * PI * phase) * sf * amt * mdz;
  out[BP.SYAW] -= 0.08 * Math.sin(2 * PI * phase) * sf * amt * mdz;
  return planted;
}

/** 숨쉬기(실제 시간 — §9.5 idle) */
export function bipedBreathe(out, t, k = 1) {
  out[BP.SPITCH] += 0.025 * k * Math.sin(t * 1.9);
  out[BP.LSHA] += 0.02 * k * Math.sin(t * 1.9 + 0.6);
  out[BP.RSHA] += 0.02 * k * Math.sin(t * 1.9 + 0.6);
  out[BP.HPITCH] += 0.02 * k * Math.sin(t * 0.9 + 1.3);
}

/**
 * 쓰러짐 — 발목을 축으로 뒤로(dur 초) · 팔다리 늘어짐. t = 사망 뒤 초
 * @param {number} lie 누운 몸 두께 절반(땅 위로 올림)
 */
export function bipedFall(out, t, dur, lie) {
  const k = ease(t / dur);
  out[BP.RPITCH] = -1.5 * k;
  out[BP.RY] = lie * k;
  out[BP.SPITCH] = out[BP.SPITCH] * (1 - k) - 0.05 * k;
  out[BP.HPITCH] = out[BP.HPITCH] * (1 - k) - 0.2 * k;
  // 팔은 옆으로 벌려 바닥에(누운 몸의 평면 — 하늘로 들리지 않는다)
  out[BP.LSHP] += (0.04 - out[BP.LSHP]) * k;
  out[BP.RSHP] += (0.08 - out[BP.RSHP]) * k;
  out[BP.LSHA] += (1.25 - out[BP.LSHA]) * k;
  out[BP.RSHA] += (1.05 - out[BP.RSHA]) * k;
  out[BP.LSHT] += (1.57 - out[BP.LSHT]) * k;
  out[BP.RSHT] += (0 - out[BP.RSHT]) * k;
  out[BP.LELB] += (0.25 - out[BP.LELB]) * k;
  out[BP.RELB] += (0.35 - out[BP.RELB]) * k;
  // 손의 무기 · 소품은 팔을 잇는 방향(바닥에 눕는다)
  out[BP.LWRI] += (PI - out[BP.LWRI]) * k;
  out[BP.RWRI] += (PI - out[BP.RWRI]) * k;
  out[BP.LFZ] += (0.12 - out[BP.LFZ]) * k;
  out[BP.RFZ] += (-0.05 - out[BP.RFZ]) * k;
}

/**
 * 날아가는 시체(§9.5) — 수평 launch 속도 + 위 4m/s · 중력 15 · 몸 가운데를 축으로 구른다 → 착지 뒤 누움.
 * 루트 오프셋(RX · RZ · RY)과 RPITCH 를 쓴다. facing 은 루트가 쓰는 yaw. hc = 몸 가운데 높이(배율 전 · s 를 곱해서 넘긴다)
 */
export function launchArc(out, t, lx, lz, facing, hc, lie, idxs) {
  const T = LAUNCH.up * 2 / LAUNCH.g;
  const tt = t < T ? t : T;
  const f = tt / T;
  const cx = lx * tt, cz = lz * tt;
  const cy = hc + (lie - hc) * f + LAUNCH.up * tt - 0.5 * LAUNCH.g * tt * tt;
  const pitch = -(PI / 2 + 2 * PI) * ease(f);
  // 루트 = C − Ry(facing) · Rx(pitch) · (0, hc, 0)
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const vx = hc * sp * Math.sin(facing), vy = hc * cp, vz = hc * sp * Math.cos(facing);
  out[idxs.RX] = cx - vx;
  out[idxs.RY] = cy - vy;
  out[idxs.RZ] = cz - vz;
  out[idxs.RPITCH] = pitch;
  return f;
}
/** 날아감 수치(§9.5 — view 전용 높이) */
export const LAUNCH = Object.freeze({ up: 4, g: 15 });

/** 경직 — 0.25초 뒤로 젖힘(p 0..1) */
export function bipedFlinch(out, p) {
  const k = Math.sin(PI * clamp01(p));
  out[BP.SPITCH] -= 0.45 * k;
  out[BP.HPITCH] -= 0.35 * k;
  out[BP.HIPZ] -= 0.08 * k;
  out[BP.LSHP] += 0.5 * k; out[BP.RSHP] += 0.5 * k;
  out[BP.LSHA] += 0.35 * k; out[BP.RSHA] += 0.35 * k;
}

/** 기절 — 고개 떨굼 · 팔 늘어짐 · 무릎 굽힘 · 흔들림(실제 시간) */
export function bipedStun(out, t) {
  out[BP.HPITCH] = 0.55 + 0.06 * Math.sin(t * 3.1);
  out[BP.HYAW] = 0.25 * Math.sin(t * 2.3);
  out[BP.SPITCH] += 0.2;
  out[BP.SROLL] += 0.08 * Math.sin(t * 2.3);
  out[BP.LSHP] = 0.12; out[BP.RSHP] = 0.12;
  out[BP.LSHA] = 0.05; out[BP.RSHA] = 0.05;
  out[BP.LELB] = 0.1; out[BP.RELB] = 0.1;
  out[BP.HIPY] -= 0.06;
}

/** 도망 — 팔을 휘저으며 뛴다(걷기 위에 덧씌움) */
export function bipedFlail(out, phase) {
  const s = Math.sin(2 * PI * phase * 2);
  out[BP.LSHP] = 1.9 + 0.7 * s; out[BP.RSHP] = 1.9 - 0.7 * s;
  out[BP.LSHA] = 0.6; out[BP.RSHA] = 0.6;
  out[BP.LELB] = 0.5; out[BP.RELB] = 0.5;
  out[BP.HPITCH] -= 0.2;
}

// ───────────────────────── 네 발 ─────────────────────────

/** @param {import('./rig.js').QuadDims & {footW:number}} d */
export function quadBase(d, partial = null) {
  const P = new Float32Array(QP.N);
  P[QP.FLX] = d.footW; P[QP.FLY] = d.ankleY; P[QP.FLZ] = d.legZf;
  P[QP.FRX] = -d.footW; P[QP.FRY] = d.ankleY; P[QP.FRZ] = d.legZf;
  P[QP.BLX] = d.footW; P[QP.BLY] = d.ankleY; P[QP.BLZ] = d.legZb;
  P[QP.BRX] = -d.footW; P[QP.BRY] = d.ankleY; P[QP.BRZ] = d.legZb;
  P[QP.FADE] = 1; P[QP.SWELL] = 1;
  return partial ? compileKey(P, partial, QP) : P;
}

/** 다리 위상: 속보(대각 짝) · 질주(앞 둘 · 뒤 둘) */
export const QUAD_PHASE = Object.freeze({ trot: [0, 0.5, 0.5, 0], gallop: [0, 0.12, 0.55, 0.67] });
const Q_FEET = [QP.FLX, QP.FRX, QP.BLX, QP.BRX];

/** 네 발 걷기 @returns {number} 디딘 발 비트(FL 1 · FR 2 · BL 4 · BR 8) */
export function quadWalk(out, d, g, phase, stepLen, mdx, mdz, amt, offsets = QUAD_PHASE.trot) {
  if (amt <= 0) return 15;
  const A = g.stance * stepLen;
  const sf = clamp01(stepLen / g.step);
  let planted = 0;
  for (let i = 0; i < 4; i++) {
    const q = frac(phase + offsets[i]);
    const on = footCycle(q, g.stance, A, g.lift * (0.4 + 0.6 * sf), _fc);
    const ix = Q_FEET[i];
    const bx = i % 2 === 0 ? d.footW : -d.footW, bz = i < 2 ? d.legZf : d.legZb;
    const fx = bx + mdx * _fc.f, fz = bz + mdz * _fc.f, fy = d.ankleY + _fc.h;
    out[ix] += (fx - out[ix]) * amt;
    out[ix + 1] += (fy - out[ix + 1]) * amt;
    out[ix + 2] += (fz - out[ix + 2]) * amt;
    if (on) planted |= 1 << i;
  }
  out[QP.BY] += (g.bob * sf * (0.5 - 0.5 * Math.cos(4 * PI * phase)) - g.crouch * sf) * amt;
  out[QP.BPITCH] += 0.04 * Math.sin(2 * PI * phase) * sf * amt;
  out[QP.HPITCH] += 0.08 * Math.sin(2 * PI * phase + 1) * sf * amt;
  out[QP.TAILY] += 0.3 * Math.sin(2 * PI * phase) * amt;
  return planted;
}

/** 네 발 쓰러짐 — 옆으로 눕는다 */
export function quadFall(out, t, dur, lie) {
  const k = ease(t / dur);
  out[QP.RROLL] = 1.45 * k;
  out[QP.RY] = lie * k;
  out[QP.HPITCH] += 0.4 * k;
  out[QP.TAILP] += 0.6 * k;
}

// ───────────────────────── 덩어리 ─────────────────────────

/** @param {{footW:number, ankleY:number}} d */
export function blobBase(d, partial = null) {
  const P = new Float32Array(OP.N);
  P[OP.LFX] = d.footW; P[OP.LFY] = d.ankleY; P[OP.LFZ] = 0.05;
  P[OP.RFX] = -d.footW; P[OP.RFY] = d.ankleY; P[OP.RFZ] = 0.05;
  P[OP.SWELL] = 1; P[OP.SQUASH] = 1; P[OP.FADE] = 1;
  return partial ? compileKey(P, partial, OP) : P;
}

/** 덩어리 뒤뚱 걷기 — 발 둘(두 발 주기) · 몸 좌우 기울기 */
export function blobWalk(out, d, g, phase, stepLen, mdx, mdz, amt) {
  if (amt <= 0) return 3;
  const A = g.stance * stepLen;
  let planted = 0;
  for (let side = 0; side < 2; side++) {
    const q = frac(phase + side * 0.5);
    const on = footCycle(q, g.stance, A, g.lift, _fc);
    const ix = side === 0 ? OP.LFX : OP.RFX;
    const bx = side === 0 ? d.footW : -d.footW;
    out[ix] += (bx + mdx * _fc.f - out[ix]) * amt;
    out[ix + 1] += (d.ankleY + _fc.h - out[ix + 1]) * amt;
    out[ix + 2] += (0.05 + mdz * _fc.f - out[ix + 2]) * amt;
    if (on) planted |= side === 0 ? 1 : 2;
  }
  out[OP.BROLL] += 0.14 * Math.sin(2 * PI * phase) * amt;
  out[OP.BY] += 0.04 * (0.5 - 0.5 * Math.cos(4 * PI * phase)) * amt;
  return planted;
}

/** 덩어리 · 둥지 쓰러짐 — 꺼지며 납작해진다 */
export function blobFall(out, t, dur) {
  const k = ease(t / dur);
  out[OP.SQUASH] = 1 - 0.55 * k;
  out[OP.SWELL] = out[OP.SWELL] * (1 - k) + 1.12 * k;
}
