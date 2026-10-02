// OWNER: P5 — 계약 §9.6 (보스 뷰) · §8.10
// 잿빛 기사 발더: 뿔 투구 · 큰 견갑 · 찢어진 망토 · 대검. pose 9종 + 상태 10종.
// 포즈 표는 도(°) · 키 1.8m 기준으로 적는다(위치 오프셋은 실제 키로 키운다). 대검은 두 손으로 쥔다 —
// 표에는 오른팔과 몸만 적고 왼손은 리그의 IK가 자루에 붙인다(cast만 한 손).
// 세로 동작은 몸통 · 어깨 · 팔꿈치 · 손목의 rx 합 Θ가 날의 각이다(0 = 앞, −90 = 위, ±180 = 뒤, +90 = 아래).
import * as THREE from 'three';
import { DT } from '../../core/constants.js';
import { VALDER } from '../../data/bosses/valder.js';
import { COMBAT } from '../../data/combat.js';
import { PALETTE } from '../../data/palette.js';
import { buildHumanoidRig } from '../characters/rig.js';
import { createBossGreatsword } from '../characters/weaponMeshes.js';
import { ease, emptyPose, poseDeg, lerpPose, copyPose, addRot, addPos, attackPose, bossReleaseT, applyGait, PoseBlender } from '../characters/pose.js';

/** @typedef {import('../../types.js').BossView} BossView */
/** @typedef {import('../../types.js').BossState} BossState */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').PoseSet} PoseSet */

const TAU = Math.PI * 2;
const U = VALDER.height / 1.8;

// 연출 상수
const BULK = 1.35;
// 대검 전체 길이(m). 판정 창(±0.1초) 동안 칼끝이 보스 중심에서 수평으로 닿는 거리는 2.9~3.4m다
// (slash_r 2.95 · slash_l 3.23 · delayed_cleave 3.07 · spin_slash 2.89 · overhead 3.40 — weaponTip 소켓을 실제 sim과 돌려 쟀다).
// 종전 주석의 「팔 + 날이 판정 반경(4.2~5.0m)에 닿는다」는 실측과 달랐다.
// 표식 없는 근접 판정은 이 보이는 도달 거리에 맞춰져 있다(data/bosses/valder.js · test/regress.w5.test.js가 +0.7m 안을 지킨다).
// **이 길이나 공격 포즈의 뻗는 정도를 바꾸면 판정도 같이 바꿔야 한다.**
const SWORD_LENGTH = 2.9;
const HL_DEFAULT = 0.07;         // 포즈 블렌더 반감기(초) — 무거운 몸
const HL_ATTACK = 0.015;         // 공격 중(§9.5 — 화면의 무기가 sim 판정보다 늦지 않게)
const HL_HURT = 0.035;
const IK_LAMBDA = 14;
const GROUND_LAMBDA = 22;        // 발 붙이기 가중치 추종(도약의 이륙 · 착지가 툭 끊기지 않게)
const AMP_LAMBDA = 8;
const GAIT_AMP = 0.88;           // 걸음 진폭 — 보폭(stride 1.6m)을 다리(1.23m)가 실제로 딛는 각(±33°)에 맞춘다. 0.62면 디딘 발이 걸음의 4할을 미끄러진다
const BREATH_RATE = 1.2;         // rad/s
const ROAR_AT_INTRO = 0.5;       // 초(§9.6)
const ROAR_AT_SHIFT = 0.6;
const ROAR_LEN = 1.3;            // 포효를 버티는 시간(초)
const DEATH_FADE_FROM = 0.45;    // 사망 진행도 이 지점부터 흩어진다
const DEATH_SINK = 0.55;         // 가라앉는 깊이(m)
const PHASE2_BOOST = 1.0;        // 2페이즈: 강조 재질 발광 (1 + 이 값)배
const ENCHANT_LAMBDA = 3;        // 인챈트가 날에 번지는 속도
const GRIP_NEAR = 0.7;           // 왼손을 오른손 가까이 쥔다(넓은 어깨로도 자루에 닿게)

/** @param {Record<string, number[]>} rot @param {Record<string, number[]>} [pos] @returns {Pose} */
function D(rot, pos) {
  const p = poseDeg(rot, pos);
  for (const k in p.pos) {
    p.pos[k][0] *= U; p.pos[k][1] *= U; p.pos[k][2] *= U;
  }
  return p;
}

// ── 다리 묶음(왼발이 앞) ──
const LEGS_STAND = { hipL: [-14, 8, 8], kneeL: [18, 0, 0], hipR: [8, -16, -10], kneeR: [14, 0, 0] };
const LEGS_COIL = { hipL: [-24, 6, 8], kneeL: [26, 0, 0], hipR: [8, -22, -12], kneeR: [46, 0, 0] };
const LEGS_LUNGE = { hipL: [-60, 4, 6], kneeL: [70, 0, 0], hipR: [32, -12, -8], kneeR: [12, 0, 0] };
const LEGS_WIDE = { hipL: [-36, 10, 14], kneeL: [50, 0, 0], hipR: [22, -18, -16], kneeR: [32, 0, 0] };
const LEGS_CROUCH = { hipL: [-84, 4, 12], kneeL: [104, 0, 0], hipR: [-34, -8, -12], kneeR: [112, 0, 0] };
/** 한쪽 무릎을 꿇는다(오른 무릎이 땅) */
const LEGS_KNEEL = { hipL: [-88, 6, 10], kneeL: [96, 0, 0], hipR: [6, -8, -8], kneeR: [106, 0, 0] };

/** 대기: 대검을 앞으로 낮게 늘어뜨린 자세(끝이 바닥 가까이) — 치켜드는 예고와 대비된다 */
const IDLE = D({ hips: [0, -14, 0], spine: [8, 6, 0], chest: [4, 6, 0], head: [-6, 2, 0],
  shoulderR: [-20, 0, 14], elbowR: [-30, 0, 0], handR: [68, 0, 0], ...LEGS_STAND });

/**
 * pose 키 → 포즈 묶음(§8.10의 9종). delayed는 holdAt 0.35(자세가 일찍 완성돼 멈췄다가 마지막 0.18초에 내려친다).
 * 실루엣 규칙: 예고와 판정의 무기 끝이 2m 이상 떨어진다(rig.test.js가 잰다).
 * @type {Record<string, PoseSet>}
 */
export const VALDER_POSES = {
  // 오른 어깨 위로 높이 메었다가 왼쪽으로 가로 베기
  slashR: {
    windup: D({ hips: [0, -12, 0], spine: [-4, -8, 0], chest: [-4, -8, 0], head: [6, 28, 0],
      shoulderR: [-85, 10, 12], elbowR: [-100, 0, 0], handR: [50, -40, 0], ...LEGS_COIL }),
    active: D({ hips: [0, 22, 0], spine: [16, 14, 0], chest: [8, 12, 0], head: [-12, -36, 0],
      shoulderR: [-50, 25, 24], elbowR: [-30, 0, 0], handR: [55, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, 30, 0], spine: [26, 18, 0], chest: [10, 16, 0], head: [-16, -46, 0],
      shoulderR: [-35, 45, 24], elbowR: [-35, 0, 0], handR: [66, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.05, 0] }),
  },
  // 왼 어깨 위에서 오른쪽으로 되베기(연속기)
  slashL: {
    windup: D({ hips: [0, 18, 0], spine: [-6, 12, 0], chest: [-6, 10, 0], head: [8, -30, 0],
      shoulderR: [-85, 50, 15], elbowR: [-105, 0, 0], handR: [55, 36, 0], ...LEGS_STAND }),
    active: D({ hips: [0, -22, 0], spine: [16, -14, 0], chest: [8, -12, 0], head: [-12, 36, 0],
      shoulderR: [-50, -20, 16], elbowR: [-30, 0, 0], handR: [55, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -30, 0], spine: [26, -18, 0], chest: [10, -16, 0], head: [-16, 46, 0],
      shoulderR: [-35, -34, 16], elbowR: [-35, 0, 0], handR: [66, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.05, 0] }),
  },
  // 머리 뒤로 젖혔다가 정면으로 내려찍기
  overhead: {
    windup: D({ spine: [-18, 0, 0], chest: [-12, 0, 0], head: [18, 0, 0],
      shoulderR: [-155, 0, 12], elbowR: [-55, 0, 0], handR: [95, 0, 0], ...LEGS_COIL }),
    active: D({ spine: [34, 0, 0], chest: [18, 0, 0], head: [-30, 0, 0],
      shoulderR: [-70, 0, 15], elbowR: [-20, 0, 0], handR: [58, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.05, 0] }),
    follow: D({ spine: [44, 0, 0], chest: [20, 0, 0], head: [-32, 0, 0],
      shoulderR: [-55, 0, 22], elbowR: [-25, 0, 0], handR: [32, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.12, 0] }),
  },
  // 찌르기 돌진: 어깨 높이로 세워 겨눴다가(끝이 위-앞) 몸째로 내지른다
  thrust: {
    windup: D({ hips: [0, -30, 0], spine: [0, -12, 0], chest: [-4, -10, 0], head: [0, 50, 0],
      shoulderR: [30, 40, 5], elbowR: [-120, 0, 0], handR: [40, 0, 0], ...LEGS_COIL }, { hips: [0, -0.08, 0] }),
    active: D({ hips: [0, -8, 0], spine: [22, -4, 0], chest: [8, -3, 0], head: [-22, 14, 0],
      shoulderR: [-40, 15, 20], elbowR: [-50, 0, 0], handR: [62, 0, 0], ...LEGS_LUNGE }),
    follow: D({ hips: [0, -8, 0], spine: [34, -4, 0], chest: [8, -3, 0], head: [-20, 14, 0],
      shoulderR: [-15, 15, 20], elbowR: [-60, 0, 0], handR: [54, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.06, 0] }),
  },
  // 도약 내려찍기: 웅크려 뛰어올라(공중에서 몸을 젖히고) 착지하며 꽂는다
  leap: {
    windup: D({ hips: [-10, 0, 0], spine: [-20, 0, 0], chest: [-14, 0, 0], head: [16, 0, 0],
      shoulderR: [-160, 0, 12], elbowR: [-70, 0, 0], handR: [130, 0, 0],
      hipL: [-74, 0, 10], kneeL: [112, 0, 0], hipR: [-26, 0, -10], kneeR: [104, 0, 0] }),
    active: D({ spine: [40, 0, 0], chest: [20, 0, 0], head: [-34, 0, 0],
      shoulderR: [-60, 0, 22], elbowR: [-15, 0, 0], handR: [24, 0, 0], ...LEGS_CROUCH }),
    follow: D({ spine: [44, 0, 0], chest: [20, 0, 0], head: [-30, 0, 0],
      shoulderR: [-50, 0, 22], elbowR: [-25, 0, 0], handR: [20, 0, 0], ...LEGS_CROUCH }),
  },
  // 등 뒤의 상대를 한 바퀴 돌며 벤다: 허리 뒤로 낮게 감았다가 푼다(판정의 회전은 update가 hips에 덧붙인다)
  spin: {
    windup: D({ hips: [0, -40, 0], spine: [12, -24, 0], chest: [4, -18, 0], head: [-10, 70, 0],
      shoulderR: [15, 0, 10], elbowR: [-25, 0, 0], handR: [124, 0, 0], ...LEGS_COIL }, { hips: [0, -0.1, 0] }),
    active: D({ hips: [0, 30, 0], spine: [12, 18, 0], chest: [6, 14, 0], head: [-10, -40, 0],
      shoulderR: [-50, 25, 24], elbowR: [-30, 0, 0], handR: [62, 0, 0], ...LEGS_WIDE }),
    follow: D({ hips: [0, 38, 0], spine: [24, 20, 0], chest: [10, 16, 0], head: [-14, -50, 0],
      shoulderR: [-35, 45, 24], elbowR: [-35, 0, 0], handR: [70, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.08, 0] }),
  },
  // 불의 파동: 대검을 하늘로 곧게 치켜들었다가 발밑에 내리꽂는다
  slamGround: {
    windup: D({ spine: [-4, 0, 0], chest: [-4, 0, 0], head: [-14, 0, 0],
      shoulderR: [-170, 0, 10], elbowR: [-20, 0, 0], handR: [104, 0, 0], ...LEGS_STAND }),
    active: D({ spine: [38, 0, 0], chest: [18, 0, 0], head: [-26, 0, 0],
      shoulderR: [-55, 0, 16], elbowR: [-50, 0, 0], handR: [119, 0, 0], ...LEGS_KNEEL }),
    follow: D({ spine: [44, 0, 0], chest: [20, 0, 0], head: [-10, 0, 0],
      shoulderR: [-50, 0, 16], elbowR: [-55, 0, 0], handR: [116, 0, 0], ...LEGS_KNEEL }),
  },
  // 지연 베기: 오른쪽 위로 높이 세운 채 멈췄다가(가짜 정지) 크게 왼쪽 아래로 가른다
  delayed: {
    holdAt: 0.35,
    windup: D({ hips: [0, -34, 0], spine: [-10, -18, 0], chest: [-8, -14, 0], head: [10, 56, 0],
      shoulderR: [-120, 10, 10], elbowR: [-60, 0, 0], handR: [86, -34, 0], ...LEGS_COIL }, { hips: [0, -0.06, 0] }),
    active: D({ hips: [0, 28, 0], spine: [24, 18, 0], chest: [10, 14, 0], head: [-18, -44, 0],
      shoulderR: [-45, 35, 24], elbowR: [-25, 0, 0], handR: [60, 0, 0], ...LEGS_LUNGE }, { hips: [0, -0.04, 0] }),
    follow: D({ hips: [0, 36, 0], spine: [34, 20, 0], chest: [12, 16, 0], head: [-20, -50, 0],
      shoulderR: [-30, 50, 24], elbowR: [-30, 0, 0], handR: [72, 0, 0], ...LEGS_WIDE }, { hips: [0, -0.1, 0] }),
  },
  // 불기둥 시전: 웅크려 왼 주먹에 불을 모았다가, 왼손을 내뻗고 대검을 치켜든다(한 손)
  cast: {
    windup: D({ hips: [0, 10, 0], spine: [20, 6, 0], chest: [10, 4, 0], head: [10, 0, 0],
      shoulderR: [-10, 0, -22], elbowR: [-20, 0, 0], handR: [28, 0, 0],
      shoulderL: [-50, -30, 10], elbowL: [-118, 0, 0], ...LEGS_COIL }, { hips: [0, -0.06, 0] }),
    active: D({ hips: [0, -10, 0], spine: [-12, -6, 0], chest: [-10, -4, 0], head: [-16, 0, 0],
      shoulderR: [-150, 0, -40], elbowR: [-10, 0, 0], handR: [70, 0, 0],
      shoulderL: [-110, 0, 24], elbowL: [-8, 0, 0], ...LEGS_STAND }),
    follow: D({ hips: [0, -6, 0], spine: [-4, -4, 0], chest: [-4, -2, 0], head: [-8, 0, 0],
      shoulderR: [-120, 0, -44], elbowR: [-30, 0, 0], handR: [60, 0, 0],
      shoulderL: [-80, 0, 30], elbowL: [-30, 0, 0], ...LEGS_STAND }),
  },
};

/** 왼손을 자루에서 떼는 포즈 */
const ONE_HANDED = { cast: true };

// ── 상태 포즈 ──
/** 포효: 두 팔을 벌리고 가슴을 내밀며 젖힌다 */
const ROAR = D({ spine: [-18, 0, 0], chest: [-16, 0, 0], head: [-26, 0, 0],
  shoulderR: [-20, -20, -74], elbowR: [-30, 0, 0], handR: [40, 0, 0],
  shoulderL: [-20, 20, 74], elbowL: [-40, 0, 0], ...LEGS_WIDE });
/** 웅크림(포효 직전) */
const HUNCH = D({ spine: [34, 0, 0], chest: [20, 0, 0], head: [24, 0, 0],
  shoulderR: [-30, 0, 16], elbowR: [-70, 0, 0], handR: [110, 0, 0], ...LEGS_CROUCH });
/** 무릎 꿇고 대검에 기댄다(그로기 · 등장) */
const KNEEL = D({ hips: [0, -8, 0], spine: [30, 4, 0], chest: [18, 0, 0], head: [30, 0, 0],
  shoulderR: [-40, 0, 16], elbowR: [-50, 0, 0], handR: [104, 0, 0], ...LEGS_KNEEL });
/** 패링당함: 대검이 오른쪽 위로 튕겨 나가고 몸이 열린다 */
const PARRIED = D({ hips: [0, -20, 0], spine: [-20, -12, 0], chest: [-14, -10, 0], head: [-12, 20, 0],
  shoulderR: [-120, -40, -50], elbowR: [-30, 0, 0], handR: [30, 0, 0],
  shoulderL: [-10, 20, 50], elbowL: [-40, 0, 0],
  hipL: [-30, 8, 10], kneeL: [26, 0, 0], hipR: [24, -16, -12], kneeR: [52, 0, 0] }, { hips: [0, -0.04, -0.12] });
/** 처형당함: 크게 젖혀진다 */
const EXECUTED = D({ hips: [-10, 0, 0], spine: [-34, 0, 0], chest: [-24, 0, 0], head: [-34, 0, 0],
  shoulderR: [-10, -30, -70], elbowR: [-20, 0, 0], handR: [60, 0, 0],
  shoulderL: [-10, 30, 70], elbowL: [-20, 0, 0], ...LEGS_KNEEL }, { hips: [0, 0, -0.1] });
const DEAD_KNEEL = D({ hips: [10, 0, 0], spine: [36, 6, 0], chest: [22, 0, 0], head: [40, 0, 8],
  shoulderR: [6, 0, -14], elbowR: [-10, 0, 0], handR: [80, 0, 0],
  shoulderL: [6, 0, 12], elbowL: [-10, 0, 0],
  hipL: [-16, 0, 10], kneeL: [120, 0, 0], hipR: [-8, 0, -10], kneeR: [116, 0, 0] }, { hips: [0, -0.5, 0] });
const DEAD_FLAT = D({ hips: [82, 0, 0], spine: [6, 0, 8], chest: [2, 0, 0], head: [-10, 50, 0],
  shoulderR: [-30, 0, -60], elbowR: [-30, 0, 0], handR: [95, 0, 0],
  shoulderL: [-150, 0, 40], elbowL: [-40, 0, 0],
  hipL: [8, 0, 12], kneeL: [14, 0, 0], hipR: [0, 0, -8], kneeR: [30, 0, 0] }, { hips: [0, -0.78, 0.25] });

/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @param {number} a @param {number} b @param {number} v */
const ramp = (a, b, v) => clamp01((v - a) / (b - a));

/**
 * 잿빛 기사 발더의 뷰를 만든다. root의 위치 · rotation.y는 CharacterLayer가 넣는다(+Z가 앞).
 * @returns {BossView}
 */
export function createValderView() {
  const def = VALDER;
  const root = new THREE.Group();
  root.name = 'boss:valder';
  const rig = buildHumanoidRig({ height: def.height, bulk: BULK, palette: PALETTE.valder, helmet: 'horned', cape: true,
    heavy: true, accentGlow: 2.6 });
  root.add(rig.root);

  const sword = createBossGreatsword({ length: SWORD_LENGTH, core: PALETTE.valder.accent });
  rig.sockets.weapon.add(sword.object);
  rig.sockets.weaponBase.position.y = sword.base;
  rig.sockets.weaponTip.position.y = sword.tip;
  rig.sockets.gripL.position.y = sword.gripL * GRIP_NEAR;

  const blender = new PoseBlender(rig, HL_DEFAULT);
  const pose = emptyPose();
  const poseKeys = Object.keys(VALDER_POSES);
  /** @type {Record<string, boolean>} */
  const warned = {};
  let gait = 0;
  let amp = 0;
  let ikW = 1;
  let groundW = 1;
  let time = 0;
  let enchant = 0;
  let lastSeq = -1;
  let lastPhase = '';

  /**
   * @param {BossState} boss
   * @param {{alpha:number, dt:number, time:number, state:GameState}} info
   */
  function update(boss, info) {
    const dt = info.dt;
    const simDt = info.state && info.state.hitstop > 0 ? 0 : dt;
    time += dt;
    const t = boss.stateTime;
    const prog = boss.stateDur > 0 ? clamp01(t / boss.stateDur) : 0;

    let halfLife = HL_DEFAULT;
    let ik = 1;
    let ground = boss.y > 0.05 ? 0 : 1;
    let gaitAmp = 0;
    let spin = 0;
    let gust = boss.phase === 2 ? 0.25 : 0;
    let snap = false;
    let glowStyle = 'none';
    let glowAmt = 0;
    let dead = 0;

    switch (boss.state) {
      case 'attack': {
        const a = boss.attack;
        if (!a) { copyPose(IDLE, pose); break; }
        let set = VALDER_POSES[a.pose];
        if (!set) {
          if (!warned[a.pose]) {
            warned[a.pose] = true;
            console.warn(`[valderView] 모르는 pose '${a.pose}' — '${poseKeys[0]}'로 대신한다`);
          }
          set = VALDER_POSES[poseKeys[0]];
        }
        attackPose(set, IDLE, a.phase, a.phaseT, pose, bossReleaseT(a.windup));
        if (ONE_HANDED[a.pose]) ik = a.phase === 'recovery' ? ramp(0.5, 1, a.phaseT) : 0;
        if (a.pose === 'spin' && a.phase === 'active') spin = TAU * ease.outQuad(clamp01(a.phaseT));
        glowStyle = a.glow;
        glowAmt = a.phase === 'windup' ? clamp01(a.phaseT) : a.phase === 'active' ? 1 : 1 - clamp01(a.phaseT * 3);
        snap = a.phase === 'active' && (a.seq !== lastSeq || lastPhase !== 'active');
        lastSeq = a.seq;
        lastPhase = a.phase;
        halfLife = HL_ATTACK;
        break;
      }
      case 'chase': {
        copyPose(IDLE, pose);
        gaitAmp = 1;
        break;
      }
      case 'intro': {
        // 무릎 꿇은 채 등장 → 일어서며 0.5초에 포효 → 자세를 잡는다
        const roarEnd = ROAR_AT_INTRO + 0.75;
        if (t < ROAR_AT_INTRO) lerpPose(KNEEL, ROAR, ease.inCubic(t / ROAR_AT_INTRO), pose);
        else if (t < roarEnd) { copyPose(ROAR, pose); addRot(pose, 'chest', 0.03 * Math.sin(time * 40), 0, 0); }
        else lerpPose(ROAR, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        ik = t < ROAR_AT_INTRO * 0.6 ? 1 : t < roarEnd ? 0 : ramp(roarEnd, roarEnd + 0.3, t);
        gust = t > ROAR_AT_INTRO * 0.8 && t < roarEnd ? 1 : gust;
        break;
      }
      case 'phaseShift': {
        const roarEnd = ROAR_AT_SHIFT + ROAR_LEN;
        if (t < ROAR_AT_SHIFT) lerpPose(IDLE, HUNCH, ease.outCubic(t / (ROAR_AT_SHIFT * 0.8)), pose);
        else if (t < roarEnd) {
          lerpPose(HUNCH, ROAR, ease.outBack(ramp(ROAR_AT_SHIFT, ROAR_AT_SHIFT + 0.3, t)), pose);
          addRot(pose, 'chest', 0.035 * Math.sin(time * 44), 0, 0);
          addRot(pose, 'head', 0.03 * Math.sin(time * 37), 0, 0);
        } else lerpPose(ROAR, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        ik = t < ROAR_AT_SHIFT ? 1 : t < roarEnd ? 0 : ramp(roarEnd, roarEnd + 0.3, t);
        gust = t >= ROAR_AT_SHIFT && t < roarEnd ? 1 : gust;
        halfLife = t >= ROAR_AT_SHIFT && t < ROAR_AT_SHIFT + 0.3 ? HL_HURT : HL_DEFAULT;
        break;
      }
      case 'parried': {
        const k = ease.outCubic(ramp(0, 0.14, prog)) * (1 - ease.inOutQuad(ramp(0.62, 1, prog)));
        lerpPose(IDLE, PARRIED, k, pose);
        ik = 1 - k;
        halfLife = HL_HURT;
        break;
      }
      case 'groggy': {
        lerpPose(IDLE, KNEEL, ease.outCubic(ramp(0, 0.45, t)), pose);
        // 거친 숨
        const b = Math.sin(time * 3.4);
        addRot(pose, 'spine', 0.04 * b, 0, 0);
        addRot(pose, 'chest', 0.05 * b, 0, 0);
        addRot(pose, 'head', 0.03 * b, 0, 0.02 * Math.sin(time * 1.7));
        break;
      }
      case 'executed': {
        const k = ease.outCubic(ramp(0, 0.12, prog)) * (1 - ease.inOutQuad(ramp(0.5, 1, prog)));
        lerpPose(KNEEL, EXECUTED, k, pose);
        addRot(pose, 'spine', 0, 0, 0.05 * Math.sin(t * 50) * k);
        ik = 1 - k;
        halfLife = HL_HURT;
        break;
      }
      case 'recover': {
        lerpPose(KNEEL, IDLE, ease.inOutQuad(prog), pose);
        break;
      }
      case 'dead': {
        dead = clamp01(t / Math.max(0.1, COMBAT.outroVictory - 0.4));
        if (dead < 0.3) lerpPose(IDLE, DEAD_KNEEL, ease.inOutQuad(dead / 0.3), pose);
        else lerpPose(DEAD_KNEEL, DEAD_FLAT, ease.inQuad(ramp(0.36, 0.7, dead)), pose);
        ground = 1 - ramp(0.05, 0.28, dead);
        ik = 0;
        gust = 0;
        break;
      }
      default: { // idle
        copyPose(IDLE, pose);
        break;
      }
    }
    if (boss.state !== 'attack') lastPhase = '';

    // 걸음: sim 틱의 이동량으로 속도를 잰다(보스 상태에는 속도 필드가 없다)
    const dx = boss.pos.x - boss.prevPos.x;
    const dz = boss.pos.z - boss.prevPos.z;
    const speed = Math.hypot(dx, dz) / DT;
    const sn = Math.sin(boss.facing);
    const cs = Math.cos(boss.facing);
    const vf = (dx * sn + dz * cs) / DT;
    const vs = (-dx * cs + dz * sn) / DT;
    const speedK = clamp01(speed / Math.max(0.1, def.moveSpeed));
    amp += (gaitAmp * speedK * GAIT_AMP - amp) * (1 - Math.exp(-AMP_LAMBDA * dt));
    if (amp > 0.01) {
      gait = (gait + (speed * simDt) / (2 * Math.max(0.2, def.stride))) % 1;
      const inv = speed > 0.05 ? 1 / speed : 0;
      applyGait(pose, gait, amp, Math.max(-1, Math.min(1, vf * inv)), Math.max(-1, Math.min(1, vs * inv)), 0, 0.25);
      // 무거운 걸음: 디딜 때마다 상체가 실린다
      addRot(pose, 'spine', 0.08 * amp * Math.abs(Math.sin(gait * TAU)), 0, 0);
    }

    // 호흡
    if (boss.state !== 'dead') {
      const b = Math.sin(time * BREATH_RATE);
      addRot(pose, 'chest', 0.022 * b, 0, 0);
      addRot(pose, 'spine', 0.01 * b, 0, 0);
      addRot(pose, 'head', -0.014 * b, 0, 0);
      addPos(pose, 'chest', 0, 0.006 * U * b, 0);
    }

    if (snap) blender.snap(pose);
    else blender.update(pose, dt, halfLife);

    // ── 블렌더 뒤: 한 바퀴 회전 · 발 붙이기 · 왼손 IK ──
    if (spin !== 0) rig.joints.hips.rotation.y += spin;
    groundW += (ground - groundW) * (1 - Math.exp(-GROUND_LAMBDA * dt));
    rig.groundFeet(groundW);
    ikW += (ik - ikW) * (1 - Math.exp(-IK_LAMBDA * dt));
    if (ikW > 0.01) rig.ikLeftHand(rig.sockets.gripL, ikW);

    // ── 발광: 예고 발광 · 2페이즈 · 인챈트 ──
    rig.setGlow(/** @type {any} */ (glowStyle), glowAmt);
    rig.setBoost((boss.phase === 2 ? PHASE2_BOOST : 0) + dead * 2);
    const wantEnchant = boss.ext && boss.ext.enchanted ? 1 : 0;
    enchant += (wantEnchant - enchant) * (1 - Math.exp(-ENCHANT_LAMBDA * dt));
    sword.setEnchant(boss.state === 'dead' ? enchant * (1 - dead) : enchant);

    // ── 사망: 가라앉으며 흩어진다. 다시 살아나면(재도전) 되돌린다 ──
    if (boss.state === 'dead') {
      rig.root.position.y = -DEATH_SINK * ease.inQuad(ramp(DEATH_FADE_FROM, 1, dead));
      rig.setOpacity(1 - ramp(DEATH_FADE_FROM, 1, dead));
      sword.setOpacity(1 - ramp(DEATH_FADE_FROM, 1, dead));
      root.visible = dead < 1;
    } else {
      rig.root.position.y = 0;
      rig.setOpacity(1);
      sword.setOpacity(1);
      root.visible = true;
    }

    if (rig.cape) {
      const bp = blender.pose.rot;
      const lean = (bp.hips ? bp.hips[0] : 0) + (bp.spine ? bp.spine[0] : 0) + (bp.chest ? bp.chest[0] : 0);
      rig.cape.update(dt, time, lean, vf / Math.max(0.1, def.moveSpeed), vs / Math.max(0.1, def.moveSpeed), gust);
    }
  }

  return {
    root,
    rig,
    update,
    /** 연출은 전부 상태에서 읽는다 — 이벤트로 따로 할 일이 없다. */
    onEvent(_name, _payload) {},
    dispose() {
      sword.dispose();
      rig.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}
