// OWNER: P12 — 계약 §9.4 · §8.3
// 강(컬럼비아강 보너빌 댐 하류)의 개성: 넓은 강폭 위로 하류(+X)로 떠내려가는 거품 줄 · 기운 항로 부표 · 하류 쪽 자갈톱(섬) ·
// 상류의 보너빌 댐(실루엣 · 열린 수문의 흰 물 · 물보라 · 끓는 방류 수면) · 건너편 현무암 협곡 절벽과 폭포 · 전나무 숲 ·
// 이쪽 물가의 자갈 · 사석(큰 돌) · 유목 · 철길 둑 · 나무 도크(말뚝 · T자 끝 · 매어 둔 보트)와 판매 오두막.
// 걷는 영역 안에서 0.5m 넘는 것은 obstacles 원 안에만 · 낚시 자리의 facing ± arc · 60m 수면 시야를 가리지 않는다(§9.4).
// three 만 — Node 에서도 만들어진다(절차 텍스처는 DataTexture). 개수는 화질로 count 만 바꾼다(지오메트리가 늘지 않는다). 빛을 더하지 않는다.

import * as THREE from 'three';
import { buildCanyon } from './river/canyon.js';
import { buildDam } from './river/dam.js';
import { buildFlow } from './river/flow.js';
import { box, dataTexture, inSpotView, inWalk, makeRand, mergeGeoms, noiseGrid, shoreZ, tallAllowed } from './river/kit.js';

/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:string, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv */

const SEED = 6060;
const COUNTS = {
  low: { pebbles: 500, grass: 600, trees: 160, bar: 160 },
  medium: { pebbles: 1000, grass: 1400, trees: 300, bar: 320 },
  high: { pebbles: 1500, grass: 2400, trees: 440, bar: 480 },
};
const BAR = { x: 150, z: -112, a: 96, b: 17, peak: 0.85 };      // 하류 쪽 자갈톱(아이브스섬 느낌) — 자리에서 100m 넘게 떨어져 시야를 가리지 않는다
const RAIL_Z = 44;                                                 // 철길 둑(걷는 영역 뒤)
const RAIL_X = [-330, 330];
const DOCK = { x: 16, w: 2.4, from: 1.3, to: -8.2, deck: 0.62, tee: { x0: 14.5, x1: 19.5, z0: -11.4, z1: -8.2 } };
const STAND_ROOM = 7;                                              // m — 설 자리 옆 큰 돌 · 통나무를 비운다(낚시 화면 아래 모서리를 가리지 않게)
const WOOD = '#7a5a3a';
const WOOD_DARK = '#5a4028';
const WOOD_GREY = '#8e8476';

/**
 * @param {{stage:import('../../types.js').StageDef, quality:'low'|'medium'|'high', heightAt:(x:number, z:number) => number}} args
 * @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q:'low'|'medium'|'high'):void, dispose():void}}
 */
export function buildRiverProps(args) {
  const { stage, heightAt } = args;
  const quality = args.quality in COUNTS ? args.quality : 'medium';
  const group = new THREE.Group();
  group.name = 'props:river';
  const geos = [];
  const mats = [];
  const texs = [];
  const instanced = [];   // {mesh, max, key}
  const G = (g) => { geos.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const rand = makeRand(SEED);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const col2 = new THREE.Color();          // 색 콜백 안의 두 번째 색(col 은 콜백의 c 와 같은 객체다)
  const maxC = COUNTS.high;
  const look = stage.look || {};

  const makeInst = (geo, mat, list, key, place, color, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    for (let i = 0; i < list.length; i++) {
      place(list[i], p, e, s);
      q.setFromEuler(e);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      if (color) { color(list[i], col); im.setColorAt(i, col); }
    }
    im.count = list.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.name = key;
    group.add(im);
    instanced.push({ mesh: im, max: list.length, key });
    return im;
  };

  // ── 원경: 댐 · 협곡 · 흐름
  const dam = look.dam ? buildDam({ dam: look.dam, quality }) : null;
  if (dam) group.add(dam.group);
  const canyon = buildCanyon({ stage, heightAt, quality });
  group.add(canyon.group);
  const flow = buildFlow({ stage, quality, dam: look.dam || null });
  group.add(flow.group);

  // ── 물가 자갈(낮다 — 걷는 영역 안에도 된다)
  const pebbleGeo = G(new THREE.DodecahedronGeometry(0.09, 0));
  const stoneMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true }));
  const pebbles = [];
  for (let i = 0; i < maxC.pebbles; i++) {
    const x = -170 + rand() * 340;
    const z = shoreZ(stage, x) + (-1.8 + Math.pow(rand(), 1.6) * 6.5);
    pebbles.push({ x, z, k: 0.5 + rand() * 1.5, a: rand() * 6.28, t: rand() });
  }
  const pebbleColor = (r, c) => {
    if (r.t < 0.35) c.set('#8f8a80'); else if (r.t < 0.6) c.set('#6e665a'); else if (r.t < 0.8) c.set('#a89c86'); else if (r.t < 0.93) c.set('#5a5650'); else c.set('#8a6a52');
  };
  makeInst(pebbleGeo, stoneMat, pebbles, 'pebbles', (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) + 0.01, r.z);
    E.set(r.a, r.a * 2, 0);
    S.set(r.k, r.k * 0.55, r.k * 0.85);
  }, pebbleColor, false);

  // ── 사석(큰 돌) — 물가 걷는 영역 밖 · 자리 시야 밖
  const boulderGeo = G(new THREE.DodecahedronGeometry(1, 0));
  const boulders = [];
  const nearStand = (x, z) => stage.spots.some(sp => Math.hypot(x - sp.stand.x, z - sp.stand.z) < STAND_ROOM);
  let guard = 0;
  while (boulders.length < 90 && guard++ < 6000) {
    const x = -175 + rand() * 350;
    const sz = shoreZ(stage, x);
    const k = 0.4 + rand() * 0.8;
    const z = sz - 1.6 + rand() * 2.8;
    if (inSpotView(stage, x, z) || nearStand(x, z) || !tallAllowed(stage, x, z, k * 1.15)) continue;
    boulders.push({ x, z, k, a: rand() * 6.28, t: rand() });
  }
  // 걷는 영역 옆(양 끝 너머)의 둑 바위
  guard = 0;
  while (boulders.length < 150 && guard++ < 6000) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (53 + rand() * 110);
    const z = shoreZ(stage, x) + 1 + rand() * 30;
    const k = 0.5 + rand() * 1.1;
    if (inSpotView(stage, x, z) || !tallAllowed(stage, x, z, k * 1.15)) continue;
    boulders.push({ x, z, k, a: rand() * 6.28, t: rand() });
  }
  makeInst(boulderGeo, stoneMat, boulders, 'boulders', (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) + r.k * 0.15, r.z);
    E.set(r.a * 0.3, r.a, r.a * 0.2);
    S.set(r.k * 1.15, r.k * 0.7, r.k);
  }, (r, c) => c.set('#4e4c48').lerp(col2.set('#7a7468'), r.t));

  // ── 유목(쓰러진 통나무) — 물가 · 걷는 영역 안은 평평한 곳에 낮게(≤ 0.5m)
  const logGeo = G(new THREE.CylinderGeometry(1, 1, 1, 7));
  logGeo.rotateZ(Math.PI / 2);
  const logMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const logs = [];
  guard = 0;
  while (logs.length < 26 && guard++ < 4000) {
    const inside = logs.length < 6;
    const x = inside ? -46 + rand() * 92 : -170 + rand() * 340;
    const z = inside ? 6 + rand() * 22 : shoreZ(stage, x) - 0.6 + rand() * 1.6;
    const r = inside ? 0.11 + rand() * 0.06 : 0.16 + rand() * 0.18;
    const len = inside ? 1.6 + rand() * 1.2 : 3 + rand() * 5;
    const yaw = rand() * 6.28;
    if (inSpotView(stage, x, z) || nearStand(x, z)) continue;
    if (inside) {
      if (!inWalk(stage, x, z)) continue;
      let far = false;
      for (const o of stage.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + len) far = true;
      if (far) continue;
    } else if (!tallAllowed(stage, x, z, len / 2 + r)) continue;
    // 양 끝의 땅 높이로 놓는다(낮은 쪽에 맞춰 묻힌다)
    const hx = Math.cos(yaw) * len / 2;
    const hz = -Math.sin(yaw) * len / 2;
    const y = Math.min(heightAt(x + hx, z + hz), heightAt(x - hx, z - hz), heightAt(x, z));
    logs.push({ x, y, z, r, len, yaw, t: rand() });
  }
  makeInst(logGeo, logMat, logs, 'logs', (r, P, E, S) => {
    P.set(r.x, r.y + r.r * 0.7, r.z);
    E.set(0, r.yaw, 0);
    S.set(r.len, r.r, r.r);
  }, (r, c) => c.set('#9a9284').lerp(col2.set('#6a5a48'), r.t));

  // ── 풀(낮음 ≤ 0.4m) — 마른 풀과 초록이 섞인 강가 풀밭
  const grassParts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.2 + (i % 3) * 0.06;
    const b = new THREE.ConeGeometry(0.03, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ((i - 2.5) * 0.2);
    b.rotateY(i * 1.05);
    grassParts.push(b);
  }
  const grassGeo = G(mergeGeoms(grassParts));
  for (const b of grassParts) b.dispose();
  const uTime = { value: 0 };
  const grassMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }));
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.23;
#else
  float ph = 0.0;
#endif
  float sw = sin(uTime * 1.5 + ph) + 0.4 * sin(uTime * 3.1 + ph * 1.7);
  transformed.x += sw * 0.3 * transformed.y * transformed.y;
  transformed.z += sw * 0.12 * transformed.y * transformed.y;`);
  };
  grassMat.customProgramCacheKey = () => 'riverGrassSway';
  const grass = [];
  for (let i = 0; i < maxC.grass; i++) {
    const x = -90 + rand() * 180;
    const z = shoreZ(stage, x) + 2.4 + Math.pow(rand(), 1.3) * 60;
    grass.push({ x, z, k: 0.7 + rand() * 0.8, a: rand() * 6.28, t: rand() });
  }
  const grassGreen = new THREE.Color('#5a6a30');
  const grassDry = new THREE.Color('#a69a58');
  makeInst(grassGeo, grassMat, grass, 'grass', (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.02, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k, r.k);
  }, (r, c) => c.copy(grassGreen).lerp(grassDry, r.t * 0.8), false);

  // ── 이쪽 숲: 더글러스전나무 · 물가 미루나무(걷는 영역 밖 · 자리 시야 밖)
  const trunkGeo = G(new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0));
  const firParts = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(1.7 - i * 0.36, 2.4, 7);
    c.translate(0, 2.0 + i * 1.45, 0);
    firParts.push(c);
  }
  const firGeo = G(mergeGeoms(firParts));
  for (const c of firParts) c.dispose();
  const leafParts = [];
  for (let i = 0; i < 4; i++) {
    const sph = new THREE.IcosahedronGeometry(1.3 - i * 0.12, 0);
    sph.translate(Math.cos(i * 1.9) * 0.7, 3.4 + (i % 2) * 0.9, Math.sin(i * 1.9) * 0.7);
    leafParts.push(sph);
  }
  const leafGeo = G(mergeGeoms(leafParts));
  for (const c of leafParts) c.dispose();
  const barkMat = M(new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1 }));
  const firMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const leafMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const firs = [];
  const broad = [];
  guard = 0;
  while (firs.length + broad.length < maxC.trees && guard++ < 40000) {
    const sideBand = rand() < 0.35;
    const x = sideBand ? (rand() < 0.5 ? -1 : 1) * (56 + rand() * 260) : -340 + rand() * 680;
    const z = sideBand ? shoreZ(stage, x) + 3 + rand() * 40 : 36 + Math.pow(rand(), 0.8) * 230;
    if (Math.abs(z - RAIL_Z) < 6) continue;
    if (!tallAllowed(stage, x, z, 2.0) || inSpotView(stage, x, z)) continue;
    const t = { x, z, k: 1.0 + rand() * 1.1, a: rand() * 6.28, t: rand() };
    if (z < 30 && rand() < 0.55) broad.push(t); else if (rand() < 0.85) firs.push(t); else broad.push(t);
  }
  const placeTree = (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.1, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k * (1.0 + r.t * 0.5), r.k);
  };
  const placeTrunk = (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.1, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k * 2.6, r.k);
  };
  makeInst(trunkGeo, barkMat, firs, 'firs', placeTrunk);
  makeInst(trunkGeo, barkMat, broad, 'broad', placeTrunk);
  makeInst(firGeo, firMat, firs, 'firs', placeTree, (r, c) => c.set('#1f3a26').lerp(col2.set('#36553a'), r.t));
  makeInst(leafGeo, leafMat, broad, 'broad', placeTree, (r, c) => c.set('#4d6a2e').lerp(col2.set('#7c8a3a'), r.t));
  const treeTotal = Math.max(1, firs.length + broad.length);

  // ── 철길 둑(유니언 퍼시픽 — 걷는 영역 뒤를 강 따라 지난다): 자갈 둑 · 침목 · 레일 두 줄
  {
    const N = Math.round((RAIL_X[1] - RAIL_X[0]) / 4);
    const pos = [];
    const idx = [];
    const railPos = [];
    const railIdx = [];
    for (let i = 0; i <= N; i++) {
      const x = RAIL_X[0] + i * 4;
      const g = Math.max(heightAt(x, RAIL_Z - 2), heightAt(x, RAIL_Z), heightAt(x, RAIL_Z + 2));
      const top = g + 0.55;
      pos.push(x, heightAt(x, RAIL_Z - 3.6) - 0.1, RAIL_Z - 3.6, x, top, RAIL_Z - 1.7, x, top, RAIL_Z + 1.7, x, heightAt(x, RAIL_Z + 3.6) - 0.1, RAIL_Z + 3.6);
      for (const rz of [-0.72, 0.72]) railPos.push(x, top + 0.2, RAIL_Z + rz - 0.04, x, top + 0.2, RAIL_Z + rz + 0.04);
      if (i > 0) {
        const a = (i - 1) * 4;
        const b = i * 4;
        for (let k = 0; k < 3; k++) idx.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
        const ra = (i - 1) * 4;
        const rb = i * 4;
        for (const o of [0, 2]) railIdx.push(ra + o, ra + o + 1, rb + o, rb + o, ra + o + 1, rb + o + 1);
      }
    }
    const bed = G(new THREE.BufferGeometry());
    bed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bed.setIndex(idx);
    bed.computeVertexNormals();
    const ballastTex = (() => {
      const n = noiseGrid(0, 61, 40);
      return dataTexture(64, 64, (u, v, o) => { const g = 0.75 + 0.45 * n(u, v); o[0] = Math.round(112 * g); o[1] = Math.round(104 * g); o[2] = Math.round(94 * g); });
    })();
    texs.push(ballastTex);
    ballastTex.repeat.set(0.5, 0.5);
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3] / 3; uv[i * 2 + 1] = pos[i * 3 + 2] / 3; }
    bed.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const bedMesh = new THREE.Mesh(bed, M(new THREE.MeshStandardMaterial({ map: ballastTex, roughness: 1 })));
    bedMesh.name = 'railBed';
    bedMesh.receiveShadow = true;
    group.add(bedMesh);
    const rails = G(new THREE.BufferGeometry());
    rails.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    rails.setIndex(railIdx);
    rails.computeVertexNormals();
    const railMesh = new THREE.Mesh(rails, M(new THREE.MeshStandardMaterial({ color: '#6a6660', roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide })));
    railMesh.name = 'rails';
    group.add(railMesh);
    const tieGeo = G(new THREE.BoxGeometry(0.24, 0.14, 2.5));
    const ties = [];
    for (let x = RAIL_X[0] + 0.3; x < RAIL_X[1]; x += 0.65) {
      const g = Math.max(heightAt(x, RAIL_Z - 2), heightAt(x, RAIL_Z), heightAt(x, RAIL_Z + 2));
      ties.push({ x, y: g + 0.55 + 0.07, t: rand() });
    }
    makeInst(tieGeo, M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 })), ties, 'ties', (r, P, E, S) => {
      P.set(r.x, r.y, RAIL_Z);
      E.set(0, (r.t - 0.5) * 0.04, 0);
      S.set(1, 1, 1);
    }, (r, c) => c.set('#3e3226').lerp(col2.set('#5a4a3a'), r.t), false);
  }

  // ── 하류 쪽 자갈톱(섬): 낮은 자갈 언덕 · 젖은 가장자리 · 버드나무 덤불 · 유목 더미 · 상류 끝의 여울 거품
  {
    const RINGS = 9;
    const SEG = 56;
    const pos = [];
    const colors = [];
    const idx = [];
    const nb = noiseGrid(0, 71, 10);
    const dry = new THREE.Color('#a39a86');
    const wet = new THREE.Color('#6a6456');
    const green = new THREE.Color('#5d6a3a');
    for (let r = 0; r <= RINGS; r++) {
      const rr = r / RINGS;
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const wob = 1 + 0.12 * Math.sin(a * 3 + 1.3) + 0.06 * Math.sin(a * 7);
        // 상류(−X) 끝은 둥글고 하류(+X) 끝은 길게 꼬리진다
        const ax = Math.cos(a) > 0 ? BAR.a * 1.15 : BAR.a * 0.85;
        const x = BAR.x + Math.cos(a) * ax * rr * wob;
        const z = BAR.z + Math.sin(a) * BAR.b * rr * wob;
        const y = BAR.peak * Math.pow(Math.max(0, 1 - rr * rr), 0.6) - 0.35 * rr * rr + (nb((x + 200) / 400, (z + 200) / 400) - 0.5) * 0.25 * (1 - rr);
        pos.push(x, y, z);
        const c = col.copy(dry).lerp(wet, Math.min(1, Math.max(0, (0.2 - y) / 0.35)));
        if (rr < 0.55 && nb((x + 30) / 120, (z + 10) / 120) > 0.58) c.lerp(green, 0.6);
        colors.push(c.r, c.g, c.b);
        if (r === 0) break;
      }
    }
    // 가운데 점(r=0) 하나 + 고리들
    for (let k = 0; k < SEG; k++) idx.push(0, 1 + ((k + 1) % SEG), 1 + k);
    for (let r = 1; r < RINGS; r++) {
      const a0 = 1 + (r - 1) * SEG;
      const b0 = 1 + r * SEG;
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG;
        idx.push(a0 + k, a0 + k1, b0 + k, b0 + k, a0 + k1, b0 + k1);
      }
    }
    const barGeo = G(new THREE.BufferGeometry());
    barGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    barGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    barGeo.setIndex(idx);
    barGeo.computeVertexNormals();
    const barMesh = new THREE.Mesh(barGeo, M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })));
    barMesh.name = 'gravelBar';
    barMesh.receiveShadow = true;
    group.add(barMesh);
    const barH = (x, z) => {
      const dx = (x - BAR.x) / (x > BAR.x ? BAR.a * 1.15 : BAR.a * 0.85);
      const dz = (z - BAR.z) / BAR.b;
      const rr = Math.min(1, Math.hypot(dx, dz));
      return BAR.peak * Math.pow(Math.max(0, 1 - rr * rr), 0.6) - 0.35 * rr * rr;
    };
    // 자갈(섬 위)
    const barStones = [];
    for (let i = 0; i < maxC.bar; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 0.95;
      const x = BAR.x + Math.cos(a) * BAR.a * rr;
      const z = BAR.z + Math.sin(a) * BAR.b * rr;
      barStones.push({ x, z, y: barH(x, z), k: 1.5 + rand() * 4, a: rand() * 6.28, t: rand() });
    }
    makeInst(pebbleGeo, stoneMat, barStones, 'bar', (r, P, E, S) => {
      P.set(r.x, r.y, r.z);
      E.set(r.a, r.a * 2, 0);
      S.set(r.k, r.k * 0.5, r.k * 0.8);
    }, pebbleColor, false);
    // 버드나무 덤불 · 유목 더미
    const willows = [];
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 0.6;
      const x = BAR.x + 20 + Math.cos(a) * BAR.a * rr;
      const z = BAR.z + Math.sin(a) * BAR.b * rr * 0.8;
      willows.push({ x, z, y: barH(x, z), k: 0.8 + rand() * 1.2, a: rand() * 6.28, t: rand() });
    }
    makeInst(leafGeo, leafMat, willows, 'willows', (r, P, E, S) => {
      P.set(r.x, r.y - 1.4 * r.k, r.z);
      E.set(0, r.a, 0);
      S.set(r.k * 1.6, r.k * 0.9, r.k * 1.2);
    }, (r, c) => c.set('#5a7034').lerp(col2.set('#8a9a4a'), r.t));
    const barLogs = [];
    for (let i = 0; i < 14; i++) {
      const x = BAR.x - BAR.a * 0.75 + rand() * 22;
      const z = BAR.z + (rand() - 0.5) * BAR.b * 1.1;
      barLogs.push({ x, z, y: Math.max(0, barH(x, z)), r: 0.18 + rand() * 0.2, len: 4 + rand() * 7, yaw: (rand() - 0.5) * 1.4, t: rand(), tx: (rand() - 0.5) * 0.1, tz: (rand() - 0.5) * 0.15 });
    }
    makeInst(logGeo, logMat, barLogs, 'barLogs', (r, P, E, S) => {
      P.set(r.x, r.y + r.r * 0.6, r.z);
      E.set(r.tx, r.yaw, r.tz);
      S.set(r.len, r.r, r.r);
    }, (r, c) => c.set('#b2a896').lerp(col2.set('#7a6e5e'), r.t));
    // 상류 끝 여울 거품(납작한 고리 반쪽)
    const fringe = G(new THREE.RingGeometry(0.92, 1.12, 48, 1, Math.PI * 0.55, Math.PI * 0.9));
    fringe.rotateX(-Math.PI / 2);
    fringe.scale(BAR.a * 0.85, 1, BAR.b);
    fringe.translate(BAR.x, 0.05, BAR.z);
    const fringeMesh = new THREE.Mesh(fringe, M(new THREE.MeshBasicMaterial({ color: '#e8eeec', transparent: true, opacity: 0.45, depthWrite: false })));
    fringeMesh.name = 'barFoam';
    fringeMesh.renderOrder = 3;
    group.add(fringeMesh);
  }

  // ── 판매 오두막(판매상 obstacles 원 안) · 나무 도크(물 위 — 걷는 영역 밖)
  let lanternMat = null;
  /** @type {THREE.Mesh|null} */
  let boatMesh = null;
  const npc = stage.points.find(pt => pt.kind === 'npc');
  if (npc) {
    let circle = stage.obstacles[0];
    let best = Infinity;
    for (const o of stage.obstacles) {
      const d = Math.hypot(o.x - npc.x, o.z - npc.z);
      if (d < best) { best = d; circle = o; }
    }
    const planks = (() => {
      const n = noiseGrid(0, 81, 24);
      return dataTexture(64, 64, (u, v, o) => {
        const board = Math.floor(v * 8);
        const seam = Math.abs(v * 8 - board - 0.5) > 0.45 ? 0.55 : 1;
        const tone = 0.82 + 0.18 * ((board * 53) % 7) / 6;
        const grain = 0.85 + 0.25 * n(u * 0.3, v * 4);
        const g = seam * tone * grain;
        o[0] = Math.round(132 * g); o[1] = Math.round(100 * g); o[2] = Math.round(70 * g);
      });
    })();
    texs.push(planks);
    // 간판(물고기 실루엣)
    const signTex = dataTexture(64, 32, (u, v, o) => {
      const fx = (u - 0.5) / 0.32;
      const fy = (v - 0.5) / 0.22;
      const body = fx * fx + fy * fy * (1 + Math.max(0, fx) * 0.4) < 1;
      const tail = u > 0.78 && u < 0.92 && Math.abs(v - 0.5) < (u - 0.74) * 1.4;
      const eye = Math.hypot(u - 0.3, v - 0.56) < 0.035;
      const border = u < 0.05 || u > 0.95 || v < 0.1 || v > 0.9;
      if (eye) { o[0] = 240; o[1] = 236; o[2] = 220; } else if (body || tail) { o[0] = 196; o[1] = 70; o[2] = 52; } else if (border) { o[0] = 70; o[1] = 52; o[2] = 36; } else { o[0] = 228; o[1] = 216; o[2] = 188; }
    }, { repeat: false });
    texs.push(signTex);
    const shack = new THREE.Group();
    shack.name = 'baitShack';
    shack.position.set(circle.x, heightAt(circle.x, circle.z), circle.z);
    group.add(shack);
    const wallMat = M(new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9 }));
    const trimMat = M(new THREE.MeshStandardMaterial({ color: '#e8e2d0', roughness: 0.8 }));
    const roofMat = M(new THREE.MeshStandardMaterial({ color: '#3f6450', roughness: 0.55, metalness: 0.35, flatShading: true }));
    const darkMat = M(new THREE.MeshStandardMaterial({ color: '#1e1a16', roughness: 1 }));
    // 몸체: 앞면(−Z, 물 쪽 — 판매상이 선 쪽)에 판매 창
    const bodyD = 1.0;
    const bodyZ = 0.6;
    const back = new THREE.Mesh(G(box(1.9, 2.3, 0.08, 0, 1.15, bodyZ + bodyD / 2)), wallMat);
    const left = new THREE.Mesh(G(box(0.08, 2.3, bodyD, -0.95, 1.15, bodyZ)), wallMat);
    const right = new THREE.Mesh(G(box(0.08, 2.3, bodyD, 0.95, 1.15, bodyZ)), wallMat);
    const frontLow = new THREE.Mesh(G(box(1.9, 0.95, 0.08, 0, 0.475, bodyZ - bodyD / 2)), wallMat);
    const frontTop = new THREE.Mesh(G(box(1.9, 0.45, 0.08, 0, 2.08, bodyZ - bodyD / 2)), wallMat);
    const frontL = new THREE.Mesh(G(box(0.3, 0.9, 0.08, -0.8, 1.4, bodyZ - bodyD / 2)), wallMat);
    const frontR = new THREE.Mesh(G(box(0.3, 0.9, 0.08, 0.8, 1.4, bodyZ - bodyD / 2)), wallMat);
    const inside = new THREE.Mesh(G(box(1.7, 2.2, 0.05, 0, 1.15, bodyZ + bodyD / 2 - 0.08)), darkMat);
    const counter = new THREE.Mesh(G(box(1.9, 0.06, 0.34, 0, 0.98, bodyZ - bodyD / 2 - 0.1)), trimMat);
    for (const m of [back, left, right, frontLow, frontTop, frontL, frontR, inside, counter]) { m.castShadow = true; m.receiveShadow = true; shack.add(m); }
    // 외쪽 경사 지붕(앞이 높다) — 원 안에 들게
    const roof = new THREE.Mesh(G(box(1.96, 0.06, 1.24, 0, 0, 0)), roofMat);
    roof.position.set(0, 2.42, bodyZ - 0.02);
    roof.rotation.x = -0.2;
    roof.castShadow = true;
    shack.add(roof);
    const sign = new THREE.Mesh(G(new THREE.PlaneGeometry(1.2, 0.5)), M(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 })));
    sign.position.set(0, 2.08, bodyZ - bodyD / 2 - 0.05);
    sign.rotation.y = Math.PI;
    shack.add(sign);
    // 미끼 냉장 상자 · 로드 걸이 · 등
    const cooler = new THREE.Mesh(G(box(0.5, 0.42, 0.34, -0.62, 0.21, bodyZ - bodyD / 2 - 0.42)), M(new THREE.MeshStandardMaterial({ color: '#d84a2a', roughness: 0.5 })));
    shack.add(cooler);
    const coolerLid = new THREE.Mesh(G(box(0.52, 0.06, 0.36, -0.62, 0.45, bodyZ - bodyD / 2 - 0.42)), trimMat);
    shack.add(coolerLid);
    const rodG = G(new THREE.CylinderGeometry(0.008, 0.016, 2.2, 5).translate(0, 1.1, 0));
    const rodM = M(new THREE.MeshStandardMaterial({ color: '#202a36', roughness: 0.4 }));
    for (let r = 0; r < 4; r++) {
      const rod = new THREE.Mesh(rodG, rodM);
      rod.position.set(1.02, 0, bodyZ - 0.3 + r * 0.16);
      rod.rotation.x = 0.06;
      rod.rotation.z = 0.05;
      shack.add(rod);
    }
    lanternMat = M(new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffc070', emissiveIntensity: 0.1, roughness: 0.5 }));
    const lantern = new THREE.Mesh(G(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8)), lanternMat);
    lantern.position.set(0.55, 2.0, bodyZ - bodyD / 2 - 0.2);
    shack.add(lantern);

    // 도크(해안선 너머 물 위 — 걷는 영역 밖): 상판 · 말뚝 · T 자 끝 · 난간 · 등 기둥 · 매어 둔 보트
    const dockParts = [];
    const deckY = DOCK.deck;
    const x0 = DOCK.x - DOCK.w / 2;
    const x1 = DOCK.x + DOCK.w / 2;
    for (let z = DOCK.from; z > DOCK.to - 0.01; z -= 0.32) {
      dockParts.push({ geo: box(DOCK.w, 0.07, 0.28, DOCK.x, deckY, z - 0.14), color: (Math.round(z * 3) % 3) ? WOOD : WOOD_GREY });
    }
    const T = DOCK.tee;
    for (let x = T.x0; x < T.x1 - 0.01; x += 0.32) {
      dockParts.push({ geo: box(0.28, 0.07, T.z1 - T.z0, x + 0.14, deckY, (T.z0 + T.z1) / 2), color: (Math.round(x * 3) % 3) ? WOOD : WOOD_GREY });
    }
    dockParts.push({ geo: box(0.16, 0.18, DOCK.from - DOCK.to, x0 + 0.08, deckY - 0.12, (DOCK.from + DOCK.to) / 2), color: WOOD_DARK });
    dockParts.push({ geo: box(0.16, 0.18, DOCK.from - DOCK.to, x1 - 0.08, deckY - 0.12, (DOCK.from + DOCK.to) / 2), color: WOOD_DARK });
    const piles = [];
    for (let z = DOCK.from - 0.4; z > DOCK.to; z -= 2.4) piles.push([x0 - 0.05, z], [x1 + 0.05, z]);
    piles.push([T.x0, T.z0], [T.x1, T.z0], [T.x0, T.z1], [T.x1, T.z1], [(T.x0 + T.x1) / 2, T.z0]);
    for (const [px, pz] of piles) {
      const bed = Math.min(-0.3, heightAt(px, pz));
      const top = deckY + 0.55;
      const pile = new THREE.CylinderGeometry(0.13, 0.15, top - bed, 7);
      pile.translate(px, (top + bed) / 2, pz);
      dockParts.push({ geo: pile, color: WOOD_DARK });
    }
    // T 자 끝 난간
    for (const [ax, az, bx, bz] of [[T.x0, T.z0, T.x1, T.z0], [T.x1, T.z0, T.x1, T.z1]]) {
      const len = Math.hypot(bx - ax, bz - az);
      const rail = new THREE.BoxGeometry(0.08, 0.08, len);
      rail.rotateY(Math.atan2(bx - ax, bz - az));
      rail.translate((ax + bx) / 2, deckY + 0.9, (az + bz) / 2);
      dockParts.push({ geo: rail, color: WOOD });
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        dockParts.push({ geo: box(0.08, 0.9, 0.08, ax + (bx - ax) * t, deckY + 0.45, az + (bz - az) * t), color: WOOD });
      }
    }
    // 등 기둥(밤에 켠다)
    dockParts.push({ geo: box(0.1, 2.4, 0.1, T.x0 + 0.3, deckY + 1.2, T.z1 - 0.3), color: '#3a3a36' });
    const dockGeo = G(mergeGeoms(dockParts));
    for (const d of dockParts) d.geo.dispose();
    const dock = new THREE.Mesh(dockGeo, M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })));
    dock.name = 'dock';
    dock.castShadow = true;
    dock.receiveShadow = true;
    group.add(dock);
    const dockLamp = new THREE.Mesh(G(new THREE.SphereGeometry(0.13, 10, 8)), lanternMat);
    dockLamp.position.set(T.x0 + 0.3, deckY + 2.45, T.z1 - 0.3);
    group.add(dockLamp);
    // 매어 둔 알루미늄 보트(T 자 끝 하류 쪽)
    const boatParts = [];
    const hull = new THREE.CylinderGeometry(0.75, 0.45, 4.2, 10, 1, false, Math.PI / 2, Math.PI);
    hull.rotateZ(Math.PI / 2);
    hull.scale(1, 0.55, 1);
    boatParts.push({ geo: hull, color: '#a8acae' });
    boatParts.push({ geo: box(4.1, 0.06, 0.08, 0, 0.02, -0.72), color: '#3a6a8a' });
    boatParts.push({ geo: box(4.1, 0.06, 0.08, 0, 0.02, 0.72), color: '#3a6a8a' });
    boatParts.push({ geo: box(0.3, 0.05, 1.3, 0.3, -0.05, 0), color: WOOD });
    boatParts.push({ geo: box(0.35, 0.45, 0.3, -2.25, 0.05, 0), color: '#2a2a2a' });   // 선외기
    const boatGeo = G(mergeGeoms(boatParts));
    for (const d of boatParts) d.geo.dispose();
    const boat = new THREE.Mesh(boatGeo, M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })));
    boat.name = 'boat';
    boat.position.set(T.x1 + 1.5, 0.18, (T.z0 + T.z1) / 2);
    boat.rotation.y = 0.08;
    boat.castShadow = true;
    group.add(boat);
    boatMesh = boat;
  }

  const applyQuality = (qname) => {
    const c = COUNTS[qname] || COUNTS.medium;
    for (const it of instanced) {
      if (it.key === 'pebbles') it.mesh.count = Math.min(it.max, c.pebbles);
      else if (it.key === 'grass') it.mesh.count = Math.min(it.max, c.grass);
      else if (it.key === 'bar') it.mesh.count = Math.min(it.max, c.bar);
      else if (it.key === 'firs' || it.key === 'broad') it.mesh.count = Math.min(it.max, Math.round(it.max * c.trees / treeTotal));
    }
    canyon.setQuality(qname);
    flow.setQuality(qname);
    if (dam) dam.setQuality(qname);
  };
  applyQuality(quality);

  const boatY = boatMesh ? boatMesh.position.y : 0;
  return {
    group,
    update(env, dt) {
      void dt;
      uTime.value = env.time;
      flow.update(env);
      canyon.update(env);
      if (dam) dam.update(env);
      if (lanternMat) lanternMat.emissiveIntensity = env.night ? 2.4 : env.light < 0.55 ? 0.9 : 0.1;
      if (boatMesh) {
        boatMesh.position.y = boatY + Math.sin(env.time * 1.3) * 0.04;
        boatMesh.rotation.z = Math.sin(env.time * 0.9) * 0.03;
      }
    },
    setQuality(qname) { applyQuality(qname in COUNTS ? qname : 'medium'); },
    dispose() {
      for (const it of instanced) it.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      if (dam) dam.dispose();
      canyon.dispose();
      flow.dispose();
    },
  };
}
