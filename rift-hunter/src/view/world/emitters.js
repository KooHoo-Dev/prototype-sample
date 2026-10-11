// OWNER: P7 — 계약 §9.4 「빛 — 먼 빛은 발광 메시만」 (내부)
// 맵 빛(LightDef) → 발광체 메시(벽 횃불 · 기둥 횃불 · 화로)와 불꽃 · 후광 자리. 촛불 · 용암은 소품이 몸을 그리고 여기서는 후광만.

import * as THREE from 'three';
import { TILE_WALL } from '../../core/constants.js';
import { tileAt } from '../../sim/world/nav.js';
import { GeoBuilder, rgb, xf } from './build.js';
import { EMIT, EMIT_DEFAULT, FLAME } from './style.js';

const WOOD = 0x4a3220, IRON = 0x3c3c44;

/**
 * @param {import('../../types.js').MapData} map
 * @param {GeoBuilder} M matte @param {GeoBuilder} T metal @param {GeoBuilder} E emit
 * @param {Array<{x:number, y:number, z:number, s:number}>} flames
 * @param {Array<{x:number, y:number, z:number, size:number, color:number, k:number, ground?:boolean, cand?:number}>} glows
 */
export function buildEmitters(map, M, T, E, flames, glows) {
  map.lights.forEach((l, i) => {
    const spec = EMIT[l.kind] ?? EMIT_DEFAULT;
    const color = new THREE.Color(l.color).getHex();
    const gy = spec.glowY ?? l.y;
    if (spec.mesh === 'sconce') sconce(map, l, M, T, flames);
    else if (spec.mesh === 'brazier') brazier(l, M, T, E, flames);
    glows.push({ x: l.x, y: gy, z: l.z, size: spec.glow, color, k: spec.ground ? 0.55 : 0.85, ground: spec.ground, cand: i });
  });
}

/** 벽(0.8m 안)에 붙은 횃불 — 쇠 받침 + 나무 자루 + 불꽃. 벽이 없으면 땅에 세운 기둥 횃불 */
function sconce(map, l, M, T, flames) {
  let wx = 0, wz = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (tileAt(map, l.x + dx * 0.8, l.z + dz * 0.8) === TILE_WALL) { wx = dx; wz = dz; break; }
  }
  if (wx || wz) {
    const yaw = Math.atan2(-wx, -wz);   // 벽에서 방 쪽을 본다
    const back = 0.3;
    T.add(new THREE.BoxGeometry(0.22, 0.34, 0.05), xf(l.x + wx * back, l.y - 0.32, l.z + wz * back, yaw), IRON);
    T.add(new THREE.BoxGeometry(0.05, 0.05, 0.3), xf(l.x + wx * 0.15, l.y - 0.32, l.z + wz * 0.15, yaw), IRON);
    M.add(new THREE.CylinderGeometry(0.035, 0.03, 0.45, 5), xf(l.x, l.y - 0.22, l.z, yaw, 1, 1, 1, 0.3), WOOD);
    T.add(new THREE.CylinderGeometry(0.075, 0.05, 0.1, 6), xf(l.x - wx * 0.04, l.y - 0.02, l.z - wz * 0.04, yaw), IRON);
    flames.push({ x: l.x - wx * 0.04, y: l.y, z: l.z - wz * 0.04, s: 1 });
  } else {
    M.add(new THREE.CylinderGeometry(0.06, 0.08, l.y - 0.1, 6), xf(l.x, (l.y - 0.1) / 2, l.z), WOOD);
    M.add(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 6), xf(l.x, 0.04, l.z), 0x55504a);
    T.add(new THREE.CylinderGeometry(0.1, 0.06, 0.14, 6), xf(l.x, l.y - 0.05, l.z), IRON);
    flames.push({ x: l.x, y: l.y + 0.02, z: l.z, s: 1.15 });
  }
}

/** 화로 — 쇠 다리 셋 + 사발 + 숯(발광) + 불꽃 */
function brazier(l, M, T, E, flames) {
  const top = l.y - 0.18;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    T.add(new THREE.CylinderGeometry(0.03, 0.03, top + 0.05, 4), xf(l.x + Math.sin(a) * 0.2, top / 2, l.z + Math.cos(a) * 0.2, a, 1, 1, 1, -0.22), IRON);
  }
  T.add(new THREE.CylinderGeometry(0.36, 0.2, 0.24, 8), xf(l.x, top, l.z), 0x4a4440);
  E.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8), xf(l.x, top + 0.1, l.z), rgb(FLAME.edge, 2.2));
  M.add(new THREE.CylinderGeometry(0.5, 0.55, 0.06, 8), xf(l.x, 0.03, l.z), 0x2a201c);
  flames.push({ x: l.x, y: top + 0.1, z: l.z, s: 1.5 });
}

/** 불꽃 하나의 지오메트리(원점 = 불꽃 바닥 · 높이 약 0.42m) — 바깥 주황 원뿔 + 안쪽 밝은 심 */
export function flameGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.OctahedronGeometry(0.1, 0), xf(0, 0.08, 0, 0, 1, 0.9, 1), rgb(FLAME.mid, 2.2));
  b.add(new THREE.ConeGeometry(0.1, 0.34, 6), xf(0, 0.25, 0, 0.5), rgb(FLAME.edge, 2.0), { shade: (x, y) => 1.2 - (y + 0.17) * 1.2 });
  b.add(new THREE.ConeGeometry(0.055, 0.2, 5), xf(0.045, 0.16, 0.045, 0.2), rgb(FLAME.core, 2.6));
  return b.build();
}
