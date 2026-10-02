// OWNER: P5 — 내부 파일 · 비(카메라를 따라다니는 빗줄기 — 선분 한 번의 draw call) · 안개 입자(수면 위 물안개).
// 둘 다 최대 개수를 부팅 때 만들고 화질은 drawRange 로만 바꾼다(지오메트리가 늘지 않는다).

import * as THREE from 'three';

const RAIN_MAX = 3000;
const RAIN_BOX = 36;         // m — 카메라 둘레 상자(수평)
const RAIN_HEIGHT = 18;
const RAIN_SPEED = 13;       // m/s
const RAIN_LEN = 0.55;
const MIST_MAX = 140;
const MIST_BOX = 150;

const RAIN_VERT = /* glsl */`
attribute float aEnd;
uniform vec3 uCam;
uniform float uTime;
uniform vec2 uWind;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float box = ${RAIN_BOX.toFixed(1)};
  float hgt = ${RAIN_HEIGHT.toFixed(1)};
  float fall = uTime * ${RAIN_SPEED.toFixed(1)} * (0.85 + 0.3 * fract(position.x * 7.13));
  vec3 wp;
  wp.x = uCam.x + mod(position.x * box - uCam.x + uWind.x * fall * 0.1, box) - box * 0.5;
  wp.z = uCam.z + mod(position.z * box - uCam.z + uWind.y * fall * 0.1, box) - box * 0.5;
  wp.y = uCam.y - hgt * 0.35 + mod(position.y * hgt - fall - uCam.y, hgt);
  vec3 dir = normalize(vec3(uWind.x * 0.1, -1.0, uWind.y * 0.1));
  wp -= dir * ${RAIN_LEN.toFixed(2)} * aEnd;
  vA = mix(0.0, 1.0, aEnd) * 0.6 + 0.4;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const RAIN_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vA);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const MIST_VERT = /* glsl */`
attribute float aSize;
uniform vec3 uCam;
uniform float uTime;
uniform float uScale;
varying float vFade;
void main() {
  float box = ${MIST_BOX.toFixed(1)};
  vec3 wp;
  wp.x = uCam.x + mod(position.x * box - uCam.x + uTime * 0.25, box) - box * 0.5;
  wp.z = uCam.z + mod(position.z * box - uCam.z + uTime * 0.08, box) - box * 0.5;
  wp.y = position.y;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vFade = smoothstep(4.0, 14.0, d) * (1.0 - smoothstep(box * 0.32, box * 0.5, length(wp.xz - uCam.xz)));
  gl_PointSize = clamp(aSize * uScale / max(d, 1.0), 1.0, 900.0);
}`;
const MIST_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(uColor, a * a * uAlpha * vFade);
  #include <colorspace_fragment>
}`;

export function createRain() {
  const pos = new Float32Array(RAIN_MAX * 2 * 3);
  const end = new Float32Array(RAIN_MAX * 2);
  let s = 987654321;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < RAIN_MAX; i++) {
    const x = rnd();
    const y = rnd();
    const z = rnd();
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      end[i * 2 + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(1.5, 0.6) },
    uColor: { value: new THREE.Color('#c8d2dc') },
    uAlpha: { value: 0.3 },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
    transparent: true, depthWrite: false, fog: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  lines.visible = false;
  return {
    object: lines,
    uniforms,
    setCount(n) { geo.setDrawRange(0, Math.max(0, Math.min(RAIN_MAX, n)) * 2); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export function createMist() {
  const pos = new Float32Array(MIST_MAX * 3);
  const size = new Float32Array(MIST_MAX);
  let s = 24681357;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < MIST_MAX; i++) {
    pos[i * 3] = rnd();
    pos[i * 3 + 1] = 0.4 + rnd() * 2.6;
    pos[i * 3 + 2] = rnd();
    size[i] = 9 + rnd() * 12;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uScale: { value: 360 },
    uColor: { value: new THREE.Color() },
    uAlpha: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG,
    transparent: true, depthWrite: false, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'mist';
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.visible = false;
  return {
    object: pts,
    uniforms,
    setCount(n) { geo.setDrawRange(0, Math.max(0, Math.min(MIST_MAX, n))); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
