// OWNER: P7 — 계약 §9.4 「소품」 · §7.12 (내부)
// 소품 kind → 부품 목록 [{geo, mat}] — 원점 = 소품 자리 바닥 · +Z 가 앞 · 데이터의 기준 r · h 로 만든다(인스턴스가 소품마다 r · h 비로 늘린다).
// 막는 소품의 보이는 반지름 = 데이터 r(±0.1) — view.world.test 가 지오메트리 치수로 확인한다.
// mat: 'matte' 돌 · 나무 · 뼈 / 'metal' 쇠 / 'emit' 스스로 빛나는 것(용암 · 불꽃 · 결정)

import * as THREE from 'three';
import { GeoBuilder, mixRgb, rgb, xf } from './build.js';
import { FLAME, PAL } from './style.js';

/** 기준 치수(데이터 §7.12 의 r · h — 데이터가 바뀌면 인스턴스 배율이 맞춘다) */
export const PROP_BASE = {
  pillar: { r: 0.6, h: 3.0 }, coffin: { r: 0.7, h: 0.8 }, candles: { r: 0.3, h: 0.5 }, bones: { r: 0.4, h: 0.2 }, urn: { r: 0.35, h: 0.8 },
  rock: { r: 0.8, h: 1.2 }, stalagmite: { r: 0.5, h: 2.0 }, lavaCrack: { r: 1.2, h: 0.05 }, ashPile: { r: 0.6, h: 0.3 }, crystal: { r: 0.3, h: 0.8 },
};
/** 플레이어를 가릴 만큼 키가 커서 벽처럼 낮추는 소품(높이 ≥ 이 값 · 막는 소품) */
export const TALL_PROP_H = 1.6;

const STONE = 0x77726a, STONE_D = 0x55514b, BONE = 0xd2c9b2, WAX = 0xe6dcc0;

/**
 * @param {string} kind
 * @returns {Array<{geo:THREE.BufferGeometry, mat:'matte'|'metal'|'emit'}>}
 */
export function propParts(kind) {
  const make = BUILDERS[kind] ?? genericProp;
  return make(kind);
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

/** @type {Record<string, (kind:string) => Array<{geo:THREE.BufferGeometry, mat:'matte'|'metal'|'emit'}>>} */
const BUILDERS = {
  pillar() {
    const b = new GeoBuilder();
    b.add(cyl(0.62, 0.64, 0.3, 8), xf(0, 0.15, 0, Math.PI / 8), STONE_D);
    b.add(cyl(0.56, 0.6, 0.12, 8), xf(0, 0.36, 0, Math.PI / 8), STONE);
    b.add(cyl(0.47, 0.5, 2.2, 8), xf(0, 1.5, 0, Math.PI / 8), STONE, { shade: (x, y) => 0.85 + 0.15 * (y + 1.1) / 2.2 });
    b.add(new THREE.TorusGeometry(0.49, 0.045, 4, 8), xf(0, 1.1, 0, Math.PI / 8, 1, 1, 1, Math.PI / 2), STONE_D);
    b.add(cyl(0.6, 0.48, 0.28, 8), xf(0, 2.72, 0, Math.PI / 8), STONE);
    b.add(cyl(0.64, 0.64, 0.12, 8), xf(0, 2.94, 0, Math.PI / 8), STONE_D);
    return [{ geo: b.build(), mat: 'matte' }];
  },
  coffin() {
    const b = new GeoBuilder();
    b.add(box(0.74, 0.1, 1.38), xf(0, 0.05, 0), STONE_D);
    b.add(box(0.66, 0.5, 1.3), xf(0, 0.35, 0), 0x625d56, { shade: (x, y) => 0.8 + 0.4 * (y + 0.25) });
    b.add(box(0.72, 0.1, 1.36), xf(0, 0.65, 0), 0x4e4a44);
    b.add(box(0.48, 0.1, 1.18), xf(0, 0.75, 0), 0x57524c);
    // 뚜껑의 십자 무늬(돋을새김)
    b.add(box(0.08, 0.03, 0.7), xf(0, 0.815, 0.1), 0x6e6860);
    b.add(box(0.36, 0.03, 0.08), xf(0, 0.815, 0.25), 0x6e6860);
    return [{ geo: b.build(), mat: 'matte' }];
  },
  candles() {
    const b = new GeoBuilder();
    const f = new GeoBuilder();
    b.add(cyl(0.27, 0.29, 0.03, 9), xf(0, 0.015, 0), 0xc8bea0);
    const spots = [[0, 0, 0.42], [0.13, 0.08, 0.3], [-0.12, 0.1, 0.24], [0.05, -0.15, 0.34], [-0.15, -0.08, 0.18], [0.17, -0.1, 0.14]];
    for (const [x, z, h] of spots) {
      const r = 0.032 + h * 0.03;
      b.add(cyl(r, r * 1.1, h, 6), xf(x, h / 2 + 0.03, z), WAX, { shade: (lx, ly) => 0.8 + 0.4 * (ly / h + 0.5) });
      f.add(new THREE.ConeGeometry(0.024, 0.085, 5), xf(x, h + 0.075, z), rgb(FLAME.mid, 2.2));
      f.add(new THREE.OctahedronGeometry(0.018, 0), xf(x, h + 0.05, z), rgb(FLAME.core, 2.6));
    }
    return [{ geo: b.build(), mat: 'matte' }, { geo: f.build(), mat: 'emit' }];
  },
  bones() {
    const b = new GeoBuilder();
    const lay = [[0.05, 0.12, 0.6, 0.34], [-0.15, -0.05, 2.1, 0.28], [0.18, -0.16, -0.7, 0.24], [-0.05, 0.22, 1.2, 0.2]];
    for (const [x, z, yaw, len] of lay) {
      b.add(cyl(0.025, 0.025, len, 5), xf(x, 0.03, z, yaw, 1, 1, 1, Math.PI / 2), BONE);
      b.add(new THREE.SphereGeometry(0.04, 5, 3), xf(x + Math.sin(yaw) * len / 2, 0.035, z + Math.cos(yaw) * len / 2), BONE);
      b.add(new THREE.SphereGeometry(0.04, 5, 3), xf(x - Math.sin(yaw) * len / 2, 0.035, z - Math.cos(yaw) * len / 2), BONE);
    }
    // 해골
    b.add(new THREE.IcosahedronGeometry(0.1, 1), xf(-0.2, 0.09, 0.2, 0.4, 1, 0.9, 1.15), BONE);
    b.add(box(0.12, 0.05, 0.08), xf(-0.2, 0.03, 0.31, 0.4), 0xb8ae96);
    b.add(box(0.035, 0.035, 0.02), xf(-0.24, 0.1, 0.31, 0.4), 0x1a1612);
    b.add(box(0.035, 0.035, 0.02), xf(-0.17, 0.1, 0.32, 0.4), 0x1a1612);
    return [{ geo: b.build(), mat: 'matte' }];
  },
  urn() {
    const b = new GeoBuilder();
    const prof = [[0.001, 0], [0.18, 0], [0.29, 0.14], [0.35, 0.36], [0.31, 0.56], [0.17, 0.68], [0.14, 0.74], [0.2, 0.8], [0.001, 0.8]];
    const lathe = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 9);
    b.add(lathe, xf(0, 0, 0), 0x6e4a34, { shade: (x, y) => 0.75 + 0.35 * y });
    b.add(new THREE.TorusGeometry(0.33, 0.02, 3, 9), xf(0, 0.42, 0, 0, 1, 1, 1, Math.PI / 2), 0x9a7a4a);
    return [{ geo: b.build(), mat: 'matte' }];
  },
  rock() {
    const b = new GeoBuilder();
    const P = PAL.cavern;
    b.add(new THREE.IcosahedronGeometry(1, 0), xf(0, 0.55, 0, 0.3, 0.74, 0.72, 0.74), P.rock,
      { jitter: 0.14, jitterSeed: 11, shade: (x, y) => 0.6 + 0.55 * (y + 1) / 2 });
    b.add(new THREE.IcosahedronGeometry(0.34, 0), xf(0.38, 0.18, 0.22, 1.1, 1, 0.7, 1), P.rockAlt, { jitter: 0.06, jitterSeed: 12 });
    return [{ geo: b.build(), mat: 'matte' }];
  },
  stalagmite() {
    const b = new GeoBuilder();
    const P = PAL.cavern;
    const sh = (h) => (x, y) => 0.55 + 0.6 * (y / h + 0.5);
    b.add(new THREE.ConeGeometry(0.5, 2.0, 7, 3), xf(0, 1.0, 0), P.rockAlt, { jitter: 0.07, jitterSeed: 21, shade: sh(2.0) });
    b.add(new THREE.ConeGeometry(0.22, 0.9, 6, 2), xf(0.32, 0.45, 0.12, 0.5), P.rock, { jitter: 0.04, jitterSeed: 22, shade: sh(0.9) });
    b.add(new THREE.ConeGeometry(0.17, 0.6, 6, 1), xf(-0.24, 0.3, -0.24, 1.3), P.rock, { jitter: 0.03, jitterSeed: 23, shade: sh(0.6) });
    return [{ geo: b.build(), mat: 'matte' }];
  },
  lavaCrack() {
    const rim = new GeoBuilder();
    const hot = new GeoBuilder();
    // 그을린 둘레(불규칙 판)
    const n = 11;
    const rimC = rgb(0x1a0d08);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const r0 = 0.75 + 0.35 * Math.abs(Math.sin(k * 2.3)), r1 = 0.75 + 0.35 * Math.abs(Math.sin((k + 1) * 2.3));
      rim.tri(0, 0.012, 0, Math.sin(a0) * r0 * 0.75, 0.012, Math.cos(a0) * r0 * 1.05, Math.sin(a1) * r1 * 0.75, 0.012, Math.cos(a1) * r1 * 1.05, ...rimC);
    }
    // 빛나는 갈라진 줄(가운데 뜨겁게) + 가지 둘
    const strip = (pts, w, y, col) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
        const wa = w * (k === 0 ? 0.3 : 1), wb = w * (k === pts.length - 2 ? 0.3 : 1);
        const nax = (-dz / l) * wa, naz = (dx / l) * wa, nbx = (-dz / l) * wb, nbz = (dx / l) * wb;
        hot.tri(ax - nax, y, az - naz, bx + nbx, y, bz + nbz, bx - nbx, y, bz - nbz, ...col);
        hot.tri(ax - nax, y, az - naz, ax + nax, y, az + naz, bx + nbx, y, bz + nbz, ...col);
      }
    };
    const main = [[0.05, -1.15], [-0.12, -0.7], [0.1, -0.3], [-0.06, 0.15], [0.14, 0.55], [-0.02, 0.9], [0.06, 1.15]];
    strip(main, 0.13, 0.02, rgb(FLAME.lava, 2.0));
    strip(main, 0.05, 0.026, rgb(FLAME.lavaHot, 1.9));
    strip([[0.1, -0.3], [0.42, -0.12], [0.62, 0.12]], 0.07, 0.021, rgb(FLAME.lava, 2.0));
    strip([[-0.06, 0.15], [-0.4, 0.32], [-0.58, 0.6]], 0.06, 0.021, rgb(FLAME.lava, 2.0));
    return [{ geo: rim.build(), mat: 'matte' }, { geo: hot.build(), mat: 'emit' }];
  },
  ashPile() {
    const b = new GeoBuilder();
    const e = new GeoBuilder();
    b.add(new THREE.IcosahedronGeometry(1, 1), xf(0, -0.02, 0, 0, 0.6, 0.32, 0.55), 0x6c6662,
      { jitter: 0.08, jitterSeed: 31, shade: (x, y) => 0.65 + 0.45 * Math.max(0, y) });
    for (const [x, z] of [[0.12, 0.1], [-0.18, -0.05], [0.05, -0.2]]) {
      e.add(new THREE.TetrahedronGeometry(0.035, 0), xf(x, 0.2, z), rgb(FLAME.edge, 2.2));
    }
    return [{ geo: b.build(), mat: 'matte' }, { geo: e.build(), mat: 'emit' }];
  },
  crystal() {
    const b = new GeoBuilder();
    const e = new GeoBuilder();
    b.add(new THREE.IcosahedronGeometry(0.16, 0), xf(0, 0.05, 0, 0, 1.6, 0.6, 1.4), PAL.cavern.rockAlt, { jitter: 0.03, jitterSeed: 41 });
    const shards = [[0, 0, 0, 0, 0.75], [0.12, 0.06, 0.5, 0.35, 0.5], [-0.11, 0.05, -0.45, -0.3, 0.55], [0.03, -0.12, 0.3, -0.5, 0.4]];
    for (const [x, z, rx, rz, h] of shards) {
      e.add(new THREE.OctahedronGeometry(0.09, 0), xf(x, h * 0.5 + 0.05, z, 0.4, 1, h / 0.18, 1, rx, rz), mixRgb(0x7fd6e0, 0xc8f4ff, 0.3, 1.25));
    }
    return [{ geo: b.build(), mat: 'matte' }, { geo: e.build(), mat: 'emit' }];
  },
};

/** 모르는 kind — 데이터 r · h 의 다듬은 돌덩이(자리 표시가 아니라 소품처럼) */
function genericProp() {
  const b = new GeoBuilder();
  b.add(new THREE.DodecahedronGeometry(1, 0), xf(0, 0.5, 0, 0, 1, 0.5, 1), STONE, { jitter: 0.06, jitterSeed: 51 });
  return [{ geo: b.build(), mat: 'matte' }];
}

/** 소품 기준 치수(모르는 kind 는 r 1 · h 1) @param {string} kind */
export function propBase(kind) {
  return PROP_BASE[kind] ?? { r: 1, h: 1 };
}
