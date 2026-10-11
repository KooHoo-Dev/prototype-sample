// OWNER: P4 — 계약 §6.6
// STUB — W1 에서 P4 가 채운다(8방향 A* · 모서리 자르기 금지 · r 여유 · 줄 당기기 · 막힌 곳 → 가장 가까운 점). W0: [nearestWalkable(to) ?? from]

import { PATHING } from '../../data/mapgen.js';
import { nearestWalkable } from './nav.js';

/** @typedef {import('../../types.js').MapData} MapData */
/** @typedef {import('../../types.js').Vec2} Vec2 */

/**
 * STUB — 경유점(시작점 제외 · 마지막 = 목적지)
 * @param {MapData} map @param {Vec2} from @param {Vec2} to @param {{r?:number, maxNodes?:number}} [opts] @returns {Vec2[]}
 */
export function findPath(map, from, to, { r = 0.4, maxNodes = PATHING.maxNodes } = {}) {
  const p = nearestWalkable(map, to.x, to.z, 3);
  return [p ?? { x: from.x, z: from.z }];
}
