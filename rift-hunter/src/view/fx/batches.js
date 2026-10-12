// OWNER: P13 — 계약 §9.7 (내부 — 인스턴스 묶음)
// 모양마다 InstancedMesh 하나(용량 고정 · 매 프레임 begin → add… → end) — 그리는 것의 수가 늘어도 드로콜이 늘지 않는다.
// 가산 묶음은 인스턴스 색에 세기를 곱해 넣는다(가산 혼합에서 색 × 세기 = 밝기). 보통 묶음(쇠사슬 · 화살 · 돌 · 뼈 가시 · 포신)은 불투명.
// 껍질(shell): 가장자리만 밝은 구(프레넬) — 보호막 · 얼음 껍질 · 폭발 구가 대상의 자세를 가리지 않는다(QUALITY §4).

import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, DoubleSide,
  DynamicDrawUsage, Euler, FrontSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry, Quaternion,
  ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { lin } from './style.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export class InstBatch {
  /** @param {string} name @param {BufferGeometry} geometry @param {import('three').Material} material @param {number} cap @param {number} renderOrder */
  constructor(name, geometry, material, cap, renderOrder = 0) {
    this.name = name;
    this.cap = cap;
    this.mesh = new InstancedMesh(geometry, material, cap);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.col = new Float32Array(cap * 3);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.col, 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mat = /** @type {Float32Array} */ (this.mesh.instanceMatrix.array);
    this.n = 0;
    /** 테스트 — 쓴 인스턴스의 기록(평소 false) */
    this.trace = false;
    /** @type {Array<{tag:string, i:number}>} */
    this.spans = [];
    this._tag = '';
  }

  begin() {
    this.n = 0;
    if (this.trace) this.spans.length = 0;
  }

  /** 테스트 — 다음 인스턴스들의 꼬리표 */
  mark(tag) { this._tag = tag; }

  _room() { return this.n < this.cap; }

  /** 행렬 elements(_m) + 색 → 칸 */
  _put(r, g, b) {
    const i = this.n++;
    this.mat.set(_m.elements, i * 16);
    const o = i * 3;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    if (this.trace) this.spans.push({ tag: this._tag, i });
    return i;
  }

  /** 위치 · Y 회전 · 배율 · 색(선형 rgb × 세기 k) */
  addTRS(x, y, z, ry, sx, sy, sz, c, k = 1) {
    if (!this._room()) return -1;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const e = _m.elements;
    e[0] = cs * sx; e[1] = 0; e[2] = -sn * sx; e[3] = 0;
    e[4] = 0; e[5] = sy; e[6] = 0; e[7] = 0;
    e[8] = sn * sz; e[9] = 0; e[10] = cs * sz; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    return this._put(c[0] * k, c[1] * k, c[2] * k);
  }

  /** 위치 · 오일러(YXZ) · 배율 */
  addEuler(x, y, z, rx, ry, rz, sx, sy, sz, c, k = 1) {
    if (!this._room()) return -1;
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    return this._put(c[0] * k, c[1] * k, c[2] * k);
  }

  /** 굵은 선분(단위 상자 — z 축이 선분 · 폭 w) */
  addSeg(x0, y0, z0, x1, y1, z1, w, c, k = 1) {
    if (!this._room()) return -1;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const L = Math.hypot(dx, dy, dz);
    if (!(L > 1e-5)) return -1;
    const zx = dx / L, zy = dy / L, zz = dz / L;
    // x = 위 × z(수평) — z 가 거의 수직이면 (1, 0, 0)
    let xx = zz, xy = 0, xz = -zx;
    let xl = Math.hypot(xx, xz);
    if (xl < 1e-4) { xx = 1; xz = 0; xl = 1; }
    xx /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const e = _m.elements;
    e[0] = xx * w; e[1] = xy * w; e[2] = xz * w; e[3] = 0;
    e[4] = yx * w; e[5] = yy * w; e[6] = yz * w; e[7] = 0;
    e[8] = zx * L; e[9] = zy * L; e[10] = zz * L; e[11] = 0;
    e[12] = (x0 + x1) / 2; e[13] = (y0 + y1) / 2; e[14] = (z0 + z1) / 2; e[15] = 1;
    return this._put(c[0] * k, c[1] * k, c[2] * k);
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.n > 0) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, this.n * 16);
      m.instanceMatrix.needsUpdate = true;
      const ic = /** @type {InstancedBufferAttribute} */ (m.instanceColor);
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, this.n * 3);
      ic.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    /** @type {import('three').Material} */ (this.mesh.material).dispose();
    this.mesh.dispose();
  }
}

// ───────────────────────── 재질 ─────────────────────────

/** 가산 · 빛(인스턴스 색 × 세기) */
export function glowMaterial({ vertexColors = false, side = FrontSide } = {}) {
  return new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false, vertexColors, side });
}

/** 불투명(인스턴스 색) */
export function solidMaterial({ vertexColors = false } = {}) {
  return new MeshBasicMaterial({ vertexColors });
}

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = transpose(inverse(mat3(instanceMatrix))) * n;
#endif
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#else
  vC = vec3(1.0);
#endif
#ifdef USE_COLOR
  vC *= color;
#endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform float uCore;
uniform float uPow;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float k = uCore + pow(f, uPow);
  gl_FragColor = linearToOutputTexel(vec4(vC * k, 1.0));
}`;

/**
 * 껍질(프레넬 · 가산) — 가운데 uCore · 가장자리로 갈수록 밝다(속의 대상이 보인다).
 * vertexColors = 정점 색을 곱한다(빛기둥의 아래 → 위 그러데이션) · side = 열린 원기둥은 DoubleSide
 */
export function shellMaterial(core = 0.08, pow = 2.2, { vertexColors = false, side = FrontSide } = {}) {
  return new ShaderMaterial({
    uniforms: { uCore: { value: core }, uPow: { value: pow } },
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    transparent: true, depthWrite: false, blending: AdditiveBlending, vertexColors, side,
  });
}

// ───────────────────────── 지오메트리 ─────────────────────────

/** 지오메트리 여럿을 하나로(인덱스 없이 · position · normal · color — 셋 다 있는 것만) @param {BufferGeometry[]} list */
function mergeGeometries(list) {
  const flat = list.map(g => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'color'];
  const out = new BufferGeometry();
  for (const name of names) {
    let total = 0;
    for (const g of flat) total += g.getAttribute(name).array.length;
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of flat) {
      const a = g.getAttribute(name).array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new BufferAttribute(arr, 3));
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== list[i]) flat[i].dispose();
  return out;
}

/** 빛기둥 — 열린 원기둥(반지름 1 · 높이 1 · 바닥 y = 0) · 정점 색 = 아래 1 → 위 0(가산이라 밝기 그러데이션) · 껍질 재질(가장자리만 밝다 — 속의 몸이 보인다) */
export function pillarGeometry() {
  const g = new CylinderGeometry(1, 1, 1, 20, 4, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = (1 - y) * (1 - y);
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** 바람 줄 — 수평 원호(반지름 1 · 각 1.7rad · y = 0 평면) */
export function arcGeometry() {
  const g = new TorusGeometry(1, 0.035, 4, 20, 1.7);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 쇠사슬 고리 — 길쭉한 고리(길이 축 x · 지름 1) */
export function linkGeometry() {
  const g = new TorusGeometry(0.5, 0.14, 6, 12);
  g.scale(1.5, 1, 1);
  return g;
}

/** 별(5각 · z 를 향한 평면 · 지름 1) */
export function starGeometry() {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i & 1 ? 0.22 : 0.5;
    const t = (i / 10) * Math.PI * 2;
    const x = Math.sin(t) * r, y = Math.cos(t) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return new ShapeGeometry(s);
}

/** 얼음 파편 — 길쭉한 팔면체(z 축 길이 1 · 굵기 0.25) */
export function shardGeometry() {
  const g = new OctahedronGeometry(0.5, 0);
  g.scale(0.25, 0.25, 1);
  return g;
}

/** 화살(+z 가 앞 · 길이 0.8 = §9.6 — 촉 끝 z = +0.4 · 깃 끝 z = −0.4) · 정점 색(대 · 촉 · 깃) */
export function arrowGeometry() {
  const shaft = new BoxGeometry(0.035, 0.035, 0.66);
  shaft.translate(0, 0, -0.07);
  const head = new ConeGeometry(0.055, 0.14, 5);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, 0.33);
  const f1 = new BoxGeometry(0.005, 0.11, 0.16);
  f1.translate(0, 0, -0.32);
  const f2 = new BoxGeometry(0.11, 0.005, 0.16);
  f2.translate(0, 0, -0.32);
  const paint = (g, hex) => {
    const n = g.getAttribute('position').count;
    const [r, gg, b] = lin(hex);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
    g.setAttribute('color', new BufferAttribute(c, 3));
    return g;
  };
  const merged = mergeGeometries([paint(shaft, 0x8a6a46), paint(head, 0xc8ccd2), paint(f1, 0xe8e2d0), paint(f2, 0xe8e2d0)]);
  for (const g of [shaft, head, f1, f2]) g.dispose();
  return merged;
}

/** 단위 구(빛 · 껍질) */
export function sphereGeometry(w = 16, h = 12) { return new SphereGeometry(1, w, h); }
/** 단위 상자(선분) */
export function boxGeometry() { return new BoxGeometry(1, 1, 1); }
/** 돌 · 포탄 */
export function rockGeometry() { return new DodecahedronGeometry(1, 0); }
/** 뼈 가시(밑 반지름 1 · 높이 1 · 바닥 y = 0) */
export function spikeGeometry() {
  const g = new ConeGeometry(1, 1, 5);
  g.translate(0, 0.5, 0);
  return g;
}
/** 포신(반지름 1 · 길이 1 · z 축) */
export function barrelGeometry() {
  const g = new CylinderGeometry(1, 1.15, 1, 8);
  g.rotateX(Math.PI / 2);
  return g;
}

export { DoubleSide };
