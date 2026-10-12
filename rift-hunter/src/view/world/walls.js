// OWNER: P7 — 계약 §9.4 「벽」 (내부)
// 벽 타일마다 인스턴스 하나(InstancedMesh — 타일셋 모양): crypt 다듬은 돌 블록(줄눈 · 어긋쌓기) + 위 장식 띠 · cavern 꼭짓점을 흔든 바위(변형 3) ·
// town 돌 기단 + 말뚝 울타리. 높이 WALL_H 3.0m · 원점 = 타일 중심 바닥 · 낮추기는 인스턴스 y 배율.

import * as THREE from 'three';
import { TILE, TILE_WALL } from '../../core/constants.js';
import { GeoBuilder, hash01, mixRgb, xf } from './build.js';
import { PAL, WALL_H } from './style.js';

/** 타일셋별 변형 수 */
const VARIANTS = { crypt: 1, cavern: 3, town: 1 };

/** @param {import('../../types.js').MapData} map */
export function wallTileCount(map) {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_WALL) n++;
  return n;
}

/**
 * 벽 인스턴스 자리(타일 순 · 결정적)
 * @param {import('../../types.js').MapData} map @param {number} seed
 * @returns {Array<{tile:number, x:number, z:number, variant:number, yaw:number, tint:number}>}
 */
export function wallPlacement(map, seed) {
  const nv = VARIANTS[map.tileset] ?? 1;
  const out = [];
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    const t = j * map.w + i;
    if (map.tiles[t] !== TILE_WALL) continue;
    const r = hash01(i, j, seed, 41);
    out.push({
      tile: t,
      x: (i + 0.5) * TILE,
      z: (j + 0.5) * TILE,
      variant: Math.floor(hash01(i, j, seed, 42) * nv) % nv,
      yaw: Math.floor(r * 4) * (Math.PI / 2),
      tint: 1 + (hash01(i, j, seed, 43) - 0.5) * (map.tileset === 'cavern' ? 0.16 : 0.12),
    });
  }
  return out;
}

/** 변형 지오메트리 목록(타일셋) @param {string} tileset @returns {THREE.BufferGeometry[]} */
export function wallVariants(tileset) {
  if (tileset === 'cavern') return [0, 1, 2].map(cavernRock);
  if (tileset === 'town') return [townWall()];
  return [cryptWall()];
}

const box = (w, h, d, sx = 1, sy = 1, sz = 1) => new THREE.BoxGeometry(w, h, d, sx, sy, sz);

/** 다듬은 돌 블록 — 코어(줄눈 색) + 기단 + 3단 어긋쌓기 + 장식 띠 + 어두운 윗면 */
function cryptWall() {
  const P = PAL.crypt;
  const b = new GeoBuilder();
  const H = WALL_H;
  b.add(box(1.94, H - 0.1, 1.94), xf(0, (H - 0.1) / 2, 0), P.wallCore);
  b.add(box(2.04, 0.3, 2.04), xf(0, 0.15, 0), P.plinth);
  const course = 0.8, g = 0.02, y0 = 0.3;
  for (let k = 0; k < 3; k++) {
    const yb = y0 + k * course + g, h = course - 2 * g, yc = yb + h / 2;
    const shade = 0.82 + 0.09 * k;
    if (k % 2 === 0) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const c = mixRgb(P.wall, P.wallAlt, hash01(k, sx + 2, sz + 2, 7), shade);
        b.add(box(1 - g, h, 1 - g), xf(sx * (0.5 + g / 2), yc, sz * (0.5 + g / 2)), c);
      }
    } else {
      const c = mixRgb(P.wall, P.wallAlt, 0.35, shade);
      b.add(box(2 - 2 * g, h, 2 - 2 * g), xf(0, yc, 0), c);
    }
  }
  b.add(box(2.08, 0.16, 2.08), xf(0, 2.78, 0), P.wallBand);
  b.add(box(1.96, 0.14, 1.96), xf(0, H - 0.07, 0), P.wallTop);
  return b.build();
}

/** 흔든 바위 — 아래 넓고 위 좁게 · 윗면은 밝게(재가 앉음) */
function cavernRock(v) {
  const P = PAL.cavern;
  const b = new GeoBuilder();
  const H = WALL_H;
  const g = box(2.3, H, 2.3, 3, 4, 3);
  g.translate(0, H / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = 1 - 0.28 * (y / H);
    pos.setX(i, pos.getX(i) * t);
    pos.setZ(i, pos.getZ(i) * t);
  }
  const shade = (lx, ly) => 0.55 + 0.6 * Math.min(1, Math.max(0, ly / H));
  const base = mixRgb(P.rock, P.rockAlt, [0.2, 0.6, 0.9][v] ?? 0.5);
  b.add(g, xf(0, 0, 0), base, { jitter: 0.24, jitterY: 0.32, jitterSeed: 100 + v * 17, shade, keepBottom: 0 });
  // 바닥 쪽 덩어리 하나 더(실루엣이 상자로 보이지 않게)
  const lump = new THREE.IcosahedronGeometry(0.9, 0);
  b.add(lump, xf(0.35 * (v - 1), 0.45, -0.3 + 0.3 * v, v, 1.25, 0.7, 1.1), P.rockBase, { jitter: 0.12, jitterSeed: 200 + v });
  // 윗면 재빛 덮개
  const cap = new THREE.CylinderGeometry(0.85, 1.05, 0.2, 7);
  b.add(cap, xf(0, H - 0.05, 0, v * 0.7), P.rockTop, { jitter: 0.1, jitterSeed: 300 + v });
  return b.build();
}

/** 마을 둘레 — 돌 기단 + 뾰족 말뚝 두 줄 + 가로 들보 */
function townWall() {
  const P = PAL.town;
  const b = new GeoBuilder();
  b.add(box(2.0, 0.9, 2.0), xf(0, 0.45, 0), P.wallStone, { shade: (lx, ly) => 0.8 + 0.3 * (ly + 0.45) });
  b.add(box(2.04, 0.1, 2.04), xf(0, 0.95, 0), P.wallStone, { shade: () => 1.15 });
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 4; k++) {
      const x = -0.75 + k * 0.5, z = row ? 0.38 : -0.38;
      const h = 1.55 + hash01(k, row, 3, 9) * 0.4;
      const r = 0.15 + hash01(k, row, 4, 9) * 0.04;
      b.add(new THREE.CylinderGeometry(r, r * 1.05, h, 6), xf(x, 1.0 + h / 2, z, k), P.stake);
      b.add(new THREE.ConeGeometry(r, 0.35, 6), xf(x, 1.0 + h + 0.17, z, k), P.stakeTop);
    }
    b.add(box(2.02, 0.12, 0.1), xf(0, 2.0, row ? 0.58 : -0.58), P.beam);
  }
  return b.build();
}
