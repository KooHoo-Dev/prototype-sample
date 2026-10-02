// OWNER: P5 — 계약 §9.6 · §7.3 (패키지 내부: playerView.js · npcView.js · valderView.js가 쓴다)
// 무기 메시. 날의 축은 로컬 +Y(자루 쥔 곳이 원점), 날의 폭은 로컬 Z — 리그의 weapon 소켓에 붙이면
// rest에서 날이 앞(+Z)을 보고 날 면이 세로로 선다. 길이는 WeaponDef.length에 비례한다.
import * as THREE from 'three';
import { PALETTE } from '../../data/palette.js';
import { getWeaponDef } from '../../data/weapons.js';
import { PartBuilder, box, cyl, ball, cone, wedge, bladeGeo } from './geo.js';

/** @typedef {import('../../types.js').WeaponId} WeaponId */

/**
 * @typedef {Object} WeaponMesh
 * @property {THREE.Group} object   소켓에 붙일 그룹
 * @property {number} base          날이 시작하는 y(m) — weaponBase 소켓 자리
 * @property {number} tip           날 끝 y(m) — weaponTip 소켓 자리
 * @property {number} gripL         양손으로 쥘 때 왼손 자리 y(m)
 * @property {number} gripMin       왼손이 자루를 따라 미끄러질 수 있는 범위(y, m) — 창은 찌를 때 뒷손 쪽으로 당겨진다
 * @property {number} gripMax
 * @property {(amount:number)=>void} setEnchant  0..1 불 인챈트(보스 대검만 눈에 띈다)
 * @property {(opacity:number)=>void} setOpacity  0..1 (사망 소멸 — 리그의 setOpacity와 같이 부른다)
 * @property {()=>void} dispose
 */

/** 설계 기준 길이(m) — WeaponDef.length가 이 값이면 배율 1 */
const NOMINAL = { longsword: 1.1, greatsword: 1.7, spear: 2.4 };
const HALF_PI = Math.PI / 2;
/** 인챈트가 최대일 때 날 · 심지의 발광 세기 */
const ENCHANT_BLADE = 1.4;
const ENCHANT_CORE = 5;
/** 보스 대검 심지의 평소 발광(블룸 임계 아래 — 날 가운데의 잔불 줄이 예고 자세의 칼 방향을 알려 준다) */
const CORE_IDLE = 0.7;
/** 날의 기본 자체 발광(제 색 × 이 값) — 어두운 곳에서도 날이 읽히게 */
const BLADE_FILL = 0.22;

/** @param {number} steel @param {number} grip @param {number} trim */
function weaponMaterials(steel, grip, trim) {
  return {
    steel: new THREE.MeshStandardMaterial({ color: steel, metalness: 0.5, roughness: 0.32, flatShading: true,
      emissive: steel, emissiveIntensity: BLADE_FILL }),
    grip: new THREE.MeshStandardMaterial({ color: grip, roughness: 0.8, emissive: grip, emissiveIntensity: 0.1 }),
    trim: new THREE.MeshStandardMaterial({ color: trim, metalness: 0.5, roughness: 0.4, flatShading: true,
      emissive: trim, emissiveIntensity: 0.15 }),
  };
}

/** @param {THREE.Group} group @param {PartBuilder} b @param {Record<string, THREE.Material>} mats */
function finish(group, b, mats, base, tip, gripL, setEnchant = () => {}, gripMin = gripL, gripMax = gripL) {
  /** @type {THREE.BufferGeometry[]} */
  const geoms = [];
  b.finish(mats, geoms);
  let opacity = 1;
  return {
    object: group, base, tip, gripL, gripMin, gripMax, setEnchant,
    setOpacity(a) {
      const v = Math.min(1, Math.max(0, a));
      if (v === opacity) return;
      const toggled = (v < 1) !== (opacity < 1);
      opacity = v;
      for (const k in mats) {
        mats[k].opacity = v;
        if (toggled) {
          mats[k].transparent = v < 1;
          mats[k].needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const g of geoms) g.dispose();
      for (const k in mats) mats[k].dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}

/** 장검: 한 손. @param {number} k 배율 @returns {WeaponMesh} */
function longsword(k) {
  const g = new THREE.Group();
  const mats = weaponMaterials(PALETTE.steel, 0x2a1f1a, PALETTE.player.accent);
  const b = new PartBuilder();
  const A = (mat, geom, y, rx = 0, ry = 0, rz = 0, z = 0) => b.add(g, mat, geom, 0, y * k, z * k, rx, ry, rz, k, k, k);
  A('trim', ball(0.028, 6, 5), -0.108);
  A('grip', cyl(0.016, 0.018, 0.17, 6), -0.012);
  A('trim', box(0.032, 0.03, 0.24), 0.085);
  A('trim', cone(0.02, 0.05, 4), 0.085, HALF_PI, 0, 0, 0.14);
  A('trim', cone(0.02, 0.05, 4), 0.085, -HALF_PI, 0, 0, -0.14);
  A('steel', bladeGeo(0.9, 0.07, 0.02, 0.2, 0.08), 0.1, 0, HALF_PI);
  return finish(g, b, mats, 0.12 * k, 1.0 * k, -0.06 * k);
}

/**
 * 대검: 두 손. 보스용은 더 크고 어두우며 날 가운데에 잔불 심지가 있다.
 * @param {number} k 배율
 * @param {{steel?:number, trim?:number, core?:number}} [o] core를 주면 인챈트 심지를 만든다
 * @returns {WeaponMesh}
 */
function greatsword(k, o = {}) {
  const g = new THREE.Group();
  const mats = weaponMaterials(o.steel ?? PALETTE.steel, 0x241a16, o.trim ?? PALETTE.player.accent);
  const b = new PartBuilder();
  const A = (mat, geom, y, rx = 0, ry = 0, rz = 0, z = 0) => b.add(g, mat, geom, 0, y * k, z * k, rx, ry, rz, k, k, k);
  A('trim', ball(0.04, 6, 5), -0.3, 0, 0, 0);
  A('grip', cyl(0.02, 0.023, 0.37, 6), -0.09);
  A('trim', box(0.04, 0.045, 0.4), 0.115);
  A('trim', wedge(0.04, 0.05, 0.03, 0.02, 0.09), 0.085, Math.PI, 0, 0, 0.19);
  A('trim', wedge(0.04, 0.05, 0.03, 0.02, 0.09), 0.085, Math.PI, 0, 0, -0.19);
  A('steel', box(0.03, 0.15, 0.085), 0.205);
  A('steel', bladeGeo(1.14, 0.13, 0.03, 0.3, 0.15), 0.26, 0, HALF_PI);
  let setEnchant = () => {};
  if (o.core !== undefined) {
    mats.core = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.6, emissive: o.core, emissiveIntensity: CORE_IDLE });
    A('core', box(0.036, 0.8, 0.022), 0.72);
    A('core', box(0.05, 0.03, 0.03), 0.115);
    const steelMat = /** @type {THREE.MeshStandardMaterial} */ (mats.steel);
    const coreMat = /** @type {THREE.MeshStandardMaterial} */ (mats.core);
    const cold = steelMat.emissive.clone();
    const hot = new THREE.Color(PALETTE.style.fire.glow);
    let last = -1;
    setEnchant = (amount) => {
      const a = Math.min(1, Math.max(0, amount));
      if (a === last) return;
      last = a;
      steelMat.emissive.copy(cold).lerp(hot, a);
      steelMat.emissiveIntensity = BLADE_FILL + (ENCHANT_BLADE - BLADE_FILL) * a;
      coreMat.emissiveIntensity = CORE_IDLE + (ENCHANT_CORE - CORE_IDLE) * a;
    };
  }
  return finish(g, b, mats, 0.24 * k, 1.4 * k, -0.2 * k, setEnchant, -0.24 * k, -0.14 * k);
}

/** 창: 자루 뒤쪽을 쥔다(찌르기가 멀리 닿게). @param {number} k 배율 @returns {WeaponMesh} */
function spear(k) {
  const g = new THREE.Group();
  const mats = weaponMaterials(PALETTE.steel, 0x3a2a1c, PALETTE.player.accent);
  const b = new PartBuilder();
  const A = (mat, geom, y, rx = 0, ry = 0, rz = 0, z = 0) => b.add(g, mat, geom, 0, y * k, z * k, rx, ry, rz, k, k, k);
  A('grip', cyl(0.017, 0.02, 2.0, 6), 0.65);
  A('trim', cone(0.022, 0.07, 5), -0.38, Math.PI);
  A('trim', cyl(0.026, 0.022, 0.07, 6), 1.64);
  A('trim', box(0.02, 0.02, 0.13), 1.66);
  A('steel', bladeGeo(0.42, 0.09, 0.024, 0.3, 0.034), 1.66, 0, HALF_PI);
  return finish(g, b, mats, 1.3 * k, 2.08 * k, 0.62 * k, undefined, 0.16 * k, 0.8 * k);
}

/**
 * 플레이어 무기 메시.
 * @param {WeaponId} weaponId
 * @returns {WeaponMesh}
 */
export function createWeaponMesh(weaponId) {
  const def = getWeaponDef(weaponId);
  const id = def && NOMINAL[weaponId] ? weaponId : 'longsword';
  const k = (def?.length ?? NOMINAL[id]) / NOMINAL[id];
  if (id === 'greatsword') return greatsword(k);
  if (id === 'spear') return spear(k);
  return longsword(k);
}

/**
 * 보스(인간형)가 쓰는 큰 대검. length = 전체 길이(자루 끝 → 날 끝, m).
 * @param {{length:number, steel?:number, trim?:number, core:number}} o
 * @returns {WeaponMesh}
 */
export function createBossGreatsword(o) {
  // 날은 갑옷보다 밝은 강철 — 예고 자세에서 치켜든 대검이 어두운 배경에 묻히면 패턴을 읽을 수 없다
  return greatsword(o.length / NOMINAL.greatsword, { steel: o.steel ?? 0x7c7c88, trim: o.trim ?? 0x34343c, core: o.core });
}

/** 대장장이의 망치(오른손 소켓에 붙인다). @returns {WeaponMesh} */
export function createHammerMesh() {
  const g = new THREE.Group();
  const mats = weaponMaterials(0x55575c, 0x3a2a1c, 0x55575c);
  const b = new PartBuilder();
  b.add(g, 'grip', cyl(0.016, 0.018, 0.42, 6), 0, 0.12, 0);
  b.add(g, 'steel', box(0.07, 0.08, 0.17), 0, 0.33, 0);
  return finish(g, b, mats, 0.28, 0.38, 0);
}
