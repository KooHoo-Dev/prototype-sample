// OWNER: P6 — 계약 §6.11 · §7.11 · §7.3
// 경험치 · 레벨 · 스킬 트리 규칙 · 스킬 바 · 균열 해금 · 최고 기록 · 판 기록 · 균열석 미리보기.
// 판 경험치 집계(rift.stats.xp · meter.runXp)는 P2 가 grantXp 결과의 amount 로 더한다(NOTES-P2) — 여기서는 건드리지 않는다.
// 완료 보너스 경험치도 P2(finishRift)가 grantXp 로 준다 — completeRun 은 경험치를 주지 않는다.

import { EV } from '../../core/events.js';
import { LEVEL_CAP } from '../../core/constants.js';
import { GUARDIANS_BY_ID, MONSTERS_BY_ID, RANKS_BY_ID, SKILL_NODES_BY_ID } from '../../data/index.js';
import { ECON, XP } from '../../data/economy.js';
import { RIFT, riftRow } from '../../data/rift.js';
import { TREE } from '../../data/skills.js';
import { computeStats } from '../loot/stats.js';
import { syncSummary } from './character.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').Result} Result */
/** @typedef {import('../../types.js').XpResult} XpResult */

/** @param {string} reason @param {Record<string, number|string>} [params] */
const fail = (reason, params) => (params ? { ok: /** @type {false} */ (false), reason, params } : { ok: /** @type {false} */ (false), reason });
/** 정수로 자른 0 이상의 양(NaN · 음수 → 0) @param {any} v */
const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

// ───────────────────────── 경험치 ─────────────────────────

/** 레벨 n → n+1 필요량(캡이면 Infinity — 상태에 넣지 않는다) — n ≤ 3 은 XP.reqEarly · 그 뒤 round(a × g^(n−1)) @param {number} level */
export function xpReq(level) {
  const n = Math.max(1, Math.floor(Number(level)) || 1);
  if (n >= LEVEL_CAP) return Infinity;
  if (n <= XP.reqEarly.length) return XP.reqEarly[n - 1];
  return Math.round(XP.req.a * XP.req.g ** (n - 1));
}

/** XP 이벤트 · XpResult 의 toNext(캡이면 null) @param {number} level */
function toNextOf(level) {
  const r = xpReq(level);
  return Number.isFinite(r) ? r : null;
}

/**
 * 처치 경험치(순수 · §7.11) = round(XP.base × type.xp × rank.xp × riftRow(monLevel).xpMul × diffMul × (1 + xpPct))
 * diffMul(d = 캐릭터 레벨 − 몬스터 레벨): d > 12 → max(0.3, 1 − 0.1 × (d − 12)) · d < 0 → min(1.5, 1 + 0.1 × −d) · 그 밖 1.
 * xpPct 는 PlayerStats 단위(0..1). flags.noXp · 모르는 종류 · 등급이면 0.
 * @param {import('../../types.js').MonsterState} mon @param {number} charLevel @param {number} xpPct @returns {number}
 */
export function xpForKill(mon, charLevel, xpPct) {
  if (!mon || mon.flags?.noXp) return 0;
  const def = hasOwn(MONSTERS_BY_ID, mon.typeId) ? MONSTERS_BY_ID[mon.typeId] : hasOwn(GUARDIANS_BY_ID, mon.typeId) ? GUARDIANS_BY_ID[mon.typeId] : null;
  const rank = hasOwn(RANKS_BY_ID, mon.rank) ? RANKS_BY_ID[mon.rank] : null;
  if (!def || !rank) return 0;
  const monLevel = Math.max(1, Math.floor(mon.level) || 1);
  const d = (Math.floor(charLevel) || 1) - monLevel;
  const D = XP.diff;
  let diffMul = 1;
  if (d > D.penaltyFrom) diffMul = Math.max(D.penaltyMin, 1 - D.penaltyStep * (d - D.penaltyFrom));
  else if (d < 0) diffMul = Math.min(1 + D.bonusMax, 1 + D.bonusStep * -d);
  const pct = typeof xpPct === 'number' && Number.isFinite(xpPct) && xpPct > 0 ? xpPct : 0;
  const v = XP.base * (def.xp ?? 0) * (rank.xp ?? 0) * riftRow(monLevel).xpMul * diffMul * (1 + pct);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * 경험치 주기 — 여러 레벨을 한 번에 올릴 수 있다 · 캡(30)에 닿으면 남은 것은 버린다(amount = 실제로 쌓인 양).
 * 레벨업이면 refreshStats · 생명 · 자원 가득(쓰러져 있으면 그대로) · 계정 요약 · LEVEL_UP{level, points} · HINT skills(본 적 없으면).
 * 쌓인 게 있으면 XP{amount, level, xp, toNext(캡 null)} · SAVE_REQUEST{char, 'xp' | 'levelUp'}(app 이 1초로 묶는다).
 * @param {SimCtx} ctx @param {number} amount @param {string} source 'kill' | 'complete' | 'debug' … @returns {XpResult}
 */
export function grantXp(ctx, amount, source) {
  const st = ctx.state;
  const ch = st.char;
  if (!ch) return { amount: 0, level: 1, xp: 0, toNext: toNextOf(1), levels: 0 };
  const startLevel = ch.level;
  let n = nonNeg(amount);
  if (ch.level >= LEVEL_CAP) { ch.xp = 0; n = 0; }
  let level = ch.level;
  let xp = (Number.isFinite(ch.xp) && ch.xp > 0 ? ch.xp : 0) + n;
  while (level < LEVEL_CAP && xp >= xpReq(level)) {
    xp -= xpReq(level);
    level += 1;
  }
  let applied = n;
  if (level >= LEVEL_CAP) { applied = n - xp; xp = 0; }
  if (applied < 0) applied = 0;
  ch.level = level;
  ch.xp = xp;
  ch.xpTotal = (Number.isFinite(ch.xpTotal) ? ch.xpTotal : 0) + applied;
  const levels = level - startLevel;
  const toNext = toNextOf(level);
  if (levels > 0) {
    ctx.refreshStats();
    const p = st.player;
    if (p && !p.dead) {
      p.life = p.lifeMax;
      p.resource = p.resourceMax;
    }
    syncSummary(st);
    ctx.emit(EV.LEVEL_UP, { level, points: pointsFree(ch) });
    if (!ch.hints?.skills) ctx.emit(EV.HINT, { id: 'skills' });
  }
  if (applied > 0 || levels > 0) {
    ctx.emit(EV.XP, { amount: applied, level, xp: ch.xp, toNext });
    ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: levels > 0 ? 'levelUp' : 'xp' });
  }
  return { amount: applied, level, xp: ch.xp, toNext, levels };
}

// ───────────────────────── 스킬 포인트 · 트리 ─────────────────────────

/** 레벨 L 의 총 스킬 포인트 = (L − 1) × TREE.pointsPerLevel(캡 30 → 29) @param {number} level */
export function pointsTotal(level) {
  const L = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(level)) || 1));
  return (L - 1) * TREE.pointsPerLevel;
}
/** 쓴 포인트 = 아는 노드의 랭크 합 @param {CharacterState} char */
export function pointsSpent(char) {
  let n = 0;
  const ranks = char?.skills?.ranks ?? {};
  for (const id of Object.keys(ranks)) {
    const v = ranks[id];
    if (hasOwn(SKILL_NODES_BY_ID, id) && typeof v === 'number' && v > 0) n += v;
  }
  return n;
}
/** 남은 포인트 @param {CharacterState} char */
export function pointsFree(char) { return Math.max(0, pointsTotal(char?.level ?? 1) - pointsSpent(char)); }

/** 노드 랭크(없으면 0) @param {CharacterState|null} char @param {string} nodeId */
function rankOf(char, nodeId) {
  const v = char?.skills?.ranks?.[nodeId];
  return typeof v === 'number' && v > 0 ? v : 0;
}

/** 그 클래스 트리에 쓴 점수(단계 해금 기준) @param {CharacterState} char */
function classSpent(char) {
  let n = 0;
  const ranks = char?.skills?.ranks ?? {};
  for (const id of Object.keys(ranks)) {
    const node = hasOwn(SKILL_NODES_BY_ID, id) ? SKILL_NODES_BY_ID[id] : null;
    if (node && node.cls === char.cls) n += rankOf(char, id);
  }
  return n;
}

/**
 * 찍을 수 있는가 — 'invalid'(모르는 노드) · 'class' · 'maxRank' · 'tier'(params.n = 더 써야 할 점수) · 'req'(변형의 대상 액티브 1랭크) · 'points'
 * @param {CharacterState} char @param {string} nodeId @returns {Result}
 */
export function canLearn(char, nodeId) {
  if (!char) return fail('invalid');
  const node = hasOwn(SKILL_NODES_BY_ID, nodeId) ? SKILL_NODES_BY_ID[nodeId] : null;
  if (!node) return fail('invalid');
  if (node.cls !== char.cls) return fail('class');
  if (rankOf(char, nodeId) >= node.maxRank) return fail('maxRank');
  const need = TREE.tierPoints[node.tier - 1] ?? 0;
  const spent = classSpent(char);
  if (spent < need) return fail('tier', { n: need - spent });
  if (node.req && rankOf(char, node.req) < 1) return fail('req', { nodeId: node.req });
  if (pointsFree(char) < 1) return fail('points');
  return { ok: true };
}

/**
 * 한 랭크를 찍는다(검사 없이 — canLearn 을 통과한 뒤) · 액티브를 처음 배우면(0 → 1) 빈 바 칸 중 가장 앞(0 = 우클릭)에 놓는다(빈 칸이 없으면 놓지 않는다)
 * @param {CharacterState} char @param {string} nodeId @returns {{rank:number, barIdx:number}}
 */
export function applyLearn(char, nodeId) {
  const node = SKILL_NODES_BY_ID[nodeId];
  const rank = rankOf(char, nodeId) + 1;
  char.skills.ranks[nodeId] = rank;
  const bar = char.skills.bar;
  let barIdx = bar.indexOf(nodeId);
  if (node.kind === 'active' && rank === 1 && barIdx < 0) {
    const e = bar.indexOf(null);
    if (e >= 0) { bar[e] = nodeId; barIdx = e; }
  }
  return { rank, barIdx };
}

/**
 * 찍기 — canLearn · 액티브를 처음 배우면 빈 바 칸 중 가장 앞에 자동 배치 · refreshStats · SKILLS{learn} · SAVE
 * @param {SimCtx} ctx @param {string} nodeId @returns {Result & {rank?:number, barIdx?:number}}
 */
export function learnSkill(ctx, nodeId) {
  const ch = ctx.state.char;
  const r = canLearn(ch, nodeId);
  if (!r.ok) return r;
  const { rank, barIdx } = applyLearn(/** @type {CharacterState} */ (ch), nodeId);
  ctx.refreshStats();
  ctx.emit(EV.SKILLS, { reason: 'learn', nodeId, rank });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'skills' });
  return { ok: true, rank, barIdx };
}

/**
 * 바 칸 배정 — 배운 액티브만('notLearned' · 'class' · 액티브가 아니면 'invalid') · null 이면 비움 · 다른 칸에 있으면 자리 바꿈 · SKILLS{bar} · SAVE
 * @param {SimCtx} ctx @param {number} idx 0..4(0 = 우클릭) @param {string|null} nodeId @returns {Result}
 */
export function setSkillBar(ctx, idx, nodeId) {
  const ch = ctx.state.char;
  if (!ch) return fail('invalid');
  const bar = ch.skills.bar;
  if (!Number.isInteger(idx) || idx < 0 || idx >= bar.length) return fail('invalid');
  if (nodeId === null || nodeId === undefined) {
    bar[idx] = null;
  } else {
    const node = hasOwn(SKILL_NODES_BY_ID, nodeId) ? SKILL_NODES_BY_ID[nodeId] : null;
    if (!node || node.kind !== 'active') return fail('invalid');
    if (node.cls !== ch.cls) return fail('class');
    if (rankOf(ch, nodeId) < 1) return fail('notLearned');
    const j = bar.indexOf(nodeId);
    if (j === idx) return { ok: true };
    if (j >= 0) bar[j] = bar[idx] ?? null;
    bar[idx] = nodeId;
  }
  ctx.emit(EV.SKILLS, { reason: 'bar', nodeId: nodeId ?? null, rank: nodeId ? rankOf(ch, nodeId) : 0 });
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'skills' });
  return { ok: true };
}

/**
 * 찍기 전 · 후 시트(순수) — 찍을 수 없으면 ok false · reason · statsAfter = statsBefore
 * @param {CharacterState} char @param {string} nodeId
 */
export function previewLearn(char, nodeId) {
  const statsBefore = computeStats(char);
  const rankBefore = rankOf(char, nodeId);
  const r = canLearn(char, nodeId);
  if (!r.ok) return { ok: false, reason: r.reason, statsBefore, statsAfter: statsBefore, rankBefore, rankAfter: rankBefore };
  const after = { ...char, skills: { ...char.skills, ranks: { ...char.skills.ranks, [nodeId]: rankBefore + 1 } } };
  return { ok: true, statsBefore, statsAfter: computeStats(after), rankBefore, rankAfter: rankBefore + 1 };
}

// ───────────────────────── 해금 · 기록 ─────────────────────────

/**
 * 새 riftUnlocked(순수 · §7.3) = max(지금, min(maxLevel, L + (사망 0 ? unlockNoDeath : unlockClear))) — 줄지 않는다
 * @param {CharacterState} char @param {number} level @param {number} deaths
 */
export function unlockAfter(char, level, deaths) {
  const cur = Math.max(1, Math.floor(char?.riftUnlocked) || 1);
  const L = Math.max(1, Math.floor(level) || 1);
  const gain = Number(deaths) === 0 ? RIFT.unlockNoDeath : RIFT.unlockClear;
  return Math.max(cur, Math.min(RIFT.maxLevel, L + gain));
}

/**
 * 균열 완료 — 해금(UNLOCK · 오를 때만) · 최고 기록(더 빠르면 · 같으면 사망이 적으면) · recordRun · 계정 요약 · SAVE{char, 'complete'}.
 * result 가 'complete' 가 아니면 기록만 한다.
 * @param {SimCtx} ctx @param {import('../../types.js').RunSummary} summary
 */
export function completeRun(ctx, summary) {
  const st = ctx.state;
  const ch = st.char;
  if (!ch || !summary) return;
  if (summary.result === 'complete') {
    const from = ch.riftUnlocked;
    const to = unlockAfter(ch, summary.level, summary.deaths);
    if (to > from) {
      ch.riftUnlocked = to;
      ctx.emit(EV.UNLOCK, { riftUnlocked: to, from });
    }
    const t = summary.timeSec;
    const d = Math.max(0, Math.floor(summary.deaths) || 0);
    if (typeof t === 'number' && Number.isFinite(t) && t >= 0) {
      const key = String(Math.max(1, Math.floor(summary.level) || 1));
      const best = ch.best[key];
      if (!best || t < best.timeSec || (t === best.timeSec && d < best.deaths)) ch.best[key] = { timeSec: t, deaths: d };
    }
  }
  recordRun(ctx, summary);
  syncSummary(st);
  ctx.emit(EV.SAVE_REQUEST, { scope: 'char', reason: 'complete' });
}

/**
 * 판 기록 — records 앞에(RunRecord = 요약 사본 + at(그때의 playSec) · charLevel) · ECON.recordsMax(200)개 유지
 * @param {SimCtx} ctx @param {import('../../types.js').RunSummary} summary
 */
export function recordRun(ctx, summary) {
  const ch = ctx.state.char;
  if (!ch || !summary || typeof summary !== 'object') return;
  /** @type {import('../../types.js').RunRecord} */
  const rec = JSON.parse(JSON.stringify(summary));
  rec.at = Number.isFinite(ch.playSec) ? ch.playSec : 0;
  rec.charLevel = ch.level;
  ch.records.unshift(rec);
  if (ch.records.length > ECON.recordsMax) ch.records.length = ECON.recordsMax;
}

/**
 * 균열석 미리보기(순수) — riftRow 그대로 · 최고 기록 · 열림 여부
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
