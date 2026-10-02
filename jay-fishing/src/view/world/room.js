// OWNER: P5 — 내부 파일 · 집 실내 셸(§9.3): 벽 · 바닥 · 천장 · 창(창밖은 clock 으로 하늘색) · 걸레받이 · 천장등.
// 가구(책상 · 모니터 · 의자 · 침대 · 문 · 로드 걸이)는 homeProps(P5).

import * as THREE from 'three';
import { makePlankTexture, makeWallTexture } from './textures.js';

const OUT_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const OUT_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHill;
uniform vec3 uWater;
uniform float uLight;
uniform float uStars;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  float y = vUv.y;
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.42, 1.0, y));
  float ridge = 0.42 + 0.06 * sin(vUv.x * 9.0) + 0.035 * sin(vUv.x * 23.0 + 1.3) + 0.015 * sin(vUv.x * 57.0);
  float near = 0.36 + 0.03 * sin(vUv.x * 13.0 + 2.0);
  vec3 c = sky;
  vec2 g = floor(vUv * vec2(220.0, 140.0));
  float st = step(0.985, h21(g)) * uStars * smoothstep(0.5, 0.8, y);
  c += vec3(st);
  if (y < ridge) c = mix(uHill * (0.25 + 0.75 * uLight), uHorizon, 0.45);
  if (y < near) c = uWater * (0.2 + 0.8 * uLight) + uHorizon * 0.15;
  if (y < 0.3) c = uHill * (0.2 + 0.6 * uLight) * 0.7;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {{room:{w:number,d:number,h:number}, wall:string, floor:string, ceiling:string, window:{wall:string, z:number, w:number, h:number}}} look
 */
export function buildRoomShell(look) {
  const { w, d, h } = look.room;
  const hw = w / 2;
  const hd = d / 2;
  const geos = [];
  const mats = [];
  const texs = [];
  const G = (g) => { geos.push(g); return g; };
  const group = new THREE.Group();
  group.name = 'roomShell';

  const wallTex = makeWallTexture(look.wall);
  wallTex.repeat.set(w / 1.2, h / 1.2);
  const plankTex = makePlankTexture();
  plankTex.repeat.set(w / 2.4, d / 2.4);
  texs.push(wallTex, plankTex);
  const wallM = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92 });
  const floorM = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.7, color: '#ffffff' });
  const ceilM = new THREE.MeshStandardMaterial({ color: look.ceiling, roughness: 0.95, emissive: look.ceiling, emissiveIntensity: 0.16 });
  const trimM = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.7 });
  const frameM = new THREE.MeshStandardMaterial({ color: '#efe8dc', roughness: 0.6 });
  const glassM = new THREE.MeshStandardMaterial({ color: '#cfe4ff', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const curtainM = new THREE.MeshStandardMaterial({ color: '#7a9a8a', roughness: 0.95, side: THREE.DoubleSide });
  const lampM = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe6b8', emissiveIntensity: 1.2, roughness: 0.5 });
  mats.push(wallM, floorM, ceilM, trimM, frameM, glassM, curtainM, lampM);

  const plane = (gw, gh, m, x, y, z, ry, rx = 0) => {
    const g = G(new THREE.PlaneGeometry(gw, gh));
    // 벽지 반복을 면 크기에 맞게
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * gw / w, uv.getY(i) * gh / h);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, 0, 'YXZ');
    o.castShadow = true;
    o.receiveShadow = true;
    group.add(o);
    return o;
  };
  // 바닥 · 천장
  const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), floorM);
  floor.receiveShadow = true;
  group.add(floor);
  plane(w, d, ceilM, 0, h, 0, 0, Math.PI / 2);
  // 북(−Z) · 남(+Z) · 서(−X) 벽
  plane(w, h, wallM, 0, h / 2, -hd, 0);
  plane(w, h, wallM, 0, h / 2, hd, Math.PI);
  plane(d, h, wallM, -hw, h / 2, 0, Math.PI / 2);
  // 동(+X) 벽 — 창 구멍을 둘러 네 조각
  const win = look.window;
  const wz0 = win.z - win.w / 2;
  const wz1 = win.z + win.w / 2;
  const wy0 = 0.9;
  const wy1 = wy0 + win.h;
  const ry = -Math.PI / 2;
  plane(wz0 + hd, h, wallM, hw, h / 2, (-hd + wz0) / 2, ry);
  plane(hd - wz1, h, wallM, hw, h / 2, (wz1 + hd) / 2, ry);
  plane(win.w, wy0, wallM, hw, wy0 / 2, win.z, ry);
  plane(win.w, h - wy1, wallM, hw, (wy1 + h) / 2, win.z, ry);
  // 창틀 · 유리 · 커튼
  const fb = (sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(G(new THREE.BoxGeometry(sx, sy, sz)), frameM); o.position.set(x, y, z); o.castShadow = true; group.add(o); };
  fb(0.14, 0.06, win.w + 0.12, hw - 0.04, wy0 - 0.02, win.z);
  fb(0.1, 0.06, win.w + 0.12, hw - 0.02, wy1 + 0.02, win.z);
  fb(0.1, win.h + 0.1, 0.06, hw - 0.02, (wy0 + wy1) / 2, wz0 - 0.02);
  fb(0.1, win.h + 0.1, 0.06, hw - 0.02, (wy0 + wy1) / 2, wz1 + 0.02);
  fb(0.05, win.h, 0.04, hw - 0.02, (wy0 + wy1) / 2, win.z);
  fb(0.05, 0.04, win.w, hw - 0.02, (wy0 + wy1) / 2 + 0.1, win.z);
  const glass = new THREE.Mesh(G(new THREE.PlaneGeometry(win.w, win.h)), glassM);
  glass.position.set(hw - 0.01, (wy0 + wy1) / 2, win.z);
  glass.rotation.y = ry;
  group.add(glass);
  const curtainGeo = G(new THREE.PlaneGeometry(0.42, win.h + 0.5, 10, 1));
  const cp = curtainGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 30) * 0.03);
  curtainGeo.computeVertexNormals();
  for (const zc of [wz0 - 0.18, wz1 + 0.18]) {
    const c = new THREE.Mesh(curtainGeo, curtainM);
    c.position.set(hw - 0.09, (wy0 + wy1) / 2 + 0.1, zc);
    c.rotation.y = ry;
    c.castShadow = true;
    group.add(c);
  }
  const rod = new THREE.Mesh(G(new THREE.CylinderGeometry(0.012, 0.012, win.w + 1.0, 6).rotateX(Math.PI / 2)), trimM);
  rod.position.set(hw - 0.09, wy1 + 0.3, win.z);
  group.add(rod);
  // 걸레받이
  const base = (sx, sz, x, z) => { const o = new THREE.Mesh(G(new THREE.BoxGeometry(sx, 0.09, sz)), trimM); o.position.set(x, 0.045, z); group.add(o); };
  base(w, 0.025, 0, -hd + 0.012);
  base(w, 0.025, 0, hd - 0.012);
  base(0.025, d, -hw + 0.012, 0);
  base(0.025, d, hw - 0.012, 0);
  // 천장등
  const lamp = new THREE.Mesh(G(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 20)), lampM);
  lamp.position.set(0, h - 0.03, 0);
  group.add(lamp);

  // 창밖 풍경 판(창으로만 보인다)
  const outU = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHill: { value: new THREE.Color('#4c5e48') },
    uWater: { value: new THREE.Color('#3e6c70') },
    uLight: { value: 1 },
    uStars: { value: 0 },
  };
  const outM = new THREE.ShaderMaterial({ uniforms: outU, vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, fog: false });
  mats.push(outM);
  const out = new THREE.Mesh(G(new THREE.PlaneGeometry(14, 9)), outM);
  out.position.set(hw + 3.5, 1.6, win.z);
  out.rotation.y = ry;
  group.add(out);

  return {
    group,
    lampMat: lampM,
    lampPos: new THREE.Vector3(0, h - 0.45, 0),
    /** 창으로 드는 햇살 — 창 바깥 위에서 창 안쪽 바닥으로 */
    windowSun: { from: new THREE.Vector3(hw + 2.2, wy1 + 1.6, win.z), to: new THREE.Vector3(hw - 2.4, 0, win.z) },
    /** @param {THREE.Color} zenith @param {THREE.Color} horizon @param {number} light @param {number} stars */
    update(zenith, horizon, light, stars) {
      outU.uZenith.value.copy(zenith);
      outU.uHorizon.value.copy(horizon);
      outU.uLight.value = light;
      outU.uStars.value = stars;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
