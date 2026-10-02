// OWNER: P5 — 계약 §9.6 「플레이어 상태 → 포즈」
// 플레이어 뷰: 상태 15종 → 포즈, motion 7종 × grip 3종의 공격 포즈(attackPose · releaseT = 0).
// 포즈 표는 도(°) · 키 1.8m 기준으로 적는다. 오른팔이 무기를 쥐고, 양손 무기(twoHand · polearm)의 왼손은
// 리그의 IK가 자루에 붙인다(표에는 오른팔과 몸만 적는다). 발은 groundFeet가 지면에 붙인다.
import * as THREE from 'three';
import { PLAYER } from '../../data/player.js';
import { PALETTE } from '../../data/palette.js';
import { getWeaponDef } from '../../data/weapons.js';
import { buildHumanoidRig } from './rig.js';
import { createWeaponMesh } from './weaponMeshes.js';
import { ease, emptyPose, poseDeg, withPose, lerpPose, copyPose, addRot, addPos, attackPose, applyGait, PoseBlender } from './pose.js';

/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').PoseSet} PoseSet */
/** @typedef {import('../../types.js').PlayerState} PlayerState */
/** @typedef {import('../../types.js').GameState} GameState */

const TAU = Math.PI * 2;
/** 포즈 표의 위치 오프셋(키 1.8m 기준)을 실제 키로 옮기는 배율 */
const U = PLAYER.height / 1.8;

// 연출 상수
const HL_DEFAULT = 0.05;       // 포즈 블렌더 반감기(초)
const HL_ATTACK = 0.022;       // 공격 중 — 화면의 무기가 판정보다 늦지 않게
const HL_MOVE = 0.035;
const HL_HURT = 0.03;
/** 공격 active 포즈의 시작 진행도 — attackPose의 active는 outQuint(p / 0.5)라 0.1이면 휘두르기의 약 2/3 지점(닿는 자리)이다 */
const ACTIVE_CONTACT_T = 0.1;
const IK_LAMBDA = 16;          // 왼손 IK 가중치 추종
const GROUND_LAMBDA = 24;      // 발 붙이기 가중치 추종(도약 · 넘어짐에서 툭 끊기지 않게)
const SPEED_LAMBDA = 12;       // 보폭 진폭 추종
const SLOW_GAIT = 0.62;        // 걷기 속력의 이 비율 아래는 「느린 걸음」(보폭 절반)
const BREATH_RATE = 1.7;       // rad/s
const ROLL_SPIN_END = 0.76;    // 구르기: 이 진행도에 한 바퀴를 마친다(캔슬 창 actAt ≈ 0.77보다 앞)
const HOP_HEIGHT = 0.16;       // 백스텝 도약 높이(m)
const EXEC_STAB = 0.09;        // 처형: 찌르는 데 걸리는 시간(초)
const EXEC_HOLD = 0.43;        // 꽂은 채 버티는 시간(초) — 타격 시각(hitAt)부터
const EXEC_PULL = 0.3;         // 뽑는 시간(초)
const FLASK_COLOR = 0xffb24a;
/** 왼손이 편한 자리: 왼 어깨에서 (몸 안쪽, 아래, 앞) m — 키 1.8 기준 */
const GRIP_COMFORT = [-0.1, -0.3, 0.3];
const _v = new THREE.Vector3();

/** @param {Record<string, number[]>} rot @param {Record<string, number[]>} [pos] @returns {Pose} */
function D(rot, pos) {
  const p = poseDeg(rot, pos);
  for (const k in p.pos) {
    p.pos[k][0] *= U; p.pos[k][1] *= U; p.pos[k][2] *= U;
  }
  return p;
}
/** base 위에 관절 몇 개만 바꾼 포즈 @param {Pose} base @param {Record<string, number[]>} rot @param {Record<string, number[]>} [pos] */
const V = (base, rot, pos) => {
  const p = withPose(base, rot, pos);
  if (pos) for (const k in pos) { p.pos[k][0] *= U; p.pos[k][1] *= U; p.pos[k][2] *= U; }
  return p;
};

// ───────────────────────── 다리 묶음 ─────────────────────────
const LEGS_STAND = { hipL: [0, 4, 4], hipR: [0, -4, -4] };
/** 전투 자세: 왼발이 앞, 무릎을 굽혀 낮춘다 */
const LEGS_READY = { hipL: [-30, 6, 10], kneeL: [40, 0, 0], hipR: [16, -14, -13], kneeR: [30, 0, 0] };
/** 깊게 내딛는 런지(왼발 앞) */
const LEGS_LUNGE = { hipL: [-58, 4, 4], kneeL: [66, 0, 0], hipR: [32, -10, -6], kneeR: [10, 0, 0] };
/** 뒤로 실은 자세(예고) */
const LEGS_COIL = { hipL: [-22, 6, 6], kneeL: [22, 0, 0], hipR: [8, -20, -10], kneeR: [44, 0, 0] };
/** 넓게 버틴 자세(휘두른 뒤) */
const LEGS_WIDE = { hipL: [-34, 10, 12], kneeL: [48, 0, 0], hipR: [22, -16, -14], kneeR: [30, 0, 0] };

// ───────────────────────── 자세(grip별) ─────────────────────────
/**
 * idle: 느슨히 선 자세 · combat: 록온 전투 자세 · guard: 가드 · walk: 걸을 때의 상체(없으면 run) · run: 달릴 때의 상체
 * ik: 그 자세에서 왼손을 자루에 붙이는 정도(0..1)
 */
const STANCE = {
  oneHand: {
    idle: D({ spine: [3, 0, 0], head: [-2, 0, 0], shoulderR: [8, 0, -10], elbowR: [-18, 0, 0], handR: [48, 0, 0],
      shoulderL: [4, 0, 9], elbowL: [-14, 0, 0], ...LEGS_STAND }),
    combat: D({ hips: [0, -20, 0], spine: [8, 8, 0], chest: [4, 10, 0], head: [-6, 4, 0],
      shoulderR: [-28, 0, -22], elbowR: [-78, 0, 0], handR: [14, 0, 0],
      shoulderL: [-22, 0, 16], elbowL: [-62, 0, 0], ...LEGS_READY }),
    guard: D({ hips: [0, -14, 0], spine: [10, 6, 0], chest: [6, 8, 0], head: [-8, 2, 0],
      shoulderR: [-62, 38, -24], elbowR: [-84, 0, 0], handR: [-6, 52, 0],
      shoulderL: [-34, -16, 12], elbowL: [-96, 0, 0], ...LEGS_READY }),
    walk: D({ spine: [9, 0, 0], chest: [2, 0, 0], head: [-6, 0, 0], shoulderR: [10, 0, -10], elbowR: [-40, 0, 0], handR: [50, 0, 0],
      shoulderL: [2, 0, 9], elbowL: [-50, 0, 0], ...LEGS_STAND }),
    run: D({ spine: [14, 0, 0], chest: [4, 0, 0], head: [-10, 0, 0], shoulderR: [30, 0, -16], elbowR: [-25, 0, 0], handR: [112, 0, 0],
      shoulderL: [0, 0, 10], elbowL: [-70, 0, 0], ...LEGS_STAND }),
    ik: { idle: 0, combat: 0, guard: 0, run: 0, attack: 0 },
  },
  twoHand: {
    // 대검을 어깨에 걸친다
    idle: D({ spine: [3, 0, 0], head: [-2, 0, 0], shoulderR: [-24, 0, -14], elbowR: [-138, 0, 0], handR: [4, 0, -8],
      shoulderL: [4, 0, 9], elbowL: [-14, 0, 0], ...LEGS_STAND }),
    combat: D({ hips: [0, -22, 0], spine: [10, 8, 0], chest: [5, 10, 0], head: [-8, 4, 0],
      shoulderR: [-30, 0, 15], elbowR: [-60, 0, 0], handR: [35, 0, 0], ...LEGS_READY }),
    guard: D({ hips: [0, -16, 0], spine: [12, 6, 0], chest: [6, 8, 0], head: [-10, 2, 0],
      shoulderR: [-50, 0, 12], elbowR: [-70, 0, 0], handR: [20, 30, 0], ...LEGS_READY }),
    run: D({ spine: [16, 0, 0], chest: [4, 0, 0], head: [-12, 0, 0], shoulderR: [-20, 0, -16], elbowR: [-132, 0, 0], handR: [0, 0, -8],
      shoulderL: [0, 0, 10], elbowL: [-70, 0, 0], ...LEGS_STAND }),
    ik: { idle: 0, combat: 1, guard: 1, run: 0, attack: 1 },
  },
  polearm: {
    // 창을 세워 든다
    idle: D({ spine: [3, 0, 0], head: [-2, 0, 0], shoulderR: [-12, 0, -14], elbowR: [-62, 0, 0], handR: [-16, 0, 0],
      shoulderL: [4, 0, 9], elbowL: [-14, 0, 0], ...LEGS_STAND }),
    combat: D({ hips: [0, -32, 0], spine: [10, 10, 0], chest: [5, 14, 0], head: [-8, 8, 0],
      shoulderR: [25, 10, -10], elbowR: [-70, 0, 0], handR: [30, 0, 0], ...LEGS_READY }),
    guard: D({ hips: [0, -24, 0], spine: [10, 8, 0], chest: [6, 10, 0], head: [-8, 6, 0],
      shoulderR: [20, 10, -10], elbowR: [-80, 0, 0], handR: [10, 45, 0], ...LEGS_READY }),
    run: D({ spine: [14, 0, 0], chest: [4, 0, 0], head: [-10, 0, 0], shoulderR: [20, 0, -16], elbowR: [-60, 0, 0], handR: [36, 0, 0],
      shoulderL: [0, 0, 10], elbowL: [-70, 0, 0], ...LEGS_STAND }),
    ik: { idle: 0, combat: 1, guard: 1, run: 0, attack: 1 },
  },
};

// ───────────────────────── 공격 포즈: motion × grip ─────────────────────────
// 실루엣 규칙(§9.5): 예고 = 무기를 크게 뒤/위로, 판정 = 반대편 끝까지, 후딜(follow) = 무기가 처지고 몸이 숙는다.
// 읽는 법 — 오른팔 [rx, ry, rz]:
//   세로 동작(rz 작음): 몸통 · 어깨 · 팔꿈치 · 손목의 rx 합 Θ가 날의 각이다(0 = 앞, −90 = 위, ±180 = 뒤, +90 = 아래).
//   가로 동작(rz ≈ −80): 날의 방위 = 몸통 비틀림 합 + 어깨 ry + |팔꿈치| + 90 − 손목 rx (0 = 오른쪽, 90 = 앞, 180 = 왼쪽).

/** @type {Record<string, PoseSet>} */
const ONE = {
  // 오른쪽 뒤로 팔과 칼을 한 줄로 뻗었다가 앞을 쓸어 왼쪽에서 멈춘다
  slashR: {
    windup: D({ hips: [0, -15, 0], spine: [-2, -12, 0], chest: [-2, -13, 0], head: [0, 30, 0],
      shoulderR: [15, -30, -95], elbowR: [-20, 0, 0], handR: [85, 0, 0],
      shoulderL: [-30, 0, 25], elbowL: [-70, 0, 0], ...LEGS_COIL }),
    active: D({ hips: [0, 16, 0], spine: [10, 12, 0], chest: [4, 12, 0], head: [-6, -28, 0],
      shoulderR: [15, 60, -80], elbowR: [-10, 0, 0], handR: [20, 0, 0],
      shoulderL: [30, 0, 30], elbowL: [-40, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 22, 0], spine: [18, 16, 0], chest: [6, 17, 0], head: [-10, -36, 0],
      shoulderR: [-8, 88, -60], elbowR: [-30, 0, 0], handR: [14, 0, 0],
      shoulderL: [36, 0, 34], elbowL: [-50, 0, 0], ...LEGS_WIDE }),
  },
  // 왼 어깨 너머로 감았다가 오른쪽으로 되베기(팔과 칼이 오른쪽으로 곧게 뻗는다)
  slashL: {
    windup: D({ hips: [0, 14, 0], spine: [2, 10, 0], chest: [0, 11, 0], head: [-2, -28, 0],
      shoulderR: [0, 100, -108], elbowR: [-80, 0, 0], handR: [80, 0, 0],
      shoulderL: [20, 0, 24], elbowL: [-40, 0, 0], ...LEGS_READY }),
    active: D({ hips: [0, -14, 0], spine: [10, -10, 0], chest: [4, -11, 0], head: [-6, 28, 0],
      shoulderR: [0, 20, -78], elbowR: [-5, 0, 0], handR: [85, 0, 0],
      shoulderL: [-30, 30, 20], elbowL: [-70, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -20, 0], spine: [16, -14, 0], chest: [6, -16, 0], head: [-10, 40, 0],
      shoulderR: [10, 0, -66], elbowR: [-12, 0, 0], handR: [74, 0, 0],
      shoulderL: [-36, 34, 20], elbowL: [-80, 0, 0], ...LEGS_WIDE }),
  },
  // 뒤로 낮게 끌다가 앞을 지나 위로 올려 베기
  slashUp: {
    windup: D({ hips: [0, -12, 0], spine: [22, -8, 0], chest: [8, -5, 0], head: [-22, 20, 0],
      shoulderR: [35, 0, -22], elbowR: [-5, 0, 0], handR: [100, 0, 0],
      shoulderL: [-44, 0, 16], elbowL: [-50, 0, 0], ...LEGS_READY }, { hips: [0, -0.08, 0] }),
    active: D({ hips: [0, 10, 0], spine: [-8, 8, 0], chest: [-6, 7, 0], head: [8, -12, 0],
      shoulderR: [-130, 0, -15], elbowR: [-10, 0, 0], handR: [40, 0, 0],
      shoulderL: [30, 0, 26], elbowL: [-30, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 14, 0], spine: [-8, 10, 0], chest: [-6, 8, 0], head: [8, -16, 0],
      shoulderR: [-150, 0, -20], elbowR: [-45, 0, 0], handR: [20, 0, 0],
      shoulderL: [36, 0, 30], elbowL: [-40, 0, 0], ...LEGS_WIDE }),
  },
  // 머리 위로 곧게 치켜들었다가 내려찍기
  overhead: {
    windup: D({ spine: [-12, -6, 0], chest: [-10, -6, 0], head: [12, 6, 0],
      shoulderR: [-160, 0, -14], elbowR: [-50, 0, 0], handR: [90, 0, 0],
      shoulderL: [-50, 0, 20], elbowL: [-40, 0, 0], ...LEGS_COIL }),
    active: D({ spine: [26, 6, 0], chest: [16, 4, 0], head: [-24, 0, 0],
      shoulderR: [-58, 0, -8], elbowR: [-6, 0, 0], handR: [50, 0, 0],
      shoulderL: [40, 0, 22], elbowL: [-30, 0, 0], ...LEGS_LUNGE }),
    follow: D({ spine: [36, 8, 0], chest: [18, 4, 0], head: [-26, 0, 0],
      shoulderR: [-50, 0, -8], elbowR: [-10, 0, 0], handR: [28, 0, 0],
      shoulderL: [44, 0, 24], elbowL: [-36, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.06, 0] }),
  },
  // 옆구리로 당겼다가 곧게 찌르기
  thrust: {
    windup: D({ hips: [0, -20, 0], spine: [4, -10, 0], chest: [0, -10, 0], head: [-4, 36, 0],
      shoulderR: [72, 40, -20], elbowR: [-122, 0, 0], handR: [26, 0, 0],
      shoulderL: [-70, 30, 10], elbowL: [-20, 0, 0], ...LEGS_COIL }),
    active: D({ hips: [0, 12, 0], spine: [14, 7, 0], chest: [6, 6, 0], head: [-14, -22, 0],
      shoulderR: [-80, 0, -28], elbowR: [-4, 0, 0], handR: [70, 0, 0],
      shoulderL: [40, 0, 26], elbowL: [-50, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 14, 0], spine: [22, 7, 0], chest: [8, 6, 0], head: [-18, -24, 0],
      shoulderR: [-30, 0, -24], elbowR: [-40, 0, 0], handR: [80, 0, 0],
      shoulderL: [44, 0, 28], elbowL: [-56, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.05, 0] }),
  },
};
// 크게 감았다가 한 바퀴 돌려 베기(몸의 회전은 뷰가 hips에 덧붙인다) · 낮고 넓게 쓸기
ONE.spin = {
  windup: V(ONE.slashR.windup, { hips: [0, -30, 0], spine: [8, -20, 0], chest: [0, -16, 0], head: [-6, 60, 0] }, { hips: [0, -0.08, 0] }),
  active: V(ONE.slashR.active, { hips: [0, 24, 0], shoulderR: [5, 60, -82] }),
  follow: V(ONE.slashR.follow, { hips: [0, 32, 0] }, { hips: [0, -0.06, 0] }),
};
ONE.sweep = {
  windup: V(ONE.slashR.windup, { spine: [12, -12, 0], shoulderR: [0, -30, -72] }, { hips: [0, -0.06, 0] }),
  active: V(ONE.slashR.active, { spine: [18, 12, 0], shoulderR: [0, 60, -68] }),
  follow: V(ONE.slashR.follow, { spine: [24, 16, 0] }),
};

/** @type {Record<string, PoseSet>} */
const TWO = {
  // 얼굴 옆으로 세워 메었다가 왼쪽 앞으로 — 끝은 왼쪽 바닥에 끌린다. 두 손은 몸 가운데에 둔다(rz +)
  slashR: {
    windup: D({ hips: [0, -16, 0], spine: [-4, -10, 0], chest: [-4, -9, 0], head: [4, 26, 0],
      shoulderR: [-80, 0, 5], elbowR: [-110, 0, 0], handR: [45, -36, 0], ...LEGS_COIL }),
    active: D({ hips: [0, 18, 0], spine: [16, 12, 0], chest: [8, 10, 0], head: [-12, -30, 0],
      shoulderR: [-50, 20, 15], elbowR: [-40, 0, 0], handR: [50, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 24, 0], spine: [26, 16, 0], chest: [10, 15, 0], head: [-16, -40, 0],
      shoulderR: [-35, 40, 15], elbowR: [-35, 0, 0], handR: [75, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.05, 0] }),
  },
  // 왼 어깨 위에서 오른쪽 앞으로
  slashL: {
    windup: D({ hips: [0, 14, 0], spine: [-4, 9, 0], chest: [-4, 7, 0], head: [4, -24, 0],
      shoulderR: [-80, 50, 15], elbowR: [-110, 0, 0], handR: [45, 36, 0], ...LEGS_READY }),
    active: D({ hips: [0, -16, 0], spine: [16, -10, 0], chest: [8, -9, 0], head: [-12, 28, 0],
      shoulderR: [-50, -25, 5], elbowR: [-40, 0, 0], handR: [50, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -22, 0], spine: [26, -14, 0], chest: [10, -14, 0], head: [-16, 40, 0],
      shoulderR: [-35, -40, 5], elbowR: [-35, 0, 0], handR: [75, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.05, 0] }),
  },
  slashUp: {
    windup: D({ hips: [0, -16, 0], spine: [30, -10, 0], chest: [12, -9, 0], head: [-26, 24, 0],
      shoulderR: [20, 0, 10], elbowR: [-20, 0, 0], handR: [110, 0, 0], ...LEGS_READY }, { hips: [0, -0.12, 0] }),
    active: D({ hips: [0, 10, 0], spine: [-12, 8, 0], chest: [-10, 6, 0], head: [10, -12, 0],
      shoulderR: [-125, 0, 15], elbowR: [-25, 0, 0], handR: [65, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 14, 0], spine: [-10, 10, 0], chest: [-8, 8, 0], head: [8, -16, 0],
      shoulderR: [-140, 0, 15], elbowR: [-60, 0, 0], handR: [40, 0, 0], ...LEGS_WIDE }),
  },
  overhead: {
    windup: D({ spine: [-16, 0, 0], chest: [-12, 0, 0], head: [16, 0, 0],
      shoulderR: [-155, 0, 12], elbowR: [-60, 0, 0], handR: [90, 0, 0], ...LEGS_COIL }),
    active: D({ spine: [32, 0, 0], chest: [18, 0, 0], head: [-28, 0, 0],
      shoulderR: [-70, 0, 15], elbowR: [-25, 0, 0], handR: [60, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.04, 0] }),
    follow: D({ spine: [42, 0, 0], chest: [20, 0, 0], head: [-30, 0, 0],
      shoulderR: [-55, 0, 15], elbowR: [-25, 0, 0], handR: [40, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.12, 0] }),
  },
  thrust: {
    windup: D({ hips: [0, -20, 0], spine: [6, -10, 0], chest: [0, -10, 0], head: [-6, 36, 0],
      shoulderR: [40, 30, 5], elbowR: [-105, 0, 0], handR: [40, 0, 0], ...LEGS_COIL }),
    active: D({ hips: [0, -8, 0], spine: [18, -4, 0], chest: [8, -3, 0], head: [-18, 14, 0],
      shoulderR: [-30, 15, 12], elbowR: [-70, 0, 0], handR: [77, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -8, 0], spine: [24, -4, 0], chest: [10, -3, 0], head: [-22, 14, 0],
      shoulderR: [-10, 15, 12], elbowR: [-80, 0, 0], handR: [80, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.06, 0] }),
  },
};
// 허리 뒤로 낮게 감았다가(꼬리 자세) 한 바퀴 돌려 벤다 — 판정의 회전은 뷰가 덧붙인다
TWO.spin = {
  windup: D({ hips: [0, -34, 0], spine: [12, -20, 0], chest: [4, -16, 0], head: [-10, 60, 0],
    shoulderR: [15, 0, 10], elbowR: [-25, 0, 0], handR: [140, 0, 0], ...LEGS_COIL }, { hips: [0, -0.1, 0] }),
  active: V(TWO.slashR.active, { hips: [0, 26, 0], spine: [12, 16, 0], handR: [60, 0, 0] }),
  follow: V(TWO.slashR.follow, { hips: [0, 34, 0] }, { hips: [0, -0.1, 0] }),
};
TWO.sweep = {
  windup: V(TWO.spin.windup, { hips: [0, -26, 0] }),
  active: V(TWO.slashR.active, { handR: [60, 0, 0] }),
  follow: V(TWO.slashR.follow, {}),
};

/** @type {Record<string, PoseSet>} */
const POLE = {
  // 창을 허리 뒤로 당겼다가 곧게 찌른다(뒷손은 앞손 자리까지만 민다)
  thrust: {
    windup: D({ hips: [0, -30, 0], spine: [6, -10, 0], chest: [0, -10, 0], head: [-6, 46, 0],
      shoulderR: [55, 50, -22], elbowR: [-100, 0, 0], handR: [28, 0, 0], ...LEGS_COIL }),
    active: D({ hips: [0, -14, 0], spine: [18, -6, 0], chest: [6, -5, 0], head: [-16, 24, 0],
      shoulderR: [-18, 25, 12], elbowR: [-98, 0, 0], handR: [94, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -14, 0], spine: [22, -6, 0], chest: [8, -5, 0], head: [-18, 24, 0],
      shoulderR: [20, 25, 10], elbowR: [-100, 0, 0], handR: [66, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.04, 0] }),
  },
  // 몸을 크게 틀어 창대를 가로로 휘두른다(창은 몸 앞에 두고 몸통이 돈다)
  sweep: {
    windup: D({ hips: [0, -42, 0], spine: [6, -20, 0], chest: [0, -20, 0], head: [-4, 70, 0],
      shoulderR: [5, 0, 0], elbowR: [-95, 0, 0], handR: [90, 0, 0], ...LEGS_COIL }),
    active: D({ hips: [0, 30, 0], spine: [12, 16, 0], chest: [4, 16, 0], head: [-10, -50, 0],
      shoulderR: [0, 30, 5], elbowR: [-95, 0, 0], handR: [85, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 38, 0], spine: [20, 20, 0], chest: [6, 18, 0], head: [-14, -60, 0],
      shoulderR: [0, 40, 5], elbowR: [-95, 0, 0], handR: [100, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.05, 0] }),
  },
};

/**
 * motion → grip → 포즈 묶음. motion 7종(slashR · slashL · slashUp · overhead · thrust · spin · sweep) × grip 3종.
 * 창에 없는 조합은 양손 포즈를 쓴다(가까운 것).
 * @type {Record<string, Record<string, PoseSet>>}
 */
export const MOTIONS = {};
for (const m of ['slashR', 'slashL', 'slashUp', 'overhead', 'thrust', 'spin', 'sweep']) {
  MOTIONS[m] = { oneHand: ONE[m], twoHand: TWO[m], polearm: POLE[m] ?? TWO[m] };
}

// ───────────────────────── 상태 포즈 ─────────────────────────
const TUCK = D({ spine: [48, 0, 0], chest: [36, 0, 0], head: [34, 0, 0],
  hipL: [-118, 0, 8], kneeL: [128, 0, 0], hipR: [-112, 0, -8], kneeR: [122, 0, 0],
  shoulderL: [-56, 0, 24], elbowL: [-112, 0, 0], shoulderR: [-30, 0, -50], elbowR: [-104, 0, 0], handR: [70, 0, 0] },
{ hips: [0, -0.5, 0] });
const HOP = D({ spine: [10, 0, 0], chest: [4, 0, 0], head: [-10, 0, 0],
  hipL: [-44, 0, 6], kneeL: [70, 0, 0], hipR: [-14, 0, -6], kneeR: [52, 0, 0],
  shoulderL: [-30, 0, 30], elbowL: [-50, 0, 0], shoulderR: [-20, 0, -34], elbowR: [-60, 0, 0], handR: [30, 0, 0] });
const LAND = D({ spine: [22, 0, 0], chest: [8, 0, 0], head: [-18, 0, 0],
  hipL: [-56, 0, 8], kneeL: [84, 0, 0], hipR: [-30, 0, -8], kneeR: [84, 0, 0],
  shoulderL: [-20, 0, 24], elbowL: [-60, 0, 0], shoulderR: [-10, 0, -30], elbowR: [-70, 0, 0], handR: [40, 0, 0] });
/** 패링: 무기를 바깥(오른쪽 위)으로 쳐낸 자세 */
const PARRY = D({ hips: [0, -26, 0], spine: [-4, -14, 0], chest: [-6, -14, 0], head: [2, 34, 0],
  shoulderR: [-70, -40, -70], elbowR: [-40, 0, 0], handR: [-10, 0, 0],
  shoulderL: [-10, 0, 30], elbowL: [-50, 0, 0], ...LEGS_READY });
const GUARD_BREAK = D({ spine: [-22, 0, 0], chest: [-14, 0, 0], head: [-16, 0, 0],
  shoulderR: [-30, -30, -86], elbowR: [-30, 0, 0], handR: [40, 0, 0],
  shoulderL: [-30, 30, 86], elbowL: [-30, 0, 0],
  hipL: [-34, 0, 8], kneeL: [30, 0, 0], hipR: [22, 0, -10], kneeR: [50, 0, 0] }, { hips: [0, -0.04, -0.08] });
/** 플라스크: 왼손을 입으로, 고개를 젖힌다(오른팔 · 무기는 그 무기의 대기 자세 그대로) */
const FLASK = {};
for (const g of ['oneHand', 'twoHand', 'polearm']) {
  FLASK[g] = V(STANCE[g].idle, { spine: [-6, 0, 0], chest: [-6, 0, 0], head: [-26, 0, 0],
    shoulderL: [-96, -22, 14], elbowL: [-136, 0, 0] });
}
/** 누운 자세(등) — 머리가 뒤, 발이 앞 */
const DOWN = D({ hips: [-90, 0, 0], spine: [6, 0, 0], head: [8, 0, 0],
  shoulderL: [-20, 0, 74], elbowL: [-30, 0, 0], shoulderR: [-20, 0, -66], elbowR: [-24, 0, 0], handR: [92, 0, 0],
  hipL: [-18, 0, 12], kneeL: [34, 0, 0], hipR: [-4, 0, -12], kneeR: [10, 0, 0] }, { hips: [0, -0.8, -0.3] });
const DOWN_AIR = D({ hips: [-50, 0, 0], spine: [-14, 0, 0], chest: [-8, 0, 0], head: [20, 0, 0],
  shoulderL: [-70, 0, 60], elbowL: [-30, 0, 0], shoulderR: [-70, 0, -60], elbowR: [-30, 0, 0],
  hipL: [-60, 0, 10], kneeL: [50, 0, 0], hipR: [-40, 0, -10], kneeR: [70, 0, 0] }, { hips: [0, -0.3, -0.12] });
const KNEEL_UP = D({ hips: [10, 0, 0], spine: [26, 0, 0], chest: [10, 0, 0], head: [-10, 0, 0],
  shoulderL: [-30, 0, 20], elbowL: [-70, 0, 0], shoulderR: [-10, 0, -24], elbowR: [-50, 0, 0], handR: [60, 0, 0],
  hipL: [-96, 0, 6], kneeL: [100, 0, 0], hipR: [-10, 0, -6], kneeR: [112, 0, 0] }, { hips: [0, -0.46, -0.06] });
const DEAD_KNEEL = D({ hips: [6, 0, 0], spine: [30, 4, 0], chest: [18, 0, 0], head: [34, 0, 6],
  shoulderL: [6, 0, 10], elbowL: [-10, 0, 0], shoulderR: [10, 0, -12], elbowR: [-8, 0, 0], handR: [80, 0, 0],
  hipL: [-14, 0, 8], kneeL: [118, 0, 0], hipR: [-8, 0, -8], kneeR: [114, 0, 0] }, { hips: [0, -0.5, 0] });
const DEAD_FLAT = D({ hips: [84, 0, 0], spine: [4, 0, 6], chest: [2, 0, 0], head: [-10, 50, 0],
  shoulderL: [-150, 0, 40], elbowL: [-40, 0, 0], shoulderR: [-20, 0, -50], elbowR: [-30, 0, 0], handR: [95, 0, 0],
  hipL: [8, 0, 12], kneeL: [14, 0, 0], hipR: [0, 0, -8], kneeR: [30, 0, 0] }, { hips: [0, -0.8, 0.2] });
/** 처형: 깊이 당김 → 꿰뚫음 → 뽑아 듦 */
const EXEC = {
  windup: D({ hips: [0, -46, 0], spine: [-4, -20, 0], chest: [-4, -18, 0], head: [0, 70, 0],
    shoulderR: [64, 0, -26], elbowR: [-124, 0, 0], handR: [60, 0, 0],
    shoulderL: [-80, 34, 6], elbowL: [-10, 0, 0], ...LEGS_COIL }, { hips: [0, -0.06, 0] }),
  active: D({ hips: [0, 30, 0], spine: [24, 16, 0], chest: [10, 14, 0], head: [-22, -46, 0],
    shoulderR: [-82, 18, -6], elbowR: [-2, 0, 0], handR: [62, 0, 0],
    shoulderL: [50, 0, 30], elbowL: [-60, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.08, 0] }),
  follow: D({ hips: [0, -10, 0], spine: [-6, -6, 0], chest: [-6, -4, 0], head: [6, 12, 0],
    shoulderR: [20, 0, -30], elbowR: [-70, 0, 0], handR: [80, 0, 0],
    shoulderL: [-10, 0, 20], elbowL: [-40, 0, 0], ...LEGS_READY }),
};

/** grip별 처형 포즈 — 양손 무기는 그 무기의 찌르기를 쓴다(왼손이 자루에 붙은 채) */
const EXEC_BY_GRIP = {
  oneHand: EXEC,
  twoHand: { windup: TWO.thrust.windup, active: TWO.thrust.active, follow: STANCE.twoHand.combat },
  polearm: { windup: POLE.thrust.windup, active: POLE.thrust.active, follow: STANCE.polearm.combat },
};

/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @param {number} a @param {number} b @param {number} v */
const ramp = (a, b, v) => clamp01((v - a) / (b - a));

export class PlayerView {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.rig = buildHumanoidRig({ height: PLAYER.height, bulk: 1, palette: PALETTE.player, helmet: 'knight', cape: true });
    this.root.add(this.rig.root);
    this.blender = new PoseBlender(this.rig, HL_DEFAULT);

    /** @type {import('./weaponMeshes.js').WeaponMesh|null} */
    this._weapon = null;
    this._weaponId = '';
    this._grip = 'oneHand';

    // 플라스크(왼손) — flask 상태에서만 보인다
    this._flaskGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6);
    this._flaskMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, emissive: FLASK_COLOR, emissiveIntensity: 2.2, roughness: 0.4 });
    this._flask = new THREE.Mesh(this._flaskGeo, this._flaskMat);
    this._flask.position.set(0, -0.02, 0.05);
    this._flask.visible = false;
    this.rig.sockets.handL.add(this._flask);

    this._pose = emptyPose();
    this._gait = 0;       // 걸음 사이클
    this._amp = 0;        // 걸음 진폭(부드럽게)
    this._ik = 0;         // 왼손 IK 가중치
    this._ground = 1;     // 발 붙이기 가중치(부드럽게)
    this._time = 0;       // 호흡 · 망토 위상(렌더 시간)
    this.setWeapon('longsword');
  }

  /** 무기 메시를 바꾼다(같은 id면 아무것도 안 한다). @param {string} weaponId */
  setWeapon(weaponId) {
    if (weaponId === this._weaponId) return;
    const def = getWeaponDef(/** @type {any} */ (weaponId));
    if (!def && this._weapon) return;
    if (this._weapon) this._weapon.dispose();
    this._weaponId = weaponId;
    this._grip = STANCE[def?.grip] ? def.grip : 'oneHand';
    const w = createWeaponMesh(/** @type {any} */ (weaponId));
    this._weapon = w;
    const s = this.rig.sockets;
    s.weapon.add(w.object);
    s.weaponBase.position.y = w.base;
    s.weaponTip.position.y = w.tip;
    s.gripL.position.y = w.gripL;
  }

  /** 왼손 자리를 자루를 따라 민다 — 왼 어깨 앞 편한 곳에 가장 가까운 점(무기별 범위 안). */
  _slideGrip() {
    const w = this._weapon;
    if (!w || !(w.gripMax > w.gripMin)) return;
    const sh = this.rig.joints.shoulderL;
    const sock = this.rig.sockets.weapon;
    sh.parent.updateWorldMatrix(true, false);
    sock.updateWorldMatrix(true, false);
    _v.set(sh.position.x + GRIP_COMFORT[0] * U, sh.position.y + GRIP_COMFORT[1] * U, sh.position.z + GRIP_COMFORT[2] * U);
    sock.worldToLocal(sh.parent.localToWorld(_v));
    this.rig.sockets.gripL.position.y = Math.min(w.gripMax, Math.max(w.gripMin, _v.y));
  }

  /**
   * @param {PlayerState} p
   * @param {{alpha:number, dt:number, time:number, state:GameState}} info
   */
  update(p, info) {
    const dt = info.dt;
    // 히트스톱 동안 sim이 멈춘다 — 걸음 위상도 멈춘다(호흡 · 망토 · 블렌딩은 렌더 시간으로 계속)
    const simDt = info.state && info.state.hitstop > 0 ? 0 : dt;
    this._time += dt;
    this.setWeapon(p.stats.weaponId);

    const st = STANCE[this._grip];
    const stanceKey = p.lockOn ? 'combat' : 'idle';
    const stance = st[stanceKey];
    const pose = this._pose;
    const t = p.stateTime;
    const prog = p.stateDur > 0 ? clamp01(t / p.stateDur) : 0;

    // 로컬 속도(앞 · 오른쪽)
    const sn = Math.sin(p.facing);
    const cs = Math.cos(p.facing);
    const vf = p.vel.x * sn + p.vel.z * cs;
    const vs = -p.vel.x * cs + p.vel.z * sn;
    const speed = Math.hypot(p.vel.x, p.vel.z);

    let halfLife = HL_DEFAULT;
    let ik = st.ik[stanceKey];
    let ground = 1;
    let gaitAmp = 0;
    let armAmp = 1;
    let spin = 0;       // hips에 덧붙이는 회전(구르기 rx · 회전 베기 ry)
    let spinAxis = 0;   // 0 = x, 1 = y
    let flask = false;

    switch (p.state) {
      case 'move': {
        const k = clamp01(speed / PLAYER.move.walkSpeed);
        if (p.lockOn && !p.sprinting) copyPose(stance, pose);
        else { lerpPose(stance, p.sprinting ? st.run : st.walk ?? st.run, k, pose); ik *= 1 - k; }
        gaitAmp = Math.max(k, 0.01);
        armAmp = p.lockOn && !p.sprinting ? 0.3 : 1;
        halfLife = HL_MOVE;
        break;
      }
      case 'roll': {
        const tuck = Math.min(ramp(0, 0.14, prog), 1 - ramp(0.62, 0.98, prog));
        lerpPose(stance, TUCK, ease.outQuad(tuck), pose);
        spin = TAU * ease.inOutQuad(ramp(0.02, ROLL_SPIN_END, prog));
        ground = 1 - clamp01(tuck * 3);
        ik = 0;
        halfLife = HL_HURT;
        break;
      }
      case 'backstep': {
        const air = Math.sin(Math.PI * ramp(0.06, 0.7, prog));
        if (prog < 0.7) lerpPose(stance, HOP, ease.outQuad(ramp(0, 0.25, prog)), pose);
        else lerpPose(LAND, stance, ease.inOutQuad(ramp(0.8, 1, prog)), pose);
        addPos(pose, 'hips', 0, HOP_HEIGHT * U * air, 0);
        addRot(pose, 'spine', 0.2 * air, 0, 0);
        ground = prog < 0.7 ? 1 - clamp01(air * 4) : 1;
        halfLife = HL_HURT;
        break;
      }
      case 'attack': {
        const a = p.attack;
        const byGrip = a ? MOTIONS[a.motion] ?? MOTIONS.slashR : MOTIONS.slashR;
        const set = byGrip[this._grip] ?? byGrip.oneHand;
        // 판정은 active의 첫 틱(phaseT 0)에 나고 곧바로 히트스톱이 걸린다 — 그 순간의 포즈가 예고 자세 그대로면
        // 「칼이 아직 뒤에 있는데 스파크가 튀는」 몇 프레임이 생긴다. active는 휘두르기의 중간(닿는 자리)에서 시작한다.
        const pT = a ? (a.phase === 'active' ? Math.max(a.phaseT, ACTIVE_CONTACT_T) : a.phaseT) : 1;
        attackPose(set, st.combat, a ? a.phase : 'recovery', pT, pose, 0);
        ik = st.ik.attack;
        if (a && a.motion === 'spin') {
          spinAxis = 1;
          if (a.phase === 'active') spin = TAU * ease.outQuad(clamp01(a.phaseT));
        }
        halfLife = HL_ATTACK;
        break;
      }
      case 'guard':
      case 'guardHit': {
        copyPose(st.guard, pose);
        ik = st.ik.guard;
        if (p.parryActive) {
          lerpPose(pose, PARRY, 0.4, pose);
          halfLife = HL_ATTACK;
        }
        if (p.state === 'guardHit') {
          const e = (1 - prog) * (1 - prog);
          addRot(pose, 'spine', -0.3 * e, 0, 0);
          addRot(pose, 'chest', -0.16 * e, 0, 0);
          addRot(pose, 'shoulderR', 0.3 * e, 0, 0);
          addRot(pose, 'elbowR', -0.4 * e, 0, 0);
          addPos(pose, 'hips', 0, -0.04 * U * e, -0.1 * U * e);
          halfLife = HL_HURT;
        } else {
          gaitAmp = clamp01(speed / PLAYER.move.walkSpeed);
          armAmp = 0;
        }
        break;
      }
      case 'parry': {
        const k = ease.outCubic(ramp(0, 0.25, prog)) * (1 - ease.inOutQuad(ramp(0.55, 1, prog)));
        lerpPose(st.guard, PARRY, k, pose);
        ik = st.ik.guard * (1 - k);
        halfLife = HL_ATTACK;
        break;
      }
      case 'guardBreak': {
        const k = ease.outCubic(ramp(0, 0.12, prog)) * (1 - ease.inOutQuad(ramp(0.7, 1, prog)));
        lerpPose(stance, GUARD_BREAK, k, pose);
        addRot(pose, 'spine', 0, 0, 0.06 * Math.sin(t * 9) * k);
        ik *= 1 - k;
        halfLife = HL_HURT;
        break;
      }
      case 'flask': {
        const k = ease.inOutQuad(ramp(0, 0.22, prog)) * (1 - ease.inOutQuad(ramp(0.78, 1, prog)));
        lerpPose(st.idle, FLASK[this._grip], k, pose);
        ik = 0;
        flask = k > 0.3;
        gaitAmp = clamp01(speed / PLAYER.move.walkSpeed);
        armAmp = 0;
        break;
      }
      case 'stagger': {
        copyPose(stance, pose);
        // 상체는 밀려나는 방향(knockVel)의 반대로 꺾인다 — 발이 먼저 밀리고 몸이 늦게 따라온다
        const kl = Math.hypot(p.knockVel.x, p.knockVel.z);
        let kf = -1;
        let ks = 0;
        if (kl > 0.05) {
          kf = (p.knockVel.x * sn + p.knockVel.z * cs) / kl;
          ks = (-p.knockVel.x * cs + p.knockVel.z * sn) / kl;
        }
        const e = ramp(0, 0.14, prog) * (1 - prog) * (1 - prog) * 1.6;
        addRot(pose, 'spine', -0.55 * kf * e, 0, -0.45 * ks * e);
        addRot(pose, 'chest', -0.3 * kf * e, 0, -0.2 * ks * e);
        addRot(pose, 'head', 0.4 * kf * e, 0, 0);
        addRot(pose, 'shoulderL', -0.3 * e, 0, 0.7 * e);
        addRot(pose, 'shoulderR', 0.2 * e, 0, -0.5 * e);
        addRot(pose, 'hipL', -0.25 * e, 0, 0);
        addRot(pose, 'kneeL', 0.5 * e, 0, 0);
        addRot(pose, 'kneeR', 0.3 * e, 0, 0);
        ik *= 1 - clamp01(e * 2);
        halfLife = HL_HURT;
        break;
      }
      case 'knockdown': {
        if (prog < 0.16) lerpPose(stance, DOWN_AIR, ease.outQuad(prog / 0.16), pose);
        else lerpPose(DOWN_AIR, DOWN, ease.outCubic(ramp(0.16, 0.36, prog)), pose);
        ground = 0;
        ik = 0;
        halfLife = HL_HURT;
        break;
      }
      case 'getup': {
        if (prog < 0.5) lerpPose(DOWN, KNEEL_UP, ease.inOutQuad(prog / 0.5), pose);
        else lerpPose(KNEEL_UP, stance, ease.inOutQuad(ramp(0.5, 1, prog)), pose);
        ground = ramp(0.35, 0.6, prog);
        ik *= ramp(0.7, 1, prog);
        break;
      }
      case 'execute': {
        const hitAt = PLAYER.execute.hitAt;
        const ex = EXEC_BY_GRIP[this._grip];
        // 찌르기는 타격 시각(hitAt)에 **끝난다** — 타격 틱에 걸리는 히트스톱이 칼이 꽂힌 자세에서 멈춘다
        // (타격 시각에 찌르기를 시작하면 히트스톱 동안 칼이 아직 당겨진 채다).
        const stabFrom = hitAt - EXEC_STAB;
        if (t < stabFrom) {
          lerpPose(st.combat, ex.windup, ease.outCubic(ramp(0, stabFrom * 0.6, t)), pose);
        } else if (t < hitAt + EXEC_HOLD) {
          lerpPose(ex.windup, ex.active, ease.outQuint(ramp(stabFrom, hitAt, t)), pose);
          if (t >= hitAt) addRot(pose, 'handR', 0, 0, 0.05 * Math.sin(t * 60));
        } else {
          const t2 = hitAt + EXEC_HOLD;
          if (t < t2 + EXEC_PULL) lerpPose(ex.active, ex.follow, ease.outCubic(ramp(t2, t2 + EXEC_PULL, t)), pose);
          else lerpPose(ex.follow, stance, ease.inOutQuad(ramp(t2 + EXEC_PULL, Math.max(t2 + EXEC_PULL + 0.1, PLAYER.execute.dur), t)), pose);
        }
        ik = st.ik.attack;
        halfLife = HL_ATTACK;
        break;
      }
      case 'dead': {
        const k = clamp01(t / PLAYER.deadPoseDur);
        if (k < 0.42) lerpPose(stance, DEAD_KNEEL, ease.inOutQuad(k / 0.42), pose);
        else lerpPose(DEAD_KNEEL, DEAD_FLAT, ease.inQuad(ramp(0.5, 1, k)), pose);
        ground = 1 - ramp(0.1, 0.4, k);
        ik = 0;
        break;
      }
      default: { // idle
        copyPose(stance, pose);
        break;
      }
    }

    // 걸음: 위상은 이동 거리로 나아간다(보폭 = 발소리 간격). 진폭은 부드럽게 따라간다.
    // 느린 걸음(가드 · 플라스크)은 보폭을 절반으로 — 발소리 한 번에 두 걸음, 작은 걸음으로 미끄러지지 않게.
    const slow = speed < SLOW_GAIT * PLAYER.move.walkSpeed;
    if (gaitAmp > 0 && slow) gaitAmp = 0.5 * clamp01(speed / (0.3 * PLAYER.move.walkSpeed));
    const kAmp = 1 - Math.exp(-SPEED_LAMBDA * dt);
    this._amp += (gaitAmp - this._amp) * kAmp;
    if (this._amp > 0.01) {
      const stride = (p.sprinting ? PLAYER.move.strideSprint : PLAYER.move.strideWalk) * (slow ? 0.5 : 1);
      this._gait = (this._gait + (speed * simDt) / (2 * stride)) % 1;
      const inv = speed > 0.05 ? 1 / speed : 0;
      applyGait(pose, this._gait, this._amp, clamp01(Math.abs(vf * inv)) * Math.sign(vf), Math.max(-1, Math.min(1, vs * inv)),
        p.sprinting ? 1 : 0, armAmp);
    }

    // 호흡(살아 있을 때만)
    if (p.state !== 'dead') {
      const b = Math.sin(this._time * BREATH_RATE);
      addRot(pose, 'chest', 0.018 * b, 0, 0);
      addRot(pose, 'shoulderL', 0, 0, 0.012 * b);
      addRot(pose, 'shoulderR', 0, 0, -0.012 * b);
      addRot(pose, 'head', -0.012 * b, 0, 0);
    }

    // 상태가 바뀐 프레임의 큰 도약(구르기 끝 · 넘어짐)은 블렌더가 받아 준다
    this.blender.update(pose, dt, halfLife);

    // ── 블렌더 뒤에 얹는 것: 한 바퀴 회전(2π에서 0으로 돌아가도 화면은 그대로) · 발 붙이기 · 왼손 IK ──
    const hips = this.rig.joints.hips;
    if (spin !== 0) {
      if (spinAxis === 0) hips.rotation.x += spin;
      else hips.rotation.y += spin;
    }
    this._ground += (ground - this._ground) * (1 - Math.exp(-GROUND_LAMBDA * dt));
    this.rig.groundFeet(this._ground);
    this._ik += (ik - this._ik) * (1 - Math.exp(-IK_LAMBDA * dt));
    if (this._ik > 0.01) {
      this._slideGrip();
      this.rig.ikLeftHand(this.rig.sockets.gripL, this._ik);
    }

    this._flask.visible = flask;
    if (this.rig.cape) {
      const bp = this.blender.pose.rot;
      const lean = (bp.hips ? bp.hips[0] : 0) + (bp.spine ? bp.spine[0] : 0) + (bp.chest ? bp.chest[0] : 0) + (spinAxis === 0 ? spin : 0);
      this.rig.cape.update(dt, this._time, lean, vf / PLAYER.move.walkSpeed, vs / PLAYER.move.walkSpeed);
    }
  }

  dispose() {
    if (this._weapon) this._weapon.dispose();
    this._weapon = null;
    this._flaskGeo.dispose();
    this._flaskMat.dispose();
    this.rig.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

/** @returns {PlayerView} */
export function createPlayerView() {
  return new PlayerView();
}
