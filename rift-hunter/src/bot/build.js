// OWNER: P15 — 계약 §12.1 「마을 정비(스킬)」 · 「레벨 선택」 · §7.13 PRESETS
// 스킬 포인트 배분(프리셋 순서 · 무작위 배분) · 스킬 바 · 균열 레벨 선택. 순수 함수 + 봇의 명령 호출(sim 공개 명령만).

import { nodesOf } from '../data/index.js';
import { PRESETS } from '../data/presets.js';
import { canLearn, pointsFree } from '../sim/progression/progress.js';

/** @typedef {import('../types.js').CharacterState} CharacterState */
/** @typedef {import('../types.js').ClassId} ClassId */

/** 무작위 배분 빌드(측정 「스킬 트리가 의미 있다」)의 preset 값 — 프리셋 0 · 1 밖의 내부 값 */
export const RANDOM_BUILD = -1;

/** 그 클래스 · 번호의 프리셋(없으면 null — 무작위 배분) @param {ClassId} cls @param {number} preset */
export function presetOf(cls, preset) {
  if (preset === RANDOM_BUILD) return null;
  const list = PRESETS[cls] ?? [];
  return list[Math.max(0, Math.min(list.length - 1, Math.floor(Number(preset) || 0)))] ?? null;
}

/**
 * 다음에 찍을 노드(순수 · rng 는 무작위 배분만 쓴다). 프리셋: order 를 앞에서부터 따라가며 「그 순서까지 찍혀야 할 랭크」에 못 미치는 첫 노드
 * (찍을 수 없으면 다음 — 캐릭터가 순서에서 벗어나 있어도 이어 간다). 프리셋에 남은 것이 없거나 무작위 배분이면 찍을 수 있는 노드 중 고르게.
 * @param {CharacterState} char @param {number} preset @param {{int:(a:number, b:number) => number}|null} rng
 * @returns {string|null}
 */
export function nextSkillPoint(char, preset, rng) {
  if (!char || pointsFree(char) <= 0) return null;
  const P = presetOf(char.cls, preset);
  const ranks = char.skills?.ranks ?? {};
  if (P) {
    /** @type {Record<string, number>} */
    const want = {};
    for (const id of P.order) {
      want[id] = (want[id] ?? 0) + 1;
      if (want[id] > (ranks[id] ?? 0) && canLearn(char, id).ok) return id;
    }
  }
  const cands = [];
  for (const n of nodesOf(char.cls)) if (canLearn(char, n.id).ok) cands.push(n.id);
  if (!cands.length) return null;
  if (P || !rng) return cands[0];
  return cands[rng.int(0, cands.length - 1)];
}

/**
 * 남은 포인트를 모두 찍는다(sim.learnSkill) → 찍은 노드 ID 목록. 프리셋이면 바를 preset.bar 로 맞춘다(배운 액티브만 · sim.setSkillBar).
 * @param {any} bot Bot @returns {string[]}
 */
export function allocatePoints(bot) {
  const sim = bot.sim;
  const ch = sim.state.char;
  /** @type {string[]} */
  const learned = [];
  if (!ch) return learned;
  for (let guard = 0; guard < 40 && pointsFree(ch) > 0; guard++) {
    const id = nextSkillPoint(ch, bot.preset, bot.rng);
    if (!id) break;
    const r = sim.learnSkill(id);
    if (!r || !r.ok) break;
    learned.push(id);
  }
  syncBar(bot);
  return learned;
}

/** 프리셋 바 맞추기 — preset.bar[i]가 배운 액티브이고 그 칸에 없으면 놓는다(무작위 배분은 learnSkill 의 자동 배치 그대로) @param {any} bot */
export function syncBar(bot) {
  const ch = bot.sim.state.char;
  const P = ch ? presetOf(ch.cls, bot.preset) : null;
  if (!ch || !P) return;
  const ranks = ch.skills?.ranks ?? {};
  for (let i = 0; i < P.bar.length; i++) {
    const id = P.bar[i];
    if (!id || !((ranks[id] ?? 0) >= 1)) continue;
    if (ch.skills.bar[i] === id) continue;
    bot.sim.setSkillBar(i, id);
  }
}

/**
 * 균열 레벨 선택(§12.1) — challenge: 늘 해금 최고 / basic · noDodge: 첫 판 1 · 직전 판(char.records[0])이 완료 · 사망 0 · timeSec ≤ upMaxSec 이면 +1 ·
 * 사망 ≥ downDeaths 또는 붕괴면 −1(최소 1) · 그 밖(포기 포함)은 같은 레벨. 늘 [1, riftUnlocked]. override 가 있으면 그 레벨(측정 — 해금 안으로 자른다).
 * @param {'basic'|'noDodge'|'challenge'} strategy @param {CharacterState} char @param {{upMaxSec:number, downDeaths:number}} params
 * @param {number|null} [override]
 * @returns {number}
 */
export function chooseLevel(strategy, char, params, override = null) {
  const top = Math.max(1, Math.floor(char?.riftUnlocked ?? 1));
  const clampL = (L) => Math.max(1, Math.min(top, Math.floor(L)));
  if (override !== null && override !== undefined && Number.isFinite(override)) return clampL(override);
  if (strategy === 'challenge') return top;
  const last = char?.records?.[0];
  if (!last || !Number.isFinite(last.level)) return 1;
  let L = last.level;
  if (last.result === 'complete' && last.deaths === 0 && last.timeSec <= params.upMaxSec) L += 1;
  else if (last.result === 'collapse' || last.deaths >= params.downDeaths) L -= 1;
  return clampL(L);
}
