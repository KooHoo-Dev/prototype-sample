// OWNER: P12 — 내부 파일 · 컬럼비아 협곡의 건너편: 현무암 주상 절리 절벽 띠(끊기며 이어진다) · 절벽을 타고 내리는 가는 폭포(멀트노마식) ·
// 비탈의 더글러스전나무 숲. 원경이라 장면 안개를 상한까지만 먹는다(「호수처럼 보이면 실패」 — 강폭 너머 절벽이 읽혀야 한다).
// 절벽은 WorldLayer 지형(farBankZ 너머로 오르는 비탈) 앞에 선 벽 — 위에서는 지형이 이어 보인다. three 만.

import * as THREE from 'three';
import { dataTexture, fogFragCapped, hazedStandard, makeRand, noiseGrid } from './kit.js';

const CLIFF_HAZE = 0.4;
const FOREST_HAZE = 0.46;
const X_RANGE = [-620, 640];
const STEP = 6;                       // m — 절벽 띠 표본 간격
const CLIFF_BACK = 7;                 // m — farBankZ 에서 절벽 밑동까지
const FOREST = { low: 700, medium: 1400, high: 2200 };
const FOREST_MAX = 2200;

const FALL_VERT = /* glsl */`
varying vec2 vUv;
${'#include <fog_pars_vertex>'}
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${'#include <fog_vertex>'}
}`;
const FALL_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
${'#include <fog_pars_fragment>'}
void main() {
  float n = texture2D(uNoise, vec2(vUv.x * 1.5, vUv.y * 2.0 + uTime * 0.35)).r;
  float edge = 1.0 - smoothstep(0.25, 0.5, abs(vUv.x - 0.5));
  float a = edge * (0.45 + 0.55 * smoothstep(0.3, 0.7, n)) * (0.55 + 0.45 * (1.0 - vUv.y));
  gl_FragColor = vec4(uColor, a);
  ${fogFragCapped(CLIFF_HAZE)}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {{stage:import('../../../types.js').StageDef, heightAt:(x:number, z:number)=>number, quality:'low'|'medium'|'high'}} args
 */
export function buildCanyon({ stage, heightAt, quality }) {
  const group = new THREE.Group();
  group.name = 'canyon';
  const geos = [];
  const mats = [];
  const texs = [];
  const farZ = typeof stage.look.ridge.farBankZ === 'number' ? stage.look.ridge.farBankZ : -260;
  const rand = makeRand(3737);
  const nA = noiseGrid(0, 41, 14);
  const nB = noiseGrid(0, 42, 40);
  const span = X_RANGE[1] - X_RANGE[0];

  // 현무암 텍스처: 세로 주상 절리 + 가로 띠(용암층) + 이끼
  const basalt = (() => {
    const nn = noiseGrid(0, 43, 16);
    const fine = noiseGrid(0, 44, 64);
    return dataTexture(128, 128, (u, v, o) => {
      const col = Math.floor(u * 22);
      const colShade = 0.75 + 0.25 * ((col * 37) % 11) / 10;
      const seam = Math.abs(u * 22 - col - 0.5) > 0.44 ? 0.55 : 1;
      const band = 0.85 + 0.15 * Math.sin(v * Math.PI * 6 + nn(u, v) * 2);
      const moss = Math.max(0, nn(u * 0.7, v) - 0.55) * 2.2;
      const f = 0.85 + 0.3 * fine(u, v);
      const g = colShade * seam * band * f;
      o[0] = Math.round(Math.min(255, (235 * g) * (1 - moss) + 150 * moss));
      o[1] = Math.round(Math.min(255, (230 * g) * (1 - moss) + 205 * moss));
      o[2] = Math.round(Math.min(255, (222 * g) * (1 - moss) + 120 * moss));
    });
  })();
  texs.push(basalt);

  // ── 절벽 띠(구간마다 끊긴다): 밑의 너덜(초록 섞인 비탈) → 절벽 밑동 → 기울어 선 현무암 기둥 → 위의 숲 턱
  const pos = [];
  const uv = [];
  const colors = [];
  const idx = [];
  const tops = [];                 // 폭포 후보 {x, z, h}
  const ROW = 5;
  const cTalus = new THREE.Color('#4b5236');
  const cFoot = new THREE.Color('#57524a');
  const cRock = new THREE.Color('#4e4842');
  const cRockHi = new THREE.Color('#6a6156');
  const cTop = new THREE.Color('#33452c');
  const cv = new THREE.Color();
  const cv2 = new THREE.Color();
  let prev = -1;
  let k = 0;
  for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += STEP, k++) {
    const u = (x - X_RANGE[0]) / span;
    const on = nA(u, 0.3) > 0.42;
    const taper = Math.min(1, Math.max(0, (nA(u, 0.3) - 0.42) / 0.12));
    const jz = (rand() - 0.5) * 5;
    const zb = farZ - CLIFF_BACK - nB(u, 0.6) * 14 + jz;
    const step = (k % 3 === 0 ? 5 : k % 3 === 1 ? 0 : 2.5) * rand();          // 기둥 끝이 계단처럼
    const h = on ? (26 + 58 * nA(u, 0.8) + step) * taper : 0;
    if (!on) { prev = -1; continue; }
    const base = pos.length / 3;
    const lean = 4 + 6 * nB(u, 0.1) + (rand() - 0.5) * 2;
    const foot = h * (0.12 + 0.1 * rand());
    const back = Math.max(h - 5, Math.min(h + 8, heightAt(x, zb - lean - 26)));
    // 구간 끝(taper < 1)에서는 모든 줄이 그 자리 지형으로 내려앉는다 — 띠 끝 단면이 허공에 서지 않게
    const rows = [[-3, zb + 12], [foot, zb], [h * 0.55, zb - lean * 0.45 + (rand() - 0.5) * 2], [h, zb - lean], [back, zb - lean - 26]];
    for (const [ry, rz] of rows) {
      const ground = Math.min(ry, heightAt(x, rz));
      pos.push(x, ground + (ry - ground) * taper, rz);
    }
    const vU = x / 60;
    uv.push(vU, 0, vU, (foot + 3) / 26, vU, (h * 0.55 + 3) / 26, vU, (h + 3) / 26, vU, (h + 3) / 26 + 1);
    const shade = (k % 2 ? 0.72 : 1.0) * (0.75 + 0.5 * rand());          // 기둥마다 밝기가 갈린다
    for (const c of [cTalus, cFoot, cv.copy(cRock).lerp(cRockHi, rand() * 0.6), cv2.copy(cRock).lerp(cTop, 0.35), cTop]) {
      colors.push(c.r * shade, c.g * shade, c.b * shade);
    }
    if (prev >= 0) {
      for (let r = 0; r < ROW - 1; r++) idx.push(prev + r, base + r, prev + r + 1, prev + r + 1, base + r, base + r + 1);
    }
    prev = base;
    if (h > 55) tops.push({ x, h, zb, lean, foot });
  }
  const cliffGeo = new THREE.BufferGeometry();
  cliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cliffGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cliffGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  cliffGeo.setIndex(idx);
  cliffGeo.computeVertexNormals();
  cliffGeo.computeBoundingSphere();
  geos.push(cliffGeo);
  const cliffMat = hazedStandard({ map: basalt, vertexColors: true, color: '#ffffff', roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide }, CLIFF_HAZE);
  mats.push(cliffMat);
  const cliffs = new THREE.Mesh(cliffGeo, cliffMat);
  cliffs.name = 'canyonCliffs';
  cliffs.receiveShadow = true;
  group.add(cliffs);

  // ── 폭포(높은 절벽 몇 곳)
  const fallNoise = (() => {
    const n = noiseGrid(0, 45, 12);
    return dataTexture(32, 64, (u, v, o) => { const val = Math.round(n(u, v) * 255); o[0] = val; o[1] = val; o[2] = val; }, { srgb: false });
  })();
  texs.push(fallNoise);
  const fallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNoise: { value: null }, uTime: { value: 0 }, uColor: { value: new THREE.Color('#eef2f2') } }]),
    vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  });
  fallMat.uniforms.uNoise.value = fallNoise;
  mats.push(fallMat);
  const picks = [];
  for (const t of tops) if (!picks.some(p => Math.abs(p.x - t.x) < 180) && picks.length < 3) picks.push(t);
  for (const t of picks) {
    const w = 4 + rand() * 3;
    const y0 = t.foot * 0.9;
    const g = new THREE.PlaneGeometry(w, t.h - y0, 1, 8);
    g.translate(0, (t.h + y0) / 2, 0);
    // 절벽 면(기울어 선)을 따라 1m 앞에 붙는다 — 아래로 갈수록 살짝 떨어져 나온다
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const f = (y - t.foot) / Math.max(1, t.h - t.foot);
      p.setZ(i, t.zb - t.lean * Math.max(0, f) + 1.0 + (1 - Math.max(0, f)) * 1.5);
    }
    g.translate(t.x, 0, 0);
    g.computeVertexNormals();
    geos.push(g);
    const m = new THREE.Mesh(g, fallMat);
    m.name = 'waterfall';
    m.renderOrder = 3;
    group.add(m);
  }

  // ── 건너편 비탈의 전나무 숲(인스턴스)
  const treeGeo = new THREE.ConeGeometry(1, 1, 6);
  treeGeo.translate(0, 0.5, 0);
  geos.push(treeGeo);
  const treeMat = hazedStandard({ color: '#ffffff', roughness: 0.95, flatShading: true }, FOREST_HAZE);
  mats.push(treeMat);
  const forest = new THREE.InstancedMesh(treeGeo, treeMat, FOREST_MAX);
  forest.name = 'farForest';
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const dark = new THREE.Color('#1f3424');
  const light = new THREE.Color('#3e5a36');
  let n = 0;
  for (let k = 0; k < FOREST_MAX * 6 && n < FOREST_MAX; k++) {
    const x = X_RANGE[0] + rand() * span;
    const z = farZ - 8 - Math.pow(rand(), 1.2) * 260;
    const y = heightAt(x, z);
    if (!(y > 4)) continue;
    const h = 13 + rand() * 14;
    p.set(x, y - 1, z);
    s.set(h * (0.2 + rand() * 0.06), h, h * 0.24);
    m4.compose(p, q, s);
    forest.setMatrixAt(n, m4);
    forest.setColorAt(n, c.copy(dark).lerp(light, rand()));
    n++;
  }
  const forestMax = n;
  forest.count = Math.min(forestMax, FOREST[quality] ?? FOREST.medium);
  forest.instanceMatrix.needsUpdate = true;
  if (forest.instanceColor) forest.instanceColor.needsUpdate = true;
  forest.computeBoundingSphere();
  group.add(forest);

  const fallBase = new THREE.Color('#eef2f2');
  return {
    group,
    /** @param {{time:number, light:number}} env */
    update(env) {
      fallMat.uniforms.uTime.value = env.time;
      fallMat.uniforms.uColor.value.copy(fallBase).multiplyScalar(0.18 + 0.82 * Math.max(0.1, Math.min(1, env.light)));
    },
    setQuality(qn) { forest.count = Math.min(forestMax, FOREST[qn] ?? FOREST.medium); },
    dispose() {
      forest.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
