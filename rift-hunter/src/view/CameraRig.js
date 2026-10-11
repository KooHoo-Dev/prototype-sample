// OWNER: P7 — 계약 §6.14 · §9.3
// STUB — W1 에서 P7 이 채운다(임계 감쇠 스프링 · 줌 감쇠 · 흔들림 · PLAYER_SPAWNED snap). W0: 플레이어 보간 위치 + 고정 오프셋(앞당김 포함) · 휠 줌

import { CAM_AZIMUTH, CAM_DISTANCE, CAM_DISTANCE_MAX, CAM_DISTANCE_MIN, CAM_ELEVATION, CAM_LEAD, CAM_ZOOM_STEP } from '../core/constants.js';

const TARGET_Y = 1.0;

export class CameraRig {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.dist = CAM_DISTANCE;
    this._target = { x: 0, z: 0 };
  }

  /** 플레이어 보간 위치를 따라감 @param {import('../types.js').GameState} state @param {number} alpha @param {number} dtReal */
  update(state, alpha, dtReal) {
    const p = state.player;
    const x = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
    const z = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
    const lead = CAM_LEAD * this.dist * Math.SQRT1_2;
    const tx = x + lead, tz = z + lead;
    this._target = { x, z };
    const ce = Math.cos(CAM_ELEVATION);
    const cam = this.rc.camera;
    cam.position.set(
      tx + this.dist * Math.sin(CAM_AZIMUTH) * ce,
      TARGET_Y + this.dist * Math.sin(CAM_ELEVATION),
      tz + this.dist * Math.cos(CAM_AZIMUTH) * ce,
    );
    cam.lookAt(tx, TARGET_Y, tz);
  }

  /** 휠 — + 멀리 · − 가까이 @param {number} steps */
  zoom(steps) {
    this.dist = Math.max(CAM_DISTANCE_MIN, Math.min(CAM_DISTANCE_MAX, this.dist + steps * CAM_ZOOM_STEP));
  }

  /** 보간 없이 바로(W0 은 늘 바로) */
  snap() {}

  /** 카메라가 보는 월드 점(플레이어 보간 위치) */
  get target() {
    return this._target;
  }

  dispose() {}
}
