// OWNER: P3 — 계약 §12.2(packs.test) · §7.5c · §5.14 · §7.14
// 균열 채우기 결정성 · 팩 구성 범위 · 챔피언/정예 수 = riftRow · 속성 수 · 정예 이름 · 하수인 공유 · 게이지 합 ≥ 115%(§7.14) · spawnPack · 배치(걷기 가능 · 잠든 채).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EV } from '../src/core/events.js';
import { hashState } from '../src/core/hash.js';
import { makeRng, seedRng } from '../src/core/rng.js';
import { getMonDef, getRank, PACKS_BY_ID } from '../src/data/index.js';
import { ELITE_NAMES, ELITE_PACK, PACKS } from '../src/data/packs.js';
import { RIFT, riftRow } from '../src/data/rift.js';
import { STRINGS } from '../src/data/strings.ko.js';
import { onMonDamaged, onMonDeath, onMonHitPlayer, onMonSpawn } from '../src/sim/monsters/monsters.js';
import { eliteName, minionAffixes, populateRift, slotKinds, spawnPack } from '../src/sim/monsters/packs.js';
import { createRiftState } from '../src/sim/state.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { countEvents, makeTestCtx, makeTestMap, makeTestState } from './helpers.js';

const HOOKS = { onMonSpawn, onMonDamaged, onMonDeath, onMonHitPlayer };

/** 넓은 방(128m) · 팩 자리 = 일반 normalN + riftRow 의 챔피언/정예(깊이 3) — §7.14 의 「일반 팩 ~60」 꼴 */
function arena(level, normalN = 60) {
  const n = 64;
  const rows = [];
  for (let j = 0; j < n; j++) {
    let r = '';
    for (let i = 0; i < n; i++) r += i === 0 || j === 0 || i === n - 1 || j === n - 1 ? '#' : i === 32 && j === 32 ? 'S' : '.';
    rows.push(r);
  }
  const map = makeTestMap(rows.join('\n'));
  const row = riftRow(level);
  const slots = [];
  let id = 1;
  const kinds = [...Array(row.elitePacks).fill('elite'), ...Array(row.championPacks).fill('champion'), ...Array(normalN).fill('normal')];
  for (let k = 0; k < kinds.length; k++) {
    const gx = k % 9, gz = Math.floor(k / 9);
    slots.push({ id: id++, roomId: k, x: 8 + gx * 14, z: 8 + gz * 14, kind: kinds[k], depth: kinds[k] === 'normal' ? 1 : 3 });
  }
  map.packSlots = slots;
  return map;
}

function fill({ seed = 1, level = 1, map = null, tileset = 'crypt' } = {}) {
  const m = map ?? arena(level);
  const state = makeTestState({ map: m, seed });
  state.rift = createRiftState({ level, seed, tileset, mapId: `test:${seed}:${level}`, map: m });
  const ctx = makeTestCtx(state, { map: m, hooks: HOOKS });
  populateRift(ctx);
  return { state, ctx, map: m, rift: state.rift };
}

const membersOf = (rift, pk) => pk.memberIds.map(id => rift.mons.find(m => m.id === id));

/** 게이지 합(%) — RANKS.gauge × type.gauge × 초반 배율(§5.18) */
function gaugeSum(rift) {
  let g = 0;
  for (const m of rift.mons) {
    const early = rift.level <= RIFT.earlyGaugeTo && (m.rank === 'normal' || m.rank === 'minion') ? RIFT.earlyGaugeMul : 1;
    g += getRank(m.rank).gauge * getMonDef(m.typeId).gauge * early;
  }
  return g;
}

test('populateRift 결정성 — 같은 seed · level 이면 같은 팩 · 몬스터 · 수호자 종류 / 다른 seed 면 다르다 · MON_SPAWNED 를 내지 않는다 · 전부 잠든 채', () => {
  const a = fill({ seed: 7, level: 4 });
  const b = fill({ seed: 7, level: 4 });
  const c = fill({ seed: 8, level: 4 });
  assert.equal(hashState({ r: a.rift.mons, p: a.rift.packs, g: a.rift.guardianType }), hashState({ r: b.rift.mons, p: b.rift.packs, g: b.rift.guardianType }));
  assert.notEqual(hashState({ r: a.rift.mons }), hashState({ r: c.rift.mons }));
  assert.equal(countEvents(a.ctx.events, EV.MON_SPAWNED), 0);
  assert.ok(a.rift.mons.every(m => !m.awake));
  assert.ok(a.rift.packs.every(p => !p.awake));
  assert.ok(['boneGiant', 'ashWitch'].includes(a.rift.guardianType));
  // 채우기 난수는 균열 seed · level 줄기 — 세션 rng.ai 를 쓰지 않는다
  const s0 = a.state.rng.ai.s;
  populateRift(a.ctx);
  assert.equal(a.state.rng.ai.s, s0);
});

test('팩 구성: 일반 팩은 PACKS 한 행의 범위 · 챔피언 같은 종 2~4(돌격 짐승 ≤ 3) · 같은 속성 riftRow.champAffixes · 정예 1 + 하수인 3~5 · 이름 · 하수인 공유 · 걷기 가능', () => {
  for (const level of [1, 5, 12, 20]) {
    const { rift, map } = fill({ seed: 100 + level, level, tileset: level % 2 ? 'crypt' : 'cavern' });
    const row = riftRow(level);
    const champs = rift.packs.filter(p => p.kind === 'champion');
    const elites = rift.packs.filter(p => p.kind === 'elite');
    assert.equal(champs.length, row.championPacks, `L${level} 챔피언 팩`);
    assert.equal(elites.length, row.elitePacks, `L${level} 정예 팩`);
    for (const pk of rift.packs.filter(p => p.kind === 'normal')) {
      const ms = membersOf(rift, pk);
      const types = [...new Set(ms.map(m => m.typeId))].sort();
      const def = PACKS.find(d => d.members.map(x => x.typeId).sort().join() === types.join());
      assert.ok(def, `L${level} 일반 팩 구성 ${types}`);
      assert.ok(def.minLevel <= level, `${def.id} minLevel`);
      for (const mm of def.members) {
        const n = ms.filter(m => m.typeId === mm.typeId).length;
        assert.ok(n >= mm.min && n <= mm.max, `${def.id}.${mm.typeId} ${n}`);
      }
      assert.ok(ms.every(m => m.rank === 'normal' && m.affixes.length === 0 && m.name === null));
    }
    for (const pk of champs) {
      const ms = membersOf(rift, pk);
      const t = ms[0].typeId;
      assert.ok(Object.keys(ELITE_PACK.types).includes(t));
      assert.ok(ms.every(m => m.typeId === t && m.rank === 'champion'));
      const max = ELITE_PACK.champion.maxByType[t] ?? ELITE_PACK.champion.max;
      assert.ok(ms.length >= ELITE_PACK.champion.min && ms.length <= max, `챔피언 ${t} ${ms.length}`);
      assert.equal(ms[0].affixes.length, row.champAffixes);
      for (const m of ms) assert.deepEqual(m.affixes, ms[0].affixes);
    }
    for (const pk of elites) {
      const ms = membersOf(rift, pk);
      const e = ms.filter(m => m.rank === 'elite');
      const mi = ms.filter(m => m.rank === 'minion');
      assert.equal(e.length, 1);
      assert.ok(mi.length >= ELITE_PACK.elite.minions[0] && mi.length <= ELITE_PACK.elite.minions[1]);
      assert.equal(e[0].affixes.length, row.eliteAffixes);
      assert.ok(mi.every(m => m.typeId === e[0].typeId));
      for (const m of mi) assert.deepEqual(m.affixes, minionAffixes(e[0].affixes));
      assert.equal(e[0].name.length, 2);
      for (const k of e[0].name) assert.ok(STRINGS[k], `이름 키 ${k}`);
      assert.ok(mi.every(m => m.name === null));
    }
    for (const m of rift.mons) {
      assert.ok(isWalkable(map, m.pos.x, m.pos.z), `걷기 가능 ${m.typeId}`);
      assert.ok(m.packId >= 0 && rift.packs.some(p => p.id === m.packId && p.memberIds.includes(m.id)));
    }
  }
});

test('팩 자리 종류는 riftRow 의 수에 맞춘다 — 남는 champion/elite 는 normal · 모자라면 깊은(depth ≥ 2) normal 을 올린다', () => {
  const row = { championPacks: 4, elitePacks: 2 };
  const mk = (kinds, depths) => kinds.map((k, i) => ({ id: i + 1, roomId: i, x: 0, z: 0, kind: k, depth: depths[i] }));
  assert.deepEqual(slotKinds(mk(['champion', 'champion', 'champion', 'champion', 'champion', 'elite', 'elite', 'elite', 'normal'], [3, 3, 3, 3, 3, 3, 3, 3, 1]), row),
    ['champion', 'champion', 'champion', 'champion', 'normal', 'elite', 'elite', 'normal', 'normal']);
  assert.deepEqual(slotKinds(mk(['normal', 'normal', 'normal', 'normal', 'champion', 'normal', 'normal'], [1, 4, 2, 5, 3, 3, 0]), row),
    ['normal', 'elite', 'champion', 'elite', 'champion', 'champion', 'normal']);   // 정예 먼저 가장 깊은 둘 · 남은 깊은 자리가 모자라면 그만큼 적다
  // 고정 맵(스텁 · 테스트 방)에서도 수가 맞는다
  const { rift } = fill({ seed: 3, level: 8, map: arena(8, 20) });
  assert.equal(rift.packs.filter(p => p.kind === 'champion').length, riftRow(8).championPacks);
});

test('게이지 합 ≥ 115%(§7.14) — 일반 팩 60 자리 꼴 · 실제 생성 맵(generateRift)이 있으면 그것도', () => {
  for (const [level, tileset] of [[1, 'crypt'], [1, 'cavern'], [3, 'crypt'], [6, 'cavern'], [15, 'crypt']]) {
    const sums = [];
    for (let s = 0; s < 4; s++) sums.push(gaugeSum(fill({ seed: 40 + s, level, tileset }).rift));
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    assert.ok(Math.min(...sums) >= 115, `L${level} ${tileset}: ${sums.map(x => x.toFixed(0))}`);
    void avg;
  }
  const probe = generateRift(1, 1);
  if (!(probe.rooms.length >= 10)) return;   // 생성기 스텁(방 하나)이면 고정 꼴만 본다
  for (let s = 1; s <= 6; s++) {
    const level = 1 + (s % 3) * 4;
    const map = generateRift(s, level);
    const { rift } = fill({ seed: s, level, map, tileset: map.tileset });
    const g = gaugeSum(rift);
    assert.ok(g >= 115, `generateRift(${s}, ${level}) 게이지 합 ${g.toFixed(1)}%`);
    assert.equal(rift.packs.filter(p => p.kind === 'elite').length, riftRow(level).elitePacks);
    for (const m of rift.mons) assert.ok(isWalkable(map, m.pos.x, m.pos.z));
  }
});

test('spawnPack(디버그 · 측정) — champion · elite · normal · guardian · awake 면 MON_WAKE 와 함께 깬다 · 없는 종류는 -1', () => {
  const map = makeTestMap();
  const state = makeTestState({ map });
  state.rift.level = 6;
  const ctx = makeTestCtx(state, { map, hooks: HOOKS });
  const rift = state.rift;
  const c = spawnPack(ctx, { typeId: 'charger', rank: 'champion', x: 20, z: 10, awake: true });
  const cp = rift.packs.find(p => p.id === c);
  assert.equal(cp.kind, 'champion');
  const cm = membersOf(rift, cp);
  assert.ok(cm.length >= 2 && cm.length <= 3, '돌격 짐승 챔피언 ≤ 3');
  assert.ok(cm.every(m => m.awake && m.rank === 'champion'));
  assert.equal(cm[0].affixes.length, riftRow(6).champAffixes);
  const w = ctx.events.filter(e => e.name === EV.MON_WAKE);
  assert.equal(w.length, 1);
  assert.equal(w[0].payload.count, cm.length);
  const e = spawnPack(ctx, { typeId: 'skeletonArcher', rank: 'elite', affixes: ['mortar', 'fast'], x: 30, z: 30 });
  const em = membersOf(rift, rift.packs.find(p => p.id === e));
  assert.deepEqual(em.find(m => m.rank === 'elite').affixes, ['mortar', 'fast']);
  assert.ok(em.every(m => !m.awake));
  const n = spawnPack(ctx, { typeId: 'ghoul', rank: 'normal', x: 10, z: 30 });
  const nm = membersOf(rift, rift.packs.find(p => p.id === n));
  const gp = PACKS_BY_ID.ghoulPack.members[0];
  assert.ok(nm.length >= gp.min && nm.length <= gp.max);
  const g = spawnPack(ctx, { typeId: 'boneGiant', rank: 'guardian', x: 22, z: 34, awake: true });
  const gm = membersOf(rift, rift.packs.find(p => p.id === g));
  assert.equal(gm.length, 1);
  assert.equal(gm[0].rank, 'guardian');
  assert.equal(gm[0].affixes.length, riftRow(6).guardianAffixes);
  assert.equal(spawnPack(ctx, { typeId: 'nope', rank: 'normal', x: 1, z: 1 }), -1);
  for (const m of rift.mons) assert.ok(isWalkable(map, m.pos.x, m.pos.z));
});

test('eliteName → [elite.a.N, elite.b.M] — 부록 B 의 키 범위', () => {
  const rng = makeRng(seedRng(5));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const [a, b] = eliteName(rng);
    assert.match(a, /^elite\.a\.\d+$/);
    assert.match(b, /^elite\.b\.\d+$/);
    assert.ok(STRINGS[a] && STRINGS[b]);
    seen.add(a); seen.add(b);
  }
  assert.equal(seen.size, ELITE_NAMES.a + ELITE_NAMES.b);
});
