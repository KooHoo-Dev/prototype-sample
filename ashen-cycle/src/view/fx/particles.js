// OWNER: P7 — 계약 §9.7 · §9.9
// 입자 풀. 인스턴스 쿼드 두 장(가산 · 알파)으로 스파크 · 불씨 · 먼지 · 파편 · 고리 · 섬광을 전부 그린다.
// 예산은 QUALITY[settings.quality].particles — 빈 칸부터 쓰고, 가득 차면 링 버퍼 순서로 가장 오래된 것부터 덮어쓴다.
import * as THREE from 'three';
import { QUALITY } from '../../data/settings.js';

/**
 * 입자 종류(정적 표 — 뿌릴 때 객체를 만들지 않는다).
 * @typedef {Object} ParticleKind
 * @property {boolean} additive   가산 혼합(빛) / 알파 혼합(먼지 · 파편)
 * @property {number} life0       수명 하한(초)
 * @property {number} life1       수명 상한
 * @property {number} size0       시작 크기 하한(m, 쿼드 한 변)
 * @property {number} size1       시작 크기 상한
 * @property {number} grow        끝 크기 = 시작 × grow
 * @property {number} gravity     아래로 당기는 가속(m/s²). 음수면 떠오른다
 * @property {number} drag        속도 감쇠(1/s)
 * @property {number} stretch     속도 방향으로 늘이는 시간(초) — 스파크의 꼬리
 * @property {number} shape       0 부드러운 원 · 1 고리 · 2 단단한 점 · 3 네 갈래 별 · 4 마름모 파편
 * @property {boolean} flat       true면 바닥에 누운 쿼드(XZ 평면)
 * @property {boolean} bounce     바닥에서 튄다
 * @property {number} fadeIn      나타나는 구간(수명 비율 0..0.5)
 * @property {number} pow         사라지는 곡선 지수(클수록 늦게 사라진다 — 1이면 직선)
 * @property {number} alpha       최대 불투명도
 * @property {number} intensity   색 배율(1을 넘으면 블룸에 걸린다)
 * @property {number} ring        고리 두께(shape 1 — 반지름 대비)
 */

/** @returns {ParticleKind} */
function kind(o) {
  return {
    additive: true, life0: 0.3, life1: 0.5, size0: 0.05, size1: 0.08, grow: 1, gravity: 0, drag: 0, stretch: 0,
    shape: 0, flat: false, bounce: false, fadeIn: 0, pow: 1, alpha: 1, intensity: 1, ring: 0.2, ...o,
  };
}

/** 입자 종류 표. 색은 뿌릴 때 넘긴다. */
export const PK = {
  // 타격 스파크 — 꼬리가 달린 밝은 점. 바닥에서 한 번 튄다
  spark: kind({ life0: 0.22, life1: 0.5, size0: 0.045, size1: 0.085, grow: 0.3, gravity: 13, drag: 1.6, stretch: 0.055, shape: 2, bounce: true, pow: 0.6, intensity: 5 }),
  // 가느다란 빠른 줄(패링 · 잔상 · 모이는 빛)
  streak: kind({ life0: 0.14, life1: 0.3, size0: 0.03, size1: 0.05, grow: 0.4, drag: 0.5, stretch: 0.07, shape: 2, pow: 0.8, intensity: 4 }),
  // 떠오르는 불씨
  ember: kind({ life0: 0.9, life1: 2.0, size0: 0.03, size1: 0.07, grow: 0.3, gravity: -1.1, drag: 0.9, stretch: 0.012, shape: 2, fadeIn: 0.1, pow: 0.7, intensity: 4 }),
  // 불길 덩어리
  flame: kind({ life0: 0.3, life1: 0.65, size0: 0.35, size1: 0.7, grow: 0.35, gravity: -4.5, drag: 1.2, shape: 0, fadeIn: 0.12, pow: 1.2, alpha: 0.9, intensity: 2.2 }),
  // 번쩍이는 빛 덩어리(순간 섬광)
  glow: kind({ life0: 0.12, life1: 0.2, size0: 1, size1: 1, grow: 1.7, shape: 0, pow: 1.5, alpha: 0.9, intensity: 1.7 }),
  // 네 갈래 별 섬광
  flare: kind({ life0: 0.18, life1: 0.26, size0: 1, size1: 1, grow: 1.5, shape: 3, pow: 1.3, intensity: 2.6 }),
  // 카메라를 보는 고리(패링 · 순간이동)
  ring: kind({ life0: 0.28, life1: 0.28, size0: 1, size1: 1, grow: 1, shape: 1, pow: 1.4, intensity: 3.5, ring: 0.16 }),
  // 크게 퍼지는 충격 고리(포효 · 격파) — 반지름이 커도 띠가 굵어지지 않게 얇다
  shock: kind({ life0: 0.5, life1: 0.5, size0: 1, size1: 1, grow: 1, shape: 1, pow: 1.2, intensity: 3, ring: 0.06 }),
  // 바닥에 누운 고리(충격파 · 착지)
  groundRing: kind({ life0: 0.45, life1: 0.45, size0: 1, size1: 1, grow: 1, shape: 1, flat: true, pow: 1.3, intensity: 2.5, ring: 0.1 }),
  // 넓게 퍼지는 바닥 고리(포효 · 페이즈 전환)
  groundShock: kind({ life0: 0.7, life1: 0.7, size0: 1, size1: 1, grow: 1, shape: 1, flat: true, pow: 1.2, intensity: 2.5, ring: 0.045 }),
  // 바닥에 누운 빛 웅덩이
  groundGlow: kind({ life0: 0.3, life1: 0.5, size0: 1, size1: 1, grow: 1.2, shape: 0, flat: true, pow: 1.2, alpha: 0.8, intensity: 2 }),
  // 분위기 입자(불씨 · 심연 먼지) — 오래 살고 천천히 움직인다
  mote: kind({ life0: 3.0, life1: 6.0, size0: 0.035, size1: 0.08, grow: 0.6, drag: 0.3, shape: 0, fadeIn: 0.2, pow: 1, alpha: 0.9, intensity: 3 }),
  // 눈
  snow: kind({ additive: false, life0: 3.5, life1: 6.0, size0: 0.04, size1: 0.085, grow: 1, gravity: 0.5, drag: 0.5, shape: 0, fadeIn: 0.1, pow: 0.5, alpha: 0.85, intensity: 1.4 }),
  // 먼지 구름
  dust: kind({ additive: false, life0: 0.6, life1: 1.2, size0: 0.3, size1: 0.6, grow: 2.8, gravity: -0.35, drag: 2.6, shape: 0, fadeIn: 0.08, pow: 1.1, alpha: 0.42 }),
  // 재(사망) — 천천히 떠올라 흩어진다
  ash: kind({ additive: false, life0: 1.2, life1: 2.4, size0: 0.05, size1: 0.12, grow: 0.5, gravity: -0.9, drag: 1.0, shape: 4, fadeIn: 0.1, pow: 0.8, alpha: 0.8 }),
  // 파편(붉은 피격 파편 · 돌 부스러기)
  shard: kind({ additive: false, life0: 0.4, life1: 0.8, size0: 0.05, size1: 0.11, grow: 0.6, gravity: 14, drag: 0.8, stretch: 0.02, shape: 4, bounce: true, pow: 0.5, alpha: 0.95 }),
  // 빛나는 파편(얼음)
  crystal: kind({ life0: 0.4, life1: 0.9, size0: 0.06, size1: 0.14, grow: 0.5, gravity: 12, drag: 0.6, stretch: 0.025, shape: 4, bounce: true, pow: 0.5, intensity: 2.2 }),
  // 떠오르는 회복 · 성장의 빛
  rise: kind({ life0: 0.7, life1: 1.2, size0: 0.06, size1: 0.12, grow: 0.3, gravity: -1.5, drag: 0.6, stretch: 0.1, shape: 2, fadeIn: 0.15, pow: 0.8, intensity: 3.5 }),
  // 브레스의 몸통: 빠르게 나가며 부풀어 원뿔을 채운다
  breath: kind({ life0: 0.5, life1: 0.65, size0: 0.22, size1: 0.4, grow: 7.5, drag: 0.5, shape: 0, fadeIn: 0.2, pow: 0.7, alpha: 0.55, intensity: 1.5 }),
  // 냉기 · 연무(가시 · 충격파의 김)
  mist: kind({ life0: 0.45, life1: 0.7, size0: 0.45, size1: 0.8, grow: 2.6, drag: 0.9, shape: 0, fadeIn: 0.15, pow: 1.2, alpha: 0.5, intensity: 1.3 }),
};

/** 고리 입자의 크기 → 반지름 환산(셰이더의 고리 중심이 쿼드 반폭의 0.8 지점). */
const RING_RADIUS_FRAC = 0.8;
/** @param {number} radius @returns {number} 고리 반지름 → 쿼드 한 변 */
export function ringSize(radius) {
  return (radius * 2) / RING_RADIUS_FRAC;
}

// 입자 하나의 CPU 상태(Float32Array 한 줄)
const S = 20;
const VX = 0, VY = 1, VZ = 2, AGE = 3, LIFE = 4, SIZE0 = 5, SIZE1 = 6, GRAV = 7, DRAG = 8, STRETCH = 9,
  ALPHA = 10, FADEIN = 11, POW = 12, BOUNCE = 13;
const GROUND_Y = 0.03;
const BOUNCE_KEEP = 0.38;
/** 가산 풀이 차지하는 예산 비율(나머지는 알파 풀) */
const ADDITIVE_SHARE = 0.72;
/** 입자 수 배율의 기준 예산(medium) */
const BASE_BUDGET = 400;

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iVel;    // xyz = 늘이는 벡터(월드 m) · w = 크기(m)
attribute vec4 iColor;  // 선형 rgb(HDR) · a
attribute vec3 iMisc;   // x = 모양 · y = 바닥에 누움 · z = 고리 두께
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vMisc;
void main() {
  vUv = position.xy * 2.0;
  vColor = iColor;
  vMisc = iMisc.xz;
  float size = iVel.w;
  vec4 mv;
  if (iMisc.y > 0.5) {
    mv = viewMatrix * vec4(iPos + vec3(position.x, 0.0, position.y) * size, 1.0);
  } else {
    mv = viewMatrix * vec4(iPos, 1.0);
    vec2 st = (viewMatrix * vec4(iVel.xyz, 0.0)).xy;
    float l = length(st);
    vec2 ax = l > 1e-5 ? st / l : vec2(1.0, 0.0);
    vec2 ay = vec2(-ax.y, ax.x);
    mv.xy += ax * position.x * (size + l) + ay * position.y * size;
  }
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vMisc;
void main() {
  float d = length(vUv);
  float shape = vMisc.x;
  float a;
  if (shape < 0.5) { a = smoothstep(1.0, 0.0, d); a *= a; }
  else if (shape < 1.5) { a = smoothstep(vMisc.y, 0.0, abs(d - ${RING_RADIUS_FRAC.toFixed(2)})); }
  else if (shape < 2.5) { a = smoothstep(1.0, 0.3, d); }
  else if (shape < 3.5) {
    float s = sqrt(abs(vUv.x)) + sqrt(abs(vUv.y));
    a = smoothstep(1.0, 0.5, s) + 0.5 * smoothstep(0.45, 0.0, d);
  }
  else { a = smoothstep(1.0, 0.8, abs(vUv.x) + abs(vUv.y)); }
  a = min(a, 1.0) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 인스턴스 쿼드 한 장 = 혼합 방식 하나. 링 버퍼. */
class Pool {
  /**
   * @param {number} capacity
   * @param {boolean} additive
   */
  constructor(capacity, additive) {
    this.capacity = capacity;
    this.budget = capacity;
    this.cursor = 0;
    this.alive = 0;
    this.s = new Float32Array(capacity * S);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.misc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.pos, this.vel, this.col, this.misc]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.pos);
    geo.setAttribute('iVel', this.vel);
    geo.setAttribute('iColor', this.col);
    geo.setAttribute('iMisc', this.misc);
    geo.instanceCount = capacity;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    this.mesh.visible = false;
  }

  /** @param {number} n */
  setBudget(n) {
    const b = Math.max(1, Math.min(this.capacity, Math.floor(n)));
    if (b === this.budget) return;
    this.clear();
    this.budget = b;
    this.geometry.instanceCount = b;
  }

  clear() {
    this.s.fill(0);
    const v = this.vel.array;
    for (let i = 3; i < v.length; i += 4) v[i] = 0;
    this.vel.needsUpdate = true;
    this.cursor = 0;
    this.alive = 0;
    this.mesh.visible = false;
  }

  /** 빈 칸(없으면 가장 오래된 칸)에 쓴다. @returns {number} 칸 번호 */
  write(k, x, y, z, vx, vy, vz, r, g, b, life, size0, size1, alpha) {
    const s = this.s;
    let i = this.cursor;
    // 빈 칸이 남아 있으면 살아 있는 입자를 덮지 않는다(짧은 연출이 오래 사는 분위기 입자를 밀어내지 않게).
    // 가득 찼을 때만 커서 자리 = 가장 오래된 축을 덮어쓴다
    if (this.alive < this.budget) {
      while (s[i * S + LIFE] > 0) i = (i + 1) % this.budget;
    }
    this.cursor = (i + 1) % this.budget;
    const o = i * S;
    if (!(s[o + LIFE] > 0)) this.alive += 1;
    s[o + VX] = vx; s[o + VY] = vy; s[o + VZ] = vz;
    s[o + AGE] = 0; s[o + LIFE] = life;
    s[o + SIZE0] = size0; s[o + SIZE1] = size1;
    s[o + GRAV] = k.gravity; s[o + DRAG] = k.drag; s[o + STRETCH] = k.stretch;
    s[o + ALPHA] = alpha; s[o + FADEIN] = k.fadeIn; s[o + POW] = k.pow; s[o + BOUNCE] = k.bounce ? 1 : 0;
    const p = this.pos.array;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    const c = this.col.array;
    c[i * 4] = r * k.intensity; c[i * 4 + 1] = g * k.intensity; c[i * 4 + 2] = b * k.intensity;
    c[i * 4 + 3] = k.fadeIn > 0 ? 0 : alpha;
    const v = this.vel.array;
    v[i * 4] = vx * k.stretch; v[i * 4 + 1] = vy * k.stretch; v[i * 4 + 2] = vz * k.stretch; v[i * 4 + 3] = size0;
    const m = this.misc.array;
    m[i * 3] = k.shape; m[i * 3 + 1] = k.flat ? 1 : 0; m[i * 3 + 2] = k.ring;
    this.misc.needsUpdate = true;
    this.pos.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.col.needsUpdate = true;
    this.mesh.visible = true;
    return i;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.alive === 0 || !(dt > 0)) return;
    const s = this.s;
    const p = this.pos.array;
    const v = this.vel.array;
    const c = this.col.array;
    let alive = 0;
    for (let i = 0; i < this.budget; i++) {
      const o = i * S;
      const life = s[o + LIFE];
      if (!(life > 0)) continue;
      const age = s[o + AGE] + dt;
      if (age >= life) {
        s[o + LIFE] = 0;
        v[i * 4 + 3] = 0;
        continue;
      }
      alive += 1;
      s[o + AGE] = age;
      const damp = Math.max(0, 1 - s[o + DRAG] * dt);
      let vx = s[o + VX] * damp;
      let vy = (s[o + VY] - s[o + GRAV] * dt) * damp;
      let vz = s[o + VZ] * damp;
      const i3 = i * 3;
      p[i3] += vx * dt;
      let y = p[i3 + 1] + vy * dt;
      p[i3 + 2] += vz * dt;
      if (s[o + BOUNCE] > 0 && y < GROUND_Y && vy < 0) {
        y = GROUND_Y;
        vy = -vy * BOUNCE_KEEP;
        vx *= 0.6;
        vz *= 0.6;
      }
      p[i3 + 1] = y;
      s[o + VX] = vx; s[o + VY] = vy; s[o + VZ] = vz;
      const u = age / life;
      const st = s[o + STRETCH];
      const i4 = i * 4;
      v[i4] = vx * st; v[i4 + 1] = vy * st; v[i4 + 2] = vz * st;
      v[i4 + 3] = s[o + SIZE0] + (s[o + SIZE1] - s[o + SIZE0]) * u;
      const fi = s[o + FADEIN];
      const a = u < fi ? u / fi : Math.pow(1 - (u - fi) / (1 - fi), s[o + POW]);
      c[i4 + 3] = s[o + ALPHA] * a;
    }
    this.alive = alive;
    this.pos.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.col.needsUpdate = true;
    if (alive === 0) this.mesh.visible = false;
  }

  /** 방금 쓴 입자를 수명의 frac 지점으로 미리 보낸다(분위기 입자 예열). */
  age(i, frac) {
    const o = i * S;
    this.s[o + AGE] = this.s[o + LIFE] * frac;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const rand = Math.random;
/** @param {number} a @param {number} b */
const rr = (a, b) => a + (b - a) * rand();

/**
 * 입자 계. 가산 풀 + 알파 풀. 색은 THREE.Color(선형)로 넘긴다.
 */
export class Particles {
  /**
   * @param {THREE.Object3D} parent fxRoot
   * @param {'low'|'medium'|'high'} quality
   */
  constructor(parent, quality) {
    let cap = 0;
    for (const q of Object.values(QUALITY)) cap = Math.max(cap, q.particles);
    this._add = new Pool(Math.ceil(cap * ADDITIVE_SHARE), true);
    this._alpha = new Pool(cap - Math.ceil(cap * ADDITIVE_SHARE), false);
    this.parent = parent;
    parent.add(this._alpha.mesh, this._add.mesh);
    /** 터뜨릴 때 개수에 곱하는 배율(예산 비례) */
    this.countScale = 1;
    this.budget = cap;
    this.setQuality(quality);
  }

  /** @param {'low'|'medium'|'high'} quality */
  setQuality(quality) {
    const budget = (QUALITY[quality] ?? QUALITY.medium).particles;
    this.budget = budget;
    const add = Math.ceil(budget * ADDITIVE_SHARE);
    this._add.setBudget(add);
    this._alpha.setBudget(budget - add);
    this.countScale = Math.min(1.6, Math.max(0.4, budget / BASE_BUDGET));
  }

  /** 살아 있는 입자 수(예산 검사용). */
  get alive() {
    return this._add.alive + this._alpha.alive;
  }

  /** @param {number} n 기준 개수 → 예산에 맞춘 개수(확률 반올림) */
  count(n) {
    return Math.floor(n * this.countScale + rand());
  }

  /**
   * 입자 하나. 크기 · 수명은 종류의 범위에서 뽑고 배율을 곱한다.
   * @param {ParticleKind} k
   * @param {THREE.Color} color
   * @returns {number} 칸 번호(예열용)
   */
  emit(k, x, y, z, vx, vy, vz, color, sizeMul = 1, lifeMul = 1) {
    const size0 = rr(k.size0, k.size1) * sizeMul;
    const pool = k.additive ? this._add : this._alpha;
    return pool.write(k, x, y, z, vx, vy, vz, color.r, color.g, color.b, rr(k.life0, k.life1) * lifeMul, size0, size0 * k.grow, k.alpha);
  }

  /**
   * 크기를 직접 정하는 입자(고리 · 섬광) — size0 → size1로 수명 동안 변한다.
   * @param {ParticleKind} k
   * @param {THREE.Color} color
   */
  emitSized(k, x, y, z, size0, size1, life, color, alphaMul = 1) {
    const pool = k.additive ? this._add : this._alpha;
    return pool.write(k, x, y, z, 0, 0, 0, color.r, color.g, color.b, life, size0, size1, k.alpha * alphaMul);
  }

  /** 예열: 방금 뿌린 입자의 나이를 앞당긴다. */
  preAge(k, i, frac) {
    (k.additive ? this._add : this._alpha).age(i, frac);
  }

  /**
   * 원뿔 다발. (dx, dy, dz) 방향(정규화 불필요)으로 spread(0 = 한 줄 · 1 = 사방)만큼 퍼진다.
   * @param {ParticleKind} k
   * @param {number} n 기준 개수(예산 배율이 곱해진다)
   * @param {THREE.Color} color
   */
  burst(k, n, x, y, z, dx, dy, dz, spread, sp0, sp1, color, sizeMul = 1, jitter = 0.05) {
    const count = this.count(n);
    const dl = Math.hypot(dx, dy, dz) || 1;
    const w = Math.min(1, Math.max(0, spread));
    for (let i = 0; i < count; i++) {
      // 고른 구면 방향
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const q = Math.sqrt(1 - u * u);
      let vx = (dx / dl) * (1 - w) + q * Math.cos(a) * w;
      let vy = (dy / dl) * (1 - w) + u * w;
      let vz = (dz / dl) * (1 - w) + q * Math.sin(a) * w;
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = rr(sp0, sp1) / l;
      vx *= sp; vy *= sp; vz *= sp;
      this.emit(k, x + (rand() - 0.5) * jitter, y + (rand() - 0.5) * jitter, z + (rand() - 0.5) * jitter, vx, vy, vz, color, sizeMul);
    }
  }

  /**
   * 바닥 원 위에서 바깥으로 퍼지는 고리 다발(먼지 고리 · 충격파).
   * @param {ParticleKind} k
   * @param {THREE.Color} color
   */
  ringBurst(k, n, x, y, z, radius, sp0, sp1, up, color, sizeMul = 1) {
    const count = this.count(n);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const sp = rr(sp0, sp1);
      this.emit(k, x + s * radius, y, z + c * radius, s * sp, rr(0, up), c * sp, color, sizeMul);
    }
  }

  /** @param {number} dt */
  update(dt) {
    this._add.update(dt);
    this._alpha.update(dt);
  }

  clear() {
    this._add.clear();
    this._alpha.clear();
  }

  dispose() {
    this.parent.remove(this._add.mesh, this._alpha.mesh);
    this._add.dispose();
    this._alpha.dispose();
  }
}
