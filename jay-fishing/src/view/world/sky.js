// OWNER: P5 — 내부 파일 · 하늘 돔(그라데이션 · 박명 · 해 원반 · 달 · 구름층) · 별 · CPU 쪽 하늘색 계산.
// 하늘색은 한 곳(computeSky)에서 정하고 안개 · 반구광 · 물 반사 · 원경 안개가 같은 값을 쓴다(지평선이 이어진다).

import * as THREE from 'three';
import { clamp01, smoothstep } from '../../core/math.js';
import { WEATHER } from '../../data/weather.js';

// 연출 상수
const NIGHT_ZENITH = '#050a18';
const NIGHT_HORIZON = '#152036';
const TWILIGHT_HORIZON = '#e8804a';
const TWILIGHT_ZENITH = '#3a4c86';
const GLOW_COLOR = '#ff9346';
const CLOUD_COVER = { clear: 0.22, cloudy: 0.72, rain: 0.93 };
const SUN_DIRECT = { clear: 1.0, cloudy: 0.38, rain: 0.22 };   // 구름이 직사광을 가리는 정도
const SKY_RADIUS = 1900;
const STAR_COUNT = 1400;

const _nz = new THREE.Color(NIGHT_ZENITH);
const _nh = new THREE.Color(NIGHT_HORIZON);
const _th = new THREE.Color(TWILIGHT_HORIZON);
const _tz = new THREE.Color(TWILIGHT_ZENITH);
const _dz = new THREE.Color();
const _dh = new THREE.Color();
const _gray = new THREE.Color();

function overcast(c, grey, light) {
  const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
  _gray.setRGB(l, l, l * 1.04);
  c.lerp(_gray, grey * 0.75);
  c.multiplyScalar(0.55 + 0.45 * light);
}

/**
 * 지금 시각 · 날씨의 하늘 — out 에 써 넣는다(할당 없음).
 * @param {{zenith:string, horizon:string}} skyLook
 * @param {{sunElev:number, light:number}} clock
 * @param {string} weatherId
 * @param {{zenith:THREE.Color, horizon:THREE.Color, glow:number, day:number, twilight:number, cloud:number, sunDirect:number, starVis:number}} out
 */
export function computeSky(skyLook, clock, weatherId, out) {
  const w = WEATHER[weatherId] || WEATHER.clear;
  const el = clock.sunElev;
  const day = smoothstep(-0.14, 0.22, el);
  const tw = 1 - smoothstep(0.0, 0.32, Math.abs(el - 0.04));      // 해 고도 −0.28..0.36 근처에서 박명
  _dz.set(skyLook.zenith);
  _dh.set(skyLook.horizon);
  out.zenith.copy(_nz).lerp(_dz, day);
  out.horizon.copy(_nh).lerp(_dh, day);
  out.horizon.lerp(_th, tw * 0.62);
  out.zenith.lerp(_tz, tw * 0.3);
  const cloud = CLOUD_COVER[weatherId] ?? CLOUD_COVER.clear;
  // 흐림 · 비: 채도를 낮추고 어둡게
  const grey = clamp01((cloud - 0.22) / 0.7);
  if (grey > 0) {
    overcast(out.zenith, grey, w.light);
    overcast(out.horizon, grey, w.light);
  }
  out.glow = tw * (1 - grey * 0.7);
  out.day = day;
  out.twilight = tw;
  out.cloud = cloud;
  out.sunDirect = SUN_DIRECT[weatherId] ?? 1;
  out.starVis = (1 - smoothstep(0.1, 0.3, clock.light)) * (1 - cloud * 0.85);
  return out;
}

export function makeSkyOut() {
  return { zenith: new THREE.Color(), horizon: new THREE.Color(), glow: 0, day: 1, twilight: 0, cloud: 0, sunDirect: 1, starVis: 0 };
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uDay;
uniform float uCloud;
uniform float uTime;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // below horizon: slightly darker horizon color
  if (h < 0.0) col = uHorizon * mix(1.0, 0.82, smoothstep(0.0, -0.25, h));
  // twilight glow toward the sun
  float sunAmt = max(dot(d, uSunDir), 0.0);
  col += uGlowColor * uGlow * (pow(sunAmt, 5.0) * 0.9 + pow(sunAmt, 48.0) * 0.6) * (1.0 - smoothstep(0.0, 0.55, up));
  // sun disc + halo
  float sd = dot(d, uSunDir);
  float sunDisc = smoothstep(0.99955, 0.99975, sd);
  float sunHalo = pow(max(sd, 0.0), 220.0) * 0.6 + pow(max(sd, 0.0), 18.0) * 0.12 * uDay;
  // moon disc (gibbous) + halo
  float md = dot(d, uMoonDir);
  float moonDisc = smoothstep(0.99965, 0.99982, md);
  vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  float shade = smoothstep(-0.004, 0.006, dot(d - uMoonDir * md, side) + 0.006);
  float moonHalo = pow(max(md, 0.0), 400.0) * 0.35;
  float aboveSun = smoothstep(-0.02, 0.02, uSunDir.y);
  float aboveMoon = smoothstep(-0.02, 0.02, uMoonDir.y) * (1.0 - uDay);
  // cloud layer (planar fbm)
  float cl = 0.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv * 1.6);
    float cover = uCloud;
    cl = smoothstep(1.0 - cover - 0.08, 1.0 - cover + 0.28, n) * smoothstep(0.0, 0.12, h);
    cl = clamp(cl * (0.55 + cover * 0.5), 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, smoothstep(0.35, 0.85, n) * 0.7 + sunAmt * 0.3);
    cc += uGlowColor * uGlow * pow(sunAmt, 3.0) * 0.6;
    col = mix(col, cc, cl);
  }
  float veil = 1.0 - cl;
  col += uSunColor * (sunDisc * 6.0 + sunHalo) * aboveSun * veil;
  col += vec3(0.92, 0.94, 1.0) * (moonDisc * mix(0.25, 1.4, shade) + moonHalo) * aboveMoon * (1.0 - cl * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying float vTw;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99998;
  vTw = 0.7 + 0.3 * sin(uTime * (1.3 + aPhase) + aPhase * 40.0);
  gl_PointSize = aSize;
}`;
const STAR_FRAG = /* glsl */`
uniform float uVis;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), a * uVis * vTw);
}`;

/** 하늘 돔 + 별 — 카메라를 따라간다 */
export function createSky() {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color(GLOW_COLOR) },
    uGlow: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunColor: { value: new THREE.Color('#fff2d6') },
    uDay: { value: 1 },
    uCloud: { value: 0.2 },
    uTime: { value: 0 },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudDark: { value: new THREE.Color('#9aa4b0') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = -10;

  // 별: 위 반구에 고르게
  const pos = new Float32Array(STAR_COUNT * 3);
  const size = new Float32Array(STAR_COUNT);
  const phase = new Float32Array(STAR_COUNT);
  let s = 1234567;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = 0.04 + 0.96 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * (SKY_RADIUS - 20);
    pos[i * 3 + 1] = y * (SKY_RADIUS - 20);
    pos[i * 3 + 2] = Math.sin(a) * r * (SKY_RADIUS - 20);
    const m = rnd();
    size[i] = m > 0.97 ? 3.2 : m > 0.85 ? 2.3 : 1.5;
    phase[i] = rnd();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const starUniforms = { uVis: { value: 0 }, uTime: { value: 0 } };
  const sm = new THREE.ShaderMaterial({
    uniforms: starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(sg, sm);
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -9;

  const group = new THREE.Group();
  group.name = 'skyRoot';
  group.add(dome, stars);

  const _cloudLit = new THREE.Color();
  return {
    group,
    uniforms,
    /** @param {ReturnType<typeof makeSkyOut>} sky @param {THREE.Vector3} sunDir @param {THREE.Vector3} moonDir */
    update(sky, sunDir, moonDir, camPos, time) {
      group.position.copy(camPos);
      uniforms.uZenith.value.copy(sky.zenith);
      uniforms.uHorizon.value.copy(sky.horizon);
      uniforms.uGlow.value = sky.glow;
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uMoonDir.value.copy(moonDir);
      uniforms.uDay.value = sky.day;
      uniforms.uCloud.value = sky.cloud;
      uniforms.uTime.value = time;
      // 구름 색: 낮 흰 · 흐림 회색 · 밤 어두운 회청
      _cloudLit.setRGB(1, 1, 1).lerp(sky.horizon, 0.25).multiplyScalar(0.12 + 0.95 * sky.day * (1 - (sky.cloud - 0.22) * 0.5));
      uniforms.uCloudLit.value.copy(_cloudLit);
      uniforms.uCloudDark.value.copy(_cloudLit).multiplyScalar(0.55 + 0.1 * sky.day).lerp(sky.zenith, 0.25);
      starUniforms.uVis.value = sky.starVis;
      starUniforms.uTime.value = time;
      stars.visible = sky.starVis > 0.01;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      sg.dispose();
      sm.dispose();
    },
  };
}

/** 해 · 달 방향 — clock(sunElev · sunAzim, yaw 규약)에서. 달은 해의 반대 방위 · 고도 −sunElev(§9.3) */
export function sunMoonDirs(clock, sunDir, moonDir) {
  const el = clock.sunElev;
  const az = clock.sunAzim;
  const ce = Math.cos(el);
  sunDir.set(-Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce).normalize();
  const maz = az + Math.PI;
  moonDir.set(-Math.sin(maz) * ce, Math.sin(-el), -Math.cos(maz) * ce).normalize();
}
