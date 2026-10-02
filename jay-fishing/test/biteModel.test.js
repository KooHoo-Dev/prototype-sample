// OWNER: P1 — 계약 §12.2(biteModel) · §5.4
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BAND_IDS, LAYER_IDS } from '../src/core/constants.js';
import { BITE, LAYER } from '../src/data/bite.js';
import { WEATHER } from '../src/data/weather.js';
import { STAGES, getSpot } from '../src/data/stages/index.js';
import { SPECIES, getSpecies } from '../src/data/species/index.js';
import { biteRate, biteWeights, depthAt, layerAt, meanWait, pickSpecies } from '../src/sim/fishing/biteModel.js';
import { makeTestRigStats } from './helpers.js';

const RS = makeTestRigStats('bottom');           // hook_m(2) · line_1(lineBiteMul 1) · 스킬 0

/** 계약 §5.4.2 를 그대로 옮긴 독립 참조식(biteModel.js 를 보지 않고) */
function refWeight(spot, poolEntry, { band, weather, layer, baitId, hookSize, distM = 0, lineMul = 1 }) {
  const s = getSpecies(poolEntry.id);
  if (s.fantasy) return 0;
  let c = s.time[BAND_IDS.indexOf(band)];
  if (WEATHER[weather].dayBandStep > 0 && (band === 'morning' || band === 'day')) c = BITE.stepUp[c];
  const li = LAYER_IDS.indexOf(layer);
  const dl = Math.min(...s.layers.map(l => Math.abs(LAYER_IDS.indexOf(l) - li)));
  const bi = s.baits.indexOf(baitId);
  const bait = bi >= 0 ? BITE.baitFit[bi] : BITE.baitOther;
  const hook = BITE.hookBigger[Math.max(0, Math.min(2, hookSize - s.mouth))];
  const far = spot.farFromM != null && distM >= spot.farFromM ? (poolEntry.farMul ?? 1) : 1;
  return poolEntry.w * BITE.timeCoef[c] * BITE.layerFit[dl] * bait * hook * far * lineMul;
}

const allSpots = () => STAGES.flatMap(st => st.spots);

test('biteWeights = 계약 식(모든 자리 · 시간대 · 날씨 · 층 · 미끼 조합의 표본)', () => {
  const baits = ['worm', 'paste', 'corn', 'shrimp', 'krill', 'live'];
  for (const spot of allSpots()) {
    for (const band of BAND_IDS) for (const weather of Object.keys(WEATHER)) for (const layer of LAYER_IDS) {
      const baitId = baits[(band.length + layer.length + weather.length) % baits.length];
      const w = biteWeights({ spot, band, weather, layer, baitId, rigStats: RS, distM: 0 });
      let total = 0;
      for (const p of spot.pool) {
        const ref = refWeight(spot, p, { band, weather, layer, baitId, hookSize: RS.hookSize });
        const e = w.entries.find(x => x.speciesId === p.id);
        if (getSpecies(p.id).fantasy) { assert.equal(e, undefined); continue; }
        assert.ok(Math.abs(e.w - ref) < 1e-12, `${spot.id} ${p.id} ${band} ${weather} ${layer}: ${e.w} vs ${ref}`);
        total += ref;
      }
      assert.ok(Math.abs(w.total - total) < 1e-12);
      // 판타지 목록 = 조건을 만족하는 풀의 판타지 어종
      const fx = spot.pool.map(p => getSpecies(p.id)).filter(s => s.fantasy && s.fantasy.bands.includes(band) && s.fantasy.weather.includes(weather)).map(s => s.id);
      assert.deepEqual(w.fantasy, fx);
    }
  }
});

// 계약의 허용: 기대 ≥ 400 이면 상대 오차 ≤ 10%, 그 밖 |관측 − 기대| ≤ 4√기대 + 2. 기대가 400 근처면 10% 는 약 2σ 라
// 36종 × 5칸 중 하나가 우연히 넘는다(관측: 붉돔 밤 429 vs 477 — 20만 뽑기로는 0.2383 vs 0.2385 로 치우침 없음).
// 그래서 두 허용 중 넓은 쪽(≥ 약 4σ)을 쓴다 — 큰 기대에서는 10% 가, 400 근처에서는 4√기대 + 2 가 정한다.
test('시간대 출현 분포(어종마다 그 자리 · 선호 미끼 · 맞는 층 · 맑음 · 5시간대 × 2,000 · 계수 0 이면 0)', () => {
  const rng = makeRng(seedRng(2024));
  const DRAWS = 2000;
  for (const sp of SPECIES.filter(s => !s.fantasy)) {
    const spot = allSpots().find(p => p.pool.some(e => e.id === sp.id));
    assert.ok(spot, `${sp.id} 풀 없음`);
    const baitId = sp.baits[0];
    const layer = sp.layers[0];
    for (const band of BAND_IDS) {
      const w = biteWeights({ spot, band, weather: 'clear', layer, baitId, rigStats: RS });
      const total = spot.pool.reduce((a, p) => a + refWeight(spot, p, { band, weather: 'clear', layer, baitId, hookSize: RS.hookSize }), 0);
      const mine = refWeight(spot, spot.pool.find(p => p.id === sp.id), { band, weather: 'clear', layer, baitId, hookSize: RS.hookSize });
      // 판타지가 섞이면 그 확률만큼 비판타지 몫이 준다(§5.4.3)
      let pF = 0;
      for (const f of w.fantasy) {
        const fs = getSpecies(f);
        const bi = fs.baits.indexOf(baitId);
        const fit = Math.max(BITE.fantasyBaitFloor, Math.min(1, bi >= 0 ? BITE.baitFit[bi] : BITE.baitOther));
        pF += BITE.fantasyShare * fit / w.fantasy.length;
      }
      const expected = total > 0 ? DRAWS * (1 - pF) * mine / total : 0;
      let obs = 0;
      for (let i = 0; i < DRAWS; i++) if (pickSpecies(rng, w, baitId) === sp.id) obs++;
      const c = sp.time[BAND_IDS.indexOf(band)];
      if (c === '0') { assert.equal(obs, 0, `${sp.id} ${band} 계수 0 인데 ${obs}`); continue; }
      const tol = Math.max(expected >= 400 ? 0.10 * expected : 0, 4 * Math.sqrt(expected) + 2);
      assert.ok(Math.abs(obs - expected) <= tol, `${sp.id} ${band} obs ${obs} exp ${expected.toFixed(1)}`);
    }
  }
});

test('판타지: 조건 안 2–5%(선호 미끼 · 그 밖 미끼 모두) · 조건 밖 0', () => {
  const N = 40000;
  for (const sp of SPECIES.filter(s => s.fantasy)) {
    const spot = allSpots().find(p => p.pool.some(e => e.id === sp.id));
    const band = sp.fantasy.bands[0];
    const weather = sp.fantasy.weather[0];
    const layer = sp.layers[0];
    const other = ['worm', 'paste', 'corn', 'shrimp', 'krill', 'live'].find(b => !sp.baits.includes(b));
    for (const baitId of [sp.baits[0], other]) {
      const w = biteWeights({ spot, band, weather, layer, baitId, rigStats: RS });
      assert.ok(w.fantasy.includes(sp.id));
      const rng = makeRng(seedRng(9 + baitId.length));
      let n = 0;
      for (let i = 0; i < N; i++) if (pickSpecies(rng, w, baitId) === sp.id) n++;
      const share = n / N * w.fantasy.length;           // 같은 자리에 조건을 만족하는 판타지가 둘이면 나눠 갖는다
      assert.ok(share >= 0.02 && share <= 0.05, `${sp.id} ${baitId} 판타지 비율 ${share}`);
    }
    // 조건 밖(다른 시간대 · 다른 날씨) → 정확히 0
    const offBand = BAND_IDS.find(b => !sp.fantasy.bands.includes(b));
    const offWeather = Object.keys(WEATHER).find(x => !sp.fantasy.weather.includes(x));
    for (const [b, wx] of [[offBand, weather], [band, offWeather]]) {
      const w = biteWeights({ spot, band: b, weather: wx, layer, baitId: sp.baits[0], rigStats: RS });
      assert.ok(!w.fantasy.includes(sp.id));
      assert.ok(!w.entries.some(e => e.speciesId === sp.id));
      const rng = makeRng(seedRng(5));
      for (let i = 0; i < 5000; i++) assert.notEqual(pickSpecies(rng, w, sp.baits[0]), sp.id);
    }
  }
});

test('대기 산수(§7.12): 자갈 · 바닥 · 떡밥 · 아침 26.7초 · 크릴 2.4배 · 크릴 최저 시간대(낮) 2.9배 ±5%', () => {
  const spot = getSpot('lake_gravel');
  const wait = (band, baitId) => {
    const w = biteWeights({ spot, band, weather: 'clear', layer: 'bottom', baitId, rigStats: RS });
    return { W: w.total, t: meanWait(biteRate(w, { weather: 'clear', rigStats: RS, drifting: false, bottomSlip: false })) };
  };
  const base = wait('morning', 'paste');
  assert.ok(Math.abs(base.W - 1.29) / 1.29 < 0.05, `W ${base.W}`);
  assert.ok(Math.abs(base.t - 26.7) / 26.7 <= 0.05, `대기 ${base.t}`);
  const krill = wait('morning', 'krill');
  assert.ok(Math.abs(krill.t - 65.0) / 65.0 <= 0.05, `크릴 대기 ${krill.t}`);
  assert.ok(Math.abs(krill.t / base.t - 2.4) / 2.4 <= 0.05, `크릴 배율 ${krill.t / base.t}`);
  const worstBand = BAND_IDS.map(b => ({ b, ...wait(b, 'krill') })).sort((a, b) => a.W - b.W)[0];
  assert.equal(worstBand.b, 'day');
  assert.ok(Math.abs(worstBand.t - 76.7) / 76.7 <= 0.05, `크릴 · 낮 대기 ${worstBand.t}`);
  assert.ok(Math.abs(worstBand.t / base.t - 2.9) / 2.9 <= 0.05, `배율 ${worstBand.t / base.t}`);
  // 위험률 배율: 날씨 · 흘림 · 봉돌 밀림 · 스킬
  const w = biteWeights({ spot, band: 'morning', weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: RS });
  const r0 = biteRate(w, { weather: 'clear', rigStats: RS });
  assert.ok(Math.abs(r0 - w.total / BITE.t0) < 1e-12);
  assert.ok(Math.abs(biteRate(w, { weather: 'rain', rigStats: RS }) / r0 - WEATHER.rain.biteMul) < 1e-12);
  assert.ok(Math.abs(biteRate(w, { weather: 'clear', rigStats: RS, drifting: true }) / r0 - BITE.driftMul) < 1e-12);
  assert.ok(Math.abs(biteRate(w, { weather: 'clear', rigStats: RS, bottomSlip: true }) / r0 - BITE.bottomSlipMul) < 1e-12);
  assert.ok(Math.abs(biteRate(w, { weather: 'clear', rigStats: { ...RS, biteRateMul: 1.2 } }) / r0 - 1.2) < 1e-12);
  assert.equal(meanWait(0), Infinity);
  assert.equal(biteRate({ entries: [], total: 0, fantasy: [] }, { weather: 'clear', rigStats: RS }), 0);
});

test('층 판정(§5.4.1) · depthAt 꺾은선', () => {
  assert.deepEqual(layerAt('bottom', 5, 1), { layer: 'bottom', baitDepth: 5 });
  assert.equal(layerAt('float', 5, 4.6).layer, 'bottom');             // 바닥과 0.4m ≤ bottomGapM
  assert.equal(layerAt('float', 5, 9).baitDepth, 5);                  // 찌 수심이 물보다 깊으면 바닥
  assert.equal(layerAt('float', 5, 9).layer, 'bottom');
  assert.equal(layerAt('float', 5, LAYER.surfaceMaxM).layer, 'surface');
  assert.equal(layerAt('float', 20, 0.25 * 20).layer, 'surface');     // surfaceFrac × 수심까지 표층
  assert.equal(layerAt('float', 20, 0.25 * 20 + 0.1).layer, 'mid');
  assert.equal(layerAt('float', 5, 2.5).layer, 'mid');
  const spot = getSpot('lake_gravel');                                // [[0,0.3],[10,2],[25,4.5],[45,7]]
  assert.equal(depthAt(spot, -3), 0.3);
  assert.equal(depthAt(spot, 10), 2.0);
  assert.ok(Math.abs(depthAt(spot, 17.5) - 3.25) < 1e-12);
  assert.equal(depthAt(spot, 99), 7.0);
});

test('흐림 · 비는 아침 · 낮의 활동을 한 단계 올린다(그 밖 시간대는 그대로)', () => {
  const spot = getSpot('lake_gravel');
  for (const band of BAND_IDS) {
    const clear = biteWeights({ spot, band, weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: RS });
    const cloudy = biteWeights({ spot, band, weather: 'cloudy', layer: 'bottom', baitId: 'paste', rigStats: RS });
    for (const e of clear.entries) {
      const sp = getSpecies(e.speciesId);
      const c = sp.time[BAND_IDS.indexOf(band)];
      const up = band === 'morning' || band === 'day' ? BITE.stepUp[c] : c;
      const ratio = BITE.timeCoef[c] > 0 ? BITE.timeCoef[up] / BITE.timeCoef[c] : 0;
      const ce = cloudy.entries.find(x => x.speciesId === e.speciesId);
      if (BITE.timeCoef[c] === 0) assert.equal(ce.w, 0);
      else assert.ok(Math.abs(ce.w - e.w * ratio) < 1e-12, `${e.speciesId} ${band}`);
    }
  }
  // 날씨 인자는 WeatherId · WeatherDef · WeatherState 어느 것이든 같은 값
  const a = biteWeights({ spot, band: 'day', weather: 'rain', layer: 'bottom', baitId: 'corn', rigStats: RS });
  const b = biteWeights({ spot, band: 'day', weather: WEATHER.rain, layer: 'bottom', baitId: 'corn', rigStats: RS });
  const c = biteWeights({ spot, band: 'day', weather: { current: 'rain' }, layer: 'bottom', baitId: 'corn', rigStats: RS });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test('farMul(dist ≥ farFromM) · 바늘이 입보다 크면 입질이 준다 · 라인 입질 배율', () => {
  const spot = getSpot('lake_cape');                                   // farFromM 30 · 쏘가리 · 강준치 farMul 2
  const args = { spot, band: 'dawn', weather: 'clear', layer: 'bottom', baitId: 'live', rigStats: RS };
  const near = biteWeights({ ...args, distM: 29.9 });
  const far = biteWeights({ ...args, distM: 30 });
  for (const p of spot.pool) {
    const n = near.entries.find(e => e.speciesId === p.id);
    const f = far.entries.find(e => e.speciesId === p.id);
    if (!n) continue;
    assert.ok(Math.abs(f.w - n.w * (p.farMul ?? 1)) < 1e-12, p.id);
  }
  assert.ok(far.total > near.total);
  const gravel = getSpot('lake_gravel');                               // farFromM null → 거리와 무관
  const g0 = biteWeights({ ...args, spot: gravel, distM: 0 });
  const g1 = biteWeights({ ...args, spot: gravel, distM: 200 });
  assert.deepEqual(g0, g1);
  // 붕어(입 1): hook_m(2) → ×0.6 · hook_l(3) → ×0.3 · hook_s(1) → ×1
  const crucian = (hookSize) => biteWeights({ spot: gravel, band: 'morning', weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: { ...RS, hookSize } })
    .entries.find(e => e.speciesId === 'crucian').w;
  assert.ok(Math.abs(crucian(2) / crucian(1) - BITE.hookBigger[1]) < 1e-12);
  assert.ok(Math.abs(crucian(3) / crucian(1) - BITE.hookBigger[2]) < 1e-12);
  const thick = biteWeights({ spot: gravel, band: 'morning', weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: { ...RS, lineBiteMul: 0.8 } });
  const thin = biteWeights({ spot: gravel, band: 'morning', weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: RS });
  assert.ok(Math.abs(thick.total / thin.total - 0.8) < 1e-12);
});

test('pickSpecies 결정성 · 가중치 0 이면 null', () => {
  const spot = getSpot('lake_gravel');
  const w = biteWeights({ spot, band: 'morning', weather: 'clear', layer: 'bottom', baitId: 'paste', rigStats: RS });
  const a = makeRng(seedRng(3));
  const b = makeRng(seedRng(3));
  for (let i = 0; i < 300; i++) assert.equal(pickSpecies(a, w, 'paste'), pickSpecies(b, w, 'paste'));
  assert.equal(pickSpecies(makeRng(seedRng(1)), { entries: [{ speciesId: 'crucian', w: 0 }], total: 0, fantasy: [] }, 'paste'), null);
});
