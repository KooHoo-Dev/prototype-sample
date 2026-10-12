// OWNER: P7 — 계약 §9.4 「가리는 벽 낮추기」 (순수 함수 — view.world.test 가 직접 부른다)
// 플레이어에서 14m 안의 벽 중 (벽 − 플레이어) · (sin az, cos az) > 0.5(카메라 쪽)이고 화면 가로 거리 |(벽 − 플레이어) · (1, 0, −1)/√2| < 5m 인 것을
// 높이 0.6m 로 0.15초에 걸쳐 낮춘다(돌아오는 것도 0.15초). 판정(sim)은 바뀌지 않는다.

import { CAM_AZIMUTH, CAM_ELEVATION } from '../../core/constants.js';

export const WALL_FADE = {
  range: 14,     // m — 플레이어에서
  along: 0.5,    // m — 카메라 쪽으로 이만큼 넘어야
  lateral: 5,    // m — 화면 가로 거리 상한
  lowH: 0.6,     // m — 낮춘 높이
  sec: 0.15,     // 초 — 낮추기 · 돌아오기
};

const AX = Math.sin(CAM_AZIMUTH), AZ = Math.cos(CAM_AZIMUTH);
const RX = Math.SQRT1_2, RZ = -Math.SQRT1_2;   // 화면 오른쪽 (1, 0, −1)/√2

/**
 * 벽(또는 키 큰 물체) 중심이 플레이어를 가리는 쪽인가.
 * @param {number} dx 벽 x − 플레이어 x @param {number} dz 벽 z − 플레이어 z
 * @returns {boolean}
 */
export function occludesPlayer(dx, dz) {
  if (dx * dx + dz * dz > WALL_FADE.range * WALL_FADE.range) return false;
  if (dx * AX + dz * AZ <= WALL_FADE.along) return false;
  return Math.abs(dx * RX + dz * RZ) < WALL_FADE.lateral;
}

const COT_EL = 1 / Math.tan(CAM_ELEVATION);

/**
 * 키 큰 소품(기둥 · 석순 — 계약 밖 · P7 추가)이 플레이어를 가리는가: 카메라 쪽으로 그 높이가 가릴 수 있는 거리(h · cot 55° + r + 0.6) 안 ·
 * 가로 r + 1.2m 안. 벽보다 좁게 — 방의 기둥이 멀리서부터 줄줄이 낮아지지 않게.
 * @param {number} dx @param {number} dz 소품 − 플레이어 @param {number} r 소품 반지름 @param {number} h 소품 높이
 */
export function propOccludesPlayer(dx, dz, r, h) {
  const along = dx * AX + dz * AZ;
  if (along <= 0 || along > h * COT_EL + r + 0.6) return false;
  return Math.abs(dx * RX + dz * RZ) < r + 1.2;
}

/**
 * 높이 배율을 목표로 민다(0.15초에 낮은 높이 ↔ 전체). smooth false(화질 low)면 즉시.
 * @param {number} cur 지금 높이 배율(lowFrac..1) @param {number} target @param {number} dt 초 @param {boolean} smooth @param {number} lowFrac
 */
export function stepFade(cur, target, dt, smooth, lowFrac) {
  if (!smooth || !(dt >= 0)) return target;
  const rate = (1 - lowFrac) / WALL_FADE.sec;
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}
