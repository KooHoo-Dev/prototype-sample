// OWNER: P11 — 계약 §9.6 (보스 뷰) · §8.12
// 심연의 군주 니힐: 부유하는 마술사. 두건 속의 어둠과 빛나는 눈 · 가시 왕관 · 머리 뒤의 후광 · 찢어진 망토와 긴 자락 ·
// 오른손의 지팡이(낫 베기 때는 머리에서 심연의 날이 펼쳐져 낫이 된다) · 몸 둘레를 도는 파편. pose 7종 + 상태 10종.
//
// 높이: sim이 boss.y = hoverY로 root를 이미 올린다(CharacterLayer) → 리그는 hover 0 · height = def.height − hoverY.
//   그로기 · 처형 · 사망에서는 뷰가 rig.root를 그만큼 다시 내려 **지면에 무릎 꿇린다**(sim의 y는 그대로 — §8.12).
// 소켓: handL = 시전 손(cast 큐의 섬광 · 광선의 원점 — fx가 읽는다). 광선은 손 높이에서 수평으로 나가므로
//   시전 자세(castOrbs · beam)는 몸을 낮추고 숙여 손을 플레이어 몸 높이(지면 1.3~1.6m)까지 내린다.
//   weaponBase/Tip = 평소에는 지팡이 머리 한 점(궤적 리본이 생기지 않는다), 낫 베기 때만 날의 뿌리 → 끝,
//   심연 폭발 때는 몸의 중심(지면) 한 점(fx의 `slam` 충격이 폭발 원의 한가운데에서 난다).
// 포즈 표는 도(°). 세로 동작은 core · chest · shoulder · elbow · hand의 rx 합 Θ가 지팡이의 각이다
// (0 = 앞, −90 = 위, +90 = 아래). 팔은 Θ(손 제외)가 0이면 아래로 늘어지고 −90이면 수평 앞이다.
import * as THREE from 'three';
import { DT } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { NIHIL, NIHIL_EXT } from '../../data/bosses/nihil.js';
import { COMBAT } from '../../data/combat.js';
import { PALETTE } from '../../data/palette.js';
import { buildFloaterRig, Cape } from '../characters/rig.js';
import { PartBuilder, box, cyl, cone, wedge, tubePath, place } from '../characters/geo.js';
import { ease, emptyPose, poseDeg, lerpPose, copyPose, addRot, addPos, attackPose, bossReleaseT, PoseBlender } from '../characters/pose.js';

/** @typedef {import('../../types.js').BossView} BossView */
/** @typedef {import('../../types.js').BossState} BossState */
/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').PoseSet} PoseSet */

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ── 연출 상수 ──
const BODY_HEIGHT = NIHIL.height - NIHIL_EXT.hoverY;   // 리그의 몸 높이(m) — 자락 끝 ~ 두건 끝
/** 로브 색. PALETTE.nihil.robe(0x1a1226)는 심연 제단의 안개보다 어두워 몸이 사라진다 — 잿빛 도는 연보라로 올려 실루엣을 남긴다 */
const ROBE_COLOR = 0x5a5478;
const HL_DEFAULT = 0.085;        // 포즈 블렌더 반감기(초) — 물속처럼 느리게 흐르는 몸
const HL_ATTACK = 0.015;         // 공격 중(§9.5 — 화면의 손이 sim 판정보다 늦지 않게)
const HL_HURT = 0.035;
const BOB_RATE = 1.5;            // 부유 출렁임(rad/s)
const BOB_AMP = 0.07;            // m
const SWAY_RATE = 0.9;
const LEAN_FWD = 0.2;            // 이동 속도 비 1에서 몸이 기우는 각(rad)
const LEAN_SIDE = 0.16;
const ROBE_TRAIL = 0.38;         // 자락이 이동 반대로 끌리는 각(rad)
const VEL_LAMBDA = 5;            // 자락이 속도를 따라가는 빠르기(늦게 따라와 흐느적거린다)
const TURN_TWIST = 0.05;         // 몸이 돌 때 자락이 비틀리는 양(rad per rad/s)
const HALO_SPIN = 0.5;           // rad/s
const HALO_SPIN_CAST = 5.0;      // 시전 중
const RING2_SPIN = -0.35;
const RING2_LAMBDA = 2.2;        // 2페이즈 고리가 펼쳐지는 빠르기
const SHARD_COUNT = 4;
const SHARD_RADIUS = 0.82;       // 파편 궤도 반경(m)
const SHARD_RADIUS_GATHER = 0.4; // 예고 중에는 안으로 모여 빨리 돈다
const SHARD_SPIN = 0.9;          // rad/s
const SHARD_SPIN_GATHER = 5.5;
const GATHER_LAMBDA = 7;
const VANISH_FROM = 0.3;         // blink 예고의 이 지점부터 사라지기 시작한다
const VANISH_SQUEEZE = 0.04;     // 사라질 때의 가로 배율(세로로 길게 빨려 든다)
const VANISH_STRETCH = 1.55;
const APPEAR_DUR = 0.3;          // 등장 연출 길이(초) — 순간이동 뒤 · 인트로
const APPEAR_FADE = 0.55;        // 그 가운데 이 비율 안에 불투명해진다
const INTRO_FORM = 0.5;          // 인트로: 이 시각까지 형체를 갖춘다(§9.6 — 0.5초에 포효)
const ROAR_LEN_INTRO = 0.7;
const ROAR_AT_SHIFT = 0.6;
const ROAR_LEN_SHIFT = 1.3;
const FALL_GRAVITY = 22;         // 그로기 추락(지면 비율/s²) — 0.27초쯤에 닿는다
const RISE_LAMBDA = 5.5;         // 다시 떠오르는 빠르기
const LAND_DIP = 0.16;           // 착지 순간 몸이 눌리는 깊이(m)
const LAND_DECAY = 9;
const HURT_LEAN = 0.16;          // 피격 움찔(rad)
const HURT_DECAY = 9;
const DEATH_FADE_FROM = 0.42;    // 사망 진행도 이 지점부터 흩어진다
const PHASE2_BOOST = 1.0;        // 2페이즈: 강조 재질 발광 (1 + 이 값)배
const BLADE_GROW = 0.5;          // 낫의 날: 예고의 이 비율 안에 다 펼쳐진다
const BLADE_HDR = 2.6;
const SHARD_HDR = 1.9;
const RING2_HDR = 1.7;
const CRYSTAL_GLOW = 2.6;        // 지팡이 수정의 기본 발광
const GLOW_GAIN = 3.0;           // 예고 발광이 최대일 때 더하는 발광
const FLASH_INTENSITY = 0.18;   // rig.js와 같은 값 — 블룸 임계 아래(전신이 흰 덩어리가 되지 않게)
const FLASH_WHITEN = 0.7;
const ORB_INTERVAL = 0.25;       // 구체를 쏠 때마다 손이 튀는 박자(초) — void_orbs의 발사 간격
const ORB_RECOIL = 0.16;         // rad

// 지팡이(무기 소켓 로컬: +Y가 자루 축 · 손이 원점)
const STAFF_BUTT = -0.72;
const STAFF_TOP = 1.26;
const STAFF_HEAD_Y = 1.5;        // 수정의 높이 = 평소의 weaponBase · weaponTip
const BLADE_ROOT = [0.02, 1.3];
/** 낫의 날 중심선(무기 로컬 XY, 뿌리 기준 m)과 반폭 — 자루 머리에서 왼쪽으로 뻗어 아래로 굽는다 */
const BLADE_LINE = [[0, 0], [0.3, 0.17], [0.62, 0.2], [0.94, 0.08], [1.18, -0.16], [1.32, -0.48], [1.34, -0.78]];
const BLADE_HALF = [0.05, 0.1, 0.125, 0.115, 0.09, 0.05, 0];
const BLADE_BASE = [0.3, 1.47];  // 낫 베기 때의 weaponBase(날의 뿌리 쪽)
const BLADE_TIP = [1.36, 0.52];  // weaponTip(날 끝)
/** 날을 자루 축 둘레로 비튼 각(rad) — 가로 베기에서도 날의 면이 정면 카메라에 보인다 */
const BLADE_CANT = -0.6;
const NOVA_BLAST_DUR = 0.42;     // 심연 폭발의 충격 껍질이 퍼지는 시간(초)
const NOVA_BLAST_R0 = 0.6;       // 시작 반경(m). 끝 반경은 판정 반경(데이터)
const NOVA_HDR = 2.2;
const FLAME_SIZE = 0.075;        // 왼손의 심연 불꽃(시전 손의 표지)
const FLAME_GATHER = 0.9;        // 예고가 차오르면 (1 + 이 값)배로 커진다

/** @param {Record<string, number[]>} rot @param {Record<string, number[]>} [pos] @returns {Pose} */
const D = (rot, pos) => poseDeg(rot, pos);

// ── 자락 묶음 ──
const ROBE_HANG = { robe1: [4, 0, 0], robe2: [6, 0, 0], robe3: [8, 0, 0] };
/** 뒤로 날린다(앞으로 숙이거나 내리꽂을 때) */
const ROBE_BACK = { robe1: [22, 0, 0], robe2: [18, 0, 0], robe3: [16, 0, 0] };
/** 앞으로 말린다(웅크릴 때 · 솟구칠 때) */
const ROBE_TUCK = { robe1: [-24, 0, 0], robe2: [-26, 0, 0], robe3: [-24, 0, 0] };
/** 무릎 꿇은 자세: 자락이 뒤로 꺾여 바닥에 깔린다 */
const ROBE_KNEEL = { robe1: [24, 0, 0], robe2: [30, 0, 0], robe3: [20, 0, 0] };

/** 대기: 지팡이를 곧게 세워 들고 왼손을 가볍게 내민 채 떠 있다. 고개는 발밑의 상대를 내려다본다 */
const IDLE = D({ core: [4, 0, 0], chest: [4, 0, 0], head: [10, 0, 0],
  shoulderR: [-22, 0, -16], elbowR: [-70, 0, 0], handR: [0, 0, 0],
  shoulderL: [-14, 0, 14], elbowL: [-52, 0, 0], handL: [-10, 0, 0], ...ROBE_HANG });

/**
 * pose 키 → 포즈 묶음(§8.12의 7종). 시전 종류가 실루엣으로 구분된다:
 *   castOrbs   왼손을 어깨 뒤로 당겨 구체를 빚었다가 → 몸을 낮추며 앞으로 내던진다(한 손 · 지팡이는 뒤로 끌린다)
 *   blink      두 팔로 몸을 감싸 웅크린다 → (사라졌다가) 팔을 펼치며 나타난다
 *   beam       지팡이와 왼손을 머리 위로 치켜든다 → 두 손을 앞으로 모아 내밀고 버틴다(지팡이가 광선과 나란하다)
 *   castGround 왼손을 하늘로 곧게 든다 → 깊이 숙이며 손바닥으로 땅을 가리킨다(지팡이는 등 뒤로 선다)
 *   castSky    두 팔을 가슴 앞에 모으고 가라앉는다 → 두 팔을 하늘로 벌리며 솟구친다
 *   nova       공중에서 몸을 말아 웅크린다(지팡이를 품는다) → 떨어지며 지팡이를 내리꽂고 왼팔을 뿌린다
 *   scythe     낫을 오른쪽 뒤로 크게 감는다 → 왼쪽으로 가로 벤다
 * @type {Record<string, PoseSet>}
 */
export const NIHIL_POSES = {
  castOrbs: {
    windup: D({ core: [-6, 34, 0], chest: [-8, 18, 0], head: [8, -44, 0],
      shoulderL: [-30, 30, 62], elbowL: [-118, 0, 0], handL: [-20, 0, 0],
      shoulderR: [-58, 0, -8], elbowR: [-30, 0, 0], handR: [42, 0, 0], ...ROBE_HANG },
      { core: [0, 0.12, -0.12] }),
    active: D({ core: [24, -22, 0], chest: [14, -12, 0], head: [-30, 30, 0],
      shoulderL: [-84, 14, 6], elbowL: [-4, 0, 0], handL: [-12, 0, 0],
      shoulderR: [34, 0, -24], elbowR: [-14, 0, 0], handR: [40, 0, 0], ...ROBE_BACK },
      { core: [0, -0.3, 0.18] }),
    follow: D({ core: [28, -26, 0], chest: [14, -12, 0], head: [-26, 32, 0],
      shoulderL: [-70, 14, 8], elbowL: [-14, 0, 0], handL: [10, 0, 0],
      shoulderR: [38, 0, -26], elbowR: [-14, 0, 0], handR: [40, 0, 0], ...ROBE_BACK },
      { core: [0, -0.34, 0.2] }),
  },
  blink: {
    holdAt: 0.45,
    windup: D({ core: [14, 0, 0], chest: [16, 0, 0], head: [26, 0, 0],
      shoulderL: [-46, 0, -34], elbowL: [-122, 0, 0], handL: [0, 0, 0],
      shoulderR: [-46, 0, 34], elbowR: [-118, 0, 0], handR: [44, 0, 0], ...ROBE_TUCK },
      { core: [0, 0.1, 0] }),
    active: D({ core: [-8, 0, 0], chest: [-10, 0, 0], head: [-6, 0, 0],
      shoulderL: [-12, 0, 66], elbowL: [-24, 0, 0], handL: [0, 0, 0],
      shoulderR: [-30, 0, -58], elbowR: [-30, 0, 0], handR: [0, -56, 0], ...ROBE_BACK },
      { core: [0, 0.06, 0] }),
    follow: D({ core: [0, 0, 0], chest: [-2, 0, 0], head: [6, 0, 0],
      shoulderL: [-14, 0, 40], elbowL: [-36, 0, 0], handL: [0, 0, 0],
      shoulderR: [-26, 0, -36], elbowR: [-56, 0, 0], handR: [-10, 0, 0], ...ROBE_HANG }),
  },
  beam: {
    holdAt: 0.5,
    windup: D({ core: [-12, 0, 0], chest: [-14, 0, 0], head: [16, 0, 0],
      shoulderL: [-158, 0, 18], elbowL: [-34, 0, 0], handL: [0, 0, 0],
      shoulderR: [-150, 0, -14], elbowR: [-30, 0, 0], handR: [80, 0, 0], ...ROBE_TUCK },
      { core: [0, 0.22, -0.1] }),
    // 왼손바닥이 몸의 중심선 앞(광선의 원점)에 오고, 지팡이는 오른 겨드랑이에 창처럼 끼워 광선과 나란히 겨눈다
    active: D({ core: [28, 0, 0], chest: [16, 0, 0], head: [-36, 0, 0],
      shoulderL: [-90, 0, -26], elbowL: [-6, 0, 0], handL: [-30, 0, 0],
      shoulderR: [-18, 0, -6], elbowR: [-62, 0, 0], handR: [36, 0, 0], ...ROBE_BACK },
      { core: [0, -0.44, 0.1] }),
    follow: D({ core: [38, 0, 0], chest: [20, 0, 0], head: [16, 0, 0],
      shoulderL: [-40, 0, 6], elbowL: [-20, 0, 0], handL: [0, 0, 0],
      shoulderR: [-30, 0, -10], elbowR: [-60, 0, 0], handR: [-10, 0, 0], ...ROBE_HANG },
      { core: [0, -0.44, 0.06] }),
  },
  castGround: {
    windup: D({ core: [-8, 0, 0], chest: [-10, 0, 0], head: [-18, 0, 0],
      shoulderL: [-172, 0, 10], elbowL: [-6, 0, 0], handL: [0, 0, 0],
      shoulderR: [8, 0, -30], elbowR: [-24, 0, 0], handR: [62, 0, 0], ...ROBE_TUCK },
      { core: [0, 0.2, 0] }),
    active: D({ core: [34, 0, 0], chest: [24, 0, 0], head: [-6, 0, 0],
      shoulderL: [-72, 0, 4], elbowL: [-4, 0, 0], handL: [40, 0, 0],
      shoulderR: [-130, 0, -30], elbowR: [-40, 0, 0], handR: [36, 0, 0], ...ROBE_BACK },
      { core: [0, -0.3, 0.12] }),
    follow: D({ core: [38, 0, 0], chest: [26, 0, 0], head: [4, 0, 0],
      shoulderL: [-66, 0, 8], elbowL: [-10, 0, 0], handL: [40, 0, 0],
      shoulderR: [-112, 0, -34], elbowR: [-46, 0, 0], handR: [30, 0, 0], ...ROBE_BACK },
      { core: [0, -0.34, 0.12] }),
  },
  castSky: {
    windup: D({ core: [22, 0, 0], chest: [20, 0, 0], head: [22, 0, 0],
      shoulderL: [-58, 0, -30], elbowL: [-96, 0, 0], handL: [0, 0, 0],
      shoulderR: [-58, 0, 30], elbowR: [-96, 0, 0], handR: [60, 0, 0], ...ROBE_HANG },
      { core: [0, -0.26, 0] }),
    active: D({ core: [-10, 0, 0], chest: [-16, 0, 0], head: [-30, 0, 0],
      shoulderL: [-160, 0, 34], elbowL: [-8, 0, 0], handL: [0, 0, 0],
      shoulderR: [-160, 0, -30], elbowR: [-8, 0, 0], handR: [100, 0, 0], ...ROBE_TUCK },
      { core: [0, 0.38, 0] }),
    follow: D({ core: [16, 0, 0], chest: [14, 0, 0], head: [20, 0, 0],
      shoulderL: [-50, 0, 30], elbowL: [-30, 0, 0], handL: [0, 0, 0],
      shoulderR: [-60, 0, -24], elbowR: [-50, 0, 0], handR: [10, 0, 0], ...ROBE_HANG },
      { core: [0, -0.16, 0] }),
  },
  nova: {
    holdAt: 0.5,
    windup: D({ core: [32, 0, 0], chest: [30, 0, 0], head: [34, 0, 0],
      shoulderL: [-64, 0, -36], elbowL: [-124, 0, 0], handL: [0, 0, 0],
      shoulderR: [-40, 0, 12], elbowR: [-104, 0, 0], handR: [0, 78, 0], ...ROBE_TUCK },
      { core: [0, 0.34, 0] }),
    // 터뜨린다: 가슴을 젖히고 두 팔을 양옆으로 뿌린다(지팡이는 오른팔의 연장선). 몸이 뚝 떨어진다
    active: D({ core: [-16, 0, 0], chest: [-22, 0, 0], head: [-26, 0, 0],
      shoulderL: [-6, 0, 108], elbowL: [-6, 0, 0], handL: [0, 0, 0],
      shoulderR: [-6, 0, -104], elbowR: [-6, 0, 0], handR: [94, 0, 0],
      robe1: [-12, 0, 0], robe2: [16, 0, 0], robe3: [26, 0, 0] },
      { core: [0, -0.46, 0] }),
    // 터뜨린 뒤: 팔이 늘어지고 고개가 떨어진 채 낮게 떠 있다 — 후딜 1.5초의 "지금 때려라"
    follow: D({ core: [30, 0, 0], chest: [24, 0, 0], head: [34, 0, 0],
      shoulderL: [-10, 0, 24], elbowL: [-14, 0, 0], handL: [0, 0, 0],
      shoulderR: [-60, 0, -10], elbowR: [-70, 0, 0], handR: [-14, 0, 0], ...ROBE_HANG },
      { core: [0, -0.52, 0] }),
  },
  scythe: {
    windup: D({ core: [-4, -58, 0], chest: [-6, -32, 0], head: [8, 78, 0],
      shoulderR: [-78, -34, -22], elbowR: [-26, 0, 0], handR: [102, 0, 0],
      shoulderL: [-56, 20, 6], elbowL: [-44, 0, 0], handL: [0, 0, 0], ...ROBE_HANG },
      { core: [0, 0.06, -0.1] }),
    active: D({ core: [16, 46, 0], chest: [10, 30, 0], head: [-16, -64, 0],
      shoulderR: [-84, 36, -6], elbowR: [-8, 0, 0], handR: [84, 0, 0],
      shoulderL: [34, 0, 30], elbowL: [-20, 0, 0], handL: [0, 0, 0], ...ROBE_BACK },
      { core: [0, -0.42, 0.16] }),
    follow: D({ core: [22, 62, 0], chest: [12, 36, 0], head: [-14, -80, 0],
      shoulderR: [-62, 54, -6], elbowR: [-20, 0, 0], handR: [92, 0, 0],
      shoulderL: [30, 0, 34], elbowL: [-24, 0, 0], handL: [0, 0, 0], ...ROBE_BACK },
      { core: [0, -0.46, 0.16] }),
  },
};

// ── 상태 포즈 ──
/** 포효: 두 팔을 활짝 벌리고 가슴을 젖히며 솟는다 */
const ROAR = D({ core: [-12, 0, 0], chest: [-18, 0, 0], head: [-28, 0, 0],
  shoulderL: [-24, 0, 92], elbowL: [-26, 0, 0], handL: [0, 0, 0],
  shoulderR: [-20, 0, -80], elbowR: [-20, 0, 0], handR: [0, -80, 0], ...ROBE_TUCK }, { core: [0, 0.3, 0] });
/** 웅크림(포효 직전 · 등장 직전) */
const CURL = D({ core: [30, 0, 0], chest: [28, 0, 0], head: [32, 0, 0],
  shoulderL: [-60, 0, -34], elbowL: [-122, 0, 0], handL: [0, 0, 0],
  shoulderR: [-64, 0, 32], elbowR: [-114, 0, 0], handR: [32, 0, 0], ...ROBE_TUCK }, { core: [0, -0.1, 0] });
/** 무릎 꿇음(그로기): 지면에 내려앉아 지팡이에 매달리고 왼손으로 땅을 짚는다. 고개가 떨어진다 */
const KNEEL = D({ core: [16, 0, 4], chest: [18, 0, 0], head: [42, 0, 6],
  shoulderL: [-6, 0, 14], elbowL: [-10, 0, 0], handL: [0, 0, 0],
  shoulderR: [-58, 0, -14], elbowR: [-62, 0, 0], handR: [-6, 0, 0], ...ROBE_KNEEL }, { core: [0, -0.36, 0] });
/** 패링당함: 낫이 오른쪽 위로 튕겨 나가고 몸이 뒤로 열린다 */
const PARRIED = D({ core: [-22, -24, 0], chest: [-16, -14, 0], head: [-10, 26, 0],
  shoulderR: [-132, -30, -52], elbowR: [-24, 0, 0], handR: [40, 0, 0],
  shoulderL: [-10, 0, 62], elbowL: [-40, 0, 0], handL: [0, 0, 0], ...ROBE_TUCK }, { core: [0, -0.04, -0.3] });
/** 처형당함: 꿇은 채 크게 젖혀진다 */
const EXECUTED = D({ core: [-30, 0, 0], chest: [-26, 0, 0], head: [-34, 0, 0],
  shoulderL: [-6, 0, 78], elbowL: [-20, 0, 0], handL: [0, 0, 0],
  shoulderR: [-20, 0, -76], elbowR: [-20, 0, 0], handR: [70, 0, 0],
  robe1: [62, 0, 0], robe2: [30, 0, 0], robe3: [10, 0, 0] }, { core: [0, -0.4, -0.12] });
/** 사망 1: 꿇고 고개를 떨군다 → 사망 2: 앞으로 무너져 엎드린다 */
const DEAD_KNEEL = D({ core: [30, 0, -6], chest: [26, 0, 0], head: [44, 0, -8],
  shoulderL: [-4, 0, 16], elbowL: [-8, 0, 0], handL: [0, 0, 0],
  shoulderR: [-20, 0, -18], elbowR: [-16, 0, 0], handR: [-14, 0, 0],
  robe1: [16, 0, 0], robe2: [26, 0, 0], robe3: [18, 0, 0] }, { core: [0, -0.5, 0] });
const DEAD_FLAT = D({ core: [78, 0, -8], chest: [10, 0, 0], head: [8, 30, 0],
  shoulderL: [-150, 0, 34], elbowL: [-30, 0, 0], handL: [0, 0, 0],
  shoulderR: [-40, 0, -50], elbowR: [-20, 0, 0], handR: [-40, 0, 0],
  robe1: [10, 0, 0], robe2: [4, 0, 0], robe3: [2, 0, 0] }, { core: [0, -0.74, 0.2] });

/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** @param {number} a @param {number} b @param {number} v */
const ramp = (a, b, v) => clamp01((v - a) / (b - a));
/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;
/** 지수 감쇠 계수. @param {number} lambda @param {number} dt */
const follow = (lambda, dt) => 1 - Math.exp(-lambda * Math.max(0, dt));

/**
 * 날의 띠 지오메트리(무기 로컬 XY 평면 · 뿌리가 원점). k = 폭 배율(심지는 좁게).
 * @param {number} k
 * @returns {THREE.BufferGeometry}
 */
function bladeStrip(k) {
  const n = BLADE_LINE.length;
  const pos = new Float32Array(n * 2 * 3);
  const index = [];
  for (let i = 0; i < n; i++) {
    const a = BLADE_LINE[Math.max(0, i - 1)];
    const b = BLADE_LINE[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    // 바깥(등) 쪽 = 접선의 왼쪽 법선
    const nx = -ty / tl;
    const ny = tx / tl;
    const w = BLADE_HALF[i] * k;
    const c = BLADE_LINE[i];
    pos.set([c[0] + nx * w, c[1] + ny * w, 0, c[0] - nx * w, c[1] - ny * w, 0], i * 6);
    if (i < n - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/**
 * 심연의 군주 니힐의 뷰를 만든다. root의 위치 · rotation.y는 CharacterLayer가 넣는다(+Z가 앞).
 * @returns {BossView}
 */
export function createNihilView() {
  const def = NIHIL;
  const pal = PALETTE.nihil;
  const voidStyle = PALETTE.style.void;
  const root = new THREE.Group();
  root.name = 'boss:nihil';
  const robeHex = ROBE_COLOR;
  const rig = buildFloaterRig({ hover: 0, height: BODY_HEIGHT, palette: { robe: robeHex, trim: pal.trim, accent: pal.accent }, halo: true });
  root.add(rig.root);

  // ── 덧붙이는 메시(리그 밖의 재질은 이 뷰가 발광 · 점멸 · 투명도 · dispose를 직접 챙긴다) ──
  /** @type {THREE.BufferGeometry[]} */
  const geoms = [];
  const robeColor = new THREE.Color(robeHex);
  const mats = {
    // 리그의 로브와 같은 결: 제 색의 약한 자체 발광으로 어두운 제단에서도 실루엣이 남는다
    cloth: new THREE.MeshStandardMaterial({ color: robeHex, roughness: 0.95, flatShading: true,
      emissive: robeHex, emissiveIntensity: 0.5 }),
    cape: new THREE.MeshStandardMaterial({ color: robeColor.clone().multiplyScalar(0.8), roughness: 1,
      emissive: robeHex, emissiveIntensity: 0.38, side: THREE.DoubleSide }),
    shaft: new THREE.MeshStandardMaterial({ color: 0x2a2436, metalness: 0.55, roughness: 0.4, flatShading: true,
      emissive: 0x2a2436, emissiveIntensity: 0.35 }),
    trim: new THREE.MeshStandardMaterial({ color: pal.trim, metalness: 0.5, roughness: 0.4, flatShading: true,
      emissive: pal.trim, emissiveIntensity: 0.6 }),
    crystal: new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.3, flatShading: true,
      emissive: pal.accent, emissiveIntensity: CRYSTAL_GLOW }),
  };
  /** 블룸에 걸리는 덧재질(HDR 색) */
  const bladeGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const bladeCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const shardMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
  const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
  /** setFlash · setGlow가 건드리는 표준 재질의 원래 값 */
  const stdMats = Object.values(mats).map((mat) => ({ mat, r: mat.emissive.r, g: mat.emissive.g, b: mat.emissive.b,
    ei: mat.emissiveIntensity, glow: mat === mats.crystal || mat === mats.trim }));
  const colGlow = new THREE.Color(voidStyle.glow);
  const colCore = new THREE.Color(voidStyle.core);
  const colTint = new THREE.Color();
  const colTmp = new THREE.Color();
  const tmpV = new THREE.Vector3();

  const b = new PartBuilder();

  // 왕관: 두건 위의 가는 테와 일곱 가시(가운데가 가장 높다)
  const head = rig.joints.head;
  b.add(head, 'trim', new THREE.TorusGeometry(0.168, 0.014, 5, 18), 0, 0.285, -0.02, HALF_PI - 0.2, 0, 0);
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 7) * TAU * 0.86;
    const h = i === 3 ? 0.34 : i % 2 ? 0.2 : 0.27;
    const lean = 0.22;
    const spike = place(cone(0.022, h, 4), 0, h / 2, 0, lean, 0, 0);
    b.add(head, i === 3 ? 'crystal' : 'trim', spike, Math.sin(a) * 0.168, 0.275 + Math.cos(a) * 0.034, -0.02 + Math.cos(a) * 0.165, 0, a, 0);
  }
  // 긴 자락: 끝단 아래로 더 늘어지는 찢어진 천(지면에 닿지 않는다 — 가장 긴 것도 root 아래 0.45m)
  const robe3 = rig.joints.robe3;
  for (let i = 0; i < 7; i++) {
    const a = ((i + 0.5) / 7) * TAU;
    const len = 0.42 + ((i * 5) % 4) * 0.11;
    const tail = place(wedge(0.02, 0.012, 0.15, 0.014, len), 0, -0.16 - len / 2, 0.33, 0.1, 0, 0);
    b.add(robe3, 'cloth', tail, 0, 0, 0, 0, a, 0);
    if (i % 2 === 0) b.add(robe3, 'trim', place(box(0.03, 0.03, 0.012), 0, -0.16 - len + 0.02, 0.33 + 0.1 * (len + 0.14), 0, 0, 0.78), 0, 0, 0, 0, a, 0);
  }
  // 허리의 늘어진 띠
  const robe1 = rig.joints.robe1;
  b.add(robe1, 'trim', place(wedge(0.03, 0.01, 0.06, 0.012, 0.62), 0, -0.36, 0.3, 0.2, 0, 0), 0, 0, 0, 0, 0.5, 0);
  b.add(robe1, 'trim', place(wedge(0.03, 0.01, 0.06, 0.012, 0.5), 0, -0.3, 0.3, 0.2, 0, 0), 0, 0, 0, 0, -0.5, 0);

  // 지팡이: 자루 · 물미 · 초승달 머리(수정을 품는다)
  const staff = new THREE.Group();
  staff.name = 'nihil:staff';
  rig.sockets.weapon.add(staff);
  b.add(staff, 'shaft', cyl(0.022, 0.028, STAFF_TOP - STAFF_BUTT, 6), 0, (STAFF_TOP + STAFF_BUTT) / 2, 0);
  b.add(staff, 'shaft', cone(0.03, 0.16, 5), 0, STAFF_BUTT - 0.08, 0, Math.PI, 0, 0);
  for (const y of [-0.12, 0.12, 0.7]) b.add(staff, 'trim', cyl(0.036, 0.036, 0.03, 6), 0, y, 0);
  b.add(staff, 'trim', cyl(0.058, 0.03, 0.09, 6), 0, STAFF_TOP, 0);
  for (const sg of [1, -1]) {
    const pts = [[0, 1.28, 0], [0.15, 1.36, 0], [0.215, 1.5, 0], [0.17, 1.66, 0], [0.07, 1.77, 0]];
    b.add(staff, 'shaft', tubePath(pts.map((p) => [p[0] * sg, p[1], p[2]]), [0.034, 0.03, 0.026, 0.018, 0], 6));
    b.add(staff, 'trim', cone(0.016, 0.1, 4), sg * 0.225, 1.5, 0, 0, 0, -sg * HALF_PI);
  }
  b.finish(mats, geoms);

  // 지팡이의 수정(혼자 돈다)
  const crystalGeo = new THREE.OctahedronGeometry(0.075, 0);
  geoms.push(crystalGeo);
  const crystal = new THREE.Mesh(crystalGeo, mats.crystal);
  crystal.position.set(0, STAFF_HEAD_Y, 0);
  crystal.scale.set(1, 1.7, 1);
  staff.add(crystal);

  // 낫의 날(평소에는 접혀 있다): 넓은 빛 + 좁은 심지
  const blade = new THREE.Group();
  blade.position.set(BLADE_ROOT[0], BLADE_ROOT[1], 0);
  blade.rotation.y = BLADE_CANT;
  const bladeGlowGeo = bladeStrip(1);
  const bladeCoreGeo = bladeStrip(0.42);
  geoms.push(bladeGlowGeo, bladeCoreGeo);
  blade.add(new THREE.Mesh(bladeGlowGeo, bladeGlowMat), new THREE.Mesh(bladeCoreGeo, bladeCoreMat));
  blade.scale.setScalar(0.001);
  blade.visible = false;
  staff.add(blade);

  // 망토: 어깨에서 등 뒤로 드리운 찢어진 천
  rig.cape = new Cape({ parent: rig.joints.chest, material: mats.cape, width: 0.5, flare: 1.9, length: 1.55,
    y: 0.34, z: -0.19, torn: true });

  // 왼손의 심연 불꽃: 시전 손이 어디 있는지 어두운 제단에서도 읽힌다(예고가 차오르면 커진다)
  const flameGeo = new THREE.IcosahedronGeometry(FLAME_SIZE, 0);
  geoms.push(flameGeo);
  const flame = new THREE.Mesh(flameGeo, shardMat);
  rig.sockets.handL.add(flame);

  // 몸 둘레를 도는 파편
  const shardGeo = new THREE.OctahedronGeometry(0.06, 0);
  geoms.push(shardGeo);
  const orbit = new THREE.Group();
  orbit.name = 'nihil:shards';
  rig.root.add(orbit);
  /** @type {THREE.Mesh[]} */
  const shards = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const m = new THREE.Mesh(shardGeo, shardMat);
    m.scale.set(1, 2.3, 1);
    orbit.add(m);
    shards.push(m);
  }

  // 심연 폭발의 충격 껍질: 판정 반경까지 퍼지는 반구 + 바닥 고리(판정 원과 같은 크기라 범위가 눈에 남는다)
  const novaR = def.attacks.void_nova.hits[0].shape.r;
  const novaDomeGeo = new THREE.SphereGeometry(1, 28, 10, 0, TAU, 0, HALF_PI);
  const novaRingGeo = new THREE.TorusGeometry(1, 0.012, 4, 56);
  novaRingGeo.rotateX(HALF_PI);
  geoms.push(novaDomeGeo, novaRingGeo);
  const novaDomeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const novaRingMat = novaDomeMat.clone();
  novaDomeMat.color.setHex(PALETTE.style.danger.glow).multiplyScalar(NOVA_HDR * 0.5);
  novaRingMat.color.setHex(PALETTE.style.danger.core).multiplyScalar(NOVA_HDR);
  const nova = new THREE.Group();
  nova.name = 'nihil:nova';
  nova.add(new THREE.Mesh(novaDomeGeo, novaDomeMat), new THREE.Mesh(novaRingGeo, novaRingMat));
  nova.visible = false;
  root.add(nova);

  // 2페이즈의 두 번째 고리: 등 뒤의 끊어진 큰 고리
  const ring2 = new THREE.Group();
  ring2.name = 'nihil:ring2';
  ring2.position.set(0, 0.5, -0.34);
  rig.joints.chest.add(ring2);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.TorusGeometry(0.66, 0.013, 4, 14, 1.55);
    g.rotateZ((i / 3) * TAU);
    geoms.push(g);
    ring2.add(new THREE.Mesh(g, ring2Mat));
    const tick = new THREE.ConeGeometry(0.02, 0.2, 4);
    tick.translate(0, 0.76, 0);
    tick.rotateZ((i / 3) * TAU + 0.3);
    geoms.push(tick);
    ring2.add(new THREE.Mesh(tick, ring2Mat));
  }
  ring2.scale.setScalar(0.001);
  ring2.visible = false;

  // 점멸은 CharacterLayer가 rig.setFlash로 건다 — 덧재질도 같이 번쩍이게 감싼다
  let flash = 0;
  let glowStyle = 'none';
  let glowAmt = 0;
  let boost = 0;
  let opacity = 1;
  const rigSetFlash = rig.setFlash.bind(rig);
  rig.setFlash = (amount) => {
    rigSetFlash(amount);
    const a = clamp01(Number.isFinite(amount) ? amount : 0);
    if (a === flash) return;
    flash = a;
    refreshMats();
  };

  /** 덧재질의 발광: 기본 · 2페이즈 · 예고 발광(공격의 glow 색) · 점멸. */
  function refreshMats() {
    const style = PALETTE.style[glowStyle];
    const g = style ? glowAmt : 0;
    if (g > 0) colTint.setHex(style.glow);
    for (const e of stdMats) {
      let r = e.r;
      let gg = e.g;
      let bb = e.b;
      let ei = e.ei;
      if (e.glow) {
        ei *= 1 + boost * 0.6;
        if (g > 0) {
          r = mix(r, colTint.r, g);
          gg = mix(gg, colTint.g, g);
          bb = mix(bb, colTint.b, g);
          ei += GLOW_GAIN * g * (e.mat === mats.crystal ? 1 : 0.4);
        }
      }
      if (flash > 0) {
        const w = flash * FLASH_WHITEN;
        r = mix(r, 1, w);
        gg = mix(gg, 1, w);
        bb = mix(bb, 1, w);
        if (ei < FLASH_INTENSITY) ei = mix(ei, FLASH_INTENSITY, flash);
      }
      e.mat.emissive.setRGB(r, gg, bb);
      e.mat.emissiveIntensity = ei;
    }
    // HDR 재질: 보스 색 → 예고 색
    colTmp.copy(colCore);
    if (g > 0) colTmp.lerp(colTint, g * 0.85);
    shardMat.color.copy(colTmp).multiplyScalar(SHARD_HDR * (1 + boost * 0.5 + g * 0.8));
    ring2Mat.color.copy(colGlow);
    if (g > 0) ring2Mat.color.lerp(colTint, g * 0.85);
    ring2Mat.color.multiplyScalar(RING2_HDR * (1 + g * 0.8));
  }

  /** @param {number} a */
  function setOpacity(a) {
    const v = clamp01(a);
    rig.setOpacity(v);
    if (v === opacity) return;
    const toggled = (v < 1) !== (opacity < 1);
    opacity = v;
    for (const e of stdMats) {
      e.mat.opacity = v;
      if (toggled) {
        e.mat.transparent = v < 1;
        e.mat.needsUpdate = true;
      }
    }
    shardMat.opacity = v;
    ring2Mat.opacity = v;
  }

  bladeGlowMat.color.copy(colGlow).multiplyScalar(BLADE_HDR * 0.7);
  bladeCoreMat.color.copy(colCore).multiplyScalar(BLADE_HDR);
  refreshMats();

  const blender = new PoseBlender(rig, HL_DEFAULT);
  const pose = emptyPose();
  const poseKeys = Object.keys(NIHIL_POSES);
  /** @type {Record<string, boolean>} */
  const warned = {};
  const weaponBase = rig.sockets.weaponBase;
  const weaponTip = rig.sockets.weaponTip;
  weaponBase.position.set(0, STAFF_HEAD_Y, 0);
  weaponTip.position.set(0, STAFF_HEAD_Y, 0);

  let time = 0;
  let lastSeq = -1;
  let lastPhase = '';
  /** 등장 연출의 경과(초). APPEAR_DUR 이상이면 끝난 것 */
  let appearT = APPEAR_DUR;
  let appearedSeq = -1;
  /** 지면에 내려앉은 정도 0(부유)..1(지면) */
  let groundK = 0;
  let fallV = 0;
  let landKick = 0;
  let hurt = 0;
  let hurtSide = 0;
  let hurtFwd = -1;
  let vfS = 0;
  let vsS = 0;
  let gatherS = 0;
  let flameS = 1;
  let bladeS = 0;
  let ring2S = 0;
  /** 충격 껍질의 경과(초). NOVA_BLAST_DUR 이상이면 꺼져 있다 */
  let novaT = NOVA_BLAST_DUR;
  let haloAng = 0;
  let shardAng = 0;
  let lastFacing = null;
  let twist = 0;

  /**
   * @param {BossState} boss
   * @param {{alpha:number, dt:number, time:number, state:GameState}} info
   */
  function update(boss, info) {
    const dt = info.dt;
    const frozen = info.state && info.state.hitstop > 0;
    time += dt;
    const t = boss.stateTime;
    const prog = boss.stateDur > 0 ? clamp01(t / boss.stateDur) : 0;

    let halfLife = HL_DEFAULT;
    let snap = false;
    let gStyle = 'none';
    let gAmt = 0;
    /** 지면으로 내려앉을 것인가 */
    let grounded = false;
    /** blink 예고의 소멸 진행 0..1 */
    let vanish = 0;
    let gather = 0;
    let bladeWant = 0;
    let haloSpin = HALO_SPIN;
    let gust = boss.phase === 2 ? 0.3 : 0.08;
    let dead = 0;
    /** 심연 폭발: 무기 끝 소켓을 몸의 중심(지면)에 둔다 — fx의 `slam` 충격이 폭발 원의 한가운데에서 난다 */
    let centerTip = false;
    /** 인트로의 형체 진행 0..1(상태 시각에서 — 뷰가 늦게 만들어져도 맞는다) */
    let form = 1;

    switch (boss.state) {
      case 'attack': {
        const a = boss.attack;
        if (!a) { copyPose(IDLE, pose); break; }
        let set = NIHIL_POSES[a.pose];
        if (!set) {
          if (!warned[a.pose]) {
            warned[a.pose] = true;
            console.warn(`[nihilView] 모르는 pose '${a.pose}' — '${poseKeys[0]}'로 대신한다`);
          }
          set = NIHIL_POSES[poseKeys[0]];
        }
        attackPose(set, IDLE, a.phase, a.phaseT, pose, bossReleaseT(a.windup));
        const p = clamp01(a.phaseT);
        const tA = a.t - a.windup;
        gStyle = a.glow;
        gAmt = a.phase === 'windup' ? p : a.phase === 'active' ? 1 : 1 - clamp01(p * 3);
        gather = a.phase === 'windup' ? p : a.phase === 'active' ? 0.4 : 0;
        haloSpin = a.phase === 'recovery' ? HALO_SPIN : mix(HALO_SPIN, HALO_SPIN_CAST, gather);
        snap = a.phase === 'active' && (a.seq !== lastSeq || lastPhase !== 'active');
        halfLife = HL_ATTACK;
        switch (a.pose) {
          case 'blink':
            if (a.phase === 'windup') {
              vanish = ease.inCubic(ramp(VANISH_FROM, 1, p));
            } else if (appearedSeq !== a.seq) {
              // 순간이동은 판정 시작(tA = 0)에 일어난다 — BOSS_TELEPORT를 놓쳐도 여기서 나타난다
              appearedSeq = a.seq;
              appearT = 0;
            }
            break;
          case 'castOrbs':
            if (a.phase === 'active') {
              // 한 발 쏠 때마다 손이 튄다
              const k = tA / ORB_INTERVAL;
              const kick = (1 - (k - Math.floor(k))) ** 3 * ORB_RECOIL;
              addRot(pose, 'shoulderL', kick, 0, 0);
              addRot(pose, 'chest', -kick * 0.4, 0, 0);
            }
            break;
          case 'beam':
            if (a.phase === 'active') {
              // 버티는 떨림 — 손은 흔들리지 않게 몸통만
              addRot(pose, 'chest', 0.012 * Math.sin(time * 47), 0, 0.01 * Math.sin(time * 39));
              addRot(pose, 'head', 0.02 * Math.sin(time * 43), 0, 0);
              gust = 1;
            } else if (a.phase === 'windup') {
              const sh = 0.03 * p;
              addRot(pose, 'shoulderL', sh * Math.sin(time * 38), 0, sh * Math.sin(time * 31));
            }
            break;
          case 'castSky':
            if (a.phase === 'active') {
              const w = Math.sin(time * 5.2);
              addRot(pose, 'shoulderL', 0, 0, 0.1 * w);
              addRot(pose, 'shoulderR', 0, 0, -0.1 * w);
              addPos(pose, 'core', 0, 0.04 * Math.sin(time * 3.1), 0);
              gust = 0.8;
            }
            break;
          case 'castGround':
            if (a.phase === 'active') addRot(pose, 'shoulderL', 0.03 * Math.sin(time * 26), 0, 0);
            break;
          case 'nova':
            centerTip = true;
            if (snap) novaT = 0;
            if (a.phase === 'windup') {
              const sh = 0.045 * p * p;
              addRot(pose, 'core', sh * Math.sin(time * 52), 0, sh * Math.sin(time * 45));
              addRot(pose, 'head', sh * Math.sin(time * 49), 0, 0);
            } else if (a.phase === 'active') {
              gust = 1;
            }
            break;
          case 'scythe':
            bladeWant = a.phase === 'windup' ? ease.outBack(ramp(0, BLADE_GROW, p))
              : a.phase === 'active' ? 1 : 1 - ease.inQuad(ramp(0.25, 0.7, p));
            break;
          default:
            break;
        }
        lastSeq = a.seq;
        lastPhase = a.phase;
        break;
      }
      case 'intro': {
        // 어둠에서 웅크린 채 형체를 갖춘다 → 0.5초에 팔을 벌리고 포효 → 자세를 잡는다
        const roarEnd = INTRO_FORM + ROAR_LEN_INTRO;
        if (t < INTRO_FORM) {
          copyPose(CURL, pose);
          form = t / INTRO_FORM;
        } else if (t < roarEnd) {
          lerpPose(CURL, ROAR, ease.outBack(ramp(INTRO_FORM, INTRO_FORM + 0.22, t)), pose);
          addRot(pose, 'chest', 0.03 * Math.sin(time * 41), 0, 0);
          gust = 1;
          haloSpin = HALO_SPIN_CAST;
        } else {
          lerpPose(ROAR, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        }
        halfLife = t < roarEnd ? HL_HURT : HL_DEFAULT;
        break;
      }
      case 'phaseShift': {
        const roarEnd = ROAR_AT_SHIFT + ROAR_LEN_SHIFT;
        if (t < ROAR_AT_SHIFT) {
          lerpPose(IDLE, CURL, ease.outCubic(ramp(0, ROAR_AT_SHIFT * 0.8, t)), pose);
          const sh = 0.04 * ramp(0, ROAR_AT_SHIFT, t);
          addRot(pose, 'core', sh * Math.sin(time * 50), 0, sh * Math.sin(time * 43));
          gather = ramp(0, ROAR_AT_SHIFT, t);
        } else if (t < roarEnd) {
          lerpPose(CURL, ROAR, ease.outBack(ramp(ROAR_AT_SHIFT, ROAR_AT_SHIFT + 0.28, t)), pose);
          addRot(pose, 'chest', 0.035 * Math.sin(time * 44), 0, 0);
          addRot(pose, 'head', 0.03 * Math.sin(time * 37), 0, 0);
          addPos(pose, 'core', 0, 0.12 * Math.sin((t - ROAR_AT_SHIFT) * 2.2), 0);
          gust = 1;
          haloSpin = HALO_SPIN_CAST;
        } else {
          lerpPose(ROAR, IDLE, ease.inOutQuad(ramp(roarEnd, Math.max(roarEnd + 0.1, boss.stateDur), t)), pose);
        }
        gStyle = def.style;
        gAmt = t < roarEnd ? ramp(0, ROAR_AT_SHIFT, t) : 1 - ramp(roarEnd, boss.stateDur, t);
        halfLife = t >= ROAR_AT_SHIFT && t < ROAR_AT_SHIFT + 0.3 ? HL_HURT : HL_DEFAULT;
        break;
      }
      case 'parried': {
        const k = ease.outCubic(ramp(0, 0.14, prog)) * (1 - ease.inOutQuad(ramp(0.6, 1, prog)));
        lerpPose(IDLE, PARRIED, k, pose);
        halfLife = HL_HURT;
        break;
      }
      case 'groggy': {
        grounded = true;
        lerpPose(IDLE, KNEEL, ease.outCubic(ramp(0, 0.3, t)), pose);
        // 거친 숨 — 어깨가 들썩인다
        const br = Math.sin(time * 3.6);
        addRot(pose, 'core', 0.03 * br, 0, 0);
        addRot(pose, 'chest', 0.05 * br, 0, 0);
        addRot(pose, 'head', 0.03 * br, 0, 0.02 * Math.sin(time * 1.7));
        gust = 0;
        haloSpin = 0.08;
        break;
      }
      case 'executed': {
        grounded = true;
        const k = ease.outCubic(ramp(0, 0.12, prog)) * (1 - ease.inOutQuad(ramp(0.5, 1, prog)));
        lerpPose(KNEEL, EXECUTED, k, pose);
        addRot(pose, 'core', 0, 0, 0.05 * Math.sin(t * 50) * k);
        halfLife = HL_HURT;
        gust = 0;
        haloSpin = 0.08;
        break;
      }
      case 'recover': {
        // 꿇은 자리에서 다시 떠오른다
        lerpPose(KNEEL, IDLE, ease.inOutQuad(ramp(0.1, 1, prog)), pose);
        grounded = prog < 0.12;
        break;
      }
      case 'dead': {
        dead = clamp01(t / Math.max(0.1, COMBAT.outroVictory - 0.4));
        grounded = true;
        if (dead < 0.34) lerpPose(IDLE, DEAD_KNEEL, ease.outCubic(dead / 0.34), pose);
        else lerpPose(DEAD_KNEEL, DEAD_FLAT, ease.inQuad(ramp(0.4, 0.74, dead)), pose);
        gust = 0;
        haloSpin = HALO_SPIN * (1 - dead);
        break;
      }
      default: { // idle · chase — 부유체는 걷지 않는다: 가는 쪽으로 기울 뿐이다(아래)
        copyPose(IDLE, pose);
        break;
      }
    }
    if (boss.state !== 'attack') lastPhase = '';

    // ── 지면 ↔ 부유: 떨어질 때는 중력으로, 오를 때는 부드럽게 ──
    if (grounded) {
      if (groundK < 1) {
        fallV += FALL_GRAVITY * dt;
        groundK += fallV * dt;
        if (groundK >= 1) {
          groundK = 1;
          landKick = 1;
        }
      }
    } else {
      fallV = 0;
      groundK += (0 - groundK) * follow(RISE_LAMBDA, dt);
      if (groundK < 0.001) groundK = 0;
    }
    landKick += (0 - landKick) * follow(LAND_DECAY, dt);
    const air = 1 - groundK;

    // ── 이동: 몸이 가는 쪽으로 기울고 자락이 늦게 따라온다(sim 틱의 이동량에서 속도를 잰다) ──
    const dx = boss.pos.x - boss.prevPos.x;
    const dz = boss.pos.z - boss.prevPos.z;
    const sn = Math.sin(boss.facing);
    const cs = Math.cos(boss.facing);
    const vmax = Math.max(0.1, def.moveSpeed);
    const vf = Math.max(-2, Math.min(2, (dx * sn + dz * cs) / DT / vmax));
    const vs = Math.max(-2, Math.min(2, (-dx * cs + dz * sn) / DT / vmax));
    const kv = follow(VEL_LAMBDA, dt);
    vfS += (vf - vfS) * kv;
    vsS += (vs - vsS) * kv;
    const facingNow = root.rotation.y;
    if (lastFacing !== null && dt > 0) {
      let d = facingNow - lastFacing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      twist += (Math.max(-6, Math.min(6, d / dt)) - twist) * follow(6, dt);
    }
    lastFacing = facingNow;
    if (air > 0.01 && boss.state !== 'dead') {
      // 앞으로 갈 때 rx > 0(숙임), 오른쪽(−X)으로 갈 때 core rz > 0(오른쪽으로 기움)
      addRot(pose, 'core', LEAN_FWD * vf * air, 0, LEAN_SIDE * vs * air);
      const trail = ROBE_TRAIL * air;
      const tw = -TURN_TWIST * twist * air;
      addRot(pose, 'robe1', trail * vfS * 0.6, tw, trail * vsS * 0.5);
      addRot(pose, 'robe2', trail * vfS * 0.8, tw * 1.4, trail * vsS * 0.7);
      addRot(pose, 'robe3', trail * vfS, tw * 1.8, trail * vsS * 0.9);

      // ── 부유: 느린 출렁임 + 자락의 흐느적거림(마디마다 위상이 늦다) ──
      const bob = Math.sin(time * BOB_RATE);
      addPos(pose, 'core', 0, BOB_AMP * bob * air, 0);
      addRot(pose, 'core', 0.018 * Math.sin(time * SWAY_RATE) * air, 0, 0.022 * Math.sin(time * SWAY_RATE * 0.8 + 1.3) * air);
      addRot(pose, 'robe1', 0.05 * Math.sin(time * 1.7) * air, 0, 0.04 * Math.sin(time * 1.3 + 0.6) * air);
      addRot(pose, 'robe2', 0.07 * Math.sin(time * 1.7 - 0.7) * air, 0, 0.06 * Math.sin(time * 1.3 - 0.2) * air);
      addRot(pose, 'robe3', 0.09 * Math.sin(time * 1.7 - 1.4) * air, 0, 0.08 * Math.sin(time * 1.3 - 1.0) * air);
      if (boss.state !== 'attack') {
        addRot(pose, 'shoulderL', 0.04 * bob, 0, 0.02 * bob);
        addRot(pose, 'elbowL', -0.05 * Math.sin(time * BOB_RATE + 0.8), 0, 0);
        addRot(pose, 'head', 0.015 * Math.sin(time * 0.7), 0.05 * Math.sin(time * 0.43), 0);
      }
    }
    if (boss.state !== 'dead') addRot(pose, 'chest', 0.02 * Math.sin(time * 1.2), 0, 0);

    // 착지의 눌림 · 피격 움찔(슈퍼아머라 자세는 안 깨지지만 몸은 흔들린다)
    if (landKick > 0.01) {
      addPos(pose, 'core', 0, -LAND_DIP * landKick, 0);
      addRot(pose, 'head', 0.25 * landKick, 0, 0);
    }
    hurt += (0 - hurt) * follow(HURT_DECAY, dt);
    if (hurt > 0.01) {
      addRot(pose, 'chest', HURT_LEAN * hurt * hurtFwd, 0, HURT_LEAN * hurt * hurtSide);
      addRot(pose, 'head', HURT_LEAN * 0.8 * hurt * hurtFwd, 0, 0);
      addRot(pose, 'robe1', -0.2 * hurt * hurtFwd, 0, 0);
    }

    // 후광은 계속 돈다(시전 중에는 빠르게)
    if (!frozen) haloAng += haloSpin * dt;

    if (snap) blender.snap(pose);
    else blender.update(pose, dt, halfLife);
    // 후광의 회전은 블렌더를 거치지 않고 바로 넣는다(끝없이 커지는 각이라 보간하면 뒤처진다)
    rig.joints.halo.rotation.z = haloAng;

    // ── 형체: 소멸(blink 예고) · 등장(순간이동 뒤 · 인트로) · 사망 ──
    if (appearT < APPEAR_DUR) appearT = Math.min(APPEAR_DUR, appearT + dt);
    const ap = Math.min(appearT / APPEAR_DUR, form);
    let sx = 1;
    let sy = 1;
    let alpha = 1;
    if (vanish > 0) {
      sx = mix(1, VANISH_SQUEEZE, vanish);
      sy = mix(1, VANISH_STRETCH, vanish);
      alpha = 1 - ease.inQuad(vanish);
    } else if (ap < 1) {
      const k = ease.outBack(ap);
      sx = mix(VANISH_SQUEEZE, 1, k);
      sy = mix(VANISH_STRETCH, 1, ease.outCubic(ap));
      alpha = clamp01(ap / APPEAR_FADE);
    }
    if (boss.state === 'dead') {
      const fade = ramp(DEATH_FADE_FROM, 1, dead);
      alpha = 1 - fade;
      sx = 1 - 0.25 * ease.inQuad(fade);
      sy = 1 - 0.6 * ease.inQuad(fade);
      root.visible = dead < 1;
    } else {
      root.visible = true;
    }
    rig.root.scale.set(sx, sy, sx);
    // sim이 올려 둔 높이(root.position.y = boss.y)를 그만큼 되돌려 지면에 앉힌다
    rig.root.position.y = groundK > 0 ? -root.position.y * groundK : 0;
    setOpacity(alpha);

    // ── 발광: 예고 발광 · 2페이즈 ──
    const wantBoost = (boss.phase === 2 ? PHASE2_BOOST : 0) + dead * 1.5;
    rig.setGlow(/** @type {any} */ (gStyle), gAmt);
    rig.setBoost(wantBoost);
    if (gStyle !== glowStyle || gAmt !== glowAmt || wantBoost !== boost) {
      glowStyle = gStyle;
      glowAmt = gAmt;
      boost = wantBoost;
      refreshMats();
    }

    // ── 낫의 날 · 궤적 소켓 ──
    bladeS += (bladeWant - bladeS) * follow(bladeWant > bladeS ? 30 : 14, dt);
    const bladeOn = bladeS > 0.02;
    blade.visible = bladeOn;
    if (bladeOn) {
      blade.scale.setScalar(Math.max(0.001, bladeS));
      const flick = 0.85 + 0.15 * Math.sin(time * 33);
      bladeGlowMat.opacity = Math.min(1, bladeS) * 0.75 * flick * alpha;
      bladeCoreMat.opacity = Math.min(1, bladeS) * alpha;
      weaponBase.position.set(BLADE_BASE[0], BLADE_BASE[1], 0);
      weaponTip.position.set(BLADE_TIP[0], BLADE_TIP[1], 0);
    } else if (centerTip) {
      const w = rig.sockets.weapon;
      w.updateWorldMatrix(true, false);
      tmpV.setFromMatrixPosition(root.matrixWorld).setY(0);
      w.worldToLocal(tmpV);
      weaponBase.position.copy(tmpV);
      weaponTip.position.copy(tmpV);
    } else {
      weaponBase.position.set(0, STAFF_HEAD_Y, 0);
      weaponTip.position.set(0, STAFF_HEAD_Y, 0);
    }
    crystal.rotation.y = time * 1.6;
    crystal.position.y = STAFF_HEAD_Y + 0.02 * Math.sin(time * 2.3);

    // ── 파편: 평소에는 느리게 돌고, 예고 중에는 몸 쪽으로 모여 빨리 돈다 ──
    gatherS += (gather - gatherS) * follow(GATHER_LAMBDA, dt);
    if (!frozen) shardAng += mix(SHARD_SPIN, SHARD_SPIN_GATHER, gatherS) * (boss.phase === 2 ? 1.5 : 1) * dt;
    const core = rig.joints.core.position;
    const orbR = mix(SHARD_RADIUS, SHARD_RADIUS_GATHER, gatherS) * (1 - 0.6 * groundK);
    for (let i = 0; i < SHARD_COUNT; i++) {
      const a = shardAng + (i / SHARD_COUNT) * TAU;
      const m = shards[i];
      m.position.set(core.x + Math.sin(a) * orbR, core.y + 0.25 + 0.28 * Math.sin(a * 0.5 + i * 1.9) * air - 0.2 * groundK,
        core.z + Math.cos(a) * orbR);
      m.rotation.set(0.4, a * 2, 0.3);
    }
    orbit.visible = boss.state !== 'dead' || dead < DEATH_FADE_FROM;
    const flameWant = boss.state === 'dead' ? 0 : groundK > 0.5 ? 0.4 : 1 + FLAME_GATHER * gatherS;
    flameS += (flameWant - flameS) * follow(GATHER_LAMBDA, dt);
    flame.visible = flameS > 0.05;
    flame.scale.setScalar(flameS * (1 + 0.14 * Math.sin(time * 19) + 0.08 * Math.sin(time * 31)));
    flame.rotation.set(time * 2.1, time * 3.3, 0);

    // ── 심연 폭발의 충격 껍질(지면에 붙어 퍼진다 — 리그의 형체 배율과 무관하게 root에 둔다) ──
    if (novaT < NOVA_BLAST_DUR) {
      novaT += dt;
      const u = clamp01(novaT / NOVA_BLAST_DUR);
      const r = mix(NOVA_BLAST_R0, novaR, ease.outCubic(u));
      nova.visible = u < 1;
      nova.position.y = -root.position.y + 0.06;
      nova.children[0].scale.set(r, r * 0.55, r);
      nova.children[1].scale.set(r, 1 + 14 * (1 - u), r);
      novaDomeMat.opacity = 0.5 * (1 - u) * (1 - u);
      novaRingMat.opacity = 1 - u * u;
    } else if (nova.visible) {
      nova.visible = false;
    }

    // ── 2페이즈의 두 번째 고리 ──
    const ringWant = boss.phase === 2 && boss.state !== 'dead' && !(boss.state === 'phaseShift' && t < ROAR_AT_SHIFT) ? 1 : 0;
    ring2S += (ringWant - ring2S) * follow(RING2_LAMBDA, dt);
    ring2.visible = ring2S > 0.02;
    if (ring2.visible) {
      ring2.scale.setScalar(ring2S * (1 + 0.04 * Math.sin(time * 2.1)));
      if (!frozen) ring2.rotation.z += RING2_SPIN * (1 + gatherS * 3) * dt;
    }

    // ── 망토 ──
    if (rig.cape) {
      const bp = blender.pose.rot;
      const lean = (bp.core ? bp.core[0] : 0) + (bp.chest ? bp.chest[0] : 0);
      rig.cape.update(dt, time, lean, vfS * air, vsS * air, gust * air);
    }
  }

  return {
    root,
    rig,
    update,
    /**
     * 자세는 전부 상태에서 읽는다. 이벤트로는 "순간"만 받는다 — 순간이동의 등장 · 피격의 움찔.
     * @param {string} name EV 문자열
     * @param {any} p
     */
    onEvent(name, p) {
      if (name === EV.BOSS_TELEPORT) {
        appearT = 0;
      } else if (name === EV.HIT && p && p.target === 'boss' && p.outcome === 'hit') {
        hurt = p.heavy || p.crit ? 1 : 0.6;
        // dir = 공격 원점 → 보스. 보스 로컬로 옮겨 맞은 반대쪽으로 젖힌다
        const local = (Number.isFinite(p.dir) ? p.dir : 0) - root.rotation.y;
        hurtFwd = Math.cos(local);    // 앞에서 맞으면(dir가 보스의 등 쪽을 향함) −1 → 뒤로 젖힌다
        hurtSide = -Math.sin(local);
      }
    },
    dispose() {
      rig.dispose(); // 망토의 지오메트리까지
      for (const g of geoms) g.dispose();
      for (const e of stdMats) e.mat.dispose();
      bladeGlowMat.dispose();
      bladeCoreMat.dispose();
      shardMat.dispose();
      ring2Mat.dispose();
      novaDomeMat.dispose();
      novaRingMat.dispose();
      if (root.parent) root.parent.remove(root);
    },
  };
}
