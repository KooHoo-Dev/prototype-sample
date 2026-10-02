// OWNER: P4 — 계약 §12.2(progression)
// 경험치 곡선 · 레벨 업 · 포인트 · unlocks · 캡 · 스킬 · Modifiers · RigStats · 도감 · 첫 포획 · 신기록 · 방생 70% · 어창 swap · 프로필 정리.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { SKILL_IDS } from '../src/core/constants.js';
import { HOLD, START, XP } from '../src/data/economy.js';
import { FIGHT } from '../src/data/fight.js';
import { SIGNAL } from '../src/data/bite.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { SKILLS } from '../src/data/skills.js';
import { getSpecies, speciesOfStage } from '../src/data/species/index.js';
import { computeModifiers, rigStats, isOwned, availableCount } from '../src/sim/progression/modifiers.js';
import { createNewProfile, makeDevProfile, sanitizeProfile } from '../src/sim/progression/profile.js';
import {
  addXp, applyCatch, applyCatchToProfile, cumulativeXp, dexView, evaluateCatch, learnSkill, previewSkill, stageUnlocked, xpToNext,
} from '../src/sim/progression/progress.js';
import { assertFiniteDeep, assertShape, countEvents, makeTestCtx, makeTestProfile, makeTestState } from './helpers.js';

/** P1 의 syncRig 에 기대지 않는 문맥 — refresh 는 mods · rigStats 만 다시 계산하고 횟수를 센다 */
function ctxOf(state) {
  /** @type {any} */
  let ctx;
  ctx = makeTestCtx(state, {
    refresh: () => {
      ctx.mods = computeModifiers(state.profile);
      ctx.rigStats = rigStats(state.profile, state.rig.set, ctx.mods);
      ctx.refreshes = (ctx.refreshes ?? 0) + 1;
    },
  });
  return ctx;
}

function evs(ctx, name) {
  return ctx.events.filter(e => e.name === name).map(e => e.payload);
}

/** @returns {import('../src/types.js').FishRoll} */
function rollOf(speciesId, weightKg, tier = 'normal', lengthCm = 30) {
  return { speciesId, z: 0, pct: tier === 'legend' ? 0.995 : tier === 'trophy' ? 0.95 : 0.5, lengthCm, weightKg, tier };
}

test('경험치 곡선: 레벨별 필요치 · 누적 L5 657 · L10 3,863 · L20 21,116 · 캡 Infinity', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(xpToNext), [45, 116, 200, 296, 402, 515, 635, 761, 893, 1031]);
  assert.equal(xpToNext(19), 2468);
  assert.equal(xpToNext(XP.levelCap), Infinity);
  assert.equal(cumulativeXp(1), 0);
  assert.equal(cumulativeXp(5), 657);
  assert.equal(cumulativeXp(10), 3863);
  assert.equal(cumulativeXp(20), 21116);
});

test('레벨 업 · 포인트 · unlocks(스테이지 · tier:2 · 숙련으로 열리는 tier:3) · 이벤트 순서', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  // 레벨 1 → 5 정확히
  const r = addXp(ctx, 657, 'debug');
  assert.equal(r.levelsGained, 4);
  assert.equal(p.level, 5);
  assert.equal(p.xp, 0);
  assert.equal(p.xpTotal, 657);
  assert.equal(p.skillPoints, START.skillPoints + 4);
  const names = ctx.events.map(e => e.name);
  assert.equal(names[0], EV.XP_GAINED);
  const ups = evs(ctx, EV.LEVEL_UP);
  assert.deepEqual(ups.map(u => u.level), [2, 3, 4, 5]);
  assert.deepEqual(ups[3].unlocks, ['stage:coast', 'tier:2']);
  assert.deepEqual(ups[0].unlocks, []);
  assert.equal(ups[3].skillPoints, p.skillPoints);
  const g = evs(ctx, EV.XP_GAINED)[0];
  assert.deepEqual(g, { amount: 657, xpTotal: 657, level: 5, xp: 0, xpToNext: 402, source: 'debug' });

  // 레벨 10 → stage:river
  ctx.events.length = 0;
  addXp(ctx, cumulativeXp(10) - p.xpTotal + 10, 'keep');
  assert.equal(p.level, 10);
  assert.equal(p.xp, 10);
  assert.deepEqual(evs(ctx, EV.LEVEL_UP).at(-1).unlocks, ['stage:river']);

  // 레벨 12 · 숙련 0 → tier:3 없음
  ctx.events.length = 0;
  addXp(ctx, cumulativeXp(12) - p.xpTotal, 'keep');
  assert.equal(p.level, 12);
  assert.deepEqual(evs(ctx, EV.LEVEL_UP).at(-1).unlocks, []);
  // 숙련 1 → 2 를 배우면 SKILL_LEARNED 에 tier:3
  ctx.events.length = 0;
  p.skillPoints = 2;
  assert.deepEqual(learnSkill(ctx, 'mastery'), { ok: true, rank: 1 });
  assert.deepEqual(evs(ctx, EV.SKILL_LEARNED)[0].unlocks, []);
  assert.deepEqual(learnSkill(ctx, 'mastery'), { ok: true, rank: 2 });
  assert.deepEqual(evs(ctx, EV.SKILL_LEARNED)[1].unlocks, ['tier:3']);

  // 숙련 2 를 먼저 갖고 레벨 12 에 닿으면 LEVEL_UP 에 tier:3
  const s2 = makeTestState({ spotId: 'lake_gravel' });
  const ctx2 = ctxOf(s2);
  s2.profile.skills.mastery = 2;
  addXp(ctx2, cumulativeXp(12), 'keep');
  const ups2 = evs(ctx2, EV.LEVEL_UP);
  assert.equal(ups2.length, 11);
  assert.deepEqual(ups2.at(-1).unlocks, ['tier:3']);
  assert.ok(ups2.slice(0, -1).every(u => !u.unlocks.includes('tier:3')));
});

test('캡: 레벨 20 에서 xp 0 · XP_GAINED.xpToNext null(JSON 안전) · 그 뒤 xpTotal 만 는다', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  addXp(ctx, cumulativeXp(20) + 5000, 'keep');
  assert.equal(p.level, 20);
  assert.equal(p.xp, 0);
  assert.equal(p.skillPoints, 20);
  const g = evs(ctx, EV.XP_GAINED)[0];
  assert.equal(g.xpToNext, null);
  assert.equal(g.xp, 0);
  assert.equal(JSON.parse(JSON.stringify(g)).xpToNext, null);
  ctx.events.length = 0;
  addXp(ctx, 50, 'keep');
  assert.equal(p.level, 20);
  assert.equal(p.xp, 0);
  assert.equal(p.xpTotal, cumulativeXp(20) + 5050);
  assert.equal(countEvents(ctx.events, EV.LEVEL_UP), 0);
  assert.equal(evs(ctx, EV.XP_GAINED)[0].xpToNext, null);
  // 0 · 음수 · NaN 은 아무 일도 없다
  ctx.events.length = 0;
  for (const a of [0, -10, NaN, Infinity]) assert.deepEqual(addXp(ctx, a, 'debug'), { levelsGained: 0 });
  assert.equal(ctx.events.length, 0);
  assert.equal(p.xpTotal, cumulativeXp(20) + 5050);
});

test('스킬: 랭크 1 → 2 → 3 순서 · 포인트 · maxRank · noPoints · invalid · 드랙 눈금 비율 이동 · refresh · SAVE_REQUEST', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.skillPoints = 4;
  p.sets.float.dragNotch = 5;
  p.sets.bottom.dragNotch = 13;
  assert.deepEqual(learnSkill(ctx, 'nope'), { ok: false, reason: 'invalid' });
  assert.deepEqual(learnSkill(ctx, 'dragSense'), { ok: true, rank: 1 });
  assert.equal(p.skills.dragSense, 1);
  assert.equal(p.skillPoints, 3);
  assert.equal(p.sets.float.dragNotch, Math.round(5 * 25 / 20));
  assert.equal(p.sets.bottom.dragNotch, Math.round(13 * 25 / 20));
  assert.equal(ctx.rigStats.dragNotches, 25, 'refresh 뒤 rigStats 가 새 눈금 수');
  assert.equal(ctx.refreshes, 1);
  learnSkill(ctx, 'dragSense');
  learnSkill(ctx, 'dragSense');
  assert.equal(p.skills.dragSense, 3);
  assert.equal(p.sets.float.dragNotch, Math.round(Math.round(Math.round(5 * 25 / 20) * 30 / 25) * 40 / 30));
  assert.deepEqual(learnSkill(ctx, 'dragSense'), { ok: false, reason: 'maxRank' });
  assert.equal(p.skillPoints, 1);
  learnSkill(ctx, 'casting');
  assert.deepEqual(learnSkill(ctx, 'casting'), { ok: false, reason: 'noPoints' });
  assert.equal(countEvents(ctx.events, EV.SKILL_LEARNED), 4);
  assert.equal(evs(ctx, EV.SAVE_REQUEST).filter(x => x.reason === 'skill').length, 4);
  const sl = evs(ctx, EV.SKILL_LEARNED);
  assert.deepEqual(sl.map(x => x.rank), [1, 2, 3, 1]);
});

test('Modifiers: 모든 스킬 · 랭크가 §7.7 표 그대로 · 한 필드 한 스킬', () => {
  const fields = new Set();
  for (const sk of SKILLS) {
    for (const f of Object.keys(sk.effects)) {
      assert.ok(!fields.has(f), `${f} 를 두 스킬이 건드린다`);
      fields.add(f);
    }
  }
  for (const sk of SKILLS) {
    for (let rank = 0; rank <= 3; rank++) {
      const p = makeTestProfile();
      p.skills[sk.id] = rank;
      const m = computeModifiers(p);
      for (const [f, ranks] of Object.entries(sk.effects)) assert.equal(m[f], ranks[rank], `${sk.id} ${rank} ${f}`);
    }
  }
  assertShape(computeModifiers(createNewProfile()), 'Modifiers');
  // 깨진 랭크는 0..3 으로 자른다
  const bad = makeTestProfile();
  bad.skills.casting = 9;
  bad.skills.hookset = -2;
  bad.skills.netting = NaN;
  const m = computeModifiers(bad);
  assert.equal(m.castMul, 1.20);
  assert.equal(m.hookWindowAdd, 0);
  assert.equal(m.netRangeAdd, 0);
});

test('RigStats 식: castMaxM · lineKg · signalMul · hookWindowS · netReachM · landStamina · 빈 부위 값', () => {
  const p = makeTestProfile({ owned: { rod_bottom_2: 1, reel_2: 1, sinker_2: 1, float_2: 1 } });
  p.sets.bottom.rod = 'rod_bottom_2';
  p.sets.bottom.reel = 'reel_2';
  p.sets.bottom.sinker = 'sinker_2';
  p.sets.bottom.lineId = 'line_2';
  p.sets.float.float = 'float_2';
  p.skills = { ...p.skills, casting: 2, dragSense: 1, netting: 3, mastery: 1, lineCare: 2, hookset: 1 };
  const m = computeModifiers(p);
  const b = rigStats(p, 'bottom', m);
  assert.ok(Math.abs(b.castMaxM - (42 + 4) * 1.05 * 1.12) < 1e-9);
  assert.ok(Math.abs(b.lineKg - 8 * 1.04) < 1e-9);
  assert.ok(Math.abs(b.lineAbrasionMul - 0.75 * 0.65) < 1e-9);
  assert.equal(b.dragNotches, 25);
  assert.ok(Math.abs(b.dragNotchKg - 9 / 25) < 1e-12);
  assert.ok(Math.abs(b.signalMul - 1.15 * 1 * 1.15) < 1e-12);
  assert.ok(Math.abs(b.hookWindowS - (SIGNAL.bottom.takeWindow + 0.12)) < 1e-12);
  assert.ok(Math.abs(b.netReachM - (FIGHT.netReachM + 1.5)) < 1e-12);
  assert.ok(Math.abs(b.landStamina - (FIGHT.landStamina + 0.15)) < 1e-12);
  assert.equal(b.floatSensitivity, 1);
  assert.equal(b.floatStability, 1);
  assert.equal(b.sinkerHoldMS, 0.9);
  assert.equal(b.sinkerCastBonusM, 4);
  assert.equal(b.spoolCapM, 200);
  const f = rigStats(p, 'float', m);
  assert.ok(Math.abs(f.signalMul - 1.0 * 1.25 * 1.15) < 1e-12);
  assert.equal(f.sinkerHoldMS, 0);
  assert.equal(f.sinkerCastBonusM, 0);
  assert.equal(f.floatStability, 0.75);
  assertShape(b, 'RigStats');
  assertShape(f, 'RigStats');
  assertFiniteDeep(b);
});

test('보유: isOwned · availableCount(다른 세트가 끼운 수를 뺀다 · 1단계 Infinity)', () => {
  const p = makeTestProfile({ owned: { reel_2: 1 } });
  assert.equal(isOwned(p, 'reel_1'), true);
  assert.equal(isOwned(p, 'hook_l'), true);
  assert.equal(isOwned(p, 'reel_2'), true);
  assert.equal(isOwned(p, 'reel_3'), false);
  assert.equal(isOwned(p, 'nope'), false);
  assert.equal(availableCount(p, 'reel_1', 'float'), Infinity);
  assert.equal(availableCount(p, 'reel_2', 'bottom'), 1);
  p.sets.float.reel = 'reel_2';
  assert.equal(availableCount(p, 'reel_2', 'bottom'), 0);
  assert.equal(availableCount(p, 'reel_2', 'float'), 1);
  assert.equal(availableCount(p, 'reel_3', 'float'), 0);
  assert.equal(availableCount(p, 'nope', 'float'), 0);
});

test('previewSkill: 지금 랭크 · 한 단계 위 Modifiers · 판정', () => {
  const p = makeTestProfile();
  const pv = previewSkill(p, 'casting');
  assert.equal(pv.rank, 0);
  assert.equal(pv.ok, true);
  assert.equal(pv.reason, null);
  assert.equal(pv.before.castMul, 1);
  assert.equal(pv.after.castMul, 1.06);
  assert.equal(p.skills.casting, 0, '프로필은 그대로');
  p.skills.casting = 3;
  const top = previewSkill(p, 'casting');
  assert.equal(top.ok, false);
  assert.equal(top.reason, 'maxRank');
  assert.deepEqual(top.after, top.before);
  p.skillPoints = 0;
  assert.equal(previewSkill(p, 'netting').reason, 'noPoints');
  assert.equal(previewSkill(p, 'netting').after.netRangeAdd, 0.5);
  assert.equal(previewSkill(p, 'nope').reason, 'invalid');
});

test('evaluateCatch: 상태를 바꾸지 않는다 · 첫 포획 보너스 · 신기록 · 트로피 배율 · 방생 70% · 가격', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const before = structuredClone(s);
  const sp = getSpecies('carp');
  const rec = evaluateCatch(ctx, rollOf('carp', 3.0, 'trophy', 57), 31.5);
  assert.deepEqual(s, before, 'evaluateCatch 는 상태를 바꾸지 않는다');
  assertShape(rec, 'CatchRecord');
  assert.equal(rec.uid, s.profile.nextUid);
  assert.equal(rec.firstCatch, true);
  assert.equal(rec.recordWeight, false);
  assert.equal(rec.xpKeep, Math.round(sp.xp * XP.tierMul.trophy) + XP.firstBase + XP.firstPerXp * sp.xp);
  assert.equal(rec.xpRelease, Math.round(rec.xpKeep * XP.releaseMul));
  assert.equal(rec.price, Math.round(sp.pricePerKg * 3.0 * sp.priceMul.trophy));
  assert.equal(rec.stageId, 'lake');
  assert.equal(rec.spotId, 'lake_gravel');
  assert.equal(rec.fightSec, 31.5);
  assert.equal(rec.set, s.rig.set);

  // 도감에 있으면: 더 무거우면 신기록(첫 포획 아님) · 가벼우면 보너스 없음
  s.profile.dex.carp = { count: 1, maxKg: 2.0, maxCm: 50, firstDay: 1, trophies: 0, legends: 0, best: 'normal' };
  const heavier = evaluateCatch(ctx, rollOf('carp', 2.5), 0);
  assert.equal(heavier.firstCatch, false);
  assert.equal(heavier.recordWeight, true);
  assert.equal(heavier.xpKeep, sp.xp + Math.round(XP.recordMul * sp.xp));
  const lighter = evaluateCatch(ctx, rollOf('carp', 1.5), 0);
  assert.equal(lighter.recordWeight, false);
  assert.equal(lighter.xpKeep, sp.xp);
  const legend = evaluateCatch(ctx, rollOf('carp', 1.9, 'legend'), 0);
  assert.equal(legend.xpKeep, sp.xp * XP.tierMul.legend);
});

test('applyCatch: keep 은 어창 · 도감 · 경험치 · nextUid · stats · RECORD · release 는 70% 경험치 · 어창 그대로', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  const r1 = evaluateCatch(ctx, rollOf('crucian', 0.3, 'normal', 22), 10);
  const res = applyCatch(ctx, r1, true);
  assert.deepEqual(res, { ok: true, xp: r1.xpKeep });
  assert.equal(p.hold.length, 1);
  assert.equal(p.hold[0].uid, r1.uid);
  assert.equal(p.nextUid, r1.uid + 1);
  assert.equal(p.xpTotal, r1.xpKeep);
  assert.equal(p.stats.landed, 1);
  assert.equal(p.stats.released, 0);
  assert.deepEqual(p.dex.crucian, { count: 1, maxKg: 0.3, maxCm: 22, firstDay: 1, trophies: 0, legends: 0, best: 'normal' });
  assert.deepEqual(evs(ctx, EV.RECORD), [{ speciesId: 'crucian', kind: 'first', weightKg: 0.3, tier: 'normal' }]);
  assert.equal(evs(ctx, EV.XP_GAINED)[0].source, 'keep');
  assert.deepEqual(applyCatch(ctx, r1, true), { ok: false, reason: 'invalid' }, '같은 기록을 두 번 반영하지 않는다');

  ctx.events.length = 0;
  const r2 = evaluateCatch(ctx, rollOf('crucian', 0.9, 'trophy', 31), 10);
  assert.equal(r2.uid, r1.uid + 1);
  assert.equal(r2.recordWeight, true);
  const xpBefore = p.xpTotal;
  assert.deepEqual(applyCatch(ctx, r2, false), { ok: true, xp: r2.xpRelease });
  assert.equal(r2.xpRelease, Math.round(r2.xpKeep * 0.7));
  assert.equal(p.xpTotal, xpBefore + r2.xpRelease);
  assert.equal(p.hold.length, 1);
  assert.equal(p.stats.released, 1);
  assert.equal(p.stats.landed, 2);
  assert.equal(p.dex.crucian.count, 2);
  assert.equal(p.dex.crucian.maxKg, 0.9);
  assert.equal(p.dex.crucian.trophies, 1);
  assert.equal(p.dex.crucian.best, 'trophy');
  assert.deepEqual(evs(ctx, EV.RECORD), [{ speciesId: 'crucian', kind: 'weight', weightKg: 0.9, tier: 'trophy' }]);
  assert.equal(evs(ctx, EV.XP_GAINED)[0].source, 'release');
});

test('어창 swap: 가득이면 swapUid 필요 · 뺀 물고기의 경험치 · 도감은 그대로 · 어창 ≤ capacity', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  for (let i = 0; i < HOLD.capacity; i++) {
    const r = evaluateCatch(ctx, rollOf('bluegill', 0.1 + i * 0.001, 'normal', 14), 5);
    assert.equal(applyCatch(ctx, r, true).ok, true);
  }
  assert.equal(p.hold.length, HOLD.capacity);
  const big = evaluateCatch(ctx, rollOf('goldenDragon', 20, 'normal', 100), 60);
  assert.deepEqual(applyCatch(ctx, big, true), { ok: false, reason: 'holdFull' });
  assert.deepEqual(applyCatch(ctx, big, true, { swapUid: 9999 }), { ok: false, reason: 'invalid' });
  const dexBefore = structuredClone(p.dex.bluegill);
  const xpBefore = p.xpTotal;
  const out = p.hold[3];
  const res = applyCatch(ctx, big, true, { swapUid: out.uid });
  assert.equal(res.ok, true);
  assert.equal(p.hold.length, HOLD.capacity);
  assert.ok(!p.hold.some(c => c.uid === out.uid));
  assert.ok(p.hold.some(c => c.uid === big.uid));
  assert.deepEqual(p.dex.bluegill, dexBefore, '뺀 어종의 도감은 그대로');
  assert.equal(p.xpTotal, xpBefore + big.xpKeep, '뺀 물고기의 경험치는 그대로(새 것만 더한다)');
  assert.equal(p.dex.goldenDragon.count, 1);

  // 순수 함수: 어창이 차 있으면 kept 여도 방생으로 반영(어창 > capacity 금지)
  const r = evaluateCatch(ctx, rollOf('bluegill', 0.2, 'normal', 14), 5);
  const info = applyCatchToProfile(p, r, true);
  assert.equal(info.kept, false);
  assert.equal(info.xp, r.xpRelease);
  assert.equal(p.hold.length, HOLD.capacity);
});

test('도감 dexView: 그 스테이지 어종 · 잡은 기록 · 지식 단계별 시간대 · 미끼', () => {
  const p = makeTestProfile();
  p.dex.carp = { count: 2, maxKg: 3, maxCm: 57, firstDay: 1, trophies: 1, legends: 0, best: 'trophy' };
  const lake = speciesOfStage('lake');
  const m0 = computeModifiers(p);
  const cards = dexView(p, 'lake', m0);
  assert.equal(cards.length, lake.length);
  for (const c of cards) assertShape(c, 'DexCard');
  const carp = cards.find(c => c.speciesId === 'carp');
  assert.equal(carp.caught, true);
  assert.deepEqual(carp.entry, p.dex.carp);
  assert.equal(carp.time, null);
  assert.equal(carp.baits, null);
  assert.equal(cards.find(c => c.speciesId === 'crucian').caught, false);
  assert.ok(cards.some(c => c.fantasy), '판타지 어종 표시');
  p.skills.knowledge = 2;
  const c2 = dexView(p, 'lake', computeModifiers(p)).find(c => c.speciesId === 'carp');
  assert.equal(c2.time, getSpecies('carp').time);
  assert.deepEqual(c2.baits, getSpecies('carp').baits);
  p.skills.knowledge = 1;
  const c1 = dexView(p, 'lake', computeModifiers(p)).find(c => c.speciesId === 'carp');
  assert.equal(c1.time, getSpecies('carp').time);
  assert.equal(c1.baits, null);
});

test('stageUnlocked: 호수 1 · 갯바위 5 · 강 10 · 모르는 씬 false', () => {
  const p = makeTestProfile();
  assert.equal(stageUnlocked(p, 'lake'), true);
  assert.equal(stageUnlocked(p, 'home'), true);
  assert.equal(stageUnlocked(p, 'coast'), false);
  p.level = 5;
  assert.equal(stageUnlocked(p, 'coast'), true);
  assert.equal(stageUnlocked(p, 'river'), false);
  p.level = 10;
  assert.equal(stageUnlocked(p, 'river'), true);
  assert.equal(stageUnlocked(p, 'mars'), false);
});

test('프로필: createNewProfile = START · makeDevProfile(레벨 · 누적 포인트 · 돈) · sanitizeProfile 은 던지지 않고 정합을 맞춘다', () => {
  const p = createNewProfile();
  assert.deepEqual(p, makeTestProfile());
  assert.deepEqual(sanitizeProfile(structuredClone(p)), p, '정상 프로필은 그대로');

  const dev = makeDevProfile({ level: 12, money: 1e6 });
  assert.equal(dev.level, 12);
  assert.equal(dev.skillPoints, 12);
  assert.equal(dev.xp, 0);
  assert.equal(dev.xpTotal, cumulativeXp(12));
  assert.equal(dev.money, 1e6);
  assert.deepEqual(sanitizeProfile(structuredClone(dev)), dev);
  assert.equal(makeDevProfile({ level: 99 }).level, XP.levelCap);
  assert.equal(makeDevProfile({ money: -5 }).money, 0);

  for (const raw of [null, undefined, 3, 'x', [], { money: 'a' }, { sets: 5 }, { hold: {} }, { dex: [] }]) {
    const out = sanitizeProfile(raw);
    assertShape(out, 'Profile');
    assertFiniteDeep(out);
  }

  const bad = {
    money: -100, level: 7.6, xp: 99999, xpTotal: 3, skillPoints: 50, junk: 1,
    skills: { casting: 3, mastery: 5, nope: 2 },
    owned: { reel_2: 1, rod_float_1: 3, line_2: 4, fake: 2, rod_bottom_3: -1 },
    baits: { worm: -3, corn: 12.4, gold: 9 },
    sets: {
      float: { rod: 'rod_bottom_2', reel: 'reel_2', hook: 'hook_x', float: 'float_3', sinker: 'sinker_2', bait: 'pizza', lineId: 'line_9', lineM: 999, depthM: -4, dragNotch: 77 },
      bottom: { rod: 'rod_bottom_1', reel: 'reel_2', hook: 'hook_l', float: 'float_1', sinker: 'sinker_1', bait: 'corn', lineId: 'line_2', lineM: NaN, depthM: 3, dragNotch: 4 },
    },
    hold: [
      ...Array.from({ length: 20 }, (_, i) => ({ uid: i + 1, speciesId: 'crucian', lengthCm: 20, weightKg: 0.2, pct: 0.5, tier: 'normal', price: 900, xpKeep: 6, xpRelease: 4, stageId: 'lake', spotId: 'lake_gravel', day: 1, hour: 8, set: 'float', fightSec: 10 })),
      { uid: 3, speciesId: 'crucian', lengthCm: 20, weightKg: 0.2, tier: 'normal' },
      { uid: 50, speciesId: 'dragonfish', lengthCm: 20, weightKg: 0.2, tier: 'normal' },
    ],
    dex: { crucian: { count: 3, maxKg: 1, maxCm: 30, firstDay: 1, trophies: 9, legends: 0, best: 'mythic' }, ghost: { count: 1 } },
    flags: { hints: { start: true, fake: true, cast: 'yes' }, freeBaitDay: -2 },
    stats: { landed: 5, lost: NaN, sold: -1 },
    nextUid: 2,
  };
  const out = sanitizeProfile(bad);
  assertShape(out, 'Profile');
  assertFiniteDeep(out);
  assert.equal(out.money, 0);
  assert.equal(out.level, 8);
  assert.equal(out.xp, xpToNext(8) - 1);
  assert.equal(out.xpTotal, cumulativeXp(8) + out.xp);
  assert.equal(out.skills.casting, 3);
  assert.equal(out.skills.mastery, 3);
  assert.ok(!('nope' in out.skills));
  assert.equal(out.skillPoints, Math.max(0, 8 - 6), '받은 포인트(레벨) − 쓴 포인트');
  assert.ok(!('junk' in out));
  assert.deepEqual(out.owned, { reel_2: 1 });
  assert.deepEqual(out.baits, { worm: 0, paste: 0, corn: 12, shrimp: 0, krill: 0, live: 0 });
  assert.equal(out.sets.float.rod, 'rod_float_1', '세트에 맞지 않는 로드 → 1단계');
  assert.equal(out.sets.float.float, 'float_1', '보유하지 않은 찌 → 1단계');
  assert.equal(out.sets.float.sinker, null);
  assert.equal(out.sets.float.hook, START.sets.float.hook);
  assert.equal(out.sets.float.bait, START.sets.float.bait);
  assert.equal(out.sets.float.lineId, 'line_1');
  assert.equal(out.sets.float.reel, 'reel_2');
  assert.equal(out.sets.float.lineM, 200, '스풀 용량으로 자른다');
  assert.equal(out.sets.float.depthM, 0.5);
  assert.equal(out.sets.float.dragNotch, computeModifiers(out).dragNotches);
  assert.equal(out.sets.bottom.reel, 'reel_1', 'reel_2 하나를 두 세트가 끼울 수 없다');
  assert.equal(out.sets.bottom.float, null);
  assert.equal(out.sets.bottom.lineId, 'line_2');
  assert.equal(out.sets.bottom.lineM, GEAR_BY_ID.reel_1.capacityM);
  assert.equal(out.hold.length, HOLD.capacity);
  assert.equal(new Set(out.hold.map(r => r.uid)).size, out.hold.length);
  assert.ok(out.nextUid > Math.max(...out.hold.map(r => r.uid)));
  assert.deepEqual(Object.keys(out.dex), ['crucian']);
  assert.equal(out.dex.crucian.trophies, 3);
  assert.equal(out.dex.crucian.best, 'normal');
  assert.deepEqual(out.flags, { hints: { start: true }, freeBaitDay: 0 });
  assert.deepEqual(out.stats, { landed: 5, lost: 0, released: 0, sold: 0, earned: 0, casts: 0 });
  for (const id of SKILL_IDS) assert.ok(id in out.skills);
});
