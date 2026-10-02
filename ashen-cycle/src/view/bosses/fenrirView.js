// OWNER: P10 — 계약 §9.6 (보스 뷰) · §8.11
// 서리 송곳니 펜리르: 사족 리그(거대 늑대) · pose 8종 + 상태 10종. 낮게 깐 머리 · 솟은 어깨와 얼음 결정 갈기 · 푸른 눈과 입김.
//
// 만드는 법:
//   - 포즈 표는 **몸**(hips · spine · chest · neck · head · jaw · tail1~3)만 적는다(도 °, 위치 m). 다리는 적지 않는다 —
//     네 발의 **목표 위치**(리그 root 로컬 · rest 발 자리에서의 오프셋)를 가짜 관절 `ikFL · ikFR · ikBL · ikBR`의 pos로 적고,
//     블렌더가 몸과 함께 보간한 뒤 2관절 IK가 다리를 푼다(웅크려도 · 덤벼도 발이 땅에 붙는다). rot[0]은 발바닥의 숙임 각.
//   - 가짜 관절 `swing`의 rot[1]은 「가슴을 축으로 엉덩이를 옆으로 돌리는 각」이다(꼬리 쓸기 — 뒷발이 따라간다).
//   - 걸음은 표가 아니라 속도에서 만든다: 틱 이동량(선속도 + 각속도)으로 발마다의 지면 속도를 구해, 디딘 발이 미끄러지지 않는
//     보폭으로 속보(대각 짝) ↔ 질주(뒷발 짝 → 앞발 짝)를 돈다. 제자리 회전도 같은 식으로 발을 옮긴다.
//   - 도약 · 백홉의 공중 자세는 표현용 높이(boss.y)로 섞는다.
// 보이는 몸 = 맞는 몸: 리그 길이를 bodyParts가 덮는 범위(앞 2.9m ~ 뒤 2.7m)에서 구한다.
import * as THREE from 'three';
import { DT } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { angleDiff, angleOf } from '../../core/math2d.js';
import { FENRIR } from '../../data/bosses/fenrir.js';
import { COMBAT } from '../../data/combat.js';
import { PALETTE } from '../../data/palette.js';
import { buildQuadrupedRig } from '../characters/rig.js';
import { PartBuilder, ball, box, cone, place } from '../characters/geo.js';
import { ease, emptyPose, poseDeg, lerpPose, copyPose, addRot, addPos, attackPose, bossReleaseT, PoseBlender } from '../characters/pose.js';

/** @typedef {import('../../types.js').BossView} BossView */
/** @typedef {import('../../types.js').BossState} BossState */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').PoseSet} PoseSet */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ── 연출 상수 ──
const HL_DEFAULT = 0.07;         // 포즈 블렌더 반감기(초) — 무거운 몸
const HL_ATTACK = 0.015;         // 공격 중(§9.5 — 화면의 몸이 sim 판정보다 늦지 않게)
const HL_HURT = 0.035;
const BREATH_RATE = 2.6;         // 숨(rad/s)
const PANT_RATE = 9.5;           // 헐떡임(rad/s — 그로기 · 브레스 뒤)
const ROAR_AT_INTRO = 0.5;       // 초(§9.6)
const ROAR_AT_SHIFT = 0.6;
const ROAR_LEN_INTRO = 0.75;     // 포효를 버티는 시간(초)
const ROAR_LEN_SHIFT = 1.3;
const DEATH_FADE_FROM = 0.45;    // 사망 진행도 이 지점부터 흩어진다
const DEATH_SINK = 0.5;          // 가라앉는 깊이(m)
const PHASE2_BOOST = 1.0;        // 2페이즈: 강조 재질 발광 (1 + 이 값)배
const LOOK_MAX = 0.75;           // 고개로 플레이어를 따라보는 최대 각(rad)
const LOOK_LAMBDA = 7;
const AIR_FULL = 0.7;            // 표현용 높이가 이만큼이면 공중 자세가 다 섞인다(m)
const AIR_VY_REF = 10;           // 수직 속도 이만큼에서 몸 기울기가 최대(m/s)
const FLINCH_DUR = 0.2;          // 피격 움찔(초)
const FLINCH_AMP = 0.07;         // rad
const SWING_LIFT_K = 0.045;      // 엉덩이를 돌릴 때 뒷발이 뜨는 높이 = |각속도| × 이 값(m)
const SWING_LIFT_MAX = 0.4;

// 걸음(속보 ↔ 질주)
const GAIT_SMOOTH = 14;          // 속도 추종(1/초)
const GAIT_AMP_LAMBDA = 10;
const GAIT_MIN_SPEED = 0.25;     // 이보다 느리면 발을 떼지 않는다(m/s)
const GAIT_FULL_SPEED = 1.2;
const GAIT_SPEED_CAP = 30;       // 순간 이동 같은 튐을 자른다(m/s)
const RUN_FROM = 3.8;            // 몸 속력이 이 구간을 지나며 속보 → 질주
const RUN_TO = 5.0;
const LC_TROT = 2.4;             // 한 사이클에 가는 거리(m)
const LC_GALLOP = 4.8;
const DUTY_TROT = 0.55;          // 발이 땅에 붙어 있는 비율
const DUTY_GALLOP = 0.34;
const GAIT_F_MAX = 3.2;          // 사이클 진동수 상한(Hz) — 넘는 만큼은 미끄러진다
const STRIDE_MAX = 1.45;         // 발 하나의 보폭 상한(m) — 다리 길이
const LIFT_TROT = 0.3;           // 발을 드는 높이(m)
const LIFT_GALLOP = 0.55;
/** 사이클 위상: [속보, 질주] — 속보는 대각 짝, 질주는 뒷발 짝 → 앞발 짝 */
const GAIT_OFFSETS = { FL: [0, 0.5], FR: [0.5, 0.62], BL: [0.5, 1.0], BR: [0, 0.12] };

// 얼음 결정(2페이즈에 터져 자란다) · 입 앞의 냉기 구슬 · 입김
const GROW_LAMBDA = 9;
const MAW_COLOR = PALETTE.style.frost.core;
const MAW_GAIN = 3.2;            // 입 앞 냉기 구슬의 HDR 배율(블룸에 걸린다)
const MAW_RADIUS = 0.17;         // m
const PUFF_COUNT = 12;
const PUFF_LIFE = 1.1;           // 초
const PUFF_SIZE0 = 0.28;         // m
const PUFF_SIZE1 = 1.1;
const PUFF_OPACITY = 0.22;
/** 리그의 이빨 · 발톱 재질 색(rig.js의 bone) — 덧붙이는 발톱이 같은 재질을 쓴다 */
const BONE_COLOR = 0xd8d2c4;

const LEG_KEYS = ['FL', 'FR', 'BL', 'BR'];
const IK_KEYS = { FL: 'ikFL', FR: 'ikFR', BL: 'ikBL', BR: 'ikBR' };
/** 다리를 다 펴거나 다 접지 않게 하는 한계(두 마디 길이 합의 비율) */
const REACH_MAX = 0.998;
const REACH_MIN = 0.36;

/** 몸길이: bodyParts가 덮는 범위(§8.11 — 앞 2.9m ~ 뒤 2.7m = 5.6m) */
const BODY_LENGTH = (() => {
  const parts = FENRIR.bodyParts ?? [{ fwd: 0, r: FENRIR.radius }];
  let front = -Infinity;
  let back = Infinity;
  for (const p of parts) {
    front = Math.max(front, p.fwd + p.r);
    back = Math.min(back, p.fwd - p.r);
  }
  return front - back;
})();

/**
 * 포즈 표 한 줄. rot: 관절 → [rx, ry, rz](도), pos: 관절 → [x, y, z](m),
 * feet: {FL|FR|BL|BR: [왼쪽, 위, 앞, (발바닥 숙임 °)]} — rest 발 자리에서의 오프셋(리그 root 로컬).
 * @param {Record<string, number[]>} rot
 * @param {Record<string, number[]>} [pos]
 * @param {Record<string, number[]>} [feet]
 * @returns {Pose}
 */
function Q(rot, pos, feet) {
  const p = poseDeg(rot, pos);
  if (feet) {
    for (const k of LEG_KEYS) {
      const f = feet[k];
      if (!f) continue;
      p.pos[IK_KEYS[k]] = [f[0], f[1], f[2]];
      if (f[3]) p.rot[IK_KEYS[k]] = [f[3] * DEG, 0, 0];
    }
  }
  return p;
}

// ── 꼬리 묶음 ──
const TAIL_LOW = { tail1: [-16, 0, 0], tail2: [-8, 0, 0], tail3: [16, 0, 0] };
const TAIL_UP = { tail1: [44, 0, 0], tail2: [20, 0, 0], tail3: [12, 0, 0] };
const TAIL_OUT = { tail1: [16, 0, 0], tail2: [6, 0, 0], tail3: [4, 0, 0] };
const TAIL_TUCK = { tail1: [-40, 0, 0], tail2: [-25, 0, 0], tail3: [-15, 0, 0] };

/** 대기: 머리를 어깨 아래로 낮게 깔고 노려본다 — 솟은 어깨와 갈기가 가장 높다 */
const IDLE = Q({ hips: [4, 0, 0], spine: [-2, 0, 0], chest: [3, 0, 0], neck: [34, 0, 0], head: [-20, 0, 0], jaw: [4, 0, 0], ...TAIL_LOW },
  { hips: [0, -0.14, 0] },
  { FL: [0.12, 0, 0.05], FR: [-0.12, 0, 0.05], BL: [0.06, 0, 0], BR: [-0.06, 0, 0] });

/** 달릴 때의 몸: 낮고 길게 — 머리를 앞으로 뻗고 꼬리를 뒤로 뺀다 */
const RUN = Q({ hips: [3, 0, 0], spine: [-1, 0, 0], chest: [2, 0, 0], neck: [26, 0, 0], head: [-24, 0, 0], jaw: [8, 0, 0], ...TAIL_OUT },
  { hips: [0, -0.3, 0.1] },
  { FL: [0.08, 0, 0.1], FR: [-0.08, 0, 0.1], BL: [0.04, 0, 0], BR: [-0.04, 0, 0] });

/**
 * pose 키 → 포즈 묶음(§8.11의 8종). 예고 = 실루엣으로 읽히는 준비 자세, 판정 = 반대편 끝까지 뻗은 자세, 후딜 = 처진 자세.
 * @type {Record<string, PoseSet>}
 */
export const FENRIR_POSES = {
  // 물기: 목을 세워 뒤로 당겼다가(뒷다리에 실린다) 앞-아래로 내리꽂는다. 입은 출발 구간에 벌어져 판정에 닫힌다(update)
  bite: {
    holdAt: 0.5,
    windup: Q({ hips: [-7, 0, 0], spine: [9, 0, 0], chest: [-8, 0, 0], neck: [-30, 0, 0], head: [36, 0, 0], jaw: [8, 0, 0], ...TAIL_UP },
      { hips: [0, -0.32, -0.5] },
      { FL: [0.12, 0, 0.05], FR: [-0.12, 0, 0.05], BL: [0.1, 0, 0.15], BR: [-0.1, 0, 0.15] }),
    active: Q({ hips: [9, 0, 0], spine: [-5, 0, 0], chest: [5, 0, 0], neck: [30, 0, 0], head: [-18, 0, 0], jaw: [0, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.3, 0.55] },
      { FL: [0.14, 0, 0.55], FR: [-0.14, 0, 0.55], BL: [0.08, 0, -0.45], BR: [-0.08, 0, -0.45] }),
    follow: Q({ hips: [10, 0, 0], spine: [-4, 0, 0], chest: [5, 0, 0], neck: [38, 8, 0], head: [-14, 6, 0], jaw: [6, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.34, 0.45] },
      { FL: [0.14, 0, 0.55], FR: [-0.14, 0, 0.55], BL: [0.08, 0, -0.4], BR: [-0.08, 0, -0.4] }),
  },
  // 앞발 할퀴기: 뒷다리로 일어서며 오른 앞발을 높이 쳐들었다가 왼쪽 아래로 크게 긁는다
  claw: {
    windup: Q({ hips: [-13, 0, 0], spine: [4, -6, 0], chest: [-2, -18, -8], neck: [30, 12, 0], head: [-8, 10, 0], jaw: [10, 0, 0],
      ...TAIL_OUT, tail1: [16, -18, 0] },
      { hips: [0, -0.68, -0.3] },
      { FR: [-0.95, 2.5, 0.2, -70], FL: [0.2, 0, 0.1], BL: [0.12, 0, 0.1], BR: [-0.12, 0, 0.1] }),
    active: Q({ hips: [8, 0, 0], spine: [0, 8, 0], chest: [4, 22, 8], neck: [28, -10, 0], head: [-12, -8, 0], jaw: [6, 0, 0],
      ...TAIL_OUT, tail1: [16, 20, 0] },
      { hips: [0, -0.38, 0.35] },
      { FR: [0.95, 0.3, 1.15, 30], FL: [0.25, 0, -0.05], BL: [0.1, 0, -0.25], BR: [-0.1, 0, -0.25] }),
    follow: Q({ hips: [10, 0, 0], spine: [0, 6, 0], chest: [6, 18, 6], neck: [30, -8, 0], head: [-10, -6, 0], jaw: [8, 0, 0],
      ...TAIL_OUT, tail1: [16, 12, 0] },
      { hips: [0, -0.45, 0.3] },
      { FR: [0.75, 0, 0.9], FL: [0.25, 0, -0.05], BL: [0.1, 0, -0.25], BR: [-0.1, 0, -0.25] }),
  },
  // 꼬리 쓸기: 엉덩이를 오른쪽으로 감고 꼬리를 치켜세운 채 어깨 너머로 돌아본다 → 엉덩이째 왼쪽으로 휘두른다
  tail: {
    windup: Q({ swing: [0, 32, 0], hips: [2, 0, 0], neck: [20, -42, 0], head: [-10, -34, 0], jaw: [10, 0, 0],
      tail1: [52, 24, 0], tail2: [26, 14, 0], tail3: [18, 10, 0] },
      { hips: [0, -0.3, 0] },
      { FL: [0.2, 0, 0], FR: [-0.2, 0, 0] }),
    active: Q({ swing: [0, -78, 0], hips: [4, 0, 0], neck: [26, 18, 0], head: [-14, 10, 0], jaw: [12, 0, 0],
      tail1: [10, -34, 0], tail2: [4, -22, 0], tail3: [2, -16, 0] },
      { hips: [0, -0.38, 0] },
      { FL: [0.3, 0, 0.1], FR: [-0.1, 0, -0.1] }),
    follow: Q({ swing: [0, -62, 0], hips: [4, 0, 0], neck: [30, 10, 0], head: [-14, 6, 0], jaw: [8, 0, 0],
      tail1: [-4, -20, 0], tail2: [-4, -12, 0], tail3: [6, -8, 0] },
      { hips: [0, -0.36, 0] },
      { FL: [0.3, 0, 0.1], FR: [-0.1, 0, -0.1] }),
  },
  // 돌진: 가슴을 땅에 붙이고 엉덩이를 든 채 앞발로 땅을 긁는다 → 낮고 길게 내달린다(다리는 질주 사이클) → 앞발로 버티며 멈춘다
  charge: {
    windup: Q({ hips: [15, 0, 0], spine: [-4, 0, 0], chest: [-2, 0, 0], neck: [48, 0, 0], head: [-50, 0, 0], jaw: [12, 0, 0], ...TAIL_UP },
      { hips: [0, -0.1, -0.4] },
      { FL: [0.2, 0, 0.4], FR: [-0.2, 0, 0.4], BL: [0.1, 0, -0.1], BR: [-0.1, 0, -0.1] }),
    active: Q({ hips: [5, 0, 0], spine: [-2, 0, 0], chest: [2, 0, 0], neck: [30, 0, 0], head: [-30, 0, 0], jaw: [16, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.38, 0.2] }),
    follow: Q({ hips: [-9, 0, 0], spine: [4, 0, 0], neck: [24, 0, 0], head: [-8, 0, 0], jaw: [14, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.66, -0.35] },
      { FL: [0.28, 0, 0.75], FR: [-0.28, 0, 0.75], BL: [0.14, 0, 0.35], BR: [-0.14, 0, 0.35] }),
  },
  // 도약 덮치기: 뒷다리를 몸 아래로 모아 깊이 웅크린다(예고의 30%에 완성) → 뛴다(공중 자세는 AIR) → 앞발로 내리찍으며 착지
  pounce: {
    holdAt: 0.3,
    windup: Q({ hips: [-3, 0, 0], spine: [10, 0, 0], chest: [-9, 0, 0], neck: [18, 0, 0], head: [-12, 0, 0], jaw: [8, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.8, -0.35] },
      { FL: [0.14, 0, -0.05], FR: [-0.14, 0, -0.05], BL: [0.14, 0, 0.55], BR: [-0.14, 0, 0.55] }),
    active: Q({ hips: [12, 0, 0], spine: [-6, 0, 0], chest: [4, 0, 0], neck: [26, 0, 0], head: [-8, 0, 0], jaw: [4, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.75, 0.3] },
      { FL: [0.36, 0, 0.7], FR: [-0.36, 0, 0.7], BL: [0.14, 0, 0.15], BR: [-0.14, 0, 0.15] }),
    follow: Q({ hips: [10, 0, 0], spine: [-4, 0, 0], chest: [4, 0, 0], neck: [34, 0, 0], head: [-12, 0, 0], jaw: [10, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.62, 0.2] },
      { FL: [0.36, 0, 0.7], FR: [-0.36, 0, 0.7], BL: [0.14, 0, 0.15], BR: [-0.14, 0, 0.15] }),
  },
  // 냉기 브레스: 몸을 세우고 고개를 하늘로 젖혀 들이마신다(입 안에 냉기가 모인다) → 머리를 낮게 내밀고 입을 크게 벌려 뿜는다
  breath: {
    holdAt: 0.5,
    windup: Q({ hips: [-8, 0, 0], spine: [3, 0, 0], chest: [-7, 0, 0], neck: [-24, 0, 0], head: [-6, 0, 0], jaw: [0, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.46, -0.5] },
      { FL: [0.26, 0, -0.1], FR: [-0.26, 0, -0.1], BL: [0.12, 0, 0.1], BR: [-0.12, 0, 0.1] }),
    active: Q({ hips: [9, 0, 0], spine: [-3, 0, 0], chest: [4, 0, 0], neck: [26, 0, 0], head: [-36, 0, 0], jaw: [40, 0, 0], ...TAIL_UP },
      { hips: [0, -0.5, 0.25] },
      { FL: [0.45, 0, 0.35], FR: [-0.45, 0, 0.35], BL: [0.2, 0, -0.2], BR: [-0.2, 0, -0.2] }),
    follow: Q({ hips: [6, 0, 0], spine: [-2, 0, 0], chest: [3, 0, 0], neck: [40, 0, 0], head: [-20, 0, 0], jaw: [16, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.42, 0.15] },
      { FL: [0.45, 0, 0.35], FR: [-0.45, 0, 0.35], BL: [0.2, 0, -0.2], BR: [-0.2, 0, -0.2] }),
  },
  // 백홉: 앞으로 낮게 웅크렸다가 뒤로 튄다(공중 자세는 AIR) → 네 발로 받는다
  hop: {
    windup: Q({ hips: [8, 0, 0], spine: [-4, 0, 0], neck: [14, 0, 0], head: [-18, 0, 0], jaw: [6, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.55, 0.3] },
      { FL: [0.14, 0, 0.25], FR: [-0.14, 0, 0.25] }),
    active: Q({ hips: [-4, 0, 0], neck: [22, 0, 0], head: [-16, 0, 0], jaw: [6, 0, 0], ...TAIL_UP },
      { hips: [0, -0.3, -0.15] },
      { FL: [0.2, 0, 0.3], FR: [-0.2, 0, 0.3], BL: [0.14, 0, -0.2], BR: [-0.14, 0, -0.2] }),
    follow: Q({ hips: [5, 0, 0], neck: [26, 0, 0], head: [-18, 0, 0], jaw: [8, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.6, -0.2] },
      { FL: [0.24, 0, 0.35], FR: [-0.24, 0, 0.35], BL: [0.16, 0, -0.1], BR: [-0.16, 0, -0.1] }),
  },
  // 얼음 가시: 앞발을 들며 하늘로 울부짖는다(예고의 36%에 완성 — `howl` 큐) → 앞발로 땅을 내리찍는다
  howl: {
    holdAt: 0.36,
    windup: Q({ hips: [-17, 0, 0], spine: [-3, 0, 0], chest: [-8, 0, 0], neck: [-48, 0, 0], head: [-18, 0, 0], jaw: [26, 0, 0], ...TAIL_LOW },
      { hips: [0, -0.55, -0.25] },
      { FL: [0.16, 0.45, 0.1, -20], FR: [-0.16, 0.6, 0.15, -20], BL: [0.16, 0, 0.2], BR: [-0.16, 0, 0.2] }),
    active: Q({ hips: [11, 0, 0], spine: [-4, 0, 0], chest: [5, 0, 0], neck: [36, 0, 0], head: [-14, 0, 0], jaw: [14, 0, 0], ...TAIL_UP },
      { hips: [0, -0.55, 0.25] },
      { FL: [0.32, 0, 0.45], FR: [-0.32, 0, 0.45] }),
    follow: Q({ hips: [10, 0, 0], spine: [-3, 0, 0], chest: [4, 0, 0], neck: [40, 0, 0], head: [-22, 0, 0], jaw: [10, 0, 0], ...TAIL_OUT },
      { hips: [0, -0.5, 0.2] },
      { FL: [0.32, 0, 0.45], FR: [-0.32, 0, 0.45] }),
  },
};

/** 공중 자세(도약 · 백홉) — 표현용 높이로 섞는다. [포즈, 수직 속도에 따른 몸 기울기(rad)] */
const AIR = {
  pounce: [Q({ hips: [0, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [14, 0, 0], head: [-6, 0, 0], jaw: [30, 0, 0], ...TAIL_OUT },
    { hips: [0, 0, 0] },
    { FL: [0.25, 0.75, 0.95, -25], FR: [-0.25, 0.9, 1.1, -25], BL: [0.12, 0.6, -0.95, 40], BR: [-0.12, 0.7, -0.8, 40] }), 17 * DEG],
  hop: [Q({ hips: [-6, 0, 0], spine: [8, 0, 0], chest: [-6, 0, 0], neck: [20, 0, 0], head: [-14, 0, 0], jaw: [6, 0, 0], ...TAIL_UP },
    { hips: [0, 0, 0] },
    { FL: [0.15, 0.75, 0.25, -30], FR: [-0.15, 0.85, 0.3, -30], BL: [0.12, 0.55, -0.25, 30], BR: [-0.12, 0.6, -0.2, 30] }), 9 * DEG],
};

/** 입을 벌렸다 닫는(무는) 포즈: 출발 구간에 이만큼(rad) 벌어지고 판정 전반에 닫힌다 */
const JAW_SNAP = { bite: 44 * DEG, pounce: 30 * DEG };

// ── 상태 포즈 ──
/** 등장: 낮게 엎드려 노려본다 */
const STALK = Q({ hips: [9, 0, 0], neck: [20, 0, 0], head: [-26, 0, 0], jaw: [6, 0, 0], ...TAIL_LOW },
  { hips: [0, -0.6, -0.2] },
  { FL: [0.2, 0, 0.3], FR: [-0.2, 0, 0.1] });
/** 포효: 앞발을 벌려 버티고 머리를 내밀어 입을 크게 벌린다 */
const ROAR = Q({ hips: [3, 0, 0], spine: [-3, 0, 0], chest: [-4, 0, 0], neck: [6, 0, 0], head: [-22, 0, 0], jaw: [44, 0, 0], ...TAIL_UP },
  { hips: [0, -0.3, 0.3] },
  { FL: [0.4, 0, 0.4], FR: [-0.4, 0, 0.4], BL: [0.2, 0, -0.15], BR: [-0.2, 0, -0.15] });
/** 웅크림(2페이즈 포효 직전): 등을 말고 머리를 가슴으로 당긴다 */
const HUNCH = Q({ hips: [6, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [48, 0, 0], head: [10, 0, 0], jaw: [2, 0, 0], ...TAIL_TUCK },
  { hips: [0, -0.6, 0] },
  { FL: [0.2, 0, 0.1], FR: [-0.2, 0, 0.1] });
/** 하늘로 울부짖음(2페이즈 포효) — 네 발은 땅에 */
const SKY_HOWL = Q({ hips: [-14, 0, 0], spine: [-3, 0, 0], chest: [-8, 0, 0], neck: [-50, 0, 0], head: [-18, 0, 0], jaw: [38, 0, 0], ...TAIL_OUT },
  { hips: [0, -0.5, -0.2] },
  { FL: [0.3, 0, 0.2], FR: [-0.3, 0, 0.2], BL: [0.2, 0, 0.15], BR: [-0.2, 0, 0.15] });
/** 패링당함: 머리가 위-옆으로 튕기고 앞발 하나가 뜬 채 뒤로 주저앉는다 */
const PARRIED = Q({ hips: [-6, 0, 8], spine: [-2, 10, 6], chest: [-4, 16, 14], neck: [-12, 44, 0], head: [-10, 30, 26], jaw: [30, 0, 0], ...TAIL_TUCK },
  { hips: [0.25, -0.4, -0.6] },
  { FL: [0.5, 0.7, 0.2, -40], FR: [-0.1, 0, -0.35], BL: [0.3, 0, -0.3], BR: [-0.15, 0, -0.25] });
/** 그로기: 배를 깔고 쓰러져 턱을 땅에 댄다(앞발은 옆으로 벌어지고 뒷다리는 접힌다) */
const DOWN = Q({ hips: [2, 0, 0], chest: [2, 0, -4], neck: [30, 10, 0], head: [-24, 14, 10], jaw: [14, 0, 0],
  tail1: [8, 10, 0], tail2: [2, 16, 0], tail3: [4, 18, 0] },
  { hips: [0, -1.38, 0] },
  { FL: [0.8, 0, 0.35], FR: [-0.8, 0, 0.55], BL: [0.35, 0, 0.9], BR: [-0.35, 0, 0.95] });
/** 처형당함: 쓰러진 채 머리가 크게 젖혀지고 몸이 뒤틀린다 */
const EXECUTED = Q({ hips: [-6, 0, 10], chest: [-6, 0, 8], neck: [-40, -16, 0], head: [-24, -10, -10], jaw: [36, 0, 0], ...TAIL_UP },
  { hips: [0, -1.0, -0.3] },
  { FL: [0.9, 0.3, 0.2], FR: [-0.7, 0, 0.5], BL: [0.35, 0, 0.8], BR: [-0.35, 0, 0.9] });
/** 사망: 옆으로 쓰러져 눕는다 */
const DEAD_SIDE = Q({ hips: [0, 0, 58], spine: [0, 6, 4], chest: [0, 8, 6], neck: [24, -16, 0], head: [-10, -10, 10], jaw: [20, 0, 0],
  tail1: [-10, 0, 0], tail2: [0, -20, 0], tail3: [0, -20, 0] },
  { hips: [0, -1.45, 0] },
  { FL: [1.5, 0.5, 0.4], FR: [1.1, 0.1, 0.9], BL: [1.5, 0.5, -0.1], BR: [1.1, 0.1, 0.6] });

/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {number} a @param {number} b @param {number} v */
const ramp = (a, b, v) => clamp01((v - a) / (b - a));
/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;
/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t);
/** @param {number} v */
const frac = (v) => v - Math.floor(v);

/** 부드러운 원형 알파 텍스처(입김) — DOM 없이 만든다. */
function makePuffTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const a = clamp01(1 - Math.hypot(dx, dy) * 2);
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 서리 송곳니 펜리르의 뷰를 만든다. root의 위치 · rotation.y는 CharacterLayer가 넣는다(+Z가 앞).
 * @returns {BossView}
 */
export function createFenrirView() {
  const def = FENRIR;
  const root = new THREE.Group();
  root.name = 'boss:fenrir';
  const rig = buildQuadrupedRig({ length: BODY_LENGTH, shoulderHeight: def.height, palette: PALETTE.fenrir, spikes: true });
  root.add(rig.root);
  const J = rig.joints;

  // ── 리그의 재질을 색으로 찾는다(덧붙이는 조각이 점멸 · 예고 발광 · 2페이즈 · 사망 소멸을 함께 받게) ──
  /** @type {THREE.Material[]} 이 뷰가 만든 재질(dispose용) */
  const ownMats = [];
  /** @type {THREE.BufferGeometry[]} */
  const ownGeoms = [];
  /** @param {number} hex @param {number} glow @returns {THREE.Material} */
  const rigMat = (hex, glow) => {
    /** @type {THREE.Material|null} */
    let found = null;
    rig.root.traverse((o) => {
      const m = /** @type {any} */ (o).material;
      if (!found && m && m.color && m.color.getHex() === hex) found = m;
    });
    if (found) return found;
    const made = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, flatShading: true, emissive: hex, emissiveIntensity: glow });
    ownMats.push(made);
    return made;
  };
  const accentMat = rigMat(PALETTE.fenrir.accent, 2.2);
  const MATS = { fur: rigMat(PALETTE.fenrir.fur, 0.1), dark: rigMat(PALETTE.fenrir.dark, 0.1), bone: rigMat(BONE_COLOR, 0.1), ice: accentMat };

  // ── 덩치: 리그의 몸은 가늘다(폭 1m) — 가슴 · 어깨 · 엉덩이 · 다리 · 꼬리에 살을 붙여 bodyParts 원(반경 1.0~1.3)에 가깝게 불린다 ──
  const bulk = new PartBuilder();
  /** 타원체(관절 로컬): 중심 (x, y, z), 반지름 (sx, sy, sz) */
  const blob = (joint, mat, x, y, z, sx, sy, sz) => bulk.add(J[joint], mat, ball(1, 7, 5), x, y, z, 0, 0, 0, sx, sy, sz);
  /** 뒤로 누운 털 뭉치 */
  const tuft = (joint, mat, x, y, z, len, r, tilt, yaw) => bulk.add(J[joint], mat, place(cone(r, len, 4), 0, len * 0.3, 0, -tilt, 0, 0), x, y, z, 0, yaw, 0);
  blob('chest', 'fur', 0, -0.1, 0.24, 0.7, 0.68, 0.92);          // 갈비
  blob('chest', 'fur', 0, 0.36, 0.2, 0.4, 0.34, 0.66);           // 솟은 어깨(기갑)
  blob('chest', 'dark', 0, -0.42, 0.55, 0.42, 0.4, 0.5);         // 앞가슴
  blob('spine', 'fur', 0, -0.06, 0.45, 0.56, 0.55, 0.95);        // 허리
  blob('hips', 'fur', 0, -0.04, -0.05, 0.58, 0.54, 0.72);        // 엉덩이
  blob('neck', 'fur', 0, 0.04, 0.22, 0.5, 0.5, 0.56);            // 목덜미
  for (const sg of [1, -1]) {
    blob('chest', 'fur', sg * 0.44, 0.12, 0.4, 0.34, 0.5, 0.56);   // 어깨 근육
    blob('hips', 'fur', sg * 0.38, -0.14, -0.02, 0.33, 0.58, 0.62); // 뒷다리 허벅지 위
    // 목 갈기
    for (let i = 0; i < 3; i++) {
      tuft('neck', 'fur', sg * (0.34 + i * 0.05), 0.28 - i * 0.24, 0.0, 0.6, 0.13, 1.3, sg * (0.45 + i * 0.2));
    }
    // 뺨 털 · 눈썹 · 빛나는 눈
    tuft('head', 'fur', sg * 0.3, -0.06, 0.02, 0.6, 0.13, 1.45, sg * 0.75);
    tuft('head', 'fur', sg * 0.26, -0.2, 0.1, 0.45, 0.1, 1.6, sg * 0.6);
    bulk.add(J.head, 'dark', box(0.17, 0.045, 0.26), sg * 0.2, 0.205, 0.4, 0.3, sg * 0.25, sg * 0.4);
    bulk.add(J.head, 'ice', place(cone(0.055, 0.28, 4), 0, 0, 0, Math.PI / 2, 0, 0), sg * 0.2, 0.13, 0.5, 0.15, sg * 0.42, 0, 1, 0.8, 1);
  }
  for (const S of ['L', 'R']) {
    blob(`shoulderF${S}`, 'fur', 0, -0.3, -0.04, 0.22, 0.5, 0.3);
    blob(`elbowF${S}`, 'dark', 0, -0.36, 0.05, 0.15, 0.46, 0.18);
    blob(`hipB${S}`, 'fur', 0, -0.3, 0.14, 0.25, 0.52, 0.4);
    for (const paw of [`pawF${S}`, `pawB${S}`]) {
      blob(paw, 'dark', 0, -0.04, 0.12, 0.2, 0.12, 0.3);
      for (const k of [-1, 0, 1]) {
        blob(paw, 'dark', k * 0.13, -0.07, 0.36, 0.075, 0.07, 0.13);
        bulk.add(J[paw], 'bone', cone(0.04, 0.22, 4), k * 0.13, -0.08, 0.52, Math.PI / 2 + 0.4, 0, 0);
      }
    }
  }
  blob('tail1', 'fur', 0, -0.06, -0.26, 0.2, 0.2, 0.42);
  blob('tail2', 'fur', 0, -0.08, -0.26, 0.27, 0.26, 0.46);
  blob('tail3', 'fur', 0, -0.07, -0.24, 0.23, 0.22, 0.4);
  tuft('tail3', 'dark', 0, -0.08, -0.45, 0.6, 0.16, 1.75, 0);
  bulk.finish(MATS, ownGeoms);

  // ── 얼음 결정 갈기: 어깨 · 등 · 엉덩이에서 뒤로 누운 큰 가시. 2페이즈 포효에 터져 자란다 ──
  const pb = new PartBuilder();
  /** 가시 하나(관절 로컬). tilt = 수직에서 뒤로 누운 각, roll = 바깥으로 벌어진 각(rad) */
  const spike = (joint, x, y, z, len, r, tilt, roll) => {
    pb.add(J[joint], 'ice', place(cone(r, len, 5), 0, len * 0.42, 0), x, y, z, -tilt, 0, x >= 0 ? -roll : roll);
  };
  // 어깨 왕관(좌우 대칭)
  for (const sg of [1, -1]) {
    spike('chest', sg * 0.3, 0.42, 0.55, 1.0, 0.11, 0.55, 0.5);
    spike('chest', sg * 0.42, 0.3, 0.25, 1.25, 0.12, 0.8, 0.75);
    spike('chest', sg * 0.36, 0.34, -0.15, 0.95, 0.1, 1.0, 0.55);
    spike('chest', sg * 0.52, 0.1, 0.45, 0.8, 0.09, 0.7, 1.15);
    spike('spine', sg * 0.26, 0.36, 0.5, 0.8, 0.09, 1.0, 0.45);
    spike('hips', sg * 0.24, 0.38, 0.25, 0.65, 0.08, 1.05, 0.5);
    spike('neck', sg * 0.26, 0.3, 0.1, 0.6, 0.07, 0.9, 0.7);
  }
  // 등줄기
  spike('chest', 0, 0.5, 0.2, 1.45, 0.13, 0.7, 0);
  spike('chest', 0, 0.46, -0.3, 1.1, 0.11, 0.95, 0);
  spike('spine', 0, 0.42, 0.15, 0.9, 0.09, 1.05, 0);
  spike('hips', 0, 0.4, -0.2, 0.7, 0.08, 1.15, 0);
  spike('tail1', 0, 0.12, -0.2, 0.5, 0.06, 1.3, 0);
  const growMeshes = pb.finish(MATS, ownGeoms);
  let grow = 0;
  for (const m of growMeshes) m.scale.setScalar(0.0001);

  // ── 입 앞에 맺히는 냉기 구슬(브레스 · 울부짖음의 예고에 차오른다 — 브레스 fx의 원점인 mouth 소켓 자리) ──
  const mawMat = new THREE.MeshBasicMaterial({ color: MAW_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false });
  const mawGeo = new THREE.SphereGeometry(MAW_RADIUS, 10, 8);
  const maw = new THREE.Mesh(mawGeo, mawMat);
  maw.position.copy(rig.sockets.mouth.position);
  maw.position.y -= 0.06;
  maw.visible = false;
  J.head.add(maw);
  ownMats.push(mawMat);
  ownGeoms.push(mawGeo);
  const mawColor = new THREE.Color(MAW_COLOR);

  // ── 입김: 월드에 남는 작은 김(스프라이트 풀). root의 자식이지만 위치는 매 프레임 월드 → root 로컬로 되돌려 넣는다 ──
  const puffTex = makePuffTexture();
  const puffGroup = new THREE.Group();
  puffGroup.name = 'fenrir:breath';
  root.add(puffGroup);
  /** @type {{sprite:THREE.Sprite, mat:THREE.SpriteMaterial, age:number, life:number, x:number, y:number, z:number, vx:number, vy:number, vz:number}[]} */
  const puffs = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({ map: puffTex, color: PALETTE.style.frost.core, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    puffGroup.add(sprite);
    ownMats.push(mat);
    puffs.push({ sprite, mat, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  let puffNext = 0;
  let puffAcc = 0;

  // ── 다리 IK 준비: rest 자세의 마디 벡터와 발 자리(리그 root 로컬) ──
  rig.applyPose(emptyPose());
  rig.root.updateMatrixWorld(true);
  const _inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  /**
   * @typedef {Object} Leg
   * @property {string} key
   * @property {boolean} front
   * @property {THREE.Object3D} up
   * @property {THREE.Object3D} mid
   * @property {THREE.Object3D} paw
   * @property {number} my @property {number} mz @property {number} py @property {number} pz  rest 마디 벡터(YZ 평면)
   * @property {number} a @property {number} b  마디 길이
   * @property {number} bend0  rest에서 아랫마디가 윗마디에 대해 꺾인 각(부호 = 꺾이는 쪽)
   * @property {THREE.Vector3} rest  rest 발목 자리
   * @property {number} ox @property {number} oy @property {number} oz  걸음이 얹는 오프셋
   * @property {number} pitch
   */
  /** @type {Leg[]} */
  const legs = [
    ['FL', J.shoulderFL, J.elbowFL, J.pawFL, true], ['FR', J.shoulderFR, J.elbowFR, J.pawFR, true],
    ['BL', J.hipBL, J.kneeBL, J.pawBL, false], ['BR', J.hipBR, J.kneeBR, J.pawBR, false],
  ].map(([key, up, mid, paw, front]) => {
    const m = mid.position;
    const p = paw.position;
    const am = Math.atan2(m.z, -m.y);
    const ap = Math.atan2(p.z, -p.y);
    return {
      key, front, up, mid, paw,
      my: m.y, mz: m.z, py: p.y, pz: p.z,
      a: Math.hypot(m.y, m.z), b: Math.hypot(p.y, p.z),
      bend0: ap - am,
      rest: new THREE.Vector3().setFromMatrixPosition(paw.matrixWorld).applyMatrix4(_inv),
      ox: 0, oy: 0, oz: 0, pitch: 0,
    };
  });
  /** 가슴 축(엉덩이 돌리기의 중심)까지의 등뼈 두 마디 길이 */
  const spineLen1 = J.spine.position.z;
  const spineLen2 = J.chest.position.z;
  const hipsRestX = J.hips.position.x;
  const hipsRestZ = J.hips.position.z;

  const blender = new PoseBlender(rig, HL_DEFAULT);
  const pose = emptyPose();
  const poseKeys = Object.keys(FENRIR_POSES);
  /** @type {Record<string, boolean>} */
  const warned = {};
  const _mHips = new THREE.Matrix4();
  const _mChest = new THREE.Matrix4();
  const _mHead = new THREE.Matrix4();
  const _invHips = new THREE.Matrix4();
  const _invChest = new THREE.Matrix4();
  const _qHips = new THREE.Quaternion();
  const _qChest = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _qp = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _v0 = new THREE.Vector3();
  const _xAxis = new THREE.Vector3(1, 0, 0);
  const _mouth = new THREE.Vector3();

  let time = 0;
  let lastSeq = -1;
  let lastPhase = '';
  // 걸음
  let gaitPhase = 0;
  let gaitAmp = 0;
  let svf = 0;      // 부드럽게 한 로컬 전진 속도(m/s)
  let svl = 0;      // 로컬 왼쪽 속도
  let som = 0;      // 각속도(rad/s)
  let runK = 0;     // 0 속보 .. 1 질주
  let lookYaw = 0;
  let prevSwing = 0;
  let swingLift = 0;
  let flinch = 0;
  let flinchSide = 0;
  let flinchFwd = 0;

  /**
   * 다리 하나: 발목이 리그 root 로컬의 (tx, ty, tz)에 오게 윗마디 · 아랫마디를 돌리고 발바닥을 지면과 나란히(+ pitch) 둔다.
   * @param {Leg} leg @param {number} tx @param {number} ty @param {number} tz @param {number} pitch
   */
  function solveLeg(leg, tx, ty, tz, pitch) {
    const inv = leg.front ? _invChest : _invHips;
    const pq = leg.front ? _qChest : _qHips;
    _v.set(tx, ty, tz).applyMatrix4(inv).sub(leg.up.position);
    const d = _v.length();
    const sum = leg.a + leg.b;
    const dc = clamp(d, sum * REACH_MIN, sum * REACH_MAX);
    const cosB = clamp((dc * dc - leg.a * leg.a - leg.b * leg.b) / (2 * leg.a * leg.b), -1, 1);
    const bend = (leg.bend0 >= 0 ? 1 : -1) * Math.acos(cosB);
    const phi = leg.bend0 - bend;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    _v0.set(0, leg.my + (leg.py * c - leg.pz * s), leg.mz + (leg.py * s + leg.pz * c)).normalize();
    if (d > 1e-6) _v.divideScalar(d);
    else _v.set(0, -1, 0);
    leg.up.quaternion.setFromUnitVectors(_v0, _v);
    leg.mid.rotation.set(phi, 0, 0);
    _q.copy(pq).multiply(leg.up.quaternion).multiply(leg.mid.quaternion).invert();
    leg.paw.quaternion.copy(_q).multiply(_qp.setFromAxisAngle(_xAxis, pitch));
  }

  /** 입김 하나를 낸다(월드 좌표). */
  function emitPuff(x, y, z, vx, vy, vz, life) {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % puffs.length;
    p.age = 0;
    p.life = life;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
  }

  /**
   * @param {BossState} boss
   * @param {{alpha:number, dt:number, time:number, state:GameState}} info
   */
  function update(boss, info) {
    const dt = info.dt;
    const state = info.state;
    const simDt = state && state.hitstop > 0 ? 0 : dt;
    time += dt;
    const t = boss.stateTime;
    const prog = boss.stateDur > 0 ? clamp01(t / boss.stateDur) : 0;

    let halfLife = HL_DEFAULT;
    let snap = false;
    let glowStyle = 'none';
    let glowAmt = 0;
    let dead = 0;
    let gaitAllow = 1;     // 걸음을 얹는가
    let forceRun = false;  // 질주 사이클로 고정(돌진)
    let look = 0;          // 고개로 플레이어를 따라보는 정도
    let mawAmt = 0;        // 입 앞의 냉기 구슬 0..1
    let tremble = 0;       // 머리 · 몸 떨림
    let pant = 0;          // 헐떡임
    let breatheOut = 0.25; // 입김이 나오는 정도(초당 개수의 배율)
    let pawing = 0;        // 앞발로 땅 긁기

    switch (boss.state) {
      case 'attack': {
        const a = boss.attack;
        if (!a) { copyPose(IDLE, pose); break; }
        let key = a.pose;
        let set = FENRIR_POSES[key];
        if (!set) {
          if (!warned[key]) {
            warned[key] = true;
            console.warn(`[fenrirView] 모르는 pose '${key}' — '${poseKeys[0]}'로 대신한다`);
          }
          key = poseKeys[0];
          set = FENRIR_POSES[key];
        }
        const rT = bossReleaseT(a.windup);
        attackPose(set, IDLE, a.phase, a.phaseT, pose, rT);
        const pT = clamp01(a.phaseT);
        // 무는 입: 출발 구간에 벌어져 판정 전반에 닫힌다
        const snapJaw = JAW_SNAP[key];
        if (snapJaw) {
          const k = a.phase === 'windup' ? ease.outCubic(ramp(1 - rT, 1, pT)) : a.phase === 'active' ? 1 - ease.inQuad(ramp(0, 0.45, pT)) : 0;
          addRot(pose, 'jaw', snapJaw * k, 0, 0);
          addRot(pose, 'head', -snapJaw * 0.3 * k, 0, 0);
        }
        gaitAllow = 0;
        if (key === 'charge') {
          if (a.phase === 'windup') pawing = ramp(0.3, 0.5, pT) * (1 - ramp(1 - rT, 1, pT));
          else if (a.phase === 'active') { gaitAllow = 1; forceRun = true; }
          breatheOut = 1.2;
        } else if (key === 'breath') {
          mawAmt = a.phase === 'windup' ? ease.inQuad(pT) : a.phase === 'active' ? 1 : 1 - ramp(0, 0.25, pT);
          tremble = a.phase === 'active' ? 1 : a.phase === 'windup' ? 0.4 * pT : 0;
          pant = a.phase === 'recovery' ? ramp(0.1, 0.3, pT) * (1 - ramp(0.8, 1, pT)) : 0;
          breatheOut = a.phase === 'recovery' ? 2.5 : 0;
        } else if (key === 'howl') {
          const h = set.holdAt ?? 0.6;
          mawAmt = a.phase === 'windup' ? 0.7 * ramp(h * 0.6, h, pT) : a.phase === 'active' ? 0.7 * (1 - pT) : 0;
          tremble = a.phase === 'windup' ? ramp(h * 0.8, h, pT) * (1 - ramp(1 - rT, 1, pT)) : 0;
          breatheOut = a.phase === 'windup' ? 3 : 0.5;
        }
        glowStyle = a.glow;
        glowAmt = a.phase === 'windup' ? pT : a.phase === 'active' ? 1 : 1 - clamp01(pT * 3);
        snap = a.phase === 'active' && (a.seq !== lastSeq || lastPhase !== 'active');
        lastSeq = a.seq;
        lastPhase = a.phase;
        halfLife = HL_ATTACK;
        break;
      }
      case 'chase': {
        copyPose(IDLE, pose);
        look = 1;
        breatheOut = 0.8;
        break;
      }
      case 'intro': {
        // 낮게 엎드려 다가오다 → 0.5초에 포효 → 자세를 잡는다
        const roarEnd = ROAR_AT_INTRO + ROAR_LEN_INTRO;
        if (t < ROAR_AT_INTRO) lerpPose(STALK, ROAR, ease.inCubic(t / ROAR_AT_INTRO), pose);
        else if (t < roarEnd) { copyPose(ROAR, pose); tremble = 1; }
        else lerpPose(ROAR, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        breatheOut = t >= ROAR_AT_INTRO && t < roarEnd ? 4 : 0.3;
        gaitAllow = 0;
        break;
      }
      case 'phaseShift': {
        const roarEnd = ROAR_AT_SHIFT + ROAR_LEN_SHIFT;
        if (t < ROAR_AT_SHIFT) {
          lerpPose(IDLE, HUNCH, ease.outCubic(ramp(0, ROAR_AT_SHIFT * 0.8, t)), pose);
          tremble = 0.6 * ramp(0.15, ROAR_AT_SHIFT, t);
        } else if (t < roarEnd) {
          lerpPose(HUNCH, SKY_HOWL, ease.outBack(ramp(ROAR_AT_SHIFT, ROAR_AT_SHIFT + 0.3, t)), pose);
          tremble = 1;
          mawAmt = 1;
        } else lerpPose(SKY_HOWL, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        breatheOut = t >= ROAR_AT_SHIFT && t < roarEnd ? 5 : 0.3;
        halfLife = t >= ROAR_AT_SHIFT && t < ROAR_AT_SHIFT + 0.3 ? HL_HURT : HL_DEFAULT;
        gaitAllow = 0;
        break;
      }
      case 'parried': {
        const k = ease.outCubic(ramp(0, 0.14, prog)) * (1 - ease.inOutQuad(ramp(0.6, 1, prog)));
        lerpPose(IDLE, PARRIED, k, pose);
        halfLife = HL_HURT;
        gaitAllow = 0;
        break;
      }
      case 'groggy': {
        lerpPose(IDLE, DOWN, ease.outCubic(ramp(0, 0.45, t)), pose);
        pant = ramp(0.3, 0.7, t);
        breatheOut = 2.2;
        gaitAllow = 0;
        break;
      }
      case 'executed': {
        const k = ease.outCubic(ramp(0, 0.12, prog)) * (1 - ease.inOutQuad(ramp(0.5, 1, prog)));
        lerpPose(DOWN, EXECUTED, k, pose);
        addRot(pose, 'spine', 0, 0, 0.05 * Math.sin(t * 50) * k);
        halfLife = HL_HURT;
        gaitAllow = 0;
        breatheOut = 0;
        break;
      }
      case 'recover': {
        lerpPose(DOWN, IDLE, ease.inOutQuad(prog), pose);
        // 일어서며 몸을 턴다
        const shake = Math.sin(prog * Math.PI) * Math.sin(t * 38) * 0.05;
        addRot(pose, 'chest', 0, 0, shake);
        addRot(pose, 'head', 0, 0, -shake * 1.6);
        gaitAllow = 0;
        break;
      }
      case 'dead': {
        dead = clamp01(t / Math.max(0.1, COMBAT.outroVictory - 0.4));
        if (dead < 0.28) lerpPose(IDLE, DOWN, ease.inOutQuad(dead / 0.28), pose);
        else lerpPose(DOWN, DEAD_SIDE, ease.inOutQuad(ramp(0.3, 0.62, dead)), pose);
        gaitAllow = 0;
        breatheOut = 0;
        break;
      }
      default: { // idle
        copyPose(IDLE, pose);
        look = 1;
        break;
      }
    }
    if (boss.state !== 'attack') lastPhase = '';

    // ── 속도: sim 틱의 이동량에서(보스 상태에는 속도 필드가 없다). 로컬 전진 · 왼쪽 · 각속도 ──
    const dx = boss.pos.x - boss.prevPos.x;
    const dz = boss.pos.z - boss.prevPos.z;
    const sn = Math.sin(boss.facing);
    const cs = Math.cos(boss.facing);
    const vf = clamp((dx * sn + dz * cs) / DT, -GAIT_SPEED_CAP, GAIT_SPEED_CAP);
    const vl = clamp((dx * cs - dz * sn) / DT, -GAIT_SPEED_CAP, GAIT_SPEED_CAP);
    const om = clamp(angleDiff(boss.prevFacing, boss.facing) / DT, -GAIT_SPEED_CAP, GAIT_SPEED_CAP);
    // 히트스톱 틱에는 sim이 멈춰 이동량이 0으로 보인다 — 걸음은 simDt로만 따라가게 해 그 동안 그대로 얼린다
    const ks = 1 - Math.exp(-GAIT_SMOOTH * simDt);
    svf += (vf - svf) * ks;
    svl += (vl - svl) * ks;
    som += (om - som) * ks;
    const bodySpeed = Math.hypot(svf, svl);
    const runTarget = forceRun ? 1 : smooth(ramp(RUN_FROM, RUN_TO, bodySpeed));
    const ka = 1 - Math.exp(-GAIT_AMP_LAMBDA * simDt);
    runK += (runTarget - runK) * ka;

    // 발마다의 지면 속도(몸 로컬) = 몸 속도 + 각속도 × 발 자리. 가장 빠른 발이 사이클의 박자를 정한다
    let sref = 0;
    for (const leg of legs) {
      const ux = svl + som * leg.rest.z;
      const uz = svf - som * leg.rest.x;
      sref = Math.max(sref, Math.hypot(ux, uz));
    }
    const ampTarget = gaitAllow * ramp(GAIT_MIN_SPEED, GAIT_FULL_SPEED, sref);
    gaitAmp += (ampTarget - gaitAmp) * ka;
    const lc = mix(LC_TROT, LC_GALLOP, runK);
    const duty = mix(DUTY_TROT, DUTY_GALLOP, runK);
    const freq = Math.min(sref / lc, GAIT_F_MAX);
    gaitPhase = frac(gaitPhase + freq * simDt);
    for (const leg of legs) {
      leg.ox = 0; leg.oy = 0; leg.oz = 0; leg.pitch = 0;
      if (gaitAmp < 0.01 || freq < 0.01) continue;
      const off = GAIT_OFFSETS[leg.key];
      const ph = frac(gaitPhase + mix(off[0], off[1], runK));
      // 디딘 동안 발이 몸에 대해 움직여야 하는 거리 = 지면 속도 × 디딘 시간
      let sx = (svl + som * leg.rest.z) * (duty / freq);
      let sz = (svf - som * leg.rest.x) * (duty / freq);
      const sl = Math.hypot(sx, sz);
      if (sl > STRIDE_MAX) { sx *= STRIDE_MAX / sl; sz *= STRIDE_MAX / sl; }
      let u;
      if (ph < duty) {
        u = 0.5 - ph / duty;
      } else {
        const w = (ph - duty) / (1 - duty);
        u = smooth(w) - 0.5;
        leg.oy = gaitAmp * mix(LIFT_TROT, LIFT_GALLOP, runK) * Math.sin(Math.PI * w) * clamp01(Math.min(sl, STRIDE_MAX) / 0.5);
        leg.pitch = gaitAmp * 0.6 * Math.cos(Math.PI * w);
      }
      leg.ox = gaitAmp * sx * u;
      leg.oz = gaitAmp * sz * u;
    }
    if (gaitAmp > 0.01) {
      // 달리는 몸: 낮고 길게. 속보는 걸음마다 내려앉고, 질주는 몸통이 접혔다 펴지며 앞뒤로 출렁인다
      const moving = gaitAmp * clamp01(bodySpeed / Math.max(0.1, def.moveSpeed));
      if (boss.state !== 'attack') lerpPose(pose, RUN, moving * (0.4 + 0.6 * runK), pose);
      const c2 = Math.cos(gaitPhase * 2 * TAU);
      const trot = gaitAmp * (1 - runK);
      const gal = gaitAmp * runK;
      addPos(pose, 'hips', 0, -0.05 * trot * (0.5 - 0.5 * c2) + 0.12 * gal * Math.sin((gaitPhase - 0.05) * TAU), 0);
      addRot(pose, 'hips', -0.085 * gal * Math.cos((gaitPhase - 0.2) * TAU), 0, -0.02 * clamp(som, -6, 6) * gaitAmp);
      const flex = 0.13 * gal * Math.cos((gaitPhase - 0.95) * TAU);
      addRot(pose, 'spine', flex, 0, 0);
      addRot(pose, 'chest', -flex * 0.6, 0, 0.03 * trot * Math.sin(gaitPhase * TAU));
      addRot(pose, 'neck', -flex * 0.4 + 0.06 * gal * Math.cos((gaitPhase - 0.2) * TAU), 0, 0);
      addRot(pose, 'tail1', 0.1 * gal * Math.sin((gaitPhase - 0.3) * TAU), 0.12 * trot * Math.sin(gaitPhase * TAU), 0);
      addRot(pose, 'tail2', 0.12 * gal * Math.sin((gaitPhase - 0.45) * TAU), 0.16 * trot * Math.sin((gaitPhase - 0.15) * TAU), 0);
    }

    // ── 덧동작: 고개 돌리기 · 숨 · 헐떡임 · 떨림 · 땅 긁기 · 피격 움찔 ──
    let lookTarget = 0;
    if (look > 0 && state && state.player) {
      const px = state.player.pos.x - boss.pos.x;
      const pz = state.player.pos.z - boss.pos.z;
      if (px * px + pz * pz > 0.01) lookTarget = clamp(angleDiff(boss.facing, angleOf(px, pz)), -LOOK_MAX, LOOK_MAX) * look;
    }
    lookYaw += (lookTarget - lookYaw) * (1 - Math.exp(-LOOK_LAMBDA * dt));
    if (Math.abs(lookYaw) > 0.001) {
      addRot(pose, 'neck', 0, lookYaw * 0.55, 0);
      addRot(pose, 'head', 0, lookYaw * 0.4, -lookYaw * 0.15);
    }
    if (boss.state !== 'dead') {
      const b = Math.sin(time * BREATH_RATE);
      addRot(pose, 'chest', -0.012 * b, 0, 0);
      addRot(pose, 'spine', 0.008 * b, 0, 0);
      addRot(pose, 'head', 0.012 * b, 0, 0);
      addPos(pose, 'hips', 0, 0.012 * b, 0);
      addRot(pose, 'tail1', 0, 0.07 * Math.sin(time * 1.3), 0);
      addRot(pose, 'tail2', 0, 0.1 * Math.sin(time * 1.3 - 0.7), 0);
      addRot(pose, 'tail3', 0, 0.12 * Math.sin(time * 1.3 - 1.4), 0);
    }
    if (pant > 0) {
      const p = Math.sin(time * PANT_RATE);
      addRot(pose, 'jaw', 0.09 * pant * (0.5 + 0.5 * p), 0, 0);
      addRot(pose, 'chest', 0.02 * pant * p, 0, 0);
      addPos(pose, 'hips', 0, 0.02 * pant * p, 0);
    }
    if (tremble > 0) {
      addRot(pose, 'head', 0.022 * tremble * Math.sin(time * 47), 0.018 * tremble * Math.sin(time * 39), 0);
      addRot(pose, 'neck', 0.012 * tremble * Math.sin(time * 31), 0, 0);
      addRot(pose, 'jaw', 0.03 * tremble * Math.sin(time * 53), 0, 0);
      addRot(pose, 'chest', 0, 0, 0.008 * tremble * Math.sin(time * 43));
    }
    if (pawing > 0) {
      // 오른 앞발로 땅을 긁는다: 앞으로 들었다가 뒤로 끈다
      const c = frac(time * 2.6);
      const fwd = c < 0.35 ? c / 0.35 : 1 - (c - 0.35) / 0.65;
      addPos(pose, 'ikFR', 0, pawing * (c < 0.35 ? 0.3 * Math.sin((c / 0.35) * Math.PI) : 0), pawing * (fwd * 0.7 - 0.25));
    }
    if (flinch > 0) {
      flinch = Math.max(0, flinch - dt);
      const k = FLINCH_AMP * Math.sin((1 - flinch / FLINCH_DUR) * Math.PI);
      addRot(pose, 'chest', flinchFwd * k * 0.5, 0, -flinchSide * k);
      addRot(pose, 'neck', flinchFwd * k, flinchSide * k, 0);
      addRot(pose, 'head', flinchFwd * k * 0.6, flinchSide * k * 0.6, 0);
    }

    // ── 공중 자세(도약 · 백홉): 표현용 높이로 섞는다 ──
    const yNow = mix(boss.prevY, boss.y, clamp01(info.alpha));
    if (yNow > 0.01 && boss.state === 'attack' && boss.attack) {
      const air = AIR[boss.attack.pose];
      if (air) {
        lerpPose(pose, air[0], smooth(clamp01(yNow / AIR_FULL)), pose);
        const vy = (boss.y - boss.prevY) / DT;
        addRot(pose, 'hips', -clamp(vy / AIR_VY_REF, -1, 1) * air[1] * clamp01(yNow / AIR_FULL), 0, 0);
      }
    }

    if (snap) blender.snap(pose);
    else blender.update(pose, dt, halfLife);

    // ── 블렌더 뒤: 엉덩이 돌리기 → 다리 IK ──
    const bp = blender.pose;
    const swing = bp.rot.swing ? bp.rot.swing[1] : 0;
    const hips = J.hips;
    let swingX = 0;
    let swingZ = 0;
    if (Math.abs(swing) > 1e-4) {
      // 엉덩이를 swing만큼 돌리고 등뼈 두 마디가 반씩 되돌린다 → 가슴은 제자리 · 제 방향, 엉덩이만 옆으로 돈다
      swingX = -spineLen1 * Math.sin(swing) - spineLen2 * Math.sin(swing / 2);
      swingZ = spineLen1 * (1 - Math.cos(swing)) + spineLen2 * (1 - Math.cos(swing / 2));
      hips.rotation.y += swing;
      hips.position.x += swingX;
      hips.position.z += swingZ;
      J.spine.rotation.y -= swing / 2;
      J.chest.rotation.y -= swing / 2;
    }
    const swingRate = dt > 0 ? Math.abs(swing - prevSwing) / dt : 0;
    prevSwing = swing;
    swingLift += (Math.min(SWING_LIFT_MAX, swingRate * SWING_LIFT_K) - swingLift) * (1 - Math.exp(-30 * dt));

    hips.updateMatrix();
    J.spine.updateMatrix();
    J.chest.updateMatrix();
    _mHips.copy(hips.matrix);
    _mChest.multiplyMatrices(hips.matrix, J.spine.matrix).multiply(J.chest.matrix);
    _invHips.copy(_mHips).invert();
    _invChest.copy(_mChest).invert();
    _qHips.copy(hips.quaternion);
    _qChest.copy(hips.quaternion).multiply(J.spine.quaternion).multiply(J.chest.quaternion);
    const sws = Math.sin(swing);
    const swc = Math.cos(swing);
    for (const leg of legs) {
      const ik = bp.pos[IK_KEYS[leg.key]];
      const ikr = bp.rot[IK_KEYS[leg.key]];
      let x = leg.rest.x;
      let z = leg.rest.z;
      let y = leg.rest.y;
      if (!leg.front && swing !== 0) {
        // 뒷발은 엉덩이를 따라 돈다
        const rx = leg.rest.x - hipsRestX;
        const rz = leg.rest.z - hipsRestZ;
        x = hipsRestX + swingX + rx * swc + rz * sws;
        z = hipsRestZ + swingZ - rx * sws + rz * swc;
        y += swingLift;
      }
      if (ik) { x += ik[0]; y += ik[1]; z += ik[2]; }
      solveLeg(leg, x + leg.ox, y + leg.oy, z + leg.oz, (ikr ? ikr[0] : 0) + leg.pitch);
    }

    // ── 발광: 예고 발광 · 2페이즈 · 얼음 결정 · 냉기 구슬 ──
    rig.setGlow(/** @type {any} */ (glowStyle), glowAmt);
    rig.setBoost((boss.phase === 2 ? PHASE2_BOOST : 0) + dead * 2);
    const growTarget = boss.phase === 2 && (boss.state !== 'phaseShift' || t >= ROAR_AT_SHIFT) ? 1 : 0;
    grow += (growTarget - grow) * (1 - Math.exp(-GROW_LAMBDA * dt));
    const g = Math.max(0.0001, growTarget === 1 ? ease.outBack(clamp01(grow)) : grow);
    for (const m of growMeshes) {
      m.scale.setScalar(g);
      m.visible = g > 0.01;
    }
    const mawK = mawAmt * (1 - dead) * (0.85 + 0.15 * Math.sin(time * 31));
    maw.visible = mawK > 0.01;
    if (maw.visible) {
      mawMat.color.copy(mawColor).multiplyScalar(MAW_GAIN * mawK);
      mawMat.opacity = clamp01(mawK);
      maw.scale.setScalar(0.5 + 0.7 * mawK);
    }

    // ── 입김: 입에서 나와 월드에 남는다 ──
    J.neck.updateMatrix();
    J.head.updateMatrix();
    _mHead.multiplyMatrices(_mChest, J.neck.matrix).multiply(J.head.matrix);
    _mouth.copy(rig.sockets.mouth.position).applyMatrix4(_mHead);
    const rsn = Math.sin(root.rotation.y);
    const rcs = Math.cos(root.rotation.y);
    const exhale = Math.max(0, Math.sin(time * BREATH_RATE + 1.2));
    puffAcc += dt * breatheOut * (boss.phase === 2 ? 1.6 : 1) * (boss.state === 'dead' ? 0 : 6 * exhale);
    while (puffAcc >= 1) {
      puffAcc -= 1;
      // root 로컬 → 월드(§0.2: rotation.y = facing)
      const wx = root.position.x + _mouth.x * rcs + _mouth.z * rsn;
      const wz = root.position.z - _mouth.x * rsn + _mouth.z * rcs;
      const sp = 0.5 + Math.random() * 0.7;
      emitPuff(wx, root.position.y + _mouth.y, wz, rsn * sp + (Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.35,
        rcs * sp + (Math.random() - 0.5) * 0.3, PUFF_LIFE * (0.7 + Math.random() * 0.6));
    }
    for (const p of puffs) {
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      p.age += dt;
      if (p.age >= p.life) { p.life = 0; p.sprite.visible = false; continue; }
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = p.age / p.life;
      const lx = p.x - root.position.x;
      const lz = p.z - root.position.z;
      p.sprite.position.set(lx * rcs - lz * rsn, p.y - root.position.y, lx * rsn + lz * rcs);
      p.sprite.scale.setScalar(mix(PUFF_SIZE0, PUFF_SIZE1, ease.outQuad(u)));
      p.mat.opacity = PUFF_OPACITY * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - dead);
      p.sprite.visible = true;
    }

    // ── 사망: 가라앉으며 흩어진다. 다시 살아나면(재도전) 되돌린다 ──
    if (boss.state === 'dead') {
      rig.root.position.y = -DEATH_SINK * ease.inQuad(ramp(DEATH_FADE_FROM, 1, dead));
      rig.setOpacity(1 - ramp(DEATH_FADE_FROM, 1, dead));
      root.visible = dead < 1;
    } else {
      rig.root.position.y = 0;
      rig.setOpacity(1);
      root.visible = true;
    }
  }

  /**
   * 피격 움찔만 이벤트로 받는다(슈퍼아머라 자세는 깨지지 않는다). 나머지 연출은 전부 상태에서 읽는다.
   * @param {string} name @param {any} payload
   */
  function onEvent(name, payload) {
    if (name !== EV.HIT || !payload || payload.target !== 'boss' || payload.outcome !== 'hit') return;
    if (typeof payload.dir !== 'number' || root.visible === false) return;
    // 힘의 방향(월드 각)을 몸 로컬로: 앞에서 맞으면 뒤로, 옆에서 맞으면 반대 옆으로 밀린다
    const rel = payload.dir - root.rotation.y;
    flinchFwd = Math.cos(rel);
    flinchSide = Math.sin(rel);
    flinch = FLINCH_DUR * (payload.heavy || payload.crit ? 1 : 0.7);
  }

  return {
    root,
    rig,
    update,
    onEvent,
    dispose() {
      for (const g of ownGeoms) g.dispose();
      for (const m of ownMats) m.dispose();
      puffTex.dispose();
      rig.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}
