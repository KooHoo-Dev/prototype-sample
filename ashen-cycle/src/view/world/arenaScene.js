// OWNER: P6 — 계약 §9.3 · §7.8 (패키지 내부 파일 — WorldLayer만 import 한다)
// 아레나 3테마. 배치(반경 · 기둥)는 data/world.js의 arena_*를 그대로 읽는다.
//   ember — 잿더미가 된 성당(발더): 잔불이 도는 석판 · 부러진 기둥과 뾰족 아치 · 타는 잔해 · 주황 림라이트
//   frost — 설원의 얼음 호수(펜리르): 균열 간 얼음 · 얼음 기둥 · 눈 둔덕 · 푸른 달빛 · 눈발
//   void  — 심연의 제단(니힐): 룬이 빛나는 흑요석 원판 · 떠 있는 석주 · 일식 · 별 없는 하늘
// 경계 밖의 높은 구조물은 경계에서 1m 이상 물러나 있다 — 벽에 붙은 카메라(§9.4)가 파고들지 않게.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../data/palette.js';
import {
  Batch, addArch, addBox, addCyl, addRock, buildSilhouette, disposeTree,
  makeGroundGeometry, makeRand, makeRidgeGeometry, silhouettePart,
} from './geoKit.js';
import { createDriftPoints, createFlameMaterial, createMistMaterial, makeFlameGeometry } from './proceduralTextures.js';

/** @typedef {import('../../types.js').WorldDef} WorldDef */
/** @typedef {ReturnType<typeof import('./proceduralTextures.js').createTextureLibrary>} TexLib */

// 2페이즈에서 각 요소가 보스 대표색 쪽으로 얼마나 가는가(0..1) · 밝기/안개 배율
const PHASE2 = { fog: 0.28, hemi: 0.25, sun: 0.35, lights: 0.55, sky: 0.35, gain: 1.25, fogDensityMul: 1.18 };

/**
 * 원형 데칼 여러 장을 한 메시로(드로 콜 1).
 * @param {{x:number, z:number, r:number, sx?:number, sz?:number, rot?:number, y?:number}[]} list
 */
function makeDecals(lib, list, color, opacity, additive) {
  const geos = list.map((d) => {
    const g = new THREE.CircleGeometry(d.r, 20).rotateX(-Math.PI / 2);
    g.scale(d.sx ?? 1, 1, d.sz ?? 1);
    g.rotateY(d.rot ?? 0);
    g.translate(d.x, d.y ?? 0.014, d.z);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
    color, alphaMap: lib.radial, transparent: true, opacity, depthWrite: false, fog: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  mesh.matrixAutoUpdate = false;
  mesh.name = 'decals';
  return mesh;
}

/** 경계의 안개 장막(안쪽을 보는 원통). */
function makeMist(radius, y0, height, color, alpha) {
  const mat = createMistMaterial(color, alpha, height);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 64, 1, true), mat);
  mesh.position.y = y0 + height / 2;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;
  mesh.name = 'mist';
  return mesh;
}

function finish(group, batches) {
  for (const [b, mat, name, cast, receive] of batches) {
    const mesh = b.build(mat, { name, cast, receive: receive ?? cast });
    if (mesh) group.add(mesh);
    else mat.dispose();
  }
}

// ───────────────────────── ember ─────────────────────────

/** @param {WorldDef} world @param {TexLib} lib */
function buildEmber(world, lib) {
  const rand = makeRand(4021);
  const R = world.radius;
  const group = new THREE.Group();
  group.name = `stage:${world.id}`;

  const stoneMat = new THREE.MeshStandardMaterial({ map: lib.masonry.map, normalMap: lib.masonry.normalMap, vertexColors: true, roughness: 0.96 });
  const rockMat = new THREE.MeshStandardMaterial({ map: lib.rock.map, normalMap: lib.rock.normalMap, vertexColors: true, roughness: 1 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  const floorMat = new THREE.MeshStandardMaterial({
    map: lib.charred.map, normalMap: lib.charred.normalMap, emissiveMap: lib.charred.emissiveMap,
    emissive: 0xffffff, emissiveIntensity: 1.7, vertexColors: true, roughness: 0.9,
  });
  const flameMat = createFlameMaterial(PALETTE.style.fire.core, PALETTE.style.fire.glow, 2.4);
  const silMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const stone = new Batch(3.0);
  const rock = new Batch(2.0);
  const glow = new Batch(1);
  const flames = [];
  const lights = [];
  const CHAR = 0xb4a9a0;
  const CHAR_DARK = 0x8a807a;

  const ground = new THREE.Mesh(
    makeGroundGeometry([0, 3, 7.5, 8.2, 12, 16, R - 0.5, R, R + 2, R + 6, R + 14, 80], 72, 6, (r, a, out) => {
      let k = 1;
      if (r > 7.4 && r < 8.3) k = 0.72;                       // 바닥의 원형 띠
      if (r > R) k = Math.max(0.28, 0.8 - (r - R) * 0.07);
      const wob = 0.93 + 0.07 * Math.sin(a * 7 + r * 0.6);
      out.setRGB(k * wob, k * wob * 0.95, k * wob * 0.92);
    }, R),
    floorMat,
  );
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  group.add(ground);

  // 성당 기둥 고리 + 뾰족 아치. 북쪽(a = 0)은 두 기둥 사이 — 보스 뒤로 큰 창이 열린다.
  const N = 14;
  const rp = R + 2.0;
  const PIER_H = 10;
  const heights = [];
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2;
    const intact = rand() < 0.55 || i === 0 || i === N - 1;   // 북쪽 창 양옆은 서 있다
    const h = intact ? PIER_H : 2.5 + rand() * 4.5;
    heights.push(intact ? h : -h);
    const x = rp * Math.sin(a);
    const z = rp * Math.cos(a);
    addBox(stone, 1.9, 0.7, 1.9, x, 0, z, { ry: a, color: CHAR_DARK });
    addBox(stone, 1.3, h, 1.3, x, 0.7, z, { ry: a, color: CHAR });
    for (const s of [-1, 1]) {
      // 붙임기둥 — 실루엣에 세로 줄을 준다
      addCyl(stone, 0.2, 0.22, h, 6, x + Math.cos(a) * 0.72 * s, 0.7, z - Math.sin(a) * 0.72 * s, { color: CHAR_DARK });
    }
    if (intact) addBox(stone, 1.7, 0.5, 1.7, x, 0.7 + h, z, { ry: a, color: CHAR_DARK, ao: false });
    else {
      addRock(rock, 0.7 + rand() * 0.5, x + (rand() - 0.5) * 2, 0.2, z + (rand() - 0.5) * 2, rand, { color: 0xa89e96 });
      addRock(rock, 0.4 + rand() * 0.4, x + (rand() - 0.5) * 2.4, 0.15, z + (rand() - 0.5) * 2.4, rand, { color: 0x968c84 });
    }
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const hi = heights[i];
    const hj = heights[j];
    const a0 = ((i + 0.5) / N) * Math.PI * 2;
    const a1 = ((j + 0.5) / N) * Math.PI * 2;
    const am = (i + 1) / N * Math.PI * 2;
    if (hi > 0 || hj > 0) {
      const n = 13;
      let from = 0;
      let to = n;
      if (hi > 0 && hj > 0) { if (rand() < 0.35) to = 4 + Math.floor(rand() * 3); }
      else if (hi > 0) to = 3 + Math.floor(rand() * 2);
      else from = n - 3 - Math.floor(rand() * 2);
      addArch(stone, rp * Math.sin(a1), rp * Math.cos(a1), rp * Math.sin(a0), rp * Math.cos(a0), 0.7 + PIER_H + 0.5,
        { thick: 0.7, depth: 1.2, n, from, to, pointed: 1.25, color: CHAR });
    }
    // 기둥 사이의 낮은 벽(북쪽 창은 낮게 — 그 뒤로 불빛)
    const north = j === 0;
    const rw = R + 2.7;
    const chord = 2 * rw * Math.sin(Math.PI / N);
    const parts = 3;
    for (let k = 0; k < parts; k++) {
      const ak = am + ((k - 1) * (Math.PI * 2)) / N / parts * 0.86;
      const h = north ? 0.9 + rand() * 0.6 : 1.4 + rand() * 3.4;
      addBox(stone, chord / parts * 0.93, h, 0.9, rw * Math.sin(ak), 0, rw * Math.cos(ak), { ry: ak, color: k % 2 ? CHAR_DARK : CHAR });
    }
  }
  // 타는 잔해 더미 4곳 — 점광원이 붙는다
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const rr = R + 1.15;
    const x = rr * Math.sin(a);
    const z = rr * Math.cos(a);
    for (let i = 0; i < 6; i++) {
      const b = rand() * Math.PI * 2;
      addRock(rock, 0.3 + rand() * 0.3, x + Math.sin(b) * 0.5, 0.12, z + Math.cos(b) * 0.5, rand, { color: 0x6a605a });
    }
    for (let i = 0; i < 7; i++) {
      const b = rand() * Math.PI * 2;
      addRock(glow, 0.1 + rand() * 0.1, x + Math.sin(b) * 0.45 * rand(), 0.3 + rand() * 0.2, z + Math.cos(b) * 0.45 * rand(), rand, { color: 0xff5a1e, bright: 2.4, ao: false });
    }
    flames.push(
      makeFlameGeometry(x, 0.3, z, 0.55, 2.0, k + 0.13),
      makeFlameGeometry(x + 0.3, 0.3, z - 0.2, 0.35, 1.3, k + 0.51),
      makeFlameGeometry(x - 0.25, 0.3, z + 0.25, 0.3, 1.1, k + 0.87),
    );
    lights.push({ x: x * 0.97, y: 1.7, z: z * 0.97, color: 0xff7a30, intensity: 30, distance: 34, flicker: 1 });
  }
  // 경계 밖 잔해
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const rr = R + 0.7 + rand() * 5;
    addRock(rock, 0.15 + rand() * rand() * 0.9, rr * Math.sin(a), 0.05, rr * Math.cos(a), rand, { color: rand() < 0.5 ? 0x968c84 : 0x7c726c });
  }
  for (let i = 0; i < 26; i++) {
    // 재 속에 박힌 잔불
    const a = rand() * Math.PI * 2;
    const rr = R + 0.8 + rand() * 4;
    addRock(glow, 0.05 + rand() * 0.07, rr * Math.sin(a), 0.04, rr * Math.cos(a), rand, { color: 0xff5a1e, bright: 1.8, ao: false });
  }

  // 먼 배경: 무너진 첨탑들 + 낮은 능선
  {
    const top = 0x060303;
    const bottom = 0x1a0c07;
    const geos = [makeRidgeGeometry({ radius: 130, baseY: -4, minH: 10, maxH: 34, segs: 80, seed: 31, top: 0x0c0605, bottom: 0x22100a, jag: 0.45 })];
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const d = 38 + rand() * 34;
      const w = 4 + rand() * 6;
      const h = 14 + rand() * 30;
      geos.push(silhouettePart(new THREE.BoxGeometry(w, h, w), d * Math.sin(a), h / 2 - 2, d * Math.cos(a), top, bottom, 0, 34, a));
      if (rand() < 0.6) geos.push(silhouettePart(new THREE.ConeGeometry(w * 0.72, 6 + rand() * 9, 4), d * Math.sin(a), h - 2 + 4, d * Math.cos(a), top, bottom, 0, 34, a + Math.PI / 4));
    }
    group.add(buildSilhouette(geos, silMat));
  }

  finish(group, [[stone, stoneMat, 'stone', true], [rock, rockMat, 'rock', true], [glow, glowMat, 'glow', false]]);
  const flameMesh = new THREE.Mesh(mergeGeometries(flames, false), flameMat);
  for (const g of flames) g.dispose();
  flameMesh.matrixAutoUpdate = false;
  flameMesh.renderOrder = 3;
  group.add(flameMesh);
  const mist = makeMist(R + 1.3, 0, 9, 0x6a3520, 0.2);
  group.add(mist);
  const embers = createDriftPoints({
    count: 280, boxMin: [-R - 6, 0, -R - 6], boxSize: [(R + 6) * 2, 11, (R + 6) * 2], vel: [0.3, 0.75, 0.12],
    sway: 0.6, size: 0.05, color: [3.0, 1.1, 0.25], twinkle: 1, additive: true, seed: 401,
  });
  group.add(embers);

  return {
    group,
    env: {
      fog: PALETTE.fog.ember, fogGain: 2.6, fogDensity: 0.024,
      hemiSky: 0x767c8a, hemiGround: 0x2c1a10, hemiIntensity: 1.35,   // 차가운 채움빛 ↔ 주황 림라이트
      sunColor: 0xffc49a, sunIntensity: 1.6, sunDir: [0.8, 0.66, 0.45],     // 옆 뒤(동북동)에서 — 캐릭터 한쪽 면과 윤곽을 밝힌다(정면 역광은 실루엣만 남는다)
      fillColor: 0xb4c0dc, fillIntensity: 1.15,                              // 카메라 채움광(차가운 색 — 주황 림라이트와 갈린다). 발더의 어두운 갑옷이 읽히게
      shadowExtent: 17,
      sky: {
        top: 0x040303, horizon: 0x2c170d, glow: 0x5a2410, glowDir: [0.35, 0.04, 0.9], glowPow: 6,
        orbDir: [0, 1, 0], orbColor: 0x000000, orbSize: 0, orbRing: 0, stars: 0, cloud: 0.95,
      },
      lights,
      phase2: PHASE2,
    },
    timeUniforms: [flameMat.uniforms.uTime, mist.material.uniforms.uTime, embers.material.uniforms.uTime],
    drifts: [embers],
    tick(t, dt, mix, pulse) {
      floorMat.emissiveIntensity = (1.7 + 2.0 * mix) * (1 + pulse * 1.2) * (0.92 + 0.08 * Math.sin(t * 1.7));
      embers.material.uniforms.uGain.value = 1 + mix * 0.9;
      flameMat.uniforms.uIntensity.value = 2.4 + mix * 1.0;
    },
    dispose() { disposeTree(group); },
  };
}

// ───────────────────────── frost ─────────────────────────

/** @param {WorldDef} world @param {TexLib} lib */
function buildFrost(world, lib) {
  const rand = makeRand(7103);
  const R = world.radius;
  const group = new THREE.Group();
  group.name = `stage:${world.id}`;

  const iceMat = new THREE.MeshStandardMaterial({ map: lib.ice.map, normalMap: lib.ice.normalMap, vertexColors: true, roughness: 0.42, metalness: 0.05 });
  const snowMat = new THREE.MeshStandardMaterial({ map: lib.snow.map, normalMap: lib.snow.normalMap, vertexColors: true, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ map: lib.rock.map, normalMap: lib.rock.normalMap, vertexColors: true, roughness: 0.75 });
  const crystalMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.16, metalness: 0.1, flatShading: true,
    emissive: 0x2c4e78, emissiveIntensity: 0.42,
  });
  const silMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const snow = new Batch(4);
  const rock = new Batch(2.4);
  const crystal = new Batch(1);

  const ice = new THREE.Mesh(
    makeGroundGeometry([0, 5, 10, 15, R - 4, R - 1.5, R + 0.7], 72, 7, (r, a, out) => {
      // 가장자리로 갈수록 서리가 덮인다
      const frostK = Math.min(1, Math.max(0, (r - (R - 5)) / 5));
      const k = 1 + frostK * 1.3 + 0.08 * Math.sin(a * 6 + r * 0.7);
      out.setRGB(k, k, k);
    }, R),
    iceMat,
  );
  ice.receiveShadow = true;
  ice.matrixAutoUpdate = false;
  group.add(ice);

  // 눈 둔덕: 경계에서 솟아 밖으로 이어진다 — 이것이 눈에 보이는 경계다
  const bank = (r, a) => {
    const t = r - R;
    if (t <= 0.25) return -0.04;
    const n = 0.5 + 0.28 * Math.sin(a * 7 + 1.3) + 0.22 * Math.sin(a * 17 + r * 0.4);
    const rise = Math.min(1, t / 7);
    return rise * rise * (3 - 2 * rise) * (1.6 + n * 2.6) + Math.min(t, 1.2) * 0.3;
  };
  const snowRing = new THREE.Mesh(
    makeGroundGeometry([R + 0.2, R + 0.9, R + 1.8, R + 3.2, R + 5, R + 8, R + 13, R + 24, 90], 96, 5, (r, a, out) => {
      const k = Math.max(0.5, 1 - (r - R) * 0.012);
      out.setRGB(k * 0.93, k * 0.96, k);
    }, R, bank),
    snowMat,
  );
  snowRing.receiveShadow = true;
  snowRing.matrixAutoUpdate = false;
  group.add(snowRing);

  // 얼음 위에 얇게 쌓인 눈(가장자리가 흐린 데칼 — y ≤ 0.02)
  const drifts = [];
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const rr = 5 + rand() * (R - 7);
    drifts.push({ x: rr * Math.sin(a), z: rr * Math.cos(a), r: 1.1 + rand() * 1.7, sx: 1 + rand() * 0.9, sz: 0.6 + rand() * 0.5, rot: rand() * Math.PI, y: 0.012 + (i % 4) * 0.002 });
  }
  group.add(makeDecals(lib, drifts, 0xb4c8e0, 0.26, false));

  // 얼음 기둥(콜라이더 원 안에 밑동이 들어온다)
  const pillars = world.colliders.filter((c) => c.type === 'circle');
  for (const c of pillars) {
    const mainH = 7.5 + rand() * 3.5;
    addCyl(crystal, 0.2, c.r * 0.9, mainH, 6, c.x, 0, c.z, { ry: rand() * 6.28, rz: (rand() - 0.5) * 0.1, color: 0xd4ecff, ao: false });
    const shards = 5 + Math.floor(rand() * 2);
    for (let i = 0; i < shards; i++) {
      const phi = (i / shards) * Math.PI * 2 + rand() * 0.5;
      const sr = 0.32 + rand() * 0.22;
      const off = Math.min(c.r - sr, 0.5 + rand() * 0.35);
      addCyl(crystal, 0.06, sr, 2 + rand() * 3.4, 6, c.x + Math.sin(phi) * off, 0, c.z + Math.cos(phi) * off,
        { ry: phi - Math.PI / 2, rz: -(0.16 + rand() * 0.3), color: i % 2 ? 0xb8dcf6 : 0xe4f4ff, ao: false });
    }
    // 밑동의 눈
    for (let i = 0; i < 4; i++) {
      const phi = rand() * Math.PI * 2;
      addRock(snow, 0.5 + rand() * 0.3, c.x + Math.sin(phi) * c.r * 0.55, -0.12, c.z + Math.cos(phi) * c.r * 0.55, rand, { color: 0xe6eef8, squash: 0.45, jitter: 0.15, ao: false });
    }
  }

  group.add(makeDecals(lib, pillars.map((c) => ({ x: c.x, z: c.z, r: c.r + 2.2, y: 0.02 })), PALETTE.style.frost.glow, 0.2, true));

  // 경계 밖: 얼어붙은 바위 · 얼음 능선
  for (let i = 0; i < 44; i++) {
    const a = rand() * Math.PI * 2;
    const rr = R + 2 + rand() * 9;
    const s = 0.8 + rand() * 2.4;
    addRock(rock, s, rr * Math.sin(a), bank(rr, a) - s * 0.2, rr * Math.cos(a), rand, { color: rand() < 0.5 ? 0xb4c6dc : 0x94a6c0, squash: 0.9 + rand() * 0.9, ao: false });
  }
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const rr = R + 3 + rand() * 6;
    addCyl(crystal, 0.1, 0.5 + rand() * 0.6, 2.5 + rand() * 4, 5, rr * Math.sin(a), bank(rr, a) - 0.4, rr * Math.cos(a),
      { ry: rand() * 6.28, rz: (rand() - 0.5) * 0.7, color: 0xb8d8f0, ao: false });
  }

  // 먼 배경: 죽은 침엽수 + 설산 두 겹
  {
    const geos = [
      makeRidgeGeometry({ radius: 155, baseY: -4, minH: 26, maxH: 70, segs: 80, seed: 61, top: 0x1c2c48, bottom: 0x263a5a, jag: 0.6 }),
      makeRidgeGeometry({ radius: 110, baseY: -4, minH: 12, maxH: 40, segs: 100, seed: 67, top: 0x0c1524, bottom: 0x1e2e4a, jag: 0.6 }),
    ];
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2;
      const d = R + 12 + rand() * 34;
      const h = 5 + rand() * 8;
      const y = 2.5;
      geos.push(silhouettePart(new THREE.ConeGeometry(1.2 + rand() * 0.8, h, 5), d * Math.sin(a), y + h / 2, d * Math.cos(a), 0x070c16, 0x152238, 0, 14, rand() * 3));
      geos.push(silhouettePart(new THREE.ConeGeometry(0.8 + rand() * 0.5, h * 0.6, 5), d * Math.sin(a), y + h * 0.95, d * Math.cos(a), 0x070c16, 0x152238, 0, 14, rand() * 3));
    }
    group.add(buildSilhouette(geos, silMat));
  }

  finish(group, [[snow, snowMat, 'snow', false, true], [rock, rockMat, 'rock', true], [crystal, crystalMat, 'crystal', true]]);
  const mist = makeMist(R + 1.0, 0, 7, 0x9ab8d8, 0.4);
  group.add(mist);
  const flakes = createDriftPoints({
    count: 460, boxMin: [-R - 6, 0, -R - 6], boxSize: [(R + 6) * 2, 13, (R + 6) * 2], vel: [0.9, -1.5, 0.35],
    sway: 0.3, size: 0.045, color: [0.95, 1.0, 1.1], twinkle: 0, additive: false, seed: 701,
  });
  group.add(flakes);

  const moon = [-0.78, 0.55, 0.4];   // 광원은 달보다 옆에서 — 캐릭터의 한쪽 면이 읽힌다(하늘의 달 원반은 그대로)
  return {
    group,
    env: {
      fog: PALETTE.fog.frost, fogGain: 2.4, fogDensity: 0.022,
      hemiSky: 0x8ea6cc, hemiGround: 0x1c2434, hemiIntensity: 0.95,
      sunColor: 0xc4dcff, sunIntensity: 1.9, sunDir: moon,                  // 달빛 — 기둥이 긴 그림자를 끈다
      fillColor: 0xd8e6ff, fillIntensity: 0.45,
      shadowExtent: 19,
      sky: {
        top: 0x03060d, horizon: 0x1a2a48, glow: 0x2c4470, glowDir: [-0.58, 0.25, 0.77], glowPow: 9,
        orbDir: [-0.58, 0.25, 0.77], orbColor: [2.6, 2.9, 3.4], orbSize: 0.05, orbRing: 0, stars: 1, cloud: 0.4,
      },
      lights: [],
      phase2: PHASE2,
    },
    timeUniforms: [mist.material.uniforms.uTime, flakes.material.uniforms.uTime],
    drifts: [flakes],
    tick(t, dt, mix, pulse) {
      crystalMat.emissiveIntensity = (0.42 + 0.7 * mix) * (1 + pulse) * (0.94 + 0.06 * Math.sin(t * 0.9));
      mist.material.uniforms.uAlpha.value = 0.4 + 0.25 * mix;
      flakes.material.uniforms.uGain.value = 1 + mix * 0.5;
    },
    dispose() { disposeTree(group); },
  };
}

// ───────────────────────── void ─────────────────────────

/** @param {WorldDef} world @param {TexLib} lib */
function buildVoid(world, lib) {
  const rand = makeRand(9029);
  const R = world.radius;
  const group = new THREE.Group();
  group.name = `stage:${world.id}`;
  const DISC = R + 0.35;

  const floorMat = new THREE.MeshStandardMaterial({
    map: lib.obsidian.map, normalMap: lib.obsidian.normalMap, vertexColors: true, roughness: 0.38, metalness: 0.2,
    emissiveMap: lib.runes, emissive: 0xffffff, emissiveIntensity: 1.0,
  });
  const rockMat = new THREE.MeshStandardMaterial({ map: lib.rock.map, normalMap: lib.rock.normalMap, vertexColors: true, roughness: 0.85, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  const rock = new Batch(2.2);

  const floor = new THREE.Mesh(
    makeGroundGeometry([0, 4, 9, 14, 19, R, DISC], 72, 8, (r, a, out) => {
      const k = 1 + 0.06 * Math.sin(a * 8 + r);
      out.setRGB(k, k, k);
    }, DISC),
    floorMat,
  );
  floor.receiveShadow = true;
  floor.matrixAutoUpdate = false;
  group.add(floor);

  // 원판 가장자리의 부서진 이빨 — 그 너머는 심연
  const teeth = 54;
  for (let i = 0; i < teeth; i++) {
    if (rand() < 0.18) continue;
    const a = (i / teeth) * Math.PI * 2 + (rand() - 0.5) * 0.05;
    const rr = R + 1.05 + rand() * 0.5;
    const h = 0.5 + rand() * rand() * 2.6;
    addCyl(rock, 0.08 + rand() * 0.2, 0.45 + rand() * 0.35, h, 4, rr * Math.sin(a), -0.3, rr * Math.cos(a),
      { ry: a + Math.PI / 2 + Math.PI / 4, rz: -(0.1 + rand() * 0.3), color: rand() < 0.5 ? 0x9c90b8 : 0x7a6e98, ao: false });
  }
  // 가장자리 아래 벽(밖에서 원판 두께가 보이게)
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(DISC, DISC - 3, 14, 48, 1, true),
    new THREE.MeshStandardMaterial({ map: lib.rock.map, color: 0x6a5e88, roughness: 1 }),
  );
  skirt.position.y = -7;
  skirt.updateMatrix();
  skirt.matrixAutoUpdate = false;
  group.add(skirt);

  // 떠 있는 석주: 대각 쌍끼리 한 그룹(엇박자로 오르내린다). 밑동은 콜라이더 원 안.
  const pillars = world.colliders.filter((c) => c.type === 'circle');
  const pairs = [0, 1].map(() => ({ g: new THREE.Group(), stone: new Batch(2.2), glow: new Batch(1) }));
  const lights = [];
  pillars.forEach((c, idx) => {
    const pair = pairs[idx % 2];
    const y0 = 0.5;
    const H = 6.6;
    const rb = c.r * 0.9;
    const rt = c.r * 0.6;
    const ry = Math.atan2(c.x, c.z) + Math.PI / 4;
    addCyl(pair.stone, rt, rb, H, 4, c.x, y0, c.z, { ry, color: 0xa89cc8, ao: false });
    addCyl(pair.stone, 0.02, rt, 1.0, 4, c.x, y0 + H, c.z, { ry, color: 0x8c80aa, ao: false });
    addCyl(pair.stone, rb, 0.18, 0.42, 4, c.x, y0 - 0.42, c.z, { ry, color: 0x70648c, ao: false });   // 부러진 밑동
    for (const hy of [1.4, 3.1, 4.8]) {
      const rr = rb + (rt - rb) * (hy / H) + 0.025;
      addCyl(pair.glow, rr, rr, 0.07, 4, c.x, y0 + hy, c.z, { ry, color: PALETTE.style.void.glow, bright: 2.0, ao: false });
    }
    for (let i = 0; i < 3; i++) {
      // 석주 둘레를 도는 파편
      const phi = rand() * Math.PI * 2;
      addRock(pair.stone, 0.12 + rand() * 0.14, c.x + Math.sin(phi) * (c.r * 0.75), y0 + 1 + rand() * 5, c.z + Math.cos(phi) * (c.r * 0.75), rand, { color: 0x8c80aa, ao: false });
    }
    lights.push({ x: c.x * 0.93, y: 1.4, z: c.z * 0.93, color: 0x9a5cff, intensity: 9, distance: 15, flicker: 0.15 });
  });
  const stoneMat = new THREE.MeshStandardMaterial({ map: lib.rock.map, normalMap: lib.rock.normalMap, vertexColors: true, roughness: 0.7, flatShading: true });
  for (const pair of pairs) {
    const m = pair.stone.build(stoneMat, { name: 'monolith' });
    const gl = pair.glow.build(glowMat, { name: 'monolithGlow', cast: false, receive: false });
    if (m) pair.g.add(m);
    if (gl) pair.g.add(gl);
    group.add(pair.g);
  }

  // 심연에 뜬 바위섬
  const islands = new THREE.Group();
  const isl = new Batch(5);
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const d = R + 9 + rand() * 40;
    const s = 2.5 + rand() * 6;
    addRock(isl, s, d * Math.sin(a), -12 + rand() * 30, d * Math.cos(a), rand, { color: 0x8a7eaa, squash: 0.45 + rand() * 0.4, jitter: 0.4, ao: false });
  }
  const islMesh = isl.build(rockMat, { name: 'islands', cast: false, receive: false });
  if (islMesh) islands.add(islMesh);
  group.add(islands);

  finish(group, [[rock, rockMat, 'rim', true]]);
  const mist = makeMist(R + 0.9, -5, 12, 0x4a2a8a, 0.42);
  group.add(mist);
  const motes = createDriftPoints({
    count: 240, boxMin: [-R - 6, -2, -R - 6], boxSize: [(R + 6) * 2, 14, (R + 6) * 2], vel: [0.05, 0.35, 0.0],
    sway: 0.7, size: 0.05, color: [1.3, 0.6, 2.6], twinkle: 1, additive: true, seed: 901,
  });
  group.add(motes);

  return {
    group,
    env: {
      fog: PALETTE.fog.void, fogGain: 2.2, fogDensity: 0.023,
      hemiSky: 0x625c86, hemiGround: 0x100c1a, hemiIntensity: 1.0,
      sunColor: 0xc4b8f4, sunIntensity: 1.5, sunDir: [0.12, 0.8, 0.58],
      fillColor: 0xcfc8f0, fillIntensity: 0.8,
      shadowExtent: 18,
      sky: {
        top: 0x020106, horizon: 0x120a22, glow: 0x201040, glowDir: [0, 0.2, 1], glowPow: 5,
        orbDir: [0, 0.3, 0.95], orbColor: [1.5, 0.9, 2.4], orbSize: 0.085, orbRing: 1, stars: 0, cloud: 0.6,
      },
      lights,
      phase2: PHASE2,
    },
    timeUniforms: [mist.material.uniforms.uTime, motes.material.uniforms.uTime],
    drifts: [motes],
    tick(t, dt, mix, pulse) {
      const speed = 1.3 + mix * 1.4;
      // 룬은 바닥 표식(텔레그래프)보다 어둡게 둔다 — 같은 보라라서 밝으면 공격 예고와 헷갈린다
      // (블룸 임계 아래에서 은은하게 — 표식의 외곽선 · 채움이 언제나 바닥보다 밝다)
      floorMat.emissiveIntensity = (0.36 + 0.08 * Math.sin(t * speed)) * (1 + mix * 0.6) * (1 + pulse * 2.0);
      pairs[0].g.position.y = Math.sin(t * 0.7) * 0.07;
      pairs[1].g.position.y = Math.sin(t * 0.7 + Math.PI) * 0.07;
      islands.rotation.y = t * 0.004;
      motes.material.uniforms.uGain.value = 1 + mix * 0.8;
    },
    dispose() { disposeTree(group); },
  };
}

/**
 * 테마별 아레나 스테이지를 만든다.
 * @param {WorldDef} world
 * @param {TexLib} lib
 */
export function buildArena(world, lib) {
  if (world.theme === 'frost') return buildFrost(world, lib);
  if (world.theme === 'void') return buildVoid(world, lib);
  return buildEmber(world, lib);
}
