// OWNER: P1 — 계약 §6.7 · §5.4 · §8.4
// STUB — W1 에서 P1 이 채운다(스킬 동작 14 · 변형 · 전설 패치 · describeSkill · skillReady).
// W0: SKILL_BEHAVIORS 키 전부 no-op · skillParams = 행의 params 복사(패치 없음) · describeSkill · skillReady 는 중립 값

import { getSkillDef } from '../../data/index.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').PlayerStats} PlayerStats */

const none = () => ({
  /** @returns {boolean} 시작했다 */
  start(ctx, node, rank, cast) { return false; },
  hit(ctx, node, rank, cast) {},
});

/** 동작 표 — {start(ctx, node, rank, cast) → boolean, hit(ctx, node, rank, cast), tick?, end?} */
export const SKILL_BEHAVIORS = {
  meleeBasic: none(),
  boltBasic: none(),
  cone: none(),
  quake: none(),
  dash: none(),
  spin: none(),
  buff: none(),
  leap: none(),
  fireball: none(),
  meteor: none(),
  nova: none(),
  shield: none(),
  chain: none(),
  blink: none(),
};

/**
 * STUB — 행의 skill.params + 찍은 변형의 patch + 낀 전설(패치형 · 그 스킬)의 patch → 새 객체. W0: 행의 params 사본
 * @param {SimCtx} ctx @param {string} nodeId @returns {Object}
 */
export function skillParams(ctx, nodeId) {
  try {
    return JSON.parse(JSON.stringify(getSkillDef(nodeId).params ?? {}));
  } catch {
    return {};
  }
}

/**
 * STUB — 순수 · ui 툴팁 · 스킬 패널 전/후(nodeId 는 노드 ID 또는 'bash' · 'magicBolt')
 * @param {PlayerStats} stats @param {string} nodeId @param {number} rank
 * @returns {{coefPct:number, dmgMin:number, dmgMax:number, cost:number, cd:number, range:number, radius:number, extra:Object}}
 */
export function describeSkill(stats, nodeId, rank) {
  return { coefPct: 100, dmgMin: 0, dmgMax: 0, cost: 0, cd: 0, range: 0, radius: 0, extra: {} };
}

/**
 * STUB — 순수 · HUD 쿨다운 부채(초)
 * @param {import('../../types.js').GameState} state @param {PlayerStats} stats @param {string} nodeId
 * @returns {{canAfford:boolean, cooldownLeft:number, cooldownTotal:number, ready:boolean}}
 */
export function skillReady(state, stats, nodeId) {
  return { canAfford: true, cooldownLeft: 0, cooldownTotal: 0, ready: true };
}
