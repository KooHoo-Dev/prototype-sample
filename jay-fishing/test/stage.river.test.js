// OWNER: P12 — 계약 §12.2(stage test) · §7.4.4 · §7.3.3 · §9.4
// 강 스테이지: 데이터 완결성 · 자리마다 createAngler(기본/조절) 100판 · 꼬리물 흘림이 땅으로 가지 않는다 · 먼 곳(farFromM) ·
// 페일 킹 조건(흐림 · 새벽)과 「사라짐」 슬랙 · 흰철갑상어로 본 장비 의미(M6) · riverProps 가 Node 에서 만들어진다(three 만).
// 실제 구현(GameSim · rig · fight · progression · angler · policy) 위에서 돈다 — 같은 웨이브의 P10 봇은 쓰지 않는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BAND_IDS, LAYER_IDS, RIG_PHASES, WEATHER_IDS } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { angleDiff, pointInConvex, shoreZAt, yawOf } from '../src/core/math.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { CAST } from '../src/data/bite.js';
import { RIVER_SPECIES } from '../src/data/species/river.js';
import { getSpecies } from '../src/data/species/index.js';
import { RIVER } from '../src/data/stages/river.js';
import { GameSim } from '../src/sim/GameSim.js';
import { biteWeights, pickSpecies } from '../src/sim/fishing/biteModel.js';
import { createNewProfile } from '../src/sim/progression/profile.js';
import { createAngler } from '../src/bot/angler.js';
import { createFightPolicy } from '../src/bot/policy.js';
import { buildRiverProps } from '../src/view/stages/riverProps.js';
import { createTerrainField } from '../src/view/world/terrain.js';
import { assertFiniteDeep, makeTestRigStats } from './helpers.js';

const BOT_COMMANDS = new Set(['keepCatch', 'releaseCatch', 'sellAll', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth', 'learnSkill', 'travel', 'waitNextBand', 'sleep', 'exitFishing']);
const RIVER_IDS = ['whiteSturgeon', 'chinookSalmon', 'steelhead', 'walleye', 'smallmouthBass', 'channelCatfish', 'americanShad', 'pikeminnow', 'cutthroatTrout', 'largescaleSucker', 'burbot', 'paleKing'];

// §7.3.3 의 🔒 값(밸런스 게이트만 바꾼다) — 시드에서 몰래 바뀌지 않았는지
const LOCKED = {
  whiteSturgeon: { style: 'heavy', fight: { stamina: 2.5 }, lenCm: [90, 300], kg: [5, 150], pricePerKg: 1400, trophyBonus: 0.5, xp: 52 },
  chinookSalmon: { style: 'runner', fight: { force: 1.15 }, lenCm: [60, 130], kg: [3, 25], pricePerKg: 5500, trophyBonus: 0.4, xp: 39 },
  steelhead: { style: 'jumper', fight: undefined, lenCm: [50, 100], kg: [2, 10], pricePerKg: 6000, trophyBonus: 0.4, xp: 29 },
  walleye: { style: 'heavy', fight: { force: 0.8 }, lenCm: [30, 80], kg: [0.4, 7], pricePerKg: 4500, trophyBonus: 0.3, xp: 16 },
  smallmouthBass: { style: 'jumper', fight: undefined, lenCm: [20, 50], kg: [0.2, 3], pricePerKg: 4500, trophyBonus: 0.35, xp: 13 },
  channelCatfish: { style: 'heavy', fight: undefined, lenCm: [30, 90], kg: [0.5, 12], pricePerKg: 3000, trophyBonus: 0.3, xp: 14 },
  americanShad: { style: 'thrasher', fight: { force: 0.8, speed: 1.3 }, lenCm: [30, 55], kg: [0.4, 2.5], pricePerKg: 3500, trophyBonus: 0.3, xp: 10 },
  pikeminnow: { style: 'small', fight: undefined, lenCm: [20, 50], kg: [0.2, 2], pricePerKg: 2500, trophyBonus: 0.3, xp: 7 },
  cutthroatTrout: { style: 'thrasher', fight: { force: 0.85 }, lenCm: [20, 45], kg: [0.2, 1.5], pricePerKg: 6500, trophyBonus: 0.35, xp: 12 },
  largescaleSucker: { style: 'heavy', fight: { force: 0.8 }, lenCm: [25, 55], kg: [0.3, 2.5], pricePerKg: 2000, trophyBonus: 0.3, xp: 7 },
  burbot: { style: 'heavy', fight: undefined, lenCm: [30, 80], kg: [0.4, 5], pricePerKg: 3800, trophyBonus: 0.3, xp: 16 },
  paleKing: { style: 'runner', fight: { stamina: 1.2 }, lenCm: [100, 180], kg: [15, 50], pricePerKg: 5000, trophyBonus: 0.5, xp: 130 },
};

/** stand 에서 facing 방향으로 해안선과 만나는 거리(§7.4 edgeM 검산) */
function edgeAlongFacing(stage, spot) {
  const dx = -Math.sin(spot.facing);
  const dz = -Math.cos(spot.facing);
  for (let d = 0; d < 30; d += 0.001) {
    const x = spot.stand.x + dx * d;
    const z = spot.stand.z + dz * d;
    if (z <= shoreZAt(stage.shore, x)) return d;
  }
  return Infinity;
}

/** 물고기의 월드 위치(§0.2 — stand + fwd(bearing) × dist) */
function fishXZ(state) {
  const f = state.fight;
  const o = state.rig.origin;
  return { x: o.x - Math.sin(f.bearing) * f.dist, z: o.z - Math.cos(f.bearing) * f.dist };
}

/** 개발 세션 GameSim(레벨 게이트 무시) — 미끼는 넉넉히(자리 봇은 살 수 없다) */
function makeSim({ spotId, hour = 6, weather = 'clear', seed = 7 }) {
  const bus = new EventBus();
  const log = [];
  const profile = createNewProfile();
  profile.level = 12;
  for (const b of Object.keys(profile.baits)) profile.baits[b] = 5000;
  for (const b of ['worm', 'paste', 'corn', 'shrimp', 'krill', 'live']) profile.baits[b] = 5000;
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, seed, profile, start: { spotId, hour, weather }, session: { ignoreGates: true, devSession: true } });
  sim.start();
  return { sim, log };
}

/** 그 세트를 단계 tier 로(일회용 세션 디버그 — 테스트 장치) */
function gear(sim, tier, set) {
  sim.debugSetGear('rod', `rod_${set}_${tier}`, set);
  sim.debugSetGear('reel', `reel_${tier}`, set);
  sim.debugSetGear('line', `line_${tier}`, set);
  if (set === 'float') sim.debugSetGear('float', `float_${tier}`, set);
  else sim.debugSetGear('sinker', `sinker_${tier}`, set);
  sim.debugSetGear('hook', 'hook_l', set);
}

/** 찌 · 봉돌 · 물고기가 물 위에 있다(땅 위에 그려지지 않는다) */
function assertInWater(state, where) {
  const r = state.rig;
  if (r.phase === 'waiting' || r.phase === 'bite') {
    const sz = shoreZAt(RIVER.shore, r.bobber.x);
    assert.ok(r.bobber.z < sz, `${where}: 찌/봉돌이 땅 위 (${r.bobber.x.toFixed(2)}, ${r.bobber.z.toFixed(2)}) · 해안선 z ${sz.toFixed(2)}`);
  }
  if (state.fight) {
    const p = fishXZ(state);
    const sz = shoreZAt(RIVER.shore, p.x);
    assert.ok(p.z < sz, `${where}: 물고기가 땅 위 (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) · 해안선 z ${sz.toFixed(2)}`);
  }
}

test('데이터 완결성: 강 어종 12 · 🔒 값 · 풀 · 층 × 시간대 · edgeM · farFromM · 해금 10', () => {
  assert.equal(RIVER.id, 'river');
  assert.equal(RIVER.unlockLevel, 10);
  assert.deepEqual(RIVER_SPECIES.map(s => s.id), RIVER_IDS);
  for (const s of RIVER_SPECIES) {
    assert.equal(s.stage, 'river', s.id);
    const L = LOCKED[s.id];
    assert.equal(s.style, L.style, `${s.id} style`);
    assert.deepEqual(s.fight, L.fight, `${s.id} fight`);
    assert.deepEqual(s.lenCm, L.lenCm, `${s.id} lenCm`);
    assert.deepEqual(s.kg, L.kg, `${s.id} kg`);
    assert.equal(s.pricePerKg, L.pricePerKg, `${s.id} pricePerKg`);
    assert.equal(s.trophyBonus, L.trophyBonus, `${s.id} trophyBonus`);
    assert.equal(s.xp, L.xp, `${s.id} xp`);
    const d = getSpecies(s.id);
    for (const k of ['medianKg', 'trophyKg', 'legendKg']) assert.ok(Number.isFinite(d[k]) && d[k] > 0, `${s.id} ${k}`);
  }
  // 판타지는 페일 킹 하나 — 새벽 · 흐림
  const fantasy = RIVER_SPECIES.filter(s => s.fantasy);
  assert.deepEqual(fantasy.map(s => s.id), ['paleKing']);
  assert.deepEqual(fantasy[0].fantasy, { bands: ['dawn'], weather: ['cloudy'] });
  assert.equal(fantasy[0].time, 'H0000');
  assert.ok(fantasy[0].traits.includes('vanish'));

  // 자리 셋 · 풀
  assert.deepEqual(RIVER.spots.map(s => s.id), ['river_tailrace', 'river_trench', 'river_riffle']);
  const inPool = new Set();
  for (const sp of RIVER.spots) {
    for (const p of sp.pool) {
      assert.ok(RIVER_IDS.includes(p.id), `${sp.id}: 강 어종이 아닌 ${p.id}`);
      assert.ok(p.w > 0 && (p.farMul === undefined || p.farMul > 0), `${sp.id}/${p.id} w · farMul`);
      if (getSpecies(p.id).fantasy) assert.equal(p.w, 1, '판타지 w 는 1');
      inPool.add(p.id);
    }
    for (let i = 1; i < sp.depth.length; i++) assert.ok(sp.depth[i][0] > sp.depth[i - 1][0], `${sp.id} depth 거리 오름차순`);
    assert.ok(sp.snag.fromM > sp.minCastM, `${sp.id} snag`);
    assert.ok(sp.farFromM === null || (sp.farFromM > sp.minCastM && sp.farFromM <= sp.maxDriftM), `${sp.id} farFromM`);
    assert.ok(Math.abs(edgeAlongFacing(RIVER, sp) - sp.edgeM) <= 0.15, `${sp.id} edgeM ${sp.edgeM} vs ${edgeAlongFacing(RIVER, sp).toFixed(3)}`);
    assert.ok(pointInConvex(RIVER.walk, sp.stand.x, sp.stand.z), `${sp.id} stand 가 walk 안`);
    assert.ok(Math.hypot(sp.flow.x, sp.flow.z) > 0 && sp.flow.x > 0, `${sp.id} 흐름은 하류(+X)`);
  }
  for (const id of RIVER_IDS) assert.ok(inPool.has(id), `${id} 가 어느 풀에도 없다`);
  const pk = RIVER.spots.filter(sp => sp.pool.some(p => p.id === 'paleKing')).map(sp => sp.id);
  assert.deepEqual(pk, ['river_tailrace', 'river_trench']);

  // 꼬리물의 먼 곳: 50m · 치누크 · 스틸헤드 farMul 2
  const tail = RIVER.spots[0];
  assert.equal(tail.farFromM, 50);
  const far = Object.fromEntries(tail.pool.filter(p => p.farMul).map(p => [p.id, p.farMul]));
  assert.deepEqual(far, { chinookSalmon: 2, steelhead: 2 });

  // 층 3 × 시간대 5: 계수 > 0 인 비판타지 강 어종이 칸마다 1 이상
  for (const layer of LAYER_IDS) {
    for (let b = 0; b < BAND_IDS.length; b++) {
      const any = RIVER_SPECIES.some(s => !s.fantasy && s.layers.includes(layer) && s.time[b] !== '0');
      assert.ok(any, `${layer} × ${BAND_IDS[b]} 에 어종이 없다`);
    }
  }

  // look.dam: 지형 메시(x ±650) 안 · 강을 가로지른다(view 전용 — 원경 능선 뒤로 숨지 않게)
  const dam = RIVER.look.dam;
  assert.ok(dam.x - 60 > -650 && dam.x < -200, 'dam.x 가 지형 안 · 상류');
  assert.ok(dam.z - dam.width / 2 <= RIVER.look.ridge.farBankZ, '건너편 기슭까지');
  assert.ok(dam.z + dam.width / 2 >= Math.max(...RIVER.shore.map(p => p.z)), '이쪽 기슭까지');
});

test('꼬리물 먼 곳: 50m 너머에서 치누크 · 스틸헤드 가중치만 2배', () => {
  const tail = RIVER.spots[0];
  const rs = makeTestRigStats('float');
  for (const band of BAND_IDS) {
    const near = biteWeights({ spot: tail, band, weather: 'clear', layer: 'mid', baitId: 'shrimp', rigStats: rs, distM: 49.9 });
    const far = biteWeights({ spot: tail, band, weather: 'clear', layer: 'mid', baitId: 'shrimp', rigStats: rs, distM: 50 });
    for (const e of far.entries) {
      const n = near.entries.find(x => x.speciesId === e.speciesId);
      const k = e.speciesId === 'chinookSalmon' || e.speciesId === 'steelhead' ? 2 : 1;
      assert.ok(Math.abs(e.w - n.w * k) < 1e-12, `${band} ${e.speciesId}: ${n.w} → ${e.w}`);
    }
  }
});

test('꼬리물 흘림 · 봉돌 밀림이 땅으로 가지 않는다(단계 1–3 × 조준 × 힘) · 3단계 흘림은 farFromM 에 닿는다', () => {
  const tail = RIVER.spots[0];
  let reachFar = false;
  let maxSeen = 0;
  for (const set of ['float', 'bottom']) {
    for (const tier of [1, 2, 3]) {
      for (const off of [-tail.arc, 0, tail.arc]) {
        for (const power of [0.12, 0.55, 0.97]) {
          const { sim } = makeSim({ spotId: 'river_tailrace', hour: 9 });
          sim.debugNoBites(true);
          if (sim.state.rig.set !== set) sim.step({ ...NEUTRAL_INPUT, selectSet: set });
          gear(sim, tier, set);
          if (set === 'bottom') sim.debugSetGear('sinker', 'sinker_1', set);   // 가장 가벼운 봉돌 — 강물에 밀린다
          const yaw = tail.facing + off;
          let prevP = 0;
          let wasP = false;
          let bailed = false;
          let waitTicks = 0;
          let maxD = 0;
          for (let t = 0; t < 60 * 120; t++) {
            const r = sim.state.rig;
            const inp = { ...NEUTRAL_INPUT, yaw };
            if (r.phase === 'ready') inp.primary = true;
            else if (r.phase === 'charging') { inp.primary = !(r.power >= power || r.power < prevP); prevP = r.power; }
            else if (r.phase === 'waiting') {
              if (!bailed && set === 'float') { inp.bail = true; bailed = true; }
              waitTicks++;
              maxD = Math.max(maxD, r.dist);
              const sz = shoreZAt(RIVER.shore, r.bobber.x);
              assert.ok(r.bobber.z < sz - CAST.shoreMarginM + 1e-9, `${set} t${tier} off ${off} p ${power}: 물가 여유 안쪽 z ${r.bobber.z.toFixed(2)} / 해안선 ${sz.toFixed(2)}`);
              const d = Math.hypot(r.bobber.x - r.origin.x, r.bobber.z - r.origin.z);
              assert.ok(Math.abs(angleDiff(tail.facing, yawOf(r.bobber.x - r.origin.x, r.bobber.z - r.origin.z))) <= CAST.driftArc + 1e-9 || d < tail.minCastM + 1e-9, '흘림 방위가 facing ± driftArc 밖');
              assert.ok(r.dist <= tail.maxDriftM + 1e-9, '흘림 상한');
            }
            inp.primaryPressed = inp.primary && !wasP;
            inp.primaryReleased = !inp.primary && wasP;
            wasP = inp.primary;
            sim.step(inp);
          }
          assert.ok(waitTicks > 60 * 60, `${set} t${tier}: 대기에 들어가지 못했다(${waitTicks})`);
          assertFiniteDeep(sim.state, `${set} t${tier}`);
          if (set === 'float') {
            maxSeen = Math.max(maxSeen, maxD);
            if (tier === 3 && power > 0.9 && maxD >= tail.farFromM) reachFar = true;
          }
        }
      }
    }
  }
  assert.ok(reachFar, `3단계 찌 흘림이 farFromM ${tail.farFromM}m 에 닿지 못했다(최대 ${maxSeen.toFixed(1)}m)`);
});

test('흘려 간 찌에서 건 물고기도 땅 위에 그려지지 않는다(꼬리물 최대 흘림 → 치누크 파이팅)', () => {
  const tail = RIVER.spots[0];
  for (const [seed, off] of [[1, -tail.arc], [2, 0], [3, tail.arc]]) {
    const { sim, log } = makeSim({ spotId: 'river_tailrace', hour: 6, seed });
    sim.debugNoBites(true);
    gear(sim, 3, 'float');
    const yaw = tail.facing + off;
    let prevP = 0;
    let wasP = false;
    let bailed = false;
    let still = 0;
    let lastD = -1;
    // 1) 던지고 흘려 끝(경계)에 닿을 때까지
    for (let t = 0; t < 60 * 200 && still < 120; t++) {
      const r = sim.state.rig;
      const inp = { ...NEUTRAL_INPUT, yaw };
      if (r.phase === 'ready') inp.primary = true;
      else if (r.phase === 'charging') { inp.primary = !(r.power >= 0.97 || r.power < prevP); prevP = r.power; }
      else if (r.phase === 'waiting') {
        if (!bailed) { inp.bail = true; bailed = true; }
        still = Math.abs(r.dist - lastD) < 1e-6 ? still + 1 : 0;
        lastD = r.dist;
      }
      inp.primaryPressed = inp.primary && !wasP;
      inp.primaryReleased = !inp.primary && wasP;
      wasP = inp.primary;
      sim.step(inp);
    }
    assert.equal(sim.state.rig.phase, 'waiting');
    // 2) 그 자리에서 입질 → 자리 봇이 챔질 · 파이팅
    sim.debugNoBites(false);
    sim.debugForceBite('chinookSalmon', 0.5);
    const bot = createAngler({ strategy: 'controlled', seed, set: 'float', baitId: 'live' });
    let fought = 0;
    let startDist = -1;
    for (let t = 0; t < 60 * 400; t++) {
      const a = bot.decide(sim.state, sim);
      if (sim.state.rig.phase === 'result' || sim.state.rig.phase === 'failed' || sim.state.rig.phase === 'ready') {
        if (log.some(e => e.name === EV.FIGHT_END)) break;
      }
      if (a.command) sim[a.command.name](...a.command.args);
      if (sim.state.rig.phase === 'result') continue;
      sim.step(a.input);
      if (sim.state.fight) {
        if (startDist < 0) startDist = sim.state.fight.dist;
        fought++;
      }
      assertInWater(sim.state, `seed ${seed} t${t}`);
    }
    assert.ok(fought > 60, `파이팅이 일어나지 않았다(${fought})`);
    assert.ok(startDist >= 40, `흘려 간 먼 곳에서 걸리지 않았다(${startDist.toFixed(1)}m)`);
    assert.ok(log.some(e => e.name === EV.FIGHT_END), '파이팅이 끝나지 않았다');
  }
});

test('자리마다 createAngler(기본 · 조절) 100판: 예외 0 · NaN 0 · 돈 ≥ 0 · 찌와 물고기는 늘 물 위', () => {
  const SEEDS = { basic: 11, controlled: 23 };
  for (const sp of RIVER.spots) {
    for (const strategy of ['basic', 'controlled']) {
      // 기본은 2단계(강 해금 무렵) · 조절은 3단계 — 세트와 미끼는 자리의 성격대로
      const set = sp.id === 'river_trench' ? 'bottom' : 'float';
      const bait = sp.id === 'river_trench' ? 'live' : sp.id === 'river_riffle' ? 'worm' : 'shrimp';
      const { sim, log } = makeSim({ spotId: sp.id, hour: 5, seed: SEEDS[strategy] });
      gear(sim, strategy === 'basic' ? 2 : 3, set);
      const bot = createAngler({ strategy, seed: SEEDS[strategy], set, baitId: bait });
      let rounds = 0;
      let ticks = 0;
      let refills = 0;
      for (let d = 0; rounds < 100 && d < 6_000_000; d++) {
        const st = sim.state;
        if (st.rig.phase === 'ready' && !st.rig.canCast) {                 // 라인이 바닥 — 테스트 장치가 다시 감는다(자리 봇은 살 수 없다)
          const cfg = st.profile.sets[st.rig.set];
          sim.debugSetGear('line', cfg.lineId, st.rig.set);
          refills++;
        }
        const a = bot.decide(st, sim);
        if (a.command) {
          assert.ok(BOT_COMMANDS.has(a.command.name), a.command.name);
          const r = sim[a.command.name](...a.command.args);
          assert.ok(r && typeof r.ok === 'boolean');
        }
        if (sim.state.rig.phase === 'result') continue;
        const before = log.length;
        sim.step(a.input);
        ticks++;
        for (let i = before; i < log.length; i++) if (log[i].name === EV.FIGHT_END || log[i].name === EV.HOOK_MISS) rounds++;
        assertInWater(sim.state, `${sp.id}/${strategy}@${ticks}`);
        if (ticks % 600 === 0) {
          assertFiniteDeep(sim.state, `${sp.id}/${strategy}@${ticks}`);
          assert.ok(sim.state.profile.money >= 0);
          assert.ok(RIG_PHASES.includes(sim.state.rig.phase));
        }
      }
      assertFiniteDeep(sim.state, `${sp.id}/${strategy} end`);
      assert.ok(rounds >= 100, `${sp.id}/${strategy}: ${rounds}판(틱 ${ticks})`);
      const landed = log.filter(e => e.name === EV.FIGHT_END && e.payload.outcome === 'landed').length;
      // 강의 측정(M15)은 P10 의 몫 — 여기서는 루프가 실제로 랜딩까지 도는지만(기본 봇 · 2단계 꼬리물은 실측 12% — NOTES-P12)
      assert.ok(landed >= (strategy === 'basic' ? 5 : 40), `${sp.id}/${strategy}: 랜딩 ${landed}/100`);
      assert.ok(refills < 40, `${sp.id}/${strategy}: 라인 다시 감기 ${refills}회`);
    }
  }
});

test('페일 킹 조건: 새벽 · 흐림에서만(꼬리물 · 깊은 홈) — 입질의 2–5% · 조건 밖 0', () => {
  const rs = makeTestRigStats('float');
  for (const sp of RIVER.spots) {
    for (const band of BAND_IDS) {
      for (const weather of WEATHER_IDS) {
        const w = biteWeights({ spot: sp, band, weather, layer: 'mid', baitId: 'live', rigStats: rs, distM: 30 });
        const on = band === 'dawn' && weather === 'cloudy' && sp.id !== 'river_riffle';
        assert.equal(w.fantasy.includes('paleKing'), on, `${sp.id} ${band} ${weather}`);
      }
    }
  }
  const rng = makeRng(seedRng(99));
  for (const sp of RIVER.spots.slice(0, 2)) {
    for (const bait of ['live', 'worm']) {
      const w = biteWeights({ spot: sp, band: 'dawn', weather: 'cloudy', layer: 'mid', baitId: bait, rigStats: rs, distM: 30 });
      let pk = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) if (pickSpecies(rng, w, bait) === 'paleKing') pk++;
      const share = pk / N;
      assert.ok(share >= 0.02 && share <= 0.05, `${sp.id} ${bait}: 페일 킹 ${(share * 100).toFixed(2)}%`);
    }
    for (const [band, weather] of [['dawn', 'clear'], ['dawn', 'rain'], ['morning', 'cloudy'], ['night', 'cloudy']]) {
      const w = biteWeights({ spot: sp, band, weather, layer: 'mid', baitId: 'live', rigStats: rs, distM: 30 });
      for (let i = 0; i < 4000; i++) assert.notEqual(pickSpecies(rng, w, 'live'), 'paleKing', `${band} ${weather}`);
    }
  }
});

/** 파이팅 한 판(디버그로 바로 건다) — chargeMode: 「사라짐」(charge) 동안 손을 바꾼다 */
function runFight({ spotId, speciesId, pct, tier, set, strategy, seed, chargeMode = null, hour = 8, weather = 'clear' }) {
  const { sim, log } = makeSim({ spotId, hour, weather, seed });
  if (sim.state.rig.set !== set) sim.step({ ...NEUTRAL_INPUT, selectSet: set });
  gear(sim, tier, set);
  sim.debugForceFight(speciesId, pct);
  const pol = createFightPolicy(strategy, seed);
  let chargeTicks = 0;
  let chargeSlack = 0;
  let down = false;
  for (let n = 0; sim.state.fight && n < 60 * 60 * 15; n++) {
    const f = sim.state.fight;
    const h = pol.decide(sim.state, sim.getRigStats());
    const inp = { ...NEUTRAL_INPUT, primary: h.primary, secondary: h.secondary, dragSteps: h.dragSteps, hook: h.hook, yaw: sim.state.player.yaw };
    if (f.behavior === 'charge' && !f.telegraph) {
      chargeTicks++;
      if (f.slack) chargeSlack++;
      if (chargeMode === 'neutral') { inp.primary = false; inp.secondary = false; }
      else if (chargeMode === 'reelLift') {                   // 감으며 세운다(끝까지 서면 조금 숙였다 다시)
        inp.primary = true;
        if (f.rodLift >= 0.98) down = true;
        if (f.rodLift <= 0.5) down = false;
        inp.secondary = !down;
      }
    }
    sim.step(inp);
    assertInWater(sim.state, `${speciesId} ${n}`);
  }
  const end = log.find(e => e.name === EV.FIGHT_END);
  return { outcome: end ? end.payload.outcome : 'timeout', cause: end ? end.payload.cause : null, chargeTicks, chargeSlack };
}

test('페일 킹 「사라짐」: 손을 놓으면 슬랙이 쌓이고 · 감으며 세우면 막힌다(3단계 · 깊은 홈 · 새벽 흐림)', () => {
  const N = 40;
  const agg = {};
  for (const mode of ['neutral', 'reelLift']) {
    let ct = 0;
    let cs = 0;
    let slackOff = 0;
    for (let i = 0; i < N; i++) {
      const r = runFight({ spotId: 'river_trench', speciesId: 'paleKing', pct: 0.5, tier: 3, set: 'float', strategy: 'controlled', seed: 500 + i, chargeMode: mode, hour: 5, weather: 'cloudy' });
      ct += r.chargeTicks;
      cs += r.chargeSlack;
      if (r.outcome === 'hookOff' && r.cause === 'slack') slackOff++;
    }
    agg[mode] = { share: cs / Math.max(1, ct), slackOff, ct };
  }
  assert.ok(agg.neutral.ct > 600 && agg.reelLift.ct > 600, `사라짐이 거의 나오지 않았다 ${JSON.stringify(agg)}`);
  assert.ok(agg.neutral.share >= 0.6, `손을 놓아도 슬랙이 안 생긴다 ${JSON.stringify(agg)}`);
  assert.ok(agg.reelLift.share <= 0.3, `감으며 세워도 슬랙을 못 막는다 ${JSON.stringify(agg)}`);
  assert.ok(agg.neutral.slackOff > agg.reelLift.slackOff, `슬랙 빠짐이 줄지 않는다 ${JSON.stringify(agg)}`);
});

test('장비 의미(M6): 흰철갑상어 중앙값 · 깊은 홈 — 1단계 ≤ 10% · 3단계 + 조절 ≥ 50%', () => {
  const N = 60;
  const rate = (tier, strategy) => {
    let landed = 0;
    for (let i = 0; i < N; i++) {
      const r = runFight({ spotId: 'river_trench', speciesId: 'whiteSturgeon', pct: 0.5, tier, set: 'bottom', strategy, seed: 900 + i, hour: 22 });
      if (r.outcome === 'landed') landed++;
    }
    return landed / N;
  };
  const t1b = rate(1, 'basic');
  const t1c = rate(1, 'controlled');
  const t3c = rate(3, 'controlled');
  assert.ok(t1b <= 0.1, `1단계 기본 ${(t1b * 100).toFixed(0)}%`);
  assert.ok(t1c <= 0.1, `1단계 조절 ${(t1c * 100).toFixed(0)}%`);
  assert.ok(t3c >= 0.5, `3단계 조절 ${(t3c * 100).toFixed(0)}%`);
});

// ── 소품

const PROPS_SRC = ['src/view/stages/riverProps.js', 'src/view/stages/river/kit.js', 'src/view/stages/river/dam.js', 'src/view/stages/river/flow.js', 'src/view/stages/river/canyon.js'];

function makeEnv(over = {}) {
  return { hour: 8, light: 1, night: false, sunDir: new THREE.Vector3(0, 1, 0), weather: 'clear', waveAmp: 0.06, wavePeriod: 2.5, time: 0, camPos: new THREE.Vector3(0, 2, 20), ...over };
}

/** 메시(인스턴스 포함)의 월드 정점마다 fn(x, y, z, name) — 셰이더가 옮기는 입자형(InstancedBufferGeometry)은 뺀다 */
function eachVertex(group, fn) {
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || !o.visible || o.geometry.isInstancedBufferGeometry) return;
    const pos = o.geometry.attributes.position;
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m);
        m.premultiply(o.matrixWorld);
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); fn(v.x, v.y, v.z, o.name); }
      }
    } else {
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); fn(v.x, v.y, v.z, o.name || o.parent?.name || 'mesh'); }
    }
  });
}

test('riverProps 가 Node 에서 만들어진다(three 만 · DataTexture) · 0.5m 규칙 · 자리 시야 · 화질 왕복 · 반복 update', () => {
  for (const f of PROPS_SRC) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/CanvasTexture|document\.|window\.|Math\.random|WorldLayer/.test(src), `${f}: 금지 토큰`);
    assert.ok(!/from '\.\.\/world\/|from '\.\.\/\.\.\/world\//.test(src), `${f}: P5 내부 파일 import`);
  }
  const field = createTerrainField(RIVER);
  const heightAt = field.heightAt;
  for (const q of ['low', 'medium', 'high']) {
    const props = buildRiverProps({ stage: RIVER, quality: q, heightAt });
    assert.ok(props.group instanceof THREE.Group);
    assert.equal(props.group.name, 'props:river');
    const names = new Set();
    props.group.traverse(o => { if (o.name) names.add(o.name); });
    for (const n of ['dam', 'damConcrete', 'damSpray', 'damSpillFoam', 'damBoil', 'canyonCliffs', 'waterfall', 'farForest', 'flowStreaks', 'gulls', 'gravelBar', 'dock', 'baitShack', 'boat', 'rails', 'pebbles', 'boulders', 'firs']) {
      assert.ok(names.has(n), `${q}: ${n} 가 없다`);
    }
    // 정점 유한 · 텍스처는 DataTexture 만
    let nonFinite = 0;
    eachVertex(props.group, (x, y, z) => { if (!Number.isFinite(x + y + z)) nonFinite++; });
    assert.equal(nonFinite, 0);
    props.group.traverse((o) => {
      if (!o.material) return;
      for (const k of ['map', 'alphaMap', 'emissiveMap']) if (o.material[k]) assert.ok(o.material[k].isDataTexture, `${o.name} ${k}`);
      if (o.material.uniforms) for (const u of Object.values(o.material.uniforms)) if (u.value && u.value.isTexture) assert.ok(u.value.isDataTexture, `${o.name} uniform 텍스처`);
    });
    props.dispose();
  }

  const props = buildRiverProps({ stage: RIVER, quality: 'high', heightAt });
  // §9.4: 걷는 영역 안에서 0.5m 넘는 것은 obstacles 원 안에만
  const tall = [];
  eachVertex(props.group, (x, y, z, name) => {
    if (!pointInConvex(RIVER.walk, x, z)) return;
    if (y - heightAt(x, z) <= 0.5) return;
    for (const o of RIVER.obstacles) if (Math.hypot(x - o.x, z - o.z) <= o.r + 0.02) return;
    tall.push(`${name} (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
  });
  assert.deepEqual(tall.slice(0, 5), [], `0.5m 규칙 위반 ${tall.length}`);
  // §9.4: 낚시 자리의 facing ± arc · 60m 수면 시야를 가리지 않는다(설 자리 둘레 3m 너머 — 수면 · 땅에서 0.35m 넘게 솟은 것 없음)
  const block = [];
  eachVertex(props.group, (x, y, z, name) => {
    for (const sp of RIVER.spots) {
      const dx = x - sp.stand.x;
      const dz = z - sp.stand.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 60) continue;
      if (Math.abs(angleDiff(sp.facing, yawOf(dx, dz))) > sp.arc) continue;
      if (y - Math.max(0, heightAt(x, z)) > 0.35) block.push(`${sp.id}: ${name} (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})`);
    }
  });
  assert.deepEqual(block.slice(0, 5), [], `자리 시야를 가린다 ${block.length}`);
  // 판매 오두막은 판매상 obstacles 원 안(모든 정점)
  const npc = RIVER.points.find(p => p.kind === 'npc');
  const circle = RIVER.obstacles.reduce((a, b) => (Math.hypot(a.x - npc.x, a.z - npc.z) <= Math.hypot(b.x - npc.x, b.z - npc.z) ? a : b));
  const shack = props.group.getObjectByName('baitShack');
  eachVertex(shack, (x, y, z) => assert.ok(Math.hypot(x - circle.x, z - circle.z) <= circle.r + 0.02, `오두막 정점이 원 밖 (${x.toFixed(2)}, ${z.toFixed(2)})`));
  // 도크 · 보트는 물 위(해안선 −Z 쪽) 또는 걷는 영역 밖
  for (const n of ['dock', 'boat']) {
    eachVertex(props.group.getObjectByName(n), (x, y, z) => assert.ok(!pointInConvex(RIVER.walk, x, z) || y - heightAt(x, z) <= 0.5, `${n} 가 걷는 영역 안에 솟았다`));
  }

  // 화질 왕복: 지오메트리 · 텍스처 수 불변 · count 만 바뀐다
  const count = () => {
    const g = new Set();
    const t = new Set();
    props.group.traverse((o) => {
      if (o.geometry) g.add(o.geometry.uuid);
      if (o.material) {
        for (const k of ['map', 'emissiveMap']) if (o.material[k]) t.add(o.material[k].uuid);
        if (o.material.uniforms) for (const u of Object.values(o.material.uniforms)) if (u.value && u.value.isTexture) t.add(u.value.uuid);
      }
    });
    return [g.size, t.size];
  };
  const before = count();
  const streaks = props.group.getObjectByName('flowStreaks');
  const hi = streaks.geometry.instanceCount;
  props.setQuality('low');
  assert.ok(streaks.geometry.instanceCount < hi, '화질 low 에서 거품 줄 수가 줄지 않았다');
  props.setQuality('medium');
  props.setQuality('high');
  assert.equal(streaks.geometry.instanceCount, hi);
  assert.deepEqual(count(), before);

  // 반복 update(낮 · 밤 · 비 · 큰 dt · 긴 시간) — 예외 0 · 유니폼 유한 · 밤에는 불이 켜진다
  const env = makeEnv();
  for (let i = 0; i < 600; i++) {
    env.time = i * 0.25;
    env.light = 0.5 + 0.5 * Math.sin(i * 0.01);
    env.night = env.light < 0.2;
    env.weather = WEATHER_IDS[i % 3];
    props.update(env, i % 50 === 0 ? 5 : 1 / 60);
  }
  props.update(makeEnv({ time: 1e6, light: 0.05, night: true }), 1 / 60);
  props.group.traverse((o) => {
    const u = o.material && o.material.uniforms;
    if (u) for (const [k, val] of Object.entries(u)) if (typeof val.value === 'number') assert.ok(Number.isFinite(val.value), `${o.name}.${k}`);
  });
  const lamps = props.group.getObjectByName('damLights');
  assert.ok(lamps.material.emissiveIntensity > 1, '밤인데 댐 불빛이 꺼져 있다');
  props.update(makeEnv({ time: 5, light: 1, night: false }), 1 / 60);
  assert.equal(lamps.material.emissiveIntensity, 0, '낮인데 댐 불빛이 켜져 있다');
  props.dispose();

  // 결정성: 같은 입력이면 같은 배치
  const a = buildRiverProps({ stage: RIVER, quality: 'medium', heightAt });
  const b = buildRiverProps({ stage: RIVER, quality: 'medium', heightAt });
  const ma = new THREE.Matrix4();
  const mb = new THREE.Matrix4();
  for (const n of ['firs', 'boulders', 'farForest']) {
    const ia = a.group.getObjectByName(n);
    const ib = b.group.getObjectByName(n);
    assert.equal(ia.count, ib.count);
    for (let k = 0; k < ia.count; k += 7) { ia.getMatrixAt(k, ma); ib.getMatrixAt(k, mb); assert.ok(ma.equals(mb), `${n}#${k}`); }
  }
  a.dispose();
  b.dispose();
});
