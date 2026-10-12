// OWNER: P15 — 계약 §12.2 · §12.4 S5 (perf.test.js)
// 성능: 생성 맵(균열 5)에 깨어 있는 몬스터 120 + 투사체 200 → 300틱 평균 step ≤ 4ms(Node) · generateRift 시드 20개 각 ≤ 150ms.
// 다른 테스트 파일과 같이 돌아 CPU 를 나눠 쓰므로(npm test 는 파일을 병렬로 돈다) 시간 측정은 최대 3번 해 가장 좋은 값으로 본다(측정 잡음 — 판정 기준은 그대로).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { GameSim } from '../src/sim/GameSim.js';
import { spawnMonster } from '../src/sim/monsters/monsters.js';
import { spawnProjectile } from '../src/sim/projectiles.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { randomWalkableNear } from '../src/sim/world/nav.js';
import { assertFiniteDeep } from './helpers.js';

const MONS = 120, PROJS = 200, TICKS = 300;

/** 균열 5 · 무적 플레이어 · 맵의 몬스터를 치우고 깨어 있는 몬스터 MONS · 적대 투사체 PROJS 를 늘 채운다 */
function scene(seed) {
  const sim = new GameSim({ bus: new EventBus(), seed, devSession: true });
  sim.start();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'perf' });
  sim.debugOpenRift(5, seed);
  sim.debugSetInvincible(true);
  const st = sim.state;
  const ctx = sim.ctx;
  for (const m of st.rift.mons) m.gone = true;
  sim.step(NEUTRAL_INPUT);
  const rng = makeRng(seedRng(seed + 1));
  const p = st.player.pos;
  const types = ['ghoul', 'fallen', 'skeletonArcher', 'shieldSkeleton', 'charger'];
  let k = 0;
  const top = () => {
    let alive = 0;
    for (const m of st.rift.mons) if (!m.dead && !m.gone && m.awake) alive++;
    for (; alive < MONS; alive++) {
      const q = randomWalkableNear(ctx.map, rng, p.x, p.z, 3, 14, 24) ?? { x: p.x, z: p.z };
      spawnMonster(ctx, { typeId: types[k++ % types.length], rank: 'normal', level: 5, x: q.x, z: q.z, awake: true });
    }
    let n = 0;
    for (const pr of st.rift.projs) if (pr.until > st.tick) n++;
    for (; n < PROJS; n++) {
      const a = rng.range(0, Math.PI * 2);
      spawnProjectile(ctx, { visual: 'arrow', owner: 'mon', srcId: -1, x: p.x + Math.sin(a) * 6, z: p.z + Math.cos(a) * 6, facing: a + Math.PI, speed: 4, range: 30, r: 0.2,
        spec: { srcId: -1, via: 'projectile', raw: 1, type: 'phys', level: 5 } });
    }
  };
  return { sim, st, top };
}

test('S5: 깨어 있는 몬스터 120 + 투사체 200 → 300틱 평균 sim step ≤ 4ms(Node)', () => {
  const { sim, st, top } = scene(7);
  top();
  for (let i = 0; i < 60; i++) { top(); sim.step(NEUTRAL_INPUT); }   // 데우기(JIT)
  let best = Infinity;
  const tries = [];
  for (let attempt = 0; attempt < 3 && best > 4; attempt++) {
    let total = 0;
    let awakeMin = Infinity, projMin = Infinity;
    for (let i = 0; i < TICKS; i++) {
      top();
      let a = 0, q = 0;
      for (const m of st.rift.mons) if (!m.dead && !m.gone && m.awake) a++;
      for (const pr of st.rift.projs) if (pr.until > st.tick) q++;
      awakeMin = Math.min(awakeMin, a);
      projMin = Math.min(projMin, q);
      const t0 = performance.now();
      sim.step(NEUTRAL_INPUT);
      total += performance.now() - t0;
    }
    assert.ok(awakeMin >= MONS && projMin >= PROJS, `장면: 깨어 있는 ${awakeMin} · 투사체 ${projMin}`);
    const avg = total / TICKS;
    tries.push(avg.toFixed(2));
    best = Math.min(best, avg);
  }
  assertFiniteDeep(st, 'perf');
  assert.ok(best <= 4, `평균 step ${best.toFixed(2)}ms(시도 ${tries.join(' · ')})`);
});

test('S5: generateRift 시드 20개 각 ≤ 150ms', () => {
  generateRift(1, 1);   // 데우기
  const slow = [];
  for (let s = 1; s <= 20; s++) {
    let best = Infinity;
    for (let attempt = 0; attempt < 3 && best > 150; attempt++) {
      const t0 = performance.now();
      const map = generateRift(s * 7919, 1 + (s % 10));
      best = Math.min(best, performance.now() - t0);
      assert.ok(map.rooms.length >= 10, `시드 ${s}`);
    }
    if (best > 150) slow.push(`${s}: ${best.toFixed(0)}ms`);
  }
  assert.deepEqual(slow, []);
});
