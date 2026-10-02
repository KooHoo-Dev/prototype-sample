// OWNER: P7 — 계약 §9.8
// 무기 궤적 리본. 매 프레임 weaponBase/weaponTip을 샘플한 최근 12점을 Catmull-Rom으로 잘게 나눠
// 가산 혼합 띠로 그린다(끝으로 갈수록 · 날 안쪽으로 갈수록 투명).
import * as THREE from 'three';

const MAX_POINTS = 12;
/** 샘플 사이를 나누는 수(각진 호를 둥글게) */
const SUBDIV = 3;
const MAX_RENDER = (MAX_POINTS - 1) * SUBDIV + 1;
/** 한 점이 사라지기까지(초) */
const POINT_LIFE = 0.2;
/** 이만큼(m) 움직이지 않으면 새 점을 찍지 않는다(히트스톱 중 리본이 접히지 않게) */
const MIN_STEP = 0.012;

const VERT = /* glsl */ `
attribute float aFade;
attribute float aAcross;
varying float vFade;
varying float vAcross;
void main() {
  vFade = aFade;
  vAcross = aAcross;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uIntensity;
varying float vFade;
varying float vAcross;
void main() {
  // 날 끝 쪽만 밝고 안쪽은 거의 비운다(넓은 부채가 화면을 덮지 않게)
  float edge = vAcross * vAcross * vAcross;
  float a = vFade * vFade * edge * 0.7;
  if (a < 0.004) discard;
  vec3 col = mix(uGlow, uCore, edge * edge) * uIntensity;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** (p0, p1, p2, p3)의 Catmull-Rom 한 성분. */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

export class WeaponTrail {
  /** @param {THREE.Object3D} parent fxRoot */
  constructor(parent) {
    this.parent = parent;
    // 샘플(오래된 것이 0): 날 안쪽 점 · 끝 점 · 나이
    this._inner = new Float32Array(MAX_POINTS * 3);
    this._tip = new Float32Array(MAX_POINTS * 3);
    this._age = new Float32Array(MAX_POINTS);
    this._n = 0;
    /** 샘플을 계속 받을 남은 시간(초) */
    this.timeLeft = 0;
    /** 날의 어느 지점부터 리본이 시작되는가(0 = 밑동 · 1 = 끝) */
    this.innerFrac = 0.3;

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(new Float32Array(MAX_RENDER * 2 * 3), 3);
    this._fadeAttr = new THREE.BufferAttribute(new Float32Array(MAX_RENDER * 2), 1);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    this._fadeAttr.setUsage(THREE.DynamicDrawUsage);
    const across = new Float32Array(MAX_RENDER * 2);
    const index = [];
    for (let j = 0; j < MAX_RENDER; j++) {
      across[j * 2 + 1] = 1;
      if (j < MAX_RENDER - 1) index.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
    }
    geo.setAttribute('position', this._posAttr);
    geo.setAttribute('aFade', this._fadeAttr);
    geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCore: { value: new THREE.Color(1, 1, 1) },
        uGlow: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 2 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /**
   * 새 휘두르기. 이전 궤적의 남은 점은 버린다(다른 휘두르기와 이어지지 않게).
   * @param {number} dur 샘플을 받을 시간(초)
   * @param {THREE.Color} core
   * @param {THREE.Color} glow
   * @param {number} intensity
   * @param {number} innerFrac
   */
  start(dur, core, glow, intensity, innerFrac) {
    this._n = 0;
    this.timeLeft = dur;
    this.innerFrac = innerFrac;
    this.material.uniforms.uCore.value.copy(core);
    this.material.uniforms.uGlow.value.copy(glow);
    this.material.uniforms.uIntensity.value = intensity;
  }

  get sampling() {
    return this.timeLeft > 0;
  }

  /**
   * @param {THREE.Vector3} base weaponBase 월드 위치
   * @param {THREE.Vector3} tip weaponTip 월드 위치
   */
  addSample(base, tip) {
    const f = this.innerFrac;
    const ix = base.x + (tip.x - base.x) * f;
    const iy = base.y + (tip.y - base.y) * f;
    const iz = base.z + (tip.z - base.z) * f;
    let n = this._n;
    if (n > 0) {
      const o = (n - 1) * 3;
      const moved = Math.hypot(tip.x - this._tip[o], tip.y - this._tip[o + 1], tip.z - this._tip[o + 2]);
      if (moved < MIN_STEP) return;
    }
    if (n === MAX_POINTS) {
      this._inner.copyWithin(0, 3);
      this._tip.copyWithin(0, 3);
      this._age.copyWithin(0, 1);
      n -= 1;
    }
    const o = n * 3;
    this._inner[o] = ix; this._inner[o + 1] = iy; this._inner[o + 2] = iz;
    this._tip[o] = tip.x; this._tip[o + 1] = tip.y; this._tip[o + 2] = tip.z;
    this._age[n] = 0;
    this._n = n + 1;
  }

  /** @param {number} dt 히트스톱 중에는 0을 넘긴다(궤적이 멈춘 화면에 그대로 남는다) */
  update(dt) {
    if (this.timeLeft > 0) this.timeLeft -= dt;
    let n = this._n;
    if (n === 0) {
      this.mesh.visible = false;
      return;
    }
    // 나이 들이기 + 죽은 점(앞쪽) 버리기
    let dead = 0;
    for (let i = 0; i < n; i++) {
      this._age[i] += dt;
      if (this._age[i] >= POINT_LIFE) dead = i + 1;
    }
    if (dead > 0) {
      this._inner.copyWithin(0, dead * 3, n * 3);
      this._tip.copyWithin(0, dead * 3, n * 3);
      this._age.copyWithin(0, dead, n);
      n -= dead;
      this._n = n;
    }
    if (n < 2) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const pos = this._posAttr.array;
    const fade = this._fadeAttr.array;
    const A = this._inner;
    const B = this._tip;
    let r = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = i * 3;
      const i2 = (i + 1) * 3;
      const i3 = Math.min(n - 1, i + 2) * 3;
      for (let k = 0; k < SUBDIV; k++) {
        const t = k / SUBDIV;
        const o = r * 6;
        for (let c = 0; c < 3; c++) {
          pos[o + c] = cr(A[i0 + c], A[i1 + c], A[i2 + c], A[i3 + c], t);
          pos[o + 3 + c] = cr(B[i0 + c], B[i1 + c], B[i2 + c], B[i3 + c], t);
        }
        const age = this._age[i] + (this._age[i + 1] - this._age[i]) * t;
        const f = Math.max(0, 1 - age / POINT_LIFE);
        fade[r * 2] = f;
        fade[r * 2 + 1] = f;
        r += 1;
      }
    }
    const last = (n - 1) * 3;
    const o = r * 6;
    for (let c = 0; c < 3; c++) {
      pos[o + c] = A[last + c];
      pos[o + 3 + c] = B[last + c];
    }
    const f = Math.max(0, 1 - this._age[n - 1] / POINT_LIFE);
    fade[r * 2] = f;
    fade[r * 2 + 1] = f;
    r += 1;
    this._posAttr.needsUpdate = true;
    this._fadeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (r - 1) * 6);
    this.mesh.visible = true;
  }

  clear() {
    this._n = 0;
    this.timeLeft = 0;
    this.mesh.visible = false;
    this.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
