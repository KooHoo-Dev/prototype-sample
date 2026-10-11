// OWNER: P7 — 계약 §9.4 「바닥」 (내부)
// 바닥 타일 → 병합 지오메트리 하나(타일셋 재질 · 꼭짓점 색). 타일마다 색 잡음 ±6%.
//   crypt: 다듬은 돌판(1 · 2m 판 · 줄눈 · 이끼 · 금) / cavern: 거친 바위(1m 격자 높낮이 · 재 얼룩 · 용암 균열 둘레의 붉은 기) / town: 자갈 광장(줄눈 · 흙 · 풀 · 모닥불 둘레 판석)
// 높이는 ±0.06m 안(바닥 y = 0 — §0.2). 맵을 지을 때만 돈다.

import { TILE, TILE_FLOOR } from '../../core/constants.js';
import { GeoBuilder, hash01, hashPos, mixRgb, rgb, valueNoise } from './build.js';
import { PAL } from './style.js';

const NOISE = 0.06;          // 타일마다 색 잡음 ±6%(§9.4)
const GROUT_Y = -0.03;
const SLAB_GAP = 0.035;      // 줄눈 반폭(m)

/** k 를 곱한 [r,g,b] */
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * @param {import('../../types.js').MapData} map
 * @param {number} seed
 * @returns {import('three').BufferGeometry}
 */
export function buildFloor(map, seed) {
  const b = new GeoBuilder();
  if (map.tileset === 'cavern') cavernFloor(b, map, seed);
  else if (map.tileset === 'town') townFloor(b, map, seed);
  else cryptFloor(b, map, seed);
  return b.build();
}

/** 바닥 타일 수(테스트 · 통계) @param {import('../../types.js').MapData} map */
export function floorTileCount(map) {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_FLOOR) n++;
  return n;
}

/** 줄눈(어두운 밑판) — 타일 하나 */
function grout(b, x0, z0, col) {
  b.quadUp(x0, GROUT_Y, z0, x0 + TILE, GROUT_Y, z0, x0 + TILE, GROUT_Y, z0 + TILE, x0, GROUT_Y, z0 + TILE, [col]);
}

/** 판 하나(사각 · 네 귀 높이/색이 조금 다르다) */
function slab(b, x0, z0, x1, z1, base, seed, hy = 0.012) {
  const g = SLAB_GAP;
  const ax = x0 + g, az = z0 + g, bx = x1 - g, bz = z1 - g;
  const s = hash01(Math.round(x0 * 10), Math.round(z0 * 10), seed, 11);
  const y = s * hy;
  const k = 1 + (s - 0.5) * 2 * NOISE;
  const c = (dx, dz) => mul(base, k * (1 + hashPos(dx, 0, dz, seed + 5) * 0.04));
  b.quadUp(
    ax, y + hashPos(ax, 1, az, seed) * 0.004, az,
    bx, y + hashPos(bx, 1, az, seed) * 0.004, az,
    bx, y + hashPos(bx, 1, bz, seed) * 0.004, bz,
    ax, y + hashPos(ax, 1, bz, seed) * 0.004, bz,
    [c(ax, az), c(bx, az), c(bx, bz), c(ax, bz)],
  );
  return y;
}

function cryptFloor(b, map, seed) {
  const P = PAL.crypt;
  const groutC = rgb(P.grout);
  const crackC = rgb(P.crack);
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    if (map.tiles[j * map.w + i] !== TILE_FLOOR) continue;
    const x0 = i * TILE, z0 = j * TILE;
    grout(b, x0, z0, groutC);
    const r = hash01(i, j, seed, 1);
    /** @type {Array<[number, number, number, number]>} */
    const cells = r < 0.45 ? [[0, 0, 1, 1], [1, 0, 2, 1], [0, 1, 1, 2], [1, 1, 2, 2]]
      : r < 0.65 ? [[0, 0, 2, 1], [0, 1, 2, 2]]
        : r < 0.85 ? [[0, 0, 1, 2], [1, 0, 2, 2]]
          : [[0, 0, 2, 2]];
    for (const [a0, c0, a1, c1] of cells) {
      const sx0 = x0 + a0, sz0 = z0 + c0, sx1 = x0 + a1, sz1 = z0 + c1;
      const cx = (sx0 + sx1) / 2, cz = (sz0 + sz1) / 2;
      const t = valueNoise(cx, cz, 7, seed + 2);
      const moss = Math.max(0, valueNoise(cx, cz, 5, seed + 3) - 0.62) * 2.2;
      let base = mixRgb(P.slab, P.slabAlt, t);
      if (moss > 0) { const m = rgb(P.moss); base = [base[0] + (m[0] - base[0]) * moss, base[1] + (m[1] - base[1]) * moss, base[2] + (m[2] - base[2]) * moss]; }
      const y = slab(b, sx0, sz0, sx1, sz1, base, seed);
      // 금 간 판(8%) — 대각으로 가는 어두운 줄
      if (hash01(Math.round(cx * 10), Math.round(cz * 10), seed, 21) < 0.05) {
        const w = 0.018;
        const ax = sx0 + 0.15, az = sz0 + 0.2 + hash01(i, j, seed, 22) * 0.4, bx = sx1 - 0.2, bz = sz1 - 0.15;
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * w, nz = (dx / l) * w;
        const yy = y + 0.006;
        b.tri(ax - nx, yy, az - nz, bx + nx, yy, bz + nz, bx - nx, yy, bz - nz, ...crackC);
        b.tri(ax - nx, yy, az - nz, ax + nx, yy, az + nz, bx + nx, yy, bz + nz, ...crackC);
      }
    }
  }
}

function cavernFloor(b, map, seed) {
  const P = PAL.cavern;
  const A = rgb(P.floorA), B = rgb(P.floorB), ash = rgb(P.ash), ember = rgb(P.ember);
  const lava = map.props.filter(p => p.kind === 'lavaCrack');
  const H = (x, z) => (valueNoise(x, z, 3.1, seed + 7) - 0.5) * 0.08 + hashPos(x, 0, z, seed + 8) * 0.018;
  const colAt = (x, z) => {
    const t = valueNoise(x, z, 4.3, seed + 9);
    let c = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    const a = Math.max(0, valueNoise(x, z, 6.7, seed + 10) - 0.6) * 2.4;
    if (a > 0) c = [c[0] + (ash[0] - c[0]) * a, c[1] + (ash[1] - c[1]) * a, c[2] + (ash[2] - c[2]) * a];
    let e = 0;
    for (const p of lava) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 1.6) e = Math.max(e, 1 - d / (p.r + 1.6));
    }
    if (e > 0) { e *= 0.85; c = [c[0] + (ember[0] - c[0]) * e, c[1] + (ember[1] - c[1]) * e, c[2] + (ember[2] - c[2]) * e]; }
    return c;
  };
  const step = 1;   // m
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    if (map.tiles[j * map.w + i] !== TILE_FLOOR) continue;
    const tk = 1 + (hash01(i, j, seed, 3) - 0.5) * 2 * NOISE;
    for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) {
      const gx0 = i * TILE + u * step, gz0 = j * TILE + v * step, gx1 = gx0 + step, gz1 = gz0 + step;
      const y00 = H(gx0, gz0), y10 = H(gx1, gz0), y11 = H(gx1, gz1), y01 = H(gx0, gz1);
      // 격자점을 옆으로도 흔든다(같은 점은 같은 값 — 이웃 칸과 이어진다) — 마름모 무늬가 보이지 않게
      const J = (x, z, s) => hashPos(x, 5, z, seed + s) * 0.24;
      const x0 = gx0 + J(gx0, gz0, 21), z0 = gz0 + J(gx0, gz0, 22);
      const x1 = gx1 + J(gx1, gz0, 21), z1 = gz1 + J(gx0, gz1, 22);
      const xA = gx1 + J(gx1, gz1, 21), zA = gz1 + J(gx1, gz1, 22);   // (1,1)
      const xB = gx0 + J(gx0, gz1, 21), zB = gz0 + J(gx1, gz0, 22);   // (0,1) x · (1,0) z
      const k1 = tk * (1 + hashPos(gx0, 2, gz0, seed) * 0.03), k2 = tk * (1 + hashPos(gx1, 3, gz1, seed) * 0.03);
      const c1 = mul(colAt(gx0 + 0.33, gz0 + 0.66), k1), c2 = mul(colAt(gx0 + 0.66, gz0 + 0.33), k2);
      // 네 귀: P00 (x0, z0) · P10 (x1, zB) · P11 (xA, zA) · P01 (xB, z1)
      if ((i + j + u + v) & 1) {
        b.tri(x0, y00, z0, xA, y11, zA, x1, y10, zB, ...c2);
        b.tri(x0, y00, z0, xB, y01, z1, xA, y11, zA, ...c1);
      } else {
        b.tri(x0, y00, z0, xB, y01, z1, x1, y10, zB, ...c1);
        b.tri(x1, y10, zB, xB, y01, z1, xA, y11, zA, ...c2);
      }
    }
  }
}

function townFloor(b, map, seed) {
  const P = PAL.town;
  const groutC = rgb(P.grout);
  const W = map.w * TILE, Hm = map.h * TILE;
  const hearth = map.objects.find(o => o.look === 'bonfire');
  const ROW = 0.8, gap = 0.03;   // 판석 줄 높이(m) · 줄눈 반폭 — 줄마다 어긋쌓기(돌 길이 0.7~1.5m)
  for (let j = 0; j < map.h; j++) for (let i = 0; i < map.w; i++) {
    if (map.tiles[j * map.w + i] !== TILE_FLOOR) continue;
    const x0 = i * TILE, z0 = j * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
    grout(b, x0, z0, groutC);
    // 이 타일을 지나는 줄들(전역 줄 번호 — 이웃 타일과 이어진다)
    for (let r = Math.floor(z0 / ROW); r * ROW < z1; r++) {
      const rz0 = Math.max(z0, r * ROW), rz1 = Math.min(z1, (r + 1) * ROW);
      if (rz1 - rz0 < 0.02) continue;
      // 그 줄의 자름 자리: 줄마다 다른 길이(해시) — x 를 따라 결정적으로 이어 간다
      let cx = -((hash01(r, 7, seed, 61) * 1.1) | 0) - hash01(r, 8, seed, 62);
      let k = 0;
      while (cx < x1) {
        const len = 0.7 + hash01(r, k, seed, 63) * 0.8;
        const sx0 = cx, sx1 = cx + len;
        cx = sx1; k++;
        if (sx1 <= x0) continue;
        const ax = Math.max(x0, sx0), bx = Math.min(x1, sx1);
        if (bx - ax < 0.02) continue;
        // 줄눈은 실제 돌 가장자리에서만(타일 경계에서는 돌이 이어진다)
        const gx0 = ax === sx0 ? gap : 0, gx1 = bx === sx1 ? gap : 0;
        const gz0 = rz0 === r * ROW ? gap : 0, gz1 = rz1 === (r + 1) * ROW ? gap : 0;
        const mx = (sx0 + sx1) / 2, mz = (r + 0.5) * ROW;
        const t = hash01(r, k, seed, 64);
        let base = mixRgb(P.cobble, P.cobbleAlt, t);
        const wear = valueNoise(mx, mz, 9, seed + 15);
        base = mul(base, 0.9 + wear * 0.2);
        const edge = Math.min(mx - TILE, mz - TILE, W - TILE - mx, Hm - TILE - mz);
        const dirt = Math.min(1, Math.max(0, valueNoise(mx, mz, 5, seed + 12) - 0.58) * 2.2 + Math.max(0, 3.0 - edge) * 0.25);
        if (dirt > 0) { const d = rgb(edge < 2.0 ? P.grass : P.dirt); base = [base[0] + (d[0] - base[0]) * dirt, base[1] + (d[1] - base[1]) * dirt, base[2] + (d[2] - base[2]) * dirt]; }
        if (hearth) {
          const d = Math.hypot(mx - hearth.x, mz - hearth.z);
          if (d < 3.6) base = mixRgb(P.ring, P.cobble, Math.max(0, (d - 1.9) / 1.7) * 0.6);
        }
        const kk = 1 + (t - 0.5) * 2 * NOISE;
        const y = 0.004 + t * 0.014;
        const c = mul(base, kk), c2 = mul(base, kk * 0.93);
        b.quadUp(ax + gx0, y, rz0 + gz0, bx - gx1, y, rz0 + gz0, bx - gx1, y, rz1 - gz1, ax + gx0, y, rz1 - gz1, [c2, c, c, c2]);
      }
    }
  }
}
