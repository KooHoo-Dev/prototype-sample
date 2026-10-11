// OWNER: P2 — 계약 §6.8 · §3.10 · §2.2
// STUB — W0 에 완성으로 낸다(§3.10 그대로 · stats = computeStats · hooks 는 실제 함수 import — 스텁이면 no-op). W1 에서 P2 가 이어 쓴다.
// SimCtx 만들기 · refreshStats. ctx.hooks 는 sim 패키지 사이 역방향 호출(아래 → 위)의 유일한 통로다.

import { EV } from '../core/events.js';
import { makeRng } from '../core/rng.js';
import { SpatialHash } from '../core/spatialHash.js';
import { computeStats } from './loot/stats.js';
import { onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn } from './monsters/monsters.js';
import { globeMods, onPlayerKill } from './player/equipHooks.js';
import { onPlayerDamaged } from './player/actions.js';
import { killPlayer } from './rift.js';
import { createFlow } from './world/flow.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */

/** 공간 해시 칸 크기(m) */
const SPACE_CELL = 2;

/**
 * §3.10 SimCtx — emit 은 state.events 에 · hooks = §3.10 목록 · monVer 0 · 균열 장면이면 ctx.flow = createFlow(map)
 * @param {GameState} state @param {{map?:MapData|null, riftMap?:MapData|null}} [opts]
 * @returns {SimCtx}
 */
export function createCtx(state, { map = null, riftMap = null } = {}) {
  /** @type {SimCtx} */
  const ctx = {
    state,
    map,
    riftMap: riftMap ?? (state.scene === 'rift' ? map : null),
    flow: null,
    space: new SpatialHash(SPACE_CELL),
    monVer: 0,
    stats: computeStats(state.char),
    rng: {
      combat: makeRng(state.rng.combat),
      loot: makeRng(state.rng.loot),
      ai: makeRng(state.rng.ai),
      shop: makeRng(state.rng.shop),
    },
    emit: (name, payload = {}) => { state.events.push({ name, payload }); },
    nextId: () => state.nextId++,
    newItemId: () => 'i' + state.account.nextItemId++,
    refreshStats: () => {
      const s = computeStats(state.char);
      ctx.stats = s;
      const p = state.player;
      if (state.char) {
        p.lifeMax = s.lifeMax;
        p.resourceMax = s.resourceMax;
        if (p.life > p.lifeMax) p.life = p.lifeMax;
        if (p.resource > p.resourceMax) p.resource = p.resourceMax;
      }
      ctx.emit(EV.STATS_CHANGED, { sheetDps: s.sheetDps, lifeMax: s.lifeMax, armor: s.armor });
    },
    hooks: {
      onMonSpawn,
      onMonDamaged,
      onMonDeath,
      onMonHitPlayer,
      onPlayerKill,
      onGlobe: globeMods,
      onPlayerDamaged,
      onPlayerKilled: killPlayer,
    },
    dev: {},
  };
  if (state.scene === 'rift' && map) ctx.flow = createFlow(map);
  return ctx;
}
