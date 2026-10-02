// OWNER: P12 — 내부 파일(§1.3 src/view/stages/river/) · 강 소품 빌더가 쓰는 작은 도구.
// P5 의 view/world/* 내부 파일을 import 하지 않는다(NOTES-W1 §7 — 베낀다). three 와 core 만 — Node 에서도 돈다.

import * as THREE from 'three';
import { angleDiff, pointInConvex, shoreZAt, yawOf } from '../../../core/math.js';

const VIEW_RANGE = 62;       // m — 낚시 자리 수면 시야(60m) + 여유(§9.4)
const VIEW_PAD = 0.14;       // rad — facing ± arc 바깥 여유
const STAND_CLEAR = 3.2;     // m — 설 자리 둘레는 비운다

/** 시드 난수 열(배치용 — Math.random 을 쓰지 않는다 · 같은 시드면 같은 풍경) */
export function makeRand(seed) {
  let s = (seed | 0) ^ 0x6d2b79f5;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 낚시 자리의 facing ± arc · 60m 수면 시야(또는 설 자리 둘레)에 드는 점인가 */
export function inSpotView(stage, x, z) {
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

/** 걷는 영역 안인가 */
export function inWalk(stage, x, z) { return pointInConvex(stage.walk, x, z); }

/** 높이 0.5m 를 넘는 소품을 (x, z) 반경 r 로 둬도 되는가 — 걷는 영역 밖이거나 obstacles 원 안(§9.4) */
export function tallAllowed(stage, x, z, r = 0) {
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const px = i === n ? x : x + Math.cos(a) * r;
    const pz = i === n ? z : z + Math.sin(a) * r;
    if (!pointInConvex(stage.walk, px, pz)) continue;
    let inside = false;
    for (const o of stage.obstacles) if ((px - o.x) ** 2 + (pz - o.z) ** 2 <= (o.r - 0.05) ** 2) { inside = true; break; }
    if (!inside) return false;
  }
  return true;
}

/** 해안선 z(물은 그 −Z 쪽) */
export function shoreZ(stage, x) { return shoreZAt(stage.shore, x); }

/**
 * 여러 BufferGeometry 를 하나로 — position · normal · (색이 있으면) color.
 * @param {Array<THREE.BufferGeometry|{geo:THREE.BufferGeometry, color:string|THREE.Color}>} list
 */
export function mergeGeoms(list) {
  let vCount = 0;
  let iCount = 0;
  let colored = false;
  const items = list.map((it) => {
    const o = it instanceof THREE.BufferGeometry ? { geo: it, color: null } : it;
    if (o.color) colored = true;
    return o;
  });
  for (const { geo } of items) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = colored ? new Float32Array(vCount * 3) : null;
  const idx = new Uint32Array(iCount);
  const c = new THREE.Color();
  let vo = 0;
  let io = 0;
  for (const { geo, color } of items) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count;
    pos.set(geo.attributes.position.array, vo * 3);
    nrm.set(geo.attributes.normal.array, vo * 3);
    if (col) {
      c.set(color || '#ffffff');
      for (let i = 0; i < n; i++) { col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx[io++] = geo.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** 상자 하나(중심 · 크기) — 합치기용 */
export function box(w, h, d, x, y, z, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/**
 * 안개를 상한까지만 먹는 표준 재질 — 원경(댐 · 협곡 절벽 · 건너편 숲)이 FogExp2 에 완전히 묻히지 않고 실루엣으로 남게.
 * 안개 색은 WorldLayer 가 정한 장면 안개(지평선색 × 빛) 그대로다.
 * @param {THREE.MeshStandardMaterialParameters} params @param {number} cap 0..1
 */
export function hazedStandard(params, cap) {
  const m = new THREE.MeshStandardMaterial(params);
  const k = cap.toFixed(3);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fogFactor, ${k} ) );
#endif`);
  };
  m.customProgramCacheKey = () => `riverHaze${k}`;
  return m;
}

/** 셰이더 재질에서 쓰는 상한 안개 조각(fog: true + UniformsLib.fog 와 같이) */
export const FOG_VERT_PARS = '#include <fog_pars_vertex>';
export const FOG_FRAG_PARS = '#include <fog_pars_fragment>';
/** @param {number} cap */
export function fogFragCapped(cap) {
  return `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fogF, ${cap.toFixed(3)} ) );
#endif`;
}

/** 반복되는 부드러운 값 노이즈(0..1) — (u, v)는 1 주기로 감긴다. 절차 텍스처 · 배치용 @param {number} _unused @param {number} seed @param {number} cells */
export function noiseGrid(_unused, seed, cells) {
  const rand = makeRand(seed);
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < g.length; i++) g[i] = rand();
  for (let i = 0; i <= cells; i++) { g[i * (cells + 1) + cells] = g[i * (cells + 1)]; g[cells * (cells + 1) + i] = g[i]; }
  return (u, v) => {
    const x = (u - Math.floor(u)) * cells;        // 반복(타일)
    const y = (v - Math.floor(v)) * cells;
    const ix = Math.min(cells - 1, Math.floor(x));
    const iy = Math.min(cells - 1, Math.floor(y));
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = g[iy * (cells + 1) + ix];
    const b = g[iy * (cells + 1) + ix + 1];
    const c = g[(iy + 1) * (cells + 1) + ix];
    const d = g[(iy + 1) * (cells + 1) + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** RGBA DataTexture(반복) — fill(u, v, out[4]) 가 0..255 를 채운다 */
export function dataTexture(w, h, fill, { repeat = true, srgb = true } = {}) {
  const data = new Uint8Array(w * h * 4);
  const px = [0, 0, 0, 255];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    px[3] = 255;
    fill((i + 0.5) / w, (j + 0.5) / h, px);
    const o = (j * w + i) * 4;
    for (let k = 0; k < 4; k++) data[o + k] = px[k] < 0 ? 0 : px[k] > 255 ? 255 : px[k];
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
