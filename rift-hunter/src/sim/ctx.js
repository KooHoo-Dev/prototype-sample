// OWNER: P2 — 계약 §6.8 · §3.10 · §2.2
// SimCtx 만들기 · refreshStats. ctx.hooks 는 sim 패키지 사이 역방향 호출(아래 → 위)의 유일한 통로다(§3.10 의 여덟이 정본).
// ctx 는 상태가 아니다 — 맵 · 흐름장 · 공간 해시 · 시트 · 난수 래퍼를 담는다(같은 state 로 다시 만들 수 있다).

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
    // stats = computeStats(char) · player.lifeMax/resourceMax 갱신(비율 유지 아님 — 현재 값은 max 로 자르기만) · STATS_CHANGED
    refreshStats: () => {
      const s = computeStats(state.char);
      ctx.stats = s;
      const p = state.player;
      if (state.char) {
        if (Number.isFinite(s.lifeMax) && s.lifeMax > 0) p.lifeMax = s.lifeMax;
        if (Number.isFinite(s.resourceMax) && s.resourceMax > 0) p.resourceMax = s.resourceMax;
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
