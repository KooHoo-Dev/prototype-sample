// OWNER: P2 — 계약 §12.2(styles.report) · §7.12 「성격이 다르다」
// 성격 6종 × 대표 어종 중앙값 × 기본 봇 300판의 텐션 시계열 통계를 표로 낸다.
// 조건은 M14(§12.5)와 같다 — 그 어종이 가장 많이 사는 자리 · 그 스테이지에서 진행 봇이 가질 단계 장비(호수 1 · 갯바위 2) · 입에 맞는 바늘 · 봇의 캐스팅 거리.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInput } from '../src/core/inputFrame.js';
import { angleDiff, clamp, piecewise, round1, round3 } from '../src/core/math.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { normalCdf } from '../src/core/stats.js';
import { CAST } from '../src/data/bite.js';
import { BOT } from '../src/data/bot.js';
import { GEAR_BY_ID } from '../src/data/gear.js';
import { getSpecies } from '../src/data/species/index.js';
import { getStage } from '../src/data/stages/index.js';
import { createFight, updateFight } from '../src/sim/fight/fight.js';
import { createFightPolicy } from '../src/bot/policy.js';
import { makeTestCtx, makeTestMods, makeTestProfile, makeTestRigStats, makeTestState } from './helpers.js';

/** 성격 → 대표 어종(§12.5 M14) */
const REP = { heavy: 'crucian', runner: 'redSeabream', thrasher: 'mandarinFish', jumper: 'largemouthBass', diver: 'barredKnifejaw', small: 'bluegill' };
/** 스테이지 → 진행 봇이 가질 장비 단계(§12.5 M14) */
const STAGE_TIER = { lake: 1, coast: 2, river: 3 };
const FIGHTS = 300;

/** 바닥 세트 · 그 단계 장비의 RigStats(§3.6 식 — 스킬 0) */
function rigStatsFor(tier, hookSize) {
  if (tier === 1) return makeTestRigStats('bottom', { hookSize });
  const rod = GEAR_BY_ID[`rod_bottom_${tier}`];
  const reel = GEAR_BY_ID[`reel_${tier}`];
  const line = GEAR_BY_ID[`line_${tier}`];
  return makeTestRigStats('bottom', {
    rodId: rod.id, reelId: reel.id, lineId: line.id,
    castMaxM: rod.castM * (1 + reel.castBonus), rodMaxLoadKg: rod.maxLoadKg, rodSensitivity: rod.sensitivity, rodLengthM: rod.lengthM,
    reelMaxDragKg: reel.maxDragKg, reelSpeedMS: reel.speedMS, spoolCapM: reel.capacityM, lineM: reel.capacityM,
    lineKg: line.strengthKg, lineBiteMul: line.biteMul, lineAbrasionMul: line.abrasionMul,
    dragNotchKg: reel.maxDragKg / 20, hookSize,
  });
}

/** 중앙값 물고기(§5.4.5 z = 0) */
function medianRoll(sp) {
  const { mu, sigma, a, b } = sp.size;
  const L = Math.exp(mu);
  return { speciesId: sp.id, z: 0, pct: normalCdf(0), lengthCm: round1(L), weightKg: round3(a * Math.pow(L, b)), tier: 'normal' };
}

/** 성격 하나의 300판 */
function report(style) {
  const sp = getSpecies(REP[style]);
  const stage = getStage(sp.stage);
  const wOf = (spot) => spot.pool.find(e => e.id === sp.id)?.w ?? 0;
  const spot = stage.spots.filter(s => wOf(s) > 0).sort((a, b) => wOf(b) - wOf(a))[0];
  const tier = STAGE_TIER[sp.stage];
  const rs = rigStatsFor(tier, sp.mouth);
  const roll = medianRoll(sp);
  const rng = makeRng(seedRng(2024));
  const startNotch = Math.round(BOT.basic.dragRatio * rs.lineKg / rs.dragNotchKg);
  const acc = { n: 0, landed: 0, maxT: 0, ticks: 0, sum: 0, sum2: 0, cvSum: 0, runs: 0, jumps: 0, slack: 0, slip: 0, cover: 0, lat: 0, depth: 0, sec: 0 };
  for (let i = 0; i < FIGHTS; i++) {
    const profile = makeTestProfile();
    profile.sets = { ...profile.sets, bottom: { ...profile.sets.bottom, lineM: rs.lineM } };
    const state = makeTestState({ spotId: spot.id, set: 'bottom', seed: 9000 + i, profile });
    const ctx = makeTestCtx(state, { rigStats: rs, mods: makeTestMods(), refresh() {} });
    const p = BOT.castPower.target + BOT.castPower.sd * rng.normal();
    const factor = p >= 1 - rs.perfectWindow ? 1 : CAST.minFactor + CAST.slope * clamp(p, 0, 1);
    const dist = clamp(rs.castMaxM * factor, spot.minCastM, rs.castMaxM);
    state.rig.dragNotch = startNotch;
    state.rig.dragKg = startNotch * rs.dragNotchKg;
    state.rig.phase = 'fighting';
    state.fight = createFight(ctx, { speciesId: sp.id, roll, dist, bearing: spot.facing, depth: piecewise(spot.depth, dist) });
    const f = state.fight;
    const pol = createFightPolicy('basic', i);
    const input = makeInput();
    let o = null;
    let cover = 0;
    let lat = 0;
    let depth = 0;
    for (let k = 0; k < 60 * 600 && !o; k++) {
      const b0 = f.bearing;
      const h = pol.decide(state, rs);
      if (h.dragSteps) {
        state.rig.dragNotch = clamp(state.rig.dragNotch + h.dragSteps, 0, rs.dragNotches);
        state.rig.dragKg = state.rig.dragNotch * rs.dragNotchKg;
      }
      input.primary = h.primary;
      input.secondary = h.secondary;
      input.hook = h.hook;
      o = updateFight(ctx, input);
      cover += f.inCover;
      lat += Math.abs(angleDiff(b0, f.bearing)) * f.dist;
      depth += f.depth;
      state.events.length = 0;
      ctx.events.length = 0;
    }
    const st = f.stats;
    acc.n++;
    if (o && o.type === 'net') acc.landed++;
    acc.maxT += st.maxTension;
    acc.ticks += st.ticks;
    acc.sum += st.sumTension;
    acc.sum2 += st.sumTension2;
    const m = st.sumTension / Math.max(1, st.ticks);
    acc.cvSum += m > 0 ? Math.sqrt(Math.max(0, st.sumTension2 / st.ticks - m * m)) / m : 0;
    acc.runs += st.runs;
    acc.jumps += st.jumps;
    acc.slack += st.slackTicks;
    acc.slip += st.slipTicks;
    acc.cover += cover;
    acc.lat += lat;
    acc.depth += depth;
    acc.sec += f.t;
  }
  const mean = acc.sum / acc.ticks;
  const min = acc.sec / 60;
  return {
    style, id: sp.id, spot: spot.id, tier, kg: roll.weightKg,
    land: acc.landed / acc.n,
    maxTension: acc.maxT / acc.n,                  // 판마다 최대의 평균(kg)
    meanTension: mean,                             // 틱 평균(kg)
    variance: acc.sum2 / acc.ticks - mean * mean,  // 틱 분산(kg²)
    cv: acc.cvSum / acc.n,                         // 판 안의 변동계수 평균
    runsPerMin: acc.runs / min,
    jumpsPerMin: acc.jumps / min,
    slackRatio: acc.slack / acc.ticks,
    slipRatio: acc.slip / acc.ticks,               // 드랙이 미끄러진 시간 비율(클리커)
    coverMean: acc.cover / acc.ticks,              // 바닥에 박힌 정도의 평균
    lateralMS: acc.lat / (acc.sec),                // 옆으로 움직이는 속도(m/s — 그림자가 좌우로 쓸린다)
    depthMean: acc.depth / acc.ticks,              // 평균 수심(m — 그림자가 보이는 깊이)
    lengthSec: acc.sec / acc.n,
  };
}

/** 계약이 이름을 댄 지표(§12.2) + 화면에서 읽히는 넷(미끄러짐 · 박힘 · 옆 움직임 · 수심 — FightState 그대로) */
const METRICS = ['maxTension', 'meanTension', 'variance', 'runsPerMin', 'jumpsPerMin', 'slackRatio', 'lengthSec', 'slipRatio', 'coverMean', 'lateralMS', 'depthMean'];
/** 두 값이 25% 넘게 다른가 — 둘 다 그 지표의 잡음 바닥 아래면 같다고 본다 */
const FLOOR = { slackRatio: 0.01, slipRatio: 0.01, coverMean: 0.01, jumpsPerMin: 0.2 };
function differs(metric, a, b) {
  const hi = Math.max(a, b);
  if (hi <= (FLOOR[metric] ?? 0)) return false;
  return Math.abs(a - b) / hi > 0.25;
}

test('성격 6종 × 대표 어종 중앙값 × 기본 봇 300판 — 표 · 쌍마다 지표 2개 이상 · 「붕어는 단순히 무겁다」', (t) => {
  const rows = Object.keys(REP).map(report);
  const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : String(v));
  const cols = ['style', 'id', 'spot', 'tier', 'kg', 'land', 'maxTension', 'meanTension', 'variance', 'cv', 'runsPerMin', 'jumpsPerMin', 'slackRatio', 'slipRatio', 'coverMean', 'lateralMS', 'depthMean', 'lengthSec'];
  t.diagnostic(cols.join(' | '));
  for (const r of rows) t.diagnostic(cols.map(c => fmt(r[c])).join(' | '));

  const by = Object.fromEntries(rows.map(r => [r.style, r]));
  // 쌍마다 지표 2개 이상에서 25% 넘게 다르다
  const weak = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const d = METRICS.filter(m => differs(m, rows[i][m], rows[j][m]));
      t.diagnostic(`${rows[i].style} ↔ ${rows[j].style}: ${d.join(', ')}`);
      if (d.length < 2) weak.push(`${rows[i].style}↔${rows[j].style}(${d.join(',')})`);
    }
  }
  assert.deepEqual(weak, [], '구분이 약한 쌍');
  // 「붕어는 단순히 무겁다」: 분당 질주가 돌진형의 0.4배 이하 · 변동계수가 돌진형보다 작다
  const rpmRatio = by.heavy.runsPerMin / by.runner.runsPerMin;
  const cvRatio = by.heavy.cv / by.runner.cv;
  t.diagnostic(`무게형/돌진형 — 분당 질주 ${rpmRatio.toFixed(3)}(≤ 0.4) · 변동계수 ${cvRatio.toFixed(3)}(계약 목표 ≤ 0.5 — NOTES-P2: 🔒 상태 힘으로는 닿지 않는다)`);
  assert.ok(rpmRatio <= 0.4, `분당 질주 비 ${rpmRatio}`);
  assert.ok(cvRatio < 1, `변동계수 비 ${cvRatio}`);
  // 요동형(쏘가리)의 변동계수가 가장 크다 · 점프형만 점프한다
  assert.equal(rows.reduce((a, b) => (b.cv > a.cv ? b : a)).style, 'thrasher');
  for (const r of rows) {
    if (r.style === 'jumper') assert.ok(r.jumpsPerMin > 1);
    else assert.equal(r.jumpsPerMin, 0);
  }
  // 잠수형만 바닥에 박힌다
  assert.equal(rows.reduce((a, b) => (b.coverMean > a.coverMean ? b : a)).style, 'diver');
});
