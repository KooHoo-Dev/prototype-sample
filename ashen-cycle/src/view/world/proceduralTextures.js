// OWNER: P6 — 계약 §9.1 · §9.3 (패키지 내부 파일)
// 절차 텍스처(캔버스) + 셰이더 재질(하늘 · 불꽃 · 안개문 · 안개 장막 · 떠다니는 입자). 외부 에셋 0.
// 캔버스는 함수 안에서만 만든다 — 모듈 최상위에서 document를 건드리지 않는다(§0.4).
import * as THREE from 'three';
import { makeRand } from './geoKit.js';

const SIZE = 512;
const ANISO = 8;

// ───────────────────────── 캔버스 도구 ─────────────────────────

/** @param {number} size @returns {HTMLCanvasElement} */
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/**
 * 타일링되는 fbm 값 잡음. (u, v) ∈ [0, 1) → 0..1.
 * @param {()=>number} rand @param {number} basePeriod @param {number} octaves
 * @returns {(u:number, v:number)=>number}
 */
function makeFbm(rand, basePeriod, octaves) {
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const p = basePeriod << o;
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    grids.push({ p, g });
  }
  let norm = 0;
  for (let o = 0, a = 0.5; o < octaves; o++, a *= 0.5) norm += a;
  return (u, v) => {
    let sum = 0;
    let amp = 0.5;
    for (let o = 0; o < grids.length; o++) {
      const { p, g } = grids[o];
      const x = u * p;
      const y = v * p;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      let fx = x - x0;
      let fy = y - y0;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const xa = ((x0 % p) + p) % p;
      const ya = ((y0 % p) + p) % p;
      const xb = (xa + 1) % p;
      const yb = (ya + 1) % p;
      const a = g[ya * p + xa];
      const b = g[ya * p + xb];
      const c = g[yb * p + xa];
      const d = g[yb * p + xb];
      sum += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      amp *= 0.5;
    }
    return sum / norm;
  };
}

/** @param {HTMLCanvasElement} canvas @param {boolean} srgb */
function toTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO;
  return t;
}

/** 높이장 → 노멀 맵(OpenGL 규약, 타일링). @param {Float32Array} h @param {number} size @param {number} strength */
function normalTexture(h, size, strength) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size;
    const yd = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const nx = -(h[y * size + xr] - h[y * size + xl]) * strength;
      const ny = (h[yd + x] - h[yu + x]) * strength;   // 캔버스 y는 아래로 — v는 위로
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, false);
}

const smooth01 = (t) => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
};

// ───────────────────────── 표면 생성기 ─────────────────────────

/**
 * 석판/돌쌓기. 줄마다 폭이 다른 판 + 줄눈. emissive를 주면 줄눈 일부가 잔불처럼 빛나는 맵을 같이 만든다.
 * @param {{seed:number, rows:number, minCols:number, maxCols:number, gap:number, bevel:number,
 *          base:number[], mortar:number[], tintVar:number, noiseAmp:number, normal:number,
 *          vein?:number[], emissive?:{color:number[], threshold:number}}} o
 */
function masonryTextures(o) {
  const size = SIZE;
  const rand = makeRand(o.seed);
  const layout = [];
  for (let r = 0; r < o.rows; r++) {
    const n = o.minCols + Math.floor(rand() * (o.maxCols - o.minCols + 1));
    const w = [];
    let sum = 0;
    for (let k = 0; k < n; k++) { const v = 0.7 + rand() * 0.6; w.push(v); sum += v; }
    const bounds = [0];
    for (let k = 0; k < n; k++) bounds.push(bounds[k] + w[k] / sum);
    bounds[n] = 1;
    layout.push({ bounds, offset: rand(), tint: w.map(() => rand()), h: w.map(() => rand()) });
  }
  const fine = makeFbm(rand, 8, 4);
  const coarse = makeFbm(rand, 3, 3);
  const H = new Float32Array(size * size);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const eCanvas = o.emissive ? makeCanvas(size) : null;
  const eCtx = eCanvas ? eCanvas.getContext('2d') : null;
  const eImg = eCtx ? eCtx.createImageData(size, size) : null;
  const rowPx = size / o.rows;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rf = v * o.rows;
    const r = Math.min(o.rows - 1, Math.floor(rf));
    const fy = rf - r;
    const dY = Math.min(fy, 1 - fy) * rowPx;
    const L = layout[r];
    for (let x = 0; x < size; x++) {
      const uu = x / size;
      let u = uu + L.offset;
      u -= Math.floor(u);
      let k = 0;
      while (k < L.bounds.length - 2 && u >= L.bounds[k + 1]) k += 1;
      const dX = Math.min(u - L.bounds[k], L.bounds[k + 1] - u) * size;
      const dEdge = Math.min(dX, dY);
      const edge = smooth01((dEdge - o.gap) / o.bevel);
      const nf = fine(uu, v);
      const nc = coarse(uu, v);
      const shade = (0.72 + 0.56 * nf) * (0.8 + 0.4 * nc) * (1 + (L.tint[k] - 0.5) * o.tintVar);
      let cr = o.mortar[0] + (o.base[0] * shade - o.mortar[0]) * edge;
      let cg = o.mortar[1] + (o.base[1] * shade - o.mortar[1]) * edge;
      let cb = o.mortar[2] + (o.base[2] * shade - o.mortar[2]) * edge;
      if (o.vein) {
        const vv = Math.pow(1 - Math.abs(2 * nf - 1), 10) * edge;
        cr += o.vein[0] * vv; cg += o.vein[1] * vv; cb += o.vein[2] * vv;
      }
      const i = (y * size + x) * 4;
      px[i] = cr; px[i + 1] = cg; px[i + 2] = cb; px[i + 3] = 255;
      H[y * size + x] = edge * (0.6 + 0.4 * L.h[k]) + (nf - 0.5) * o.noiseAmp;
      if (eImg) {
        const e = (1 - edge) * smooth01((nc - o.emissive.threshold) / 0.14) * smooth01((nf - 0.42) / 0.16);   // 줄눈을 따라 끊어지며 빛난다
        eImg.data[i] = o.emissive.color[0] * e;
        eImg.data[i + 1] = o.emissive.color[1] * e;
        eImg.data[i + 2] = o.emissive.color[2] * e;
        eImg.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // 금 — 판 위를 가로지르는 가는 선
  ctx.strokeStyle = `rgba(${o.mortar[0]}, ${o.mortar[1]}, ${o.mortar[2]}, 0.55)`;
  ctx.lineWidth = 1;
  for (let c = 0; c < 14; c++) {
    let x = (0.1 + rand() * 0.8) * size;
    let y = (0.1 + rand() * 0.8) * size;
    let a = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(rand() * 6);
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 1.2;
      x += Math.cos(a) * (5 + rand() * 9);
      y += Math.sin(a) * (5 + rand() * 9);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const out = { map: toTexture(canvas, true), normalMap: normalTexture(H, size, o.normal) };
  if (eCanvas) {
    eCtx.putImageData(eImg, 0, 0);
    out.emissiveMap = toTexture(eCanvas, true);
  }
  return out;
}

/** 거친 바위/눈 — fbm + 능선. @param {{seed:number, base:number[], lo:number, hi:number, ridge:number, normal:number, period?:number}} o */
function rockTextures(o) {
  const size = SIZE;
  const rand = makeRand(o.seed);
  const fine = makeFbm(rand, o.period ?? 4, 5);
  const coarse = makeFbm(rand, 2, 3);
  const H = new Float32Array(size * size);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fine(u, v);
      const ridged = 1 - Math.abs(2 * n - 1);
      const h = n * (1 - o.ridge) + ridged * o.ridge;
      const s = (o.lo + (o.hi - o.lo) * h) * (0.85 + 0.3 * coarse(u, v));
      const i = (y * size + x) * 4;
      px[i] = o.base[0] * s; px[i + 1] = o.base[1] * s; px[i + 2] = o.base[2] * s; px[i + 3] = 255;
      H[y * size + x] = h;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(canvas, true), normalMap: normalTexture(H, size, o.normal) };
}

/** 얼어붙은 호수 — 짙은 청록 얼음 + 갇힌 공기의 흐림 + 흰 균열망. */
function iceTextures(seed) {
  const size = SIZE;
  const rand = makeRand(seed);
  const cloud = makeFbm(rand, 3, 4);
  const fine = makeFbm(rand, 16, 3);
  // 균열 마스크: 가지 치는 꺾은선을 타일 경계 너머까지 9번 찍어 이음매를 없앤다
  const cc = makeCanvas(size);
  const cx = cc.getContext('2d');
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, size, size);
  cx.lineCap = 'round';
  const lines = [];
  const grow = (x, y, a, len, w, depth) => {
    const pts = [[x, y]];
    const steps = 5 + Math.floor(rand() * 8);
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
      if (depth < 2 && rand() < 0.28) grow(x, y, a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.7), len * 0.75, w * 0.6, depth + 1);
    }
    lines.push({ pts, w });
  };
  for (let c = 0; c < 11; c++) grow(rand() * size, rand() * size, rand() * Math.PI * 2, 14 + rand() * 18, 1.2 + rand() * 1.6, 0);
  for (const ln of lines) {
    cx.strokeStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`;
    cx.lineWidth = ln.w;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        cx.beginPath();
        for (let i = 0; i < ln.pts.length; i++) {
          const X = ln.pts[i][0] + ox * size;
          const Y = ln.pts[i][1] + oy * size;
          if (i === 0) cx.moveTo(X, Y);
          else cx.lineTo(X, Y);
        }
        cx.stroke();
      }
    }
  }
  const mask = cx.getImageData(0, 0, size, size).data;
  const H = new Float32Array(size * size);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      const m = mask[i] / 255;
      const cl = cloud(u, v);
      const c2 = cl * cl;
      const f = fine(u, v);
      const r = 22 + 46 * c2 + 6 * f;
      const g = 44 + 62 * c2 + 8 * f;
      const b = 64 + 70 * c2 + 10 * f;
      px[i] = r + (190 - r) * m * 0.6;
      px[i + 1] = g + (220 - g) * m * 0.6;
      px[i + 2] = b + (240 - b) * m * 0.6;
      px[i + 3] = 255;
      H[y * size + x] = 1 - m * 0.9 + (f - 0.5) * 0.06;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(canvas, true), normalMap: normalTexture(H, size, 1.3) };
}

/** 널빤지 — 세로 결. */
function woodTextures(seed) {
  const size = 256;
  const rand = makeRand(seed);
  const fine = makeFbm(rand, 4, 3);
  const tab = new Float32Array(64);
  for (let i = 0; i < 64; i++) tab[i] = rand();
  const planks = 4;
  const tint = [];
  for (let i = 0; i < planks; i++) tint.push(0.8 + rand() * 0.4);
  const H = new Float32Array(size * size);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const pu = u * planks;
      const pk = Math.floor(pu);
      const fe = Math.min(pu - pk, 1 - (pu - pk));
      const edge = smooth01(fe / 0.05);
      const t = (u * 90 + fine(u, v) * 16 + pk * 7.3) % 64;
      const t0 = Math.floor(t);
      const grain = tab[t0 & 63] + (tab[(t0 + 1) & 63] - tab[t0 & 63]) * (t - t0);
      const s = (0.62 + 0.5 * grain) * tint[pk % planks] * (0.35 + 0.65 * edge);
      const i = (y * size + x) * 4;
      px[i] = 92 * s; px[i + 1] = 66 * s; px[i + 2] = 44 * s; px[i + 3] = 255;
      H[y * size + x] = edge * 0.7 + grain * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(canvas, true), normalMap: normalTexture(H, size, 1.6) };
}

/**
 * 심연 제단의 룬 문양(비타일 발광 맵). 원판 전체를 uv1 0..1로 덮는다.
 * @param {number} discRadius uv1이 덮는 반경(m)
 * @param {{x:number, z:number, r:number}[]} pillars 석주 자리(둘레에 원을 그린다)
 * @param {number[]} rgb
 */
function runeTexture(discRadius, pillars, rgb) {
  const size = 1024;
  const rand = makeRand(9107);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const k = size / (2 * discRadius);          // px / m
  const X = (x) => size / 2 + x * k;
  const Y = (z) => size / 2 - z * k;          // uv1.v = 0.5 + z/2R, 캔버스는 위가 v = 1
  const col = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 5;
  ctx.lineCap = 'round';
  // 고리는 끊어 그린다(점선) — 바닥 표식(텔레그래프)의 원은 실선이다. 같은 크기의 원이 깔려도 모양으로 구분된다
  const circle = (x, z, r, w) => {
    ctx.lineWidth = w;
    ctx.setLineDash([w * 4 + 4, w * 2 + 5]);
    ctx.beginPath(); ctx.arc(X(x), Y(z), r * k, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  };
  const line = (x0, z0, x1, z1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X(x0), Y(z0)); ctx.lineTo(X(x1), Y(z1)); ctx.stroke(); };
  const polar = (r, a) => [r * Math.sin(a), r * Math.cos(a)];
  // 중앙 문장: 겹원 + 팔각 별
  circle(0, 0, 2.6, 3);
  circle(0, 0, 3.1, 1.5);
  for (let i = 0; i < 8; i++) {
    const [ax, az] = polar(2.6, (i * Math.PI) / 4);
    const [bx, bz] = polar(2.6, ((i + 3) * Math.PI) / 4);
    line(ax, az, bx, bz, 1.5);
  }
  // 바퀴살
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const [ax, az] = polar(3.1, a);
    const [bx, bz] = polar(i % 2 === 0 ? 9.4 : 6.2, a);
    line(ax, az, bx, bz, i % 2 === 0 ? 2 : 1.2);
  }
  // 고리들 + 고리 사이의 문자
  circle(0, 0, 9.4, 2.5);
  circle(0, 0, 12.6, 2.5);
  circle(0, 0, 17.2, 1.5);
  circle(0, 0, discRadius - 1.5, 3);
  circle(0, 0, discRadius - 1.0, 1.2);
  const glyphRing = (r, n, cell) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const [gx, gz] = polar(r, a);
      const strokes = 2 + Math.floor(rand() * 3);
      let px = gx + (rand() - 0.5) * cell;
      let pz = gz + (rand() - 0.5) * cell;
      for (let s = 0; s < strokes; s++) {
        const qx = gx + (rand() - 0.5) * cell;
        const qz = gz + (rand() - 0.5) * cell;
        line(px, pz, qx, qz, 1.6);
        px = qx; pz = qz;
      }
    }
  };
  glyphRing(11.0, 44, 0.9);
  glyphRing(19.4, 72, 1.0);
  // 석주 둘레
  for (const p of pillars) {
    circle(p.x, p.z, p.r + 0.7, 3);
    circle(p.x, p.z, p.r + 1.15, 1.2);
    for (let i = 0; i < 3; i++) {
      const a0 = (i * Math.PI * 2) / 3;
      const a1 = ((i + 1) * Math.PI * 2) / 3;
      const rr = p.r + 1.15;
      line(p.x + rr * Math.sin(a0), p.z + rr * Math.cos(a0), p.x + rr * Math.sin(a1), p.z + rr * Math.cos(a1), 1.2);
    }
  }
  const t = toTexture(canvas, true);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.channel = 1;
  return t;
}

/** 가운데가 불투명하고 가장자리가 사라지는 원(그을음 · 바닥 빛 데칼의 alphaMap). */
function radialTexture() {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.45, '#9a9a9a');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * 월드 레이어가 쓰는 텍스처 전부를 만든다(부팅 때 한 번 — WorldLayer 생성자).
 * @param {{voidDisc:number, voidPillars:{x:number, z:number, r:number}[], runeColor:number[]}} o
 */
export function createTextureLibrary(o) {
  const lib = {
    // 마을 광장의 석판
    flagstone: masonryTextures({ seed: 11, rows: 5, minCols: 3, maxCols: 5, gap: 1.0, bevel: 3, base: [128, 121, 112], mortar: [80, 74, 66], tintVar: 0.35, noiseAmp: 0.22, normal: 2.6 }),
    // 불탄 성당 바닥 — 줄눈에 잔불
    charred: masonryTextures({ seed: 23, rows: 4, minCols: 2, maxCols: 4, gap: 2.6, bevel: 6, base: [78, 70, 66], mortar: [20, 14, 12], tintVar: 0.4, noiseAmp: 0.3, normal: 3.0, emissive: { color: [255, 120, 40], threshold: 0.58 } }),
    // 벽 · 기둥의 돌쌓기
    masonry: masonryTextures({ seed: 37, rows: 7, minCols: 3, maxCols: 5, gap: 1.6, bevel: 4, base: [140, 134, 126], mortar: [46, 42, 38], tintVar: 0.3, noiseAmp: 0.3, normal: 2.4 }),
    // 흑요석 제단
    obsidian: masonryTextures({ seed: 53, rows: 3, minCols: 2, maxCols: 3, gap: 1.6, bevel: 3, base: [44, 38, 56], mortar: [8, 6, 12], tintVar: 0.25, noiseAmp: 0.12, normal: 1.6, vein: [26, 16, 44] }),
    rock: rockTextures({ seed: 71, base: [150, 146, 140], lo: 0.4, hi: 1.15, ridge: 0.45, normal: 3.2 }),
    snow: rockTextures({ seed: 83, base: [208, 220, 236], lo: 0.82, hi: 1.08, ridge: 0.1, normal: 1.2, period: 3 }),
    ice: iceTextures(97),
    wood: woodTextures(101),
    runes: runeTexture(o.voidDisc, o.voidPillars, o.runeColor),
    radial: radialTexture(),
    /** @returns {THREE.Texture[]} */
    all() {
      const out = [];
      for (const v of Object.values(lib)) {
        if (!v || typeof v === 'function') continue;
        if (v.isTexture) out.push(v);
        else for (const t of Object.values(v)) if (t && t.isTexture) out.push(t);
      }
      return out;
    },
    dispose() {
      for (const t of lib.all()) t.dispose();
    },
  };
  return lib;
}

// ───────────────────────── 셰이더 재질 ─────────────────────────

const GLSL_NOISE = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
`;

const GLSL_OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/**
 * 하늘 돔(카메라 중심 · 가장 먼 깊이). 위/지평선 그라디언트 + 방향성 빛 번짐 + 구름 + 별 + 달/일식 고리.
 * 테마가 바뀌면 WorldLayer가 uniform만 갈아 끼운다(메시는 하나).
 */
export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'sky',
    uniforms: {
      uTop: { value: new THREE.Color(0x05070c) },
      uHorizon: { value: new THREE.Color(0x20242c) },
      uBottom: { value: new THREE.Color(0x0b0b0e) },
      uGlow: { value: new THREE.Color(0x000000) },
      uGlowDir: { value: new THREE.Vector3(0, 0.1, 1) },
      uGlowPow: { value: 6 },
      uOrbDir: { value: new THREE.Vector3(0, 0.4, 1) },
      uOrbColor: { value: new THREE.Color(0x000000) },
      uOrbSize: { value: 0 },
      uOrbRing: { value: 0 },
      uStars: { value: 0 },
      uCloud: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = viewMatrix * vec4(position, 0.0);   // 회전만 — 돔은 늘 카메라 중심
        gl_Position = projectionMatrix * vec4(mv.xyz, 1.0);
        gl_Position.z = gl_Position.w;                // 가장 먼 깊이
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform vec3 uGlow;
      uniform vec3 uGlowDir;
      uniform float uGlowPow;
      uniform vec3 uOrbDir;
      uniform vec3 uOrbColor;
      uniform float uOrbSize;
      uniform float uOrbRing;
      uniform float uStars;
      uniform float uCloud;
      uniform float uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0) + 1e-4, 0.8));
        float up = smoothstep(-0.02, 0.22, h);
        if (uCloud > 0.0) {
          vec2 cp = d.xz / (abs(h) + 0.35) * 1.7 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(cp);
          col = mix(col, col * 0.35 + uHorizon * 0.3, smoothstep(0.38, 0.72, c) * uCloud * up);
        }
        if (uStars > 0.0) {
          vec3 q = d * 150.0;
          float r = hash31(floor(q));
          float tw = 0.7 + 0.3 * sin(uTime * 1.7 + r * 40.0);
          float s = step(0.9935, r) * smoothstep(0.5, 0.05, length(fract(q) - 0.5));
          col += vec3(0.75, 0.86, 1.0) * s * uStars * tw * smoothstep(0.04, 0.4, h);
        }
        float g = max(dot(d, normalize(uGlowDir)), 0.0);
        col += uGlow * pow(g + 1e-4, uGlowPow) * smoothstep(-0.3, 0.05, h);
        if (uOrbSize > 0.0) {
          float ang = acos(clamp(dot(d, normalize(uOrbDir)), -1.0, 1.0));
          float disc = smoothstep(uOrbSize, uOrbSize * 0.9, ang);
          float rq = (ang - uOrbSize) / (uOrbSize * 0.11);
          float ring = exp(-rq * rq * 2.4);
          float halo = exp(-ang / (uOrbSize * 4.0));
          col *= 1.0 - disc * uOrbRing;                          // 일식: 원반은 검다
          col += uOrbColor * mix(disc, ring * 1.3, uOrbRing) + uOrbColor * halo * mix(0.1, 0.04, uOrbRing);
        }
        col = mix(uBottom, col, smoothstep(-0.2, 0.03, h));        // 지평선 아래는 안개색
        gl_FragColor = vec4(col, 1.0);
        ${GLSL_OUT}
      }`,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.BackSide,
    fog: false,
  });
}

/**
 * 불꽃(원뿔 메시 여러 개를 한 지오메트리로). 정점에 aSeed · aAmp가 있어야 한다 — addFlame 참고.
 * @param {number} core @param {number} glow @param {number} intensity
 */
export function createFlameMaterial(core, glow, intensity) {
  return new THREE.ShaderMaterial({
    name: 'flame',
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uGlow: { value: new THREE.Color(glow) },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aAmp;
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vNear;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        vec3 p = position;
        float k = uv.y * uv.y;
        float t = uTime * 5.0 + aSeed * 17.0;
        p.x += (sin(t + uv.y * 6.0) * 0.5 + sin(t * 1.7 + uv.y * 11.0) * 0.3) * aAmp * k;
        p.z += (cos(t * 1.3 + uv.y * 7.0) * 0.5 + sin(t * 2.1 + uv.y * 9.0) * 0.3) * aAmp * k;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 카메라가 불꽃 바로 뒤에 올 때(부활 지점) 화면을 덮지 않게 가까우면 옅어진다
        vNear = smoothstep(0.7, 2.8, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uGlow;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vSeed;
      varying float vNear;
      ${GLSL_NOISE}
      void main() {
        float y = vUv.y;
        float n = vnoise(vec2(vUv.x * 6.0 + vSeed * 3.0, y * 3.0 - uTime * 2.2 + vSeed));
        float n2 = vnoise(vec2(vUv.x * 13.0 - vSeed, y * 6.0 - uTime * 3.6));
        float f = y + (n - 0.5) * 0.55 + (n2 - 0.5) * 0.25;
        float a = smoothstep(1.0, 0.3, f) * vNear;
        vec3 col = mix(uGlow, uCore, smoothstep(0.62, 0.05, f)) * uIntensity * (0.75 + 0.5 * n);
        gl_FragColor = vec4(col, a);
        ${GLSL_OUT}
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/**
 * 불꽃 원뿔 하나를 만든다(밑면 중심이 (x, y, z)). 여러 개를 mergeGeometries로 합쳐 createFlameMaterial로 그린다.
 * @returns {THREE.BufferGeometry}
 */
export function makeFlameGeometry(x, y, z, radius, height, seed) {
  const g = new THREE.CylinderGeometry(radius * 0.08, radius, height, 9, 5, true).toNonIndexed();
  g.translate(x, y + height / 2, z);
  const n = g.attributes.position.count;
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(seed), 1));
  g.setAttribute('aAmp', new THREE.BufferAttribute(new Float32Array(n).fill(radius * 0.55), 1));
  g.deleteAttribute('normal');
  return g;
}

/** 안개문의 막 — 위로 흐르는 안개. uv는 0..1(가로 · 세로). */
export function createFogGateMaterial() {
  return new THREE.ShaderMaterial({
    name: 'fogGate',
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0.2, 0.24, 0.32) },
      uColorB: { value: new THREE.Color(1.5, 1.65, 1.95) },   // HDR — 짙은 가닥이 블룸에 걸린다
      uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uAlpha;
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main() {
        vec2 p = vUv * vec2(2.2, 3.6);
        float n1 = fbm(p + vec2(0.0, -uTime * 0.11));
        float n2 = fbm(p * 2.1 + vec2(n1 * 1.7, -uTime * 0.27));
        float d = smoothstep(0.28, 0.82, n1 * 0.55 + n2 * 0.6);
        float streak = vnoise(vec2(vUv.x * 15.0, vUv.y * 1.6 - uTime * 0.55));
        d = clamp(d + (streak - 0.5) * 0.3, 0.0, 1.0);
        vec3 col = mix(uColorA, uColorB, d * d);
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float a = mix(0.7, 0.97, d) * mix(0.75, 1.0, edge) * uAlpha;
        gl_FragColor = vec4(col, a);
        ${GLSL_OUT}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/**
 * 경계의 안개 장막(안쪽을 보는 원통). 위로 갈수록 사라진다 — 경계가 "눈에 보이게".
 * @param {number} color @param {number} alpha @param {number} height 원통 높이(m — uv.y 1이 꼭대기)
 */
export function createMistMaterial(color, alpha, height) {
  return new THREE.ShaderMaterial({
    name: 'mist',
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      uHeight: { value: height },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uHeight;
      varying vec2 vUv;
      varying vec3 vPos;
      ${GLSL_NOISE}
      void main() {
        // 원통 둘레에 이음매가 없게 월드 좌표로 잡음을 뽑는다
        float yy = vUv.y * uHeight;
        float n = fbm(vec2(vPos.x * 0.16 + uTime * 0.03, yy * 0.3 - uTime * 0.09))
                + fbm(vec2(vPos.z * 0.16 - uTime * 0.025, yy * 0.3 - uTime * 0.07 + 5.0));
        float body = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.05, vUv.y);   // 음수 밑의 pow는 NaN — 블룸이 화면 전체로 퍼뜨린다
        float a = body * (0.25 + 0.75 * smoothstep(0.55, 1.35, n)) * uAlpha;
        gl_FragColor = vec4(uColor, a);
        ${GLSL_OUT}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
}

/**
 * 떠다니는 입자(불씨 · 눈 · 심연의 티끌). 움직임은 전부 정점 셰이더가 계산한다 — CPU 0.
 * 상자 안에서 속도대로 흐르다 반대편으로 되돌아온다.
 * @param {{count:number, boxMin:number[], boxSize:number[], vel:number[], sway:number, size:number,
 *          color:number[], twinkle:number, additive:boolean, seed:number}} o
 * @returns {THREE.Points}
 */
export function createDriftPoints(o) {
  const rand = makeRand(o.seed);
  const pos = new Float32Array(o.count * 3);
  const seed = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count; i++) {
    pos[i * 3] = o.boxMin[0] + rand() * o.boxSize[0];
    pos[i * 3 + 1] = o.boxMin[1] + rand() * o.boxSize[1];
    pos[i * 3 + 2] = o.boxMin[2] + rand() * o.boxSize[2];
    seed[i * 4] = rand();
    seed[i * 4 + 1] = rand();
    seed[i * 4 + 2] = rand();
    seed[i * 4 + 3] = 0.45 + rand() * 0.55;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    name: 'drift',
    uniforms: {
      uTime: { value: 0 },
      uVel: { value: new THREE.Vector3().fromArray(o.vel) },
      uBoxMin: { value: new THREE.Vector3().fromArray(o.boxMin) },
      uBoxSize: { value: new THREE.Vector3().fromArray(o.boxSize) },
      uSway: { value: o.sway },
      uSize: { value: o.size },
      uScale: { value: 600 },          // 화면 높이(px) × 투영 배율 / 2 — WorldLayer가 매 프레임 넣는다
      uTwinkle: { value: o.twinkle },
      uColor: { value: new THREE.Color().fromArray(o.color) },
      uGain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec3 uVel;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxSize;
      uniform float uSway;
      uniform float uSize;
      uniform float uScale;
      uniform float uTwinkle;
      varying float vAlpha;
      void main() {
        vec3 p = position + uVel * (uTime * (0.7 + 0.6 * aSeed.y));
        p = mod(p - uBoxMin, uBoxSize) + uBoxMin;
        p.x += sin(uTime * (0.6 + aSeed.x) + aSeed.z * 6.28) * uSway;
        p.z += cos(uTime * (0.5 + aSeed.y) + aSeed.z * 6.28) * uSway;
        float ny = (p.y - uBoxMin.y) / uBoxSize.y;
        float fade = smoothstep(0.0, 0.12, ny) * smoothstep(1.0, 0.78, ny);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.5);
        gl_PointSize = clamp(uSize * (0.6 + 0.8 * aSeed.y) * uScale / dist, 1.0, 22.0);
        float tw = 0.55 + 0.45 * sin(uTime * (2.0 + aSeed.x * 5.0) + aSeed.z * 20.0);
        vAlpha = fade * mix(1.0, tw, uTwinkle) * aSeed.w * smoothstep(64.0, 36.0, dist) * smoothstep(0.4, 1.4, dist);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGain;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.12, r) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * uGain, a);
        ${GLSL_OUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'drift';
  return points;
}
