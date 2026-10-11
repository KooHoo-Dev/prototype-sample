// OWNER: P3 — 계약 §6.9 · §7.5c · §5.14
// STUB — W1 에서 P3 이 채운다(팩 구성 · 배치 · 정예 이름 · 하수인 공유 · 균열 채우기 결정성).
// W0: 각 팩 자리에 그 자리 종류대로 첫 몬스터 종류(구울) 6 · 챔피언 3 · 정예 1 + 하수인 3 을 잠든 채로(최소 부트 · 화면 확인용)

import { MONSTERS } from '../../data/monsters.js';
import { GUARDIANS } from '../../data/guardians.js';
import { nearestWalkable } from '../world/nav.js';
import { spawnMonster } from './spawn.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */

/** STUB 배치 수(W0 — 화면 확인용) */
const STUB_COUNT = { normal: 6, champion: 3, elite: 1, minions: 3, ringR: 2.5 };

/**
 * STUB — map.packSlots → 팩 · 몬스터(잠든 채) · rift.guardianType
 * @param {SimCtx} ctx
 */
export function populateRift(ctx) {
  const st = ctx.state;
  const rift = st.rift;
  const map = ctx.riftMap ?? ctx.map;
  if (!rift || !map) return;
  rift.guardianType = GUARDIANS[0].id;
  const typeId = MONSTERS[0].id;
  for (const slot of map.packSlots ?? []) {
    /** @type {import('../../types.js').PackState} */
    const pack = { id: ctx.nextId(), kind: slot.kind, memberIds: [], awake: false, nextHazardAt: -1, fled: false, anchor: { x: slot.x, z: slot.z } };
    rift.packs.push(pack);
    /** @type {Array<{rank:import('../../types.js').MonRank}>} */
    const members = [];
    if (slot.kind === 'normal') for (let i = 0; i < STUB_COUNT.normal; i++) members.push({ rank: 'normal' });
    else if (slot.kind === 'champion') for (let i = 0; i < STUB_COUNT.champion; i++) members.push({ rank: 'champion' });
    else {
      members.push({ rank: 'elite' });
      for (let i = 0; i < STUB_COUNT.minions; i++) members.push({ rank: 'minion' });
    }
    members.forEach((m, i) => {
      const a = (i / members.length) * Math.PI * 2;
      const r = i === 0 && m.rank === 'elite' ? 0 : STUB_COUNT.ringR;
      const p = nearestWalkable(map, slot.x + Math.sin(a) * r, slot.z + Math.cos(a) * r, 3) ?? { x: slot.x, z: slot.z };
      const mon = spawnMonster(ctx, { typeId, rank: m.rank, level: rift.level, packId: pack.id, x: p.x, z: p.z, facing: a, awake: false });
      if (m.rank === 'elite') mon.name = eliteName(ctx.rng.ai);
      pack.memberIds.push(mon.id);
    });
  }
}

/**
 * STUB — 디버그 · 측정용 팩 생성 → packId. W0: -1
 * @param {SimCtx} ctx @param {{typeId:string, rank:string, affixes?:string[]|null, x:number, z:number, awake?:boolean}} opts @returns {number}
 */
export function spawnPack(ctx, { typeId, rank, affixes = null, x, z, awake = false }) {
  return -1;
}

/** STUB — 배제 규칙 지키며 가중치로 → string[]. W0: [] @param {import('../../types.js').Rng} rng @param {any} typeDef @param {number} count @param {number} level @returns {string[]} */
export function rollAffixes(rng, typeDef, count, level) {
  return [];
}

/** STUB — 정예 이름 [elite.a.N, elite.b.M]. W0: 0번 @param {import('../../types.js').Rng} rng @returns {string[]} */
export function eliteName(rng) {
  return ['elite.a.0', 'elite.b.0'];
}
