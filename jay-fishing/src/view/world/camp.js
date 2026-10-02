// OWNER: P5 — 내부 파일 · 캠프 일반형(§9.3): 텐트 + 모닥불(불꽃 셰이더 · 밤에 점광원은 WorldLayer 의 공용 PointLight) + 접이식 의자.
// 전부 camp 쪽 obstacles 원 안(§9.4 — 걷는 영역에서 0.5m 넘는 것은 원 안에만). 로컬 −Z 가 입구(접근점 쪽).

import * as THREE from 'three';

const TENT_COLOR = '#d8742c';
const TENT_FLY = '#3a5a3a';
const FLAME_VERT = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.y;
  p.x += sin(uTime * 7.0 + uSeed * 3.0 + k * 4.0) * 0.04 * k;
  p.z += cos(uTime * 6.1 + uSeed * 5.0 + k * 3.0) * 0.04 * k;
  p.y *= 0.85 + 0.25 * sin(uTime * 9.0 + uSeed * 11.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAME_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uBright;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float y = vUv.y;
  float flick = 0.75 + 0.25 * sin(uTime * 13.0 + uSeed * 7.0 + vUv.x * 20.0);
  vec3 core = vec3(1.0, 0.85, 0.45);
  vec3 edge = vec3(1.0, 0.35, 0.05);
  vec3 c = mix(core, edge, smoothstep(0.1, 0.9, y));
  float a = (1.0 - smoothstep(0.35, 1.0, y)) * flick;
  gl_FragColor = vec4(c * (1.4 + uBright), a);
  #include <colorspace_fragment>
}`;

/**
 * @param {{x:number, z:number, r:number}} circle camp 쪽 obstacles 원 @param {number} yaw camp 점의 yaw @param {(x:number, z:number) => number} heightAt
 */
export function buildCamp(circle, yaw, heightAt) {
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const root = new THREE.Group();
  root.name = 'camp';
  root.position.set(circle.x, heightAt(circle.x, circle.z), circle.z);
  root.rotation.y = yaw;
  const tentM = M(new THREE.MeshStandardMaterial({ color: TENT_COLOR, roughness: 0.8, side: THREE.DoubleSide }));
  const flyM = M(new THREE.MeshStandardMaterial({ color: TENT_FLY, roughness: 0.85, side: THREE.DoubleSide }));
  const darkM = M(new THREE.MeshStandardMaterial({ color: '#2a1e14', roughness: 1 }));
  const metalM = M(new THREE.MeshStandardMaterial({ color: '#8a8f96', roughness: 0.4, metalness: 0.6 }));
  const fabricM = M(new THREE.MeshStandardMaterial({ color: '#2f5f8a', roughness: 0.9, side: THREE.DoubleSide }));
  const stoneM = M(new THREE.MeshStandardMaterial({ color: '#6c665e', roughness: 1, flatShading: true }));
  const woodM = M(new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 1 }));
  const charM = M(new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 1, emissive: '#ff5a1a', emissiveIntensity: 0.0 }));

  // 텐트(A자) — 로컬 (0, +0.45) 중심 · 폭 1.3 · 깊이 1.35 · 높이 1.15
  const W = 0.65;
  const D0 = -0.22;
  const D1 = 1.12;
  const H = 1.15;
  const tentGeo = new THREE.BufferGeometry();
  const v = [
    // 왼쪽 경사면
    -W, 0, D0, 0, H, D0, 0, H, D1, -W, 0, D0, 0, H, D1, -W, 0, D1,
    // 오른쪽 경사면
    W, 0, D0, W, 0, D1, 0, H, D1, W, 0, D0, 0, H, D1, 0, H, D0,
    // 뒤 삼각
    -W, 0, D1, 0, H, D1, W, 0, D1,
  ];
  tentGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  tentGeo.computeVertexNormals();
  G(tentGeo);
  const tent = new THREE.Mesh(tentGeo, tentM);
  tent.castShadow = true;
  tent.receiveShadow = true;
  root.add(tent);
  // 입구: 어두운 안쪽 + 젖힌 문 자락
  const doorGeo = G(new THREE.BufferGeometry());
  doorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-W * 0.75, 0, D0 + 0.02, W * 0.75, 0, D0 + 0.02, 0, H * 0.86, D0 + 0.02]), 3));
  doorGeo.computeVertexNormals();
  root.add(new THREE.Mesh(doorGeo, darkM));
  const flapGeo = G(new THREE.BufferGeometry());
  flapGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-W, 0, D0, -W * 0.15, H * 0.85, D0, -W * 1.05, 0.05, D0 - 0.32]), 3));
  flapGeo.computeVertexNormals();
  root.add(new THREE.Mesh(flapGeo, flyM));
  // 용마루 줄 · 말뚝
  const ridgeG = G(new THREE.CylinderGeometry(0.012, 0.012, D1 - D0 + 0.3, 4).rotateX(Math.PI / 2));
  const rp = new THREE.Mesh(ridgeG, metalM);
  rp.position.set(0, H + 0.01, (D0 + D1) / 2);
  root.add(rp);

  // 모닥불 — 로컬 (0.28, −0.72)
  const fire = new THREE.Group();
  fire.position.set(0.28, 0, -0.72);
  root.add(fire);
  const stoneG = G(new THREE.DodecahedronGeometry(0.075, 0));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.Mesh(stoneG, stoneM);
    s.position.set(Math.cos(a) * 0.26, 0.04, Math.sin(a) * 0.26);
    s.rotation.set(i, i * 2, 0);
    s.scale.set(1, 0.7, 1);
    fire.add(s);
  }
  const logG = G(new THREE.CylinderGeometry(0.035, 0.04, 0.42, 6).rotateZ(Math.PI / 2));
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(logG, woodM);
    l.position.set(0, 0.05 + i * 0.015, 0);
    l.rotation.y = (i / 3) * Math.PI;
    l.rotation.z = 0.25;
    fire.add(l);
  }
  const embers = new THREE.Mesh(G(new THREE.CircleGeometry(0.16, 10).rotateX(-Math.PI / 2)), charM);
  embers.position.y = 0.02;
  fire.add(embers);
  const flames = [];
  const flameGeo = G(new THREE.ConeGeometry(0.11, 0.5, 8, 4, true));
  flameGeo.translate(0, 0.25, 0);
  for (let i = 0; i < 3; i++) {
    const fm = M(new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: i * 1.7 }, uBright: { value: 0 } },
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const f = new THREE.Mesh(flameGeo, fm);
    f.position.set((i - 1) * 0.06, 0.04, (i % 2) * 0.05 - 0.02);
    f.scale.setScalar(1 - Math.abs(i - 1) * 0.3);
    f.renderOrder = 6;
    fire.add(f);
    flames.push(fm);
  }

  // 접이식 의자 — 로컬 (−0.62, −0.58), 불을 본다
  const chair = new THREE.Group();
  chair.position.set(-0.62, 0, -0.58);
  chair.rotation.y = -1.2;
  root.add(chair);
  const legG = G(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5));
  for (const [x, z, rx] of [[-0.2, -0.18, 0.5], [0.2, -0.18, 0.5], [-0.2, 0.18, -0.5], [0.2, 0.18, -0.5]]) {
    const l = new THREE.Mesh(legG, metalM);
    l.position.set(x, 0.24, z * 0.5);
    l.rotation.x = rx;
    chair.add(l);
  }
  const seat = new THREE.Mesh(G(new THREE.PlaneGeometry(0.42, 0.36).rotateX(-Math.PI / 2 + 0.12)), fabricM);
  seat.position.set(0, 0.44, 0);
  const back = new THREE.Mesh(G(new THREE.PlaneGeometry(0.42, 0.38).rotateX(-0.2)), fabricM);
  back.position.set(0, 0.68, 0.2);
  chair.add(seat, back);
  chair.traverse(o => { o.castShadow = true; });

  // 장작 더미(낮음)
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(logG, woodM);
    l.position.set(0.72, 0.05 + (i === 2 ? 0.07 : 0), -0.1 + (i % 2) * 0.09 + (i === 2 ? 0.045 : 0));
    l.rotation.y = Math.PI / 2;
    root.add(l);
  }

  const fireWorld = new THREE.Vector3();
  return {
    group: root,
    /** 모닥불의 월드 위치(점광원) */
    fireWorld() {
      fire.getWorldPosition(fireWorld);
      fireWorld.y += 0.35;
      return fireWorld;
    },
    /** @param {number} time @param {number} night 0..1 */
    update(time, night) {
      for (const m of flames) {
        m.uniforms.uTime.value = time;
        m.uniforms.uBright.value = night * 0.4;
      }
      charM.emissiveIntensity = 0.6 + 0.25 * Math.sin(time * 3.1) + night * 0.6;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}
