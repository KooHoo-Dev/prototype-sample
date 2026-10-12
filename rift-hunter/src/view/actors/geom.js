// OWNER: P8 — 계약 §9.5 (내부 — 로우폴리 도형 묶음 → 병합 지오메트리)
// 도형 목록([종류, 크기, 자리, 회전, 색])을 비색인 BufferGeometry 하나로 합친다(position · normal · color). 면마다 평평한 법선(로우폴리 톤).
// 외부 에셋 0 — 전부 three 의 기본 도형에서 만든다. DOM 을 쓰지 않는다(Node 테스트가 치수를 잰다).

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Euler,
  IcosahedronGeometry, Matrix4, OctahedronGeometry, Quaternion, TetrahedronGeometry, Vector3,
} from 'three';

/**
 * 도형 하나: {k: 'box'|'cyl'|'cone'|'ico'|'oct'|'tet'|'dod', s: 크기 배열, p?: [x,y,z], r?: [rx,ry,rz], c?: 색(hex 문자열 · 숫자), seg?: 둘레 칸 수, d?: 세분, sc?: [sx,sy,sz]}
 *   box s = [w, h, d] · cyl s = [rTop, rBottom, h] · cone s = [r, h] · ico/oct/tet/dod s = [r]
 * @typedef {{k:string, s:number[], p?:number[], r?:number[], c?:string|number, seg?:number, d?:number, sc?:number[], taper?:number}} Prim
 */

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** @param {Prim} pr */
function primGeo(pr) {
  const s = pr.s;
  switch (pr.k) {
    case 'box': {
      const g = new BoxGeometry(s[0], s[1], s[2]);
      if (pr.taper !== undefined) taperTop(g, s[1], pr.taper);
      return g;
    }
    case 'cyl': return new CylinderGeometry(s[0], s[1], s[2], pr.seg ?? 6, 1, false);
    case 'cone': return new ConeGeometry(s[0], s[1], pr.seg ?? 6, 1, false);
    case 'ico': return new IcosahedronGeometry(s[0], pr.d ?? 0);
    case 'oct': return new OctahedronGeometry(s[0], pr.d ?? 0);
    case 'tet': return new TetrahedronGeometry(s[0], 0);
    case 'dod': return new DodecahedronGeometry(s[0], 0);
    default: throw new Error(`geom: unknown prim '${pr.k}'`);
  }
}

/** 상자 위쪽(+Y 면)을 taper 배율로 좁히거나 넓힌다 */
function taperTop(g, h, taper) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * taper);
      pos.setZ(i, pos.getZ(i) * taper);
    }
  }
}

/** 색 → [r, g, b](선형) */
export function rgb(c) {
  _c.set(/** @type {any} */ (c ?? 0xffffff));
  return [_c.r, _c.g, _c.b];
}

/**
 * 도형 목록 → 병합 지오메트리(비색인 · 평평한 법선 · 정점 색)
 * @param {Prim[]} prims
 * @returns {BufferGeometry}
 */
export function build(prims) {
  /** @type {Float32Array[]} */
  const posParts = [], colParts = [];
  let total = 0;
  for (const pr of prims) {
    let g = primGeo(pr);
    if (g.index) { const ng = g.toNonIndexed(); g.dispose(); g = ng; }
    _p.set(pr.p?.[0] ?? 0, pr.p?.[1] ?? 0, pr.p?.[2] ?? 0);
    _e.set(pr.r?.[0] ?? 0, pr.r?.[1] ?? 0, pr.r?.[2] ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(pr.sc?.[0] ?? 1, pr.sc?.[1] ?? 1, pr.sc?.[2] ?? 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    const pos = /** @type {Float32Array} */ (g.getAttribute('position').array);
    const n = pos.length / 3;
    const col = new Float32Array(n * 3);
    const [r, gg, b] = rgb(pr.c ?? 0xffffff);
    for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b; }
    posParts.push(new Float32Array(pos));
    colParts.push(col);
    total += n;
    g.dispose();
  }
  const P = new Float32Array(total * 3), C = new Float32Array(total * 3);
  let o = 0;
  for (let i = 0; i < posParts.length; i++) {
    P.set(posParts[i], o);
    C.set(colParts[i], o);
    o += posParts[i].length;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(P, 3));
  out.setAttribute('color', new BufferAttribute(C, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** 정점 색을 높이에 따라 어둡게(바닥 쪽 그늘 — 로우폴리에 깊이) @param {BufferGeometry} g */
export function shadeByHeight(g, y0, y1, dark = 0.72) {
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - y0) / ((y1 - y0) || 1)));
    const k = dark + (1 - dark) * t;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
  return g;
}

/** 결정적 의사 난수(지오메트리 모양용 — 시드 고정) */
export function prand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 지오메트리의 축 정렬 범위(로컬) @param {BufferGeometry} g */
export function boundsOf(g) {
  if (!g.boundingBox) g.computeBoundingBox();
  return /** @type {import('three').Box3} */ (g.boundingBox);
}
