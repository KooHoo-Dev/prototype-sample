// OWNER: P7 — 계약 §9.2 「기본 빛」 · §9.4 「빛」 · §9.10 (내부 — renderer.js · WorldLayer.js 가 쓴다)
// 빛 장치: 반구광 + 해(방향광 · 마을 해질녘만 켜짐) + 플레이어 머리 위 점광원 + 맵 빛 풀(maxLights − 1).
// 빛의 수는 화질이 바뀔 때만 바뀐다(three 는 빛 수가 바뀌면 셰이더를 다시 컴파일한다 — 남는 풀은 세기 0 으로 둔다).
// 가까운 빛 고르기(pickNearest)는 순수 함수(테스트).

import * as THREE from 'three';
import { ATMOS, FOG_K, HEMI_SCALE, LIGHT_DECAY, LIGHT_SCALE, PLAYER_LIGHT, SUN_DIR } from './style.js';

/**
 * @typedef {Object} LightRig
 * @property {THREE.HemisphereLight} hemi @property {THREE.DirectionalLight} sun @property {THREE.PointLight} player
 * @property {THREE.PointLight[]} pool
 * @property {(n:number) => void} setPoolSize
 * @property {(on:boolean) => void} setShadows
 * @property {() => void} dispose
 */

/** @param {THREE.Scene} scene @returns {LightRig} */
export function createLightRig(scene) {
  const hemi = new THREE.HemisphereLight(ATMOS.crypt.hemiSky, ATMOS.crypt.hemiGround, ATMOS.crypt.hemi * HEMI_SCALE);
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(SUN_DIR.x * 50, SUN_DIR.y * 50, SUN_DIR.z * 50);
  sun.target.position.set(0, 0, 0);
  const player = new THREE.PointLight(PLAYER_LIGHT.color, PLAYER_LIGHT.intensity * LIGHT_SCALE, PLAYER_LIGHT.radius, LIGHT_DECAY);
  player.shadow.mapSize.set(1024, 1024);
  player.shadow.camera.near = 0.3;
  player.shadow.camera.far = PLAYER_LIGHT.radius + 4;
  player.shadow.bias = -0.002;
  scene.add(hemi, sun, sun.target, player);
  /** @type {THREE.PointLight[]} */
  const pool = [];
  const rig = {
    hemi, sun, player, pool,
    setPoolSize(n) {
      const want = Math.max(0, n | 0);
      while (pool.length < want) {
        const l = new THREE.PointLight(0xffffff, 0, 8, LIGHT_DECAY);
        l.userData.cand = -1;
        l.userData.w = 0;
        scene.add(l);
        pool.push(l);
      }
      while (pool.length > want) {
        const l = /** @type {THREE.PointLight} */ (pool.pop());
        scene.remove(l);
        l.dispose();
      }
    },
    setShadows(on) {
      player.castShadow = !!on;
    },
    dispose() {
      rig.setPoolSize(0);
      scene.remove(hemi, sun, sun.target, player);
      hemi.dispose();
      sun.dispose();
      player.dispose();
    },
  };
  return rig;
}

/**
 * 분위기(안개 · 배경 · 반구광 · 해 · 노출)를 타일셋에 맞춘다.
 * @param {{scene:THREE.Scene, renderer?:any, lights?:LightRig}} rc @param {string} tileset
 */
export function applyAtmosphere(rc, tileset) {
  const A = ATMOS[tileset] ?? ATMOS.crypt;
  const scene = rc.scene;
  const density = A.density * FOG_K;
  if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(A.fog, density);
  scene.fog.color.setHex(A.fog);
  /** @type {THREE.FogExp2} */ (scene.fog).density = density;
  scene.userData.fogBase = density;
  if (scene.background instanceof THREE.Color) scene.background.setHex(A.fog);
  else scene.background = new THREE.Color(A.fog);
  const L = rc.lights;
  if (L) {
    L.hemi.color.setHex(A.hemiSky);
    L.hemi.groundColor.setHex(A.hemiGround);
    L.hemi.intensity = A.hemi * HEMI_SCALE;
    L.sun.color.setHex(A.sun || 0xffffff);
    L.sun.intensity = A.sunI;
  }
  if (rc.renderer) rc.renderer.toneMappingExposure = A.exposure;
}

/**
 * 대상 점에서 가까운 빛 k 개(거리 제곱 오름차순) — 할당 없이 out 배열을 채운다.
 * @param {ArrayLike<number>} xs @param {ArrayLike<number>} zs @param {ArrayLike<number>|null} on 0 이면 건너뛴다(없으면 전부)
 * @param {number} n 후보 수 @param {number} tx @param {number} tz @param {number} k
 * @param {Int32Array} outIdx 길이 ≥ k @param {Float64Array} outD 길이 ≥ k
 * @returns {number} 고른 수
 */
export function pickNearest(xs, zs, on, n, tx, tz, k, outIdx, outD) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (on && !on[i]) continue;
    const dx = xs[i] - tx, dz = zs[i] - tz;
    const d = dx * dx + dz * dz;
    if (m < k) {
      let p = m++;
      while (p > 0 && outD[p - 1] > d) { outD[p] = outD[p - 1]; outIdx[p] = outIdx[p - 1]; p--; }
      outD[p] = d; outIdx[p] = i;
    } else if (k > 0 && d < outD[k - 1]) {
      let p = k - 1;
      while (p > 0 && outD[p - 1] > d) { outD[p] = outD[p - 1]; outIdx[p] = outIdx[p - 1]; p--; }
      outD[p] = d; outIdx[p] = i;
    }
  }
  return m;
}

/** 깜빡임 잡음 [−1, 1](실제 시간 · 빛마다 위상) */
export function flickerNoise(t, phase) {
  return 0.55 * Math.sin(t * 7.3 + phase) + 0.3 * Math.sin(t * 17.9 + phase * 2.1) + 0.15 * Math.sin(t * 31.7 + phase * 3.7);
}

/** 둥근 후광 텍스처(64 × 64 · 코드로 · 가운데 밝고 가장자리 0) @returns {THREE.DataTexture} */
export function makeGlowTexture() {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 2.2) * (1 - r * 0.15);
    const v = Math.round(255 * Math.max(0, a));
    const i = (y * N + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = v;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
