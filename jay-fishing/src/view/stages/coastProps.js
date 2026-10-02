// OWNER: P11 — 계약 §9.4 · §8.3 · §7.4.3
// 갯바위(조가사키 해안 · 이즈)의 개성: 검은 용암 암반(각진 저폴리 덩어리 — 물에 젖은 띠 · 해조 띠) · 부서지는 파도 거품과 물보라 ·
// 해안 절벽(양옆 곶 · 뒤쪽 암벽) · 등대(look.lighthouse — 바위섬 위 · 밤에 회전하는 빛줄기) · 어판장 트럭(판매상 obstacles 원 안) ·
// 소나무(곰솔 — 기울어진 줄기 · 납작한 잎 덩어리) · 수평선의 이즈 오시마 실루엣.
// 배치 규칙(§9.4): 걷는 영역(walk) 안에서 0.5m 넘는 것은 obstacles 원 안에만 · 낚시 자리의 facing ± arc · 60m 수면 시야를 가리지 않는다 ·
// 그리고 찌가 흘러갈 수 있는 물(흐름 쪽으로 driftArc · maxDriftM)에 바위를 두지 않는다 — 흘린 찌가 바위를 뚫고 지나가지 않게.
// three 만 — Node 에서도 만들어진다(절차 텍스처는 DataTexture). 개수는 화질로 InstancedMesh.count 만 바꾼다(지오메트리가 늘지 않는다).
// 빛을 더하지 않는다(빛 개수 고정 — 밤의 등대 · 전구는 emissive 와 가산 혼합 메시로).

import * as THREE from 'three';
import { angleDiff, clamp, pointInConvex, shoreZAt, smoothstep, yawOf } from '../../core/math.js';
import { BITE, CAST } from '../../data/bite.js';

/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:string, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv */
/** @typedef {import('../../types.js').StageDef} StageDef */

// ── 연출 상수
const SEED = 7351;
const COUNTS = {
  low: { slabs: 400, pebbles: 300, grass: 300, pines: 90, foam: 80, spray: 12 },
  medium: { slabs: 800, pebbles: 700, grass: 800, pines: 160, foam: 150, spray: 24 },
  high: { slabs: 1200, pebbles: 1200, grass: 1500, pines: 240, foam: 230, spray: 36 },
};
const VIEW_RANGE = 62;         // m — 낚시 자리 수면 시야(60m) + 여유
const VIEW_PAD = 0.14;         // rad — facing ± arc 바깥 여유
const STAND_CLEAR = 3.2;       // m — 설 자리 둘레는 비운다
const DRIFT_PAD_M = 2;         // m — 흘림 최대 거리 너머 여유
const DRIFT_PAD_RAD = 0.1;
const LOW_MAX = 0.4;
const FOOT_REACH = 1.6;        // 바위 반경 r → 수평 도달 상한(정점 반경 1.1r × 회전한 상자 √2) — 판정은 넉넉히           // m — 걷는 영역 안 소품의 최대 높이(규칙 0.5m 보다 여유)
const ROCK_COLOR = '#ffffff';     // 색은 인스턴스 색(ROCK_TINTS × 밝기) × 면 색
const ROCK_TINTS = ['#3a3734', '#46403a', '#33302d', '#4c4640', '#3e3c3a', '#54463c'];
const WET_DARK = 0.6;          // 젖은 바위 밝기 배율
const ROCK_HIDE_BELOW = 0.8;   // m — 화면 패스: 이 깊이보다 깊은 바위 몸통은
const ROCK_HIDE_FROM = 30;     // m — 카메라에서 이만큼 먼 것부터 그리지 않는다(물 너머 「옅은 기둥」)
const ALGAE = '#2e3a22';
const FOAM_LIFT = 0.07;        // m — 거품 판의 수면 위 높이
const SPRAY_ALPHA = 0.6;        // 화면 패스: 물보라 최대 불투명도(0.8 → 0.6 · 계약 §9.9 「0.8 이하」)
const SPRAY_FAR = [28, 70];     // m — 이 거리에서 물보라가 옅어지기 시작해 끝난다
const SPRAY_FAR_CUT = 0.7;      // 먼 끝에서 빼는 비율(0.7 → 30% 만 남는다)
const BEAM_SPEED = 0.55;       // rad/s — 등대 빛줄기 회전
const BEAM_LEN = 75;
const BEAM_NEAR = [10, 30];     // m — 카메라에서 이 거리 안의 빛줄기는 사라진다(머리 위를 쓸고 지나갈 때 화면을 덮지 않게)
const LIGHTHOUSE_H = 14;
const ISLAND = { x: -700, z: -1900, w: 760, h: 78, d: 260 };   // 이즈 오시마(수평선의 실루엣)
const ISLAND_BASE = '#4a5866';
const SEA_STACKS = [[-48, -168, 15], [22, -190, 11], [82, -146, 18], [150, -112, 9], [-150, -175, 12]];   // (x, z, 꼭대기 m)

// ── 결정적 난수 · 해시(배치용 — Math.random 을 쓰지 않는다)
function makeRand(seed) {
  let s = (seed | 0) ^ 0x6d2b79f5;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── 배치 판정(P5 placement.js 의 규칙을 베꼈다 — 다른 레이어 내부 파일을 import 하지 않는다)
/** 낚시 자리에서 facing ± arc · 60m 안의 수면 시야(또는 설 자리 둘레)인가 */
function inSpotView(stage, x, z) {
  for (const sp of stage.spots) {
    const dx = x - sp.stand.x;
    const dz = z - sp.stand.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < STAND_CLEAR * STAND_CLEAR) return true;
    if (d2 > VIEW_RANGE * VIEW_RANGE) continue;
    if (Math.abs(angleDiff(sp.facing, yawOf(dx, dz))) < sp.arc + VIEW_PAD) return true;
  }
  return false;
}
/** 찌 · 봉돌이 흘러갈 수 있는 물인가 — 캐스팅 부채꼴에서 흐름 쪽으로 driftArc 까지 · maxDriftM 안(§5.2 updateDrift 의 경계) */
function inDriftWater(stage, x, z) {
  if (z >= shoreZAt(stage.shore, x)) return false;
  for (const sp of stage.spots) {
    const dx = x - sp.stand.x;
    const dz = z - sp.stand.z;
    const d = Math.hypot(dx, dz);
    if (d > sp.maxDriftM + DRIFT_PAD_M) continue;
    const rel = angleDiff(sp.facing, yawOf(dx, dz));
    let lo = -(sp.arc + VIEW_PAD);
    let hi = sp.arc + VIEW_PAD;
    const fl = Math.hypot(sp.flow.x, sp.flow.z);
    if (fl > 1e-6) {
      const side = angleDiff(sp.facing, yawOf(sp.flow.x, sp.flow.z));
      const ext = CAST.driftArc + DRIFT_PAD_RAD;
      if (side < 0) lo = -ext; else hi = ext;
    }
    if (rel >= lo && rel <= hi) return true;
  }
  return false;
}
/** 낚시를 가리거나 흘림 길을 막는가(원 둘레 8점 + 중심) */
function blocksFishing(stage, x, z, r) {
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = i === 8 ? x : x + Math.cos(a) * r;
    const pz = i === 8 ? z : z + Math.sin(a) * r;
    if (inSpotView(stage, px, pz) || inDriftWater(stage, px, pz)) return true;
  }
  return false;
}
function inWalk(stage, x, z) { return pointInConvex(stage.walk, x, z); }
function inObstacle(stage, x, z, pad = 0) {
  for (const o of stage.obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const rr = o.r - pad;
    if (rr > 0 && dx * dx + dz * dz <= rr * rr) return true;
  }
  return false;
}
/** 높이 0.5m 를 넘는 것을 (x, z)에 반경 r 로 둬도 되는가 — 걷는 영역 밖이거나 obstacles 원 안 */
function tallAllowed(stage, x, z, r) {
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = i === 8 ? x : x + Math.cos(a) * r;
    const pz = i === 8 ? z : z + Math.sin(a) * r;
    if (inWalk(stage, px, pz) && !inObstacle(stage, px, pz)) return false;
  }
  return true;
}

// ── 지오메트리 도우미
/** 여러 지오메트리를 하나로(position · normal · color · uv 중 모두가 가진 것만) */
function mergeGeoms(list) {
  const flat = list.map(g => (g.index ? g.toNonIndexed() : g));
  const has = (k) => flat.every(g => !!g.attributes[k]);
  const keys = ['position', 'normal', 'color', 'uv'].filter(has);
  const out = new THREE.BufferGeometry();
  for (const k of keys) {
    const size = flat[0].attributes[k].itemSize;
    let n = 0;
    for (const g of flat) n += g.attributes[k].count;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of flat) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== list[i]) flat[i].dispose();
  if (!out.attributes.normal) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** 각진 용암 덩어리 — 깎인 면(평면 자르기) + 정점 흔들기 + 면마다 밝기(다공질 현무암) */
function lavaRockGeometry(seed, opts = {}) {
  const { cuts = 4, topCut = 0.55, squash = 1, detail = 1 } = opts;
  const rand = makeRand(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    const th = rand() * Math.PI * 2;
    const ph = (rand() - 0.35) * Math.PI * 0.8;
    planes.push([Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th), 0.55 + rand() * 0.3]);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.78 + 0.42 * hash3(Math.round(v.x * 1000), Math.round(v.y * 1000), Math.round(v.z * 1000), seed);
    v.multiplyScalar(k);
    for (const [nx, ny, nz, d] of planes) {
      const dd = v.x * nx + v.y * ny + v.z * nz;
      if (dd > d) { v.x -= nx * (dd - d); v.y -= ny * (dd - d); v.z -= nz * (dd - d); }
    }
    if (v.y > topCut) v.y = topCut + (v.y - topCut) * 0.25;
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();     // 색인 없는 지오메트리 — 면 법선(각진 면)
  const col = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count / 3; f++) {
    const b = 0.72 + 0.5 * rand();
    const warm = rand() < 0.18 ? 1.12 : 1;      // 군데군데 붉은 기(산화된 스코리아)
    for (let k = 0; k < 3; k++) {
      col[(f * 3 + k) * 3] = b * warm;
      col[(f * 3 + k) * 3 + 1] = b;
      col[(f * 3 + k) * 3 + 2] = b * (warm > 1 ? 0.92 : 1);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** 거품 레이스 텍스처(RGBA — 흰색 · 구멍 난 알파) */
function foamTexture(size, seed, soft) {
  const data = new Uint8Array(size * size * 4);
  const cell = (ix, iz) => hash3(ix, iz, 0, seed);
  const vnoise = (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = cell(ix, iz);
    const b = cell(ix + 1, iz);
    const c = cell(ix, iz + 1);
    const d = cell(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / (size - 1) * 2 - 1;
      const w = j / (size - 1) * 2 - 1;
      const r = Math.hypot(u, w);
      const n = vnoise(i * 0.18, j * 0.18) * 0.6 + vnoise(i * 0.45, j * 0.45) * 0.4;
      const edge = 1 - smoothstep(0.55, 1.0, r + (n - 0.5) * 0.5);
      const lace = soft ? 0.55 + 0.45 * n : smoothstep(0.38, 0.62, n);
      const a = clamp(edge * lace, 0, 1);
      const o = (j * size + i) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 젖은 띠 · 해조 띠 · 비에 젖음을 더한 바위 재질(월드 높이로) */
function rockMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: ROCK_COLOR, vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRainWet = uniforms.uRainWet;
    sh.vertexShader = 'varying float vWY;\nvarying float vRockD;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 cwp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cwp = instanceMatrix * cwp;
#endif
  vWY = (modelMatrix * cwp).y;`).replace('#include <project_vertex>', `#include <project_vertex>
  vRockD = -mvPosition.z;`);
    // 화면 패스: 먼 바위의 깊은 물속 몸통은 그리지 않는다 — 바다 바닥(−20m 안팎)까지 뻗은 시 스택 · 바위 몸통이 안개를 먹은 밝은 색으로
    //   반투명 물 너머에 비쳐 수평선 근처에 「옅은 세로 기둥」이 섰다(NOTES-W2 #3 — 물보라가 아니었다). 가까운 바위(맑은 얕은 물)는 그대로.
    sh.fragmentShader = 'varying float vWY;\nvarying float vRockD;\nuniform float uRainWet;\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vWY < ${(-ROCK_HIDE_BELOW).toFixed(2)} && vRockD > ${ROCK_HIDE_FROM.toFixed(1)}) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float cWet = max(1.0 - smoothstep(-0.05, 0.75, vWY), uRainWet * 0.7);
  float cAlgae = smoothstep(-0.7, -0.2, vWY) * (1.0 - smoothstep(0.0, 0.4, vWY));
  diffuseColor.rgb = mix(diffuseColor.rgb, ${glslColor(ALGAE)}, cAlgae * 0.55);
  diffuseColor.rgb *= mix(1.0, ${WET_DARK.toFixed(2)}, cWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.38, cWet);`);
  };
  m.customProgramCacheKey = () => 'coastLavaRock';
  return m;
}
function glslColor(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/** 파도 주기로 번지고 사라지는 거품 · 물보라(인스턴스 위치로 위상) */
function surgeMaterial(tex, uniforms, kind) {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#ffffff', side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uPeriod = uniforms.uPeriod;
    sh.uniforms.uAmt = uniforms.uAmt;
    const grow = kind === 'spray'
      ? 'transformed.y *= 0.15 + 1.05 * sk; transformed.xz *= 0.55 + 0.75 * sk;'
      : 'transformed.xz *= 0.7 + 0.55 * sk;';
    sh.vertexShader = 'uniform float uTime;\nuniform float uPeriod;\nvarying float vK;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float sph = fract(instanceMatrix[3][0] * 0.0731 + instanceMatrix[3][2] * 0.0517);
#else
  float sph = 0.0;
#endif
  float sk = fract(uTime / max(uPeriod, 0.5) * ${kind === 'spray' ? '0.5' : '1.0'} + sph);
  vK = sk;
  ${grow}`);
    if (kind === 'spray') {
      sh.vertexShader = 'varying float vCamD;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vCamD = -mvPosition.z;`);
    }
    // 화면 패스: 물보라는 위로 갈수록 옅고(솟구친 끝이 흩어진다) 멀수록 옅다 — 전에는 고른 알파의 세로 타원이 40–60m 에서 「옅은 기둥」으로 읽혔다
    const fade = kind === 'spray'
      ? `smoothstep(0.0, 0.05, vK) * (1.0 - smoothstep(0.1, 0.45, vK)) * ${SPRAY_ALPHA.toFixed(3)} * (1.0 - 0.75 * smoothstep(0.2, 0.95, vMapUv.y)) * (1.0 - ${SPRAY_FAR_CUT.toFixed(3)} * smoothstep(${SPRAY_FAR[0].toFixed(1)}, ${SPRAY_FAR[1].toFixed(1)}, vCamD))`
      : 'smoothstep(0.0, 0.12, vK) * (1.0 - smoothstep(0.3, 1.0, vK))';
    sh.fragmentShader = 'uniform float uAmt;\nvarying float vK;\n' + (kind === 'spray' ? 'varying float vCamD;\n' : '') + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.a *= ${fade} * uAmt;`);
  };
  m.customProgramCacheKey = () => `coastSurge_${kind}`;
  return m;
}

/** 바람에 흔들리는 풀(높이의 제곱만큼) */
function swayMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float gph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.23;
#else
  float gph = 0.0;
#endif
  float gsw = sin(uTime * 1.7 + gph) + 0.4 * sin(uTime * 3.3 + gph * 1.7);
  transformed.x += gsw * 0.35 * transformed.y * transformed.y;
  transformed.z += gsw * 0.18 * transformed.y * transformed.y;`);
  };
  m.customProgramCacheKey = () => 'coastGrassSway';
  return m;
}

/**
 * @param {{stage:StageDef, quality:'low'|'medium'|'high', heightAt:(x:number, z:number) => number}} args
 * @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q:'low'|'medium'|'high'):void, dispose():void}}
 */
export function buildCoastProps(args) {
  const { stage, heightAt } = args;
  const look = /** @type {any} */ (stage.look || {});
  const group = new THREE.Group();
  group.name = 'props:coast';
  /** @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** @type {THREE.Material[]} */
  const mats = [];
  /** @type {THREE.Texture[]} */
  const texs = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const rand = makeRand(SEED);
  const shoreZ = (x) => shoreZAt(stage.shore, x);
  const uni = {
    uTime: { value: 0 },
    uPeriod: { value: stage.waves.period || 6 },
    uAmt: { value: 1 },
    uRainWet: { value: 0 },
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  /** @type {Array<{mesh:THREE.InstancedMesh, max:number, key:string|null}>} */
  const instanced = [];

  /**
   * @param {THREE.BufferGeometry} geo @param {THREE.Material} mat
   * @param {Array<any>} list  각 항목: {x, y, z, rx, ry, rz, sx, sy, sz, c?}
   * @param {string|null} key  화질로 개수를 바꾸는 묶음(null 이면 고정)
   */
  const makeInst = (geo, mat, list, key, name, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.name = name;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      p.set(r.x, r.y, r.z);
      e.set(r.rx || 0, r.ry || 0, r.rz || 0);
      q.setFromEuler(e);
      s.set(r.sx, r.sy, r.sz);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      if (r.c) { col.set(r.c); if (r.b) col.multiplyScalar(r.b); im.setColorAt(i, col); }
    }
    im.count = list.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow;
    im.receiveShadow = true;
    group.add(im);
    instanced.push({ mesh: im, max: list.length, key });
    return im;
  };

  // ════════ 용암 암반 ════════
  const rockMat = M(rockMaterial(uni));
  const rockGeos = [
    G(lavaRockGeometry(101, { cuts: 4, topCut: 0.5 })),
    G(lavaRockGeometry(202, { cuts: 5, topCut: 0.62 })),
    G(lavaRockGeometry(303, { cuts: 3, topCut: 0.45, squash: 0.9 })),
    G(lavaRockGeometry(404, { cuts: 6, topCut: 0.7 })),
  ];
  /** @type {Array<any>[]} */
  const rockLists = rockGeos.map(() => []);
  /** 바위 하나 — 바닥(bed)부터 top 까지 · 반경 r. 반환: 놓았는가 */
  const rockHalfXZ = 1.25;      // 단위 지오메트리의 수평 반경 상한(흔들기 1.2 · 자르기 뒤)
  const pushRock = (x, z, r, top, opts = {}) => {
    const bed = heightAt(x, z);
    const base = Math.min(bed, opts.water ? bed : bed - 0.2) - (opts.sink ?? 0.4);
    if (top <= base + 0.1) return false;
    const sy = (top - base) / 2;
    const lean = opts.lean ?? 0.12;
    const v = Math.floor(rand() * rockGeos.length);
    rockLists[v].push({
      x, y: base + sy * 0.92, z,
      rx: (rand() - 0.5) * lean, ry: rand() * Math.PI * 2, rz: (rand() - 0.5) * lean,
      sx: r / rockHalfXZ * (0.85 + rand() * 0.3), sy, sz: r / rockHalfXZ * (0.85 + rand() * 0.3),
      c: ROCK_TINTS[Math.floor(rand() * ROCK_TINTS.length)], b: 0.85 + rand() * 0.35,
    });
    return true;
  };
  /** 거품 · 물보라를 붙일 바닷가 바위(바다 쪽 둘레) */
  const surfAnchors = [];
  const sprayAnchors = [];

  /** 큰 바위: 낚시를 가리지 않고 걷는 영역 밖이어야 놓는다 */
  const tryBig = (x, z, r, top, opts = {}) => {
    const R = r * FOOT_REACH;
    if (blocksFishing(stage, x, z, R)) return false;
    if (!tallAllowed(stage, x, z, R)) return false;
    const water = z < shoreZ(x) - 0.5;
    if (!pushRock(x, z, r, top, { ...opts, water })) return false;
    if (water || z - r < shoreZ(x)) {
      surfAnchors.push({ x, z, r });
      if (top > 1.2) sprayAnchors.push({ x, z, r });
    }
    return true;
  };

  /** 꺾은선을 따라 바위를 늘어놓는다(곶 · 절벽) — heightFn(t 0..1) */
  const alongLine = (pts, step, rMin, rMax, heightFn, jitter) => {
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(L);
      total += L;
    }
    for (let d = 0; d <= total; d += step) {
      let acc = 0;
      let i = 0;
      while (i < segs.length - 1 && acc + segs[i] < d) { acc += segs[i]; i++; }
      const u = clamp((d - acc) / segs[i], 0, 1);
      const x0 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u;
      const z0 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u;
      const t = d / total;
      for (let k = 0; k < 3; k++) {
        const r = rMin + rand() * (rMax - rMin);
        const x = x0 + (rand() - 0.5) * jitter;
        const z = z0 + (rand() - 0.5) * jitter;
        const top = heightFn(t) * (0.65 + rand() * 0.5) * (k === 0 ? 1 : 0.6);
        tryBig(x, z, k === 0 ? r : r * 0.6, top);
      }
    }
  };

  // 왼쪽 곶(서쪽 — 바다로 길게 뻗은 용암 줄기 · 끝은 낮아진다)
  alongLine([[-54, 2], [-62, -10], [-72, -24], [-84, -38], [-97, -57], [-107, -80], [-113, -106], [-117, -132]],
    5.5, 4, 8.5, (t) => 5 + 11 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.85), 6);
  // 오른쪽 곶 줄기(등대 바위섬으로 이어진다)
  alongLine([[150, 6], [142, -8], [137, -22], [131, -34], [127, -44]], 5, 3.5, 7, (t) => 9 - 4 * t, 4);
  // 등대 바위섬
  const lh = look.lighthouse || { x: 120, z: -40 };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = lh.x + Math.cos(a) * (3 + rand() * 3) + 2.5;
    const z = lh.z + Math.sin(a) * (3 + rand() * 3) - 2.5;
    tryBig(x, z, 3.2 + rand() * 2.4, 3 + rand() * 2.5);    // 자리 쪽(흘림 물길) 바위는 tryBig 이 거른다 — 먼 쪽 반만 남는다
  }
  // 먼바다의 바위섬(시 스택 — 낚시 자리의 시야 · 흘림 물길 너머)
  for (const [sx0, sz0, h] of SEA_STACKS) {
    if (!tryBig(sx0, sz0, 4 + rand() * 2.5, h, { lean: 0.08 })) continue;
    for (let k = 0; k < 5; k++) {
      const a = rand() * Math.PI * 2;
      const d = 5 + rand() * 7;
      tryBig(sx0 + Math.cos(a) * d, sz0 + Math.sin(a) * d, 1.5 + rand() * 2.5, 0.6 + rand() * h * 0.35, { lean: 0.3 });
    }
  }
  // 해안 절벽(양옆 — 걷는 영역 밖의 땅에서 물가까지)
  for (const side of [-1, 1]) {
    for (let x = 50; x <= 300; x += 7) {
      const wx = side * (x + (rand() - 0.5) * 4);
      const sz = shoreZ(wx);
      const far = smoothstep(50, 140, x);
      for (let k = 0; k < 2; k++) {
        const r = 3.5 + rand() * 4.5;
        const z = sz + r * 0.7 + k * (r * 1.3) + rand() * 3;
        tryBig(wx, z, r, heightAt(wx, z) + (4 + far * 12) * (0.6 + rand() * 0.6) * (k ? 1.2 : 1));
      }
    }
  }
  // 뒤쪽 암벽(걷는 영역 뒤 — 길 끝의 검은 바위 둔덕)
  for (let x = -70; x <= 70; x += 4.5) {
    const r = 2.2 + rand() * 2.8;
    const z = 31.5 + r + rand() * 6;
    const wx = x + (rand() - 0.5) * 3;
    tryBig(wx, z, r, heightAt(wx, z) + 2 + rand() * 4.5);
  }
  // 물가의 낮은 바위(자리 사이 · 반쯤 잠긴 덩어리 — 파도가 부서지는 곳)
  for (let i = 0, n = 0; i < 1400 && n < 70; i++) {
    const x = -160 + rand() * 320;
    const z = shoreZ(x) - (0.8 + Math.pow(rand(), 1.6) * 14);
    const r = 0.7 + rand() * 2.0;
    if (tryBig(x, z, r, 0.25 + rand() * 1.6, { lean: 0.3 })) n++;
  }
  // 물가 땅 쪽 바위(걷는 영역 밖 · 해안선 바로 뒤 — 0.5m 넘어도 되는 곳만)
  for (let i = 0, n = 0; i < 1600 && n < 90; i++) {
    const x = -200 + rand() * 400;
    const z = shoreZ(x) + rand() * 6;
    const r = 0.6 + rand() * 1.8;
    if (tryBig(x, z, r, heightAt(x, z) + 0.4 + rand() * 1.8, { lean: 0.35 })) n++;
  }
  rockGeos.forEach((g, i) => makeInst(g, rockMat, rockLists[i], null, `lavaRocks${i}`));

  // ── 땅에 박힌 용암 덩어리(걷는 영역 안은 꼭대기 0.4m 이하 · 밖은 더 크게)
  const slabs = [];
  const boulderGeo = rockGeos[2];
  const boulderTop = boulderGeo.boundingBox ? boulderGeo.boundingBox.max.y : 0.5;
  for (let i = 0; i < 9000 && slabs.length < COUNTS.high.slabs; i++) {
    const x = -90 + rand() * 180;
    const z = shoreZ(x) + 0.6 + Math.pow(rand(), 1.3) * 42;
    const r = 0.25 + Math.pow(rand(), 1.8) * 1.2;
    const R = r * FOOT_REACH * 3;   // 줄기는 반경의 3배까지 늘어난다(판정은 늘린 크기로)
    if (inSpotView(stage, x, z) || inObstacle(stage, x, z, -R - 0.4)) continue;
    const walkNear = !tallAllowed(stage, x, z, R);
    let gMin = heightAt(x, z);
    for (let k = 0; k < 8; k++) gMin = Math.min(gMin, heightAt(x + Math.cos(k * 0.785) * R, z + Math.sin(k * 0.785) * R));
    const h = walkNear ? Math.min(LOW_MAX - 0.02, 0.06 + rand() * r * 0.45) : 0.15 + rand() * r * 0.9;
    const sy = Math.max(h, r * (0.45 + rand() * 0.3));
    // 셋 중 하나는 바다 쪽으로 흘러내린 용암 줄기(길쭉 · 낮음 — 해안선에 거의 수직)
    const ridge = rand() < 0.33;
    const stretch = ridge ? 1.8 + rand() * 1.2 : 1;
    slabs.push({ x, y: gMin + h - sy * boulderTop, z, rx: (rand() - 0.5) * 0.08, ry: ridge ? Math.PI / 2 + (rand() - 0.5) * 0.7 : rand() * 6.28, rz: (rand() - 0.5) * 0.08,
      sx: r / rockHalfXZ * (0.9 + rand() * 0.4) * stretch, sy, sz: r / rockHalfXZ * (0.7 + rand() * 0.4), c: ROCK_TINTS[Math.floor(rand() * ROCK_TINTS.length)], b: 0.95 + rand() * 0.4 });
  }
  makeInst(boulderGeo, rockMat, slabs, 'slabs', 'lavaBoulders');

  // ── 스코리아 자갈(검붉은 작은 돌 — 해안 둘레)
  const pebbleGeo = G(new THREE.DodecahedronGeometry(0.08, 0));
  const pebbleMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }));
  const pebbles = [];
  for (let i = 0; i < COUNTS.high.pebbles; i++) {
    const x = -100 + rand() * 200;
    const z = shoreZ(x) + (-0.6 + Math.pow(rand(), 1.5) * 30);
    if (inSpotView(stage, x, z)) continue;
    const k = 0.5 + rand() * 1.6;
    const t = rand();
    pebbles.push({ x, y: heightAt(x, z) + 0.01, z, rx: rand() * 3, ry: rand() * 6.28, rz: 0, sx: k, sy: k * 0.55, sz: k * 0.8,
      c: t < 0.45 ? '#2a2624' : t < 0.75 ? '#4a3228' : t < 0.92 ? '#3e3a36' : '#5a4232' });
  }
  makeInst(pebbleGeo, pebbleMat, pebbles, 'pebbles', 'scoria', false);

  // ── 해안 풀(갯잔디 · 억새 포기 — 0.35m 이하)
  const grassParts = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.2 + (i % 3) * 0.06;
    const b = new THREE.ConeGeometry(0.025, h, 3, 1, true);
    b.translate(0, h / 2, 0);
    b.rotateZ((i - 3) * 0.2);
    b.rotateY(i * 0.9);
    grassParts.push(b);
  }
  const grassGeo = G(mergeGeoms(grassParts));
  for (const b of grassParts) b.dispose();
  const grassMat = M(swayMaterial(uni));
  const grass = [];
  const grassDry = new THREE.Color('#a49a58');
  for (let i = 0; i < 20000 && grass.length < COUNTS.high.grass; i++) {
    const x = -110 + rand() * 220;
    const z = shoreZ(x) + 3 + Math.pow(rand(), 1.2) * 70;
    if (inSpotView(stage, x, z) || inObstacle(stage, x, z, -0.6)) continue;
    // 걷는 영역 안은 드문드문(바위틈의 포기)
    if (inWalk(stage, x, z) && rand() < 0.65) continue;
    const k = 0.8 + rand() * 0.5;
    col.set('#5e6e32').lerp(grassDry, rand() * 0.75);
    grass.push({ x, y: heightAt(x, z) - 0.02, z, ry: rand() * 6.28, sx: k, sy: k, sz: k, c: '#' + col.getHexString() });
  }
  makeInst(grassGeo, grassMat, grass, 'grass', 'coastGrass', false);

  // ════════ 소나무(곰솔) ════════
  const trunkParts = [];
  {
    const segs = [[0, 0, 0.2, 0.16, 2.2, 0.0], [0.15, 2.1, 0.16, 0.12, 2.2, 0.22], [0.6, 4.1, 0.12, 0.08, 2.0, 0.38]];
    for (const [ox, oy, r0, r1, h, tilt] of segs) {
      const c = new THREE.CylinderGeometry(r1, r0, h, 6);
      c.translate(0, h / 2, 0);
      c.rotateZ(-tilt);
      c.translate(ox, oy, 0);
      trunkParts.push(c);
    }
    for (const [ox, oy, l, a] of [[0.35, 3.6, 1.4, 0.9], [0.9, 5.2, 1.2, -0.8], [0.5, 4.6, 1.0, 2.2]]) {
      const br = new THREE.CylinderGeometry(0.04, 0.07, l, 5);
      br.translate(0, l / 2, 0);
      br.rotateZ(-1.1);
      br.rotateY(a);
      br.translate(ox, oy, 0);
      trunkParts.push(br);
    }
  }
  const trunkGeo = G(mergeGeoms(trunkParts));
  for (const c of trunkParts) c.dispose();
  const crownParts = [];
  for (const [ox, oy, oz, r, sq] of [[1.2, 6.4, 0.2, 1.7, 0.42], [2.0, 5.3, -0.7, 1.25, 0.45], [-0.1, 4.6, 0.9, 1.15, 0.45], [2.3, 6.0, 1.1, 1.0, 0.5], [0.7, 7.0, -0.4, 1.1, 0.4], [1.6, 3.9, -1.2, 0.9, 0.5]]) {
    const ic = new THREE.IcosahedronGeometry(r, 0);
    ic.scale(1.25, sq, 1.1);
    ic.translate(ox, oy, oz);
    crownParts.push(ic);
  }
  const crownGeo = G(mergeGeoms(crownParts));
  for (const c of crownParts) c.dispose();
  const trunkMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }));
  const crownMat = M(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }));
  const pines = [];
  const crownLight = new THREE.Color('#3c5a34');
  const pineR = 2.8;           // 수관의 수평 반경(배율 1)
  /** @param {number} x @param {number} z @param {number} k @param {number} [baseY] */
  const tryPine = (x, z, k, baseY) => {
    const R = pineR * k;
    if (!tallAllowed(stage, x, z, R)) return false;
    if (blocksFishing(stage, x, z, R)) return false;
    if (z < shoreZ(x) + 1 && baseY === undefined) return false;
    const yaw = rand() * Math.PI * 2;
    col.set('#22381f').lerp(crownLight, rand());
    pines.push({ x, y: (baseY ?? heightAt(x, z)) - 0.15, z, rx: (rand() - 0.5) * 0.12, ry: yaw, rz: (rand() - 0.5) * 0.12,
      sx: k, sy: k * (0.9 + rand() * 0.3), sz: k, c: '#' + col.getHexString() });
    return true;
  };
  // 뒤쪽 숲 · 양옆 언덕
  for (let i = 0; i < 20000 && pines.length < COUNTS.high.pines; i++) {
    const back = rand() < 0.7;
    const x = back ? -150 + rand() * 300 : (rand() < 0.5 ? -1 : 1) * (52 + rand() * 180);
    const z = back ? 36 + Math.pow(rand(), 0.9) * 140 : shoreZ(x) + 8 + rand() * 120;
    tryPine(x, z, 0.85 + rand() * 0.75);
  }
  // 곶 위의 몇 그루(바위 꼭대기 — 바닷바람에 기운 곰솔)
  for (const list of rockLists) {
    for (const r of list) {
      if (pines.length >= COUNTS.high.pines + 24) break;
      const top = r.y + r.sy * 0.55;
      if (top < 6 || rand() > 0.35) continue;
      tryPine(r.x + (rand() - 0.5) * r.sx * 0.6, r.z + (rand() - 0.5) * r.sz * 0.6, 0.6 + rand() * 0.4, top);
    }
  }
  makeInst(trunkGeo, trunkMat, pines, 'pines', 'pineTrunks');
  makeInst(crownGeo, crownMat, pines, 'pines', 'pineCrowns');
  // 줄기 색은 따로(인스턴스 색이 수관 색이라 줄기는 고정 색)
  const trunkInst = instanced[instanced.length - 2].mesh;
  for (let i = 0; i < pines.length; i++) { col.set('#5a3e2c').multiplyScalar(0.85 + (i % 5) * 0.06); trunkInst.setColorAt(i, col); }
  if (trunkInst.instanceColor) trunkInst.instanceColor.needsUpdate = true;

  // ════════ 파도 거품 · 물보라 ════════
  const foamTex = foamTexture(64, 17, false);
  const sprayTex = foamTexture(32, 29, true);
  texs.push(foamTex, sprayTex);
  const foamGeo = G(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const foamMat = M(surgeMaterial(foamTex, uni, 'foam'));
  const foam = [];
  // 바위 둘레(바다 쪽) — 부서지는 파도
  const anchorCap = Math.round(COUNTS.high.foam * 0.75);
  for (const a of surfAnchors) {
    const n = 1 + Math.floor(a.r / 2.5);
    for (let k = 0; k < n && foam.length < anchorCap; k++) {
      const ang = -Math.PI / 2 + (rand() - 0.5) * 2.4;      // 바다(−Z) 쪽 반원
      const d = a.r * (0.85 + rand() * 0.4);
      const fx = a.x + Math.cos(ang) * d;
      const fz = a.z + Math.sin(ang) * d;
      if (fz > shoreZ(fx) - 1.0) continue;
      const sc = Math.min(7, a.r * (1.2 + rand() * 1.0));
      foam.push({ x: fx, y: FOAM_LIFT, z: fz, ry: rand() * 6.28, sx: sc, sy: 1, sz: sc * (0.6 + rand() * 0.5) });
    }
  }
  // 물가를 따라(밀려와 퍼지는 거품)
  for (let i = 0; i < 4000 && foam.length < COUNTS.high.foam; i++) {
    const x = -80 + rand() * 160;
    const z = shoreZ(x) - (1.5 + rand() * 4.5);
    const sc = 2.5 + rand() * 4;
    foam.push({ x, y: FOAM_LIFT, z, ry: (rand() - 0.5) * 0.6, sx: sc * 1.8, sy: 1, sz: sc * 0.6 });
  }
  // 걷는 영역에 가까운 것부터 — 낮은 화질은 먼 거품부터 뺀다
  const nearKey = (f) => Math.hypot(f.x, f.z - 10);
  foam.sort((a, b) => nearKey(a) - nearKey(b));
  makeInst(foamGeo, foamMat, foam, 'foam', 'surfFoam', false).renderOrder = 3;   // 물(투명 · renderOrder 2) 다음에 그린다

  const sprayParts = [new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2)];
  const sprayGeo = G(mergeGeoms(sprayParts));
  for (const g of sprayParts) g.dispose();
  const sprayMat = M(surgeMaterial(sprayTex, uni, 'spray'));
  const spray = [];
  for (const a of sprayAnchors) {
    if (spray.length >= COUNTS.high.spray) break;
    const ang = -Math.PI / 2 + (rand() - 0.5) * 1.6;
    const fx = a.x + Math.cos(ang) * a.r * 0.8;
    const fz = a.z + Math.sin(ang) * a.r * 0.8;
    const h = 2 + Math.min(4, a.r) * (0.6 + rand() * 0.5);
    if (blocksFishing(stage, fx, fz, h * 0.5)) continue;
    spray.push({ x: fx, y: -0.2, z: fz, ry: rand() * 6.28, sx: h * 0.55, sy: h, sz: h * 0.55 });
  }
  spray.sort((a, b) => nearKey(a) - nearKey(b));
  makeInst(sprayGeo, sprayMat, spray, 'spray', 'surfSpray', false).renderOrder = 3;

  // ════════ 등대(바위섬 위) ════════
  const white = M(new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.55 }));
  const concrete = M(new THREE.MeshStandardMaterial({ color: '#8a8780', roughness: 0.9 }));
  const darkMetal = M(new THREE.MeshStandardMaterial({ color: '#2a2e30', roughness: 0.5, metalness: 0.6 }));
  const capRed = M(new THREE.MeshStandardMaterial({ color: '#b02a26', roughness: 0.5 }));
  const lampMat = M(new THREE.MeshStandardMaterial({ color: '#d8f0f2', emissive: '#fff2c0', emissiveIntensity: 0.2, roughness: 0.15, metalness: 0.2 }));
  const lighthouse = new THREE.Group();
  lighthouse.name = 'lighthouse';
  const plinthTop = 4.6;
  lighthouse.position.set(lh.x, 0, lh.z);
  group.add(lighthouse);
  const addMesh = (parent, geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(G(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const plinthBed = Math.min(heightAt(lh.x, lh.z), -1);
  addMesh(lighthouse, new THREE.CylinderGeometry(2.6, 3.2, plinthTop - plinthBed, 8), concrete, 0, (plinthTop + plinthBed) / 2, 0);
  addMesh(lighthouse, new THREE.CylinderGeometry(1.15, 1.55, LIGHTHOUSE_H, 8), white, 0, plinthTop + LIGHTHOUSE_H / 2, 0);
  addMesh(lighthouse, new THREE.BoxGeometry(0.5, 1.1, 0.2), darkMetal, 0, plinthTop + 0.55, 1.5);   // 문
  const galleryY = plinthTop + LIGHTHOUSE_H;
  addMesh(lighthouse, new THREE.CylinderGeometry(1.9, 1.6, 0.3, 12), white, 0, galleryY + 0.15, 0);
  addMesh(lighthouse, new THREE.TorusGeometry(1.85, 0.04, 4, 20).rotateX(Math.PI / 2), darkMetal, 0, galleryY + 1.0, 0, false);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    addMesh(lighthouse, new THREE.CylinderGeometry(0.03, 0.03, 0.85, 4), darkMetal, Math.cos(a) * 1.85, galleryY + 0.72, Math.sin(a) * 1.85, false);
  }
  addMesh(lighthouse, new THREE.CylinderGeometry(0.95, 0.95, 1.5, 12), lampMat, 0, galleryY + 1.05, 0, false);
  addMesh(lighthouse, new THREE.ConeGeometry(1.15, 1.0, 12), capRed, 0, galleryY + 2.3, 0);
  addMesh(lighthouse, new THREE.CylinderGeometry(0.05, 0.05, 0.7, 4), darkMetal, 0, galleryY + 3.1, 0, false);
  // 빛줄기(가산 혼합 원뿔 둘 — 끝으로 갈수록 옅다)
  const beamGeo = (() => {
    const c = new THREE.ConeGeometry(4.5, BEAM_LEN, 16, 1, true);
    c.rotateZ(-Math.PI / 2);          // 꼭짓점이 +X
    c.translate(-BEAM_LEN / 2, 0, 0);  // 꼭짓점이 원점 · −X 로 열린다
    const c2 = c.clone().rotateY(Math.PI);
    const merged = mergeGeoms([c, c2]);
    c.dispose();
    c2.dispose();
    const pa = merged.attributes.position;
    const cl = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const f = 1 - clamp(Math.hypot(pa.getX(i), pa.getZ(i)) / BEAM_LEN, 0, 1);
      cl[i * 3] = f; cl[i * 3 + 1] = f * 0.95; cl[i * 3 + 2] = f * 0.8;
    }
    merged.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    return merged;
  })();
  // 화면 패스: 고른 밝기의 원뿔은 카메라 가까이를 지날 때 「흰 알약」 · 끝 단면이 「원반」으로 보였다 →
  //   옆 가장자리일수록(시선과 면이 나란할수록) 옅게 · 카메라 가까이(BEAM_NEAR)는 사라지게 · 끝으로 갈수록 정점 색으로 옅게.
  //   가산(SRC_ALPHA, ONE)이라 더해지는 양 = uColor × a — 전의 MeshBasic(색 × 정점 색 × opacity)과 같은 세기(rgb 에 a 를 또 곱하면 a² 로 사라진다)
  const beamMat = M(new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#fff4d8') }, uNear: { value: new THREE.Vector2(BEAM_NEAR[0], BEAM_NEAR[1]) } },
    vertexShader: `attribute vec3 color;
varying vec3 vCol; varying vec3 vN; varying vec3 vV;
void main() {
  vCol = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; uniform vec2 uNear;
varying vec3 vCol; varying vec3 vN; varying vec3 vV;
void main() {
  float d = length(vV);
  float facing = abs(dot(normalize(vN), normalize(-vV)));
  float a = uOpacity * vCol.r * (0.25 + 0.75 * facing) * smoothstep(uNear.x, uNear.y, d);
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const beam = new THREE.Mesh(G(beamGeo), beamMat);
  beam.name = 'lighthouseBeam';
  beam.position.set(0, galleryY + 1.05, 0);
  beam.visible = false;
  beam.frustumCulled = false;
  lighthouse.add(beam);

  // ════════ 어판장 트럭(판매상 obstacles 원 안) ════════
  const npc = stage.points.find(pt => pt.kind === 'npc');
  let bulbMat = null;
  let truck = null;
  if (npc && stage.obstacles.length) {
    let circle = stage.obstacles[0];
    let best = Infinity;
    for (const o of stage.obstacles) {
      const d = Math.hypot(o.x - npc.x, o.z - npc.z);
      if (d < best) { best = d; circle = o; }
    }
    // 판매상은 원의 npc 쪽 가장자리에 선다(WorldLayer) — 트럭은 그 뒤, 진열하는 옆면(로컬 −Z)이 판매상을 본다
    const dx = npc.x - circle.x;
    const dz = npc.z - circle.z;
    const dl = Math.hypot(dx, dz) || 1;
    const yaw = yawOf(dx, dz);
    truck = new THREE.Group();
    truck.name = 'fishTruck';
    const tx = circle.x - dx / dl * 0.25;
    const tz = circle.z - dz / dl * 0.25;
    truck.position.set(tx, heightAt(tx, tz), tz);
    truck.rotation.y = yaw;
    group.add(truck);
    const body = M(new THREE.MeshStandardMaterial({ color: '#f0f0ec', roughness: 0.45, metalness: 0.15 }));
    const glass = M(new THREE.MeshStandardMaterial({ color: '#1c2630', roughness: 0.1, metalness: 0.5 }));
    const tire = M(new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }));
    const chrome = M(new THREE.MeshStandardMaterial({ color: '#b8bcc0', roughness: 0.3, metalness: 0.8 }));
    const stripe = M(new THREE.MeshStandardMaterial({ color: '#2a5f9a', roughness: 0.5 }));
    const tarp = M(new THREE.MeshStandardMaterial({ color: '#2f6fb8', roughness: 0.8, side: THREE.DoubleSide }));
    const foamBox = M(new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.7 }));
    const ice = M(new THREE.MeshStandardMaterial({ color: '#dff0f4', roughness: 0.25 }));
    const redFish = M(new THREE.MeshStandardMaterial({ color: '#d0485a', roughness: 0.35, metalness: 0.2 }));
    const silverFish = M(new THREE.MeshStandardMaterial({ color: '#9aa8b0', roughness: 0.3, metalness: 0.45 }));
    const darkFish = M(new THREE.MeshStandardMaterial({ color: '#3a4044', roughness: 0.4, metalness: 0.2 }));
    const T = truck;
    const L = 2.9;
    const W = 1.3;
    const floorY = 0.66;
    // 차대 · 적재함 바닥
    addMesh(T, new THREE.BoxGeometry(L, 0.14, W), body, 0, floorY - 0.07, 0);
    addMesh(T, new THREE.BoxGeometry(L - 0.3, 0.18, W - 0.3), darkMetal, 0, floorY - 0.2, 0);
    // 운전석(+X 끝 · 캡오버)
    const cabX = L / 2 - 0.5;
    addMesh(T, new THREE.BoxGeometry(1.0, 1.05, W), body, cabX, floorY + 0.5, 0);
    addMesh(T, new THREE.BoxGeometry(0.96, 0.06, W - 0.04), body, cabX - 0.02, floorY + 1.05, 0);
    addMesh(T, new THREE.BoxGeometry(0.04, 0.48, W - 0.16), glass, cabX + 0.5, floorY + 0.72, 0, false);           // 앞유리
    for (const sz of [-1, 1]) {
      addMesh(T, new THREE.BoxGeometry(0.62, 0.42, 0.03), glass, cabX + 0.08, floorY + 0.72, sz * (W / 2 + 0.005), false);   // 옆창
      addMesh(T, new THREE.BoxGeometry(0.06, 0.14, 0.1), darkMetal, cabX + 0.45, floorY + 0.62, sz * (W / 2 + 0.08), false);  // 거울
      addMesh(T, new THREE.BoxGeometry(L - 0.2, 0.06, 0.02), stripe, -0.05, floorY + 0.12, sz * (W / 2 + 0.006), false);     // 줄무늬
    }
    addMesh(T, new THREE.BoxGeometry(0.08, 0.16, W - 0.1), chrome, L / 2 + 0.02, floorY - 0.1, 0);                 // 범퍼
    for (const sz of [-1, 1]) {
      const hl = addMesh(T, new THREE.BoxGeometry(0.03, 0.1, 0.18), M(new THREE.MeshStandardMaterial({ color: '#fff8e0', emissive: '#fff0c0', emissiveIntensity: 0.3 })), L / 2 + 0.01, floorY + 0.12, sz * 0.48, false);
      hl.name = 'headlight';
    }
    // 바퀴
    const wheelG = new THREE.CylinderGeometry(0.27, 0.27, 0.18, 12).rotateX(Math.PI / 2);
    for (const wx of [-0.95, 0.95]) for (const sz of [-1, 1]) addMesh(T, wheelG.clone(), tire, wx, 0.27, sz * (W / 2 - 0.06));
    wheelG.dispose();
    // 적재함 벽: 뒤판 · +Z 옆판 · −Z 옆판은 내려서(진열대) 매달린다
    const bedL = L - 1.05;
    const bedX = -L / 2 + bedL / 2;
    addMesh(T, new THREE.BoxGeometry(0.04, 0.3, W), body, -L / 2 + 0.02, floorY + 0.15, 0);
    addMesh(T, new THREE.BoxGeometry(bedL, 0.3, 0.04), body, bedX, floorY + 0.15, W / 2 - 0.02);
    addMesh(T, new THREE.BoxGeometry(bedL, 0.3, 0.04), body, bedX, floorY - 0.17, -W / 2 - 0.03);
    // 스티로폼 상자 · 얼음 · 생선(참돔 · 벵에돔 · 전갱이)
    const boxG = new THREE.BoxGeometry(0.52, 0.2, 0.36);
    const iceG = new THREE.BoxGeometry(0.47, 0.03, 0.31);
    const fishG = new THREE.SphereGeometry(0.1, 8, 6);
    const fishMats = [redFish, silverFish, darkFish];
    for (let b = 0; b < 3; b++) {
      const bx = bedX - bedL / 2 + 0.33 + b * 0.6;
      addMesh(T, boxG.clone(), foamBox, bx, floorY + 0.1, -0.3);
      addMesh(T, iceG.clone(), ice, bx, floorY + 0.205, -0.3, false);
      for (let f = 0; f < 3; f++) {
        const fm = addMesh(T, fishG.clone(), fishMats[b], bx - 0.13 + f * 0.13, floorY + 0.245, -0.3 + (f % 2) * 0.04 - 0.02, false);
        fm.scale.set(0.42, 0.32, 1.45);
        fm.rotation.y = 0.12 * (f - 1);
      }
      addMesh(T, boxG.clone(), foamBox, bx, floorY + 0.1, 0.22);     // 뒤쪽 빈 상자(쌓음)
      if (b !== 1) addMesh(T, boxG.clone(), foamBox, bx, floorY + 0.31, 0.22);
    }
    boxG.dispose();
    iceG.dispose();
    fishG.dispose();
    // 저울
    addMesh(T, new THREE.BoxGeometry(0.26, 0.12, 0.22), M(new THREE.MeshStandardMaterial({ color: '#d84a2a', roughness: 0.5 })), cabX - 0.72, floorY + 0.06, -0.35);
    addMesh(T, new THREE.BoxGeometry(0.28, 0.02, 0.24), chrome, cabX - 0.72, floorY + 0.13, -0.35, false);
    // 차양(파란 천 · 기둥 넷)
    const awnL = bedL + 0.1;
    const awnZ0 = -W / 2 - 0.42;
    const awnZ1 = W / 2;
    const awnY = 2.1;
    const poleG = new THREE.CylinderGeometry(0.02, 0.02, awnY - floorY, 5);
    for (const px of [bedX - bedL / 2 + 0.06, bedX + bedL / 2 - 0.06]) {
      addMesh(T, poleG.clone(), chrome, px, (awnY + floorY) / 2 - 0.05, W / 2 - 0.05, false);
      addMesh(T, poleG.clone(), chrome, px, (awnY + floorY) / 2 - 0.05, -W / 2 + 0.05, false);
    }
    poleG.dispose();
    const awn = addMesh(T, new THREE.BoxGeometry(awnL, 0.03, awnZ1 - awnZ0), tarp, bedX, awnY, (awnZ0 + awnZ1) / 2);
    awn.rotation.x = -0.08;
    addMesh(T, new THREE.BoxGeometry(awnL, 0.16, 0.02), tarp, bedX, awnY - 0.1, awnZ0 - 0.03, false);   // 차양 앞 늘어뜨림
    // 전구(밤에 켠다)
    bulbMat = M(new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffc870', emissiveIntensity: 0.1, roughness: 0.4 }));
    addMesh(T, new THREE.SphereGeometry(0.07, 8, 6), bulbMat, bedX, awnY - 0.22, -0.35, false);
    addMesh(T, new THREE.CylinderGeometry(0.004, 0.004, 0.14, 3), darkMetal, bedX, awnY - 0.11, -0.35, false);
    // 깃발(노보리 — 빨강 · 흰 띠, 글자 없음)
    const flagX = -L / 2 + 0.05;
    const flagZ = awnZ0 + 0.1;
    addMesh(T, new THREE.CylinderGeometry(0.018, 0.018, 2.5, 5), chrome, flagX, 1.25, flagZ, false);
    const clothG = new THREE.PlaneGeometry(0.42, 1.5, 1, 6);
    const ccol = new Float32Array(clothG.attributes.position.count * 3);
    for (let i = 0; i < clothG.attributes.position.count; i++) {
      const y = clothG.attributes.position.getY(i);
      const band = y > 0.55 || (y < -0.1 && y > -0.35);
      ccol[i * 3] = band ? 0.95 : 0.78;
      ccol[i * 3 + 1] = band ? 0.95 : 0.12;
      ccol[i * 3 + 2] = band ? 0.92 : 0.12;
    }
    clothG.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    const cloth = addMesh(T, clothG, M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })), flagX + 0.23, 1.6, flagZ, false);
    cloth.name = 'nobori';
    // 빨간 양동이 · 아이스박스(트럭 옆 땅 위 — 원 안)
    addMesh(T, new THREE.CylinderGeometry(0.15, 0.12, 0.3, 10), M(new THREE.MeshStandardMaterial({ color: '#c83a2a', roughness: 0.6 })), -L / 2 + 0.25, 0.15, -W / 2 - 0.3);
  }

  // ════════ 이즈 오시마(수평선) ════════
  const islandMat = M(new THREE.MeshBasicMaterial({ color: ISLAND_BASE, fog: false }));
  const islandGeo = (() => {
    const g = new THREE.SphereGeometry(1, 48, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      const ang = Math.atan2(z, x);
      const bump = 1 + 0.18 * Math.sin(ang * 3 + 0.7) + 0.08 * Math.sin(ang * 7);
      // 칼데라 산(미하라산) — 가운데가 솟는다
      const peak = Math.pow(y, 1.6) * (0.75 + 0.25 * Math.cos(ang * 2));
      pa.setXYZ(i, x * bump, peak, z * bump);
    }
    g.scale(ISLAND.w / 2, ISLAND.h, ISLAND.d / 2);
    g.computeVertexNormals();
    return g;
  })();
  const island = new THREE.Mesh(G(islandGeo), islandMat);
  island.name = 'izuOshima';
  island.position.set(ISLAND.x, -2, ISLAND.z);
  island.castShadow = false;
  island.receiveShadow = false;
  group.add(island);
  const islandBase = new THREE.Color(ISLAND_BASE);
  const islandHaze = new THREE.Color((look.sky && look.sky.horizon) || '#d2e2ee');

  // ── 화질
  const treeMax = COUNTS.high.pines;
  const applyQuality = (qname) => {
    const c = COUNTS[qname] || COUNTS.medium;
    for (const it of instanced) {
      if (!it.key) continue;
      const want = it.key === 'pines' ? Math.round(it.max * c.pines / treeMax) : c[it.key];
      it.mesh.count = Math.min(it.max, Math.max(0, want));
    }
  };
  applyQuality(args.quality);

  let rainWet = 0;
  return {
    group,
    update(env, dt) {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
      const time = Number.isFinite(env.time) ? env.time : 0;
      const light = Number.isFinite(env.light) ? clamp(env.light, 0, 1) : 1;
      uni.uTime.value = time;
      uni.uPeriod.value = env.wavePeriod > 0.5 ? env.wavePeriod : (stage.waves.period || 6);
      const baseAmp = stage.waves.amp > 0 ? stage.waves.amp : 0.18;
      uni.uAmt.value = clamp((env.waveAmp > 0 ? env.waveAmp : baseAmp) / baseAmp, 0.35, 1.6);
      // 비: 바위가 천천히 젖고 천천히 마른다
      const wetTarget = env.weather === 'rain' ? 1 : 0;
      rainWet += (wetTarget - rainWet) * (1 - Math.exp(-step * (wetTarget > rainWet ? 0.8 : 0.15)));
      uni.uRainWet.value = rainWet;
      // 거품 · 물보라는 빛을 받지 않는 재질 — 밤에는 어둡게
      const fb = 0.1 + 0.9 * light;
      foamMat.color.setScalar(fb);
      sprayMat.color.setScalar(fb);
      // 등대: 해 질 녘부터 빛줄기
      const dusk = clamp((0.62 - light) / 0.42, 0, 1);
      lampMat.emissiveIntensity = env.night ? 3.2 : 0.2 + dusk * 2.6;
      const beamA = dusk * (env.weather === 'rain' ? 0.32 : env.weather === 'cloudy' ? 0.24 : 0.18);
      beamMat.uniforms.uOpacity.value = beamA;
      beam.visible = beamA > 0.005;
      beam.rotation.y = time * BEAM_SPEED;
      if (bulbMat) bulbMat.emissiveIntensity = env.night ? 2.4 : light < 0.55 ? 1.0 : 0.1;
      // 섬: 지평선 색으로 흐리게(비 · 흐림이면 더) · 밤에는 어둡게
      // 비에는 수평선이 닫힌다(섬이 보이지 않는다)
      island.visible = env.weather !== 'rain';
      const haze = env.weather === 'cloudy' ? 0.8 : 0.55;
      islandMat.color.copy(islandBase).lerp(islandHaze, haze).multiplyScalar(0.03 + 0.97 * light * Math.sqrt(light));
    },
    setQuality(qname) { applyQuality(qname); },
    dispose() {
      for (const it of instanced) it.mesh.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
