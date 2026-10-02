// OWNER: P5 — 내부 파일 · 절차 텍스처(THREE.DataTexture — DOM 없이 Node 에서도 만든다 · §9.1 CanvasTexture 금지).
// 부팅 때 한 번 만들고 공유한다(판을 반복해도 늘지 않는다).

import * as THREE from 'three';
import { fbm, hash2, valueNoise } from './noise.js';

function tex(data, w, h, { repeat = false, srgb = true, nearest = false } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = !nearest;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 지형 상세 — 밝기 변조(0.7..1.05), 반복 */
export function makeDetailTexture(size = 128) {
  const d = new Uint8Array(size * size * 4);
  const per = 8;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    // 주기 경계가 이어지게 감싼 노이즈
    const u = i / size;
    const v = j / size;
    let n = 0;
    let amp = 0.5;
    let f = per;
    for (let o = 0; o < 4; o++) {
      const x = u * f;
      const z = v * f;
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const fx = x - ix;
      const fz = z - iz;
      const sx = fx * fx * (3 - 2 * fx);
      const sz = fz * fz * (3 - 2 * fz);
      const w = (a, b) => hash2(((a % f) + f) % f, ((b % f) + f) % f, 97 + o);
      const a = w(ix, iz);
      const b = w(ix + 1, iz);
      const c = w(ix, iz + 1);
      const e = w(ix + 1, iz + 1);
      n += (a + (b - a) * sx + (c - a) * sz + (a - b - c + e) * sx * sz) * amp;
      amp *= 0.5;
      f *= 2;
    }
    const speck = hash2(i, j, 5) > 0.93 ? -0.12 : 0;
    const val = 0.72 + n * 0.36 + speck;
    const o = (j * size + i) * 4;
    d[o] = d[o + 1] = d[o + 2] = clamp255(val * 255);
    d[o + 3] = 255;
  }
  return tex(d, size, size, { repeat: true, srgb: false });
}

/** 마루(나무 판) */
export function makePlankTexture(w = 256, h = 256) {
  const d = new Uint8Array(w * h * 4);
  const planks = 6;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = Math.floor((i / w) * planks);
    const along = j / h + hash2(p, 0, 3) * 0.7;
    const seamX = (i / w) * planks - p < 0.025;
    const seamY = (along * 2.2) % 1 < 0.008;
    const grain = Math.sin((i / w) * 140 + valueNoise(i * 0.05, j * 0.01, 9 + p) * 6) * 0.5 + 0.5;
    const tone = 0.82 + hash2(p, Math.floor(along * 2.2), 4) * 0.25;
    let r = (138 + grain * 18) * tone;
    let g = (100 + grain * 12) * tone;
    let b = (68 + grain * 8) * tone;
    if (seamX || seamY) { r *= 0.55; g *= 0.55; b *= 0.55; }
    const o = (j * w + i) * 4;
    d[o] = clamp255(r); d[o + 1] = clamp255(g); d[o + 2] = clamp255(b); d[o + 3] = 255;
  }
  return tex(d, w, h, { repeat: true });
}

/** 벽지(옅은 세로 줄무늬 + 결) */
export function makeWallTexture(base, w = 128, h = 128) {
  const c = new THREE.Color(base);
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const stripe = (i % 32) < 16 ? 1.0 : 0.965;
    const n = 0.96 + fbm(i / 18, j / 18, 31, 3) * 0.06;
    const k = stripe * n;
    const o = (j * w + i) * 4;
    d[o] = clamp255(c.r * 255 * k); d[o + 1] = clamp255(c.g * 255 * k); d[o + 2] = clamp255(c.b * 255 * k); d[o + 3] = 255;
  }
  // c 는 선형값 — sRGB 로 다시 바꿔 넣는다
  const t = tex(toSRGBBytes(d), w, h, { repeat: true });
  return t;
}

function toSRGBBytes(d) {
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = d[i + k] / 255;
      const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      d[i + k] = clamp255(s * 255);
    }
  }
  return d;
}

/** 러그(테두리 + 마름모 무늬) */
export function makeRugTexture(w = 128, h = 192) {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const bx = Math.min(i, w - 1 - i);
    const by = Math.min(j, h - 1 - j);
    const border = Math.min(bx, by);
    let r = 150; let g = 60; let b = 48;
    if (border < 6) { r = 220; g = 196; b = 150; }
    else if (border < 12) { r = 60; g = 70; b = 110; }
    else {
      const u = (i - w / 2) / 18;
      const v = (j - h / 2) / 18;
      const dm = (Math.abs(u % 2) + Math.abs(v % 2)) % 2;
      if (dm < 0.35) { r = 220; g = 196; b = 150; }
      else if (dm > 1.6) { r = 90; g = 40; b = 34; }
    }
    const n = 0.88 + hash2(i, j, 77) * 0.12;
    const o = (j * w + i) * 4;
    d[o] = clamp255(r * n); d[o + 1] = clamp255(g * n); d[o + 2] = clamp255(b * n); d[o + 3] = 255;
  }
  return tex(d, w, h);
}

/** 모니터 화면(낚시 앱 — 지도 · 날씨 · 물고기 목록 같은 모양) */
export function makeScreenTexture(w = 256, h = 160) {
  const d = new Uint8Array(w * h * 4);
  const put = (i, j, r, g, b) => { const o = (j * w + i) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const y = h - 1 - j;   // 위가 0
    let r = 18; let g = 34; let b = 58;
    if (y < 14) { r = 34; g = 96; b = 150; }                       // 제목 띠
    else if (i < 150 && y > 22 && y < 150) {                       // 지도 창
      const land = fbm(i / 30, y / 30, 5, 4) > 0.5 - (y - 22) * 0.0012;
      if (land) { r = 70; g = 120; b = 70; } else { r = 40; g = 100; b = 150; }
      const dot = [[40, 60], [96, 92], [124, 48]].some(([x0, y0]) => (i - x0) ** 2 + (y - y0) ** 2 < 18);
      if (dot) { r = 255; g = 190; b = 60; }
    } else if (i > 160 && i < 248 && y > 22) {                    // 목록
      const row = Math.floor((y - 22) / 16);
      const ry = (y - 22) % 16;
      if (ry > 3 && ry < 12) {
        if (i < 174) { r = 255; g = 200 - row * 12; b = 80; }
        else if (i < 174 + 40 + (row * 23) % 30) { r = 200; g = 214; b = 230; }
      }
    }
    put(i, j, r, g, b);
  }
  return tex(d, w, h);
}

/** 물고기 포스터(종이 위 잉어 실루엣) */
export function makePosterTexture(w = 128, h = 96) {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i - w * 0.48) / (w * 0.36);
    const v = (j - h * 0.5) / (h * 0.22);
    const body = u * u + v * v * (1 + u * 0.3) < 1;
    const tail = u > 0.85 && u < 1.25 && Math.abs(v) < (u - 0.85) * 2.6;
    const eye = (u + 0.72) ** 2 + (v - 0.2) ** 2 < 0.006;
    let r = 232; let g = 222; let b = 196;
    if (body || tail) { r = 70 + v * 30; g = 60 + v * 20; b = 46; }
    if (eye) { r = g = b = 240; }
    const edge = Math.min(i, j, w - 1 - i, h - 1 - j) < 4;
    if (edge) { r = 120; g = 84; b = 52; }
    const o = (j * w + i) * 4;
    d[o] = clamp255(r); d[o + 1] = clamp255(g); d[o + 2] = clamp255(b); d[o + 3] = 255;
  }
  return tex(d, w, h);
}

/** 이불(체크 무늬) */
export function makeBlanketTexture(w = 128, h = 128) {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = (Math.floor(i / 16) % 2) ? 1 : 0;
    const b = (Math.floor(j / 16) % 2) ? 1 : 0;
    const k = 0.75 + 0.25 * (a + b) / 2;
    const line = i % 16 === 0 || j % 16 === 0;
    const o = (j * w + i) * 4;
    d[o] = clamp255((line ? 220 : 52) * k); d[o + 1] = clamp255((line ? 210 : 86) * k); d[o + 2] = clamp255((line ? 190 : 140) * k); d[o + 3] = 255;
  }
  return tex(d, w, h, { repeat: true });
}
