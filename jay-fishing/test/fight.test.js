// OWNER: P2 — 계약 §12.2(fight) · §5.3 · §5.5 · §7.12 · §12.1
// 파이팅 모델의 규칙 하나하나와, 봇 전략 넷(createFightPolicy)의 미니 측정(호수 자갈 · 1단계 · lakeDay 섞기).
// rig(P1) · 입질 모델(P1)을 기다리지 않는다 — 크기 뽑기 · 시간대 섞기 · 캐스팅 거리는 계약 식을 이 파일에 옮겨 쓴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, LAYER_IDS } from '../src/core/constants.js';
import { EV } from '../src/core/events.js';
import { makeInput } from '../src/core/inputFrame.js';
import { angleDiff, clamp, lerp, piecewise, round1, round3 } from '../src/core/math.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { normalCdf, normalInv } from '../src/core/stats.js';
import { BITE, CAST } from '../src/data/bite.js';
import { BOT } from '../src/data/bot.js';
import { FIGHT, HOOK } from '../src/data/fight.js';
import { BANDS } from '../src/data/time.js';
import { getSpecies } from '../src/data/species/index.js';
import { getSpot } from '../src/data/stages/index.js';
import { buildBrain } from '../src/sim/fight/fishBrain.js';
import { createFight, fightConstants, updateFight } from '../src/sim/fight/fight.js';
import { createFightPolicy } from '../src/bot/policy.js';
import { FIXTURE_NAMES, makeFixtureState } from '../src/debug/fixtures.js';
import {
  assertFiniteDeep, assertShape, countEvents, makeTestCtx, makeTestMods, makeTestProfile, makeTestRigStats, makeTestState,
} from './helpers.js';

// ── 계약 식의 사본(§5.4.5 크기 · §5.4.2 가중치) — P1 구현을 기다리지 않는다

/** §5.4.5 — z 로 물고기 한 마리 */
function rollAtZ(sp, z) {
  z = clamp(z, BITE.zMin, BITE.zMax);
  const { mu, sigma, a, b } = sp.size;
  const L = Math.exp(mu + sigma * z);
  const pct = normalCdf(z);
  return { speciesId: sp.id, z, pct, lengthCm: round1(L), weightKg: round3(a * Math.pow(L, b)), tier: pct >= 0.99 ? 'legend' : pct >= 0.9 ? 'trophy' : 'normal' };
}
/** 무게 kg 에 해당하는 z */
function zForKg(sp, kg) {
  const { mu, sigma, a, b } = sp.size;
  return (Math.log(Math.pow(kg / a, 1 / b)) - mu) / sigma;
}
function rollKg(id, kg) {
  const sp = getSpecies(id);
  return rollAtZ(sp, zForKg(sp, kg));
}

/** lakeDay(07:00 → 다음 날 04:30) 시간대별 낚시 시간 */
const LAKE_DAY_HOURS = { dawn: 0.5, morning: 4, day: 6, evening: 3, night: 8 };
/** §5.4.2 — 자리 · 바닥 세트 · lakeDay 미끼로 시간대를 섞은 비판타지 어종 가중치(입질 수 ∝ 시간 × w) */
function lakeDayMix(spotId, hookSize) {
  const spot = getSpot(spotId);
  /** @type {Record<string, number>} */
  const out = {};
  BANDS.forEach((band, bi) => {
    const bait = BOT.plans.lakeDay.byBand[band.id][2];
    for (const e of spot.pool) {
      const sp = getSpecies(e.id);
      if (sp.fantasy) continue;
      const layerD = Math.min(...sp.layers.map(l => Math.abs(LAYER_IDS.indexOf(l) - LAYER_IDS.indexOf('bottom'))));
      const bIdx = sp.baits.indexOf(bait);
      const w = e.w * BITE.timeCoef[sp.time[bi]] * BITE.layerFit[layerD] * (bIdx >= 0 ? BITE.baitFit[bIdx] : BITE.baitOther)
        * BITE.hookBigger[clamp(hookSize - sp.mouth, 0, 2)];
      out[e.id] = (out[e.id] ?? 0) + w * LAKE_DAY_HOURS[band.id];
    }
  });
  return out;
}
/** §5.2 · §12.1 — 봇의 캐스팅 거리(게이지 BOT.castPower 표본 · 완벽이면 최대) */
function botCastDist(rng, rs) {
  const p = BOT.castPower.target + BOT.castPower.sd * rng.normal();
  const factor = p >= 1 - rs.perfectWindow ? 1 : CAST.minFactor + CAST.slope * clamp(p, 0, 1);
  return clamp(rs.castMaxM * factor, getSpot('lake_gravel').minCastM, rs.castMaxM);
}

// ── 준비 · 한 틱

/**
 * 파이팅 하나를 세운다. rig 대신 드랙 눈금 · 베일 · 거리를 직접 넣는다.
 * @param {{speciesId?:string, kg?:number|null, roll?:any, spotId?:string, set?:'float'|'bottom', dist?:number, notch?:number, seed?:number, rs?:Object, lineM?:number|null, bearing?:number|null, depth?:number}} [o]
 */
function setup(o = {}) {
  const { speciesId = 'crucian', kg = null, spotId = 'lake_gravel', set = 'bottom', dist = 20, notch = 5, seed = 1, rs = {}, lineM = null, depth = 2 } = o;
  const profile = makeTestProfile();
  if (lineM != null) profile.sets = { ...profile.sets, [set]: { ...profile.sets[set], lineM } };
  const state = makeTestState({ spotId, set, seed, profile });
  const rigStats = makeTestRigStats(set, rs);
  const ctx = makeTestCtx(state, { rigStats, mods: makeTestMods(), refresh() {} });
  const sp = getSpecies(speciesId);
  const roll = o.roll ?? (kg != null ? rollKg(speciesId, kg) : rollAtZ(sp, 0));
  const bearing = o.bearing ?? ctx.spot.facing;
  setDrag(state, rigStats, notch);
  state.rig.phase = 'fighting';
  state.rig.dist = dist;
  state.rig.bearing = bearing;
  state.fight = createFight(ctx, { speciesId, roll, dist, bearing, depth });
  return { state, ctx, f: state.fight, rs: rigStats, sp, brain: buildBrain(sp) };
}
function setDrag(state, rs, notch) {
  state.rig.dragNotch = clamp(notch, 0, rs.dragNotches);
  state.rig.dragKg = state.rig.dragNotch * rs.dragNotchKg;
}
/** GameSim 처럼 prev 를 복사하고 한 틱 */
function tick(env, inp = {}) {
  const f = env.state.fight;
  f.prevDist = f.dist;
  f.prevBearing = f.bearing;
  return updateFight(env.ctx, makeInput(inp));
}
/** 행동 상태를 고정한다(지속 시간을 길게 — 상태 기계가 바꾸지 않게) */
function force(env, name, dur = 1e4) {
  const f = env.f;
  f.telegraph = null;
  f.brain.pending = null;
  f.behaviorName = name;
  f.behavior = env.brain.states[name].kind;
  f.behaviorT = 0;
  f.behaviorDur = dur;
}
/** ctx.rng.chance 의 확률을 기록하는 감시(값은 원래 난수 그대로) */
function spyChance(env) {
  const calls = [];
  const orig = env.ctx.rng.chance;
  env.ctx.rng.chance = (p) => {
    calls.push(p);
    return orig(p);
  };
  return calls;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 시작 상태

test('createFight — §3.4 의 필드 전부 · §5.3.1 상수 · halfArc · minDist · netRangeM', () => {
  const env = setup({ speciesId: 'carp', kg: 3, dist: 22 });
  const { f, ctx, rs } = env;
  assertShape(f, 'FightState');
  assertShape(f.stats, 'FightStats');
  assertFiniteDeep(f, 'fight');
  const k = fightConstants(getSpecies('carp'), f.roll);
  assert.ok(near(f.k.Fmax, k.Fmax) && near(f.k.vmax, k.vmax) && near(f.k.endurance, k.endurance));
  assert.ok(near(k.Fmax, 1.3 * Math.pow(f.roll.weightKg, 0.75)));
  assert.equal(f.minDist, ctx.spot.edgeM + FIGHT.minDistPad);
  assert.equal(f.netRangeM, ctx.spot.edgeM + rs.netReachM);
  assert.equal(f.halfArc, Math.min(FIGHT.maxArc, ctx.spot.arc + FIGHT.bearingSlack));
  assert.equal(f.stamina, 1);
  assert.equal(f.tension, 0);
  assert.equal(f.lineKg, rs.lineKg);
  assert.equal(f.landStamina, rs.landStamina);
  assert.equal(f.spoolLeftM, 120 - 22);
  // 흘린 찌에서 건 물고기 — 시작 방위가 허용 반각 안(순간이동 없음)
  const off = setup({ speciesId: 'carp', bearing: 1.0 });
  assert.ok(near(off.f.halfArc, Math.min(FIGHT.maxArc, 1.0 + FIGHT.bearingSlack)));
  assert.ok(Math.abs(angleDiff(off.ctx.spot.facing, off.f.bearing)) <= off.f.halfArc);
});

test('시작 예고 — 질주류로 시작하면 startTele 예고, 버팀으로 시작하면 바로 FIGHT_BEHAVIOR', () => {
  const run = setup({ speciesId: 'steedBarbel' });      // runner — 시작 'run'
  assert.deepEqual(run.f.telegraph, { kind: 'run', remaining: FIGHT.startTele, total: FIGHT.startTele });
  assert.equal(countEvents(run.ctx.events, EV.FIGHT_TELEGRAPH), 1);
  assert.equal(run.ctx.events.find(e => e.name === EV.FIGHT_TELEGRAPH).payload.lead, FIGHT.startTele);
  let n = 0;
  while (run.f.telegraph && n < 120) { tick(run, { primary: true }); n++; }
  assert.equal(n, Math.round(FIGHT.startTele / DT), '예고는 startTele 동안');
  assert.equal(run.f.behavior, 'run');
  assert.ok(countEvents(run.ctx.events, EV.FIGHT_BEHAVIOR) >= 1);

  const hold = setup({ speciesId: 'crucian' });         // heavy — 시작 'hold'
  assert.equal(hold.f.telegraph, null);
  assert.equal(hold.f.behavior, 'hold');
  assert.equal(countEvents(hold.ctx.events, EV.FIGHT_BEHAVIOR), 1);
  assert.ok(hold.f.behaviorDur >= 3 && hold.f.behaviorDur <= 5);
});

// ── 드랙

test('드랙 아래면 버티고(감기면 다가온다) · 넘으면 미끄러지며 라인이 풀리고 텐션은 드랙에 묶인다', () => {
  // 버팀: 작은 붕어 · 드랙 5kg
  const a = setup({ speciesId: 'crucian', notch: 20, dist: 20 });
  force(a, 'hold');
  for (let i = 0; i < 120; i++) tick(a, { primary: true });
  assert.equal(a.f.slipping, false);
  assert.ok(a.f.dist < 20 - 1, `감으면 다가온다 (${a.f.dist})`);
  assert.ok(a.f.tension < a.state.rig.dragKg);
  // 미끄러짐: 9kg 잉어 · 드랙 1.5kg
  const b = setup({ speciesId: 'carp', kg: 9, notch: 6, dist: 15 });
  force(b, 'hold');
  const d0 = b.f.dist;
  for (let i = 0; i < 120; i++) tick(b);
  assert.equal(b.f.slipping, true);
  assert.ok(b.f.slipSpeed > 0 && b.f.dist > d0, '라인이 풀려 나간다');
  assert.ok(near(b.f.tension, b.state.rig.dragKg, 0.02), `텐션 ${b.f.tension} ≈ 드랙 ${b.state.rig.dragKg}`);
  assert.ok(b.f.stats.slipTicks > 0);
  assert.ok(countEvents(b.ctx.events, EV.FIGHT_SLIP) >= 1);
});

test('정지 마찰 — 미끄러지기 시작한 stickTime 동안 드랙 위로 과부하 · 챔질 뒤 hookGrace 동안은 없다', () => {
  // 챔질 직후: 처음부터 미끄러져도 드랙을 넘지 않는다
  const a = setup({ speciesId: 'carp', kg: 9, notch: 4 });
  force(a, 'hold');
  let maxEarly = 0;
  while (a.f.t <= FIGHT.hookGrace - DT) { tick(a); maxEarly = Math.max(maxEarly, a.f.tension); }
  assert.ok(maxEarly <= a.state.rig.dragKg + 1e-9, `hookGrace 안 최대 ${maxEarly} ≤ 드랙 ${a.state.rig.dragKg}`);
  // hookGrace 뒤: 버티다가 드랙을 풀면 과부하가 생긴다
  const b = setup({ speciesId: 'carp', kg: 9, notch: 20 });
  force(b, 'hold');
  for (let i = 0; i < 90; i++) tick(b);
  assert.equal(b.f.slipping, false);
  setDrag(b.state, b.rs, 8);                               // 2kg
  let maxStick = 0;
  for (let i = 0; i < Math.round(FIGHT.stickTime / DT); i++) { tick(b); maxStick = Math.max(maxStick, b.f.tension); }
  assert.ok(maxStick > b.state.rig.dragKg + 0.2, `과부하 ${maxStick} > 드랙 ${b.state.rig.dragKg}`);
  for (let i = 0; i < 60; i++) tick(b);
  assert.ok(near(b.f.tension, b.state.rig.dragKg, 0.02), 'stickTime 뒤에는 드랙으로 내려온다');
});

// ── 실패

test('라인 끊김 — 텐션 > 유효 강도(드랙을 라인보다 높이 잠그면) · lineLostM = round(dist) · FIGHT_END', () => {
  const env = setup({ speciesId: 'carp', kg: 12, notch: 20, dist: 18.4 });
  force(env, 'run');
  let o = null;
  for (let i = 0; i < 600 && !o; i++) o = tick(env);
  assert.ok(o, '끊긴다');
  assert.equal(o.type, 'lineBreak');
  assert.equal(o.lineLostM, Math.round(env.f.dist));
  assert.equal(o.cause, null);
  assert.equal(o.hookSmall, true, '입 3 · 바늘 2');
  const end = env.ctx.events.find(e => e.name === EV.FIGHT_END);
  assert.deepEqual(Object.keys(end.payload).sort(), ['cause', 'distM', 'durationSec', 'maxTension', 'outcome']);
  assert.equal(end.payload.outcome, 'lineBreak');
  assert.ok(end.payload.maxTension > env.f.lineEffKg);
});

test('스풀 바닥 — dist ≥ lineM · lineLostM = lineM(먼저 판정)', () => {
  const env = setup({ speciesId: 'carp', kg: 12, notch: 2, dist: 25, lineM: 30 });
  force(env, 'run');
  let o = null;
  for (let i = 0; i < 3600 && !o; i++) o = tick(env);
  assert.equal(o && o.type, 'spoolEmpty');
  assert.equal(o.lineLostM, 30);
});

test('로드 파손 — 세운 채 상한을 rodBreakHold 동안 넘길 때만 · 0.2초 스파이크 · 숙인 로드는 무사', () => {
  const opts = { speciesId: 'carp', kg: 3, notch: 20, rs: { rodMaxLoadKg: 1.0, lineKg: 10 } };
  // 계속 세운다 → 부러진다(상한을 넘긴 첫 틱부터 rodBreakHold 뒤)
  const a = setup(opts);
  force(a, 'hold');
  let o = null;
  let firstOver = -1;
  let last = -1;
  for (let i = 0; i < 600 && !o; i++) {
    o = tick(a, { secondary: true, primary: true });
    if (firstOver < 0 && a.f.rodUp && a.f.tension > 1.0) firstOver = i;
    last = i;
  }
  assert.equal(o && o.type, 'rodBreak');
  assert.equal(o.lineLostM, 0);
  const overSec = (last - firstOver + 1) * DT;            // 상한을 넘긴 틱 수(부러진 틱 포함)
  assert.ok(overSec >= FIGHT.rodBreakHold - 1e-9 && overSec < FIGHT.rodBreakHold + 2 * DT, `상한 초과 ${overSec}초 뒤 파손`);
  assert.ok(countEvents(a.ctx.events, EV.ROD_STRESS) >= 1, '부러지기 전에 rodStress 경고');
  // 0.2초 안의 스파이크 — 세웠다가 바로 숙인다
  const b = setup(opts);
  force(b, 'hold');
  for (let j = 0; j < 60; j++) tick(b, { primary: true });
  let upTicks = 0;
  let res = null;
  for (let j = 0; j < 600 && !res; j++) {
    const sec = j < Math.round((0.5 * FIGHT.pumpLiftTime + 0.1) / DT);
    res = tick(b, { secondary: sec, primary: true });
    if (b.f.rodUp) upTicks++;
  }
  assert.equal(res, null, '스파이크로는 부러지지 않는다');
  assert.ok(upTicks > 0 && upTicks * DT < FIGHT.rodBreakHold);
  // 숙인 로드 — 상한을 한참 넘겨도 파손 없음
  const c = setup(opts);
  force(c, 'hold');
  let r = null;
  for (let j = 0; j < 600 && !r; j++) r = tick(c, { primary: true });
  assert.equal(r, null);
  assert.ok(c.f.tension > 1.0 && c.f.rodOverT === 0);
});

test('바늘 빠짐 · 슬랙 — 텐션이 슬랙 문턱 아래면 위험률이 쌓인다(cause slack)', () => {
  let slackOffs = 0;
  for (let s = 1; s <= 20; s++) {
    const env = setup({ speciesId: 'crucian', seed: s });
    force(env, 'rest');
    env.state.rig.bailOpen = true;                         // 베일을 열면 라인이 늘어진다
    let o = null;
    for (let i = 0; i < 60 * 60 && !o; i++) o = tick(env);
    assert.ok(o, '늘어진 라인은 결국 빠진다');
    if (o.type === 'hookOff' && o.cause === 'slack') slackOffs++;
    assert.ok(env.f.stats.slackTicks > 0);
  }
  assert.equal(slackOffs, 20);
});

test('바늘 빠짐 · 미끄러지는 동안 loose 0 — 흔들기 진입 굴림 확률이 0이 된다(드랙을 풀어 준 대응은 벌받지 않는다)', () => {
  const shakeP = HOOK.shakeP * 1.5;                       // 메기 입 3 · 바늘 2 → hookOffMul 1.5
  /** hold/rest 가 끝나는 틱에 shake 로 들어가게 하고 그 틱의 굴림 확률을 모은다 */
  const enterShake = (env) => {
    const origPick = env.ctx.rng.pick;
    env.ctx.rng.pick = () => 'shake';
    const calls = spyChance(env);
    env.f.behaviorT = env.f.behaviorDur;
    tick(env);
    env.ctx.rng.pick = origPick;
    assert.equal(env.f.behavior, 'shake');
    return calls;
  };
  // 미끄러지는 중(직전 틱 slipping) — 텐션이 드랙에 묶여 있어도 loose 는 0
  const a = setup({ speciesId: 'catfish', kg: 6, notch: 3, seed: 3 });
  force(a, 'hold', 1e4);
  for (let i = 0; i < 30; i++) tick(a);
  assert.equal(a.f.slipping, true);
  const callsA = enterShake(a);
  assert.ok(callsA.includes(0), `진입 굴림 p = 0: ${callsA}`);
  assert.ok(!callsA.some(p => p > 0.01 && p !== 0.5), `큰 굴림이 없다(0.5 는 좌우 부호): ${callsA}`);
  // 같은 진입을 느슨한 라인(버팀 · 텐션 0)에서 하면 p = shakeP × 1 × hookOffMul
  const b = setup({ speciesId: 'catfish', kg: 6, notch: 20, seed: 3 });
  force(b, 'rest', 1e4);
  b.f.tension = 0;
  const callsB = enterShake(b);
  assert.ok(callsB.some(p => near(p, shakeP)), `느슨하면 p = ${shakeP}: ${callsB}`);
});

test('바늘 빠짐 · 흔들기는 상태 진입에 한 번만 굴린다 · FIGHT_SHAKE 펄스', () => {
  const env = setup({ speciesId: 'catfish', kg: 2, notch: 20, seed: 4 });
  force(env, 'rest', 0.5);
  env.f.tension = 0;
  env.ctx.rng.pick = () => 'shake';
  const calls = spyChance(env);
  env.f.behaviorT = env.f.behaviorDur;
  const shakeP = HOOK.shakeP * 1.5;
  let o = null;
  // 흔들기 상태를 지나가는 동안(최대 1.6초)
  for (let i = 0; i < 90 && !o; i++) {
    o = tick(env, { primary: true });
    env.ctx.rng.pick = () => 'rest';
  }
  const rolls = calls.filter(p => near(p, shakeP, 1e-9) || (p > 0.01 && p <= shakeP));
  assert.equal(rolls.length, 1, `흔들기 굴림 ${rolls.length}번`);
  assert.ok(countEvents(env.ctx.events, EV.FIGHT_SHAKE) >= 2, '펄스마다 FIGHT_SHAKE');
});

test('바늘 빠짐 · 점프 — 숙이면 jumpLowP 뿐 · 세우면 jumpPumpP + jumpLooseP × 예고 직전 느슨함', () => {
  const mk = (rodUp) => {
    const env = setup({ speciesId: 'largemouthBass', kg: 1.2, notch: 8, rs: { hookSize: 3 }, seed: 9 });
    force(env, 'rest', 1e4);
    // 점프 예고를 걸어 둔다(예고 직전 느슨함 0.4)
    env.f.telegraph = { kind: 'jump', remaining: DT / 2, total: 0.7 };
    env.f.brain.pending = 'jump';
    env.f.brain.preTeleLoose = 0.4;
    if (rodUp) env.f.rodLift = 1;
    const calls = spyChance(env);
    tick(env, { secondary: rodUp, primary: true });
    assert.equal(env.f.behavior, 'jump');
    assert.ok(env.f.airborne >= 0);
    return { env, calls };
  };
  const low = mk(false);
  assert.ok(low.calls.some(p => near(p, HOOK.jumpLowP)), `숙임: ${low.calls}`);
  const up = mk(true);
  assert.ok(up.calls.some(p => near(p, HOOK.jumpPumpP + HOOK.jumpLooseP * 0.4)), `세움: ${up.calls}`);
  // 공중 시작 · 끝에 FIGHT_JUMP(leave · land)
  const env = low.env;
  let o = null;
  for (let i = 0; i < 120 && !o && env.f.behavior === 'jump'; i++) o = tick(env, { primary: true });
  const phases = env.ctx.events.filter(e => e.name === EV.FIGHT_JUMP).map(e => e.payload.phase);
  if (!o) assert.deepEqual(phases, ['leave', 'land']);
  assert.ok(env.f.stats.jumps >= 1);
});

test('펌핑 — 거리는 rodLift ≥ pumpGainFrom 구간에서만 · 우클릭 10Hz 연타로 거리 이득 없음 · 한 스트로크 ≈ pumpStroke × 0.5', () => {
  const base = () => {
    const env = setup({ speciesId: 'crucian', notch: 20, dist: 20 });
    force(env, 'rest');
    return env;
  };
  // 아무것도 하지 않음 vs 10Hz 연타(3틱 누름 · 3틱 뗌)
  const idle = base();
  const tap = base();
  for (let i = 0; i < 300; i++) {
    tick(idle);
    tick(tap, { secondary: i % 6 < 3 });
  }
  assert.ok(tap.f.rodLift < FIGHT.pumpGainFrom);
  assert.ok(near(tap.f.dist, idle.f.dist, 1e-9), `연타 ${tap.f.dist} = 가만히 ${idle.f.dist}`);
  // 0 → 1 한 스트로크
  const stroke = base();
  const ref = base();
  const n = Math.ceil(FIGHT.pumpLiftTime / DT) + 2;
  for (let i = 0; i < n; i++) {
    tick(stroke, { secondary: true });
    tick(ref);
  }
  const gain = ref.f.dist - stroke.f.dist;
  const Fal = stroke.f.k.Fmax * 0.25 * 0.5;               // 휴식(f 0.25 · along 0.5) — 체력 배율은 1 근처
  const expected = FIGHT.pumpStroke * (1 - FIGHT.pumpGainFrom) * (1 - Fal / stroke.rs.rodMaxLoadKg);
  assert.ok(Math.abs(gain - expected) < 0.05, `스트로크 이득 ${gain} ≈ ${expected}`);
  assert.equal(stroke.f.rodUp, true);
});

test('쓸림 — 잠수는 미끄러질 때만 바닥에 박힌다 · 드랙이 버티면 inCover 0', () => {
  // 바위 바닥(lake_cape abrasion 0.5) · 장애물 띠 밖
  const hold = setup({ speciesId: 'barredKnifejaw', kg: 1.5, notch: 20, spotId: 'lake_cape', dist: 15 });
  force(hold, 'dive');
  for (let i = 0; i < 300; i++) tick(hold, { primary: true });
  assert.equal(hold.f.slipping, false);
  assert.equal(hold.f.inCover, 0);
  assert.equal(hold.f.abrasion, 0);
  const slip = setup({ speciesId: 'barredKnifejaw', kg: 1.5, notch: 1, spotId: 'lake_cape', dist: 15 });
  force(slip, 'dive');
  for (let i = 0; i < 180; i++) tick(slip);
  assert.equal(slip.f.slipping, true);
  assert.ok(slip.f.inCover > 0.5, `박힘 ${slip.f.inCover}`);
  assert.ok(slip.f.abrasion > 0 && slip.f.lineEffKg < slip.f.lineKg);
  // 예고 중에는 박히지 않는다
  const tele = setup({ speciesId: 'barredKnifejaw', kg: 1.5, notch: 1, spotId: 'lake_cape', dist: 15 });
  tele.f.telegraph = { kind: 'dive', remaining: 10, total: 10 };
  tele.f.brain.pending = 'dive';
  for (let i = 0; i < 60; i++) tick(tele);
  assert.equal(tele.f.inCover, 0);
});

test('장애물 띠 — dist ≥ snag.fromM 이면 inSnag · SNAG · 쓸림이 snag.rate × lineAbrasionMul 로 쌓인다', () => {
  const spot = getSpot('lake_gravel');
  const env = setup({ speciesId: 'crucian', notch: 20, dist: spot.snag.fromM + 2 });
  assert.equal(env.f.inSnag, true);
  assert.equal(countEvents(env.ctx.events, EV.SNAG), 1);
  force(env, 'hold');
  for (let i = 0; i < 60; i++) tick(env);
  assert.ok(near(env.f.abrasion, spot.snag.rate * 60 * DT, 1e-9), `쓸림 ${env.f.abrasion}`);
  assert.ok(near(env.f.lineEffKg, env.f.lineKg * (1 - env.f.abrasion)));
  // 띠 밖으로 끌어내면 SNAG off
  for (let i = 0; i < 600 && env.f.inSnag; i++) tick(env, { primary: true });
  assert.equal(env.f.inSnag, false);
  assert.equal(env.ctx.events.filter(e => e.name === EV.SNAG).at(-1).payload.on, false);
});

test('밸런스 게이트: 쓸림이 maxAbrasion 에 닿은 라인을 물고기가 끌고 나가면 끊긴다(cause abrasion) · 감아 들이는 중이면 버틴다', () => {
  const spot = getSpot('lake_gravel');
  // 띠 안 · 드랙 아주 낮게(조절 봇이 유효 강도에 맞춰 내린 모양) → 물고기가 계속 끌고 나간다 → 몇 분짜리 헛판이 아니라 끊김
  const env = setup({ speciesId: 'carp', kg: 6, notch: 1, dist: spot.snag.fromM + 2 });
  force(env, 'hold');
  let o = null;
  let t = 0;
  for (; t < 60 * 60 && !o; t++) o = tick(env);
  assert.ok(o, '끝난다');
  assert.equal(o.type, 'lineBreak');
  assert.equal(o.cause, 'abrasion');
  const limitS = FIGHT.maxAbrasion / spot.snag.rate + 1;
  assert.ok(t * DT <= limitS, `띠에 들어간 뒤 ${(t * DT).toFixed(1)}초(≤ ${limitS.toFixed(1)}) 안에 끝난다`);
  assert.equal(env.ctx.events.filter(e => e.name === EV.FIGHT_END).at(-1).payload.cause, 'abrasion');
  // 쓸림이 끝까지 찼어도 미끄러지지 않으면(작은 물고기를 감아 들이는 중) 끊기지 않는다
  const small = setup({ speciesId: 'crucian', kg: 0.3, notch: 10, dist: spot.snag.fromM + 2 });
  force(small, 'rest');
  small.f.abrasion = FIGHT.maxAbrasion;
  let o2 = null;
  for (let i = 0; i < 30 && !o2; i++) o2 = tick(small, { primary: true });
  assert.equal(o2, null, '감아 들이는 동안 버틴다');
  assert.equal(small.f.slipping, false);
  // 텐션으로 끊겨도 쓸림이 frayCauseAt 이상이면 원인 abrasion · 그 아래면 null
  const brk = setup({ speciesId: 'carp', kg: 6, notch: 20, dist: 20 });
  force(brk, 'hold');
  brk.f.abrasion = FIGHT.frayCauseAt;
  let o3 = null;
  for (let i = 0; i < 600 && !o3; i++) o3 = tick(brk);
  assert.equal(o3 && o3.type, 'lineBreak');
  assert.equal(o3.cause, 'abrasion');
});

test('밸런스 게이트: 쉬는 물고기를 감아 들이는 동안은 슬랙이 아니다(3단계 라인) · 손을 놓으면 슬랙', () => {
  // 3단계 라인 18kg → 슬랙 문턱 = min(0.06 × 18, 0.2 × Fmax). 지친 돌돔(2.4kg)을 감는 텐션은 문턱 아래다
  const mk = () => {
    const env = setup({ speciesId: 'barredKnifejaw', kg: 2.4, spotId: 'coast_cape', notch: 6, dist: 20, rs: { lineKg: 18, reelMaxDragKg: 16, dragNotchKg: 0.8, reelSpeedMS: 2.0 } });
    force(env, 'rest');
    env.f.stamina = 0;                                     // 지친 물고기(흔적: 체력 0 · 쉬는 중 · 감는 텐션 0.67 < 문턱 0.78)
    return env;
  };
  const reel = mk();
  const slackKg = Math.min(HOOK.slackFracLine * 18, HOOK.slackFracFish * reel.f.k.Fmax);
  let below = 0;
  for (let i = 0; i < 180; i++) {
    tick(reel, { primary: true });
    if (reel.f.tension < slackKg) below++;
    assert.equal(reel.f.slack, false, `감는 중 슬랙 아님 @${i}`);
  }
  assert.ok(below > 60, `텐션이 문턱(${slackKg.toFixed(2)}) 아래였던 틱 ${below} — 이 경우를 시험한다`);
  assert.ok(reel.f.dist < 20 - 3, '감겨 들어온다');
  assert.equal(reel.f.slackTime, 0);
  // 손을 놓으면(감지 않으면) 슬랙이 쌓인다
  const idle = mk();
  for (let i = 0; i < 120; i++) tick(idle);
  assert.ok(idle.f.slackTime > 1, `손을 놓으면 슬랙 ${idle.f.slackTime.toFixed(2)}초`);
});

test('charge — 감으며 세우는 동안은 슬랙이 없고, 가만히 있으면 슬랙이 쌓인다', () => {
  const run = (hands) => {
    const env = setup({ speciesId: 'paleKing', kg: 22, notch: 20, dist: 25, rs: { hookSize: 3 } });
    force(env, 'rest');
    for (let i = 0; i < 60; i++) tick(env, { primary: true });   // 라인이 팽팽한 상태에서
    force(env, 'vanish', 1.5);
    env.f.rodLift = FIGHT.pumpGainFrom;                    // 예고(0.5초) 동안 로드를 세우기 시작했다
    let slackLifting = 0;
    let slack = 0;
    for (let i = 0; i < 90; i++) {
      const lifting = !!hands.secondary && env.f.rodLift < 1;
      tick(env, hands);
      if (env.f.slack) {
        slack++;
        if (lifting) slackLifting++;
      }
    }
    return { slack, slackLifting };
  };
  const idle = run({});
  assert.ok(idle.slack > 45, `가만히: 슬랙 ${idle.slack}틱`);
  const reel = run({ primary: true, secondary: true });
  assert.equal(reel.slackLifting, 0, '감으며 세우는 동안 슬랙 0');
  assert.ok(reel.slack < idle.slack - 15, `감으며 세움 ${reel.slack} < 가만히 ${idle.slack}`);
});

test('최소 거리 — 물고기는 spot.edgeM + minDistPad 보다 가까이 오지 않는다', () => {
  const env = setup({ speciesId: 'bluegill', notch: 20, dist: 8 });
  force(env, 'rest');
  for (let i = 0; i < 600; i++) {
    tick(env, { primary: true, secondary: i % 60 < 40 });
    assert.ok(env.f.dist >= env.f.minDist - 1e-12);
  }
  assert.equal(env.f.dist, env.f.minDist);
});

test('방위 — 가까울수록 정면 쪽으로 좁아지는 허용 반각(halfArc) 안에 머문다', () => {
  for (let s = 1; s <= 8; s++) {
    const env = setup({ speciesId: 'rabbitfish', kg: 0.8, notch: 6, dist: 20, seed: s, bearing: 0.5 });
    let o = null;
    for (let i = 0; i < 60 * 40 && !o; i++) {
      o = tick(env, { primary: env.f.tension < 1.5 });
      const allowed = lerp(FIGHT.nearArc, env.f.halfArc, clamp(env.f.dist / FIGHT.nearDist, 0, 1));
      assert.ok(Math.abs(angleDiff(env.ctx.spot.facing, env.f.bearing)) <= allowed + 1e-9);
    }
  }
});

test('연출 값 — depth 는 0 이상 · 잠수는 바닥으로 · 예고 중 teleDepth 위로', () => {
  const env = setup({ speciesId: 'barredKnifejaw', kg: 1.5, notch: 3, spotId: 'lake_cape', dist: 20, depth: 1 });
  force(env, 'dive');
  for (let i = 0; i < 600; i++) tick(env);
  const spot = getSpot('lake_cape');
  assert.ok(Math.abs(env.f.depth - piecewise(spot.depth, env.f.dist)) < 0.5, `잠수 깊이 ${env.f.depth}`);
  env.f.telegraph = { kind: 'run', remaining: 100, total: 100 };
  for (let i = 0; i < 600; i++) tick(env);
  assert.ok(env.f.depth <= FIGHT.teleDepth + 1e-9 && env.f.depth >= 0);
});

// ── 뜰채

/** 뜰채 범위 안 · 지친 물고기 */
function tiredNear(seed = 1) {
  const env = setup({ speciesId: 'crucian', notch: 20, dist: 3, seed });
  force(env, 'rest');
  env.f.stamina = 0.05;
  env.f.dist = env.f.netRangeM - 0.2;
  return env;
}

test('뜰채 — canNet 이 뜬 뒤 Space · NET_READY · NET_START · FIGHT_END{landed}', () => {
  const env = tiredNear();
  tick(env);
  assert.equal(env.f.canNet, true);
  assert.equal(env.ctx.events.filter(e => e.name === EV.NET_READY).at(-1).payload.on, true);
  const o = tick(env, { hook: true });
  assert.equal(o.type, 'net');
  assert.equal(o.lineLostM, 0);
  const net = env.ctx.events.find(e => e.name === EV.NET_START);
  assert.ok(net && Number.isFinite(net.payload.x) && Number.isFinite(net.payload.z) && near(net.payload.lengthM, env.f.roll.lengthCm / 100));
  assert.equal(env.ctx.events.find(e => e.name === EV.FIGHT_END).payload.outcome, 'landed');
});

test('뜰채 우선 — 같은 틱에 라인이 끊길 상황이어도 직전 틱의 canNet + Space 면 뜰채', () => {
  const mk = () => {
    const env = tiredNear(2);
    tick(env);
    assert.equal(env.f.canNet, true);
    env.f.lineKg = 0.001;                                // 이번 틱에 끊길 라인
    return env;
  };
  const a = mk();
  assert.equal(tick(a, { hook: true }).type, 'net');
  const b = mk();
  assert.equal(tick(b).type, 'lineBreak');
});

test('뜰채 선입력 — canNet 직전 netBufferS 안의 Space 는 씹히지 않는다 · 지나면 사라진다', () => {
  const mk = () => {
    const env = setup({ speciesId: 'crucian', notch: 20, dist: 3 });
    force(env, 'rest');
    env.f.stamina = 0.05;
    env.f.dist = env.f.netRangeM + 0.3;                  // 아직 범위 밖
    return env;
  };
  const a = mk();
  tick(a, { hook: true });                               // 프롬프트 전 Space
  assert.equal(a.f.canNet, false);
  assert.ok(a.f.netBuffer > 0);
  let o = null;
  for (let i = 0; i < Math.round(FIGHT.netBufferS / DT) && !o; i++) o = tick(a, { primary: true });
  assert.equal(o && o.type, 'net', '버퍼 안에 canNet 이 되면 그 틱에 뜰채');
  // 버퍼보다 늦게 canNet 이 되면 뜰채가 아니다
  const b = mk();
  b.f.dist = b.f.netRangeM + 5;
  tick(b, { hook: true });
  let r = null;
  for (let i = 0; i < 400 && !r; i++) r = tick(b, { primary: true });
  assert.ok(b.f.canNet || r === null);
  assert.ok(!r || r.type !== 'net');
  assert.equal(b.f.netBuffer, 0);
});

test('뜰채 범위 재질주 — 체력이 남은 물고기는 범위에 들어오면 한 번 질주한다(netRunReset 전까지 한 번)', () => {
  const env = setup({ speciesId: 'crucian', notch: 20, dist: 3 });
  force(env, 'rest');
  env.f.stamina = 0.8;
  env.f.dist = env.f.netRangeM - 0.1;
  tick(env);
  assert.equal(env.f.brain.netRunUsed, true);
  assert.ok(env.f.telegraph && env.f.telegraph.kind === 'run', '예고를 거쳐 질주');
  // 같은 범위 안에서는 다시 하지 않는다
  for (let i = 0; i < 120; i++) tick(env);
  force(env, 'rest');
  env.f.dist = env.f.netRangeM - 0.1;
  tick(env);
  assert.equal(env.f.telegraph, null);
  // 멀어지면(netRangeM + netRunReset) 다시 쓸 수 있다
  env.f.dist = env.f.netRangeM + FIGHT.netRunReset + 0.5;
  tick(env);
  assert.equal(env.f.brain.netRunUsed, false);
});

// ── 견고성

test('NaN 없음 · 큰 체력 · 베일 · 무작위 손 — 36종 중 성격별 대표가 예외 없이 끝난다', () => {
  const ids = ['crucian', 'carp', 'israeliCarp', 'catfish', 'steedBarbel', 'mandarinFish', 'largemouthBass', 'bluegill', 'bullhead',
    'barredKnifejaw', 'morayEel', 'rabbitfish', 'opaleye', 'steelhead', 'paleKing', 'whiteSturgeon', 'zombieShark'];
  for (const [i, id] of ids.entries()) {
    const env = setup({ speciesId: id, roll: rollAtZ(getSpecies(id), (i % 5) - 1.5), notch: 8, dist: 25, seed: 40 + i, rs: { hookSize: 3 } });
    const rng = makeRng(seedRng(i + 1));
    let o = null;
    for (let t = 0; t < 60 * 120 && !o; t++) {
      if (t % 30 === 0) setDrag(env.state, env.rs, env.state.rig.dragNotch + rng.int(-2, 2));
      if (t % 97 === 0) env.state.rig.bailOpen = rng.chance(0.1);
      o = tick(env, { primary: rng.chance(0.6), secondary: rng.chance(0.3), hook: rng.chance(0.01) });
      if (t % 60 === 0) assertFiniteDeep(env.f, `fight(${id})`);
    }
    assertFiniteDeep(env.f, `fight(${id})`);
    assert.ok(env.f.stamina >= 0 && env.f.stamina <= 1);
    assert.ok(env.f.abrasion <= FIGHT.maxAbrasion);
    JSON.stringify(env.state.fight);                       // 순수 객체
    structuredClone(env.state.fight);
  }
});

test('고정 상태(debug/fixtures)의 파이팅에서 이어 돌아도 예외 · NaN 없이 끝난다', () => {
  for (const name of FIXTURE_NAMES) {
    const state = makeFixtureState(name);
    if (!state.fight || state.rig.phase !== 'fighting') continue;
    const ctx = makeTestCtx(state, { refresh() {} });
    const pol = createFightPolicy('basic', 1);
    let o = null;
    for (let i = 0; i < 60 * 900 && !o; i++) {
      const h = pol.decide(state, ctx.rigStats);
      if (h.dragSteps) setDrag(state, ctx.rigStats, state.rig.dragNotch + h.dragSteps);
      o = updateFight(ctx, makeInput(h));
      if (i % 120 === 0 && !o) assertFiniteDeep(state.fight, `${name}.fight`);
    }
    assert.ok(o, `${name}: 끝난다`);
  }
});

// ── 봇의 손(§12.1)

test('봇의 손 — 드랙은 2틱에 1눈금까지 · 숨은 값(speciesId · k · brain · stamina)을 읽지 않는다', () => {
  for (const strat of ['basic', 'controlled', 'mindless', 'locked']) {
    const env = setup({ speciesId: 'israeliCarp', kg: 3, notch: 0, dist: 25 });
    const hidden = new Set(['speciesId', 'k', 'brain', 'stamina', 'roll']);
    const read = [];
    const proxyFight = new Proxy(env.f, { get(t, p) { if (hidden.has(String(p))) read.push(String(p)); return t[p]; } });
    const view = { ...env.state, fight: proxyFight };
    const pol = createFightPolicy(strat, 1);
    let prev = 0;
    let o = null;
    for (let i = 0; i < 60 * 60 && !o; i++) {
      const h = pol.decide(view, env.rs);
      assert.ok(Math.abs(h.dragSteps) <= 1);
      assert.ok(!(prev !== 0 && h.dragSteps !== 0), `${strat}: 연속 두 틱 드랙 조작`);
      prev = h.dragSteps;
      if (h.dragSteps) setDrag(env.state, env.rs, env.state.rig.dragNotch + h.dragSteps);
      o = tick(env, h);
    }
    assert.deepEqual(read, [], `${strat} 가 숨은 값을 읽었다: ${[...new Set(read)]}`);
  }
});

test('봇 전략의 드랙 목표 — basic 30% · locked 85% · mindless 최대 · controlled 질주 예고에 푼다', () => {
  const settle = (strat, env, ticks = 120) => {
    const pol = createFightPolicy(strat, 1);
    for (let i = 0; i < ticks; i++) {
      const h = pol.decide(env.state, env.rs);
      if (h.dragSteps) setDrag(env.state, env.rs, env.state.rig.dragNotch + h.dragSteps);
      if (!env.state.fight) break;
    }
    return pol;
  };
  const a = setup({ speciesId: 'crucian', notch: 0 });
  settle('basic', a);
  assert.equal(a.state.rig.dragNotch, Math.round(BOT.basic.dragRatio * a.rs.lineKg / a.rs.dragNotchKg));
  const b = setup({ speciesId: 'crucian', notch: 0 });
  settle('locked', b);
  assert.equal(b.state.rig.dragNotch, Math.round(BOT.locked.dragRatio * b.rs.lineKg / b.rs.dragNotchKg));
  const c = setup({ speciesId: 'crucian', notch: 0 });
  settle('mindless', c);
  assert.equal(c.state.rig.dragNotch, c.rs.dragNotches);
  // controlled: 휴식이면 0.70 × 유효 강도(로드 0.9 × 상한 아래), 질주 예고를 반응 시간 뒤 0.45
  const d = setup({ speciesId: 'crucian', notch: 0 });
  force(d, 'rest');
  const pol = settle('controlled', d);
  const restKg = Math.min(BOT.controlled.restDrag * d.f.lineEffKg, d.rs.reelMaxDragKg, BOT.controlled.rodCap * d.rs.rodMaxLoadKg);
  assert.equal(d.state.rig.dragNotch, Math.floor(restKg / d.rs.dragNotchKg));
  d.f.telegraph = { kind: 'run', remaining: 1, total: 1 };
  for (let i = 0; i < 60; i++) {
    const h = pol.decide(d.state, d.rs);
    if (h.dragSteps) setDrag(d.state, d.rs, d.state.rig.dragNotch + h.dragSteps);
  }
  assert.equal(d.state.rig.dragNotch, Math.floor(BOT.controlled.runDrag * d.f.lineEffKg / d.rs.dragNotchKg));
});

// ── 미니 측정(§7.12 · §12.5 M1 · M5 · M7) — 호수 자갈 · 1단계 바닥 세트 · lakeDay 시간대 섞기

/** 파이팅 한 판을 봇 손으로 끝까지. 드랙 눈금은 판 사이에 이어진다(사람의 릴처럼) */
function botFight({ speciesId, roll, strategy, seed, rs, dist, notch }) {
  const state = makeTestState({ spotId: 'lake_gravel', set: 'bottom', seed });
  const ctx = makeTestCtx(state, { rigStats: rs, mods: makeTestMods(), refresh() {} });
  const spot = ctx.spot;
  setDrag(state, rs, notch);
  state.rig.phase = 'fighting';
  state.rig.dist = dist;
  state.rig.bearing = spot.facing;
  state.fight = createFight(ctx, { speciesId, roll, dist, bearing: spot.facing, depth: piecewise(spot.depth, dist) });
  const f = state.fight;
  const pol = createFightPolicy(strategy, seed);
  const input = makeInput();
  for (let i = 0; i < 60 * 900; i++) {
    f.prevDist = f.dist;
    f.prevBearing = f.bearing;
    const h = pol.decide(state, rs);
    if (h.dragSteps) setDrag(state, rs, state.rig.dragNotch + h.dragSteps);
    input.primary = h.primary;
    input.secondary = h.secondary;
    input.hook = h.hook;
    input.dragSteps = h.dragSteps;
    const o = updateFight(ctx, input);
    state.events.length = 0;
    ctx.events.length = 0;
    if (o) return { o, f, notch: state.rig.dragNotch };
  }
  return { o: { type: 'timeout', durationSec: f.t }, f, notch: state.rig.dragNotch };
}

/** n 판 — large 면 잉어 · 향어 · 메기의 ≥ 5kg 구간에서 크기를 뽑는다(§12.5 M1 · M5) */
function measure(strategy, n, { large = false, seedBase = 1234 } = {}) {
  const rs = makeTestRigStats('bottom');
  const mix = large ? { carp: 0.6, israeliCarp: 0.6, catfish: 0.4 } : lakeDayMix('lake_gravel', rs.hookSize);
  const rng = makeRng(seedRng(seedBase));
  let notch = 5;
  const r = { n: 0, landed: 0, types: {}, small: [], mid: [], big: [], midN: 0, midLanded: 0, midRod: 0, timeouts: 0 };
  for (let i = 0; i < n; i++) {
    const id = /** @type {string} */ (rng.pick(mix));
    const sp = getSpecies(id);
    let z = rng.normal();
    if (large) {
      const u0 = normalCdf(zForKg(sp, 5));
      const u1 = normalCdf(BITE.zMax);
      z = normalInv(u0 + (u1 - u0) * rng.next());
    }
    const roll = rollAtZ(sp, z);
    const res = botFight({ speciesId: id, roll, strategy, seed: seedBase + i, rs, dist: botCastDist(rng, rs), notch });
    notch = res.notch;
    r.n++;
    r.types[res.o.type] = (r.types[res.o.type] ?? 0) + 1;
    if (res.o.type === 'timeout') r.timeouts++;
    const W = roll.weightKg;
    const landed = res.o.type === 'net';
    if (landed) {
      r.landed++;
      // 한 판 = 입질 신호 2초 + 파이팅 + 뜰채 0.8초(§7.12)
      (W < 1 ? r.small : W < 5 ? r.mid : r.big).push(res.o.durationSec + 2 + 0.8);
    }
    if (W >= 1) {
      r.midN++;
      if (landed) r.midLanded++;
      if (res.o.type === 'rodBreak') r.midRod++;
    }
  }
  return r;
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const pct = (x) => `${(100 * x).toFixed(1)}%`;

test('봇 전략 넷 미니 측정(§7.12) — 한 판 길이 · 랜딩률 · 드랙 의미(고정 포함) · 파손 빈도', (t) => {
  const N = 2000;
  const basic = measure('basic', N);
  const controlled = measure('controlled', N);
  const mindless = measure('mindless', N);
  const L = Math.round(N / 3);
  const basicL = measure('basic', L, { large: true, seedBase: 4321 });
  const controlledL = measure('controlled', L, { large: true, seedBase: 4321 });
  const lockedL = measure('locked', L, { large: true, seedBase: 4321 });

  const land = (r) => r.landed / r.n;
  const midLand = (r) => r.midLanded / r.midN;
  const rod = (r) => r.midRod / r.midN;
  const big = [...basic.big, ...basicL.big];
  const rows = [
    ['basic', basic], ['controlled', controlled], ['mindless', mindless],
    ['basic 대형', basicL], ['controlled 대형', controlledL], ['locked 대형', lockedL],
  ];
  for (const [name, r] of rows) {
    t.diagnostic(`${name.padEnd(16)} 랜딩 ${pct(land(r))} · 중형 이상 ${pct(midLand(r))}(${r.midN}) · 파손 ${pct(rod(r))} · ${JSON.stringify(r.types)}`);
  }
  t.diagnostic(`한 판(기본 봇) 중앙값: 소 ${median(basic.small).toFixed(1)}초(${basic.small.length}) · 중 ${median(basic.mid).toFixed(1)}초(${basic.mid.length}) · 대 ${median(big).toFixed(1)}초(${big.length})`);

  for (const [, r] of rows) assert.equal(r.timeouts, 0, '15분 안에 끝난다');
  // M1 — 한 판 길이(기본 봇)
  assert.ok(median(basic.small) >= 10 && median(basic.small) <= 25, `소 ${median(basic.small)}`);
  assert.ok(median(basic.mid) >= 25 && median(basic.mid) <= 60, `중 ${median(basic.mid)}`);
  assert.ok(big.length >= 30, `대형 랜딩 표본 ${big.length}`);
  assert.ok(median(big) >= 60 && median(big) <= 150, `대 ${median(big)}`);
  // 파이팅 대비 랜딩(기본 봇 ≈ 85% — 챔질 0.9 와 곱해 M4 의 60–80%)
  assert.ok(land(basic) >= 0.75 && land(basic) <= 0.93, `기본 랜딩 ${land(basic)}`);
  // M5 — 드랙 의미
  assert.ok(midLand(controlled) - midLand(mindless) >= 0.25, `조절 − 무지성 ${midLand(controlled) - midLand(mindless)}`);
  assert.ok(midLand(controlled) - midLand(basic) >= 0.10, `조절 − 기본 ${midLand(controlled) - midLand(basic)}`);
  assert.ok(land(controlledL) - land(lockedL) >= 0.10, `대형 조절 − 고정 ${land(controlledL) - land(lockedL)}`);
  assert.ok(land(lockedL) <= 0.60, `고정의 대형 랜딩 ${land(lockedL)}`);
  // M7 — 로드 파손(중형 이상 파이팅당)
  assert.ok(rod(controlled) <= 0.02, `조절 파손 ${rod(controlled)}`);
  assert.ok(rod(basic) <= 0.05, `기본 파손 ${rod(basic)}`);
  assert.ok(rod(mindless) >= 0.15, `무지성 파손 ${rod(mindless)}`);
});
