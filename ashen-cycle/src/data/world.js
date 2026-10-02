// OWNER: P2 — 계약 §7.8 (시드: P0이 계약 값으로 완성 · 이후 조정은 P2만)
// 전부 원점 중심 원형. 좌표 (x, z), m. 기둥 위치는 (R sin a, R cos a).
import { TAU } from '../core/constants.js';

/** @typedef {import('../types.js').WorldDef} WorldDef */
/** @typedef {import('../types.js').Collider} Collider */

/**
 * 반경 R의 원 위에 count개의 원 콜라이더를 균등하게 놓는다(각 = a0 + k × TAU / count).
 * @returns {Collider[]}
 */
function ringOfCircles(R, count, a0, r) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = a0 + (k * TAU) / count;
    out.push({ type: 'circle', x: R * Math.sin(a), z: R * Math.cos(a), r });
  }
  return out;
}

/** @type {Record<string, WorldDef>} */
export const WORLDS = {
  town: {
    id: 'town', kind: 'town', theme: 'town', radius: 18,
    colliders: [
      { type: 'circle', x: 0, z: 0, r: 0.9 },                    // 화톳불
      { type: 'box', x: -10.5, z: 7, hw: 2.0, hd: 1.5 },         // 대장간
      { type: 'box', x: 10.5, z: 7, hw: 2.0, hd: 1.5 },          // 좌판
      { type: 'circle', x: -8.8, z: 5.8, r: 0.5 },               // NPC 대장장이
      { type: 'circle', x: 8.8, z: 5.8, r: 0.5 },                // NPC 상인
      { type: 'circle', x: -2.4, z: 15.5, r: 0.8 },              // 안개문 기둥
      { type: 'circle', x: 2.4, z: 15.5, r: 0.8 },
      // (W3) 안개문 벽 — 두 기둥 사이(안개 막)와 기둥 바깥 담을 한 줄로 막는다. 막을 지나 문 뒤로 걸어 들어갈 수 없다.
      // 뷰는 gate 시설 원 안에 중심이 있는 상자를 「문 옆 담」으로 그린다(townScene.js).
      { type: 'box', x: 0, z: 15.5, hw: 9.4, hd: 0.3 },
    ],
    // 화톳불 바로 북쪽 — 화톳불 상호작용 원 안이라 부활 즉시 [E] 프롬프트가 뜬다
    playerSpawn: { x: 0, z: 2.4, facing: 0 },
    bossSpawn: null,
    facilities: [
      { id: 'bonfire', x: 0, z: 0, r: 2.6 },
      { id: 'blacksmith', x: -8, z: 5, r: 2.6 },
      { id: 'merchant', x: 8, z: 5, r: 2.6 },
      { id: 'gate', x: 0, z: 14, r: 3.2 },
    ],
    dummy: { x: -6, z: -6 },
    npcs: [
      { id: 'blacksmith', x: -8.8, z: 5.8, facing: 2.3 },
      { id: 'merchant', x: 8.8, z: 5.8, facing: -2.3 },
    ],
  },
  arena_valder: {
    id: 'arena_valder', kind: 'arena', theme: 'ember', radius: 20,
    colliders: [],
    playerSpawn: { x: 0, z: -13, facing: 0 },
    bossSpawn: { x: 0, z: 5, facing: Math.PI },
    facilities: [], dummy: null, npcs: [],
  },
  arena_fenrir: {
    id: 'arena_fenrir', kind: 'arena', theme: 'frost', radius: 24,
    colliders: ringOfCircles(15, 5, 0, 1.3),                     // 얼음 기둥 5개(각 k × 1.2566)
    playerSpawn: { x: 0, z: -16, facing: 0 },
    bossSpawn: { x: 0, z: 6, facing: Math.PI },
    facilities: [], dummy: null, npcs: [],
  },
  arena_nihil: {
    id: 'arena_nihil', kind: 'arena', theme: 'void', radius: 22,
    colliders: ringOfCircles(11, 4, Math.PI / 4, 1.0),           // 석주 4개(각 0.785 + k × 1.5708)
    playerSpawn: { x: 0, z: -15, facing: 0 },
    bossSpawn: { x: 0, z: 6, facing: Math.PI },
    facilities: [], dummy: null, npcs: [],
  },
};

/**
 * @param {string} id 'town' | 'arena_valder' | 'arena_fenrir' | 'arena_nihil'
 * @returns {WorldDef} 없는 id면 undefined
 */
export function getWorld(id) {
  return WORLDS[id];
}
