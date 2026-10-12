// OWNER: P0 — 계약 §12.2(fixtures.test) · §11.9 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 고정 상태 15개(§11.9 표)가 §3 모양(실제 생성 함수가 만드는 키와 같다) · 유한수 · 엔티티가 맵의 걷기 가능 칸 위 · ID 유일 · 결정적 · JSON 왕복.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EQUIP_SLOTS, MON_ACTS, MON_RANKS, PLAYER_ACTS, RARITIES, RIFT_PHASES } from '../src/core/constants.js';
import { hashState } from '../src/core/hash.js';
import { circle } from '../src/core/shapes.js';
import { FIXTURES } from '../src/debug/fixtures.js';
import { spawnDrops } from '../src/sim/drops.js';
import { spawnEffect } from '../src/sim/effects.js';
import { makeItem } from '../src/sim/loot/rollItem.js';
import { spawnMonster } from '../src/sim/monsters/spawn.js';
import { createCharacter } from '../src/sim/progression/character.js';
import { spawnProjectile } from '../src/sim/projectiles.js';
import { createGameState, createMeter, createPlayerState, createRiftState, createTownState } from '../src/sim/state.js';
import { isWalkable } from '../src/sim/world/nav.js';
import { assertFiniteDeep, makeTestCtx, makeTestState } from './helpers.js';

const IDS = ['town', 'riftSwarm', 'riftElites', 'riftAffixes', 'riftGuardian', 'riftWitch', 'riftWarrior', 'riftMage', 'riftLoot', 'riftDeath', 'riftComplete', 'bag', 'shops', 'skillTree', 'lowLife'];
const EFFECT_KINDS = new Set(['spinEcho', 'quakeWave', 'shockwave', 'meteor', 'vortex', 'afterimageBlast', 'corpseBlast', 'iceBurst', 'chainArc', 'chargeLine',
  'bloaterBurst', 'poisonPool', 'fireDeath', 'coldNova', 'jail', 'plague', 'mortar', 'slam', 'boneSpikes', 'emberRain', 'guardianSpawn']);
const PROJ_VISUALS = new Set(['magicBolt', 'fireball', 'fireballSplit', 'iceShard', 'arrow', 'shamanFire', 'spark', 'ashBolt']);

// 실제 생성 함수가 만드는 꼴(키 집합의 정본)
const tState = makeTestState();
const tCtx = makeTestCtx(tState);
const T = {
  state: Object.keys(createGameState({ seed: 1 })),
  player: Object.keys(createPlayerState()),
  town: Object.keys(createTownState()),
  meter: Object.keys(createMeter()),
  rift: Object.keys(createRiftState({ level: 1, seed: 1, tileset: 'crypt', mapId: 'x', map: tCtx.map })),
  mon: Object.keys(spawnMonster(tCtx, { typeId: 'ghoul', rank: 'normal', level: 1, x: tCtx.map.spawn.x, z: tCtx.map.spawn.z })),
  effect: Object.keys(spawnEffect(tCtx, { kind: 'jail', owner: 'mon', srcId: 1, hostile: true, shape: circle(1, 1, 1), delay: 0.8, spec: null })),
  // 피드백 1: follow 'player'(연속 회전)는 따라가는 효과에만 있는 선택 키 — 그 효과는 이 꼴과 비교한다
  effectFollow: Object.keys(spawnEffect(tCtx, { kind: 'spinEcho', owner: 'player', srcId: 0, hostile: false, shape: circle(1, 1, 1), delay: 0.5, spec: null, follow: 'player' })),
  proj: Object.keys(spawnProjectile(tCtx, { visual: 'arrow', owner: 'mon', srcId: 1, x: 5, z: 5, facing: 0, speed: 10, range: 10, r: 0.2, spec: {} })),
  drop: Object.keys(spawnDrops(tCtx, [{ kind: 'gold', item: null, amount: 3, mat: null }], 10, 10)[0]),
  char: Object.keys(createCharacter({ slot: 0, cls: 'warrior', name: 'x', newId: () => 'i1' })),
  item: Object.keys(makeItem({ baseId: 'sword', id: 'i1' })),
};
const sameKeys = (obj, keys, where) => assert.deepEqual(Object.keys(obj).sort(), [...keys].sort(), `${where}: 키가 생성 함수와 다르다`);
/** 아이템의 키(전설 · 세트는 선택 키가 더 있다) */
const itemKeys = (it, where) => {
  const extra = Object.keys(it).filter(k => !T.item.includes(k));
  for (const k of extra) assert.ok(['legendaryId', 'setId', 'setPieceId'].includes(k), `${where}: 모르는 아이템 키 ${k}`);
  for (const k of T.item) assert.ok(k in it, `${where}: 아이템 키 ${k} 없음`);
  assert.ok(RARITIES.includes(it.rarity), `${where}.rarity`);
  assert.match(it.id, /^i\d+$/, `${where}.id`);
};

test('고정 상태는 §11.9 표의 15개다', () => {
  assert.deepEqual(Object.keys(FIXTURES), IDS);
});

for (const id of IDS) {
  test(`fixture ${id}: §3 모양 · 유한수 · 걷기 가능 · ID 유일 · 결정성 · JSON 왕복`, () => {
    const { state, map, riftMap } = FIXTURES[id](7);
    // 모양
    sameKeys(state, T.state, 'state');
    sameKeys(state.player, T.player, 'player');
    sameKeys(state.town, T.town, 'town');
    sameKeys(state.meter, T.meter, 'meter');
    assert.ok(state.char, '캐릭터가 있다');
    sameKeys(state.char, T.char, 'char');
    assert.ok(PLAYER_ACTS.includes(state.player.act), `player.act ${state.player.act}`);
    assert.equal(map.kind, state.scene, '지금 장면의 맵');
    assert.ok(state.player.lifeMax > 1 && state.player.life <= state.player.lifeMax);
    assert.ok(isWalkable(map, state.player.pos.x, state.player.pos.z), '플레이어가 걷기 가능 칸 위');
    // 아이템
    const itemIds = [];
    const items = [];
    for (const s of EQUIP_SLOTS) if (state.char.equip[s]) items.push(['equip.' + s, state.char.equip[s]]);
    state.char.bag.forEach((it, i) => it && items.push(['bag.' + i, it]));
    state.account.stash.forEach((it, i) => it && items.push(['stash.' + i, it]));
    state.char.shop.blacksmith.forEach((it, i) => items.push(['blacksmith.' + i, it]));
    state.char.shop.general.forEach((it, i) => items.push(['general.' + i, it]));
    state.char.buyback.forEach((b, i) => items.push(['buyback.' + i, b.item]));
    if (state.rift) state.rift.drops.forEach((d, i) => d.item && items.push(['drop.' + i, d.item]));
    for (const [where, it] of items) { itemKeys(it, where); itemIds.push(it.id); }
    assert.equal(new Set(itemIds).size, itemIds.length, '아이템 ID 유일');
    for (const iid of itemIds) assert.ok(Number(iid.slice(1)) < state.account.nextItemId, `${iid} < nextItemId`);
    // 균열
    if (state.rift) {
      const rift = state.rift;
      const rmap = state.scene === 'rift' ? map : riftMap;
      assert.ok(rmap, '균열 맵이 있다');
      assert.equal(rift.mapId, rmap.id);
      assert.equal(rift.explored.length, rmap.w * rmap.h);
      sameKeys(rift, T.rift, 'rift');
      assert.ok(RIFT_PHASES.includes(rift.phase));
      const ids = [];
      for (const m of rift.mons) {
        sameKeys(m, T.mon, `mon ${m.id}`);
        assert.ok(MON_ACTS.includes(m.act), `mon ${m.id}.act ${m.act}`);
        assert.ok(MON_RANKS.includes(m.rank), `mon ${m.id}.rank`);
        assert.ok(isWalkable(rmap, m.pos.x, m.pos.z), `mon ${m.id}(${m.typeId}) 가 걷기 가능 칸 위`);
        assert.ok(m.hp <= m.hpMax + 1e-9 && m.hp >= 0);
        assert.equal(m.dead, m.act === 'dead', `mon ${m.id}: dead ↔ act`);
        if (m.packId >= 0) assert.ok(rift.packs.some(p => p.id === m.packId && p.memberIds.includes(m.id)), `mon ${m.id} 의 팩`);
        ids.push(m.id);
      }
      for (const e of rift.effects) {
        sameKeys(e, 'follow' in e ? T.effectFollow : T.effect, `effect ${e.id}`);
        if ('follow' in e) assert.equal(e.follow, 'player', `effect ${e.id} follow`);
        assert.ok(EFFECT_KINDS.has(e.kind), `effect kind ${e.kind}(§9.8)`);
        assert.ok(e.start <= e.hitAt && e.hitAt < e.end && e.end > state.tick, `effect ${e.id} 시각`);
        assert.ok(isWalkable(rmap, e.shape.x, e.shape.z), `effect ${e.id}(${e.kind}) 기준점이 걷기 가능`);
        if (e.srcId > 0 && e.owner === 'mon') assert.ok(rift.mons.some(m => m.id === e.srcId), `effect ${e.id} 의 출처`);
        ids.push(e.id);
      }
      for (const p of rift.projs) {
        sameKeys(p, T.proj, `proj ${p.id}`);
        assert.ok(PROJ_VISUALS.has(p.visual), `proj visual ${p.visual}`);
        assert.ok(p.until > state.tick && p.born <= state.tick);
        assert.ok(isWalkable(rmap, p.pos.x, p.pos.z), `proj ${p.id} 가 걷기 가능 칸 위`);
        ids.push(p.id);
      }
      for (const d of rift.drops) {
        sameKeys(d, T.drop, `drop ${d.id}`);
        assert.ok(isWalkable(rmap, d.pos.x, d.pos.z), `drop ${d.id} 가 걷기 가능 칸 위`);
        assert.equal(d.rarity, d.item ? d.item.rarity : null);
        ids.push(d.id);
      }
      for (const p of rift.packs) ids.push(p.id);
      for (const p of rift.portals) {
        assert.match(p.id, /^portal:\d+$/);
        assert.ok(isWalkable(rmap, p.pos.x, p.pos.z));
        ids.push(Number(p.id.slice(7)));
      }
      assert.equal(new Set(ids).size, ids.length, '엔티티 ID 유일');
      for (const x of ids) assert.ok(x > 0 && x < state.nextId, `ID ${x} < nextId`);
      if (rift.guardianId !== null) assert.ok(rift.mons.some(m => m.id === rift.guardianId && m.rank === 'guardian'));
    }
    // 유한수 · 직렬화 · 결정성
    assertFiniteDeep(state);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), structuredClone(state), 'JSON 왕복');
    const again = FIXTURES[id](7);
    assert.equal(hashState(again.state), hashState(state), '같은 시드 → 같은 상태');
  });
}

test('fixture 세부: riftSwarm 40마리 · riftAffixes 속성 12 · skillTree 포인트 3 남음 · riftDeath 생명 1 · bag 38칸', () => {
  const sw = FIXTURES.riftSwarm(1).state;
  assert.equal(sw.rift.mons.length, 40);
  assert.equal(new Set(sw.rift.mons.map(m => m.typeId)).size, 10, '일반 8종 + 새끼 2');
  for (const act of ['move', 'windup', 'strike', 'flinch', 'stunned', 'frozen', 'dead']) assert.ok(sw.rift.mons.some(m => m.act === act), `riftSwarm 에 ${act}`);
  assert.ok(sw.rift.mons.some(m => m.dead && m.launch), '날아가는 시체');
  const af = FIXTURES.riftAffixes(1).state;
  const affs = af.rift.mons.flatMap(m => m.affixes);
  assert.equal(new Set(affs).size, 12);
  const st = FIXTURES.skillTree(1).state;
  const spent = Object.values(st.char.skills.ranks).reduce((a, b) => a + b, 0);
  assert.equal(st.char.level - 1 - spent, 3);
  const dth = FIXTURES.riftDeath(1).state;
  assert.equal(dth.rift.lives, 1);
  assert.ok(dth.player.dead && dth.player.killedBy);
  const bag = FIXTURES.bag(1).state;
  assert.equal(bag.char.bag.filter(Boolean).length, 38);
  assert.equal(bag.account.stash.filter(Boolean).length, 20);
  assert.ok(EQUIP_SLOTS.every(s => bag.char.equip[s]));
  assert.ok(bag.char.bag.some(it => it && it.reqLevel > bag.char.level), '못 끼는 레벨');
  assert.ok(bag.char.bag.some(it => it && it.dur === 0), '부서진 장비');
  const el = FIXTURES.riftElites(1).state;
  const elite = el.rift.mons.find(m => m.rank === 'elite');
  assert.equal(elite.affixes.length, 4);
  assert.ok(el.rift.mons.filter(m => m.rank === 'champion').every(m => m.affixes.length === 2));
  assert.equal(el.rift.mons.filter(m => m.rank === 'minion').length, 4);
  assert.equal(el.player.hover.id, elite.id);
  const town = FIXTURES.town(1);
  assert.equal(town.state.scene, 'town');
  assert.ok(town.state.town.portalOpen && town.state.town.returnPrompt && town.riftMap && town.state.rift.leftAt >= 0);
  const comp = FIXTURES.riftComplete(1).state;
  assert.equal(comp.rift.phase, 'complete');
  assert.ok(comp.rift.portals.some(p => p.kind === 'exit') && comp.rift.summary);
  const loot = FIXTURES.riftLoot(1).state;
  assert.deepEqual(new Set(loot.rift.drops.filter(d => d.item).map(d => d.rarity)), new Set(RARITIES));
  assert.deepEqual(new Set(loot.rift.drops.map(d => d.kind)), new Set(['item', 'gold', 'potion', 'globe', 'material']));
});
