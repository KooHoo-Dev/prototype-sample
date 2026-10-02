// OWNER: P5 — 계약 §9.4 · §9.3
// 호수(충주호 청풍 연안)의 개성: 갈대 군락 · 자갈 물가 · 수몰 나무 · 좌판(파라솔 + 아이스박스 + 생선 상자) · 기슭의 소나무/활엽수 · 풀.
// 걷는 영역 안에서 0.5m 넘는 것은 obstacles 원 안에만 · 낚시 자리의 facing ± arc · 60m 수면 시야를 가리지 않는다(§9.4).
// three 만 — Node 에서도 만들어진다. 개수는 화질로 InstancedMesh.count 만 바꾼다(지오메트리가 늘지 않는다).

import * as THREE from 'three';
import { mergeGeoms } from '../world/markers.js';
import { makeRand } from '../world/noise.js';
import { inSpotView, inWalk, tallAllowed } from '../world/placement.js';

/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:string, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv */

const COUNTS = {
  low: { reeds: 140, pebbles: 450, grass: 600, trees: 140 },
  medium: { reeds: 260, pebbles: 900, grass: 1400, trees: 240 },
  high: { reeds: 380, pebbles: 1400, grass: 2400, trees: 340 },
};
const SEED = 4242;
const DROWNED = [[-78, -14], [-96, -32], [-58, -48], [66, -16], [88, -34], [118, -12], [-122, -8], [104, -60]];

/** 바람에 흔들리는 인스턴스 재질(높이의 제곱만큼) */
function swayMaterial(params, uTime, amp) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.23;
#else
  float ph = 0.0;
#endif
  float sw = sin(uTime * 1.3 + ph) + 0.4 * sin(uTime * 2.9 + ph * 1.7);
  transformed.x += sw * ${amp.toFixed(3)} * transformed.y * transformed.y;
  transformed.z += sw * ${(amp * 0.5).toFixed(3)} * transformed.y * transformed.y;`);
  };
  m.customProgramCacheKey = () => `sway${amp}`;
  return m;
}

/**
 * @param {{stage:import('../../types.js').StageDef, quality:'low'|'medium'|'high', heightAt:(x:number, z:number) => number}} args
 * @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q:'low'|'medium'|'high'):void, dispose():void}}
 */
export function buildLakeProps(args) {
  const { stage, heightAt } = args;
  const group = new THREE.Group();
  group.name = 'props:lake';
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const uTime = { value: 0 };
  const rand = makeRand(SEED);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const instanced = [];   // {mesh, max, key}
  const shoreZ = (x) => {
    const sh = stage.shore;
    if (x <= sh[0].x) return sh[0].z;
    for (let i = 1; i < sh.length; i++) if (x <= sh[i].x) {
      const a = sh[i - 1];
      const b = sh[i];
      return a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x);
    }
    return sh[sh.length - 1].z;
  };
  const makeInst = (geo, mat, list, key, place, color) => {
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
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
    instanced.push({ mesh: im, max: list.length, key });
    return im;
  };
  const maxC = COUNTS.high;

  // ── 갈대 군락: 물가(물 쪽 0.2..3.5m · 걷는 영역 밖) · 자리 시야 밖
  const reedBlades = [];
  for (let i = 0; i < 9; i++) {
    const h = 1.3 + (i % 4) * 0.2;
    const b = new THREE.ConeGeometry(0.02, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ(Math.sin(i * 1.7) * 0.12);
    b.rotateY(i * 0.7);
    b.translate(Math.cos(i * 2.4) * 0.16, 0, Math.sin(i * 2.4) * 0.16);
    reedBlades.push(b);
  }
  const reedGeo = G(mergeGeoms(reedBlades));
  for (const b of reedBlades) b.dispose();
  const headParts = [];
  for (let i = 0; i < 3; i++) {
    const h = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6);
    h.translate(Math.cos(i * 2.1) * 0.12, 1.55 + i * 0.12, Math.sin(i * 2.1) * 0.12);
    headParts.push(h);
  }
  const headGeo = G(mergeGeoms(headParts));
  for (const h of headParts) h.dispose();
  const reedMat = M(swayMaterial({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide }, uTime, 0.035));
  const headMat = M(swayMaterial({ color: '#5a3a22', roughness: 0.9 }, uTime, 0.035));
  const reeds = [];
  let guard = 0;
  while (reeds.length < maxC.reeds && guard++ < 20000) {
    const x = -150 + rand() * 300;
    const sz = shoreZ(x);
    const off = -0.4 + rand() * 3.9;            // 해안선에서 물 쪽(+) 거리
    const z = sz - off;
    if (inWalk(stage, x, z) || inSpotView(stage, x, z)) continue;
    // 군락: 근처에 몇 덤불 더
    const n = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < n && reeds.length < maxC.reeds; k++) {
      const rx = x + (rand() - 0.5) * 2.2;
      const rz = z + (rand() - 0.5) * 1.6;
      if (inWalk(stage, rx, rz) || inSpotView(stage, rx, rz)) continue;
      reeds.push({ x: rx, z: rz, k: 0.75 + rand() * 0.55, a: rand() * 6.28, t: rand() });
    }
  }
  const placeReed = (r, P, E, S) => {
    P.set(r.x, Math.max(heightAt(r.x, r.z), -0.6) - 0.05, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k, r.k);
  };
  const reedDry = new THREE.Color('#b0a058');
  makeInst(reedGeo, reedMat, reeds, 'reeds', placeReed, (r, c) => c.set('#7d8f3e').lerp(reedDry, r.t * 0.6));
  makeInst(headGeo, headMat, reeds, 'reeds', placeReed);

  // ── 자갈 물가: 해안선 둘레 띠(낮음) — 자갈 자리 앞이 가장 촘촘
  const pebbleGeo = G(new THREE.DodecahedronGeometry(0.09, 0));
  const pebbleMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }));
  const pebbles = [];
  const gravel = stage.spots.find(sp => sp.bottom === 'gravel');
  for (let i = 0; i < maxC.pebbles; i++) {
    const dense = i < maxC.pebbles * 0.55 && gravel;
    const x = dense ? gravel.stand.x - 26 + rand() * 52 : -130 + rand() * 260;
    const sz = shoreZ(x);
    const z = sz + (-1.6 + rand() * 4.4);
    pebbles.push({ x, z, k: 0.5 + rand() * 1.4, a: rand() * 6.28, t: rand() });
  }
  makeInst(pebbleGeo, pebbleMat, pebbles, 'pebbles', (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) + 0.01, r.z);
    E.set(r.a, r.a * 2, 0);
    S.set(r.k, r.k * 0.55, r.k * 0.85);
  }, (r, c) => {
    if (r.t < 0.4) c.set('#9a948a'); else if (r.t < 0.7) c.set('#7a6e60'); else if (r.t < 0.9) c.set('#b8ae9c'); else c.set('#5e5a55');
  });

  // ── 풀 덤불(낮음 ≤ 0.4m) — 땅 쪽 전역
  const grassParts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.22 + (i % 3) * 0.06;
    const b = new THREE.ConeGeometry(0.03, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ((i - 2.5) * 0.18);
    b.rotateY(i * 1.05);
    grassParts.push(b);
  }
  const grassGeo = G(mergeGeoms(grassParts));
  for (const b of grassParts) b.dispose();
  const grassMat = M(swayMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }, uTime, 0.25));
  const grass = [];
  const grassDry = new THREE.Color('#9a9a4a');
  guard = 0;
  while (grass.length < maxC.grass && guard++ < 40000) {
    const x = -80 + rand() * 160;
    const z = shoreZ(x) + 2.2 + Math.pow(rand(), 1.4) * 60;
    grass.push({ x, z, k: 0.7 + rand() * 0.8, a: rand() * 6.28, t: rand() });
  }
  makeInst(grassGeo, grassMat, grass, 'grass', (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.02, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k, r.k);
  }, (r, c) => c.set('#56702e').lerp(grassDry, r.t * 0.7));

  // ── 나무: 걷는 영역 밖의 땅(뒤쪽 언덕 · 양 옆)
  const trunkGeo = G(new THREE.CylinderGeometry(0.12, 0.2, 1, 6).translate(0, 0.5, 0));
  const pineParts = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(1.5 - i * 0.38, 2.2, 7);
    c.translate(0, 2.2 + i * 1.3, 0);
    pineParts.push(c);
  }
  const pineGeo = G(mergeGeoms(pineParts));
  for (const c of pineParts) c.dispose();
  const leafParts = [];
  for (let i = 0; i < 4; i++) {
    const sph = new THREE.IcosahedronGeometry(1.25 - i * 0.12, 0);
    sph.translate(Math.cos(i * 1.9) * 0.7, 3.0 + (i % 2) * 0.8, Math.sin(i * 1.9) * 0.7);
    leafParts.push(sph);
  }
  const leafGeo = G(mergeGeoms(leafParts));
  for (const c of leafParts) c.dispose();
  const trunkMat = M(new THREE.MeshStandardMaterial({ color: '#4a3626', roughness: 1 }));
  const pineMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const leafMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const pines = [];
  const broad = [];
  guard = 0;
  while (pines.length + broad.length < maxC.trees && guard++ < 30000) {
    const x = -260 + rand() * 520;
    const z = shoreZ(x) + 3 + Math.pow(rand(), 0.8) * 200;
    if (!tallAllowed(stage, x, z, 1.6)) continue;
    if (inSpotView(stage, x, z)) continue;
    const t = { x, z, k: 0.8 + rand() * 0.9, a: rand() * 6.28, t: rand() };
    if (rand() < 0.62) pines.push(t); else broad.push(t);
  }
  const placeTree = (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.1, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k * (0.9 + r.t * 0.3), r.k);
  };
  const placeTrunk = (r, P, E, S) => {
    P.set(r.x, heightAt(r.x, r.z) - 0.1, r.z);
    E.set(0, r.a, 0);
    S.set(r.k, r.k * 2.4, r.k);
  };
  const pineLight = new THREE.Color('#40583a');
  const leafLight = new THREE.Color('#6e7a36');
  makeInst(trunkGeo, trunkMat, pines, 'pines', placeTrunk);
  makeInst(trunkGeo, trunkMat, broad, 'broad', placeTrunk);
  makeInst(pineGeo, pineMat, pines, 'pines', placeTree, (r, c) => c.set('#2f4a2c').lerp(pineLight, r.t));
  makeInst(leafGeo, leafMat, broad, 'broad', placeTree, (r, c) => c.set('#4f6e30').lerp(leafLight, r.t));
  const treeTotal = Math.max(1, pines.length + broad.length);

  // ── 수몰 나무(물 위로 솟은 죽은 줄기 · 자리 시야 밖)
  const deadM = M(new THREE.MeshStandardMaterial({ color: '#8f877a', roughness: 1, flatShading: true }));
  for (const [x, z] of DROWNED) {
    if (inSpotView(stage, x, z)) continue;
    const bed = heightAt(x, z);
    const above = 2.2 + rand() * 2.2;
    const len = above - bed;
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.1, 0.24, len, 7);
    trunk.translate(0, len / 2, 0);
    parts.push(trunk);
    for (let b = 0; b < 4; b++) {
      const bl = 0.8 + rand() * 1.4;
      const br = new THREE.CylinderGeometry(0.03, 0.07, bl, 5);
      br.translate(0, bl / 2, 0);
      br.rotateZ((rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6));
      br.rotateY(rand() * 6.28);
      br.translate(0, len - 0.4 - b * (0.5 + rand() * 0.4), 0);
      parts.push(br);
    }
    const g = G(mergeGeoms(parts));
    for (const pp of parts) pp.dispose();
    const tree = new THREE.Mesh(g, deadM);
    tree.position.set(x, bed, z);
    tree.rotation.set((rand() - 0.5) * 0.2, rand() * 6.28, (rand() - 0.5) * 0.2);
    tree.castShadow = true;
    group.add(tree);
  }

  // ── 좌판(판매상 obstacles 원 안): 파라솔 · 진열대 · 아이스박스 · 생선 상자 · 의자 · 등
  const npc = stage.points.find(pt => pt.kind === 'npc');
  let lanternM = null;
  if (npc) {
    let circle = stage.obstacles[0];
    let best = Infinity;
    for (const o of stage.obstacles) {
      const d = Math.hypot(o.x - npc.x, o.z - npc.z);
      if (d < best) { best = d; circle = o; }
    }
    const stall = new THREE.Group();
    stall.name = 'stall';
    stall.position.set(circle.x, heightAt(circle.x, circle.z), circle.z);
    stall.rotation.y = npc.yaw;
    group.add(stall);
    const metal = M(new THREE.MeshStandardMaterial({ color: '#c8c8c0', roughness: 0.4, metalness: 0.5 }));
    const wood = M(new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.85 }));
    // 파라솔 — 줄무늬 천(면마다 색)
    const SEG = 12;
    const R = 1.12;
    const H0 = 2.05;
    const H1 = 2.42;
    const pos = [];
    const cols = [];
    const red = new THREE.Color('#c83a32');
    const white = new THREE.Color('#f2ede2');
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      pos.push(0, H1, 0, Math.cos(a1) * R, H0, Math.sin(a1) * R, Math.cos(a0) * R, H0, Math.sin(a0) * R);
      const c = i % 2 ? red : white;
      for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
    }
    const canopyG = G(new THREE.BufferGeometry());
    canopyG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    canopyG.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    canopyG.computeVertexNormals();
    // 천이 빛을 조금 투과한다(아랫면이 새까맣지 않게)
    const canopyM = M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    canopyM.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.22;');
    };
    canopyM.customProgramCacheKey = () => 'canopyTranslucent';
    const canopy = new THREE.Mesh(canopyG, canopyM);
    canopy.castShadow = true;
    stall.add(canopy);
    const pole = new THREE.Mesh(G(new THREE.CylinderGeometry(0.025, 0.025, H1, 6).translate(0, H1 / 2, 0)), metal);
    pole.position.set(0, 0, 0.05);
    stall.add(pole);
    // 진열대(뒤쪽) + 얼음 위 생선
    const table = new THREE.Group();
    table.position.set(0, 0, 0.45);
    stall.add(table);
    const top = new THREE.Mesh(G(new THREE.BoxGeometry(0.92, 0.04, 0.5)), wood);
    top.position.y = 0.76;
    top.castShadow = true;
    table.add(top);
    const legG = G(new THREE.CylinderGeometry(0.02, 0.02, 0.74, 5).translate(0, 0.37, 0));
    for (const [lx, lz] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.2], [0.42, 0.2]]) {
      const l = new THREE.Mesh(legG, metal);
      l.position.set(lx, 0, lz);
      table.add(l);
    }
    const trayM = M(new THREE.MeshStandardMaterial({ color: '#3a6ab0', roughness: 0.5 }));
    const iceM = M(new THREE.MeshStandardMaterial({ color: '#e8f2f6', roughness: 0.3 }));
    const fishM = M(new THREE.MeshStandardMaterial({ color: '#9aa6a8', roughness: 0.35, metalness: 0.4 }));
    const fishG = G(new THREE.SphereGeometry(0.1, 8, 6));
    for (let t = 0; t < 2; t++) {
      const tx = -0.22 + t * 0.44;
      const tray = new THREE.Mesh(G(new THREE.BoxGeometry(0.38, 0.06, 0.36)), trayM);
      tray.position.set(tx, 0.81, 0);
      table.add(tray);
      const ice = new THREE.Mesh(G(new THREE.BoxGeometry(0.34, 0.02, 0.32)), iceM);
      ice.position.set(tx, 0.845, 0);
      table.add(ice);
      for (let f = 0; f < 3; f++) {
        const fish = new THREE.Mesh(fishG, fishM);
        fish.scale.set(0.45, 0.3, 1.5);
        fish.position.set(tx - 0.11 + f * 0.11, 0.87, (f % 2) * 0.03 - 0.015);
        fish.rotation.y = 0.15 * (f - 1);
        table.add(fish);
      }
    }
    // 아이스박스(왼쪽) · 의자(오른쪽) · 낚싯대 진열(뒤 오른쪽)
    const box = new THREE.Group();
    box.position.set(-0.74, 0, 0.0);
    box.rotation.y = 0.3;
    stall.add(box);
    const coolerBody = new THREE.Mesh(G(new THREE.BoxGeometry(0.56, 0.36, 0.38)), M(new THREE.MeshStandardMaterial({ color: '#f0f0ea', roughness: 0.4 })));
    coolerBody.position.y = 0.18;
    coolerBody.castShadow = true;
    const coolerLid = new THREE.Mesh(G(new THREE.BoxGeometry(0.58, 0.07, 0.4)), M(new THREE.MeshStandardMaterial({ color: '#2a72c8', roughness: 0.4 })));
    coolerLid.position.y = 0.395;
    box.add(coolerBody, coolerLid);
    const stool = new THREE.Mesh(G(new THREE.CylinderGeometry(0.17, 0.15, 0.42, 10).translate(0, 0.21, 0)), M(new THREE.MeshStandardMaterial({ color: '#d8a030', roughness: 0.6 })));
    stool.position.set(0.68, 0, -0.18);
    stall.add(stool);
    const rodG = G(new THREE.CylinderGeometry(0.008, 0.015, 2.1, 5).translate(0, 1.05, 0));
    const rodM = M(new THREE.MeshStandardMaterial({ color: '#1e2a3a', roughness: 0.4 }));
    for (let r = 0; r < 3; r++) {
      const rod = new THREE.Mesh(rodG, rodM);
      rod.position.set(0.7 + r * 0.07, 0, 0.62);
      rod.rotation.z = 0.08 + r * 0.03;   // 원 안쪽으로 기댄다
      stall.add(rod);
    }
    // 등(밤에 켠다)
    lanternM = M(new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffc070', emissiveIntensity: 0.1, roughness: 0.5 }));
    const lantern = new THREE.Mesh(G(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8)), lanternM);
    lantern.position.set(0.0, 1.8, -0.35);
    stall.add(lantern);
    const cord = new THREE.Mesh(G(new THREE.CylinderGeometry(0.004, 0.004, 0.32, 3)), metal);
    cord.position.set(0.0, 2.0, -0.35);
    stall.add(cord);
  }

  const applyQuality = (qname) => {
    const c = COUNTS[qname] || COUNTS.medium;
    for (const it of instanced) {
      if (it.key === 'reeds') it.mesh.count = Math.min(it.max, c.reeds);
      else if (it.key === 'pebbles') it.mesh.count = Math.min(it.max, c.pebbles);
      else if (it.key === 'grass') it.mesh.count = Math.min(it.max, c.grass);
      else if (it.key === 'pines' || it.key === 'broad') it.mesh.count = Math.min(it.max, Math.round(it.max * c.trees / treeTotal));
    }
  };
  applyQuality(args.quality);

  return {
    group,
    update(env, dt) {
      void dt;
      uTime.value = env.time;
      if (lanternM) lanternM.emissiveIntensity = env.night ? 2.2 : env.light < 0.55 ? 0.9 : 0.1;
    },
    setQuality(qname) { applyQuality(qname); },
    dispose() {
      for (const it of instanced) it.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
