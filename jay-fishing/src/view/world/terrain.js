// OWNER: P5 — 내부 파일 · 지형 높이 함수와 그 함수로 만든 메시(§9.3 「heightAt 은 이 메시를 만든 같은 함수」).
// 땅(해안선 +Z 쪽): 물가 둑 → 완만한 오르막 → 멀어질수록 노이즈 언덕(look.terrain).
// 물(해안선 −Z 쪽): 자리마다의 depth 프로필을 해안선 거리로 편다(가장 가까운 자리 · 자리 사이 보간) · farBankZ 가 있으면 건너편 기슭이 오른다.

import * as THREE from 'three';
import { clamp, lerp, piecewise, shoreZAt, smoothstep } from '../../core/math.js';
import { fbm, valueNoise } from './noise.js';

// 지형 모양 상수(m) — 연출 값
const LIP = 0.15;            // 해안선 바로 위 땅 높이
const BANK_H = 0.6;          // 물가 둑 높이(설 자리 0.3..1.2 · 걷는 영역 경사 ≤ 30°)
const BANK_H_ROCKY = 0.85;
const BANK_W = 2.4;          // 둑이 오르는 폭
const RISE_NEAR = 0.025;     // 걷는 영역의 완만한 오르막(기울기)
const RISE_FAR = 0.12;       // 60m 너머 — 뒤쪽 땅이 올라 지평선을 막는다
const RISE_FAR_FROM = 60;
const SHORE_BLEND = 1.4;     // 해안선 → 물 바닥으로 내려가는 폭
const DEEP_SLOPE = 0.05;     // 프로필 끝 너머 깊어지는 기울기
const MAX_DEPTH = 32;
const FAR_SHELF = 140;       // 건너편 기슭 앞에서 얕아지는 폭
const FAR_RISE = 0.55;       // 건너편 기슭이 오르는 기울기
const FAR_CAP = 220;
const FAR_CAP_DISTANT = 14;    // 건너편 기슭이 멀면(> 500m) 낮은 기슭만 — 산은 원경 능선(ridge)이 그린다(안개에 묻힌 벽이 능선을 가리지 않게)
const SEABED_NOISE = 0.35;

/** 나눔 축 — center 주변 flat 안은 step0, 그 밖은 멀어질수록 넓어진다 */
export function buildAxis(min, max, lo, hi, step0, growth) {
  const out = [];
  const stepAt = (c) => {
    const away = c < lo ? lo - c : c > hi ? c - hi : 0;
    return step0 + growth * away;
  };
  let c = lo;
  const fwd = [];
  while (c < max) { fwd.push(c); c += stepAt(c); }
  fwd.push(max);
  const back = [];
  c = lo - stepAt(lo);
  while (c > min) { back.push(c); c -= stepAt(c); }
  back.push(min);
  back.reverse();
  for (const v of back) out.push(v);
  for (const v of fwd) out.push(v);
  // 너무 가까운 마지막 칸 정리
  const clean = [out[0]];
  for (let i = 1; i < out.length; i++) if (out[i] - clean[clean.length - 1] > 1e-3) clean.push(out[i]);
  return clean;
}

/**
 * 스테이지 하나의 높이 함수. 실내는 0.
 * @param {import('../../types.js').StageDef} stage
 */
export function createTerrainField(stage) {
  const shore = stage.shore;
  const interior = stage.kind === 'interior' || !shore.length;
  const look = stage.look || {};
  const t = look.terrain || { hillAmp: 0, hillScale: 50, noiseSeed: 1 };
  const ridge = look.ridge || {};
  const farBankZ = typeof ridge.farBankZ === 'number' ? ridge.farBankZ : null;
  const seed = t.noiseSeed | 0;
  const hillAmp = t.hillAmp || 0;
  const hillScale = t.hillScale || 50;
  const bankH = t.rocky ? BANK_H_ROCKY : BANK_H;
  const farCap = farBankZ !== null && Math.abs(farBankZ) > 500 ? FAR_CAP_DISTANT : FAR_CAP;
  const spots = [...(stage.spots || [])].sort((a, b) => a.stand.x - b.stand.x);
  const lastDist = spots.map(sp => sp.depth[sp.depth.length - 1][0]);

  function profileDepth(i, s) {
    const sp = spots[i];
    const r = s + sp.edgeM;
    return Math.min(MAX_DEPTH, piecewise(sp.depth, r) + Math.max(0, r - lastDist[i]) * DEEP_SLOPE);
  }

  /** 수면 아래 바닥 깊이(m, 양수) — s = 해안선에서 물 쪽으로 잰 거리 */
  function waterDepth(x, z, s) {
    let d;
    const n = spots.length;
    if (!n) d = Math.min(MAX_DEPTH, 1 + s * 0.1);
    else if (x <= spots[0].stand.x) d = profileDepth(0, s);
    else if (x >= spots[n - 1].stand.x) d = profileDepth(n - 1, s);
    else {
      let i = 0;
      while (i < n - 2 && x > spots[i + 1].stand.x) i++;
      const x0 = spots[i].stand.x;
      const x1 = spots[i + 1].stand.x;
      const u = smoothstep(0, 1, (x - x0) / (x1 - x0));
      d = lerp(profileDepth(i, s), profileDepth(i + 1, s), u);
    }
    if (farBankZ !== null) d *= smoothstep(farBankZ, farBankZ + FAR_SHELF, z);
    d += (valueNoise(x * 0.17, z * 0.17, seed + 7) - 0.5) * SEABED_NOISE * smoothstep(0, 5, s);
    return Math.max(0, d);
  }

  /** 지면 y(m) — 메시는 이 함수로 만든다 */
  function heightAt(x, z) {
    if (interior) return 0;
    const sz = shoreZAt(shore, x);
    if (z <= sz) {
      if (farBankZ !== null && z < farBankZ) {
        const e = farBankZ - z;
        const n = fbm(x / 70, z / 70, seed + 3, 3);
        return Math.min(farCap, e * FAR_RISE * (0.55 + 0.9 * n));
      }
      const s = sz - z;
      return lerp(LIP, -waterDepth(x, z, s), smoothstep(0, SHORE_BLEND, s));
    }
    const d = z - sz;
    const bank = LIP + bankH * smoothstep(0, BANK_W, d);
    const rise = RISE_NEAR * Math.max(0, d - 2) + RISE_FAR * Math.max(0, d - RISE_FAR_FROM);
    const hills = (fbm(x / hillScale, z / hillScale, seed, 4) - 0.5) * 2 * hillAmp
      * smoothstep(4, 40, d) * (0.12 + 0.88 * smoothstep(40, 140, d));
    return bank + rise + hills;
  }

  /** 땅 쪽 거리(+) / 물 쪽 거리(−) — 색 칠하기용 */
  function shoreDist(x, z) {
    if (interior) return Infinity;
    return z - shoreZAt(shore, x);
  }

  return { stage, interior, farBankZ, heightAt, shoreDist, seed };
}

/** 지형 메시 범위 — 실내가 아니면 */
export function terrainExtent(field) {
  const zFar = field.farBankZ !== null ? field.farBankZ - 260 : -260;
  return { xMin: -650, xMax: 650, zMin: zFar, zMax: 620 };
}

const _c = new THREE.Color();
const _ground = new THREE.Color();
const _shore = new THREE.Color();
const _seabed = new THREE.Color();
const _rock = new THREE.Color();
const _dry = new THREE.Color();

/**
 * heightAt 으로 만든 하이트맵 메시 — 정점 y 는 heightAt(x, z) 그대로.
 * @param {ReturnType<typeof createTerrainField>} field @param {number} terrainSeg QUALITY[q].terrainSeg
 */
export function buildTerrainGeometry(field, terrainSeg) {
  const ext = terrainExtent(field);
  const k = 160 / Math.max(32, terrainSeg);
  const xs = buildAxis(ext.xMin, ext.xMax, -60, 60, 1.0 * k, 0.07);
  const zs = buildAxis(ext.zMin, ext.zMax, -8, 40, 0.6 * k, 0.07);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const look = field.stage.look.terrain;
  _ground.set(look.ground);
  _shore.set(look.shore);
  _seabed.set(look.seabed);
  _rock.set(look.rocky ? '#2e2b29' : '#6b6658');
  _dry.copy(_ground).lerp(_shore, 0.35);
  const seed = field.seed;
  let p = 0;
  for (let j = 0; j < nz; j++) {
    const z = zs[j];
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const y = field.heightAt(x, z);
      pos[p * 3] = x;
      pos[p * 3 + 1] = y;
      pos[p * 3 + 2] = z;
      uv[p * 2] = x / 3;
      uv[p * 2 + 1] = z / 3;
      // 색: 물 바닥 · 물가 띠 · 땅(얼룩) · 가파른 곳 바위
      const d = field.shoreDist(x, z);
      const n = fbm(x / 9, z / 9, seed + 17, 3);
      if (y < -0.05 && d < 0) {
        _c.copy(_seabed).multiplyScalar(clamp(1.05 - (-y) * 0.04, 0.45, 1.05));
        _c.lerp(_shore, (1 - smoothstep(0, 1.5, -y)) * 0.6);
      } else if (d < 3.2 && d > -2) {
        _c.copy(_shore).lerp(_ground, smoothstep(1.6, 3.2, d) * 0.85);
      } else {
        _c.copy(_ground).lerp(_dry, smoothstep(0.45, 0.8, n) * 0.6);
        _c.multiplyScalar(0.82 + 0.3 * n);
      }
      // 가파름(이웃 차분)
      const sx = (field.heightAt(x + 0.8, z) - field.heightAt(x - 0.8, z)) / 1.6;
      const sz = (field.heightAt(x, z + 0.8) - field.heightAt(x, z - 0.8)) / 1.6;
      const slope = Math.sqrt(sx * sx + sz * sz);
      if (y > 0.3) _c.lerp(_rock, smoothstep(0.6, 1.2, slope) * 0.85);
      col[p * 3] = _c.r;
      col[p * 3 + 1] = _c.g;
      col[p * 3 + 2] = _c.b;
      p++;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // 위에서 보아 반시계(+Y 법선)
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * 물 셰이더용 깊이 텐스처 — R: 수심(0..1 = 0..DEPTH_TEX_MAX m) · G: 물가 가까움(거품 · 얕은 띠) · 범위 밖은 깊은 물.
 * @returns {{texture:THREE.DataTexture, rect:THREE.Vector4}}
 */
export const DEPTH_TEX_MAX = 20;
export function buildDepthTexture(field, size = 256) {
  const x0 = -320;
  const x1 = 320;
  const z1 = 24;
  const z0 = field.farBankZ !== null ? Math.max(field.farBankZ - 10, -400) : -380;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = z0 + (z1 - z0) * (j + 0.5) / size;
    for (let i = 0; i < size; i++) {
      const x = x0 + (x1 - x0) * (i + 0.5) / size;
      const h = field.heightAt(x, z);
      const depth = Math.max(0, -h);
      const o = (j * size + i) * 4;
      data[o] = Math.round(clamp(depth / DEPTH_TEX_MAX, 0, 1) * 255);
      data[o + 1] = Math.round((1 - smoothstep(0, 1.2, depth)) * 255);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { texture: tex, rect: new THREE.Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)) };
}
