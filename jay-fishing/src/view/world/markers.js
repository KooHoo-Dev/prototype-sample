// OWNER: P5 — 내부 파일 · 낚시 자리 표식(바닥 고리 반경 1.2m + 깃대 1.1m) · 장애물 띠(snag.fromM … +8m, facing ± arc).
// 판정과 보이는 것(§9.10): 고리는 판정 1.4m 와 0.2m 안 · 띠는 fromM 에서 1m 안. 띠 모양은 spot.bottom 으로 고른다.

import * as THREE from 'three';
import { fwd } from '../../core/math.js';
import { makeRand } from './noise.js';

export const RING_RADIUS = 1.2;
const RING_HALF_W = 0.07;
const RING_SEGS = 72;
const RING_LIFT = 0.035;
export const POLE_H = 1.1;
const SNAG_DEPTH = 8;
const FLAG_COLOR = '#ff7a2a';

/** 땅 모양을 따라 붙인 고리 */
function buildRingGeometry(cx, cz, heightAt) {
  const pos = new Float32Array((RING_SEGS + 1) * 2 * 3);
  const uv = new Float32Array((RING_SEGS + 1) * 2 * 2);
  for (let i = 0; i <= RING_SEGS; i++) {
    const a = (i / RING_SEGS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let k = 0; k < 2; k++) {
      const r = RING_RADIUS + (k ? RING_HALF_W : -RING_HALF_W);
      const x = cx + c * r;
      const z = cz + s * r;
      const o = (i * 2 + k) * 3;
      pos[o] = x;
      pos[o + 1] = heightAt(x, z) + RING_LIFT;
      pos[o + 2] = z;
      uv[(i * 2 + k) * 2] = i / RING_SEGS;
      uv[(i * 2 + k) * 2 + 1] = k;
    }
  }
  const idx = [];
  for (let i = 0; i < RING_SEGS; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 공유 지오메트리(장애물 띠 · 깃대) — 스테이지마다 다시 만들지 않는다 */
export function createMarkerKit() {
  // 수초 한 덤불: 가는 잎 7장
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.55 + (i % 3) * 0.22;
    const b = new THREE.ConeGeometry(0.025, h, 3, 1, true);
    b.translate(0, h / 2 - 0.05, 0);
    b.rotateZ((i - 3) * 0.09);
    b.rotateY(i * 0.9);
    b.translate(Math.cos(i * 2.4) * 0.12, 0, Math.sin(i * 2.4) * 0.12);
    blades.push(b);
  }
  const weed = mergeGeoms(blades);
  for (const b of blades) b.dispose();
  const pad = new THREE.CircleGeometry(0.28, 9).rotateX(-Math.PI / 2);
  const rock = new THREE.IcosahedronGeometry(0.7, 0);
  const log = new THREE.CylinderGeometry(0.16, 0.22, 4.2, 7, 1);
  log.rotateZ(Math.PI / 2);
  const stub = new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5);
  stub.translate(0, 0.55, 0);
  stub.rotateZ(0.5);
  stub.translate(0.6, 0.1, 0);
  const stub2 = new THREE.CylinderGeometry(0.04, 0.07, 0.9, 5);
  stub2.translate(0, 0.45, 0);
  stub2.rotateZ(-0.7);
  stub2.translate(-1.1, 0.1, 0.05);
  const logFull = mergeGeoms([log, stub, stub2]);
  log.dispose(); stub.dispose(); stub2.dispose();
  const pole = new THREE.CylinderGeometry(0.022, 0.03, POLE_H, 6);
  pole.translate(0, POLE_H / 2, 0);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, -0.2, 0, 0.36, -0.1, 0]), 3));
  flag.computeVertexNormals();
  flag.translate(0, POLE_H - 0.02, 0);
  const mats = {
    weed: new THREE.MeshStandardMaterial({ color: '#5d7a32', roughness: 0.9, side: THREE.DoubleSide }),
    pad: new THREE.MeshStandardMaterial({ color: '#3f6a2a', roughness: 0.7 }),
    rock: new THREE.MeshStandardMaterial({ color: '#4a4744', roughness: 0.95, flatShading: true }),
    log: new THREE.MeshStandardMaterial({ color: '#5a4836', roughness: 1.0, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: '#7a7466', roughness: 0.95, flatShading: true }),
    pole: new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.6 }),
    flag: new THREE.MeshStandardMaterial({ color: FLAG_COLOR, emissive: FLAG_COLOR, emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.8 }),
  };
  return {
    geo: { weed, pad, rock, log: logFull, pole, flag },
    mats,
    dispose() {
      weed.dispose(); pad.dispose(); rock.dispose(); logFull.dispose(); pole.dispose(); flag.dispose();
      for (const k of Object.keys(mats)) mats[k].dispose();
    },
  };
}

/** 여러 BufferGeometry(같은 속성 · 색인 있음/없음)를 하나로 — position · normal 만 */
export function mergeGeoms(list) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 부채꼴 띠 안의 점들 — 첫 줄은 fromM 에 붙는다 @returns {Array<{x:number, z:number, r:number, a:number, u:number}>} */
export function snagPoints(spot, count, seed, pad = 0.2) {
  const rand = makeRand(seed);
  const out = [];
  const { fromM } = spot.snag;
  for (let i = 0; i < count; i++) {
    // 앞쪽(fromM 근처)에 더 촘촘하게 — 띠의 시작이 읽히게
    const t = i < Math.ceil(count * 0.3) ? rand() * 0.12 : Math.pow(rand(), 1.3);
    const r = fromM + pad + t * (SNAG_DEPTH - 2 * pad);
    const a = spot.facing + (rand() * 2 - 1) * spot.arc;
    const f = fwd(a, r);
    out.push({ x: spot.stand.x + f.x, z: spot.stand.z + f.z, r, a, u: rand() });
  }
  return out;
}

/**
 * 자리 표식 하나(고리 + 깃대 + 장애물 띠).
 * @param {Object} spot SpotDef @param {(x:number, z:number) => number} heightAt @param {ReturnType<typeof createMarkerKit>} kit
 */
export function buildSpotMarker(spot, heightAt, kit, seed) {
  const group = new THREE.Group();
  group.name = `spot:${spot.id}`;
  const ringGeo = buildRingGeometry(spot.stand.x, spot.stand.z, heightAt);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'ring';
  ring.renderOrder = 3;
  group.add(ring);
  // 깃대: 고리 뒤쪽(땅 쪽) 가장자리 — 물 쪽 시야를 가리지 않는다
  const back = fwd(spot.facing, -RING_RADIUS);
  const px = spot.stand.x + back.x;
  const pz = spot.stand.z + back.z;
  const pole = new THREE.Mesh(kit.geo.pole, kit.mats.pole);
  pole.position.set(px, heightAt(px, pz) - 0.02, pz);
  pole.castShadow = true;
  const flag = new THREE.Mesh(kit.geo.flag, kit.mats.flag);
  flag.position.copy(pole.position);
  flag.rotation.y = spot.facing + Math.PI / 4;   // 45° — 땅 쪽에서 다가올 때도 · 물가를 따라 걸을 때도 깃발 면이 보인다(W1 통합: π/2 는 스폰에서 정면으로 다가갈 때 옆면만 보였다)
  group.add(pole, flag);

  // 장애물 띠
  const snag = new THREE.Group();
  snag.name = 'snag';
  const kind = spot.bottom === 'mud' ? 'weed' : spot.bottom === 'rock' ? 'rock' : 'wood';
  const instGroups = [];
  const addInst = (geo, mat, pts, place) => {
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    for (let i = 0; i < pts.length; i++) {
      place(pts[i], _p, _e, _s);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    snag.add(im);
    instGroups.push(im);
    return im;
  };
  if (kind === 'weed') {
    const tufts = snagPoints(spot, 64, seed, 0.2);
    addInst(kit.geo.weed, kit.mats.weed, tufts, (pt, p, e, s) => {
      p.set(pt.x, -0.12, pt.z);
      e.set(0, pt.u * 6.28, 0);
      const k = 0.8 + pt.u * 0.7;
      s.set(k, k, k);
    });
    const pads = snagPoints(spot, 40, seed + 1, 0.4);
    addInst(kit.geo.pad, kit.mats.pad, pads, (pt, p, e, s) => {
      p.set(pt.x, 0.015, pt.z);
      e.set(0, pt.u * 6.28, 0);
      const k = 0.7 + pt.u * 0.8;
      s.set(k, 1, k);
    });
  } else if (kind === 'rock') {
    const rocks = snagPoints(spot, 26, seed, 0.7);
    addInst(kit.geo.rock, kit.mats.rock, rocks, (pt, p, e, s) => {
      const k = 0.55 + pt.u * 0.9;
      p.set(pt.x, -0.35 + k * 0.35, pt.z);
      e.set(pt.u * 2.1, pt.u * 6.28, pt.u * 1.3);
      s.set(k * 1.1, k * 0.8, k);
    });
  } else {
    const logs = snagPoints(spot, 6, seed, 0.6);
    addInst(kit.geo.log, kit.mats.log, logs, (pt, p, e, s) => {
      p.set(pt.x, 0.02, pt.z);
      e.set(0.05, pt.a + (pt.u - 0.5) * 0.5, 0.04);   // 통나무 축(로컬 X)이 부채꼴 접선 방향
      s.set(1, 1, 1);
    });
    const stones = snagPoints(spot, 18, seed + 1, 0.5);
    addInst(kit.geo.rock, kit.mats.stone, stones, (pt, p, e, s) => {
      const k = 0.35 + pt.u * 0.5;
      p.set(pt.x, -0.25 + k * 0.3, pt.z);
      e.set(pt.u * 2, pt.u * 6.28, 0);
      s.set(k, k * 0.7, k);
    });
  }
  group.add(snag);
  return {
    group, ring, ringMat, snag, instGroups, kind,
    dispose() { ringGeo.dispose(); ringMat.dispose(); for (const im of instGroups) im.dispose(); },
  };
}
