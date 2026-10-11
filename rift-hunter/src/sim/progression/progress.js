// OWNER: P6 — 계약 §6.11 · §7.11 · §7.3
// STUB — W0 에 완성으로 내는 것: xpReq(최소 부트 · HUD 경험치 바) · pointsTotal/Spent/Free · previewRift(riftRow 그대로) · 나머지는 W1 에서 P6 이 채운다
// 경험치 · 레벨 · 스킬 트리 · 스킬 바 · 해금 · 기록.

import { LEVEL_CAP } from '../../core/constants.js';
import { XP } from '../../data/economy.js';
import { riftRow } from '../../data/rift.js';
import { TREE } from '../../data/skills.js';
import { computeStats } from '../loot/stats.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Result} Result */

const stub = () => ({ ok: /** @type {false} */ (false), reason: 'stub' });

/** 레벨 n → n+1 필요량(캡이면 Infinity) — n ≤ 3 은 XP.reqEarly · 그 뒤 round(a × g^(n−1)) @param {number} level */
export function xpReq(level) {
  const n = Math.max(1, Math.floor(level));
  if (n >= LEVEL_CAP) return Infinity;
  if (n <= XP.reqEarly.length) return XP.reqEarly[n - 1];
  return Math.round(XP.req.a * XP.req.g ** (n - 1));
}

/** STUB — 처치 경험치(§7.11) @param {import('../../types.js').MonsterState} mon @param {number} charLevel @param {number} xpPct @returns {number} */
export function xpForKill(mon, charLevel, xpPct) { return 0; }

/**
 * STUB — 경험치 주기 · 레벨업
 * @param {SimCtx} ctx @param {number} amount @param {string} source @returns {import('../../types.js').XpResult}
 */
export function grantXp(ctx, amount, source) {
  const ch = ctx.state.char;
  const level = ch?.level ?? 1;
  const req = xpReq(level);
  return { amount: 0, level, xp: ch?.xp ?? 0, toNext: Number.isFinite(req) ? req : null, levels: 0 };
}

/** 레벨 L 의 총 스킬 포인트 = (L − 1) × TREE.pointsPerLevel @param {number} level */
export function pointsTotal(level) { return Math.max(0, Math.floor(level) - 1) * TREE.pointsPerLevel; }
/** 쓴 포인트 = 랭크 합 @param {CharacterState} char */
export function pointsSpent(char) {
  let n = 0;
  for (const v of Object.values(char?.skills?.ranks ?? {})) n += v > 0 ? v : 0;
  return n;
}
/** 남은 포인트 @param {CharacterState} char */
export function pointsFree(char) { return Math.max(0, pointsTotal(char?.level ?? 1) - pointsSpent(char)); }

/** STUB @param {CharacterState} char @param {string} nodeId @returns {Result} */
export function canLearn(char, nodeId) { return stub(); }
/** STUB @param {SimCtx} ctx @param {string} nodeId @returns {Result} */
export function learnSkill(ctx, nodeId) { return stub(); }
/** STUB @param {SimCtx} ctx @param {number} idx @param {string|null} nodeId @returns {Result} */
export function setSkillBar(ctx, idx, nodeId) { return stub(); }

/** STUB — 찍기 전 · 후 시트 @param {CharacterState} char @param {string} nodeId */
export function previewLearn(char, nodeId) {
  const stats = computeStats(char);
  const rank = char?.skills?.ranks?.[nodeId] ?? 0;
  return { ok: false, statsBefore: stats, statsAfter: stats, rankBefore: rank, rankAfter: rank };
}

/** STUB — 새 riftUnlocked(§7.3) — W0: 그대로 @param {CharacterState} char @param {number} level @param {number} deaths */
export function unlockAfter(char, level, deaths) { return char?.riftUnlocked ?? 1; }
/** STUB @param {SimCtx} ctx @param {import('../../types.js').RunSummary} summary */
export function completeRun(ctx, summary) {}
/** STUB @param {SimCtx} ctx @param {import('../../types.js').RunSummary} summary */
export function recordRun(ctx, summary) {}

/**
 * 균열석 미리보기 — riftRow 그대로 · 최고 기록 · 열림 여부
 * @param {CharacterState|null} char @param {number} level @returns {import('../../types.js').RiftPreview}
 */
export function previewRift(char, level) {
  const row = riftRow(level);
  return {
    level: row.level, monLevel: row.monLevel, ilvl: row.ilvl,
    hpMul: row.hpMul, dmgMul: row.dmgMul, goldMul: row.goldMul, xpMul: row.xpMul,
    rarityMul: { ...row.rarityMul },
    champAffixes: row.champAffixes, eliteAffixes: row.eliteAffixes,
    best: char?.best?.[String(row.level)] ?? null,
    unlocked: row.level <= (char?.riftUnlocked ?? 1),
  };
}
