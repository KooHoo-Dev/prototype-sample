// OWNER: P6 — 계약 §6.9 · §9.6
// STUB — W0 스텁(§6.14): buildFishModel = 상자 하나(Z 길이 lengthM · 머리 −Z · 원점 = 몸 중심). P6 가 체형 템플릿 5종으로 채운다.

import * as THREE from 'three';

/**
 * STUB
 * @param {import('../../types.js').SpeciesDef} species @param {number} lengthM
 * @param {{silhouette?:boolean, lod?:0|1}} [opts] @returns {THREE.Group}
 */
export function buildFishModel(species, lengthM, opts = {}) {
  const group = new THREE.Group();
  const depth = species && species.look ? species.look.depth : 0.25;
  const color = opts.silhouette ? '#000000' : species && species.look ? species.look.colors[1] : '#888888';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(lengthM * 0.16, lengthM * depth, lengthM), new THREE.MeshLambertMaterial({ color }));
  group.add(mesh);
  return group;
}

/** @param {THREE.Group} group */
export function disposeFishModel(group) {
  group.traverse(o => {
    const m = /** @type {any} */ (o);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  });
}
