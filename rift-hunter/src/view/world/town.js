// OWNER: P7 — 계약 §9.4 「포털 · 균열석 · 보관함 · 마을 건물 · 모닥불」 · §7.12 마을 (내부)
// 마을 MapData 의 물체(look) → 코드로 지은 메시. NPC 몸은 P8(ActorLayer)이 그린다 — 여기서는 그 시설(모루 · 좌판 · 천막 · 탑)만.
// 카메라는 +X+Z 위에서 −X−Z 를 내려다본다(§0.2) — 건물의 보이는 면은 +X · +Z 면이라 문 · 창은 그쪽에 낸다.
// 건물 처마는 2.4m(앞의 NPC · 시설이 지붕 너머로 보이게) · 용마루 = 데이터 h.

import * as THREE from 'three';
import { GeoBuilder, makeRand, rgb, xf } from './build.js';
import { FLAME, OBJ, PAL } from './style.js';

const WIN = 0xffb060;          // 창(따뜻한 불빛)
const WIN_K = 1.7;
const EAVE = 2.4;

/**
 * @typedef {{x:number, y:number, z:number, s:number}} FlameSpot
 * @typedef {{x:number, y:number, z:number, size:number, color:number, k:number, ground?:boolean, tag?:string}} GlowSpot
 * @typedef {{id:string, x0:number, x1:number, z0:number, z1:number, h:number, matte:THREE.BufferGeometry, emit:THREE.BufferGeometry}} BuildingGeo
 */

/**
 * @param {import('../../types.js').MapData} map @param {number} seed
 * @returns {{matte:THREE.BufferGeometry, metal:THREE.BufferGeometry, emit:THREE.BufferGeometry, buildings:BuildingGeo[], flames:FlameSpot[], glows:GlowSpot[],
 *   portal:{x:number, z:number, facing:number}|null, riftStone:{x:number, z:number, facing:number}|null}}
 */
export function buildTown(map, seed) {
  const M = new GeoBuilder(), T = new GeoBuilder(), E = new GeoBuilder();
  /** @type {FlameSpot[]} */ const flames = [];
  /** @type {GlowSpot[]} */ const glows = [];
  /** @type {BuildingGeo[]} */ const buildings = [];
  let portal = null, riftStone = null;
  const ctx = { M, T, E, flames, glows };
  for (const o of map.objects) {
    switch (o.look) {
      case 'portal': portalArch(ctx, o); portal = { x: o.x, z: o.z, facing: o.facing }; break;
      case 'riftStone': riftStoneMesh(ctx, o); riftStone = { x: o.x, z: o.z, facing: o.facing }; break;
      case 'stash': stash(ctx, o); break;
      case 'bonfire': bonfire(ctx, o); break;
      case 'smithy': case 'grocery': case 'tent': case 'tower': buildings.push(building(ctx, o)); break;
      case 'npcSmith': anvilAndForge(ctx, o); break;
      case 'npcGrocer': stall(ctx, o); break;
      case 'npcGambler': gamblerTable(ctx, o); break;
      default:
        if (o.kind === 'deco' && o.w && o.d) buildings.push(building(ctx, o));
        break;
    }
  }
  outskirts(ctx, map, seed);
  return { matte: M.build(), metal: T.build(), emit: E.build(), buildings, flames, glows, portal, riftStone };
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

/** 다각형 면(부채꼴 삼각형) — 법선이 (hx, hy, hz) 쪽을 보게 감김을 맞춘다 */
function face(b, pts, col, hx, hy, hz) {
  const [a, c1, c2] = pts;
  const ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2];
  const vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const p = nx * hx + ny * hy + nz * hz < 0 ? [...pts].reverse() : pts;
  for (let k = 1; k < p.length - 1; k++) b.tri(...p[0], ...p[k], ...p[k + 1], ...col);
}

/** 박공지붕 집(용마루 X 축) — 아래 돌 띠 · 회벽 · 기둥 보 · +X/+Z 면에 창과 문 */
function house(B, E, { x0, x1, z0, z1, ridge, wall, low, beam, roof, door = 'x' }) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  B.add(box(w, EAVE, d), xf(cx, EAVE / 2, cz), wall, { shade: (x, y) => 0.8 + 0.25 * (y / EAVE + 0.5) });
  B.add(box(w + 0.08, 1.0, d + 0.08), xf(cx, 0.5, cz), low, { shade: (x, y) => 0.75 + 0.3 * (y + 0.5) });
  // 박공(양 끝 세모)
  const wc = rgb(wall, 0.92);
  face(B, [[x1, EAVE, z0], [x1, EAVE, z1], [x1, ridge, cz]], wc, 1, 0, 0);
  face(B, [[x0, EAVE, z0], [x0, EAVE, z1], [x0, ridge, cz]], wc, -1, 0, 0);
  // 지붕 두 면(처마 0.4 내밈)
  const o = 0.4, slope = (ridge - EAVE) / (d / 2);
  const ye = EAVE - o * slope;
  const rc = rgb(roof), rc2 = rgb(roof, 0.8);
  face(B, [[x0 - o, ye, z1 + o], [x1 + o, ye, z1 + o], [x1 + o, ridge + 0.02, cz], [x0 - o, ridge + 0.02, cz]], rc, 0, 1, 1);
  face(B, [[x0 - o, ye, z0 - o], [x1 + o, ye, z0 - o], [x1 + o, ridge + 0.02, cz], [x0 - o, ridge + 0.02, cz]], rc2, 0, 1, -1);
  // 지붕 끝 두께(박공 쪽 띠) · 용마루
  B.add(box(w + 2 * o + 0.1, 0.16, 0.22), xf(cx, ridge + 0.06, cz), rgb(roof, 0.65));
  for (let k = 0; k < 5; k++) {   // 기와 줄(+Z 면)
    const t = (k + 1) / 6;
    const y = ye + (ridge - ye) * t, z = z1 + o - (z1 + o - cz) * t;
    B.add(box(w + 2 * o, 0.05, 0.08), xf(cx, y + 0.03, z), rgb(roof, 0.72));
  }
  // 기둥 · 보(나무 틀)
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) B.add(box(0.22, EAVE, 0.22), xf(x, EAVE / 2, z), beam);
  B.add(box(w + 0.1, 0.16, 0.12), xf(cx, EAVE - 0.08, z1 + 0.03), beam);
  B.add(box(0.12, 0.16, d + 0.1), xf(x1 + 0.03, EAVE - 0.08, cz), beam);
  B.add(box(w + 0.1, 0.12, 0.1), xf(cx, 1.05, z1 + 0.05), beam);
  B.add(box(0.1, 0.12, d + 0.1), xf(x1 + 0.05, 1.05, cz), beam);
  // 창(+Z 면 2 · +X 면 1) — 발광 + 어두운 틀
  const win = (x, y, z, alongX) => {
    if (alongX) { B.add(box(0.9, 1.0, 0.08), xf(x, y, z + 0.02), beam); E.add(box(0.66, 0.76, 0.06), xf(x, y, z + 0.06), rgb(WIN, WIN_K)); }
    else { B.add(box(0.08, 1.0, 0.9), xf(x + 0.02, y, z), beam); E.add(box(0.06, 0.76, 0.66), xf(x + 0.06, y, z), rgb(WIN, WIN_K)); }
  };
  win(x0 + w * 0.28, 1.6, z1, true);
  win(x0 + w * 0.72, 1.6, z1, true);
  if (door === 'x') {
    // 문(+X 면 · 앞쪽 가까이) + 창 하나
    B.add(box(0.1, 1.9, 1.2), xf(x1 + 0.05, 0.95, z0 + d * 0.32), 0x2e1e14);
    B.add(box(0.14, 0.14, 1.4), xf(x1 + 0.06, 1.95, z0 + d * 0.32), beam);
    E.add(box(0.04, 0.3, 0.5), xf(x1 + 0.11, 1.55, z0 + d * 0.32), rgb(WIN, 0.9));
    win(x1, 1.6, z0 + d * 0.72, false);
  } else {
    win(x1, 1.6, z0 + d * 0.3, false);
    win(x1, 1.6, z0 + d * 0.7, false);
  }
}

/** 장식 건물(look) */
function building({ glows }, o) {
  const B = new GeoBuilder(), E = new GeoBuilder();
  const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2, h = o.h ?? 5;
  if (o.look === 'tent') tent(B, E, glows, { x0, x1, z0, z1, h });
  else if (o.look === 'tower') tower(B, E, glows, { x0, x1, z0, z1, h });
  else if (o.look === 'grocery') {
    house(B, E, { x0, x1, z0, z1, ridge: h, wall: 0x9a8662, low: 0x6a5e50, beam: 0x3a281a, roof: 0x7a3a26, door: 'x' });
    // 굴뚝 없음 · 지붕 위 간판 깃대
    B.add(cyl(0.05, 0.05, 1.4, 5), xf(x1 - 0.6, h + 0.3, o.z), 0x3a281a);
    B.add(box(0.05, 0.5, 0.9), xf(x1 - 0.6, h + 0.75, o.z + 0.5), 0x8a2a20);
  } else {
    // smithy(기본) — 돌 아래층 · 슬레이트 지붕 · 굴뚝(불씨)
    house(B, E, { x0, x1, z0, z1, ridge: h, wall: 0x857762, low: 0x55504a, beam: 0x33251a, roof: 0x3a3a46, door: 'x' });
    const chx = x0 + 1.3, chz = z1 - 1.2;
    B.add(box(0.9, h + 1.4, 0.9), xf(chx, (h + 1.4) / 2, chz), 0x4c4741, { shade: (x, y) => 0.8 + 0.2 * (y / (h + 1.4) + 0.5) });
    E.add(box(0.6, 0.06, 0.6), xf(chx, h + 1.43, chz), rgb(FLAME.edge, 2.0));
    glows.push({ x: chx, y: h + 1.7, z: chz, size: 1.4, color: FLAME.edge, k: 0.6 });
  }
  return { id: o.id, x0, x1, z0, z1, h, matte: B.build(), emit: E.build() };
}

/** 도박꾼 천막 — 줄무늬 원뿔 + 치마 + 입구(따뜻한 안쪽 빛) + 꼭대기 깃발 */
function tent(B, E, glows, { x0, x1, z0, z1, h }) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = (x1 - x0) / 2, rz = (z1 - z0) / 2;
  const n = 12, skirt = 0.9;
  const A = rgb(0x4a2a5e), Bc = rgb(0x9a7a3a);
  const pt = (k, y, s = 1) => [cx + Math.cos((k / n) * Math.PI * 2) * rx * s, y, cz + Math.sin((k / n) * Math.PI * 2) * rz * s];
  for (let k = 0; k < n; k++) {
    const col = k % 2 ? A : Bc;
    const a = pt(k, skirt), b = pt(k + 1, skirt);
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[2] + b[2]) / 2 - cz;
    face(B, [[cx, h, cz], a, b], col, mx, 0.5, mz);
    const a0 = pt(k, 0, 1.02), b0 = pt(k + 1, 0, 1.02);
    face(B, [a0, b0, b, a], col.map(c => c * 0.8), mx, 0, mz);
  }
  // 입구(+X+Z 쪽) — 어두운 틈 + 안쪽 불빛
  const ea = Math.PI / 4;
  const ex = cx + Math.cos(ea) * rx * 1.01, ez = cz + Math.sin(ea) * rz * 1.01;
  E.add(box(0.9, 1.6, 0.06), xf(ex, 0.8, ez, ea + Math.PI / 2), rgb(0xff9a40, 1.3));
  glows.push({ x: ex + 0.4, y: 1.0, z: ez + 0.4, size: 2.2, color: 0xff9a40, k: 0.55 });
  B.add(cyl(0.07, 0.07, 1.2, 5), xf(cx, h + 0.5, cz), 0x3a281a);
  B.add(box(0.04, 0.35, 0.6), xf(cx, h + 0.9, cz + 0.3), 0x9a2a2a);
}

/** 신비술사 탑 — 둥근 돌탑 · 원뿔 지붕 · 보랏빛 창 · 꼭대기 구슬 */
function tower(B, E, glows, { x0, x1, z0, z1, h }) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(x1 - x0, z1 - z0) / 2 - 0.1;
  const bodyH = h - 2.6;
  B.add(cyl(r * 0.92, r, bodyH, 12), xf(cx, bodyH / 2, cz), 0x5c5c6c, { shade: (x, y) => 0.72 + 0.3 * (y / bodyH + 0.5) });
  for (const y of [1.0, bodyH * 0.55, bodyH - 0.2]) B.add(cyl(r * 0.97, r * 0.99, 0.22, 12), xf(cx, y, cz), 0x45454f);
  B.add(new THREE.ConeGeometry(r * 1.22, 2.9, 12), xf(cx, bodyH + 1.45, cz), 0x3a2e52);
  // 창 — 보이는 쪽(+X · +Z 반원)
  const violet = rgb(0x9a7aff, 1.8);
  for (const [a, y] of [[0.3, 2.2], [1.1, 2.2], [0.7, 4.3], [1.4, 4.3], [0.0, 4.3], [0.75, 6.0]]) {
    if (y > bodyH - 0.4) continue;
    const ang = a;   // yaw 기준 각(0 = +Z 쪽)
    const wx = cx + Math.sin(ang) * (r * 0.95), wz = cz + Math.cos(ang) * (r * 0.95);
    B.add(box(0.62, 0.95, 0.12), xf(wx, y, wz, ang), 0x2a2a34);
    E.add(box(0.42, 0.72, 0.1), xf(wx + Math.sin(ang) * 0.04, y, wz + Math.cos(ang) * 0.04, ang), violet);
  }
  // 문(+Z+X 쪽)
  const da = Math.PI / 4 - 0.25;
  B.add(box(1.1, 2.0, 0.14), xf(cx + Math.sin(da) * r, 1.0, cz + Math.cos(da) * r, da), 0x2a1e18);
  // 꼭대기 구슬
  E.add(new THREE.IcosahedronGeometry(0.28, 1), xf(cx, h + 0.55, cz), rgb(0xc8a8ff, 2.2));
  glows.push({ x: cx, y: h + 0.55, z: cz, size: 2.6, color: 0xa080ff, k: 0.8 });
}

/** 마을 포털 — 돌 아치 · 계단 · 룬(안쪽 발광은 WorldLayer 가 포털 상태로) */
function portalArch({ M, E }, o) {
  const B = M;
  const f = o.facing;
  const at = (lx, ly, lz, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const c = Math.cos(f), s = Math.sin(f);
    return xf(o.x + lx * c + lz * s, ly, o.z - lx * s + lz * c, f + ry, sx, sy, sz, rx, rz);
  };
  B.add(box(3.8, 0.18, 1.8), at(0, 0.09, 0), OBJ.portalStoneDark);
  B.add(box(3.2, 0.14, 1.3), at(0, 0.25, 0), OBJ.portalStone);
  for (const sx of [-1, 1]) {
    B.add(box(0.62, 0.4, 0.72), at(sx * 1.45, 0.52, 0), OBJ.portalStoneDark);
    B.add(box(0.5, 2.3, 0.6), at(sx * 1.45, 1.87, 0), OBJ.portalStone, { shade: (x, y) => 0.8 + 0.2 * (y / 2.3 + 0.5) });
    B.add(box(0.6, 0.2, 0.7), at(sx * 1.45, 3.1, 0), OBJ.portalStoneDark);
    E.add(box(0.08, 1.4, 0.04), at(sx * 1.45, 1.9, 0.31), rgb(OBJ.portalRune, 1.2));
  }
  // 반원 아치(돌 7개)
  const R = 1.45, n = 7;
  for (let k = 0; k < n; k++) {
    const a = Math.PI * (k + 0.5) / n;
    const x = Math.cos(a) * R, y = 3.2 + Math.sin(a) * R * 0.75;
    B.add(box(0.62, 0.5, 0.62), at(x, y, 0, 0, 1, 1, 1, 0, a - Math.PI / 2), k === 3 ? OBJ.portalStoneDark : OBJ.portalStone);
  }
  E.add(new THREE.OctahedronGeometry(0.16, 0), at(0, 4.6, 0.3), rgb(OBJ.portalRune, 1.6));
}

/** 균열석 — 계단 받침 · 검은 오벨리스크 · 보랏빛 금(발광) · 떠 있는 조각 */
function riftStoneMesh({ M, E, glows }, o) {
  M.add(box(2.1, 0.22, 2.1), xf(o.x, 0.11, o.z, o.facing), OBJ.riftStoneBase);
  M.add(box(1.5, 0.22, 1.5), xf(o.x, 0.33, o.z, o.facing), 0x2e2b34);
  const H = 3.2;
  M.add(cyl(0.34, 0.62, H, 4), xf(o.x, 0.44 + H / 2, o.z, o.facing + Math.PI / 4), OBJ.riftStone, { shade: (x, y) => 0.75 + 0.35 * (y / H + 0.5) });
  M.add(new THREE.ConeGeometry(0.34, 0.5, 4), xf(o.x, 0.44 + H + 0.25, o.z, o.facing + Math.PI / 4), 0x2c2834);
  // 금 — 보이는 두 면(+X · +Z)에 지그재그
  const crack = rgb(OBJ.riftCrack, 2.2), hot = rgb(OBJ.riftCrackHot, 2.6);
  const segs = [[0.0, 0.7], [0.12, 1.2], [-0.06, 1.7], [0.1, 2.3], [-0.04, 2.9]];
  for (const [nx, nz] of [[1, 0], [0, 1]]) {
    for (let k = 0; k < segs.length - 1; k++) {
      const [ua, ya] = segs[k], [ub, yb] = segs[k + 1];
      const ym = (ya + yb) / 2 + 0.44, len = Math.hypot(ub - ua, yb - ya);
      const t = (ym - 0.44) / H;
      const halfW = 0.6 + (0.34 - 0.6) * t;   // 그 높이의 면 반폭(꼭짓점 기준 아님 — 45° 돌린 사각 기둥의 면까지 거리 ≈ halfW × 0.707)
      const off = halfW * Math.SQRT1_2 + 0.012;
      const u = (ua + ub) / 2;
      const x = o.x + nx * off + nz * u, z = o.z + nz * off + nx * u;
      const roll = Math.atan2(ub - ua, yb - ya);
      E.add(box(nx ? 0.03 : 0.06, len, nz ? 0.03 : 0.06), xf(x, ym, z, 0, 1, 1, 1, nz ? -roll : 0, nx ? roll : 0), k === 2 ? hot : crack);
    }
  }
  E.add(new THREE.OctahedronGeometry(0.22, 0), xf(o.x, 0.44 + H + 0.95, o.z, 0.3, 1, 1.6, 1), rgb(OBJ.riftCrack, 1.5));
  glows.push({ x: o.x, y: 2.2, z: o.z, size: 3.6, color: OBJ.riftCrack, k: 0.5, tag: 'riftStone' });
  glows.push({ x: o.x, y: 0.44 + H + 0.95, z: o.z, size: 1.8, color: OBJ.riftCrack, k: 0.8 });
}

/** 보관함 — 쇠 띠 두른 나무 궤짝 · 금빛 자물쇠 */
function stash({ M, T }, o) {
  const f = o.facing;
  const at = (lx, ly, lz, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const c = Math.cos(f), s = Math.sin(f);
    return xf(o.x + lx * c + lz * s, ly, o.z - lx * s + lz * c, f + ry, sx, sy, sz, rx, rz);
  };
  M.add(box(1.3, 0.62, 0.78), at(0, 0.31, 0), OBJ.stashWood, { shade: (x, y) => 0.8 + 0.35 * (y + 0.31) });
  M.add(cyl(0.39, 0.39, 1.3, 8), at(0, 0.62, 0, 0, 1, 0.55, 1, 0, Math.PI / 2), 0x6a4428);
  for (const x of [-0.5, 0, 0.5]) T.add(box(0.08, 0.66, 0.82), at(x, 0.33, 0), OBJ.stashIron);
  for (const x of [-0.5, 0.5]) T.add(new THREE.TorusGeometry(0.4, 0.04, 4, 10, Math.PI), at(x, 0.62, 0, Math.PI / 2, 1, 0.55, 1), OBJ.stashIron);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add(box(0.12, 0.12, 0.12), at(sx * 0.63, 0.06, sz * 0.37), OBJ.stashIron);
  T.add(box(0.18, 0.22, 0.06), at(0, 0.6, 0.42), OBJ.stashGold);
}

/** 모닥불 — 돌 고리 · 엇갈린 장작 · 불씨 바닥(발광) · 불꽃 자리 */
function bonfire({ M, E, flames }, o) {
  const n = 11, R = 0.92;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    M.add(new THREE.IcosahedronGeometry(0.22, 0), xf(o.x + Math.cos(a) * R, 0.1, o.z + Math.sin(a) * R, a * 2.1, 1.1, 0.75, 0.95), OBJ.bonfireStone, { jitter: 0.04, jitterSeed: k });
  }
  E.add(cyl(0.62, 0.7, 0.06, 9), xf(o.x, 0.04, o.z), rgb(FLAME.edge, 1.4));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    M.add(cyl(0.09, 0.11, 1.25, 6), xf(o.x + Math.cos(a) * 0.28, 0.42, o.z + Math.sin(a) * 0.28, -a + Math.PI / 2, 1, 1, 1, 0.62), OBJ.bonfireLog);
  }
  flames.push({ x: o.x, y: 0.15, z: o.z, s: 2.4 });
  flames.push({ x: o.x + 0.22, y: 0.12, z: o.z - 0.1, s: 1.6 });
  flames.push({ x: o.x - 0.2, y: 0.12, z: o.z + 0.15, s: 1.7 });
  flames.push({ x: o.x + 0.05, y: 0.1, z: o.z + 0.25, s: 1.3 });
}

/** 대장장이 — 모루 + 화덕(숯 발광 · 작은 불) · NPC 옆, 건물 앞 */
function anvilAndForge({ M, T, E, flames, glows }, o) {
  const ax = o.x - 1.5, az = o.z + 0.55;
  M.add(box(0.5, 0.45, 0.5), xf(ax, 0.225, az, 0.3), 0x4a3424);
  T.add(box(0.36, 0.22, 0.26), xf(ax, 0.56, az, 0.3), 0x4a4a52);
  T.add(box(0.72, 0.16, 0.32), xf(ax, 0.75, az, 0.3), 0x5a5a64);
  T.add(new THREE.ConeGeometry(0.12, 0.42, 6), xf(ax + Math.sin(0.3) * 0.5, 0.76, az + Math.cos(0.3) * 0.5, 0.3, 1, 1, 1, Math.PI / 2), 0x5a5a64);
  const fx = o.x - 3.4, fz = o.z + 0.75;
  M.add(box(1.3, 0.8, 0.9), xf(fx, 0.4, fz), 0x4a4540, { shade: (x, y) => 0.7 + 0.4 * (y + 0.4) });
  E.add(box(1.0, 0.06, 0.6), xf(fx, 0.82, fz), rgb(FLAME.edge, 2.4));
  flames.push({ x: fx, y: 0.84, z: fz, s: 0.9 });
  glows.push({ x: fx, y: 1.0, z: fz, size: 2.0, color: FLAME.mid, k: 0.7 });
  // 연장 거치대(망치 · 집게)
  M.add(box(0.08, 1.1, 0.08), xf(o.x + 1.1, 0.55, o.z + 1.0), 0x3a281a);
  T.add(box(0.3, 0.12, 0.12), xf(o.x + 1.1, 1.12, o.z + 1.0), 0x5a5a64);
}

/** 잡화상 좌판 — 나무 판대 · 붉은 물약 병 · 상자 · 자루 */
function stall({ M, E }, o) {
  const x0 = o.x - 0.6, z = o.z + 0.9;
  M.add(box(3.4, 0.08, 0.7), xf(x0 + 1.7, 0.9, z), 0x6a4a2e);
  M.add(box(3.3, 0.86, 0.62), xf(x0 + 1.7, 0.43, z), 0x4e3622, { shade: (x, y) => 0.7 + 0.35 * (y + 0.43) });
  const red = rgb(0xd02a2a, 1.0), blue = rgb(0x3a6ad0, 1.0);
  for (let k = 0; k < 7; k++) {
    const x = x0 + 0.35 + k * 0.38;
    M.add(cyl(0.07, 0.08, 0.2, 6), xf(x, 1.04, z - 0.12), k % 3 === 2 ? blue : red);
    M.add(cyl(0.025, 0.025, 0.07, 5), xf(x, 1.17, z - 0.12), 0xc8b89a);
  }
  E.add(box(0.5, 0.02, 0.2), xf(x0 + 2.8, 0.95, z + 0.1), rgb(0xffc060, 0.6));
  M.add(box(0.6, 0.5, 0.6), xf(x0 + 3.9, 0.25, z + 0.2, 0.2), 0x7a5a36);
  M.add(box(0.5, 0.4, 0.5), xf(x0 + 3.9, 0.7, z + 0.2, 0.5), 0x8a6a40);
  M.add(new THREE.SphereGeometry(0.3, 6, 4), xf(x0 - 0.45, 0.25, z + 0.1, 0, 1, 0.85, 1), 0xa8946a);
}

/** 도박꾼 — 작은 탁자 · 카드 · 동전 · 촛불 */
function gamblerTable({ M, T, E, glows }, o) {
  const x = o.x - 1.4, z = o.z + 1.0;
  M.add(cyl(0.5, 0.5, 0.06, 10), xf(x, 0.78, z), 0x5a3a24);
  M.add(cyl(0.06, 0.1, 0.75, 6), xf(x, 0.38, z), 0x3a281a);
  for (const [dx, dz, a] of [[-0.15, 0.05, 0.3], [0.05, -0.12, -0.4], [0.18, 0.12, 1.1]]) M.add(box(0.14, 0.01, 0.2), xf(x + dx, 0.815, z + dz, a), 0xe8e0d0);
  T.add(cyl(0.05, 0.05, 0.05, 8), xf(x - 0.2, 0.84, z - 0.2), 0xd0a040);
  T.add(cyl(0.05, 0.05, 0.08, 8), xf(x - 0.08, 0.85, z - 0.28), 0xd0a040);
  M.add(cyl(0.04, 0.045, 0.16, 6), xf(x + 0.25, 0.89, z - 0.2), 0xe6dcc0);
  E.add(new THREE.ConeGeometry(0.03, 0.09, 5), xf(x + 0.25, 1.02, z - 0.2), rgb(FLAME.mid, 2.2));
  glows.push({ x: x + 0.25, y: 1.02, z: z - 0.2, size: 0.9, color: FLAME.mid, k: 0.8 });
}

/** 담 밖: 넓은 어두운 땅 · 침엽수 실루엣 · 담 안 장식(통 · 상자 · 장작더미) */
function outskirts({ M }, map, seed) {
  const W = map.w * 2, H = map.h * 2, cx = W / 2, cz = H / 2;
  M.add(new THREE.PlaneGeometry(W + 140, H + 140), xf(cx, -0.06, cz, 0, 1, 1, 1, -Math.PI / 2), PAL.town.outside);
  const rnd = makeRand(seed ^ 0x5eed);
  const trunk = 0x2a1e16, needles = [0x1c2a22, 0x22302a, 0x18241c];
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 70; tries++) {
    const x = rnd.range(-30, W + 30), z = rnd.range(-30, H + 30);
    if (x > -2.5 && x < W + 2.5 && z > -2.5 && z < H + 2.5) continue;
    const s = rnd.range(0.8, 1.5);
    const col = needles[placed % 3];
    M.add(cyl(0.18 * s, 0.24 * s, 1.4 * s, 5), xf(x, 0.7 * s, z), trunk);
    M.add(new THREE.ConeGeometry(1.5 * s, 2.6 * s, 7), xf(x, 2.1 * s, z, rnd.next() * 3), col, { jitter: 0.12 * s, jitterSeed: placed });
    M.add(new THREE.ConeGeometry(1.1 * s, 2.2 * s, 7), xf(x, 3.4 * s, z, rnd.next() * 3), col, { jitter: 0.1 * s, jitterSeed: placed + 99 });
    M.add(new THREE.ConeGeometry(0.7 * s, 1.8 * s, 6), xf(x, 4.6 * s, z, rnd.next() * 3), col, { jitter: 0.08 * s, jitterSeed: placed + 199 });
    placed++;
  }
  // 담 안 — 건물 곁 통 · 상자 · 장작(걷는 길을 막지 않는 가장자리)
  const barrel = (x, z) => {
    M.add(cyl(0.34, 0.3, 0.85, 9), xf(x, 0.43, z), 0x6a4a2e, { shade: (lx, ly) => 0.8 + 0.3 * (ly + 0.43) });
    M.add(new THREE.TorusGeometry(0.335, 0.025, 3, 9), xf(x, 0.2, z, 0, 1, 1, 1, Math.PI / 2), 0x3a3a40);
    M.add(new THREE.TorusGeometry(0.335, 0.025, 3, 9), xf(x, 0.66, z, 0, 1, 1, 1, Math.PI / 2), 0x3a3a40);
  };
  const crate = (x, z, s, a) => {
    M.add(box(s, s, s), xf(x, s / 2, z, a), 0x7a5a36, { shade: (lx, ly) => 0.8 + 0.3 * (ly / s + 0.5) });
    M.add(box(s * 1.02, s * 0.12, s * 1.02), xf(x, s * 0.5, z, a), 0x5a4026);
  };
  for (const b of map.objects) {
    if (b.look === 'smithy') { barrel(b.x + b.w / 2 + 0.6, b.z + b.d / 2 - 1.0); barrel(b.x + b.w / 2 + 0.55, b.z + b.d / 2 - 1.8); logPile(M, b.x + b.w / 2 + 0.7, b.z + b.d / 2 - 3.2); }
    if (b.look === 'grocery') { crate(b.x - b.w / 2 - 0.7, b.z - b.d / 2 + 1.0, 0.7, 0.3); crate(b.x - b.w / 2 - 0.6, b.z - b.d / 2 + 2.0, 0.5, 0.9); crate(b.x + b.w / 2 + 0.6, b.z + 0.5, 0.75, 0.1); barrel(b.x + b.w / 2 + 0.6, b.z + 1.6); }
    if (b.look === 'tower') { crate(b.x - b.w / 2 - 0.6, b.z - b.d / 2 + 0.7, 0.55, 0.6); }
  }
}

function logPile(M, x, z) {
  for (let k = 0; k < 5; k++) {
    const row = k < 3 ? 0 : 1, i = k < 3 ? k : k - 3;
    M.add(cyl(0.14, 0.14, 1.3, 6), xf(x, 0.14 + row * 0.25, z + (i - (row ? 0.5 : 1)) * 0.29, 0, 1, 1, 1, Math.PI / 2), 0x5a3e26);
  }
}
