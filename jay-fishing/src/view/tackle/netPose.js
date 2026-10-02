// OWNER: P6 — 계약 §9.7 · §9.8 · §9.10 (폴더 src/view/tackle/ 내부 파일)
// 뜰채 자세와 물고기 위치 — TackleLayer(뜰채)와 FishLayer(뜰채 속 물고기 · 그림자)가 같은 식을 쓴다.
// 보이는 길이 = 팔 0.4 + 손잡이(netRangeM − 0.75) + 테 반경 0.35 = netRangeM (§9.10 · 허용 0.35m).

import * as THREE from 'three';
import { clamp, clamp01, fwdX, fwdZ, lerp, lerpAngle, smoothstep, yawOf } from '../../core/math.js';
import { RIG } from '../../data/bite.js';
import { FIGHT } from '../../data/fight.js';
import { SPOTS_BY_ID } from '../../data/stages/index.js';

export const NET_ARM_M = 0.4;            // 팔(카메라 → 왼손)
export const NET_HOOP_R = 0.35;          // 테 반경
export const LEFT_HAND_CAM = new THREE.Vector3(-0.24, -0.21, -0.36);   // 카메라 공간 왼손(화면 왼쪽 아래 · 수평 거리 ≈ 0.43m)
const REST_PITCH = -0.3;                 // 떠 올린 자세의 손잡이 각(수평 아래)
const MIN_PITCH = -1.15;
const LIFT_PITCH = 0.0;                  // 떠 올린 끝 — 물고기가 든 그물이 시야 안으로 올라온다(화면 패스: −0.08 → 0 — 그물이 「뜰채로 뜨는 중」 안내 뒤에 걸렸다)
const SCOOP_IN = 0.25;                   // 뜰채 진행 비율: 0 → 0.25 물고기 쪽으로 · 0.25 → 0.4 뜬다 · 0.4 → 0.75 들어 올린다 · 0.75 → 1 든 채 보인다
const SCOOP_HOLD = 0.4;                  // 화면 패스: 0.6 → 0.4 · 들어 올림을 0.75 에 끝낸다 — 시선이 수평이라 물가 아래에서 뜨는 동안은 화면 밖이고,
const LIFT_END = 0.75;                   //   전에는 그물이 마지막 0.1초에만 보였다(결과 패널이 곧 덮는다)

/** 손잡이 길이(m) = netRangeM − 0.75 @param {number} netRangeM */
export function netHandleLength(netRangeM) {
  return Math.max(0.2, netRangeM - (NET_ARM_M + NET_HOOP_R));
}

/**
 * 파이팅 물고기의 수면 위치(보간) — origin + fwd(bearing) × dist. y 는 넣지 않는다.
 * @param {Object} state GameState @param {number} alpha @param {THREE.Vector3} out @returns {boolean} fight 가 있으면 true
 */
export function fishPoint(state, alpha, out) {
  const f = state.fight;
  const o = state.rig.origin;
  if (!f) {
    out.set(o.x, 0, o.z);
    return false;
  }
  const a = clamp01(Number.isFinite(alpha) ? alpha : 1);
  const b = lerpAngle(f.prevBearing, f.bearing, a);
  const d = Math.max(lerp(f.prevDist, f.dist, a), f.minDist ?? 0);
  out.set(o.x + fwdX(b) * d, 0, o.z + fwdZ(b) * d);
  return true;
}

/** 뜰채 진행 0..1 @param {Object} state */
export function netProgress(state) {
  return state.rig.phase === 'landing' ? clamp01(state.rig.phaseTime / RIG.netTime) : 0;
}

/**
 * 뜰채의 월드 자세. out.hand(왼손) · out.dir(손잡이 방향) · out.hoop(테 중심) · out.handleLen · out.reach(팔 + 손잡이 + 테 = netRangeM)
 * @param {THREE.Camera} camera matrixWorld 가 갱신된 카메라 @param {Object} state @param {number} alpha
 * @param {{hand:THREE.Vector3, dir:THREE.Vector3, hoop:THREE.Vector3, target:THREE.Vector3, handleLen:number, reach:number, p:number}} out
 */
export function netPose(camera, state, alpha, out) {
  const f = state.fight;
  const spot = state.player.spotId ? SPOTS_BY_ID[state.player.spotId] : null;
  const spotEdge = spot ? spot.edgeM : 0;
  const netRangeM = f && Number.isFinite(f.netRangeM) ? f.netRangeM : spotEdge + FIGHT.netReachM;
  out.handleLen = netHandleLength(netRangeM);
  out.reach = NET_ARM_M + out.handleLen + NET_HOOP_R;
  out.p = netProgress(state);
  out.hand.copy(LEFT_HAND_CAM);
  camera.localToWorld(out.hand);
  fishPoint(state, alpha, out.target);
  out.target.y = -0.1;
  const dx = out.target.x - out.hand.x;
  const dz = out.target.z - out.hand.z;
  const yaw = yawOf(dx, dz);
  const horiz = Math.max(1e-3, Math.hypot(dx, dz));
  const len = out.handleLen + NET_HOOP_R;
  // 물고기를 향한 각(테 중심이 물고기 높이에 닿게 — 닿지 않으면 가장 가까운 각)
  const drop = out.target.y - out.hand.y;
  const reachPitch = clamp(Math.atan2(drop, horiz), MIN_PITCH, 0.2);
  const p = out.p;
  let pitch;
  if (p < SCOOP_IN) pitch = lerp(REST_PITCH, reachPitch, smoothstep(0, SCOOP_IN, p));
  else if (p < SCOOP_HOLD) pitch = reachPitch;
  else pitch = lerp(reachPitch, LIFT_PITCH, smoothstep(SCOOP_HOLD, LIFT_END, p));
  const cp = Math.cos(pitch);
  out.dir.set(fwdX(yaw) * cp, Math.sin(pitch), fwdZ(yaw) * cp);
  out.hoop.copy(out.dir).multiplyScalar(len).add(out.hand);
  return out;
}

/** 뜰채 속 물고기의 위치(테 안 · 그물 쪽으로 조금 아래) @param {{hoop:THREE.Vector3, target:THREE.Vector3, p:number}} pose @param {THREE.Vector3} out */
export function fishInNet(pose, out) {
  const k = smoothstep(0, SCOOP_IN, pose.p);
  out.copy(pose.target).lerp(pose.hoop, k);
  out.y -= 0.12 * k;
  return out;
}
