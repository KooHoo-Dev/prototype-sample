// OWNER: P5 — 내부 파일 · 물(y = 0 평면) — 파도 · 흐름 무늬 · 깊이 색 · 프레넬 반사 3단계 · 달빛 반짝임 · 빗방울 파문 · 물가 거품.
// 반사 단계(QUALITY.waterReflect): none = 단색 · sky = 하늘색 반사 · planar = 반사 렌더 타깃(½ 해상도). 정점 파도는 high 만(uDisplace).

import * as THREE from 'three';
import { buildAxis, DEPTH_TEX_MAX } from './terrain.js';

const WATER_VERT = /* glsl */`
uniform float uTime;
uniform float uWaveAmp;
uniform float uWaveLen;
uniform float uDisplace;
uniform mat4 uTexMatrix;
varying vec3 vWorld;
varying vec4 vReflUv;
#include <fog_pars_vertex>
float waveH(vec2 p) {
  float k = 6.2831853 / uWaveLen;
  float c = uWaveLen / max(0.5, uWaveLen * 0.2);
  float h = sin(dot(p, vec2(0.12, 0.99)) * k - uTime * k * c * 0.35) * 0.55;
  h += sin(dot(p, vec2(-0.6, 0.8)) * k * 1.63 - uTime * k * c * 0.42) * 0.3;
  h += sin(dot(p, vec2(0.85, 0.53)) * k * 2.7 - uTime * k * c * 0.5) * 0.15;
  return h * uWaveAmp;
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  if (uDisplace > 0.5) {
    float fade = 1.0 - smoothstep(60.0, 180.0, length(wp.xz - cameraPosition.xz));
    wp.y += waveH(wp.xz) * fade;
  }
  vWorld = wp.xyz;
  vReflUv = uTexMatrix * wp;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform float uWaveAmp;
uniform float uWaveLen;
uniform vec2 uFlow;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightAmt;
uniform vec3 uAmbient;
uniform float uOpacity;
uniform float uReflectMode;
uniform float uRain;
uniform float uRipples;
uniform float uFoam;
uniform float uNight;
uniform sampler2D uDepthTex;
uniform vec4 uDepthRect;
uniform sampler2D uReflTex;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform float uLamp;
varying vec3 vWorld;
varying vec4 vReflUv;
#include <fog_pars_fragment>

float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.0)); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
// directional wave gradient (dh/dx, dh/dz)
vec2 waveGrad(vec2 p, vec2 dir, float k, float spd, float a) {
  float ph = dot(p, dir) * k - uTime * spd;
  return dir * (cos(ph) * k * a);
}
vec3 skyCol(vec3 d) {
  float up = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.55));
  float s = max(dot(d, uLightDir), 0.0);
  c += uGlowColor * uGlow * pow(s, 5.0) * 0.8;
  return c;
}

void main() {
  vec3 P = vWorld;
  float dist = length(P.xz - cameraPosition.xz);
  float detailFade = 1.0 - smoothstep(25.0, 140.0, dist);
  // swell + ripples advected by flow
  float k = 6.2831853 / uWaveLen;
  float amp = uWaveAmp;
  vec2 g = vec2(0.0);
  g += waveGrad(P.xz, vec2(0.12, 0.99), k, k * 1.6, amp * 0.55);
  g += waveGrad(P.xz, normalize(vec2(-0.6, 0.8)), k * 1.63, k * 2.1, amp * 0.3);
  g += waveGrad(P.xz, normalize(vec2(0.85, 0.53)), k * 2.7, k * 2.8, amp * 0.15);
  vec2 fl = uFlow * uTime;
  vec2 q = P.xz - fl;
  float e = 0.06;
  float r0 = vnoise(q * 1.7 + uTime * 0.15) + 0.5 * vnoise(q * 4.1 - uTime * 0.25);
  float rx = vnoise((q + vec2(e, 0.0)) * 1.7 + uTime * 0.15) + 0.5 * vnoise((q + vec2(e, 0.0)) * 4.1 - uTime * 0.25);
  float rz = vnoise((q + vec2(0.0, e)) * 1.7 + uTime * 0.15) + 0.5 * vnoise((q + vec2(0.0, e)) * 4.1 - uTime * 0.25);
  float rippleAmp = 0.022 + uWaveAmp * 0.08;
  g += vec2(rx - r0, rz - r0) / e * rippleAmp * detailFade;
  // flow streaks (river)
  float flowLen = length(uFlow);
  float streak = 0.0;
  if (flowLen > 0.02) {
    vec2 fd = uFlow / flowLen;
    vec2 sp = vec2(dot(P.xz, fd), dot(P.xz, vec2(-fd.y, fd.x)));
    streak = vnoise(vec2(sp.x * 0.15 - uTime * flowLen * 0.15, sp.y * 1.3)) * vnoise(vec2(sp.x * 0.05 - uTime * flowLen * 0.05, sp.y * 0.4));
    streak = smoothstep(0.25, 0.6, streak) * min(1.0, flowLen) * detailFade;
  }
  // rain ripples (one ring per cell)
  float rings = 0.0;
  if (uRipples > 0.5 && uRain > 0.01) {
    vec2 rg = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float cell = L == 0 ? 0.9 : 1.37;
      vec2 cp = P.xz / cell + float(L) * 7.31;
      vec2 id = floor(cp);
      vec2 f = fract(cp);
      vec2 rnd = h22(id);
      float t = fract(uTime * (0.9 + rnd.x * 0.6) + rnd.y);
      vec2 dv = f - (0.2 + rnd * 0.6);
      float d = length(dv);
      float rad = t * 0.45;
      float w = exp(-pow((d - rad) * 30.0, 2.0)) * (1.0 - t) * (1.0 - t) * uRain * step(0.35, rnd.x);
      rings += w;
      rg += normalize(dv + 1e-4) * w;
    }
    float near = 1.0 - smoothstep(10.0, 40.0, dist);
    g += rg * 0.22 * near;
    rings *= near;
  }
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - P);
  // depth color
  vec2 duv = vec2((P.x - uDepthRect.x) * uDepthRect.z, (P.z - uDepthRect.y) * uDepthRect.w);
  vec4 dt = texture2D(uDepthTex, duv);
  float inside = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
  float depth = mix(${DEPTH_TEX_MAX.toFixed(1)}, dt.r * ${DEPTH_TEX_MAX.toFixed(1)}, inside);
  float shoreNear = dt.g * inside;
  float df = smoothstep(0.2, 7.0, depth);
  vec3 body = mix(uShallow, uDeep, df);
  float ndl = max(dot(N, uLightDir), 0.0);
  vec3 lit = body * (uAmbient + uLightColor * uLightAmt * (0.35 + 0.65 * ndl));
  lit += body * streak * 0.35 * (uAmbient + uLightColor * uLightAmt);
  // reflection
  float cosV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyCol(R);
  if (uReflectMode > 1.5) {
    vec2 ruv = vReflUv.xy / vReflUv.w + N.xz * 0.025;
    vec3 pr = texture2D(uReflTex, ruv).rgb;
    refl = pr;
  }
  float reflAmt = uReflectMode > 0.5 ? fres : fres * 0.35;
  vec3 col = mix(lit, refl, clamp(reflAmt, 0.0, 1.0));
  // sun / moon glint
  float spec = pow(max(dot(R, uLightDir), 0.0), mix(220.0, 90.0, uNight));
  col += uLightColor * spec * uLightAmt * mix(2.2, 3.5, uNight);
  // headlamp on near water
  if (uLamp > 0.01) {
    vec3 Lv = P - uLampPos;
    float ld = length(Lv);
    float cone = smoothstep(0.80, 0.97, dot(Lv / ld, uLampDir));
    float att = uLamp * cone / (1.0 + ld * ld * 0.02);
    col += (body * 0.5 + 0.03) * vec3(1.0, 0.95, 0.85) * att * 0.45;
    vec3 H = normalize(-Lv / ld + V);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(N, H), 0.0), 90.0) * att * 1.6;
  }
  // ripple highlight
  col += (uAmbient + uLightColor * uLightAmt * 0.4) * rings * 0.12;
  // shore foam
  float alpha = mix(0.5, uOpacity, smoothstep(0.0, 2.2, depth));
  if (uFoam > 0.5) {
    float fn = vnoise(P.xz * 1.3 + vec2(uTime * 0.3, -uTime * 0.2)) * vnoise(P.xz * 0.37 - uTime * 0.1);
    float band = shoreNear * (0.6 + 0.4 * sin(uTime * 1.1 + P.x * 0.13));
    float foam = smoothstep(0.18, 0.4, fn + band * 0.5) * smoothstep(0.05, 0.6, band + shoreNear * 0.4);
    vec3 fc = vec3(0.92, 0.95, 0.96) * (uAmbient + uLightColor * uLightAmt * 0.8);
    col = mix(col, fc, foam * 0.85);
    alpha = max(alpha, foam);
  }
  alpha = max(alpha, fres * 0.8);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * 스테이지 하나의 물 — 반경 3km(강은 farBankZ 까지).
 * @param {{stage:Object, depthTex:{texture:THREE.Texture, rect:THREE.Vector4}, reflTex:THREE.Texture}} args
 */
export function createWater({ stage, depthTex, reflTex }) {
  const look = stage.look.water;
  const farBankZ = stage.look.ridge && typeof stage.look.ridge.farBankZ === 'number' ? stage.look.ridge.farBankZ : null;
  const isRiver = stage.ambience === 'river';
  let zMax = -Infinity;
  for (const p of stage.shore) zMax = Math.max(zMax, p.z);
  zMax += 3;
  const zMin = isRiver && farBankZ !== null ? farBankZ - 6 : -3000;
  const xs = buildAxis(-3000, 3000, -40, 40, 2.5, 0.12);
  const zs = buildAxis(zMin, zMax, -40, zMax, 2.5, 0.12);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  let p = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    pos[p++] = xs[i];
    pos[p++] = 0;
    pos[p++] = zs[j];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i;
    idx[q++] = a; idx[q++] = a + nx; idx[q++] = a + 1;
    idx[q++] = a + 1; idx[q++] = a + nx; idx[q++] = a + nx + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const flowDir = look.flowDir || null;
  let flow = new THREE.Vector2(0, 0);
  if (flowDir) {
    // 흐름 세기: 자리 흐름의 평균 크기
    let sum = 0;
    for (const sp of stage.spots) sum += Math.hypot(sp.flow.x, sp.flow.z);
    const sp = stage.spots.length ? sum / stage.spots.length : 1;
    const l = Math.hypot(flowDir.x, flowDir.z) || 1;
    flow = new THREE.Vector2(flowDir.x / l * sp, flowDir.z / l * sp);
  } else if (stage.spots.length) {
    let fx = 0;
    let fz = 0;
    for (const sp of stage.spots) { fx += sp.flow.x; fz += sp.flow.z; }
    flow.set(fx / stage.spots.length, fz / stage.spots.length);
    if (flow.length() < 0.08) flow.set(0.03, 0.015);   // 정수에도 아주 느린 물결 표류
  }

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uWaveAmp: { value: 0.03 },
    uWaveLen: { value: 14 },
    uDisplace: { value: 0 },
    uTexMatrix: { value: new THREE.Matrix4() },
    uFlow: { value: new THREE.Vector2() },
    uShallow: { value: new THREE.Color(look.shallow) },
    uDeep: { value: new THREE.Color(look.deep) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color('#ff9346') },
    uGlow: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uLightAmt: { value: 1 },
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uOpacity: { value: look.opacity ?? 0.88 },
    uReflectMode: { value: 1 },
    uRain: { value: 0 },
    uRipples: { value: 0 },
    uFoam: { value: look.foam ? 1 : 0 },
    uNight: { value: 0 },
    uDepthTex: { value: null },
    uDepthRect: { value: new THREE.Vector4() },
    uReflTex: { value: null },
    uLampPos: { value: new THREE.Vector3() },
    uLampDir: { value: new THREE.Vector3(0, 0, -1) },
    uLamp: { value: 0 },
  }]);
  uniforms.uFlow.value.copy(flow);
  uniforms.uDepthTex.value = depthTex.texture;
  uniforms.uDepthRect.value.copy(depthTex.rect);
  uniforms.uReflTex.value = reflTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, fog: true, depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `water:${stage.id}`;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, uniforms, geo, mat };
}

/** 평면 반사(high) — 물 메시의 onBeforeRender 에서 거울 카메라로 ½ 해상도 렌더 타깃에 그린다(three Reflector 방식) */
export class PlanarReflection {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.virtualCam = new THREE.PerspectiveCamera();
    this.texMatrix = new THREE.Matrix4();
    this.enabled = false;
    this._rendering = false;
    this._normal = new THREE.Vector3(0, 1, 0);
    this._camPos = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._size = new THREE.Vector2();
    this._origin = new THREE.Vector3(0, 0, 0);
  }

  /** @param {THREE.WebGLRenderer} renderer @param {THREE.Scene} scene @param {THREE.Camera} camera @param {THREE.Object3D} waterMesh */
  render(renderer, scene, camera, waterMesh) {
    if (!this.enabled || this._rendering) return;
    const cam = /** @type {THREE.PerspectiveCamera} */ (camera);
    this._camPos.setFromMatrixPosition(cam.matrixWorld);
    if (this._camPos.y <= 0.01) return;
    renderer.getDrawingBufferSize(this._size);
    const w = Math.max(16, Math.floor(this._size.x / 2));
    const h = Math.max(16, Math.floor(this._size.y / 2));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const n = this._normal;
    const o = this._origin;
    // 수면 위 카메라의 거울 위치 = (x, −y, z)
    this._view.set(this._camPos.x, -this._camPos.y, this._camPos.z);
    this._rot.extractRotation(cam.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(this._camPos);
    this._target.set(this._look.x, -this._look.y, this._look.z);
    const vc = this.virtualCam;
    vc.position.copy(this._view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(n);
    vc.lookAt(this._target);
    vc.far = cam.far;
    vc.near = cam.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(cam.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // 비스듬한 근평면 — 수면 아래를 잘라낸다
    this._plane.setFromNormalAndCoplanarPoint(n, o).applyMatrix4(vc.matrixWorldInverse);
    const c = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = vc.projectionMatrix.elements;
    const qv = this._q;
    qv.x = (Math.sign(c.x) + pm[8]) / pm[0];
    qv.y = (Math.sign(c.y) + pm[9]) / pm[5];
    qv.z = -1.0;
    qv.w = (1.0 + pm[10]) / pm[14];
    c.multiplyScalar(2.0 / c.dot(qv));
    pm[2] = c.x;
    pm[6] = c.y;
    pm[10] = c.z + 1.0 - 0.003;
    pm[14] = c.w;

    this._rendering = true;
    const prevTarget = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    waterMesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    waterMesh.visible = true;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.setRenderTarget(prevTarget);
    const vp = /** @type {any} */ (cam).viewport;
    if (vp !== undefined) renderer.state.viewport(vp);
    this._rendering = false;
  }

  dispose() { this.rt.dispose(); }
}
