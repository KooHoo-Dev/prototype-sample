// OWNER: P5 — 내부 파일 · 먼 산 능선(look.ridge) — 저폴리 띠 두 겹(가까운 능선 · 더 먼 옅은 능선).
// FogExp2 로는 1km 너머가 다 사라지므로 원경은 자기 대기 원근(지평선색으로 섞기)을 쓴다 — fog: false.

import * as THREE from 'three';
import { smoothstep } from '../../core/math.js';
import { fbm1Wrapped } from './noise.js';

const SEGMENTS = 220;
const LAYERS = [
  { distMul: 1.0, hMul: 0.8, haze: 0.0, seed: 0 },
  { distMul: 1.35, hMul: 1.0, haze: 0.2, seed: 7 },
];

const RIDGE_VERT = /* glsl */`
attribute float aShade;
varying float vShade;
varying vec3 vN;
varying float vH;
varying vec3 vW;
void main() {
  vShade = aShade;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vH = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RIDGE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uHaze;
uniform float uHazeAmt;
uniform float uLayerHaze;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightAmt;
uniform vec3 uAmbient;
uniform float uTopH;
varying float vShade;
varying vec3 vN;
varying float vH;
varying vec3 vW;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // forest / valley mottling
  vec2 q = vec2(atan(vW.x, -vW.z) * 260.0, vH * 0.6);
  float tex = vn(q * 0.08) * 0.6 + vn(q * 0.25) * 0.4;
  float ndl = max(dot(normalize(vN), uLightDir), 0.0);
  vec3 c = uColor * vShade * (0.72 + 0.5 * tex) * (uAmbient + uLightColor * uLightAmt * ndl * 0.8);
  // valleys hazier than ridgelines
  float hz = clamp(uHazeAmt + uLayerHaze + (1.0 - smoothstep(0.0, uTopH, vH)) * 0.18, 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uHaze, hz), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {Object} stage
 * @returns {{group:THREE.Group, update(o:{horizon:THREE.Color, hazeAmt:number, lightDir:THREE.Vector3, lightColor:THREE.Color, lightAmt:number, ambient:THREE.Color}):void, dispose():void}}
 */
export function createRidge(stage) {
  const r = stage.look.ridge;
  const group = new THREE.Group();
  group.name = `ridge:${stage.id}`;
  const hasFarBank = typeof r.farBankZ === 'number';
  const seedBase = (stage.look.terrain && stage.look.terrain.noiseSeed) || 1;
  const geos = [];
  const mats = [];
  for (const L of LAYERS) {
    const dist = r.dist * L.distMul;
    const H = r.height * L.hMul;
    const rows = 4;
    const pos = new Float32Array((SEGMENTS + 1) * rows * 3);
    const shade = new Float32Array((SEGMENTS + 1) * rows);
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = -Math.cos(a);      // a = 0 → −Z(물 쪽)
      // 방향별 높이: 물 쪽은 건너편 기슭이 있을 때만, 땅 쪽은 낮게
      const front = smoothstep(0.15, -0.35, dz);   // dz < 0 → 물 쪽
      const env = front * (hasFarBank ? 1 : 0) + (1 - front) * 0.55;
      const n = fbm1Wrapped((i / SEGMENTS) * 24, 24, seedBase + L.seed, 5);
      const peak = env * H * (0.2 + 0.8 * Math.pow(n, 1.4));
      const hidden = env < 0.02;
      for (let k = 0; k < rows; k++) {
        const f = k / (rows - 1);                       // 0 바닥 · 1 능선
        const y = hidden ? -60 : -40 + (peak + 40) * Math.pow(f, 0.85);
        const rr = dist + (1 - f) * dist * 0.05;
        const o = (i * rows + k) * 3;
        pos[o] = dx * rr;
        pos[o + 1] = y;
        pos[o + 2] = dz * rr;
        shade[i * rows + k] = 0.7 + 0.3 * f;
      }
    }
    const idx = [];
    for (let i = 0; i < SEGMENTS; i++) for (let k = 0; k < rows - 1; k++) {
      const a = i * rows + k;
      const b = (i + 1) * rows + k;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 안쪽(원점)을 보게 법선 뒤집기
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) {
      const x = pos[i * 3];
      const z = pos[i * 3 + 2];
      if (nrm.getX(i) * x + nrm.getZ(i) * z > 0) nrm.setXYZ(i, -nrm.getX(i), nrm.getY(i), -nrm.getZ(i));
    }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(r.color) },
        uHaze: { value: new THREE.Color() },
        uHazeAmt: { value: 0.5 },
        uLayerHaze: { value: L.haze },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: new THREE.Color(1, 1, 1) },
        uLightAmt: { value: 1 },
        uAmbient: { value: new THREE.Color(0.4, 0.4, 0.4) },
        uTopH: { value: Math.max(1, H) },
      },
      vertexShader: RIDGE_VERT, fragmentShader: RIDGE_FRAG, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5 + L.distMul;
    group.add(mesh);
    geos.push(g);
    mats.push(m);
  }
  return {
    group,
    update(o) {
      for (const m of mats) {
        const u = m.uniforms;
        u.uHaze.value.copy(o.horizon);
        u.uHazeAmt.value = o.hazeAmt;
        u.uLightDir.value.copy(o.lightDir);
        u.uLightColor.value.copy(o.lightColor);
        u.uLightAmt.value = o.lightAmt;
        u.uAmbient.value.copy(o.ambient);
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
