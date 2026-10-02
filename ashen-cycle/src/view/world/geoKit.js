// OWNER: P6 — 패키지 내부 파일(townScene · arenaScene · WorldLayer만 import 한다)
// 정적 지오메트리를 재질별로 한 메시에 병합하는 도구 + 폐허 조각(상자 · 기둥 · 바위 · 아치 · 능선) 생성기.
// 드로 콜을 줄이는 것이 목적이다(§13 P6): 한 스테이지 = 재질 수만큼의 메시.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const AO_FLOOR = 0.5;      // 바닥에 닿는 정점의 밝기 배율(가짜 접지 그림자)
const AO_HEIGHT = 1.4;     // 이 높이(m)에서 배율 1

/** 시드 난수(mulberry32) — 배치가 실행마다 같게. @param {number} seed @returns {()=>number} [0,1) */
export function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {Object} PartOpts
 * @property {number} [rx] @property {number} [ry] @property {number} [rz]   회전(rad). 순서 YZX(먼저 y로 돌리고 기울인다)
 * @property {number} [sx] @property {number} [sy] @property {number} [sz]
 * @property {number} [color]      정점색(재질 map에 곱해진다). 기본 흰색
 * @property {'box'|'keep'} [uv]   'box' = 월드 축 투영(기본) · 'keep' = 지오메트리의 uv 그대로
 * @property {boolean} [ao]        바닥 쪽을 어둡게(기본 true)
 * @property {number} [bright]     정점색 배율(기본 1)
 */

/** 재질 하나에 병합될 조각 모음. */
export class Batch {
  /** @param {number} [tile] 'box' uv의 타일 한 변(m) */
  constructor(tile = 2.4) {
    /** @type {THREE.BufferGeometry[]} */
    this.parts = [];
    this.tile = tile;
  }

  /**
   * 지오메트리를 변환 · 채색해 모음에 넣는다(geo는 소비된다).
   * @param {THREE.BufferGeometry} geo
   * @param {number} x @param {number} y @param {number} z
   * @param {PartOpts} [o]
   */
  add(geo, x, y, z, o = {}) {
    let g = geo;
    if (g.index) {
      g = geo.toNonIndexed();
      geo.dispose();
    }
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YZX');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();

    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const count = pos.count;
    if (o.uv !== 'keep' || !g.attributes.uv) {
      const uv = new Float32Array(count * 2);
      const k = 1 / this.tile;
      for (let i = 0; i < count; i++) {
        const ax = Math.abs(nor.getX(i));
        const ay = Math.abs(nor.getY(i));
        const az = Math.abs(nor.getZ(i));
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        if (ay >= ax && ay >= az) { uv[i * 2] = px * k; uv[i * 2 + 1] = pz * k; }
        else if (ax >= az) { uv[i * 2] = pz * k; uv[i * 2 + 1] = py * k; }
        else { uv[i * 2] = px * k; uv[i * 2 + 1] = py * k; }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    _c.set(o.color ?? 0xffffff);
    const bright = o.bright ?? 1;
    const col = new Float32Array(count * 3);
    const ao = o.ao !== false;
    for (let i = 0; i < count; i++) {
      let f = bright;
      if (ao) {
        const t = Math.min(1, Math.max(0, pos.getY(i) / AO_HEIGHT));
        f *= AO_FLOOR + (1 - AO_FLOOR) * t;
      }
      col[i * 3] = _c.r * f;
      col[i * 3 + 1] = _c.g * f;
      col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // 병합은 속성 집합이 같아야 한다
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    this.parts.push(g);
    return this;
  }

  /**
   * 모은 조각을 한 메시로 병합한다. 조각이 없으면 null.
   * @param {THREE.Material} material
   * @param {{cast?:boolean, receive?:boolean, name?:string}} [o]
   * @returns {THREE.Mesh|null}
   */
  build(material, o = {}) {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    mesh.matrixAutoUpdate = false;
    mesh.name = o.name ?? '';
    return mesh;
  }
}

/** 바닥이 y에 놓이는 상자. */
export function addBox(b, w, h, d, x, y, z, o) {
  return b.add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), x, y, z, o);
}

/** 바닥이 y에 놓이는 원기둥/원뿔대. uv는 둘레 · 높이에 맞춰 타일링한다. */
export function addCyl(b, rTop, rBot, h, seg, x, y, z, o = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const ku = (Math.PI * 2 * Math.max(rTop, rBot)) / b.tile;
  const kv = h / b.tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  return b.add(g, x, y, z, { uv: 'keep', ...o });
}

/** 위치에서 결정되는 해시(복제된 정점이 같은 값을 받게). */
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 각진 바위(면 단위 음영). r = 대략 반경, squash = 높이 배율.
 * @param {Batch} b @param {number} r
 * @param {number} x @param {number} y @param {number} z
 * @param {()=>number} rand
 * @param {PartOpts & {squash?:number, detail?:number, jitter?:number}} [o]
 */
export function addRock(b, r, x, y, z, rand, o = {}) {
  const g = new THREE.IcosahedronGeometry(r, o.detail ?? 1);
  const pos = g.attributes.position;
  const jit = o.jitter ?? 0.32;
  const seed = rand() * 10;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const k = 1 + (hash3(vx / r + seed, vy / r, vz / r) - 0.5) * 2 * jit;
    pos.setXYZ(i, vx * k, vy * k, vz * k);
  }
  g.computeVertexNormals();   // 비인덱스 지오메트리 → 면 법선
  return b.add(g, x, y, z, {
    ry: rand() * Math.PI * 2, rx: (rand() - 0.5) * 0.6,
    sy: o.squash ?? 0.7, ...o,
  });
}

/**
 * 반원 아치(쐐기돌 상자 n개). 두 받침점 (ax, az) · (bx, bz) 사이, 받침 높이 y0.
 * from/to로 일부만 남기면 무너진 아치가 된다(0..n).
 * @param {Batch} b
 * @param {{thick?:number, depth?:number, n?:number, from?:number, to?:number, pointed?:number} & PartOpts} [o]
 */
export function addArch(b, ax, az, bx, bz, y0, o = {}) {
  const n = o.n ?? 9;
  const thick = o.thick ?? 0.5;
  const depth = o.depth ?? 0.8;
  const pointed = o.pointed ?? 1;      // 높이 배율(>1이면 뾰족 아치처럼 솟는다)
  const dx = bx - ax;
  const dz = bz - az;
  const span = Math.hypot(dx, dz);
  const R = span / 2;
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const psi = Math.atan2(-dz, dx);
  const segLen = (Math.PI * R * Math.max(1, pointed)) / n * 1.08;
  const from = o.from ?? 0;
  const to = o.to ?? n;
  for (let i = from; i < to; i++) {
    const th = (Math.PI * (i + 0.5)) / n;
    const lx = R * Math.cos(th);
    const ly = R * Math.sin(th) * pointed;
    // 접선 방향(타원이면 기울기가 달라진다)
    const roll = Math.atan2(R * Math.cos(th) * pointed, -R * Math.sin(th));
    const g = new THREE.BoxGeometry(segLen, thick, depth);
    b.add(g, cx + (dx / span) * lx, y0 + ly, cz + (dz / span) * lx, { ...o, ry: psi, rz: roll, ao: false });
  }
  return b;
}

/**
 * 원형 바닥(극좌표 격자). uv = 월드 XZ / tile, uv1 = 원판 전체 0..1(룬 같은 비타일 맵용), 정점색 = colorAt(r).
 * @param {number[]} radii  0에서 시작하는 고리 반경들
 * @param {number} segs
 * @param {number} tile
 * @param {(r:number, a:number, out:THREE.Color)=>void} colorAt
 * @param {number} uv1Radius uv1이 0..1로 덮는 반경
 * @param {(r:number, a:number)=>number} [heightAt]
 */
export function makeGroundGeometry(radii, segs, tile, colorAt, uv1Radius, heightAt) {
  const rings = radii.length;
  const count = rings * (segs + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const uv1 = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);
  let i = 0;
  for (let ri = 0; ri < rings; ri++) {
    const r = radii[ri];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = r * Math.sin(a);
      const z = r * Math.cos(a);
      pos[i * 3] = x;
      pos[i * 3 + 1] = heightAt ? heightAt(r, a) : 0;
      pos[i * 3 + 2] = z;
      uv[i * 2] = x / tile;
      uv[i * 2 + 1] = z / tile;
      uv1[i * 2] = 0.5 + x / (2 * uv1Radius);
      uv1[i * 2 + 1] = 0.5 + z / (2 * uv1Radius);
      colorAt(r, a, _c);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      i += 1;
    }
  }
  const index = [];
  for (let ri = 0; ri < rings - 1; ri++) {
    for (let s = 0; s < segs; s++) {
      const a = ri * (segs + 1) + s;
      const b2 = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      index.push(a, c, b2, b2, c, d);   // +Y가 앞면
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * 먼 능선 실루엣(원통 띠). 꼭대기 색 → 바닥 색(지평선 안개에 녹는다). MeshBasicMaterial(vertexColors, fog:false)용.
 * @param {{radius:number, baseY:number, minH:number, maxH:number, segs:number, seed:number,
 *          top:number, bottom:number, jag?:number, arc?:[number, number]}} o
 * @returns {THREE.BufferGeometry}
 */
export function makeRidgeGeometry(o) {
  const rand = makeRand(o.seed);
  const segs = o.segs;
  const a0 = o.arc ? o.arc[0] : 0;
  const a1 = o.arc ? o.arc[1] : Math.PI * 2;
  const closed = !o.arc;
  // 높이: 느린 굴곡 + 톱니
  const hs = new Float32Array(segs + 1);
  const jag = o.jag ?? 0.35;
  const ph1 = rand() * 6.28;
  const ph2 = rand() * 6.28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const slow = 0.5 + 0.3 * Math.sin(t * Math.PI * 2 * 3 + ph1) + 0.2 * Math.sin(t * Math.PI * 2 * 7 + ph2);
    const v = Math.min(1, Math.max(0, slow * (1 - jag) + rand() * jag));
    hs[i] = o.minH + (o.maxH - o.minH) * v;
  }
  if (closed) hs[segs] = hs[0];
  const pos = [];
  const col = [];
  const top = new THREE.Color(o.top);
  const bot = new THREE.Color(o.bottom);
  const push = (a, y, c) => {
    pos.push(o.radius * Math.sin(a), y, o.radius * Math.cos(a));
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < segs; i++) {
    const aa = a0 + ((a1 - a0) * i) / segs;
    const ab = a0 + ((a1 - a0) * (i + 1)) / segs;
    const ya = o.baseY + hs[i];
    const yb = o.baseY + hs[i + 1];
    // 안쪽(원점)을 보는 면
    push(aa, o.baseY, bot); push(aa, ya, top); push(ab, o.baseY, bot);
    push(ab, o.baseY, bot); push(aa, ya, top); push(ab, yb, top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * 실루엣용 단색 조각(상자/원뿔)을 능선 지오메트리와 합칠 수 있게 position + color만 남겨 돌려준다.
 * @param {THREE.BufferGeometry} geo
 * @param {number} x @param {number} y @param {number} z
 * @param {number} top @param {number} bottom  꼭대기/바닥 색
 * @param {number} y0 @param {number} y1       색 그라디언트의 높이 범위(월드 y)
 * @param {number} [ry]
 */
export function silhouettePart(geo, x, y, z, top, bottom, y0, y1, ry = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  _e.set(0, ry, 0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(1, 1, 1);
  g.applyMatrix4(_m.compose(_p, _q, _s));
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const ct = new THREE.Color(top);
  const cb = new THREE.Color(bottom);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    _c.copy(cb).lerp(ct, t);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'color') g.deleteAttribute(name);
  }
  return g;
}

/** position + color 지오메트리들을 한 메시로. @returns {THREE.Mesh} */
export function buildSilhouette(geos, material) {
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.name = 'silhouette';
  return mesh;
}

/** 그룹 아래의 지오메트리 · 재질을 해제한다(텍스처는 라이브러리가 따로 해제한다). */
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mat = o.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else if (mat) mat.dispose();
  });
}
