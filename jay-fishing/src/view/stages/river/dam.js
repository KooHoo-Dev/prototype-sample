// OWNER: P12 — 내부 파일 · 상류의 보너빌 댐(§9.4 「상류의 보너빌 댐 구조물(실루엣 · 방류구 물보라)」).
// 강을 가로지르는 콘크리트 실루엣: 건너편 발전소(2호) · 여수로 수문 18칸(교각 · 수문 · 도로 · 갠트리 크레인) · 브래드퍼드섬 · 이쪽 발전소(1호) · 갑문.
// 열린 수문 아래로 흰 물이 쏟아지고(흐르는 거품 경사면) · 물보라가 하류로 날리며(빌보드 입자) · 방류구 아래 수면이 끓는다(거품 판).
// 원경이라 장면 안개를 상한까지만 먹는다(실루엣이 남게). 밤에는 크레스트 등 · 발전소 창이 켜진다(빛을 더하지 않는다 — 발광 재질만).
// 국소 좌표: 원점 = look.dam (x, z) · +x = 하류(+X) · z = 월드 z 오프셋. three 만.

import * as THREE from 'three';
import { box, dataTexture, fogFragCapped, hazedStandard, makeRand, mergeGeoms, noiseGrid } from './kit.js';

const HAZE_CAP = 0.5;                // 원경 안개 상한
const FX_HAZE_CAP = 0.6;             // 물보라 · 흰 물은 조금 더 남는다
const SPILL_BAYS = 18;
const OPEN_BAYS = [3, 4, 5, 6, 8, 9, 10, 11, 13, 14];   // 열린 수문(흰 물이 쏟아진다)
const CONCRETE = '#a8a396';
const CONCRETE_DARK = '#7a766c';
const STEEL = '#4c5258';
const GANTRY = '#9a3a2a';
const ISLAND_ROCK = '#5a5a4c';
const ISLAND_GREEN = '#2f4630';
const SPRAY_COUNT = { low: 70, medium: 150, high: 240 };
const SPRAY_MAX = 240;

const SPRAY_VERT = /* glsl */`
attribute vec4 aP;          // z0 · phase · speed · size
attribute float aX0;        // start x (downstream offset)
uniform float uTime;
uniform float uRun;
uniform float uRise;
varying float vA;
varying vec2 vUv;
${'#include <fog_pars_vertex>'}
void main() {
  float t = fract(uTime * aP.z + aP.y);
  vec3 c = vec3(aX0 + t * uRun * (0.6 + 0.4 * aP.z * 6.0), uRise * sin(3.14159 * min(1.0, t * 1.3)) * (0.5 + aP.w * 0.06), aP.x + sin(aP.y * 40.0 + t * 3.0) * 4.0);
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
  float s = aP.w * (0.6 + 1.6 * t);
  mvPosition.xy += position.xy * s;
  vA = (1.0 - t) * smoothstep(0.0, 0.08, t);
  vUv = uv;
  gl_Position = projectionMatrix * mvPosition;
  ${'#include <fog_vertex>'}
}`;
const SPRAY_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
varying vec2 vUv;
${'#include <fog_pars_fragment>'}
void main() {
  vec2 d = vUv - 0.5;
  float r = dot(d, d) * 4.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vA * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  ${fogFragCapped(FX_HAZE_CAP)}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 흰 물(경사면 · 수면 거품) — 노이즈 텍스처를 흐름 방향으로 민다
const FOAM_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
${'#include <fog_pars_vertex>'}
void main() {
  vUv = uv;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${'#include <fog_vertex>'}
}`;
const FOAM_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSpeed;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec4 uBand;         // boil sheet: uv.y bands — xy spillway (strong) · zw powerhouse (medium)
uniform float uMode;        // 0 = spill ramp (flows down) · 1 = water sheet (spreads downstream)
varying vec2 vUv;
varying vec3 vW;
${'#include <fog_pars_fragment>'}
void main() {
  float a;
  if (uMode < 0.5) {
    float n = texture2D(uNoise, vec2(vUv.x * 2.0, vUv.y * 1.5 + uTime * uSpeed)).r;
    float n2 = texture2D(uNoise, vec2(vUv.x * 5.0 + 0.3, vUv.y * 3.0 + uTime * uSpeed * 1.7)).r;
    a = smoothstep(0.25, 0.75, n * 0.6 + n2 * 0.5) * 0.85 + 0.15;
  } else {
    float along = vUv.x;                       // 0 = dam side · 1 = downstream end
    float n = texture2D(uNoise, vec2(vUv.x * 6.0 - uTime * uSpeed, vUv.y * 9.0)).r;
    float n2 = texture2D(uNoise, vec2(vUv.x * 15.0 - uTime * uSpeed * 1.6, vUv.y * 21.0 + 0.4)).r;
    float spill = smoothstep(uBand.x - 0.03, uBand.x + 0.02, vUv.y) * (1.0 - smoothstep(uBand.y - 0.02, uBand.y + 0.03, vUv.y));
    float ph = (smoothstep(uBand.z, uBand.z + 0.03, vUv.y) * (1.0 - smoothstep(uBand.w - 0.03, uBand.w, vUv.y))) * 0.55;
    float strength = max(spill, ph) * (1.0 - smoothstep(0.05, 1.0, along + (1.0 - spill) * 0.35));
    a = strength * smoothstep(0.32, 0.72, n * 0.65 + n2 * 0.45 + strength * 0.25);
  }
  a *= uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  ${fogFragCapped(FX_HAZE_CAP)}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {{dam:{x:number, z:number, width:number, height:number}, quality:'low'|'medium'|'high'}} args
 * @returns {{group:THREE.Group, update(env:{time:number, light:number, night:boolean, weather:string}):void, setQuality(q:string):void, dispose():void}}
 */
export function buildDam({ dam, quality }) {
  const group = new THREE.Group();
  group.name = 'dam';
  group.position.set(dam.x, 0, dam.z);
  const geos = [];
  const mats = [];
  const texs = [];
  const W = Math.max(60, dam.width);
  const H = Math.max(20, dam.height);
  const z0 = -W / 2;
  const at = (u) => z0 + u * W;          // 강 건너(−Z) 0 → 이쪽(+Z) 1
  const rand = makeRand(9091);
  const deckY = H * 0.52;
  const parts = [];
  const add = (g, color) => parts.push({ geo: g, color });

  // ── 건너편 접합부 · 2호 발전소(낮고 긴 덩어리 + 취수탑)
  add(box(34, deckY + 10, W * 0.05, -2, (deckY + 10) / 2 - 8, at(0.0)), CONCRETE_DARK);
  {
    const a = at(0.04);
    const b = at(0.24);
    const len = b - a;
    add(box(30, H * 0.5 + 8, len, 2, (H * 0.5 + 8) / 2 - 8, (a + b) / 2), CONCRETE);
    add(box(10, H * 0.62, len * 0.96, -10, H * 0.31, (a + b) / 2), CONCRETE_DARK);      // 상류 취수 구조
    for (let i = 0; i < 6; i++) {                                                         // 방류구 아치(어두운 입)
      const zc = a + (i + 0.5) * len / 6;
      add(box(1.2, 5, len / 6 * 0.6, 17.4, 2.0, zc), '#2a2c2c');
    }
    for (let i = 0; i < 3; i++) add(box(6, 9, 6, -6, H * 0.5 + 4.5, a + len * (0.2 + i * 0.3)), CONCRETE);
  }
  // ── 여수로: 교각 · 수문 · 경사면 · 도로 · 갠트리 크레인
  const sA = at(0.26);
  const sB = at(0.74);
  const bay = (sB - sA) / SPILL_BAYS;
  const pierW = bay * 0.38;
  for (let i = 0; i <= SPILL_BAYS; i++) {
    const zc = sA + i * bay;
    add(box(26, deckY + 8, pierW, -1, (deckY + 8) / 2 - 8, zc), CONCRETE);
    const nose = new THREE.CylinderGeometry(pierW / 2, pierW / 2, deckY + 8, 8, 1, false, 0, Math.PI);   // 상류 쪽 둥근 코
    nose.rotateY(Math.PI);
    nose.translate(-14, (deckY + 8) / 2 - 8, zc);
    add(nose, CONCRETE);
  }
  const rampTop = H * 0.26;
  for (let i = 0; i < SPILL_BAYS; i++) {
    const zc = sA + (i + 0.5) * bay;
    const open = OPEN_BAYS.includes(i);
    const gateBottom = open ? rampTop + 2.2 : rampTop - 1;
    const gateH = H * 0.3;
    add(box(1.0, gateH, bay - pierW, -6, gateBottom + gateH / 2, zc), STEEL);           // 수문(열린 칸은 들려 있다)
  }
  // 여수로 경사면(오지 형) — 교각 사이 전체 너비의 콘크리트 쐐기
  {
    const shape = new THREE.Shape();
    shape.moveTo(-6, -8);
    shape.lineTo(-6, rampTop);
    shape.lineTo(-1, rampTop);
    shape.quadraticCurveTo(6, rampTop * 0.9, 14, rampTop * 0.35);
    shape.lineTo(22, 0.3);
    shape.lineTo(30, -1.0);
    shape.lineTo(30, -8);
    shape.lineTo(-6, -8);
    const g = new THREE.ExtrudeGeometry(shape, { depth: sB - sA, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, sA);
    add(g, CONCRETE_DARK);
  }
  add(box(18, 2.4, sB - sA + pierW, -2, deckY + 1.2, (sA + sB) / 2), CONCRETE);          // 도로 상판
  add(box(0.4, 1.1, sB - sA, 6.8, deckY + 2.95, (sA + sB) / 2), CONCRETE_DARK);          // 난간
  // 갠트리 크레인(빨간 A 프레임 둘 + 들보) — 실루엣의 꼭대기(H)
  {
    const zc = sA + (sB - sA) * 0.42;
    const legH = H - deckY - 3;
    for (const dz of [-5, 5]) for (const dx of [-6, 6]) {
      const leg = new THREE.BoxGeometry(1.0, legH, 1.0);
      leg.translate(dx, deckY + 2.4 + legH / 2, zc + dz);
      add(leg, GANTRY);
    }
    add(box(15, 2.4, 12, 0, H - 1.6, zc), GANTRY);
    add(box(7, 3.5, 6, 0, H + 0.6, zc), '#c8c2b0');
  }
  // ── 브래드퍼드섬(바위 언덕 + 숲)
  {
    const a = at(0.74);
    const b = at(0.86);
    const isl = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    isl.scale(70, H * 0.36, (b - a) / 2 + 6);
    isl.translate(10, -3, (a + b) / 2);
    const p = isl.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > 0) p.setY(i, y * (0.75 + 0.5 * rand()));
    }
    isl.computeVertexNormals();
    add(isl, ISLAND_ROCK);
    for (let i = 0; i < 26; i++) {
      const tx = 10 + (rand() - 0.5) * 90;
      const tz = (a + b) / 2 + (rand() - 0.5) * ((b - a) * 0.8);
      const r = Math.hypot((tx - 10) / 70, (tz - (a + b) / 2) / ((b - a) / 2 + 6));
      if (r > 0.85) continue;
      const base = -3 + H * 0.36 * Math.sqrt(Math.max(0, 1 - r * r)) * 0.9;
      const th = 10 + rand() * 9;
      const cone = new THREE.ConeGeometry(2.4 + rand() * 1.4, th, 6);
      cone.translate(tx, base + th / 2, tz);
      add(cone, ISLAND_GREEN);
    }
  }
  // ── 1호 발전소(이쪽) · 갑문 벽
  {
    const a = at(0.86);
    const b = at(0.97);
    const len = b - a;
    add(box(32, H * 0.5 + 8, len, 2, (H * 0.5 + 8) / 2 - 8, (a + b) / 2), CONCRETE);
    add(box(24, 6, len * 0.9, 1, H * 0.5 + 3, (a + b) / 2), CONCRETE_DARK);                 // 위층 건물
    for (let i = 0; i < 4; i++) add(box(1.2, 5, len / 4 * 0.6, 18.4, 2.0, a + (i + 0.5) * len / 4), '#2a2c2c');
    add(box(60, 14, 3, 20, 7 - 6, at(1.0) + 2), CONCRETE_DARK);                               // 갑문 벽(하류로 길게)
    add(box(60, 14, 3, 20, 7 - 6, at(0.975)), CONCRETE_DARK);
    add(box(40, deckY * 0.8, 30, -4, deckY * 0.4 - 6, at(1.0) + 16), CONCRETE_DARK);         // 이쪽 접합부(땅으로 묻힌다)
  }
  const concreteGeo = mergeGeoms(parts);
  for (const p of parts) p.geo.dispose();
  geos.push(concreteGeo);
  const concreteMat = hazedStandard({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true }, HAZE_CAP);
  mats.push(concreteMat);
  const concrete = new THREE.Mesh(concreteGeo, concreteMat);
  concrete.name = 'damConcrete';
  group.add(concrete);

  // ── 밤 불빛: 크레스트 등 · 발전소 창(발광만)
  const lampParts = [];
  for (let i = 0; i <= SPILL_BAYS; i += 2) lampParts.push(box(0.8, 0.8, 0.8, 6.6, deckY + 4.2, sA + i * bay));
  for (const [ua, ub] of [[0.04, 0.24], [0.86, 0.97]]) {
    const a = at(ua);
    const b = at(ub);
    for (let k = 0; k < 9; k++) lampParts.push(box(0.3, 1.6, (b - a) / 9 * 0.5, 17.3, H * 0.34, a + (k + 0.5) * (b - a) / 9));
  }
  const lampGeo = mergeGeoms(lampParts);
  for (const g of lampParts) g.dispose();
  geos.push(lampGeo);
  const lampMat = hazedStandard({ color: '#3a3a36', emissive: '#ffd890', emissiveIntensity: 0, roughness: 0.6 }, 0.45);
  mats.push(lampMat);
  const lamps = new THREE.Mesh(lampGeo, lampMat);
  lamps.name = 'damLights';
  group.add(lamps);

  // ── 흰 물: 열린 수문 아래 경사면(흐르는 거품)
  const noiseTex = (() => {
    const n1 = noiseGrid(64, 77, 8);
    const n2 = noiseGrid(64, 78, 24);
    return dataTexture(64, 64, (u, v, o) => {
      const val = Math.round((n1(u, v) * 0.6 + n2(u, v) * 0.4) * 255);
      o[0] = val; o[1] = val; o[2] = val; o[3] = 255;
    }, { srgb: false });
  })();
  texs.push(noiseTex);
  const foamUniforms = (speed, mode, alpha) => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uNoise: { value: null }, uTime: { value: 0 }, uSpeed: { value: speed }, uColor: { value: new THREE.Color('#f4f6f4') },
    uAlpha: { value: alpha }, uMode: { value: mode }, uBand: { value: new THREE.Vector4(0, 1, 0, 0) },
  }]);
  const rampMat = new THREE.ShaderMaterial({ uniforms: foamUniforms(0.9, 0, 0.92), vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
  rampMat.uniforms.uNoise.value = noiseTex;
  mats.push(rampMat);
  {
    const rampParts = [];
    for (const i of OPEN_BAYS) {
      const zc = sA + (i + 0.5) * bay;
      const wz = bay - pierW - 0.2;
      // 경사면 따라 꺾인 띠(위 → 아래) — uv.y 가 흐름 방향
      const pts = [[-1, rampTop + 1.2], [6, rampTop * 0.86], [14, rampTop * 0.36], [22, 0.6], [30, 0.25]];
      const pos = [];
      const uv = [];
      const idx = [];
      for (let k = 0; k < pts.length; k++) {
        const [x, y] = pts[k];
        pos.push(x, y + 0.35, zc - wz / 2, x, y + 0.35, zc + wz / 2);
        uv.push(0, k / (pts.length - 1), 1, k / (pts.length - 1));
        if (k > 0) { const b0 = (k - 1) * 2; idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      rampParts.push(g);
    }
    const merged = mergeUv(rampParts);
    for (const g of rampParts) g.dispose();
    geos.push(merged);
    const ramp = new THREE.Mesh(merged, rampMat);
    ramp.name = 'damSpillFoam';
    ramp.renderOrder = 3;
    group.add(ramp);
  }
  // ── 방류구 아래 끓는 수면(하류로 퍼지는 거품 판)
  const boilLen = 260;
  const boilMat = new THREE.ShaderMaterial({ uniforms: foamUniforms(0.05, 1, 0.9), vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG, transparent: true, depthWrite: false, fog: true });
  boilMat.uniforms.uNoise.value = noiseTex;
  boilMat.uniforms.uBand.value.set(0.26, 0.74, 0.86, 0.97);
  mats.push(boilMat);
  {
    const g = new THREE.PlaneGeometry(boilLen, W, 24, 24);
    g.rotateX(-Math.PI / 2);
    // uv.x: 댐 → 하류 · uv.y: 건너편(−Z) → 이쪽(+Z)
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, (p.getX(i) + boilLen / 2) / boilLen, (p.getZ(i) + W / 2) / W);
    }
    g.translate(boilLen / 2 + 14, 0.08, 0);
    geos.push(g);
    const boil = new THREE.Mesh(g, boilMat);
    boil.name = 'damBoil';
    boil.renderOrder = 3;
    group.add(boil);
  }

  // ── 물보라(빌보드 입자 — 열린 수문 앞에서 솟아 하류로 날린다)
  const sprayGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(1, 1);
    sprayGeo.index = quad.index;
    sprayGeo.setAttribute('position', quad.attributes.position);
    sprayGeo.setAttribute('uv', quad.attributes.uv);
    const aP = new Float32Array(SPRAY_MAX * 4);
    const aX0 = new Float32Array(SPRAY_MAX);
    for (let i = 0; i < SPRAY_MAX; i++) {
      const b = OPEN_BAYS[Math.floor(rand() * OPEN_BAYS.length)];
      aP[i * 4] = sA + (b + 0.5) * bay + (rand() - 0.5) * bay * 1.6;
      aP[i * 4 + 1] = rand();
      aP[i * 4 + 2] = 0.05 + rand() * 0.1;
      aP[i * 4 + 3] = 7 + rand() * 9;
      aX0[i] = 18 + rand() * 14;
    }
    sprayGeo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
    sprayGeo.setAttribute('aX0', new THREE.InstancedBufferAttribute(aX0, 1));
    sprayGeo.instanceCount = SPRAY_COUNT[quality] ?? SPRAY_COUNT.medium;
    quad.dispose();
  }
  geos.push(sprayGeo);
  const sprayMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uRun: { value: 120 }, uRise: { value: 26 }, uColor: { value: new THREE.Color('#eef2f2') }, uAlpha: { value: 0.32 },
    }]),
    vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, transparent: true, depthWrite: false, fog: true,
  });
  mats.push(sprayMat);
  const spray = new THREE.Mesh(sprayGeo, sprayMat);
  spray.name = 'damSpray';
  spray.frustumCulled = false;
  spray.renderOrder = 4;
  group.add(spray);

  const white = new THREE.Color('#f2f5f4');
  const tmp = new THREE.Color();
  return {
    group,
    update(env) {
      const day = Math.max(0.12, Math.min(1, env.light));
      tmp.copy(white).multiplyScalar(0.2 + 0.8 * day);
      rampMat.uniforms.uTime.value = env.time;
      rampMat.uniforms.uColor.value.copy(tmp);
      boilMat.uniforms.uTime.value = env.time;
      boilMat.uniforms.uColor.value.copy(tmp);
      sprayMat.uniforms.uTime.value = env.time;
      sprayMat.uniforms.uColor.value.copy(tmp);
      sprayMat.uniforms.uAlpha.value = env.weather === 'rain' ? 0.4 : 0.32;
      lampMat.emissiveIntensity = env.night ? 2.4 : env.light < 0.5 ? 1.2 : 0;
    },
    setQuality(q) { sprayGeo.instanceCount = SPRAY_COUNT[q] ?? SPRAY_COUNT.medium; },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

/** position · normal · uv 를 가진 색인 지오메트리 여럿을 하나로 */
function mergeUv(list) {
  let v = 0;
  let n = 0;
  for (const g of list) { v += g.attributes.position.count; n += g.index.count; }
  const pos = new Float32Array(v * 3);
  const nrm = new Float32Array(v * 3);
  const uv = new Float32Array(v * 2);
  const idx = new Uint32Array(n);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
