// OWNER: P13 — 계약 §9.7 (내부 — 입자 · 스프라이트)
// PointBuffer: THREE.Points 하나(정점마다 위치 · 색 rgba · 지름 m) — 둥근 부드러운 점(텍스처 없음 · 외부 에셋 0).
//   점 크기는 화면 높이의 uMaxFrac 를 넘지 않는다(카메라 가까이 온 입자가 화면을 덮지 않게 — QUALITY §4).
// ParticlePool: 시뮬 입자(이벤트의 불꽃 · 먼지) — 고정 용량 SoA · 나이로 위치를 바로 계산한다(p = p0 + v·(1 − e^(−kt))/k − ½gt²) ·
//   다 산 것은 끝 칸과 바꿔 지운다(살아 있는 것이 늘 앞에 모여 있다) · 상한을 넘는 생성은 버린다(풀이 늘지 않는다).

import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, NormalBlending, Points, ShaderMaterial } from 'three';

const ATTRS = ['position', 'aColor', 'aSize'];

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
uniform float uMaxPx;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uMaxPx, aSize * uScale / max(0.5, -mv.z));
}`;
const FRAG = /* glsl */ `
uniform float uSoft;
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float a = pow(1.0 - r2, uSoft);
  gl_FragColor = linearToOutputTexel(vec4(vColor.rgb, vColor.a * a));
}`;

export class PointBuffer {
  /** @param {number} cap @param {boolean} additive @param {number} soft 가장자리 부드러움(1 = 선형) @param {number} renderOrder @param {string} name */
  constructor(cap, additive, soft, renderOrder, name) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.geometry = new BufferGeometry();
    const pa = new BufferAttribute(this.pos, 3), ca = new BufferAttribute(this.col, 4), sa = new BufferAttribute(this.size, 1);
    pa.setUsage(DynamicDrawUsage); ca.setUsage(DynamicDrawUsage); sa.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.geometry.setAttribute('aColor', ca);
    this.geometry.setAttribute('aSize', sa);
    this.geometry.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uMaxPx: { value: 96 }, uSoft: { value: soft } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.points.name = name;
    this.n = 0;
  }

  begin() { this.n = 0; }

  /** 점 하나(꽉 차면 false) */
  push(x, y, z, size, r, g, b, a) {
    if (this.n >= this.cap || !(a > 0.002) || !(size > 0)) return false;
    const i = this.n++;
    const p = i * 3, q = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.col[q] = r; this.col[q + 1] = g; this.col[q + 2] = b; this.col[q + 3] = a;
    this.size[i] = size;
    return true;
  }

  /** 색 배열([r, g, b] 선형)로 */
  pushC(x, y, z, size, c, a) { return this.push(x, y, z, size, c[0], c[1], c[2], a); }

  /** @param {number} scale 픽셀/(m · 거리 1) @param {number} maxPx */
  end(scale, maxPx) {
    const g = this.geometry;
    g.setDrawRange(0, this.n);
    for (let k = 0; k < ATTRS.length; k++) {
      const name = ATTRS[k];
      const at = /** @type {BufferAttribute} */ (g.getAttribute(name));
      at.clearUpdateRanges();
      if (this.n > 0) at.addUpdateRange(0, this.n * at.itemSize);
      at.needsUpdate = true;
    }
    this.material.uniforms.uScale.value = scale;
    this.material.uniforms.uMaxPx.value = maxPx;
    this.points.visible = this.n > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class ParticlePool {
  /** @param {number} cap @param {boolean} additive @param {number} renderOrder @param {string} name */
  constructor(cap, additive, renderOrder, name) {
    this.cap = cap;
    this.buf = new PointBuffer(cap, additive, additive ? 1.6 : 1.2, renderOrder, name);
    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.g = f(); this.k = f(); this.age = f(); this.life = f();
    this.s0 = f(); this.s1 = f(); this.a0 = f();
    this.cr = f(); this.cg = f(); this.cb = f();
    this.dr = f(); this.dg = f(); this.db = f();
    this.n = 0;
    /** 상한에 막혀 버린 생성 수(진단) */
    this.dropped = 0;
  }

  get alive() { return this.n; }

  clear() { this.n = 0; }

  /**
   * 입자 하나 — 색 c0 → c1 로 바뀐다 · age0 = 이미 지난 나이(초 — 늦게 처리한 이벤트)
   * @returns {boolean}
   */
  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a, grav, drag, age0) {
    if (!(life > 0) || age0 >= life) return false;
    if (this.n >= this.cap) { this.dropped++; return false; }
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.g[i] = grav; this.k[i] = drag; this.age[i] = age0 > 0 ? age0 : 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.cr[i] = c0[0]; this.cg[i] = c0[1]; this.cb[i] = c0[2];
    this.dr[i] = c1[0]; this.dg[i] = c1[1]; this.db[i] = c1[2];
    return true;
  }

  /** i 를 끝 칸으로 메운다 */
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.g[i] = this.g[j]; this.k[i] = this.k[j]; this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
    this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j];
    this.dr[i] = this.dr[j]; this.dg[i] = this.dg[j]; this.db[i] = this.db[j];
  }

  /** 나이를 dt 만큼 · 다 산 것 지우기 → 버퍼에 쓴다 @param {number} dt 초 */
  update(dt, scale, maxPx) {
    const B = this.buf;
    B.begin();
    for (let i = 0; i < this.n;) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) { this._kill(i); continue; }
      this.age[i] = age;
      const k = this.k[i];
      const m = k > 1e-4 ? (1 - Math.exp(-k * age)) / k : age;
      const x = this.px[i] + this.vx[i] * m;
      let y = this.py[i] + this.vy[i] * m - 0.5 * this.g[i] * age * age;
      const z = this.pz[i] + this.vz[i] * m;
      if (y < 0.04) y = 0.04;
      const u = age / this.life[i];
      const fade = (u < 0.08 ? u / 0.08 : 1) * (1 - u) * (1 - u * 0.3);
      const a = this.a0[i] * fade;
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      B.push(x, y, z, s,
        this.cr[i] + (this.dr[i] - this.cr[i]) * u,
        this.cg[i] + (this.dg[i] - this.cg[i]) * u,
        this.cb[i] + (this.db[i] - this.cb[i]) * u, a);
      i++;
    }
    B.end(scale, maxPx);
  }

  dispose() { this.buf.dispose(); }
}
