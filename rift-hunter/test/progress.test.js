// OWNER: P6 — 계약 §12.2 · §6.11 · §7.11 · §7.3 (경험치 곡선 · 레벨 차 · 캡 · 포인트 · 단계 · req · 바 자동 배치 · 해금 · 기록 · 개발용 캐릭터)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EQUIP_SLOTS, LEVEL_CAP } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { ECON, XP } from '../src/data/economy.js';
import { BASES_BY_ID, SKILL_NODES_BY_ID } from '../src/data/index.js';
import { RANKS } from '../src/data/monsters.js';
import { PRESETS } from '../src/data/presets.js';
import { RIFT, earlyDmgMul, earlyHpMul, riftRow } from '../src/data/rift.js';
import { monsterStats } from '../src/sim/monsters/spawn.js';
import { TREE } from '../src/data/skills.js';
import { computeStats } from '../src/sim/loot/stats.js';
import { makeDevCharacter } from '../src/sim/progression/dev.js';
import {
  canLearn, completeRun, grantXp, learnSkill, pointsFree, pointsSpent, pointsTotal, previewLearn, previewRift, recordRun, setSkillBar,
  unlockAfter, xpForKill, xpReq,
} from '../src/sim/progression/progress.js';
import { assertFiniteDeep, countEvents, makeTestChar, makeTestCtx, makeTestState } from './helpers.js';

function setup({ cls = 'warrior', scene = 'town', level = 1 } = {}) {
  const state = makeTestState({ scene, cls, level });
  const ctx = makeTestCtx(state);
  const calls = { refresh: 0 };
  ctx.refreshStats = () => {
    calls.refresh++;
    ctx.stats = computeStats(state.char);
    state.player.lifeMax = ctx.stats.lifeMax;
    state.player.resourceMax = ctx.stats.resourceMax;
  };
  return { state, ctx, ch: state.char, calls };
}
const mon = (typeId, rank, level, flags = {}) => ({ typeId, rank, level, flags: { noXp: false, noDrops: false, noGauge: false, revived: false, ...flags } });

// ───────────────────────── 경험치 ─────────────────────────

// W1 수정(NOTES-W1FIX): reqEarly [200, 500, 900] → [60, 300, 700] — 누적 레벨 10 = 16,244 − 540 = 15,704 · 30 = 412,126(계약 §7.11)
test('xpReq: §7.11 표 그대로(reqEarly 60 · 300 · 700 → round(1300 × 1.15^(n−1)) — 밸런스 게이트 a 1100 → 1300) · 누적 레벨 10 = 18,368 · 30 = 486,866 · 캡은 Infinity', () => {
  const table = [60, 300, 700, 1977, 2274, 2615, 3007, 3458, 3977, 4573, 5259, 6048, 6955, 7999, 9198, 10578, 12165, 13990, 16088, 18501, 21276,
    24468, 28138, 32359, 37213, 42795, 49214, 56596, 65085];
  assert.equal(table.length, LEVEL_CAP - 1);
  for (let n = 1; n < LEVEL_CAP; n++) assert.equal(xpReq(n), table[n - 1], `레벨 ${n}`);
  assert.equal(xpReq(LEVEL_CAP), Infinity);
  assert.equal(xpReq(99), Infinity);
  assert.equal(xpReq(0), table[0], '1 보다 작으면 1');
  let cum = 0;
  for (let n = 1; n < 10; n++) cum += xpReq(n);
  assert.equal(cum, 18368);
  for (let n = 10; n < 30; n++) cum += xpReq(n);
  assert.equal(cum, 486866);
});

test('xpForKill: round(5 × 종류 × 등급 × xpMul(몬스터 레벨) × 레벨 차 × (1 + xpPct)) · d > 12 감점(최소 0.3) · d < 0 가점(최대 1.5)', () => {
  const nx = RANKS.find(r => r.id === 'normal').xp;   // 피드백 2: 데이터의 일반 등급 경험치(RANKS.normal.xp)를 읽는다
  assert.equal(xpForKill(mon('ghoul', 'normal', 1), 1, 0), Math.round(5 * nx));
  assert.equal(xpForKill(mon('ghoul', 'champion', 1), 1, 0), 20);
  assert.equal(xpForKill(mon('ghoul', 'elite', 1), 1, 0), 60);
  assert.equal(xpForKill(mon('boneGiant', 'guardian', 1), 1, 0), 300, '수호자(GUARDIANS 표)');
  assert.equal(xpForKill(mon('ghoul', 'spawn', 1), 1, 0), 0);
  const L = 7;
  const base = 5 * nx * riftRow(L).xpMul;
  assert.equal(xpForKill(mon('ghoul', 'normal', L), L + 12, 0), Math.round(base), 'd = 12 는 감점 없음(정상 경로 d = 9~11)');
  assert.equal(xpForKill(mon('ghoul', 'normal', L), L + 13, 0), Math.round(base * 0.9));
  assert.equal(xpForKill(mon('ghoul', 'normal', L), L + 15, 0), Math.round(base * 0.7));
  assert.equal(xpForKill(mon('ghoul', 'normal', 1), 30, 0), Math.round(5 * nx * XP.diff.penaltyMin), '최소 0.3');
  assert.equal(xpForKill(mon('ghoul', 'normal', L), L - 2, 0), Math.round(base * 1.2));
  assert.equal(xpForKill(mon('ghoul', 'normal', 20), 1, 0), Math.round(5 * nx * riftRow(20).xpMul * 1.5), '가점 상한 1.5');
  assert.equal(xpForKill(mon('ghoul', 'normal', L), L, 0.1), Math.round(base * 1.1), 'xpPct 는 0..1');
  assert.equal(xpForKill(mon('ghoul', 'normal', 1, { noXp: true }), 1, 0), 0);
  assert.equal(xpForKill(mon('nope', 'normal', 1), 1, 0), 0);
  assert.equal(xpForKill(mon('ghoul', 'normal', 1), 1, NaN), Math.round(5 * nx));
  assert.equal(xpForKill(null, 1, 0), 0);
});

test('grantXp: 레벨업(여러 단계 한 번에) · refreshStats · 생명 · 자원 가득 · LEVEL_UP{level, points} · HINT skills · XP · SAVE · 판 집계는 건드리지 않는다', () => {
  const { ctx, ch, state, calls } = setup({ scene: 'rift' });
  state.player.life = 1;
  state.player.resource = 0;
  // W1 수정(NOTES-W1FIX): reqEarly 값에서 잡는다(60 · 300 · 700)
  const [q1, q2, q3] = XP.reqEarly;
  const a = q1 - 10;
  let r = grantXp(ctx, a, 'kill');
  assert.deepEqual(r, { amount: a, level: 1, xp: a, toNext: q1, levels: 0 });
  assert.equal(calls.refresh, 0);
  assert.equal(countEvents(ctx.events, EV.LEVEL_UP), 0);
  assert.deepEqual(ctx.events.find(e => e.name === EV.XP).payload, { amount: a, level: 1, xp: a, toNext: q1 });
  r = grantXp(ctx, 10 + q2 + q3 + 7, 'complete');
  assert.deepEqual(r, { amount: 10 + q2 + q3 + 7, level: 4, xp: 7, toNext: xpReq(4), levels: 3 });
  assert.equal(ch.xpTotal, q1 + q2 + q3 + 7);
  assert.equal(calls.refresh, 1);
  assert.equal(state.player.life, state.player.lifeMax);
  assert.equal(state.player.resource, state.player.resourceMax);
  assert.deepEqual(ctx.events.find(e => e.name === EV.LEVEL_UP).payload, { level: 4, points: 3 });
  assert.ok(ctx.events.some(e => e.name === EV.HINT && e.payload.id === 'skills'));
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.scope === 'char' && e.payload.reason === 'levelUp'));
  assert.equal(state.account.chars[ch.slot].level, 4, '계정 요약도');
  assert.equal(state.rift.stats.xp, 0, '판 경험치 집계는 P2 가 결과의 amount 로 더한다');
  assert.equal(state.meter.runXp, 0);
  ch.hints.skills = true;
  grantXp(ctx, xpReq(4), 'kill');
  assert.ok(!ctx.events.slice(-4).some(e => e.name === EV.HINT), '본 안내는 다시 내지 않는다');
  assert.deepEqual(grantXp(ctx, -5, 'kill').amount, 0);
  assert.deepEqual(grantXp(ctx, NaN, 'kill').amount, 0);
});

test('grantXp: 캡(30)에 닿으면 남은 것은 버린다 · 캡 뒤는 0 · toNext null · 쓰러져 있으면 생명을 채우지 않는다', () => {
  const { ctx, ch, state } = setup({ level: 29 });
  ch.level = 29;
  ch.xp = 1000;
  const r = grantXp(ctx, 100000, 'debug');
  assert.deepEqual(r, { amount: xpReq(29) - 1000, level: 30, xp: 0, toNext: null, levels: 1 });
  assert.equal(ctx.events.filter(e => e.name === EV.XP).at(-1).payload.toNext, null);
  const n = ctx.events.length;
  assert.deepEqual(grantXp(ctx, 5000, 'kill'), { amount: 0, level: 30, xp: 0, toNext: null, levels: 0 });
  assert.equal(ctx.events.length, n, '쌓인 게 없으면 이벤트도 없다');
  assertFiniteDeep(state);

  const d = setup({ level: 1 });
  d.state.player.dead = true;
  d.state.player.life = 0;
  grantXp(d.ctx, 300, 'kill');
  assert.equal(d.ch.level, 2);
  assert.equal(d.state.player.life, 0);
});

test('첫 판 안에 스킬 3점: 균열 1 한 판(일반 240 · 챔피언 12 · 정예 2 · 하수인 8 · 수호자 · 완료 보너스)의 경험치 ≥ 200 + 500 + 900', () => {
  const { ctx, ch } = setup();
  const kills = [['normal', 240], ['champion', 12], ['elite', 2], ['minion', 8], ['guardian', 1]];
  for (const [rank, n] of kills) {
    for (let i = 0; i < n; i++) grantXp(ctx, xpForKill(mon(rank === 'guardian' ? 'boneGiant' : 'ghoul', rank, 1), ch.level, 0), 'kill');
  }
  grantXp(ctx, Math.round(XP.completeBonus * riftRow(1).xpMul), 'complete');
  assert.ok(ch.level >= 4, `레벨 ${ch.level}`);
  assert.ok(pointsFree(ch) >= 3);
});

// ───────────────────────── 포인트 · 트리 ─────────────────────────

test('pointsTotal · pointsSpent · pointsFree: (L − 1) × 1 · 캡 29', () => {
  assert.equal(pointsTotal(1), 0);
  assert.equal(pointsTotal(2), 1);
  assert.equal(pointsTotal(30), 29);
  assert.equal(pointsTotal(31), 29);
  const ch = makeTestChar({ level: 10, skills: { ranks: { groundStomp: 3, weaponMastery: 2, unknownNode: 5 }, bar: [null, null, null, null, null] } });
  assert.equal(pointsSpent(ch), 5, '모르는 노드는 세지 않는다');
  assert.equal(pointsFree(ch), 4);
});

test('canLearn: class · tier(그 클래스 트리에 쓴 점수 0 · 5 · 10 · 15) · req(변형) · maxRank · points · invalid', () => {
  const ch = makeTestChar({ level: 30 });
  assert.deepEqual(canLearn(ch, 'nope'), { ok: false, reason: 'invalid' });
  assert.deepEqual(canLearn(ch, 'fireball'), { ok: false, reason: 'class' });
  assert.deepEqual(canLearn(ch, 'groundStomp'), { ok: true });
  assert.deepEqual(canLearn(ch, 'earthquake'), { ok: false, reason: 'tier', params: { n: TREE.tierPoints[1] } });
  ch.skills.ranks = { weaponMastery: 5 };
  assert.deepEqual(canLearn(ch, 'earthquake'), { ok: true }, '5점이면 2단계');
  ch.skills.ranks = { weaponMastery: 5, earthquake: 5 };
  assert.deepEqual(canLearn(ch, 'aftershock'), { ok: false, reason: 'req', params: { nodeId: 'groundStomp' } }, '변형은 대상 액티브 1랭크');
  ch.skills.ranks.groundStomp = 1;
  assert.deepEqual(canLearn(ch, 'aftershock'), { ok: true });
  ch.skills.ranks.aftershock = 1;
  assert.deepEqual(canLearn(ch, 'aftershock'), { ok: false, reason: 'maxRank' });
  assert.deepEqual(canLearn(ch, 'groundStomp'), { ok: true });
  const poor = makeTestChar({ level: 2, skills: { ranks: { groundStomp: 1 }, bar: [null, null, null, null, null] } });
  assert.deepEqual(canLearn(poor, 'groundStomp'), { ok: false, reason: 'points' });
  assert.deepEqual(canLearn(null, 'groundStomp'), { ok: false, reason: 'invalid' });
});

test('learnSkill: 액티브를 처음 배우면 빈 바 칸 중 가장 앞(0 = 우클릭부터) · 패시브 · 두 번째 랭크는 놓지 않는다 · 빈칸 없으면 놓지 않는다 · SKILLS · SAVE', () => {
  const { ctx, ch, calls } = setup({ level: 30 });
  ch.level = 30;
  assert.deepEqual(learnSkill(ctx, 'groundStomp'), { ok: true, rank: 1, barIdx: 0 });
  assert.equal(ch.skills.bar[0], 'groundStomp', '첫 액티브는 우클릭 칸 — 첫 판이 기본 공격만으로 끝나지 않는다');
  assert.equal(calls.refresh, 1);
  assert.deepEqual(ctx.events.find(e => e.name === EV.SKILLS).payload, { reason: 'learn', nodeId: 'groundStomp', rank: 1 });
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'skills'));
  assert.deepEqual(learnSkill(ctx, 'groundStomp'), { ok: true, rank: 2, barIdx: 0 });
  assert.deepEqual(learnSkill(ctx, 'weaponMastery'), { ok: true, rank: 1, barIdx: -1 }, '패시브는 바에 놓지 않는다');
  assert.equal(learnSkill(ctx, 'charge').barIdx, 1);
  ch.skills.bar[2] = null;
  assert.equal(learnSkill(ctx, 'warCry').barIdx, 2);
  // 사람이 비운 칸 0 을 다시 채운다(가장 앞의 빈칸)
  ch.skills.bar[0] = null;
  for (let i = 0; i < 3; i++) learnSkill(ctx, 'weaponMastery');
  assert.equal(learnSkill(ctx, 'earthquake').barIdx, 0);
  learnSkill(ctx, 'leap');
  learnSkill(ctx, 'ironSkin');
  for (let i = 0; i < 5; i++) learnSkill(ctx, 'ironSkin');
  learnSkill(ctx, 'whirlwind');
  assert.deepEqual(ch.skills.bar, ['earthquake', 'charge', 'warCry', 'leap', 'whirlwind']);
  ch.skills.ranks.groundStomp = 5;
  ch.skills.bar[4] = 'groundStomp';
  assert.equal(learnSkill(ctx, 'fireball').ok, false);
  // 빈칸 없음
  const before = ch.skills.bar.slice();
  for (let i = 0; i < 5; i++) learnSkill(ctx, 'weaponMastery');
  const r = learnSkill(ctx, 'bloodthirst');
  assert.equal(r.ok, true);
  assert.deepEqual(ch.skills.bar, before);
  const f = learnSkill(ctx, 'tail');
  assert.deepEqual(f, { ok: false, reason: 'invalid' });
  assert.ok(pointsSpent(ch) <= pointsTotal(ch.level));
});

test('setSkillBar: 배운 액티브만 · 다른 칸에 있으면 자리 바꿈 · null 이면 비움 · notLearned · class · invalid', () => {
  const { ctx, ch } = setup({ level: 10 });
  ch.skills.ranks = { groundStomp: 1, charge: 2, weaponMastery: 1 };
  ch.skills.bar = ['groundStomp', 'charge', null, null, null];
  assert.deepEqual(setSkillBar(ctx, 3, 'groundStomp'), { ok: true });
  assert.deepEqual(ch.skills.bar, [null, 'charge', null, 'groundStomp', null]);
  assert.deepEqual(setSkillBar(ctx, 1, 'groundStomp'), { ok: true });
  assert.deepEqual(ch.skills.bar, [null, 'groundStomp', null, 'charge', null], '자리 바꿈');
  assert.deepEqual(setSkillBar(ctx, 1, null), { ok: true });
  assert.equal(ch.skills.bar[1], null);
  assert.deepEqual(setSkillBar(ctx, 0, 'warCry'), { ok: false, reason: 'notLearned' });
  assert.deepEqual(setSkillBar(ctx, 0, 'weaponMastery'), { ok: false, reason: 'invalid' }, '패시브');
  assert.deepEqual(setSkillBar(ctx, 0, 'fireball'), { ok: false, reason: 'class' });
  assert.deepEqual(setSkillBar(ctx, 5, 'charge'), { ok: false, reason: 'invalid' });
  assert.equal(ctx.events.filter(e => e.name === EV.SKILLS).at(-1).payload.reason, 'bar');
});

test('previewLearn: 찍기 전 · 후 시트(순수 — 캐릭터를 고치지 않는다) · 못 찍으면 ok false · 같은 시트', () => {
  const ch = makeTestChar({ level: 5 });
  const snap = JSON.stringify(ch);
  const p = previewLearn(ch, 'weaponMastery');
  assert.equal(p.ok, true);
  assert.equal(p.rankBefore, 0);
  assert.equal(p.rankAfter, 1);
  assert.ok(p.statsAfter.sheetDps > p.statsBefore.sheetDps, '무기 숙련은 시트 DPS 를 올린다');
  assert.equal(JSON.stringify(ch), snap);
  const q = previewLearn(ch, 'earthquake');
  assert.equal(q.ok, false);
  assert.equal(q.reason, 'tier');
  assert.equal(q.statsAfter, q.statsBefore);
});

// ───────────────────────── 해금 · 기록 ─────────────────────────

test('unlockAfter: 완료 +1 · 무사망 +2 · 줄지 않는다 · maxLevel 상한', () => {
  const ch = makeTestChar({ riftUnlocked: 1 });
  assert.equal(unlockAfter(ch, 1, 0), 1 + RIFT.unlockNoDeath);
  assert.equal(unlockAfter(ch, 1, 2), 1 + RIFT.unlockClear);
  assert.equal(unlockAfter({ ...ch, riftUnlocked: 6 }, 2, 0), 6);
  assert.equal(unlockAfter({ ...ch, riftUnlocked: 98 }, 98, 0), RIFT.maxLevel);
});

/** @param {Partial<import('../src/types.js').RunSummary>} o */
function summary(o = {}) {
  return {
    level: 1, seed: 5, tileset: 'crypt', cls: 'warrior', result: 'complete', timeSec: 400,
    kills: { normal: 200, champion: 12, elite: 2, minion: 8, guardian: 1, other: 0 }, deaths: 0,
    drops: { normal: 20, magic: 10, rare: 3, legendary: 0, set: 0 }, gold: 300, xp: 2400, upgrades: 2, recalls: 1, maxTargeting: 30, swarmMoments: 3,
    unlockedTo: 3, noDeath: true, record: true, ...o,
  };
}

test('completeRun: 해금(UNLOCK) · 최고 기록(더 빠르면) · 기록 앞에(at · charLevel) · 계정 요약 · SAVE', () => {
  const { ctx, ch, state } = setup({ level: 3 });
  ch.playSec = 777;
  completeRun(ctx, summary());
  assert.equal(ch.riftUnlocked, 3);
  assert.deepEqual(ctx.events.find(e => e.name === EV.UNLOCK).payload, { riftUnlocked: 3, from: 1 });
  assert.deepEqual(ch.best['1'], { timeSec: 400, deaths: 0 });
  assert.equal(ch.records.length, 1);
  assert.equal(ch.records[0].at, 777);
  assert.equal(ch.records[0].charLevel, 3);
  assert.equal(ch.records[0].result, 'complete');
  assert.equal(state.account.chars[ch.slot].riftUnlocked, 3);
  assert.ok(ctx.events.some(e => e.name === EV.SAVE_REQUEST && e.payload.reason === 'complete'));

  completeRun(ctx, summary({ timeSec: 500, deaths: 1 }));
  assert.deepEqual(ch.best['1'], { timeSec: 400, deaths: 0 }, '느리면 그대로');
  assert.equal(countEvents(ctx.events, EV.UNLOCK), 1, '오르지 않으면 UNLOCK 없음');
  completeRun(ctx, summary({ timeSec: 300, deaths: 1 }));
  assert.deepEqual(ch.best['1'], { timeSec: 300, deaths: 1 });
  completeRun(ctx, summary({ level: 3, deaths: 1 }));
  assert.equal(ch.riftUnlocked, 4);
  completeRun(ctx, summary({ level: 4, result: 'collapse' }));
  assert.equal(ch.riftUnlocked, 4, '붕괴는 해금 · 최고 기록을 바꾸지 않는다');
  assert.equal(ch.best['4'], undefined);
  assert.equal(ch.records[0].result, 'collapse');
  assertFiniteDeep(state);
});

test('recordRun: 앞에 · 최근 200개 · 요약의 사본(나중에 요약을 고쳐도 기록은 그대로)', () => {
  const { ctx, ch } = setup();
  const s = summary({ result: 'abandon' });
  recordRun(ctx, s);
  s.kills.normal = 9999;
  assert.equal(ch.records[0].kills.normal, 200);
  for (let i = 0; i < ECON.recordsMax + 15; i++) recordRun(ctx, summary({ seed: i }));
  assert.equal(ch.records.length, ECON.recordsMax);
  assert.equal(ch.records[0].seed, ECON.recordsMax + 14);
});

test('previewRift: riftRow · 최고 기록 · 열림 여부 · (리뷰 수정) 생명 · 피해 배율 = 몬스터에 실제로 곱하는 값(표 × 첫 판 경사 — monsterStats 와 같다)', () => {
  const ch = makeTestChar({ riftUnlocked: 4, best: { 3: { timeSec: 333, deaths: 0 } } });
  const p = previewRift(ch, 3);
  const row = riftRow(3);
  assert.equal(p.monLevel, row.monLevel);
  assert.equal(p.hpMul, row.hpMul * earlyHpMul(3));
  for (let L = 1; L <= 30; L++) {
    const pv = previewRift(ch, L);
    const base = monsterStats('ghoul', 'normal', 1);
    const at = monsterStats('ghoul', 'normal', L);
    const r1 = riftRow(1);
    // monsterStats = 상수 × 표 × 경사 — 균열 1 의 값으로 상수를 나눠 낸다
    const realHp = at.hpMax / (base.hpMax / (r1.hpMul * earlyHpMul(1)));
    const realDmg = at.dmg / (base.dmg / (r1.dmgMul * earlyDmgMul(1)));
    assert.ok(Math.abs(pv.hpMul / realHp - 1) < 1e-9, `균열 ${L} 생명 배율 ${pv.hpMul} ≠ 실제 ${realHp}`);
    assert.ok(Math.abs(pv.dmgMul / realDmg - 1) < 1e-9, `균열 ${L} 피해 배율 ${pv.dmgMul} ≠ 실제 ${realDmg}`);
  }
  assert.deepEqual(p.rarityMul, row.rarityMul);
  assert.deepEqual(p.best, { timeSec: 333, deaths: 0 });
  assert.equal(p.unlocked, true);
  assert.equal(previewRift(ch, 5).unlocked, false);
  assert.equal(previewRift(ch, 5).best, null);
  assert.equal(previewRift(null, 1).unlocked, true);
});

// ───────────────────────── 개발용 캐릭터 ─────────────────────────

test('makeDevCharacter: 레벨 · 누적 경험치 · 프리셋 순서대로 포인트 전부 · 바 · 해금 = rift · 장비 칸 전부 ilvl = rift(마법/희귀 · 자기 클래스) · 결정성', () => {
  let n = 1;
  const newId = () => 'i' + n++;
  for (const [cls, preset, level, rift] of [['warrior', 0, 18, 10], ['mage', 1, 20, 12], ['warrior', 1, 30, 25], ['mage', 0, 1, 1]]) {
    const ch = makeDevCharacter({ slot: 1, cls, name: 'dev', level, rift, preset, seed: 9, newId });
    assert.equal(ch.level, level);
    assert.equal(ch.slot, 1);
    let cum = 0;
    for (let k = 1; k < level; k++) cum += xpReq(k);
    assert.equal(ch.xpTotal, cum);
    assert.equal(pointsSpent(ch), pointsTotal(level), `${cls} ${level}: 포인트 전부`);
    const P = PRESETS[cls][preset];
    for (const id of Object.keys(ch.skills.ranks)) assert.ok(P.order.includes(id));
    for (let i = 0; i < ch.skills.bar.length; i++) {
      const id = ch.skills.bar[i];
      if (id) assert.ok(ch.skills.ranks[id] >= 1 && SKILL_NODES_BY_ID[id].kind === 'active');
    }
    if (level >= 18) assert.deepEqual(ch.skills.bar.slice(0, 4), P.bar.slice(0, 4), '프리셋 바');
    assert.equal(ch.riftUnlocked, rift);
    assert.equal(ch.lastRiftLevel, rift);
    for (const s of EQUIP_SLOTS) {
      const it = ch.equip[s];
      if (!it) {
        assert.equal(s, 'offhand');
        assert.equal(BASES_BY_ID[ch.equip.mainHand.baseId].hands, 2, '보조가 비는 것은 양손 무기일 때뿐');
        continue;
      }
      assert.equal(it.ilvl, rift);
      assert.ok(it.rarity === 'magic' || it.rarity === 'rare', it.rarity);
      assert.ok(it.cls === null || it.cls === cls);
      assert.ok(it.slot === s || (it.slot === 'ring' && s.startsWith('ring')));
    }
    assertFiniteDeep(ch, `${cls}`);
  }
  const strip = (c) => JSON.stringify(c, (k, v) => (k === 'id' ? undefined : v));
  const a = makeDevCharacter({ cls: 'mage', name: 'x', level: 12, rift: 7, newId });
  const b = makeDevCharacter({ cls: 'mage', name: 'x', level: 12, rift: 7, newId });
  assert.equal(strip(a), strip(b), '같은 인자면 같은 캐릭터');
  const lv0 = makeDevCharacter({ cls: 'warrior', name: 'x', level: 0, rift: -3, preset: 9, newId });
  assert.equal(lv0.level, 1);
  assert.equal(lv0.riftUnlocked, 1);
});
