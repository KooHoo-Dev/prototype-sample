// OWNER: P4 — 계약 §12.2(economy) · §5.6
// 가격 식 · 가격 비율 · 판매 · 흥정 · 구매 문턱 · 입력 검증 · 라인 감기 · 손실 · 예비 스풀 · 로드 파손 뒤 드랙 · 장착 · 돈 음수 0 · 무료 미끼.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EV } from '../src/core/events.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { normalCdf } from '../src/core/stats.js';
import { median } from '../src/core/stats.js';
import { round1, round3 } from '../src/core/math.js';
import { CAST } from '../src/data/bite.js';
import { BAITS } from '../src/data/baits.js';
import { FREE_BAIT, LOSS, PRICE } from '../src/data/economy.js';
import { GEAR, GEAR_BY_ID, GEAR_GATES } from '../src/data/gear.js';
import { SPECIES, getSpecies } from '../src/data/species/index.js';
import { computeModifiers, rigStats } from '../src/sim/progression/modifiers.js';
import {
  applyLoss, buy, equip, fishPrice, grantFreeBaitIfNeeded, previewEquip, refillLine, sellAll, sellOne, sellPrice, setBait, shopList,
} from '../src/sim/progression/economy.js';
import { assertShape, makeTestCtx, makeTestMods, makeTestProfile, makeTestState } from './helpers.js';

/** P1 의 syncRig 에 기대지 않는 문맥(refresh 는 mods · rigStats 만 · 횟수를 센다) · mods 덮어쓰기 */
function ctxOf(state, modsOver = null) {
  /** @type {any} */
  let ctx;
  const mk = () => (modsOver ? { ...computeModifiers(state.profile), ...modsOver } : computeModifiers(state.profile));
  ctx = makeTestCtx(state, {
    mods: mk(),
    refresh: () => {
      ctx.mods = mk();
      ctx.rigStats = rigStats(state.profile, state.rig.set, ctx.mods);
      ctx.refreshes = (ctx.refreshes ?? 0) + 1;
    },
  });
  return ctx;
}

function evs(ctx, name) {
  return ctx.events.filter(e => e.name === name).map(e => e.payload);
}

/** 테스트용 어창 기록(가격 식 그대로) */
function rec(uid, speciesId = 'crucian', weightKg = 0.3, tier = 'normal') {
  const sp = getSpecies(speciesId);
  return {
    uid, speciesId, lengthCm: 22, weightKg, pct: 0.5, tier, price: fishPrice(sp, weightKg, tier),
    xpKeep: 6, xpRelease: 4, firstCatch: false, recordWeight: false, stageId: sp.stage, spotId: 'lake_gravel',
    day: 1, hour: 8, set: 'float', fightSec: 10,
  };
}

/** 돈은 정수이고 0 이상 */
function assertMoney(p) {
  assert.ok(Number.isInteger(p.money) && p.money >= 0, `money = ${p.money}`);
}

test('가격 식: round(pricePerKg × weightKg × priceMul[tier]) · 흥정 배율', () => {
  const sp = getSpecies('carp');
  assert.equal(fishPrice(sp, 3.06, 'normal'), Math.round(1300 * 3.06));
  assert.equal(fishPrice(sp, 7.31, 'trophy'), Math.round(1300 * 7.31 * (2 + sp.trophyBonus)));
  assert.equal(sp.priceMul.trophy, 2 + sp.trophyBonus);
  const r = rec(1, 'carp', 3.06);
  assert.equal(sellPrice(r, makeTestMods()), r.price);
  assert.equal(sellPrice(r, makeTestMods({ sellMul: 1.15 })), Math.round(r.price * 1.15));
});

test('가격 비율(어종마다 10,000 표본): 트로피 중앙/비트로피 중앙 ≥ 2.0 · 레전드 중앙/트로피 중앙 4–6', () => {
  // rollFish(P1)와 같은 분포를 여기서 직접 뽑는다: z ~ N(0,1) 을 [−2.5, 3.3]으로 자르고 pct = Φ(z) · 길이 소수 1 · 무게 소수 3
  const rng = makeRng(seedRng(4242));
  const rows = [];
  for (const sp of SPECIES) {
    const by = { normal: [], trophy: [], legend: [] };
    for (let i = 0; i < 10000; i++) {
      const z = Math.max(-2.5, Math.min(3.3, rng.normal()));
      const pct = normalCdf(z);
      const tier = pct >= PRICE.legendPct ? 'legend' : pct >= PRICE.trophyPct ? 'trophy' : 'normal';
      const L = round1(Math.exp(sp.size.mu + sp.size.sigma * z));
      const W = round3(sp.size.a * Math.pow(L, sp.size.b));
      by[tier].push(fishPrice(sp, W, tier));
    }
    const n = median(by.normal), t = median(by.trophy), l = median(by.legend);
    rows.push({ id: sp.id, trophyRatio: t / n, legendRatio: l / t, legends: by.legend.length });
  }
  for (const r of rows) {
    assert.ok(r.trophyRatio >= 2.0, `${r.id} 트로피/비트로피 ${r.trophyRatio.toFixed(2)}`);
    assert.ok(r.legendRatio >= 4 && r.legendRatio <= 6, `${r.id} 레전드/트로피 ${r.legendRatio.toFixed(2)}(레전드 ${r.legends}마리)`);
  }
});

test('판매: sellAll(흥정 · 이벤트 · stats) · 빈 어창은 이벤트 없음 · sellOne · 없는 uid 는 invalid', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  s.profile.skills.haggling = 2;
  const ctx = ctxOf(s);
  const p = s.profile;
  p.hold = [rec(1, 'carp', 3), rec(2, 'crucian', 0.3), rec(3, 'bluegill', 0.1)];
  const expected = p.hold.reduce((a, r) => a + Math.round(r.price * 1.10), 0);
  const m0 = p.money;
  const res = sellAll(ctx);
  assert.deepEqual(res, { ok: true, count: 3, total: expected });
  assert.equal(p.money, m0 + expected);
  assert.equal(p.hold.length, 0);
  assert.equal(p.stats.sold, 3);
  assert.equal(p.stats.earned, expected);
  assert.deepEqual(evs(ctx, EV.MONEY_CHANGED), [{ money: p.money, delta: expected, reason: 'sell' }]);
  assert.deepEqual(evs(ctx, EV.SOLD), [{ count: 3, total: expected, auto: false }]);
  assert.deepEqual(evs(ctx, EV.SAVE_REQUEST), [{ reason: 'sell' }]);
  assert.ok(ctx.refreshes >= 1);

  ctx.events.length = 0;
  assert.deepEqual(sellAll(ctx, { auto: true }), { ok: true, count: 0, total: 0 });
  assert.equal(ctx.events.length, 0);

  p.hold = [rec(10, 'carp', 2), rec(11, 'crucian', 0.3)];
  const m1 = p.money;
  for (const bad of [99, '10', null, undefined, NaN, 10.5]) assert.deepEqual(sellOne(ctx, bad), { ok: false, reason: 'invalid' });
  assert.equal(p.money, m1);
  assert.equal(p.hold.length, 2);
  const one = sellOne(ctx, 11);
  assert.deepEqual(one, { ok: true, total: Math.round(rec(11).price * 1.10) });
  assert.deepEqual(p.hold.map(r => r.uid), [10]);
  ctx.events.length = 0;
  sellAll(ctx, { auto: true });
  assert.equal(evs(ctx, EV.SOLD)[0].auto, true);
});

test('구매 문턱: 레벨 · 숙련 · 돈(reasonParams) · 성공 시 owned · 돈 · 이벤트', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.money = 10_000_000;
  assert.deepEqual(buy(ctx, 'rod_float_2'), { ok: false, reason: 'level', params: { n: GEAR_GATES.tier2Level } });
  assert.deepEqual(buy(ctx, 'reel_3'), { ok: false, reason: 'level', params: { n: GEAR_GATES.tier3Level } });
  p.level = 12;
  assert.deepEqual(buy(ctx, 'reel_3'), { ok: false, reason: 'mastery', params: { n: GEAR_GATES.tier3Mastery } });
  p.skills.mastery = 2;
  p.money = 100;
  assert.deepEqual(buy(ctx, 'reel_3'), { ok: false, reason: 'money' });
  assert.equal(p.money, 100);
  assert.equal(ctx.events.length, 0);
  p.money = 2_100_000;
  assert.deepEqual(buy(ctx, 'reel_3'), { ok: true, cost: 2_000_000 });
  assert.equal(p.money, 100_000);
  assert.equal(p.owned.reel_3, 1);
  assert.deepEqual(evs(ctx, EV.BOUGHT), [{ itemId: 'reel_3', qty: 1, cost: 2_000_000 }]);
  assert.deepEqual(evs(ctx, EV.MONEY_CHANGED), [{ money: 100_000, delta: -2_000_000, reason: 'buy' }]);
  assert.deepEqual(evs(ctx, EV.SAVE_REQUEST), [{ reason: 'buy' }]);
  assert.deepEqual(buy(ctx, 'float_2', 2), { ok: true, cost: 24_000 });
  assert.equal(p.owned.float_2, 2);

  // 상점 목록의 잠김 사유가 같다
  const q = makeTestProfile();
  const list = shopList(q, computeModifiers(q));
  const r2 = list.find(i => i.id === 'rod_float_2');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'level');
  assert.deepEqual(r2.reasonParams, { n: 5 });
  q.level = 12;
  const r3 = shopList(q, computeModifiers(q)).find(i => i.id === 'rod_float_3');
  assert.equal(r3.reason, 'mastery');
  assert.deepEqual(r3.reasonParams, { n: 2 });
  q.level = 5;
  q.money = 1000;
  const rm = shopList(q, computeModifiers(q)).find(i => i.id === 'rod_float_2');
  assert.equal(rm.reason, 'money');
  assert.equal(rm.reasonParams, null);
});

test('buy 입력 검증: qty 0 · −1 · 1.5 · NaN · 100 · 문자열 → invalid · 모르는 ID · 1단계 · 라인 ID → invalid · 돈 불변', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.level = 20;
  p.skills.mastery = 3;
  p.money = 5_000_000;
  for (const qty of [0, -1, 1.5, NaN, Infinity, 100, '2', null]) {
    assert.deepEqual(buy(ctx, 'bait_worm', qty), { ok: false, reason: 'invalid' }, `qty ${qty}`);
    assert.deepEqual(buy(ctx, 'reel_2', qty), { ok: false, reason: 'invalid' }, `qty ${qty}`);
  }
  for (const id of ['nope', 'reel_1', 'hook_l', 'line_2', 'bait_gold', '', null, 42]) {
    assert.deepEqual(buy(ctx, id), { ok: false, reason: 'invalid' }, `id ${id}`);
  }
  assert.equal(p.money, 5_000_000);
  assert.deepEqual(p.owned, {});
  assert.equal(ctx.events.length, 0);
  // 미끼 팩
  const worm = BAITS.find(b => b.id === 'worm');
  const w0 = p.baits.worm;
  assert.deepEqual(buy(ctx, 'bait_worm', 3), { ok: true, cost: worm.packPrice * 3 });
  assert.equal(p.baits.worm, w0 + worm.packSize * 3);
  assert.deepEqual(evs(ctx, EV.BOUGHT), [{ itemId: 'bait_worm', qty: 3, cost: worm.packPrice * 3 }]);
});

test('라인 감기: 상점 항목은 세트 × 라인 · 세트별 비용 · 같은 라인은 모자란 m · 다른 라인은 용량 전부 · 집의 무료 line_1', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.level = 5;
  p.money = 100_000;
  p.owned.reel_2 = 1;
  p.sets.float.reel = 'reel_2';
  p.sets.float.lineM = 150;
  p.sets.bottom.lineM = 120;
  const list = shopList(p, computeModifiers(p));
  const lines = list.filter(i => i.kind === 'line');
  assert.equal(lines.length, 2 * GEAR.filter(g => g.slot === 'line').length);
  const get = id => list.find(i => i.id === id);
  assert.equal(get('refill_float_line_1').price, (200 - 150) * 5);
  assert.equal(get('refill_float_line_1').ok, true);
  assert.equal(get('refill_bottom_line_1').price, 0);
  assert.equal(get('refill_bottom_line_1').ok, false, '가득인 같은 라인');
  assert.equal(get('refill_bottom_line_1').reason, 'full', '가득인 같은 라인의 사유는 full(W1 확정)');
  assert.equal(get('refill_float_line_2').price, 200 * 25);
  assert.equal(get('refill_bottom_line_2').price, 120 * 25);
  assert.equal(get('refill_bottom_line_3').reason, 'level');
  assert.equal(get('refill_float_line_2').set, 'float');
  assert.equal(get('refill_float_line_2').lineId, 'line_2');
  assert.equal(get('refill_float_line_2').previews.bottom, null);
  assert.equal(get('refill_float_line_2').previews.float.after.lineKg, 8);
  assert.equal(get('refill_float_line_2').previews.float.before.lineKg, 4);

  // 같은 라인: 모자란 m
  const r1 = refillLine(ctx, 'float', 'line_1');
  assert.deepEqual(r1, { ok: true, cost: 250, meters: 50 });
  assert.equal(p.sets.float.lineM, 200);
  assert.deepEqual(evs(ctx, EV.LINE_REFILLED), [{ set: 'float', lineId: 'line_1', meters: 50, cost: 250 }]);
  assert.deepEqual(evs(ctx, EV.MONEY_CHANGED)[0].reason, 'refill');
  assert.deepEqual(evs(ctx, EV.SAVE_REQUEST), [{ reason: 'refill' }]);
  // 가득이면 아무 일 없음
  ctx.events.length = 0;
  assert.deepEqual(refillLine(ctx, 'float', 'line_1'), { ok: true, cost: 0, meters: 0 });
  assert.equal(ctx.events.length, 0);
  // 다른 라인: 용량 전부 · 기존 라인 버림
  const m = p.money;
  assert.deepEqual(refillLine(ctx, 'bottom', 'line_2'), { ok: true, cost: 120 * 25, meters: 120 });
  assert.equal(p.sets.bottom.lineId, 'line_2');
  assert.equal(p.sets.bottom.lineM, 120);
  assert.equal(p.money, m - 3000);
  assert.equal(ctx.rigStats.lineId, s.rig.set === 'bottom' ? 'line_2' : ctx.rigStats.lineId, 'refresh 됨');
  // 문턱 · 돈 · 입력
  assert.deepEqual(refillLine(ctx, 'bottom', 'line_3'), { ok: false, reason: 'level', params: { n: 12 } });
  assert.deepEqual(refillLine(ctx, 'bottom', 'reel_2'), { ok: false, reason: 'invalid' });
  assert.deepEqual(refillLine(ctx, 'lure', 'line_1'), { ok: false, reason: 'invalid' });
  p.money = 0;
  p.sets.bottom.lineM = 60;
  assert.deepEqual(refillLine(ctx, 'bottom', 'line_2'), { ok: false, reason: 'money' });
  // 무료 line_1(집) — 돈 0 이어도
  p.sets.float.lineM = 40;
  const f = refillLine(ctx, 'float', 'line_1', { free: true });
  assert.deepEqual(f, { ok: true, cost: 0, meters: 160 });
  assert.equal(p.money, 0);
  // free 는 1단계 라인에만
  assert.deepEqual(refillLine(ctx, 'bottom', 'line_2', { free: true }), { ok: false, reason: 'money' });
  // buy('refill_…') 는 refillLine 과 같다
  p.money = 10_000;
  p.sets.float.lineM = 190;
  assert.deepEqual(buy(ctx, 'refill_float_line_1'), { ok: true, cost: 50, meters: 10 });
  assertMoney(p);
});

test('손실 §5.6: 헛챔질 · 늦음 · 바늘 빠짐 · 라인 끊김 · 스풀 바닥 · 로드 파손 — 물속 미끼 기준 · 채비 차감 · 라인', () => {
  // 헛챔질: 미끼만(환불 확률 earlyBaitKeep)
  {
    const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
    const ctx = ctxOf(s, { earlyBaitKeep: 0 });
    const p = s.profile;
    const before = structuredClone(p);
    const L = applyLoss(ctx, 'float', 'early', { baitId: 'corn' });
    assertShape(L, 'LossReport');
    assert.equal(L.baitId, 'corn', '물속 미끼(인자) 기준 — 세트의 미끼가 아니다');
    assert.equal(L.baitLost, true);
    assert.equal(L.tackleCost, 0);
    assert.equal(L.lineLostM, 0);
    assert.equal(L.rodLost, null);
    assert.equal(L.spareSpool, false);
    assert.deepEqual(p.baits, before.baits);
    assert.equal(p.money, before.money);
    assert.equal(ctx.refreshes, 1);
    const keep = ctxOf(s, { earlyBaitKeep: 1 });
    const L2 = applyLoss(keep, 'float', 'early', { baitId: 'corn' });
    assert.equal(L2.baitLost, false);
    assert.equal(p.baits.corn, before.baits.corn + 1, '환불은 물속 미끼로');
    // 늦음은 earlyBaitKeep 를 쓰지 않는다
    const L3 = applyLoss(keep, 'float', 'late', { baitId: 'worm' });
    assert.equal(L3.baitLost, true);
    assert.equal(p.stats.lost, 0, '헛챔질 · 늦음은 놓친 물고기가 아니다');
  }
  // 바늘 빠짐: 미끼(baitKeepOnFail) · 원인 그대로
  {
    const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
    const ctx = ctxOf(s, { baitKeepOnFail: 1 });
    const L = applyLoss(ctx, 'float', 'hookOff', { baitId: 'worm', cause: 'jump', hookSmall: true });
    assert.equal(L.baitLost, false);
    assert.equal(L.cause, 'jump');
    assert.equal(L.hookSmall, true);
    assert.equal(L.tackleCost, 0);
    assert.equal(s.profile.stats.lost, 1);
  }
  // 라인 끊김: 바늘 100 + 찌 300 · 라인 −29m
  {
    const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
    const ctx = ctxOf(s);
    const p = s.profile;
    const L = applyLoss(ctx, 'float', 'lineBreak', { lineLostM: 29, baitId: 'worm' });
    assert.equal(L.tackleCost, 100 + 300);
    assert.equal(L.moneyBefore - L.moneyAfter, 400);
    assert.equal(p.money, 5000 - 400);
    assert.equal(p.sets.float.lineM, 91);
    assert.equal(L.lineLostM, 29);
    assert.equal(L.spareSpool, false);
    assert.deepEqual(evs(ctx, EV.MONEY_CHANGED), [{ money: 4600, delta: -400, reason: 'loss' }]);
    // 바닥 세트: 바늘 100 + 봉돌 150
    const L2 = applyLoss(ctx, 'bottom', 'lineBreak', { lineLostM: 10, baitId: 'paste' });
    assert.equal(L2.tackleCost, 250);
    assert.equal(p.sets.bottom.lineM, 110);
    // 돈이 모자라면 0 까지만 — tackleCost 는 실제로 깎인 액수
    p.money = 120;
    const L3 = applyLoss(ctx, 'float', 'lineBreak', { lineLostM: 1, baitId: 'worm' });
    assert.equal(L3.tackleCost, 120);
    assert.equal(p.money, 0);
    const L4 = applyLoss(ctx, 'float', 'lineBreak', { lineLostM: 1, baitId: 'worm' });
    assert.equal(L4.tackleCost, 0);
    assert.equal(p.money, 0);
    // 잘못된 lineLostM 은 0
    const lm = p.sets.float.lineM;
    applyLoss(ctx, 'float', 'lineBreak', { lineLostM: NaN, baitId: 'worm' });
    applyLoss(ctx, 'float', 'lineBreak', { lineLostM: -50, baitId: 'worm' });
    assert.equal(p.sets.float.lineM, lm);
  }
  // 스풀 바닥: 미끼 잃음(환불 없음) · 채비 · 라인 0 → 예비 스풀
  {
    const s = makeTestState({ spotId: 'lake_gravel', set: 'bottom' });
    const ctx = ctxOf(s, { baitKeepOnFail: 1 });
    const p = s.profile;
    p.level = 5;
    p.owned.reel_2 = 1;
    p.sets.bottom.reel = 'reel_2';
    p.sets.bottom.lineId = 'line_2';
    p.sets.bottom.lineM = 180;
    const L = applyLoss(ctx, 'bottom', 'spoolEmpty', { lineLostM: 180, baitId: 'paste' });
    assert.equal(L.baitLost, true);
    assert.equal(L.tackleCost, 250);
    assert.equal(L.lineLostM, 180);
    assert.equal(L.spareSpool, true);
    assert.equal(p.sets.bottom.lineId, 'line_1');
    assert.equal(p.sets.bottom.lineM, 200, '그 릴의 용량만큼');
    assert.deepEqual(evs(ctx, EV.LINE_REFILLED), [{ set: 'bottom', lineId: 'line_1', meters: 200, cost: 0 }]);
  }
  // 로드 파손: 그 로드 1대 사라짐 · 예비 1단계 · 채비 차감 없음 · 드랙 0.9 × 새 상한 아래로
  {
    const s = makeTestState({ spotId: 'lake_gravel', set: 'bottom' });
    const ctx = ctxOf(s);
    const p = s.profile;
    p.level = 5;
    p.owned.rod_bottom_2 = 1;
    p.sets.bottom.rod = 'rod_bottom_2';
    p.sets.bottom.dragNotch = 20;
    const L = applyLoss(ctx, 'bottom', 'rodBreak', { baitId: 'paste' });
    assert.equal(L.rodLost, 'rod_bottom_2');
    assert.ok(!('rod_bottom_2' in p.owned), 'owned 에서 빠진다');
    assert.equal(p.sets.bottom.rod, 'rod_bottom_1');
    assert.equal(L.tackleCost, 0);
    assert.equal(p.money, 5000);
    const limit = LOSS.rodBreakDragFrac * GEAR_BY_ID.rod_bottom_1.maxLoadKg;   // 2.88
    assert.equal(p.sets.bottom.dragNotch, 11);
    assert.equal(L.dragKgAfter, 11 * 0.25);
    assert.ok(L.dragKgAfter <= limit && L.dragKgAfter + 0.25 > limit, '그 아래 가장 가까운 눈금');
    assert.equal(p.stats.lost, 1);
    // 2대 있으면 하나만 줄고 · 드랙이 이미 낮으면 그대로(null)
    p.owned.rod_bottom_2 = 2;
    p.sets.bottom.rod = 'rod_bottom_2';
    p.sets.bottom.dragNotch = 5;
    const L2 = applyLoss(ctx, 'bottom', 'rodBreak', { baitId: 'paste' });
    assert.equal(p.owned.rod_bottom_2, 1);
    assert.equal(L2.dragKgAfter, null);
    assert.equal(p.sets.bottom.dragNotch, 5);
    // 찌 로드(2.6kg): 0.9 × 2.6 = 2.34 → 9눈금 2.25kg · 1단계 로드가 부러져도 예비 1단계
    p.sets.float.dragNotch = 20;
    const L3 = applyLoss(ctx, 'float', 'rodBreak', { baitId: 'worm' });
    assert.equal(L3.rodLost, 'rod_float_1');
    assert.equal(p.sets.float.rod, 'rod_float_1');
    assert.equal(L3.dragKgAfter, 2.25);
  }
});

test('예비 스풀: 돈 0 · 두 세트 line_2 · 끊김으로 lineM 0 → 바로 캐스팅 가능(재고 판정) · 30m 경계', () => {
  const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.money = 0;
  p.level = 5;
  for (const set of ['float', 'bottom']) {
    p.sets[set].lineId = 'line_2';
    p.sets[set].lineM = 120;
  }
  const L = applyLoss(ctx, 'float', 'lineBreak', { lineLostM: 120, baitId: 'worm' });
  assert.equal(L.spareSpool, true);
  assert.equal(L.tackleCost, 0);
  assert.equal(p.money, 0);
  const cfg = p.sets.float;
  assert.equal(cfg.lineId, 'line_1');
  assert.equal(cfg.lineM, 120);
  // §5.2 ready 의 판정 그대로: 미끼 > 0 && lineM ≥ CAST.minLineM
  assert.ok(p.baits[cfg.bait] > 0 && cfg.lineM >= CAST.minLineM, '캐스팅 가능');
  assert.equal(ctx.rigStats.lineM, 120, 'refresh 로 스냅샷도 맞다');
  // 다른 세트는 그대로
  assert.equal(p.sets.bottom.lineId, 'line_2');
  // 경계: 30m 이상 남으면 그대로 · 아래면 예비 스풀
  const threshold = CAST.minLineM + CAST.lineReserveM;
  p.sets.bottom.lineM = threshold + 10;
  assert.equal(applyLoss(ctx, 'bottom', 'lineBreak', { lineLostM: 10, baitId: 'paste' }).spareSpool, false);
  assert.equal(p.sets.bottom.lineId, 'line_2');
  assert.equal(applyLoss(ctx, 'bottom', 'lineBreak', { lineLostM: 0.5, baitId: 'paste' }).spareSpool, true);
  assert.equal(p.sets.bottom.lineId, 'line_1');
  // 헛챔질에서도 라인이 모자라면(예: 세이브에서 온 짧은 라인) 예비 스풀
  p.sets.float.lineM = 5;
  assert.equal(applyLoss(ctx, 'float', 'early', { baitId: 'worm' }).spareSpool, true);
});

test('장착: 보유 수(notOwned · inUse) · 슬롯 · 세트 · 릴의 드랙 kg 보존 · 이벤트', () => {
  const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
  const ctx = ctxOf(s);
  const p = s.profile;
  assert.deepEqual(equip(ctx, 'float', 'reel', 'reel_2'), { ok: false, reason: 'notOwned' });
  assert.deepEqual(equip(ctx, 'bottom', 'rod', 'rod_float_1'), { ok: false, reason: 'wrongSet' });
  assert.deepEqual(equip(ctx, 'bottom', 'float', 'float_1'), { ok: false, reason: 'wrongSet' });
  assert.deepEqual(equip(ctx, 'float', 'sinker', 'sinker_1'), { ok: false, reason: 'wrongSet' });
  assert.deepEqual(equip(ctx, 'float', 'reel', 'rod_float_1'), { ok: false, reason: 'wrongSlot' });
  assert.deepEqual(equip(ctx, 'float', 'line', 'line_1'), { ok: false, reason: 'wrongSlot' });
  assert.deepEqual(equip(ctx, 'float', 'reel', 'nope'), { ok: false, reason: 'invalid' });
  assert.deepEqual(equip(ctx, 'lure', 'reel', 'reel_1'), { ok: false, reason: 'invalid' });
  assert.equal(ctx.events.length, 0);

  p.owned.reel_2 = 1;
  p.sets.float.dragNotch = 5;      // reel_1: 5 × 0.25 = 1.25kg
  p.sets.float.lineM = 100;
  assert.deepEqual(equip(ctx, 'float', 'reel', 'reel_2'), { ok: true });
  assert.equal(p.sets.float.reel, 'reel_2');
  assert.equal(p.sets.float.dragNotch, Math.round(1.25 / (9 / 20)));   // 3 눈금 = 1.35kg
  assert.equal(p.sets.float.lineM, 100);
  assert.deepEqual(evs(ctx, EV.EQUIPPED), [{ set: 'float', slot: 'reel', itemId: 'reel_2' }]);
  assert.deepEqual(evs(ctx, EV.SAVE_REQUEST), [{ reason: 'equip' }]);
  assert.equal(ctx.rigStats.reelId, 'reel_2');
  // 하나뿐인 reel_2 를 다른 세트에 → inUse · 하나 더 있으면 된다
  assert.deepEqual(equip(ctx, 'bottom', 'reel', 'reel_2'), { ok: false, reason: 'inUse' });
  p.owned.reel_2 = 2;
  assert.deepEqual(equip(ctx, 'bottom', 'reel', 'reel_2'), { ok: true });
  // 이미 끼운 것 → ok · 이벤트 없음
  ctx.events.length = 0;
  assert.deepEqual(equip(ctx, 'float', 'reel', 'reel_2'), { ok: true });
  assert.equal(ctx.events.length, 0);
  // 작은 릴로 돌아가면 kg 보존 · 스풀 용량으로 라인을 자른다
  p.sets.float.lineM = 200;
  p.sets.float.dragNotch = 20;   // 9kg → reel_1 최대 5kg → 20눈금
  equip(ctx, 'float', 'reel', 'reel_1');
  assert.equal(p.sets.float.dragNotch, 20);
  assert.equal(p.sets.float.lineM, 120);
  // 1단계 · 바늘은 보유 수 없이
  assert.deepEqual(equip(ctx, 'bottom', 'hook', 'hook_l'), { ok: true });
  assert.equal(p.sets.bottom.hook, 'hook_l');
});

test('미끼 고르기 · previewEquip(세트별 · 사기 전 · 후) · 상점 previews 세트 규칙', () => {
  const s = makeTestState({ spotId: 'lake_gravel', set: 'float' });
  const ctx = ctxOf(s);
  const p = s.profile;
  assert.deepEqual(setBait(ctx, 'float', 'corn'), { ok: true });
  assert.equal(p.sets.float.bait, 'corn');
  assert.deepEqual(evs(ctx, EV.SAVE_REQUEST), [{ reason: 'tackle' }]);
  assert.deepEqual(setBait(ctx, 'float', 'pizza'), { ok: false, reason: 'invalid' });
  assert.deepEqual(setBait(ctx, 'lure', 'worm'), { ok: false, reason: 'invalid' });

  const mods = computeModifiers(p);
  const pv = previewEquip(p, 'bottom', 'sinker', 'sinker_3', mods);
  assert.equal(pv.before.castMaxM, 32);
  assert.equal(pv.after.castMaxM, 40);
  assert.equal(p.sets.bottom.sinker, 'sinker_1', '미리보기는 프로필을 바꾸지 않는다');
  const pr = previewEquip(p, 'float', 'reel', 'reel_3', mods);
  assert.equal(pr.after.reelMaxDragKg, 16);
  assert.ok(Math.abs(pr.after.castMaxM - 24 * 1.1) < 1e-9);
  const bad = previewEquip(p, 'float', 'rod', 'rod_bottom_3', mods);
  assert.deepEqual(bad.after, bad.before);

  const list = shopList(p, mods);
  const get = id => list.find(i => i.id === id);
  for (const it of list) assertShape(it, 'ShopItem');
  assert.ok(get('rod_float_2').previews.float && get('rod_float_2').previews.bottom === null);
  assert.ok(get('rod_bottom_3').previews.bottom && get('rod_bottom_3').previews.float === null);
  assert.ok(get('float_2').previews.float && get('float_2').previews.bottom === null);
  assert.ok(get('sinker_2').previews.bottom && get('sinker_2').previews.float === null);
  assert.ok(get('reel_2').previews.float && get('reel_2').previews.bottom, '공용은 두 세트');
  assert.equal(get('reel_2').previews.bottom.after.spoolCapM, 200);
  assert.equal(get('rod_float_2').previews.float.after.rodMaxLoadKg, 6);
  assert.equal(get('bait_live').kind, 'bait');
  assert.equal(get('bait_live').price, 3000);
  assert.equal(list.filter(i => i.kind === 'gear').length, GEAR.filter(g => g.tier > 1 && g.slot !== 'line').length);
  assert.ok(!list.some(i => i.id === 'reel_1' || i.id === 'hook_m'), '1단계는 팔지 않는다');
});

test('무료 미끼: 돈 < 2000 · 미끼 0 · 하루 1회 · 두 세트 미끼를 지렁이로', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: 0 }, '돈 · 미끼가 있으면 없다');
  for (const k of Object.keys(p.baits)) p.baits[k] = 0;
  p.money = FREE_BAIT.moneyBelow;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: 0 }, '돈이 문턱 이상');
  p.money = FREE_BAIT.moneyBelow - 1;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: FREE_BAIT.count });
  assert.equal(p.baits.worm, FREE_BAIT.count);
  assert.equal(p.sets.bottom.bait, 'worm');
  assert.equal(p.sets.float.bait, 'worm');
  assert.equal(p.flags.freeBaitDay, s.clock.day);
  assert.deepEqual(evs(ctx, EV.BAIT_GRANTED), [{ baitId: 'worm', count: FREE_BAIT.count }]);
  p.baits.worm = 0;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: 0 }, '같은 날 두 번 없다');
  s.clock.day += 1;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: FREE_BAIT.count }, '다음 날 다시');
  // 다른 미끼가 하나라도 있으면 없다
  s.clock.day += 1;
  p.baits.worm = 0;
  p.baits.live = 1;
  assert.deepEqual(grantFreeBaitIfNeeded(ctx), { granted: 0 });
});

test('돈 음수 0 · 정수: 무작위 명령열(판매 · 구매 · 감기 · 손실 · 장착) 2,000번', () => {
  const s = makeTestState({ spotId: 'lake_gravel' });
  const ctx = ctxOf(s);
  const p = s.profile;
  p.level = 12;
  p.skills.mastery = 2;
  p.money = 3000;
  const rng = makeRng(seedRng(77));
  const reasons = ['early', 'late', 'hookOff', 'lineBreak', 'spoolEmpty', 'rodBreak'];
  const gear = GEAR.filter(g => g.tier > 1 && g.slot !== 'line');
  const lines = ['line_1', 'line_2', 'line_3'];
  let uid = 1000;
  for (let i = 0; i < 2000; i++) {
    const k = rng.int(0, 7);
    const set = rng.chance(0.5) ? 'float' : 'bottom';
    if (k === 0) {
      applyLoss(ctx, set, reasons[rng.int(0, reasons.length - 1)], { lineLostM: rng.range(0, 150), baitId: 'worm' });
      assert.ok(p.sets[set].lineM >= CAST.minLineM + CAST.lineReserveM, '손실 뒤에도 캐스팅할 라인이 있다(예비 스풀)');
    }
    else if (k === 1) buy(ctx, gear[rng.int(0, gear.length - 1)].id, rng.int(1, 3));
    else if (k === 2) buy(ctx, 'bait_' + BAITS[rng.int(0, BAITS.length - 1)].id, rng.int(1, 2));
    else if (k === 3) refillLine(ctx, set, lines[rng.int(0, 2)], { free: rng.chance(0.3) });
    else if (k === 4) { if (p.hold.length < 12) p.hold.push(rec(uid++, 'carp', rng.range(1, 8), rng.chance(0.1) ? 'trophy' : 'normal')); }
    else if (k === 5) { if (rng.chance(0.2)) sellAll(ctx); else if (p.hold.length) sellOne(ctx, p.hold[0].uid); }
    else if (k === 6) { const g = gear[rng.int(0, gear.length - 1)]; equip(ctx, set, g.slot, g.id); }
    else grantFreeBaitIfNeeded(ctx);
    assertMoney(p);
    for (const st of ['float', 'bottom']) {
      const c = p.sets[st];
      assert.ok(c.lineM >= 0, 'lineM');
      assert.ok(c.lineM <= GEAR_BY_ID[c.reel].capacityM + 1e-9);
      assert.ok(Number.isInteger(c.dragNotch) && c.dragNotch >= 0 && c.dragNotch <= ctx.mods.dragNotches);
    }
    for (const [id, n] of Object.entries(p.owned)) assert.ok(Number.isInteger(n) && n > 0, `owned ${id} ${n}`);
    for (const e of ctx.events) if (e.name === EV.MONEY_CHANGED) assert.ok(Number.isInteger(e.payload.delta) && e.payload.money >= 0);
    ctx.events.length = 0;
  }
});
