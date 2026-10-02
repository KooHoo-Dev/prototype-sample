// OWNER: P5 — 계약 §9.5 「포즈 수학」
// 포즈 = 관절별 오일러 XYZ(rad) + 위치 오프셋(m). 모든 함수는 out을 주면 할당 없이 그 객체에 쓴다
// (out이 a · b와 같은 객체여도 안전하다 — 블렌더가 제자리 보간에 쓴다).

/** @typedef {import('../../types.js').Pose} Pose */
/** @typedef {import('../../types.js').PoseSet} PoseSet */

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

/** 예고 끝의 「출발」 구간이 지나가는 궤적 비율(판정 진입 시 이미 이만큼 와 있다). */
const RELEASE_FRAC = 0.35;
/** 보스 무기는 판정 이 시간(초) 전에 출발한다. */
const BOSS_RELEASE_LEAD = 0.18;
const RELEASE_MAX = 0.4;
/** 예고 자세가 완성되는 지점(예고 진행도)의 기본값. */
const HOLD_AT_DEFAULT = 0.6;
/** 판정 구간의 이 비율 안에 끝 자세에 닿는다. */
const ACTIVE_REACH = 0.5;
/** 후딜의 이 비율까지 follow 자세로 흘러간다. */
const FOLLOW_FRAC = 0.3;
/** 차지 떨림: 진폭(rad) · 진동수(차지량 1당 rad). */
const CHARGE_SHAKE_AMP = 0.035;
const CHARGE_SHAKE_FREQ = 95;
const DEG = Math.PI / 180;

const ZERO = [0, 0, 0];
const EMPTY = {};

/** 이징 함수(0..1 → 0..1). */
export const ease = {
  /** @param {number} t */ linear: (t) => t,
  /** @param {number} t */ inQuad: (t) => t * t,
  /** @param {number} t */ outQuad: (t) => 1 - (1 - t) * (1 - t),
  /** @param {number} t */ inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
  /** @param {number} t */ inCubic: (t) => t * t * t,
  /** @param {number} t */ outCubic: (t) => 1 - (1 - t) ** 3,
  /** @param {number} t */ outQuint: (t) => 1 - (1 - t) ** 5,
  /** @param {number} t */ outBack: (t) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
};

/** @param {number} v */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** @returns {Pose} {rot: {}, pos: {}} */
export function emptyPose() {
  return { rot: {}, pos: {} };
}

/**
 * 도(°)로 적은 표를 포즈로 바꾼다(포즈 표를 읽기 쉽게 — 모듈 로드 때 한 번만 돈다).
 * @param {Record<string, number[]>} rotDeg 관절 → [rx, ry, rz] (도)
 * @param {Record<string, number[]>} [pos] 관절 → [x, y, z] (m)
 * @returns {Pose}
 */
export function poseDeg(rotDeg, pos) {
  const out = emptyPose();
  for (const k in rotDeg) {
    const r = rotDeg[k];
    out.rot[k] = [(r[0] ?? 0) * DEG, (r[1] ?? 0) * DEG, (r[2] ?? 0) * DEG];
  }
  if (pos) for (const k in pos) out.pos[k] = [pos[k][0] ?? 0, pos[k][1] ?? 0, pos[k][2] ?? 0];
  return out;
}

/**
 * base 포즈 위에 관절 몇 개만 바꾼 새 포즈(도 단위 표). 포즈 표의 변주를 짧게 쓰기 위한 것.
 * @param {Pose} base
 * @param {Record<string, number[]>} rotDeg
 * @param {Record<string, number[]>} [pos]
 * @returns {Pose}
 */
export function withPose(base, rotDeg, pos) {
  const out = copyPose(base, emptyPose());
  const over = poseDeg(rotDeg, pos);
  for (const k in over.rot) out.rot[k] = over.rot[k];
  for (const k in over.pos) out.pos[k] = over.pos[k];
  return out;
}

/** @param {Record<string, number[]>} ta @param {Record<string, number[]>} tb @param {number} t @param {Record<string, number[]>} to */
function lerpTable(ta, tb, t, to) {
  for (const k in to) {
    if (!(k in ta) && !(k in tb)) {
      const v = to[k];
      v[0] = 0; v[1] = 0; v[2] = 0;
    }
  }
  for (const k in ta) {
    const av = ta[k];
    const bv = tb[k] ?? ZERO;
    let ov = to[k];
    if (!ov) ov = to[k] = [0, 0, 0];
    ov[0] = av[0] + (bv[0] - av[0]) * t;
    ov[1] = av[1] + (bv[1] - av[1]) * t;
    ov[2] = av[2] + (bv[2] - av[2]) * t;
  }
  for (const k in tb) {
    if (k in ta) continue;
    const bv = tb[k];
    let ov = to[k];
    if (!ov) ov = to[k] = [0, 0, 0];
    ov[0] = bv[0] * t;
    ov[1] = bv[1] * t;
    ov[2] = bv[2] * t;
  }
}

/** @param {Record<string, number[]>} base @param {Record<string, number[]>} add @param {number} w @param {Record<string, number[]>} to */
function addTable(base, add, w, to) {
  for (const k in to) {
    if (!(k in base) && !(k in add)) {
      const v = to[k];
      v[0] = 0; v[1] = 0; v[2] = 0;
    }
  }
  for (const k in base) {
    const bv = base[k];
    const av = add[k] ?? ZERO;
    let ov = to[k];
    if (!ov) ov = to[k] = [0, 0, 0];
    ov[0] = bv[0] + av[0] * w;
    ov[1] = bv[1] + av[1] * w;
    ov[2] = bv[2] + av[2] * w;
  }
  for (const k in add) {
    if (k in base) continue;
    const av = add[k];
    let ov = to[k];
    if (!ov) ov = to[k] = [0, 0, 0];
    ov[0] = av[0] * w;
    ov[1] = av[1] * w;
    ov[2] = av[2] * w;
  }
}

/**
 * 관절별 선형 보간(없는 관절은 0으로 본다).
 * @param {Pose} a @param {Pose} b @param {number} t @param {Pose} [out]
 * @returns {Pose} out 또는 새 포즈
 */
export function lerpPose(a, b, t, out) {
  const o = out ?? emptyPose();
  if (!o.pos) o.pos = {};
  lerpTable(a.rot, b.rot, t, o.rot);
  lerpTable(a.pos ?? EMPTY, b.pos ?? EMPTY, t, o.pos);
  return o;
}

/**
 * base + add × weight (덧포즈: 호흡 · 흔들림).
 * @param {Pose} base @param {Pose} add @param {number} weight @param {Pose} [out]
 * @returns {Pose}
 */
export function addPose(base, add, weight, out) {
  const o = out ?? emptyPose();
  if (!o.pos) o.pos = {};
  addTable(base.rot, add.rot, weight, o.rot);
  addTable(base.pos ?? EMPTY, add.pos ?? EMPTY, weight, o.pos);
  return o;
}

/**
 * src를 out에 복사한다(out에만 있던 관절은 0이 된다).
 * @param {Pose} src @param {Pose} [out]
 * @returns {Pose}
 */
export function copyPose(src, out) {
  return lerpPose(src, src, 0, out);
}

/** 한 관절의 회전에 더한다(없으면 만든다). 프레임 경로에서 덧동작을 얹을 때 쓴다. @param {Pose} pose @param {string} joint */
export function addRot(pose, joint, rx, ry, rz) {
  let v = pose.rot[joint];
  if (!v) v = pose.rot[joint] = [0, 0, 0];
  v[0] += rx; v[1] += ry; v[2] += rz;
}

/** 한 관절의 위치 오프셋에 더한다. @param {Pose} pose @param {string} joint */
export function addPos(pose, joint, x, y, z) {
  if (!pose.pos) pose.pos = {};
  let v = pose.pos[joint];
  if (!v) v = pose.pos[joint] = [0, 0, 0];
  v[0] += x; v[1] += y; v[2] += z;
}

const LEG_JOINTS = ['hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'];
/** 걸음 진폭 1일 때의 엉덩이 · 무릎 각(도) — 다리 길이의 두 배쯤 되는 보폭(달리듯 걷는 속도)에 맞춘 값 */
const GAIT_HIP = 38;
const GAIT_KNEE = 72;

/**
 * 걷기/달리기 사이클을 pose의 다리 · 팔 · 몸통에 얹는다(다리는 amp만큼 자세를 덮는다).
 * @param {Pose} pose
 * @param {number} cyc 사이클(한 바퀴 = 두 걸음)
 * @param {number} amp 0..1 걸음 진폭
 * @param {number} fwd 로컬 전진 성분(−1..1)
 * @param {number} side 로컬 오른쪽 성분(−1..1)
 * @param {number} run 0..1 달리기 정도
 * @param {number} armAmp 팔 흔들기 배율
 */
export function applyGait(pose, cyc, amp, fwd, side, run, armAmp) {
  if (!(amp > 0.001)) return;
  const s = Math.sin(cyc * Math.PI * 2);
  const c = Math.cos(cyc * Math.PI * 2);
  const hipA = (GAIT_HIP + 8 * run) * DEG;
  const kneeA = (GAIT_KNEE + 28 * run) * DEG;
  const sideA = 16 * DEG;
  const keep = 1 - amp;
  for (let i = 0; i < LEG_JOINTS.length; i++) {
    const v = pose.rot[LEG_JOINTS[i]];
    if (v) { v[0] *= keep; v[1] *= keep; v[2] *= keep; }
  }
  // 왼다리는 s, 오른다리는 −s. 무릎은 다리가 앞으로 나오는 동안(c 부호) 접힌다.
  const dir = fwd >= 0 ? 1 : -1;
  const f = Math.abs(fwd);
  addRot(pose, 'hipL', (-hipA * s * fwd - 0.12 * f) * amp, 0, (-sideA * s * side + 0.05) * amp);
  addRot(pose, 'hipR', (hipA * s * fwd - 0.12 * f) * amp, 0, (-sideA * s * side - 0.05) * amp);
  addRot(pose, 'kneeL', (0.2 + kneeA * Math.max(0, c * dir)) * amp, 0, 0);
  addRot(pose, 'kneeR', (0.2 + kneeA * Math.max(0, -c * dir)) * amp, 0, 0);
  addRot(pose, 'footL', 0.35 * Math.max(0, -s) * f * amp, 0, 0);
  addRot(pose, 'footR', 0.35 * Math.max(0, s) * f * amp, 0, 0);
  // 몸통 맞비틀림 · 팔 흔들기
  addRot(pose, 'hips', 0, -0.07 * s * fwd * amp, 0.03 * c * amp);
  addRot(pose, 'spine', (0.05 + 0.1 * run) * f * amp, 0.12 * s * fwd * amp, 0);
  const arm = (0.38 + 0.3 * run) * amp * armAmp;
  addRot(pose, 'shoulderL', arm * s * fwd, 0, 0);
  addRot(pose, 'elbowL', -0.25 * amp * armAmp * (1 + run), 0, 0);
  addRot(pose, 'shoulderR', -arm * 0.45 * s * fwd, 0, 0);
}

const _start = emptyPose();

/**
 * 공격 포즈 규칙(플레이어 · 보스 공용). W = set.windup, A = set.active,
 * releaseT = 예고의 끝에서 "무기가 출발하는" 구간의 비율(0..0.4), h = min(set.holdAt ?? 0.6, 1 − releaseT):
 *   windup  p < h               : lerp(idle, W, outCubic(p / h))             — 자세 완성
 *           h ≤ p < 1 − releaseT: W                                           — "멈춰 읽히는" 시간
 *           p ≥ 1 − releaseT    : lerp(W, A, RELEASE_FRAC × inQuad((p − (1 − releaseT)) / releaseT))
 *   charge  p: W + 떨림(진폭 ∝ p)                                             — 플레이어 강공격만
 *   active  p: lerp(S, A, outQuint(min(1, p / 0.5)))    S = releaseT > 0 ? lerp(W, A, RELEASE_FRAC) : W
 *   recovery p: p < 0.3 → lerp(A, set.follow ?? A, p / 0.3)
 *               p ≥ 0.3 → lerp(그 포즈, idle, inOutQuad((p − 0.3) / 0.7))
 * RELEASE_FRAC = 0.35. releaseT = 0이면 예고 끝 = W 그대로다.
 * @param {PoseSet} set
 * @param {Pose} idle
 * @param {'windup'|'charge'|'active'|'recovery'} phase
 * @param {number} phaseT 0..1
 * @param {Pose} [out]
 * @param {number} [releaseT]
 * @returns {Pose}
 */
export function attackPose(set, idle, phase, phaseT, out, releaseT = 0) {
  const o = out ?? emptyPose();
  const p = clamp01(Number.isFinite(phaseT) ? phaseT : 0);
  const W = set.windup;
  const A = set.active;
  const rT = Number.isFinite(releaseT) ? Math.min(RELEASE_MAX, Math.max(0, releaseT)) : 0;
  switch (phase) {
    case 'windup': {
      const h = Math.min(set.holdAt ?? HOLD_AT_DEFAULT, 1 - rT);
      if (p < h) return lerpPose(idle, W, ease.outCubic(p / h), o);
      if (rT <= 0 || p < 1 - rT) return copyPose(W, o);
      return lerpPose(W, A, RELEASE_FRAC * ease.inQuad((p - (1 - rT)) / rT), o);
    }
    case 'charge': {
      copyPose(W, o);
      const shake = Math.sin(p * CHARGE_SHAKE_FREQ) * CHARGE_SHAKE_AMP * p;
      addRot(o, 'spine', 0, shake, 0);
      addRot(o, 'shoulderR', shake * 0.6, 0, shake);
      addRot(o, 'handR', 0, 0, shake * 1.5);
      return o;
    }
    case 'active': {
      const k = ease.outQuint(Math.min(1, p / ACTIVE_REACH));
      if (rT > 0) {
        lerpPose(W, A, RELEASE_FRAC, _start);
        return lerpPose(_start, A, k, o);
      }
      return lerpPose(W, A, k, o);
    }
    default: {
      const F = set.follow ?? A;
      if (p < FOLLOW_FRAC) return lerpPose(A, F, p / FOLLOW_FRAC, o);
      return lerpPose(F, idle, ease.inOutQuad((p - FOLLOW_FRAC) / (1 - FOLLOW_FRAC)), o);
    }
  }
}

/**
 * 보스 뷰가 쓰는 releaseT: 판정 BOSS_RELEASE_LEAD(0.18초) 전에 무기가 출발한다 → clamp(0.18 / windupSec, 0, 0.4).
 * @param {number} windupSec attack.windup(실제 예고 길이)
 * @returns {number}
 */
export function bossReleaseT(windupSec) {
  if (!(windupSec > 0)) return windupSec === 0 ? RELEASE_MAX : 0;
  return Math.min(RELEASE_MAX, Math.max(0, BOSS_RELEASE_LEAD / windupSec));
}

/** 상태가 튀어도 관절이 부드럽게 따라가게 하는 지수 감쇠 블렌더. */
export class PoseBlender {
  /**
   * @param {import('./rig.js').Rig} rig
   * @param {number} [halfLife] 초
   */
  constructor(rig, halfLife = 0.05) {
    this.rig = rig;
    this.halfLife = halfLife;
    /** 지금 리그에 적용된 포즈 */
    this.pose = emptyPose();
    this._started = false;
  }

  /** target 쪽으로 반감기만큼 다가가 리그에 적용한다. @param {Pose} targetPose @param {number} dt @param {number} [halfLife] */
  update(targetPose, dt, halfLife = this.halfLife) {
    if (!this._started) {
      this.snap(targetPose);
      return;
    }
    const k = halfLife > 0 ? 1 - Math.pow(0.5, Math.max(0, dt) / halfLife) : 1;
    lerpPose(this.pose, targetPose, k, this.pose);
    this.rig.applyPose(this.pose);
  }

  /** 보간 없이 바로 맞춘다. @param {Pose} targetPose */
  snap(targetPose) {
    copyPose(targetPose, this.pose);
    this._started = true;
    this.rig.applyPose(this.pose);
  }
}
