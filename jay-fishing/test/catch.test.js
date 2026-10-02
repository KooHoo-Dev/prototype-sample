// OWNER: P1 — 계약 §12.2(catch) · §5.4.5
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, seedRng } from '../src/core/rng.js';
import { normalCdf } from '../src/core/stats.js';
import { BITE } from '../src/data/bite.js';
import { PRICE } from '../src/data/economy.js';
import { SPECIES } from '../src/data/species/index.js';
import { rollFish, tierOf } from '../src/sim/fishing/catch.js';

const N = 10000;

test('어종마다 10,000 표본: 트로피(≥ 90%) 9–11% · 레전드(≥ 99%) 0.7–1.3%', () => {
  for (const sp of SPECIES) {
    const rng = makeRng(seedRng(1000 + sp.id.length * 97 + sp.id.charCodeAt(0)));
    let trophy = 0;
    let legend = 0;
    for (let i = 0; i < N; i++) {
      const f = rollFish(rng, sp);
      if (f.tier === 'trophy' || f.tier === 'legend') trophy++;
      if (f.tier === 'legend') legend++;
    }
    const tr = trophy / N;
    const lg = legend / N;
    assert.ok(tr >= 0.09 && tr <= 0.11, `${sp.id} 트로피 비율 ${tr}`);
    assert.ok(lg >= 0.007 && lg <= 0.013, `${sp.id} 레전드 비율 ${lg}`);
  }
});

test('길이 범위(5–99.9 퍼센타일) 표본 비율 ≈ 94.9% · 값이 유한하고 반올림 규약대로', () => {
  for (const sp of SPECIES) {
    const rng = makeRng(seedRng(77 + sp.id.length));
    let inside = 0;
    for (let i = 0; i < N; i++) {
      const f = rollFish(rng, sp);
      assert.ok(Number.isFinite(f.lengthCm) && Number.isFinite(f.weightKg) && f.weightKg > 0, sp.id);
      assert.ok(f.z >= BITE.zMin && f.z <= BITE.zMax);
      assert.equal(Math.round(f.lengthCm * 10) / 10, f.lengthCm);
      assert.equal(Math.round(f.weightKg * 1000) / 1000, f.weightKg);
      if (f.lengthCm >= sp.lenCm[0] && f.lengthCm <= sp.lenCm[1]) inside++;
    }
    const frac = inside / N;
    assert.ok(Math.abs(frac - (0.999 - 0.05)) <= 0.015, `${sp.id} 범위 안 비율 ${frac}`);
  }
});

test('rollFish(pct) 왕복 — pct → z → Φ(z) = pct · 중앙값 · 두 끝 · 클램프', () => {
  for (const sp of SPECIES) {
    for (const p of [0.05, 0.25, 0.5, 0.9, 0.95, 0.99, 0.999]) {
      const f = rollFish(null, sp, p);
      assert.ok(Math.abs(f.pct - p) < 1e-6, `${sp.id} ${p} → ${f.pct}`);
      assert.equal(f.tier, tierOf(p));
    }
    const lo = rollFish(null, sp, 0.05);
    const hi = rollFish(null, sp, 0.999);
    assert.ok(Math.abs(lo.lengthCm - sp.lenCm[0]) <= 0.1 + 1e-9, `${sp.id} 5% 길이 ${lo.lengthCm}`);
    assert.ok(Math.abs(hi.lengthCm - sp.lenCm[1]) <= 0.1 + 1e-9, `${sp.id} 99.9% 길이 ${hi.lengthCm}`);
    assert.ok(Math.abs(lo.weightKg - sp.kg[0]) / sp.kg[0] < 0.01, `${sp.id} 5% 무게`);
    assert.ok(Math.abs(hi.weightKg - sp.kg[1]) / sp.kg[1] < 0.01, `${sp.id} 99.9% 무게`);
    const med = rollFish(null, sp, 0.5);
    assert.ok(Math.abs(med.lengthCm - sp.medianCm) <= 0.1 + 1e-9);
    // 극단 퍼센타일은 [zMin, zMax] 로 잘린다
    const top = rollFish(null, sp, 1);
    assert.ok(Math.abs(top.pct - normalCdf(Math.min(BITE.zMax, top.z))) < 1e-12);
    assert.ok(top.z <= BITE.zMax && rollFish(null, sp, 0).z >= BITE.zMin);
  }
});

test('tierOf 경계', () => {
  assert.equal(tierOf(PRICE.trophyPct - 1e-9), 'normal');
  assert.equal(tierOf(PRICE.trophyPct), 'trophy');
  assert.equal(tierOf(PRICE.legendPct - 1e-9), 'trophy');
  assert.equal(tierOf(PRICE.legendPct), 'legend');
});

test('결정성 — 같은 시드면 같은 표본열', () => {
  const sp = SPECIES[0];
  const a = makeRng(seedRng(42));
  const b = makeRng(seedRng(42));
  for (let i = 0; i < 500; i++) assert.deepEqual(rollFish(a, sp), rollFish(b, sp));
});
