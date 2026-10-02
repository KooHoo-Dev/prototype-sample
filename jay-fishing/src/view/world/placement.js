// OWNER: P5 — 내부 파일 · 소품 배치 규칙(§9.4) — 소품 빌더(home · lake, 그리고 원하면 P11 · P12)가 같이 쓰는 순수 판정.

import { angleDiff, pointInConvex, yawOf } from '../../core/math.js';

const VIEW_RANGE = 62;       // m — 낚시 자리 수면 시야(60m) + 여유
const VIEW_PAD = 0.14;       // rad — facing ± arc 바깥 여유
const STAND_CLEAR = 3.2;     // m — 설 자리 둘레는 비운다

/** 낚시 자리에서 facing ± arc · 60m 안의 수면 시야에 들어가는 점인가(가리면 안 된다) */
export function inSpotView(stage, x, z) {
  for (const sp of stage.spots) {
    const dx = x - sp.stand.x;
    const dz = z - sp.stand.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < STAND_CLEAR * STAND_CLEAR) return true;
    if (d2 > VIEW_RANGE * VIEW_RANGE) continue;
    if (Math.abs(angleDiff(sp.facing, yawOf(dx, dz))) < sp.arc + VIEW_PAD) return true;
  }
  return false;
}

/** 걷는 영역 안인가 */
export function inWalk(stage, x, z) { return pointInConvex(stage.walk, x, z); }

/** obstacles 원 안인가(여유 pad 만큼 안쪽) */
export function inObstacle(stage, x, z, pad = 0) {
  for (const o of stage.obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz <= (o.r - pad) * (o.r - pad)) return true;
  }
  return false;
}

/** 높이 0.5m 를 넘는 소품을 (x, z)에 반경 r 로 둬도 되는가 — 걷는 영역 밖이거나 obstacles 원 안(§9.4) */
export function tallAllowed(stage, x, z, r = 0) {
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const px = i === n ? x : x + Math.cos(a) * r;
    const pz = i === n ? z : z + Math.sin(a) * r;
    if (inWalk(stage, px, pz) && !inObstacle(stage, px, pz)) return false;
  }
  return true;
}
