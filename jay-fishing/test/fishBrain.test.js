// OWNER: P2 — 계약 §12.2(fishBrain) · §8.2
// 36종 buildBrain 검증 · 특성 적용 · 결정성 · sim/fight/*.js 에 어종 ID 문자열이 없다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BEHAVIOR_KINDS } from '../src/core/constants.js';
import { STYLES, TRAITS } from '../src/data/fightStyles.js';
import { SPECIES, getSpecies } from '../src/data/species/index.js';
import { buildBrain, firstRunState, lateralOf, stepBrain } from '../src/sim/fight/fishBrain.js';
import { createFight } from '../src/sim/fight/fight.js';
import { makeTestCtx, makeTestMods, makeTestRigStats, makeTestState } from './helpers.js';

/** §8.2 의 검증: start 가 있다 · 모든 next 도착 상태가 있다 · next 가중치 합 > 0 · start 에서 모든 상태에 닿는다 */
function validateBrain(brain, label) {
  assert.ok(brain.states[brain.start], `${label}: start '${brain.start}' 상태가 없다`);
  for (const [name, st] of Object.entries(brain.states)) {
    assert.ok(BEHAVIOR_KINDS.includes(st.kind), `${label}.${name}: kind '${st.kind}'`);
    for (const k of ['f', 'along', 'sp']) assert.ok(Number.isFinite(st[k]), `${label}.${name}.${k}`);
    assert.ok(st.dur[0] > 0 && st.dur[1] >= st.dur[0], `${label}.${name}.dur`);
    let sum = 0;
    for (const [to, w] of Object.entries(st.next)) {
      assert.ok(brain.states[to], `${label}.${name}.next → '${to}' 가 없다`);
      assert.ok(w >= 0 && Number.isFinite(w), `${label}.${name}.next.${to} 가중치`);
      sum += w;
    }
    assert.ok(sum > 0, `${label}.${name}: next 가중치 합 ${sum}`);
  }
  const seen = new Set([brain.start]);
  const stack = [brain.start];
  while (stack.length) {
    const cur = stack.pop();
    for (const [to, w] of Object.entries(brain.states[cur].next)) {
      if (w > 0 && !seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  const unreachable = Object.keys(brain.states).filter(n => !seen.has(n));
  assert.deepEqual(unreachable, [], `${label}: start 에서 닿지 않는 상태`);
}

test('36종 buildBrain 검증(start · next 도착 · 가중치 합 · 도달성)', () => {
  assert.equal(SPECIES.length, 36);
  for (const sp of SPECIES) {
    const brain = buildBrain(sp);
    validateBrain(brain, sp.id);
    assert.ok(brain.abrasionMul > 0);
    assert.ok(Array.isArray(brain.visual));
  }
  // 성격 6종 그 자체도(특성 없이)
  for (const style of Object.keys(STYLES)) validateBrain(buildBrain({ id: null, style, traits: [] }), `style:${style}`);
});

test('특성 16종이 모두 어느 어종에 쓰이고, 하나씩 적용해도 표가 유효하다', () => {
  assert.equal(Object.keys(TRAITS).length, 16);
  const used = new Set(SPECIES.flatMap(s => s.traits));
  for (const id of Object.keys(TRAITS)) assert.ok(used.has(id), `특성 ${id} 를 쓰는 어종이 없다`);
  for (const style of Object.keys(STYLES)) {
    for (const tr of Object.keys(TRAITS)) {
      const brain = buildBrain({ id: null, style, traits: [tr] });
      // 특성 상태가 그 성격의 상태로만 이어질 수 있다(tremble → wiggle 등) — 닿을 수 있는 조합만 검증
      const dangling = Object.values(brain.states).some(st => Object.keys(st.next).some(to => !brain.states[to]));
      if (!dangling) validateBrain(brain, `${style}+${tr}`);
    }
  }
});

test('특성 적용 — addStates · addNext · scaleByKind · nextMulByKind · start · abrasionMul · visual', () => {
  const base = (style) => STYLES[style].states;
  // dash(향어): 상태 추가 · hold/rest 에서 dash 로 가는 가중치
  const ic = buildBrain(getSpecies('israeliCarp'));
  assert.ok(ic.states.dash && ic.states.dash.kind === 'run');
  assert.equal(ic.states.hold.next.dash, 0.25);
  assert.equal(ic.states.rest.next.dash, 0.25);
  assert.equal(ic.states.run.next.dash, undefined, 'addNext 는 적힌 출발 상태에만');
  // shortRun(누치): run kind 의 dur × 0.5 · sp × 1.2
  const sb = buildBrain(getSpecies('steedBarbel'));
  assert.deepEqual(sb.states.run.dur, [base('runner').run.dur[0] * 0.5, base('runner').run.dur[1] * 0.5]);
  assert.ok(Math.abs(sb.states.run.sp - base('runner').run.sp * 1.2) < 1e-12);
  assert.equal(sb.states.rest.sp, base('runner').rest.sp, 'scaleByKind 는 그 kind 에만');
  // shake(메기): 출발 상태가 없는 addNext 항목(turn)은 무시
  const cf = buildBrain(getSpecies('catfish'));
  assert.ok(cf.states.shake);
  assert.equal(cf.states.turn, undefined);
  // multiJump(스틸헤드): §8.2 의 순서 — addNext(jump → jump 0.3)가 먼저, 그 뒤 jump kind 로 가는 가중치 × 2
  const steel = buildBrain(getSpecies('steelhead'));
  assert.ok(Math.abs(steel.states.run.next.jump - base('jumper').run.next.jump * 2) < 1e-12);
  assert.ok(Math.abs(steel.states.jump.next.jump - 0.3 * 2) < 1e-12);
  // spin(독가시치): turn 으로 가는 가중치 × 2 · turn 의 lateral = 기본 0.8 × 2 · visual
  const rb = buildBrain(getSpecies('rabbitfish'));
  assert.ok(Math.abs(rb.states.burst.next.turn - base('thrasher').burst.next.turn * 2) < 1e-12);
  assert.ok(Math.abs(lateralOf(rb.states.turn) - 1.6) < 1e-12);
  assert.ok(rb.visual.includes('spin'));
  // firstRun(벵에돔): 시작 상태가 바뀐다
  const op = buildBrain(getSpecies('opaleye'));
  assert.equal(op.start, 'firstRun');
  // twist + abrade(곰치): abrades 상태 · 쓸림 배율
  const me = buildBrain(getSpecies('morayEel'));
  assert.equal(me.states.twist.abrades, true);
  assert.ok(Math.abs(me.abrasionMul - 1.6) < 1e-12);
  // tremble(동사리): visual
  assert.ok(buildBrain(getSpecies('bullhead')).visual.includes('tremble'));
  // vanish(전설 왕연어): charge 상태
  assert.equal(buildBrain(getSpecies('paleKing')).states.vanish.kind, 'charge');
  // 원본 표를 고치지 않는다
  assert.equal(STYLES.heavy.states.hold.next.dash, undefined);
  assert.equal(STYLES.runner.states.run.dur[0], 4);
  // 첫 run(없으면 dive)
  assert.equal(firstRunState(buildBrain(getSpecies('crucian'))), 'run');
  assert.equal(firstRunState(buildBrain(getSpecies('barredKnifejaw'))), 'dive');
});

test('결정성 — 같은 어종은 같은 brain(캐시) · 같은 시드는 같은 행동열', () => {
  for (const sp of SPECIES) assert.equal(buildBrain(sp), buildBrain(sp));
  assert.deepEqual(buildBrain({ id: null, style: 'heavy', traits: ['dash'] }), buildBrain(getSpecies('israeliCarp')));
  const run = (seed) => {
    const state = makeTestState({ spotId: 'lake_gravel', set: 'bottom', seed });
    const ctx = makeTestCtx(state, { rigStats: makeTestRigStats('bottom'), mods: makeTestMods(), refresh() {} });
    const roll = { speciesId: 'mandarinFish', z: 0, pct: 0.5, lengthCm: 33.9, weightKg: 0.7, tier: 'normal' };
    const f = createFight(ctx, { speciesId: 'mandarinFish', roll, dist: 20, bearing: 0, depth: 2 });
    const brain = buildBrain(getSpecies('mandarinFish'));
    const seq = [];
    for (let i = 0; i < 1800; i++) {
      stepBrain(f, brain, ctx.rng, 1 / 60, ctx, 0.5);
      seq.push(f.behaviorName + (f.telegraph ? '*' : ''));
    }
    return seq.join(',');
  };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

test('sim/fight/*.js 에 어종 ID 문자열이 없다(로직은 표의 차이만 본다)', () => {
  const dir = fileURLToPath(new URL('../src/sim/fight/', import.meta.url));
  const files = readdirSync(dir).filter(n => n.endsWith('.js')).map(n => [n, readFileSync(dir + n, 'utf8')]);
  files.push(['bot/policy.js', readFileSync(fileURLToPath(new URL('../src/bot/policy.js', import.meta.url)), 'utf8')]);
  assert.ok(files.length >= 3);
  for (const [name, src] of files) {
    for (const sp of SPECIES) {
      assert.ok(!new RegExp(`\\b${sp.id}\\b`).test(src), `${name} 에 어종 ID '${sp.id}' 가 있다`);
    }
  }
});
