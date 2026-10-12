// OWNER: P8 — 계약 §9.5 · §0.2 (내부 — 리그 · 정방향 운동학 · 두 마디 IK)
// 리그 넷(biped · quad · blob · nest)의 관절 행렬을 포즈 배열(Float32Array)에서 계산한다. three 의 Matrix4 만 쓴다(DOM 없음 — Node 테스트가 그대로 부른다).
// 좌표: +Z 가 앞 · 오른쪽 = −X(§0.2) · 루트 = 발밑 점(y = 0)에서 yaw → pitch → roll. 팔 · 다리는 관절 로컬 −Y 로 뻗는다.
// 각도 규약(포즈 배열): 팔 pitch + = 앞으로 들기 · abd + = 바깥으로 · 팔꿈치 + = 굽힘(아래팔이 앞으로) · 척추 pitch + = 앞으로 숙임 · 머리 pitch + = 숙임.
// 다리는 포즈 배열의 발목 목표점(루트 좌표 m)을 IK 로 푼다 — 디딘 발은 목표 그대로 바닥에 있다(미끄러짐 없음).
// 무기(wR)는 오른손에서 Rx(wrist) — 무기 지오메트리는 손잡이가 원점 · 날이 +Y. wrist π/2 = 아래팔에 직각으로 앞 · π = 아래팔을 잇는 방향.

import { Euler, Matrix4 } from 'three';

// ───────────────────────── 포즈 배열 색인 ─────────────────────────

/** 두 발 리그(사람 · 소형) */
export const BP = Object.freeze({
  RX: 0, RY: 1, RZ: 2, RPITCH: 3, RROLL: 4, RYAW: 5,
  HIPX: 6, HIPY: 7, HIPZ: 8, PYAW: 9, PROLL: 10,
  SPITCH: 11, SYAW: 12, SROLL: 13, HPITCH: 14, HYAW: 15,
  LSHP: 16, LSHA: 17, LSHT: 18, LELB: 19, LWRI: 20,
  RSHP: 21, RSHA: 22, RSHT: 23, RELB: 24, RWRI: 25,
  LFX: 26, LFY: 27, LFZ: 28, RFX: 29, RFY: 30, RFZ: 31,
  PROP: 32, GLOW: 33, FADE: 34, SWELL: 35, AUX: 36,
  N: 37,
});

/** 네 발 리그(돌격 짐승) */
export const QP = Object.freeze({
  RX: 0, RY: 1, RZ: 2, RPITCH: 3, RROLL: 4, RYAW: 5,
  BY: 6, BZ: 7, BPITCH: 8, BROLL: 9, HPITCH: 10, HYAW: 11, TAILP: 12, TAILY: 13,
  FLX: 14, FLY: 15, FLZ: 16, FRX: 17, FRY: 18, FRZ: 19, BLX: 20, BLY: 21, BLZ: 22, BRX: 23, BRY: 24, BRZ: 25,
  GLOW: 26, FADE: 27, SWELL: 28, AUX: 29,
  N: 30,
});

/** 덩어리(역병 덩어리) */
export const OP = Object.freeze({
  RX: 0, RY: 1, RZ: 2, RPITCH: 3, RROLL: 4, RYAW: 5,
  BY: 6, BROLL: 7, BPITCH: 8, SWELL: 9, SQUASH: 10,
  LFX: 11, LFY: 12, LFZ: 13, RFX: 14, RFY: 15, RFZ: 16,
  GLOW: 17, FADE: 18, AUX: 19,
  N: 20,
});

/** 둥지 */
export const NP = Object.freeze({
  RX: 0, RY: 1, RZ: 2, RPITCH: 3, RROLL: 4, RYAW: 5,
  PILE: 6, CORE: 7, GLOW: 8, FADE: 9, SWELL: 10, AUX: 11,
  N: 12,
});

/** 리그 종류 → 포즈 배열 길이 · 관절 수 */
export const RIG = Object.freeze({
  biped: { P: BP, joints: 18 },
  quad: { P: QP, joints: 16 },
  blob: { P: OP, joints: 4 },
  nest: { P: NP, joints: 3 },
});

/** 두 발 관절 */
export const BJ = Object.freeze({
  root: 0, hips: 1, chest: 2, head: 3,
  shL: 4, elL: 5, haL: 6, shR: 7, elR: 8, haR: 9,
  hipL: 10, knL: 11, anL: 12, hipR: 13, knR: 14, anR: 15,
  wR: 16, wL: 17,
});
/** 네 발 관절 */
export const QJ = Object.freeze({
  root: 0, body: 1, head: 2,
  flH: 3, flK: 4, flF: 5, frH: 6, frK: 7, frF: 8, blH: 9, blK: 10, blF: 11, brH: 12, brK: 13, brF: 14, tail: 15,
});
/** 덩어리 관절 */
export const OJ = Object.freeze({ root: 0, body: 1, fL: 2, fR: 3 });
/** 둥지 관절 */
export const NJ = Object.freeze({ root: 0, pile: 1, core: 2 });

/** 관절 행렬 배열 하나(재사용) @param {number} n */
export function makeJoints(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Matrix4());
  return out;
}

// ───────────────────────── 행렬 도우미 ─────────────────────────

const _e = new Euler();
const _l = new Matrix4();

/** m = T(x, y, z) · R(euler) */
function local(m, x, y, z, rx, ry, rz, order) {
  _e.set(rx, ry, rz, order);
  m.makeRotationFromEuler(_e);
  const el = m.elements;
  el[12] = x; el[13] = y; el[14] = z;
  return m;
}

/** out = parent · T · R */
function child(out, parent, x, y, z, rx, ry, rz, order) {
  local(_l, x, y, z, rx, ry, rz, order);
  return out.multiplyMatrices(parent, _l);
}

/** 루트: T(x + RX, RY, z + RZ) · Ry(facing + RYAW) · Rx(RPITCH) · Rz(RROLL) · S(s) */
function rootMatrix(m, x, z, facing, P, s) {
  local(m, x + P[0], P[1], z + P[2], P[3], facing + P[5], P[4], 'YXZ');
  if (s !== 1) m.scale(_sv.set(s, s, s));
  return m;
}
const _sv = { x: 1, y: 1, z: 1, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };

/** 행렬의 이동 성분 @param {Matrix4} m @param {{x:number,y:number,z:number}} out */
export function posOf(m, out) {
  const el = m.elements;
  out.x = el[12]; out.y = el[13]; out.z = el[14];
  return out;
}
/** 로컬 점 → 월드 @param {Matrix4} m */
export function pointOf(m, lx, ly, lz, out) {
  const e = m.elements;
  out.x = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
  out.y = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
  out.z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
  return out;
}

// ───────────────────────── 두 마디 IK ─────────────────────────

/**
 * 다리 하나 — 엉덩이 관절 로컬 좌표의 발목 목표(dx, dy, dz)로 [pitch, roll, knee] 를 out[o..o+2] 에.
 * dir +1 = 무릎이 앞(사람) · −1 = 무릎이 뒤(짐승 뒷다리의 발뒤꿈치 관절). 닿지 않으면 다 펴서 그 방향으로.
 * FK: hip = Rz(roll) · Rx(−pitch) · 넓적다리(−Y, L1) → Rx(knee) · 정강이(−Y, L2) 가 목표에 닿는다.
 */
export function ikLeg(dx, dy, dz, L1, L2, dir, out, o) {
  const roll = Math.atan2(dx, -dy);
  const vy = Math.hypot(dx, dy);
  let D = Math.hypot(vy, dz);
  const maxD = (L1 + L2) * 0.99995, minD = Math.abs(L1 - L2) + 1e-4;
  if (D > maxD) D = maxD;
  else if (D < minD) D = minD;
  const thd = Math.atan2(dz, vy);
  let ca = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
  ca = ca < -1 ? -1 : ca > 1 ? 1 : ca;
  let ck = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
  ck = ck < -1 ? -1 : ck > 1 ? 1 : ck;
  const alpha = Math.acos(ca);
  const knee = Math.PI - Math.acos(ck);
  out[o] = thd + dir * alpha;
  out[o + 1] = roll;
  out[o + 2] = dir * knee;
}

const _ik = new Float64Array(3);

/**
 * 다리 FK — parent(엉덩이 틀)의 hx 자리 관절에서 목표(루트 좌표 tx, ty, tz)로.
 * 엉덩이 틀의 루트 로컬 변환 = T(px, py, pz) · Ry(yaw) · Rz(roll)(강체) — 목표를 그 틀로 옮겨 IK 를 푼다.
 */
function leg(J, parent, iH, iK, iF, hx, hy, hz, L1, L2, dir, tx, ty, tz, px, py, pz, yaw, roll) {
  // 관절(엉덩이 틀 로컬 hx, hy, hz)의 루트 좌표
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  // Rz(roll) · (hx, hy, hz)
  const ax = hx * cr - hy * sr, ay = hx * sr + hy * cr, az = hz;
  // Ry(yaw) · a + p
  const jx = ax * cy + az * sy + px, jy = ay + py, jz = -ax * sy + az * cy + pz;
  // d(루트) → 엉덩이 틀: Rz(−roll) · Ry(−yaw) · d
  const wx = tx - jx, wy = ty - jy, wz = tz - jz;
  const bx = wx * cy - wz * sy, bz = wx * sy + wz * cy, by = wy;
  const dx = bx * cr + by * sr, dy = -bx * sr + by * cr, dz = bz;
  ikLeg(dx, dy, dz, L1, L2, dir, _ik, 0);
  const pitch = _ik[0], rl = _ik[1], knee = _ik[2];
  child(J[iH], parent, hx, hy, hz, -pitch, 0, rl, 'ZXY');
  child(J[iK], J[iH], 0, -L1, 0, knee, 0, 0, 'XYZ');
  // 발은 루트 틀에서 수평(pitch 상쇄)
  child(J[iF], J[iK], 0, -L2, 0, pitch - knee, 0, 0, 'XYZ');
}

// ───────────────────────── 두 발 ─────────────────────────

/**
 * @typedef {Object} BipedDims
 * @property {number} ankleY 발목 높이 @property {number} shin @property {number} thigh @property {number} hipX 엉덩이 관절 좌우
 * @property {number} torso 골반 → 가슴 위 @property {number} shX @property {number} shY @property {number} shZ 어깨 관절(가슴 틀)
 * @property {number} upper @property {number} fore 위팔 · 아래팔 @property {number} neck @property {number} headZ
 */

/**
 * 두 발 리그 FK — J[BJ.*] 에 월드 행렬
 * @param {BipedDims} d @param {Float32Array|number[]} P @param {number} x @param {number} z @param {number} facing @param {Matrix4[]} J @param {number} [s] 배율
 */
export function fkBiped(d, P, x, z, facing, J, s = 1) {
  const root = rootMatrix(J[0], x, z, facing, P, s);
  const hips = child(J[1], root, P[BP.HIPX], P[BP.HIPY], P[BP.HIPZ], 0, P[BP.PYAW], P[BP.PROLL], 'YZX');
  const chest = child(J[2], hips, 0, 0, 0, P[BP.SPITCH], P[BP.SYAW], P[BP.SROLL], 'YXZ');
  child(J[3], chest, 0, d.torso + d.neck, d.headZ, P[BP.HPITCH], P[BP.HYAW], 0, 'YXZ');
  // 왼팔(+X)
  child(J[4], chest, d.shX, d.shY, d.shZ, -P[BP.LSHP], P[BP.LSHT], P[BP.LSHA], 'ZXY');
  child(J[5], J[4], 0, -d.upper, 0, -P[BP.LELB], 0, 0, 'XYZ');
  child(J[6], J[5], 0, -d.fore, 0, 0, 0, 0, 'XYZ');
  // 오른팔(−X · 바깥 · 비틀기 부호 거울)
  child(J[7], chest, -d.shX, d.shY, d.shZ, -P[BP.RSHP], -P[BP.RSHT], -P[BP.RSHA], 'ZXY');
  child(J[8], J[7], 0, -d.upper, 0, -P[BP.RELB], 0, 0, 'XYZ');
  child(J[9], J[8], 0, -d.fore, 0, 0, 0, 0, 'XYZ');
  // 손의 무기 · 소품
  child(J[16], J[9], 0, 0, 0, P[BP.RWRI], 0, 0, 'XYZ');
  child(J[17], J[6], 0, 0, 0, P[BP.LWRI], 0, 0, 'XYZ');
  // 다리(IK)
  const px = P[BP.HIPX], py = P[BP.HIPY], pz = P[BP.HIPZ], yaw = P[BP.PYAW], rl = P[BP.PROLL];
  leg(J, hips, 10, 11, 12, d.hipX, 0, 0, d.thigh, d.shin, 1, P[BP.LFX], P[BP.LFY], P[BP.LFZ], px, py, pz, yaw, rl);
  leg(J, hips, 13, 14, 15, -d.hipX, 0, 0, d.thigh, d.shin, 1, P[BP.RFX], P[BP.RFY], P[BP.RFZ], px, py, pz, yaw, rl);
  return J;
}

// ───────────────────────── 네 발 ─────────────────────────

/**
 * @typedef {Object} QuadDims
 * @property {number} bodyY 몸통 중심 높이 @property {number} hipDrop 몸통 중심 → 다리 관절(아래로) @property {number} legX
 * @property {number} legZf @property {number} legZb @property {number} upperF @property {number} lowerF @property {number} upperB @property {number} lowerB
 * @property {number} neckY @property {number} neckZ @property {number} tailZ @property {number} ankleY
 */

/** 네 발 리그 FK */
export function fkQuad(d, P, x, z, facing, J, s = 1) {
  const root = rootMatrix(J[0], x, z, facing, P, s);
  const by = d.bodyY + P[QP.BY], bz = P[QP.BZ], bp = P[QP.BPITCH], br = P[QP.BROLL];
  const body = child(J[1], root, 0, by, bz, bp, 0, br, 'XZY');
  child(J[2], body, 0, d.neckY, d.neckZ, P[QP.HPITCH], P[QP.HYAW], 0, 'YXZ');
  child(J[15], body, 0, d.tailY, d.tailZ, P[QP.TAILP], P[QP.TAILY], 0, 'YXZ');
  // 다리 관절은 몸통 틀(기울기 포함) — 목표를 몸통 틀로 옮긴다: 몸통 로컬 = T(0, by, bz) · Rx(bp) · Rz(br)
  legQ(J, body, 3, 4, 5, d.legX, -d.hipDrop, d.legZf, d.upperF, d.lowerF, -1, P[QP.FLX], P[QP.FLY], P[QP.FLZ], by, bz, bp, br);
  legQ(J, body, 6, 7, 8, -d.legX, -d.hipDrop, d.legZf, d.upperF, d.lowerF, -1, P[QP.FRX], P[QP.FRY], P[QP.FRZ], by, bz, bp, br);
  legQ(J, body, 9, 10, 11, d.legX, -d.hipDrop, d.legZb, d.upperB, d.lowerB, 1, P[QP.BLX], P[QP.BLY], P[QP.BLZ], by, bz, bp, br);
  legQ(J, body, 12, 13, 14, -d.legX, -d.hipDrop, d.legZb, d.upperB, d.lowerB, 1, P[QP.BRX], P[QP.BRY], P[QP.BRZ], by, bz, bp, br);
  return J;
}

function legQ(J, body, iH, iK, iF, hx, hy, hz, L1, L2, dir, tx, ty, tz, by, bz, bp, br) {
  // 목표(루트) → 몸통 틀: Rz(−br) · Rx(−bp) · (t − (0, by, bz))
  const wx = tx, wy = ty - by, wz = tz - bz;
  const cp = Math.cos(bp), sp = Math.sin(bp), cr = Math.cos(br), sr = Math.sin(br);
  // Rx(−bp)
  const ay = wy * cp + wz * sp, az = -wy * sp + wz * cp, ax = wx;
  // Rz(−br)
  const bx = ax * cr + ay * sr, byy = -ax * sr + ay * cr;
  const dx = bx - hx, dy = byy - hy, dz = az - hz;
  ikLeg(dx, dy, dz, L1, L2, dir, _ik, 0);
  const pitch = _ik[0], rl = _ik[1], knee = _ik[2];
  child(J[iH], body, hx, hy, hz, -pitch, 0, rl, 'ZXY');
  child(J[iK], J[iH], 0, -L1, 0, knee, 0, 0, 'XYZ');
  child(J[iF], J[iK], 0, -L2, 0, pitch - knee - bp, 0, 0, 'XYZ');
}

// ───────────────────────── 덩어리 · 둥지 ─────────────────────────

/** @typedef {{bodyY:number}} BlobDims */

/** 덩어리 FK — 몸(부풀기 배율 · 납작) · 발 두 개(목표 그대로) */
export function fkBlob(d, P, x, z, facing, J, s = 1) {
  const root = rootMatrix(J[0], x, z, facing, P, s);
  const sw = P[OP.SWELL] || 1, sq = P[OP.SQUASH] || 1;
  const body = child(J[1], root, 0, (d.bodyY + P[OP.BY]) * sq, 0, P[OP.BPITCH], 0, P[OP.BROLL], 'XZY');
  body.scale(_sv.set(sw, sw * sq, sw));
  child(J[2], root, P[OP.LFX], P[OP.LFY], P[OP.LFZ], 0, 0, 0, 'XYZ');
  child(J[3], root, P[OP.RFX], P[OP.RFY], P[OP.RFZ], 0, 0, 0, 'XYZ');
  return J;
}

/** 둥지 FK — 더미(세로 배율) · 가운데 핵(맥동 배율) */
export function fkNest(d, P, x, z, facing, J, s = 1) {
  const root = rootMatrix(J[0], x, z, facing, P, s);
  const pile = child(J[1], root, 0, 0, 0, 0, 0, 0, 'XYZ');
  const py = P[NP.PILE] || 1;
  pile.scale(_sv.set(1, py, 1));
  const c = child(J[2], root, 0, d.coreY * py, 0, 0, 0, 0, 'XYZ');
  const k = P[NP.CORE] || 1;
  c.scale(_sv.set(k, k, k));
  return J;
}

/** 리그 종류 → FK 함수 */
export const FK = Object.freeze({ biped: fkBiped, quad: fkQuad, blob: fkBlob, nest: fkNest });
