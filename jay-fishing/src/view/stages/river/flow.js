// OWNER: P12 — 내부 파일 · 「강물 흐름이 보이는 물결」(§9.4): 하류(+X)로 떠내려가는 거품 줄(흐름 속도 = 자리 흐름의 보간) ·
// 물살에 하류로 기운 항로 부표(흔들림 · 뒤로 끌리는 물살 · 밤에 깜빡이는 등) · 물보라 위를 도는 갈매기.
// 정지 화면에서도 결이 하류 방향으로 길쭉하게 읽히게 거품 줄은 X 로 늘인다. 모두 수면 위의 납작한 것 — 자리 시야를 가리지 않는다.
// 프레임마다 유니폼만 바꾼다(할당 없음). three 만.

import * as THREE from 'three';
import { fogFragCapped, makeRand, mergeGeoms, shoreZ } from './kit.js';

const STREAK_COUNT = { low: 900, medium: 1800, high: 2800 };
const STREAK_MAX = 2800;
const STREAK_X = [-640, 640];          // 먼 거품 줄이 흐르는 x 구간(댐이 있으면 댐 바로 아래부터 하류 끝까지)
const NEAR_X = [-200, 260];            // 가까운 거품 줄(걷는 영역 앞 물) — 짧은 구간을 돌아 늘 촘촘하다
const NEAR_Z = 70;                     // 물가에서 이 거리까지
const STREAK_Y = 0.07;
const CHANNEL_BOOST = 1.25;            // 강 가운데는 물가보다 빠르다
const TAILRACE_BOOST = 1.6;            // 댐 바로 아래(방류)
const BUOYS = [
  { x: -330, z: -118, kind: 'can' }, { x: -150, z: -150, kind: 'nun' },
  { x: 60, z: -128, kind: 'can' }, { x: 290, z: -160, kind: 'nun' }, { x: 470, z: -126, kind: 'can' },
];
const BUOY_LEAN = 0.22;                // rad — 물살에 하류로 기운다
const GULLS = 16;

const STREAK_VERT = /* glsl */`
attribute vec4 aS;          // x0 · z · speed · len
attribute vec2 aW;          // width · phase
attribute vec2 aSpan;       // x loop: start · length
uniform float uTime;
varying float vA;
varying float vPh;
varying vec2 vUv;
${'#include <fog_pars_vertex>'}
void main() {
  vPh = aW.y * 50.0;
  float x = aSpan.x + mod(aS.x - aSpan.x + aS.z * uTime, aSpan.y);
  float life = fract(uTime * 0.04 * (0.6 + aS.z * 0.5) + aW.y);
  float wob = sin(uTime * 0.5 + aW.y * 31.0) * 0.6;
  vec3 p = vec3(x + position.x * aS.w, 0.0, aS.y + wob + position.z * aW.x);
  vA = sin(3.14159 * life) * smoothstep(0.0, 30.0, x - aSpan.x) * smoothstep(0.0, 30.0, aSpan.x + aSpan.y - x);
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${'#include <fog_vertex>'}
}`;
const STREAK_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
varying float vPh;
varying vec2 vUv;
${'#include <fog_pars_fragment>'}
void main() {
  float across = smoothstep(0.0, 0.7, 1.0 - abs(vUv.y - 0.5) * 2.0);
  float along = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.6, 1.0, vUv.x));
  float broken = 0.55 + 0.45 * sin(vUv.x * 17.0 + vPh) * sin(vUv.x * 7.0 + vPh * 0.3);
  float a = across * along * broken * vA * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  ${fogFragCapped(0.8)}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GULL_VERT = /* glsl */`
attribute vec4 aG;          // center x · center z · radius · phase
attribute vec2 aH;          // height · angular speed
uniform float uTime;
${'#include <fog_pars_vertex>'}
void main() {
  float a = aG.w * 6.2832 + uTime * aH.y;
  vec3 c = vec3(aG.x + cos(a) * aG.z, aH.x + sin(a * 2.0 + aG.w * 9.0) * 2.5, aG.y + sin(a) * aG.z);
  vec3 p = position * 1.6;
  p.y += abs(p.x) * sin(uTime * 7.0 + aG.w * 40.0) * 0.45;
  // heading: circle tangent becomes forward (-Z)
  float h = -a;
  float ch = cos(h);
  float sh = sin(h);
  p = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch);
  vec4 mvPosition = modelViewMatrix * vec4(c + p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${'#include <fog_vertex>'}
}`;
const GULL_FRAG = /* glsl */`
uniform vec3 uColor;
${'#include <fog_pars_fragment>'}
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  ${fogFragCapped(0.7)}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {{stage:import('../../../types.js').StageDef, quality:'low'|'medium'|'high', dam:{x:number, z:number, width:number}|null}} args
 */
export function buildFlow({ stage, quality, dam }) {
  const group = new THREE.Group();
  group.name = 'riverFlow';
  const geos = [];
  const mats = [];
  const rand = makeRand(5150);
  const spots = [...stage.spots].sort((a, b) => a.stand.x - b.stand.x);
  const farZ = typeof stage.look.ridge.farBankZ === 'number' ? stage.look.ridge.farBankZ : -260;
  const flowAt = (x) => {
    if (!spots.length) return 1;
    const sp = (s) => Math.hypot(s.flow.x, s.flow.z);
    if (x <= spots[0].stand.x) return sp(spots[0]);
    if (x >= spots[spots.length - 1].stand.x) return sp(spots[spots.length - 1]);
    for (let i = 1; i < spots.length; i++) if (x <= spots[i].stand.x) {
      const u = (x - spots[i - 1].stand.x) / (spots[i].stand.x - spots[i - 1].stand.x);
      return sp(spots[i - 1]) + (sp(spots[i]) - sp(spots[i - 1])) * u;
    }
    return 1;
  };
  const damX = dam ? dam.x : -900;
  const farSpan = [Math.max(STREAK_X[0], damX + 25), STREAK_X[1]];     // 댐 위(상류 저수면)에는 흐르지 않는다

  // ── 거품 줄
  const streakGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    streakGeo.index = quad.index;
    streakGeo.setAttribute('position', quad.attributes.position);
    streakGeo.setAttribute('uv', quad.attributes.uv);
    quad.dispose();
    const aS = new Float32Array(STREAK_MAX * 4);
    const aW = new Float32Array(STREAK_MAX * 2);
    const aSpan = new Float32Array(STREAK_MAX * 2);
    for (let i = 0; i < STREAK_MAX; i++) {
      // 화질로 앞쪽 n 개만 그리므로 가까운 줄(짝수)과 먼 줄(홀수)을 번갈아 둔다
      const near = i % 2 === 0;
      const span = near ? NEAR_X : farSpan;
      const x = span[0] + rand() * (span[1] - span[0]);
      const sz = shoreZ(stage, x) - 1.8;
      const far = farZ + 6;
      const z = near ? sz - Math.pow(rand(), 1.3) * NEAR_Z : sz + (far - sz) * rand();
      const t = (sz - z) / (sz - far);                 // 0 물가 → 1 건너편
      const mid = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      const tail = 1 + (TAILRACE_BOOST - 1) * Math.max(0, 1 - (x - damX) / 400);
      const speed = flowAt(x) * (1 + (CHANNEL_BOOST - 1) * mid) * tail * (0.85 + rand() * 0.3);
      aS[i * 4] = x;
      aS[i * 4 + 1] = z;
      aS[i * 4 + 2] = speed;
      aS[i * 4 + 3] = near ? 2.5 + rand() * 7 : 6 + rand() * 12 + t * 14;
      aW[i * 2] = near ? 0.3 + rand() * 0.6 : 0.6 + rand() * 0.8 + t * 1.8;
      aW[i * 2 + 1] = rand();
      aSpan[i * 2] = span[0];
      aSpan[i * 2 + 1] = span[1] - span[0];
    }
    streakGeo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
    streakGeo.setAttribute('aW', new THREE.InstancedBufferAttribute(aW, 2));
    streakGeo.setAttribute('aSpan', new THREE.InstancedBufferAttribute(aSpan, 2));
    streakGeo.instanceCount = STREAK_COUNT[quality] ?? STREAK_COUNT.medium;
  }
  geos.push(streakGeo);
  const streakMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#eef3f2') }, uAlpha: { value: 0.75 },
    }]),
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, fog: true,
  });
  mats.push(streakMat);
  const streaks = new THREE.Mesh(streakGeo, streakMat);
  streaks.name = 'flowStreaks';
  streaks.position.y = STREAK_Y;
  streaks.frustumCulled = false;
  streaks.renderOrder = 3;            // 물(renderOrder 2 · 투명 · 깊이 씀) 다음에
  group.add(streaks);

  // ── 항로 부표(기울기 · 흔들림 · 뒤로 끌리는 물살 · 밤 등)
  const canGeo = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.62, 0.66, 1.5, 12).translate(0, 0.45, 0), color: '#2f7a3e' },
    { geo: new THREE.CylinderGeometry(0.66, 0.66, 0.3, 12).translate(0, -0.3, 0), color: '#26302a' },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6).translate(0, 1.6, 0), color: '#3a3a3a' },
  ]);
  const nunGeo = mergeGeoms([
    { geo: new THREE.CylinderGeometry(0.66, 0.66, 0.6, 12).translate(0, 0.0, 0), color: '#b8342c' },
    { geo: new THREE.ConeGeometry(0.66, 1.4, 12).translate(0, 1.0, 0), color: '#b8342c' },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6).translate(0, 1.95, 0), color: '#3a3a3a' },
  ]);
  const wakeGeo = (() => {
    const g = new THREE.BufferGeometry();
    // 하류(+X)로 벌어지는 V — 두 띠
    const pos = [0, 0, -0.5, 9, 0, -2.6, 9, 0, -1.6, 0, 0, 0.5, 9, 0, 1.6, 9, 0, 2.6];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex([0, 2, 1, 3, 4, 5]);
    g.computeVertexNormals();
    return g;
  })();
  const lampGeo = new THREE.SphereGeometry(0.14, 8, 6);
  geos.push(canGeo, nunGeo, wakeGeo, lampGeo);
  const buoyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  const wakeMat = new THREE.MeshBasicMaterial({ color: '#e8eeee', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
  const greenLamp = new THREE.MeshStandardMaterial({ color: '#204a28', emissive: '#40ff70', emissiveIntensity: 0 });
  const redLamp = new THREE.MeshStandardMaterial({ color: '#4a2020', emissive: '#ff4040', emissiveIntensity: 0 });
  mats.push(buoyMat, wakeMat, greenLamp, redLamp);
  /** @type {Array<{obj:THREE.Group, phase:number, lamp:THREE.MeshStandardMaterial}>} */
  const buoys = [];
  for (const b of BUOYS) {
    const holder = new THREE.Group();
    holder.position.set(b.x, 0, b.z);
    const body = new THREE.Group();
    body.rotation.z = -BUOY_LEAN;
    const mesh = new THREE.Mesh(b.kind === 'can' ? canGeo : nunGeo, buoyMat);
    mesh.castShadow = true;
    body.add(mesh);
    const lamp = new THREE.Mesh(lampGeo, b.kind === 'can' ? greenLamp : redLamp);
    lamp.position.y = b.kind === 'can' ? 2.1 : 2.3;
    body.add(lamp);
    holder.add(body);
    const wake = new THREE.Mesh(wakeGeo, wakeMat);
    wake.position.set(0.4, 0.06, 0);
    wake.renderOrder = 3;
    holder.add(wake);
    group.add(holder);
    buoys.push({ obj: body, phase: rand() * 6.28, lamp: b.kind === 'can' ? greenLamp : redLamp });
  }

  // ── 갈매기(물보라 위 · 강 위를 돈다)
  const gullGeo = new THREE.InstancedBufferGeometry();
  {
    const v = new THREE.BufferGeometry();
    const pos = [-0.9, 0.12, 0.1, 0, 0, -0.18, 0, 0, 0.28, 0, 0, -0.18, 0.9, 0.12, 0.1, 0, 0, 0.28, 0, 0, -0.32, 0.07, 0, 0.3, -0.07, 0, 0.3];
    v.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gullGeo.setAttribute('position', v.attributes.position);
    v.dispose();
    const aG = new Float32Array(GULLS * 4);
    const aH = new Float32Array(GULLS * 2);
    for (let i = 0; i < GULLS; i++) {
      const nearDam = i < 10 && dam;
      aG[i * 4] = nearDam ? damX + 60 + rand() * 120 : -250 + rand() * 500;
      aG[i * 4 + 1] = nearDam ? dam.z + (rand() - 0.5) * 120 : -70 - rand() * 120;
      aG[i * 4 + 2] = 14 + rand() * 30;
      aG[i * 4 + 3] = rand();
      aH[i * 2] = 10 + rand() * 22;
      aH[i * 2 + 1] = (rand() < 0.5 ? -1 : 1) * (0.12 + rand() * 0.14);
    }
    gullGeo.setAttribute('aG', new THREE.InstancedBufferAttribute(aG, 4));
    gullGeo.setAttribute('aH', new THREE.InstancedBufferAttribute(aH, 2));
    gullGeo.instanceCount = GULLS;
  }
  geos.push(gullGeo);
  const gullMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color('#e6e8e8') } }]),
    vertexShader: GULL_VERT, fragmentShader: GULL_FRAG, fog: true, side: THREE.DoubleSide,
  });
  mats.push(gullMat);
  const gulls = new THREE.Mesh(gullGeo, gullMat);
  gulls.name = 'gulls';
  gulls.frustumCulled = false;
  group.add(gulls);

  const base = new THREE.Color('#eef3f2');
  const gullBase = new THREE.Color('#e6e8e8');
  return {
    group,
    /** @param {{time:number, light:number, night:boolean, weather:string}} env */
    update(env) {
      const day = Math.max(0.1, Math.min(1, env.light));
      streakMat.uniforms.uTime.value = env.time;
      streakMat.uniforms.uColor.value.copy(base).multiplyScalar(0.22 + 0.78 * day);
      streakMat.uniforms.uAlpha.value = (env.weather === 'rain' ? 0.55 : 0.75) * (0.45 + 0.55 * day);   // 밤에는 헤드랜턴 · 달빛에 비친 만큼만
      gullMat.uniforms.uTime.value = env.time;
      gullMat.uniforms.uColor.value.copy(gullBase).multiplyScalar(0.15 + 0.85 * day);
      gulls.visible = !env.night;
      for (let i = 0; i < buoys.length; i++) {
        const b = buoys[i];
        b.obj.position.y = Math.sin(env.time * 1.6 + b.phase) * 0.09;
        b.obj.rotation.x = Math.sin(env.time * 1.1 + b.phase * 2) * 0.05;
      }
      const blink = (env.time % 4) < 0.5;
      const on = env.night || env.light < 0.45;
      greenLamp.emissiveIntensity = on ? (blink ? 3.2 : 0.15) : 0;
      redLamp.emissiveIntensity = on ? ((env.time + 2) % 4 < 0.5 ? 3.2 : 0.15) : 0;
    },
    setQuality(q) { streakGeo.instanceCount = STREAK_COUNT[q] ?? STREAK_COUNT.medium; },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
