// OWNER: P5 — 패키지 내부 파일(rig.js · weaponMeshes.js · npcView.js · 보스 뷰가 쓴다).
// 절차 지오메트리 조각(외부 에셋 0)과 「관절 × 재질」 단위 병합. 병합으로 캐릭터 하나의 드로 콜을 관절 수 × 1~2로 묶는다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * 지오메트리를 병합 가능한 꼴(비인덱스 · uv 없음)로 바꾸고 제자리 변환한다.
 * 스케일은 양수만 쓴다(음수는 면이 뒤집힌다).
 * @param {THREE.BufferGeometry} geom
 * @returns {THREE.BufferGeometry}
 */
export function place(geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let g = geom;
  if (g.index) {
    g = geom.toNonIndexed();
    geom.dispose();
  }
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

/** @returns {THREE.BufferGeometry} */
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** 위(+Y) 반경 rt, 아래 반경 rb. @returns {THREE.BufferGeometry} */
export const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
/** @returns {THREE.BufferGeometry} */
export const ball = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
/** 위쪽 반구(theta 만큼). 아래가 뚫려 있다. @returns {THREE.BufferGeometry} */
export const dome = (r, seg = 8, rows = 4, theta = Math.PI / 2) => new THREE.SphereGeometry(r, seg, rows, 0, Math.PI * 2, 0, theta);
/** 꼭짓점이 +Y. @returns {THREE.BufferGeometry} */
export const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg, 1);

/**
 * 사각뿔대: 아래 면 wb × db, 위 면 wt × dt, 높이 h(중심이 원점).
 * @returns {THREE.BufferGeometry}
 */
export function wedge(wb, db, wt, dt, h) {
  const g = new THREE.BoxGeometry(1, h, 1).toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0;
    pos.setX(i, pos.getX(i) * (top ? wt : wb));
    pos.setZ(i, pos.getZ(i) * (top ? dt : db));
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/**
 * 마름모 단면의 날: y = 0(뿌리, 폭 baseWidth) → y = len − tipLen(폭 width) → y = len(끝점).
 * @returns {THREE.BufferGeometry}
 */
export function bladeGeo(len, width, thick, tipLen, baseWidth = width) {
  const hw0 = baseWidth / 2;
  const hw1 = width / 2;
  const ht = thick / 2;
  const ys = len - tipLen;
  const r0 = [[-hw0, 0, 0], [0, 0, ht], [hw0, 0, 0], [0, 0, -ht]];
  const r1 = [[-hw1, ys, 0], [0, ys, ht], [hw1, ys, 0], [0, ys, -ht]];
  const tip = [0, len, 0];
  /** @type {number[]} */
  const v = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    v.push(...r0[i], ...r0[j], ...r1[j], ...r0[i], ...r1[j], ...r1[i], ...r1[i], ...r1[j], ...tip);
  }
  v.push(...r0[0], ...r0[2], ...r0[1], ...r0[0], ...r0[3], ...r0[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * 점들을 잇는 굵기가 변하는 관(뿔 · 꼬리 · 송곳니). 마디마다 원기둥 한 토막 + 끝에 뾰족한 원뿔.
 * @param {number[][]} pts [x, y, z][]
 * @param {number[]} radii pts와 같은 길이
 * @param {number} [seg]
 * @returns {THREE.BufferGeometry[]}
 */
export function tubePath(pts, radii, seg = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    _a.fromArray(pts[i]);
    _b.fromArray(pts[i + 1]);
    const len = _a.distanceTo(_b);
    if (!(len > 0)) continue;
    const last = i === pts.length - 2;
    const g = last && radii[i + 1] <= 0
      ? new THREE.ConeGeometry(radii[i], len, seg, 1)
      : new THREE.CylinderGeometry(radii[i + 1], radii[i], len, seg, 1);
    _s.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_up, _s);
    _e.setFromQuaternion(_q);
    out.push(place(g, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2, _e.x, _e.y, _e.z));
  }
  return out;
}

/**
 * 「부모 × 재질」 버킷에 조각을 모았다가 한 번에 병합해 Mesh로 붙인다.
 */
export class PartBuilder {
  constructor() {
    /** @type {Map<THREE.Object3D, Map<string, THREE.BufferGeometry[]>>} */
    this._buckets = new Map();
  }

  /**
   * @param {THREE.Object3D} parent 붙일 관절(또는 그룹)
   * @param {string} matKey finish에 넘길 재질 표의 키
   * @param {THREE.BufferGeometry|THREE.BufferGeometry[]} geom
   */
  add(parent, matKey, geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let byMat = this._buckets.get(parent);
    if (!byMat) {
      byMat = new Map();
      this._buckets.set(parent, byMat);
    }
    let list = byMat.get(matKey);
    if (!list) {
      list = [];
      byMat.set(matKey, list);
    }
    if (Array.isArray(geom)) {
      for (const g of geom) list.push(place(g, px, py, pz, rx, ry, rz, sx, sy, sz));
    } else {
      list.push(place(geom, px, py, pz, rx, ry, rz, sx, sy, sz));
    }
    return this;
  }

  /**
   * 버킷마다 병합한 Mesh를 부모에 붙인다.
   * @param {Record<string, THREE.Material>} materials
   * @param {THREE.BufferGeometry[]} [owned] 만든 지오메트리를 여기에 쌓는다(dispose용)
   * @returns {THREE.Mesh[]}
   */
  finish(materials, owned) {
    const meshes = [];
    for (const [parent, byMat] of this._buckets) {
      for (const [key, list] of byMat) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (list.length > 1) for (const g of list) g.dispose();
        const mat = materials[key];
        if (!mat) throw new Error(`PartBuilder: 재질 '${key}'가 없다`);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        parent.add(mesh);
        meshes.push(mesh);
        if (owned) owned.push(merged);
      }
    }
    this._buckets.clear();
    return meshes;
  }
}
