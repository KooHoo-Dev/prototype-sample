// OWNER: P6 — 계약 §9.3 · §7.8 (패키지 내부 파일 — WorldLayer만 import 한다)
// 마을: 폐허가 된 성소. 중앙 화톳불 · 대장간 · 상인 천막/수레 · 북쪽 안개문 · 둘레의 무너진 회랑 · 먼 산과 성.
// 배치는 data/world.js의 town(시설 · 콜라이더 · NPC)에서 읽는다. 허수아비 받침대는 그리지 않는다(허수아비는 P5).
// 걸어 다닐 수 있는 곳(경계 안 · 콜라이더 밖)에는 높이가 있는 것을 두지 않는다 — 바닥 장식은 y ≤ 0.02.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../data/palette.js';
import {
  Batch, addArch, addBox, addCyl, addRock, buildSilhouette, disposeTree,
  makeGroundGeometry, makeRand, makeRidgeGeometry, silhouettePart,
} from './geoKit.js';
import { createDriftPoints, createFlameMaterial, createFogGateMaterial, makeFlameGeometry } from './proceduralTextures.js';

/** @typedef {import('../../types.js').WorldDef} WorldDef */

// ── 연출 상수 ──
const STONE = 0xe2dbd0;          // 정점색은 텍스처에 곱해진다 — 밝게 두고 map이 명도를 정한다
const STONE_DARK = 0xb4ada3;
const STONE_WARM = 0xeadbc2;
const WOOD = 0xd8c8b4;
const WOOD_DARK = 0x9a8a7a;
const CLOTH_RED = 0x6a2f2a;
const CLOTH_TAN = 0x7d6a4c;
const IRON = 0x5a5d66;
const FLAME_TOP = 1.5;               // 화톳불 불꽃 높이(m). §9.3: 1.6 이하
const CLOISTER_OUT = 1.6;            // 회랑 기둥이 경계에서 물러난 거리(m) — 벽에 붙은 카메라가 파고들지 않게 0.9 이상
const WALL_OUT = 4.4;
const COLUMN_COUNT = 26;
const WALL_SEGS = 40;
const GATE_HALF_SECTOR = 0.3;        // 안개문 뒤로 회랑을 비우는 각(rad)
const PIER_H = 5.0;

export const TOWN_ENV = {
  fog: PALETTE.fog.town, fogGain: 1.7, fogDensity: 0.027,
  hemiSky: 0x7d8ba6, hemiGround: 0x2a211a, hemiIntensity: 0.62,   // 차가운 환경광
  sunColor: 0xa9bcdc, sunIntensity: 1.25, sunDir: [-0.5, 0.74, -0.45],
  fillColor: 0xd6cfc4, fillIntensity: 0.5,                        // 카메라 채움광 — 광장 남쪽(허수아비)이 검게 죽지 않게
  shadowExtent: 15,
  sky: {
    top: 0x060912, horizon: 0x3a4252, glow: 0x4a3428, glowDir: [0.1, 0.1, 1], glowPow: 7,
    orbDir: [0, 1, 0], orbColor: 0x000000, orbSize: 0, orbRing: 0, stars: 0.35, cloud: 0.85,
  },
  /** @type {{x:number, y:number, z:number, color:number, intensity:number, distance:number, flicker:number}[]} */
  lights: [],
  phase2: null,
};

/**
 * @param {WorldDef} world
 * @param {ReturnType<typeof import('./proceduralTextures.js').createTextureLibrary>} lib
 */
export function buildTown(world, lib) {
  const rand = makeRand(1207);
  const R = world.radius;
  const group = new THREE.Group();
  group.name = `stage:${world.id}`;

  // ── 배치 데이터 ──
  const fac = (id) => world.facilities.find((f) => f.id === id);
  const bonfire = fac('bonfire') ?? { x: 0, z: 0, r: 2.6 };
  const gate = fac('gate') ?? { x: 0, z: R - 4, r: 3.2 };
  // 안개문 벽(gate 시설 원 안에 중심이 있는 상자)은 건물이 아니다 — 문 옆 담으로 따로 그린다.
  const isGateWall = (c) => c.type === 'box' && Math.hypot(c.x - gate.x, c.z - gate.z) < gate.r;
  const gateWall = world.colliders.find(isGateWall) ?? null;
  const boxes = world.colliders.filter((c) => c.type === 'box' && !isGateWall(c));
  const nearestBox = (f) => (f ? boxes.slice().sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0] : null);
  const forgeBox = nearestBox(fac('blacksmith'));
  const stallBox = nearestBox(fac('merchant'));
  const piers = world.colliders
    .filter((c) => c.type === 'circle' && Math.hypot(c.x - gate.x, c.z - gate.z) < gate.r + 1.5 && c.r > 0.6)
    .sort((a, b) => a.x - b.x);
  const gateAngle = Math.atan2(gate.x, gate.z);

  // ── 재질 ──
  const stoneMat = new THREE.MeshStandardMaterial({ map: lib.masonry.map, normalMap: lib.masonry.normalMap, vertexColors: true, roughness: 0.95 });
  const rockMat = new THREE.MeshStandardMaterial({ map: lib.rock.map, normalMap: lib.rock.normalMap, vertexColors: true, roughness: 1 });
  const woodMat = new THREE.MeshStandardMaterial({ map: lib.wood.map, normalMap: lib.wood.normalMap, vertexColors: true, roughness: 0.9 });
  const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const ironMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.85 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  const groundMat = new THREE.MeshStandardMaterial({ map: lib.flagstone.map, normalMap: lib.flagstone.normalMap, vertexColors: true, roughness: 0.93 });
  const flameMat = createFlameMaterial(PALETTE.style.fire.core, PALETTE.style.fire.glow, 1.9);
  const gateMat = createFogGateMaterial();
  const silMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });

  const stone = new Batch(2.6);
  const rock = new Batch(1.8);
  const wood = new Batch(1.4);
  const cloth = new Batch(1);
  const iron = new Batch(1);
  const glow = new Batch(1);
  /** @type {THREE.BufferGeometry[]} */
  const flames = [];
  const lights = [];

  // ── 바닥 ──
  const ground = new THREE.Mesh(
    makeGroundGeometry([0, 1.2, 2.4, 5, 9, 13, R - 1, R, R + 1.5, R + 5, R + 12, 80], 72, 5, (r, a, out) => {
      // 화톳불 둘레는 그을리고, 경계 밖은 흙빛으로 어두워진다
      let k = 1;
      if (r < 2.4) k = 0.45 + 0.55 * (r / 2.4);
      if (r > R) k = Math.max(0.3, 1 - (r - R) * 0.12);
      const wob = 0.94 + 0.06 * Math.sin(a * 5 + r);
      out.setRGB(k * wob, k * wob * 0.98, k * wob * 0.95);
    }, R),
    groundMat,
  );
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.name = 'ground';
  group.add(ground);

  // ── 중앙 화톳불 ──
  {
    const bx = bonfire.x;
    const bz = bonfire.z;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand() * 0.2;
      addRock(rock, 0.15 + rand() * 0.07, bx + Math.sin(a) * 0.64, 0.06, bz + Math.cos(a) * 0.64, rand, { color: 0xb0a8a0, squash: 0.75 });
    }
    addRock(rock, 0.5, bx, 0.02, bz, rand, { color: 0x403a36, squash: 0.3, jitter: 0.15 });      // 재 더미
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      wood.add(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), bx + Math.sin(a) * 0.2, 0.22, bz + Math.cos(a) * 0.2,
        { ry: a + Math.PI / 2, rz: 1.05, color: 0x2e241e, ao: false });
    }
    // 꽂힌 검
    addBox(iron, 0.05, 1.0, 0.014, bx + 0.03, 0.18, bz, { rz: 0.07, color: 0x7a7c82, ao: false });
    addBox(iron, 0.3, 0.035, 0.045, bx - 0.04, 1.17, bz, { rz: 0.07, color: 0x4a4640, ao: false });
    addCyl(iron, 0.02, 0.02, 0.2, 6, bx - 0.045, 1.2, bz, { rz: 0.07, color: 0x3a3028, ao: false });
    flames.push(
      makeFlameGeometry(bx, 0.12, bz, 0.34, FLAME_TOP - 0.2, 0.11),
      makeFlameGeometry(bx + 0.14, 0.12, bz - 0.08, 0.22, 0.95, 0.47),
      makeFlameGeometry(bx - 0.12, 0.12, bz + 0.1, 0.2, 0.8, 0.83),
    );
    lights.push({ x: bx, y: 1.15, z: bz, color: 0xff8a3a, intensity: 28, distance: 30, flicker: 1 });
  }

  // ── 대장간 / 상인 좌판: 상자 콜라이더 안에만 짓는다. lx 양수 = 광장 쪽 ──
  const place = (box) => {
    const sx = box.x <= 0 ? 1 : -1;
    return (lx, lz) => [box.x + lx * sx, box.z + lz];
  };
  if (forgeBox) {
    const P = place(forgeBox);
    const hw = forgeBox.hw;
    const hd = forgeBox.hd;
    let [x, z] = P(0, hd - 0.22);
    addBox(stone, hw * 2, 2.7, 0.42, x, 0, z, { color: STONE_DARK });                       // 뒷벽
    [x, z] = P(-hw * 0.5, hd - 0.22);
    addBox(stone, hw * 0.7, 0.6, 0.42, x, 2.7, z, { color: STONE_DARK, ao: false });         // 무너진 윗단
    [x, z] = P(-hw + 0.22, 0);
    addBox(stone, 0.42, 2.3, hd * 2 - 0.5, x, 0, z, { color: STONE_DARK });                  // 바깥 옆벽
    // 화로 + 굴뚝
    const [fx, fz] = P(-hw + 1.05, hd - 1.0);
    addBox(stone, 1.3, 1.15, 1.3, fx, 0, fz, { color: 0xa09890 });
    addBox(stone, 0.72, 2.7, 0.72, fx, 1.15, fz + 0.1, { color: 0x8c857e, ao: false });
    const [mx, mz] = P(-hw + 1.73, hd - 1.0);
    addBox(glow, 0.06, 0.42, 0.62, mx, 0.36, mz, { color: 0xff6a22, bright: 3.2, ao: false });   // 화구
    for (let i = 0; i < 6; i++) {
      const [cx, cz] = P(-hw + 1.9 + rand() * 0.25, hd - 1.3 + rand() * 0.6);
      addRock(glow, 0.05 + rand() * 0.04, cx, 0.03, cz, rand, { color: 0xff5a1e, bright: 2.2, ao: false });   // 흩어진 숯불
    }
    const [lx, lz] = P(-hw + 2.1, hd - 1.05);
    lights.push({ x: lx, y: 0.85, z: lz, color: 0xff6a28, intensity: 6, distance: 11, flicker: 0.7 });
    // 지붕(널빤지) — 뒷벽에서 앞으로 기운다
    for (const px of [-hw + 0.3, 0.2]) {
      const [qx, qz] = P(px, -hd + 0.18);
      addBox(wood, 0.16, 2.3, 0.16, qx, 0, qz, { color: WOOD_DARK });
    }
    [x, z] = P(-hw * 0.45, -hd + 0.18);
    addBox(wood, hw * 1.25, 0.14, 0.16, x, 2.3, z, { color: WOOD_DARK, ao: false });
    [x, z] = P(-hw * 0.42, -0.05);
    wood.add(new THREE.BoxGeometry(hw * 1.45, 0.08, hd * 2 + 0.2), x, 2.68, z, { rx: -0.215, color: 0xb09c88, ao: false });
    // 모루(그루터기 위) — 대장장이 옆
    const [ax, az] = P(hw - 1.0, -hd + 1.1);
    addCyl(wood, 0.25, 0.28, 0.44, 9, ax, 0, az, { color: 0xb8a48c });
    addBox(iron, 0.3, 0.1, 0.2, ax, 0.44, az, { color: IRON, ao: false });
    addBox(iron, 0.15, 0.12, 0.12, ax, 0.54, az, { color: IRON, ao: false });
    addBox(iron, 0.5, 0.13, 0.2, ax, 0.66, az, { color: 0x6a6e78, ao: false });
    iron.add(new THREE.ConeGeometry(0.07, 0.24, 8), ax + 0.37, 0.725, az, { rz: -Math.PI / 2, color: 0x6a6e78, ao: false });
    // 담금질 통 + 벽에 기댄 날붙이
    const [qx, qz] = P(hw - 1.2, hd - 0.85);
    addCyl(wood, 0.3, 0.27, 0.72, 10, qx, 0, qz, { color: WOOD });
    addCyl(iron, 0.31, 0.31, 0.05, 10, qx, 0.5, qz, { color: 0x3c3e44, ao: false });
    addCyl(iron, 0.29, 0.29, 0.05, 10, qx, 0.14, qz, { color: 0x3c3e44, ao: false });
    for (let i = 0; i < 3; i++) {
      const [wx, wz] = P(0.3 + i * 0.42, hd - 0.52);
      addBox(iron, 0.07, 1.15 + i * 0.12, 0.02, wx, 0.05, wz, { rx: -0.14, color: 0x80848c, ao: false });
    }
  }
  if (stallBox) {
    const P = place(stallBox);
    const hw = stallBox.hw;
    const hd = stallBox.hd;
    const sx = stallBox.x <= 0 ? 1 : -1;
    // 수레
    const [cx, cz] = P(-hw + 1.25, 0.45);
    addBox(wood, 2.2, 0.14, 1.15, cx, 0.58, cz, { color: WOOD, ao: false });
    for (const s of [-1, 1]) {
      addBox(wood, 2.2, 0.34, 0.06, cx, 0.72, cz + s * 0.56, { color: WOOD_DARK, ao: false });
      wood.add(new THREE.CylinderGeometry(0.5, 0.5, 0.09, 14), cx - 0.2 * sx, 0.5, cz + s * 0.67, { rx: Math.PI / 2, color: 0x8a7868, ao: false });
      iron.add(new THREE.CylinderGeometry(0.09, 0.09, 0.13, 8), cx - 0.2 * sx, 0.5, cz + s * 0.68, { rx: Math.PI / 2, color: 0x3a3c42, ao: false });
    }
    addBox(wood, 0.06, 0.34, 1.15, cx - 1.08 * sx, 0.72, cz, { color: WOOD_DARK, ao: false });
    wood.add(new THREE.BoxGeometry(1.5, 0.07, 0.07), cx + 1.7 * sx, 0.42, cz - 0.4, { rz: -0.22 * sx, color: WOOD_DARK, ao: false });   // 끌채
    wood.add(new THREE.BoxGeometry(1.5, 0.07, 0.07), cx + 1.7 * sx, 0.42, cz + 0.4, { rz: -0.22 * sx, color: WOOD_DARK, ao: false });
    addBox(wood, 0.6, 0.5, 0.55, cx - 0.55 * sx, 0.72, cz - 0.1, { ry: 0.2, color: 0xd0b89a, ao: false });   // 짐
    addBox(wood, 0.45, 0.4, 0.45, cx + 0.2 * sx, 0.72, cz + 0.18, { ry: -0.3, color: 0xc0a888, ao: false });
    addRock(cloth, 0.3, cx + 0.72 * sx, 0.9, cz - 0.15, rand, { color: 0x857256, squash: 0.75, jitter: 0.12, ao: false });
    addRock(cloth, 0.26, cx - 0.1 * sx, 1.3, cz - 0.12, rand, { color: 0x7a6850, squash: 0.7, jitter: 0.12, ao: false });
    // 천막: 장대 6개 + 용마루 + 양쪽으로 기운 천
    const x0 = -hw + 0.12;
    const x1 = hw - 1.05;
    for (const lx of [x0, x1]) {
      for (const lz of [-hd + 0.14, hd - 0.14]) {
        const [qx, qz] = P(lx, lz);
        addBox(wood, 0.1, 2.3, 0.1, qx, 0, qz, { color: WOOD_DARK });
      }
      const [rx, rz] = P(lx, 0);
      addBox(wood, 0.1, 3.1, 0.1, rx, 0, rz, { color: WOOD_DARK });
    }
    const [tx, tz] = P((x0 + x1) / 2, 0);
    const tw = x1 - x0 + 0.5;
    addBox(wood, tw, 0.09, 0.09, tx, 3.08, tz, { color: WOOD_DARK, ao: false });
    const slope = Math.hypot(hd, 0.8);
    const tilt = Math.atan2(0.8, hd);
    for (const s of [-1, 1]) {
      cloth.add(new THREE.BoxGeometry(tw, 0.03, slope), tx, 2.72, tz + s * hd * 0.5, { rx: s * tilt, color: CLOTH_RED, ao: false });
      // 처마에 늘어진 자락
      for (let i = 0; i < 5; i++) {
        const [vx, vz] = P(x0 - 0.15 + (i + 0.5) * (tw / 5), s * (hd + 0.01));
        addBox(cloth, tw / 5 - 0.06, 0.28, 0.02, vx, 2.03, vz, { color: i % 2 ? CLOTH_TAN : CLOTH_RED, ao: false });
      }
    }
    // 좌판 + 물건
    const [kx, kz] = P(0.3, -hd + 0.36);
    addBox(wood, 1.4, 0.82, 0.5, kx, 0, kz, { color: WOOD });
    addBox(cloth, 1.5, 0.03, 0.56, kx, 0.82, kz, { color: CLOTH_TAN, ao: false });
    addCyl(glow, 0.035, 0.05, 0.14, 6, kx - 0.4 * sx, 0.85, kz, { color: PALETTE.heal, bright: 1.5, ao: false });
    addCyl(glow, 0.035, 0.05, 0.14, 6, kx - 0.25 * sx, 0.85, kz + 0.08, { color: PALETTE.heal, bright: 1.5, ao: false });
    addBox(iron, 0.22, 0.06, 0.16, kx + 0.1 * sx, 0.85, kz, { ry: 0.3, color: PALETTE.npc.accent, ao: false });
    addBox(iron, 0.05, 0.3, 0.05, kx + 0.45 * sx, 0.85, kz - 0.05, { color: 0x8a8e96, ao: false });
    // 등불
    const [lx, lz] = P(x1, -hd + 0.14);
    addBox(iron, 0.3, 0.03, 0.03, lx + 0.15 * sx, 2.2, lz, { color: 0x3a3c42, ao: false });
    addBox(glow, 0.15, 0.2, 0.15, lx + 0.3 * sx, 1.92, lz, { color: PALETTE.style.fire.core, bright: 3.0, ao: false });
    addBox(iron, 0.19, 0.04, 0.19, lx + 0.3 * sx, 2.12, lz, { color: 0x2c2e33, ao: false });
    lights.push({ x: lx + 0.3 * sx, y: 1.95, z: lz - 0.1, color: 0xffb060, intensity: 9, distance: 11, flicker: 0.35 });
    // 좌판 앞 깔개(바닥 장식 — y ≤ 0.02)
    const [gx, gz] = P(0.4, -hd - 1.0);
    addBox(cloth, 2.2, 0.018, 1.2, gx, 0, gz, { ry: 0.05, color: 0x4a2a2c, ao: false });
  }

  // ── 안개문: 두 기둥(콜라이더) 사이에 아치와 안개 막 ──
  let gateMesh = null;
  if (piers.length >= 2) {
    const p0 = piers[0];
    const p1 = piers[piers.length - 1];
    const gz = (p0.z + p1.z) / 2;
    const gx = (p0.x + p1.x) / 2;
    const half = (p1.x - p0.x) / 2;
    const pr = Math.min(p0.r, p1.r);
    for (const p of [p0, p1]) {
      addCyl(stone, pr * 0.9, pr * 0.95, PIER_H, 12, p.x, 0, p.z, { color: STONE });
      addCyl(stone, pr * 1.06, pr * 1.1, 0.5, 12, p.x, 0, p.z, { color: STONE_DARK });
      addBox(stone, pr * 2.15, 0.4, pr * 2.15, p.x, PIER_H, p.z, { color: STONE_WARM, ao: false });
      addBox(stone, pr * 1.6, 2.4, 1.3, p.x, PIER_H + 0.4, p.z, { color: STONE, ao: false });   // 아치 어깨
    }
    const inner = half - pr * 0.9;                        // 막의 반폭 = 기둥 안쪽 면
    const archR = inner + 0.3;
    addArch(stone, gx - archR, gz, gx + archR, gz, PIER_H + 0.4, { thick: 0.6, depth: 1.3, n: 11, color: STONE_WARM });
    addBox(stone, half * 2 + pr * 1.6, 0.5, 1.45, gx, PIER_H + 0.4 + archR + 0.25, gz, { color: STONE_DARK, ao: false });   // 처마돌
    addBox(stone, 1.6, 0.9, 1.3, gx - half * 0.55, PIER_H + 0.9 + archR + 0.25, gz, { rz: 0.06, color: STONE, ao: false });   // 무너진 박공
    addBox(stone, 0.9, 0.5, 1.3, gx + half * 0.7, PIER_H + 0.9 + archR + 0.25, gz, { color: STONE_DARK, ao: false });
    // 막: 사각 + 반원 머리. uv는 0..1로 다시 쓴다
    const top = PIER_H + 0.4;
    const shape = new THREE.Shape();
    shape.moveTo(-inner, 0);
    shape.lineTo(inner, 0);
    shape.lineTo(inner, top);
    shape.absarc(0, top, inner, 0, Math.PI, false);
    shape.lineTo(-inner, 0);
    const mg = new THREE.ShapeGeometry(shape, 14);
    const mp = mg.attributes.position;
    const muv = mg.attributes.uv;
    for (let i = 0; i < mp.count; i++) muv.setXY(i, (mp.getX(i) + inner) / (inner * 2), mp.getY(i) / (top + inner));
    gateMesh = new THREE.Mesh(mg, gateMat);
    gateMesh.position.set(gx, 0, gz);
    gateMesh.renderOrder = 2;
    gateMesh.name = 'fogGate';
    gateMesh.updateMatrix();
    gateMesh.matrixAutoUpdate = false;
    group.add(gateMesh);
    // 문 앞으로 번지는 차가운 빛(불빛과의 대비)
    lights.push({ x: gx, y: 2.3, z: gz - 1.7, color: 0x9fc0ff, intensity: 16, distance: 15, flicker: 0.12 });
    const haze = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8fb0ff, alphaMap: lib.radial, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    haze.position.set(gx, 0.015, gz - 1.2);
    haze.updateMatrix();
    haze.matrixAutoUpdate = false;
    group.add(haze);
  }

  // ── 안개문 옆 담: 기둥 바깥에서 광장 가장자리까지(콜라이더 = data/world.js의 안개문 벽). 문 뒤로 돌아갈 수 없다 ──
  if (gateWall && piers.length >= 2) {
    const wr = makeRand(733);                             // 다른 배치의 난수열을 건드리지 않는다
    const p0 = piers[0];
    const p1 = piers[piers.length - 1];
    const spans = [
      [gateWall.x - gateWall.hw, p0.x - p0.r * 0.9],
      [p1.x + p1.r * 0.9, gateWall.x + gateWall.hw],
    ];
    for (const [x0, x1] of spans) {
      const w = x1 - x0;
      if (w < 0.3) continue;
      const n = Math.max(1, Math.round(w / 2.1));
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const h = 2.5 + wr() * 1.3;
        const cx = x0 + sw * (i + 0.5);
        addBox(stone, sw + 0.05, h, gateWall.hd * 2 + 0.25, cx, 0, gateWall.z, { color: STONE_DARK });
        if (wr() < 0.5) addBox(stone, sw * 0.5, 0.35 + wr() * 0.5, gateWall.hd * 2 + 0.25, cx - sw * 0.2, h, gateWall.z, { color: STONE, ao: false });
      }
    }
  }

  // ── 그을음 데칼(화톳불 아래) ──
  {
    const soot = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x050403, alphaMap: lib.radial, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    soot.position.set(bonfire.x, 0.012, bonfire.z);
    soot.updateMatrix();
    soot.matrixAutoUpdate = false;
    group.add(soot);
  }

  // ── 경계: 턱 + 무너진 회랑(기둥 · 아치) + 바깥 담 + 잔해 ──
  const curbN = 48;
  for (let i = 0; i < curbN; i++) {
    const a = (i / curbN) * Math.PI * 2;
    const rr = R + 0.38;
    addBox(stone, (Math.PI * 2 * rr) / curbN + 0.04, 0.2 + rand() * 0.06, 0.42, rr * Math.sin(a), 0, rr * Math.cos(a), { ry: a, color: STONE_DARK, ao: false, bright: 0.8 });
  }
  const rc = R + CLOISTER_OUT;
  const colH = [];
  for (let i = 0; i < COLUMN_COUNT; i++) {
    const a = ((i + 0.5) / COLUMN_COUNT) * Math.PI * 2;
    const da = Math.abs(Math.atan2(Math.sin(a - gateAngle), Math.cos(a - gateAngle)));
    if (da < GATE_HALF_SECTOR) { colH.push(-1); continue; }
    const intact = rand() < 0.56;
    const h = intact ? 4.4 : 0.9 + rand() * 2.6;
    colH.push(intact ? h : -h);
    const x = rc * Math.sin(a);
    const z = rc * Math.cos(a);
    addBox(stone, 1.0, 0.45, 1.0, x, 0, z, { ry: a, color: STONE_DARK });
    addCyl(stone, 0.34, 0.38, h, 10, x, 0.45, z, { color: STONE, rz: intact ? 0 : (rand() - 0.5) * 0.05 });
    if (intact) addBox(stone, 0.95, 0.32, 0.95, x, 0.45 + h, z, { ry: a, color: STONE_WARM, ao: false });
    else addRock(rock, 0.3 + rand() * 0.25, x + (rand() - 0.5) * 1.6, 0.1, z + (rand() - 0.5) * 1.6, rand, { color: 0xc8c0b6 });
  }
  for (let i = 0; i < COLUMN_COUNT; i++) {
    const j = (i + 1) % COLUMN_COUNT;
    const hi = colH[i];
    const hj = colH[j];
    if (hi === -1 || hj === -1) continue;
    if (hi < 0 && hj < 0) continue;
    const a0 = ((i + 0.5) / COLUMN_COUNT) * Math.PI * 2;
    const a1 = ((j + 0.5) / COLUMN_COUNT) * Math.PI * 2;
    const n = 9;
    // addArch의 조각 0은 두 번째 받침점(기둥 i) 쪽이다. 한쪽만 서 있으면 그쪽에 몇 조각만 남은 토막 아치.
    let from = 0;
    let to = n;
    if (hi > 0 && hj > 0) {
      if (rand() < 0.3) to = 3 + Math.floor(rand() * 2);
    } else if (hi > 0) {
      to = 2 + Math.floor(rand() * 2);
    } else {
      from = n - 2 - Math.floor(rand() * 2);
    }
    addArch(stone, rc * Math.sin(a1), rc * Math.cos(a1), rc * Math.sin(a0), rc * Math.cos(a0), 0.45 + 4.4 + 0.32,
      { thick: 0.5, depth: 0.8, n, from, to, color: STONE });
  }
  const rw = R + WALL_OUT;
  for (let i = 0; i < WALL_SEGS; i++) {
    const a = ((i + 0.5) / WALL_SEGS) * Math.PI * 2;
    const da = Math.abs(Math.atan2(Math.sin(a - gateAngle), Math.cos(a - gateAngle)));
    const behindGate = da < GATE_HALF_SECTOR + 0.1;
    if (!behindGate && rand() < 0.12) {
      // 무너진 자리 — 돌무더기
      for (let k = 0; k < 4; k++) addRock(rock, 0.5 + rand() * 0.6, (rw + (rand() - 0.5)) * Math.sin(a + (rand() - 0.5) * 0.1), 0.15, (rw + (rand() - 0.5)) * Math.cos(a + (rand() - 0.5) * 0.1), rand, { color: 0xbab2a8 });
      continue;
    }
    const h = behindGate ? 4.2 + rand() * 2.4 : 2.2 + rand() * 3.6;
    const w = (Math.PI * 2 * rw) / WALL_SEGS + 0.15;
    addBox(stone, w, h, 0.95, rw * Math.sin(a), 0, rw * Math.cos(a), { ry: a, color: behindGate ? 0xa09a92 : STONE_DARK });
    if (!behindGate && rand() < 0.5) addBox(stone, w * 0.45, 0.5 + rand() * 0.8, 0.95, rw * Math.sin(a - 0.03), h, rw * Math.cos(a - 0.03), { ry: a, color: STONE_DARK, ao: false });
  }
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2;
    const rr = R + 0.7 + rand() * (WALL_OUT - 1.3);
    addRock(rock, 0.12 + rand() * rand() * 0.55, rr * Math.sin(a), 0.05, rr * Math.cos(a), rand, { color: 0xc8c0b6 });
  }
  for (let i = 0; i < 5; i++) {
    // 쓰러진 기둥 토막
    const a = rand() * Math.PI * 2;
    const rr = R + 0.9 + rand() * 0.5;
    stone.add(new THREE.CylinderGeometry(0.34, 0.36, 1.2 + rand() * 1.4, 10), rr * Math.sin(a), 0.34, rr * Math.cos(a), { rz: Math.PI / 2, ry: a + rand(), color: STONE, ao: false, bright: 0.8 });
  }

  // ── 먼 배경: 산 능선 두 겹 + 북쪽(안개문 너머)의 성 ──
  {
    const top = 0x0c0e14;
    const bottom = 0x262b36;
    const geos = [
      makeRidgeGeometry({ radius: 150, baseY: -4, minH: 16, maxH: 50, segs: 90, seed: 5, top: 0x161a23, bottom: 0x2b313d, jag: 0.4 }),
      makeRidgeGeometry({ radius: 105, baseY: -4, minH: 7, maxH: 24, segs: 110, seed: 9, top, bottom, jag: 0.5 }),
    ];
    const cs = Math.sin(gateAngle + 0.1);
    const cc = Math.cos(gateAngle + 0.1);
    const D = 96;
    const part = (g, ox, y, oz) => geos.push(silhouettePart(g, D * cs + ox * cc + oz * cs, y, D * cc - ox * cs + oz * cc, 0x08090d, 0x1c2029, 0, 46, gateAngle));
    part(new THREE.BoxGeometry(46, 16, 14), 0, 8, 0);          // 바위 언덕
    part(new THREE.BoxGeometry(13, 40, 13), 0, 30, 0);         // 본성
    part(new THREE.ConeGeometry(9.5, 14, 4), 0, 57, 0);
    part(new THREE.BoxGeometry(6, 30, 6), -13, 25, 2);
    part(new THREE.ConeGeometry(4.6, 11, 4), -13, 45.5, 2);
    part(new THREE.BoxGeometry(5, 24, 5), 12, 22, -2);
    part(new THREE.ConeGeometry(3.9, 9, 4), 12, 38.5, -2);
    part(new THREE.BoxGeometry(4, 18, 4), 21, 17, 1);
    part(new THREE.BoxGeometry(34, 9, 4), 2, 16, 6);           // 성벽
    group.add(buildSilhouette(geos, silMat));
  }

  // ── 병합 ──
  for (const [b, mat, name, cast] of [
    [stone, stoneMat, 'stone', true], [rock, rockMat, 'rock', true], [wood, woodMat, 'wood', true],
    [cloth, clothMat, 'cloth', true], [iron, ironMat, 'iron', true], [glow, glowMat, 'glow', false],
  ]) {
    const mesh = b.build(mat, { name, cast, receive: cast });
    if (mesh) group.add(mesh);
    else mat.dispose();
  }
  const flameMesh = new THREE.Mesh(mergeGeometries(flames, false), flameMat);
  for (const g of flames) g.dispose();
  flameMesh.matrixAutoUpdate = false;
  flameMesh.renderOrder = 3;
  flameMesh.name = 'flames';
  group.add(flameMesh);

  const embers = createDriftPoints({
    count: 36, boxMin: [bonfire.x - 0.5, 0.5, bonfire.z - 0.5], boxSize: [1.0, 3.2, 1.0], vel: [0.04, 0.85, 0.02],
    sway: 0.16, size: 0.028, color: [3.2, 1.3, 0.35], twinkle: 1, additive: true, seed: 77,
  });
  group.add(embers);

  return {
    group,
    env: { ...TOWN_ENV, lights },
    timeUniforms: [flameMat.uniforms.uTime, gateMat.uniforms.uTime, embers.material.uniforms.uTime],
    drifts: [embers],
    /** 마을은 프레임마다 따로 움직일 것이 없다(셰이더 시간은 timeUniforms로 들어간다). */
    tick() {},
    dispose() {
      disposeTree(group);
    },
  };
}
