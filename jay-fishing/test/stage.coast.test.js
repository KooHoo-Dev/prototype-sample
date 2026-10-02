// OWNER: P11 — 계약 §12.2(stage test) · §7.4.3 · §7.3.2 · §9.4
// 갯바위(조가사키 해안): 데이터 완결성 · 자리마다 실제 GameSim 위의 createAngler(기본/조절) 100판 · 흘림/봉돌 밀림의 경계(조류 홈) ·
// 판타지 2종의 조건 · coastProps 가 Node 에서 만들어지고 배치 규칙(§9.4)을 지킨다.
// 같은 웨이브(W2)의 구현에 기대지 않는다 — GameSim · rig · fight · progression · angler 는 W1 완성분이다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BAND_IDS, LAYER_IDS, WEATHER_IDS } from '../src/core/constants.js';
import { EV, EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { angleDiff, fwd, pointInConvex, shoreZAt, yawOf } from '../src/core/math.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { BITE, CAST } from '../src/data/bite.js';
import { COAST_SPECIES } from '../src/data/species/coast.js';
import { getSpecies } from '../src/data/species/index.js';
import { COAST } from '../src/data/stages/coast.js';
import { getStage } from '../src/data/stages/index.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { GameSim } from '../src/sim/GameSim.js';
import { biteWeights, pickSpecies } from '../src/sim/fishing/biteModel.js';
import { createAngler } from '../src/bot/angler.js';
import { buildCoastProps } from '../src/view/stages/coastProps.js';
import { STAGE_PROPS } from '../src/view/stages/index.js';
import { createTerrainField } from '../src/view/world/terrain.js';
import { assertFiniteDeep, assertShape, makeTestRigStats } from './helpers.js';

const STAGE = getStage('coast');
const BOT_COMMANDS = new Set(['keepCatch', 'releaseCatch', 'sellAll', 'buy', 'refillLine', 'equip', 'setBait', 'setDepth', 'learnSkill', 'travel', 'waitNextBand', 'sleep', 'exitFishing']);

/** stand 에서 yaw 방향 반직선이 해안선 꺾은선을 처음 만나는 거리 */
function rayToShore(stage, from, yaw) {
  const d = fwd(yaw);
  let best = Infinity;
  for (let i = 1; i < stage.shore.length; i++) {
    const a = stage.shore[i - 1];
    const b = stage.shore[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const den = d.x * ez - d.z * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - from.x) * ez - (a.z - from.z) * ex) / den;
    const u = ((a.x - from.x) * d.z - (a.z - from.z) * d.x) / den;
    if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

// ═══════════════════════ 1. 데이터 ═══════════════════════

test('데이터 완결성 — 어종 12 · 층 3 × 시간대 5 · 풀 참조 · 이름 키', () => {
  assert.equal(STAGE, COAST);
  assert.ok(COAST_SPECIES.length >= 10, `어종 ${COAST_SPECIES.length}`);
  const ids = new Set();
  for (const s of COAST_SPECIES) {
    assert.equal(s.stage, 'coast', s.id);
    assert.ok(!ids.has(s.id), `중복 ${s.id}`);
    ids.add(s.id);
    assert.ok(getSpecies(s.id), `레지스트리에 ${s.id}`);
    assert.ok(typeof STRINGS[`species.${s.id}`] === 'string', `이름 키 species.${s.id}`);
    assert.match(s.time, /^[0LNH]{5}$/, s.id);
  }
  // 층 × 시간대 각 칸에 계수 > 0 인 비판타지 어종
  for (const layer of LAYER_IDS) {
    for (let b = 0; b < BAND_IDS.length; b++) {
      const any = COAST_SPECIES.some(s => !s.fantasy && s.layers.includes(layer) && s.time[b] !== '0');
      assert.ok(any, `빈 칸: ${layer} × ${BAND_IDS[b]}`);
    }
  }
  // 풀: 모두 갯바위 어종 · 모든 어종이 한 자리 이상에 · 판타지 w = 1
  const pooled = new Set();
  for (const sp of COAST.spots) {
    assert.ok(typeof STRINGS[`spot.${sp.id}`] === 'string', `이름 키 spot.${sp.id}`);
    for (const p of sp.pool) {
      assert.ok(ids.has(p.id), `${sp.id}: 갯바위 밖 어종 ${p.id}`);
      assert.ok(p.w > 0, `${sp.id}/${p.id} w`);
      if (p.farMul !== undefined) assert.ok(p.farMul > 0);
      if (getSpecies(p.id).fantasy) assert.equal(p.w, 1, `판타지 ${p.id} w`);
      pooled.add(p.id);
    }
  }
  for (const id of ids) assert.ok(pooled.has(id), `어느 풀에도 없다: ${id}`);
});

test('스테이지 기하 — walk 볼록 · 방향 · stand/spawn/approach · edgeM 검산 · 캐스팅 부채꼴은 물 · 수심 · 장애물 띠 · farFromM', () => {
  const w = COAST.walk;
  let area = 0;
  for (let i = 0; i < w.length; i++) {
    const a = w[i];
    const b = w[(i + 1) % w.length];
    area += a.x * b.z - b.x * a.z;
  }
  assert.ok(area > 0, '꼭짓점 방향');
  const inObs = (x, z) => COAST.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r);
  assert.ok(pointInConvex(w, COAST.spawn.x, COAST.spawn.z) && !inObs(COAST.spawn.x, COAST.spawn.z), 'spawn');
  for (const pt of COAST.points) {
    assert.ok(pointInConvex(w, pt.approach.x, pt.approach.z), `${pt.id} approach 가 walk 밖`);
    assert.ok(!inObs(pt.approach.x, pt.approach.z), `${pt.id} approach 가 obstacles 안`);
    assert.ok(Math.hypot(pt.approach.x - pt.x, pt.approach.z - pt.z) <= pt.radius, `${pt.id} approach 가 radius 밖`);
  }
  for (const sp of COAST.spots) {
    assert.ok(pointInConvex(w, sp.stand.x, sp.stand.z) && !inObs(sp.stand.x, sp.stand.z), `${sp.id} stand`);
    assert.ok(sp.stand.z > shoreZAt(COAST.shore, sp.stand.x), `${sp.id} stand 가 물 위`);
    const edge = rayToShore(COAST, sp.stand, sp.facing);
    assert.ok(Math.abs(edge - sp.edgeM) <= 0.15, `${sp.id} edgeM ${sp.edgeM} ↔ 실제 ${edge.toFixed(3)}`);
    for (let k = 0; k <= 12; k++) {
      const yaw = sp.facing - sp.arc + (2 * sp.arc * k) / 12;
      for (let d = sp.minCastM; d <= 80; d += 2) {
        const p = fwd(yaw, d);
        const x = sp.stand.x + p.x;
        const z = sp.stand.z + p.z;
        assert.ok(z < shoreZAt(COAST.shore, x), `${sp.id} 착수점이 땅: yaw ${yaw.toFixed(2)} d ${d}`);
      }
    }
    for (let i = 1; i < sp.depth.length; i++) {
      assert.ok(sp.depth[i][0] > sp.depth[i - 1][0] && sp.depth[i][1] >= sp.depth[i - 1][1], `${sp.id} depth 증가`);
    }
    assert.ok(sp.snag.fromM > sp.minCastM, `${sp.id} snag`);
    assert.ok(sp.farFromM === null || (sp.farFromM > sp.minCastM && sp.farFromM <= sp.maxDriftM), `${sp.id} farFromM`);
    assert.ok(Math.hypot(sp.flow.x, sp.flow.z) >= BITE.driftMinFlow, `${sp.id}: 갯바위는 조류가 있다(흘림 가능)`);
  }
  assert.ok(CAST.minLineM >= Math.max(...COAST.spots.map(s => s.minCastM)) + CAST.lineReserveM, 'minLineM');
});

test('조류 홈의 먼 곳(farFromM 40): 참돔 · 잿방어만 ×2 · 다른 어종은 그대로', () => {
  const ch = COAST.spots.find(s => s.id === 'coast_channel');
  assert.equal(ch.farFromM, 40);
  const farIds = ch.pool.filter(p => (p.farMul ?? 1) !== 1).map(p => p.id).sort();
  assert.deepEqual(farIds, ['amberjack', 'redSeabream']);
  const rs = makeTestRigStats('float');
  const near = biteWeights({ spot: ch, band: 'morning', weather: 'clear', layer: 'mid', baitId: 'krill', rigStats: rs, distM: 39.9 });
  const far = biteWeights({ spot: ch, band: 'morning', weather: 'clear', layer: 'mid', baitId: 'krill', rigStats: rs, distM: 40 });
  for (const e of near.entries) {
    const f = far.entries.find(x => x.speciesId === e.speciesId);
    const mul = ch.pool.find(p => p.id === e.speciesId).farMul ?? 1;
    assert.ok(Math.abs(f.w - e.w * mul) < 1e-12, `${e.speciesId}: ${e.w} → ${f.w} (×${mul})`);
  }
  // 다른 두 자리는 먼 곳 보상이 없다
  for (const sp of COAST.spots) if (sp.id !== 'coast_channel') assert.equal(sp.farFromM, null, sp.id);
});

// ═══════════════════════ 2. 판타지 ═══════════════════════

test('판타지 조건: 좀비 상어 = 비 · 밤만 / 핑크 상어 = 맑음 · 낮만 — 조건 밖 0 · 조건 안 2–5%', () => {
  const zombie = getSpecies('zombieShark');
  const pink = getSpecies('pinkShark');
  assert.deepEqual(zombie.fantasy, { bands: ['night'], weather: ['rain'] });
  assert.deepEqual(pink.fantasy, { bands: ['day'], weather: ['clear'] });
  const rs = makeTestRigStats('float', { hookSize: 3 });
  let checkedIn = 0;
  for (const sp of COAST.spots) {
    for (const band of BAND_IDS) {
      for (const weather of WEATHER_IDS) {
        for (const layer of LAYER_IDS) {
          const w = biteWeights({ spot: sp, band, weather, layer, baitId: 'live', rigStats: rs, distM: 30 });
          const inPool = (id) => sp.pool.some(p => p.id === id);
          const expect = [];
          if (inPool('zombieShark') && band === 'night' && weather === 'rain') expect.push('zombieShark');
          if (inPool('pinkShark') && band === 'day' && weather === 'clear') expect.push('pinkShark');
          assert.deepEqual([...w.fantasy].sort(), expect.sort(), `${sp.id} ${band} ${weather} ${layer}`);
          // 판타지는 가중치 표(entries)에 들어가지 않는다
          assert.ok(!w.entries.some(e => e.speciesId === 'zombieShark' || e.speciesId === 'pinkShark'));
          // 표본: 조건 밖이면 0, 안이면 2–5%
          const rng = makeRng(seedRng(1000 + checkedIn));
          const N = expect.length ? 20000 : 1500;
          let hit = 0;
          for (let i = 0; i < N; i++) {
            const id = pickSpecies(rng, w, 'live');
            if (id === 'zombieShark' || id === 'pinkShark') hit++;
          }
          if (!expect.length) assert.equal(hit, 0, `조건 밖 판타지: ${sp.id} ${band} ${weather}`);
          else {
            const rate = hit / N;
            assert.ok(rate >= 0.02 && rate <= 0.05, `${sp.id} ${band} ${weather}: 판타지 ${(rate * 100).toFixed(2)}%`);
          }
          checkedIn++;
        }
      }
    }
  }
  // 두 종 모두 어딘가에서 조건이 맞는다(풀에 있다)
  assert.ok(COAST.spots.some(s => s.pool.some(p => p.id === 'zombieShark')));
  assert.ok(COAST.spots.some(s => s.pool.some(p => p.id === 'pinkShark')));
});

// ═══════════════════════ 3. 자리 봇 100판 ═══════════════════════

function makeSim(opts) {
  const bus = new EventBus();
  const log = [];
  bus.onAny((name, payload) => log.push({ name, payload }));
  const sim = new GameSim({ bus, session: { ignoreGates: true, devSession: true }, ...opts });
  sim.start();
  // 자리 봇은 살 수 없다 — 미끼 · 돈을 넉넉히(라인 손실은 예비 스풀이 맡는다)
  for (const k of Object.keys(sim.state.profile.baits)) sim.state.profile.baits[k] = 5000;
  sim.state.profile.money = 100000000;
  sim.ctx.refresh();
  return { sim, log };
}

/** 지금 찌/봉돌 · 물고기가 물 위에 있는가(땅으로 가지 않는다) */
function checkWater(sim, where) {
  const s = sim.state;
  const r = s.rig;
  const spot = sim.ctx.spot;
  if (['waiting', 'bite'].includes(r.phase) && r.bobber) {
    assert.ok(r.bobber.z < shoreZAt(STAGE.shore, r.bobber.x), `${where}: 찌가 땅 위 (${r.bobber.x.toFixed(2)}, ${r.bobber.z.toFixed(2)})`);
  }
  if (s.fight && spot) {
    const p = fwd(s.fight.bearing, s.fight.dist);
    const x = spot.stand.x + p.x;
    const z = spot.stand.z + p.z;
    assert.ok(z < shoreZAt(STAGE.shore, x), `${where}: 물고기가 땅 위 (${x.toFixed(2)}, ${z.toFixed(2)}) dist ${s.fight.dist.toFixed(2)}`);
  }
}

const RUNS = [
  { spotId: 'coast_shoal', weather: 'clear', hour: 5, combos: [['basic', 'float', 'krill', 3], ['controlled', 'bottom', 'shrimp', null]] },
  { spotId: 'coast_channel', weather: 'rain', hour: 16, combos: [['basic', 'float', 'krill', 5], ['controlled', 'bottom', 'shrimp', null]] },
  { spotId: 'coast_cape', weather: 'cloudy', hour: 4, combos: [['basic', 'bottom', 'shrimp', null], ['controlled', 'float', 'live', 6]] },
];

for (const run of RUNS) {
  for (const [strategy, set, baitId, depthM] of run.combos) {
    test(`createAngler 100판 — ${run.spotId} · ${strategy} · ${set}/${baitId} · ${run.weather} ${run.hour}시부터: 예외 0 · NaN 0 · 땅 위 찌/물고기 0`, () => {
      const { sim, log } = makeSim({ seed: 41 + run.hour, start: { scene: 'coast', spotId: run.spotId, hour: run.hour, weather: run.weather } });
      assert.equal(sim.state.player.mode, 'fish');
      assert.equal(sim.state.player.spotId, run.spotId);
      const bot = createAngler({ strategy, seed: 9, set, baitId, depthM });
      let casts = 0;
      let steps = 0;
      const LIMIT = 3000000;
      for (let d = 0; d < LIMIT * 2 && steps < LIMIT; d++) {
        const a = bot.decide(sim.state, sim);
        if (a.command) {
          assert.ok(BOT_COMMANDS.has(a.command.name), a.command.name);
          const r = sim[a.command.name](...a.command.args);
          assert.ok(r && typeof r.ok === 'boolean');
        }
        if (sim.state.rig.phase === 'result') continue;
        const n = log.length;
        sim.step(a.input);
        steps++;
        for (let i = n; i < log.length; i++) if (log[i].name === EV.CAST_RELEASE) casts++;
        if (steps % 30 === 0) checkWater(sim, `${run.spotId} @${steps}`);
        if (steps % 3000 === 0) {
          assertFiniteDeep(sim.state, `${run.spotId} @${steps}`);
          assert.ok(sim.state.profile.money >= 0);
        }
        const ph = sim.state.rig.phase;
        if (casts >= 100 && (ph === 'ready' || ph === 'charging')) break;
      }
      assert.ok(casts >= 100, `${casts}판에서 멈췄다 (phase ${sim.state.rig.phase} · ${steps}틱)`);
      assertFiniteDeep(sim.state, 'end');
      assertShape(sim.state.rig, 'RigState', 'rig');
      assertShape(sim.state.player, 'PlayerState', 'player');
      const ends = log.filter(e => e.name === EV.FIGHT_END);
      const landed = ends.filter(e => e.payload.outcome === 'landed').length;
      assert.ok(ends.length >= 20, `파이팅 ${ends.length}`);
      assert.ok(landed >= 1, `랜딩 0 (파이팅 ${ends.length})`);
      // 이 자리 풀 밖의 어종은 물지 않는다
      const pool = new Set(sim.ctx.spot.pool.map(p => p.id));
      for (const e of log) if (e.name === EV.CATCH_RESULT) assert.ok(pool.has(e.payload.catch.speciesId), e.payload.catch.speciesId);
    });
  }
}

// ═══════════════════════ 4. 흘림 · 봉돌 밀림 경계 ═══════════════════════

/** 캐스팅 → 대기에서 베일을 연다(찌) — 입질 없이 secs 초 흘린다. 매 틱 경계를 본다 */
function driftRun(spotId, set, aimRel, secs) {
  const { sim } = makeSim({ seed: 7, start: { scene: 'coast', spotId, hour: 9, weather: 'clear' } });
  sim.state.debug.noBites = true;
  const spot = sim.ctx.spot;
  const bot = createAngler({ strategy: 'basic', seed: 2, set, baitId: set === 'float' ? 'krill' : 'shrimp', depthM: set === 'float' ? 3 : null });
  const aim = spot.facing + aimRel;
  let opened = false;
  let landed = null;
  let maxD = 0;
  let moved = 0;
  let last = null;
  let waitTicks = 0;
  for (let t = 0; t < 60 * (secs + 20) && waitTicks < 60 * secs; t++) {
    const a = bot.decide(sim.state, sim);
    if (a.command) sim[a.command.name](...a.command.args);
    const input = { ...a.input, yaw: aim };
    const r = sim.state.rig;
    if (r.phase === 'waiting') {
      if (!landed) landed = { x: r.bobber.x, z: r.bobber.z, d: r.dist };
      if (set === 'float' && !opened) { input.bail = true; opened = true; }
      input.primary = false;
      input.primaryPressed = false;
      waitTicks++;
    }
    sim.step(input);
    const rr = sim.state.rig;
    if (rr.phase === 'waiting') {
      const b = rr.bobber;
      const dx = b.x - spot.stand.x;
      const dz = b.z - spot.stand.z;
      const d = Math.hypot(dx, dz);
      assert.ok(b.z < shoreZAt(STAGE.shore, b.x), `${spotId}/${set}: 땅 위 (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
      if (rr.drifting || rr.bottomSlip) {
        assert.ok(b.z < shoreZAt(STAGE.shore, b.x) - CAST.shoreMarginM + 1e-9, `${spotId}/${set}: 물가 여유 안`);
        assert.ok(Math.abs(angleDiff(spot.facing, yawOf(dx, dz))) <= CAST.driftArc + 1e-9, `${spotId}/${set}: driftArc 밖`);
        assert.ok(d >= spot.minCastM - 1e-9, `${spotId}/${set}: 최소 거리 안`);
      }
      if (set === 'float') {
        assert.ok(d <= spot.maxDriftM + 1e-6, `${spotId}: maxDriftM 넘음 ${d}`);
        assert.ok(d <= sim.state.profile.sets.float.lineM - CAST.driftReserveM + 1e-6, `${spotId}: 라인 여유 넘음`);
      }
      assert.ok(Math.abs(rr.dist - d) < 1e-6, 'rig.dist = stand 에서 찌까지');
      maxD = Math.max(maxD, d);
      if (last) moved += Math.hypot(b.x - last.x, b.z - last.z);
      last = { x: b.x, z: b.z };
    }
    assertFiniteDeep(rr, 'rig');
  }
  assert.ok(landed, `${spotId}/${set}: 착수하지 못했다`);
  return { landed, maxD, moved, last, spot, sim };
}

test('흘림(찌 · 베일 열기): 세 자리 × 조준 셋 — 하류(+X)로 흐르고 땅 · 물가 · driftArc · maxDriftM · 라인 여유를 넘지 않는다', () => {
  for (const sp of COAST.spots) {
    for (const rel of [-sp.arc, 0, sp.arc]) {
      const r = driftRun(sp.id, 'float', rel, 150);
      assert.ok(r.moved > 5, `${sp.id} ${rel}: 흘림 ${r.moved.toFixed(1)}m`);
      assert.ok(r.last.x > r.landed.x, `${sp.id} ${rel}: 흐름(+X) 쪽으로 가지 않았다`);
    }
  }
});

test('조류 홈: 흘려서 farFromM(40m) 너머까지 간다 — 먼 곳 보상이 실제로 닿는다', () => {
  const ch = COAST.spots.find(s => s.id === 'coast_channel');
  const r = driftRun('coast_channel', 'float', 0, 150);
  assert.ok(r.maxD >= ch.farFromM, `최대 ${r.maxD.toFixed(1)}m < ${ch.farFromM}m`);
});

test('봉돌 밀림(바닥 채비 · 1단계 봉돌 0.5m/s < 조류): 땅 · 물가 · driftArc · 최소 거리를 넘지 않는다', () => {
  let slipped = 0;
  for (const sp of COAST.spots) {
    for (const rel of [-sp.arc, sp.arc]) {
      const r = driftRun(sp.id, 'bottom', rel, 120);
      if (r.moved > 0.5) slipped++;
    }
  }
  assert.ok(slipped >= 2, '조류 홈(0.7m/s)에서도 봉돌이 밀리지 않았다');
});

// ═══════════════════════ 5. 소품 ═══════════════════════

const ENV = (over = {}) => ({ hour: 12, light: 1, night: false, sunDir: new THREE.Vector3(0, 1, 0), weather: 'clear', waveAmp: 0.18, wavePeriod: 6, time: 0, camPos: new THREE.Vector3(0, 2, 20), ...over });

/** 그룹 아래 모든 메시(인스턴스는 하나씩)의 월드 AABB */
function forEachBox(group, fn) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const im = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        m.multiplyMatrices(o.matrixWorld, im);
        box.copy(o.geometry.boundingBox).applyMatrix4(m);
        fn(box, `${o.name}#${i}`, o);
      }
    } else {
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      fn(box, o.name || o.parent?.name || 'mesh', o);
    }
  });
}

function inSpotView60(stage, x, z) {
  for (const sp of stage.spots) {
    const dx = x - sp.stand.x;
    const dz = z - sp.stand.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) return sp.id;
    if (d <= 60 && Math.abs(angleDiff(sp.facing, yawOf(dx, dz))) <= sp.arc) return sp.id;
  }
  return null;
}

test('coastProps: Node 에서 만들어진다(three 만) · 화질 셋 · 장소의 개성(용암 · 거품 · 절벽 · 등대 · 트럭 · 소나무) · update · dispose', () => {
  assert.equal(STAGE_PROPS.coast, buildCoastProps);
  const field = createTerrainField(STAGE);
  for (const q of /** @type {const} */ (['low', 'medium', 'high'])) {
    const props = buildCoastProps({ stage: STAGE, quality: q, heightAt: field.heightAt });
    assert.ok(props.group instanceof THREE.Group);
    const names = new Set();
    let tris = 0;
    props.group.traverse((o) => {
      names.add(o.name);
      if (o.isMesh) {
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), `${o.name} NaN 정점`);
        const n = o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
        tris += n * (o.isInstancedMesh ? o.count : 1);
      }
    });
    for (const want of ['lighthouse', 'lighthouseBeam', 'fishTruck', 'izuOshima', 'surfFoam', 'surfSpray', 'pineTrunks', 'pineCrowns', 'lavaRocks0', 'lavaBoulders']) {
      assert.ok(names.has(want), `${q}: ${want} 없음`);
    }
    const inst = (name) => props.group.getObjectByName(name);
    assert.ok(inst('pineCrowns').count >= 60, `${q}: 소나무 ${inst('pineCrowns').count}`);
    assert.ok(inst('surfFoam').count >= 40, `${q}: 거품 ${inst('surfFoam').count}`);
    let bigRocks = 0;
    for (let i = 0; i < 4; i++) bigRocks += inst(`lavaRocks${i}`).count;
    assert.ok(bigRocks >= 200, `${q}: 큰 바위 ${bigRocks}`);
    assert.ok(tris < 1500000, `${q}: 삼각형 ${tris}`);
    // 등대는 look.lighthouse 에
    const lh = inst('lighthouse');
    assert.equal(lh.position.x, STAGE.look.lighthouse.x);
    assert.equal(lh.position.z, STAGE.look.lighthouse.z);
    // update: 낮 · 해 질 녘 · 비 · 밤 · 큰 dt · 이상한 값 — 던지지 않고 값이 유한
    const beam = inst('lighthouseBeam');
    const envs = [ENV(), ENV({ hour: 19.5, light: 0.3 }), ENV({ weather: 'rain', light: 0.6, waveAmp: 0.3 }), ENV({ hour: 23, light: 0.08, night: true }),
      ENV({ time: 1e6, waveAmp: 0, wavePeriod: 0 }), ENV({ light: NaN, time: NaN, waveAmp: NaN, wavePeriod: NaN })];
    for (const env of envs) {
      for (const dt of [0, 1 / 60, 10, NaN]) {
        props.update(env, dt);
        props.group.traverse((o) => {
          if (o.material && !Array.isArray(o.material)) {
            const mm = /** @type {any} */ (o.material);
            assert.ok(Number.isFinite(mm.opacity), `${o.name} opacity`);
            if (mm.emissiveIntensity !== undefined) assert.ok(Number.isFinite(mm.emissiveIntensity), `${o.name} emissive`);
            if (mm.color) assert.ok(Number.isFinite(mm.color.r + mm.color.g + mm.color.b), `${o.name} color`);
          }
        });
        assert.ok(Number.isFinite(beam.rotation.y));
      }
    }
    props.update(ENV(), 1 / 60);
    assert.equal(beam.visible, false, '한낮에 등대 빛줄기');
    props.update(ENV({ hour: 22, light: 0.1, night: true }), 1 / 60);
    assert.equal(beam.visible, true, '밤에 등대 빛줄기가 없다');
    // 화질 왕복: 지오메트리 수 불변 · 개수만 바뀐다
    const geoCount = () => { const s = new Set(); props.group.traverse(o => { if (o.isMesh) s.add(o.geometry); }); return s.size; };
    const g0 = geoCount();
    const counts = {};
    for (const qq of ['low', 'high', 'medium', 'low']) {
      props.setQuality(/** @type {any} */ (qq));
      counts[qq] = inst('coastGrass').count;
      assert.equal(geoCount(), g0);
    }
    assert.ok(counts.low < counts.medium && counts.medium < counts.high, JSON.stringify(counts));
    props.dispose();
  }
});

test('coastProps 배치 규칙(§9.4): 걷는 영역 안 0.5m 초과는 obstacles 원 안 · 자리 시야(facing ± arc · 60m)를 가리지 않는다 · 흘림 물길에 바위 없음 · 트럭은 판매상 원 안', () => {
  const field = createTerrainField(STAGE);
  const props = buildCoastProps({ stage: STAGE, quality: 'high', heightAt: field.heightAt });
  const inObs = (x, z) => STAGE.obstacles.some(o => Math.hypot(x - o.x, z - o.z) <= o.r);
  const problems = [];
  let checked = 0;
  forEachBox(props.group, (box, name, o) => {
    if (o.name === 'izuOshima' || o.name === 'lighthouseBeam') return;     // 수평선 실루엣 · 빛(가산 혼합 — 가리지 않는다)
    checked++;
    const xs = [box.min.x, box.max.x, (box.min.x + box.max.x) / 2];
    const zs = [box.min.z, box.max.z, (box.min.z + box.max.z) / 2];
    let gMin = Infinity;
    for (const x of xs) for (const z of zs) gMin = Math.min(gMin, field.heightAt(x, z));
    const tall = box.max.y - Math.max(gMin, box.min.y);    // 떠 있는 납작한 것(거품)은 자기 두께만
    for (const x of xs) {
      for (const z of zs) {
        // 0.5m 규칙
        if (tall > 0.5 && pointInConvex(STAGE.walk, x, z) && !inObs(x, z)) problems.push(`0.5m: ${name} (${x.toFixed(1)}, ${z.toFixed(1)}) 높이 ${tall.toFixed(2)}`);
        // 시야: 수면(또는 땅) 위로 0.25m 넘게 솟은 것
        const above = box.max.y - Math.max(0, field.heightAt(x, z));
        const flat = o.name === 'surfFoam';
        if (!flat && above > 0.25) {
          const sv = inSpotView60(STAGE, x, z);
          if (sv) problems.push(`시야 ${sv}: ${name} (${x.toFixed(1)}, ${z.toFixed(1)})`);
        }
      }
    }
    // 흘림 물길(찌가 갈 수 있는 곳 — 하류 쪽 driftArc · maxDriftM): 물 위로 솟은 바위 · 물보라 없음
    if (!/^lavaRocks|surfSpray|lighthouse$/.test(o.name) && o.parent?.name !== 'lighthouse') return;
    if (box.max.y <= 0) return;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const hr = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    for (const sp of STAGE.spots) {
      const d = Math.hypot(cx - sp.stand.x, cz - sp.stand.z);
      if (d - hr > sp.maxDriftM) continue;
      // 원 둘레 점이 흘림 부채꼴(facing − driftArc … facing + arc) 안 · maxDriftM 안 · 물이면 문제
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = cx + Math.cos(a) * hr * 0.7;
        const z = cz + Math.sin(a) * hr * 0.7;
        if (z >= shoreZAt(STAGE.shore, x)) continue;
        const dd = Math.hypot(x - sp.stand.x, z - sp.stand.z);
        const rel = angleDiff(sp.facing, yawOf(x - sp.stand.x, z - sp.stand.z));
        if (dd <= sp.maxDriftM && rel >= -CAST.driftArc && rel <= sp.arc) { problems.push(`흘림 ${sp.id}: ${name} (${x.toFixed(1)}, ${z.toFixed(1)})`); break; }
      }
    }
  });
  assert.ok(checked > 1000, `검사한 상자 ${checked}`);
  assert.deepEqual(problems.slice(0, 12), [], `${problems.length}건`);
  // 트럭 · 깃발 · 양동이 전부 판매상 obstacles 원 안
  const npc = STAGE.points.find(p => p.kind === 'npc');
  const circle = STAGE.obstacles.reduce((b, o) => (Math.hypot(o.x - npc.x, o.z - npc.z) < Math.hypot(b.x - npc.x, b.z - npc.z) ? o : b));
  const truck = props.group.getObjectByName('fishTruck');
  assert.ok(truck, 'fishTruck');
  const tb = new THREE.Box3().setFromObject(truck);
  for (const x of [tb.min.x, tb.max.x]) for (const z of [tb.min.z, tb.max.z]) {
    assert.ok(Math.hypot(x - circle.x, z - circle.z) <= circle.r, `트럭 모서리 (${x.toFixed(2)}, ${z.toFixed(2)})가 원 밖`);
  }
  assert.ok(tb.max.y - tb.min.y > 1.5, '트럭 높이');
  // 판매상(원의 npc 쪽 가장자리)과 겹치지 않는다: 판매상 자리(WorldLayer 규칙) 둘레 0.32m 는 트럭 상자 밖이거나 차양 아래(높이 1.9m 위)
  const dx = npc.x - circle.x;
  const dz = npc.z - circle.z;
  const dl = Math.hypot(dx, dz);
  const maxD = circle.r - 0.32;
  const nx = dl > maxD ? circle.x + dx / dl * maxD : npc.x;
  const nz = dl > maxD ? circle.z + dz / dl * maxD : npc.z;
  forEachBox(truck, (box, name) => {
    if (box.min.y > truck.position.y + 1.9) return;
    const cxp = Math.max(box.min.x, Math.min(nx, box.max.x));
    const czp = Math.max(box.min.z, Math.min(nz, box.max.z));
    assert.ok(Math.hypot(cxp - nx, czp - nz) >= 0.32, `판매상과 겹친다: ${name}`);
  });
  props.dispose();
});

test('coastProps 결정성: 같은 입력이면 같은 배치', () => {
  const field = createTerrainField(STAGE);
  const sig = () => {
    const p = buildCoastProps({ stage: STAGE, quality: 'medium', heightAt: field.heightAt });
    let h = 0;
    forEachBox(p.group, (box) => { h = (h * 31 + Math.round(box.min.x * 100) + Math.round(box.max.y * 100)) % 1000000007; });
    p.dispose();
    return h;
  };
  assert.equal(sig(), sig());
});

// 입력 기본값이 바뀌지 않았는지(테스트가 덮어쓰는 필드)
test('NEUTRAL_INPUT 에 bail · yaw 필드가 있다(흘림 테스트의 전제)', () => {
  assert.ok('bail' in NEUTRAL_INPUT && 'yaw' in NEUTRAL_INPUT);
});
