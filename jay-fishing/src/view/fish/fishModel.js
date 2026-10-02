// OWNER: P6 — 계약 §6.9 · §9.6
// 물고기 모델 — 체형 템플릿 5종(옆모습 · 단면 · 지느러미 표)을 SpeciesLook(색 · 무늬 · 눈 · 입 · 수염 · 발광)으로 칠한다.
// 머리 −Z · 원점 = 몸 중심 · Z 길이 = lengthM · 몸 높이 = look.depth × lengthM · 폭 = 템플릿 폭 비 × lengthM.
// 지오메트리는 (어종 · lod)마다 길이 1로 한 번 만들어 캐시하고 안쪽 그룹의 scale 로 키운다 — 판을 반복해도 geometries 가 늘지 않는다.
// 무늬는 DataTexture(어종마다 한 번 · 캐시) — DOM 없이 Node 에서도 돈다(§9.1). 재질은 모델마다 만들고 disposeFishModel 이 정리한다.

import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep } from '../../core/math.js';

/** @typedef {import('../../types.js').SpeciesDef} SpeciesDef */
/** @typedef {import('../../types.js').SpeciesLook} SpeciesLook */

// ── 연출 상수

const TEX_W = 256;                       // 무늬 텍스처: u = 몸길이(머리 0 → 꼬리 1) · v = 등(0) → 배(1), 양옆 대칭
const TEX_H = 128;
const LOD = [
  { rings: 34, seg: 22, eyeW: 10, eyeH: 7, pupW: 8, pupH: 6, barbelSides: 5, arc: 7, maxTris: 3000 },   // lod 0 — 미리보기
  { rings: 11, seg: 10, eyeW: 4, eyeH: 2, pupW: 4, pupH: 2, barbelSides: 3, arc: 3, maxTris: 400 },     // lod 1 — 점프 · 뜰채
];
const EYE_WHITE = '#eeeee4';
const PUPIL = '#060606';
const MOUTH = '#1a0f0c';
const SILHOUETTE = '#000000';
const GLOW_INTENSITY = 0.6;              // §9.6 — 밤 물속에서 빛난다
const GHOST_OPACITY = 0.55;

/**
 * 체형 템플릿 표 — 새 체형은 여기 한 항목 + BODY_TEMPLATES 에 이름 하나(§8.1).
 * h · w: [t, 값] (t: 주둥이 0 → 꼬리자루 1, 값: 최대 높이 · 폭에 대한 비) · yc: 단면 중심의 높이 오프셋(몸 높이 비)
 * upP · lowP: 위 · 아래 반단면의 초타원 지수(2 = 타원, 클수록 각진다 — 저서형의 평평한 배)
 * bodyFrac: 몸통이 차지하는 길이 비(나머지는 꼬리지느러미) · tail: 꼬리 모양
 * dorsal · anal: [시작 t, 끝 t, 높이(몸 높이 비), 앞 경사 0..1] · pect: [t, 길이(몸길이 비), 아래로 기울기, 바깥 펼침] · pelvic: [t, 길이]
 * eye: [t, 높이(반높이 비), 크기 배율] · mouth: [아래쪽 비율, 폭 비, 높이 비] · gill: 아가미 뚜껑 u
 */
const TEMPLATES = {
  fusiform: {
    width: 0.16, bodyFrac: 0.82, tail: 'forked', tailSpan: 0.62,
    h: [[0, 0.16], [0.05, 0.5], [0.16, 0.86], [0.33, 1], [0.55, 0.9], [0.8, 0.52], [1, 0.3]],
    w: [[0, 0.3], [0.1, 0.72], [0.3, 1], [0.6, 0.8], [1, 0.32]],
    yc: [[0, -0.06], [0.3, 0], [1, 0.02]], upP: 2, lowP: 2.1,
    dorsal: [[0.28, 0.5, 0.36, 0.2], [0.53, 0.74, 0.3, 0.5]], anal: [[0.66, 0.82, 0.26, 0.5]],
    pect: [0.22, 0.13, 0.35, 0.7], pelvic: [0.42, 0.07],
    eye: [0.075, 0.32, 1], mouth: [0.25, 0.75, 0.32], mouthLen: 0.11, gill: 0.2,
  },
  compressed: {
    width: 0.10, bodyFrac: 0.8, tail: 'forked', tailSpan: 0.72,
    h: [[0, 0.2], [0.06, 0.58], [0.2, 0.92], [0.4, 1], [0.62, 0.88], [0.85, 0.45], [1, 0.3]],
    w: [[0, 0.32], [0.15, 0.82], [0.4, 1], [0.7, 0.72], [1, 0.32]],
    yc: [[0, -0.14], [0.25, -0.02], [1, 0.02]], upP: 2, lowP: 2,
    dorsal: [[0.3, 0.76, 0.3, 0.15]], anal: [[0.68, 0.86, 0.28, 0.35]],
    pect: [0.24, 0.12, 0.45, 0.55], pelvic: [0.44, 0.08],
    eye: [0.085, 0.3, 0.95], mouth: [0.3, 0.6, 0.26], mouthLen: 0.06, gill: 0.22,
  },
  eel: {
    width: 0.09, bodyFrac: 0.95, tail: 'round', tailSpan: 0.45,
    h: [[0, 0.36], [0.05, 0.74], [0.14, 0.95], [0.3, 1], [0.72, 0.9], [0.92, 0.62], [1, 0.42]],
    w: [[0, 0.5], [0.1, 0.95], [0.3, 1], [0.72, 0.75], [1, 0.28]],
    yc: [[0, -0.04], [1, 0]], upP: 2, lowP: 2,
    dorsal: [[0.22, 1.0, 0.34, 0.08]], anal: [[0.48, 1.0, 0.26, 0.08]],
    pect: [0.12, 0.05, 0.25, 0.5], pelvic: null,
    eye: [0.04, 0.38, 0.75], mouth: [0.35, 0.75, 0.36], mouthLen: 0.08, gill: 0.1,
  },
  shark: {
    width: 0.17, bodyFrac: 0.74, tail: 'hetero', tailSpan: 0.82,
    h: [[0, 0.05], [0.08, 0.42], [0.2, 0.82], [0.36, 1], [0.6, 0.78], [0.85, 0.36], [1, 0.22]],
    w: [[0, 0.08], [0.1, 0.6], [0.35, 1], [0.65, 0.7], [1, 0.3]],
    yc: [[0, 0.14], [0.2, 0.02], [1, 0.04]], upP: 2, lowP: 2.2,
    dorsal: [[0.36, 0.56, 0.62, 0.05], [0.84, 0.94, 0.22, 0.2]], anal: [[0.82, 0.92, 0.16, 0.3]],
    pect: [0.27, 0.16, 0.42, 0.9], pelvic: [0.62, 0.06],
    eye: [0.1, 0.24, 0.75], mouth: [1, 0.7, 0.18], mouthLen: 0, gill: 0.24, gillSlits: 5,
  },
  benthic: {
    width: 0.20, bodyFrac: 0.8, tail: 'round', tailSpan: 0.4,
    h: [[0, 0.3], [0.08, 0.62], [0.22, 0.9], [0.32, 1], [0.6, 0.8], [0.85, 0.45], [1, 0.28]],
    w: [[0, 0.72], [0.1, 1], [0.25, 1], [0.55, 0.7], [1, 0.26]],
    yc: [[0, -0.04], [1, 0.04]], upP: 2.2, lowP: 3.8,
    dorsal: [[0.3, 0.42, 0.42, 0.2]], anal: [[0.6, 0.9, 0.2, 0.5]],
    pect: [0.18, 0.13, 0.15, 0.95], pelvic: [0.48, 0.07],
    eye: [0.07, 0.62, 0.7], mouth: [0.4, 0.95, 0.24], mouthLen: 0.08, gill: 0.18,
  },
};

/** 철갑상어(scutes): 뾰족한 주둥이 · 비대칭 꼬리 · 꼬리 쪽 등지느러미 — 같은 저서형 안의 변형(데이터로 고른다) */
const STURGEON = {
  tail: 'hetero', tailSpan: 0.7,
  h: [[0, 0.1], [0.08, 0.5], [0.22, 0.88], [0.35, 1], [0.6, 0.78], [0.85, 0.42], [1, 0.26]],
  w: [[0, 0.22], [0.1, 0.8], [0.3, 1], [0.6, 0.7], [1, 0.26]],
  dorsal: [[0.7, 0.84, 0.32, 0.2]], mouth: [1, 0.5, 0.2], mouthLen: 0,
};

// ── 캐시(판을 반복해도 늘지 않는다 — 어종 36 × lod 2 이 상한)

/** @type {Map<string, {body:THREE.BufferGeometry, fins:THREE.BufferGeometry, eyes:THREE.BufferGeometry, pupils:THREE.BufferGeometry, mouth:THREE.BufferGeometry}>} */
const GEO_CACHE = new Map();
/** @type {Map<string, THREE.DataTexture>} */
const TEX_CACHE = new Map();

/** 캐시 크기(누수 검사 · 테스트) */
export function fishModelCacheStats() {
  return { geometries: GEO_CACHE.size * 5, textures: TEX_CACHE.size };
}

// ── 작은 도구

/** 부드러운 구간 보간(키 사이를 smoothstep) @param {Array<[number,number]>} pts @param {number} x */
function sm(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      const k = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * (k * k * (3 - 2 * k));
    }
  }
  return pts[pts.length - 1][1];
}

/** 초타원 성분 @param {number} c @param {number} p */
function sp(c, p) { return Math.sign(c) * Math.pow(Math.abs(c), 2 / p); }

/** 문자열 → 32비트 시드 @param {string} s */
function seedOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 결정적 난수(mulberry32) @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#rrggbb' → [r, g, b] 0..1 @param {string|null|undefined} hex @param {[number,number,number]} [fb] */
function rgb(hex, fb = [0.5, 0.5, 0.5]) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fb;
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 값 노이즈(격자 해시 · 부드러운 보간) — 무늬용 */
function valueNoise(seed) {
  const g = new Float32Array(64 * 64);
  const r = rng(seed);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const at = (a, b) => g[((b & 63) << 6) | (a & 63)];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), sx), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), sx), sy);
  };
}

/** 템플릿 + 어종 변형 @param {SpeciesLook} look */
function templateOf(look) {
  const base = TEMPLATES[look.body] || TEMPLATES.fusiform;
  if (look.body === 'benthic' && look.pattern === 'scutes') return { ...base, ...STURGEON };
  return base;
}

// ── 지오메트리 조립기(위치 · uv · 인덱스 → 한 BufferGeometry)

class GeoBuilder {
  constructor() {
    /** @type {number[]} */ this.pos = [];
    /** @type {number[]} */ this.uv = [];
    /** @type {number[]} */ this.idx = [];
  }
  get count() { return this.pos.length / 3; }
  v(x, y, z, u = 0, w = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** 다각형(볼록에 가까운 꼭짓점 목록) — 첫 점에서 부채꼴 @param {number[][]} pts [x, y, z] */
  fan(pts) {
    const base = this.count;
    for (const p of pts) this.v(p[0], p[1], p[2]);
    for (let i = 1; i < pts.length - 1; i++) this.tri(base, base + i, base + i + 1);
  }
  /** 타원체 @param {number} cx @param {number} cy @param {number} cz @param {number} rx @param {number} ry @param {number} rz @param {number} ws @param {number} hs */
  ellipsoid(cx, cy, cz, rx, ry, rz, ws, hs) {
    const base = this.count;
    const top = this.v(cx, cy + ry, cz);
    for (let j = 1; j < hs; j++) {
      const th = (j / hs) * Math.PI;
      for (let i = 0; i < ws; i++) {
        const ph = (i / ws) * Math.PI * 2;
        this.v(cx + rx * Math.sin(th) * Math.cos(ph), cy + ry * Math.cos(th), cz + rz * Math.sin(th) * Math.sin(ph));
      }
    }
    const bottom = this.v(cx, cy - ry, cz);
    const ring = (j, i) => base + 1 + (j - 1) * ws + (i % ws);
    for (let i = 0; i < ws; i++) this.tri(top, ring(1, i + 1), ring(1, i));
    for (let j = 1; j < hs - 1; j++) {
      for (let i = 0; i < ws; i++) {
        this.tri(ring(j, i), ring(j, i + 1), ring(j + 1, i + 1));
        this.tri(ring(j, i), ring(j + 1, i + 1), ring(j + 1, i));
      }
    }
    for (let i = 0; i < ws; i++) this.tri(bottom, ring(hs - 1, i), ring(hs - 1, i + 1));
  }
  /** 가는 원뿔(수염) @param {number[]} a @param {number[]} b @param {number} r @param {number} sides */
  cone(a, b, r, sides) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const up = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const s = new THREE.Vector3().crossVectors(d, up).normalize();
    const t = new THREE.Vector3().crossVectors(d, s).normalize();
    const base = this.count;
    for (let i = 0; i < sides; i++) {
      const ph = (i / sides) * Math.PI * 2;
      const c = Math.cos(ph) * r;
      const n = Math.sin(ph) * r;
      this.v(a[0] + s.x * c + t.x * n, a[1] + s.y * c + t.y * n, a[2] + s.z * c + t.z * n);
    }
    const tip = this.v(b[0], b[1], b[2]);
    for (let i = 0; i < sides; i++) this.tri(base + i, base + ((i + 1) % sides), tip);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ── 몸통 단면 함수(길이 1 기준)

/** @param {any} T 템플릿 @param {number} H 몸 높이 @param {number} W 몸 폭 */
function bodyShape(T, H, W) {
  const z0 = -0.5;
  const zB = -0.5 + T.bodyFrac;
  return {
    z0, zB,
    zAt: (t) => lerp(z0, zB, t),
    hu: (t) => 0.5 * H * sm(T.h, t),
    hl: (t) => 0.5 * H * sm(T.h, t),
    hw: (t) => 0.5 * W * sm(T.w, t),
    yc: (t) => H * sm(T.yc, t) * sm(T.h, t),
    top: (t) => H * sm(T.yc, t) * sm(T.h, t) + 0.5 * H * sm(T.h, t),
    bot: (t) => H * sm(T.yc, t) * sm(T.h, t) - 0.5 * H * sm(T.h, t),
  };
}

/** 몸통: 고리 rings 개 × 둘레 seg 개 + 앞 · 뒤 마개 @param {any} T @param {any} S @param {{rings:number, seg:number}} L */
function buildBody(T, S, L) {
  const b = new GeoBuilder();
  const tFirst = 0.012;
  const nose = b.v(0, S.yc(0), S.z0, 0, 0.5);
  const ringStart = b.count;
  for (let r = 0; r < L.rings; r++) {
    // 앞쪽(머리)에 고리를 더 촘촘히 — 머리 모양이 실루엣을 정한다
    const k = r / (L.rings - 1);
    const t = tFirst + (1 - tFirst) * (k < 0.5 ? 0.5 * Math.pow(k * 2, 1.25) : k);
    const z = S.zAt(t);
    const yc = S.yc(t);
    const hu = S.hu(t);
    const hl = S.hl(t);
    const hw = S.hw(t);
    for (let i = 0; i < L.seg; i++) {
      const ph = (i / L.seg) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const p = c >= 0 ? T.upP : T.lowP;
      const x = sp(s, p) * hw;
      const y = yc + sp(c, p) * (c >= 0 ? hu : hl);
      const v = ph <= Math.PI ? ph / Math.PI : (2 * Math.PI - ph) / Math.PI;
      b.v(x, y, z, t, v);
    }
  }
  const ring = (r, i) => ringStart + r * L.seg + (i % L.seg);
  for (let i = 0; i < L.seg; i++) b.tri(nose, ring(0, i), ring(0, i + 1));
  for (let r = 0; r < L.rings - 1; r++) {
    for (let i = 0; i < L.seg; i++) {
      b.tri(ring(r, i), ring(r + 1, i), ring(r + 1, i + 1));
      b.tri(ring(r, i), ring(r + 1, i + 1), ring(r, i + 1));
    }
  }
  const tail = b.v(0, S.yc(1), S.zB, 1, 0.5);
  const last = L.rings - 1;
  for (let i = 0; i < L.seg; i++) b.tri(tail, ring(last, i + 1), ring(last, i));
  return b.build();
}

/** 지느러미(전부 한 지오메트리 — DoubleSide 재질) @param {any} T @param {any} S @param {number} H @param {number} W @param {{arc:number}} L */
function buildFins(T, S, H, W, L) {
  const b = new GeoBuilder();
  const zB = S.zB;
  const tl = 0.5 - zB;
  const ycB = S.yc(1);
  const ped = S.hu(1);
  // 꼬리지느러미
  if (T.tail === 'forked') {
    const span = T.tailSpan * H;
    b.fan([[0, ycB, zB - 0.01], [0, ycB + ped, zB - 0.01], [0, ycB + span, 0.5], [0, ycB + span * 0.55, 0.5 - tl * 0.18],
      [0, ycB, 0.5 - tl * 0.55], [0, ycB - span * 0.55, 0.5 - tl * 0.18], [0, ycB - span, 0.5], [0, ycB - ped, zB - 0.01]]);
  } else if (T.tail === 'hetero') {
    const span = T.tailSpan * H;
    b.fan([[0, ycB, zB - 0.01], [0, ycB + ped, zB - 0.02], [0, ycB + span, 0.5], [0, ycB + span * 0.62, 0.5 - tl * 0.12],
      [0, ycB + span * 0.1, zB + tl * 0.42], [0, ycB - span * 0.5, zB + tl * 0.38], [0, ycB - ped, zB - 0.01]]);
  } else {
    const span = T.tailSpan * H;
    const pts = [[0, ycB, zB - 0.01]];
    const n = L.arc + 2;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      pts.push([0, ycB + Math.sin(-a) * span, zB + Math.cos(a) * tl * (i === 0 || i === n ? 0 : 1)]);
    }
    b.fan(pts);
  }
  // 등 · 뒷지느러미(몸 윤곽에 붙인다)
  const fin = (spec, up) => {
    const [t0, t1, hh, lean] = spec;
    const n = Math.max(2, Math.round(L.arc * (t1 - t0) * 2.2) + 1);
    const pts = [];
    const edge = (t) => (up ? S.top(t) - 0.04 * H : S.bot(t) + 0.04 * H);
    pts.push([0, edge(t0), S.zAt(t0)]);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const t = lerp(t0, t1, k);
      // 앞이 높고 뒤로 낮아진다(lean = 앞 경사 — 0 이면 날카로운 삼각)
      const prof = k < lean ? smoothstep(0, Math.max(lean, 1e-3), k) : 1 - 0.75 * smoothstep(lean, 1, k);
      const tt = Math.min(1, t);
      const hgt = hh * H * prof * (lean < 0.1 ? Math.min(1, 1.4 * (1 - k) + 0.1) : 1);
      pts.push([0, edge(tt) + (up ? hgt : -hgt), Math.min(0.5, S.zAt(tt) + hgt * 0.35 * (1 - lean))]);
    }
    pts.push([0, edge(Math.min(1, t1)), S.zAt(Math.min(1, t1))]);
    b.fan(pts);
  };
  for (const d of T.dorsal || []) fin(d, true);
  for (const a of T.anal || []) fin(a, false);
  // 가슴지느러미(양쪽) · 배지느러미
  if (T.pect) {
    const [t, len, droop, spread] = T.pect;
    const z = S.zAt(t);
    const y = S.yc(t) - S.hl(t) * 0.45;
    for (const side of [-1, 1]) {
      const x = side * S.hw(t) * 0.85;
      const tipX = x + side * len * spread * 0.9;
      const tipY = y - len * droop;
      b.fan([[x, y + 0.012, z], [tipX, tipY + len * 0.08, z + len * 0.55], [tipX * 0.98, tipY, z + len], [x, y - 0.02, z + len * 0.35]]);
    }
  }
  if (T.pelvic) {
    const [t, len] = T.pelvic;
    const z = S.zAt(t);
    const y = S.bot(t) + 0.01 * H;
    for (const side of [-1, 1]) {
      const x = side * S.hw(t) * 0.35;
      b.fan([[x, y, z], [x + side * len * 0.35, y - len * 0.45, z + len * 0.8], [x + side * len * 0.1, y - len * 0.2, z + len]]);
    }
  }
  return b.build();
}

/** 눈(흰자 · 동공) @param {any} T @param {any} S @param {number} H @param {{eyeW:number, eyeH:number, pupW:number, pupH:number}} L */
function buildEyes(T, S, H, L) {
  const whites = new GeoBuilder();
  const pupils = new GeoBuilder();
  const [t, hFrac, sizeMul] = T.eye;
  const z = S.zAt(t);
  const hu = S.hu(t);
  const y = S.yc(t) + hu * hFrac;
  const r = clamp(0.22 * hu * sizeMul + 0.004, 0.008, 0.034) * (sizeMul < 0.8 ? 0.9 : 1);
  // 그 높이에서 몸 표면의 x(초타원)
  const c = clamp((y - S.yc(t)) / Math.max(hu, 1e-6), -1, 1);
  const s = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(c), T.upP)));
  const xs = S.hw(t) * Math.pow(s, 2 / T.upP);
  for (const side of [-1, 1]) {
    const x = side * Math.max(xs - r * 0.35, r * 0.5);
    whites.ellipsoid(x, y, z, r * 0.6, r, r, L.eyeW, L.eyeH);
    pupils.ellipsoid(x + side * r * 0.42, y, z - r * 0.05, r * 0.32, r * 0.58, r * 0.58, L.pupW, L.pupH);
  }
  return { whites: whites.build(), pupils: pupils.build(), eyeR: r };
}

/** 입 · 수염 · (상어) 아가미 틈 — 어두운 재질 하나 @param {any} T @param {any} S @param {number} H @param {SpeciesLook} look @param {{barbelSides:number, eyeW:number, eyeH:number}} L */
function buildMouth(T, S, H, look, L) {
  const b = new GeoBuilder();
  const [below, wFrac, hFrac] = T.mouth;
  if (below >= 1) {
    // 아래로 열린 입(상어 · 철갑상어) — 머리 아래 초승달
    const t = 0.09;
    const z = S.zAt(t);
    b.ellipsoid(0, S.bot(t) + 0.004, z, S.hw(t) * wFrac, H * 0.03, 0.018, L.eyeW, Math.max(2, L.eyeH - 1));
  } else {
    // 주둥이 끝의 입(입술이 어둡게 열린 틈)
    const t = 0.02;
    const z = S.z0 + 0.012;
    const y = S.yc(t) - S.hl(t) * below;
    b.ellipsoid(0, y, z, Math.max(S.hw(t) * wFrac, 0.006), Math.max(S.hl(0.05) * hFrac, 0.005), 0.012, L.eyeW, Math.max(2, L.eyeH - 1));
  }
  const n = Math.max(0, Math.round(look.barbels || 0));
  if (n > 0) {
    const t = below >= 1 ? 0.06 : 0.03;
    const z = S.zAt(t);
    const y = below >= 1 ? S.bot(t) : S.yc(t) - S.hl(t) * 0.3;
    const longLen = look.body === 'benthic' ? 0.16 : 0.07;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const pair = Math.floor(i / 2);
      const len = longLen * (pair === 0 ? 1 : 0.55 / pair);
      const x0 = side * S.hw(t) * (0.35 + 0.2 * pair);
      const ang = 0.5 + pair * 0.35;
      const a = [x0, y - pair * 0.01, z + 0.004 * pair];
      const tip = [x0 + side * Math.cos(ang) * len, y - 0.25 * len - pair * 0.02, z + Math.sin(ang) * len * 0.9];
      b.cone(a, tip, 0.0045, L.barbelSides);
    }
  }
  return b.build();
}

// ── 무늬 텍스처

/** @param {SpeciesDef} species @returns {THREE.DataTexture} */
function patternTexture(species) {
  const look = species.look;
  const key = species.id;
  const cached = TEX_CACHE.get(key);
  if (cached) return cached;
  const T = templateOf(look);
  const [back, side, belly, finC] = look.colors.map(c => rgb(c));
  const pc = rgb(look.patternColor, [back[0] * 0.5, back[1] * 0.5, back[2] * 0.5]);
  const accent = look.accent ? rgb(look.accent) : null;
  const seed = seedOf(key);
  const r = rng(seed);
  const noise = valueNoise(seed ^ 0x9e3779b9);
  const data = new Uint8Array(TEX_W * TEX_H * 4);

  // 무늬 매개변수(어종마다 결정적으로 조금씩 다르다)
  const bars = 5 + Math.floor(r() * 3);
  const barPhase = r() * 0.2;
  /** @type {Array<[number, number, number]>} */
  const spots = [];
  if (look.pattern === 'spots') {
    const nSp = 26 + Math.floor(r() * 18);
    for (let i = 0; i < nSp; i++) spots.push([0.12 + r() * 0.86, 0.04 + r() * 0.62, 0.012 + r() * 0.016]);
  }
  /** @type {Array<[number, number, number]>} */
  const mirrorScales = [];
  if (look.pattern === 'mirror') {
    for (let i = 0; i < 9; i++) mirrorScales.push([0.25 + i * 0.075 + r() * 0.02, 0.08 + r() * 0.04, 0.03 + r() * 0.012]);
    for (let i = 0; i < 6; i++) mirrorScales.push([0.3 + i * 0.1 + r() * 0.03, 0.42 + r() * 0.05, 0.035 + r() * 0.01]);
  }
  const gillU = T.gill;

  for (let j = 0; j < TEX_H; j++) {
    const v = (j + 0.5) / TEX_H;
    for (let i = 0; i < TEX_W; i++) {
      const u = (i + 0.5) / TEX_W;
      // 기본: 등 → 옆 → 배 그라데이션(역그림자)
      let k1 = smoothstep(0.12, 0.42, v);
      let c0 = lerp(back[0], side[0], k1);
      let c1 = lerp(back[1], side[1], k1);
      let c2 = lerp(back[2], side[2], k1);
      const k2 = smoothstep(0.55, 0.8, v);
      c0 = lerp(c0, belly[0], k2);
      c1 = lerp(c1, belly[1], k2);
      c2 = lerp(c2, belly[2], k2);
      let m = 0;                       // 무늬 색(pc) 섞는 양
      let shade = 1;                   // 밝기 배율
      const bellyFade = 1 - smoothstep(0.62, 0.85, v);
      switch (look.pattern) {
        case 'bars': {
          const x = (u - 0.18 - barPhase) * bars / 0.78;
          const band = 0.5 + 0.5 * Math.cos(x * Math.PI * 2);
          if (u > 0.15 && u < 0.97) m = smoothstep(0.55, 0.8, band) * 0.75 * bellyFade;
          break;
        }
        case 'spots': {
          for (const [su, sv, sr] of spots) {
            const du = (u - su) * 2.2;
            const dv = v - sv;
            const d = Math.sqrt(du * du + dv * dv);
            if (d < sr * 2.2) m = Math.max(m, 1 - smoothstep(sr * 0.75, sr * 1.15, d));
          }
          m *= 0.85 * bellyFade;
          break;
        }
        case 'stripe': {
          const d = Math.abs(v - 0.46 + 0.04 * (1 - u));
          if (u > 0.04) m = (1 - smoothstep(0.03, 0.07, d)) * 0.85;
          break;
        }
        case 'mottled': {
          const n = noise(u * 14, v * 7) * 0.65 + noise(u * 31, v * 15) * 0.35;
          m = smoothstep(0.52, 0.66, n) * 0.8 * (1 - smoothstep(0.6, 0.9, v));
          break;
        }
        case 'scales':
        case 'gold': {
          // 겹친 비늘: 칸마다 머리 쪽이 열린 초승달 테두리
          const su = u * 30;
          const sv = v * 11 + (Math.floor(su) % 2) * 0.5;
          const fu = su - Math.floor(su);
          const fv = sv - Math.floor(sv);
          const edge = Math.sqrt(fu * fu * 0.8 + (fv - 0.5) * (fv - 0.5));
          const crest = smoothstep(0.5, 0.62, edge) * (1 - smoothstep(0.74, 0.86, edge));
          if (u > gillU) {
            m = crest * (look.pattern === 'gold' ? 0.2 : 0.45) * bellyFade;
            shade = look.pattern === 'gold' ? 1 + 0.25 * (1 - crest) : 1 + 0.08 * (1 - crest);
          }
          break;
        }
        case 'mirror': {
          for (const [su, sv, sr] of mirrorScales) {
            const du = (u - su) * 2.2;
            const dv = v - sv;
            const d = Math.sqrt(du * du + dv * dv);
            if (d < sr) {
              shade = Math.max(shade, 1.18);
              if (d > sr * 0.8) m = Math.max(m, 0.7);
            }
          }
          break;
        }
        case 'scutes': {
          for (const row of [0.03, 0.36, 0.72]) {
            const n = row < 0.1 ? 13 : 30;
            const su = u * n;
            const fu = su - Math.floor(su);
            const du = Math.abs(fu - 0.5) * 2;
            const dv = Math.abs(v - row) / 0.05;
            if (u > 0.12 && du + dv < 1) m = Math.max(m, 0.9 * (1 - smoothstep(0.7, 1, du + dv)));
          }
          break;
        }
        case 'zombie': {
          // 탈색 + 어두운 상처 + 갈비뼈
          const g = (c0 + c1 + c2) / 3;
          c0 = lerp(c0, g, 0.45); c1 = lerp(c1, g, 0.45); c2 = lerp(c2, g, 0.45);
          const n = noise(u * 18, v * 9);
          m = smoothstep(0.62, 0.72, n) * 0.9;
          if (u > 0.3 && u < 0.62 && v > 0.3 && v < 0.72) {
            const rib = 0.5 + 0.5 * Math.cos(u * 70);
            const ribK = smoothstep(0.82, 0.95, rib) * (1 - smoothstep(0.2, 0.36, Math.abs(v - 0.51)));
            c0 = lerp(c0, 0.86, ribK * 0.85); c1 = lerp(c1, 0.82, ribK * 0.85); c2 = lerp(c2, 0.72, ribK * 0.85);
          }
          break;
        }
        case 'ghost': {
          const n = noise(u * 10, v * 5);
          shade = 0.9 + 0.25 * n;
          m = smoothstep(0.6, 0.8, n) * 0.35;
          break;
        }
        default: {
          // none — 옆줄 한 줄과 아주 옅은 비늘 결
          const fine = 0.5 + 0.5 * Math.cos(u * 140) * Math.cos(v * 70);
          shade = 0.97 + 0.05 * fine;
        }
      }
      c0 = lerp(c0, pc[0], m) * shade;
      c1 = lerp(c1, pc[1], m) * shade;
      c2 = lerp(c2, pc[2], m) * shade;
      // 옆줄(옅게)
      if (u > gillU && Math.abs(v - 0.4 - 0.05 * u) < 0.008 && look.pattern !== 'ghost') {
        c0 *= 0.82; c1 *= 0.82; c2 *= 0.82;
      }
      // 아가미 뚜껑(어두운 호) · 상어 아가미 틈
      const slits = T.gillSlits || 1;
      for (let s = 0; s < slits; s++) {
        const gu = gillU + s * 0.022 + 0.035 * Math.sin(v * Math.PI) * (slits > 1 ? 0.3 : 1);
        if (Math.abs(u - gu) < (slits > 1 ? 0.004 : 0.006) && v > (slits > 1 ? 0.3 : 0.12) && v < (slits > 1 ? 0.62 : 0.86)) {
          c0 *= 0.55; c1 *= 0.55; c2 *= 0.55;
        }
      }
      // 강조 띠(아가미 아래 — 컷스로트의 목 줄)
      if (accent && Math.abs(u - (gillU + 0.005)) < 0.02 && v > 0.66 && v < 0.96) {
        c0 = accent[0]; c1 = accent[1]; c2 = accent[2];
      }
      // 주둥이 끝은 조금 어둡게 · 옆에서 보이는 입선(주둥이 끝에서 뒤로 비스듬히)
      if (u < 0.03) { c0 *= 0.85; c1 *= 0.85; c2 *= 0.85; }
      if (T.mouthLen > 0 && u < T.mouthLen) {
        const vm = 0.5 + T.mouth[0] * 0.22 + (u / T.mouthLen) * 0.06;
        const dm = Math.abs(v - vm);
        if (dm < 0.022) {
          const k = 1 - smoothstep(0.008, 0.022, dm);
          c0 = lerp(c0, 0.08, k); c1 = lerp(c1, 0.05, k); c2 = lerp(c2, 0.04, k);
        }
      }
      const o = (j * TEX_W + i) * 4;
      data[o] = Math.round(clamp01(c0) * 255);
      data[o + 1] = Math.round(clamp01(c1) * 255);
      data[o + 2] = Math.round(clamp01(c2) * 255);
      data[o + 3] = 255;
    }
  }
  void finC;
  const tex = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = `fishTex:${key}`;
  TEX_CACHE.set(key, tex);
  return tex;
}

// ── 공개 API

/** (어종 · lod) 의 길이 1 지오메트리 @param {SpeciesDef} species @param {0|1} lod */
function geometriesOf(species, lod) {
  const key = `${species.id}|${lod}`;
  const cached = GEO_CACHE.get(key);
  if (cached) return cached;
  const look = species.look;
  const T = templateOf(look);
  const H = clamp(Number(look.depth) || 0.25, 0.05, 0.6);
  const W = T.width;
  const S = bodyShape(T, H, W);
  const L = LOD[lod];
  const body = buildBody(T, S, L);
  const fins = buildFins(T, S, H, W, L);
  const { whites, pupils } = buildEyes(T, S, H, L);
  const mouth = buildMouth(T, S, H, look, L);
  const set = { body, fins, eyes: whites, pupils, mouth };
  for (const [name, g] of Object.entries(set)) g.name = `fish:${species.id}:${lod}:${name}`;
  GEO_CACHE.set(key, set);
  return set;
}

/**
 * @param {SpeciesDef} species @param {number} lengthM
 * @param {{silhouette?:boolean, lod?:0|1}} [opts] @returns {THREE.Group}
 */
export function buildFishModel(species, lengthM, opts = {}) {
  const silhouette = !!opts.silhouette;
  const lod = opts.lod === 1 ? 1 : 0;
  const len = Number.isFinite(lengthM) && lengthM > 0 ? lengthM : 0.3;
  if (!species || !species.look) {
    // 모르는 어종: 던지지 않고 회색 방추형
    return buildFishModel(/** @type {any} */ ({ id: 'unknown', look: { body: 'fusiform', depth: 0.25, colors: ['#555555', '#888888', '#cccccc', '#666666'], pattern: 'none', patternColor: null } }), len, opts);
  }
  const group = new THREE.Group();
  group.name = `fish:${species.id}`;
  const inner = new THREE.Group();
  inner.name = 'fishScale';
  inner.scale.setScalar(len);
  group.add(inner);
  group.userData = { speciesId: species.id, lengthM: len, lod, silhouette, fishModel: true };
  const look = species.look;
  const geo = geometriesOf(species, lod);

  /** @type {Record<string, THREE.Material>} */
  let mats;
  if (silhouette) {
    const black = new THREE.MeshBasicMaterial({ color: SILHOUETTE, side: THREE.DoubleSide });
    mats = { body: black, fins: black, eyes: black, pupils: black, mouth: black };
  } else {
    const ghost = look.pattern === 'ghost';
    const gold = look.pattern === 'gold';
    const glow = look.glow ? new THREE.Color(look.glow) : null;
    const body = new THREE.MeshStandardMaterial({
      map: patternTexture(species),
      roughness: gold ? 0.3 : ghost ? 0.4 : 0.55,
      metalness: gold ? 0.65 : look.pattern === 'mirror' || look.pattern === 'none' ? 0.12 : 0.05,
      transparent: ghost,
      opacity: ghost ? GHOST_OPACITY : 1,
      depthWrite: !ghost,
    });
    const finCol = new THREE.Color(look.colors[3]);
    const fins = new THREE.MeshStandardMaterial({
      color: finCol, roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: ghost ? GHOST_OPACITY * 0.8 : 0.92, depthWrite: !ghost,
    });
    fins.emissive = finCol.clone().multiplyScalar(0.22);
    if (glow) {
      body.emissive = glow.clone();
      body.emissiveIntensity = GLOW_INTENSITY;
      fins.emissive = glow.clone();
      fins.emissiveIntensity = GLOW_INTENSITY * 0.8;
    }
    const eyes = new THREE.MeshStandardMaterial({ color: look.pattern === 'zombie' ? '#c8d0a0' : EYE_WHITE, roughness: 0.3 });
    const pupils = new THREE.MeshStandardMaterial({ color: look.pattern === 'zombie' ? '#6a1010' : PUPIL, roughness: 0.08, metalness: 0.2 });
    if (look.pattern === 'zombie' && glow) {
      pupils.emissive = glow.clone();
      pupils.emissiveIntensity = 0.9;
    }
    const mouth = new THREE.MeshStandardMaterial({ color: MOUTH, roughness: 0.9 });
    mats = { body, fins, eyes, pupils, mouth };
  }
  for (const name of ['body', 'fins', 'eyes', 'pupils', 'mouth']) {
    const mesh = new THREE.Mesh(geo[name], mats[name]);
    mesh.name = name;
    mesh.userData.cachedGeometry = true;
    inner.add(mesh);
  }
  return group;
}

/** 재질만 정리한다(지오메트리 · 무늬 텍스처는 어종 캐시 — 상한 36 × 2) @param {THREE.Object3D} group */
export function disposeFishModel(group) {
  if (!group) return;
  /** @type {Set<THREE.Material>} */
  const seen = new Set();
  group.traverse(o => {
    const m = /** @type {any} */ (o);
    if (m.geometry && !(m.userData && m.userData.cachedGeometry)) m.geometry.dispose();
    if (m.material) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of list) seen.add(mat);
    }
  });
  for (const mat of seen) mat.dispose();
  if (group.parent) group.parent.remove(group);
}

/** 삼각형 수(테스트 · 디버그) @param {THREE.Object3D} group */
export function fishTriangleCount(group) {
  let n = 0;
  group.traverse(o => {
    const m = /** @type {any} */ (o);
    if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return n;
}
