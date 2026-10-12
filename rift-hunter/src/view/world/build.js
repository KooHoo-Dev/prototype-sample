// OWNER: P7 — 계약 §9.4 (내부 — 다른 패키지가 import 하지 않는다)
// 로우폴리 지오메트리 조립기: three 기본 도형을 변환 · 색 · 흔들기(결정적 잡음)로 이어 붙여 BufferGeometry 하나(position · normal · color)로 만든다.
// 맵을 지을 때만 돈다(프레임 경로가 아니다). 원본 도형은 GPU 에 올리지 않는 임시 객체라 dispose 할 것이 없다.

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/** 정수 해시 → [0, 1) @param {number} a @param {number} [b] @param {number} [c] @param {number} [d] */
export function hash01(a, b = 0, c = 0, d = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 16), 0x27d4eb2f);
  h = Math.imul(h ^ (d | 0) ^ (h >>> 15), 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 실수 좌표 해시(1/1000 m 로 양자화 — 같은 꼭짓점은 같은 값) → [−1, 1) */
export function hashPos(x, y, z, seed = 0) {
  return hash01(Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000), seed) * 2 - 1;
}

/** 부드러운 2D 값 잡음 [0, 1] — 격자 크기 cell(m) */
export function valueNoise(x, z, cell, seed = 0) {
  const gx = x / cell, gz = z / cell;
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash01(i, j, seed), b = hash01(i + 1, j, seed), c = hash01(i, j + 1, seed), d = hash01(i + 1, j + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** 문자열 → 32비트 씨앗(맵 ID 로 장식 배치를 결정적으로) */
export function seedOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** 결정적 난수기(mulberry32 — view 장식 배치용) */
export function makeRand(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + (b - a) * next(), pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length] };
}

/**
 * 변환 행렬(공용 임시 — 곧바로 add 에 넘긴다). 회전 순서 YXZ(먼저 기울이고 yaw)
 * @returns {THREE.Matrix4}
 */
export function xf(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** 16진 색 · Color · [r,g,b](선형) → 선형 RGB 를 out 에 */
function toLinear(color, out) {
  if (typeof color === 'number') return out.setHex(color);
  if (Array.isArray(color)) return out.setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace);
  return out.copy(color);
}

export class GeoBuilder {
  constructor() {
    /** @type {number[]} */ this.p = [];
    /** @type {number[]} */ this.n = [];
    /** @type {number[]} */ this.c = [];
  }

  get vertexCount() { return this.p.length / 3; }

  /**
   * 원본 도형을 변환해 이어 붙인다.
   * @param {THREE.BufferGeometry} src
   * @param {THREE.Matrix4} m4
   * @param {number|THREE.Color|number[]} color
   * @param {{smooth?:boolean, jitter?:number, jitterSeed?:number, jitterY?:number, shade?:(lx:number, ly:number, lz:number) => number, keepTop?:boolean, keepBottom?:number}} [opts]
   *   jitter: 원본 좌표 기준 흔들기 폭(m) · shade: 원본 좌표 → 색 배율 · smooth: 원본 법선을 쓴다(아니면 면 법선)
   *   keepBottom: 원본 y 가 이 값 이하인 꼭짓점은 y 를 흔들지 않는다(바닥에 붙은 밑면)
   */
  add(src, m4, color, opts = {}) {
    const g = src.index ? src.toNonIndexed() : src;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    toLinear(color, _c);
    const cr = _c.r, cg = _c.g, cb = _c.b;
    const j = opts.jitter ?? 0, jy = opts.jitterY ?? j, js = opts.jitterSeed ?? 0;
    const smooth = !!opts.smooth && !!nor && !j;
    if (smooth) _nm.getNormalMatrix(m4);
    const start = this.p.length;
    for (let i = 0; i < pos.count; i++) {
      let lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
      const k = opts.shade ? opts.shade(lx, ly, lz) : 1;
      if (j) {
        const top = (opts.keepTop && ly > 0) || (opts.keepBottom !== undefined && ly <= opts.keepBottom + 1e-6) ? 0 : 1;
        lx += hashPos(lx, ly, lz, js + 1) * j;
        ly += hashPos(lx, ly, lz, js + 2) * jy * top;
        lz += hashPos(lx, ly, lz, js + 3) * j;
      }
      _v.set(lx, ly, lz).applyMatrix4(m4);
      this.p.push(_v.x, _v.y, _v.z);
      this.c.push(cr * k, cg * k, cb * k);
      if (smooth) {
        _n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(_nm).normalize();
        this.n.push(_n.x, _n.y, _n.z);
      } else this.n.push(0, 1, 0);
    }
    if (!smooth) this._flatNormals(start);
    return this;
  }

  /** 삼각형 하나(바깥 = 반시계) — 면 법선 */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
    const start = this.p.length;
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.c.push(r, g, b, r, g, b, r, g, b);
    this.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    this._flatNormals(start);
  }

  /** 위를 보는 사각형(바닥 · 판) — 꼭짓점 순서 p0(x0,z0) · p1(+x 쪽) · p2(+x+z 쪽) · p3(+z 쪽) · 색은 꼭짓점마다 [r,g,b] 4개 또는 하나 */
  quadUp(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, cols) {
    // 삼각형 (p0, p2, p1) · (p0, p3, p2) — 법선 (b − a) × (c − a) 가 +Y
    const c0 = cols[0], c1 = cols[1] ?? c0, c2 = cols[2] ?? c0, c3 = cols[3] ?? c0;
    this.p.push(x0, y0, z0, x2, y2, z2, x1, y1, z1, x0, y0, z0, x3, y3, z3, x2, y2, z2);
    this.c.push(...c0, ...c2, ...c1, ...c0, ...c3, ...c2);
    const start = this.p.length - 18;
    this.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    this._flatNormals(start);
  }

  _flatNormals(start) {
    const p = this.p, n = this.n;
    for (let i = start; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 9; k += 3) { n[i + k] = nx; n[i + k + 1] = ny; n[i + k + 2] = nz; }
    }
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

/** 선형 RGB [r,g,b] 를 배율 k 로 · 16진 입력 */
export function rgb(hex, k = 1) {
  _c.setHex(hex);
  return [_c.r * k, _c.g * k, _c.b * k];
}

/** 두 16진 색을 t 로 섞은 선형 RGB */
export function mixRgb(hexA, hexB, t, k = 1) {
  const a = rgb(hexA), b = rgb(hexB);
  return [(a[0] + (b[0] - a[0]) * t) * k, (a[1] + (b[1] - a[1]) * t) * k, (a[2] + (b[2] - a[2]) * t) * k];
}
