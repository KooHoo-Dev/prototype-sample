// OWNER: P7 — 계약 §6.14 · §9.3 · §0.2
// 쿼터뷰 카메라: 방위 π/4 고정 · 앙각 55° · fov 40° · 거리 기본 24m(휠 한 칸 2m · 16~32m · 줌 0.2초 감쇠).
// 대상 = 플레이어 보간 위치(y 1.0) + 카메라 쪽으로 0.12 × 거리(플레이어가 화면 세로 가운데 — 아래쪽도 위쪽만큼 보인다).
// 따라가기 = 임계 감쇠 스프링 ω 8/s(해석해 — 큰 dt 에도 넘치지 않는다 · 한 프레임 순간이동 없음) · PLAYER_SPAWNED · snap() 만 바로.
// 흔들림 = SHAKE{amp, sec} → 진폭 amp × 0.25m(상한 0.25m) · 18Hz · 선형 감쇠 · 여럿이면 큰 쪽 · 설정 screenShake 끄면 0.
// 기본 거리 24m · 앞당김 0.12 × 거리에서 플레이어 위 · 아래 각 11m 넘게 보인다 — MON.threatRange 11m · BOT.viewR 11.4m 와 묶인 값(바꾸면 셋을 같이).
// 시간: 실제 시간(dtReal)이 흐르면 그것, 정지 화면(__game.step — dtReal 0)이면 민 틱만큼(§9.1).

import { CAM_AZIMUTH, CAM_DISTANCE, CAM_DISTANCE_MAX, CAM_DISTANCE_MIN, CAM_ELEVATION, CAM_LEAD, CAM_ZOOM_STEP, DT } from '../core/constants.js';
import { EV } from '../core/events.js';

export const CAMERA = {
  targetY: 1.0,
  omega: 8,            // 1/s — 임계 감쇠 스프링
  zoomTau: 0.2 / 3,    // s — 줌 감쇠(0.2초에 95%)
  shakeUnit: 0.25,     // m — amp 1 의 진폭
  shakeMax: 0.25,      // m — 진폭 상한
  shakeHz: 18,
  maxDt: 1,            // s — 한 번에 미는 시간 상한(탭 복귀 등)
};

const CE = Math.cos(CAM_ELEVATION), SE = Math.sin(CAM_ELEVATION);
const SA = Math.sin(CAM_AZIMUTH), CA = Math.cos(CAM_AZIMUTH);
/** 카메라 쪽 단위 벡터(대상 → 카메라) */
const OUT_X = SA * CE, OUT_Y = SE, OUT_Z = CA * CE;
/** 화면 오른쪽 · 위(흔들림 축) */
const RIGHT_X = Math.SQRT1_2, RIGHT_Z = -Math.SQRT1_2;
const UP_X = -SE * SA, UP_Y = CE, UP_Z = -SE * CA;

/**
 * 플레이어 지점과 거리 → 카메라 자리 · 보는 점(§0.2 · §9.3). 순수 함수(테스트).
 * @param {number} fx @param {number} fz 따라가는 플레이어 지점 @param {number} dist
 * @param {{px:number, py:number, pz:number, tx:number, ty:number, tz:number}} [out]
 */
export function cameraPose(fx, fz, dist, out = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }) {
  const lead = CAM_LEAD * dist * Math.SQRT1_2;
  out.tx = fx + lead;
  out.ty = CAMERA.targetY;
  out.tz = fz + lead;
  out.px = out.tx + dist * OUT_X;
  out.py = out.ty + dist * OUT_Y;
  out.pz = out.tz + dist * OUT_Z;
  return out;
}

/**
 * 임계 감쇠 스프링 한 축(해석해) — 위치 x · 속도 v 를 목표 g 로 dt 만큼
 * @returns {number} 새 위치(속도는 out[0])
 */
export function springAxis(x, v, g, omega, dt, out) {
  const e = x - g;
  const k = Math.exp(-omega * dt);
  const c = v + omega * e;
  const nx = g + (e + c * dt) * k;
  out[0] = (v - omega * c * dt) * k;
  return nx;
}

/** 휠 줌 목표 거리(+ 멀리 · − 가까이 · 한 칸 2m · 16~32m) */
export function zoomTargetAfter(cur, steps) {
  const s = Number.isFinite(steps) ? steps : 0;
  return Math.max(CAM_DISTANCE_MIN, Math.min(CAM_DISTANCE_MAX, cur + s * CAM_ZOOM_STEP));
}

export class CameraRig {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.dist = CAM_DISTANCE;
    this.zoomTarget = CAM_DISTANCE;
    this._fx = 0; this._fz = 0; this._vx = 0; this._vz = 0;
    this._has = false;
    this._snapPending = true;
    this._lastSimT = -1;
    this._sv = [0];
    this._pose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
    /** 카메라가 보는 월드 점(앞당김 포함) — 같은 객체를 고쳐 쓴다 */
    this._target = { x: 0, y: CAMERA.targetY, z: 0 };
    this._shakeAmp = 0; this._shakeDur = 0; this._shakeT = 0;
    /** 마지막 프레임의 흔들림 크기(m · 테스트 · 디버그) */
    this.shakeOffset = 0;
    this._offs = [];
    if (bus && typeof bus.on === 'function') {
      this._offs.push(bus.on(EV.PLAYER_SPAWNED, (p) => {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) this._snapTo(p.x, p.z);
        this._snapPending = true;
      }));
      this._offs.push(bus.on(EV.SHAKE, (p) => this.shake(p?.amp, p?.sec)));
    }
  }

  /** 흔들기(SHAKE 이벤트가 부른다) — 큰 쪽이 이긴다 @param {number} amp 0..1 @param {number} sec */
  shake(amp, sec) {
    if (this.settings && this.settings.screenShake === false) return;
    const a = Math.min(CAMERA.shakeMax, Math.max(0, Number(amp) || 0) * CAMERA.shakeUnit);
    const d = Math.max(0, Number(sec) || 0);
    if (!(a > 0) || !(d > 0)) return;
    const rem = this._shakeT < this._shakeDur ? this._shakeAmp * (1 - this._shakeT / this._shakeDur) : 0;
    if (a >= rem) { this._shakeAmp = a; this._shakeDur = d; this._shakeT = 0; }
  }

  _snapTo(x, z) {
    this._fx = x; this._fz = z; this._vx = 0; this._vz = 0;
    this.dist = this.zoomTarget;
    this._has = true;
    cameraPose(x, z, this.dist, this._pose);
    this._target.x = this._pose.tx;
    this._target.z = this._pose.tz;
  }

  /**
   * 플레이어 보간 위치를 따라감 · 흔들림 · 줌
   * @param {import('../types.js').GameState} state @param {number} alpha @param {number} dtReal
   */
  update(state, alpha, dtReal) {
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    const simT = (state?.tick ?? 0) + a;
    const simDt = this._lastSimT >= 0 ? Math.max(0, (simT - this._lastSimT) * DT) : 0;
    this._lastSimT = simT;
    const dt = Math.min(CAMERA.maxDt, dtReal > 0 ? dtReal : simDt);

    const p = state?.player;
    let px = this._fx, pz = this._fz, have = false;
    if (p && p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)) {
      const pp = p.prevPos && Number.isFinite(p.prevPos.x) ? p.prevPos : p.pos;
      px = pp.x + (p.pos.x - pp.x) * a;
      pz = pp.z + (p.pos.z - pp.z) * a;
      have = true;
    }
    if (have && (this._snapPending || !this._has)) {
      this._snapTo(px, pz);
      this._snapPending = false;
    } else if (have && dt > 0) {
      this._fx = springAxis(this._fx, this._vx, px, CAMERA.omega, dt, this._sv); this._vx = this._sv[0];
      this._fz = springAxis(this._fz, this._vz, pz, CAMERA.omega, dt, this._sv); this._vz = this._sv[0];
    }
    if (dt > 0 && this.dist !== this.zoomTarget) {
      this.dist += (this.zoomTarget - this.dist) * (1 - Math.exp(-dt / CAMERA.zoomTau));
      if (Math.abs(this.zoomTarget - this.dist) < 1e-3) this.dist = this.zoomTarget;
    }
    const pose = cameraPose(this._fx, this._fz, this.dist, this._pose);
    this._target.x = pose.tx;
    this._target.z = pose.tz;

    // 흔들림(실제 시간 · 화면 오른쪽/위 평면 · 크기 ≤ 남은 진폭)
    let ox = 0, oy = 0, oz = 0;
    this.shakeOffset = 0;
    if (this._shakeT < this._shakeDur) {
      this._shakeT += dt;
      const rem = this._shakeT < this._shakeDur ? this._shakeAmp * (1 - this._shakeT / this._shakeDur) : 0;
      if (rem > 0 && this.settings?.screenShake !== false) {
        const t = this._shakeT;
        const s = Math.sin(t * Math.PI * 2 * CAMERA.shakeHz);
        const phi = t * 7.3 + 0.6;
        const cr = Math.cos(phi) * rem * s, cu = Math.sin(phi) * rem * s;
        ox = RIGHT_X * cr + UP_X * cu;
        oy = UP_Y * cu;
        oz = RIGHT_Z * cr + UP_Z * cu;
        this.shakeOffset = Math.hypot(ox, oy, oz);
      }
    }

    const cam = this.rc.camera;
    if (cam) {
      cam.position.set(pose.px + ox, pose.py + oy, pose.pz + oz);
      cam.lookAt(pose.tx + ox, pose.ty + oy, pose.tz + oz);
      cam.updateMatrixWorld();
    }
    // 안개: 줌해도 플레이어 자리의 안개 양이 같게(밀도 ∝ 1 / 거리 — NOTES-P7)
    const scene = this.rc.scene;
    if (scene && scene.fog && scene.userData && Number.isFinite(scene.userData.fogBase)) {
      scene.fog.density = scene.userData.fogBase * (CAM_DISTANCE / this.dist);
    }
  }

  /** 휠(app 이 부른다) — + 멀리 · − 가까이 @param {number} steps */
  zoom(steps) {
    this.zoomTarget = zoomTargetAfter(this.zoomTarget, steps);
  }

  /** 보간 없이 바로(PLAYER_SPAWNED 에서 스스로도 부른다) — 다음 update 가 플레이어 자리로 바로 옮긴다 */
  snap() {
    this._snapPending = true;
  }

  /** 카메라가 보는 월드 점(벽 낮추기 · 컬링 기준) */
  get target() {
    return this._target;
  }

  dispose() {
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs = [];
  }
}
