// OWNER: P7 — fx 내부 파일(FxLayer와 그 부품만 import 한다)
// 팔레트 → THREE.Color(선형 작업 공간) 상수. 프레임 중에 Color를 만들지 않게 한 번만 만든다.
import * as THREE from 'three';
import { PALETTE } from '../../data/palette.js';

/** @typedef {{core:THREE.Color, glow:THREE.Color}} StyleColors */

/** @type {Record<string, StyleColors>} */
const STYLE = {};
for (const [id, c] of Object.entries(PALETTE.style)) {
  STYLE[id] = { core: new THREE.Color(c.core), glow: new THREE.Color(c.glow) };
}

/**
 * @param {string} style FxStyle. 모르는 값이면 fire
 * @returns {StyleColors}
 */
export function styleColors(style) {
  return STYLE[style] ?? STYLE.fire;
}

/** 고정 색 */
export const COL = {
  white: new THREE.Color(1, 1, 1),
  spark: new THREE.Color(PALETTE.spark),
  blood: new THREE.Color(PALETTE.blood),
  heal: new THREE.Color(PALETTE.heal),
  ember: new THREE.Color(PALETTE.ember),
  steel: new THREE.Color(PALETTE.steel),
  gold: new THREE.Color(PALETTE.player.accent).multiplyScalar(1.6),
  /** 무적 튕김 */
  dull: new THREE.Color(PALETTE.steel).multiplyScalar(0.45),
  /** 회피 잔상 */
  ghost: new THREE.Color(0xa8c8ff),
  ash: new THREE.Color(0x4a4744),
  stone: new THREE.Color(0x5a554e),
  snowflake: new THREE.Color(0xe8f2ff),
  hurt: new THREE.Color(PALETTE.style.danger.glow),
};

/** 테마별 먼지 색(알파 혼합이라 바닥 톤에 맞춘다) */
const DUST = {
  town: new THREE.Color(0x8f8070),
  ember: new THREE.Color(0x8c7564),
  frost: new THREE.Color(0xc4d2e0),
  void: new THREE.Color(0x645a7c),
};

/** @param {string} theme WorldDef.theme @returns {THREE.Color} */
export function dustColor(theme) {
  return DUST[theme] ?? DUST.town;
}
