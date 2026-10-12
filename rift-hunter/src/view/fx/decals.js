// OWNER: P13 — 계약 §9.6 · §9.7 (내부 — 바닥 표식)
// 바닥 표식 전부를 병합 지오메트리 하나에 매 프레임 다시 쓴다(드로콜 1 — 효과 수에 비례하지 않는다 · 정점 버퍼는 미리 잡아 둔다 · 할당 없음).
// 모양 규약(§3.6 · §0.2): yaw θ 의 앞 = (sin θ, cos θ) · 원뿔은 꼭짓점에서 facing ± angle/2 · 선은 시작점에서 facing 으로 len · 폭 width.
// 치수 규칙(§9.6 — 차이 0): 테두리 띠는 모양 **안쪽**에 둔다 — 바깥 가장자리의 정점이 판정 경계 위에 정확히 놓인다(원호의 정점은 반지름 r 위).
// 채움(진행 p)은 같은 모양을 원점에서 p 배로: 원 · 원뿔 = 반지름 r·p · 고리 = r0 → r0 + (r − r0)·p · 선 = 길이 len·p(폭 그대로).

import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, NormalBlending } from 'three';
import { DECAL } from './style.js';

const TAU = Math.PI * 2;

/** 원호 조각 수(길이 DECAL.segLen 마다 · 상하한) @param {number} r @param {number} span rad */
export function arcSegs(r, span) {
  const n = Math.ceil((Math.abs(span) * Math.max(0, r)) / DECAL.segLen);
  return n < DECAL.segMin ? DECAL.segMin : n > DECAL.segMax ? DECAL.segMax : n;
}

/** 결정적 해시 0..1 @param {number} a @param {number} b */
export function hash01(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export class DecalBatch {
  /**
   * @param {number} maxVerts 정점 예산 @param {boolean} additive 가산 혼합(빛나는 바닥) · 아니면 보통 혼합
   * @param {number} renderOrder
   */
  constructor(maxVerts, additive, renderOrder) {
    this.max = maxVerts;
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 4);
    this.geometry = new BufferGeometry();
    const pa = new BufferAttribute(this.pos, 3);
    const ca = new BufferAttribute(this.col, 4);
    pa.setUsage(DynamicDrawUsage);
    ca.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.geometry.setAttribute('color', ca);
    this.geometry.setDrawRange(0, 0);
    this.material = new MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false, fog: false,
      blending: additive ? AdditiveBlending : NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = additive ? 'fxDecalsGlow' : 'fxDecals';
    this.n = 0;
    this.y = DECAL.lift;
    /** 정점 예산이 찼다(이번 프레임) */
    this.full = false;
    /** 테스트 — 쓴 조각의 기록(평소 false · 켜면 spans 에 {tag, id, start, end}) */
    this.trace = false;
    /** @type {Array<{tag:string, id:number, start:number, end:number}>} */
    this.spans = [];
    this._tag = '';
    this._id = -1;
    this._start = 0;
  }

  begin() {
    this.n = 0;
    this.full = false;
    if (this.trace) this.spans.length = 0;
  }

  end() {
    const g = this.geometry;
    g.setDrawRange(0, this.n);
    const pa = /** @type {BufferAttribute} */ (g.getAttribute('position'));
    const ca = /** @type {BufferAttribute} */ (g.getAttribute('color'));
    pa.clearUpdateRanges();
    ca.clearUpdateRanges();
    if (this.n > 0) {
      pa.addUpdateRange(0, this.n * 3);
      ca.addUpdateRange(0, this.n * 4);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }

  /** 조각 기록 시작(테스트) @param {string} tag @param {number} id */
  mark(tag, id) {
    if (!this.trace) return;
    this._tag = tag;
    this._id = id;
    this._start = this.n;
  }

  /** 조각 기록 끝(테스트) */
  unmark() {
    if (!this.trace || !this._tag) return;
    this.spans.push({ tag: this._tag, id: this._id, start: this._start, end: this.n });
    this._tag = '';
  }

  /** 정점 k 개를 쓸 자리가 있는가 @param {number} k */
  room(k) {
    if (this.n + k <= this.max) return true;
    this.full = true;
    return false;
  }

  /** @param {number} x @param {number} z @param {number[]} c @param {number} a */
  _v(x, z, c, a) {
    const i = this.n++;
    const p = i * 3, q = i * 4;
    this.pos[p] = x; this.pos[p + 1] = this.y; this.pos[p + 2] = z;
    this.col[q] = c[0]; this.col[q + 1] = c[1]; this.col[q + 2] = c[2]; this.col[q + 3] = a;
  }

  /** 삼각형 하나 */
  tri(ax, az, bx, bz, cx, cz, c, a) {
    if (!this.room(3)) return;
    this._v(ax, az, c, a); this._v(bx, bz, c, a); this._v(cx, cz, c, a);
  }

  /** 사각형(a b c d 순서) */
  quad(ax, az, bx, bz, cx, cz, dx, dz, c, a) {
    if (!this.room(6)) return;
    this._v(ax, az, c, a); this._v(bx, bz, c, a); this._v(cx, cz, c, a);
    this._v(ax, az, c, a); this._v(cx, cz, c, a); this._v(dx, dz, c, a);
  }

  /**
   * 부채 · 원판(중심 (x, z) · 반지름 r · 각 a0..a1 — yaw) · ca = 중심 불투명도(없으면 a — 주면 가운데에서 가장자리로 그러데이션)
   */
  fan(x, z, r, a0, a1, c, a, ca = a) {
    if (!(r > 0)) return;
    const n = arcSegs(r, a1 - a0);
    if (!this.room(n * 3)) return;
    const d = (a1 - a0) / n;
    let px = x + Math.sin(a0) * r, pz = z + Math.cos(a0) * r;
    for (let i = 1; i <= n; i++) {
      const t = a0 + d * i;
      const qx = x + Math.sin(t) * r, qz = z + Math.cos(t) * r;
      this._v(x, z, c, ca); this._v(px, pz, c, a); this._v(qx, qz, c, a);
      px = qx; pz = qz;
    }
  }

  /** 띠(반지름 r0..r1 · 각 a0..a1) — 정점은 두 원 위에 정확히 */
  band(x, z, r0, r1, a0, a1, c, a, a0Alpha = a) {
    const lo = Math.max(0, r0);
    if (!(r1 > lo)) return;
    const n = arcSegs(r1, a1 - a0);
    if (!this.room(n * 6)) return;
    const d = (a1 - a0) / n;
    let s = Math.sin(a0), co = Math.cos(a0);
    for (let i = 1; i <= n; i++) {
      const t = a0 + d * i;
      const s2 = Math.sin(t), c2 = Math.cos(t);
      const ix = x + s * lo, iz = z + co * lo, ox = x + s * r1, oz = z + co * r1;
      const ix2 = x + s2 * lo, iz2 = z + c2 * lo, ox2 = x + s2 * r1, oz2 = z + c2 * r1;
      this._v(ix, iz, c, a0Alpha); this._v(ox, oz, c, a); this._v(ox2, oz2, c, a);
      this._v(ix, iz, c, a0Alpha); this._v(ox2, oz2, c, a); this._v(ix2, iz2, c, a0Alpha);
      s = s2; co = c2;
    }
  }

  /**
   * 선 좌표계의 사각형 — 시작 (x, z) · 방향 f · 길이 축 s0..s1 · 옆(오른쪽 = (−cos f, sin f)) 축 w0..w1
   */
  rect(x, z, f, s0, s1, w0, w1, c, a) {
    if (!(s1 > s0) || !(w1 > w0)) return;
    const fx = Math.sin(f), fz = Math.cos(f), rx = -Math.cos(f), rz = Math.sin(f);
    this.quad(
      x + fx * s0 + rx * w0, z + fz * s0 + rz * w0,
      x + fx * s1 + rx * w0, z + fz * s1 + rz * w0,
      x + fx * s1 + rx * w1, z + fz * s1 + rz * w1,
      x + fx * s0 + rx * w1, z + fz * s0 + rz * w1,
      c, a,
    );
  }

  /** 굵은 선분(두 점 · 폭 w) */
  seg(ax, az, bx, bz, w, c, a) {
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) return;
    this.rect(ax, az, Math.atan2(dx, dz), 0, L, -w / 2, w / 2, c, a);
  }
}

// ───────────────────────── 모양 → 데칼 ─────────────────────────

/** @typedef {import('../../types.js').Shape} Shape */

/**
 * 모양의 채움 — 진행 p(0..1)만큼 원점에서 자란 같은 모양(p = 1 이면 판정 영역 그대로)
 * @param {DecalBatch} b @param {Shape} s @param {number} p @param {number[]} c @param {number} a
 */
export function writeFill(b, s, p, c, a) {
  if (!(p > 0) || !(a > 0)) return;
  const k = p > 1 ? 1 : p;
  switch (s.type) {
    case 'circle': b.fan(s.x, s.z, s.r * k, 0, TAU, c, a); break;
    case 'ring': {
      const r0 = s.r0 ?? 0;
      b.band(s.x, s.z, r0, r0 + (s.r - r0) * k, 0, TAU, c, a);
      break;
    }
    case 'cone': {
      const h = (s.angle ?? 0) / 2, f = s.facing ?? 0;
      b.fan(s.x, s.z, s.r * k, f - h, f + h, c, a);
      break;
    }
    case 'line': {
      const hw = (s.width ?? 0) / 2;
      b.rect(s.x, s.z, s.facing ?? 0, 0, (s.len ?? 0) * k, -hw, hw, c, a);
      break;
    }
    default: break;
  }
}

/**
 * 테두리(최종 크기 · 모양 안쪽 띠 bw — 바깥 가장자리 = 판정 경계)
 * @param {DecalBatch} b @param {Shape} s @param {number} bw @param {number[]} c @param {number} a
 */
export function writeBorder(b, s, bw, c, a) {
  if (!(a > 0)) return;
  switch (s.type) {
    case 'circle': {
      const w = Math.min(bw, s.r * 0.3);
      b.band(s.x, s.z, s.r - w, s.r, 0, TAU, c, a);
      break;
    }
    case 'ring': {
      const r0 = s.r0 ?? 0;
      const w = Math.min(bw, (s.r - r0) * 0.3);
      b.band(s.x, s.z, s.r - w, s.r, 0, TAU, c, a);
      if (r0 > 0) b.band(s.x, s.z, r0, r0 + w, 0, TAU, c, a);
      break;
    }
    case 'cone': {
      const h = (s.angle ?? 0) / 2, f = s.facing ?? 0, r = s.r;
      const w = Math.min(bw, r * 0.3);
      b.band(s.x, s.z, r - w, r, f - h, f + h, c, a);
      if (h < Math.PI - 1e-6) {
        // 두 반지름 가장자리 — 부채 안쪽으로 w(바깥 점은 반지름 r 을 넘지 않게 √(r² − w²)까지)
        const L = Math.sqrt(Math.max(0, r * r - w * w));
        for (let side = 0; side < 2; side++) {
          const t = side === 0 ? f - h : f + h;
          const dx = Math.sin(t), dz = Math.cos(t);
          // 각이 커지는 쪽 = (cos t, −sin t) — 왼쪽 가장자리는 그쪽 · 오른쪽 가장자리는 반대쪽이 안쪽
          const sg = side === 0 ? 1 : -1;
          const nx = Math.cos(t) * sg, nz = -Math.sin(t) * sg;
          b.quad(s.x, s.z, s.x + dx * r, s.z + dz * r, s.x + dx * L + nx * w, s.z + dz * L + nz * w, s.x + nx * w, s.z + nz * w, c, a);
        }
      }
      break;
    }
    case 'line': {
      const hw = (s.width ?? 0) / 2, len = s.len ?? 0, f = s.facing ?? 0;
      const w = Math.min(bw, hw * 0.5, len * 0.25);
      b.rect(s.x, s.z, f, 0, len, -hw, -hw + w, c, a);
      b.rect(s.x, s.z, f, 0, len, hw - w, hw, c, a);
      b.rect(s.x, s.z, f, 0, w, -hw + w, hw - w, c, a);
      b.rect(s.x, s.z, f, len - w, len, -hw + w, hw - w, c, a);
      break;
    }
    default: break;
  }
}

/**
 * 채움 앞머리(진행 p 의 가장자리 띠 — 시간이 읽히게)
 * @param {DecalBatch} b @param {Shape} s @param {number} p @param {number} ew @param {number[]} c @param {number} a
 */
export function writeEdge(b, s, p, ew, c, a) {
  if (!(p > 0) || !(a > 0)) return;
  const k = p > 1 ? 1 : p;
  switch (s.type) {
    case 'circle': {
      const R = s.r * k;
      b.band(s.x, s.z, R - ew, R, 0, TAU, c, a);
      break;
    }
    case 'ring': {
      const r0 = s.r0 ?? 0, R = r0 + (s.r - r0) * k;
      b.band(s.x, s.z, Math.max(r0, R - ew), R, 0, TAU, c, a);
      break;
    }
    case 'cone': {
      const h = (s.angle ?? 0) / 2, f = s.facing ?? 0, R = s.r * k;
      b.band(s.x, s.z, R - ew, R, f - h, f + h, c, a);
      break;
    }
    case 'line': {
      const hw = (s.width ?? 0) / 2, L = (s.len ?? 0) * k;
      b.rect(s.x, s.z, s.facing ?? 0, Math.max(0, L - ew), L, -hw, hw, c, a);
      break;
    }
    default: break;
  }
}

/** 판정 영역 안의 점(무늬 자리) — 원 · 고리 · 원뿔 · 선. u, v ∈ [0, 1) · out = [x, z] @param {Shape} s */
export function pointIn(s, u, v, out) {
  switch (s.type) {
    case 'circle':
    case 'ring': {
      const r0 = s.type === 'ring' ? (s.r0 ?? 0) : 0;
      const rr = Math.sqrt(r0 * r0 + (s.r * s.r - r0 * r0) * u);
      const t = TAU * v;
      out[0] = s.x + Math.sin(t) * rr; out[1] = s.z + Math.cos(t) * rr;
      return out;
    }
    case 'cone': {
      const h = (s.angle ?? 0) / 2, f = s.facing ?? 0;
      const rr = s.r * Math.sqrt(u);
      const t = f - h + 2 * h * v;
      out[0] = s.x + Math.sin(t) * rr; out[1] = s.z + Math.cos(t) * rr;
      return out;
    }
    case 'line': {
      const f = s.facing ?? 0, hw = (s.width ?? 0) / 2;
      const a = (s.len ?? 0) * u, w = -hw + 2 * hw * v;
      out[0] = s.x + Math.sin(f) * a - Math.cos(f) * w; out[1] = s.z + Math.cos(f) * a + Math.sin(f) * w;
      return out;
    }
    default:
      out[0] = s.x; out[1] = s.z;
      return out;
  }
}

/** 모양의 대략 반지름(무늬 크기 · 컬링) @param {Shape} s */
export function shapeReach(s) {
  if (s.type === 'line') return Math.max(s.len ?? 0, s.width ?? 0);
  if (s.type === 'poly') return 0;
  return s.r ?? 0;
}

/** 모양 넓이(무늬 개수) @param {Shape} s */
function areaOf(s) {
  switch (s.type) {
    case 'circle': return Math.PI * s.r * s.r;
    case 'ring': return Math.PI * (s.r * s.r - (s.r0 ?? 0) ** 2);
    case 'cone': return (s.r * s.r * (s.angle ?? 0)) / 2;
    case 'line': return (s.len ?? 0) * (s.width ?? 0);
    default: return 0;
  }
}

const _pt = [0, 0];

/** 감옥 쇠사슬 — 원 둘레의 고리(번갈아 고리 · 막대) + 가운데를 가로지르는 두 줄 */
function chains(b, s, c, a, bw) {
  if (s.type !== 'circle' && s.type !== 'ring') return;
  const rho = Math.max(0.2, s.r - bw - 0.16);
  const n = Math.max(6, Math.floor((TAU * rho) / 0.4));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const cx = s.x + Math.sin(t) * rho, cz = s.z + Math.cos(t) * rho;
    link(b, cx, cz, t + Math.PI / 2, i & 1, c, a);
  }
  for (let k = 0; k < 2; k++) {
    const f = Math.PI / 4 + (k * Math.PI) / 2;
    const m = Math.max(2, Math.floor((2 * rho) / 0.4));
    for (let i = 0; i < m; i++) {
      const d = -rho + (2 * rho * (i + 0.5)) / m;
      link(b, s.x + Math.sin(f) * d, s.z + Math.cos(f) * d, f, (i + k) & 1, c, a);
    }
  }
}

/** 고리 하나 — 짝: 테 고리(속이 빈 사각) · 홀: 옆에서 본 막대 */
function link(b, cx, cz, f, odd, c, a) {
  const hl = 0.17, hw = 0.085, th = 0.04;
  if (odd) {
    b.rect(cx - Math.sin(f) * 0.14, cz - Math.cos(f) * 0.14, f, 0, 0.28, -0.025, 0.025, c, a);
    return;
  }
  const x0 = cx - Math.sin(f) * hl, z0 = cz - Math.cos(f) * hl;
  b.rect(x0, z0, f, 0, 2 * hl, -hw, -hw + th, c, a);
  b.rect(x0, z0, f, 0, 2 * hl, hw - th, hw, c, a);
  b.rect(x0, z0, f, 0, th, -hw + th, hw - th, c, a);
  b.rect(x0, z0, f, 2 * hl - th, 2 * hl, -hw + th, hw - th, c, a);
}

/** 기포(역병 · 독 · 역병 덩어리) — 효과 ID 로 정한 자리 · t 로 맥동 · 원 안에 들어가게(가운데 쪽으로 당긴다) */
function bubbles(b, s, id, t, c, a) {
  const n = Math.max(3, Math.min(14, Math.round(areaOf(s) * 0.9)));
  const round = s.type === 'circle' || s.type === 'ring';
  for (let i = 0; i < n; i++) {
    pointIn(s, 0.05 + 0.75 * hash01(id, i * 3 + 1), hash01(id, i * 3 + 2), _pt);
    const r = (0.07 + 0.12 * hash01(id, i * 3 + 3)) * (0.75 + 0.25 * Math.sin(t * 3 + i * 1.7));
    if (round) {
      const dx = _pt[0] - s.x, dz = _pt[1] - s.z, d = Math.hypot(dx, dz), lim = s.r * 0.97 - r;
      if (lim <= 0) continue;
      if (d > lim) { _pt[0] = s.x + (dx / d) * lim; _pt[1] = s.z + (dz / d) * lim; }
    }
    b.band(_pt[0], _pt[1], r * 0.55, r, 0, TAU, c, a);
  }
}

/** 돌진 선의 화살촉 — 앞쪽을 가리킨다 */
function chevrons(b, s, c, a) {
  if (s.type !== 'line') return;
  const f = s.facing ?? 0, hw = (s.width ?? 0) / 2, len = s.len ?? 0;
  const fx = Math.sin(f), fz = Math.cos(f), rx = -Math.cos(f), rz = Math.sin(f);
  const w = Math.min(0.12, hw * 0.25);
  for (let d = 0.8; d < len - 0.3; d += 1.1) {
    const tipX = s.x + fx * d, tipZ = s.z + fz * d;
    for (let sg = -1; sg <= 1; sg += 2) {
      const bx = s.x + fx * (d - hw * 0.6) + rx * hw * 0.55 * sg, bz = s.z + fz * (d - hw * 0.6) + rz * hw * 0.55 * sg;
      b.seg(bx, bz, tipX, tipZ, w, c, a);
    }
  }
}

/** 갈라짐(대지 분쇄 · 수호자 균열) — 중심(꼭짓점) 가까이에서 바깥으로 들쭉날쭉 · 길이 비율 k · 판정 영역 밖으로 나가지 않는다(각 · 반지름을 자른다) */
function cracks(b, s, id, n, k, c, a, w = 0.06) {
  const f = s.facing ?? 0, cone = s.type === 'cone', h = cone ? (s.angle ?? 0) / 2 : Math.PI;
  const R = (s.r ?? 0) * 0.95 * k;
  const r0 = Math.min(0.35, R * 0.3);
  if (!(R > r0 + 0.1)) return;
  const steps = 4;
  for (let i = 0; i < n; i++) {
    const base = cone ? f - h * 0.8 + ((2 * h * 0.8) * (i + 0.5)) / n : (i / n) * TAU + hash01(id, i) * 0.5;
    let px = 0, pz = 0;
    for (let j = 0; j <= steps; j++) {
      const rr = r0 + ((R - r0) * j) / steps;
      let t = base + (j ? (hash01(id + i, j) - 0.5) * 0.35 : 0);
      if (cone) {
        const lim = h - Math.asin(Math.min(1, (w / 2 + 0.02) / rr));
        t = t < f - lim ? f - lim : t > f + lim ? f + lim : t;
      }
      const qx = s.x + Math.sin(t) * rr, qz = s.z + Math.cos(t) * rr;
      if (j) b.seg(px, pz, qx, qz, w * (1 - j / (steps + 2)), c, a);
      px = qx; pz = qz;
    }
  }
}

/** 뼈 가시 자리 표시(선 위 작은 삼각형 — 앞을 가리킨다) */
function spikeMarks(b, s, c, a) {
  if (s.type !== 'line') return;
  const f = s.facing ?? 0, hw = (s.width ?? 0) / 2, len = s.len ?? 0;
  const fx = Math.sin(f), fz = Math.cos(f), rx = -Math.cos(f), rz = Math.sin(f);
  const sz = Math.min(0.35, hw * 0.6);
  let k = 0;
  for (let d = 0.9; d < len - 0.4; d += 1.25, k++) {
    const o = ((k & 1) ? 0.3 : -0.3) * hw;
    const cx = s.x + fx * d + rx * o, cz = s.z + fz * d + rz * o;
    b.tri(cx + fx * sz, cz + fz * sz, cx - fx * sz * 0.6 + rx * sz * 0.6, cz - fz * sz * 0.6 + rz * sz * 0.6, cx - fx * sz * 0.6 - rx * sz * 0.6, cz - fz * sz * 0.6 - rz * sz * 0.6, c, a);
  }
}

/**
 * 무늬 하나(pattern 이름) — 판정 영역 안에만 그린다
 * @param {DecalBatch} b @param {string} pattern @param {Shape} s @param {number} id @param {number} t 장식 시간(초) @param {number} p 진행
 * @param {number[]} c @param {number} a
 */
export function writePattern(b, pattern, s, id, t, p, c, a) {
  if (!(a > 0)) return;
  switch (pattern) {
    case 'chains': chains(b, s, c, a, DECAL.border); break;
    case 'bubbles': bubbles(b, s, id, t, c, a); break;
    case 'chevrons': chevrons(b, s, c, a); break;
    case 'cracks': cracks(b, s, id, 5, 1, c, a); break;
    case 'spikes': spikeMarks(b, s, c, a); break;
    case 'rift': cracks(b, s, id, 7, p, c, a, 0.08); break;
    default: break;
  }
}

/** 나선 팔(소용돌이 — 가산) @param {DecalBatch} b */
export function writeSpiral(b, x, z, r, arms, rot, c, a) {
  const steps = 10;
  for (let k = 0; k < arms; k++) {
    let px = x, pz = z;
    for (let j = 1; j <= steps; j++) {
      const u = j / steps;
      const t = rot + (k / arms) * TAU + u * 2.4;
      const rr = r * u;
      const qx = x + Math.sin(t) * rr, qz = z + Math.cos(t) * rr;
      b.seg(px, pz, qx, qz, 0.08 + 0.18 * u, c, a * (1 - 0.5 * u));
      px = qx; pz = qz;
    }
  }
}
